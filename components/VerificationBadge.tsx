import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface VerificationBadgeProps {
  selfieVerified?: boolean;
  heightVerified?: boolean;
  ageVerified?: boolean;
  trustedUser?: boolean;
  ratings?: {
    totalRatings: number;
    averagePhotosMatch: number;
  };
  size?: 'small' | 'medium' | 'large';
  showAll?: boolean;
}

export default function VerificationBadge({
  selfieVerified,
  heightVerified,
  ageVerified,
  trustedUser,
  ratings,
  size = 'medium',
  showAll = false,
}: VerificationBadgeProps) {
  const badgeSize = size === 'small' ? 12 : size === 'large' ? 18 : 14;

  // Determine trust level
  const getTrustLevel = (): 'basic' | 'verified' | 'trusted' | null => {
    if (trustedUser || (ratings && ratings.totalRatings >= 3 && ratings.averagePhotosMatch >= 4)) {
      return 'trusted';
    }
    if (selfieVerified) {
      return 'verified';
    }
    return 'basic';
  };

  const trustLevel = getTrustLevel();

  if (showAll) {
    // Show all badges individually
    return (
      <View style={styles.allBadgesContainer}>
        {selfieVerified ? (
          <View style={[styles.badge, styles.verifiedBadge]}>
            <Text style={[styles.badgeIcon, { fontSize: badgeSize }]}>✓</Text>
            <Text style={styles.badgeText}>Identity</Text>
          </View>
        ) : null}

        {heightVerified ? (
          <View style={[styles.badge, styles.heightBadge]}>
            <Text style={[styles.badgeIcon, { fontSize: badgeSize }]}>📏</Text>
            <Text style={styles.badgeText}>Height</Text>
          </View>
        ) : null}

        {ageVerified ? (
          <View style={[styles.badge, styles.ageBadge]}>
            <Text style={[styles.badgeIcon, { fontSize: badgeSize }]}>🎂</Text>
            <Text style={styles.badgeText}>Age</Text>
          </View>
        ) : null}

        {trustedUser ? (
          <View style={[styles.badge, styles.trustedBadge]}>
            <Text style={[styles.badgeIcon, { fontSize: badgeSize }]}>⭐</Text>
            <Text style={styles.badgeText}>Trusted</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // Show single combined badge
  if (trustLevel === 'trusted') {
    return (
      <View style={[styles.combinedBadge, styles.trustedBadge]}>
        <Text style={[styles.combinedIcon, { fontSize: badgeSize }]}>⭐</Text>
        <Text style={[styles.combinedText, { fontSize: badgeSize - 2 }]}>Trusted</Text>
      </View>
    );
  }

  if (trustLevel === 'verified') {
    return (
      <View style={[styles.combinedBadge, styles.verifiedBadge]}>
        <Text style={[styles.combinedIcon, { fontSize: badgeSize }]}>✓</Text>
        <Text style={[styles.combinedText, { fontSize: badgeSize - 2 }]}>Verified</Text>
      </View>
    );
  }

  return null; // No badge for basic users
}

const styles = StyleSheet.create({
  allBadgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  badgeIcon: {
    color: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  verifiedBadge: {
    backgroundColor: '#3498db',
  },
  heightBadge: {
    backgroundColor: '#9b59b6',
  },
  ageBadge: {
    backgroundColor: '#e67e22',
  },
  trustedBadge: {
    backgroundColor: '#f1c40f',
  },
  combinedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 15,
    gap: 4,
  },
  combinedIcon: {
    color: '#fff',
  },
  combinedText: {
    color: '#fff',
    fontWeight: '600',
  },
});