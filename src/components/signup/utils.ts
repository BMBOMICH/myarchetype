import { Platform } from 'react-native';
let QuickCrypto: typeof import('react-native-quick-crypto').default | null = null;
if (Platform.OS !== 'web') { try { QuickCrypto = require('react-native-quick-crypto').default; } catch {} }
import { Alert, Appearance, Dimensions } from 'react-native';
import {
  DISPOSABLE_DOMAINS, IS_WEB, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH,
  SPECIAL_CHARS_REGEX, darkTokens, lightTokens,
} from './constants';
import type { Tokens } from './types';

export const getErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error &&
  typeof (error as { code: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;

export async function getDeviceFingerprint(): Promise<string | null> {
  if (!IS_WEB || typeof navigator === 'undefined' || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement?.('canvas');
    const ctx    = canvas?.getContext?.('2d');
    ctx?.fillText('myarchetype-fp', 2, 10);
    const nav = globalThis.navigator;
    const raw = [
      nav?.userAgent ?? '', nav?.language ?? '', nav?.platform ?? '',
      String(nav?.hardwareConcurrency ?? ''), canvas?.toDataURL?.() ?? '',
    ].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  } catch { return null; }
}

export const getScreenData = () => {
  const { width } = Dimensions.get('window');
  return { width, isSmall: width < 375 };
};

export let prefersReducedMotion = IS_WEB && typeof window !== 'undefined'
  ? !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  : false;

export const updatePrefersReducedMotion = (v: boolean) => { prefersReducedMotion = v; };
export const getAnimDuration = (ms: number) => (prefersReducedMotion ? 0 : ms);

export const isDisposableEmail = (email: string) =>
  DISPOSABLE_DOMAINS.has(email.split('@')[1]?.toLowerCase() ?? '');

export const maskEmail = (email: string) => {
  const [l, d] = email.split('@');
  return !l || !d
    ? email
    : `${l[0] ?? ''}${'*'.repeat(Math.max(1, Math.min(l.length - 2, 6)))}${l[l.length - 1] ?? ''}@${d}`;
};

export const getFirebaseErrorCode = getErrorCode;

export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T, ms: number,
): T & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout>;
  const debounced = ((...args: Parameters<T>) => {
    clearTimeout(t); t = setTimeout(() => fn(...args), ms);
  }) as T & { cancel: () => void };
  debounced.cancel = () => clearTimeout(t);
  return debounced;
}

let injectedTheme: string | null = null;
export const injectWebStyles = (C: Tokens, theme: string) => {
  if (!IS_WEB || typeof document === 'undefined' || injectedTheme === theme) return;
  injectedTheme = theme;
  document.getElementById?.('signup-screen-styles')?.remove?.();
  const style = document.createElement?.('style');
  if (!style) return;
  style.id = 'signup-screen-styles';
  style.textContent = `
    input:focus,input:focus-visible{outline:none!important;box-shadow:none!important}
    input:-webkit-autofill{-webkit-background-clip:text!important;-webkit-text-fill-color:${C.autofillText}!important;transition:background-color 5000s ease-in-out 0s!important;box-shadow:inset 0 0 0 1000px ${C.autofillBg}!important;caret-color:${C.autofillCaret}!important}
    @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
    button:focus-visible{outline:2px solid ${C.accent}!important;outline-offset:2px!important}
    @media screen and (max-width:767px){input{font-size:16px!important}}
    [role="button"],[role="link"],[data-pressable]{cursor:pointer}
    [data-disabled="true"]{cursor:not-allowed!important;pointer-events:none}
    .modal-message{white-space:pre-wrap}
    *::-webkit-scrollbar{width:6px}*::-webkit-scrollbar-thumb{background:${C.inputBorder};border-radius:3px}
  `;
  document.head?.appendChild?.(style);
  if (!document.getElementById?.('signup-screen-meta')) {
    const m = document.createElement?.('meta');
    if (m) { m.id = 'signup-screen-meta'; document.head?.appendChild?.(m); }
    if (document.title !== undefined) document.title = 'Sign Up – MyArchetype';
    if (document.documentElement) {
      document.documentElement.lang = 'en';
      document.documentElement.dir  = 'ltr';
    }
    let vp = document.querySelector?.('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement?.('meta') ?? null;
      vp?.setAttribute?.('name', 'viewport');
      if (vp) document.head?.appendChild?.(vp);
    }
    vp?.setAttribute?.('content', 'width=device-width,initial-scale=1');
  }
};

export const triggerHaptic = async (type: 'success' | 'error' | 'light') => {
  if (IS_WEB) return;
  try {
    const H = await import('expo-haptics');
    if (type === 'success')    await H.notificationAsync(H.NotificationFeedbackType.Success);
    else if (type === 'error') await H.notificationAsync(H.NotificationFeedbackType.Error);
    else                       await H.impactAsync(H.ImpactFeedbackStyle.Light);
  } catch {}
};

export const validators = {
  email: (v: string) => {
    if (!v) return 'Email is required';
    if (v.length > MAX_EMAIL_LENGTH) return `Email must be under ${MAX_EMAIL_LENGTH} characters`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Invalid email format';
    if (isDisposableEmail(v)) return 'Disposable email addresses are not allowed.';
    return '';
  },
  password: (v: string) => {
    const checks = {
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
  strength: (v: string, C: Tokens) => {
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
    const pct = Math.min(s, 100);
    if (s < 40) return { level: 'Weak',   color: C.strengthWeak,   percent: pct };
    if (s < 60) return { level: 'Fair',   color: C.strengthFair,   percent: pct };
    if (s < 80) return { level: 'Good',   color: C.strengthGood,   percent: pct };
    return           { level: 'Strong', color: C.strengthStrong, percent: pct };
  },
};

export async function checkPasswordBreached(password: string): Promise<boolean> {
  try {
    const sha1   = QuickCrypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
    const res    = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return false;
    return (await res.text()).split('\n').some(line => line.trim().startsWith(suffix));
  } catch { return false; }
}

export const buildWebInputStyle = (C: Tokens): import('./types').WebStyleProps => ({
  outline:'none', outlineWidth:0, boxShadow:'none', border:'none',
  WebkitTextFillColor:C.textPrimary, caretColor:C.accent, backgroundColor:'transparent',
  paddingTop:18, paddingBottom:18, paddingLeft:4, flex:1, fontSize:16,
  letterSpacing:0.2, color:C.textPrimary,
});

export const showNativeAlert = (title: string, message: string, buttons?: import('./types').AlertBtn[]) =>
  Alert.alert(title, message, buttons ?? [{ text: 'OK' }]);