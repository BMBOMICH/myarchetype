import React from 'react';
import { Platform, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { MAX_FONT_SCALE } from './types';

export const OfflineBanner = React.memo(function OfflineBanner() {
  const inner = (
    <View
      style={styles.banner}
      accessibilityRole="alert"
      accessibilityLabel="You are offline. Some features may not work."
      accessibilityLiveRegion="assertive"
    >
      <Text style={styles.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        📡 You're offline — some features may be unavailable
      </Text>
    </View>
  );
  if (Platform.OS !== 'web') {
    return <Animated.View entering={FadeInUp.duration(300)}>{inner}</Animated.View>;
  }
  return inner;
});

const styles = StyleSheet.create((theme) => ({
  banner: {
    width:             '100%',
    paddingVertical:   theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius:      theme.radius.md,
    marginBottom:      theme.spacing.lg,
    alignItems:        'center',
    backgroundColor:   theme.colors.danger,
  },
  text: {
    fontSize:   13,
    fontWeight: '600',
    textAlign:  'center',
    color:      theme.colors.white,
  },
}));