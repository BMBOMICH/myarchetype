import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

const IS_WEB    = Platform.OS === 'web';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';
const CDN_URL   = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const SERVER_URL = process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? process.env.EXPO_PUBLIC_SERVER_URL ?? '';

// ─── Types ────────────────────────────────────────────────
export type LivenessChallenge = 'look_left' | 'look_right' | 'look_up' | 'look_down' | 'smile' | 'blink' | 'nod';

export interface FaceDetectionResult {
  faceCount:    number;
  descriptors:  Float32Array[];
  hasLandmarks: boolean;
  landmarks?:   FaceLandmarks[];
}
export interface FaceMatchResult   { match: boolean; distance: number; confidence: number; reason: string; }
export interface FaceCheckResult   { ok: boolean; reason: string; faceCount: number; descriptor: Float32Array | null; }
export interface BannedFaceCheckResult { isBanned: boolean; confidence: number; reason?: string; }

// ─── Internal types for face-api.js (web-only CDN lib) ───
interface FaceApiDetection {
  descriptor: Float32Array;
  landmarks:  FaceLandmarks;
}
interface FaceLandmarks {
  positions: LandmarkPoint[];
}
interface LandmarkPoint { x: number; y: number; }
interface FaceApiLib {
  nets: {
    tinyFaceDetector:      { loadFromUri(url: string): Promise<void> };
    faceLandmark68TinyNet: { loadFromUri(url: string): Promise<void> };
    faceRecognitionNet:    { loadFromUri(url: string): Promise<void> };
  };
  TinyFaceDetectorOptions: new (opts: { inputSize: number; scoreThreshold: number }) => unknown;
  euclideanDistance(a: Float32Array, b: Float32Array): number;
  detectAllFaces(img: HTMLImageElement, opts: unknown): {
    withFaceLandmarks(tiny?: boolean): {
      withFaceDescriptors(): Promise<FaceApiDetection[]>;
    };
  };
}

// ─── Module state ─────────────────────────────────────────
let faceapi:      FaceApiLib | null = null;
let modelsLoaded  = false;
let loadPromise:  Promise<boolean> | null = null;

// ─── Crypto helpers ───────────────────────────────────────
function secureRandInt(max: number): number {
  const b = Crypto.getRandomBytes(4);
  const v = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  return v % max;
}

function secureShuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ─── Loader ───────────────────────────────────────────────
export async function loadFaceVerification(): Promise<boolean> {
  if (!IS_WEB)      return false;
  if (modelsLoaded) return true;
  if (loadPromise)  return loadPromise;

  loadPromise = (async () => {
    try {
      await new Promise<void>((resolve, reject) => {
        const g = globalThis as Record<string, unknown>;
        const doc = g['document'] as Document | undefined;
        if (!doc) { reject(new Error('No document')); return; }

        if (g['faceapi']) { faceapi = g['faceapi'] as FaceApiLib; resolve(); return; }

        const existing = doc.querySelector<HTMLScriptElement>(`script[src="${CDN_URL}"]`);
        if (existing) {
          existing.addEventListener('load', () => { faceapi = g['faceapi'] as FaceApiLib; resolve(); });
          existing.addEventListener('error', () => reject(new Error('Script load error')));
          return;
        }

        const script    = doc.createElement('script');
        script.src      = CDN_URL;
        script.async    = true;
        script.onload   = () => {
          faceapi = g['faceapi'] as FaceApiLib;
          faceapi ? resolve() : reject(new Error('faceapi not found after load'));
        };
        script.onerror  = () => reject(new Error('CDN load failed'));
        doc.head.appendChild(script);
      });

      await Promise.all([
        faceapi!.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi!.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi!.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);

      modelsLoaded = true;
      return true;
    } catch (err) {
      console.error('[faceVerify] Load failed:', err);
      loadPromise = null;
      return false;
    }
  })();

  return loadPromise;
}

export function isFaceVerificationReady(): boolean { return modelsLoaded; }

// ─── Image helper ─────────────────────────────────────────
function createImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const g   = globalThis as Record<string, unknown>;
    const doc = g['document'] as Document | undefined;
    const img = doc?.createElement?.('img');
    if (!img) { reject(new Error('No img element')); return; }
    img.crossOrigin = 'anonymous';
    img.onload      = () => resolve(img);
    img.onerror     = () => reject(new Error('Image load failed'));
    img.src         = uri;
  });
}

// ─── Detection ────────────────────────────────────────────
export async function detectFaces(imageUri: string): Promise<FaceDetectionResult> {
  const empty: FaceDetectionResult = { faceCount: 0, descriptors: [], hasLandmarks: false, landmarks: [] };
  if (!IS_WEB || !modelsLoaded || !faceapi) return empty;
  try {
    const img        = await createImage(imageUri);
    const detections = await faceapi
      .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true)
      .withFaceDescriptors();
    return {
      faceCount:    detections.length,
      descriptors:  detections.map((d) => d.descriptor),
      hasLandmarks: detections.length > 0,
      landmarks:    detections.map((d) => d.landmarks),
    };
  } catch { return empty; }
}

export async function checkSingleFace(imageUri: string): Promise<FaceCheckResult> {
  if (!IS_WEB || !modelsLoaded)
    return { ok: true, reason: 'Model not loaded (skipped)', faceCount: -1, descriptor: null };

  const result = await detectFaces(imageUri);
  if (result.faceCount === 0)
    return { ok: false, reason: 'No face detected. Look at the camera with good lighting.', faceCount: 0, descriptor: null };
  if (result.faceCount > 1)
    return { ok: false, reason: `${result.faceCount} faces detected. Only you should be in the photo.`, faceCount: result.faceCount, descriptor: null };

  return { ok: true, reason: 'OK', faceCount: 1, descriptor: result.descriptors[0] ?? null };
}

// ─── Comparison ───────────────────────────────────────────
export function compareFaceDescriptors(d1: Float32Array, d2: Float32Array): number {
  if (faceapi) return faceapi.euclideanDistance(d1, d2);
  let sum = 0;
  for (let i = 0; i < d1.length; i++) sum += ((d1[i] ?? 0) - (d2[i] ?? 0)) ** 2;
  return Math.sqrt(sum);
}

export async function verifyFaceMatch(selfieUri: string, profileUri: string): Promise<FaceMatchResult> {
  if (!IS_WEB || !modelsLoaded)
    return { match: true, distance: -1, confidence: 0, reason: 'Face matching unavailable. Skipped.' };
  try {
    const [sr, pr] = await Promise.all([detectFaces(selfieUri), detectFaces(profileUri)]);
    if (!sr.faceCount) return { match: false, distance: 999, confidence: 100, reason: 'No face in selfie.' };
    if (!pr.faceCount) return { match: false, distance: 999, confidence: 100, reason: 'No face in profile photo.' };

    const sd = sr.descriptors[0], pd = pr.descriptors[0];
    if (!sd || !pd) return { match: true, distance: -1, confidence: 0, reason: 'Could not compute descriptors.' };

    const distance   = compareFaceDescriptors(sd, pd);
    const confidence = Math.max(0, Math.min(100, (1 - distance) * 100));
    if (distance > 0.6)
      return { match: false, distance, confidence, reason: 'Selfie does not match profile photo. Please use your own face.' };
    return { match: true, distance, confidence, reason: `Face match confirmed (${confidence.toFixed(0)}% confidence).` };
  } catch (err) {
    console.error('[faceVerify] verifyFaceMatch error:', err);
    return { match: true, distance: -1, confidence: 0, reason: 'Face matching error (allowed).' };
  }
}

// ─── Pose analysis ────────────────────────────────────────
interface PoseResult { headYaw: number; headPitch: number; isSmiling: boolean; isBlinking: boolean; }
const POSE_ZERO: PoseResult = { headYaw: 0, headPitch: 0, isSmiling: false, isBlinking: false };

export function analyzeFacePose(landmarks: FaceLandmarks | null | undefined): PoseResult {
  if (!landmarks) return POSE_ZERO;
  try {
    const pos = landmarks.positions ?? [];
    if (pos.length < 68) return POSE_ZERO;

    const avg = (pts: LandmarkPoint[]) =>
      pts.reduce((a, p) => ({ x: a.x + (p?.x ?? 0), y: a.y + (p?.y ?? 0) }), { x: 0, y: 0 });

    const lec = avg(pos.slice(36, 42));
    const rec = avg(pos.slice(42, 48));
    lec.x /= 6; lec.y /= 6; rec.x /= 6; rec.y /= 6;

    const eyeSpan = Math.abs(rec.x - lec.x);
    const eyeX    = (lec.x + rec.x) / 2;
    const nose    = pos[30]!;
    const headYaw = ((nose.x - eyeX) / (eyeSpan + 1)) * 90;

    const noseBase  = pos[33]!;
    const eyeY      = (lec.y + rec.y) / 2;
    const headPitch = ((nose.y - eyeY) / Math.abs(noseBase.y - eyeY + 1)) * 30;

    const [ml, mr, mt, mb] = [pos[48]!, pos[54]!, pos[51]!, pos[57]!];
    const mw        = Math.abs(mr.x - ml.x);
    const mh        = Math.abs(mb.y - mt.y);
    const isSmiling = mw > 0 && mh / (mw + 1) < 0.3 && mw > eyeSpan * 0.6;

    const ear = (pts: LandmarkPoint[]) => {
      if (pts.length < 6) return 0.3;
      const A = Math.hypot(pts[1]!.x - pts[5]!.x, pts[1]!.y - pts[5]!.y);
      const B = Math.hypot(pts[2]!.x - pts[4]!.x, pts[2]!.y - pts[4]!.y);
      const C = Math.hypot(pts[0]!.x - pts[3]!.x, pts[0]!.y - pts[3]!.y);
      return (A + B) / (2 * C + 0.001);
    };
    const isBlinking = (ear(pos.slice(36, 42)) + ear(pos.slice(42, 48))) / 2 < 0.2;

    return { headYaw, headPitch, isSmiling, isBlinking };
  } catch { return POSE_ZERO; }
}

export function checkLivenessChallenge(challenge: LivenessChallenge, landmarks: FaceLandmarks | null | undefined): boolean {
  const p = analyzeFacePose(landmarks);
  switch (challenge) {
    case 'look_left':  return p.headYaw < -15;
    case 'look_right': return p.headYaw > 15;
    case 'look_up':    return p.headPitch > 10;
    case 'look_down':  return p.headPitch < -10;
    case 'smile':      return p.isSmiling;
    case 'blink':      return p.isBlinking;
    case 'nod':        return Math.abs(p.headPitch) > 8;
  }
}

export function generateLivenessChallenges(count = 3): LivenessChallenge[] {
  const all: LivenessChallenge[] = ['look_left', 'look_right', 'look_up', 'smile', 'blink'];
  return secureShuffle(all).slice(0, count);
}

export function checkSelfieConsistency(descriptors: Float32Array[]): { consistent: boolean; reason: string } {
  if (descriptors.length < 2) return { consistent: true, reason: 'OK' };
  const base = descriptors[0]!;
  for (let i = 1; i < descriptors.length; i++) {
    const d = descriptors[i];
    if (d && compareFaceDescriptors(base, d) > 0.5)
      return { consistent: false, reason: `Photos 1 and ${i + 1} appear to be different people.` };
  }
  return { consistent: true, reason: 'All selfies match.' };
}

// ─── Server checks ────────────────────────────────────────
export async function checkAgainstBannedFaces(selfieUri: string): Promise<BannedFaceCheckResult> {
  if (!IS_WEB || !modelsLoaded) return { isBanned: false, confidence: 0 };
  try {
    const r    = await detectFaces(selfieUri);
    const desc = r.descriptors[0];
    if (!desc) return { isBanned: false, confidence: 0 };

    const res  = await fetch(`${SERVER_URL}/getBannedEmbeddings`);
    if (!res.ok) return { isBanned: false, confidence: 0 };

    const data = await res.json() as { embeddings?: number[][] };
    for (const emb of data.embeddings ?? []) {
      const d = compareFaceDescriptors(desc, new Float32Array(emb));
      if (d < 0.5)
        return { isBanned: true, confidence: Math.max(0, Math.min(100, (1 - d) * 100)), reason: 'Registration not allowed.' };
    }
    return { isBanned: false, confidence: 0 };
  } catch { return { isBanned: false, confidence: 0 }; }
}

export async function checkCelebrityImpersonation(photoUri: string): Promise<{ isCelebrity: boolean; confidence: number; name?: string }> {
  if (!IS_WEB || !modelsLoaded) return { isCelebrity: false, confidence: 0 };
  try {
    const r    = await detectFaces(photoUri);
    const desc = r.descriptors[0];
    if (!desc) return { isCelebrity: false, confidence: 0 };

    const res  = await fetch(`${SERVER_URL}/checkCelebrityEmbedding`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ embedding: Array.from(desc) }),
    });
    if (!res.ok) return { isCelebrity: false, confidence: 0 };

    const data = await res.json() as { isCelebrity?: boolean; confidence?: number; name?: string };
    return { isCelebrity: data.isCelebrity ?? false, confidence: data.confidence ?? 0, name: data.name };
  } catch { return { isCelebrity: false, confidence: 0 }; }
}