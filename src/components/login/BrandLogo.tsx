import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { getAnimDuration, prefersReducedMotion } from './utils';
import { s } from './styles';
import type { Tokens } from './types';

export const BrandLogo = React.memo(({ C, paused }: { C: Tokens; paused: boolean }) => {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (prefersReducedMotion || paused) {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
      return;
    }

    let cancelled = false;
    const startAnim = () => {
      if (cancelled) return;
      scale.value = withRepeat(
        withSequence(
          withTiming(1.04, { duration: getAnimDuration(2400), easing: Easing.inOut(Easing.ease) }),
          withTiming(1,    { duration: getAnimDuration(2400), easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    };

    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(startAnim);
      return () => { cancelled = true; cancelIdleCallback(id); cancelAnimation(scale); };
    } else {
      const t = setTimeout(startAnim, 0);
      return () => { cancelled = true; clearTimeout(t); cancelAnimation(scale); };
    }
  }, [paused, scale]);

  const animStyle     = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const logoOuterStyle = useMemo(() => [s.logoOuter, animStyle], [animStyle]);
  const logoCircleStyle = useMemo(() => [s.logoCircle, { backgroundColor: C.accentGlow, borderColor: C.logoBorder }], [C.accentGlow, C.logoBorder]);

  return (
    <Animated.View style={logoOuterStyle} accessibilityElementsHidden importantForAccessibility="no">
      <View style={logoCircleStyle}>
        <Ionicons name="heart" size={38} color={C.accent} />
      </View>
    </Animated.View>
  );
});