import { TextInput } from 'react-native';

export type WebMediaEvent  = { matches: boolean };
export type WebMediaQuery  = {
  matches: boolean;
  addEventListener?:    (type: 'change', listener: (e: WebMediaEvent) => void) => void;
  removeEventListener?: (type: 'change', listener: (e: WebMediaEvent) => void) => void;
};
export type WebCanvas = {
  getContext?: (kind: '2d') => { fillText: (text: string, x: number, y: number) => void } | null;
  toDataURL?: () => string;
};
export type WebNode = {
  remove?: () => void; id?: string; textContent?: string | null;
  setAttribute?: (name: string, value: string) => void;
};
export type WebKeyEvent = { key?: string };

declare global {
  interface Window {
    matchMedia?: (query: string) => WebMediaQuery;
    addEventListener?:    (type: string, listener: (e: unknown) => void) => void;
    removeEventListener?: (type: string, listener: (e: unknown) => void) => void;
  }
  interface Document {
    getElementById?:   (id: string) => WebNode | null;
    createElement?:    (tag: string) => WebNode & WebCanvas;
    head?:             { appendChild?: (node: unknown) => void };
    querySelector?:    (selector: string) => WebNode | null;
    documentElement?:  { lang: string; dir: string };
    title?:            string;
  }
}

export type WebAriaProps = {
  'aria-live'?: 'assertive' | 'polite' | 'off';
  'aria-atomic'?: 'true' | 'false';
  id?: string; role?: string; 'aria-modal'?: 'true' | 'false';
  'aria-describedby'?: string; 'aria-invalid'?: 'true' | 'false';
  'aria-required'?: 'true' | 'false';
};
export type WebInputProps      = { name?: string };
export type WebStyleProps      = {
  outline?: string; outlineWidth?: number; boxShadow?: string; border?: string;
  WebkitTextFillColor?: string; caretColor?: string; backgroundColor?: string;
  paddingTop?: number; paddingBottom?: number; paddingLeft?: number;
  flex?: number; fontSize?: number; letterSpacing?: number; color?: string;
  direction?: 'ltr' | 'rtl';
};
export type WebPressableStyle  = { cursor?: string };
export type KeyPressEvent      = {
  nativeEvent?: { key?: string; getModifierState?: (name: string) => boolean };
};

export type ModalConfig = {
  title: string; message: string;
  buttons: { label: string; onPress?: () => void | Promise<void>; primary?: boolean }[];
};

export type FormState = {
  name: string; nameError: string; dob: string; dobError: string;
  email: string; emailError: string; password: string; passwordError: string;
  confirmPassword: string; confirmPasswordError: string;
  showPassword: boolean; showConfirmPassword: boolean;
  nameFocused: boolean; dobFocused: boolean; emailFocused: boolean;
  passwordFocused: boolean; confirmFocused: boolean;
  showRequirements: boolean; loading: boolean; lockoutSeconds: number;
  capsLockOn: boolean; breachedWarning: boolean;
};

export type FormAction =
  | { type: 'SET_NAME'; payload: string }             | { type: 'SET_NAME_ERROR'; payload: string }
  | { type: 'SET_DOB'; payload: string }              | { type: 'SET_DOB_ERROR'; payload: string }
  | { type: 'SET_EMAIL'; payload: string }            | { type: 'SET_PASSWORD'; payload: string }
  | { type: 'SET_CONFIRM'; payload: string }          | { type: 'SET_EMAIL_ERROR'; payload: string }
  | { type: 'SET_PASSWORD_ERROR'; payload: string }   | { type: 'SET_CONFIRM_ERROR'; payload: string }
  | { type: 'TOGGLE_PASSWORD' }                       | { type: 'TOGGLE_CONFIRM_PASSWORD' }
  | { type: 'HIDE_PASSWORDS' }                        | { type: 'SET_NAME_FOCUSED'; payload: boolean }
  | { type: 'SET_DOB_FOCUSED'; payload: boolean }     | { type: 'SET_EMAIL_FOCUSED'; payload: boolean }
  | { type: 'SET_PASSWORD_FOCUSED'; payload: boolean }| { type: 'SET_CONFIRM_FOCUSED'; payload: boolean }
  | { type: 'SET_SHOW_REQUIREMENTS'; payload: boolean }| { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LOCKOUT'; payload: number }          | { type: 'SET_CAPS_LOCK'; payload: boolean }
  | { type: 'SET_BREACHED_WARNING'; payload: boolean }| { type: 'CLEAR_ERRORS' }
  | { type: 'WIPE_SENSITIVE' }                        | { type: 'RESET' };