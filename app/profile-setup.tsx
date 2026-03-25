// ═══════════════════════════════════════
// PART 1 OF 8 — paste first
// ═══════════════════════════════════════

/**
 * ProfileSetupScreen — Multi-step wizard
 *
 * Steps:
 *  1. Photos (camera-only, guided types, overlay guides)
 *  2. Basics (name, birthday→age+zodiac, gender, pronouns, height, interestedIn)
 *  3. Body & Appearance
 *  4. Lifestyle & Values
 *  5. Interests & Personality
 *  6. Preferences & Deal-breakers
 *  7. Location, Bio & Prompts
 *  8. Privacy, Preview & Submit
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
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
  findNodeHandle,
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
  useWindowDimensions,
  View,
} from 'react-native';
import BodyTypeSelector from '../components/BodyTypeSelector';
import { auth, db } from '../firebaseConfig';
import { estimateAgeFromPhoto } from '../utils/ageEstimation';
import { detectFullBodyPhoto } from '../utils/bodyTypeDetection';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import { requestLocationPermission, saveUserLocation } from '../utils/location';
import { logger } from '../utils/logger';
import { formatName, validateName } from '../utils/nameValidation';

// ─── Platform ─────────────────────────────────────────────

const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';
const IS_ANDROID = Platform.OS === 'android';

// ─── Design Tokens ────────────────────────────────────────

const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
} as const;

const FONT = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 18,
  xxl: 20,
  xxxl: 24,
  display: 28,
} as const;

const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 25,
  full: 50,
} as const;

const MAX_FONT_SCALE = 1.4;

// ─── Limits ───────────────────────────────────────────────

const MAX_PHOTOS    = 6;
const MAX_BIO       = 300;
const MAX_PROMPT    = 150;
const MAX_NAME      = 20;
const AGE_TOL       = 5;
const MIN_AGE       = 18;
const MAX_AGE       = 99;
const MIN_H         = 100;
const MAX_H         = 250;
const TOTAL_STEPS   = 8;
const TIMER_SECONDS = 3;
const DRAFT_KEY_PREFIX = 'profile_setup_draft_';
const STEP_KEY_PREFIX  = 'profile_setup_step_';

const STEP_NAMES = [
  'Photos',
  'Basics',
  'Body',
  'Lifestyle',
  'Interests',
  'Preferences',
  'About You',
  'Preview',
] as const;

// ─── Colors ───────────────────────────────────────────────

const DARK = {
  bg:           '#1a1a2e',
  card:         '#16213e',
  input:        '#0f3460',
  border:       '#0f3460',
  accent:       '#53a8b6',
  success:      '#5cb85c',
  danger:       '#d9534f',
  warning:      '#e67e22',
  gold:         '#f1c40f',
  purple:       '#9b59b6',
  text:         '#eeeeee',
  sub:          '#aaaaaa',
  muted:        '#888888',
  dim:          '#666666',
  white:        '#ffffff',
  black:        '#000000',
  overlay:      'rgba(0,0,0,0.85)',
  none:         'transparent',
  guideStroke:  'rgba(83,168,182,0.6)',
  guideFill:    'rgba(83,168,182,0.08)',
  skeleton:     '#253454',
} as const;

const LIGHT = {
  bg:           '#f5f5f7',
  card:         '#ffffff',
  input:        '#e8eaf0',
  border:       '#d0d3e0',
  accent:       '#3a8a9a',
  success:      '#34a853',
  danger:       '#ea4335',
  warning:      '#e67e22',
  gold:         '#f9a825',
  purple:       '#8e44ad',
  text:         '#1a1a2e',
  sub:          '#444444',
  muted:        '#666666',
  dim:          '#888888',
  white:        '#ffffff',
  black:        '#000000',
  overlay:      'rgba(0,0,0,0.85)',
  none:         'transparent',
  guideStroke:  'rgba(58,138,154,0.6)',
  guideFill:    'rgba(58,138,154,0.08)',
  skeleton:     '#e0e4ed',
} as const;

type Theme = typeof DARK;

// ─── Types ────────────────────────────────────────────────

type ZodiacSign =
  | 'Capricorn' | 'Aquarius' | 'Pisces'   | 'Aries'
  | 'Taurus'    | 'Gemini'   | 'Cancer'   | 'Leo'
  | 'Virgo'     | 'Libra'    | 'Scorpio'  | 'Sagittarius';

type PhotoType = 'face' | 'upper_body' | 'full_body' | 'freestyle';

type BodyType =
  | 'slim' | 'athletic' | 'average'
  | 'curvy' | 'heavyset' | '';

type HeightUnit = 'cm' | 'ft';

interface ProfilePhoto {
  uri:        string;
  url:        string;
  type:       PhotoType;
  order:      number;
  verified:   boolean;
  uploadedAt: string;
}

interface PhotoSlotConfig {
  type:            PhotoType;
  label:           string;
  required:        boolean;
  icon:            string;
  instruction:     string;
  cameraSide:      'front' | 'back';
  timerAvailable:  boolean;
}

interface OptionItem {
  value:  string;
  label?: string;
  desc?:  string;
  icon?:  string;
}

interface ZodiacResult {
  sign:  ZodiacSign;
  emoji: string;
}

interface UploadResult {
  success: boolean;
  url?:    string;
  error?:  string;
  moderationStatus?: 'approved' | 'rejected' | 'pending';
}

interface AgeEstimationResult {
  estimatedAge: number;
  confidence:   number;
}

interface LocationData {
  city:      string;
  country:   string;
  latitude:  number;
  longitude: number;
}

interface FormState {
  photos:       ProfilePhoto[];

  // Step 2 — Basics
  name:         string;
  bdayMonth:    string;
  bdayDay:      string;
  bdayYear:     string;
  gender:       string;
  interestedIn: string;
  pronouns:     string;
  heightCm:     string;
  heightFt:     string;
  heightIn:     string;
  heightUnit:   HeightUnit;

  // Step 3 — Body
  bodyType:       BodyType;
  lookingForBody: BodyType;

  // Step 4 — Lifestyle
  religion:     string;
  lifestyle:    string;
  relationship: string;
  education:    string;
  occupation:   string;
  smoking:      string;
  drinking:     string;
  children:     string;
  pets:         string;
  diet:         string;
  politics:     string;

  // Step 5 — Interests
  interests:  string[];
  loveLang:   string;
  commStyle:  string;
  firstDate:  string;
  vibes:      string[];

  // Step 6 — Preferences
  ageMin:          string;
  ageMax:          string;
  distKm:          string;
  heightPrefMinCm: string;
  heightPrefMaxCm: string;
  dealbreakers:    string[];
  importantFields: string[];

  // Step 7 — About
  bio:     string;
  prompts: { q: string; a: string }[];

  // Location
  locCity: string;
  locData: LocationData | null;

  // AI
  ageEstimate: number | null;

  // Privacy
  blurUntilMatch: boolean;
  incognito:      boolean;
  verifiedOnly:   boolean;

  // Submit
  termsAccepted: boolean;
}

type Action =
  | { type: 'SET'; field: keyof FormState; value: any }
  | { type: 'ADD_PHOTO';    photo: ProfilePhoto }
  | { type: 'REMOVE_PHOTO'; index: number }
  | { type: 'MOVE_PHOTO';   from: number; to: number }
  | { type: 'TOGGLE_LIST';  field: 'interests' | 'dealbreakers' | 'vibes' | 'importantFields'; value: string; max?: number }
  | { type: 'SET_PROMPT';   index: number; q: string; a: string }
  | { type: 'ADD_PROMPT' }
  | { type: 'DEL_PROMPT';   index: number }
  | { type: 'LOAD';         state: Partial<FormState> }
  | { type: 'RESET' };

// ─── Option Data ──────────────────────────────────────────

const PHOTO_SLOTS: PhotoSlotConfig[] = [
  {
    type:           'face',
    label:          'Face Selfie',
    required:       true,
    icon:           '🤳',
    instruction:    'Show your face clearly\nShoulders up, good lighting',
    cameraSide:     'front',
    timerAvailable: false,
  },
  {
    type:           'upper_body',
    label:          'Upper Body',
    required:       true,
    icon:           '👤',
    instruction:    'Waist up, show your upper body\nKeep your face visible',
    cameraSide:     'front',
    timerAvailable: false,
  },
  {
    type:           'full_body',
    label:          'Full Body',
    required:       false,
    icon:           '🧍',
    instruction:    'Head to toe, stand naturally\nProp your phone or use the timer',
    cameraSide:     'back',
    timerAvailable: true,
  },
  {
    type:           'freestyle',
    label:          'Freestyle',
    required:       false,
    icon:           '📸',
    instruction:    'Show your personality!\nHobbies, style, pets, travel...',
    cameraSide:     'front',
    timerAvailable: false,
  },
];

const GENDER_OPTIONS: OptionItem[] = [
  { value: 'Male',              icon: '👨' },
  { value: 'Female',            icon: '👩' },
  { value: 'Non-binary',        icon: '🧑' },
  { value: 'Other',             icon: '✨' },
  { value: 'Prefer not to say', icon: '🤫' },
];

const INTERESTED_IN_OPTIONS: OptionItem[] = [
  { value: 'Men',              icon: '👨' },
  { value: 'Women',            icon: '👩' },
  { value: 'Everyone',         icon: '💫' },
  { value: 'Non-binary people',icon: '🧑' },
];

const PRONOUN_OPTIONS: OptionItem[] = [
  { value: 'He/Him'   },
  { value: 'She/Her'  },
  { value: 'They/Them'},
  { value: 'Other'    },
];

const RELIGIOUS_OPTIONS: OptionItem[] = [
  { value: 'Traditional',       desc: 'Follow religious practices regularly' },
  { value: 'Modern',            desc: 'Believe but flexible interpretation'  },
  { value: 'Spiritual',         desc: 'Spiritual but not organized religion' },
  { value: 'None',              desc: 'Not religious or spiritual'           },
  { value: 'Prefer not to say', desc: ''                                    },
];

const LIFESTYLE_OPTIONS: OptionItem[] = [
  { value: 'Natural',     desc: 'Simple, outdoors, minimal',       icon: '🌿' },
  { value: 'Fitness',     desc: 'Active, gym, health-focused',     icon: '💪' },
  { value: 'Social',      desc: 'Outgoing, parties, events',       icon: '🎉' },
  { value: 'Homebody',    desc: 'Cozy nights in, relaxing',        icon: '🏠' },
  { value: 'Adventurous', desc: 'Travel, explore, try new things', icon: '🌍' },
  { value: 'Creative',    desc: 'Art, music, self-expression',     icon: '🎨' },
];

const RELATIONSHIP_OPTIONS: OptionItem[] = [
  { value: 'Marriage',   desc: 'Looking for life partner',   icon: '💍' },
  { value: 'Long-term',  desc: 'Serious but not rushing',    icon: '❤️' },
  { value: 'Exploring',  desc: 'Open to see where it goes',  icon: '🌊' },
];

const EDUCATION_OPTIONS: OptionItem[] = [
  { value: 'High School',       icon: '🏫' },
  { value: 'Trade School',      icon: '🔧' },
  { value: "Bachelor's",        icon: '🎓' },
  { value: "Master's",          icon: '📚' },
  { value: 'PhD',               icon: '🧪' },
  { value: 'Prefer not to say', icon: '🤫' },
];

const SMOKING_OPTIONS: OptionItem[] = [
  { value: 'Never',    icon: '🚭' },
  { value: 'Socially', icon: '💨' },
  { value: 'Regularly',icon: '🚬' },
];

const DRINKING_OPTIONS: OptionItem[] = [
  { value: 'Never',    icon: '🚫' },
  { value: 'Socially', icon: '🍷' },
  { value: 'Regularly',icon: '🍺' },
];

const CHILDREN_OPTIONS: OptionItem[] = [
  { value: "Don't have, don't want", icon: '🙅'     },
  { value: "Don't have, want someday",icon: '🤱'    },
  { value: 'Have, want more',         icon: '👨‍👧‍👦' },
  { value: "Have, don't want more",   icon: '👨‍👧'  },
  { value: 'Prefer not to say',       icon: '🤫'    },
];

const PET_OPTIONS: OptionItem[] = [
  { value: 'Dog lover', icon: '🐕' },
  { value: 'Cat lover', icon: '🐈' },
  { value: 'Both',      icon: '🐾' },
  { value: 'No pets',   icon: '🏠' },
  { value: 'Allergic',  icon: '🤧' },
];

const DIET_OPTIONS: OptionItem[] = [
  { value: 'No preference', icon: '🍽️' },
  { value: 'Vegetarian',    icon: '🥬' },
  { value: 'Vegan',         icon: '🌱' },
  { value: 'Halal',         icon: '☪️' },
  { value: 'Kosher',        icon: '✡️' },
  { value: 'Pescatarian',   icon: '🐟' },
  { value: 'Keto',          icon: '🥑' },
];

const LOVE_LANGUAGE_OPTIONS: OptionItem[] = [
  { value: 'Words of Affirmation', desc: 'Verbal compliments, encouragement', icon: '💬' },
  { value: 'Quality Time',         desc: 'Undivided attention together',       icon: '⏰' },
  { value: 'Gifts',                desc: 'Thoughtful presents & surprises',    icon: '🎁' },
  { value: 'Acts of Service',      desc: 'Helping out, doing things',          icon: '🤝' },
  { value: 'Physical Touch',       desc: 'Hugs, holding hands',                icon: '🤗' },
];

const COMMUNICATION_OPTIONS: OptionItem[] = [
  { value: 'Texter',     icon: '💬' },
  { value: 'Caller',     icon: '📞' },
  { value: 'In-person',  icon: '🤝' },
  { value: 'Mix of all', icon: '🔄' },
];

const FIRST_DATE_OPTIONS: OptionItem[] = [
  { value: 'Coffee',           icon: '☕' },
  { value: 'Dinner',           icon: '🍽️' },
  { value: 'Drinks',           icon: '🍹' },
  { value: 'Adventure',        icon: '🧗' },
  { value: 'Walk / Park',      icon: '🌳' },
  { value: 'Museum / Gallery', icon: '🎨' },
];

const POLITICAL_OPTIONS: OptionItem[] = [
  { value: 'Liberal',           icon: '🕊️' },
  { value: 'Moderate',          icon: '⚖️' },
  { value: 'Conservative',      icon: '🏛️' },
  { value: 'Not political',     icon: '🤷' },
  { value: 'Prefer not to say', icon: '🤫' },
];

const INTEREST_TAGS: string[] = [
  '🏋️ Fitness',    '🧘 Yoga',       '🏃 Running',     '🚴 Cycling',    '🏊 Swimming',
  '⚽ Football',   '🏀 Basketball', '🎾 Tennis',      '⛷️ Skiing',     '🏄 Surfing',
  '📚 Reading',    '✍️ Writing',    '🎵 Music',       '🎸 Guitar',     '🎹 Piano',
  '🎨 Art',        '📷 Photography','🎬 Movies',      '📺 TV Shows',   '🎮 Gaming',
  '🍳 Cooking',    '🍰 Baking',     '☕ Coffee',      '🍷 Wine',       '🍣 Foodie',
  '✈️ Travel',     '🏕️ Camping',   '🥾 Hiking',      '🌊 Beach',      '🏔️ Mountains',
  '🐕 Dogs',       '🐈 Cats',       '🌱 Plants',      '🧠 Psychology', '💻 Tech',
  '📈 Finance',    '🎤 Karaoke',    '💃 Dancing',     '🧩 Puzzles',    '♟️ Chess',
  '🎲 Board Games','🚗 Cars',       '✨ Fashion',     '💄 Makeup',
  '🧘‍♂️ Meditation','📖 Spirituality','🎭 Theater',   '🎪 Comedy',     '🌍 Volunteering',
];

const DEALBREAKER_TAGS: string[] = [
  '🚬 Smoking',
  '🍺 Heavy drinking',
  '📱 Social media obsession',
  '🏠 Long distance',
  '👶 Wants kids',
  '🚫 No kids ever',
  '🐾 No pets allowed',
  '🗣️ Poor communication',
  '🎮 Excessive gaming',
  '📵 No calls or video',
  '🤥 Dishonesty',
  '😤 Hot temper',
  '💸 Financial issues',
  '🙅 Lack of ambition',
  '⛪ Religious differences',
];

const PROMPT_QUESTIONS: string[] = [
  'A life goal of mine is...',
  'I geek out on...',
  'My simple pleasures are...',
  'The way to win me over is...',
  'My most controversial opinion is...',
  "I'm looking for someone who...",
  "On a typical Sunday you'll find me...",
  'Two truths and a lie...',
  'My greatest strength is...',
  "I'll know it's love when...",
  'The key to my heart is...',
  'My favorite travel story is...',
];

const VIBE_EMOJIS: string[] = [
  '😎','🥰','🤓','🏋️','🎨','🌍','🎵','📚','🍳','🧘',
  '🎮','💃','🌿','🏖️','⚡','🌙','☀️','🦋','🔥','💎',
  '🎯','🧩','🌈','🍕','🎪','🚀','🎸','🐾','🌸','✨',
];

const IMPORTANT_FIELD_OPTIONS: string[] = [
  'Religion','Lifestyle','Education','Height',
  'Body Type','Children','Smoking','Drinking','Pets','Politics',
];

// ═══════════════════════════════════════
// PART 3 OF 8 — paste after PART 2
// ═══════════════════════════════════════

// ─── Pure Utilities ───────────────────────────────────────

const ZODIAC_DATA: {
  sign:  ZodiacSign;
  emoji: string;
  s:     [number, number];
  e:     [number, number];
}[] = [
  { sign: 'Capricorn',   emoji: '♑', s: [1,  1],  e: [1,  19] },
  { sign: 'Aquarius',    emoji: '♒', s: [1,  20], e: [2,  18] },
  { sign: 'Pisces',      emoji: '♓', s: [2,  19], e: [3,  20] },
  { sign: 'Aries',       emoji: '♈', s: [3,  21], e: [4,  19] },
  { sign: 'Taurus',      emoji: '♉', s: [4,  20], e: [5,  20] },
  { sign: 'Gemini',      emoji: '♊', s: [5,  21], e: [6,  20] },
  { sign: 'Cancer',      emoji: '♋', s: [6,  21], e: [7,  22] },
  { sign: 'Leo',         emoji: '♌', s: [7,  23], e: [8,  22] },
  { sign: 'Virgo',       emoji: '♍', s: [8,  23], e: [9,  22] },
  { sign: 'Libra',       emoji: '♎', s: [9,  23], e: [10, 22] },
  { sign: 'Scorpio',     emoji: '♏', s: [10, 23], e: [11, 21] },
  { sign: 'Sagittarius', emoji: '♐', s: [11, 22], e: [12, 21] },
  // Capricorn wraps into December
  { sign: 'Capricorn',   emoji: '♑', s: [12, 22], e: [12, 31] },
];

function getZodiac(m: number, d: number): ZodiacResult {
  for (const z of ZODIAC_DATA) {
    if (
      (m === z.s[0] && d >= z.s[1]) ||
      (m === z.e[0] && d <= z.e[1])
    ) {
      return { sign: z.sign, emoji: z.emoji };
    }
  }
  return { sign: 'Capricorn', emoji: '♑' };
}

function calcAge(bday: Date): number {
  const today = new Date();
  let age = today.getFullYear() - bday.getFullYear();
  const monthDiff = today.getMonth() - bday.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < bday.getDate())
  ) {
    age--;
  }
  return age;
}

/**
 * Validates that a given year/month/day combination is a real date.
 * e.g. Feb 30 or Nov 31 would return false.
 */
function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (y < 1920 || y > new Date().getFullYear()) return false;
  const daysInMonth = new Date(y, m, 0).getDate();
  return d >= 1 && d <= daysInMonth;
}

function cmToFt(cm: number): string {
  const totalInches = cm / 2.54;
  const feet        = Math.floor(totalInches / 12);
  const inches      = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

function ftToCm(ft: number, inc: number): number {
  return Math.round((ft * 12 + inc) * 2.54);
}

/**
 * Converts feet/inches inputs into cm, then back, to get canonical
 * display string when switching units — prevents data loss on toggle.
 */
function convertHeightForUnitSwitch(
  currentUnit: HeightUnit,
  heightCm: string,
  heightFt: string,
  heightIn: string,
): { newFt: string; newIn: string; newCm: string } {
  if (currentUnit === 'cm') {
    const cm = parseInt(heightCm) || 0;
    if (cm >= MIN_H) {
      const totalInches = cm / 2.54;
      return {
        newFt:  String(Math.floor(totalInches / 12)),
        newIn:  String(Math.round(totalInches % 12)),
        newCm:  heightCm,
      };
    }
  } else {
    const cm = ftToCm(parseInt(heightFt) || 0, parseInt(heightIn) || 0);
    if (cm >= MIN_H) {
      return { newFt: heightFt, newIn: heightIn, newCm: String(cm) };
    }
  }
  return { newFt: heightFt, newIn: heightIn, newCm: heightCm };
}

function getPhotoLabel(type: PhotoType): string {
  return PHOTO_SLOTS.find((s) => s.type === type)?.label ?? 'Photo';
}

function getNextPhotoSlot(photos: ProfilePhoto[]): PhotoSlotConfig | null {
  // First fill required slots in order
  for (const slot of PHOTO_SLOTS) {
    if (slot.required && !photos.some((p) => p.type === slot.type)) {
      return slot;
    }
  }
  // Then suggest full body if missing
  if (!photos.some((p) => p.type === 'full_body')) {
    return PHOTO_SLOTS.find((s) => s.type === 'full_body')!;
  }
  // Then freestyle if room
  if (photos.length < MAX_PHOTOS) {
    return PHOTO_SLOTS.find((s) => s.type === 'freestyle')!;
  }
  return null;
}

const BLOCKED_RE: RegExp[] = [
  /\b(fuck|shit|ass|bitch|dick|cunt|f+u+c+k+|sh[i1]t)\b/i,
  /@[\w.]+/,
  /\b\d{7,}\b/,
  /[\w.]+@[\w.]+\.\w+/,
  /\b(snap(chat)?|insta(gram)?|ig|whatsapp|telegram|signal|kik|tiktok|onlyfans)\b/i,
];

function checkBlocked(text: string): string | null {
  for (const r of BLOCKED_RE) {
    if (r.test(text)) {
      if (r.source.includes('@') || r.source.includes('\\d'))
        return 'Contact information is not allowed.';
      if (r.source.includes('snap'))
        return 'Social media handles are not allowed.';
      return 'This contains inappropriate language.';
    }
  }
  return null;
}

function getMissingFieldsMessage(
  step: number,
  form: FormState,
  hasFace: boolean,
  hasUpperBody: boolean,
  age: number | null,
  hCm: number,
): string {
  switch (step) {
    case 1: {
      const missing: string[] = [];
      if (!hasFace)      missing.push('face selfie');
      if (!hasUpperBody) missing.push('upper body photo');
      return missing.length > 0
        ? `Still needed: ${missing.join(', ')}`
        : 'Complete required fields';
    }
    case 2: {
      if (!validateName(form.name).valid)
        return validateName(form.name).reason ?? 'Enter a valid name';
      if (age === null)
        return 'Enter your date of birth';
      if (age < MIN_AGE)
        return `Must be ${MIN_AGE}+`;
      if (age > MAX_AGE)
        return 'Invalid age';
      if (!form.gender)
        return 'Select your gender';
      if (!form.interestedIn)
        return 'Select who you are interested in';
      if (hCm < MIN_H || hCm > MAX_H)
        return 'Enter a valid height';
      return 'Complete required fields';
    }
    case 3: return 'Select your body type and preference';
    case 4: return 'Select religion, lifestyle and relationship goal';
    case 5: return 'Pick at least 3 interests';
    case 8: return 'Accept the Terms of Service to continue';
    default: return 'Complete required fields';
  }
}

// ─── Reducer ──────────────────────────────────────────────

const INIT: FormState = {
  photos:          [],
  name:            '',
  bdayMonth:       '',
  bdayDay:         '',
  bdayYear:        '',
  gender:          '',
  interestedIn:    '',
  pronouns:        '',
  heightCm:        '',
  heightFt:        '',
  heightIn:        '',
  heightUnit:      'cm',
  bodyType:        '',
  lookingForBody:  '',
  religion:        '',
  lifestyle:       '',
  relationship:    '',
  education:       '',
  occupation:      '',
  smoking:         '',
  drinking:        '',
  children:        '',
  pets:            '',
  diet:            '',
  politics:        '',
  interests:       [],
  loveLang:        '',
  commStyle:       '',
  firstDate:       '',
  vibes:           [],
  ageMin:          '18',
  ageMax:          '50',
  distKm:          '50',
  heightPrefMinCm: '',
  heightPrefMaxCm: '',
  dealbreakers:    [],
  importantFields: [],
  bio:             '',
  prompts:         [],
  locCity:         '',
  locData:         null,
  ageEstimate:     null,
  blurUntilMatch:  false,
  incognito:       false,
  verifiedOnly:    false,
  termsAccepted:   false,
};

function reducer(state: FormState, action: Action): FormState {
  switch (action.type) {

    case 'SET':
      return { ...state, [action.field]: action.value };

    case 'ADD_PHOTO':
      return { ...state, photos: [...state.photos, action.photo] };

    case 'REMOVE_PHOTO':
      return {
        ...state,
        photos: state.photos
          .filter((_, i) => i !== action.index)
          .map((p, i) => ({ ...p, order: i })),
      };

    case 'MOVE_PHOTO': {
      const arr = [...state.photos];
      const [moved] = arr.splice(action.from, 1);
      arr.splice(action.to, 0, moved);
      return { ...state, photos: arr.map((p, i) => ({ ...p, order: i })) };
    }

    case 'TOGGLE_LIST': {
      const list = [...(state[action.field] as string[])];
      const idx  = list.indexOf(action.value);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        if (list.length >= (action.max ?? 999)) return state;
        list.push(action.value);
      }
      return { ...state, [action.field]: list };
    }

    case 'SET_PROMPT': {
      const prompts = [...state.prompts];
      prompts[action.index] = { q: action.q, a: action.a };
      return { ...state, prompts };
    }

    case 'ADD_PROMPT':
      if (state.prompts.length >= 3) return state;
      return { ...state, prompts: [...state.prompts, { q: '', a: '' }] };

    case 'DEL_PROMPT':
      return {
        ...state,
        prompts: state.prompts.filter((_, i) => i !== action.index),
      };

    case 'LOAD':
      return { ...state, ...action.state };

    case 'RESET':
      return INIT;

    default: {
      // Exhaustive check — TypeScript will error if a case is missed
      const _exhaustive: never = action;
      return state;
    }
  }
}

// ─── Camera Guide Overlays ────────────────────────────────

const CameraGuide = React.memo(function CameraGuide({
  type,
  C,
}: {
  type: PhotoType;
  C:    Theme;
}) {
  const guideS = makeGuideStyles(C);

  switch (type) {
    case 'face':
      return (
        <View
          style={guideS.container}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={guideS.faceOval} />
          <View style={guideS.shoulderLine} />
          <Text style={guideS.guideText}>
            Position your face{'\n'}inside the oval
          </Text>
        </View>
      );

    case 'upper_body':
      return (
        <View
          style={guideS.container}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={guideS.ubHead} />
          <View style={guideS.ubNeck} />
          <View style={guideS.ubShoulders} />
          <View style={guideS.ubTorso} />
          <Text style={guideS.guideTextBottom}>
            Show from{'\n'}waist up
          </Text>
        </View>
      );

    case 'full_body':
      return (
        <View
          style={guideS.container}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={guideS.fbHead} />
          <View style={guideS.fbNeck} />
          <View style={guideS.fbTorso} />
          <View style={guideS.fbHips} />
          <View style={guideS.fbLegs}>
            <View style={guideS.fbLeg} />
            <View style={guideS.fbLeg} />
          </View>
          <Text style={guideS.guideTextBottom}>
            Stand naturally{'\n'}head to toe
          </Text>
        </View>
      );

    default:
      return (
        <View
          style={guideS.container}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={guideS.freestyleText}>
            📸{'\n'}Show your{'\n'}personality!
          </Text>
        </View>
      );
  }
});

function makeGuideStyles(C: Theme) {
  return StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         10,
    },
    faceOval: {
      width:           160,
      height:          200,
      borderRadius:    100,
      borderWidth:     2,
      borderColor:     C.guideStroke,
      borderStyle:     'dashed',
      backgroundColor: C.guideFill,
      marginTop:       -60,
    },
    shoulderLine: {
      width:                 220,
      height:                40,
      borderTopLeftRadius:   60,
      borderTopRightRadius:  60,
      borderWidth:           2,
      borderBottomWidth:     0,
      borderColor:           C.guideStroke,
      borderStyle:           'dashed',
      marginTop:             -8,
    },
    guideText: {
      color:      C.guideStroke,
      fontSize:   FONT.base,
      textAlign:  'center',
      marginTop:  SPACING.xl,
      fontWeight: '600',
      lineHeight: 20,
    },
    ubHead: {
      width:           60,
      height:          70,
      borderRadius:    30,
      borderWidth:     2,
      borderColor:     C.guideStroke,
      borderStyle:     'dashed',
      backgroundColor: C.guideFill,
      marginTop:       -80,
    },
    ubNeck: {
      width:           20,
      height:          12,
      borderWidth:     2,
      borderTopWidth:  0,
      borderColor:     C.guideStroke,
      borderStyle:     'dashed',
      marginTop:       -2,
    },
    ubShoulders: {
      width:                220,
      height:               30,
      borderTopLeftRadius:  50,
      borderTopRightRadius: 50,
      borderWidth:          2,
      borderBottomWidth:    0,
      borderColor:          C.guideStroke,
      borderStyle:          'dashed',
      marginTop:            -2,
    },
    ubTorso: {
      width:                    140,
      height:                   120,
      borderWidth:              2,
      borderTopWidth:           0,
      borderColor:              C.guideStroke,
      borderStyle:              'dashed',
      backgroundColor:          C.guideFill,
      borderBottomLeftRadius:   RADIUS.sm,
      borderBottomRightRadius:  RADIUS.sm,
    },
    guideTextBottom: {
      color:      C.guideStroke,
      fontSize:   FONT.base,
      textAlign:  'center',
      marginTop:  SPACING.lg,
      fontWeight: '600',
      lineHeight: 20,
    },
    fbHead: {
      width:           36,
      height:          42,
      borderRadius:    18,
      borderWidth:     2,
      borderColor:     C.guideStroke,
      borderStyle:     'dashed',
      backgroundColor: C.guideFill,
      marginTop:       -40,
    },
    fbNeck: {
      width:          12,
      height:         8,
      borderWidth:    2,
      borderTopWidth: 0,
      borderColor:    C.guideStroke,
      borderStyle:    'dashed',
      marginTop:      -2,
    },
    fbTorso: {
      width:                 90,
      height:                80,
      borderTopLeftRadius:   30,
      borderTopRightRadius:  30,
      borderWidth:           2,
      borderColor:           C.guideStroke,
      borderStyle:           'dashed',
      backgroundColor:       C.guideFill,
      marginTop:             -2,
    },
    fbHips: {
      width:                      100,
      height:                     20,
      borderBottomLeftRadius:     RADIUS.sm,
      borderBottomRightRadius:    RADIUS.sm,
      borderWidth:                2,
      borderTopWidth:             0,
      borderColor:                C.guideStroke,
      borderStyle:                'dashed',
      marginTop:                  -2,
    },
    fbLegs: {
      flexDirection: 'row',
      gap:           12,
      marginTop:     -2,
    },
    fbLeg: {
      width:                    28,
      height:                   100,
      borderWidth:              2,
      borderTopWidth:           0,
      borderColor:              C.guideStroke,
      borderStyle:              'dashed',
      borderBottomLeftRadius:   RADIUS.sm,
      borderBottomRightRadius:  RADIUS.sm,
    },
    freestyleText: {
      color:      C.guideStroke,
      fontSize:   FONT.xxl,
      textAlign:  'center',
      fontWeight: '600',
      lineHeight: 32,
    },
  });
}

export default function ProfileSetupScreen() {
  const router                            = useRouter();
  const { width: screenWidth }            = useWindowDimensions();
  const [permission, requestPermission]   = useCameraPermissions();

  // ── Auth ────────────────────────────────────────────────
  const [userId,    setUserId]    = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUserId(u.uid);
        setUserEmail(u.email);
      } else {
        router.replace('/login' as any);
      }
    });
    return unsub;
  }, [router]);

  // ── Theme ───────────────────────────────────────────────
  // Keeping dark-only for camera/photo accuracy (bright UI affects camera preview)
  const C: Theme = DARK;

  // ── Form state ──────────────────────────────────────────
  const [form, dispatch] = useReducer(reducer, INIT);
  const set = useCallback(
    (f: keyof FormState, v: any) => dispatch({ type: 'SET', field: f, value: v }),
    [],
  );

  // ── Step ────────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // ── Loading flags ───────────────────────────────────────
  const [loading,    setLoading]    = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [capturing,  setCapturing]  = useState(false);
  const [gettingLoc, setGettingLoc] = useState(false);

  // ── Camera state ────────────────────────────────────────
  const [camOpen,   setCamOpen]   = useState(false);
  const [camReady,  setCamReady]  = useState(false);
  const [camErr,    setCamErr]    = useState<string | null>(null);
  const [camSlot,   setCamSlot]   = useState<PhotoSlotConfig | null>(null);
  const [camFacing, setCamFacing] = useState<'front' | 'back'>('front');

  // ── Timer state ─────────────────────────────────────────
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [countdown,    setCountdown]    = useState<number | null>(null);

  // ── Prompt picker ───────────────────────────────────────
  const [promptPicker, setPromptPicker] = useState<number | null>(null);

  // ── Upload progress ─────────────────────────────────────
  const [uploadProgress, setUploadProgress] = useState(0);

  // ── Refs ────────────────────────────────────────────────
  const isMountedRef    = useRef(true);
  const scrollRef       = useRef<ScrollView>(null);
  const cameraRef       = useRef<CameraView>(null);
  const streamRef       = useRef<any>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepTitleRef    = useRef<Text>(null);
  const isDirtyRef      = useRef(false);
  const videoCallbackRef = useRef<((node: any) => void) | null>(null);

  // ── Animation ───────────────────────────────────────────
  const fadeAnim  = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progAnim  = useRef(new Animated.Value(0)).current;

  // ── Mounted guard ───────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Cleanup on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      // Stop web camera stream if active
      if (streamRef.current) {
        streamRef.current.getTracks?.().forEach((t: any) => t.stop());
        streamRef.current = null;
      }
      // Clear any running countdown
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, []);

  // ── Draft key (per user) ────────────────────────────────
  const draftKey = useMemo(
    () => (userId ? `${DRAFT_KEY_PREFIX}${userId}` : null),
    [userId],
  );
  const stepKey = useMemo(
    () => (userId ? `${STEP_KEY_PREFIX}${userId}` : null),
    [userId],
  );

  // ── Restore draft on mount ──────────────────────────────
  useEffect(() => {
    if (!draftKey || !stepKey) return;
    (async () => {
      try {
        const [rawDraft, rawStep] = await Promise.all([
          AsyncStorage.getItem(draftKey),
          AsyncStorage.getItem(stepKey),
        ]);
        if (rawDraft) {
          const parsed = JSON.parse(rawDraft) as Partial<FormState>;
          // Never restore photos — local URIs invalid after restart
          delete parsed.photos;
          if (isMountedRef.current) {
            dispatch({ type: 'LOAD', state: parsed });
          }
        }
        if (rawStep) {
          const s = parseInt(rawStep);
          if (!isNaN(s) && s >= 1 && s <= TOTAL_STEPS && isMountedRef.current) {
            // Go back to step 1 since photos were cleared
            setStep(rawDraft ? Math.min(s, 1) : 1);
          }
        }
      } catch {
        // Silently ignore corrupt draft
      }
    })();
  }, [draftKey, stepKey]);

  // ── Auto-save draft (debounced, only when dirty) ────────
  useEffect(() => {
    isDirtyRef.current = true;
  }, [form]);

  useEffect(() => {
    if (!draftKey || !stepKey) return;
    const t = setTimeout(() => {
      if (!isDirtyRef.current) return;
      isDirtyRef.current = false;
      const { photos: _photos, ...rest } = form;
      AsyncStorage.setItem(draftKey, JSON.stringify(rest)).catch(() => {});
      AsyncStorage.setItem(stepKey, String(step)).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [form, step, draftKey, stepKey]);

  // ── Progress bar animation ──────────────────────────────
  useEffect(() => {
    Animated.timing(progAnim, {
      toValue:        step / TOTAL_STEPS,
      duration:       300,
      useNativeDriver: false, // width cannot use native driver
    }).start();
  }, [step, progAnim]);

  // ── Prompt picker bounds guard ──────────────────────────
  useEffect(() => {
    if (
      promptPicker !== null &&
      promptPicker >= form.prompts.length
    ) {
      setPromptPicker(null);
    }
  }, [form.prompts.length, promptPicker]);

  // ── Camera permission pre-request ──────────────────────
  useEffect(() => {
    if (!IS_WEB && !permission?.granted && !permission?.canAskAgain === false) {
      // Pre-warm permission dialog before user hits step 1
      Alert.alert(
        'Camera Required',
        'This app uses your camera to take profile photos. No gallery uploads are allowed to keep profiles authentic.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Grant Access', onPress: () => requestPermission() },
        ],
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accessibility: announce step change ─────────────────
  useEffect(() => {
    const name = STEP_NAMES[step - 1];
    AccessibilityInfo.announceForAccessibility(
      `Step ${step} of ${TOTAL_STEPS}: ${name}`,
    );
    // Move screen reader focus to step title
    if (stepTitleRef.current) {
      const node = findNodeHandle(stepTitleRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [step]);

  // ── Derived: birthday ───────────────────────────────────
  const birthday = useMemo<Date | null>(() => {
    const m = parseInt(form.bdayMonth);
    const d = parseInt(form.bdayDay);
    const y = parseInt(form.bdayYear);
    if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
    if (!isValidDate(y, m, d)) return null;
    return new Date(y, m - 1, d);
  }, [form.bdayMonth, form.bdayDay, form.bdayYear]);

  const age = useMemo<number | null>(
    () => (birthday ? calcAge(birthday) : null),
    [birthday],
  );

  const zodiac = useMemo<ZodiacResult | null>(
    () =>
      birthday
        ? getZodiac(birthday.getMonth() + 1, birthday.getDate())
        : null,
    [birthday],
  );

  // ── Derived: height ─────────────────────────────────────
  const hCm = useMemo<number>(() => {
    if (form.heightUnit === 'cm') return parseInt(form.heightCm) || 0;
    return ftToCm(parseInt(form.heightFt) || 0, parseInt(form.heightIn) || 0);
  }, [form.heightUnit, form.heightCm, form.heightFt, form.heightIn]);

  const hDisplay = useMemo<string>(() => {
    if (!hCm || hCm < MIN_H) return '';
    return form.heightUnit === 'cm'
      ? `${hCm} cm (${cmToFt(hCm)})`
      : `${form.heightFt}'${form.heightIn || 0}" (${hCm} cm)`;
  }, [hCm, form.heightUnit, form.heightFt, form.heightIn]);

  // ── Derived: photo flags ────────────────────────────────
  const hasFace      = useMemo(() => form.photos.some((p) => p.type === 'face'),       [form.photos]);
  const hasUpperBody = useMemo(() => form.photos.some((p) => p.type === 'upper_body'), [form.photos]);
  const hasFullBody  = useMemo(() => form.photos.some((p) => p.type === 'full_body'),  [form.photos]);
  const nextSlot     = useMemo(() => getNextPhotoSlot(form.photos),                    [form.photos]);

  // ── Derived: step validation ────────────────────────────
  const stepOk = useMemo<boolean>(() => {
    switch (step) {
      case 1: return hasFace && hasUpperBody;
      case 2: return (
        validateName(form.name).valid &&
        age !== null &&
        age >= MIN_AGE &&
        age <= MAX_AGE &&
        form.gender !== '' &&
        form.interestedIn !== '' &&
        hCm >= MIN_H &&
        hCm <= MAX_H
      );
      case 3: return form.bodyType !== '' && form.lookingForBody !== '';
      case 4: return (
        form.religion     !== '' &&
        form.lifestyle    !== '' &&
        form.relationship !== ''
      );
      case 5: return form.interests.length >= 3;
      case 6: return true;
      case 7: return true;
      case 8: return form.termsAccepted;
      default: return false;
    }
  }, [step, form, hasFace, hasUpperBody, age, hCm]);

  // ── Derived: profile completion % ──────────────────────
  const pct = useMemo<number>(() => {
    const checks = [
      hasFace,
      hasUpperBody,
      hasFullBody,
      form.photos.length >= 3,
      validateName(form.name).valid,
      age !== null && age >= MIN_AGE,
      form.gender         !== '',
      form.interestedIn   !== '',
      hCm >= MIN_H,
      form.bodyType       !== '',
      form.lookingForBody !== '',
      form.religion       !== '',
      form.lifestyle      !== '',
      form.relationship   !== '',
      form.interests.length >= 3,
      form.bio.trim().length > 0,
      form.locCity        !== '',
      form.education      !== '',
      form.smoking        !== '',
      form.drinking       !== '',
      form.children       !== '',
      form.prompts.length >= 1,
      form.vibes.length   >= 1,
      form.loveLang       !== '',
    ];
    return Math.round(
      (checks.filter(Boolean).length / checks.length) * 100,
    );
  }, [
    form, hasFace, hasUpperBody, hasFullBody, age, hCm,
  ]);

  // ── Haptic ──────────────────────────────────────────────
  const haptic = useCallback((
    style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
  ) => {
    if (!IS_WEB) Haptics.impactAsync(style).catch(() => {});
  }, []);

  const successHaptic = useCallback(() => {
    if (!IS_WEB) {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    }
  }, []);

  // ── Step animation ──────────────────────────────────────
  const animate = useCallback((dir: 'fwd' | 'back') => {
    const toVal = dir === 'fwd' ? -screenWidth : screenWidth;
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0, duration: 140, useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: toVal, duration: 140, useNativeDriver: true,
      }),
    ]).start(() => {
      slideAnim.setValue(dir === 'fwd' ? screenWidth : -screenWidth);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1, duration: 200, useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0, duration: 200, useNativeDriver: true,
        }),
      ]).start();
    });
  }, [fadeAnim, slideAnim, screenWidth]);

  // ── Step navigation ─────────────────────────────────────
  const goNext = useCallback(() => {
    if (!stepOk) {
      const msg = getMissingFieldsMessage(
        step, form, hasFace, hasUpperBody, age, hCm,
      );
      Alert.alert('Incomplete', msg);
      return;
    }
    if (step >= TOTAL_STEPS) return;

    // Validate age range in step 6 before advancing
    if (step === 6) {
      const minA = parseInt(form.ageMin) || MIN_AGE;
      const maxA = parseInt(form.ageMax) || 50;
      if (minA >= maxA) {
        Alert.alert('Invalid Age Range', 'Minimum age must be less than maximum age.');
        return;
      }
      const minH = parseInt(form.heightPrefMinCm) || 0;
      const maxH = parseInt(form.heightPrefMaxCm) || 0;
      if (minH > 0 && maxH > 0 && minH >= maxH) {
        Alert.alert('Invalid Height Range', 'Minimum height must be less than maximum height.');
        return;
      }
    }

    haptic();
    successHaptic();
    animate('fwd');
    setStep((s) => s + 1);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [step, stepOk, form, hasFace, hasUpperBody, age, hCm, haptic, successHaptic, animate]);

  const goBack = useCallback(() => {
    if (step <= 1) {
      Alert.alert('Leave Setup?', 'Your progress is auto-saved as a draft.', [
        { text: 'Stay',  style: 'cancel' },
        { text: 'Leave', onPress: () => router.back() },
      ]);
      return;
    }
    haptic();
    animate('back');
    setStep((s) => s - 1);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [step, haptic, animate, router]);

  // ── Camera handlers ─────────────────────────────────────

  const stopWebCam = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks?.().forEach((t: any) => t.stop());
      streamRef.current = null;
    }
    if (isMountedRef.current) setCamReady(false);
  }, []);

  const closeCam = useCallback(() => {
    stopWebCam();
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (isMountedRef.current) {
      setCamOpen(false);
      setCamErr(null);
      setCamSlot(null);
      setCountdown(null);
      setTimerEnabled(false);
      setCapturing(false);
    }
  }, [stopWebCam]);

  // Web video element ref callback — avoids fragile getElementById
  const videoRefCallback = useCallback((node: any) => {
    if (!node || !streamRef.current) return;
    node.srcObject = streamRef.current;
    node.onloadedmetadata = () => {
      node.play().catch(() => {});
      if (isMountedRef.current) setCamReady(true);
    };
  }, []);

  const openCamera = useCallback(async (slot?: PhotoSlotConfig) => {
    const targetSlot = slot ?? nextSlot;
    if (!targetSlot) {
      Alert.alert(
        'Maximum Photos',
        `You can add up to ${MAX_PHOTOS} photos.`,
      );
      return;
    }

    if (!IS_WEB) {
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          Alert.alert(
            'Camera Required',
            'Camera access is needed. Enable it in your device settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open Settings',
                onPress: () => Linking.openSettings(),
              },
            ],
          );
          return;
        }
      }
    }

    if (isMountedRef.current) {
      setCamSlot(targetSlot);
      setCamFacing(targetSlot.cameraSide);
      setTimerEnabled(false);
      setCountdown(null);
      setCamOpen(true);
      setCamErr(null);
      setCamReady(false);
      setCapturing(false);
    }

    if (IS_WEB) {
      setTimeout(async () => {
        try {
          if (!navigator.mediaDevices?.getUserMedia) {
            if (isMountedRef.current) {
              setCamErr('Camera not supported in this browser.');
            }
            return;
          }

          // Check how many cameras are available
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter((d) => d.kind === 'videoinput');
          const facingMode =
            targetSlot.cameraSide === 'front' ? 'user' : 'environment';

          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: videoDevices.length > 1 ? facingMode : undefined,
              width:  { ideal: 1280 },
              height: { ideal: 960 },
            },
            audio: false,
          });

          streamRef.current = stream;

          // videoRefCallback will wire up srcObject when the node mounts
          // Store it so JSX can reference it
          videoCallbackRef.current = videoRefCallback;

        } catch (err: unknown) {
          const name = err instanceof Error ? (err as any).name : '';
          const msg =
            name === 'NotAllowedError'
              ? 'Camera access blocked. Allow it in browser settings.'
              : name === 'NotFoundError'
              ? 'No camera found on this device.'
              : name === 'NotReadableError'
              ? 'Camera is in use by another app.'
              : 'Could not start camera. Try refreshing.';
          if (isMountedRef.current) setCamErr(msg);
        }
      }, 200);
    }
  }, [nextSlot, permission, requestPermission, videoRefCallback]);

  const flipCamera = useCallback(() => {
    setCamFacing((f) => (f === 'front' ? 'back' : 'front'));
    if (IS_WEB && streamRef.current) {
      // Re-open stream with flipped facing mode
      stopWebCam();
      setTimeout(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: camFacing === 'front' ? 'environment' : 'user',
              width:  { ideal: 1280 },
              height: { ideal: 960 },
            },
            audio: false,
          });
          streamRef.current = stream;
          if (videoCallbackRef.current) {
            const v = document.querySelector('#cam-preview') as any;
            if (v) videoCallbackRef.current(v);
          }
        } catch {
          if (isMountedRef.current) setCamErr('Could not flip camera.');
        }
      }, 100);
    }
  }, [camFacing, stopWebCam]);

  // ── Photo capture ────────────────────────────────────────

  const doCapture = useCallback(async () => {
    if (!camSlot || capturing) return;
    setCapturing(true);

    let uri: string | null = null;
    try {
      if (IS_WEB) {
        if (!camReady) return;
        const v = document.querySelector('#cam-preview') as HTMLVideoElement | null;
        if (!v || v.readyState < 2) return;

        const canvas = document.createElement('canvas');
        canvas.width  = v.videoWidth  || 1280;
        canvas.height = v.videoHeight || 960;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Mirror front camera capture
        if (camFacing === 'front') {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(v, -canvas.width, 0, canvas.width, canvas.height);
          ctx.restore();
        } else {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        }

        // Validate minimum resolution
        if (canvas.width < 400 || canvas.height < 400) {
          Alert.alert(
            'Photo Too Small',
            'Please use a higher quality camera or move to better lighting.',
          );
          return;
        }

        uri = canvas.toDataURL('image/jpeg', 0.88);
      } else {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({
          quality:             0.88,
          skipProcessing:      false,
        });
        uri = photo?.uri ?? null;
      }

      if (!uri) {
        Alert.alert('Capture Failed', 'Could not capture photo. Try again.');
        return;
      }

      closeCam();
      await processPhoto(uri, camSlot.type);

    } catch (err) {
      logger.error('doCapture failed:', err);
      Alert.alert('Error', 'Something went wrong capturing the photo.');
    } finally {
      if (isMountedRef.current) setCapturing(false);
    }
  }, [camSlot, capturing, camReady, camFacing, closeCam]);

  const handleCapture = useCallback(() => {
    if (capturing || countdown !== null) return;

    if (timerEnabled && camSlot?.timerAvailable) {
      setCountdown(TIMER_SECONDS);
      let count = TIMER_SECONDS;
      countdownRef.current = setInterval(() => {
        count--;
        if (count <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          if (isMountedRef.current) setCountdown(null);
          doCapture();
        } else {
          if (isMountedRef.current) setCountdown(count);
        }
      }, 1000);
    } else {
      doCapture();
    }
  }, [capturing, countdown, timerEnabled, camSlot, doCapture]);

  // ── Photo processing & upload ────────────────────────────

  const processPhoto = useCallback(async (uri: string, type: PhotoType) => {
    if (isMountedRef.current) {
      setUploading(true);
      setUploadProgress(0);
    }

    try {
      const upload: UploadResult = await uploadToCloudinary(
        uri,
        'profile_photo',
      );

      if (isMountedRef.current) setUploadProgress(50);

      if (!upload.success || !upload.url) {
        Alert.alert(
          'Upload Failed',
          upload.error ?? 'Could not upload photo. Check your connection.',
        );
        return;
      }

      // NSFW / moderation check
      if (upload.moderationStatus === 'rejected') {
        Alert.alert(
          'Photo Rejected',
          'This photo was flagged as inappropriate. Please use a different photo.',
        );
        return;
      }

      if (isMountedRef.current) setUploadProgress(75);

      // Full body detection
      if (type === 'full_body') {
        try {
          const body = await detectFullBodyPhoto(upload.url);
          if (!body.isFullBody) {
            Alert.alert(
              'Not Full Body',
              'We could not detect a full body. Try standing further from the camera with head to toe visible.',
              [{ text: 'OK' }],
            );
            // Don't reject — still allow the photo
          }
        } catch {
          // Detection unavailable — allow through
        }
      }

      // Age estimation from first face photo
      if (type === 'face' && !hasFace) {
        try {
          const ageResult: AgeEstimationResult | null =
            await estimateAgeFromPhoto(upload.url);
          if (ageResult?.estimatedAge && isMountedRef.current) {
            set('ageEstimate', ageResult.estimatedAge);
          }
        } catch {
          // Unavailable — allow through
        }
      }

      if (isMountedRef.current) setUploadProgress(100);

      const photo: ProfilePhoto = {
        uri,
        url:        upload.url,
        type,
        order:      form.photos.length,
        verified:   true,
        uploadedAt: new Date().toISOString(),
      };

      dispatch({ type: 'ADD_PHOTO', photo });
      successHaptic();

      // Contextual next-step hints
      const hints: string[] = [];
      if (type === 'face'       && !hasUpperBody) hints.push('upper body photo (required)');
      if (type === 'upper_body' && !hasFullBody)  hints.push('full body photo (+40% matches)');

      Alert.alert(
        '📸 Photo Added!',
        hints.length > 0
          ? `Great shot! Next up: ${hints.join(', ')}`
          : 'Looking good!',
      );

    } catch (err) {
      logger.error('processPhoto failed:', err);
      Alert.alert('Upload Error', 'Check your connection and try again.');
    } finally {
      if (isMountedRef.current) {
        setUploading(false);
        setUploadProgress(0);
      }
    }
  }, [form.photos.length, hasFace, hasUpperBody, hasFullBody, set, successHaptic]);

  const removePhoto = useCallback((index: number) => {
    const photo     = form.photos[index];
    const isRequired =
      photo.type === 'face' || photo.type === 'upper_body';

    Alert.alert(
      'Remove Photo',
      isRequired
        ? `Removing your ${getPhotoLabel(photo.type)} photo will make Step 1 incomplete. You will need to retake it before continuing.`
        : 'Remove this photo from your profile?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:    'Remove',
          style:   'destructive',
          onPress: () => {
            dispatch({ type: 'REMOVE_PHOTO', index });
            haptic();
          },
        },
      ],
    );
  }, [form.photos, haptic]);

  const movePhoto = useCallback((from: number, to: number) => {
    if (to < 0 || to >= form.photos.length) return;
    dispatch({ type: 'MOVE_PHOTO', from, to });
    haptic();
  }, [form.photos.length, haptic]);

  // ── Location ─────────────────────────────────────────────

  const getLoc = useCallback(async () => {
    Alert.alert(
      'Location Access',
      'We use your location to show you matches nearby. Your exact location is never shown to other users — only your city.',
      [
        { text: 'Not Now', style: 'cancel' },
        {
          text: 'Enable',
          onPress: async () => {
            if (isMountedRef.current) setGettingLoc(true);
            try {
              const loc = await requestLocationPermission();
              if (loc) {
                const display = loc.city
                  ? `${loc.city}, ${loc.country}`
                  : 'Location found';
                if (isMountedRef.current) {
                  set('locCity', display);
                  set('locData', loc);
                }
                await saveUserLocation(loc);
                Alert.alert('📍 Location Set', display);
              } else {
                Alert.alert(
                  'Location Error',
                  'Enable location services in your settings and try again.',
                );
              }
            } catch {
              Alert.alert('Location Error', 'Something went wrong.');
            } finally {
              if (isMountedRef.current) setGettingLoc(false);
            }
          },
        },
      ],
    );
  }, [set]);

  // ── Height unit switch (preserves value) ─────────────────

  const switchHeightUnit = useCallback(() => {
    const { newFt, newIn, newCm } = convertHeightForUnitSwitch(
      form.heightUnit,
      form.heightCm,
      form.heightFt,
      form.heightIn,
    );
    const next: HeightUnit = form.heightUnit === 'cm' ? 'ft' : 'cm';
    dispatch({ type: 'SET', field: 'heightUnit', value: next });
    dispatch({ type: 'SET', field: 'heightFt',   value: newFt });
    dispatch({ type: 'SET', field: 'heightIn',   value: newIn });
    dispatch({ type: 'SET', field: 'heightCm',   value: newCm });
  }, [form.heightUnit, form.heightCm, form.heightFt, form.heightIn]);

  // ── Save ──────────────────────────────────────────────────

  const doSave = useCallback(async () => {
    if (!userId || !birthday || !age) return;
    if (isMountedRef.current) setLoading(true);

    try {
      const ageDiff = form.ageEstimate
        ? Math.abs(age - form.ageEstimate)
        : 999;

      const profileData = {
        uid:          userId,
        email:        userEmail,
        name:         formatName(form.name),
        age,
        birthday:     birthday.toISOString(),
        zodiacSign:   zodiac?.sign  ?? null,
        zodiacEmoji:  zodiac?.emoji ?? null,
        gender:       form.gender,
        interestedIn: form.interestedIn,
        pronouns:     form.pronouns || null,
        height: {
          value:              hCm,
          unit:               form.heightUnit,
          displayText:        hDisplay,
          verificationMethod: 'self-reported',
          verifiedAt:         new Date().toISOString(),
        },
        bodyType:         form.bodyType,
        lookingFor:       form.lookingForBody,
        religiousViews:   form.religion,
        lifestyle:        form.lifestyle,
        relationshipGoal: form.relationship,
        education:        form.education  || null,
        occupation:       form.occupation.trim() || null,
        smoking:          form.smoking    || null,
        drinking:         form.drinking   || null,
        children:         form.children   || null,
        pets:             form.pets       || null,
        diet:             form.diet       || null,
        politicalViews:   form.politics   || null,
        interests:        form.interests,
        loveLanguage:     form.loveLang   || null,
        communicationStyle:   form.commStyle  || null,
        preferredFirstDate:   form.firstDate  || null,
        vibes:            form.vibes,
        preferences: {
          ageRange: {
            min: parseInt(form.ageMin) || MIN_AGE,
            max: parseInt(form.ageMax) || 50,
          },
          maxDistanceKm:   parseInt(form.distKm) || 50,
          heightRangeCm: {
            min: parseInt(form.heightPrefMinCm) || null,
            max: parseInt(form.heightPrefMaxCm) || null,
          },
          dealbreakers:    form.dealbreakers,
          importantFields: form.importantFields,
        },
        bio:            form.bio.trim(),
        promptAnswers:  form.prompts
          .filter((p) => p.a.trim())
          .map((p) => ({ question: p.q, answer: p.a.trim() })),

        // Photos
        photos:    form.photos.map((p) => p.url),
        photoData: form.photos.map((p) => ({
          url:        p.url,
          type:       p.type,
          order:      p.order,
          verified:   p.verified,
          uploadedAt: p.uploadedAt,
        })),
        hasFullBodyPhoto: hasFullBody,

        // Privacy
        privacy: {
          blurUntilMatch:     form.blurUntilMatch,
          incognitoMode:      form.incognito,
          verifiedUsersOnly:  form.verifiedOnly,
        },

        // Location
        location:     form.locData || null,
        locationCity: form.locCity || null,

        // Age verification
        ageVerification: {
          verified:     form.ageEstimate ? ageDiff <= 5 : false,
          method:       form.ageEstimate ? 'ai-estimated' : 'self-reported',
          estimatedAge: form.ageEstimate ?? null,
          statedAge:    age,
          ageDifference:form.ageEstimate ? ageDiff : null,
          confidence:   form.ageEstimate
            ? (ageDiff <= 3 ? 85 : ageDiff <= 5 ? 70 : 50)
            : 0,
          verifiedAt:   new Date().toISOString(),
        },

        // System fields
        createdAt:          new Date().toISOString(),
        updatedAt:          new Date().toISOString(),
        profileComplete:    true,
        photoVerified:      true,
        selfieVerified:     false,
        isVisible:          true,
        termsAcceptedAt:    new Date().toISOString(),

        // Defaults
        ratings: {
          totalRatings:           0,
          averagePhotosMatch:     0,
          heightAccuracyRate:     0,
          bodyTypeAccuracyRate:   0,
          ageAccuracyRate:        0,
          averagePersonalityMatch:0,
          averageOverall:         0,
          trustScore:             0,
        },
        personalityType:    null,
        icebreakers:        [],
        achievements:       [],
        achievementPoints:  0,
        loginStreak:        1,
        lastLoginDate:      new Date().toISOString().split('T')[0],
        matchCount:         0,
        profileViews:       0,
        referralCount:      0,
      };

      await setDoc(doc(db, 'users', userId), profileData, { merge: false });

      // Clear draft
      if (draftKey) AsyncStorage.removeItem(draftKey).catch(() => {});
      if (stepKey)  AsyncStorage.removeItem(stepKey).catch(() => {});

      // Reset form
      dispatch({ type: 'RESET' });

      Alert.alert(
        '🎉 Profile Created!',
        "Next up: discover your personality type to improve your matches!",
        [
          {
            text: 'Continue',
            onPress: () => router.replace('/personality-quiz' as any),
          },
        ],
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('doSave failed:', msg);
      Alert.alert('Save Error', `Could not save your profile: ${msg}`);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [
    userId, userEmail, birthday, age, zodiac, form,
    hCm, hDisplay, hasFullBody, draftKey, stepKey, router,
  ]);

  const handleSave = useCallback(async () => {
    if (!userId) { router.replace('/login' as any); return; }
    if (!form.termsAccepted) {
      Alert.alert('Terms Required', 'Please accept the Terms of Service.');
      return;
    }
    if (!birthday || !age) {
      Alert.alert('Invalid Birthday', 'Please enter a valid date of birth.');
      return;
    }

    // Content moderation
    if (form.bio.trim()) {
      const bioBlock = checkBlocked(form.bio);
      if (bioBlock) { Alert.alert('Bio Issue', bioBlock); return; }
    }
    for (const p of form.prompts) {
      if (p.a.trim()) {
        const promptBlock = checkBlocked(p.a);
        if (promptBlock) { Alert.alert('Prompt Issue', promptBlock); return; }
      }
    }

    // Age vs AI estimate check
    if (
      form.ageEstimate &&
      Math.abs(age - form.ageEstimate) > AGE_TOL
    ) {
      Alert.alert(
        'Age Verification',
        `Your photos suggest you may be around ${form.ageEstimate} years old, but your birthday says ${age}. Would you like to continue?`,
        [
          { text: 'Go Back',  style: 'cancel' },
          { text: 'Continue', onPress: doSave },
        ],
      );
      return;
    }

    // Full body nudge
    if (!hasFullBody && form.photos.length > 0) {
      Alert.alert(
        'No Full-Body Photo',
        'Profiles with a full-body photo get significantly more matches. Add one now?',
        [
          {
            text:    'Add Photo',
            style:   'cancel',
            onPress: () => {
              setStep(1);
              openCamera(PHOTO_SLOTS[2]);
            },
          },
          { text: 'Continue Anyway', onPress: doSave },
        ],
      );
      return;
    }

    doSave();
  }, [
    userId, form, birthday, age, hasFullBody,
    router, doSave, openCamera,
  ]);

  // ── Render helpers ────────────────────────────────────────

  const renderChip = useCallback((
    value:     string,
    selected:  boolean,
    onPress:   () => void,
    icon?:     string,
    disabled?: boolean,
  ) => (
    <TouchableOpacity
      key={value}
      style={[
        st.chip,
        selected  && st.chipOn,
        disabled  && st.chipOff,
        { borderColor: selected ? C.accent : C.none },
      ]}
      onPress={() => { haptic(); onPress(); }}
      disabled={disabled || loading || uploading}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${value.replace(/^\S+\s/, '')}, ${selected ? 'selected' : 'not selected'}`}
    >
      {icon != null && (
        <Text style={st.chipIcon} accessibilityElementsHidden>
          {icon}
        </Text>
      )}
      <Text
        style={[st.chipText, selected && { color: C.accent, fontWeight: '600' }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {value.replace(/^\S+\s/, '')}
      </Text>
      {selected && (
        <Text style={[st.chipCheck, { color: C.accent }]}>✓</Text>
      )}
    </TouchableOpacity>
  ), [haptic, loading, uploading, C]);

  const renderOpt = useCallback((
    opt:   OptionItem,
    sel:   string,
    onSel: (v: string) => void,
  ) => (
    <TouchableOpacity
      key={opt.value}
      style={[
        st.optRow,
        { backgroundColor: C.input },
        sel === opt.value && { borderColor: C.accent },
      ]}
      onPress={() => { haptic(); onSel(opt.value); }}
      disabled={loading || uploading}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected: sel === opt.value }}
      accessibilityLabel={`${opt.value}${opt.desc ? `, ${opt.desc}` : ''}, ${sel === opt.value ? 'selected' : 'not selected'}`}
    >
      <View style={st.optHead}>
        {opt.icon != null && (
          <Text style={st.optIcon} accessibilityElementsHidden>
            {opt.icon}
          </Text>
        )}
        <Text
          style={[
            st.optText,
            { color: sel === opt.value ? C.accent : C.text },
          ]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {opt.value}
        </Text>
        {sel === opt.value && (
          <Text style={[st.optCheck, { color: C.accent }]}>✓</Text>
        )}
      </View>
      {opt.desc != null && opt.desc !== '' && (
        <Text
          style={[st.optDesc, { color: C.muted }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {opt.desc}
        </Text>
      )}
    </TouchableOpacity>
  ), [haptic, loading, uploading, C]);

    // ── Step 1: Photos ────────────────────────────────────────

  const renderStep1 = () => (
    <View>
      <Text
        ref={stepTitleRef}
        style={[st.title, { color: C.accent }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        📸 Your Photos
      </Text>
      <Text
        style={[st.sub, { color: C.muted }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        Camera only — real photos, real you. No filters, no imports.
      </Text>

      {/* Required slot status */}
      <View
        style={st.slotStatus}
        accessibilityRole="list"
        accessibilityLabel="Photo requirements"
      >
        {PHOTO_SLOTS.filter((s) => s.required).map((slot) => {
          const done = form.photos.some((p) => p.type === slot.type);
          return (
            <View
              key={slot.type}
              style={[
                st.statusItem,
                { backgroundColor: C.input },
                done && { borderColor: C.success },
              ]}
              accessibilityLabel={`${slot.label}: ${done ? 'complete' : 'required'}`}
            >
              <Text style={st.statusIcon} accessibilityElementsHidden>
                {done ? '✓' : slot.icon}
              </Text>
              <Text
                style={[
                  st.statusText,
                  { color: done ? C.success : C.muted },
                ]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {slot.label} *
              </Text>
            </View>
          );
        })}
        <View
          style={[
            st.statusItem,
            { backgroundColor: C.input },
            hasFullBody && { borderColor: C.success },
          ]}
          accessibilityLabel={`Full body photo: ${hasFullBody ? 'complete' : 'optional but recommended'}`}
        >
          <Text style={st.statusIcon} accessibilityElementsHidden>
            {hasFullBody ? '✓' : '🧍'}
          </Text>
          <Text
            style={[
              st.statusText,
              { color: hasFullBody ? C.success : C.muted },
            ]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            Full Body
          </Text>
        </View>
      </View>

      {/* Upload progress */}
      {uploading && (
        <View style={[st.loadRow, { backgroundColor: C.input }]}>
          <ActivityIndicator size="small" color={C.accent} />
          <View style={{ flex: 1, marginLeft: SPACING.md }}>
            <Text
              style={[st.loadRowText, { color: C.accent }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              Uploading & verifying… {uploadProgress}%
            </Text>
            <View style={[st.uploadBarBg, { backgroundColor: C.border }]}>
              <View
                style={[
                  st.uploadBarFill,
                  {
                    width: `${uploadProgress}%` as any,
                    backgroundColor: C.accent,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      )}

      {/* Photo grid */}
      <View style={st.photoGrid}>
        {form.photos.map((p, i) => (
          <View
            key={`ph_${i}`}
            style={st.photoSlot}
            accessibilityLabel={`Photo ${i + 1}: ${getPhotoLabel(p.type)}`}
          >
            <Image
              source={{ uri: p.uri }}
              style={[st.photoImg, { borderColor: C.input }]}
              contentFit="cover"
              transition={150}
              accessibilityLabel={`${getPhotoLabel(p.type)} photo`}
            />

            {/* Type tag */}
            <View style={st.photoTypeTag}>
              <Text
                style={st.photoTypeText}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {getPhotoLabel(p.type)}
              </Text>
            </View>

            {/* Main badge */}
            {i === 0 && (
              <View style={[st.mainTag, { backgroundColor: C.accent }]}>
                <Text
                  style={[st.mainTagText, { color: C.white }]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  Main
                </Text>
              </View>
            )}

            {/* Verified dot */}
            <View
              style={[st.okDot, { backgroundColor: C.success }]}
              accessibilityLabel="Photo verified"
            >
              <Text style={[st.okDotText, { color: C.white }]}>✓</Text>
            </View>

            {/* Reorder buttons */}
            <View style={st.moveRow}>
              {i > 0 && (
                <TouchableOpacity
                  style={[st.moveBtn, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
                  onPress={() => movePhoto(i, i - 1)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Move photo left"
                >
                  <Text style={[st.moveBtnText, { color: C.white }]}>←</Text>
                </TouchableOpacity>
              )}
              {i < form.photos.length - 1 && (
                <TouchableOpacity
                  style={[st.moveBtn, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
                  onPress={() => movePhoto(i, i + 1)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Move photo right"
                >
                  <Text style={[st.moveBtnText, { color: C.white }]}>→</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Remove button */}
            <TouchableOpacity
              style={[st.rmBtn, { backgroundColor: C.danger, borderColor: C.card }]}
              onPress={() => removePhoto(i)}
              disabled={uploading || loading}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${getPhotoLabel(p.type)} photo`}
            >
              <Text style={[st.rmBtnText, { color: C.white }]}>×</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* Add photo button */}
        {nextSlot && (
          <TouchableOpacity
            style={[
              st.addBtn,
              { borderColor: C.accent, backgroundColor: C.guideFill },
              (uploading || loading) && st.addBtnOff,
            ]}
            onPress={() => openCamera()}
            disabled={uploading || loading}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Add ${nextSlot.label} photo${nextSlot.required ? ', required' : ''}`}
            accessibilityHint="Opens camera"
          >
            <Text style={st.addBtnIcon} accessibilityElementsHidden>
              {nextSlot.icon}
            </Text>
            <Text
              style={[st.addBtnLabel, { color: C.accent }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {nextSlot.label}
            </Text>
            {nextSlot.required && (
              <Text
                style={[st.addBtnReq, { color: C.warning }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                Required
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Full body nudge */}
      {!hasFullBody && hasFace && hasUpperBody && (
        <TouchableOpacity
          style={[st.tipBox, { backgroundColor: 'rgba(230,126,34,0.15)', borderColor: C.warning }]}
          onPress={() => openCamera(PHOTO_SLOTS[2])}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Add a full body photo for 40 percent more matches"
        >
          <Text
            style={[st.tipText, { color: C.warning }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            💡 Add a full-body photo for 40% more matches! Tap here.
          </Text>
        </TouchableOpacity>
      )}

      {/* Social proof */}
      {form.photos.length === 0 && (
        <View style={[st.socialProof, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text
            style={[st.socialProofText, { color: C.sub }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            📊 Profiles with 4+ photos receive 2× more matches on average.
          </Text>
        </View>
      )}

      <Text
        style={[st.photoHint, { color: C.muted }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        📌 First photo = profile photo shown in discover feed.{'\n'}
        All photos are shown when someone views your full profile.{'\n'}
        Tips: Good lighting · Face visible · Show variety.
      </Text>
    </View>
  );

  // ── Step 2: Basics ────────────────────────────────────────

  const renderStep2 = () => (
    <View>
      <Text
        ref={stepTitleRef}
        style={[st.title, { color: C.accent }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        👤 Basic Info
      </Text>

      {/* Name */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          First Name <Text style={{ color: C.danger }}>*</Text>
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Shown publicly as "Sarah, 28"
        </Text>
        <TextInput
          style={[
            st.input,
            { backgroundColor: C.input, color: C.text },
            form.name.length > 0 && !validateName(form.name).valid && { borderColor: C.danger },
            validateName(form.name).valid && { borderColor: C.success },
          ]}
          placeholder="Sarah"
          placeholderTextColor={C.dim}
          value={form.name}
          onChangeText={(t) => set('name', t.replace(/[^a-zA-Z\s\-']/g, ''))}
          onBlur={() => { if (form.name) set('name', formatName(form.name)); }}
          editable={!loading}
          maxLength={MAX_NAME}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          accessibilityLabel="First name"
          accessibilityHint="Enter your first name, letters only"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        />
        {form.name.length > 0 && !validateName(form.name).valid && (
          <Text
            style={[st.err, { color: C.danger }]}
            accessibilityRole="alert"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {validateName(form.name).reason}
          </Text>
        )}
      </View>

      {/* Date of Birth */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Date of Birth <Text style={{ color: C.danger }}>*</Text>
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          We calculate your age and zodiac automatically
        </Text>
        <View style={st.bdayRow}>
          <TextInput
            style={[st.input, st.bdayIn, { backgroundColor: C.input, color: C.text }]}
            placeholder="MM"
            placeholderTextColor={C.dim}
            value={form.bdayMonth}
            onChangeText={(t) => set('bdayMonth', t.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad"
            maxLength={2}
            editable={!loading}
            accessibilityLabel="Birth month"
            accessibilityHint="Two digit month"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
          <Text style={[st.bdaySep, { color: C.muted }]}>/</Text>
          <TextInput
            style={[st.input, st.bdayIn, { backgroundColor: C.input, color: C.text }]}
            placeholder="DD"
            placeholderTextColor={C.dim}
            value={form.bdayDay}
            onChangeText={(t) => set('bdayDay', t.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad"
            maxLength={2}
            editable={!loading}
            accessibilityLabel="Birth day"
            accessibilityHint="Two digit day"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
          <Text style={[st.bdaySep, { color: C.muted }]}>/</Text>
          <TextInput
            style={[st.input, st.bdayInY, { backgroundColor: C.input, color: C.text }]}
            placeholder="YYYY"
            placeholderTextColor={C.dim}
            value={form.bdayYear}
            onChangeText={(t) => set('bdayYear', t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            editable={!loading}
            accessibilityLabel="Birth year"
            accessibilityHint="Four digit year"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
        </View>
        {birthday && age !== null && (
          <View style={st.ageRow}>
            <Text
              style={[
                st.ageDisplay,
                { color: age >= MIN_AGE && age <= MAX_AGE ? C.success : C.danger },
              ]}
              accessibilityLabel={`Age: ${age}${age < MIN_AGE ? ', must be 18 or older' : ''}`}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              Age: {age}{' '}
              {age < MIN_AGE
                ? '(Must be 18+)'
                : age > MAX_AGE
                ? '(Invalid)'
                : '✓'}
            </Text>
            {zodiac && (
              <Text
                style={[st.zodiac, { color: C.accent }]}
                accessibilityLabel={`Zodiac: ${zodiac.sign}`}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {zodiac.emoji} {zodiac.sign}
              </Text>
            )}
          </View>
        )}
        {form.ageEstimate != null &&
          age != null &&
          Math.abs(age - form.ageEstimate) > AGE_TOL && (
            <Text
              style={[st.warn, { color: C.warning }]}
              accessibilityRole="alert"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              ⚠️ Your photos suggest approximately {form.ageEstimate} years old
            </Text>
          )}
      </View>

      {/* Gender */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Gender <Text style={{ color: C.danger }}>*</Text>
        </Text>
        <View style={st.chipWrap}>
          {GENDER_OPTIONS.map((g) =>
            renderChip(
              g.value,
              form.gender === g.value,
              () => set('gender', g.value),
              g.icon,
            ),
          )}
        </View>
      </View>

      {/* Interested In */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Interested In <Text style={{ color: C.danger }}>*</Text>
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Used for matching — not shown publicly
        </Text>
        <View style={st.chipWrap}>
          {INTERESTED_IN_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.interestedIn === o.value,
              () => set('interestedIn', o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      {/* Pronouns */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Pronouns
        </Text>
        <View style={st.chipWrap}>
          {PRONOUN_OPTIONS.map((p) =>
            renderChip(
              p.value,
              form.pronouns === p.value,
              () => set('pronouns', form.pronouns === p.value ? '' : p.value),
            ),
          )}
        </View>
      </View>

      {/* Height */}
      <View style={st.fg}>
        <View style={st.labelRow}>
          <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Height <Text style={{ color: C.danger }}>*</Text>
          </Text>
          <TouchableOpacity
            style={[st.unitBtn, { backgroundColor: C.input }]}
            onPress={switchHeightUnit}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${form.heightUnit === 'cm' ? 'feet and inches' : 'centimetres'}`}
          >
            <Text
              style={[st.unitBtnText, { color: C.accent }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {form.heightUnit === 'cm' ? 'Switch to ft/in' : 'Switch to cm'}
            </Text>
          </TouchableOpacity>
        </View>

        {form.heightUnit === 'cm' ? (
          <TextInput
            style={[
              st.input,
              { backgroundColor: C.input, color: C.text },
              form.heightCm.length > 0 &&
                (hCm < MIN_H || hCm > MAX_H) && { borderColor: C.danger },
              hCm >= MIN_H && hCm <= MAX_H && { borderColor: C.success },
            ]}
            placeholder="170"
            placeholderTextColor={C.dim}
            value={form.heightCm}
            onChangeText={(t) => set('heightCm', t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={3}
            editable={!loading}
            accessibilityLabel="Height in centimetres"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
        ) : (
          <View style={st.ftRow}>
            <TextInput
              style={[st.input, st.ftIn, { backgroundColor: C.input, color: C.text }]}
              placeholder="5"
              placeholderTextColor={C.dim}
              value={form.heightFt}
              onChangeText={(t) => set('heightFt', t.replace(/\D/g, ''))}
              keyboardType="number-pad"
              maxLength={1}
              editable={!loading}
              accessibilityLabel="Feet"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            />
            <Text style={[st.ftLbl, { color: C.muted }]}>ft</Text>
            <TextInput
              style={[st.input, st.ftIn, { backgroundColor: C.input, color: C.text }]}
              placeholder="8"
              placeholderTextColor={C.dim}
              value={form.heightIn}
              onChangeText={(t) => {
                const val = parseInt(t.replace(/\D/g, '')) || 0;
                if (val >= 12) {
                  Alert.alert('Invalid', 'Inches must be 0–11.');
                  return;
                }
                set('heightIn', t.replace(/\D/g, ''));
              }}
              keyboardType="number-pad"
              maxLength={2}
              editable={!loading}
              accessibilityLabel="Inches"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            />
            <Text style={[st.ftLbl, { color: C.muted }]}>in</Text>
          </View>
        )}
        {hDisplay !== '' && (
          <Text
            style={[st.hPreview, { color: C.success }]}
            accessibilityLabel={`Height: ${hDisplay}`}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            📏 {hDisplay}
          </Text>
        )}
      </View>
    </View>
  );

  // ── Step 3: Body & Appearance ─────────────────────────────

  const renderStep3 = () => (
    <View>
      <Text
        ref={stepTitleRef}
        style={[st.title, { color: C.accent }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        💪 Body & Appearance
      </Text>
      <BodyTypeSelector
        label="Your Body Type *"
        selectedType={form.bodyType as any}
        onSelect={(v) => set('bodyType', v)}
        disabled={loading}
      />
      <View style={st.spacer} />
      <BodyTypeSelector
        label="Body Type Preference *"
        selectedType={form.lookingForBody as any}
        onSelect={(v) => set('lookingForBody', v)}
        disabled={loading}
        showLookingFor
      />
    </View>
  );

  // ── Step 4: Lifestyle & Values ────────────────────────────

  const renderStep4 = () => (
    <View>
      <Text
        ref={stepTitleRef}
        style={[st.title, { color: C.accent }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        🌟 Lifestyle & Values
      </Text>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Religious Views <Text style={{ color: C.danger }}>*</Text>
        </Text>
        {RELIGIOUS_OPTIONS.map((o) =>
          renderOpt(o, form.religion, (v) => set('religion', v)),
        )}
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Lifestyle <Text style={{ color: C.danger }}>*</Text>
        </Text>
        <View style={st.chipWrap}>
          {LIFESTYLE_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.lifestyle === o.value,
              () => set('lifestyle', o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Relationship Goal <Text style={{ color: C.danger }}>*</Text>
        </Text>
        {RELATIONSHIP_OPTIONS.map((o) =>
          renderOpt(o, form.relationship, (v) => set('relationship', v)),
        )}
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Education
        </Text>
        <View style={st.chipWrap}>
          {EDUCATION_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.education === o.value,
              () => set('education', form.education === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Occupation
        </Text>
        <TextInput
          style={[st.input, { backgroundColor: C.input, color: C.text }]}
          placeholder="Software Engineer, Teacher…"
          placeholderTextColor={C.dim}
          value={form.occupation}
          onChangeText={(t) => set('occupation', t)}
          editable={!loading}
          maxLength={50}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
          accessibilityLabel="Occupation"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        />
        <Text
          style={[st.charCt, { color: form.occupation.length >= 45 ? C.warning : C.dim }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {form.occupation.length}/50
        </Text>
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Smoking
        </Text>
        <View style={st.chipWrap}>
          {SMOKING_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.smoking === o.value,
              () => set('smoking', form.smoking === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Drinking
        </Text>
        <View style={st.chipWrap}>
          {DRINKING_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.drinking === o.value,
              () => set('drinking', form.drinking === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Children
        </Text>
        <View style={st.chipWrap}>
          {CHILDREN_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.children === o.value,
              () => set('children', form.children === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Pets
        </Text>
        <View style={st.chipWrap}>
          {PET_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.pets === o.value,
              () => set('pets', form.pets === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Diet
        </Text>
        <View style={st.chipWrap}>
          {DIET_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.diet === o.value,
              () => set('diet', form.diet === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Political Views
        </Text>
        <View style={st.chipWrap}>
          {POLITICAL_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.politics === o.value,
              () => set('politics', form.politics === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>
    </View>
  );

    // ── Step 5: Interests & Personality ──────────────────────

  const renderStep5 = () => (
    <View>
      <Text
        ref={stepTitleRef}
        style={[st.title, { color: C.accent }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        ✨ Interests & Personality
      </Text>

      {/* Interests */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Interests <Text style={{ color: C.danger }}>*</Text>
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Pick 3–10 · {form.interests.length}/10 selected
        </Text>
        <View style={st.chipWrap}>
          {INTEREST_TAGS.map((t) =>
            renderChip(
              t,
              form.interests.includes(t),
              () =>
                dispatch({
                  type:  'TOGGLE_LIST',
                  field: 'interests',
                  value: t,
                  max:   10,
                }),
              undefined,
              !form.interests.includes(t) && form.interests.length >= 10,
            ),
          )}
        </View>
      </View>

      {/* Love Language */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Love Language
        </Text>
        {LOVE_LANGUAGE_OPTIONS.map((o) =>
          renderOpt(
            o,
            form.loveLang,
            (v) => set('loveLang', form.loveLang === v ? '' : v),
          ),
        )}
      </View>

      {/* Communication Style */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Communication Style
        </Text>
        <View style={st.chipWrap}>
          {COMMUNICATION_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.commStyle === o.value,
              () => set('commStyle', form.commStyle === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      {/* Preferred First Date */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Preferred First Date
        </Text>
        <View style={st.chipWrap}>
          {FIRST_DATE_OPTIONS.map((o) =>
            renderChip(
              o.value,
              form.firstDate === o.value,
              () => set('firstDate', form.firstDate === o.value ? '' : o.value),
              o.icon,
            ),
          )}
        </View>
      </View>

      {/* Vibes */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Your Vibes
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Pick up to 3 emojis that describe your energy
        </Text>
        <View style={st.vibeGrid}>
          {VIBE_EMOJIS.map((e, idx) => {
            const selected  = form.vibes.includes(e);
            const maxed     = !selected && form.vibes.length >= 3;
            return (
              <TouchableOpacity
                key={`vibe_${idx}`}
                style={[
                  st.vibeItem,
                  { backgroundColor: C.input },
                  selected && { borderColor: C.accent, backgroundColor: C.card },
                  maxed    && st.chipOff,
                ]}
                onPress={() => {
                  haptic();
                  dispatch({
                    type:  'TOGGLE_LIST',
                    field: 'vibes',
                    value: e,
                    max:   3,
                  });
                }}
                disabled={maxed}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Vibe ${e}, ${selected ? 'selected' : 'not selected'}`}
              >
                <Text style={st.vibeEmoji}>{e}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  // ── Step 6: Preferences & Deal-breakers ──────────────────

  const renderStep6 = () => (
    <View>
      <Text
        ref={stepTitleRef}
        style={[st.title, { color: C.accent }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        🎯 Preferences & Deal-breakers
      </Text>

      {/* Age range */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Age Range
        </Text>
        <View style={st.rangeRow}>
          <TextInput
            style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text }]}
            placeholder="18"
            placeholderTextColor={C.dim}
            value={form.ageMin}
            onChangeText={(t) => set('ageMin', t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={2}
            editable={!loading}
            accessibilityLabel="Minimum age preference"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
          <Text style={[st.rangeDash, { color: C.muted }]}>—</Text>
          <TextInput
            style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text }]}
            placeholder="50"
            placeholderTextColor={C.dim}
            value={form.ageMax}
            onChangeText={(t) => set('ageMax', t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={2}
            editable={!loading}
            accessibilityLabel="Maximum age preference"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
          <Text style={[st.rangeU, { color: C.muted }]}>years</Text>
        </View>
      </View>

      {/* Max distance */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Maximum Distance
        </Text>
        <View style={st.rangeRow}>
          <TextInput
            style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text }]}
            placeholder="50"
            placeholderTextColor={C.dim}
            value={form.distKm}
            onChangeText={(t) => set('distKm', t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={4}
            editable={!loading}
            accessibilityLabel="Maximum distance in kilometres"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
          <Text style={[st.rangeU, { color: C.muted }]}>km</Text>
        </View>
      </View>

      {/* Height preference */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Height Preference (cm)
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Optional — leave blank to see all heights
        </Text>
        <View style={st.rangeRow}>
          <TextInput
            style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text }]}
            placeholder="150"
            placeholderTextColor={C.dim}
            value={form.heightPrefMinCm}
            onChangeText={(t) => set('heightPrefMinCm', t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={3}
            editable={!loading}
            accessibilityLabel="Minimum preferred height in centimetres"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
          <Text style={[st.rangeDash, { color: C.muted }]}>—</Text>
          <TextInput
            style={[st.input, st.rangeIn, { backgroundColor: C.input, color: C.text }]}
            placeholder="200"
            placeholderTextColor={C.dim}
            value={form.heightPrefMaxCm}
            onChangeText={(t) => set('heightPrefMaxCm', t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={3}
            editable={!loading}
            accessibilityLabel="Maximum preferred height in centimetres"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          />
          <Text style={[st.rangeU, { color: C.muted }]}>cm</Text>
        </View>
      </View>

      {/* Deal-breakers */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Deal-breakers
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Up to 5 · {form.dealbreakers.length}/5
        </Text>
        <View style={st.chipWrap}>
          {DEALBREAKER_TAGS.map((t) =>
            renderChip(
              t,
              form.dealbreakers.includes(t),
              () =>
                dispatch({
                  type:  'TOGGLE_LIST',
                  field: 'dealbreakers',
                  value: t,
                  max:   5,
                }),
              undefined,
              !form.dealbreakers.includes(t) && form.dealbreakers.length >= 5,
            ),
          )}
        </View>
      </View>

      {/* What matters most */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          What matters most to you?
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Helps our matching algorithm prioritise your preferences
        </Text>
        <View style={st.chipWrap}>
          {IMPORTANT_FIELD_OPTIONS.map((f) =>
            renderChip(
              f,
              form.importantFields.includes(f),
              () =>
                dispatch({
                  type:  'TOGGLE_LIST',
                  field: 'importantFields',
                  value: f,
                }),
            ),
          )}
        </View>
      </View>
    </View>
  );

  // ── Step 7: About You ─────────────────────────────────────

  const renderStep7 = () => (
    <View>
      <Text
        ref={stepTitleRef}
        style={[st.title, { color: C.accent }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        💬 About You
      </Text>

      {/* Bio */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Bio
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          No contact info or social handles allowed
        </Text>
        {form.bio.length === 0 && (
          <TouchableOpacity
            onPress={() =>
              set('bio', "I'm a curious soul who loves exploring new places and good conversations over coffee. ☕")
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Use example bio"
          >
            <Text
              style={[st.bioSuggestion, { color: C.accent }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              💡 Tap to see an example bio
            </Text>
          </TouchableOpacity>
        )}
        <TextInput
          style={[
            st.bioIn,
            { backgroundColor: C.input, color: C.text },
          ]}
          placeholder="What makes you unique…"
          placeholderTextColor={C.dim}
          value={form.bio}
          onChangeText={(t) => {
            const cropped = t.slice(0, MAX_BIO);
            const blocked = checkBlocked(cropped);
            if (blocked) {
              Alert.alert('Not Allowed', blocked);
              return;
            }
            set('bio', cropped);
          }}
          multiline
          maxLength={MAX_BIO}
          editable={!loading}
          textAlignVertical="top"
          accessibilityLabel="Bio"
          accessibilityHint={`Maximum ${MAX_BIO} characters`}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        />
        <Text
          style={[
            st.charCt,
            { color: form.bio.length >= MAX_BIO * 0.9 ? C.warning : C.dim },
          ]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {form.bio.length}/{MAX_BIO}
        </Text>
      </View>

      {/* Prompts */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Profile Prompts
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Up to 3 conversation starters shown on your profile
        </Text>

        {form.prompts.map((p, i) => (
          <View
            key={`pr_${i}`}
            style={[st.promptCard, { backgroundColor: C.input }]}
            accessibilityLabel={`Prompt ${i + 1}`}
          >
            <TouchableOpacity
              style={st.promptQ}
              onPress={() => setPromptPicker(i)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={p.q || 'Tap to pick a question'}
              accessibilityHint="Opens question picker"
            >
              <Text
                style={[st.promptQText, { color: C.accent }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {p.q || 'Tap to pick a question…'}
              </Text>
              <Text
                style={[st.promptArr, { color: C.accent }]}
                accessibilityElementsHidden
              >
                ▼
              </Text>
            </TouchableOpacity>

            {p.q !== '' && (
              <TextInput
                style={[st.promptIn, { backgroundColor: C.card, color: C.text }]}
                placeholder="Your answer…"
                placeholderTextColor={C.dim}
                value={p.a}
                onChangeText={(t) => {
                  const cropped = t.slice(0, MAX_PROMPT);
                  const blocked = checkBlocked(cropped);
                  if (blocked) {
                    Alert.alert('Not Allowed', blocked);
                    return;
                  }
                  dispatch({
                    type:  'SET_PROMPT',
                    index: i,
                    q:     p.q,
                    a:     cropped,
                  });
                }}
                multiline
                maxLength={MAX_PROMPT}
                editable={!loading}
                textAlignVertical="top"
                accessibilityLabel={`Answer for prompt: ${p.q}`}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              />
            )}

            {p.q !== '' && (
              <Text
                style={[
                  st.charCt,
                  { color: p.a.length >= MAX_PROMPT * 0.9 ? C.warning : C.dim },
                ]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {p.a.length}/{MAX_PROMPT}
              </Text>
            )}

            <TouchableOpacity
              style={st.promptRm}
              onPress={() => dispatch({ type: 'DEL_PROMPT', index: i })}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Remove prompt ${i + 1}`}
            >
              <Text style={[st.promptRmText, { color: C.danger }]}>
                ✕ Remove
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        {form.prompts.length < 3 && (
          <TouchableOpacity
            style={[st.addPrompt, { borderColor: C.accent }]}
            onPress={() => dispatch({ type: 'ADD_PROMPT' })}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Add a profile prompt"
          >
            <Text
              style={[st.addPromptText, { color: C.accent }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              + Add Prompt
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Location */}
      <View style={st.fg}>
        <Text style={[st.label, { color: C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          📍 Location
        </Text>
        <Text style={[st.hint, { color: C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Only your city is shown — never your exact location
        </Text>
        <TouchableOpacity
          style={[
            st.locBtn,
            { backgroundColor: C.input },
            form.locCity !== '' && { borderColor: C.success },
            (gettingLoc || loading) && st.btnOff,
          ]}
          onPress={getLoc}
          disabled={gettingLoc || loading}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={
            form.locCity
              ? `Location set to ${form.locCity}. Tap to change.`
              : 'Enable location'
          }
        >
          {gettingLoc ? (
            <View style={st.locRow}>
              <ActivityIndicator size="small" color={C.white} />
              <Text
                style={[st.locBtnText, { color: C.accent }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                Getting Location…
              </Text>
            </View>
          ) : (
            <View style={st.locRow}>
              <Text accessibilityElementsHidden>
                {form.locCity ? '✓' : '📍'}
              </Text>
              <Text
                style={[st.locBtnText, { color: C.accent }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {form.locCity || 'Enable Location'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        {form.locCity !== '' && (
          <Text
            style={[st.locConf, { color: C.success }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            📍 {form.locCity}
          </Text>
        )}
      </View>
    </View>
  );

  // ── Step 8: Privacy, Preview & Submit ─────────────────────

  const renderStep8 = () => (
    <View>
      <Text
        ref={stepTitleRef}
        style={[st.title, { color: C.accent }]}
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        👀 Preview & Privacy
      </Text>

      {/* Privacy settings */}
      <View
        style={[st.privacyCard, { backgroundColor: C.card, borderColor: C.accent }]}
        accessibilityRole="group"
        accessibilityLabel="Privacy settings"
      >
        <Text
          style={[st.privacyTitle, { color: C.text }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          🔒 Privacy Settings
        </Text>
        <Text
          style={[st.hint, { color: C.muted }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          Control who sees your profile
        </Text>

        {[
          {
            key:   'blurUntilMatch' as const,
            label: '🔵 Blur photos until match',
            desc:  'Your photos are blurred in discover. They unlock when you match.',
            val:   form.blurUntilMatch,
          },
          {
            key:   'incognito' as const,
            label: '👻 Incognito mode',
            desc:  'Only people you like first can see your profile.',
            val:   form.incognito,
          },
          {
            key:   'verifiedOnly' as const,
            label: '✅ Verified users only',
            desc:  'Only selfie-verified users can discover you.',
            val:   form.verifiedOnly,
          },
        ].map((item) => (
          <View
            key={item.key}
            style={[st.privRow, { borderBottomColor: C.input }]}
          >
            <View style={st.privInfo}>
              <Text
                style={[st.privLabel, { color: C.text }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {item.label}
              </Text>
              <Text
                style={[st.privDesc, { color: C.muted }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {item.desc}
              </Text>
            </View>
            <Switch
              value={item.val}
              onValueChange={(v) => set(item.key, v)}
              trackColor={{ false: C.input, true: C.accent }}
              thumbColor={item.val ? C.success : C.dim}
              accessibilityRole="switch"
              accessibilityLabel={item.label}
              accessibilityState={{ checked: item.val }}
            />
          </View>
        ))}
      </View>

      {/* Profile preview */}
      <Text
        style={[st.previewLabel, { color: C.sub }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        How others see you:
      </Text>
      <View
        style={[st.preview, { backgroundColor: C.card, borderColor: C.accent }]}
        accessibilityLabel="Profile preview"
      >
        {form.photos.length > 0 && (
          <View>
            {/* Photo carousel */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={st.previewPhotoScroll}
              accessibilityLabel="Profile photos preview"
            >
              {form.photos.map((p, i) => (
                <Image
                  key={`prev_${i}`}
                  source={{ uri: p.uri }}
                  style={[
                    st.previewThumb,
                    i === 0 && st.previewThumbMain,
                    form.blurUntilMatch && { opacity: 0.15 },
                  ]}
                  contentFit="cover"
                  transition={150}
                  accessibilityLabel={`${getPhotoLabel(p.type)} photo${i === 0 ? ', main photo' : ''}`}
                />
              ))}
            </ScrollView>
            {form.blurUntilMatch && (
              <View style={st.blurOverlay}>
                <Text
                  style={[st.blurText, { color: C.accent }]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  🔒 Blurred until match
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={st.previewInfo}>
          <Text
            style={[st.previewName, { color: C.text }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {formatName(form.name) || 'Your Name'}, {age ?? '??'}
            {zodiac ? ` ${zodiac.emoji}` : ''}
          </Text>

          {form.pronouns !== '' && (
            <Text
              style={[st.previewSub, { color: C.muted }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {form.pronouns}
            </Text>
          )}

          {hDisplay !== '' && (
            <Text
              style={[st.previewDetail, { color: C.sub }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              📏 {hDisplay}
            </Text>
          )}

          {form.occupation.trim() !== '' && (
            <Text
              style={[st.previewDetail, { color: C.sub }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              💼 {form.occupation}
            </Text>
          )}

          {form.education !== '' && (
            <Text
              style={[st.previewDetail, { color: C.sub }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              🎓 {form.education}
            </Text>
          )}

          {form.locCity !== '' && (
            <Text
              style={[st.previewDetail, { color: C.sub }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              📍 {form.locCity}
            </Text>
          )}

          {form.vibes.length > 0 && (
            <Text
              style={st.previewVibes}
              accessibilityLabel={`Vibes: ${form.vibes.join(', ')}`}
            >
              {form.vibes.join(' ')}
            </Text>
          )}

          {form.bio.trim() !== '' && (
            <Text
              style={[st.previewBio, { color: C.text }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {form.bio.trim()}
            </Text>
          )}

          {form.interests.length > 0 && (
            <View style={st.previewTags}>
              {form.interests.slice(0, 5).map((t) => (
                <View
                  key={t}
                  style={[st.previewTag, { backgroundColor: C.input }]}
                >
                  <Text
                    style={[st.previewTagText, { color: C.accent }]}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                  >
                    {t}
                  </Text>
                </View>
              ))}
              {form.interests.length > 5 && (
                <Text
                  style={[st.previewMore, { color: C.muted }]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  +{form.interests.length - 5} more
                </Text>
              )}
            </View>
          )}

          <Text
            style={[st.previewPhotoCt, { color: C.muted }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            📸 {form.photos.length} photo
            {form.photos.length !== 1 ? 's' : ''} (
            {form.photos.map((p) => getPhotoLabel(p.type)).join(', ')})
          </Text>
        </View>
      </View>

      {/* Completion bar */}
      <View style={[st.pctCard, { backgroundColor: C.card }]}>
        <Text
          style={[st.pctTitle, { color: C.text }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          Profile Completion: {pct}%
        </Text>
        <View
          style={[st.pctBarBg, { backgroundColor: C.input }]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: pct }}
          accessibilityLabel={`Profile ${pct} percent complete`}
        >
          <View
            style={[
              st.pctBarFill,
              {
                width:           `${pct}%` as any,
                backgroundColor: pct >= 80 ? C.success : pct >= 50 ? C.warning : C.danger,
              },
            ]}
          />
        </View>
        {pct < 100 && (
          <Text
            style={[st.pctHint, { color: C.muted }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            Complete more fields to increase your visibility in search results!
          </Text>
        )}
      </View>

      {/* Terms */}
      <View style={[st.termsRow, { backgroundColor: C.card }]}>
        <Switch
          value={form.termsAccepted}
          onValueChange={(v) => set('termsAccepted', v)}
          trackColor={{ false: C.input, true: C.accent }}
          thumbColor={form.termsAccepted ? C.success : C.dim}
          accessibilityRole="switch"
          accessibilityLabel="Accept Terms of Service and Privacy Policy"
          accessibilityState={{ checked: form.termsAccepted }}
        />
        <View style={{ flex: 1 }}>
          <Text
            style={[st.termsText, { color: C.sub }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            I agree to the{' '}
            <Text
              style={[st.termsLink, { color: C.accent }]}
              onPress={() =>
                Linking.openURL('https://myarchetype.vercel.app/terms').catch(() => {})
              }
              accessibilityRole="link"
              accessibilityLabel="Terms of Service"
            >
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text
              style={[st.termsLink, { color: C.accent }]}
              onPress={() =>
                Linking.openURL('https://myarchetype.vercel.app/privacy').catch(() => {})
              }
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      </View>
    </View>
  );

  // ── Step router ───────────────────────────────────────────

  const renderCurrent = () => {
    switch (step) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      case 5: return renderStep5();
      case 6: return renderStep6();
      case 7: return renderStep7();
      case 8: return renderStep8();
      default: return null;
    }
  };

  // ── Main render ───────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[st.root, { backgroundColor: C.bg }]}
      behavior={IS_IOS ? 'padding' : 'height'}
    >
      {/* ── Top bar ── */}
      <View style={[st.topBar, { backgroundColor: C.card }]}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={step === 1 ? 'Close setup' : 'Go back to previous step'}
        >
          <Text
            style={[st.backBtn, { color: C.accent }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {step === 1 ? '✕' : '← Back'}
          </Text>
        </TouchableOpacity>

        <Text
          style={[st.topTitle, { color: C.text }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityLabel={`Step ${step} of ${TOTAL_STEPS}: ${STEP_NAMES[step - 1]}`}
        >
          {step}/{TOTAL_STEPS} · {STEP_NAMES[step - 1]}
        </Text>

        {/* Draft saved indicator */}
        <Text
          style={[st.draftLabel, { color: C.dim }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityLabel="Draft auto-saved"
        >
          💾 Draft
        </Text>
      </View>

      {/* ── Step dots ── */}
      <View
        style={st.stepDots}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step }}
        accessibilityLabel={`Step ${step} of ${TOTAL_STEPS}`}
      >
        {STEP_NAMES.map((name, i) => (
          <View
            key={name}
            style={[
              st.stepDot,
              { backgroundColor: C.input },
              i + 1 <  step && { backgroundColor: C.success },
              i + 1 === step && { backgroundColor: C.accent, transform: [{ scale: 1.3 }] },
            ]}
            accessibilityLabel={`${name}: ${
              i + 1 < step
                ? 'complete'
                : i + 1 === step
                ? 'current'
                : 'upcoming'
            }`}
          />
        ))}
      </View>

      {/* ── Animated progress bar ── */}
      <View style={[st.progBg, { backgroundColor: C.input }]}>
        <Animated.View
          style={[
            st.progFill,
            {
              backgroundColor: C.success,
              width: progAnim.interpolate({
                inputRange:  [0, 1],
                outputRange: ['0%', '100%'],
              }) as any,
            },
          ]}
        />
      </View>

      {/* ── Scrollable step content ── */}
      <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
        <ScrollView
          ref={scrollRef}
          style={st.sv}
          contentContainerStyle={st.svContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={{
              opacity:   fadeAnim,
              transform: [{ translateX: slideAnim }],
            }}
          >
            {renderCurrent()}
          </Animated.View>
          <View style={{ height: SPACING.xl }} />
        </ScrollView>
      </Pressable>

      {/* ── Bottom action bar ── */}
      <View style={[st.botBar, { backgroundColor: C.card }]}>
        {step < TOTAL_STEPS ? (
          <TouchableOpacity
            style={[
              st.nextBtn,
              { backgroundColor: stepOk ? C.accent : C.dim },
              !stepOk && { opacity: 0.6 },
            ]}
            onPress={goNext}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={
              stepOk
                ? `Continue to step ${step + 1}`
                : getMissingFieldsMessage(step, form, hasFace, hasUpperBody, age, hCm)
            }
            accessibilityState={{ disabled: !stepOk }}
          >
            <Text
              style={[st.nextBtnText, { color: C.white }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {stepOk
                ? `Next → ${STEP_NAMES[step]}`
                : getMissingFieldsMessage(step, form, hasFace, hasUpperBody, age, hCm)}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              st.saveBtn,
              { backgroundColor: form.termsAccepted ? C.success : C.dim },
              (!form.termsAccepted || loading) && { opacity: 0.6 },
            ]}
            onPress={handleSave}
            disabled={!form.termsAccepted || loading}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={
              loading
                ? 'Creating profile, please wait'
                : 'Create profile'
            }
            accessibilityState={{ disabled: !form.termsAccepted || loading }}
          >
            {loading ? (
              <View style={st.saveBtnRow}>
                <ActivityIndicator size="small" color={C.white} />
                <Text
                  style={[st.saveBtnText, { color: C.white }]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  {' '}Creating…
                </Text>
              </View>
            ) : (
              <Text
                style={[st.saveBtnText, { color: C.white }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                ✓ Create Profile
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* ════════════════════════════════════
          CAMERA MODAL
          ════════════════════════════════════ */}
      <Modal
        visible={camOpen}
        animationType="slide"
        onRequestClose={closeCam}
        statusBarTranslucent
      >
        <View style={[st.camModal, { backgroundColor: C.bg }]}>

          {/* Camera header */}
          <View style={[st.camHead, { backgroundColor: C.card }]}>
            <TouchableOpacity
              onPress={closeCam}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close camera"
            >
              <Text
                style={[st.camCancel, { color: C.danger }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                ✕ Cancel
              </Text>
            </TouchableOpacity>

            <View style={st.camHeadCenter}>
              <Text
                style={[st.camTitle, { color: C.text }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                accessibilityRole="header"
              >
                {camSlot?.icon} {camSlot?.label}
              </Text>
              <Text
                style={[st.camInstr, { color: C.muted }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {camSlot?.instruction}
              </Text>
            </View>

            <View style={st.camSpacer} />
          </View>

          {/* Camera viewport */}
          <View style={st.camContent}>
            {IS_WEB ? (
              <View style={[st.camBox, { borderColor: C.accent }]}>
                {camErr ? (
                  <View style={st.camErrWrap}>
                    <Text style={st.camErrIcon}>📷</Text>
                    <Text
                      style={[st.camErrText, { color: C.danger }]}
                      accessibilityRole="alert"
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                      {camErr}
                    </Text>
                    <TouchableOpacity
                      style={[st.retryBtn, { backgroundColor: C.warning }]}
                      onPress={() => openCamera(camSlot ?? undefined)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Retry camera"
                    >
                      <Text
                        style={[st.retryBtnText, { color: C.white }]}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        Try Again
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : !camReady ? (
                  <View style={st.camLoadWrap}>
                    <ActivityIndicator size="large" color={C.accent} />
                    <Text
                      style={[st.camLoadText, { color: C.muted }]}
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                      Starting camera…
                    </Text>
                  </View>
                ) : null}

                <View style={camReady ? st.camVideo : st.hidden}>
                  {IS_WEB && (
                    // @ts-ignore — web only element
                    <video
                      id="cam-preview"
                      ref={videoRefCallback}
                      autoPlay
                      playsInline
                      muted
                      style={{
                        width:       '100%',
                        height:      '100%',
                        objectFit:   'cover',
                        transform:   camFacing === 'front' ? 'scaleX(-1)' : 'none',
                      }}
                    />
                  )}
                </View>

                {camReady && camSlot && (
                  <CameraGuide type={camSlot.type} C={C} />
                )}
              </View>
            ) : (
              <View style={[st.camBox, { borderColor: C.accent }]}>
                <CameraView
                  ref={cameraRef}
                  style={st.camNative}
                  facing={camFacing}
                />
                {camSlot && <CameraGuide type={camSlot.type} C={C} />}
              </View>
            )}

            {/* Countdown overlay */}
            {countdown !== null && (
              <View
                style={st.countdownOverlay}
                accessibilityRole="timer"
                accessibilityLabel={`Photo in ${countdown}`}
              >
                <Text style={[st.countdownText, { color: C.white }]}>
                  {countdown}
                </Text>
              </View>
            )}
          </View>

          {/* Camera controls */}
          <View style={[st.camControls, { backgroundColor: C.bg }]}>

            {/* Timer toggle — full body only */}
            {camSlot?.timerAvailable && (
              <TouchableOpacity
                style={[
                  st.timerBtn,
                  { backgroundColor: C.input },
                  timerEnabled && { borderColor: C.warning, backgroundColor: C.card },
                ]}
                onPress={() => { setTimerEnabled((v) => !v); haptic(); }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={
                  timerEnabled
                    ? `Timer on: ${TIMER_SECONDS} seconds. Tap to turn off.`
                    : 'Timer off. Tap to enable countdown.'
                }
                accessibilityState={{ selected: timerEnabled }}
              >
                <Text
                  style={[st.timerBtnText, { color: C.text }]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  {timerEnabled ? `⏱ ${TIMER_SECONDS}s ON` : '⏱ Timer'}
                </Text>
              </TouchableOpacity>
            )}

            <View style={st.camBtnRow}>
              {/* Flip camera */}
              <TouchableOpacity
                style={[st.flipBtn, { backgroundColor: C.input }]}
                onPress={flipCamera}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
              >
                <Text style={st.flipBtnText}>🔄</Text>
              </TouchableOpacity>

              {/* Capture button */}
              <TouchableOpacity
                style={[
                  st.captureBtn,
                  { borderColor: C.accent },
                  ((IS_WEB && !camReady) || capturing || countdown !== null) &&
                    st.captureBtnOff,
                ]}
                onPress={handleCapture}
                disabled={
                  (IS_WEB && !camReady) ||
                  capturing ||
                  countdown !== null
                }
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={
                  timerEnabled && camSlot?.timerAvailable
                    ? `Take photo with ${TIMER_SECONDS} second timer`
                    : 'Take photo'
                }
              >
                {capturing ? (
                  <ActivityIndicator size="small" color={C.accent} />
                ) : (
                  <View
                    style={[st.captureBtnInner, { backgroundColor: C.accent }]}
                  />
                )}
              </TouchableOpacity>

              {/* Spacer to balance layout */}
              <View style={st.flipBtn} />
            </View>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════
          PROMPT PICKER MODAL
          ════════════════════════════════════ */}
      <Modal
        visible={promptPicker !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPromptPicker(null)}
      >
        <View style={st.pickerOverlay}>
          <View
            style={[st.pickerContent, { backgroundColor: C.card }]}
            accessibilityRole="dialog"
            accessibilityLabel="Choose a prompt question"
          >
            <Text
              style={[st.pickerTitle, { color: C.text }]}
              accessibilityRole="header"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              Choose a Question
            </Text>

            <FlatList
              data={PROMPT_QUESTIONS}
              keyExtractor={(item, index) => `pq_${index}`}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const used =
                  promptPicker !== null &&
                  form.prompts.some(
                    (p, i) => p.q === item && i !== promptPicker,
                  );
                return (
                  <TouchableOpacity
                    style={[
                      st.pickerItem,
                      { borderBottomColor: C.input },
                      used && st.pickerItemOff,
                    ]}
                    onPress={() => {
                      if (used || promptPicker === null) return;
                      dispatch({
                        type:  'SET_PROMPT',
                        index: promptPicker,
                        q:     item,
                        a:     form.prompts[promptPicker]?.a ?? '',
                      });
                      setPromptPicker(null);
                    }}
                    disabled={used}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${item}${used ? ', already used' : ''}`}
                    accessibilityState={{ disabled: used }}
                  >
                    <Text
                      style={[
                        st.pickerItemText,
                        { color: used ? C.dim : C.text },
                      ]}
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                    >
                      {item}
                    </Text>
                    {used && (
                      <Text
                        style={[st.pickerUsed, { color: C.muted }]}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        Already used
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity
              style={st.pickerCancel}
              onPress={() => setPromptPicker(null)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text
                style={[st.pickerCancelText, { color: C.danger }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────

const st = StyleSheet.create({

  // ── Layout ──
  root:       { flex: 1 },
  sv:         { flex: 1 },
  svContent:  { padding: SPACING.xl, paddingBottom: SPACING.xxxxl },

  // ── Top bar ──
  topBar: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingHorizontal: SPACING.lg,
    paddingTop:     IS_IOS ? 56 : 44,
    paddingBottom:  SPACING.md,
  },
  backBtn:    { fontSize: FONT.lg, fontWeight: '600' },
  topTitle:   { fontSize: FONT.md, fontWeight: '600' },
  draftLabel: { fontSize: FONT.xs },

  // ── Step dots ──
  stepDots: {
    flexDirection:  'row',
    justifyContent: 'center',
    alignItems:     'center',
    gap:            SPACING.xs + 2,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  stepDot: {
    width:        8,
    height:       8,
    borderRadius: RADIUS.full,
  },

  // ── Progress bar ──
  progBg:   { height: 3 },
  progFill: { height: '100%', borderRadius: RADIUS.sm },

  // ── Bottom bar ──
  botBar: {
    padding:       SPACING.lg,
    paddingBottom: IS_IOS ? 34 : SPACING.lg,
  },
  nextBtn: {
    paddingVertical: SPACING.lg,
    borderRadius:    RADIUS.xxl,
    alignItems:      'center',
    minHeight:       52,
    justifyContent:  'center',
  },
  nextBtnText: { fontSize: FONT.lg, fontWeight: 'bold' },
  saveBtn: {
    paddingVertical: SPACING.lg,
    borderRadius:    RADIUS.xxl,
    alignItems:      'center',
    minHeight:       52,
    justifyContent:  'center',
  },
  saveBtnRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: FONT.lg, fontWeight: 'bold' },

  // ── Step content ──
  title:    { fontSize: FONT.xxxl, fontWeight: 'bold', marginBottom: SPACING.sm },
  sub:      { fontSize: FONT.base, marginBottom: SPACING.xl, lineHeight: 22 },
  fg:       { marginBottom: SPACING.xl + 2 },
  spacer:   { height: SPACING.xl },
  label:    { fontSize: FONT.lg, fontWeight: '600', marginBottom: SPACING.sm },
  labelRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   SPACING.sm,
  },
  hint:     { fontSize: FONT.sm, marginBottom: SPACING.sm + 2, fontStyle: 'italic' },
  err:      { fontSize: FONT.sm, marginTop: SPACING.xs + 2 },
  warn:     { fontSize: FONT.sm, marginTop: SPACING.xs + 2, fontStyle: 'italic' },

  // ── Text input ──
  input: {
    padding:      SPACING.lg,
    borderRadius: RADIUS.md,
    fontSize:     FONT.lg,
    borderWidth:  2,
    borderColor:  'transparent',
  },
  charCt: { fontSize: FONT.sm, textAlign: 'right', marginTop: SPACING.xs + 2 },

  // ── Birthday ──
  bdayRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  bdayIn:  { flex: 1, textAlign: 'center' },
  bdayInY: { flex: 1.6, textAlign: 'center' },
  bdaySep: { fontSize: FONT.xxl, fontWeight: 'bold' },
  ageRow:  {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginTop:      SPACING.sm + 2,
  },
  ageDisplay: { fontSize: FONT.base },
  zodiac:     { fontSize: FONT.base },

  // ── Height ──
  unitBtn:     { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, borderRadius: RADIUS.md },
  unitBtnText: { fontSize: FONT.sm, fontWeight: '600' },
  ftRow:       { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  ftIn:        { flex: 1, textAlign: 'center' },
  ftLbl:       { fontSize: FONT.lg },
  hPreview:    { fontSize: FONT.base, marginTop: SPACING.sm },

  // ── Chips ──
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical:   SPACING.sm + 2,
    paddingHorizontal: SPACING.md + 2,
    borderRadius:   RADIUS.xxl,
    borderWidth:    2,
    gap:            SPACING.xs + 2,
  },
  chipOn:      {},
  chipOff:     { opacity: 0.3 },
  chipIcon:    { fontSize: FONT.lg },
  chipText:    { fontSize: FONT.base },
  chipCheck:   { fontSize: FONT.base, fontWeight: 'bold' },

  // ── Option rows ──
  optRow: {
    padding:      SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth:  2,
    borderColor:  'transparent',
    marginBottom: SPACING.sm,
  },
  optHead:  { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  optIcon:  { fontSize: FONT.xxl },
  optText:  { fontSize: FONT.lg, fontWeight: '600', flex: 1 },
  optCheck: { fontSize: FONT.xl, fontWeight: 'bold' },
  optDesc:  { fontSize: FONT.sm, marginTop: SPACING.xs, marginLeft: 28, lineHeight: 18 },

  // ── Vibes ──
  vibeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  vibeItem: {
    width:          52,
    height:         52,
    borderRadius:   RADIUS.full,
    justifyContent: 'center',
    alignItems:     'center',
    borderWidth:    2,
    borderColor:    'transparent',
  },
  vibeEmoji: { fontSize: FONT.xxl + 2 },

  // ── Range inputs ──
  rangeRow:  { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 2 },
  rangeIn:   { flex: 1, textAlign: 'center' },
  rangeDash: { fontSize: FONT.xxl },
  rangeU:    { fontSize: FONT.base },

  // ── Bio ──
  bioIn: {
    padding:          SPACING.lg,
    borderRadius:     RADIUS.lg,
    fontSize:         FONT.lg,
    minHeight:        130,
    textAlignVertical:'top',
    lineHeight:       24,
  },
  bioSuggestion: { fontSize: FONT.base, marginBottom: SPACING.sm, fontStyle: 'italic' },

  // ── Prompts ──
  promptCard:  { borderRadius: RADIUS.lg, padding: SPACING.md + 2, marginBottom: SPACING.md },
  promptQ:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  promptQText: { fontSize: FONT.base, fontWeight: '600', flex: 1 },
  promptArr:   { fontSize: FONT.sm },
  promptIn:    {
    padding:          SPACING.md,
    borderRadius:     RADIUS.md,
    fontSize:         FONT.base,
    minHeight:        64,
    textAlignVertical:'top',
  },
  promptRm:     { marginTop: SPACING.sm, alignSelf: 'flex-end' },
  promptRmText: { fontSize: FONT.sm },
  addPrompt:    {
    borderWidth:    2,
    borderStyle:    'dashed',
    borderRadius:   RADIUS.lg,
    padding:        SPACING.md + 2,
    alignItems:     'center',
    marginTop:      SPACING.sm,
  },
  addPromptText: { fontSize: FONT.base, fontWeight: '600' },

  // ── Location ──
  locBtn: {
    paddingVertical:   SPACING.lg,
    borderRadius:      RADIUS.lg,
    alignItems:        'center',
    borderWidth:       2,
    borderColor:       'transparent',
  },
  btnOff:     { opacity: 0.5 },
  locRow:     { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 2 },
  locBtnText: { fontSize: FONT.lg, fontWeight: '600' },
  locConf:    { fontSize: FONT.base, marginTop: SPACING.sm + 2, textAlign: 'center' },

  // ── Photo step ──
  slotStatus: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg, flexWrap: 'wrap' },
  statusItem: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical:   SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderRadius:   RADIUS.xxl,
    gap:            SPACING.xs + 2,
    borderWidth:    2,
    borderColor:    'transparent',
  },
  statusIcon:     { fontSize: FONT.lg },
  statusText:     { fontSize: FONT.md, fontWeight: '600' },
  loadRow:        {
    flexDirection:  'row',
    alignItems:     'center',
    padding:        SPACING.md + 2,
    borderRadius:   RADIUS.md,
    marginBottom:   SPACING.md + 2,
    gap:            SPACING.sm,
  },
  loadRowText:    { fontSize: FONT.base },
  uploadBarBg:    { height: 4, borderRadius: RADIUS.sm, overflow: 'hidden', marginTop: SPACING.xs + 2, flex: 1 },
  uploadBarFill:  { height: '100%', borderRadius: RADIUS.sm },
  photoGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  photoSlot:      { position: 'relative' },
  photoImg:       { width: 100, height: 130, borderRadius: RADIUS.lg, borderWidth: 2 },
  photoTypeTag:   {
    position:         'absolute',
    bottom:           30,
    left:             SPACING.xs,
    backgroundColor:  'rgba(0,0,0,0.72)',
    borderRadius:     SPACING.xs + 2,
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical:  2,
  },
  photoTypeText:  { fontSize: 9, fontWeight: 'bold', color: '#fff' },
  mainTag:        {
    position:         'absolute',
    top:              SPACING.xs + 2,
    left:             SPACING.xs + 2,
    borderRadius:     RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical:  SPACING.xxs + 1,
  },
  mainTagText:    { fontSize: FONT.xs, fontWeight: 'bold' },
  okDot:          {
    position:       'absolute',
    bottom:         SPACING.xs + 2,
    right:          SPACING.xs + 2,
    borderRadius:   RADIUS.full,
    width:          22,
    height:         22,
    justifyContent: 'center',
    alignItems:     'center',
  },
  okDotText:      { fontSize: FONT.xs, fontWeight: 'bold' },
  moveRow:        { position: 'absolute', bottom: 30, left: SPACING.xs + 2, flexDirection: 'row', gap: SPACING.xxs + 2 },
  moveBtn:        { borderRadius: RADIUS.md, width: 22, height: 22, justifyContent: 'center', alignItems: 'center' },
  moveBtnText:    { fontSize: FONT.md, fontWeight: 'bold' },
  rmBtn:          {
    position:       'absolute',
    top:            -8,
    right:          -8,
    borderRadius:   RADIUS.full,
    width:          28,
    height:         28,
    justifyContent: 'center',
    alignItems:     'center',
    borderWidth:    2,
  },
  rmBtnText:      { fontSize: FONT.lg, fontWeight: 'bold' },
  addBtn:         {
    width:          100,
    height:         130,
    borderRadius:   RADIUS.lg,
    borderWidth:    2,
    borderStyle:    'dashed',
    justifyContent: 'center',
    alignItems:     'center',
  },
  addBtnOff:      { opacity: 0.35 },
  addBtnIcon:     { fontSize: FONT.xxxl, marginBottom: SPACING.xxs + 2 },
  addBtnLabel:    { fontSize: FONT.xs, fontWeight: '600' },
  addBtnReq:      { fontSize: 9, marginTop: SPACING.xxs },
  tipBox:         { padding: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.md + 2, borderWidth: 1 },
  tipText:        { fontSize: FONT.md, textAlign: 'center' },
  socialProof:    { padding: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.md, borderWidth: 1 },
  socialProofText:{ fontSize: FONT.md, textAlign: 'center', lineHeight: 20 },
  photoHint:      { fontSize: FONT.sm, marginTop: SPACING.md + 2, lineHeight: 18 },

  // ── Privacy ──
  privacyCard:  { borderRadius: RADIUS.xl, padding: SPACING.xl, marginBottom: SPACING.xl, borderWidth: 2 },
  privacyTitle: { fontSize: FONT.xl, fontWeight: 'bold', marginBottom: SPACING.xxs + 2 },
  privRow:      {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md + 2,
    borderBottomWidth: 1,
  },
  privInfo:     { flex: 1, marginRight: SPACING.md },
  privLabel:    { fontSize: FONT.lg - 1, fontWeight: '600', marginBottom: SPACING.xxs + 2 },
  privDesc:     { fontSize: FONT.sm, lineHeight: 17 },

  // ── Preview ──
  previewLabel:      { fontSize: FONT.base, marginBottom: SPACING.sm + 2, fontWeight: '600' },
  preview:           { borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.xl, borderWidth: 2 },
  previewPhotoScroll:{ height: 180 },
  previewThumb:      { width: 140, height: 180, marginRight: SPACING.xxs + 2 },
  previewThumbMain:  { width: 180 },
  blurOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,26,46,0.75)', justifyContent: 'center', alignItems: 'center' },
  blurText:          { fontSize: FONT.xl, fontWeight: 'bold' },
  previewInfo:       { padding: SPACING.xl },
  previewName:       { fontSize: FONT.xxxl, fontWeight: 'bold', marginBottom: SPACING.xxs + 2 },
  previewSub:        { fontSize: FONT.base, marginBottom: SPACING.sm },
  previewDetail:     { fontSize: FONT.base, marginBottom: SPACING.xxs + 2 },
  previewVibes:      { fontSize: FONT.xxl + 2, marginVertical: SPACING.sm },
  previewBio:        { fontSize: FONT.lg - 1, lineHeight: 22, marginTop: SPACING.sm, marginBottom: SPACING.md },
  previewTags:       { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs + 2, marginTop: SPACING.sm },
  previewTag:        { paddingVertical: SPACING.xxs + 2, paddingHorizontal: SPACING.sm + 2, borderRadius: RADIUS.md },
  previewTagText:    { fontSize: FONT.sm },
  previewMore:       { fontSize: FONT.sm, alignSelf: 'center' },
  previewPhotoCt:    { fontSize: FONT.sm, marginTop: SPACING.md },

  // ── Completion ──
  pctCard:   { borderRadius: RADIUS.xl, padding: SPACING.lg, marginBottom: SPACING.xl },
  pctTitle:  { fontSize: FONT.lg, fontWeight: '600', marginBottom: SPACING.sm + 2 },
  pctBarBg:  { height: 10, borderRadius: RADIUS.sm, overflow: 'hidden' },
  pctBarFill:{ height: '100%', borderRadius: RADIUS.sm },
  pctHint:   { fontSize: FONT.sm, marginTop: SPACING.sm, fontStyle: 'italic' },

  // ── Terms ──
  termsRow:  {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SPACING.md,
    padding:       SPACING.lg,
    borderRadius:  RADIUS.lg,
    marginBottom:  SPACING.xl,
  },
  termsText: { fontSize: FONT.base, lineHeight: 22 },
  termsLink: { fontWeight: '600', textDecorationLine: 'underline' },

  // ── Camera modal ──
  camModal:   { flex: 1 },
  camHead:    {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    padding:        SPACING.lg,
    paddingTop:     IS_IOS ? 56 : 44,
  },
  camCancel:     { fontSize: FONT.lg, fontWeight: '600' },
  camHeadCenter: { flex: 1, alignItems: 'center', marginHorizontal: SPACING.sm + 2 },
  camTitle:      { fontSize: FONT.xl, fontWeight: 'bold' },
  camInstr:      { fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xxs + 2, lineHeight: 18 },
  camSpacer:     { width: 70 },
  camContent:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  camBox:        {
    width:        300,
    height:       400,
    borderRadius: RADIUS.xl,
    overflow:     'hidden',
    backgroundColor: '#000',
    borderWidth:  3,
    position:     'relative',
  },
  camNative:     { width: '100%', height: '100%' },
  camVideo:      { width: '100%', height: '100%' },
  hidden:        { width: 0, height: 0, overflow: 'hidden' },
  camErrWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  camErrIcon:    { fontSize: 50, marginBottom: SPACING.lg },
  camErrText:    { fontSize: FONT.base, textAlign: 'center', marginBottom: SPACING.xl, lineHeight: 22 },
  camLoadWrap:   { flex: 1, justifyContent: 'center', alignItems: 'center' },
  camLoadText:   { marginTop: SPACING.lg, fontSize: FONT.base },
  retryBtn:      { paddingVertical: SPACING.md + 2, paddingHorizontal: SPACING.xxxl, borderRadius: RADIUS.xxl },
  retryBtnText:  { fontSize: FONT.base, fontWeight: '600' },

  // ── Countdown ──
  countdownOverlay: {
    position:       'absolute',
    top:            0, left: 0, right: 0, bottom: 80,
    justifyContent: 'center',
    alignItems:     'center',
    zIndex:         20,
  },
  countdownText: {
    fontSize:         120,
    fontWeight:       'bold',
    textShadowColor:  'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 10,
  },

  // ── Camera controls ──
  camControls: { alignItems: 'center', paddingBottom: IS_IOS ? 44 : SPACING.lg, paddingTop: SPACING.lg },
  timerBtn:    {
    paddingVertical:   SPACING.sm,
    paddingHorizontal: SPACING.xl,
    borderRadius:      RADIUS.xxl,
    marginBottom:      SPACING.lg,
    borderWidth:       2,
    borderColor:       'transparent',
  },
  timerBtnText: { fontSize: FONT.base, fontWeight: '600' },
  camBtnRow:    {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-around',
    width:          '100%',
    paddingHorizontal: SPACING.xxxxl,
  },
  flipBtn:      { width: 52, height: 52, borderRadius: RADIUS.full, justifyContent: 'center', alignItems: 'center' },
  flipBtnText:  { fontSize: FONT.xxxl },
  captureBtn:   {
    width:          84,
    height:         84,
    borderRadius:   42,
    backgroundColor:'#fff',
    justifyContent: 'center',
    alignItems:     'center',
    borderWidth:    4,
  },
  captureBtnOff:   { opacity: 0.4 },
  captureBtnInner: { width: 68, height: 68, borderRadius: 34 },

  // ── Prompt picker ──
  pickerOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  pickerContent:      {
    borderTopLeftRadius:  RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    padding:              SPACING.xl,
    maxHeight:            '72%',
    paddingBottom:        IS_IOS ? 34 : SPACING.xl,
  },
  pickerTitle:        { fontSize: FONT.xxl, fontWeight: 'bold', textAlign: 'center', marginBottom: SPACING.lg },
  pickerItem:         { padding: SPACING.lg, borderBottomWidth: 1 },
  pickerItemOff:      { opacity: 0.35 },
  pickerItemText:     { fontSize: FONT.lg - 1, lineHeight: 22 },
  pickerUsed:         { fontSize: FONT.xs, marginTop: SPACING.xxs + 2 },
  pickerCancel:       { marginTop: SPACING.lg, padding: SPACING.md + 2, alignItems: 'center' },
  pickerCancelText:   { fontSize: FONT.lg, fontWeight: '600' },

  // ── Step 1 ──
  // (already covered above)

  // ── Step 4 occupation ──
  // charCt already defined above
});