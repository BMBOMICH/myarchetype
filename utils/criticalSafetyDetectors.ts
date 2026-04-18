import { createHash } from 'crypto';
import { addDoc, collection, doc, getDoc, getDocs, getFirestore, setDoc } from 'firebase/firestore';

export interface PredatorAttractionRiskResult {
  childPhotoRiskScore: number;
  riskFactors: string[];
  recommendation: string;
  monitoringEnabled: boolean;
}

export async function predatorAttractionRisk(
  userId: string,
  profile: {
    bio: string;
    hasKids: boolean;
    photos: Array<{ url: string; hasChildFace: boolean }>;
  }
): Promise<PredatorAttractionRiskResult> {
  if (!profile.hasKids) {
    return { childPhotoRiskScore: 0, riskFactors: [], recommendation: 'none', monitoringEnabled: false };
  }

  const rf: string[] = [];
  let s = 0;

  const cp = profile.photos.filter(p => p.hasChildFace);
  if (cp.length > 0) { s += 40; rf.push(`${cp.length} photo(s) contain detected child faces`); }
  if (/\b(my\s+)?(son|daughter|kid|child)\s+(is\s+)?\d{1,2}\b/i.test(profile.bio)) { s += 20; rf.push('Children\'s ages shared in bio'); }
  if (/\b(my\s+)?(son|daughter|kid|child)\s+\w+\s+(is|loves|goes|attends)\b/i.test(profile.bio)) { s += 25; rf.push('Children\'s names shared in bio'); }
  if (/\b(custody|visitation|every other weekend|co-?parent|50\/50)\b/i.test(profile.bio)) { s += 15; rf.push('Custody schedule details exposed'); }
  if (/\b(school|daycare|preschool|kindergarten|elementary|practice|lesson)\b/i.test(profile.bio)) { s += 15; rf.push('Children\'s school or activity locations mentioned'); }

  s = Math.min(100, s);
  const me = s >= 40;

  if (me) {
    try {
      const db = getFirestore();
      await addDoc(collection(db, '_safety_predator_watch'), {
        userId, childPhotoRiskScore: s, riskFactors: rf, createdAt: new Date(), active: true,
      });
    } catch { /* non-critical — continue */ }
  }

  const recommendation =
    s >= 60 ? 'Strongly recommend removing children\'s photos and personal details from your dating profile' :
    s >= 30 ? 'Consider reducing children-related details visible to matches' : 'none';

  return { childPhotoRiskScore: s, riskFactors: rf, recommendation, monitoringEnabled: me };
}

export interface AiNciiHashSharingResult {
  pdqHash: string;
  sha256Hash: string;
  sharedTo: string[];
  locallyBlocked: boolean;
  stopNciiIntegration: boolean;
}

export async function aiNciiHashSharing(
  imageBuffer: Buffer,
  detectionContext: { method: 'ai_generated' | 'deepfake' | 'user_report'; confidence: number; reportedBy?: string }
): Promise<AiNciiHashSharingResult> {
  const sha = createHash('sha256').update(imageBuffer).digest('hex');
  const pdq = await computePdq(imageBuffer);
  const shared: string[] = [];

  if (await submitStopNcii(pdq, sha, detectionContext)) shared.push('StopNCII.org');
  if (await submitGifct(pdq, detectionContext)) shared.push('GIFCT');

  try {
    const db = getFirestore();
    await setDoc(doc(db, '_safety_ncii_hashes', sha), {
      pdqHash: pdq, sha256: sha, detectionMethod: detectionContext.method,
      confidence: detectionContext.confidence, sharedTo: shared, blockedAt: new Date(),
    });
  } catch { /* non-critical */ }

  return {
    pdqHash: pdq, sha256Hash: sha, sharedTo: shared,
    locallyBlocked: true, stopNciiIntegration: shared.includes('StopNCII.org'),
  };
}

export async function checkNciiHashBlocklist(
  imageBuffer: Buffer
): Promise<{ blocked: boolean; matchType: 'exact' | 'perceptual' | 'none' }> {
  const sha = createHash('sha256').update(imageBuffer).digest('hex');
  const db = getFirestore();

  try {
    const s = await getDoc(doc(db, '_safety_ncii_hashes', sha));
    if (s.exists()) return { blocked: true, matchType: 'exact' };
  } catch { /* fallthrough to perceptual */ }

  try {
    const pdq = await computePdq(imageBuffer);
    const all = await getDocs(collection(db, '_safety_ncii_hashes'));
    for (const d of all.docs) {
      const sp = d.data().pdqHash as string | undefined;
      if (sp && hamming(pdq, sp) < 32) return { blocked: true, matchType: 'perceptual' };
    }
  } catch { /* non-critical */ }

  return { blocked: false, matchType: 'none' };
}

async function computePdq(buf: Buffer): Promise<string> {
  const apiUrl = process.env['SAFETY_API_URL'];
  if (apiUrl) {
    try {
      const r = await fetch(`${apiUrl}/hash/pdq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf,
      });
      if (r.ok) {
        const d = await r.json() as { hash: string };
        return d.hash;
      }
    } catch { /* fallback below */ }
  }
  return `dhash_${createHash('md5').update(buf).digest('hex')}`;
}

async function submitStopNcii(
  pdq: string,
  sha: string,
  ctx: { method: string; confidence: number }
): Promise<boolean> {
  const k = process.env['STOPNCII_API_KEY'];
  if (!k) return false;
  try {
    const r = await fetch('https://api.stopncii.org/v1/hashes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
      body: JSON.stringify({
        hashes: [{ type: 'PDQ', value: pdq }, { type: 'SHA256', value: sha }],
        source: 'myarchetype',
        category: ctx.method === 'ai_generated' ? 'AI_GENERATED_INTIMATE' : 'NON_CONSENSUAL_INTIMATE',
        confidence: ctx.confidence,
      }),
    });
    return r.ok;
  } catch { return false; }
}

async function submitGifct(
  pdq: string,
  ctx: { method: string; confidence: number }
): Promise<boolean> {
  const k = process.env['GIFCT_API_KEY'];
  if (!k) return false;
  try {
    const r = await fetch('https://api.gifct.org/v1/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
      body: JSON.stringify({
        signal_type: 'hash', hash_type: 'PDQ', hash_value: pdq,
        content_type: 'intimate_image', source_platform: 'myarchetype',
      }),
    });
    return r.ok;
  } catch { return false; }
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

export interface SextortionVictimSupportResult {
  shouldRoute: boolean;
  urgency: 'immediate' | 'high' | 'standard' | 'none';
  sextortionHelpline: Array<{
    name: string;
    type: 'hotline' | 'text' | 'website' | 'law_enforcement';
    contact: string;
    description: string;
    available24x7: boolean;
  }>;
  inAppActions: string[];
  victimAutoRouting: boolean;
}

const VP = [
  /being (blackmailed|extorted|threatened)/i,
  /(someone|they|he|she) (is |are )?(threatening|blackmailing)/i,
  /(has|have|got) my (nudes|photos|pictures|videos)/i,
  /threatening to (share|post|send|leak|expose)/i,
  /what (should|do|can) i do/i,
  /please (help|don't|stop)/i,
  /i('m| am) (scared|afraid|terrified)/i,
  /(sent|shared|gave) (them |him |her )?(my )?(nudes|photos|pictures)/i,
  /they (want|demanded|asking for) (money|\$|payment)/i,
  /i (already )?paid (them|him|her)/i,
];
const SH = [
  /kill myself/i,
  /want to die/i,
  /end (my |it all|everything)/i,
  /suicide/i,
  /can't (go on|take it|live)/i,
];

export function sextortionVictimSupport(
  messageText: string,
  userLocale = 'en-US',
  userAge?: number
): SextortionVictimSupportResult {
  const iv = VP.some(p => p.test(messageText));
  const is = SH.some(p => p.test(messageText));
  const im = userAge !== undefined && userAge < 18;

  if (!iv && !is) {
    return { shouldRoute: false, urgency: 'none', sextortionHelpline: [], inAppActions: [], victimAutoRouting: false };
  }

  let u: SextortionVictimSupportResult['urgency'] = 'standard';
  if (is || im) u = 'immediate';
  else if (iv) u = 'high';

  const hl: SextortionVictimSupportResult['sextortionHelpline'] = [];
  const co = userLocale.split('-')[1]?.toUpperCase() ?? 'US';

  if (is) hl.push({ name: '988 Suicide & Crisis Lifeline', type: 'hotline', contact: 'Call or text 988', description: 'Free 24/7 crisis support', available24x7: true });
  if (im) {
    hl.push({ name: 'Take It Down (NCMEC)', type: 'website', contact: 'https://takeitdown.ncmec.org', description: 'Free removal of intimate images of minors', available24x7: true });
    hl.push({ name: 'NCMEC CyberTipline', type: 'website', contact: 'https://report.cybertip.org', description: 'Report online exploitation of children', available24x7: true });
  }
  if (co === 'US') {
    hl.push({ name: 'FBI IC3', type: 'law_enforcement', contact: 'https://www.ic3.gov', description: 'Report to FBI Internet Crime Complaint Center', available24x7: true });
    hl.push({ name: 'Thorn Sextortion Resources', type: 'website', contact: 'https://www.thorn.org/sextortion/', description: 'Guidance and support for sextortion victims', available24x7: true });
  }
  if (co === 'GB') hl.push({ name: 'Revenge Porn Helpline', type: 'hotline', contact: '0345 6000 459', description: 'UK helpline for intimate image abuse', available24x7: false });
  hl.push({ name: 'StopNCII.org', type: 'website', contact: 'https://stopncii.org', description: 'Hash intimate images to prevent sharing', available24x7: true });
  hl.push({ name: 'CCRI Crisis Helpline', type: 'hotline', contact: '1-844-878-2274', description: 'Cyber Civil Rights Initiative — legal resources', available24x7: false });

  const aa = ['block_suspect', 'save_evidence', 'report_to_platform', 'contact_human_moderator'];
  if (is) aa.unshift('crisis_hotline_call');

  return { shouldRoute: true, urgency: u, sextortionHelpline: hl, inAppActions: aa, victimAutoRouting: true };
}

export function getSextortionVictimMessage(urgency: string): { title: string; body: string; steps: string[] } {
  return {
    title: urgency === 'immediate' ? '🚨 Help is available right now' : '⚠️ This looks like sextortion — you\'re not alone',
    body: 'Sextortion is a crime. You are a victim, not at fault. Paying almost always leads to MORE demands, not fewer.',
    steps: [
      '1. Do NOT send money or additional images',
      '2. Do NOT delete the conversation — it\'s evidence',
      '3. Screenshot all threats and demands',
      '4. Block this person on ALL platforms',
      '5. Report to law enforcement (FBI IC3 or local police)',
      '6. Contact a crisis helpline',
    ],
  };
}
export const sextortionSupport = sextortionVictimSupport;
export function victimRouting(m: string, l?: string, a?: number) { return sextortionVictimSupport(m, l, a); }
export function crisisRouting(m: string, l?: string, a?: number) { return sextortionVictimSupport(m, l, a); }

export interface OffPlatformSextortionResult {
  offPlatformSextortion: boolean;
  sextortionWarning: string;
  detectedOnPlatform: string[];
}

const PLATFORMS = ['whatsapp', 'telegram', 'snapchat', 'instagram', 'signal', 'kik', 'discord', 'skype', 'viber', 'wechat'];
const SEXTORTION_PATTERNS = [
  /i('ll| will) (share|send|post|leak)/i,
  /everyone will see/i,
  /send (me )?(money|\$|bitcoin)/i,
  /pay (me|or)/i,
];

export function offPlatformSextortion(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): OffPlatformSextortionResult {
  const pm = messages
    .filter(m => m.senderId === suspectId)
    .filter(m => PLATFORMS.some(p => m.text.toLowerCase().includes(p)));

  const hs = messages
    .filter(m => m.senderId === suspectId)
    .some(m => SEXTORTION_PATTERNS.some(p => p.test(m.text)));

  const d = pm.length > 0 && hs;

  return {
    offPlatformSextortion: d,
    sextortionWarning: d
      ? 'WARNING: This person mentioned moving to another platform and is using sextortion language. Do NOT switch platforms. Block immediately and report to law enforcement.'
      : '',
    detectedOnPlatform: d
      ? [...new Set(pm.map(m => PLATFORMS.find(p => m.text.toLowerCase().includes(p))).filter((p): p is string => p !== undefined))]
      : [],
  };
}

export interface BlackmailEscalationResult {
  detected: boolean;
  threatTrajectory: string[];
  currentStage: number;
  escalationVelocity: number;
  action: 'none' | 'flag' | 'warn_victim' | 'block_and_report';
}

const BLACKMAIL_STAGES: { stage: number; name: string; patterns: RegExp[] }[] = [
  { stage: 1, name: 'rapport_building', patterns: [/you('re| are) (so )?(beautiful|gorgeous|special|amazing|perfect)/i, /never (met|felt|known) anyone like/i, /connection.*special/i] },
  { stage: 2, name: 'intimate_solicitation', patterns: [/send (me )?(a )?(pic|photo|selfie|video|nude)/i, /show me/i, /video call.*private/i, /what are you wearing/i, /something (sexy|naughty|spicy)/i] },
  { stage: 3, name: 'evidence_collection', patterns: [/i (took|have|saved|made) (a )?(screenshot|recording|copy)/i, /recorded (this|our|the)/i, /i have (your|the) (photo|pic|video|nude)/i, /saved (everything|all|it)/i] },
  { stage: 4, name: 'threat_delivery', patterns: [/i('ll| will) (share|send|post|leak|upload|expose)/i, /(send|share|post).*(friends|family|boss|coworkers|school|facebook|instagram)/i, /everyone (will|gonna) see/i, /ruin (your )?(life|reputation|career)/i, /imagine (if|when) (everyone|your|they)/i] },
  { stage: 5, name: 'financial_demand', patterns: [/send (\$|€|£)?\d/i, /pay (me|us)/i, /(\$|€|£)\s*\d/, /bitcoin|btc|crypto|gift\s?card|cash\s?app|venmo|zelle|wire|western union/i, /transfer.*(money|funds)/i] },
  { stage: 6, name: 'escalating_pressure', patterns: [/not enough/i, /more money/i, /last chance/i, /\d+\s*(hour|minute|day)s?\s*(left|remaining|or else|until)/i, /price.*went up/i, /double|triple/i, /running out of (time|patience)/i, /next time.*(more|\$)/i] },
];

export function blackmailEscalation(
  messages: Array<{ text: string; timestamp: number; senderId: string }>,
  suspectId: string
): BlackmailEscalationResult {
  const sm = messages.filter(m => m.senderId === suspectId).sort((a, b) => a.timestamp - b.timestamp);
  if (sm.length < 3) return { detected: false, threatTrajectory: [], currentStage: 0, escalationVelocity: 0, action: 'none' };

  const tt: string[] = [];
  let ms = 0;
  let ft: number | null = null;
  let lt: number | null = null;

  for (const msg of sm) {
    for (const st of BLACKMAIL_STAGES) {
      if (st.patterns.some(p => p.test(msg.text))) {
        if (!tt.includes(st.name)) tt.push(st.name);
        ms = Math.max(ms, st.stage);
        if (st.stage >= 4) { if (!ft) ft = msg.timestamp; lt = msg.timestamp; }
        break;
      }
    }
  }

  let ev = 0;
  if (ft !== null && lt !== null && ft !== lt) {
    const h = (lt - ft) / 3_600_000;
    const tc = tt.filter(t => ['threat_delivery', 'financial_demand', 'escalating_pressure'].includes(t)).length;
    ev = tc / Math.max(0.1, h);
  }

  const d = tt.length >= 3 && ms >= 4;
  const action: BlackmailEscalationResult['action'] =
    ms >= 5 && tt.length >= 4 ? 'block_and_report' :
    ms >= 4 ? 'warn_victim' :
    tt.length >= 3 ? 'flag' : 'none';

  return { detected: d, threatTrajectory: tt, currentStage: ms, escalationVelocity: ev, action };
}

export interface SingleParentSafetyPromptResult {
  title: string;
  body: string;
  tips: string[];
  resources: Array<{ name: string; url: string; description: string }>;
  shouldShow: boolean;
}

const SINGLE_PARENT_TIPS = [
  'Avoid sharing children\'s names, ages, or school names in your profile',
  'Don\'t post photos of your children on dating apps — use solo photos',
  'Never share your custody schedule or where your children live',
  'Meet new dates away from your home and your children\'s school',
  'Tell a trusted friend when and where you\'re meeting someone new',
  'Trust your instincts — if something feels wrong, it probably is',
  'Be cautious if someone shows unusual interest in your children early on',
  'Consider waiting until you fully trust someone before mentioning you have kids',
];

const SINGLE_PARENT_RESOURCES = [
  { name: 'National Domestic Violence Hotline', url: 'https://www.thehotline.org', description: '1-800-799-7233 — 24/7 confidential support' },
  { name: 'NCMEC Safety Resources', url: 'https://www.missingkids.org/education', description: 'Child safety education and prevention' },
  { name: 'Love Is Respect', url: 'https://www.loveisrespect.org', description: 'Healthy relationship resources for parents' },
  { name: 'RAINN', url: 'https://www.rainn.org', description: '1-800-656-4673 — Sexual assault support' },
];

export function singleParentSafetyPrompt(profile: {
  hasKids: boolean;
  bio: string;
  mentionsChildrenInBio: boolean;
  hasChildPhotos: boolean;
}): SingleParentSafetyPromptResult {
  const ss = profile.hasKids;
  let body = 'As a single parent, your safety — and your children\'s safety — matters extra.';
  const notices: string[] = [];

  if (profile.mentionsChildrenInBio) {
    notices.push('Your bio mentions your children — consider keeping those details private until you trust someone.');
  }
  if (profile.hasChildPhotos) {
    notices.push('Your profile contains photos of children — we strongly recommend using only solo photos on dating apps.');
  }
  if (notices.length > 0) {
    body += '\n\n⚠️ We noticed:\n' + notices.map(r => `• ${r}`).join('\n');
  }

  return {
    title: '🛡️ Safety Tips for Single Parents',
    body,
    tips: SINGLE_PARENT_TIPS,
    resources: SINGLE_PARENT_RESOURCES,
    shouldShow: ss,
  };
}
export const parentSafetyEducation = singleParentSafetyPrompt;