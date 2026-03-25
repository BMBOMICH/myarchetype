import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { formatLastSeen } from '../utils/onlineStatus';

interface ProfileViewer {
  oduid: string;
  name: string;
  age: number;
  photo: string;
  viewedAt: any;
  selfieVerified: boolean;
  isMatch: boolean;
}

export default function ProfileViewsScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewers, setViewers] = useState<ProfileViewer[]>([]);
  const [totalViews, setTotalViews] = useState(0);

  useEffect(() => {
    loadProfileViews();
  }, []);

  const loadProfileViews = async () => {
    if (!user) {
      router.replace('/login');
      return;
    }

    try {
      // Get profile views from profileViews collection
      const viewsQuery = query(
        collection(db, 'profileViews'),
        where('viewedUserId', '==', user.uid),
        orderBy('viewedAt', 'desc')
      );

      const viewsSnapshot = await getDocs(viewsQuery);
      const viewersList: ProfileViewer[] = [];
      const viewerIds = new Set<string>();

      // Get matches to check if viewer is a match
      const matchesQuery = query(
        collection(db, 'likes'),
        where('status', '==', 'matched')
      );
      const matchesSnapshot = await getDocs(matchesQuery);
      const matchedUserIds = new Set<string>();

      matchesSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.fromUserId === user.uid) {
          matchedUserIds.add(data.toUserId);
        } else if (data.toUserId === user.uid) {
          matchedUserIds.add(data.fromUserId);
        }
      });

      // Process each view
      for (const viewDoc of viewsSnapshot.docs) {
        const viewData = viewDoc.data();
        const viewerId = viewData.viewerId;

        // Skip duplicates (only show most recent view per user)
        if (viewerIds.has(viewerId)) continue;
        viewerIds.add(viewerId);

        // Get viewer's profile
        try {
          const viewerDoc = await getDoc(doc(db, 'users', viewerId));
          if (viewerDoc.exists()) {
            const viewerData = viewerDoc.data();
            viewersList.push({
              oduid: viewerId,
              name: viewerData.name || 'Anonymous',
              age: viewerData.age || 0,
              photo: viewerData.photos?.[0] || '',
              viewedAt: viewData.viewedAt,
              selfieVerified: viewerData.selfieVerified || false,
              isMatch: matchedUserIds.has(viewerId),
            });
          }
        } catch (e) {
          console.log('Could not load viewer:', viewerId);
        }
      }

      setViewers(viewersList);
      setTotalViews(viewsSnapshot.size);

    } catch (error) {
      console.error('Error loading profile views:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadProfileViews();
  };

  const navigateToChat = (oduid: string, name: string) => {
    router.push({
      pathname: '/chat',
      params: { matchId: oduid, matchName: name }
    });
  };

  const formatViewTime = (timestamp: any): string => {
    if (!timestamp) return '';
    return formatLastSeen(timestamp);
  };

  const renderViewer = ({ item }: { item: ProfileViewer }) => (
    <View style={styles.viewerCard}>
      <View style={styles.viewerInfo}>
        {item.photo ? (
          <View style={styles.photoContainer}>
            <Image source={{ uri: item.photo }} style={styles.viewerPhoto} />
            {item.selfieVerified && (
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedText}>✓</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.viewerPhotoPlaceholder}>
            <Text style={styles.viewerPhotoText}>?</Text>
          </View>
        )}

        <View style={styles.viewerDetails}>
          <View style={styles.nameRow}>
            <Text style={styles.viewerName}>{item.name}, {item.age}</Text>
            {item.isMatch && (
              <View style={styles.matchBadge}>
                <Text style={styles.matchBadgeText}>Match 💕</Text>
              </View>
            )}
          </View>
          <Text style={styles.viewedTime}>Viewed {formatViewTime(item.viewedAt)}</Text>
        </View>
      </View>

      {item.isMatch && (
        <TouchableOpacity
          style={styles.chatButton}
          onPress={() => navigateToChat(item.oduid, item.name)}
        >
          <Text style={styles.chatButtonText}>Chat</Text>
        </TouchableOpacity>
      )}
    </View>
  );

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
      {/* HEADER STATS */}
      <View style={styles.statsCard}>
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
          <Text style={styles.emptyText}>
            When someone views your profile, they'll appear here.
          </Text>
          <TouchableOpacity
            style={styles.findMatchesButton}
            onPress={() => router.push('/matches')}
          >
            <Text style={styles.findMatchesButtonText}>Find Matches</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={viewers}
          keyExtractor={(item) => item.oduid}
          renderItem={renderViewer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#53a8b6"
            />
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={() => (
            <Text style={styles.listHeader}>Recent Viewers</Text>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#aaa',
    marginTop: 15,
    fontSize: 16,
  },
  statsCard: {
    backgroundColor: '#16213e',
    margin: 20,
    marginBottom: 10,
    borderRadius: 20,
    padding: 25,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e67e22',
  },
  statsIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  statsNumber: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#e67e22',
  },
  statsLabel: {
    color: '#888',
    fontSize: 14,
    marginTop: 5,
  },
  listContent: {
    padding: 20,
    paddingTop: 10,
  },
  listHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#53a8b6',
    marginBottom: 15,
  },
  viewerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 15,
    marginBottom: 10,
  },
  viewerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  photoContainer: {
    position: 'relative',
  },
  viewerPhoto: {
    width: 55,
    height: 55,
    borderRadius: 28,
  },
  viewerPhotoPlaceholder: {
    width: 55,
    height: 55,
    borderRadius: 28,
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerPhotoText: {
    color: '#666',
    fontSize: 24,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#3498db',
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#16213e',
  },
  verifiedText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  viewerDetails: {
    marginLeft: 15,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  viewerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#eee',
  },
  matchBadge: {
    backgroundColor: '#5cb85c',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  matchBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  viewedTime: {
    color: '#888',
    fontSize: 12,
    marginTop: 3,
  },
  chatButton: {
    backgroundColor: '#53a8b6',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  chatButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 30,
  },
  findMatchesButton: {
    backgroundColor: '#53a8b6',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  findMatchesButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});