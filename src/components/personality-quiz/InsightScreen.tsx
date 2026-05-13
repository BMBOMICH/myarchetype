import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { C } from '@/app/personality-quiz.data';
import type { InsightCard } from '@/app/personality-quiz.data';

interface Props {
  card:       InsightCard;
  onContinue: () => void;
}

export const InsightScreen = React.memo(function InsightScreen({ card, onContinue }: Props) {
  return (
    <View style={st.insightWrap}>
      <Text style={st.insightEmoji}>{card.emoji}</Text>
      <Text style={st.insightTitle}>{card.title}</Text>
      <Text style={st.insightBody}>{card.body}</Text>
      <TouchableOpacity
        style={st.insightBtn}
        onPress={onContinue}
        activeOpacity={0.8}
        accessibilityLabel="Continue to next question"
        accessibilityRole="button"
      >
        <Text style={st.insightBtnText}>Continue →</Text>
      </TouchableOpacity>
    </View>
  );
});

const st = StyleSheet.create((theme) => ({
  insightWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  insightEmoji:   { fontSize: 60, marginBottom: 16 },
  insightTitle:   { fontSize: 22, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10, textAlign: 'center' },
  insightBody:    { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: 30, paddingHorizontal: 10 },
  insightBtn:     { backgroundColor: C.accent, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25 },
  insightBtnText: { color: C.white, fontSize: 16, fontWeight: '600' },
}));