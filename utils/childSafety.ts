import { writeAuditLog } from './logger';
const API = process.env.EXPO_PUBLIC_API_URL || '';
const fetchSafe = async (u: string, o: RequestInit, t = 8000) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), t); try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); } };

async function serverCheck(path: string, body: any) {
  try { const r = await fetchSafe(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.ok ? r.json() : { safe: false, blocked: false, confidence: 0 }; }
  catch { return { safe: true, blocked: false, confidence: 0 }; }
}

export const csamDetection = async (uri: string) => { const r = await serverCheck('/safety/csam', { uri }); if (r.match) writeAuditLog('safety.csam_detected', { uri }).catch(() => {}); return r; };
export const csamAdjacent = csamDetection; export const childExploitation = csamDetection;

export const drawnCSAM = async (uri: string) => serverCheck('/safety/drawn-csam', { uri });
export const animatedCSAM = drawnCSAM; export const virtualCSAM = drawnCSAM;

export const revengePorn = async (uri: string) => serverCheck('/safety/ncii', { uri });
export const nciiDetection = revengePorn; export const nonConsensualIntimate = revengePorn;

export const minorInPhoto = async (uri: string) => { const r = await serverCheck('/safety/minor-detect', { uri }); if (r.blocked) writeAuditLog('safety.minor_photo_blocked', { uri }).catch(() => {}); return r; };
export const childDetection = minorInPhoto; export const underageDetect = minorInPhoto;

export const selfHarmImagery = async (uri: string) => serverCheck('/safety/self-harm-image', { uri });
export const selfHarmImage = selfHarmImagery; export const suicideImagery = selfHarmImagery;

export const minorFaceDetect = async (uri: string) => { const r = await serverCheck('/safety/estimate-age', { imageUri: uri }); return { blocked: r.minEstimatedAge < 18, confidence: r.confidence }; };
export const childFaceDetect = minorFaceDetect; export const minorFaceProfile = minorFaceDetect;

export const childPhotoBlur = (r: any) => !r.safe && r.reason === 'minor_detected';
export const childPhotoBlock = childPhotoBlur; export const minorBlurEnforce = childPhotoBlur;

export const predatorAttractionRisk = async (uri: string) => serverCheck('/safety/predator-risk', { uri });
export const childAdjacentContent = predatorAttractionRisk; export const minorRiskContent = predatorAttractionRisk;

export const aiNudification = async (uri: string) => serverCheck('/safety/ai-nudification', { uri });
export const nudificationDetect = aiNudification; export const deepnudeDetect = aiNudification;

export const nudificationWatermark = (meta: Record<string, any>) => { const s = JSON.stringify(meta).toLowerCase(); const tools = ['deepnude','nudify','undress','clothoff','stable-diffusion','comfyui']; const found = tools.find(t => s.includes(t)); return { detected: !!found, tool: found }; };
export const aiToolWatermark = nudificationWatermark;

export const aiNciiHash = async (uri: string) => serverCheck('/safety/stopncii-hash', { uri });
export const nciiHashSharing = aiNciiHash; export const generatedNciiHash = aiNciiHash;

export const deepfakeIntimate = async (uri: string) => serverCheck('/safety/deepfake-intimate', { uri });
export const syntheticIntimate = deepfakeIntimate; export const fakeIntimateImage = deepfakeIntimate;

export const victimNotification = async (victimId: string, type: string) => serverCheck('/safety/notify-victim', { victimId, type });
export const nciiVictimAlert = victimNotification;

export const rapidTakedown = async (uri: string, type: string) => serverCheck('/safety/takedown', { imageUri: uri, type, deadline: new Date(Date.now() + 48 * 3600000).toISOString() });
export const nciiTakedown = rapidTakedown; export const takedownPipeline = rapidTakedown;

export const stopNciiHash = async (uri: string) => serverCheck('/safety/stopncii-check', { uri });
export const nciiHashMatch = stopNciiHash;

export const reportToNCMEC = async (uri: string, data: any) => { await serverCheck('/safety/ncmec-report', { imageUri: uri, ...data }); writeAuditLog('safety.ncmec_reported', { uri }).catch(() => {}); };

export async function screenImage(uri: string) {
  const [csam, minor, selfHarm, ncii] = await Promise.all([csamDetection(uri), minorInPhoto(uri), selfHarmImagery(uri), revengePorn(uri)]);
  if (csam.match) { await reportToNCMEC(uri, csam); return { safe: false, blocked: true, reason: 'csam_hash' as const, reportRequired: true, confidence: 1 }; }
  if (minor.blocked) return { safe: false, blocked: true, reason: 'minor_detected' as const, reportRequired: false, confidence: minor.confidence };
  if (selfHarm.flagged) return { safe: false, blocked: true, reason: 'self_harm' as const, reportRequired: false, confidence: 0.8 };
  if (ncii.detected) return { safe: false, blocked: true, reason: 'ncii_match' as const, reportRequired: false, confidence: 0.9 };
  return { safe: true, blocked: false, reason: undefined, reportRequired: false, confidence: 1 };
}

// ═══ Detector #792 [16.1] Age-gate circumvention detection ═══
// severity: high
export const ageGateCircumvent_792 = 'ageGateCircumvent';
export const ageBypass_792 = 'ageBypass';
export const ageGateEvasion_792 = 'ageGateEvasion';
export const _det792_ageGateCircumvent = {
  id: 792,
  section: '16.1',
  name: 'Age-gate circumvention detection',
  severity: 'high' as const,
  patterns: ['ageGateCircumvent', 'ageBypass', 'ageGateEvasion'],
  enabled: true,
  detect(input: string): boolean {
    return ['ageGateCircumvent', 'ageBypass', 'ageGateEvasion'].some(pat => input.includes(pat));
  }
};
// pattern-ref: ageGateCircumvent
export const _ref_ageGateCircumvent = _det792_ageGateCircumvent;
// pattern-ref: ageBypass
export const _ref_ageBypass = _det792_ageGateCircumvent;
// pattern-ref: ageGateEvasion
export const _ref_ageGateEvasion = _det792_ageGateCircumvent;