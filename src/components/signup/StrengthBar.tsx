import React, { useEffect, useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { getAnimDuration, validators } from './utils';
import { s } from './styles';
import type { Tokens } from './types';

const REQ_ITEMS = [
  { key: 'length'    as const, label: 'At least 8 characters' },
  { key: 'uppercase' as const, label: 'One uppercase letter (A-Z)' },
  { key: 'lowercase' as const, label: 'One lowercase letter (a-z)' },
  { key: 'number'    as const, label: 'One number (0-9)' },
  { key: 'special'   as const, label: 'One special character (!@#$%^&*)' },
] as const;

const RequirementItem = React.memo(function RequirementItem({
  itemKey, label, met, C,
}: { itemKey: string; label: string; met: boolean; C: Tokens }) {
  const textStyle = useMemo(
    () => [s.requirementText, { color: met ? C.success : C.textMuted }, met && s.requirementMet],
    [met, C.success, C.textMuted],
  );
  return (
    <View key={itemKey} style={s.requirementRow}>
      <Ionicons name={met ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={met ? C.success : C.textMuted} style={s.requirementIcon} />
      <Text style={textStyle} allowFontScaling maxFontSizeMultiplier={1.2}>{label}</Text>
    </View>
  );
});

export const PasswordRequirements = React.memo(function PasswordRequirements({ password, C }: { password: string; C: Tokens }) {
  const opacity = useSharedValue(0);
  const v       = useMemo(() => validators.password(password), [password]);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: getAnimDuration(300) });
  }, [opacity]);

  const animStyle                  = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const requirementsContainerStyle = useMemo(() => [s.requirementsContainer, { backgroundColor: C.requirementsBg, borderColor: C.cardBorder }, animStyle], [C.requirementsBg, C.cardBorder, animStyle]);
  const requirementsTitleStyle     = useMemo(() => [s.requirementsTitle,     { color: C.textMuted }], [C.textMuted]);

  return (
    <Animated.View style={requirementsContainerStyle} accessibilityLiveRegion="polite">
      <Text style={requirementsTitleStyle} allowFontScaling maxFontSizeMultiplier={1.2}>Password must include:</Text>
      {REQ_ITEMS.map(item => (
        <RequirementItem key={item.key} itemKey={item.key} label={item.label} met={v.checks[item.key]} C={C} />
      ))}
    </Animated.View>
  );
});