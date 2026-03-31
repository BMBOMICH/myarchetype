import { Platform } from 'react-native';

const IS_WEB = Platform.OS === 'web';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';
const FACE_API_CDN = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';

let faceapi: any = null;
let ageModelLoaded = false;
let ageLoadPromise: Promise<boolean> | null = null;

export interface AgeEstimationResult { estimatedAge: number; confidence: number; ageRange: { min: number; max: number }; appearsUnderage: boolean; appearsOver18: boolean; }
export interface AgeGateResult { allowed: boolean; reason: string; estimatedAge: number | null; statedAge: number; requiresManualReview: boolean; }

async function loadAgeModel(): Promise<boolean> {
  if (!IS_WEB) return false;
  if (ageModelLoaded) return true;
  if (ageLoadPromise) return ageLoadPromise;
  ageLoadPromise = (async () => {
    try {
      if ((globalThis as any).faceapi) { faceapi = (globalThis as any).faceapi; }
      else {
        const doc = (globalThis as any).document;
        const existing = doc?.querySelector(`script[src="${FACE_API_CDN}"]`);
        if (existing) {
          await new Promise<void>((res, rej) => {
            if ((globalThis as any).faceapi) { faceapi = (globalThis as any).faceapi; res(); return; }
            existing.addEventListener('load', () => { faceapi = (globalThis as any).faceapi; res(); });
            existing.addEventListener('error', rej);
          });
        } else {
          await new Promise<void>((res, rej) => {
            if (!doc) { rej(new Error('No document')); return; }
            const s = doc.createElement('script');
            s.src = FACE_API_CDN; s.async = true;
            s.onload = () => { faceapi = (globalThis as any).faceapi; faceapi ? res() : rej(new Error('faceapi not found')); };
            s.onerror = () => rej(new Error('CDN load failed'));
            doc.head.appendChild(s);
          });
        }
      }
      const toLoad: Promise<void>[] = [];
      if (!faceapi.nets.ageGenderNet?.isLoaded) toLoad.push(faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL));
      if (!faceapi.nets.tinyFaceDetector?.isLoaded) toLoad.push(faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL));
      if (toLoad.length) await Promise.all(toLoad);
      ageModelLoaded = true;
      return true;
    } catch { ageLoadPromise = null; return false; }
  })();
  return ageLoadPromise;
}

function createImg(uri: string): Promise<any> {
  return new Promise((res, rej) => {
    const doc = (globalThis as any).document;
    const img = doc?.createElement?.('img');
    if (!img) { rej(new Error('No img')); return; }
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = uri;
  });
}

// #28: Age estimation
export async function estimateAgeFromPhoto(photoUrl: string): Promise<AgeEstimationResult | null> {
  if (!IS_WEB) return null;
  try {
    if (!await loadAgeModel() || !faceapi) return null;
    const img = await createImg(photoUrl);
    const det = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withAgeAndGender();
    if (!det) return null;
    const estimatedAge = Math.round(det.age);
    const confidence = Math.round(((det.detection?.score ?? 0.5) + (det.genderProbability ?? 0)) / 2 * 100);
    const margin = confidence > 70 ? 4 : 6;
    return { estimatedAge, confidence, ageRange: { min: Math.max(10, estimatedAge - margin), max: estimatedAge + margin }, appearsUnderage: estimatedAge < 18, appearsOver18: estimatedAge >= 18 };
  } catch { return null; }
}

export function validateAge(stated: number, estimated: number, tolerance = 5): { valid: boolean; difference: number } {
  const d = Math.abs(stated - estimated);
  return { valid: d <= tolerance, difference: d };
}

export async function estimateAgeFromMultiplePhotos(urls: string[]): Promise<AgeEstimationResult | null> {
  const results = (await Promise.all(urls.map(estimateAgeFromPhoto))).filter(Boolean) as AgeEstimationResult[];
  if (!results.length) return null;
  const avg = Math.round(results.reduce((s, r) => s + r.estimatedAge, 0) / results.length);
  const conf = Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length);
  const margin = conf > 70 ? 4 : 6;
  return { estimatedAge: avg, confidence: conf, ageRange: { min: Math.max(10, avg - margin), max: avg + margin }, appearsUnderage: avg < 18, appearsOver18: avg >= 18 };
}

// #138: Age gate
export async function enforceAgeGate(statedDOB: string, selfieUri?: string): Promise<AgeGateResult> {
  const dob = new Date(statedDOB);
  const today = new Date();
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