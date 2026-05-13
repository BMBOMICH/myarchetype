import { Platform } from 'react-native';

export const IS_IOS = Platform.OS === 'ios';
export const IS_WEB = Platform.OS === 'web';
export const MAX_BIO_LENGTH = 300;
export const MAX_JOB_LENGTH = 60;
export const MAX_SCHOOL_LENGTH = 60;
export const MAX_NAME_LENGTH = 50;
export const GENDER_OPTIONS = ['Woman', 'Man', 'Non-binary', 'Prefer not to say'];