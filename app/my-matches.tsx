import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';

interface Match {
  uid: string;
  name: string;
  age: number;
  bodyType: string;
  matchedAt: string;
  photos?: string[];
}

export default function MyMatchesScreen() {
  const router = useRouter();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMatches();
  }, []);

  const loadMatches = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setTimeout(() => router.replace('/login'), 100);
        return;
      }

      console.log('📥 Loading mutual matches...');

      const q1 = query(
        collection(db, 'likes'),
        where('fromUserId', '==', user.uid),
        where('status', '==', 'matched')
      );

      const q2 = query(
        collection(db, 'likes'),
        where('toUserId', '==', user.uid),
        where('status', '==', 'matched')
      );

      const [snapshot1, snapshot2] = await Promise.all([
        getDocs(q1),
        getDocs(q2)
      ]);

      const matchedUserIds = new Set<string>();

      snapshot1.forEach(doc => {
        matchedUserIds.add(doc.data().toUserId);
      });

      snapshot2.forEach(doc => {
        matchedUserIds.add(doc.data().fromUserId);
      });

      console.log(`Found ${matchedUserIds.size} mutual matches`);

      const matchDetails: Match[] = [];

      for (const userId of matchedUserIds) {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          matchDetails.push({
            uid: userId,
            name: userData.name,
            age: userData.age,
            bodyType: userData.bodyType,
            matchedAt: userData.createdAt || '',
            photos: userData.photos || [],
          });
        }
      }

      setMatches(matchDetails);
      console.log(`✅ Loaded ${matchDetails.length} match profiles`);

    } catch (error) {
      console.error('Error loading matches:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading your matches...</Text>
      </View>
    );
  }

  if (matches.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyTitle}>No Matches Yet 💔</Text>
        <Text style={styles.emptyText}>
          Start browsing profiles and like people.{'\n'}
          When they like you back, they'll appear here!
        </Text>
        <TouchableOpacity 
          style={styles.button} 
          onPress={() => router.push('/matches')}
        >
          <Text style={styles.buttonText}>Find Matches</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Matches ({matches.length})</Text>

      <FlatList
        data={matches}
        keyExtractor={(item) => item.uid}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.matchCard}>
            {item.photos && item.photos.length > 0 ? (
              <Image 
                source={{ uri: item.photos[0] }} 
                style={styles.matchPhoto}
              />
            ) : (
              <View style={styles.noPhoto}>
                <Text style={styles.noPhotoText}>📷</Text>
              </View>
            )}
            <View style={styles.matchInfo}>
              <Text style={styles.matchName}>{item.name}, {item.age}</Text>
              <Text style={styles.matchDetails}>{item.bodyType}</Text>
            </View>
            <TouchableOpacity 
              style={styles.chatButton}
              onPress={() => router.push(`/chat?matchId=${item.uid}&matchName=${item.name}`)}
            >
              <Text style={styles.chatButtonText}>💬 Chat</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 20,
  },
  loadingText: {
    color: '#aaa',
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 20,
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#eee',
    textAlign: 'center',
    marginTop: 100,
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  button: {
    backgroundColor: '#53a8b6',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
    alignSelf: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  matchCard: {
    backgroundColor: '#16213e',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  matchPhoto: {
    width: 60,
    height: 80,
    borderRadius: 10,
    marginRight: 15,
  },
  noPhoto: {
    width: 60,
    height: 80,
    borderRadius: 10,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
    borderWidth: 2,
    borderColor: '#0f3460',
    borderStyle: 'dashed',
  },
  noPhotoText: {
    fontSize: 24,
  },
  matchInfo: {
    flex: 1,
  },
  matchName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 5,
  },
  matchDetails: {
    fontSize: 14,
    color: '#aaa',
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
});