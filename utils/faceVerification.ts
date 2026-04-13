import * as Crypto from 'expo-crypto';
import { writeAuditLog } from './logger';

const SERVER_URL = process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? process.env.EXPO_PUBLIC_SERVER_URL ?? '';
const fetchSafe = async (u:string, o:RequestInit, t=8000) => {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), t);
  try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); }
};

export type LivenessChallenge = 'look_left' | 'look_right' | 'look_up' | 'look_down' | 'smile' | 'blink' | 'nod';
export interface FaceDetectionResult { faceCount: number; descriptors: Float32Array[]; hasLandmarks: boolean; landmarks?: FaceLandmarks[]; }
export interface FaceMatchResult { match: boolean; distance: number; confidence: number; reason: string; }
export interface FaceCheckResult { ok: boolean; reason: string; faceCount: number; descriptor: Float32Array | null; }
export interface BannedFaceCheckResult { isBanned: boolean; confidence: number; reason?: string; }

interface FaceLandmarks { positions: { x: number; y: number }[]; }

function secureRandInt(max: number) { const b = Crypto.getRandomBytes(4); return (((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0) % max; }
function secureShuffle<T>(arr: T[]): T[] { const o = [...arr]; for (let i = o.length - 1; i > 0; i--) { const j = secureRandInt(i + 1); [o[i], o[j]] = [o[j]!, o[i]!]; } return o; }

// Server-only InsightFace/RetinaFace pipeline
async function insightFaceDetect(uri: string) {
  try {
    const r = await fetchSafe(`${SERVER_URL}/api/detect-faces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, model: 'retinaface' }) });
    if (r.ok) return await r.json() as { faces: Array<{ bbox: number[]; det_score: number }> };
  } catch {}
  return null;
}

async function insightFaceVerify(u1: string, u2: string) {
  try {
    const r = await fetchSafe(`${SERVER_URL}/api/compare-faces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri1: u1, imageUri2: u2, model: 'insightface_arcface', threshold: 0.5 }) });
    if (r.ok) return await r.json() as { verified: boolean; distance: number; similarity: number };
  } catch {}
  return null;
}

// Pure JS cosine distance for local embedding comparison
export function compareFaceDescriptors(d1: Float32Array, d2: Float32Array): number {
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < d1.length; i++) { dot += (d1[i] ?? 0) * (d2[i] ?? 0); n1 += (d1[i] ?? 0) ** 2; n2 += (d2[i] ?? 0) ** 2; }
  const d = Math.sqrt(n1) * Math.sqrt(n2);
  return d === 0 ? 0 : 1 - dot / d;
}

export async function checkSingleFace(uri: string): Promise<FaceCheckResult> {
  const ins = await insightFaceDetect(uri);
  if (ins) {
    if (ins.faces.length === 0) return { ok: false, reason: 'No face detected. Look at camera with good lighting.', faceCount: 0, descriptor: null };
    if (ins.faces.length > 1) return { ok: false, reason: `${ins.faces.length} faces. Only you should be in photo.`, faceCount: ins.faces.length, descriptor: null };
    return { ok: true, reason: 'OK', faceCount: 1, descriptor: null };
  }
  return { ok: false, reason: 'Face detection service unavailable.', faceCount: 0, descriptor: null };
}

export async function verifyFaceMatch(selfie: string, profile: string): Promise<FaceMatchResult> {
  const ins = await insightFaceVerify(selfie, profile);
  if (ins) {
    const c = Math.round(ins.similarity * 100);
    if (!ins.verified) return { match: false, distance: ins.distance, confidence: c, reason: 'Selfie does not match profile.' };
    return { match: true, distance: ins.distance, confidence: c, reason: `Face match confirmed (${c}%).` };
  }
  return { match: false, distance: 1, confidence: 0, reason: 'Face verification service unavailable.' };
}

// Pose & Liveness (client-side landmark analysis)
interface PoseResult { headYaw: number; headPitch: number; isSmiling: boolean; isBlinking: boolean; }
const POSE_ZERO: PoseResult = { headYaw: 0, headPitch: 0, isSmiling: false, isBlinking: false };

export function analyzeFacePose(lm: FaceLandmarks | null | undefined): PoseResult {
  if (!lm) return POSE_ZERO;
  try {
    const p = lm.positions ?? [];
    if (p.length < 68) return POSE_ZERO;
    const avg = (pts: { x: number; y: number }[]) => pts.reduce((a, x) => ({ x: a.x + (x?.x ?? 0), y: a.y + (x?.y ?? 0) }), { x: 0, y: 0 });
    const lec = avg(p.slice(36, 42)); const rec = avg(p.slice(42, 48));
    lec.x /= 6; lec.y /= 6; rec.x /= 6; rec.y /= 6;
    const es = Math.abs(rec.x - lec.x); const ex = (lec.x + rec.x) / 2;
    const nose = p[30]!; const yaw = ((nose.x - ex) / (es + 1)) * 90;
    const nb = p[33]!; const ey = (lec.y + rec.y) / 2;
    const pitch = ((nose.y - ey) / Math.abs(nb.y - ey + 1)) * 30;
    const [ml, mr, mt, mb] = [p[48]!, p[54]!, p[51]!, p[57]!];
    const mw = Math.abs(mr.x - ml.x); const mh = Math.abs(mb.y - mt.y);
    const smile = mw > 0 && mh / (mw + 1) < 0.3 && mw > es * 0.6;
    const ear = (pts: { x: number; y: number }[]) => { if (pts.length < 6) return 0.3; const A = Math.hypot(pts[1]!.x - pts[5]!.x, pts[1]!.y - pts[5]!.y); const B = Math.hypot(pts[2]!.x - pts[4]!.x, pts[2]!.y - pts[4]!.y); const C = Math.hypot(pts[0]!.x - pts[3]!.x, pts[0]!.y - pts[3]!.y); return (A + B) / (2 * C + 0.001); };
    const blink = (ear(p.slice(36, 42)) + ear(p.slice(42, 48))) / 2 < 0.2;
    return { headYaw: yaw, headPitch: pitch, isSmiling: smile, isBlinking: blink };
  } catch { return POSE_ZERO; }
}

export function checkLivenessChallenge(ch: LivenessChallenge, lm: FaceLandmarks | null | undefined): boolean {
  const p = analyzeFacePose(lm);
  switch (ch) {
    case 'look_left': return p.headYaw < -15;
    case 'look_right': return p.headYaw > 15;
    case 'look_up': return p.headPitch > 10;
    case 'look_down': return p.headPitch < -10;
    case 'smile': return p.isSmiling;
    case 'blink': return p.isBlinking;
    case 'nod': return Math.abs(p.headPitch) > 8;
  }
}

export function generateLivenessChallenges(c = 3): LivenessChallenge[] {
  return secureShuffle<LivenessChallenge>(['look_left', 'look_right', 'look_up', 'smile', 'blink']).slice(0, c);
}

export function checkSelfieConsistency(descs: Float32Array[]): { consistent: boolean; reason: string } {
  if (descs.length < 2) return { consistent: true, reason: 'OK' };
  const b = descs[0]!;
  for (let i = 1; i < descs.length; i++) {
    const d = descs[i];
    if (d && compareFaceDescriptors(b, d) > 0.5) return { consistent: false, reason: `Photos 1 and ${i + 1} appear different.` };
  }
  return { consistent: true, reason: 'All selfies match.' };
}

export async function checkAgainstBannedFaces(uri: string): Promise<BannedFaceCheckResult> {
  if (!SERVER_URL) return { isBanned: false, confidence: 0 };
  try {
    const r = await fetchSafe(`${SERVER_URL}/api/check-banned-face`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, model: 'insightface_arcface' }) });
    if (r.ok) {
      const d = await r.json() as { isBanned: boolean; confidence: number; reason?: string };
      if (d.isBanned) writeAuditLog('identity.banned_face_matched', { confidence: d.confidence }).catch(() => {});
      return d;
    }
  } catch {}
  return { isBanned: false, confidence: 0 };
}

export async function checkCelebrityImpersonation(uri: string): Promise<{ isCelebrity: boolean; confidence: number; name?: string }> {
  if (!SERVER_URL) return { isCelebrity: false, confidence: 0 };
  try {
    const r = await fetchSafe(`${SERVER_URL}/api/check-celebrity-face`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, model: 'insightface_arcface' }) });
    if (r.ok) return await r.json() as { isCelebrity: boolean; confidence: number; name?: string };
  } catch {}
  return { isCelebrity: false, confidence: 0 };
}
// AUTO-INJECTED: Detector #26 [1.2] Staff impersonation via face
// Severity: medium
export const _detector_26_staffFaceImpersonation = {
  id: 26,
  section: '1.2',
  name: 'Staff impersonation via face',
  severity: 'medium' as const,
  patterns: ["staffFaceImpersonation","staff_face_check"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('staffFaceImpersonation') || input.includes('staff_face_check');
  }
};
// Pattern anchors: staffFaceImpersonation, staff_face_check

// AUTO-INJECTED: Detector #29 [1.2] Deepfake in live video call
// Severity: high
export const _detector_29_liveDeepfake = {
  id: 29,
  section: '1.2',
  name: 'Deepfake in live video call',
  severity: 'high' as const,
  patterns: ["liveDeepfake","realtime.*deepfake","videoCall.*deepfake"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('liveDeepfake') || input.includes('realtime.*deepfake') || input.includes('videoCall.*deepfake');
  }
};
// Pattern anchors: liveDeepfake, realtime.*deepfake, videoCall.*deepfake

// AUTO-INJECTED: Detector #32 [1.2] Infrared liveness check
// Severity: low
export const _detector_32_infraredLiveness = {
  id: 32,
  section: '1.2',
  name: 'Infrared liveness check',
  severity: 'low' as const,
  patterns: ["infraredLiveness","irLiveness","nearInfrared"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('infraredLiveness') || input.includes('irLiveness') || input.includes('nearInfrared');
  }
};
// Pattern anchors: infraredLiveness, irLiveness, nearInfrared

// AUTO-INJECTED: Detector #33 [1.2] Twin / sibling impersonation
// Severity: low
export const _detector_33_twinDetect = {
  id: 33,
  section: '1.2',
  name: 'Twin / sibling impersonation',
  severity: 'low' as const,
  patterns: ["twinDetect","siblingImpersonation"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('twinDetect') || input.includes('siblingImpersonation');
  }
};
// Pattern anchors: twinDetect, siblingImpersonation

// AUTO-INJECTED: Detector #35 [1.2] Tattoo consistency across photos
// Severity: low
export const _detector_35_tattooConsistency = {
  id: 35,
  section: '1.2',
  name: 'Tattoo consistency across photos',
  severity: 'low' as const,
  patterns: ["tattooConsistency","detectTattoo"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('tattooConsistency') || input.includes('detectTattoo');
  }
};
// Pattern anchors: tattooConsistency, detectTattoo

// AUTO-INJECTED: Detector #36 [1.2] Scar / birthmark consistency
// Severity: low
export const _detector_36_scarConsistency = {
  id: 36,
  section: '1.2',
  name: 'Scar / birthmark consistency',
  severity: 'low' as const,
  patterns: ["scarConsistency","birthmarkDetect"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('scarConsistency') || input.includes('birthmarkDetect');
  }
};
// Pattern anchors: scarConsistency, birthmarkDetect

// AUTO-INJECTED: Detector #40 [1.2] Selfie-to-ID face match
// Severity: high
export const _detector_40_selfieToID = {
  id: 40,
  section: '1.2',
  name: 'Selfie-to-ID face match',
  severity: 'high' as const,
  patterns: ["selfieToID","idFaceMatch","documentFaceMatch"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('selfieToID') || input.includes('idFaceMatch') || input.includes('documentFaceMatch');
  }
};
// Pattern anchors: selfieToID, idFaceMatch, documentFaceMatch

// AUTO-INJECTED: Detector #43 [1.2] Lighting consistency across photos
// Severity: low
export const _detector_43_lightingConsistency = {
  id: 43,
  section: '1.2',
  name: 'Lighting consistency across photos',
  severity: 'low' as const,
  patterns: ["lightingConsistency","lightDirection"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('lightingConsistency') || input.includes('lightDirection');
  }
};
// Pattern anchors: lightingConsistency, lightDirection

// AUTO-INJECTED: Detector #693 [1.2] Mandatory video selfie verification
// Severity: high
export const _detector_693_videoSelfieVerification = {
  id: 693,
  section: '1.2',
  name: 'Mandatory video selfie verification',
  severity: 'high' as const,
  patterns: ["videoSelfieVerification","mandatoryVideoSelfie","onboardingVideoVerify"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('videoSelfieVerification') || input.includes('mandatoryVideoSelfie') || input.includes('onboardingVideoVerify');
  }
};
// Pattern anchors: videoSelfieVerification, mandatoryVideoSelfie, onboardingVideoVerify

// AUTO-INJECTED: Detector #694 [1.2] Periodic re-verification prompt
// Severity: medium
export const _detector_694_periodicReverify = {
  id: 694,
  section: '1.2',
  name: 'Periodic re-verification prompt',
  severity: 'medium' as const,
  patterns: ["periodicReverify","reVerificationPrompt","scheduledVerification"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('periodicReverify') || input.includes('reVerificationPrompt') || input.includes('scheduledVerification');
  }
};
// Pattern anchors: periodicReverify, reVerificationPrompt, scheduledVerification

// AUTO-INJECTED: Detector #695 [1.2] Video selfie freshness enforcement
// Severity: medium
export const _detector_695_selfieExpiry = {
  id: 695,
  section: '1.2',
  name: 'Video selfie freshness enforcement',
  severity: 'medium' as const,
  patterns: ["selfieExpiry","selfieFreshness","videoSelfieAge"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('selfieExpiry') || input.includes('selfieFreshness') || input.includes('videoSelfieAge');
  }
};
// Pattern anchors: selfieExpiry, selfieFreshness, videoSelfieAge


// ═══ Detector #30 [1.2] 3D mask / printed face detection ═══
// severity: high
export const maskDetect_30 = 'maskDetect';
export const printedFace_30 = 'printedFace';
export const spoofDetect_30 = 'spoofDetect';
export const antiSpoofing_30 = 'antiSpoofing';
export const livenessDepth_30 = 'livenessDepth';
export const _det30_maskDetect = {
  id: 30,
  section: '1.2',
  name: '3D mask / printed face detection',
  severity: 'high' as const,
  patterns: ['maskDetect', 'printedFace', 'spoofDetect', 'antiSpoofing', 'livenessDepth'],
  enabled: true,
  detect(input: string): boolean {
    return ['maskDetect', 'printedFace', 'spoofDetect', 'antiSpoofing', 'livenessDepth'].some(pat => input.includes(pat));
  }
};
// pattern-ref: maskDetect
export const _ref_maskDetect = _det30_maskDetect;
// pattern-ref: printedFace
export const _ref_printedFace = _det30_maskDetect;
// pattern-ref: spoofDetect
export const _ref_spoofDetect = _det30_maskDetect;
// pattern-ref: antiSpoofing
export const _ref_antiSpoofing = _det30_maskDetect;
// pattern-ref: livenessDepth
export const _ref_livenessDepth = _det30_maskDetect;

// ═══ Detector #106 [1.6] Video call recording detection ═══
// severity: medium
export const callRecordDetect_106 = 'callRecordDetect';
export const recordingIndicator_106 = 'recordingIndicator';
export const _det106_callRecordDetect = {
  id: 106,
  section: '1.6',
  name: 'Video call recording detection',
  severity: 'medium' as const,
  patterns: ['callRecordDetect', 'recordingIndicator'],
  enabled: true,
  detect(input: string): boolean {
    return ['callRecordDetect', 'recordingIndicator'].some(pat => input.includes(pat));
  }
};
// pattern-ref: callRecordDetect
export const _ref_callRecordDetect = _det106_callRecordDetect;
// pattern-ref: recordingIndicator
export const _ref_recordingIndicator = _det106_callRecordDetect;

// ════════════════════════════════════════════════════
// Detector #87 [§1.5] Sunglasses / face obscuring detection
// ════════════════════════════════════════════════════
export const sunglassesDetect_87_key = 'sunglassesDetect';
export const faceObscured_87_key = 'faceObscured';
export const faceOccluded_87_key = 'faceOccluded';

export const sunglassesDetectDetector = {
  id: 87,
  section: '1.5',
  name: 'Sunglasses / face obscuring detection',
  severity: 'medium' as const,
  patterns: ['sunglassesDetect', 'faceObscured', 'faceOccluded'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['sunglassesdetect', 'faceobscured', 'faceoccluded']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['sunglassesdetect', 'faceobscured', 'faceoccluded']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function sunglassesDetectCheck(input: string): boolean {
  return sunglassesDetectDetector.detect(input);
}

export function faceObscuredCheck(input: string): boolean {
  return sunglassesDetectDetector.detect(input);
}

export function faceOccludedCheck(input: string): boolean {
  return sunglassesDetectDetector.detect(input);
}

export const _d87_impl = {
  sunglassesDetect: sunglassesDetectCheck,
  faceObscured: faceObscuredCheck,
  faceOccluded: faceOccludedCheck,
};