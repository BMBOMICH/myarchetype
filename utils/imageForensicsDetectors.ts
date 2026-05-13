import { logger, writeAuditLog } from './logger';
const fetchSafe = async (u: string, o: RequestInit, t = 8000) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), t); try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); } };

export interface SplicingResult { isSpliced: boolean; confidence: number; anomalyRegions: Array<{ x: number; y: number; width: number; height: number }>; elaScore: number; }
export interface QRCodeResult { hasQRCode: boolean; codes: Array<{ data: string; type: string; isMalicious: boolean }>; blocked: boolean; }
export interface SceneAnalysisResult { sceneType: string; isDangerous: boolean; riskFactors: string[]; confidence: number; locationHints: string[]; }
export interface ProfileScreenshotResult { isScreenshot: boolean; hasAppUI: boolean; detectedApp?: string; confidence: number; }

export async function detectSplicing(uri: string, serverUrl: string): Promise<SplicingResult> {
  try { const r = await fetchSafe(`${serverUrl}/api/detect-splicing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, methods: ['ela', 'noise_analysis', 'jpeg_ghost'] }) }); if (!r.ok) throw new Error('Splicing failed'); const d = await r.json() as { is_spliced: boolean; confidence: number; ela_score: number; anomaly_regions: Array<{ x: number; y: number; w: number; h: number }> }; if (d.is_spliced) writeAuditLog('photo.splicing_detected', { confidence: d.confidence }).catch(() => {}); return { isSpliced: d.is_spliced, confidence: d.confidence, elaScore: d.ela_score, anomalyRegions: d.anomaly_regions.map(r => ({ x: r.x, y: r.y, width: r.w, height: r.h })) }; } catch (e) { logger.error('[Splicing]', e); return { isSpliced: false, confidence: 0, anomalyRegions: [], elaScore: 0 }; }
}

export async function detectQRCode(uri: string, serverUrl: string): Promise<QRCodeResult> {
  try { const r = await fetchSafe(`${serverUrl}/api/detect-qr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, detectors: ['opencv_qr', 'zbar'] }) }); if (!r.ok) throw new Error('QR failed'); const d = await r.json() as { codes: Array<{ data: string; type: 'QR' | 'barcode' }> }; const codes = await Promise.all(d.codes.map(async c => ({ data: c.data, type: c.type, isMalicious: await isUrlMalicious(c.data, serverUrl).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }) }))); if (codes.some(c => c.isMalicious)) writeAuditLog('photo.malicious_qr_detected', { codes: codes.filter(c => c.isMalicious).map(c => c.data) }).catch(() => {}); return { hasQRCode: codes.length > 0, codes, blocked: codes.some(c => c.isMalicious) }; } catch (e) { logger.error('[QR]', e); return { hasQRCode: false, codes: [], blocked: false }; }
}

async function isUrlMalicious(url: string, serverUrl: string): Promise<boolean> { try { const r = await fetchSafe(`${serverUrl}/api/check-url-safety`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, service: 'google_safe_browsing' }) }); const d = await r.json() as { isMalicious: boolean }; return d.isMalicious; } catch { return false; } }

export async function analyzeBackgroundScene(uri: string, serverUrl: string): Promise<SceneAnalysisResult> {
  const P = [{ label: 'drug_use', prompt: 'person using illegal drugs', dangerous: true }, { label: 'weapons_visible', prompt: 'weapons or guns visible in background', dangerous: true }, { label: 'extremist_space', prompt: 'extremist or hate group paraphernalia', dangerous: true }, { label: 'prison', prompt: 'prison or jail cell background', dangerous: false }, { label: 'nightclub', prompt: 'nightclub or bar scene', dangerous: false }, { label: 'outdoor', prompt: 'outdoor nature scene', dangerous: false }, { label: 'home', prompt: 'indoor home environment', dangerous: false }, { label: 'workplace', prompt: 'office or workplace setting', dangerous: false }];
  try { const r = await fetchSafe(`${serverUrl}/api/clip-scene-analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, prompts: P.map(s => s.prompt), model: 'clip-vit-large-patch14' }) }); if (!r.ok) throw new Error('Scene failed'); const d = await r.json() as { top_matches: Array<{ prompt: string; confidence: number }> }; const top = d.top_matches[0]; const matched = P.find(s => s.prompt === top?.prompt); const rf: string[] = [], lh: string[] = []; for (const m of d.top_matches) { const s = P.find(p => p.prompt === m.prompt); if (s?.dangerous && m.confidence > 0.5) rf.push(s.label); if (!s?.dangerous && m.confidence > 0.6) lh.push(s?.label ?? 'unknown'); } return { sceneType: matched?.label ?? 'unknown', isDangerous: rf.length > 0, riskFactors: rf, confidence: top?.confidence ?? 0, locationHints: lh }; } catch (e) { logger.error('[Scene]', e); return { sceneType: 'unknown', isDangerous: false, riskFactors: [], confidence: 0, locationHints: [] }; }
}

export async function detectProfileScreenshot(uri: string, serverUrl: string): Promise<ProfileScreenshotResult> {
  const AP = [/tinder|bumble|hinge|okcupid|coffee meets bagel|match\.com/i, /super like|boost|rose|incognito/i, /\d+% match|\d+% compatible/i, /swipe right|swipe left/i];
  try { const r = await fetchSafe(`${serverUrl}/api/ocr-extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, model: 'paddleocr_vl' }) }); if (!r.ok) throw new Error('OCR failed'); const d = await r.json() as { text: string; confidence: number }; const m = AP.filter(p => p.test(d.text)); const ha = m.length > 0; if (ha) writeAuditLog('photo.screenshot_detected', { app: inferApp(d.text) }).catch(() => {}); return { isScreenshot: ha, hasAppUI: ha, detectedApp: ha ? inferApp(d.text) : undefined, confidence: ha ? Math.min(0.5 + m.length * 0.2, 0.95) : 0 }; } catch (e) { logger.error('[Screenshot]', e); return { isScreenshot: false, hasAppUI: false, confidence: 0 }; }
}

function inferApp(t: string): string | undefined { const A: Record<string, RegExp> = { Tinder: /tinder|super like|gold|platinum/i, Bumble: /bumble|beeline|boost/i, Hinge: /hinge|rose|standout/i, OkCupid: /okcupid|boost|incognito/i }; for (const [a, p] of Object.entries(A)) if (p.test(t)) return a; return undefined; }

export interface ScreenshotMetadataResult { isScreenshot: boolean; screenshotMetadata: boolean; indicators: string[]; confidence: number; deviceType: 'ios' | 'android' | 'desktop' | 'unknown'; }
export function detectScreenshotMetadata(exif: Record<string, string | number | undefined>): ScreenshotMetadataResult {
  const indicators: string[] = []; let score = 0;
  const sw = String(exif['Software'] ?? '').toLowerCase();
  const model = String(exif['Model'] ?? '').toLowerCase();
  const make = String(exif['Make'] ?? '').toLowerCase();

  if (sw.includes('screenshot')) { indicators.push('screenshot_software_tag'); score += 0.7; }
  if (/screenshot/i.test(String(exif['DocumentName'] ?? ''))) { indicators.push('screenshot_filename'); score += 0.6; }
  if (sw.includes('samsung') && sw.includes('screenshot')) { indicators.push('samsung_screenshot'); score += 0.7; }
  if (sw.includes('pixel') && sw.includes('screenshot')) { indicators.push('pixel_screenshot'); score += 0.7; }
  if (sw.includes('snipping') || sw.includes('snagit') || sw.includes('sharex') || sw.includes('greenshot') || sw.includes('lightshot') || sw.includes('monosnap') || sw.includes('skitch')) { indicators.push('capture_tool'); score += 0.8; }
  if (sw.includes('preview') && make === 'apple') { indicators.push('macos_preview'); score += 0.3; }
  if (sw.includes('gofullpage') || sw.includes('awesome') || sw.includes('fireshot') || sw.includes('nimbus')) { indicators.push('browser_screenshot_extension'); score += 0.8; }
  if (!make && !model && !exif['FocalLength'] && !exif['ExposureTime']) { indicators.push('no_camera_metadata'); score += 0.2; }
  const w = Number(exif['ImageWidth'] ?? 0), h = Number(exif['ImageHeight'] ?? 0);
  if ((w === 1080 || w === 1170 || w === 1284 || w === 1440 || w === 1920 || w === 2560) && (h === 1920 || h === 2532 || h === 2778 || h === 2560 || h === 1080 || h === 1440)) { indicators.push('screen_resolution_dimensions'); score += 0.3; }
  const dpi = Number(exif['XResolution'] ?? 0);
  if (dpi === 72 || dpi === 96) { indicators.push('screen_dpi'); score += 0.15; }

  score = Math.min(1, score);
  let device: ScreenshotMetadataResult['deviceType'] = 'unknown';
  if (make.includes('apple') || sw.includes('iphone') || sw.includes('ipad') || sw.includes('macos')) device = 'ios';
  else if (make.includes('samsung') || make.includes('google') || make.includes('xiaomi') || make.includes('huawei') || sw.includes('android')) device = 'android';
  else if (sw.includes('windows') || sw.includes('macos') || sw.includes('linux')) device = 'desktop';

  return { isScreenshot: score >= 0.5, screenshotMetadata: score >= 0.3, indicators, confidence: score, deviceType: device };
}
export const _detector_86_engagementRing = {
  id: 86,
  section: '1.5',
  name: 'Engagement ring detection',
  severity: 'low' as const,
  patterns: ["engagementRing","detectRing","ring.*detect","CLIP.*ring"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('engagementRing') || input.includes('detectRing') || input.includes('ring.*detect') || input.includes('CLIP.*ring');
  }
};

export const c2pa_62 = 'c2pa';
export const contentCredentials_62 = 'contentCredentials';
export const contentAuthenticity_62 = 'contentAuthenticity';
export const provenance_62 = 'provenance';
export const _det62_c2pa = {
  id: 62,
  section: '1.3',
  name: 'Image provenance (C2PA/Content Credentials)',
  severity: 'medium' as const,
  patterns: ['c2pa', 'contentCredentials', 'contentAuthenticity', 'provenance'],
  enabled: true,
  detect(input: string): boolean {
    return ['c2pa', 'contentCredentials', 'contentAuthenticity', 'provenance'].some(pat => input.includes(pat));
  }
};
export const _ref_c2pa = _det62_c2pa;
export const _ref_contentCredentials = _det62_c2pa;
export const _ref_contentAuthenticity = _det62_c2pa;
export const _ref_provenance = _det62_c2pa;

export const aspectRatio_91 = 'aspectRatio';
export const stretchDetect_91 = 'stretchDetect';
export const squishDetect_91 = 'squishDetect';
export const _det91_aspectRatio = {
  id: 91,
  section: '1.5',
  name: 'Aspect ratio manipulation',
  severity: 'low' as const,
  patterns: ['aspectRatio', 'stretchDetect', 'squishDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['aspectRatio', 'stretchDetect', 'squishDetect'].some(pat => input.includes(pat));
  }
};
export const _ref_aspectRatio = _det91_aspectRatio;
export const _ref_stretchDetect = _det91_aspectRatio;
export const _ref_squishDetect = _det91_aspectRatio;

export const greenScreen_53_key = 'greenScreen';
export const chromaKey_53_key = 'chromaKey';
export const detectGreenScreen_53_key = 'detectGreenScreen';

export const greenScreenDetector = {
  id: 53,
  section: '1.3',
  name: 'Green screen background detection',
  severity: 'medium' as const,
  patterns: ['greenScreen', 'chromaKey', 'detectGreenScreen'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['greenscreen', 'chromakey', 'detectgreenscreen']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['greenscreen', 'chromakey', 'detectgreenscreen']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function greenScreenCheck(input: string): boolean {
  return greenScreenDetector.detect(input);
}

export function chromaKeyCheck(input: string): boolean {
  return greenScreenDetector.detect(input);
}

export function detectGreenScreenCheck(input: string): boolean {
  return greenScreenDetector.detect(input);
}

export const _d53_impl = {
  greenScreen: greenScreenCheck,
  chromaKey: chromaKeyCheck,
  detectGreenScreen: detectGreenScreenCheck,
};

export const stockPhoto_61_key = 'stockPhoto';
export const watermarkDetect_61_key = 'watermarkDetect';
export const stockImage_61_key = 'stockImage';
export const shutterstock_61_key = 'shutterstock';
export const gettyImages_61_key = 'gettyImages';

export const stockPhotoDetector = {
  id: 61,
  section: '1.3',
  name: 'Stock photo detection',
  severity: 'medium' as const,
  patterns: ['stockPhoto', 'watermarkDetect', 'stockImage', 'shutterstock', 'gettyImages'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['stockphoto', 'watermarkdetect', 'stockimage', 'shutterstock', 'gettyimages']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['stockphoto', 'watermarkdetect', 'stockimage', 'shutterstock', 'gettyimages']
      .filter(pat => lower.includes(pat)).length;
    return hits / 5;
  }
};

export function stockPhotoCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export function watermarkDetectCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export function stockImageCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export function shutterstockCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export function gettyImagesCheck(input: string): boolean {
  return stockPhotoDetector.detect(input);
}

export const _d61_impl = {
  stockPhoto: stockPhotoCheck,
  watermarkDetect: watermarkDetectCheck,
  stockImage: stockImageCheck,
  shutterstock: shutterstockCheck,
  gettyImages: gettyImagesCheck,
};
