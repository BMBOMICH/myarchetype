import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth } from '../firebaseConfig';
import {
    COMPATIBILITY_QUESTIONS,
    getCompatibilityLabel,
    getQuizSession,
    startCompatibilityQuiz,
    submitQuizAnswers
} from '../utils/compatibilityQuiz';

export default function CompatibilityQuizScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { chatId, matchId, matchName, quizId: existingQuizId } = params;

  const [loading, setLoading] = useState(true);
  const [quizId, setQuizId] = useState<string | null>(existingQuizId as string || null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<{ [key: number]: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [waitingForMatch, setWaitingForMatch] = useState(false);
  const [quizResult, setQuizResult] = useState<{ score: number; categoryScores: any } | null>(null);

  const user = auth.currentUser;

  useEffect(() => {
    initQuiz();
  }, []);

  const initQuiz = async () => {
    if (existingQuizId) {
      // Check existing quiz status
      const session = await getQuizSession(existingQuizId as string);
      if (session) {
        const isPlayer1 = session.player1Id === user?.uid;
        const myCompleted = isPlayer1 ? session.player1Completed : session.player2Completed;

        if (myCompleted && session.compatibilityScore !== null) {
          setQuizResult({
            score: session.compatibilityScore,
            categoryScores: session.categoryScores,
          });
        } else if (myCompleted) {
          setWaitingForMatch(true);
        }
      }
      setQuizId(existingQuizId as string);
    } else {
      // Start new quiz
      const result = await startCompatibilityQuiz(chatId as string, matchId as string);
      if (result.success && result.quizId) {
        setQuizId(result.quizId);
      }
    }
    setLoading(false);
  };

  const handleAnswer = (answer: string) => {
    setAnswers({
      ...answers,
      [COMPATIBILITY_QUESTIONS[currentQuestion].id]: answer,
    });

    if (currentQuestion < COMPATIBILITY_QUESTIONS.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handleSubmit = async () => {
    if (!quizId) return;

    setSubmitting(true);
    const result = await submitQuizAnswers(quizId, answers);
    setSubmitting(false);

    if (result.bothCompleted && result.score !== undefined) {
      const session = await getQuizSession(quizId);
      setQuizResult({
        score: result.score,
        categoryScores: session?.categoryScores || {},
      });
    } else {
      setWaitingForMatch(true);
    }
  };

  const isComplete = Object.keys(answers).length === COMPATIBILITY_QUESTIONS.length;
  const question = COMPATIBILITY_QUESTIONS[currentQuestion];

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading quiz...</Text>
      </View>
    );
  }

  if (quizResult) {
    const { label, emoji, color } = getCompatibilityLabel(quizResult.score);

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.resultContent}>
        <Text style={styles.resultEmoji}>{emoji}</Text>
        <Text style={styles.resultTitle}>{label}</Text>
        
        <View style={styles.scoreCircle}>
          <Text style={[styles.scoreNumber, { color }]}>{quizResult.score}%</Text>
          <Text style={styles.scoreLabel}>Compatibility</Text>
        </View>

        <Text style={styles.categoriesTitle}>Category Breakdown</Text>
        
        <View style={styles.categoriesContainer}>
          {Object.entries(quizResult.categoryScores || {}).map(([category, score]) => (
            <View key={category} style={styles.categoryRow}>
              <Text style={styles.categoryName}>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </Text>
              <View style={styles.categoryBarContainer}>
                <View style={[styles.categoryBar, { width: `${score}%` }]} />
              </View>
              <Text style={styles.categoryScore}>{score as number}%</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={() => router.back()}
        >
          <Text style={styles.doneButtonText}>Back to Chat</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (waitingForMatch) {
    return (
      <View style={styles.container}>
        <Text style={styles.waitingEmoji}>⏳</Text>
        <Text style={styles.waitingTitle}>Quiz Submitted!</Text>
        <Text style={styles.waitingText}>
          Waiting for {matchName} to complete their answers...
        </Text>
        <Text style={styles.waitingSubtext}>
          You'll both see the results once complete!
        </Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Back to Chat</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeButton}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.quizTitle}>💕 Compatibility Quiz</Text>
        <Text style={styles.progress}>{currentQuestion + 1}/{COMPATIBILITY_QUESTIONS.length}</Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${((currentQuestion + 1) / COMPATIBILITY_QUESTIONS.length) * 100}%` }]} />
      </View>

      {/* Category Badge */}
      <View style={styles.categoryBadge}>
        <Text style={styles.categoryBadgeText}>
          {question.category.toUpperCase()}
        </Text>
      </View>

      {/* Question */}
      <Text style={styles.questionText}>{question.question}</Text>

      {/* Options */}
      <ScrollView style={styles.optionsScroll}>
        {question.options.map((option, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.optionButton,
              answers[question.id] === option && styles.optionButtonSelected,
            ]}
            onPress={() => handleAnswer(option)}
          >
            <Text style={[
              styles.optionText,
              answers[question.id] === option && styles.optionTextSelected,
            ]}>
              {option}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Navigation */}
      <View style={styles.navContainer}>
        {currentQuestion > 0 && (
          <TouchableOpacity
            style={styles.prevButton}
            onPress={() => setCurrentQuestion(currentQuestion - 1)}
          >
            <Text style={styles.prevButtonText}>← Previous</Text>
          </TouchableOpacity>
        )}

        {isComplete && (
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            <Text style={styles.submitButtonText}>
              {submitting ? 'Submitting...' : '✓ Submit Quiz'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  loadingText: { color: '#aaa', marginTop: 15, textAlign: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  closeButton: { color: '#d9534f', fontSize: 24, fontWeight: 'bold' },
  quizTitle: { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  progress: { color: '#53a8b6', fontSize: 14 },
  progressBar: { height: 6, backgroundColor: '#0f3460', borderRadius: 3, marginBottom: 25 },
  progressFill: { height: '100%', backgroundColor: '#e67e22', borderRadius: 3 },
  categoryBadge: { backgroundColor: '#9b59b6', alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 15, marginBottom: 20 },
  categoryBadgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  questionText: { color: '#eee', fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 30, lineHeight: 32 },
  optionsScroll: { flex: 1 },
  optionButton: { backgroundColor: '#16213e', padding: 18, borderRadius: 12, marginBottom: 12, borderWidth: 2, borderColor: '#16213e' },
  optionButtonSelected: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  optionText: { color: '#aaa', fontSize: 16, textAlign: 'center' },
  optionTextSelected: { color: '#53a8b6', fontWeight: '600' },
  navContainer: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 15 },
  prevButton: { padding: 12 },
  prevButtonText: { color: '#888', fontSize: 16 },
  submitButton: { backgroundColor: '#5cb85c', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25 },
  submitButtonDisabled: { backgroundColor: '#555' },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  // Results
  resultContent: { alignItems: 'center', paddingTop: 60, paddingBottom: 40 },
  resultEmoji: { fontSize: 80 },
  resultTitle: { fontSize: 28, fontWeight: 'bold', color: '#eee', marginTop: 20 },
  scoreCircle: { marginTop: 30, alignItems: 'center' },
  scoreNumber: { fontSize: 72, fontWeight: 'bold' },
  scoreLabel: { fontSize: 18, color: '#888', marginTop: 5 },
  categoriesTitle: { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginTop: 40, marginBottom: 15 },
  categoriesContainer: { width: '100%', paddingHorizontal: 20 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  categoryName: { width: 100, color: '#aaa', fontSize: 13 },
  categoryBarContainer: { flex: 1, height: 8, backgroundColor: '#0f3460', borderRadius: 4, marginHorizontal: 10 },
  categoryBar: { height: '100%', backgroundColor: '#53a8b6', borderRadius: 4 },
  categoryScore: { width: 40, color: '#eee', fontSize: 13, textAlign: 'right' },
  doneButton: { backgroundColor: '#53a8b6', paddingVertical: 16, paddingHorizontal: 50, borderRadius: 25, marginTop: 40 },
  doneButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  // Waiting
  waitingEmoji: { fontSize: 80, textAlign: 'center', marginTop: 100 },
  waitingTitle: { fontSize: 28, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginTop: 20 },
  waitingText: { fontSize: 16, color: '#888', textAlign: 'center', marginTop: 15 },
  waitingSubtext: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 10 },
  backButton: { backgroundColor: '#0f3460', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25, marginTop: 40, alignSelf: 'center' },
  backButtonText: { color: '#53a8b6', fontSize: 16, fontWeight: '600' },
});