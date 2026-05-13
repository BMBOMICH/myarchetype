import React, { useMemo } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { MAX_FONT_SCALE } from './types';

interface PromptCardProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  variant: 'purple' | 'orange';
  reducedMotion: boolean;
  index: number;
  a11yLabel: string;
  a11yHint?: string;
  rightContent?: React.ReactNode;
}

export const PromptCard = React.memo(function PromptCard({
  icon, title, subtitle, onPress, variant,
  reducedMotion, index, a11yLabel, a11yHint, rightContent,
}: PromptCardProps) {
  const cardStyle  = variant === 'purple' ? styles.cardPurple  : styles.cardOrange;
  const titleStyle = variant === 'purple' ? styles.titlePurple : styles.titleOrange;
  const arrowStyle = variant === 'purple' ? styles.arrowPurple : styles.arrowOrange;

  const composedCardStyle  = useMemo(() => [styles.card, cardStyle],  [cardStyle]);
  const composedTitleStyle = useMemo(() => [styles.title, titleStyle], [titleStyle]);
  const composedArrowStyle = useMemo(() => [styles.arrow, arrowStyle], [arrowStyle]);

  const content = (
    <TouchableOpacity
      style={composedCardStyle}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={a11yHint ?? `Double tap to open ${title}`}
    >
      <View style={styles.left}>
        <Text style={styles.icon} accessibilityElementsHidden>{icon}</Text>
        <View style={styles.textWrap}>
          <Text style={composedTitleStyle} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            {title}
          </Text>
          <Text style={styles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            {subtitle}
          </Text>
        </View>
      </View>
      {rightContent ?? (
        <Text style={composedArrowStyle} accessibilityElementsHidden>→</Text>
      )}
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
  fullWidth:   { width: '100%' },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: theme.radius.lg, padding: theme.spacing.lg,
    width: '100%', marginBottom: theme.spacing.lg,
    borderWidth: 2, minHeight: 48, backgroundColor: theme.colors.surface,
  },
  cardPurple:  { borderColor: theme.colors.purple },
  cardOrange:  { borderColor: theme.colors.orange },
  left:        { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, flex: 1 },
  textWrap:    { flex: 1 },
  icon:        { fontSize: 28 },
  title:       { fontSize: 16, fontWeight: 'bold' },
  titlePurple: { color: theme.colors.purple },
  titleOrange: { color: theme.colors.orange },
  sub:         { fontSize: 13, color: theme.colors.textSecondary },
  arrow:       { fontSize: 20 },
  arrowPurple: { color: theme.colors.purple },
  arrowOrange: { color: theme.colors.orange },
}));