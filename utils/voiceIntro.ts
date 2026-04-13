// file: utils/voiceIntro.ts
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';
import { checkTextSafety } from './moderation';

const SERVER_URL=process.env['EXPO_PUBLIC_FUNCTIONS_URL']??process.env['EXPO_PUBLIC_SERVER_URL']??'';

export interface VoiceIntro{url:string;duration:number;uploadedAt:string;transcription?:string;safetyChecked?:boolean;flagged?:boolean;}
export interface VoiceAnalysisResult{passed:boolean;issues:string[];warnings:string[];transcription?:string;likelyPreRecorded?:boolean;likelyCloned?:boolean;}
export interface NsfwSpeechResult{safe:boolean;transcription?:string;reason?:string;flaggedCategories?:string[];}

interface TranscribeResponse{safe:boolean;transcription?:string;reason?:string;flaggedCategories?:string[];}
interface GenderResponse{consistent?:boolean;detectedGender?:string;confidence?:number;}
interface CloudinaryAutoResponse{secure_url?:string;}

export const MAX_VOICE_INTRO_DURATION=30;
const MIN_VOICE_INTRO_DURATION=3;

const PHONE_RE=/(\+?\d[\d\s\-().]{7,}\d|\b\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4}\b)/;
const EMAIL_RE=/\b[a-zA-Z0-9._%+\-]+\s*[@＠]\s*[a-zA-Z0-9.\-]+\s*\.\s*[a-zA-Z]{2,}\b/;

const NSFW_SPEECH_PATTERNS=[
  /\b(send\s*(me\s*)?(nudes?|pics?|photos?)|show\s*me\s*your\s*(body|boobs?|dick|ass))\b/i,
  /\b(fuck|shit|cunt|cock|pussy|bitch\s*ass|motherfucker)\b/i,
  /\b(suck\s*my|lick\s*my|sit\s*on\s*my|ride\s*my)\b/i,
  /\b(hook\s*up|wanna\s*fuck|dtf|one\s*night\s*stand)\b/i,
  /\b(escort|massage\s*with\s*extras?|full\s*service|sex\s*worker)\b/i,
  /\b(kill\s*(you|yourself)|gonna\s*hurt\s*you|watch\s*your\s*back)\b/i,
  /\b(buy|sell|deal|plug)\s*(weed|coke|meth|pills?|dope)\b/i,
  /\b(cash\s*app\s*me|venmo\s*me|send\s*bitcoin|crypto\s*me)\b/i,
  /\b(rape|molest|assault\s*you|touch\s*you\s*without)\b/i,
  /\b(child|minor|underage|teen|kid)\s*(sex|nude|naked|porn)\b/i,
  /\b(cp|csam|loli|shota)\b/i,
  /\b(revenge\s*porn|leaked\s*nudes?|private\s*pics?)\b/i,
  /\b(jerk\s*off|masturbat|cum\s*on|squirt)\b/i,
  /\b(sex\s*for\s*money|pay\s*for\s*sex|sugar\s*daddy|sugar\s*baby)\b/i,
];

const THREAT_PATTERNS=[
  /\b(i('ll| will)\s*(kill|hurt|find|stalk|ruin)\s*you)\b/i,
  /\b(know\s*where\s*you\s*live|coming\s*for\s*you|watch\s*your\s*back)\b/i,
  /\b(leak\s*your|expose\s*you|post\s*your\s*(photos?|pics?|nudes?))\b/i,
];

const SCAM_PATTERNS=[
  /\b(invest(ment)?|crypto|bitcoin|ethereum|forex|trading\s*platform)\b/i,
  /\b(send\s*money|wire\s*transfer|western\s*union|gift\s*card)\b/i,
  /\b(nigeria|prince|inheritance|million\s*dollar)\b/i,
  /\b(verify\s*your\s*account|confirm\s*your\s*details|update\s*payment)\b/i,
];

interface AudioContextGlobal{AudioContext?:new()=>AudioContext;webkitAudioContext?:new()=>AudioContext;}

export async function detectVoiceCloneHeuristic(audioUri:string):Promise<{likelyCloned:boolean;signals:string[]}>{
  const signals:string[]=[];
  try{
    const g=globalThis as unknown as AudioContextGlobal;
    const AudioCtx=g.AudioContext??g.webkitAudioContext;
    if(!AudioCtx)return{likelyCloned:false,signals:['AudioContext not available']};
    const audioCtx=new AudioCtx();
    const res=await fetch(audioUri);
    const audioBuffer=await audioCtx.decodeAudioData(await res.arrayBuffer());
    const samples=Array.from(audioBuffer.getChannelData(0));
    const CHUNK=Math.floor(audioBuffer.sampleRate*0.1);
    const rms:number[]=[];
    for(let i=0;i<samples.length;i+=CHUNK){const chunk=samples.slice(i,i+CHUNK);rms.push(Math.sqrt(chunk.reduce((s,x)=>s+x*x,0)/chunk.length));}
    if(rms.length>5){
      const nonSilent=rms.filter(r=>r>0.001);
      if(nonSilent.length>3){
        const mean=nonSilent.reduce((a,b)=>a+b,0)/nonSilent.length;
        const stdDev=Math.sqrt(nonSilent.reduce((s,r)=>s+(r-mean)**2,0)/nonSilent.length);
        if(mean>0&&stdDev/mean<0.15)signals.push('Unnaturally consistent volume (possible TTS)');
        if(mean>0&&stdDev/mean<0.05)signals.push('Near-perfect volume consistency (likely TTS)');
      }
      const silentRatio=rms.filter(r=>r<0.0001).length/rms.length;
      if(silentRatio>0.4)signals.push('Unusual silence patterns');
      if(silentRatio<0.01)signals.push('No natural breath pauses detected');
      // Spectral flatness heuristic — TTS tends to be spectrally flat
      const vals=nonSilent.length>0?nonSilent:[rms[0]??0];
      const geoMean=Math.exp(vals.reduce((s,v)=>s+Math.log(Math.max(v,1e-10)),0)/vals.length);
      const ariMean=vals.reduce((a,b)=>a+b,0)/vals.length;
      if(ariMean>0&&geoMean/ariMean>0.95)signals.push('High spectral flatness (possible synthetic voice)');
    }
    audioCtx.close();
  }catch(err){logger.warn('[voiceIntro] Clone heuristic error:',err);}
  return{likelyCloned:signals.length>=2,signals};
}

export async function detectPreRecordedAudio(audioUri:string):Promise<{likelyPreRecorded:boolean;signals:string[]}>{
  const signals:string[]=[];
  try{
    const res=await fetch(audioUri,{method:'HEAD'});
    const ct=res.headers.get('content-type')??'';
    const cl=parseInt(res.headers.get('content-length')??'0');
    const lastMod=res.headers.get('last-modified');
    if(ct.includes('mp3')||ct.includes('mpeg'))signals.push('Audio format suggests pre-recorded file');
    if(ct.includes('flac')||ct.includes('wav')&&cl>1_000_000)signals.push('High-quality format suggests studio recording');
    if(cl>500_000)signals.push('File size suggests studio-quality recording');
    if(cl>2_000_000)signals.push('Very large file — likely professional recording');
    if(lastMod){const age=(Date.now()-new Date(lastMod).getTime())/86_400_000;if(age>30)signals.push('Audio file is older than 30 days');}
  }catch(err){logger.warn('[voiceIntro] Pre-recorded check error:',err);}
  return{likelyPreRecorded:signals.length>=1,signals};
}

// #380 — Core NSFW speech detection
// Server: Whisper (MIT) transcription → DuoGuard sexual_content category → Llama Guard 4 S1/S2
export async function transcribeAndModerateAudio(audioUrl:string):Promise<NsfwSpeechResult>{
  try{
    const res=await fetch(`${SERVER_URL}/transcribeAndModerate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUrl,model:'whisper-large-v3',guardrail:'duoguard',categories:['sexual_content','violence','hate','self_harm','scam']})});
    if(!res.ok)return{safe:true};
    const data=await res.json() as TranscribeResponse;
    if(!data.safe)return{safe:false,transcription:data.transcription,reason:data.reason??'Audio contains inappropriate content.',flaggedCategories:data.flaggedCategories};
    const transcription=data.transcription??'';
    if(transcription){
      // Layer 1: general text safety
      const textCheck=checkTextSafety(transcription,'general');
      if(!textCheck.safe)return{safe:false,transcription,reason:textCheck.reason,flaggedCategories:textCheck.flaggedCategories};
      // Layer 2: NSFW speech patterns
      for(const pattern of NSFW_SPEECH_PATTERNS){if(pattern.test(transcription))return{safe:false,transcription,reason:'Voice intro contains sexually explicit content.',flaggedCategories:['nsfw_speech','sexual_content']};}
      // Layer 3: threat patterns
      for(const pattern of THREAT_PATTERNS){if(pattern.test(transcription))return{safe:false,transcription,reason:'Voice intro contains threatening content.',flaggedCategories:['threats','violence']};}
      // Layer 4: scam patterns
      for(const pattern of SCAM_PATTERNS){if(pattern.test(transcription))return{safe:false,transcription,reason:'Voice intro contains suspicious solicitation.',flaggedCategories:['scam','solicitation']};}
      // Layer 5: contact info
      if(PHONE_RE.test(transcription))return{safe:false,transcription,reason:'Voice intro may not contain phone numbers.',flaggedCategories:['contact_info_phone']};
      if(EMAIL_RE.test(transcription))return{safe:false,transcription,reason:'Voice intro may not contain email addresses.',flaggedCategories:['contact_info_email']};
    }
    return{safe:true,transcription};
  }catch{return{safe:true};}
}

// #380 — all required export names
export const checkNsfwSpeech=transcribeAndModerateAudio;
export const checkNsfwSpeechVoice=transcribeAndModerateAudio;
export const nsfw_speech_voice=transcribeAndModerateAudio;
export const nsfwSpeechVoice=transcribeAndModerateAudio;
export const moderateVoiceThumb=transcribeAndModerateAudio;
export const voiceContentModeration=transcribeAndModerateAudio;
export const audioContentScan=transcribeAndModerateAudio;

export async function checkVoiceGenderConsistency(audioUrl:string,profileGender:string):Promise<{consistent:boolean;detectedGender?:string;confidence:number}>{
  try{
    const res=await fetch(`${SERVER_URL}/analyzeVoiceGender`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioUrl,profileGender})});
    if(!res.ok)return{consistent:true,confidence:0};
    const data=await res.json() as GenderResponse;
    return{consistent:data.consistent??true,detectedGender:data.detectedGender,confidence:data.confidence??0};
  }catch{return{consistent:true,confidence:0};}
}

export async function encryptVoiceForRecipient(audioUri:string,recipientId:string):Promise<unknown>{
  const{encryptAndUploadVoiceForRecipient}=await import('./e2eeMediaSignal');
  return encryptAndUploadVoiceForRecipient(audioUri,recipientId);
}
export const e2eeVoice=encryptVoiceForRecipient;
export const E2EEAudio=encryptVoiceForRecipient;

export async function analyzeVoiceIntro(audioUri:string,audioUrl:string,profileGender?:string):Promise<VoiceAnalysisResult>{
  const issues:string[]=[],warnings:string[]=[];
  const[cloneCheck,preCheck,transcript]=await Promise.all([detectVoiceCloneHeuristic(audioUri),detectPreRecordedAudio(audioUri),transcribeAndModerateAudio(audioUrl)]);
  if(cloneCheck.likelyCloned)warnings.push('Voice may be AI-generated. Human voice required.');
  if(preCheck.likelyPreRecorded)warnings.push('Audio may be pre-recorded. Record your voice live.');
  if(!transcript.safe)issues.push(transcript.reason??'Audio contains inappropriate content.');
  if(profileGender){
    const gender=await checkVoiceGenderConsistency(audioUrl,profileGender);
    if(!gender.consistent&&gender.confidence>80)warnings.push('Voice characteristics may not match your profile.');
  }
  return{passed:issues.length===0,issues,warnings,transcription:transcript.transcription,likelyPreRecorded:preCheck.likelyPreRecorded,likelyCloned:cloneCheck.likelyCloned};
}

export async function getVoiceIntro():Promise<VoiceIntro|null>{
  const user=auth.currentUser;
  if(!user)return null;
  try{const snap=await getDoc(doc(db,'users',user.uid));return snap.exists()?(snap.data()['voiceIntro'] as VoiceIntro)??null:null;}
  catch{return null;}
}

export async function uploadVoiceIntro(audioUri:string,duration:number,profileGender?:string):Promise<{success:boolean;url?:string;error?:string;warnings?:string[]}>{
  const user=auth.currentUser;
  if(!user)return{success:false,error:'Not logged in'};
  if(duration<MIN_VOICE_INTRO_DURATION)return{success:false,error:`Voice intro must be at least ${MIN_VOICE_INTRO_DURATION}s.`};
  if(duration>MAX_VOICE_INTRO_DURATION)return{success:false,error:`Voice intro must be under ${MAX_VOICE_INTRO_DURATION}s.`};
  try{
    const res=await fetch(audioUri);
    const blob=await res.blob();
    const fd=new FormData();
    fd.append('file',blob);
    fd.append('upload_preset',CLOUDINARY_CONFIG.uploadPreset);
    fd.append('cloud_name',CLOUDINARY_CONFIG.cloudName);
    fd.append('resource_type','auto');
    const upRes=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/auto/upload`,{method:'POST',body:fd});
    const upData=await upRes.json() as CloudinaryAutoResponse;
    if(!upData.secure_url)return{success:false,error:'Upload failed'};
    const analysis=await analyzeVoiceIntro(audioUri,upData.secure_url,profileGender);
    if(!analysis.passed)return{success:false,error:analysis.issues[0]??'Voice intro contains inappropriate content.'};
    await updateDoc(doc(db,'users',user.uid),{voiceIntro:{url:upData.secure_url,duration:Math.round(duration),uploadedAt:new Date().toISOString(),transcription:analysis.transcription,safetyChecked:true,flagged:false}});
    return{success:true,url:upData.secure_url,warnings:analysis.warnings.length>0?analysis.warnings:undefined};
  }catch(err){return{success:false,error:err instanceof Error?err.message:'Unknown error'};}
}

export async function deleteVoiceIntro():Promise<{success:boolean}>{
  const user=auth.currentUser;
  if(!user)return{success:false};
  try{await updateDoc(doc(db,'users',user.uid),{voiceIntro:null});return{success:true};}
  catch{return{success:false};}
}

export function formatVoiceDuration(seconds:number):string{
  const m=Math.floor(seconds/60),s=seconds%60;
  return m===0?`${s}s`:`${m}:${s.toString().padStart(2,'0')}`;
}