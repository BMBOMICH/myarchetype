import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    calculateProfileStrength,
    getStrengthMessage,
    ProfileStrengthResult,
} from '../utils/profileStrength';

interface ProfileStrengthBarProps {
  onPress?: () => void;
  compact?: boolean;
}

export default function ProfileStrengthBar({ onPress, compact = false }: ProfileStrengthBarProps) {
  const [loading, setLoading] = useState(true);
  const [strength, setStrength] = useState<ProfileStrengthResult | null>(null);

  useEffect(() => {
    loadStrength();
  }, []);

  const loadStrength = async () => {
    const result = await calculateProfileStrength();
    setStrength(result);
    setLoading(false);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color="#53a8b6" />
      </View>
    );
  }

  if (!strength) return null;

  const Container = onPress ? TouchableOpacity : View;

  if (compact) {
    return (
      <Container style={styles.compactContainer} onPress={onPress}>
        <View style={styles.compactHeader}>
          <Text style={styles.compactLabel}>Profile Strength</Text>
          <Text style={[styles.compactPercentage, { color: strength.color }]}>
            {strength.percentage}%
          </Text>
        </View>
        <View style={styles.barContainer}>
          <View style={styles.barBackground}>
            <View 
              style={[
                styles.barFill, 
                { width: `${strength.percentage}%`, backgroundColor: strength.color }
              ]} 
            />
          </View>
        </View>
      </Container>
    );
  }

  return (
    <Container style={styles.container} onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile Strength</Text>
        <View style={[styles.levelBadge, { backgroundColor: strength.color }]}>
          <Text style={styles.levelText}>{strength.level}</Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={styles.scoreText}>
          {strength.score} / {strength.maxScore} points
        </Text>
        <Text style={[styles.percentage, { color: strength.color }]}>
          {strength.percentage}%
        </Text>
      </View>

      <View style={styles.barContainer}>
        <View style={styles.barBackground}>
          <View 
            style={[
              styles.barFill, 
              { width: `${strength.percentage}%`, backgroundColor: strength.color }
            ]} 
          />
        </View>
      </View>

      <Text style={styles.message}>{getStrengthMessage(strength.level)}</Text>

      {strength.recommendations.length > 0 && (
        <View style={styles.recommendations}>
          <Text style={styles.recommendationsTitle}>Quick wins:</Text>
          {strength.recommendations.map((rec, index) => (
            <Text key={index} style={styles.recommendationText}>
              • {rec}
            </Text>
          ))}
        </View>
      )}
    </Container>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, borderWidth: 1, borderColor: '#0f3460' },
  compactContainer: { backgroundColor: '#16213e', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#0f3460' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  compactHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '600', color: '#eee' },
  compactLabel: { fontSize: 14, fontWeight: '600', color: '#eee' },
  levelBadge: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  levelText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  scoreText: { color: '#888', fontSize: 13 },
  percentage: { fontSize: 20, fontWeight: 'bold' },
  compactPercentage: { fontSize: 16, fontWeight: 'bold' },
  barContainer: { marginBottom: 12 },
  barBackground: { height: 8, backgroundColor: '#0f3460', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  message: { color: '#aaa', fontSize: 13, marginBottom: 12, lineHeight: 18 },
  recommendations: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12 },
  recommendationsTitle: { color: '#53a8b6', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  recommendationText: { color: '#888', fontSize: 12, marginBottom: 4, lineHeight: 18 },
});