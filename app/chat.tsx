import CryptoJS from 'crypto-js';
import { AudioModule, RecordingPresets, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { DateIdea, getConversationStarters, getDateIdeas } from '../utils/aiHelpers';
import {
  CHAT_WALLPAPERS,
  ChatSettings,
  getChatSettings,
  getWallpaperStyle,
  updateChatSettings,
} from '../utils/chatSettings';
import {
  cleanupExpiredMessages,
  DisappearingMode,
  getDisappearingLabel,
  getDisappearingSettings,
  setDisappearingMode,
} from '../utils/disappearingMessages';
import { getTrendingGifs, GIF_CATEGORIES, GiphyGif, searchGifs } from '../utils/giphyApi';
import { getMatchNote, saveMatchNote } from '../utils/matchNotes';
import { addReaction, groupReactions, hasUserReacted, Reaction, REACTION_EMOJIS } from '../utils/messageReactions';
import { translateMessage } from '../utils/messageTranslation';
import { notifyNewMessage } from '../utils/notifications';
import { formatLastSeen, isUserOnline } from '../utils/onlineStatus';
import { getPinnedMessages, pinMessage, PinnedMessage, unpinMessage } from '../utils/pinnedMessages';
import { shouldPromptForRating } from '../utils/ratingSystem';

// ============ TYPES ============
interface Message {
  id: string;
  text: string;
  senderId: string;
  timestamp: any;
  read?: boolean;
  readAt?: any;
  imageUrl?: string;
  voiceUrl?: string;
  voiceDuration?: number;
  isGif?: boolean;
  reactions?: Reaction[];
  isPinned?: boolean;
}

interface DateSuggestion {
  name: string;
  type: string;
  address: string;
  distance: number;
  rating?: number;
}

interface MatchData {
  name?: string;
  lastSeen?: any;
  selfieVerified?: boolean;
  ageVerification?: any;
  pushToken?: string;
  location?: { latitude: number; longitude: number };
  personalityType?: string;
  interests?: string[];
  lifestyle?: any;
}

// ============ HELPERS (outside component) ============
const generateChatEncryptionKey = (chatId: string): string => {
  const salt = 'MyArchetype-Secure-Salt-2026-v2';
  return CryptoJS.SHA256(chatId + salt).toString();
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatTime = (timestamp: any): string => {
  if (!timestamp) return '';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Stable waveform heights (generated once, not on every render)
const WAVEFORM_BARS = Array.from({ length: 12 }, () => 8 + Math.random() * 20);

// ============ MAIN COMPONENT ============
export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { matchId, matchName, showDatePlanner: showDatePlannerParam } = params;

  const user = auth.currentUser;
  const chatId = useMemo(() => [user?.uid, matchId].sort().join('_'), [user?.uid, matchId]);
  const ENCRYPTION_KEY = useMemo(() => generateChatEncryptionKey(chatId), [chatId]);

  // Refs
  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gifSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Core state
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Match state
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [matchOnline, setMatchOnline] = useState(false);
  const [matchLastSeen, setMatchLastSeen] = useState<any>(null);
  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Typing state
  const [isTyping, setIsTyping] = useState(false);
  const [matchIsTyping, setMatchIsTyping] = useState(false);

  // Audio state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [waitingForVoiceUri, setWaitingForVoiceUri] = useState(false);

  // expo-audio hooks
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer = useAudioPlayer(null);

  // Chat settings state
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [disappearingMode, setDisappearingModeState] = useState<DisappearingMode>('off');

  // UI state
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Modal states
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [showMessageOptionsModal, setShowMessageOptionsModal] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showPinnedMessages, setShowPinnedMessages] = useState(false);
  const [showDisappearingModal, setShowDisappearingModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showStartersModal, setShowStartersModal] = useState(false);
  const [showDateIdeasModal, setShowDateIdeasModal] = useState(false);
  const [showDatePlannerModal, setShowDatePlannerModal] = useState(false);
  const [showVideoCallPrompt, setShowVideoCallPrompt] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // Feature data states
  const [gifSearchQuery, setGifSearchQuery] = useState('');
  const [gifResults, setGifResults] = useState<GiphyGif[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, string>>({});
  const [translatingMessage, setTranslatingMessage] = useState<string | null>(null);
  const [matchNote, setMatchNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [conversationStarters, setConversationStarters] = useState<string[]>([]);
  const [dateIdeas, setDateIdeas] = useState<DateIdea[]>([]);
  const [dateSuggestions, setDateSuggestions] = useState<DateSuggestion[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [callType, setCallType] = useState<'video' | 'audio'>('video');
  const [reportReason, setReportReason] = useState('');

  // ============ EFFECTS ============

  // Request audio permissions on mount
  useEffect(() => {
    AudioModule.requestRecordingPermissionsAsync().catch(() => {});
  }, []);

  // Load chat settings and initial data
  useEffect(() => {
    const loadChatData = async () => {
      const [settings, pinned, disappearing, note] = await Promise.all([
        getChatSettings(chatId),
        getPinnedMessages(chatId),
        getDisappearingSettings(chatId),
        getMatchNote(matchId as string),
      ]);

      setChatSettings(settings);
      setPinnedMessages(pinned);
      if (disappearing) setDisappearingModeState(disappearing.mode);
      setMatchNote(note);

      if (disappearing && disappearing.mode !== 'off') {
        await cleanupExpiredMessages(chatId);
      }
    };
    loadChatData();
  }, [chatId, matchId]);

  // Load my location
  useEffect(() => {
    const loadMyLocation = async () => {
      if (!user) return;
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) setMyLocation(userDoc.data().location);
    };
    loadMyLocation();
  }, [user]);

  // Auto-open date planner if param set
  useEffect(() => {
    if (showDatePlannerParam === 'true') setShowDatePlannerModal(true);
  }, [showDatePlannerParam]);

  // Listen to match data
  useEffect(() => {
    if (!matchId) return;

    const unsubscribe = onSnapshot(doc(db, 'users', matchId as string), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as MatchData;
        setMatchData(data);
        setMatchOnline(isUserOnline(data.lastSeen));
        setMatchLastSeen(data.lastSeen);
        setConversationStarters(getConversationStarters(data.personalityType, data.interests));
        setDateIdeas(getDateIdeas(undefined, data.lifestyle, 5));
      }
    });

    return () => unsubscribe();
  }, [matchId]);

  // Listen for typing indicator
  useEffect(() => {
    if (!matchId || !user) return;

    const typingRef = doc(db, 'chats', chatId, 'typing', matchId as string);
    const unsubscribe = onSnapshot(typingRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const lastTyped = data.lastTyped?.toMillis() || 0;
        setMatchIsTyping((data.isTyping || false) && Date.now() - lastTyped < 5000);
      } else {
        setMatchIsTyping(false);
      }
    });

    return () => unsubscribe();
  }, [matchId, user, chatId]);

  // Check rating prompt
  useEffect(() => {
    const checkRatingPrompt = async () => {
      if (!user || !matchId) return;
      const shouldShow = await shouldPromptForRating(user.uid, matchId as string);
      setShowRatingPrompt(shouldShow);
    };
    checkRatingPrompt();
  }, [user, matchId]);

  // Listen to messages
  useEffect(() => {
    if (!user || !matchId) return;

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const loadedMessages: Message[] = [];
      const unreadMessages: string[] = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        let decryptedText = '';
        if (data.encryptedText) {
          try {
            decryptedText = CryptoJS.AES.decrypt(data.encryptedText, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
          } catch {
            decryptedText = '[Unable to decrypt]';
          }
        }

        if (data.senderId !== user.uid && !data.read && chatSettings?.readReceiptsEnabled !== false) {
          unreadMessages.push(docSnap.id);
        }

        loadedMessages.push({
          id: docSnap.id,
          text: decryptedText,
          senderId: data.senderId,
          timestamp: data.timestamp,
          read: data.read || false,
          readAt: data.readAt,
          imageUrl: data.imageUrl || undefined,
          voiceUrl: data.voiceUrl || undefined,
          voiceDuration: data.voiceDuration || 0,
          isGif: data.isGif || false,
          reactions: data.reactions || [],
          isPinned: pinnedMessages.some((p) => p.messageId === docSnap.id),
        });
      });

      setMessages(loadedMessages);
      setLoading(false);

      if (chatSettings?.readReceiptsEnabled !== false) {
        for (const msgId of unreadMessages) {
          try {
            await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), {
              read: true,
              readAt: serverTimestamp(),
            });
          } catch (e) {
            console.error('Error marking message as read:', e);
          }
        }
      }

      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    });

    return () => unsubscribe();
  }, [user, matchId, ENCRYPTION_KEY, chatSettings?.readReceiptsEnabled, pinnedMessages]);

  // Handle voice URI after recording stops
  useEffect(() => {
    if (waitingForVoiceUri && audioRecorder.uri) {
      setWaitingForVoiceUri(false);
      uploadAndSendVoiceMessage(audioRecorder.uri);
    }
  }, [waitingForVoiceUri, audioRecorder.uri]);

  // Detect audio playback end
  useEffect(() => {
    if (!playingAudio) return;
    const check = setInterval(() => {
      try {
        if (!audioPlayer.playing) setPlayingAudio(null);
      } catch {}
    }, 1000);
    return () => clearInterval(check);
  }, [playingAudio, audioPlayer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (gifSearchTimeoutRef.current) clearTimeout(gifSearchTimeoutRef.current);
    };
  }, []);

  // ============ NOTIFICATION HELPER ============
  const sendPushNotification = useCallback(
    async (messagePreview: string) => {
      if (!matchData?.pushToken || matchOnline || !user) return;
      try {
        const senderDoc = await getDoc(doc(db, 'users', user.uid));
        const senderName = senderDoc.exists() ? senderDoc.data().name : 'Someone';
        await notifyNewMessage(matchData.pushToken, senderName, messagePreview);
      } catch (e) {
        console.error('Notification failed:', e);
      }
    },
    [matchData?.pushToken, matchOnline, user]
  );

  // ============ TYPING HANDLERS ============

  const updateTypingStatus = useCallback(
    async (typing: boolean) => {
      if (!user || chatSettings?.typingIndicatorsEnabled === false) return;
      try {
        const typingRef = doc(db, 'chats', chatId, 'typing', user.uid);
        const data = { isTyping: typing, lastTyped: serverTimestamp() };
        try {
          await updateDoc(typingRef, data);
        } catch {
          await setDoc(typingRef, data);
        }
      } catch {}
    },
    [user, chatId, chatSettings?.typingIndicatorsEnabled]
  );

  const handleTextChange = useCallback(
    (text: string) => {
      setNewMessage(text);
      if (!isTyping && text.length > 0) {
        setIsTyping(true);
        updateTypingStatus(true);
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setIsTyping(false);
        updateTypingStatus(false);
      }, 3000);
    },
    [isTyping, updateTypingStatus]
  );

  // ============ SEND MESSAGE ============

  const sendMessage = useCallback(async () => {
    if (!newMessage.trim() || !user || sending) return;
    const messageText = newMessage.trim();
    setNewMessage('');
    setSending(true);
    setIsTyping(false);
    updateTypingStatus(false);

    try {
      const encryptedText = CryptoJS.AES.encrypt(messageText, ENCRYPTION_KEY).toString();
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        encryptedText,
        senderId: user.uid,
        timestamp: serverTimestamp(),
        read: false,
      });
      await sendPushNotification(messageText);
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message');
      setNewMessage(messageText);
    } finally {
      setSending(false);
    }
  }, [newMessage, user, sending, ENCRYPTION_KEY, chatId, updateTypingStatus, sendPushNotification]);

  // ============ IMAGE HANDLERS ============

  const uploadAndSendImage = useCallback(
    async (imageAsset: ImagePicker.ImagePickerAsset) => {
      if (!user) return;
      setUploadingMedia(true);
      try {
        const formData = new FormData();
        formData.append('file', `data:image/jpeg;base64,${imageAsset.base64}`);
        formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
        formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);

        const uploadResponse = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`,
          { method: 'POST', body: formData }
        );
        const uploadData = await uploadResponse.json();
        if (!uploadData.secure_url) throw new Error('Upload failed');

        await addDoc(collection(db, 'chats', chatId, 'messages'), {
          senderId: user.uid,
          timestamp: serverTimestamp(),
          read: false,
          imageUrl: uploadData.secure_url,
        });
        await sendPushNotification('📷 Sent a photo');
      } catch (error) {
        console.error('Error uploading image:', error);
        Alert.alert('Error', 'Failed to send image');
      } finally {
        setUploadingMedia(false);
      }
    },
    [user, chatId, sendPushNotification]
  );

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!result.granted) {
      Alert.alert('Permission Required', 'Permission to access photos is required!');
      return;
    }
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });
    if (!pickerResult.canceled && pickerResult.assets[0]) {
      await uploadAndSendImage(pickerResult.assets[0]);
    }
  }, [uploadAndSendImage]);

  const handleTakePhoto = useCallback(async () => {
    const result = await ImagePicker.requestCameraPermissionsAsync();
    if (!result.granted) {
      Alert.alert('Permission Required', 'Permission to access camera is required!');
      return;
    }
    const pickerResult = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });
    if (!pickerResult.canceled && pickerResult.assets[0]) {
      await uploadAndSendImage(pickerResult.assets[0]);
    }
  }, [uploadAndSendImage]);

  // ============ VOICE MESSAGE HANDLERS ============

  const uploadAndSendVoiceMessage = useCallback(
    async (uri: string) => {
      if (!user) return;
      setUploadingMedia(true);
      try {
        const response = await fetch(uri);
        const blob = await response.blob();
        const formData = new FormData();
        formData.append('file', blob as any);
        formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
        formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);
        formData.append('resource_type', 'auto');

        const uploadResponse = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/auto/upload`,
          { method: 'POST', body: formData }
        );
        const uploadData = await uploadResponse.json();
        if (!uploadData.secure_url) throw new Error('Upload failed');

        await addDoc(collection(db, 'chats', chatId, 'messages'), {
          senderId: user.uid,
          timestamp: serverTimestamp(),
          read: false,
          voiceUrl: uploadData.secure_url,
          voiceDuration: recordingDuration,
        });
        setRecordingDuration(0);
        await sendPushNotification('🎤 Voice message');
      } catch (error) {
        console.error('Error sending voice message:', error);
        Alert.alert('Error', 'Failed to send voice message');
      } finally {
        setUploadingMedia(false);
      }
    },
    [user, chatId, recordingDuration, sendPushNotification]
  );

  const startRecording = useCallback(async () => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Microphone permission is required for voice messages');
        return;
      }
      audioRecorder.record();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          if (prev >= 60) {
            // Auto-stop at 60 seconds - clear interval, flag stop
            if (recordingTimerRef.current) {
              clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }
            setIsRecording(false);
            try {
              audioRecorder.stop();
            } catch {}
            setWaitingForVoiceUri(true);
            return 60;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Could not start recording');
    }
  }, [audioRecorder]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    audioRecorder.stop();
    setWaitingForVoiceUri(true);
  }, [isRecording, audioRecorder]);

  const cancelRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingDuration(0);
    setWaitingForVoiceUri(false);
    try {
      audioRecorder.stop();
    } catch {}
  }, [audioRecorder]);

  const playVoiceMessage = useCallback(
    (voiceUrl: string) => {
      try {
        if (playingAudio === voiceUrl) {
          audioPlayer.pause();
          setPlayingAudio(null);
          return;
        }
        audioPlayer.replace(voiceUrl);
        setPlayingAudio(voiceUrl);
        audioPlayer.play();
      } catch (error) {
        console.error('Error playing voice message:', error);
        setPlayingAudio(null);
      }
    },
    [playingAudio, audioPlayer]
  );

  // ============ GIF HANDLERS ============

  const executeGifSearch = useCallback(async (searchQuery: string) => {
    setLoadingGifs(true);
    try {
      const results = searchQuery.trim() ? await searchGifs(searchQuery, 20) : await getTrendingGifs(20);
      setGifResults(results);
    } catch (error) {
      console.error('Error searching GIFs:', error);
    } finally {
      setLoadingGifs(false);
    }
  }, []);

  const handleGifSearchInput = useCallback(
    (text: string) => {
      setGifSearchQuery(text);
      if (gifSearchTimeoutRef.current) clearTimeout(gifSearchTimeoutRef.current);
      gifSearchTimeoutRef.current = setTimeout(() => executeGifSearch(text), 400);
    },
    [executeGifSearch]
  );

  const handleGifCategoryPress = useCallback(
    (categoryQuery: string) => {
      setGifSearchQuery(categoryQuery);
      executeGifSearch(categoryQuery);
    },
    [executeGifSearch]
  );

  useEffect(() => {
    if (showGifPicker) executeGifSearch('');
  }, [showGifPicker, executeGifSearch]);

  const sendGif = useCallback(
    async (gif: GiphyGif) => {
      if (!user) return;
      setShowGifPicker(false);
      setSending(true);
      try {
        const encryptedText = CryptoJS.AES.encrypt('[GIF]', ENCRYPTION_KEY).toString();
        await addDoc(collection(db, 'chats', chatId, 'messages'), {
          encryptedText,
          senderId: user.uid,
          timestamp: serverTimestamp(),
          read: false,
          imageUrl: gif.url,
          isGif: true,
        });
        await sendPushNotification('🎬 Sent a GIF');
      } catch (error) {
        console.error('Error sending GIF:', error);
        Alert.alert('Error', 'Failed to send GIF');
      } finally {
        setSending(false);
      }
    },
    [user, ENCRYPTION_KEY, chatId, sendPushNotification]
  );

  // ============ REACTION HANDLERS ============

  const handleReaction = useCallback(
    async (emoji: string) => {
      if (!selectedMessage) return;
      const result = await addReaction(chatId, selectedMessage.id, emoji);
      if (!result.success) Alert.alert('Error', 'Failed to add reaction');
      setShowReactionPicker(false);
      setSelectedMessage(null);
    },
    [selectedMessage, chatId]
  );

  // ============ TRANSLATION HANDLERS ============

  const handleTranslateMessage = useCallback(
    async (messageId: string, text: string) => {
      if (translatedMessages[messageId]) {
        setTranslatedMessages((prev) => {
          const next = { ...prev };
          delete next[messageId];
          return next;
        });
        return;
      }
      setTranslatingMessage(messageId);
      try {
        const result = await translateMessage(text, 'en');
        if (result.success && result.translatedText) {
          setTranslatedMessages((prev) => ({ ...prev, [messageId]: result.translatedText! }));
        } else {
          Alert.alert('Error', 'Translation failed');
        }
      } catch {
        Alert.alert('Error', 'Translation failed');
      } finally {
        setTranslatingMessage(null);
      }
    },
    [translatedMessages]
  );

  // ============ PIN HANDLERS ============

  const refreshPinnedMessages = useCallback(async () => {
    const pinned = await getPinnedMessages(chatId);
    setPinnedMessages(pinned);
  }, [chatId]);

  const handlePinMessage = useCallback(
    async (messageId: string, messageText: string) => {
      const result = await pinMessage(chatId, messageId, messageText);
      if (result.success) {
        await refreshPinnedMessages();
        Alert.alert('Success', 'Message pinned!');
      } else {
        Alert.alert('Error', 'Failed to pin message');
      }
    },
    [chatId, refreshPinnedMessages]
  );

  const handleUnpinMessage = useCallback(
    async (messageId: string) => {
      const result = await unpinMessage(chatId, messageId);
      if (result.success) await refreshPinnedMessages();
    },
    [chatId, refreshPinnedMessages]
  );

  // ============ DISAPPEARING MESSAGES ============

  const handleSetDisappearing = useCallback(
    async (mode: DisappearingMode) => {
      const result = await setDisappearingMode(chatId, mode);
      if (result.success) {
        setDisappearingModeState(mode);
        setShowDisappearingModal(false);
        Alert.alert('Success', `Disappearing messages: ${getDisappearingLabel(mode)}`);
      }
    },
    [chatId]
  );

  // ============ MATCH NOTE ============

  const handleSaveNote = useCallback(async () => {
    setSavingNote(true);
    const success = await saveMatchNote(matchId as string, matchNote);
    setSavingNote(false);
    if (success) {
      setShowNoteModal(false);
      Alert.alert('Success', 'Note saved!');
    } else {
      Alert.alert('Error', 'Failed to save note');
    }
  }, [matchId, matchNote]);

  // ============ DATE PLANNING ============

  const findDatePlaces = useCallback(async () => {
    if (!myLocation || !matchData?.location) {
      Alert.alert('Error', 'Location data not available for both users');
      return;
    }
    setLoadingPlaces(true);
    setDateSuggestions([]);
    try {
      const midpoint = {
        latitude: (myLocation.latitude + matchData.location.latitude) / 2,
        longitude: (myLocation.longitude + matchData.location.longitude) / 2,
      };
      const radius = 5000;
      const queryStr = `[out:json];(node["amenity"="restaurant"](around:${radius},${midpoint.latitude},${midpoint.longitude});node["amenity"="cafe"](around:${radius},${midpoint.latitude},${midpoint.longitude});node["amenity"="bar"](around:${radius},${midpoint.latitude},${midpoint.longitude});node["leisure"="park"](around:${radius},${midpoint.latitude},${midpoint.longitude});node["tourism"="museum"](around:${radius},${midpoint.latitude},${midpoint.longitude}););out body 20;`;

      const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: queryStr });
      const data = await response.json();

      if (data.elements?.length > 0) {
        const places: DateSuggestion[] = data.elements
          .map((place: any) => ({
            name: place.tags?.name || 'Unnamed Place',
            type: place.tags?.amenity || place.tags?.leisure || place.tags?.tourism || 'Place',
            address: place.tags?.['addr:street'] || 'Address not available',
            distance: Math.round(calculateDistance(midpoint.latitude, midpoint.longitude, place.lat, place.lon) * 10) / 10,
          }))
          .sort((a: DateSuggestion, b: DateSuggestion) => a.distance - b.distance)
          .slice(0, 10);
        setDateSuggestions(places);
      } else {
        Alert.alert('No Results', 'No places found nearby.');
      }
    } catch (error) {
      console.error('Error finding places:', error);
      Alert.alert('Error', 'Failed to find date places.');
    } finally {
      setLoadingPlaces(false);
    }
  }, [myLocation, matchData?.location]);

  const sharePlace = useCallback((place: DateSuggestion) => {
    setNewMessage(`How about we meet at ${place.name}?\n📍 ${place.address}\n🚶 ${place.distance} km from midpoint`);
    setShowDatePlannerModal(false);
  }, []);

  const openInMaps = useCallback((place: DateSuggestion) => {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`);
  }, []);

  // ============ VIDEO/AUDIO CALL ============

  const initiateCall = useCallback((type: 'video' | 'audio') => {
    setCallType(type);
    setShowVideoCallPrompt(true);
  }, []);

  const startCall = useCallback(async () => {
    if (!user || !matchId) return;
    const roomName = `myarchetype-${chatId}`;
    const jitsiUrl = callType === 'video'
      ? `https://meet.jit.si/${roomName}`
      : `https://meet.jit.si/${roomName}#config.startWithVideoMuted=true`;
    const callIcon = callType === 'video' ? '📹' : '📞';
    const callMessage = `${callIcon} ${callType === 'video' ? 'Video' : 'Audio'} call started!\n\nJoin here: ${jitsiUrl}`;

    try {
      const encryptedText = CryptoJS.AES.encrypt(callMessage, ENCRYPTION_KEY).toString();
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        encryptedText,
        senderId: user.uid,
        timestamp: serverTimestamp(),
        read: false,
      });
      await sendPushNotification(`${callIcon} Started a ${callType} call`);
      Linking.openURL(jitsiUrl);
      setShowVideoCallPrompt(false);
    } catch (error) {
      console.error('Error starting call:', error);
      Alert.alert('Error', 'Failed to start call');
    }
  }, [user, matchId, chatId, callType, ENCRYPTION_KEY, sendPushNotification]);

  // ============ USER ACTIONS ============

  const handleUnmatch = useCallback(() => {
    if (!user || !matchId) return;
    Alert.alert(
      `Unmatch with ${matchName}?`,
      'This will end the conversation and remove them from your matches. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'likes', `${user.uid}_${matchId}`)).catch(() => {});
              await deleteDoc(doc(db, 'likes', `${matchId}_${user.uid}`)).catch(() => {});
              const messagesSnapshot = await getDocs(collection(db, 'chats', chatId, 'messages'));
              for (const msgDoc of messagesSnapshot.docs) {
                await deleteDoc(doc(db, 'chats', chatId, 'messages', msgDoc.id));
              }
              await deleteDoc(doc(db, 'chats', chatId, 'typing', user.uid)).catch(() => {});
              await deleteDoc(doc(db, 'chats', chatId, 'typing', matchId as string)).catch(() => {});
              Alert.alert('Success', `You've unmatched with ${matchName}`);
              router.replace('/my-matches');
            } catch (error) {
              console.error('Error unmatching:', error);
              Alert.alert('Error', 'Error unmatching');
            }
          },
        },
      ]
    );
  }, [user, matchId, chatId, matchName, router]);

  const handleReport = useCallback(() => {
    if (!user || !matchId) return;
    setReportReason('');
    setShowReportModal(true);
  }, [user, matchId]);

  const submitReport = useCallback(async () => {
    if (!reportReason.trim() || !user) return;
    try {
      await setDoc(doc(db, 'reports', `${user.uid}_${matchId}_${Date.now()}`), {
        reporterId: user.uid,
        reportedUserId: matchId,
        reportedUserName: matchName,
        reason: reportReason.trim(),
        createdAt: new Date().toISOString(),
        status: 'pending',
        context: 'chat',
      });
      setShowReportModal(false);
      Alert.alert('Report Submitted', 'Thank you for helping keep our community safe.');
    } catch (error) {
      console.error('Error reporting:', error);
      Alert.alert('Error', 'Error submitting report');
    }
  }, [user, matchId, matchName, reportReason]);

  const handleBlock = useCallback(() => {
    if (!user || !matchId) return;
    Alert.alert(
      `Block ${matchName}?`,
      "They won't be able to see your profile or contact you. You will also be unmatched.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await setDoc(doc(db, 'blockedUsers', `${user.uid}_${matchId}`), {
                blockerId: user.uid,
                blockedId: matchId,
                createdAt: new Date().toISOString(),
              });
              await deleteDoc(doc(db, 'likes', `${user.uid}_${matchId}`)).catch(() => {});
              await deleteDoc(doc(db, 'likes', `${matchId}_${user.uid}`)).catch(() => {});
              Alert.alert('Blocked', `You've blocked ${matchName}`);
              router.replace('/my-matches');
            } catch (error) {
              console.error('Error blocking:', error);
              Alert.alert('Error', 'Error blocking user');
            }
          },
        },
      ]
    );
  }, [user, matchId, matchName, router]);

  // ============ MESSAGE ACTIONS ============

  const handleMessageLongPress = useCallback((item: Message) => {
    setSelectedMessage(item);
    setShowMessageOptionsModal(true);
  }, []);

  const handleMessageAction = useCallback(
    (action: string) => {
      if (!selectedMessage) return;
      setShowMessageOptionsModal(false);
      switch (action) {
        case 'react':
          setShowReactionPicker(true);
          break;
        case 'translate':
          handleTranslateMessage(selectedMessage.id, selectedMessage.text);
          setSelectedMessage(null);
          break;
        case 'pin':
          if (pinnedMessages.some((p) => p.messageId === selectedMessage.id)) {
            handleUnpinMessage(selectedMessage.id);
          } else {
            handlePinMessage(selectedMessage.id, selectedMessage.text);
          }
          setSelectedMessage(null);
          break;
        default:
          setSelectedMessage(null);
      }
    },
    [selectedMessage, pinnedMessages, handleTranslateMessage, handlePinMessage, handleUnpinMessage]
  );

  // ============ RENDER MESSAGE ============

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isMe = item.senderId === user?.uid;
      const messageReactions = groupReactions(item.reactions || []);
      const isTranslated = !!translatedMessages[item.id];
      const isPinned = pinnedMessages.some((p) => p.messageId === item.id);

      return (
        <TouchableOpacity onLongPress={() => handleMessageLongPress(item)} delayLongPress={500} activeOpacity={0.8}>
          <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
            {isPinned && (
              <View style={styles.pinnedIndicator}>
                <Text style={styles.pinnedIndicatorText}>📌 Pinned</Text>
              </View>
            )}
            {item.imageUrl && (
              <TouchableOpacity onPress={() => setPreviewImage(item.imageUrl || null)}>
                <Image source={{ uri: item.imageUrl }} style={styles.messageImage} resizeMode="cover" />
                {item.isGif && (
                  <View style={styles.gifBadge}><Text style={styles.gifBadgeText}>GIF</Text></View>
                )}
              </TouchableOpacity>
            )}
            {item.voiceUrl && (
              <TouchableOpacity style={styles.voiceMessageContainer} onPress={() => playVoiceMessage(item.voiceUrl!)}>
                <Text style={styles.voicePlayButton}>{playingAudio === item.voiceUrl ? '⏸' : '▶️'}</Text>
                <View style={styles.voiceWaveform}>
                  {WAVEFORM_BARS.map((barHeight, i) => (
                    <View
                      key={i}
                      style={[
                        styles.voiceBar,
                        {
                          height: barHeight,
                          backgroundColor: playingAudio === item.voiceUrl
                            ? (isMe ? '#fff' : '#53a8b6')
                            : (isMe ? 'rgba(255,255,255,0.5)' : '#555'),
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.voiceDuration, isMe && styles.voiceDurationMe]}>
                  {formatDuration(item.voiceDuration || 0)}
                </Text>
              </TouchableOpacity>
            )}
            {item.text && !item.text.startsWith('[GIF') && (
              <>
                <Text style={[styles.messageText, isMe && styles.myMessageText]}>{item.text}</Text>
                {isTranslated && (
                  <View style={styles.translationContainer}>
                    <Text style={styles.translationLabel}>🌐 Translated:</Text>
                    <Text style={[styles.messageText, isMe && styles.myMessageText, styles.translatedText]}>
                      {translatedMessages[item.id]}
                    </Text>
                  </View>
                )}
                {translatingMessage === item.id && (
                  <View style={styles.translatingIndicator}>
                    <ActivityIndicator size="small" color={isMe ? '#fff' : '#53a8b6'} />
                    <Text style={styles.translatingText}>Translating...</Text>
                  </View>
                )}
              </>
            )}
            {messageReactions.length > 0 && (
              <View style={styles.reactionsContainer}>
                {messageReactions.map((reaction, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[styles.reactionBubble, hasUserReacted(item.reactions || [], user?.uid || '', reaction.emoji) && styles.reactionBubbleActive]}
                    onPress={() => { setSelectedMessage(item); handleReaction(reaction.emoji); }}
                  >
                    <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                    <Text style={styles.reactionCount}>{reaction.count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={styles.messageFooter}>
              <Text style={[styles.messageTime, isMe && styles.myMessageTime]}>{formatTime(item.timestamp)}</Text>
              {isMe && chatSettings?.readReceiptsEnabled !== false && (
                <Text style={styles.readReceipt}>{item.read ? ' ✓✓' : ' ✓'}</Text>
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [user?.uid, pinnedMessages, translatedMessages, translatingMessage, playingAudio, chatSettings?.readReceiptsEnabled, handleMessageLongPress, playVoiceMessage, handleReaction]
  );

  const ageBadge = useMemo(() => getAgeVerificationLevel(matchData?.ageVerification), [matchData?.ageVerification]);
  const wallpaperStyle = useMemo(() => getWallpaperStyle(chatSettings?.wallpaper || null), [chatSettings?.wallpaper]);

    // ============ MAIN RENDER ============

  return (
    <KeyboardAvoidingView
      style={[styles.container, wallpaperStyle]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButtonContainer} onPress={() => router.replace('/my-matches')}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.headerNameRow}>
            <Text style={styles.headerTitle}>{matchName}</Text>
            {matchData?.selfieVerified && <Text style={styles.verifiedBadge}>✓</Text>}
          </View>

          {ageBadge.level !== 'unverified' && (
            <View style={[styles.headerAgeBadge, { backgroundColor: ageBadge.color }]}>
              <Text style={styles.headerAgeBadgeText}>{ageBadge.label}</Text>
            </View>
          )}

          {disappearingMode !== 'off' && (
            <Text style={styles.disappearingIndicator}>⏱️ {getDisappearingLabel(disappearingMode)}</Text>
          )}

          {matchIsTyping ? (
            <Text style={styles.typingText}>typing...</Text>
          ) : matchOnline ? (
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>Online</Text>
            </View>
          ) : matchLastSeen ? (
            <Text style={styles.lastSeenText}>{formatLastSeen(matchLastSeen)}</Text>
          ) : null}
        </View>

        <TouchableOpacity style={styles.menuButton} onPress={() => setShowMenuModal(true)}>
          <Text style={styles.menuButtonText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.quickActionButton} onPress={() => initiateCall('video')}>
          <Text style={styles.quickActionText}>📹</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={() => initiateCall('audio')}>
          <Text style={styles.quickActionText}>📞</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={() => setShowDatePlannerModal(true)}>
          <Text style={styles.quickActionText}>📍</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={() => setShowDateIdeasModal(true)}>
          <Text style={styles.quickActionText}>💡</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={() => setShowStartersModal(true)}>
          <Text style={styles.quickActionText}>💬</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickActionButton} onPress={() => setShowNoteModal(true)}>
          <Text style={styles.quickActionText}>📝</Text>
        </TouchableOpacity>
      </View>

      {/* Pinned Messages Bar */}
      {pinnedMessages.length > 0 && (
        <TouchableOpacity style={styles.pinnedBar} onPress={() => setShowPinnedMessages(true)}>
          <Text style={styles.pinnedBarIcon}>📌</Text>
          <Text style={styles.pinnedBarText} numberOfLines={1}>{pinnedMessages[0].text}</Text>
          {pinnedMessages.length > 1 && <Text style={styles.pinnedBarCount}>+{pinnedMessages.length - 1}</Text>}
        </TouchableOpacity>
      )}

      {/* Rating Prompt */}
      {showRatingPrompt && (
        <TouchableOpacity
          style={styles.ratingBanner}
          onPress={() => router.push({ pathname: '/post-date-rating', params: { matchId, matchName } })}
        >
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

      {/* Messages List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#53a8b6" />
          <Text style={styles.loadingText}>Loading chat...</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>{`No messages yet.\nSay hi to ${matchName}!`}</Text>
          <TouchableOpacity style={styles.starterPromptButton} onPress={() => setShowStartersModal(true)}>
            <Text style={styles.starterPromptText}>💡 Need conversation starters?</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      {/* Typing Indicator */}
      {matchIsTyping && (
        <View style={styles.typingIndicatorContainer}>
          <View style={styles.typingBubble}>
            <View style={styles.typingDots}>
              <View style={[styles.typingDot, styles.typingDot1]} />
              <View style={[styles.typingDot, styles.typingDot2]} />
              <View style={[styles.typingDot, styles.typingDot3]} />
            </View>
          </View>
        </View>
      )}

      {/* Uploading Indicator */}
      {uploadingMedia && (
        <View style={styles.uploadingContainer}>
          <ActivityIndicator size="small" color="#53a8b6" />
          <Text style={styles.uploadingText}>Sending...</Text>
        </View>
      )}

      {/* Recording Indicator */}
      {isRecording && (
        <View style={styles.recordingContainer}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>Recording... {formatDuration(recordingDuration)}</Text>
          <TouchableOpacity style={styles.cancelRecordButton} onPress={cancelRecording}>
            <Text style={styles.cancelRecordText}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.stopRecordButton} onPress={stopRecording}>
            <Text style={styles.stopRecordText}>Send</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input Area */}
      {!isRecording && (
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.mediaButton} onPress={handlePickImage} disabled={sending || uploadingMedia}>
            <Text style={styles.mediaButtonText}>🖼️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mediaButton} onPress={handleTakePhoto} disabled={sending || uploadingMedia}>
            <Text style={styles.mediaButtonText}>📷</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gifButton} onPress={() => setShowGifPicker(true)} disabled={sending || uploadingMedia}>
            <Text style={styles.gifButtonText}>GIF</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mediaButton} onPress={startRecording} disabled={sending || uploadingMedia}>
            <Text style={styles.mediaButtonText}>🎤</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#666"
            value={newMessage}
            onChangeText={handleTextChange}
            onSubmitEditing={sendMessage}
            editable={!sending && !uploadingMedia}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!newMessage.trim() || sending || uploadingMedia) && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!newMessage.trim() || sending || uploadingMedia}
          >
            <Text style={styles.sendButtonText}>{sending ? '...' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ============ MODALS ============ */}

      {/* Menu Modal */}
      <Modal visible={showMenuModal} transparent animationType="fade" onRequestClose={() => setShowMenuModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowMenuModal(false)}>
          <View style={styles.menuContainer}>
            <ScrollView bounces={false}>
              <Text style={styles.menuTitle}>Options</Text>
              {[
                { icon: '📹', label: 'Video Call', onPress: () => { setShowMenuModal(false); initiateCall('video'); } },
                { icon: '📞', label: 'Audio Call', onPress: () => { setShowMenuModal(false); initiateCall('audio'); } },
                { icon: '📍', label: 'Plan Date', onPress: () => { setShowMenuModal(false); setShowDatePlannerModal(true); } },
                { icon: '💡', label: 'Date Ideas', onPress: () => { setShowMenuModal(false); setShowDateIdeasModal(true); } },
                { icon: '💬', label: 'Conversation Starters', onPress: () => { setShowMenuModal(false); setShowStartersModal(true); } },
                { icon: '📝', label: 'Match Notes', onPress: () => { setShowMenuModal(false); setShowNoteModal(true); } },
                { icon: '📌', label: 'Pinned Messages', onPress: () => { setShowMenuModal(false); setShowPinnedMessages(true); } },
                { icon: '⏱️', label: 'Disappearing Messages', onPress: () => { setShowMenuModal(false); setShowDisappearingModal(true); } },
                { icon: '⚙️', label: 'Chat Settings', onPress: () => { setShowMenuModal(false); setShowSettingsModal(true); } },
                { icon: '🚨', label: 'Report User', onPress: () => { setShowMenuModal(false); handleReport(); }, destructive: true },
                { icon: '🚫', label: 'Block User', onPress: () => { setShowMenuModal(false); handleBlock(); }, destructive: true },
                { icon: '💔', label: 'Unmatch', onPress: () => { setShowMenuModal(false); handleUnmatch(); }, destructive: true },
              ].map((item, index) => (
                <TouchableOpacity key={index} style={styles.menuItem} onPress={item.onPress}>
                  <Text style={styles.menuItemIcon}>{item.icon}</Text>
                  <Text style={[styles.menuItemText, item.destructive && styles.menuItemTextDestructive]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.menuCancelButton} onPress={() => setShowMenuModal(false)}>
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Message Options Modal */}
      <Modal visible={showMessageOptionsModal} transparent animationType="fade" onRequestClose={() => setShowMessageOptionsModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowMessageOptionsModal(false)}>
          <View style={styles.messageOptionsContainer}>
            <TouchableOpacity style={styles.messageOption} onPress={() => handleMessageAction('react')}>
              <Text style={styles.messageOptionIcon}>❤️</Text>
              <Text style={styles.messageOptionText}>React</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.messageOption} onPress={() => handleMessageAction('translate')}>
              <Text style={styles.messageOptionIcon}>🌐</Text>
              <Text style={styles.messageOptionText}>Translate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.messageOption} onPress={() => handleMessageAction('pin')}>
              <Text style={styles.messageOptionIcon}>📌</Text>
              <Text style={styles.messageOptionText}>
                {selectedMessage && pinnedMessages.some((p) => p.messageId === selectedMessage.id) ? 'Unpin' : 'Pin'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Reaction Picker Modal */}
      <Modal visible={showReactionPicker} transparent animationType="fade" onRequestClose={() => setShowReactionPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowReactionPicker(false)}>
          <View style={styles.reactionPicker}>
            {REACTION_EMOJIS.map((emoji, index) => (
              <TouchableOpacity key={index} style={styles.reactionPickerItem} onPress={() => handleReaction(emoji)}>
                <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* GIF Picker Modal */}
      <Modal visible={showGifPicker} animationType="slide" onRequestClose={() => setShowGifPicker(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowGifPicker(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>🎬 Send a GIF</Text>
            <View style={{ width: 30 }} />
          </View>
          <View style={styles.gifSearchContainer}>
            <TextInput
              style={styles.gifSearchInput}
              placeholder="Search GIFs..."
              placeholderTextColor="#666"
              value={gifSearchQuery}
              onChangeText={handleGifSearchInput}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gifCategories}>
            {GIF_CATEGORIES.map((category, index) => (
              <TouchableOpacity key={index} style={styles.gifCategoryButton} onPress={() => handleGifCategoryPress(category.query)}>
                <Text style={styles.gifCategoryText}>{category.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {loadingGifs ? (
            <View style={styles.gifLoading}>
              <ActivityIndicator size="large" color="#53a8b6" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.gifResults}>
              {gifResults.map((gif) => (
                <TouchableOpacity key={gif.id} style={styles.gifItem} onPress={() => sendGif(gif)}>
                  <Image source={{ uri: gif.previewUrl }} style={styles.gifImage} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <View style={styles.gifFooter}>
            <Text style={styles.gifPoweredBy}>Powered by GIPHY</Text>
          </View>
        </View>
      </Modal>

      {/* Pinned Messages Modal */}
      <Modal visible={showPinnedMessages} animationType="slide" onRequestClose={() => setShowPinnedMessages(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowPinnedMessages(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>📌 Pinned Messages</Text>
            <View style={{ width: 30 }} />
          </View>
          <ScrollView style={styles.modalContent}>
            {pinnedMessages.length === 0 ? (
              <Text style={styles.emptyModalText}>No pinned messages yet</Text>
            ) : (
              pinnedMessages.map((pinned, index) => (
                <View key={index} style={styles.pinnedMessageCard}>
                  <Text style={styles.pinnedMessageText}>{pinned.text}</Text>
                  <TouchableOpacity style={styles.unpinButton} onPress={() => handleUnpinMessage(pinned.messageId)}>
                    <Text style={styles.unpinButtonText}>Unpin</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Disappearing Messages Modal */}
      <Modal visible={showDisappearingModal} animationType="slide" onRequestClose={() => setShowDisappearingModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDisappearingModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>⏱️ Disappearing Messages</Text>
            <View style={{ width: 30 }} />
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.modalInfo}>Messages will automatically delete after the selected time period.</Text>
            {(['off', '24h', '7d', '30d'] as DisappearingMode[]).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.optionItem, disappearingMode === mode && styles.optionItemActive]}
                onPress={() => handleSetDisappearing(mode)}
              >
                <Text style={[styles.optionItemText, disappearingMode === mode && styles.optionItemTextActive]}>
                  {getDisappearingLabel(mode)}
                </Text>
                {disappearingMode === mode && <Text style={styles.optionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Chat Settings Modal */}
      <Modal visible={showSettingsModal} animationType="slide" onRequestClose={() => setShowSettingsModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowSettingsModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>⚙️ Chat Settings</Text>
            <View style={{ width: 30 }} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.sectionTitle}>Wallpaper</Text>
            <View style={styles.wallpaperGrid}>
              {CHAT_WALLPAPERS.map((wallpaper) => (
                <TouchableOpacity
                  key={wallpaper.id}
                  style={[
                    styles.wallpaperOption,
                    { backgroundColor: 'gradient' in wallpaper ? wallpaper.gradient[0] : wallpaper.color },
                    chatSettings?.wallpaper === wallpaper.id && styles.wallpaperOptionActive,
                  ]}
                  onPress={async () => {
                    await updateChatSettings(chatId, { wallpaper: wallpaper.id });
                    setChatSettings({ ...chatSettings!, wallpaper: wallpaper.id });
                  }}
                >
                  <Text style={styles.wallpaperName}>{wallpaper.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.sectionTitle}>Privacy</Text>
            <TouchableOpacity
              style={styles.toggleItem}
              onPress={async () => {
                const newValue = !chatSettings?.readReceiptsEnabled;
                await updateChatSettings(chatId, { readReceiptsEnabled: newValue });
                setChatSettings({ ...chatSettings!, readReceiptsEnabled: newValue });
              }}
            >
              <Text style={styles.toggleText}>Read Receipts</Text>
              <View style={[styles.toggleSwitch, chatSettings?.readReceiptsEnabled && styles.toggleSwitchActive]}>
                <View style={[styles.toggleKnob, chatSettings?.readReceiptsEnabled && styles.toggleKnobActive]} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toggleItem}
              onPress={async () => {
                const newValue = !chatSettings?.typingIndicatorsEnabled;
                await updateChatSettings(chatId, { typingIndicatorsEnabled: newValue });
                setChatSettings({ ...chatSettings!, typingIndicatorsEnabled: newValue });
              }}
            >
              <Text style={styles.toggleText}>Typing Indicators</Text>
              <View style={[styles.toggleSwitch, chatSettings?.typingIndicatorsEnabled && styles.toggleSwitchActive]}>
                <View style={[styles.toggleKnob, chatSettings?.typingIndicatorsEnabled && styles.toggleKnobActive]} />
              </View>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Match Notes Modal */}
      <Modal visible={showNoteModal} animationType="slide" onRequestClose={() => setShowNoteModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowNoteModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>📝 Note about {matchName}</Text>
            <View style={{ width: 30 }} />
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.modalInfo}>Private notes only you can see.</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="Add notes about this match..."
              placeholderTextColor="#666"
              value={matchNote}
              onChangeText={setMatchNote}
              multiline
              maxLength={500}
            />
            <Text style={styles.charCount}>{matchNote.length}/500</Text>
            <TouchableOpacity
              style={[styles.primaryButton, savingNote && styles.primaryButtonDisabled]}
              onPress={handleSaveNote}
              disabled={savingNote}
            >
              <Text style={styles.primaryButtonText}>{savingNote ? 'Saving...' : '💾 Save Note'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Conversation Starters Modal */}
      <Modal visible={showStartersModal} animationType="slide" onRequestClose={() => setShowStartersModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowStartersModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>💬 Conversation Starters</Text>
            <View style={{ width: 30 }} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalInfo}>Tap a starter to use it as your message!</Text>
            {conversationStarters.map((starter, index) => (
              <TouchableOpacity
                key={index}
                style={styles.starterCard}
                onPress={() => { setNewMessage(starter); setShowStartersModal(false); }}
              >
                <Text style={styles.starterText}>{starter}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Date Ideas Modal */}
      <Modal visible={showDateIdeasModal} animationType="slide" onRequestClose={() => setShowDateIdeasModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDateIdeasModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>💡 Date Ideas</Text>
            <View style={{ width: 30 }} />
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalInfo}>AI-generated date ideas based on your profiles!</Text>
            {dateIdeas.map((idea, index) => (
              <TouchableOpacity
                key={index}
                style={styles.dateIdeaCard}
                onPress={() => {
                  setNewMessage(`How about this for our date? 💕\n\n${idea.idea}\n\nVibe: ${idea.vibe}`);
                  setShowDateIdeasModal(false);
                }}
              >
                <Text style={styles.dateIdeaText}>{idea.idea}</Text>
                <View style={styles.dateIdeaVibe}>
                  <Text style={styles.dateIdeaVibeLabel}>Vibe: </Text>
                  <Text style={styles.dateIdeaVibeValue}>{idea.vibe}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Date Planner Modal */}
      <Modal visible={showDatePlannerModal} animationType="slide" onRequestClose={() => setShowDatePlannerModal(false)}>
        <View style={styles.fullModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDatePlannerModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>📍 Plan a Date</Text>
            <View style={{ width: 30 }} />
          </View>
          <View style={styles.modalContent}>
            {!myLocation || !matchData?.location ? (
              <Text style={styles.errorText}>Location data not available for both users.</Text>
            ) : (
              <>
                <Text style={styles.modalInfo}>Find places between you and {matchName}</Text>
                {loadingPlaces ? (
                  <View style={styles.loadingCenter}>
                    <ActivityIndicator size="large" color="#53a8b6" />
                    <Text style={styles.loadingText}>Finding places...</Text>
                  </View>
                ) : dateSuggestions.length === 0 ? (
                  <TouchableOpacity style={styles.primaryButton} onPress={findDatePlaces}>
                    <Text style={styles.primaryButtonText}>🔍 Find Places</Text>
                  </TouchableOpacity>
                ) : (
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
                          <TouchableOpacity style={styles.placeActionButton} onPress={() => sharePlace(place)}>
                            <Text style={styles.placeActionText}>💬 Share</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.placeActionButton} onPress={() => openInMaps(place)}>
                            <Text style={styles.placeActionText}>🗺️ Maps</Text>
                          </TouchableOpacity>
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

      {/* Video Call Prompt Modal */}
      <Modal visible={showVideoCallPrompt} transparent animationType="fade" onRequestClose={() => setShowVideoCallPrompt(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.promptContainer}>
            <Text style={styles.promptTitle}>
              {callType === 'video' ? '📹' : '📞'} Start {callType === 'video' ? 'Video' : 'Audio'} Call?
            </Text>
            <Text style={styles.promptText}>
              {`You're about to start a ${callType} call with ${matchName}.\n\nA secure link will be sent in the chat.`}
            </Text>
            <View style={styles.promptButtons}>
              <TouchableOpacity style={styles.promptCancelButton} onPress={() => setShowVideoCallPrompt(false)}>
                <Text style={styles.promptCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.promptConfirmButton} onPress={startCall}>
                <Text style={styles.promptConfirmText}>Start Call</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report Modal (cross-platform replacement for Alert.prompt) */}
      <Modal visible={showReportModal} transparent animationType="fade" onRequestClose={() => setShowReportModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.promptContainer}>
            <Text style={styles.promptTitle}>🚨 Report {matchName}</Text>
            <Text style={styles.promptText}>Why are you reporting this user?</Text>
            <TextInput
              style={[styles.noteInput, { height: 100 }]}
              placeholder="Describe the issue..."
              placeholderTextColor="#666"
              value={reportReason}
              onChangeText={setReportReason}
              multiline
              maxLength={500}
            />
            <View style={[styles.promptButtons, { marginTop: 15 }]}>
              <TouchableOpacity style={styles.promptCancelButton} onPress={() => setShowReportModal(false)}>
                <Text style={styles.promptCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.promptConfirmButton, { backgroundColor: '#d9534f' }]}
                onPress={submitReport}
              >
                <Text style={styles.promptConfirmText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Image Preview Modal */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.imagePreviewModal}>
          <TouchableOpacity style={styles.closePreviewButton} onPress={() => setPreviewImage(null)}>
            <Text style={styles.closePreviewText}>✕</Text>
          </TouchableOpacity>
          {previewImage && (
            <Image source={{ uri: previewImage }} style={styles.previewImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ============ STYLES ============
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    paddingTop: 50,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  backButtonContainer: { width: 70 },
  backButton: { color: '#53a8b6', fontSize: 16 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  verifiedBadge: { color: '#3498db', fontSize: 16, fontWeight: 'bold' },
  headerAgeBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, marginTop: 4 },
  headerAgeBadgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  disappearingIndicator: { color: '#e67e22', fontSize: 10, marginTop: 2 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5cb85c', marginRight: 4 },
  onlineText: { color: '#5cb85c', fontSize: 11 },
  lastSeenText: { color: '#888', fontSize: 11, marginTop: 2 },
  typingText: { color: '#53a8b6', fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  menuButton: { width: 70, alignItems: 'flex-end', padding: 5 },
  menuButtonText: { fontSize: 24, color: '#888', fontWeight: 'bold' },

  // Quick Actions
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 10,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  quickActionButton: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  quickActionText: { fontSize: 18 },

  // Pinned Bar
  pinnedBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f3460', padding: 10, gap: 10 },
  pinnedBarIcon: { fontSize: 16 },
  pinnedBarText: { flex: 1, color: '#aaa', fontSize: 13 },
  pinnedBarCount: { color: '#53a8b6', fontSize: 12 },

  // Rating Banner
  ratingBanner: {
    backgroundColor: '#e67e22',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    paddingHorizontal: 15,
  },
  ratingBannerContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  ratingBannerIcon: { fontSize: 24, marginRight: 12 },
  ratingBannerTextContainer: { flex: 1 },
  ratingBannerTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  ratingBannerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 },
  ratingBannerArrow: { color: '#fff', fontSize: 20, fontWeight: 'bold' },

  // Loading & Empty
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', fontSize: 16, marginTop: 15 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyIcon: { fontSize: 50, marginBottom: 15 },
  emptyText: { color: '#888', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 20 },
  starterPromptButton: { backgroundColor: '#0f3460', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 20 },
  starterPromptText: { color: '#53a8b6', fontSize: 14, fontWeight: '600' },

  // Messages
  messagesList: { padding: 15 },
  messageBubble: { maxWidth: '75%', padding: 12, borderRadius: 18, marginBottom: 10 },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#53a8b6', borderBottomRightRadius: 4 },
  theirMessage: { alignSelf: 'flex-start', backgroundColor: '#16213e', borderBottomLeftRadius: 4 },
  pinnedIndicator: { marginBottom: 5 },
  pinnedIndicatorText: { color: '#e67e22', fontSize: 10, fontWeight: '600' },
  messageImage: { width: 200, height: 200, borderRadius: 12, marginBottom: 8 },
  gifBadge: { position: 'absolute', top: 5, right: 5, backgroundColor: '#9b59b6', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8 },
  gifBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },

  // Voice
  voiceMessageContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  voicePlayButton: { fontSize: 24 },
  voiceWaveform: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  voiceBar: { width: 3, borderRadius: 2 },
  voiceDuration: { color: '#888', fontSize: 12 },
  voiceDurationMe: { color: 'rgba(255,255,255,0.7)' },

  // Text
  messageText: { color: '#eee', fontSize: 16, lineHeight: 22 },
  myMessageText: { color: '#fff' },
  translationContainer: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' },
  translationLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginBottom: 4 },
  translatedText: { fontStyle: 'italic' },
  translatingIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  translatingText: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },

  // Reactions
  reactionsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  reactionBubble: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, gap: 4 },
  reactionBubbleActive: { backgroundColor: 'rgba(83,168,182,0.4)' },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { color: '#fff', fontSize: 11 },

  // Footer
  messageFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  messageTime: { color: '#888', fontSize: 11 },
  myMessageTime: { color: 'rgba(255,255,255,0.7)' },
  readReceipt: { color: 'rgba(255,255,255,0.7)', fontSize: 11 },

  // Typing
  typingIndicatorContainer: { paddingHorizontal: 15, paddingBottom: 5 },
  typingBubble: { alignSelf: 'flex-start', backgroundColor: '#16213e', borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: 16, paddingVertical: 12 },
  typingDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#888' },
  typingDot1: { opacity: 0.4 },
  typingDot2: { opacity: 0.7 },
  typingDot3: { opacity: 1 },

  // Upload & Recording
  uploadingContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#16213e' },
  uploadingText: { color: '#53a8b6', marginLeft: 10, fontSize: 14 },
  recordingContainer: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#d9534f', gap: 10 },
  recordingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' },
  recordingText: { color: '#fff', fontSize: 16, flex: 1 },
  cancelRecordButton: { backgroundColor: 'rgba(255,255,255,0.3)', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  cancelRecordText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  stopRecordButton: { backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20 },
  stopRecordText: { color: '#d9534f', fontSize: 14, fontWeight: '600' },

  // Input
  inputContainer: { flexDirection: 'row', padding: 15, backgroundColor: '#16213e', borderTopWidth: 1, borderTopColor: '#0f3460', alignItems: 'flex-end' },
  mediaButton: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  mediaButtonText: { fontSize: 22 },
  gifButton: { backgroundColor: '#9b59b6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, marginRight: 4, justifyContent: 'center' },
  gifButtonText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  input: { flex: 1, backgroundColor: '#1a1a2e', color: '#fff', padding: 12, paddingTop: 12, borderRadius: 20, fontSize: 16, marginRight: 10, maxHeight: 100 },
  sendButton: { backgroundColor: '#53a8b6', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 20, justifyContent: 'center' },
  sendButtonDisabled: { backgroundColor: '#555' },
  sendButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Modal Overlay
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },

  // Menu
  menuContainer: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 30, width: '100%', position: 'absolute', bottom: 0, maxHeight: '80%' },
  menuTitle: { color: '#888', fontSize: 14, textAlign: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  menuItemIcon: { fontSize: 20, marginRight: 12 },
  menuItemText: { color: '#eee', fontSize: 16 },
  menuItemTextDestructive: { color: '#d9534f' },
  menuCancelButton: { marginTop: 10, marginHorizontal: 15, padding: 16, backgroundColor: '#16213e', borderRadius: 12, alignItems: 'center' },
  menuCancelText: { color: '#53a8b6', fontSize: 16, fontWeight: '600' },

  // Message Options
  messageOptionsContainer: { backgroundColor: '#16213e', borderRadius: 20, padding: 10, flexDirection: 'row', gap: 15 },
  messageOption: { alignItems: 'center', padding: 10 },
  messageOptionIcon: { fontSize: 24, marginBottom: 4 },
  messageOptionText: { color: '#eee', fontSize: 12 },

  // Reaction Picker
  reactionPicker: { flexDirection: 'row', backgroundColor: '#16213e', borderRadius: 30, padding: 10, gap: 8 },
  reactionPickerItem: { padding: 8 },
  reactionPickerEmoji: { fontSize: 28 },

  // Full Modal
  fullModal: { flex: 1, backgroundColor: '#1a1a2e' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  modalClose: { fontSize: 24, color: '#d9534f', fontWeight: 'bold' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#eee' },
  modalContent: { flex: 1, padding: 20 },
  modalInfo: { color: '#888', fontSize: 14, marginBottom: 20, lineHeight: 20 },
  emptyModalText: { color: '#888', fontSize: 16, textAlign: 'center', marginTop: 50 },

  // GIF
  gifSearchContainer: { padding: 15, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  gifSearchInput: { backgroundColor: '#1a1a2e', color: '#fff', padding: 12, borderRadius: 10, fontSize: 16 },
  gifCategories: { maxHeight: 50, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 15 },
  gifCategoryButton: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 15, marginRight: 8 },
  gifCategoryText: { color: '#9b59b6', fontSize: 13, fontWeight: '600' },
  gifLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  gifResults: { padding: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gifItem: { width: '48%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#16213e' },
  gifImage: { width: '100%', height: '100%' },
  gifFooter: { padding: 15, backgroundColor: '#16213e', borderTopWidth: 1, borderTopColor: '#0f3460', alignItems: 'center' },
  gifPoweredBy: { color: '#666', fontSize: 12 },

  // Pinned Messages
  pinnedMessageCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 15, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
  pinnedMessageText: { flex: 1, color: '#eee', fontSize: 14 },
  unpinButton: { backgroundColor: '#d9534f', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15 },
  unpinButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Options
  optionItem: { backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  optionItemActive: { backgroundColor: '#0f3460', borderWidth: 2, borderColor: '#53a8b6' },
  optionItemText: { color: '#eee', fontSize: 16 },
  optionItemTextActive: { color: '#53a8b6', fontWeight: '600' },
  optionCheck: { color: '#53a8b6', fontSize: 18 },

  // Section
  sectionTitle: { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 15 },

  // Wallpaper
  wallpaperGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wallpaperOption: { width: '30%', aspectRatio: 1, borderRadius: 12, justifyContent: 'flex-end', padding: 8 },
  wallpaperOptionActive: { borderWidth: 3, borderColor: '#53a8b6' },
  wallpaperName: { color: '#fff', fontSize: 10, fontWeight: '600' },

  // Toggle
  toggleItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 10 },
  toggleText: { color: '#eee', fontSize: 16 },
  toggleSwitch: { width: 50, height: 28, borderRadius: 14, backgroundColor: '#555', padding: 2 },
  toggleSwitchActive: { backgroundColor: '#53a8b6' },
  toggleKnob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  toggleKnobActive: { marginLeft: 22 },

  // Note
  noteInput: { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 12, fontSize: 16, height: 150, textAlignVertical: 'top' },
  charCount: { color: '#666', fontSize: 12, textAlign: 'right', marginTop: 5 },

  // Primary Button
  primaryButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 20 },
  primaryButtonDisabled: { backgroundColor: '#555' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Starters
  starterCard: { backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 12 },
  starterText: { color: '#eee', fontSize: 15, lineHeight: 22 },

  // Date Ideas
  dateIdeaCard: { backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 12 },
  dateIdeaText: { color: '#eee', fontSize: 15, lineHeight: 22, marginBottom: 8 },
  dateIdeaVibe: { flexDirection: 'row' },
  dateIdeaVibeLabel: { color: '#888', fontSize: 12 },
  dateIdeaVibeValue: { color: '#e67e22', fontSize: 12, fontWeight: '600' },

  // Date Planner
  errorText: { color: '#d9534f', fontSize: 16, textAlign: 'center', marginTop: 50, lineHeight: 24 },
  loadingCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  placeCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#0f3460' },
  placeInfo: { marginBottom: 12 },
  placeName: { color: '#eee', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  placeType: { color: '#e67e22', fontSize: 12, fontWeight: '600', marginBottom: 6, textTransform: 'capitalize' },
  placeAddress: { color: '#888', fontSize: 14, marginBottom: 6 },
  placeDistance: { color: '#53a8b6', fontSize: 13 },
  placeActions: { flexDirection: 'row', gap: 10 },
  placeActionButton: { flex: 1, backgroundColor: '#0f3460', paddingVertical: 10, borderRadius: 20, alignItems: 'center' },
  placeActionText: { color: '#53a8b6', fontSize: 14, fontWeight: '600' },

  // Call Prompt
  promptContainer: { backgroundColor: '#16213e', borderRadius: 20, padding: 25, width: '85%', maxWidth: 400 },
  promptTitle: { fontSize: 22, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 15 },
  promptText: { color: '#aaa', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 25 },
  promptButtons: { flexDirection: 'row', gap: 10 },
  promptCancelButton: { flex: 1, backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  promptCancelText: { color: '#888', fontSize: 16, fontWeight: '600' },
  promptConfirmButton: { flex: 1, backgroundColor: '#5cb85c', paddingVertical: 14, borderRadius: 20, alignItems: 'center' },
  promptConfirmText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Image Preview
  imagePreviewModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  closePreviewButton: { position: 'absolute', top: 50, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  closePreviewText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  previewImage: { width: '90%', height: '70%' },
});