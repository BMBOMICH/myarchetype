import { LegendList, type LegendListRenderItemProps } from '@legendapp/list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { auth } from '../firebaseConfig';
import {
  COMPATIBILITY_QUESTIONS, getCompatibilityLabel, getQuizSession,
  startCompatibilityQuiz, submitQuizAnswers,
} from '../utils/compatibilityQuiz';
import { logger } from '../utils/logger';

interface QuizResult { score: number; categoryScores: Record<string, number> }
interface CategoryRow { category: string; score: number }
type Step = 'loading' | 'question' | 'submitting' | 'waiting' | 'result';
interface QuizState {
  step: Step; quizId: string | null; currentQuestion: number;
  answers: Record<number, string>; quizResult: QuizResult | null; error: string | null;
}
type QuizAction =
  | { type: 'SET_QUIZ_ID';    payload: string }
  | { type: 'SET_ANSWER';     payload: { questionId: number; answer: string } }
  | { type: 'NEXT_QUESTION' } | { type: 'PREV_QUESTION' }
  | { type: 'SET_STEP';       payload: Step }
  | { type: 'SET_RESULT';     payload: QuizResult }
  | { type: 'SET_ERROR';      payload: string };

function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'SET_QUIZ_ID':    return { ...state, quizId: action.payload, step: 'question' };
    case 'SET_ANSWER': {
      const newAnswers = { ...state.answers, [action.payload.questionId]: action.payload.answer };
      const nextIndex  = state.currentQuestion < COMPATIBILITY_QUESTIONS.length - 1 ? state.currentQuestion + 1 : state.currentQuestion;
      return { ...state, answers: newAnswers, currentQuestion: nextIndex };
    }
    case 'NEXT_QUESTION': return { ...state, currentQuestion: Math.min(state.currentQuestion + 1, COMPATIBILITY_QUESTIONS.length - 1) };
    case 'PREV_QUESTION': return { ...state, currentQuestion: Math.max(state.currentQuestion - 1, 0) };
    case 'SET_STEP':      return { ...state, step: action.payload };
    case 'SET_RESULT':    return { ...state, quizResult: action.payload, step: 'result' };
    case 'SET_ERROR':     return { ...state, error: action.payload, step: 'question' };
    default:              return state;
  }
}

const scheduleIdleTask = (cb: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb); return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 100); return () => clearTimeout(id);
};

const CategoryRowItem = React.memo(function CategoryRowItem({ item }: LegendListRenderItemProps<CategoryRow>) {
  return (
    <View style={st.categoryRow}>
      <Text style={st.categoryName}>{item.category.charAt(0).toUpperCase() + item.category.slice(1)}</Text>
      <View style={st.categoryBarContainer}>
        <View style={[st.categoryBar, { width: `${item.score}%` as `${number}%` }]} />
      </View>
      <Text style={st.categoryScore}>{item.score}%</Text>
    </View>
  );
});

const OptionItem = React.memo(function OptionItem({ option, isSelected, onPress }: { option: string; isSelected: boolean; onPress: (option: string) => void }) {
  const handlePress = useCallback(() => onPress(option), [onPress, option]);
  return (
    <TouchableOpacity style={isSelected ? [st.optionButton, st.optionButtonSelected] : st.optionButton} onPress={handlePress} accessibilityLabel={option} accessibilityRole="button" accessibilityState={{ selected: isSelected }}>
      <Text style={isSelected ? [st.optionText, st.optionTextSelected] : st.optionText}>{option}</Text>
    </TouchableOpacity>
  );
});

export default function CompatibilityQuizScreen() {
  const router = useRouter();
  const { chatId, matchId, matchName, quizId: existingQuizId } = useLocalSearchParams<{ chatId: string; matchId: string; matchName: string; quizId?: string }>();
  const user = auth.currentUser;

  const [state, dispatch] = useReducer(quizReducer, {
    step: 'loading', quizId: existingQuizId ?? null, currentQuestion: 0,
    answers: {}, quizResult: null, error: null,
  } satisfies QuizState);

  const initRan   = useRef(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    return scheduleIdleTask(() => {
      void (async () => {
        try {
          if (existingQuizId) {
            const session = await getQuizSession(existingQuizId);
            if (!isMounted.current) return;
            if (session) {
              const isPlayer1   = session.player1Id === user?.uid;
              const myCompleted = isPlayer1 ? session.player1Completed : session.player2Completed;
              if (myCompleted && session.compatibilityScore !== null) {
                dispatch({ type: 'SET_RESULT', payload: { score: session.compatibilityScore, categoryScores: session.categoryScores as Record<string, number> } });
                return;
              } else if (myCompleted) {
                dispatch({ type: 'SET_STEP', payload: 'waiting' }); return;
              }
            }
            dispatch({ type: 'SET_QUIZ_ID', payload: existingQuizId });
          } else {
            const result = await startCompatibilityQuiz(chatId, matchId);
            if (!isMounted.current) return;
            if (result.success && result.quizId) dispatch({ type: 'SET_QUIZ_ID', payload: result.quizId });
          }
        } catch (error: unknown) {
          logger.error('[Quiz] init error:', error);
          Alert.alert('Error', 'Could not load quiz.');
        }
      })();
    });
  }, [existingQuizId, chatId, matchId, user?.uid]);

  const handleAnswer = useCallback((answer: string) => {
    const q = COMPATIBILITY_QUESTIONS[state.currentQuestion];
    if (!q) return;
    dispatch({ type: 'SET_ANSWER', payload: { questionId: q.id, answer } });
  }, [state.currentQuestion]);

  const handleSubmit = useCallback(async () => {
    if (!state.quizId) return;
    dispatch({ type: 'SET_STEP', payload: 'submitting' });
    try {
      const result = await submitQuizAnswers(state.quizId, state.answers);
      if (!isMounted.current) return;
      if (result.bothCompleted && result.score !== undefined) {
        let categoryScores: Record<string, number> = {};
        try {
          const session  = await getQuizSession(state.quizId);
          categoryScores = (session?.categoryScores ?? {}) as Record<string, number>;
        } catch (err: unknown) { logger.warn('[Quiz] Failed to fetch category scores:', err); }
        if (isMounted.current) dispatch({ type: 'SET_RESULT', payload: { score: result.score, categoryScores } });
      } else {
        if (isMounted.current) dispatch({ type: 'SET_STEP', payload: 'waiting' });
      }
    } catch (error: unknown) {
      logger.error('[Quiz] submit error:', error);
      if (isMounted.current) { Alert.alert('Error', 'Failed to submit your answers. Please try again.'); dispatch({ type: 'SET_ERROR', payload: 'Submit failed' }); }
    }
  }, [state.quizId, state.answers]);

  const onPrevQuestion = useCallback(() => dispatch({ type: 'PREV_QUESTION' }), []);
  const onSubmit       = useCallback(() => void handleSubmit(), [handleSubmit]);
  const onBack         = useCallback(() => router.back(), [router]);

  const isComplete        = Object.keys(state.answers).length === COMPATIBILITY_QUESTIONS.length;
  const question          = COMPATIBILITY_QUESTIONS[state.currentQuestion];
  const progressFillStyle = useMemo(() => [st.progressFill, { width: `${((state.currentQuestion + 1) / COMPATIBILITY_QUESTIONS.length) * 100}%` as `${number}%` }], [state.currentQuestion]);
  const submitBtnStyle    = useMemo(() => [st.submitButton, state.step === 'submitting' && st.submitButtonDisabled], [state.step]);

  const categoryRows = useMemo<CategoryRow[]>(
    () => state.quizResult ? Object.entries(state.quizResult.categoryScores).map(([category, score]) => ({ category, score: score as number })) : [],
    [state.quizResult],
  );

  const renderCategoryRow = useCallback((props: LegendListRenderItemProps<CategoryRow>) => <CategoryRowItem {...props} />, []);
  const renderOption      = useCallback(({ item }: LegendListRenderItemProps<string>) => (
    <OptionItem option={item} isSelected={question ? state.answers[question.id] === item : false} onPress={handleAnswer} />
  ), [question, state.answers, handleAnswer]);

  if (state.step === 'loading') return (
    <View style={st.container}>
      <ActivityIndicator size="large" color="#53a8b6" />
      <Text style={st.loadingText}>Loading quiz...</Text>
    </View>
  );

  if (state.step === 'result' && state.quizResult) {
    const { label, emoji, color } = getCompatibilityLabel(state.quizResult.score);
    return (
      <LegendList
        data={categoryRows} keyExtractor={(item) => item.category} renderItem={renderCategoryRow}
        recycleItems={true} estimatedItemSize={44} contentContainerStyle={st.resultContent}
        ListHeaderComponent={<>
          <Text style={st.resultEmoji}>{emoji}</Text>
          <Text style={st.resultTitle}>{label}</Text>
          <View style={st.scoreCircle}>
            <Text style={[st.scoreNumber, { color }]}>{state.quizResult.score}%</Text>
            <Text style={st.scoreLabel}>Compatibility</Text>
          </View>
          <Text style={st.categoriesTitle}>Category Breakdown</Text>
        </>}
        ListFooterComponent={
          <TouchableOpacity style={st.doneButton} onPress={onBack} accessibilityLabel="Back to chat" accessibilityRole="button">
            <Text style={st.doneButtonText}>Back to Chat</Text>
          </TouchableOpacity>
        }
      />
    );
  }

  if (state.step === 'waiting') return (
    <View style={st.container}>
      <Text style={st.waitingEmoji}>⏳</Text>
      <Text style={st.waitingTitle}>Quiz Submitted!</Text>
      <Text style={st.waitingText}>Waiting for {matchName} to complete their answers...</Text>
      <Text style={st.waitingSubtext}>You'll both see the results once complete!</Text>
      <TouchableOpacity style={st.backButton} onPress={onBack} accessibilityLabel="Back to chat" accessibilityRole="button">
        <Text style={st.backButtonText}>Back to Chat</Text>
      </TouchableOpacity>
    </View>
  );

  if (!question) return null;

  return (
    <View style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={onBack} accessibilityLabel="Close quiz" accessibilityRole="button">
          <Text style={st.closeButton}>✕</Text>
        </TouchableOpacity>
        <Text style={st.quizTitle}>💕 Compatibility Quiz</Text>
        <Text style={st.progress}>{state.currentQuestion + 1}/{COMPATIBILITY_QUESTIONS.length}</Text>
      </View>
      <View style={st.progressBar}><View style={progressFillStyle} /></View>
      <View style={st.categoryBadge}><Text style={st.categoryBadgeText}>{question.category.toUpperCase()}</Text></View>
      <Text style={st.questionText}>{question.question}</Text>
      <LegendList data={question.options} keyExtractor={(item) => item} renderItem={renderOption} recycleItems={false} estimatedItemSize={62} style={st.optionsScroll} scrollEnabled={question.options.length > 5} />
      <View style={st.navContainer}>
        {state.currentQuestion > 0 && (
          <TouchableOpacity style={st.prevButton} onPress={onPrevQuestion} accessibilityLabel="Previous question" accessibilityRole="button">
            <Text style={st.prevButtonText}>← Previous</Text>
          </TouchableOpacity>
        )}
        {isComplete && (
          <TouchableOpacity style={submitBtnStyle} onPress={onSubmit} disabled={state.step === 'submitting'} accessibilityLabel="Submit quiz" accessibilityRole="button" accessibilityState={{ disabled: state.step === 'submitting', busy: state.step === 'submitting' }}>
            <Text style={st.submitButtonText}>{state.step === 'submitting' ? 'Submitting...' : '✓ Submit Quiz'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create((theme) => ({
  container:            { flex: 1, backgroundColor: theme.colors.background, padding: 20 },
  loadingText:          { color: theme.colors.textSecondary, marginTop: 15, textAlign: 'center' },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  closeButton:          { color: theme.colors.danger, fontSize: 24, fontWeight: 'bold' },
  quizTitle:            { color: theme.colors.text, fontSize: 18, fontWeight: 'bold' },
  progress:             { color: '#53a8b6', fontSize: 14 },
  progressBar:          { height: 6, backgroundColor: '#0f3460', borderRadius: 3, marginBottom: 25 },
  progressFill:         { height: '100%', backgroundColor: theme.colors.orange, borderRadius: 3 },
  categoryBadge:        { backgroundColor: theme.colors.purple, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 15, marginBottom: 20 },
  categoryBadgeText:    { color: theme.colors.white, fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  questionText:         { color: theme.colors.text, fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 30, lineHeight: 32 },
  optionsScroll:        { flex: 1 },
  optionButton:         { backgroundColor: theme.colors.surface, padding: 18, borderRadius: 12, marginBottom: 12, borderWidth: 2, borderColor: theme.colors.surface },
  optionButtonSelected: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  optionText:           { color: theme.colors.textSecondary, fontSize: 16, textAlign: 'center' },
  optionTextSelected:   { color: '#53a8b6', fontWeight: '600' },
  navContainer:         { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 15 },
  prevButton:           { padding: 12 },
  prevButtonText:       { color: theme.colors.textMuted, fontSize: 16 },
  submitButton:         { backgroundColor: theme.colors.success, paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25 },
  submitButtonDisabled: { backgroundColor: theme.colors.textMuted },
  submitButtonText:     { color: theme.colors.white, fontSize: 16, fontWeight: '600' },
  resultContent:        { alignItems: 'center', paddingTop: 60, paddingBottom: 40, paddingHorizontal: 20 },
  resultEmoji:          { fontSize: 80 },
  resultTitle:          { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, marginTop: 20 },
  scoreCircle:          { marginTop: 30, alignItems: 'center' },
  scoreNumber:          { fontSize: 72, fontWeight: 'bold' },
  scoreLabel:           { fontSize: 18, color: theme.colors.textSecondary, marginTop: 5 },
  categoriesTitle:      { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginTop: 40, marginBottom: 15 },
  categoryRow:          { flexDirection: 'row', alignItems: 'center', marginBottom: 12, width: '100%' },
  categoryName:         { width: 100, color: theme.colors.textSecondary, fontSize: 13 },
  categoryBarContainer: { flex: 1, height: 8, backgroundColor: '#0f3460', borderRadius: 4, marginHorizontal: 10 },
  categoryBar:          { height: '100%', backgroundColor: '#53a8b6', borderRadius: 4 },
  categoryScore:        { width: 40, color: theme.colors.text, fontSize: 13, textAlign: 'right' },
  doneButton:           { backgroundColor: '#53a8b6', paddingVertical: 16, paddingHorizontal: 50, borderRadius: 25, marginTop: 40 },
  doneButtonText:       { color: theme.colors.white, fontSize: 18, fontWeight: '600' },
  waitingEmoji:         { fontSize: 80, textAlign: 'center', marginTop: 100 },
  waitingTitle:         { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center', marginTop: 20 },
  waitingText:          { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 15 },
  waitingSubtext:       { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', marginTop: 10 },
  backButton:           { backgroundColor: '#0f3460', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25, marginTop: 40, alignSelf: 'center' },
  backButtonText:       { color: '#53a8b6', fontSize: 16, fontWeight: '600' },
}));