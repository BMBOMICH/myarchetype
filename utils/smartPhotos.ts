import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { checkDuplicatePhotoSameUser, computeImageHash } from './faceComparison';
import { scorePhotoQuality } from './faceDetection';

export interface SmartPhotoResult { recommended: string[]; scores: Record<string, number>; duplicates: string[]; lowQuality: string[]; suggestions: string[]; }
export interface PhotoValidationResult { valid: boolean; isDuplicate: boolean; qualityScore: number; qualityIssues: string[]; reason?: string; }

// #14: Duplicate check
export async function checkNewPhotoDuplicate(uri: string, existing: string[]): Promise<{ isDuplicate: boolean; similarity: number; duplicateIndex?: number }> {
  if (!existing.length) return { isDuplicate: false, similarity: 0 };
  return checkDuplicatePhotoSameUser(uri, existing);
}

// #25: Quality ranking
export async function rankPhotosByQuality(photos: string[]): Promise<Array<{ uri: string; score: number; issues: string[] }>> {
  const results: Array<{ uri: string; score: number; issues: string[] }> = [];
  for (const uri of photos) {
    try {
      let width = 0, height = 0, bytes = 0;
      const doc = (globalThis as any).document;
      if (doc) {
        await new Promise<void>(res => {
          const img = doc.createElement('img');
          img.onload = () => { width = img.naturalWidth; height = img.naturalHeight; res(); };
          img.onerror = () => res();
          img.src = uri;
        });
        try { const r = await fetch(uri, { method: 'HEAD' }); bytes = parseInt(r.headers.get('content-length') ?? '0'); } catch {}
      }
      const q = scorePhotoQuality({ width, height, bytes });
      results.push({ uri, score: q.score, issues: q.issues });
    } catch { results.push({ uri, score: 50, issues: [] }); }
  }
  return results.sort((a, b) => b.score - a.score);
}

// #14 + #25 + #33: Full validation
export async function validateNewPhoto(newUri: string, existing: string[], cloudinaryData?: { width?: number; height?: number; bytes?: number; format?: string; exifTimestamp?: string }): Promise<PhotoValidationResult> {
  const dup = await checkNewPhotoDuplicate(newUri, existing);
  if (dup.isDuplicate) return { valid: false, isDuplicate: true, qualityScore: 0, qualityIssues: [], reason: 'This photo is too similar to one you already have.' };
  const q = scorePhotoQuality({ width: cloudinaryData?.width, height: cloudinaryData?.height, bytes: cloudinaryData?.bytes, format: cloudinaryData?.format });
  // #33: Photo freshness
  if (cloudinaryData?.exifTimestamp) {
    const d = new Date(cloudinaryData.exifTimestamp.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
    if (!isNaN(d.getTime())) {
      const months = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30));
      if (months > 24) q.issues.push(`Photo is ${months} months old. Consider using more recent photos.`);
    }
  }
  return { valid: q.passed, isDuplicate: false, qualityScore: q.score, qualityIssues: q.issues, reason: q.issues[0] };
}

export async function getSmartPhotoSuggestions(userId?: string): Promise<SmartPhotoResult> {
  const user = auth.currentUser;
  const tid = userId ?? user?.uid;
  if (!tid) return { recommended: [], scores: {}, duplicates: [], lowQuality: [], suggestions: ['Please log in'] };
  try {
    const snap = await getDoc(doc(db, 'users', tid));
    if (!snap.exists()) return { recommended: [], scores: {}, duplicates: [], lowQuality: [], suggestions: ['Profile not found'] };
    const photos: string[] = snap.data().photos ?? [];
    if (!photos.length) return { recommended: [], scores: {}, duplicates: [], lowQuality: [], suggestions: ['Add photos to get matches!'] };
    const ranked = await rankPhotosByQuality(photos);
    const scores: Record<string, number> = {};
    const lowQuality: string[] = [];
    for (const r of ranked) { scores[r.uri] = r.score; if (r.score < 40) lowQuality.push(r.uri); }
    // #14: Find duplicates
    const duplicates: string[] = [];
    const hashes: string[] = [];
    for (const photo of photos) {
      const hash = await computeImageHash(photo);
      if (!hash) continue;
      const isDup = hashes.some(h => { let d = 0; for (let i = 0; i < h.length; i++) if (h[i] !== hash[i]) d++; return Math.round(((64-d)/64)*100) >= 90; });
      if (isDup) duplicates.push(photo); else hashes.push(hash);
    }
    const recommended = ranked.filter(r => !duplicates.includes(r.uri)).slice(0, 3).map(r => r.uri);
    const suggestions: string[] = [];
    if (photos.length < 3) suggestions.push('Add more photos — profiles with 3+ photos get 3x more matches!');
    if (lowQuality.length) suggestions.push('Some photos have low quality — try brighter, clearer shots.');
    if (duplicates.length) suggestions.push(`${duplicates.length} duplicate photo(s) detected — add variety!`);
    if (photos.length >= 3 && !suggestions.length) suggestions.push('Your photos look great! 📸');
    return { recommended, scores, duplicates, lowQuality, suggestions };
  } catch { return { recommended: [], scores: {}, duplicates: [], lowQuality: [], suggestions: ['Could not analyze photos'] }; }
}

export async function optimizePhotoOrder(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return false;
    const photos: string[] = snap.data().photos ?? [];
    if (photos.length <= 1) return true;
    const ranked = await rankPhotosByQuality(photos);
    await updateDoc(doc(db, 'users', user.uid), { photos: ranked.map(r => r.uri) });
    return true;
  } catch { return false; }
}