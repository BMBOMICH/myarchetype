import React, { useCallback } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { C } from '@/app/personality-quiz.data';
import type { AnswerOption, AnswerScore } from '@/app/personality-quiz.data';
import type { QUESTIONS } from '@/app/personality-quiz.data';

interface Props {
  option:      AnswerOption;
  question:    typeof QUESTIONS[number];
  traitColor:  string;
  isSelected:  boolean;
  onAnswer:    (score: AnswerScore) => void;
  disabled:    boolean;
}

export const AnswerButton = React.memo(function AnswerButton({
  option, question, traitColor, isSelected, onAnswer, disabled,
}: Props) {
  const handlePress  = useCallback(() => onAnswer(option.score), [onAnswer, option.score]);
  const isMiddle     = option.side === 'neutral';
  const displayLabel = isMiddle ? 'It Depends' : (option.id === 0 || option.id === 4) ? 'Strongly' : 'Somewhat';
  const label        = isMiddle
    ? 'Neither — it depends on the situation'
    : option.side === 'A'
      ? `${displayLabel} agree: ${question.sideA}`
      : `${displayLabel} agree: ${question.sideB}`;

  return (
    <TouchableOpacity
      style={[st.optBtn, isSelected && st.optBtnSel, isMiddle && st.optBtnMid, isSelected && { borderColor: traitColor }]}
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected, disabled }}
    >
      <Text style={st.optEmoji}>{option.emoji}</Text>
      <Text style={[st.optLabel, isSelected && st.optLabelSel, isMiddle && st.optLabelMid]} numberOfLines={2}>
        {displayLabel}
      </Text>
    </TouchableOpacity>
  );
});

const st = StyleSheet.create((theme) => ({
  optBtn:      { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, paddingVertical: 10, paddingHorizontal: 3, borderRadius: 12, borderWidth: 2, borderColor: 'transparent', minHeight: 66 },
  optBtnSel:   { backgroundColor: C.cardHi },
  optBtnMid:   { backgroundColor: 'rgba(83,168,182,0.08)', borderColor: C.input },
  optEmoji:    { fontSize: 16, marginBottom: 2 },
  optLabel:    { color: C.muted, fontSize: 10, textAlign: 'center' },
  optLabelSel: { color: theme.colors.text, fontWeight: 'bold' },
  optLabelMid: { color: C.accent },
}));