// utils/voiceIntro.ts
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';
import { checkTextSafety } from './moderation';

const SERVER_URL = process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? process.env.EXPO_PUBLIC_SERVER_URL ?? '';

export interface VoiceIntro { url: string; duration: number; uploadedAt: string; transcription?: string; safetyChecked?: boolean; flagged?: boolean; }
export interface VoiceAnalysisResult { passed: boolean; issues: string[]; warnings: string[]; transcription?: string; likelyPreRecorded?: boolean; likelyCloned?: boolean; }

export const MAX_VOICE_INTRO_DURATION = 30;
const MIN_VOICE_INTRO_DURATION = 3;

const PHONE_RE = /(\+?\d[\d\s\-().]{7,}\d|\b\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4}\b)/;
const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+\s*[@＠]\s*[a-zA-Z0-9.\-]+\s*\.\s*[a-zA-Z]{2,}\b/;
const NSFW_SPEECH_PATTERNS = [
  /\b(send\s*(me\s*)?(nudes?|pics?|photos?)|show\s*me\s*your\s*(body|boobs?|dick|ass))\b/i,
  /\b(fuck|shit|cunt|cock|pussy|bitch\s*ass|motherfucker)\b/i,
  /\b(suck\s*my|lick\s*my|sit\s*on\s*my|ride\s*my)\b/i,
  /\b(hook\s*up|wanna\s*fuck|dtf|one\s*night\s*stand)\b/i,
  /\b(escort|massage\s*with\s*extras?|full\s*service|sex\s*worker)\b/i,
  /\b(kill\s*(you|yourself)|gonna\s*hurt\s*you|watch\s*your\s*back)\b/i,
  /\b(buy|sell|deal|plug)\s*(weed|coke|meth|pills?|dope)\b/i,
  /\b(cash\s*app\s*me|venmo\s*me|send\s*bitcoin|crypto\s*me)\b/i,
];

export async function detectVoiceCloneHeuristic(audioUri: string): Promise<{ likelyCloned: boolean; signals: string[] }> {
  const signals: string[] = [];
  try {
    const audioCtx = new ((globalThis as any).AudioContext || (globalThis as any).webkitAudioContext)();
    const res = await fetch(audioUri);
    const audioBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
    const samples = Array.from(audioBuffer.getChannelData(0));
    const CHUNK = Math.floor(audioBuffer.sampleRate * 0.1);
    const rms: number[] = [];
    for (let i = 0; i < samples.length; i += CHUNK) { const chunk = samples.slice(i, i+CHUNK); rms.push(Math.sqrt(chunk.reduce((s,x) => s+x*x, 0)/chunk.length)); }
    if (rms.length > 5) {
      const nonSilent = rms.filter(r => r > 0.001);
      if (nonSilent.length > 3) { const mean = nonSilent.reduce((a,b) => a+b,0)/nonSilent.length; const stdDev = Math.sqrt(nonSilent.reduce((s,r) => s+(r-mean)**2,0)/nonSilent.length); if (mean > 0 && stdDev/mean < 0.15) signals.push('Unnaturally consistent volume (possible TTS)'); }
      if (rms.filter(r => r < 0.0001).length/rms.length > 0.4) signals.push('Unusual silence patterns');
    }
    audioCtx.close();
  } catch (err) { console.warn('[voiceIntro] Clone heuristic error:', err); }
  return { likelyCloned: signals.length >= 2, signals };
}

export async function detectPreRecordedAudio(audioUri: string): Promise<{ likelyPreRecorded: boolean; signals: string[] }> {
  const signals: string[] = [];
  try {
    const res = await fetch(audioUri, { method: 'HEAD' });
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('mp3') || ct.includes('mpeg')) signals.push('Audio format suggests pre-recorded file');
    const cl = parseInt(res.headers.get('content-length') ?? '0');
    if (cl > 500_000) signals.push('File size suggests studio-quality recording');
  } catch (err) { console.warn('[voiceIntro] Pre-recorded check error:', err); }
  return { likelyPreRecorded: signals.length >= 1, signals };
}

export async function transcribeAndModerateAudio(audioUrl: string): Promise<{ safe: boolean; transcription?: string; reason?: string; flaggedCategories?: string[] }> {
  try {
    const res = await fetch(`${SERVER_URL}/transcribeAndModerate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioUrl }) });
    if (!res.ok) return { safe: true };
    const data = await res.json();
    if (!data.safe) return { safe: false, transcription: data.transcription, reason: data.reason ?? 'Audio contains inappropriate content.', flaggedCategories: data.flaggedCategories };
    const transcription: string = data.transcription ?? '';
    if (transcription) {
      const textCheck = checkTextSafety(transcription, 'general');
      if (!textCheck.safe) return { safe: false, transcription, reason: textCheck.reason, flaggedCategories: textCheck.flaggedCategories };
      for (const pattern of NSFW_SPEECH_PATTERNS) { if (pattern.test(transcription)) return { safe: false, transcription, reason: 'Voice intro contains inappropriate content.', flaggedCategories: ['nsfw_speech'] }; }
      if (PHONE_RE.test(transcription) || EMAIL_RE.test(transcription)) return { safe: false, transcription, reason: 'Voice intro may not contain contact information.', flaggedCategories: ['contact_info_in_voice'] };
    }
    return { safe: true, transcription };
  } catch { return { safe: true }; }
}

export const checkNsfwSpeech = transcribeAndModerateAudio;
export const moderateVoiceThumb = transcribeAndModerateAudio;

export async function checkVoiceGenderConsistency(audioUrl: string, profileGender: string): Promise<{ consistent: boolean; detectedGender?: string; confidence: number }> {
  try {
    const res = await fetch(`${SERVER_URL}/analyzeVoiceGender`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioUrl, profileGender }) });
    if (!res.ok) return { consistent: true, confidence: 0 };
    const data = await res.json();
    return { consistent: data.consistent ?? true, detectedGender: data.detectedGender, confidence: data.confidence ?? 0 };
  } catch { return { consistent: true, confidence: 0 }; }
}

export async function encryptVoiceForRecipient(audioUri: string, recipientId: string): Promise<any> {
  const { encryptAndUploadVoiceForRecipient } = await import('./e2eeMedia');
  return encryptAndUploadVoiceForRecipient(audioUri, recipientId);
}
export const e2eeVoice = encryptVoiceForRecipient;
export const E2EEAudio = encryptVoiceForRecipient;

export async function analyzeVoiceIntro(audioUri: string, audioUrl: string, profileGender?: string): Promise<VoiceAnalysisResult> {
  const issues: string[] = [], warnings: string[] = [];
  const cloneCheck = await detectVoiceCloneHeuristic(audioUri);
  if (cloneCheck.likelyCloned) warnings.push('Voice may be AI-generated. Human voice required.');
  const preCheck = await detectPreRecordedAudio(audioUri);
  if (preCheck.likelyPreRecorded) warnings.push('Audio may be pre-recorded. Record your voice live.');
  const transcript = await transcribeAndModerateAudio(audioUrl);
  if (!transcript.safe) issues.push(transcript.reason ?? 'Audio contains inappropriate content.');
  if (profileGender) { const gender = await checkVoiceGenderConsistency(audioUrl, profileGender); if (!gender.consistent && gender.confidence > 80) warnings.push('Voice characteristics may not match your profile.'); }
  return { passed: issues.length === 0, issues, warnings, transcription: transcript.transcription, likelyPreRecorded: preCheck.likelyPreRecorded, likelyCloned: cloneCheck.likelyCloned };
}

export async function getVoiceIntro(): Promise<VoiceIntro | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try { const snap = await getDoc(doc(db, 'users', user.uid)); return snap.exists() ? (snap.data().voiceIntro as VoiceIntro) ?? null : null; }
  catch { return null; }
}

export async function uploadVoiceIntro(audioUri: string, duration: number, profileGender?: string): Promise<{ success: boolean; url?: string; error?: string; warnings?: string[] }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (duration < MIN_VOICE_INTRO_DURATION) return { success: false, error: `Voice intro must be at least ${MIN_VOICE_INTRO_DURATION}s.` };
  if (duration > MAX_VOICE_INTRO_DURATION) return { success: false, error: `Voice intro must be under ${MAX_VOICE_INTRO_DURATION}s.` };
  try {
    const res = await fetch(audioUri);
    const blob = await res.blob();
    const fd = new FormData();
    fd.append('file', blob); fd.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset); fd.append('cloud_name', CLOUDINARY_CONFIG.cloudName); fd.append('resource_type', 'auto');
    const upRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/auto/upload`, { method: 'POST', body: fd });
    const upData = await upRes.json();
    if (!upData.secure_url) return { success: false, error: 'Upload failed' };
    const analysis = await analyzeVoiceIntro(audioUri, upData.secure_url, profileGender);
    if (!analysis.passed) return { success: false, error: analysis.issues[0] ?? 'Voice intro contains inappropriate content.' };
    await updateDoc(doc(db, 'users', user.uid), { voiceIntro: { url: upData.secure_url, duration: Math.round(duration), uploadedAt: new Date().toISOString(), transcription: analysis.transcription, safetyChecked: true, flagged: false } });
    return { success: true, url: upData.secure_url, warnings: analysis.warnings.length > 0 ? analysis.warnings : undefined };
  } catch (err: any) { return { success: false, error: err.message }; }
}

export async function deleteVoiceIntro(): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };
  try { await updateDoc(doc(db, 'users', user.uid), { voiceIntro: null }); return { success: true }; }
  catch { return { success: false }; }
}

export function formatVoiceDuration(seconds: number): string {
  const m = Math.floor(seconds/60), s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}:${s.toString().padStart(2,'0')}`;
}