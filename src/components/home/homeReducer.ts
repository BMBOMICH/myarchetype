import type { HomeState, HomeAction } from './types';

export const initialState: HomeState = {
  loading: true, refreshing: false, error: null, userData: null,
  loginStreak: 0, longestStreak: 0, profileStrength: null,
  showDailyQuestion: false, isOnline: true, loggingOut: false,
  authReady: false, userId: null, userEmail: null,
};

export function homeReducer(state: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case 'SET_LOADING':          return { ...state, loading:           action.payload };
    case 'SET_REFRESHING':       return { ...state, refreshing:        action.payload };
    case 'SET_ERROR':            return { ...state, error:             action.payload, loading: false };
    case 'SET_USER_DATA':        return { ...state, userData:          action.payload, error: null };
    case 'SET_STREAK':           return { ...state, loginStreak:       action.payload.current, longestStreak: action.payload.longest };
    case 'SET_PROFILE_STRENGTH': return { ...state, profileStrength:   action.payload };
    case 'SET_DAILY_QUESTION':   return { ...state, showDailyQuestion: action.payload };
    case 'SET_ONLINE':           return { ...state, isOnline:          action.payload };
    case 'SET_LOGGING_OUT':      return { ...state, loggingOut:        action.payload };
    case 'SET_AUTH':             return { ...state, authReady: action.payload.ready, userId: action.payload.userId, userEmail: action.payload.email };
    case 'RESET':                return initialState;
    default:                     return state;
  }
}