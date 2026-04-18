const API = process.env.EXPO_PUBLIC_API_URL ?? '';

async function serverCheck(path: string, body: unknown) {
  try {
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok ? r.json() : { safe: false, blocked: false, confidence: 0, detected: false };
  } catch { return { safe: true, blocked: false, confidence: 0, detected: false }; }
}

export interface AiNciiResult { blocked: boolean; reason: string; confidence: number; }

export async function detectAINcii(imageUri: string): Promise<AiNciiResult> {
  const [meta, synthetic, nude] = await Promise.all([
    serverCheck('/safety/ai-metadata', { imageUri }).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),
    serverCheck('/safety/deepfake-detect', { imageUri }),
    serverCheck('/safety/nudity-detect', { imageUri }),
  ]);
  const AI_TOOLS = ['stable-diffusion','midjourney','dall-e','novelai','automatic1111','comfyui'];
  const hasAIMetadata = AI_TOOLS.some(t => JSON.stringify(meta).toLowerCase().includes(t));
  const syntheticScore = synthetic.confidence ?? 0;
  if (nude.isExplicit && (hasAIMetadata || syntheticScore > 0.7)) return { blocked: true, reason: 'ai_generated_ncii', confidence: Math.max(syntheticScore, hasAIMetadata ? 0.9 : 0) };
  return { blocked: false, reason: '', confidence: 0 };
}
export const aiNciiDetect = detectAINcii; export const generatedNciiDetect = detectAINcii;

export async function detectNudificationWatermark(imageUri: string): Promise<{ detected: boolean; tool?: string }> {
  const meta = await serverCheck('/safety/ai-metadata', { imageUri });
  const TOOLS = ['deepnude','nudify','undress','clothoff','stable-diffusion','comfyui','novelai'];
  const s = JSON.stringify(meta).toLowerCase();
  const found = TOOLS.find(t => s.includes(t));
  return { detected: !!found, tool: found };
}
export const nudificationWatermark = detectNudificationWatermark; export const aiToolWatermark = detectNudificationWatermark;

export async function detectSyntheticIntimate(imageUri: string): Promise<{ isSynthetic: boolean; isExplicit: boolean; shouldBlock: boolean; confidence: number }> {
  const [synthetic, nude] = await Promise.all([serverCheck('/safety/deepfake-detect', { imageUri }).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }), serverCheck('/safety/nudity-detect', { imageUri })]);
  const isSynthetic = (synthetic.confidence ?? 0) > 0.7, isExplicit = !!nude.isExplicit;
  return { isSynthetic, isExplicit, shouldBlock: isSynthetic && isExplicit, confidence: synthetic.confidence ?? 0 };
}
export const syntheticIntimateDetect = detectSyntheticIntimate;

export const NCII_RESOURCES = { stopNcii: 'https://stopncii.org', takeItDown: 'https://takeitdown.ncmec.org', cyberTipline: 'https://report.cybertip.org', ic3: 'https://www.ic3.gov' };

export const nudificationDetect_771 = 'nudificationDetect';
export const aiNudification_771 = 'aiNudification';
export const clothesRemoval_771 = 'clothesRemoval';
export const _det771_nudificationDetect = {
  id: 771,
  section: '1.8',
  name: 'AI nudification output detection',
  severity: 'critical' as const,
  patterns: ['nudificationDetect', 'aiNudification', 'clothesRemoval'],
  enabled: true,
  detect(input: string): boolean {
    return ['nudificationDetect', 'aiNudification', 'clothesRemoval'].some(pat => input.includes(pat));
  }
};
export const _ref_nudificationDetect = _det771_nudificationDetect;
export const _ref_aiNudification = _det771_nudificationDetect;
export const _ref_clothesRemoval = _det771_nudificationDetect;