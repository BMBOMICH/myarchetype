import React, { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ARCHETYPES, C, getRelationshipDynamic } from '@/app/personality-quiz.data';

export function CompatibilityExplorer({ userCode }: { userCode: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const types = useMemo(() =>
    Object.entries(ARCHETYPES)
      .map(([code, arch]) => ({ code, arch, dynamic: getRelationshipDynamic(userCode, code), isSelf: code === userCode }))
      .sort((a, b) => a.isSelf ? -1 : b.isSelf ? 1 : 0),
    [userCode],
  );

  const toggle = useCallback((code: string) => {
    setExpanded(prev => prev === code ? null : code);
  }, []);

  return (
    <View style={st.secCard}>
      <Text style={st.secTitle}>🔍 How You Connect With Different Types</Text>
      <Text style={st.explorerDisclaimer}>
        These reflect general tendencies — not rules. You know who you connect with better than any algorithm does.
      </Text>
      {types.map(({ code, arch, dynamic, isSelf }) => (
        <CompatCard
          key={code}
          arch={arch}
          dynamic={dynamic}
          isSelf={isSelf}
          isExpanded={expanded === code}
          onToggle={() => toggle(code)}
        />
      ))}
    </View>
  );
}

const st = StyleSheet.create((theme) => ({
  secCard:             { backgroundColor: C.card, borderRadius: 16, padding: 18, marginBottom: 14 },
  secTitle:            { fontSize: 17, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10 },
  explorerDisclaimer:  { color: C.muted, fontSize: 12, lineHeight: 18, marginBottom: 12, fontStyle: 'italic' },
}));