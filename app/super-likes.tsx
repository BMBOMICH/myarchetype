import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../firebaseConfig';
import { logger } from '../utils/logger';
import { SuperLike, getSuperLikesReceived, markSuperLikeRead, respondToSuperLike } from '../utils/superLike';

interface SuperLikeWithProfile extends SuperLike {
  fromUserName?: string;
  fromUserPhoto?: string;
  fromUserAge?: number;
}

export default function SuperLikesScreen() {
  const router = useRouter();
  const [loading, setLoading]       = useState(true);
  const [superLikes, setSuperLikes] = useState<SuperLikeWithProfile[]>([]);
  const [responding, setResponding] = useState<string | null>(null);

  const loadSuperLikes = useCallback(async () => {
    try {
      const likes = await getSuperLikesReceived();
      const withProfiles = await Promise.all(
        likes.map(async (like) => {
          try {
            const snap = await getDoc(doc(db, 'users', like.fromUserId));
            if (snap.exists()) {
              const d = snap.data();
              return { ...like, fromUserName: d.name, fromUserPhoto: d.photos?.[0], fromUserAge: d.age };
            }
          } catch (error) {
            logger.error('[SuperLikes] profile load error:', error);
          }
          return like;
        })
      );
      setSuperLikes(withProfiles);
      await Promise.allSettled(likes.filter((l) => !l.read).map((l) => markSuperLikeRead(l.id)));
    } catch (error) {
      logger.error('[SuperLikes] load error:', error);
      Alert.alert('Error', 'Failed to load super likes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSuperLikes(); }, [loadSuperLikes]);

  const handleRespond = useCallback(async (superLike: SuperLikeWithProfile, accept: boolean) => {
    setResponding(superLike.id);
    try {
      const result = await respondToSuperLike(superLike.id, accept);
      if (!result.success) { Alert.alert('Error', 'Could not respond to this super like.'); return; }
      if (accept && result.isMatch) {
        Alert.alert("💕 It's a Match!", 'You both like each other! Start chatting now.', [
          { text: 'Chat', onPress: () => router.push({ pathname: '/chat', params: { matchId: superLike.fromUserId, matchName: superLike.fromUserName ?? 'Your match' } }) },
          { text: 'Later', style: 'cancel' },
        ]);
      } else if (accept) {
        Alert.alert('Liked!', 'You liked them back!');
      } else {
        Alert.alert('Passed', 'You passed on this super like');
      }
      setSuperLikes((prev) => prev.filter((l) => l.id !== superLike.id));
    } catch (error) {
      logger.error('[SuperLikes] respond error:', error);
      Alert.alert('Error', 'Something went wrong while responding.');
    } finally {
      setResponding(null);
    }
  }, [router]);

  if (loading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={s.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header">⭐ Super Likes</Text>
        <View style={{ width: 50 }} />
      </View>

      {superLikes.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={s.emptyIcon} accessibilityElementsHidden>⭐</Text>
          <Text style={s.emptyTitle}>No Super Likes Yet</Text>
          <Text style={s.emptyText}>When someone super likes you, they'll appear here!</Text>
        </View>
      ) : (
        <FlatList
          data={superLikes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <View
              style={s.card}
              accessibilityLabel={`Super like from ${item.fromUserName ?? 'Someone'}, age ${item.fromUserAge ?? 'unknown'}`}
            >
              <View style={s.photoContainer}>
                {item.fromUserPhoto ? (
                  <Image source={{ uri: item.fromUserPhoto }} style={s.photo} accessibilityLabel={`Photo of ${item.fromUserName ?? 'user'}`} />
                ) : (
                  <View style={s.photoPlaceholder} accessibilityLabel="No photo available">
                    <Text style={s.photoPlaceholderText} accessibilityElementsHidden>?</Text>
                  </View>
                )}
                <View style={s.starBadge} accessibilityElementsHidden>
                  <Text style={s.starBadgeText}>⭐</Text>
                </View>
              </View>

              <View style={s.info}>
                <Text style={s.name}>{item.fromUserName ?? 'Someone'}, {item.fromUserAge ?? '?'}</Text>
                <Text style={s.timestamp}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                <View style={s.messageContainer}>
                  <Text style={s.messageLabel}>Their message:</Text>
                  <Text style={s.messageText}>"{item.message}"</Text>
                </View>
                <View style={s.actions}>
                  <TouchableOpacity
                    style={[s.actionButton, s.passButton]}
                    onPress={() => void handleRespond(item, false)}
                    disabled={responding === item.id}
                    accessibilityLabel={`Pass on ${item.fromUserName ?? 'this person'}`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: responding === item.id }}
                  >
                    <Text style={s.actionButtonText}>{responding === item.id ? '...' : '✕ Pass'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.actionButton, s.likeButton]}
                    onPress={() => void handleRespond(item, true)}
                    disabled={responding === item.id}
                    accessibilityLabel={`Like back ${item.fromUserName ?? 'this person'}`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: responding === item.id }}
                  >
                    <Text style={s.actionButtonText}>{responding === item.id ? '...' : '💕 Like Back'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#1a1a2e' },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: '#16213e' },
  backButton:           { color: '#53a8b6', fontSize: 16 },
  title:                { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  emptyContainer:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:            { fontSize: 80, marginBottom: 20 },
  emptyTitle:           { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 15 },
  emptyText:            { fontSize: 16, color: '#888', textAlign: 'center', lineHeight: 24 },
  list:                 { padding: 20, paddingBottom: 40 },
  card:                 { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15, flexDirection: 'row', gap: 15, borderWidth: 2, borderColor: '#f1c40f' },
  photoContainer:       { position: 'relative' },
  photo:                { width: 80, height: 100, borderRadius: 10 },
  photoPlaceholder:     { width: 80, height: 100, borderRadius: 10, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  photoPlaceholderText: { fontSize: 30, color: '#666' },
  starBadge:            { position: 'absolute', top: -8, right: -8, backgroundColor: '#f1c40f', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#16213e' },
  starBadgeText:        { fontSize: 16 },
  info:                 { flex: 1 },
  name:                 { fontSize: 18, fontWeight: 'bold', color: '#eee', marginBottom: 4 },
  timestamp:            { fontSize: 12, color: '#888', marginBottom: 12 },
  messageContainer:     { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 15 },
  messageLabel:         { fontSize: 11, color: '#888', marginBottom: 4 },
  messageText:          { fontSize: 14, color: '#eee', fontStyle: 'italic', lineHeight: 20 },
  actions:              { flexDirection: 'row', gap: 10 },
  actionButton:         { flex: 1, paddingVertical: 12, borderRadius: 20, alignItems: 'center' },
  passButton:           { backgroundColor: '#d9534f' },
  likeButton:           { backgroundColor: '#5cb85c' },
  actionButtonText:     { color: '#fff', fontSize: 14, fontWeight: 'bold' },
});