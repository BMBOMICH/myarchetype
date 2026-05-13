import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { triggerHaptic } from './utils';
import { s } from './styles';
import type { Tokens } from './types';

export const GradientButton = React.memo(function GradientButton({
  onPress, disabled, loading, label, C,
}: {
  onPress: () => void; disabled: boolean; loading: boolean; label: string; C: Tokens;
}) {
  const scale      = useSharedValue(1);
  const isDisabled = disabled || loading;

  const pressIn = useCallback(() => {
    if (!isDisabled) {
      scale.value = withSpring(0.97, { stiffness: 300, damping: 20 });
      void triggerHaptic('light');
    }
  }, [isDisabled, scale]);

  const pressOut = useCallback(() => {
    scale.value = withSpring(1, { stiffness: 300, damping: 20 });
  }, [scale]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const colors = useMemo(
    () => (isDisabled
      ? [C.disabledBg, C.disabledBg]
      : [C.buttonGradStart, C.buttonGradEnd]) as [string, string],
    [isDisabled, C],
  );

  const buttonOuterStyle       = useMemo(() => [s.buttonOuter, { shadowColor: isDisabled ? 'transparent' : C.accent }, animStyle], [isDisabled, C.accent, animStyle]);
  const buttonStyle            = useMemo(() => [s.button, isDisabled && s.buttonDisabled],                                         [isDisabled]);
  const buttonLoadingTextStyle = useMemo(() => [s.buttonText, s.buttonLoadingText],                                                []);
  const buttonTextStyle        = useMemo(() => [s.buttonText, isDisabled && { color: C.disabledText }],                             [isDisabled, C.disabledText]);

  return (
    <Animated.View style={buttonOuterStyle}>
      <Pressable
        onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
      >
        <View pointerEvents={isDisabled ? 'none' : 'auto'} style={s.gradientInner}>
          <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={buttonStyle}>
            {loading ? (
              <View style={s.buttonContent}>
                <ActivityIndicator color={C.white} size="small" />
                <Text style={buttonLoadingTextStyle}>Creating Account…</Text>
              </View>
            ) : (
              <View style={s.buttonContent}>
                <Text style={buttonTextStyle}>{label}</Text>
              </View>
            )}
          </LinearGradient>
        </View>
      </Pressable>
    </Animated.View>
  );
});