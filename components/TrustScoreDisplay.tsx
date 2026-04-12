import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getUserTrustLevel } from '../utils/ratingSystem';

interface Ratings {
  totalRatings: number;
  averagePhotosMatch?: number;
  heightAccuracyRate?: number;
  bodyTypeAccuracyRate?: number;
  ageAccuracyRate?: number;
  averagePersonalityMatch?: number;
  averageOverall?: number;
}

interface TrustLevel {
  color: string;
  label: string;
}

interface TrustScoreDisplayProps {
  ratings: Ratings;
  selfieVerified?: boolean;
  ageVerified?: boolean;
  heightVerified?: boolean;
  size?: 'small' | 'medium' | 'large';
}

interface RatingBarProps {
  label: string;
  value: number;
  max: number;
  isPercent?: boolean;
}

export default function TrustScoreDisplay({
  ratings,
  selfieVerified = false,
  ageVerified = false,
  heightVerified = false,
  size = 'medium',
}: TrustScoreDisplayProps) {
  const [showModal, setShowModal] = useState(false);

  const trustLevel = getUserTrustLevel(ratings) as TrustLevel;
  const trustScore = calculateDisplayScore(ratings);
  const verificationCount = [selfieVerified, ageVerified, heightVerified].filter(Boolean).length;

  if (size === 'small') {
    return (
      <TouchableOpacity
        style={[styles.smallBadge, { backgroundColor: trustLevel.color }]}
        onPress={() => setShowModal(true)}
        accessibilityLabel={`Trust level: ${trustLevel.label}`}
        accessibilityRole="button"
      >
        <Text style={styles.smallBadgeText}>{trustLevel.label}</Text>
        <Modal
          visible={showModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowModal(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowModal(false)}
            accessibilityLabel="Close trust score modal"
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Trust Score</Text>
              {renderDetailedScore(ratings, selfieVerified, ageVerified, heightVerified, trustLevel, trustScore)}
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setShowModal(false)}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </TouchableOpacity>
    );
  }

  if (size === 'medium') {
    return (
      <TouchableOpacity
        style={styles.mediumContainer}
        onPress={() => setShowModal(true)}
        accessibilityLabel={`Trust level: ${trustLevel.label}, score: ${trustScore}%`}
        accessibilityRole="button"
      >
        <View style={styles.mediumRow}>
          <View style={[styles.mediumBadge, { backgroundColor: trustLevel.color }]}>
            <Text style={styles.mediumBadgeText}>{trustLevel.label}</Text>
          </View>
          {trustScore > 0 && <Text style={styles.mediumScore}>{trustScore}%</Text>}
        </View>
        {verificationCount > 0 && (
          <Text style={styles.mediumVerified}>{verificationCount}/3 verified</Text>
        )}
        <Modal
          visible={showModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowModal(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowModal(false)}
            accessibilityLabel="Close trust score modal"
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Trust Score</Text>
              {renderDetailedScore(ratings, selfieVerified, ageVerified, heightVerified, trustLevel, trustScore)}
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setShowModal(false)}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.largeContainer}>
      {renderDetailedScore(ratings, selfieVerified, ageVerified, heightVerified, trustLevel, trustScore)}
    </View>
  );
}

function renderDetailedScore(
  ratings: Ratings,
  selfieVerified: boolean,
  ageVerified: boolean,
  heightVerified: boolean,
  trustLevel: TrustLevel,
  trustScore: number,
) {
  const hasRatings = ratings && ratings.totalRatings > 0;
  return (
    <View style={styles.detailContainer}>
      <View style={styles.scoreHeader}>
        <View style={[styles.scoreBadge, { backgroundColor: trustLevel.color }]}>
          <Text style={styles.scoreBadgeText}>{trustLevel.label}</Text>
        </View>
        {trustScore > 0 && <Text style={styles.scoreNumber}>{trustScore}%</Text>}
      </View>
      {trustScore > 0 && (
        <View style={styles.scoreBarContainer}>
          <View style={styles.scoreBarBg}>
            <View
              style={[
                styles.scoreBarFill,
                { width: `${trustScore}%`, backgroundColor: trustScore >= 75 ? '#5cb85c' : trustScore >= 50 ? '#e67e22' : '#d9534f' },
              ]}
            />
          </View>
          <Text style={styles.scoreLabel}>
            {trustScore >= 85 ? 'Excellent' : trustScore >= 70 ? 'Good' : trustScore >= 50 ? 'Fair' : 'Poor'}
          </Text>
        </View>
      )}
      <View style={styles.verificationsSection}>
        <Text style={styles.sectionLabel}>Verifications</Text>
        {(['selfie', 'age', 'height'] as const).map((type) => {
          const verified = type === 'selfie' ? selfieVerified : type === 'age' ? ageVerified : heightVerified;
          const label = type === 'selfie' ? 'Identity' : type === 'age' ? 'Age' : 'Height';
          return (
            <View key={type} style={styles.verificationRow}>
              <View style={[styles.verificationDot, verified && styles.verificationDotActive]} />
              <Text style={[styles.verificationText, verified && styles.verificationTextActive]}>
                {label} {verified ? '✓' : '✗'}
              </Text>
            </View>
          );
        })}
      </View>
      {hasRatings ? (
        <View style={styles.ratingsSection}>
          <Text style={styles.sectionLabel}>Community Ratings ({ratings.totalRatings} reviews)</Text>
          <RatingBar label="Photos match reality" value={ratings.averagePhotosMatch ?? 0} max={5} />
          <RatingBar label="Height accurate" value={ratings.heightAccuracyRate ?? 0} max={100} isPercent />
          <RatingBar label="Body type accurate" value={ratings.bodyTypeAccuracyRate ?? 0} max={100} isPercent />
          <RatingBar label="Age accurate" value={ratings.ageAccuracyRate ?? 0} max={100} isPercent />
          <RatingBar label="Personality match" value={ratings.averagePersonalityMatch ?? 0} max={5} />
          <RatingBar label="Overall experience" value={ratings.averageOverall ?? 0} max={5} />
        </View>
      ) : (
        <View style={styles.noRatingsBox}>
          <Text style={styles.noRatingsText}>No community ratings yet. Ratings appear after dates.</Text>
        </View>
      )}
    </View>
  );
}

function RatingBar({ label, value, max, isPercent = false }: RatingBarProps) {
  if (!value || value === 0) return null;
  const percentage = isPercent ? value : (value / max) * 100;
  return (
    <View style={styles.ratingItem}>
      <Text style={styles.ratingLabel}>{label}</Text>
      <View style={styles.ratingBarRow}>
        <View style={styles.ratingBarBg}>
          <View style={[styles.ratingBarFill, { width: `${percentage}%` }]} />
        </View>
        <Text style={styles.ratingValue}>
          {isPercent ? `${value}%` : `${value.toFixed(1)}/5`}
        </Text>
      </View>
    </View>
  );
}

function calculateDisplayScore(ratings: Ratings): number {
  if (!ratings || ratings.totalRatings === 0) return 0;
  const photosScore       = ((ratings.averagePhotosMatch ?? 0) / 5) * 100;
  const heightScore       = ratings.heightAccuracyRate ?? 0;
  const bodyScore         = ratings.bodyTypeAccuracyRate ?? 0;
  const ageScore          = ratings.ageAccuracyRate ?? 0;
  const personalityScore  = ((ratings.averagePersonalityMatch ?? 0) / 5) * 100;
  const overallScore      = ((ratings.averageOverall ?? 0) / 5) * 100;
  return Math.round(
    photosScore * 0.25 + heightScore * 0.15 + bodyScore * 0.15 +
    ageScore * 0.15 + personalityScore * 0.15 + overallScore * 0.15,
  );
}

const styles = StyleSheet.create({
  smallBadge:             { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  smallBadgeText:         { color: '#fff', fontSize: 11, fontWeight: '600' },
  mediumContainer:        { backgroundColor: '#16213e', borderRadius: 10, padding: 12 },
  mediumRow:              { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mediumBadge:            { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 10 },
  mediumBadgeText:        { color: '#fff', fontSize: 12, fontWeight: '600' },
  mediumScore:            { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  mediumVerified:         { color: '#888', fontSize: 11, marginTop: 6 },
  largeContainer:         { marginBottom: 10 },
  detailContainer:        {},
  scoreHeader:            { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 15 },
  scoreBadge:             { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 12 },
  scoreBadgeText:         { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  scoreNumber:            { color: '#eee', fontSize: 28, fontWeight: 'bold' },
  scoreBarContainer:      { marginBottom: 20 },
  scoreBarBg:             { height: 8, backgroundColor: '#0f3460', borderRadius: 4, overflow: 'hidden' },
  scoreBarFill:           { height: 8, borderRadius: 4 },
  scoreLabel:             { color: '#888', fontSize: 12, marginTop: 5, textAlign: 'right' },
  verificationsSection:   { marginBottom: 20 },
  sectionLabel:           { color: '#53a8b6', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  verificationRow:        { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  verificationDot:        { width: 10, height: 10, borderRadius: 5, backgroundColor: '#555', marginRight: 10 },
  verificationDotActive:  { backgroundColor: '#5cb85c' },
  verificationText:       { color: '#888', fontSize: 13 },
  verificationTextActive: { color: '#5cb85c' },
  ratingsSection:         { marginBottom: 10 },
  ratingItem:             { marginBottom: 12 },
  ratingLabel:            { color: '#ccc', fontSize: 13, marginBottom: 5 },
  ratingBarRow:           { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ratingBarBg:            { flex: 1, height: 6, backgroundColor: '#0f3460', borderRadius: 3, overflow: 'hidden' },
  ratingBarFill:          { height: 6, borderRadius: 3, backgroundColor: '#53a8b6' },
  ratingValue:            { color: '#eee', fontSize: 13, fontWeight: '600', width: 45, textAlign: 'right' },
  noRatingsBox:           { backgroundColor: '#0f3460', borderRadius: 10, padding: 15 },
  noRatingsText:          { color: '#888', fontSize: 13, textAlign: 'center' },
  modalOverlay:           { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent:           { backgroundColor: '#1a1a2e', borderRadius: 20, padding: 20, width: '100%', maxWidth: 400, borderWidth: 1, borderColor: '#0f3460' },
  modalTitle:             { fontSize: 22, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 20 },
  modalClose:             { marginTop: 15, paddingVertical: 10, alignItems: 'center' },
  modalCloseText:         { color: '#d9534f', fontSize: 15 },
});