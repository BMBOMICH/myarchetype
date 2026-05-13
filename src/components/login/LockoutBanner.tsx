import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { s } from './styles';
import type { Tokens } from './types';

export const LockoutBanner = React.memo(({ seconds, C }: { seconds: number; C: Tokens }) => {
  const bannerStyle  = useMemo(() => [s.lockoutBanner, { backgroundColor: C.errorGlow, borderColor: C.error }], [C.errorGlow, C.error]);
  const lockoutStyle = useMemo(() => [s.lockoutText, { color: C.error }], [C.error]);
  const boldStyle    = useMemo(() => ({ fontWeight: '800' as const }), []);

  if (!seconds) return null;
  return (
    <View style={bannerStyle} accessibilityLiveRegion="polite">
      <Ionicons name="time-outline" size={16} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={lockoutStyle}>
        Too many attempts — try again in <Text style={boldStyle}>{seconds}s</Text>
      </Text>
    </View>
  );
});