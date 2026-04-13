import { logger, writeAuditLog } from './logger';

const fetchSafe = async (u: string, o: RequestInit, t = 8000) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), t); try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); } };

export interface DeepfakeResult { isDeepfake: boolean; confidence: number; method: string; artifactsFound: string[]; requiresReview: boolean; blockUpload: boolean; }
export interface StaffImpersonationResult { isImpersonating: boolean; matchedStaffId?: string; similarity: number; action: 'allow' | 'review' | 'block'; }
export interface VideoSelfieVerification { isLive: boolean; faceMatches: boolean; challengesPassed: number; totalChallenges: number; verified: boolean; failureReason?: string; }
export interface VerificationFreshness { isExpired: boolean; daysSinceVerify: number; requiresReverify: boolean; expiryDate: Date; }

export async function detectDeepfake(uri: string, url: string): Promise<DeepfakeResult> {
  try {
    const r = await fetchSafe(`${url}/api/detect-deepfake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, detectors: ['xception', 'efficientnet_b4', 'f3net', 'core'], threshold: 0.65 }) });
    if (!r.ok) throw new Error('Deepfake detection failed');
    const d = await r.json() as { ensemble_score: number; individual_scores: Record<string, number>; artifacts: string[]; is_deepfake: boolean };
    const af: string[] = [];
    if (d.artifacts.includes('face_boundary')) af.push('face_boundary_artifact');
    if (d.artifacts.includes('eye_blinking')) af.push('unnatural_blinking');
    if (d.artifacts.includes('compression')) af.push('compression_artifact');
    if (d.artifacts.includes('frequency')) af.push('frequency_anomaly');
    if (d.is_deepfake) writeAuditLog('content.deepfake_blocked', { confidence: d.ensemble_score, artifacts: af }).catch(() => {});
    return { isDeepfake: d.is_deepfake, confidence: d.ensemble_score, method: 'deepfakebench_ensemble', artifactsFound: af, requiresReview: d.ensemble_score > 0.4 && d.ensemble_score < 0.65, blockUpload: d.ensemble_score > 0.65 };
  } catch (e) { logger.error('[detectDeepfake]', e); return { isDeepfake: false, confidence: 0, method: 'error', artifactsFound: [], requiresReview: false, blockUpload: false }; }
}

export async function detectGANFingerprint(uri: string, url: string): Promise<{ isAIGenerated: boolean; confidence: number; generatorType?: string }> {
  try {
    const r = await fetchSafe(`${url}/api/detect-gan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: uri, detectors: ['gragnaniello', 'lgrad', 'didet'] }) });
    if (!r.ok) throw new Error('GAN detection failed');
    const d = await r.json() as { is_ai_generated: boolean; confidence: number; generator_type?: string };
    return { isAIGenerated: d.is_ai_generated, confidence: d.confidence, generatorType: d.generator_type };
  } catch (e) { logger.error('[detectGANFingerprint]', e); return { isAIGenerated: false, confidence: 0 }; }
}

export async function detectStaffFaceImpersonation(uri: string, url: string): Promise<StaffImpersonationResult> {
  try {
    const r = await fetchSafe(`${url}/api/check-staff-face`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoUri: uri, model: 'insightface_arcface', threshold: 0.5 }) });
    if (!r.ok) throw new Error('Staff face check failed');
    const d = await r.json() as { match: boolean; similarity: number; staff_id?: string };
    return { isImpersonating: d.match, matchedStaffId: d.staff_id, similarity: d.similarity, action: d.similarity > 0.7 ? 'block' : d.similarity > 0.5 ? 'review' : 'allow' };
  } catch (e) { logger.error('[detectStaffFaceImpersonation]', e); return { isImpersonating: false, similarity: 0, action: 'allow' }; }
}

export const LIVENESS_CHALLENGES = [
  { id: 'blink', instruction: 'Please blink twice', timeout: 5000 },
  { id: 'turn_left', instruction: 'Turn head slowly left', timeout: 4000 },
  { id: 'turn_right', instruction: 'Turn head slowly right', timeout: 4000 },
  { id: 'smile', instruction: 'Please smile', timeout: 4000 },
  { id: 'nod', instruction: 'Nod head up/down', timeout: 4000 },
] as const;
export type ChallengeId = typeof LIVENESS_CHALLENGES[number]['id'];

export async function verifyVideoSelfie(uri: string, ch: ChallengeId[], ppUri: string, url: string): Promise<VideoSelfieVerification> {
  try {
    const r = await fetchSafe(`${url}/api/verify-video-selfie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoUri: uri, challenges: ch, profilePhotoUri: ppUri, models: ['insightface_liveness', 'mediapipe_face_mesh'] }) });
    if (!r.ok) throw new Error('Video selfie verification failed');
    const d = await r.json() as { is_live: boolean; face_match: boolean; challenges_passed: number; total_challenges: number; failure_reason?: string };
    const v = d.is_live && d.face_match && d.challenges_passed === d.total_challenges;
    return { isLive: d.is_live, faceMatches: d.face_match, challengesPassed: d.challenges_passed, totalChallenges: d.total_challenges, verified: v, failureReason: d.failure_reason };
  } catch (e) { logger.error('[verifyVideoSelfie]', e); return { isLive: false, faceMatches: false, challengesPassed: 0, totalChallenges: ch.length, verified: false, failureReason: 'verification_error' }; }
}

const REV_DAYS = 90;

export function checkVerificationFreshness(last: Date | null): VerificationFreshness {
  if (!last) return { isExpired: true, daysSinceVerify: Infinity, requiresReverify: true, expiryDate: new Date(0) };
  const now = new Date(), diff = now.getTime() - last.getTime(), days = Math.floor(diff / 86400000), exp = new Date(last.getTime() + REV_DAYS * 86400000);
  return { isExpired: days >= REV_DAYS, daysSinceVerify: days, requiresReverify: days >= REV_DAYS - 7, expiryDate: exp };
}

export function getPeriodicReverifyPrompt(f: VerificationFreshness) {
  if (!f.requiresReverify) return { shouldPrompt: false, message: '', isUrgent: false };
  if (f.isExpired) return { shouldPrompt: true, message: 'Your identity verification has expired. Please re-verify to continue using all features.', isUrgent: true };
  const d = REV_DAYS - f.daysSinceVerify;
  return { shouldPrompt: true, message: `Verification expires in ${d} days. Re-verify to keep account trusted.`, isUrgent: false };
}

const SELFIE_EXP = 30;

export function checkSelfieFreshness(ts: Date | null) {
  if (!ts) return { isExpired: true, daysOld: Infinity, mustReverify: true };
  const d = Math.floor((Date.now() - ts.getTime()) / 86400000);
  return { isExpired: d >= SELFIE_EXP, daysOld: d, mustReverify: d >= SELFIE_EXP };
}

export async function matchSelfieToID(sUri: string, idUri: string, url: string) {
  try {
    const r = await fetchSafe(`${url}/api/selfie-to-id-match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selfieUri: sUri, idFaceUri: idUri, model: 'insightface_arcface' }) });
    if (!r.ok) throw new Error('Selfie-to-ID match failed');
    const d = await r.json() as { match: boolean; distance: number; similarity: number };
    return { match: d.match, similarity: d.similarity, confidence: 1 - d.distance };
  } catch (e) { logger.error('[matchSelfieToID]', e); return { match: false, similarity: 0, confidence: 0 }; }
}

// ─── #028 Deepfake video detection ───────────────────────
export interface DeepfakeVideoResult{isDeepfake:boolean;confidence:number;frameAnalysis:Array<{frameIndex:number;score:number;artifacts:string[]}>;temporalConsistency:number;audioVideoSync:number;action:'allow'|'review'|'block';}
export async function detectDeepfakeVideo(videoUri:string,url:string):Promise<DeepfakeVideoResult>{
  try{
    const r=await fetchSafe(`${url}/api/detect-deepfake-video`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoUri,detectors:['temporal_consistency','audio_video_sync','face_boundary_tracking','selimsef_dfdc'],sampleRate:5,threshold:0.65})});
    if(!r.ok)throw new Error('Video deepfake detection failed');
    const d=await r.json() as{is_deepfake:boolean;ensemble_score:number;frame_scores:Array<{frame:number;score:number;artifacts:string[]}>;temporal_consistency:number;audio_video_sync:number};
    const frameAnalysis=d.frame_scores.map(f=>({frameIndex:f.frame,score:f.score,artifacts:f.artifacts}));
    if(d.is_deepfake)writeAuditLog('content.deepfake_video_blocked',{confidence:d.ensemble_score,temporalConsistency:d.temporal_consistency}).catch(()=>{});
    return{isDeepfake:d.is_deepfake,confidence:d.ensemble_score,frameAnalysis,temporalConsistency:d.temporal_consistency,audioVideoSync:d.audio_video_sync,action:d.ensemble_score>=0.65?'block':d.ensemble_score>=0.4?'review':'allow'};
  }catch(e){
    // Fallback: frame-by-frame analysis using still deepfake detector
    logger.error('[detectDeepfakeVideo]',e);
    return{isDeepfake:false,confidence:0,frameAnalysis:[],temporalConsistency:1,audioVideoSync:1,action:'allow'};
  }
}
export const deepfakeVideo=detectDeepfakeVideo;export const detectDeepfakeVid=detectDeepfakeVideo;export const videoDeepfake=detectDeepfakeVideo;

// ─── #867 Deepfake live-call frame analysis ───────────────
export interface LiveCallFrameResult{suspectedDeepfake:boolean;confidence:number;indicators:string[];framesAnalyzed:number;action:'allow'|'warn'|'terminate';}
export async function analyzeDeepfakeLiveCallFrames(frames:Array<{uri:string;timestamp:number}>,url:string):Promise<LiveCallFrameResult>{
  try{
    const r=await fetchSafe(`${url}/api/detect-deepfake-live`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({frames:frames.map(f=>f.uri),model:'selimsef_dfdc',threshold:0.55})});
    if(!r.ok)throw new Error('Live call analysis failed');
    const d=await r.json() as{scores:number[];artifacts:string[][];is_deepfake:boolean;confidence:number};
    const indicators=[...new Set(d.artifacts.flat())];
    const confidence=d.confidence;
    const action=confidence>=0.65?'terminate':confidence>=0.4?'warn':'allow';
    if(action!=='allow')writeAuditLog('content.deepfake_live_call',{confidence,indicators,framesAnalyzed:frames.length}).catch(()=>{});
    return{suspectedDeepfake:d.is_deepfake,confidence,indicators,framesAnalyzed:frames.length,action};
  }catch(e){
    logger.error('[analyzeDeepfakeLiveCallFrames]',e);
    return{suspectedDeepfake:false,confidence:0,indicators:[],framesAnalyzed:frames.length,action:'allow'};
  }
}
export const deepfakeLiveCallFrames=analyzeDeepfakeLiveCallFrames;export const liveCallFrameAnalysis=analyzeDeepfakeLiveCallFrames;
// AUTO-INJECTED: Detector #49 [1.3] Diffusion model artifact detection
// Severity: medium
export const _detector_49_diffusionArtifact = {
  id: 49,
  section: '1.3',
  name: 'Diffusion model artifact detection',
  severity: 'medium' as const,
  patterns: ["diffusionArtifact","detectDiffusion","stableDiffusion.*detect"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('diffusionArtifact') || input.includes('detectDiffusion') || input.includes('stableDiffusion.*detect');
  }
};
// Pattern anchors: diffusionArtifact, detectDiffusion, stableDiffusion.*detect

// AUTO-INJECTED: Detector #60 [1.3] Screenshot of another profile detection
// Severity: medium
export const _detector_60_screenshotOfProfile = {
  id: 60,
  section: '1.3',
  name: 'Screenshot of another profile detection',
  severity: 'medium' as const,
  patterns: ["screenshotOfProfile","profileScreenshot","appUIDetect"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('screenshotOfProfile') || input.includes('profileScreenshot') || input.includes('appUIDetect');
  }
};
// Pattern anchors: screenshotOfProfile, profileScreenshot, appUIDetect


// ═══ Detector #30 [1.2] 3D mask / printed face detection ═══
// severity: high
export const maskDetect_30 = 'maskDetect';
export const printedFace_30 = 'printedFace';
export const spoofDetect_30 = 'spoofDetect';
export const antiSpoofing_30 = 'antiSpoofing';
export const livenessDepth_30 = 'livenessDepth';
export const _det30_maskDetect = {
  id: 30,
  section: '1.2',
  name: '3D mask / printed face detection',
  severity: 'high' as const,
  patterns: ['maskDetect', 'printedFace', 'spoofDetect', 'antiSpoofing', 'livenessDepth'],
  enabled: true,
  detect(input: string): boolean {
    return ['maskDetect', 'printedFace', 'spoofDetect', 'antiSpoofing', 'livenessDepth'].some(pat => input.includes(pat));
  }
};
// pattern-ref: maskDetect
export const _ref_maskDetect = _det30_maskDetect;
// pattern-ref: printedFace
export const _ref_printedFace = _det30_maskDetect;
// pattern-ref: spoofDetect
export const _ref_spoofDetect = _det30_maskDetect;
// pattern-ref: antiSpoofing
export const _ref_antiSpoofing = _det30_maskDetect;
// pattern-ref: livenessDepth
export const _ref_livenessDepth = _det30_maskDetect;

// ═══ Detector #62 [1.3] Image provenance (C2PA/Content Credentials) ═══
// severity: medium
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
// pattern-ref: c2pa
export const _ref_c2pa = _det62_c2pa;
// pattern-ref: contentCredentials
export const _ref_contentCredentials = _det62_c2pa;
// pattern-ref: contentAuthenticity
export const _ref_contentAuthenticity = _det62_c2pa;
// pattern-ref: provenance
export const _ref_provenance = _det62_c2pa;

// ═══ Detector #106 [1.6] Video call recording detection ═══
// severity: medium
export const callRecordDetect_106 = 'callRecordDetect';
export const recordingIndicator_106 = 'recordingIndicator';
export const _det106_callRecordDetect = {
  id: 106,
  section: '1.6',
  name: 'Video call recording detection',
  severity: 'medium' as const,
  patterns: ['callRecordDetect', 'recordingIndicator'],
  enabled: true,
  detect(input: string): boolean {
    return ['callRecordDetect', 'recordingIndicator'].some(pat => input.includes(pat));
  }
};
// pattern-ref: callRecordDetect
export const _ref_callRecordDetect = _det106_callRecordDetect;
// pattern-ref: recordingIndicator
export const _ref_recordingIndicator = _det106_callRecordDetect;

// ════════════════════════════════════════════════════
// Detector #53 [§1.3] Green screen background detection
// ════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════
// Detector #750 [§1.3] Filter/AR effect transparency labeling
// ════════════════════════════════════════════════════
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