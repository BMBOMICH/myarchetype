import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import { arrayRemove, doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Text, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';

export interface BlockedUser {
  uid: string;
  name: string;
  photos?: string[];
}

async function fetchBlockedUsers(userId: string): Promise<BlockedUser[]> {
  const userDoc = await getDoc(doc(db, 'users', userId));
  if (!userDoc.exists()) {
    return [];
  }

  const data = userDoc.data();
  const blockedIds = Array.isArray(data?.blockedUsers)
    ? data.blockedUsers.filter((id): id is string => typeof id === 'string')
    : [];

  const users = await Promise.all(
    blockedIds.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          const d = snap.data();
          const name = typeof d?.name === 'string' ? d.name : 'Unknown User';
          const photos = Array.isArray(d?.photos)
            ? d.photos.filter((p): p is string => typeof p === 'string' && p.startsWith('https://'))
            : [];
          return { uid, name, photos };
        }
        return { uid, name: 'Deleted User', photos: [] };
      } catch (e) {
        logger.error('[BlockedUsers] fetch single user error:', e);
        return { uid, name: 'Unknown User', photos: [] };
      }
    }),
  );

  return users;
}

async function unblockUser(userId: string, blockedUid: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId), {
    blockedUsers: arrayRemove(blockedUid),
  });
}

export default function BlockedUsersScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);

  const loadBlockedUsers = useCallback(async (isRefresh = false) => {
    const user = auth.currentUser;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isRefresh) {
      setLoading(true);
    }
    try {
      const list = await fetchBlockedUsers(user.uid);
      setBlockedUsers(list);
    } catch (error) {
      logger.error('[BlockedUsers] loadBlockedUsers error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void loadBlockedUsers();
  }, [loadBlockedUsers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadBlockedUsers(true);
  }, [loadBlockedUsers]);

  const executeUnblock = useCallback(async (blockedUser: BlockedUser) => {
    const user = auth.currentUser;
    if (!user) {
      return;
    }
    try {
      await unblockUser(user.uid, blockedUser.uid);
      setBlockedUsers((prev) => prev.filter((u) => u.uid !== blockedUser.uid));
      Alert.alert('Done', `${blockedUser.name} has been unblocked`);
    } catch (error) {
      logger.error('[BlockedUsers] unblock error:', error);
      Alert.alert('Error', 'Error unblocking user');
    }
  }, []);

  const promptUnblock = useCallback((blockedUser: BlockedUser) => {
    Alert.alert(
      'Unblock User',
      `Unblock ${blockedUser.name}?\n\nThey will be able to see your profile and send you messages again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: () => void executeUnblock(blockedUser) },
      ],
    );
  }, [executeUnblock]);

  const handleBack = useCallback(() => router.back(), [router]);

  const keyExtractor = useCallback((item: BlockedUser) => item.uid, []);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<BlockedUser>) => (
      <View style={styles.userCard}>
        {typeof item.photos?.[0] === 'string' && item.photos[0].startsWith('https://') ? (
          <Image
            source={{ uri: item.photos[0] }}
            style={styles.userPhoto}
            accessibilityLabel={`Photo of ${item.name}`}
          />
        ) : (
          <View
            style={styles.userPhotoPlaceholder}
            accessibilityLabel={`No photo for ${item.name}`}
          >
            <Text style={styles.userPhotoText}>?</Text>
          </View>
        )}
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{item.name}</Text>
          <Text style={styles.blockedText}>Blocked</Text>
        </View>
        <TouchableOpacity
          style={styles.unblockButton}
          onPress={() => promptUnblock(item)}
          accessibilityLabel={`Unblock ${item.name}`}
          accessibilityRole="button"
          accessibilityHint="Double tap to show unblock confirmation"
          testID={`unblock-button-${item.uid}`}
        >
          <Text style={styles.unblockButtonText}>Unblock</Text>
        </TouchableOpacity>
      </View>
    ),
    [promptUnblock],
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer} testID="blocked-users-loading">
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading blocked users...</Text>
      </View>
    );
  }

  if (blockedUsers.length === 0) {
    return (
      <View
        style={styles.emptyContainer}
        accessible
        accessibilityRole="summary"
        accessibilityLabel="No blocked users. You haven't blocked anyone yet."
        testID="blocked-users-empty-state"
      >
        <Text style={styles.emptyIcon} accessibilityElementsHidden>✓</Text>
        <Text style={styles.emptyTitle} accessibilityRole="header">No Blocked Users</Text>
        <Text style={styles.emptyText}>You haven't blocked anyone yet.</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          testID="blocked-users-back-button"
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">Blocked Users</Text>
      <Text style={styles.subtitle}>
        {blockedUsers.length} blocked user{blockedUsers.length !== 1 ? 's' : ''}
      </Text>
      <LegendList
        data={blockedUsers}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        estimatedItemSize={90}
        recycleItems
        accessibilityLabel="Blocked users list"
        accessibilityRole="list"
        refreshing={refreshing}
        onRefresh={onRefresh}
        testID="blocked-users-list"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: 20, paddingTop: 60 },
  loadingContainer: { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: theme.colors.textSecondary, marginTop: 15, fontSize: 16 },
  emptyContainer: { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyIcon: { fontSize: 80, color: '#5cb85c', marginBottom: 20 },
  emptyTitle: { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10 },
  emptyText: { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 30 },
  backButton: { backgroundColor: theme.colors.primary, paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  backButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 5, textAlign: 'center' },
  subtitle: { fontSize: 14, color: theme.colors.textSecondary, marginBottom: 25, textAlign: 'center' },
  userCard: { backgroundColor: theme.colors.surface, borderRadius: 15, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  userPhoto: { width: 50, height: 60, borderRadius: 10, marginRight: 15 },
  userPhotoPlaceholder: { width: 50, height: 60, borderRadius: 10, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  userPhotoText: { fontSize: 20, color: theme.colors.textSecondary },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  blockedText: { fontSize: 12, color: theme.colors.error, marginTop: 3 },
  unblockButton: { backgroundColor: '#5cb85c', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20 },
  unblockButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
}));