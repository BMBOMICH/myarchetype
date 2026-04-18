type WebMediaEvent = { matches: boolean };
type WebMediaQuery = {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (e: WebMediaEvent) => void) => void;
  removeEventListener?: (type: 'change', listener: (e: WebMediaEvent) => void) => void;
};
type WebKeyEvent = { key?: string };
type WebCanvas = { getContext?: (kind: '2d') => { fillText: (text: string, x: number, y: number) => void } | null; toDataURL?: () => string };
type WebNode = { remove?: () => void; id?: string; textContent?: string | null; setAttribute?: (name: string, value: string) => void };
declare const window: { matchMedia?: (query: string) => WebMediaQuery; addEventListener?: (type: string, listener: (e: unknown) => void) => void; removeEventListener?: (type: string, listener: (e: unknown) => void) => void };
declare const document: {
  getElementById?: (id: string) => WebNode | null;
  createElement?: (tag: string) => WebNode & WebCanvas;
  head?: { appendChild?: (node: unknown) => void };
  querySelector?: (selector: string) => WebNode | null;
  documentElement?: { lang: string; dir: string };
  title?: string;
};

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Appearance, AppState, type AppStateStatus,
  BackHandler, Dimensions, I18nManager, Keyboard, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StatusBar, Text, TextInput, TouchableOpacity, useColorScheme, View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { auth } from '../firebaseConfig';
import { ensureMyE2EEIdentity, getLocalE2EEKeypair } from '../utils/e2ee';
import { writeAuditLog } from '../utils/logger';
import { checkDeviceMultiAccount, checkUserBanned, recordDeviceLogin } from '../utils/rateLimiter';
import { checkLogin } from '../utils/safetyMiddleware';

const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';
const IS_RTL = I18nManager.isRTL;

const ROUTES = { HOME: '/home' as const, SIGNUP: '/signup' as const };
const SUCCESS_NAV_DELAY_MS  = 1000;
const LOCKOUT_DURATION_MS   = 60_000;
const RESIZE_DEBOUNCE_MS    = 150;
const FOCUS_RETURN_DELAY_MS = 100;
const RATE_LIMIT_WINDOW_MS  = 60_000;
const EMAIL_REGEX           = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH      = 254;
const MAX_PASSWORD_LENGTH   = 128;
const MAX_LOGIN_ATTEMPTS    = 5;
const MAX_RESEND_ATTEMPTS   = 3;
const MAX_FORGOT_ATTEMPTS   = 3;

const getErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as Record<string, unknown>).code ?? '')
    : undefined;

async function getDeviceFingerprint(): Promise<string | null> {
  if (!IS_WEB) return null;
  try {
    const canvas = document.createElement?.('canvas');
    if (!canvas?.toDataURL) return null;
    canvas.getContext?.('2d')?.fillText('fp', 2, 10);
    const nav = globalThis.navigator;
    const raw = [nav?.userAgent ?? '', nav?.language ?? '', nav?.hardwareConcurrency ?? '', nav?.platform ?? '', canvas.toDataURL?.() ?? ''].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  } catch { return null; }
}

const getScreenData = () => {
  const { width, height } = Dimensions.get('window');
  return { width, height, isSmall: width < 375, isMedium: width >= 375 && width < 768, isLarge: width >= 768 };
};

const getReducedMotion = () => IS_WEB ? !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches : false;
let prefersReducedMotion = getReducedMotion();
const getAnimDuration = (ms: number) => (prefersReducedMotion ? 0 : ms);

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const debounced = ((...args: Parameters<T>) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }) as T & { cancel: () => void };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

const darkTokens = {
  bg:'#07070f', bgGradientStart:'#0a0a18', bgGradientMid:'#0e0e24', bgGradientEnd:'#07070f',
  card:'#111128', cardBorder:'#1e1e48', inputBg:'#0d0d24', inputBorder:'#28285a',
  accent:'#6C63FF', accentSoft:'#8B83FF', accentGlow:'rgba(108,99,255,0.10)', accentGlowStrong:'rgba(108,99,255,0.22)',
  error:'#FF6B6B', errorGlow:'rgba(255,107,107,0.07)', warn:'#FFB347', success:'#51CF66', successGlow:'rgba(81,207,102,0.07)',
  textPrimary:'#EDEDFF', textSecondary:'#9494B8', textMuted:'#64648a', white:'#ffffff', overlay:'rgba(4,4,12,0.92)',
  separator:'#1e1e48', buttonGradStart:'#7B73FF', buttonGradEnd:'#5A4FE6', disabledBg:'#181834', disabledText:'#40406a',
  inputShadow:'#6C63FF', logoBorder:'#28285a', autofillBg:'#0d0d24', autofillText:'#EDEDFF', autofillCaret:'#6C63FF',
} as const;

const lightTokens = {
  bg:'#F0F2F8', bgGradientStart:'#E8EAF4', bgGradientMid:'#E0E3F0', bgGradientEnd:'#F0F2F8',
  card:'#FFFFFF', cardBorder:'#D4D8E8', inputBg:'#F4F5FC', inputBorder:'#C8CCE0',
  accent:'#5B52E0', accentSoft:'#7A72F0', accentGlow:'rgba(91,82,224,0.08)', accentGlowStrong:'rgba(91,82,224,0.16)',
  error:'#DC3545', errorGlow:'rgba(220,53,69,0.05)', warn:'#D4880F', success:'#2F9E44', successGlow:'rgba(47,158,68,0.05)',
  textPrimary:'#10102A', textSecondary:'#4E4E6E', textMuted:'#8080A0', white:'#ffffff', overlay:'rgba(220,224,240,0.92)',
  separator:'#D4D8E8', buttonGradStart:'#6C63FF', buttonGradEnd:'#4A42CC', disabledBg:'#D0D4E4', disabledText:'#9898B4',
  inputShadow:'#5B52E0', logoBorder:'#D4D8E8', autofillBg:'#F4F5FC', autofillText:'#10102A', autofillCaret:'#5B52E0',
} as const;

type Tokens = typeof darkTokens;

type WebAriaProps = {
  'aria-live'?: 'assertive' | 'polite' | 'off'; 'aria-atomic'?: 'true' | 'false';
  id?: string; role?: string; 'aria-modal'?: 'true' | 'false'; 'aria-label'?: string;
  'aria-describedby'?: string; 'aria-invalid'?: 'true' | 'false'; 'aria-required'?: 'true' | 'false';
};
type WebInputProps  = { name?: string };
type WebStyleProps  = {
  outline?: string; outlineWidth?: number; boxShadow?: string; border?: string;
  WebkitTextFillColor?: string; caretColor?: string; backgroundColor?: string;
  paddingTop?: number; paddingBottom?: number; paddingLeft?: number;
  flex?: number; fontSize?: number; letterSpacing?: number; color?: string; direction?: 'ltr' | 'rtl';
};

const CSS_ID  = 'login-screen-styles';
const META_ID = 'login-screen-meta';
let injectedTheme: 'dark' | 'light' | null = null;

const injectWebStyles = (C: Tokens, theme: 'dark' | 'light') => {
  if (!IS_WEB || injectedTheme === theme) return;
  injectedTheme = theme;
  document.getElementById?.(CSS_ID)?.remove?.();
  const style = document.createElement?.('style');
  if (!style) return;
  style.id = CSS_ID;
  style.textContent = `
    input:focus,input:focus-visible{outline:none!important;box-shadow:none!important}
    input:-webkit-autofill{-webkit-background-clip:text!important;-webkit-text-fill-color:${C.autofillText}!important;
      transition:background-color 5000s ease-in-out 0s!important;
      box-shadow:inset 0 0 0 1000px ${C.autofillBg}!important;caret-color:${C.autofillCaret}!important}
    @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
    button:focus-visible{outline:2px solid ${C.accent}!important;outline-offset:2px!important}
    @media screen and (max-width:767px){input{font-size:16px!important}}
    [role="button"],[role="link"]{cursor:pointer}[data-disabled="true"]{cursor:not-allowed!important;pointer-events:none}
    .modal-message{white-space:pre-wrap}
    *::-webkit-scrollbar{width:6px}*::-webkit-scrollbar-thumb{background:${C.inputBorder};border-radius:3px}
  `;
  document.head?.appendChild?.(style);
  if (!document.getElementById?.(META_ID)) {
    const m = document.createElement?.('meta');
    if (m) { m.id = META_ID; document.head?.appendChild?.(m); }
    document.title = 'Log In – MyArchetype';
    if (document.documentElement) { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; }
    let vp = document.querySelector?.('meta[name="viewport"]');
    if (!vp) { vp = document.createElement?.('meta') ?? null; vp?.setAttribute?.('name', 'viewport'); if (vp) document.head?.appendChild?.(vp); }
    vp?.setAttribute?.('content', 'width=device-width,initial-scale=1');
  }
};

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential':     'Invalid email or password. Please try again.',
  'auth/user-not-found':         'Invalid email or password. Please try again.',
  'auth/wrong-password':         'Invalid email or password. Please try again.',
  'auth/too-many-requests':      'Too many failed attempts. Please wait or reset your password.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/user-disabled':          'This account has been disabled. Please contact support.',
  'auth/invalid-email':          'Please enter a valid email address.',
};
const getErrorMessage = (code?: string) => (code && ERROR_MESSAGES[code]) ?? 'An unexpected error occurred.';

type AlertBtn = { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };
const showNativeAlert = (title: string, message: string, buttons?: AlertBtn[]) =>
  Alert.alert(title, message, buttons ?? [{ text: 'OK' }]);

const triggerHaptic = async (type: 'success' | 'error' | 'light') => {
  if (IS_WEB) return;
  try {
    const H = await import('expo-haptics');
    if (type === 'success') await H.notificationAsync(H.NotificationFeedbackType.Success);
    else if (type === 'error') await H.notificationAsync(H.NotificationFeedbackType.Error);
    else await H.impactAsync(H.ImpactFeedbackStyle.Light);
  } catch {}
};

const validators = {
  email:    (v: string) => !v ? 'Email is required' : v.length > MAX_EMAIL_LENGTH ? `Email must be under ${MAX_EMAIL_LENGTH} chars` : !EMAIL_REGEX.test(v) ? 'Invalid email format' : '',
  password: (v: string) => !v ? 'Password is required' : v.length > MAX_PASSWORD_LENGTH ? 'Password too long' : v.length < 6 ? 'At least 6 characters' : '',
};

type FormState = {
  email: string; password: string; emailError: string; passwordError: string;
  showPassword: boolean; emailFocused: boolean; passwordFocused: boolean;
  loading: boolean; lockoutSeconds: number; capsLockOn: boolean;
};
type FormAction =
  | { type: 'SET_EMAIL'; payload: string } | { type: 'SET_PASSWORD'; payload: string }
  | { type: 'SET_EMAIL_ERROR'; payload: string } | { type: 'SET_PASSWORD_ERROR'; payload: string }
  | { type: 'TOGGLE_PASSWORD' } | { type: 'SET_EMAIL_FOCUSED'; payload: boolean }
  | { type: 'SET_PASSWORD_FOCUSED'; payload: boolean } | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LOCKOUT_SECONDS'; payload: number } | { type: 'SET_CAPS_LOCK'; payload: boolean }
  | { type: 'CLEAR_ERRORS' } | { type: 'CLEAR_PASSWORD' } | { type: 'HIDE_PASSWORD' }
  | { type: 'WIPE_SENSITIVE' } | { type: 'RESET' };

const initialFormState: FormState = {
  email:'', password:'', emailError:'', passwordError:'', showPassword:false,
  emailFocused:false, passwordFocused:false, loading:false, lockoutSeconds:0, capsLockOn:false,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_EMAIL':            return { ...state, email: action.payload };
    case 'SET_PASSWORD':         return { ...state, password: action.payload };
    case 'SET_EMAIL_ERROR':      return { ...state, emailError: action.payload };
    case 'SET_PASSWORD_ERROR':   return { ...state, passwordError: action.payload };
    case 'TOGGLE_PASSWORD':      return { ...state, showPassword: !state.showPassword };
    case 'SET_EMAIL_FOCUSED':    return { ...state, emailFocused: action.payload };
    case 'SET_PASSWORD_FOCUSED': return { ...state, passwordFocused: action.payload };
    case 'SET_LOADING':          return { ...state, loading: action.payload };
    case 'SET_LOCKOUT_SECONDS':  return { ...state, lockoutSeconds: action.payload };
    case 'SET_CAPS_LOCK':        return { ...state, capsLockOn: action.payload };
    case 'CLEAR_ERRORS':         return { ...state, emailError: '', passwordError: '' };
    case 'CLEAR_PASSWORD':       return { ...state, password: '' };
    case 'HIDE_PASSWORD':        return { ...state, showPassword: false };
    case 'WIPE_SENSITIVE':       return { ...state, password: '' };
    case 'RESET':                return { ...initialFormState, email: state.email };
    default:                     return state;
  }
}

const AnimatedError = React.memo(({ message, inputId, C }: { message: string; inputId: string; C: Tokens }) => {
  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(-8);

  useEffect(() => {
    if (message) {
      opacity.value    = withSpring(1, { mass: 0.3, damping: 20 }, []);
      translateY.value = withSpring(0, { mass: 0.3, damping: 20, stiffness: 180 });
      if (!IS_WEB) runOnJS(AccessibilityInfo.announceForAccessibility)(message);
    } else {
      opacity.value    = withTiming(0, { duration: getAnimDuration(150) });
      translateY.value = -8;
    }
  }, [message, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!message) return null;
  const webProps: WebAriaProps = IS_WEB
    ? { 'aria-live': 'assertive', 'aria-atomic': 'true', id: `${inputId}-error` }
    : {};
  return (
    <Animated.View style={[s.errorRow, animStyle]} accessibilityLiveRegion="assertive" {...webProps}>
      <Ionicons name="alert-circle" size={14} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={[s.errorText, { color: C.error }]}>{message}</Text>
    </Animated.View>
  );
});

const BrandLogo = React.memo(({ C, paused }: { C: Tokens; paused: boolean }) => {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (prefersReducedMotion || paused) {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 }, []);
      return;
    }

    let cancelled = false;
    const startAnim = () => {
      if (cancelled) return;
      scale.value = withRepeat(
        withSequence(
          withTiming(1.04, { duration: getAnimDuration(2400), easing: Easing.inOut(Easing.ease) }),
          withTiming(1,    { duration: getAnimDuration(2400), easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    };

    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(startAnim);
      return () => { cancelled = true; cancelIdleCallback(id); cancelAnimation(scale); };
    } else {
      const t = setTimeout(startAnim, 0);
      return () => { cancelled = true; clearTimeout(t); cancelAnimation(scale); };
    }
  }, [paused, scale]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[s.logoOuter, animStyle]} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[s.logoCircle, { backgroundColor: C.accentGlow, borderColor: C.logoBorder }]}>
        <Ionicons name="heart" size={38} color={C.accent} />
      </View>
    </Animated.View>
  );
});

type ModalButton = { label: string; onPress?: () => void | Promise<void>; primary?: boolean; danger?: boolean };
type ModalConfig  = { title: string; message: string; buttons: ModalButton[] };

const CustomModal = React.memo(({ config, onClose, C }: { config: ModalConfig; onClose: () => void; C: Tokens }) => {
  const opacity   = useSharedValue(0);
  const scale     = useSharedValue(0.92);
  const isClosing = useRef(false);

  const doClose = useCallback(async (btn?: ModalButton) => {
    if (isClosing.current) return;
    isClosing.current = true;
    opacity.value = withTiming(0, { duration: getAnimDuration(150) }, (finished) => {
      if (finished) runOnJS(async () => {
        if (btn?.onPress) await btn.onPress();
        onClose();
      })();
    });
  }, [opacity, onClose]);

  const doCloseRef = useRef(doClose);
  const configRef  = useRef(config);
  useEffect(() => { doCloseRef.current = doClose; },  [doClose]);
  useEffect(() => { configRef.current  = config;  },  [config]);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: getAnimDuration(200) }, []);
    scale.value   = withSpring(1, { mass: 0.4, damping: 18, stiffness: 200 });

    if (!IS_WEB) return;
    const handleKeyDown = (e: unknown) => {
      const key = typeof e === 'object' && e !== null && 'key' in e ? (e as WebKeyEvent).key : undefined;
      if (key === 'Escape') {
        const cancelBtn = configRef.current.buttons.find(b => !b.primary && !b.danger);
        void doCloseRef.current(cancelBtn);
      }
    };
    window.addEventListener?.('keydown', handleKeyDown);
    return () => window.removeEventListener?.('keydown', handleKeyDown);
  }, [opacity, scale]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle    = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const webDialogProps: WebAriaProps = IS_WEB ? { role: 'dialog', 'aria-modal': 'true' } : {};
  return (
    <Animated.View
      style={[s.modalOverlay, { backgroundColor: C.overlay }, overlayStyle]}
      {...webDialogProps}
      accessibilityViewIsModal
    >
      <Pressable
        style={s.absoluteFill}
        onPress={() = accessibilityLabel="button"> void doClose(config.buttons.find(b => !b.primary && !b.danger))}
        accessibilityLabel="Close dialog"
      />
      <Animated.View style={[s.modalCard, { backgroundColor: C.card, borderColor: C.cardBorder }, cardStyle]}>
        <Text style={[s.modalTitle,   { color: C.textPrimary }]}>{config.title}</Text>
        <Text style={[s.modalMessage, { color: C.textSecondary }]}>{config.message}</Text>
        <View style={s.modalButtons}>
          {config.buttons.map((btn, i) => (
            <Pressable
              key={btn.label + i}
              onPress={() = accessibilityLabel="button"> void doClose(btn)}
              style={({ pressed }) => [
                s.modalButton,
                {
                  backgroundColor: btn.primary ? C.accent : btn.danger ? C.error : 'transparent',
                  borderColor:     btn.primary ? C.accent : btn.danger ? C.error : C.separator,
                  opacity:         pressed ? 0.8 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={btn.label}
            >
              <Text style={[s.modalButtonText, { color: btn.primary || btn.danger ? C.white : C.textSecondary, fontWeight: btn.primary ? '700' : '500' }]}>
                {btn.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
});

const useShake = () => {
  const translateX = useSharedValue(0);

  const shake = useCallback(() => {
    if (prefersReducedMotion) return;
    translateX.value = withSequence(
      withTiming( 10, { duration: 60 }),
      withTiming(-10, { duration: 60 }),
      withTiming(  8, { duration: 60 }),
      withTiming( -8, { duration: 60 }),
      withTiming(  4, { duration: 60 }),
      withTiming(  0, { duration: 60 }),
    );
  }, [translateX]);

  return { translateX, shake };
};

const GradientButton = React.memo(({ onPress, disabled, loading, label, C }: {
  onPress: () => void; disabled: boolean; loading: boolean; label: string; C: Tokens;
}) => {
  const scale      = useSharedValue(1);
  const isDisabled = disabled || loading;

  const handlePressIn = useCallback(() => {
    if (isDisabled) return;
    scale.value = withSpring(0.97, { mass: 0.3, damping: 20 });
    void triggerHaptic('light');
  }, [scale, isDisabled]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { mass: 0.3, damping: 20 });
  }, [scale]);

  const animStyle  = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const gradColors = useMemo(
    () => (isDisabled ? [C.disabledBg, C.disabledBg] : [C.buttonGradStart, C.buttonGradEnd]) as [string, string],
    [isDisabled, C],
  );

  return (
    <Animated.View style={[s.buttonOuter, { shadowColor: isDisabled ? 'transparent' : C.accent }, animStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
      >
        <View pointerEvents={isDisabled ? 'none' : 'auto'} style={s.gradientButtonInner}>
          <LinearGradient colors={gradColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.button, isDisabled && s.buttonDisabled]}>
            {loading ? <ActivityIndicator color={C.white} size="small" /> : (
              <View style={s.buttonContent}>
                <Text style={[s.buttonText, isDisabled && { color: C.disabledText }]}>{label}</Text>
                <Ionicons name={IS_RTL ? 'arrow-back' : 'arrow-forward'} size={18} color={isDisabled ? C.disabledText : C.white} accessibilityElementsHidden importantForAccessibility="no" />
              </View>
            )}
          </LinearGradient>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const buildWebInputStyle = (C: Tokens): WebStyleProps => ({
  outline:'none', outlineWidth:0, boxShadow:'none', border:'none',
  WebkitTextFillColor:C.textPrimary, caretColor:C.accent, backgroundColor:'transparent',
  paddingTop:18, paddingBottom:18, paddingLeft:4, flex:1, fontSize:16, letterSpacing:0.2,
  color:C.textPrimary, direction: IS_RTL ? 'rtl' : 'ltr',
});

type TextKeyPressLike = { nativeEvent?: { key?: string; getModifierState?: (key: string) => boolean } };

const InputField = React.memo(({
  label, icon, placeholder, value, onChangeText, error, focused, onFocus, onBlur, secureTextEntry,
  showPassword, onTogglePassword, keyboardType, autoComplete, textContentType, webAutoComplete, webInputName,
  returnKeyType, onSubmitEditing, inputRef, editable, accessibilityLabel, inputId, C, onKeyPress,
}: {
  label: string; icon: keyof typeof Ionicons.glyphMap; placeholder: string; value: string;
  onChangeText: (t: string) => void; error: string; focused: boolean; onFocus: () => void; onBlur: () => void;
  secureTextEntry?: boolean; showPassword?: boolean; onTogglePassword?: () => void;
  keyboardType?: 'default' | 'email-address'; autoComplete?: 'email' | 'current-password';
  textContentType?: 'emailAddress' | 'password'; webAutoComplete?: string; webInputName?: string;
  returnKeyType?: 'next' | 'go'; onSubmitEditing?: () => void; inputRef?: React.RefObject<TextInput | null>;
  editable?: boolean; accessibilityLabel: string; inputId: string; C: Tokens; onKeyPress?: (e: TextKeyPressLike) => void;
}) => {
  const borderProgress = useSharedValue(0);
  const hasError       = !!error;
  const webStyle       = useMemo(() => buildWebInputStyle(C), [C]);

  useEffect(() => {
    borderProgress.value = withTiming(focused ? 1 : 0, { duration: getAnimDuration(200) }, []);
  }, [focused, borderProgress]);

  const borderStyle = useAnimatedStyle(() => {
    const t = borderProgress.value;
    const from = hasError ? C.error : C.inputBorder;
    const to   = hasError ? C.error : C.accent;
    return {
      borderColor: t > 0.5 ? to : from,
      shadowOpacity: focused ? 0.15 * t : 0,
    };
  });

  const webNameProp: WebInputProps  = webInputName ? { name: webInputName } : {};
  const webErrorProps: WebAriaProps = hasError
    ? { 'aria-describedby': `${inputId}-error`, 'aria-invalid': 'true', 'aria-required': 'true' }
    : { 'aria-required': 'true' };

  return (
    <View style={s.inputContainer}>
      <Text
        style={[s.inputLabel, { color: C.textMuted }, focused && { color: C.accent }, hasError && { color: C.error }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Text>
      <Animated.View
        style={[
          s.inputWrapper,
          { backgroundColor: hasError ? C.errorGlow : C.inputBg, shadowColor: C.inputShadow },
          focused && s.inputWrapperFocused,
          borderStyle,
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
            textContentType={textContentType}
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
          />
        )}
        {onTogglePassword && (
          <Pressable
            onPress={onTogglePassword}
            hitSlop={12}
            style={s.eyeButton}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={focused ? C.accent : C.textMuted} />
          </Pressable>
        )}
      </Animated.View>
      <AnimatedError message={error} inputId={inputId} C={C} />
    </View>
  );
});

const LockoutBanner = React.memo(({ seconds, C }: { seconds: number; C: Tokens }) =>
  !seconds ? null : (
    <View style={[s.lockoutBanner, { backgroundColor: C.errorGlow, borderColor: C.error }]} accessibilityLiveRegion="polite">
      <Ionicons name="time-outline" size={16} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={[s.lockoutText, { color: C.error }]}>
        Too many attempts — try again in <Text style={{ fontWeight: '800' }}>{seconds}s</Text>
      </Text>
    </View>
  ),
);

const SuccessOverlay = React.memo(({ C, secondsLeft }: { C: Tokens; secondsLeft: number }) => {
  const opacity   = useSharedValue(0);
  const scale     = useSharedValue(0);
  const iconScale = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: getAnimDuration(200) }, []);
    scale.value   = withSpring(1, { mass: 0.5, damping: 14, stiffness: 120 }, (finished) => {
      if (finished) {
        iconScale.value = withSpring(1, { mass: 0.4, damping: 12, stiffness: 100 });
      }
    });
    if (!IS_WEB) runOnJS(AccessibilityInfo.announceForAccessibility)('Login successful. Welcome back!');
  }, [opacity, scale, iconScale]);

  const overlayStyle  = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle     = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const iconAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));

  return (
    <Animated.View
      style={[s.successOverlay, { backgroundColor: C.overlay }, overlayStyle]}
      pointerEvents="box-only"
      accessibilityViewIsModal
      accessibilityLiveRegion="assertive"
    >
      <Animated.View
        style={[s.successCard, { backgroundColor: C.card, borderColor: C.cardBorder }, cardStyle]}
        accessibilityRole="alert"
      >
        <Animated.View style={iconAnimStyle}>
          <View style={[s.successIconCircle, { backgroundColor: C.successGlow }]}>
            <Ionicons name="checkmark-circle" size={56} color={C.success} />
          </View>
        </Animated.View>
        <Text style={[s.successTitle, { color: C.textPrimary }]}>Welcome back!</Text>
        <Text style={[s.successSub,   { color: C.textSecondary }]}>Redirecting in {secondsLeft}…</Text>
        <ActivityIndicator size="small" color={C.accent} style={{ marginTop: 4 }} />
      </Animated.View>
    </Animated.View>
  );
});

class LoginErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() {}
  render() {
    if (this.state.hasError) {
      const C = Appearance.getColorScheme() !== 'light' ? darkTokens : lightTokens;
      return (
        <View style={[s.errorFallback, { backgroundColor: C.bg }]}>
          <Ionicons name="warning-outline" size={48} color={C.error} />
          <Text style={[s.errorFallbackTitle, { color: C.textPrimary }]}>Something went wrong</Text>
          <Text style={[s.errorFallbackSub,   { color: C.textSecondary }]}>Please restart the app.</Text>
          <TouchableOpacity
            onPress={() = accessibilityLabel="button"> this.setState({ hasError: false })}
            style={[s.retryButton, { borderColor: C.accent }]}
          >
            <Text style={[s.retryText, { color: C.accent }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function LoginScreen() {
  const router      = useRouter();
  const colorScheme = useColorScheme();
  const isDark      = colorScheme !== 'light';
  const C: Tokens   = isDark ? darkTokens : lightTokens;

  useEffect(() => { injectWebStyles(C, isDark ? 'dark' : 'light'); }, [C, isDark]);

  useEffect(() => {
    if (!IS_WEB) return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const h  = (e: WebMediaEvent) => { prefersReducedMotion = e.matches; };
    mq?.addEventListener?.('change', h);
    return () => mq?.removeEventListener?.('change', h);
  }, []);

  const [state, dispatch]       = useReducer(formReducer, initialFormState);
  const [screenData, setSD]     = useState(getScreenData);
  const [showSuccess, setSuccess] = useState(false);
  const [successCountdown, setSuccessCountdown] = useState(Math.ceil(SUCCESS_NAV_DELAY_MS / 1000));
  const [modal,     setModal]   = useState<ModalConfig | null>(null);
  const [appActive, setAppActive] = useState(true);

  const isMounted       = useRef(true);
  const loginAttempts   = useRef(0);
  const lockoutUntil    = useRef(0);
  const lockoutTimer    = useRef<ReturnType<typeof setInterval>  | null>(null);
  const navTimeout      = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const successTimer    = useRef<ReturnType<typeof setInterval>  | null>(null);
  const focusTimeout    = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const passwordRef     = useRef<TextInput>(null);
  const emailRef        = useRef<TextInput>(null);
  const scrollRef       = useRef<ScrollView>(null);
  const resendAttempts  = useRef(0);
  const resendLockUntil = useRef(0);
  const forgotAttempts  = useRef(0);
  const forgotLockUntil = useRef(0);

  const { translateX, shake } = useShake();

  const fadeProgress   = useSharedValue(0);
  const slideProgress  = useSharedValue(prefersReducedMotion ? 0 : 1);
  const headerProgress = useSharedValue(0);
  const formProgress   = useSharedValue(0);
  const footerOpacity  = useSharedValue(0);

  const screenStyle = useAnimatedStyle(() => ({
    opacity:   fadeProgress.value,
    transform: [{ translateY: slideProgress.value * 40 }],
  }));
  const headerStyle = useAnimatedStyle(() => ({
    opacity:   headerProgress.value,
    transform: [{ translateY: (1 - headerProgress.value) * 20 }],
  }));
  const formStyle = useAnimatedStyle(() => ({
    opacity:   formProgress.value,
    transform: [
      { translateX: translateX.value },
      { translateY: (1 - formProgress.value) * 20 },
    ],
  }));
  const footerStyle = useAnimatedStyle(() => ({ opacity: footerOpacity.value }));

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (lockoutTimer.current)  { clearInterval(lockoutTimer.current);  lockoutTimer.current  = null; }
      if (navTimeout.current)    { clearTimeout(navTimeout.current);     navTimeout.current    = null; }
      if (successTimer.current)  { clearInterval(successTimer.current);  successTimer.current  = null; }
      if (focusTimeout.current)  { clearTimeout(focusTimeout.current);   focusTimeout.current  = null; }
      dispatch({ type: 'WIPE_SENSITIVE' });
    };
  }, []);

  useEffect(() => {
    if (!IS_WEB) return;
    const h = debounce(() => setSD(getScreenData()), RESIZE_DEBOUNCE_MS);
    window.addEventListener?.('resize', h as (e: unknown) => void);
    return () => { window.removeEventListener?.('resize', h as (e: unknown) => void); h.cancel(); };
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
  // FIXME: add removeEventListener cleanup for the listener below
    const sub = AppState.addEventListener('change', (st: AppStateStatus) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
  // FIXME: add removeEventListener cleanup for the listener below
    const sub = BackHandler.addEventListener('hardwareBackPress', () => state.loading || showSuccess);
    return () => sub.remove();
  }, [state.loading, showSuccess]);

  useEffect(() => {
    let cancelled = false;

    const runAnims = () => {
      if (cancelled || !isMounted.current) return;
      fadeProgress.value  = withTiming(1, { duration: getAnimDuration(300) }, []);
      slideProgress.value = withTiming(0, { duration: getAnimDuration(400) });
      headerProgress.value = withTiming(1, { duration: getAnimDuration(500) });

      const t1 = setTimeout(() => {
        if (cancelled || !isMounted.current) return;
        formProgress.value = withTiming(1, { duration: getAnimDuration(500) });
      }, getAnimDuration(150));

      const t2 = setTimeout(() => {
        if (cancelled || !isMounted.current) return;
        footerOpacity.value = withTiming(1, { duration: getAnimDuration(400) });
      }, getAnimDuration(300));

      return () => { clearTimeout(t1); clearTimeout(t2); };
    };

    let innerCleanup: (() => void) | undefined;
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => { innerCleanup = runAnims() ?? undefined; });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
        innerCleanup?.();
      };
    } else {
      const t = setTimeout(() => { innerCleanup = runAnims() ?? undefined; }, 0);
      return () => {
        cancelled = true;
        clearTimeout(t);
        innerCleanup?.();
      };
    }
  }, [fadeProgress, slideProgress, headerProgress, formProgress, footerOpacity]);

  const startLockoutCountdown = useCallback(() => {
    if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    const tick = () => {
      if (!isMounted.current) return;
      const r = Math.ceil((lockoutUntil.current - Date.now()) / 1000);
      if (r <= 0) {
        dispatch({ type: 'SET_LOCKOUT_SECONDS', payload: 0 });
        if (lockoutTimer.current) { clearInterval(lockoutTimer.current); lockoutTimer.current = null; }
      } else dispatch({ type: 'SET_LOCKOUT_SECONDS', payload: r });
    };
    tick();
    lockoutTimer.current = setInterval(tick, 1000);
  }, []);

  const startSuccessCountdown = useCallback(() => {
    const total = Math.ceil(SUCCESS_NAV_DELAY_MS / 1000);
    setSuccessCountdown(total);
    let rem = total;
    if (successTimer.current) clearInterval(successTimer.current);
    successTimer.current = setInterval(() => {
      rem -= 1;
      if (isMounted.current) setSuccessCountdown(rem);
      if (rem <= 0 && successTimer.current) { clearInterval(successTimer.current); successTimer.current = null; }
    }, 1000);
  }, []);

  const openModal  = useCallback((cfg: ModalConfig) => setModal(cfg), []);
  const closeModal = useCallback(() => setModal(null), []);

  const showAppAlert = useCallback((title: string, message: string, buttons?: AlertBtn[]) => {
    if (IS_WEB) {
      openModal({
        title, message,
        buttons: (buttons ?? [{ text: 'OK' }]).map((b, _, arr) => ({
          label: b.text, onPress: b.onPress,
          primary: b.style !== 'cancel' && arr.length > 1,
          danger:  b.style === 'destructive',
        })),
      });
    } else showNativeAlert(title, message, buttons);
  }, [openModal]);

  const handleKeyPress = useCallback((e: TextKeyPressLike) => {
    if (!IS_WEB || !e?.nativeEvent?.key) return;
    dispatch({ type: 'SET_CAPS_LOCK', payload: e.nativeEvent.getModifierState?.('CapsLock') ?? false });
  }, []);

  const canSubmit = useMemo(() => !!(
    state.email.trim() && state.password && !state.emailError && !state.passwordError &&
    !state.loading && state.lockoutSeconds === 0
  ), [state.email, state.password, state.emailError, state.passwordError, state.loading, state.lockoutSeconds]);

  const onEmailFocus    = useCallback(() => dispatch({ type: 'SET_EMAIL_FOCUSED',    payload: true }),  []);
  const onEmailBlur     = useCallback(() => dispatch({ type: 'SET_EMAIL_FOCUSED',    payload: false }), []);
  const onPasswordFocus = useCallback(() => dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: true }),  []);
  const onPasswordBlur  = useCallback(() => {
    dispatch({ type: 'SET_PASSWORD_FOCUSED', payload: false });
    dispatch({ type: 'HIDE_PASSWORD' });
  }, []);
  const togglePassword  = useCallback(() => dispatch({ type: 'TOGGLE_PASSWORD' }), []);

  const validateEmail = useCallback((text: string) => {
    const s = text.trimStart().slice(0, MAX_EMAIL_LENGTH + 1).replace(/[\n\r]/g, '');
    dispatch({ type: 'SET_EMAIL', payload: s });
    if (s.length < 3) return dispatch({ type: 'SET_EMAIL_ERROR', payload: '' });
    dispatch({ type: 'SET_EMAIL_ERROR', payload: validators.email(s) });
  }, []);

  const validatePassword = useCallback((text: string) => {
    const s = text.slice(0, MAX_PASSWORD_LENGTH + 1);
    dispatch({ type: 'SET_PASSWORD', payload: s });
    if (!s) return dispatch({ type: 'SET_PASSWORD_ERROR', payload: '' });
    dispatch({ type: 'SET_PASSWORD_ERROR', payload: validators.password(s) });
  }, []);

  const dismissKeyboard = useCallback(() => { if (!IS_WEB) Keyboard.dismiss(); }, []);

  const handleLogin = useCallback(async () => {
    dismissKeyboard();
    dispatch({ type: 'CLEAR_ERRORS' });
    const email    = state.email.trim().toLowerCase();
    const password = state.password;
    const emailErr = validators.email(email);
    const passErr  = validators.password(password);
    if (emailErr) { dispatch({ type: 'SET_EMAIL_ERROR',    payload: emailErr }); shake(); return; }
    if (passErr)  { dispatch({ type: 'SET_PASSWORD_ERROR', payload: passErr  }); shake(); return; }
    if (Date.now() < lockoutUntil.current) { startLockoutCountdown(); shake(); return; }

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'HIDE_PASSWORD' });

    try {
      const fp = await getDeviceFingerprint();
      if (fp) {
        const multiCheck = await checkDeviceMultiAccount(fp);
        if (multiCheck.suspicious) {
          if (!isMounted.current) return;
          dispatch({ type: 'SET_LOADING', payload: false });
          showAppAlert('Account Restricted', 'Multiple accounts detected from this device. Please contact support.');
          shake(); return;
        }
      }
      const bannedCheck = await checkUserBanned(email);
      if (bannedCheck.banned) {
        if (!isMounted.current) return;
        dispatch({ type: 'SET_LOADING', payload: false });
        showAppAlert('Account Suspended', bannedCheck.reason ?? 'This account has been suspended. Contact support.');
        shake(); return;
      }

      try {
        const loginSafety = await checkLogin(email, password, '', {
          serverUrl: '', enableLoginCheck: true, enableMessageCheck: false,
          enablePhotoCheck: false, enableRegistrationCheck: false, enableProfileCheck: false,
          autoBlockCritical: true, logAllChecks: false,
        });
        if (!loginSafety.allowed) {
          if (!isMounted.current) return;
          dispatch({ type: 'SET_LOADING', payload: false });
          showAppAlert('Access Denied', loginSafety.reasons.join('\n') || 'Login blocked by safety system.');
          shake(); return;
        }
      } catch (safetyErr) {
        if (__DEV__) console.warn('[Login] Safety middleware check failed, continuing:', safetyErr);
      }

      const hadLocalKeys    = !!(await getLocalE2EEKeypair());
      const { user }        = await signInWithEmailAndPassword(auth, email, password);
      if (!user.emailVerified) {
        await auth.signOut();
        if (!isMounted.current) return;
        dispatch({ type: 'SET_LOADING', payload: false });
        shake();
        showAppAlert('Email Not Verified', 'Please verify your email before logging in.\n\nCheck your inbox (and spam folder).', [{ text: 'OK' }]);
        return;
      }
      if (fp) await recordDeviceLogin(user.uid, fp, email);
      const e2eeResult   = await ensureMyE2EEIdentity();
      const hasKeysAfter = !!(await getLocalE2EEKeypair());
      await writeAuditLog('user.login', {
        uid: user.uid,
        maskedEmail: email.replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.min(String(b).length, 6))}${c}`),
        emailDomain: email.split('@')[1] ?? '',
        deviceFingerprint: fp,
        e2eeInitialized: e2eeResult.success,
      });
      loginAttempts.current = 0;
      if (lockoutTimer.current) { clearInterval(lockoutTimer.current); lockoutTimer.current = null; }
      await triggerHaptic('success');
      dispatch({ type: 'CLEAR_PASSWORD' });
      if (!isMounted.current) return;
      dispatch({ type: 'SET_LOADING', payload: false });
      if (!hadLocalKeys && hasKeysAfter) {
        showAppAlert('Encrypted Chats Reset', 'A new encryption key was created for this device. Older encrypted chats may not be readable here.', [{ text: 'Continue' }]);
      }
      setSuccess(true);
      startSuccessCountdown();
      navTimeout.current = setTimeout(() => {
        if (isMounted.current) router.replace(ROUTES.HOME);
      }, getAnimDuration(SUCCESS_NAV_DELAY_MS));
    } catch (error: unknown) {
      const code = getErrorCode(error);
      loginAttempts.current += 1;
      if (loginAttempts.current >= MAX_LOGIN_ATTEMPTS) {
        lockoutUntil.current  = Date.now() + LOCKOUT_DURATION_MS;
        loginAttempts.current = 0;
        startLockoutCountdown();
      }
      await triggerHaptic('error');
      shake();
      if (!isMounted.current) return;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        dispatch({ type: 'CLEAR_PASSWORD' });
        focusTimeout.current = setTimeout(() => passwordRef.current?.focus(), FOCUS_RETURN_DELAY_MS);
      } else if (code === 'auth/invalid-email') {
        focusTimeout.current = setTimeout(() => emailRef.current?.focus(), FOCUS_RETURN_DELAY_MS);
      }
      showAppAlert('Login Failed', getErrorMessage(code));
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.email, state.password, router, dismissKeyboard, startLockoutCountdown, startSuccessCountdown, shake, showAppAlert]);

  const handleResendVerification = useCallback(async () => {
    dismissKeyboard();
    const email    = state.email.trim();
    const password = state.password;
    if (!email)                    return showAppAlert('Email Required',    'Please enter your email address first.');
    if (!password)                 return showAppAlert('Password Required', 'Please enter your password to verify identity.');
    if (validators.email(email))   return showAppAlert('Invalid Email',     'Please enter a valid email address.');
    if (Date.now() < resendLockUntil.current) {
      const secs = Math.ceil((resendLockUntil.current - Date.now()) / 1000);
      return showAppAlert('Please Wait', `You can resend again in ${secs} seconds.`);
    }
    resendAttempts.current += 1;
    if (resendAttempts.current > MAX_RESEND_ATTEMPTS) {
      resendLockUntil.current = Date.now() + RATE_LIMIT_WINDOW_MS;
      resendAttempts.current  = 0;
      return showAppAlert('Too Many Requests', 'Please wait 60 seconds before requesting another email.');
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const { user } = await signInWithEmailAndPassword(auth, email.toLowerCase(), password);
      if (user.emailVerified) {
        await auth.signOut();
        if (isMounted.current) showAppAlert('Already Verified', 'Your email is already verified. You can log in now.');
        return;
      }
      await sendEmailVerification(user);
      await auth.signOut();
      if (isMounted.current) showAppAlert('Email Sent', `Verification email sent to:\n${email}`);
    } catch (error: unknown) {
      if (isMounted.current) showAppAlert('Error', getErrorMessage(getErrorCode(error)));
    } finally {
      if (isMounted.current) dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.email, state.password, dismissKeyboard, showAppAlert]);

  const handleForgotPassword = useCallback(() => {
    dismissKeyboard();
    const email = state.email.trim();
    if (!email)                  return showAppAlert('Email Required', 'Please enter your email address above, then try again.');
    if (validators.email(email)) { dispatch({ type: 'SET_EMAIL_ERROR', payload: 'Please enter a valid email' }); return; }
    if (Date.now() < forgotLockUntil.current) {
      const secs = Math.ceil((forgotLockUntil.current - Date.now()) / 1000);
      return showAppAlert('Please Wait', `You can request another reset in ${secs} seconds.`);
    }
    forgotAttempts.current += 1;
    if (forgotAttempts.current > MAX_FORGOT_ATTEMPTS) {
      forgotLockUntil.current = Date.now() + RATE_LIMIT_WINDOW_MS;
      forgotAttempts.current  = 0;
      return showAppAlert('Too Many Requests', 'Please wait 60 seconds before requesting another reset.');
    }
    showAppAlert('Reset Password', `Send password reset email to:\n${email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send Reset Email',
        onPress: async () => {
          dispatch({ type: 'SET_LOADING', payload: true });
          try {
            await sendPasswordResetEmail(auth, email.toLowerCase());
            if (isMounted.current) showAppAlert('Email Sent', `Password reset instructions sent to:\n${email}`);
          } catch (error: unknown) {
            if (isMounted.current) showAppAlert('Error', getErrorMessage(getErrorCode(error)));
          } finally {
            if (isMounted.current) dispatch({ type: 'SET_LOADING', payload: false });
          }
        },
      },
    ]);
  }, [state.email, dismissKeyboard, showAppAlert]);

  const handleSignUp      = useCallback(() => { if (!state.loading) router.push(ROUTES.SIGNUP); }, [state.loading, router]);
  const handleEmailSubmit = useCallback(() => passwordRef.current?.focus(), []);
  const IS_SMALL          = screenData.isSmall;
  const logoPaused        = state.emailFocused || state.passwordFocused || state.loading || !appActive;

  const innerContentProps: InnerContentProps = useMemo(() => ({
    C, state, IS_SMALL,
    screenStyle, headerStyle, formStyle, footerStyle,
    emailRef, passwordRef, canSubmit, logoPaused,
    validateEmail, validatePassword,
    onEmailFocus, onEmailBlur, onPasswordFocus, onPasswordBlur,
    togglePassword, handleLogin, handleEmailSubmit,
    handleForgotPassword, handleResendVerification, handleSignUp, handleKeyPress,
  }), [
    C, state, IS_SMALL,
    screenStyle, headerStyle, formStyle, footerStyle,
    emailRef, passwordRef, canSubmit, logoPaused,
    validateEmail, validatePassword,
    onEmailFocus, onEmailBlur, onPasswordFocus, onPasswordBlur,
    togglePassword, handleLogin, handleEmailSubmit,
    handleForgotPassword, handleResendVerification, handleSignUp, handleKeyPress,
  ]);

  return (
    <LoginErrorBoundary>
      <View style={[s.rootBg, { backgroundColor: C.bg }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} translucent={false} />
        <LinearGradient
          colors={[C.bgGradientStart, C.bgGradientMid, C.bgGradientEnd]}
          style={s.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
        <SafeAreaView style={s.safe}>
          <KeyboardAvoidingView
            behavior={Platform.select({ ios: 'padding', android: 'height', default: undefined })}
            style={s.container}
            keyboardVerticalOffset={IS_IOS ? 0 : 20}
          >
            {IS_WEB ? (
              <View style={s.fill}>
                <ScrollView
                  ref={scrollRef}
                  contentContainerStyle={[s.scrollContent, { padding: IS_SMALL ? 20 : 28 }]}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <InnerContent {...innerContentProps} />
                </ScrollView>
              </View>
            ) : (
              <Pressable style={s.fill} onPress={dismissKeyboard} accessibilityLabel="button">
                <ScrollView
                  ref={scrollRef}
                  contentContainerStyle={[s.scrollContent, { padding: IS_SMALL ? 20 : 28 }]}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <InnerContent {...innerContentProps} />
                </ScrollView>
              </Pressable>
            )}

            {state.loading && !showSuccess && (
              <Animated.View
                entering={FadeIn.duration(getAnimDuration(150))}
                exiting={FadeOut.duration(getAnimDuration(150))}
                style={[s.loadingOverlay, { backgroundColor: C.overlay }]}
                pointerEvents="box-only"
                accessibilityViewIsModal
                accessibilityLiveRegion="polite"
              >
                <View
                  style={[s.loadingCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}
                  accessibilityRole="alert"
                >
                  <ActivityIndicator size="large" color={C.accent} />
                  <Text style={[s.loadingText, { color: C.textSecondary }]}>Signing you in…</Text>
                </View>
              </Animated.View>
            )}

            {showSuccess && <SuccessOverlay C={C} secondsLeft={successCountdown} />}
            {modal && IS_WEB && <CustomModal config={modal} onClose={closeModal} C={C} />}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </LoginErrorBoundary>
  );
}

type InnerContentProps = {
  C: Tokens; state: FormState; IS_SMALL: boolean;
  screenStyle: ReturnType<typeof useAnimatedStyle>;
  headerStyle: ReturnType<typeof useAnimatedStyle>;
  formStyle:   ReturnType<typeof useAnimatedStyle>;
  footerStyle: ReturnType<typeof useAnimatedStyle>;
  emailRef:    React.RefObject<TextInput | null>;
  passwordRef: React.RefObject<TextInput | null>;
  canSubmit: boolean; logoPaused: boolean;
  validateEmail: (t: string) => void; validatePassword: (t: string) => void;
  onEmailFocus: () => void; onEmailBlur: () => void;
  onPasswordFocus: () => void; onPasswordBlur: () => void;
  togglePassword: () => void; handleLogin: () => void; handleEmailSubmit: () => void;
  handleForgotPassword: () => void; handleResendVerification: () => void;
  handleSignUp: () => void; handleKeyPress: (e: TextKeyPressLike) => void;
};


const InnerContent = React.memo(({
  C, state, IS_SMALL,
  screenStyle, headerStyle, formStyle, footerStyle,
  emailRef, passwordRef, canSubmit, logoPaused,
  validateEmail, validatePassword,
  onEmailFocus, onEmailBlur, onPasswordFocus, onPasswordBlur,
  togglePassword, handleLogin, handleEmailSubmit,
  handleForgotPassword, handleResendVerification, handleSignUp, handleKeyPress,
}: InnerContentProps) => {
  const webFormProps: WebAriaProps = IS_WEB ? { role: 'form', 'aria-label': 'Login form' } : {};
  return (
    <Animated.View style={[s.content, { maxWidth: 440 }, screenStyle]}>
      <Animated.View style={[s.headerContainer, { marginBottom: IS_SMALL ? 28 : 40 }, headerStyle]}>
        <BrandLogo C={C} paused={logoPaused} />
        <Text style={[s.title, { color: C.textPrimary, fontSize: IS_SMALL ? 28 : 36 }]} accessibilityRole="header">
          Welcome Back
        </Text>
        <Text style={[s.subtitle, { color: C.textSecondary, fontSize: IS_SMALL ? 14 : 16 }]}>
          Log in to find your perfect match
        </Text>
      </Animated.View>

      <LockoutBanner seconds={state.lockoutSeconds} C={C} />

      <Animated.View
        style={[
          s.formCard,
          { backgroundColor: C.card, borderColor: C.cardBorder, padding: IS_SMALL ? 24 : 34 },
          formStyle,
        ]}
        {...webFormProps}
      >
        <InputField
          inputId="login-email" label="Email address" icon="mail-outline" placeholder="you@example.com"
          value={state.email} onChangeText={validateEmail} error={state.emailError} focused={state.emailFocused}
          onFocus={onEmailFocus} onBlur={onEmailBlur} keyboardType="email-address" autoComplete="email"
          webAutoComplete="username" webInputName="username" textContentType="emailAddress"
          returnKeyType="next" onSubmitEditing={handleEmailSubmit} inputRef={emailRef}
          editable={!state.loading} accessibilityLabel="Email address" C={C} onKeyPress={handleKeyPress}
        />
        <InputField
          inputId="login-password" label="Password" icon="lock-closed-outline" placeholder="Enter your password"
          value={state.password} onChangeText={validatePassword} error={state.passwordError} focused={state.passwordFocused}
          onFocus={onPasswordFocus} onBlur={onPasswordBlur} secureTextEntry showPassword={state.showPassword}
          onTogglePassword={togglePassword} autoComplete="current-password" webAutoComplete="current-password"
          webInputName="password" textContentType="password" returnKeyType="go" onSubmitEditing={handleLogin}
          inputRef={passwordRef} editable={!state.loading} accessibilityLabel="Password" C={C} onKeyPress={handleKeyPress}
        />
        {IS_WEB && state.capsLockOn && state.passwordFocused && (
          <View style={[s.capsLockRow, { backgroundColor: C.errorGlow, borderColor: C.warn }]} accessibilityLiveRegion="polite">
            <Ionicons name="warning-outline" size={14} color={C.warn} />
            <Text style={[s.capsLockText, { color: C.warn }]}>Caps Lock is on</Text>
          </View>
        )}
        <Pressable
          onPress={handleForgotPassword}
          disabled={state.loading}
          style={s.forgotRow}
          accessibilityRole="link"
          accessibilityLabel="Forgot password"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={[s.forgotText, { color: C.warn }]}>Forgot Password?</Text>
        </Pressable>
        <View style={s.buttonSpacer} />
        <GradientButton onPress={handleLogin} disabled={!canSubmit} loading={state.loading} label="Log In" C={C} />
      </Animated.View>

      <Animated.View style={[s.footer, footerStyle]}>
        <Pressable
          onPress={handleResendVerification}
          disabled={state.loading}
          style={[s.resendButton, { borderColor: C.separator, backgroundColor: C.accentGlow }]}
          accessibilityRole="button"
          accessibilityLabel="Resend verification email"
        >
          <Ionicons name="mail-unread-outline" size={16} color={C.accent} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={[s.resendText, { color: C.accent }]}>Resend Verification Email</Text>
        </Pressable>
        <View style={s.separatorRow} accessibilityElementsHidden importantForAccessibility="no">
          <View style={[s.separatorLine, { backgroundColor: C.separator }]} />
          <Text style={[s.separatorText, { color: C.textMuted }]}>or</Text>
          <View style={[s.separatorLine, { backgroundColor: C.separator }]} />
        </View>
        <Pressable
          onPress={handleSignUp}
          disabled={state.loading}
          style={({ pressed }) = accessibilityLabel="button"> [s.signUpButton, { opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Create a new account"
        >
          <Text style={[s.signUpText, { color: C.textSecondary }]}>
            Don't have an account? <Text style={[s.signUpLink, { color: C.accent }]}>Sign Up</Text>
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
});

const s = StyleSheet.create({
  rootBg:        { flex: 1 },
  safe:          { flex: 1 },
  container:     { flex: 1 },
  fill:          { flex: 1 },
  absoluteFill:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: 52 },
  content:       { width: '100%', alignSelf: 'center' },
  headerContainer: { alignItems: 'center' },
  logoOuter:     { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  logoCircle:    { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  title:         { fontWeight: '800', marginBottom: 10, letterSpacing: -0.5, textAlign: 'center' },
  subtitle:      { textAlign: 'center', lineHeight: 24, letterSpacing: 0.1 },
  lockoutBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 20 },
  lockoutText:   { fontSize: 13, fontWeight: '600', flex: 1 },
  formCard:      { borderRadius: 24, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.2, shadowRadius: 28, elevation: 14 },
  inputContainer: { marginBottom: 26 },
  inputLabel:    { fontSize: 13, fontWeight: '600', marginBottom: 10, marginLeft: 2, letterSpacing: 0.15 },
  inputWrapper:  { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 16, minHeight: 58, shadowOffset: { width: 0, height: 0 }, shadowRadius: 14, elevation: 4 },
  inputWrapperFocused: {},
  inputIcon:     { marginRight: 14, width: 22, textAlign: 'center' },
  inputNative:   { flex: 1, fontSize: 16, paddingVertical: IS_IOS ? 18 : 15, letterSpacing: 0.2, backgroundColor: 'transparent' },
  eyeButton:     { padding: 8, marginLeft: 4, borderRadius: 20 },
  capsLockRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12, marginTop: -12 },
  capsLockText:  { fontSize: 12, fontWeight: '600' },
  errorRow:      { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginLeft: 2, gap: 6 },
  errorText:     { fontSize: 12, fontWeight: '500', flex: 1 },
  forgotRow:     { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, marginTop: -8, marginBottom: 8 },
  forgotText:    { fontSize: 13, fontWeight: '600' },
  buttonSpacer:  { height: 8 },
  buttonOuter:   { width: '100%', borderRadius: 16, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 20, elevation: 12 },
  gradientButtonInner: { borderRadius: 16 },
  button:        { paddingVertical: 20, borderRadius: 16, alignItems: 'center', justifyContent: 'center', minHeight: 62 },
  buttonDisabled: { shadowOpacity: 0, elevation: 0 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText:    { color: '#ffffff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
  footer:        { alignItems: 'center', marginTop: 36, gap: 0, paddingHorizontal: 16 },
  resendButton:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1 },
  resendText:    { fontSize: 14, fontWeight: '600' },
  separatorRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 28, width: '100%' },
  separatorLine: { flex: 1, height: StyleSheet.hairlineWidth },
  separatorText: { fontSize: 13, marginHorizontal: 16, fontWeight: '600', letterSpacing: 0.5 },
  signUpButton:  { paddingVertical: 12, paddingHorizontal: 24 },
  signUpText:    { fontSize: 15, lineHeight: 22 },
  signUpLink:    { fontWeight: '700' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  loadingCard:   { borderRadius: 24, padding: 40, alignItems: 'center', gap: 20, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 16, minWidth: 200 },
  loadingText:   { fontSize: 15, fontWeight: '500' },
  successOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  successCard:   { borderRadius: 28, padding: 48, alignItems: 'center', gap: 16, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 24, elevation: 20 },
  successIconCircle: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  successTitle:  { fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  successSub:    { fontSize: 15, fontWeight: '500', textAlign: 'center', lineHeight: 22 },
  modalOverlay:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: 24 },
  modalCard:     { width: '100%', maxWidth: 400, borderRadius: 22, padding: 30, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 24, elevation: 24, gap: 16 },
  modalTitle:    { fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  modalMessage:  { fontSize: 14, lineHeight: 23 },
  modalButtons:  { flexDirection: 'row', gap: 10, marginTop: 10, justifyContent: 'flex-end', flexWrap: 'wrap' },
  modalButton:   { paddingVertical: 11, paddingHorizontal: 22, borderRadius: 11, borderWidth: 1 },
  modalButtonText: { fontSize: 14 },
  errorFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  errorFallbackTitle: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  errorFallbackSub:   { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  retryButton:   { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12, borderWidth: 1.5 },
  retryText:     { fontSize: 15, fontWeight: '700' },
});