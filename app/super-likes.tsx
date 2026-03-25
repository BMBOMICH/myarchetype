import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../firebaseConfig';
import {
    SuperLike,
    getSuperLikesReceived,
    markSuperLikeRead,
    respondToSuperLike,
} from '../utils/superLike';

interface SuperLikeWithProfile extends SuperLike {
  fromUserName?: string;
  fromUserPhoto?: string;
  fromUserAge?: number;
}

export default function SuperLikesScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [superLikes, setSuperLikes] = useState<SuperLikeWithProfile[]>([]);
  const [responding, setResponding] = useState<string | null>(null);

  useEffect(() => {
    loadSuperLikes();
  }, []);

  const loadSuperLikes = async () => {
    const likes = await getSuperLikesReceived();
    
    // Fetch user profiles
    const likesWithProfiles = await Promise.all(
      likes.map(async (like) => {
        const userDoc = await getDoc(doc(db, 'users', like.fromUserId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          return {
            ...like,
            fromUserName: userData.name,
            fromUserPhoto: userData.photos?.[0],
            fromUserAge: userData.age,
          };
        }
        return like;
      })
    );

    setSuperLikes(likesWithProfiles);
    setLoading(false);

    // Mark all as read
    likes.forEach((like) => {
      if (!like.read) {
        markSuperLikeRead(like.id);
      }
    });
  };

  const handleRespond = async (superLike: SuperLike, accept: boolean) => {
    setResponding(superLike.id);
    const result = await respondToSuperLike(superLike.id, accept);
    setResponding(null);

    if (result.success) {
      if (accept && result.isMatch) {
        Alert.alert(
          '💕 It\'s a Match!',
          'You both like each other! Start chatting now.',
          [
            {
              text: 'Chat',
              onPress: () => router.push({
                pathname: '/chat',
                params: {
                  matchId: superLike.fromUserId,
                  matchName: (superLike as SuperLikeWithProfile).fromUserName || 'Your match',
                },
              }),
            },
            { text: 'Later', style: 'cancel' },
          ]
        );
      } else if (accept) {
        Alert.alert('Liked!', 'You liked them back!');
      } else {
        Alert.alert('Passed', 'You passed on this super like');
      }

      // Remove from list
      setSuperLikes(superLikes.filter((l) => l.id !== superLike.id));
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>⭐ Super Likes</Text>
        <View style={{ width: 50 }} />
      </View>

      {superLikes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>⭐</Text>
          <Text style={styles.emptyTitle}>No Super Likes Yet</Text>
          <Text style={styles.emptyText}>
            When someone super likes you with a message, they'll appear here!
          </Text>
        </View>
      ) : (
        <FlatList
          data={superLikes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              {/* Profile Photo */}
              <View style={styles.photoContainer}>
                {item.fromUserPhoto ? (
                  <Image source={{ uri: item.fromUserPhoto }} style={styles.photo} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoPlaceholderText}>?</Text>
                  </View>
                )}
                <View style={styles.starBadge}>
                  <Text style={styles.starBadgeText}>⭐</Text>
                </View>
              </View>

              {/* Info */}
              <View style={styles.info}>
                <Text style={styles.name}>
                  {item.fromUserName || 'Someone'}, {item.fromUserAge || '?'}
                </Text>
                <Text style={styles.timestamp}>
                  {new Date(item.createdAt).toLocaleDateString()}
                </Text>

                {/* Message */}
                <View style={styles.messageContainer}>
                  <Text style={styles.messageLabel}>Their message:</Text>
                  <Text style={styles.messageText}>"{item.message}"</Text>
                </View>

                {/* Actions */}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.passButton]}
                    onPress={() => handleRespond(item, false)}
                    disabled={responding === item.id}
                  >
                    <Text style={styles.actionButtonText}>
                      {responding === item.id ? '...' : '✕ Pass'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.likeButton]}
                    onPress={() => handleRespond(item, true)}
                    disabled={responding === item.id}
                  >
                    <Text style={styles.actionButtonText}>
                      {responding === item.id ? '...' : '💕 Like Back'}
                    </Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: '#16213e' },
  backButton: { color: '#53a8b6', fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#eee' },

  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 80, marginBottom: 20 },
  emptyTitle: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 15 },
  emptyText: { fontSize: 16, color: '#888', textAlign: 'center', lineHeight: 24 },

  list: { padding: 20, paddingBottom: 40 },
  card: { backgroundColor: '#16213e', borderRadius: 15, padding: 15, marginBottom: 15, flexDirection: 'row', gap: 15, borderWidth: 2, borderColor: '#f1c40f' },

  photoContainer: { position: 'relative' },
  photo: { width: 80, height: 100, borderRadius: 10 },
  photoPlaceholder: { width: 80, height: 100, borderRadius: 10, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  photoPlaceholderText: { fontSize: 30, color: '#666' },
  starBadge: { position: 'absolute', top: -8, right: -8, backgroundColor: '#f1c40f', width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#16213e' },
  starBadgeText: { fontSize: 16 },

  info: { flex: 1 },
  name: { fontSize: 18, fontWeight: 'bold', color: '#eee', marginBottom: 4 },
  timestamp: { fontSize: 12, color: '#888', marginBottom: 12 },

  messageContainer: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 15 },
  messageLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  messageText: { fontSize: 14, color: '#eee', fontStyle: 'italic', lineHeight: 20 },

  actions: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, paddingVertical: 12, borderRadius: 20, alignItems: 'center' },
  passButton: { backgroundColor: '#d9534f' },
  likeButton: { backgroundColor: '#5cb85c' },
  actionButtonText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
});