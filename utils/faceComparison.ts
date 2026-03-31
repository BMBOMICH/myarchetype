// utils/faceComparison.ts

import { doc, getDoc } from 'firebase/firestore';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { db } from '../firebaseConfig';
import { detectFaceInPhoto } from './faceDetection';
import { compareFaceDescriptors, detectFaces, isFaceVerificationReady, loadFaceVerification, verifyFaceMatch } from './faceVerification';

export interface FaceComparisonResult { match: boolean; confidence: number; method: 'face-api' | 'cloudinary-presence' | 'unavailable'; error?: string; }
export interface PhotoConsistencyResult { consistent: boolean; inconsistentPairs: Array<{ index1: number; index2: number; distance: number }>; confidence: number; reason?: string; }
export interface PerceptualHashResult { isDuplicate: boolean; similarity: number; matchedUserId?: string; reason?: string; }

export interface CatfishScore {
  score: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  signals: string[];
  breakdown: CatfishBreakdown;
  recommendation: string;
  confidence: number;
}

export interface CatfishBreakdown {
  identityScore: number;
  behaviorScore: number;
  verificationScore: number;
  accountScore: number;
  socialScore: number;
  contentScore: number;
}

const SERVER_URL = process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? 
  process.env.EXPO_PUBLIC_SERVER_URL ?? '';

// ─── #11 ─────────────────────────────────────────────────
export async function compareFaces(userId: string, selfieUri: string): Promise<FaceComparisonResult> {
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (!snap.exists()) return { match: false, confidence: 0, method: 'unavailable', error: 'User not found' };
    const photos: string[] = snap.data().photos ?? [];
    if (!photos.length) return { match: false, confidence: 0, method: 'unavailable', error: 'No profile photos' };
    const profileUri = photos[0]!;
    if (!isFaceVerificationReady()) await loadFaceVerification();
    if (isFaceVerificationReady()) {
      const r = await verifyFaceMatch(selfieUri, profileUri);
      return { match: r.match, confidence: r.confidence, method: 'face-api', error: r.match ? undefined : r.reason };
    }
    const selfieUrl = await uploadSelfieToCloudinary(selfieUri);
    if (!selfieUrl) return { match: false, confidence: 0, method: 'cloudinary-presence', error: 'Upload failed' };
    const [sc, pc] = await Promise.all([detectFaceInPhoto(selfieUrl), detectFaceInPhoto(profileUri)]);
    if (!sc.hasFace) return { match: false, confidence: 0, method: 'cloudinary-presence', error: sc.reason };
    if (!pc.hasFace) return { match: false, confidence: 0, method: 'cloudinary-presence', error: 'No face in profile' };
    return { match: true, confidence: 50, method: 'cloudinary-presence' };
  } catch { return { match: false, confidence: 0, method: 'unavailable', error: 'Comparison failed' }; }
}

// ─── #12 ─────────────────────────────────────────────────
export async function checkAllPhotosConsistency(photoUris: string[]): Promise<PhotoConsistencyResult> {
  if (photoUris.length < 2) return { consistent: true, inconsistentPairs: [], confidence: 100 };
  if (!isFaceVerificationReady()) await loadFaceVerification();
  if (!isFaceVerificationReady()) return { consistent: true, inconsistentPairs: [], confidence: 0, reason: 'Face verification unavailable' };
  try {
    const descriptors: (Float32Array | null)[] = await Promise.all(photoUris.map(async u => { const r = await detectFaces(u); return r.descriptors[0] ?? null; }));
    const base = descriptors[0];
    if (!base) return { consistent: true, inconsistentPairs: [], confidence: 0, reason: 'No face in first photo' };
    const pairs: Array<{ index1: number; index2: number; distance: number }> = [];
    for (let i = 1; i < descriptors.length; i++) {
      const d = descriptors[i];
      if (!d) continue;
      const dist = compareFaceDescriptors(base, d);
      if (dist > 0.6) pairs.push({ index1: 0, index2: i, distance: dist });
    }
    return { consistent: pairs.length === 0, inconsistentPairs: pairs, confidence: 85, reason: pairs.length > 0 ? `Photos ${pairs.map(p => p.index2 + 1).join(', ')} may show a different person.` : undefined };
  } catch { return { consistent: true, inconsistentPairs: [], confidence: 0, reason: 'Check failed' }; }
}

// ─── #14 ─────────────────────────────────────────────────
export async function computeImageHash(imageUri: string): Promise<string | null> {
  try {
    const doc = (globalThis as any).document;
    const canvas = doc?.createElement?.('canvas');
    if (!canvas) return null;
    canvas.width = 9; canvas.height = 8;
    const ctx = canvas.getContext('2d');
    const img = await new Promise<any>((res, rej) => {
      const el = doc.createElement('img');
      el.crossOrigin = 'anonymous';
      el.onload = () => res(el); el.onerror = rej; el.src = imageUri;
    });
    ctx.drawImage(img, 0, 0, 9, 8);
    const data = ctx.getImageData(0, 0, 9, 8).data;
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) gray.push(0.299 * (data[i] ?? 0) + 0.587 * (data[i+1] ?? 0) + 0.114 * (data[i+2] ?? 0));
    let hash = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const i = r * 9 + c; hash += (gray[i]! > gray[i+1]!) ? '1' : '0'; }
    return hash;
  } catch { return null; }
}

export function hammingDistance(h1: string, h2: string): number {
  if (h1.length !== h2.length) return h1.length;
  let d = 0;
  for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) d++;
  return d;
}

export async function checkDuplicatePhotoSameUser(newUri: string, existing: string[]): Promise<{ isDuplicate: boolean; duplicateIndex?: number; similarity: number }> {
  const nh = await computeImageHash(newUri);
  if (!nh) return { isDuplicate: false, similarity: 0 };
  for (let i = 0; i < existing.length; i++) {
    const eh = await computeImageHash(existing[i]!);
    if (!eh) continue;
    const sim = Math.round(((64 - hammingDistance(nh, eh)) / 64) * 100);
    if (sim >= 90) return { isDuplicate: true, duplicateIndex: i, similarity: sim };
  }
  return { isDuplicate: false, similarity: 0 };
}

// ─── #15 ─────────────────────────────────────────────────
export async function checkDuplicatePhotoCrossUsers(photoUri: string, userId: string): Promise<PerceptualHashResult> {
  try {
    const hash = await computeImageHash(photoUri);
    if (!hash) return { isDuplicate: false, similarity: 0 };
    const res = await fetch(`${SERVER_URL}/checkPhotoHash`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash, userId }) });
    if (!res.ok) return { isDuplicate: false, similarity: 0 };
    const data = await res.json();
    return { isDuplicate: data.isDuplicate ?? false, similarity: data.similarity ?? 0, matchedUserId: data.matchedUserId, reason: data.isDuplicate ? 'This photo is already used by another account.' : undefined };
  } catch { return { isDuplicate: false, similarity: 0 }; }
}

async function uploadSelfieToCloudinary(uri: string): Promise<string | null> {
  try {
    const blob = await (await fetch(uri)).blob();
    const fd = new FormData();
    fd.append('file', blob as any); fd.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset); fd.append('detection', 'faces');
    const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`, { method: 'POST', body: fd });
    return (await r.json()).secure_url ?? null;
  } catch { return null; }
}

export function compareFaceEmbeddings(e1: number[], e2: number[]): number {
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < e1.length; i++) { dot += (e1[i]??0)*(e2[i]??0); n1 += (e1[i]??0)**2; n2 += (e2[i]??0)**2; }
  const d = Math.sqrt(n1) * Math.sqrt(n2);
  return d === 0 ? 0 : Math.round((dot / d) * 100);
}

// ═══════════════════════════════════════════════════════════
// #98 — Catfish Likelihood Score (comprehensive)
// ═══════════════════════════════════════════════════════════

/**
 * Weight configuration for catfish scoring categories.
 * Each category contributes a weighted portion to the final 0-100 score.
 * Total weights = 100.
 */
const CATFISH_WEIGHTS = {
  identity: 30,       // face match, photo consistency, reverse image
  verification: 25,   // selfie verified, phone, social, email
  behavior: 20,       // message patterns, response timing, off-platform
  account: 10,        // age, completeness, bio, photo count
  social: 10,         // social links verified, username consistency
  content: 5,         // AI-generated images, EXIF anomalies, voice intro
} as const;

export interface CatfishInput {
  // ── Identity signals (#11, #12, #14, #15) ────────────
  faceMatchConfidence: number;          // 0-100 from verifyFaceMatch
  photoConsistencyConfidence: number;   // 0-100 from checkAllPhotosConsistency
  reverseImageSearchHits?: number;      // from server PDQ cross-account
  crossAccountDuplicate?: boolean;      // from checkDuplicatePhotoCrossUsers

  // ── Verification signals (#9, #26, #28, #81, #85) ───
  selfieVerified?: boolean;
  hasVerifiedSocial?: boolean;
  hasPhoneVerified?: boolean;
  emailVerified?: boolean;
  livenessChecked?: boolean;

  // ── Behavior signals (#97, #110, #111, #112, #113, #114, #115) ──
  askedForMoney?: boolean;
  triedToMoveOffPlatform?: boolean;
  videoCallRefused?: boolean;
  loveBombingDetected?: boolean;
  fastEscalation?: boolean;
  botLikeTimingDetected?: boolean;
  messageRiskScores?: number[];         // array of per-message risk scores

  // ── Account signals (#86, #102, #153) ────────────────
  accountAgeDays?: number;
  profileCompleteness?: number;         // 0-100
  bioLength?: number;
  photosCount?: number;
  deviceTrustScore?: number;            // 0-100 from device fingerprint checks

  // ── Social signals (#156-#163) ───────────────────────
  socialLinksCount?: number;
  socialUsernameConsistent?: boolean;
  socialRedirectSuspicious?: boolean;

  // ── Content signals (#13, #59, #123, #124, #125, #126) ──
  hasVoiceIntro?: boolean;
  aiGeneratedImageDetected?: boolean;
  exifAnomalies?: boolean;
  voiceGenderMismatch?: boolean;
  voiceCloneDetected?: boolean;

  // ── Trust / moderation history (#150, #101) ──────────
  currentTrustScore?: number;           // 0-100
  reportCount?: number;
  locationConsistent?: boolean;         // from #116, #117, #119
  bannedFaceMatch?: boolean;            // from #31
}

/**
 * Compute a comprehensive catfish likelihood score (0-100) by aggregating
 * signals from identity verification, behavioral analysis, account metadata,
 * social link validation, and content authenticity checks.
 *
 * Higher score = higher catfish likelihood.
 *
 * Integrates detectors: #9, #11, #12, #13, #14, #15, #26, #28, #31, #59,
 * #81, #85, #86, #97, #101, #102, #110, #111, #112, #113, #114, #115,
 * #116, #117, #119, #123, #124, #125, #126, #150, #153, #156-#163.
 */
export function computeCatfishScore(f: CatfishInput): CatfishScore {
  const signals: string[] = [];

  // ── 1. Identity sub-score (0-100) ────────────────────
  let identityRaw = 0;
  let identityFactors = 0;

  // Face match confidence (#11)
  if (f.faceMatchConfidence < 20) { identityRaw += 100; signals.push('Very low face match confidence'); }
  else if (f.faceMatchConfidence < 40) { identityRaw += 70; signals.push('Low face match confidence'); }
  else if (f.faceMatchConfidence < 60) { identityRaw += 40; signals.push('Moderate face match confidence'); }
  else if (f.faceMatchConfidence < 80) { identityRaw += 15; }
  identityFactors++;

  // Photo consistency (#12)
  if (f.photoConsistencyConfidence < 20) { identityRaw += 100; signals.push('Photos likely show different people'); }
  else if (f.photoConsistencyConfidence < 40) { identityRaw += 65; signals.push('Photos may show different people'); }
  else if (f.photoConsistencyConfidence < 60) { identityRaw += 30; signals.push('Some photo inconsistency'); }
  identityFactors++;

  // Reverse image search (#15)
  const hits = f.reverseImageSearchHits ?? 0;
  if (hits > 5) { identityRaw += 100; signals.push(`${hits} reverse image search hits — likely stolen photos`); }
  else if (hits > 2) { identityRaw += 70; signals.push(`${hits} reverse image search hits`); }
  else if (hits > 0) { identityRaw += 40; signals.push(`${hits} reverse image search hit(s)`); }
  identityFactors++;

  // Cross-account duplicate (#15)
  if (f.crossAccountDuplicate) { identityRaw += 90; signals.push('Photo used by another account'); }
  identityFactors++;

  // Banned face match (#31)
  if (f.bannedFaceMatch) { identityRaw += 100; signals.push('Face matches a previously banned user'); }
  identityFactors++;

  const identityScore = identityFactors > 0 ? Math.min(100, Math.round(identityRaw / identityFactors)) : 0;

  // ── 2. Verification sub-score (0-100) ────────────────
  let verificationPenalties = 0;

  if (!f.selfieVerified) { verificationPenalties += 35; signals.push('Selfie not verified'); }
  if (!f.hasPhoneVerified) { verificationPenalties += 20; signals.push('Phone not verified'); }
  if (!f.emailVerified) { verificationPenalties += 15; signals.push('Email not verified'); }
  if (!f.hasVerifiedSocial) { verificationPenalties += 20; signals.push('No verified social accounts'); }
  if (!f.livenessChecked) { verificationPenalties += 10; signals.push('Liveness check not completed'); }

  const verificationScore = Math.min(100, verificationPenalties);

  // ── 3. Behavior sub-score (0-100) ────────────────────
  let behaviorRaw = 0;

  if (f.askedForMoney) { behaviorRaw += 50; signals.push('Requested money or financial help'); }
  if (f.triedToMoveOffPlatform) { behaviorRaw += 30; signals.push('Tried to move conversation off-platform'); }
  if (f.videoCallRefused) { behaviorRaw += 25; signals.push('Refused video call requests'); }
  if (f.loveBombingDetected) { behaviorRaw += 20; signals.push('Love bombing behavior detected'); }
  if (f.fastEscalation) { behaviorRaw += 20; signals.push('Conversation escalated unusually fast'); }
  if (f.botLikeTimingDetected) { behaviorRaw += 30; signals.push('Bot-like message timing patterns'); }

  // Aggregate message risk scores
  if (f.messageRiskScores?.length) {
    const avgRisk = f.messageRiskScores.reduce((a, b) => a + b, 0) / f.messageRiskScores.length;
    if (avgRisk > 50) { behaviorRaw += 25; signals.push('High average message risk score'); }
    else if (avgRisk > 30) { behaviorRaw += 10; signals.push('Elevated message risk patterns'); }
  }

  const behaviorScore = Math.min(100, behaviorRaw);

  // ── 4. Account sub-score (0-100) ─────────────────────
  let accountRaw = 0;

  const ageDays = f.accountAgeDays ?? 365;
  if (ageDays < 1) { accountRaw += 40; signals.push('Account created today'); }
  else if (ageDays < 3) { accountRaw += 30; signals.push('Account less than 3 days old'); }
  else if (ageDays < 7) { accountRaw += 20; signals.push('Account less than 1 week old'); }
  else if (ageDays < 30) { accountRaw += 10; signals.push('Account less than 1 month old'); }

  const completeness = f.profileCompleteness ?? 100;
  if (completeness < 30) { accountRaw += 30; signals.push('Profile less than 30% complete'); }
  else if (completeness < 50) { accountRaw += 20; signals.push('Profile less than 50% complete'); }
  else if (completeness < 70) { accountRaw += 10; signals.push('Profile less than 70% complete'); }

  if ((f.bioLength ?? 100) < 10) { accountRaw += 15; signals.push('No bio or extremely short bio'); }
  else if ((f.bioLength ?? 100) < 30) { accountRaw += 5; signals.push('Very short bio'); }

  if ((f.photosCount ?? 4) < 2) { accountRaw += 20; signals.push('Only 1 profile photo'); }
  else if ((f.photosCount ?? 4) < 3) { accountRaw += 5; signals.push('Few profile photos'); }

  // Device trust (#86)
  const deviceTrust = f.deviceTrustScore ?? 80;
  if (deviceTrust < 20) { accountRaw += 25; signals.push('Very low device trust score'); }
  else if (deviceTrust < 50) { accountRaw += 10; signals.push('Low device trust score'); }

  const accountScore = Math.min(100, accountRaw);

  // ── 5. Social sub-score (0-100) ──────────────────────
  let socialRaw = 0;

  const socialLinks = f.socialLinksCount ?? 0;
  if (socialLinks === 0) { socialRaw += 40; signals.push('No social media links provided'); }
  else if (socialLinks < 2) { socialRaw += 15; }

  if (f.socialUsernameConsistent === false) { socialRaw += 30; signals.push('Social media usernames inconsistent with profile'); }
  if (f.socialRedirectSuspicious) { socialRaw += 30; signals.push('Social media link has suspicious redirect chain'); }

  const socialScore = Math.min(100, socialRaw);

  // ── 6. Content sub-score (0-100) ─────────────────────
  let contentRaw = 0;

  if (!f.hasVoiceIntro) { contentRaw += 15; signals.push('No voice intro recorded'); }
  if (f.aiGeneratedImageDetected) { contentRaw += 40; signals.push('AI-generated image detected'); }
  if (f.exifAnomalies) { contentRaw += 25; signals.push('Photo EXIF metadata anomalies'); }
  if (f.voiceGenderMismatch) { contentRaw += 35; signals.push('Voice gender does not match profile gender'); }
  if (f.voiceCloneDetected) { contentRaw += 40; signals.push('Possible voice clone detected'); }

  const contentScore = Math.min(100, contentRaw);

  // ── Weighted composite score ─────────────────────────
  let composite =
    (identityScore * CATFISH_WEIGHTS.identity +
     verificationScore * CATFISH_WEIGHTS.verification +
     behaviorScore * CATFISH_WEIGHTS.behavior +
     accountScore * CATFISH_WEIGHTS.account +
     socialScore * CATFISH_WEIGHTS.social +
     contentScore * CATFISH_WEIGHTS.content) / 100;

  // ── Override multipliers for critical signals ────────
  if (f.bannedFaceMatch) composite = Math.max(composite, 90);
  if (f.crossAccountDuplicate && hits > 2) composite = Math.max(composite, 80);
  if (f.askedForMoney && f.videoCallRefused) composite = Math.max(composite, 75);

  // ── Factor in existing trust score if available (#150) ──
  if (f.currentTrustScore !== undefined) {
    // Low trust score amplifies catfish likelihood
    const trustPenalty = Math.max(0, (50 - f.currentTrustScore) * 0.2);
    composite += trustPenalty;
  }

  // ── Factor in report history (#101) ──────────────────
  if (f.reportCount !== undefined && f.reportCount > 0) {
    const reportPenalty = Math.min(15, f.reportCount * 3);
    composite += reportPenalty;
    if (f.reportCount >= 3) signals.push(`${f.reportCount} reports filed against this user`);
  }

  // ── Location consistency (#116, #117, #119) ──────────
  if (f.locationConsistent === false) {
    composite += 8;
    signals.push('Geographic location inconsistencies detected');
  }

  const score = Math.min(100, Math.max(0, Math.round(composite)));

  // ── Risk level ───────────────────────────────────────
  const risk: CatfishScore['risk'] =
    score >= 75 ? 'critical'
    : score >= 50 ? 'high'
    : score >= 25 ? 'medium'
    : 'low';

  // ── Recommendation ───────────────────────────────────
  const recommendation =
    risk === 'critical'
      ? 'Very high catfish probability. This profile should be reviewed by moderation immediately. Do not share personal information.'
      : risk === 'high'
      ? 'Multiple catfish indicators detected. Exercise extreme caution. Request a video call before meeting.'
      : risk === 'medium'
      ? 'Some suspicious signals detected. Verify their identity through video call and verified social media before sharing personal details.'
      : 'Profile appears authentic. Continue with normal safety precautions.';

  // ── Confidence based on data availability ────────────
  let dataPoints = 0;
  let totalPossible = 0;
  const checkDefined = (v: any) => { totalPossible++; if (v !== undefined && v !== null) dataPoints++; };

  checkDefined(f.faceMatchConfidence);
  checkDefined(f.photoConsistencyConfidence);
  checkDefined(f.reverseImageSearchHits);
  checkDefined(f.selfieVerified);
  checkDefined(f.hasPhoneVerified);
  checkDefined(f.hasVerifiedSocial);
  checkDefined(f.emailVerified);
  checkDefined(f.accountAgeDays);
  checkDefined(f.profileCompleteness);
  checkDefined(f.photosCount);
  checkDefined(f.bioLength);
  checkDefined(f.hasVoiceIntro);
  checkDefined(f.askedForMoney);
  checkDefined(f.triedToMoveOffPlatform);
  checkDefined(f.videoCallRefused);
  checkDefined(f.currentTrustScore);
  checkDefined(f.deviceTrustScore);
  checkDefined(f.socialLinksCount);
  checkDefined(f.messageRiskScores);
  checkDefined(f.locationConsistent);

  const confidence = totalPossible > 0 ? Math.round((dataPoints / totalPossible) * 100) : 0;

  // ── De-duplicate signals ─────────────────────────────
  const uniqueSignals = [...new Set(signals)];

  return {
    score,
    risk,
    signals: uniqueSignals,
    breakdown: {
      identityScore,
      behaviorScore,
      verificationScore,
      accountScore,
      socialScore,
      contentScore,
    },
    recommendation,
    confidence,
  };
}

// ── Server-side enriched catfish check ─────────────────────

/**
 * Fetch additional signals from the server (reverse image search,
 * cross-account PDQ, report history, trust score) and compute
 * a fully enriched catfish score.
 */
export async function computeEnrichedCatfishScore(
  userId: string,
  baseInput: Partial<CatfishInput>,
  authToken?: string,
): Promise<CatfishScore> {
  let enriched: CatfishInput = {
    faceMatchConfidence: baseInput.faceMatchConfidence ?? 0,
    photoConsistencyConfidence: baseInput.photoConsistencyConfidence ?? 0,
    ...baseInput,
  };

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch(`${SERVER_URL}/catfish-signals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId }),
    });

    if (res.ok) {
      const serverData = await res.json();
      enriched = {
        ...enriched,
        reverseImageSearchHits: serverData.reverseImageSearchHits ?? enriched.reverseImageSearchHits,
        crossAccountDuplicate: serverData.crossAccountDuplicate ?? enriched.crossAccountDuplicate,
        currentTrustScore: serverData.trustScore ?? enriched.currentTrustScore,
        reportCount: serverData.reportCount ?? enriched.reportCount,
        bannedFaceMatch: serverData.bannedFaceMatch ?? enriched.bannedFaceMatch,
        deviceTrustScore: serverData.deviceTrustScore ?? enriched.deviceTrustScore,
        locationConsistent: serverData.locationConsistent ?? enriched.locationConsistent,
      };
    }
  } catch {
    // Server unavailable — proceed with client-side signals only
  }

  // Pull user doc for additional signals
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (snap.exists()) {
      const data = snap.data();
      enriched.selfieVerified = enriched.selfieVerified ?? data.selfieVerified ?? false;
      enriched.hasPhoneVerified = enriched.hasPhoneVerified ?? data.phoneVerified ?? false;
      enriched.emailVerified = enriched.emailVerified ?? data.emailVerified ?? false;
      enriched.profileCompleteness = enriched.profileCompleteness ?? data.profileCompleteness;
      enriched.photosCount = enriched.photosCount ?? (data.photos?.length ?? 0);
      enriched.bioLength = enriched.bioLength ?? (data.bio?.length ?? 0);
      enriched.hasVoiceIntro = enriched.hasVoiceIntro ?? !!data.voiceIntroUrl;
      enriched.socialLinksCount = enriched.socialLinksCount ??
        [data.instagram, data.spotify, data.tiktok, data.linkedin].filter(Boolean).length;

      if (data.createdAt) {
        const created = typeof data.createdAt === 'string' ? new Date(data.createdAt).getTime() : data.createdAt?.toMillis?.() ?? data.createdAt;
        enriched.accountAgeDays = enriched.accountAgeDays ?? Math.floor((Date.now() - created) / 86400000);
      }
    }
  } catch {
    // Firestore unavailable — proceed with what we have
  }

  return computeCatfishScore(enriched);
}