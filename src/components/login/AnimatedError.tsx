import React, { useEffect, useMemo } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { getAnimDuration } from './utils';
import { s } from './styles';
import type { Tokens, WebAriaProps } from './types';

export const AnimatedError = React.memo(({ message, inputId, C }: { message: string; inputId: string; C: Tokens }) => {
  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(-8);

  useEffect(() => {
    if (message) {
      opacity.value    = withSpring(1, { mass: 0.3, damping: 20 });
      translateY.value = withSpring(0, { mass: 0.3, damping: 20, stiffness: 180 });
      if (typeof window === 'undefined') {
        AccessibilityInfo.announceForAccessibility(message);
      }
    } else {
      opacity.value    = withTiming(0, { duration: getAnimDuration(150) });
      translateY.value = -8;
    }
  }, [message, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const errorRowStyle = useMemo(() => [s.errorRow, animStyle], [animStyle]);
  const errorTxtStyle = useMemo(() => [s.errorText, { color: C.error }], [C.error]);

  if (!message) return null;
  const webProps: WebAriaProps = typeof window !== 'undefined'
    ? { 'aria-live': 'assertive', 'aria-atomic': 'true', id: `${inputId}-error` }
    : {};
  return (
    <Animated.View style={errorRowStyle} accessibilityLiveRegion="assertive" {...webProps}>
      <Ionicons name="alert-circle" size={14} color={C.error} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={errorTxtStyle}>{message}</Text>
    </Animated.View>
  );
});