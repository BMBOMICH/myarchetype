/**
 * PersonalityQuizScreen — 5-dimension personality assessment
 *
 * Measures Energy, Planning, Emotion, Social, and Adventure traits
 * on a spectrum. 20 questions, 4 per trait, with 5 answer options
 * ranging from "Strongly A" to "Strongly B" plus "It Depends."
 *
 * Results in one of 16 named archetypes used for matching.
 */

import { useRouter } from 'expo-router';
import { doc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../firebaseConfig';

// ─── Design tokens ───────────────────────────────────────

const C = {
  bg: '#1a1a2e',
  card: '#16213e',
  input: '#0f3460',
  accent: '#53a8b6',
  success: '#5cb85c',
  danger: '#d9534f',
  warning: '#e67e22',
  purple: '#9b59b6',
  gold: '#f1c40f',
  text: '#eee',
  sub: '#aaa',
  muted: '#888',
  dim: '#666',
  white: '#fff',
  black: '#000',
  none: 'transparent',
} as const;

const HIT = { top: 12, bottom: 12, left: 12, right: 12 } as const;
const FADE_MS = 200;

// ─── Personality System ──────────────────────────────────

type TraitKey = 'energy' | 'planning' | 'emotion' | 'social' | 'adventure';

interface TraitDef {
  key: TraitKey;
  name: string;
  lowLabel: string;
  highLabel: string;
  lowEmoji: string;
  highEmoji: string;
  color: string;
  description: string;
}

const TRAITS: readonly TraitDef[] = [
  {
    key: 'energy',
    name: 'Energy',
    lowLabel: 'Introvert',
    highLabel: 'Extrovert',
    lowEmoji: '🌙',
    highEmoji: '☀️',
    color: '#9b59b6',
    description: 'How you recharge and where you draw energy from',
  },
  {
    key: 'planning',
    name: 'Planning',
    lowLabel: 'Spontaneous',
    highLabel: 'Structured',
    lowEmoji: '🌊',
    highEmoji: '📋',
    color: '#3498db',
    description: 'How you organize your life and make plans',
  },
  {
    key: 'emotion',
    name: 'Decisions',
    lowLabel: 'Head (Logic)',
    highLabel: 'Heart (Feeling)',
    lowEmoji: '🧠',
    highEmoji: '❤️',
    color: '#e74c3c',
    description: 'Whether you lead with logic or feelings',
  },
  {
    key: 'social',
    name: 'Connection',
    lowLabel: 'Independent',
    highLabel: 'People-Person',
    lowEmoji: '🏔️',
    highEmoji: '🤗',
    color: '#2ecc71',
    description: 'How you build and maintain relationships',
  },
  {
    key: 'adventure',
    name: 'Adventure',
    lowLabel: 'Comfort-Seeker',
    highLabel: 'Thrill-Seeker',
    lowEmoji: '🏠',
    highEmoji: '🚀',
    color: '#e67e22',
    description: 'How you approach new experiences and change',
  },
];

// ─── Answer options ──────────────────────────────────────

interface AnswerOption {
  label: string;
  score: number;
  emoji: string;
}

const ANSWER_OPTIONS: readonly AnswerOption[] = [
  { label: 'Strongly agree', score: 0, emoji: '💯' },
  { label: 'Somewhat agree', score: 25, emoji: '👍' },
  { label: 'It depends', score: 50, emoji: '🤷' },
  { label: 'Somewhat agree', score: 75, emoji: '👍' },
  { label: 'Strongly agree', score: 100, emoji: '💯' },
];

// ─── Questions ───────────────────────────────────────────

interface QuizQuestion {
  id: number;
  trait: TraitKey;
  question: string;
  sideA: string;
  sideB: string;
  scenario?: string;
}

const QUESTIONS: readonly QuizQuestion[] = [
  // ── Energy (Introvert ↔ Extrovert) ─────────────────
  {
    id: 1,
    trait: 'energy',
    question: 'After a long, exhausting day, you recharge by:',
    sideA: 'Being alone — quiet time, no people',
    sideB: 'Going out — energy from being around others',
    scenario: '🔋 How you recharge',
  },
  {
    id: 2,
    trait: 'energy',
    question: "It's Friday night and you have no plans. You feel:",
    sideA: 'Relieved — finally some peace and quiet',
    sideB: 'Restless — need to find something to do with people',
    scenario: '🌙 Friday night',
  },
  {
    id: 3,
    trait: 'energy',
    question: "You're at a party where you barely know anyone:",
    sideA: 'Find a quiet corner or leave early',
    sideB: "Love it — introduce yourself to everyone",
    scenario: '🎉 Social situations',
  },
  {
    id: 4,
    trait: 'energy',
    question: 'Your ideal vacation involves:',
    sideA: 'A secluded cabin, reading, peaceful nature',
    sideB: 'A group trip with activities and nightlife',
    scenario: '✈️ Travel style',
  },

  // ── Planning (Spontaneous ↔ Structured) ─────────────
  {
    id: 5,
    trait: 'planning',
    question: 'When it comes to weekend plans, you prefer:',
    sideA: "Going with the flow — see what happens",
    sideB: 'Having an itinerary so nothing is wasted',
    scenario: '📅 Making plans',
  },
  {
    id: 6,
    trait: 'planning',
    question: 'Your workspace / living space is usually:',
    sideA: 'A bit messy but I know where everything is',
    sideB: 'Organized, clean, everything has its place',
    scenario: '🏠 Your space',
  },
  {
    id: 7,
    trait: 'planning',
    question: "A friend texts 'Let's go on a road trip tomorrow!' You:",
    sideA: "Say yes immediately — figure it out on the way",
    sideB: 'Need time to plan, pack, and prepare properly',
    scenario: '🚗 Spontaneity test',
  },
  {
    id: 8,
    trait: 'planning',
    question: 'For a first date, you would:',
    sideA: "Suggest meeting up and seeing where it goes",
    sideB: 'Research restaurants, make reservations, plan the evening',
    scenario: '💑 First date approach',
  },

  // ── Emotion (Head ↔ Heart) ──────────────────────────
  {
    id: 9,
    trait: 'emotion',
    question: 'When a friend comes to you with a problem, you:',
    sideA: 'Analyze the situation and offer practical solutions',
    sideB: 'Listen, validate their feelings, offer emotional support',
    scenario: '🤝 Supporting others',
  },
  {
    id: 10,
    trait: 'emotion',
    question: 'When choosing between two job offers, you prioritize:',
    sideA: 'Salary, career growth, and logical pros/cons',
    sideB: 'How you feel about the team, culture, and gut instinct',
    scenario: '💼 Big decisions',
  },
  {
    id: 11,
    trait: 'emotion',
    question: "During a disagreement with your partner, you're more likely to:",
    sideA: 'Present facts and logical arguments',
    sideB: "Express how the situation makes you feel",
    scenario: '💬 Conflict style',
  },
  {
    id: 12,
    trait: 'emotion',
    question: 'When watching a sad movie:',
    sideA: "You appreciate the storytelling but rarely cry",
    sideB: "You feel deeply moved and aren't afraid to cry",
    scenario: '🎬 Emotional expression',
  },

  // ── Social (Independent ↔ People-Person) ────────────
  {
    id: 13,
    trait: 'social',
    question: "In a relationship, you need:",
    sideA: 'Plenty of personal space and alone time',
    sideB: 'Lots of quality time and togetherness',
    scenario: '💕 Relationship needs',
  },
  {
    id: 14,
    trait: 'social',
    question: "When you're going through a tough time, you:",
    sideA: 'Handle it privately — process alone first',
    sideB: 'Reach out to friends and family for support',
    scenario: '🧠 Coping style',
  },
  {
    id: 15,
    trait: 'social',
    question: 'Your ideal living situation would be:',
    sideA: 'Living alone or with just a partner',
    sideB: 'Living with roommates, family, or a vibrant community',
    scenario: '🏡 Living preferences',
  },
  {
    id: 16,
    trait: 'social',
    question: 'How do you feel about your partner being friends with their ex?',
    sideA: "I'd need strong boundaries — everyone needs their space",
    sideB: "If they're mature about it, the more connections the better",
    scenario: '🤔 Trust & boundaries',
  },

  // ── Adventure (Comfort ↔ Thrill) ────────────────────
  {
    id: 17,
    trait: 'adventure',
    question: "You're offered a chance to move to a new country. You:",
    sideA: 'Prefer the comfort and stability of what you know',
    sideB: "Excited! New experiences and growth await",
    scenario: '🌍 Change tolerance',
  },
  {
    id: 18,
    trait: 'adventure',
    question: 'When choosing food at a restaurant:',
    sideA: 'Stick with what you know and love',
    sideB: 'Always try something new and exotic',
    scenario: '🍽️ New experiences',
  },
  {
    id: 19,
    trait: 'adventure',
    question: 'Your bucket list is mostly:',
    sideA: 'Simple pleasures: garden, great meals, cozy evenings',
    sideB: 'Skydiving, backpacking, starting a business, wild experiences',
    scenario: '📝 Life goals',
  },
  {
    id: 20,
    trait: 'adventure',
    question: 'When it comes to trying new hobbies or activities:',
    sideA: 'I have my favorites and stick with them — depth over breadth',
    sideB: "I'm always picking up something new — variety is the spice of life",
    scenario: '🎯 Exploration',
  },
];

// ─── Archetype System ────────────────────────────────────

interface Archetype {
  name: string;
  emoji: string;
  title: string;
  description: string;
  strengths: string[];
  inRelationship: string;
  bestMatchWith: string;
}

const DEFAULT_ARCHETYPE: Archetype = {
  name: 'The Philosopher',
  emoji: '🦉',
  title: 'Deep Thinker',
  description: 'Introspective, logical, and comfortable in solitude. You see the world through a unique analytical lens.',
  strengths: ['Wise', 'Self-aware', 'Thoughtful', 'Principled'],
  inRelationship: 'You need intellectual connection and plenty of personal space.',
  bestMatchWith: 'The Adventurous Spirit or The Nurturer',
};

const ARCHETYPES: Record<string, Archetype> = {
  LLLH: {
    name: 'The Lone Wolf',
    emoji: '🐺',
    title: 'Independent Thinker',
    description: 'You value your independence and make decisions with clear logic. You prefer depth over breadth in relationships.',
    strengths: ['Self-reliant', 'Analytical', 'Calm under pressure', 'Loyal to inner circle'],
    inRelationship: 'You need a partner who respects your space and stimulates your mind.',
    bestMatchWith: 'The Social Butterfly or The Nurturer',
  },
  LLLL: DEFAULT_ARCHETYPE,
  LLHL: {
    name: 'The Sensitive Soul',
    emoji: '🦋',
    title: 'Quiet Empath',
    description: 'You feel deeply and process quietly. Your emotional intelligence is your superpower, even if you keep it private.',
    strengths: ['Empathetic', 'Creative', 'Perceptive', 'Authentic'],
    inRelationship: 'You need emotional safety and a partner who understands your need for solitude.',
    bestMatchWith: 'The Protector or The Social Butterfly',
  },
  LLHH: {
    name: 'The Dreamer',
    emoji: '🌙',
    title: 'Imaginative Free Spirit',
    description: 'Creative, emotionally rich, and driven by feelings. You follow your heart and inspire others with your vision.',
    strengths: ['Imaginative', 'Passionate', 'Compassionate', 'Inspiring'],
    inRelationship: 'You need a partner who supports your dreams and connects emotionally.',
    bestMatchWith: 'The Protector or The Commander',
  },
  LHLL: {
    name: 'The Architect',
    emoji: '🏗️',
    title: 'Strategic Planner',
    description: 'Methodical, independent, and logical. You build your life with precision and purpose.',
    strengths: ['Strategic', 'Reliable', 'Efficient', 'Detail-oriented'],
    inRelationship: 'You need a partner who values structure but brings warmth.',
    bestMatchWith: 'The Dreamer or The Nurturer',
  },
  LHLH: {
    name: 'The Protector',
    emoji: '🛡️',
    title: 'Loyal Guardian',
    description: 'Structured, caring, and deeply loyal. You protect those you love with quiet strength.',
    strengths: ['Dependable', 'Nurturing', 'Organized', 'Protective'],
    inRelationship: 'You create stability and safety for your partner.',
    bestMatchWith: 'The Sensitive Soul or The Adventurous Spirit',
  },
  LHHL: {
    name: 'The Sage',
    emoji: '📚',
    title: 'Wise Counselor',
    description: 'You combine emotional depth with structured thinking. People come to you for wisdom and guidance.',
    strengths: ['Wise', 'Emotionally intelligent', 'Patient', 'Thoughtful'],
    inRelationship: 'You bring emotional maturity and stability.',
    bestMatchWith: 'The Adventurous Spirit or The Social Butterfly',
  },
  LHHH: {
    name: 'The Nurturer',
    emoji: '🌷',
    title: 'Caring Organizer',
    description: 'You combine warmth with structure. You care deeply and show it through thoughtful actions.',
    strengths: ['Caring', 'Organized', 'Emotionally available', 'Supportive'],
    inRelationship: 'You create a loving, well-organized partnership.',
    bestMatchWith: 'The Lone Wolf or The Philosopher',
  },
  HLLL: {
    name: 'The Maverick',
    emoji: '⚡',
    title: 'Bold Individualist',
    description: 'Outgoing and logical, you march to your own beat. You light up any room while staying true to yourself.',
    strengths: ['Charismatic', 'Independent-minded', 'Bold', 'Direct'],
    inRelationship: 'You need a partner who can keep up with your energy and independence.',
    bestMatchWith: 'The Sage or The Protector',
  },
  HLLH: {
    name: 'The Social Butterfly',
    emoji: '🦋',
    title: 'Life of the Party',
    description: 'Outgoing, spontaneous, and people-loving. You thrive on connection and new experiences.',
    strengths: ['Social', 'Adaptable', 'Fun', 'Networker'],
    inRelationship: 'You bring excitement and keep the relationship fresh.',
    bestMatchWith: 'The Philosopher or The Sensitive Soul',
  },
  HLHL: {
    name: 'The Adventurous Spirit',
    emoji: '🌍',
    title: 'Passionate Explorer',
    description: 'You combine outgoing energy with deep feelings. You experience life intensely and share it openly.',
    strengths: ['Passionate', 'Expressive', 'Adventurous', 'Romantic'],
    inRelationship: 'You bring passion, spontaneity, and emotional connection.',
    bestMatchWith: 'The Architect or The Protector',
  },
  HLHH: {
    name: 'The Inspirer',
    emoji: '✨',
    title: 'Charismatic Leader',
    description: 'You light up every room with warmth and energy. People are naturally drawn to your enthusiasm.',
    strengths: ['Inspiring', 'Warm', 'Energetic', 'Motivating'],
    inRelationship: 'You bring excitement, emotional depth, and social connection.',
    bestMatchWith: 'The Architect or The Sage',
  },
  HHLL: {
    name: 'The Commander',
    emoji: '👑',
    title: 'Strategic Leader',
    description: 'Outgoing, organized, and logical. You naturally take charge and get things done.',
    strengths: ['Leadership', 'Organized', 'Decisive', 'Goal-oriented'],
    inRelationship: 'You bring structure and clear communication.',
    bestMatchWith: 'The Dreamer or The Sensitive Soul',
  },
  HHLH: {
    name: 'The Connector',
    emoji: '🔗',
    title: 'Community Builder',
    description: 'Outgoing, organized, and people-focused. You bring groups together and keep everyone connected.',
    strengths: ['Organized', 'Social', 'Reliable', 'Inclusive'],
    inRelationship: 'You build a strong social foundation and keep things running smoothly.',
    bestMatchWith: 'The Lone Wolf or The Philosopher',
  },
  HHHL: {
    name: 'The Romantic',
    emoji: '🌹',
    title: 'Passionate Planner',
    description: 'You combine structured thinking with deep emotions. You plan grand gestures and feel everything deeply.',
    strengths: ['Romantic', 'Thoughtful', 'Expressive', 'Dedicated'],
    inRelationship: 'You plan amazing experiences and connect emotionally.',
    bestMatchWith: 'The Maverick or The Adventurous Spirit',
  },
  HHHH: {
    name: 'The Champion',
    emoji: '🏆',
    title: 'All-Around Connector',
    description: 'High on every dimension — you are outgoing, organized, emotionally rich, and deeply connected to others.',
    strengths: ['Versatile', 'Emotionally intelligent', 'Social', 'Ambitious'],
    inRelationship: 'You bring everything to the table — energy, structure, emotion, and connection.',
    bestMatchWith: 'The Philosopher or The Lone Wolf',
  },
};

// ─── Scoring ─────────────────────────────────────────────

interface TraitScore {
  key: TraitKey;
  score: number;
  label: string;
}

interface QuizResults {
  archetype: Archetype;
  archetypeCode: string;
  traits: TraitScore[];
  adventureScore: number;
}

function computeResults(answers: Map<number, number>): QuizResults {
  const traitScores = new Map<TraitKey, number[]>();
  for (const trait of TRAITS) {
    traitScores.set(trait.key, []);
  }

  for (const q of QUESTIONS) {
    const score = answers.get(q.id);
    if (score !== undefined) {
      traitScores.get(q.trait)!.push(score);
    }
  }

  const traits: TraitScore[] = TRAITS.map((trait) => {
    const scores = traitScores.get(trait.key)!;
    const avg =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 50;

    let label: string;
    if (avg <= 30) label = trait.lowLabel;
    else if (avg <= 45) label = `Leaning ${trait.lowLabel}`;
    else if (avg <= 55) label = 'Balanced';
    else if (avg <= 70) label = `Leaning ${trait.highLabel}`;
    else label = trait.highLabel;

    return { key: trait.key, score: avg, label };
  });

  const code = traits
    .slice(0, 4)
    .map((t) => (t.score > 50 ? 'H' : 'L'))
    .join('');

  // ✅ Use DEFAULT_ARCHETYPE as fallback — no more undefined
  const archetype = ARCHETYPES[code] ?? DEFAULT_ARCHETYPE;
  const adventureScore = traits.find((t) => t.key === 'adventure')?.score ?? 50;

  return { archetype, archetypeCode: code, traits, adventureScore };
}

// ─── Component ───────────────────────────────────────────

export default function PersonalityQuizScreen() {
  const router = useRouter();

  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, number>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<QuizResults | null>(null);
  const [showResults, setShowResults] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const animating = useRef(false);

  // ✅ Safe access with fallback — fixes all 'possibly undefined' errors
  const question = QUESTIONS[qIndex] ?? QUESTIONS[0];
  const totalQ = QUESTIONS.length;
  const progress = ((qIndex + 1) / totalQ) * 100;
  const currentAnswer = answers.get(question.id);
  const canGoBack = qIndex > 0;
  const trait = TRAITS.find((t) => t.key === question.trait) ?? TRAITS[0];

  // ── Animation ──────────────────────────────────────

  const fadeTransition = useCallback(
    (onMid: () => void) => {
      if (animating.current) return;
      animating.current = true;
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: FADE_MS / 2,
        useNativeDriver: true,
      }).start(() => {
        onMid();
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: FADE_MS / 2,
          useNativeDriver: true,
        }).start(() => {
          animating.current = false;
        });
      });
    },
    [fadeAnim]
  );

  // ── Handlers ───────────────────────────────────────

  const handleAnswer = useCallback(
    (score: number) => {
      if (submitting || animating.current) return;

      const newAnswers = new Map(answers);
      newAnswers.set(question.id, score);
      setAnswers(newAnswers);

      setTimeout(() => {
        if (qIndex < totalQ - 1) {
          fadeTransition(() => setQIndex((i) => i + 1));
        } else {
          const res = computeResults(newAnswers);
          setResults(res);
          fadeTransition(() => setShowResults(true));
        }
      }, 300);
    },
    [answers, question.id, qIndex, totalQ, submitting, fadeTransition]
  );

  const handleBack = useCallback(() => {
    if (!canGoBack || submitting || animating.current) return;
    fadeTransition(() => setQIndex((i) => i - 1));
  }, [canGoBack, submitting, fadeTransition]);

  const handleSkip = useCallback(() => {
    Alert.alert(
      'Skip Quiz?',
      'Your personality type helps us find better matches. You can always take it later from Settings.',
      [
        { text: 'Take Quiz', style: 'cancel' },
        { text: 'Skip', onPress: () => router.replace('/home' as any) },
      ]
    );
  }, [router]);

  // ── Save ───────────────────────────────────────────

  const saveResults = useCallback(async () => {
    if (!results) return;
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Error', 'Not logged in.');
      return;
    }

    setSubmitting(true);

    try {
      // ✅ Verify account still exists
      await user.reload();

      const traitMap: Record<string, number> = {};
      const labelMap: Record<string, string> = {};
      for (const t of results.traits) {
        traitMap[t.key] = t.score;
        labelMap[t.key] = t.label;
      }

      await updateDoc(doc(db, 'users', user.uid), {
        personalityType: results.archetype.name,
        personalityEmoji: results.archetype.emoji,
        personalityTitle: results.archetype.title,
        personalityDescription: results.archetype.description,
        personalityArchetypeCode: results.archetypeCode,
        personalityTraits: traitMap,
        personalityTraitLabels: labelMap,
        personalityStrengths: results.archetype.strengths,
        personalityInRelationship: results.archetype.inRelationship,
        personalityBestMatch: results.archetype.bestMatchWith,
        personalityAdventureScore: results.adventureScore,
        personalityCompleted: true,
        personalityCompletedAt: new Date().toISOString(),
      });

      router.replace('/home' as any);
    } catch (error: any) {
      // ✅ Handle permission errors and account issues
      if (error?.code === 'auth/user-not-found' || error?.code === 'auth/user-token-expired') {
        Alert.alert('Session Expired', 'Please log in again.');
        router.replace('/login' as any);
        return;
      }

      if (error?.code === 'permission-denied') {
        Alert.alert('Error', 'Permission denied. Please log in again.');
        return;
      }

      const msg = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Save Error', msg, [
        { text: 'Retry', onPress: saveResults },
        { text: 'Skip', style: 'cancel', onPress: () => router.replace('/home' as any) },
      ]);
    } finally {
      setSubmitting(false);
    }
  }, [results, router]);

  const retakeQuiz = useCallback(() => {
    setQIndex(0);
    setAnswers(new Map());
    setResults(null);
    setShowResults(false);
  }, []);

  // ── Submitting screen ──────────────────────────────

  if (submitting) {
    return (
      <SafeAreaView style={s.centered}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={s.loadText}>Saving your personality profile…</Text>
      </SafeAreaView>
    );
  }

  // ── Results screen ─────────────────────────────────

  if (showResults && results) {
    const { archetype, traits, adventureScore } = results;

    return (
      <SafeAreaView style={s.root}>
        <ScrollView
          contentContainerStyle={s.resultsScroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Archetype header */}
          <View style={s.resHeader}>
            <Text style={s.resEmoji}>{archetype.emoji}</Text>
            <Text style={s.resName}>{archetype.name}</Text>
            <Text style={s.resTitle}>{archetype.title}</Text>
            <Text style={s.resDesc}>{archetype.description}</Text>
          </View>

          {/* Trait bars */}
          <View style={s.traitsCard}>
            <Text style={s.traitsTitle}>Your Personality Spectrum</Text>
            {traits.map((t) => {
              const def = TRAITS.find((d) => d.key === t.key) ?? TRAITS[0];
              return (
                <View key={t.key} style={s.traitRow}>
                  <View style={s.traitLabels}>
                    <Text style={s.traitLow}>
                      {def.lowEmoji} {def.lowLabel}
                    </Text>
                    <Text style={s.traitHigh}>
                      {def.highLabel} {def.highEmoji}
                    </Text>
                  </View>
                  <View style={s.traitBarBg}>
                    <View
                      style={[
                        s.traitBarFill,
                        {
                          width: `${t.score}%` as any,
                          backgroundColor: def.color,
                        },
                      ]}
                    />
                    <View
                      style={[
                        s.traitDot,
                        {
                          left: `${t.score}%` as any,
                          backgroundColor: def.color,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[s.traitLabel, { color: def.color }]}>
                    {t.label} ({t.score}%)
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Strengths */}
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>💪 Your Strengths</Text>
            <View style={s.strengthGrid}>
              {archetype.strengths.map((str) => (
                <View key={str} style={s.strengthChip}>
                  <Text style={s.strengthText}>{str}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* In Relationship */}
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>💕 In a Relationship</Text>
            <Text style={s.sectionBody}>{archetype.inRelationship}</Text>
          </View>

          {/* Adventure modifier */}
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>
              {adventureScore > 60 ? '🚀' : '🏠'} Adventure Level
            </Text>
            <View style={s.adventureBar}>
              <Text style={s.adventureLow}>🏠 Comfort</Text>
              <View style={s.adventureTrack}>
                <View
                  style={[
                    s.adventureFill,
                    { width: `${adventureScore}%` as any },
                  ]}
                />
              </View>
              <Text style={s.adventureHigh}>Thrill 🚀</Text>
            </View>
            <Text style={s.sectionBody}>
              {adventureScore > 70
                ? "You're always seeking new experiences and challenges!"
                : adventureScore > 40
                ? 'You enjoy new experiences but also value your comfort zone.'
                : 'You prefer the familiar and find joy in routine and stability.'}
            </Text>
          </View>

          {/* Best match */}
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>🎯 Best Match With</Text>
            <Text style={s.sectionBody}>{archetype.bestMatchWith}</Text>
            <Text style={s.matchHint}>
              Our matching algorithm uses your personality to suggest compatible partners!
            </Text>
          </View>

          {/* Actions */}
          <TouchableOpacity
            style={s.saveBtn}
            onPress={saveResults}
            activeOpacity={0.8}
          >
            <Text style={s.saveBtnText}>✓ Save & Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.retakeBtn}
            onPress={retakeQuiz}
            activeOpacity={0.7}
          >
            <Text style={s.retakeBtnText}>🔄 Retake Quiz</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Quiz screen ────────────────────────────────────

  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerSide}>
          {canGoBack && (
            <TouchableOpacity
              onPress={handleBack}
              hitSlop={HIT}
              accessibilityRole="button"
              accessibilityLabel="Previous question"
            >
              <Text style={s.backText}>← Back</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={s.counter}>
          {qIndex + 1} / {totalQ}
        </Text>
        <View style={s.headerSide} />
      </View>

      {/* Progress */}
      <View style={s.progBg} accessibilityRole="progressbar">
        <View style={[s.progFill, { width: `${progress}%` as any }]} />
      </View>

      {/* Trait badge */}
      <View style={s.traitBadge}>
        <View style={[s.traitBadgeDot, { backgroundColor: trait.color }]} />
        <Text style={s.traitBadgeText}>{trait.name}</Text>
      </View>

      {/* Question */}
      <Animated.View style={[s.content, { opacity: fadeAnim }]}>
        {question.scenario != null && (
          <Text style={s.scenario}>{question.scenario}</Text>
        )}
        <Text style={s.question}>{question.question}</Text>

        {/* Side labels */}
        <View style={s.sidesRow}>
          <View style={[s.sideLabel, { borderColor: trait.color }]}>
            <Text style={s.sideLabelEmoji}>{trait.lowEmoji}</Text>
            <Text style={s.sideLabelText}>{trait.lowLabel}</Text>
          </View>
          <View style={[s.sideLabel, { borderColor: trait.color }]}>
            <Text style={s.sideLabelEmoji}>{trait.highEmoji}</Text>
            <Text style={s.sideLabelText}>{trait.highLabel}</Text>
          </View>
        </View>

        {/* Answer options */}
        <View style={s.optionsWrap}>
          <Text style={s.sideDesc}>{question.sideA}</Text>

          <View style={s.optionBtns}>
            {ANSWER_OPTIONS.map((opt, idx) => {
              const isSelected = currentAnswer === opt.score;
              const isMiddle = idx === 2;
              const isLeftSide = idx < 2;

              return (
                <TouchableOpacity
                  key={idx}
                  style={[
                    s.optBtn,
                    isSelected && s.optBtnSelected,
                    isMiddle && s.optBtnMiddle,
                    isSelected && { borderColor: trait.color },
                  ]}
                  onPress={() => handleAnswer(opt.score)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isMiddle
                      ? 'It depends'
                      : `${isLeftSide ? question.sideA : question.sideB} — ${opt.label}`
                  }
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={s.optEmoji}>{opt.emoji}</Text>
                  <Text
                    style={[
                      s.optLabel,
                      isSelected && s.optLabelSelected,
                      isMiddle && s.optLabelMiddle,
                    ]}
                    numberOfLines={2}
                  >
                    {isMiddle
                      ? 'It Depends'
                      : isLeftSide
                      ? idx === 0
                        ? 'Strongly'
                        : 'Somewhat'
                      : idx === 3
                      ? 'Somewhat'
                      : 'Strongly'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[s.sideDesc, s.sideDescRight]}>{question.sideB}</Text>

          <View style={s.scaleRow}>
            <Text style={s.scaleLabel}>
              {trait.lowEmoji} {trait.lowLabel}
            </Text>
            <View style={s.scaleLine} />
            <Text style={s.scaleLabel}>
              {trait.highLabel} {trait.highEmoji}
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Skip */}
      <TouchableOpacity
        style={s.skipBtn}
        onPress={handleSkip}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel="Skip quiz"
      >
        <Text style={s.skipText}>Skip for now</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20 },
  centered: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadText: { color: C.accent, fontSize: 18, textAlign: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  headerSide: { flex: 1 },
  backText: { color: C.accent, fontSize: 16 },
  counter: { color: C.sub, fontSize: 14, textAlign: 'center' },

  progBg: {
    height: 6,
    backgroundColor: C.card,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progFill: { height: '100%', backgroundColor: C.accent, borderRadius: 3 },

  traitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: C.card,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 8,
    marginBottom: 16,
  },
  traitBadgeDot: { width: 10, height: 10, borderRadius: 5 },
  traitBadgeText: { color: C.sub, fontSize: 13, fontWeight: '600' },

  content: { flex: 1, justifyContent: 'center' },
  scenario: {
    color: C.muted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  question: {
    fontSize: 22,
    fontWeight: 'bold',
    color: C.text,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 32,
  },

  sidesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 10,
  },
  sideLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.card,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  sideLabelEmoji: { fontSize: 16 },
  sideLabelText: { color: C.sub, fontSize: 12, fontWeight: '600' },

  optionsWrap: { gap: 10 },
  sideDesc: {
    color: C.sub,
    fontSize: 14,
    textAlign: 'left',
    lineHeight: 20,
    paddingHorizontal: 4,
  },
  sideDescRight: { textAlign: 'right' },

  optionBtns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginVertical: 10,
  },
  optBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.none,
    minHeight: 70,
  },
  optBtnSelected: {
    backgroundColor: C.input,
  },
  optBtnMiddle: {
    backgroundColor: 'rgba(83,168,182,0.1)',
    borderStyle: 'dashed',
    borderColor: C.input,
  },
  optEmoji: { fontSize: 20, marginBottom: 4 },
  optLabel: { color: C.muted, fontSize: 11, textAlign: 'center' },
  optLabelSelected: { color: C.text, fontWeight: 'bold' },
  optLabelMiddle: { color: C.accent },

  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  scaleLabel: { color: C.dim, fontSize: 11 },
  scaleLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.input,
  },

  skipBtn: { alignSelf: 'center', paddingVertical: 16 },
  skipText: { color: C.dim, fontSize: 14 },

  resultsScroll: { padding: 20, paddingBottom: 40 },

  resHeader: { alignItems: 'center', marginBottom: 30, marginTop: 20 },
  resEmoji: { fontSize: 80, marginBottom: 16 },
  resName: { fontSize: 28, fontWeight: 'bold', color: C.text, marginBottom: 4 },
  resTitle: { fontSize: 18, color: C.accent, fontWeight: '600', marginBottom: 12 },
  resDesc: { fontSize: 15, color: C.sub, textAlign: 'center', lineHeight: 22 },

  traitsCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  traitsTitle: { fontSize: 18, fontWeight: 'bold', color: C.text, marginBottom: 20 },
  traitRow: { marginBottom: 20 },
  traitLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  traitLow: { color: C.sub, fontSize: 12 },
  traitHigh: { color: C.sub, fontSize: 12 },
  traitBarBg: {
    height: 12,
    backgroundColor: C.input,
    borderRadius: 6,
    overflow: 'visible',
    position: 'relative',
  },
  traitBarFill: { height: '100%', borderRadius: 6 },
  traitDot: {
    position: 'absolute',
    top: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
    borderWidth: 3,
    borderColor: C.bg,
  },
  traitLabel: { fontSize: 13, fontWeight: '600', marginTop: 6, textAlign: 'center' },

  sectionCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: C.text, marginBottom: 12 },
  sectionBody: { fontSize: 15, color: C.sub, lineHeight: 22 },

  strengthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  strengthChip: {
    backgroundColor: C.input,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  strengthText: { color: C.accent, fontSize: 14, fontWeight: '600' },

  adventureBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  adventureLow: { color: C.muted, fontSize: 11 },
  adventureHigh: { color: C.muted, fontSize: 11 },
  adventureTrack: {
    flex: 1,
    height: 8,
    backgroundColor: C.input,
    borderRadius: 4,
    overflow: 'hidden',
  },
  adventureFill: {
    height: '100%',
    backgroundColor: C.warning,
    borderRadius: 4,
  },

  matchHint: {
    color: C.accent,
    fontSize: 13,
    marginTop: 10,
    fontStyle: 'italic',
  },

  saveBtn: {
    backgroundColor: C.success,
    paddingVertical: 18,
    borderRadius: 25,
    alignItems: 'center',
    marginTop: 10,
  },
  saveBtnText: { color: C.white, fontSize: 18, fontWeight: 'bold' },
  retakeBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  retakeBtnText: { color: C.accent, fontSize: 16 },
});