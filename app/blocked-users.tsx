import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';

interface BlockedUser { uid: string; name: string; photos?: string[]; }

export default function BlockedUsersScreen() {
  const router = useRouter();
  const [loading, setLoading]           = useState(true);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);

  const loadBlockedUsers = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) { router.replace('/login'); return; }
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) { setLoading(false); return; }
      const blockedIds: string[] = userDoc.data().blockedUsers ?? [];
      const list: BlockedUser[] = await Promise.all(
        blockedIds.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'users', id));
            if (snap.exists()) {
              const d = snap.data();
              return { uid: id, name: d.name || 'Unknown User', photos: d.photos ?? [] };
            }
            return { uid: id, name: 'Deleted User', photos: [] };
          } catch (e) {
            logger.error('[BlockedUsers] load single user error:', e);
            return { uid: id, name: 'Unknown User', photos: [] };
          }
        })
      );
      setBlockedUsers(list);
    } catch (error) {
      logger.error('[BlockedUsers] loadBlockedUsers error:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { loadBlockedUsers(); }, [loadBlockedUsers]);

  const confirmUnblock = useCallback(async (blockedUser: BlockedUser) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const snap    = await getDoc(doc(db, 'users', user.uid));
      const current: string[] = snap.data()?.blockedUsers ?? [];
      await updateDoc(doc(db, 'users', user.uid), {
        blockedUsers: current.filter(id => id !== blockedUser.uid),
      });
      setBlockedUsers(prev => prev.filter(u => u.uid !== blockedUser.uid));
      Alert.alert('Done', `${blockedUser.name} has been unblocked`);
    } catch (error) {
      logger.error('[BlockedUsers] unblock error:', error);
      Alert.alert('Error', 'Error unblocking user');
    }
  }, []);

  const handleUnblock = useCallback((blockedUser: BlockedUser) => {
    Alert.alert(
      'Unblock User',
      `Unblock ${blockedUser.name}?\n\nThey will be able to see your profile and send you messages again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: () => confirmUnblock(blockedUser) },
      ]
    );
  }, [confirmUnblock]);

  const handleBack = useCallback(() => router.back(), [router]);

  const renderItem = useCallback(({ item }: { item: BlockedUser }) => (
    <View style={styles.userCard}>
      {item.photos && item.photos.length > 0 ? (
        <Image
          source={{ uri: item.photos[0] }}
          style={styles.userPhoto}
          accessibilityLabel={`Photo of ${item.name}`}
        />
      ) : (
        <View style={styles.userPhotoPlaceholder} accessibilityLabel={`No photo for ${item.name}`}>
          <Text style={styles.userPhotoText}>?</Text>
        </View>
      )}
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.name}</Text>
        <Text style={styles.blockedText}>Blocked</Text>
      </View>
      <TouchableOpacity
        style={styles.unblockButton}
        onPress={() => handleUnblock(item)}
        accessibilityLabel={`Unblock ${item.name}`}
        accessibilityRole="button"
      >
        <Text style={styles.unblockButtonText}>Unblock</Text>
      </TouchableOpacity>
    </View>
  ), [handleUnblock]);

  const keyExtractor = useCallback((item: BlockedUser) => item.uid, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading blocked users...</Text>
      </View>
    );
  }

  if (blockedUsers.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon} accessibilityElementsHidden>✓</Text>
        <Text style={styles.emptyTitle} accessibilityRole="header">No Blocked Users</Text>
        <Text style={styles.emptyText}>You haven't blocked anyone yet.</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
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
      <FlatList
        data={blockedUsers}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#1a1a2e', padding: 20, paddingTop: 60 },
  loadingContainer:     { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText:          { color: '#aaa', marginTop: 15, fontSize: 16 },
  emptyContainer:       { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyIcon:            { fontSize: 80, color: '#5cb85c', marginBottom: 20 },
  emptyTitle:           { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  emptyText:            { fontSize: 16, color: '#aaa', textAlign: 'center', marginBottom: 30 },
  backButton:           { backgroundColor: '#53a8b6', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  backButtonText:       { color: '#fff', fontSize: 16, fontWeight: '600' },
  title:                { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 5, textAlign: 'center' },
  subtitle:             { fontSize: 14, color: '#888', marginBottom: 25, textAlign: 'center' },
  userCard:             { backgroundColor: '#16213e', borderRadius: 15, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  userPhoto:            { width: 50, height: 60, borderRadius: 10, marginRight: 15 },
  userPhotoPlaceholder: { width: 50, height: 60, borderRadius: 10, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  userPhotoText:        { fontSize: 20, color: '#666' },
  userInfo:             { flex: 1 },
  userName:             { fontSize: 16, fontWeight: '600', color: '#eee' },
  blockedText:          { fontSize: 12, color: '#e74c3c', marginTop: 3 },
  unblockButton:        { backgroundColor: '#5cb85c', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20 },
  unblockButtonText:    { color: '#fff', fontSize: 14, fontWeight: '600' },
});