import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';

interface BlockedUser {
  uid: string;
  name: string;
  photos?: string[];
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);

  useEffect(() => {
    loadBlockedUsers();
  }, []);

  const loadBlockedUsers = async () => {
    const user = auth.currentUser;
    if (!user) {
      router.replace('/login');
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (!userDoc.exists()) {
        setLoading(false);
        return;
      }

      const blockedIds = userDoc.data().blockedUsers || [];
      const blockedList: BlockedUser[] = [];

      for (const blockedId of blockedIds) {
        try {
          const blockedDoc = await getDoc(doc(db, 'users', blockedId));
          if (blockedDoc.exists()) {
            const data = blockedDoc.data();
            blockedList.push({
              uid: blockedId,
              name: data.name || 'Unknown User',
              photos: data.photos || [],
            });
          } else {
            // User was deleted
            blockedList.push({
              uid: blockedId,
              name: 'Deleted User',
              photos: [],
            });
          }
        } catch (e) {
          console.error('Error loading blocked user:', e);
        }
      }

      setBlockedUsers(blockedList);
    } catch (error) {
      console.error('Error loading blocked users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUnblock = async (blockedUser: BlockedUser) => {
    const user = auth.currentUser;
    if (!user) return;

    const confirmed = window.confirm(
      'Unblock ' + blockedUser.name + '?\n\n' +
      'They will be able to see your profile and send you messages again.'
    );

    if (!confirmed) return;

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const currentBlocked = userDoc.data()?.blockedUsers || [];
      
      const newBlocked = currentBlocked.filter((id: string) => id !== blockedUser.uid);

      await updateDoc(doc(db, 'users', user.uid), {
        blockedUsers: newBlocked,
      });

      setBlockedUsers(blockedUsers.filter((u) => u.uid !== blockedUser.uid));
      window.alert(blockedUser.name + ' has been unblocked');

    } catch (error) {
      console.error('Error unblocking:', error);
      window.alert('Error unblocking user');
    }
  };

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
        <Text style={styles.emptyIcon}>✓</Text>
        <Text style={styles.emptyTitle}>No Blocked Users</Text>
        <Text style={styles.emptyText}>
          You haven't blocked anyone yet.
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Blocked Users</Text>
      <Text style={styles.subtitle}>
        {blockedUsers.length} blocked user{blockedUsers.length !== 1 ? 's' : ''}
      </Text>

      <FlatList
        data={blockedUsers}
        keyExtractor={(item) => item.uid}
        renderItem={({ item }) => (
          <View style={styles.userCard}>
            {item.photos && item.photos.length > 0 ? (
              <Image source={{ uri: item.photos[0] }} style={styles.userPhoto} />
            ) : (
              <View style={styles.userPhotoPlaceholder}>
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
            >
              <Text style={styles.unblockButtonText}>Unblock</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16 },
  emptyContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyIcon: { fontSize: 80, color: '#5cb85c', marginBottom: 20 },
  emptyTitle: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  emptyText: { fontSize: 16, color: '#aaa', textAlign: 'center', marginBottom: 30 },
  backButton: { backgroundColor: '#53a8b6', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 20 },
  backButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 5, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 25, textAlign: 'center' },
  userCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  userPhoto: { width: 50, height: 60, borderRadius: 10, marginRight: 15 },
  userPhotoPlaceholder: { width: 50, height: 60, borderRadius: 10, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  userPhotoText: { fontSize: 20, color: '#666' },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '600', color: '#eee' },
  blockedText: { fontSize: 12, color: '#e74c3c', marginTop: 3 },
  unblockButton: { backgroundColor: '#5cb85c', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20 },
  unblockButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});