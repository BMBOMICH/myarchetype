import { FormAction, FormState } from './types';

export const initialForm: FormState = {
  name:'', nameError:'', dob:'', dobError:'', email:'', emailError:'',
  password:'', passwordError:'', confirmPassword:'', confirmPasswordError:'',
  showPassword:false, showConfirmPassword:false, nameFocused:false, dobFocused:false,
  emailFocused:false, passwordFocused:false, confirmFocused:false, showRequirements:false,
  loading:false, lockoutSeconds:0, capsLockOn:false, breachedWarning:false,
};

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_NAME':               return { ...state, name:                 action.payload };
    case 'SET_NAME_ERROR':         return { ...state, nameError:            action.payload };
    case 'SET_DOB':                return { ...state, dob:                  action.payload };
    case 'SET_DOB_ERROR':          return { ...state, dobError:             action.payload };
    case 'SET_EMAIL':              return { ...state, email:                action.payload };
    case 'SET_PASSWORD':           return { ...state, password:             action.payload };
    case 'SET_CONFIRM':            return { ...state, confirmPassword:      action.payload };
    case 'SET_EMAIL_ERROR':        return { ...state, emailError:           action.payload };
    case 'SET_PASSWORD_ERROR':     return { ...state, passwordError:        action.payload };
    case 'SET_CONFIRM_ERROR':      return { ...state, confirmPasswordError: action.payload };
    case 'TOGGLE_PASSWORD':        return { ...state, showPassword:         !state.showPassword };
    case 'TOGGLE_CONFIRM_PASSWORD':return { ...state, showConfirmPassword:  !state.showConfirmPassword };
    case 'HIDE_PASSWORDS':         return { ...state, showPassword: false,  showConfirmPassword: false };
    case 'SET_NAME_FOCUSED':       return { ...state, nameFocused:          action.payload };
    case 'SET_DOB_FOCUSED':        return { ...state, dobFocused:           action.payload };
    case 'SET_EMAIL_FOCUSED':      return { ...state, emailFocused:         action.payload };
    case 'SET_PASSWORD_FOCUSED':   return { ...state, passwordFocused:      action.payload };
    case 'SET_CONFIRM_FOCUSED':    return { ...state, confirmFocused:       action.payload };
    case 'SET_SHOW_REQUIREMENTS':  return { ...state, showRequirements:     action.payload };
    case 'SET_LOADING':            return { ...state, loading:              action.payload };
    case 'SET_LOCKOUT':            return { ...state, lockoutSeconds:       action.payload };
    case 'SET_CAPS_LOCK':          return { ...state, capsLockOn:           action.payload };
    case 'SET_BREACHED_WARNING':   return { ...state, breachedWarning:      action.payload };
    case 'CLEAR_ERRORS':           return { ...state, nameError:'', dobError:'', emailError:'', passwordError:'', confirmPasswordError:'' };
    case 'WIPE_SENSITIVE':         return { ...state, password:'', confirmPassword:'' };
    case 'RESET':                  return { ...initialForm, email: state.email, name: state.name };
    default:                       return state;
  }
}