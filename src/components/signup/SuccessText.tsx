import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { s } from './styles';
import type { Tokens } from './types';

export const SuccessText = React.memo(function SuccessText({
  message, C,
}: { message: string; C: Tokens }) {
  const successTextStyle = useMemo(() => [s.successTextMsg, { color: C.success }], [C.success]);
  if (!message) return null;
  return (
    <View style={s.successRow}>
      <Ionicons name="checkmark-circle" size={14} color={C.success} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={successTextStyle} allowFontScaling maxFontSizeMultiplier={1.3}>{message}</Text>
    </View>
  );
});