import React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { C } from '@/app/personality-quiz.data';

interface Props {
  items:  readonly string[];
  bullet?: string;
  color?:  string;
}

export const BulletList = React.memo(function BulletList({
  items, bullet = '→', color = C.accent,
}: Props) {
  return (
    <>
      {items.map(item => (
        <View key={item} style={st.bulletRow}>
          <Text style={[st.bulletDot, { color }]}>{bullet}</Text>
          <Text style={st.secBody}>{item}</Text>
        </View>
      ))}
    </>
  );
});

const st = StyleSheet.create((theme) => ({
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'flex-start' },
  bulletDot: { fontSize: 14, fontWeight: 'bold', marginTop: 2, width: 16 },
  secBody:   { fontSize: 14, color: theme.colors.textSecondary, lineHeight: 21, flex: 1 },
}));