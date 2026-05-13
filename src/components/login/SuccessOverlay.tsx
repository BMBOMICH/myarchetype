import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { getAnimDuration } from './utils';
import { s } from './styles';
import type { Tokens } from './types';

export const SuccessOverlay = React.memo(({ C, secondsLeft }: { C: Tokens; secondsLeft: number }) => {
  const opacity   = useSharedValue(0);
  const scale     = useSharedValue(0);
  const iconScale = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: getAnimDuration(200) });
    scale.value   = withSpring(1, { mass: 0.5, damping: 14, stiffness: 120 }, (finished) => {
      if (finished) iconScale.value = withSpring(1, { mass: 0.4, damping: 12, stiffness: 100 });
    });
    if (typeof window === 'undefined') {
      const { AccessibilityInfo } = require('react-native');
      AccessibilityInfo.announceForAccessibility('Login successful. Welcome back!');
    }
  }, [opacity, scale, iconScale]);

  const overlayStyle  = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle     = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const iconAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));

  const successOverlayStyle = useMemo(() => [s.successOverlay, { backgroundColor: C.overlay }, overlayStyle], [C.overlay, overlayStyle]);
  const successCardStyle    = useMemo(() => [s.successCard, { backgroundColor: C.card, borderColor: C.cardBorder }, cardStyle], [C.card, C.cardBorder, cardStyle]);
  const successIconCircleStyle = useMemo(() => [s.successIconCircle, { backgroundColor: C.successGlow }], [C.successGlow]);
  const successTitleStyle   = useMemo(() => [s.successTitle, { color: C.textPrimary }], [C.textPrimary]);
  const successSubStyle     = useMemo(() => [s.successSub, { color: C.textSecondary }], [C.textSecondary]);

  return (
    <Animated.View style={successOverlayStyle} pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="assertive">
      <Animated.View style={successCardStyle} accessibilityRole="alert">
        <Animated.View style={iconAnimStyle}>
          <View style={successIconCircleStyle}>
            <Ionicons name="checkmark-circle" size={56} color={C.success} />
          </View>
        </Animated.View>
        <Text style={successTitleStyle}>Welcome back!</Text>
        <Text style={successSubStyle}>Redirecting in {secondsLeft}…</Text>
        <ActivityIndicator size="small" color={C.accent} style={{ marginTop: 4 }} />
      </Animated.View>
    </Animated.View>
  );
});