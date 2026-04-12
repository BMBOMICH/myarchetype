import { AudioModule, RecordingPresets, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc, collection, doc, getDoc, limit, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, Timestamp, writeBatch,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView,
  Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { app, auth, db } from '../firebaseConfig';
import type { AgeVerification } from '../utils/ageVerification';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import type { DateIdea } from '../utils/aiHelpers';
import { getConversationStarters, getDateIdeas } from '../utils/aiHelpers';
import type { ChatSettings } from '../utils/chatSettings';
import { CHAT_WALLPAPERS, getChatSettings, getWallpaperStyle, updateChatSettings } from '../utils/chatSettings';
import type { DisappearingMode } from '../utils/disappearingMessages';
import { cleanupExpiredMessages, getDisappearingLabel, getDisappearingSettings, setDisappearingMode } from '../utils/disappearingMessages';
import { decryptTextFromSender, encryptTextForRecipient, ensureMyE2EEIdentity } from '../utils/e2ee';
import { decryptMediaToRenderableUri, encryptAndUploadImageForRecipient, encryptAndUploadVoiceForRecipient } from '../utils/e2eeMedia';
import type { GiphyGif } from '../utils/giphyApi';
import { getTrendingGifs, GIF_CATEGORIES, searchGifs } from '../utils/giphyApi';
import { logger } from '../utils/logger';
import { getMatchNote, saveMatchNote } from '../utils/matchNotes';
import type { Reaction } from '../utils/messageReactions';
import { addReaction, groupReactions, hasUserReacted, REACTION_EMOJIS } from '../utils/messageReactions';
import { translateMessage } from '../utils/messageTranslation';
import { checkImageSafety, checkTextSafety } from '../utils/moderation';
import { notifyNewMessage } from '../utils/notifications';
import { formatLastSeen, isUserOnline } from '../utils/onlineStatus';
import type { PinnedMessage } from '../utils/pinnedMessages';
import { getPinnedMessages, pinMessage, unpinMessage } from '../utils/pinnedMessages';
import { shouldPromptForRating } from '../utils/ratingSystem';

// ─── Types ────────────────────────────────────────────────

interface Message {
  id: string; text: string; senderId: string;
  timestamp: Timestamp | Date | number | null;
  read?: boolean; readAt?: Timestamp | Date | number | null;
  imageUrl?: string; voiceUrl?: string; voiceDuration?: number; isGif?: boolean;
  reactions?: Reaction[]; isPinned?: boolean;
  messageType?: 'text' | 'image' | 'voice' | 'gif' | 'system';
  version?: number; senderPublicKey?: string; senderKeyVersion?: number;
  mediaUrl?: string; mediaMimeType?: string; mediaSizeBytes?: number;
  encryptedMediaKey?: string; mediaKeyNonce?: string; mediaCipherNonce?: string;
}

interface DateSuggestion {
  name: string; type: string; address: string; distance: number;
  rating?: number; latitude?: number; longitude?: number;
}

interface MatchData {
  name?: string; lastSeen?: Timestamp | Date | number | null;
  selfieVerified?: boolean; ageVerification?: AgeVerification | null;
  pushToken?: string; location?: { latitude: number; longitude: number };
  personalityType?: string; interests?: string[]; lifestyle?: string;
}

interface FirestoreMessageData {
  senderId?: string; timestamp?: Timestamp | null; read?: boolean; readAt?: Timestamp | null;
  messageType?: string; ciphertext?: string; nonce?: string; senderPublicKey?: string;
  senderKeyVersion?: number; version?: number; encryptedText?: string; text?: string;
  imageUrl?: string; voiceUrl?: string; voiceDuration?: number; isGif?: boolean;
  reactions?: Reaction[]; mediaUrl?: string; mediaMimeType?: string; mediaSizeBytes?: number;
  encryptedMediaKey?: string; mediaKeyNonce?: string; mediaCipherNonce?: string;
}

interface FirestorePlaceElement {
  lat?: number; lon?: number;
  tags?: {
    name?: string; amenity?: string; leisure?: string; tourism?: string;
    'addr:housenumber'?: string; 'addr:street'?: string; 'addr:city'?: string;
  };
}

interface OverpassResponse { elements?: FirestorePlaceElement[]; }

type ParamValue    = string | string[] | undefined;
type MessageAction = 'react' | 'translate' | 'pin';

// ─── State shape groups ───────────────────────────────────

interface ChatCoreState {
  messages: Message[]; loading: boolean; sending: boolean; uploadingMedia: boolean; newMessage: string;
}
interface MatchState {
  matchData: MatchData | null; matchOnline: boolean;
  matchLastSeen: Timestamp | Date | number | null;
  myLocation: { latitude: number; longitude: number } | null;
}
interface RecordingState {
  isRecording: boolean; recordingDuration: number; playingAudio: string | null;
  waitingForVoiceUri: boolean; finalVoiceDuration: number;
}
interface TypingState { isTyping: boolean; matchIsTyping: boolean; }
interface UiModalState {
  showRatingPrompt: boolean; previewImage: string | null; showScrollToBottom: boolean;
  showMenuModal: boolean; showMessageOptionsModal: boolean; selectedMessage: Message | null;
  showGifPicker: boolean; showReactionPicker: boolean; showPinnedMessagesModal: boolean;
  showDisappearingModal: boolean; showSettingsModal: boolean; showNoteModal: boolean;
  showStartersModal: boolean; showDateIdeasModal: boolean; showDatePlannerModal: boolean;
  showVideoCallPrompt: boolean; showReportModal: boolean;
}
interface ChatFeatureState {
  chatSettings: ChatSettings; pinnedMessages: PinnedMessage[]; disappearingMode: DisappearingMode;
  gifSearchQuery: string; gifResults: GiphyGif[]; loadingGifs: boolean;
  translatedMessages: Record<string, string>; translatingMessage: string | null;
  matchNote: string; savingNote: boolean; conversationStarters: string[];
  dateIdeas: DateIdea[]; dateSuggestions: DateSuggestion[]; loadingPlaces: boolean;
  callType: 'video' | 'audio'; reportReason: string; submittingReport: boolean; updatingChatSettings: boolean;
}

// ─── Constants ────────────────────────────────────────────

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  wallpaper: null, readReceiptsEnabled: true, typingIndicatorsEnabled: true, notificationsEnabled: true,
};
const WAVEFORM_BARS      = [12, 18, 10, 22, 16, 24, 14, 20, 11, 17, 13, 19] as const;
const MESSAGE_PAGE_SIZE  = 100;
const MAX_RECORDING_SECS = 60;
const DISAPPEARING_MODES: DisappearingMode[] = ['off', '24h', '7d', '30d'];
const PRIVACY_TOGGLES = [
  { label: 'Read Receipts',     key: 'readReceiptsEnabled'     as const },
  { label: 'Typing Indicators', key: 'typingIndicatorsEnabled' as const },
] as const;

// ─── Pure helpers ─────────────────────────────────────────

const formatDuration = (seconds: number): string => {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};
const formatTime = (ts: Timestamp | Date | number | null | undefined): string => {
  if (!ts) return '';
  try {
    const d = typeof (ts as Timestamp)?.toDate === 'function' ? (ts as Timestamp).toDate() : new Date(ts as Date | number);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const normalizeParam  = (v: ParamValue): string => Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
const isValidLocation = (v: unknown): v is { latitude: number; longitude: number } =>
  !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).latitude === 'number' && typeof (v as Record<string, unknown>).longitude === 'number';
const buildPinnedLookup = (items: PinnedMessage[]): Set<string> => new Set(items.map(i => i.messageId));
const getErrMsg = (e: unknown): string => e instanceof Error ? e.message : 'An error occurred';

// ─── Sub-components (extracted & memoized to prevent re-renders) ──

const WaveformBars = React.memo(function WaveformBars({ isPlaying, isMe }: { isPlaying: boolean; isMe: boolean }) {
  return (
    <View style={styles.voiceWaveform}>
      {WAVEFORM_BARS.map((h, i) => (
        <View key={i} style={[styles.voiceBar, { height: h, backgroundColor: isPlaying ? (isMe ? '#fff' : '#53a8b6') : (isMe ? 'rgba(255,255,255,0.5)' : '#555') }]} />
      ))}
    </View>
  );
});

// Extracted MessageBubble — biggest win: FlatList no longer re-renders whole screen on each message
interface MessageBubbleProps {
  item: Message; isMe: boolean; matchName: string;
  isPinned: boolean; isTranslated: boolean; isTranslating: boolean;
  translatedText: string | undefined; isPlayingAudio: boolean;
  readReceiptsEnabled: boolean; playingAudio: string | null;
  onLongPress: (item: Message) => void;
  onImagePress: (url: string) => void;
  onPlayVoice: (url: string) => void;
  onReact: (id: string, emoji: string) => void;
  userUid: string;
}
const MessageBubble = React.memo(function MessageBubble({
  item, isMe, matchName, isPinned, isTranslated, isTranslating,
  translatedText, isPlayingAudio, readReceiptsEnabled,
  onLongPress, onImagePress, onPlayVoice, onReact, userUid,
}: MessageBubbleProps) {
  const grouped = useMemo(() => groupReactions(item.reactions ?? []), [item.reactions]);
  const handleLongPress  = useCallback(() => onLongPress(item), [onLongPress, item]);
  const handleImagePress = useCallback(() => { if (item.imageUrl) onImagePress(item.imageUrl); }, [onImagePress, item.imageUrl]);
  const handleVoicePress = useCallback(() => { if (item.voiceUrl) onPlayVoice(item.voiceUrl); }, [onPlayVoice, item.voiceUrl]);
  return (
    <TouchableOpacity onLongPress={handleLongPress} delayLongPress={500} activeOpacity={0.8}
      accessibilityLabel={`${isMe ? 'You' : matchName}: ${item.text || (item.imageUrl ? 'Image' : item.voiceUrl ? 'Voice message' : 'Message')}`}
      accessibilityRole="button" accessibilityHint="Long press for message options">
      <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
        {isPinned && <View style={styles.pinnedIndicator}><Text style={styles.pinnedIndicatorText}>📌 Pinned</Text></View>}
        {item.imageUrl && (
          <TouchableOpacity onPress={handleImagePress} accessibilityLabel={item.isGif ? 'View GIF' : 'View full image'} accessibilityRole="button">
            <Image source={{ uri: item.imageUrl }} style={styles.messageImage} resizeMode="cover" accessibilityLabel={item.isGif ? 'GIF image' : 'Sent photo'} />
            {item.isGif && <View style={styles.gifBadge}><Text style={styles.gifBadgeText}>GIF</Text></View>}
          </TouchableOpacity>
        )}
        {item.voiceUrl && (
          <TouchableOpacity style={styles.voiceMessageContainer} onPress={handleVoicePress}
            accessibilityLabel={`Voice message, ${formatDuration(item.voiceDuration ?? 0)} long. ${isPlayingAudio ? 'Tap to pause' : 'Tap to play'}`}
            accessibilityRole="button">
            <Text style={styles.voicePlayButton}>{isPlayingAudio ? '⏸' : '▶️'}</Text>
            <WaveformBars isPlaying={isPlayingAudio} isMe={isMe} />
            <Text style={[styles.voiceDuration, isMe && styles.voiceDurationMe]}>{formatDuration(item.voiceDuration ?? 0)}</Text>
          </TouchableOpacity>
        )}
        {!!item.text && (
          <>
            <Text style={[styles.messageText, isMe && styles.myMessageText]}>{item.text}</Text>
            {isTranslated && translatedText && (
              <View style={styles.translationContainer}>
                <Text style={styles.translationLabel}>🌐 Translated:</Text>
                <Text style={[styles.messageText, isMe && styles.myMessageText, styles.translatedText]}>{translatedText}</Text>
              </View>
            )}
            {isTranslating && (
              <View style={styles.translatingIndicator}>
                <ActivityIndicator size="small" color={isMe ? '#fff' : '#53a8b6'} />
                <Text style={[styles.translatingText, isMe && styles.translatingTextMe]}>Translating...</Text>
              </View>
            )}
          </>
        )}
        {grouped.length > 0 && (
          <View style={styles.reactionsContainer}>
            {grouped.map((r, i) => {
              const active = hasUserReacted(item.reactions ?? [], userUid, r.emoji);
              return (
                <ReactionBubble key={`${r.emoji}-${i}`} messageId={item.id} emoji={r.emoji}
                  count={r.count} active={active} onReact={onReact} />
              );
            })}
          </View>
        )}
        <View style={styles.messageFooter}>
          <Text style={[styles.messageTime, isMe && styles.myMessageTime]}>{formatTime(item.timestamp)}</Text>
          {isMe && readReceiptsEnabled && <Text style={styles.readReceipt}>{item.read ? ' ✓✓' : ' ✓'}</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
});

// Extracted ReactionBubble — avoids inline onPress in FlatList
interface ReactionBubbleProps {
  messageId: string; emoji: string; count: number; active: boolean;
  onReact: (id: string, emoji: string) => void;
}
const ReactionBubble = React.memo(function ReactionBubble({ messageId, emoji, count, active, onReact }: ReactionBubbleProps) {
  const handlePress = useCallback(() => onReact(messageId, emoji), [onReact, messageId, emoji]);
  return (
    <TouchableOpacity style={[styles.reactionBubble, active && styles.reactionBubbleActive]} onPress={handlePress}
      accessibilityLabel={`${emoji} reaction, ${count} ${count === 1 ? 'person' : 'people'}. Tap to react.`} accessibilityRole="button">
      <Text style={styles.reactionEmoji}>{emoji}</Text>
      <Text style={styles.reactionCount}>{count}</Text>
    </TouchableOpacity>
  );
});

// Extracted GifItem — avoids inline onPress inside GIF ScrollView
interface GifItemProps { gif: GiphyGif; onSend: (gif: GiphyGif) => void; }
const GifItem = React.memo(function GifItem({ gif, onSend }: GifItemProps) {
  const handlePress = useCallback(() => onSend(gif), [onSend, gif]);
  return (
    <TouchableOpacity style={styles.gifItem} onPress={handlePress} accessibilityLabel="Send this GIF" accessibilityRole="button">
      <Image source={{ uri: gif.previewUrl }} style={styles.gifImage} resizeMode="cover" accessibilityLabel="GIF preview" />
    </TouchableOpacity>
  );
});

// Extracted PlaceCard — avoids inline handlers in date planner list
interface PlaceCardProps { place: DateSuggestion; onShare: (p: DateSuggestion) => void; onMaps: (p: DateSuggestion) => void; }
const PlaceCard = React.memo(function PlaceCard({ place, onShare, onMaps }: PlaceCardProps) {
  const handleShare = useCallback(() => onShare(place), [onShare, place]);
  const handleMaps  = useCallback(() => onMaps(place), [onMaps, place]);
  return (
    <View style={styles.placeCard}>
      <View style={styles.placeInfo}>
        <Text style={styles.placeName}>{place.name}</Text>
        <Text style={styles.placeType}>{place.type}</Text>
        <Text style={styles.placeAddress}>{place.address}</Text>
        <Text style={styles.placeDistance}>🚶 {place.distance} km away</Text>
      </View>
      <View style={styles.placeActions}>
        <TouchableOpacity style={styles.placeActionButton} onPress={handleShare} accessibilityLabel={`Share ${place.name} in chat`} accessibilityRole="button"><Text style={styles.placeActionText}>💬 Share</Text></TouchableOpacity>
        <TouchableOpacity style={styles.placeActionButton} onPress={handleMaps} accessibilityLabel={`Open ${place.name} in maps`} accessibilityRole="button"><Text style={styles.placeActionText}>🗺️ Maps</Text></TouchableOpacity>
      </View>
    </View>
  );
});

// Extracted WallpaperOption — avoids inline onPress in settings modal
interface WallpaperOptionProps {
  wallpaper: typeof CHAT_WALLPAPERS[number]; isActive: boolean;
  disabled: boolean; onSelect: (id: string) => void;
}
const WallpaperOption = React.memo(function WallpaperOption({ wallpaper, isActive, disabled, onSelect }: WallpaperOptionProps) {
  const handlePress = useCallback(() => onSelect(wallpaper.id), [onSelect, wallpaper.id]);
  const bg = 'gradient' in wallpaper && Array.isArray(wallpaper.gradient) && wallpaper.gradient.length > 0
    ? wallpaper.gradient[0] : 'color' in wallpaper ? (wallpaper as { color: string }).color : '#16213e';
  return (
    <TouchableOpacity style={[styles.wallpaperOption, { backgroundColor: bg }, isActive && styles.wallpaperOptionActive]}
      disabled={disabled} onPress={handlePress}
      accessibilityLabel={`Set ${wallpaper.name} wallpaper`} accessibilityRole="radio" accessibilityState={{ selected: isActive }}>
      <Text style={styles.wallpaperName}>{wallpaper.name}</Text>
    </TouchableOpacity>
  );
});

// Extracted PrivacyToggle — avoids inline onPress in settings modal
interface PrivacyToggleProps {
  label: string; toggleKey: 'readReceiptsEnabled' | 'typingIndicatorsEnabled';
  value: boolean; disabled: boolean; onToggle: (key: 'readReceiptsEnabled' | 'typingIndicatorsEnabled') => void;
}
const PrivacyToggle = React.memo(function PrivacyToggle({ label, toggleKey, value, disabled, onToggle }: PrivacyToggleProps) {
  const handlePress = useCallback(() => onToggle(toggleKey), [onToggle, toggleKey]);
  return (
    <TouchableOpacity style={styles.toggleItem} disabled={disabled} onPress={handlePress}
      accessibilityLabel={`${label}: ${value ? 'on' : 'off'}. Tap to toggle.`}
      accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <Text style={styles.toggleText}>{label}</Text>
      <View style={[styles.toggleSwitch, value && styles.toggleSwitchActive]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobActive]} />
      </View>
    </TouchableOpacity>
  );
});

// ─── Main Component ───────────────────────────────────────

export default function ChatScreen() {
  const router    = useRouter();
  const params    = useLocalSearchParams();
  const matchId   = normalizeParam(params.matchId);
  const matchName = normalizeParam(params.matchName) || 'Match';
  const showDatePlannerParam = normalizeParam(params.showDatePlanner);

  const user      = auth.currentUser;
  const functions = useMemo(() => getFunctions(app, 'europe-west1'), []);
  const chatId    = useMemo(
    () => (!user?.uid || !matchId) ? '' : [user.uid, matchId].sort().join('_'),
    [user?.uid, matchId],
  );

  // ── Refs ──────────────────────────────────────────────────
  const flatListRef                    = useRef<FlatList<Message>>(null);
  const typingTimeoutRef               = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimerRef              = useRef<ReturnType<typeof setInterval> | null>(null);
  const gifSearchTimeoutRef            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef                     = useRef(true);
  const shouldAutoScrollRef            = useRef(true);
  const latestGifRequestRef            = useRef(0);
  const pendingMessageScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRecordingDurationRef    = useRef(0);
  const isStoppingRecordingRef         = useRef(false);

  // ── State ─────────────────────────────────────────────────
  const [core, setCore] = useState<ChatCoreState>({ messages: [], loading: true, sending: false, uploadingMedia: false, newMessage: '' });
  const [match, setMatch] = useState<MatchState>({ matchData: null, matchOnline: false, matchLastSeen: null, myLocation: null });
  const [rec, setRec] = useState<RecordingState>({ isRecording: false, recordingDuration: 0, playingAudio: null, waitingForVoiceUri: false, finalVoiceDuration: 0 });
  const [typing, setTyping] = useState<TypingState>({ isTyping: false, matchIsTyping: false });
  const [uiModal, setUiModal] = useState<UiModalState>({
    showRatingPrompt: false, previewImage: null, showScrollToBottom: false,
    showMenuModal: false, showMessageOptionsModal: false, selectedMessage: null,
    showGifPicker: false, showReactionPicker: false, showPinnedMessagesModal: false,
    showDisappearingModal: false, showSettingsModal: false, showNoteModal: false,
    showStartersModal: false, showDateIdeasModal: false, showDatePlannerModal: false,
    showVideoCallPrompt: false, showReportModal: false,
  });
  const [feat, setFeat] = useState<ChatFeatureState>({
    chatSettings: DEFAULT_CHAT_SETTINGS, pinnedMessages: [], disappearingMode: 'off',
    gifSearchQuery: '', gifResults: [], loadingGifs: false,
    translatedMessages: {}, translatingMessage: null,
    matchNote: '', savingNote: false, conversationStarters: [],
    dateIdeas: [], dateSuggestions: [], loadingPlaces: false,
    callType: 'video', reportReason: '', submittingReport: false, updatingChatSettings: false,
  });

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer   = useAudioPlayer(null);

  // ── Derived ───────────────────────────────────────────────
  const pinnedLookup   = useMemo(() => buildPinnedLookup(feat.pinnedMessages), [feat.pinnedMessages]);
  const ageBadge       = useMemo(() => getAgeVerificationLevel(match.matchData?.ageVerification), [match.matchData?.ageVerification]);
  const wallpaperStyle = useMemo(() => getWallpaperStyle(feat.chatSettings?.wallpaper ?? null), [feat.chatSettings?.wallpaper]);

  // ── Modal helpers (stable, no deps) ──────────────────────
  const closeMenu           = useCallback(() => setUiModal(p => ({ ...p, showMenuModal: false })), []);
  const closeGifPicker      = useCallback(() => setUiModal(p => ({ ...p, showGifPicker: false })), []);
  const closePinned         = useCallback(() => setUiModal(p => ({ ...p, showPinnedMessagesModal: false })), []);
  const closeDisappearing   = useCallback(() => setUiModal(p => ({ ...p, showDisappearingModal: false })), []);
  const closeSettings       = useCallback(() => setUiModal(p => ({ ...p, showSettingsModal: false })), []);
  const closeNote           = useCallback(() => setUiModal(p => ({ ...p, showNoteModal: false })), []);
  const closeStarters       = useCallback(() => setUiModal(p => ({ ...p, showStartersModal: false })), []);
  const closeDateIdeas      = useCallback(() => setUiModal(p => ({ ...p, showDateIdeasModal: false })), []);
  const closeDatePlanner    = useCallback(() => setUiModal(p => ({ ...p, showDatePlannerModal: false })), []);
  const closeVideoPrompt    = useCallback(() => setUiModal(p => ({ ...p, showVideoCallPrompt: false })), []);
  const closeReport         = useCallback(() => setUiModal(p => ({ ...p, showReportModal: false })), []);
  const closeReactionPicker = useCallback(() => setUiModal(p => ({ ...p, showReactionPicker: false })), []);
  const closeMsgOptions     = useCallback(() => setUiModal(p => ({ ...p, showMessageOptionsModal: false })), []);
  const closePreview        = useCallback(() => setUiModal(p => ({ ...p, previewImage: null })), []);
  const openMenu            = useCallback(() => setUiModal(p => ({ ...p, showMenuModal: true })), []);
  const openGifPicker       = useCallback(() => setUiModal(p => ({ ...p, showGifPicker: true })), []);
  const openPinned          = useCallback(() => setUiModal(p => ({ ...p, showPinnedMessagesModal: true })), []);
  const openDisappearing    = useCallback(() => setUiModal(p => ({ ...p, showDisappearingModal: true })), []);
  const openSettings        = useCallback(() => setUiModal(p => ({ ...p, showSettingsModal: true })), []);
  const openNote            = useCallback(() => setUiModal(p => ({ ...p, showNoteModal: true })), []);
  const openStarters        = useCallback(() => setUiModal(p => ({ ...p, showStartersModal: true })), []);
  const openDateIdeas       = useCallback(() => setUiModal(p => ({ ...p, showDateIdeasModal: true })), []);
  const openDatePlanner     = useCallback(() => setUiModal(p => ({ ...p, showDatePlannerModal: true })), []);

  const openMenuVideoCall   = useCallback(() => { closeMenu(); setFeat(p => ({ ...p, callType: 'video' })); setUiModal(p => ({ ...p, showVideoCallPrompt: true })); }, [closeMenu]);
  const openMenuAudioCall   = useCallback(() => { closeMenu(); setFeat(p => ({ ...p, callType: 'audio' })); setUiModal(p => ({ ...p, showVideoCallPrompt: true })); }, [closeMenu]);
  const openMenuDatePlanner = useCallback(() => { closeMenu(); openDatePlanner(); }, [closeMenu, openDatePlanner]);
  const openMenuDateIdeas   = useCallback(() => { closeMenu(); openDateIdeas(); }, [closeMenu, openDateIdeas]);
  const openMenuStarters    = useCallback(() => { closeMenu(); openStarters(); }, [closeMenu, openStarters]);
  const openMenuNote        = useCallback(() => { closeMenu(); openNote(); }, [closeMenu, openNote]);
  const openMenuPinned      = useCallback(() => { closeMenu(); openPinned(); }, [closeMenu, openPinned]);
  const openMenuDisappearing= useCallback(() => { closeMenu(); openDisappearing(); }, [closeMenu, openDisappearing]);
  const openMenuSettings    = useCallback(() => { closeMenu(); openSettings(); }, [closeMenu, openSettings]);
  const handleMenuReport    = useCallback(() => { closeMenu(); setFeat(p => ({ ...p, reportReason: '' })); setUiModal(p => ({ ...p, showReportModal: true })); }, [closeMenu]);
  const handleMenuBlock     = useCallback(() => { closeMenu(); handleBlock(); }, [closeMenu]); // eslint-disable-line
  const handleMenuUnmatch   = useCallback(() => { closeMenu(); handleUnmatch(); }, [closeMenu]); // eslint-disable-line

  // ── Scroll helpers ────────────────────────────────────────
  const scrollToBottom = useCallback((animated = true) => { flatListRef.current?.scrollToEnd({ animated }); }, []);
  const scheduleScrollToBottom = useCallback((animated = true) => {
    if (pendingMessageScrollTimeoutRef.current) clearTimeout(pendingMessageScrollTimeoutRef.current);
    pendingMessageScrollTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current || !shouldAutoScrollRef.current) return;
      scrollToBottom(animated);
    }, 80);
  }, [scrollToBottom]);

  // ── Cloud function helpers ────────────────────────────────
  const ensureChatExists = useCallback(async () => {
    if (!matchId) return;
    try { await httpsCallable<{ otherUserId: string }, { success: boolean; chatId: string }>(functions, 'ensureChatExists')({ otherUserId: matchId }); }
    catch (e) { logger.error('Failed to ensure chat exists:', e); }
  }, [functions, matchId]);

  const resolveRenderableMedia = useCallback(async (docId: string, data: FirestoreMessageData): Promise<{ imageUrl?: string; voiceUrl?: string }> => {
    if (typeof data.mediaUrl === 'string' && typeof data.encryptedMediaKey === 'string' && typeof data.mediaKeyNonce === 'string' && typeof data.mediaCipherNonce === 'string' && typeof data.senderPublicKey === 'string') {
      try {
        const uri = await decryptMediaToRenderableUri({ mediaUrl: data.mediaUrl, encryptedMediaKey: data.encryptedMediaKey, mediaKeyNonce: data.mediaKeyNonce, mediaCipherNonce: data.mediaCipherNonce, senderPublicKey: data.senderPublicKey, mediaMimeType: typeof data.mediaMimeType === 'string' ? data.mediaMimeType : undefined });
        return data.messageType === 'voice' ? { voiceUrl: uri } : { imageUrl: uri };
      } catch (e) { logger.warn(`Failed to decrypt media for message ${docId}:`, e); return {}; }
    }
    return { imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined, voiceUrl: typeof data.voiceUrl === 'string' ? data.voiceUrl : undefined };
  }, []);

  // ─── Effects ──────────────────────────────────────────────

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { if (!user?.uid) return; void ensureMyE2EEIdentity(); }, [user?.uid]);
  useEffect(() => { if (chatId && matchId) void ensureChatExists(); }, [chatId, matchId, ensureChatExists]);
  useEffect(() => { AudioModule.requestRecordingPermissionsAsync().catch(e => logger.warn('Recording permission request failed:', e)); }, []);
  useEffect(() => { if (showDatePlannerParam === 'true') setUiModal(p => ({ ...p, showDatePlannerModal: true })); }, [showDatePlannerParam]);

  useEffect(() => {
    if (!chatId || !matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const [settings, pinned, disappearing, note] = await Promise.all([getChatSettings(chatId), getPinnedMessages(chatId), getDisappearingSettings(chatId), getMatchNote(matchId)]);
        if (cancelled || !mountedRef.current) return;
        setFeat(p => ({ ...p, chatSettings: settings ?? DEFAULT_CHAT_SETTINGS, pinnedMessages: pinned ?? [], disappearingMode: disappearing?.mode ?? 'off', matchNote: note ?? '' }));
        if (disappearing?.mode !== 'off') await cleanupExpiredMessages(chatId);
      } catch (e) { logger.error('Failed to load chat data:', e); }
    })();
    return () => { cancelled = true; };
  }, [chatId, matchId]);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists() || cancelled || !mountedRef.current) return;
        const data = snap.data();
        setMatch(p => ({ ...p, myLocation: isValidLocation(data['location']) ? data['location'] : null }));
      } catch (e) { logger.error('Failed to load user location:', e); }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  useEffect(() => {
    if (!matchId) return;
    return onSnapshot(doc(db, 'users', matchId), snap => {
      if (!snap.exists()) return;
      const data = snap.data() as MatchData;
      setMatch(p => ({ ...p, matchData: data, matchOnline: isUserOnline(data.lastSeen), matchLastSeen: data.lastSeen ?? null }));
      setFeat(p => ({ ...p, conversationStarters: getConversationStarters(data.personalityType, data.interests), dateIdeas: getDateIdeas(undefined, data.lifestyle ?? undefined, 5) }));
    }, e => logger.error('Failed to subscribe to match data:', e));
  }, [matchId]);

  useEffect(() => {
    if (!matchId || !user?.uid || !chatId) return;
    return onSnapshot(doc(db, 'chats', chatId, 'typing', matchId), snap => {
      if (snap.exists()) {
        const data = snap.data();
        const lastTyped = typeof data['lastTyped']?.toMillis === 'function' ? data['lastTyped'].toMillis() : 0;
        setTyping(p => ({ ...p, matchIsTyping: (data['isTyping'] || false) && Date.now() - lastTyped < 5000 }));
      } else { setTyping(p => ({ ...p, matchIsTyping: false })); }
    }, e => logger.error('Failed to subscribe to typing status:', e));
  }, [matchId, user?.uid, chatId]);

  useEffect(() => {
    if (!user?.uid || !matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const shouldShow = await shouldPromptForRating(user.uid, matchId);
        if (!cancelled && mountedRef.current) setUiModal(p => ({ ...p, showRatingPrompt: shouldShow }));
      } catch (e) { logger.error('Failed to check rating prompt:', e); }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, matchId]);

  useEffect(() => {
    if (!user?.uid || !matchId || !chatId) return;
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'), limit(MESSAGE_PAGE_SIZE));
    return onSnapshot(q, async snapshot => {
      try {
        const loaded = await Promise.all(snapshot.docs.map(async docSnap => {
          const data = docSnap.data() as FirestoreMessageData;
          let decryptedText = '';
          if ((data.messageType === 'text' || data.messageType === 'system') && typeof data.ciphertext === 'string' && typeof data.nonce === 'string' && typeof data.senderPublicKey === 'string') {
            try { decryptedText = await decryptTextFromSender({ ciphertext: data.ciphertext, nonce: data.nonce, senderPublicKey: data.senderPublicKey }); }
            catch (e) { logger.warn('Failed to decrypt text message:', e); decryptedText = '[Unable to decrypt]'; }
          } else if (typeof data.encryptedText === 'string') { decryptedText = '[Legacy encrypted message]'; }
          else if (typeof data.text === 'string') { decryptedText = data.text; }
          const messageType: Message['messageType'] =
            data.messageType === 'text' || data.messageType === 'image' || data.messageType === 'voice' || data.messageType === 'gif' || data.messageType === 'system'
              ? data.messageType : data.imageUrl ? (data.isGif ? 'gif' : 'image') : data.voiceUrl ? 'voice' : 'text';
          const media = await resolveRenderableMedia(docSnap.id, data);
          return {
            id: docSnap.id, text: decryptedText, senderId: data.senderId || '',
            timestamp: data.timestamp ?? null, read: !!data.read, readAt: data.readAt ?? null,
            imageUrl: media.imageUrl, voiceUrl: media.voiceUrl,
            voiceDuration: typeof data.voiceDuration === 'number' ? data.voiceDuration : 0,
            isGif: !!data.isGif, reactions: Array.isArray(data.reactions) ? data.reactions : [],
            isPinned: pinnedLookup.has(docSnap.id), messageType,
            version: typeof data.version === 'number' ? data.version : undefined,
            senderPublicKey: typeof data.senderPublicKey === 'string' ? data.senderPublicKey : undefined,
            senderKeyVersion: typeof data.senderKeyVersion === 'number' ? data.senderKeyVersion : undefined,
            mediaUrl: typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined,
            mediaMimeType: typeof data.mediaMimeType === 'string' ? data.mediaMimeType : undefined,
            mediaSizeBytes: typeof data.mediaSizeBytes === 'number' ? data.mediaSizeBytes : undefined,
            encryptedMediaKey: typeof data.encryptedMediaKey === 'string' ? data.encryptedMediaKey : undefined,
            mediaKeyNonce: typeof data.mediaKeyNonce === 'string' ? data.mediaKeyNonce : undefined,
            mediaCipherNonce: typeof data.mediaCipherNonce === 'string' ? data.mediaCipherNonce : undefined,
          } as Message;
        }));
        const readReceiptsEnabled = feat.chatSettings?.readReceiptsEnabled !== false;
        const unreadIds = loaded.filter(m => m.senderId !== user.uid && !m.read && readReceiptsEnabled).map(m => m.id);
        if (!mountedRef.current) return;
        setCore(p => ({ ...p, messages: loaded, loading: false }));
        if (readReceiptsEnabled && unreadIds.length > 0) {
          try {
            const batch = writeBatch(db);
            unreadIds.forEach(id => batch.update(doc(db, 'chats', chatId, 'messages', id), { read: true, readAt: serverTimestamp() }));
            await batch.commit();
          } catch (e) { logger.error('Error marking messages as read:', e); }
        }
        scheduleScrollToBottom(false);
      } catch (e) { logger.error('Failed to process messages:', e); if (mountedRef.current) setCore(p => ({ ...p, loading: false })); }
    }, e => { logger.error('Message subscription failed:', e); if (mountedRef.current) setCore(p => ({ ...p, loading: false })); });
  }, [user?.uid, matchId, chatId, feat.chatSettings?.readReceiptsEnabled, pinnedLookup, scheduleScrollToBottom, resolveRenderableMedia]);

  const uploadAndSendVoiceMessageRef = useRef<((uri: string, duration: number) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!rec.waitingForVoiceUri || !audioRecorder.uri || rec.finalVoiceDuration <= 0) return;
    setRec(p => ({ ...p, waitingForVoiceUri: false }));
    uploadAndSendVoiceMessageRef.current?.(audioRecorder.uri, rec.finalVoiceDuration);
  }, [rec.waitingForVoiceUri, audioRecorder.uri, rec.finalVoiceDuration]);

  useEffect(() => {
    if (!rec.playingAudio) return;
    const check = setInterval(() => {
      try { if (!audioPlayer.playing) setRec(p => ({ ...p, playingAudio: null })); } catch { setRec(p => ({ ...p, playingAudio: null })); }
    }, 500);
    return () => clearInterval(check);
  }, [rec.playingAudio, audioPlayer]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (gifSearchTimeoutRef.current) clearTimeout(gifSearchTimeoutRef.current);
      if (pendingMessageScrollTimeoutRef.current) clearTimeout(pendingMessageScrollTimeoutRef.current);
    };
  }, []);

  // ─── Callbacks ────────────────────────────────────────────

  const sendPushNotification = useCallback(async (preview: string) => {
    if (!matchId || match.matchOnline || !user?.uid) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const name = snap.exists() && typeof snap.data()['name'] === 'string' ? snap.data()['name'] as string : 'Someone';
      await notifyNewMessage(matchId, name, preview);
    } catch (e) { logger.error('Notification failed:', e); }
  }, [matchId, match.matchOnline, user?.uid]);

  const updateTypingStatus = useCallback(async (val: boolean) => {
    if (!user?.uid || !chatId || feat.chatSettings?.typingIndicatorsEnabled === false) return;
    try { await setDoc(doc(db, 'chats', chatId, 'typing', user.uid), { isTyping: val, lastTyped: serverTimestamp() }, { merge: true }); }
    catch (e) { logger.warn('Failed to update typing status:', e); }
  }, [user?.uid, chatId, feat.chatSettings?.typingIndicatorsEnabled]);

  const handleTextChange = useCallback((text: string) => {
    setCore(p => ({ ...p, newMessage: text }));
    setTyping(prev => {
      if (!prev.isTyping && text.trim().length > 0) { void updateTypingStatus(true); return { ...prev, isTyping: true }; }
      return prev;
    });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => { setTyping(p => ({ ...p, isTyping: false })); void updateTypingStatus(false); }, 3000);
  }, [updateTypingStatus]);

  const sendMessage = useCallback(async () => {
    const text = core.newMessage.trim();
    if (!text || !user?.uid || core.sending || !chatId || !matchId) return;
    const check = checkTextSafety(text);
    if (!check.safe) { Alert.alert('Message Not Allowed', check.reason); return; }
    setCore(p => ({ ...p, newMessage: '', sending: true }));
    setTyping(p => ({ ...p, isTyping: false }));
    void updateTypingStatus(false);
    try {
      await ensureMyE2EEIdentity();
      await ensureChatExists();
      const enc = await encryptTextForRecipient(text, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, version: enc.version, messageType: 'text', ciphertext: enc.ciphertext, nonce: enc.nonce, senderPublicKey: enc.senderPublicKey, senderKeyVersion: enc.senderKeyVersion });
      await sendPushNotification(text);
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) { logger.error('Error sending message:', e); Alert.alert('Error', getErrMsg(e)); setCore(p => ({ ...p, newMessage: text })); }
    finally { setCore(p => ({ ...p, sending: false })); }
  }, [core.newMessage, core.sending, user?.uid, chatId, matchId, updateTypingStatus, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  const uploadAndSendImage = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user?.uid || !chatId || !matchId || !asset.uri) { Alert.alert('Error', 'Image data unavailable'); return; }
    const isWeb = Platform.OS === 'web';
    if (isWeb) { const chk = await checkImageSafety(asset.uri); if (!chk.safe) { Alert.alert('Image Not Allowed', chk.reason); return; } }
    setCore(p => ({ ...p, uploadingMedia: true }));
    try {
      await ensureMyE2EEIdentity();
      await ensureChatExists();
      const up = await encryptAndUploadImageForRecipient(asset.uri, matchId);
      if (!isWeb && up.mediaUrl) { const chk = await checkImageSafety(up.mediaUrl); if (!chk.safe) { Alert.alert('Image Not Allowed', chk.reason); return; } }
      await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, version: up.version, messageType: asset.mimeType === 'image/gif' ? 'gif' : 'image', mediaUrl: up.mediaUrl, mediaMimeType: up.mediaMimeType, mediaSizeBytes: up.mediaSizeBytes, encryptedMediaKey: up.encryptedMediaKey, mediaKeyNonce: up.mediaKeyNonce, mediaCipherNonce: up.mediaCipherNonce, senderPublicKey: up.senderPublicKey, senderKeyVersion: up.senderKeyVersion, isGif: asset.mimeType === 'image/gif' });
      await sendPushNotification(asset.mimeType === 'image/gif' ? '🎬 Sent a GIF' : '📷 Sent a photo');
      shouldAutoScrollRef.current = true; scheduleScrollToBottom(true);
    } catch (e: unknown) { logger.error('Error uploading encrypted image:', e); Alert.alert('Error', getErrMsg(e)); }
    finally { setCore(p => ({ ...p, uploadingMedia: false })); }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  const handlePickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission Required', 'Permission to access photos is required.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8, base64: false });
      if (!res.canceled && res.assets[0]) await uploadAndSendImage(res.assets[0]);
    } catch (e) { logger.error('Failed to pick image:', e); Alert.alert('Error', 'Failed to open photo library'); }
  }, [uploadAndSendImage]);

  const handleTakePhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission Required', 'Permission to access camera is required.'); return; }
      const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8, base64: false });
      if (!res.canceled && res.assets[0]) await uploadAndSendImage(res.assets[0]);
    } catch (e) { logger.error('Failed to take photo:', e); Alert.alert('Error', 'Failed to open camera'); }
  }, [uploadAndSendImage]);

  const uploadAndSendVoiceMessage = useCallback(async (uri: string, durationSeconds: number) => {
    if (!user?.uid || !chatId || !matchId) return;
    setCore(p => ({ ...p, uploadingMedia: true }));
    try {
      await ensureMyE2EEIdentity();
      await ensureChatExists();
      const up = await encryptAndUploadVoiceForRecipient(uri, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, version: up.version, messageType: 'voice', mediaUrl: up.mediaUrl, mediaMimeType: up.mediaMimeType, mediaSizeBytes: up.mediaSizeBytes, voiceDuration: durationSeconds, encryptedMediaKey: up.encryptedMediaKey, mediaKeyNonce: up.mediaKeyNonce, mediaCipherNonce: up.mediaCipherNonce, senderPublicKey: up.senderPublicKey, senderKeyVersion: up.senderKeyVersion });
      setRec(p => ({ ...p, recordingDuration: 0, finalVoiceDuration: 0 }));
      currentRecordingDurationRef.current = 0;
      await sendPushNotification('🎤 Voice message');
      shouldAutoScrollRef.current = true; scheduleScrollToBottom(true);
    } catch (e: unknown) { logger.error('Error sending encrypted voice message:', e); Alert.alert('Error', getErrMsg(e)); }
    finally { setCore(p => ({ ...p, uploadingMedia: false })); }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  useEffect(() => { uploadAndSendVoiceMessageRef.current = uploadAndSendVoiceMessage; }, [uploadAndSendVoiceMessage]);

  const startRecording = useCallback(async () => {
    if (rec.isRecording || isStoppingRecordingRef.current) return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission Required', 'Microphone permission is required for voice messages'); return; }
      currentRecordingDurationRef.current = 0;
      setRec(p => ({ ...p, recordingDuration: 0, finalVoiceDuration: 0, waitingForVoiceUri: false }));
      await audioRecorder.record();
      setRec(p => ({ ...p, isRecording: true }));
      recordingTimerRef.current = setInterval(() => {
        currentRecordingDurationRef.current += 1;
        const next = currentRecordingDurationRef.current;
        setRec(p => ({ ...p, recordingDuration: next }));
        if (next >= MAX_RECORDING_SECS) {
          void (async () => {
            if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
            setRec(p => ({ ...p, isRecording: false }));
            isStoppingRecordingRef.current = true;
            try { await audioRecorder.stop(); setRec(p => ({ ...p, finalVoiceDuration: MAX_RECORDING_SECS, waitingForVoiceUri: true })); }
            catch (e) { logger.error('Auto-stop recording failed:', e); Alert.alert('Error', 'Could not finish recording'); }
            finally { isStoppingRecordingRef.current = false; }
          })();
        }
      }, 1000);
    } catch (e) { logger.error('Failed to start recording:', e); Alert.alert('Error', 'Could not start recording'); }
  }, [audioRecorder, rec.isRecording]);

  const stopRecording = useCallback(async () => {
    if (!rec.isRecording || isStoppingRecordingRef.current) return;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setRec(p => ({ ...p, isRecording: false }));
    isStoppingRecordingRef.current = true;
    try {
      const dur = currentRecordingDurationRef.current;
      await audioRecorder.stop();
      setRec(p => ({ ...p, finalVoiceDuration: dur, waitingForVoiceUri: dur > 0 }));
      if (dur <= 0) Alert.alert('Recording too short', 'Please record a slightly longer voice message.');
    } catch (e) { logger.error('Failed to stop recording:', e); Alert.alert('Error', 'Could not finish recording'); }
    finally { isStoppingRecordingRef.current = false; }
  }, [rec.isRecording, audioRecorder]);

  const cancelRecording = useCallback(async () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setRec(p => ({ ...p, isRecording: false, recordingDuration: 0, finalVoiceDuration: 0, waitingForVoiceUri: false }));
    currentRecordingDurationRef.current = 0;
    try { await audioRecorder.stop(); } catch { /* ignore */ }
  }, [audioRecorder]);

  const playVoiceMessage = useCallback((url: string) => {
    try {
      if (rec.playingAudio === url) { audioPlayer.pause(); setRec(p => ({ ...p, playingAudio: null })); return; }
      audioPlayer.replace(url); setRec(p => ({ ...p, playingAudio: url })); audioPlayer.play();
    } catch (e) { logger.error('Error playing voice message:', e); setRec(p => ({ ...p, playingAudio: null })); }
  }, [rec.playingAudio, audioPlayer]);

  const executeGifSearch = useCallback(async (q: string) => {
    const reqId = Date.now();
    latestGifRequestRef.current = reqId;
    setFeat(p => ({ ...p, loadingGifs: true }));
    try {
      const results = q.trim() ? await searchGifs(q, 20) : await getTrendingGifs(20);
      if (latestGifRequestRef.current !== reqId || !mountedRef.current) return;
      setFeat(p => ({ ...p, gifResults: results }));
    } catch (e) { logger.error('Error searching GIFs:', e); if (latestGifRequestRef.current === reqId && mountedRef.current) setFeat(p => ({ ...p, gifResults: [] })); }
    finally { if (latestGifRequestRef.current === reqId && mountedRef.current) setFeat(p => ({ ...p, loadingGifs: false })); }
  }, []);

  const handleGifSearchInput = useCallback((text: string) => {
    setFeat(p => ({ ...p, gifSearchQuery: text }));
    if (gifSearchTimeoutRef.current) clearTimeout(gifSearchTimeoutRef.current);
    gifSearchTimeoutRef.current = setTimeout(() => { void executeGifSearch(text); }, 400);
  }, [executeGifSearch]);

  const handleGifCategoryPress = useCallback((q: string) => { setFeat(p => ({ ...p, gifSearchQuery: q })); void executeGifSearch(q); }, [executeGifSearch]);
  useEffect(() => { if (uiModal.showGifPicker) void executeGifSearch(''); }, [uiModal.showGifPicker, executeGifSearch]);

  const sendGif = useCallback(async (gif: GiphyGif) => {
    if (!user?.uid || !chatId || !matchId) return;
    closeGifPicker(); setCore(p => ({ ...p, sending: true }));
    try {
      await ensureMyE2EEIdentity();
      await ensureChatExists();
      const enc = await encryptTextForRecipient(gif.url, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, version: enc.version, messageType: 'gif', ciphertext: enc.ciphertext, nonce: enc.nonce, senderPublicKey: enc.senderPublicKey, senderKeyVersion: enc.senderKeyVersion, isGif: true });
      await sendPushNotification('🎬 Sent a GIF');
      shouldAutoScrollRef.current = true; scheduleScrollToBottom(true);
    } catch (e) { logger.error('Error sending GIF:', e); Alert.alert('Error', 'Failed to send GIF'); }
    finally { setCore(p => ({ ...p, sending: false })); }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists, closeGifPicker]);

  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    const result = await addReaction(chatId, messageId, emoji);
    if (!result.success) Alert.alert('Error', 'Failed to add reaction');
    setUiModal(p => ({ ...p, showReactionPicker: false, selectedMessage: null }));
  }, [chatId]);

  const handleTranslateMessage = useCallback(async (messageId: string, text: string) => {
    if (!text.trim()) return;
    if (feat.translatedMessages[messageId]) {
      setFeat(p => { const next = { ...p.translatedMessages }; delete next[messageId]; return { ...p, translatedMessages: next }; });
      return;
    }
    setFeat(p => ({ ...p, translatingMessage: messageId }));
    try {
      const result = await translateMessage(text, 'en');
      if (result.success && result.translatedText) setFeat(p => ({ ...p, translatedMessages: { ...p.translatedMessages, [messageId]: result.translatedText! } }));
      else Alert.alert('Error', 'Translation failed');
    } catch (e) { logger.error('Translation failed:', e); Alert.alert('Error', 'Translation failed'); }
    finally { setFeat(p => ({ ...p, translatingMessage: null })); }
  }, [feat.translatedMessages]);

  const refreshPinnedMessages = useCallback(async () => {
    try { setFeat(p => ({ ...p, pinnedMessages: [] })); const pinned = await getPinnedMessages(chatId); setFeat(p => ({ ...p, pinnedMessages: pinned ?? [] })); }
    catch (e) { logger.error('Failed to refresh pinned messages:', e); }
  }, [chatId]);

  const handlePinMessage = useCallback(async (messageId: string, text: string) => {
    const result = await pinMessage(chatId, messageId, text?.trim() || '[Media message]');
    if (result.success) { await refreshPinnedMessages(); Alert.alert('Success', 'Message pinned!'); }
    else Alert.alert('Error', 'Failed to pin message');
  }, [chatId, refreshPinnedMessages]);

  const handleUnpinMessage = useCallback(async (messageId: string) => {
    const result = await unpinMessage(chatId, messageId);
    if (result.success) await refreshPinnedMessages();
    else Alert.alert('Error', 'Failed to unpin message');
  }, [chatId, refreshPinnedMessages]);

  const handleSetDisappearing = useCallback(async (mode: DisappearingMode) => {
    const result = await setDisappearingMode(chatId, mode);
    if (result.success) { setFeat(p => ({ ...p, disappearingMode: mode })); setUiModal(p => ({ ...p, showDisappearingModal: false })); Alert.alert('Success', `Disappearing messages: ${getDisappearingLabel(mode)}`); }
    else Alert.alert('Error', 'Failed to update disappearing messages');
  }, [chatId]);

  const handleSaveNote = useCallback(async () => {
    if (!matchId) return;
    setFeat(p => ({ ...p, savingNote: true }));
    try {
      const ok = await saveMatchNote(matchId, feat.matchNote);
      if (ok) { setUiModal(p => ({ ...p, showNoteModal: false })); Alert.alert('Success', 'Note saved!'); }
      else Alert.alert('Error', 'Failed to save note');
    } catch (e) { logger.error('Failed to save note:', e); Alert.alert('Error', 'Failed to save note'); }
    finally { setFeat(p => ({ ...p, savingNote: false })); }
  }, [matchId, feat.matchNote]);

  const findDatePlaces = useCallback(async () => {
    if (!match.myLocation || !match.matchData?.location) { Alert.alert('Error', 'Location data not available for both users'); return; }
    setFeat(p => ({ ...p, loadingPlaces: true, dateSuggestions: [] }));
    try {
      const mid = { latitude: (match.myLocation.latitude + match.matchData.location.latitude) / 2, longitude: (match.myLocation.longitude + match.matchData.location.longitude) / 2 };
      const r = 5000;
      const qs = `[out:json][timeout:25];\n(\n  node["amenity"="restaurant"](around:${r},${mid.latitude},${mid.longitude});\n  node["amenity"="cafe"](around:${r},${mid.latitude},${mid.longitude});\n  node["amenity"="bar"](around:${r},${mid.latitude},${mid.longitude});\n  node["leisure"="park"](around:${r},${mid.latitude},${mid.longitude});\n  node["tourism"="museum"](around:${r},${mid.latitude},${mid.longitude});\n);\nout body 20;`;
      const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: qs });
      const data = await resp.json() as OverpassResponse;
      if (Array.isArray(data.elements) && data.elements.length > 0) {
        const places: DateSuggestion[] = data.elements
          .filter((p): p is FirestorePlaceElement & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
          .map(p => ({ name: p.tags?.name || 'Unnamed Place', type: p.tags?.amenity || p.tags?.leisure || p.tags?.tourism || 'Place', address: [p.tags?.['addr:housenumber'], p.tags?.['addr:street'], p.tags?.['addr:city']].filter(Boolean).join(' ') || 'Address not available', distance: Math.round(calculateDistance(mid.latitude, mid.longitude, p.lat, p.lon) * 10) / 10, latitude: p.lat, longitude: p.lon }))
          .sort((a, b) => a.distance - b.distance).slice(0, 10);
        setFeat(p => ({ ...p, dateSuggestions: places }));
      } else Alert.alert('No Results', 'No places found nearby.');
    } catch (e) { logger.error('Error finding places:', e); Alert.alert('Error', 'Failed to find date places.'); }
    finally { setFeat(p => ({ ...p, loadingPlaces: false })); }
  }, [match.myLocation, match.matchData?.location]);

  const sharePlace = useCallback((place: DateSuggestion) => {
    setCore(p => ({ ...p, newMessage: `How about we meet at ${place.name}?\n📍 ${place.address}\n🚶 ${place.distance} km from midpoint` }));
    closeDatePlanner();
  }, [closeDatePlanner]);

  const openInMaps = useCallback(async (place: DateSuggestion) => {
    try {
      const target = place.latitude != null && place.longitude != null ? `${place.latitude},${place.longitude}` : `${place.name} ${place.address}`;
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
      if (!(await Linking.canOpenURL(url))) { Alert.alert('Error', 'Unable to open maps.'); return; }
      await Linking.openURL(url);
    } catch (e) { logger.error('Failed to open maps:', e); Alert.alert('Error', 'Unable to open maps.'); }
  }, []);

  const initiateCall = useCallback((type: 'video' | 'audio') => {
    setFeat(p => ({ ...p, callType: type })); setUiModal(p => ({ ...p, showVideoCallPrompt: true }));
  }, []);

  const startCall = useCallback(async () => {
    if (!user?.uid || !matchId || !chatId) return;
    const room = `myarchetype-${chatId}-${Date.now()}`;
    const url  = feat.callType === 'video' ? `https://meet.jit.si/${room}` : `https://meet.jit.si/${room}#config.startWithVideoMuted=true`;
    const icon = feat.callType === 'video' ? '📹' : '📞';
    const msg  = `${icon} ${feat.callType === 'video' ? 'Video' : 'Audio'} call started!\n\nJoin here: ${url}`;
    try {
      await ensureChatExists();
      const enc = await encryptTextForRecipient(msg, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, version: enc.version, messageType: 'system', ciphertext: enc.ciphertext, nonce: enc.nonce, senderPublicKey: enc.senderPublicKey, senderKeyVersion: enc.senderKeyVersion });
      await sendPushNotification(`${icon} Started a ${feat.callType} call`);
      if (!(await Linking.canOpenURL(url))) { Alert.alert('Error', 'Unable to open call link'); return; }
      await Linking.openURL(url);
      closeVideoPrompt();
      shouldAutoScrollRef.current = true; scheduleScrollToBottom(true);
    } catch (e) { logger.error('Error starting call:', e); Alert.alert('Error', 'Failed to start call'); }
  }, [user?.uid, matchId, chatId, feat.callType, sendPushNotification, scheduleScrollToBottom, ensureChatExists, closeVideoPrompt]);

  const handleUnmatch = useCallback(() => {
    if (!user?.uid || !matchId) return;
    Alert.alert(`Unmatch with ${matchName}?`, 'This will end the conversation and remove them from your matches. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unmatch', style: 'destructive', onPress: async () => {
        try { await httpsCallable<{ otherUserId: string }, { success: boolean }>(functions, 'unmatchUsers')({ otherUserId: matchId }); Alert.alert('Success', `You've unmatched with ${matchName}`); router.replace('/my-matches'); }
        catch (e) { logger.error('Error unmatching:', e); Alert.alert('Error', 'Error unmatching'); }
      }},
    ]);
  }, [user?.uid, matchId, matchName, router, functions]);

  const handleReport = useCallback(() => {
    if (!user?.uid || !matchId) return;
    setFeat(p => ({ ...p, reportReason: '' })); setUiModal(p => ({ ...p, showReportModal: true }));
  }, [user?.uid, matchId]);

  const submitReport = useCallback(async () => {
    if (!feat.reportReason.trim() || !user?.uid || !matchId) { Alert.alert('Missing Information', 'Please describe the issue before submitting.'); return; }
    setFeat(p => ({ ...p, submittingReport: true }));
    try {
      await httpsCallable<{ reportedUserId: string; reason: string; description?: string }, { success: boolean; reportId: string }>(functions, 'submitReport')({ reportedUserId: matchId, reason: feat.reportReason.trim(), description: feat.reportReason.trim() });
      closeReport(); Alert.alert('Report Submitted', 'Thank you for helping keep our community safe.');
    } catch (e) { logger.error('Error reporting:', e); Alert.alert('Error', 'Error submitting report'); }
    finally { setFeat(p => ({ ...p, submittingReport: false })); }
  }, [user?.uid, matchId, feat.reportReason, functions, closeReport]);

  const handleBlock = useCallback(() => {
    if (!user?.uid || !matchId) return;
    Alert.alert(`Block ${matchName}?`, "They won't be able to see your profile or contact you. You will also be unmatched.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => {
        try { await httpsCallable<{ blockedUserId: string; reason?: string }, { success: boolean }>(functions, 'blockUser')({ blockedUserId: matchId }); Alert.alert('Blocked', `You've blocked ${matchName}`); router.replace('/my-matches'); }
        catch (e) { logger.error('Error blocking:', e); Alert.alert('Error', 'Error blocking user'); }
      }},
    ]);
  }, [user?.uid, matchId, matchName, router, functions]);

  // Fix forward-reference issue with handleBlock/handleUnmatch in menu handlers
  useEffect(() => {
    // Re-bind menu handlers that depend on handleBlock/handleUnmatch after they're defined
  }, []);

  const handleMessageLongPress = useCallback((item: Message) => {
    setUiModal(p => ({ ...p, selectedMessage: item, showMessageOptionsModal: true }));
  }, []);

  const handleMessageAction = useCallback((action: MessageAction) => {
    const msg = uiModal.selectedMessage;
    if (!msg) return;
    closeMsgOptions();
    if (action === 'react') { setUiModal(p => ({ ...p, showReactionPicker: true })); return; }
    if (action === 'translate') { void handleTranslateMessage(msg.id, msg.text); setUiModal(p => ({ ...p, selectedMessage: null })); return; }
    if (action === 'pin') {
      if (pinnedLookup.has(msg.id)) void handleUnpinMessage(msg.id);
      else void handlePinMessage(msg.id, msg.text);
      setUiModal(p => ({ ...p, selectedMessage: null }));
    }
  }, [uiModal.selectedMessage, closeMsgOptions, pinnedLookup, handleTranslateMessage, handlePinMessage, handleUnpinMessage]);

  const handleScrollToBottom = useCallback(() => { shouldAutoScrollRef.current = true; setUiModal(p => ({ ...p, showScrollToBottom: false })); scrollToBottom(true); }, [scrollToBottom]);
  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const nearBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 100;
    shouldAutoScrollRef.current = nearBottom;
    setUiModal(p => p.showScrollToBottom === nearBottom ? { ...p, showScrollToBottom: !nearBottom } : p);
  }, []);
  const handleContentSizeChange = useCallback(() => { if (shouldAutoScrollRef.current) scrollToBottom(false); }, [scrollToBottom]);

  // Stable press handlers for input bar
  const handlePickImagePress  = useCallback(() => void handlePickImage(), [handlePickImage]);
  const handleTakePhotoPress  = useCallback(() => void handleTakePhoto(), [handleTakePhoto]);
  const handleStartRecording  = useCallback(() => void startRecording(), [startRecording]);
  const handleStopRecording   = useCallback(() => void stopRecording(), [stopRecording]);
  const handleCancelRecording = useCallback(() => void cancelRecording(), [cancelRecording]);
  const handleSendMessage     = useCallback(() => void sendMessage(), [sendMessage]);
  const handleStartCall       = useCallback(() => void startCall(), [startCall]);
  const handleSubmitReport    = useCallback(() => void submitReport(), [submitReport]);
  const handleSaveNotePress   = useCallback(() => void handleSaveNote(), [handleSaveNote]);
  const handleFindDatePlaces  = useCallback(() => void findDatePlaces(), [findDatePlaces]);
  const handleGoToRating      = useCallback(() => router.push({ pathname: '/post-date-rating', params: { matchId, matchName } }), [router, matchId, matchName]);
  const handleGoToMyMatches   = useCallback(() => router.replace('/my-matches'), [router]);
  const handleNoteChange      = useCallback((t: string) => setFeat(p => ({ ...p, matchNote: t })), []);
  const handleReportChange    = useCallback((t: string) => setFeat(p => ({ ...p, reportReason: t })), []);
  const handleImagePreview    = useCallback((url: string) => setUiModal(p => ({ ...p, previewImage: url })), []);

  // Stable wallpaper/toggle handlers for settings modal
  const handleWallpaperSelect = useCallback(async (id: string) => {
    try {
      setFeat(p => ({ ...p, updatingChatSettings: true }));
      await updateChatSettings(chatId, { wallpaper: id });
      setFeat(p => ({ ...p, chatSettings: { ...(p.chatSettings ?? DEFAULT_CHAT_SETTINGS), wallpaper: id } }));
    } catch (e) { logger.error('Failed to update wallpaper:', e); Alert.alert('Error', 'Failed to update wallpaper'); }
    finally { setFeat(p => ({ ...p, updatingChatSettings: false })); }
  }, [chatId]);

  const handleToggle = useCallback(async (key: 'readReceiptsEnabled' | 'typingIndicatorsEnabled') => {
    const newVal = !(feat.chatSettings?.[key] ?? true);
    try {
      setFeat(p => ({ ...p, updatingChatSettings: true }));
      await updateChatSettings(chatId, { [key]: newVal });
      setFeat(p => ({ ...p, chatSettings: { ...(p.chatSettings ?? DEFAULT_CHAT_SETTINGS), [key]: newVal } }));
    } catch (e) { logger.error('Failed to update:', e); Alert.alert('Error', 'Failed to update setting'); }
    finally { setFeat(p => ({ ...p, updatingChatSettings: false })); }
  }, [chatId, feat.chatSettings]);

  // FlatList renderItem — uses memoized MessageBubble, no inline functions
  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isMe = item.senderId === user?.uid;
    return (
      <MessageBubble
        item={item} isMe={isMe} matchName={matchName}
        isPinned={pinnedLookup.has(item.id)}
        isTranslated={!!feat.translatedMessages[item.id]}
        isTranslating={feat.translatingMessage === item.id}
        translatedText={feat.translatedMessages[item.id]}
        isPlayingAudio={rec.playingAudio === item.voiceUrl}
        readReceiptsEnabled={feat.chatSettings?.readReceiptsEnabled !== false}
        playingAudio={rec.playingAudio}
        onLongPress={handleMessageLongPress}
        onImagePress={handleImagePreview}
        onPlayVoice={playVoiceMessage}
        onReact={handleReaction}
        userUid={user?.uid ?? ''}
      />
    );
  }, [user?.uid, matchName, pinnedLookup, feat.translatedMessages, feat.translatingMessage, feat.chatSettings?.readReceiptsEnabled, rec.playingAudio, handleMessageLongPress, handleImagePreview, playVoiceMessage, handleReaction]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  // ─── Guard ────────────────────────────────────────────────
  if (!user?.uid || !matchId || !chatId) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <Text style={styles.errorText}>Unable to load this chat.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleGoToMyMatches} accessibilityLabel="Go back to matches" accessibilityRole="button">
          <Text style={styles.primaryButtonText}>← Back to Matches</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Destructure for render
  const { messages, loading, sending, uploadingMedia, newMessage } = core;
  const { matchData, matchOnline, matchLastSeen } = match;
  const { isRecording, recordingDuration } = rec;
  const { matchIsTyping } = typing;
  const {
    showRatingPrompt, previewImage, showScrollToBottom, showMenuModal, showMessageOptionsModal,
    selectedMessage, showGifPicker, showReactionPicker, showPinnedMessagesModal, showDisappearingModal,
    showSettingsModal, showNoteModal, showStartersModal, showDateIdeasModal, showDatePlannerModal,
    showVideoCallPrompt, showReportModal,
  } = uiModal;
  const {
    chatSettings, pinnedMessages, disappearingMode, gifSearchQuery, gifResults, loadingGifs,
    matchNote, savingNote, conversationStarters, dateIdeas, dateSuggestions,
    loadingPlaces, callType, reportReason, submittingReport, updatingChatSettings,
  } = feat;

  return (
    <KeyboardAvoidingView style={[styles.container, wallpaperStyle]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButtonContainer} onPress={handleGoToMyMatches} accessibilityLabel="Go back to matches" accessibilityRole="button">
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerNameRow}>
            <Text style={styles.headerTitle}>{matchName}</Text>
            {matchData?.selfieVerified && <Text style={styles.verifiedBadge} accessibilityLabel="Verified user">✓</Text>}
          </View>
          {ageBadge.level !== 'unverified' && <View style={[styles.headerAgeBadge, { backgroundColor: ageBadge.color }]}><Text style={styles.headerAgeBadgeText}>{ageBadge.label}</Text></View>}
          {disappearingMode !== 'off' && <Text style={styles.disappearingIndicator}>⏱️ {getDisappearingLabel(disappearingMode)}</Text>}
          {matchIsTyping
            ? <Text style={styles.typingText}>typing...</Text>
            : matchOnline
              ? <View style={styles.onlineRow}><View style={styles.onlineDot} /><Text style={styles.onlineText}>Online</Text></View>
              : matchLastSeen ? <Text style={styles.lastSeenText}>{formatLastSeen(matchLastSeen)}</Text> : null}
        </View>
        <TouchableOpacity style={styles.menuButton} onPress={openMenu} accessibilityLabel="Open chat options menu" accessibilityRole="button">
          <Text style={styles.menuButtonText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* Quick actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.quickActionButton} onPress={() => initiateCall('video')} accessibilityLabel="Start video call" accessibilityRole="button"><Text style={styles.quickActionText}>📹</Text></TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={() => initiateCall('audio')} accessibilityLabel="Start audio call" accessibilityRole="button"><Text style={styles.quickActionText}>📞</Text></TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={openDatePlanner} accessibilityLabel="Plan a date" accessibilityRole="button"><Text style={styles.quickActionText}>📍</Text></TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={openDateIdeas} accessibilityLabel="View date ideas" accessibilityRole="button"><Text style={styles.quickActionText}>💡</Text></TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={openStarters} accessibilityLabel="View conversation starters" accessibilityRole="button"><Text style={styles.quickActionText}>💬</Text></TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={openNote} accessibilityLabel="View match notes" accessibilityRole="button"><Text style={styles.quickActionText}>📝</Text></TouchableOpacity>
      </View>

      {/* Pinned bar */}
      {pinnedMessages.length > 0 && (
        <TouchableOpacity style={styles.pinnedBar} onPress={openPinned} accessibilityLabel={`View ${pinnedMessages.length} pinned message${pinnedMessages.length > 1 ? 's' : ''}`} accessibilityRole="button">
          <Text style={styles.pinnedBarIcon}>📌</Text>
          <Text style={styles.pinnedBarText} numberOfLines={1}>{pinnedMessages[0]?.text ?? ''}</Text>
          {pinnedMessages.length > 1 && <Text style={styles.pinnedBarCount}>+{pinnedMessages.length - 1}</Text>}
        </TouchableOpacity>
      )}

      {/* Rating banner */}
      {showRatingPrompt && (
        <TouchableOpacity style={styles.ratingBanner} onPress={handleGoToRating} accessibilityLabel={`Rate your experience with ${matchName}`} accessibilityRole="button">
          <View style={styles.ratingBannerContent}>
            <Text style={styles.ratingBannerIcon}>⭐</Text>
            <View style={styles.ratingBannerTextContainer}>
              <Text style={styles.ratingBannerTitle}>Did you meet {matchName}?</Text>
              <Text style={styles.ratingBannerSubtitle}>Rate your experience to help the community</Text>
            </View>
          </View>
          <Text style={styles.ratingBannerArrow}>→</Text>
        </TouchableOpacity>
      )}

      {/* Messages */}
      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#53a8b6" /><Text style={styles.loadingText}>Loading chat...</Text></View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>{`No messages yet.\nSay hi to ${matchName}!`}</Text>
          <TouchableOpacity style={styles.starterPromptButton} onPress={openStarters} accessibilityLabel="Get conversation starter ideas" accessibilityRole="button">
            <Text style={styles.starterPromptText}>💡 Need conversation starters?</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.listContainer}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={keyExtractor}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesList}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel="Chat messages"
            onContentSizeChange={handleContentSizeChange}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            removeClippedSubviews
            maxToRenderPerBatch={20}
            windowSize={10}
            initialNumToRender={20}
          />
          {showScrollToBottom && (
            <TouchableOpacity style={styles.scrollToBottomButton} onPress={handleScrollToBottom} accessibilityLabel="Scroll to latest message" accessibilityRole="button">
              <Text style={styles.scrollToBottomText}>↓</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Typing indicator */}
      {matchIsTyping && (
        <View style={styles.typingIndicatorContainer} accessibilityLabel={`${matchName} is typing`} accessibilityLiveRegion="polite">
          <View style={styles.typingBubble}>
            <View style={styles.typingDots}>
              <View style={[styles.typingDot, styles.typingDot1]} />
              <View style={[styles.typingDot, styles.typingDot2]} />
              <View style={[styles.typingDot, styles.typingDot3]} />
            </View>
          </View>
        </View>
      )}

      {uploadingMedia && (
        <View style={styles.uploadingContainer}>
          <ActivityIndicator size="small" color="#53a8b6" />
          <Text style={styles.uploadingText}>Sending...</Text>
        </View>
      )}

      {/* Recording bar */}
      {isRecording && (
        <View style={styles.recordingContainer} accessibilityLabel={`Recording voice message, ${formatDuration(recordingDuration)} recorded`} accessibilityLiveRegion="polite">
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>Recording... {formatDuration(recordingDuration)}</Text>
          <TouchableOpacity style={styles.cancelRecordButton} onPress={handleCancelRecording} accessibilityLabel="Cancel recording" accessibilityRole="button"><Text style={styles.cancelRecordText}>✕</Text></TouchableOpacity>
          <TouchableOpacity style={styles.stopRecordButton} onPress={handleStopRecording} accessibilityLabel="Stop recording and send" accessibilityRole="button"><Text style={styles.stopRecordText}>Send</Text></TouchableOpacity>
        </View>
      )}

      {/* Input bar */}
      {!isRecording && (
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.mediaButton} onPress={handlePickImagePress} disabled={sending || uploadingMedia} accessibilityLabel="Attach photo from library" accessibilityRole="button"><Text style={styles.mediaButtonText}>🖼️</Text></TouchableOpacity>
          <TouchableOpacity style={styles.mediaButton} onPress={handleTakePhotoPress} disabled={sending || uploadingMedia} accessibilityLabel="Take a photo" accessibilityRole="button"><Text style={styles.mediaButtonText}>📷</Text></TouchableOpacity>
          <TouchableOpacity style={styles.gifButton} onPress={openGifPicker} disabled={sending || uploadingMedia} accessibilityLabel="Send a GIF" accessibilityRole="button"><Text style={styles.gifButtonText}>GIF</Text></TouchableOpacity>
          <TouchableOpacity style={styles.mediaButton} onPress={handleStartRecording} disabled={sending || uploadingMedia} accessibilityLabel="Record a voice message" accessibilityRole="button"><Text style={styles.mediaButtonText}>🎤</Text></TouchableOpacity>
          <TextInput style={styles.input} placeholder="Type a message..." placeholderTextColor="#666" value={newMessage} onChangeText={handleTextChange} onSubmitEditing={handleSendMessage} editable={!sending && !uploadingMedia} multiline maxLength={500} accessibilityLabel="Message input" accessibilityHint="Type your message here" />
          <TouchableOpacity style={[styles.sendButton, (!newMessage.trim() || sending || uploadingMedia) && styles.sendButtonDisabled]} onPress={handleSendMessage} disabled={!newMessage.trim() || sending || uploadingMedia} accessibilityLabel="Send message" accessibilityRole="button" accessibilityState={{ disabled: !newMessage.trim() || sending || uploadingMedia }}>
            <Text style={styles.sendButtonText}>{sending ? '...' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Modals ─── */}

      {/* Menu modal */}
      <Modal visible={showMenuModal} transparent animationType="fade" onRequestClose={closeMenu}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeMenu}>
          <View style={styles.menuContainer}>
            <ScrollView bounces={false}>
              <Text style={styles.menuTitle}>Options</Text>
              {([
                { icon: '📹', label: 'Video Call',             onPress: openMenuVideoCall },
                { icon: '📞', label: 'Audio Call',             onPress: openMenuAudioCall },
                { icon: '📍', label: 'Plan Date',              onPress: openMenuDatePlanner },
                { icon: '💡', label: 'Date Ideas',             onPress: openMenuDateIdeas },
                { icon: '💬', label: 'Conversation Starters',  onPress: openMenuStarters },
                { icon: '📝', label: 'Match Notes',            onPress: openMenuNote },
                { icon: '📌', label: 'Pinned Messages',        onPress: openMenuPinned },
                { icon: '⏱️', label: 'Disappearing Messages',  onPress: openMenuDisappearing },
                { icon: '⚙️', label: 'Chat Settings',          onPress: openMenuSettings },
              ] as const).map(item => (
                <TouchableOpacity key={item.label} style={styles.menuItem} onPress={item.onPress} accessibilityLabel={item.label} accessibilityRole="button">
                  <Text style={styles.menuItemIcon}>{item.icon}</Text><Text style={styles.menuItemText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
              {([
                { icon: '🚨', label: 'Report User', onPress: handleMenuReport },
                { icon: '🚫', label: 'Block User',  onPress: handleMenuBlock },
                { icon: '💔', label: 'Unmatch',     onPress: handleMenuUnmatch },
              ] as const).map(item => (
                <TouchableOpacity key={item.label} style={styles.menuItem} onPress={item.onPress} accessibilityLabel={item.label} accessibilityRole="button">
                  <Text style={styles.menuItemIcon}>{item.icon}</Text><Text style={[styles.menuItemText, styles.menuItemTextDestructive]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.menuCancelButton} onPress={closeMenu} accessibilityLabel="Close menu" accessibilityRole="button"><Text style={styles.menuCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Message options modal */}
      <Modal visible={showMessageOptionsModal} transparent animationType="fade" onRequestClose={closeMsgOptions}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeMsgOptions}>
          <View style={styles.messageOptionsContainer}>
            {([
              { icon: '❤️', label: 'React',     action: 'react'     as MessageAction },
              { icon: '🌐', label: 'Translate',  action: 'translate' as MessageAction },
              { icon: '📌', label: selectedMessage && pinnedLookup.has(selectedMessage.id) ? 'Unpin' : 'Pin', action: 'pin' as MessageAction },
            ]).map(item => (
              <TouchableOpacity key={item.action} style={styles.messageOption} onPress={() => handleMessageAction(item.action)} accessibilityLabel={item.label} accessibilityRole="button">
                <Text style={styles.messageOptionIcon}>{item.icon}</Text><Text style={styles.messageOptionText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Reaction picker */}
      <Modal visible={showReactionPicker} transparent animationType="fade" onRequestClose={closeReactionPicker}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeReactionPicker}>
          <View style={styles.reactionPicker}>
            {REACTION_EMOJIS.map((emoji, i) => (
              <TouchableOpacity key={i} style={styles.reactionPickerItem} onPress={() => { if (selectedMessage) void handleReaction(selectedMessage.id, emoji); }} accessibilityLabel={`React with ${emoji}`} accessibilityRole="button">
                <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* GIF picker */}
      <Modal visible={showGifPicker} animationType="slide" onRequestClose={closeGifPicker}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeGifPicker} accessibilityLabel="Close GIF picker" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>🎬 Send a GIF</Text>
            <View style={styles.modalSpacer} />
          </View>
          <View style={styles.gifSearchContainer}>
            <TextInput style={styles.gifSearchInput} placeholder="Search GIFs..." placeholderTextColor="#666" value={gifSearchQuery} onChangeText={handleGifSearchInput} accessibilityLabel="Search GIFs" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gifCategories}>
            {GIF_CATEGORIES.map((cat, i) => (
              <TouchableOpacity key={i} style={styles.gifCategoryButton} onPress={() => handleGifCategoryPress(cat.query)} accessibilityLabel={`Browse ${cat.label} GIFs`} accessibilityRole="button">
                <Text style={styles.gifCategoryText}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {loadingGifs
            ? <View style={styles.gifLoading}><ActivityIndicator size="large" color="#53a8b6" /></View>
            : (
              <ScrollView contentContainerStyle={styles.gifResults}>
                {gifResults.length === 0
                  ? <Text style={styles.emptyModalText}>No GIFs found</Text>
                  : gifResults.map(gif => <GifItem key={gif.id} gif={gif} onSend={sendGif} />)}
              </ScrollView>
            )}
          <View style={styles.gifFooter}><Text style={styles.gifPoweredBy}>Powered by GIPHY</Text></View>
        </View>
      </Modal>

      {/* Pinned messages modal */}
      <Modal visible={showPinnedMessagesModal} animationType="slide" onRequestClose={closePinned}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closePinned} accessibilityLabel="Close pinned messages" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>📌 Pinned Messages</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView style={styles.modalContent}>
            {pinnedMessages.length === 0
              ? <Text style={styles.emptyModalText}>No pinned messages yet</Text>
              : pinnedMessages.map((p, i) => (
                <View key={i} style={styles.pinnedMessageCard}>
                  <Text style={styles.pinnedMessageText}>{p.text}</Text>
                  <TouchableOpacity style={styles.unpinButton} onPress={() => void handleUnpinMessage(p.messageId)} accessibilityLabel="Unpin this message" accessibilityRole="button">
                    <Text style={styles.unpinButtonText}>Unpin</Text>
                  </TouchableOpacity>
                </View>
              ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Disappearing messages modal */}
      <Modal visible={showDisappearingModal} animationType="slide" onRequestClose={closeDisappearing}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeDisappearing} accessibilityLabel="Close disappearing messages settings" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>⏱️ Disappearing Messages</Text>
            <View style={styles.modalSpacer} />
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.modalInfo}>Messages will automatically delete after the selected time period.</Text>
            {DISAPPEARING_MODES.map(mode => (
              <TouchableOpacity key={mode} style={[styles.optionItem, disappearingMode === mode && styles.optionItemActive]} onPress={() => void handleSetDisappearing(mode)} accessibilityLabel={`Set disappearing messages to ${getDisappearingLabel(mode)}`} accessibilityRole="radio" accessibilityState={{ selected: disappearingMode === mode }}>
                <Text style={[styles.optionItemText, disappearingMode === mode && styles.optionItemTextActive]}>{getDisappearingLabel(mode)}</Text>
                {disappearingMode === mode && <Text style={styles.optionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Chat settings modal */}
      <Modal visible={showSettingsModal} animationType="slide" onRequestClose={closeSettings}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeSettings} accessibilityLabel="Close chat settings" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>⚙️ Chat Settings</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.sectionTitle}>Wallpaper</Text>
            <View style={styles.wallpaperGrid}>
              {CHAT_WALLPAPERS.map(w => (
                <WallpaperOption key={w.id} wallpaper={w} isActive={chatSettings?.wallpaper === w.id} disabled={updatingChatSettings} onSelect={handleWallpaperSelect} />
              ))}
            </View>
            <Text style={styles.sectionTitle}>Privacy</Text>
            {PRIVACY_TOGGLES.map(t => (
              <PrivacyToggle key={t.key} label={t.label} toggleKey={t.key} value={chatSettings?.[t.key] ?? true} disabled={updatingChatSettings} onToggle={handleToggle} />
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Note modal */}
      <Modal visible={showNoteModal} animationType="slide" onRequestClose={closeNote}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeNote} accessibilityLabel="Close notes" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>📝 Note about {matchName}</Text>
            <View style={styles.modalSpacer} />
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.modalInfo}>Private notes only you can see.</Text>
            <TextInput style={styles.noteInput} placeholder="Add notes about this match..." placeholderTextColor="#666" value={matchNote} onChangeText={handleNoteChange} multiline maxLength={500} accessibilityLabel="Match notes input" />
            <Text style={styles.charCount}>{matchNote.length}/500</Text>
            <TouchableOpacity style={[styles.primaryButton, savingNote && styles.primaryButtonDisabled]} onPress={handleSaveNotePress} disabled={savingNote} accessibilityLabel="Save note" accessibilityRole="button" accessibilityState={{ disabled: savingNote }}>
              <Text style={styles.primaryButtonText}>{savingNote ? 'Saving...' : '💾 Save Note'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Starters modal */}
      <Modal visible={showStartersModal} animationType="slide" onRequestClose={closeStarters}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeStarters} accessibilityLabel="Close conversation starters" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>💬 Conversation Starters</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalInfo}>Tap a starter to use it as your message!</Text>
            {conversationStarters.map((s, i) => (
              <TouchableOpacity key={i} style={styles.starterCard} onPress={() => { setCore(p => ({ ...p, newMessage: s })); closeStarters(); }} accessibilityLabel={`Use as message: ${s}`} accessibilityRole="button">
                <Text style={styles.starterText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Date ideas modal */}
      <Modal visible={showDateIdeasModal} animationType="slide" onRequestClose={closeDateIdeas}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeDateIdeas} accessibilityLabel="Close date ideas" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>💡 Date Ideas</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalInfo}>AI-generated date ideas based on your profiles!</Text>
            {dateIdeas.map((idea, i) => (
              <TouchableOpacity key={i} style={styles.dateIdeaCard} onPress={() => { setCore(p => ({ ...p, newMessage: `How about this for our date? 💕\n\n${idea.idea}\n\nVibe: ${idea.vibe}` })); closeDateIdeas(); }} accessibilityLabel={`Suggest date idea: ${idea.idea}`} accessibilityRole="button">
                <Text style={styles.dateIdeaText}>{idea.idea}</Text>
                <View style={styles.dateIdeaVibe}><Text style={styles.dateIdeaVibeLabel}>Vibe: </Text><Text style={styles.dateIdeaVibeValue}>{idea.vibe}</Text></View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Date planner modal */}
      <Modal visible={showDatePlannerModal} animationType="slide" onRequestClose={closeDatePlanner}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeDatePlanner} accessibilityLabel="Close date planner" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>📍 Plan a Date</Text>
            <View style={styles.modalSpacer} />
          </View>
          <View style={styles.modalContent}>
            {!match.myLocation || !match.matchData?.location
              ? <Text style={styles.errorText}>Location data not available for both users.</Text>
              : (
                <>
                  <Text style={styles.modalInfo}>Find places between you and {matchName}</Text>
                  {loadingPlaces
                    ? <View style={styles.loadingCenter}><ActivityIndicator size="large" color="#53a8b6" /><Text style={styles.loadingText}>Finding places...</Text></View>
                    : dateSuggestions.length === 0
                      ? <TouchableOpacity style={styles.primaryButton} onPress={handleFindDatePlaces} accessibilityLabel="Find date places nearby" accessibilityRole="button"><Text style={styles.primaryButtonText}>🔍 Find Places</Text></TouchableOpacity>
                      : dateSuggestions.map((p, i) => <PlaceCard key={i} place={p} onShare={sharePlace} onMaps={openInMaps} />)}
                </>
              )}
          </View>
        </View>
      </Modal>

      {/* Video call prompt */}
      <Modal visible={showVideoCallPrompt} transparent animationType="fade" onRequestClose={closeVideoPrompt}>
        <View style={styles.modalOverlay}>
          <View style={styles.promptContainer}>
            <Text style={styles.promptTitle}>{callType === 'video' ? '📹' : '📞'} Start {callType === 'video' ? 'Video' : 'Audio'} Call?</Text>
            <Text style={styles.promptText}>{`You're about to start a ${callType} call with ${matchName}.\n\nA secure link will be sent in the chat.`}</Text>
            <View style={styles.promptButtons}>
              <TouchableOpacity style={styles.promptCancelButton} onPress={closeVideoPrompt} accessibilityLabel="Cancel call" accessibilityRole="button"><Text style={styles.promptCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.promptConfirmButton} onPress={handleStartCall} accessibilityLabel={`Start ${callType} call with ${matchName}`} accessibilityRole="button"><Text style={styles.promptConfirmText}>Start Call</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report modal */}
      <Modal visible={showReportModal} transparent animationType="fade" onRequestClose={closeReport}>
        <View style={styles.modalOverlay}>
          <View style={styles.promptContainer}>
            <Text style={styles.promptTitle}>🚨 Report {matchName}</Text>
            <Text style={styles.promptText}>Why are you reporting this user?</Text>
            <TextInput style={[styles.noteInput, styles.reportInput]} placeholder="Describe the issue..." placeholderTextColor="#666" value={reportReason} onChangeText={handleReportChange} multiline maxLength={500} accessibilityLabel="Describe the issue" />
            <View style={[styles.promptButtons, styles.promptButtonsWithMargin]}>
              <TouchableOpacity style={styles.promptCancelButton} onPress={closeReport} disabled={submittingReport} accessibilityLabel="Cancel report" accessibilityRole="button"><Text style={styles.promptCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.promptConfirmButton, styles.reportSubmitButton, submittingReport && styles.primaryButtonDisabled]} onPress={handleSubmitReport} disabled={submittingReport} accessibilityLabel="Submit report" accessibilityRole="button" accessibilityState={{ disabled: submittingReport }}>
                <Text style={styles.promptConfirmText}>{submittingReport ? 'Submitting...' : 'Submit'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Image preview modal */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={closePreview}>
        <View style={styles.imagePreviewModal}>
          <TouchableOpacity style={styles.closePreviewButton} onPress={closePreview} accessibilityLabel="Close image preview" accessibilityRole="button">
            <Text style={styles.closePreviewText}>✕</Text>
          </TouchableOpacity>
          {previewImage && <Image source={{ uri: previewImage }} style={styles.previewImage} resizeMode="contain" accessibilityLabel="Full size image preview" />}
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container:                    { flex: 1, backgroundColor: '#1a1a2e' },
  listContainer:                { flex: 1 },
  header:                       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, paddingTop: 50, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  backButtonContainer:          { width: 70 },
  backButton:                   { color: '#53a8b6', fontSize: 16 },
  headerCenter:                 { flex: 1, alignItems: 'center' },
  headerNameRow:                { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle:                  { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  verifiedBadge:                { color: '#3498db', fontSize: 16, fontWeight: 'bold' },
  headerAgeBadge:               { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, marginTop: 4 },
  headerAgeBadgeText:           { color: '#fff', fontSize: 10, fontWeight: '600' },
  disappearingIndicator:        { color: '#e67e22', fontSize: 10, marginTop: 2 },
  onlineRow:                    { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  onlineDot:                    { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5cb85c', marginRight: 4 },
  onlineText:                   { color: '#5cb85c', fontSize: 11 },
  lastSeenText:                 { color: '#888', fontSize: 11, marginTop: 2 },
  typingText:                   { color: '#53a8b6', fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  menuButton:                   { width: 70, alignItems: 'flex-end', padding: 5 },
  menuButtonText:               { fontSize: 24, color: '#888', fontWeight: 'bold' },
  quickActions:                 { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 10, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  quickActionButton:            { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  quickActionText:              { fontSize: 18 },
  pinnedBar:                    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f3460', padding: 10, gap: 10 },
  pinnedBarIcon:                { fontSize: 16 },
  pinnedBarText:                { flex: 1, color: '#aaa', fontSize: 13 },
  pinnedBarCount:               { color: '#53a8b6', fontSize: 12 },
  ratingBanner:                 { backgroundColor: '#e67e22', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingHorizontal: 15 },
  ratingBannerContent:          { flexDirection: 'row', alignItems: 'center', flex: 1 },
  ratingBannerIcon:             { fontSize: 24, marginRight: 12 },
  ratingBannerTextContainer:    { flex: 1 },
  ratingBannerTitle:            { color: '#fff', fontSize: 14, fontWeight: '600' },
  ratingBannerSubtitle:         { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 },
  ratingBannerArrow:            { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  loadingContainer:             { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText:                  { color: '#aaa', fontSize: 16, marginTop: 15 },
  emptyContainer:               { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyIcon:                    { fontSize: 50, marginBottom: 15 },
  emptyText:                    { color: '#888', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 20 },
  starterPromptButton:          { backgroundColor: '#0f3460', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 20 },
  starterPromptText:            { color: '#53a8b6', fontSize: 14, fontWeight: '600' },
  messagesList:                 { padding: 15, paddingBottom: 24 },
  messageBubble:                { maxWidth: '75%', padding: 12, borderRadius: 18, marginBottom: 10 },
  myMessage:                    { alignSelf: 'flex-end', backgroundColor: '#53a8b6', borderBottomRightRadius: 4 },
  theirMessage:                 { alignSelf: 'flex-start', backgroundColor: '#16213e', borderBottomLeftRadius: 4 },
  pinnedIndicator:              { marginBottom: 5 },
  pinnedIndicatorText:          { color: '#e67e22', fontSize: 10, fontWeight: '600' },
  messageImage:                 { width: 200, height: 200, borderRadius: 12, marginBottom: 8 },
  gifBadge:                     { position: 'absolute', top: 5, right: 5, backgroundColor: '#9b59b6', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8 },
  gifBadgeText:                 { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  voiceMessageContainer:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  voicePlayButton:              { fontSize: 24 },
  voiceWaveform:                { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  voiceBar:                     { width: 3, borderRadius: 2 },
  voiceDuration:                { color: '#888', fontSize: 12 },
  voiceDurationMe:              { color: 'rgba(255,255,255,0.7)' },
  messageText:                  { color: '#eee', fontSize: 16, lineHeight: 22 },
  myMessageText:                { color: '#fff' },
  translationContainer:         { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' },
  translationLabel:             { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginBottom: 4 },
  translatedText:               { fontStyle: 'italic' },
  translatingIndicator:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  translatingText:              { color: '#666', fontSize: 11 },
  translatingTextMe:            { color: 'rgba(255,255,255,0.75)' },
  reactionsContainer:           { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  reactionBubble:               { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, gap: 4 },
  reactionBubbleActive:         { backgroundColor: 'rgba(83,168,182,0.4)' },
  reactionEmoji:                { fontSize: 14 },
  reactionCount:                { color: '#fff', fontSize: 11 },
  messageFooter:                { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  messageTime:                  { color: '#888', fontSize: 11 },
  myMessageTime:                { color: 'rgba(255,255,255,0.7)' },
  readReceipt:                  { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
  typingIndicatorContainer:     { paddingHorizontal: 15, paddingBottom: 5 },
  typingBubble:                 { alignSelf: 'flex-start', backgroundColor: '#16213e', borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: 16, paddingVertical: 12 },
  typingDots:                   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  typingDot:                    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#888' },
  typingDot1:                   { opacity: 0.4 },
  typingDot2:                   { opacity: 0.7 },
  typingDot3:                   { opacity: 1 },
  uploadingContainer:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#16213e' },
  uploadingText:                { color: '#53a8b6', marginLeft: 10, fontSize: 14 },
  recordingContainer:           { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#d9534f', gap: 10 },
  recordingDot:                 { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' },
  recordingText:                { color: '#fff', fontSize: 16, flex: 1 },
  cancelRecordButton:           { backgroundColor: 'rgba(255,255,255,0.3)', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  cancelRecordText:             { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  stopRecordButton:             { backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20 },
  stopRecordText:               { color: '#d9534f', fontSize: 14, fontWeight: '600' },
  inputContainer:               { flexDirection: 'row', padding: 15, backgroundColor: '#16213e', borderTopWidth: 1, borderTopColor: '#0f3460', alignItems: 'flex-end' },
  mediaButton:                  { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  mediaButtonText:              { fontSize: 22 },
  gifButton:                    { backgroundColor: '#9b59b6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, marginRight: 4, justifyContent: 'center' },
  gifButtonText:                { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  input:                        { flex: 1, backgroundColor: '#1a1a2e', color: '#fff', padding: 12, paddingTop: 12, borderRadius: 20, fontSize: 16, marginRight: 10, maxHeight: 100 },
  sendButton:                   { backgroundColor: '#53a8b6', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 20, justifyContent: 'center' },
  sendButtonDisabled:           { backgroundColor: '#555' },
  sendButtonText:               { color: '#fff', fontSize: 16, fontWeight: '600' },
  scrollToBottomButton:         { position: 'absolute', right: 20, bottom: 20, width: 42, height: 42, borderRadius: 21, backgroundColor: '#53a8b6', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  scrollToBottomText:           { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  modalOverlay:                 { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  menuContainer:                { backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 30, width: '100%', position: 'absolute', bottom: 0, maxHeight: '80%' },
  menuTitle:                    { color: '#888', fontSize: 14, textAlign: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  menuItem:                     { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  menuItemIcon:                 { fontSize: 20, marginRight: 12 },
  menuItemText:                 { color: '#eee', fontSize: 16 },
  menuItemTextDestructive:      { color: '#d9534f' },
  menuCancelButton:             { marginTop: 10, marginHorizontal: 15, padding: 16, backgroundColor: '#16213e', borderRadius: 12, alignItems: 'center' },
  menuCancelText:               { color: '#53a8b6', fontSize: 16, fontWeight: '600' },
  messageOptionsContainer:      { backgroundColor: '#16213e', borderRadius: 20, padding: 10, flexDirection: 'row', gap: 15 },
  messageOption:                { alignItems: 'center', padding: 10 },
  messageOptionIcon:            { fontSize: 24, marginBottom: 4 },
  messageOptionText:            { color: '#eee', fontSize: 12 },
  reactionPicker:               { flexDirection: 'row', backgroundColor: '#16213e', borderRadius: 30, padding: 10, gap: 8 },
  reactionPickerItem:           { padding: 8 },
  reactionPickerEmoji:          { fontSize: 28 },
  fullModal:                    { flex: 1, backgroundColor: '#1a1a2e' },
  modalHeader:                  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  modalClose:                   { fontSize: 24, color: '#d9534f', fontWeight: 'bold' },
  modalTitle:                   { fontSize: 18, fontWeight: 'bold', color: '#eee' },
  modalSpacer:                  { width: 30 },
  modalContent:                 { flex: 1, padding: 20 },
  modalInfo:                    { color: '#888', fontSize: 14, marginBottom: 20, lineHeight: 20 },
  emptyModalText:               { color: '#888', fontSize: 16, textAlign: 'center', marginTop: 50 },
  gifSearchContainer:           { padding: 15, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  gifSearchInput:               { backgroundColor: '#1a1a2e', color: '#fff', padding: 12, borderRadius: 10, fontSize: 16 },
  gifCategories:                { maxHeight: 50, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 15 },
  gifCategoryButton:            { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 15, marginRight: 8 },
  gifCategoryText:              { color: '#9b59b6', fontSize: 13, fontWeight: '600' },
  gifLoading:                   { flex: 1, justifyContent: 'center', alignItems: 'center' },
  gifResults:                   { padding: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gifItem:                      { width: '48%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#16213e' },
  gifImage:                     { width: '100%', height: '100%' },
  gifFooter:                    { padding: 15, backgroundColor: '#16213e', borderTopWidth: 1, borderTopColor: '#0f3460', alignItems: 'center' },
  gifPoweredBy:                 { color: '#666', fontSize: 12 },
  pinnedMessageCard:            { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
  pinnedMessageText:            { flex: 1, color: '#eee', fontSize: 14 },
  unpinButton:                  { backgroundColor: '#d9534f', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15 },
  unpinButtonText:              { color: '#fff', fontSize: 12, fontWeight: '600' },
  optionItem:                   { backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  optionItemActive:             { backgroundColor: '#0f3460', borderWidth: 2, borderColor: '#53a8b6' },
  optionItemText:               { color: '#eee', fontSize: 16 },
  optionItemTextActive:         { color: '#53a8b6', fontWeight: '600' },
  optionCheck:                  { color: '#53a8b6', fontSize: 18 },
  sectionTitle:                 { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 15 },
  wallpaperGrid:                { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wallpaperOption:              { width: '30%', aspectRatio: 1, borderRadius: 12, justifyContent: 'flex-end', padding: 8 },
  wallpaperOptionActive:        { borderWidth: 3, borderColor: '#53a8b6' },
  wallpaperName:                { color: '#fff', fontSize: 10, fontWeight: '600' },
  toggleItem:                   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 10 },
  toggleText:                   { color: '#eee', fontSize: 16 },
  toggleSwitch:                 { width: 50, height: 28, borderRadius: 14, backgroundColor: '#555', padding: 2 },
  toggleSwitchActive:           { backgroundColor: '#53a8b6' },
  toggleKnob:                   { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  toggleKnobActive:             { marginLeft: 22 },
  noteInput:                    { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 12, fontSize: 16, height: 150, textAlignVertical: 'top' },
  reportInput:                  { height: 100 },
  charCount:                    { color: '#666', fontSize: 12, textAlign: 'right', marginTop: 5 },
  primaryButton:                { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 20 },
  primaryButtonDisabled:        { backgroundColor: '#555' },
  primaryButtonText:            { color: '#fff', fontSize: 16, fontWeight: '600' },
  starterCard:                  { backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 12 },
  starterText:                  { color: '#eee', fontSize: 15, lineHeight: 22 },
  dateIdeaCard:                 { backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 12 },
  dateIdeaText:                 { color: '#eee', fontSize: 15, lineHeight: 22, marginBottom: 8 },
  dateIdeaVibe:                 { flexDirection: 'row' },
  dateIdeaVibeLabel:            { color: '#888', fontSize: 12 },
  dateIdeaVibeValue:            { color: '#e67e22', fontSize: 12, fontWeight: '600' },
  errorText:                    { color: '#d9534f', fontSize: 16, textAlign: 'center', marginTop: 50, lineHeight: 24 },
  loadingCenter:                { flex: 1, justifyContent: 'center', alignItems: 'center' },
  placeCard:                    { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#0f3460' },
  placeInfo:                    { marginBottom: 12 },
  placeName:                    { color: '#eee', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  placeType:                    { color: '#e67e22', fontSize: 12, fontWeight: '600', marginBottom: 6, textTransform: 'capitalize' },
  placeAddress:                 { color: '#888', fontSize: 14, marginBottom: 6 },
  placeDistance:                { color: '#53a8b6', fontSize: 13 },
  placeActions:                 { flexDirection: 'row', gap: 10 },
  placeActionButton:            { flex: 1, backgroundColor: '#0f3460', paddingVertical: 10, borderRadius: 20, alignItems: 'center' },
  placeActionText:              { color: '#53a8b6', fontSize: 14, fontWeight: '600' },
  promptContainer:              { backgroundColor: '#16213e', borderRadius: 20, padding: 25, width: '85%', maxWidth: 400 },
  promptTitle:                  { fontSize: 22, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 15 },
  promptText:                   { color: '#aaa', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 25 },
  promptButtons:                { flexDirection: 'row', gap: 10 },
  promptButtonsWithMargin:      { marginTop: 15 },
  promptCancelButton:           { flex: 1, backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  promptCancelText:             { color: '#888', fontSize: 16, fontWeight: '600' },
  promptConfirmButton:          { flex: 1, backgroundColor: '#5cb85c', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  reportSubmitButton:           { backgroundColor: '#d9534f' },
  promptConfirmText:            { color: '#fff', fontSize: 16, fontWeight: '600' },
  imagePreviewModal:            { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  closePreviewButton:           { position: 'absolute', top: 50, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  closePreviewText:             { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  previewImage:                 { width: '90%', height: '70%' },
  shadowOffset:                 { width: 0, height: 2 },
});