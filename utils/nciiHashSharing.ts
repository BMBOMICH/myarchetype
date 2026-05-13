import { createHash } from 'crypto';

interface NciiHashResult { pdqHash: string; sha256: string; shared: boolean; sharedTo: string[]; timestamp: number; }

export async function generateAndShareNciiHash(imageBuffer: Buffer, metadata: { reportedBy?: string; detectionMethod: 'ai_generated' | 'deepfake' | 'user_report'; confidence: number }): Promise<NciiHashResult> {
  const pdqHash = await computePdqHash(imageBuffer);
  const sha256 = createHash('sha256').update(imageBuffer).digest('hex');
  const sharedTo: string[] = [];
  if (await shareWithStopNcii(pdqHash, sha256, metadata)) sharedTo.push('StopNCII.org');
  if (await shareWithGifct(pdqHash, sha256, metadata)) sharedTo.push('GIFCT');
  await addToLocalBlocklist(pdqHash, sha256);
  return { pdqHash, sha256, shared: sharedTo.length > 0, sharedTo, timestamp: Date.now() };
}
export const nciiHashExchange = generateAndShareNciiHash; export const aiNciiHashSharing = generateAndShareNciiHash;

async function computePdqHash(imageBuffer: Buffer): Promise<string> {
  try {
    const res = await fetch(`${process.env['SAFETY_API_URL']}/hash/pdq`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: imageBuffer });
    if (!res.ok) throw new Error('PDQ failed');
    return ((await res.json()) as { hash: string }).hash;
  } catch { return `dhash_${createHash('md5').update(imageBuffer).digest('hex')}`; }
}

async function shareWithStopNcii(pdqHash: string, sha256: string, metadata: { detectionMethod: string; confidence: number }): Promise<boolean> {
  const apiKey = process.env['STOPNCII_API_KEY'];
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.stopncii.org/v1/hashes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ hashes: [{ type: 'PDQ', value: pdqHash }, { type: 'SHA256', value: sha256 }], source: 'myarchetype', category: metadata.detectionMethod === 'ai_generated' ? 'AI_GENERATED_INTIMATE' : 'NON_CONSENSUAL_INTIMATE', confidence: metadata.confidence, timestamp: new Date().toISOString() }) });
    return res.ok;
  } catch { return false; }
}

async function shareWithGifct(pdqHash: string, sha256: string, _metadata: { detectionMethod: string; confidence: number }): Promise<boolean> {
  const apiKey = process.env['GIFCT_API_KEY'];
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.gifct.org/v1/signals', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ signal_type: 'hash', hash_type: 'PDQ', hash_value: pdqHash, content_type: 'intimate_image', source_platform: 'myarchetype' }) });
    return res.ok;
  } catch { return false; }
}

async function addToLocalBlocklist(pdqHash: string, sha256: string): Promise<void> {
  const { getFirestore, doc, setDoc } = await import('firebase/firestore');
  await setDoc(doc(getFirestore(), '_safety_ncii_blocklist', sha256), { pdqHash, sha256, blockedAt: new Date(), source: 'internal_detection' });
}

export async function checkNciiBlocklist(imageBuffer: Buffer): Promise<{ blocked: boolean; matchType: 'exact' | 'perceptual' | 'none' }> {
  const sha256 = createHash('sha256').update(imageBuffer).digest('hex');
  const { getFirestore, doc, getDoc, collection, getDocs } = await import('firebase/firestore');
  const db = getFirestore();
  if ((await getDoc(doc(db, '_safety_ncii_blocklist', sha256))).exists()) return { blocked: true, matchType: 'exact' };
  const pdqHash = await computePdqHash(imageBuffer);
  const blocklist = await getDocs(collection(db, '_safety_ncii_blocklist'));
  for (const b of blocklist.docs) { if (hammingDistance(pdqHash, b.data().pdqHash ?? '') < 32) return { blocked: true, matchType: 'perceptual' }; }
  return { blocked: false, matchType: 'none' };
}
export const nciiBlocklistCheck = checkNciiBlocklist;

function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) { let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}
