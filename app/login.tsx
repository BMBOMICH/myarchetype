// ─── Web-only DOM type declarations ───────────────────────────────
/* eslint-disable no-var */
declare var window: any;
declare var document: any;
/* eslint-enable no-var */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
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
  Appearance,
  AppState,
  type AppStateStatus,
  BackHandler,
  Dimensions,
  I18nManager,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
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
import {
  ensureMyE2EEIdentity,
  getLocalE2EEKeypair,
} from '../utils/e2ee';

// ─── Platform flags ───────────────────────────────────────────────
const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';
const IS_ANDROID = Platform.OS === 'android';
const IS_RTL = I18nManager.isRTL;

// ─── Route constants ──────────────────────────────────────────────
const ROUTES = {
  HOME: '/home' as const,
  SIGNUP: '/signup' as const,
};

// ─── Timing constants ─────────────────────────────────────────────
const SUCCESS_NAV_DELAY_MS = 1000;
const LOCKOUT_DURATION_MS = 60_000;
const TYPING_PAUSE_MS = 3000;
const RESIZE_DEBOUNCE_MS = 150;
const FOCUS_RETURN_DELAY_MS = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

// ─── Validation / security constants ─────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_RESEND_ATTEMPTS = 3;
const MAX_FORGOT_ATTEMPTS = 3;

// ─── Responsive ───────────────────────────────────────────────────
const getScreenData = () => {
  const { width, height } = Dimensions.get('window');
  return {
    width,
    height,
    isSmall: width < 375,
    isMedium: width >= 375 && width < 768,
    isLarge: width >= 768,
  };
};

// ─── Reduced motion ───────────────────────────────────────────────
const getReducedMotion = (): boolean => {
  if (!IS_WEB || typeof window === 'undefined') return false;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
};
let prefersReducedMotion = getReducedMotion();
const nativeDriver = !IS_WEB;
const getAnimDuration = (ms: number) => (prefersReducedMotion ? 0 : ms);

// ─── Debounce helper ──────────────────────────────────────────────
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

// ─── Design tokens ────────────────────────────────────────────────
const darkTokens = {
  bg: '#07070f',
  bgGradientStart: '#0a0a18',
  bgGradientMid: '#0e0e24',
  bgGradientEnd: '#07070f',
  card: '#111128',
  cardBorder: '#1e1e48',
  inputBg: '#0d0d24',
  inputBorder: '#28285a',
  accent: '#6C63FF',
  accentSoft: '#8B83FF',
  accentGlow: 'rgba(108,99,255,0.10)',
  accentGlowStrong: 'rgba(108,99,255,0.22)',
  error: '#FF6B6B',
  errorGlow: 'rgba(255,107,107,0.07)',
  warn: '#FFB347',
  success: '#51CF66',
  successGlow: 'rgba(81,207,102,0.07)',
  textPrimary: '#EDEDFF',
  textSecondary: '#9494B8',
  textMuted: '#64648a',
  white: '#ffffff',
  overlay: 'rgba(4,4,12,0.92)',
  separator: '#1e1e48',
  buttonGradStart: '#7B73FF',
  buttonGradEnd: '#5A4FE6',
  disabledBg: '#181834',
  disabledText: '#40406a',
  inputShadow: '#6C63FF',
  logoBorder: '#28285a',
  autofillBg: '#0d0d24',
  autofillText: '#EDEDFF',
  autofillCaret: '#6C63FF',
} as const;

const lightTokens = {
  bg: '#F0F2F8',
  bgGradientStart: '#E8EAF4',
  bgGradientMid: '#E0E3F0',
  bgGradientEnd: '#F0F2F8',
  card: '#FFFFFF',
  cardBorder: '#D4D8E8',
  inputBg: '#F4F5FC',
  inputBorder: '#C8CCE0',
  accent: '#5B52E0',
  accentSoft: '#7A72F0',
  accentGlow: 'rgba(91,82,224,0.08)',
  accentGlowStrong: 'rgba(91,82,224,0.16)',
  error: '#DC3545',
  errorGlow: 'rgba(220,53,69,0.05)',
  warn: '#D4880F',
  success: '#2F9E44',
  successGlow: 'rgba(47,158,68,0.05)',
  textPrimary: '#10102A',
  textSecondary: '#4E4E6E',
  textMuted: '#8080A0',
  white: '#ffffff',
  overlay: 'rgba(220,224,240,0.92)',
  separator: '#D4D8E8',
  buttonGradStart: '#6C63FF',
  buttonGradEnd: '#4A42CC',
  disabledBg: '#D0D4E4',
  disabledText: '#9898B4',
  inputShadow: '#5B52E0',
  logoBorder: '#D4D8E8',
  autofillBg: '#F4F5FC',
  autofillText: '#10102A',
  autofillCaret: '#5B52E0',
} as const;

type Tokens = typeof darkTokens;

// ─── Web CSS injection ────────────────────────────────────────────
const CSS_ID = 'login-screen-styles';
const META_ID = 'login-screen-meta';
let injectedTheme: 'dark' | 'light' | null = null;

const injectWebStyles = (C: Tokens, theme: 'dark' | 'light') => {
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
  [role="button"]{cursor:pointer}
  [role="link"]{cursor:pointer}
  a{cursor:pointer}
  [data-disabled="true"]{cursor:not-allowed!important;pointer-events:none}
  .modal-message{white-space:pre-wrap}
  *::-webkit-scrollbar{width:6px}
  *::-webkit-scrollbar-track{background:transparent}
  *::-webkit-scrollbar-thumb{background:${C.inputBorder};border-radius:3px}
  `;
  document.head.appendChild(style);

  if (!document.getElementById(META_ID)) {
    const sentinel = document.createElement('meta');
    sentinel.id = META_ID;
    document.head.appendChild(sentinel);
    document.title = 'Log In – MyArchetype';
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport');
      document.head.appendChild(vp);
    }
    vp.setAttribute('content', 'width=device-width,initial-scale=1');
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }
    robots.setAttribute('content', 'noindex,nofollow');
  }

  if (typeof module !== 'undefined' && (module as any).hot) {
    (module as any).hot.dispose(() => {
      document.getElementById(CSS_ID)?.remove();
      document.getElementById(META_ID)?.remove();
      injectedTheme = null;
    });
  }
};

// ─── Error messages ───────────────────────────────────────────────
const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Invalid email or password. Please try again.',
  'auth/user-not-found': 'Invalid email or password. Please try again.',
  'auth/wrong-password': 'Invalid email or password. Please try again.',
  'auth/too-many-requests':
    'Too many failed attempts. Please wait or reset your password.',
  'auth/network-request-failed':
    'Network error. Please check your connection.',
  'auth/user-disabled':
    'This account has been disabled. Please contact support.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/email-already-in-use': 'An account already exists with this email.',
  'auth/operation-not-allowed':
    'Login is currently unavailable. Please try again later.',
};

const getErrorMessage = (code?: string): string =>
  (code && ERROR_MESSAGES[code]) ??
  'An unexpected error occurred. Please try again.';

// ─── Native alert utility ─────────────────────────────────────────
type AlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

const showNativeAlert = (
  title: string,
  message: string,
  buttons?: AlertButton[]
) => {
  Alert.alert(title, message, buttons ?? [{ text: 'OK' }]);
};

// ─── Haptics ─────────────────────────────────────────────────────
const triggerHaptic = (type: 'success' | 'error' | 'light') => {
  if (IS_WEB) return;
  try {
    const H = require('expo-haptics');
    if (type === 'success')
      H.notificationAsync(H.NotificationFeedbackType.Success);
    else if (type === 'error')
      H.notificationAsync(H.NotificationFeedbackType.Error);
    else H.impactAsync(H.ImpactFeedbackStyle.Light);
  } catch {}
};

// ─── Validators ───────────────────────────────────────────────────
const validators = {
  email: (v: string): string => {
    if (!v) return 'Email is required';
    if (v.length > MAX_EMAIL_LENGTH)
      return `Email must be under ${MAX_EMAIL_LENGTH} characters`;
    if (!EMAIL_REGEX.test(v)) return 'Invalid email format';
    return '';
  },
  password: (v: string): string => {
    if (!v) return 'Password is required';
    if (v.length > MAX_PASSWORD_LENGTH)
      return `Password must be under ${MAX_PASSWORD_LENGTH} characters`;
    if (v.length < 6) return 'Password must be at least 6 characters';
    return '';
  },
};

// ─── Form reducer ─────────────────────────────────────────────────
type FormState = {
  email: string;
  password: string;
  emailError: string;
  passwordError: string;
  showPassword: boolean;
  emailFocused: boolean;
  passwordFocused: boolean;
  loading: boolean;
  lockoutSeconds: number;
  capsLockOn: boolean;
};

type FormAction =
  | { type: 'SET_EMAIL'; payload: string }
  | { type: 'SET_PASSWORD'; payload: string }
  | { type: 'SET_EMAIL_ERROR'; payload: string }
  | { type: 'SET_PASSWORD_ERROR'; payload: string }
  | { type: 'TOGGLE_PASSWORD' }
  | { type: 'SET_EMAIL_FOCUSED'; payload: boolean }
  | { type: 'SET_PASSWORD_FOCUSED'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LOCKOUT_SECONDS'; payload: number }
  | { type: 'SET_CAPS_LOCK'; payload: boolean }
  | { type: 'CLEAR_ERRORS' }
  | { type: 'CLEAR_PASSWORD' }
  | { type: 'HIDE_PASSWORD' }
  | { type: 'WIPE_SENSITIVE' }
  | { type: 'RESET' };

const initialFormState: FormState = {
  email: '',
  password: '',
  emailError: '',
  passwordError: '',
  showPassword: false,
  emailFocused: false,
  passwordFocused: false,
  loading: false,
  lockoutSeconds: 0,
  capsLockOn: false,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_EMAIL':
      return { ...state, email: action.payload };
    case 'SET_PASSWORD':
      return { ...state, password: action.payload };
    case 'SET_EMAIL_ERROR':
      return { ...state, emailError: action.payload };
    case 'SET_PASSWORD_ERROR':
      return { ...state, passwordError: action.payload };
    case 'TOGGLE_PASSWORD':
      return { ...state, showPassword: !state.showPassword };
    case 'SET_EMAIL_FOCUSED':
      return { ...state, emailFocused: action.payload };
    case 'SET_PASSWORD_FOCUSED':
      return { ...state, passwordFocused: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_LOCKOUT_SECONDS':
      return { ...state, lockoutSeconds: action.payload };
    case 'SET_CAPS_LOCK':
      return { ...state, capsLockOn: action.payload };
    case 'CLEAR_ERRORS':
      return { ...state, emailError: '', passwordError: '' };
    case 'CLEAR_PASSWORD':
      return { ...state, password: '' };
    case 'HIDE_PASSWORD':
      return { ...state, showPassword: false };
    case 'WIPE_SENSITIVE':
      return { ...state, password: '' };
    case 'RESET':
      return { ...initialFormState, email: state.email };
    default: {
      void (action satisfies never);
      return state;
    }
  }
}

// ─── Animated error ───────────────────────────────────────────────
const AnimatedError = React.memo(
  ({
    message,
    inputId,
    C,
  }: {
    message: string;
    inputId: string;
    C: Tokens;
  }) => {
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(-8)).current;
    const announced = useRef(false);

    useEffect(() => {
      if (message) {
        announced.current = false;
        Animated.parallel([
          Animated.spring(opacity, {
            toValue: 1,
            useNativeDriver: nativeDriver,
            speed: 20,
            bounciness: 0,
          }),
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: nativeDriver,
            speed: 20,
            bounciness: 4,
          }),
        ]).start(() => {
          if (!IS_WEB && !announced.current) {
            AccessibilityInfo.announceForAccessibility(message);
            announced.current = true;
          }
        });
      } else {
        Animated.timing(opacity, {
          toValue: 0,
          duration: getAnimDuration(150),
          useNativeDriver: nativeDriver,
        }).start();
        translateY.setValue(-8);
        announced.current = false;
      }
    }, [message, opacity, translateY]);

    if (!message) return null;

    return (
      <Animated.View
        style={[s.errorRow, { opacity, transform: [{ translateY }] }]}
        accessibilityLiveRegion="assertive"
        {...(IS_WEB
          ? ({
              'aria-live': 'assertive',
              'aria-atomic': 'true',
              id: `${inputId}-error`,
            } as any)
          : {})}
      >
        <Ionicons
          name="alert-circle"
          size={14}
          color={C.error}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text
          style={[s.errorText, { color: C.error }]}
          allowFontScaling
          maxFontSizeMultiplier={1.3}
        >
          {message}
        </Text>
      </Animated.View>
    );
  }
);

// ─── Brand logo ───────────────────────────────────────────────────
const BrandLogo = React.memo(
  ({ C, paused }: { C: Tokens; paused: boolean }) => {
    const scale = useRef(new Animated.Value(1)).current;

    useEffect(() => {
      if (prefersReducedMotion || paused) {
        scale.setValue(1);
        return;
      }
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.04,
            duration: getAnimDuration(2400),
            useNativeDriver: nativeDriver,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: getAnimDuration(2400),
            useNativeDriver: nativeDriver,
          }),
        ])
      );
      const task = InteractionManager.runAfterInteractions(() => loop.start());
      return () => {
        task.cancel();
        loop.stop();
      };
    }, [paused, scale]);

    return (
      <Animated.View
        style={[s.logoOuter, { transform: [{ scale }] }]}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <View
          style={[
            s.logoCircle,
            { backgroundColor: C.accentGlow, borderColor: C.logoBorder },
          ]}
        >
          <Ionicons name="heart" size={38} color={C.accent} />
        </View>
      </Animated.View>
    );
  }
);

// ─── Custom modal ─────────────────────────────────────────────────
type ModalButton = {
  label: string;
  onPress?: () => void | Promise<void>;
  primary?: boolean;
  danger?: boolean;
};

type ModalConfig = {
  title: string;
  message: string;
  buttons: ModalButton[];
};

const CustomModal = React.memo(
  ({
    config,
    onClose,
    C,
  }: {
    config: ModalConfig;
    onClose: () => void;
    C: Tokens;
  }) => {
    const opacity = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.92)).current;
    const isClosing = useRef(false);

    const doClose = useCallback(
      async (btn?: ModalButton) => {
        if (isClosing.current) return;
        isClosing.current = true;
        Animated.timing(opacity, {
          toValue: 0,
          duration: getAnimDuration(150),
          useNativeDriver: nativeDriver,
        }).start(async () => {
          if (btn?.onPress) await btn.onPress();
          onClose();
        });
      },
      [opacity, onClose]
    );

    useEffect(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: getAnimDuration(200),
          useNativeDriver: nativeDriver,
        }),
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: nativeDriver,
          speed: 20,
          bounciness: 4,
        }),
      ]).start();

      if (!IS_WEB || typeof window === 'undefined') return;
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape')
          doClose(config.buttons.find((b) => !b.primary && !b.danger));
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }, [opacity, scale, doClose, config.buttons]);

    const handleBackdrop = useCallback(() => {
      doClose(config.buttons.find((b) => !b.primary && !b.danger));
    }, [config.buttons, doClose]);

    return (
      <Animated.View
        style={[s.modalOverlay, { backgroundColor: C.overlay, opacity }]}
        {...(IS_WEB
          ? ({
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'modal-title',
            } as any)
          : {})}
        accessibilityViewIsModal
      >
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={handleBackdrop}
          accessibilityLabel="Close dialog"
        />
        <Animated.View
          style={[
            s.modalCard,
            {
              backgroundColor: C.card,
              borderColor: C.cardBorder,
              transform: [{ scale }],
            },
          ]}
        >
          <Text
            style={[s.modalTitle, { color: C.textPrimary }]}
            allowFontScaling
            maxFontSizeMultiplier={1.2}
          >
            {config.title}
          </Text>
          <Text
            style={[s.modalMessage, { color: C.textSecondary }]}
            {...(IS_WEB ? ({ className: 'modal-message' } as any) : {})}
            allowFontScaling
            maxFontSizeMultiplier={1.3}
          >
            {config.message}
          </Text>
          <View style={s.modalButtons}>
            {config.buttons.map((btn, idx) => (
              <Pressable
                key={btn.label + String(idx)}
                onPress={() => doClose(btn)}
                style={({ pressed }) => [
                  s.modalButton,
                  {
                    backgroundColor: btn.primary
                      ? C.accent
                      : btn.danger
                        ? C.error
                        : 'transparent',
                    borderColor: btn.primary
                      ? C.accent
                      : btn.danger
                        ? C.error
                        : C.separator,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={btn.label}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[
                    s.modalButtonText,
                    {
                      color:
                        btn.primary || btn.danger
                          ? C.white
                          : C.textSecondary,
                      fontWeight: btn.primary ? '700' : '500',
                    },
                  ]}
                  allowFontScaling
                  maxFontSizeMultiplier={1.2}
                >
                  {btn.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    );
  }
);

// ─── Shake hook ───────────────────────────────────────────────────
const useShake = () => {
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    if (prefersReducedMotion) return;
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 60, useNativeDriver: nativeDriver }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: nativeDriver }),
    ]).start();
  }, [shakeAnim]);
  return { shakeAnim, shake };
};

// ─── Gradient button ──────────────────────────────────────────────
const GradientButton = React.memo(
  ({
    onPress,
    disabled,
    loading,
    label,
    C,
  }: {
    onPress: () => void;
    disabled: boolean;
    loading: boolean;
    label: string;
    C: Tokens;
  }) => {
    const scale = useRef(new Animated.Value(1)).current;
    const isDisabled = disabled || loading;

    const handlePressIn = useCallback(() => {
      if (isDisabled) return;
      Animated.spring(scale, {
        toValue: 0.97,
        useNativeDriver: nativeDriver,
        speed: 50,
      }).start();
      triggerHaptic('light');
    }, [scale, isDisabled]);

    const handlePressOut = useCallback(() => {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: nativeDriver,
        speed: 50,
      }).start();
    }, [scale]);

    const gradColors = useMemo(
      () =>
        (isDisabled
          ? [C.disabledBg, C.disabledBg]
          : [C.buttonGradStart, C.buttonGradEnd]) as [string, string],
      [isDisabled, C]
    );

    return (
      <Animated.View
        style={[
          s.buttonOuter,
          {
            shadowColor: isDisabled ? 'transparent' : C.accent,
            transform: [{ scale }],
            ...(IS_WEB && isDisabled
              ? ({ pointerEvents: 'none', cursor: 'not-allowed' } as any)
              : {}),
          },
        ]}
      >
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isDisabled}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: isDisabled, busy: loading }}
          accessibilityHint={
            disabled ? 'Fill in all fields correctly to enable' : undefined
          }
          {...(IS_WEB
            ? ({
                'data-disabled': isDisabled ? 'true' : 'false',
              } as any)
            : {})}
        >
          {/* ✅ pointerEvents="none" on inner View prevents LinearGradient
              from intercepting clicks when disabled */}
          <View
            pointerEvents={isDisabled ? 'none' : 'auto'}
            style={{ borderRadius: 16 }}
          >
            <LinearGradient
              colors={gradColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[s.button, isDisabled && s.buttonDisabled]}
            >
              {loading ? (
                <ActivityIndicator color={C.white} size="small" />
              ) : (
                <View style={s.buttonContent}>
                  <Text
                    style={[
                      s.buttonText,
                      isDisabled && { color: C.disabledText },
                    ]}
                    allowFontScaling
                    maxFontSizeMultiplier={1.2}
                  >
                    {label}
                  </Text>
                  <Ionicons
                    name={IS_RTL ? 'arrow-back' : 'arrow-forward'}
                    size={18}
                    color={isDisabled ? C.disabledText : C.white}
                    style={s.buttonIcon}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </View>
              )}
            </LinearGradient>
          </View>
        </Pressable>
      </Animated.View>
    );
  }
);

// ─── Web input style builder ──────────────────────────────────────
const buildWebInputStyle = (C: Tokens): Record<string, any> => ({
  outline: 'none',
  outlineWidth: 0,
  outlineColor: 'transparent',
  boxShadow: 'none',
  border: 'none',
  WebkitTextFillColor: C.textPrimary,
  caretColor: C.accent,
  backgroundColor: 'transparent',
  paddingTop: 18,
  paddingBottom: 18,
  paddingLeft: 4,
  flex: 1,
  fontSize: 16,
  letterSpacing: 0.2,
  color: C.textPrimary,
  direction: IS_RTL ? 'rtl' : 'ltr',
});

// ─── Input field ──────────────────────────────────────────────────
const InputField = React.memo(
  ({
    label,
    icon,
    placeholder,
    value,
    onChangeText,
    error,
    focused,
    onFocus,
    onBlur,
    secureTextEntry,
    showPassword,
    onTogglePassword,
    keyboardType,
    autoComplete,
    textContentType,
    webAutoComplete,
    webInputName,
    returnKeyType,
    onSubmitEditing,
    inputRef,
    editable,
    accessibilityLabel,
    inputId,
    C,
    onKeyPress,
  }: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    placeholder: string;
    value: string;
    onChangeText: (t: string) => void;
    error: string;
    focused: boolean;
    onFocus: () => void;
    onBlur: () => void;
    secureTextEntry?: boolean;
    showPassword?: boolean;
    onTogglePassword?: () => void;
    keyboardType?: 'default' | 'email-address';
    autoComplete?: 'email' | 'current-password';
    textContentType?: 'emailAddress' | 'password';
    webAutoComplete?: string;
    webInputName?: string;
    returnKeyType?: 'next' | 'go';
    onSubmitEditing?: () => void;
    inputRef?: React.RefObject<TextInput | null>;
    editable?: boolean;
    accessibilityLabel: string;
    inputId: string;
    C: Tokens;
    onKeyPress?: (e: any) => void;
  }) => {
    const borderAnim = useRef(new Animated.Value(0)).current;
    const hasError = !!error;
    const webInputStyle = useMemo(() => buildWebInputStyle(C), [C]);

    useEffect(() => {
      Animated.timing(borderAnim, {
        toValue: focused ? 1 : 0,
        duration: getAnimDuration(200),
        useNativeDriver: false,
      }).start();
    }, [focused, borderAnim]);

    const animatedBorderColor = borderAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [
        hasError ? C.error : C.inputBorder,
        hasError ? C.error : C.accent,
      ],
    });

    return (
      <View style={s.inputContainer}>
        <Text
          style={[
            s.inputLabel,
            { color: C.textMuted },
            focused && { color: C.accent },
            hasError && { color: C.error },
          ]}
          {...(IS_WEB ? ({ htmlFor: inputId } as any) : {})}
          accessibilityElementsHidden
          importantForAccessibility="no"
          allowFontScaling
          maxFontSizeMultiplier={1.2}
        >
          {label}
        </Text>

        <Animated.View
          style={[
            s.inputWrapper,
            {
              borderColor: animatedBorderColor,
              backgroundColor: hasError ? C.errorGlow : C.inputBg,
            },
            focused && [s.inputWrapperFocused, { shadowColor: C.inputShadow }],
          ]}
        >
          <Ionicons
            name={icon}
            size={20}
            color={hasError ? C.error : focused ? C.accent : C.textMuted}
            style={s.inputIcon}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />

          {IS_WEB ? (
            <TextInput
              ref={inputRef as React.RefObject<TextInput>}
              nativeID={inputId}
              {...(webInputName ? ({ name: webInputName } as any) : {})}
              style={webInputStyle as any}
              placeholder={placeholder}
              placeholderTextColor={C.textMuted}
              value={value}
              onChangeText={onChangeText}
              secureTextEntry={secureTextEntry && !showPassword}
              keyboardType={keyboardType ?? 'default'}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={(webAutoComplete as any) ?? autoComplete}
              textContentType={textContentType}
              editable={editable !== false}
              returnKeyType={returnKeyType}
              onFocus={onFocus}
              onBlur={onBlur}
              onSubmitEditing={onSubmitEditing}
              onKeyPress={onKeyPress}
              accessibilityLabel={accessibilityLabel}
              selectionColor={C.accent}
              {...(hasError
                ? ({
                    'aria-describedby': `${inputId}-error`,
                    'aria-invalid': 'true',
                    'aria-required': 'true',
                  } as any)
                : ({ 'aria-required': 'true' } as any))}
            />
          ) : (
            <TextInput
              ref={inputRef as React.RefObject<TextInput>}
              nativeID={inputId}
              style={[s.inputNative, { color: C.textPrimary }]}
              placeholder={placeholder}
              placeholderTextColor={C.textMuted}
              value={value}
              onChangeText={onChangeText}
              secureTextEntry={secureTextEntry && !showPassword}
              keyboardType={keyboardType ?? 'default'}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={autoComplete}
              textContentType={textContentType}
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
              {...(IS_ANDROID && secureTextEntry
                ? ({ importantForAutofill: 'yes' } as any)
                : {})}
            />
          )}

          {onTogglePassword && (
            <Pressable
              onPress={onTogglePassword}
              hitSlop={12}
              style={[
                s.eyeButton,
                IS_WEB ? ({ cursor: 'pointer' } as any) : undefined,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                showPassword ? 'Hide password' : 'Show password'
              }
              accessibilityHint={
                showPassword
                  ? 'Password will be hidden'
                  : 'Password will be visible'
              }
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={22}
                color={focused ? C.accent : C.textMuted}
              />
            </Pressable>
          )}
        </Animated.View>

        <AnimatedError message={error} inputId={inputId} C={C} />
      </View>
    );
  }
);

// ─── Lockout banner ───────────────────────────────────────────────
const LockoutBanner = React.memo(
  ({ seconds, C }: { seconds: number; C: Tokens }) => {
    if (seconds <= 0) return null;
    return (
      <View
        style={[
          s.lockoutBanner,
          { backgroundColor: C.errorGlow, borderColor: C.error },
        ]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Too many login attempts. Try again in ${seconds} seconds.`}
      >
        <Ionicons
          name="time-outline"
          size={16}
          color={C.error}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text
          style={[s.lockoutText, { color: C.error }]}
          allowFontScaling
          maxFontSizeMultiplier={1.2}
        >
          Too many attempts — try again in{' '}
          <Text style={{ fontWeight: '800' }}>{seconds}s</Text>
        </Text>
      </View>
    );
  }
);

// ─── Success overlay ──────────────────────────────────────────────
const SuccessOverlay = React.memo(
  ({ C, secondsLeft }: { C: Tokens; secondsLeft: number }) => {
    const scale = useRef(new Animated.Value(0)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const iconScale = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: getAnimDuration(200),
            useNativeDriver: nativeDriver,
          }),
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: nativeDriver,
            speed: 14,
            bounciness: 8,
          }),
        ]),
        Animated.spring(iconScale, {
          toValue: 1,
          useNativeDriver: nativeDriver,
          speed: 10,
          bounciness: 12,
        }),
      ]).start();
      if (!IS_WEB)
        AccessibilityInfo.announceForAccessibility(
          'Login successful. Welcome back!'
        );
    }, [opacity, scale, iconScale]);

    return (
      <Animated.View
        style={[s.successOverlay, { backgroundColor: C.overlay, opacity }]}
        pointerEvents="box-only"
        accessibilityViewIsModal
        accessibilityLiveRegion="assertive"
      >
        <Animated.View
          style={[
            s.successCard,
            {
              backgroundColor: C.card,
              borderColor: C.cardBorder,
              transform: [{ scale }],
            },
          ]}
          accessibilityRole="alert"
          accessibilityLabel="Login successful. Redirecting you now."
        >
          <Animated.View style={{ transform: [{ scale: iconScale }] }}>
            <View
              style={[
                s.successIconCircle,
                { backgroundColor: C.successGlow },
              ]}
            >
              <Ionicons
                name="checkmark-circle"
                size={56}
                color={C.success}
              />
            </View>
          </Animated.View>
          <Text
            style={[s.successTitle, { color: C.textPrimary }]}
            allowFontScaling
            maxFontSizeMultiplier={1.2}
          >
            Welcome back!
          </Text>
          <Text style={[s.successSub, { color: C.textSecondary }]}>
            Redirecting in {secondsLeft}…
          </Text>
          <ActivityIndicator
            size="small"
            color={C.accent}
            style={{ marginTop: 4 }}
          />
        </Animated.View>
      </Animated.View>
    );
  }
);

// ─── Error boundary ───────────────────────────────────────────────
class LoginErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[LoginScreen]', error, info);
  }
  render() {
    if (this.state.hasError) {
      // ✅ FIX: respects current theme instead of hardcoding dark
      const isDark = Appearance.getColorScheme() !== 'light';
      const C = isDark ? darkTokens : lightTokens;
      return (
        <View style={[s.errorFallback, { backgroundColor: C.bg }]}>
          <Ionicons name="warning-outline" size={48} color={C.error} />
          <Text
            style={[s.errorFallbackTitle, { color: C.textPrimary }]}
            allowFontScaling
            maxFontSizeMultiplier={1.3}
          >
            Something went wrong
          </Text>
          <Text
            style={[s.errorFallbackSub, { color: C.textSecondary }]}
            allowFontScaling
            maxFontSizeMultiplier={1.3}
          >
            Please restart the app.
          </Text>
          <TouchableOpacity
            onPress={() => this.setState({ hasError: false })}
            style={[s.retryButton, { borderColor: C.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={[s.retryText, { color: C.accent }]}
              allowFontScaling
              maxFontSizeMultiplier={1.2}
            >
              Try Again
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main screen
// ═══════════════════════════════════════════════════════════════════
export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme !== 'light';
  const C: Tokens = isDark ? darkTokens : lightTokens;

  useEffect(() => {
    injectWebStyles(C, isDark ? 'dark' : 'light');
  }, [C, isDark]);

  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: any) => {
      prefersReducedMotion = e.matches;
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [state, dispatch] = useReducer(formReducer, initialFormState);
  const [screenData, setSD] = useState(getScreenData);
  const [showSuccess, setSuccess] = useState(false);
  const [successCountdown, setSuccessCountdown] = useState(
    Math.ceil(SUCCESS_NAV_DELAY_MS / 1000)
  );
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [appActive, setAppActive] = useState(true);

  const isMounted = useRef(true);
  const loginAttempts = useRef(0);
  const lockoutUntil = useRef(0);
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const navTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resendAttempts = useRef(0);
  const resendLockUntil = useRef(0);
  const forgotAttempts = useRef(0);
  const forgotLockUntil = useRef(0);

  const { shakeAnim, shake } = useShake();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(
    new Animated.Value(prefersReducedMotion ? 0 : 40)
  ).current;
  const headerFade = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(
    new Animated.Value(prefersReducedMotion ? 0 : 20)
  ).current;
  const formFade = useRef(new Animated.Value(0)).current;
  const formSlide = useRef(
    new Animated.Value(prefersReducedMotion ? 0 : 20)
  ).current;
  const footerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (lockoutTimer.current) clearInterval(lockoutTimer.current);
      if (navTimeout.current) clearTimeout(navTimeout.current);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (successTimer.current) clearInterval(successTimer.current);
      dispatch({ type: 'WIPE_SENSITIVE' });
    };
  }, []);

  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const handler = debounce(() => setSD(getScreenData()), RESIZE_DEBOUNCE_MS);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const sub = AppState.addEventListener('change', (status: AppStateStatus) =>
      setAppActive(status === 'active')
    );
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
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: getAnimDuration(300),
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: getAnimDuration(400),
          useNativeDriver: nativeDriver,
        }),
        Animated.stagger(getAnimDuration(150), [
          Animated.parallel([
            Animated.timing(headerFade, {
              toValue: 1,
              duration: getAnimDuration(500),
              useNativeDriver: nativeDriver,
            }),
            Animated.timing(headerSlide, {
              toValue: 0,
              duration: getAnimDuration(500),
              useNativeDriver: nativeDriver,
            }),
          ]),
          Animated.parallel([
            Animated.timing(formFade, {
              toValue: 1,
              duration: getAnimDuration(500),
              useNativeDriver: nativeDriver,
            }),
            Animated.timing(formSlide, {
              toValue: 0,
              duration: getAnimDuration(500),
              useNativeDriver: nativeDriver,
            }),
          ]),
          Animated.timing(footerFade, {
            toValue: 1,
            duration: getAnimDuration(400),
            useNativeDriver: nativeDriver,
          }),
        ]),
      ]).start();
    });
    return () => task.cancel();
  }, [
    fadeAnim,
    slideAnim,
    headerFade,
    headerSlide,
    formFade,
    formSlide,
    footerFade,
  ]);

  const startLockoutCountdown = useCallback(() => {
    if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    const tick = () => {
      if (!isMounted.current) return;
      const remaining = Math.ceil(
        (lockoutUntil.current - Date.now()) / 1000
      );
      if (remaining <= 0) {
        dispatch({ type: 'SET_LOCKOUT_SECONDS', payload: 0 });
        if (lockoutTimer.current) {
          clearInterval(lockoutTimer.current);
          lockoutTimer.current = null;
        }
      } else {
        dispatch({ type: 'SET_LOCKOUT_SECONDS', payload: remaining });
      }
    };
    tick();
    lockoutTimer.current = setInterval(tick, 1000);
  }, []);

  const startSuccessCountdown = useCallback(() => {
    const total = Math.ceil(SUCCESS_NAV_DELAY_MS / 1000);
    setSuccessCountdown(total);
    let remaining = total;
    if (successTimer.current) clearInterval(successTimer.current);
    successTimer.current = setInterval(() => {
      remaining -= 1;
      if (isMounted.current) setSuccessCountdown(remaining);
      if (remaining <= 0 && successTimer.current) {
        clearInterval(successTimer.current);
        successTimer.current = null;
      }
    }, 1000);
  }, []);

  const openModal = useCallback((cfg: ModalConfig) => setModal(cfg), []);
  const closeModal = useCallback(() => setModal(null), []);

  const showAppAlert = useCallback(
    (title: string, message: string, buttons?: AlertButton[]) => {
      if (IS_WEB) {
        openModal({
          title,
          message,
          buttons: (buttons ?? [{ text: 'OK' }]).map((b, _, arr) => ({
            label: b.text,
            onPress: b.onPress,
            primary: b.style !== 'cancel' && arr.length > 1,
            danger: false,
          })),
        });
      } else {
        showNativeAlert(title, message, buttons);
      }
    },
    [openModal]
  );

  const handleKeyPress = useCallback((e: any) => {
    if (!IS_WEB || !e?.nativeEvent?.key) return;
    dispatch({
      type: 'SET_CAPS_LOCK',
      payload: e.nativeEvent.getModifierState?.('CapsLock') ?? false,
    });
  }, []);

  const handleTypingActivity = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {}, TYPING_PAUSE_MS);
  }, []);

  const canSubmit = useMemo(
    () =>
      !!(
        state.email.trim() &&
        state.password &&
        !state.emailError &&
        !state.passwordError &&
        !state.loading &&
        state.lockoutSeconds === 0
      ),
    [
      state.email,
      state.password,
      state.emailError,
      state.passwordError,
      state.loading,
      state.lockoutSeconds,
    ]
  );

  const onEmailFocus = useCallback(
    () => dispatch({ type: 'SET_EMAIL_FOCUSED', payload: true }),
    []
  );
  const onEmailBlur = useCallback(
    () => dispatch({ type: 'SET_EMAIL_FOCUSED', payload: false }),
    []
  );
  const onPasswordFocus = useCallback(
    () => dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: true }),
    []
  );
  const onPasswordBlur = useCallback(() => {
    dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: false });
    dispatch({ type: 'HIDE_PASSWORD' });
  }, []);
  const togglePassword = useCallback(
    () => dispatch({ type: 'TOGGLE_PASSWORD' }),
    []
  );

  const validateEmail = useCallback(
    (text: string) => {
      const sanitized = text
        .trimStart()
        .slice(0, MAX_EMAIL_LENGTH + 1)
        .replace(/[\n\r]/g, '');
      dispatch({ type: 'SET_EMAIL', payload: sanitized });
      handleTypingActivity();
      if (sanitized.length < 3) {
        dispatch({ type: 'SET_EMAIL_ERROR', payload: '' });
        return;
      }
      dispatch({
        type: 'SET_EMAIL_ERROR',
        payload: validators.email(sanitized),
      });
    },
    [handleTypingActivity]
  );

  const validatePassword = useCallback(
    (text: string) => {
      const sanitized = text.slice(0, MAX_PASSWORD_LENGTH + 1);
      dispatch({ type: 'SET_PASSWORD', payload: sanitized });
      handleTypingActivity();
      if (!sanitized) {
        dispatch({ type: 'SET_PASSWORD_ERROR', payload: '' });
        return;
      }
      dispatch({
        type: 'SET_PASSWORD_ERROR',
        payload: validators.password(sanitized),
      });
    },
    [handleTypingActivity]
  );

  const dismissKeyboard = useCallback(() => {
    if (!IS_WEB) Keyboard.dismiss();
  }, []);

  const signInUser = useCallback(
    (email: string, password: string) =>
      signInWithEmailAndPassword(auth, email, password),
    []
  );

  const handleLogin = useCallback(async () => {
    dismissKeyboard();
    dispatch({ type: 'CLEAR_ERRORS' });

    const email = state.email.trim().toLowerCase();
    const password = state.password;

    const emailErr = validators.email(email);
    const passwordErr = validators.password(password);

    if (emailErr) {
      dispatch({ type: 'SET_EMAIL_ERROR', payload: emailErr });
      shake();
      return;
    }
    if (passwordErr) {
      dispatch({ type: 'SET_PASSWORD_ERROR', payload: passwordErr });
      shake();
      return;
    }
    if (Date.now() < lockoutUntil.current) {
      startLockoutCountdown();
      shake();
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'HIDE_PASSWORD' });

    try {
      const hadLocalKeysBeforeLogin = !!(await getLocalE2EEKeypair());
      const { user } = await signInUser(email, password);

      if (!user.emailVerified) {
        await auth.signOut();
        if (!isMounted.current) return;
        dispatch({ type: 'SET_LOADING', payload: false });
        shake();
        await new Promise<void>((resolve) => {
          showAppAlert(
            'Email Not Verified',
            'Please verify your email before logging in.\n\nCheck your inbox (and spam folder).',
            [{ text: 'OK', onPress: () => resolve() }]
          );
        });
        return;
      }

      const e2eeResult = await ensureMyE2EEIdentity();
      if (!e2eeResult.success) {
        console.warn(
          'E2EE identity sync skipped during login:',
          e2eeResult.error
        );
      }

      const hasLocalKeysAfterLogin = !!(await getLocalE2EEKeypair());

      loginAttempts.current = 0;
      if (lockoutTimer.current) {
        clearInterval(lockoutTimer.current);
        lockoutTimer.current = null;
      }

      triggerHaptic('success');
      dispatch({ type: 'CLEAR_PASSWORD' });

      if (!isMounted.current) return;
      dispatch({ type: 'SET_LOADING', payload: false });

      if (!hadLocalKeysBeforeLogin && hasLocalKeysAfterLogin) {
        showAppAlert(
          'Encrypted Chats Reset on This Device',
          'A new encryption key was created for this device. Older encrypted chats may not be readable here.',
          [{ text: 'Continue' }]
        );
      }

      setSuccess(true);
      startSuccessCountdown();

      navTimeout.current = setTimeout(() => {
        if (isMounted.current) router.replace(ROUTES.HOME);
      }, getAnimDuration(SUCCESS_NAV_DELAY_MS));
    } catch (error: any) {
      loginAttempts.current += 1;
      if (loginAttempts.current >= MAX_LOGIN_ATTEMPTS) {
        lockoutUntil.current = Date.now() + LOCKOUT_DURATION_MS;
        loginAttempts.current = 0;
        startLockoutCountdown();
      }
      triggerHaptic('error');
      shake();
      if (!isMounted.current) return;
      if (
        error.code === 'auth/wrong-password' ||
        error.code === 'auth/invalid-credential'
      ) {
        dispatch({ type: 'CLEAR_PASSWORD' });
        setTimeout(
          () => passwordRef.current?.focus(),
          FOCUS_RETURN_DELAY_MS
        );
      } else if (error.code === 'auth/invalid-email') {
        setTimeout(() => emailRef.current?.focus(), FOCUS_RETURN_DELAY_MS);
      }
      showAppAlert(
        'Login Failed',
        getErrorMessage(error.code) || error?.message || 'Login failed'
      );
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [
    state.email,
    state.password,
    router,
    dismissKeyboard,
    startLockoutCountdown,
    startSuccessCountdown,
    shake,
    showAppAlert,
    signInUser,
  ]);

  const handleResendVerification = useCallback(async () => {
    dismissKeyboard();
    const email = state.email.trim();
    const password = state.password;

    if (!email) {
      showAppAlert(
        'Email Required',
        'Please enter your email address first.'
      );
      return;
    }
    if (!password) {
      showAppAlert(
        'Password Required',
        'Please enter your password to verify identity.'
      );
      return;
    }
    if (validators.email(email)) {
      showAppAlert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (Date.now() < resendLockUntil.current) {
      const secs = Math.ceil(
        (resendLockUntil.current - Date.now()) / 1000
      );
      showAppAlert(
        'Please Wait',
        `You can resend again in ${secs} seconds.`
      );
      return;
    }
    resendAttempts.current += 1;
    if (resendAttempts.current > MAX_RESEND_ATTEMPTS) {
      resendLockUntil.current = Date.now() + RATE_LIMIT_WINDOW_MS;
      resendAttempts.current = 0;
      showAppAlert(
        'Too Many Requests',
        'Please wait 60 seconds before requesting another email.'
      );
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const { user } = await signInUser(email.toLowerCase(), password);
      if (user.emailVerified) {
        await auth.signOut();
        if (isMounted.current)
          showAppAlert(
            'Already Verified',
            'Your email is already verified. You can log in now.'
          );
        return;
      }
      await sendEmailVerification(user);
      await auth.signOut();
      if (isMounted.current)
        showAppAlert(
          'Verification Email Sent',
          `A new verification email has been sent to:\n${email}\n\nCheck your inbox and spam folder.`
        );
    } catch (error: any) {
      if (isMounted.current)
        showAppAlert('Error', getErrorMessage(error.code));
    } finally {
      if (isMounted.current)
        dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.email, state.password, dismissKeyboard, showAppAlert, signInUser]);

  const handleForgotPassword = useCallback(() => {
    dismissKeyboard();
    const email = state.email.trim();

    if (!email) {
      showAppAlert(
        'Email Required',
        'Please enter your email address above, then try again.'
      );
      return;
    }
    if (validators.email(email)) {
      dispatch({ type: 'SET_EMAIL_ERROR', payload: 'Please enter a valid email' });
      return;
    }
    if (Date.now() < forgotLockUntil.current) {
      const secs = Math.ceil(
        (forgotLockUntil.current - Date.now()) / 1000
      );
      showAppAlert(
        'Please Wait',
        `You can request another reset in ${secs} seconds.`
      );
      return;
    }
    forgotAttempts.current += 1;
    if (forgotAttempts.current > MAX_FORGOT_ATTEMPTS) {
      forgotLockUntil.current = Date.now() + RATE_LIMIT_WINDOW_MS;
      forgotAttempts.current = 0;
      showAppAlert(
        'Too Many Requests',
        'Please wait 60 seconds before requesting another reset.'
      );
      return;
    }

    showAppAlert(
      'Reset Password',
      `Send password reset email to:\n${email}?`,
      [
        { text: 'Cancel', style: 'cancel' as const },
        {
          text: 'Send Reset Email',
          onPress: async () => {
            dispatch({ type: 'SET_LOADING', payload: true });
            try {
              await sendPasswordResetEmail(auth, email.toLowerCase());
              if (isMounted.current)
                showAppAlert(
                  'Email Sent',
                  `Password reset instructions sent to:\n${email}\n\nCheck your inbox and spam folder.`
                );
            } catch (error: any) {
              if (isMounted.current)
                showAppAlert('Error', getErrorMessage(error.code));
            } finally {
              if (isMounted.current)
                dispatch({ type: 'SET_LOADING', payload: false });
            }
          },
        },
      ]
    );
  }, [state.email, dismissKeyboard, showAppAlert]);

  const handleSignUp = useCallback(() => {
    if (!state.loading) router.push(ROUTES.SIGNUP);
  }, [state.loading, router]);

  const handleEmailSubmit = useCallback(
    () => passwordRef.current?.focus(),
    []
  );

  const IS_SMALL = screenData.isSmall;

  // ✅ FIX: loading added to logoPaused so logo stops animating during login
  const logoPaused =
    state.emailFocused ||
    state.passwordFocused ||
    state.loading ||
    !appActive;

  const innerContentProps: InnerContentProps = useMemo(
    () => ({
      C,
      state,
      IS_SMALL,
      fadeAnim,
      slideAnim,
      headerFade,
      headerSlide,
      formFade,
      formSlide,
      footerFade,
      emailRef,
      passwordRef,
      canSubmit,
      shakeAnim,
      logoPaused,
      validateEmail,
      validatePassword,
      onEmailFocus,
      onEmailBlur,
      onPasswordFocus,
      onPasswordBlur,
      togglePassword,
      handleLogin,
      handleEmailSubmit,
      handleForgotPassword,
      handleResendVerification,
      handleSignUp,
      handleKeyPress,
    }),
    [
      C,
      state,
      IS_SMALL,
      fadeAnim,
      slideAnim,
      headerFade,
      headerSlide,
      formFade,
      formSlide,
      footerFade,
      canSubmit,
      shakeAnim,
      logoPaused,
      validateEmail,
      validatePassword,
      onEmailFocus,
      onEmailBlur,
      onPasswordFocus,
      onPasswordBlur,
      togglePassword,
      handleLogin,
      handleEmailSubmit,
      handleForgotPassword,
      handleResendVerification,
      handleSignUp,
      handleKeyPress,
    ]
  );

  return (
    <LoginErrorBoundary>
      <View style={[s.rootBg, { backgroundColor: C.bg }]}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={C.bg}
          translucent={false}
        />
        <LinearGradient
          colors={[C.bgGradientStart, C.bgGradientMid, C.bgGradientEnd]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <SafeAreaView style={s.safe}>
          <KeyboardAvoidingView
            behavior={Platform.select({
              ios: 'padding',
              android: 'height',
              default: undefined,
            })}
            style={s.container}
            keyboardVerticalOffset={IS_IOS ? 0 : 20}
          >
            {IS_WEB ? (
              <View style={s.fill}>
                <ScrollView
                  ref={scrollRef}
                  contentContainerStyle={[
                    s.scrollContent,
                    {
                      padding: IS_SMALL ? 20 : 28,
                      paddingTop: IS_SMALL ? 16 : 24,
                    },
                  ]}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <InnerContent {...innerContentProps} />
                </ScrollView>
              </View>
            ) : (
              <Pressable style={s.fill} onPress={dismissKeyboard}>
                <ScrollView
                  ref={scrollRef}
                  contentContainerStyle={[
                    s.scrollContent,
                    {
                      padding: IS_SMALL ? 20 : 28,
                      paddingTop: IS_SMALL ? 16 : 24,
                    },
                  ]}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <InnerContent {...innerContentProps} />
                </ScrollView>
              </Pressable>
            )}

            {state.loading && !showSuccess && (
              <View
                style={[s.loadingOverlay, { backgroundColor: C.overlay }]}
                pointerEvents="box-only"
                accessibilityViewIsModal
                accessibilityLiveRegion="polite"
              >
                <View
                  style={[
                    s.loadingCard,
                    { backgroundColor: C.card, borderColor: C.cardBorder },
                  ]}
                  accessibilityRole="alert"
                  accessibilityLabel="Signing you in, please wait"
                >
                  <ActivityIndicator size="large" color={C.accent} />
                  <Text
                    style={[s.loadingText, { color: C.textSecondary }]}
                    allowFontScaling
                    maxFontSizeMultiplier={1.2}
                  >
                    Signing you in…
                  </Text>
                </View>
              </View>
            )}

            {showSuccess && (
              <SuccessOverlay C={C} secondsLeft={successCountdown} />
            )}
            {modal && IS_WEB && (
              <CustomModal config={modal} onClose={closeModal} C={C} />
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </LoginErrorBoundary>
  );
}

// ─── Inner content ────────────────────────────────────────────────
type InnerContentProps = {
  C: Tokens;
  state: FormState;
  IS_SMALL: boolean;
  fadeAnim: Animated.Value;
  slideAnim: Animated.Value;
  headerFade: Animated.Value;
  headerSlide: Animated.Value;
  formFade: Animated.Value;
  formSlide: Animated.Value;
  footerFade: Animated.Value;
  emailRef: React.RefObject<TextInput | null>;
  passwordRef: React.RefObject<TextInput | null>;
  canSubmit: boolean;
  shakeAnim: Animated.Value;
  logoPaused: boolean;
  validateEmail: (t: string) => void;
  validatePassword: (t: string) => void;
  onEmailFocus: () => void;
  onEmailBlur: () => void;
  onPasswordFocus: () => void;
  onPasswordBlur: () => void;
  togglePassword: () => void;
  handleLogin: () => void;
  handleEmailSubmit: () => void;
  handleForgotPassword: () => void;
  handleResendVerification: () => void;
  handleSignUp: () => void;
  handleKeyPress: (e: any) => void;
};

const InnerContent = React.memo(
  ({
    C,
    state,
    IS_SMALL,
    fadeAnim,
    slideAnim,
    headerFade,
    headerSlide,
    formFade,
    formSlide,
    footerFade,
    emailRef,
    passwordRef,
    canSubmit,
    shakeAnim,
    logoPaused,
    validateEmail,
    validatePassword,
    onEmailFocus,
    onEmailBlur,
    onPasswordFocus,
    onPasswordBlur,
    togglePassword,
    handleLogin,
    handleEmailSubmit,
    handleForgotPassword,
    handleResendVerification,
    handleSignUp,
    handleKeyPress,
  }: InnerContentProps) => (
    <Animated.View
      style={[
        s.content,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          maxWidth: 440,
        },
      ]}
    >
      {/* Header */}
      <Animated.View
        style={[
          s.headerContainer,
          {
            opacity: headerFade,
            transform: [{ translateY: headerSlide }],
            marginBottom: IS_SMALL ? 28 : 40,
          },
        ]}
      >
        <BrandLogo C={C} paused={logoPaused} />
        <Text
          style={[
            s.title,
            { color: C.textPrimary, fontSize: IS_SMALL ? 28 : 36 },
          ]}
          accessibilityRole="header"
          allowFontScaling
          maxFontSizeMultiplier={1.2}
        >
          Welcome Back
        </Text>
        <Text
          style={[
            s.subtitle,
            { color: C.textSecondary, fontSize: IS_SMALL ? 14 : 16 },
          ]}
          allowFontScaling
          maxFontSizeMultiplier={1.3}
        >
          Log in to find your perfect match
        </Text>
      </Animated.View>

      <LockoutBanner seconds={state.lockoutSeconds} C={C} />

      {/* Form card */}
      <Animated.View
        style={[
          s.formCard,
          {
            opacity: formFade,
            transform: [
              { translateX: shakeAnim },
              { translateY: formSlide },
            ],
            backgroundColor: C.card,
            borderColor: C.cardBorder,
            padding: IS_SMALL ? 24 : 34,
          },
        ]}
        {...(IS_WEB
          ? ({ role: 'form', 'aria-label': 'Login form' } as any)
          : {})}
      >
        <InputField
          inputId="login-email"
          label="Email address"
          icon="mail-outline"
          placeholder="you@example.com"
          value={state.email}
          onChangeText={validateEmail}
          error={state.emailError}
          focused={state.emailFocused}
          onFocus={onEmailFocus}
          onBlur={onEmailBlur}
          keyboardType="email-address"
          autoComplete="email"
          webAutoComplete="username"
          webInputName="username"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={handleEmailSubmit}
          inputRef={emailRef}
          editable={!state.loading}
          accessibilityLabel="Email address"
          C={C}
          onKeyPress={handleKeyPress}
        />

        <InputField
          inputId="login-password"
          label="Password"
          icon="lock-closed-outline"
          placeholder="Enter your password"
          value={state.password}
          onChangeText={validatePassword}
          error={state.passwordError}
          focused={state.passwordFocused}
          onFocus={onPasswordFocus}
          onBlur={onPasswordBlur}
          secureTextEntry
          showPassword={state.showPassword}
          onTogglePassword={togglePassword}
          autoComplete="current-password"
          webAutoComplete="current-password"
          webInputName="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={handleLogin}
          inputRef={passwordRef}
          editable={!state.loading}
          accessibilityLabel="Password"
          C={C}
          onKeyPress={handleKeyPress}
        />

        {IS_WEB && state.capsLockOn && state.passwordFocused && (
          <View
            style={[
              s.capsLockRow,
              { backgroundColor: C.errorGlow, borderColor: C.warn },
            ]}
            accessibilityLiveRegion="polite"
            accessibilityLabel="Caps Lock is on"
          >
            <Ionicons name="warning-outline" size={14} color={C.warn} />
            <Text
              style={[s.capsLockText, { color: C.warn }]}
              allowFontScaling
              maxFontSizeMultiplier={1.2}
            >
              Caps Lock is on
            </Text>
          </View>
        )}

        <Pressable
          onPress={handleForgotPassword}
          disabled={state.loading}
          style={[
            s.forgotRow,
            IS_WEB ? ({ cursor: 'pointer' } as any) : undefined,
          ]}
          accessibilityRole="link"
          accessibilityLabel="Forgot password"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text
            style={[s.forgotText, { color: C.warn }]}
            allowFontScaling
            maxFontSizeMultiplier={1.2}
          >
            Forgot Password?
          </Text>
        </Pressable>

        <View style={s.buttonSpacer} />

        <GradientButton
          onPress={handleLogin}
          disabled={!canSubmit}
          loading={state.loading}
          label="Log In"
          C={C}
        />
      </Animated.View>

      {/* Footer */}
      <Animated.View style={[s.footer, { opacity: footerFade }]}>
        <Pressable
          onPress={handleResendVerification}
          disabled={state.loading}
          style={[
            s.resendButton,
            { borderColor: C.separator, backgroundColor: C.accentGlow },
            IS_WEB ? ({ cursor: 'pointer' } as any) : undefined,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Resend verification email"
        >
          <Ionicons
            name="mail-unread-outline"
            size={16}
            color={C.accent}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text
            style={[s.resendText, { color: C.accent }]}
            allowFontScaling
            maxFontSizeMultiplier={1.2}
          >
            Resend Verification Email
          </Text>
        </Pressable>

        <View
          style={s.separatorRow}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <View style={[s.separatorLine, { backgroundColor: C.separator }]} />
          <Text style={[s.separatorText, { color: C.textMuted }]}>or</Text>
          <View style={[s.separatorLine, { backgroundColor: C.separator }]} />
        </View>

        <Pressable
          onPress={handleSignUp}
          disabled={state.loading}
          style={({ pressed }) => [
            s.signUpButton,
            { opacity: pressed ? 0.7 : 1 },
            IS_WEB ? ({ cursor: 'pointer' } as any) : undefined,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Create a new account"
        >
          <Text
            style={[s.signUpText, { color: C.textSecondary }]}
            allowFontScaling
            maxFontSizeMultiplier={1.2}
          >
            Don't have an account?{' '}
            <Text style={[s.signUpLink, { color: C.accent }]}>Sign Up</Text>
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  )
);

// ─── Styles ───────────────────────────────────────────────────────
const s = StyleSheet.create({
  rootBg: { flex: 1 },
  safe: { flex: 1 },
  container: { flex: 1 },
  fill: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 52,
  },
  content: { width: '100%', alignSelf: 'center' },

  headerContainer: { alignItems: 'center' },
  logoOuter: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  title: {
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 24,
    letterSpacing: 0.1,
  },

  lockoutBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
  },
  lockoutText: { fontSize: 13, fontWeight: '600', flex: 1 },

  formCard: {
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 14,
  },

  inputContainer: { marginBottom: 26 },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    marginLeft: 2,
    letterSpacing: 0.15,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    minHeight: 58,
  },
  inputWrapperFocused: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 4,
  },
  inputIcon: { marginRight: 14, width: 22, textAlign: 'center' },
  inputNative: {
    flex: 1,
    fontSize: 16,
    paddingVertical: IS_IOS ? 18 : 15,
    letterSpacing: 0.2,
    backgroundColor: 'transparent',
  },
  eyeButton: { padding: 8, marginLeft: 4, borderRadius: 20 },

  capsLockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    marginTop: -12,
  },
  capsLockText: { fontSize: 12, fontWeight: '600' },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 2,
    gap: 6,
  },
  errorText: { fontSize: 12, fontWeight: '500', flex: 1 },

  forgotRow: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: -8,
    marginBottom: 8,
  },
  forgotText: { fontSize: 13, fontWeight: '600' },

  buttonSpacer: { height: 8 },
  buttonOuter: {
    width: '100%',
    borderRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 12,
  },
  button: {
    paddingVertical: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 62,
  },
  buttonDisabled: { shadowOpacity: 0, elevation: 0 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buttonIcon: { marginTop: 1 },

  footer: {
    alignItems: 'center',
    marginTop: 36,
    gap: 0,
    paddingHorizontal: 16,
  },
  resendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
  },
  resendText: { fontSize: 14, fontWeight: '600' },
  separatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 28,
    width: '100%',
  },
  separatorLine: { flex: 1, height: StyleSheet.hairlineWidth },
  separatorText: {
    fontSize: 13,
    marginHorizontal: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#64648a',
  },
  signUpButton: { paddingVertical: 12, paddingHorizontal: 24 },
  signUpText: { fontSize: 15, lineHeight: 22 },
  signUpLink: { fontWeight: '700' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  loadingCard: {
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    gap: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 16,
    minWidth: 200,
  },
  loadingText: { fontSize: 15, fontWeight: '500' },

  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  successCard: {
    borderRadius: 28,
    padding: 48,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 20,
  },
  successIconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  successSub: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
  },

  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 22,
    padding: 30,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 24,
    gap: 16,
  },
  modalTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  modalMessage: { fontSize: 14, lineHeight: 23 },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  modalButton: {
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 11,
    borderWidth: 1,
  },
  modalButtonText: { fontSize: 14 },

  errorFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  errorFallbackTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorFallbackSub: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  retryText: { fontSize: 15, fontWeight: '700' },
});