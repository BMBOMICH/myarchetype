import { writeAuditLog } from './logger';
import {
  analyzeVoicePitch, detectAudioSteganography, detectVoiceDeepfake,
  moderateLiveAudio, moderateVoiceNote, transcribeVoiceNote, analyzeAmbientSound,
} from './voiceAudioSafety';
import { checkTextSafety } from './moderation';

export interface VoiceDeepfakeResult { isDeepfake: boolean; confidence: number; method: string; }
export interface VoiceHarassmentResult { flagged: boolean; categories: string[]; transcript?: string; severity: 'none' | 'low' | 'medium' | 'high' | 'critical'; action: 'allow' | 'warn' | 'block' | 'escalate'; }
export interface AudioStegoResult { detected: boolean; method?: string; confidence: number; payload?: string; }
export interface LiveAudioResult { flagged: boolean; reason?: string; transcript?: string; action: 'allow' | 'warn' | 'terminate'; }
export interface VoicePitchResult { estimatedPitch: number; gender: 'male' | 'female' | 'ambiguous'; confidence: number; consistent: boolean; }
export interface AmbientSoundResult { riskyEnvironment: boolean; indicators: string[]; environmentType?: string; riskLevel: 'none' | 'low' | 'medium' | 'high'; }

export async function scanVoiceForDeepfake(audioUri: string): Promise<VoiceDeepfakeResult> {
  const d = await detectVoiceDeepfake(audioUri);
  if (d.synthetic) await writeAuditLog('safety.voice_deepfake_detected', { confidence: d.confidence }).catch(() => {});
  return { isDeepfake: d.synthetic ?? false, confidence: d.confidence ?? 0, method: d.method ?? 'unknown' };
}

export async function scanVoiceForHarassment(audioUri: string): Promise<VoiceHarassmentResult> {
  const d = await moderateVoiceNote(audioUri);
  const sev: VoiceHarassmentResult['severity'] = d.flagged ? 'high' : 'none';
  const action: VoiceHarassmentResult['action'] = d.flagged ? 'block' : 'allow';
  if (d.flagged) await writeAuditLog('safety.voice_harassment', { categories: d.categories, severity: sev }).catch(() => {});
  const result: VoiceHarassmentResult = { flagged: d.flagged ?? false, categories: d.categories ?? [], severity: sev, action };
  if (d.transcript !== undefined) result.transcript = d.transcript;
  return result;
}

export async function scanAudioForSteganography(audioUri: string): Promise<AudioStegoResult> {
  const d = await detectAudioSteganography(audioUri);
  if (d.detected) await writeAuditLog('safety.audio_stego_detected', { method: d.method }).catch(() => {});
  const result: AudioStegoResult = { detected: d.detected ?? false, confidence: 0 };
  if (d.method !== undefined) result.method = d.method;
  return result;
}

export async function scanLiveAudio(audioChunk: ArrayBuffer): Promise<LiveAudioResult> {
  const d = await moderateLiveAudio(audioChunk);
  const action: LiveAudioResult['action'] = d.flagged ? 'terminate' : 'allow';
  const result: LiveAudioResult = { flagged: d.flagged ?? false, action };
  if (d.reason !== undefined) result.reason = d.reason;
  return result;
}

export async function analyzeVoicePitchConsistency(audioUri: string): Promise<VoicePitchResult> {
  const d = await analyzeVoicePitch(audioUri);
  return {
    estimatedPitch: d.estimatedPitch ?? 0,
    gender: (d.gender ?? 'ambiguous') as VoicePitchResult['gender'],
    confidence: 0,
    consistent: true,
  };
}

export async function analyzeAmbientSoundRisk(audioUri: string): Promise<AmbientSoundResult> {
  const d = await analyzeAmbientSound(audioUri);
  const result: AmbientSoundResult = {
    riskyEnvironment: d.riskyEnvironment ?? false,
    indicators: d.indicators ?? [],
    riskLevel: (d.riskyEnvironment ? 'medium' : 'none') as AmbientSoundResult['riskLevel'],
  };
  return result;
}

export async function fullVoiceScan(audioUri: string): Promise<{
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  score: number;
  flags: string[];
  action: 'allow' | 'warn' | 'block' | 'escalate';
}> {
  const [deepfake, harassment, stego, pitch] = await Promise.all([
    scanVoiceForDeepfake(audioUri),
    scanVoiceForHarassment(audioUri),
    scanAudioForSteganography(audioUri),
    analyzeVoicePitchConsistency(audioUri),
  ]);

  const flags: string[] = [];
  let score = 0;

  if (deepfake.isDeepfake) { flags.push('deepfake_detected'); score += 40; }
  if (harassment.flagged) { flags.push('harassment_detected'); score += 35; }
  if (stego.detected) { flags.push('steganography_detected'); score += 25; }
  if (!pitch.consistent) { flags.push('pitch_inconsistency'); score += 15; }

  const risk: 'none' | 'low' | 'medium' | 'high' | 'critical' =
    score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : score >= 10 ? 'low' : 'none';
  const action: 'allow' | 'warn' | 'block' | 'escalate' =
    risk === 'critical' ? 'escalate' : risk === 'high' ? 'block' : risk === 'medium' ? 'warn' : 'allow';

  if (risk !== 'none') {
    const kw = { voiceKeyword: flags };
    const cats = flags;
    await writeAuditLog('safety.voice_scan_risk', { risk, score, keywords: kw.voiceKeyword, categories: cats }).catch(() => {});
  }

  return { risk, score, flags, action };
}

export async function transcribeAndCheckVoice(audioUri: string): Promise<{
  safe: boolean; transcript: string; issues: string[];
}> {
  const t = await transcribeVoiceNote(audioUri);
  const issues: string[] = [];
  if (t.transcript) {
    const check = checkTextSafety(t.transcript, 'general');
    if (!check.safe) issues.push(check.reason ?? 'Inappropriate content');
  }
  return { safe: issues.length === 0, transcript: t.transcript, issues };
}