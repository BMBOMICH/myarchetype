import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { collection, getDocs } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { db } from '../../firebaseConfig';
import { logger } from '../../utils/logger';

interface Stats {
  totalUsers: number;       selfieVerified: number;  heightVerified: number;
  ageVerified: number;      hasFullBodyPhoto: number; trustedUsers: number;
  totalRatings: number;     averageTrustScore: number; lowRatedUsers: number;
  usersWithWarnings: number; bannedUsers: number;    maleUsers: number;
  femaleUsers: number;      averageAge: number;
}
interface UserData {
  selfieVerified?: boolean; ageVerified?: boolean; hasFullBodyPhoto?: boolean;
  isBanned?: boolean;       warnings?: number;     gender?: string; age?: number;
  height?: { verificationMethod?: string };
  ratings?: { totalRatings?: number; averagePhotosMatch?: number; heightAccuracyRate?: number; bodyTypeAccuracyRate?: number };
}
const EMPTY_STATS: Stats = {
  totalUsers: 0, selfieVerified: 0, heightVerified: 0, ageVerified: 0,
  hasFullBodyPhoto: 0, trustedUsers: 0, totalRatings: 0, averageTrustScore: 0,
  lowRatedUsers: 0, usersWithWarnings: 0, bannedUsers: 0, maleUsers: 0, femaleUsers: 0, averageAge: 0,
};
interface Section { key: string; render: () => React.ReactElement }

function scheduleIdleTask(cb: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb);
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 100);
  return () => clearTimeout(id);
}

export default function AdminStatsScreen() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats]     = useState<Stats>(EMPTY_STATS);
  const isMounted             = useRef(true);

  const loadStats = useCallback(async () => {
    try {
      const usersSnapshot = await getDocs(collection(db, 'users'));
      let totalUsers = 0, selfieVerified = 0, heightVerified = 0, ageVerified = 0,
          hasFullBodyPhoto = 0, trustedUsers = 0, lowRatedUsers = 0,
          usersWithWarnings = 0, bannedUsers = 0, maleUsers = 0, femaleUsers = 0,
          totalAge = 0, totalTrustScore = 0, usersWithRatings = 0;

      usersSnapshot.forEach((docSnap) => {
        const d = docSnap.data() as UserData;
        totalUsers++;
        if (d.selfieVerified)              selfieVerified++;
        if (d.ageVerified)                 ageVerified++;
        if (d.hasFullBodyPhoto)            hasFullBodyPhoto++;
        if (d.isBanned)                    bannedUsers++;
        if ((d.warnings ?? 0) > 0)         usersWithWarnings++;
        if (d.gender === 'Male')           maleUsers++;
        if (d.gender === 'Female')         femaleUsers++;
        if (d.age)                         totalAge += d.age;
        if (d.height?.verificationMethod === 'manual-measured') heightVerified++;
        if (d.ratings && (d.ratings.totalRatings ?? 0) > 0) {
          usersWithRatings++;
          const trust =
            ((d.ratings.averagePhotosMatch  ?? 0) / 5) * 100 * 0.4 +
            (d.ratings.heightAccuracyRate   ?? 0) * 0.3 +
            (d.ratings.bodyTypeAccuracyRate ?? 0) * 0.3;
          totalTrustScore += trust;
          if ((d.ratings.totalRatings ?? 0) >= 3 && (d.ratings.averagePhotosMatch ?? 0) >= 4) trustedUsers++;
          if ((d.ratings.averagePhotosMatch ?? 0) < 3) lowRatedUsers++;
        }
      });

      const ratingsSnapshot = await getDocs(collection(db, 'ratings'));
      if (!isMounted.current) return;
      setStats({
        totalUsers, selfieVerified, heightVerified, ageVerified, hasFullBodyPhoto,
        trustedUsers, totalRatings: ratingsSnapshot.size,
        averageTrustScore: usersWithRatings > 0 ? Math.round(totalTrustScore / usersWithRatings) : 0,
        lowRatedUsers, usersWithWarnings, bannedUsers, maleUsers, femaleUsers,
        averageAge: totalUsers > 0 ? Math.round(totalAge / totalUsers) : 0,
      });
    } catch (error) {
      logger.error('[AdminStats] loadStats error:', error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return scheduleIdleTask(() => { void loadStats(); });
  }, [loadStats]);

  useEffect(() => () => { isMounted.current = false; }, []);

  // pct is a pure function of stats.totalUsers — no need to list pctW as a dep
  // in anything that only needs pct. pctW wraps pct for string formatting.
  const pct = useCallback(
    (v: number) => stats.totalUsers === 0 ? 0 : Math.round((v / stats.totalUsers) * 100),
    [stats.totalUsers],
  );

  const pctW = useCallback(
    (v: number): `${number}%` => `${pct(v)}%`,
    [pct],
  );

  const healthScore = Math.round(
    pct(stats.selfieVerified) * 0.4 +
    pct(stats.trustedUsers)   * 0.3 +
    (100 - pct(stats.bannedUsers)) * 0.3,
  );

  const statNumberStyle   = useCallback((color: string) => [styles.statNumber,  { color }], []);
  const safetyNumberStyle = useCallback((color: string) => [styles.safetyNumber, { color }], []);

  const progressFillStyle = useCallback(
    (v: number, color: string) => [styles.progressFill, { width: pctW(v), backgroundColor: color }],
    [pctW],
  );

  const keyExtractor = useCallback((item: Section) => item.key, []);
  const renderItem   = useCallback(({ item }: LegendListRenderItemProps<Section>) => item.render(), []);

  const sections: Section[] = useMemo(() => [
    {
      key: 'overview',
      render: () => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>User Overview</Text>
          <View style={styles.statsGrid}>
            {[
              { n: stats.totalUsers,  l: 'Total Users', c: '#eee'    },
              { n: stats.maleUsers,   l: 'Male',        c: '#3498db' },
              { n: stats.femaleUsers, l: 'Female',      c: '#e91e63' },
              { n: stats.averageAge,  l: 'Avg Age',     c: '#eee'    },
            ].map((item) => (
              <View key={item.l} style={styles.statCard} accessibilityLabel={`${item.l}: ${item.n}`}>
                <Text style={statNumberStyle(item.c)}>{item.n}</Text>
                <Text style={styles.statLabel}>{item.l}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },
    {
      key: 'verification',
      render: () => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verification Rates</Text>
          {[
            { l: 'Selfie Verified',  v: stats.selfieVerified,   c: '#3498db' },
            { l: 'Height Verified',  v: stats.heightVerified,   c: '#9b59b6' },
            { l: 'Age Verified',     v: stats.ageVerified,      c: '#e67e22' },
            { l: 'Full Body Photo',  v: stats.hasFullBodyPhoto,  c: '#1abc9c' },
          ].map((item) => (
            <View key={item.l} style={styles.progressItem} accessibilityLabel={`${item.l}: ${item.v} users, ${pct(item.v)} percent`}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>{item.l}</Text>
                <Text style={styles.progressValue}>{item.v} ({pct(item.v)}%)</Text>
              </View>
              <View style={styles.progressBar}>
                <View style={progressFillStyle(item.v, item.c)} />
              </View>
            </View>
          ))}
        </View>
      ),
    },
    {
      key: 'trust',
      render: () => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trust System</Text>
          <View style={styles.statsRow}>
            {[
              { n: stats.trustedUsers,      l: 'Trusted Users',   gold: true,  suffix: ''  },
              { n: stats.totalRatings,      l: 'Total Ratings',   gold: false, suffix: ''  },
              { n: stats.averageTrustScore, l: 'Avg Trust Score', gold: false, suffix: '%' },
            ].map((item) => (
              <View
                key={item.l}
                style={item.gold ? styles.statCardSmallGold : styles.statCardSmall}
                accessibilityLabel={`${item.l}: ${item.n}${item.suffix}`}
              >
                <Text style={item.gold ? styles.statNumberSmallGold : styles.statNumberSmall}>
                  {item.n}{item.suffix}
                </Text>
                <Text style={styles.statLabelSmall}>{item.l}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },
    {
      key: 'safety',
      render: () => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Safety</Text>
          <View style={styles.safetyGrid}>
            {[
              { n: stats.bannedUsers,       l: 'Banned Users',        c: '#e74c3c' },
              { n: stats.usersWithWarnings, l: 'Users with Warnings', c: '#e67e22' },
              { n: stats.lowRatedUsers,     l: 'Low-Rated Users',     c: '#e74c3c' },
            ].map((item) => (
              <View key={item.l} style={styles.safetyItem} accessibilityLabel={`${item.l}: ${item.n}`}>
                <Text style={safetyNumberStyle(item.c)}>{item.n}</Text>
                <Text style={styles.safetyLabel}>{item.l}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },
    {
      key: 'health',
      render: () => (
        <View style={styles.summaryCard} accessibilityLabel={`Health score: ${healthScore} percent`}>
          <Text style={styles.summaryTitle}>Health Score</Text>
          <Text style={styles.summaryScore}>{healthScore}%</Text>
          <Text style={styles.summaryDesc}>Based on verification rate, trusted users, and safety record</Text>
        </View>
      ),
    },
  ], [stats, pct, healthScore, statNumberStyle, progressFillStyle, safetyNumberStyle]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading statistics...</Text>
      </View>
    );
  }

  return (
    <LegendList
      data={sections}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentContainerStyle={styles.content}
      style={styles.container}
      estimatedItemSize={250}
      recycleItems={false}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Verification Statistics</Text>
          <Text style={styles.subtitle}>Analytics and metrics for MyArchetype</Text>
        </>
      }
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container:           { flex: 1, backgroundColor: theme.colors.background },
  content:             { padding: 20, paddingBottom: 40 },
  loadingContainer:    { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText:         { color: theme.colors.textSecondary, marginTop: 15, fontSize: 16 },
  title:               { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 5, textAlign: 'center', marginTop: 20 },
  subtitle:            { fontSize: 14, color: theme.colors.textSecondary, marginBottom: 10, textAlign: 'center' },
  section:             { marginBottom: 25 },
  sectionTitle:        { fontSize: 16, fontWeight: '600', color: '#53a8b6', marginBottom: 15 },
  statsGrid:           { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard:            { width: '48%', backgroundColor: '#16213e', borderRadius: 15, padding: 18, marginBottom: 12, alignItems: 'center' },
  statNumber:          { fontSize: 32, fontWeight: 'bold' },
  statLabel:           { fontSize: 12, color: theme.colors.textSecondary, marginTop: 5 },
  statsRow:            { flexDirection: 'row', gap: 10 },
  statCardSmall:       { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 15, alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  statCardSmallGold:   { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 15, alignItems: 'center', borderWidth: 1, borderColor: '#f1c40f' },
  statNumberSmall:     { fontSize: 24, fontWeight: 'bold', color: theme.colors.text },
  statNumberSmallGold: { fontSize: 24, fontWeight: 'bold', color: '#f1c40f' },
  statLabelSmall:      { fontSize: 10, color: theme.colors.textSecondary, marginTop: 4, textAlign: 'center' },
  progressItem:        { marginBottom: 15 },
  progressHeader:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel:       { fontSize: 14, color: theme.colors.text },
  progressValue:       { fontSize: 14, color: theme.colors.textSecondary },
  progressBar:         { height: 10, backgroundColor: '#0f3460', borderRadius: 5, overflow: 'hidden' },
  progressFill:        { height: '100%', borderRadius: 5 },
  safetyGrid:          { flexDirection: 'row', justifyContent: 'space-between' },
  safetyItem:          { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 15, alignItems: 'center', marginHorizontal: 5 },
  safetyNumber:        { fontSize: 28, fontWeight: 'bold' },
  safetyLabel:         { fontSize: 10, color: theme.colors.textSecondary, marginTop: 5, textAlign: 'center' },
  summaryCard:         { backgroundColor: '#16213e', borderRadius: 15, padding: 20, borderWidth: 2, borderColor: '#53a8b6', alignItems: 'center' },
  summaryTitle:        { fontSize: 16, fontWeight: '600', color: '#53a8b6', marginBottom: 15 },
  summaryScore:        { fontSize: 50, fontWeight: 'bold', color: '#5cb85c' },
  summaryDesc:         { fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 10 },
}));