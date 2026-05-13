import { FormAction, FormState } from './types';

export const initialFormState: FormState = {
  email:'', password:'', emailError:'', passwordError:'', showPassword:false,
  emailFocused:false, passwordFocused:false, loading:false, lockoutSeconds:0, capsLockOn:false,
};

export function formReducer(state: FormState, action: FormAction): FormState {
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