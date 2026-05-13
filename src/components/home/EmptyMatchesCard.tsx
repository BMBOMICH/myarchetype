import React from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { MAX_FONT_SCALE } from './types';

interface EmptyMatchesCardProps {
  onPress: () => void;
  reducedMotion: boolean;
  index: number;
}

export const EmptyMatchesCard = React.memo(function EmptyMatchesCard({
  onPress, reducedMotion, index,
}: EmptyMatchesCardProps) {
  const content = (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="No matches yet. Tap to start finding matches."
      accessibilityHint="Double tap to browse profiles"
    >
      <Text style={styles.emoji} accessibilityElementsHidden>💫</Text>
      <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        Start finding your match!
      </Text>
      <Text style={styles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        Swipe to discover people who are right for you
      </Text>
    </TouchableOpacity>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return (
      <Animated.View entering={FadeInDown.delay(index * 80).duration(400)} style={styles.fullWidth}>
        {content}
      </Animated.View>
    );
  }
  return <View style={styles.fullWidth}>{content}</View>;
});

const styles = StyleSheet.create((theme) => ({
  fullWidth: { width: '100%' },
  card: {
    borderRadius: theme.radius.lg, padding: theme.spacing.xxl,
    width: '100%', marginBottom: theme.spacing.lg,
    borderWidth: 2, alignItems: 'center',
    backgroundColor: theme.colors.surface, borderColor: theme.colors.primary,
  },
  emoji: { fontSize: 48, marginBottom: theme.spacing.sm },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: theme.spacing.xs, color: theme.colors.text },
  sub:   { fontSize: 14, textAlign: 'center', color: theme.colors.textSecondary },
}));