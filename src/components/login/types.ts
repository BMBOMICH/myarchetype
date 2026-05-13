import { TextInput } from 'react-native';
import { Tokens } from './constants';

export type WebMediaEvent = { matches: boolean };
export type WebMediaQuery = {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (e: WebMediaEvent) => void) => void;
  removeEventListener?: (type: 'change', listener: (e: WebMediaEvent) => void) => void;
};
export type WebKeyEvent = { key?: string };
export type WebCanvas = { getContext?: (kind: '2d') => { fillText: (text: string, x: number, y: number) => void } | null; toDataURL?: () => string };
export type WebNode = { remove?: () => void; id?: string; textContent?: string | null; setAttribute?: (name: string, value: string) => void };

declare global {
  interface Window {
    matchMedia?: (query: string) => WebMediaQuery;
    addEventListener?: (type: string, listener: (e: unknown) => void) => void;
    removeEventListener?: (type: string, listener: (e: unknown) => void) => void;
  }
  interface Document {
    getElementById?: (id: string) => WebNode | null;
    createElement?: (tag: string) => WebNode & WebCanvas;
    head?: { appendChild?: (node: unknown) => void };
    querySelector?: (selector: string) => WebNode | null;
    documentElement?: { lang: string; dir: string };
    title?: string;
  }
}

export type WebAriaProps = {
  'aria-live'?: 'assertive' | 'polite' | 'off'; 'aria-atomic'?: 'true' | 'false';
  id?: string; role?: string; 'aria-modal'?: 'true' | 'false'; 'aria-label'?: string;
  'aria-describedby'?: string; 'aria-invalid'?: 'true' | 'false'; 'aria-required'?: 'true' | 'false';
};
export type WebInputProps  = { name?: string };
export type WebStyleProps  = {
  outline?: string; outlineWidth?: number; boxShadow?: string; border?: string;
  WebkitTextFillColor?: string; caretColor?: string; backgroundColor?: string;
  paddingTop?: number; paddingBottom?: number; paddingLeft?: number;
  flex?: number; fontSize?: number; letterSpacing?: number; color?: string; direction?: 'ltr' | 'rtl';
};

export type AlertBtn = { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };

export type FormState = {
  email: string; password: string; emailError: string; passwordError: string;
  showPassword: boolean; emailFocused: boolean; passwordFocused: boolean;
  loading: boolean; lockoutSeconds: number; capsLockOn: boolean;
};

export type FormAction =
  | { type: 'SET_EMAIL'; payload: string } | { type: 'SET_PASSWORD'; payload: string }
  | { type: 'SET_EMAIL_ERROR'; payload: string } | { type: 'SET_PASSWORD_ERROR'; payload: string }
  | { type: 'TOGGLE_PASSWORD' } | { type: 'SET_EMAIL_FOCUSED'; payload: boolean }
  | { type: 'SET_PASSWORD_FOCUSED'; payload: boolean } | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LOCKOUT_SECONDS'; payload: number } | { type: 'SET_CAPS_LOCK'; payload: boolean }
  | { type: 'CLEAR_ERRORS' } | { type: 'CLEAR_PASSWORD' } | { type: 'HIDE_PASSWORD' }
  | { type: 'WIPE_SENSITIVE' } | { type: 'RESET' };

export type ModalButton = { label: string; onPress?: () => void | Promise<void>; primary?: boolean; danger?: boolean };
export type ModalConfig  = { title: string; message: string; buttons: ModalButton[] };

export type TextKeyPressLike = { nativeEvent?: { key?: string; getModifierState?: (key: string) => boolean } };

export type InnerContentProps = {
  C: Tokens; state: FormState; IS_SMALL: boolean;
  screenStyle: Record<string, unknown>;
  headerStyle: Record<string, unknown>;
  formStyle:   Record<string, unknown>;
  footerStyle: Record<string, unknown>;
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