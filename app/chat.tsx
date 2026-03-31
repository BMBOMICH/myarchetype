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

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  wallpaper: null, readReceiptsEnabled: true,
  typingIndicatorsEnabled: true, notificationsEnabled: true,
};
const WAVEFORM_BARS      = [12, 18, 10, 22, 16, 24, 14, 20, 11, 17, 13, 19];
const MESSAGE_PAGE_SIZE  = 100;
const MAX_RECORDING_SECS = 60;

// ─── Helpers ──────────────────────────────────────────────

const formatDuration = (seconds: number): string => {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

const formatTime = (timestamp: Timestamp | Date | number | null | undefined): string => {
  if (!timestamp) return '';
  try {
    const date = typeof (timestamp as Timestamp)?.toDate === 'function'
      ? (timestamp as Timestamp).toDate()
      : new Date(timestamp as Date | number);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const normalizeParam = (value: ParamValue): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

const isValidLocation = (value: unknown): value is { latitude: number; longitude: number } =>
  !!value && typeof value === 'object' &&
  typeof (value as Record<string, unknown>).latitude === 'number' &&
  typeof (value as Record<string, unknown>).longitude === 'number';

const buildPinnedLookup = (items: PinnedMessage[]): Set<string> =>
  new Set(items.map((i) => i.messageId));

// ─── Component ────────────────────────────────────────────

export default function ChatScreen() {
  const router       = useRouter();
  const params       = useLocalSearchParams();
  const matchId      = normalizeParam(params.matchId);
  const matchName    = normalizeParam(params.matchName) || 'Match';
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
  const [messages,          setMessages]          = useState<Message[]>([]);
  const [newMessage,        setNewMessage]        = useState('');
  const [loading,           setLoading]           = useState(true);
  const [sending,           setSending]           = useState(false);
  const [uploadingMedia,    setUploadingMedia]    = useState(false);
  const [matchData,         setMatchData]         = useState<MatchData | null>(null);
  const [matchOnline,       setMatchOnline]       = useState(false);
  const [matchLastSeen,     setMatchLastSeen]     = useState<Timestamp | Date | number | null>(null);
  const [myLocation,        setMyLocation]        = useState<{ latitude: number; longitude: number } | null>(null);
  const [isTyping,          setIsTyping]          = useState(false);
  const [matchIsTyping,     setMatchIsTyping]     = useState(false);
  const [isRecording,       setIsRecording]       = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playingAudio,      setPlayingAudio]      = useState<string | null>(null);
  const [waitingForVoiceUri,setWaitingForVoiceUri]= useState(false);
  const [finalVoiceDuration,setFinalVoiceDuration]= useState(0);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer   = useAudioPlayer(null);

  const [chatSettings,          setChatSettings]          = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [pinnedMessages,        setPinnedMessages]        = useState<PinnedMessage[]>([]);
  const [disappearingMode,      setDisappearingModeState] = useState<DisappearingMode>('off');
  const [showRatingPrompt,      setShowRatingPrompt]      = useState(false);
  const [previewImage,          setPreviewImage]          = useState<string | null>(null);
  const [showScrollToBottom,    setShowScrollToBottom]    = useState(false);
  const [showMenuModal,         setShowMenuModal]         = useState(false);
  const [showMessageOptionsModal,setShowMessageOptionsModal]=useState(false);
  const [selectedMessage,       setSelectedMessage]       = useState<Message | null>(null);
  const [showGifPicker,         setShowGifPicker]         = useState(false);
  const [showReactionPicker,    setShowReactionPicker]    = useState(false);
  const [showPinnedMessagesModal,setShowPinnedMessagesModal]=useState(false);
  const [showDisappearingModal, setShowDisappearingModal] = useState(false);
  const [showSettingsModal,     setShowSettingsModal]     = useState(false);
  const [showNoteModal,         setShowNoteModal]         = useState(false);
  const [showStartersModal,     setShowStartersModal]     = useState(false);
  const [showDateIdeasModal,    setShowDateIdeasModal]    = useState(false);
  const [showDatePlannerModal,  setShowDatePlannerModal]  = useState(false);
  const [showVideoCallPrompt,   setShowVideoCallPrompt]   = useState(false);
  const [showReportModal,       setShowReportModal]       = useState(false);
  const [gifSearchQuery,        setGifSearchQuery]        = useState('');
  const [gifResults,            setGifResults]            = useState<GiphyGif[]>([]);
  const [loadingGifs,           setLoadingGifs]           = useState(false);
  const [translatedMessages,    setTranslatedMessages]    = useState<Record<string, string>>({});
  const [translatingMessage,    setTranslatingMessage]    = useState<string | null>(null);
  const [matchNote,             setMatchNote]             = useState('');
  const [savingNote,            setSavingNote]            = useState(false);
  const [conversationStarters,  setConversationStarters]  = useState<string[]>([]);
  const [dateIdeas,             setDateIdeas]             = useState<DateIdea[]>([]);
  const [dateSuggestions,       setDateSuggestions]       = useState<DateSuggestion[]>([]);
  const [loadingPlaces,         setLoadingPlaces]         = useState(false);
  const [callType,              setCallType]              = useState<'video' | 'audio'>('video');
  const [reportReason,          setReportReason]          = useState('');
  const [submittingReport,      setSubmittingReport]      = useState(false);
  const [updatingChatSettings,  setUpdatingChatSettings]  = useState(false);

  // ── Derived ───────────────────────────────────────────────
  const pinnedLookup  = useMemo(() => buildPinnedLookup(pinnedMessages), [pinnedMessages]);
  const ageBadge      = useMemo(() => getAgeVerificationLevel(matchData?.ageVerification), [matchData?.ageVerification]);
  const wallpaperStyle= useMemo(() => getWallpaperStyle(chatSettings?.wallpaper ?? null), [chatSettings?.wallpaper]);

  // ── Scroll helpers ────────────────────────────────────────
  const scrollToBottom = useCallback((animated = true) => {
    flatListRef.current?.scrollToEnd({ animated });
  }, []);

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
    try {
      const callable = httpsCallable<{ otherUserId: string }, { success: boolean; chatId: string }>(functions, 'ensureChatExists');
      await callable({ otherUserId: matchId });
    } catch (error) { console.error('Failed to ensure chat exists:', error); }
  }, [functions, matchId]);

  const resolveRenderableMedia = useCallback(async (docId: string, data: FirestoreMessageData): Promise<{ imageUrl?: string; voiceUrl?: string }> => {
    if (
      typeof data.mediaUrl === 'string' && typeof data.encryptedMediaKey === 'string' &&
      typeof data.mediaKeyNonce === 'string' && typeof data.mediaCipherNonce === 'string' &&
      typeof data.senderPublicKey === 'string'
    ) {
      try {
        const uri = await decryptMediaToRenderableUri({
          mediaUrl: data.mediaUrl, encryptedMediaKey: data.encryptedMediaKey,
          mediaKeyNonce: data.mediaKeyNonce, mediaCipherNonce: data.mediaCipherNonce,
          senderPublicKey: data.senderPublicKey,
          mediaMimeType: typeof data.mediaMimeType === 'string' ? data.mediaMimeType : undefined,
        });
        return data.messageType === 'voice' ? { voiceUrl: uri } : { imageUrl: uri };
      } catch (error) { console.warn(`Failed to decrypt media for message ${docId}:`, error); return {}; }
    }
    return {
      imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
      voiceUrl: typeof data.voiceUrl === 'string' ? data.voiceUrl : undefined,
    };
  }, []);

  // ─── Effects ──────────────────────────────────────────────

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { if (!user?.uid) return; void ensureMyE2EEIdentity(); }, [user?.uid]);
  useEffect(() => { if (chatId && matchId) void ensureChatExists(); }, [chatId, matchId, ensureChatExists]);
  useEffect(() => { AudioModule.requestRecordingPermissionsAsync().catch((e) => console.warn('Recording permission request failed:', e)); }, []);

  useEffect(() => {
    if (!chatId || !matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const [settings, pinned, disappearing, note] = await Promise.all([
          getChatSettings(chatId), getPinnedMessages(chatId),
          getDisappearingSettings(chatId), getMatchNote(matchId),
        ]);
        if (cancelled || !mountedRef.current) return;
        setChatSettings(settings ?? DEFAULT_CHAT_SETTINGS);
        setPinnedMessages(pinned ?? []);
        if (disappearing) setDisappearingModeState(disappearing.mode);
        setMatchNote(note ?? '');
        if (disappearing?.mode !== 'off') await cleanupExpiredMessages(chatId);
      } catch (error) { console.error('Failed to load chat data:', error); }
    })();
    return () => { cancelled = true; };
  }, [chatId, matchId]);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists() || cancelled || !mountedRef.current) return;
        const data = userDoc.data();
        setMyLocation(isValidLocation(data['location']) ? data['location'] : null);
      } catch (error) { console.error('Failed to load user location:', error); }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  useEffect(() => { if (showDatePlannerParam === 'true') setShowDatePlannerModal(true); }, [showDatePlannerParam]);

  useEffect(() => {
    if (!matchId) return;
    const unsubscribe = onSnapshot(doc(db, 'users', matchId), (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data() as MatchData;
      setMatchData(data);
      setMatchOnline(isUserOnline(data.lastSeen));
      setMatchLastSeen(data.lastSeen ?? null);
      setConversationStarters(getConversationStarters(data.personalityType, data.interests));
      setDateIdeas(getDateIdeas(undefined, data.lifestyle ?? undefined, 5));
    }, (error) => { console.error('Failed to subscribe to match data:', error); });
    return () => unsubscribe();
  }, [matchId]);

  useEffect(() => {
    if (!matchId || !user?.uid || !chatId) return;
    const typingRef = doc(db, 'chats', chatId, 'typing', matchId);
    const unsubscribe = onSnapshot(typingRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const lastTyped = typeof data['lastTyped']?.toMillis === 'function' ? data['lastTyped'].toMillis() : 0;
        setMatchIsTyping((data['isTyping'] || false) && Date.now() - lastTyped < 5000);
      } else { setMatchIsTyping(false); }
    }, (error) => { console.error('Failed to subscribe to typing status:', error); });
    return () => unsubscribe();
  }, [matchId, user?.uid, chatId]);

  useEffect(() => {
    if (!user?.uid || !matchId) return;
    let cancelled = false;
    (async () => {
      try {
        const shouldShow = await shouldPromptForRating(user.uid, matchId);
        if (!cancelled && mountedRef.current) setShowRatingPrompt(shouldShow);
      } catch (error) { console.error('Failed to check rating prompt:', error); }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, matchId]);

  useEffect(() => {
    if (!user?.uid || !matchId || !chatId) return;
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(MESSAGE_PAGE_SIZE));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      try {
        const loadedMessages = await Promise.all(snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data() as FirestoreMessageData;
          let decryptedText = '';
          if (
            (data.messageType === 'text' || data.messageType === 'system') &&
            typeof data.ciphertext === 'string' && typeof data.nonce === 'string' &&
            typeof data.senderPublicKey === 'string'
          ) {
            try { decryptedText = await decryptTextFromSender({ ciphertext: data.ciphertext, nonce: data.nonce, senderPublicKey: data.senderPublicKey }); }
            catch (error) { console.warn('Failed to decrypt text message:', error); decryptedText = '[Unable to decrypt]'; }
          } else if (typeof data.encryptedText === 'string') {
            decryptedText = '[Legacy encrypted message]';
          } else if (typeof data.text === 'string') {
            decryptedText = data.text;
          }
          const messageType: Message['messageType'] =
            data.messageType === 'text' || data.messageType === 'image' ||
            data.messageType === 'voice' || data.messageType === 'gif' || data.messageType === 'system'
              ? data.messageType
              : data.imageUrl ? (data.isGif ? 'gif' : 'image')
              : data.voiceUrl ? 'voice' : 'text';
          const media = await resolveRenderableMedia(docSnap.id, data);
          return {
            id: docSnap.id, text: decryptedText, senderId: data.senderId || '',
            timestamp: data.timestamp ?? null, read: !!data.read, readAt: data.readAt ?? null,
            imageUrl: media.imageUrl, voiceUrl: media.voiceUrl,
            voiceDuration: typeof data.voiceDuration === 'number' ? data.voiceDuration : 0,
            isGif: !!data.isGif, reactions: Array.isArray(data.reactions) ? data.reactions : [],
            isPinned: pinnedLookup.has(docSnap.id), messageType,
            version:        typeof data.version        === 'number' ? data.version        : undefined,
            senderPublicKey:typeof data.senderPublicKey=== 'string' ? data.senderPublicKey: undefined,
            senderKeyVersion:typeof data.senderKeyVersion==='number'? data.senderKeyVersion:undefined,
            mediaUrl:       typeof data.mediaUrl       === 'string' ? data.mediaUrl       : undefined,
            mediaMimeType:  typeof data.mediaMimeType  === 'string' ? data.mediaMimeType  : undefined,
            mediaSizeBytes: typeof data.mediaSizeBytes === 'number' ? data.mediaSizeBytes : undefined,
            encryptedMediaKey:typeof data.encryptedMediaKey==='string'?data.encryptedMediaKey:undefined,
            mediaKeyNonce:  typeof data.mediaKeyNonce  === 'string' ? data.mediaKeyNonce  : undefined,
            mediaCipherNonce:typeof data.mediaCipherNonce==='string'?data.mediaCipherNonce:undefined,
          } as Message;
        }));

        const unreadIds = loadedMessages
          .filter((m) => m.senderId !== user.uid && !m.read && chatSettings?.readReceiptsEnabled !== false)
          .map((m) => m.id);

        if (!mountedRef.current) return;
        setMessages(loadedMessages);
        setLoading(false);

        if (chatSettings?.readReceiptsEnabled !== false && unreadIds.length > 0) {
          try {
            const batch = writeBatch(db);
            unreadIds.forEach((msgId) => {
              batch.update(doc(db, 'chats', chatId, 'messages', msgId), { read: true, readAt: serverTimestamp() });
            });
            await batch.commit();
          } catch (e) { console.error('Error marking messages as read:', e); }
        }
        scheduleScrollToBottom(false);
      } catch (error) { console.error('Failed to process messages:', error); if (mountedRef.current) setLoading(false); }
    }, (error) => { console.error('Message subscription failed:', error); if (mountedRef.current) setLoading(false); });
    return () => unsubscribe();
  }, [user?.uid, matchId, chatId, chatSettings?.readReceiptsEnabled, pinnedLookup, scheduleScrollToBottom, resolveRenderableMedia]);

  // Voice URI watcher — uploadAndSendVoiceMessage called via ref to avoid stale closure
  const uploadAndSendVoiceMessageRef = useRef<((uri: string, duration: number) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!waitingForVoiceUri || !audioRecorder.uri || finalVoiceDuration <= 0) return;
    setWaitingForVoiceUri(false);
    uploadAndSendVoiceMessageRef.current?.(audioRecorder.uri, finalVoiceDuration);
  }, [waitingForVoiceUri, audioRecorder.uri, finalVoiceDuration]);

  useEffect(() => {
    if (!playingAudio) return;
    const check = setInterval(() => {
      try { if (!audioPlayer.playing) setPlayingAudio(null); } catch { setPlayingAudio(null); }
    }, 500);
    return () => clearInterval(check);
  }, [playingAudio, audioPlayer]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (gifSearchTimeoutRef.current) clearTimeout(gifSearchTimeoutRef.current);
      if (pendingMessageScrollTimeoutRef.current) clearTimeout(pendingMessageScrollTimeoutRef.current);
    };
  }, []);

  // ─── Callbacks ────────────────────────────────────────────

  const sendPushNotification = useCallback(async (messagePreview: string) => {
    if (!matchId || matchOnline || !user?.uid) return;
    try {
      const senderDoc  = await getDoc(doc(db, 'users', user.uid));
      const senderName = senderDoc.exists() && typeof senderDoc.data()['name'] === 'string'
        ? senderDoc.data()['name'] as string
        : 'Someone';
      await notifyNewMessage(matchId, senderName, messagePreview);
    } catch (e) { console.error('Notification failed:', e); }
  }, [matchId, matchOnline, user?.uid]);

  const updateTypingStatus = useCallback(async (typing: boolean) => {
    if (!user?.uid || !chatId || chatSettings?.typingIndicatorsEnabled === false) return;
    try {
      await setDoc(doc(db, 'chats', chatId, 'typing', user.uid), { isTyping: typing, lastTyped: serverTimestamp() }, { merge: true });
    } catch (error) { console.warn('Failed to update typing status:', error); }
  }, [user?.uid, chatId, chatSettings?.typingIndicatorsEnabled]);

  const handleTextChange = useCallback((text: string) => {
    setNewMessage(text);
    if (!isTyping && text.trim().length > 0) { setIsTyping(true); void updateTypingStatus(true); }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => { setIsTyping(false); void updateTypingStatus(false); }, 3000);
  }, [isTyping, updateTypingStatus]);

  const sendMessage = useCallback(async () => {
    if (!newMessage.trim() || !user?.uid || sending || !chatId || !matchId) return;
    const messageText = newMessage.trim();
    const textCheck = checkTextSafety(messageText);
    if (!textCheck.safe) { Alert.alert('Message Not Allowed', textCheck.reason); return; }
    setNewMessage(''); setSending(true); setIsTyping(false);
    void updateTypingStatus(false);
    try {
      await ensureMyE2EEIdentity();
      await ensureChatExists();
      const encrypted = await encryptTextForRecipient(messageText, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false,
        version: encrypted.version, messageType: 'text',
        ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
        senderPublicKey: encrypted.senderPublicKey, senderKeyVersion: encrypted.senderKeyVersion,
      });
      await sendPushNotification(messageText);
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (error: unknown) {
      console.error('Error sending message:', error);
      Alert.alert('Error', (error as { message?: string })?.message || 'Failed to send message');
      setNewMessage(messageText);
    } finally { setSending(false); }
  }, [newMessage, user?.uid, sending, chatId, matchId, updateTypingStatus, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  const uploadAndSendImage = useCallback(async (imageAsset: ImagePicker.ImagePickerAsset) => {
    if (!user?.uid || !chatId || !matchId) return;
    if (!imageAsset.uri) { Alert.alert('Error', 'Image data unavailable'); return; }
    const isWeb = Platform.OS === 'web';
    if (isWeb) {
      const imageCheck = await checkImageSafety(imageAsset.uri);
      if (!imageCheck.safe) { Alert.alert('Image Not Allowed', imageCheck.reason); return; }
    }
    setUploadingMedia(true);
    try {
      await ensureMyE2EEIdentity();
      await ensureChatExists();
      const encryptedUpload = await encryptAndUploadImageForRecipient(imageAsset.uri, matchId);
      if (!isWeb && encryptedUpload.mediaUrl) {
        const nativeCheck = await checkImageSafety(encryptedUpload.mediaUrl);
        if (!nativeCheck.safe) { Alert.alert('Image Not Allowed', nativeCheck.reason); return; }
      }
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false,
        version: encryptedUpload.version,
        messageType: imageAsset.mimeType === 'image/gif' ? 'gif' : 'image',
        mediaUrl: encryptedUpload.mediaUrl, mediaMimeType: encryptedUpload.mediaMimeType,
        mediaSizeBytes: encryptedUpload.mediaSizeBytes,
        encryptedMediaKey: encryptedUpload.encryptedMediaKey,
        mediaKeyNonce: encryptedUpload.mediaKeyNonce, mediaCipherNonce: encryptedUpload.mediaCipherNonce,
        senderPublicKey: encryptedUpload.senderPublicKey, senderKeyVersion: encryptedUpload.senderKeyVersion,
        isGif: imageAsset.mimeType === 'image/gif',
      });
      await sendPushNotification(imageAsset.mimeType === 'image/gif' ? '🎬 Sent a GIF' : '📷 Sent a photo');
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (error: unknown) {
      console.error('Error uploading encrypted image:', error);
      Alert.alert('Error', (error as { message?: string })?.message || 'Failed to send image');
    } finally { setUploadingMedia(false); }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  const handlePickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!result.granted) { Alert.alert('Permission Required', 'Permission to access photos is required.'); return; }
      const pickerResult = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8, base64: false });
      if (!pickerResult.canceled && pickerResult.assets[0]) await uploadAndSendImage(pickerResult.assets[0]);
    } catch (error) { console.error('Failed to pick image:', error); Alert.alert('Error', 'Failed to open photo library'); }
  }, [uploadAndSendImage]);

  const handleTakePhoto = useCallback(async () => {
    try {
      const result = await ImagePicker.requestCameraPermissionsAsync();
      if (!result.granted) { Alert.alert('Permission Required', 'Permission to access camera is required.'); return; }
      const pickerResult = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8, base64: false });
      if (!pickerResult.canceled && pickerResult.assets[0]) await uploadAndSendImage(pickerResult.assets[0]);
    } catch (error) { console.error('Failed to take photo:', error); Alert.alert('Error', 'Failed to open camera'); }
  }, [uploadAndSendImage]);

  const uploadAndSendVoiceMessage = useCallback(async (uri: string, durationSeconds: number) => {
    if (!user?.uid || !chatId || !matchId) return;
    setUploadingMedia(true);
    try {
      await ensureMyE2EEIdentity();
      await ensureChatExists();
      const encryptedUpload = await encryptAndUploadVoiceForRecipient(uri, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false,
        version: encryptedUpload.version, messageType: 'voice',
        mediaUrl: encryptedUpload.mediaUrl, mediaMimeType: encryptedUpload.mediaMimeType,
        mediaSizeBytes: encryptedUpload.mediaSizeBytes, voiceDuration: durationSeconds,
        encryptedMediaKey: encryptedUpload.encryptedMediaKey,
        mediaKeyNonce: encryptedUpload.mediaKeyNonce, mediaCipherNonce: encryptedUpload.mediaCipherNonce,
        senderPublicKey: encryptedUpload.senderPublicKey, senderKeyVersion: encryptedUpload.senderKeyVersion,
      });
      setRecordingDuration(0);
      currentRecordingDurationRef.current = 0;
      setFinalVoiceDuration(0);
      await sendPushNotification('🎤 Voice message');
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (error: unknown) {
      console.error('Error sending encrypted voice message:', error);
      Alert.alert('Error', (error as { message?: string })?.message || 'Failed to send voice message');
    } finally { setUploadingMedia(false); }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  // Keep ref in sync so the voice URI watcher can call the latest version without stale closure
  useEffect(() => { uploadAndSendVoiceMessageRef.current = uploadAndSendVoiceMessage; }, [uploadAndSendVoiceMessage]);

  const startRecording = useCallback(async () => {
    if (isRecording || isStoppingRecordingRef.current) return;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) { Alert.alert('Permission Required', 'Microphone permission is required for voice messages'); return; }
      currentRecordingDurationRef.current = 0;
      setRecordingDuration(0); setFinalVoiceDuration(0); setWaitingForVoiceUri(false);
      await audioRecorder.record();
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        currentRecordingDurationRef.current += 1;
        const next = currentRecordingDurationRef.current;
        setRecordingDuration(next);
        if (next >= MAX_RECORDING_SECS) {
          void (async () => {
            if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
            setIsRecording(false); isStoppingRecordingRef.current = true;
            try { await audioRecorder.stop(); setFinalVoiceDuration(MAX_RECORDING_SECS); setWaitingForVoiceUri(true); }
            catch (error) { console.error('Auto-stop recording failed:', error); Alert.alert('Error', 'Could not finish recording'); }
            finally { isStoppingRecordingRef.current = false; }
          })();
        }
      }, 1000);
    } catch (error) { console.error('Failed to start recording:', error); Alert.alert('Error', 'Could not start recording'); }
  }, [audioRecorder, isRecording]);

  const stopRecording = useCallback(async () => {
    if (!isRecording || isStoppingRecordingRef.current) return;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setIsRecording(false); isStoppingRecordingRef.current = true;
    try {
      const duration = currentRecordingDurationRef.current;
      await audioRecorder.stop();
      setFinalVoiceDuration(duration);
      setWaitingForVoiceUri(duration > 0);
      if (duration <= 0) Alert.alert('Recording too short', 'Please record a slightly longer voice message.');
    } catch (error) { console.error('Failed to stop recording:', error); Alert.alert('Error', 'Could not finish recording'); }
    finally { isStoppingRecordingRef.current = false; }
  }, [isRecording, audioRecorder]);

  const cancelRecording = useCallback(async () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setIsRecording(false); setRecordingDuration(0); setFinalVoiceDuration(0);
    currentRecordingDurationRef.current = 0; setWaitingForVoiceUri(false);
    try { await audioRecorder.stop(); } catch { /* ignore */ }
  }, [audioRecorder]);

  const playVoiceMessage = useCallback((voiceUrl: string) => {
    try {
      if (playingAudio === voiceUrl) { audioPlayer.pause(); setPlayingAudio(null); return; }
      audioPlayer.replace(voiceUrl); setPlayingAudio(voiceUrl); audioPlayer.play();
    } catch (error) { console.error('Error playing voice message:', error); setPlayingAudio(null); }
  }, [playingAudio, audioPlayer]);

  const executeGifSearch = useCallback(async (searchQuery: string) => {
    const requestId = Date.now();
    latestGifRequestRef.current = requestId;
    setLoadingGifs(true);
    try {
      const results = searchQuery.trim() ? await searchGifs(searchQuery, 20) : await getTrendingGifs(20);
      if (latestGifRequestRef.current !== requestId || !mountedRef.current) return;
      setGifResults(results);
    } catch (error) {
      console.error('Error searching GIFs:', error);
      if (latestGifRequestRef.current === requestId && mountedRef.current) setGifResults([]);
    } finally {
      if (latestGifRequestRef.current === requestId && mountedRef.current) setLoadingGifs(false);
    }
  }, []);

  const handleGifSearchInput = useCallback((text: string) => {
    setGifSearchQuery(text);
    if (gifSearchTimeoutRef.current) clearTimeout(gifSearchTimeoutRef.current);
    gifSearchTimeoutRef.current = setTimeout(() => { void executeGifSearch(text); }, 400);
  }, [executeGifSearch]);

  const handleGifCategoryPress = useCallback((categoryQuery: string) => {
    setGifSearchQuery(categoryQuery);
    void executeGifSearch(categoryQuery);
  }, [executeGifSearch]);

  useEffect(() => { if (showGifPicker) void executeGifSearch(''); }, [showGifPicker, executeGifSearch]);

  const sendGif = useCallback(async (gif: GiphyGif) => {
    if (!user?.uid || !chatId || !matchId) return;
    setShowGifPicker(false); setSending(true);
    try {
      await ensureMyE2EEIdentity();
      await ensureChatExists();
      const encrypted = await encryptTextForRecipient(gif.url, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false,
        version: encrypted.version, messageType: 'gif',
        ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
        senderPublicKey: encrypted.senderPublicKey, senderKeyVersion: encrypted.senderKeyVersion,
        isGif: true,
      });
      await sendPushNotification('🎬 Sent a GIF');
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (error) { console.error('Error sending GIF:', error); Alert.alert('Error', 'Failed to send GIF'); }
    finally { setSending(false); }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    const result = await addReaction(chatId, messageId, emoji);
    if (!result.success) Alert.alert('Error', 'Failed to add reaction');
    setShowReactionPicker(false); setSelectedMessage(null);
  }, [chatId]);

  const handleTranslateMessage = useCallback(async (messageId: string, text: string) => {
    if (!text.trim()) return;
    if (translatedMessages[messageId]) {
      setTranslatedMessages((prev) => { const next = { ...prev }; delete next[messageId]; return next; });
      return;
    }
    setTranslatingMessage(messageId);
    try {
      const result = await translateMessage(text, 'en');
      if (result.success && result.translatedText) {
        setTranslatedMessages((prev) => ({ ...prev, [messageId]: result.translatedText! }));
      } else Alert.alert('Error', 'Translation failed');
    } catch (error) { console.error('Translation failed:', error); Alert.alert('Error', 'Translation failed'); }
    finally { setTranslatingMessage(null); }
  }, [translatedMessages]);

  const refreshPinnedMessages = useCallback(async () => {
    try { setPinnedMessages((await getPinnedMessages(chatId)) ?? []); }
    catch (error) { console.error('Failed to refresh pinned messages:', error); }
  }, [chatId]);

  const handlePinMessage = useCallback(async (messageId: string, messageText: string) => {
    const result = await pinMessage(chatId, messageId, messageText?.trim() || '[Media message]');
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
    if (result.success) { setDisappearingModeState(mode); setShowDisappearingModal(false); Alert.alert('Success', `Disappearing messages: ${getDisappearingLabel(mode)}`); }
    else Alert.alert('Error', 'Failed to update disappearing messages');
  }, [chatId]);

  const handleSaveNote = useCallback(async () => {
    if (!matchId) return;
    setSavingNote(true);
    try {
      const success = await saveMatchNote(matchId, matchNote);
      if (success) { setShowNoteModal(false); Alert.alert('Success', 'Note saved!'); }
      else Alert.alert('Error', 'Failed to save note');
    } catch (error) { console.error('Failed to save note:', error); Alert.alert('Error', 'Failed to save note'); }
    finally { setSavingNote(false); }
  }, [matchId, matchNote]);

  const findDatePlaces = useCallback(async () => {
    if (!myLocation || !matchData?.location) { Alert.alert('Error', 'Location data not available for both users'); return; }
    setLoadingPlaces(true); setDateSuggestions([]);
    try {
      const midpoint = {
        latitude:  (myLocation.latitude  + matchData.location.latitude)  / 2,
        longitude: (myLocation.longitude + matchData.location.longitude) / 2,
      };
      const radius   = 5000;
      const queryStr = `[out:json][timeout:25];\n(\n  node["amenity"="restaurant"](around:${radius},${midpoint.latitude},${midpoint.longitude});\n  node["amenity"="cafe"](around:${radius},${midpoint.latitude},${midpoint.longitude});\n  node["amenity"="bar"](around:${radius},${midpoint.latitude},${midpoint.longitude});\n  node["leisure"="park"](around:${radius},${midpoint.latitude},${midpoint.longitude});\n  node["tourism"="museum"](around:${radius},${midpoint.latitude},${midpoint.longitude});\n);\nout body 20;`;
      const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: queryStr });
      const data     = await response.json() as OverpassResponse;
      if (Array.isArray(data.elements) && data.elements.length > 0) {
        const places: DateSuggestion[] = data.elements
          .filter((p): p is FirestorePlaceElement & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
          .map((p) => ({
            name:      p.tags?.name || 'Unnamed Place',
            type:      p.tags?.amenity || p.tags?.leisure || p.tags?.tourism || 'Place',
            address:   [p.tags?.['addr:housenumber'], p.tags?.['addr:street'], p.tags?.['addr:city']].filter(Boolean).join(' ') || 'Address not available',
            distance:  Math.round(calculateDistance(midpoint.latitude, midpoint.longitude, p.lat, p.lon) * 10) / 10,
            latitude:  p.lat, longitude: p.lon,
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 10);
        setDateSuggestions(places);
      } else { Alert.alert('No Results', 'No places found nearby.'); }
    } catch (error) { console.error('Error finding places:', error); Alert.alert('Error', 'Failed to find date places.'); }
    finally { setLoadingPlaces(false); }
  }, [myLocation, matchData?.location]);

  const sharePlace = useCallback((place: DateSuggestion) => {
    setNewMessage(`How about we meet at ${place.name}?\n📍 ${place.address}\n🚶 ${place.distance} km from midpoint`);
    setShowDatePlannerModal(false);
  }, []);

  const openInMaps = useCallback(async (place: DateSuggestion) => {
    try {
      const target  = place.latitude != null && place.longitude != null ? `${place.latitude},${place.longitude}` : `${place.name} ${place.address}`;
      const url     = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
      const supported = await Linking.canOpenURL(url);
      if (!supported) { Alert.alert('Error', 'Unable to open maps.'); return; }
      await Linking.openURL(url);
    } catch (error) { console.error('Failed to open maps:', error); Alert.alert('Error', 'Unable to open maps.'); }
  }, []);

  const initiateCall = useCallback((type: 'video' | 'audio') => {
    setCallType(type); setShowVideoCallPrompt(true);
  }, []);

  const startCall = useCallback(async () => {
    if (!user?.uid || !matchId || !chatId) return;
    const roomName   = `myarchetype-${chatId}-${Date.now()}`;
    const jitsiUrl   = callType === 'video' ? `https://meet.jit.si/${roomName}` : `https://meet.jit.si/${roomName}#config.startWithVideoMuted=true`;
    const callIcon   = callType === 'video' ? '📹' : '📞';
    const callMessage = `${callIcon} ${callType === 'video' ? 'Video' : 'Audio'} call started!\n\nJoin here: ${jitsiUrl}`;
    try {
      await ensureChatExists();
      const encrypted = await encryptTextForRecipient(callMessage, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false,
        version: encrypted.version, messageType: 'system',
        ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
        senderPublicKey: encrypted.senderPublicKey, senderKeyVersion: encrypted.senderKeyVersion,
      });
      await sendPushNotification(`${callIcon} Started a ${callType} call`);
      const supported = await Linking.canOpenURL(jitsiUrl);
      if (!supported) { Alert.alert('Error', 'Unable to open call link'); return; }
      await Linking.openURL(jitsiUrl);
      setShowVideoCallPrompt(false);
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (error) { console.error('Error starting call:', error); Alert.alert('Error', 'Failed to start call'); }
  }, [user?.uid, matchId, chatId, callType, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  const handleUnmatch = useCallback(() => {
    if (!user?.uid || !matchId) return;
    Alert.alert(`Unmatch with ${matchName}?`, 'This will end the conversation and remove them from your matches. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unmatch', style: 'destructive', onPress: async () => {
        try {
          const callable = httpsCallable<{ otherUserId: string }, { success: boolean }>(functions, 'unmatchUsers');
          await callable({ otherUserId: matchId });
          Alert.alert('Success', `You've unmatched with ${matchName}`);
          router.replace('/my-matches');
        } catch (error) { console.error('Error unmatching:', error); Alert.alert('Error', 'Error unmatching'); }
      }},
    ]);
  }, [user?.uid, matchId, matchName, router, functions]);

  const handleReport = useCallback(() => {
    if (!user?.uid || !matchId) return;
    setReportReason(''); setShowReportModal(true);
  }, [user?.uid, matchId]);

  const submitReport = useCallback(async () => {
    if (!reportReason.trim() || !user?.uid || !matchId) { Alert.alert('Missing Information', 'Please describe the issue before submitting.'); return; }
    setSubmittingReport(true);
    try {
      const callable = httpsCallable<{ reportedUserId: string; reason: string; description?: string }, { success: boolean; reportId: string }>(functions, 'submitReport');
      await callable({ reportedUserId: matchId, reason: reportReason.trim(), description: reportReason.trim() });
      setShowReportModal(false); Alert.alert('Report Submitted', 'Thank you for helping keep our community safe.');
    } catch (error) { console.error('Error reporting:', error); Alert.alert('Error', 'Error submitting report'); }
    finally { setSubmittingReport(false); }
  }, [user?.uid, matchId, reportReason, functions]);

  const handleBlock = useCallback(() => {
    if (!user?.uid || !matchId) return;
    Alert.alert(`Block ${matchName}?`, "They won't be able to see your profile or contact you. You will also be unmatched.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => {
        try {
          const callable = httpsCallable<{ blockedUserId: string; reason?: string }, { success: boolean }>(functions, 'blockUser');
          await callable({ blockedUserId: matchId });
          Alert.alert('Blocked', `You've blocked ${matchName}`);
          router.replace('/my-matches');
        } catch (error) { console.error('Error blocking:', error); Alert.alert('Error', 'Error blocking user'); }
      }},
    ]);
  }, [user?.uid, matchId, matchName, router, functions]);

  const handleMessageLongPress = useCallback((item: Message) => {
    setSelectedMessage(item); setShowMessageOptionsModal(true);
  }, []);

  const handleMessageAction = useCallback((action: MessageAction) => {
    if (!selectedMessage) return;
    setShowMessageOptionsModal(false);
    switch (action) {
      case 'react':
        setShowReactionPicker(true); break;
      case 'translate':
        void handleTranslateMessage(selectedMessage.id, selectedMessage.text);
        setSelectedMessage(null); break;
      case 'pin':
        if (pinnedLookup.has(selectedMessage.id)) void handleUnpinMessage(selectedMessage.id);
        else void handlePinMessage(selectedMessage.id, selectedMessage.text);
        setSelectedMessage(null); break;
    }
  }, [selectedMessage, pinnedLookup, handleTranslateMessage, handlePinMessage, handleUnpinMessage]);

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isMe             = item.senderId === user?.uid;
    const messageReactions = groupReactions(item.reactions || []);
    const isTranslated     = !!translatedMessages[item.id];
    const isPinned         = pinnedLookup.has(item.id);
    return (
      <TouchableOpacity
        onLongPress={() => handleMessageLongPress(item)}
        delayLongPress={500}
        activeOpacity={0.8}
        accessibilityLabel={`${isMe ? 'You' : matchName}: ${item.text || (item.imageUrl ? 'Image' : item.voiceUrl ? 'Voice message' : 'Message')}`}
        accessibilityRole="button"
        accessibilityHint="Long press for message options">
        <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
          {isPinned && <View style={styles.pinnedIndicator}><Text style={styles.pinnedIndicatorText}>📌 Pinned</Text></View>}
          {item.imageUrl && (
            <TouchableOpacity onPress={() => setPreviewImage(item.imageUrl || null)} accessibilityLabel={item.isGif ? 'View GIF' : 'View full image'} accessibilityRole="button">
              <Image source={{ uri: item.imageUrl }} style={styles.messageImage} resizeMode="cover" accessibilityLabel={item.isGif ? 'GIF image' : 'Sent photo'} />
              {item.isGif && <View style={styles.gifBadge}><Text style={styles.gifBadgeText}>GIF</Text></View>}
            </TouchableOpacity>
          )}
          {item.voiceUrl && (
            <TouchableOpacity
              style={styles.voiceMessageContainer}
              onPress={() => playVoiceMessage(item.voiceUrl!)}
              accessibilityLabel={`Voice message, ${formatDuration(item.voiceDuration || 0)} long. ${playingAudio === item.voiceUrl ? 'Tap to pause' : 'Tap to play'}`}
              accessibilityRole="button">
              <Text style={styles.voicePlayButton}>{playingAudio === item.voiceUrl ? '⏸' : '▶️'}</Text>
              <View style={styles.voiceWaveform}>
                {WAVEFORM_BARS.map((barHeight, i) => (
                  <View key={i} style={[styles.voiceBar, { height: barHeight, backgroundColor: playingAudio === item.voiceUrl ? (isMe ? '#fff' : '#53a8b6') : (isMe ? 'rgba(255,255,255,0.5)' : '#555') }]} />
                ))}
              </View>
              <Text style={[styles.voiceDuration, isMe && styles.voiceDurationMe]}>{formatDuration(item.voiceDuration || 0)}</Text>
            </TouchableOpacity>
          )}
          {item.text ? (
            <>
              <Text style={[styles.messageText, isMe && styles.myMessageText]}>{item.text}</Text>
              {isTranslated && (
                <View style={styles.translationContainer}>
                  <Text style={styles.translationLabel}>🌐 Translated:</Text>
                  <Text style={[styles.messageText, isMe && styles.myMessageText, styles.translatedText]}>{translatedMessages[item.id]}</Text>
                </View>
              )}
              {translatingMessage === item.id && (
                <View style={styles.translatingIndicator}>
                  <ActivityIndicator size="small" color={isMe ? '#fff' : '#53a8b6'} />
                  <Text style={[styles.translatingText, isMe && styles.translatingTextMe]}>Translating...</Text>
                </View>
              )}
            </>
          ) : null}
          {messageReactions.length > 0 && (
            <View style={styles.reactionsContainer}>
              {messageReactions.map((reaction, index) => (
                <TouchableOpacity
                  key={`${reaction.emoji}-${index}`}
                  style={[styles.reactionBubble, hasUserReacted(item.reactions || [], user?.uid || '', reaction.emoji) && styles.reactionBubbleActive]}
                  onPress={() => { void handleReaction(item.id, reaction.emoji); }}
                  accessibilityLabel={`${reaction.emoji} reaction, ${reaction.count} ${reaction.count === 1 ? 'person' : 'people'}. Tap to react.`}
                  accessibilityRole="button">
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  <Text style={styles.reactionCount}>{reaction.count}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.messageFooter}>
            <Text style={[styles.messageTime, isMe && styles.myMessageTime]}>{formatTime(item.timestamp)}</Text>
            {isMe && chatSettings?.readReceiptsEnabled !== false && <Text style={styles.readReceipt}>{item.read ? ' ✓✓' : ' ✓'}</Text>}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [user?.uid, matchName, pinnedLookup, translatedMessages, translatingMessage, playingAudio, chatSettings?.readReceiptsEnabled, handleMessageLongPress, playVoiceMessage, handleReaction]);

  // ─── Guard ────────────────────────────────────────────────

  if (!user?.uid || !matchId || !chatId) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <Text style={styles.errorText}>Unable to load this chat.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => router.replace('/my-matches')} accessibilityLabel="Go back to matches" accessibilityRole="button">
          <Text style={styles.primaryButtonText}>← Back to Matches</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Render ───────────────────────────────────────────────

  return (
    <KeyboardAvoidingView style={[styles.container, wallpaperStyle]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButtonContainer} onPress={() => router.replace('/my-matches')} accessibilityLabel="Go back to matches" accessibilityRole="button">
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
        <TouchableOpacity style={styles.menuButton} onPress={() => setShowMenuModal(true)} accessibilityLabel="Open chat options menu" accessibilityRole="button">
          <Text style={styles.menuButtonText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* Quick actions */}
      <View style={styles.quickActions}>
        {([
          { icon: '📹', label: 'Start video call',           onPress: () => initiateCall('video') },
          { icon: '📞', label: 'Start audio call',           onPress: () => initiateCall('audio') },
          { icon: '📍', label: 'Plan a date',                onPress: () => setShowDatePlannerModal(true) },
          { icon: '💡', label: 'View date ideas',            onPress: () => setShowDateIdeasModal(true) },
          { icon: '💬', label: 'View conversation starters', onPress: () => setShowStartersModal(true) },
          { icon: '📝', label: 'View match notes',           onPress: () => setShowNoteModal(true) },
        ] as const).map((btn, i) => (
          <TouchableOpacity key={i} style={styles.quickActionButton} onPress={btn.onPress} accessibilityLabel={btn.label} accessibilityRole="button">
            <Text style={styles.quickActionText}>{btn.icon}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Pinned bar */}
      {pinnedMessages.length > 0 && (
        <TouchableOpacity style={styles.pinnedBar} onPress={() => setShowPinnedMessagesModal(true)} accessibilityLabel={`View ${pinnedMessages.length} pinned message${pinnedMessages.length > 1 ? 's' : ''}`} accessibilityRole="button">
          <Text style={styles.pinnedBarIcon}>📌</Text>
          <Text style={styles.pinnedBarText} numberOfLines={1}>{pinnedMessages[0]?.text ?? ''}</Text>
          {pinnedMessages.length > 1 && <Text style={styles.pinnedBarCount}>+{pinnedMessages.length - 1}</Text>}
        </TouchableOpacity>
      )}

      {/* Rating banner */}
      {showRatingPrompt && (
        <TouchableOpacity style={styles.ratingBanner} onPress={() => router.push({ pathname: '/post-date-rating', params: { matchId, matchName } })} accessibilityLabel={`Rate your experience with ${matchName}`} accessibilityRole="button">
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
          <TouchableOpacity style={styles.starterPromptButton} onPress={() => setShowStartersModal(true)} accessibilityLabel="Get conversation starter ideas" accessibilityRole="button">
            <Text style={styles.starterPromptText}>💡 Need conversation starters?</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.listContainer}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesList}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel="Chat messages"
            onContentSizeChange={() => { if (shouldAutoScrollRef.current) scrollToBottom(false); }}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const nearBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 100;
              shouldAutoScrollRef.current = nearBottom;
              setShowScrollToBottom(!nearBottom);
            }}
            scrollEventThrottle={16}
          />
          {showScrollToBottom && (
            <TouchableOpacity
              style={styles.scrollToBottomButton}
              onPress={() => { shouldAutoScrollRef.current = true; setShowScrollToBottom(false); scrollToBottom(true); }}
              accessibilityLabel="Scroll to latest message"
              accessibilityRole="button">
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
          <TouchableOpacity style={styles.cancelRecordButton} onPress={() => void cancelRecording()} accessibilityLabel="Cancel recording" accessibilityRole="button"><Text style={styles.cancelRecordText}>✕</Text></TouchableOpacity>
          <TouchableOpacity style={styles.stopRecordButton} onPress={() => void stopRecording()} accessibilityLabel="Stop recording and send" accessibilityRole="button"><Text style={styles.stopRecordText}>Send</Text></TouchableOpacity>
        </View>
      )}

      {/* Input bar */}
      {!isRecording && (
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.mediaButton} onPress={() => void handlePickImage()} disabled={sending || uploadingMedia} accessibilityLabel="Attach photo from library" accessibilityRole="button"><Text style={styles.mediaButtonText}>🖼️</Text></TouchableOpacity>
          <TouchableOpacity style={styles.mediaButton} onPress={() => void handleTakePhoto()} disabled={sending || uploadingMedia} accessibilityLabel="Take a photo" accessibilityRole="button"><Text style={styles.mediaButtonText}>📷</Text></TouchableOpacity>
          <TouchableOpacity style={styles.gifButton} onPress={() => setShowGifPicker(true)} disabled={sending || uploadingMedia} accessibilityLabel="Send a GIF" accessibilityRole="button"><Text style={styles.gifButtonText}>GIF</Text></TouchableOpacity>
          <TouchableOpacity style={styles.mediaButton} onPress={() => void startRecording()} disabled={sending || uploadingMedia} accessibilityLabel="Record a voice message" accessibilityRole="button"><Text style={styles.mediaButtonText}>🎤</Text></TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#666"
            value={newMessage}
            onChangeText={handleTextChange}
            onSubmitEditing={() => void sendMessage()}
            editable={!sending && !uploadingMedia}
            multiline maxLength={500}
            accessibilityLabel="Message input"
            accessibilityHint="Type your message here"
          />
          <TouchableOpacity
            style={[styles.sendButton, (!newMessage.trim() || sending || uploadingMedia) && styles.sendButtonDisabled]}
            onPress={() => void sendMessage()}
            disabled={!newMessage.trim() || sending || uploadingMedia}
            accessibilityLabel="Send message"
            accessibilityRole="button"
            accessibilityState={{ disabled: !newMessage.trim() || sending || uploadingMedia }}>
            <Text style={styles.sendButtonText}>{sending ? '...' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Modals ─── */}

      {/* Menu modal */}
      <Modal visible={showMenuModal} transparent animationType="fade" onRequestClose={() => setShowMenuModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowMenuModal(false)}>
          <View style={styles.menuContainer}>
            <ScrollView bounces={false}>
              <Text style={styles.menuTitle}>Options</Text>
              {([
                { icon: '📹', label: 'Video Call',                onPress: () => { setShowMenuModal(false); initiateCall('video'); } },
                { icon: '📞', label: 'Audio Call',                onPress: () => { setShowMenuModal(false); initiateCall('audio'); } },
                { icon: '📍', label: 'Plan Date',                 onPress: () => { setShowMenuModal(false); setShowDatePlannerModal(true); } },
                { icon: '💡', label: 'Date Ideas',                onPress: () => { setShowMenuModal(false); setShowDateIdeasModal(true); } },
                { icon: '💬', label: 'Conversation Starters',     onPress: () => { setShowMenuModal(false); setShowStartersModal(true); } },
                { icon: '📝', label: 'Match Notes',               onPress: () => { setShowMenuModal(false); setShowNoteModal(true); } },
                { icon: '📌', label: 'Pinned Messages',           onPress: () => { setShowMenuModal(false); setShowPinnedMessagesModal(true); } },
                { icon: '⏱️', label: 'Disappearing Messages',     onPress: () => { setShowMenuModal(false); setShowDisappearingModal(true); } },
                { icon: '⚙️', label: 'Chat Settings',             onPress: () => { setShowMenuModal(false); setShowSettingsModal(true); } },
                { icon: '🚨', label: 'Report User',               onPress: () => { setShowMenuModal(false); handleReport(); }, destructive: true },
                { icon: '🚫', label: 'Block User',                onPress: () => { setShowMenuModal(false); handleBlock(); }, destructive: true },
                { icon: '💔', label: 'Unmatch',                   onPress: () => { setShowMenuModal(false); handleUnmatch(); }, destructive: true },
              ] as const).map((item, index) => (
                <TouchableOpacity key={index} style={styles.menuItem} onPress={item.onPress} accessibilityLabel={item.label} accessibilityRole="button">
                  <Text style={styles.menuItemIcon}>{item.icon}</Text>
                  <Text style={[styles.menuItemText, 'destructive' in item && item.destructive && styles.menuItemTextDestructive]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.menuCancelButton} onPress={() => setShowMenuModal(false)} accessibilityLabel="Close menu" accessibilityRole="button"><Text style={styles.menuCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Message options modal */}
      <Modal visible={showMessageOptionsModal} transparent animationType="fade" onRequestClose={() => setShowMessageOptionsModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowMessageOptionsModal(false)}>
          <View style={styles.messageOptionsContainer}>
            {([
              { icon: '❤️', label: 'React',     action: 'react'      as MessageAction },
              { icon: '🌐', label: 'Translate',  action: 'translate'  as MessageAction },
              { icon: '📌', label: selectedMessage && pinnedLookup.has(selectedMessage.id) ? 'Unpin' : 'Pin', action: 'pin' as MessageAction },
            ] as const).map((opt) => (
              <TouchableOpacity key={opt.action} style={styles.messageOption} onPress={() => handleMessageAction(opt.action)} accessibilityLabel={opt.label} accessibilityRole="button">
                <Text style={styles.messageOptionIcon}>{opt.icon}</Text>
                <Text style={styles.messageOptionText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Reaction picker */}
      <Modal visible={showReactionPicker} transparent animationType="fade" onRequestClose={() => setShowReactionPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowReactionPicker(false)}>
          <View style={styles.reactionPicker}>
            {REACTION_EMOJIS.map((emoji, index) => (
              <TouchableOpacity key={index} style={styles.reactionPickerItem} onPress={() => { if (selectedMessage) void handleReaction(selectedMessage.id, emoji); }} accessibilityLabel={`React with ${emoji}`} accessibilityRole="button">
                <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* GIF picker */}
      <Modal visible={showGifPicker} animationType="slide" onRequestClose={() => setShowGifPicker(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowGifPicker(false)} accessibilityLabel="Close GIF picker" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>🎬 Send a GIF</Text>
            <View style={styles.modalSpacer} />
          </View>
          <View style={styles.gifSearchContainer}>
            <TextInput style={styles.gifSearchInput} placeholder="Search GIFs..." placeholderTextColor="#666" value={gifSearchQuery} onChangeText={handleGifSearchInput} accessibilityLabel="Search GIFs" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gifCategories}>
            {GIF_CATEGORIES.map((category, index) => (
              <TouchableOpacity key={index} style={styles.gifCategoryButton} onPress={() => handleGifCategoryPress(category.query)} accessibilityLabel={`Browse ${category.label} GIFs`} accessibilityRole="button">
                <Text style={styles.gifCategoryText}>{category.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {loadingGifs
            ? <View style={styles.gifLoading}><ActivityIndicator size="large" color="#53a8b6" /></View>
            : (
              <ScrollView contentContainerStyle={styles.gifResults}>
                {gifResults.length === 0
                  ? <Text style={styles.emptyModalText}>No GIFs found</Text>
                  : gifResults.map((gif) => (
                    <TouchableOpacity key={gif.id} style={styles.gifItem} onPress={() => void sendGif(gif)} accessibilityLabel="Send this GIF" accessibilityRole="button">
                      <Image source={{ uri: gif.previewUrl }} style={styles.gifImage} resizeMode="cover" accessibilityLabel="GIF preview" />
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            )}
          <View style={styles.gifFooter}><Text style={styles.gifPoweredBy}>Powered by GIPHY</Text></View>
        </View>
      </Modal>

      {/* Pinned messages modal */}
      <Modal visible={showPinnedMessagesModal} animationType="slide" onRequestClose={() => setShowPinnedMessagesModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowPinnedMessagesModal(false)} accessibilityLabel="Close pinned messages" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>📌 Pinned Messages</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView style={styles.modalContent}>
            {pinnedMessages.length === 0
              ? <Text style={styles.emptyModalText}>No pinned messages yet</Text>
              : pinnedMessages.map((pinned, index) => (
                <View key={index} style={styles.pinnedMessageCard}>
                  <Text style={styles.pinnedMessageText}>{pinned.text}</Text>
                  <TouchableOpacity style={styles.unpinButton} onPress={() => void handleUnpinMessage(pinned.messageId)} accessibilityLabel="Unpin this message" accessibilityRole="button">
                    <Text style={styles.unpinButtonText}>Unpin</Text>
                  </TouchableOpacity>
                </View>
              ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Disappearing messages modal */}
      <Modal visible={showDisappearingModal} animationType="slide" onRequestClose={() => setShowDisappearingModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDisappearingModal(false)} accessibilityLabel="Close disappearing messages settings" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>⏱️ Disappearing Messages</Text>
            <View style={styles.modalSpacer} />
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.modalInfo}>Messages will automatically delete after the selected time period.</Text>
            {(['off', '24h', '7d', '30d'] as DisappearingMode[]).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.optionItem, disappearingMode === mode && styles.optionItemActive]}
                onPress={() => void handleSetDisappearing(mode)}
                accessibilityLabel={`Set disappearing messages to ${getDisappearingLabel(mode)}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: disappearingMode === mode }}>
                <Text style={[styles.optionItemText, disappearingMode === mode && styles.optionItemTextActive]}>{getDisappearingLabel(mode)}</Text>
                {disappearingMode === mode && <Text style={styles.optionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Chat settings modal */}
      <Modal visible={showSettingsModal} animationType="slide" onRequestClose={() => setShowSettingsModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowSettingsModal(false)} accessibilityLabel="Close chat settings" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>⚙️ Chat Settings</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.sectionTitle}>Wallpaper</Text>
            <View style={styles.wallpaperGrid}>
              {CHAT_WALLPAPERS.map((wallpaper) => (
                <TouchableOpacity
                  key={wallpaper.id}
                  style={[
                    styles.wallpaperOption,
                    { backgroundColor: 'gradient' in wallpaper && Array.isArray(wallpaper.gradient) && wallpaper.gradient.length > 0 ? wallpaper.gradient[0] : 'color' in wallpaper ? (wallpaper as { color: string }).color : '#16213e' },
                    chatSettings?.wallpaper === wallpaper.id && styles.wallpaperOptionActive,
                  ]}
                  disabled={updatingChatSettings}
                  accessibilityLabel={`Set ${wallpaper.name} wallpaper`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chatSettings?.wallpaper === wallpaper.id }}
                  onPress={async () => {
                    try {
                      setUpdatingChatSettings(true);
                      await updateChatSettings(chatId, { wallpaper: wallpaper.id });
                      setChatSettings((prev) => ({ ...(prev ?? DEFAULT_CHAT_SETTINGS), wallpaper: wallpaper.id }));
                    } catch (error) { console.error('Failed to update wallpaper:', error); Alert.alert('Error', 'Failed to update wallpaper'); }
                    finally { setUpdatingChatSettings(false); }
                  }}>
                  <Text style={styles.wallpaperName}>{wallpaper.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.sectionTitle}>Privacy</Text>
            {([
              { label: 'Read Receipts',      key: 'readReceiptsEnabled'     as const },
              { label: 'Typing Indicators',  key: 'typingIndicatorsEnabled' as const },
            ] as const).map((toggle) => (
              <TouchableOpacity
                key={toggle.key}
                style={styles.toggleItem}
                disabled={updatingChatSettings}
                accessibilityLabel={`${toggle.label}: ${chatSettings?.[toggle.key] ? 'on' : 'off'}. Tap to toggle.`}
                accessibilityRole="switch"
                accessibilityState={{ checked: chatSettings?.[toggle.key] ?? true }}
                onPress={async () => {
                  const newValue = !(chatSettings?.[toggle.key] ?? true);
                  try {
                    setUpdatingChatSettings(true);
                    await updateChatSettings(chatId, { [toggle.key]: newValue });
                    setChatSettings((prev) => ({ ...(prev ?? DEFAULT_CHAT_SETTINGS), [toggle.key]: newValue }));
                  } catch (error) { console.error('Failed to update:', error); Alert.alert('Error', 'Failed to update setting'); }
                  finally { setUpdatingChatSettings(false); }
                }}>
                <Text style={styles.toggleText}>{toggle.label}</Text>
                <View style={[styles.toggleSwitch, chatSettings?.[toggle.key] && styles.toggleSwitchActive]}>
                  <View style={[styles.toggleKnob, chatSettings?.[toggle.key] && styles.toggleKnobActive]} />
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Note modal */}
      <Modal visible={showNoteModal} animationType="slide" onRequestClose={() => setShowNoteModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowNoteModal(false)} accessibilityLabel="Close notes" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>📝 Note about {matchName}</Text>
            <View style={styles.modalSpacer} />
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.modalInfo}>Private notes only you can see.</Text>
            <TextInput style={styles.noteInput} placeholder="Add notes about this match..." placeholderTextColor="#666" value={matchNote} onChangeText={setMatchNote} multiline maxLength={500} accessibilityLabel="Match notes input" />
            <Text style={styles.charCount}>{matchNote.length}/500</Text>
            <TouchableOpacity
              style={[styles.primaryButton, savingNote && styles.primaryButtonDisabled]}
              onPress={() => void handleSaveNote()}
              disabled={savingNote}
              accessibilityLabel="Save note"
              accessibilityRole="button"
              accessibilityState={{ disabled: savingNote }}>
              <Text style={styles.primaryButtonText}>{savingNote ? 'Saving...' : '💾 Save Note'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Starters modal */}
      <Modal visible={showStartersModal} animationType="slide" onRequestClose={() => setShowStartersModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowStartersModal(false)} accessibilityLabel="Close conversation starters" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>💬 Conversation Starters</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalInfo}>Tap a starter to use it as your message!</Text>
            {conversationStarters.map((starter, index) => (
              <TouchableOpacity key={index} style={styles.starterCard} onPress={() => { setNewMessage(starter); setShowStartersModal(false); }} accessibilityLabel={`Use as message: ${starter}`} accessibilityRole="button">
                <Text style={styles.starterText}>{starter}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Date ideas modal */}
      <Modal visible={showDateIdeasModal} animationType="slide" onRequestClose={() => setShowDateIdeasModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDateIdeasModal(false)} accessibilityLabel="Close date ideas" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>💡 Date Ideas</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalInfo}>AI-generated date ideas based on your profiles!</Text>
            {dateIdeas.map((idea, index) => (
              <TouchableOpacity key={index} style={styles.dateIdeaCard} onPress={() => { setNewMessage(`How about this for our date? 💕\n\n${idea.idea}\n\nVibe: ${idea.vibe}`); setShowDateIdeasModal(false); }} accessibilityLabel={`Suggest date idea: ${idea.idea}`} accessibilityRole="button">
                <Text style={styles.dateIdeaText}>{idea.idea}</Text>
                <View style={styles.dateIdeaVibe}><Text style={styles.dateIdeaVibeLabel}>Vibe: </Text><Text style={styles.dateIdeaVibeValue}>{idea.vibe}</Text></View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Date planner modal */}
      <Modal visible={showDatePlannerModal} animationType="slide" onRequestClose={() => setShowDatePlannerModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDatePlannerModal(false)} accessibilityLabel="Close date planner" accessibilityRole="button"><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>📍 Plan a Date</Text>
            <View style={styles.modalSpacer} />
          </View>
          <View style={styles.modalContent}>
            {!myLocation || !matchData?.location
              ? <Text style={styles.errorText}>Location data not available for both users.</Text>
              : (
                <>
                  <Text style={styles.modalInfo}>Find places between you and {matchName}</Text>
                  {loadingPlaces
                    ? <View style={styles.loadingCenter}><ActivityIndicator size="large" color="#53a8b6" /><Text style={styles.loadingText}>Finding places...</Text></View>
                    : dateSuggestions.length === 0
                      ? <TouchableOpacity style={styles.primaryButton} onPress={() => void findDatePlaces()} accessibilityLabel="Find date places nearby" accessibilityRole="button"><Text style={styles.primaryButtonText}>🔍 Find Places</Text></TouchableOpacity>
                      : (
                        <ScrollView>
                          {dateSuggestions.map((place, index) => (
                            <View key={index} style={styles.placeCard}>
                              <View style={styles.placeInfo}>
                                <Text style={styles.placeName}>{place.name}</Text>
                                <Text style={styles.placeType}>{place.type}</Text>
                                <Text style={styles.placeAddress}>{place.address}</Text>
                                <Text style={styles.placeDistance}>🚶 {place.distance} km away</Text>
                              </View>
                              <View style={styles.placeActions}>
                                <TouchableOpacity style={styles.placeActionButton} onPress={() => sharePlace(place)} accessibilityLabel={`Share ${place.name} in chat`} accessibilityRole="button"><Text style={styles.placeActionText}>💬 Share</Text></TouchableOpacity>
                                <TouchableOpacity style={styles.placeActionButton} onPress={() => void openInMaps(place)} accessibilityLabel={`Open ${place.name} in maps`} accessibilityRole="button"><Text style={styles.placeActionText}>🗺️ Maps</Text></TouchableOpacity>
                              </View>
                            </View>
                          ))}
                        </ScrollView>
                      )}
                </>
              )}
          </View>
        </View>
      </Modal>

      {/* Video call prompt */}
      <Modal visible={showVideoCallPrompt} transparent animationType="fade" onRequestClose={() => setShowVideoCallPrompt(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.promptContainer}>
            <Text style={styles.promptTitle}>{callType === 'video' ? '📹' : '📞'} Start {callType === 'video' ? 'Video' : 'Audio'} Call?</Text>
            <Text style={styles.promptText}>{`You're about to start a ${callType} call with ${matchName}.\n\nA secure link will be sent in the chat.`}</Text>
            <View style={styles.promptButtons}>
              <TouchableOpacity style={styles.promptCancelButton} onPress={() => setShowVideoCallPrompt(false)} accessibilityLabel="Cancel call" accessibilityRole="button"><Text style={styles.promptCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.promptConfirmButton} onPress={() => void startCall()} accessibilityLabel={`Start ${callType} call with ${matchName}`} accessibilityRole="button"><Text style={styles.promptConfirmText}>Start Call</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report modal */}
      <Modal visible={showReportModal} transparent animationType="fade" onRequestClose={() => setShowReportModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.promptContainer}>
            <Text style={styles.promptTitle}>🚨 Report {matchName}</Text>
            <Text style={styles.promptText}>Why are you reporting this user?</Text>
            <TextInput style={[styles.noteInput, styles.reportInput]} placeholder="Describe the issue..." placeholderTextColor="#666" value={reportReason} onChangeText={setReportReason} multiline maxLength={500} accessibilityLabel="Describe the issue" />
            <View style={[styles.promptButtons, styles.promptButtonsWithMargin]}>
              <TouchableOpacity style={styles.promptCancelButton} onPress={() => setShowReportModal(false)} disabled={submittingReport} accessibilityLabel="Cancel report" accessibilityRole="button"><Text style={styles.promptCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity
                style={[styles.promptConfirmButton, styles.reportSubmitButton, submittingReport && styles.primaryButtonDisabled]}
                onPress={() => void submitReport()}
                disabled={submittingReport}
                accessibilityLabel="Submit report"
                accessibilityRole="button"
                accessibilityState={{ disabled: submittingReport }}>
                <Text style={styles.promptConfirmText}>{submittingReport ? 'Submitting...' : 'Submit'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Image preview modal */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.imagePreviewModal}>
          <TouchableOpacity style={styles.closePreviewButton} onPress={() => setPreviewImage(null)} accessibilityLabel="Close image preview" accessibilityRole="button">
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
});