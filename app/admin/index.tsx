import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../firebaseConfig';

interface Stats {
  totalUsers: number;
  verifiedUsers: number;
  totalMatches: number;
  pendingReports: number;
  totalReports: number;
  activeToday: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    verifiedUsers: 0,
    totalMatches: 0,
    pendingReports: 0,
    totalReports: 0,
    activeToday: 0,
  });

  useEffect(() => {
    checkAdminAndLoadStats();
  }, []);

  const checkAdminAndLoadStats = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        router.replace('/login');
        return;
      }

      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (!userDoc.exists() || !userDoc.data().isAdmin) {
        console.log('Not an admin');
        router.replace('/home');
        return;
      }

      setIsAdmin(true);

      // Load stats
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const totalUsers = usersSnapshot.size;
      
      let verifiedUsers = 0;
      let activeToday = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      usersSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.selfieVerified) verifiedUsers++;
        if (data.lastSeen) {
          const lastSeen = data.lastSeen.toDate ? data.lastSeen.toDate() : new Date(data.lastSeen);
          if (lastSeen >= today) activeToday++;
        }
      });

      const matchesQuery = query(collection(db, 'likes'), where('status', '==', 'matched'));
      const matchesSnapshot = await getDocs(matchesQuery);
      const totalMatches = Math.floor(matchesSnapshot.size / 2);

      const reportsSnapshot = await getDocs(collection(db, 'reports'));
      const totalReports = reportsSnapshot.size;
      
      let pendingReports = 0;
      reportsSnapshot.forEach((doc) => {
        if (doc.data().status === 'pending') pendingReports++;
      });

      setStats({
        totalUsers,
        verifiedUsers,
        totalMatches,
        pendingReports,
        totalReports,
        activeToday,
      });

    } catch (error) {
      console.error('Error loading admin stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading admin dashboard...</Text>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Access Denied</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>👮 Admin Dashboard</Text>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#5cb85c' }]}>{stats.verifiedUsers}</Text>
          <Text style={styles.statLabel}>Verified Users</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#e67e22' }]}>{stats.activeToday}</Text>
          <Text style={styles.statLabel}>Active Today</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#53a8b6' }]}>{stats.totalMatches}</Text>
          <Text style={styles.statLabel}>Total Matches</Text>
        </View>

        <View style={[styles.statCard, stats.pendingReports > 0 && styles.statCardAlert]}>
          <Text style={[styles.statNumber, { color: stats.pendingReports > 0 ? '#d9534f' : '#888' }]}>
            {stats.pendingReports}
          </Text>
          <Text style={styles.statLabel}>Pending Reports</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.totalReports}</Text>
          <Text style={styles.statLabel}>Total Reports</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Quick Actions</Text>

      <TouchableOpacity
        style={[styles.actionButton, stats.pendingReports > 0 && styles.actionButtonAlert]}
        onPress={() => router.push('/admin/reports')}
      >
        <Text style={styles.actionButtonIcon}>🚨</Text>
        <View style={styles.actionButtonContent}>
          <Text style={styles.actionButtonTitle}>Review Reports</Text>
          <Text style={styles.actionButtonSubtitle}>
            {stats.pendingReports > 0 
              ? stats.pendingReports + ' pending reports need attention'
              : 'No pending reports'}
          </Text>
        </View>
        <Text style={styles.actionButtonArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => router.push('/admin/users')}
      >
        <Text style={styles.actionButtonIcon}>👥</Text>
        <View style={styles.actionButtonContent}>
          <Text style={styles.actionButtonTitle}>Manage Users</Text>
          <Text style={styles.actionButtonSubtitle}>View, verify, or ban users</Text>
        </View>
        <Text style={styles.actionButtonArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.actionButton}
        onPress={() => router.push('/admin/stats')}
      >
        <Text style={styles.actionButtonIcon}>📊</Text>
        <View style={styles.actionButtonContent}>
          <Text style={styles.actionButtonTitle}>View Statistics</Text>
          <Text style={styles.actionButtonSubtitle}>Detailed analytics and insights</Text>
        </View>
        <Text style={styles.actionButtonArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.backButton}
        onPress={() => router.back()}
      >
        <Text style={styles.backButtonText}>← Back to Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollContainer: { flex: 1, backgroundColor: '#1a1a2e' },
  scrollContent: { padding: 20, paddingBottom: 40 },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16 },
  errorText: { color: '#d9534f', fontSize: 18 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#eee', marginBottom: 25, textAlign: 'center' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 30 },
  statCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, width: '48%', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  statCardAlert: { borderColor: '#d9534f', borderWidth: 2 },
  statNumber: { fontSize: 32, fontWeight: 'bold', color: '#eee', marginBottom: 5 },
  statLabel: { fontSize: 12, color: '#888', textAlign: 'center' },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginBottom: 15 },

  actionButton: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  actionButtonAlert: { borderColor: '#d9534f', borderWidth: 2 },
  actionButtonIcon: { fontSize: 30, marginRight: 15 },
  actionButtonContent: { flex: 1 },
  actionButtonTitle: { fontSize: 16, fontWeight: '600', color: '#eee', marginBottom: 4 },
  actionButtonSubtitle: { fontSize: 12, color: '#888' },
  actionButtonArrow: { fontSize: 20, color: '#53a8b6' },

  backButton: { marginTop: 20, paddingVertical: 15, alignItems: 'center' },
  backButtonText: { color: '#53a8b6', fontSize: 16 },
});