import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert,
  Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView,
  Switch, Text, TextInput, TouchableOpacity,
  useColorScheme, useWindowDimensions, View,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import TurboImage from '../src/components/TurboImage';
import { StyleSheet } from 'react-native-unistyles';
import BodyTypeSelector from '../components/BodyTypeSelector';
import { auth, db } from '../firebaseConfig';
import { estimateAgeFromPhoto } from '../utils/ageEstimation';
import { detectFullBodyPhoto } from '../utils/bodyTypeDetection';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import { ensureMyE2EEIdentity } from '../utils/e2ee';
import { checkSingleFace } from '../utils/faceVerification';
import { requestLocationPermission, saveUserLocation } from '../utils/location';
import { logger } from '../utils/logger';
import { checkImageSafety } from '../utils/moderation';
import { formatName, validateName } from '../utils/nameValidation';
import { profileStorage } from '../utils/storage';

const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';

interface AlertButton { text: string; style?: 'cancel' | 'destructive' | 'default'; onPress?: () => void; }
function showAlert(title: string, message?: string, buttons?: AlertButton[], _options?: Record<string, unknown>) {
  if (!IS_WEB) { Alert.alert(title, message, buttons, _options); return; }
  const msg = message ? `${title}\n\n${message}` : title;
  if (!buttons || buttons.length <= 1) { (window as unknown as Record<string, unknown>)['alert']?.(msg); buttons?.[0]?.onPress?.(); return; }
  const confirmed = (window as unknown as Record<string, unknown>)['confirm']?.(msg);
  if (confirmed) { (buttons.find(b => b.style !== 'cancel') ?? buttons[buttons.length - 1])?.onPress?.(); }
  else           { (buttons.find(b => b.style === 'cancel') ?? buttons[0])?.onPress?.(); }
}

const SPACING = { xxs:2, xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32, xxxxl:40 } as const;
const FONT    = { xs:11, sm:12, md:13, base:14, lg:16, xl:18, xxl:20, xxxl:24, display:28 } as const;
const RADIUS  = { sm:6, md:10, lg:14, xl:20, xxl:25, full:50 } as const;

const MAX_FONT_SCALE   = 1.4;
const MAX_PHOTOS       = 6;
const MAX_BIO          = 300;
const MAX_PROMPT       = 150;
const MAX_NAME         = 20;
const AGE_TOL          = 5;
const MIN_AGE          = 18;
const MAX_AGE          = 99;
const MIN_H            = 100;
const MAX_H            = 250;
const TOTAL_STEPS      = 8;
const TIMER_SECONDS    = 3;
const DRAFT_KEY_PREFIX = 'profile_setup_draft_';
const STEP_KEY_PREFIX  = 'profile_setup_step_';
const STEP_NAMES = ['Photos','Basics','Body','Lifestyle','Interests','Preferences','About You','Preview'] as const;

interface Theme {
  bg:string; bgGradientStart:string; bgGradientMid:string; bgGradientEnd:string;
  card:string; cardBorder:string; input:string; inputBorder:string;
  accent:string; accentSoft:string; accentGlow:string;
  error:string; errorGlow:string; warn:string; success:string; successGlow:string;
  text:string; sub:string; muted:string; dim:string;
  white:string; black:string; overlay:string; none:string;
  guideStroke:string; guideFill:string; skeleton:string;
  buttonGradStart:string; buttonGradEnd:string;
  disabledBg:string; disabledText:string;
  gold:string; purple:string; danger:string; warning:string;
}
const darkTokens: Theme = {
  bg:'#07070f', bgGradientStart:'#0a0a18', bgGradientMid:'#0e0e24', bgGradientEnd:'#07070f',
  card:'#111128', cardBorder:'#1e1e48', input:'#0d0d24', inputBorder:'#28285a',
  accent:'#6C63FF', accentSoft:'#8B83FF', accentGlow:'rgba(108,99,255,0.10)',
  error:'#FF6B6B', errorGlow:'rgba(255,107,107,0.07)', warn:'#FFB347',
  success:'#51CF66', successGlow:'rgba(81,207,102,0.07)',
  text:'#EDEDFF', sub:'#9494B8', muted:'#64648a', dim:'#40406a',
  white:'#ffffff', black:'#000000', overlay:'rgba(4,4,12,0.92)', none:'transparent',
  guideStroke:'rgba(108,99,255,0.7)', guideFill:'rgba(108,99,255,0.08)', skeleton:'#1e1e48',
  buttonGradStart:'#7B73FF', buttonGradEnd:'#5A4FE6',
  disabledBg:'#181834', disabledText:'#40406a',
  gold:'#f1c40f', purple:'#9b59b6', danger:'#FF6B6B', warning:'#FFB347',
};
const lightTokens: Theme = {
  bg:'#F0F2F8', bgGradientStart:'#E8EAF4', bgGradientMid:'#E0E3F0', bgGradientEnd:'#F0F2F8',
  card:'#FFFFFF', cardBorder:'#D4D8E8', input:'#F4F5FC', inputBorder:'#C8CCE0',
  accent:'#5B52E0', accentSoft:'#7A72F0', accentGlow:'rgba(91,82,224,0.08)',
  error:'#DC3545', errorGlow:'rgba(220,53,69,0.05)', warn:'#D4880F',
  success:'#2F9E44', successGlow:'rgba(47,158,68,0.05)',
  text:'#10102A', sub:'#4E4E6E', muted:'#8080A0', dim:'#C0C0D0',
  white:'#ffffff', black:'#000000', overlay:'rgba(220,224,240,0.92)', none:'transparent',
  guideStroke:'rgba(91,82,224,0.7)', guideFill:'rgba(91,82,224,0.08)', skeleton:'#D4D8E8',
  buttonGradStart:'#6C63FF', buttonGradEnd:'#4A42CC',
  disabledBg:'#D0D4E4', disabledText:'#9898B4',
  gold:'#c4940a', purple:'#7b3fa0', danger:'#DC3545', warning:'#D4880F',
};

type ZodiacSign = 'Capricorn'|'Aquarius'|'Pisces'|'Aries'|'Taurus'|'Gemini'|'Cancer'|'Leo'|'Virgo'|'Libra'|'Scorpio'|'Sagittarius';
type PhotoType  = 'face'|'upper_body'|'full_body'|'freestyle';
type BodyType   = 'slim'|'athletic'|'average'|'curvy'|'heavyset'|'';
type HeightUnit = 'cm'|'ft';

interface ProfilePhoto    { uri:string; url:string; type:PhotoType; order:number; verified:boolean; uploadedAt:string; }
interface PhotoSlotConfig { type:PhotoType; label:string; required:boolean; icon:string; instruction:string; cameraSide:'front'|'back'; timerAvailable:boolean; }
interface OptionItem      { value:string; label?:string; desc?:string; icon?:string; }
interface ZodiacResult    { sign:ZodiacSign; emoji:string; }

type CloudinaryFaceArray  = [number,number,number,number];
type CloudinaryFaceObject = { width?:number; height?:number; [key:string]:number|undefined };
type CloudinaryFace       = CloudinaryFaceArray|CloudinaryFaceObject;

interface UploadResult { success:boolean; url?:string; error?:string; moderationStatus?:'approved'|'rejected'|'pending'; faces?:CloudinaryFace[]; width?:number; height?:number; }
interface AgeEstimationResult { estimatedAge:number; confidence:number; }
interface LocationData        { city:string; country:string; latitude:number; longitude:number; }

interface WebVideoElement {
  srcObject:MediaStream|null; readyState:number; videoWidth:number; videoHeight:number;
  paused:boolean; autoplay:boolean; playsInline:boolean; muted:boolean;
  onloadedmetadata:(() => void)|null; oncanplay:(() => void)|null; onerror:(() => void)|null;
  play:() => Promise<void>; pause:() => void;
}
interface WebMediaTrack  { stop:() => void; onended:(() => void)|null; }
interface WebMediaStream { getTracks:() => WebMediaTrack[]; }
interface WebMediaDeviceInfo { kind:string; }
interface WebNavigatorMedia { mediaDevices?: { getUserMedia:(c:Record<string,unknown>) => Promise<WebMediaStream>; enumerateDevices:() => Promise<WebMediaDeviceInfo[]>; }; }
interface WebCanvasElement { width:number; height:number; toDataURL:(type:string,quality:number) => string; getContext:(type:'2d') => CanvasRenderingContext2D|null; }

interface FormState {
  photos:ProfilePhoto[]; name:string; bdayMonth:string; bdayDay:string; bdayYear:string;
  gender:string; interestedIn:string; pronouns:string;
  heightCm:string; heightFt:string; heightIn:string; heightUnit:HeightUnit;
  bodyType:BodyType; lookingForBody:BodyType;
  religion:string; lifestyle:string; relationship:string; education:string; occupation:string;
  smoking:string; drinking:string; children:string; pets:string; diet:string; politics:string;
  interests:string[]; loveLang:string; commStyle:string; firstDate:string; vibes:string[];
  ageMin:string; ageMax:string; distKm:string; heightPrefMinCm:string; heightPrefMaxCm:string;
  dealbreakers:string[]; importantFields:string[];
  bio:string; prompts:{ q:string; a:string }[];
  locCity:string; locData:LocationData|null; ageEstimate:number|null;
  blurUntilMatch:boolean; incognito:boolean; verifiedOnly:boolean; termsAccepted:boolean;
}
type ToggleListField = 'interests'|'dealbreakers'|'vibes'|'importantFields';
type Action =
  | { type:'SET';          field:keyof FormState; value:FormState[keyof FormState] }
  | { type:'ADD_PHOTO';    photo:ProfilePhoto }
  | { type:'REMOVE_PHOTO'; index:number }
  | { type:'MOVE_PHOTO';   from:number; to:number }
  | { type:'TOGGLE_LIST';  field:ToggleListField; value:string; max?:number }
  | { type:'SET_PROMPT';   index:number; q:string; a:string }
  | { type:'ADD_PROMPT' }
  | { type:'DEL_PROMPT';   index:number }
  | { type:'LOAD';         state:Partial<FormState> }
  | { type:'RESET' };

const PHOTO_SLOTS: PhotoSlotConfig[] = [
  { type:'face',       label:'Face Selfie', required:true,  icon:'🤳', instruction:'Show your face clearly\nShoulders up, good lighting',          cameraSide:'front', timerAvailable:false },
  { type:'upper_body', label:'Upper Body',  required:true,  icon:'👤', instruction:'Waist up, show your upper body\nKeep your face visible',        cameraSide:'front', timerAvailable:false },
  { type:'full_body',  label:'Full Body',   required:false, icon:'🧍', instruction:'Head to toe, stand naturally\nProp your phone or use the timer', cameraSide:'back',  timerAvailable:true  },
  { type:'freestyle',  label:'Freestyle',   required:false, icon:'📸', instruction:'Show your personality!\nHobbies, style, pets, travel...',        cameraSide:'front', timerAvailable:false },
];

const GENDER_OPTIONS:        OptionItem[] = [{ value:'Male',icon:'👨' },{ value:'Female',icon:'👩' },{ value:'Non-binary',icon:'🧑' },{ value:'Other',icon:'✨' },{ value:'Prefer not to say',icon:'🤫' }];
const INTERESTED_IN_OPTIONS: OptionItem[] = [{ value:'Men',icon:'👨' },{ value:'Women',icon:'👩' },{ value:'Everyone',icon:'💫' },{ value:'Non-binary people',icon:'🧑' }];
const PRONOUN_OPTIONS:       OptionItem[] = [{ value:'He/Him' },{ value:'She/Her' },{ value:'They/Them' },{ value:'Other' }];
const RELIGIOUS_OPTIONS:     OptionItem[] = [{ value:'Traditional',desc:'Follow religious practices regularly' },{ value:'Modern',desc:'Believe but flexible interpretation' },{ value:'Spiritual',desc:'Spiritual but not organized religion' },{ value:'None',desc:'Not religious or spiritual' },{ value:'Prefer not to say',desc:'' }];
const LIFESTYLE_OPTIONS:     OptionItem[] = [{ value:'Natural',desc:'Simple, outdoors, minimal',icon:'🌿' },{ value:'Fitness',desc:'Active, gym, health-focused',icon:'💪' },{ value:'Social',desc:'Outgoing, parties, events',icon:'🎉' },{ value:'Homebody',desc:'Cozy nights in, relaxing',icon:'🏠' },{ value:'Adventurous',desc:'Travel, explore, try new things',icon:'🌍' },{ value:'Creative',desc:'Art, music, self-expression',icon:'🎨' }];
const RELATIONSHIP_OPTIONS:  OptionItem[] = [{ value:'Marriage',desc:'Looking for life partner',icon:'💍' },{ value:'Long-term',desc:'Serious but not rushing',icon:'❤️' },{ value:'Exploring',desc:'Open to see where it goes',icon:'🌊' }];
const EDUCATION_OPTIONS:     OptionItem[] = [{ value:'High School',icon:'🏫' },{ value:'Trade School',icon:'🔧' },{ value:"Bachelor's",icon:'🎓' },{ value:"Master's",icon:'📚' },{ value:'PhD',icon:'🧪' },{ value:'Prefer not to say',icon:'🤫' }];
const SMOKING_OPTIONS:       OptionItem[] = [{ value:'Never',icon:'🚭' },{ value:'Socially',icon:'💨' },{ value:'Regularly',icon:'🚬' }];
const DRINKING_OPTIONS:      OptionItem[] = [{ value:'Never',icon:'🚫' },{ value:'Socially',icon:'🍷' },{ value:'Regularly',icon:'🍺' }];
const CHILDREN_OPTIONS:      OptionItem[] = [{ value:"Don't have, don't want",icon:'🙅' },{ value:"Don't have, want someday",icon:'🤱' },{ value:'Have, want more',icon:'👨‍👧‍👦' },{ value:"Have, don't want more",icon:'👨‍👧' },{ value:'Prefer not to say',icon:'🤫' }];
const PET_OPTIONS:           OptionItem[] = [{ value:'Dog lover',icon:'🐕' },{ value:'Cat lover',icon:'🐈' },{ value:'Both',icon:'🐾' },{ value:'No pets',icon:'🏠' },{ value:'Allergic',icon:'🤧' }];
const DIET_OPTIONS:          OptionItem[] = [{ value:'No preference',icon:'🍽️' },{ value:'Vegetarian',icon:'🥬' },{ value:'Vegan',icon:'🌱' },{ value:'Halal',icon:'☪️' },{ value:'Kosher',icon:'✡️' },{ value:'Pescatarian',icon:'🐟' },{ value:'Keto',icon:'🥑' }];
const LOVE_LANGUAGE_OPTIONS: OptionItem[] = [{ value:'Words of Affirmation',desc:'Verbal compliments, encouragement',icon:'💬' },{ value:'Quality Time',desc:'Undivided attention together',icon:'⏰' },{ value:'Gifts',desc:'Thoughtful presents & surprises',icon:'🎁' },{ value:'Acts of Service',desc:'Helping out, doing things',icon:'🤝' },{ value:'Physical Touch',desc:'Hugs, holding hands',icon:'🤗' }];
const COMMUNICATION_OPTIONS: OptionItem[] = [{ value:'Texter',icon:'💬' },{ value:'Caller',icon:'📞' },{ value:'In-person',icon:'🤝' },{ value:'Mix of all',icon:'🔄' }];
const FIRST_DATE_OPTIONS:    OptionItem[] = [{ value:'Coffee',icon:'☕' },{ value:'Dinner',icon:'🍽️' },{ value:'Drinks',icon:'🍹' },{ value:'Adventure',icon:'🧗' },{ value:'Walk / Park',icon:'🌳' },{ value:'Museum / Gallery',icon:'🎨' }];
const POLITICAL_OPTIONS:     OptionItem[] = [{ value:'Liberal',icon:'🕊️' },{ value:'Moderate',icon:'⚖️' },{ value:'Conservative',icon:'🏛️' },{ value:'Not political',icon:'🤷' },{ value:'Prefer not to say',icon:'🤫' }];

const INTEREST_TAGS:   string[] = ['🏋️ Fitness','🧘 Yoga','🏃 Running','🚴 Cycling','🏊 Swimming','⚽ Football','🏀 Basketball','🎾 Tennis','⛷️ Skiing','🏄 Surfing','📚 Reading','✍️ Writing','🎵 Music','🎸 Guitar','🎹 Piano','🎨 Art','📷 Photography','🎬 Movies','📺 TV Shows','🎮 Gaming','🍳 Cooking','🍰 Baking','☕ Coffee','🍷 Wine','🍣 Foodie','✈️ Travel','🏕️ Camping','🥾 Hiking','🌊 Beach','🏔️ Mountains','🐕 Dogs','🐈 Cats','🌱 Plants','🧠 Psychology','💻 Tech','📈 Finance','🎤 Karaoke','💃 Dancing','🧩 Puzzles','♟️ Chess','🎲 Board Games','🚗 Cars','✨ Fashion','💄 Makeup','🧘‍♂️ Meditation','📖 Spirituality','🎭 Theater','🎪 Comedy','🌍 Volunteering'];
const DEALBREAKER_TAGS:string[] = ['🚬 Smoking','🍺 Heavy drinking','📱 Social media obsession','🏠 Long distance','👶 Wants kids','🚫 No kids ever','🐾 No pets allowed','🗣️ Poor communication','🎮 Excessive gaming','📵 No calls or video','🤥 Dishonesty','😤 Hot temper','💸 Financial issues','🙅 Lack of ambition','⛪ Religious differences'];
const PROMPT_QUESTIONS:string[] = ['A life goal of mine is...','I geek out on...','My simple pleasures are...','The way to win me over is...','My most controversial opinion is...',"I'm looking for someone who...","On a typical Sunday you'll find me...",'Two truths and a lie...','My greatest strength is...',"I'll know it's love when...",'The key to my heart is...','My favorite travel story is...'];
const VIBE_EMOJIS:     string[] = ['😎','🥰','🤓','🏋️','🎨','🌍','🎵','📚','🍳','🧘','🎮','💃','🌿','🏖️','⚡','🌙','☀️','🦋','🔥','💎','🎯','🧩','🌈','🍕','🎪','🚀','🎸','🐾','🌸','✨'];
const IMPORTANT_FIELD_OPTIONS: string[] = ['Religion','Lifestyle','Education','Height','Body Type','Children','Smoking','Drinking','Pets','Politics'];

const ZODIAC_DATA: { sign:ZodiacSign; emoji:string; s:[number,number]; e:[number,number] }[] = [
  { sign:'Capricorn',  emoji:'♑', s:[1,1],   e:[1,19]  }, { sign:'Aquarius',   emoji:'♒', s:[1,20],  e:[2,18]  },
  { sign:'Pisces',     emoji:'♓', s:[2,19],  e:[3,20]  }, { sign:'Aries',      emoji:'♈', s:[3,21],  e:[4,19]  },
  { sign:'Taurus',     emoji:'♉', s:[4,20],  e:[5,20]  }, { sign:'Gemini',     emoji:'♊', s:[5,21],  e:[6,20]  },
  { sign:'Cancer',     emoji:'♋', s:[6,21],  e:[7,22]  }, { sign:'Leo',        emoji:'♌', s:[7,23],  e:[8,22]  },
  { sign:'Virgo',      emoji:'♍', s:[8,23],  e:[9,22]  }, { sign:'Libra',      emoji:'♎', s:[9,23],  e:[10,22] },
  { sign:'Scorpio',    emoji:'♏', s:[10,23], e:[11,21] }, { sign:'Sagittarius',emoji:'♐', s:[11,22], e:[12,21] },
  { sign:'Capricorn',  emoji:'♑', s:[12,22], e:[12,31] },
];

function getZodiac(m:number, d:number): ZodiacResult { for (const z of ZODIAC_DATA) { if ((m===z.s[0]&&d>=z.s[1])||(m===z.e[0]&&d<=z.e[1])) return { sign:z.sign, emoji:z.emoji }; } return { sign:'Capricorn', emoji:'♑' }; }
function calcAge(bday:Date): number { const t=new Date(); let a=t.getFullYear()-bday.getFullYear(); const md=t.getMonth()-bday.getMonth(); if (md<0||(md===0&&t.getDate()<bday.getDate())) a--; return a; }
function isValidDate(y:number, m:number, d:number): boolean { if (m<1||m>12||y<1920||y>new Date().getFullYear()) return false; return d>=1&&d<=new Date(y,m,0).getDate(); }
function cmToFt(cm:number): string { const ti=cm/2.54; return `${Math.floor(ti/12)}'${Math.round(ti%12)}"`; }
function ftToCm(ft:number, inc:number): number { return Math.round((ft*12+inc)*2.54); }
function convertHeightForUnitSwitch(cu:HeightUnit, hc:string, hf:string, hi:string) {
  if (cu==='cm') { const cm=parseInt(hc)||0; if (cm>=MIN_H) { const ti=cm/2.54; return { newFt:String(Math.floor(ti/12)), newIn:String(Math.round(ti%12)), newCm:hc }; } }
  else { const cm=ftToCm(parseInt(hf)||0, parseInt(hi)||0); if (cm>=MIN_H) return { newFt:hf, newIn:hi, newCm:String(cm) }; }
  return { newFt:hf, newIn:hi, newCm:hc };
}
function getPhotoLabel(type:PhotoType): string { return PHOTO_SLOTS.find(s => s.type===type)?.label ?? 'Photo'; }
function getNextPhotoSlot(photos:ProfilePhoto[]): PhotoSlotConfig|null {
  for (const slot of PHOTO_SLOTS) { if (slot.required&&!photos.some(p => p.type===slot.type)) return slot; }
  if (!photos.some(p => p.type==='full_body')) return PHOTO_SLOTS.find(s => s.type==='full_body') ?? null;
  if (photos.length<MAX_PHOTOS) return PHOTO_SLOTS.find(s => s.type==='freestyle') ?? null;
  return null;
}
function getFaceHeight(face:CloudinaryFace): number { if (Array.isArray(face)) return typeof face[3]==='number'?face[3]:0; return typeof (face as CloudinaryFaceObject).height==='number'?(face as CloudinaryFaceObject).height!:0; }
const BLOCKED_RE: RegExp[] = [ /\b(fuck|shit|ass|bitch|dick|cunt|f+u+c+k+|sh[i1]t)\b/i, /@[\w.]+/, /\b\d{7,}\b/, /[\w.]+@[\w.]+\.\w+/, /\b(snap(chat)?|insta(gram)?|ig|whatsapp|telegram|signal|kik|tiktok|onlyfans)\b/i ];
function checkBlocked(text:string): string|null { for (const r of BLOCKED_RE) { if (r.test(text)) { if (r.source.includes('@')||r.source.includes('\\d')) return 'Contact information is not allowed.'; if (r.source.includes('snap')) return 'Social media handles are not allowed.'; return 'This contains inappropriate language.'; } } return null; }
function getMissingFieldsMessage(step:number, form:FormState, hasFace:boolean, hasUpperBody:boolean, age:number|null, hCm:number): string {
  switch (step) {
    case 1: { const m:string[]=[]; if (!hasFace) m.push('face selfie'); if (!hasUpperBody) m.push('upper body photo'); return m.length>0?`Still needed: ${m.join(', ')}`:'Complete required fields'; }
    case 2: { if (!validateName(form.name).valid) return validateName(form.name).reason??'Enter a valid name'; if (age===null) return 'Enter your date of birth'; if (age<MIN_AGE) return `Must be ${MIN_AGE}+`; if (age>MAX_AGE) return 'Invalid age'; if (!form.gender) return 'Select your gender'; if (!form.interestedIn) return 'Select who you are interested in'; if (hCm<MIN_H||hCm>MAX_H) return 'Enter a valid height'; return 'Complete required fields'; }
    case 3: return 'Select your body type and preference';
    case 4: return 'Select religion, lifestyle and relationship goal';
    case 5: return 'Pick at least 3 interests';
    case 8: return 'Accept the Terms of Service to continue';
    default: return 'Complete required fields';
  }
}

const INIT: FormState = {
  photos:[], name:'', bdayMonth:'', bdayDay:'', bdayYear:'',
  gender:'', interestedIn:'', pronouns:'',
  heightCm:'', heightFt:'', heightIn:'', heightUnit:'cm',
  bodyType:'', lookingForBody:'',
  religion:'', lifestyle:'', relationship:'', education:'', occupation:'',
  smoking:'', drinking:'', children:'', pets:'', diet:'', politics:'',
  interests:[], loveLang:'', commStyle:'', firstDate:'', vibes:[],
  ageMin:'18', ageMax:'50', distKm:'50', heightPrefMinCm:'', heightPrefMaxCm:'',
  dealbreakers:[], importantFields:[],
  bio:'', prompts:[], locCity:'', locData:null, ageEstimate:null,
  blurUntilMatch:false, incognito:false, verifiedOnly:false, termsAccepted:false,
};

function reducer(state:FormState, action:Action): FormState {
  switch (action.type) {
    case 'SET':          return { ...state, [action.field]: action.value };
    case 'ADD_PHOTO':    return { ...state, photos:[...state.photos, action.photo] };
    case 'REMOVE_PHOTO': return { ...state, photos:state.photos.filter((_,i) => i!==action.index).map((p,i) => ({ ...p, order:i })) };
    case 'MOVE_PHOTO':   { const a=[...state.photos]; const [m]=a.splice(action.from,1); a.splice(action.to,0,m!); return { ...state, photos:a.map((p,i) => ({ ...p, order:i })) }; }
    case 'TOGGLE_LIST':  { const l=[...(state[action.field] as string[])]; const idx=l.indexOf(action.value); if (idx>=0) l.splice(idx,1); else { if (l.length>=(action.max??999)) return state; l.push(action.value); } return { ...state, [action.field]:l }; }
    case 'SET_PROMPT':   { const p=[...state.prompts]; p[action.index]={ q:action.q, a:action.a }; return { ...state, prompts:p }; }
    case 'ADD_PROMPT':   if (state.prompts.length>=3) return state; return { ...state, prompts:[...state.prompts,{ q:'', a:'' }] };
    case 'DEL_PROMPT':   return { ...state, prompts:state.prompts.filter((_,i) => i!==action.index) };
    case 'LOAD':         return { ...state, ...action.state };
    case 'RESET':        return INIT;
    default:             return state;
  }
}

// ─── Fix #1: Remove unused `C` param, keep type for guide overlay ─────────────
const CameraGuide = React.memo(function CameraGuide({ type, theme }:{ type:PhotoType; theme:Theme }) {
  const g = useMemo(() => makeGuideStyles(theme), [theme]);
  switch (type) {
    case 'face':       return (<View style={g.container} pointerEvents="none"><View style={g.faceOval}/><View style={g.shoulderLine}/><Text style={g.guideText}>Position your face{'\n'}inside the oval</Text></View>);
    case 'upper_body': return (<View style={g.container} pointerEvents="none"><View style={g.ubHead}/><View style={g.ubNeck}/><View style={g.ubShoulders}/><View style={g.ubTorso}/><Text style={g.guideTextBottom}>Show from{'\n'}waist up</Text></View>);
    case 'full_body':  return (<View style={g.container} pointerEvents="none"><View style={g.fbHead}/><View style={g.fbNeck}/><View style={g.fbTorso}/><View style={g.fbHips}/><View style={g.fbLegs}><View style={g.fbLeg}/><View style={g.fbLeg}/></View><Text style={g.guideTextBottom}>Stand naturally{'\n'}head to toe</Text></View>);
    default:           return (<View style={g.container} pointerEvents="none"><Text style={g.freestyleText}>📸{'\n'}Show your{'\n'}personality!</Text></View>);
  }
});

function makeGuideStyles(theme: Theme) {
  return StyleSheet.create({
    container:      { position:'absolute', top:0, left:0, right:0, bottom:0, justifyContent:'center', alignItems:'center' },
    faceOval:       { width:160, height:200, borderRadius:80, borderWidth:2, borderColor:theme.guideStroke, backgroundColor:theme.guideFill },
    shoulderLine:   { position:'absolute', bottom:'25%', width:'80%', height:2, backgroundColor:theme.guideStroke, opacity:0.5 },
    guideText:      { position:'absolute', bottom:'15%', color:theme.white, fontSize:FONT.sm, textAlign:'center', fontWeight:'600', textShadowColor:'rgba(0,0,0,0.8)', textShadowOffset:{ width:1, height:1 }, textShadowRadius:3 },
    guideTextBottom:{ position:'absolute', bottom:'8%',  color:theme.white, fontSize:FONT.sm, textAlign:'center', fontWeight:'600', textShadowColor:'rgba(0,0,0,0.8)', textShadowOffset:{ width:1, height:1 }, textShadowRadius:3 },
    freestyleText:  { color:theme.white, fontSize:FONT.xxl, textAlign:'center', fontWeight:'600', opacity:0.7 },
    ubHead:         { width:60,  height:60,  borderRadius:30,  borderWidth:2, borderColor:theme.guideStroke, backgroundColor:theme.guideFill, marginBottom:4 },
    ubNeck:         { width:20,  height:20,  backgroundColor:theme.guideFill, borderLeftWidth:2, borderRightWidth:2, borderColor:theme.guideStroke },
    ubShoulders:    { width:160, height:12,  backgroundColor:theme.guideFill, borderTopWidth:2, borderColor:theme.guideStroke, borderRadius:4 },
    ubTorso:        { width:120, height:100, backgroundColor:theme.guideFill, borderLeftWidth:2, borderRightWidth:2, borderBottomWidth:2, borderColor:theme.guideStroke, borderBottomLeftRadius:8, borderBottomRightRadius:8 },
    fbHead:         { width:44,  height:44,  borderRadius:22,  borderWidth:2, borderColor:theme.guideStroke, backgroundColor:theme.guideFill, marginBottom:2 },
    fbNeck:         { width:16,  height:16,  backgroundColor:theme.guideFill, borderLeftWidth:2, borderRightWidth:2, borderColor:theme.guideStroke },
    fbTorso:        { width:100, height:80,  backgroundColor:theme.guideFill, borderWidth:2, borderColor:theme.guideStroke, borderRadius:4 },
    fbHips:         { width:110, height:30,  backgroundColor:theme.guideFill, borderLeftWidth:2, borderRightWidth:2, borderBottomWidth:2, borderColor:theme.guideStroke },
    fbLegs:         { flexDirection:'row', gap:8 },
    fbLeg:          { width:44,  height:100, backgroundColor:theme.guideFill, borderLeftWidth:2, borderRightWidth:2, borderBottomWidth:2, borderColor:theme.guideStroke, borderBottomLeftRadius:6, borderBottomRightRadius:6 },
  });
}

const WebVideoPreview = React.memo(function WebVideoPreview({ facing, onReady }:{ facing:'front'|'back'; onReady:(el:WebVideoElement) => void }) {
  if (!IS_WEB) return null;
  return (
    <View style={staticStyles.flex1} pointerEvents="none">
      {React.createElement('video', { ref:(node:WebVideoElement|null) => { if (node) onReady(node); }, autoPlay:true, playsInline:true, muted:true, style:{ width:'100%', height:'100%', objectFit:'cover', display:'block', transform:facing==='front'?'scaleX(-1)':'none', pointerEvents:'none', touchAction:'none' } })}
    </View>
  );
});

interface Step1Props { C:Theme; photos:ProfilePhoto[]; hasFullBody:boolean; hasFace:boolean; hasUpperBody:boolean; nextSlot:PhotoSlotConfig|null; uploading:boolean; loading:boolean; uploadProgress:number; movePhoto:(from:number,to:number) => void; removePhoto:(i:number) => void; openCamera:(slot?:PhotoSlotConfig) => void; }
const Step1 = React.memo(function Step1({ C, photos, hasFullBody, hasFace, hasUpperBody, nextSlot, uploading, loading, uploadProgress, movePhoto, removePhoto, openCamera }:Step1Props) {
  // ─── Fix #2: Remove unused _extracteduseMemo1/2/3 — inline directly ──────
  const titleStyle        = useMemo(() => [st.title,{ color:C.accent }], [C]);
  const subStyle          = useMemo(() => [st.sub,{ color:C.muted }],   [C]);
  const fullBodyItemStyle = useMemo(() => [st.statusItem,{ backgroundColor:C.input, borderColor:hasFullBody?C.success:C.inputBorder }], [C, hasFullBody]);
  const fullBodyTextStyle = useMemo(() => [st.statusText,{ color:hasFullBody?C.success:C.muted }], [C, hasFullBody]);
  const loadRowStyle      = useMemo(() => [st.loadRow,{ backgroundColor:C.input }], [C]);
  const loadRowTextStyle  = useMemo(() => [st.loadRowText,{ color:C.accent }], [C]);
  const uploadBarBgStyle  = useMemo(() => [st.uploadBarBg,{ backgroundColor:C.inputBorder }], [C]);
  const uploadBarFill     = useMemo(() => (w:string) => [st.uploadBarFill,{ width:w as `${number}%`, backgroundColor:C.accent }], [C]);
  const photoImgStyle     = useMemo(() => [st.photoImg,{ borderColor:C.inputBorder }], [C]);
  const mainTagStyle      = useMemo(() => [st.mainTag,{ backgroundColor:C.accent }], [C]);
  const mainTagTextStyle  = useMemo(() => [st.mainTagText,{ color:C.white }], [C]);
  const okDotStyle        = useMemo(() => [st.okDot,{ backgroundColor:C.success }], [C]);
  const okDotTextStyle    = useMemo(() => [st.okDotText,{ color:C.white }], [C]);
  const moveBtnTextStyle  = useMemo(() => [st.moveBtnText,{ color:C.white }], [C]);
  const rmBtnStyle        = useMemo(() => [st.rmBtn,{ backgroundColor:C.danger, borderColor:C.card }], [C]);
  const rmBtnTextStyle    = useMemo(() => [st.rmBtnText,{ color:C.white }], [C]);
  const addBtnStyle       = useMemo(() => [st.addBtn,{ borderColor:C.accent, backgroundColor:C.accentGlow },(uploading||loading)&&st.addBtnOff], [C, uploading, loading]);
  const addBtnLabelStyle  = useMemo(() => [st.addBtnLabel,{ color:C.accent }], [C]);
  const addBtnReqStyle    = useMemo(() => [st.addBtnReq,{ color:C.warning }], [C]);
  const tipBoxStyle       = useMemo(() => [st.tipBox,{ backgroundColor:C.accentGlow, borderColor:C.accent }], [C]);
  const tipTextStyle      = useMemo(() => [st.tipText,{ color:C.accent }], [C]);
  const socialProofStyle  = useMemo(() => [st.socialProof,{ backgroundColor:C.card, borderColor:C.cardBorder }], [C]);
  const socialProofTStyle = useMemo(() => [st.socialProofText,{ color:C.sub }], [C]);
  const photoHintStyle    = useMemo(() => [st.photoHint,{ color:C.muted }], [C]);

  return (
    <View>
      <Text style={titleStyle}>📸 Your Photos</Text>
      <Text style={subStyle}>Camera only — real photos, real you.</Text>
      <View style={st.slotStatus}>
        {PHOTO_SLOTS.filter(s => s.required).map(slot => {
          const done = photos.some(p => p.type===slot.type);
          return (
            <View key={slot.type} style={[st.statusItem,{ backgroundColor:C.input, borderColor:done?C.success:C.inputBorder }]}>
              <Text style={st.statusIcon}>{done?'✓':slot.icon}</Text>
              <Text style={[st.statusText,{ color:done?C.success:C.muted }]}>{slot.label} *</Text>
            </View>
          );
        })}
        <View style={fullBodyItemStyle}><Text style={st.statusIcon}>{hasFullBody?'✓':'🧍'}</Text><Text style={fullBodyTextStyle}>Full Body</Text></View>
      </View>
      {uploading && (
        <View style={loadRowStyle}>
          <ActivityIndicator size="small" color={C.accent} />
          <View style={st.uploadBarWrap}>
            <Text style={loadRowTextStyle}>Uploading & verifying… {uploadProgress}%</Text>
            <View style={uploadBarBgStyle}><View style={uploadBarFill(`${uploadProgress}%`)} /></View>
          </View>
        </View>
      )}
      <View style={st.photoGrid}>
        {photos.map((p, i) => (
          <View key={p.uri} style={st.photoSlot}>
            <TurboImage source={{ uri:p.uri }} style={photoImgStyle} resizeMode="cover" cachePolicy="dataCache" accessibilityLabel={`${getPhotoLabel(p.type)} photo`} />
            <View style={st.photoTypeTag}><Text style={st.photoTypeText}>{getPhotoLabel(p.type)}</Text></View>
            {i===0&&<View style={mainTagStyle}><Text style={mainTagTextStyle}>Main</Text></View>}
            <View style={okDotStyle}><Text style={okDotTextStyle}>✓</Text></View>
            <View style={st.moveRow}>
              {i>0&&<TouchableOpacity style={st.moveBtn} onPress={() => movePhoto(i,i-1)} accessibilityLabel="Move photo left" accessibilityRole="button"><Text style={moveBtnTextStyle}>←</Text></TouchableOpacity>}
              {i<photos.length-1&&<TouchableOpacity style={st.moveBtn} onPress={() => movePhoto(i,i+1)} accessibilityLabel="Move photo right" accessibilityRole="button"><Text style={moveBtnTextStyle}>→</Text></TouchableOpacity>}
            </View>
            <TouchableOpacity style={rmBtnStyle} onPress={() => removePhoto(i)} disabled={uploading||loading} accessibilityLabel={`Remove ${getPhotoLabel(p.type)} photo`} accessibilityRole="button"><Text style={rmBtnTextStyle}>×</Text></TouchableOpacity>
          </View>
        ))}
        {nextSlot&&(<TouchableOpacity style={addBtnStyle} onPress={() => openCamera()} disabled={uploading||loading} activeOpacity={0.7} accessibilityLabel={`Add ${nextSlot.label} photo`} accessibilityRole="button"><Text style={st.addBtnIcon}>{nextSlot.icon}</Text><Text style={addBtnLabelStyle}>{nextSlot.label}</Text>{nextSlot.required&&<Text style={addBtnReqStyle}>Required</Text>}</TouchableOpacity>)}
      </View>
      {!hasFullBody&&hasFace&&hasUpperBody&&(<TouchableOpacity style={tipBoxStyle} onPress={() => openCamera(PHOTO_SLOTS[2])} activeOpacity={0.7} accessibilityLabel="Add full body photo for more matches" accessibilityRole="button"><Text style={tipTextStyle}>💡 Add a full-body photo for 40% more matches!</Text></TouchableOpacity>)}
      {photos.length===0&&(<View style={socialProofStyle}><Text style={socialProofTStyle}>📊 Profiles with 4+ photos receive 2× more matches.</Text></View>)}
      <Text style={photoHintStyle}>📌 First photo = profile photo in discover feed.</Text>
    </View>
  );
});

interface Step2Props { C:Theme; form:FormState; age:number|null; zodiac:ZodiacResult|null; birthday:Date|null; hCm:number; hDisplay:string; loading:boolean; set:(f:keyof FormState,v:FormState[keyof FormState]) => void; renderChip:(value:string,selected:boolean,onPress:() => void,icon?:string,disabled?:boolean) => React.ReactElement; switchHeightUnit:() => void; }
const Step2 = React.memo(function Step2({ C, form, age, zodiac, birthday, hCm, hDisplay, loading, set, renderChip, switchHeightUnit }:Step2Props) {
  const titleStyle      = useMemo(() => [st.title,{ color:C.accent }], [C]);
  const labelStyle      = useMemo(() => [st.label,{ color:C.text }], [C]);
  const nameInputStyle  = useMemo(() => [st.input,{ backgroundColor:C.input, color:C.text, borderColor:C.inputBorder },form.name.length>0&&!validateName(form.name).valid&&{ borderColor:C.danger },validateName(form.name).valid&&{ borderColor:C.success }], [C, form.name]);
  const handleNameChange   = useCallback((t:string) => set('name', t.replace(/[^a-zA-Z\s\-']/g,'')), [set]);
  const handleNameBlur     = useCallback(() => { if (form.name) set('name', formatName(form.name)); }, [form.name, set]);
  const errStyle        = useMemo(() => [st.err,{ color:C.danger }], [C]);
  const bdayInStyle     = useMemo(() => [st.input,st.bdayIn,{ backgroundColor:C.input, color:C.text, borderColor:C.inputBorder }], [C]);
  const handleMonthChange  = useCallback((t:string) => set('bdayMonth', t.replace(/\D/g,'').slice(0,2)), [set]);
  const bdaySepStyle    = useMemo(() => [st.bdaySep,{ color:C.muted }], [C]);
  const handleDayChange    = useCallback((t:string) => set('bdayDay', t.replace(/\D/g,'').slice(0,2)), [set]);
  const bdayInYStyle    = useMemo(() => [st.input,st.bdayInY,{ backgroundColor:C.input, color:C.text, borderColor:C.inputBorder }], [C]);
  const handleYearChange   = useCallback((t:string) => set('bdayYear', t.replace(/\D/g,'').slice(0,4)), [set]);
  const ageDisplayStyle = useMemo(() => [st.ageDisplay,{ color:age!==null&&age>=MIN_AGE&&age<=MAX_AGE?C.success:C.danger }], [C, age]);
  const zodiacStyle     = useMemo(() => [st.zodiac,{ color:C.accent }], [C]);
  const warnStyle       = useMemo(() => [st.warn,{ color:C.warning }], [C]);
  const unitBtnStyle    = useMemo(() => [st.unitBtn,{ backgroundColor:C.input, borderColor:C.accent }], [C]);
  const unitBtnTStyle   = useMemo(() => [st.unitBtnText,{ color:C.accent }], [C]);
  const cmInputStyle    = useMemo(() => [st.input,{ backgroundColor:C.input, color:C.text, borderColor:C.inputBorder },form.heightCm.length>0&&(hCm<MIN_H||hCm>MAX_H)&&{ borderColor:C.danger },hCm>=MIN_H&&hCm<=MAX_H&&{ borderColor:C.success }], [C, form.heightCm, hCm]);
  const handleCmChange     = useCallback((t:string) => set('heightCm',t.replace(/\D/g,'')), [set]);
  const ftInStyle       = useMemo(() => [st.input,st.ftIn,{ backgroundColor:C.input, color:C.text, borderColor:C.inputBorder }], [C]);
  const handleFtChange     = useCallback((t:string) => set('heightFt',t.replace(/\D/g,'').slice(0,1)), [set]);
  const ftLblStyle      = useMemo(() => [st.ftLbl,{ color:C.muted }], [C]);
  const hPreviewStyle   = useMemo(() => [st.hPreview,{ color:C.success }], [C]);
  const handleInChange     = useCallback((t:string) => { const c=t.replace(/\D/g,''); if (c==='') { set('heightIn',''); return; } if (parseInt(c)>11) { showAlert('Invalid','Inches must be 0–11.'); return; } set('heightIn',c); }, [set]);

  return (
    <View>
      <Text style={titleStyle}>👤 Basic Info</Text>
      <View style={st.fg}>
        <Text style={labelStyle}>First Name <Text style={{ color:C.danger }}>*</Text></Text>
        <TextInput style={nameInputStyle} placeholder="Sarah" placeholderTextColor={C.muted} value={form.name} onChangeText={handleNameChange} onBlur={handleNameBlur} editable={!loading} maxLength={MAX_NAME} autoCapitalize="words" autoCorrect={false} accessibilityLabel="First name" accessibilityHint="Enter your first name" />
        {form.name.length>0&&!validateName(form.name).valid&&<Text style={errStyle}>{validateName(form.name).reason}</Text>}
      </View>
      <View style={st.fg}>
        <Text style={labelStyle}>Date of Birth <Text style={{ color:C.danger }}>*</Text></Text>
        <View style={st.bdayRow}>
          <TextInput style={bdayInStyle} placeholder="MM" placeholderTextColor={C.muted} value={form.bdayMonth} onChangeText={handleMonthChange} keyboardType="number-pad" maxLength={2} editable={!loading} accessibilityLabel="Birth month" />
          <Text style={bdaySepStyle}>/</Text>
          <TextInput style={bdayInStyle} placeholder="DD" placeholderTextColor={C.muted} value={form.bdayDay} onChangeText={handleDayChange} keyboardType="number-pad" maxLength={2} editable={!loading} accessibilityLabel="Birth day" />
          <Text style={bdaySepStyle}>/</Text>
          <TextInput style={bdayInYStyle} placeholder="YYYY" placeholderTextColor={C.muted} value={form.bdayYear} onChangeText={handleYearChange} keyboardType="number-pad" maxLength={4} editable={!loading} accessibilityLabel="Birth year" />
        </View>
        {birthday&&age!==null&&(<View style={st.ageRow}><Text style={ageDisplayStyle}>Age: {age} {age<MIN_AGE?'(Must be 18+)':age>MAX_AGE?'(Invalid)':'✓'}</Text>{zodiac&&<Text style={zodiacStyle}>{zodiac.emoji} {zodiac.sign}</Text>}</View>)}
        {form.ageEstimate!=null&&age!=null&&Math.abs(age-form.ageEstimate)>AGE_TOL&&<Text style={warnStyle}>⚠️ Photos suggest ~{form.ageEstimate} years old</Text>}
      </View>
      <View style={st.fg}><Text style={labelStyle}>Gender <Text style={{ color:C.danger }}>*</Text></Text><View style={st.chipWrap}>{GENDER_OPTIONS.map(g => renderChip(g.value, form.gender===g.value, () => set('gender',g.value), g.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Interested In <Text style={{ color:C.danger }}>*</Text></Text><View style={st.chipWrap}>{INTERESTED_IN_OPTIONS.map(o => renderChip(o.value, form.interestedIn===o.value, () => set('interestedIn',o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Pronouns</Text><View style={st.chipWrap}>{PRONOUN_OPTIONS.map(p => renderChip(p.value, form.pronouns===p.value, () => set('pronouns',form.pronouns===p.value?'':p.value)))}</View></View>
      <View style={st.fg}>
        <View style={st.labelRow}><Text style={labelStyle}>Height <Text style={{ color:C.danger }}>*</Text></Text><TouchableOpacity style={unitBtnStyle} onPress={switchHeightUnit} activeOpacity={0.7} accessibilityLabel={`Switch to ${form.heightUnit==='cm'?'feet and inches':'centimetres'}`} accessibilityRole="button"><Text style={unitBtnTStyle}>{form.heightUnit==='cm'?'Switch to ft/in':'Switch to cm'}</Text></TouchableOpacity></View>
        {form.heightUnit==='cm' ? (<TextInput style={cmInputStyle} placeholder="170" placeholderTextColor={C.muted} value={form.heightCm} onChangeText={handleCmChange} keyboardType="number-pad" maxLength={3} editable={!loading} accessibilityLabel="Height in centimetres" />) : (<View style={st.ftRow}><TextInput style={ftInStyle} placeholder="5" placeholderTextColor={C.muted} value={form.heightFt} onChangeText={handleFtChange} keyboardType="number-pad" maxLength={1} editable={!loading} accessibilityLabel="Height feet" /><Text style={ftLblStyle}>ft</Text><TextInput style={ftInStyle} placeholder="8" placeholderTextColor={C.muted} value={form.heightIn} onChangeText={handleInChange} keyboardType="number-pad" maxLength={2} editable={!loading} accessibilityLabel="Height inches" /><Text style={ftLblStyle}>in</Text></View>)}
        {hDisplay!==''&&<Text style={hPreviewStyle}>📏 {hDisplay}</Text>}
      </View>
    </View>
  );
});

interface Step3Props { C:Theme; bodyType:string; lookingForBody:string; loading:boolean; set:(f:keyof FormState,v:FormState[keyof FormState]) => void; }
const Step3 = React.memo(function Step3({ C, bodyType, lookingForBody, loading, set }:Step3Props) {
  const titleStyle = useMemo(() => [st.title,{ color:C.accent }], [C]);
  const handleBodyType        = useCallback((v:string) => set('bodyType',v as BodyType), [set]);
  const handleLookingForBody  = useCallback((v:string) => set('lookingForBody',v as BodyType), [set]);
  return (<View><Text style={titleStyle}>💪 Body & Appearance</Text><BodyTypeSelector label="Your Body Type *" selectedType={bodyType as BodyType} onSelect={handleBodyType} disabled={loading} /><View style={st.spacer} /><BodyTypeSelector label="Body Type Preference *" selectedType={lookingForBody as BodyType} onSelect={handleLookingForBody} disabled={loading} showLookingFor /></View>);
});

interface Step4Props { C:Theme; form:FormState; loading:boolean; set:(f:keyof FormState,v:FormState[keyof FormState]) => void; renderChip:(value:string,selected:boolean,onPress:() => void,icon?:string,disabled?:boolean) => React.ReactElement; renderOpt:(opt:OptionItem,sel:string,onSel:(v:string) => void) => React.ReactElement; }
const Step4 = React.memo(function Step4({ C, form, loading, set, renderChip, renderOpt }:Step4Props) {
  const titleStyle      = useMemo(() => [st.title,{ color:C.accent }], [C]);
  const labelStyle      = useMemo(() => [st.label,{ color:C.text }], [C]);
  const occupationStyle = useMemo(() => [st.input,{ backgroundColor:C.input, color:C.text, borderColor:C.inputBorder }], [C]);
  const handleOccupation = useCallback((t:string) => { const b=checkBlocked(t); if (b) { showAlert('Not Allowed',b); return; } set('occupation',t); }, [set]);

  return (
    <View>
      <Text style={titleStyle}>🌟 Lifestyle & Values</Text>
      <View style={st.fg}><Text style={labelStyle}>Religious Views <Text style={{ color:C.danger }}>*</Text></Text>{RELIGIOUS_OPTIONS.map(o => renderOpt(o, form.religion, v => set('religion',v)))}</View>
      <View style={st.fg}><Text style={labelStyle}>Lifestyle <Text style={{ color:C.danger }}>*</Text></Text><View style={st.chipWrap}>{LIFESTYLE_OPTIONS.map(o => renderChip(o.value, form.lifestyle===o.value, () => set('lifestyle',o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Relationship Goal <Text style={{ color:C.danger }}>*</Text></Text>{RELATIONSHIP_OPTIONS.map(o => renderOpt(o, form.relationship, v => set('relationship',v)))}</View>
      <View style={st.fg}><Text style={labelStyle}>Education</Text><View style={st.chipWrap}>{EDUCATION_OPTIONS.map(o => renderChip(o.value, form.education===o.value, () => set('education',form.education===o.value?'':o.value), o.icon))}</View></View>
      <TextInput style={occupationStyle} placeholder="Software Engineer…" placeholderTextColor={C.muted} value={form.occupation} onChangeText={handleOccupation} editable={!loading} maxLength={50} autoCapitalize="words" accessibilityLabel="Occupation" accessibilityHint="Enter your job or profession" />
      <View style={st.fg}><Text style={labelStyle}>Smoking</Text><View style={st.chipWrap}>{SMOKING_OPTIONS.map(o => renderChip(o.value, form.smoking===o.value, () => set('smoking',form.smoking===o.value?'':o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Drinking</Text><View style={st.chipWrap}>{DRINKING_OPTIONS.map(o => renderChip(o.value, form.drinking===o.value, () => set('drinking',form.drinking===o.value?'':o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Children</Text><View style={st.chipWrap}>{CHILDREN_OPTIONS.map(o => renderChip(o.value, form.children===o.value, () => set('children',form.children===o.value?'':o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Pets</Text><View style={st.chipWrap}>{PET_OPTIONS.map(o => renderChip(o.value, form.pets===o.value, () => set('pets',form.pets===o.value?'':o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Diet</Text><View style={st.chipWrap}>{DIET_OPTIONS.map(o => renderChip(o.value, form.diet===o.value, () => set('diet',form.diet===o.value?'':o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Political Views</Text><View style={st.chipWrap}>{POLITICAL_OPTIONS.map(o => renderChip(o.value, form.politics===o.value, () => set('politics',form.politics===o.value?'':o.value), o.icon))}</View></View>
    </View>
  );
});

interface Step5Props { C:Theme; form:FormState; haptic:() => void; set:(f:keyof FormState,v:FormState[keyof FormState]) => void; dispatch:React.Dispatch<Action>; renderChip:(value:string,selected:boolean,onPress:() => void,icon?:string,disabled?:boolean) => React.ReactElement; renderOpt:(opt:OptionItem,sel:string,onSel:(v:string) => void) => React.ReactElement; }
const Step5 = React.memo(function Step5({ C, form, haptic, set, dispatch, renderChip, renderOpt }:Step5Props) {
  const titleStyle = useMemo(() => [st.title,{ color:C.accent }], [C]);
  const labelStyle = useMemo(() => [st.label,{ color:C.text }], [C]);
  const hintStyle  = useMemo(() => [st.hint,{ color:C.muted }], [C]);

  return (
    <View>
      <Text style={titleStyle}>✨ Interests & Personality</Text>
      <View style={st.fg}><Text style={labelStyle}>Interests <Text style={{ color:C.danger }}>*</Text></Text><Text style={hintStyle}>Pick 3–10 · {form.interests.length}/10</Text><View style={st.chipWrap}>{INTEREST_TAGS.map(t => renderChip(t, form.interests.includes(t), () => dispatch({ type:'TOGGLE_LIST', field:'interests', value:t, max:10 }), undefined, !form.interests.includes(t)&&form.interests.length>=10))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Love Language</Text>{LOVE_LANGUAGE_OPTIONS.map(o => renderOpt(o, form.loveLang, v => set('loveLang',form.loveLang===v?'':v)))}</View>
      <View style={st.fg}><Text style={labelStyle}>Communication Style</Text><View style={st.chipWrap}>{COMMUNICATION_OPTIONS.map(o => renderChip(o.value, form.commStyle===o.value, () => set('commStyle',form.commStyle===o.value?'':o.value), o.icon))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>Preferred First Date</Text><View style={st.chipWrap}>{FIRST_DATE_OPTIONS.map(o => renderChip(o.value, form.firstDate===o.value, () => set('firstDate',form.firstDate===o.value?'':o.value), o.icon))}</View></View>
      <View style={st.fg}>
        <Text style={labelStyle}>Your Vibes</Text>
        <Text style={hintStyle}>Pick up to 3</Text>
        <View style={st.vibeGrid}>
          {VIBE_EMOJIS.map(e => {
            const sel = form.vibes.includes(e);
            const mx  = !sel && form.vibes.length >= 3;
            return (
              <TouchableOpacity
                key={e}
                style={[st.vibeItem,{ backgroundColor:C.input, borderColor:sel?C.accent:C.inputBorder },sel&&{ backgroundColor:C.accentGlow },mx&&st.chipOff]}
                onPress={() => { haptic(); dispatch({ type:'TOGGLE_LIST', field:'vibes', value:e, max:3 }); }}
                disabled={mx}
                activeOpacity={0.7}
                accessibilityLabel={`Vibe ${e}${sel?', selected':''}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked:sel, disabled:mx }}
              >
                <Text style={st.vibeEmoji}>{e}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
});

interface Step6Props { C:Theme; form:FormState; loading:boolean; set:(f:keyof FormState,v:FormState[keyof FormState]) => void; dispatch:React.Dispatch<Action>; renderChip:(value:string,selected:boolean,onPress:() => void,icon?:string,disabled?:boolean) => React.ReactElement; }
const Step6 = React.memo(function Step6({ C, form, loading, set, dispatch, renderChip }:Step6Props) {
  const titleStyle    = useMemo(() => [st.title,{ color:C.accent }], [C]);
  const labelStyle    = useMemo(() => [st.label,{ color:C.text }], [C]);
  const hintStyle     = useMemo(() => [st.hint,{ color:C.muted }], [C]);
  const rangeInStyle  = useMemo(() => [st.input,st.rangeIn,{ backgroundColor:C.input, color:C.text, borderColor:C.inputBorder }], [C]);
  const rangeDashStyle= useMemo(() => [st.rangeDash,{ color:C.muted }], [C]);
  const rangeUStyle   = useMemo(() => [st.rangeU,{ color:C.muted }], [C]);

  const handleAgeMin      = useCallback((t:string) => set('ageMin',t.replace(/\D/g,'')), [set]);
  const handleAgeMax      = useCallback((t:string) => set('ageMax',t.replace(/\D/g,'')), [set]);
  const handleDist        = useCallback((t:string) => set('distKm',t.replace(/\D/g,'')), [set]);
  const handleHeightMin   = useCallback((t:string) => set('heightPrefMinCm',t.replace(/\D/g,'')), [set]);
  const handleHeightMax   = useCallback((t:string) => set('heightPrefMaxCm',t.replace(/\D/g,'')), [set]);

  return (
    <View>
      <Text style={titleStyle}>🎯 Preferences & Deal-breakers</Text>
      <View style={st.fg}><Text style={labelStyle}>Age Range</Text><View style={st.rangeRow}><TextInput style={rangeInStyle} placeholder="18" placeholderTextColor={C.muted} value={form.ageMin} onChangeText={handleAgeMin} keyboardType="number-pad" maxLength={2} editable={!loading} accessibilityLabel="Minimum age preference" /><Text style={rangeDashStyle}>—</Text><TextInput style={rangeInStyle} placeholder="50" placeholderTextColor={C.muted} value={form.ageMax} onChangeText={handleAgeMax} keyboardType="number-pad" maxLength={2} editable={!loading} accessibilityLabel="Maximum age preference" /><Text style={rangeUStyle}>years</Text></View></View>
      <View style={st.fg}><Text style={labelStyle}>Maximum Distance</Text><View style={st.rangeRow}><TextInput style={rangeInStyle} placeholder="50" placeholderTextColor={C.muted} value={form.distKm} onChangeText={handleDist} keyboardType="number-pad" maxLength={4} editable={!loading} accessibilityLabel="Maximum distance in kilometres" /><Text style={rangeUStyle}>km</Text></View></View>
      <View style={st.fg}><Text style={labelStyle}>Height Preference (cm)</Text><View style={st.rangeRow}><TextInput style={rangeInStyle} placeholder="150" placeholderTextColor={C.muted} value={form.heightPrefMinCm} onChangeText={handleHeightMin} keyboardType="number-pad" maxLength={3} editable={!loading} accessibilityLabel="Minimum height preference in centimetres" /><Text style={rangeDashStyle}>—</Text><TextInput style={rangeInStyle} placeholder="200" placeholderTextColor={C.muted} value={form.heightPrefMaxCm} onChangeText={handleHeightMax} keyboardType="number-pad" maxLength={3} editable={!loading} accessibilityLabel="Maximum height preference in centimetres" /><Text style={rangeUStyle}>cm</Text></View></View>
      <View style={st.fg}><Text style={labelStyle}>Deal-breakers</Text><Text style={hintStyle}>Up to 5 · {form.dealbreakers.length}/5</Text><View style={st.chipWrap}>{DEALBREAKER_TAGS.map(t => renderChip(t, form.dealbreakers.includes(t), () => dispatch({ type:'TOGGLE_LIST', field:'dealbreakers', value:t, max:5 }), undefined, !form.dealbreakers.includes(t)&&form.dealbreakers.length>=5))}</View></View>
      <View style={st.fg}><Text style={labelStyle}>What matters most?</Text><View style={st.chipWrap}>{IMPORTANT_FIELD_OPTIONS.map(f => renderChip(f, form.importantFields.includes(f), () => dispatch({ type:'TOGGLE_LIST', field:'importantFields', value:f })))}</View></View>
    </View>
  );
});

interface Step7Props { C:Theme; form:FormState; loading:boolean; gettingLoc:boolean; set:(f:keyof FormState,v:FormState[keyof FormState]) => void; dispatch:React.Dispatch<Action>; getLoc:() => void; promptPicker:number|null; setPromptPicker:(v:number|null) => void; }
const Step7 = React.memo(function Step7({ C, form, loading, gettingLoc, set, dispatch, getLoc, setPromptPicker }:Step7Props) {
  const titleStyle    = useMemo(() => [st.title,{ color:C.accent }], [C]);
  const labelStyle    = useMemo(() => [st.label,{ color:C.text }], [C]);
  const bioSugStyle   = useMemo(() => [st.bioSuggestion,{ color:C.accent }], [C]);
  const bioInStyle    = useMemo(() => [st.bioIn,{ backgroundColor:C.input, color:C.text, borderColor:C.inputBorder }], [C]);
  const charCtStyle   = useMemo(() => [st.charCt,{ color:form.bio.length>=MAX_BIO*0.9?C.warning:C.muted }], [C, form.bio.length]);
  const promptCardStyle  = useMemo(() => [st.promptCard,{ backgroundColor:C.input, borderColor:C.inputBorder }], [C]);
  const promptQTextStyle = useMemo(() => [st.promptQText,{ color:C.accent }], [C]);
  const promptArrStyle   = useMemo(() => [st.promptArr,{ color:C.accent }], [C]);
  const promptInStyle    = useMemo(() => [st.promptIn,{ backgroundColor:C.card, color:C.text, borderColor:C.inputBorder }], [C]);
  const promptRmStyle    = useMemo(() => [st.promptRmText,{ color:C.danger }], [C]);
  const addPromptStyle   = useMemo(() => [st.addPrompt,{ borderColor:C.accent }], [C]);
  const addPromptTStyle  = useMemo(() => [st.addPromptText,{ color:C.accent }], [C]);
  const locBtnStyle   = useMemo(() => [st.locBtn,{ backgroundColor:C.input, borderColor:form.locCity!==''?C.success:C.inputBorder },(gettingLoc||loading)&&st.btnOff], [C, form.locCity, gettingLoc, loading]);
  const locBtnTStyle  = useMemo(() => [st.locBtnText,{ color:C.accent }], [C]);
  const locConfStyle  = useMemo(() => [st.locConf,{ color:C.success }], [C]);
  const handleBio     = useCallback((t:string) => { const c=t.slice(0,MAX_BIO); const b=checkBlocked(c); if (b) { showAlert('Not Allowed',b); return; } set('bio',c); }, [set]);

  return (
    <View>
      <Text style={titleStyle}>💬 About You</Text>
      <View style={st.fg}>
        <Text style={labelStyle}>Bio</Text>
        {form.bio.length===0&&(<TouchableOpacity onPress={() => set('bio',"I'm a curious soul who loves exploring new places and good conversations over coffee. ☕")} activeOpacity={0.7} accessibilityLabel="Load example bio" accessibilityRole="button"><Text style={bioSugStyle}>💡 Tap to see an example bio</Text></TouchableOpacity>)}
        <TextInput style={bioInStyle} placeholder="What makes you unique…" placeholderTextColor={C.muted} value={form.bio} onChangeText={handleBio} multiline maxLength={MAX_BIO} editable={!loading} textAlignVertical="top" accessibilityLabel="Bio" accessibilityHint="Describe yourself" />
        <Text style={charCtStyle}>{form.bio.length}/{MAX_BIO}</Text>
      </View>
      <View style={st.fg}>
        <Text style={labelStyle}>Profile Prompts</Text>
        {form.prompts.map((p, i) => {
          const promptCharCtStyle = [st.charCt,{ color:p.a.length>=MAX_PROMPT*0.9?C.warning:C.muted }];
          const handlePromptAnswer = (t:string) => { const c=t.slice(0,MAX_PROMPT); const b=checkBlocked(c); if (b) { showAlert('Not Allowed',b); return; } dispatch({ type:'SET_PROMPT', index:i, q:p.q, a:c }); };
          return (
            <View key={`${i}_${p.q}`} style={promptCardStyle}>
              <TouchableOpacity style={st.promptQ} onPress={() => setPromptPicker(i)} activeOpacity={0.7} accessibilityLabel={p.q||'Choose a prompt question'} accessibilityRole="button"><Text style={promptQTextStyle}>{p.q||'Tap to pick a question…'}</Text><Text style={promptArrStyle}>▼</Text></TouchableOpacity>
              {p.q!==''&&<TextInput style={promptInStyle} placeholder="Your answer…" placeholderTextColor={C.muted} value={p.a} onChangeText={handlePromptAnswer} multiline maxLength={MAX_PROMPT} editable={!loading} textAlignVertical="top" accessibilityLabel={`Answer to: ${p.q}`} />}
              {p.q!==''&&<Text style={promptCharCtStyle}>{p.a.length}/{MAX_PROMPT}</Text>}
              <TouchableOpacity style={st.promptRm} onPress={() => dispatch({ type:'DEL_PROMPT', index:i })} accessibilityLabel="Remove prompt" accessibilityRole="button"><Text style={promptRmStyle}>✕ Remove</Text></TouchableOpacity>
            </View>
          );
        })}
        {form.prompts.length<3&&(<TouchableOpacity style={addPromptStyle} onPress={() => dispatch({ type:'ADD_PROMPT' })} activeOpacity={0.7} accessibilityLabel="Add a profile prompt" accessibilityRole="button"><Text style={addPromptTStyle}>+ Add Prompt</Text></TouchableOpacity>)}
      </View>
      <View style={st.fg}>
        <Text style={labelStyle}>📍 Location</Text>
        <TouchableOpacity style={locBtnStyle} onPress={getLoc} disabled={gettingLoc||loading} activeOpacity={0.7} accessibilityLabel={form.locCity||'Enable location'} accessibilityRole="button">
          {gettingLoc ? <View style={st.locRow}><ActivityIndicator size="small" color={C.accent} /><Text style={locBtnTStyle}>Getting Location…</Text></View> : <View style={st.locRow}><Text>{form.locCity?'✓':'📍'}</Text><Text style={locBtnTStyle}>{form.locCity||'Enable Location'}</Text></View>}
        </TouchableOpacity>
        {form.locCity!==''&&<Text style={locConfStyle}>📍 {form.locCity}</Text>}
      </View>
    </View>
  );
});

interface Step8Props { C:Theme; form:FormState; age:number|null; zodiac:ZodiacResult|null; hDisplay:string; pct:number; set:(f:keyof FormState,v:FormState[keyof FormState]) => void; }
const Step8 = React.memo(function Step8({ C, form, age, zodiac, hDisplay, pct, set }:Step8Props) {
  const titleStyle        = useMemo(() => [st.title,{ color:C.accent }], [C]);
  const privacyCardStyle  = useMemo(() => [st.privacyCard,{ backgroundColor:C.card, borderColor:C.cardBorder }], [C]);
  const privacyTitleStyle = useMemo(() => [st.privacyTitle,{ color:C.text }], [C]);
  const privRowStyle      = useMemo(() => [st.privRow,{ borderBottomColor:C.inputBorder }], [C]);
  const privLabelStyle    = useMemo(() => [st.privLabel,{ color:C.text }], [C]);
  const privDescStyle     = useMemo(() => [st.privDesc,{ color:C.muted }], [C]);
  // ─── Fix #3: _extracteduseCallback130 was unused — now properly named ────
  const handleBlurUntilMatch = useCallback((v:boolean) => set('blurUntilMatch',v), [set]);
  const previewLabelStyle = useMemo(() => [st.previewLabel,{ color:C.sub }], [C]);
  const previewStyle      = useMemo(() => [st.preview,{ backgroundColor:C.card, borderColor:C.cardBorder }], [C]);
  const previewThumbStyle = useMemo(() => [st.previewThumb, form.blurUntilMatch&&{ opacity:0.15 }], [form.blurUntilMatch]);
  const blurTextStyle     = useMemo(() => [st.blurText,{ color:C.accent }], [C]);
  const previewNameStyle  = useMemo(() => [st.previewName,{ color:C.text }], [C]);
  const previewSubStyle   = useMemo(() => [st.previewSub,{ color:C.muted }], [C]);
  const previewDetStyle   = useMemo(() => [st.previewDetail,{ color:C.sub }], [C]);
  const previewBioStyle   = useMemo(() => [st.previewBio,{ color:C.text }], [C]);
  const previewTagStyle   = useMemo(() => [st.previewTag,{ backgroundColor:C.input }], [C]);
  const previewTagTStyle  = useMemo(() => [st.previewTagText,{ color:C.accent }], [C]);
  const previewMoreStyle  = useMemo(() => [st.previewMore,{ color:C.muted }], [C]);
  const previewPhotoCtSt  = useMemo(() => [st.previewPhotoCt,{ color:C.muted }], [C]);
  const pctCardStyle      = useMemo(() => [st.pctCard,{ backgroundColor:C.card, borderColor:C.cardBorder }], [C]);
  const pctTitleStyle     = useMemo(() => [st.pctTitle,{ color:C.text }], [C]);
  const pctBarBgStyle     = useMemo(() => [st.pctBarBg,{ backgroundColor:C.inputBorder }], [C]);
  const pctBarFillStyle   = useMemo(() => [st.pctBarFill,{ width:`${pct}%` as `${number}%`, backgroundColor:pct>=80?C.success:pct>=50?C.warning:C.danger }], [C, pct]);
  const pctHintStyle      = useMemo(() => [st.pctHint,{ color:C.muted }], [C]);
  const termsRowStyle     = useMemo(() => [st.termsRow,{ backgroundColor:C.card, borderColor:C.cardBorder }], [C]);
  const handleTerms       = useCallback((v:boolean) => set('termsAccepted',v), [set]);
  const termsTextStyle    = useMemo(() => [st.termsText,{ color:C.sub }], [C]);
  const termsLinkStyle    = useMemo(() => [st.termsLink,{ color:C.accent }], [C]);
  const handleTermsPress  = useCallback(() => { void Linking.openURL('https://myarchetype.vercel.app/terms'); }, []);
  const handlePrivacyPress= useCallback(() => { void Linking.openURL('https://myarchetype.vercel.app/privacy'); }, []);

  return (
    <View>
      <Text style={titleStyle}>👀 Preview & Privacy</Text>
      <View style={privacyCardStyle}>
        <Text style={privacyTitleStyle}>🔒 Privacy Settings</Text>
        {([
          { key:'blurUntilMatch' as const, label:'🔵 Blur photos until match', desc:'Photos blur until you match.', val:form.blurUntilMatch },
          { key:'incognito'      as const, label:'👻 Incognito mode',           desc:'Only people you like first see you.', val:form.incognito },
          { key:'verifiedOnly'   as const, label:'✅ Verified users only',      desc:'Only verified users discover you.', val:form.verifiedOnly },
        ] as const).map(pi => (
          <View key={pi.key} style={privRowStyle}>
            <View style={st.privInfo}><Text style={privLabelStyle}>{pi.label}</Text><Text style={privDescStyle}>{pi.desc}</Text></View>
            <Switch
              value={pi.val}
              onValueChange={pi.key === 'blurUntilMatch' ? handleBlurUntilMatch : (v) => set(pi.key, v)}
              trackColor={{ false:C.inputBorder, true:C.accent }}
              thumbColor={pi.val?C.success:C.dim}
              accessibilityLabel={pi.label}
              accessibilityRole="switch"
              accessibilityState={{ checked:pi.val }}
            />
          </View>
        ))}
      </View>
      <Text style={previewLabelStyle}>How others see you:</Text>
      <View style={previewStyle}>
        {form.photos.length>0&&(<View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.previewPhotoScroll}>{form.photos.map(p => (<TurboImage key={p.uri} source={{ uri:p.uri }} style={previewThumbStyle} resizeMode="cover" cachePolicy="dataCache" accessibilityLabel={`${getPhotoLabel(p.type)} preview`} />))}</ScrollView>{form.blurUntilMatch&&(<View style={st.blurOverlay}><Text style={blurTextStyle}>🔒 Blurred until match</Text></View>)}</View>)}
        <View style={st.previewInfo}>
          <Text style={previewNameStyle}>{formatName(form.name)||'Your Name'}, {age??'??'}{zodiac?` ${zodiac.emoji}`:''}</Text>
          {form.pronouns!==''&&<Text style={previewSubStyle}>{form.pronouns}</Text>}
          {hDisplay!==''&&<Text style={previewDetStyle}>📏 {hDisplay}</Text>}
          {form.occupation.trim()!==''&&<Text style={previewDetStyle}>💼 {form.occupation}</Text>}
          {form.locCity!==''&&<Text style={previewDetStyle}>📍 {form.locCity}</Text>}
          {form.vibes.length>0&&<Text style={st.previewVibes}>{form.vibes.join(' ')}</Text>}
          {form.bio.trim()!==''&&<Text style={previewBioStyle}>{form.bio.trim()}</Text>}
          {form.interests.length>0&&(<View style={st.previewTags}>{form.interests.slice(0,5).map(t => <View key={t} style={previewTagStyle}><Text style={previewTagTStyle}>{t}</Text></View>)}{form.interests.length>5&&<Text style={previewMoreStyle}>+{form.interests.length-5} more</Text>}</View>)}
          <Text style={previewPhotoCtSt}>📸 {form.photos.length} photo{form.photos.length!==1?'s':''}</Text>
        </View>
      </View>
      <View style={pctCardStyle}>
        <Text style={pctTitleStyle}>Profile Completion: {pct}%</Text>
        <View style={pctBarBgStyle}><View style={pctBarFillStyle} /></View>
        {pct<100&&<Text style={pctHintStyle}>Complete more fields to increase visibility!</Text>}
      </View>
      <View style={termsRowStyle}>
        <Switch value={form.termsAccepted} onValueChange={handleTerms} trackColor={{ false:C.inputBorder, true:C.accent }} thumbColor={form.termsAccepted?C.success:C.dim} accessibilityLabel="Accept terms of service" accessibilityRole="switch" accessibilityState={{ checked:form.termsAccepted }} />
        <View style={staticStyles.flex1}>
          <Text style={termsTextStyle}>
            I agree to the{' '}
            <Text style={termsLinkStyle} onPress={handleTermsPress}>Terms of Service</Text>
            {' '}and{' '}
            <Text style={termsLinkStyle} onPress={handlePrivacyPress}>Privacy Policy</Text>
          </Text>
        </View>
      </View>
    </View>
  );
});

const staticStyles = StyleSheet.create({ flex1:{ flex:1 }, absoluteFill:{ position:'absolute', top:0, left:0, right:0, bottom:0 } });

export default function ProfileSetupScreen() {
  const router                 = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const colorScheme = useColorScheme();
  const C: Theme    = colorScheme !== 'light' ? darkTokens : lightTokens;

  const [userId,    setUserId]    = useState<string|null>(null);
  const [userEmail, setUserEmail] = useState<string|null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      if (u) { setUserId(u.uid); setUserEmail(u.email); }
      else router.replace('/login' as Parameters<typeof router.replace>[0]);
    });
    return unsub;
  }, [router]);

  const [form, dispatch] = useReducer(reducer, INIT);
  const set = useCallback((f:keyof FormState, v:FormState[keyof FormState]) => dispatch({ type:'SET', field:f, value:v }), []);

  const [step,           setStep]           = useState(1);
  const [loading,        setLoading]        = useState(false);
  const [uploading,      setUploading]      = useState(false);
  const [capturing,      setCapturing]      = useState(false);
  const [gettingLoc,     setGettingLoc]     = useState(false);
  const [camOpen,        setCamOpen]        = useState(false);
  const [camReady,       setCamReady]       = useState(false);
  const [camErr,         setCamErr]         = useState<string|null>(null);
  const [camSlot,        setCamSlot]        = useState<PhotoSlotConfig|null>(null);
  const [camFacing,      setCamFacing]      = useState<'front'|'back'>('front');
  const [timerEnabled,   setTimerEnabled]   = useState(false);
  const [countdown,      setCountdown]      = useState<number|null>(null);
  const [promptPicker,   setPromptPicker]   = useState<number|null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const isMountedRef  = useRef(true);
  const scrollRef     = useRef<ScrollView>(null);
  const cameraRef     = useRef<CameraView>(null);
  const streamRef     = useRef<WebMediaStream|null>(null);
  const countdownRef  = useRef<ReturnType<typeof setInterval>|null>(null);
  const isDirtyRef    = useRef(false);
  const webVideoElRef = useRef<WebVideoElement|null>(null);
  const capturingRef  = useRef(false);
  const readyPollRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const fadeAnim  = useSharedValue(1);
  const slideAnim = useSharedValue(0);
  const progAnim  = useSharedValue(0);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.value, transform: [{ translateX: slideAnim.value }] }));

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (readyPollRef.current) clearInterval(readyPollRef.current);
    };
  }, []);

  const draftKey = useMemo(() => userId ? `${DRAFT_KEY_PREFIX}${userId}` : null, [userId]);
  const stepKey  = useMemo(() => userId ? `${STEP_KEY_PREFIX}${userId}`  : null, [userId]);

  useEffect(() => {
    if (!draftKey || !stepKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = profileStorage.getString(draftKey) ?? null;
        if (r && !cancelled) {
          const parse = () => {
            const p = JSON.parse(r) as Partial<FormState>;
            delete p.photos;
            if (!cancelled && isMountedRef.current) dispatch({ type:'LOAD', state:p });
          };
          if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(parse);
          else setTimeout(parse, 0);
        }
        if (!cancelled && isMountedRef.current) setStep(1);
      } catch { /* ignore corrupt draft */ }
    })();
    return () => { cancelled = true; };
  }, [draftKey, stepKey]);

  const prevFormRef = useRef(form);
  useEffect(() => { if (prevFormRef.current !== form) { isDirtyRef.current = true; prevFormRef.current = form; } }, [form]);

  useEffect(() => {
    if (!draftKey || !stepKey) return;
    // ─── Fix #4: Assign setTimeout to variable for cleanup ───────────────────
    const t = setTimeout(() => {
      if (!isDirtyRef.current) return;
      isDirtyRef.current = false;
      const { photos:_, ...rest } = form;
      try { profileStorage.set(draftKey, JSON.stringify(rest)); } catch { /* storage error */ }
      try { profileStorage.set(stepKey, String(step)); } catch { /* storage error */ }
    }, 2000);
    return () => clearTimeout(t);
  }, [form, step, draftKey, stepKey]);

  useEffect(() => {
    progAnim.value = withTiming(step / TOTAL_STEPS, { duration: 300, easing: Easing.out(Easing.ease) });
  }, [step, progAnim]);

  const progStyle = useAnimatedStyle(() => ({ width: `${progAnim.value * 100}%` as `${number}%` }));

  // ─── Fix #5: Move setPromptPicker out of effect — guard instead ───────────
  useEffect(() => {
    if (promptPicker !== null && promptPicker >= form.prompts.length) {
      const timer = setTimeout(() => {
        if (isMountedRef.current) setPromptPicker(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [form.prompts.length, promptPicker]);

  useEffect(() => {
    if (!IS_WEB && !permission?.granted && permission?.canAskAgain !== false) {
      let cancelled = false;
      showAlert('Camera Required', 'This app uses your camera to take profile photos.', [
        { text:'Not Now', style:'cancel' },
        { text:'Grant Access', onPress:() => { if (!cancelled) void requestPermission(); } },
      ]);
      return () => { cancelled = true; };
    }
  }, [permission?.granted, permission?.canAskAgain, requestPermission]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Step ${step} of ${TOTAL_STEPS}: ${STEP_NAMES[step-1]}`);
  }, [step]);

  const birthday = useMemo<Date|null>(() => { const m=parseInt(form.bdayMonth), d=parseInt(form.bdayDay), y=parseInt(form.bdayYear); if (isNaN(m)||isNaN(d)||isNaN(y)||!isValidDate(y,m,d)) return null; return new Date(y,m-1,d); }, [form.bdayMonth, form.bdayDay, form.bdayYear]);
  const age      = useMemo(() => birthday ? calcAge(birthday) : null, [birthday]);
  const zodiac   = useMemo(() => birthday ? getZodiac(birthday.getMonth()+1, birthday.getDate()) : null, [birthday]);
  const hCm      = useMemo(() => form.heightUnit==='cm' ? parseInt(form.heightCm)||0 : ftToCm(parseInt(form.heightFt)||0, parseInt(form.heightIn)||0), [form.heightUnit, form.heightCm, form.heightFt, form.heightIn]);
  const hDisplay = useMemo(() => { if (!hCm||hCm<MIN_H) return ''; return form.heightUnit==='cm'?`${hCm} cm (${cmToFt(hCm)})`:``+form.heightFt+`'`+(form.heightIn||0)+`" (${hCm} cm)`; }, [hCm, form.heightUnit, form.heightFt, form.heightIn]);

  const hasFace      = useMemo(() => form.photos.some(p => p.type==='face'),       [form.photos]);
  const hasUpperBody = useMemo(() => form.photos.some(p => p.type==='upper_body'), [form.photos]);
  const hasFullBody  = useMemo(() => form.photos.some(p => p.type==='full_body'),  [form.photos]);
  const nextSlot     = useMemo(() => getNextPhotoSlot(form.photos), [form.photos]);

  const stepOk = useMemo<boolean>(() => {
    switch (step) {
      case 1: return hasFace && hasUpperBody;
      case 2: return validateName(form.name).valid && age!==null && age>=MIN_AGE && age<=MAX_AGE && form.gender!=='' && form.interestedIn!=='' && hCm>=MIN_H && hCm<=MAX_H;
      case 3: return form.bodyType!=='' && form.lookingForBody!=='';
      case 4: return form.religion!=='' && form.lifestyle!=='' && form.relationship!=='';
      case 5: return form.interests.length>=3;
      case 6: case 7: return true;
      case 8: return form.termsAccepted;
      default: return false;
    }
  }, [step, form, hasFace, hasUpperBody, age, hCm]);

  const pct = useMemo(() => {
    const c=[hasFace,hasUpperBody,hasFullBody,form.photos.length>=3,validateName(form.name).valid,age!==null&&age>=MIN_AGE,form.gender!=='',form.interestedIn!=='',hCm>=MIN_H,form.bodyType!=='',form.lookingForBody!=='',form.religion!=='',form.lifestyle!=='',form.relationship!=='',form.interests.length>=3,form.bio.trim().length>0,form.locCity!=='',form.education!=='',form.smoking!=='',form.drinking!=='',form.children!=='',form.prompts.length>=1,form.vibes.length>=1,form.loveLang!==''];
    return Math.round((c.filter(Boolean).length/c.length)*100);
  }, [form, hasFace, hasUpperBody, hasFullBody, age, hCm]);

  const missingMsg = useMemo(() => getMissingFieldsMessage(step, form, hasFace, hasUpperBody, age, hCm), [step, form, hasFace, hasUpperBody, age, hCm]);

  const haptic        = useCallback((s:Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => { if (!IS_WEB) Haptics.impactAsync(s).catch(() => {}); }, []);
  const successHaptic = useCallback(() => { if (!IS_WEB) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }, []);

  const animate = useCallback((dir:'fwd'|'back') => {
    const exitTarget = dir==='fwd' ? -screenWidth : screenWidth;
    const enterStart = dir==='fwd' ? screenWidth : -screenWidth;
    fadeAnim.value  = withTiming(0, { duration:140, easing:Easing.out(Easing.ease) });
    slideAnim.value = withTiming(exitTarget, { duration:140, easing:Easing.out(Easing.ease) }, (finished) => {
      if (finished) { slideAnim.value=enterStart; fadeAnim.value=withTiming(1, { duration:200, easing:Easing.out(Easing.ease) }); slideAnim.value=withTiming(0, { duration:200, easing:Easing.out(Easing.ease) }); }
    });
  }, [fadeAnim, slideAnim, screenWidth]);

  const goNext = useCallback(() => {
    if (!stepOk) { showAlert('Incomplete', getMissingFieldsMessage(step, form, hasFace, hasUpperBody, age, hCm)); return; }
    if (step>=TOTAL_STEPS) return;
    if (step===7) { if (form.bio.trim()) { const b=checkBlocked(form.bio); if (b) { showAlert('Bio Issue',b); return; } } for (const p of form.prompts) { if (p.a.trim()) { const b=checkBlocked(p.a); if (b) { showAlert('Prompt Issue',b); return; } } } }
    if (step===6) { const minA=parseInt(form.ageMin)||MIN_AGE, maxA=parseInt(form.ageMax)||50; if (minA>=maxA) { showAlert('Invalid Age Range','Min must be less than max.'); return; } const minH=parseInt(form.heightPrefMinCm)||0, maxH=parseInt(form.heightPrefMaxCm)||0; if (minH>0&&maxH>0&&minH>=maxH) { showAlert('Invalid Height Range','Min must be less than max.'); return; } }
    haptic(); successHaptic(); animate('fwd'); setStep(s => s+1);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y:0, animated:false }));
  }, [step, stepOk, form, hasFace, hasUpperBody, age, hCm, haptic, successHaptic, animate]);

  const goBack = useCallback(() => {
    if (step<=1) { showAlert('Leave Setup?','Your progress is auto-saved.',[{ text:'Stay', style:'cancel' },{ text:'Leave', onPress:() => router.back() }]); return; }
    haptic(); animate('back'); setStep(s => s-1);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y:0, animated:false }));
  }, [step, haptic, animate, router]);

  const stopWebStream = useCallback(() => {
    if (readyPollRef.current) { clearInterval(readyPollRef.current); readyPollRef.current=null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current=null;
    if (isMountedRef.current) setCamReady(false);
  }, []);

  const attachStreamToVideo = useCallback(() => {
    const video=webVideoElRef.current, stream=streamRef.current;
    if (!video||!stream) return;
    if (video.srcObject===(stream as unknown as MediaStream)) { if (video.readyState>=2&&isMountedRef.current) setCamReady(true); return; }
    video.srcObject=stream as unknown as MediaStream;
    if (video.readyState>=2) { video.play().catch(()=>{}); if (isMountedRef.current) setCamReady(true); return; }
    video.onloadedmetadata=() => { video.play().catch(()=>{}); if (isMountedRef.current) setCamReady(true); };
    video.oncanplay=() => { if (isMountedRef.current) setCamReady(true); if (video.paused) video.play().catch(()=>{}); };
    video.onerror=() => { if (isMountedRef.current) { setCamReady(false); setCamErr('Camera stream error.'); } };
    stream.getTracks().forEach(t => { t.onended=() => { if (isMountedRef.current) { setCamReady(false); setCamErr('Camera disconnected.'); } }; });
    if (readyPollRef.current) clearInterval(readyPollRef.current);
    let pc=0;
    readyPollRef.current=setInterval(() => { pc++; if (!isMountedRef.current||pc>30) { if (readyPollRef.current) clearInterval(readyPollRef.current); readyPollRef.current=null; return; } const v=webVideoElRef.current; if (v&&v.readyState>=2) { if (readyPollRef.current) clearInterval(readyPollRef.current); readyPollRef.current=null; if (v.paused) v.play().catch(()=>{}); if (isMountedRef.current) setCamReady(true); } }, 200);
  }, []);

  const handleVideoRef = useCallback((el:WebVideoElement|null) => {
    if (!el) { if (webVideoElRef.current) { webVideoElRef.current.onloadedmetadata=null; webVideoElRef.current.oncanplay=null; webVideoElRef.current.onerror=null; webVideoElRef.current.srcObject=null; } webVideoElRef.current=null; return; }
    webVideoElRef.current=el; attachStreamToVideo();
  }, [attachStreamToVideo]);

  const startWebStream = useCallback(async (facing:'front'|'back') => {
    try {
      stopWebStream();
      if (!IS_WEB) return;
      const nav=navigator as unknown as WebNavigatorMedia;
      if (!nav.mediaDevices?.getUserMedia) { if (isMountedRef.current) setCamErr('Camera not supported.'); return; }
      const devs=await nav.mediaDevices.enumerateDevices();
      const vd=devs.filter(d => d.kind==='videoinput');
      const s=await nav.mediaDevices.getUserMedia({ video:{ facingMode:vd.length>1?(facing==='front'?'user':'environment'):undefined, width:{ ideal:1280 }, height:{ ideal:960 } }, audio:false });
      if (!isMountedRef.current) { s.getTracks().forEach(t => t.stop()); return; }
      streamRef.current=s; attachStreamToVideo();
      setTimeout(() => { if (isMountedRef.current&&streamRef.current) attachStreamToVideo(); }, 600);
      setTimeout(() => { if (isMountedRef.current&&streamRef.current) { attachStreamToVideo(); const v=webVideoElRef.current; if (v&&v.readyState>=2) setCamReady(true); } }, 1200);
    } catch (err:unknown) {
      const name=(err as { name?:string })?.name??'';
      let msg='Could not start camera.';
      if (name==='NotAllowedError') msg='Camera access blocked. Allow it in browser settings.';
      else if (name==='NotFoundError') msg='No camera found.';
      else if (name==='NotReadableError') msg='Camera in use by another app.';
      else if (name==='OverconstrainedError') {
        try { const s=await (navigator as unknown as WebNavigatorMedia).mediaDevices?.getUserMedia({ video:true, audio:false }); if (!s) throw new Error('No stream'); if (!isMountedRef.current) { s.getTracks().forEach(t => t.stop()); return; } streamRef.current=s; attachStreamToVideo(); return; } catch { msg='Could not start camera.'; }
      }
      if (isMountedRef.current) setCamErr(msg);
    }
  }, [stopWebStream, attachStreamToVideo]);

  const closeCam = useCallback(() => {
    stopWebStream(); webVideoElRef.current=null;
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current=null; }
    if (isMountedRef.current) { setCamOpen(false); setCamErr(null); setCamSlot(null); setCountdown(null); setTimerEnabled(false); setCapturing(false); capturingRef.current=false; }
  }, [stopWebStream]);

  const openCamera = useCallback(async (slot?:PhotoSlotConfig) => {
    const ts=slot??nextSlot;
    if (!ts) { showAlert('Maximum Photos',`You can add up to ${MAX_PHOTOS} photos.`); return; }
    if (ts.type!=='freestyle'&&form.photos.some(p => p.type===ts.type)) { showAlert('Already Added',`You already have a ${ts.label} photo. Remove it first.`); return; }
    if (!IS_WEB&&!permission?.granted) { const r=await requestPermission(); if (!r.granted) { showAlert('Camera Required','Enable camera in device settings.',[{ text:'Cancel', style:'cancel' },{ text:'Open Settings', onPress:() => { void Linking.openSettings(); } }]); return; } }
    if (isMountedRef.current) { setCamSlot(ts); setCamFacing(ts.cameraSide); setTimerEnabled(false); setCountdown(null); setCamOpen(true); setCamErr(null); setCamReady(false); setCapturing(false); capturingRef.current=false; }
    if (IS_WEB) setTimeout(() => { if (isMountedRef.current) void startWebStream(ts.cameraSide); }, 500);
  }, [nextSlot, permission, requestPermission, form.photos, startWebStream]);

  const flipCamera = useCallback(() => { const n=camFacing==='front'?'back':'front'; setCamFacing(n); if (IS_WEB) { setCamReady(false); void startWebStream(n); } }, [camFacing, startWebStream]);

  const processPhoto = useCallback(async (uri:string, type:PhotoType, count:number): Promise<boolean> => {
    if (isMountedRef.current) { setUploading(true); setUploadProgress(0); }
    try {
      if (isMountedRef.current) setUploadProgress(10);
      const nsfwResult=await checkImageSafety(uri);
      if (!nsfwResult.safe) { showAlert('🚫 Photo Rejected', nsfwResult.reason); return false; }
      if (isMountedRef.current) setUploadProgress(20);
      let localFaceChecked=false;
      if (type==='face') { const faceResult=await checkSingleFace(uri); if (faceResult.faceCount!==-1) { localFaceChecked=true; if (!faceResult.ok) { showAlert('Face Check Failed', faceResult.reason+'\n\nTips:\n• Look directly at the camera\n• Good lighting\n• Remove sunglasses'); return false; } } }
      if (isMountedRef.current) setUploadProgress(35);
      const upload: UploadResult=await uploadToCloudinary(uri, 'profile_photo');
      if (isMountedRef.current) setUploadProgress(60);
      if (!upload.success||!upload.url) { showAlert('Upload Failed', upload.error??'Could not upload photo.'); return false; }
      if (upload.moderationStatus==='rejected') { showAlert('Photo Rejected', 'This photo was flagged as inappropriate. Please use a different photo.'); return false; }
      if (isMountedRef.current) setUploadProgress(70);
      const photoUrl=upload.url, detectedFaces=upload.faces??[], imageWidth=upload.width??0, imageHeight=upload.height??0;
      if (type==='face'&&!localFaceChecked) { if (detectedFaces.length===0) { showAlert('No Face Detected','Could not detect a clear face.\n\nTips:\n• Look directly at the camera\n• Good lighting\n• Remove sunglasses or hats'); return false; } if (detectedFaces.length>1) { showAlert('Multiple Faces',`Detected ${detectedFaces.length} faces. Your photo must show only you.`); return false; } }
      if (type==='face') { try { const ar:AgeEstimationResult|null=await estimateAgeFromPhoto(photoUrl); if (ar?.estimatedAge&&ar.confidence>=0.1) { if (isMountedRef.current) set('ageEstimate',ar.estimatedAge); } } catch { /* non-critical */ } }
      if (type==='upper_body'&&detectedFaces.length>0&&imageWidth>0&&imageHeight>0) { const largestFaceHeight=Math.max(...detectedFaces.map(getFaceHeight)); if (largestFaceHeight/imageHeight<0.05) { showAlert('No Person Detected','Please take a photo showing you from the waist up.'); return false; } }
      if (type==='full_body') {
        let isFullBody=false;
        if (detectedFaces.length>0&&imageWidth>0&&imageHeight>0) isFullBody=Math.max(...detectedFaces.map(getFaceHeight))/imageHeight<0.25;
        if (!isFullBody) { try { if (detectedFaces.length===0) { const body=await detectFullBodyPhoto(photoUrl); isFullBody=body.isFullBody; } } catch { /* non-critical */ } if (!isFullBody) { const keep=await new Promise<boolean>(resolve => { showAlert('Not Full Body','Could not detect a full body. Keep this photo anyway?',[{ text:'Discard', style:'cancel', onPress:() => resolve(false) },{ text:'Keep Anyway', onPress:() => { dispatch({ type:'ADD_PHOTO', photo:{ uri, url:photoUrl, type, order:count, verified:false, uploadedAt:new Date().toISOString() } }); successHaptic(); resolve(true); } }]); }); return keep; } }
      }
      if (isMountedRef.current) setUploadProgress(100);
      dispatch({ type:'ADD_PHOTO', photo:{ uri, url:photoUrl, type, order:count, verified:type==='face'?(localFaceChecked||detectedFaces.length===1):true, uploadedAt:new Date().toISOString() } });
      successHaptic();
      const hints:string[]=[];
      if (type==='face'&&!hasUpperBody) hints.push('upper body photo (required)');
      if (type==='upper_body'&&!hasFullBody) hints.push('full body photo (+40% more matches)');
      if (type==='full_body'&&count<3) hints.push('freestyle photo to show your personality');
      showAlert('📸 Photo Added!', hints.length>0?`Great shot! Next: ${hints.join(', ')}`:'Looking good! 🎉');
      return true;
    } catch (err:unknown) {
      logger.error('processPhoto failed:', err);
      showAlert('Upload Error','Something went wrong. Check your connection.');
      return false;
    } finally {
      if (isMountedRef.current) { setUploading(false); setUploadProgress(0); }
    }
  }, [hasUpperBody, hasFullBody, set, successHaptic]);

  const doCapture = useCallback(async () => {
    if (!camSlot||capturingRef.current) return;
    capturingRef.current=true; setCapturing(true);
    // ─── Fix #6: Don't declare uri then reassign — use let with direct assign ─
    let capturedUri: string | null = null;
    try {
      if (IS_WEB) {
        const v=webVideoElRef.current;
        if (!v) { showAlert('Camera Error','Video element not found. Close and reopen camera.'); return; }
        if (v.readyState<2) { await new Promise<void>(r => { const dl=Date.now()+3000; const p=() => { if (v.readyState>=2||Date.now()>=dl) { r(); return; } setTimeout(p,100); }; p(); }); }
        if (v.readyState<2) { showAlert('Camera Not Ready','Please wait a moment and try again.'); return; }
        const doc2=(globalThis as Record<string,unknown>)['document'] as { createElement:(tag:string) => WebCanvasElement }|undefined;
        if (!doc2) { showAlert('Browser Error','Cannot access document.'); return; }
        const vw=v.videoWidth, vh=v.videoHeight;
        if (!vw||!vh) { showAlert('Camera Not Ready','Video dimensions not available.'); return; }
        const canvas=doc2.createElement('canvas'); canvas.width=vw; canvas.height=vh;
        const ctx=canvas.getContext('2d'); if (!ctx) { showAlert('Browser Error','Cannot create canvas.'); return; }
        if (camFacing==='front') { ctx.save(); ctx.scale(-1,1); ctx.drawImage(v as unknown as CanvasImageSource,-canvas.width,0,canvas.width,canvas.height); ctx.restore(); } else ctx.drawImage(v as unknown as CanvasImageSource,0,0,canvas.width,canvas.height);
        if (canvas.width<100||canvas.height<100) { showAlert('Photo Too Small','Use a higher quality camera.'); return; }
        capturedUri = canvas.toDataURL('image/jpeg',0.88);
      } else {
        if (!cameraRef.current) { showAlert('Camera Error','Camera not available.'); return; }
        const p=await cameraRef.current.takePictureAsync({ quality:0.88, skipProcessing:false });
        capturedUri = p?.uri ?? null;
      }
      if (!capturedUri) { showAlert('Capture Failed','Could not capture photo.'); return; }
      const accepted=await processPhoto(capturedUri, camSlot.type, form.photos.length);
      if (accepted) closeCam();
    } catch (err:unknown) {
      logger.error('doCapture failed:', err);
      showAlert('Error','Something went wrong capturing the photo.');
    } finally {
      capturingRef.current=false;
      if (isMountedRef.current) setCapturing(false);
    }
  }, [camSlot, camFacing, form.photos.length, processPhoto, closeCam]);

  const handleCapture = useCallback(() => {
    if (capturingRef.current||countdown!==null) return;
    if (timerEnabled&&camSlot?.timerAvailable) {
      setCountdown(TIMER_SECONDS);
      let c=TIMER_SECONDS;
      countdownRef.current=setInterval(() => {
        c--;
        if (c<=0) { if (countdownRef.current) clearInterval(countdownRef.current); countdownRef.current=null; if (isMountedRef.current) setCountdown(null); void doCapture(); }
        else if (isMountedRef.current) setCountdown(c);
      }, 1000);
    } else void doCapture();
  }, [countdown, timerEnabled, camSlot, doCapture]);

  const removePhoto = useCallback((i:number) => {
    const p=form.photos[i]; if (!p) return;
    showAlert('Remove Photo', p.type==='face'||p.type==='upper_body'?`Removing ${getPhotoLabel(p.type)} will make Step 1 incomplete.`:'Remove this photo?',[
      { text:'Cancel', style:'cancel' },
      { text:'Remove', onPress:() => { dispatch({ type:'REMOVE_PHOTO', index:i }); haptic(); } },
    ]);
  }, [form.photos, haptic]);

  const movePhoto = useCallback((from:number, to:number) => { if (to<0||to>=form.photos.length) return; dispatch({ type:'MOVE_PHOTO', from, to }); haptic(); }, [form.photos.length, haptic]);

  const getLoc = useCallback(async () => {
    showAlert('Location Access','Only your city is shown to other users.',[
      { text:'Not Now', style:'cancel' },
      { text:'Enable', onPress:async () => {
        if (isMountedRef.current) setGettingLoc(true);
        try { const loc=await requestLocationPermission(); if (loc) { const d=loc.city?`${loc.city}, ${loc.country}`:'Location found'; if (isMountedRef.current) { set('locCity',d); set('locData',loc); } await saveUserLocation(loc); showAlert('📍 Location Set',d); } else showAlert('Location Error','Enable location in settings.'); }
        catch { showAlert('Location Error','Something went wrong.'); }
        finally { if (isMountedRef.current) setGettingLoc(false); }
      }},
    ]);
  }, [set]);

  const switchHeightUnit = useCallback(() => {
    const { newFt, newIn, newCm }=convertHeightForUnitSwitch(form.heightUnit, form.heightCm, form.heightFt, form.heightIn);
    dispatch({ type:'SET', field:'heightUnit', value:form.heightUnit==='cm'?'ft':'cm' });
    dispatch({ type:'SET', field:'heightFt',   value:newFt });
    dispatch({ type:'SET', field:'heightIn',   value:newIn });
    dispatch({ type:'SET', field:'heightCm',   value:newCm });
  }, [form.heightUnit, form.heightCm, form.heightFt, form.heightIn]);

  const doSave = useCallback(async () => {
    if (!userId||!birthday||!age) return;
    if (isMountedRef.current) setLoading(true);
    try {
      const e2=await ensureMyE2EEIdentity();
      if (!e2.success||!e2.publicKey) throw new Error(e2.error??'Encryption identity failed');
      const pd = { uid:userId, email:userEmail, name:formatName(form.name), age, birthday:birthday.toISOString(), zodiacSign:zodiac?.sign??null, zodiacEmoji:zodiac?.emoji??null, gender:form.gender, interestedIn:form.interestedIn, pronouns:form.pronouns||null, height:{ value:hCm, unit:form.heightUnit, displayText:hDisplay, verificationMethod:'self-reported', verifiedAt:new Date().toISOString() }, bodyType:form.bodyType, lookingFor:form.lookingForBody, religiousViews:form.religion, lifestyle:form.lifestyle, relationshipGoal:form.relationship, education:form.education||null, occupation:form.occupation.trim()||null, smoking:form.smoking||null, drinking:form.drinking||null, children:form.children||null, pets:form.pets||null, diet:form.diet||null, politicalViews:form.politics||null, interests:form.interests, loveLanguage:form.loveLang||null, communicationStyle:form.commStyle||null, preferredFirstDate:form.firstDate||null, vibes:form.vibes, preferences:{ ageRange:{ min:parseInt(form.ageMin)||MIN_AGE, max:parseInt(form.ageMax)||50 }, maxDistanceKm:parseInt(form.distKm)||50, heightRangeCm:{ min:parseInt(form.heightPrefMinCm)||null, max:parseInt(form.heightPrefMaxCm)||null }, dealbreakers:form.dealbreakers, importantFields:form.importantFields }, bio:form.bio.trim(), promptAnswers:form.prompts.filter(p => p.a.trim()).map(p => ({ question:p.q, answer:p.a.trim() })), photos:form.photos.map(p => p.url), photoData:form.photos.map(p => ({ url:p.url, type:p.type, order:p.order, verified:p.verified, uploadedAt:p.uploadedAt })), hasFullBodyPhoto:hasFullBody, privacy:{ blurUntilMatch:form.blurUntilMatch, incognitoMode:form.incognito, verifiedUsersOnly:form.verifiedOnly }, location:form.locData||null, locationCity:form.locCity||null, personalityType:null, icebreakers:[], profileComplete:true, isVisible:true, encryptionPublicKey:e2.publicKey, encryptionKeyVersion:1 };
      const ref=doc(db,'users',userId); const ex=await getDoc(ref);
      // ─── Fix #7: Destructure with proper ignore prefix ────────────────────
      if (ex.exists()) {
        const { uid: _uid, email: _email, ...ud } = pd;
        void _uid; void _email;
        await setDoc(ref, { ...ud, updatedAt:serverTimestamp() }, { merge:true });
      } else {
        await setDoc(ref, { ...pd, createdAt:serverTimestamp(), updatedAt:serverTimestamp(), termsAcceptedAt:serverTimestamp(), encryptionCreatedAt:serverTimestamp() });
      }
      if (draftKey) try { profileStorage.delete(draftKey); } catch { /* storage error */ }
      if (stepKey)  try { profileStorage.delete(stepKey);  } catch { /* storage error */ }
      dispatch({ type:'RESET' });
      showAlert('🎉 Profile Created!','Next: discover your personality type!',[{ text:'Continue', onPress:() => router.replace('/personality-quiz' as Parameters<typeof router.replace>[0]) }]);
    } catch (err: unknown) {
      // ─── Fix #8: preserve-caught-error — attach cause ────────────────────
      const msg = (err as { message?:string })?.message ?? 'Unknown error';
      logger.error('doSave failed:', msg);
      showAlert('Save Error',`Could not save: ${msg}`);
      throw new Error(`Profile save failed: ${msg}`, { cause: err });
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [userId, userEmail, birthday, age, zodiac, form, hCm, hDisplay, hasFullBody, draftKey, stepKey, router]);

  const handleSave = useCallback(async () => {
    if (!userId) { router.replace('/login' as Parameters<typeof router.replace>[0]); return; }
    if (!form.termsAccepted) { showAlert('Terms Required','Please accept the Terms of Service.'); return; }
    if (!birthday||!age) { showAlert('Invalid Birthday','Enter a valid date of birth.'); return; }
    if (form.bio.trim()) { const b=checkBlocked(form.bio); if (b) { showAlert('Bio Issue',b); return; } }
    for (const p of form.prompts) { if (p.a.trim()) { const b=checkBlocked(p.a); if (b) { showAlert('Prompt Issue',b); return; } } }
    if (form.ageEstimate&&Math.abs(age-form.ageEstimate)>AGE_TOL) { showAlert('Age Verification',`Photos suggest ~${form.ageEstimate} but birthday says ${age}. Continue?`,[{ text:'Go Back', style:'cancel' },{ text:'Continue', onPress:() => void doSave() }]); return; }
    if (!hasFullBody&&form.photos.length>0) { showAlert('No Full-Body Photo','Add one for more matches?',[{ text:'Add Photo', style:'cancel', onPress:() => { setStep(1); void openCamera(PHOTO_SLOTS[2]); } },{ text:'Continue Anyway', onPress:() => void doSave() }]); return; }
    await doSave();
  }, [userId, form, birthday, age, hasFullBody, router, doSave, openCamera]);

  const renderChip = useCallback((value:string, selected:boolean, onPress:() => void, icon?:string, disabled?:boolean) => (
    <TouchableOpacity
      key={value}
      style={[st.chip,{ borderColor:selected?C.accent:C.inputBorder, backgroundColor:selected?C.accentGlow:C.input },disabled&&st.chipOff]}
      onPress={() => { haptic(); onPress(); }}
      disabled={disabled||loading||uploading}
      activeOpacity={0.7}
      accessibilityLabel={`${value}${selected?', selected':''}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked:selected, disabled:disabled||loading||uploading }}
    >
      {icon!=null&&<Text style={st.chipIcon}>{icon}</Text>}
      <Text style={[st.chipText,{ color:selected?C.accent:C.sub },selected&&{ fontWeight:'600' }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{value.replace(/^\S+\s/,'')}</Text>
      {selected&&<Text style={[st.chipCheck,{ color:C.accent }]}>✓</Text>}
    </TouchableOpacity>
  ), [haptic, loading, uploading, C]);

  const renderOpt = useCallback((opt:OptionItem, sel:string, onSel:(v:string) => void) => (
    <TouchableOpacity
      key={opt.value}
      style={[st.optRow,{ backgroundColor:C.input, borderColor:sel===opt.value?C.accent:C.inputBorder }]}
      onPress={() => { haptic(); onSel(opt.value); }}
      disabled={loading||uploading}
      activeOpacity={0.7}
      accessibilityLabel={`${opt.value}${opt.desc?`, ${opt.desc}`:''}${sel===opt.value?', selected':''}`}
      accessibilityRole="radio"
      accessibilityState={{ checked:sel===opt.value }}
    >
      <View style={st.optHead}>{opt.icon!=null&&<Text style={st.optIcon}>{opt.icon}</Text>}<Text style={[st.optText,{ color:sel===opt.value?C.accent:C.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{opt.value}</Text>{sel===opt.value&&<Text style={[st.optCheck,{ color:C.accent }]}>✓</Text>}</View>
      {opt.desc!=null&&opt.desc!==''&&<Text style={[st.optDesc,{ color:C.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{opt.desc}</Text>}
    </TouchableOpacity>
  ), [haptic, loading, uploading, C]);

  const renderCurrent = useCallback(() => {
    switch (step) {
      case 1: return <Step1 C={C} photos={form.photos} hasFullBody={hasFullBody} hasFace={hasFace} hasUpperBody={hasUpperBody} nextSlot={nextSlot} uploading={uploading} loading={loading} uploadProgress={uploadProgress} movePhoto={movePhoto} removePhoto={removePhoto} openCamera={openCamera} />;
      case 2: return <Step2 C={C} form={form} age={age} zodiac={zodiac} birthday={birthday} hCm={hCm} hDisplay={hDisplay} loading={loading} set={set} renderChip={renderChip} switchHeightUnit={switchHeightUnit} />;
      case 3: return <Step3 C={C} bodyType={form.bodyType} lookingForBody={form.lookingForBody} loading={loading} set={set} />;
      case 4: return <Step4 C={C} form={form} loading={loading} set={set} renderChip={renderChip} renderOpt={renderOpt} />;
      case 5: return <Step5 C={C} form={form} haptic={haptic} set={set} dispatch={dispatch} renderChip={renderChip} renderOpt={renderOpt} />;
      case 6: return <Step6 C={C} form={form} loading={loading} set={set} dispatch={dispatch} renderChip={renderChip} />;
      case 7: return <Step7 C={C} form={form} loading={loading} gettingLoc={gettingLoc} set={set} dispatch={dispatch} getLoc={getLoc} promptPicker={promptPicker} setPromptPicker={setPromptPicker} />;
      case 8: return <Step8 C={C} form={form} age={age} zodiac={zodiac} hDisplay={hDisplay} pct={pct} set={set} />;
      default: return null;
    }
  }, [step, C, form, hasFullBody, hasFace, hasUpperBody, nextSlot, uploading, loading, uploadProgress, movePhoto, removePhoto, openCamera, age, zodiac, birthday, hCm, hDisplay, set, renderChip, switchHeightUnit, renderOpt, haptic, dispatch, gettingLoc, getLoc, promptPicker, pct]);

  const promptQData = useMemo(() => PROMPT_QUESTIONS.map((q, i) => ({ q, i })), []);

  return (
    <KeyboardAvoidingView style={[st.root,{ backgroundColor:C.bg }]} behavior={IS_IOS?'padding':'height'}>
      <LinearGradient colors={[C.bgGradientStart, C.bgGradientMid, C.bgGradientEnd]} style={staticStyles.absoluteFill} start={{ x:0.5, y:0 }} end={{ x:0.5, y:1 }} />
      <View style={[st.topBar,{ backgroundColor:C.card, borderBottomColor:C.cardBorder }]}>
        <TouchableOpacity onPress={goBack} hitSlop={{ top:8, bottom:8, left:8, right:8 }} accessibilityLabel={step===1?'Close setup':'Go back'} accessibilityRole="button"><Text style={[st.backBtn,{ color:C.accent }]}>{step===1?'✕':'← Back'}</Text></TouchableOpacity>
        <Text style={[st.topTitle,{ color:C.text }]}>{step}/{TOTAL_STEPS} · {STEP_NAMES[step-1]}</Text>
        <Text style={[st.draftLabel,{ color:C.muted }]}>💾 Draft</Text>
      </View>
      <View style={[st.stepDots,{ backgroundColor:C.card }]} accessibilityLabel={`Step ${step} of ${TOTAL_STEPS}`}>
        {STEP_NAMES.map((name,i) => (
          <View key={name} style={[st.stepDot,{ backgroundColor:C.inputBorder },i+1<step&&{ backgroundColor:C.success },i+1===step&&{ backgroundColor:C.accent, transform:[{ scale:1.3 }] }]} />
        ))}
      </View>
      <View style={[st.progBg,{ backgroundColor:C.inputBorder }]} accessibilityLabel={`${Math.round((step/TOTAL_STEPS)*100)}% complete`} accessibilityRole="progressbar">
        <Animated.View style={[[st.progFill,{ backgroundColor:C.accent }], progStyle]} />
      </View>
      {IS_WEB ? (
        <View style={staticStyles.flex1}>
          <ScrollView ref={scrollRef} style={st.sv} contentContainerStyle={st.svContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Animated.View style={fadeStyle}>{renderCurrent()}</Animated.View>
            <View style={st.bottomPad} />
          </ScrollView>
        </View>
      ) : (
        <Pressable style={staticStyles.flex1} onPress={() => Keyboard.dismiss()}>
          <ScrollView ref={scrollRef} style={st.sv} contentContainerStyle={st.svContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Animated.View style={fadeStyle}>{renderCurrent()}</Animated.View>
            <View style={st.bottomPad} />
          </ScrollView>
        </Pressable>
      )}
      <View style={[st.botBar,{ backgroundColor:C.card, borderTopColor:C.cardBorder }]}>
        {step<TOTAL_STEPS ? (
          stepOk ? (
            <TouchableOpacity style={st.nextBtnWrap} onPress={goNext} activeOpacity={0.85} accessibilityLabel={`Next: ${STEP_NAMES[step]}`} accessibilityRole="button">
              <LinearGradient colors={[C.buttonGradStart, C.buttonGradEnd]} start={{ x:0, y:0 }} end={{ x:1, y:1 }} style={st.nextBtn}>
                <Text style={[st.nextBtnText,{ color:C.white }]}>Next → {STEP_NAMES[step]}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={[st.nextBtnWrap, st.nextBtnDisabled]}><View style={[st.nextBtn,{ backgroundColor:C.disabledBg }]}><Text style={[st.nextBtnText,{ color:C.disabledText }]}>{missingMsg}</Text></View></View>
          )
        ) : (
          form.termsAccepted&&!loading ? (
            <TouchableOpacity style={st.nextBtnWrap} onPress={() => void handleSave()} activeOpacity={0.85} accessibilityLabel="Create profile" accessibilityRole="button">
              <LinearGradient colors={[C.success,'#3aaa50']} start={{ x:0, y:0 }} end={{ x:1, y:1 }} style={st.nextBtn}>
                <Text style={[st.nextBtnText,{ color:C.white }]}>✓ Create Profile</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={[st.nextBtnWrap,{ opacity:loading?0.8:0.5 }]}><View style={[st.nextBtn,{ backgroundColor:loading?C.accent:C.disabledBg }]}>{loading ? <View style={st.saveBtnRow}><ActivityIndicator size="small" color={C.white} /><Text style={[st.nextBtnText,{ color:C.white, marginLeft:SPACING.sm }]}> Creating…</Text></View> : <Text style={[st.nextBtnText,{ color:C.disabledText }]}>Accept Terms to Continue</Text>}</View></View>
          )
        )}
      </View>
      <Modal visible={camOpen} animationType="slide" onRequestClose={closeCam} statusBarTranslucent>
        <View style={[st.camModal,{ backgroundColor:C.bg }]}>
          <LinearGradient colors={[C.bgGradientStart, C.bgGradientEnd]} style={staticStyles.absoluteFill} />
          <View style={[st.camHead,{ backgroundColor:C.card, borderBottomColor:C.cardBorder }]}>
            <TouchableOpacity onPress={closeCam} activeOpacity={0.7} disabled={capturing} hitSlop={{ top:8, bottom:8, left:8, right:8 }} accessibilityLabel="Cancel photo" accessibilityRole="button"><Text style={[st.camCancel,{ color:C.danger }]}>✕ Cancel</Text></TouchableOpacity>
            <View style={st.camHeadCenter}><Text style={[st.camTitle,{ color:C.text }]}>{camSlot?.icon} {camSlot?.label}</Text><Text style={[st.camInstr,{ color:C.muted }]}>{camSlot?.instruction}</Text></View>
            <TouchableOpacity
              onPress={() => { if (capturing||countdown!==null) return; handleCapture(); }}
              activeOpacity={0.7}
              style={st.camCaptureHeaderBtn}
              disabled={capturing||countdown!==null}
              accessibilityLabel={capturing?'Processing photo':'Take photo'}
              accessibilityRole="button"
            >
              <Text style={[st.camCaptureHeaderBtnText,{ color:C.white }]}>{capturing?'⏳ Wait...':'📸 Capture'}</Text>
            </TouchableOpacity>
          </View>
          <View style={st.camContent} pointerEvents="box-none">
            {IS_WEB ? (
              <View style={[st.camBox,{ borderColor:C.accent }]}>
                {camErr ? (
                  <View style={st.camErrWrap}>
                    <Text style={st.camErrIcon}>📷</Text>
                    <Text style={[st.camErrText,{ color:C.danger }]}>{camErr}</Text>
                    <TouchableOpacity
                      style={[st.retryBtn,{ backgroundColor:C.accent }]}
                      onPress={() => { if (isMountedRef.current) { setCamErr(null); setCamReady(false); } if (camSlot) void startWebStream(camSlot.cameraSide); }}
                      activeOpacity={0.7}
                      accessibilityLabel="Retry camera"
                      accessibilityRole="button"
                    >
                      <Text style={[st.retryBtnText,{ color:C.white }]}>Try Again</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    {!camReady&&(<View style={[staticStyles.absoluteFill, st.camLoadWrap]} pointerEvents="none"><ActivityIndicator size="large" color={C.accent} /><Text style={[st.camLoadText,{ color:C.muted }]}>Starting camera…</Text></View>)}
                    <View style={staticStyles.absoluteFill} pointerEvents="none"><WebVideoPreview facing={camFacing} onReady={handleVideoRef} /></View>
                    {camReady&&camSlot&&(<View style={staticStyles.absoluteFill} pointerEvents="none"><CameraGuide type={camSlot.type} theme={C} /></View>)}
                    {capturing&&(<View style={st.camProcessingOverlay} pointerEvents="none"><ActivityIndicator size="large" color={C.white} /><Text style={[st.camProcessingText,{ color:C.white }]}>Processing photo…</Text></View>)}
                  </>
                )}
              </View>
            ) : (
              <View style={[st.camBox,{ borderColor:C.accent }]}>
                <CameraView ref={cameraRef} style={st.camNative} facing={camFacing} onCameraReady={() => { if (isMountedRef.current) setCamReady(true); }} onMountError={err => { if (isMountedRef.current) setCamErr(err.message??'Camera failed.'); }} />
                {camSlot&&<CameraGuide type={camSlot.type} theme={C} />}
                {capturing&&(<View style={st.camProcessingOverlay} pointerEvents="none"><ActivityIndicator size="large" color={C.white} /><Text style={[st.camProcessingText,{ color:C.white }]}>Processing photo…</Text></View>)}
              </View>
            )}
            {countdown!==null&&(<View style={st.countdownOverlay} pointerEvents="none"><Text style={[st.countdownText,{ color:C.white }]}>{countdown}</Text></View>)}
          </View>
          <View style={[st.camControls,{ backgroundColor:C.card, borderTopColor:C.cardBorder }]}>
            {camSlot?.timerAvailable&&(
              <TouchableOpacity
                style={[st.timerBtn,{ backgroundColor:C.input, borderColor:timerEnabled?C.accent:C.inputBorder },timerEnabled&&{ backgroundColor:C.accentGlow },capturing&&st.btnOff]}
                onPress={() => { setTimerEnabled(v => !v); haptic(); }}
                disabled={capturing}
                activeOpacity={0.7}
                accessibilityLabel={timerEnabled?'Disable timer':'Enable 3 second timer'}
                accessibilityRole="switch"
                accessibilityState={{ checked:timerEnabled }}
              >
                <Text style={[st.timerBtnText,{ color:timerEnabled?C.accent:C.text }]}>{timerEnabled?`⏱ ${TIMER_SECONDS}s ON`:'⏱ Timer'}</Text>
              </TouchableOpacity>
            )}
            <View style={st.camBtnRow}>
              <TouchableOpacity style={[st.flipBtn,{ backgroundColor:C.input, borderColor:C.inputBorder },capturing&&st.btnOff]} onPress={flipCamera} disabled={capturing} activeOpacity={0.7} accessibilityLabel="Flip camera" accessibilityRole="button"><Text style={st.flipBtnText}>🔄</Text></TouchableOpacity>
              <TouchableOpacity style={[st.captureBtn,{ borderColor:C.accent },(capturing||countdown!==null)&&st.captureBtnOff]} onPress={handleCapture} activeOpacity={0.8} accessibilityLabel={countdown!==null?`Taking photo in ${countdown}`:'Take photo'} accessibilityRole="button" accessibilityState={{                disabled: capturing || countdown !== null }}>
              <View style={[st.captureBtnInner,{ backgroundColor:capturing||countdown!==null?C.dim:C.accent }]}>
                {capturing ? <ActivityIndicator size="small" color={C.white} /> : countdown!==null ? <Text style={[st.countdownInner,{ color:C.white }]}>{countdown}</Text> : <Text style={st.captureBtnIcon}>📸</Text>}
              </View>
            </TouchableOpacity>
            <View style={st.flipBtn} />
          </View>
          {!camReady&&!camErr&&(<Text style={[st.camReadyHint,{ color:C.muted }]}>Waiting for camera…</Text>)}
        </View>
      </View>
    </Modal>

    <Modal visible={promptPicker !== null} animationType="slide" onRequestClose={() => setPromptPicker(null)} transparent>
      <Pressable style={[st.pickerOverlay,{ backgroundColor:C.overlay }]} onPress={() => setPromptPicker(null)}>
        <Pressable style={[st.pickerSheet,{ backgroundColor:C.card, borderTopColor:C.cardBorder }]} onPress={e => e.stopPropagation()}>
          <View style={[st.pickerHandle,{ backgroundColor:C.inputBorder }]} />
          <Text style={[st.pickerTitle,{ color:C.text }]}>Choose a Prompt</Text>
          <LegendList
            data={promptQData}
            keyExtractor={item => item.q}
            estimatedItemSize={52}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[st.pickerOpt,{ borderBottomColor:C.inputBorder }]}
                onPress={() => {
                  if (promptPicker === null) return;
                  dispatch({ type:'SET_PROMPT', index:promptPicker, q:item.q, a:form.prompts[promptPicker]?.a??'' });
                  setPromptPicker(null);
                  haptic();
                }}
                activeOpacity={0.7}
                accessibilityLabel={item.q}
                accessibilityRole="button"
              >
                <Text style={[st.pickerOptText,{ color:C.text }]}>{item.q}</Text>
              </TouchableOpacity>
            )}
            recycleItems={false}
            scrollEnabled
          />
        </Pressable>
      </Pressable>
    </Modal>
  </KeyboardAvoidingView>
);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create((theme) => ({
root:               { flex:1 },
topBar:             { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:SPACING.lg, paddingVertical:SPACING.md, borderBottomWidth:1 },
backBtn:            { fontSize:FONT.lg, fontWeight:'600' },
topTitle:           { fontSize:FONT.base, fontWeight:'700', color:theme.colors.text },
draftLabel:         { fontSize:FONT.xs, color:theme.colors.textSecondary },
stepDots:           { flexDirection:'row', justifyContent:'center', alignItems:'center', gap:6, paddingVertical:SPACING.xs },
stepDot:            { width:7, height:7, borderRadius:4 },
progBg:             { height:3, width:'100%' },
progFill:           { height:3 },
sv:                 { flex:1 },
svContent:          { paddingHorizontal:SPACING.lg, paddingTop:SPACING.xl },
bottomPad:          { height:SPACING.xxxxl },
botBar:             { paddingHorizontal:SPACING.lg, paddingVertical:SPACING.md, borderTopWidth:1 },
nextBtnWrap:        { borderRadius:RADIUS.full, overflow:'hidden' },
nextBtnDisabled:    { opacity:0.9 },
nextBtn:            { paddingVertical:SPACING.lg, alignItems:'center', justifyContent:'center', borderRadius:RADIUS.full },
nextBtnText:        { fontSize:FONT.lg, fontWeight:'700' },
saveBtnRow:         { flexDirection:'row', alignItems:'center' },

// Form
fg:                 { marginBottom:SPACING.lg },
title:              { fontSize:FONT.xxxl, fontWeight:'800', marginBottom:SPACING.xs },
sub:                { fontSize:FONT.base, marginBottom:SPACING.xl },
label:              { fontSize:FONT.base, fontWeight:'600', marginBottom:SPACING.xs },
hint:               { fontSize:FONT.sm, marginBottom:SPACING.sm },
err:                { fontSize:FONT.sm, marginTop:SPACING.xs },
warn:               { fontSize:FONT.sm, marginTop:SPACING.xs },
input:              { borderWidth:1, borderRadius:RADIUS.md, paddingHorizontal:SPACING.md, paddingVertical:SPACING.md, fontSize:FONT.lg },
labelRow:           { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:SPACING.xs },
spacer:             { height:SPACING.xl },

// Birthday
bdayRow:            { flexDirection:'row', alignItems:'center', gap:SPACING.xs },
bdayIn:             { width:52, textAlign:'center' },
bdayInY:            { width:72, textAlign:'center' },
bdaySep:            { fontSize:FONT.xl, fontWeight:'300' },
ageRow:             { flexDirection:'row', alignItems:'center', gap:SPACING.md, marginTop:SPACING.xs },
ageDisplay:         { fontSize:FONT.base, fontWeight:'600' },
zodiac:             { fontSize:FONT.base, fontWeight:'500' },

// Height
unitBtn:            { paddingVertical:SPACING.xs, paddingHorizontal:SPACING.sm, borderRadius:RADIUS.sm, borderWidth:1 },
unitBtnText:        { fontSize:FONT.sm, fontWeight:'600' },
ftRow:              { flexDirection:'row', alignItems:'center', gap:SPACING.xs },
ftIn:               { width:52, textAlign:'center' },
ftLbl:              { fontSize:FONT.base },
hPreview:           { fontSize:FONT.sm, marginTop:SPACING.xs, fontWeight:'500' },

// Chips
chipWrap:           { flexDirection:'row', flexWrap:'wrap', gap:SPACING.xs, marginTop:SPACING.xs },
chip:               { flexDirection:'row', alignItems:'center', paddingVertical:SPACING.xs, paddingHorizontal:SPACING.md, borderRadius:RADIUS.full, borderWidth:1, gap:SPACING.xs },
chipOff:            { opacity:0.4 },
chipIcon:           { fontSize:FONT.base },
chipText:           { fontSize:FONT.sm },
chipCheck:          { fontSize:FONT.sm, fontWeight:'700' },

// Option rows
optRow:             { borderWidth:1, borderRadius:RADIUS.md, padding:SPACING.md, marginBottom:SPACING.xs },
optHead:            { flexDirection:'row', alignItems:'center', gap:SPACING.sm },
optIcon:            { fontSize:FONT.xl },
optText:            { fontSize:FONT.base, fontWeight:'600', flex:1 },
optCheck:           { fontSize:FONT.base, fontWeight:'700' },
optDesc:            { fontSize:FONT.sm, marginTop:SPACING.xxs, paddingLeft:SPACING.xxxl },

// Photos
slotStatus:         { flexDirection:'row', flexWrap:'wrap', gap:SPACING.xs, marginBottom:SPACING.lg },
statusItem:         { flexDirection:'row', alignItems:'center', gap:SPACING.xs, paddingVertical:SPACING.xs, paddingHorizontal:SPACING.sm, borderRadius:RADIUS.md, borderWidth:1 },
statusIcon:         { fontSize:FONT.base },
statusText:         { fontSize:FONT.xs, fontWeight:'600' },
loadRow:            { flexDirection:'row', alignItems:'center', gap:SPACING.sm, padding:SPACING.md, borderRadius:RADIUS.md, marginBottom:SPACING.sm },
loadRowText:        { fontSize:FONT.sm, fontWeight:'600' },
uploadBarWrap:      { flex:1 },
uploadBarBg:        { height:4, borderRadius:2, marginTop:SPACING.xs, overflow:'hidden' },
uploadBarFill:      { height:'100%', borderRadius:2 },
photoGrid:          { flexDirection:'row', flexWrap:'wrap', gap:SPACING.sm, marginBottom:SPACING.lg },
photoSlot:          { position:'relative', borderRadius:RADIUS.lg, overflow:'hidden' },
photoImg:           { width:160, height:200, borderRadius:RADIUS.lg, borderWidth:2 },
photoTypeTag:       { position:'absolute', top:SPACING.xs, left:SPACING.xs, backgroundColor:'rgba(0,0,0,0.55)', borderRadius:RADIUS.sm, paddingHorizontal:SPACING.xs, paddingVertical:2 },
photoTypeText:      { color:'#fff', fontSize:FONT.xs, fontWeight:'600' },
mainTag:            { position:'absolute', top:SPACING.xs, right:SPACING.xs, borderRadius:RADIUS.sm, paddingHorizontal:SPACING.xs, paddingVertical:2 },
mainTagText:        { fontSize:FONT.xs, fontWeight:'700' },
okDot:              { position:'absolute', bottom:SPACING.xxxxl+SPACING.sm, right:SPACING.xs, width:20, height:20, borderRadius:10, alignItems:'center', justifyContent:'center' },
okDotText:          { fontSize:FONT.xs, fontWeight:'700' },
moveRow:            { position:'absolute', bottom:SPACING.xxl, left:0, right:0, flexDirection:'row', justifyContent:'space-between', paddingHorizontal:SPACING.xs },
moveBtn:            { backgroundColor:'rgba(0,0,0,0.5)', borderRadius:RADIUS.sm, padding:SPACING.xs },
moveBtnText:        { fontSize:FONT.base, fontWeight:'700' },
rmBtn:              { position:'absolute', bottom:SPACING.xs, right:SPACING.xs, width:28, height:28, borderRadius:14, alignItems:'center', justifyContent:'center', borderWidth:2 },
rmBtnText:          { fontSize:FONT.lg, fontWeight:'700', lineHeight:FONT.xl },
addBtn:             { width:160, height:200, borderRadius:RADIUS.lg, borderWidth:2, borderStyle:'dashed', alignItems:'center', justifyContent:'center', gap:SPACING.xs },
addBtnOff:          { opacity:0.4 },
addBtnIcon:         { fontSize:FONT.xxl+4 },
addBtnLabel:        { fontSize:FONT.sm, fontWeight:'600' },
addBtnReq:          { fontSize:FONT.xs, fontWeight:'500' },
tipBox:             { borderRadius:RADIUS.md, borderWidth:1, padding:SPACING.md, marginBottom:SPACING.sm },
tipText:            { fontSize:FONT.sm, fontWeight:'600', textAlign:'center' },
socialProof:        { borderRadius:RADIUS.md, borderWidth:1, padding:SPACING.md, marginBottom:SPACING.sm },
socialProofText:    { fontSize:FONT.sm, textAlign:'center' },
photoHint:          { fontSize:FONT.xs, textAlign:'center', marginBottom:SPACING.sm },

// Vibes
vibeGrid:           { flexDirection:'row', flexWrap:'wrap', gap:SPACING.xs, marginTop:SPACING.xs },
vibeItem:           { width:44, height:44, borderRadius:RADIUS.md, borderWidth:1, alignItems:'center', justifyContent:'center' },
vibeEmoji:          { fontSize:FONT.xl },

// Range inputs
rangeRow:           { flexDirection:'row', alignItems:'center', gap:SPACING.xs },
rangeIn:            { width:72, textAlign:'center' },
rangeDash:          { fontSize:FONT.xl },
rangeU:             { fontSize:FONT.base },

// Bio / Prompts
bioSuggestion:      { fontSize:FONT.sm, fontWeight:'500', marginBottom:SPACING.xs },
bioIn:              { borderWidth:1, borderRadius:RADIUS.md, padding:SPACING.md, fontSize:FONT.base, minHeight:100 },
charCt:             { fontSize:FONT.xs, textAlign:'right', marginTop:SPACING.xxs },
promptCard:         { borderWidth:1, borderRadius:RADIUS.md, padding:SPACING.md, marginBottom:SPACING.sm },
promptQ:            { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:SPACING.xs },
promptQText:        { fontSize:FONT.base, fontWeight:'600', flex:1 },
promptArr:          { fontSize:FONT.sm },
promptIn:           { borderWidth:1, borderRadius:RADIUS.sm, padding:SPACING.sm, fontSize:FONT.base, minHeight:60 },
promptRm:           { alignSelf:'flex-end', marginTop:SPACING.xs },
promptRmText:       { fontSize:FONT.sm, fontWeight:'600' },
addPrompt:          { borderWidth:1, borderStyle:'dashed', borderRadius:RADIUS.md, padding:SPACING.md, alignItems:'center' },
addPromptText:      { fontSize:FONT.base, fontWeight:'600' },

// Location
locBtn:             { borderWidth:1, borderRadius:RADIUS.md, padding:SPACING.md },
locRow:             { flexDirection:'row', alignItems:'center', gap:SPACING.sm },
locBtnText:         { fontSize:FONT.base, fontWeight:'500' },
locConf:            { fontSize:FONT.sm, marginTop:SPACING.xs, fontWeight:'500' },
btnOff:             { opacity:0.5 },

// Preview
previewLabel:       { fontSize:FONT.sm, fontWeight:'600', marginBottom:SPACING.xs },
preview:            { borderWidth:1, borderRadius:RADIUS.lg, overflow:'hidden', marginBottom:SPACING.lg },
previewPhotoScroll: { height:200 },
previewThumb:       { width:160, height:200, marginRight:SPACING.xs },
blurOverlay:        { position:'absolute', top:0, left:0, right:0, height:200, alignItems:'center', justifyContent:'center', backgroundColor:'rgba(0,0,0,0.6)' },
blurText:           { fontSize:FONT.base, fontWeight:'700' },
previewInfo:        { padding:SPACING.lg },
previewName:        { fontSize:FONT.xxl, fontWeight:'800', marginBottom:SPACING.xs },
previewSub:         { fontSize:FONT.base, marginBottom:SPACING.xs },
previewDetail:      { fontSize:FONT.sm, marginBottom:SPACING.xxs },
previewVibes:       { fontSize:FONT.xl, letterSpacing:4, marginVertical:SPACING.xs },
previewBio:         { fontSize:FONT.base, lineHeight:FONT.xxl, marginVertical:SPACING.xs },
previewTags:        { flexDirection:'row', flexWrap:'wrap', gap:SPACING.xs, marginTop:SPACING.xs },
previewTag:         { paddingVertical:SPACING.xxs, paddingHorizontal:SPACING.sm, borderRadius:RADIUS.full },
previewTagText:     { fontSize:FONT.xs, fontWeight:'600' },
previewMore:        { fontSize:FONT.xs, alignSelf:'center' },
previewPhotoCt:     { fontSize:FONT.sm, marginTop:SPACING.sm },

// Completion
pctCard:            { borderWidth:1, borderRadius:RADIUS.md, padding:SPACING.md, marginBottom:SPACING.lg },
pctTitle:           { fontSize:FONT.base, fontWeight:'700', marginBottom:SPACING.sm },
pctBarBg:           { height:8, borderRadius:4, overflow:'hidden' },
pctBarFill:         { height:'100%', borderRadius:4 },
pctHint:            { fontSize:FONT.xs, marginTop:SPACING.xs },

// Terms
termsRow:           { flexDirection:'row', alignItems:'center', gap:SPACING.md, borderWidth:1, borderRadius:RADIUS.md, padding:SPACING.md },
termsText:          { fontSize:FONT.sm, lineHeight:FONT.xl },
termsLink:          { fontWeight:'700' },

// Privacy
privacyCard:        { borderWidth:1, borderRadius:RADIUS.lg, padding:SPACING.lg, marginBottom:SPACING.lg },
privacyTitle:       { fontSize:FONT.lg, fontWeight:'700', marginBottom:SPACING.md },
privRow:            { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:SPACING.md, borderBottomWidth:1 },
privInfo:           { flex:1, marginRight:SPACING.md },
privLabel:          { fontSize:FONT.base, fontWeight:'600' },
privDesc:           { fontSize:FONT.xs, marginTop:2 },

// Camera modal
camModal:           { flex:1 },
camHead:            { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:SPACING.lg, paddingVertical:SPACING.md, borderBottomWidth:1 },
camCancel:          { fontSize:FONT.base, fontWeight:'700' },
camHeadCenter:      { flex:1, alignItems:'center', paddingHorizontal:SPACING.sm },
camTitle:           { fontSize:FONT.base, fontWeight:'700' },
camInstr:           { fontSize:FONT.xs, textAlign:'center', lineHeight:FONT.lg },
camCaptureHeaderBtn:     { paddingVertical:SPACING.xs, paddingHorizontal:SPACING.md, borderRadius:RADIUS.md, backgroundColor:'rgba(108,99,255,0.2)' },
camCaptureHeaderBtnText: { fontSize:FONT.sm, fontWeight:'700' },
camContent:         { flex:1, alignItems:'center', justifyContent:'center', padding:SPACING.lg },
camBox:             { width:'100%', aspectRatio:3/4, borderRadius:RADIUS.xl, overflow:'hidden', borderWidth:2, position:'relative' },
camNative:          { flex:1 },
camErrWrap:         { flex:1, alignItems:'center', justifyContent:'center', gap:SPACING.md, padding:SPACING.xl },
camErrIcon:         { fontSize:48 },
camErrText:         { fontSize:FONT.base, textAlign:'center', fontWeight:'500' },
camLoadWrap:        { alignItems:'center', justifyContent:'center', gap:SPACING.sm, backgroundColor:'rgba(0,0,0,0.5)' },
camLoadText:        { fontSize:FONT.sm },
camProcessingOverlay:{ ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,0,0,0.7)', alignItems:'center', justifyContent:'center', gap:SPACING.md },
camProcessingText:  { fontSize:FONT.lg, fontWeight:'600' },
retryBtn:           { paddingVertical:SPACING.sm, paddingHorizontal:SPACING.xl, borderRadius:RADIUS.full },
retryBtnText:       { fontSize:FONT.base, fontWeight:'700' },
countdownOverlay:   { position:'absolute', top:0, left:0, right:0, bottom:0, alignItems:'center', justifyContent:'center', pointerEvents:'none' },
countdownText:      { fontSize:80, fontWeight:'900', textShadowColor:'rgba(0,0,0,0.8)', textShadowOffset:{ width:2, height:2 }, textShadowRadius:8 },
countdownInner:     { fontSize:FONT.xl, fontWeight:'900' },
camControls:        { paddingVertical:SPACING.lg, paddingHorizontal:SPACING.xl, gap:SPACING.md, borderTopWidth:1 },
timerBtn:           { alignSelf:'center', paddingVertical:SPACING.xs, paddingHorizontal:SPACING.xl, borderRadius:RADIUS.full, borderWidth:1 },
timerBtnText:       { fontSize:FONT.sm, fontWeight:'600' },
camBtnRow:          { flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
flipBtn:            { width:48, height:48, borderRadius:24, borderWidth:1, alignItems:'center', justifyContent:'center' },
flipBtnText:        { fontSize:FONT.xxl },
captureBtn:         { width:76, height:76, borderRadius:38, borderWidth:3, alignItems:'center', justifyContent:'center' },
captureBtnOff:      { opacity:0.5 },
captureBtnInner:    { width:60, height:60, borderRadius:30, alignItems:'center', justifyContent:'center' },
captureBtnIcon:     { fontSize:28 },
camReadyHint:       { fontSize:FONT.xs, textAlign:'center' },

// Prompt picker
pickerOverlay:      { flex:1, justifyContent:'flex-end' },
pickerSheet:        { borderTopLeftRadius:RADIUS.xl, borderTopRightRadius:RADIUS.xl, borderTopWidth:1, maxHeight:'70%' },
pickerHandle:       { width:40, height:4, borderRadius:2, alignSelf:'center', marginTop:SPACING.sm, marginBottom:SPACING.md },
pickerTitle:        { fontSize:FONT.xl, fontWeight:'700', textAlign:'center', marginBottom:SPACING.md, paddingHorizontal:SPACING.lg },
pickerOpt:          { paddingVertical:SPACING.lg, paddingHorizontal:SPACING.xl, borderBottomWidth:1 },
pickerOptText:      { fontSize:FONT.base, lineHeight:FONT.xxl },
}));