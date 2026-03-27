import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import BodyTypeSelector from '../components/BodyTypeSelector';
import { auth, db } from '../firebaseConfig';
import { estimateAgeFromPhoto } from '../utils/ageEstimation';
import { detectFullBodyPhoto } from '../utils/bodyTypeDetection';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import { ensureMyE2EEIdentity } from '../utils/e2ee';
import { requestLocationPermission, saveUserLocation } from '../utils/location';
import { logger } from '../utils/logger';
import { formatName, validateName } from '../utils/nameValidation';
import { profileStorage } from '../utils/storage';

const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';

const SPACING = {
  xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, xxxxl: 40,
} as const;

const FONT = {
  xs: 11, sm: 12, md: 13, base: 14, lg: 16, xl: 18, xxl: 20, xxxl: 24, display: 28,
} as const;

const RADIUS = {
  sm: 6, md: 10, lg: 14, xl: 20, xxl: 25, full: 50,
} as const;

const MAX_FONT_SCALE = 1.4;
const MAX_PHOTOS = 6;
const MAX_BIO = 300;
const MAX_PROMPT = 150;
const MAX_NAME = 20;
const AGE_TOL = 5;
const MIN_AGE = 18;
const MAX_AGE = 99;
const MIN_H = 100;
const MAX_H = 250;
const TOTAL_STEPS = 8;
const TIMER_SECONDS = 3;
const DRAFT_KEY_PREFIX = 'profile_setup_draft_';
const STEP_KEY_PREFIX = 'profile_setup_step_';

const STEP_NAMES = [
  'Photos', 'Basics', 'Body', 'Lifestyle', 'Interests', 'Preferences', 'About You', 'Preview',
] as const;

interface Theme {
  bg: string; bgGradientStart: string; bgGradientMid: string; bgGradientEnd: string;
  card: string; cardBorder: string; input: string; inputBorder: string;
  accent: string; accentSoft: string; accentGlow: string;
  error: string; errorGlow: string; warn: string;
  success: string; successGlow: string;
  text: string; sub: string; muted: string; dim: string;
  white: string; black: string; overlay: string; none: string;
  guideStroke: string; guideFill: string; skeleton: string;
  buttonGradStart: string; buttonGradEnd: string;
  disabledBg: string; disabledText: string;
  gold: string; purple: string; danger: string; warning: string;
}

const darkTokens: Theme = {
  bg: '#07070f', bgGradientStart: '#0a0a18', bgGradientMid: '#0e0e24', bgGradientEnd: '#07070f',
  card: '#111128', cardBorder: '#1e1e48', input: '#0d0d24', inputBorder: '#28285a',
  accent: '#6C63FF', accentSoft: '#8B83FF', accentGlow: 'rgba(108,99,255,0.10)',
  error: '#FF6B6B', errorGlow: 'rgba(255,107,107,0.07)', warn: '#FFB347',
  success: '#51CF66', successGlow: 'rgba(81,207,102,0.07)',
  text: '#EDEDFF', sub: '#9494B8', muted: '#64648a', dim: '#40406a',
  white: '#ffffff', black: '#000000', overlay: 'rgba(4,4,12,0.92)', none: 'transparent',
  guideStroke: 'rgba(108,99,255,0.7)', guideFill: 'rgba(108,99,255,0.08)', skeleton: '#1e1e48',
  buttonGradStart: '#7B73FF', buttonGradEnd: '#5A4FE6',
  disabledBg: '#181834', disabledText: '#40406a',
  gold: '#f1c40f', purple: '#9b59b6', danger: '#FF6B6B', warning: '#FFB347',
};

const lightTokens: Theme = {
  bg: '#F0F2F8', bgGradientStart: '#E8EAF4', bgGradientMid: '#E0E3F0', bgGradientEnd: '#F0F2F8',
  card: '#FFFFFF', cardBorder: '#D4D8E8', input: '#F4F5FC', inputBorder: '#C8CCE0',
  accent: '#5B52E0', accentSoft: '#7A72F0', accentGlow: 'rgba(91,82,224,0.08)',
  error: '#DC3545', errorGlow: 'rgba(220,53,69,0.05)', warn: '#D4880F',
  success: '#2F9E44', successGlow: 'rgba(47,158,68,0.05)',
  text: '#10102A', sub: '#4E4E6E', muted: '#8080A0', dim: '#C0C0D0',
  white: '#ffffff', black: '#000000', overlay: 'rgba(220,224,240,0.92)', none: 'transparent',
  guideStroke: 'rgba(91,82,224,0.7)', guideFill: 'rgba(91,82,224,0.08)', skeleton: '#D4D8E8',
  buttonGradStart: '#6C63FF', buttonGradEnd: '#4A42CC',
  disabledBg: '#D0D4E4', disabledText: '#9898B4',
  gold: '#c4940a', purple: '#7b3fa0', danger: '#DC3545', warning: '#D4880F',
};

type ZodiacSign =
  | 'Capricorn' | 'Aquarius' | 'Pisces' | 'Aries' | 'Taurus'
  | 'Gemini' | 'Cancer' | 'Leo' | 'Virgo' | 'Libra' | 'Scorpio' | 'Sagittarius';

type PhotoType = 'face' | 'upper_body' | 'full_body' | 'freestyle';
type BodyType = 'slim' | 'athletic' | 'average' | 'curvy' | 'heavyset' | '';
type HeightUnit = 'cm' | 'ft';

interface ProfilePhoto {
  uri: string; url: string; type: PhotoType; order: number; verified: boolean; uploadedAt: string;
}

interface PhotoSlotConfig {
  type: PhotoType; label: string; required: boolean; icon: string;
  instruction: string; cameraSide: 'front' | 'back'; timerAvailable: boolean;
}

interface OptionItem { value: string; label?: string; desc?: string; icon?: string; }
interface ZodiacResult { sign: ZodiacSign; emoji: string; }
interface UploadResult { success: boolean; url?: string; error?: string; moderationStatus?: 'approved' | 'rejected' | 'pending'; }
interface AgeEstimationResult { estimatedAge: number; confidence: number; }
interface LocationData { city: string; country: string; latitude: number; longitude: number; }

interface FormState {
  photos: ProfilePhoto[]; name: string; bdayMonth: string; bdayDay: string; bdayYear: string;
  gender: string; interestedIn: string; pronouns: string;
  heightCm: string; heightFt: string; heightIn: string; heightUnit: HeightUnit;
  bodyType: BodyType; lookingForBody: BodyType;
  religion: string; lifestyle: string; relationship: string; education: string; occupation: string;
  smoking: string; drinking: string; children: string; pets: string; diet: string; politics: string;
  interests: string[]; loveLang: string; commStyle: string; firstDate: string; vibes: string[];
  ageMin: string; ageMax: string; distKm: string;
  heightPrefMinCm: string; heightPrefMaxCm: string;
  dealbreakers: string[]; importantFields: string[];
  bio: string; prompts: { q: string; a: string }[];
  locCity: string; locData: LocationData | null; ageEstimate: number | null;
  blurUntilMatch: boolean; incognito: boolean; verifiedOnly: boolean; termsAccepted: boolean;
}

type Action =
  | { type: 'SET'; field: keyof FormState; value: any }
  | { type: 'ADD_PHOTO'; photo: ProfilePhoto }
  | { type: 'REMOVE_PHOTO'; index: number }
  | { type: 'MOVE_PHOTO'; from: number; to: number }
  | { type: 'TOGGLE_LIST'; field: 'interests' | 'dealbreakers' | 'vibes' | 'importantFields'; value: string; max?: number }
  | { type: 'SET_PROMPT'; index: number; q: string; a: string }
  | { type: 'ADD_PROMPT' }
  | { type: 'DEL_PROMPT'; index: number }
  | { type: 'LOAD'; state: Partial<FormState> }
  | { type: 'RESET' };

const PHOTO_SLOTS: PhotoSlotConfig[] = [
  { type: 'face', label: 'Face Selfie', required: true, icon: '🤳', instruction: 'Show your face clearly\nShoulders up, good lighting', cameraSide: 'front', timerAvailable: false },
  { type: 'upper_body', label: 'Upper Body', required: true, icon: '👤', instruction: 'Waist up, show your upper body\nKeep your face visible', cameraSide: 'front', timerAvailable: false },
  { type: 'full_body', label: 'Full Body', required: false, icon: '🧍', instruction: 'Head to toe, stand naturally\nProp your phone or use the timer', cameraSide: 'back', timerAvailable: true },
  { type: 'freestyle', label: 'Freestyle', required: false, icon: '📸', instruction: 'Show your personality!\nHobbies, style, pets, travel...', cameraSide: 'front', timerAvailable: false },
];

const GENDER_OPTIONS: OptionItem[] = [
  { value: 'Male', icon: '👨' }, { value: 'Female', icon: '👩' },
  { value: 'Non-binary', icon: '🧑' }, { value: 'Other', icon: '✨' },
  { value: 'Prefer not to say', icon: '🤫' },
];

const INTERESTED_IN_OPTIONS: OptionItem[] = [
  { value: 'Men', icon: '👨' }, { value: 'Women', icon: '👩' },
  { value: 'Everyone', icon: '💫' }, { value: 'Non-binary people', icon: '🧑' },
];

const PRONOUN_OPTIONS: OptionItem[] = [
  { value: 'He/Him' }, { value: 'She/Her' }, { value: 'They/Them' }, { value: 'Other' },
];

const RELIGIOUS_OPTIONS: OptionItem[] = [
  { value: 'Traditional', desc: 'Follow religious practices regularly' },
  { value: 'Modern', desc: 'Believe but flexible interpretation' },
  { value: 'Spiritual', desc: 'Spiritual but not organized religion' },
  { value: 'None', desc: 'Not religious or spiritual' },
  { value: 'Prefer not to say', desc: '' },
];

const LIFESTYLE_OPTIONS: OptionItem[] = [
  { value: 'Natural', desc: 'Simple, outdoors, minimal', icon: '🌿' },
  { value: 'Fitness', desc: 'Active, gym, health-focused', icon: '💪' },
  { value: 'Social', desc: 'Outgoing, parties, events', icon: '🎉' },
  { value: 'Homebody', desc: 'Cozy nights in, relaxing', icon: '🏠' },
  { value: 'Adventurous', desc: 'Travel, explore, try new things', icon: '🌍' },
  { value: 'Creative', desc: 'Art, music, self-expression', icon: '🎨' },
];

const RELATIONSHIP_OPTIONS: OptionItem[] = [
  { value: 'Marriage', desc: 'Looking for life partner', icon: '💍' },
  { value: 'Long-term', desc: 'Serious but not rushing', icon: '❤️' },
  { value: 'Exploring', desc: 'Open to see where it goes', icon: '🌊' },
];

const EDUCATION_OPTIONS: OptionItem[] = [
  { value: 'High School', icon: '🏫' }, { value: 'Trade School', icon: '🔧' },
  { value: "Bachelor's", icon: '🎓' }, { value: "Master's", icon: '📚' },
  { value: 'PhD', icon: '🧪' }, { value: 'Prefer not to say', icon: '🤫' },
];

const SMOKING_OPTIONS: OptionItem[] = [
  { value: 'Never', icon: '🚭' }, { value: 'Socially', icon: '💨' }, { value: 'Regularly', icon: '🚬' },
];

const DRINKING_OPTIONS: OptionItem[] = [
  { value: 'Never', icon: '🚫' }, { value: 'Socially', icon: '🍷' }, { value: 'Regularly', icon: '🍺' },
];

const CHILDREN_OPTIONS: OptionItem[] = [
  { value: "Don't have, don't want", icon: '🙅' }, { value: "Don't have, want someday", icon: '🤱' },
  { value: 'Have, want more', icon: '👨‍👧‍👦' }, { value: "Have, don't want more", icon: '👨‍👧' },
  { value: 'Prefer not to say', icon: '🤫' },
];

const PET_OPTIONS: OptionItem[] = [
  { value: 'Dog lover', icon: '🐕' }, { value: 'Cat lover', icon: '🐈' },
  { value: 'Both', icon: '🐾' }, { value: 'No pets', icon: '🏠' }, { value: 'Allergic', icon: '🤧' },
];

const DIET_OPTIONS: OptionItem[] = [
  { value: 'No preference', icon: '🍽️' }, { value: 'Vegetarian', icon: '🥬' },
  { value: 'Vegan', icon: '🌱' }, { value: 'Halal', icon: '☪️' },
  { value: 'Kosher', icon: '✡️' }, { value: 'Pescatarian', icon: '🐟' }, { value: 'Keto', icon: '🥑' },
];

const LOVE_LANGUAGE_OPTIONS: OptionItem[] = [
  { value: 'Words of Affirmation', desc: 'Verbal compliments, encouragement', icon: '💬' },
  { value: 'Quality Time', desc: 'Undivided attention together', icon: '⏰' },
  { value: 'Gifts', desc: 'Thoughtful presents & surprises', icon: '🎁' },
  { value: 'Acts of Service', desc: 'Helping out, doing things', icon: '🤝' },
  { value: 'Physical Touch', desc: 'Hugs, holding hands', icon: '🤗' },
];

const COMMUNICATION_OPTIONS: OptionItem[] = [
  { value: 'Texter', icon: '💬' }, { value: 'Caller', icon: '📞' },
  { value: 'In-person', icon: '🤝' }, { value: 'Mix of all', icon: '🔄' },
];

const FIRST_DATE_OPTIONS: OptionItem[] = [
  { value: 'Coffee', icon: '☕' }, { value: 'Dinner', icon: '🍽️' },
  { value: 'Drinks', icon: '🍹' }, { value: 'Adventure', icon: '🧗' },
  { value: 'Walk / Park', icon: '🌳' }, { value: 'Museum / Gallery', icon: '🎨' },
];

const POLITICAL_OPTIONS: OptionItem[] = [
  { value: 'Liberal', icon: '🕊️' }, { value: 'Moderate', icon: '⚖️' },
  { value: 'Conservative', icon: '🏛️' }, { value: 'Not political', icon: '🤷' },
  { value: 'Prefer not to say', icon: '🤫' },
];

const INTEREST_TAGS: string[] = [
  '🏋️ Fitness', '🧘 Yoga', '🏃 Running', '🚴 Cycling', '🏊 Swimming', '⚽ Football',
  '🏀 Basketball', '🎾 Tennis', '⛷️ Skiing', '🏄 Surfing', '📚 Reading', '✍️ Writing',
  '🎵 Music', '🎸 Guitar', '🎹 Piano', '🎨 Art', '📷 Photography', '🎬 Movies',
  '📺 TV Shows', '🎮 Gaming', '🍳 Cooking', '🍰 Baking', '☕ Coffee', '🍷 Wine',
  '🍣 Foodie', '✈️ Travel', '🏕️ Camping', '🥾 Hiking', '🌊 Beach', '🏔️ Mountains',
  '🐕 Dogs', '🐈 Cats', '🌱 Plants', '🧠 Psychology', '💻 Tech', '📈 Finance',
  '🎤 Karaoke', '💃 Dancing', '🧩 Puzzles', '♟️ Chess', '🎲 Board Games', '🚗 Cars',
  '✨ Fashion', '💄 Makeup', '🧘‍♂️ Meditation', '📖 Spirituality', '🎭 Theater',
  '🎪 Comedy', '🌍 Volunteering',
];

const DEALBREAKER_TAGS: string[] = [
  '🚬 Smoking', '🍺 Heavy drinking', '📱 Social media obsession', '🏠 Long distance',
  '👶 Wants kids', '🚫 No kids ever', '🐾 No pets allowed', '🗣️ Poor communication',
  '🎮 Excessive gaming', '📵 No calls or video', '🤥 Dishonesty', '😤 Hot temper',
  '💸 Financial issues', '🙅 Lack of ambition', '⛪ Religious differences',
];

const PROMPT_QUESTIONS: string[] = [
  'A life goal of mine is...', 'I geek out on...', 'My simple pleasures are...',
  'The way to win me over is...', 'My most controversial opinion is...',
  "I'm looking for someone who...", "On a typical Sunday you'll find me...",
  'Two truths and a lie...', 'My greatest strength is...',
  "I'll know it's love when...", 'The key to my heart is...',
  'My favorite travel story is...',
];

const VIBE_EMOJIS: string[] = [
  '😎', '🥰', '🤓', '🏋️', '🎨', '🌍', '🎵', '📚', '🍳', '🧘',
  '🎮', '💃', '🌿', '🏖️', '⚡', '🌙', '☀️', '🦋', '🔥', '💎',
  '🎯', '🧩', '🌈', '🍕', '🎪', '🚀', '🎸', '🐾', '🌸', '✨',
];

const IMPORTANT_FIELD_OPTIONS: string[] = [
  'Religion', 'Lifestyle', 'Education', 'Height', 'Body Type',
  'Children', 'Smoking', 'Drinking', 'Pets', 'Politics',
];

const ZODIAC_DATA: { sign: ZodiacSign; emoji: string; s: [number, number]; e: [number, number] }[] = [
  { sign: 'Capricorn', emoji: '♑', s: [1, 1], e: [1, 19] },
  { sign: 'Aquarius', emoji: '♒', s: [1, 20], e: [2, 18] },
  { sign: 'Pisces', emoji: '♓', s: [2, 19], e: [3, 20] },
  { sign: 'Aries', emoji: '♈', s: [3, 21], e: [4, 19] },
  { sign: 'Taurus', emoji: '♉', s: [4, 20], e: [5, 20] },
  { sign: 'Gemini', emoji: '♊', s: [5, 21], e: [6, 20] },
  { sign: 'Cancer', emoji: '♋', s: [6, 21], e: [7, 22] },
  { sign: 'Leo', emoji: '♌', s: [7, 23], e: [8, 22] },
  { sign: 'Virgo', emoji: '♍', s: [8, 23], e: [9, 22] },
  { sign: 'Libra', emoji: '♎', s: [9, 23], e: [10, 22] },
  { sign: 'Scorpio', emoji: '♏', s: [10, 23], e: [11, 21] },
  { sign: 'Sagittarius', emoji: '♐', s: [11, 22], e: [12, 21] },
  { sign: 'Capricorn', emoji: '♑', s: [12, 22], e: [12, 31] },
];

function getZodiac(m: number, d: number): ZodiacResult {
  for (const z of ZODIAC_DATA) {
    if ((m === z.s[0] && d >= z.s[1]) || (m === z.e[0] && d <= z.e[1])) {
      return { sign: z.sign, emoji: z.emoji };
    }
  }
  return { sign: 'Capricorn', emoji: '♑' };
}

function calcAge(bday: Date): number {
  const today = new Date();
  let age = today.getFullYear() - bday.getFullYear();
  const monthDiff = today.getMonth() - bday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < bday.getDate())) age--;
  return age;
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (y < 1920 || y > new Date().getFullYear()) return false;
  const daysInMonth = new Date(y, m, 0).getDate();
  return d >= 1 && d <= daysInMonth;
}

function cmToFt(cm: number): string {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

function ftToCm(ft: number, inc: number): number {
  return Math.round((ft * 12 + inc) * 2.54);
}

function convertHeightForUnitSwitch(
  currentUnit: HeightUnit, heightCm: string, heightFt: string, heightIn: string
): { newFt: string; newIn: string; newCm: string } {
  if (currentUnit === 'cm') {
    const cm = parseInt(heightCm) || 0;
    if (cm >= MIN_H) {
      const totalInches = cm / 2.54;
      return { newFt: String(Math.floor(totalInches / 12)), newIn: String(Math.round(totalInches % 12)), newCm: heightCm };
    }
  } else {
    const cm = ftToCm(parseInt(heightFt) || 0, parseInt(heightIn) || 0);
    if (cm >= MIN_H) return { newFt: heightFt, newIn: heightIn, newCm: String(cm) };
  }
  return { newFt: heightFt, newIn: heightIn, newCm: heightCm };
}

function getPhotoLabel(type: PhotoType): string {
  return PHOTO_SLOTS.find((s) => s.type === type)?.label ?? 'Photo';
}

function getNextPhotoSlot(photos: ProfilePhoto[]): PhotoSlotConfig | null {
  for (const slot of PHOTO_SLOTS) {
    if (slot.required && !photos.some((p) => p.type === slot.type)) return slot;
  }
  if (!photos.some((p) => p.type === 'full_body')) return PHOTO_SLOTS.find((s) => s.type === 'full_body')!;
  if (photos.length < MAX_PHOTOS) return PHOTO_SLOTS.find((s) => s.type === 'freestyle')!;
  return null;
}

const BLOCKED_RE: RegExp[] = [
  /\b(fuck|shit|ass|bitch|dick|cunt|f+u+c+k+|sh[i1]t)\b/i,
  /@[\w.]+/, /\b\d{7,}\b/, /[\w.]+@[\w.]+\.\w+/,
  /\b(snap(chat)?|insta(gram)?|ig|whatsapp|telegram|signal|kik|tiktok|onlyfans)\b/i,
];

function checkBlocked(text: string): string | null {
  for (const r of BLOCKED_RE) {
    if (r.test(text)) {
      if (r.source.includes('@') || r.source.includes('\\d')) return 'Contact information is not allowed.';
      if (r.source.includes('snap')) return 'Social media handles are not allowed.';
      return 'This contains inappropriate language.';
    }
  }
  return null;
}

function getMissingFieldsMessage(
  step: number, form: FormState, hasFace: boolean, hasUpperBody: boolean, age: number | null, hCm: number
): string {
  switch (step) {
    case 1: {
      const missing: string[] = [];
      if (!hasFace) missing.push('face selfie');
      if (!hasUpperBody) missing.push('upper body photo');
      return missing.length > 0 ? `Still needed: ${missing.join(', ')}` : 'Complete required fields';
    }
    case 2: {
      if (!validateName(form.name).valid) return validateName(form.name).reason ?? 'Enter a valid name';
      if (age === null) return 'Enter your date of birth';
      if (age < MIN_AGE) return `Must be ${MIN_AGE}+`;
      if (age > MAX_AGE) return 'Invalid age';
      if (!form.gender) return 'Select your gender';
      if (!form.interestedIn) return 'Select who you are interested in';
      if (hCm < MIN_H || hCm > MAX_H) return 'Enter a valid height';
      return 'Complete required fields';
    }
    case 3: return 'Select your body type and preference';
    case 4: return 'Select religion, lifestyle and relationship goal';
    case 5: return 'Pick at least 3 interests';
    case 8: return 'Accept the Terms of Service to continue';
    default: return 'Complete required fields';
  }
}

const INIT: FormState = {
  photos: [], name: '', bdayMonth: '', bdayDay: '', bdayYear: '',
  gender: '', interestedIn: '', pronouns: '',
  heightCm: '', heightFt: '', heightIn: '', heightUnit: 'cm',
  bodyType: '', lookingForBody: '',
  religion: '', lifestyle: '', relationship: '', education: '', occupation: '',
  smoking: '', drinking: '', children: '', pets: '', diet: '', politics: '',
  interests: [], loveLang: '', commStyle: '', firstDate: '', vibes: [],
  ageMin: '18', ageMax: '50', distKm: '50',
  heightPrefMinCm: '', heightPrefMaxCm: '',
  dealbreakers: [], importantFields: [],
  bio: '', prompts: [],
  locCity: '', locData: null, ageEstimate: null,
  blurUntilMatch: false, incognito: false, verifiedOnly: false, termsAccepted: false,
};

function reducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case 'SET': return { ...state, [action.field]: action.value };
    case 'ADD_PHOTO': return { ...state, photos: [...state.photos, action.photo] };
    case 'REMOVE_PHOTO': return { ...state, photos: state.photos.filter((_p, i) => i !== action.index).map((p, i) => ({ ...p, order: i })) };
    case 'MOVE_PHOTO': {
      const arr = [...state.photos];
      const [moved] = arr.splice(action.from, 1);
      arr.splice(action.to, 0, moved);
      return { ...state, photos: arr.map((p, i) => ({ ...p, order: i })) };
    }
    case 'TOGGLE_LIST': {
      const list = [...(state[action.field] as string[])];
      const idx = list.indexOf(action.value);
      if (idx >= 0) list.splice(idx, 1);
      else { if (list.length >= (action.max ?? 999)) return state; list.push(action.value); }
      return { ...state, [action.field]: list };
    }
    case 'SET_PROMPT': { const prompts = [...state.prompts]; prompts[action.index] = { q: action.q, a: action.a }; return { ...state, prompts }; }
    case 'ADD_PROMPT': if (state.prompts.length >= 3) return state; return { ...state, prompts: [...state.prompts, { q: '', a: '' }] };
    case 'DEL_PROMPT': return { ...state, prompts: state.prompts.filter((_p, i) => i !== action.index) };
    case 'LOAD': return { ...state, ...action.state };
    case 'RESET': return INIT;
    default: return state;
  }
}

const CameraGuide = React.memo(function CameraGuide({ type, C }: { type: PhotoType; C: Theme }) {
  const guideS = useMemo(() => makeGuideStyles(C), [C]);
  switch (type) {
    case 'face':
      return (<View style={guideS.container} pointerEvents="none"><View style={guideS.faceOval} /><View style={guideS.shoulderLine} /><Text style={guideS.guideText}>Position your face{'\n'}inside the oval</Text></View>);
    case 'upper_body':
      return (<View style={guideS.container} pointerEvents="none"><View style={guideS.ubHead} /><View style={guideS.ubNeck} /><View style={guideS.ubShoulders} /><View style={guideS.ubTorso} /><Text style={guideS.guideTextBottom}>Show from{'\n'}waist up</Text></View>);
    case 'full_body':
      return (<View style={guideS.container} pointerEvents="none"><View style={guideS.fbHead} /><View style={guideS.fbNeck} /><View style={guideS.fbTorso} /><View style={guideS.fbHips} /><View style={guideS.fbLegs}><View style={guideS.fbLeg} /><View style={guideS.fbLeg} /></View><Text style={guideS.guideTextBottom}>Stand naturally{'\n'}head to toe</Text></View>);
    default:
      return (<View style={guideS.container} pointerEvents="none"><Text style={guideS.freestyleText}>📸{'\n'}Show your{'\n'}personality!</Text></View>);
  }
});

function makeGuideStyles(C: Theme) {
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none' } as any,
    faceOval: { width: 160, height: 200, borderRadius: 100, borderWidth: 2, borderColor: C.guideStroke, borderStyle: 'dashed', backgroundColor: C.guideFill, marginTop: -60 },
    shoulderLine: { width: 220, height: 40, borderTopLeftRadius: 60, borderTopRightRadius: 60, borderWidth: 2, borderBottomWidth: 0, borderColor: C.guideStroke, borderStyle: 'dashed', marginTop: -8 },
    guideText: { color: C.guideStroke, fontSize: FONT.base, textAlign: 'center', marginTop: SPACING.xl, fontWeight: '600', lineHeight: 20 },
    ubHead: { width: 60, height: 70, borderRadius: 30, borderWidth: 2, borderColor: C.guideStroke, borderStyle: 'dashed', backgroundColor: C.guideFill, marginTop: -80 },
    ubNeck: { width: 20, height: 12, borderWidth: 2, borderTopWidth: 0, borderColor: C.guideStroke, borderStyle: 'dashed', marginTop: -2 },
    ubShoulders: { width: 220, height: 30, borderTopLeftRadius: 50, borderTopRightRadius: 50, borderWidth: 2, borderBottomWidth: 0, borderColor: C.guideStroke, borderStyle: 'dashed', marginTop: -2 },
    ubTorso: { width: 140, height: 120, borderWidth: 2, borderTopWidth: 0, borderColor: C.guideStroke, borderStyle: 'dashed', backgroundColor: C.guideFill, borderBottomLeftRadius: RADIUS.sm, borderBottomRightRadius: RADIUS.sm },
    guideTextBottom: { color: C.guideStroke, fontSize: FONT.base, textAlign: 'center', marginTop: SPACING.lg, fontWeight: '600', lineHeight: 20 },
    fbHead: { width: 36, height: 42, borderRadius: 18, borderWidth: 2, borderColor: C.guideStroke, borderStyle: 'dashed', backgroundColor: C.guideFill, marginTop: -40 },
    fbNeck: { width: 12, height: 8, borderWidth: 2, borderTopWidth: 0, borderColor: C.guideStroke, borderStyle: 'dashed', marginTop: -2 },
    fbTorso: { width: 90, height: 80, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 2, borderColor: C.guideStroke, borderStyle: 'dashed', backgroundColor: C.guideFill, marginTop: -2 },
    fbHips: { width: 100, height: 20, borderBottomLeftRadius: RADIUS.sm, borderBottomRightRadius: RADIUS.sm, borderWidth: 2, borderTopWidth: 0, borderColor: C.guideStroke, borderStyle: 'dashed', marginTop: -2 },
    fbLegs: { flexDirection: 'row', gap: 12, marginTop: -2 },
    fbLeg: { width: 28, height: 100, borderWidth: 2, borderTopWidth: 0, borderColor: C.guideStroke, borderStyle: 'dashed', borderBottomLeftRadius: RADIUS.sm, borderBottomRightRadius: RADIUS.sm },
    freestyleText: { color: C.guideStroke, fontSize: FONT.xxl, textAlign: 'center', fontWeight: '600', lineHeight: 32 },
  });
}

const WebVideoPreview = React.memo(function WebVideoPreview({
  facing, onReady,
}: { streamReady?: boolean; facing: 'front' | 'back'; onReady: (el: any) => void }) {
  if (!IS_WEB) return null;
  return (
    <View style={{ flex: 1 }} pointerEvents="none">
      {/* @ts-ignore web only */}
      <video
        ref={(node: any) => { if (node) onReady(node); }}
        autoPlay playsInline muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover' as any,
          display: 'block',
          transform: facing === 'front' ? 'scaleX(-1)' : 'none',
          pointerEvents: 'none',
          touchAction: 'none',
        } as any}
      />
    </View>
  );
});

export default function ProfileSetupScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const colorScheme = useColorScheme();
  const isDark = colorScheme !== 'light';
  const C: Theme = isDark ? darkTokens : lightTokens;

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) { setUserId(u.uid); setUserEmail(u.email); }
      else { router.replace('/login' as any); }
    });
    return unsub;
  }, [router]);

  const [form, dispatch] = useReducer(reducer, INIT);
  const set = useCallback((f: keyof FormState, v: any) => dispatch({ type: 'SET', field: f, value: v }), []);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [gettingLoc, setGettingLoc] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [camSlot, setCamSlot] = useState<PhotoSlotConfig | null>(null);
  const [camFacing, setCamFacing] = useState<'front' | 'back'>('front');
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [promptPicker, setPromptPicker] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const isMountedRef = useRef(true);
  const scrollRef = useRef<ScrollView>(null);
  const cameraRef = useRef<CameraView>(null);
  const streamRef = useRef<any>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDirtyRef = useRef(false);
  const webVideoElRef = useRef<any>(null);
  const capturingRef = useRef(false);
  const readyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) { streamRef.current.getTracks().forEach((t: any) => t.stop()); streamRef.current = null; }
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      if (readyPollRef.current) { clearInterval(readyPollRef.current); readyPollRef.current = null; }
    };
  }, []);

  const draftKey = useMemo(() => (userId ? `${DRAFT_KEY_PREFIX}${userId}` : null), [userId]);
  const stepKey = useMemo(() => (userId ? `${STEP_KEY_PREFIX}${userId}` : null), [userId]);

  useEffect(() => {
    if (!draftKey || !stepKey) return;
    (async () => {
      try {
        const rawDraft = profileStorage.getString(draftKey) ?? null;
        if (rawDraft) { const parsed = JSON.parse(rawDraft) as Partial<FormState>; delete parsed.photos; if (isMountedRef.current) dispatch({ type: 'LOAD', state: parsed }); }
        if (isMountedRef.current) setStep(1);
      } catch { }
    })();
  }, [draftKey, stepKey]);

  const prevFormRef = useRef(form);
  useEffect(() => { if (prevFormRef.current !== form) { isDirtyRef.current = true; prevFormRef.current = form; } }, [form]);

  useEffect(() => {
    if (!draftKey || !stepKey) return;
    const t = setTimeout(() => {
      if (!isDirtyRef.current) return;
      isDirtyRef.current = false;
      const { photos: _photos, ...rest } = form;
      try { profileStorage.set(draftKey, JSON.stringify(rest)); } catch { }
      try { profileStorage.set(stepKey, String(step)); } catch { }
    }, 2000);
    return () => clearTimeout(t);
  }, [form, step, draftKey, stepKey]);

  useEffect(() => { Animated.timing(progAnim, { toValue: step / TOTAL_STEPS, duration: 300, useNativeDriver: false }).start(); }, [step, progAnim]);
  useEffect(() => { if (promptPicker !== null && promptPicker >= form.prompts.length) setPromptPicker(null); }, [form.prompts.length, promptPicker]);

  useEffect(() => {
    if (!IS_WEB && !permission?.granted && permission?.canAskAgain !== false) {
      Alert.alert('Camera Required', 'This app uses your camera to take profile photos.',
        [{ text: 'Not Now', style: 'cancel' }, { text: 'Grant Access', onPress: () => requestPermission() }]);
    }
  }, [permission?.granted, permission?.canAskAgain, requestPermission]);

  useEffect(() => { AccessibilityInfo.announceForAccessibility(`Step ${step} of ${TOTAL_STEPS}: ${STEP_NAMES[step - 1]}`); }, [step]);

  const birthday = useMemo<Date | null>(() => {
    const m = parseInt(form.bdayMonth); const d = parseInt(form.bdayDay); const y = parseInt(form.bdayYear);
    if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
    if (!isValidDate(y, m, d)) return null;
    return new Date(y, m - 1, d);
  }, [form.bdayMonth, form.bdayDay, form.bdayYear]);

  const age = useMemo<number | null>(() => (birthday ? calcAge(birthday) : null), [birthday]);
  const zodiac = useMemo<ZodiacResult | null>(() => birthday ? getZodiac(birthday.getMonth() + 1, birthday.getDate()) : null, [birthday]);

  const hCm = useMemo<number>(() => {
    if (form.heightUnit === 'cm') return parseInt(form.heightCm) || 0;
    return ftToCm(parseInt(form.heightFt) || 0, parseInt(form.heightIn) || 0);
  }, [form.heightUnit, form.heightCm, form.heightFt, form.heightIn]);

  const hDisplay = useMemo<string>(() => {
    if (!hCm || hCm < MIN_H) return '';
    return form.heightUnit === 'cm' ? `${hCm} cm (${cmToFt(hCm)})` : `${form.heightFt}'${form.heightIn || 0}" (${hCm} cm)`;
  }, [hCm, form.heightUnit, form.heightFt, form.heightIn]);

  const hasFace = useMemo(() => form.photos.some((p) => p.type === 'face'), [form.photos]);
  const hasUpperBody = useMemo(() => form.photos.some((p) => p.type === 'upper_body'), [form.photos]);
  const hasFullBody = useMemo(() => form.photos.some((p) => p.type === 'full_body'), [form.photos]);
  const nextSlot = useMemo(() => getNextPhotoSlot(form.photos), [form.photos]);

  const stepOk = useMemo<boolean>(() => {
    switch (step) {
      case 1: return hasFace && hasUpperBody;
      case 2: return validateName(form.name).valid && age !== null && age >= MIN_AGE && age <= MAX_AGE && form.gender !== '' && form.interestedIn !== '' && hCm >= MIN_H && hCm <= MAX_H;
      case 3: return form.bodyType !== '' && form.lookingForBody !== '';
      case 4: return form.religion !== '' && form.lifestyle !== '' && form.relationship !== '';
      case 5: return form.interests.length >= 3;
      case 6: return true;
      case 7: return true;
      case 8: return form.termsAccepted;
      default: return false;
    }
  }, [step, form, hasFace, hasUpperBody, age, hCm]);

  const pct = useMemo<number>(() => {
    const checks = [
      hasFace, hasUpperBody, hasFullBody, form.photos.length >= 3,
      validateName(form.name).valid, age !== null && age >= MIN_AGE,
      form.gender !== '', form.interestedIn !== '', hCm >= MIN_H,
      form.bodyType !== '', form.lookingForBody !== '',
      form.religion !== '', form.lifestyle !== '', form.relationship !== '',
      form.interests.length >= 3, form.bio.trim().length > 0,
      form.locCity !== '', form.education !== '',
      form.smoking !== '', form.drinking !== '', form.children !== '',
      form.prompts.length >= 1, form.vibes.length >= 1, form.loveLang !== '',
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form, hasFace, hasUpperBody, hasFullBody, age, hCm]);

  const haptic = useCallback((style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => { if (!IS_WEB) Haptics.impactAsync(style).catch(() => { }); }, []);
  const successHaptic = useCallback(() => { if (!IS_WEB) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { }); }, []);

  const animate = useCallback((dir: 'fwd' | 'back') => {
    const toVal = dir === 'fwd' ? -screenWidth : screenWidth;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: toVal, duration: 140, useNativeDriver: true }),
    ]).start(() => {
      slideAnim.setValue(dir === 'fwd' ? screenWidth : -screenWidth);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    });
  }, [fadeAnim, slideAnim, screenWidth]);

  const goNext = useCallback(() => {
    if (!stepOk) { Alert.alert('Incomplete', getMissingFieldsMessage(step, form, hasFace, hasUpperBody, age, hCm)); return; }
    if (step >= TOTAL_STEPS) return;
    if (step === 7) {
      if (form.bio.trim()) { const b = checkBlocked(form.bio); if (b) { Alert.alert('Bio Issue', b); return; } }
      for (const p of form.prompts) { if (p.a.trim()) { const b = checkBlocked(p.a); if (b) { Alert.alert('Prompt Issue', b); return; } } }
    }
    if (step === 6) {
      const minA = parseInt(form.ageMin) || MIN_AGE; const maxA = parseInt(form.ageMax) || 50;
      if (minA >= maxA) { Alert.alert('Invalid Age Range', 'Minimum age must be less than maximum age.'); return; }
      const minH = parseInt(form.heightPrefMinCm) || 0; const maxH = parseInt(form.heightPrefMaxCm) || 0;
      if (minH > 0 && maxH > 0 && minH >= maxH) { Alert.alert('Invalid Height Range', 'Minimum height must be less than maximum height.'); return; }
    }
    haptic(); successHaptic(); animate('fwd');
    setStep((s) => s + 1);
    requestAnimationFrame(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); });
  }, [step, stepOk, form, hasFace, hasUpperBody, age, hCm, haptic, successHaptic, animate]);

  const goBack = useCallback(() => {
    if (step <= 1) { Alert.alert('Leave Setup?', 'Your progress is auto-saved as a draft.', [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', onPress: () => router.back() }]); return; }
    haptic(); animate('back'); setStep((s) => s - 1);
    requestAnimationFrame(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); });
  }, [step, haptic, animate, router]);

  const stopWebStream = useCallback(() => {
    if (readyPollRef.current) { clearInterval(readyPollRef.current); readyPollRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t: any) => t.stop()); streamRef.current = null; }
    if (isMountedRef.current) setCamReady(false);
  }, []);

  const attachStreamToVideo = useCallback(() => {
    const video = webVideoElRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    if (video.srcObject === stream) {
      if (video.readyState >= 2 && isMountedRef.current) setCamReady(true);
      return;
    }

    video.srcObject = stream;

    if (video.readyState >= 2) {
      video.play().catch(() => { });
      if (isMountedRef.current) setCamReady(true);
      return;
    }

    video.onloadedmetadata = () => { video.play().catch(() => { }); if (isMountedRef.current) setCamReady(true); };
    video.oncanplay = () => { if (isMountedRef.current) setCamReady(true); if (video.paused) video.play().catch(() => { }); };
    video.onerror = () => { if (isMountedRef.current) { setCamReady(false); setCamErr('Camera stream error. Please try again.'); } };

    stream.getTracks().forEach((track: any) => {
      track.onended = () => { if (isMountedRef.current) { setCamReady(false); setCamErr('Camera disconnected. Please try again.'); } };
    });

    if (readyPollRef.current) clearInterval(readyPollRef.current);
    let pollCount = 0;
    readyPollRef.current = setInterval(() => {
      pollCount++;
      if (!isMountedRef.current || pollCount > 30) { if (readyPollRef.current) { clearInterval(readyPollRef.current); readyPollRef.current = null; } return; }
      const v = webVideoElRef.current;
      if (v && v.readyState >= 2) {
        if (readyPollRef.current) { clearInterval(readyPollRef.current); readyPollRef.current = null; }
        if (v.paused) v.play().catch(() => { });
        if (isMountedRef.current) setCamReady(true);
      }
    }, 200);
  }, []);

  const handleVideoRef = useCallback((el: any) => {
    if (!el) {
      if (webVideoElRef.current) { webVideoElRef.current.onloadedmetadata = null; webVideoElRef.current.oncanplay = null; webVideoElRef.current.onerror = null; webVideoElRef.current.srcObject = null; }
      webVideoElRef.current = null;
      return;
    }
    webVideoElRef.current = el;
    attachStreamToVideo();
  }, [attachStreamToVideo]);

  const startWebStream = useCallback(async (facing: 'front' | 'back') => {
    try {
      stopWebStream();
      if (!IS_WEB) return;
      const nav = navigator as any;
      if (!nav.mediaDevices?.getUserMedia) { if (isMountedRef.current) setCamErr('Camera not supported in this browser.'); return; }
      const devices = await nav.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d: any) => d.kind === 'videoinput');
      const facingMode = facing === 'front' ? 'user' : 'environment';
      const stream = await nav.mediaDevices.getUserMedia({
        video: { facingMode: videoDevices.length > 1 ? facingMode : undefined, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      if (!isMountedRef.current) { stream.getTracks().forEach((t: any) => t.stop()); return; }
      streamRef.current = stream;
      attachStreamToVideo();
      setTimeout(() => { if (isMountedRef.current && streamRef.current) attachStreamToVideo(); }, 600);
      setTimeout(() => { if (isMountedRef.current && streamRef.current) { attachStreamToVideo(); const v = webVideoElRef.current; if (v && v.readyState >= 2 && isMountedRef.current) setCamReady(true); } }, 1200);
    } catch (err: unknown) {
      const name = err instanceof Error ? (err as any).name : '';
      let msg: string;
      switch (name) {
        case 'NotAllowedError': msg = 'Camera access blocked. Allow it in your browser settings.'; break;
        case 'NotFoundError': msg = 'No camera found on this device.'; break;
        case 'NotReadableError': msg = 'Camera is in use by another app.'; break;
        case 'OverconstrainedError':
          try { const s = await (navigator as any).mediaDevices.getUserMedia({ video: true, audio: false }); if (!isMountedRef.current) { s.getTracks().forEach((t: any) => t.stop()); return; } streamRef.current = s; attachStreamToVideo(); return; }
          catch { msg = 'Could not start camera. Try a different browser.'; }
          break;
        default: msg = 'Could not start camera. Try refreshing the page.';
      }
      if (isMountedRef.current) setCamErr(msg);
    }
  }, [stopWebStream, attachStreamToVideo]);

  const closeCam = useCallback(() => {
    stopWebStream();
    webVideoElRef.current = null;
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (isMountedRef.current) {
      setCamOpen(false); setCamErr(null); setCamSlot(null); setCountdown(null);
      setTimerEnabled(false); setCapturing(false); capturingRef.current = false;
    }
  }, [stopWebStream]);

  const openCamera = useCallback(async (slot?: PhotoSlotConfig) => {
    const targetSlot = slot ?? nextSlot;
    if (!targetSlot) { Alert.alert('Maximum Photos', `You can add up to ${MAX_PHOTOS} photos.`); return; }
    if (targetSlot.type !== 'freestyle' && form.photos.some((p) => p.type === targetSlot.type)) {
      Alert.alert('Already Added', `You already have a ${targetSlot.label} photo. Remove it first to retake.`); return;
    }
    if (!IS_WEB) {
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          Alert.alert('Camera Required', 'Enable camera access in your device settings.',
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]);
          return;
        }
      }
    }
    if (isMountedRef.current) {
      setCamSlot(targetSlot); setCamFacing(targetSlot.cameraSide); setTimerEnabled(false);
      setCountdown(null); setCamOpen(true); setCamErr(null); setCamReady(false);
      setCapturing(false); capturingRef.current = false;
    }
    if (IS_WEB) { setTimeout(() => { if (isMountedRef.current) startWebStream(targetSlot.cameraSide); }, 500); }
  }, [nextSlot, permission, requestPermission, form.photos, startWebStream]);

  const flipCamera = useCallback(() => {
    const newFacing = camFacing === 'front' ? 'back' : 'front';
    setCamFacing(newFacing);
    if (IS_WEB) { setCamReady(false); startWebStream(newFacing); }
  }, [camFacing, startWebStream]);

  const processPhoto = useCallback(async (uri: string, type: PhotoType, currentPhotoCount: number): Promise<boolean> => {
    if (isMountedRef.current) { setUploading(true); setUploadProgress(0); }
    try {
      const upload: UploadResult = await uploadToCloudinary(uri, 'profile_photo');
      if (isMountedRef.current) setUploadProgress(40);
      if (!upload.success || !upload.url) { Alert.alert('Upload Failed', upload.error ?? 'Could not upload photo.'); return false; }
      if (upload.moderationStatus === 'rejected') { Alert.alert('Photo Rejected', 'This photo was flagged. Please use a different photo.'); return false; }
      if (isMountedRef.current) setUploadProgress(60);
      const photoUrl = upload.url;

      if (type === 'face') {
        try {
          const ageResult = await estimateAgeFromPhoto(photoUrl);
          if (!ageResult || !ageResult.estimatedAge || ageResult.confidence < 0.1) {
            Alert.alert('No Face Detected', 'We couldn\'t detect a clear face.\n\nTips:\n• Face camera directly\n• Good lighting\n• Remove sunglasses');
            return false;
          }
          if (isMountedRef.current) set('ageEstimate', ageResult.estimatedAge);
        } catch (err) { if (__DEV__) console.warn('Face detection failed, allowing photo:', err); }
      }

      if (type === 'upper_body') {
        try {
          const bodyResult = await detectFullBodyPhoto(photoUrl);
          if (bodyResult && !bodyResult.isFullBody && bodyResult.confidence !== undefined && bodyResult.confidence < 0.2) {
            Alert.alert('No Person Detected', 'Please take a photo showing you from the waist up.');
            return false;
          }
        } catch { if (__DEV__) console.warn('Upper body detection failed, allowing photo.'); }
      }

      if (type === 'full_body') {
        try {
          const body = await detectFullBodyPhoto(photoUrl);
          if (!body.isFullBody) {
            const keepAnyway = await new Promise<boolean>((resolve) => {
              Alert.alert('Not Full Body', 'Could not detect a full body.\n\nKeep this photo anyway?',
                [{ text: 'Discard', style: 'cancel', onPress: () => resolve(false) },
                 { text: 'Keep Anyway', onPress: () => { dispatch({ type: 'ADD_PHOTO', photo: { uri, url: photoUrl, type, order: currentPhotoCount, verified: false, uploadedAt: new Date().toISOString() } }); successHaptic(); Alert.alert('📸 Photo Added!', 'Consider retaking for better results.'); resolve(true); } }],
                { cancelable: false });
            });
            return keepAnyway;
          }
        } catch { if (__DEV__) console.warn('Full body detection failed, allowing photo.'); }
      }

      if (isMountedRef.current) setUploadProgress(100);
      dispatch({ type: 'ADD_PHOTO', photo: { uri, url: photoUrl, type, order: currentPhotoCount, verified: true, uploadedAt: new Date().toISOString() } });
      successHaptic();
      const hints: string[] = [];
      if (type === 'face' && !hasUpperBody) hints.push('upper body photo (required)');
      if (type === 'upper_body' && !hasFullBody) hints.push('full body photo (+40% more matches)');
      if (type === 'full_body' && currentPhotoCount < 3) hints.push('freestyle photo to show personality');
      Alert.alert('📸 Photo Added!', hints.length > 0 ? `Great shot! Next up: ${hints.join(', ')}` : 'Looking good! 🎉');
      return true;
    } catch (err) {
      logger.error('processPhoto failed:', err);
      Alert.alert('Upload Error', 'Something went wrong. Check your connection and try again.');
      return false;
    } finally {
      if (isMountedRef.current) { setUploading(false); setUploadProgress(0); }
    }
  }, [hasUpperBody, hasFullBody, set, successHaptic]);

  const doCapture = useCallback(async () => {
    if (!camSlot) return;
    if (capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    let uri: string | null = null;
    try {
      if (IS_WEB) {
        const v = webVideoElRef.current;
        if (!v) { Alert.alert('Camera Error', 'Video element not found. Please close and reopen.'); return; }
        if (v.readyState < 2) {
          await new Promise<void>((resolve) => {
            const deadline = Date.now() + 3000;
            const poll = () => { if (v.readyState >= 2) { resolve(); return; } if (Date.now() >= deadline) { resolve(); return; } setTimeout(poll, 100); };
            poll();
          });
        }
        if (v.readyState < 2) { Alert.alert('Camera Not Ready', 'Please wait a moment and try again.'); return; }
        const doc2 = (globalThis as any).document;
        if (!doc2) { Alert.alert('Browser Error', 'Cannot access document. Try refreshing.'); return; }
        const vw = v.videoWidth; const vh = v.videoHeight;
        if (!vw || !vh) { Alert.alert('Camera Not Ready', 'Video dimensions not available. Please try again.'); return; }
        const canvas = doc2.createElement('canvas');
        canvas.width = vw; canvas.height = vh;
        const ctx = canvas.getContext('2d');
        if (!ctx) { Alert.alert('Browser Error', 'Cannot create canvas. Try a different browser.'); return; }
        if (camFacing === 'front') { ctx.save(); ctx.scale(-1, 1); ctx.drawImage(v, -canvas.width, 0, canvas.width, canvas.height); ctx.restore(); }
        else { ctx.drawImage(v, 0, 0, canvas.width, canvas.height); }
        if (canvas.width < 100 || canvas.height < 100) { Alert.alert('Photo Too Small', 'Please use a higher quality camera.'); return; }
        uri = canvas.toDataURL('image/jpeg', 0.88);
      } else {
        if (!cameraRef.current) { Alert.alert('Camera Error', 'Camera not available. Please close and reopen.'); return; }
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.88, skipProcessing: false });
        uri = photo?.uri ?? null;
      }
      if (!uri) { Alert.alert('Capture Failed', 'Could not capture photo. Try again.'); return; }
      const accepted = await processPhoto(uri, camSlot.type, form.photos.length);
      if (accepted) closeCam();
    } catch (err) {
      logger.error('doCapture failed:', err);
      Alert.alert('Error', 'Something went wrong capturing the photo.');
    } finally {
      capturingRef.current = false;
      if (isMountedRef.current) setCapturing(false);
    }
  }, [camSlot, camFacing, form.photos.length, processPhoto, closeCam]);

  const handleCapture = useCallback(() => {
    if (capturingRef.current || countdown !== null) return;
    if (timerEnabled && camSlot?.timerAvailable) {
      setCountdown(TIMER_SECONDS);
      let count = TIMER_SECONDS;
      countdownRef.current = setInterval(() => {
        count--;
        if (count <= 0) { if (countdownRef.current) clearInterval(countdownRef.current); countdownRef.current = null; if (isMountedRef.current) setCountdown(null); void doCapture(); }
        else { if (isMountedRef.current) setCountdown(count); }
      }, 1000);
    } else { void doCapture(); }
  }, [countdown, timerEnabled, camSlot, doCapture]);

  const removePhoto = useCallback((index: number) => {
    const photo = form.photos[index]; if (!photo) return;
    const isRequired = photo.type === 'face' || photo.type === 'upper_body';
    Alert.alert('Remove Photo', isRequired ? `Removing your ${getPhotoLabel(photo.type)} photo will make Step 1 incomplete.` : 'Remove this photo?',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { dispatch({ type: 'REMOVE_PHOTO', index }); haptic(); } }]);
  }, [form.photos, haptic]);

  const movePhoto = useCallback((from: number, to: number) => {
    if (to < 0 || to >= form.photos.length) return;
    dispatch({ type: 'MOVE_PHOTO', from, to }); haptic();
  }, [form.photos.length, haptic]);

  const getLoc = useCallback(async () => {
    Alert.alert('Location Access', 'Only your city is shown to other users.',
      [{ text: 'Not Now', style: 'cancel' }, { text: 'Enable', onPress: async () => {
        if (isMountedRef.current) setGettingLoc(true);
        try {
          const loc = await requestLocationPermission();
          if (loc) { const display = loc.city ? `${loc.city}, ${loc.country}` : 'Location found'; if (isMountedRef.current) { set('locCity', display); set('locData', loc); } await saveUserLocation(loc); Alert.alert('📍 Location Set', display); }
          else { Alert.alert('Location Error', 'Enable location services in settings.'); }
        } catch { Alert.alert('Location Error', 'Something went wrong.'); }
        finally { if (isMountedRef.current) setGettingLoc(false); }
      }}]);
  }, [set]);

  const switchHeightUnit = useCallback(() => {
    const { newFt, newIn, newCm } = convertHeightForUnitSwitch(form.heightUnit, form.heightCm, form.heightFt, form.heightIn);
    const next: HeightUnit = form.heightUnit === 'cm' ? 'ft' : 'cm';
    dispatch({ type: 'SET', field: 'heightUnit', value: next });
    dispatch({ type: 'SET', field: 'heightFt', value: newFt });
    dispatch({ type: 'SET', field: 'heightIn', value: newIn });
    dispatch({ type: 'SET', field: 'heightCm', value: newCm });
  }, [form.heightUnit, form.heightCm, form.heightFt, form.heightIn]);

  const doSave = useCallback(async () => {
    if (!userId || !birthday || !age) return;
    if (isMountedRef.current) setLoading(true);
    try {
      const e2eeIdentity = await ensureMyE2EEIdentity();
      if (!e2eeIdentity.success || !e2eeIdentity.publicKey) throw new Error(e2eeIdentity.error ?? 'Unable to create encryption identity');
      const baseProfileData = {
        uid: userId, email: userEmail, name: formatName(form.name), age,
        birthday: birthday.toISOString(), zodiacSign: zodiac?.sign ?? null, zodiacEmoji: zodiac?.emoji ?? null,
        gender: form.gender, interestedIn: form.interestedIn, pronouns: form.pronouns || null,
        height: { value: hCm, unit: form.heightUnit, displayText: hDisplay, verificationMethod: 'self-reported', verifiedAt: new Date().toISOString() },
        bodyType: form.bodyType, lookingFor: form.lookingForBody,
        religiousViews: form.religion, lifestyle: form.lifestyle, relationshipGoal: form.relationship,
        education: form.education || null, occupation: form.occupation.trim() || null,
        smoking: form.smoking || null, drinking: form.drinking || null, children: form.children || null,
        pets: form.pets || null, diet: form.diet || null, politicalViews: form.politics || null,
        interests: form.interests, loveLanguage: form.loveLang || null,
        communicationStyle: form.commStyle || null, preferredFirstDate: form.firstDate || null,
        vibes: form.vibes,
        preferences: { ageRange: { min: parseInt(form.ageMin) || MIN_AGE, max: parseInt(form.ageMax) || 50 }, maxDistanceKm: parseInt(form.distKm) || 50, heightRangeCm: { min: parseInt(form.heightPrefMinCm) || null, max: parseInt(form.heightPrefMaxCm) || null }, dealbreakers: form.dealbreakers, importantFields: form.importantFields },
        bio: form.bio.trim(),
        promptAnswers: form.prompts.filter((p) => p.a.trim()).map((p) => ({ question: p.q, answer: p.a.trim() })),
        photos: form.photos.map((p) => p.url),
        photoData: form.photos.map((p) => ({ url: p.url, type: p.type, order: p.order, verified: p.verified, uploadedAt: p.uploadedAt })),
        hasFullBodyPhoto: hasFullBody,
        privacy: { blurUntilMatch: form.blurUntilMatch, incognitoMode: form.incognito, verifiedUsersOnly: form.verifiedOnly },
        location: form.locData || null, locationCity: form.locCity || null,
        personalityType: null, icebreakers: [], profileComplete: true, isVisible: true,
        encryptionPublicKey: e2eeIdentity.publicKey, encryptionKeyVersion: 1,
      };
      const userDocRef = doc(db, 'users', userId);
      const existingDoc = await getDoc(userDocRef);
      if (existingDoc.exists()) {
        const { uid: _uid, email: _email, ...updateData } = baseProfileData;
        await setDoc(userDocRef, { ...updateData, updatedAt: serverTimestamp() }, { merge: true });
      } else {
        await setDoc(userDocRef, { ...baseProfileData, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), termsAcceptedAt: serverTimestamp(), encryptionCreatedAt: serverTimestamp() });
      }
      if (draftKey) { try { profileStorage.delete(draftKey); } catch { } }
      if (stepKey) { try { profileStorage.delete(stepKey); } catch { } }
      dispatch({ type: 'RESET' });
      Alert.alert('🎉 Profile Created!', 'Next up: discover your personality type!', [{ text: 'Continue', onPress: () => router.replace('/personality-quiz' as any) }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('doSave failed:', msg);
      Alert.alert('Save Error', `Could not save your profile: ${msg}`);
    } finally { if (isMountedRef.current) setLoading(false); }
  }, [userId, userEmail, birthday, age, zodiac, form, hCm, hDisplay, hasFullBody, draftKey, stepKey, router]);

  const handleSave = useCallback(async () => {
    if (!userId) { router.replace('/login' as any); return; }
    if (!form.termsAccepted) { Alert.alert('Terms Required', 'Please accept the Terms of Service.'); return; }
    if (!birthday || !age) { Alert.alert('Invalid Birthday', 'Please enter a valid date of birth.'); return; }
    if (form.bio.trim()) { const b = checkBlocked(form.bio); if (b) { Alert.alert('Bio Issue', b); return; } }
    for (const p of form.prompts) { if (p.a.trim()) { const b = checkBlocked(p.a); if (b) { Alert.alert('Prompt Issue', b); return; } } }
    if (form.ageEstimate && Math.abs(age - form.ageEstimate) > AGE_TOL) {
      Alert.alert('Age Verification', `Your photos suggest ~${form.ageEstimate} years old but birthday says ${age}. Continue?`,
        [{ text: 'Go Back', style: 'cancel' }, { text: 'Continue', onPress: () => void doSave() }]);
      return;
    }
    if (!hasFullBody && form.photos.length > 0) {
      Alert.alert('No Full-Body Photo', 'Profiles with a full-body photo get more matches. Add one now?',
        [{ text: 'Add Photo', style: 'cancel', onPress: () => { setStep(1); void openCamera(PHOTO_SLOTS[2]); } },
         { text: 'Continue Anyway', onPress: () => void doSave() }]);
      return;
    }
    await doSave();
  }, [userId, form, birthday, age, hasFullBody, router, doSave, openCamera]);

    const renderChip = useCallback(
    (value: string, selected: boolean, onPress: () => void, icon?: string, disabled?: boolean) => (
      <TouchableOpacity key={value}
        style={[st.chip, { borderColor: selected ? C.accent : C.inputBorder, backgroundColor: selected ? C.accentGlow : C.input }, disabled && st.chipOff]}
        onPress={() => { haptic(); onPress(); }} disabled={disabled || loading || uploading} activeOpacity={0.7}>
        {icon != null && <Text style={st.chipIcon}>{icon}</Text>}
        <Text style={[st.chipText, { color: selected ? C.accent : C.sub }, selected && { fontWeight: '600' }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{value.replace(/^\S+\s/, '')}</Text>
        {selected && <Text style={[st.chipCheck, { color: C.accent }]}>✓</Text>}
      </TouchableOpacity>
    ), [haptic, loading, uploading, C]);

  const renderOpt = useCallback(
    (opt: OptionItem, sel: string, onSel: (v: string) => void) => (
      <TouchableOpacity key={opt.value}
        style={[st.optRow, { backgroundColor: C.input, borderColor: sel === opt.value ? C.accent : C.inputBorder }]}
        onPress={() => { haptic(); onSel(opt.value); }} disabled={loading || uploading} activeOpacity={0.7}>
        <View style={st.optHead}>
          {opt.icon != null && <Text style={st.optIcon}>{opt.icon}</Text>}
          <Text style={[st.optText, { color: sel === opt.value ? C.accent : C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{opt.value}</Text>
          {sel === opt.value && <Text style={[st.optCheck, { color: C.accent }]}>✓</Text>}
        </View>
        {opt.desc != null && opt.desc !== '' && <Text style={[st.optDesc, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{opt.desc}</Text>}
      </TouchableOpacity>
    ), [haptic, loading, uploading, C]);

  const renderStep1 = useCallback(() => (
    <View>
      <Text style={[st.title, { color: C.accent }]}>📸 Your Photos</Text>
      <Text style={[st.sub, { color: C.muted }]}>Camera only — real photos, real you.</Text>
      <View style={st.slotStatus}>
        {PHOTO_SLOTS.filter((s) => s.required).map((slot) => {
          const done = form.photos.some((p) => p.type === slot.type);
          return (<View key={slot.type} style={[st.statusItem, { backgroundColor: C.input, borderColor: done ? C.success : C.inputBorder }]}><Text style={st.statusIcon}>{done ? '✓' : slot.icon}</Text><Text style={[st.statusText, { color: done ? C.success : C.muted }]}>{slot.label} *</Text></View>);
        })}
        <View style={[st.statusItem, { backgroundColor: C.input, borderColor: hasFullBody ? C.success : C.inputBorder }]}><Text style={st.statusIcon}>{hasFullBody ? '✓' : '🧍'}</Text><Text style={[st.statusText, { color: hasFullBody ? C.success : C.muted }]}>Full Body</Text></View>
      </View>
      {uploading && (
        <View style={[st.loadRow, { backgroundColor: C.input }]}><ActivityIndicator size="small" color={C.accent} /><View style={{ flex: 1, marginLeft: SPACING.md }}><Text style={[st.loadRowText, { color: C.accent }]}>Uploading & verifying… {uploadProgress}%</Text><View style={[st.uploadBarBg, { backgroundColor: C.inputBorder }]}><View style={[st.uploadBarFill, { width: `${uploadProgress}%` as any, backgroundColor: C.accent }]} /></View></View></View>
      )}
      <View style={st.photoGrid}>
        {form.photos.map((p, i) => (
          <View key={`ph_${i}`} style={st.photoSlot}>
            <Image source={{ uri: p.uri }} style={[st.photoImg, { borderColor: C.inputBorder }]} contentFit="cover" transition={150} />
            <View style={st.photoTypeTag}><Text style={st.photoTypeText}>{getPhotoLabel(p.type)}</Text></View>
            {i === 0 && (<View style={[st.mainTag, { backgroundColor: C.accent }]}><Text style={[st.mainTagText, { color: C.white }]}>Main</Text></View>)}
            <View style={[st.okDot, { backgroundColor: C.success }]}><Text style={[st.okDotText, { color: C.white }]}>✓</Text></View>
            <View style={st.moveRow}>
              {i > 0 && (<TouchableOpacity style={[st.moveBtn, { backgroundColor: 'rgba(0,0,0,0.7)' }]} onPress={() => movePhoto(i, i - 1)}><Text style={[st.moveBtnText, { color: C.white }]}>←</Text></TouchableOpacity>)}
              {i < form.photos.length - 1 && (<TouchableOpacity style={[st.moveBtn, { backgroundColor: 'rgba(0,0,0,0.7)' }]} onPress={() => movePhoto(i, i + 1)}><Text style={[st.moveBtnText, { color: C.white }]}>→</Text></TouchableOpacity>)}
            </View>
            <TouchableOpacity style={[st.rmBtn, { backgroundColor: C.danger, borderColor: C.card }]} onPress={() => removePhoto(i)} disabled={uploading || loading}><Text style={[st.rmBtnText, { color: C.white }]}>×</Text></TouchableOpacity>
          </View>
        ))}
        {nextSlot && (
          <TouchableOpacity style={[st.addBtn, { borderColor: C.accent, backgroundColor: C.accentGlow }, (uploading || loading) && st.addBtnOff]} onPress={() => void openCamera()} disabled={uploading || loading} activeOpacity={0.7}>
            <Text style={st.addBtnIcon}>{nextSlot.icon}</Text><Text style={[st.addBtnLabel, { color: C.accent }]}>{nextSlot.label}</Text>
            {nextSlot.required && <Text style={[st.addBtnReq, { color: C.warning }]}>Required</Text>}
          </TouchableOpacity>
        )}
      </View>
      {!hasFullBody && hasFace && hasUpperBody && (
        <TouchableOpacity style={[st.tipBox, { backgroundColor: C.accentGlow, borderColor: C.accent }]} onPress={() => void openCamera(PHOTO_SLOTS[2])} activeOpacity={0.7}>
          <Text style={[st.tipText, { color: C.accent }]}>💡 Add a full-body photo for 40% more matches!</Text>
        </TouchableOpacity>
      )}
      {form.photos.length === 0 && (<View style={[st.socialProof, { backgroundColor: C.card, borderColor: C.cardBorder }]}><Text style={[st.socialProofText, { color: C.sub }]}>📊 Profiles with 4+ photos receive 2× more matches.</Text></View>)}
      <Text style={[st.photoHint, { color: C.muted }]}>📌 First photo = profile photo shown in discover feed.</Text>
    </View>
  ), [C, form.photos, hasFullBody, hasFace, hasUpperBody, nextSlot, uploading, loading, uploadProgress, movePhoto, removePhoto, openCamera]);

  const renderStep2 = useCallback(() => (
    <View>
      <Text style={[st.title, { color: C.accent }]}>👤 Basic Info</Text>
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]}>First Name <Text style={{ color: C.danger }}>*</Text></Text>
        <TextInput style={[st.input, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }, form.name.length > 0 && !validateName(form.name).valid && { borderColor: C.danger }, validateName(form.name).valid && { borderColor: C.success }]}
          placeholder="Sarah" placeholderTextColor={C.muted} value={form.name}
          onChangeText={(t) => set('name', t.replace(/[^a-zA-Z\s\-']/g, ''))}
          onBlur={() => { if (form.name) set('name', formatName(form.name)); }}
          editable={!loading} maxLength={MAX_NAME} autoCapitalize="words" autoCorrect={false} />
        {form.name.length > 0 && !validateName(form.name).valid && <Text style={[st.err, { color: C.danger }]}>{validateName(form.name).reason}</Text>}
      </View>
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]}>Date of Birth <Text style={{ color: C.danger }}>*</Text></Text>
        <View style={st.bdayRow}>
          <TextInput style={[st.input, st.bdayIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="MM" placeholderTextColor={C.muted} value={form.bdayMonth} onChangeText={(t) => set('bdayMonth', t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} editable={!loading} />
          <Text style={[st.bdaySep, { color: C.muted }]}>/</Text>
          <TextInput style={[st.input, st.bdayIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="DD" placeholderTextColor={C.muted} value={form.bdayDay} onChangeText={(t) => set('bdayDay', t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} editable={!loading} />
          <Text style={[st.bdaySep, { color: C.muted }]}>/</Text>
          <TextInput style={[st.input, st.bdayInY, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="YYYY" placeholderTextColor={C.muted} value={form.bdayYear} onChangeText={(t) => set('bdayYear', t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} editable={!loading} />
        </View>
        {birthday && age !== null && (
          <View style={st.ageRow}>
            <Text style={[st.ageDisplay, { color: age >= MIN_AGE && age <= MAX_AGE ? C.success : C.danger }]}>Age: {age} {age < MIN_AGE ? '(Must be 18+)' : age > MAX_AGE ? '(Invalid)' : '✓'}</Text>
            {zodiac && <Text style={[st.zodiac, { color: C.accent }]}>{zodiac.emoji} {zodiac.sign}</Text>}
          </View>
        )}
        {form.ageEstimate != null && age != null && Math.abs(age - form.ageEstimate) > AGE_TOL && <Text style={[st.warn, { color: C.warning }]}>⚠️ Your photos suggest approximately {form.ageEstimate} years old</Text>}
      </View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Gender <Text style={{ color: C.danger }}>*</Text></Text><View style={st.chipWrap}>{GENDER_OPTIONS.map((g) => renderChip(g.value, form.gender === g.value, () => set('gender', g.value), g.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Interested In <Text style={{ color: C.danger }}>*</Text></Text><View style={st.chipWrap}>{INTERESTED_IN_OPTIONS.map((o) => renderChip(o.value, form.interestedIn === o.value, () => set('interestedIn', o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Pronouns</Text><View style={st.chipWrap}>{PRONOUN_OPTIONS.map((p) => renderChip(p.value, form.pronouns === p.value, () => set('pronouns', form.pronouns === p.value ? '' : p.value)))}</View></View>
      <View style={st.fg}>
        <View style={st.labelRow}><Text style={[st.label, { color: C.text }]}>Height <Text style={{ color: C.danger }}>*</Text></Text><TouchableOpacity style={[st.unitBtn, { backgroundColor: C.input, borderColor: C.accent }]} onPress={switchHeightUnit} activeOpacity={0.7}><Text style={[st.unitBtnText, { color: C.accent }]}>{form.heightUnit === 'cm' ? 'Switch to ft/in' : 'Switch to cm'}</Text></TouchableOpacity></View>
        {form.heightUnit === 'cm' ? (
          <TextInput style={[st.input, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }, form.heightCm.length > 0 && (hCm < MIN_H || hCm > MAX_H) && { borderColor: C.danger }, hCm >= MIN_H && hCm <= MAX_H && { borderColor: C.success }]} placeholder="170" placeholderTextColor={C.muted} value={form.heightCm} onChangeText={(t) => set('heightCm', t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} editable={!loading} />
        ) : (
          <View style={st.ftRow}>
            <TextInput style={[st.input, st.ftIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="5" placeholderTextColor={C.muted} value={form.heightFt} onChangeText={(t) => set('heightFt', t.replace(/\D/g, '').slice(0, 1))} keyboardType="number-pad" maxLength={1} editable={!loading} />
            <Text style={[st.ftLbl, { color: C.muted }]}>ft</Text>
            <TextInput style={[st.input, st.ftIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="8" placeholderTextColor={C.muted} value={form.heightIn}
              onChangeText={(t) => { const c = t.replace(/\D/g, ''); if (c === '') { set('heightIn', ''); return; } if (parseInt(c) > 11) { Alert.alert('Invalid', 'Inches must be 0–11.'); return; } set('heightIn', c); }}
              keyboardType="number-pad" maxLength={2} editable={!loading} />
            <Text style={[st.ftLbl, { color: C.muted }]}>in</Text>
          </View>
        )}
        {hDisplay !== '' && <Text style={[st.hPreview, { color: C.success }]}>📏 {hDisplay}</Text>}
      </View>
    </View>
  ), [C, form.name, form.bdayMonth, form.bdayDay, form.bdayYear, form.gender, form.interestedIn, form.pronouns, form.heightUnit, form.heightCm, form.heightFt, form.heightIn, form.ageEstimate, birthday, age, zodiac, hCm, hDisplay, loading, set, renderChip, switchHeightUnit]);

  const renderStep3 = useCallback(() => (
    <View><Text style={[st.title, { color: C.accent }]}>💪 Body & Appearance</Text><BodyTypeSelector label="Your Body Type *" selectedType={form.bodyType as any} onSelect={(v) => set('bodyType', v)} disabled={loading} /><View style={st.spacer} /><BodyTypeSelector label="Body Type Preference *" selectedType={form.lookingForBody as any} onSelect={(v) => set('lookingForBody', v)} disabled={loading} showLookingFor /></View>
  ), [C, form.bodyType, form.lookingForBody, loading, set]);

  const renderStep4 = useCallback(() => (
    <View>
      <Text style={[st.title, { color: C.accent }]}>🌟 Lifestyle & Values</Text>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Religious Views <Text style={{ color: C.danger }}>*</Text></Text>{RELIGIOUS_OPTIONS.map((o) => renderOpt(o, form.religion, (v) => set('religion', v)))}</View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Lifestyle <Text style={{ color: C.danger }}>*</Text></Text><View style={st.chipWrap}>{LIFESTYLE_OPTIONS.map((o) => renderChip(o.value, form.lifestyle === o.value, () => set('lifestyle', o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Relationship Goal <Text style={{ color: C.danger }}>*</Text></Text>{RELATIONSHIP_OPTIONS.map((o) => renderOpt(o, form.relationship, (v) => set('relationship', v)))}</View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Education</Text><View style={st.chipWrap}>{EDUCATION_OPTIONS.map((o) => renderChip(o.value, form.education === o.value, () => set('education', form.education === o.value ? '' : o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Occupation</Text><TextInput style={[st.input, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="Software Engineer, Teacher…" placeholderTextColor={C.muted} value={form.occupation} onChangeText={(t) => set('occupation', t)} editable={!loading} maxLength={50} autoCapitalize="words" /><Text style={[st.charCt, { color: form.occupation.length >= 45 ? C.warning : C.muted }]}>{form.occupation.length}/50</Text></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Smoking</Text><View style={st.chipWrap}>{SMOKING_OPTIONS.map((o) => renderChip(o.value, form.smoking === o.value, () => set('smoking', form.smoking === o.value ? '' : o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Drinking</Text><View style={st.chipWrap}>{DRINKING_OPTIONS.map((o) => renderChip(o.value, form.drinking === o.value, () => set('drinking', form.drinking === o.value ? '' : o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Children</Text><View style={st.chipWrap}>{CHILDREN_OPTIONS.map((o) => renderChip(o.value, form.children === o.value, () => set('children', form.children === o.value ? '' : o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Pets</Text><View style={st.chipWrap}>{PET_OPTIONS.map((o) => renderChip(o.value, form.pets === o.value, () => set('pets', form.pets === o.value ? '' : o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Diet</Text><View style={st.chipWrap}>{DIET_OPTIONS.map((o) => renderChip(o.value, form.diet === o.value, () => set('diet', form.diet === o.value ? '' : o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Political Views</Text><View style={st.chipWrap}>{POLITICAL_OPTIONS.map((o) => renderChip(o.value, form.politics === o.value, () => set('politics', form.politics === o.value ? '' : o.value), o.icon))}</View></View>
    </View>
  ), [C, form.religion, form.lifestyle, form.relationship, form.education, form.occupation, form.smoking, form.drinking, form.children, form.pets, form.diet, form.politics, loading, set, renderChip, renderOpt]);

  const renderStep5 = useCallback(() => (
    <View>
      <Text style={[st.title, { color: C.accent }]}>✨ Interests & Personality</Text>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Interests <Text style={{ color: C.danger }}>*</Text></Text><Text style={[st.hint, { color: C.muted }]}>Pick 3–10 · {form.interests.length}/10</Text><View style={st.chipWrap}>{INTEREST_TAGS.map((t) => renderChip(t, form.interests.includes(t), () => dispatch({ type: 'TOGGLE_LIST', field: 'interests', value: t, max: 10 }), undefined, !form.interests.includes(t) && form.interests.length >= 10))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Love Language</Text>{LOVE_LANGUAGE_OPTIONS.map((o) => renderOpt(o, form.loveLang, (v) => set('loveLang', form.loveLang === v ? '' : v)))}</View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Communication Style</Text><View style={st.chipWrap}>{COMMUNICATION_OPTIONS.map((o) => renderChip(o.value, form.commStyle === o.value, () => set('commStyle', form.commStyle === o.value ? '' : o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Preferred First Date</Text><View style={st.chipWrap}>{FIRST_DATE_OPTIONS.map((o) => renderChip(o.value, form.firstDate === o.value, () => set('firstDate', form.firstDate === o.value ? '' : o.value), o.icon))}</View></View>
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]}>Your Vibes</Text><Text style={[st.hint, { color: C.muted }]}>Pick up to 3</Text>
        <View style={st.vibeGrid}>
          {VIBE_EMOJIS.map((e, idx) => { const selected = form.vibes.includes(e); const maxed = !selected && form.vibes.length >= 3; return (<TouchableOpacity key={`vibe_${idx}`} style={[st.vibeItem, { backgroundColor: C.input, borderColor: selected ? C.accent : C.inputBorder }, selected && { backgroundColor: C.accentGlow }, maxed && st.chipOff]} onPress={() => { haptic(); dispatch({ type: 'TOGGLE_LIST', field: 'vibes', value: e, max: 3 }); }} disabled={maxed} activeOpacity={0.7}><Text style={st.vibeEmoji}>{e}</Text></TouchableOpacity>); })}
        </View>
      </View>
    </View>
  ), [C, form.interests, form.loveLang, form.commStyle, form.firstDate, form.vibes, haptic, set, renderChip, renderOpt]);

  const renderStep6 = useCallback(() => (
    <View>
      <Text style={[st.title, { color: C.accent }]}>🎯 Preferences & Deal-breakers</Text>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Age Range</Text><View style={st.rangeRow}><TextInput style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="18" placeholderTextColor={C.muted} value={form.ageMin} onChangeText={(t) => set('ageMin', t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} editable={!loading} /><Text style={[st.rangeDash, { color: C.muted }]}>—</Text><TextInput style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="50" placeholderTextColor={C.muted} value={form.ageMax} onChangeText={(t) => set('ageMax', t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} editable={!loading} /><Text style={[st.rangeU, { color: C.muted }]}>years</Text></View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Maximum Distance</Text><View style={st.rangeRow}><TextInput style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="50" placeholderTextColor={C.muted} value={form.distKm} onChangeText={(t) => set('distKm', t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} editable={!loading} /><Text style={[st.rangeU, { color: C.muted }]}>km</Text></View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Height Preference (cm)</Text><View style={st.rangeRow}><TextInput style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="150" placeholderTextColor={C.muted} value={form.heightPrefMinCm} onChangeText={(t) => set('heightPrefMinCm', t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} editable={!loading} /><Text style={[st.rangeDash, { color: C.muted }]}>—</Text><TextInput style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="200" placeholderTextColor={C.muted} value={form.heightPrefMaxCm} onChangeText={(t) => set('heightPrefMaxCm', t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} editable={!loading} /><Text style={[st.rangeU, { color: C.muted }]}>cm</Text></View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>Deal-breakers</Text><Text style={[st.hint, { color: C.muted }]}>Up to 5 · {form.dealbreakers.length}/5</Text><View style={st.chipWrap}>{DEALBREAKER_TAGS.map((t) => renderChip(t, form.dealbreakers.includes(t), () => dispatch({ type: 'TOGGLE_LIST', field: 'dealbreakers', value: t, max: 5 }), undefined, !form.dealbreakers.includes(t) && form.dealbreakers.length >= 5))}</View></View>
      <View style={st.fg}><Text style={[st.label, { color: C.text }]}>What matters most?</Text><View style={st.chipWrap}>{IMPORTANT_FIELD_OPTIONS.map((f) => renderChip(f, form.importantFields.includes(f), () => dispatch({ type: 'TOGGLE_LIST', field: 'importantFields', value: f })))}</View></View>
    </View>
  ), [C, form.ageMin, form.ageMax, form.distKm, form.heightPrefMinCm, form.heightPrefMaxCm, form.dealbreakers, form.importantFields, loading, set, renderChip]);

  const renderStep7 = useCallback(() => (
    <View>
      <Text style={[st.title, { color: C.accent }]}>💬 About You</Text>
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]}>Bio</Text>
        {form.bio.length === 0 && <TouchableOpacity onPress={() => set('bio', "I'm a curious soul who loves exploring new places and good conversations over coffee. ☕")} activeOpacity={0.7}><Text style={[st.bioSuggestion, { color: C.accent }]}>💡 Tap to see an example bio</Text></TouchableOpacity>}
        <TextInput style={[st.bioIn, { backgroundColor: C.input, color: C.text, borderColor: C.inputBorder }]} placeholder="What makes you unique…" placeholderTextColor={C.muted} value={form.bio}
          onChangeText={(t) => { const c = t.slice(0, MAX_BIO); const b = checkBlocked(c); if (b) { Alert.alert('Not Allowed', b); return; } set('bio', c); }}
          multiline maxLength={MAX_BIO} editable={!loading} textAlignVertical="top" />
        <Text style={[st.charCt, { color: form.bio.length >= MAX_BIO * 0.9 ? C.warning : C.muted }]}>{form.bio.length}/{MAX_BIO}</Text>
      </View>
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]}>Profile Prompts</Text>
        {form.prompts.map((p, i) => (
          <View key={`pr_${i}`} style={[st.promptCard, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
            <TouchableOpacity style={st.promptQ} onPress={() => setPromptPicker(i)} activeOpacity={0.7}><Text style={[st.promptQText, { color: C.accent }]}>{p.q || 'Tap to pick a question…'}</Text><Text style={[st.promptArr, { color: C.accent }]}>▼</Text></TouchableOpacity>
            {p.q !== '' && <TextInput style={[st.promptIn, { backgroundColor: C.card, color: C.text, borderColor: C.inputBorder }]} placeholder="Your answer…" placeholderTextColor={C.muted} value={p.a} onChangeText={(t) => { const c = t.slice(0, MAX_PROMPT); const b = checkBlocked(c); if (b) { Alert.alert('Not Allowed', b); return; } dispatch({ type: 'SET_PROMPT', index: i, q: p.q, a: c }); }} multiline maxLength={MAX_PROMPT} editable={!loading} textAlignVertical="top" />}
            {p.q !== '' && <Text style={[st.charCt, { color: p.a.length >= MAX_PROMPT * 0.9 ? C.warning : C.muted }]}>{p.a.length}/{MAX_PROMPT}</Text>}
            <TouchableOpacity style={st.promptRm} onPress={() => dispatch({ type: 'DEL_PROMPT', index: i })}><Text style={[st.promptRmText, { color: C.danger }]}>✕ Remove</Text></TouchableOpacity>
          </View>
        ))}
        {form.prompts.length < 3 && <TouchableOpacity style={[st.addPrompt, { borderColor: C.accent }]} onPress={() => dispatch({ type: 'ADD_PROMPT' })} activeOpacity={0.7}><Text style={[st.addPromptText, { color: C.accent }]}>+ Add Prompt</Text></TouchableOpacity>}
      </View>
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]}>📍 Location</Text>
        <TouchableOpacity style={[st.locBtn, { backgroundColor: C.input, borderColor: form.locCity !== '' ? C.success : C.inputBorder }, (gettingLoc || loading) && st.btnOff]} onPress={() => void getLoc()} disabled={gettingLoc || loading} activeOpacity={0.7}>
          {gettingLoc ? <View style={st.locRow}><ActivityIndicator size="small" color={C.accent} /><Text style={[st.locBtnText, { color: C.accent }]}>Getting Location…</Text></View>
            : <View style={st.locRow}><Text>{form.locCity ? '✓' : '📍'}</Text><Text style={[st.locBtnText, { color: C.accent }]}>{form.locCity || 'Enable Location'}</Text></View>}
        </TouchableOpacity>
        {form.locCity !== '' && <Text style={[st.locConf, { color: C.success }]}>📍 {form.locCity}</Text>}
      </View>
    </View>
  ), [C, form.bio, form.prompts, form.locCity, loading, gettingLoc, set, getLoc]);

  const renderStep8 = useCallback(() => (
    <View>
      <Text style={[st.title, { color: C.accent }]}>👀 Preview & Privacy</Text>
      <View style={[st.privacyCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
        <Text style={[st.privacyTitle, { color: C.text }]}>🔒 Privacy Settings</Text>
        {([
          { key: 'blurUntilMatch' as const, label: '🔵 Blur photos until match', desc: 'Photos blur in discover until you match.', val: form.blurUntilMatch },
          { key: 'incognito' as const, label: '👻 Incognito mode', desc: 'Only people you like first can see you.', val: form.incognito },
          { key: 'verifiedOnly' as const, label: '✅ Verified users only', desc: 'Only verified users can discover you.', val: form.verifiedOnly },
        ] as const).map((privItem) => (
          <View key={privItem.key} style={[st.privRow, { borderBottomColor: C.inputBorder }]}><View style={st.privInfo}><Text style={[st.privLabel, { color: C.text }]}>{privItem.label}</Text><Text style={[st.privDesc, { color: C.muted }]}>{privItem.desc}</Text></View>
            <Switch value={privItem.val} onValueChange={(v) => set(privItem.key, v)} trackColor={{ false: C.inputBorder, true: C.accent }} thumbColor={privItem.val ? C.success : C.dim} /></View>
        ))}
      </View>
      <Text style={[st.previewLabel, { color: C.sub }]}>How others see you:</Text>
      <View style={[st.preview, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
        {form.photos.length > 0 && (
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.previewPhotoScroll}>
              {form.photos.map((p, i) => <Image key={`prev_${i}`} source={{ uri: p.uri }} style={[st.previewThumb, i === 0 && st.previewThumbMain, form.blurUntilMatch && { opacity: 0.15 }]} contentFit="cover" transition={150} />)}
            </ScrollView>
            {form.blurUntilMatch && <View style={st.blurOverlay}><Text style={[st.blurText, { color: C.accent }]}>🔒 Blurred until match</Text></View>}
          </View>
        )}
        <View style={st.previewInfo}>
          <Text style={[st.previewName, { color: C.text }]}>{formatName(form.name) || 'Your Name'}, {age ?? '??'}{zodiac ? ` ${zodiac.emoji}` : ''}</Text>
          {form.pronouns !== '' && <Text style={[st.previewSub, { color: C.muted }]}>{form.pronouns}</Text>}
          {hDisplay !== '' && <Text style={[st.previewDetail, { color: C.sub }]}>📏 {hDisplay}</Text>}
          {form.occupation.trim() !== '' && <Text style={[st.previewDetail, { color: C.sub }]}>💼 {form.occupation}</Text>}
          {form.locCity !== '' && <Text style={[st.previewDetail, { color: C.sub }]}>📍 {form.locCity}</Text>}
          {form.vibes.length > 0 && <Text style={st.previewVibes}>{form.vibes.join(' ')}</Text>}
          {form.bio.trim() !== '' && <Text style={[st.previewBio, { color: C.text }]}>{form.bio.trim()}</Text>}
          {form.interests.length > 0 && <View style={st.previewTags}>{form.interests.slice(0, 5).map((t) => <View key={t} style={[st.previewTag, { backgroundColor: C.input }]}><Text style={[st.previewTagText, { color: C.accent }]}>{t}</Text></View>)}{form.interests.length > 5 && <Text style={[st.previewMore, { color: C.muted }]}>+{form.interests.length - 5} more</Text>}</View>}
          <Text style={[st.previewPhotoCt, { color: C.muted }]}>📸 {form.photos.length} photo{form.photos.length !== 1 ? 's' : ''}</Text>
        </View>
      </View>
      <View style={[st.pctCard, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
        <Text style={[st.pctTitle, { color: C.text }]}>Profile Completion: {pct}%</Text>
        <View style={[st.pctBarBg, { backgroundColor: C.inputBorder }]}><View style={[st.pctBarFill, { width: `${pct}%` as any, backgroundColor: pct >= 80 ? C.success : pct >= 50 ? C.warning : C.danger }]} /></View>
        {pct < 100 && <Text style={[st.pctHint, { color: C.muted }]}>Complete more fields to increase visibility!</Text>}
      </View>
      <View style={[st.termsRow, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
        <Switch value={form.termsAccepted} onValueChange={(v) => set('termsAccepted', v)} trackColor={{ false: C.inputBorder, true: C.accent }} thumbColor={form.termsAccepted ? C.success : C.dim} />
        <View style={{ flex: 1 }}><Text style={[st.termsText, { color: C.sub }]}>I agree to the{' '}<Text style={[st.termsLink, { color: C.accent }]} onPress={() => Linking.openURL('https://myarchetype.vercel.app/terms').catch(() => { })}>Terms of Service</Text>{' '}and{' '}<Text style={[st.termsLink, { color: C.accent }]} onPress={() => Linking.openURL('https://myarchetype.vercel.app/privacy').catch(() => { })}>Privacy Policy</Text></Text></View>
      </View>
    </View>
  ), [C, form.blurUntilMatch, form.incognito, form.verifiedOnly, form.photos, form.name, form.pronouns, form.occupation, form.locCity, form.vibes, form.bio, form.interests, form.termsAccepted, age, zodiac, hDisplay, pct, set]);

  const renderCurrent = useCallback(() => {
    switch (step) {
      case 1: return renderStep1(); case 2: return renderStep2(); case 3: return renderStep3();
      case 4: return renderStep4(); case 5: return renderStep5(); case 6: return renderStep6();
      case 7: return renderStep7(); case 8: return renderStep8(); default: return null;
    }
  }, [step, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6, renderStep7, renderStep8]);

    return (
    <KeyboardAvoidingView style={[st.root, { backgroundColor: C.bg }]} behavior={IS_IOS ? 'padding' : 'height'}>
      <LinearGradient colors={[C.bgGradientStart, C.bgGradientMid, C.bgGradientEnd]} style={StyleSheet.absoluteFill} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />

      <View style={[st.topBar, { backgroundColor: C.card, borderBottomColor: C.cardBorder }]}>
        <TouchableOpacity onPress={goBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={[st.backBtn, { color: C.accent }]}>{step === 1 ? '✕' : '← Back'}</Text></TouchableOpacity>
        <Text style={[st.topTitle, { color: C.text }]}>{step}/{TOTAL_STEPS} · {STEP_NAMES[step - 1]}</Text>
        <Text style={[st.draftLabel, { color: C.muted }]}>💾 Draft</Text>
      </View>

      <View style={[st.stepDots, { backgroundColor: C.card }]}>
        {STEP_NAMES.map((name, i) => (<View key={name} style={[st.stepDot, { backgroundColor: C.inputBorder }, i + 1 < step && { backgroundColor: C.success }, i + 1 === step && { backgroundColor: C.accent, transform: [{ scale: 1.3 }] }]} />))}
      </View>

      <View style={[st.progBg, { backgroundColor: C.inputBorder }]}>
        <Animated.View style={[st.progFill, { backgroundColor: C.accent, width: progAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>

      {IS_WEB ? (
        <View style={{ flex: 1 }}>
          <ScrollView ref={scrollRef} style={st.sv} contentContainerStyle={st.svContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideAnim }] }}>{renderCurrent()}</Animated.View>
            <View style={{ height: SPACING.xl }} />
          </ScrollView>
        </View>
      ) : (
        <Pressable style={{ flex: 1 }} onPress={() => Keyboard.dismiss()}>
          <ScrollView ref={scrollRef} style={st.sv} contentContainerStyle={st.svContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideAnim }] }}>{renderCurrent()}</Animated.View>
            <View style={{ height: SPACING.xl }} />
          </ScrollView>
        </Pressable>
      )}

      <View style={[st.botBar, { backgroundColor: C.card, borderTopColor: C.cardBorder }]}>
        {step < TOTAL_STEPS ? (
          stepOk ? (
            <TouchableOpacity style={st.nextBtnWrap} onPress={goNext} activeOpacity={0.85}>
              <LinearGradient colors={[C.buttonGradStart, C.buttonGradEnd] as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.nextBtn}>
                <Text style={[st.nextBtnText, { color: C.white }]}>Next → {STEP_NAMES[step]}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={[st.nextBtnWrap, { opacity: 0.6 }]}><View style={[st.nextBtn, { backgroundColor: C.disabledBg }]}><Text style={[st.nextBtnText, { color: C.disabledText }]}>{getMissingFieldsMessage(step, form, hasFace, hasUpperBody, age, hCm)}</Text></View></View>
          )
        ) : (
          form.termsAccepted && !loading ? (
            <TouchableOpacity style={st.nextBtnWrap} onPress={() => void handleSave()} activeOpacity={0.85}>
              <LinearGradient colors={[C.success, '#3aaa50'] as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.nextBtn}>
                <Text style={[st.nextBtnText, { color: C.white }]}>✓ Create Profile</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={[st.nextBtnWrap, { opacity: loading ? 0.8 : 0.5 }]}>
              <View style={[st.nextBtn, { backgroundColor: loading ? C.accent : C.disabledBg }]}>
                {loading ? <View style={st.saveBtnRow}><ActivityIndicator size="small" color={C.white} /><Text style={[st.nextBtnText, { color: C.white, marginLeft: SPACING.sm }]}> Creating…</Text></View>
                  : <Text style={[st.nextBtnText, { color: C.disabledText }]}>Accept Terms to Continue</Text>}
              </View>
            </View>
          )
        )}
      </View>

      <Modal visible={camOpen} animationType="slide" onRequestClose={closeCam} statusBarTranslucent>
        <View style={[st.camModal, { backgroundColor: C.bg }]}>
          <LinearGradient colors={[C.bgGradientStart, C.bgGradientEnd] as [string, string]} style={StyleSheet.absoluteFill} />

          <View style={[st.camHead, { backgroundColor: C.card, borderBottomColor: C.cardBorder }]}>
            <TouchableOpacity onPress={closeCam} activeOpacity={0.7} disabled={capturing} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[st.camCancel, { color: C.danger }]}>✕ Cancel</Text>
            </TouchableOpacity>
            <View style={st.camHeadCenter}><Text style={[st.camTitle, { color: C.text }]}>{camSlot?.icon} {camSlot?.label}</Text><Text style={[st.camInstr, { color: C.muted }]}>{camSlot?.instruction}</Text></View>
            <View style={st.camSpacer} />
          </View>

          <View style={st.camContent} pointerEvents="none">
            {IS_WEB ? (
              <View style={[st.camBox, { borderColor: C.accent }]}>
                {camErr ? (
                  <View style={st.camErrWrap}>
                    <Text style={st.camErrIcon}>📷</Text>
                    <Text style={[st.camErrText, { color: C.danger }]}>{camErr}</Text>
                    <TouchableOpacity style={[st.retryBtn, { backgroundColor: C.accent }]} onPress={() => { if (isMountedRef.current) { setCamErr(null); setCamReady(false); } if (camSlot) startWebStream(camSlot.cameraSide); }} activeOpacity={0.7}>
                      <Text style={[st.retryBtnText, { color: C.white }]}>Try Again</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    {!camReady && (
                      <View style={[StyleSheet.absoluteFillObject, st.camLoadWrap]} pointerEvents="none">
                        <ActivityIndicator size="large" color={C.accent} />
                        <Text style={[st.camLoadText, { color: C.muted }]}>Starting camera…</Text>
                      </View>
                    )}
                    <View style={[StyleSheet.absoluteFillObject, { zIndex: 1 }]} pointerEvents="none">
                      <WebVideoPreview streamReady={!!streamRef.current} facing={camFacing} onReady={handleVideoRef} />
                    </View>
                    {camReady && camSlot && (
                      <View style={[StyleSheet.absoluteFillObject, { zIndex: 2 }]} pointerEvents="none">
                        <CameraGuide type={camSlot.type} C={C} />
                      </View>
                    )}
                    {capturing && (
                      <View style={[st.camProcessingOverlay, { zIndex: 3 }]} pointerEvents="none">
                        <ActivityIndicator size="large" color={C.white} />
                        <Text style={[st.camProcessingText, { color: C.white }]}>Processing photo…</Text>
                      </View>
                    )}
                  </>
                )}
              </View>
            ) : (
              <View style={[st.camBox, { borderColor: C.accent }]}>
                <CameraView ref={cameraRef} style={st.camNative} facing={camFacing}
                  onCameraReady={() => { if (isMountedRef.current) setCamReady(true); }}
                  onMountError={(err) => { if (isMountedRef.current) setCamErr(err.message ?? 'Camera failed to start.'); }} />
                {camSlot && <CameraGuide type={camSlot.type} C={C} />}
                {capturing && (
                  <View style={st.camProcessingOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color={C.white} />
                    <Text style={[st.camProcessingText, { color: C.white }]}>Processing photo…</Text>
                  </View>
                )}
              </View>
            )}

            {countdown !== null && (
              <View style={st.countdownOverlay} pointerEvents="none">
                <Text style={[st.countdownText, { color: C.white }]}>{countdown}</Text>
              </View>
            )}
          </View>

          <View style={[st.camControls, { backgroundColor: C.card, borderTopColor: C.cardBorder }]}>
            {camSlot?.timerAvailable && (
              <TouchableOpacity style={[st.timerBtn, { backgroundColor: C.input, borderColor: timerEnabled ? C.accent : C.inputBorder }, timerEnabled && { backgroundColor: C.accentGlow }, capturing && st.btnOff]}
                onPress={() => { setTimerEnabled((v) => !v); haptic(); }} disabled={capturing} activeOpacity={0.7}>
                <Text style={[st.timerBtnText, { color: timerEnabled ? C.accent : C.text }]}>{timerEnabled ? `⏱ ${TIMER_SECONDS}s ON` : '⏱ Timer'}</Text>
              </TouchableOpacity>
            )}
            <View style={st.camBtnRow}>
              <TouchableOpacity style={[st.flipBtn, { backgroundColor: C.input, borderColor: C.inputBorder }, capturing && st.btnOff]} onPress={flipCamera} disabled={capturing} activeOpacity={0.7}>
                <Text style={st.flipBtnText}>🔄</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[st.captureBtn, { borderColor: C.accent }, (capturing || countdown !== null) && st.captureBtnOff]}
                onPress={handleCapture}
                activeOpacity={0.8}
              >
                {capturing
                  ? <ActivityIndicator size="small" color={C.accent} />
                  : <View style={[st.captureBtnInner, { backgroundColor: C.accent }]} />}
              </TouchableOpacity>

              <View style={st.flipBtn} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={promptPicker !== null} animationType="slide" transparent onRequestClose={() => setPromptPicker(null)}>
        <View style={st.pickerOverlay}>
          <View style={[st.pickerContent, { backgroundColor: C.card, borderColor: C.cardBorder }]}>
            <Text style={[st.pickerTitle, { color: C.text }]}>Choose a Question</Text>
            <FlatList data={PROMPT_QUESTIONS} keyExtractor={(_q, index) => `pq_${index}`} showsVerticalScrollIndicator={false}
              renderItem={({ item: question }) => {
                const used = promptPicker !== null && promptPicker < form.prompts.length && form.prompts.some((p, i) => p.q === question && i !== promptPicker);
                return (
                  <TouchableOpacity style={[st.pickerItem, { borderBottomColor: C.inputBorder }, used && st.pickerItemOff]}
                    onPress={() => { if (used || promptPicker === null || promptPicker >= form.prompts.length) return; dispatch({ type: 'SET_PROMPT', index: promptPicker, q: question, a: form.prompts[promptPicker]?.a ?? '' }); setPromptPicker(null); }}
                    disabled={used} activeOpacity={0.7}>
                    <Text style={[st.pickerItemText, { color: used ? C.muted : C.text }]}>{question}</Text>
                    {used && <Text style={[st.pickerUsed, { color: C.muted }]}>Already used</Text>}
                  </TouchableOpacity>
                );
              }} />
            <TouchableOpacity style={st.pickerCancel} onPress={() => setPromptPicker(null)} activeOpacity={0.7}>
              <Text style={[st.pickerCancelText, { color: C.danger }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  sv: { flex: 1 },
  svContent: { padding: SPACING.xl, paddingBottom: SPACING.xxxxl },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: IS_IOS ? 56 : 44, paddingBottom: SPACING.md, borderBottomWidth: 1 },
  backBtn: { fontSize: FONT.lg, fontWeight: '600' },
  topTitle: { fontSize: FONT.md, fontWeight: '600' },
  draftLabel: { fontSize: FONT.xs },
  stepDots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: SPACING.xs + 2, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg },
  stepDot: { width: 8, height: 8, borderRadius: RADIUS.full },
  progBg: { height: 3 },
  progFill: { height: '100%', borderRadius: RADIUS.sm },
  botBar: { padding: SPACING.lg, paddingBottom: IS_IOS ? 34 : SPACING.lg, borderTopWidth: 1 },
  nextBtnWrap: { width: '100%', borderRadius: RADIUS.xxl, overflow: 'hidden' },
  nextBtn: { paddingVertical: SPACING.lg, borderRadius: RADIUS.xxl, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  nextBtnText: { fontSize: FONT.lg, fontWeight: '700', letterSpacing: 0.3 },
  saveBtnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FONT.xxxl, fontWeight: '800', marginBottom: SPACING.sm, letterSpacing: -0.3 },
  sub: { fontSize: FONT.base, marginBottom: SPACING.xl, lineHeight: 22 },
  fg: { marginBottom: SPACING.xl + 2 },
  spacer: { height: SPACING.xl },
  label: { fontSize: FONT.lg, fontWeight: '600', marginBottom: SPACING.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  hint: { fontSize: FONT.sm, marginBottom: SPACING.sm + 2, fontStyle: 'italic' },
  err: { fontSize: FONT.sm, marginTop: SPACING.xs + 2 },
  warn: { fontSize: FONT.sm, marginTop: SPACING.xs + 2, fontStyle: 'italic' },
  input: { padding: SPACING.lg, borderRadius: RADIUS.md, fontSize: FONT.lg, borderWidth: 1.5 },
  charCt: { fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.xs + 2 },
  bdayRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  bdayIn: { flex: 1, textAlign: 'center' },
  bdayInY: { flex: 1.6, textAlign: 'center' },
  bdaySep: { fontSize: FONT.xxl, fontWeight: 'bold' },
  ageRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm + 2 },
  ageDisplay: { fontSize: FONT.base },
  zodiac: { fontSize: FONT.base },
  unitBtn: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1 },
  unitBtnText: { fontSize: FONT.sm, fontWeight: '600' },
  ftRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  ftIn: { flex: 1, textAlign: 'center' },
  ftLbl: { fontSize: FONT.lg },
  hPreview: { fontSize: FONT.base, marginTop: SPACING.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm + 2, paddingHorizontal: SPACING.md + 2, borderRadius: RADIUS.xxl, borderWidth: 1.5, gap: SPACING.xs + 2 },
  chipOn: {},
  chipOff: { opacity: 0.3 },
  chipIcon: { fontSize: FONT.lg },
  chipText: { fontSize: FONT.base },
  chipCheck: { fontSize: FONT.base, fontWeight: 'bold' },
  optRow: { padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1.5, marginBottom: SPACING.sm },
  optHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  optIcon: { fontSize: FONT.xxl },
  optText: { fontSize: FONT.lg, fontWeight: '600', flex: 1 },
  optCheck: { fontSize: FONT.xl, fontWeight: 'bold' },
  optDesc: { fontSize: FONT.sm, marginTop: SPACING.xs, marginLeft: 28, lineHeight: 18 },
  vibeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  vibeItem: { width: 52, height: 52, borderRadius: RADIUS.full, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5 },
  vibeEmoji: { fontSize: FONT.xxl + 2 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 2 },
  rangeIn: { flex: 1, textAlign: 'center' },
  rangeDash: { fontSize: FONT.xxl },
  rangeU: { fontSize: FONT.base },
  bioIn: { padding: SPACING.lg, borderRadius: RADIUS.lg, fontSize: FONT.lg, minHeight: 130, textAlignVertical: 'top', lineHeight: 24, borderWidth: 1.5 },
  bioSuggestion: { fontSize: FONT.base, marginBottom: SPACING.sm, fontStyle: 'italic' },
  promptCard: { borderRadius: RADIUS.lg, padding: SPACING.md + 2, marginBottom: SPACING.md, borderWidth: 1.5 },
  promptQ: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  promptQText: { fontSize: FONT.base, fontWeight: '600', flex: 1 },
  promptArr: { fontSize: FONT.sm },
  promptIn: { padding: SPACING.md, borderRadius: RADIUS.md, fontSize: FONT.base, minHeight: 64, textAlignVertical: 'top', borderWidth: 1 },
  promptRm: { marginTop: SPACING.sm, alignSelf: 'flex-end' },
  promptRmText: { fontSize: FONT.sm },
  addPrompt: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: RADIUS.lg, padding: SPACING.md + 2, alignItems: 'center', marginTop: SPACING.sm },
  addPromptText: { fontSize: FONT.base, fontWeight: '600' },
  locBtn: { paddingVertical: SPACING.lg, borderRadius: RADIUS.lg, alignItems: 'center', borderWidth: 1.5 },
  btnOff: { opacity: 0.5 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 2 },
  locBtnText: { fontSize: FONT.lg, fontWeight: '600' },
  locConf: { fontSize: FONT.base, marginTop: SPACING.sm + 2, textAlign: 'center' },
  slotStatus: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg, flexWrap: 'wrap' },
  statusItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs + 2, paddingHorizontal: SPACING.md, borderRadius: RADIUS.xxl, gap: SPACING.xs + 2, borderWidth: 1.5 },
  statusIcon: { fontSize: FONT.lg },
  statusText: { fontSize: FONT.md, fontWeight: '600' },
  loadRow: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md + 2, borderRadius: RADIUS.md, marginBottom: SPACING.md + 2, gap: SPACING.sm },
  loadRowText: { fontSize: FONT.base },
  uploadBarBg: { height: 4, borderRadius: RADIUS.sm, overflow: 'hidden', marginTop: SPACING.xs + 2, flex: 1 },
  uploadBarFill: { height: '100%', borderRadius: RADIUS.sm },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  photoSlot: { position: 'relative' },
  photoImg: { width: 100, height: 130, borderRadius: RADIUS.lg, borderWidth: 1.5 },
  photoTypeTag: { position: 'absolute', bottom: 30, left: SPACING.xs, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: SPACING.xs + 2, paddingHorizontal: SPACING.xs + 2, paddingVertical: 2 },
  photoTypeText: { fontSize: 9, fontWeight: 'bold', color: '#fff' },
  mainTag: { position: 'absolute', top: SPACING.xs + 2, left: SPACING.xs + 2, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xxs + 1 },
  mainTagText: { fontSize: FONT.xs, fontWeight: 'bold' },
  okDot: { position: 'absolute', bottom: SPACING.xs + 2, right: SPACING.xs + 2, borderRadius: RADIUS.full, width: 22, height: 22, justifyContent: 'center', alignItems: 'center' },
  okDotText: { fontSize: FONT.xs, fontWeight: 'bold' },
  moveRow: { position: 'absolute', bottom: 30, left: SPACING.xs + 2, flexDirection: 'row', gap: SPACING.xxs + 2 },
  moveBtn: { borderRadius: RADIUS.md, width: 22, height: 22, justifyContent: 'center', alignItems: 'center' },
  moveBtnText: { fontSize: FONT.md, fontWeight: 'bold' },
  rmBtn: { position: 'absolute', top: -8, right: -8, borderRadius: RADIUS.full, width: 28, height: 28, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  rmBtnText: { fontSize: FONT.lg, fontWeight: 'bold' },
  addBtn: { width: 100, height: 130, borderRadius: RADIUS.lg, borderWidth: 1.5, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  addBtnOff: { opacity: 0.35 },
  addBtnIcon: { fontSize: FONT.xxxl, marginBottom: SPACING.xxs + 2 },
  addBtnLabel: { fontSize: FONT.xs, fontWeight: '600' },
  addBtnReq: { fontSize: 9, marginTop: SPACING.xxs },
  tipBox: { padding: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.md + 2, borderWidth: 1 },
  tipText: { fontSize: FONT.md, textAlign: 'center' },
  socialProof: { padding: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.md, borderWidth: 1 },
  socialProofText: { fontSize: FONT.md, textAlign: 'center', lineHeight: 20 },
  photoHint: { fontSize: FONT.sm, marginTop: SPACING.md + 2, lineHeight: 18 },
  privacyCard: { borderRadius: RADIUS.xl, padding: SPACING.xl, marginBottom: SPACING.xl, borderWidth: 1.5 },
  privacyTitle: { fontSize: FONT.xl, fontWeight: '800', marginBottom: SPACING.xxs + 2 },
  privRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md + 2, borderBottomWidth: 1 },
  privInfo: { flex: 1, marginRight: SPACING.md },
  privLabel: { fontSize: FONT.lg - 1, fontWeight: '600', marginBottom: SPACING.xxs + 2 },
  privDesc: { fontSize: FONT.sm, lineHeight: 17 },
  previewLabel: { fontSize: FONT.base, marginBottom: SPACING.sm + 2, fontWeight: '600' },
  preview: { borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.xl, borderWidth: 1.5 },
  previewPhotoScroll: { height: 180 },
  previewThumb: { width: 140, height: 180, marginRight: SPACING.xxs + 2 },
  previewThumbMain: { width: 180 },
  blurOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,26,46,0.75)', justifyContent: 'center', alignItems: 'center' },
  blurText: { fontSize: FONT.xl, fontWeight: 'bold' },
  previewInfo: { padding: SPACING.xl },
  previewName: { fontSize: FONT.xxxl, fontWeight: '800', marginBottom: SPACING.xxs + 2, letterSpacing: -0.3 },
  previewSub: { fontSize: FONT.base, marginBottom: SPACING.sm },
  previewDetail: { fontSize: FONT.base, marginBottom: SPACING.xxs + 2 },
  previewVibes: { fontSize: FONT.xxl + 2, marginVertical: SPACING.sm },
  previewBio: { fontSize: FONT.lg - 1, lineHeight: 22, marginTop: SPACING.sm, marginBottom: SPACING.md },
  previewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs + 2, marginTop: SPACING.sm },
  previewTag: { paddingVertical: SPACING.xxs + 2, paddingHorizontal: SPACING.sm + 2, borderRadius: RADIUS.md },
  previewTagText: { fontSize: FONT.sm },
  previewMore: { fontSize: FONT.sm, alignSelf: 'center' },
  previewPhotoCt: { fontSize: FONT.sm, marginTop: SPACING.md },
  pctCard: { borderRadius: RADIUS.xl, padding: SPACING.lg, marginBottom: SPACING.xl, borderWidth: 1 },
  pctTitle: { fontSize: FONT.lg, fontWeight: '600', marginBottom: SPACING.sm + 2 },
  pctBarBg: { height: 10, borderRadius: RADIUS.sm, overflow: 'hidden' },
  pctBarFill: { height: '100%', borderRadius: RADIUS.sm },
  pctHint: { fontSize: FONT.sm, marginTop: SPACING.sm, fontStyle: 'italic' },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.lg, borderRadius: RADIUS.lg, marginBottom: SPACING.xl, borderWidth: 1 },
  termsText: { fontSize: FONT.base, lineHeight: 22 },
  termsLink: { fontWeight: '600', textDecorationLine: 'underline' },
  camModal: { flex: 1 },
  camHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: SPACING.lg, paddingTop: IS_IOS ? 56 : 44, borderBottomWidth: 1 },
  camCancel: { fontSize: FONT.lg, fontWeight: '600' },
  camHeadCenter: { flex: 1, alignItems: 'center', marginHorizontal: SPACING.sm + 2 },
  camTitle: { fontSize: FONT.xl, fontWeight: '800' },
  camInstr: { fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xxs + 2, lineHeight: 18 },
  camSpacer: { width: 70 },
camContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl, pointerEvents: 'none' } as any,
  camBox: { width: 300, height: 400, borderRadius: RADIUS.xl, overflow: 'hidden', backgroundColor: '#000', borderWidth: 2, position: 'relative' },
  camNative: { width: '100%', height: '100%' },
  camErrWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  camErrIcon: { fontSize: 50, marginBottom: SPACING.lg },
  camErrText: { fontSize: FONT.base, textAlign: 'center', marginBottom: SPACING.xl, lineHeight: 22 },
  camLoadWrap: { justifyContent: 'center', alignItems: 'center' },
  camLoadText: { marginTop: SPACING.lg, fontSize: FONT.base },
  retryBtn: { paddingVertical: SPACING.md + 2, paddingHorizontal: SPACING.xxxl, borderRadius: RADIUS.xxl },
  retryBtnText: { fontSize: FONT.base, fontWeight: '600' },
  camProcessingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', zIndex: 30 },
  camProcessingText: { marginTop: SPACING.lg, fontSize: FONT.base, fontWeight: '600' },
  countdownOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 80, justifyContent: 'center', alignItems: 'center', zIndex: 20, pointerEvents: 'none' } as any,
  countdownText: { fontSize: 120, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 10 },
  camControls: { alignItems: 'center', paddingBottom: IS_IOS ? 44 : SPACING.lg, paddingTop: SPACING.lg, borderTopWidth: 1 },
  timerBtn: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl, borderRadius: RADIUS.xxl, marginBottom: SPACING.lg, borderWidth: 1.5 },
  timerBtnText: { fontSize: FONT.base, fontWeight: '600' },
  camBtnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '100%', paddingHorizontal: SPACING.xxxxl },
  flipBtn: { width: 52, height: 52, borderRadius: RADIUS.full, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  flipBtnText: { fontSize: FONT.xxxl },
  captureBtn: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 4 },
  captureBtnOff: { opacity: 0.4 },
  captureBtnInner: { width: 68, height: 68, borderRadius: 34 },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  pickerContent: { borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl, padding: SPACING.xl, maxHeight: '72%', paddingBottom: IS_IOS ? 34 : SPACING.xl, borderWidth: 1 },
  pickerTitle: { fontSize: FONT.xxl, fontWeight: '800', textAlign: 'center', marginBottom: SPACING.lg },
  pickerItem: { padding: SPACING.lg, borderBottomWidth: 1 },
  pickerItemOff: { opacity: 0.35 },
  pickerItemText: { fontSize: FONT.lg - 1, lineHeight: 22 },
  pickerUsed: { fontSize: FONT.xs, marginTop: SPACING.xxs + 2 },
  pickerCancel: { marginTop: SPACING.lg, padding: SPACING.md + 2, alignItems: 'center' },
  pickerCancelText: { fontSize: FONT.lg, fontWeight: '600' },
});