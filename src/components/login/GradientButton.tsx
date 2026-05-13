import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { IS_RTL } from './constants';
import { triggerHaptic } from './utils';
import { s } from './styles';
import type { Tokens } from './types';

export const GradientButton = React.memo(({ onPress, disabled, loading, label, C }: {
  onPress: () => void; disabled: boolean; loading: boolean; label: string; C: Tokens;
}) => {
  const scale      = useSharedValue(1);
  const isDisabled = disabled || loading;

  const handlePressIn = useCallback(() => {
    if (isDisabled) return;
    scale.value = withSpring(0.97, { mass: 0.3, damping: 20 });
    void triggerHaptic('light');
  }, [scale, isDisabled]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { mass: 0.3, damping: 20 });
  }, [scale]);

  const animStyle  = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const gradColors = useMemo(
    () => (isDisabled ? [C.disabledBg, C.disabledBg] : [C.buttonGradStart, C.buttonGradEnd]) as [string, string],
    [isDisabled, C],
  );

  const buttonOuterStyle = useMemo(() => [s.buttonOuter, { shadowColor: isDisabled ? 'transparent' : C.accent }, animStyle], [isDisabled, C.accent, animStyle]);
  const buttonStyle     = useMemo(() => [s.button, isDisabled && s.buttonDisabled], [isDisabled]);
  const buttonTextStyle = useMemo(() => [s.buttonText, isDisabled && { color: C.disabledText }], [isDisabled, C.disabledText]);

  return (
    <Animated.View style={buttonOuterStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
      >
        <View pointerEvents={isDisabled ? 'none' : 'auto'} style={s.gradientButtonInner}>
          <LinearGradient colors={gradColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={buttonStyle}>
            {loading ? <ActivityIndicator color={C.white} size="small" /> : (
              <View style={s.buttonContent}>
                <Text style={buttonTextStyle}>{label}</Text>
                <Ionicons name={IS_RTL ? 'arrow-back' : 'arrow-forward'} size={18} color={isDisabled ? C.disabledText : C.white} accessibilityElementsHidden importantForAccessibility="no" />
              </View>
            )}
          </LinearGradient>
        </View>
      </Pressable>
    </Animated.View>
  );
});