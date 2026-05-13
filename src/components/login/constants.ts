import { I18nManager, Platform } from 'react-native';

export const IS_WEB = Platform.OS === 'web';
export const IS_IOS = Platform.OS === 'ios';
export const IS_RTL = I18nManager.isRTL;

export const ROUTES = { HOME: '/home' as const, SIGNUP: '/signup' as const };

export const SUCCESS_NAV_DELAY_MS  = 1000;
export const LOCKOUT_DURATION_MS   = 60_000;
export const RESIZE_DEBOUNCE_MS    = 150;
export const FOCUS_RETURN_DELAY_MS = 100;
export const RATE_LIMIT_WINDOW_MS  = 60_000;

export const EMAIL_REGEX         = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LENGTH    = 254;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_LOGIN_ATTEMPTS  = 5;
export const MAX_RESEND_ATTEMPTS = 3;
export const MAX_FORGOT_ATTEMPTS = 3;

export const CSS_ID  = 'login-screen-styles';
export const META_ID = 'login-screen-meta';

export const darkTokens = {
  bg:'#07070f', bgGradientStart:'#0a0a18', bgGradientMid:'#0e0e24', bgGradientEnd:'#07070f',
  card:'#111128', cardBorder:'#1e1e48', inputBg:'#0d0d24', inputBorder:'#28285a',
  accent:'#6C63FF', accentSoft:'#8B83FF', accentGlow:'rgba(108,99,255,0.10)', accentGlowStrong:'rgba(108,99,255,0.22)',
  error:'#FF6B6B', errorGlow:'rgba(255,107,107,0.07)', warn:'#FFB347', success:'#51CF66', successGlow:'rgba(81,207,102,0.07)',
  textPrimary:'#EDEDFF', textSecondary:'#9494B8', textMuted:'#64648a', white:'#ffffff', overlay:'rgba(4,4,12,0.92)',
  separator:'#1e1e48', buttonGradStart:'#7B73FF', buttonGradEnd:'#5A4FE6', disabledBg:'#181834', disabledText:'#40406a',
  inputShadow:'#6C63FF', logoBorder:'#28285a', autofillBg:'#0d0d24', autofillText:'#EDEDFF', autofillCaret:'#6C63FF',
} as const;

export const lightTokens = {
  bg:'#F0F2F8', bgGradientStart:'#E8EAF4', bgGradientMid:'#E0E3F0', bgGradientEnd:'#F0F2F8',
  card:'#FFFFFF', cardBorder:'#D4D8E8', inputBg:'#F4F5FC', inputBorder:'#C8CCE0',
  accent:'#5B52E0', accentSoft:'#7A72F0', accentGlow:'rgba(91,82,224,0.08)', accentGlowStrong:'rgba(91,82,224,0.16)',
  error:'#DC3545', errorGlow:'rgba(220,53,69,0.05)', warn:'#D4880F', success:'#2F9E44', successGlow:'rgba(47,158,68,0.05)',
  textPrimary:'#10102A', textSecondary:'#4E4E6E', textMuted:'#8080A0', white:'#ffffff', overlay:'rgba(220,224,240,0.92)',
  separator:'#D4D8E8', buttonGradStart:'#6C63FF', buttonGradEnd:'#4A42CC', disabledBg:'#D0D4E4', disabledText:'#9898B4',
  inputShadow:'#5B52E0', logoBorder:'#D4D8E8', autofillBg:'#F4F5FC', autofillText:'#10102A', autofillCaret:'#5B52E0',
} as const;

export type Tokens = typeof darkTokens;

export const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential':     'Invalid email or password. Please try again.',
  'auth/user-not-found':         'Invalid email or password. Please try again.',
  'auth/wrong-password':         'Invalid email or password. Please try again.',
  'auth/too-many-requests':      'Too many failed attempts. Please wait or reset your password.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/user-disabled':          'This account has been disabled. Please contact support.',
  'auth/invalid-email':          'Please enter a valid email address.',
};