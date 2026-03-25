import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from 'firebase/auth';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  BackHandler,
  Dimensions,
  I18nManager,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Linking, // ← add this
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';

// ─── Platform ─────────────────────────────────────────────────────
const IS_WEB     = Platform.OS === 'web';
const IS_IOS     = Platform.OS === 'ios';
const IS_ANDROID = Platform.OS === 'android';
const IS_RTL     = I18nManager.isRTL;
const nativeDriver = !IS_WEB;

// ─── Routes ───────────────────────────────────────────────────────
const ROUTES = {
  LOGIN:   '/login'   as const,
  SIGNUP:  '/signup'  as const,
  HOME:    '/home'    as const,
  TERMS:   '/terms'   as const,
  PRIVACY: '/privacy' as const,
};

// ─── Constants ────────────────────────────────────────────────────
const EMAIL_REGEX          = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SPECIAL_CHARS_REGEX  = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;
const MAX_EMAIL_LENGTH     = 254;
const MAX_PASSWORD_LENGTH  = 128;
const MAX_SIGNUP_ATTEMPTS  = 5;
const LOCKOUT_DURATION_MS  = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const SUCCESS_NAV_DELAY_MS = 1200;
const TYPING_PAUSE_MS      = 3000;
const RESIZE_DEBOUNCE_MS   = 150;
const FOCUS_DELAY_MS       = 100;
const MIN_EMAIL_DISPLAY     = 3;

// ─── Responsive ───────────────────────────────────────────────────
const getScreenData = () => {
  const { width } = Dimensions.get('window');
  return { width, isSmall: width < 375, isMedium: width >= 375 && width < 768, isLarge: width >= 768 };
};

// ─── Reduced motion ──────────────────────────────────────────────
let prefersReducedMotion = false;
if (IS_WEB && typeof window !== 'undefined') {
  prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const getAnimDuration = (ms: number) => (prefersReducedMotion ? 0 : ms);

// ─── Debounce ─────────────────────────────────────────────────────
function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as T;
}

// ─── Design tokens ────────────────────────────────────────────────
const darkTokens = {
  bg: '#0a0a16', bgGradientStart: '#0f0f1a', bgGradientMid: '#111128', bgGradientEnd: '#0a0a16',
  card: '#161630', cardBorder: '#1e1e48', inputBg: '#12122a', inputBorder: '#2a2a50',
  accent: '#53a8b6', accentGlow: 'rgba(83,168,182,0.15)',
  error: '#ff6b6b', errorGlow: 'rgba(255,107,107,0.1)', warn: '#f0a050',
  success: '#5cb85c', successGlow: 'rgba(92,184,92,0.1)',
  textPrimary: '#f2f2ff', textSecondary: '#9898b8', textMuted: '#6a6a8a',
  white: '#ffffff', overlay: 'rgba(5,5,15,0.85)', separator: '#252548',
  buttonGradStart: '#5bbcc8', buttonGradEnd: '#3a8f9c', disabledBg: '#1e1e3a',
  inputShadow: '#53a8b6', logoBorder: '#1e1e48',
  autofillBg: '#12122a', autofillText: '#f2f2ff', autofillCaret: '#53a8b6',
  strengthWeak: '#d9534f', strengthFair: '#e67e22', strengthGood: '#53a8b6', strengthStrong: '#5cb85c',
  requirementsBg: '#0f0f2a',
} as const;

const lightTokens = {
  bg: '#f0f4f8', bgGradientStart: '#e8edf5', bgGradientMid: '#dde4f0', bgGradientEnd: '#f0f4f8',
  card: '#ffffff', cardBorder: '#d0d8e8', inputBg: '#f5f7fb', inputBorder: '#c8d0e0',
  accent: '#2d8a9a', accentGlow: 'rgba(45,138,154,0.12)',
  error: '#d93025', errorGlow: 'rgba(217,48,37,0.08)', warn: '#c47a00',
  success: '#3a8a3a', successGlow: 'rgba(58,138,58,0.08)',
  textPrimary: '#0d0d1a', textSecondary: '#4a4a6a', textMuted: '#6a6a8a',
  white: '#ffffff', overlay: 'rgba(200,210,230,0.85)', separator: '#d0d8e8',
  buttonGradStart: '#3a9aaa', buttonGradEnd: '#2a7a8a', disabledBg: '#c8d0e0',
  inputShadow: '#2d8a9a', logoBorder: '#d0d8e8',
  autofillBg: '#f5f7fb', autofillText: '#0d0d1a', autofillCaret: '#2d8a9a',
  strengthWeak: '#d93025', strengthFair: '#c47a00', strengthGood: '#2d8a9a', strengthStrong: '#3a8a3a',
  requirementsBg: '#eaeff5',
} as const;

type Tokens = typeof darkTokens;

// ─── Web CSS injection ────────────────────────────────────────────
const CSS_ID  = 'signup-screen-styles';
const META_ID = 'signup-screen-meta';
let injectedTheme: string | null = null;

const injectWebStyles = (C: Tokens, theme: string) => {
  if (!IS_WEB || typeof document === 'undefined') return;
  if (injectedTheme === theme) return;
  injectedTheme = theme;

  document.getElementById(CSS_ID)?.remove();
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.innerHTML = `
    input:focus,input:focus-visible,textarea:focus{outline:none!important;box-shadow:none!important}
    input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active{
      -webkit-background-clip:text!important;-webkit-text-fill-color:${C.autofillText}!important;
      transition:background-color 5000s ease-in-out 0s!important;
      box-shadow:inset 0 0 0 1000px ${C.autofillBg}!important;caret-color:${C.autofillCaret}!important}
    input[type="password"]:-webkit-autofill{-webkit-text-fill-color:${C.autofillText}!important}
    @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
    button:focus-visible{outline:2px solid ${C.accent}!important;outline-offset:2px!important}
    @media screen and (max-width:767px){input{font-size:16px!important}}
    .modal-message{white-space:pre-wrap}
  `;
  document.head.appendChild(style);

  if (!document.getElementById(META_ID)) {
    const m = document.createElement('meta'); m.id = META_ID; document.head.appendChild(m);
    document.title = 'Sign Up – MyArchetype';
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) { vp = document.createElement('meta'); vp.setAttribute('name','viewport'); document.head.appendChild(vp); }
    vp.setAttribute('content','width=device-width,initial-scale=1');
    let rb = document.querySelector('meta[name="robots"]');
    if (!rb) { rb = document.createElement('meta'); rb.setAttribute('name','robots'); document.head.appendChild(rb); }
    rb.setAttribute('content','noindex,nofollow');
  }

  if (typeof module !== 'undefined' && (module as any).hot) {
    (module as any).hot.dispose(() => { document.getElementById(CSS_ID)?.remove(); injectedTheme = null; });
  }
};

// ─── Error messages (generic to prevent account enumeration) ──────
const ERROR_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'Unable to create account. This email may already be registered.',
  'auth/invalid-email':        'Please enter a valid email address.',
  'auth/weak-password':        'Password is too weak. Please follow the requirements.',
  'auth/operation-not-allowed': 'Signup is currently unavailable. Please try again later.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/too-many-requests':     'Too many attempts. Please try again later.',
};

const getErrorMessage = (code?: string): string =>
  (code && ERROR_MESSAGES[code]) ?? 'An unexpected error occurred. Please try again.';

// ─── Alert ────────────────────────────────────────────────────────
type AlertButton = { text: string; onPress?: () => void; style?: string };

const showNativeAlert = (title: string, message: string, buttons?: AlertButton[]) => {
  Alert.alert(title, message, buttons ?? [{ text: 'OK' }]);
};

// ─── Haptics ──────────────────────────────────────────────────────
const triggerHaptic = (type: 'success' | 'error' | 'light') => {
  if (IS_WEB) return;
  try {
    const H = require('expo-haptics');
    if (type === 'success') H.notificationAsync(H.NotificationFeedbackType.Success);
    else if (type === 'error') H.notificationAsync(H.NotificationFeedbackType.Error);
    else H.impactAsync(H.ImpactFeedbackStyle.Light);
  } catch {}
};

// ─── Validators ───────────────────────────────────────────────────
const validators = {
  email: (v: string): string => {
    if (!v) return 'Email is required';
    if (v.length > MAX_EMAIL_LENGTH) return `Email must be under ${MAX_EMAIL_LENGTH} characters`;
    if (!EMAIL_REGEX.test(v)) return 'Invalid email format';
    return '';
  },
  password: (v: string): { valid: boolean; errors: string[]; checks: Record<string, boolean> } => {
    const checks: Record<string, boolean> = {
      length:    v.length >= 8,
      uppercase: /[A-Z]/.test(v),
      lowercase: /[a-z]/.test(v),
      number:    /[0-9]/.test(v),
      special:   SPECIAL_CHARS_REGEX.test(v),
    };
    const errors: string[] = [];
    if (!checks.length)    errors.push('At least 8 characters');
    if (!checks.uppercase) errors.push('One uppercase letter (A-Z)');
    if (!checks.lowercase) errors.push('One lowercase letter (a-z)');
    if (!checks.number)    errors.push('One number (0-9)');
    if (!checks.special)   errors.push('One special character (!@#$%^&*)');
    return { valid: errors.length === 0, errors, checks };
  },
  strength: (v: string, C: Tokens): { level: string; color: string; percent: number } => {
    let s = 0;
    if (v.length >= 8)  s += 20;
    if (v.length >= 12) s += 10;
    if (v.length >= 16) s += 5;
    if (/[A-Z]/.test(v)) s += 20;
    if (/[a-z]/.test(v)) s += 15;
    if (/[0-9]/.test(v)) s += 20;
    if (SPECIAL_CHARS_REGEX.test(v)) s += 15;
    if (/[A-Z].*[A-Z]/.test(v)) s += 5;
    if (/[0-9].*[0-9]/.test(v)) s += 5;
    if (s < 40) return { level: 'Weak',   color: C.strengthWeak,   percent: s };
    if (s < 60) return { level: 'Fair',   color: C.strengthFair,   percent: s };
    if (s < 80) return { level: 'Good',   color: C.strengthGood,   percent: s };
    return       { level: 'Strong', color: C.strengthStrong, percent: Math.min(s, 100) };
  },
};

// ─── Form reducer ─────────────────────────────────────────────────
type FormState = {
  email: string; password: string; confirmPassword: string;
  emailError: string; passwordError: string; confirmPasswordError: string;
  showPassword: boolean; showConfirmPassword: boolean;
  emailFocused: boolean; passwordFocused: boolean; confirmFocused: boolean;
  showRequirements: boolean; loading: boolean;
  lockoutSeconds: number; capsLockOn: boolean;
};

type FormAction =
  | { type: 'SET_EMAIL'; payload: string }
  | { type: 'SET_PASSWORD'; payload: string }
  | { type: 'SET_CONFIRM'; payload: string }
  | { type: 'SET_EMAIL_ERROR'; payload: string }
  | { type: 'SET_PASSWORD_ERROR'; payload: string }
  | { type: 'SET_CONFIRM_ERROR'; payload: string }
  | { type: 'TOGGLE_PASSWORD' }
  | { type: 'TOGGLE_CONFIRM_PASSWORD' }
  | { type: 'HIDE_PASSWORDS' }
  | { type: 'SET_EMAIL_FOCUSED'; payload: boolean }
  | { type: 'SET_PASSWORD_FOCUSED'; payload: boolean }
  | { type: 'SET_CONFIRM_FOCUSED'; payload: boolean }
  | { type: 'SET_SHOW_REQUIREMENTS'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LOCKOUT'; payload: number }
  | { type: 'SET_CAPS_LOCK'; payload: boolean }
  | { type: 'CLEAR_ERRORS' }
  | { type: 'WIPE_SENSITIVE' }
  | { type: 'RESET' };

const initialForm: FormState = {
  email: '', password: '', confirmPassword: '',
  emailError: '', passwordError: '', confirmPasswordError: '',
  showPassword: false, showConfirmPassword: false,
  emailFocused: false, passwordFocused: false, confirmFocused: false,
  showRequirements: false, loading: false, lockoutSeconds: 0, capsLockOn: false,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_EMAIL':            return { ...state, email: action.payload };
    case 'SET_PASSWORD':         return { ...state, password: action.payload };
    case 'SET_CONFIRM':          return { ...state, confirmPassword: action.payload };
    case 'SET_EMAIL_ERROR':      return { ...state, emailError: action.payload };
    case 'SET_PASSWORD_ERROR':   return { ...state, passwordError: action.payload };
    case 'SET_CONFIRM_ERROR':    return { ...state, confirmPasswordError: action.payload };
    case 'TOGGLE_PASSWORD':      return { ...state, showPassword: !state.showPassword };
    case 'TOGGLE_CONFIRM_PASSWORD': return { ...state, showConfirmPassword: !state.showConfirmPassword };
    case 'HIDE_PASSWORDS':       return { ...state, showPassword: false, showConfirmPassword: false };
    case 'SET_EMAIL_FOCUSED':    return { ...state, emailFocused: action.payload };
    case 'SET_PASSWORD_FOCUSED': return { ...state, passwordFocused: action.payload };
    case 'SET_CONFIRM_FOCUSED':  return { ...state, confirmFocused: action.payload };
    case 'SET_SHOW_REQUIREMENTS': return { ...state, showRequirements: action.payload };
    case 'SET_LOADING':          return { ...state, loading: action.payload };
    case 'SET_LOCKOUT':          return { ...state, lockoutSeconds: action.payload };
    case 'SET_CAPS_LOCK':        return { ...state, capsLockOn: action.payload };
    case 'CLEAR_ERRORS':         return { ...state, emailError: '', passwordError: '', confirmPasswordError: '' };
    case 'WIPE_SENSITIVE':       return { ...state, password: '', confirmPassword: '' };
    case 'RESET':                return { ...initialForm, email: state.email };
    default: { const _: never = action; return state; }
  }
}

// ─── Web input style builder ──────────────────────────────────────
const buildWebInputStyle = (C: Tokens): Record<string, any> => ({
  outline: 'none', outlineWidth: 0, outlineColor: 'transparent',
  boxShadow: 'none', border: 'none',
  WebkitTextFillColor: C.textPrimary, caretColor: C.accent,
  backgroundColor: 'transparent',
  paddingTop: 16, paddingBottom: 16, paddingLeft: 4,
  flex: 1, fontSize: 16, letterSpacing: 0.2, color: C.textPrimary,
  direction: IS_RTL ? 'rtl' : 'ltr',
});

// ─── Animated error ───────────────────────────────────────────────
const AnimatedError = React.memo(({ message, inputId, C }: {
  message: string; inputId: string; C: Tokens;
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;

  useEffect(() => {
    if (message) {
      Animated.parallel([
        Animated.spring(opacity,    { toValue: 1, useNativeDriver: nativeDriver, speed: 20, bounciness: 0 }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: nativeDriver, speed: 20, bounciness: 4 }),
      ]).start(() => {
        if (!IS_WEB) AccessibilityInfo.announceForAccessibility(message);
      });
    } else {
      Animated.timing(opacity, { toValue: 0, duration: getAnimDuration(150), useNativeDriver: nativeDriver }).start();
      translateY.setValue(-8);
    }
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View
      style={[st.errorRow, { opacity, transform: [{ translateY }] }]}
      accessibilityLiveRegion="assertive"
      {...(IS_WEB ? ({ 'aria-live': 'assertive', 'aria-atomic': 'true', id: `${inputId}-error` } as any) : {})}
    >
      <Ionicons name="alert-circle" size={14} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={[st.errorText, { color: C.error }]} allowFontScaling maxFontSizeMultiplier={1.3}>{message}</Text>
    </Animated.View>
  );
});

// ─── Success text ─────────────────────────────────────────────────
const SuccessText = React.memo(({ message, C }: { message: string; C: Tokens }) => {
  if (!message) return null;
  return (
    <View style={st.successRow}>
      <Ionicons name="checkmark-circle" size={14} color={C.success} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={[st.successTextMsg, { color: C.success }]} allowFontScaling maxFontSizeMultiplier={1.3}>{message}</Text>
    </View>
  );
});

// ─── Pulse logo ───────────────────────────────────────────────────
const PulseLogo = React.memo(({ C, paused }: { C: Tokens; paused: boolean }) => {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (prefersReducedMotion || paused) {
      Animated.spring(pulse, { toValue: 1, useNativeDriver: nativeDriver, speed: 20, bounciness: 0 }).start();
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.08, duration: 1800, useNativeDriver: nativeDriver }),
      Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: nativeDriver }),
    ]));
    const task = InteractionManager.runAfterInteractions(() => loop.start());
    return () => { task.cancel(); loop.stop(); };
  }, [paused]);

  return (
    <Animated.View style={[st.logoOuter, { transform: [{ scale: pulse }] }]} accessible={false} accessibilityElementsHidden importantForAccessibility="no">
      <LinearGradient colors={[C.accentGlow, 'transparent']} style={st.logoGlow} />
      <View style={[st.logoCircle, { backgroundColor: C.card, borderColor: C.logoBorder, shadowColor: C.inputShadow }]}>
        <Ionicons name="person-add" size={32} color={C.accent} />
      </View>
    </Animated.View>
  );
});

// ─── Custom modal ─────────────────────────────────────────────────
type ModalButton = { label: string; onPress?: () => void | Promise<void>; primary?: boolean };
type ModalConfig = { title: string; message: string; buttons: ModalButton[] };

const CustomModal = React.memo(({ config, onClose, C }: {
  config: ModalConfig; onClose: () => void; C: Tokens;
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.9)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: getAnimDuration(200), useNativeDriver: nativeDriver }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 20, bounciness: 6 }),
    ]).start();
    if (!IS_WEB) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') doClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const doClose = useCallback(async (btn?: ModalButton) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(opacity, { toValue: 0, duration: getAnimDuration(150), useNativeDriver: nativeDriver })
      .start(async () => { if (btn?.onPress) await btn.onPress(); onClose(); });
  }, [onClose]);

  return (
    <Animated.View
      style={[st.modalOverlay, { backgroundColor: C.overlay, opacity }]}
      {...(IS_WEB ? ({ role: 'dialog', 'aria-modal': 'true' } as any) : {})}
      accessibilityViewIsModal
    >
      <Pressable style={StyleSheet.absoluteFillObject} onPress={() => doClose()} accessibilityLabel="Close dialog" />
      <Animated.View style={[st.modalCard, { backgroundColor: C.card, borderColor: C.cardBorder, transform: [{ scale }] }]}>
        <Text style={[st.modalTitle, { color: C.textPrimary }]} allowFontScaling maxFontSizeMultiplier={1.2}>{config.title}</Text>
        <Text style={[st.modalMessage, { color: C.textSecondary }]}
          {...(IS_WEB ? ({ className: 'modal-message' } as any) : {})}
          allowFontScaling maxFontSizeMultiplier={1.3}>{config.message}</Text>
        <View style={st.modalButtons}>
          {config.buttons.map((btn, i) => (
            <Pressable key={i} onPress={() => doClose(btn)}
              style={({ pressed }) => [st.modalButton, {
                backgroundColor: btn.primary ? C.accent : 'transparent',
                borderColor: btn.primary ? C.accent : C.separator,
                opacity: pressed ? 0.8 : 1,
              }]}
              accessibilityRole="button" accessibilityLabel={btn.label}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[st.modalButtonText, {
                color: btn.primary ? C.white : C.textSecondary,
                fontWeight: btn.primary ? '700' : '500',
              }]} allowFontScaling maxFontSizeMultiplier={1.2}>{btn.label}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
});

// ─── Shake hook ───────────────────────────────────────────────────
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

// ─── Gradient button ──────────────────────────────────────────────
const GradientButton = React.memo(({ onPress, disabled, loading, label, C }: {
  onPress: () => void; disabled: boolean; loading: boolean; label: string; C: Tokens;
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn  = useCallback(() => { if (!disabled && !loading) { Animated.spring(scale, { toValue: 0.97, useNativeDriver: nativeDriver, speed: 50 }).start(); triggerHaptic('light'); } }, [disabled, loading]);
  const pressOut = useCallback(() => { Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 50 }).start(); }, []);
  const colors = useMemo(() => (disabled ? [C.disabledBg, C.disabledBg] : [C.buttonGradStart, C.buttonGradEnd]) as [string, string], [disabled, C]);

  return (
    <Animated.View style={[st.buttonOuter, { shadowColor: C.accent, transform: [{ scale }] }]}>
      <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}
        disabled={disabled || loading} accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        accessibilityHint={disabled ? 'Fill in all fields correctly to enable' : undefined}
      >
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[st.button, disabled && st.buttonDisabled]}>
          {loading ? (
            <View style={st.buttonContent}>
              <ActivityIndicator color={C.white} size="small" />
              <Text style={[st.buttonText, { marginLeft: 8 }]} allowFontScaling maxFontSizeMultiplier={1.2}>Creating Account…</Text>
            </View>
          ) : (
            <View style={st.buttonContent}>
              <Text style={[st.buttonText, disabled && { color: C.textMuted }]} allowFontScaling maxFontSizeMultiplier={1.2}>{label}</Text>
              <Ionicons name={IS_RTL ? 'arrow-back' : 'arrow-forward'} size={18}
                color={disabled ? C.textMuted : C.white} style={st.buttonIcon}
                accessibilityElementsHidden importantForAccessibility="no" />
            </View>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
});

// ─── Input field ──────────────────────────────────────────────────
const InputField = React.memo(({
  label, icon, placeholder, value, onChangeText,
  error, successMsg, focused, onFocus, onBlur,
  secureTextEntry, showPassword, onTogglePassword,
  keyboardType, autoComplete, textContentType, webAutoComplete,
  returnKeyType, onSubmitEditing, inputRef, editable,
  accessibilityLabel, inputId, C, onKeyPress,
}: {
  label: string; icon: keyof typeof Ionicons.glyphMap; placeholder: string;
  value: string; onChangeText: (t: string) => void;
  error: string; successMsg?: string; focused: boolean;
  onFocus: () => void; onBlur: () => void;
  secureTextEntry?: boolean; showPassword?: boolean; onTogglePassword?: () => void;
  keyboardType?: 'default' | 'email-address';
  autoComplete?: 'email' | 'password-new' | 'current-password';
  textContentType?: 'emailAddress' | 'newPassword' | 'password';
  webAutoComplete?: string; returnKeyType?: 'next' | 'go';
  onSubmitEditing?: () => void; inputRef?: React.RefObject<TextInput>;
  editable?: boolean; accessibilityLabel: string; inputId: string;
  C: Tokens; onKeyPress?: (e: any) => void;
}) => {
  const borderAnim = useRef(new Animated.Value(0)).current;
  const hasError = !!error;
  const webStyle = useMemo(() => buildWebInputStyle(C), [C]);

  useEffect(() => {
    Animated.timing(borderAnim, { toValue: focused ? 1 : 0, duration: getAnimDuration(200), useNativeDriver: false }).start();
  }, [focused]);

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [hasError ? C.error : (successMsg ? C.success : C.inputBorder), hasError ? C.error : C.accent],
  });

  return (
    <View style={st.inputContainer}>
      <Text style={[st.inputLabel, { color: C.textSecondary }, focused && { color: C.accent }, hasError && { color: C.error }]}
        {...(IS_WEB ? ({ htmlFor: inputId } as any) : {})}
        accessibilityElementsHidden importantForAccessibility="no"
        allowFontScaling maxFontSizeMultiplier={1.2}>{label}</Text>

      <Animated.View style={[st.inputWrapper, {
        borderColor, backgroundColor: hasError ? C.errorGlow : C.inputBg,
      }, focused && [st.inputWrapperFocused, { shadowColor: C.inputShadow }]]}>
        <Ionicons name={icon} size={20} color={hasError ? C.error : focused ? C.accent : C.textMuted}
          style={st.inputIcon} accessibilityElementsHidden importantForAccessibility="no" />

        {IS_WEB ? (
          <TextInput ref={inputRef} nativeID={inputId} style={webStyle as any}
            placeholder={placeholder} placeholderTextColor={C.textMuted}
            value={value} onChangeText={onChangeText}
            secureTextEntry={secureTextEntry && !showPassword}
            keyboardType={keyboardType ?? 'default'} autoCapitalize="none" autoCorrect={false}
            autoComplete={webAutoComplete as any ?? autoComplete}
            textContentType={textContentType} editable={editable !== false}
            returnKeyType={returnKeyType} onFocus={onFocus} onBlur={onBlur}
            onSubmitEditing={onSubmitEditing} onKeyPress={onKeyPress}
            accessibilityLabel={accessibilityLabel} selectionColor={C.accent}
            {...(hasError ? ({ 'aria-describedby': `${inputId}-error`, 'aria-invalid': 'true', 'aria-required': 'true' } as any)
              : ({ 'aria-required': 'true' } as any))}
          />
        ) : (
          <TextInput ref={inputRef} nativeID={inputId}
            style={[st.inputNative, { color: C.textPrimary }]}
            placeholder={placeholder} placeholderTextColor={C.textMuted}
            value={value} onChangeText={onChangeText}
            secureTextEntry={secureTextEntry && !showPassword}
            keyboardType={keyboardType ?? 'default'} autoCapitalize="none" autoCorrect={false}
            autoComplete={autoComplete} textContentType={textContentType}
            editable={editable !== false} returnKeyType={returnKeyType}
            onFocus={onFocus} onBlur={onBlur} onSubmitEditing={onSubmitEditing}
            onKeyPress={onKeyPress} accessibilityLabel={accessibilityLabel}
            accessibilityHint={hasError ? error : undefined}
            accessibilityRequired selectionColor={C.accent}
            allowFontScaling maxFontSizeMultiplier={1.1}
          />
        )}

        {onTogglePassword && (
          <Pressable onPress={onTogglePassword} hitSlop={12} style={st.eyeButton}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            accessibilityHint={showPassword ? 'Password will be hidden' : 'Password will be visible'}
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22}
              color={focused ? C.accent : C.textMuted} />
          </Pressable>
        )}
      </Animated.View>

      <AnimatedError message={error} inputId={inputId} C={C} />
      {!error && successMsg ? <SuccessText message={successMsg} C={C} /> : null}
    </View>
  );
});

// ─── Strength bar ─────────────────────────────────────────────────
const StrengthBar = React.memo(({ password, C }: { password: string; C: Tokens }) => {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const strength  = useMemo(() => validators.strength(password, C), [password, C]);

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: strength.percent, duration: getAnimDuration(300), useNativeDriver: false,
    }).start();
  }, [strength.percent]);

  if (!password) return null;

  const animWidth = widthAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <View style={st.strengthContainer} accessibilityLabel={`Password strength: ${strength.level}`}>
      <View style={[st.strengthBarBg, { backgroundColor: C.inputBorder }]}>
        <Animated.View style={[st.strengthBar, { width: animWidth, backgroundColor: strength.color }]} />
      </View>
      <Text style={[st.strengthText, { color: strength.color }]} allowFontScaling maxFontSizeMultiplier={1.2}>
        {strength.level}
      </Text>
    </View>
  );
});

// ─── Password requirements ────────────────────────────────────────
const PasswordRequirements = React.memo(({ password, C }: { password: string; C: Tokens }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const v       = useMemo(() => validators.password(password), [password]);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: getAnimDuration(300), useNativeDriver: nativeDriver }).start();
  }, []);

  const items = [
    { key: 'length',    label: 'At least 8 characters' },
    { key: 'uppercase', label: 'One uppercase letter (A-Z)' },
    { key: 'lowercase', label: 'One lowercase letter (a-z)' },
    { key: 'number',    label: 'One number (0-9)' },
    { key: 'special',   label: 'One special character (!@#$%^&*)' },
  ];

  return (
    <Animated.View style={[st.requirementsContainer, { backgroundColor: C.requirementsBg, borderColor: C.cardBorder, opacity }]}
      accessibilityLiveRegion="polite">
      <Text style={[st.requirementsTitle, { color: C.textMuted }]} allowFontScaling maxFontSizeMultiplier={1.2}>
        Password must have:
      </Text>
      {items.map(item => {
        const met = v.checks[item.key];
        return (
          <View key={item.key} style={st.requirementRow}>
            <Ionicons name={met ? 'checkmark-circle' : 'close-circle'} size={16}
              color={met ? C.success : C.textMuted} style={{ marginRight: 8 }} />
            <Text style={[st.requirementText, { color: met ? C.success : C.textMuted }]}
              allowFontScaling maxFontSizeMultiplier={1.2}>{item.label}</Text>
          </View>
        );
      })}
    </Animated.View>
  );
});

// ─── Lockout banner ───────────────────────────────────────────────
const LockoutBanner = React.memo(({ seconds, C }: { seconds: number; C: Tokens }) => {
  if (seconds <= 0) return null;
  return (
    <View style={[st.lockoutBanner, { backgroundColor: C.errorGlow, borderColor: C.error }]}
      accessibilityLiveRegion="polite" accessibilityLabel={`Too many attempts. Try again in ${seconds} seconds.`}>
      <Ionicons name="time-outline" size={16} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={[st.lockoutText, { color: C.error }]} allowFontScaling maxFontSizeMultiplier={1.2}>
        Too many attempts — try again in <Text style={{ fontWeight: '800' }}>{seconds}s</Text>
      </Text>
    </View>
  );
});

// ─── Success overlay ──────────────────────────────────────────────
const SuccessOverlay = React.memo(({ C }: { C: Tokens }) => {
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const iconS   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: getAnimDuration(200), useNativeDriver: nativeDriver }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 14, bounciness: 8 }),
      ]),
      Animated.spring(iconS, { toValue: 1, useNativeDriver: nativeDriver, speed: 10, bounciness: 12 }),
    ]).start();
    if (!IS_WEB) AccessibilityInfo.announceForAccessibility('Account created successfully! Redirecting to login.');
  }, []);

  return (
    <Animated.View style={[st.successOverlay, { backgroundColor: C.overlay, opacity }]}
      pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="assertive">
      <Animated.View style={[st.successCard, { backgroundColor: C.card, borderColor: C.cardBorder, transform: [{ scale }] }]}
        accessibilityRole="alert" accessibilityLabel="Account created successfully. Redirecting to login.">
        <Animated.View style={{ transform: [{ scale: iconS }] }}>
          <Ionicons name="checkmark-circle" size={64} color={C.success} />
        </Animated.View>
        <Text style={[st.successTitleText, { color: C.textPrimary }]} allowFontScaling maxFontSizeMultiplier={1.2}>Account Created!</Text>
        <Text style={[st.successSub, { color: C.textSecondary }]} allowFontScaling maxFontSizeMultiplier={1.3}>
          Check your email to verify.
        </Text>
        <ActivityIndicator size="small" color={C.accent} style={{ marginTop: 4 }} />
      </Animated.View>
    </Animated.View>
  );
});

// ─── Error boundary ───────────────────────────────────────────────
class SignupErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: Error, i: React.ErrorInfo) { console.error('[SignupScreen]', e, i); }
  render() {
    if (this.state.hasError) {
      return (
        <View style={[st.errorFallback, { backgroundColor: darkTokens.bg }]}>
          <Ionicons name="warning-outline" size={48} color={darkTokens.error} />
          <Text style={[st.errorFallbackTitle, { color: darkTokens.textPrimary }]}>Something went wrong</Text>
          <TouchableOpacity onPress={() => this.setState({ hasError: false })}
            style={[st.retryButton, { borderColor: darkTokens.accent }]} accessibilityRole="button">
            <Text style={[st.retryText, { color: darkTokens.accent }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════
// ─── Main screen ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
export default function SignupScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const C: Tokens = isDark ? darkTokens : lightTokens;

  useEffect(() => { injectWebStyles(C, isDark ? 'dark' : 'light'); }, [isDark]);

  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const h = (e: MediaQueryListEvent) => { prefersReducedMotion = e.matches; };
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  const [state, dispatch]     = useReducer(formReducer, initialForm);
  const [screenData, setSD]   = useState(getScreenData);
  const [showSuccess, setSS]  = useState(false);
  const [modal, setModal]     = useState<ModalConfig | null>(null);
  const [appActive, setApp]   = useState(true);

  const isMounted     = useRef(true);
  const signupAttempts = useRef(0);
  const lockoutUntil  = useRef(0);
  const lockoutTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const navTimeout    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordRef   = useRef<TextInput>(null);
  const confirmRef    = useRef<TextInput>(null);
  const emailRef      = useRef<TextInput>(null);
  const scrollRef     = useRef<ScrollView>(null);

  const { shakeAnim, shake } = useShake();

  // Entrance anims
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const slideAnim   = useRef(new Animated.Value(prefersReducedMotion ? 0 : 40)).current;
  const headerFade  = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(prefersReducedMotion ? 0 : 20)).current;
  const formFade    = useRef(new Animated.Value(0)).current;
  const formSlide   = useRef(new Animated.Value(prefersReducedMotion ? 0 : 20)).current;
  const footerFade  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (lockoutTimer.current) clearInterval(lockoutTimer.current);
      if (navTimeout.current) clearTimeout(navTimeout.current);
      if (typingTimer.current) clearTimeout(typingTimer.current);
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
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setApp(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.loading || showSuccess) return true;
      return false;
    });
    return () => sub.remove();
  }, [state.loading, showSuccess]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (!isMounted.current) return;
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: getAnimDuration(300), useNativeDriver: nativeDriver }),
        Animated.timing(slideAnim, { toValue: 0, duration: getAnimDuration(400), useNativeDriver: nativeDriver }),
        Animated.stagger(getAnimDuration(150), [
          Animated.parallel([
            Animated.timing(headerFade,  { toValue: 1, duration: getAnimDuration(500), useNativeDriver: nativeDriver }),
            Animated.timing(headerSlide, { toValue: 0, duration: getAnimDuration(500), useNativeDriver: nativeDriver }),
          ]),
          Animated.parallel([
            Animated.timing(formFade,  { toValue: 1, duration: getAnimDuration(500), useNativeDriver: nativeDriver }),
            Animated.timing(formSlide, { toValue: 0, duration: getAnimDuration(500), useNativeDriver: nativeDriver }),
          ]),
          Animated.timing(footerFade, { toValue: 1, duration: getAnimDuration(400), useNativeDriver: nativeDriver }),
        ]),
      ]).start();
    });
    return () => task.cancel();
  }, []);

  const startLockout = useCallback(() => {
    if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    const tick = () => {
      if (!isMounted.current) return;
      const r = Math.ceil((lockoutUntil.current - Date.now()) / 1000);
      if (r <= 0) { dispatch({ type: 'SET_LOCKOUT', payload: 0 }); if (lockoutTimer.current) { clearInterval(lockoutTimer.current); lockoutTimer.current = null; } }
      else dispatch({ type: 'SET_LOCKOUT', payload: r });
    };
    tick();
    lockoutTimer.current = setInterval(tick, 1000);
  }, []);

  const openModal  = useCallback((c: ModalConfig) => setModal(c), []);
  const closeModal = useCallback(() => setModal(null), []);

  const showAppAlert = useCallback((title: string, message: string, buttons?: AlertButton[]) => {
    if (IS_WEB) {
      openModal({
        title, message,
        buttons: (buttons ?? [{ text: 'OK' }]).map((b, _, arr) => ({
          label: b.text, onPress: b.onPress,
          primary: b.style !== 'cancel' && arr.length > 1,
        })),
      });
    } else {
      showNativeAlert(title, message, buttons);
    }
  }, [openModal]);

  const handleKeyPress = useCallback((e: any) => {
    if (!IS_WEB || !e?.nativeEvent?.key) return;
    dispatch({ type: 'SET_CAPS_LOCK', payload: e.nativeEvent.getModifierState?.('CapsLock') ?? false });
  }, []);

  // Derived validation
  const pwValidation = useMemo(() => validators.password(state.password), [state.password]);
  const passwordsMatch = state.password === state.confirmPassword;
  const emailValid = state.email.length >= MIN_EMAIL_DISPLAY && !validators.email(state.email);

  const canSubmit = useMemo(() => !!(
    state.email.trim() && emailValid &&
    pwValidation.valid && passwordsMatch &&
    state.confirmPassword.length > 0 &&
    !state.loading && state.lockoutSeconds === 0
  ), [state.email, emailValid, pwValidation.valid, passwordsMatch, state.confirmPassword, state.loading, state.lockoutSeconds]);

  // Focus handlers
  const onEmailFocus   = useCallback(() => dispatch({ type: 'SET_EMAIL_FOCUSED', payload: true }), []);
  const onEmailBlur    = useCallback(() => dispatch({ type: 'SET_EMAIL_FOCUSED', payload: false }), []);
  const onPwFocus      = useCallback(() => { dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: true }); dispatch({ type: 'SET_SHOW_REQUIREMENTS', payload: true }); }, []);
  const onPwBlur       = useCallback(() => { dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: false }); dispatch({ type: 'HIDE_PASSWORDS' }); }, []);
  const onConfirmFocus = useCallback(() => dispatch({ type: 'SET_CONFIRM_FOCUSED', payload: true }), []);
  const onConfirmBlur  = useCallback(() => { dispatch({ type: 'SET_CONFIRM_FOCUSED', payload: false }); dispatch({ type: 'HIDE_PASSWORDS' }); }, []);
  const togglePw       = useCallback(() => dispatch({ type: 'TOGGLE_PASSWORD' }), []);
  const toggleConfirm  = useCallback(() => dispatch({ type: 'TOGGLE_CONFIRM_PASSWORD' }), []);

  const validateEmail = useCallback((text: string) => {
    const s = text.trimStart().slice(0, MAX_EMAIL_LENGTH + 1).replace(/[\n\r]/g, '');
    dispatch({ type: 'SET_EMAIL', payload: s });
    if (s.length < MIN_EMAIL_DISPLAY) { dispatch({ type: 'SET_EMAIL_ERROR', payload: '' }); return; }
    dispatch({ type: 'SET_EMAIL_ERROR', payload: validators.email(s) });
  }, []);

  const validatePassword = useCallback((text: string) => {
    const s = text.slice(0, MAX_PASSWORD_LENGTH + 1);
    dispatch({ type: 'SET_PASSWORD', payload: s });
  }, []);

  const validateConfirm = useCallback((text: string) => {
    const s = text.slice(0, MAX_PASSWORD_LENGTH + 1);
    dispatch({ type: 'SET_CONFIRM', payload: s });
  }, []);

  const dismissKeyboard = useCallback(() => { if (!IS_WEB) Keyboard.dismiss(); }, []);

  const handleSignup = useCallback(async () => {
    dismissKeyboard();
    dispatch({ type: 'CLEAR_ERRORS' });

    const email = state.email.trim().toLowerCase();
    const eErr = validators.email(email);
    if (eErr) { dispatch({ type: 'SET_EMAIL_ERROR', payload: eErr }); shake(); return; }
    if (!pwValidation.valid) {
      shake();
      showAppAlert('Password Requirements', 'Your password must meet all requirements:\n\n' + pwValidation.errors.map(e => `• ${e}`).join('\n'));
      return;
    }
    if (!passwordsMatch) {
      dispatch({ type: 'SET_CONFIRM_ERROR', payload: 'Passwords do not match' }); shake(); return;
    }
    if (Date.now() < lockoutUntil.current) { startLockout(); shake(); return; }

    showAppAlert('Create Account', `Create account with:\n${email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        onPress: async () => {
          dispatch({ type: 'SET_LOADING', payload: true });
          dispatch({ type: 'HIDE_PASSWORDS' });

          try {
            const { user } = await createUserWithEmailAndPassword(auth, email, state.password);
            await sendEmailVerification(user);
            await auth.signOut();

            dispatch({ type: 'WIPE_SENSITIVE' });
            triggerHaptic('success');

            if (!isMounted.current) return;
            dispatch({ type: 'SET_LOADING', payload: false });
            setSS(true);

            navTimeout.current = setTimeout(() => {
              if (isMounted.current) router.replace(ROUTES.LOGIN);
            }, getAnimDuration(SUCCESS_NAV_DELAY_MS));

          } catch (error: any) {
            signupAttempts.current += 1;
            if (signupAttempts.current >= MAX_SIGNUP_ATTEMPTS) {
              lockoutUntil.current = Date.now() + LOCKOUT_DURATION_MS;
              signupAttempts.current = 0;
              startLockout();
            }
            triggerHaptic('error'); shake();

            if (!isMounted.current) return;
            if (error.code === 'auth/email-already-in-use' || error.code === 'auth/invalid-email') {
              dispatch({ type: 'SET_EMAIL_ERROR', payload: getErrorMessage(error.code) });
              setTimeout(() => emailRef.current?.focus(), FOCUS_DELAY_MS);
            }
            showAppAlert('Signup Failed', getErrorMessage(error.code));
            dispatch({ type: 'SET_LOADING', payload: false });
          }
        },
      },
    ]);
  }, [state.email, state.password, state.confirmPassword, pwValidation, passwordsMatch,
      dismissKeyboard, shake, showAppAlert, startLockout, router]);

  const handleLogin      = useCallback(() => { if (!state.loading) router.replace(ROUTES.LOGIN); }, [state.loading, router]);
  const handleTerms = useCallback(() => {
  Linking.openURL('https://myarchetype.vercel.app/terms');
}, []);

const handlePrivacy = useCallback(() => {
  Linking.openURL('https://myarchetype.vercel.app/privacy');
}, []);
  const focusPassword    = useCallback(() => passwordRef.current?.focus(), []);
  const focusConfirm     = useCallback(() => confirmRef.current?.focus(), []);

  const IS_SMALL = screenData.isSmall;

  // Email success message
  const emailSuccessMsg = emailValid && !state.emailError ? 'Valid email' : '';
  // Confirm success message
  const confirmSuccessMsg = state.confirmPassword.length > 5 && passwordsMatch && !state.confirmPasswordError ? 'Passwords match' : '';
  // Confirm error
  const confirmError = state.confirmPassword.length > 0 && !passwordsMatch ? 'Passwords do not match' : state.confirmPasswordError;

  const logoPaused = state.emailFocused || state.passwordFocused || state.confirmFocused || !appActive;

  return (
    <SignupErrorBoundary>
      <View style={[st.rootBg, { backgroundColor: C.bg }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} translucent={false} />
        <LinearGradient colors={[C.bgGradientStart, C.bgGradientMid, C.bgGradientEnd]}
          style={StyleSheet.absoluteFill} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />

        <SafeAreaView style={st.safe}>
          <KeyboardAvoidingView
            behavior={Platform.select({ ios: 'padding', android: 'height', default: undefined })}
            style={st.container} keyboardVerticalOffset={IS_IOS ? 0 : 20}>

            {IS_WEB ? (
              <View style={st.fill}>
                <ScrollView ref={scrollRef} contentContainerStyle={[st.scrollContent, { padding: IS_SMALL ? 18 : 24, paddingTop: IS_SMALL ? 20 : 32 }]}
                  keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>

                  <Animated.View style={[st.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }], maxWidth: IS_SMALL ? 400 : 440 }]}>
                    {/* Back button */}
                    <TouchableOpacity onPress={handleLogin} style={st.backButton} disabled={state.loading}
                      accessibilityRole="button" accessibilityLabel="Back to login" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Ionicons name={IS_RTL ? 'arrow-forward' : 'arrow-back'} size={24} color={C.accent} />
                    </TouchableOpacity>

                    {/* Header */}
                    <Animated.View style={[st.headerContainer, { opacity: headerFade, transform: [{ translateY: headerSlide }], marginBottom: IS_SMALL ? 24 : 36 }]}>
                      <PulseLogo C={C} paused={logoPaused} />
                      <Text style={[st.title, { color: C.textPrimary, fontSize: IS_SMALL ? 26 : 32 }]}
                        accessibilityRole="header" allowFontScaling maxFontSizeMultiplier={1.2}>Create Account</Text>
                      <Text style={[st.subtitle, { color: C.textSecondary, fontSize: IS_SMALL ? 14 : 16 }]}
                        allowFontScaling maxFontSizeMultiplier={1.3}>Join MyArchetype today</Text>
                    </Animated.View>

                    <LockoutBanner seconds={state.lockoutSeconds} C={C} />

                    {/* Form */}
                    <Animated.View style={[st.formCard, {
                      opacity: formFade, transform: [{ translateX: shakeAnim }, { translateY: formSlide }],
                      backgroundColor: C.card, borderColor: C.cardBorder, padding: IS_SMALL ? 20 : 28,
                    }]} {...(IS_WEB ? ({ role: 'form', 'aria-label': 'Signup form' } as any) : {})}>

                      <InputField inputId="signup-email" label="Email" icon="mail-outline"
                        placeholder="your@email.com" value={state.email} onChangeText={validateEmail}
                        error={state.emailError} successMsg={emailSuccessMsg}
                        focused={state.emailFocused} onFocus={onEmailFocus} onBlur={onEmailBlur}
                        keyboardType="email-address" autoComplete="email" webAutoComplete="email"
                        textContentType="emailAddress" returnKeyType="next" onSubmitEditing={focusPassword}
                        inputRef={emailRef} editable={!state.loading} accessibilityLabel="Email address"
                        C={C} onKeyPress={handleKeyPress} />

                      <InputField inputId="signup-password" label="Password" icon="lock-closed-outline"
                        placeholder="Create a strong password" value={state.password} onChangeText={validatePassword}
                        error={state.passwordError} focused={state.passwordFocused}
                        onFocus={onPwFocus} onBlur={onPwBlur}
                        secureTextEntry showPassword={state.showPassword} onTogglePassword={togglePw}
                        autoComplete="password-new" webAutoComplete="new-password"
                        textContentType="newPassword" returnKeyType="next" onSubmitEditing={focusConfirm}
                        inputRef={passwordRef} editable={!state.loading} accessibilityLabel="Password"
                        C={C} onKeyPress={handleKeyPress} />

                      <StrengthBar password={state.password} C={C} />
                      {state.showRequirements && state.password.length > 0 && (
                        <PasswordRequirements password={state.password} C={C} />
                      )}

                      <InputField inputId="signup-confirm" label="Confirm Password" icon="lock-closed-outline"
                        placeholder="Confirm your password" value={state.confirmPassword} onChangeText={validateConfirm}
                        error={confirmError} successMsg={confirmSuccessMsg}
                        focused={state.confirmFocused} onFocus={onConfirmFocus} onBlur={onConfirmBlur}
                        secureTextEntry showPassword={state.showConfirmPassword} onTogglePassword={toggleConfirm}
                        autoComplete="password-new" webAutoComplete="new-password"
                        textContentType="newPassword" returnKeyType="go"
                        onSubmitEditing={canSubmit ? handleSignup : undefined}
                        inputRef={confirmRef} editable={!state.loading} accessibilityLabel="Confirm password"
                        C={C} onKeyPress={handleKeyPress} />

                      {IS_WEB && state.capsLockOn && (state.passwordFocused || state.confirmFocused) && (
                        <View style={[st.capsLockRow, { backgroundColor: C.errorGlow, borderColor: C.warn }]}
                          accessibilityLiveRegion="polite" accessibilityLabel="Caps Lock is on">
                          <Ionicons name="warning-outline" size={14} color={C.warn} />
                          <Text style={[st.capsLockText, { color: C.warn }]} allowFontScaling maxFontSizeMultiplier={1.2}>Caps Lock is on</Text>
                        </View>
                      )}

                      <GradientButton onPress={handleSignup} disabled={!canSubmit} loading={state.loading}
                        label="Create Account" C={C} />
                    </Animated.View>

                    {/* Footer */}
                    <Animated.View style={[st.footer, { opacity: footerFade }]}>
                      <View style={st.legalContainer}>
                        <Text style={[st.legalText, { color: C.textMuted }]} allowFontScaling maxFontSizeMultiplier={1.2}>
                          By signing up, you agree to our
                        </Text>
                        <View style={st.legalRow}>
<TouchableOpacity onPress={handleTerms} accessibilityRole="link" accessibilityLabel="Terms of Service"                          
                            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                            <Text style={[st.legalLink, { color: C.accent }]} allowFontScaling maxFontSizeMultiplier={1.2}>
                              Terms of Service
                            </Text>
                          </TouchableOpacity>
                          <Text style={[st.legalText, { color: C.textMuted }]}> and </Text>
<TouchableOpacity onPress={handlePrivacy} accessibilityRole="link" accessibilityLabel="Privacy Policy"
                            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                            <Text style={[st.legalLink, { color: C.accent }]} allowFontScaling maxFontSizeMultiplier={1.2}>
                              Privacy Policy
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={st.separatorRow} accessibilityElementsHidden importantForAccessibility="no">
                        <View style={[st.separatorLine, { backgroundColor: C.separator }]} />
                        <Text style={[st.separatorText, { color: C.textMuted }]}>or</Text>
                        <View style={[st.separatorLine, { backgroundColor: C.separator }]} />
                      </View>

                      <TouchableOpacity onPress={handleLogin} disabled={state.loading} activeOpacity={0.7}
                        style={st.loginButton} accessibilityRole="button" accessibilityLabel="Go to login"
                        hitSlop={{ top: 4, bottom: 4 }}>
                        <Text style={[st.loginText, { color: C.textSecondary }]} allowFontScaling maxFontSizeMultiplier={1.2}>
                          Already have an account? <Text style={[st.loginLink, { color: C.accent }]}>Log In</Text>
                        </Text>
                      </TouchableOpacity>
                    </Animated.View>
                  </Animated.View>
                </ScrollView>
              </View>
            ) : (
              <Pressable style={st.fill} onPress={dismissKeyboard}>
                <ScrollView ref={scrollRef} contentContainerStyle={[st.scrollContent, { padding: IS_SMALL ? 18 : 24, paddingTop: IS_SMALL ? 20 : 32 }]}
                  keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>

                  <Animated.View style={[st.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }], maxWidth: IS_SMALL ? 400 : 440 }]}>
                    <TouchableOpacity onPress={handleLogin} style={st.backButton} disabled={state.loading}
                      accessibilityRole="button" accessibilityLabel="Back to login" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Ionicons name={IS_RTL ? 'arrow-forward' : 'arrow-back'} size={24} color={C.accent} />
                    </TouchableOpacity>

                    <Animated.View style={[st.headerContainer, { opacity: headerFade, transform: [{ translateY: headerSlide }], marginBottom: IS_SMALL ? 24 : 36 }]}>
                      <PulseLogo C={C} paused={logoPaused} />
                      <Text style={[st.title, { color: C.textPrimary, fontSize: IS_SMALL ? 26 : 32 }]}
                        accessibilityRole="header" allowFontScaling maxFontSizeMultiplier={1.2}>Create Account</Text>
                      <Text style={[st.subtitle, { color: C.textSecondary, fontSize: IS_SMALL ? 14 : 16 }]}
                        allowFontScaling maxFontSizeMultiplier={1.3}>Join MyArchetype today</Text>
                    </Animated.View>

                    <LockoutBanner seconds={state.lockoutSeconds} C={C} />

                    <Animated.View style={[st.formCard, {
                      opacity: formFade, transform: [{ translateX: shakeAnim }, { translateY: formSlide }],
                      backgroundColor: C.card, borderColor: C.cardBorder, padding: IS_SMALL ? 20 : 28,
                    }]}>
                      <InputField inputId="signup-email" label="Email" icon="mail-outline"
                        placeholder="your@email.com" value={state.email} onChangeText={validateEmail}
                        error={state.emailError} successMsg={emailSuccessMsg}
                        focused={state.emailFocused} onFocus={onEmailFocus} onBlur={onEmailBlur}
                        keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
                        returnKeyType="next" onSubmitEditing={focusPassword}
                        inputRef={emailRef} editable={!state.loading} accessibilityLabel="Email address"
                        C={C} onKeyPress={handleKeyPress} />

                      <InputField inputId="signup-password" label="Password" icon="lock-closed-outline"
                        placeholder="Create a strong password" value={state.password} onChangeText={validatePassword}
                        error={state.passwordError} focused={state.passwordFocused}
                        onFocus={onPwFocus} onBlur={onPwBlur}
                        secureTextEntry showPassword={state.showPassword} onTogglePassword={togglePw}
                        autoComplete="password-new" textContentType="newPassword"
                        returnKeyType="next" onSubmitEditing={focusConfirm}
                        inputRef={passwordRef} editable={!state.loading} accessibilityLabel="Password"
                        C={C} onKeyPress={handleKeyPress} />

                      <StrengthBar password={state.password} C={C} />
                      {state.showRequirements && state.password.length > 0 && (
                        <PasswordRequirements password={state.password} C={C} />
                      )}

                      <InputField inputId="signup-confirm" label="Confirm Password" icon="lock-closed-outline"
                        placeholder="Confirm your password" value={state.confirmPassword} onChangeText={validateConfirm}
                        error={confirmError} successMsg={confirmSuccessMsg}
                        focused={state.confirmFocused} onFocus={onConfirmFocus} onBlur={onConfirmBlur}
                        secureTextEntry showPassword={state.showConfirmPassword} onTogglePassword={toggleConfirm}
                        autoComplete="password-new" textContentType="newPassword"
                        returnKeyType="go" onSubmitEditing={canSubmit ? handleSignup : undefined}
                        inputRef={confirmRef} editable={!state.loading} accessibilityLabel="Confirm password"
                        C={C} onKeyPress={handleKeyPress} />

                      {IS_WEB && state.capsLockOn && (state.passwordFocused || state.confirmFocused) && (
                        <View style={[st.capsLockRow, { backgroundColor: C.errorGlow, borderColor: C.warn }]}>
                          <Ionicons name="warning-outline" size={14} color={C.warn} />
                          <Text style={[st.capsLockText, { color: C.warn }]}>Caps Lock is on</Text>
                        </View>
                      )}

                      <GradientButton onPress={handleSignup} disabled={!canSubmit} loading={state.loading}
                        label="Create Account" C={C} />
                    </Animated.View>

                    <Animated.View style={[st.footer, { opacity: footerFade }]}>
                      <View style={st.legalContainer}>
                        <Text style={[st.legalText, { color: C.textMuted }]} allowFontScaling maxFontSizeMultiplier={1.2}>
                          By signing up, you agree to our
                        </Text>
                        <View style={st.legalRow}>
<TouchableOpacity onPress={handleTerms} accessibilityRole="link" accessibilityLabel="Terms of Service"
                            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                            <Text style={[st.legalLink, { color: C.accent }]}>Terms of Service</Text>
                          </TouchableOpacity>
                          <Text style={[st.legalText, { color: C.textMuted }]}> and </Text>
<TouchableOpacity onPress={handlePrivacy} accessibilityRole="link" accessibilityLabel="Privacy Policy"
                            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                            <Text style={[st.legalLink, { color: C.accent }]}>Privacy Policy</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={st.separatorRow} accessibilityElementsHidden importantForAccessibility="no">
                        <View style={[st.separatorLine, { backgroundColor: C.separator }]} />
                        <Text style={[st.separatorText, { color: C.textMuted }]}>or</Text>
                        <View style={[st.separatorLine, { backgroundColor: C.separator }]} />
                      </View>

                      <TouchableOpacity onPress={handleLogin} disabled={state.loading} activeOpacity={0.7}
                        style={st.loginButton} accessibilityRole="button" accessibilityLabel="Go to login"
                        hitSlop={{ top: 4, bottom: 4 }}>
                        <Text style={[st.loginText, { color: C.textSecondary }]} allowFontScaling maxFontSizeMultiplier={1.2}>
                          Already have an account? <Text style={[st.loginLink, { color: C.accent }]}>Log In</Text>
                        </Text>
                      </TouchableOpacity>
                    </Animated.View>
                  </Animated.View>
                </ScrollView>
              </Pressable>
            )}

            {state.loading && !showSuccess && (
              <View style={[st.loadingOverlay, { backgroundColor: C.overlay }]}
                pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="polite">
                <View style={[st.loadingCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}
                  accessibilityRole="alert" accessibilityLabel="Creating your account, please wait">
                  <ActivityIndicator size="large" color={C.accent} />
                  <Text style={[st.loadingText, { color: C.textSecondary }]} allowFontScaling maxFontSizeMultiplier={1.2}>
                    Creating your account…
                  </Text>
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

// ─── Styles ───────────────────────────────────────────────────────
const st = StyleSheet.create({
  rootBg: { flex: 1 }, safe: { flex: 1 }, container: { flex: 1 }, fill: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: 40 },
  content: { width: '100%', alignSelf: 'center' },

  backButton: { position: 'absolute', top: 0, left: 0, zIndex: 10, padding: 8, borderRadius: 20 },

  headerContainer: { alignItems: 'center' },
  logoOuter: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  logoGlow: { ...StyleSheet.absoluteFillObject, borderRadius: 50, transform: [{ scale: 1.4 }] },
  logoCircle: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  title: { fontWeight: '800', marginBottom: 8, letterSpacing: 0.3 },
  subtitle: { textAlign: 'center', lineHeight: 22 },

  lockoutBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 16,
  },
  lockoutText: { fontSize: 13, fontWeight: '600', flex: 1 },

  formCard: {
    borderRadius: 24, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4, shadowRadius: 24, elevation: 14,
  },

  inputContainer: { marginBottom: 22 },
  inputLabel: { fontSize: 12, fontWeight: '700', marginBottom: 8, marginLeft: 4, letterSpacing: 1, textTransform: 'uppercase' },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 16, minHeight: 56,
  },
  inputWrapperFocused: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 4 },
  inputIcon: { marginRight: 12, width: 22, textAlign: 'center' },
  inputNative: { flex: 1, fontSize: 16, paddingVertical: IS_IOS ? 16 : 13, letterSpacing: 0.2, backgroundColor: 'transparent' },
  eyeButton: { padding: 8, marginLeft: 4, borderRadius: 20 },

  errorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginLeft: 4, gap: 5 },
  errorText: { fontSize: 12, fontWeight: '500', flex: 1 },
  successRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginLeft: 4, gap: 5 },
  successTextMsg: { fontSize: 12, fontWeight: '500' },

  strengthContainer: {
    flexDirection: 'row', alignItems: 'center', marginTop: -10, marginBottom: 20, gap: 10,
  },
  strengthBarBg: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  strengthBar: { height: '100%', borderRadius: 3 },
  strengthText: { fontSize: 12, fontWeight: '600', width: 55, textAlign: IS_RTL ? 'left' : 'right' },

  requirementsContainer: {
    padding: 14, borderRadius: 12, marginBottom: 20, borderWidth: 1,
  },
  requirementsTitle: { fontSize: 12, marginBottom: 10, fontWeight: '600' },
  requirementRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  requirementText: { fontSize: 13 },

  capsLockRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 8, borderRadius: 8, borderWidth: 1, marginBottom: 12, marginTop: -8,
  },
  capsLockText: { fontSize: 12, fontWeight: '600' },

  buttonOuter: {
    width: '100%', borderRadius: 16, marginTop: 8,
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8,
  },
  button: { paddingVertical: 17, borderRadius: 16, alignItems: 'center', justifyContent: 'center', minHeight: 56 },
  buttonDisabled: { shadowOpacity: 0, elevation: 0 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '700', letterSpacing: 0.5 },
  buttonIcon: { marginTop: 1 },

  footer: { alignItems: 'center', marginTop: 28 },
  legalContainer: { alignItems: 'center', paddingHorizontal: 16 },
  legalText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  legalRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 },
  legalLink: { fontSize: 13, fontWeight: '600' },
  separatorRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 24, width: '100%', paddingHorizontal: 16 },
  separatorLine: { flex: 1, height: StyleSheet.hairlineWidth },
  separatorText: { fontSize: 13, marginHorizontal: 16, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  loginButton: { paddingVertical: 12, paddingHorizontal: 24 },
  loginText: { fontSize: 15, lineHeight: 22 },
  loginLink: { fontWeight: '700' },

  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  loadingCard: {
    borderRadius: 20, padding: 32, alignItems: 'center', gap: 16, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 16, minWidth: 160,
  },
  loadingText: { fontSize: 14, fontWeight: '500' },

  successOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  successCard: {
    borderRadius: 24, padding: 40, alignItems: 'center', gap: 16, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 20,
  },
  successTitleText: { fontSize: 22, fontWeight: '800' },
  successSub: { fontSize: 14, fontWeight: '500', marginTop: -8 },

  modalOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: 24 },
  modalCard: {
    width: '100%', maxWidth: 400, borderRadius: 20, padding: 28, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.5, shadowRadius: 24, elevation: 24, gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  modalMessage: { fontSize: 14, lineHeight: 22 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
  modalButton: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1 },
  modalButtonText: { fontSize: 14 },

  errorFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  errorFallbackTitle: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  retryButton: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12, borderWidth: 1.5 },
  retryText: { fontSize: 15, fontWeight: '700' },
});