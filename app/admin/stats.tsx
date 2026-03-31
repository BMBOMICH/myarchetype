import { collection, getDocs } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { db } from '../../firebaseConfig';

interface Stats {
  totalUsers: number;
  selfieVerified: number;
  heightVerified: number;
  ageVerified: number;
  hasFullBodyPhoto: number;
  trustedUsers: number;
  totalRatings: number;
  averageTrustScore: number;
  lowRatedUsers: number;
  usersWithWarnings: number;
  bannedUsers: number;
  maleUsers: number;
  femaleUsers: number;
  averageAge: number;
}

// ─── Firestore data shape ─────────────────────────────────
interface UserData {
  selfieVerified?: boolean;
  ageVerified?: boolean;
  hasFullBodyPhoto?: boolean;
  isBanned?: boolean;
  warnings?: number;
  gender?: string;
  age?: number;
  height?: { verificationMethod?: string };
  ratings?: {
    totalRatings?: number;
    averagePhotosMatch?: number;
    heightAccuracyRate?: number;
    bodyTypeAccuracyRate?: number;
  };
}

const EMPTY_STATS: Stats = {
  totalUsers: 0, selfieVerified: 0, heightVerified: 0, ageVerified: 0,
  hasFullBodyPhoto: 0, trustedUsers: 0, totalRatings: 0, averageTrustScore: 0,
  lowRatedUsers: 0, usersWithWarnings: 0, bannedUsers: 0, maleUsers: 0,
  femaleUsers: 0, averageAge: 0,
};

export default function AdminStatsScreen() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);

  useEffect(() => { loadStats(); }, []);

  const loadStats = async () => {
    try {
      const usersSnapshot = await getDocs(collection(db, 'users'));

      let totalUsers = 0, selfieVerified = 0, heightVerified = 0, ageVerified = 0;
      let hasFullBodyPhoto = 0, trustedUsers = 0, lowRatedUsers = 0;
      let usersWithWarnings = 0, bannedUsers = 0, maleUsers = 0, femaleUsers = 0;
      let totalAge = 0, totalTrustScore = 0, usersWithRatings = 0;

      usersSnapshot.forEach((docSnap) => {
        const data = docSnap.data() as UserData;
        totalUsers++;

        if (data.selfieVerified)  selfieVerified++;
        if (data.ageVerified)     ageVerified++;
        if (data.hasFullBodyPhoto) hasFullBodyPhoto++;
        if (data.isBanned)        bannedUsers++;
        if ((data.warnings ?? 0) > 0) usersWithWarnings++;
        if (data.gender === 'Male')   maleUsers++;
        if (data.gender === 'Female') femaleUsers++;
        if (data.age) totalAge += data.age;

        if (typeof data.height === 'object' && data.height?.verificationMethod === 'manual-measured') {
          heightVerified++;
        }

        if (data.ratings && (data.ratings.totalRatings ?? 0) > 0) {
          usersWithRatings++;
          const trustScore =
            ((data.ratings.averagePhotosMatch ?? 0) / 5) * 100 * 0.4 +
            (data.ratings.heightAccuracyRate ?? 0) * 0.3 +
            (data.ratings.bodyTypeAccuracyRate ?? 0) * 0.3;
          totalTrustScore += trustScore;

          if ((data.ratings.totalRatings ?? 0) >= 3 && (data.ratings.averagePhotosMatch ?? 0) >= 4) {
            trustedUsers++;
          }
          if ((data.ratings.averagePhotosMatch ?? 0) < 3) {
            lowRatedUsers++;
          }
        }
      });

      const ratingsSnapshot = await getDocs(collection(db, 'ratings'));
      const totalRatings = ratingsSnapshot.size;

      setStats({
        totalUsers, selfieVerified, heightVerified, ageVerified, hasFullBodyPhoto,
        trustedUsers, totalRatings,
        averageTrustScore: usersWithRatings > 0 ? Math.round(totalTrustScore / usersWithRatings) : 0,
        lowRatedUsers, usersWithWarnings, bannedUsers, maleUsers, femaleUsers,
        averageAge: totalUsers > 0 ? Math.round(totalAge / totalUsers) : 0,
      });
    } catch (error: unknown) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPercent = (value: number): number => {
    if (stats.totalUsers === 0) return 0;
    return Math.round((value / stats.totalUsers) * 100);
  };

  // ─── Progress bar width helper ────────────────────────
  // React Native width accepts `${number}%` as DimensionValue
  const pctWidth = (value: number): `${number}%` => `${getPercent(value)}%`;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading statistics...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Verification Statistics</Text>
      <Text style={styles.subtitle}>Analytics and metrics for MyArchetype</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>User Overview</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.totalUsers}</Text>
            <Text style={styles.statLabel}>Total Users</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumberBlue}>{stats.maleUsers}</Text>
            <Text style={styles.statLabel}>Male</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumberPink}>{stats.femaleUsers}</Text>
            <Text style={styles.statLabel}>Female</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.averageAge}</Text>
            <Text style={styles.statLabel}>Avg Age</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Verification Rates</Text>

        <View style={styles.progressItem}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Selfie Verified</Text>
            <Text style={styles.progressValue}>{stats.selfieVerified} ({getPercent(stats.selfieVerified)}%)</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFillBlue, { width: pctWidth(stats.selfieVerified) }]} />
          </View>
        </View>

        <View style={styles.progressItem}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Height Verified</Text>
            <Text style={styles.progressValue}>{stats.heightVerified} ({getPercent(stats.heightVerified)}%)</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFillPurple, { width: pctWidth(stats.heightVerified) }]} />
          </View>
        </View>

        <View style={styles.progressItem}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Age Verified</Text>
            <Text style={styles.progressValue}>{stats.ageVerified} ({getPercent(stats.ageVerified)}%)</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFillOrange, { width: pctWidth(stats.ageVerified) }]} />
          </View>
        </View>

        <View style={styles.progressItem}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Full Body Photo</Text>
            <Text style={styles.progressValue}>{stats.hasFullBodyPhoto} ({getPercent(stats.hasFullBodyPhoto)}%)</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFillTeal, { width: pctWidth(stats.hasFullBodyPhoto) }]} />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trust System</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCardSmallGold}>
            <Text style={styles.statNumberSmallGold}>{stats.trustedUsers}</Text>
            <Text style={styles.statLabelSmall}>Trusted Users</Text>
          </View>
          <View style={styles.statCardSmall}>
            <Text style={styles.statNumberSmall}>{stats.totalRatings}</Text>
            <Text style={styles.statLabelSmall}>Total Ratings</Text>
          </View>
          <View style={styles.statCardSmall}>
            <Text style={styles.statNumberSmall}>{stats.averageTrustScore}%</Text>
            <Text style={styles.statLabelSmall}>Avg Trust Score</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Safety</Text>
        <View style={styles.safetyGrid}>
          <View style={styles.safetyItem}>
            <Text style={styles.safetyNumberRed}>{stats.bannedUsers}</Text>
            <Text style={styles.safetyLabel}>Banned Users</Text>
          </View>
          <View style={styles.safetyItem}>
            <Text style={styles.safetyNumberOrange}>{stats.usersWithWarnings}</Text>
            <Text style={styles.safetyLabel}>Users with Warnings</Text>
          </View>
          <View style={styles.safetyItem}>
            <Text style={styles.safetyNumberRed}>{stats.lowRatedUsers}</Text>
            <Text style={styles.safetyLabel}>Low-Rated Users</Text>
          </View>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Health Score</Text>
        <View style={styles.summaryContent}>
          <Text style={styles.summaryScore}>
            {Math.round(
              getPercent(stats.selfieVerified) * 0.4 +
              getPercent(stats.trustedUsers) * 0.3 +
              (100 - getPercent(stats.bannedUsers)) * 0.3
            )}%
          </Text>
          <Text style={styles.summaryDesc}>
            Based on verification rate, trusted users, and safety record
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 40 },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 5, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 25, textAlign: 'center' },
  section: { marginBottom: 25 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#53a8b6', marginBottom: 15 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: { width: '48%', backgroundColor: '#16213e', borderRadius: 15, padding: 18, marginBottom: 12, alignItems: 'center' },
  statNumber: { fontSize: 32, fontWeight: 'bold', color: '#eee' },
  statNumberBlue: { fontSize: 32, fontWeight: 'bold', color: '#3498db' },
  statNumberPink: { fontSize: 32, fontWeight: 'bold', color: '#e91e63' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 5 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCardSmall: { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 15, alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  statCardSmallGold: { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 15, alignItems: 'center', borderWidth: 1, borderColor: '#f1c40f' },
  statNumberSmall: { fontSize: 24, fontWeight: 'bold', color: '#eee' },
  statNumberSmallGold: { fontSize: 24, fontWeight: 'bold', color: '#f1c40f' },
  statLabelSmall: { fontSize: 10, color: '#888', marginTop: 4, textAlign: 'center' },
  progressItem: { marginBottom: 15 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel: { fontSize: 14, color: '#eee' },
  progressValue: { fontSize: 14, color: '#888' },
  progressBar: { height: 10, backgroundColor: '#0f3460', borderRadius: 5, overflow: 'hidden' },
  progressFillBlue:   { height: '100%', borderRadius: 5, backgroundColor: '#3498db' },
  progressFillPurple: { height: '100%', borderRadius: 5, backgroundColor: '#9b59b6' },
  progressFillOrange: { height: '100%', borderRadius: 5, backgroundColor: '#e67e22' },
  progressFillTeal:   { height: '100%', borderRadius: 5, backgroundColor: '#1abc9c' },
  safetyGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  safetyItem: { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 15, alignItems: 'center', marginHorizontal: 5 },
  safetyNumberRed:    { fontSize: 28, fontWeight: 'bold', color: '#e74c3c' },
  safetyNumberOrange: { fontSize: 28, fontWeight: 'bold', color: '#e67e22' },
  safetyLabel: { fontSize: 10, color: '#888', marginTop: 5, textAlign: 'center' },
  summaryCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, borderWidth: 2, borderColor: '#53a8b6' },
  summaryTitle: { fontSize: 16, fontWeight: '600', color: '#53a8b6', textAlign: 'center', marginBottom: 15 },
  summaryContent: { alignItems: 'center' },
  summaryScore: { fontSize: 50, fontWeight: 'bold', color: '#5cb85c' },
  summaryDesc: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 10 },
});