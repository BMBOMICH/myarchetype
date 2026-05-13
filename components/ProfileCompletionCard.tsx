import { observable } from '@legendapp/state';
import { observer } from '@legendapp/state/react';
import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, InteractionManager, Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { logger } from '../utils/logger';
import { calculateProfileStrength, getStrengthMessage, ProfileStrengthResult } from '../utils/profileStrength';

interface ProfileStrengthBarProps { onPress?: () => void; compact?: boolean; }

const bar$ = observable({
  loading:  true,
  strength: null as ProfileStrengthResult | null,
  error:    null as string | null,
});

export default observer(function ProfileStrengthBar({ onPress, compact = false }: ProfileStrengthBarProps) {
  const loading  = bar$.loading.get();
  const strength = bar$.strength.get();
  const error    = bar$.error.get();

  const loadStrength = useCallback(() => {
    const task = InteractionManager.runAfterInteractions(async () => {
      try {
        bar$.loading.set(true);
        bar$.error.set(null);
        bar$.strength.set(await calculateProfileStrength());
      } catch (err: unknown) {
        logger.error('[ProfileStrengthBar] Failed to load profile strength:', err);
        bar$.error.set('Could not load profile strength');
      } finally {
        bar$.loading.set(false);
      }
    });
    return task;
  }, []);

  useEffect(() => {
    const task = loadStrength();
    return () => task.cancel();
  }, [loadStrength]);

  const onRetry = useCallback(() => { loadStrength(); }, [loadStrength]);

  if (loading) return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color="#53a8b6" />
    </View>
  );

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          onPress={onRetry}
          accessibilityLabel="Retry loading profile strength"
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Tap to retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!strength) return null;

  const Container = onPress ? TouchableOpacity : View;

  // Computed styles that depend on runtime `strength`
  const compactPercentageStyle = [styles.compactPercentage, { color: strength.color }];
  const compactBarFillStyle    = [styles.barFill, { width: `${strength.percentage}%` as `${number}%`, backgroundColor: strength.color }];
  const levelBadgeStyle        = [styles.levelBadge,   { backgroundColor: strength.color }];
  const percentageStyle        = [styles.percentage,   { color: strength.color }];
  const barFillStyle           = [styles.barFill, { width: `${strength.percentage}%` as `${number}%`, backgroundColor: strength.color }];

  if (compact) {
    return (
      <Container
        style={styles.compactContainer}
        onPress={onPress}
        accessibilityLabel={`Profile strength: ${strength.percentage}%`}
        accessibilityRole={onPress ? 'button' : 'none'}
      >
        <View style={styles.compactHeader}>
          <Text style={styles.compactLabel}>Profile Strength</Text>
          <Text style={compactPercentageStyle}>{strength.percentage}%</Text>
        </View>
        <View style={styles.barContainer}>
          <View style={styles.barBackground}>
            <View style={compactBarFillStyle} />
          </View>
        </View>
      </Container>
    );
  }

  return (
    <Container
      style={styles.container}
      onPress={onPress}
      accessibilityLabel={`Profile strength: ${strength.level}, ${strength.percentage}%`}
      accessibilityRole={onPress ? 'button' : 'none'}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Profile Strength</Text>
        <View style={levelBadgeStyle}>
          <Text style={styles.levelText}>{strength.level}</Text>
        </View>
      </View>
      <View style={styles.scoreRow}>
        <Text style={styles.scoreText}>{strength.score} / {strength.maxScore} points</Text>
        <Text style={percentageStyle}>{strength.percentage}%</Text>
      </View>
      <View style={styles.barContainer}>
        <View style={styles.barBackground}>
          <View style={barFillStyle} />
        </View>
      </View>
      <Text style={styles.message}>{getStrengthMessage(strength.level)}</Text>
      {strength.recommendations.length > 0 && (
        <View style={styles.recommendations}>
          <Text style={styles.recommendationsTitle}>Quick wins:</Text>
          {strength.recommendations.map((rec, i) => (
            <Text key={i} style={styles.recommendationText}>• {rec}</Text>
          ))}
        </View>
      )}
    </Container>
  );
});

const styles = StyleSheet.create((theme) => ({
  container:            { backgroundColor: '#16213e', borderRadius: 15, padding: 15, borderWidth: 1, borderColor: '#0f3460' },
  compactContainer:     { backgroundColor: '#16213e', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#0f3460' },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  compactHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title:                { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  compactLabel:         { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  levelBadge:           { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  levelText:            { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  scoreRow:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  scoreText:            { color: theme.colors.textSecondary, fontSize: 13 },
  percentage:           { fontSize: 20, fontWeight: 'bold' },
  compactPercentage:    { fontSize: 16, fontWeight: 'bold' },
  barContainer:         { marginBottom: 12 },
  barBackground:        { height: 8, backgroundColor: '#0f3460', borderRadius: 4, overflow: 'hidden' },
  barFill:              { height: '100%', borderRadius: 4 },
  message:              { color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  recommendations:      { backgroundColor: '#0f3460', borderRadius: 10, padding: 12 },
  recommendationsTitle: { color: '#53a8b6', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  recommendationText:   { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4, lineHeight: 18 },
  errorText:            { color: theme.colors.error, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  retryText:            { color: '#53a8b6', fontSize: 13, textAlign: 'center', fontWeight: '600' },
}));