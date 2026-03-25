import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth } from '../firebaseConfig';
import {
    calculateCompatibilityFromGame,
    GameSession,
    getGameSession,
    startGame,
    submitAnswer,
    THIS_OR_THAT_QUESTIONS,
    WOULD_YOU_RATHER_QUESTIONS,
} from '../utils/icebreakerGames';

export default function IcebreakerGameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { chatId, matchId, matchName, gameType } = params;

  const [loading, setLoading] = useState(true);
  const [gameSession, setGameSession] = useState<GameSession | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [myAnswer, setMyAnswer] = useState<string | null>(null);
  const [waitingForMatch, setWaitingForMatch] = useState(false);
  const [lastResult, setLastResult] = useState<{ matched: boolean } | null>(null);
  const [gameComplete, setGameComplete] = useState(false);

  const user = auth.currentUser;

  useEffect(() => {
    initGame();
  }, []);

  const initGame = async () => {
    const type = gameType as 'would_you_rather' | 'this_or_that';
    const result = await startGame(chatId as string, matchId as string, type);

    if (result.success && result.gameId) {
      const session = await getGameSession(result.gameId);
      setGameSession(session);

      const q = type === 'would_you_rather' ? WOULD_YOU_RATHER_QUESTIONS : THIS_OR_THAT_QUESTIONS;
      // Shuffle
      const shuffled = [...q].sort(() => Math.random() - 0.5).slice(0, 10);
      setQuestions(shuffled);
    }

    setLoading(false);
  };

  const handleAnswer = async (answer: string) => {
    if (!gameSession || myAnswer) return;

    setMyAnswer(answer);
    setWaitingForMatch(true);

    const result = await submitAnswer(gameSession.id, answer);

    if (result.bothAnswered) {
      setLastResult({ matched: result.matched || false });
      
      setTimeout(() => {
        if (currentQuestion + 1 >= 10) {
          setGameComplete(true);
        } else {
          setCurrentQuestion(currentQuestion + 1);
          setMyAnswer(null);
          setWaitingForMatch(false);
          setLastResult(null);
        }
      }, 2000);
    }
  };

  const getCompatibilityScore = () => {
    if (!gameSession) return 0;
    return calculateCompatibilityFromGame(gameSession.matchCount || 0, 10);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Starting game...</Text>
      </View>
    );
  }

  if (gameComplete) {
    const score = getCompatibilityScore();
    return (
      <View style={styles.container}>
        <Text style={styles.completeEmoji}>🎉</Text>
        <Text style={styles.completeTitle}>Game Complete!</Text>
        <Text style={styles.completeSubtitle}>
          You and {matchName} matched on
        </Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreNumber}>{score}%</Text>
          <Text style={styles.scoreLabel}>of answers</Text>
        </View>
        <Text style={styles.compatibilityLabel}>
          {score >= 70 ? '🔥 Great compatibility!' : 
           score >= 50 ? '👍 Good match!' : 
           '🎲 Opposites attract!'}
        </Text>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={() => router.back()}
        >
          <Text style={styles.doneButtonText}>Back to Chat</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const question = questions[currentQuestion];
  const isWouldYouRather = gameType === 'would_you_rather';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeButton}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.gameTitle}>
          {isWouldYouRather ? '🤔 Would You Rather' : '⚡ This or That'}
        </Text>
        <Text style={styles.progress}>{currentQuestion + 1}/10</Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${((currentQuestion + 1) / 10) * 100}%` }]} />
      </View>

      {/* Last Result */}
      {lastResult && (
        <View style={[styles.resultBanner, lastResult.matched ? styles.resultMatch : styles.resultNoMatch]}>
          <Text style={styles.resultText}>
            {lastResult.matched ? '✓ You both chose the same!' : '✗ Different answers'}
          </Text>
        </View>
      )}

      {/* Question */}
      <View style={styles.questionContainer}>
        {isWouldYouRather ? (
          <Text style={styles.questionText}>Would you rather...</Text>
        ) : (
          <Text style={styles.questionText}>Which do you prefer?</Text>
        )}
      </View>

      {/* Options */}
      {question && (
        <View style={styles.optionsContainer}>
          <TouchableOpacity
            style={[
              styles.optionButton,
              myAnswer === 'a' && styles.optionButtonSelected,
              waitingForMatch && myAnswer !== 'a' && styles.optionButtonDisabled,
            ]}
            onPress={() => handleAnswer('a')}
            disabled={!!myAnswer}
          >
            <Text style={[
              styles.optionText,
              myAnswer === 'a' && styles.optionTextSelected,
            ]}>
              {question.a}
            </Text>
          </TouchableOpacity>

          <View style={styles.orContainer}>
            <Text style={styles.orText}>{isWouldYouRather ? 'OR' : 'VS'}</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.optionButton,
              myAnswer === 'b' && styles.optionButtonSelected,
              waitingForMatch && myAnswer !== 'b' && styles.optionButtonDisabled,
            ]}
            onPress={() => handleAnswer('b')}
            disabled={!!myAnswer}
          >
            <Text style={[
              styles.optionText,
              myAnswer === 'b' && styles.optionTextSelected,
            ]}>
              {question.b}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Waiting State */}
      {waitingForMatch && !lastResult && (
        <View style={styles.waitingContainer}>
          <ActivityIndicator size="small" color="#53a8b6" />
          <Text style={styles.waitingText}>Waiting for {matchName}...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  loadingText: { color: '#aaa', marginTop: 15, textAlign: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  closeButton: { color: '#d9534f', fontSize: 24, fontWeight: 'bold' },
  gameTitle: { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  progress: { color: '#53a8b6', fontSize: 14 },
  progressBar: { height: 6, backgroundColor: '#0f3460', borderRadius: 3, marginBottom: 20 },
  progressFill: { height: '100%', backgroundColor: '#53a8b6', borderRadius: 3 },
  resultBanner: { padding: 12, borderRadius: 10, marginBottom: 20, alignItems: 'center' },
  resultMatch: { backgroundColor: 'rgba(92, 184, 92, 0.3)' },
  resultNoMatch: { backgroundColor: 'rgba(217, 83, 79, 0.3)' },
  resultText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  questionContainer: { alignItems: 'center', marginBottom: 30 },
  questionText: { color: '#e67e22', fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
  optionsContainer: { flex: 1, justifyContent: 'center' },
  optionButton: { backgroundColor: '#16213e', padding: 25, borderRadius: 15, marginVertical: 10, borderWidth: 3, borderColor: '#16213e' },
  optionButtonSelected: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  optionButtonDisabled: { opacity: 0.5 },
  optionText: { color: '#eee', fontSize: 18, textAlign: 'center', lineHeight: 26 },
  optionTextSelected: { color: '#53a8b6', fontWeight: 'bold' },
  orContainer: { alignItems: 'center', marginVertical: 15 },
  orText: { color: '#e67e22', fontSize: 20, fontWeight: 'bold' },
  waitingContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 20 },
  waitingText: { color: '#888', fontSize: 14 },
  completeEmoji: { fontSize: 80, textAlign: 'center', marginTop: 60 },
  completeTitle: { fontSize: 32, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginTop: 20 },
  completeSubtitle: { fontSize: 16, color: '#888', textAlign: 'center', marginTop: 10 },
  scoreContainer: { alignItems: 'center', marginTop: 30 },
  scoreNumber: { fontSize: 72, fontWeight: 'bold', color: '#53a8b6' },
  scoreLabel: { fontSize: 18, color: '#888' },
  compatibilityLabel: { fontSize: 20, color: '#5cb85c', textAlign: 'center', marginTop: 20 },
  doneButton: { backgroundColor: '#53a8b6', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, marginTop: 40, alignSelf: 'center' },
  doneButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});