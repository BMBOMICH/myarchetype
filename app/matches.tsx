import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';

interface UserProfile {
  uid: string;
  name: string;
  age: number;
  gender: string;
  height: number;
  bodyType: string;
  lookingFor: string;
  email: string;
  photos?: string[];
}

export default function MatchesScreen() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [matches, setMatches] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  useEffect(() => {
    loadMatches();
  }, []);

  const loadMatches = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        console.log('❌ No user logged in, redirecting...');
        setTimeout(() => router.replace('/login'), 100);
        return (
          <View style={styles.container}>
            <ActivityIndicator size="large" color="#53a8b6" />
            <Text style={styles.loadingText}>Redirecting...</Text>
          </View>
        );
      }

      console.log('📥 Loading current user profile...');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (!userDoc.exists()) {
        console.log('❌ User profile not found');
        setTimeout(() => router.replace('/profile-setup'), 100);
        setLoading(false);
        return;
      }

      const userData = userDoc.data() as UserProfile;
      setCurrentUser(userData);
      console.log('✅ Current user:', userData);

      console.log('🔍 Searching for matches...');
      const usersRef = collection(db, 'users');
      
      const q = query(
        usersRef,
        where('profileComplete', '==', true),
        where('gender', '!=', userData.gender)
      );

      const querySnapshot = await getDocs(q);
      const potentialMatches: UserProfile[] = [];

      querySnapshot.forEach((doc) => {
        const matchData = doc.data() as UserProfile;
        
        if (matchData.uid === user.uid) return;

        const bodyTypeMatch = userData.lookingFor === 'Any' || matchData.bodyType === userData.lookingFor;
        const youMatchThem = matchData.lookingFor === 'Any' || userData.bodyType === matchData.lookingFor;

        if (bodyTypeMatch && youMatchThem) {
          potentialMatches.push(matchData);
          console.log(`✅ Match found: ${matchData.name} (${matchData.bodyType})`);
        } else {
          console.log(`❌ No match: ${matchData.name} - bodyTypeMatch: ${bodyTypeMatch}, youMatchThem: ${youMatchThem}`);
        }
      });

      console.log(`🎯 Total matches found: ${potentialMatches.length}`);
      setMatches(potentialMatches);

    } catch (error) {
      console.error('❌ Error loading matches:', error);
      window.alert('Error loading matches: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async () => {
    const match = matches[currentMatchIndex];
    const user = auth.currentUser;
    
    if (!user) return;

    console.log(`💚 Liked: ${match.name}`);

    try {
      const theirLikeQuery = query(
        collection(db, 'likes'),
        where('fromUserId', '==', match.uid),
        where('toUserId', '==', user.uid)
      );
      
      const theirLikeSnapshot = await getDocs(theirLikeQuery);

      if (!theirLikeSnapshot.empty) {
        console.log('🎉 MUTUAL MATCH with', match.name);
        
        const theirLikeDoc = theirLikeSnapshot.docs[0];
        await setDoc(doc(db, 'likes', theirLikeDoc.id), {
          ...theirLikeDoc.data(),
          status: 'matched',
          matchedAt: new Date().toISOString(),
        });

        await setDoc(doc(db, 'likes', `${user.uid}_${match.uid}`), {
          fromUserId: user.uid,
          toUserId: match.uid,
          status: 'matched',
          createdAt: new Date().toISOString(),
          matchedAt: new Date().toISOString(),
        });

        window.alert(`🎉 It's a Match! You and ${match.name} like each other!`);
      } else {
        await setDoc(doc(db, 'likes', `${user.uid}_${match.uid}`), {
          fromUserId: user.uid,
          toUserId: match.uid,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });

        console.log('💚 Like saved (pending)');
        window.alert(`Like sent to ${match.name}! If they like you back, you'll match.`);
      }

      nextMatch();

    } catch (error) {
      console.error('Error saving like:', error);
      window.alert('Error saving like: ' + error);
    }
  };

  const handleSkip = () => {
    const match = matches[currentMatchIndex];
    console.log(`⏭️ Skipped: ${match.name}`);
    nextMatch();
  };

  const nextMatch = () => {
    if (currentMatchIndex < matches.length - 1) {
      setCurrentMatchIndex(currentMatchIndex + 1);
    } else {
      console.log('🎉 No more matches!');
    }
  };

  const calculateCompatibility = (match: UserProfile): number => {
    if (!currentUser) return 0;

    let score = 50;

    if (currentUser.lookingFor === 'Any' || match.bodyType === currentUser.lookingFor) {
      score += 30;
    }

    if (match.lookingFor === 'Any' || currentUser.bodyType === match.lookingFor) {
      score += 20;
    }

    return Math.min(score, 100);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Finding your matches...</Text>
      </View>
    );
  }

  if (matches.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No Matches Found 😔</Text>
        <Text style={styles.subtitle}>
          No one matches your preferences yet.{'\n'}
          Try adjusting your "Looking For" preference.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (currentMatchIndex >= matches.length) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>That's Everyone! 🎉</Text>
        <Text style={styles.subtitle}>
          You've seen all {matches.length} matches.{'\n'}
          Check back later for new profiles!
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentMatch = matches[currentMatchIndex];
  const compatibility = calculateCompatibility(currentMatch);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>
        Match {currentMatchIndex + 1} of {matches.length}
      </Text>

      <View style={styles.card}>
        {/* Photo */}
        {currentMatch.photos && currentMatch.photos.length > 0 ? (
          <Image 
            source={{ uri: currentMatch.photos[0] }} 
            style={styles.matchPhoto}
          />
        ) : (
          <View style={styles.noPhotoPlaceholder}>
            <Text style={styles.noPhotoText}>No Photo</Text>
          </View>
        )}

        <View style={styles.compatibilityBadge}>
          <Text style={styles.compatibilityText}>{compatibility}% Match</Text>
        </View>

        <Text style={styles.name}>{currentMatch.name}, {currentMatch.age}</Text>
        
        <View style={styles.infoRow}>
          <Text style={styles.label}>Height:</Text>
          <Text style={styles.value}>{currentMatch.height} cm</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>Body Type:</Text>
          <Text style={styles.value}>{currentMatch.bodyType}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>Looking For:</Text>
          <Text style={styles.value}>{currentMatch.lookingFor}</Text>
        </View>

        {currentUser && (
          <View style={styles.matchReason}>
            <Text style={styles.matchReasonTitle}>Why you matched:</Text>
            {currentUser.lookingFor === 'Any' || currentMatch.bodyType === currentUser.lookingFor ? (
              <Text style={styles.matchReasonText}>✅ They have your preferred body type</Text>
            ) : null}
            {currentMatch.lookingFor === 'Any' || currentUser.bodyType === currentMatch.lookingFor ? (
              <Text style={styles.matchReasonText}>✅ You have their preferred body type</Text>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipButtonText}>⏭️ Skip</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.likeButton} onPress={handleLike}>
          <Text style={styles.likeButtonText}>💚 Like</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 20,
    justifyContent: 'center',
  },
  loadingText: {
    color: '#aaa',
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
  },
  header: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 30,
    marginBottom: 30,
    borderWidth: 2,
    borderColor: '#0f3460',
  },
  matchPhoto: {
    width: '100%',
    height: 400,
    borderRadius: 20,
    marginBottom: 20,
  },
  noPhotoPlaceholder: {
    width: '100%',
    height: 400,
    borderRadius: 20,
    backgroundColor: '#16213e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#0f3460',
    borderStyle: 'dashed',
  },
  noPhotoText: {
    color: '#666',
    fontSize: 18,
  },
  compatibilityBadge: {
    backgroundColor: '#53a8b6',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignSelf: 'center',
    marginBottom: 20,
  },
  compatibilityText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  name: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 20,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  label: {
    color: '#aaa',
    fontSize: 16,
  },
  value: {
    color: '#eee',
    fontSize: 16,
    fontWeight: '600',
  },
  matchReason: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  matchReasonTitle: {
    color: '#53a8b6',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  matchReasonText: {
    color: '#aaa',
    fontSize: 14,
    marginBottom: 5,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  skipButton: {
    backgroundColor: '#d9534f',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
    flex: 1,
    marginRight: 10,
  },
  skipButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  likeButton: {
    backgroundColor: '#5cb85c',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
    flex: 1,
    marginLeft: 10,
  },
  likeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  button: {
    backgroundColor: '#0f3460',
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
});