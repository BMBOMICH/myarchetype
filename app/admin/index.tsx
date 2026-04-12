// app/admin/index.tsx
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../firebaseConfig';
import { logger } from '../../utils/logger';

interface Stats {
  totalUsers: number; verifiedUsers: number; totalMatches: number;
  pendingReports: number; totalReports: number; activeToday: number;
}
const EMPTY_STATS: Stats = { totalUsers:0, verifiedUsers:0, totalMatches:0, pendingReports:0, totalReports:0, activeToday:0 };
interface Section { key: string; render: () => React.ReactElement }

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats]     = useState<Stats>(EMPTY_STATS);

  const load = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) { router.replace('/login'); return; }
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists() || !(userDoc.data().isAdmin as boolean | undefined)) {
        logger.log('[Admin] Not an admin'); router.replace('/home'); return;
      }
      setIsAdmin(true);

      const today = new Date(); today.setHours(0, 0, 0, 0);
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

      const [matchesSnap, reportsSnap] = await Promise.all([
        getDocs(query(collection(db, 'likes'), where('status', '==', 'matched'))),
        getDocs(collection(db, 'reports')),
      ]);
      let pendingReports = 0;
      reportsSnap.forEach((d) => { if (d.data().status === 'pending') pendingReports++; });

      setStats({
        totalUsers: usersSnap.size, verifiedUsers, activeToday,
        totalMatches: Math.floor(matchesSnap.size / 2),
        pendingReports, totalReports: reportsSnap.size,
      });
    } catch (error) {
      logger.error('[Admin] load error:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={s.loadingText}>Loading admin dashboard...</Text>
      </View>
    );
  }
  if (!isAdmin) return <View style={s.center}><Text style={s.errorText}>Access Denied</Text></View>;

  const statCards = [
    { n: stats.totalUsers,     l: 'Total Users',     c: '#eee',    alert: false },
    { n: stats.verifiedUsers,  l: 'Verified Users',  c: '#5cb85c', alert: false },
    { n: stats.activeToday,    l: 'Active Today',    c: '#e67e22', alert: false },
    { n: stats.totalMatches,   l: 'Total Matches',   c: '#53a8b6', alert: false },
    { n: stats.pendingReports, l: 'Pending Reports', c: stats.pendingReports > 0 ? '#d9534f' : '#888', alert: stats.pendingReports > 0 },
    { n: stats.totalReports,   l: 'Total Reports',   c: '#eee',    alert: false },
  ];

  const actions = [
    { key:'reports', icon:'🚨', title:'Review Reports',  subtitle: stats.pendingReports > 0 ? `${stats.pendingReports} pending reports need attention` : 'No pending reports', route:'/admin/reports' as const, alert: stats.pendingReports > 0 },
    { key:'users',   icon:'👥', title:'Manage Users',    subtitle:'View, verify, or ban users',      route:'/admin/users'   as const, alert: false },
    { key:'stats',   icon:'📊', title:'View Statistics', subtitle:'Detailed analytics and insights', route:'/admin/stats'   as const, alert: false },
  ];

  const sections: Section[] = [
    {
      key: 'statGrid',
      render: () => (
        <View style={s.statsGrid}>
          {statCards.map((item) => (
            <View key={item.l} style={[s.statCard, item.alert && s.statCardAlert]}
              accessibilityLabel={`${item.l}: ${item.n}`} accessibilityRole="text">
              <Text style={[s.statNumber, { color: item.c }]}>{item.n}</Text>
              <Text style={s.statLabel}>{item.l}</Text>
            </View>
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
            <TouchableOpacity
              key={item.key}
              style={[s.actionButton, item.alert && s.actionButtonAlert]}
              onPress={() => router.push(item.route)}
              accessibilityLabel={`${item.title}: ${item.subtitle}`}
              accessibilityRole="button"
              accessibilityHint={`Navigate to ${item.title}`}>
              <Text style={s.actionIcon} accessibilityElementsHidden>{item.icon}</Text>
              <View style={s.actionContent}>
                <Text style={s.actionTitle}>{item.title}</Text>
                <Text style={s.actionSubtitle}>{item.subtitle}</Text>
              </View>
              <Text style={s.actionArrow} accessibilityElementsHidden>→</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={s.backButton} onPress={() => router.back()}
            accessibilityLabel="Go back to home" accessibilityRole="button">
            <Text style={s.backButtonText}>← Back to Home</Text>
          </TouchableOpacity>
        </>
      ),
    },
  ];

  return (
    <View style={s.container}>
      <Text style={s.title} accessibilityRole="header">👮 Admin Dashboard</Text>
      <FlatList
        data={sections}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => item.render()}
        contentContainerStyle={s.content}
      />
    </View>
  );
}

const s = StyleSheet.create({
  center:           { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  container:        { flex: 1, backgroundColor: '#1a1a2e' },
  content:          { padding: 20, paddingBottom: 40 },
  loadingText:      { color: '#aaa', marginTop: 15, fontSize: 16 },
  errorText:        { color: '#d9534f', fontSize: 18 },
  title:            { fontSize: 28, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginTop: 20, paddingHorizontal: 20 },
  statsGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 30 },
  statCard:         { backgroundColor: '#16213e', borderRadius: 15, padding: 20, width: '48%', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  statCardAlert:    { borderColor: '#d9534f', borderWidth: 2 },
  statNumber:       { fontSize: 32, fontWeight: 'bold', marginBottom: 5 },
  statLabel:        { fontSize: 12, color: '#888', textAlign: 'center' },
  sectionTitle:     { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginBottom: 15 },
  actionButton:     { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  actionButtonAlert:{ borderColor: '#d9534f', borderWidth: 2 },
  actionIcon:       { fontSize: 30, marginRight: 15 },
  actionContent:    { flex: 1 },
  actionTitle:      { fontSize: 16, fontWeight: '600', color: '#eee', marginBottom: 4 },
  actionSubtitle:   { fontSize: 12, color: '#888' },
  actionArrow:      { fontSize: 20, color: '#53a8b6' },
  backButton:       { marginTop: 20, paddingVertical: 15, alignItems: 'center' },
  backButtonText:   { color: '#53a8b6', fontSize: 16 },
});