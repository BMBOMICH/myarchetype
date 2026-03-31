/**
 * utils/ratingSystem.ts
 *
 * Detectors covered:
 * #107 Rating / review manipulation (Wilson score + Bayesian)
 * #150 Per-user trust score (0-100)
 * #151 Trust score auto-actions (warn / restrict / ban)
 * #152 Reporter credibility score
 * #154 Verification level display badge
 * #155 Trust decay (score drops with violations)
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { detectRatingManipulation, wilsonScoreLowerBound } from './datingStats';
import { writeAuditLog } from './logger';
import { applyTrustDecay } from './profileStrength';

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
  wilsonScore: number;
  bayesianScore: number;
}

export interface TrustScoreResult {
  score: number; // 0-100
  level: 'critical' | 'low' | 'medium' | 'high' | 'excellent';
  actions: TrustAction[];
  breakdown: Record<string, number>;
}

export type TrustAction = 'none' | 'warn' | 'restrict' | 'shadow_ban' | 'ban';

export interface ReporterCredibility {
  userId: string;
  credibilityScore: number; // 0-100
  totalReports: number;
  confirmedReports: number;
  dismissedReports: number;
  accuracy: number; // % of reports that were confirmed
}

// ═════════════════════════════════════════════════════════
// #107: Wilson score — manipulation-resistant rating
// ═════════════════════════════════════════════════════════

/**
 * Calculate Bayesian average rating.
 * Prevents manipulation by small sample sizes.
 * Detector #107.
 *
 * Formula: (C * m + n * x̄) / (C + n)
 * Where C = confidence constant, m = global mean, n = ratings count, x̄ = user mean
 */
export function bayesianAverage(
  userRatings: number[],
  globalMean = 3.5, // global platform average
  confidenceConstant = 10
): number {
  if (userRatings.length === 0) return globalMean;

  const n = userRatings.length;
  const userMean =
    userRatings.reduce((a, b) => a + b, 0) / n;

  return (
    (confidenceConstant * globalMean + n * userMean) /
    (confidenceConstant + n)
  );
}

export async function getUserRatings(
  userId: string
): Promise<UserRatings | null> {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) return null;

    const userData = userDoc.data();
    const ratings = userData.ratings;

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
        wilsonScore: 0,
        bayesianScore: 0,
      };
    }

    // #107: Wilson score (manipulation-resistant)
    const positiveRatings = Math.round(
      (ratings.averageOverall / 5) * ratings.totalRatings
    );
    const wilsonScore = wilsonScoreLowerBound(
      positiveRatings,
      ratings.totalRatings
    );

    // #107: Bayesian average
    const rawRatings = userData.rawRatings ?? [];
    const bayesianScore = bayesianAverage(rawRatings);

    // #107: Check for rating manipulation
    const ratingHistory = userData.ratingHistory ?? [];
    const manipulationCheck = detectRatingManipulation(ratingHistory);

    if (manipulationCheck.manipulated) {
      console.warn(
        '[ratingSystem] Rating manipulation detected for user:',
        userId,
        manipulationCheck.reason
      );
    }

    const trustScore = calculateTrustScore(ratings);
    const isTrusted = trustScore >= 75 && ratings.totalRatings >= 3;

    return {
      ...ratings,
      trustScore,
      isTrusted,
      wilsonScore: Math.round(wilsonScore * 100),
      bayesianScore: Math.round(bayesianScore * 10) / 10,
    };
  } catch (error) {
    console.error('[ratingSystem] getUserRatings error:', error);
    return null;
  }
}

function calculateTrustScore(ratings: any): number {
  if (!ratings || ratings.totalRatings === 0) return 0;

  const weights = {
    photos: 0.25,
    height: 0.15,
    bodyType: 0.15,
    age: 0.15,
    personality: 0.15,
    overall: 0.15,
  };

  const score =
    ((ratings.averagePhotosMatch / 5) * 100) * weights.photos +
    (ratings.heightAccuracyRate ?? 0) * weights.height +
    (ratings.bodyTypeAccuracyRate ?? 0) * weights.bodyType +
    (ratings.ageAccuracyRate ?? 0) * weights.age +
    ((ratings.averagePersonalityMatch / 5) * 100) * weights.personality +
    (((ratings.averageOverall ?? 0) / 5) * 100) * weights.overall;

  return Math.round(score);
}

// ═════════════════════════════════════════════════════════
// #150: Per-user trust score (0-100)
// #151: Trust score auto-actions
// #155: Trust decay
// ═════════════════════════════════════════════════════════

/**
 * Calculate comprehensive trust score for a user.
 * Detectors #150, #151, #155.
 */
export async function calculateUserTrustScore(
  userId: string
): Promise<TrustScoreResult> {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) {
      return {
        score: 0,
        level: 'critical',
        actions: ['restrict'],
        breakdown: {},
      };
    }

    const data = userDoc.data();
    const breakdown: Record<string, number> = {};
    let score = 50; // Start at neutral

    // Email verified (+10)
    if (data.emailVerified) {
      breakdown['email_verified'] = 10;
      score += 10;
    }

    // Selfie verified (+15)
    if (data.selfieVerified) {
      breakdown['selfie_verified'] = 15;
      score += 15;
    }

    // Age verified (+10)
    if (data.ageVerification?.verified) {
      breakdown['age_verified'] = 10;
      score += 10;
    }

    // Phone verified (+10)
    if (data.phoneVerified) {
      breakdown['phone_verified'] = 10;
      score += 10;
    }

    // Social links (+5)
    if (
      data.socialLinks?.instagram?.username ||
      data.socialLinks?.linkedin?.profileUrl
    ) {
      breakdown['social_links'] = 5;
      score += 5;
    }

    // Profile completeness (+5)
    const photoCount = data.photos?.length ?? 0;
    const hasBio = (data.bio?.length ?? 0) > 20;
    if (photoCount >= 3 && hasBio) {
      breakdown['complete_profile'] = 5;
      score += 5;
    }

    // Report history (-5 per report confirmed)
    const confirmedReports = data.confirmedReports ?? 0;
    if (confirmedReports > 0) {
      const penalty = Math.min(30, confirmedReports * 10);
      breakdown['confirmed_reports'] = -penalty;
      score -= penalty;
    }

    // Ban history (-20)
    if (data.previousBans > 0) {
      breakdown['previous_bans'] = -20;
      score -= 20;
    }

    // #155: Apply trust decay from violations
    const violations = data.violations ?? [];
    score = applyTrustDecay(score, violations);

    score = Math.max(0, Math.min(100, score));

    // #151: Determine actions based on score
    const actions = determineAutoActions(score);

    // #151: Apply actions if needed
    if (actions.includes('restrict') || actions.includes('ban')) {
      await writeAuditLog('admin.update_trust_score', {
        userId,
        score,
        actions,
        breakdown,
      }, userId);
    }

    return {
      score,
      level:
        score >= 80 ? 'excellent'
        : score >= 60 ? 'high'
        : score >= 40 ? 'medium'
        : score >= 20 ? 'low'
        : 'critical',
      actions,
      breakdown,
    };
  } catch (error) {
    console.error('[ratingSystem] calculateUserTrustScore error:', error);
    return { score: 0, level: 'critical', actions: ['restrict'], breakdown: {} };
  }
}

/**
 * Determine automatic actions based on trust score.
 * Detector #151.
 */
export function determineAutoActions(score: number): TrustAction[] {
  if (score >= 60) return ['none'];
  if (score >= 40) return ['warn'];
  if (score >= 25) return ['restrict'];
  if (score >= 10) return ['shadow_ban'];
  return ['ban'];
}

// ═════════════════════════════════════════════════════════
// #152: Reporter credibility score
// ═════════════════════════════════════════════════════════

/**
 * Calculate how credible a reporter is based on their report history.
 * Detector #152.
 *
 * High-credibility reporters have their reports auto-actioned faster.
 * Low-credibility (mass false reporters) have their reports deprioritized.
 */
export async function calculateReporterCredibility(
  reporterId: string
): Promise<ReporterCredibility> {
  try {
    const reportsSnap = await getDocs(
      query(
        collection(db, 'reports'),
        where('reporterId', '==', reporterId)
      )
    );

    let totalReports = 0;
    let confirmedReports = 0;
    let dismissedReports = 0;

    reportsSnap.forEach((d) => {
      const data = d.data();
      totalReports++;
      if (data.status === 'confirmed' || data.status === 'actioned') {
        confirmedReports++;
      } else if (data.status === 'dismissed' || data.status === 'rejected') {
        dismissedReports++;
      }
    });

    const accuracy =
      totalReports > 0 ? (confirmedReports / totalReports) * 100 : 50;

    // Wilson score for credibility
    const credibilityScore = Math.round(
      wilsonScoreLowerBound(confirmedReports, Math.max(totalReports, 1)) * 100
    );

    return {
      userId: reporterId,
      credibilityScore,
      totalReports,
      confirmedReports,
      dismissedReports,
      accuracy: Math.round(accuracy),
    };
  } catch (error) {
    console.error('[ratingSystem] calculateReporterCredibility error:', error);
    return {
      userId: reporterId,
      credibilityScore: 50,
      totalReports: 0,
      confirmedReports: 0,
      dismissedReports: 0,
      accuracy: 50,
    };
  }
}

// ═════════════════════════════════════════════════════════
// Existing helpers (upgraded)
// ═════════════════════════════════════════════════════════

export async function shouldPromptForRating(
  currentUserId: string,
  matchId: string
): Promise<boolean> {
  try {
    const statusDoc = await getDoc(
      doc(db, 'ratingStatus', `${currentUserId}_${matchId}`)
    );

    if (statusDoc.exists()) {
      const statusData = statusDoc.data();
      if (statusData.didNotMeet) {
        const daysSince =
          (Date.now() - new Date(statusData.ratedAt).getTime()) /
          (1000 * 60 * 60 * 24);
        if (daysSince < 7) return false;
      } else {
        return false;
      }
    }

    const existingRating = await getDoc(
      doc(db, 'ratings', `${currentUserId}_rates_${matchId}`)
    );
    if (existingRating.exists()) return false;

    const [fromSnap, toSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'likes'),
          where('fromUserId', '==', currentUserId),
          where('toUserId', '==', matchId),
          where('status', '==', 'matched')
        )
      ),
      getDocs(
        query(
          collection(db, 'likes'),
          where('fromUserId', '==', matchId),
          where('toUserId', '==', currentUserId),
          where('status', '==', 'matched')
        )
      ),
    ]);

    const matchDoc = fromSnap.empty
      ? toSnap.docs[0]
      : fromSnap.docs[0];

    if (!matchDoc) return false;

    const matchedAt = matchDoc.data().matchedAt;
    if (!matchedAt) return false;

    const daysSince =
      (Date.now() - new Date(matchedAt).getTime()) / (1000 * 60 * 60 * 24);

    return daysSince >= 7;
  } catch (error) {
    console.error('[ratingSystem] shouldPromptForRating error:', error);
    return false;
  }
}

export function getVerificationLevel(
  user: any
): 'basic' | 'verified' | 'trusted' {
  const selfieVerified = user.selfieVerified ?? false;
  const ratings = user.ratings;

  if (
    selfieVerified &&
    ratings &&
    ratings.totalRatings >= 3 &&
    (ratings.averagePhotosMatch >= 4 || ratings.averageOverall >= 4)
  ) {
    return 'trusted';
  }

  return selfieVerified ? 'verified' : 'basic';
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
    return {
      level: 'new',
      label: `New (${ratings.totalRatings} ratings)`,
      color: '#3498db',
    };
  }

  const avgOverall = ratings.averageOverall ?? 0;
  const photoAccuracy = ratings.averagePhotosMatch ?? 0;
  const heightAccuracy = ratings.heightAccuracyRate ?? 0;

  if (avgOverall < 2 || photoAccuracy < 2 || heightAccuracy < 40) {
    return { level: 'flagged', label: 'Low trust', color: '#d9534f' };
  }

  if (avgOverall >= 4 && photoAccuracy >= 4 && heightAccuracy >= 70) {
    return {
      level: 'trusted',
      label: `Trusted (${ratings.totalRatings} ratings)`,
      color: '#f1c40f',
    };
  }

  return {
    level: 'new',
    label: `${ratings.totalRatings} ratings`,
    color: '#3498db',
  };
}

export function formatTrustScore(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Great';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'New';
}

export function getTrustScoreColor(score: number): string {
  if (score >= 80) return '#27ae60';
  if (score >= 60) return '#5cb85c';
  if (score >= 40) return '#f1c40f';
  if (score >= 20) return '#e67e22';
  return '#d9534f';
}