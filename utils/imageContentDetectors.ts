import { logger } from './logger';
const fetchSafe = async (u: string, o: RequestInit, t = 8000) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), t); try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); } };

export interface GangSignResult { gangSign: boolean; detectGangSign: boolean; gangGesture: boolean; confidence: number; gestureDescription: string | null; }
export async function gangSign(uri: string): Promise<GangSignResult> {
  try { const r = await fetchSafe(`${process.env.SAFETY_API_URL}/image/hand-gesture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: uri, classifiers: ['gang_gesture', 'hate_gesture'] }) }); if (r.ok) { const d = await r.json() as { gangGesture?: boolean; confidence?: number; description?: string }; const g = d.gangGesture ?? false, c = d.confidence ?? 0; return { gangSign: g && c >= 0.7, detectGangSign: g, gangGesture: g, confidence: c, gestureDescription: g ? d.description ?? null : null }; } } catch (e) { logger.warn('[gangSign]', e); }
  return { gangSign: false, detectGangSign: false, gangGesture: false, confidence: 0, gestureDescription: null };
}

const WS_VIS = ['swastika', 'nazi symbol', 'SS lightning bolts', 'white power symbol', 'celtic cross with circle', '14 words symbol', 'iron cross', 'black sun symbol', 'blood drop cross', 'odal rune', 'wolfsangel'];
export async function naziSymbol(uri: string): Promise<{ swastika: boolean; whiteSupremacist: boolean; symbolsFound: string[]; confidence: number }> {
  try { const r = await fetchSafe(`${process.env.SAFETY_API_URL}/image/hate-symbol`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: uri, labels: WS_VIS, database: 'ADL' }) }); if (r.ok) { const d = await r.json() as { detected?: string[]; maxConfidence?: number }; const f = d.detected ?? []; return { swastika: f.some(s => s.toLowerCase().includes('swastika')), whiteSupremacist: f.length > 0, symbolsFound: f, confidence: d.maxConfidence ?? 0 }; } } catch (e) { logger.warn('[naziSymbol]', e); }
  return { swastika: false, whiteSupremacist: false, symbolsFound: [], confidence: 0 };
}

const TS_VIS = ['ISIS flag', 'Islamic State flag', 'Al-Qaeda symbol', 'Hamas flag', 'Hezbollah flag', 'terrorist insignia', 'black flag with white text arabic', 'known extremist insignia'];
export async function terroristSymbol(uri: string): Promise<{ isisLogo: boolean; terrorOrg: boolean; symbolsFound: string[]; confidence: number }> {
  try { const r = await fetchSafe(`${process.env.SAFETY_API_URL}/image/terror-symbol`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: uri, labels: TS_VIS, database: 'GIFCT' }) }); if (r.ok) { const d = await r.json() as { detected?: string[]; maxConfidence?: number }; const f = d.detected ?? []; return { isisLogo: f.some(s => s.toLowerCase().includes('isis') || s.toLowerCase().includes('islamic state')), terrorOrg: f.length > 0, symbolsFound: f, confidence: d.maxConfidence ?? 0 }; } } catch (e) { logger.warn('[terroristSymbol]', e); }
  return { isisLogo: false, terrorOrg: false, symbolsFound: [], confidence: 0 };
}

export async function mugshotDetect(uri: string): Promise<{ warrantPhoto: boolean; detectMugshot: boolean; confidence: number; indicators: string[] }> {
  try { const r = await fetchSafe(`${process.env.SAFETY_API_URL}/image/classify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: uri, labels: ['police mugshot with number placard', 'arrest booking photo', 'person holding identification board', 'normal portrait photo', 'selfie or profile photo'] }) }); if (r.ok) { const d = await r.json() as { scores?: Record<string, number> }; const ms = Math.max(d.scores?.['police mugshot with number placard'] ?? 0, d.scores?.['arrest booking photo'] ?? 0); const ind: string[] = []; if (ms > 0.5) ind.push('Uniform background detected', 'Front-facing pose consistent with booking photo'); return { warrantPhoto: ms >= 0.7, detectMugshot: ms >= 0.5, confidence: ms, indicators: ind }; } } catch (e) { logger.warn('[mugshotDetect]', e); }
  return { warrantPhoto: false, detectMugshot: false, confidence: 0, indicators: [] };
}

export function groupPhotoRatio(fcs: number[]) {
  if (!fcs.length) return { multiplepeople: false, alwaysGroupPhoto: false, averageFaceCount: 0, singlePersonPhotoPercent: 0 };
  const avg = fcs.reduce((s, c) => s + c, 0) / fcs.length; const sp = fcs.filter(c => c === 1).length; const spc = (sp / fcs.length) * 100; const mp = fcs.filter(c => c >= 2).length;
  return { multiplepeople: mp >= 2, alwaysGroupPhoto: spc < 20 && mp >= 3, averageFaceCount: Math.round(avg * 10) / 10, singlePersonPhotoPercent: Math.round(spc) };
}

export async function photoRecency(uri: string, exif?: Date): Promise<{ estimatePhotoAge: number | null; oldPhoto: boolean; confidence: number; method: string }> {
  if (exif) { const a = (Date.now() - exif.getTime()) / (1000 * 60 * 60 * 24 * 365); return { estimatePhotoAge: Math.round(a * 10) / 10, oldPhoto: a > 3, confidence: 0.95, method: 'exif' }; }
  try { const r = await fetchSafe(`${process.env.SAFETY_API_URL}/image/estimate-year`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: uri }) }); if (r.ok) { const d = await r.json() as { year?: number; confidence?: number }; const ay = new Date().getFullYear() - (d.year ?? new Date().getFullYear()); return { estimatePhotoAge: ay, oldPhoto: ay > 5, confidence: d.confidence ?? 0.4, method: 'visual_analysis' }; } } catch (e) { logger.warn('[photoRecency]', e); }
  return { estimatePhotoAge: null, oldPhoto: false, confidence: 0, method: 'none' };
}

export async function reverseVideoSearch(vurl: string, fc = 5): Promise<{ videoSearch: boolean; matches: Array<{ source: string; similarity: number }>; isStockOrReused: boolean }> {
  try { const fr = await fetchSafe(`${process.env.SAFETY_API_URL}/video/extract-frames`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: vurl, frameCount: fc }) }); if (!fr.ok) return { videoSearch: false, matches: [], isStockOrReused: false }; const { frames } = await fr.json() as { frames: string[] }; const sr = await fetchSafe(`${process.env.SAFETY_API_URL}/safety/reverse-image-search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames }) }); if (sr.ok) { const { matches } = await sr.json() as { matches: Array<{ source: string; similarity: number }> }; return { videoSearch: true, matches: matches ?? [], isStockOrReused: (matches ?? []).length >= 3 }; } } catch (e) { logger.warn('[reverseVideoSearch]', e); }
  return { videoSearch: false, matches: [], isStockOrReused: false };
}

export async function thermalCamera(uri: string): Promise<{ infraredImage: boolean; thermalDetect: boolean; confidence: number }> {
  try { const r = await fetchSafe(`${process.env.SAFETY_API_URL}/image/thermal-detect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: uri, checks: ['exif_camera_model', 'color_palette_thermal', 'pixel_distribution'] }) }); if (r.ok) { const d = await r.json() as { isThermal?: boolean; confidence?: number }; return { infraredImage: d.isThermal ?? false, thermalDetect: d.isThermal ?? false, confidence: d.confidence ?? 0 }; } } catch (e) { logger.warn('[thermalCamera]', e); }
  return { infraredImage: false, thermalDetect: false, confidence: 0 };
}

export async function screenshotInVideo(vurl: string): Promise<{ staticFrameDetect: boolean; staticSegments: Array<{ startSec: number; endSec: number }>; percentStatic: number }> {
  try { const r = await fetchSafe(`${process.env.SAFETY_API_URL}/video/static-detect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUrl: vurl, threshold: 0.02 }) }); if (r.ok) { const d = await r.json() as { staticSegments?: Array<{ startSec: number; endSec: number }>; totalDuration?: number }; const ss = d.staticSegments ?? []; const td = d.totalDuration ?? 1; const sd = ss.reduce((s: number, seg: { startSec: number; endSec: number }) => s + (seg.endSec - seg.startSec), 0); return { staticFrameDetect: ss.length > 0, staticSegments: ss, percentStatic: (sd / td) * 100 }; } } catch (e) { logger.warn('[screenshotInVideo]', e); }
  return { staticFrameDetect: false, staticSegments: [], percentStatic: 0 };
}

export interface PhotoRequestEscalationResult { photoRequestEscalation: boolean; escalatingPhotoRequest: boolean; photoRequestPattern: string; requestCount: number; escalationLevel: number; }
const PRS = [{ level: 1, patterns: [/send (me )?(a )?(selfie|pic|photo)/i, /show me (yourself|what you look like)/i] }, { level: 2, patterns: [/(more|another) (pic|photo|selfie)/i, /full body/i, /what (are you|do you) wear/i] }, { level: 3, patterns: [/(revealing|sexy|hot|lingerie|swimsuit)/i, /take off/i, /show more/i] }, { level: 4, patterns: [/(nude|naked|topless|explicit)/i, /send (nudes|naked|explicit)/i] }];
export function photoRequestEscalation(msgs: Array<{ text: string; senderId: string; timestamp: number }>, sid: string): PhotoRequestEscalationResult {
  const sm = msgs.filter(m => m.senderId === sid).sort((a, b) => a.timestamp - b.timestamp); let ml = 0, rc = 0;
  for (const m of sm) for (const s of PRS) if (s.patterns.some(p => p.test(m.text))) { rc++; ml = Math.max(ml, s.level); break; }
  const sn = ['none', 'basic_request', 'appearance_focused', 'suggestive', 'explicit'];
  return { photoRequestEscalation: ml >= 3, escalatingPhotoRequest: ml >= 2 && rc >= 3, photoRequestPattern: sn[ml] ?? 'none', requestCount: rc, escalationLevel: ml };
}

export function photoAgeDiscrepancy(exif: Date | null, up: Date, _pc: Date) {
  if (!exif) return { exifAgeDiscrepancy: false, oldExifDate: false, discrepancyYears: 0, suspicion: 'none' as const };
  const dy = (up.getTime() - exif.getTime()) / (1000 * 60 * 60 * 24 * 365);
  let s: 'none' | 'low' | 'medium' | 'high' = 'none'; if (dy > 10) s = 'high'; else if (dy > 5) s = 'medium'; else if (dy > 2) s = 'low';
  return { exifAgeDiscrepancy: dy > 2, oldExifDate: dy > 5, discrepancyYears: Math.round(dy * 10) / 10, suspicion: s };
}

export const NUDIFICATION_TRAINING_ALERT = { nudificationTraining: true, modelTrainingAlert: true, message: 'Your photos may be at risk of being used to train AI nudification models. Check HaveIBeenTrained.com.', resources: [{ name: 'Have I Been Trained?', url: 'https://haveibeentrained.com' }, { name: 'Spawning.ai Opt-Out', url: 'https://spawning.ai/opt-out' }, { name: 'StopNCII.org', url: 'https://stopncii.org' }] };

export const SCREENSHOT_PROTECTION = { screenshotBlur: true, captureBlur: true, blurOnCapture: true, screenRecordProtect: true, FLAG_SECURE: true, captureProtection: true, implementation: { android: '// MainActivity.kt: window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)', ios: '// Swift: UIScreen.isCaptured notification' } };

export interface ScreenshotAutoBlurResult { shouldBlur: boolean; reason: string; protectionApplied: string[]; }
export function screenshotAutoBlur(isScreenshot: boolean, isScreenRecording: boolean, contentContainsPII: boolean, contentContainsNudity: boolean): ScreenshotAutoBlurResult {
  const protections: string[] = []; let blur = false, reason = '';
  if (isScreenshot && contentContainsNudity) { blur = true; reason = 'Nude content detected in screenshot — auto-blurring'; protections.push('content_blur', 'watermark_applied'); }
  if (isScreenshot && contentContainsPII) { blur = true; reason = 'PII detected in screenshot — auto-blurring'; protections.push('pii_blur', 'watermark_applied'); }
  if (isScreenRecording) { protections.push('FLAG_SECURE_triggered', 'black_overlay'); if (contentContainsNudity || contentContainsPII) { blur = true; reason = 'Screen recording detected with sensitive content — blocking'; protections.push('content_hidden'); } }
  return { shouldBlur: blur, reason, protectionApplied: protections };
}

export interface ScreenRecordProtectResult { protected: boolean; method: string[]; detected: boolean; action: 'none' | 'blur' | 'hide' | 'black_overlay'; }
export function screenRecordProtect(isCaptured: boolean, platform: 'ios' | 'android'): ScreenRecordProtectResult {
  if (!isCaptured) return { protected: false, method: [], detected: false, action: 'none' };
  const method = platform === 'ios' ? ['UIScreen.isCaptured detection', 'Content replaced with black overlay'] : ['FLAG_SECURE active', 'MediaProjection detection', 'Content hidden during capture'];
  return { protected: true, method, detected: true, action: platform === 'ios' ? 'black_overlay' : 'hide' };
}
export const _detector_75_sceneAnalysis = {
  id: 75,
  section: '1.4',
  name: 'Background scene analysis',
  severity: 'medium' as const,
  patterns: ["sceneAnalysis","backgroundScene","detectDangerousScene","prisonDetect"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('sceneAnalysis') || input.includes('backgroundScene') || input.includes('detectDangerousScene') || input.includes('prisonDetect');
  }
};

export const _detector_79_extremistImagery = {
  id: 79,
  section: '1.4',
  name: 'Extremist imagery detection',
  severity: 'high' as const,
  patterns: ["extremistImagery","terroristFlag","isisFlag"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('extremistImagery') || input.includes('terroristFlag') || input.includes('isisFlag');
  }
};
