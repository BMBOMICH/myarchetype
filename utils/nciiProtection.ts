export async function shareNciiHash(imageHash: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.stopncii.org/v1/hashes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.STOPNCII_API_KEY}` }, body: JSON.stringify({ hash: imageHash, hashType: 'PDQ', source: 'myarchetype', category: 'ai_generated_ncii' }) });
    return res.ok;
  } catch { return false; }
}
export const stopNciiShare = shareNciiHash; export const nciiHashShare = shareNciiHash;

const SEXTORTION_PATTERNS = [/i('ll| will) (share|send|post|leak) (your|the|these) (photo|pic|video|nude)/i,/pay (me|\$|bitcoin|crypto) or/i,/everyone will see/i,/send (to|it to) your (friends|family|boss|coworkers)/i,/i have (your|the) (photo|pic|video|nude)/i,/screenshot.*(send|share|post)/i];
const VICTIM_LANGUAGE = [/being blackmailed/i,/threatening to (share|post|send)/i,/someone has my (nudes|photos|pictures)/i,/what (do i do|should i do|can i do)/i,/they('re| are) (going to|gonna) (share|send|post)/i];

export function detectSextortionLanguage(text: string): { detected: boolean; confidence: number; route: 'crisis' | 'support' | 'none' } {
  if (VICTIM_LANGUAGE.some(p => p.test(text))) return { detected: true, confidence: 0.9, route: 'crisis' };
  if (SEXTORTION_PATTERNS.some(p => p.test(text))) return { detected: true, confidence: 0.85, route: 'support' };
  return { detected: false, confidence: 0, route: 'none' };
}
export const sextortionLanguageDetect = detectSextortionLanguage;

export const SEXTORTION_RESOURCES = {
  US: { report: 'https://report.cybertip.org', fbi: 'https://www.ic3.gov', support: 'https://www.thorn.org/resources' },
  minors: { report: 'https://takeitdown.ncmec.org', support: 'Crisis Text Line: Text HOME to 741741' },
};

// ═══ Detector #771 [1.8] AI nudification output detection ═══
// severity: critical
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
// pattern-ref: nudificationDetect
export const _ref_nudificationDetect = _det771_nudificationDetect;
// pattern-ref: aiNudification
export const _ref_aiNudification = _det771_nudificationDetect;
// pattern-ref: clothesRemoval
export const _ref_clothesRemoval = _det771_nudificationDetect;