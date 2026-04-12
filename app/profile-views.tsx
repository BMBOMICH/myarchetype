import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';
import { formatLastSeen } from '../utils/onlineStatus';

interface ProfileViewer {
  oduid: string; name: string; age: number; photo: string;
  viewedAt: { toMillis?: () => number } | null;
  selfieVerified: boolean; isMatch: boolean;
}

export default function ProfileViewsScreen() {
  const router  = useRouter();
  const user    = auth.currentUser;

  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewers, setViewers]     = useState<ProfileViewer[]>([]);
  const [totalViews, setTotalViews] = useState(0);

  const loadProfileViews = useCallback(async () => {
    if (!user) { router.replace('/login'); return; }
    try {
      const viewsSnap = await getDocs(query(
        collection(db, 'profileViews'),
        where('viewedUserId', '==', user.uid),
        orderBy('viewedAt', 'desc'),
      ));

      const matchesSnap = await getDocs(query(
        collection(db, 'likes'),
        where('status', '==', 'matched'),
      ));
      const matchedIds = new Set<string>();
      matchesSnap.forEach((d) => {
        const data = d.data();
        if (data.fromUserId === user.uid) matchedIds.add(data.toUserId as string);
        else if (data.toUserId === user.uid) matchedIds.add(data.fromUserId as string);
      });

      const seen = new Set<string>();
      const list: ProfileViewer[] = [];

      for (const viewDoc of viewsSnap.docs) {
        const viewData = viewDoc.data();
        const viewerId = viewData.viewerId as string;
        if (seen.has(viewerId)) continue;
        seen.add(viewerId);
        try {
          const snap = await getDoc(doc(db, 'users', viewerId));
          if (snap.exists()) {
            const d = snap.data();
            list.push({
              oduid: viewerId,
              name: d.name || 'Anonymous',
              age: d.age || 0,
              photo: d.photos?.[0] || '',
              viewedAt: viewData.viewedAt ?? null,
              selfieVerified: d.selfieVerified || false,
              isMatch: matchedIds.has(viewerId),
            });
          }
        } catch (e) {
          logger.warn('[ProfileViews] Could not load viewer:', viewerId);
        }
      }

      setViewers(list);
      setTotalViews(viewsSnap.size);
    } catch (error) {
      logger.error('[ProfileViews] loadProfileViews error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, router]);

  useEffect(() => { loadProfileViews(); }, [loadProfileViews]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadProfileViews();
  }, [loadProfileViews]);

  const navigateToChat = useCallback((oduid: string, name: string) => {
    router.push({ pathname: '/chat', params: { matchId: oduid, matchName: name } });
  }, [router]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading views...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.statsCard} accessibilityLabel={`${totalViews} people viewed your profile`}>
        <Text style={styles.statsIcon}>👀</Text>
        <Text style={styles.statsNumber}>{totalViews}</Text>
        <Text style={styles.statsLabel}>
          {totalViews === 1 ? 'person viewed your profile' : 'people viewed your profile'}
        </Text>
      </View>

      {viewers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>👀</Text>
          <Text style={styles.emptyTitle}>No views yet</Text>
          <Text style={styles.emptyText}>When someone views your profile, they'll appear here.</Text>
          <TouchableOpacity
            style={styles.findMatchesButton}
            onPress={() => router.push('/matches')}
            accessibilityLabel="Find matches"
            accessibilityRole="button"
          >
            <Text style={styles.findMatchesButtonText}>Find Matches</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={viewers}
          keyExtractor={(item) => item.oduid}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#53a8b6" />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={() => <Text style={styles.listHeader}>Recent Viewers</Text>}
          renderItem={({ item }) => (
            <View style={styles.viewerCard}>
              <View style={styles.viewerInfo}>
                {item.photo ? (
                  <View style={styles.photoContainer}>
                    <Image
                      source={{ uri: item.photo }}
                      style={styles.viewerPhoto}
                      accessibilityLabel={`Photo of ${item.name}`}
                    />
                    {item.selfieVerified && (
                      <View style={styles.verifiedBadge} accessibilityLabel="Verified user">
                        <Text style={styles.verifiedText}>✓</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.viewerPhotoPlaceholder} accessibilityLabel={`No photo for ${item.name}`}>
                    <Text style={styles.viewerPhotoText}>?</Text>
                  </View>
                )}
                <View style={styles.viewerDetails}>
                  <View style={styles.nameRow}>
                    <Text style={styles.viewerName}>{item.name}, {item.age}</Text>
                    {item.isMatch && (
                      <View style={styles.matchBadge} accessibilityLabel="You are matched">
                        <Text style={styles.matchBadgeText}>Match 💕</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.viewedTime}>
                    Viewed {item.viewedAt ? formatLastSeen(item.viewedAt) : ''}
                  </Text>
                </View>
              </View>
              {item.isMatch && (
                <TouchableOpacity
                  style={styles.chatButton}
                  onPress={() => navigateToChat(item.oduid, item.name)}
                  accessibilityLabel={`Chat with ${item.name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.chatButtonText}>Chat</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16 },
  statsCard: { backgroundColor: '#16213e', margin: 20, marginBottom: 10, borderRadius: 20, padding: 25, alignItems: 'center', borderWidth: 2, borderColor: '#e67e22' },
  statsIcon: { fontSize: 40, marginBottom: 10 },
  statsNumber: { fontSize: 48, fontWeight: 'bold', color: '#e67e22' },
  statsLabel: { color: '#888', fontSize: 14, marginTop: 5 },
  listContent: { padding: 20, paddingTop: 10 },
  listHeader: { fontSize: 16, fontWeight: '600', color: '#53a8b6', marginBottom: 15 },
  viewerCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 10 },
  viewerInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  photoContainer: { position: 'relative' },
  viewerPhoto: { width: 55, height: 55, borderRadius: 28 },
  viewerPhotoPlaceholder: { width: 55, height: 55, borderRadius: 28, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  viewerPhotoText: { color: '#666', fontSize: 24 },
  verifiedBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#3498db', borderRadius: 10, width: 18, height: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#16213e' },
  verifiedText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  viewerDetails: { marginLeft: 15, flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  viewerName: { fontSize: 16, fontWeight: '600', color: '#eee' },
  matchBadge: { backgroundColor: '#5cb85c', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  matchBadgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  viewedTime: { color: '#888', fontSize: 12, marginTop: 3 },
  chatButton: { backgroundColor: '#53a8b6', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20 },
  chatButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 60, marginBottom: 20 },
  emptyTitle: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  emptyText: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 30 },
  findMatchesButton: { backgroundColor: '#53a8b6', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25 },
  findMatchesButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});