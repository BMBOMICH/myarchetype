import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../../firebaseConfig';
import { logger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  totalUsers:     number;
  verifiedUsers:  number;
  totalMatches:   number;
  pendingReports: number;
  totalReports:   number;
  activeToday:    number;
}

const EMPTY_STATS: Stats = {
  totalUsers: 0, verifiedUsers: 0, totalMatches: 0,
  pendingReports: 0, totalReports: 0, activeToday: 0,
};

interface Section { key: string; render: () => React.ReactElement }

// ─── Idle task helper ─────────────────────────────────────────────────────────

const scheduleIdleTask = (cb: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb);
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 100);
  return () => clearTimeout(id);
};

// ─── Stat card sub-component ──────────────────────────────────────────────────

interface StatCardProps {
  n:     number;
  l:     string;
  color: string;
  alert: boolean;
}

const StatCard = React.memo<StatCardProps>(({ n, l, color, alert }) => {
  const cardStyle   = useMemo(() => [s.statCard,   alert && s.statCardAlert],   [alert]);
  const numberStyle = useMemo(() => [s.statNumber, { color }],                  [color]);
  return (
    <View
      style={cardStyle}
      accessibilityLabel={`${l}: ${n}`}
      accessibilityRole="text"
    >
      <Text style={numberStyle}>{n}</Text>
      <Text style={s.statLabel}>{l}</Text>
    </View>
  );
});
StatCard.displayName = 'StatCard';

// ─── Action button sub-component ──────────────────────────────────────────────

interface ActionButtonProps {
  icon:     string;
  title:    string;
  subtitle: string;
  onPress:  () => void;
  alert:    boolean;
}

const ActionButton = React.memo<ActionButtonProps>(({ icon, title, subtitle, onPress, alert }) => {
  const btnStyle = useMemo(() => [s.actionButton, alert && s.actionButtonAlert], [alert]);
  return (
    <TouchableOpacity
      style={btnStyle}
      onPress={onPress}
      accessibilityLabel={`${title}: ${subtitle}`}
      accessibilityRole="button"
      accessibilityHint={`Navigate to ${title}`}
    >
      <Text style={s.actionIcon} accessibilityElementsHidden>{icon}</Text>
      <View style={s.actionContent}>
        <Text style={s.actionTitle}>{title}</Text>
        <Text style={s.actionSubtitle}>{subtitle}</Text>
      </View>
      <Text style={s.actionArrow} accessibilityElementsHidden>→</Text>
    </TouchableOpacity>
  );
});
ActionButton.displayName = 'ActionButton';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router    = useRouter();
  const isMounted = useRef(true);

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats,   setStats]   = useState<Stats>(EMPTY_STATS);

  // ── Load data ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) { router.replace('/login'); return; }

      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists() || !(userDoc.data().isAdmin as boolean | undefined)) {
        logger.log('[Admin] Not an admin');
        router.replace('/home');
        return;
      }
      if (!isMounted.current) return;
      setIsAdmin(true);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const usersSnap = await getDocs(collection(db, 'users'));
      let verifiedUsers = 0, activeToday = 0;
      usersSnap.forEach((d) => {
        const data = d.data();
        if (data.selfieVerified) verifiedUsers++;
        if (data.lastSeen) {
          const raw = data.lastSeen as { toDate?: () => Date } | string | number;
          const ls  = typeof raw === 'object' && typeof raw.toDate === 'function'
            ? raw.toDate()
            : new Date(raw as string | number);
          if (ls >= today) activeToday++;
        }
      });

      const likesCollection = collection(db, 'likes');
      const [matchesSnap, reportsSnap] = await Promise.all([
        getDocs(query(likesCollection, where('status', '==', 'matched'))),
        getDocs(collection(db, 'reports')),
      ]);

      let pendingReports = 0;
      reportsSnap.forEach((d) => { if (d.data().status === 'pending') pendingReports++; });

      if (!isMounted.current) return;
      setStats({
        totalUsers:     usersSnap.size,
        verifiedUsers,
        activeToday,
        totalMatches:   Math.floor(matchesSnap.size / 2),
        pendingReports,
        totalReports:   reportsSnap.size,
      });
    } catch (error) {
      logger.error('[Admin] load error:', error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    isMounted.current = true;
    const cancel = scheduleIdleTask(() => { void load(); });
    return () => {
      isMounted.current = false;
      cancel();
    };
  }, [load]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  const handleBack    = useCallback(() => router.back(),                 [router]);
  const handleReports = useCallback(() => router.push('/admin/reports'), [router]);
  const handleUsers   = useCallback(() => router.push('/admin/users'),   [router]);
  const handleStats   = useCallback(() => router.push('/admin/stats'),   [router]);

  // ── List helpers ────────────────────────────────────────────────────────────

  const renderSection = useCallback(
    ({ item }: LegendListRenderItemProps<Section>) => item.render(),
    [],
  );
  const keyExtractor = useCallback((item: Section) => item.key, []);

  // ── Loading / access denied ─────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={s.loadingText}>Loading admin dashboard...</Text>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Access Denied</Text>
      </View>
    );
  }

  // ── Data ────────────────────────────────────────────────────────────────────

  const statCards: StatCardProps[] = [
    { n: stats.totalUsers,     l: 'Total Users',     color: '#eee',    alert: false },
    { n: stats.verifiedUsers,  l: 'Verified Users',  color: '#5cb85c', alert: false },
    { n: stats.activeToday,    l: 'Active Today',    color: '#e67e22', alert: false },
    { n: stats.totalMatches,   l: 'Total Matches',   color: '#53a8b6', alert: false },
    {
      n: stats.pendingReports,
      l: 'Pending Reports',
      color: stats.pendingReports > 0 ? '#d9534f' : '#888',
      alert: stats.pendingReports > 0,
    },
    { n: stats.totalReports, l: 'Total Reports', color: '#eee', alert: false },
  ];

  const actions: ActionButtonProps[] = [
    {
      key:      'reports',
      icon:     '🚨',
      title:    'Review Reports',
      subtitle: stats.pendingReports > 0
        ? `${stats.pendingReports} pending reports need attention`
        : 'No pending reports',
      onPress: handleReports,
      alert:   stats.pendingReports > 0,
    },
    { key: 'users', icon: '👥', title: 'Manage Users',    subtitle: 'View, verify, or ban users',      onPress: handleUsers,  alert: false },
    { key: 'stats', icon: '📊', title: 'View Statistics', subtitle: 'Detailed analytics and insights', onPress: handleStats,  alert: false },
  ] as ActionButtonProps[];

  const sections: Section[] = [
    {
      key: 'statGrid',
      render: () => (
        <View style={s.statsGrid}>
          {statCards.map((item) => (
            <StatCard key={item.l} n={item.n} l={item.l} color={item.color} alert={item.alert} />
          ))}
        </View>
      ),
    },
    {
      key: 'actions',
      render: () => (
        <>
          <Text style={s.sectionTitle} accessibilityRole="header">Quick Actions</Text>
          {actions.map((item) => (
            <ActionButton
              key={(item as ActionButtonProps & { key: string }).key}
              icon={item.icon}
              title={item.title}
              subtitle={item.subtitle}
              onPress={item.onPress}
              alert={item.alert}
            />
          ))}
          <TouchableOpacity
            style={s.backButton}
            onPress={handleBack}
            accessibilityLabel="Go back to home"
            accessibilityRole="button"
          >
            <Text style={s.backButtonText}>← Back to Home</Text>
          </TouchableOpacity>
        </>
      ),
    },
  ];

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <Text style={s.title} accessibilityRole="header">👮 Admin Dashboard</Text>
      <LegendList
        data={sections}
        keyExtractor={keyExtractor}
        renderItem={renderSection}
        contentContainerStyle={s.content}
        estimatedItemSize={300}
        recycleItems={false}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create((theme) => ({
  center:            { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center', padding: 20 },
  container:         { flex: 1, backgroundColor: theme.colors.background },
  content:           { padding: 20, paddingBottom: 40 },
  loadingText:       { color: theme.colors.textSecondary, marginTop: 15, fontSize: 16 },
  errorText:         { color: theme.colors.error, fontSize: 18 },
  title:             { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center', marginTop: 20, paddingHorizontal: 20 },
  statsGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 30 },
  statCard:          { backgroundColor: '#16213e', borderRadius: 15, padding: 20, width: '48%', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  statCardAlert:     { borderColor: '#d9534f', borderWidth: 2 },
  statNumber:        { fontSize: 32, fontWeight: 'bold', marginBottom: 5 },
  statLabel:         { fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center' },
  sectionTitle:      { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginBottom: 15 },
  actionButton:      { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  actionButtonAlert: { borderColor: '#d9534f', borderWidth: 2 },
  actionIcon:        { fontSize: 30, marginRight: 15 },
  actionContent:     { flex: 1 },
  actionTitle:       { fontSize: 16, fontWeight: '600', color: theme.colors.text, marginBottom: 4 },
  actionSubtitle:    { fontSize: 12, color: theme.colors.textSecondary },
  actionArrow:       { fontSize: 20, color: '#53a8b6' },
  backButton:        { marginTop: 20, paddingVertical: 15, alignItems: 'center' },
  backButtonText:    { color: '#53a8b6', fontSize: 16 },
}));
