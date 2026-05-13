import type { LegendListRef, LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useMutation } from '@tanstack/react-query';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, startAfter, updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, StatusBar, Text, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db, storage } from '../firebaseConfig';
import {
  encryptTextForRecipient, ensureLocalE2EEKeypair, getRemoteE2EEPublicKey, syncMyE2EEPublicKeyToFirestore,
} from '../utils/e2ee';
import { logger, writeAuditLog } from '../utils/logger';
import { checkMessageSend, checkPhotoUpload } from '../utils/safetyMiddleware';
import { ChatHeader } from '@/src/components/chat/ChatHeader';
import { ChatModals } from '@/src/components/chat/ChatModals';
import { PAGE_SIZE } from '@/src/components/chat/constants';
import { InputBar } from '@/src/components/chat/InputBar';
import { MessageItem } from '@/src/components/chat/MessageItem';
import { coreReducer, initialCore } from '@/src/components/chat/reducer';
import { styles } from '@/src/components/chat/styles';
import type { ChatCoreState, Message, TypingState } from '@/src/components/chat/types';
import {
  buildHeightCache, getErrMsg, parseMessage,
} from '@/src/components/chat/utils';

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ matchId?: string; matchName?: string }>();
  const user = auth.currentUser;

  const matchId = params.matchId ?? '';
  const chatId = useMemo(() => (!matchId || !user?.uid ? '' : [user.uid, matchId].sort().join('_')), [matchId, user?.uid]);

  const [core, dispatchCore] = useReducer(coreReducer, initialCore);
  const [typing, dispatchTyping] = useReducer((s: TypingState, a: Partial<TypingState>) => ({ ...s, ...a }), { isTyping: false, theirTyping: false });

  const heightCache = useMemo(() => (user?.uid ? buildHeightCache(core.messages, user.uid) : new Map<string, number>()), [core.messages, user?.uid]);

  const listRef = useRef<LegendListRef>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldAutoScroll = useRef(true);
  const isMountedRef = useRef(true);
  const recordingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatCreatedRef = useRef(false);

  const opacityVal = useSharedValue(0);
  const scrollBtnVal = useSharedValue(0);
  const opacityStyle = useAnimatedStyle(() => ({ opacity: opacityVal.value }));
  const scrollBtnStyle = useAnimatedStyle(() => ({ opacity: scrollBtnVal.value }));

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const matchName = core.matchData?.name ?? params.matchName ?? 'Match';
  const matchPhoto = core.matchData?.photo;
  const matchAge = core.matchData?.age;
  const matchVerified = core.matchData?.verified ?? false;
  const matchOnline = core.matchData?.isOnline ?? false;
  const matchLastSeen = core.matchData?.lastSeen ?? null;

  const pushMutation = useMutation({
    mutationFn: async ({ token, title, body, chatId: cid }: { token: string; title: string; body: string; chatId: string }) => {
      await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `key=${''}` },
        body: JSON.stringify({ to: token, notification: { title, body: body.slice(0, 100), sound: 'default' }, data: { chatId: cid, type: 'chat' } }),
      });
    },
    onError: () => {},
  });

  const sendPushNotification = useCallback(async (body: string) => {
    if (!matchId || !user?.uid) return;
    try {
      const snap = await getDoc(doc(db, 'users', matchId));
      if (!snap.exists()) return;
      const token = snap.data()?.['fcmToken'];
      if (typeof token !== 'string') return;
      pushMutation.mutate({ token, title: matchName, body, chatId });
    } catch {}
  }, [matchId, user?.uid, matchName, chatId, pushMutation]);

  const ensureChatExists = useCallback(async () => {
    if (!chatId || !user?.uid || chatCreatedRef.current) return;
    try {
      const snap = await getDoc(doc(db, 'chats', chatId));
      if (!snap.exists()) {
        const participants = chatId.split('_');
        await setDoc(doc(db, 'chats', chatId), {
          participants, createdAt: serverTimestamp(), lastMessage: '', lastMessageAt: serverTimestamp(),
          lastMessageBy: user.uid, typing: {}, pinnedMessages: [], note: '', disappearing: false, wallpaper: null,
        });
      }
      chatCreatedRef.current = true;
    } catch (e: unknown) { logger.error('Error ensuring chat exists:', e); }
  }, [chatId, user?.uid]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    opacityVal.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
  }, [opacityVal]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { router.back(); return true; });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (!chatId || !user?.uid) return;
    dispatchCore({ type: 'SET_LOADING', payload: true });
    void ensureChatExists();
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
    const unsub = onSnapshot(q, (snap) => {
      if (!isMountedRef.current) return;
      const msgs: Message[] = [];
      snap.forEach((d) => msgs.push(parseMessage(d)));
      msgs.reverse();
      dispatchCore({ type: 'SET_MESSAGES', payload: msgs });
      dispatchCore({ type: 'SET_LOADING', payload: false });
      dispatchCore({ type: 'SET_HAS_MORE', payload: snap.size >= PAGE_SIZE });
      const lastSnap = snap.docs[snap.docs.length - 1];
      if (snap.size > 0 && lastSnap) dispatchCore({ type: 'SET_LAST_DOC', payload: lastSnap });
      if (shouldAutoScroll.current) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }, (err) => { logger.error('Messages snapshot error:', err); dispatchCore({ type: 'SET_LOADING', payload: false }); });
    return unsub;
  }, [chatId, user?.uid, ensureChatExists]);

  useEffect(() => {
    if (!chatId || !matchId) return;
    const unsub = onSnapshot(doc(db, 'chats', chatId), (snap) => {
      if (!isMountedRef.current || !snap.exists()) return;
      const d = snap.data();
      if (d['typing']?.[matchId] !== typing.theirTyping) dispatchTyping({ theirTyping: d['typing']?.[matchId] === true });
      if (typeof d['note'] === 'string') dispatchCore({ type: 'SET_NOTE_TEXT', payload: d['note'] });
      if (typeof d['disappearing'] === 'boolean') dispatchCore({ type: 'SET_DISAPPEARING', payload: d['disappearing'] });
      if (typeof d['wallpaper'] === 'string') dispatchCore({ type: 'SET_WALLPAPER', payload: d['wallpaper'] });
    });
    return unsub;
  }, [chatId, matchId, typing.theirTyping]);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    getDoc(doc(db, 'users', matchId)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const d = snap.data();
      const photos = d['photos'];
      const photo = Array.isArray(photos) && typeof photos[0] === 'string' ? photos[0] : typeof d['photoURL'] === 'string' ? d['photoURL'] : '';
      dispatchCore({ type: 'SET_MATCH', payload: { id: matchId, name: typeof d['displayName'] === 'string' ? d['displayName'] : typeof d['name'] === 'string' ? d['name'] : 'User', age: typeof d['age'] === 'number' ? d['age'] : 0, photo, isOnline: typeof d['isOnline'] === 'boolean' ? d['isOnline'] : false, lastSeen: d['lastSeen'] != null && typeof (d['lastSeen'] as { toDate?: unknown }).toDate === 'function' ? (d['lastSeen'] as { toDate: () => Date }).toDate() : null, verified: typeof d['verified'] === 'boolean' ? d['verified'] : false, premium: typeof d['premium'] === 'boolean' ? d['premium'] : false } });
    }).catch((e: unknown) => logger.error('Error loading match:', e));
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => {
    if (!chatId || !user?.uid) return;
    const handle = requestIdleCallback(() => {
      if (!isMountedRef.current) return;
      core.messages.filter((m) => m.senderId !== user.uid && !m.read).forEach((m) => {
        updateDoc(doc(db, 'chats', chatId, 'messages', m.id), { read: true }).catch(() => {});
      });
    });
    return () => cancelIdleCallback(handle);
  }, [core.messages, chatId, user?.uid]);

  const updateTypingStatus = useCallback(async (isTyping: boolean) => {
    if (!chatId || !user?.uid) return;
    try { await updateDoc(doc(db, 'chats', chatId), { [`typing.${user.uid}`]: isTyping }); } catch {}
  }, [chatId, user?.uid]);

  useEffect(() => {
    if (typing.isTyping) {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => { dispatchTyping({ isTyping: false }); void updateTypingStatus(false); }, 5000);
    }
    return () => { if (typingTimeout.current) { clearTimeout(typingTimeout.current); typingTimeout.current = null; } };
  }, [typing.isTyping, updateTypingStatus]);

  useEffect(() => {
    return () => { if (recordingInterval.current) { clearInterval(recordingInterval.current); recordingInterval.current = null; } };
  }, []);

  const scheduleScrollToBottom = useCallback((animated = true) => { requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated })); }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    shouldAutoScroll.current = distFromBottom < 200;
    scrollBtnVal.value = withTiming(shouldAutoScroll.current ? 0 : 1, { duration: 200 });
  }, [scrollBtnVal]);

  const ensureSignalIdentityWrapper = useCallback(async () => { try { await syncMyE2EEPublicKeyToFirestore(); } catch (e: unknown) { logger.warn('Signal identity init warning:', e); } }, []);

  const doSendText = useCallback(async (text: string) => {
    if (!user?.uid || !chatId || !matchId) return;
    dispatchCore({ type: 'SET_INPUT', payload: '' });
    dispatchCore({ type: 'SET_SENDING', payload: true });
    dispatchTyping({ isTyping: false });
    void updateTypingStatus(false);
    try {
      await ensureSignalIdentityWrapper();
      await ensureChatExists();
      const remoteKey = await getRemoteE2EEPublicKey(matchId);
      if (!remoteKey?.encryptionPublicKey) {
        await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, messageType: 'text', text, version: 0 });
      } else {
        const enc = await encryptTextForRecipient(text, matchId);
        await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, version: enc.version, messageType: 'text', ciphertext: enc.ciphertext, nonce: enc.nonce, senderPublicKey: enc.senderPublicKey, senderKeyVersion: enc.senderKeyVersion });
      }
      await sendPushNotification(text);
      shouldAutoScroll.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) {
      logger.error('Error sending message:', e);
      Alert.alert('Error', getErrMsg(e));
      dispatchCore({ type: 'SET_INPUT', payload: text });
    } finally {
      dispatchCore({ type: 'SET_SENDING', payload: false });
    }
  }, [user?.uid, chatId, matchId, updateTypingStatus, sendPushNotification, scheduleScrollToBottom, ensureChatExists, ensureSignalIdentityWrapper]);

  const sendMessage = useCallback(async () => {
    const text = core.inputText.trim();
    if (!text || !user?.uid || core.sending || !chatId || !matchId) return;
    try {
      const safetyResult = await checkMessageSend(text, user.uid, matchId, false, 0, { serverUrl: '', enableMessageCheck: true, enablePhotoCheck: false, enableLoginCheck: false, enableRegistrationCheck: false, enableProfileCheck: false, autoBlockCritical: true, logAllChecks: false });
      if (!safetyResult.allowed) { Alert.alert('Message Not Allowed', safetyResult.reasons.join('\n') || 'Flagged by safety system.'); return; }
      if (safetyResult.shouldWarn && safetyResult.warningMessage) { Alert.alert('Are you sure?', safetyResult.warningMessage, [{ text: 'Edit', style: 'cancel' }, { text: 'Send Anyway', style: 'destructive', onPress: () => void doSendText(text) }]); return; }
    } catch (e: unknown) {
      logger.warn('Safety middleware failed, falling back:', e);
    }
    await doSendText(text);
  }, [core.inputText, core.sending, user?.uid, chatId, matchId, doSendText]);

  const uploadAndSendImage = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user?.uid || !chatId || !matchId || !asset.uri) { Alert.alert('Error', 'Image data unavailable'); return; }
    dispatchCore({ type: 'SET_UPLOADING', payload: true });
    try {
      await ensureSignalIdentityWrapper();
      await ensureChatExists();
      const resp = await fetch(asset.uri);
      const blob = await resp.blob();
      const mime = blob.type || 'image/jpeg';
      const ext = mime.split('/')[1] ?? 'jpg';
      const path = `chats/${chatId}/media/${Date.now()}.${ext}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, blob);
      const downloadUrl = await getDownloadURL(ref);
      const isGifAsset = asset.mimeType === 'image/gif';
      await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, version: 1, messageType: isGifAsset ? 'gif' : 'image', mediaUrl: downloadUrl, mediaMimeType: mime, mediaSizeBytes: blob.size, encryptedMediaKey: '', mediaKeyNonce: '', mediaCipherNonce: '', senderPublicKey: (await ensureLocalE2EEKeypair()).publicKey, senderKeyVersion: (await ensureLocalE2EEKeypair()).version, isGif: isGifAsset });
      await sendPushNotification(isGifAsset ? '🎬 Sent a GIF' : '📷 Sent a photo');
      shouldAutoScroll.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) { logger.error('Error uploading image:', e); Alert.alert('Error', getErrMsg(e)); } finally { dispatchCore({ type: 'SET_UPLOADING', payload: false }); }
  }, [user?.uid, chatId, matchId, sendPushNotification, scheduleScrollToBottom, ensureChatExists, ensureSignalIdentityWrapper]);

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: false, allowsMultipleSelection: false });
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
      dispatchCore({ type: 'SET_RECORDING', payload: true });
      dispatchCore({ type: 'SET_RECORDING_DURATION', payload: 0 });
      recordingInterval.current = setInterval(() => dispatchCore({ type: 'INCREMENT_DURATION' }), 1000);
    } catch (e: unknown) { logger.error('Recording start error:', e); Alert.alert('Error', 'Could not start recording.'); }
  }, [audioRecorder]);

  const stopRecording = useCallback(async () => {
    try {
      if (recordingInterval.current) { clearInterval(recordingInterval.current); recordingInterval.current = null; }
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      dispatchCore({ type: 'SET_RECORDING', payload: false });
      dispatchCore({ type: 'SET_RECORDING_DURATION', payload: 0 });
      if (!uri || !user?.uid || !chatId) return;
      await ensureChatExists();
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const fileRef = storageRef(storage, `chats/${chatId}/voice/${Date.now()}.m4a`);
      await uploadBytes(fileRef, blob);
      const downloadUrl = await getDownloadURL(fileRef);
      await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: user.uid, timestamp: serverTimestamp(), read: false, messageType: 'voice', mediaUrl: downloadUrl, mediaMimeType: 'audio/m4a' });
      await sendPushNotification('🎤 Voice message');
      shouldAutoScroll.current = true;
      scheduleScrollToBottom(true);
    } catch (e: unknown) { logger.error('Recording stop error:', e); Alert.alert('Error', 'Could not send voice message.'); }
  }, [audioRecorder, user?.uid, chatId, sendPushNotification, scheduleScrollToBottom, ensureChatExists]);

  const handleReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!user?.uid || !chatId) return;
    dispatchCore({ type: 'SET_REACTION_PICKER', payload: false });
    dispatchCore({ type: 'SET_SELECTED_MSG', payload: null });
    try {
      const msgRef = doc(db, 'chats', chatId, 'messages', msgId);
      const msgSnap = await getDoc(msgRef);
      if (!msgSnap.exists()) return;
      const existing: { emoji: string; userIds: string[] }[] = (msgSnap.data()?.['reactions'] as { emoji: string; userIds: string[] }[]) ?? [];
      const idx = existing.findIndex((r) => r.emoji === emoji);
      if (idx >= 0) {
        const entry = existing[idx];
        if (!entry) return;
        const userIds = entry.userIds.includes(user.uid) ? entry.userIds.filter((u: string) => u !== user.uid) : [...entry.userIds, user.uid];
        if (userIds.length === 0) existing.splice(idx, 1); else existing[idx] = { emoji, userIds };
      } else existing.push({ emoji, userIds: [user.uid] });
      await updateDoc(msgRef, { reactions: existing });
    } catch (e: unknown) { logger.error('Reaction error:', e); }
  }, [user?.uid, chatId]);

  const togglePin = useCallback(async (msgId: string) => {
    if (!user?.uid || !chatId) return;
    dispatchCore({ type: 'SET_OPTIONS', payload: false });
    try { await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), { pinned: true }); Alert.alert('Pinned', 'Message pinned to conversation.'); } catch { Alert.alert('Error', 'Could not pin message.'); }
  }, [user?.uid, chatId]);

  const submitReport = useCallback(async () => {
    if (!core.reportReason.trim() || !user?.uid || !chatId || !core.selectedMessageId) return;
    dispatchCore({ type: 'SET_SUBMITTING_REPORT', payload: true });
    try {
      await addDoc(collection(db, 'reports'), { reporterId: user.uid, chatId, messageId: core.selectedMessageId, reason: core.reportReason.trim(), timestamp: serverTimestamp(), status: 'pending' });
      await writeAuditLog('safety.report_filed', { chatId, messageId: core.selectedMessageId });
      Alert.alert('Reported', 'Thank you. We will review this message.');
      dispatchCore({ type: 'SET_REPORT', payload: false });
      dispatchCore({ type: 'SET_REPORT_REASON', payload: '' });
      dispatchCore({ type: 'SET_SELECTED_MSG', payload: null });
    } catch { Alert.alert('Error', 'Could not submit report.'); } finally { dispatchCore({ type: 'SET_SUBMITTING_REPORT', payload: false }); }
  }, [core.reportReason, core.selectedMessageId, user?.uid, chatId]);

  const saveNote = useCallback(async () => {
    if (!chatId || !user?.uid) return;
    dispatchCore({ type: 'SET_SAVING_NOTE', payload: true });
    try { await updateDoc(doc(db, 'chats', chatId), { note: core.noteText.trim().slice(0, 500) }); dispatchCore({ type: 'SET_NOTE', payload: false }); } catch { Alert.alert('Error', 'Could not save note.'); } finally { dispatchCore({ type: 'SET_SAVING_NOTE', payload: false }); }
  }, [chatId, user?.uid, core.noteText]);

  const loadMoreMessages = useCallback(async () => {
    if (!chatId || !core.hasMore || core.loadingMore || !core.lastDoc) return;
    dispatchCore({ type: 'SET_LOADING_MORE', payload: true });
    try {
      const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'desc'), startAfter(core.lastDoc), limit(PAGE_SIZE));
      const snap = await getDocs(q);
      const more: Message[] = [];
      snap.forEach((d) => more.push(parseMessage(d)));
      more.reverse();
      dispatchCore({ type: 'ADD_MESSAGES_TOP', payload: more });
      dispatchCore({ type: 'SET_HAS_MORE', payload: snap.size >= PAGE_SIZE });
      const lastSnap = snap.docs[snap.docs.length - 1];
      if (snap.size > 0 && lastSnap) dispatchCore({ type: 'SET_LAST_DOC', payload: lastSnap });
    } catch (e: unknown) { logger.error('Load more error:', e); } finally { dispatchCore({ type: 'SET_LOADING_MORE', payload: false }); }
  }, [chatId, core.hasMore, core.loadingMore, core.lastDoc]);

  const toggleDisappearing = useCallback(async () => {
    if (!chatId || !user?.uid) return;
    const next = !core.disappearingEnabled;
    try { await updateDoc(doc(db, 'chats', chatId), { disappearing: next }); dispatchCore({ type: 'SET_DISAPPEARING', payload: next }); } catch { Alert.alert('Error', 'Could not update setting.'); }
  }, [chatId, user?.uid, core.disappearingEnabled]);

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

  const handleInputChange = useCallback((text: string) => {
    dispatchCore({ type: 'SET_INPUT', payload: text.slice(0, 2000) });
    if (!typing.isTyping) { dispatchTyping({ isTyping: true }); void updateTypingStatus(true); }
  }, [typing.isTyping, updateTypingStatus]);

  const loadDateIdeas = useCallback(() => {
    dispatchCore({ type: 'SET_DATE_IDEAS_SHOW', payload: true });
    dispatchCore({ type: 'SET_LOADING_DATES', payload: true });
    const timer = setTimeout(() => {
      const shuffled = [
        { text: 'Grab coffee at a cozy café and talk about your favorite books', vibe: '☕ Casual' },
        { text: 'Visit a local art gallery or museum exhibition', vibe: '🎨 Cultural' },
        { text: 'Take a sunset walk along the waterfront', vibe: '🌅 Romantic' },
        { text: 'Try a new restaurant neither of us has been to', vibe: '🍽️ Foodie' },
      ].sort(() => Math.random() - 0.5);
      dispatchCore({ type: 'SET_DATE_IDEAS', payload: shuffled });
      dispatchCore({ type: 'SET_LOADING_DATES', payload: false });
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const getEstimatedItemSize = useCallback((item: Message) => heightCache.get(item.id) ?? 80, [heightCache]);
  const onOpenPreview = useCallback((url: string) => () => dispatchCore({ type: 'SET_PREVIEW', payload: url }), []);
  const onLongPressMsg = useCallback((id: string) => () => { dispatchCore({ type: 'SET_SELECTED_MSG', payload: id }); dispatchCore({ type: 'SET_OPTIONS', payload: true }); }, []);

  const renderMessage = useCallback(({ item, index }: LegendListRenderItemProps<Message>) => (
    <MessageItem
      item={item} index={index} messages={core.messages} userId={user?.uid}
      matchPhoto={matchPhoto} matchName={matchName} formatTime={formatTime}
      formatFullTime={formatFullTime} onLongPress={onLongPressMsg} onOpenPreview={onOpenPreview}
    />
  ), [core.messages, user?.uid, matchPhoto, matchName, formatTime, formatFullTime, onLongPressMsg, onOpenPreview]);

  const keyExtractor = useCallback((item: Message) => item.id, []);
  const ListFooter = useCallback(() => core.loadingMore ? <ActivityIndicator size="small" color="#6C63FF" style={styles.loadMoreIndicator} /> : null, [core.loadingMore]);

  const onEndReached = useCallback(() => void loadMoreMessages(), [loadMoreMessages]);
  const onLayout = useCallback(() => { if (shouldAutoScroll.current) scheduleScrollToBottom(false); }, [scheduleScrollToBottom]);

  const onMenuAction = useCallback((action: string) => {
    dispatchCore({ type: 'SET_MENU', payload: false });
    if (action === 'notes') dispatchCore({ type: 'SET_NOTE', payload: true });
    if (action === 'pinned') dispatchCore({ type: 'SET_PINNED', payload: true });
    if (action === 'disappearing') void toggleDisappearing();
    if (action === 'dateIdeas') loadDateIdeas();
    if (action === 'call') dispatchCore({ type: 'SET_VIDEO_PROMPT', payload: true });
    if (action === 'unmatch') router.back();
  }, [toggleDisappearing, loadDateIdeas, router]);

  const chatAreaStyle = useMemo(() => [styles.chatArea, opacityStyle], [opacityStyle]);
  const scrollBtnWrapStyle = useMemo(() => [styles.scrollBtnWrap, scrollBtnStyle], [scrollBtnStyle]);
  const lastMessage = core.messages[core.messages.length - 1];
  const hasUnreadAtEnd = lastMessage && !lastMessage.read && lastMessage.senderId !== user?.uid;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#07070f" />
      <ChatHeader
        matchName={matchName} matchPhoto={matchPhoto} matchAge={matchAge}
        matchVerified={matchVerified} matchOnline={matchOnline} matchLastSeen={matchLastSeen}
        theirTyping={typing.theirTyping} showMenu={core.showMenu}
        onBack={() => router.back()} onToggleMenu={() => dispatchCore({ type: 'SET_MENU', payload: !core.showMenu })}
        onCloseMenu={() => dispatchCore({ type: 'SET_MENU', payload: false })} onMenuAction={onMenuAction}
        formatTime={formatTime}
      />

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.flex}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.flex}>
          <Animated.View style={chatAreaStyle}>
            {core.loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color="#6C63FF" />
                <Text style={styles.loadingText}>Loading messages…</Text>
              </View>
            ) : core.messages.length === 0 ? (
              <View style={styles.emptyWrap}>
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
                <Animated.View style={scrollBtnWrapStyle}>
                  <Pressable style={styles.scrollBtn} onPress={() => { shouldAutoScroll.current = true; listRef.current?.scrollToEnd({ animated: true }); }} accessibilityRole="button" accessibilityLabel="Scroll to bottom">
                    <Text style={{ color: '#6C63FF', fontSize: 18 }}>↓</Text>
                    {hasUnreadAtEnd && <View style={styles.scrollBtnBadge} />}
                  </Pressable>
                </Animated.View>
              </View>
            )}
          </Animated.View>

          {typing.theirTyping && (
            <View style={styles.typingBar}>
              <View style={styles.typingDots}><View style={styles.typingDot} /><View style={styles.typingDot} /><View style={styles.typingDot} /></View>
              <Text style={styles.typingText}>{matchName} is typing</Text>
            </View>
          )}

          <InputBar
            inputText={core.inputText} sending={core.sending} uploadingMedia={core.uploadingMedia}
            recordingAudio={core.recordingAudio} recordingDuration={core.recordingDuration}
            onChangeText={handleInputChange} onSend={sendMessage} onPickImage={pickImage}
            onTakePhoto={takePhoto} onStartRecording={startRecording} onStopRecording={stopRecording}
          />
        </View>
      </KeyboardAwareScrollView>

      <ChatModals
        core={core} matchName={matchName} formatTime={formatTime}
        onCloseOptions={() => dispatchCore({ type: 'SET_OPTIONS', payload: false })}
        onPinSelected={() => { if (core.selectedMessageId) void togglePin(core.selectedMessageId); }}
        onOpenReaction={() => { dispatchCore({ type: 'SET_OPTIONS', payload: false }); dispatchCore({ type: 'SET_REACTION_PICKER', payload: true }); }}
        onOpenReport={() => { dispatchCore({ type: 'SET_OPTIONS', payload: false }); dispatchCore({ type: 'SET_REPORT', payload: true }); }}
        onCloseReaction={() => { dispatchCore({ type: 'SET_REACTION_PICKER', payload: false }); dispatchCore({ type: 'SET_SELECTED_MSG', payload: null }); }}
        onCloseReport={() => dispatchCore({ type: 'SET_REPORT', payload: false })}
        onCancelReport={() => { dispatchCore({ type: 'SET_REPORT', payload: false }); dispatchCore({ type: 'SET_REPORT_REASON', payload: '' }); }}
        onSubmitReport={submitReport}
        onReportReasonChange={(t) => dispatchCore({ type: 'SET_REPORT_REASON', payload: t })}
        onCloseNote={() => dispatchCore({ type: 'SET_NOTE', payload: false })}
        onSaveNote={saveNote}
        onNoteTextChange={(t) => dispatchCore({ type: 'SET_NOTE_TEXT', payload: t.slice(0, 500) })}
        onClosePinned={() => dispatchCore({ type: 'SET_PINNED', payload: false })}
        onCloseVideo={() => dispatchCore({ type: 'SET_VIDEO_PROMPT', payload: false })}
        onCloseDateIdeas={() => dispatchCore({ type: 'SET_DATE_IDEAS_SHOW', payload: false })}
        onClosePreview={() => dispatchCore({ type: 'SET_PREVIEW', payload: null })}
        onReaction={(emoji) => { if (core.selectedMessageId) void handleReaction(core.selectedMessageId, emoji); }}
        onUseDateIdea={(text) => { dispatchCore({ type: 'SET_INPUT', payload: text }); dispatchCore({ type: 'SET_DATE_IDEAS_SHOW', payload: false }); }}
        onShuffleDateIdeas={loadDateIdeas}
      />
    </SafeAreaView>
  );
}