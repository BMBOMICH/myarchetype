import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import { auth, db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { formatSkippedTime, getSkippedProfiles, removeFromSkipped, SkippedProfile } from '../utils/secondLook';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_WIDTH = SCREEN_WIDTH - 80;

interface UserProfile {
  uid: string;
  name: string;
  age: number;
  bodyType: string;
  photos?: string[];
  personalityType?: string;
  height?: number | { value: number; verificationMethod?: string };
  selfieVerified?: boolean;
  ageVerification?: any;
  bio?: string;
  location?: { city?: string };
  ratings?: any;
  pushToken?: string;
  icebreaker?: string;
  icebreakerPrompt?: string;
}

export default function SecondLookScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [skippedList, setSkippedList] = useState<SkippedProfile[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);

  const user = auth.currentUser;

  useEffect(() => {
    loadSkippedProfiles();
  }, []);

  useEffect(() => {
    setCurrentPhotoIndex(0);
  }, [currentIndex]);

  const loadSkippedProfiles = async () => {
    if (!user) {
      router.replace('/login');
      return;
    }

    try {
      const skipped = await getSkippedProfiles();
      setSkippedList(skipped);

      if (skipped.length === 0) {
        setLoading(false);
        return;
      }

      // Load full profiles for skipped users
      const loadedProfiles: UserProfile[] = [];

      for (const s of skipped) {
        const userDoc = await getDoc(doc(db, 'users', s.odid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          
          // Check if already liked or matched
          const likeQuery = query(
            collection(db, 'likes'),
            where('fromUserId', '==', user.uid),
            where('toUserId', '==', s.odid)
          );
          const likeSnapshot = await getDocs(likeQuery);
          
          // Skip if already liked
          if (!likeSnapshot.empty) {
            continue;
          }

          loadedProfiles.push({
            uid: s.odid,
            name: data.name,
            age: data.age,
            bodyType: data.bodyType,
            photos: data.photos || [],
            personalityType: data.personalityType || '',
            height: data.height,
            selfieVerified: data.selfieVerified || false,
            ageVerification: data.ageVerification,
            bio: data.bio || '',
            location: data.location,
            ratings: data.ratings,
            pushToken: data.pushToken,
            icebreaker: data.icebreaker,
            icebreakerPrompt: data.icebreakerPrompt,
          });
        }
      }

      setProfiles(loadedProfiles);
    } catch (error) {
      console.error('Error loading skipped profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async () => {
    if (!user || actionLoading) return;
    
    const profile = profiles[currentIndex];
    if (!profile) return;

    setActionLoading(true);

    try {
      // Check if they already liked us
      const theirLikeQuery = query(
        collection(db, 'likes'),
        where('fromUserId', '==', profile.uid),
        where('toUserId', '==', user.uid)
      );
      const theirLikeSnapshot = await getDocs(theirLikeQuery);

      if (!theirLikeSnapshot.empty) {
        // MUTUAL MATCH!
        const theirLikeDoc = theirLikeSnapshot.docs[0];
        await setDoc(doc(db, 'likes', theirLikeDoc.id), {
          ...theirLikeDoc.data(),
          status: 'matched',
          matchedAt: new Date().toISOString(),
        });

        await setDoc(doc(db, 'likes', `${user.uid}_${profile.uid}`), {
          fromUserId: user.uid,
          toUserId: profile.uid,
          status: 'matched',
          createdAt: new Date().toISOString(),
          matchedAt: new Date().toISOString(),
        });

        // Send notification
        if (profile.pushToken) {
          const senderDoc = await getDoc(doc(db, 'users', user.uid));
          const senderName = senderDoc.exists() ? senderDoc.data().name : 'Someone';
          
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: profile.pushToken,
              title: "It's a Match! 💕",
              body: `${senderName} likes you too!`,
              sound: 'default',
              data: { type: 'match' },
            }),
          });
        }

        alert(`It's a Match! 💕\n\nYou and ${profile.name} like each other!`);
      } else {
        // One-sided like
        await setDoc(doc(db, 'likes', `${user.uid}_${profile.uid}`), {
          fromUserId: user.uid,
          toUserId: profile.uid,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });

        // Send notification
        if (profile.pushToken) {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: profile.pushToken,
              title: 'Someone likes you! 💝',
              body: 'Open the app to see who!',
              sound: 'default',
              data: { type: 'like' },
            }),
          });
        }

        alert(`Like sent to ${profile.name}! 💝`);
      }

      // Remove from skipped list
      await removeFromSkipped(profile.uid);

      // Move to next profile
      nextProfile();

    } catch (error) {
      console.error('Error liking profile:', error);
      alert('Error sending like');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSkipAgain = async () => {
    const profile = profiles[currentIndex];
    if (!profile) return;

    // Just move to next without removing from skipped
    nextProfile();
  };

  const handleRemove = async () => {
    const profile = profiles[currentIndex];
    if (!profile) return;

    setActionLoading(true);

    try {
      await removeFromSkipped(profile.uid);
      
      // Remove from current list
      const newProfiles = profiles.filter((_, i) => i !== currentIndex);
      setProfiles(newProfiles);

      if (currentIndex >= newProfiles.length && newProfiles.length > 0) {
        setCurrentIndex(newProfiles.length - 1);
      }

    } catch (error) {
      console.error('Error removing profile:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const nextProfile = () => {
    if (currentIndex < profiles.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setCurrentIndex(profiles.length);
    }
  };

  const handlePhotoScroll = (event: any) => {
    const contentOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffset / PHOTO_WIDTH);
    setCurrentPhotoIndex(index);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading profiles...</Text>
      </View>
    );
  }

  if (profiles.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyIcon}>👀</Text>
        <Text style={styles.emptyTitle}>No Profiles to Review</Text>
        <Text style={styles.emptyText}>
          When you skip someone while browsing,{'\n'}
          they'll appear here for a second chance.
        </Text>
        <TouchableOpacity 
          style={styles.browseButton}
          onPress={() => router.push('/matches')}
        >
          <Text style={styles.browseButtonText}>Browse Profiles</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (currentIndex >= profiles.length) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyIcon}>✓</Text>
        <Text style={styles.emptyTitle}>All Done!</Text>
        <Text style={styles.emptyText}>
          You've reviewed all your skipped profiles.{'\n'}
          Check back later for more!
        </Text>
        <TouchableOpacity 
          style={styles.browseButton}
          onPress={() => router.push('/matches')}
        >
          <Text style={styles.browseButtonText}>Find More Matches</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>← Back Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const profile = profiles[currentIndex];
  const skippedInfo = skippedList.find(s => s.odid === profile.uid);
  const photoCount = profile.photos?.length || 0;
  const ageVerificationBadge = getAgeVerificationLevel(profile.ageVerification);

  return (
    <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.headerBack}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>👀 Second Look</Text>
        <Text style={styles.headerCount}>{currentIndex + 1} of {profiles.length}</Text>
      </View>

      {/* Skipped Time Badge */}
      {skippedInfo && (
        <View style={styles.skippedBadge}>
          <Text style={styles.skippedBadgeText}>
            Skipped {formatSkippedTime(skippedInfo.skippedAt)}
          </Text>
        </View>
      )}

      {/* Profile Card */}
      <View style={styles.card}>
        {/* Photos */}
        {profile.photos && profile.photos.length > 0 ? (
          <View style={styles.photoContainer}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={handlePhotoScroll}
              scrollEventThrottle={16}
            >
              {profile.photos.map((photoUrl, index) => (
                <Image
                  key={index}
                  source={{ uri: photoUrl }}
                  style={[styles.photo, { width: PHOTO_WIDTH }]}
                />
              ))}
            </ScrollView>

            {photoCount > 1 && (
              <View style={styles.photoIndicator}>
                {profile.photos.map((_, index) => (
                  <View
                    key={index}
                    style={[styles.dot, currentPhotoIndex === index && styles.dotActive]}
                  />
                ))}
              </View>
            )}

            {profile.selfieVerified && (
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedText}>✓</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.noPhoto}>
            <Text style={styles.noPhotoText}>No Photo</Text>
          </View>
        )}

        {/* Name & Age */}
        <View style={styles.nameRow}>
          <Text style={styles.name}>{profile.name}, {profile.age}</Text>
          {profile.selfieVerified && (
            <Text style={styles.verifiedCheck}>✓</Text>
          )}
        </View>

        {ageVerificationBadge.level !== 'unverified' && (
          <View style={[styles.ageBadge, { backgroundColor: ageVerificationBadge.color }]}>
            <Text style={styles.ageBadgeText}>{ageVerificationBadge.label}</Text>
          </View>
        )}

        {/* Location */}
        {profile.location?.city && (
          <Text style={styles.location}>📍 {profile.location.city}</Text>
        )}

        {/* Icebreaker */}
        {profile.icebreaker && (
          <View style={styles.icebreakerSection}>
            <Text style={styles.icebreakerLabel}>
              💬 {profile.icebreakerPrompt || 'Icebreaker'}
            </Text>
            <Text style={styles.icebreakerText}>{profile.icebreaker}</Text>
          </View>
        )}

        {/* Bio */}
        {profile.bio && (
          <Text style={styles.bio}>"{profile.bio}"</Text>
        )}

        {/* Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Body Type</Text>
            <Text style={styles.infoValue}>{profile.bodyType}</Text>
          </View>
          {profile.height && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Height</Text>
              <HeightBadge height={profile.height} />
            </View>
          )}
          {profile.personalityType && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Personality</Text>
              <Text style={styles.personalityTag}>{profile.personalityType}</Text>
            </View>
          )}
        </View>

        {/* Trust Score */}
        {(profile.selfieVerified || profile.ratings?.totalRatings > 0) && (
          <View style={styles.trustSection}>
            <TrustScoreDisplay
              ratings={profile.ratings}
              selfieVerified={profile.selfieVerified}
              ageVerified={profile.ageVerification?.verified}
              heightVerified={
                typeof profile.height === 'object' &&
                profile.height.verificationMethod === 'manual-measured'
              }
              size="small"
            />
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.removeButton}
          onPress={handleRemove}
          disabled={actionLoading}
        >
          <Text style={styles.removeButtonText}>✕</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipAgainButton}
          onPress={handleSkipAgain}
          disabled={actionLoading}
        >
          <Text style={styles.skipAgainButtonText}>Skip Again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.likeButton, actionLoading && styles.likeButtonDisabled]}
          onPress={handleLike}
          disabled={actionLoading}
        >
          <Text style={styles.likeButtonText}>
            {actionLoading ? '...' : '♥ Like'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Give them another chance - you might have swiped too fast!
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  scrollContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingText: {
    color: '#aaa',
    fontSize: 16,
    marginTop: 15,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 15,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  browseButton: {
    backgroundColor: '#53a8b6',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 25,
    marginBottom: 15,
  },
  browseButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  backButton: {
    padding: 10,
  },
  backButtonText: {
    color: '#888',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 15,
  },
  headerBack: {
    color: '#53a8b6',
    fontSize: 16,
  },
  headerTitle: {
    color: '#eee',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerCount: {
    color: '#888',
    fontSize: 14,
  },
  skippedBadge: {
    backgroundColor: '#0f3460',
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 15,
    marginBottom: 15,
  },
  skippedBadgeText: {
    color: '#888',
    fontSize: 12,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#9b59b6',
  },
  photoContainer: {
    position: 'relative',
    borderRadius: 15,
    overflow: 'hidden',
    marginBottom: 15,
  },
  photo: {
    height: 350,
    borderRadius: 15,
    resizeMode: 'cover',
  },
  photoIndicator: {
    position: 'absolute',
    bottom: 15,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  verifiedBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#3498db',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  noPhoto: {
    height: 350,
    borderRadius: 15,
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  noPhotoText: {
    color: '#666',
    fontSize: 18,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  name: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#eee',
  },
  verifiedCheck: {
    fontSize: 20,
    color: '#3498db',
  },
  ageBadge: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  ageBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  location: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 15,
  },
  icebreakerSection: {
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 12,
    marginBottom: 15,
  },
  icebreakerLabel: {
    color: '#e67e22',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  icebreakerText: {
    color: '#eee',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  bio: {
    color: '#ddd',
    fontSize: 15,
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 15,
    lineHeight: 22,
  },
  infoSection: {
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    paddingTop: 15,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: {
    color: '#888',
    fontSize: 14,
  },
  infoValue: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '600',
  },
  personalityTag: {
    color: '#e67e22',
    fontSize: 14,
    fontWeight: '600',
  },
  trustSection: {
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    paddingTop: 15,
    marginTop: 5,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 15,
    marginBottom: 15,
  },
  removeButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#888',
    fontSize: 24,
    fontWeight: 'bold',
  },
  skipAgainButton: {
    backgroundColor: '#e67e22',
    paddingVertical: 14,
    paddingHorizontal: 25,
    borderRadius: 25,
  },
  skipAgainButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  likeButton: {
    backgroundColor: '#5cb85c',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  likeButtonDisabled: {
    backgroundColor: '#555',
  },
  likeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  hint: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});