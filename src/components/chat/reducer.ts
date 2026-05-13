import { ChatCoreAction, ChatCoreState } from './types';

export const initialCore: ChatCoreState = {
  messages: [],
  inputText: '',
  loading: true,
  sending: false,
  uploadingMedia: false,
  recordingAudio: false,
  recordingDuration: 0,
  showMenu: false,
  showEmojiPicker: false,
  showGifPicker: false,
  gifSearchQuery: '',
  gifResults: [],
  loadingGifs: false,
  showPinned: false,
  showOptions: false,
  showReactionPicker: false,
  selectedMessageId: null,
  showReport: false,
  reportReason: '',
  submittingReport: false,
  showVideoPrompt: false,
  callType: 'video',
  noteText: '',
  showNote: false,
  savingNote: false,
  previewImage: null,
  matchData: null,
  hasMore: false,
  lastDoc: null,
  loadingMore: false,
  disappearingEnabled: false,
  wallpaper: null,
  translationEnabled: false,
  showDateIdeas: false,
  dateIdeas: [],
  loadingDateIdeas: false,
  showNearby: false,
  nearbyPlaces: [],
  loadingNearby: false,
};

export function coreReducer(state: ChatCoreState, action: ChatCoreAction): ChatCoreState {
  switch (action.type) {
    case 'SET_MESSAGES': return { ...state, messages: action.payload };
    case 'ADD_MESSAGES_TOP': return { ...state, messages: [...action.payload, ...state.messages] };
    case 'SET_INPUT': return { ...state, inputText: action.payload };
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_SENDING': return { ...state, sending: action.payload };
    case 'SET_UPLOADING': return { ...state, uploadingMedia: action.payload };
    case 'SET_RECORDING': return { ...state, recordingAudio: action.payload };
    case 'SET_RECORDING_DURATION': return { ...state, recordingDuration: action.payload };
    case 'INCREMENT_DURATION': return { ...state, recordingDuration: state.recordingDuration + 1 };
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
      return { ...state, messages: state.messages.map((m) => (m.id === id ? { ...m, ...changes } : m)) };
    }
    case 'RESET': return { ...initialCore };
    default: return state;
  }
}