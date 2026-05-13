import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { C } from '@/app/personality-quiz.data';
import type { Archetype, RelationshipDynamic } from '@/app/personality-quiz.data';

interface Props {
  arch:       Archetype;
  dynamic:    RelationshipDynamic;
  isSelf:     boolean;
  isExpanded: boolean;
  onToggle:   () => void;
}

export const CompatCard = React.memo(function CompatCard({
  arch, dynamic, isSelf, isExpanded, onToggle,
}: Props) {
  return (
    <View style={st.compatItem}>
      <TouchableOpacity
        style={[st.compatRow, isSelf && st.compatRowSelf]}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityLabel={`${arch.name}${isSelf ? ', your type' : ''}. ${dynamic.tagline}. Tap to ${isExpanded ? 'collapse' : 'expand'}.`}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
      >
        <Text style={st.compatEmoji}>{arch.emoji}</Text>
        <View style={st.compatInfo}>
          <Text style={st.compatName}>{arch.name}{isSelf ? ' (You)' : ''}</Text>
          <Text style={st.compatTagline}>{dynamic.tagline}</Text>
        </View>
        <Text style={st.compatChevron}>{isExpanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {isExpanded && (
        <View style={st.compatDetail}>
          <Text style={st.compatStrength}>✓ {dynamic.strength}</Text>
          <Text style={st.compatWatch}>△ {dynamic.watchOut}</Text>
          {dynamic.selfNote != null && <Text style={st.compatSelfNote}>{dynamic.selfNote}</Text>}
        </View>
      )}
    </View>
  );
});

const st = StyleSheet.create((theme) => ({
  compatItem:     { marginBottom: 4 },
  compatRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10 },
  compatRowSelf:  { backgroundColor: 'rgba(83,168,182,0.1)' },
  compatEmoji:    { fontSize: 24 },
  compatInfo:     { flex: 1 },
  compatName:     { color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  compatTagline:  { color: C.muted, fontSize: 12 },
  compatChevron:  { color: C.dim, fontSize: 12 },
  compatDetail:   { backgroundColor: C.cardHi, borderRadius: 10, padding: 12, marginTop: 4, gap: 8 },
  compatStrength: { color: C.success, fontSize: 13, lineHeight: 19 },
  compatWatch:    { color: C.warning, fontSize: 13, lineHeight: 19 },
  compatSelfNote: { color: C.accent, fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginTop: 4 },
}));