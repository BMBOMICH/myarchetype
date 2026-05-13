import { doc, getDoc } from 'firebase/firestore';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { db } from '../firebaseConfig';
import { detectFaceInPhoto } from './faceDetection';
import { writeAuditLog } from './logger';

// Local shim for missing Storage module
const _store: Record<string, string> = {};
const Storage = {
  getString: (key: string): string | undefined => _store[key],
  setString: (key: string, value: string): void => { _store[key] = value; },
  delete: (key: string): void => { delete _store[key]; },
};

const SERVER_URL = process.env['EXPO_PUBLIC_FUNCTIONS_URL'] ?? process.env['EXPO_PUBLIC_SERVER_URL'] ?? '';
const fetchSafe = async (u: string, o: RequestInit, t = 8000) => {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), t);
  try { return await fetch(u, { ...o, signal: c.signal }); }
  finally { clearTimeout(id); }
};

export interface FaceComparisonResult { match: boolean; confidence: number; method: 'retinaface_arcface' | 'cloudinary-presence' | 'unavailable'; error?: string; }
export interface PhotoConsistencyResult { consistent: boolean; inconsistentPairs: Array<{ index1: number; index2: number; distance: number }>; confidence: number; reason?: string; }
export interface PerceptualHashResult { isDuplicate: boolean; similarity: number; matchedUserId?: string; reason?: string; }
export interface CatfishScore { score: number; risk: 'low' | 'medium' | 'high' | 'critical'; signals: string[]; breakdown: CatfishBreakdown; recommendation: string; confidence: number; }
export interface CatfishBreakdown { identityScore: number; behaviorScore: number; verificationScore: number; accountScore: number; socialScore: number; contentScore: number; }

interface RetinaArcResult { match: boolean; similarity: number; distance: number; }
interface FaceDetectionResult { hasFace: boolean; reason?: string; }
interface CloudinaryUploadResult { secure_url?: string; }
interface CatfishSignalResponse {
  reverseImageSearchHits?: number; crossAccountDuplicate?: boolean; trustScore?: number;
  reportCount?: number; bannedFaceMatch?: boolean; deviceTrustScore?: number; locationConsistent?: boolean;
}
interface UserDocument {
  selfieVerified?: boolean; phoneVerified?: boolean; emailVerified?: boolean; profileCompleteness?: number;
  photos?: string[]; bio?: string; voiceIntroUrl?: string;
  instagram?: string; spotify?: string; tiktok?: string; linkedin?: string;
  createdAt?: string | number | { toMillis?: () => number };
}

/**
 * Server-side face comparison using RetinaFace (detection) + ArcFace (embedding).
 * RetinaFace detects faces and extracts 5-point landmarks.
 * ArcFace generates 512-d embeddings used for cosine similarity.
 */
async function compareFacesRetinaArc(u1: string, u2: string): Promise<RetinaArcResult | null> {
  try {
    const r = await fetchSafe(`${SERVER_URL}/api/compare-faces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUri1: u1, imageUri2: u2, detector: 'retinaface', recognizer: 'arcface', threshold: 0.5 }),
    });
    if (r.ok) return await r.json() as RetinaArcResult;
  } catch { /* empty */ }
  return null;
}

async function compareFacesRetinaArcMulti(selfie: string, photos: string[]): Promise<FaceComparisonResult | null> {
  for (const photo of photos) {
    const r = await compareFacesRetinaArc(selfie, photo);
    if (r) {
      return { match: r.match, confidence: Math.round(r.similarity * 100), method: 'retinaface_arcface', error: r.match ? undefined : 'Face mismatch' };
    }
  }
  return null;
}

export async function compareFaces(uid: string, selfie: string): Promise<FaceComparisonResult> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return { match: false, confidence: 0, method: 'unavailable', error: 'User not found' };
    const data = snap.data() as UserDocument;
    const photos = data.photos ?? [];
    if (photos.length === 0) return { match: false, confidence: 0, method: 'unavailable', error: 'No profile photos' };

    const retinaResult = await compareFacesRetinaArcMulti(selfie, photos);
    if (retinaResult) return retinaResult;

    const su = await uploadSelfieToCloudinary(selfie);
    if (!su) return { match: false, confidence: 0, method: 'cloudinary-presence', error: 'Upload failed' };

    const firstPhoto = photos[0];
    if (!firstPhoto) return { match: false, confidence: 0, method: 'unavailable', error: 'No profile photos' };

    const detectFace = detectFaceInPhoto as (uri: string) => Promise<FaceDetectionResult>;
    const [sc, pc] = await Promise.all([
      detectFace(su).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),
      detectFace(firstPhoto),
    ]);

    if (!sc.hasFace) return { match: false, confidence: 0, method: 'cloudinary-presence', error: sc.reason };
    if (!pc.hasFace) return { match: false, confidence: 0, method: 'cloudinary-presence', error: 'No face in profile' };
    return { match: true, confidence: 50, method: 'cloudinary-presence' };
  } catch { return { match: false, confidence: 0, method: 'unavailable', error: 'Comparison failed' }; }
}

export async function checkAllPhotosConsistency(uris: string[]): Promise<PhotoConsistencyResult> {
  if (uris.length < 2) return { consistent: true, inconsistentPairs: [], confidence: 100 };
  try {
    const pairs: Array<{ index1: number; index2: number; distance: number }> = [];
    const baseUri = uris[0];
    if (!baseUri) return { consistent: true, inconsistentPairs: [], confidence: 100 };
    for (let i = 1; i < uris.length; i++) {
      const uri = uris[i];
      if (!uri) continue;
      const r = await compareFacesRetinaArc(baseUri, uri);
      if (r && !r.match) { pairs.push({ index1: 0, index2: i, distance: r.distance }); }
    }
    return {
      consistent: pairs.length === 0,
      inconsistentPairs: pairs,
      confidence: pairs.length > 0 ? 85 : 90,
      ...(pairs.length > 0 ? { reason: `Photos ${pairs.map(p => p.index2 + 1).join(', ')} may show different people.` } : {}),
    };
  } catch { return { consistent: true, inconsistentPairs: [], confidence: 0, reason: 'Check failed' }; }
}

export async function computeImageHash(uri: string): Promise<string | null> {
  if (SERVER_URL) {
    try {
      const r = await fetchSafe(`${SERVER_URL}/api/compute-pdq-hash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUri: uri }),
      });
      if (r.ok) {
        const d = await r.json() as { hash: string; quality: number };
        if (d.hash && d.quality >= 50) return d.hash;
      }
    } catch { /* empty */ }
  }
  try {
    interface BrowserDoc {
      createElement(tag: 'canvas'): HTMLCanvasElement;
      createElement(tag: 'img'): HTMLImageElement;
      createElement(tag: string): HTMLElement;
    }
    const doc = (globalThis as unknown as { document?: BrowserDoc }).document;
    if (!doc) return null;
    const canvas = doc.createElement('canvas');
    canvas.width = 9; canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = doc.createElement('img');
      el.crossOrigin = 'anonymous';
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = uri;
    });
    ctx.drawImage(img, 0, 0, 9, 8);
    const data = ctx.getImageData(0, 0, 9, 8).data;
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) gray.push(0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0));
    let hash = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const i = r * 9 + c; hash += (gray[i]! > gray[i + 1]!) ? '1' : '0'; }

    Storage.setString(`img_hash_${uri.slice(-32)}`, hash);

    return hash;
  } catch { return null; }
}

export function hammingDistance(h1: string, h2: string) {
  if (h1.length !== h2.length) return h1.length;
  let d = 0;
  for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) d++;
  return d;
}

export async function checkDuplicatePhotoSameUser(newUri: string, existing: string[]) {
  const nh = await computeImageHash(newUri);
  if (!nh) return { isDuplicate: false, similarity: 0 };
  for (let i = 0; i < existing.length; i++) {
    const ex = existing[i];
    if (!ex) continue;
    const eh = await computeImageHash(ex);
    if (!eh) continue;
    const sim = Math.round(((64 - hammingDistance(nh, eh)) / 64) * 100);
    if (sim >= 90) return { isDuplicate: true, duplicateIndex: i, similarity: sim };
  }
  return { isDuplicate: false, similarity: 0 };
}

export async function checkDuplicatePhotoCrossUsers(uri: string, uid: string): Promise<PerceptualHashResult> {
  try {
    const h = await computeImageHash(uri);
    if (!h) return { isDuplicate: false, similarity: 0 };
    const r = await fetchSafe(`${SERVER_URL}/checkPhotoHash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: h, userId: uid, hashType: 'pdq' }),
    });
    if (!r.ok) return { isDuplicate: false, similarity: 0 };
    const d = await r.json() as { isDuplicate?: boolean; similarity?: number; matchedUserId?: string };
    return { isDuplicate: d.isDuplicate ?? false, similarity: d.similarity ?? 0, matchedUserId: d.matchedUserId, reason: d.isDuplicate ? 'Photo used by another account.' : undefined };
  } catch { return { isDuplicate: false, similarity: 0 }; }
}

async function uploadSelfieToCloudinary(uri: string): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append('file', { uri, type: 'image/jpeg', name: 'selfie.jpg' } as unknown as Blob);
    fd.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    fd.append('detection', 'faces');
    const r = await fetchSafe(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`, { method: 'POST', body: fd });
    const j = await r.json() as CloudinaryUploadResult;
    return j.secure_url ?? null;
  } catch { return null; }
}

export function compareFaceEmbeddings(e1: number[], e2: number[]) {
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < e1.length; i++) {
    const v1 = e1[i] ?? 0;
    const v2 = e2[i] ?? 0;
    dot += v1 * v2;
    n1 += v1 ** 2;
    n2 += v2 ** 2;
  }
  const d = Math.sqrt(n1) * Math.sqrt(n2);
  return d === 0 ? 0 : Math.round((dot / d) * 100);
}

const CW = { identity: 30, verification: 25, behavior: 20, account: 10, social: 10, content: 5 } as const;

export interface CatfishInput {
  faceMatchConfidence: number; photoConsistencyConfidence: number; reverseImageSearchHits?: number;
  crossAccountDuplicate?: boolean; selfieVerified?: boolean; hasVerifiedSocial?: boolean;
  hasPhoneVerified?: boolean; emailVerified?: boolean; livenessChecked?: boolean;
  askedForMoney?: boolean; triedToMoveOffPlatform?: boolean; videoCallRefused?: boolean;
  loveBombingDetected?: boolean; fastEscalation?: boolean; botLikeTimingDetected?: boolean;
  messageRiskScores?: number[]; accountAgeDays?: number; profileCompleteness?: number;
  bioLength?: number; photosCount?: number; deviceTrustScore?: number; socialLinksCount?: number;
  socialUsernameConsistent?: boolean; socialRedirectSuspicious?: boolean; hasVoiceIntro?: boolean;
  aiGeneratedImageDetected?: boolean; exifAnomalies?: boolean; voiceGenderMismatch?: boolean;
  voiceCloneDetected?: boolean; currentTrustScore?: number; reportCount?: number;
  locationConsistent?: boolean; bannedFaceMatch?: boolean;
}

export function computeCatfishScore(f: CatfishInput): CatfishScore {
  const sig: string[] = []; let iR = 0, iF = 0;
  if (f.faceMatchConfidence < 20) { iR += 100; sig.push('Very low face match'); } else if (f.faceMatchConfidence < 40) { iR += 70; sig.push('Low face match'); } else if (f.faceMatchConfidence < 60) { iR += 40; sig.push('Moderate face match'); } else if (f.faceMatchConfidence < 80) { iR += 15; } iF++;
  if (f.photoConsistencyConfidence < 20) { iR += 100; sig.push('Photos likely different people'); } else if (f.photoConsistencyConfidence < 40) { iR += 65; sig.push('Photos may differ'); } else if (f.photoConsistencyConfidence < 60) { iR += 30; sig.push('Some inconsistency'); } iF++;
  const hits = f.reverseImageSearchHits ?? 0;
  if (hits > 5) { iR += 100; sig.push(`${hits} reverse search hits`); } else if (hits > 2) { iR += 70; sig.push(`${hits} reverse search hits`); } else if (hits > 0) { iR += 40; sig.push(`${hits} reverse search hit`); } iF++;
  if (f.crossAccountDuplicate) { iR += 90; sig.push('Photo used by another account'); } iF++;
  if (f.bannedFaceMatch) { iR += 100; sig.push('Face matches banned user'); } iF++;
  const identityScore = iF > 0 ? Math.min(100, Math.round(iR / iF)) : 0;
  let vP = 0;
  if (!f.selfieVerified) vP += 35; if (!f.hasPhoneVerified) vP += 20; if (!f.emailVerified) vP += 15; if (!f.hasVerifiedSocial) vP += 20; if (!f.livenessChecked) vP += 10;
  const verificationScore = Math.min(100, vP);
  let bR = 0;
  if (f.askedForMoney) bR += 50; if (f.triedToMoveOffPlatform) bR += 30; if (f.videoCallRefused) bR += 25; if (f.loveBombingDetected) bR += 20; if (f.fastEscalation) bR += 20; if (f.botLikeTimingDetected) bR += 30;
  if (f.messageRiskScores?.length) { const a = f.messageRiskScores.reduce((x, y) => x + y, 0) / f.messageRiskScores.length; if (a > 50) { bR += 25; sig.push('High message risk'); } else if (a > 30) bR += 10; }
  const behaviorScore = Math.min(100, bR);
  let aR = 0;
  const age = f.accountAgeDays ?? 365;
  if (age < 1) aR += 40; else if (age < 3) aR += 30; else if (age < 7) aR += 20; else if (age < 30) aR += 10;
  const comp = f.profileCompleteness ?? 100;
  if (comp < 30) aR += 30; else if (comp < 50) aR += 20; else if (comp < 70) aR += 10;
  if ((f.bioLength ?? 100) < 10) aR += 15; else if ((f.bioLength ?? 100) < 30) aR += 5;
  if ((f.photosCount ?? 4) < 2) aR += 20; else if ((f.photosCount ?? 4) < 3) aR += 5;
  const dt = f.deviceTrustScore ?? 80;
  if (dt < 20) aR += 25; else if (dt < 50) aR += 10;
  const accountScore = Math.min(100, aR);
  let sR = 0;
  if ((f.socialLinksCount ?? 0) === 0) sR += 40; else if ((f.socialLinksCount ?? 0) < 2) sR += 15;
  if (f.socialUsernameConsistent === false) sR += 30; if (f.socialRedirectSuspicious) sR += 30;
  const socialScore = Math.min(100, sR);
  let cR = 0;
  if (!f.hasVoiceIntro) cR += 15; if (f.aiGeneratedImageDetected) cR += 40; if (f.exifAnomalies) cR += 25; if (f.voiceGenderMismatch) cR += 35; if (f.voiceCloneDetected) cR += 40;
  const contentScore = Math.min(100, cR);
  let comp2 = (identityScore * CW.identity + verificationScore * CW.verification + behaviorScore * CW.behavior + accountScore * CW.account + socialScore * CW.social + contentScore * CW.content) / 100;
  if (f.bannedFaceMatch) comp2 = Math.max(comp2, 90);
  if (f.crossAccountDuplicate && hits > 2) comp2 = Math.max(comp2, 80);
  if (f.askedForMoney && f.videoCallRefused) comp2 = Math.max(comp2, 75);
  if (f.currentTrustScore !== undefined) comp2 += Math.max(0, (50 - f.currentTrustScore) * 0.2);
  if (f.reportCount !== undefined && f.reportCount > 0) { comp2 += Math.min(15, f.reportCount * 3); if (f.reportCount >= 3) sig.push(`${f.reportCount} reports`); }
  if (f.locationConsistent === false) { comp2 += 8; sig.push('Location inconsistencies'); }
  const score = Math.min(100, Math.max(0, Math.round(comp2)));
  const risk = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  if (risk !== 'low') writeAuditLog('identity.catfish_score', { score, risk, signals: sig.slice(0, 5) }).catch(() => { /* empty */ });
  const rec = risk === 'critical' ? 'Very high catfish probability. Review immediately.' : risk === 'high' ? 'Multiple indicators. Request video call.' : risk === 'medium' ? 'Some suspicious signals. Verify identity.' : 'Profile appears authentic.';
  const cl = [f.faceMatchConfidence, f.photoConsistencyConfidence, hits, f.selfieVerified, f.hasPhoneVerified, f.hasVerifiedSocial, f.emailVerified, age, comp, f.photosCount, f.bioLength, f.hasVoiceIntro, f.askedForMoney, f.triedToMoveOffPlatform, f.videoCallRefused, f.currentTrustScore, dt, f.socialLinksCount, f.messageRiskScores, f.locationConsistent];
  return { score, risk, signals: [...new Set(sig)], breakdown: { identityScore, behaviorScore, verificationScore, accountScore, socialScore, contentScore }, recommendation: rec, confidence: Math.round((cl.filter(v => v !== undefined && v !== null).length / cl.length) * 100) };
}

export async function computeEnrichedCatfishScore(uid: string, base: Partial<CatfishInput>, authToken?: string): Promise<CatfishScore> {
  let en: CatfishInput = { faceMatchConfidence: base.faceMatchConfidence ?? 0, photoConsistencyConfidence: base.photoConsistencyConfidence ?? 0, ...base };
  try {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    const r = await fetchSafe(`${SERVER_URL}/catfish-signals`, { method: 'POST', headers: h, body: JSON.stringify({ userId: uid }) });
    if (r.ok) {
      const s = await r.json() as CatfishSignalResponse;
      en = { ...en, reverseImageSearchHits: s.reverseImageSearchHits ?? en.reverseImageSearchHits, crossAccountDuplicate: s.crossAccountDuplicate ?? en.crossAccountDuplicate, currentTrustScore: s.trustScore ?? en.currentTrustScore, reportCount: s.reportCount ?? en.reportCount, bannedFaceMatch: s.bannedFaceMatch ?? en.bannedFaceMatch, deviceTrustScore: s.deviceTrustScore ?? en.deviceTrustScore, locationConsistent: s.locationConsistent ?? en.locationConsistent };
    }
  } catch { /* empty */ }
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const d = snap.data() as UserDocument;
      en.selfieVerified ??= d.selfieVerified ?? false;
      en.hasPhoneVerified ??= d.phoneVerified ?? false;
      en.emailVerified ??= d.emailVerified ?? false;
      en.profileCompleteness ??= d.profileCompleteness;
      en.photosCount ??= d.photos?.length ?? 0;
      en.bioLength ??= d.bio?.length ?? 0;
      en.hasVoiceIntro ??= !!d.voiceIntroUrl;
      en.socialLinksCount ??= [d.instagram, d.spotify, d.tiktok, d.linkedin].filter(Boolean).length;
      if (d.createdAt) {
        const c = typeof d.createdAt === 'string' ? new Date(d.createdAt).getTime() : typeof d.createdAt === 'number' ? d.createdAt : d.createdAt.toMillis?.() ?? 0;
        en.accountAgeDays ??= Math.floor((Date.now() - c) / 86400000);
      }
    }
  } catch { /* empty */ }
  return computeCatfishScore(en);
}

export const faceComparison  = compareFaces;
export const photoConsistency = checkAllPhotosConsistency;
export const perceptualHash  = computeImageHash;
export const catfishScore    = computeCatfishScore;
export const enrichedCatfish = computeEnrichedCatfishScore;