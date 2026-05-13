import { ProfileAction, ProfileState } from './types';

export const initialState: ProfileState = {
  displayName: '',  nameError: '',
  bio: '',          bioError: '',
  job: '',          school: '',
  age: 0,           gender: '',
  photos: [],       primaryPhotoIndex: 0,
  showOnProfile: true, showAge: true, showDistance: true,
  saving: false,
  uploadingPhoto: false, photoToUpload: null,
  showDeleteConfirm: false, deletingPhotoIndex: -1,
  showGenderPicker: false,
};

export function profileReducer(state: ProfileState, action: ProfileAction): ProfileState {
  switch (action.type) {
    case 'SET_NAME':            return { ...state, displayName:        action.payload };
    case 'SET_NAME_ERROR':      return { ...state, nameError:          action.payload };
    case 'SET_BIO':             return { ...state, bio:                action.payload };
    case 'SET_BIO_ERROR':       return { ...state, bioError:           action.payload };
    case 'SET_JOB':             return { ...state, job:                action.payload };
    case 'SET_SCHOOL':          return { ...state, school:             action.payload };
    case 'SET_AGE':             return { ...state, age:                action.payload };
    case 'SET_GENDER':          return { ...state, gender:             action.payload };
    case 'SET_PHOTOS':          return { ...state, photos:             action.payload };
    case 'SET_PRIMARY':         return { ...state, primaryPhotoIndex:  action.payload };
    case 'SET_SHOW_PROFILE':    return { ...state, showOnProfile:      action.payload };
    case 'SET_SHOW_AGE':        return { ...state, showAge:            action.payload };
    case 'SET_SHOW_DISTANCE':   return { ...state, showDistance:       action.payload };
    case 'SET_SAVING':          return { ...state, saving:             action.payload };
    case 'SET_UPLOADING':       return { ...state, uploadingPhoto:     action.payload };
    case 'SET_PHOTO_TO_UPLOAD': return { ...state, photoToUpload:      action.payload };
    case 'SET_DELETE_CONFIRM':  return { ...state, showDeleteConfirm:  action.payload };
    case 'SET_DELETING_INDEX':  return { ...state, deletingPhotoIndex: action.payload };
    case 'SET_GENDER_PICKER':   return { ...state, showGenderPicker:   action.payload };
    case 'HYDRATE':             return { ...state, ...action.payload };
    case 'RESET':               return { ...initialState };
    default:                    return state;
  }
}