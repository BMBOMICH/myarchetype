// app/admin/users.tsx
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image,
  RefreshControl, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../../firebaseConfig';
import { logger } from '../../utils/logger';

interface User {
  uid: string; name: string; email: string; age: number; gender: string;
  photos?: string[]; selfieVerified?: boolean; isBanned?: boolean;
  isAdmin?: boolean; warnings?: number; createdAt: string;
}
type FilterType = 'all' | 'verified' | 'unverified' | 'banned';

export default function AdminUsersScreen() {
  const router = useRouter();
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [isAdmin, setIsAdmin]         = useState(false);
  const [users, setUsers]             = useState<User[]>([]);
  const [filteredUsers, setFiltered]  = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter]           = useState<FilterType>('all');

  const checkAdmin = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) { router.replace('/login'); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists() || !(snap.data().isAdmin as boolean | undefined)) {
        router.replace('/home'); return;
      }
      setIsAdmin(true);
    } catch (error) {
      logger.error('[AdminUsers] admin check failed:', error);
      router.replace('/home');
    }
  }, [router]);

  useEffect(() => { void checkAdmin(); }, [checkAdmin]);

  const loadUsers = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const list: User[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id, name: String(data.name ?? 'Unknown'), email: String(data.email ?? ''),
          age: Number(data.age ?? 0), gender: String(data.gender ?? ''),
          photos: data.photos as string[] | undefined ?? [],
          selfieVerified: data.selfieVerified as boolean | undefined ?? false,
          isBanned:       data.isBanned       as boolean | undefined ?? false,
          isAdmin:        data.isAdmin        as boolean | undefined ?? false,
          warnings:       data.warnings       as number  | undefined ?? 0,
          createdAt: String(data.createdAt ?? ''),
        };
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setUsers(list);
    } catch (error) {
      logger.error('[AdminUsers] loadUsers error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) void loadUsers(); }, [isAdmin, loadUsers]);

  useEffect(() => {
    let result = [...users];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    switch (filter) {
      case 'verified':   result = result.filter(u => u.selfieVerified); break;
      case 'unverified': result = result.filter(u => !u.selfieVerified); break;
      case 'banned':     result = result.filter(u => u.isBanned); break;
    }
    setFiltered(result);
  }, [users, searchQuery, filter]);

  const handleRefresh = useCallback(() => { setRefreshing(true); void loadUsers(); }, [loadUsers]);

  const handleBan = useCallback((user: User) => {
    const label = user.isBanned ? 'Unban' : 'Ban';
    Alert.alert(`${label} User`, `${label} ${user.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, style: 'destructive', onPress: async () => {
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            isBanned: !user.isBanned,
            bannedAt: user.isBanned ? null : new Date().toISOString(),
          });
          Alert.alert('Done', `${user.name} has been ${user.isBanned ? 'unbanned' : 'banned'}`);
          void loadUsers();
        } catch (error) {
          logger.error('[AdminUsers] ban error:', error);
          Alert.alert('Error', 'Error updating user');
        }
      }},
    ]);
  }, [loadUsers]);

  const handleVerify = useCallback((user: User) => {
    Alert.alert('Verify User', `Manually verify ${user.name}?\nThis gives them a verified badge without selfie verification.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Verify', onPress: async () => {
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            selfieVerified: true, selfieVerifiedAt: new Date().toISOString(), manuallyVerified: true,
          });
          Alert.alert('Done', `${user.name} has been verified`);
          void loadUsers();
        } catch (error) {
          logger.error('[AdminUsers] verify error:', error);
          Alert.alert('Error', 'Error verifying user');
        }
      }},
    ]);
  }, [loadUsers]);

  const handleMakeAdmin = useCallback((user: User) => {
    const label = user.isAdmin ? 'Remove Admin' : 'Make Admin';
    Alert.alert(label, user.isAdmin ? `Remove admin from ${user.name}?` : `Make ${user.name} an admin?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, onPress: async () => {
        try {
          await updateDoc(doc(db, 'users', user.uid), { isAdmin: !user.isAdmin });
          Alert.alert('Done', `${user.name} ${user.isAdmin ? 'is no longer an admin' : 'is now an admin'}`);
          void loadUsers();
        } catch (error) {
          logger.error('[AdminUsers] makeAdmin error:', error);
          Alert.alert('Error', 'Error updating user');
        }
      }},
    ]);
  }, [loadUsers]);

  if (!isAdmin || loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={s.loadingText}>{!isAdmin ? 'Verifying admin access...' : 'Loading users...'}</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={s.title} accessibilityRole="header">Manage Users</Text>
      <Text style={s.subtitle}>{users.length} total users</Text>

      <TextInput
        style={s.searchInput} placeholder="Search by name or email..."
        placeholderTextColor="#666" value={searchQuery} onChangeText={setSearchQuery}
        accessibilityLabel="Search users" autoCapitalize="none" autoCorrect={false}
      />

      <View style={s.filterTabs} accessibilityRole="tablist">
        {(['all', 'verified', 'unverified', 'banned'] as const).map((f) => (
          <TouchableOpacity key={f} style={[s.filterTab, filter === f && s.filterTabActive]}
            onPress={() => setFilter(f)} accessibilityLabel={`Filter by ${f}`}
            accessibilityRole="tab" accessibilityState={{ selected: filter === f }}>
            <Text style={[s.filterTabText, filter === f && s.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.resultsCount} accessibilityLiveRegion="polite">
        Showing {filteredUsers.length} of {users.length} users
      </Text>

      <FlatList
        data={filteredUsers}
        keyExtractor={(item) => item.uid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#53a8b6" />}
        ListEmptyComponent={<View style={s.emptyContainer}><Text style={s.emptyText}>No users found</Text></View>}
        renderItem={({ item }) => (
          <View style={[s.userCard, item.isBanned && s.userCardBanned]}
            accessibilityLabel={`User: ${item.name}, ${item.age} years old, ${item.gender}${item.isBanned ? ', banned' : ''}${item.selfieVerified ? ', verified' : ''}`}>
            <View style={s.userHeader}>
              {item.photos && item.photos.length > 0 ? (
                <Image source={{ uri: item.photos[0] }} style={s.userPhoto} accessibilityLabel={`Photo of ${item.name}`} />
              ) : (
                <View style={s.userPhotoPlaceholder} accessibilityLabel={`No photo for ${item.name}`}>
                  <Text style={s.userPhotoText}>?</Text>
                </View>
              )}
              <View style={s.userInfo}>
                <View style={s.userNameRow}>
                  <Text style={s.userName}>{item.name}</Text>
                  {item.selfieVerified && <Text style={s.verifiedBadge} accessibilityLabel="Verified">✓</Text>}
                  {item.isAdmin  && <Text style={s.adminBadge}>Admin</Text>}
                  {item.isBanned && <Text style={s.bannedBadge}>Banned</Text>}
                </View>
                <Text style={s.userEmail}>{item.email}</Text>
                <Text style={s.userDetails}>
                  {item.age} y/o {item.gender}{item.warnings ? ` • ${item.warnings} warnings` : ''}
                </Text>
              </View>
            </View>
            <View style={s.userActions}>
              {!item.selfieVerified && (
                <TouchableOpacity style={s.verifyButton} onPress={() => handleVerify(item)}
                  accessibilityLabel={`Verify ${item.name}`} accessibilityRole="button">
                  <Text style={s.verifyButtonText}>Verify</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={item.isBanned ? s.unbanButton : s.banButton} onPress={() => handleBan(item)}
                accessibilityLabel={`${item.isBanned ? 'Unban' : 'Ban'} ${item.name}`} accessibilityRole="button">
                <Text style={s.banButtonText}>{item.isBanned ? 'Unban' : 'Ban'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.adminButton} onPress={() => handleMakeAdmin(item)}
                accessibilityLabel={`${item.isAdmin ? 'Remove admin from' : 'Make admin'} ${item.name}`} accessibilityRole="button">
                <Text style={s.adminButtonText}>{item.isAdmin ? 'Remove Admin' : 'Make Admin'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#1a1a2e', padding: 20 },
  loadingContainer:     { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText:          { color: '#aaa', marginTop: 15, fontSize: 16 },
  title:                { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 5, textAlign: 'center' },
  subtitle:             { fontSize: 14, color: '#888', marginBottom: 20, textAlign: 'center' },
  searchInput:          { backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 10, fontSize: 16, marginBottom: 15 },
  filterTabs:           { flexDirection: 'row', marginBottom: 15, backgroundColor: '#16213e', borderRadius: 10, padding: 5 },
  filterTab:            { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  filterTabActive:      { backgroundColor: '#53a8b6' },
  filterTabText:        { color: '#888', fontSize: 12, fontWeight: '600' },
  filterTabTextActive:  { color: '#fff' },
  resultsCount:         { color: '#666', fontSize: 12, marginBottom: 15 },
  emptyContainer:       { padding: 40, alignItems: 'center' },
  emptyText:            { color: '#666', fontSize: 16 },
  userCard:             { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 12 },
  userCardBanned:       { borderWidth: 2, borderColor: '#e74c3c', opacity: 0.7 },
  userHeader:           { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  userPhoto:            { width: 50, height: 60, borderRadius: 10, marginRight: 12 },
  userPhotoPlaceholder: { width: 50, height: 60, borderRadius: 10, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userPhotoText:        { fontSize: 20, color: '#666' },
  userInfo:             { flex: 1 },
  userNameRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  userName:             { fontSize: 16, fontWeight: 'bold', color: '#eee' },
  verifiedBadge:        { fontSize: 14, color: '#3498db' },
  adminBadge:           { backgroundColor: '#9b59b6', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, fontSize: 10, color: '#fff', overflow: 'hidden' },
  bannedBadge:          { backgroundColor: '#e74c3c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, fontSize: 10, color: '#fff', overflow: 'hidden' },
  userEmail:            { fontSize: 12, color: '#888', marginTop: 2 },
  userDetails:          { fontSize: 11, color: '#666', marginTop: 2 },
  userActions:          { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  verifyButton:         { backgroundColor: '#3498db', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  verifyButtonText:     { color: '#fff', fontSize: 12, fontWeight: '600' },
  banButton:            { backgroundColor: '#e74c3c', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  unbanButton:          { backgroundColor: '#5cb85c', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  banButtonText:        { color: '#fff', fontSize: 12, fontWeight: '600' },
  adminButton:          { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 15 },
  adminButtonText:      { color: '#9b59b6', fontSize: 12, fontWeight: '600' },
});