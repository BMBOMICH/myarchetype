import { useRouter } from 'expo-router';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { db } from '../../firebaseConfig';

interface User {
  uid: string;
  name: string;
  email: string;
  age: number;
  gender: string;
  photos?: string[];
  selfieVerified?: boolean;
  isBanned?: boolean;
  isAdmin?: boolean;
  warnings?: number;
  createdAt: string;
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'unverified' | 'banned'>('all');

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [users, searchQuery, filter]);

  const loadUsers = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const usersList: User[] = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        usersList.push({
          uid: docSnap.id,
          name: data.name || 'Unknown',
          email: data.email || '',
          age: data.age || 0,
          gender: data.gender || '',
          photos: data.photos || [],
          selfieVerified: data.selfieVerified || false,
          isBanned: data.isBanned || false,
          isAdmin: data.isAdmin || false,
          warnings: data.warnings || 0,
          createdAt: data.createdAt || '',
        });
      });

      // Sort by created date (newest first)
      usersList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setUsers(usersList);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...users];

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (u) =>
          u.name.toLowerCase().includes(query) ||
          u.email.toLowerCase().includes(query)
      );
    }

    // Apply filter
    switch (filter) {
      case 'verified':
        filtered = filtered.filter((u) => u.selfieVerified);
        break;
      case 'unverified':
        filtered = filtered.filter((u) => !u.selfieVerified);
        break;
      case 'banned':
        filtered = filtered.filter((u) => u.isBanned);
        break;
    }

    setFilteredUsers(filtered);
  };

  const handleBan = async (user: User) => {
    const action = user.isBanned ? 'unban' : 'ban';
    const confirmed = window.confirm(
      (user.isBanned ? 'Unban ' : 'Ban ') + user.name + '?'
    );

    if (!confirmed) return;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        isBanned: !user.isBanned,
        bannedAt: user.isBanned ? null : new Date().toISOString(),
      });

      window.alert(user.name + ' has been ' + (user.isBanned ? 'unbanned' : 'banned'));
      loadUsers();
    } catch (error) {
      console.error('Error:', error);
      window.alert('Error updating user');
    }
  };

  const handleVerify = async (user: User) => {
    const confirmed = window.confirm(
      'Manually verify ' + user.name + '?\n\n' +
      'This will give them a verified badge without selfie verification.'
    );

    if (!confirmed) return;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        selfieVerified: true,
        selfieVerifiedAt: new Date().toISOString(),
        manuallyVerified: true,
      });

      window.alert(user.name + ' has been verified');
      loadUsers();
    } catch (error) {
      console.error('Error:', error);
      window.alert('Error verifying user');
    }
  };

  const handleMakeAdmin = async (user: User) => {
    const action = user.isAdmin ? 'remove admin' : 'make admin';
    const confirmed = window.confirm(
      (user.isAdmin ? 'Remove admin from ' : 'Make ' + user.name + ' an admin?')
    );

    if (!confirmed) return;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        isAdmin: !user.isAdmin,
      });

      window.alert(user.name + (user.isAdmin ? ' is no longer an admin' : ' is now an admin'));
      loadUsers();
    } catch (error) {
      console.error('Error:', error);
      window.alert('Error updating user');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading users...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Manage Users</Text>
      <Text style={styles.subtitle}>{users.length} total users</Text>

      {/* Search */}
      <TextInput
        style={styles.searchInput}
        placeholder="Search by name or email..."
        placeholderTextColor="#666"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {/* Filter Tabs */}
      <View style={styles.filterTabs}>
        {(['all', 'verified', 'unverified', 'banned'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.resultsCount}>
        Showing {filteredUsers.length} of {users.length} users
      </Text>

      <FlatList
        data={filteredUsers}
        keyExtractor={(item) => item.uid}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadUsers();
            }}
            tintColor="#53a8b6"
          />
        }
        renderItem={({ item }) => (
          <View style={[styles.userCard, item.isBanned && styles.userCardBanned]}>
            <View style={styles.userHeader}>
              {item.photos && item.photos.length > 0 ? (
                <Image source={{ uri: item.photos[0] }} style={styles.userPhoto} />
              ) : (
                <View style={styles.userPhotoPlaceholder}>
                  <Text style={styles.userPhotoText}>?</Text>
                </View>
              )}
              <View style={styles.userInfo}>
                <View style={styles.userNameRow}>
                  <Text style={styles.userName}>{item.name}</Text>
                  {item.selfieVerified ? (
                    <Text style={styles.verifiedBadge}>✓</Text>
                  ) : null}
                  {item.isAdmin ? (
                    <Text style={styles.adminBadge}>Admin</Text>
                  ) : null}
                  {item.isBanned ? (
                    <Text style={styles.bannedBadge}>Banned</Text>
                  ) : null}
                </View>
                <Text style={styles.userEmail}>{item.email}</Text>
                <Text style={styles.userDetails}>
                  {item.age} y/o {item.gender}
                  {item.warnings ? ' • ' + item.warnings + ' warnings' : ''}
                </Text>
              </View>
            </View>

            <View style={styles.userActions}>
              {!item.selfieVerified ? (
                <TouchableOpacity
                  style={styles.verifyButton}
                  onPress={() => handleVerify(item)}
                >
                  <Text style={styles.verifyButtonText}>Verify</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={item.isBanned ? styles.unbanButton : styles.banButton}
                onPress={() => handleBan(item)}
              >
                <Text style={styles.banButtonText}>
                  {item.isBanned ? 'Unban' : 'Ban'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.adminButton}
                onPress={() => handleMakeAdmin(item)}
              >
                <Text style={styles.adminButtonText}>
                  {item.isAdmin ? 'Remove Admin' : 'Make Admin'}
                </Text>
              </TouchableOpacity>
            </View>
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
  title: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 5, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 20, textAlign: 'center' },
  searchInput: { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 10, fontSize: 16, marginBottom: 15 },
  filterTabs: { flexDirection: 'row', marginBottom: 15, backgroundColor: '#16213e', borderRadius: 10, padding: 5 },
  filterTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  filterTabActive: { backgroundColor: '#53a8b6' },
  filterTabText: { color: '#888', fontSize: 12, fontWeight: '600' },
  filterTabTextActive: { color: '#fff' },
  resultsCount: { color: '#666', fontSize: 12, marginBottom: 15 },
  userCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 12 },
  userCardBanned: { borderWidth: 2, borderColor: '#e74c3c', opacity: 0.7 },
  userHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  userPhoto: { width: 50, height: 60, borderRadius: 10, marginRight: 12 },
  userPhotoPlaceholder: { width: 50, height: 60, borderRadius: 10, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userPhotoText: { fontSize: 20, color: '#666' },
  userInfo: { flex: 1 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  userName: { fontSize: 16, fontWeight: 'bold', color: '#eee' },
  verifiedBadge: { fontSize: 14, color: '#3498db' },
  adminBadge: { backgroundColor: '#9b59b6', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, fontSize: 10, color: '#fff', overflow: 'hidden' },
  bannedBadge: { backgroundColor: '#e74c3c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, fontSize: 10, color: '#fff', overflow: 'hidden' },
  userEmail: { fontSize: 12, color: '#888', marginTop: 2 },
  userDetails: { fontSize: 11, color: '#666', marginTop: 2 },
  userActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  verifyButton: { backgroundColor: '#3498db', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  verifyButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  banButton: { backgroundColor: '#e74c3c', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  unbanButton: { backgroundColor: '#5cb85c', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  banButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  adminButton: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  adminButtonText: { color: '#9b59b6', fontSize: 12, fontWeight: '600' },
});