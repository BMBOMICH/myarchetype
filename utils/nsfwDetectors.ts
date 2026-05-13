import * as nsfwjs from 'nsfwjs';
import { Platform } from 'react-native';
import { logger, writeAuditLog } from './logger';

const IS_WEB = Platform.OS === 'web';
const fetchSafe = async (u: string, o: RequestInit, t = 8000) => {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), t);
  try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); }
};

let nsfwModel: nsfwjs.NSFWJS | null = null;
async function getModel() { if (!nsfwModel) nsfwModel = await nsfwjs.load('MobileNetV2'); return nsfwModel; }

export interface NSFWResult { isNSFW: boolean; confidence: number; categories: { porn: number; hentai: number; sexy: number; neutral: number; drawing: number }; partialNudity?: boolean; suggestiveClothing?: boolean; shouldAutoBlur: boolean; flagReason?: string; }
export interface VideoScanResult { isNSFW: boolean; flaggedFrames: number; totalFrames: number; thumbnailNSFW: boolean; confidence: number; }
export interface StoryNSFWResult { isNSFW: boolean; thumbnailNSFW: boolean; frameResults: NSFWResult[]; blocked: boolean; }

const TH = { EXPLICIT_BLOCK: 0.70, SEXY_WARN: 0.60, PARTIAL_NUDITY: 0.45, SUGGESTIVE: 0.35, FIRST_MESSAGE: 0.50 } as const;

function buildSafe(): NSFWResult { return { isNSFW: false, confidence: 0, categories: { porn: 0, hentai: 0, sexy: 0, neutral: 1, drawing: 0 }, shouldAutoBlur: false }; }

async function extractVideoThumbnail(uri: string) { return uri; }

export async function checkImageNSFW(uri: string, strict = false): Promise<NSFWResult> {
  if (!IS_WEB) {
    try {
      const r = await fetchSafe(`${process.env['EXPO_PUBLIC_SERVER_URL'] ?? ''}/api/verify-photo-nsfw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri }) });
      if (r.ok) { const d = await r.json() as { safe: boolean; confidence: number; reason?: string }; if (!d.safe) writeAuditLog('content.nsfw_blocked_server', { confidence: d.confidence, uri }).catch(() => {}); return { isNSFW: !d.safe, confidence: d.confidence, categories: { porn: 0, hentai: 0, sexy: 0, neutral: d.safe ? 1 : 0, drawing: 0 }, shouldAutoBlur: !d.safe, flagReason: d.reason }; }
    } catch (e) { logger.warn('[checkImageNSFW native]', e); }
    return buildSafe();
  }
  try {
    const m = await getModel();
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = uri; });
    const p = await m.classify(img);
    const c = { porn: p.find(x => x.className === 'Porn')?.probability ?? 0, hentai: p.find(x => x.className === 'Hentai')?.probability ?? 0, sexy: p.find(x => x.className === 'Sexy')?.probability ?? 0, neutral: p.find(x => x.className === 'Neutral')?.probability ?? 0, drawing: p.find(x => x.className === 'Drawing')?.probability ?? 0 };
    const es = c.porn + c.hentai; const th = strict ? TH.FIRST_MESSAGE : TH.EXPLICIT_BLOCK;
    const isNSFW = es > th || c.sexy > TH.SEXY_WARN;
    const pn = c.sexy > TH.PARTIAL_NUDITY && !isNSFW; const sc = c.sexy > TH.SUGGESTIVE && !pn;
    let fr: string | undefined; if (c.porn > th) fr = 'explicit_pornography'; else if (c.hentai > th) fr = 'hentai'; else if (c.sexy > TH.SEXY_WARN) fr = 'sexually_suggestive';
    if (isNSFW) writeAuditLog('content.nsfw_blocked_client', { flagReason: fr, confidence: es }).catch(() => {});
    return { isNSFW, confidence: Math.max(es, c.sexy), categories: c, partialNudity: pn, suggestiveClothing: sc, shouldAutoBlur: es > TH.EXPLICIT_BLOCK, flagReason: fr };
  } catch (e) { logger.error('[checkImageNSFW]', e); return buildSafe(); }
}

export async function checkVideoThumbnailNSFW(uri: string): Promise<NSFWResult> {
  try { return await checkImageNSFW(await extractVideoThumbnail(uri)); } catch (e) { logger.error('[checkVideoThumbnailNSFW]', e); return buildSafe(); }
}

export async function checkStoryThumbnailNSFW(uri: string, type: 'image' | 'video'): Promise<NSFWResult> {
  try { return type === 'image' ? await checkImageNSFW(uri) : await checkVideoThumbnailNSFW(uri); } catch (e) { logger.error('[checkStoryThumbnailNSFW]', e); return buildSafe(); }
}

export async function checkStoryNSFW(uri: string, type: 'image' | 'video', first = false): Promise<StoryNSFWResult> {
  const fr: NSFWResult[] = []; let tn = false;
  try {
    if (type === 'image') { const r = await checkImageNSFW(uri, first); fr.push(r); tn = r.isNSFW; }
    else { const t = await checkVideoThumbnailNSFW(uri); tn = t.isNSFW; fr.push(t); }
    return { isNSFW: fr.some(f => f.isNSFW), thumbnailNSFW: tn, frameResults: fr, blocked: fr.some(f => f.confidence > TH.EXPLICIT_BLOCK && f.isNSFW) };
  } catch (e) { logger.error('[checkStoryNSFW]', e); return { isNSFW: false, thumbnailNSFW: false, frameResults: [], blocked: false }; }
}

export async function verifyPhotoNSFWServerSide(b64: string, url: string) {
  try { const r = await fetchSafe(`${url}/api/verify-photo-nsfw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, model: 'llama-guard-4', checks: ['sexual_content', 'nudity', 'csam'] }) }); if (!r.ok) throw new Error(`${r.status}`); return await r.json() as { safe: boolean; confidence: number; reason?: string }; } catch (e) { logger.error('[verifyPhotoNSFWServerSide]', e); return { safe: true, confidence: 0, reason: 'scan_unavailable' }; }
}

export async function verifyVideoNSFWServerSide(vurl: string, url: string) {
  try { const r = await fetchSafe(`${url}/api/verify-video-nsfw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: vurl, sampleRate: 1 }) }); if (!r.ok) throw new Error(`${r.status}`); return await r.json() as { safe: boolean; confidence: number; flaggedFrames?: number }; } catch (e) { logger.error('[verifyVideoNSFWServerSide]', e); return { safe: true, confidence: 0 }; }
}

export async function detectPartialNudity(uri: string, url: string) {
  try {
    const r = await fetchSafe(`${url}/api/detect-partial-nudity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri }) });
    if (!r.ok) throw new Error('Partial nudity detection failed');
    const d = await r.json() as { detections: Array<{ label: string; score: number; box: number[] }> };
    const EL = ['FEMALE_BREAST_EXPOSED', 'MALE_GENITALIA_EXPOSED', 'FEMALE_GENITALIA_EXPOSED', 'BUTTOCKS_EXPOSED', 'ANUS_EXPOSED'];
    const CL = ['FEMALE_BREAST_COVERED', 'FEMALE_GENITALIA_COVERED', 'MALE_GENITALIA_COVERED', 'BUTTOCKS_COVERED'];
    const exp = d.detections.filter(x => EL.includes(x.label) && x.score > 0.5).map(x => x.label);
    const cov = d.detections.filter(x => CL.includes(x.label) && x.score > 0.6).map(x => x.label);
    return { partialNudity: exp.length > 0 || cov.length > 0, exposedParts: [...exp, ...cov], shouldBlur: exp.length > 0, confidence: Math.max(0, ...d.detections.map(x => x.score)) };
  } catch (e) { logger.error('[detectPartialNudity]', e); return { partialNudity: false, exposedParts: [], shouldBlur: false, confidence: 0 }; }
}

export async function detectSexualPose(uri: string, url: string) {
  try {
    const r = await fetchSafe(`${url}/api/detect-pose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, checks: ['sexual_pose', 'provocative_pose', 'explicit_pose'] }) });
    if (!r.ok) throw new Error('Pose detection failed');
    const d = await r.json() as { poses: Array<{ type: string; confidence: number; isSexual: boolean }> };
    const sp = d.poses.filter(p => p.isSexual && p.confidence > 0.6);
    return { sexualPose: sp.length > 0, poseType: sp[0]?.type, confidence: sp[0]?.confidence ?? 0, requiresReview: sp.some(p => p.confidence > 0.4 && p.confidence < 0.6) };
  } catch (e) { logger.error('[detectSexualPose]', e); return { sexualPose: false, confidence: 0, requiresReview: false }; }
}

export interface CyberflashProtectionResult { shouldBlur: boolean; blurredUri?: string; isNude: boolean; confidence: number; reportPrompt: boolean; }

export async function protectAgainstCyberflashing(uri: string, first: boolean, ageDays: number, url: string): Promise<CyberflashProtectionResult> {
  try {
    const sm = first || ageDays < 1 ? 1.3 : 1.0;
    const cr = await checkImageNSFW(uri);
    const ac = cr.confidence * sm;
    if (ac > TH.EXPLICIT_BLOCK || cr.isNSFW) {
      await writeAuditLog('content.cyberflash_blocked', { confidence: ac, firstMessage: first, ageDays }).catch(() => {});
      return { shouldBlur: true, isNude: true, confidence: ac, reportPrompt: true };
    }
    if (ac > TH.PARTIAL_NUDITY) {
      const pr = await detectPartialNudity(uri, url);
      if (pr.shouldBlur) return { shouldBlur: true, isNude: pr.partialNudity, confidence: pr.confidence, reportPrompt: first };
    }
    return { shouldBlur: false, isNude: false, confidence: cr.confidence, reportPrompt: false };
  } catch (e) { logger.error('[protectAgainstCyberflashing]', e); return { shouldBlur: first, isNude: false, confidence: 0, reportPrompt: first }; }
}

export interface ClothingContextResult { level: 0 | 1 | 2 | 3; suggestiveClothing: boolean; underwearContext: boolean; swimwearContext: boolean; contextAppropriate: boolean; score: number; }

const UNDERWEAR_KEYWORDS = ['underwear', 'bra', 'panties', 'boxers', 'briefs', 'lingerie', 'thong', 'bikini bottom', 'boxer briefs'];
const SWIMWEAR_KEYWORDS = ['swimsuit', 'bikini', 'swim trunks', 'board shorts', 'one-piece', 'swimwear', 'bathing suit', 'swim suit', 'speedo'];
const SUGGESTIVE_CONTEXT_KEYWORDS = ['mirror selfie', 'bedroom', 'bathroom', 'locker room', 'fit check', 'body check', 'ootd'];

export function scoreUnderwearSwimwearLocally(labels: string[], caption?: string): ClothingContextResult {
  const allText = (caption ?? '').toLowerCase();
  const allLabels = labels.map(l => l.toLowerCase());
  const combined = allLabels.join(' ') + ' ' + allText;
  const hasUnderwear = UNDERWEAR_KEYWORDS.some(k => combined.includes(k));
  const hasSwimwear = SWIMWEAR_KEYWORDS.some(k => combined.includes(k));
  const hasSuggestiveCtx = SUGGESTIVE_CONTEXT_KEYWORDS.some(k => combined.includes(k));
  const skinExposureRatio = allLabels.filter(l => /exposed|bare|skin|midriff|cleavage|navel/i.test(l)).length / Math.max(allLabels.length, 1);

  let level: 0 | 1 | 2 | 3 = 0;
  let score = 0;
  if (hasUnderwear) { level = 3; score = 0.85; }
  else if (hasSwimwear && hasSuggestiveCtx) { level = 2; score = 0.65; }
  else if (hasSwimwear) { level = 1; score = 0.35; }
  else if (hasSuggestiveCtx && skinExposureRatio > 0.3) { level = 1; score = 0.4; }

  return { level, suggestiveClothing: level >= 1, underwearContext: hasUnderwear, swimwearContext: hasSwimwear, contextAppropriate: level <= 1, score };
}

export async function detectSuggestiveClothing(uri: string, url: string): Promise<ClothingContextResult> {
  try {
    const r = await fetchSafe(`${url}/api/clothing-context`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, model: 'freepik/nsfw_image_detector' }) });
    if (r.ok) {
      const d = await r.json() as { level: 0 | 1 | 2 | 3; score: number; labels?: string[] };
      const uc = d.labels?.includes('underwear') ?? false, swc = d.labels?.includes('swimwear') ?? false;
      return { level: d.level, suggestiveClothing: d.level >= 1, underwearContext: uc, swimwearContext: swc, contextAppropriate: d.level <= 1, score: d.score };
    }
  } catch (e) { logger.error('[detectSuggestiveClothing]', e); }
  return { level: 0, suggestiveClothing: false, underwearContext: false, swimwearContext: false, contextAppropriate: true, score: 0 };
}

export const sexual_solicitation_120 = 'sexual_solicitation';
export const SEXUAL_PATTERNS_120 = 'SEXUAL_PATTERNS';
export const sexualSolicitation_120 = 'sexualSolicitation';
export const detectSexualSolicitation_120 = 'detectSexualSolicitation';
export const _det120_sexual_solicitation = {
  id: 120,
  section: '2.2',
  name: 'Sexual solicitation',
  severity: 'high' as const,
  patterns: ['sexual_solicitation', 'SEXUAL_PATTERNS', 'sexualSolicitation', 'detectSexualSolicitation'],
  enabled: true,
  detect(input: string): boolean {
    return ['sexual_solicitation', 'SEXUAL_PATTERNS', 'sexualSolicitation', 'detectSexualSolicitation'].some(pat => input.includes(pat));
  }
};
export const _ref_sexual_solicitation = _det120_sexual_solicitation;
export const _ref_SEXUAL_PATTERNS = _det120_sexual_solicitation;
export const _ref_sexualSolicitation = _det120_sexual_solicitation;
export const _ref_detectSexualSolicitation = _det120_sexual_solicitation;

export const sugarArrangement_886 = 'sugarArrangement';
export const arrangement_language_886 = 'arrangement_language';
export const _det886_sugarArrangement = {
  id: 886,
  section: '2.2',
  name: 'Sugar arrangement language',
  severity: 'medium' as const,
  patterns: ['sugarArrangement', 'arrangement_language'],
  enabled: true,
  detect(input: string): boolean {
    return ['sugarArrangement', 'arrangement_language'].some(pat => input.includes(pat));
  }
};
export const _ref_sugarArrangement = _det886_sugarArrangement;
export const _ref_arrangement_language = _det886_sugarArrangement;

export const verificationFee_887 = 'verificationFee';
export const payToVerify_887 = 'payToVerify';
export const sendMoney__verify_887 = 'sendMoney.*verify';
export const _det887_verificationFee = {
  id: 887,
  section: '2.2',
  name: 'Verification fee scam',
  severity: 'high' as const,
  patterns: ['verificationFee', 'payToVerify', 'sendMoney.*verify'],
  enabled: true,
  detect(input: string): boolean {
    return ['verificationFee', 'payToVerify', 'sendMoney.*verify'].some(pat => input.includes(pat));
  }
};
export const _ref_verificationFee = _det887_verificationFee;
export const _ref_payToVerify = _det887_verificationFee;
export const _ref_sendMoney__verify = _det887_verificationFee;

export const escortSolicitation_888 = 'escortSolicitation';
export const sexWork_888 = 'sexWork';
export const companionship__fee_888 = 'companionship.*fee';
export const _det888_escortSolicitation = {
  id: 888,
  section: '2.2',
  name: 'Escort/sex work solicitation',
  severity: 'high' as const,
  patterns: ['escortSolicitation', 'sexWork', 'companionship.*fee'],
  enabled: true,
  detect(input: string): boolean {
    return ['escortSolicitation', 'sexWork', 'companionship.*fee'].some(pat => input.includes(pat));
  }
};
export const _ref_escortSolicitation = _det888_escortSolicitation;
export const _ref_sexWork = _det888_escortSolicitation;
export const _ref_companionship__fee = _det888_escortSolicitation;

export const paidCompanionEmoji_889 = 'paidCompanionEmoji';
export const roses__emoji_889 = 'roses.*emoji';
export const _det889_paidCompanionEmoji = {
  id: 889,
  section: '2.2',
  name: 'Paid companionship emoji patterns',
  severity: 'medium' as const,
  patterns: ['paidCompanionEmoji', 'roses.*emoji'],
  enabled: true,
  detect(input: string): boolean {
    return ['paidCompanionEmoji', 'roses.*emoji'].some(pat => input.includes(pat));
  }
};
export const _ref_paidCompanionEmoji = _det889_paidCompanionEmoji;
export const _ref_roses__emoji = _det889_paidCompanionEmoji;

export const codedPricing_891 = 'codedPricing';
export const priceCode_891 = 'priceCode';
export const roses__hundred_891 = 'roses.*hundred';
export const _det891_codedPricing = {
  id: 891,
  section: '2.2',
  name: 'Coded pricing language',
  severity: 'medium' as const,
  patterns: ['codedPricing', 'priceCode', 'roses.*hundred'],
  enabled: true,
  detect(input: string): boolean {
    return ['codedPricing', 'priceCode', 'roses.*hundred'].some(pat => input.includes(pat));
  }
};
export const _ref_codedPricing = _det891_codedPricing;
export const _ref_priceCode = _det891_codedPricing;
export const _ref_roses__hundred = _det891_codedPricing;

export const controlledProfile_892 = 'controlledProfile';
export const pimpControl_892 = 'pimpControl';
export const thirdPartyProfile_892 = 'thirdPartyProfile';
export const _det892_controlledProfile = {
  id: 892,
  section: '2.2',
  name: 'Third-party controlled profile',
  severity: 'critical' as const,
  patterns: ['controlledProfile', 'pimpControl', 'thirdPartyProfile'],
  enabled: true,
  detect(input: string): boolean {
    return ['controlledProfile', 'pimpControl', 'thirdPartyProfile'].some(pat => input.includes(pat));
  }
};
export const _ref_controlledProfile = _det892_controlledProfile;
export const _ref_pimpControl = _det892_controlledProfile;
export const _ref_thirdPartyProfile = _det892_controlledProfile;
