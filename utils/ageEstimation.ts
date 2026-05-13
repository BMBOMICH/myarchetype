
import { Platform } from 'react-native';

const IS_WEB = Platform.OS === 'web';
const SERVER_URL = process.env['EXPO_PUBLIC_FUNCTIONS_URL'] ?? process.env['EXPO_PUBLIC_SERVER_URL'] ?? '';

const FACE_API_CDN = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const FACE_API_WEIGHTS = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';

interface FaceApiNet { isLoaded: boolean; loadFromUri(url: string): Promise<void>; }
interface FaceApiInstance {
  nets: { ageGenderNet: FaceApiNet; tinyFaceDetector: FaceApiNet };
  TinyFaceDetectorOptions: new (o: { inputSize: number; scoreThreshold: number }) => unknown;
  detectSingleFace(img: HTMLImageElement, opts: unknown): { withAgeAndGender(): Promise<{ age: number; gender: string; genderProbability: number; detection: { score: number } } | null> };
}
interface GlobalWithFaceApi { faceapi?: FaceApiInstance; document?: Document; }

let faceapi: FaceApiInstance | null = null;
let ageModelLoaded = false;
let ageLoadPromise: Promise<boolean> | null = null;

export interface AgeEstimationResult {
  estimatedAge: number; confidence: number;
  ageRange: { min: number; max: number };
  appearsUnderage: boolean; appearsOver18: boolean;
}
export interface AgeGateResult {
  allowed: boolean; reason: string;
  estimatedAge: number | null; statedAge: number; requiresManualReview: boolean;
}

async function estimateAgeInsightFace(photoUrl: string): Promise<AgeEstimationResult | null> {
  if (!SERVER_URL) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/estimate-age`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUri: photoUrl, model: 'insightface_age' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { age: number; age_range: [number, number]; confidence: number };
    const estimatedAge = data.age;
    const margin = data.confidence > 0.7 ? 4 : 6;
    return {
      estimatedAge, confidence: Math.round(data.confidence * 100),
      ageRange: { min: Math.max(10, estimatedAge - margin), max: estimatedAge + margin },
      appearsUnderage: estimatedAge < 18, appearsOver18: estimatedAge >= 18,
    };
  } catch { return null; }
}

async function loadFaceApiLegacy(): Promise<boolean> {
  if (!IS_WEB) return false;
  if (ageModelLoaded) return true;
  if (ageLoadPromise) return ageLoadPromise;
  ageLoadPromise = (async () => {
    try {
      const g = globalThis as GlobalWithFaceApi;
      if (g.faceapi) { faceapi = g.faceapi; }
      else {
        await new Promise<void>((res, rej) => {
          const doc = g.document;
          const ex = doc?.querySelector(`script[src="${FACE_API_CDN}"]`);
  // FIXME: add removeEventListener cleanup for the listener below
          if (ex) { ex.addEventListener('load', () => { faceapi = (globalThis as GlobalWithFaceApi).faceapi!; res(); }); ex.addEventListener('error', () => rej(new Error('Script error'))); return; }
          if (!doc) { rej(new Error('No document')); return; }
          const s = doc.createElement('script'); s.src = FACE_API_CDN; s.async = true;
          s.onload = () => { const l = (globalThis as GlobalWithFaceApi).faceapi; if (l) { faceapi = l; res(); } else rej(new Error('faceapi missing')); };
          s.onerror = () => rej(new Error('CDN failed'));
          doc.head.appendChild(s);
        });
      }
      if (!faceapi) return false;
      const toLoad: Promise<void>[] = [];
      if (!faceapi.nets.ageGenderNet.isLoaded)     toLoad.push(faceapi.nets.ageGenderNet.loadFromUri(FACE_API_WEIGHTS));
      if (!faceapi.nets.tinyFaceDetector.isLoaded) toLoad.push(faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_WEIGHTS));
      if (toLoad.length) await Promise.all(toLoad).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; });
      ageModelLoaded = true; return true;
    } catch { ageLoadPromise = null; return false; }
  })();
  return ageLoadPromise;
}

async function estimateAgeFaceApi(photoUrl: string): Promise<AgeEstimationResult | null> {
  if (!IS_WEB || !await loadFaceApiLegacy() || !faceapi) return null;
  try {
    const doc = (globalThis as GlobalWithFaceApi).document;
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = doc?.createElement('img') as HTMLImageElement | undefined;
      if (!el) { rej(new Error('No img')); return; }
      el.crossOrigin = 'anonymous'; el.onload = () => res(el); el.onerror = () => rej(new Error('Load failed')); el.src = photoUrl;
    });
    const det = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withAgeAndGender();
    if (!det) return null;
    const estimatedAge = Math.round(det.age);
    const confidence = Math.round(((det.detection.score) + (det.genderProbability)) / 2 * 100);
    const margin = confidence > 70 ? 4 : 6;
    return { estimatedAge, confidence, ageRange: { min: Math.max(10, estimatedAge - margin), max: estimatedAge + margin }, appearsUnderage: estimatedAge < 18, appearsOver18: estimatedAge >= 18 };
  } catch { return null; }
}

export async function estimateAgeFromPhoto(photoUrl: string): Promise<AgeEstimationResult | null> {
  const serverResult = await estimateAgeInsightFace(photoUrl);
  if (serverResult) return serverResult;
  return estimateAgeFaceApi(photoUrl);
}

export function validateAge(stated: number, estimated: number, tolerance = 5): { valid: boolean; difference: number } {
  const d = Math.abs(stated - estimated);
  return { valid: d <= tolerance, difference: d };
}

export async function estimateAgeFromMultiplePhotos(urls: string[]): Promise<AgeEstimationResult | null> {
  const results = (await Promise.all(urls.map(estimateAgeFromPhoto).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; })).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; })).filter((r): r is AgeEstimationResult => r !== null);
  if (!results.length) return null;
  const avg  = Math.round(results.reduce((s, r) => s + r.estimatedAge, 0) / results.length);
  const conf = Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length);
  const margin = conf > 70 ? 4 : 6;
  return { estimatedAge: avg, confidence: conf, ageRange: { min: Math.max(10, avg - margin), max: avg + margin }, appearsUnderage: avg < 18, appearsOver18: avg >= 18 };
}

export async function enforceAgeGate(statedDOB: string, selfieUri?: string): Promise<AgeGateResult> {
  const dob = new Date(statedDOB); const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  if (age < 18) return { allowed: false, reason: 'You must be 18 or older.', estimatedAge: null, statedAge: age, requiresManualReview: false };
  if (!selfieUri) return { allowed: true, reason: 'Age verified by date of birth.', estimatedAge: null, statedAge: age, requiresManualReview: false };
  const est = await estimateAgeFromPhoto(selfieUri);
  if (!est) return { allowed: true, reason: 'Age verified by date of birth.', estimatedAge: null, statedAge: age, requiresManualReview: false };
  if (est.estimatedAge < 16 && est.confidence > 70) return { allowed: false, reason: 'Age verification failed. Photo inconsistent with stated age.', estimatedAge: est.estimatedAge, statedAge: age, requiresManualReview: true };
  const { difference } = validateAge(age, est.estimatedAge, 8);
  if (difference > 8 && est.confidence > 60) return { allowed: true, reason: 'Age accepted — flagged for review.', estimatedAge: est.estimatedAge, statedAge: age, requiresManualReview: true };
  return { allowed: true, reason: 'Age verified.', estimatedAge: est.estimatedAge, statedAge: age, requiresManualReview: false };
}
