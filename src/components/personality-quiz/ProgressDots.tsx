import React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { C } from '@/app/personality-quiz.data';

interface Props {
  total:         number;
  current:       number;
  answeredCount: number;
}

export const ProgressDots = React.memo(function ProgressDots({
  total, current, answeredCount,
}: Props) {
  return (
    <View
      style={st.dotsRow}
      accessibilityLabel={`Question ${current + 1} of ${total}`}
      accessibilityRole="progressbar"
    >
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[st.dot, i < answeredCount && st.dotDone, i === current && st.dotCur]} />
      ))}
    </View>
  );
}, (prev, next) => prev.current === next.current && prev.answeredCount === next.answeredCount);

const st = StyleSheet.create(() => ({
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 3, marginBottom: 10, flexWrap: 'wrap', paddingHorizontal: 8 },
  dot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: C.card },
  dotDone: { backgroundColor: C.success },
  dotCur:  { backgroundColor: C.accent, transform: [{ scale: 1.5 }] },
}));