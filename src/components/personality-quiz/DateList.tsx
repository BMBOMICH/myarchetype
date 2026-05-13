import React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { C } from '@/app/personality-quiz.data';

export const DateList = React.memo(function DateList({ items }: { items: readonly string[] }) {
  return (
    <>
      {items.map((d, i) => (
        <View key={`${d}-${i}`} style={st.dateRow}>
          <Text style={st.dateNum}>{i + 1}</Text>
          <Text style={st.secBody}>{d}</Text>
        </View>
      ))}
    </>
  );
});

const st = StyleSheet.create((theme) => ({
  dateRow: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  dateNum: { color: C.accent, fontSize: 14, fontWeight: 'bold', width: 20, textAlign: 'center', marginTop: 2 },
  secBody: { fontSize: 14, color: theme.colors.textSecondary, lineHeight: 21, flex: 1 },
}));