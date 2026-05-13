import React, { useMemo } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import type { ProfileStrengthResult } from '../../utils/profileStrength';
import { MAX_FONT_SCALE } from './types';

const strengthEmoji = (score: number) =>
  score >= 90 ? '💪🔥' : score >= 80 ? '💪' : score >= 60 ? '👍' : score >= 40 ? '🔨' : '🚧';

interface StrengthCardProps {
  profileStrength: ProfileStrengthResult;
  onPress: () => void;
  reducedMotion: boolean;
  index: number;
}

export const StrengthCard = React.memo(function StrengthCard({
  profileStrength, onPress, reducedMotion, index,
}: StrengthCardProps) {
  const score = profileStrength.score;

  const barFillStyle = useMemo(() => ({ width: `${score}%` as `${number}%` }), [score]);

  const scoreStyle = useMemo(() => [
    styles.score,
    score >= 80 ? styles.scoreSuccess
      : score >= 60 ? styles.scoreOrange
      : score >= 40 ? styles.scoreGold
      : styles.scoreDanger,
  ], [score]);

  const barStyle = useMemo(() => [
    styles.barFill,
    barFillStyle,
    score >= 80 ? styles.barSuccess
      : score >= 60 ? styles.barOrange
      : score >= 40 ? styles.barGold
      : styles.barDanger,
  ], [score, barFillStyle]);

  const content = (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Profile strength ${score}%. ${profileStrength.label}. Tap to edit profile.`}
      accessibilityHint="Double tap to open profile editor"
    >
      <View style={styles.header}>
        <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
          {strengthEmoji(score)} Profile Strength
        </Text>
        <Text style={scoreStyle} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
          {score}%
        </Text>
      </View>
      <View
        style={styles.barBg}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: score, text: `${score}%` }}
      >
        <View style={barStyle} importantForAccessibility="no" />
      </View>
      <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        {profileStrength.label}
      </Text>
      {(profileStrength.suggestions?.length ?? 0) > 0 && score < 100 && (
        <View style={styles.suggestions} importantForAccessibility="no">
          <Text style={styles.suggestionsTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            💡 Tips to improve:
          </Text>
          {(profileStrength.suggestions ?? []).slice(0, 2).map((tip) => (
            <Text key={tip} style={styles.suggestionText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              • {tip}
            </Text>
          ))}
          <Text style={styles.tapHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Tap to edit profile →
          </Text>
        </View>
      )}
      {score >= 100 && (
        <View style={styles.perfectWrap} importantForAccessibility="no">
          <Text style={styles.perfectText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            🎉 Your profile is perfect!
          </Text>
        </View>
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
  fullWidth: { width: '100%' },
  card: {
    borderRadius: theme.radius.lg, padding: theme.spacing.lg,
    width: '100%', marginBottom: theme.spacing.lg,
    borderWidth: 2, backgroundColor: theme.colors.surface, borderColor: theme.colors.primary,
  },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md },
  title:        { fontSize: 16, fontWeight: 'bold', color: theme.colors.text },
  score:        { fontSize: 28, fontWeight: 'bold' },
  scoreSuccess: { color: theme.colors.success },
  scoreOrange:  { color: theme.colors.orange },
  scoreGold:    { color: theme.colors.gold },
  scoreDanger:  { color: theme.colors.danger },
  barBg:        { height: 10, borderRadius: theme.radius.sm, overflow: 'hidden', marginBottom: 10, backgroundColor: theme.colors.border },
  barFill:      { height: '100%', borderRadius: theme.radius.sm },
  barSuccess:   { backgroundColor: theme.colors.success },
  barOrange:    { backgroundColor: theme.colors.orange },
  barGold:      { backgroundColor: theme.colors.gold },
  barDanger:    { backgroundColor: theme.colors.danger },
  label:            { fontSize: 14, textAlign: 'center', marginBottom: theme.spacing.sm, color: theme.colors.textSecondary },
  suggestions:      { borderTopWidth: 1, paddingTop: theme.spacing.md, marginTop: theme.spacing.xs, borderTopColor: theme.colors.border },
  suggestionsTitle: { fontSize: 13, marginBottom: theme.spacing.sm, fontWeight: '600', color: theme.colors.primary },
  suggestionText:   { fontSize: 13, marginBottom: theme.spacing.xs, lineHeight: 18, color: theme.colors.textSecondary },
  tapHint:          { fontSize: 12, marginTop: theme.spacing.sm, fontStyle: 'italic', textAlign: 'right', color: theme.colors.primary },
  perfectWrap:      { alignItems: 'center', marginTop: theme.spacing.xs },
  perfectText:      { fontSize: 14, fontWeight: '600', color: theme.colors.success },
}));