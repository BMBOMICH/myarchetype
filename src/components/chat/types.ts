import type { DocumentSnapshot } from 'firebase/firestore';

export type MatchData = {
  id: string;
  name: string;
  age: number;
  photo: string;
  isOnline: boolean;
  lastSeen: Date | null;
  verified: boolean;
  premium: boolean;
};

export type MessageReaction = { emoji: string; userIds: string[] }[];

export type Message = {
  id: string;
  senderId: string;
  text?: string;
  timestamp: Date | null;
  read: boolean;
  type: 'text' | 'image' | 'gif' | 'voice' | 'system';
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaSizeBytes?: number;
  reactions?: MessageReaction;
  pinned?: boolean;
  translatedText?: string;
  isTranslating?: boolean;
  voiceDuration?: number;
  voiceWaveform?: number[];
  encryptedMediaKey?: string;
  mediaKeyNonce?: string;
  mediaCipherNonce?: string;
  version?: number;
  ciphertext?: string;
  nonce?: string;
  senderPublicKey?: string;
  senderKeyVersion?: number;
  isGif?: boolean;
};

export type ChatCoreState = {
  messages: Message[];
  inputText: string;
  loading: boolean;
  sending: boolean;
  uploadingMedia: boolean;
  recordingAudio: boolean;
  recordingDuration: number;
  showMenu: boolean;
  showEmojiPicker: boolean;
  showGifPicker: boolean;
  gifSearchQuery: string;
  gifResults: unknown[];
  loadingGifs: boolean;
  showPinned: boolean;
  showOptions: boolean;
  showReactionPicker: boolean;
  selectedMessageId: string | null;
  showReport: boolean;
  reportReason: string;
  submittingReport: boolean;
  showVideoPrompt: boolean;
  callType: 'video' | 'audio';
  noteText: string;
  showNote: boolean;
  savingNote: boolean;
  previewImage: string | null;
  matchData: MatchData | null;
  hasMore: boolean;
  lastDoc: DocumentSnapshot | null;
  loadingMore: boolean;
  disappearingEnabled: boolean;
  wallpaper: string | null;
  translationEnabled: boolean;
  showDateIdeas: boolean;
  dateIdeas: { text: string; vibe: string }[];
  loadingDateIdeas: boolean;
  showNearby: boolean;
  nearbyPlaces: unknown[];
  loadingNearby: boolean;
};

export type ChatCoreAction =
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
  | { type: 'SET_GIF_RESULTS'; payload: unknown[] }
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
  | { type: 'SET_NEARBY'; payload: unknown[] }
  | { type: 'SET_LOADING_NEARBY'; payload: boolean }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; changes: Partial<Message> } }
  | { type: 'INCREMENT_DURATION' }
  | { type: 'RESET' };

export type TypingState = { isTyping: boolean; theirTyping: boolean };