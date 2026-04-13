import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import {
  addDoc, collection, doc, getDoc, getDocs,
  limit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc,
  startAfter,
  updateDoc,
  type DocumentSnapshot
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ActivityIndicator, Alert, Animated, BackHandler,
  FlatList,
  Image, Keyboard, KeyboardAvoidingView,
  Modal, Platform, Pressable, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput,
  View, type NativeScrollEvent, type NativeSyntheticEvent
} from 'react-native';
import { auth, db, storage } from '../firebaseConfig';
import { checkImageSafety, checkTextSafety } from '../utils/contentSafety';
import { encryptAndUploadImageForRecipient, encryptTextForRecipient, ensureSignalIdentity } from '../utils/e2ee';
import { logger, writeAuditLog } from '../utils/logger';
import { checkMessageSend, checkPhotoUpload } from '../utils/safetyMiddleware';

const IS_IOS = Platform.OS === 'ios';
const IS_WEB = Platform.OS === 'web';
const PAGE_SIZE = 30;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NOTE_LENGTH = 500;

type MatchData = {
  id: string; name: string; age: number; photo: string; isOnline: boolean;
  lastSeen: Date | null; verified: boolean; premium: boolean;
};

type MessageReaction = { emoji: string; userIds: string[] }[];
type Message = {
  id: string; senderId: string; text?: string; timestamp: Date | null;
  read: boolean; type: 'text' | 'image' | 'gif' | 'voice' | 'system';
  mediaUrl?: string; mediaMimeType?: string; mediaSizeBytes?: number;
  reactions?: MessageReaction; pinned?: boolean;
  translatedText?: string; isTranslating?: boolean;
  voiceDuration?: number; voiceWaveform?: number[];
  encryptedMediaKey?: string; mediaKeyNonce?: string; mediaCipherNonce?: string;
  version?: number; ciphertext?: string; nonce?: string;
  senderPublicKey?: string; senderKeyVersion?: number;
  isGif?: boolean;
};

type ChatCoreState = {
  messages: Message[]; inputText: string; loading: boolean; sending: boolean;
  uploadingMedia: boolean; recordingAudio: boolean; recordingDuration: number;
  showMenu: boolean; showEmojiPicker: boolean; showGifPicker: boolean;
  gifSearchQuery: string; gifResults: any[]; loadingGifs: boolean;
  showPinned: boolean; showOptions: boolean; showReactionPicker: boolean;
  selectedMessageId: string | null; showReport: boolean; reportReason: string;
  submittingReport: boolean; showVideoPrompt: boolean; callType: 'video' | 'audio';
  noteText: string; showNote: boolean; savingNote: boolean;
  previewImage: string | null; matchData: MatchData | null;
  hasMore: boolean; lastDoc: DocumentSnapshot | null; loadingMore: boolean;
  disappearingEnabled: boolean; wallpaper: string | null;
  translationEnabled: boolean; showDateIdeas: boolean;
  dateIdeas: { text: string; vibe: string }[]; loadingDateIdeas: boolean;
  showNearby: boolean; nearbyPlaces: any[]; loadingNearby: boolean;
};

type ChatCoreAction =
  | { type: 'SET_MESSAGES'; payload: Message[] }
  | { type: 'ADD_MESSAGES_TOP'; payload: Message[] }
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_SENDING'; payload: boolean }
  | { type: 'SET_UPLOADING'; payload: boolean }
  | { type: 'SET_RECORDING'; payload: boolean }
  | { type: 'SET_RECORDING_DURATION'; payload: number }
  | { type: 'SET_MENU'; payload: boolean }
  | { type: 'SET_EMOJI'; payload: boolean }
  | { type: 'SET_GIF'; payload: boolean }
  | { type: 'SET_GIF_QUERY'; payload: string }
  | { type: 'SET_GIF_RESULTS'; payload: any[] }
  | { type: 'SET_LOADING_GIFS'; payload: boolean }
  | { type: 'SET_PINNED'; payload: boolean }
  | { type: 'SET_OPTIONS'; payload: boolean }
  | { type: 'SET_REACTION_PICKER'; payload: boolean }
  | { type: 'SET_SELECTED_MSG'; payload: string | null }
  | { type: 'SET_REPORT'; payload: boolean }
  | { type: 'SET_REPORT_REASON'; payload: string }
  | { type: 'SET_SUBMITTING_REPORT'; payload: boolean }
  | { type: 'SET_VIDEO_PROMPT'; payload: boolean }
  | { type: 'SET_CALL_TYPE'; payload: 'video' | 'audio' }
  | { type: 'SET_NOTE_TEXT'; payload: string }
  | { type: 'SET_NOTE'; payload: boolean }
  | { type: 'SET_SAVING_NOTE'; payload: boolean }
  | { type: 'SET_PREVIEW'; payload: string | null }
  | { type: 'SET_MATCH'; payload: MatchData | null }
  | { type: 'SET_HAS_MORE'; payload: boolean }
  | { type: 'SET_LAST_DOC'; payload: DocumentSnapshot | null }
  | { type: 'SET_LOADING_MORE'; payload: boolean }
  | { type: 'SET_DISAPPEARING'; payload: boolean }
  | { type: 'SET_WALLPAPER'; payload: string | null }
  | { type: 'SET_TRANSLATION'; payload: boolean }
  | { type: 'SET_DATE_IDEAS_SHOW'; payload: boolean }
  | { type: 'SET_DATE_IDEAS'; payload: { text: string; vibe: string }[] }
  | { type: 'SET_LOADING_DATES'; payload: boolean }
  | { type: 'SET_NEARBY_SHOW'; payload: boolean }
  | { type: 'SET_NEARBY'; payload: any[] }
  | { type: 'SET_LOADING_NEARBY'; payload: boolean }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; changes: Partial<Message> } }
  | { type: 'RESET' };

const initialCore: ChatCoreState = {
  messages: [], inputText: '', loading: true, sending: false,
  uploadingMedia: false, recordingAudio: false, recordingDuration: 0,
  showMenu: false, showEmojiPicker: false, showGifPicker: false,
  gifSearchQuery: '', gifResults: [], loadingGifs: false,
  showPinned: false, showOptions: false, showReactionPicker: false,
  selectedMessageId: null, showReport: false, reportReason: '',
  submittingReport: false, showVideoPrompt: false, callType: 'video',
  noteText: '', showNote: false, savingNote: false,
  previewImage: null, matchData: null,
  hasMore: false, lastDoc: null, loadingMore: false,
  disappearingEnabled: false, wallpaper: null,
  translationEnabled: false, showDateIdeas: false,
  dateIdeas: [], loadingDateIdeas: false,
  showNearby: false, nearbyPlaces: [], loadingNearby: false,
};

function coreReducer(state: ChatCoreState, action: ChatCoreAction): ChatCoreState {
  switch (action.type) {
    case 'SET_MESSAGES': return { ...state, messages: action.payload };
    case 'ADD_MESSAGES_TOP': return { ...state, messages: [...action.payload, ...state.messages] };
    case 'SET_INPUT': return { ...state, inputText: action.payload };
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_SENDING': return { ...state, sending: action.payload };
    case 'SET_UPLOADING': return { ...state, uploadingMedia: action.payload };
    case 'SET_RECORDING': return { ...state, recordingAudio: action.payload };
    case 'SET_RECORDING_DURATION': return { ...state, recordingDuration: action.payload };
    case 'SET_MENU': return { ...state, showMenu: action.payload };
    case 'SET_EMOJI': return { ...state, showEmojiPicker: action.payload };
    case 'SET_GIF': return { ...state, showGifPicker: action.payload };
    case 'SET_GIF_QUERY': return { ...state, gifSearchQuery: action.payload };
    case 'SET_GIF_RESULTS': return { ...state, gifResults: action.payload };
    case 'SET_LOADING_GIFS': return { ...state, loadingGifs: action.payload };
    case 'SET_PINNED': return { ...state, showPinned: action.payload };
    case 'SET_OPTIONS': return { ...state, showOptions: action.payload };
    case 'SET_REACTION_PICKER': return { ...state, showReactionPicker: action.payload };
    case 'SET_SELECTED_MSG': return { ...state, selectedMessageId: action.payload };
    case 'SET_REPORT': return { ...state, showReport: action.payload };
    case 'SET_REPORT_REASON': return { ...state, reportReason: action.payload };
    case 'SET_SUBMITTING_REPORT': return { ...state, submittingReport: action.payload };
    case 'SET_VIDEO_PROMPT': return { ...state, showVideoPrompt: action.payload };
    case 'SET_CALL_TYPE': return { ...state, callType: action.payload };
    case 'SET_NOTE_TEXT': return { ...state, noteText: action.payload };
    case 'SET_NOTE': return { ...state, showNote: action.payload };
    case 'SET_SAVING_NOTE': return { ...state, savingNote: action.payload };
    case 'SET_PREVIEW': return { ...state, previewImage: action.payload };
    case 'SET_MATCH': return { ...state, matchData: action.payload };
    case 'SET_HAS_MORE': return { ...state, hasMore: action.payload };
    case 'SET_LAST_DOC': return { ...state, lastDoc: action.payload };
    case 'SET_LOADING_MORE': return { ...state, loadingMore: action.payload };
    case 'SET_DISAPPEARING': return { ...state, disappearingEnabled: action.payload };
    case 'SET_WALLPAPER': return { ...state, wallpaper: action.payload };
    case 'SET_TRANSLATION': return { ...state, translationEnabled: action.payload };
    case 'SET_DATE_IDEAS_SHOW': return { ...state, showDateIdeas: action.payload };
    case 'SET_DATE_IDEAS': return { ...state, dateIdeas: action.payload };
    case 'SET_LOADING_DATES': return { ...state, loadingDateIdeas: action.payload };
    case 'SET_NEARBY_SHOW': return { ...state, showNearby: action.payload };
    case 'SET_NEARBY': return { ...state, nearbyPlaces: action.payload };
    case 'SET_LOADING_NEARBY': return { ...state, loadingNearby: action.payload };
    case 'UPDATE_MESSAGE': {
      const { id, changes } = action.payload;
      return { ...state, messages: state.messages.map(m => m.id === id ? { ...m, ...changes } : m) };
    }
    case 'RESET': return { ...initialCore };
    default: return state;
  }
}

type TypingState = { isTyping: boolean; theirTyping: boolean };

const getErrMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'An unknown error occurred';
};

const EMOJI_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'];

const DATE_IDEAS_PRESETS = [
  { text: 'Grab coffee at a cozy café and talk about your favorite books', vibe: '☕ Casual' },
  { text: 'Visit a local art gallery or museum exhibition', vibe: '🎨 Cultural' },
  { text: 'Take a sunset walk along the waterfront', vibe: '🌅 Romantic' },
  { text: 'Try a new restaurant neither of us has been to', vibe: '🍽️ Foodie' },
  { text: 'Go for a hike on a nearby trail', vibe: '🥾 Adventure' },
  { text: 'Attend a live music event or open mic night', vibe: '🎵 Music' },
  { text: 'Play board games at a local café', vibe: '🎲 Fun' },
  { text: 'Take a cooking class together', vibe: '👨‍🍳 Creative' },
];

export default function ChatScreen() {
  const router = useRouter();
  const chatId = React.useMemo(() => {
    try { const segs = router.segments ?? []; return String(segs[segs.length - 1] ?? ''); } catch { return ''; }
  }, [router.segments]);
  const user = auth.currentUser;
  const matchId = chatId && chatId.includes('_')
    ? chatId.split('_').find((s: string) => s !== user?.uid) ?? ''
    : '';

  const [core, setCore] = useReducer(coreReducer, initialCore);
  const [typing, setTyping] = useReducer((s: TypingState, a: Partial<TypingState>) => ({ ...s, ...a }), { isTyping: false, theirTyping: false });
  const flatListRef = useRef<FlatList>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const isMountedRef = useRef(true);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatCreatedRef = useRef(false);
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scrollBtnOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  const matchName = core.matchData?.name ?? 'Match';
  const matchPhoto = core.matchData?.photo;
  const matchAge = core.matchData?.age;
  const matchVerified = core.matchData?.verified ?? false;
  const matchOnline = core.matchData?.isOnline ?? false;
  const matchLastSeen = core.matchData?.lastSeen;

  // ─── Ensure chat doc exists ──────────────────────────────
  const ensureChatExists = useCallback(async () => {
    if (!chatId || !user?.uid || chatCreatedRef.current) return;
    try {
      const snap = await getDoc(doc(db, 'chats', chatId));
      if (!snap.exists()) {
        const participants = chatId.split('_');
        await setDoc(doc(db, 'chats', chatId), {
          participants, createdAt: serverTimestamp(), lastMessage: '', lastMessageAt: serverTimestamp(),
          lastMessageBy: user.uid, typing: {}, pinnedMessages: [], note: '',
          disappearing: false, wallpaper: null,
        });
      }
      chatCreatedRef.current = true;
    } catch (e) { logger.error('Error ensuring chat exists:', e); }
  }, [chatId, user?.uid]);

  // ─── Subscribe to messages ──────────────────────────────
  useEffect(() => {
    if (!chatId || !user?.uid) return;
    setCore({ type: 'SET_LOADING', payload: true });
    void ensureChatExists();
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
    const unsub = onSnapshot(q, snap => {
      if (!isMountedRef.current) return;
      const msgs: Message[] = [];
      snap.forEach(d => {
        const raw = d.data();
        msgs.push({
          id: d.id, senderId: raw.senderId ?? '', text: raw.text ?? raw.ciphertext ?? '',
          timestamp: raw.timestamp?.toDate?.() ?? null, read: raw.read ?? false,
          type: raw.messageType ?? (raw.isGif ? 'gif' : 'text'),
          mediaUrl: raw.mediaUrl, mediaMimeType: raw.mediaMimeType, mediaSizeBytes: raw.mediaSizeBytes,
          reactions: raw.reactions ?? [], pinned: raw.pinned ?? false,
          translatedText: raw.translatedText, isTranslating: raw.isTranslating ?? false,
          voiceDuration: raw.voiceDuration, voiceWaveform: raw.voiceWaveform,
          encryptedMediaKey: raw.encryptedMediaKey, mediaKeyNonce: raw.mediaKeyNonce,
          mediaCipherNonce: raw.mediaCipherNonce, version: raw.version,
          ciphertext: raw.ciphertext, nonce: raw.nonce,
          senderPublicKey: raw.senderPublicKey, senderKeyVersion: raw.senderKeyVersion,
          isGif: raw.isGif ?? false,
        });
      });
      msgs.reverse();
      setCore({ type: 'SET_MESSAGES', payload: msgs });
      setCore({ type: 'SET_LOADING', payload: false });
      setCore({ type: 'SET_HAS_MORE', payload: snap.size >= PAGE_SIZE });
      if (snap.size > 0) setCore({ type: 'SET_LAST_DOC', payload: snap.docs[snap.docs.length - 1] });
      if (shouldAutoScrollRef.current) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }, err => { logger.error('Messages snapshot error:', err); setCore({ type: 'SET_LOADING', payload: false }); });
    return unsub;
  }, [chatId, user?.uid, ensureChatExists]);

  // ─── Subscribe to chat metadata ─────────────────────────
  useEffect(() => {
    if (!chatId || !matchId) return;
    const unsub = onSnapshot(doc(db, 'chats', chatId), snap => {
      if (!isMountedRef.current || !snap.exists()) return;
      const d = snap.data();
      if (d.typing?.[matchId] && !typing.theirTyping) setTyping({ theirTyping: true });
      else if (!d.typing?.[matchId] && typing.theirTyping) setTyping({ theirTyping: false });
      if (d.note) setCore({ type: 'SET_NOTE_TEXT', payload: d.note });
      if (d.disappearing !== undefined) setCore({ type: 'SET_DISAPPEARING', payload: d.disappearing });
      if (d.wallpaper) setCore({ type: 'SET_WALLPAPER', payload: d.wallpaper });
    });
    return unsub;
  }, [chatId, matchId, typing.theirTyping]);

  // ─── Load match profile ─────────────────────────────────
  useEffect(() => {
    if (!matchId) return;
    getDoc(doc(db, 'users', matchId)).then(snap => {
      if (!isMountedRef.current || !snap.exists()) return;
      const d = snap.data();
      setCore({
        type: 'SET_MATCH', payload: {
          id: matchId, name: d.displayName ?? d.name ?? 'User', age: d.age ?? 0,
          photo: d.photos?.[0] ?? d.photoURL ?? '', isOnline: d.isOnline ?? false,
          lastSeen: d.lastSeen?.toDate?.() ?? null, verified: d.verified ?? false, premium: d.premium ?? false,
        },
      });
    }).catch(e => logger.error('Error loading match:', e));
  }, [matchId]);

  // ─── Entrance animation ─────────────────────────────────
  useEffect(() => { Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start(); }, [opacityAnim]);

  // ─── Back handler ───────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { router.back(); return true; });
    return () => sub.remove();
  }, [router]);

  // ─── Mark messages as read ──────────────────────────────
  useEffect(() => {
    if (!chatId || !user?.uid) return;
    const unread = core.messages.filter(m => m.senderId !== user.uid && !m.read);
    unread.forEach(m => { updateDoc(doc(db, 'chats', chatId, 'messages', m.id), { read: true }).catch(() => {}); });
  }, [core.messages, chatId, user?.uid]);

  // ─── Typing indicator ───────────────────────────────────
  const updateTypingStatus = useCallback(async (isTyping: boolean) => {
    if (!chatId || !user?.uid) return;
    try { await updateDoc(doc(db, 'chats', chatId), { [`typing.${user.uid}`]: isTyping }); } catch {}
  }, [chatId, user?.uid]);

  // ─── Typing timeout ─────────────────────────────────────
  useEffect(() => {
    if (typing.isTyping) {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => { setTyping({ isTyping: false }); void updateTypingStatus(false); }, 5000);
    }
    return () => { if (typingTimeout.current) clearTimeout(typingTimeout.current); };
  }, [typing.isTyping, updateTypingStatus]);

  // ─── Scroll helpers ─────────────────────────────────────
    const scheduleScrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => { flatListRef.current?.scrollToEnd({ animated }); });
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    shouldAutoScrollRef.current = distFromBottom < 200;
    if (shouldAutoScrollRef.current) {
      Animated.timing(scrollBtnOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    } else {
      Animated.timing(scrollBtnOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [scrollBtnOpacity]);

  // ─── Push notification ──────────────────────────────────
  const sendPushNotification = useCallback(async (body: string) => {
    if (!matchId || !user?.uid) return;
    try {
      const snap = await getDoc(doc(db, 'users', matchId));
      if (!snap.exists()) return;
      const token = snap.data()?.fcmToken;
      if (!token) return;
      await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `key=${''}` },
        body: JSON.stringify({ to: token, notification: { title: matchName, body: body.slice(0, 100), sound: 'default' }, data: { chatId, type: 'chat' } }),
      });
    } catch {}
  }, [matchId, user?.uid, matchName, chatId]);

  // ─── Ensure signal identity ─────────────────────────────
  const ensureSignalIdentityWrapper = useCallback(async () => {
    try { await ensureSignalIdentity(); } catch (e) { logger.warn('Signal identity init warning:', e); }
  }, []);

  // ─── Do send text (actual send) ─────────────────────────
  const doSendText = useCallback(async (text: string) => {
    setCore(p => ({ ...p, newMessage: '', sending: true }));
    setTyping(p => ({ ...p, isTyping: false }));
    void updateTypingStatus(false);
    try {
      await ensureSignalIdentityWrapper();
      await ensureChatExists();
      const enc = await encryptTextForRecipient(text, matchId);
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user!.uid, timestamp: serverTimestamp(), read: false, version: enc.version,
        messageType: 'text', ciphertext: enc.ciphertext, nonce: enc.nonce,
        senderPublicKey: enc.senderPublicKey, senderKeyVersion: enc.senderKeyVersion,
      });
      await sendPushNotification(text);
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) {
      logger.error('Error sending message:', e);
      Alert.alert('Error', getErrMsg(e));
      setCore(p => ({ ...p, newMessage: text }));
    } finally {
      setCore(p => ({ ...p, sending: false }));
    }
  }, [user?.uid, chatId, matchId, updateTypingStatus, sendPushNotification, scheduleScrollToBottom, ensureChatExists, ensureSignalIdentityWrapper]);

  // ─── Send message (with safety check) ───────────────────
  const sendMessage = useCallback(async () => {
    const text = core.inputText.trim();
    if (!text || !user?.uid || core.sending || !chatId || !matchId) return;

    try {
      const safetyResult = await checkMessageSend(text, user.uid, matchId, {
        serverUrl: '', enableMessageCheck: true, enablePhotoCheck: false,
        enableLoginCheck: false, enableRegistrationCheck: false, enableProfileCheck: false,
        autoBlockCritical: true, logAllChecks: false,
      });

      if (!safetyResult.allowed) {
        Alert.alert('Message Not Allowed', safetyResult.reasons.join('\n') || 'Flagged by safety system.');
        return;
      }

      if (safetyResult.shouldWarn && safetyResult.warnings.length > 0) {
        Alert.alert('Are you sure?', safetyResult.warnings.join('\n'), [
          { text: 'Edit', style: 'cancel' },
          { text: 'Send Anyway', style: 'destructive', onPress: () => void doSendText(text) },
        ]);
        return;
      }
    } catch (e) {
      logger.warn('Safety middleware failed, falling back:', e);
      const check = checkTextSafety(text);
      if (!check.safe) { Alert.alert('Message Not Allowed', check.reason); return; }
    }

    await doSendText(text);
  }, [core.inputText, core.sending, user?.uid, chatId, matchId, doSendText]);

  // ─── Upload and send image ──────────────────────────────
  const uploadAndSendImage = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user?.uid || !chatId || !matchId || !asset.uri) { Alert.alert('Error', 'Image data unavailable'); return; }
    setCore({ type: 'SET_UPLOADING', payload: true });
    try {
      await ensureSignalIdentityWrapper();
      await ensureChatExists();
      const up = await encryptAndUploadImageForRecipient(asset.uri, matchId);

      const imageUriToCheck = up.mediaUrl || asset.uri;
      try {
        const safetyResult = await checkPhotoUpload(imageUriToCheck, asset.uri, user.uid, 'chat', {
          serverUrl: '', enablePhotoCheck: true, enableMessageCheck: true,
          enableLoginCheck: false, enableRegistrationCheck: false, enableProfileCheck: false,
          autoBlockCritical: true, logAllChecks: false,
        });
        if (!safetyResult.allowed) {
          Alert.alert('Image Not Allowed', safetyResult.reasons.join('\n') || 'This image was flagged.');
          return;
        }
      } catch (e) {
        logger.warn('Photo safety middleware failed, falling back:', e);
        const chk = await checkImageSafety(imageUriToCheck);
        if (!chk.safe) { Alert.alert('Image Not Allowed', chk.reason); return; }
      }

      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false, version: up.version,
        messageType: asset.mimeType === 'image/gif' ? 'gif' : 'image',
        mediaUrl: up.mediaUrl, mediaMimeType: up.mediaMimeType, mediaSizeBytes: up.mediaSizeBytes,
        encryptedMediaKey: up.encryptedMediaKey, mediaKeyNonce: up.mediaKeyNonce,
        mediaCipherNonce: up.mediaCipherNonce, senderPublicKey: up.senderPublicKey,
        senderKeyVersion: up.senderKeyVersion, isGif: asset.mimeType === 'image/gif',
      });
      await sendPushNotification(asset.mimeType === 'image/gif' ? '🎬 Sent a GIF' : '📷 Sent a photo');
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) {
      logger.error('Error uploading encrypted image:', e);
      Alert.alert('Error', getErrMsg(e));
    } finally {
      setCore({ type: 'SET_UPLOADING', payload: false });
    }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists, ensureSignalIdentityWrapper]);

  // ─── Pick image ─────────────────────────────────────────
  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8, allowsEditing: false, allowsMultipleSelection: false,
      });
      if (!result.canceled && result.assets?.[0]) await uploadAndSendImage(result.assets[0]);
    } catch (e) { logger.error('Image pick error:', e); Alert.alert('Error', 'Could not open image picker.'); }
  }, [uploadAndSendImage]);

  // ─── Take photo ─────────────────────────────────────────
  const takePhoto = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access is required.'); return; }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false });
      if (!result.canceled && result.assets?.[0]) await uploadAndSendImage(result.assets[0]);
    } catch (e) { logger.error('Camera error:', e); Alert.alert('Error', 'Could not open camera.'); }
  }, [uploadAndSendImage]);

  // ─── Voice recording ────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Microphone access is required.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY);
      await rec.startRecording();
      recordingRef.current = rec;
      setCore({ type: 'SET_RECORDING', payload: true });
      setCore({ type: 'SET_RECORDING_DURATION', payload: 0 });
      recordingInterval.current = setInterval(() => {
        setCore(p => ({ ...p, recordingDuration: p.recordingDuration + 1 }));
      }, 1000);
    } catch (e) { logger.error('Recording start error:', e); Alert.alert('Error', 'Could not start recording.'); }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    try {
      if (recordingInterval.current) { clearInterval(recordingInterval.current); recordingInterval.current = null; }
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setCore({ type: 'SET_RECORDING', payload: false });
      setCore({ type: 'SET_RECORDING_DURATION', payload: 0 });
      if (!uri || !user?.uid || !chatId) return;
      await ensureChatExists();
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const fileRef = storageRef(storage, `chats/${chatId}/voice/${Date.now()}.m4a`);
      await uploadBytes(fileRef, blob);
      const downloadUrl = await getDownloadURL(fileRef);
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false, messageType: 'voice',
        mediaUrl: downloadUrl, mediaMimeType: 'audio/m4a',
      });
      await sendPushNotification('🎤 Voice message');
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (e) { logger.error('Recording stop error:', e); Alert.alert('Error', 'Could not send voice message.'); }
  }, [user?.uid, chatId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  // ─── Reactions ──────────────────────────────────────────
  const handleReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!user?.uid || !chatId) return;
    setCore({ type: 'SET_REACTION_PICKER', payload: false });
    setCore({ type: 'SET_SELECTED_MSG', payload: null });
    try {
      const msgRef = doc(db, 'chats', chatId, 'messages', msgId);
      const msgSnap = await getDoc(msgRef);
      if (!msgSnap.exists()) return;
      const existing: MessageReaction = msgSnap.data()?.reactions ?? [];
      const idx = existing.findIndex(r => r.emoji === emoji);
      if (idx >= 0) {
        const userIds = existing[idx].userIds.includes(user.uid)
          ? existing[idx].userIds.filter((u: string) => u !== user.uid)
          : [...existing[idx].userIds, user.uid];
        if (userIds.length === 0) existing.splice(idx, 1);
        else existing[idx] = { emoji, userIds };
      } else {
        existing.push({ emoji, userIds: [user.uid] });
      }
      await updateDoc(msgRef, { reactions: existing });
    } catch (e) { logger.error('Reaction error:', e); }
  }, [user?.uid, chatId]);

  // ─── Pin message ────────────────────────────────────────
  const togglePin = useCallback(async (msgId: string) => {
    if (!user?.uid || !chatId) return;
    setCore({ type: 'SET_OPTIONS', payload: false });
    try {
      await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), { pinned: true });
      Alert.alert('Pinned', 'Message pinned to conversation.');
    } catch (e) { Alert.alert('Error', 'Could not pin message.'); }
  }, [user?.uid, chatId]);

  // ─── Report ─────────────────────────────────────────────
  const submitReport = useCallback(async () => {
    if (!core.reportReason.trim() || !user?.uid || !chatId || !core.selectedMessageId) return;
    setCore({ type: 'SET_SUBMITTING_REPORT', payload: true });
    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: user.uid, chatId, messageId: core.selectedMessageId,
        reason: core.reportReason.trim(), timestamp: serverTimestamp(), status: 'pending',
      });
      await writeAuditLog('chat.report', { chatId, messageId: core.selectedMessageId });
      Alert.alert('Reported', 'Thank you. We will review this message.');
      setCore({ type: 'SET_REPORT', payload: false });
      setCore({ type: 'SET_REPORT_REASON', payload: '' });
      setCore({ type: 'SET_SELECTED_MSG', payload: null });
    } catch (e) { Alert.alert('Error', 'Could not submit report.'); }
    finally { setCore({ type: 'SET_SUBMITTING_REPORT', payload: false }); }
  }, [core.reportReason, core.selectedMessageId, user?.uid, chatId]);

  // ─── Save note ──────────────────────────────────────────
  const saveNote = useCallback(async () => {
    if (!chatId || !user?.uid) return;
    setCore({ type: 'SET_SAVING_NOTE', payload: true });
    try {
      await updateDoc(doc(db, 'chats', chatId), { note: core.noteText.trim().slice(0, MAX_NOTE_LENGTH) });
      setCore({ type: 'SET_NOTE', payload: false });
    } catch (e) { Alert.alert('Error', 'Could not save note.'); }
    finally { setCore({ type: 'SET_SAVING_NOTE', payload: false }); }
  }, [chatId, user?.uid, core.noteText]);

  // ─── Load more messages ─────────────────────────────────
    const loadMoreMessages = useCallback(async () => {
    if (!chatId || !core.hasMore || core.loadingMore || !core.lastDoc) return;
    setCore({ type: 'SET_LOADING_MORE', payload: true });
    try {
      const q = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('timestamp', 'desc'),
        startAfter(core.lastDoc),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const more: Message[] = [];
      snap.forEach(d => {
        const raw = d.data();
        more.push({
          id: d.id, senderId: raw.senderId ?? '', text: raw.text ?? raw.ciphertext ?? '',
          timestamp: raw.timestamp?.toDate?.() ?? null, read: raw.read ?? false,
          type: raw.messageType ?? (raw.isGif ? 'gif' : 'text'),
          mediaUrl: raw.mediaUrl, mediaMimeType: raw.mediaMimeType, mediaSizeBytes: raw.mediaSizeBytes,
          reactions: raw.reactions ?? [], pinned: raw.pinned ?? false,
          translatedText: raw.translatedText, isTranslating: raw.isTranslating ?? false,
          voiceDuration: raw.voiceDuration, voiceWaveform: raw.voiceWaveform,
          encryptedMediaKey: raw.encryptedMediaKey, mediaKeyNonce: raw.mediaKeyNonce,
          mediaCipherNonce: raw.mediaCipherNonce, version: raw.version,
          ciphertext: raw.ciphertext, nonce: raw.nonce,
          senderPublicKey: raw.senderPublicKey, senderKeyVersion: raw.senderKeyVersion,
          isGif: raw.isGif ?? false,
        });
      });
      more.reverse();
      setCore({ type: 'ADD_MESSAGES_TOP', payload: more });
      setCore({ type: 'SET_HAS_MORE', payload: snap.size >= PAGE_SIZE });
      if (snap.size > 0) setCore({ type: 'SET_LAST_DOC', payload: snap.docs[snap.docs.length - 1] });
    } catch (e) { logger.error('Load more error:', e); }
    finally { setCore({ type: 'SET_LOADING_MORE', payload: false }); }
  }, [chatId, core.hasMore, core.loadingMore, core.lastDoc]);

  // ─── Toggle disappearing ────────────────────────────────
  const toggleDisappearing = useCallback(async () => {
    if (!chatId || !user?.uid) return;
    const next = !core.disappearingEnabled;
    try {
      await updateDoc(doc(db, 'chats', chatId), { disappearing: next });
      setCore({ type: 'SET_DISAPPEARING', payload: next });
    } catch (e) { Alert.alert('Error', 'Could not update setting.'); }
  }, [chatId, user?.uid, core.disappearingEnabled]);

  // ─── Format timestamp ───────────────────────────────────
  const formatTime = useCallback((date: Date | null): string => {
    if (!date) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }, []);

  const formatFullTime = useCallback((date: Date | null): string => {
    if (!date) return '';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }, []);

  // ─── Input change handler ───────────────────────────────
  const handleInputChange = useCallback((text: string) => {
    setCore({ type: 'SET_INPUT', payload: text.slice(0, MAX_MESSAGE_LENGTH) });
    if (!typing.isTyping) { setTyping({ isTyping: true }); void updateTypingStatus(true); }
  }, [typing.isTyping, updateTypingStatus]);

  // ─── Load pinned messages ───────────────────────────────
  const loadPinned = useCallback(async () => {
    if (!chatId) return;
    setCore({ type: 'SET_PINNED', payload: true });
  }, [chatId]);

  // ─── GIF search ─────────────────────────────────────────
  const searchGifs = useCallback(async (query: string) => {
    if (!query.trim()) { setCore({ type: 'SET_GIF_RESULTS', payload: [] }); return; }
    setCore({ type: 'SET_LOADING_GIFS', payload: true });
    try {
      const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=YOUR_GIPHY_KEY&q=${encodeURIComponent(query)}&limit=20&rating=pg`);
      const json = await res.json();
      setCore({ type: 'SET_GIF_RESULTS', payload: json.data ?? [] });
    } catch (e) { logger.error('GIF search error:', e); }
    finally { setCore({ type: 'SET_LOADING_GIFS', payload: false }); }
  }, []);

  // ─── Send GIF ───────────────────────────────────────────
  const sendGif = useCallback(async (gif: any) => {
    if (!user?.uid || !chatId) return;
    const url = gif?.images?.original?.url ?? gif?.images?.downsized?.url;
    if (!url) return;
    setCore({ type: 'SET_GIF', payload: false });
    setCore({ type: 'SET_SENDING', payload: true });
    try {
      await ensureChatExists();
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false, messageType: 'gif',
        mediaUrl: url, isGif: true, mediaMimeType: 'image/gif',
      });
      await sendPushNotification('🎬 Sent a GIF');
      shouldAutoScrollRef.current = true;
      scheduleScrollToBottom(true);
    } catch (e) { Alert.alert('Error', 'Could not send GIF.'); }
    finally { setCore({ type: 'SET_SENDING', payload: false }); }
  }, [user?.uid, chatId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  // ─── Date ideas ─────────────────────────────────────────
  const loadDateIdeas = useCallback(() => {
    setCore({ type: 'SET_DATE_IDEAS_SHOW', payload: true });
    setCore({ type: 'SET_LOADING_DATES', payload: true });
    setTimeout(() => {
      const shuffled = [...DATE_IDEAS_PRESETS].sort(() => Math.random() - 0.5).slice(0, 4);
      setCore({ type: 'SET_DATE_IDEAS', payload: shuffled });
      setCore({ type: 'SET_LOADING_DATES', payload: false });
    }, 600);
  }, []);

  // ─── Keyboard dismiss ───────────────────────────────────
  const dismissKeyboard = useCallback(() => { Keyboard.dismiss(); }, []);

  // ─── Render message bubble ──────────────────────────────
  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isMine = item.senderId === user?.uid;
    const prevMsg = index > 0 ? core.messages[index - 1] : null;
    const sameSenderAsPrev = prevMsg?.senderId === item.senderId;
    const showDateSeparator = !prevMsg || !prevMsg.timestamp || !item.timestamp
      ? index === 0
      : (item.timestamp.getTime() - prevMsg.timestamp.getTime()) > 300000;

    const isSystem = item.type === 'system';

    if (isSystem) {
      return (
        <View style={styles.systemMessageWrap}>
          <Text style={styles.systemMessageText}>{item.text}</Text>
        </View>
      );
    }

    return (
      <View>
        {showDateSeparator && item.timestamp && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateSepLine} />
            <Text style={styles.dateSepText}>{formatFullTime(item.timestamp)}</Text>
            <View style={styles.dateSepLine} />
          </View>
        )}
        <Pressable
          onLongPress={() => {
            setCore({ type: 'SET_SELECTED_MSG', payload: item.id });
            setCore({ type: 'SET_OPTIONS', payload: true });
          }}
          delayLongPress={300}
          style={[
            styles.messageRow,
            isMine ? styles.messageRowMine : styles.messageRowTheirs,
            !sameSenderAsPrev && { marginTop: 10 },
          ]}
        >
          {!isMine && !sameSenderAsPrev && matchPhoto ? (
            <Image source={{ uri: matchPhoto }} style={styles.avatarSmall} />
          ) : !isMine ? (
            <View style={styles.avatarSmallPlaceholder} />
          ) : null}

          <View style={[styles.bubbleWrap, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
            {item.type === 'text' && (
              <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]} selectable>
                {item.translatedText ?? item.text ?? ''}
              </Text>
            )}

            {item.type === 'image' && item.mediaUrl && (
              <Pressable onPress={() => setCore({ type: 'SET_PREVIEW', payload: item.mediaUrl ?? null })}>
                <Image source={{ uri: item.mediaUrl }} style={styles.imageBubble} resizeMode="cover" />
              </Pressable>
            )}

            {item.type === 'gif' && item.mediaUrl && (
              <Pressable onPress={() => setCore({ type: 'SET_PREVIEW', payload: item.mediaUrl ?? null })}>
                <Image source={{ uri: item.mediaUrl }} style={styles.imageBubble} resizeMode="cover" />
                <Text style={styles.gifLabel}>GIF</Text>
              </Pressable>
            )}

            {item.type === 'voice' && (
              <View style={styles.voiceRow}>
                <Ionicons name="play-circle" size={28} color={isMine ? '#fff' : '#6C63FF'} />
                <View style={styles.voiceWaveWrap}>
                  {(item.voiceWaveform ?? Array.from({ length: 20 }, () => Math.random())).map((v, i) => (
                    <View key={i} style={[styles.voiceBar, { height: Math.max(4, (v ?? 0.3) * 24), backgroundColor: isMine ? 'rgba(255,255,255,0.6)' : 'rgba(108,99,255,0.5)' }]} />
                  ))}
                </View>
                {item.voiceDuration ? <Text style={[styles.voiceDuration, isMine && { color: 'rgba(255,255,255,0.7)' }]}>{Math.ceil(item.voiceDuration / 1000)}s</Text> : null}
              </View>
            )}

            <View style={styles.bubbleFooter}>
              <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>
                {formatTime(item.timestamp)}
              </Text>
              {isMine && (
                <Ionicons
                  name={item.read ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={item.read ? '#51CF66' : 'rgba(255,255,255,0.5)'}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>

            {item.pinned && (
              <View style={styles.pinnedBadge}>
                <Ionicons name="pin" size={10} color="#FFB347" />
                <Text style={styles.pinnedText}>Pinned</Text>
              </View>
            )}

            {item.reactions && item.reactions.length > 0 && (
              <View style={styles.reactionsRow}>
                {item.reactions.map((r, i) => (
                  <View key={i} style={styles.reactionChip}>
                    <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                    {r.userIds.length > 1 && <Text style={styles.reactionCount}>{r.userIds.length}</Text>}
                  </View>
                ))}
              </View>
            )}
          </View>
        </Pressable>
      </View>
    );
  }, [user?.uid, core.messages, matchPhoto, formatTime, formatFullTime]);

  // ─── Render header ──────────────────────────────────────
  const renderHeader = () => (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.headerBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={26} color="#6C63FF" />
      </Pressable>

      <View style={styles.headerCenter}>
        {matchPhoto ? (
          <Image source={{ uri: matchPhoto }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
            <Ionicons name="person" size={20} color="#9494B8" />
          </View>
        )}
        <View style={styles.headerInfo}>
          <View style={styles.headerNameRow}>
            <Text style={styles.headerName} numberOfLines={1}>{matchName}{matchAge ? `, ${matchAge}` : ''}</Text>
            {matchVerified && <Ionicons name="checkmark-circle" size={14} color="#6C63FF" style={{ marginLeft: 4 }} />}
          </View>
          <Text style={styles.headerStatus}>
            {typing.theirTyping ? 'typing…' : matchOnline ? 'Online' : matchLastSeen ? `Last seen ${formatTime(matchLastSeen)}` : ''}
          </Text>
        </View>
      </View>

      <Pressable onPress={() => setCore({ type: 'SET_MENU', payload: !core.showMenu })} style={styles.headerMenuBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Menu">
        <Ionicons name="ellipsis-vertical" size={22} color="#9494B8" />
      </Pressable>
    </View>
  );

  // ─── Render menu overlay ────────────────────────────────
  const renderMenu = () => {
    if (!core.showMenu) return null;
    return (
      <Pressable style={styles.menuOverlay} onPress={() => setCore({ type: 'SET_MENU', payload: false })}>
        <View style={styles.menuCard}>
          <Pressable style={styles.menuItem} onPress={() => { setCore({ type: 'SET_MENU', payload: false }); setCore({ type: 'SET_NOTE', payload: true }); }}>
            <Ionicons name="document-text-outline" size={18} color="#9494B8" />
            <Text style={styles.menuItemText}>Shared Notes</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => { setCore({ type: 'SET_MENU', payload: false }); void loadPinned(); }}>
            <Ionicons name="pin-outline" size={18} color="#9494B8" />
            <Text style={styles.menuItemText}>Pinned Messages</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => { setCore({ type: 'SET_MENU', payload: false }); void toggleDisappearing(); }}>
            <Ionicons name={core.disappearingEnabled ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9494B8" />
            <Text style={styles.menuItemText}>{core.disappearingEnabled ? 'Disable Disappearing' : 'Enable Disappearing'}</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => { setCore({ type: 'SET_MENU', payload: false }); loadDateIdeas(); }}>
            <Ionicons name="heart-outline" size={18} color="#9494B8" />
            <Text style={styles.menuItemText}>Date Ideas</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => { setCore({ type: 'SET_MENU', payload: false }); setCore({ type: 'SET_VIDEO_PROMPT', payload: true }); }}>
            <Ionicons name="videocam-outline" size={18} color="#9494B8" />
            <Text style={styles.menuItemText}>Video / Audio Call</Text>
          </Pressable>
          <View style={styles.menuSeparator} />
          <Pressable style={[styles.menuItem, styles.menuItemDanger]} onPress={() => { setCore({ type: 'SET_MENU', payload: false }); router.back(); }}>
            <Ionicons name="close-circle-outline" size={18} color="#FF6B6B" />
            <Text style={[styles.menuItemText, { color: '#FF6B6B' }]}>Unmatch</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  // ─── Render input bar ───────────────────────────────────
  const renderInputBar = () => (
    <View style={styles.inputBar}>
      <Pressable onPress={pickImage} style={styles.inputAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Attach image">
        <Ionicons name="image-outline" size={22} color="#6C63FF" />
      </Pressable>
      <Pressable onPress={takePhoto} style={styles.inputAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Take photo">
        <Ionicons name="camera-outline" size={22} color="#6C63FF" />
      </Pressable>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.inputField}
          value={core.inputText}
          onChangeText={handleInputChange}
          placeholder="Type a message…"
          placeholderTextColor="#64648a"
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          editable={!core.sending && !core.uploadingMedia}
          onSubmitEditing={() => void sendMessage()}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        {core.inputText.length > MAX_MESSAGE_LENGTH * 0.9 && (
          <Text style={styles.charCount}>{core.inputText.length}/{MAX_MESSAGE_LENGTH}</Text>
        )}
      </View>
      {core.recordingAudio ? (
        <View style={styles.recordingWrap}>
          <Text style={styles.recordingTimer}>{Math.floor(core.recordingDuration / 60)}:{String(core.recordingDuration % 60).padStart(2, '0')}</Text>
          <Pressable onPress={() => void stopRecording()} style={styles.recordingStop} accessibilityRole="button" accessibilityLabel="Stop recording">
            <Ionicons name="stop-circle" size={28} color="#FF6B6B" />
          </Pressable>
        </View>
      ) : !core.inputText.trim() ? (
        <Pressable onPress={() => void startRecording()} style={styles.inputAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Record voice">
          <Ionicons name="mic-outline" size={22} color="#6C63FF" />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => void sendMessage()}
          style={[styles.sendBtn, (!core.inputText.trim() || core.sending) && styles.sendBtnDisabled]}
          disabled={!core.inputText.trim() || core.sending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          {core.sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
        </Pressable>
      )}
    </View>
  );

  // ─── Render options modal ───────────────────────────────
  const renderOptionsModal = () => (
    <Modal visible={core.showOptions} transparent animationType="fade" onRequestClose={() => setCore({ type: 'SET_OPTIONS', payload: false })}>
      <Pressable style={styles.modalOverlay} onPress={() => setCore({ type: 'SET_OPTIONS', payload: false })}>
        <View style={styles.optionsCard}>
          {core.selectedMessageId && (
            <>
              <Pressable style={styles.optionItem} onPress={() => { if (core.selectedMessageId) void togglePin(core.selectedMessageId); }}>
                <Ionicons name="pin-outline" size={18} color="#9494B8" />
                <Text style={styles.optionText}>Pin Message</Text>
              </Pressable>
              <Pressable style={styles.optionItem} onPress={() => { setCore({ type: 'SET_OPTIONS', payload: false }); setCore({ type: 'SET_REACTION_PICKER', payload: true }); }}>
                <Ionicons name="happy-outline" size={18} color="#9494B8" />
                <Text style={styles.optionText}>React</Text>
              </Pressable>
              <Pressable style={styles.optionItem} onPress={() => { setCore({ type: 'SET_OPTIONS', payload: false }); setCore({ type: 'SET_REPORT', payload: true }); }}>
                <Ionicons name="flag-outline" size={18} color="#FF6B6B" />
                <Text style={[styles.optionText, { color: '#FF6B6B' }]}>Report</Text>
              </Pressable>
            </>
          )}
        </View>
      </Pressable>
    </Modal>
  );

  // ─── Render reaction picker ─────────────────────────────
  const renderReactionPicker = () => (
    <Modal visible={core.showReactionPicker} transparent animationType="fade" onRequestClose={() => { setCore({ type: 'SET_REACTION_PICKER', payload: false }); setCore({ type: 'SET_SELECTED_MSG', payload: null }); }}>
      <Pressable style={styles.modalOverlay} onPress={() => { setCore({ type: 'SET_REACTION_PICKER', payload: false }); setCore({ type: 'SET_SELECTED_MSG', payload: null }); }}>
        <View style={styles.reactionPickerCard}>
          {EMOJI_REACTIONS.map(emoji => (
            <Pressable key={emoji} onPress={() => { if (core.selectedMessageId) void handleReaction(core.selectedMessageId, emoji); }} style={styles.reactionPickItem}>
              <Text style={styles.reactionPickEmoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );

  // ─── Render report modal ────────────────────────────────
  const renderReportModal = () => (
    <Modal visible={core.showReport} transparent animationType="slide" onRequestClose={() => setCore({ type: 'SET_REPORT', payload: false })}>
      <View style={styles.reportModal}>
        <View style={styles.reportCard}>
          <Text style={styles.reportTitle}>Report Message</Text>
          <TextInput
            style={styles.reportInput}
            value={core.reportReason}
            onChangeText={t => setCore({ type: 'SET_REPORT_REASON', payload: t })}
            placeholder="Describe the issue…"
            placeholderTextColor="#64648a"
            multiline
            maxLength={500}
            autoFocus
          />
          <View style={styles.reportBtns}>
            <Pressable style={styles.reportCancel} onPress={() => { setCore({ type: 'SET_REPORT', payload: false }); setCore({ type: 'SET_REPORT_REASON', payload: '' }); }}>
              <Text style={styles.reportCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.reportSubmit, (!core.reportReason.trim() || core.submittingReport) && styles.reportSubmitDisabled]}
              onPress={() => void submitReport()}
              disabled={!core.reportReason.trim() || core.submittingReport}
            >
              {core.submittingReport ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.reportSubmitText}>Submit</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  // ─── Render note modal ──────────────────────────────────
  const renderNoteModal = () => (
    <Modal visible={core.showNote} transparent animationType="slide" onRequestClose={() => setCore({ type: 'SET_NOTE', payload: false })}>
      <View style={styles.noteModal}>
        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Shared Notes</Text>
          <TextInput
            style={styles.noteInput}
            value={core.noteText}
            onChangeText={t => setCore({ type: 'SET_NOTE_TEXT', payload: t.slice(0, MAX_NOTE_LENGTH) })}
            placeholder="Write notes together…"
            placeholderTextColor="#64648a"
            multiline
            maxLength={MAX_NOTE_LENGTH}
            autoFocus
          />
          <Text style={styles.noteCount}>{core.noteText.length}/{MAX_NOTE_LENGTH}</Text>
          <View style={styles.noteBtns}>
            <Pressable style={styles.noteCancel} onPress={() => setCore({ type: 'SET_NOTE', payload: false })}>
              <Text style={styles.noteCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.noteSave, core.savingNote && styles.noteSaveDisabled]} onPress={() => void saveNote()} disabled={core.savingNote}>
              {core.savingNote ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.noteSaveText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  // ─── Render pinned modal ────────────────────────────────
  const renderPinnedModal = () => {
    const pinned = core.messages.filter(m => m.pinned);
    return (
      <Modal visible={core.showPinned} transparent animationType="slide" onRequestClose={() => setCore({ type: 'SET_PINNED', payload: false })}>
        <View style={styles.pinnedModal}>
          <View style={styles.pinnedCard}>
            <View style={styles.pinnedHeader}>
              <Text style={styles.pinnedTitle}>Pinned Messages</Text>
              <Pressable onPress={() => setCore({ type: 'SET_PINNED', payload: false })} hitSlop={12}>
                <Ionicons name="close" size={22} color="#9494B8" />
              </Pressable>
            </View>
            {pinned.length === 0 ? (
              <Text style={styles.pinnedEmpty}>No pinned messages yet.</Text>
            ) : (
              <ScrollView style={styles.pinnedList} keyboardShouldPersistTaps="handled">
                {pinned.map(m => (
                  <View key={m.id} style={styles.pinnedItem}>
                    <Text style={styles.pinnedItemText}>{m.text ?? '📎 Media'}</Text>
                    <Text style={styles.pinnedItemTime}>{formatTime(m.timestamp)}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    );
  };

  // ─── Render video call prompt ───────────────────────────
  const renderVideoPrompt = () => (
    <Modal visible={core.showVideoPrompt} transparent animationType="fade" onRequestClose={() => setCore({ type: 'SET_VIDEO_PROMPT', payload: false })}>
      <Pressable style={styles.modalOverlay} onPress={() => setCore({ type: 'SET_VIDEO_PROMPT', payload: false })}>
        <View style={styles.videoPromptCard}>
          <Text style={styles.videoPromptTitle}>Start a call?</Text>
          <Text style={styles.videoPromptSub}>Choose call type with {matchName}</Text>
          <View style={styles.videoPromptBtns}>
            <Pressable style={styles.videoBtn} onPress={() => { setCore({ type: 'SET_VIDEO_PROMPT', payload: false }); Alert.alert('Coming Soon', 'Video calls will be available soon!'); }}>
              <Ionicons name="videocam" size={22} color="#6C63FF" />
              <Text style={styles.videoBtnText}>Video</Text>
            </Pressable>
            <Pressable style={styles.videoBtn} onPress={() => { setCore({ type: 'SET_VIDEO_PROMPT', payload: false }); Alert.alert('Coming Soon', 'Audio calls will be available soon!'); }}>
              <Ionicons name="call" size={22} color="#6C63FF" />
              <Text style={styles.videoBtnText}>Audio</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );

  // ─── Render date ideas modal ────────────────────────────
  const renderDateIdeas = () => (
    <Modal visible={core.showDateIdeas} transparent animationType="slide" onRequestClose={() => setCore({ type: 'SET_DATE_IDEAS_SHOW', payload: false })}>
      <View style={styles.dateModal}>
        <View style={styles.dateCard}>
          <View style={styles.dateHeader}>
            <Text style={styles.dateTitle}>Date Ideas</Text>
            <Pressable onPress={() => setCore({ type: 'SET_DATE_IDEAS_SHOW', payload: false })} hitSlop={12}>
              <Ionicons name="close" size={22} color="#9494B8" />
            </Pressable>
          </View>
          {core.loadingDateIdeas ? (
            <ActivityIndicator size="large" color="#6C63FF" style={{ marginVertical: 32 }} />
          ) : (
            core.dateIdeas.map((idea, i) => (
              <Pressable
                key={i}
                style={styles.dateIdeaItem}
                onPress={() => {
                  setCore({ type: 'SET_INPUT', payload: idea.text });
                  setCore({ type: 'SET_DATE_IDEAS_SHOW', payload: false });
                }}
              >
                <Text style={styles.dateIdeaVibe}>{idea.vibe}</Text>
                <Text style={styles.dateIdeaText}>{idea.text}</Text>
              </Pressable>
            ))
          )}
          <Pressable style={styles.dateRefreshBtn} onPress={loadDateIdeas}>
            <Ionicons name="refresh" size={16} color="#6C63FF" />
            <Text style={styles.dateRefreshText}>Shuffle</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  // ─── Render image preview ───────────────────────────────
  const renderImagePreview = () => (
    <Modal visible={!!core.previewImage} transparent animationType="fade" onRequestClose={() => setCore({ type: 'SET_PREVIEW', payload: null })}>
      <View style={styles.previewModal}>
        <Pressable style={styles.previewClose} onPress={() => setCore({ type: 'SET_PREVIEW', payload: null })} hitSlop={16}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        {core.previewImage ? <Image source={{ uri: core.previewImage }} style={styles.previewImage} resizeMode="contain" /> : null}
      </View>
    </Modal>
  );

  // ─── Render scroll to bottom ────────────────────────────
  const renderScrollToBottom = () => (
    <Animated.View style={[styles.scrollBtnWrap, { opacity: scrollBtnOpacity }]}>
      <Pressable
        style={styles.scrollBtn}
        onPress={() => { shouldAutoScrollRef.current = true; flatListRef.current?.scrollToEnd({ animated: true }); }}
        accessibilityRole="button"
        accessibilityLabel="Scroll to bottom"
      >
        <Ionicons name="chevron-down" size={18} color="#6C63FF" />
        {core.messages.length > 0 && !core.messages[core.messages.length - 1]?.read && !core.messages[core.messages.length - 1]?.senderId !== user?.uid && (
          <View style={styles.scrollBtnBadge} />
        )}
      </Pressable>
    </Animated.View>
  );

  // ─── Main render ────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#07070f" />
      {renderHeader()}
      {renderMenu()}
      <Animated.View style={[styles.chatArea, { opacity: opacityAnim }]}>
        {core.loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#6C63FF" />
            <Text style={styles.loadingText}>Loading messages…</Text>
          </View>
        ) : core.messages.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="chatbubbles-outline" size={48} color="#28285a" />
            <Text style={styles.emptyTitle}>Start the conversation</Text>
            <Text style={styles.emptySub}>Say hello to {matchName}!</Text>
          </View>
        ) : (
          <View style={styles.flex}>
            <FlatList
              ref={flatListRef}
              data={core.messages}
              renderItem={renderMessage}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.messageList}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onEndReached={() => void loadMoreMessages()}
              onEndReachedThreshold={0.1}
              ListFooterComponent={core.loadingMore ? <ActivityIndicator size="small" color="#6C63FF" style={{ marginVertical: 12 }} /> : null}
              inverted={false}
              keyboardShouldPersistTaps="handled"
              onLayout={() => { if (shouldAutoScrollRef.current) scheduleScrollToBottom(false); }}
            />
            {renderScrollToBottom()}
          </View>
        )}
      </Animated.View>
      {core.uploadingMedia && (
        <View style={styles.uploadingBar}>
          <ActivityIndicator size="small" color="#6C63FF" />
          <Text style={styles.uploadingText}>Uploading media…</Text>
        </View>
      )}
      {typing.theirTyping && (
        <View style={styles.typingBar}>
          <View style={styles.typingDots}>
            <View style={[styles.typingDot, { animationDelay: '0ms' }]} />
            <View style={[styles.typingDot, { animationDelay: '150ms' }]} />
            <View style={[styles.typingDot, { animationDelay: '300ms' }]} />
          </View>
          <Text style={styles.typingText}>{matchName} is typing</Text>
        </View>
      )}
      <KeyboardAvoidingView behavior={IS_IOS ? 'padding' : undefined} keyboardVerticalOffset={IS_IOS ? 90 : 0}>
        {renderInputBar()}
      </KeyboardAvoidingView>
      {renderOptionsModal()}
      {renderReactionPicker()}
      {renderReportModal()}
      {renderNoteModal()}
      {renderPinnedModal()}
      {renderVideoPrompt()}
      {renderDateIdeas()}
      {renderImagePreview()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07070f' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1e1e48', backgroundColor: '#0a0a18',
  },
  headerBack: { padding: 4 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 4 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19 },
  headerAvatarPlaceholder: { backgroundColor: '#1e1e48', alignItems: 'center', justifyContent: 'center' },
  headerInfo: { marginLeft: 10, flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center' },
  headerName: { fontSize: 16, fontWeight: '700', color: '#EDEDFF' },
  headerStatus: { fontSize: 12, color: '#9494B8', marginTop: 1 },
  headerMenuBtn: { padding: 8 },
  chatArea: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: '#9494B8' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#EDEDFF' },
  emptySub: { fontSize: 14, color: '#9494B8' },
  messageList: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 16 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 },
  messageRowMine: { justifyContent: 'flex-end' },
  messageRowTheirs: { justifyContent: 'flex-start' },
  avatarSmall: { width: 24, height: 24, borderRadius: 12, marginRight: 6 },
  avatarSmallPlaceholder: { width: 24, height: 24, marginRight: 6 },
  bubbleWrap: { maxWidth: '75%', borderRadius: 16, padding: 10, paddingBottom: 6 },
  bubbleMine: { backgroundColor: '#6C63FF', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#111128', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#1e1e48' },
  bubbleText: { fontSize: 15, lineHeight: 20, color: '#EDEDFF' },
  bubbleTextMine: { color: '#fff' },
  bubbleFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, gap: 2 },
  bubbleTime: { fontSize: 10, color: '#64648a' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.6)' },
  imageBubble: { width: 200, height: 180, borderRadius: 12, marginTop: 4 },
  gifLabel: { position: 'absolute', top: 8, left: 8, fontSize: 9, fontWeight: '800', color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  voiceWaveWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 28 },
  voiceBar: { width: 3, borderRadius: 2 },
  voiceDuration: { fontSize: 11, color: '#9494B8' },
  pinnedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  pinnedText: { fontSize: 9, color: '#FFB347', fontWeight: '600' },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  reactionChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(108,99,255,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  reactionEmoji: { fontSize: 12 },
  reactionCount: { fontSize: 9, color: '#9494B8', marginLeft: 2 },
  dateSeparator: { flexDirection: 'row', alignItems: 'center', marginVertical: 12, gap: 8 },
  dateSepLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#1e1e48' },
  dateSepText: { fontSize: 11, color: '#64648a', fontWeight: '600' },
  systemMessageWrap: { alignItems: 'center', marginVertical: 8 },
  systemMessageText: { fontSize: 12, color: '#64648a', fontStyle: 'italic' },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: '#0a0a18', borderTopWidth: 1, borderTopColor: '#1e1e48', gap: 4,
  },
  inputAction: { padding: 8, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: '#0d0d24', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center', borderWidth: 1, borderColor: '#28285a' },
  inputField: { fontSize: 15, color: '#EDEDFF', maxHeight: 100, lineHeight: 20 },
  charCount: { fontSize: 10, color: '#64648a', textAlign: 'right', marginTop: 2 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#6C63FF', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#181834' },
  recordingWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recordingTimer: { fontSize: 13, color: '#FF6B6B', fontWeight: '600', fontVariant: ['tabular-nums'] },
  recordingStop: { padding: 4 },
  uploadingBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6, backgroundColor: '#0a0a18' },
  uploadingText: { fontSize: 13, color: '#9494B8' },
  typingBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 4, backgroundColor: '#0a0a18' },
  typingDots: { flexDirection: 'row', gap: 3 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#6C63FF' },
  typingText: { fontSize: 12, color: '#9494B8', fontStyle: 'italic' },
  scrollBtnWrap: { position: 'absolute', right: 16, bottom: 12 },
  scrollBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#111128', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1e1e48' },
  scrollBtnBadge: { position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF6B6B' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(4,4,12,0.8)', justifyContent: 'center', alignItems: 'center' },
  menuOverlay: { position: 'absolute', top: 60, right: 12, zIndex: 100 },
  menuCard: { backgroundColor: '#111128', borderRadius: 16, padding: 8, borderWidth: 1, borderColor: '#1e1e48', minWidth: 200, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 16 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  menuItemText: { fontSize: 14, color: '#EDEDFF', fontWeight: '500' },
  menuItemDanger: {},
  menuSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: '#1e1e48', marginVertical: 4 },
  optionsCard: { backgroundColor: '#111128', borderRadius: 16, padding: 8, borderWidth: 1, borderColor: '#1e1e48', minWidth: 180 },
  optionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  optionText: { fontSize: 14, color: '#EDEDFF', fontWeight: '500' },
  reactionPickerCard: { flexDirection: 'row', backgroundColor: '#111128', borderRadius: 28, padding: 8, borderWidth: 1, borderColor: '#1e1e48', gap: 4 },
  reactionPickItem: { padding: 8 },
  reactionPickEmoji: { fontSize: 28 },
  reportModal: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(4,4,12,0.9)' },
  reportCard: { backgroundColor: '#111128', borderRadius: 20, padding: 24, width: '90%', maxWidth: 400, borderWidth: 1, borderColor: '#1e1e48', gap: 16 },
  reportTitle: { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  reportInput: { minHeight: 80, backgroundColor: '#0d0d24', borderRadius: 12, padding: 14, fontSize: 15, color: '#EDEDFF', borderWidth: 1, borderColor: '#28285a', textAlignVertical: 'top' },
  reportBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  reportCancel: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 },
  reportCancelText: { fontSize: 14, color: '#9494B8', fontWeight: '600' },
  reportSubmit: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#FF6B6B' },
  reportSubmitDisabled: { backgroundColor: '#181834' },
  reportSubmitText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  noteModal: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(4,4,12,0.9)' },
  noteCard: { backgroundColor: '#111128', borderRadius: 20, padding: 24, width: '90%', maxWidth: 400, borderWidth: 1, borderColor: '#1e1e48', gap: 12 },
  noteTitle: { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  noteInput: { minHeight: 100, backgroundColor: '#0d0d24', borderRadius: 12, padding: 14, fontSize: 15, color: '#EDEDFF', borderWidth: 1, borderColor: '#28285a', textAlignVertical: 'top' },
  noteCount: { fontSize: 11, color: '#64648a', textAlign: 'right' },
  noteBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  noteCancel: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 },
  noteCancelText: { fontSize: 14, color: '#9494B8', fontWeight: '600' },
  noteSave: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#6C63FF' },
  noteSaveDisabled: { backgroundColor: '#181834' },
  noteSaveText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  pinnedModal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(4,4,12,0.9)' },
  pinnedCard: { backgroundColor: '#111128', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '70%', borderWidth: 1, borderColor: '#1e1e48' },
  pinnedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pinnedTitle: { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  pinnedEmpty: { fontSize: 14, color: '#64648a', textAlign: 'center', marginVertical: 24 },
  pinnedList: {},
  pinnedItem: { backgroundColor: '#0d0d24', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#28285a' },
  pinnedItemText: { fontSize: 14, color: '#EDEDFF' },
  pinnedItemTime: { fontSize: 11, color: '#64648a', marginTop: 4 },
  videoPromptCard: { backgroundColor: '#111128', borderRadius: 20, padding: 28, width: '85%', maxWidth: 340, borderWidth: 1, borderColor: '#1e1e48', alignItems: 'center', gap: 16 },
  videoPromptTitle: { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  videoPromptSub: { fontSize: 14, color: '#9494B8', textAlign: 'center' },
  videoPromptBtns: { flexDirection: 'row', gap: 16 },
  videoBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0d0d24', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: '#28285a' },
  videoBtnText: { fontSize: 14, color: '#6C63FF', fontWeight: '600' },
  dateModal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(4,4,12,0.9)' },
  dateCard: { backgroundColor: '#111128', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '70%', borderWidth: 1, borderColor: '#1e1e48' },
  dateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dateTitle: { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  dateIdeaItem: { backgroundColor: '#0d0d24', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#28285a' },
  dateIdeaVibe: { fontSize: 12, color: '#6C63FF', fontWeight: '700', marginBottom: 4 },
  dateIdeaText: { fontSize: 14, color: '#EDEDFF', lineHeight: 20 },
  dateRefreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 8 },
  dateRefreshText: { fontSize: 14, color: '#6C63FF', fontWeight: '600' },
  previewModal: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  previewClose: { position: 'absolute', top: 48, right: 16, zIndex: 10 },
  previewImage: { width: '100%', height: '80%' },
});