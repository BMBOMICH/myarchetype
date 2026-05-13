import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from '../../../utils/worklets';
import { IS_WEB } from './constants';
import { getAnimDuration } from './utils';
import { s } from './styles';
import type { Tokens } from './types';

export const SuccessOverlay = React.memo(function SuccessOverlay({ C }: { C: Tokens }) {
  const overlayOpacity = useSharedValue(0);
  const cardScale      = useSharedValue(0);
  const iconScale      = useSharedValue(0);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const cardStyle    = useAnimatedStyle(() => ({ transform: [{ scale: cardScale.value }] }));
  const iconStyle    = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));

  useEffect(() => {
    overlayOpacity.value = withTiming(1, { duration: getAnimDuration(200) });
    cardScale.value      = withSpring(1, { speed: 14, damping: 8 });
    iconScale.value      = withDelay(getAnimDuration(150), withSpring(1, { speed: 10, damping: 6 }));
    if (!IS_WEB) scheduleOnRN(() => {
      const { AccessibilityInfo } = require('react-native');
      AccessibilityInfo.announceForAccessibility('Account created successfully!');
    });
  }, [overlayOpacity, cardScale, iconScale]);

  const successOverlayStyle    = useMemo(() => [s.successOverlay,    { backgroundColor: C.overlay },                                overlayStyle], [C.overlay, overlayStyle]);
  const successCardStyle       = useMemo(() => [s.successCard,       { backgroundColor: C.card, borderColor: C.cardBorder },        cardStyle],    [C.card, C.cardBorder, cardStyle]);
  const successIconCircleStyle = useMemo(() => [s.successIconCircle, { backgroundColor: C.successGlow }],                          [C.successGlow]);
  const successTitleStyle      = useMemo(() => [s.successTitleText,  { color: C.textPrimary }],                                     [C.textPrimary]);
  const successSubStyle        = useMemo(() => [s.successSub,        { color: C.textSecondary }],                                   [C.textSecondary]);

  return (
    <Animated.View style={successOverlayStyle} pointerEvents="box-only" accessibilityViewIsModal accessibilityLiveRegion="assertive">
      <Animated.View style={successCardStyle} accessibilityRole="alert">
        <Animated.View style={iconStyle}>
          <View style={successIconCircleStyle}>
            <Ionicons name="checkmark-circle" size={56} color={C.success} />
          </View>
        </Animated.View>
        <Text style={successTitleStyle}>Account Created!</Text>
        <Text style={successSubStyle}>Check your email to verify your account.</Text>
        <ActivityIndicator size="small" color={C.accent} style={s.successSpinner} />
      </Animated.View>
    </Animated.View>
  );
});