/**
 * PersonalityQuizScreen — 5-dimension personality assessment (v3.0)
 *
 * KEY FIX: Removed fragile animation-lock system entirely.
 * Instead uses a simple `transitioning` state that auto-clears,
 * and buttons are NEVER disabled by animation state — only by
 * the brief post-tap delay. This eliminates the "frozen buttons" bug.
 */

import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../firebaseConfig';
import { useLanguage } from '../utils/languageContext';
import { appStorage } from '../utils/storage';

/* ═══════════════ CONSTANTS ═══════════════ */

const QUIZ_VERSION = '3.0';
const TOTAL_QUESTIONS = 30;
const ARCHETYPE_CODE_TRAITS = 4;
const MAX_FONT_SCALE = 1.4;
const INSIGHT_INTERVAL = 6;

const ANSWER_DELAY_MS = 350;
const BAR_ANIM_MS = 800;
const BAR_DELAY_MS = 150;

const SCORE_STRONG_A = 0;
const SCORE_LEAN_A = 25;
const SCORE_NEUTRAL = 50;
const SCORE_LEAN_B = 75;
const SCORE_STRONG_B = 100;

const THRESH_STRONG_LOW = 25;
const THRESH_LEAN_LOW = 40;
const THRESH_LEAN_HIGH = 60;
const THRESH_STRONG_HIGH = 75;

const DRAFT_KEY = 'pq_draft_v3';
const ANALYTICS_KEY = 'pq_analytics';
const PENDING_SAVE_KEY = 'pq_pending_save';

const IS_WEB = Platform.OS === 'web';
const SCREEN_W = Dimensions.get('window').width;
const HIT = { top: 12, bottom: 12, left: 12, right: 12 } as const;

/* ═══════════════ DESIGN TOKENS ═══════════════ */

const C = {
  bg: '#1a1a2e', card: '#16213e', cardHi: '#1d2b4f', input: '#0f3460',
  accent: '#53a8b6', success: '#5cb85c', danger: '#d9534f', warning: '#e67e22',
  purple: '#9b59b6', gold: '#f1c40f', text: '#eeeeee', sub: '#b0b0b0',
  muted: '#999999', dim: '#777777', white: '#ffffff', none: 'transparent',
} as const;

/* ═══════════════ TYPES ═══════════════ */

type TraitKey = 'energy' | 'planning' | 'emotion' | 'social' | 'adventure';

interface TraitDef {
  readonly key: TraitKey; readonly name: string;
  readonly lowLabel: string; readonly highLabel: string;
  readonly lowEmoji: string; readonly highEmoji: string;
  readonly color: string; readonly description: string;
}
interface QuizQuestion {
  readonly id: number; readonly trait: TraitKey; readonly question: string;
  readonly sideA: string; readonly sideB: string;
  readonly scenario: string; readonly weight: number;
}
interface AnswerOption {
  readonly id: number; readonly score: number;
  readonly emoji: string; readonly side: 'A' | 'neutral' | 'B';
}
interface Archetype {
  readonly name: string; readonly emoji: string; readonly title: string;
  readonly description: string; readonly strengths: readonly string[];
  readonly growthAreas: readonly string[]; readonly inRelationship: string;
  readonly communicationStyle: string; readonly conflictStyle: string;
  readonly idealDates: readonly string[]; readonly loveLanguageFit: string;
  readonly bestMatchWith: string; readonly compatReason: string;
  readonly population: number;
}
interface TraitScore {
  readonly key: TraitKey; readonly score: number;
  readonly label: string; readonly consistency: number;
}
interface QuizResults {
  readonly archetype: Archetype; readonly archetypeCode: string;
  readonly traits: readonly TraitScore[]; readonly adventureScore: number;
  readonly overallConsistency: number; readonly summary: string;
  readonly quizVersion: string; readonly completedAt: string;
  readonly totalTimeMs: number; readonly questionTimesMs: readonly number[];
}
interface InsightCard {
  readonly emoji: string; readonly title: string; readonly body: string;
}

/* ═══════════════ TRAIT DEFINITIONS ═══════════════ */

const TRAITS: readonly TraitDef[] = Object.freeze([
  { key: 'energy', name: 'Energy', lowLabel: 'Introvert', highLabel: 'Extrovert', lowEmoji: '🌙', highEmoji: '☀️', color: '#9b59b6', description: 'How you recharge and where you draw energy from' },
  { key: 'planning', name: 'Planning', lowLabel: 'Spontaneous', highLabel: 'Structured', lowEmoji: '🌊', highEmoji: '📋', color: '#3498db', description: 'How you organize your life and make decisions' },
  { key: 'emotion', name: 'Decisions', lowLabel: 'Head (Logic)', highLabel: 'Heart (Feeling)', lowEmoji: '🧠', highEmoji: '❤️', color: '#e74c3c', description: 'Whether you lead with logic or feelings' },
  { key: 'social', name: 'Connection', lowLabel: 'Independent', highLabel: 'People-Person', lowEmoji: '🏔️', highEmoji: '🤗', color: '#2ecc71', description: 'How you build and maintain relationships' },
  { key: 'adventure', name: 'Adventure', lowLabel: 'Comfort-Seeker', highLabel: 'Thrill-Seeker', lowEmoji: '🏠', highEmoji: '🚀', color: '#e67e22', description: 'How you approach new experiences and change' },
] as const);

const TRAIT_MAP = Object.freeze(
  Object.fromEntries(TRAITS.map((t) => [t.key, t])) as Record<TraitKey, TraitDef>
);

/* ═══════════════ ANSWER OPTIONS ═══════════════ */

const ANSWER_OPTIONS: readonly AnswerOption[] = Object.freeze([
  { id: 0, score: SCORE_STRONG_A, emoji: '💯', side: 'A' },
  { id: 1, score: SCORE_LEAN_A, emoji: '👍', side: 'A' },
  { id: 2, score: SCORE_NEUTRAL, emoji: '🤷', side: 'neutral' },
  { id: 3, score: SCORE_LEAN_B, emoji: '👍', side: 'B' },
  { id: 4, score: SCORE_STRONG_B, emoji: '💯', side: 'B' },
] as const);

/* ═══════════════ QUESTIONS ═══════════════ */

const QUESTIONS: readonly QuizQuestion[] = Object.freeze([
  { id: 1, trait: 'energy', question: 'After a long, exhausting day, your ideal evening is:', sideA: 'Solo time — book, music, peaceful quiet at home', sideB: 'Calling friends to meet up, being around people', scenario: '🔋 How you recharge', weight: 1.5 },
  { id: 2, trait: 'energy', question: "It's Friday night and you have zero plans. You feel:", sideA: 'Relieved — finally some peace and quiet to yourself', sideB: 'Restless — immediately start texting people', scenario: '🌙 Friday night', weight: 1 },
  { id: 3, trait: 'energy', question: 'You arrive at a party where you know almost no one:', sideA: 'Stick with the 1-2 people you know, or slip out early', sideB: 'Thrive on it — work the room, introduce yourself to everyone', scenario: '🎉 Social situations', weight: 1 },
  { id: 4, trait: 'energy', question: 'Your dream vacation looks like:', sideA: 'Secluded cabin, nature walks alone, reading by the fire', sideB: 'Group trip with packed itinerary, nightlife, and adventures', scenario: '✈️ Travel style', weight: 1 },
  { id: 5, trait: 'energy', question: 'When you need to think through an important life decision:', sideA: 'You need complete solitude to think clearly', sideB: 'You talk it through with as many people as possible', scenario: '💭 Processing style', weight: 1.5 },
  { id: 6, trait: 'energy', question: 'Your texting and calling habits look like:', sideA: 'Short replies; save real conversations for in-person', sideB: 'Love long voice notes, constant check-ins, group chats', scenario: '📱 Communication energy', weight: 1 },
  { id: 7, trait: 'planning', question: 'Your approach to weekend plans:', sideA: 'Wake up and see what happens — go with the flow', sideB: 'By Friday night you have Saturday and Sunday mapped out', scenario: '📅 Making plans', weight: 1.5 },
  { id: 8, trait: 'planning', question: 'Your personal space (room, desk, kitchen) is usually:', sideA: 'Organized chaos — messy but you know where everything is', sideB: 'Everything labeled, sorted, and in its designated place', scenario: '🏠 Your space', weight: 1 },
  { id: 9, trait: 'planning', question: "A friend texts: 'Road trip tomorrow, you in?'", sideA: '"I\'m in!" — throw things in a bag and figure it out', sideB: '"Let me check my calendar, plan the route, and pack properly"', scenario: '🚗 Spontaneity test', weight: 1 },
  { id: 10, trait: 'planning', question: 'Planning a first date with someone new:', sideA: '"Let\'s meet at 7 and see where the night takes us"', sideB: 'Reservation booked, menu reviewed, outfit picked yesterday', scenario: '💑 First date approach', weight: 1.5 },
  { id: 11, trait: 'planning', question: 'How you pack for a week-long trip:', sideA: 'Toss things in a bag the morning of — wing it', sideB: 'Packing list, rolled clothes, outfits planned per day', scenario: '🧳 Travel prep', weight: 1 },
  { id: 12, trait: 'planning', question: 'Your partner surprises you with an unplanned weekend away:', sideA: 'Thrilled! You love the spontaneity and surprise', sideB: 'Anxious — you had plans, need to rearrange, pack properly', scenario: '🎁 Handling surprises', weight: 1 },
  { id: 13, trait: 'emotion', question: 'A close friend calls you crying about a breakup. You:', sideA: 'Help them analyze what went wrong and plan actionable next steps', sideB: 'Just listen, hold space, let them feel everything they need to', scenario: '🤝 Supporting others', weight: 1.5 },
  { id: 14, trait: 'emotion', question: 'Choosing between two apartments to rent:', sideA: 'Spreadsheet comparing price, commute, square footage, amenities', sideB: 'Go with the one that "feels like home" when you walk in', scenario: '💼 Big decisions', weight: 1 },
  { id: 15, trait: 'emotion', question: 'During a disagreement with your partner:', sideA: 'You build a logical case, present facts, stay composed', sideB: 'You express how hurt or frustrated you feel, get emotional', scenario: '💬 Conflict style', weight: 1.5 },
  { id: 16, trait: 'emotion', question: 'A movie has a deeply emotional, gut-wrenching ending:', sideA: 'You appreciate the filmmaking craft but stay composed', sideB: 'Tears flowing — you feel everything and are not ashamed', scenario: '🎬 Emotional expression', weight: 1 },
  { id: 17, trait: 'emotion', question: 'Buying a gift for someone you love:', sideA: 'Research the most useful, practical, well-reviewed option', sideB: 'Choose something with deep sentimental meaning, even if impractical', scenario: '🎁 Gift-giving approach', weight: 1 },
  { id: 18, trait: 'emotion', question: "You've accidentally hurt someone's feelings. You:", sideA: 'Acknowledge the mistake, explain your reasoning, propose a fix', sideB: 'Focus entirely on understanding their pain before anything else', scenario: '💔 Making amends', weight: 1 },
  { id: 19, trait: 'social', question: 'In a relationship, your ideal week together looks like:', sideA: '2-3 quality hangouts; the rest is sacred personal time', sideB: 'Together most evenings, sharing daily routines and meals', scenario: '💕 Relationship needs', weight: 1.5 },
  { id: 20, trait: 'social', question: 'Going through a really difficult time in your life:', sideA: 'You process it privately first — maybe share later, maybe not', sideB: 'Immediately reach out to friends and family for support', scenario: '🧠 Coping style', weight: 1 },
  { id: 21, trait: 'social', question: 'Your ideal living situation:', sideA: 'Solo apartment, or just you and a partner — your sanctuary', sideB: 'Roommates, communal space, neighbors always dropping by', scenario: '🏡 Living preferences', weight: 1 },
  { id: 22, trait: 'social', question: 'Your partner wants you to become close with all their friends:', sideA: 'You prefer having your own separate social circles', sideB: 'Love it — merge the groups, the more connections the better', scenario: '🤔 Social boundaries', weight: 1 },
  { id: 23, trait: 'social', question: "It's your birthday. Your ideal celebration:", sideA: 'Quiet dinner with 1-3 of your closest people (or just you)', sideB: 'Huge party with everyone you know — the more the merrier', scenario: '🎂 Celebrations', weight: 1.5 },
  { id: 24, trait: 'social', question: 'You just received amazing, life-changing news:', sideA: 'Savor it quietly first, tell a few people gradually', sideB: 'Immediately call everyone, share it everywhere, celebrate loudly', scenario: '🎉 Sharing joy', weight: 1 },
  { id: 25, trait: 'adventure', question: "You're offered a job in a country you've never visited:", sideA: 'Prefer the comfort and stability of your current life', sideB: 'Already looking at flights — a whole new chapter!', scenario: '🌍 Change tolerance', weight: 1.5 },
  { id: 26, trait: 'adventure', question: 'At a restaurant with an unusual, adventurous menu:', sideA: 'Find the familiar dish you know you will enjoy', sideB: 'Order the most exotic thing you have never tried', scenario: '🍽️ New experiences', weight: 1 },
  { id: 27, trait: 'adventure', question: 'Your bucket list is mostly filled with:', sideA: 'Perfect garden, cozy home, master a craft, daily rituals', sideB: 'Skydive, backpack Asia, start a business, learn to surf', scenario: '📝 Life goals', weight: 1 },
  { id: 28, trait: 'adventure', question: 'Your approach to hobbies and interests:', sideA: 'Deep mastery of a few things you love — depth over breadth', sideB: 'Always picking up something new — variety is the spice of life', scenario: '🎯 Exploration style', weight: 1 },
  { id: 29, trait: 'adventure', question: 'In your career, you gravitate toward:', sideA: 'Stable path, clear progression, work-life balance, no surprises', sideB: 'Startup energy, pivoting, risk-taking, chasing ambitious goals', scenario: '💼 Career approach', weight: 1 },
  { id: 30, trait: 'adventure', question: 'A date suggests something you have never done before:', sideA: 'Suggest something classic instead — dinner, walk, coffee', sideB: 'Love it — escape room, pottery class, midnight hike, whatever', scenario: '❤️ Dating adventures', weight: 1.5 },
] as const);

/* ═══════════════ INSIGHT CARDS ═══════════════ */

const INSIGHTS: readonly InsightCard[] = Object.freeze([
  { emoji: '🧬', title: 'Did you know?', body: 'Personality traits are about 40-60% heritable, but your experiences shape how they express themselves in relationships.' },
  { emoji: '💕', title: 'Opposites attract... sometimes', body: 'Research shows couples with complementary (not identical) personality traits tend to have the most dynamic relationships.' },
  { emoji: '📊', title: 'Fun fact', body: 'People who know their own personality type report 23% higher relationship satisfaction — self-awareness is attractive!' },
  { emoji: '🧠', title: 'Almost there!', body: 'Your answers are forming a unique personality fingerprint. No two profiles are exactly alike, even within the same archetype.' },
] as const);

/* ═══════════════ ARCHETYPES ═══════════════ */

const DEFAULT_ARCHETYPE: Archetype = Object.freeze({
  name: 'The Philosopher', emoji: '🦉', title: 'Deep Thinker',
  description: 'Introspective, logical, and comfortable in solitude. You see the world through a unique analytical lens and value depth over surface-level connection.',
  strengths: ['Wise', 'Self-aware', 'Thoughtful', 'Principled'],
  growthAreas: ['Opening up emotionally', 'Initiating social plans', 'Letting go of overthinking', 'Being more spontaneous with feelings'],
  inRelationship: 'You need intellectual connection and plenty of personal space. You show love through thoughtful gestures and deep conversations.',
  communicationStyle: 'Measured and precise. You think before you speak and prefer meaningful conversations over small talk.',
  conflictStyle: 'You withdraw to process, then return with a well-reasoned perspective. You can seem emotionally distant during arguments.',
  idealDates: ['Bookshop browsing followed by a quiet café', 'Documentary screening and discussion', 'Museum visit and philosophical dinner conversation'],
  loveLanguageFit: 'Quality Time & Words of Affirmation',
  bestMatchWith: 'The Adventurous Spirit or The Nurturer',
  compatReason: 'Adventurous types bring excitement to your reflective world; Nurturers provide warmth and patience that helps you open up.',
  population: 8,
});

const ARCHETYPES: Readonly<Record<string, Archetype>> = Object.freeze({
  LLLL: DEFAULT_ARCHETYPE,
  LLLH: Object.freeze({ name: 'The Lone Wolf', emoji: '🐺', title: 'Independent Thinker', description: 'You value independence and make decisions with clear logic. You prefer deep bonds with a select few over a wide social circle.', strengths: ['Self-reliant', 'Analytical', 'Calm under pressure', 'Fiercely loyal'], growthAreas: ['Expressing vulnerability', 'Accepting help from others', 'Compromising in partnerships', 'Sharing feelings before being asked'], inRelationship: 'You need a partner who respects your autonomy and stimulates your mind without crowding your space.', communicationStyle: 'Direct and efficient. You say what you mean and expect the same.', conflictStyle: 'You stay calm and logical but can seem cold. You need space to process before discussing issues.', idealDates: ['Hiking a challenging trail together', 'Home-cooked dinner with no phones', 'Stargazing in a remote location'], loveLanguageFit: 'Acts of Service & Quality Time', bestMatchWith: 'The Social Butterfly or The Nurturer', compatReason: 'Social Butterflies draw you out of your shell with warmth; Nurturers create a safe space where you feel comfortable opening up.', population: 6 }),
  LLHL: Object.freeze({ name: 'The Sensitive Soul', emoji: '🦋', title: 'Quiet Empath', description: 'You feel deeply and process quietly. Your emotional intelligence is a superpower, even if the world does not always see it.', strengths: ['Empathetic', 'Creative', 'Perceptive', 'Authentic'], growthAreas: ['Setting emotional boundaries', 'Not absorbing others\' stress', 'Speaking up for your needs', 'Building resilience to criticism'], inRelationship: 'You need emotional safety and a partner who understands that your quiet moments are not distance — they are recharging.', communicationStyle: 'Gentle and intuitive. You pick up on unspoken feelings and communicate through warmth more than words.', conflictStyle: 'You feel hurt deeply but may not express it immediately. You need reassurance that the relationship is safe before opening up.', idealDates: ['Art gallery followed by a heartfelt talk', 'Sunset walk along the water', 'Cooking together with soft music playing'], loveLanguageFit: 'Words of Affirmation & Physical Touch', bestMatchWith: 'The Protector or The Social Butterfly', compatReason: 'Protectors offer the stability and loyalty you crave; Social Butterflies help you engage with the world while keeping things light.', population: 7 }),
  LLHH: Object.freeze({ name: 'The Dreamer', emoji: '🌙', title: 'Imaginative Free Spirit', description: 'Creative, emotionally rich, and driven by feelings. You follow your heart, see beauty everywhere, and inspire others with your vision.', strengths: ['Imaginative', 'Passionate', 'Compassionate', 'Inspiring'], growthAreas: ['Following through on plans', 'Staying grounded in reality', 'Handling practical details', 'Not taking criticism personally'], inRelationship: 'You need a partner who supports your dreams, connects emotionally, and helps ground your ideas into reality.', communicationStyle: 'Expressive and poetic. You use stories, metaphors, and emotion to communicate.', conflictStyle: 'You feel conflicts intensely and may become overwhelmed. You need time to process emotions before finding resolution.', idealDates: ['Open mic poetry night', 'Painting or pottery class together', 'Spontaneous drive to watch the sunrise'], loveLanguageFit: 'Words of Affirmation & Gifts (meaningful ones)', bestMatchWith: 'The Protector or The Commander', compatReason: 'Protectors ground your dreams in loyalty and stability; Commanders provide the structure to turn your visions into reality.', population: 5 }),
  LHLL: Object.freeze({ name: 'The Architect', emoji: '🏗️', title: 'Strategic Planner', description: 'Methodical, independent, and logical. You build your life with precision, purpose, and quiet determination.', strengths: ['Strategic', 'Reliable', 'Efficient', 'Detail-oriented'], growthAreas: ['Loosening up and being playful', 'Expressing emotions openly', 'Adapting when plans change', 'Showing affection spontaneously'], inRelationship: 'You show love through planning, reliability, and building a stable future together.', communicationStyle: 'Clear, structured, and to the point. You organize your thoughts before speaking.', conflictStyle: 'You approach conflict methodically — identify the problem, propose solutions. Emotion-heavy arguments frustrate you.', idealDates: ['Wine tasting with structured pairings', 'Escape room challenge', 'Well-planned day trip to a historic town'], loveLanguageFit: 'Acts of Service & Quality Time', bestMatchWith: 'The Dreamer or The Nurturer', compatReason: 'Dreamers bring color and emotion to your structured world; Nurturers provide the relational warmth that your analytical nature needs.', population: 7 }),
  LHLH: Object.freeze({ name: 'The Protector', emoji: '🛡️', title: 'Loyal Guardian', description: 'Structured, caring, and deeply loyal. You create safety for those you love and protect them with quiet, unwavering strength.', strengths: ['Dependable', 'Nurturing', 'Organized', 'Protective'], growthAreas: ['Letting others take care of you', 'Not over-controlling situations', 'Expressing your own needs', 'Accepting imperfection'], inRelationship: 'You are the rock. You create stability, safety, and consistency. Your love language is showing up — every single time.', communicationStyle: 'Steady and reassuring. You listen patiently and respond thoughtfully.', conflictStyle: 'You stay calm and try to mediate. You may suppress your own frustration to keep the peace.', idealDates: ['Home-cooked meal you planned together', 'Farmer\'s market followed by cooking together', 'Nature walk with deep conversation'], loveLanguageFit: 'Acts of Service & Physical Touch', bestMatchWith: 'The Sensitive Soul or The Adventurous Spirit', compatReason: 'Sensitive Souls blossom under your protection; Adventurous Spirits keep your life exciting while you keep theirs stable.', population: 8 }),
  LHHL: Object.freeze({ name: 'The Sage', emoji: '📚', title: 'Wise Counselor', description: 'You combine emotional depth with structured thinking. People naturally come to you for wisdom, guidance, and a calm perspective.', strengths: ['Wise', 'Emotionally intelligent', 'Patient', 'Balanced'], growthAreas: ['Being less guarded with your own feelings', 'Taking risks', 'Being spontaneous sometimes', 'Not always being the "strong one"'], inRelationship: 'You bring emotional maturity and stability. You are both structured and feeling, which makes you an incredible partner.', communicationStyle: 'Thoughtful and balanced. You consider both logic and emotion before responding.', conflictStyle: 'You mediate naturally, seeing both sides. The risk is you may prioritize fairness over expressing your own hurt.', idealDates: ['Tea ceremony or mindfulness workshop', 'Deep conversation walk in botanical gardens', 'Book exchange and reading café'], loveLanguageFit: 'Quality Time & Words of Affirmation', bestMatchWith: 'The Adventurous Spirit or The Social Butterfly', compatReason: 'Adventurous types challenge and energize your contemplative nature; Social Butterflies bring lightness to your depth.', population: 5 }),
  LHHH: Object.freeze({ name: 'The Nurturer', emoji: '🌷', title: 'Caring Organizer', description: 'You combine genuine warmth with thoughtful structure. You care deeply and show it through consistent, considerate actions.', strengths: ['Caring', 'Organized', 'Emotionally available', 'Supportive'], growthAreas: ['Not over-giving at your own expense', 'Setting boundaries', 'Accepting that you cannot fix everyone', 'Asking for what you need'], inRelationship: 'You create a loving, well-organized partnership. Your home is warm, your communication is clear, and your partner always feels cared for.', communicationStyle: 'Warm and attentive. You check in regularly, remember details, and make people feel valued.', conflictStyle: 'You address issues gently but directly. You want resolution and harmony.', idealDates: ['Volunteering together followed by a cozy dinner', 'Baking something elaborate together', 'Planning a surprise care package for a friend — together'], loveLanguageFit: 'Acts of Service & Gifts (thoughtful ones)', bestMatchWith: 'The Lone Wolf or The Philosopher', compatReason: 'Lone Wolves and Philosophers need your warmth to open up, and your structure complements their independence beautifully.', population: 6 }),
  HLLL: Object.freeze({ name: 'The Maverick', emoji: '⚡', title: 'Bold Individualist', description: 'Outgoing and logical, you march to your own beat. You light up rooms while staying fiercely true to yourself.', strengths: ['Charismatic', 'Independent-minded', 'Bold', 'Direct'], growthAreas: ['Listening to others\' emotions', 'Slowing down for quieter partners', 'Admitting when you are wrong', 'Being vulnerable'], inRelationship: 'You bring energy, honesty, and independence. You need a partner who can match your pace without trying to tame you.', communicationStyle: 'Direct and energetic. You say exactly what you think, which is refreshing — but can sometimes lack tact.', conflictStyle: 'You confront issues head-on, immediately. You want fast resolution.', idealDates: ['Rock climbing or go-karting', 'Stand-up comedy show', 'Spontaneous road trip to somewhere neither of you has been'], loveLanguageFit: 'Physical Touch & Quality Time', bestMatchWith: 'The Sage or The Protector', compatReason: 'Sages match your depth while balancing your intensity; Protectors provide the loyalty and stability you secretly value most.', population: 5 }),
  HLLH: Object.freeze({ name: 'The Social Butterfly', emoji: '🦋', title: 'Life of the Party', description: 'Outgoing, spontaneous, and people-loving. You thrive on connection, make friends everywhere, and bring joy to every gathering.', strengths: ['Social', 'Adaptable', 'Fun-loving', 'Great networker'], growthAreas: ['Deepening relationships beyond surface level', 'Being comfortable alone', 'Following through on commitments', 'Having difficult conversations'], inRelationship: 'You bring excitement, social energy, and keep things fresh. But you need to learn that deep love requires vulnerability, not just fun.', communicationStyle: 'Warm, frequent, and enthusiastic. You love constant connection.', conflictStyle: 'You avoid heavy conflict and try to lighten the mood.', idealDates: ['Lively food market hopping', 'Group double date with friends', 'Dance class or karaoke night'], loveLanguageFit: 'Physical Touch & Words of Affirmation', bestMatchWith: 'The Philosopher or The Sensitive Soul', compatReason: 'Philosophers add depth and substance to your social world; Sensitive Souls appreciate your warmth and teach you emotional depth.', population: 7 }),
  HLHL: Object.freeze({ name: 'The Adventurous Spirit', emoji: '🌍', title: 'Passionate Explorer', description: 'You combine outgoing energy with deep feeling. You experience life intensely, love wholeheartedly, and chase every experience.', strengths: ['Passionate', 'Expressive', 'Adventurous', 'Romantic'], growthAreas: ['Staying committed when the "newness" fades', 'Being patient with slower-paced partners', 'Finishing what you start', 'Sitting with boredom'], inRelationship: 'You bring passion, spontaneity, and emotional intensity. Your partner will never be bored — but needs to keep up.', communicationStyle: 'Passionate and expressive. You share feelings openly, sometimes dramatically.', conflictStyle: 'You are emotionally intense during conflicts — big feelings, big expressions.', idealDates: ['Hot air balloon ride at sunset', 'Street food crawl in a new neighborhood', 'Skinny dipping or midnight beach walk'], loveLanguageFit: 'Physical Touch & Quality Time (adventurous)', bestMatchWith: 'The Architect or The Protector', compatReason: 'Architects channel your spontaneous energy into lasting experiences; Protectors create the safety net that allows you to fly freely.', population: 6 }),
  HLHH: Object.freeze({ name: 'The Inspirer', emoji: '✨', title: 'Charismatic Leader', description: 'You light up every room with warmth, energy, and genuine care. People are drawn to your enthusiasm and emotional openness.', strengths: ['Inspiring', 'Warm', 'Energetic', 'Motivating'], growthAreas: ['Listening more than talking', 'Accepting that not everyone shares your energy', 'Handling criticism gracefully', 'Following through on all your ideas'], inRelationship: 'You bring excitement, emotional connection, and social richness. You love grand gestures.', communicationStyle: 'Enthusiastic and emotional. You lead with energy and feeling.', conflictStyle: 'You want to talk it out immediately and passionately.', idealDates: ['Surprise rooftop dinner you planned', 'Live music festival', 'Couples cooking class with a social vibe'], loveLanguageFit: 'Words of Affirmation & Gifts (grand gestures)', bestMatchWith: 'The Architect or The Sage', compatReason: 'Architects help structure your endless ideas into reality; Sages add depth and wisdom to your passionate approach.', population: 5 }),
  HHLL: Object.freeze({ name: 'The Commander', emoji: '👑', title: 'Strategic Leader', description: 'Outgoing, organized, and logical. You naturally take charge, set goals, and get things done with impressive efficiency.', strengths: ['Leadership', 'Organized', 'Decisive', 'Goal-oriented'], growthAreas: ['Letting others lead sometimes', 'Being emotionally present', 'Not treating relationships like projects', 'Showing vulnerability'], inRelationship: 'You bring structure, direction, and reliability. You plan the vacations, manage the finances, and lead the partnership.', communicationStyle: 'Clear, structured, and efficient. You run conversations like meetings.', conflictStyle: 'You approach conflict as a problem to solve. You present facts, propose solutions, and expect quick resolution.', idealDates: ['Competitive activity (bowling, mini golf, trivia)', 'Strategy board game café', 'Well-planned city exploration with an itinerary'], loveLanguageFit: 'Acts of Service & Quality Time (structured)', bestMatchWith: 'The Dreamer or The Sensitive Soul', compatReason: 'Dreamers inspire your vision and bring emotional color; Sensitive Souls teach you depth and vulnerability.', population: 6 }),
  HHLH: Object.freeze({ name: 'The Connector', emoji: '🔗', title: 'Community Builder', description: 'Outgoing, organized, and people-focused. You bring groups together, maintain connections, and make everyone feel they belong.', strengths: ['Organized', 'Social', 'Reliable', 'Inclusive'], growthAreas: ['Focusing on depth over breadth in relationships', 'Not spreading yourself too thin', 'Prioritizing your own needs', 'Being comfortable with silence'], inRelationship: 'You build a strong social foundation, plan gatherings, and keep the relationship embedded in community.', communicationStyle: 'Frequent, organized, and social. You are the group chat admin, the plan-maker.', conflictStyle: 'You try to involve mediators or seek outside perspective.', idealDates: ['Dinner party you hosted together', 'Community volunteering event', 'Game night with your combined friend groups'], loveLanguageFit: 'Quality Time & Acts of Service', bestMatchWith: 'The Lone Wolf or The Philosopher', compatReason: 'Lone Wolves benefit from your social scaffolding while grounding you; Philosophers add the intellectual depth your busy social life sometimes lacks.', population: 7 }),
  HHHL: Object.freeze({ name: 'The Romantic', emoji: '🌹', title: 'Passionate Planner', description: 'You combine structured thinking with deep emotion. You plan grand gestures, feel everything intensely, and pour your heart into love.', strengths: ['Romantic', 'Thoughtful', 'Expressive', 'Dedicated'], growthAreas: ['Not over-idealizing partners', 'Handling unromantic realities', 'Being flexible when plans go wrong', 'Accepting imperfect love'], inRelationship: 'You plan the perfect anniversary, write love letters, and remember every detail.', communicationStyle: 'Emotionally rich and deliberate. You choose words carefully to express feelings.', conflictStyle: 'Conflicts hurt you deeply because you invest so much.', idealDates: ['Candlelit dinner you planned for weeks', 'Recreating your first date', 'Surprise scavenger hunt through meaningful locations'], loveLanguageFit: 'Gifts (elaborate) & Words of Affirmation', bestMatchWith: 'The Maverick or The Adventurous Spirit', compatReason: 'Mavericks match your boldness with refreshing directness; Adventurous Spirits share your zest for life.', population: 5 }),
  HHHH: Object.freeze({ name: 'The Champion', emoji: '🏆', title: 'All-Around Dynamo', description: 'High on every dimension — outgoing, organized, emotionally rich, deeply connected, and always seeking the next adventure.', strengths: ['Versatile', 'Emotionally intelligent', 'Social', 'Ambitious'], growthAreas: ['Slowing down', 'Not burning out', 'Accepting that you cannot be everything to everyone', 'Finding peace in stillness'], inRelationship: 'You bring energy, structure, emotion, connection, and adventure. The risk is you expect the same level of "everything" from your partner.', communicationStyle: 'Comprehensive and dynamic. You switch between logical analysis, emotional sharing, and social coordination effortlessly.', conflictStyle: 'You tackle every angle — facts, feelings, outside opinions, future impact.', idealDates: ['Elaborate surprise date with multiple planned stops', 'Weekend festival with friends', 'International trip planned together from scratch'], loveLanguageFit: 'All five — you give and receive love in every way', bestMatchWith: 'The Philosopher or The Lone Wolf', compatReason: 'Philosophers and Lone Wolves offer the calm depth and quiet independence that complements your full-throttle approach.', population: 4 }),
});

/* ═══════════════ COMPATIBILITY MATRIX ═══════════════ */

const COMPAT_MATRIX: Record<string, Record<string, number>> = {
  LLLL: { HLHL: 92, LHHH: 88, HLLH: 82, LHLH: 78, HLHH: 75, HHHL: 72, HHLH: 70, LHLL: 68, LLHH: 65, HHLL: 62, LHHL: 60, LLHL: 58, HLLL: 55, LLLH: 52, HHHH: 50, LLLL: 45 },
  LLLH: { HLLH: 90, LHHH: 88, HLHL: 82, LHLH: 80, HLHH: 75, HHLH: 72, LLHL: 68, LHHL: 65, HHHL: 62, LLHH: 60, LHLL: 58, HLLL: 55, HHLL: 52, HHHH: 50, LLLL: 48, LLLH: 42 },
  LLHL: { LHLH: 90, HLLH: 85, HLHL: 80, LHHH: 78, HLHH: 72, LHHL: 70, HHHL: 68, HHLH: 65, HHLL: 62, LLHH: 60, LHLL: 55, LLLL: 52, HLLL: 50, LLLH: 48, HHHH: 45, LLHL: 40 },
  LLHH: { LHLH: 92, HHLL: 88, LHLL: 82, HLLL: 78, LHHH: 75, HLLH: 72, LHHL: 70, HLHH: 68, HHHL: 65, HHLH: 62, LLHL: 58, HLHL: 55, LLLL: 52, LLLH: 50, HHHH: 48, LLHH: 42 },
  LHLL: { LLHH: 88, LHHH: 85, HLHL: 82, HLLH: 78, HLHH: 75, LLHL: 72, HHHL: 68, LHLH: 65, LHHL: 62, HHLH: 60, HHLL: 58, HLLL: 55, LLLL: 52, LLLH: 50, HHHH: 48, LHLL: 42 },
  LHLH: { LLHL: 92, HLHL: 88, LLHH: 85, HLLH: 80, HLHH: 78, LHHL: 75, HLLL: 72, LHHH: 70, HHHL: 65, HHLH: 62, LHLL: 60, HHLL: 58, LLLL: 55, LLLH: 52, HHHH: 50, LHLH: 42 },
  LHHL: { HLHL: 88, HLLH: 85, HLHH: 82, LHLH: 78, LLHL: 75, HHHL: 72, LHHH: 70, LLHH: 68, HLLL: 65, HHLH: 62, LHLL: 58, HHLL: 55, LLLL: 52, LLLH: 50, HHHH: 48, LHHL: 42 },
  LHHH: { LLLL: 88, LLLH: 88, HLLL: 82, LHLL: 80, HLHL: 78, LHLH: 75, LLHL: 72, HLLH: 70, LHHL: 68, HHLL: 65, HLHH: 62, HHHL: 58, HHLH: 55, LLHH: 52, HHHH: 50, LHHH: 42 },
  HLLL: { LHHL: 85, LHLH: 82, LHHH: 80, HHHL: 78, HLLH: 75, HLHH: 72, LLHL: 70, LLHH: 68, HHLH: 65, LHLL: 62, HHLL: 58, LLLL: 55, LLLH: 52, HLHL: 50, HHHH: 48, HLLL: 42 },
  HLLH: { LLLL: 85, LLLH: 90, LLHL: 85, LHHL: 82, LHLH: 80, HLHL: 78, LHHH: 75, HLHH: 72, LLHH: 70, HHHL: 65, LHLL: 62, HHLH: 58, HHLL: 55, HLLL: 52, HHHH: 50, HLLH: 42 },
  HLHL: { LHLL: 90, LHLH: 88, LLLL: 85, LHHL: 82, LLLH: 80, LLHL: 78, HLLH: 75, LHHH: 72, HHLL: 68, HLHH: 65, HHLH: 62, LLHH: 58, HHHL: 55, HLLL: 52, HHHH: 50, HLHL: 42 },
  HLHH: { LHLL: 88, LHHL: 85, LLLL: 82, LHLH: 80, HLHL: 78, LLLH: 75, HLLH: 72, LLHL: 70, HHLL: 68, LHHH: 65, HHHL: 62, LLHH: 58, HHLH: 55, HLLL: 52, HHHH: 50, HLHH: 42 },
  HHLL: { LLHH: 90, LLHL: 85, LLLH: 80, HLHL: 78, LHHL: 75, LHLH: 72, HLLH: 70, LHHH: 68, HLHH: 65, HHHL: 62, LHLL: 58, HLLL: 55, HHLH: 52, LLLL: 50, HHHH: 48, HHLL: 42 },
  HHLH: { LLLL: 85, LLLH: 82, HLLL: 78, LHLL: 75, LHLH: 72, LLHL: 70, LHHL: 68, HLLH: 65, HLHL: 62, LHHH: 60, LLHH: 58, HLHH: 55, HHLL: 52, HHHL: 50, HHHH: 48, HHLH: 42 },
  HHHL: { HLLL: 88, HLHL: 85, LHLH: 80, HLLH: 78, LHHL: 75, HLHH: 72, LLHL: 70, LHHH: 68, LLHH: 65, LHLL: 62, HHLL: 58, HHLH: 55, LLLH: 52, LLLL: 50, HHHH: 48, HHHL: 42 },
  HHHH: { LLLL: 88, LLLH: 85, LHLL: 80, LLHL: 78, HLLH: 75, LHLH: 72, LHHL: 70, HLLL: 68, LHHH: 65, LLHH: 62, HLHL: 58, HHLL: 55, HLHH: 52, HHLH: 50, HHHL: 48, HHHH: 42 },
};

/* ═══════════════ SCORING ═══════════════ */

function computeConsistency(scores: number[]): number {
  if (scores.length < 2) return 100;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / scores.length;
  return Math.round(Math.max(0, 100 - (Math.sqrt(variance) / 50) * 100));
}

function generateSummary(traits: TraitScore[], archetype: Archetype, adventureScore: number): string {
  const e = traits.find((t) => t.key === 'energy')!;
  const p = traits.find((t) => t.key === 'planning')!;
  const em = traits.find((t) => t.key === 'emotion')!;
  const s = traits.find((t) => t.key === 'social')!;
  const energy = e.score > 60 ? 'draw energy from being around others' : e.score < 40 ? 'recharge in solitude and quiet' : 'balance social time with alone time';
  const planning = p.score > 60 ? 'prefer structure and clear plans' : p.score < 40 ? 'thrive on spontaneity and flexibility' : 'adapt between planning and improvising';
  const emotion = em.score > 60 ? 'lead with your heart and feelings' : em.score < 40 ? 'make decisions with logic and analysis' : 'balance logic and emotion in your choices';
  const social = s.score > 60 ? 'build deep, wide social connections' : s.score < 40 ? 'value your independence and personal space' : 'balance closeness with personal boundaries';
  const adventure = adventureScore > 60 ? 'You are always chasing the next experience.' : adventureScore < 40 ? 'You find comfort and meaning in familiar routines.' : 'You enjoy new experiences but also value your comfort zone.';
  return `You ${energy} and ${planning}. When faced with decisions, you ${emotion}. In relationships, you ${social}. ${adventure} As ${archetype.name}, your greatest gifts are ${archetype.strengths.slice(0, 2).join(' and ').toLowerCase()}.`;
}

function computeResults(answers: ReadonlyMap<number, number>, totalTimeMs: number, questionTimesMs: readonly number[]): QuizResults {
  const traitScoresMap = new Map<TraitKey, { scores: number[]; weights: number[] }>();
  for (const trait of TRAITS) traitScoresMap.set(trait.key, { scores: [], weights: [] });
  for (const q of QUESTIONS) {
    const score = answers.get(q.id);
    if (score !== undefined) { const entry = traitScoresMap.get(q.trait)!; entry.scores.push(score); entry.weights.push(q.weight); }
  }
  const traits: TraitScore[] = TRAITS.map((trait) => {
    const { scores, weights } = traitScoresMap.get(trait.key)!;
    let avg = SCORE_NEUTRAL;
    if (scores.length > 0) { const ws = scores.reduce((sum, s, i) => sum + s * weights[i], 0); avg = Math.round(ws / weights.reduce((a, b) => a + b, 0)); }
    const consistency = computeConsistency(scores);
    let label: string;
    if (avg <= THRESH_STRONG_LOW) label = trait.lowLabel;
    else if (avg <= THRESH_LEAN_LOW) label = `Leaning ${trait.lowLabel}`;
    else if (avg <= THRESH_LEAN_HIGH) label = 'Balanced';
    else if (avg <= THRESH_STRONG_HIGH) label = `Leaning ${trait.highLabel}`;
    else label = trait.highLabel;
    return { key: trait.key, score: avg, label, consistency };
  });
  const code = traits.slice(0, ARCHETYPE_CODE_TRAITS).map((t) => (t.score > SCORE_NEUTRAL ? 'H' : 'L')).join('');
  const archetype = ARCHETYPES[code] ?? DEFAULT_ARCHETYPE;
  const adventureScore = traits.find((t) => t.key === 'adventure')?.score ?? SCORE_NEUTRAL;
  const overallConsistency = Math.round(traits.reduce((sum, t) => sum + t.consistency, 0) / traits.length);
  return { archetype, archetypeCode: code, traits, adventureScore, overallConsistency, summary: generateSummary(traits, archetype, adventureScore), quizVersion: QUIZ_VERSION, completedAt: new Date().toISOString(), totalTimeMs, questionTimesMs: [...questionTimesMs] };
}

/* ═══════════════ STATE REDUCER ═══════════════ */

type AnswerAction = { type: 'SET'; questionId: number; score: number } | { type: 'LOAD'; answers: Record<number, number> } | { type: 'RESET' };

function answersReducer(state: Map<number, number>, action: AnswerAction): Map<number, number> {
  switch (action.type) {
    case 'SET': { const n = new Map(state); n.set(action.questionId, action.score); return n; }
    case 'LOAD': return new Map(Object.entries(action.answers).map(([k, v]) => [Number(k), v]));
    case 'RESET': return new Map();
    default: return state;
  }
}

/* ═══════════════ ANALYTICS ═══════════════ */

function trackEvent(event: string, timeMs?: number): void {
  try {
    const raw = appStorage.getString(ANALYTICS_KEY);
    const data = raw ? JSON.parse(raw) : { started: 0, completed: 0, skipped: 0, abandoned: 0, avgTimeMs: 0 };
    if (event === 'start') data.started++;
    else if (event === 'complete') { data.completed++; if (timeMs) data.avgTimeMs = Math.round((data.avgTimeMs * (data.completed - 1) + timeMs) / data.completed); }
    else if (event === 'skip') data.skipped++;
    else data.abandoned++;
    appStorage.set(ANALYTICS_KEY, JSON.stringify(data));
  } catch {}
}

/* ═══════════════ ERROR BOUNDARY ═══════════════ */

class QuizErrorBoundary extends React.Component<{ children: React.ReactNode; onReset: () => void }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={st.centered}>
          <Text style={{ fontSize: 50, marginBottom: 16 }}>😵</Text>
          <Text style={st.errTitle}>Something went wrong</Text>
          <Text style={st.errMsg}>{this.state.error?.message ?? 'Unknown error'}</Text>
          <TouchableOpacity style={st.errBtn} onPress={() => { this.setState({ hasError: false, error: null }); this.props.onReset(); }}>
            <Text style={st.errBtnText}>Try Again</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

/* ═══════════════ SUB-COMPONENTS ═══════════════ */

const TraitBar = React.memo(function TraitBar({ trait, def, index }: { trait: TraitScore; def: TraitDef; index: number }) {
  const w = useRef(new Animated.Value(0)).current;
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(index * BAR_DELAY_MS),
      Animated.parallel([
        Animated.timing(w, { toValue: trait.score, duration: BAR_ANIM_MS, useNativeDriver: false }),
        Animated.timing(o, { toValue: 1, duration: BAR_ANIM_MS / 2, useNativeDriver: true }),
      ]),
    ]).start();
  }, [trait.score, index, w, o]);
  return (
    <Animated.View style={[st.trRow, { opacity: o }]} accessible accessibilityLabel={`${def.name}: ${trait.label}, ${trait.score}%`}>
      <View style={st.trLabels}>
        <Text style={st.trLow}>{def.lowEmoji} {def.lowLabel}</Text>
        <Text style={st.trHigh}>{def.highLabel} {def.highEmoji}</Text>
      </View>
      <View style={st.trBarBg}>
        <Animated.View style={[st.trBarFill, { width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), backgroundColor: def.color }]} />
        <Animated.View style={[st.trDot, { left: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), backgroundColor: def.color }]} />
      </View>
      <View style={st.trBottom}>
        <Text style={[st.trLabel, { color: def.color }]}>{trait.label} ({trait.score}%)</Text>
        <Text style={st.trConsist}>{trait.consistency >= 80 ? '🎯' : trait.consistency >= 60 ? '🔄' : '🤷'} {trait.consistency}%</Text>
      </View>
    </Animated.View>
  );
});

/* Simple non-memoized answer button — no stale closure issues */
function AnswerButton({ option, question, traitColor, isSelected, onPress, disabled }: {
  option: AnswerOption; question: QuizQuestion; traitColor: string;
  isSelected: boolean; onPress: () => void; disabled: boolean;
}) {
  const isMiddle = option.side === 'neutral';
  const label = isMiddle ? 'It Depends' : option.side === 'A' ? (option.id === 0 ? 'Strongly' : 'Somewhat') : (option.id === 4 ? 'Strongly' : 'Somewhat');
  return (
    <TouchableOpacity
      style={[st.optBtn, isSelected && st.optBtnSel, isMiddle && st.optBtnMid, isSelected && { borderColor: traitColor }]}
      onPress={onPress} activeOpacity={0.7} disabled={disabled}
    >
      <Text style={st.optEmoji}>{option.emoji}</Text>
      <Text style={[st.optLabel, isSelected && st.optLabelSel, isMiddle && st.optLabelMid]} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

function ProgressDots({ total, current, answers }: { total: number; current: number; answers: ReadonlyMap<number, number> }) {
  return (
    <View style={st.dotsRow}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[st.dot, answers.has(QUESTIONS[i]?.id ?? 0) && st.dotDone, i === current && st.dotCur]} />
      ))}
    </View>
  );
}

function InsightScreen({ card, onContinue }: { card: InsightCard; onContinue: () => void }) {
  return (
    <View style={st.insightWrap}>
      <Text style={st.insightEmoji}>{card.emoji}</Text>
      <Text style={st.insightTitle}>{card.title}</Text>
      <Text style={st.insightBody}>{card.body}</Text>
      <TouchableOpacity style={st.insightBtn} onPress={onContinue} activeOpacity={0.8}>
        <Text style={st.insightBtnText}>Continue →</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════
 * MAIN COMPONENT
 *
 * FIX: The old code used animRef.current (a ref) in the disabled
 * prop of buttons. Refs don't cause re-renders, so once set to true
 * the buttons stayed permanently disabled until an unrelated state
 * change triggered a re-render.
 *
 * NEW APPROACH: No animation lock at all. We use a simple
 * `waitingForNext` state boolean that is:
 *   - set to true when user taps an answer
 *   - set to false AFTER the question index changes
 * This is 100% state-driven so React always re-renders correctly.
 * The fade animation is fire-and-forget — it cannot block interaction.
 * ═══════════════════════════════════════════════════════════ */

function PersonalityQuizInner() {
  const router = useRouter();
  const { t } = useLanguage();

  // Core state
  const [qIndex, setQIndex] = useState(0);
  const [answers, dispatch] = useReducer(answersReducer, new Map());
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<QuizResults | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [showInsight, setShowInsight] = useState<InsightCard | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [existingType, setExistingType] = useState<string | null>(null);

  // This is the ONLY interaction lock. It's state-based so it always re-renders.
  const [waitingForNext, setWaitingForNext] = useState(false);

  // Fade is purely cosmetic — never blocks interaction
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const startTime = useRef(Date.now());
  const qStartTime = useRef(Date.now());
  const qTimesRef = useRef<number[]>([]);

  const question = useMemo(() => QUESTIONS[qIndex] ?? QUESTIONS[0], [qIndex]);
  const progress = ((qIndex + 1) / TOTAL_QUESTIONS) * 100;
  const currentAnswer = answers.get(question.id);
  const canGoBack = qIndex > 0;
  const trait = TRAIT_MAP[question.trait] ?? TRAITS[0];

  // Buttons are disabled ONLY during the brief post-answer delay
  const buttonsDisabled = submitting || waitingForNext;

  // When qIndex changes, unlock buttons
  useEffect(() => {
    setWaitingForNext(false);
    qStartTime.current = Date.now();
    // Fire-and-forget fade in
    fadeAnim.setValue(0.3);
    Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [qIndex, fadeAnim]);

  // Also unlock when insight screen appears/disappears
  useEffect(() => {
    setWaitingForNext(false);
  }, [showInsight]);

  // Also unlock when results appear
  useEffect(() => {
    if (showResults) setWaitingForNext(false);
  }, [showResults]);

  /* ── Lifecycle ── */
  useEffect(() => {
    mountedRef.current = true;
    startTime.current = Date.now();
    trackEvent('start');
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (snap.exists() && snap.data()?.personalityType) setExistingType(snap.data()!.personalityType);
    }).catch(() => {});
  }, []);

  /* ── Draft ── */
  useEffect(() => {
    try {
      const raw = appStorage.getString(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d?.version === QUIZ_VERSION && d?.answers) {
          dispatch({ type: 'LOAD', answers: d.answers });
          setQIndex(d.qIndex ?? 0);
          qTimesRef.current = d.qTimes ?? [];
          if (d.elapsed) startTime.current = Date.now() - d.elapsed;
        }
      }
    } catch {} finally { setDraftLoaded(true); }
  }, []);

  useEffect(() => {
    if (!draftLoaded || showResults) return;
    const tm = setTimeout(() => {
      try {
        const obj: Record<number, number> = {};
        answers.forEach((v, k) => { obj[k] = v; });
        appStorage.set(DRAFT_KEY, JSON.stringify({ version: QUIZ_VERSION, answers: obj, qIndex, qTimes: qTimesRef.current, elapsed: Date.now() - startTime.current }));
      } catch {}
    }, 1000);
    return () => clearTimeout(tm);
  }, [answers, qIndex, draftLoaded, showResults]);

  /* ── Haptics ── */
  const haptic = useCallback(() => {
    if (!IS_WEB) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);
  const successHaptic = useCallback(() => {
    if (!IS_WEB) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  /* ── Answer handler ── */
  const handleAnswer = useCallback((score: number) => {
    if (submitting || waitingForNext) return;

    haptic();
    setWaitingForNext(true); // Lock buttons immediately via state

    qTimesRef.current[qIndex] = Date.now() - qStartTime.current;
    dispatch({ type: 'SET', questionId: question.id, score });

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;

      if (qIndex < TOTAL_QUESTIONS - 1) {
        const nextQ = qIndex + 1;
        const insightIdx = Math.floor(nextQ / INSIGHT_INTERVAL) - 1;
        if (nextQ % INSIGHT_INTERVAL === 0 && insightIdx >= 0 && insightIdx < INSIGHTS.length) {
          setShowInsight(INSIGHTS[insightIdx]);
        } else {
          setQIndex(nextQ); // This triggers the useEffect that unlocks buttons
        }
      } else {
        // Last question — compute results
        const totalMs = Date.now() - startTime.current;
        const finalAnswers = new Map(answers);
        finalAnswers.set(question.id, score);
        const res = computeResults(finalAnswers, totalMs, qTimesRef.current);
        setResults(res);
        successHaptic();
        setShowResults(true);
        try { appStorage.delete(DRAFT_KEY); } catch {}
        trackEvent('complete', totalMs);
      }
      timerRef.current = null;
    }, ANSWER_DELAY_MS);
  }, [answers, question, qIndex, submitting, waitingForNext, haptic, successHaptic]);

  const handleInsightContinue = useCallback(() => {
    setShowInsight(null);
    setQIndex((i) => i + 1);
  }, []);

  const handleBack = useCallback(() => {
    if (!canGoBack || submitting || waitingForNext) return;
    haptic();
    setQIndex((i) => i - 1);
  }, [canGoBack, submitting, waitingForNext, haptic]);

  const handleSkip = useCallback(() => {
    Alert.alert('Skip Quiz?', 'Your personality type helps find better matches. You can take it later from Settings.', [
      { text: 'Take Quiz', style: 'cancel' },
      { text: 'Skip', onPress: () => { trackEvent('skip'); try { appStorage.delete(DRAFT_KEY); } catch {} router.replace('/home'); } },
    ]);
  }, [router]);

  const handleClose = useCallback(() => {
    if (answers.size === 0) { router.back(); return; }
    Alert.alert('Leave Quiz?', 'Your progress is auto-saved.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', onPress: () => { trackEvent('abandon'); router.back(); } },
    ]);
  }, [answers.size, router]);

  /* ── Keyboard (web) ── */
  useEffect(() => {
    if (!IS_WEB || showResults || showInsight) return;
    const h = (e: KeyboardEvent) => {
      if (submitting || waitingForNext) return;
      if (e.key >= '1' && e.key <= '5') handleAnswer(ANSWER_OPTIONS[parseInt(e.key) - 1].score);
      else if (e.key === 'ArrowLeft' || e.key === 'Backspace') handleBack();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [showResults, showInsight, submitting, waitingForNext, handleAnswer, handleBack]);

  /* ── Share ── */
  const handleShare = useCallback(async () => {
    if (!results) return;
    const msg = `🎭 My Personality: ${results.archetype.emoji} ${results.archetype.name}\n\n"${results.archetype.description}"\n\n💪 Strengths: ${results.archetype.strengths.join(', ')}\n🚀 Adventure: ${results.adventureScore}%\n🎯 Consistency: ${results.overallConsistency}%\n\nDiscover yours at myarchetype.app!`;
    try {
      if (IS_WEB && navigator.clipboard) { await navigator.clipboard.writeText(msg); Alert.alert('Copied!', 'Share text copied.'); }
      else await Share.share({ message: msg, title: 'My Personality Type' });
    } catch { Alert.alert('Error', 'Could not share.'); }
  }, [results]);

  /* ── Save ── */
  const saveResults = useCallback(async () => {
    if (!results) return;
    const user = auth.currentUser;
    if (!user) { Alert.alert(t.error || 'Error', 'Not logged in.'); return; }
    setSubmitting(true);
    try {
      await user.reload();
      const traitMap: Record<string, number> = {};
      const labelMap: Record<string, string> = {};
      const consistMap: Record<string, number> = {};
      for (const tr of results.traits) { traitMap[tr.key] = tr.score; labelMap[tr.key] = tr.label; consistMap[tr.key] = tr.consistency; }
      await updateDoc(doc(db, 'users', user.uid), {
        personalityType: results.archetype.name, personalityEmoji: results.archetype.emoji,
        personalityTitle: results.archetype.title, personalityDescription: results.archetype.description,
        personalityArchetypeCode: results.archetypeCode, personalityTraits: traitMap,
        personalityTraitLabels: labelMap, personalityTraitConsistency: consistMap,
        personalityStrengths: results.archetype.strengths, personalityGrowthAreas: results.archetype.growthAreas,
        personalityInRelationship: results.archetype.inRelationship, personalityCommunicationStyle: results.archetype.communicationStyle,
        personalityConflictStyle: results.archetype.conflictStyle, personalityIdealDates: results.archetype.idealDates,
        personalityLoveLanguageFit: results.archetype.loveLanguageFit, personalityBestMatch: results.archetype.bestMatchWith,
        personalityCompatReason: results.archetype.compatReason, personalityAdventureScore: results.adventureScore,
        personalityConsistency: results.overallConsistency, personalitySummary: results.summary,
        personalityPopulation: results.archetype.population, personalityCompleted: true,
        personalityCompletedAt: results.completedAt, personalityQuizVersion: results.quizVersion,
        personalityQuizTimeMs: results.totalTimeMs,
      });
      try { appStorage.delete(DRAFT_KEY); } catch {}
      successHaptic();
      router.replace('/home');
    } catch (error: any) {
      if (!mountedRef.current) return;
      if (error?.code === 'auth/user-not-found' || error?.code === 'auth/user-token-expired') { Alert.alert('Session Expired', 'Please log in again.'); router.replace('/login'); return; }
      if (error?.code === 'permission-denied') { Alert.alert(t.error || 'Error', 'Permission denied.'); return; }
      try { appStorage.set(PENDING_SAVE_KEY, JSON.stringify({ results, at: new Date().toISOString() })); } catch {}
      Alert.alert('Save Error', error instanceof Error ? error.message : 'Unknown error', [
        { text: 'Retry', onPress: saveResults },
        { text: 'Continue Offline', style: 'cancel', onPress: () => router.replace('/home') },
      ]);
    } finally { if (mountedRef.current) setSubmitting(false); }
  }, [results, router, successHaptic, t]);

  const retakeQuiz = useCallback(() => {
    Alert.alert('Retake Quiz?', 'This will reset all your answers.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Retake', style: 'destructive', onPress: () => {
        dispatch({ type: 'RESET' }); setResults(null); setShowResults(false);
        setShowInsight(null); setWaitingForNext(false);
        fadeAnim.setValue(1); startTime.current = Date.now();
        qTimesRef.current = []; qStartTime.current = Date.now();
        setQIndex(0);
        try { appStorage.delete(DRAFT_KEY); } catch {}
      }},
    ]);
  }, [fadeAnim]);

  /* ── Loading ── */
  if (!draftLoaded || submitting) {
    return (
      <SafeAreaView style={st.centered}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={st.loadText}>{submitting ? 'Saving your profile…' : 'Loading…'}</Text>
      </SafeAreaView>
    );
  }

  /* ── Results ── */
  if (showResults && results) {
    const { archetype, traits: rTraits, adventureScore } = results;
    const mins = Math.max(1, Math.round(results.totalTimeMs / 60000));
    return (
      <SafeAreaView style={st.root}>
        <ScrollView contentContainerStyle={st.resScroll} showsVerticalScrollIndicator={false}>
          <View style={st.resHeader}>
            <Text style={st.resEmoji}>{archetype.emoji}</Text>
            <Text style={st.resName}>{archetype.name}</Text>
            <Text style={st.resTitle}>{archetype.title}</Text>
            <Text style={st.resDesc}>{archetype.description}</Text>
            <View style={st.popBadge}><Text style={st.popText}>📊 ~{archetype.population}% of users share this type</Text></View>
          </View>
          <View style={st.secCard}><Text style={st.secTitle}>📝 Your Personality Summary</Text><Text style={st.secBody}>{results.summary}</Text></View>
          {existingType && existingType !== archetype.name && (
            <View style={st.warnCard}><Text style={st.warnText}>⚠️ Previous type: "{existingType}". Saving will update your profile.</Text></View>
          )}
          <View style={st.traitsCard}>
            <Text style={st.secTitle}>🌈 Your Personality Spectrum</Text>
            {rTraits.map((tr, i) => <TraitBar key={tr.key} trait={tr} def={TRAIT_MAP[tr.key]} index={i} />)}
            <View style={st.consistRow}><Text style={st.consistText}>🎯 Overall Consistency: {results.overallConsistency}%{results.overallConsistency >= 80 ? ' — Very decisive!' : results.overallConsistency >= 60 ? ' — Clear preferences' : ' — Complex personality!'}</Text></View>
          </View>
          <View style={st.secCard}><Text style={st.secTitle}>💪 Your Strengths</Text><View style={st.chipGrid}>{archetype.strengths.map((s2) => <View key={s2} style={st.chip}><Text style={st.chipText}>{s2}</Text></View>)}</View></View>
          <View style={st.secCard}><Text style={st.secTitle}>🌱 Growth Areas</Text>{archetype.growthAreas.map((g) => <View key={g} style={st.growthRow}><Text style={st.growthDot}>→</Text><Text style={st.secBody}>{g}</Text></View>)}</View>
          <View style={st.secCard}><Text style={st.secTitle}>💕 In a Relationship</Text><Text style={st.secBody}>{archetype.inRelationship}</Text></View>
          <View style={st.secCard}><Text style={st.secTitle}>💬 Communication Style</Text><Text style={st.secBody}>{archetype.communicationStyle}</Text></View>
          <View style={st.secCard}><Text style={st.secTitle}>⚡ Conflict Style</Text><Text style={st.secBody}>{archetype.conflictStyle}</Text></View>
          <View style={st.secCard}><Text style={st.secTitle}>🌹 Ideal Date Ideas</Text>{archetype.idealDates.map((d, i) => <View key={i} style={st.dateRow}><Text style={st.dateNum}>{i + 1}</Text><Text style={st.secBody}>{d}</Text></View>)}</View>
          <View style={st.secCard}><Text style={st.secTitle}>💝 Love Language Fit</Text><Text style={st.secBody}>{archetype.loveLanguageFit}</Text></View>
          <View style={st.secCard}>
            <Text style={st.secTitle}>{adventureScore > 60 ? '🚀' : '🏠'} Adventure Level</Text>
            <View style={st.advBar}><Text style={st.advLow}>🏠</Text><View style={st.advTrack}><View style={[st.advFill, { width: `${adventureScore}%` as any }]} /></View><Text style={st.advHigh}>🚀</Text></View>
            <Text style={st.secBody}>{adventureScore > THRESH_STRONG_HIGH ? "You're a thrill-seeker!" : adventureScore > THRESH_LEAN_HIGH ? 'You enjoy adventure but also value comfort.' : adventureScore > THRESH_LEAN_LOW ? 'You balance novelty with familiar comfort.' : 'You find deep meaning in routine and stability.'}</Text>
          </View>
          <View style={st.secCard}><Text style={st.secTitle}>🎯 Best Match With</Text><Text style={st.matchName}>{archetype.bestMatchWith}</Text><Text style={st.compatR}>{archetype.compatReason}</Text><Text style={st.matchHint}>Our algorithm uses your personality to suggest compatible partners!</Text></View>
          <View style={st.statsCard}>
            <Text style={st.statsTitle}>📊 Quiz Stats</Text>
            <View style={st.statsRow}>
              <View style={st.statItem}><Text style={st.statVal}>{TOTAL_QUESTIONS}</Text><Text style={st.statLbl}>Questions</Text></View>
              <View style={st.statItem}><Text style={st.statVal}>{mins}</Text><Text style={st.statLbl}>Minutes</Text></View>
              <View style={st.statItem}><Text style={st.statVal}>{results.overallConsistency}%</Text><Text style={st.statLbl}>Consistent</Text></View>
              <View style={st.statItem}><Text style={st.statVal}>v{QUIZ_VERSION}</Text><Text style={st.statLbl}>Version</Text></View>
            </View>
          </View>
          <TouchableOpacity style={st.shareBtn} onPress={handleShare} activeOpacity={0.8}><Text style={st.shareBtnText}>📤 Share My Type</Text></TouchableOpacity>
          <TouchableOpacity style={st.saveBtn} onPress={saveResults} activeOpacity={0.8}><Text style={st.saveBtnText}>✓ Save & Continue</Text></TouchableOpacity>
          <TouchableOpacity style={st.retakeBtn} onPress={retakeQuiz} activeOpacity={0.7}><Text style={st.retakeBtnText}>🔄 Retake Quiz</Text></TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ── Insight card ── */
  if (showInsight) {
    return (
      <SafeAreaView style={st.root}>
        <View style={st.content}>
          <InsightScreen card={showInsight} onContinue={handleInsightContinue} />
        </View>
      </SafeAreaView>
    );
  }

  /* ── Quiz ── */
  return (
    <SafeAreaView style={st.root}>
      <View style={st.header}>
        <View style={st.headerL}>
          <TouchableOpacity onPress={handleClose} hitSlop={HIT}><Text style={st.closeText}>✕</Text></TouchableOpacity>
          {canGoBack && <TouchableOpacity onPress={handleBack} hitSlop={HIT}><Text style={st.backText}>← Back</Text></TouchableOpacity>}
        </View>
        <Text style={st.counter}>{qIndex + 1} / {TOTAL_QUESTIONS}</Text>
        <View style={st.headerR} />
      </View>

      <View style={st.progBg}><View style={[st.progFill, { width: `${progress}%` as any }]} /></View>
      <ProgressDots total={TOTAL_QUESTIONS} current={qIndex} answers={answers} />

      <View style={st.badge}>
        <View style={[st.badgeDot, { backgroundColor: trait.color }]} />
        <Text style={st.badgeText}>{trait.name}</Text>
        <Text style={st.badgeDesc}>{trait.description}</Text>
      </View>

      <ScrollView style={st.scroll} contentContainerStyle={st.scrollInner} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View style={[st.content, { opacity: fadeAnim }]}>
          {question.scenario != null && <Text style={st.scenario}>{question.scenario}</Text>}
          {question.weight > 1 && <View style={st.keyQ}><Text style={st.keyQText}>⭐ Key Question</Text></View>}
          <Text style={st.question}>{question.question}</Text>

          <View style={st.sidesRow}>
            <View style={[st.side, { borderColor: trait.color }]}><Text style={st.sideEmoji}>{trait.lowEmoji}</Text><Text style={st.sideText}>{trait.lowLabel}</Text></View>
            <View style={[st.side, { borderColor: trait.color }]}><Text style={st.sideEmoji}>{trait.highEmoji}</Text><Text style={st.sideText}>{trait.highLabel}</Text></View>
          </View>

          <View style={st.optWrap}>
            <Text style={st.sideDesc}>{question.sideA}</Text>
            <View style={st.optBtns}>
              {ANSWER_OPTIONS.map((opt) => (
                <AnswerButton
                  key={`${question.id}-${opt.id}`}
                  option={opt} question={question} traitColor={trait.color}
                  isSelected={currentAnswer === opt.score}
                  onPress={() => handleAnswer(opt.score)}
                  disabled={buttonsDisabled}
                />
              ))}
            </View>
            <Text style={[st.sideDesc, st.sideDescR]}>{question.sideB}</Text>

            <View style={st.scaleRow}>
              <Text style={st.scaleLbl}>{trait.lowEmoji} {trait.lowLabel}</Text>
              <View style={st.scaleLine} />
              <Text style={st.scaleLbl}>{trait.highLabel} {trait.highEmoji}</Text>
            </View>
            {IS_WEB && <Text style={st.kbHint}>⌨️ Press 1-5 to answer, ← to go back</Text>}
          </View>
        </Animated.View>
      </ScrollView>

      <TouchableOpacity style={st.skipBtn} onPress={handleSkip} hitSlop={HIT}><Text style={st.skipText}>Skip for now</Text></TouchableOpacity>
    </SafeAreaView>
  );
}

/* ═══════════════ EXPORT ═══════════════ */

export default function PersonalityQuizScreen() {
  const [key, setKey] = useState(0);
  return (
    <QuizErrorBoundary onReset={() => setKey((k) => k + 1)}>
      <PersonalityQuizInner key={key} />
    </QuizErrorBoundary>
  );
}

/* ═══════════════ STYLES ═══════════════ */

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20 },
  centered: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  loadText: { color: C.accent, fontSize: 18, textAlign: 'center' },
  errTitle: { color: C.text, fontSize: 22, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  errMsg: { color: C.sub, fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  errBtn: { backgroundColor: C.accent, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 25 },
  errBtnText: { color: C.white, fontSize: 16, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  headerL: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerR: { flex: 1 },
  closeText: { color: C.dim, fontSize: 20, fontWeight: '600' },
  backText: { color: C.accent, fontSize: 16 },
  counter: { color: C.sub, fontSize: 14, textAlign: 'center' },
  progBg: { height: 6, backgroundColor: C.card, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progFill: { height: '100%', backgroundColor: C.accent, borderRadius: 3 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 3, marginBottom: 10, flexWrap: 'wrap', paddingHorizontal: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.card },
  dotDone: { backgroundColor: C.success },
  dotCur: { backgroundColor: C.accent, transform: [{ scale: 1.5 }] },
  badge: { alignItems: 'center', backgroundColor: C.card, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, gap: 3, marginBottom: 10 },
  badgeDot: { width: 10, height: 10, borderRadius: 5 },
  badgeText: { color: C.text, fontSize: 14, fontWeight: '600' },
  badgeDesc: { color: C.muted, fontSize: 11, textAlign: 'center', lineHeight: 15 },
  scroll: { flex: 1 },
  scrollInner: { flexGrow: 1, justifyContent: 'center', paddingBottom: 20 },
  content: { justifyContent: 'center', flex: 1 },
  scenario: { color: C.muted, fontSize: 13, textAlign: 'center', marginBottom: 6, fontStyle: 'italic' },
  keyQ: { alignSelf: 'center', backgroundColor: 'rgba(241,196,15,0.15)', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12, marginBottom: 8 },
  keyQText: { color: C.gold, fontSize: 11, fontWeight: '600' },
  question: { fontSize: 19, fontWeight: 'bold', color: C.text, textAlign: 'center', marginBottom: 18, lineHeight: 28 },
  sidesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.card, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1 },
  sideEmoji: { fontSize: 15 },
  sideText: { color: C.sub, fontSize: 11, fontWeight: '600' },
  optWrap: { gap: 6 },
  sideDesc: { color: C.sub, fontSize: 13, textAlign: 'left', lineHeight: 18, paddingHorizontal: 4 },
  sideDescR: { textAlign: 'right' },
  optBtns: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, marginVertical: 6 },
  optBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, paddingVertical: 10, paddingHorizontal: 3, borderRadius: 12, borderWidth: 2, borderColor: C.none, minHeight: SCREEN_W < 375 ? 56 : 66 },
  optBtnSel: { backgroundColor: C.cardHi },
  optBtnMid: { backgroundColor: 'rgba(83,168,182,0.08)', borderColor: C.input },
  optEmoji: { fontSize: 16, marginBottom: 2 },
  optLabel: { color: C.muted, fontSize: 10, textAlign: 'center' },
  optLabelSel: { color: C.text, fontWeight: 'bold' },
  optLabelMid: { color: C.accent },
  scaleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, gap: 8 },
  scaleLbl: { color: C.dim, fontSize: 10 },
  scaleLine: { flex: 1, height: 1, backgroundColor: C.input },
  kbHint: { color: C.dim, fontSize: 11, textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  skipBtn: { alignSelf: 'center', paddingVertical: 12 },
  skipText: { color: C.dim, fontSize: 14 },
  insightWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  insightEmoji: { fontSize: 60, marginBottom: 16 },
  insightTitle: { fontSize: 22, fontWeight: 'bold', color: C.text, marginBottom: 10, textAlign: 'center' },
  insightBody: { fontSize: 16, color: C.sub, textAlign: 'center', lineHeight: 24, marginBottom: 30, paddingHorizontal: 10 },
  insightBtn: { backgroundColor: C.accent, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25 },
  insightBtnText: { color: C.white, fontSize: 16, fontWeight: '600' },
  resScroll: { padding: 20, paddingBottom: 40 },
  resHeader: { alignItems: 'center', marginBottom: 20, marginTop: 12 },
  resEmoji: { fontSize: 70, marginBottom: 10 },
  resName: { fontSize: 26, fontWeight: 'bold', color: C.text, marginBottom: 4 },
  resTitle: { fontSize: 17, color: C.accent, fontWeight: '600', marginBottom: 10 },
  resDesc: { fontSize: 14, color: C.sub, textAlign: 'center', lineHeight: 21, marginBottom: 10 },
  popBadge: { backgroundColor: C.card, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 20 },
  popText: { color: C.muted, fontSize: 12 },
  warnCard: { backgroundColor: 'rgba(230,126,34,0.15)', borderWidth: 1, borderColor: C.warning, borderRadius: 12, padding: 12, marginBottom: 14 },
  warnText: { color: C.warning, fontSize: 13, lineHeight: 19 },
  secCard: { backgroundColor: C.card, borderRadius: 16, padding: 18, marginBottom: 14 },
  secTitle: { fontSize: 17, fontWeight: 'bold', color: C.text, marginBottom: 10 },
  secBody: { fontSize: 14, color: C.sub, lineHeight: 21, flex: 1 },
  traitsCard: { backgroundColor: C.card, borderRadius: 16, padding: 18, marginBottom: 14 },
  trRow: { marginBottom: 18 },
  trLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  trLow: { color: C.sub, fontSize: 11 },
  trHigh: { color: C.sub, fontSize: 11 },
  trBarBg: { height: 12, backgroundColor: C.input, borderRadius: 6, overflow: 'visible', position: 'relative' },
  trBarFill: { height: '100%', borderRadius: 6 },
  trDot: { position: 'absolute', top: -4, width: 20, height: 20, borderRadius: 10, marginLeft: -10, borderWidth: 3, borderColor: C.bg },
  trBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 },
  trLabel: { fontSize: 12, fontWeight: '600' },
  trConsist: { fontSize: 10, color: C.dim },
  consistRow: { borderTopWidth: 1, borderTopColor: C.input, paddingTop: 12, marginTop: 6 },
  consistText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: C.input, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20 },
  chipText: { color: C.accent, fontSize: 13, fontWeight: '600' },
  growthRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'flex-start' },
  growthDot: { color: C.accent, fontSize: 14, fontWeight: 'bold', marginTop: 2 },
  dateRow: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  dateNum: { color: C.accent, fontSize: 14, fontWeight: 'bold', width: 20, textAlign: 'center', marginTop: 2 },
  matchName: { fontSize: 16, fontWeight: '600', color: C.accent, marginBottom: 6 },
  compatR: { fontSize: 13, color: C.muted, lineHeight: 19, fontStyle: 'italic', marginBottom: 8 },
  matchHint: { color: C.accent, fontSize: 12, fontStyle: 'italic', lineHeight: 18 },
  advBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  advLow: { color: C.muted, fontSize: 14 },
  advHigh: { color: C.muted, fontSize: 14 },
  advTrack: { flex: 1, height: 8, backgroundColor: C.input, borderRadius: 4, overflow: 'hidden' },
  advFill: { height: '100%', backgroundColor: C.warning, borderRadius: 4 },
  statsCard: { backgroundColor: C.card, borderRadius: 16, padding: 18, marginBottom: 14, alignItems: 'center' },
  statsTitle: { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 20 },
  statItem: { alignItems: 'center' },
  statVal: { fontSize: 20, fontWeight: 'bold', color: C.accent },
  statLbl: { fontSize: 10, color: C.muted, marginTop: 2 },
  shareBtn: { backgroundColor: C.purple, paddingVertical: 15, borderRadius: 25, alignItems: 'center', marginTop: 6 },
  shareBtnText: { color: C.white, fontSize: 16, fontWeight: '600' },
  saveBtn: { backgroundColor: C.success, paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: C.white, fontSize: 17, fontWeight: 'bold' },
  retakeBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  retakeBtnText: { color: C.accent, fontSize: 15 },
});