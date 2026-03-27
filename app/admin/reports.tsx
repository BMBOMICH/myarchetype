import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../../firebaseConfig';

interface Report {
  id: string;
  reporterId: string;
  reporterName?: string;
  reportedUserId: string;
  reportedUserName: string;
  reportedUserPhoto?: string;
  reason: string;
  createdAt: string;
  status: string;
}

export default function AdminReportsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<'pending' | 'resolved' | 'all'>('pending');

  useEffect(() => {
    loadReports();
  }, [filter]);

  const loadReports = async () => {
    try {
      let q;
      if (filter === 'all') {
        q = query(collection(db, 'reports'));
      } else {
        q = query(collection(db, 'reports'), where('status', '==', filter));
      }

      const snapshot = await getDocs(q);
      const reportsList: Report[] = [];

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();

        let reporterName = 'Unknown';
        try {
          const reporterDoc = await getDoc(doc(db, 'users', data.reporterId));
          if (reporterDoc.exists()) {
            reporterName = reporterDoc.data().name;
          }
        } catch {}

        let reportedUserPhoto = '';
        try {
          const reportedDoc = await getDoc(doc(db, 'users', data.reportedUserId));
          if (reportedDoc.exists()) {
            reportedUserPhoto = reportedDoc.data().photos?.[0] || '';
          }
        } catch {}

        reportsList.push({
          id: docSnap.id,
          reporterId: data.reporterId,
          reporterName,
          reportedUserId: data.reportedUserId,
          reportedUserName: data.reportedUserName,
          reportedUserPhoto,
          reason: data.reason,
          createdAt: data.createdAt,
          status: data.status,
        });
      }

      reportsList.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setReports(reportsList);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDismiss = (report: Report) => {
    Alert.alert(
      'Dismiss Report',
      'The report will be marked as resolved with no action taken.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'reports', report.id), {
                status: 'resolved',
                resolvedAt: new Date().toISOString(),
                resolution: 'dismissed',
                resolvedBy: auth.currentUser?.uid,
              });
              Alert.alert('Done', 'Report dismissed');
              loadReports();
            } catch (error) {
              console.error('Error dismissing report:', error);
              Alert.alert('Error', 'Error dismissing report');
            }
          },
        },
      ]
    );
  };

  const handleBan = (report: Report) => {
    Alert.alert(
      'Ban User',
      `BAN ${report.reportedUserName}?\n\nThis will:\n- Prevent them from logging in\n- Hide their profile from all users\n- Mark this report as resolved`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Ban',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'users', report.reportedUserId), {
                isBanned: true,
                bannedAt: new Date().toISOString(),
                bannedBy: auth.currentUser?.uid,
                banReason: report.reason,
              });

              await updateDoc(doc(db, 'reports', report.id), {
                status: 'resolved',
                resolvedAt: new Date().toISOString(),
                resolution: 'banned',
                resolvedBy: auth.currentUser?.uid,
              });

              Alert.alert('Done', `${report.reportedUserName} has been banned`);
              loadReports();
            } catch (error) {
              console.error('Error banning user:', error);
              Alert.alert('Error', 'Error banning user');
            }
          },
        },
      ]
    );
  };

  const handleWarn = (report: Report) => {
    Alert.alert(
      'Warn User',
      `Send warning to ${report.reportedUserName}?\n\nThis will mark the report as resolved with a warning.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Warn',
          onPress: async () => {
            try {
              const userDoc = await getDoc(doc(db, 'users', report.reportedUserId));
              const currentWarnings = userDoc.data()?.warnings || 0;

              await updateDoc(doc(db, 'users', report.reportedUserId), {
                warnings: currentWarnings + 1,
                lastWarningAt: new Date().toISOString(),
                lastWarningReason: report.reason,
              });

              await updateDoc(doc(db, 'reports', report.id), {
                status: 'resolved',
                resolvedAt: new Date().toISOString(),
                resolution: 'warned',
                resolvedBy: auth.currentUser?.uid,
              });

              Alert.alert('Done', `Warning sent to ${report.reportedUserName}`);
              loadReports();
            } catch (error) {
              console.error('Error warning user:', error);
              Alert.alert('Error', 'Error warning user');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return (
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading reports...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>User Reports</Text>

      <View style={styles.filterTabs}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'pending' && styles.filterTabActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={[styles.filterTabText, filter === 'pending' && styles.filterTabTextActive]}>
            Pending
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'resolved' && styles.filterTabActive]}
          onPress={() => setFilter('resolved')}
        >
          <Text style={[styles.filterTabText, filter === 'resolved' && styles.filterTabTextActive]}>
            Resolved
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterTabText, filter === 'all' && styles.filterTabTextActive]}>
            All
          </Text>
        </TouchableOpacity>
      </View>

      {reports.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyText}>
            {filter === 'pending' ? 'No pending reports!' : 'No reports found'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadReports();
              }}
              tintColor="#53a8b6"
            />
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.reportCard,
                item.status === 'pending' && styles.reportCardPending,
              ]}
            >
              <View style={styles.reportHeader}>
                {item.reportedUserPhoto ? (
                  <Image
                    source={{ uri: item.reportedUserPhoto }}
                    style={styles.reportPhoto}
                  />
                ) : (
                  <View style={styles.reportPhotoPlaceholder}>
                    <Text style={styles.reportPhotoText}>?</Text>
                  </View>
                )}
                <View style={styles.reportInfo}>
                  <Text style={styles.reportedName}>{item.reportedUserName}</Text>
                  <Text style={styles.reporterText}>Reported by: {item.reporterName}</Text>
                  <Text style={styles.reportDate}>{formatDate(item.createdAt)}</Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    item.status === 'pending' ? styles.statusPending : styles.statusResolved,
                  ]}
                >
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
              </View>

              <View style={styles.reasonContainer}>
                <Text style={styles.reasonLabel}>Reason:</Text>
                <Text style={styles.reasonText}>{item.reason}</Text>
              </View>

              {item.status === 'pending' ? (
                <View style={styles.reportActions}>
                  <TouchableOpacity
                    style={styles.dismissButton}
                    onPress={() => handleDismiss(item)}
                  >
                    <Text style={styles.dismissButtonText}>Dismiss</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.warnButton}
                    onPress={() => handleWarn(item)}
                  >
                    <Text style={styles.warnButtonText}>Warn</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.banButton}
                    onPress={() => handleBan(item)}
                  >
                    <Text style={styles.banButtonText}>Ban</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16 },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 20,
    textAlign: 'center',
  },
  filterTabs: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 5,
  },
  filterTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  filterTabActive: { backgroundColor: '#53a8b6' },
  filterTabText: { color: '#888', fontSize: 14, fontWeight: '600' },
  filterTabTextActive: { color: '#fff' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 60, color: '#5cb85c', marginBottom: 15 },
  emptyText: { fontSize: 18, color: '#aaa' },
  reportCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15 },
  reportCardPending: { borderWidth: 2, borderColor: '#e74c3c' },
  reportHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  reportPhoto: { width: 50, height: 50, borderRadius: 25, marginRight: 12 },
  reportPhotoPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  reportPhotoText: { fontSize: 20, color: '#666' },
  reportInfo: { flex: 1 },
  reportedName: { fontSize: 16, fontWeight: 'bold', color: '#eee' },
  reporterText: { fontSize: 12, color: '#888', marginTop: 2 },
  reportDate: { fontSize: 11, color: '#666', marginTop: 2 },
  statusBadge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  statusPending: { backgroundColor: '#e74c3c' },
  statusResolved: { backgroundColor: '#5cb85c' },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  reasonContainer: {
    backgroundColor: '#0f3460',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  reasonLabel: { fontSize: 12, color: '#888', marginBottom: 5 },
  reasonText: { fontSize: 14, color: '#eee', lineHeight: 20 },
  reportActions: { flexDirection: 'row', gap: 10 },
  dismissButton: {
    flex: 1,
    backgroundColor: '#0f3460',
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
  },
  dismissButtonText: { color: '#888', fontSize: 14, fontWeight: '600' },
  warnButton: {
    flex: 1,
    backgroundColor: '#e67e22',
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
  },
  warnButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  banButton: {
    flex: 1,
    backgroundColor: '#e74c3c',
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
  },
  banButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});