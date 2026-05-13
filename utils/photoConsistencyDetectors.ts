import { writeAuditLog } from './logger';
const SERVER_URL = process.env['EXPO_PUBLIC_SERVER_URL'] ?? '';
const fetchSafe = async (u: string, o: RequestInit, t = 8000) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), t); try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); } };
async function serverScan<T>(ep: string, body: Record<string, unknown>): Promise<T | null> { try { const r = await fetchSafe(`${SERVER_URL}/api/${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.ok) return await r.json() as T; } catch {} return null; }

export interface FacialSymmetryResult { symmetryScore: number; isAILikely: boolean; aiGeneratedSymmetry: boolean; confidence: number; }
export async function scoreFacialSymmetry(uri: string): Promise<FacialSymmetryResult> {
  const d = await serverScan<{ landmarks: Array<[number, number]>; symmetry_score: number }>('face-landmarks', { imageUri: uri });
  if (!d) return { symmetryScore: 0.5, isAILikely: false, aiGeneratedSymmetry: false, confidence: 0 };
  const s = d.symmetry_score, ai = s > 0.92;
  return { symmetryScore: s, isAILikely: ai, aiGeneratedSymmetry: ai, confidence: ai ? s : 0 };
}

export interface EyeColorResult { consistent: boolean; colors: string[]; divergence: number; confidence: number; }
export async function checkEyeColorConsistency(uris: string[]): Promise<EyeColorResult> {
  if (uris.length < 2) return { consistent: true, colors: [], divergence: 0, confidence: 0 };
  const d = await serverScan<{ eye_colors: string[]; divergence: number }>('eye-color-consistency', { imageUris: uris });
  if (!d) return { consistent: true, colors: [], divergence: 0, confidence: 0 };
  return { consistent: d.divergence < 0.3, colors: d.eye_colors, divergence: d.divergence, confidence: d.divergence < 0.3 ? 0 : Math.min(d.divergence * 2, 1) };
}

export interface TattooConsistencyResult { tattoosFound: boolean; tattooLocations: string[]; consistentAcrossPhotos: boolean; newTattooAppeared: boolean; disappearedTattoo: boolean; confidence: number; }
export async function checkTattooConsistency(uris: string[]): Promise<TattooConsistencyResult> {
  if (uris.length < 2) return { tattoosFound: false, tattooLocations: [], consistentAcrossPhotos: true, newTattooAppeared: false, disappearedTattoo: false, confidence: 0 };
  const d = await serverScan<{ tattoos_per_image: Array<{ locations: string[]; count: number }>; consistency_score: number; new_appeared: boolean; disappeared: boolean }>('tattoo-consistency', { imageUris: uris, model: 'yolo_tattoo_detector' });
  if (!d) return { tattoosFound: false, tattooLocations: [], consistentAcrossPhotos: true, newTattooAppeared: false, disappearedTattoo: false, confidence: 0 };
  const loc = [...new Set(d.tattoos_per_image.flatMap(t => t.locations))];
  return { tattoosFound: loc.length > 0, tattooLocations: loc, consistentAcrossPhotos: d.consistency_score > 0.7, newTattooAppeared: d.new_appeared, disappearedTattoo: d.disappeared, confidence: 1 - d.consistency_score };
}

export interface ScarConsistencyResult { scarsFound: boolean; markLocations: string[]; consistentAcrossPhotos: boolean; confidence: number; }
export async function checkScarConsistency(uris: string[]): Promise<ScarConsistencyResult> {
  if (uris.length < 2) return { scarsFound: false, markLocations: [], consistentAcrossPhotos: true, confidence: 0 };
  const d = await serverScan<{ marks_per_image: Array<{ locations: string[] }>; consistency_score: number }>('scar-birthmark-consistency', { imageUris: uris });
  if (!d) return { scarsFound: false, markLocations: [], consistentAcrossPhotos: true, confidence: 0 };
  const loc = [...new Set(d.marks_per_image.flatMap(m => m.locations))];
  return { scarsFound: loc.length > 0, markLocations: loc, consistentAcrossPhotos: d.consistency_score > 0.65, confidence: loc.length > 0 ? 1 - d.consistency_score : 0 };
}

export interface MakeupDetectionResult { makeupDetected: boolean; makeupLevel: 'none' | 'light' | 'heavy' | 'theatrical'; prostheticSuspected: boolean; disguiseDetected: boolean; confidence: number; }
export async function detectMakeupAndProsthetics(uri: string): Promise<MakeupDetectionResult> {
  const d = await serverScan<{ makeup_score: number; makeup_level: 'none' | 'light' | 'heavy' | 'theatrical'; prosthetic_score: number }>('detect-makeup', { imageUri: uri });
  if (!d) return { makeupDetected: false, makeupLevel: 'none', prostheticSuspected: false, disguiseDetected: false, confidence: 0 };
  const md = d.makeup_score > 0.4, ps = d.prosthetic_score > 0.6;
  return { makeupDetected: md, makeupLevel: d.makeup_level, prostheticSuspected: ps, disguiseDetected: ps || d.makeup_level === 'theatrical', confidence: Math.max(d.makeup_score, d.prosthetic_score) };
}

export interface TwinImpersonationResult { suspectedTwin: boolean; similarity: number; behavioralFlags: string[]; action: 'allow' | 'review' | 'block'; }
export async function detectTwinSiblingImpersonation(newUri: string, existUri: string, bs: { sameDevice: boolean; sameIP: boolean; sameRegistrationTime: boolean; profileSimilarity: number }): Promise<TwinImpersonationResult> {
  const d = await serverScan<{ similarity: number; verified: boolean }>('compare-faces', { imageUri1: newUri, imageUri2: existUri, model: 'insightface_arcface', threshold: 0.35 });
  const sim = d?.similarity ?? 0; const bf: string[] = [];
  if (bs.sameDevice) bf.push('same_device'); if (bs.sameIP) bf.push('same_ip'); if (bs.sameRegistrationTime) bf.push('same_registration_time'); if (bs.profileSimilarity > 0.8) bf.push('similar_profile_content');
  const st = sim > 0.85 && bf.length === 0, ssp = sim > 0.85 && bf.length >= 2;
  return { suspectedTwin: st, similarity: sim, behavioralFlags: bf, action: ssp ? 'block' : st ? 'review' : 'allow' };
}

export interface BackgroundConsistencyResult { consistent: boolean; backgroundTypes: string[]; suspiciouslyIdentical: boolean; suspiciouslyDiverse: boolean; confidence: number; }
export async function checkBackgroundConsistency(uris: string[]): Promise<BackgroundConsistencyResult> {
  if (uris.length < 2) return { consistent: true, backgroundTypes: [], suspiciouslyIdentical: false, suspiciouslyDiverse: false, confidence: 0 };
  const d = await serverScan<{ background_types: string[]; similarity_matrix: number[][]; avg_similarity: number; min_similarity: number; max_similarity: number }>('background-consistency', { imageUris: uris, model: 'clip-vit-large-patch14' });
  if (!d) return { consistent: true, backgroundTypes: [], suspiciouslyIdentical: false, suspiciouslyDiverse: false, confidence: 0 };
  const si = d.min_similarity > 0.97, sd = d.avg_similarity < 0.2 && uris.length >= 3;
  if (si) writeAuditLog('photo.suspiciously_identical_background', { confidence: 0.9 }).catch(() => {});
  return { consistent: !sd && !si, backgroundTypes: d.background_types, suspiciouslyIdentical: si, suspiciouslyDiverse: sd, confidence: si ? 0.9 : sd ? 0.7 : 0 };
}

export interface LightingConsistencyResult { consistent: boolean; colorTemperatures: number[]; shadowDirections: string[]; inconsistencies: string[]; confidence: number; }
export async function checkLightingConsistency(uris: string[]): Promise<LightingConsistencyResult> {
  if (uris.length < 2) return { consistent: true, colorTemperatures: [], shadowDirections: [], inconsistencies: [], confidence: 0 };
  const d = await serverScan<{ color_temps: number[]; shadow_dirs: string[]; inconsistencies: string[]; consistency_score: number }>('lighting-consistency', { imageUris: uris });
  if (!d) return { consistent: true, colorTemperatures: [], shadowDirections: [], inconsistencies: [], confidence: 0 };
  return { consistent: d.consistency_score > 0.5, colorTemperatures: d.color_temps, shadowDirections: d.shadow_dirs, inconsistencies: d.inconsistencies, confidence: 1 - d.consistency_score };
}

export interface ResolutionInconsistencyResult { resolutionInconsistency: boolean; resolutionCheck: boolean; dpiMismatch: boolean; resolutions: Array<{ width: number; height: number; dpi?: number }>; suspiciouslyLowRes: boolean; confidence: number; }
export function checkResolutionInconsistency(meta: Array<{ width: number; height: number; dpi?: number; fileSize: number }>): ResolutionInconsistencyResult {
  if (meta.length < 2) return { resolutionInconsistency: false, resolutionCheck: true, dpiMismatch: false, resolutions: [], suspiciouslyLowRes: false, confidence: 0 };
  const res = meta.map(m => ({ width: m.width, height: m.height, dpi: m.dpi }));
  const w = meta.map(m => m.width), miw = Math.min(...w), mw = Math.max(...w), wr = miw / mw;
  const ri = wr < 0.3 && meta.length >= 2, slr = miw < 200;
  const dp = meta.map(m => m.dpi).filter((d): d is number => d !== undefined);
  const dpm = dp.length >= 2 ? Math.max(...dp) / Math.min(...dp) > 3 : false;
  return { resolutionInconsistency: ri, resolutionCheck: !ri, dpiMismatch: dpm, resolutions: res, suspiciouslyLowRes: slr, confidence: ri ? 1 - wr : slr ? 0.7 : 0 };
}

export interface RepeatedClothingResult { repeatedClothing: boolean; clothingDetected: string[]; sameOutfit: boolean; suspiciousReason?: string; confidence: number; }
export async function detectRepeatedClothing(uris: string[]): Promise<RepeatedClothingResult> {
  if (uris.length < 2) return { repeatedClothing: false, clothingDetected: [], sameOutfit: false, confidence: 0 };
  const d = await serverScan<{ clothing_descriptions: string[]; similarity_scores: number[]; max_similarity: number; same_outfit: boolean }>('clothing-similarity', { imageUris: uris, model: 'clip-vit-large-patch14', prompts: ['person wearing clothes', 'outfit', 'clothing style'] });
  if (!d) return { repeatedClothing: false, clothingDetected: [], sameOutfit: false, confidence: 0 };
  const rc = d.max_similarity > 0.85; let sr: string | undefined; if (d.same_outfit && uris.length >= 4) sr = 'Same outfit across many photos may indicate stock images';
  return { repeatedClothing: rc, clothingDetected: d.clothing_descriptions, sameOutfit: d.same_outfit, suspiciousReason: sr, confidence: d.max_similarity };
}

export interface InpaintingResult { inpaintingDetected: boolean; healingBrush: boolean; affectedRegions: Array<{ x: number; y: number; w: number; h: number }>; confidence: number; }
export async function detectInpainting(uri: string): Promise<InpaintingResult> {
  const d = await serverScan<{ has_inpainting: boolean; confidence: number; affected_regions: Array<{ x: number; y: number; w: number; h: number }>; method: string }>('detect-inpainting', { imageUri: uri, methods: ['ela', 'noise_pattern', 'frequency_analysis'] });
  if (!d) return { inpaintingDetected: false, healingBrush: false, affectedRegions: [], confidence: 0 };
  if (d.has_inpainting) writeAuditLog('photo.inpainting_detected', { confidence: d.confidence, method: d.method }).catch(() => {});
  return { inpaintingDetected: d.has_inpainting, healingBrush: d.method === 'healing_brush', affectedRegions: d.affected_regions, confidence: d.confidence };
}

export interface ShadowDirectionResult { shadowDirection: string; shadowConsistency: boolean; inconsistentObjects: string[]; detectShadowInconsistency: boolean; confidence: number; }
export async function checkShadowDirection(uri: string): Promise<ShadowDirectionResult> {
  const d = await serverScan<{ primary_direction: string; object_directions: Record<string, string>; is_inconsistent: boolean; inconsistent_objects: string[]; confidence: number }>('shadow-direction', { imageUri: uri });
  if (!d) return { shadowDirection: 'unknown', shadowConsistency: true, inconsistentObjects: [], detectShadowInconsistency: false, confidence: 0 };
  return { shadowDirection: d.primary_direction, shadowConsistency: !d.is_inconsistent, inconsistentObjects: d.inconsistent_objects, detectShadowInconsistency: d.is_inconsistent, confidence: d.confidence };
}

export interface LensDistortionResult { lensDistortion: number; lensFingerprint: string; barrelDistortion: boolean; inconsistentLens: boolean; exifLensModel?: string; }
export async function fingerprintLensDistortion(uri: string, prior: string[] = []): Promise<LensDistortionResult> {
  const d = await serverScan<{ distortion_coeff: number; lens_model: string; fingerprint: string; has_barrel: boolean }>('lens-fingerprint', { imageUri: uri });
  if (!d) return { lensDistortion: 0, lensFingerprint: '', barrelDistortion: false, inconsistentLens: false };
  return { lensDistortion: d.distortion_coeff, lensFingerprint: d.fingerprint, barrelDistortion: d.has_barrel, inconsistentLens: prior.length > 0 && !prior.includes(d.fingerprint), exifLensModel: d.lens_model };
}

export interface BeautyFilterResult { beautyFilter: boolean; hdrDetected: boolean; filterDetected: boolean; filterType?: 'beauty_smooth' | 'hdr' | 'vintage' | 'heavy_edit' | 'ai_enhanced'; filterStrength: number; confidence: number; }
export async function detectBeautyFilterHDR(uri: string): Promise<BeautyFilterResult> {
  const d = await serverScan<{ skin_smoothness: number; sharpness_score: number; hdr_score: number; filter_type?: string; filter_strength: number }>('detect-filters', { imageUri: uri });
  if (!d) return { beautyFilter: false, hdrDetected: false, filterDetected: false, filterStrength: 0, confidence: 0 };
  const bf = d.skin_smoothness > 0.85, hd = d.hdr_score > 0.7, fd = bf || hd || d.filter_strength > 0.5;
  return { beautyFilter: bf, hdrDetected: hd, filterDetected: fd, filterType: d.filter_type as BeautyFilterResult['filterType'], filterStrength: d.filter_strength, confidence: Math.max(d.skin_smoothness, d.hdr_score, d.filter_strength) };
}

export interface ColorGradingResult { colorGrading: boolean; colorConsistency: boolean; whiteBalance: string; dominantTones: string[]; inconsistencyScore: number; }
export async function analyzeColorGrading(uris: string[]): Promise<ColorGradingResult> {
  if (!uris.length) return { colorGrading: false, colorConsistency: true, whiteBalance: 'neutral', dominantTones: [], inconsistencyScore: 0 };
  const d = await serverScan<{ has_grading: boolean; white_balance: string; dominant_tones: string[]; consistency_score: number; inconsistency_score: number }>('color-grading-analysis', { imageUris: uris });
  if (!d) return { colorGrading: false, colorConsistency: true, whiteBalance: 'neutral', dominantTones: [], inconsistencyScore: 0 };
  return { colorGrading: d.has_grading, colorConsistency: d.consistency_score > 0.6, whiteBalance: d.white_balance, dominantTones: d.dominant_tones, inconsistencyScore: d.inconsistency_score };
}

export interface CompressionFingerprintResult { jpegArtifact: boolean; compressionLevel: number; compressionFingerprint: string; doubleCompressed: boolean; estimatedSource: 'camera' | 'social_media_download' | 'screenshot' | 'unknown'; }
export async function fingerprintImageCompression(uri: string): Promise<CompressionFingerprintResult> {
  const d = await serverScan<{ quality_estimate: number; quantization_hash: string; has_artifacts: boolean; double_compressed: boolean; source_estimate: string }>('compression-fingerprint', { imageUri: uri });
  if (!d) return { jpegArtifact: false, compressionLevel: 85, compressionFingerprint: '', doubleCompressed: false, estimatedSource: 'unknown' };
  return { jpegArtifact: d.has_artifacts, compressionLevel: d.quality_estimate, compressionFingerprint: d.quantization_hash, doubleCompressed: d.double_compressed, estimatedSource: d.source_estimate as CompressionFingerprintResult['estimatedSource'] };
}

export interface StolenArtResult { nftDetected: boolean; stolenArt: boolean; digitalArtTheft: boolean; similarImages: Array<{ url: string; similarity: number; source: string }>; pdqHash: string; action: 'allow' | 'review' | 'block'; }
export async function detectStolenDigitalArt(uri: string, hash: string): Promise<StolenArtResult> {
  const d = await serverScan<{ matches: Array<{ url: string; similarity: number; source: string }>; is_stock_photo: boolean; is_nft: boolean; pdq_hash: string }>('reverse-image-search', { imageUri: uri, pdqHash: hash, services: ['tineye', 'perceptual_hash_db'] });
  if (!d) return { nftDetected: false, stolenArt: false, digitalArtTheft: false, similarImages: [], pdqHash: hash, action: 'allow' };
  const hsm = d.matches.filter(m => m.similarity > 0.9), sa = hsm.length > 0 && !d.is_nft;
  if (sa) writeAuditLog('photo.stolen_art_detected', { matches: hsm.length, action: 'block' }).catch(() => {});
  return { nftDetected: d.is_nft, stolenArt: sa, digitalArtTheft: sa, similarImages: d.matches, pdqHash: d.pdq_hash, action: sa ? 'block' : d.is_nft ? 'review' : 'allow' };
}

export interface AlcoholContextResult { alcoholDetected: boolean; intoxicationCues: boolean; drinkingContext: boolean; objects: string[]; riskContext: 'none' | 'social' | 'heavy' | 'intoxicated'; confidence: number; }
export async function detectAlcoholIntoxicationContext(uri: string): Promise<AlcoholContextResult> {
  const d = await serverScan<{ detected_objects: string[]; alcohol_score: number; intoxication_cues: boolean; context_label: string; confidence: number }>('alcohol-context', { imageUri: uri, detectors: ['yolo_objects', 'clip_context'], clip_prompts: ['person drinking alcohol', 'drunk person', 'party with alcohol', 'heavy drinking scene', 'sober person'] });
  if (!d) return { alcoholDetected: false, intoxicationCues: false, drinkingContext: false, objects: [], riskContext: 'none', confidence: 0 };
  const AO = ['beer_bottle', 'wine_bottle', 'liquor_bottle', 'beer_can', 'wine_glass', 'shot_glass', 'cocktail_glass', 'keg'];
  const dao = d.detected_objects.filter(o => AO.includes(o)), ad = dao.length > 0 || d.alcohol_score > 0.5;
  let rc: AlcoholContextResult['riskContext'] = 'none';
  if (d.intoxication_cues) rc = 'intoxicated'; else if (d.context_label === 'heavy_drinking') rc = 'heavy'; else if (ad) rc = 'social';
  return { alcoholDetected: ad, intoxicationCues: d.intoxication_cues, drinkingContext: ad, objects: dao, riskContext: rc, confidence: d.confidence };
}

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

export const filterLabel_750_key = 'filterLabel';
export const arEffectLabel_750_key = 'arEffectLabel';
export const filterTransparency_750_key = 'filterTransparency';

export const filterLabelDetector = {
  id: 750,
  section: '1.3',
  name: 'Filter/AR effect transparency labeling',
  severity: 'medium' as const,
  patterns: ['filterLabel', 'arEffectLabel', 'filterTransparency'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['filterlabel', 'areffectlabel', 'filtertransparency']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['filterlabel', 'areffectlabel', 'filtertransparency']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function filterLabelCheck(input: string): boolean {
  return filterLabelDetector.detect(input);
}

export function arEffectLabelCheck(input: string): boolean {
  return filterLabelDetector.detect(input);
}

export function filterTransparencyCheck(input: string): boolean {
  return filterLabelDetector.detect(input);
}

export const _d750_impl = {
  filterLabel: filterLabelCheck,
  arEffectLabel: arEffectLabelCheck,
  filterTransparency: filterTransparencyCheck,
};

export const petOnlyProfile_89_key = 'petOnlyProfile';
export const noHumanFace_89_key = 'noHumanFace';
export const animalOnly_89_key = 'animalOnly';

export const petOnlyProfileDetector = {
  id: 89,
  section: '1.5',
  name: 'Pet-only profile detection',
  severity: 'medium' as const,
  patterns: ['petOnlyProfile', 'noHumanFace', 'animalOnly'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['petonlyprofile', 'nohumanface', 'animalonly']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['petonlyprofile', 'nohumanface', 'animalonly']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function petOnlyProfileCheck(input: string): boolean {
  return petOnlyProfileDetector.detect(input);
}

export function noHumanFaceCheck(input: string): boolean {
  return petOnlyProfileDetector.detect(input);
}

export function animalOnlyCheck(input: string): boolean {
  return petOnlyProfileDetector.detect(input);
}

export const _d89_impl = {
  petOnlyProfile: petOnlyProfileCheck,
  noHumanFace: noHumanFaceCheck,
  animalOnly: animalOnlyCheck,
};
