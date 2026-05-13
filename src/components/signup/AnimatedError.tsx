import React, { useEffect, useMemo } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from '../../../utils/worklets';
import { IS_WEB } from './constants';
import { getAnimDuration } from './utils';
import { s } from './styles';
import type { Tokens, WebAriaProps } from './types';

export const AnimatedError = React.memo(function AnimatedError({
  message, inputId, C,
}: { message: string; inputId: string; C: Tokens }) {
  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(-6);

  useEffect(() => {
    if (message) {
      opacity.value    = withSpring(1, { speed: 20, damping: 20 });
      translateY.value = withSpring(0, { speed: 20, damping: 10 });
      if (!IS_WEB) scheduleOnRN(() => AccessibilityInfo.announceForAccessibility(message));
    } else {
      opacity.value    = withTiming(0, { duration: getAnimDuration(150) });
      translateY.value = -6;
    }
  }, [message, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const errorRowStyle  = useMemo(() => [s.errorRow, animStyle],            [animStyle]);
  const errorTextStyle = useMemo(() => [s.errorText, { color: C.error }],  [C.error]);

  if (!message) return null;
  const webProps: WebAriaProps = IS_WEB
    ? { 'aria-live': 'assertive', 'aria-atomic': 'true', id: `${inputId}-error` }
    : {};
  return (
    <Animated.View style={errorRowStyle} accessibilityLiveRegion="assertive" {...webProps}>
      <Ionicons name="alert-circle" size={14} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={errorTextStyle} allowFontScaling maxFontSizeMultiplier={1.3}>{message}</Text>
    </Animated.View>
  );
});