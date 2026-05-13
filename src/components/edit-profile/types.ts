export type ProfileState = {
  displayName: string;      nameError: string;
  bio: string;              bioError: string;
  job: string;              school: string;
  age: number;              gender: string;
  photos: string[];         primaryPhotoIndex: number;
  showOnProfile: boolean;   showAge: boolean;   showDistance: boolean;
  saving: boolean;
  uploadingPhoto: boolean;  photoToUpload: string | null;
  showDeleteConfirm: boolean; deletingPhotoIndex: number;
  showGenderPicker: boolean;
};

export type ProfileAction =
  | { type: 'SET_NAME';            payload: string }
  | { type: 'SET_NAME_ERROR';      payload: string }
  | { type: 'SET_BIO';             payload: string }
  | { type: 'SET_BIO_ERROR';       payload: string }
  | { type: 'SET_JOB';             payload: string }
  | { type: 'SET_SCHOOL';          payload: string }
  | { type: 'SET_AGE';             payload: number }
  | { type: 'SET_GENDER';          payload: string }
  | { type: 'SET_PHOTOS';          payload: string[] }
  | { type: 'SET_PRIMARY';         payload: number }
  | { type: 'SET_SHOW_PROFILE';    payload: boolean }
  | { type: 'SET_SHOW_AGE';        payload: boolean }
  | { type: 'SET_SHOW_DISTANCE';   payload: boolean }
  | { type: 'SET_SAVING';          payload: boolean }
  | { type: 'SET_UPLOADING';       payload: boolean }
  | { type: 'SET_PHOTO_TO_UPLOAD'; payload: string | null }
  | { type: 'SET_DELETE_CONFIRM';  payload: boolean }
  | { type: 'SET_DELETING_INDEX';  payload: number }
  | { type: 'SET_GENDER_PICKER';   payload: boolean }
  | { type: 'HYDRATE';             payload: Partial<ProfileState> }
  | { type: 'RESET' };