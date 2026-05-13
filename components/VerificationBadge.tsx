import React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useMemo } from 'react';

interface VerificationBadgeProps {
  selfieVerified?: boolean;
  heightVerified?: boolean;
  ageVerified?:    boolean;
  trustedUser?:    boolean;
  ratings?:        { totalRatings: number; averagePhotosMatch: number };
  size?:           'small' | 'medium' | 'large';
  showAll?:        boolean;
}

export default function VerificationBadge({
  selfieVerified,
  heightVerified,
  ageVerified,
  trustedUser,
  ratings,
  size    = 'medium',
  showAll = false,
}: VerificationBadgeProps) {
  const badgeSize = size === 'small' ? 12 : size === 'large' ? 18 : 14;

  const trustLevel = (): 'trusted' | 'verified' | null => {
    if (
      trustedUser ||
      (ratings && ratings.totalRatings >= 3 && ratings.averagePhotosMatch >= 4)
    ) return 'trusted';
    if (selfieVerified) return 'verified';
    return null;
  };

  const level = trustLevel();

  if (showAll) {
    const _extracteduseMemo0 = useMemo(() => [styles.badge, styles.verifiedBadge], []);
    const _extracteduseMemo1 = useMemo(() => [styles.badgeIcon, { fontSize: badgeSize }], [badgeSize]);
    const _extracteduseMemo2 = useMemo(() => [styles.badge, styles.heightBadge], []);
    const _extracteduseMemo3 = useMemo(() => [styles.badgeIcon, { fontSize: badgeSize }], [badgeSize]);
    const _extracteduseMemo4 = useMemo(() => [styles.badge, styles.ageBadge], []);
    const _extracteduseMemo5 = useMemo(() => [styles.badgeIcon, { fontSize: badgeSize }], [badgeSize]);
    const _extracteduseMemo6 = useMemo(() => [styles.badge, styles.trustedBadge], []);
    const _extracteduseMemo7 = useMemo(() => [styles.badgeIcon, { fontSize: badgeSize }], [badgeSize]);
    const _extracteduseMemo8 = useMemo(() => [styles.combinedBadge, styles.trustedBadge], []);
    const _extracteduseMemo9 = useMemo(() => [styles.combinedIcon, { fontSize: badgeSize }], [badgeSize]);
    const _extracteduseMemo10 = useMemo(() => [styles.combinedText, { fontSize: badgeSize - 2 }], [badgeSize]);
    const _extracteduseMemo11 = useMemo(() => [styles.combinedBadge, styles.verifiedBadge], []);
    const _extracteduseMemo12 = useMemo(() => [styles.combinedIcon, { fontSize: badgeSize }], [badgeSize]);
    const _extracteduseMemo13 = useMemo(() => [styles.combinedText, { fontSize: badgeSize - 2 }], [badgeSize]);
    return (
      <View style={styles.allBadgesContainer}>
        {selfieVerified && (
          <View style={_extracteduseMemo0}>
            <Text style={_extracteduseMemo1}>✓</Text>
            <Text style={styles.badgeText}>Identity</Text>
          </View>
        )}
        {heightVerified && (
          <View style={_extracteduseMemo2}>
            <Text style={_extracteduseMemo3}>📏</Text>
            <Text style={styles.badgeText}>Height</Text>
          </View>
        )}
        {ageVerified && (
          <View style={_extracteduseMemo4}>
            <Text style={_extracteduseMemo5}>🎂</Text>
            <Text style={styles.badgeText}>Age</Text>
          </View>
        )}
        {trustedUser && (
          <View style={_extracteduseMemo6}>
            <Text style={_extracteduseMemo7}>⭐</Text>
            <Text style={styles.badgeText}>Trusted</Text>
          </View>
        )}
      </View>
    );
  }

  if (level === 'trusted') {
    return (
      <View style={_extracteduseMemo8}>
        <Text style={_extracteduseMemo9}>⭐</Text>
        <Text style={_extracteduseMemo10}>Trusted</Text>
      </View>
    );
  }

  if (level === 'verified') {
    return (
      <View style={_extracteduseMemo11}>
        <Text style={_extracteduseMemo12}>✓</Text>
        <Text style={_extracteduseMemo13}>Verified</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  allBadgesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge:              { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, gap: 4 },
  badgeIcon:          { color: '#ffffff' },
  badgeText:          { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  verifiedBadge:      { backgroundColor: '#3498db' },
  heightBadge:        { backgroundColor: '#9b59b6' },
  ageBadge:           { backgroundColor: '#e67e22' },
  trustedBadge:       { backgroundColor: '#f1c40f' },
  combinedBadge:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 15, gap: 4 },
  combinedIcon:       { color: '#ffffff' },
  combinedText:       { color: '#ffffff', fontWeight: '600' },
});
