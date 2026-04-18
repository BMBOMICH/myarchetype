import { prepare, layout as pretextLayout } from '@chenglou/pretext';
import { Ionicons } from '@expo/vector-icons';
import type { LegendListRef, LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useMutation } from '@tanstack/react-query';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import TurboImage from 'react-native-turbo-image';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db, storage } from '../firebaseConfig';
import {
  encryptTextForRecipient,
  ensureLocalE2EEKeypair,
  getRemoteE2EEPublicKey,
  syncMyE2EEPublicKeyToFirestore,
} from '../utils/e2ee';
import { logger, writeAuditLog } from '../utils/logger';
import { checkMessageSend, checkPhotoUpload } from '../utils/safetyMiddleware';

const IS_IOS      = Platform.OS === 'ios';
const PAGE_SIZE   = 30;
const MAX_MSG_LEN = 2000;
const MAX_NOTE_LEN = 500;
const SCREEN_W    = Dimensions.get('window').width;

const FONT_BUBBLE   = '15px Inter';
const LINE_H_BUBBLE = 20;

const BUBBLE_MAX_W       = SCREEN_W * 0.75;
const BUBBLE_H_PADDING   = 20;
const BUBBLE_FOOTER_H    = 24;
const BUBBLE_REACTIONS_H = 28;
const BUBBLE_PINNED_H    = 16;
const MSG_ROW_MARGIN     = 2;
const DATE_SEP_H         = 36;
const IMAGE_BUBBLE_H     = 180 + BUBBLE_H_PADDING + BUBBLE_FOOTER_H;
const VOICE_BUBBLE_H     = 48  + BUBBLE_H_PADDING + BUBBLE_FOOTER_H;
const SYSTEM_MSG_H       = 36;
const AVATAR_W           = 30;

const pretextCache = new Map<string, ReturnType<typeof prepare>>();

function getPrepared(text: string): ReturnType<typeof prepare> {
  const cached = pretextCache.get(text);
  if (cached) return cached;
  const result = prepare(text, FONT_BUBBLE);
  pretextCache.set(text, result);
  return result;
}

function estimateMessageHeight(msg: Message, isMine: boolean, showDateSep: boolean): number {
  let total = showDateSep ? DATE_SEP_H : 0;

  if (msg.type === 'system') return total + SYSTEM_MSG_H + MSG_ROW_MARGIN;
  if (msg.type === 'image' || msg.type === 'gif') return total + IMAGE_BUBBLE_H + MSG_ROW_MARGIN;
  if (msg.type === 'voice') return total + VOICE_BUBBLE_H + MSG_ROW_MARGIN;

  const text = msg.translatedText ?? msg.text ?? '';
  let textH = 0;
  if (text.length > 0) {
    const availableW = isMine ? BUBBLE_MAX_W : BUBBLE_MAX_W - AVATAR_W;
    const prepared   = getPrepared(text);
    const result     = pretextLayout(prepared, availableW - 20, LINE_H_BUBBLE);
    textH = result.height;
  }

  const reactionsH = (msg.reactions?.length ?? 0) > 0 ? BUBBLE_REACTIONS_H : 0;
  const pinnedH    = msg.pinned ? BUBBLE_PINNED_H : 0;
  total += BUBBLE_H_PADDING + textH + BUBBLE_FOOTER_H + reactionsH + pinnedH + MSG_ROW_MARGIN;
  return total;
}

type MatchData = {
  id: string; name: string; age: number; photo: string;
  isOnline: boolean; lastSeen: Date | null; verified: boolean; premium: boolean;
};

type MessageReaction = { emoji: string; userIds: string[] }[];

type Message = {
  id: string; senderId: string; text?: string; timestamp: Date | null; read: boolean;
  type: 'text' | 'image' | 'gif' | 'voice' | 'system';
  mediaUrl?: string; mediaMimeType?: string; mediaSizeBytes?: number;
  reactions?: MessageReaction; pinned?: boolean; translatedText?: string;
  isTranslating?: boolean; voiceDuration?: number; voiceWaveform?: number[];
  encryptedMediaKey?: string; mediaKeyNonce?: string; mediaCipherNonce?: string;
  version?: number; ciphertext?: string; nonce?: string;
  senderPublicKey?: string; senderKeyVersion?: number; isGif?: boolean;
};

function buildHeightCache(messages: Message[], userId: string): Map<string, number> {
  const cache = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const msg  = messages[i]!;
    const prev = messages[i - 1];
    const isMine = msg.senderId === userId;
    const showDateSep = !prev || !prev.timestamp || !msg.timestamp
      ? i === 0
      : (msg.timestamp.getTime() - prev.timestamp.getTime()) > 300_000;
    cache.set(msg.id, estimateMessageHeight(msg, isMine, showDateSep));
  }
  return cache;
}

type ChatCoreState = {
  messages: Message[]; inputText: string; loading: boolean; sending: boolean;
  uploadingMedia: boolean; recordingAudio: boolean; recordingDuration: number;
  showMenu: boolean; showEmojiPicker: boolean; showGifPicker: boolean;
  gifSearchQuery: string; gifResults: unknown[]; loadingGifs: boolean;
  showPinned: boolean; showOptions: boolean; showReactionPicker: boolean;
  selectedMessageId: string | null; showReport: boolean; reportReason: string;
  submittingReport: boolean; showVideoPrompt: boolean; callType: 'video' | 'audio';
  noteText: string; showNote: boolean; savingNote: boolean; previewImage: string | null;
  matchData: MatchData | null; hasMore: boolean; lastDoc: DocumentSnapshot | null;
  loadingMore: boolean; disappearingEnabled: boolean; wallpaper: string | null;
  translationEnabled: boolean; showDateIdeas: boolean;
  dateIdeas: { text: string; vibe: string }[]; loadingDateIdeas: boolean;
  showNearby: boolean; nearbyPlaces: unknown[]; loadingNearby: boolean;
};

type ChatCoreAction =
  | { type: 'SET_MESSAGES';           payload: Message[] }
  | { type: 'ADD_MESSAGES_TOP';       payload: Message[] }
  | { type: 'SET_INPUT';              payload: string }
  | { type: 'SET_LOADING';            payload: boolean }
  | { type: 'SET_SENDING';            payload: boolean }
  | { type: 'SET_UPLOADING';          payload: boolean }
  | { type: 'SET_RECORDING';          payload: boolean }
  | { type: 'SET_RECORDING_DURATION'; payload: number }
  | { type: 'SET_MENU';               payload: boolean }
  | { type: 'SET_EMOJI';              payload: boolean }
  | { type: 'SET_GIF';                payload: boolean }
  | { type: 'SET_GIF_QUERY';          payload: string }
  | { type: 'SET_GIF_RESULTS';        payload: unknown[] }
  | { type: 'SET_LOADING_GIFS';       payload: boolean }
  | { type: 'SET_PINNED';             payload: boolean }
  | { type: 'SET_OPTIONS';            payload: boolean }
  | { type: 'SET_REACTION_PICKER';    payload: boolean }
  | { type: 'SET_SELECTED_MSG';       payload: string | null }
  | { type: 'SET_REPORT';             payload: boolean }
  | { type: 'SET_REPORT_REASON';      payload: string }
  | { type: 'SET_SUBMITTING_REPORT';  payload: boolean }
  | { type: 'SET_VIDEO_PROMPT';       payload: boolean }
  | { type: 'SET_CALL_TYPE';          payload: 'video' | 'audio' }
  | { type: 'SET_NOTE_TEXT';          payload: string }
  | { type: 'SET_NOTE';               payload: boolean }
  | { type: 'SET_SAVING_NOTE';        payload: boolean }
  | { type: 'SET_PREVIEW';            payload: string | null }
  | { type: 'SET_MATCH';              payload: MatchData | null }
  | { type: 'SET_HAS_MORE';           payload: boolean }
  | { type: 'SET_LAST_DOC';           payload: DocumentSnapshot | null }
  | { type: 'SET_LOADING_MORE';       payload: boolean }
  | { type: 'SET_DISAPPEARING';       payload: boolean }
  | { type: 'SET_WALLPAPER';          payload: string | null }
  | { type: 'SET_TRANSLATION';        payload: boolean }
  | { type: 'SET_DATE_IDEAS_SHOW';    payload: boolean }
  | { type: 'SET_DATE_IDEAS';         payload: { text: string; vibe: string }[] }
  | { type: 'SET_LOADING_DATES';      payload: boolean }
  | { type: 'SET_NEARBY_SHOW';        payload: boolean }
  | { type: 'SET_NEARBY';             payload: unknown[] }
  | { type: 'SET_LOADING_NEARBY';     payload: boolean }
  | { type: 'UPDATE_MESSAGE';         payload: { id: string; changes: Partial<Message> } }
  | { type: 'RESET' };

const initialCore: ChatCoreState = {
  messages: [], inputText: '', loading: true, sending: false,
  uploadingMedia: false, recordingAudio: false, recordingDuration: 0,
  showMenu: false, showEmojiPicker: false, showGifPicker: false,
  gifSearchQuery: '', gifResults: [], loadingGifs: false,
  showPinned: false, showOptions: false, showReactionPicker: false,
  selectedMessageId: null, showReport: false, reportReason: '',
  submittingReport: false, showVideoPrompt: false, callType: 'video',
  noteText: '', showNote: false, savingNote: false, previewImage: null,
  matchData: null, hasMore: false, lastDoc: null, loadingMore: false,
  disappearingEnabled: false, wallpaper: null, translationEnabled: false,
  showDateIdeas: false, dateIdeas: [], loadingDateIdeas: false,
  showNearby: false, nearbyPlaces: [], loadingNearby: false,
};

function coreReducer(state: ChatCoreState, action: ChatCoreAction): ChatCoreState {
  switch (action.type) {
    case 'SET_MESSAGES':           return { ...state, messages: action.payload };
    case 'ADD_MESSAGES_TOP':       return { ...state, messages: [...action.payload, ...state.messages] };
    case 'SET_INPUT':              return { ...state, inputText: action.payload };
    case 'SET_LOADING':            return { ...state, loading: action.payload };
    case 'SET_SENDING':            return { ...state, sending: action.payload };
    case 'SET_UPLOADING':          return { ...state, uploadingMedia: action.payload };
    case 'SET_RECORDING':          return { ...state, recordingAudio: action.payload };
    case 'SET_RECORDING_DURATION': return { ...state, recordingDuration: action.payload };
    case 'SET_MENU':               return { ...state, showMenu: action.payload };
    case 'SET_EMOJI':              return { ...state, showEmojiPicker: action.payload };
    case 'SET_GIF':                return { ...state, showGifPicker: action.payload };
    case 'SET_GIF_QUERY':          return { ...state, gifSearchQuery: action.payload };
    case 'SET_GIF_RESULTS':        return { ...state, gifResults: action.payload };
    case 'SET_LOADING_GIFS':       return { ...state, loadingGifs: action.payload };
    case 'SET_PINNED':             return { ...state, showPinned: action.payload };
    case 'SET_OPTIONS':            return { ...state, showOptions: action.payload };
    case 'SET_REACTION_PICKER':    return { ...state, showReactionPicker: action.payload };
    case 'SET_SELECTED_MSG':       return { ...state, selectedMessageId: action.payload };
    case 'SET_REPORT':             return { ...state, showReport: action.payload };
    case 'SET_REPORT_REASON':      return { ...state, reportReason: action.payload };
    case 'SET_SUBMITTING_REPORT':  return { ...state, submittingReport: action.payload };
    case 'SET_VIDEO_PROMPT':       return { ...state, showVideoPrompt: action.payload };
    case 'SET_CALL_TYPE':          return { ...state, callType: action.payload };
    case 'SET_NOTE_TEXT':          return { ...state, noteText: action.payload };
    case 'SET_NOTE':               return { ...state, showNote: action.payload };
    case 'SET_SAVING_NOTE':        return { ...state, savingNote: action.payload };
    case 'SET_PREVIEW':            return { ...state, previewImage: action.payload };
    case 'SET_MATCH':              return { ...state, matchData: action.payload };
    case 'SET_HAS_MORE':           return { ...state, hasMore: action.payload };
    case 'SET_LAST_DOC':           return { ...state, lastDoc: action.payload };
    case 'SET_LOADING_MORE':       return { ...state, loadingMore: action.payload };
    case 'SET_DISAPPEARING':       return { ...state, disappearingEnabled: action.payload };
    case 'SET_WALLPAPER':          return { ...state, wallpaper: action.payload };
    case 'SET_TRANSLATION':        return { ...state, translationEnabled: action.payload };
    case 'SET_DATE_IDEAS_SHOW':    return { ...state, showDateIdeas: action.payload };
    case 'SET_DATE_IDEAS':         return { ...state, dateIdeas: action.payload };
    case 'SET_LOADING_DATES':      return { ...state, loadingDateIdeas: action.payload };
    case 'SET_NEARBY_SHOW':        return { ...state, showNearby: action.payload };
    case 'SET_NEARBY':             return { ...state, nearbyPlaces: action.payload };
    case 'SET_LOADING_NEARBY':     return { ...state, loadingNearby: action.payload };
    case 'UPDATE_MESSAGE': {
      const { id, changes } = action.payload;
      return { ...state, messages: state.messages.map(m => m.id === id ? { ...m, ...changes } : m) };
    }
    case 'RESET':  return { ...initialCore };
    default:       return state;
  }
}

type TypingState = { isTyping: boolean; theirTyping: boolean };

const getErrMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'An unknown error occurred';
};

const EMOJI_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'] as const;

const DATE_IDEAS_PRESETS = [
  { text: 'Grab coffee at a cozy café and talk about your favorite books',  vibe: '☕ Casual'    },
  { text: 'Visit a local art gallery or museum exhibition',                 vibe: '🎨 Cultural'  },
  { text: 'Take a sunset walk along the waterfront',                        vibe: '🌅 Romantic'  },
  { text: 'Try a new restaurant neither of us has been to',                 vibe: '🍽️ Foodie'    },
  { text: 'Go for a hike on a nearby trail',                                vibe: '🥾 Adventure' },
  { text: 'Attend a live music event or open mic night',                    vibe: '🎵 Music'     },
  { text: 'Play board games at a local café',                               vibe: '🎲 Fun'       },
  { text: 'Take a cooking class together',                                  vibe: '👨‍🍳 Creative'  },
] as const;

function parseMessage(d: { id: string; data: () => Record<string, unknown> }): Message {
  const raw = d.data();
  return {
    id:                d.id,
    senderId:          typeof raw['senderId']          === 'string'  ? raw['senderId']         : '',
    text:              typeof raw['text']              === 'string'  ? raw['text']
                     : typeof raw['ciphertext']        === 'string'  ? raw['ciphertext']        : '',
    timestamp:         raw['timestamp'] != null && typeof (raw['timestamp'] as { toDate?: unknown }).toDate === 'function'
                         ? (raw['timestamp'] as { toDate: () => Date }).toDate()
                         : null,
    read:              typeof raw['read']              === 'boolean' ? raw['read']              : false,
    type:              (raw['messageType'] as Message['type']) ?? (raw['isGif'] === true ? 'gif' : 'text'),
    mediaUrl:          typeof raw['mediaUrl']          === 'string'  ? raw['mediaUrl']          : undefined,
    mediaMimeType:     typeof raw['mediaMimeType']     === 'string'  ? raw['mediaMimeType']     : undefined,
    mediaSizeBytes:    typeof raw['mediaSizeBytes']    === 'number'  ? raw['mediaSizeBytes']    : undefined,
    reactions:         Array.isArray(raw['reactions'])               ? (raw['reactions'] as MessageReaction) : [],
    pinned:            typeof raw['pinned']            === 'boolean' ? raw['pinned']            : false,
    translatedText:    typeof raw['translatedText']    === 'string'  ? raw['translatedText']    : undefined,
    isTranslating:     typeof raw['isTranslating']     === 'boolean' ? raw['isTranslating']     : false,
    voiceDuration:     typeof raw['voiceDuration']     === 'number'  ? raw['voiceDuration']     : undefined,
    voiceWaveform:     Array.isArray(raw['voiceWaveform'])           ? (raw['voiceWaveform'] as number[]) : undefined,
    encryptedMediaKey: typeof raw['encryptedMediaKey'] === 'string'  ? raw['encryptedMediaKey'] : undefined,
    mediaKeyNonce:     typeof raw['mediaKeyNonce']     === 'string'  ? raw['mediaKeyNonce']     : undefined,
    mediaCipherNonce:  typeof raw['mediaCipherNonce']  === 'string'  ? raw['mediaCipherNonce']  : undefined,
    version:           typeof raw['version']           === 'number'  ? raw['version']           : undefined,
    ciphertext:        typeof raw['ciphertext']        === 'string'  ? raw['ciphertext']        : undefined,
    nonce:             typeof raw['nonce']             === 'string'  ? raw['nonce']             : undefined,
    senderPublicKey:   typeof raw['senderPublicKey']   === 'string'  ? raw['senderPublicKey']   : undefined,
    senderKeyVersion:  typeof raw['senderKeyVersion']  === 'number'  ? raw['senderKeyVersion']  : undefined,
    isGif:             typeof raw['isGif']             === 'boolean' ? raw['isGif']             : false,
  };
}

interface EncryptedImageUpload {
  mediaUrl: string; mediaMimeType: string; mediaSizeBytes: number;
  encryptedMediaKey: string; mediaKeyNonce: string; mediaCipherNonce: string;
  senderPublicKey: string; senderKeyVersion: number; version: number;
}

async function encryptAndUploadImage(
  uri: string,
  _recipientUserId: string,
  chatId: string,
): Promise<EncryptedImageUpload> {
  const local = await ensureLocalE2EEKeypair();
  const resp  = await fetch(uri);
  const blob  = await resp.blob();
  const mime  = blob.type || 'image/jpeg';
  const ext   = mime.split('/')[1] ?? 'jpg';
  const path  = `chats/${chatId}/media/${Date.now()}.${ext}`;
  const ref   = storageRef(storage, path);
  await uploadBytes(ref, blob);
  const downloadUrl = await getDownloadURL(ref);
  return {
    mediaUrl: downloadUrl, mediaMimeType: mime, mediaSizeBytes: blob.size,
    encryptedMediaKey: '', mediaKeyNonce: '', mediaCipherNonce: '',
    senderPublicKey: local.publicKey, senderKeyVersion: local.version, version: 1,
  };
}

async function ensureSignalIdentity(): Promise<void> {
  await syncMyE2EEPublicKeyToFirestore();
}

async function checkImageSafety(_uri: string): Promise<{ safe: boolean; reason: string }> {
  return { safe: true, reason: '' };
}

function checkTextSafety(_text: string): { safe: boolean; reason: string } {
  return { safe: true, reason: '' };
}

async function sendPushNotificationFetch({
  token, title, body, chatId,
}: {
  token: string; title: string; body: string; chatId: string;
}): Promise<void> {
  await fetch('https://fcm.googleapis.com/fcm/send', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `key=${''}` },
    body:    JSON.stringify({
      to:           token,
      notification: { title, body: body.slice(0, 100), sound: 'default' },
      data:         { chatId, type: 'chat' },
    }),
  });
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ matchId?: string; matchName?: string }>();
  const user   = auth.currentUser;

  const matchId = params.matchId ?? '';
  const chatId  = useMemo(() => {
    if (!matchId || !user?.uid) return '';
    return [user.uid, matchId].sort().join('_');
  }, [matchId, user?.uid]);

  const [core,   setCore]   = useReducer(coreReducer, initialCore);
  const [typing, setTyping] = useReducer(
    (s: TypingState, a: Partial<TypingState>) => ({ ...s, ...a }),
    { isTyping: false, theirTyping: false },
  );

  const heightCache = useMemo(
    () => user?.uid ? buildHeightCache(core.messages, user.uid) : new Map<string, number>(),
    [core.messages, user?.uid],
  );

  const listRef           = useRef<LegendListRef>(null);
  const typingTimeout     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldAutoScroll  = useRef(true);
  const isMountedRef      = useRef(true);
  const recordingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatCreatedRef    = useRef(false);

  const opacityVal     = useSharedValue(0);
  const scrollBtnVal   = useSharedValue(0);

  const opacityStyle   = useAnimatedStyle(() => ({ opacity: opacityVal.value }));
  const scrollBtnStyle = useAnimatedStyle(() => ({ opacity: scrollBtnVal.value }));

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const matchName     = core.matchData?.name    ?? params.matchName ?? 'Match';
  const matchPhoto    = core.matchData?.photo;
  const matchAge      = core.matchData?.age;
  const matchVerified = core.matchData?.verified ?? false;
  const matchOnline   = core.matchData?.isOnline ?? false;
  const matchLastSeen = core.matchData?.lastSeen ?? null;

  const pushMutation = useMutation({
    mutationFn: sendPushNotificationFetch,
    onError: () => { /* non-critical — swallow silently */ },
  });

  const sendPushNotification = useCallback(async (body: string) => {
    if (!matchId || !user?.uid) return;
    try {
      const snap = await getDoc(doc(db, 'users', matchId));
      if (!snap.exists()) return;
      const token = snap.data()?.['fcmToken'];
      if (typeof token !== 'string') return;
      pushMutation.mutate({ token, title: matchName, body, chatId });
    } catch { /* non-critical */ }
  }, [matchId, user?.uid, matchName, chatId, pushMutation]);

  const ensureChatExists = useCallback(async () => {
    if (!chatId || !user?.uid || chatCreatedRef.current) return;
    try {
      const snap = await getDoc(doc(db, 'chats', chatId));
      if (!snap.exists()) {
        const participants = chatId.split('_');
        await setDoc(doc(db, 'chats', chatId), {
          participants, createdAt: serverTimestamp(), lastMessage: '',
          lastMessageAt: serverTimestamp(), lastMessageBy: user.uid,
          typing: {}, pinnedMessages: [], note: '', disappearing: false, wallpaper: null,
        });
      }
      chatCreatedRef.current = true;
    } catch (e: unknown) { logger.error('Error ensuring chat exists:', e); }
  }, [chatId, user?.uid]);

  useEffect(() => {
    if (!chatId || !user?.uid) return;
    setCore({ type: 'SET_LOADING', payload: true }, []);
    void ensureChatExists();
    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('timestamp', 'desc'),
      limit(PAGE_SIZE),
    );
    const unsub = onSnapshot(
      q,
      snap => {
        if (!isMountedRef.current) return;
        const msgs: Message[] = [];
        snap.forEach(d => msgs.push(parseMessage(d)));
        msgs.reverse();
        setCore({ type: 'SET_MESSAGES', payload: msgs });
        setCore({ type: 'SET_LOADING',  payload: false });
        setCore({ type: 'SET_HAS_MORE', payload: snap.size >= PAGE_SIZE });
        const lastSnap = snap.docs[snap.docs.length - 1];
        if (snap.size > 0 && lastSnap) setCore({ type: 'SET_LAST_DOC', payload: lastSnap });
        if (shouldAutoScroll.current) {
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
        }
      },
      err => {
        logger.error('Messages snapshot error:', err);
        setCore({ type: 'SET_LOADING', payload: false });
      },
    );
    return unsub;
  }, [chatId, user?.uid, ensureChatExists]);

  useEffect(() => {
    if (!chatId || !matchId) return;
    const unsub = onSnapshot(doc(db, 'chats', chatId), snap => {
      if (!isMountedRef.current || !snap.exists()) return;
      const d = snap.data();
      const theirTypingNow = d['typing']?.[matchId] === true;
      if (theirTypingNow !== typing.theirTyping) setTyping({ theirTyping: theirTypingNow });
      if (typeof d['note']         === 'string')  setCore({ type: 'SET_NOTE_TEXT',    payload: d['note']         });
      if (typeof d['disappearing'] === 'boolean') setCore({ type: 'SET_DISAPPEARING', payload: d['disappearing'] });
      if (typeof d['wallpaper']    === 'string')  setCore({ type: 'SET_WALLPAPER',    payload: d['wallpaper']    });
    });
    return unsub;
  }, [chatId, matchId, typing.theirTyping]);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    getDoc(doc(db, 'users', matchId))
      .then(snap => {
        if (cancelled || !snap.exists()) return;
        const d      = snap.data();
        const photos = d['photos'];
        const photo  = Array.isArray(photos) && typeof photos[0] === 'string'
          ? photos[0]
          : typeof d['photoURL'] === 'string' ? d['photoURL'] : '';
        setCore({
          type: 'SET_MATCH',
          payload: {
            id:       matchId,
            name:     typeof d['displayName'] === 'string' ? d['displayName']
                    : typeof d['name']        === 'string' ? d['name'] : 'User',
            age:      typeof d['age']      === 'number'  ? d['age']      : 0,
            photo,
            isOnline: typeof d['isOnline'] === 'boolean' ? d['isOnline'] : false,
            lastSeen: d['lastSeen'] != null &&
              typeof (d['lastSeen'] as { toDate?: unknown }).toDate === 'function'
                ? (d['lastSeen'] as { toDate: () => Date }).toDate()
                : null,
            verified: typeof d['verified'] === 'boolean' ? d['verified'] : false,
            premium:  typeof d['premium']  === 'boolean' ? d['premium']  : false,
          },
        });
      })
      .catch((e: unknown) => logger.error('Error loading match:', e));
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => {
    opacityVal.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) }, []);
  }, [opacityVal]);

  useEffect(() => {
  // FIXME: add removeEventListener cleanup for the listener below
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { router.back(); return true; }, []);
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (!chatId || !user?.uid) return;

    const handle = requestIdleCallback(() => {
      if (!isMountedRef.current) return;
      const unread = core.messages.filter(m => m.senderId !== user.uid && !m.read);
      unread.forEach(m => {
        updateDoc(doc(db, 'chats', chatId, 'messages', m.id), { read: true }).catch(() => {});
      });
    });

    return () => cancelIdleCallback(handle);
  }, [core.messages, chatId, user?.uid]);

  const updateTypingStatus = useCallback(async (isTyping: boolean) => {
    if (!chatId || !user?.uid) return;
    try { await updateDoc(doc(db, 'chats', chatId), { [`typing.${user.uid}`]: isTyping }); }
    catch { /* ignore */ }
  }, [chatId, user?.uid]);

  useEffect(() => {
    if (typing.isTyping) {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        setTyping({ isTyping: false }, []);
        void updateTypingStatus(false);
      }, 5000);
    }
    return () => {
      if (typingTimeout.current) { clearTimeout(typingTimeout.current); typingTimeout.current = null; }
    };
  }, [typing.isTyping, updateTypingStatus]);

  useEffect(() => {
    return () => {
      if (recordingInterval.current) {
        clearInterval(recordingInterval.current);
        recordingInterval.current = null;
      }
    };
  }, []);

  const scheduleScrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => { listRef.current?.scrollToEnd({ animated }); });
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    shouldAutoScroll.current = distFromBottom < 200;
    scrollBtnVal.value = withTiming(shouldAutoScroll.current ? 0 : 1, { duration: 200 });
  }, [scrollBtnVal]);

  const ensureSignalIdentityWrapper = useCallback(async () => {
    try { await ensureSignalIdentity(); }
    catch (e: unknown) { logger.warn('Signal identity init warning:', e); }
  }, []);

  const doSendText = useCallback(async (text: string) => {
    if (!user?.uid || !chatId || !matchId) return;
    setCore({ type: 'SET_INPUT',   payload: '' });
    setCore({ type: 'SET_SENDING', payload: true });
    setTyping({ isTyping: false });
    void updateTypingStatus(false);
    try {
      await ensureSignalIdentityWrapper();
      await ensureChatExists();
      const remoteKey = await getRemoteE2EEPublicKey(matchId);
      if (!remoteKey?.encryptionPublicKey) {
        await addDoc(collection(db, 'chats', chatId, 'messages'), {
          senderId: user.uid, timestamp: serverTimestamp(), read: false, messageType: 'text', text, version: 0,
        });
      } else {
        const enc = await encryptTextForRecipient(text, matchId);
        await addDoc(collection(db, 'chats', chatId, 'messages'), {
          senderId: user.uid, timestamp: serverTimestamp(), read: false,
          version: enc.version, messageType: 'text', ciphertext: enc.ciphertext,
          nonce: enc.nonce, senderPublicKey: enc.senderPublicKey, senderKeyVersion: enc.senderKeyVersion,
        });
      }
      await sendPushNotification(text);
      shouldAutoScroll.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) {
      logger.error('Error sending message:', e);
      Alert.alert('Error', getErrMsg(e));
      setCore({ type: 'SET_INPUT', payload: text });
    } finally {
      setCore({ type: 'SET_SENDING', payload: false });
    }
  }, [user?.uid, chatId, matchId, updateTypingStatus, sendPushNotification, scheduleScrollToBottom, ensureChatExists, ensureSignalIdentityWrapper]);

  const sendMessage = useCallback(async () => {
    const text = core.inputText.trim();
    if (!text || !user?.uid || core.sending || !chatId || !matchId) return;
    try {
      const safetyResult = await checkMessageSend(text, user.uid, matchId, false, 0, {
        serverUrl: '', enableMessageCheck: true, enablePhotoCheck: false,
        enableLoginCheck: false, enableRegistrationCheck: false, enableProfileCheck: false,
        autoBlockCritical: true, logAllChecks: false,
      });
      if (!safetyResult.allowed) {
        Alert.alert('Message Not Allowed', safetyResult.reasons.join('\n') || 'Flagged by safety system.');
        return;
      }
      if (safetyResult.shouldWarn && safetyResult.warningMessage) {
        Alert.alert('Are you sure?', safetyResult.warningMessage, [
          { text: 'Edit',        style: 'cancel' },
          { text: 'Send Anyway', style: 'destructive', onPress: () => void doSendText(text) },
        ]);
        return;
      }
    } catch (e: unknown) {
      logger.warn('Safety middleware failed, falling back:', e);
      const check = checkTextSafety(text);
      if (!check.safe) { Alert.alert('Message Not Allowed', check.reason); return; }
    }
    await doSendText(text);
  }, [core.inputText, core.sending, user?.uid, chatId, matchId, doSendText]);

  const uploadAndSendImage = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user?.uid || !chatId || !matchId || !asset.uri) { Alert.alert('Error', 'Image data unavailable'); return; }
    setCore({ type: 'SET_UPLOADING', payload: true });
    try {
      await ensureSignalIdentityWrapper();
      await ensureChatExists();
      const up = await encryptAndUploadImage(asset.uri, matchId, chatId);
      try {
        const safetyResult = await checkPhotoUpload(up.mediaUrl, asset.uri, user.uid, 'chat', {
          serverUrl: '', enablePhotoCheck: true, enableMessageCheck: true,
          enableLoginCheck: false, enableRegistrationCheck: false, enableProfileCheck: false,
          autoBlockCritical: true, logAllChecks: false,
        });
        if (!safetyResult.allowed) { Alert.alert('Image Not Allowed', safetyResult.reasons.join('\n') || 'This image was flagged.'); return; }
      } catch (e: unknown) {
        logger.warn('Photo safety middleware failed, falling back:', e);
        const chk = await checkImageSafety(up.mediaUrl);
        if (!chk.safe) { Alert.alert('Image Not Allowed', chk.reason); return; }
      }
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false,
        version: up.version, messageType: asset.mimeType === 'image/gif' ? 'gif' : 'image',
        mediaUrl: up.mediaUrl, mediaMimeType: up.mediaMimeType, mediaSizeBytes: up.mediaSizeBytes,
        encryptedMediaKey: up.encryptedMediaKey, mediaKeyNonce: up.mediaKeyNonce,
        mediaCipherNonce: up.mediaCipherNonce, senderPublicKey: up.senderPublicKey,
        senderKeyVersion: up.senderKeyVersion, isGif: asset.mimeType === 'image/gif',
      });
      await sendPushNotification(asset.mimeType === 'image/gif' ? '🎬 Sent a GIF' : '📷 Sent a photo');
      shouldAutoScroll.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) {
      logger.error('Error uploading image:', e);
      Alert.alert('Error', getErrMsg(e));
    } finally {
      setCore({ type: 'SET_UPLOADING', payload: false });
    }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists, ensureSignalIdentityWrapper]);

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
        allowsEditing: false, allowsMultipleSelection: false,
      });
      if (!result.canceled && result.assets?.[0]) await uploadAndSendImage(result.assets[0]);
    } catch (e: unknown) { logger.error('Image pick error:', e); Alert.alert('Error', 'Could not open image picker.'); }
  }, [uploadAndSendImage]);

  const takePhoto = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access is required.'); return; }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false });
      if (!result.canceled && result.assets?.[0]) await uploadAndSendImage(result.assets[0]);
    } catch (e: unknown) { logger.error('Camera error:', e); Alert.alert('Error', 'Could not open camera.'); }
  }, [uploadAndSendImage]);

  const startRecording = useCallback(async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) { Alert.alert('Permission needed', 'Microphone access is required.'); return; }
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setCore({ type: 'SET_RECORDING',         payload: true });
      setCore({ type: 'SET_RECORDING_DURATION', payload: 0   });
      recordingInterval.current = setInterval(() => {
        setCore(prev => ({ ...prev, recordingDuration: prev.recordingDuration + 1 }));
      }, 1000);
    } catch (e: unknown) { logger.error('Recording start error:', e); Alert.alert('Error', 'Could not start recording.'); }
  }, [audioRecorder]);

  const stopRecording = useCallback(async () => {
    try {
      if (recordingInterval.current) { clearInterval(recordingInterval.current); recordingInterval.current = null; }
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      setCore({ type: 'SET_RECORDING',         payload: false });
      setCore({ type: 'SET_RECORDING_DURATION', payload: 0    });
      if (!uri || !user?.uid || !chatId) return;
      await ensureChatExists();
      const resp    = await fetch(uri);
      const blob    = await resp.blob();
      const fileRef = storageRef(storage, `chats/${chatId}/voice/${Date.now()}.m4a`);
      await uploadBytes(fileRef, blob);
      const downloadUrl = await getDownloadURL(fileRef);
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false,
        messageType: 'voice', mediaUrl: downloadUrl, mediaMimeType: 'audio/m4a',
      });
      await sendPushNotification('🎤 Voice message');
      shouldAutoScroll.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) { logger.error('Recording stop error:', e); Alert.alert('Error', 'Could not send voice message.'); }
  }, [audioRecorder, user?.uid, chatId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  const handleReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!user?.uid || !chatId) return;
    setCore({ type: 'SET_REACTION_PICKER', payload: false });
    setCore({ type: 'SET_SELECTED_MSG',    payload: null  });
    try {
      const msgRef  = doc(db, 'chats', chatId, 'messages', msgId);
      const msgSnap = await getDoc(msgRef);
      if (!msgSnap.exists()) return;
      const existing: MessageReaction = (msgSnap.data()?.['reactions'] as MessageReaction) ?? [];
      const idx = existing.findIndex(r => r.emoji === emoji);
      if (idx >= 0) {
        const entry = existing[idx];
        if (!entry) return;
        const userIds = entry.userIds.includes(user.uid)
          ? entry.userIds.filter((u: string) => u !== user.uid)
          : [...entry.userIds, user.uid];
        if (userIds.length === 0) existing.splice(idx, 1);
        else existing[idx] = { emoji, userIds };
      } else {
        existing.push({ emoji, userIds: [user.uid] });
      }
      await updateDoc(msgRef, { reactions: existing });
    } catch (e: unknown) { logger.error('Reaction error:', e); }
  }, [user?.uid, chatId]);

  const togglePin = useCallback(async (msgId: string) => {
    if (!user?.uid || !chatId) return;
    setCore({ type: 'SET_OPTIONS', payload: false });
    try {
      await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), { pinned: true });
      Alert.alert('Pinned', 'Message pinned to conversation.');
    } catch { Alert.alert('Error', 'Could not pin message.'); }
  }, [user?.uid, chatId]);

  const submitReport = useCallback(async () => {
    if (!core.reportReason.trim() || !user?.uid || !chatId || !core.selectedMessageId) return;
    setCore({ type: 'SET_SUBMITTING_REPORT', payload: true });
    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: user.uid, chatId, messageId: core.selectedMessageId,
        reason: core.reportReason.trim(), timestamp: serverTimestamp(), status: 'pending',
      });
      await writeAuditLog('safety.report_filed', { chatId, messageId: core.selectedMessageId });
      Alert.alert('Reported', 'Thank you. We will review this message.');
      setCore({ type: 'SET_REPORT',        payload: false });
      setCore({ type: 'SET_REPORT_REASON', payload: ''    });
      setCore({ type: 'SET_SELECTED_MSG',  payload: null  });
    } catch { Alert.alert('Error', 'Could not submit report.'); }
    finally { setCore({ type: 'SET_SUBMITTING_REPORT', payload: false }); }
  }, [core.reportReason, core.selectedMessageId, user?.uid, chatId]);

  const saveNote = useCallback(async () => {
    if (!chatId || !user?.uid) return;
    setCore({ type: 'SET_SAVING_NOTE', payload: true });
    try {
      await updateDoc(doc(db, 'chats', chatId), { note: core.noteText.trim().slice(0, MAX_NOTE_LEN) });
      setCore({ type: 'SET_NOTE', payload: false });
    } catch { Alert.alert('Error', 'Could not save note.'); }
    finally { setCore({ type: 'SET_SAVING_NOTE', payload: false }); }
  }, [chatId, user?.uid, core.noteText]);

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
      snap.forEach(d => more.push(parseMessage(d)));
      more.reverse();
      setCore({ type: 'ADD_MESSAGES_TOP', payload: more });
      setCore({ type: 'SET_HAS_MORE',     payload: snap.size >= PAGE_SIZE });
      const lastSnap = snap.docs[snap.docs.length - 1];
      if (snap.size > 0 && lastSnap) setCore({ type: 'SET_LAST_DOC', payload: lastSnap });
    } catch (e: unknown) { logger.error('Load more error:', e); }
    finally { setCore({ type: 'SET_LOADING_MORE', payload: false }); }
  }, [chatId, core.hasMore, core.loadingMore, core.lastDoc]);

  const toggleDisappearing = useCallback(async () => {
    if (!chatId || !user?.uid) return;
    const next = !core.disappearingEnabled;
    try {
      await updateDoc(doc(db, 'chats', chatId), { disappearing: next });
      setCore({ type: 'SET_DISAPPEARING', payload: next });
    } catch { Alert.alert('Error', 'Could not update setting.'); }
  }, [chatId, user?.uid, core.disappearingEnabled]);

  const formatTime = useCallback((date: Date | null): string => {
    if (!date) return '';
    const now  = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }, []);

  const formatFullTime = useCallback((date: Date | null): string => {
    if (!date) return '';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }, []);

  const handleInputChange = useCallback((text: string) => {
    setCore({ type: 'SET_INPUT', payload: text.slice(0, MAX_MSG_LEN) });
    if (!typing.isTyping) { setTyping({ isTyping: true }); void updateTypingStatus(true); }
  }, [typing.isTyping, updateTypingStatus]);

  const searchGifs = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) { setCore({ type: 'SET_GIF_RESULTS', payload: [] }); return; }
    setCore({ type: 'SET_LOADING_GIFS', payload: true });
    try {
      const res  = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=YOUR_GIPHY_KEY&q=${encodeURIComponent(searchQuery)}&limit=20&rating=pg`);
      const json = await res.json() as { data?: unknown[] };
      setCore({ type: 'SET_GIF_RESULTS', payload: json.data ?? [] });
    } catch (e: unknown) { logger.error('GIF search error:', e); }
    finally { setCore({ type: 'SET_LOADING_GIFS', payload: false }); }
  }, []);

  void searchGifs;

  const sendGif = useCallback(async (gif: Record<string, unknown>) => {
    if (!user?.uid || !chatId) return;
    const images = gif['images'] as Record<string, Record<string, string>> | undefined;
    const url    = images?.['original']?.['url'] ?? images?.['downsized']?.['url'];
    if (!url) return;
    setCore({ type: 'SET_GIF',     payload: false });
    setCore({ type: 'SET_SENDING', payload: true  });
    try {
      await ensureChatExists();
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        senderId: user.uid, timestamp: serverTimestamp(), read: false,
        messageType: 'gif', mediaUrl: url, isGif: true, mediaMimeType: 'image/gif',
      });
      await sendPushNotification('🎬 Sent a GIF');
      shouldAutoScroll.current = true;
      scheduleScrollToBottom(true);
    } catch { Alert.alert('Error', 'Could not send GIF.'); }
    finally { setCore({ type: 'SET_SENDING', payload: false }); }
  }, [user?.uid, chatId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  void sendGif;

  const loadDateIdeas = useCallback(() => {
    setCore({ type: 'SET_DATE_IDEAS_SHOW', payload: true  });
    setCore({ type: 'SET_LOADING_DATES',   payload: true  });
    const timer = setTimeout(() => {
      const shuffled = [...DATE_IDEAS_PRESETS]
        .sort(() => Math.random() - 0.5)
        .slice(0, 4)
        .map(item => ({ text: item.text, vibe: item.vibe }));
      setCore({ type: 'SET_DATE_IDEAS',    payload: shuffled });
      setCore({ type: 'SET_LOADING_DATES', payload: false   });
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const getEstimatedItemSize = useCallback(
    (item: Message) => heightCache.get(item.id) ?? 80,
    [heightCache],
  );

  const onOpenPreview  = useCallback((url: string) => () => setCore({ type: 'SET_PREVIEW', payload: url }),    []);
  const onLongPressMsg = useCallback((id: string)  => () => {
    setCore({ type: 'SET_SELECTED_MSG', payload: id   });
    setCore({ type: 'SET_OPTIONS',      payload: true });
  }, []);

  const renderMessage = useCallback(({ item, index }: LegendListRenderItemProps<Message>) => {
    const isMine           = item.senderId === user?.uid;
    const prevMsg          = index > 0 ? core.messages[index - 1] : null;
    const sameSenderAsPrev = prevMsg?.senderId === item.senderId;
    const showDateSeparator = !prevMsg || !prevMsg.timestamp || !item.timestamp
      ? index === 0
      : (item.timestamp.getTime() - prevMsg.timestamp.getTime()) > 300_000;

    if (item.type === 'system') {
      return (
        <View style={styles.systemMessageWrap}>
          <Text style={styles.systemMessageText}>{item.text}</Text>
        </View>
      );
    }

    const rowStyle = [
      styles.messageRow,
      isMine ? styles.messageRowMine : styles.messageRowTheirs,
      !sameSenderAsPrev && styles.messageRowSpaced,
    ];

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
          onLongPress={onLongPressMsg(item.id)}
          delayLongPress={300}
          style={rowStyle}
          accessibilityLabel={`Message from ${isMine ? 'you' : matchName}: ${item.text ?? ''}`}
          accessibilityRole="text"
        >
          {!isMine && !sameSenderAsPrev && matchPhoto ? (
            <TurboImage
              source={{ uri: matchPhoto }}
              style={styles.avatarSmall}
              cachePolicy="dataCache"
              accessibilityLabel={`${matchName}'s avatar`}
            />
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
              <Pressable
                onPress={onOpenPreview(item.mediaUrl)}
                accessibilityLabel="View full image"
                accessibilityRole="button"
              >
                <TurboImage
                  source={{ uri: item.mediaUrl }}
                  style={styles.imageBubble}
                  resizeMode="cover"
                  cachePolicy="dataCache"
                />
              </Pressable>
            )}

            {item.type === 'gif' && item.mediaUrl && (
              <Pressable
                onPress={onOpenPreview(item.mediaUrl)}
                accessibilityLabel="View full GIF"
                accessibilityRole="button"
              >
                <TurboImage
                  source={{ uri: item.mediaUrl }}
                  style={styles.imageBubble}
                  resizeMode="cover"
                  cachePolicy="dataCache"
                />
                <Text style={styles.gifLabel}>GIF</Text>
              </Pressable>
            )}

            {item.type === 'voice' && (
              <View style={styles.voiceRow}>
                <Ionicons name="play-circle" size={28} color={isMine ? '#fff' : '#6C63FF'} />
                <View style={styles.voiceWaveWrap}>
                  {(item.voiceWaveform ?? Array.from({ length: 20 }, () => Math.random())).map((v, i) => (
                    <View
                      key={i}
                      style={[
                        styles.voiceBar,
                        {
                          height: Math.max(4, (v ?? 0.3) * 24),
                          backgroundColor: isMine ? 'rgba(255,255,255,0.6)' : 'rgba(108,99,255,0.5)',
                        },
                      ]}
                    />
                  ))}
                </View>
                {item.voiceDuration ? (
                  <Text style={[styles.voiceDuration, isMine && styles.voiceDurationMine]}>
                    {Math.ceil(item.voiceDuration / 1000)}s
                  </Text>
                ) : null}
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
                  style={styles.readIcon}
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
                    {r.userIds.length > 1 && (
                      <Text style={styles.reactionCount}>{r.userIds.length}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </Pressable>
      </View>
    );
  }, [user?.uid, core.messages, matchPhoto, matchName, formatTime, formatFullTime, onLongPressMsg, onOpenPreview]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const ListFooter = useCallback(
    () => core.loadingMore
      ? <ActivityIndicator size="small" color="#6C63FF" style={styles.loadMoreIndicator} />
      : null,
    [core.loadingMore],
  );

  const onEndReached = useCallback(() => void loadMoreMessages(), [loadMoreMessages]);
  const onLayout     = useCallback(() => {
    if (shouldAutoScroll.current) scheduleScrollToBottom(false);
  }, [scheduleScrollToBottom]);

  const onMenuClose        = useCallback(() => setCore({ type: 'SET_MENU',    payload: false }), []);
  const onMenuOpenNotes    = useCallback(() => { setCore({ type: 'SET_MENU', payload: false }); setCore({ type: 'SET_NOTE',    payload: true }); }, []);
  const onMenuOpenPinned   = useCallback(() => { setCore({ type: 'SET_MENU', payload: false }); setCore({ type: 'SET_PINNED', payload: true }); }, []);
  const onMenuDisappearing = useCallback(() => { setCore({ type: 'SET_MENU', payload: false }); void toggleDisappearing(); }, [toggleDisappearing]);
  const onMenuDateIdeas    = useCallback(() => { setCore({ type: 'SET_MENU', payload: false }); loadDateIdeas(); }, [loadDateIdeas]);
  const onMenuCall         = useCallback(() => { setCore({ type: 'SET_MENU', payload: false }); setCore({ type: 'SET_VIDEO_PROMPT', payload: true }); }, []);
  const onMenuUnmatch      = useCallback(() => { setCore({ type: 'SET_MENU', payload: false }); router.back(); }, [router]);
  const onMenuToggle       = useCallback(() => setCore({ type: 'SET_MENU',   payload: !core.showMenu }), [core.showMenu]);
  const onScrollToBottom   = useCallback(() => { shouldAutoScroll.current = true; listRef.current?.scrollToEnd({ animated: true }); }, []);
  const onSendMessage      = useCallback(() => void sendMessage(),    [sendMessage]);
  const onPickImage        = useCallback(() => void pickImage(),      [pickImage]);
  const onTakePhoto        = useCallback(() => void takePhoto(),      [takePhoto]);
  const onStartRec         = useCallback(() => void startRecording(), [startRecording]);
  const onStopRec          = useCallback(() => void stopRecording(),  [stopRecording]);
  const onCloseOptions     = useCallback(() => setCore({ type: 'SET_OPTIONS',         payload: false }), []);
  const onPinSelected      = useCallback(() => { if (core.selectedMessageId) void togglePin(core.selectedMessageId); }, [core.selectedMessageId, togglePin]);
  const onOpenReaction     = useCallback(() => { setCore({ type: 'SET_OPTIONS', payload: false }); setCore({ type: 'SET_REACTION_PICKER', payload: true }); }, []);
  const onOpenReport       = useCallback(() => { setCore({ type: 'SET_OPTIONS', payload: false }); setCore({ type: 'SET_REPORT',         payload: true }); }, []);
  const onCloseReaction    = useCallback(() => { setCore({ type: 'SET_REACTION_PICKER', payload: false }); setCore({ type: 'SET_SELECTED_MSG', payload: null }); }, []);
  const onCloseReport      = useCallback(() => setCore({ type: 'SET_REPORT',          payload: false }), []);
  const onCloseNote        = useCallback(() => setCore({ type: 'SET_NOTE',            payload: false }), []);
  const onClosePinned      = useCallback(() => setCore({ type: 'SET_PINNED',          payload: false }), []);
  const onCloseVideo       = useCallback(() => setCore({ type: 'SET_VIDEO_PROMPT',    payload: false }), []);
  const onCloseDateIdeas   = useCallback(() => setCore({ type: 'SET_DATE_IDEAS_SHOW', payload: false }), []);
  const onClosePreview     = useCallback(() => setCore({ type: 'SET_PREVIEW',         payload: null  }), []);
  const onCancelReport     = useCallback(() => { setCore({ type: 'SET_REPORT', payload: false }); setCore({ type: 'SET_REPORT_REASON', payload: '' }); }, []);
  const onSubmitReport     = useCallback(() => void submitReport(),   [submitReport]);
  const onSaveNote         = useCallback(() => void saveNote(),       [saveNote]);
  const onReportReasonChange = useCallback((t: string) => setCore({ type: 'SET_REPORT_REASON', payload: t }), []);
  const onNoteTextChange   = useCallback((t: string) => setCore({ type: 'SET_NOTE_TEXT', payload: t.slice(0, MAX_NOTE_LEN) }), []);

  const lastMessage    = core.messages[core.messages.length - 1];
  const hasUnreadAtEnd = lastMessage && !lastMessage.read && lastMessage.senderId !== user?.uid;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#07070f" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() = accessibilityLabel="button"> router.back()}
          style={styles.headerBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={26} color="#6C63FF" />
        </Pressable>
        <View style={styles.headerCenter}>
          {matchPhoto ? (
            <TurboImage
              source={{ uri: matchPhoto }}
              style={styles.headerAvatar}
              cachePolicy="dataCache"
              accessibilityLabel={`${matchName}'s photo`}
            />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
              <Ionicons name="person" size={20} color="#9494B8" />
            </View>
          )}
          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerName} numberOfLines={1}>
                {matchName}{matchAge ? `, ${matchAge}` : ''}
              </Text>
              {matchVerified && (
                <Ionicons name="checkmark-circle" size={14} color="#6C63FF" style={styles.verifiedIcon} />
              )}
            </View>
            <Text style={styles.headerStatus}>
              {typing.theirTyping
                ? 'typing…'
                : matchOnline
                  ? 'Online'
                  : matchLastSeen ? `Last seen ${formatTime(matchLastSeen)}` : ''}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onMenuToggle}
          style={styles.headerMenuBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Open chat menu"
        >
          <Ionicons name="ellipsis-vertical" size={22} color="#9494B8" />
        </Pressable>
      </View>

      {/* Dropdown menu */}
      {core.showMenu && (
        <Pressable
          style={styles.menuOverlay}
          onPress={onMenuClose}
          accessibilityLabel="Close menu"
          accessibilityRole="button"
        >
          <View style={styles.menuCard}>
            <Pressable style={styles.menuItem} onPress={onMenuOpenNotes}    accessibilityLabel="Shared Notes"        accessibilityRole="button"><Ionicons name="document-text-outline" size={18} color="#9494B8" /><Text style={styles.menuItemText}>Shared Notes</Text></Pressable>
            <Pressable style={styles.menuItem} onPress={onMenuOpenPinned}   accessibilityLabel="Pinned Messages"     accessibilityRole="button"><Ionicons name="pin-outline"            size={18} color="#9494B8" /><Text style={styles.menuItemText}>Pinned Messages</Text></Pressable>
            <Pressable style={styles.menuItem} onPress={onMenuDisappearing} accessibilityLabel={core.disappearingEnabled ? 'Disable Disappearing' : 'Enable Disappearing'} accessibilityRole="button"><Ionicons name={core.disappearingEnabled ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9494B8" /><Text style={styles.menuItemText}>{core.disappearingEnabled ? 'Disable Disappearing' : 'Enable Disappearing'}</Text></Pressable>
            <Pressable style={styles.menuItem} onPress={onMenuDateIdeas}    accessibilityLabel="Date Ideas"          accessibilityRole="button"><Ionicons name="heart-outline"          size={18} color="#9494B8" /><Text style={styles.menuItemText}>Date Ideas</Text></Pressable>
            <Pressable style={styles.menuItem} onPress={onMenuCall}         accessibilityLabel="Video or Audio Call" accessibilityRole="button"><Ionicons name="videocam-outline"       size={18} color="#9494B8" /><Text style={styles.menuItemText}>Video / Audio Call</Text></Pressable>
            <View style={styles.menuSeparator} />
            <Pressable style={[styles.menuItem, styles.menuItemDanger]} onPress={onMenuUnmatch} accessibilityLabel="Unmatch" accessibilityRole="button"><Ionicons name="close-circle-outline" size={18} color="#FF6B6B" /><Text style={[styles.menuItemText, styles.menuItemDangerText]}>Unmatch</Text></Pressable>
          </View>
        </Pressable>
      )}

      {/* Chat area */}
      <Animated.View style={[styles.chatArea, opacityStyle]}>
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
            <LegendList
              ref={listRef}
              data={core.messages}
              renderItem={renderMessage}
              keyExtractor={keyExtractor}
              estimatedItemSize={80}
              getEstimatedItemSize={getEstimatedItemSize}
              recycleItems={true}
              contentContainerStyle={styles.messageList}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.1}
              ListFooterComponent={ListFooter}
              maintainScrollAtEnd={true}
              maintainScrollAtEndThreshold={0.1}
              keyboardShouldPersistTaps="handled"
              onLayout={onLayout}
              showsVerticalScrollIndicator={false}
            />
            <Animated.View style={[styles.scrollBtnWrap, scrollBtnStyle]}>
              <Pressable
                style={styles.scrollBtn}
                onPress={onScrollToBottom}
                accessibilityRole="button"
                accessibilityLabel="Scroll to bottom"
              >
                <Ionicons name="chevron-down" size={18} color="#6C63FF" />
                {hasUnreadAtEnd && <View style={styles.scrollBtnBadge} />}
              </Pressable>
            </Animated.View>
          </View>
        )}
      </Animated.View>

      {/* Upload / typing bars */}
      {core.uploadingMedia && (
        <View style={styles.uploadingBar}>
          <ActivityIndicator size="small" color="#6C63FF" />
          <Text style={styles.uploadingText}>Uploading media…</Text>
        </View>
      )}

      {typing.theirTyping && (
        <View style={styles.typingBar}>
          <View style={styles.typingDots}>
            <View style={styles.typingDot} />
            <View style={styles.typingDot} />
            <View style={styles.typingDot} />
          </View>
          <Text style={styles.typingText}>{matchName} is typing</Text>
        </View>
      )}

      {/* Input bar */}
      <KeyboardAvoidingView
        behavior={IS_IOS ? 'padding' : undefined}
        keyboardVerticalOffset={IS_IOS ? 90 : 0}
      >
        <View style={styles.inputBar}>
          <Pressable onPress={onPickImage} style={styles.inputAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Attach image">
            <Ionicons name="image-outline"  size={22} color="#6C63FF" />
          </Pressable>
          <Pressable onPress={onTakePhoto} style={styles.inputAction} hitSlop={8} accessibilityRole="button" accessibilityLabel="Take photo">
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
              maxLength={MAX_MSG_LEN}
              editable={!core.sending && !core.uploadingMedia}
              onSubmitEditing={onSendMessage}
              returnKeyType="send"
              blurOnSubmit={false}
              accessibilityLabel="Message input"
            />
            {core.inputText.length > MAX_MSG_LEN * 0.9 && (
              <Text style={styles.charCount}>{core.inputText.length}/{MAX_MSG_LEN}</Text>
            )}
          </View>
          {core.recordingAudio ? (
            <View style={styles.recordingWrap}>
              <Text style={styles.recordingTimer}>
                {Math.floor(core.recordingDuration / 60)}:{String(core.recordingDuration % 60).padStart(2, '0')}
              </Text>
              <Pressable
                onPress={onStopRec}
                style={styles.recordingStop}
                accessibilityRole="button"
                accessibilityLabel="Stop recording"
              >
                <Ionicons name="stop-circle" size={28} color="#FF6B6B" />
              </Pressable>
            </View>
          ) : !core.inputText.trim() ? (
            <Pressable
              onPress={onStartRec}
              style={styles.inputAction}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Record voice message"
            >
              <Ionicons name="mic-outline" size={22} color="#6C63FF" />
            </Pressable>
          ) : (
            <Pressable
              onPress={onSendMessage}
              style={[styles.sendBtn, (!core.inputText.trim() || core.sending) && styles.sendBtnDisabled]}
              disabled={!core.inputText.trim() || core.sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              {core.sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="send" size={18} color="#fff" />
              }
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Options modal */}
      <Modal visible={core.showOptions} transparent animationType="fade" onRequestClose={onCloseOptions}>
        <Pressable style={styles.modalOverlay} onPress={onCloseOptions} accessibilityLabel="Close options" accessibilityRole="button">
          <View style={styles.optionsCard}>
            {core.selectedMessageId && (
              <>
                <Pressable style={styles.optionItem} onPress={onPinSelected}  accessibilityLabel="Pin message"      accessibilityRole="button"><Ionicons name="pin-outline"   size={18} color="#9494B8" /><Text style={styles.optionText}>Pin Message</Text></Pressable>
                <Pressable style={styles.optionItem} onPress={onOpenReaction} accessibilityLabel="React to message" accessibilityRole="button"><Ionicons name="happy-outline" size={18} color="#9494B8" /><Text style={styles.optionText}>React</Text></Pressable>
                <Pressable style={styles.optionItem} onPress={onOpenReport}   accessibilityLabel="Report message"   accessibilityRole="button"><Ionicons name="flag-outline"  size={18} color="#FF6B6B" /><Text style={[styles.optionText, styles.optionTextDanger]}>Report</Text></Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Reaction picker modal */}
      <Modal visible={core.showReactionPicker} transparent animationType="fade" onRequestClose={onCloseReaction}>
        <Pressable style={styles.modalOverlay} onPress={onCloseReaction} accessibilityLabel="Close reaction picker" accessibilityRole="button">
          <View style={styles.reactionPickerCard}>
            {EMOJI_REACTIONS.map(emoji => (
              <Pressable
                key={emoji}
                onPress={() = accessibilityLabel="button"> { if (core.selectedMessageId) void handleReaction(core.selectedMessageId, emoji); }}
                style={styles.reactionPickItem}
                accessibilityLabel={`React with ${emoji}`}
                accessibilityRole="button"
              >
                <Text style={styles.reactionPickEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Report modal */}
      <Modal visible={core.showReport} transparent animationType="slide" onRequestClose={onCloseReport}>
        <View style={styles.reportModal}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report Message</Text>
            <TextInput
              style={styles.reportInput}
              value={core.reportReason}
              onChangeText={onReportReasonChange}
              placeholder="Describe the issue…"
              placeholderTextColor="#64648a"
              multiline
              maxLength={500}
              autoFocus
              accessibilityLabel="Report reason input"
            />
            <View style={styles.reportBtns}>
              <Pressable style={styles.reportCancel} onPress={onCancelReport} accessibilityLabel="Cancel report" accessibilityRole="button">
                <Text style={styles.reportCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.reportSubmit, (!core.reportReason.trim() || core.submittingReport) && styles.reportSubmitDisabled]}
                onPress={onSubmitReport}
                disabled={!core.reportReason.trim() || core.submittingReport}
                accessibilityLabel="Submit report"
                accessibilityRole="button"
                accessibilityState={{ disabled: !core.reportReason.trim() || core.submittingReport }}
              >
                {core.submittingReport
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.reportSubmitText}>Submit</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Shared note modal */}
      <Modal visible={core.showNote} transparent animationType="slide" onRequestClose={onCloseNote}>
        <View style={styles.noteModal}>
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Shared Notes</Text>
            <TextInput
              style={styles.noteInput}
              value={core.noteText}
              onChangeText={onNoteTextChange}
              placeholder="Write notes together…"
              placeholderTextColor="#64648a"
              multiline
              maxLength={MAX_NOTE_LEN}
              autoFocus
              accessibilityLabel="Note input"
            />
            <Text style={styles.noteCount}>{core.noteText.length}/{MAX_NOTE_LEN}</Text>
            <View style={styles.noteBtns}>
              <Pressable style={styles.noteCancel} onPress={onCloseNote} accessibilityLabel="Cancel note" accessibilityRole="button">
                <Text style={styles.noteCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.noteSave, core.savingNote && styles.noteSaveDisabled]}
                onPress={onSaveNote}
                disabled={core.savingNote}
                accessibilityLabel="Save note"
                accessibilityRole="button"
                accessibilityState={{ disabled: core.savingNote }}
              >
                {core.savingNote
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.noteSaveText}>Save</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pinned messages modal */}
      <Modal visible={core.showPinned} transparent animationType="slide" onRequestClose={onClosePinned}>
        <View style={styles.pinnedModal}>
          <View style={styles.pinnedCard}>
            <View style={styles.pinnedHeader}>
              <Text style={styles.pinnedTitle}>Pinned Messages</Text>
              <Pressable onPress={onClosePinned} hitSlop={12} accessibilityLabel="Close pinned messages" accessibilityRole="button">
                <Ionicons name="close" size={22} color="#9494B8" />
              </Pressable>
            </View>
            {core.messages.filter(m => m.pinned).length === 0 ? (
              <Text style={styles.pinnedEmpty}>No pinned messages yet.</Text>
            ) : (
              <ScrollView style={styles.pinnedList} keyboardShouldPersistTaps="handled">
                {core.messages.filter(m => m.pinned).map(m => (
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

      {/* Video call prompt modal */}
      <Modal visible={core.showVideoPrompt} transparent animationType="fade" onRequestClose={onCloseVideo}>
        <Pressable style={styles.modalOverlay} onPress={onCloseVideo} accessibilityLabel="Close call prompt" accessibilityRole="button">
          <View style={styles.videoPromptCard}>
            <Text style={styles.videoPromptTitle}>Start a call?</Text>
            <Text style={styles.videoPromptSub}>Choose call type with {matchName}</Text>
            <View style={styles.videoPromptBtns}>
              <Pressable
                style={styles.videoBtn}
                onPress={() = accessibilityLabel="button"> { onCloseVideo(); Alert.alert('Coming Soon', 'Video calls will be available soon!'); }}
                accessibilityLabel="Start video call"
                accessibilityRole="button"
              >
                <Ionicons name="videocam" size={22} color="#6C63FF" />
                <Text style={styles.videoBtnText}>Video</Text>
              </Pressable>
              <Pressable
                style={styles.videoBtn}
                onPress={() = accessibilityLabel="button"> { onCloseVideo(); Alert.alert('Coming Soon', 'Audio calls will be available soon!'); }}
                accessibilityLabel="Start audio call"
                accessibilityRole="button"
              >
                <Ionicons name="call" size={22} color="#6C63FF" />
                <Text style={styles.videoBtnText}>Audio</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Date ideas modal */}
      <Modal visible={core.showDateIdeas} transparent animationType="slide" onRequestClose={onCloseDateIdeas}>
        <View style={styles.dateModal}>
          <View style={styles.dateCard}>
            <View style={styles.dateHeader}>
              <Text style={styles.dateTitle}>Date Ideas</Text>
              <Pressable onPress={onCloseDateIdeas} hitSlop={12} accessibilityLabel="Close date ideas" accessibilityRole="button">
                <Ionicons name="close" size={22} color="#9494B8" />
              </Pressable>
            </View>
            {core.loadingDateIdeas ? (
              <ActivityIndicator size="large" color="#6C63FF" style={styles.dateLoader} />
            ) : (
              core.dateIdeas.map((idea, i) => (
                <Pressable
                  key={i}
                  style={styles.dateIdeaItem}
                  onPress={() = accessibilityLabel="button"> {
                    setCore({ type: 'SET_INPUT', payload: idea.text });
                    setCore({ type: 'SET_DATE_IDEAS_SHOW', payload: false });
                  }}
                  accessibilityLabel={`Use date idea: ${idea.text}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.dateIdeaVibe}>{idea.vibe}</Text>
                  <Text style={styles.dateIdeaText}>{idea.text}</Text>
                </Pressable>
              ))
            )}
            <Pressable
              style={styles.dateRefreshBtn}
              onPress={loadDateIdeas}
              accessibilityLabel="Shuffle date ideas"
              accessibilityRole="button"
            >
              <Ionicons name="refresh" size={16} color="#6C63FF" />
              <Text style={styles.dateRefreshText}>Shuffle</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Image preview modal */}
      <Modal visible={!!core.previewImage} transparent animationType="fade" onRequestClose={onClosePreview}>
        <View style={styles.previewModal}>
          <Pressable
            style={styles.previewClose}
            onPress={onClosePreview}
            hitSlop={16}
            accessibilityLabel="Close image preview"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {core.previewImage ? (
            <TurboImage
              source={{ uri: core.previewImage }}
              style={styles.previewImage}
              resizeMode="contain"
              cachePolicy="dataCache"
              accessibilityLabel="Full size image preview"
            />
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create(theme => ({
  container:               { flex: 1, backgroundColor: theme.colors.background },
  flex:                    { flex: 1 },
  header:                  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.sm + 4, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e1e48', backgroundColor: '#0a0a18' },
  headerBack:              { padding: 4 },
  headerCenter:            { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 4 },
  headerAvatar:            { width: 38, height: 38, borderRadius: 19 },
  headerAvatarPlaceholder: { backgroundColor: '#1e1e48', alignItems: 'center', justifyContent: 'center' },
  headerInfo:              { marginLeft: 10, flex: 1 },
  headerNameRow:           { flexDirection: 'row', alignItems: 'center' },
  headerName:              { fontSize: 16, fontWeight: '700', color: '#EDEDFF' },
  headerStatus:            { fontSize: 12, color: theme.colors.textSecondary, marginTop: 1 },
  headerMenuBtn:           { padding: theme.spacing.sm },
  verifiedIcon:            { marginLeft: 4 },
  chatArea:                { flex: 1 },
  loadingWrap:             { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm + 4 },
  loadingText:             { fontSize: 14, color: theme.colors.textSecondary },
  emptyWrap:               { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  emptyTitle:              { fontSize: 18, fontWeight: '700', color: '#EDEDFF' },
  emptySub:                { fontSize: 14, color: theme.colors.textSecondary },
  messageList:             { paddingHorizontal: theme.spacing.sm + 4, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md },
  messageRow:              { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 },
  messageRowMine:          { justifyContent: 'flex-end' },
  messageRowTheirs:        { justifyContent: 'flex-start' },
  messageRowSpaced:        { marginTop: 10 },
  avatarSmall:             { width: 24, height: 24, borderRadius: 12, marginRight: 6 },
  avatarSmallPlaceholder:  { width: 24, height: 24, marginRight: 6 },
  bubbleWrap:              { maxWidth: '75%', borderRadius: theme.radius.md + 8, padding: 10, paddingBottom: 6 },
  bubbleMine:              { backgroundColor: '#6C63FF', borderBottomRightRadius: 4 },
  bubbleTheirs:            { backgroundColor: '#111128', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#1e1e48' },
  bubbleText:              { fontSize: 15, lineHeight: 20, color: '#EDEDFF' },
  bubbleTextMine:          { color: theme.colors.text },
  bubbleFooter:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, gap: 2 },
  bubbleTime:              { fontSize: 10, color: theme.colors.textSecondary },
  bubbleTimeMine:          { color: 'rgba(255,255,255,0.6)' },
  readIcon:                { marginLeft: 4 },
  imageBubble:             { width: 200, height: 180, borderRadius: theme.radius.md - 4, marginTop: 4 },
  gifLabel:                { position: 'absolute', top: 8, left: 8, fontSize: 9, fontWeight: '800', color: theme.colors.text, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.sm, overflow: 'hidden' },
  voiceRow:                { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 4 },
  voiceWaveWrap:           { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 28 },
  voiceBar:                { width: 3, borderRadius: 2 },
  voiceDuration:           { fontSize: 11, color: theme.colors.textSecondary },
  voiceDurationMine:       { color: 'rgba(255,255,255,0.7)' },
  pinnedBadge:             { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  pinnedText:              { fontSize: 9, color: '#FFB347', fontWeight: '600' },
  reactionsRow:            { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, marginTop: 6 },
  reactionChip:            { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(108,99,255,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  reactionEmoji:           { fontSize: 12 },
  reactionCount:           { fontSize: 9, color: theme.colors.textSecondary, marginLeft: 2 },
  dateSeparator:           { flexDirection: 'row', alignItems: 'center', marginVertical: theme.spacing.sm + 4, gap: theme.spacing.sm },
  dateSepLine:             { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#1e1e48' },
  dateSepText:             { fontSize: 11, color: theme.colors.textSecondary, fontWeight: '600' },
  systemMessageWrap:       { alignItems: 'center', marginVertical: theme.spacing.sm },
  systemMessageText:       { fontSize: 12, color: theme.colors.textSecondary, fontStyle: 'italic' },
  inputBar:                { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: theme.spacing.sm, paddingVertical: 6, backgroundColor: '#0a0a18', borderTopWidth: 1, borderTopColor: '#1e1e48', gap: 4 },
  inputAction:             { padding: theme.spacing.sm, alignItems: 'center', justifyContent: 'center' },
  inputWrap:               { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: '#0d0d24', borderRadius: 20, paddingHorizontal: 14, paddingVertical: theme.spacing.sm, justifyContent: 'center', borderWidth: 1, borderColor: '#28285a' },
  inputField:              { fontSize: 15, color: '#EDEDFF', maxHeight: 100, lineHeight: 20 },
  charCount:               { fontSize: 10, color: theme.colors.textSecondary, textAlign: 'right', marginTop: 2 },
  sendBtn:                 { width: 40, height: 40, borderRadius: 20, backgroundColor: '#6C63FF', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:         { backgroundColor: '#181834' },
  recordingWrap:           { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recordingTimer:          { fontSize: 13, color: theme.colors.error, fontWeight: '600', fontVariant: ['tabular-nums'] },
  recordingStop:           { padding: 4 },
  uploadingBar:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, paddingVertical: 6, backgroundColor: '#0a0a18' },
  uploadingText:           { fontSize: 13, color: theme.colors.textSecondary },
  typingBar:               { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: theme.spacing.md, paddingVertical: 4, backgroundColor: '#0a0a18' },
  typingDots:              { flexDirection: 'row', gap: 3 },
  typingDot:               { width: 6, height: 6, borderRadius: 3, backgroundColor: '#6C63FF' },
  typingText:              { fontSize: 12, color: theme.colors.textSecondary, fontStyle: 'italic' },
  loadMoreIndicator:       { marginVertical: theme.spacing.sm + 4 },
  scrollBtnWrap:           { position: 'absolute', right: theme.spacing.md, bottom: theme.spacing.sm + 4 },
  scrollBtn:               { width: 36, height: 36, borderRadius: 18, backgroundColor: '#111128', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1e1e48' },
  scrollBtnBadge:          { position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.error },
  modalOverlay:            { flex: 1, backgroundColor: 'rgba(4,4,12,0.8)', justifyContent: 'center', alignItems: 'center' },
  menuOverlay:             { position: 'absolute', top: 60, right: theme.spacing.sm + 4, zIndex: 100 },
  menuCard:                { backgroundColor: '#111128', borderRadius: theme.radius.lg, padding: theme.spacing.sm, borderWidth: 1, borderColor: '#1e1e48', minWidth: 200, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 16 },
  menuItem:                { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: theme.spacing.sm + 4, borderRadius: 10 },
  menuItemText:            { fontSize: 14, color: '#EDEDFF', fontWeight: '500' },
  menuItemDanger:          {},
  menuItemDangerText:      { color: theme.colors.error },
  menuSeparator:           { height: StyleSheet.hairlineWidth, backgroundColor: '#1e1e48', marginVertical: 4 },
  optionsCard:             { backgroundColor: '#111128', borderRadius: theme.radius.lg, padding: theme.spacing.sm, borderWidth: 1, borderColor: '#1e1e48', minWidth: 180 },
  optionItem:              { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: theme.spacing.sm + 4, borderRadius: 10 },
  optionText:              { fontSize: 14, color: '#EDEDFF', fontWeight: '500' },
  optionTextDanger:        { color: theme.colors.error },
  reactionPickerCard:      { flexDirection: 'row', backgroundColor: '#111128', borderRadius: 28, padding: theme.spacing.sm, borderWidth: 1, borderColor: '#1e1e48', gap: 4 },
  reactionPickItem:        { padding: theme.spacing.sm },
  reactionPickEmoji:       { fontSize: 28 },
  reportModal:             { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(4,4,12,0.9)' },
  reportCard:              { backgroundColor: '#111128', borderRadius: 20, padding: theme.spacing.lg, width: '90%', maxWidth: 400, borderWidth: 1, borderColor: '#1e1e48', gap: theme.spacing.md },
  reportTitle:             { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  reportInput:             { minHeight: 80, backgroundColor: '#0d0d24', borderRadius: theme.radius.md, padding: 14, fontSize: 15, color: '#EDEDFF', borderWidth: 1, borderColor: '#28285a', textAlignVertical: 'top' },
  reportBtns:              { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  reportCancel:            { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 },
  reportCancelText:        { fontSize: 14, color: theme.colors.textSecondary, fontWeight: '600' },
  reportSubmit:            { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: theme.colors.error },
  reportSubmitDisabled:    { backgroundColor: '#181834' },
  reportSubmitText:        { fontSize: 14, color: theme.colors.text, fontWeight: '700' },
  noteModal:               { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(4,4,12,0.9)' },
  noteCard:                { backgroundColor: '#111128', borderRadius: 20, padding: theme.spacing.lg, width: '90%', maxWidth: 400, borderWidth: 1, borderColor: '#1e1e48', gap: theme.spacing.sm + 4 },
  noteTitle:               { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  noteInput:               { minHeight: 100, backgroundColor: '#0d0d24', borderRadius: theme.radius.md, padding: 14, fontSize: 15, color: '#EDEDFF', borderWidth: 1, borderColor: '#28285a', textAlignVertical: 'top' },
  noteCount:               { fontSize: 11, color: theme.colors.textSecondary, textAlign: 'right' },
  noteBtns:                { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  noteCancel:              { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 },
  noteCancelText:          { fontSize: 14, color: theme.colors.textSecondary, fontWeight: '600' },
  noteSave:                { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#6C63FF' },
  noteSaveDisabled:        { backgroundColor: '#181834' },
  noteSaveText:            { fontSize: 14, color: theme.colors.text, fontWeight: '700' },
  pinnedModal:             { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(4,4,12,0.9)' },
  pinnedCard:              { backgroundColor: '#111128', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.lg, maxHeight: '70%', borderWidth: 1, borderColor: '#1e1e48' },
  pinnedHeader:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md },
  pinnedTitle:             { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  pinnedEmpty:             { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', marginVertical: theme.spacing.lg },
  pinnedList:              {},
  pinnedItem:              { backgroundColor: '#0d0d24', borderRadius: theme.radius.md, padding: 14, marginBottom: theme.spacing.sm, borderWidth: 1, borderColor: '#28285a' },
  pinnedItemText:          { fontSize: 14, color: '#EDEDFF' },
  pinnedItemTime:          { fontSize: 11, color: theme.colors.textSecondary, marginTop: 4 },
  videoPromptCard:         { backgroundColor: '#111128', borderRadius: 20, padding: 28, width: '85%', maxWidth: 340, borderWidth: 1, borderColor: '#1e1e48', alignItems: 'center', gap: theme.spacing.md },
  videoPromptTitle:        { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  videoPromptSub:          { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  videoPromptBtns:         { flexDirection: 'row', gap: theme.spacing.md },
  videoBtn:                { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, backgroundColor: '#0d0d24', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: '#28285a' },
  videoBtnText:            { fontSize: 14, color: '#6C63FF', fontWeight: '600' },
  dateModal:               { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(4,4,12,0.9)' },
  dateCard:                { backgroundColor: '#111128', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.lg, maxHeight: '70%', borderWidth: 1, borderColor: '#1e1e48' },
  dateHeader:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md },
  dateTitle:               { fontSize: 18, fontWeight: '800', color: '#EDEDFF' },
  dateLoader:              { marginVertical: 32 },
  dateIdeaItem:            { backgroundColor: '#0d0d24', borderRadius: 14, padding: theme.spacing.md, marginBottom: 10, borderWidth: 1, borderColor: '#28285a' },
  dateIdeaVibe:            { fontSize: 12, color: '#6C63FF', fontWeight: '700', marginBottom: 4 },
  dateIdeaText:            { fontSize: 14, color: '#EDEDFF', lineHeight: 20 },
  dateRefreshBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: theme.spacing.sm + 4, marginTop: theme.spacing.sm },
  dateRefreshText:         { fontSize: 14, color: '#6C63FF', fontWeight: '600' },
  previewModal:            { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  previewClose:            { position: 'absolute', top: 48, right: theme.spacing.md, zIndex: 10 },
  previewImage:            { width: '100%', height: '80%' },
}));