import { AccessibilityInfo, Appearance, Dimensions } from 'react-native';
import { IS_WEB } from './constants';
import type { WebMediaEvent } from './types';

export const getErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as Record<string, unknown>).code ?? '')
    : undefined;

export async function getDeviceFingerprint(): Promise<string | null> {
  if (!IS_WEB || typeof document === 'undefined') return null;
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

export const getScreenData = () => {
  const { width, height } = Dimensions.get('window');
  return { width, height, isSmall: width < 375, isMedium: width >= 375 && width < 768, isLarge: width >= 768 };
};

const _getReducedMotion = () => {
  if (!IS_WEB || typeof window === 'undefined') return false;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
};
export let prefersReducedMotion = _getReducedMotion();
export const updatePrefersReducedMotion = (v: boolean) => { prefersReducedMotion = v; };
export const getAnimDuration = (ms: number) => (prefersReducedMotion ? 0 : ms);

export function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const debounced = ((...args: Parameters<T>) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }) as T & { cancel: () => void };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

let injectedTheme: 'dark' | 'light' | null = null;
export const injectWebStyles = (C: { autofillText: string; autofillBg: string; autofillCaret: string; accent: string; inputBorder: string; error: string }, theme: 'dark' | 'light') => {
  if (!IS_WEB || typeof document === 'undefined' || injectedTheme === theme) return;
  injectedTheme = theme;
  document.getElementById?.('login-screen-styles')?.remove?.();
  const style = document.createElement?.('style');
  if (!style) return;
  style.id = 'login-screen-styles';
  style.textContent = `
    input:focus,input:focus-visible{outline:none!important;box-shadow:none!important}
    input:-webkit-autofill{-webkit-background-clip:text!important;-webkit-text-fill-color:${C.autofillText}!important;transition:background-color 5000s ease-in-out 0s!important;box-shadow:inset 0 0 0 1000px ${C.autofillBg}!important;caret-color:${C.autofillCaret}!important}
    @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
    button:focus-visible{outline:2px solid ${C.accent}!important;outline-offset:2px!important}
    @media screen and (max-width:767px){input{font-size:16px!important}}
    [role="button"],[role="link"]{cursor:pointer}[data-disabled="true"]{cursor:not-allowed!important;pointer-events:none}
    .modal-message{white-space:pre-wrap}
    *::-webkit-scrollbar{width:6px}*::-webkit-scrollbar-thumb{background:${C.inputBorder};border-radius:3px}
  `;
  document.head?.appendChild?.(style);
  if (!document.getElementById?.('login-screen-meta')) {
    const m = document.createElement?.('meta');
    if (m) { m.id = 'login-screen-meta'; document.head?.appendChild?.(m); }
    document.title = 'Log In – MyArchetype';
    if (document.documentElement) { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; }
    let vp = document.querySelector?.('meta[name="viewport"]');
    if (!vp) { vp = document.createElement?.('meta') ?? null; vp?.setAttribute?.('name', 'viewport'); if (vp) document.head?.appendChild?.(vp); }
    vp?.setAttribute?.('content', 'width=device-width,initial-scale=1');
  }
};

export const getErrorMessage = (code?: string, map?: Record<string, string>) => (code && map?.[code]) ?? 'An unexpected error occurred.';

export const showNativeAlert = (title: string, message: string, buttons?: { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }[]) =>
  import('react-native').then(({ Alert }) => Alert.alert(title, message, buttons ?? [{ text: 'OK' }]));

export const triggerHaptic = async (type: 'success' | 'error' | 'light') => {
  if (IS_WEB) return;
  try {
    const H = await import('expo-haptics');
    if (type === 'success') await H.notificationAsync(H.NotificationFeedbackType.Success);
    else if (type === 'error') await H.notificationAsync(H.NotificationFeedbackType.Error);
    else await H.impactAsync(H.ImpactFeedbackStyle.Light);
  } catch {}
};

export const validators = {
  email:    (v: string) => !v ? 'Email is required' : v.length > 254 ? `Email must be under 254 chars` : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Invalid email format' : '',
  password: (v: string) => !v ? 'Password is required' : v.length > 128 ? 'Password too long' : v.length < 6 ? 'At least 6 characters' : '',
};

export const useShake = () => {
  const { useCallback } = require('react');
  const { useSharedValue, withSequence, withTiming } = require('react-native-reanimated');
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