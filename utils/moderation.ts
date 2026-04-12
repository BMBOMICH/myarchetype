// utils/moderation.ts
import { Platform } from 'react-native';
import { logger } from './logger';

const IS_WEB = Platform.OS === 'web';
const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://myarchetype-server.vercel.app';

export interface ModerationResult {
  safe: boolean; reason: string; flaggedCategories?: string[];
  scores?: Record<string, number>; severity?: 'low' | 'medium' | 'high' | 'critical';
}

export type ContentField =
  | 'chat' | 'bio' | 'prompt' | 'bug_report' | 'bio_edit' | 'occupation'
  | 'report_reason' | 'match_notes' | 'date_review' | 'post_date_feedback'
  | 'icebreaker' | 'daily_question' | 'name' | 'general';

const ZW_RE = /[\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;
export function stripZeroWidthChars(text: string): string { return text.replace(ZW_RE, ''); }
export function hasZeroWidthChars(text: string): boolean  { ZW_RE.lastIndex = 0; return ZW_RE.test(text); }
export function normalizeUnicode(text: string): string    { return text.normalize('NFKC'); }

const CONFUSABLES: Record<string, string> = {
  'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','А':'A','Е':'E','О':'O','Р':'P','С':'C','Х':'X','В':'B','К':'K','М':'M','Т':'T',
  'α':'a','ε':'e','ο':'o','τ':'t','ν':'v',
  'ａ':'a','ｂ':'b','ｃ':'c','ｄ':'d','ｅ':'e','ｆ':'f','ｇ':'g','ｈ':'h','ｉ':'i','ｊ':'j','ｋ':'k','ｌ':'l','ｍ':'m','ｎ':'n',
  'ｏ':'o','ｐ':'p','ｑ':'q','ｒ':'r','ｓ':'s','ｔ':'t','ｕ':'u','ｖ':'v','ｗ':'w','ｘ':'x','ｙ':'y','ｚ':'z',
  '０':'0','１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9','@':'a','$':'s',
};
export function normalizeConfusables(text: string): string {
  return text.split('').map(c => CONFUSABLES[c] ?? c).join('');
}

const LEET: Record<string, string> = { '4':'a','@':'a','8':'b','3':'e','9':'g','6':'g','1':'i','!':'i','|':'i','0':'o','5':'s','$':'s','7':'t','+':'t','2':'z' };
export function normalizeLeetSpeak(text: string): string {
  return text.toLowerCase().replace(/ph/g,'f').replace(/ck/g,'k').split('').map(c => LEET[c] ?? c).join('');
}

export function detectRTLInjection(text: string): boolean  { return /[\u202E\u200F\u202B\u2067\u2066]/.test(text); }
export function detectMixedScripts(text: string): boolean  {
  const scripts = [/[a-zA-Z]/, /[\u0400-\u04FF]/, /[\u0370-\u03FF]/, /[\u0600-\u06FF]/, /[\u4E00-\u9FFF]/];
  return scripts.filter(r => r.test(text)).length >= 2;
}
export function detectEmojiSpam(text: string, threshold = 0.5): { isSpam: boolean; emojiRatio: number } {
  if (!text) return { isSpam: false, emojiRatio: 0 };
  const emojis = text.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu) ?? [];
  const total  = [...text].length;
  const ratio  = total > 0 ? emojis.length / total : 0;
  return { isSpam: ratio >= threshold && emojis.length > 5, emojiRatio: ratio };
}

const DRUG_EMOJI_SEQS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /🍃🔥|🌿🔥|🍁💨/, category: 'drug_emoji' },
  { pattern: /❄️👃|🏔️👃|⛷️💨/, category: 'drug_emoji' },
  { pattern: /💊🎉|💉🎉|🍄🌈/, category: 'drug_emoji' },
  { pattern: /🔌💊|🔌🍃|🔌❄️/, category: 'drug_emoji' },
  { pattern: /🤑💸🔌|💎🧊🔥/, category: 'drug_emoji' },
  { pattern: /🌱💨|🌿💨|🍀🔥/, category: 'drug_emoji' },
  { pattern: /⚗️💊|🧪💊|🔬💊/, category: 'drug_emoji' },
  { pattern: /🚀🌙|🚀💊|🚀❄️/, category: 'drug_emoji' },
  { pattern: /🎱🔌|🎱💊|🎱🍃/, category: 'drug_emoji' },
  { pattern: /🧊🔥|🧊💨|🧊👃/, category: 'drug_emoji' },
  { pattern: /🍬💊|🍭💊|🍫💊/, category: 'drug_emoji' },
  { pattern: /🍑🍆|🍆💦|🍑💦/, category: 'sexual_emoji' },
  { pattern: /👅🍑|🍆👅|💋🍆/, category: 'sexual_emoji' },
  { pattern: /💋👅💦|🍆💋👅/, category: 'sexual_emoji' },
  { pattern: /🙈💦|🍒💦|🍌💦/, category: 'sexual_emoji' },
  { pattern: /🔞💋|🔞🍆|🔞👅/, category: 'sexual_emoji' },
];
export function detectEmojiCodedLanguage(text: string): { detected: boolean; matches: Array<{ category: string; meaning?: string }> } {
  const matches: Array<{ category: string; meaning?: string }> = [];
  for (const seq of DRUG_EMOJI_SEQS) { if (seq.pattern.test(text)) matches.push({ category: seq.category }); }
  return { detected: matches.length > 0, matches };
}

export function preprocessText(text: string): string {
  return normalizeLeetSpeak(normalizeConfusables(normalizeUnicode(stripZeroWidthChars(text))));
}

// ═══════════════════════════════════════════════════════════
// NSFW model types
// ═══════════════════════════════════════════════════════════

interface NsfwPrediction { className: string; probability: number; }
interface NsfwModel      { classify: (img: HTMLImageElementLike) => Promise<NsfwPrediction[]>; }
interface HTMLImageElementLike {
  crossOrigin: string; onload: (() => void) | null;
  onerror: (() => void) | null; src: string;
}
interface GlobalWithDocument {
  document?: { createElement?: (tag: string) => HTMLImageElementLike & { crossOrigin: string } };
}

// ═══════════════════════════════════════════════════════════
// IMAGE MODERATION
// ═══════════════════════════════════════════════════════════

let nsfwModel:       NsfwModel | null                   = null;
let nsfwLoadPromise: Promise<NsfwModel | null> | null   = null;
let modelReady       = false;

export async function preloadSafetyModel(): Promise<boolean> {
  if (!IS_WEB) return false;
  try { return !!(await loadNsfwModel()); } catch (err) { logger.warn('[moderation] preload failed:', err); return false; }
}
export function isSafetyModelReady(): boolean { return modelReady; }

async function loadNsfwModel(): Promise<NsfwModel | null> {
  if (nsfwModel)        return nsfwModel;
  if (nsfwLoadPromise)  return nsfwLoadPromise;
  nsfwLoadPromise = (async () => {
    try {
      const tf     = await import('@tensorflow/tfjs');
      const nsfwjs = await import('nsfwjs');
      await tf.ready();
      nsfwModel  = await nsfwjs.load('https://nsfwjs.com/quant_nsfw_mobilenet/', { size: 224, type: 'graph' }) as NsfwModel;
      modelReady = true;
      return nsfwModel;
    } catch (err) {
      logger.error('[moderation] NSFW model load failed:', err);
      nsfwLoadPromise = null;
      return null;
    }
  })();
  return nsfwLoadPromise;
}

function createImageElement(uri: string): Promise<HTMLImageElementLike> {
  return new Promise((resolve, reject) => {
    const g   = globalThis as GlobalWithDocument;
    const img = g.document?.createElement?.('img');
    if (!img) { reject(new Error('No DOM')); return; }
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src     = uri;
  });
}

async function checkImageSafetyNative(imageUrl: string): Promise<ModerationResult> {
  if (!imageUrl.startsWith('https://')) return { safe: true, reason: 'Local URI — check after upload' };
  try {
    const res  = await fetch(`${SERVER_URL}/verify-photo-nsfw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoUrl: imageUrl }) });
    if (!res.ok) return { safe: true, reason: 'Server check unavailable' };
    const data = await res.json() as { isNSFW?: boolean };
    return data.isNSFW
      ? { safe: false, reason: 'Inappropriate content detected.', flaggedCategories: ['nsfw'] }
      : { safe: true,  reason: 'OK' };
  } catch (err) { logger.warn('[moderation] Native NSFW check error:', err); return { safe: true, reason: 'Server check error (allowed)' }; }
}

export async function checkImageSafety(
  imageUri: string,
  context: 'profile' | 'chat' | 'edit' | 'story' | 'video_frame' | 'voice_thumbnail' | 'general' = 'general'
): Promise<ModerationResult> {
  if (!imageUri) return { safe: false, reason: 'No image provided.' };
  if (!IS_WEB)   return checkImageSafetyNative(imageUri);
  try {
    const model = await loadNsfwModel();
    if (!model) return { safe: true, reason: 'Model unavailable' };
    const img         = await createImageElement(imageUri);
    const predictions = await model.classify(img);
    const scores: Record<string, number> = {};
    for (const p of predictions) scores[p.className] = p.probability;
    const porn = scores['Porn'] ?? 0, hentai = scores['Hentai'] ?? 0, sexy = scores['Sexy'] ?? 0;
    const flagged: string[] = [];
    if (porn > 0.3)   flagged.push('explicit_content');
    if (hentai > 0.3) flagged.push('explicit_illustration');
    if (sexy > 0.7)   flagged.push('too_revealing');
    if (porn + hentai + sexy > 0.8 && !flagged.length) flagged.push('suggestive_content');
    if (flagged.length > 0) {
      const reasons: Record<string, string> = {
        explicit_content:      'Explicit content detected. Please use an appropriate photo.',
        explicit_illustration: 'Inappropriate illustration detected.',
        too_revealing:         'Photo is too revealing.',
        suggestive_content:    'Photo may contain inappropriate content.',
      };
      return { safe: false, reason: reasons[flagged[0]!] ?? 'Inappropriate content detected.', flaggedCategories: flagged, scores };
    }
    return { safe: true, reason: 'OK', scores };
  } catch (err) { logger.warn('[moderation] Image safety check error:', err); return { safe: true, reason: 'Check error (allowed)' }; }
}

export async function checkChatImageSafety(imageUri: string): Promise<ModerationResult> {
  return checkImageSafety(imageUri, 'chat');
}

// ─── Video types ──────────────────────────────────────────
interface VideoElementLike {
  crossOrigin: string; src: string; muted: boolean; currentTime: number; duration: number;
  onloadedmetadata: (() => void) | null; onerror: (() => void) | null; onseeked: (() => void) | null;
}
interface CanvasElementLike {
  getContext: (type: '2d') => CanvasContext2DLike | null;
  toDataURL: (type?: string, quality?: number) => string;
  width: number; height: number;
}
interface CanvasContext2DLike {
  drawImage: (source: VideoElementLike, x: number, y: number, w: number, h: number) => void;
}
interface GlobalWithDOM {
  document?: {
    createElement?: (tag: 'video') => VideoElementLike;
  } & { createElement?: (tag: 'canvas') => CanvasElementLike };
}

export async function checkVideoFramesSafety(videoUri: string, frameCount = 5): Promise<ModerationResult> {
  if (!IS_WEB) {
    try {
      const res  = await fetch(`${SERVER_URL}/verify-video-nsfw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: videoUri, frameCount }) });
      if (!res.ok) return { safe: true, reason: 'Server check unavailable' };
      const data = await res.json() as { isNSFW?: boolean };
      return data.isNSFW
        ? { safe: false, reason: 'Video contains inappropriate content.', flaggedCategories: ['nsfw_video'] }
        : { safe: true,  reason: 'OK' };
    } catch (err) { logger.warn('[moderation] Video check error:', err); return { safe: true, reason: 'Video check error (allowed)' }; }
  }
  try {
    const g      = globalThis as unknown as GlobalWithDOM;
    const video  = g.document?.createElement?.('video'  as never) as VideoElementLike  | undefined;
    const canvas = g.document?.createElement?.('canvas' as never) as CanvasElementLike | undefined;
    if (!video || !canvas) return { safe: true, reason: 'Cannot create video element' };
    video.crossOrigin = 'anonymous'; video.src = videoUri; video.muted = true;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video load error'));
      setTimeout(() => reject(new Error('Video load timeout')), 15000);
    });
    const ctx = canvas.getContext('2d');
    canvas.width = 224; canvas.height = 224;
    for (let i = 0; i < frameCount; i++) {
      const seekTime = ((video.duration ?? 0) / (frameCount + 1)) * (i + 1);
      video.currentTime = seekTime;
      await new Promise<void>(r => { video.onseeked = () => r(); setTimeout(r, 2000); });
      ctx?.drawImage(video, 0, 0, 224, 224);
      const result = await checkImageSafety(canvas.toDataURL('image/jpeg', 0.8), 'video_frame');
      if (!result.safe) return { safe: false, reason: `Inappropriate content at ${Math.round(seekTime)}s`, flaggedCategories: result.flaggedCategories };
    }
    return { safe: true, reason: 'OK' };
  } catch (err) { logger.warn('[moderation] Video frame check error:', err); return { safe: true, reason: 'Video check error (allowed)' }; }
}

export async function checkVoiceThumbnail(imageUri: string): Promise<ModerationResult> {
  if (!imageUri) return { safe: true, reason: 'No thumbnail' };
  const result = await checkImageSafety(imageUri, 'voice_thumbnail');
  if (!result.safe) return { ...result, reason: 'Voice intro thumbnail contains inappropriate content.' };
  return result;
}

export async function checkNudeParts(imageUri: string, authToken?: string): Promise<ModerationResult> {
  if (!imageUri.startsWith('https://')) return { safe: true, reason: 'Local URI' };
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res  = await fetch(`${SERVER_URL}/detect-nude-parts`, { method: 'POST', headers, body: JSON.stringify({ photoUrl: imageUri }) });
    if (!res.ok) return { safe: true, reason: 'NudeNet check unavailable' };
    const data = await res.json() as { explicit?: boolean; parts?: string[] };
    if (data.explicit) return { safe: false, reason: 'Explicit body parts detected.', flaggedCategories: data.parts ?? ['explicit'], severity: 'critical' };
    return { safe: true, reason: 'OK' };
  } catch (err) { logger.warn('[moderation] NudeNet check error:', err); return { safe: true, reason: 'NudeNet error (allowed)' }; }
}

export async function verifyAllPhotosSamePerson(photoUrls: string[], authToken?: string): Promise<{ allSame: boolean; confidence: number; reason?: string }> {
  if (photoUrls.length < 2) return { allSame: true, confidence: 1 };
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${SERVER_URL}/verify-all-photos-same-person`, { method: 'POST', headers, body: JSON.stringify({ photoUrls }) });
    if (!res.ok) return { allSame: true, confidence: 0, reason: 'Server unavailable' };
    return await res.json() as { allSame: boolean; confidence: number; reason?: string };
  } catch (err) { logger.warn('[moderation] Same-person check error:', err); return { allSame: true, confidence: 0, reason: 'Check error' }; }
}

export async function checkCrossAccountDuplicate(imageUri: string, userId: string, authToken?: string): Promise<{ isDuplicate: boolean; matchedUserId?: string }> {
  if (!imageUri.startsWith('https://')) return { isDuplicate: false };
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${SERVER_URL}/pdq-cross-account`, { method: 'POST', headers, body: JSON.stringify({ photoUrl: imageUri, userId }) });
    if (!res.ok) return { isDuplicate: false };
    return await res.json() as { isDuplicate: boolean; matchedUserId?: string };
  } catch (err) { logger.warn('[moderation] Cross-account check error:', err); return { isDuplicate: false }; }
}

interface ServerDetectResponse { detected?: boolean; reason?: string; severity?: 'low' | 'medium' | 'high' | 'critical'; }

async function serverDetect(endpoint: string, imageUri: string, authToken?: string): Promise<ModerationResult> {
  if (!imageUri.startsWith('https://')) return { safe: true, reason: 'Local URI' };
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res  = await fetch(`${SERVER_URL}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify({ photoUrl: imageUri }) });
    if (!res.ok) return { safe: true, reason: 'Check unavailable' };
    const data = await res.json() as ServerDetectResponse;
    if (data.detected) return { safe: false, reason: data.reason ?? 'Prohibited content detected.', flaggedCategories: [endpoint], severity: data.severity ?? 'high' };
    return { safe: true, reason: 'OK' };
  } catch (err) { logger.warn(`[moderation] ${endpoint} check error:`, err); return { safe: true, reason: 'Check error' }; }
}

export async function detectHateSymbols(imageUri: string, authToken?: string): Promise<ModerationResult>       { return serverDetect('detect-hate-symbol',       imageUri, authToken); }
export async function detectWeapons(imageUri: string, authToken?: string): Promise<ModerationResult>           { return serverDetect('detect-weapons',            imageUri, authToken); }
export async function detectDrugParaphernalia(imageUri: string, authToken?: string): Promise<ModerationResult> { return serverDetect('detect-drug-paraphernalia', imageUri, authToken); }
export async function detectOffensiveGesture(imageUri: string, authToken?: string): Promise<ModerationResult>  { return serverDetect('detect-offensive-gesture',  imageUri, authToken); }
export async function detectFakeBadgeInPhoto(imageUri: string, authToken?: string): Promise<ModerationResult>  { return serverDetect('detect-fake-badge',          imageUri, authToken); }

interface OcrResponse           { text?: string; }
interface WatermarkEmbedResponse { url?: string; }

export async function extractTextFromImage(imageUri: string, authToken?: string): Promise<{ text: string; hasContactInfo: boolean; contactTypes: string[] }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res  = await fetch(`${SERVER_URL}/ocr-extract`, { method: 'POST', headers, body: JSON.stringify({ photoUrl: imageUri }) });
    if (!res.ok) return { text: '', hasContactInfo: false, contactTypes: [] };
    const data = await res.json() as OcrResponse;
    const text = data.text ?? '';
    const contactTypes: string[] = [];
    if (PHONE_REGEX.test(text)) contactTypes.push('phone');
    if (EMAIL_REGEX.test(text)) contactTypes.push('email');
    if (/\b(snap|insta|ig|telegram|whatsapp|discord)\b/i.test(text)) contactTypes.push('social_handle');
    return { text, hasContactInfo: contactTypes.length > 0, contactTypes };
  } catch (err) { logger.warn('[moderation] OCR error:', err); return { text: '', hasContactInfo: false, contactTypes: [] }; }
}

export async function ocrThenModerate(imageUri: string, authToken?: string): Promise<ModerationResult> {
  const ocr = await extractTextFromImage(imageUri, authToken);
  if (!ocr.text?.trim()) return { safe: true, reason: 'No text found' };
  const textResult = checkTextSafety(ocr.text, 'general');
  if (!textResult.safe) return { ...textResult, flaggedCategories: [...(textResult.flaggedCategories ?? []), 'ocr_hate_speech_in_image'] };
  return { safe: true, reason: 'OK' };
}

export async function embedWatermark(imageUri: string, userId: string, authToken?: string): Promise<{ success: boolean; watermarkedUrl?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res  = await fetch(`${SERVER_URL}/watermark-embed`, { method: 'POST', headers, body: JSON.stringify({ photoUrl: imageUri, userId }) });
    if (!res.ok) return { success: false };
    const data = await res.json() as WatermarkEmbedResponse;
    return { success: true, watermarkedUrl: data.url };
  } catch (err) { logger.warn('[moderation] Watermark embed error:', err); return { success: false }; }
}

export async function detectWatermark(imageUri: string, authToken?: string): Promise<{ hasWatermark: boolean; userId?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${SERVER_URL}/watermark-detect`, { method: 'POST', headers, body: JSON.stringify({ photoUrl: imageUri }) });
    if (!res.ok) return { hasWatermark: false };
    return await res.json() as { hasWatermark: boolean; userId?: string };
  } catch (err) { logger.warn('[moderation] Watermark detect error:', err); return { hasWatermark: false }; }
}

export async function runFullImageScan(imageUri: string, context: 'profile' | 'chat' | 'edit' | 'story' | 'general', authToken?: string): Promise<ModerationResult> {
  const nsfw = await checkImageSafety(imageUri, context);   if (!nsfw.safe)   return nsfw;
  const nude = await checkNudeParts(imageUri, authToken);    if (!nude.safe)   return nude;
  const hate = await detectHateSymbols(imageUri, authToken); if (!hate.safe)   return hate;
  const weapon = await detectWeapons(imageUri, authToken);   if (!weapon.safe) return weapon;
  const drug = await detectDrugParaphernalia(imageUri, authToken); if (!drug.safe) return drug;
  if (context === 'profile' || context === 'edit') {
    const badge = await detectFakeBadgeInPhoto(imageUri, authToken);
    if (!badge.safe) return badge;
  }
  return { safe: true, reason: 'OK' };
}

// ═══════════════════════════════════════════════════════════
// TEXT MODERATION
// ═══════════════════════════════════════════════════════════

interface HarmfulPattern { pattern: RegExp; category: string; reason: string; severity: 'low' | 'medium' | 'high' | 'critical'; }

const PROFANITY_WORDS = new Set([
  'fuck','shit','bitch','ass','damn','dick','cock','pussy','cunt','bastard','whore','slut',
  'asshole','motherfucker','bullshit','goddamn','piss','crap','douche','twat','wanker','prick',
]);
function containsProfanity(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/);
  return words.some(w => PROFANITY_WORDS.has(w));
}

const PHONE_REGEX = /(\+?\d[\d\s\-().]{7,}\d|\b\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4}\b)/;
const EMAIL_REGEX = /\b[a-zA-Z0-9._%+\-]+\s*[@＠]\s*[a-zA-Z0-9.\-]+\s*\.\s*[a-zA-Z]{2,}\b/;

export function extractPhoneNumbers(text: string): { found: boolean; numbers: string[] } {
  const normalized = stripZeroWidthChars(text);
  const matches    = normalized.match(/(\+?\d[\d\s\-().]{7,}\d|\b\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4}\b)/g) ?? [];
  const filtered   = matches.filter(m => m.replace(/\D/g, '').length >= 7);
  return { found: filtered.length > 0, numbers: filtered };
}

const SEXUAL_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(send\s*(me\s*)?(ur\s+|your\s+)?(nudes?|dick\s*pics?|naked\s*(pics?|photos?|selfies?)))\b/i,   category: 'sexual_solicitation',   reason: 'Sexual solicitation is not allowed.',      severity: 'high'   },
  { pattern: /\b(show\s*(me\s*)?(ur|your)\s*(body|boobs?|tits?|ass|pussy|cock|dick))\b/i,                       category: 'sexual_solicitation',   reason: 'Sexual solicitation is not allowed.',      severity: 'high'   },
  { pattern: /\b(wanna|want\s*to|lets?)\s*(fuck|bang|smash|have\s*sex|hookup|hook\s*up)\b/i,                    category: 'sexual_solicitation',   reason: 'Explicit sexual content is not allowed.', severity: 'high'   },
  { pattern: /\b(only\s*fans?|onlyfans?\.com|fansly|my\s*content\s*link)\b/i,                                   category: 'sexual_solicitation',   reason: 'Adult content links not allowed.',         severity: 'medium' },
  { pattern: /\b(sex\s*worker|escort|massages?\s*with\s*extras?|full\s*service)\b/i,                            category: 'sexual_solicitation',   reason: 'Sexual services solicitation not allowed.',severity: 'high'   },
  { pattern: /\b(dtf|down\s*to\s*f[u*]ck)\b/i,                                                                  category: 'sexual_solicitation',   reason: 'Sexual solicitation is not allowed.',      severity: 'high'   },
  { pattern: /\b(looking\s*for\s*(sex|hookup|fwb|nsa|one\s*night))\b/i,                                         category: 'sexual_solicitation',   reason: 'Sexual solicitation is not allowed.',      severity: 'high'   },
  { pattern: /\b(how\s*much\s*(for|do\s*you\s*charge))\b/i,                                                     category: 'sexual_solicitation',   reason: 'Sexual solicitation is not allowed.',      severity: 'high'   },
  { pattern: /\b(sugar\s*(daddy|mama|baby)\s*(needed|wanted|looking))\b/i,                                      category: 'sexual_solicitation',   reason: 'Financial solicitation is not allowed.',   severity: 'medium' },
];
const VIOLENCE_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(i['']?(ll|m\s*(gonna|going\s*to))\s*(kill|murder|hurt|stab|shoot|beat|attack)\s*(you|u|yo|ya))\b/i, category: 'violence_threat', reason: 'Threats of violence are not allowed.',   severity: 'critical' },
  { pattern: /\b(kill\s*(you|ur|yourself)|murder\s*you)\b/i,                                                          category: 'violence_threat', reason: 'Threats of violence are not allowed.',   severity: 'critical' },
  { pattern: /\b(you\s*(will|should|deserve\s*to)\s*die)\b/i,                                                         category: 'violence_threat', reason: 'Threats of violence are not allowed.',   severity: 'critical' },
  { pattern: /\b(i\s*know\s*where\s*you\s*live|i\s*will\s*find\s*you|watch\s*your\s*back)\b/i,                       category: 'violence_threat', reason: 'Threatening language is not allowed.',   severity: 'critical' },
  { pattern: /\b(gonna\s*(hurt|kill|beat)\s*(you|ur|your))\b/i,                                                       category: 'violence_threat', reason: 'Threats of violence are not allowed.',   severity: 'critical' },
  { pattern: /\b(you('re|\s*are)\s*(dead|gonna\s*die))\b/i,                                                           category: 'violence_threat', reason: 'Threats of violence are not allowed.',   severity: 'critical' },
  { pattern: /\b(put\s*a\s*bullet\s*in|slit\s*(your|ur)\s*(throat|wrists?))\b/i,                                     category: 'violence_threat', reason: 'Threats of violence are not allowed.',   severity: 'critical' },
];
const SELF_HARM_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(kill\s*your\s*self|kys|go\s*die|end\s*your\s*life|commit\s*suicide)\b/i,                   category: 'self_harm', reason: 'Encouraging self-harm is strictly prohibited.', severity: 'critical' },
  { pattern: /\b(you\s*should\s*(just\s*)?(die|end\s*it|kill\s*yourself))\b/i,                              category: 'self_harm', reason: 'Encouraging self-harm is strictly prohibited.', severity: 'critical' },
  { pattern: /\b(the\s*world\s*(would\s*be\s*)?(better|best)\s*without\s*you)\b/i,                         category: 'self_harm', reason: 'Encouraging self-harm is strictly prohibited.', severity: 'critical' },
  { pattern: /\b(nobody\s*(would\s*)?miss\s*you)\b/i,                                                       category: 'self_harm', reason: 'Encouraging self-harm is strictly prohibited.', severity: 'critical' },
  { pattern: /\b(do\s*(us|everyone)\s*a\s*favor\s*and\s*die)\b/i,                                           category: 'self_harm', reason: 'Encouraging self-harm is strictly prohibited.', severity: 'critical' },
];
const HATE_PATTERNS: HarmfulPattern[] = [
  { pattern: /\bn[i1][g9]{1,2}[e3a@]r?s?\b/i,                                                              category: 'racial_slur',      reason: 'Hate speech is not allowed.',           severity: 'critical' },
  { pattern: /\bf[a@4][g9]{1,2}[o0]ts?\b/i,                                                                category: 'homophobic_slur',  reason: 'Homophobic language is not allowed.',   severity: 'critical' },
  { pattern: /\br[e3]t[a@]rd(ed|s)?\b/i,                                                                   category: 'hate_speech',      reason: 'Derogatory language is not allowed.',   severity: 'high'     },
  { pattern: /\b(tr[a@]nn[yi](es|s)?)\b/i,                                                                 category: 'homophobic_slur',  reason: 'Derogatory language is not allowed.',   severity: 'high'     },
  { pattern: /\b(chink|sp[i1]c|wet\s*back|k[i1]ke|cr[a@]cker|g[o0]{2}k)\b/i,                             category: 'racial_slur',      reason: 'Hate speech is not allowed.',           severity: 'critical' },
  { pattern: /\b(dyke|lesbo|homo|queer\s*bait)\b/i,                                                        category: 'homophobic_slur',  reason: 'Homophobic language is not allowed.',   severity: 'high'     },
  { pattern: /\b(d[iy1]k[e3]|sh[e3]\s*m[a@]l[e3])\b/i,                                                   category: 'homophobic_slur',  reason: 'Homophobic language is not allowed.',   severity: 'high'     },
  { pattern: /\b(no\s*homo)\b/i,                                                                            category: 'homophobic_slur',  reason: 'Homophobic language is not allowed.',   severity: 'medium'   },
  { pattern: /\b(maldito|puta\s*madre|hijo\s*de\s*puta|maricon|pinche)\b/i,                               category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(connard|salope|bamboula|enculé|nique\s*ta\s*mère|batard)\b/i,                            category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(scheiß(e|er)|hurensohn|wichser|kanake|missgeburt)\b/i,                                   category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(viado|porra|filho\s*da\s*puta|macaco|arrombado|cuzão)\b/i,                               category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(stronzo|vaffanculo|cazzo|minchia|puttana)\b/i,                                            category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(blyad|pizda|khuy|suka|pidar|nahui|eblan)\b/i,                                            category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(kurwa|chuj|jebac)\b/i,                                                                    category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(orospu|amına|siktir|piç)\b/i,                                                             category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(kuss\s*ummak|ya\s*kalb|sharmut|ibn\s*el?\s*sharmu)/i,                                   category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(madarchod|bhenchod|chutiya|harami|kamina|randi|kutte)\b/i,                               category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(kichiku|baka\s*gaijin|kono\s*yaro|kisama)\b/i,                                           category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(sibal|ssibal|gaeseki|byeongsin)\b/i,                                                     category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(tmd|cnm|nmsl|wdnmd|cao\s*ni\s*ma)\b/i,                                                  category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(kanker|tering|tyfus|godverdomme|kutwijf|hoer)\b/i,                                       category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(jävla|fitta|hora|knulla|skit)\b/i,                                                       category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(malaka|poustis|gamoto|skata)\b/i,                                                        category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
  { pattern: /\b(pula|fututi|muie|cacat|curva)\b/i,                                                       category: 'hate_multilang',   reason: 'Hate speech is not allowed.',           severity: 'high'     },
];
const SCAM_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(send\s*(me\s*)?(money|\$\d+|bitcoin|crypto|gift\s*cards?|btc|eth|usdt|usdc))\b/i,          category: 'scam',                  reason: 'Requesting money or crypto is not allowed.',  severity: 'high'   },
  { pattern: /\b(cash\s*app|venmo|zelle|paypal|western\s*union)\s*(me|:\s*\S+|transfer|send)\b/i,           category: 'financial_solicitation', reason: 'Financial solicitation is not allowed.',      severity: 'high'   },
  { pattern: /\b(sugar\s*(daddy|mama|mommy)\s*(needed|wanted|looking))\b/i,                                  category: 'financial_solicitation', reason: 'Financial solicitation is not allowed.',      severity: 'medium' },
  { pattern: /\b(guaranteed\s*(returns?|profits?|income)|invest\s*(with\s*me|now|today))\b/i,               category: 'investment_scam',        reason: 'Investment scam language is not allowed.',    severity: 'high'   },
  { pattern: /\b(i\s*can\s*(double|triple|10x)\s*your\s*(money|investment|crypto|bitcoin))\b/i,             category: 'investment_scam',        reason: 'Investment scam language is not allowed.',    severity: 'high'   },
  { pattern: /\b(blockchain|forex|trading\s*bot|passive\s*income)\s*(opportunity|platform|account)\b/i,     category: 'investment_scam',        reason: 'Investment solicitation is not allowed.',     severity: 'medium' },
  { pattern: /\b(wallet\s*address|0x[a-fA-F0-9]{40}|[13][a-zA-Z0-9]{25,34})\b/,                           category: 'crypto_address',         reason: 'Sharing crypto wallet addresses is not allowed.',severity: 'high' },
];
const DRUG_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(sell(ing)?\s*(weed|meth|coke|cocaine|heroin|pills?|drugs?|molly|ecstasy|mdma|lsd|shrooms?|fentanyl|oxy|xanax))\b/i, category: 'drug_dealing', reason: 'Drug-related content is not allowed.', severity: 'critical' },
  { pattern: /\b(buy|get|hook\s*(me\s*)?up\s*with)\s*(drugs?|weed|coke|meth|pills?|dope|gear)\b/i,                                  category: 'drug_dealing', reason: 'Drug-related content is not allowed.', severity: 'critical' },
  { pattern: /\b(plug|dealer|connect)\s*(for\s*)?(weed|coke|meth|molly|pills?|dope)\b/i,                                            category: 'drug_dealing', reason: 'Drug-related content is not allowed.', severity: 'critical' },
  { pattern: /\b(hmu\s*for\s*(weed|gas|loud|bud|pack|pills?))\b/i,                                                                  category: 'drug_dealing', reason: 'Drug-related content is not allowed.', severity: 'critical' },
  { pattern: /\b(i\s*(got|have|sell)\s*(loud|gas|za|pack|zip|qp|pound))\b/i,                                                        category: 'drug_dealing', reason: 'Drug-related content is not allowed.', severity: 'critical' },
  { pattern: /(\u{1F33F}|\u{1F4A8}|\u{2744}|\u{1F48A}|\u{1F344}|\u{1F9EA})\s*(for\s*sale|available|dm\s*me|hmu)/u,                 category: 'drug_emoji',   reason: 'Drug-related content is not allowed.', severity: 'high'     },
];
const UNDERAGE_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(i['']?m\s*(1[0-7]|[1-9])\s*(years?\s*old|yo|y\/o))\b/i,                       category: 'underage', reason: 'Users must be 18 or older.',                        severity: 'critical' },
  { pattern: /\b(looking\s*for\s*(younger|teen|minor|underage))\b/i,                             category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
  { pattern: /\b(minors?\s*(welcome|ok|okay)|teens?\s*(only|preferred))\b/i,                     category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
  { pattern: /\b(age\s*is\s*(just\s*a\s*number|no\s*matter))\b/i,                               category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
  { pattern: /\b(jailbait|lolita|shota)\b/i,                                                     category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
  { pattern: /\b(cp|child\s*p[o0]rn)\b/i,                                                        category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
  { pattern: /\b(preteen|pre-teen|tween)\b/i,                                                    category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
  { pattern: /\b(barely\s*legal|just\s*turned\s*1[0-8])\b/i,                                    category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
  { pattern: /\b(high\s*school\s*(student|girl|boy|kid))\b/i,                                   category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
  { pattern: /\b(18\s*and\s*under|under\s*18|u18|u\/18)\b/i,                                    category: 'underage', reason: 'Users must be 18 or older.',                        severity: 'critical' },
  { pattern: /\b(dd\/lg|ddlg|agere|little\s*space|caregiver\s*little)\b/i,                      category: 'underage', reason: 'Content involving minors is strictly prohibited.',   severity: 'critical' },
];
const SPAM_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(bit\.ly|tinyurl|click\s*here|free\s*money|won\s*a\s*prize|congratulations\s*you\s*won)\b/i, category: 'spam',      reason: 'Spam content is not allowed.',     severity: 'medium' },
  { pattern: /https?:\/\/[^\s]{0,20}\.(tk|ml|ga|cf|gq)\b/i,                                                  category: 'spam_link', reason: 'Suspicious links are not allowed.', severity: 'high'   },
  { pattern: /\b(earn\s*\$\d+|work\s*from\s*home|make\s*money\s*fast|get\s*rich)\b/i,                       category: 'spam',      reason: 'Spam content is not allowed.',     severity: 'medium' },
];
const CONTACT_PATTERNS: HarmfulPattern[] = [
  { pattern: PHONE_REGEX, category: 'contact_info_phone', reason: 'Sharing phone numbers is not allowed. Use in-app chat.',    severity: 'medium' },
  { pattern: EMAIL_REGEX, category: 'contact_info_email', reason: 'Sharing email addresses is not allowed. Use in-app chat.',  severity: 'medium' },
];
const SOCIAL_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(my\s*)?(snap(chat)?|insta(gram)?|ig|tiktok|tt|telegram|tg|whatsapp|wa|line|kik|discord)\s*(is|:|\s)\s*@?[\w.]+/i, category: 'social_handle', reason: 'Please keep conversations in-app for your safety.', severity: 'low'  },
  { pattern: /\b(add\s*me\s*(on|at)?|find\s*me\s*(on|at)?|dm\s*me\s*(on)?)\s*(snap|insta|tiktok|telegram|whatsapp|discord)\b/i,    category: 'social_handle', reason: 'Please keep conversations in-app.',               severity: 'low'  },
  { pattern: /(\u{1F346}|\u{1F351}|\u{1F353}|\u{1F4A6})\s*(dm|hmu|hit\s*me\s*up|for\s*fun)/u,                                      category: 'sexual_emoji',  reason: 'Explicit content is not allowed.',                severity: 'high' },
  { pattern: /(\u{1F351}|\u{1F346}|\u{1FAD2})\s*(\u{1F346}|\u{1F351}|\u{1F4AF})/u,                                                 category: 'sexual_emoji',  reason: 'Explicit emoji content is not allowed.',          severity: 'high' },
];
const SEXTORTION_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(i\s*have\s*(your\s*)?(photos?|videos?|nudes?|pics?)|i\s*will\s*share\s*(your\s*)?(photos?|videos?))\b/i,  category: 'sextortion', reason: 'Threatening behavior is not allowed.', severity: 'critical' },
  { pattern: /\b(pay\s*me|send\s*(money|crypto|bitcoin)).{0,50}(photos?|videos?|nudes?|expose|leak)\b/i,                  category: 'sextortion', reason: 'Extortion is not allowed.',            severity: 'critical' },
  { pattern: /\b(i['']ll\s*expose|i\s*will\s*expose|going\s*to\s*expose)\s*(you|ur|your)\b/i,                            category: 'sextortion', reason: 'Threatening behavior is not allowed.', severity: 'critical' },
  { pattern: /\b(recorded\s*you|screenshot|screen\s*record).{0,30}(pay|money|send)\b/i,                                  category: 'sextortion', reason: 'Extortion is not allowed.',            severity: 'critical' },
  { pattern: /\b(everyone\s*will\s*see\s*(your\s*)?(nudes?|photos?|videos?)).{0,20}(pay|money|send)\b/i,                 category: 'sextortion', reason: 'Extortion is not allowed.',            severity: 'critical' },
];
const DOXXING_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(i\s*know\s*(where\s*you\s*live|your\s*address|your\s*home|your\s*workplace))\b/i,              category: 'doxxing', reason: 'Sharing personal info is not allowed.',        severity: 'critical' },
  { pattern: /\b(ssn|social\s*security\s*number|credit\s*card\s*number|passport\s*number)\s*:?\s*[\d\-]+/i,     category: 'pii',     reason: 'Sharing PII is not allowed.',                  severity: 'critical' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/,                                                                           category: 'pii',     reason: 'Sharing PII is not allowed.',                  severity: 'critical' },
  { pattern: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/,                                                 category: 'pii',     reason: 'Sharing financial information is not allowed.', severity: 'critical' },
  { pattern: /\b(doxx?(ed|ing)?|swatt?(ed|ing)?)\b/i,                                                           category: 'doxxing', reason: 'Doxxing is not allowed.',                      severity: 'critical' },
  { pattern: /\b(i('ll|m\s*going\s*to)\s*(find|track|hunt)\s*(you|them|him|her)\s*(down)?)\b/i,                category: 'doxxing', reason: 'Threatening language is not allowed.',          severity: 'critical' },
  { pattern: /\b(posting\s*(their|his|her|your)\s*(info|details|address|number))\b/i,                           category: 'doxxing', reason: 'Sharing personal info is not allowed.',        severity: 'critical' },
];
const COERCIVE_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(you\s*(have\s*to|must|need\s*to|will)\s*(do\s*this|obey|listen\s*to\s*me|comply))\b/i,      category: 'coercive', reason: 'Controlling language is not allowed.',         severity: 'medium' },
  { pattern: /\b(if\s*you\s*(don['']?t|refuse|won['']?t).{0,40}(i['']ll|i\s*will|you['']ll\s*regret))\b/i,  category: 'coercive', reason: 'Threatening language is not allowed.',         severity: 'high'   },
  { pattern: /\b(you['']re\s*(nothing|worthless|stupid|pathetic)\s*without\s*me)\b/i,                         category: 'coercive', reason: 'Emotionally abusive language is not allowed.', severity: 'high'   },
  { pattern: /\b(nobody\s*(else\s*)?(will|would)\s*(ever\s*)?(love|want|date)\s*you)\b/i,                     category: 'coercive', reason: 'Emotionally abusive language is not allowed.', severity: 'high'   },
  { pattern: /\b(give\s*me\s*your\s*password|let\s*me\s*(check|see)\s*your\s*(phone|messages?))\b/i,         category: 'coercive', reason: 'Controlling language is not allowed.',         severity: 'medium' },
  { pattern: /\b(you\s*(need|have)\s*to\s*(ask\s*me|get\s*my)\s*(permission|approval))\b/i,                  category: 'coercive', reason: 'Controlling language is not allowed.',         severity: 'medium' },
];
const GROOMING_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(you['']?re\s*so\s*mature\s*for\s*your\s*age|you\s*seem\s*older\s*than\s*you\s*are)\b/i,           category: 'grooming', reason: 'This type of language is not allowed.',      severity: 'critical' },
  { pattern: /\b(keep\s*this\s*(between\s*us|our\s*secret|secret)|don['']?t\s*tell\s*(anyone|your\s*(parents?|friends?|family)))\b/i, category: 'grooming', reason: 'This type of language is not allowed.', severity: 'critical' },
  { pattern: /\b(are\s*you\s*(home\s*)?alone|where\s*are\s*your\s*parents?|is\s*anyone\s*home\s*with\s*you)\b/i,  category: 'grooming', reason: 'This type of language is not allowed.',      severity: 'high'     },
  { pattern: /\b(you\s*can\s*trust\s*me|i['']?m\s*not\s*like\s*(other|those)\s*(guys?|men|people))\b/i,           category: 'grooming', reason: 'This language pattern has been flagged.',    severity: 'medium'   },
  { pattern: /\b(send\s*(me\s*)?a?\s*(pic|photo|selfie).{0,20}just\s*(for|between)\s*(me|us))\b/i,                category: 'grooming', reason: 'This type of language is not allowed.',      severity: 'critical' },
  { pattern: /\b(i('ll)?\s*teach\s*you\s*(about\s*)?(love|sex|relationships?))\b/i,                               category: 'grooming', reason: 'This type of language is not allowed.',      severity: 'critical' },
];
const LOVE_BOMBING_PATTERNS: HarmfulPattern[] = [
  { pattern: /\b(i['']?ve\s*(never\s*)?felt\s*this\s*way\s*about\s*anyone|you['']?re\s*my\s*soulmate)\b/i,                                                    category: 'love_bombing', reason: 'Unusually intense language flagged.', severity: 'low' },
  { pattern: /\b(we\s*were\s*meant\s*to\s*be|destiny|i\s*love\s*you\s*already|i\s*knew\s*(immediately|instantly|right\s*away)\s*you\s*were\s*the\s*one)\b/i, category: 'love_bombing', reason: 'Unusually intense language flagged.', severity: 'low' },
  { pattern: /\b(i['']?ll\s*(do\s*anything|give\s*you\s*everything|be\s*everything)\s*for\s*you)\b/i,                                                         category: 'love_bombing', reason: 'Unusually intense language flagged.', severity: 'low' },
];

export function detectAIGeneratedText(text: string): { likelyAI: boolean; signals: string[] } {
  const signals: string[] = [];
  if (/\b(furthermore|additionally|moreover|in\s*conclusion|therefore)\b/gi.test(text))           signals.push('formal_transitions');
  if (text.length > 100 && !/\b(can't|won't|don't|it's|i'm|i've|i'd|i'll|you're|they're)\b/i.test(text)) signals.push('no_contractions');
  if (text.length > 150 && !/[!?]/.test(text) && text.split('.').length > 3)                     signals.push('overly_formal');
  if (/\b(as an ai|as a language model|i cannot|i am unable to)\b/i.test(text))                  signals.push('ai_disclaimer');
  if (/\b(delve|utilize|leverage|facilitate|comprehensive|multifaceted)\b/gi.test(text))          signals.push('ai_vocabulary');
  if (text.length > 200) {
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const avgLen    = sentences.reduce((s, x) => s + x.length, 0) / (sentences.length || 1);
    if (avgLen > 120) signals.push('long_avg_sentence');
  }
  return { likelyAI: signals.length >= 2, signals };
}

function runPatterns(patterns: HarmfulPattern[], text: string, normalized: string): ModerationResult | null {
  for (const { pattern, category, reason, severity } of patterns) {
    if (pattern.test(normalized) || pattern.test(text)) return { safe: false, reason, flaggedCategories: [category], severity };
  }
  return null;
}

export function detectRacialSlurs(text: string): ModerationResult {
  return runPatterns(HATE_PATTERNS.filter(h => h.category === 'racial_slur'), text, preprocessText(text)) ?? { safe: true, reason: 'OK' };
}
export function detectHomophobicSlurs(text: string): ModerationResult {
  return runPatterns(HATE_PATTERNS.filter(h => h.category === 'homophobic_slur'), text, preprocessText(text)) ?? { safe: true, reason: 'OK' };
}
export function detectSexualSolicitation(text: string): ModerationResult  { return runPatterns(SEXUAL_PATTERNS,    text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }
export function detectViolenceThreats(text: string): ModerationResult     { return runPatterns(VIOLENCE_PATTERNS,  text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }
export function detectSelfHarmEncouragement(text: string): ModerationResult { return runPatterns(SELF_HARM_PATTERNS, text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }
export function detectDrugDealingLanguage(text: string): ModerationResult  { return runPatterns(DRUG_PATTERNS,     text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }
export function detectUnderageReferences(text: string): ModerationResult   { return runPatterns(UNDERAGE_PATTERNS, text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }
export function detectSextortion(text: string): ModerationResult           { return runPatterns(SEXTORTION_PATTERNS, text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }
export function detectDoxxing(text: string): ModerationResult             { return runPatterns(DOXXING_PATTERNS,   text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }
export function detectCoerciveLanguage(text: string): ModerationResult    { return runPatterns(COERCIVE_PATTERNS,  text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }
export function detectGroomingLanguage(text: string): ModerationResult    { return runPatterns(GROOMING_PATTERNS,  text, preprocessText(text)) ?? { safe: true, reason: 'OK' }; }

export function detectMultilingualHateSpeech(text: string): ModerationResult {
  const n        = preprocessText(text);
  const variants = [text, n, normalizeUnicode(text)];
  for (const p of HATE_PATTERNS.filter(h => h.category === 'hate_multilang')) {
    for (const v of variants) { if (p.pattern.test(v)) return { safe: false, reason: p.reason, flaggedCategories: [p.category], severity: p.severity }; }
  }
  return { safe: true, reason: 'OK' };
}

const ALL_HARMFUL_PATTERNS: HarmfulPattern[] = [
  ...SEXUAL_PATTERNS, ...VIOLENCE_PATTERNS, ...SELF_HARM_PATTERNS, ...HATE_PATTERNS,
  ...SCAM_PATTERNS, ...DRUG_PATTERNS, ...UNDERAGE_PATTERNS, ...SPAM_PATTERNS,
  ...CONTACT_PATTERNS, ...SOCIAL_PATTERNS, ...SEXTORTION_PATTERNS,
  ...DOXXING_PATTERNS, ...COERCIVE_PATTERNS, ...GROOMING_PATTERNS, ...LOVE_BOMBING_PATTERNS,
];

const FIELD_SKIP: Partial<Record<ContentField, string[]>> = {
  bug_report: ['contact_info_phone', 'contact_info_email', 'social_handle'],
  occupation:  ['contact_info_phone', 'contact_info_email', 'social_handle', 'love_bombing'],
  match_notes: ['social_handle'],
};

export function checkTextSafety(text: string, field: ContentField = 'general'): ModerationResult {
  if (!text?.trim()) return { safe: true, reason: 'Empty text' };
  if (detectRTLInjection(text))   return { safe: false, reason: 'Text contains invalid direction characters.', flaggedCategories: ['rtl_injection'],         severity: 'high'   };
  if (hasZeroWidthChars(text))    return { safe: false, reason: 'Text contains hidden characters.',           flaggedCategories: ['zero_width_injection'],   severity: 'medium' };
  if (detectMixedScripts(text))   logger.warn('[moderation] Mixed script detected');
  const emoji = detectEmojiSpam(text);
  if (emoji.isSpam) return { safe: false, reason: 'Too many emojis. Please use normal text.', flaggedCategories: ['emoji_spam'], severity: 'low' };
  const emojiCoded = detectEmojiCodedLanguage(text);
  if (emojiCoded.detected) return { safe: false, reason: 'Coded language detected.', flaggedCategories: emojiCoded.matches.map(m => m.category), severity: 'high' };
  const processed = preprocessText(text);
  if (field === 'name' && containsProfanity(processed)) return { safe: false, reason: 'Profanity is not allowed.', flaggedCategories: ['profanity'], severity: 'medium' };
  const skip   = FIELD_SKIP[field] ?? [];
  const result = runPatterns(ALL_HARMFUL_PATTERNS.filter(p => !skip.includes(p.category)), text, processed);
  if (result) return result;
  if (['chat','bio','bio_edit','general'].includes(field) && containsProfanity(processed)) {
    return { safe: false, reason: 'Please keep language appropriate.', flaggedCategories: ['profanity'], severity: 'low' };
  }
  return { safe: true, reason: 'OK' };
}

export function checkFirstMessage(text: string): ModerationResult {
  const base = checkTextSafety(text, 'chat');
  if (!base.safe) return base;
  const p = preprocessText(text);
  if (/\b(sexy|hot|beautiful\s*body|gorgeous\s*body|dtf)\b/i.test(p))                                                            return { safe: false, reason: 'Please keep first messages respectful.', flaggedCategories: ['inappropriate_first_message'], severity: 'medium' };
  if (/\b(send\s*(me\s*)?(a\s*)?(photo|pic|selfie)|you\s*look\s*(so\s*)?(hot|sexy|fuckable))\b/i.test(p))                        return { safe: false, reason: 'Please keep first messages respectful.', flaggedCategories: ['inappropriate_first_message'], severity: 'medium' };
  return { safe: true, reason: 'OK' };
}
export const moderateFirstMessage = checkFirstMessage;

export const moderateChat              = (t: string) => checkTextSafety(t, 'chat');
export const checkChatMessage          = moderateChat;
export const moderateBio               = (t: string) => checkTextSafety(t, 'bio');
export const checkBio                  = moderateBio;
export const moderatePrompt            = (t: string) => checkTextSafety(t, 'prompt');
export const checkPrompt               = moderatePrompt;
export const moderateBugReport         = (t: string) => checkTextSafety(t, 'bug_report');
export const checkBugReport            = moderateBugReport;

export const moderateOccupation = (t: string): ModerationResult => {
  if (!t?.trim()) return { safe: true, reason: 'Empty' };
  if (t.length > 100)        return { safe: false, reason: 'Occupation must be under 100 characters.',           flaggedCategories: ['too_long'],             severity: 'low'    };
  if (hasZeroWidthChars(t))  return { safe: false, reason: 'Text contains hidden characters.',                   flaggedCategories: ['zero_width_injection'], severity: 'medium' };
  if (detectRTLInjection(t)) return { safe: false, reason: 'Text contains invalid direction characters.',        flaggedCategories: ['rtl_injection'],         severity: 'high'   };
  if (/\b(drug\s*dealer|escort|cam\s*(girl|model|boy)|hitman|arms?\s*dealer|assassin|pimp|trafficker|hacker\s*for\s*hire|sugar\s*(daddy|baby)|rent\s*boy|gigolo|stripper)\b/i.test(t)) return { safe: false, reason: 'This occupation description is not appropriate.', flaggedCategories: ['suspicious_occupation'], severity: 'medium' };
  if (PHONE_REGEX.test(t))   return { safe: false, reason: 'Phone numbers are not allowed in occupation.',       flaggedCategories: ['contact_info_phone'],    severity: 'medium' };
  if (EMAIL_REGEX.test(t))   return { safe: false, reason: 'Email addresses are not allowed in occupation.',    flaggedCategories: ['contact_info_email'],    severity: 'medium' };
  if (/https?:\/\/|www\./i.test(t)) return { safe: false, reason: 'Links are not allowed in occupation.',       flaggedCategories: ['spam_link'],             severity: 'medium' };
  if (/\b(snap|insta|ig|tiktok|telegram|whatsapp|discord)\s*(:|is|@)/i.test(t)) return { safe: false, reason: 'Social media handles are not allowed in occupation.', flaggedCategories: ['social_handle'], severity: 'low' };
  if (containsProfanity(preprocessText(t))) return { safe: false, reason: 'Profanity is not allowed in occupation.', flaggedCategories: ['profanity'], severity: 'medium' };
  return checkTextSafety(t, 'occupation');
};
export const checkOccupation = moderateOccupation;

export const moderateReport            = (t: string) => checkTextSafety(t, 'report_reason');
export const checkReportReason         = moderateReport;
export const moderateNote              = (t: string) => checkTextSafety(t, 'match_notes');
export const checkMatchNotes           = moderateNote;
export const moderateReview            = (t: string) => checkTextSafety(t, 'date_review');
export const checkDateReview           = moderateReview;
export const moderateFeedback          = (t: string) => checkTextSafety(t, 'post_date_feedback');
export const checkPostDateFeedback     = moderateFeedback;
export const moderateIcebreaker        = (t: string) => checkTextSafety(t, 'icebreaker');
export const checkIcebreakerAnswer     = moderateIcebreaker;
export const moderateDailyQ            = (t: string) => checkTextSafety(t, 'daily_question');
export const checkDailyQuestionAnswer  = moderateDailyQ;
export const moderateField             = (t: string, field: ContentField = 'general') => checkTextSafety(t, field);
export const validateTextField         = moderateField;

export async function moderateContent(options: {
  images?:       string[];
  texts?:        Array<{ text: string; field?: ContentField }>;
  imageContext?: 'profile' | 'chat' | 'edit' | 'story' | 'video_frame' | 'voice_thumbnail' | 'general';
}): Promise<ModerationResult> {
  const { images = [], texts = [], imageContext = 'general' } = options;
  for (const item of texts) {
    const t = typeof item === 'string' ? item : item.text;
    const f = typeof item === 'string' ? 'general' : (item.field ?? 'general');
    const r = checkTextSafety(t, f as ContentField);
    if (!r.safe) return r;
  }
  for (const img of images) {
    const r = await checkImageSafety(img, imageContext);
    if (!r.safe) return r;
  }
  return { safe: true, reason: 'All content OK' };
}

export function scoreMessageRisk(text: string): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;
  const p = preprocessText(text);
  if (/\b(send\s*money|need\s*money|borrow|loan|help\s*me\s*financially|wire\s*transfer)\b/i.test(p))         { signals.push('financial_request');       score += 40; }
  if (/\b(telegram|whatsapp|signal|move\s*to|let['']s\s*(talk|chat)\s*(on|at|via))\b/i.test(p))               { signals.push('off_platform_redirect');   score += 30; }
  for (const { pattern, category } of LOVE_BOMBING_PATTERNS) { if (pattern.test(p)) { signals.push(category); score += 15; } }
  for (const { pattern, category } of SCAM_PATTERNS)         { if (pattern.test(p) || pattern.test(text)) { signals.push(category); score += 35; } }
  return { score: Math.min(score, 100), signals };
}

export function detectFinancialRequest(text: string): boolean {
  return /\b(send\s*money|venmo|cashapp|zelle|paypal|wire|transfer|bitcoin|crypto|gift\s*card|loan\s*me|lend\s*me|help\s*me\s*(financially|with\s*money))\b/i.test(preprocessText(text));
}
export function detectOffPlatformRedirect(text: string): boolean {
  return /\b(telegram|whatsapp|signal|wechat|line\s*app|kik|snapchat|instagram|move\s*to|continue\s*(on|at|via)|dm\s*me\s*on|text\s*me\s*(at|on))\b/i.test(preprocessText(text));
}

const CLIENT_DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','throwaway.email','yopmail.com',
  'sharklasers.com','dispostable.com','maildrop.cc','trashmail.com','temp-mail.org',
  'fakeinbox.com','getnada.com','emailondeck.com','burnermail.io','tempr.email',
  '10minutemail.com','mailsac.com','guerrillamail.net','guerrillamail.org',
]);
export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return CLIENT_DISPOSABLE_DOMAINS.has(domain);
}

interface ServerModerateResponse { safe?: boolean; category?: string; }

export async function serverModerateText(text: string, authToken: string): Promise<ModerationResult> {
  try {
    const res  = await fetch(`${SERVER_URL}/moderate-text`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ text }) });
    if (!res.ok) return { safe: true, reason: 'Server unavailable' };
    const data = await res.json() as ServerModerateResponse;
    return data.safe
      ? { safe: true,  reason: 'OK' }
      : { safe: false, reason: `Content flagged: ${data.category}`, flaggedCategories: [data.category ?? 'unknown'] };
  } catch (err) { logger.warn('[moderation] Server moderate error:', err); return { safe: true, reason: 'Server check error' }; }
}

export const preScanEncrypt      = serverModerateText;
export const moderateThenEncrypt = serverModerateText;
export const scanBeforeEncrypt   = serverModerateText;
export const checkBioEdit        = (t: string) => checkTextSafety(t, 'bio_edit');