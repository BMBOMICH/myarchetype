import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth } from '../firebaseConfig';
import { COMPATIBILITY_QUESTIONS, getCompatibilityLabel, getQuizSession, startCompatibilityQuiz, submitQuizAnswers } from '../utils/compatibilityQuiz';
import { logger } from '../utils/logger';

interface QuizResult { score: number; categoryScores: Record<string, number>; }

export default function CompatibilityQuizScreen() {
  const router = useRouter();
  const { chatId, matchId, matchName, quizId: existingQuizId } = useLocalSearchParams<{
    chatId: string; matchId: string; matchName: string; quizId?: string;
  }>();

  const [loading, setLoading]               = useState(true);
  const [quizId, setQuizId]                 = useState<string | null>(existingQuizId ?? null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers]               = useState<Record<number, string>>({});
  const [submitting, setSubmitting]         = useState(false);
  const [waitingForMatch, setWaitingForMatch] = useState(false);
  const [quizResult, setQuizResult]         = useState<QuizResult | null>(null);

  const user = auth.currentUser;
  const initRan = useRef(false);

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    void initQuiz();
  }, []);

  const initQuiz = async () => {
    try {
      if (existingQuizId) {
        const session = await getQuizSession(existingQuizId);
        if (session) {
          const isPlayer1 = session.player1Id === user?.uid;
          const myCompleted = isPlayer1 ? session.player1Completed : session.player2Completed;
          if (myCompleted && session.compatibilityScore !== null) {
            setQuizResult({ score: session.compatibilityScore, categoryScores: session.categoryScores as Record<string, number> });
          } else if (myCompleted) {
            setWaitingForMatch(true);
          }
        }
        setQuizId(existingQuizId);
      } else {
        const result = await startCompatibilityQuiz(chatId, matchId);
        if (result.success && result.quizId) setQuizId(result.quizId);
      }
    } catch (error) {
      logger.error('[Quiz] init error:', error);
      Alert.alert('Error', 'Could not load quiz.');
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = (answer: string) => {
    const q = COMPATIBILITY_QUESTIONS[currentQuestion];
    setAnswers(prev => ({ ...prev, [q.id]: answer }));
    if (currentQuestion < COMPATIBILITY_QUESTIONS.length - 1) setCurrentQuestion(prev => prev + 1);
  };

  const handleSubmit = async () => {
    if (!quizId) return;
    setSubmitting(true);
    try {
      const result = await submitQuizAnswers(quizId, answers);
      if (result.bothCompleted && result.score !== undefined) {
        const session = await getQuizSession(quizId);
        setQuizResult({ score: result.score, categoryScores: (session?.categoryScores ?? {}) as Record<string, number> });
      } else {
        setWaitingForMatch(true);
      }
    } catch (error) {
      logger.error('[Quiz] submit error:', error);
      Alert.alert('Error', 'Failed to submit your answers. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const isComplete = Object.keys(answers).length === COMPATIBILITY_QUESTIONS.length;
  const question   = COMPATIBILITY_QUESTIONS[currentQuestion];

  if (loading) return (
    <View style={s.container}>
      <ActivityIndicator size="large" color="#53a8b6" />
      <Text style={s.loadingText}>Loading quiz...</Text>
    </View>
  );

  if (quizResult) {
    const { label, emoji, color } = getCompatibilityLabel(quizResult.score);
    return (
      <ScrollView style={s.container} contentContainerStyle={s.resultContent}>
        <Text style={s.resultEmoji}>{emoji}</Text>
        <Text style={s.resultTitle}>{label}</Text>
        <View style={s.scoreCircle}>
          <Text style={[s.scoreNumber, { color }]}>{quizResult.score}%</Text>
          <Text style={s.scoreLabel}>Compatibility</Text>
        </View>
        <Text style={s.categoriesTitle}>Category Breakdown</Text>
        <View style={s.categoriesContainer}>
          {Object.entries(quizResult.categoryScores).map(([category, score]) => (
            <View key={category} style={s.categoryRow}>
              <Text style={s.categoryName}>{category.charAt(0).toUpperCase() + category.slice(1)}</Text>
              <View style={s.categoryBarContainer}>
                <View style={[s.categoryBar, { width: `${score}%` }]} />
              </View>
              <Text style={s.categoryScore}>{score}%</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={s.doneButton} onPress={() => router.back()}>
          <Text style={s.doneButtonText}>Back to Chat</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (waitingForMatch) return (
    <View style={s.container}>
      <Text style={s.waitingEmoji}>⏳</Text>
      <Text style={s.waitingTitle}>Quiz Submitted!</Text>
      <Text style={s.waitingText}>Waiting for {matchName} to complete their answers...</Text>
      <Text style={s.waitingSubtext}>You'll both see the results once complete!</Text>
      <TouchableOpacity style={s.backButton} onPress={() => router.back()}>
        <Text style={s.backButtonText}>Back to Chat</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Close quiz" accessibilityRole="button">
          <Text style={s.closeButton}>✕</Text>
        </TouchableOpacity>
        <Text style={s.quizTitle}>💕 Compatibility Quiz</Text>
        <Text style={s.progress}>{currentQuestion + 1}/{COMPATIBILITY_QUESTIONS.length}</Text>
      </View>
      <View style={s.progressBar}>
        <View style={[s.progressFill, { width: `${((currentQuestion + 1) / COMPATIBILITY_QUESTIONS.length) * 100}%` }]} />
      </View>
      <View style={s.categoryBadge}>
        <Text style={s.categoryBadgeText}>{question.category.toUpperCase()}</Text>
      </View>
      <Text style={s.questionText}>{question.question}</Text>
      <ScrollView style={s.optionsScroll}>
        {question.options.map((option) => (
          <TouchableOpacity
            key={option}
            style={[s.optionButton, answers[question.id] === option && s.optionButtonSelected]}
            onPress={() => handleAnswer(option)}
            accessibilityLabel={option}
            accessibilityRole="button"
            accessibilityState={{ selected: answers[question.id] === option }}
          >
            <Text style={[s.optionText, answers[question.id] === option && s.optionTextSelected]}>{option}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={s.navContainer}>
        {currentQuestion > 0 && (
          <TouchableOpacity style={s.prevButton} onPress={() => setCurrentQuestion(prev => prev - 1)} accessibilityLabel="Previous question" accessibilityRole="button">
            <Text style={s.prevButtonText}>← Previous</Text>
          </TouchableOpacity>
        )}
        {isComplete && (
          <TouchableOpacity style={[s.submitButton, submitting && s.submitButtonDisabled]} onPress={handleSubmit} disabled={submitting} accessibilityLabel="Submit quiz" accessibilityRole="button">
            <Text style={s.submitButtonText}>{submitting ? 'Submitting...' : '✓ Submit Quiz'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  loadingText:          { color: '#aaa', marginTop: 15, textAlign: 'center' },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  closeButton:          { color: '#d9534f', fontSize: 24, fontWeight: 'bold' },
  quizTitle:            { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  progress:             { color: '#53a8b6', fontSize: 14 },
  progressBar:          { height: 6, backgroundColor: '#0f3460', borderRadius: 3, marginBottom: 25 },
  progressFill:         { height: '100%', backgroundColor: '#e67e22', borderRadius: 3 },
  categoryBadge:        { backgroundColor: '#9b59b6', alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 15, marginBottom: 20 },
  categoryBadgeText:    { color: '#fff', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  questionText:         { color: '#eee', fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 30, lineHeight: 32 },
  optionsScroll:        { flex: 1 },
  optionButton:         { backgroundColor: '#16213e', padding: 18, borderRadius: 12, marginBottom: 12, borderWidth: 2, borderColor: '#16213e' },
  optionButtonSelected: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  optionText:           { color: '#aaa', fontSize: 16, textAlign: 'center' },
  optionTextSelected:   { color: '#53a8b6', fontWeight: '600' },
  navContainer:         { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 15 },
  prevButton:           { padding: 12 },
  prevButtonText:       { color: '#888', fontSize: 16 },
  submitButton:         { backgroundColor: '#5cb85c', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25 },
  submitButtonDisabled: { backgroundColor: '#555' },
  submitButtonText:     { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultContent:        { alignItems: 'center', paddingTop: 60, paddingBottom: 40 },
  resultEmoji:          { fontSize: 80 },
  resultTitle:          { fontSize: 28, fontWeight: 'bold', color: '#eee', marginTop: 20 },
  scoreCircle:          { marginTop: 30, alignItems: 'center' },
  scoreNumber:          { fontSize: 72, fontWeight: 'bold' },
  scoreLabel:           { fontSize: 18, color: '#888', marginTop: 5 },
  categoriesTitle:      { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginTop: 40, marginBottom: 15 },
  categoriesContainer:  { width: '100%', paddingHorizontal: 20 },
  categoryRow:          { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  categoryName:         { width: 100, color: '#aaa', fontSize: 13 },
  categoryBarContainer: { flex: 1, height: 8, backgroundColor: '#0f3460', borderRadius: 4, marginHorizontal: 10 },
  categoryBar:          { height: '100%', backgroundColor: '#53a8b6', borderRadius: 4 },
  categoryScore:        { width: 40, color: '#eee', fontSize: 13, textAlign: 'right' },
  doneButton:           { backgroundColor: '#53a8b6', paddingVertical: 16, paddingHorizontal: 50, borderRadius: 25, marginTop: 40 },
  doneButtonText:       { color: '#fff', fontSize: 18, fontWeight: '600' },
  waitingEmoji:         { fontSize: 80, textAlign: 'center', marginTop: 100 },
  waitingTitle:         { fontSize: 28, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginTop: 20 },
  waitingText:          { fontSize: 16, color: '#888', textAlign: 'center', marginTop: 15 },
  waitingSubtext:       { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 10 },
  backButton:           { backgroundColor: '#0f3460', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25, marginTop: 40, alignSelf: 'center' },
  backButtonText:       { color: '#53a8b6', fontSize: 16, fontWeight: '600' },
});