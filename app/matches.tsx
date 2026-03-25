import { useRouter } from 'expo-router';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import VerificationBadge from '../components/VerificationBadge';
import { auth, db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { calculateDistance } from '../utils/location';
import { formatLastSeen, isUserOnline } from '../utils/onlineStatus';
import { recordSkippedProfile } from '../utils/secondLook';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_WIDTH = SCREEN_WIDTH - 80;

const BODY_TYPES = ['Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size'];
const RELIGIOUS_OPTIONS = ['Traditional', 'Modern', 'Spiritual', 'None'];
const LIFESTYLE_OPTIONS = ['Natural', 'Fitness', 'Social', 'Homebody'];
const RELATIONSHIP_OPTIONS = ['Marriage', 'Long-term', 'Exploring'];
const PERSONALITY_OPTIONS = ['Social Butterfly', 'Balanced Explorer', 'Thoughtful Soul', 'Mixed'];

interface AgeVerification {
  verified: boolean;
  method: 'self-reported' | 'ai-estimated' | 'id-verified';
  estimatedAge: number | null;
  statedAge: number;
  ageDifference: number | null;
  verifiedAt: string;
  confidence: number;
}

interface UserProfile {
  uid: string;
  name: string;
  age: number;
  gender: string;
  height: number | { value: number; verificationMethod?: string; confidence?: number };
  bodyType: string;
  lookingFor: string;
  email: string;
  photos?: string[];
  religiousViews?: string;
  lifestyle?: string;
  relationshipGoal?: string;
  personalityType?: string;
  personalityScores?: {
    serious: number;
    social: number;
  };
  blockedUsers?: string[];
  bio?: string;
  location?: {
    latitude: number;
    longitude: number;
    city?: string;
    country?: string;
  };
  lastSeen?: any;
  isOnline?: boolean;
  selfieVerified?: boolean;
  ageVerified?: boolean;
  ageVerification?: AgeVerification;
  hasFullBodyPhoto?: boolean;
  pushToken?: string;
  icebreaker?: string;
  icebreakerPrompt?: string;
  ratings?: {
    totalRatings: number;
    averagePhotosMatch: number;
    heightAccuracyRate: number;
    bodyTypeAccuracyRate: number;
    ageAccuracyRate: number;
    averagePersonalityMatch: number;
    averageOverall: number;
    trustScore: number;
  };
}

interface Filters {
  minAge: string;
  maxAge: string;
  maxDistance: string;
  minHeight: string;
  maxHeight: string;
  bodyTypes: string[];
  religiousViews: string[];
  lifestyles: string[];
  relationshipGoals: string[];
  personalityTypes: string[];
  verifiedOnly: boolean;
  activeWithin: string; // NEW: 'any', '24h', '7d', '30d'
  hasBio: boolean; // NEW: must have bio
  minPhotos: number; // NEW: minimum photos (1, 2, 3, 4)
}

const DEFAULT_FILTERS: Filters = {
  minAge: '18',
  maxAge: '99',
  maxDistance: '9999',
  minHeight: '',
  maxHeight: '',
  bodyTypes: [],
  religiousViews: [],
  lifestyles: [],
  relationshipGoals: [],
  personalityTypes: [],
  verifiedOnly: false,
  activeWithin: 'any', // NEW
  hasBio: false, // NEW
  minPhotos: 1, // NEW
};

// ============ UTILITY FUNCTIONS ============

const formatDistance = (distanceKm: number): string => {
  if (distanceKm < 1) {
    return 'Less than 1 km away';
  } else if (distanceKm < 10) {
    return distanceKm.toFixed(1) + ' km away';
  } else {
    return Math.round(distanceKm) + ' km away';
  }
};

const notifyNewMatch = async (pushToken: string, matcherName: string): Promise<void> => {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title: "It's a Match! 💕",
        body: matcherName + ' likes you too!',
        sound: 'default',
        data: { type: 'match' },
      }),
    });
  } catch (error) {
    console.error('Failed to send match notification:', error);
  }
};

const notifyNewLike = async (pushToken: string): Promise<void> => {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        title: 'Someone likes you! 💝',
        body: 'Open the app to see who!',
        sound: 'default',
        data: { type: 'like' },
      }),
    });
  } catch (error) {
    console.error('Failed to send like notification:', error);
  }
};

// ============ MAIN COMPONENT ============

export default function MatchesScreen() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [matches, setMatches] = useState<{ user: UserProfile; score: number; reasons: string[] }[]>([]);
  const [filteredMatches, setFilteredMatches] = useState<{ user: UserProfile; score: number; reasons: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [alreadyLiked, setAlreadyLiked] = useState<Set<string>>(new Set());

  // Advanced Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  // Undo Last Swipe
  const [lastSkipped, setLastSkipped] = useState<{ user: UserProfile; score: number; reasons: string[] } | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    loadMatches();
  }, []);

  useEffect(() => {
    setCurrentPhotoIndex(0);
  }, [currentMatchIndex]);

  useEffect(() => {
    applyFilters();
  }, [matches, filters]);

  const getHeightValue = (height: any): number => {
    if (typeof height === 'object') return height.value || 0;
    return height || 0;
  };

  const applyFilters = () => {
    const min = parseInt(filters.minAge) || 18;
    const max = parseInt(filters.maxAge) || 99;
    const maxDist = parseInt(filters.maxDistance) || 9999;
    const minH = parseInt(filters.minHeight) || 0;
    const maxH = parseInt(filters.maxHeight) || 999;

    const filtered = matches.filter((m) => {
      // Age filter
      if (m.user.age < min || m.user.age > max) return false;

      // Distance filter
      if (currentUser?.location && m.user.location && maxDist < 9999) {
        const dist = calculateDistance(
          currentUser.location.latitude,
          currentUser.location.longitude,
          m.user.location.latitude,
          m.user.location.longitude
        );
        if (dist > maxDist) return false;
      }

      // Height filter
      const userHeight = getHeightValue(m.user.height);
      if (minH > 0 && userHeight < minH) return false;
      if (maxH < 999 && userHeight > maxH) return false;

      // Body type filter
      if (filters.bodyTypes.length > 0 && !filters.bodyTypes.includes(m.user.bodyType)) {
        return false;
      }

      // Religious views filter
      if (filters.religiousViews.length > 0 && m.user.religiousViews) {
        if (!filters.religiousViews.includes(m.user.religiousViews)) return false;
      }

      // Lifestyle filter
      if (filters.lifestyles.length > 0 && m.user.lifestyle) {
        if (!filters.lifestyles.includes(m.user.lifestyle)) return false;
      }

      // Relationship goal filter
      if (filters.relationshipGoals.length > 0 && m.user.relationshipGoal) {
        if (!filters.relationshipGoals.includes(m.user.relationshipGoal)) return false;
      }

      // Personality filter
      if (filters.personalityTypes.length > 0 && m.user.personalityType) {
        if (!filters.personalityTypes.includes(m.user.personalityType)) return false;
      }

      // Verified only filter
      if (filters.verifiedOnly && !m.user.selfieVerified) {
        return false;
      }

      // NEW: Last active filter
      if (filters.activeWithin !== 'any') {
        const lastSeen = m.user.lastSeen?.toMillis?.() || 0;
        const now = Date.now();
        const diffMs = now - lastSeen;

        if (filters.activeWithin === '24h' && diffMs > 24 * 60 * 60 * 1000) return false;
        if (filters.activeWithin === '7d' && diffMs > 7 * 24 * 60 * 60 * 1000) return false;
        if (filters.activeWithin === '30d' && diffMs > 30 * 24 * 60 * 60 * 1000) return false;
      }

      // NEW: Must have bio filter
      if (filters.hasBio && (!m.user.bio || m.user.bio.length < 10)) return false;

      // NEW: Minimum photos filter
      if (filters.minPhotos > 1 && (!m.user.photos || m.user.photos.length < filters.minPhotos)) return false;

      return true;
    });

    // Sort: verified users first, then by score
    filtered.sort((a, b) => {
      if (a.user.selfieVerified && !b.user.selfieVerified) return -1;
      if (!a.user.selfieVerified && b.user.selfieVerified) return 1;
      return b.score - a.score;
    });

    setFilteredMatches(filtered);
    setCurrentMatchIndex(0);
    console.log('Filtered: ' + filtered.length + ' matches');
  };

  const loadMatches = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        console.log('No user logged in');
        setTimeout(() => router.replace('/login'), 100);
        return;
      }

      console.log('Loading current user profile...');
      const userDoc = await getDoc(doc(db, 'users', user.uid));

      if (!userDoc.exists()) {
        console.log('User profile not found');
        setTimeout(() => router.replace('/profile-setup'), 100);
        setLoading(false);
        return;
      }

      const userData = userDoc.data() as UserProfile;
      setCurrentUser(userData);
      console.log('Current user: ' + userData.name);

      const blockedUsers = userData.blockedUsers || [];

      // Get already liked users
      const likesQuery = query(
        collection(db, 'likes'),
        where('fromUserId', '==', user.uid)
      );
      const likesSnapshot = await getDocs(likesQuery);
      const likedSet = new Set<string>();
      likesSnapshot.forEach((d) => {
        likedSet.add(d.data().toUserId);
      });
      setAlreadyLiked(likedSet);

      console.log('Searching for matches...');
      const usersRef = collection(db, 'users');

      const q = query(
        usersRef,
        where('profileComplete', '==', true),
        where('gender', '!=', userData.gender)
      );

      const querySnapshot = await getDocs(q);
      const scoredMatches: { user: UserProfile; score: number; reasons: string[] }[] = [];

      querySnapshot.forEach((docSnap) => {
        const matchData = docSnap.data() as UserProfile;

        // Skip self
        if (matchData.uid === user.uid) return;
        // Skip blocked users
        if (blockedUsers.includes(matchData.uid)) return;
        // Skip if they blocked us
        if (matchData.blockedUsers?.includes(user.uid)) return;
        // Skip already liked
        if (likedSet.has(matchData.uid)) return;

        // Check body type compatibility
        const bodyTypeMatch = userData.lookingFor === 'Any' || matchData.bodyType === userData.lookingFor;
        const youMatchThem = matchData.lookingFor === 'Any' || userData.bodyType === matchData.lookingFor;

        if (!bodyTypeMatch || !youMatchThem) return;

        const { score, reasons } = calculateDetailedCompatibility(userData, matchData);

        scoredMatches.push({ user: matchData, score, reasons });
      });

      // Sort by score
      scoredMatches.sort((a, b) => b.score - a.score);

      console.log('Total matches found: ' + scoredMatches.length);
      setMatches(scoredMatches);

    } catch (error) {
      console.error('Error loading matches:', error);
      window.alert('Error loading matches: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const calculateDetailedCompatibility = (
    me: UserProfile,
    them: UserProfile
  ): { score: number; reasons: string[] } => {
    let score = 0;
    const reasons: string[] = [];

    // Body type compatibility (30 points max)
    if (me.lookingFor === 'Any' || them.bodyType === me.lookingFor) {
      score += 15;
      if (them.bodyType === me.lookingFor) {
        reasons.push('Body type: ' + them.bodyType + ' (your preference)');
      }
    }
    if (them.lookingFor === 'Any' || me.bodyType === them.lookingFor) {
      score += 15;
      reasons.push('You match their preferred body type');
    }

    // Personality compatibility (25 points max)
    if (me.personalityType && them.personalityType) {
      if (me.personalityType === them.personalityType) {
        score += 25;
        reasons.push('Same personality: ' + them.personalityType);
      } else if (me.personalityType === 'Mixed' || them.personalityType === 'Mixed') {
        score += 15;
        reasons.push('Compatible personality: ' + them.personalityType);
      } else {
        score += 5;
      }
    } else {
      score += 10;
    }

    // Religious views (15 points max)
    if (me.religiousViews && them.religiousViews) {
      if (me.religiousViews === them.religiousViews) {
        score += 15;
        reasons.push('Same views: ' + them.religiousViews);
      } else {
        score += 5;
      }
    } else {
      score += 7;
    }

    // Lifestyle (15 points max)
    if (me.lifestyle && them.lifestyle) {
      if (me.lifestyle === them.lifestyle) {
        score += 15;
        reasons.push('Same lifestyle: ' + them.lifestyle);
      } else {
        score += 5;
      }
    } else {
      score += 7;
    }

    // Relationship goals (15 points max)
    if (me.relationshipGoal && them.relationshipGoal) {
      if (me.relationshipGoal === them.relationshipGoal) {
        score += 15;
        reasons.push('Same goal: ' + them.relationshipGoal);
      } else if (
        (me.relationshipGoal === 'Marriage' && them.relationshipGoal === 'Long-term') ||
        (me.relationshipGoal === 'Long-term' && them.relationshipGoal === 'Marriage')
      ) {
        score += 10;
      } else {
        score += 3;
      }
    } else {
      score += 7;
    }

    // Verification bonus (5 points)
    if (them.selfieVerified) {
      score += 5;
      reasons.push('Verified identity');
    }

    // Clamp score between 0-100
    score = Math.min(Math.max(Math.round(score), 0), 100);

    return { score, reasons };
  };

  const handleLike = async () => {
    const matchObj = filteredMatches[currentMatchIndex];
    const match = matchObj.user;
    const user = auth.currentUser;

    if (!user) return;

    console.log('Liked: ' + match.name);
    setLastSkipped(null);
    setCanUndo(false);

    try {
      // Check if they already liked us
      const theirLikeQuery = query(
        collection(db, 'likes'),
        where('fromUserId', '==', match.uid),
        where('toUserId', '==', user.uid)
      );

      const theirLikeSnapshot = await getDocs(theirLikeQuery);

      if (!theirLikeSnapshot.empty) {
        // MUTUAL MATCH!
        console.log('MUTUAL MATCH with ' + match.name);

        const theirLikeDoc = theirLikeSnapshot.docs[0];
        await setDoc(doc(db, 'likes', theirLikeDoc.id), {
          ...theirLikeDoc.data(),
          status: 'matched',
          matchedAt: new Date().toISOString(),
        });

        await setDoc(doc(db, 'likes', user.uid + '_' + match.uid), {
          fromUserId: user.uid,
          toUserId: match.uid,
          status: 'matched',
          createdAt: new Date().toISOString(),
          matchedAt: new Date().toISOString(),
        });

        // Send push notification
        if (match.pushToken) {
          await notifyNewMatch(match.pushToken, currentUser?.name || 'Someone');
        }

        window.alert(
          "It's a Match! 💕\n\n" +
          'You and ' + match.name + ' like each other!\n\n' +
          'Compatibility: ' + matchObj.score + '%'
        );
      } else {
        // One-sided like
        await setDoc(doc(db, 'likes', user.uid + '_' + match.uid), {
          fromUserId: user.uid,
          toUserId: match.uid,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });

        // Send push notification
        if (match.pushToken) {
          await notifyNewLike(match.pushToken);
        }

        window.alert('Like sent to ' + match.name + '! 💝');
      }

      nextMatch();

    } catch (error) {
      console.error('Error saving like:', error);
      window.alert('Error saving like: ' + error);
    }
  };

  const handleSkip = async () => {
    const matchObj = filteredMatches[currentMatchIndex];
    const match = matchObj.user;

    // Save for undo
    setLastSkipped(matchObj);
    setCanUndo(true);

    // Record in second look
    await recordSkippedProfile(match.uid, match.name);

    nextMatch();
  };

  const handleUndo = () => {
    if (!lastSkipped || !canUndo) return;

    // Go back to the skipped match
    const currentIndex = filteredMatches.findIndex(m => m.user.uid === lastSkipped.user.uid);
    if (currentIndex !== -1) {
      setCurrentMatchIndex(currentIndex);
    }
    
    setLastSkipped(null);
    setCanUndo(false);
    
    window.alert('Undo successful! Here\'s ' + lastSkipped.user.name + ' again.');
  };

  const handleReport = async () => {
    const matchObj = filteredMatches[currentMatchIndex];
    const match = matchObj.user;
    const user = auth.currentUser;

    if (!user) return;

    const reason = window.prompt('Report User\n\nWhy are you reporting ' + match.name + '?');

    if (!reason) return;

    try {
      await setDoc(doc(db, 'reports', user.uid + '_' + match.uid + '_' + Date.now()), {
        reporterId: user.uid,
        reportedUserId: match.uid,
        reportedUserName: match.name,
        reason: reason,
        createdAt: new Date().toISOString(),
        status: 'pending',
      });

      window.alert('Report submitted. Thank you for keeping the community safe!');
      nextMatch();

    } catch (error) {
      console.error('Error reporting:', error);
      window.alert('Error submitting report');
    }
  };

  const handleBlock = async () => {
    const matchObj = filteredMatches[currentMatchIndex];
    const match = matchObj.user;
    const user = auth.currentUser;

    if (!user) return;

    const confirmed = window.confirm(
      'Block ' + match.name + '?\n\n' +
      'They won\'t be able to see your profile or contact you.\n' +
      'You can unblock them later in Settings.'
    );

    if (!confirmed) return;

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const currentBlocked = userDoc.data()?.blockedUsers || [];

      await updateDoc(doc(db, 'users', user.uid), {
        blockedUsers: [...currentBlocked, match.uid],
      });

      // Also add to blockedUsers collection for reference
      await setDoc(doc(db, 'blockedUsers', user.uid + '_' + match.uid), {
        blockerId: user.uid,
        blockedId: match.uid,
        blockedAt: new Date().toISOString(),
      });

      window.alert(match.name + ' has been blocked.');

      // Remove from matches
      const newMatches = matches.filter((m) => m.user.uid !== match.uid);
      setMatches(newMatches);

    } catch (error) {
      console.error('Error blocking:', error);
      window.alert('Error blocking user');
    }
  };

  const nextMatch = () => {
    if (currentMatchIndex < filteredMatches.length - 1) {
      setCurrentMatchIndex(currentMatchIndex + 1);
    } else {
      setCurrentMatchIndex(filteredMatches.length);
    }
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return '#5cb85c';
    if (score >= 60) return '#53a8b6';
    if (score >= 40) return '#e67e22';
    return '#d9534f';
  };

  const handlePhotoScroll = (event: any) => {
    const contentOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffset / PHOTO_WIDTH);
    setCurrentPhotoIndex(index);
  };

  const getDistanceToMatch = (matchUser: UserProfile): number | null => {
    if (!currentUser?.location || !matchUser.location) return null;
    return calculateDistance(
      currentUser.location.latitude,
      currentUser.location.longitude,
      matchUser.location.latitude,
      matchUser.location.longitude
    );
  };

  const toggleFilterArray = (array: string[], item: string): string[] => {
    if (array.includes(item)) {
      return array.filter(i => i !== item);
    }
    return [...array, item];
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const getActiveFilterCount = (): number => {
    let count = 0;
    if (filters.minAge !== '18' || filters.maxAge !== '99') count++;
    if (filters.maxDistance !== '9999') count++;
    if (filters.minHeight || filters.maxHeight) count++;
    if (filters.bodyTypes.length > 0) count++;
    if (filters.religiousViews.length > 0) count++;
    if (filters.lifestyles.length > 0) count++;
    if (filters.relationshipGoals.length > 0) count++;
    if (filters.personalityTypes.length > 0) count++;
    if (filters.verifiedOnly) count++;
    if (filters.activeWithin !== 'any') count++; // NEW
    if (filters.hasBio) count++; // NEW
    if (filters.minPhotos > 1) count++; // NEW
    return count;
  };

  // ============ LOADING STATE ============
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Finding your best matches...</Text>
      </View>
    );
  }

  // ============ NO MATCHES ============
  if (filteredMatches.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyIcon}>😔</Text>
        <Text style={styles.title}>No Matches Found</Text>
        <Text style={styles.subtitle}>
          {matches.length > 0
            ? 'Try adjusting your filters to see more people.'
            : 'Check back later for new profiles!'
          }
        </Text>
        {matches.length > 0 && (
          <TouchableOpacity style={styles.resetButton} onPress={resetFilters}>
            <Text style={styles.resetButtonText}>Reset Filters</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.button} onPress={() => router.push('/home')}>
          <Text style={styles.buttonText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ============ ALL SWIPED ============
  if (currentMatchIndex >= filteredMatches.length) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyIcon}>🎉</Text>
        <Text style={styles.title}>That's Everyone!</Text>
        <Text style={styles.subtitle}>
          You've seen all {filteredMatches.length} matches.{'\n'}
          Check back later for new profiles!
        </Text>
        {canUndo && lastSkipped && (
          <TouchableOpacity style={styles.undoButton} onPress={handleUndo}>
            <Text style={styles.undoButtonText}>↩️ Undo Last Skip</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.button} onPress={() => router.push('/home')}>
          <Text style={styles.buttonText}>Go Home</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#53a8b6', marginTop: 10 }]} 
          onPress={() => router.push('/my-matches')}
        >
          <Text style={styles.buttonText}>View My Matches</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ============ MAIN MATCH VIEW ============
  const currentMatch = filteredMatches[currentMatchIndex];
  const matchUser = currentMatch.user;
  const compatibility = currentMatch.score;
  const reasons = currentMatch.reasons;
  const scoreColor = getScoreColor(compatibility);
  const photoCount = matchUser.photos?.length || 0;
  const distanceToMatch = getDistanceToMatch(matchUser);
  const ageVerificationBadge = getAgeVerificationLevel(matchUser.ageVerification);
  const activeFilterCount = getActiveFilterCount();

  return (
    <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
      {/* HEADER */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.push('/home')}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.header}>
          {currentMatchIndex + 1} of {filteredMatches.length}
        </Text>
        <View style={styles.headerButtons}>
          {canUndo && (
            <TouchableOpacity style={styles.undoSmallButton} onPress={handleUndo}>
              <Text style={styles.undoSmallButtonText}>↩️</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.filterToggle}
            onPress={() => setShowFilters(true)}
          >
            <Text style={styles.filterToggleText}>
              🎛️ {activeFilterCount > 0 ? '(' + activeFilterCount + ')' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ADVANCED FILTERS MODAL */}
      <Modal visible={showFilters} animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={styles.filterModal}>
          <View style={styles.filterHeader}>
            <TouchableOpacity onPress={() => setShowFilters(false)}>
              <Text style={styles.filterCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.filterTitle}>Filters</Text>
            <TouchableOpacity onPress={resetFilters}>
              <Text style={styles.filterReset}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.filterContent}>
            {/* Age Range */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Age Range</Text>
              <View style={styles.rangeRow}>
                <TextInput
                  style={styles.rangeInput}
                  value={filters.minAge}
                  onChangeText={(t) => setFilters({ ...filters, minAge: t.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="18"
                  placeholderTextColor="#666"
                />
                <Text style={styles.rangeDash}>to</Text>
                <TextInput
                  style={styles.rangeInput}
                  value={filters.maxAge}
                  onChangeText={(t) => setFilters({ ...filters, maxAge: t.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="99"
                  placeholderTextColor="#666"
                />
              </View>
            </View>

            {/* Distance */}
            {currentUser?.location && (
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionTitle}>Max Distance</Text>
                <View style={styles.chipRow}>
                  {['10', '25', '50', '100', '250', '9999'].map((dist) => (
                    <TouchableOpacity
                      key={dist}
                      style={[styles.chip, filters.maxDistance === dist && styles.chipActive]}
                      onPress={() => setFilters({ ...filters, maxDistance: dist })}
                    >
                      <Text style={[styles.chipText, filters.maxDistance === dist && styles.chipTextActive]}>
                        {dist === '9999' ? 'Any' : dist + ' km'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Height Range */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Height Range (cm)</Text>
              <View style={styles.rangeRow}>
                <TextInput
                  style={styles.rangeInput}
                  value={filters.minHeight}
                  onChangeText={(t) => setFilters({ ...filters, minHeight: t.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="Min"
                  placeholderTextColor="#666"
                />
                <Text style={styles.rangeDash}>to</Text>
                <TextInput
                  style={styles.rangeInput}
                  value={filters.maxHeight}
                  onChangeText={(t) => setFilters({ ...filters, maxHeight: t.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="Max"
                  placeholderTextColor="#666"
                />
              </View>
            </View>

            {/* Body Type */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Body Type</Text>
              <View style={styles.chipRow}>
                {BODY_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.chip, filters.bodyTypes.includes(type) && styles.chipActive]}
                    onPress={() => setFilters({ ...filters, bodyTypes: toggleFilterArray(filters.bodyTypes, type) })}
                  >
                    <Text style={[styles.chipText, filters.bodyTypes.includes(type) && styles.chipTextActive]}>
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {filters.bodyTypes.length === 0 && <Text style={styles.anyLabel}>Any</Text>}
            </View>

            {/* Religious Views */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Religious Views</Text>
              <View style={styles.chipRow}>
                {RELIGIOUS_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.chip, filters.religiousViews.includes(opt) && styles.chipActive]}
                    onPress={() => setFilters({ ...filters, religiousViews: toggleFilterArray(filters.religiousViews, opt) })}
                  >
                    <Text style={[styles.chipText, filters.religiousViews.includes(opt) && styles.chipTextActive]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {filters.religiousViews.length === 0 && <Text style={styles.anyLabel}>Any</Text>}
            </View>

            {/* Lifestyle */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Lifestyle</Text>
              <View style={styles.chipRow}>
                {LIFESTYLE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.chip, filters.lifestyles.includes(opt) && styles.chipActive]}
                    onPress={() => setFilters({ ...filters, lifestyles: toggleFilterArray(filters.lifestyles, opt) })}
                  >
                    <Text style={[styles.chipText, filters.lifestyles.includes(opt) && styles.chipTextActive]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {filters.lifestyles.length === 0 && <Text style={styles.anyLabel}>Any</Text>}
            </View>

            {/* Relationship Goal */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Relationship Goal</Text>
              <View style={styles.chipRow}>
                {RELATIONSHIP_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.chip, filters.relationshipGoals.includes(opt) && styles.chipActive]}
                    onPress={() => setFilters({ ...filters, relationshipGoals: toggleFilterArray(filters.relationshipGoals, opt) })}
                  >
                    <Text style={[styles.chipText, filters.relationshipGoals.includes(opt) && styles.chipTextActive]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {filters.relationshipGoals.length === 0 && <Text style={styles.anyLabel}>Any</Text>}
            </View>

            {/* Personality Type */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Personality Type</Text>
              <View style={styles.chipRow}>
                {PERSONALITY_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.chip, filters.personalityTypes.includes(opt) && styles.chipActive]}
                    onPress={() => setFilters({ ...filters, personalityTypes: toggleFilterArray(filters.personalityTypes, opt) })}
                  >
                    <Text style={[styles.chipText, filters.personalityTypes.includes(opt) && styles.chipTextActive]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {filters.personalityTypes.length === 0 && <Text style={styles.anyLabel}>Any</Text>}
            </View>

            {/* NEW: Last Active Filter */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>🕒 Last Active</Text>
              <View style={styles.chipRow}>
                {[
                  { value: 'any', label: 'Any time' },
                  { value: '24h', label: 'Today' },
                  { value: '7d', label: 'This week' },
                  { value: '30d', label: 'This month' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, filters.activeWithin === opt.value && styles.chipActive]}
                    onPress={() => setFilters({ ...filters, activeWithin: opt.value })}
                  >
                    <Text style={[styles.chipText, filters.activeWithin === opt.value && styles.chipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* NEW: Profile Quality Filters */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>✨ Profile Quality</Text>
              
              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => setFilters({ ...filters, hasBio: !filters.hasBio })}
              >
                <Text style={styles.toggleText}>📝 Must have bio</Text>
                <View style={[styles.checkbox, filters.hasBio && styles.checkboxActive]}>
                  {filters.hasBio && <Text style={styles.checkmark}>✓</Text>}
                </View>
              </TouchableOpacity>

              <View style={styles.photoFilterRow}>
                <Text style={styles.photoFilterLabel}>Minimum photos:</Text>
                <View style={styles.photoFilterButtons}>
                  {[1, 2, 3, 4].map((num) => (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.photoFilterButton,
                        filters.minPhotos === num && styles.photoFilterButtonActive
                      ]}
                      onPress={() => setFilters({ ...filters, minPhotos: num })}
                    >
                      <Text style={[
                        styles.photoFilterButtonText,
                        filters.minPhotos === num && styles.photoFilterButtonTextActive
                      ]}>
                        {num}+
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* Verified Only */}
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => setFilters({ ...filters, verifiedOnly: !filters.verifiedOnly })}
            >
              <Text style={styles.toggleText}>✓ Verified users only</Text>
              <View style={[styles.checkbox, filters.verifiedOnly && styles.checkboxActive]}>
                {filters.verifiedOnly && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </TouchableOpacity>

            <View style={{ height: 100 }} />
          </ScrollView>

          <View style={styles.filterFooter}>
            <TouchableOpacity style={styles.applyButton} onPress={() => setShowFilters(false)}>
              <Text style={styles.applyButtonText}>
                Show {filteredMatches.length} Matches
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PROFILE CARD */}
      <View style={styles.card}>
        {/* PHOTO CAROUSEL */}
        {matchUser.photos && matchUser.photos.length > 0 ? (
          <View style={styles.photoCarouselContainer}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={handlePhotoScroll}
              scrollEventThrottle={16}
              style={styles.photoScroll}
            >
              {matchUser.photos.map((photoUrl, index) => (
                <Image
                  key={index}
                  source={{ uri: photoUrl }}
                  style={[styles.matchPhoto, { width: PHOTO_WIDTH }]}
                />
              ))}
            </ScrollView>

            {photoCount > 1 && (
              <View style={styles.photoCountBadge}>
                <Text style={styles.photoCountText}>
                  {currentPhotoIndex + 1} / {photoCount}
                </Text>
              </View>
            )}

            {photoCount > 1 && (
              <View style={styles.photoIndicator}>
                {matchUser.photos.map((_, index) => (
                  <View
                    key={index}
                    style={[styles.dot, currentPhotoIndex === index && styles.dotActive]}
                  />
                ))}
              </View>
            )}

            {matchUser.selfieVerified && (
              <View style={styles.photoVerifiedBadge}>
                <VerificationBadge
                  selfieVerified={matchUser.selfieVerified}
                  ratings={matchUser.ratings}
                  size="small"
                />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.noPhotoPlaceholder}>
            <Text style={styles.noPhotoText}>No Photo</Text>
          </View>
        )}

        {/* COMPATIBILITY BADGE */}
        <View style={[styles.compatibilityBadge, { backgroundColor: scoreColor }]}>
          <Text style={styles.compatibilityText}>{compatibility}% Match</Text>
        </View>

        {/* NEW: MUTUAL INTERESTS HIGHLIGHT */}
        {reasons.length > 0 && (
          <View style={styles.mutualInterestsBar}>
            {reasons.slice(0, 2).map((reason, index) => (
              <View key={index} style={styles.mutualInterestChip}>
                <Text style={styles.mutualInterestText}>✓ {reason}</Text>
              </View>
            ))}
          </View>
        )}

        {/* NAME & AGE */}
        <View style={styles.nameSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{matchUser.name}, {matchUser.age}</Text>
            {matchUser.selfieVerified && (
              <Text style={styles.verifiedCheckmark}>✓</Text>
            )}
          </View>

          {ageVerificationBadge.level !== 'unverified' && (
            <View style={[styles.ageBadge, { backgroundColor: ageVerificationBadge.color }]}>
              <Text style={styles.ageBadgeIcon}>{ageVerificationBadge.icon}</Text>
              <Text style={styles.ageBadgeText}>{ageVerificationBadge.label}</Text>
            </View>
          )}
        </View>

        {/* ONLINE STATUS */}
        {isUserOnline(matchUser.lastSeen) ? (
          <View style={styles.onlineBadge}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Online now</Text>
          </View>
        ) : matchUser.lastSeen ? (
          <Text style={styles.lastSeenText}>
            Last seen {formatLastSeen(matchUser.lastSeen)}
          </Text>
        ) : null}

        {/* DISTANCE */}
        {distanceToMatch !== null && (
          <View style={styles.distanceBadge}>
            <Text style={styles.distanceText}>📍 {formatDistance(distanceToMatch)}</Text>
          </View>
        )}

        {/* ICEBREAKER PROMPT */}
        {matchUser.icebreaker && (
          <View style={styles.icebreakerSection}>
            <Text style={styles.icebreakerLabel}>
              💬 {matchUser.icebreakerPrompt || 'Icebreaker'}
            </Text>
            <Text style={styles.icebreakerText}>{matchUser.icebreaker}</Text>
          </View>
        )}

        {/* BIO */}
        {matchUser.bio && (
          <View style={styles.bioSection}>
            <Text style={styles.sectionTitle}>About Me</Text>
            <Text style={styles.bioText}>"{matchUser.bio}"</Text>
          </View>
        )}

        {/* INFO SECTION */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Height</Text>
            <HeightBadge height={matchUser.height} />
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Body Type</Text>
            <Text style={styles.value}>{matchUser.bodyType}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Looking For</Text>
            <Text style={styles.value}>{matchUser.lookingFor}</Text>
          </View>

          {matchUser.location?.city && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Location</Text>
              <Text style={styles.value}>{matchUser.location.city}</Text>
            </View>
          )}
        </View>

        {/* TRUST & VERIFICATION */}
        {(matchUser.selfieVerified || (matchUser.ratings && matchUser.ratings.totalRatings > 0)) && (
          <View style={styles.verificationSection}>
            <Text style={styles.sectionTitle}>Trust & Verification</Text>
            <TrustScoreDisplay
              ratings={matchUser.ratings}
              selfieVerified={matchUser.selfieVerified}
              ageVerified={matchUser.ageVerification?.verified}
              heightVerified={
                typeof matchUser.height === 'object' &&
                matchUser.height.verificationMethod === 'manual-measured'
              }
              size="small"
            />
          </View>
        )}

        {/* BELIEFS & VALUES */}
        {(matchUser.religiousViews || matchUser.lifestyle || matchUser.relationshipGoal) && (
          <View style={styles.valuesSection}>
            <Text style={styles.sectionTitle}>Beliefs & Values</Text>

            {matchUser.religiousViews && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Views</Text>
                <Text style={[
                  styles.tag,
                  currentUser?.religiousViews === matchUser.religiousViews && styles.tagMatch
                ]}>
                  {matchUser.religiousViews}
                  {currentUser?.religiousViews === matchUser.religiousViews ? ' ✓' : ''}
                </Text>
              </View>
            )}

            {matchUser.lifestyle && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Lifestyle</Text>
                <Text style={[
                  styles.tag,
                  currentUser?.lifestyle === matchUser.lifestyle && styles.tagMatch
                ]}>
                  {matchUser.lifestyle}
                  {currentUser?.lifestyle === matchUser.lifestyle ? ' ✓' : ''}
                </Text>
              </View>
            )}

            {matchUser.relationshipGoal && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Goal</Text>
                <Text style={[
                  styles.tag,
                  currentUser?.relationshipGoal === matchUser.relationshipGoal && styles.tagMatch
                ]}>
                  {matchUser.relationshipGoal}
                  {currentUser?.relationshipGoal === matchUser.relationshipGoal ? ' ✓' : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* PERSONALITY */}
        {matchUser.personalityType && (
          <View style={styles.personalitySection}>
            <Text style={styles.sectionTitle}>Personality</Text>
            <View style={styles.personalityBadge}>
              <Text style={styles.personalityText}>{matchUser.personalityType}</Text>
            </View>
            {currentUser?.personalityType === matchUser.personalityType && (
              <Text style={styles.personalityMatch}>Same personality as you! 🎉</Text>
            )}
          </View>
        )}

        {/* MATCH REASONS */}
        {reasons.length > 0 && (
          <View style={styles.matchReason}>
            <Text style={styles.matchReasonTitle}>💫 Why you matched:</Text>
            {reasons.map((reason, index) => (
              <Text key={index} style={styles.matchReasonText}>• {reason}</Text>
            ))}
          </View>
        )}
      </View>

      {/* SAFETY BUTTONS */}
      <View style={styles.safetyRow}>
        <TouchableOpacity style={styles.reportButton} onPress={handleReport}>
          <Text style={styles.reportButtonText}>🚩 Report</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.blockButton} onPress={handleBlock}>
          <Text style={styles.blockButtonText}>🚫 Block</Text>
        </TouchableOpacity>
      </View>

      {/* ACTION BUTTONS */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipButtonText}>✗ Skip</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.likeButton} onPress={handleLike}>
          <Text style={styles.likeButtonText}>♥ Like</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: { flex: 1, backgroundColor: '#1a1a2e' },
  scrollContent: { padding: 20, paddingBottom: 40 },
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 20, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', fontSize: 16, marginTop: 20, textAlign: 'center' },
  emptyIcon: { fontSize: 60, marginBottom: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, marginTop: 10 },
  backButton: { color: '#53a8b6', fontSize: 16 },
  header: { color: '#aaa', fontSize: 14 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  undoSmallButton: { backgroundColor: '#e67e22', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15 },
  undoSmallButtonText: { fontSize: 16 },
  filterToggle: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 15 },
  filterToggleText: { color: '#53a8b6', fontSize: 14, fontWeight: '600' },
  
  // Filter Modal
  filterModal: { flex: 1, backgroundColor: '#1a1a2e' },
  filterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  filterCancel: { color: '#d9534f', fontSize: 16 },
  filterTitle: { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  filterReset: { color: '#53a8b6', fontSize: 16 },
  filterContent: { flex: 1, padding: 20 },
  filterSection: { marginBottom: 25 },
  filterSectionTitle: { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 },
  rangeInput: { backgroundColor: '#16213e', color: '#fff', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, fontSize: 18, fontWeight: '600', width: 90, textAlign: 'center' },
  rangeDash: { color: '#888', fontSize: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { backgroundColor: '#16213e', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 2, borderColor: '#16213e' },
  chipActive: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  chipText: { color: '#888', fontSize: 14 },
  chipTextActive: { color: '#53a8b6', fontWeight: '600' },
  anyLabel: { color: '#666', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', padding: 15, borderRadius: 10, marginTop: 10 },
  toggleText: { color: '#eee', fontSize: 15 },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: '#53a8b6', justifyContent: 'center', alignItems: 'center' },
  checkboxActive: { backgroundColor: '#53a8b6' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  // NEW: Photo filter
  photoFilterRow: { marginTop: 15 },
  photoFilterLabel: { color: '#eee', fontSize: 14, marginBottom: 10 },
  photoFilterButtons: { flexDirection: 'row', gap: 10 },
  photoFilterButton: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 15, borderWidth: 2, borderColor: '#0f3460', backgroundColor: '#16213e' },
  photoFilterButtonActive: { backgroundColor: '#53a8b6', borderColor: '#53a8b6' },
  photoFilterButtonText: { color: '#888', fontSize: 14, fontWeight: '500' },
  photoFilterButtonTextActive: { color: '#fff', fontWeight: '600' },
  filterFooter: { padding: 20, borderTopWidth: 1, borderTopColor: '#0f3460' },
  applyButton: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  applyButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },

  // Undo button
  undoButton: { backgroundColor: '#e67e22', paddingVertical: 15, paddingHorizontal: 30, borderRadius: 25, marginBottom: 15 },
  undoButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resetButton: { backgroundColor: '#53a8b6', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 20, marginBottom: 15 },
  resetButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Card styles
  card: { backgroundColor: '#16213e', borderRadius: 20, padding: 20, marginBottom: 15, borderWidth: 2, borderColor: '#0f3460' },
  photoCarouselContainer: { position: 'relative', marginBottom: 15, borderRadius: 15, overflow: 'hidden' },
  photoScroll: { borderRadius: 15 },
  matchPhoto: { height: 400, borderRadius: 15, resizeMode: 'cover' },
  photoCountBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0, 0, 0, 0.6)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  photoCountText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  photoIndicator: { position: 'absolute', bottom: 15, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  dotActive: { backgroundColor: '#fff', width: 10, height: 10, borderRadius: 5 },
  photoVerifiedBadge: { position: 'absolute', top: 10, left: 10 },
  noPhotoPlaceholder: { width: '100%', height: 400, borderRadius: 15, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  noPhotoText: { color: '#666', fontSize: 18 },
  compatibilityBadge: { paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20, alignSelf: 'center', marginBottom: 15 },
  compatibilityText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  // NEW: Mutual interests
  mutualInterestsBar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 15 },
  mutualInterestChip: { backgroundColor: '#1a5c3a', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: '#5cb85c' },
  mutualInterestText: { color: '#5cb85c', fontSize: 12, fontWeight: '600' },
  nameSection: { alignItems: 'center', marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  name: { fontSize: 30, fontWeight: 'bold', color: '#eee', textAlign: 'center' },
  verifiedCheckmark: { fontSize: 24, color: '#3498db' },
  ageBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  ageBadgeIcon: { fontSize: 14, marginRight: 4, color: '#fff' },
  ageBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(92, 184, 92, 0.2)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, alignSelf: 'center', marginBottom: 5 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#5cb85c', marginRight: 6 },
  onlineText: { color: '#5cb85c', fontSize: 12, fontWeight: '600' },
  lastSeenText: { color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 5 },
  distanceBadge: { backgroundColor: '#0f3460', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 15, alignSelf: 'center', marginBottom: 15 },
  distanceText: { color: '#53a8b6', fontSize: 13 },
  
  // Icebreaker
  icebreakerSection: { backgroundColor: '#0f3460', borderRadius: 15, padding: 15, marginBottom: 15 },
  icebreakerLabel: { color: '#e67e22', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  icebreakerText: { color: '#eee', fontSize: 15, fontStyle: 'italic', lineHeight: 22 },

  bioSection: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 5, marginBottom: 10 },
  bioText: { color: '#ddd', fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  infoSection: { marginBottom: 5 },
  verificationSection: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 10, marginBottom: 10 },
  valuesSection: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 10, marginBottom: 5 },
  personalitySection: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 10, alignItems: 'center', marginBottom: 5 },
  sectionTitle: { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label: { color: '#aaa', fontSize: 15 },
  value: { color: '#eee', fontSize: 15, fontWeight: '600' },
  tag: { backgroundColor: '#0f3460', color: '#aaa', paddingVertical: 5, paddingHorizontal: 14, borderRadius: 12, fontSize: 14, overflow: 'hidden' },
  tagMatch: { backgroundColor: '#1a5c3a', color: '#5cb85c', fontWeight: '600' },
  personalityBadge: { backgroundColor: '#e67e22', paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20, marginBottom: 8 },
  personalityText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  personalityMatch: { color: '#5cb85c', fontSize: 12, marginTop: 4 },
  matchReason: { marginTop: 10, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#0f3460' },
  matchReasonTitle: { color: '#53a8b6', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  matchReasonText: { color: '#aaa', fontSize: 14, marginBottom: 5, lineHeight: 20 },
  safetyRow: { flexDirection: 'row', justifyContent: 'center', gap: 30, marginBottom: 15 },
  reportButton: { paddingVertical: 8, paddingHorizontal: 15 },
  reportButtonText: { color: '#e67e22', fontSize: 14 },
  blockButton: { paddingVertical: 8, paddingHorizontal: 15 },
  blockButtonText: { color: '#d9534f', fontSize: 14 },
  buttonContainer: { flexDirection: 'row', justifyContent: 'space-around' },
  skipButton: { backgroundColor: '#d9534f', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, flex: 1, marginRight: 10 },
  skipButtonText: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  likeButton: { backgroundColor: '#5cb85c', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, flex: 1, marginLeft: 10 },
  likeButtonText: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#eee', marginBottom: 15, textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#aaa', textAlign: 'center', marginBottom: 20, lineHeight: 24 },
  button: { backgroundColor: '#0f3460', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});