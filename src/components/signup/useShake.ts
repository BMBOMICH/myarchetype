import { useCallback } from 'react';
import { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { prefersReducedMotion } from './utils';

export const useShake = () => {
  const translateX = useSharedValue(0);
  const shake = useCallback(() => {
    if (prefersReducedMotion) return;
    translateX.value = withSequence(
      withTiming( 10, { duration: 60 }),
      withTiming(-10, { duration: 60 }),
      withTiming(  8, { duration: 60 }),
      withTiming( -8, { duration: 60 }),
      withTiming(  4, { duration: 60 }),
      withTiming(  0, { duration: 60 }),
    );
  }, [translateX]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  return { shakeStyle, shake };
};