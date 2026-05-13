import React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { C } from '@/app/personality-quiz.data';

export const ChipList = React.memo(function ChipList({ items }: { items: readonly string[] }) {
  return (
    <View style={st.chipGrid}>
      {items.map(s => (
        <View key={s} style={st.chip}><Text style={st.chipText}>{s}</Text></View>
      ))}
    </View>
  );
});

const st = StyleSheet.create(() => ({
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:     { backgroundColor: C.input, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20 },
  chipText: { color: C.accent, fontSize: 13, fontWeight: '600' },
}));