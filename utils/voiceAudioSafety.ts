
export async function detectVoiceDeepfake(audioUri: string): Promise<{
  synthetic: boolean; confidence: number; method: string;
}> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/voice-deepfake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUri }),
    });
    if (!resp.ok) return { synthetic: false, confidence: 0, method: 'server_unavailable' };
    return resp.json(); // Server runs ASVspoof / Resemble Detect / WeDefense
  } catch { return { synthetic: false, confidence: 0, method: 'error' }; }
}

export async function moderateVoiceNote(audioUri: string): Promise<{
  flagged: boolean; categories: string[]; transcript?: string;
}> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/voice-moderate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUri }),
    });
    if (!resp.ok) return { flagged: false, categories: [] };
    return resp.json();
  } catch { return { flagged: false, categories: [] }; }
}

export async function verifySpeakerIdentity(audioUri: string, enrollmentAudioUri: string): Promise<{
  match: boolean; confidence: number;
}> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/speaker-verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUri, enrollmentAudioUri }),
    });
    if (!resp.ok) return { match: false, confidence: 0 };
    return resp.json(); // Server runs pyannote.audio speaker diarization
  } catch { return { match: false, confidence: 0 }; }
}

export async function detectAudioSteganography(audioUri: string): Promise<{
  detected: boolean; method?: string;
}> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/audio-stego`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUri }),
    });
    if (!resp.ok) return { detected: false };
    return resp.json();
  } catch { return { detected: false }; }
}

export async function moderateLiveAudio(audioChunk: ArrayBuffer): Promise<{
  flagged: boolean; reason?: string;
}> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/live-audio`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
      body: audioChunk,
    });
    if (!resp.ok) return { flagged: false };
    return resp.json();
  } catch { return { flagged: false }; }
}

export async function analyzeVoicePitch(audioUri: string): Promise<{
  estimatedPitch: number; gender?: 'male' | 'female' | 'ambiguous';
}> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/voice-pitch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUri }),
    });
    if (!resp.ok) return { estimatedPitch: 0 };
    return resp.json(); // Server uses librosa pitch analysis
  } catch { return { estimatedPitch: 0 }; }
}

export async function transcribeVoiceNote(audioUri: string): Promise<{
  transcript: string; language: string; confidence: number;
}> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUri }),
    });
    if (!resp.ok) return { transcript: '', language: '', confidence: 0 };
    return resp.json(); // Server: Whisper (MIT)
  } catch { return { transcript: '', language: '', confidence: 0 }; }
}

export async function analyzeAmbientSound(audioUri: string): Promise<{
  riskyEnvironment: boolean; indicators: string[];
}> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/ambient-analysis`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUri }),
    });
    if (!resp.ok) return { riskyEnvironment: false, indicators: [] };
    return resp.json();
  } catch { return { riskyEnvironment: false, indicators: [] }; }
}

export const VOICE_NOTE_POLICY = {
  maxDurationSeconds: 120,
  requireConsentToReceive: true,
  autoTranscribeForModeration: true,
  retainTranscriptOnly: false, // keep audio
  stripMetadataOnSend: true,
};

export async function fingerprintAudio(audioUri: string): Promise<string | null> {
  try {
    const resp = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/audio-fingerprint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUri }),
    });
    if (!resp.ok) return null;
    const { fingerprint } = await resp.json();
    return fingerprint;
  } catch { return null; }
}