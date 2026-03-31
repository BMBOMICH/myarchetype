// signup.tsx - fixed file

import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, Appearance, AppState,
  BackHandler, Dimensions, I18nManager, InteractionManager, Keyboard, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View,
  type AlertButton, type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { validateDateOfBirth } from '../utils/ageVerification';
import { logConsent, logPrivacyAccepted, logTermsAccepted, writeAuditLog } from '../utils/logger';
import { validateDisplayName } from '../utils/nameValidation';
import { checkUserBanned, trackAccountCreation } from '../utils/rateLimiter';

const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';
const IS_RTL = I18nManager.isRTL;
const nativeDriver = !IS_WEB;

const ROUTES = { LOGIN: '/login' as const, TERMS: '/terms' as const, PRIVACY: '/privacy' as const };
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SPECIAL_CHARS_REGEX = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const MAX_SIGNUP_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60_000;
const SUCCESS_NAV_DELAY_MS = 1200;
const RESIZE_DEBOUNCE_MS = 150;
const FOCUS_DELAY_MS = 100;
const MIN_EMAIL_DISPLAY = 3;

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','throwaway.email','yopmail.com','trashmail.com',
  'sharklasers.com','guerrillamailblock.com','grr.la','guerrillamail.info','guerrillamail.biz',
  'guerrillamail.de','guerrillamail.net','guerrillamail.org','spam4.me','10minutemail.com',
  'dispostable.com','fakeinbox.com','maildrop.cc','mailnull.com','spamgourmet.com',
  'spamgourmet.net','spamgourmet.org','binkmail.com','bobmail.info','devnullmail.com','trbvm.com',
  'trashmail.at','trashmail.io','trashmail.me','trashmail.net','discard.email','discardmail.com',
  'discardmail.de','spambox.us','inboxalias.com','tempinbox.com','spamfree24.org','hulapla.de',
]);

const darkTokens = {
  bg:'#07070f', bgGradientStart:'#0a0a18', bgGradientMid:'#0e0e24', bgGradientEnd:'#07070f',
  card:'#111128', cardBorder:'#1e1e48', inputBg:'#0d0d24', inputBorder:'#28285a',
  accent:'#6C63FF', accentSoft:'#8B83FF', accentGlow:'rgba(108,99,255,0.10)', accentGlowStrong:'rgba(108,99,255,0.22)',
  error:'#FF6B6B', errorGlow:'rgba(255,107,107,0.07)', warn:'#FFB347', success:'#51CF66', successGlow:'rgba(81,207,102,0.07)',
  textPrimary:'#EDEDFF', textSecondary:'#9494B8', textMuted:'#64648a', white:'#ffffff', overlay:'rgba(4,4,12,0.92)',
  separator:'#1e1e48', buttonGradStart:'#7B73FF', buttonGradEnd:'#5A4FE6', disabledBg:'#181834', disabledText:'#40406a',
  inputShadow:'#6C63FF', logoBorder:'#28285a', autofillBg:'#0d0d24', autofillText:'#EDEDFF', autofillCaret:'#6C63FF',
  strengthWeak:'#FF6B6B', strengthFair:'#FFB347', strengthGood:'#6C63FF', strengthStrong:'#51CF66', requirementsBg:'#0b0b20',
} as const;

const lightTokens = {
  bg:'#F0F2F8', bgGradientStart:'#E8EAF4', bgGradientMid:'#E0E3F0', bgGradientEnd:'#F0F2F8',
  card:'#FFFFFF', cardBorder:'#D4D8E8', inputBg:'#F4F5FC', inputBorder:'#C8CCE0',
  accent:'#5B52E0', accentSoft:'#7A72F0', accentGlow:'rgba(91,82,224,0.08)', accentGlowStrong:'rgba(91,82,224,0.16)',
  error:'#DC3545', errorGlow:'rgba(220,53,69,0.05)', warn:'#D4880F', success:'#2F9E44', successGlow:'rgba(47,158,68,0.05)',
  textPrimary:'#10102A', textSecondary:'#4E4E6E', textMuted:'#8080A0', white:'#ffffff', overlay:'rgba(220,224,240,0.92)',
  separator:'#D4D8E8', buttonGradStart:'#6C63FF', buttonGradEnd:'#4A42CC', disabledBg:'#D0D4E4', disabledText:'#9898B4',
  inputShadow:'#5B52E0', logoBorder:'#D4D8E8', autofillBg:'#F4F5FC', autofillText:'#10102A', autofillCaret:'#5B52E0',
  strengthWeak:'#DC3545', strengthFair:'#D4880F', strengthGood:'#5B52E0', strengthStrong:'#2F9E44', requirementsBg:'#ECECF6',
} as const;

type Tokens = typeof darkTokens;
type ModalConfig = { title: string; message: string; buttons: { label: string; onPress?: () => void | Promise<void>; primary?: boolean }[] };
type FormState = {
  name: string; nameError: string; dob: string; dobError: string;
  email: string; emailError: string; password: string; passwordError: string;
  confirmPassword: string; confirmPasswordError: string;
  showPassword: boolean; showConfirmPassword: boolean;
  nameFocused: boolean; dobFocused: boolean; emailFocused: boolean;
  passwordFocused: boolean; confirmFocused: boolean;
  showRequirements: boolean; loading: boolean; lockoutSeconds: number;
  capsLockOn: boolean; breachedWarning: boolean;
};
type FormAction =
  | { type: 'SET_NAME'; payload: string } | { type: 'SET_NAME_ERROR'; payload: string }
  | { type: 'SET_DOB'; payload: string } | { type: 'SET_DOB_ERROR'; payload: string }
  | { type: 'SET_EMAIL'; payload: string } | { type: 'SET_PASSWORD'; payload: string }
  | { type: 'SET_CONFIRM'; payload: string } | { type: 'SET_EMAIL_ERROR'; payload: string }
  | { type: 'SET_PASSWORD_ERROR'; payload: string } | { type: 'SET_CONFIRM_ERROR'; payload: string }
  | { type: 'TOGGLE_PASSWORD' } | { type: 'TOGGLE_CONFIRM_PASSWORD' } | { type: 'HIDE_PASSWORDS' }
  | { type: 'SET_NAME_FOCUSED'; payload: boolean } | { type: 'SET_DOB_FOCUSED'; payload: boolean }
  | { type: 'SET_EMAIL_FOCUSED'; payload: boolean } | { type: 'SET_PASSWORD_FOCUSED'; payload: boolean }
  | { type: 'SET_CONFIRM_FOCUSED'; payload: boolean } | { type: 'SET_SHOW_REQUIREMENTS'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean } | { type: 'SET_LOCKOUT'; payload: number }
  | { type: 'SET_CAPS_LOCK'; payload: boolean } | { type: 'SET_BREACHED_WARNING'; payload: boolean }
  | { type: 'CLEAR_ERRORS' } | { type: 'WIPE_SENSITIVE' } | { type: 'RESET' };

// ─── Web-only prop types ──────────────────────────────────
type WebAriaProps = {
  'aria-live'?: 'assertive' | 'polite' | 'off';
  'aria-atomic'?: 'true' | 'false';
  id?: string;
  role?: string;
  'aria-modal'?: 'true' | 'false';
  'aria-describedby'?: string;
  'aria-invalid'?: 'true' | 'false';
  'aria-required'?: 'true' | 'false';
};

type WebInputProps = {
  name?: string;
  cursor?: string;
};

type WebStyleProps = {
  outline?: string;
  outlineWidth?: number;
  boxShadow?: string;
  border?: string;
  WebkitTextFillColor?: string;
  caretColor?: string;
  backgroundColor?: string;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  flex?: number;
  fontSize?: number;
  letterSpacing?: number;
  color?: string;
  direction?: 'ltr' | 'rtl';
};

type WebPressableStyle = {
  cursor?: string;
};

const CSS_ID = 'signup-screen-styles';
const META_ID = 'signup-screen-meta';
let injectedTheme: string | null = null;
let prefersReducedMotion = IS_WEB && typeof window !== 'undefined' ? !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches : false;

const ERROR_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'Unable to create account. This email may already be registered.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/weak-password': 'Password is too weak. Please follow the requirements.',
  'auth/operation-not-allowed': 'Signup is currently unavailable. Please try again later.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
};

const initialForm: FormState = {
  name:'', nameError:'', dob:'', dobError:'', email:'', emailError:'',
  password:'', passwordError:'', confirmPassword:'', confirmPasswordError:'',
  showPassword:false, showConfirmPassword:false, nameFocused:false, dobFocused:false,
  emailFocused:false, passwordFocused:false, confirmFocused:false, showRequirements:false,
  loading:false, lockoutSeconds:0, capsLockOn:false, breachedWarning:false,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_NAME': return { ...state, name: action.payload };
    case 'SET_NAME_ERROR': return { ...state, nameError: action.payload };
    case 'SET_DOB': return { ...state, dob: action.payload };
    case 'SET_DOB_ERROR': return { ...state, dobError: action.payload };
    case 'SET_EMAIL': return { ...state, email: action.payload };
    case 'SET_PASSWORD': return { ...state, password: action.payload };
    case 'SET_CONFIRM': return { ...state, confirmPassword: action.payload };
    case 'SET_EMAIL_ERROR': return { ...state, emailError: action.payload };
    case 'SET_PASSWORD_ERROR': return { ...state, passwordError: action.payload };
    case 'SET_CONFIRM_ERROR': return { ...state, confirmPasswordError: action.payload };
    case 'TOGGLE_PASSWORD': return { ...state, showPassword: !state.showPassword };
    case 'TOGGLE_CONFIRM_PASSWORD': return { ...state, showConfirmPassword: !state.showConfirmPassword };
    case 'HIDE_PASSWORDS': return { ...state, showPassword: false, showConfirmPassword: false };
    case 'SET_NAME_FOCUSED': return { ...state, nameFocused: action.payload };
    case 'SET_DOB_FOCUSED': return { ...state, dobFocused: action.payload };
    case 'SET_EMAIL_FOCUSED': return { ...state, emailFocused: action.payload };
    case 'SET_PASSWORD_FOCUSED': return { ...state, passwordFocused: action.payload };
    case 'SET_CONFIRM_FOCUSED': return { ...state, confirmFocused: action.payload };
    case 'SET_SHOW_REQUIREMENTS': return { ...state, showRequirements: action.payload };
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_LOCKOUT': return { ...state, lockoutSeconds: action.payload };
    case 'SET_CAPS_LOCK': return { ...state, capsLockOn: action.payload };
    case 'SET_BREACHED_WARNING': return { ...state, breachedWarning: action.payload };
    case 'CLEAR_ERRORS': return { ...state, nameError:'', dobError:'', emailError:'', passwordError:'', confirmPasswordError:'' };
    case 'WIPE_SENSITIVE': return { ...state, password:'', confirmPassword:'' };
    case 'RESET': return { ...initialForm, email: state.email, name: state.name };
    default: return state;
  }
}

const getErrorMessage = (code?: string) => (code && ERROR_MESSAGES[code]) ?? 'An unexpected error occurred. Please try again.';
const getScreenData = () => { const { width } = Dimensions.get('window'); return { width, isSmall: width < 375 }; };
const getAnimDuration = (ms: number) => (prefersReducedMotion ? 0 : ms);
const isDisposableEmail = (email: string) => DISPOSABLE_DOMAINS.has(email.split('@')[1]?.toLowerCase() ?? '');
const maskEmail = (email: string) => {
  const [l, d] = email.split('@');
  return !l || !d ? email : `${l[0] ?? ''}${'*'.repeat(Math.max(1, Math.min(l.length - 2, 6)))}${l[l.length - 1] ?? ''}@${d}`;
};
const getFirebaseErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;

const debounce = <T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T => {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }) as T;
};

const injectWebStyles = (C: Tokens, theme: string) => {
  if (!IS_WEB || typeof document === 'undefined' || injectedTheme === theme) return;
  injectedTheme = theme;
  document.getElementById(CSS_ID)?.remove();
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
    input:focus,input:focus-visible{outline:none!important;box-shadow:none!important}
    input:-webkit-autofill{-webkit-background-clip:text!important;-webkit-text-fill-color:${C.autofillText}!important;
      transition:background-color 5000s ease-in-out 0s!important;
      box-shadow:inset 0 0 0 1000px ${C.autofillBg}!important;caret-color:${C.autofillCaret}!important}
    @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
    button:focus-visible{outline:2px solid ${C.accent}!important;outline-offset:2px!important}
    @media screen and (max-width:767px){input{font-size:16px!important}}
    [role="button"],[role="link"],[data-pressable]{cursor:pointer}[data-disabled="true"]{cursor:not-allowed!important;pointer-events:none}
    .modal-message{white-space:pre-wrap}
    *::-webkit-scrollbar{width:6px}*::-webkit-scrollbar-thumb{background:${C.inputBorder};border-radius:3px}
  `;
  document.head.appendChild(style);

  if (!document.getElementById(META_ID)) {
    const m = document.createElement('meta');
    m.id = META_ID;
    document.head.appendChild(m);
    document.title = 'Sign Up – MyArchetype';
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport');
      document.head.appendChild(vp);
    }
    vp.setAttribute('content', 'width=device-width,initial-scale=1');
  }
};

const triggerHaptic = async (type: 'success' | 'error' | 'light') => {
  if (IS_WEB) return;
  try {
    if (type === 'success') await import('expo-haptics').then(H => H.notificationAsync(H.NotificationFeedbackType.Success));
    else if (type === 'error') await import('expo-haptics').then(H => H.notificationAsync(H.NotificationFeedbackType.Error));
    else await import('expo-haptics').then(H => H.impactAsync(H.ImpactFeedbackStyle.Light));
  } catch {}
};

const validators = {
  email: (v: string) => {
    if (!v) return 'Email is required';
    if (v.length > MAX_EMAIL_LENGTH) return `Email must be under ${MAX_EMAIL_LENGTH} characters`;
    if (!EMAIL_REGEX.test(v)) return 'Invalid email format';
    if (isDisposableEmail(v)) return 'Disposable email addresses are not allowed.';
    return '';
  },
  password: (v: string) => {
    const checks = {
      length: v.length >= 8, uppercase: /[A-Z]/.test(v), lowercase: /[a-z]/.test(v),
      number: /[0-9]/.test(v), special: SPECIAL_CHARS_REGEX.test(v),
    };
    const errors: string[] = [];
    if (!checks.length) errors.push('At least 8 characters');
    if (!checks.uppercase) errors.push('One uppercase letter (A-Z)');
    if (!checks.lowercase) errors.push('One lowercase letter (a-z)');
    if (!checks.number) errors.push('One number (0-9)');
    if (!checks.special) errors.push('One special character (!@#$%^&*)');
    return { valid: errors.length === 0, errors, checks };
  },
  strength: (v: string, C: Tokens) => {
    let s = 0;
    if (v.length >= 8) s += 20;
    if (v.length >= 12) s += 10;
    if (v.length >= 16) s += 5;
    if (/[A-Z]/.test(v)) s += 20;
    if (/[a-z]/.test(v)) s += 15;
    if (/[0-9]/.test(v)) s += 20;
    if (SPECIAL_CHARS_REGEX.test(v)) s += 15;
    if (/[A-Z].*[A-Z]/.test(v)) s += 5;
    if (/[0-9].*[0-9]/.test(v)) s += 5;
    if (s < 40) return { level: 'Weak', color: C.strengthWeak, percent: s };
    if (s < 60) return { level: 'Fair', color: C.strengthFair, percent: s };
    if (s < 80) return { level: 'Good', color: C.strengthGood, percent: s };
    return { level: 'Strong', color: C.strengthStrong, percent: Math.min(s, 100) };
  },
};

async function checkPasswordBreached(password: string): Promise<boolean> {
  try {
    const sha1 = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, password)).toUpperCase();
    const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return false;
    return (await res.text()).split('\n').some(line => line.trim().startsWith(suffix));
  } catch { return false; }
}

async function getDeviceFingerprint(): Promise<string | null> {
  if (!IS_WEB || typeof navigator === 'undefined' || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx?.fillText('myarchetype-fp', 2, 10);
    const raw = [
      navigator.userAgent,
      navigator.language,
      navigator.platform,
      String(navigator.hardwareConcurrency ?? ''),
      canvas.toDataURL(),
    ].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  } catch { return null; }
}

const buildWebInputStyle = (C: Tokens): WebStyleProps => ({
  outline:'none', outlineWidth:0, boxShadow:'none', border:'none', WebkitTextFillColor:C.textPrimary,
  caretColor:C.accent, backgroundColor:'transparent', paddingTop:18, paddingBottom:18, paddingLeft:4,
  flex:1, fontSize:16, letterSpacing:0.2, color:C.textPrimary, direction: IS_RTL ? 'rtl' : 'ltr',
});

const showNativeAlert = (title: string, message: string, buttons?: AlertButton[]) =>
  Alert.alert(title, message, buttons ?? [{ text: 'OK' }]);

// ─── KeyPress event type ──────────────────────────────────
type KeyPressEvent = {
  nativeEvent?: {
    key?: string;
    getModifierState?: (name: string) => boolean;
  };
};

const AnimatedError = React.memo(({ message, inputId, C }: { message: string; inputId: string; C: Tokens }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-6)).current;

  useEffect(() => {
    if (message) {
      Animated.parallel([
        Animated.spring(opacity, { toValue: 1, useNativeDriver: nativeDriver, speed: 20, bounciness: 0 }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: nativeDriver, speed: 20, bounciness: 4 }),
      ]).start(() => { if (!IS_WEB) AccessibilityInfo.announceForAccessibility(message); });
    } else {
      Animated.timing(opacity, { toValue: 0, duration: getAnimDuration(150), useNativeDriver: nativeDriver }).start();
      translateY.setValue(-6);
    }
  }, [message, opacity, translateY]);

  if (!message) return null;

  const webProps: WebAriaProps = IS_WEB
    ? { 'aria-live': 'assertive', 'aria-atomic': 'true', id: `${inputId}-error` }
    : {};

  return (
    <Animated.View
      style={[st.errorRow, { opacity, transform: [{ translateY }] }]}
      accessibilityLiveRegion="assertive"
      {...webProps}
    >
      <Ionicons name="alert-circle" size={14} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={[st.errorText, { color: C.error }]} allowFontScaling maxFontSizeMultiplier={1.3}>{message}</Text>
    </Animated.View>
  );
});

const SuccessText = React.memo(({ message, C }: { message: string; C: Tokens }) => !message ? null : (
  <View style={st.successRow}>
    <Ionicons name="checkmark-circle" size={14} color={C.success} accessibilityElementsHidden importantForAccessibility="no" />
    <Text style={[st.successTextMsg, { color: C.success }]} allowFontScaling maxFontSizeMultiplier={1.3}>{message}</Text>
  </View>
));

const BrandLogo = React.memo(({ C, paused }: { C: Tokens; paused: boolean }) => {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (prefersReducedMotion || paused) { scale.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.04, duration: 2400, useNativeDriver: nativeDriver }),
      Animated.timing(scale, { toValue: 1, duration: 2400, useNativeDriver: nativeDriver }),
    ]));
    const task = InteractionManager.runAfterInteractions(() => loop.start());
    return () => { task.cancel(); loop.stop(); };
  }, [paused, scale]);

  return (
    <Animated.View style={[st.logoOuter, { transform: [{ scale }] }]} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[st.logoCircle, { backgroundColor: C.accentGlow, borderColor: C.logoBorder }]}>
        <Ionicons name="shield-checkmark" size={38} color={C.accent} />
      </View>
    </Animated.View>
  );
});

const CustomModal = React.memo(({ config, onClose, C }: { config: ModalConfig; onClose: () => void; C: Tokens }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;
  const closing = useRef(false);

  const doClose = useCallback(async (btn?: ModalConfig['buttons'][0]) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(opacity, { toValue: 0, duration: getAnimDuration(150), useNativeDriver: nativeDriver }).start(async () => {
      if (btn?.onPress) await btn.onPress();
      onClose();
    });
  }, [opacity, onClose]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: getAnimDuration(200), useNativeDriver: nativeDriver }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 20, bounciness: 4 }),
    ]).start();
    if (!IS_WEB) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') void doClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [opacity, scale, doClose]);

  const webDialogProps: WebAriaProps = IS_WEB
    ? { role: 'dialog', 'aria-modal': 'true' }
    : {};

  return (
    <Animated.View
      style={[st.modalOverlay, { backgroundColor: C.overlay, opacity }]}
      {...webDialogProps}
      accessibilityViewIsModal
    >
      <Pressable style={StyleSheet.absoluteFillObject} onPress={() => void doClose()} accessibilityLabel="Close dialog" />
      <Animated.View style={[st.modalCard, { backgroundColor: C.card, borderColor: C.cardBorder, transform: [{ scale }] }]}>
        <Text style={[st.modalTitle, { color: C.textPrimary }]}>{config.title}</Text>
        <Text style={[st.modalMessage, { color: C.textSecondary }]}>{config.message}</Text>
        <View style={st.modalButtons}>
          {config.buttons.map((btn, i) => (
            <Pressable
              key={i}
              onPress={() => void doClose(btn)}
              style={({ pressed }) => [st.modalButton, { backgroundColor: btn.primary ? C.accent : 'transparent', borderColor: btn.primary ? C.accent : C.separator, opacity: pressed ? 0.8 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={btn.label}
            >
              <Text style={[st.modalButtonText, { color: btn.primary ? C.white : C.textSecondary, fontWeight: btn.primary ? '700' : '500' }]}>{btn.label}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
});

const useShake = () => {
  const anim = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    if (prefersReducedMotion) return;
    anim.setValue(0);
    Animated.sequence([
      Animated.timing(anim, { toValue: 10, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(anim, { toValue: -10, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(anim, { toValue: 8, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(anim, { toValue: -8, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(anim, { toValue: 4, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(anim, { toValue: 0, duration: 60, useNativeDriver: nativeDriver }),
    ]).start();
  }, [anim]);
  return { shakeAnim: anim, shake };
};

const GradientButton = React.memo(({ onPress, disabled, loading, label, C }: { onPress: () => void; disabled: boolean; loading: boolean; label: string; C: Tokens }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = useCallback(() => {
    if (!disabled && !loading) {
      Animated.spring(scale, { toValue: 0.97, useNativeDriver: nativeDriver, speed: 50 }).start();
      void triggerHaptic('light');
    }
  }, [disabled, loading, scale]);

  const pressOut = useCallback(() => { Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 50 }).start(); }, [scale]);
  const colors = useMemo(() => (disabled ? [C.disabledBg, C.disabledBg] : [C.buttonGradStart, C.buttonGradEnd]) as [string, string], [disabled, C]);
  const isDisabled = disabled || loading;

  return (
    <Animated.View style={[st.buttonOuter, { shadowColor: isDisabled ? 'transparent' : C.accent, transform: [{ scale }] }]}>
      <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} disabled={isDisabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: isDisabled, busy: loading }}>
        <View pointerEvents={isDisabled ? 'none' : 'auto'} style={{ borderRadius: 16 }}>
          <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.button, isDisabled && st.buttonDisabled]}>
            {loading ? (
              <View style={st.buttonContent}>
                <ActivityIndicator color={C.white} size="small" />
                <Text style={[st.buttonText, { marginLeft: 10 }]}>Creating Account…</Text>
              </View>
            ) : (
              <View style={st.buttonContent}>
                <Text style={[st.buttonText, isDisabled && { color: C.disabledText }]}>{label}</Text>
              </View>
            )}
          </LinearGradient>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const InputField = React.memo(({
  label, icon, placeholder, value, onChangeText, error, successMsg, focused, onFocus, onBlur,
  secureTextEntry, showPassword, onTogglePassword, keyboardType, autoComplete, textContentType,
  webAutoComplete, webInputName, returnKeyType, onSubmitEditing, inputRef, editable, accessibilityLabel, inputId, C, onKeyPress,
}: {
  label: string; icon: keyof typeof Ionicons.glyphMap; placeholder: string; value: string;
  onChangeText: (t: string) => void; error: string; successMsg?: string; focused: boolean;
  onFocus: () => void; onBlur: () => void; secureTextEntry?: boolean; showPassword?: boolean;
  onTogglePassword?: () => void; keyboardType?: 'default' | 'email-address'; autoComplete?: string;
  textContentType?: string; webAutoComplete?: string; webInputName?: string; returnKeyType?: 'next' | 'go';
  onSubmitEditing?: () => void; inputRef?: React.RefObject<TextInput | null>; editable?: boolean;
  accessibilityLabel: string; inputId: string; C: Tokens; onKeyPress?: (e: KeyPressEvent) => void;
}) => {
  const borderAnim = useRef(new Animated.Value(0)).current;
  const hasError = !!error;
  const webStyle = useMemo(() => buildWebInputStyle(C), [C]);

  useEffect(() => {
    Animated.timing(borderAnim, { toValue: focused ? 1 : 0, duration: getAnimDuration(200), useNativeDriver: false }).start();
  }, [focused, borderAnim]);

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [hasError ? C.error : successMsg ? C.success : C.inputBorder, hasError ? C.error : C.accent],
  });

  const webNameProp: WebInputProps = webInputName ? { name: webInputName } : {};
  const webErrorProps: WebAriaProps = hasError
    ? { 'aria-describedby': `${inputId}-error`, 'aria-invalid': 'true', 'aria-required': 'true' }
    : { 'aria-required': 'true' };
  const webCursorStyle: WebPressableStyle = IS_WEB ? { cursor: 'pointer' } : {};

  return (
    <View style={st.inputContainer}>
      <Text style={[st.inputLabel, { color: C.textMuted }, focused && { color: C.accent }, hasError && { color: C.error }]} accessibilityElementsHidden importantForAccessibility="no" allowFontScaling maxFontSizeMultiplier={1.2}>
        {label}
      </Text>

      <Animated.View style={[st.inputWrapper, { borderColor, backgroundColor: hasError ? C.errorGlow : C.inputBg }, focused && [st.inputWrapperFocused, { shadowColor: C.inputShadow }]]}>
        <Ionicons name={icon} size={20} color={hasError ? C.error : focused ? C.accent : C.textMuted} style={st.inputIcon} accessibilityElementsHidden importantForAccessibility="no" />

        {IS_WEB ? (
          <TextInput
            ref={inputRef}
            nativeID={inputId}
            {...webNameProp}
            style={webStyle as WebStyleProps}
            placeholder={placeholder}
            placeholderTextColor={C.textMuted}
            value={value}
            onChangeText={onChangeText}
            secureTextEntry={secureTextEntry && !showPassword}
            keyboardType={keyboardType ?? 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={(webAutoComplete ?? autoComplete) as TextInput['props']['autoComplete']}
            textContentType={textContentType as TextInput['props']['textContentType']}
            editable={editable !== false}
            returnKeyType={returnKeyType}
            onFocus={onFocus}
            onBlur={onBlur}
            onSubmitEditing={onSubmitEditing}
            onKeyPress={onKeyPress}
            accessibilityLabel={accessibilityLabel}
            selectionColor={C.accent}
            {...webErrorProps}
          />
        ) : (
          <TextInput
            ref={inputRef}
            nativeID={inputId}
            style={[st.inputNative, { color: C.textPrimary }]}
            placeholder={placeholder}
            placeholderTextColor={C.textMuted}
            value={value}
            onChangeText={onChangeText}
            secureTextEntry={secureTextEntry && !showPassword}
            keyboardType={keyboardType ?? 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={autoComplete as TextInput['props']['autoComplete']}
            textContentType={textContentType as TextInput['props']['textContentType']}
            editable={editable !== false}
            returnKeyType={returnKeyType}
            onFocus={onFocus}
            onBlur={onBlur}
            onSubmitEditing={onSubmitEditing}
            onKeyPress={onKeyPress}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={hasError ? error : undefined}
            selectionColor={C.accent}
            allowFontScaling
            maxFontSizeMultiplier={1.1}
          />
        )}

        {onTogglePassword && (
          <Pressable onPress={onTogglePassword} hitSlop={12} style={[st.eyeButton, webCursorStyle]} accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={focused ? C.accent : C.textMuted} />
          </Pressable>
        )}
      </Animated.View>

      <AnimatedError message={error} inputId={inputId} C={C} />
      {!error && successMsg ? <SuccessText message={successMsg} C={C} /> : null}
    </View>
  );
});

const StrengthBar = React.memo(({ password, C }: { password: string; C: Tokens }) => {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const strength = useMemo(() => validators.strength(password, C), [password, C]);

  useEffect(() => {
    Animated.timing(widthAnim, { toValue: strength.percent, duration: getAnimDuration(300), useNativeDriver: false }).start();
  }, [strength.percent, widthAnim]);

  if (!password) return null;

  const animWidth = widthAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <View style={st.strengthContainer} accessibilityLabel={`Password strength: ${strength.level}`}>
      <View style={[st.strengthBarBg, { backgroundColor: C.inputBorder }]}>
        <Animated.View style={[st.strengthBar, { width: animWidth, backgroundColor: strength.color }]} />
      </View>
      <Text style={[st.strengthText, { color: strength.color }]} allowFontScaling maxFontSizeMultiplier={1.2}>{strength.level}</Text>
    </View>
  );
});

const PasswordRequirements = React.memo(({ password, C }: { password: string; C: Tokens }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const v = useMemo(() => validators.password(password), [password]);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: getAnimDuration(300), useNativeDriver: nativeDriver }).start();
  }, [opacity]);

  const items = [
    { key: 'length', label: 'At least 8 characters' },
    { key: 'uppercase', label: 'One uppercase letter (A-Z)' },
    { key: 'lowercase', label: 'One lowercase letter (a-z)' },
    { key: 'number', label: 'One number (0-9)' },
    { key: 'special', label: 'One special character (!@#$%^&*)' },
  ] as const;

  return (
    <Animated.View style={[st.requirementsContainer, { backgroundColor: C.requirementsBg, borderColor: C.cardBorder, opacity }]} accessibilityLiveRegion="polite">
      <Text style={[st.requirementsTitle, { color: C.textMuted }]} allowFontScaling maxFontSizeMultiplier={1.2}>Password must include:</Text>
      {items.map(item => {
        const met = v.checks[item.key];
        return (
          <View key={item.key} style={st.requirementRow}>
            <Ionicons name={met ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={met ? C.success : C.textMuted} style={{ marginRight: 10 }} />
            <Text style={[st.requirementText, { color: met ? C.success : C.textMuted }, met && { fontWeight: '500' }]} allowFontScaling maxFontSizeMultiplier={1.2}>{item.label}</Text>
          </View>
        );
      })}
    </Animated.View>
  );
});

const LockoutBanner = React.memo(({ seconds, C }: { seconds: number; C: Tokens }) => !seconds ? null : (
  <View style={[st.lockoutBanner, { backgroundColor: C.errorGlow, borderColor: C.error }]} accessibilityLiveRegion="polite">
    <Ionicons name="time-outline" size={16} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
    <Text style={[st.lockoutText, { color: C.error }]} allowFontScaling maxFontSizeMultiplier={1.2}>
      Too many attempts — try again in <Text style={{ fontWeight: '800' }}>{seconds}s</Text>
    </Text>
  </View>
));

const SuccessOverlay = React.memo(({ C }: { C: Tokens }) => {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const iconS = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: getAnimDuration(200), useNativeDriver: nativeDriver }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 14, bounciness: 8 }),
      ]),
      Animated.spring(iconS, { toValue: 1, useNativeDriver: nativeDriver, speed: 10, bounciness: 12 }),
    ]).start();
    if (!IS_WEB) AccessibilityInfo.announceForAccessibility('Account created successfully!');
  }, [opacity, scale, iconS]);

  return (
    <Animated.View style={[st.successOverlay, { backgroundColor: C.overlay, opacity }]} pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="assertive">
      <Animated.View style={[st.successCard, { backgroundColor: C.card, borderColor: C.cardBorder, transform: [{ scale }] }]} accessibilityRole="alert">
        <Animated.View style={{ transform: [{ scale: iconS }] }}>
          <View style={[st.successIconCircle, { backgroundColor: C.successGlow }]}>
            <Ionicons name="checkmark-circle" size={56} color={C.success} />
          </View>
        </Animated.View>
        <Text style={[st.successTitleText, { color: C.textPrimary }]}>Account Created!</Text>
        <Text style={[st.successSub, { color: C.textSecondary }]}>Check your email to verify your account.</Text>
        <ActivityIndicator size="small" color={C.accent} style={{ marginTop: 10 }} />
      </Animated.View>
    </Animated.View>
  );
});

class SignupErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() {}
  render() {
    if (this.state.hasError) {
      const C = Appearance.getColorScheme() !== 'light' ? darkTokens : lightTokens;
      return (
        <View style={[st.errorFallback, { backgroundColor: C.bg }]}>
          <Ionicons name="warning-outline" size={48} color={C.error} />
          <Text style={[st.errorFallbackTitle, { color: C.textPrimary }]}>Something went wrong</Text>
          <TouchableOpacity onPress={() => this.setState({ hasError: false })} style={[st.retryButton, { borderColor: C.accent }]}>
            <Text style={[st.retryText, { color: C.accent }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function SignupScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const C: Tokens = isDark ? darkTokens : lightTokens;

  const [state, dispatch] = useReducer(formReducer, initialForm);
  const [screenData, setSD] = useState(getScreenData);
  const [showSuccess, setShowSuccess] = useState(false);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [appActive, setAppActive] = useState(true);

  const isMounted = useRef(true);
  const signupAttempts = useRef(0);
  const lockoutUntil = useRef(0);
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const navTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameRef = useRef<TextInput>(null);
  const dobRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  const { shakeAnim, shake } = useShake();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(prefersReducedMotion ? 0 : 30)).current;
  const headerFade = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(prefersReducedMotion ? 0 : 16)).current;
  const formFade = useRef(new Animated.Value(0)).current;
  const formSlide = useRef(new Animated.Value(prefersReducedMotion ? 0 : 16)).current;
  const footerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => { injectWebStyles(C, isDark ? 'dark' : 'light'); }, [C, isDark]);

  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const h = (e: MediaQueryListEvent) => { prefersReducedMotion = e.matches; };
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (lockoutTimer.current) clearInterval(lockoutTimer.current);
      if (navTimeout.current) clearTimeout(navTimeout.current);
      dispatch({ type: 'WIPE_SENSITIVE' });
    };
  }, []);

  useEffect(() => {
    if (!IS_WEB) return;
    const h = debounce(() => setSD(getScreenData()), RESIZE_DEBOUNCE_MS);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => state.loading || showSuccess);
    return () => sub.remove();
  }, [state.loading, showSuccess]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (!isMounted.current) return;
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: getAnimDuration(400), useNativeDriver: nativeDriver }),
        Animated.timing(slideAnim, { toValue: 0, duration: getAnimDuration(500), useNativeDriver: nativeDriver }),
        Animated.stagger(getAnimDuration(120), [
          Animated.parallel([
            Animated.timing(headerFade, { toValue: 1, duration: getAnimDuration(600), useNativeDriver: nativeDriver }),
            Animated.timing(headerSlide, { toValue: 0, duration: getAnimDuration(600), useNativeDriver: nativeDriver }),
          ]),
          Animated.parallel([
            Animated.timing(formFade, { toValue: 1, duration: getAnimDuration(600), useNativeDriver: nativeDriver }),
            Animated.timing(formSlide, { toValue: 0, duration: getAnimDuration(600), useNativeDriver: nativeDriver }),
          ]),
          Animated.timing(footerFade, { toValue: 1, duration: getAnimDuration(500), useNativeDriver: nativeDriver }),
        ]),
      ]).start();
    });
    return () => task.cancel();
  }, [fadeAnim, slideAnim, headerFade, headerSlide, formFade, formSlide, footerFade]);

  const startLockout = useCallback(() => {
    if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    const tick = () => {
      if (!isMounted.current) return;
      const remaining = Math.ceil((lockoutUntil.current - Date.now()) / 1000);
      if (remaining <= 0) {
        dispatch({ type: 'SET_LOCKOUT', payload: 0 });
        if (lockoutTimer.current) { clearInterval(lockoutTimer.current); lockoutTimer.current = null; }
      } else {
        dispatch({ type: 'SET_LOCKOUT', payload: remaining });
      }
    };
    tick();
    lockoutTimer.current = setInterval(tick, 1000);
  }, []);

  const openModal = useCallback((config: ModalConfig) => setModal(config), []);
  const closeModal = useCallback(() => setModal(null), []);

  const showAppAlert = useCallback((title: string, message: string, buttons?: AlertButton[]) => {
    if (IS_WEB) {
      openModal({
        title,
        message,
        buttons: (buttons ?? [{ text: 'OK' }]).map((b, _, arr) => ({
          label: b.text ?? 'OK',
          onPress: b.onPress,
          primary: b.style !== 'cancel' && arr.length > 1,
        })),
      });
    } else {
      showNativeAlert(title, message, buttons);
    }
  }, [openModal]);

  const handleKeyPress = useCallback((e: KeyPressEvent) => {
    if (!IS_WEB) return;
    if (!e.nativeEvent?.key) return;
    dispatch({ type: 'SET_CAPS_LOCK', payload: !!e.nativeEvent.getModifierState?.('CapsLock') });
  }, []);

  const pwValidation = useMemo(() => validators.password(state.password), [state.password]);
  const passwordsMatch = state.password === state.confirmPassword;
  const emailValid = state.email.length >= MIN_EMAIL_DISPLAY && !validators.email(state.email);

  const canSubmit = useMemo(() => !!(
    state.name.trim() && !state.nameError && state.dob && !state.dobError &&
    state.email.trim() && emailValid && pwValidation.valid && passwordsMatch &&
    state.confirmPassword.length > 0 && !state.loading && state.lockoutSeconds === 0
  ), [state, emailValid, pwValidation.valid, passwordsMatch]);

  const validateName = useCallback((text: string) => {
    const v = text.slice(0, 50);
    dispatch({ type: 'SET_NAME', payload: v });
    if (!v.trim()) return dispatch({ type: 'SET_NAME_ERROR', payload: '' });
    const result = validateDisplayName(v);
    dispatch({ type: 'SET_NAME_ERROR', payload: result.valid ? '' : (result.reason ?? 'Invalid name') });
  }, []);

  const validateDOB = useCallback((text: string) => {
    dispatch({ type: 'SET_DOB', payload: text });
    if (!text) return dispatch({ type: 'SET_DOB_ERROR', payload: '' });
    const result = validateDateOfBirth(text);
    dispatch({ type: 'SET_DOB_ERROR', payload: result.valid ? '' : (result.reason ?? 'Invalid date') });
  }, []);

  const validateEmail = useCallback((text: string) => {
    const clean = text.trimStart().slice(0, MAX_EMAIL_LENGTH).replace(/[\n\r]/g, '');
    dispatch({ type: 'SET_EMAIL', payload: clean });
    if (clean.length < MIN_EMAIL_DISPLAY) return dispatch({ type: 'SET_EMAIL_ERROR', payload: '' });
    dispatch({ type: 'SET_EMAIL_ERROR', payload: validators.email(clean) });
  }, []);

  const validatePassword = useCallback((text: string) => dispatch({ type: 'SET_PASSWORD', payload: text.slice(0, MAX_PASSWORD_LENGTH) }), []);
  const validateConfirm = useCallback((text: string) => dispatch({ type: 'SET_CONFIRM', payload: text.slice(0, MAX_PASSWORD_LENGTH) }), []);
  const dismissKeyboard = useCallback(() => { if (!IS_WEB) Keyboard.dismiss(); }, []);

  const handleSignup = useCallback(async () => {
    dismissKeyboard();
    dispatch({ type: 'CLEAR_ERRORS' });

    const nameResult = validateDisplayName(state.name.trim());
    if (!nameResult.valid) { dispatch({ type: 'SET_NAME_ERROR', payload: nameResult.reason ?? 'Invalid name' }); shake(); return; }

    const dobResult = validateDateOfBirth(state.dob);
    if (!dobResult.valid) { dispatch({ type: 'SET_DOB_ERROR', payload: dobResult.reason ?? 'Invalid date of birth' }); shake(); return; }

    const email = state.email.trim().toLowerCase();
    const emailError = validators.email(email);
    if (emailError) { dispatch({ type: 'SET_EMAIL_ERROR', payload: emailError }); shake(); return; }

    if (!pwValidation.valid) {
      shake();
      showAppAlert('Password Requirements', `Your password must meet all requirements:\n\n${pwValidation.errors.map(e => `• ${e}`).join('\n')}`);
      return;
    }

    if (!passwordsMatch) {
      dispatch({ type: 'SET_CONFIRM_ERROR', payload: 'Passwords do not match' });
      shake();
      return;
    }

    if (Date.now() < lockoutUntil.current) { startLockout(); shake(); return; }

    dispatch({ type: 'SET_LOADING', payload: true });
    const breached = await checkPasswordBreached(state.password);
    dispatch({ type: 'SET_LOADING', payload: false });

    if (breached) {
      dispatch({ type: 'SET_BREACHED_WARNING', payload: true });
      showAppAlert('⚠️ Password Found in Data Breach', 'This password has appeared in a known data breach. Please choose a different, unique password.', [{ text: 'Choose Different Password' }]);
      shake();
      return;
    }

    showAppAlert('Create Account', `Create account with:\n${email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        onPress: async () => {
          dispatch({ type: 'SET_LOADING', payload: true });
          dispatch({ type: 'HIDE_PASSWORDS' });

          try {
            const fp = await getDeviceFingerprint();

            if (fp) {
              const creationCheck = await trackAccountCreation(fp);
              if (creationCheck.suspicious) {
                showAppAlert('Account Limit', 'Too many accounts created from this device. Please contact support.');
                dispatch({ type: 'SET_LOADING', payload: false });
                return;
              }
            }

            const bannedCheck = await checkUserBanned(email);
            if (bannedCheck.banned) {
              showAppAlert('Registration Blocked', bannedCheck.reason ?? 'This email is not eligible for registration. Contact support.');
              dispatch({ type: 'SET_LOADING', payload: false });
              return;
            }

            const { user } = await createUserWithEmailAndPassword(auth, email, state.password);
            try { await sendEmailVerification(user); } catch {}

            await logTermsAccepted('1.0');
            await logPrivacyAccepted('1.0');
            await logConsent('account_creation', true);
            await writeAuditLog('user.register', {
              maskedEmail: maskEmail(email),
              emailDomain: email.split('@')[1] ?? '',
              deviceFingerprint: fp,
              dobAge: dobResult.age,
              nameDetector: 'passed',
            });

            await auth.signOut();
            dispatch({ type: 'WIPE_SENSITIVE' });
            await triggerHaptic('success');
            if (!isMounted.current) return;
            dispatch({ type: 'SET_LOADING', payload: false });
            setShowSuccess(true);
            navTimeout.current = setTimeout(() => { if (isMounted.current) router.replace(ROUTES.LOGIN); }, getAnimDuration(SUCCESS_NAV_DELAY_MS));
          } catch (error: unknown) {
            signupAttempts.current += 1;
            if (signupAttempts.current >= MAX_SIGNUP_ATTEMPTS) {
              lockoutUntil.current = Date.now() + LOCKOUT_DURATION_MS;
              signupAttempts.current = 0;
              startLockout();
            }
            await triggerHaptic('error');
            shake();
            if (!isMounted.current) return;
            const code = getFirebaseErrorCode(error);
            if (code === 'auth/email-already-in-use' || code === 'auth/invalid-email') {
              dispatch({ type: 'SET_EMAIL_ERROR', payload: getErrorMessage(code) });
              setTimeout(() => emailRef.current?.focus(), FOCUS_DELAY_MS);
            }
            showAppAlert('Signup Failed', getErrorMessage(code));
            dispatch({ type: 'SET_LOADING', payload: false });
          }
        },
      },
    ]);
  }, [state, pwValidation, passwordsMatch, dismissKeyboard, shake, showAppAlert, startLockout, router]);

  const handleLogin = useCallback(() => { if (!state.loading) router.replace(ROUTES.LOGIN); }, [state.loading, router]);
  const handleTerms = useCallback(() => router.push(ROUTES.TERMS), [router]);
  const handlePrivacy = useCallback(() => router.push(ROUTES.PRIVACY), [router]);
  const focusDOB = useCallback(() => dobRef.current?.focus(), []);
  const focusEmail = useCallback(() => emailRef.current?.focus(), []);
  const focusPassword = useCallback(() => passwordRef.current?.focus(), []);
  const focusConfirm = useCallback(() => confirmRef.current?.focus(), []);

  const IS_SMALL = screenData.isSmall;
  const emailSuccessMsg = emailValid && !state.emailError ? 'Valid email' : '';
  const confirmError = state.confirmPassword.length > 0 && state.confirmPassword.length >= state.password.length && !passwordsMatch ? 'Passwords do not match' : state.confirmPasswordError;
  const confirmSuccessMsg = state.confirmPassword.length > 0 && passwordsMatch && pwValidation.valid && !state.confirmPasswordError ? 'Passwords match' : '';
  const logoPaused = state.nameFocused || state.dobFocused || state.emailFocused || state.passwordFocused || state.confirmFocused || state.loading || !appActive;

  const webCursorStyle: WebPressableStyle = IS_WEB ? { cursor: 'pointer' } : {};

  return (
    <SignupErrorBoundary>
      <View style={[st.rootBg, { backgroundColor: C.bg }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} translucent={false} />
        <LinearGradient colors={[C.bgGradientStart, C.bgGradientMid, C.bgGradientEnd]} style={StyleSheet.absoluteFill} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />

        <SafeAreaView style={st.safe}>
          <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: 'height', default: undefined })} style={st.container} keyboardVerticalOffset={IS_IOS ? 0 : 20}>
            <Pressable style={st.fill} onPress={dismissKeyboard}>
              <ScrollView
                ref={scrollRef}
                contentContainerStyle={[st.scrollContent, { padding: IS_SMALL ? 20 : 28, paddingTop: IS_SMALL ? 16 : 24 }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                <Animated.View style={[st.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }], maxWidth: 440 }]}>
                  <Pressable onPress={handleLogin} style={[st.backRow, webCursorStyle]} disabled={state.loading} accessibilityRole="button" accessibilityLabel="Back to login">
                    <Ionicons name={IS_RTL ? 'chevron-forward' : 'chevron-back'} size={20} color={C.accent} />
                    <Text style={[st.backText, { color: C.accent }]}>Back to Login</Text>
                  </Pressable>

                  <Animated.View style={[st.headerContainer, { opacity: headerFade, transform: [{ translateY: headerSlide }] }]}>
                    <BrandLogo C={C} paused={logoPaused} />
                    <Text style={[st.title, { color: C.textPrimary, fontSize: IS_SMALL ? 30 : 36 }]} accessibilityRole="header">Create Account</Text>
                    <Text style={[st.subtitle, { color: C.textSecondary, fontSize: IS_SMALL ? 15 : 16 }]}>Start your journey with MyArchetype</Text>
                  </Animated.View>

                  <LockoutBanner seconds={state.lockoutSeconds} C={C} />

                  <Animated.View style={[st.formCard, { opacity: formFade, transform: [{ translateX: shakeAnim }, { translateY: formSlide }], backgroundColor: C.card, borderColor: C.cardBorder, padding: IS_SMALL ? 24 : 34 }]}>
                    <InputField inputId="signup-name" label="Display name" icon="person-outline" placeholder="Your first name" value={state.name} onChangeText={validateName} error={state.nameError} focused={state.nameFocused} onFocus={() => dispatch({ type: 'SET_NAME_FOCUSED', payload: true })} onBlur={() => dispatch({ type: 'SET_NAME_FOCUSED', payload: false })} autoComplete="name" webAutoComplete="given-name" webInputName="given-name" textContentType="name" returnKeyType="next" onSubmitEditing={focusDOB} inputRef={nameRef} editable={!state.loading} accessibilityLabel="Display name" C={C} />
                    <InputField inputId="signup-dob" label="Date of birth" icon="calendar-outline" placeholder="YYYY-MM-DD" value={state.dob} onChangeText={validateDOB} error={state.dobError} focused={state.dobFocused} onFocus={() => dispatch({ type: 'SET_DOB_FOCUSED', payload: true })} onBlur={() => dispatch({ type: 'SET_DOB_FOCUSED', payload: false })} autoComplete="bday" webAutoComplete="bday" webInputName="bday" textContentType="birthdate" returnKeyType="next" onSubmitEditing={focusEmail} inputRef={dobRef} editable={!state.loading} accessibilityLabel="Date of birth (YYYY-MM-DD)" C={C} />
                    <InputField inputId="signup-email" label="Email address" icon="mail-outline" placeholder="you@example.com" value={state.email} onChangeText={validateEmail} error={state.emailError} successMsg={emailSuccessMsg} focused={state.emailFocused} onFocus={() => dispatch({ type: 'SET_EMAIL_FOCUSED', payload: true })} onBlur={() => dispatch({ type: 'SET_EMAIL_FOCUSED', payload: false })} keyboardType="email-address" autoComplete="email" webAutoComplete="email" webInputName="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={focusPassword} inputRef={emailRef} editable={!state.loading} accessibilityLabel="Email address" C={C} onKeyPress={handleKeyPress} />
                    <InputField inputId="signup-password" label="Password" icon="lock-closed-outline" placeholder="Create a strong password" value={state.password} onChangeText={validatePassword} error={state.passwordError} focused={state.passwordFocused} onFocus={() => { dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: true }); dispatch({ type: 'SET_SHOW_REQUIREMENTS', payload: true }); }} onBlur={() => dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: false })} secureTextEntry showPassword={state.showPassword} onTogglePassword={() => dispatch({ type: 'TOGGLE_PASSWORD' })} autoComplete="password-new" webAutoComplete="new-password" webInputName="new-password" textContentType="newPassword" returnKeyType="next" onSubmitEditing={focusConfirm} inputRef={passwordRef} editable={!state.loading} accessibilityLabel="Password" C={C} onKeyPress={handleKeyPress} />

                    <StrengthBar password={state.password} C={C} />
                    {state.showRequirements && state.password.length > 0 && (state.passwordFocused || !pwValidation.valid) && <PasswordRequirements password={state.password} C={C} />}

                    {state.breachedWarning && (
                      <View style={[st.lockoutBanner, { backgroundColor: C.errorGlow, borderColor: C.error, marginBottom: 12 }]}>
                        <Ionicons name="warning-outline" size={16} color={C.error} />
                        <Text style={[st.lockoutText, { color: C.error }]}>This password was found in a data breach. Choose a different one.</Text>
                      </View>
                    )}

                    <InputField inputId="signup-confirm" label="Confirm password" icon="lock-closed-outline" placeholder="Re-enter your password" value={state.confirmPassword} onChangeText={validateConfirm} error={confirmError} successMsg={confirmSuccessMsg} focused={state.confirmFocused} onFocus={() => { dispatch({ type: 'SET_CONFIRM_FOCUSED', payload: true }); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 350); }} onBlur={() => dispatch({ type: 'SET_CONFIRM_FOCUSED', payload: false })} secureTextEntry showPassword={state.showConfirmPassword} onTogglePassword={() => dispatch({ type: 'TOGGLE_CONFIRM_PASSWORD' })} autoComplete="password-new" webAutoComplete="new-password" webInputName="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={canSubmit ? handleSignup : undefined} inputRef={confirmRef} editable={!state.loading} accessibilityLabel="Confirm password" C={C} onKeyPress={handleKeyPress} />

                    {IS_WEB && state.capsLockOn && (state.passwordFocused || state.confirmFocused) && (
                      <View style={[st.capsLockRow, { backgroundColor: C.errorGlow, borderColor: C.warn }]} accessibilityLiveRegion="polite">
                        <Ionicons name="warning-outline" size={14} color={C.warn} />
                        <Text style={[st.capsLockText, { color: C.warn }]}>Caps Lock is on</Text>
                      </View>
                    )}

                    <View style={st.buttonSpacer} />
                    <GradientButton onPress={handleSignup} disabled={!canSubmit} loading={state.loading} label="Create Account" C={C} />
                  </Animated.View>

                  <Animated.View style={[st.footer, { opacity: footerFade }]}>
                    <Text style={[st.legalText, { color: C.textMuted }]}>
                      By creating an account, you agree to our{' '}
                      <Text style={[st.legalLink, { color: C.accentSoft }]} onPress={handleTerms} accessibilityRole="link">Terms of Service</Text>
                      {' and '}
                      <Text style={[st.legalLink, { color: C.accentSoft }]} onPress={handlePrivacy} accessibilityRole="link">Privacy Policy</Text>
                    </Text>
                    <Pressable onPress={handleLogin} disabled={state.loading} style={({ pressed }) => [st.loginButton, { opacity: pressed ? 0.7 : 1 }, webCursorStyle]}>
                      <Text style={[st.loginText, { color: C.textSecondary }]}>Already have an account? <Text style={[st.loginLink, { color: C.accent }]}>Log in</Text></Text>
                    </Pressable>
                  </Animated.View>
                </Animated.View>
              </ScrollView>
            </Pressable>

            {state.loading && !showSuccess && (
              <View style={[st.loadingOverlay, { backgroundColor: C.overlay }]} pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="polite">
                <View style={[st.loadingCard, { backgroundColor: C.card, borderColor: C.cardBorder }]} accessibilityRole="alert">
                  <ActivityIndicator size="large" color={C.accent} />
                  <Text style={[st.loadingText, { color: C.textSecondary }]}>Creating your account…</Text>
                </View>
              </View>
            )}

            {showSuccess && <SuccessOverlay C={C} />}
            {modal && IS_WEB && <CustomModal config={modal} onClose={closeModal} C={C} />}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </SignupErrorBoundary>
  );
}

const st = StyleSheet.create({
  rootBg:{ flex:1 }, safe:{ flex:1 }, container:{ flex:1 }, fill:{ flex:1 },
  scrollContent:{ flexGrow:1, justifyContent:'center', paddingBottom:52 },
  content:{ width:'100%', alignSelf:'center' },
  backRow:{ flexDirection:'row', alignItems:'center', alignSelf:'flex-start', marginBottom:28, gap:4, paddingVertical:4, paddingRight:8 },
  backText:{ fontSize:15, fontWeight:'600' },
  headerContainer:{ alignItems:'center', marginBottom:40 },
  logoOuter:{ width:84, height:84, alignItems:'center', justifyContent:'center', marginBottom:24 },
  logoCircle:{ width:76, height:76, borderRadius:38, alignItems:'center', justifyContent:'center', borderWidth:1.5 },
  title:{ fontWeight:'800', marginBottom:10, letterSpacing:-0.5, textAlign:'center' },
  subtitle:{ textAlign:'center', lineHeight:24, letterSpacing:0.1 },
  lockoutBanner:{ flexDirection:'row', alignItems:'center', gap:10, padding:14, borderRadius:14, borderWidth:1, marginBottom:20 },
  lockoutText:{ fontSize:13, fontWeight:'600', flex:1 },
  formCard:{ borderRadius:24, borderWidth:1, shadowColor:'#000', shadowOffset:{ width:0, height:12 }, shadowOpacity:0.2, shadowRadius:28, elevation:14 },
  inputContainer:{ marginBottom:26 },
  inputLabel:{ fontSize:13, fontWeight:'600', marginBottom:10, marginLeft:2, letterSpacing:0.15 },
  inputWrapper:{ flexDirection:'row', alignItems:'center', borderRadius:14, borderWidth:1.5, paddingHorizontal:16, minHeight:58 },
  inputWrapperFocused:{ shadowOffset:{ width:0, height:0 }, shadowOpacity:0.15, shadowRadius:14, elevation:4 },
  inputIcon:{ marginRight:14, width:22, textAlign:'center' },
  inputNative:{ flex:1, fontSize:16, paddingVertical:IS_IOS ? 18 : 15, letterSpacing:0.2, backgroundColor:'transparent' },
  eyeButton:{ padding:8, marginLeft:4, borderRadius:20 },
  errorRow:{ flexDirection:'row', alignItems:'center', marginTop:8, marginLeft:2, gap:6 },
  errorText:{ fontSize:12, fontWeight:'500', flex:1 },
  successRow:{ flexDirection:'row', alignItems:'center', marginTop:8, marginLeft:2, gap:6 },
  successTextMsg:{ fontSize:12, fontWeight:'500' },
  strengthContainer:{ flexDirection:'row', alignItems:'center', marginTop:-10, marginBottom:24, gap:12 },
  strengthBarBg:{ flex:1, height:6, borderRadius:3, overflow:'hidden' },
  strengthBar:{ height:'100%', borderRadius:3 },
  strengthText:{ fontSize:12, fontWeight:'700', width:50, textAlign: IS_RTL ? 'left' : 'right' },
  requirementsContainer:{ padding:18, borderRadius:14, marginBottom:24, borderWidth:1 },
  requirementsTitle:{ fontSize:12, marginBottom:14, fontWeight:'600' },
  requirementRow:{ flexDirection:'row', alignItems:'center', marginBottom:9 },
  requirementText:{ fontSize:13, lineHeight:18 },
  capsLockRow:{ flexDirection:'row', alignItems:'center', gap:8, padding:10, borderRadius:10, borderWidth:1, marginBottom:12, marginTop:-8 },
  capsLockText:{ fontSize:12, fontWeight:'600' },
  buttonSpacer:{ height:12 },
  buttonOuter:{ width:'100%', borderRadius:16, shadowOffset:{ width:0, height:8 }, shadowOpacity:0.45, shadowRadius:20, elevation:12 },
  button:{ paddingVertical:20, borderRadius:16, alignItems:'center', justifyContent:'center', minHeight:62 },
  buttonDisabled:{ shadowOpacity:0, elevation:0 },
  buttonContent:{ flexDirection:'row', alignItems:'center', gap:8 },
  buttonText:{ color:'#ffffff', fontSize:17, fontWeight:'700', letterSpacing:0.3 },
  footer:{ alignItems:'center', marginTop:36, gap:24, paddingHorizontal:16 },
  legalText:{ fontSize:13, textAlign:'center', lineHeight:22 },
  legalLink:{ fontWeight:'600', textDecorationLine:'underline' },
  loginButton:{ paddingVertical:12, paddingHorizontal:24 },
  loginText:{ fontSize:15, lineHeight:22 },
  loginLink:{ fontWeight:'700' },
  loadingOverlay:{ ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center', zIndex:10 },
  loadingCard:{ borderRadius:24, padding:40, alignItems:'center', gap:20, borderWidth:1, shadowColor:'#000', shadowOffset:{ width:0, height:8 }, shadowOpacity:0.4, shadowRadius:20, elevation:16, minWidth:200 },
  loadingText:{ fontSize:15, fontWeight:'500' },
  successOverlay:{ ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center', zIndex:20 },
  successCard:{ borderRadius:28, padding:48, alignItems:'center', gap:16, borderWidth:1, shadowColor:'#000', shadowOffset:{ width:0, height:8 }, shadowOpacity:0.4, shadowRadius:24, elevation:20 },
  successIconCircle:{ width:92, height:92, borderRadius:46, alignItems:'center', justifyContent:'center', marginBottom:6 },
  successTitleText:{ fontSize:26, fontWeight:'800', letterSpacing:-0.3 },
  successSub:{ fontSize:15, fontWeight:'500', textAlign:'center', lineHeight:22 },
  modalOverlay:{ ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center', zIndex:30, padding:24 },
  modalCard:{ width:'100%', maxWidth:400, borderRadius:22, padding:30, borderWidth:1, shadowColor:'#000', shadowOffset:{ width:0, height:12 }, shadowOpacity:0.4, shadowRadius:24, elevation:24, gap:16 },
  modalTitle:{ fontSize:19, fontWeight:'800', letterSpacing:-0.2 },
  modalMessage:{ fontSize:14, lineHeight:23 },
  modalButtons:{ flexDirection:'row', gap:10, marginTop:10, justifyContent:'flex-end', flexWrap:'wrap' },
  modalButton:{ paddingVertical:11, paddingHorizontal:22, borderRadius:11, borderWidth:1 },
  modalButtonText:{ fontSize:14 },
  errorFallback:{ flex:1, alignItems:'center', justifyContent:'center', padding:32, gap:16 },
  errorFallbackTitle:{ fontSize:22, fontWeight:'800', textAlign:'center' },
  retryButton:{ marginTop:8, paddingVertical:12, paddingHorizontal:28, borderRadius:12, borderWidth:1.5 },
  retryText:{ fontSize:15, fontWeight:'700' },
});