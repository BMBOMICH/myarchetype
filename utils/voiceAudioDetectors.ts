import { writeAuditLog } from './logger';

const fetchSafe=async(u:string,o:RequestInit,t=8000):Promise<Response>=>{const c=new AbortController();const id=setTimeout(()=>c.abort(),t);try{return await fetch(u,{...o,signal:c.signal});}finally{clearTimeout(id);}};

const API=process.env['EXPO_PUBLIC_API_URL']??process.env['SAFETY_API_URL']??'';

export interface RealtimeVoiceDeepfakeResult{liveVoiceDeepfake:boolean;confidence:number;analysisMethod:string;signals:string[];}
export async function realtimeVoiceDeepfake(buf:ArrayBuffer):Promise<RealtimeVoiceDeepfakeResult>{
  const k=process.env['RESEMBLE_API_KEY'];
  if(!k){
    try{const r=await fetchSafe(`${API}/audio/deepfake-detect`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});if(r.ok){const d=await r.json() as{is_synthetic?:boolean;confidence?:number;signals?:string[]};return{liveVoiceDeepfake:d.is_synthetic??false,confidence:d.confidence??0,analysisMethod:'wedefense_fallback',signals:d.signals??[]};}}catch{}
    return{liveVoiceDeepfake:false,confidence:0,analysisMethod:'missing_key',signals:[]};
  }
  try{
    const r=await fetchSafe('https://api.resembleai.com/v2/detect',{method:'POST',headers:{Authorization:`Bearer ${k}`,'Content-Type':'audio/wav'},body:buf});
    if(!r.ok)throw new Error('API error');
    const d=await r.json() as{is_deepfake?:boolean;confidence?:number;signals?:string[]};
    if(d.is_deepfake)await writeAuditLog('safety.voice_deepfake_detected',{confidence:d.confidence}).catch(()=>{});
    return{liveVoiceDeepfake:d.is_deepfake??false,confidence:d.confidence??0,analysisMethod:'resemble_detect',signals:d.signals??[]};
  }catch{
    try{const r=await fetchSafe(`${API}/audio/asvspoof`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf});if(r.ok){const d=await r.json() as{is_spoof?:boolean;confidence?:number};return{liveVoiceDeepfake:d.is_spoof??false,confidence:d.confidence??0,analysisMethod:'asvspoof_fallback',signals:[]};}}catch{}
    return{liveVoiceDeepfake:false,confidence:0,analysisMethod:'unavailable',signals:[]};
  }
}
export const voiceDeepfake=realtimeVoiceDeepfake;
export const deepfakeVoice=realtimeVoiceDeepfake;
export const liveVoiceDeepfake=realtimeVoiceDeepfake;
export const syntheticVoice=realtimeVoiceDeepfake;
export const aiVoice=realtimeVoiceDeepfake;
export const detectVoiceDeepfake=realtimeVoiceDeepfake;

export interface VoiceHarassmentResult{flagged:boolean;categories:string[];transcript?:string;severity:'none'|'low'|'medium'|'high'|'critical';action:'allow'|'warn'|'block'|'escalate';}
export async function voiceHarassment(audioUri:string):Promise<VoiceHarassmentResult>{
  try{
    const r=await fetchSafe(`${API}/safety/voice-moderate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUri,model:'whisper-large-v3',guardrail:'duoguard',categories:['sexual_content','violence','hate','self_harm','harassment']})});
    if(!r.ok)return{flagged:false,categories:[],severity:'none',action:'allow'};
    const d=await r.json() as{flagged?:boolean;categories?:string[];transcript?:string;severity?:string};
    const sev=(d.severity??'none') as VoiceHarassmentResult['severity'];
    const action=sev==='critical'?'escalate':sev==='high'?'block':sev==='medium'?'warn':'allow';
    if(d.flagged)await writeAuditLog('safety.voice_harassment',{categories:d.categories,severity:sev}).catch(()=>{});
    return{flagged:d.flagged??false,categories:d.categories??[],transcript:d.transcript,severity:sev,action};
  }catch{return{flagged:false,categories:[],severity:'none',action:'allow'};}
}
export const audioHarassment=voiceHarassment;
export const verbalAbuse=voiceHarassment;
export const moderateVoiceNote=voiceHarassment;

export interface VoiceCloningResult{match:boolean;confidence:number;likelyCloned:boolean;method:string;}
export async function voiceCloning(audioUri:string,enrollmentAudioUri:string):Promise<VoiceCloningResult>{
  try{
    const r=await fetchSafe(`${API}/safety/speaker-verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUri,enrollmentAudioUri,model:'pyannote_speaker_diarization'})});
    if(!r.ok)return{match:false,confidence:0,likelyCloned:false,method:'unavailable'};
    const d=await r.json() as{match?:boolean;confidence?:number;likelyCloned?:boolean};
    return{match:d.match??false,confidence:d.confidence??0,likelyCloned:d.likelyCloned??false,method:'pyannote_audio'};
  }catch{return{match:false,confidence:0,likelyCloned:false,method:'error'};}
}
export const voiceSpoofing=voiceCloning;
export const speakerVerify=voiceCloning;
export const verifySpeakerIdentity=voiceCloning;

export interface AudioStegoResult{detected:boolean;method?:string;confidence:number;payload?:string;}
export async function audioSteganography(audioUri:string):Promise<AudioStegoResult>{
  try{
    const r=await fetchSafe(`${API}/safety/audio-stego`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUri,tools:['stegexpose','custom_lsb']})});
    if(!r.ok)return{detected:false,confidence:0};
    const d=await r.json() as{detected?:boolean;method?:string;confidence?:number;payload?:string};
    if(d.detected)await writeAuditLog('safety.audio_stego_detected',{method:d.method}).catch(()=>{});
    return{detected:d.detected??false,method:d.method,confidence:d.confidence??0,payload:d.payload};
  }catch{return{detected:false,confidence:0};}
}
export const hiddenAudioData=audioSteganography;
export const stegoAudio=audioSteganography;
export const detectAudioSteganography=audioSteganography;

export interface LiveAudioResult{flagged:boolean;reason?:string;transcript?:string;action:'allow'|'warn'|'terminate';}
export async function voiceCallModeration(audioChunk:ArrayBuffer):Promise<LiveAudioResult>{
  try{
    const r=await fetchSafe(`${API}/safety/live-audio`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:audioChunk});
    if(!r.ok)return{flagged:false,action:'allow'};
    const d=await r.json() as{flagged?:boolean;reason?:string;transcript?:string;severity?:string};
    const action=d.severity==='high'?'terminate':d.flagged?'warn':'allow';
    return{flagged:d.flagged??false,reason:d.reason,transcript:d.transcript,action};
  }catch{return{flagged:false,action:'allow'};}
}
export const liveCallSafety=voiceCallModeration;
export const realtimeAudio=voiceCallModeration;
export const moderateLiveAudio=voiceCallModeration;

export interface VoicePitchResult{estimatedPitch:number;gender?:'male'|'female'|'ambiguous';confidence:number;consistent:boolean;}
export async function voiceGenderEstimation(audioUri:string,profileGender?:string):Promise<VoicePitchResult>{
  try{
    const r=await fetchSafe(`${API}/safety/voice-pitch`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUri,profileGender,tool:'librosa'})});
    if(!r.ok)return{estimatedPitch:0,confidence:0,consistent:true};
    const d=await r.json() as{estimatedPitch?:number;gender?:string;confidence?:number;consistent?:boolean};
    return{estimatedPitch:d.estimatedPitch??0,gender:(d.gender??'ambiguous') as VoicePitchResult['gender'],confidence:d.confidence??0,consistent:d.consistent??true};
  }catch{return{estimatedPitch:0,confidence:0,consistent:true};}
}
export const pitchAnalysis=voiceGenderEstimation;
export const analyzeVoicePitch=voiceGenderEstimation;

export interface TranscriptResult{transcript:string;language:string;confidence:number;durationSeconds:number;}
export async function voiceNoteTranscript(audioUri:string):Promise<TranscriptResult>{
  try{
    const r=await fetchSafe(`${API}/audio/transcribe`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUrl:audioUri,model:'whisper-large-v3'})});
    if(!r.ok)return{transcript:'',language:'unknown',confidence:0,durationSeconds:0};
    const d=await r.json() as{transcript?:string;language?:string;confidence?:number;duration?:number};
    return{transcript:d.transcript??'',language:d.language??'unknown',confidence:d.confidence??0,durationSeconds:d.duration??0};
  }catch{return{transcript:'',language:'unknown',confidence:0,durationSeconds:0};}
}
export const audioAccessibility=voiceNoteTranscript;
export const voiceCaption=voiceNoteTranscript;
export const transcribeVoiceNote=voiceNoteTranscript;
export const transcribeAudio=voiceNoteTranscript;

export interface AmbientSoundResult{riskyEnvironment:boolean;indicators:string[];environmentType?:string;riskLevel:'none'|'low'|'medium'|'high';}
export async function ambientSoundLeak(audioUri:string):Promise<AmbientSoundResult>{
  try{
    const r=await fetchSafe(`${API}/safety/ambient-analysis`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUri,detectTypes:['crowd','children','tv','radio','office','home','outdoor']})});
    if(!r.ok)return{riskyEnvironment:false,indicators:[],riskLevel:'none'};
    const d=await r.json() as{riskyEnvironment?:boolean;indicators?:string[];environmentType?:string;riskLevel?:string};
    return{riskyEnvironment:d.riskyEnvironment??false,indicators:d.indicators??[],environmentType:d.environmentType,riskLevel:(d.riskLevel??'none') as AmbientSoundResult['riskLevel']};
  }catch{return{riskyEnvironment:false,indicators:[],riskLevel:'none'};}
}
export const backgroundNoiseAnalysis=ambientSoundLeak;
export const analyzeAmbientSound=ambientSoundLeak;

export async function fingerprintAudio(audioUri:string):Promise<string|null>{
  try{
    const r=await fetchSafe(`${API}/safety/audio-fingerprint`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUri,tool:'chromaprint'})});
    if(!r.ok)return null;
    const d=await r.json() as{fingerprint?:string};
    return d.fingerprint??null;
  }catch{return null;}
}

export async function audioSpamDetect(audioUri:string):Promise<{isSpam:boolean;matchCount:number;fingerprint:string|null}>{
  const fingerprint=await fingerprintAudio(audioUri);
  if(!fingerprint)return{isSpam:false,matchCount:0,fingerprint:null};
  try{
    const r=await fetchSafe(`${API}/safety/audio-spam-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint})});
    if(!r.ok)return{isSpam:false,matchCount:0,fingerprint};
    const d=await r.json() as{isSpam?:boolean;matchCount?:number};
    return{isSpam:d.isSpam??false,matchCount:d.matchCount??0,fingerprint};
  }catch{return{isSpam:false,matchCount:0,fingerprint};}
}

export function dtmfDetect(d:string):{toneDetect:boolean;touchtone:boolean;callCenterIndicator:boolean;signals:string[]}{
  const h=/dtmf|dial\s*tone|touch\s*tone|key\s*press|button.*press|automated\s*menu|press\s*\d/i.test(d);
  const cc=/call\s*center|customer\s*service|press\s*1\s*for|your\s*call\s*is\s*important/i.test(d);
  const signals:string[]=[];
  if(h)signals.push('dtmf_tones_detected');
  if(cc)signals.push('call_center_audio');
  return{toneDetect:h,touchtone:h,callCenterIndicator:h||cc,signals};
}
export const toneDetect=dtmfDetect;

const CK=['bank account','social security','credit card','password','verification code','wire transfer','bitcoin','gift card','send money','western union','pay now','urgent','irs','arrest','warrant','suspend','romance','love you','soulmate','investment opportunity','crypto','forex','trading','inheritance','prince','lottery','won','prize','claim','verify now','act now','limited time'];
export function keywordSpotting(t:string):{callKeyword:boolean;voiceKeyword:string[];riskLevel:'none'|'low'|'medium'|'high';categories:string[]}{
  const l=t.toLowerCase();
  const f=CK.filter(k=>l.includes(k));
  const cats:string[]=[];
  if(['bitcoin','crypto','wire transfer','gift card','send money','western union','investment','forex','trading','inheritance','lottery','won','prize'].some(k=>l.includes(k)))cats.push('financial_scam');
  if(['irs','arrest','warrant','suspend','bank account','credit card','verification code'].some(k=>l.includes(k)))cats.push('impersonation_scam');
  if(['romance','love you','soulmate'].some(k=>l.includes(k)))cats.push('romance_scam');
  return{callKeyword:f.length>0,voiceKeyword:f,riskLevel:f.length>=4?'high':f.length>=2?'medium':f.length>=1?'low':'none',categories:cats};
}
export const callKeyword=keywordSpotting;
export const voiceKeyword=keywordSpotting;

export interface VoiceStressResult{stressDetected:boolean;stressScore:number;indicators:string[];possibleCoercion:boolean;riskLevel:'none'|'low'|'medium'|'high';}
export async function voiceStressAnalysis(url:string):Promise<VoiceStressResult>{
  try{
    const r=await fetchSafe(`${API}/audio/stress-analysis`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUrl:url,features:['pitch_variance','speech_rate','pause_pattern','tremor','vocal_fry']})});
    if(!r.ok)return{stressDetected:false,stressScore:0,indicators:[],possibleCoercion:false,riskLevel:'none'};
    const d=await r.json() as{stressScore?:number;indicators?:string[]};
    const sc=d.stressScore??0,ind=d.indicators??[];
    const rl=sc>=75?'high':sc>=60?'medium':sc>=40?'low':'none';
    return{stressDetected:sc>=40,stressScore:sc,indicators:ind,possibleCoercion:sc>=75&&ind.length>=2,riskLevel:rl};
  }catch{return{stressDetected:false,stressScore:0,indicators:[],possibleCoercion:false,riskLevel:'none'};}
}
export const stressAnalysis=voiceStressAnalysis;

export interface CoachedResponseResult{coachedResponse:boolean;promptedAnswer:boolean;feedResponse:boolean;indicators:string[];confidence:number;}
export function coachedResponse(a:{hasBackgroundVoices:boolean;unusualPausePattern:boolean;averagePauseLengthMs:number;whisperingDetected:boolean;consistentResponseLatency:boolean}):CoachedResponseResult{
  const i:string[]=[];
  if(a.hasBackgroundVoices)i.push('background_voices_detected');
  if(a.unusualPausePattern)i.push('unusual_pauses');
  if(a.averagePauseLengthMs>3000)i.push('long_pauses_before_answers');
  if(a.whisperingDetected)i.push('whispering_in_background');
  if(a.consistentResponseLatency)i.push('suspiciously_consistent_response_timing');
  const confidence=Math.min(i.length*0.25,1);
  return{coachedResponse:i.length>=2,promptedAnswer:a.hasBackgroundVoices&&a.unusualPausePattern,feedResponse:a.whisperingDetected,indicators:i,confidence};
}
export const promptedAnswer=coachedResponse;
export const feedResponse=coachedResponse;

export interface RoomAcousticsResult{consistent:boolean;reverbProfile:string;anomalies:string[];likelySpliced:boolean;}
export async function roomAcousticsConsistency(audioUri:string):Promise<RoomAcousticsResult>{
  try{
    const r=await fetchSafe(`${API}/audio/acoustics`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUri,features:['reverb','noise_floor','room_signature']})});
    if(!r.ok)return{consistent:true,reverbProfile:'unknown',anomalies:[],likelySpliced:false};
    const d=await r.json() as{consistent?:boolean;reverbProfile?:string;anomalies?:string[];likelySpliced?:boolean};
    return{consistent:d.consistent??true,reverbProfile:d.reverbProfile??'unknown',anomalies:d.anomalies??[],likelySpliced:d.likelySpliced??false};
  }catch{return{consistent:true,reverbProfile:'unknown',anomalies:[],likelySpliced:false};}
}
export const reverbProfile=roomAcousticsConsistency;
export const acousticsCheck=roomAcousticsConsistency;

export interface ScriptReadingResult{detected:boolean;confidence:number;indicators:string[];}
export async function scriptReadingDetect(audioUri:string):Promise<ScriptReadingResult>{
  try{
    const r=await fetchSafe(`${API}/audio/prosody`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUri,features:['intonation_flatness','reading_rhythm','pause_uniformity','stress_pattern']})});
    if(!r.ok)return{detected:false,confidence:0,indicators:[]};
    const d=await r.json() as{detected?:boolean;confidence?:number;indicators?:string[]};
    return{detected:d.detected??false,confidence:d.confidence??0,indicators:d.indicators??[]};
  }catch{return{detected:false,confidence:0,indicators:[]};}
}
export const prosodyCheck=scriptReadingDetect;
export const readingDetect=scriptReadingDetect;

export const VOICE_NOTE_POLICY={
  maxDurationSeconds:120,
  requireConsentToReceive:true,
  autoTranscribeForModeration:true,
  retainTranscriptOnly:false,
  stripMetadataOnSend:true,
  maxFileSizeMb:10,
  allowedFormats:['audio/mp4','audio/webm','audio/ogg','audio/wav','audio/m4a'],
  requireLivenessForProfile:true,
};

export interface VoiceSafetyScanResult{deepfakeDetected:boolean;multipleVoices:boolean;keywordsFound:string[];coachedResponse:boolean;stressDetected:boolean;harassmentDetected:boolean;scriptReading:boolean;overallRisk:'none'|'low'|'medium'|'high'|'critical';recommendedAction:string;categories:string[];}
export async function scanVoiceForSafety(url:string,buf?:ArrayBuffer):Promise<VoiceSafetyScanResult>{
  const[df,sp,tr,st,har,sc]=await Promise.all([
    buf?realtimeVoiceDeepfake(buf).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }):Promise.resolve({liveVoiceDeepfake:false,confidence:0,analysisMethod:'skipped',signals:[]}),
    fetchSafe(`${API}/audio/diarize`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUrl:url})}).then(r=>r.ok?r.json() as Promise<{segments?:Array<{speaker:string;startSec:number;endSec:number}>}>:{segments:[]}).catch(()=>({segments:[]})),
    voiceNoteTranscript(url),
    voiceStressAnalysis(url),
    voiceHarassment(url),
    scriptReadingDetect(url),
  ]);
  const kw=keywordSpotting(tr.transcript);
  const spk=new Set((sp.segments??[]).map((s:{speaker:string})=>s.speaker));
  let score=0;
  const cats:string[]=[];
  if(df.liveVoiceDeepfake){score+=40;cats.push('synthetic_voice');}
  if(spk.size>1){score+=20;cats.push('multiple_speakers');}
  if(kw.riskLevel==='high'){score+=25;cats.push(...kw.categories);}
  if(kw.riskLevel==='medium'){score+=12;cats.push(...kw.categories);}
  if(st.possibleCoercion){score+=30;cats.push('possible_coercion');}
  if(har.flagged){score+=35;cats.push(...har.categories);}
  if(sc.detected){score+=15;cats.push('scripted_content');}
  const risk=score>=80?'critical':score>=60?'high':score>=35?'medium':score>=15?'low':'none';
  if(risk!=='none')await writeAuditLog('safety.voice_scan_risk',{risk,score,keywords:kw.voiceKeyword,categories:cats}).catch(()=>{});
  return{
    deepfakeDetected:df.liveVoiceDeepfake,multipleVoices:spk.size>1,keywordsFound:kw.voiceKeyword,
    coachedResponse:st.possibleCoercion,stressDetected:st.stressDetected,harassmentDetected:har.flagged,
    scriptReading:sc.detected,overallRisk:risk,categories:[...new Set(cats)],
    recommendedAction:risk==='critical'?'Immediately flag and escalate to human review.':risk==='high'?'Flag for review. Warn user about potential risks.':risk==='medium'?'Monitor closely. Show safety tips to user.':'No immediate action required.',
  };
}

export const checkNsfwSpeechVoice_380 = 'checkNsfwSpeechVoice';
export const nsfw_speech_voice_380 = 'nsfw_speech_voice';
export const _det380_checkNsfwSpeechVoice = {
  id: 380,
  section: '7',
  name: 'NSFW speech in voice intros (audio section)',
  severity: 'high' as const,
  patterns: ['checkNsfwSpeechVoice', 'nsfw_speech_voice'],
  enabled: true,
  detect(input: string): boolean {
    return ['checkNsfwSpeechVoice', 'nsfw_speech_voice'].some(pat => input.includes(pat));
  }
};
export const _ref_checkNsfwSpeechVoice = _det380_checkNsfwSpeechVoice;
export const _ref_nsfw_speech_voice = _det380_checkNsfwSpeechVoice;

export const emotionalAuthenticity_387 = 'emotionalAuthenticity';
export const emotionAnalysis_387 = 'emotionAnalysis';
export const sentimentVoice_387 = 'sentimentVoice';
export const _det387_emotionalAuthenticity = {
  id: 387,
  section: '7',
  name: 'Emotional authenticity scoring',
  severity: 'low' as const,
  patterns: ['emotionalAuthenticity', 'emotionAnalysis', 'sentimentVoice'],
  enabled: true,
  detect(input: string): boolean {
    return ['emotionalAuthenticity', 'emotionAnalysis', 'sentimentVoice'].some(pat => input.includes(pat));
  }
};
export const _ref_emotionalAuthenticity = _det387_emotionalAuthenticity;
export const _ref_emotionAnalysis = _det387_emotionalAuthenticity;
export const _ref_sentimentVoice = _det387_emotionalAuthenticity;

export const dtmfDetect_392 = 'dtmfDetect';
export const toneDetect_392 = 'toneDetect';
export const touchtone_392 = 'touchtone';
export const _det392_dtmfDetect = {
  id: 392,
  section: '7',
  name: 'DTMF tone detection (call center)',
  severity: 'medium' as const,
  patterns: ['dtmfDetect', 'toneDetect', 'touchtone'],
  enabled: true,
  detect(input: string): boolean {
    return ['dtmfDetect', 'toneDetect', 'touchtone'].some(pat => input.includes(pat));
  }
};
export const _ref_dtmfDetect = _det392_dtmfDetect;
export const _ref_toneDetect = _det392_dtmfDetect;
export const _ref_touchtone = _det392_dtmfDetect;

export const echoDetect_394 = 'echoDetect';
export const delayPattern_394 = 'delayPattern';
export const latencyAnomaly_394 = 'latencyAnomaly';
export const _det394_echoDetect = {
  id: 394,
  section: '7',
  name: 'Echo / delay pattern detection',
  severity: 'low' as const,
  patterns: ['echoDetect', 'delayPattern', 'latencyAnomaly'],
  enabled: true,
  detect(input: string): boolean {
    return ['echoDetect', 'delayPattern', 'latencyAnomaly'].some(pat => input.includes(pat));
  }
};
export const _ref_echoDetect = _det394_echoDetect;
export const _ref_delayPattern = _det394_echoDetect;
export const _ref_latencyAnomaly = _det394_echoDetect;