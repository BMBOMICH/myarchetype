/**
 * utils/ratingSystem.ts
 * Detectors: #107 Rating manipulation, #150 Trust score, #151 Auto-actions,
 * #152 Reporter credibility, #154 Verification badge, #155 Trust decay
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { detectRatingManipulation, wilsonScoreLowerBound } from './datingStats';
import { logger, writeAuditLog } from './logger';
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
  score: number;
  level: 'critical' | 'low' | 'medium' | 'high' | 'excellent';
  actions: TrustAction[];
  breakdown: Record<string, number>;
}

export type TrustAction = 'none' | 'warn' | 'restrict' | 'shadow_ban' | 'ban';

export interface ReporterCredibility {
  userId: string;
  credibilityScore: number;
  totalReports: number;
  confirmedReports: number;
  dismissedReports: number;
  accuracy: number;
}

interface RatingsData {
  totalRatings: number;
  averagePhotosMatch: number;
  heightAccuracyRate?: number;
  bodyTypeAccuracyRate?: number;
  ageAccuracyRate?: number;
  averagePersonalityMatch: number;
  averageOverall: number;
}

interface UserDocData {
  ratings?: RatingsData;
  rawRatings?: number[];
  ratingHistory?: unknown[];
  emailVerified?: boolean;
  selfieVerified?: boolean;
  ageVerification?: { verified?: boolean };
  phoneVerified?: boolean;
  socialLinks?: {
    instagram?: { username?: string };
    linkedin?:  { profileUrl?: string };
  };
  photos?: string[];
  bio?: string;
  confirmedReports?: number;
  previousBans?: number;
  violations?: unknown[];
}

interface ReportDoc {
  status?: string;
}

export function bayesianAverage(
  userRatings: number[],
  globalMean         = 3.5,
  confidenceConstant = 10,
): number {
  if (userRatings.length === 0) return globalMean;
  const n        = userRatings.length;
  const userMean = userRatings.reduce((a, b) => a + b, 0) / n;
  return (confidenceConstant * globalMean + n * userMean) / (confidenceConstant + n);
}

export async function getUserRatings(userId: string): Promise<UserRatings | null> {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) return null;

    const userData = userDoc.data() as UserDocData;
    const ratings  = userData.ratings;

    if (!ratings) {
      return { totalRatings: 0, averagePhotosMatch: 0, heightAccuracyRate: 0, bodyTypeAccuracyRate: 0, ageAccuracyRate: 0, averagePersonalityMatch: 0, averageOverall: 0, trustScore: 0, isTrusted: false, wilsonScore: 0, bayesianScore: 0 };
    }

    const positiveRatings = Math.round((ratings.averageOverall / 5) * ratings.totalRatings);
    const wilsonScore     = wilsonScoreLowerBound(positiveRatings, ratings.totalRatings);
    const bayesianScore   = bayesianAverage(userData.rawRatings ?? []);

    const ratingHistory      = userData.ratingHistory ?? [];
    const manipulationCheck  = detectRatingManipulation(ratingHistory);
    if (manipulationCheck.manipulated) {
      logger.warn('[ratingSystem] Rating manipulation detected for user:', userId, manipulationCheck.reason);
    }

    const trustScore = calculateTrustScore(ratings);
    const isTrusted  = trustScore >= 75 && ratings.totalRatings >= 3;

    return {
      ...ratings,
      trustScore,
      isTrusted,
      wilsonScore:   Math.round(wilsonScore * 100),
      bayesianScore: Math.round(bayesianScore * 10) / 10,
    };
  } catch (error) {
    logger.error('[ratingSystem] getUserRatings error:', error);
    return null;
  }
}

function calculateTrustScore(ratings: RatingsData): number {
  if (!ratings || ratings.totalRatings === 0) return 0;
  const w = { photos: 0.25, height: 0.15, bodyType: 0.15, age: 0.15, personality: 0.15, overall: 0.15 };
  return Math.round(
    ((ratings.averagePhotosMatch / 5) * 100)      * w.photos +
    (ratings.heightAccuracyRate ?? 0)              * w.height +
    (ratings.bodyTypeAccuracyRate ?? 0)            * w.bodyType +
    (ratings.ageAccuracyRate ?? 0)                 * w.age +
    ((ratings.averagePersonalityMatch / 5) * 100)  * w.personality +
    (((ratings.averageOverall ?? 0) / 5) * 100)    * w.overall,
  );
}

export async function calculateUserTrustScore(userId: string): Promise<TrustScoreResult> {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) return { score: 0, level: 'critical', actions: ['restrict'], breakdown: {} };

    const data      = userDoc.data() as UserDocData;
    const breakdown: Record<string, number> = {};
    let score = 50;

    if (data.emailVerified)                 { breakdown['email_verified']   = 10; score += 10; }
    if (data.selfieVerified)                { breakdown['selfie_verified']  = 15; score += 15; }
    if (data.ageVerification?.verified)     { breakdown['age_verified']     = 10; score += 10; }
    if (data.phoneVerified)                 { breakdown['phone_verified']   = 10; score += 10; }
    if (data.socialLinks?.instagram?.username || data.socialLinks?.linkedin?.profileUrl) {
      breakdown['social_links'] = 5; score += 5;
    }
    const photoCount = data.photos?.length ?? 0;
    const hasBio     = (data.bio?.length ?? 0) > 20;
    if (photoCount >= 3 && hasBio)          { breakdown['complete_profile'] = 5; score += 5; }

    const confirmedReports = data.confirmedReports ?? 0;
    if (confirmedReports > 0) {
      const penalty = Math.min(30, confirmedReports * 10);
      breakdown['confirmed_reports'] = -penalty; score -= penalty;
    }
    if ((data.previousBans ?? 0) > 0)       { breakdown['previous_bans'] = -20; score -= 20; }

    score = applyTrustDecay(score, data.violations ?? []);
    score = Math.max(0, Math.min(100, score));

    const actions = determineAutoActions(score);
    if (actions.includes('restrict') || actions.includes('ban')) {
      await writeAuditLog('admin.update_trust_score', { userId, score, actions, breakdown }, userId);
    }

    return {
      score,
      level:   score >= 80 ? 'excellent' : score >= 60 ? 'high' : score >= 40 ? 'medium' : score >= 20 ? 'low' : 'critical',
      actions,
      breakdown,
    };
  } catch (error) {
    logger.error('[ratingSystem] calculateUserTrustScore error:', error);
    return { score: 0, level: 'critical', actions: ['restrict'], breakdown: {} };
  }
}

export function determineAutoActions(score: number): TrustAction[] {
  if (score >= 60) return ['none'];
  if (score >= 40) return ['warn'];
  if (score >= 25) return ['restrict'];
  if (score >= 10) return ['shadow_ban'];
  return ['ban'];
}

export async function calculateReporterCredibility(reporterId: string): Promise<ReporterCredibility> {
  try {
    const reportsSnap = await getDocs(query(collection(db, 'reports'), where('reporterId', '==', reporterId)));
    let totalReports = 0, confirmedReports = 0, dismissedReports = 0;

    reportsSnap.forEach((d) => {
      const data = d.data() as ReportDoc;
      totalReports++;
      if (data.status === 'confirmed' || data.status === 'actioned') confirmedReports++;
      else if (data.status === 'dismissed' || data.status === 'rejected') dismissedReports++;
    });

    const accuracy         = totalReports > 0 ? (confirmedReports / totalReports) * 100 : 50;
    const credibilityScore = Math.round(wilsonScoreLowerBound(confirmedReports, Math.max(totalReports, 1)) * 100);

    return { userId: reporterId, credibilityScore, totalReports, confirmedReports, dismissedReports, accuracy: Math.round(accuracy) };
  } catch (error) {
    logger.error('[ratingSystem] calculateReporterCredibility error:', error);
    return { userId: reporterId, credibilityScore: 50, totalReports: 0, confirmedReports: 0, dismissedReports: 0, accuracy: 50 };
  }
}

export async function shouldPromptForRating(currentUserId: string, matchId: string): Promise<boolean> {
  try {
    const statusDoc = await getDoc(doc(db, 'ratingStatus', `${currentUserId}_${matchId}`));
    if (statusDoc.exists()) {
      const statusData = statusDoc.data() as { didNotMeet?: boolean; ratedAt?: string };
      if (statusData.didNotMeet) {
        const daysSince = (Date.now() - new Date(statusData.ratedAt ?? 0).getTime()) / (1_000 * 60 * 60 * 24);
        if (daysSince < 7) return false;
      } else return false;
    }

    const existingRating = await getDoc(doc(db, 'ratings', `${currentUserId}_rates_${matchId}`));
    if (existingRating.exists()) return false;

    const [fromSnap, toSnap] = await Promise.all([
      getDocs(query(collection(db, 'likes').catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }), where('fromUserId', '==', currentUserId), where('toUserId', '==', matchId),   where('status', '==', 'matched'))),
      getDocs(query(collection(db, 'likes'), where('fromUserId', '==', matchId),       where('toUserId', '==', currentUserId), where('status', '==', 'matched'))),
    ]);

    const matchDoc = fromSnap.empty ? toSnap.docs[0] : fromSnap.docs[0];
    if (!matchDoc) return false;

    const matchedAt = (matchDoc.data() as { matchedAt?: string }).matchedAt;
    if (!matchedAt) return false;

    const daysSince = (Date.now() - new Date(matchedAt).getTime()) / (1_000 * 60 * 60 * 24);
    return daysSince >= 7;
  } catch (error) {
    logger.error('[ratingSystem] shouldPromptForRating error:', error);
    return false;
  }
}

export function getVerificationLevel(user: UserDocData & { selfieVerified?: boolean; ratings?: RatingsData }): 'basic' | 'verified' | 'trusted' {
  const selfieVerified = user.selfieVerified ?? false;
  const ratings        = user.ratings;
  if (selfieVerified && ratings && ratings.totalRatings >= 3 && (ratings.averagePhotosMatch >= 4 || ratings.averageOverall >= 4)) return 'trusted';
  return selfieVerified ? 'verified' : 'basic';
}

export function getUserTrustLevel(ratings: UserRatings | null): { level: 'none' | 'new' | 'trusted' | 'flagged'; label: string; color: string } {
  if (!ratings || ratings.totalRatings === 0) return { level: 'none', label: 'No ratings yet', color: '#888' };
  if (ratings.totalRatings < 3)               return { level: 'new',  label: `New (${ratings.totalRatings} ratings)`, color: '#3498db' };

  const avgOverall    = ratings.averageOverall    ?? 0;
  const photoAccuracy = ratings.averagePhotosMatch ?? 0;
  const heightAccuracy= ratings.heightAccuracyRate ?? 0;

  if (avgOverall < 2 || photoAccuracy < 2 || heightAccuracy < 40) return { level: 'flagged', label: 'Low trust',                               color: '#d9534f' };
  if (avgOverall >= 4 && photoAccuracy >= 4 && heightAccuracy >= 70) return { level: 'trusted', label: `Trusted (${ratings.totalRatings} ratings)`, color: '#f1c40f' };
  return { level: 'new', label: `${ratings.totalRatings} ratings`, color: '#3498db' };
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
