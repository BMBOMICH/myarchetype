import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import {
  getQuestionEmoji,
  getTodaysQuestion,
  hasAnsweredToday,
  saveUserAnswer,
} from '../utils/dailyQuestions';
import { logger } from '../utils/logger';

export default function DailyQuestionScreen() {
  const router    = useRouter();
  const isMounted = useRef(true);

  const [question,        setQuestion]        = useState(getTodaysQuestion);
  const [answer,          setAnswer]          = useState('');
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  void setQuestion;

  const checkIfAnswered = useCallback(async () => {
    try {
      const answered = await hasAnsweredToday();
      if (isMounted.current) setAlreadyAnswered(answered);
    } catch (error: unknown) {
      logger.error('[DailyQ] Load error:', error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void checkIfAnswered(); }, [checkIfAnswered]);

  const handleSubmit = useCallback(async () => {
    if (!answer.trim()) { Alert.alert('Wait', 'Please write an answer!'); return; }
    setSaving(true);
    try {
      const success = await saveUserAnswer(question.id, answer.trim());
      if (!isMounted.current) return;
      if (success) {
        Alert.alert(
          '✅ Answer saved!',
          'Your answer will appear on your profile for 24 hours.\n\nCome back tomorrow for a new question!',
        );
        router.back();
      } else {
        Alert.alert('Error', 'Failed to save answer. Please try again.');
      }
    } catch (error: unknown) {
      logger.error('[DailyQ] Submit error:', error);
      if (isMounted.current) Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      if (isMounted.current) setSaving(false);
    }
  }, [answer, question.id, router]);

  const onAnswerChange = useCallback((t: string) => setAnswer(t), []);
  const onSubmit       = useCallback(() => void handleSubmit(), [handleSubmit]);
  const onBack         = useCallback(() => router.back(), [router]);

  const submitBtnStyle = useMemo(
    () => [styles.submitButton, (!answer.trim() || saving) && styles.submitButtonDisabled],
    [answer, saving],
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  const emoji = getQuestionEmoji(question.category);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Daily Question</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.questionCard}>
        <Text style={styles.emoji}>{emoji}</Text>
        <Text style={styles.category}>{question.category.toUpperCase()}</Text>
        <Text style={styles.questionText}>{question.question}</Text>
      </View>

      {alreadyAnswered && (
        <View style={styles.alreadyAnsweredBanner}>
          <Text style={styles.alreadyAnsweredIcon}>✓</Text>
          <Text style={styles.alreadyAnsweredText}>
            You already answered today's question!{'\n'}Come back tomorrow for a new one.
          </Text>
        </View>
      )}

      <Text style={styles.label}>Your Answer</Text>
      <Text style={styles.hint}>
        Share your thoughts! Your answer will be visible on your profile for 24 hours.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Type your answer here..."
        placeholderTextColor="#666"
        value={answer}
        onChangeText={onAnswerChange}
        multiline
        maxLength={200}
        editable={!saving}
        autoFocus={!alreadyAnswered}
        accessibilityLabel="Answer input"
      />
      <Text style={styles.charCount}>{answer.length}/200</Text>

      <TouchableOpacity
        style={submitBtnStyle}
        onPress={onSubmit}
        disabled={!answer.trim() || saving}
        accessibilityLabel={alreadyAnswered ? 'Update answer' : 'Submit answer'}
        accessibilityRole="button"
        accessibilityState={{ disabled: !answer.trim() || saving, busy: saving }}
      >
        <Text style={styles.submitButtonText}>
          {saving ? 'Saving...' : alreadyAnswered ? '🔄 Update Answer' : '✓ Submit Answer'}
        </Text>
      </TouchableOpacity>

      {!alreadyAnswered && (
        <TouchableOpacity
          style={styles.skipButton}
          onPress={onBack}
          disabled={saving}
          accessibilityLabel="Skip for today"
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
        >
          <Text style={styles.skipButtonText}>Skip for Today</Text>
        </TouchableOpacity>
      )}

      <View style={styles.infoCard}>
        <Text style={styles.infoIcon}>ℹ️</Text>
        <View style={styles.infoTextContainer}>
          <Text style={styles.infoTitle}>How it works:</Text>
          <Text style={styles.infoText}>
            {'• A new question appears every day\n'}
            {'• Your answer shows on your profile for 24 hours\n'}
            {'• Great conversation starter for matches!\n'}
            {'• Come back tomorrow for a new question'}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  container:             { flex: 1, backgroundColor: theme.colors.background },
  content:               { padding: 20, paddingBottom: 40 },

  header:                { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 30, marginBottom: 20 },
  backButton:            { color: theme.colors.primary, fontSize: 16 },
  headerTitle:           { fontSize: 20, fontWeight: 'bold', color: theme.colors.text },
  headerSpacer:          { width: 60 },

  questionCard:          { backgroundColor: theme.colors.surface, borderRadius: 20, padding: 25, alignItems: 'center', marginBottom: 20, borderWidth: 2, borderColor: theme.colors.primary },
  emoji:                 { fontSize: 50, marginBottom: 10 },
  category:              { color: theme.colors.primary, fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: 15 },
  questionText:          { color: theme.colors.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center', lineHeight: 28 },

  alreadyAnsweredBanner: { flexDirection: 'row', backgroundColor: '#1a5c3a', borderRadius: 15, padding: 15, marginBottom: 20, alignItems: 'center' },
  alreadyAnsweredIcon:   { fontSize: 24, marginRight: 12 },
  alreadyAnsweredText:   { color: '#5cb85c', fontSize: 13, flex: 1, lineHeight: 20 },

  label:                 { fontSize: 16, fontWeight: '600', color: theme.colors.text, marginBottom: 8 },
  hint:                  { fontSize: 13, color: theme.colors.textSecondary, marginBottom: 12, lineHeight: 18 },

  input:                 { backgroundColor: theme.colors.surface, color: theme.colors.text, padding: 15, borderRadius: 12, fontSize: 16, minHeight: 120, textAlignVertical: 'top', borderWidth: 1, borderColor: theme.colors.border },
  charCount:             { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 5, marginBottom: 20 },

  submitButton:          { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginBottom: 10 },
  submitButtonDisabled:  { backgroundColor: '#555' },
  submitButtonText:      { color: '#ffffff', fontSize: 18, fontWeight: '600' },

  skipButton:            { paddingVertical: 12, alignItems: 'center', marginBottom: 30 },
  skipButtonText:        { color: theme.colors.textSecondary, fontSize: 16 },

  infoCard:              { flexDirection: 'row', backgroundColor: 'rgba(83, 168, 182, 0.1)', borderRadius: 15, padding: 15, borderWidth: 1, borderColor: 'rgba(83, 168, 182, 0.3)' },
  infoIcon:              { fontSize: 24, marginRight: 12 },
  infoTextContainer:     { flex: 1 },
  infoTitle:             { color: theme.colors.primary, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  infoText:              { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
}));