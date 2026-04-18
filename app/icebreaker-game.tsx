import { observable } from '@legendapp/state';
import { observer } from '@legendapp/state/react';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { GameSession, getGameSession, startGame, submitAnswer, THIS_OR_THAT_QUESTIONS, WOULD_YOU_RATHER_QUESTIONS } from '../utils/icebreakerGames';
import { logger } from '../utils/logger';

interface Question { a: string; b: string; }

function secureRandInt(max: number): number {
  const bytes = Crypto.getRandomBytes(4);
  const val = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return val % max;
}
function secureShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}
function calculateCompatibilityScore(matchCount: number, totalQuestions: number): number {
  return totalQuestions === 0 ? 0 : Math.round((matchCount / totalQuestions) * 100);
}

const TOTAL_QUESTIONS = 10;

const screen$ = observable({
  loading:         true,
  gameSession:     null as GameSession | null,
  questions:       [] as Question[],
  currentQuestion: 0,
  myAnswer:        null as string | null,
  waitingForMatch: false,
  lastResult:      null as { matched: boolean } | null,
  gameComplete:    false,
  matchCount:      0,
});

export default observer(function IcebreakerGameScreen() {
  const router = useRouter();
  const { chatId, matchId, matchName, gameType } = useLocalSearchParams<{
    chatId: string; matchId: string; matchName: string; gameType: 'would_you_rather' | 'this_or_that';
  }>();

  const initRan = useRef(false);

  const loading         = screen$.loading.get();
  const gameSession     = screen$.gameSession.get();
  const questions       = screen$.questions.get();
  const currentQuestion = screen$.currentQuestion.get();
  const myAnswer        = screen$.myAnswer.get();
  const waitingForMatch = screen$.waitingForMatch.get();
  const lastResult      = screen$.lastResult.get();
  const gameComplete    = screen$.gameComplete.get();
  const matchCount      = screen$.matchCount.get();

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    void initGame();
  }, []);

  const initGame = async () => {
    try {
      const type = gameType as 'would_you_rather' | 'this_or_that';
      const result = await startGame(chatId, matchId, type);
      if (!result.success || !result.gameId) {
        Alert.alert('Error', result.error || 'Could not start game.');
        router.back();
        return;
      }
      const session = await getGameSession(result.gameId);
      screen$.gameSession.set(session);
      const bank = type === 'would_you_rather' ? WOULD_YOU_RATHER_QUESTIONS : THIS_OR_THAT_QUESTIONS;
      screen$.questions.set(secureShuffle([...bank as Question[]]).slice(0, TOTAL_QUESTIONS));
    } catch (error) {
      logger.error('[Icebreaker] init error:', error);
      Alert.alert('Error', 'Failed to start the game.');
      router.back();
    } finally {
      screen$.loading.set(false);
    }
  };

  const handleAnswer = async (answer: string) => {
    if (!gameSession || myAnswer) return;
    screen$.myAnswer.set(answer);
    screen$.waitingForMatch.set(true);
    try {
      const result = await submitAnswer(gameSession.id, answer);
      if (!result.bothAnswered) return;
      const matched = result.matched ?? false;
      if (matched) screen$.matchCount.set(screen$.matchCount.get() + 1);
      screen$.lastResult.set({ matched });
      setTimeout(() => {
        const idx = screen$.currentQuestion.get();
        if (idx + 1 >= TOTAL_QUESTIONS) {
          screen$.gameComplete.set(true);
        } else {
          screen$.currentQuestion.set(idx + 1);
          screen$.myAnswer.set(null);
          screen$.waitingForMatch.set(false);
          screen$.lastResult.set(null);
        }
      }, 2000);
    } catch (error) {
      logger.error('[Icebreaker] submit error:', error);
      Alert.alert('Error', 'Could not submit your answer.');
      screen$.myAnswer.set(null);
      screen$.waitingForMatch.set(false);
    }
  };

  if (loading) return (
    <View style={s.container}>
      <ActivityIndicator size="large" color="#53a8b6" />
      <Text style={s.loadingText}>Starting game...</Text>
    </View>
  );

  if (gameComplete) {
    const score = calculateCompatibilityScore(matchCount, TOTAL_QUESTIONS);
    return (
      <View style={s.container}>
        <Text style={s.completeEmoji}>🎉</Text>
        <Text style={s.completeTitle}>Game Complete!</Text>
        <Text style={s.completeSubtitle}>You and {matchName} matched on</Text>
        <View style={s.scoreContainer}>
          <Text style={s.scoreNumber}>{score}%</Text>
          <Text style={s.scoreLabel}>of answers</Text>
        </View>
        <Text style={s.compatibilityLabel}>
          {score >= 70 ? '🔥 Great compatibility!' : score >= 50 ? '👍 Good match!' : '🎲 Opposites attract!'}
        </Text>
        <TouchableOpacity style={s.doneButton} onPress={() = accessibilityLabel="button"> router.back()} accessibilityLabel="Back to chat" accessibilityRole="button">
          <Text style={s.doneButtonText}>Back to Chat</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const question         = questions[currentQuestion];
  const isWouldYouRather = gameType === 'would_you_rather';

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() = accessibilityLabel="button"> router.back()} accessibilityLabel="Close game" accessibilityRole="button">
          <Text style={s.closeButton}>✕</Text>
        </TouchableOpacity>
        <Text style={s.gameTitle}>{isWouldYouRather ? '🤔 Would You Rather' : '⚡ This or That'}</Text>
        <Text style={s.progress}>{currentQuestion + 1}/{TOTAL_QUESTIONS}</Text>
      </View>

      <View style={s.progressBar}>
        <View style={[s.progressFill, { width: `${((currentQuestion + 1) / TOTAL_QUESTIONS) * 100}%` as `${number}%` }]} />
      </View>

      {lastResult && (
        <View style={[s.resultBanner, lastResult.matched ? s.resultMatch : s.resultNoMatch]}>
          <Text style={s.resultText}>{lastResult.matched ? '✓ You both chose the same!' : '✗ Different answers'}</Text>
        </View>
      )}

      <View style={s.questionContainer}>
        <Text style={s.questionText}>{isWouldYouRather ? 'Would you rather...' : 'Which do you prefer?'}</Text>
      </View>

      {question && (
        <View style={s.optionsContainer}>
          <TouchableOpacity
            style={[s.optionButton, myAnswer === 'a' && s.optionButtonSelected, waitingForMatch && myAnswer !== 'a' && s.optionButtonDisabled]}
            onPress={() = accessibilityLabel="button"> void handleAnswer('a')}
            disabled={!!myAnswer}
            accessibilityLabel={question.a}
            accessibilityRole="button"
          >
            <Text style={[s.optionText, myAnswer === 'a' && s.optionTextSelected]}>{question.a}</Text>
          </TouchableOpacity>

          <View style={s.orContainer}>
            <Text style={s.orText}>{isWouldYouRather ? 'OR' : 'VS'}</Text>
          </View>

          <TouchableOpacity
            style={[s.optionButton, myAnswer === 'b' && s.optionButtonSelected, waitingForMatch && myAnswer !== 'b' && s.optionButtonDisabled]}
            onPress={() = accessibilityLabel="button"> void handleAnswer('b')}
            disabled={!!myAnswer}
            accessibilityLabel={question.b}
            accessibilityRole="button"
          >
            <Text style={[s.optionText, myAnswer === 'b' && s.optionTextSelected]}>{question.b}</Text>
          </TouchableOpacity>
        </View>
      )}

      {waitingForMatch && !lastResult && (
        <View style={s.waitingContainer}>
          <ActivityIndicator size="small" color="#53a8b6" />
          <Text style={s.waitingText}>Waiting for {matchName}...</Text>
        </View>
      )}
    </View>
  );
});

const s = StyleSheet.create((theme) => ({
  container:           { flex: 1, backgroundColor: theme.colors.background, padding: 20 },
  loadingText:         { color: theme.colors.textSecondary, marginTop: 15, textAlign: 'center' },
  header:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  closeButton:         { color: '#d9534f', fontSize: 24, fontWeight: 'bold' },
  gameTitle:           { color: theme.colors.text, fontSize: 18, fontWeight: 'bold' },
  progress:            { color: '#53a8b6', fontSize: 14 },
  progressBar:         { height: 6, backgroundColor: '#0f3460', borderRadius: 3, marginBottom: 20 },
  progressFill:        { height: '100%', backgroundColor: '#53a8b6', borderRadius: 3 },
  resultBanner:        { padding: 12, borderRadius: 10, marginBottom: 20, alignItems: 'center' },
  resultMatch:         { backgroundColor: 'rgba(92,184,92,0.3)' },
  resultNoMatch:       { backgroundColor: 'rgba(217,83,79,0.3)' },
  resultText:          { color: '#fff', fontSize: 14, fontWeight: '600' },
  questionContainer:   { alignItems: 'center', marginBottom: 30 },
  questionText:        { color: '#e67e22', fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
  optionsContainer:    { flex: 1, justifyContent: 'center' },
  optionButton:        { backgroundColor: '#16213e', padding: 25, borderRadius: 15, marginVertical: 10, borderWidth: 3, borderColor: '#16213e' },
  optionButtonSelected: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  optionButtonDisabled: { opacity: 0.5 },
  optionText:          { color: theme.colors.text, fontSize: 18, textAlign: 'center', lineHeight: 26 },
  optionTextSelected:  { color: '#53a8b6', fontWeight: 'bold' },
  orContainer:         { alignItems: 'center', marginVertical: 15 },
  orText:              { color: '#e67e22', fontSize: 20, fontWeight: 'bold' },
  waitingContainer:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 20 },
  waitingText:         { color: theme.colors.textSecondary, fontSize: 14 },
  completeEmoji:       { fontSize: 80, textAlign: 'center', marginTop: 60 },
  completeTitle:       { fontSize: 32, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center', marginTop: 20 },
  completeSubtitle:    { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 10 },
  scoreContainer:      { alignItems: 'center', marginTop: 30 },
  scoreNumber:         { fontSize: 72, fontWeight: 'bold', color: '#53a8b6' },
  scoreLabel:          { fontSize: 18, color: theme.colors.textSecondary },
  compatibilityLabel:  { fontSize: 20, color: '#5cb85c', textAlign: 'center', marginTop: 20 },
  doneButton:          { backgroundColor: '#53a8b6', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, marginTop: 40, alignSelf: 'center' },
  doneButtonText:      { color: '#fff', fontSize: 18, fontWeight: '600' },
}));