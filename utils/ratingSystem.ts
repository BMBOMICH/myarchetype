import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';

export interface UserRatings {
  totalRatings: number;
  averagePhotosMatch: number;
  heightAccuracyRate: number;
  bodyTypeAccuracyRate: number;
  ageAccuracyRate: number;
  averagePersonalityMatch: number;
  averageOverall: number;
  trustScore: number;
  isTrusted: boolean;
}

export async function getUserRatings(userId: string): Promise<UserRatings | null> {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    
    if (!userDoc.exists()) {
      return null;
    }

    const userData = userDoc.data();
    const ratings = userData.ratings || null;

    if (!ratings) {
      return {
        totalRatings: 0,
        averagePhotosMatch: 0,
        heightAccuracyRate: 0,
        bodyTypeAccuracyRate: 0,
        ageAccuracyRate: 0,
        averagePersonalityMatch: 0,
        averageOverall: 0,
        trustScore: 0,
        isTrusted: false,
      };
    }

    const trustScore = calculateTrustScore(ratings);
    const isTrusted = trustScore >= 75 && ratings.totalRatings >= 3;

    return {
      ...ratings,
      trustScore,
      isTrusted,
    };

  } catch (error) {
    console.error('Error getting user ratings:', error);
    return null;
  }
}

function calculateTrustScore(ratings: any): number {
  if (!ratings || ratings.totalRatings === 0) {
    return 0;
  }

  const photosWeight = 0.25;
  const heightWeight = 0.15;
  const bodyTypeWeight = 0.15;
  const ageWeight = 0.15;
  const personalityWeight = 0.15;
  const overallWeight = 0.15;

  const photosScore = (ratings.averagePhotosMatch / 5) * 100;
  const heightScore = ratings.heightAccuracyRate || 0;
  const bodyTypeScore = ratings.bodyTypeAccuracyRate || 0;
  const ageScore = ratings.ageAccuracyRate || 0;
  const personalityScore = (ratings.averagePersonalityMatch / 5) * 100;
  const overallScore = ((ratings.averageOverall || 0) / 5) * 100;

  const trustScore =
    (photosScore * photosWeight) +
    (heightScore * heightWeight) +
    (bodyTypeScore * bodyTypeWeight) +
    (ageScore * ageWeight) +
    (personalityScore * personalityWeight) +
    (overallScore * overallWeight);

  return Math.round(trustScore);
}

export async function shouldPromptForRating(
  currentUserId: string,
  matchId: string
): Promise<boolean> {
  try {
    // Check if already rated or dismissed
    try {
      const statusDoc = await getDoc(doc(db, 'ratingStatus', currentUserId + '_' + matchId));
      if (statusDoc.exists()) {
        const statusData = statusDoc.data();
        // If they said "not yet", check if it's been 7 more days
        if (statusData.didNotMeet) {
          const dismissedAt = new Date(statusData.ratedAt);
          const now = new Date();
          const daysSinceDismiss = (now.getTime() - dismissedAt.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceDismiss < 7) {
            return false;
          }
          // If 7+ days since dismiss, prompt again
        } else {
          return false; // Already rated
        }
      }
    } catch (e) {
      // No status doc, continue
    }

    // Check old rating format too
    try {
      const existingRating = await getDoc(doc(db, 'ratings', currentUserId + '_rates_' + matchId));
      if (existingRating.exists()) {
        return false;
      }
    } catch (e) {
      // No rating, continue
    }

    // Check if matched for at least 7 days
    const likesQuery = query(
      collection(db, 'likes'),
      where('fromUserId', '==', currentUserId),
      where('toUserId', '==', matchId),
      where('status', '==', 'matched')
    );

    const likesSnapshot = await getDocs(likesQuery);

    if (likesSnapshot.empty) {
      // Try reverse direction
      const reverseLikesQuery = query(
        collection(db, 'likes'),
        where('fromUserId', '==', matchId),
        where('toUserId', '==', currentUserId),
        where('status', '==', 'matched')
      );
      const reverseSnapshot = await getDocs(reverseLikesQuery);

      if (reverseSnapshot.empty) return false;

      const matchData = reverseSnapshot.docs[0].data();
      const matchedAt = matchData.matchedAt;

      if (!matchedAt) return false;

      const matchDate = new Date(matchedAt);
      const now = new Date();
      const daysSinceMatch = (now.getTime() - matchDate.getTime()) / (1000 * 60 * 60 * 24);

      return daysSinceMatch >= 7;
    }

    const matchData = likesSnapshot.docs[0].data();
    const matchedAt = matchData.matchedAt;

    if (!matchedAt) return false;

    const matchDate = new Date(matchedAt);
    const now = new Date();
    const daysSinceMatch = (now.getTime() - matchDate.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceMatch >= 7;

  } catch (error) {
    console.error('Error checking rating prompt:', error);
    return false;
  }
}

export function getVerificationLevel(user: any): 'basic' | 'verified' | 'trusted' {
  const selfieVerified = user.selfieVerified || false;
  const ratings = user.ratings;

  if (
    selfieVerified &&
    ratings &&
    ratings.totalRatings >= 3 &&
    (ratings.averagePhotosMatch >= 4 || ratings.averageOverall >= 4)
  ) {
    return 'trusted';
  }

  if (selfieVerified) {
    return 'verified';
  }

  return 'basic';
}

export function getUserTrustLevel(ratings: any): {
  level: 'none' | 'new' | 'trusted' | 'flagged';
  label: string;
  color: string;
} {
  if (!ratings || ratings.totalRatings === 0) {
    return { level: 'none', label: 'No ratings yet', color: '#888' };
  }

  if (ratings.totalRatings < 3) {
    return { level: 'new', label: 'New (' + ratings.totalRatings + ' ratings)', color: '#3498db' };
  }

  const avgOverall = ratings.averageOverall || 0;
  const photoAccuracy = ratings.averagePhotosMatch || 0;
  const heightAccuracy = ratings.heightAccuracyRate || 0;

  if (avgOverall < 2 || photoAccuracy < 2 || heightAccuracy < 40) {
    return { level: 'flagged', label: 'Low trust', color: '#d9534f' };
  }

  if (avgOverall >= 4 && photoAccuracy >= 4 && heightAccuracy >= 70) {
    return { level: 'trusted', label: 'Trusted (' + ratings.totalRatings + ' ratings)', color: '#f1c40f' };
  }

  return { level: 'new', label: ratings.totalRatings + ' ratings', color: '#3498db' };
}

export function formatTrustScore(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Great';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'New';
}