import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { s } from './styles';
import type { Tokens } from './types';

export const LockoutBanner = React.memo(function LockoutBanner({ seconds, C }: { seconds: number; C: Tokens }) {
  const lockoutBannerStyle = useMemo(() => [s.lockoutBanner, { backgroundColor: C.errorGlow, borderColor: C.error }], [C.errorGlow, C.error]);
  const lockoutTextStyle   = useMemo(() => [s.lockoutText,   { color: C.error }],                                     [C.error]);
  if (!seconds) return null;
  return (
    <View style={lockoutBannerStyle} accessibilityLiveRegion="polite">
      <Ionicons name="time-outline" size={16} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={lockoutTextStyle} allowFontScaling maxFontSizeMultiplier={1.2}>
        Too many attempts — try again in <Text style={s.lockoutBold}>{seconds}s</Text>
      </Text>
    </View>
  );
});