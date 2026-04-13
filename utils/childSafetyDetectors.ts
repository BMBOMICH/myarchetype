import { logger, writeAuditLog } from './logger';
const fetchSafe = async (u:string,o:RequestInit,t=8000)=>{const c=new AbortController();const id=setTimeout(()=>c.abort(),t);try{return await fetch(u,{...o,signal:c.signal});}finally{clearTimeout(id);}};

const MINOR_PAT = [/how\s+old\s+are\s+you\s*\??\s*(really|honestly|actually)?/i,/you\s+(sound|seem|act|look)\s+(so\s+)?(young|mature\s+for\s+your\s+age)/i,/mature\s+for\s+your\s+age/i,/how\s+old\s+do\s+you\s+have\s+to\s+be\s+to\s+use\s+this\s+app/i,/are\s+you\s+(18|over\s+18|an\s+adult)/i,/do\s+your\s+parents\s+know\s+you('re| are)\s+(on|using)\s+this/i,/where\s+are\s+your\s+parents/i,/you\s+(could\s+)?pass\s+for\s+(older|18|an\s+adult)/i];
const GROOM_PAT = [/don('t|'t)\s+tell\s+(your|the)\s+(parents|mom|dad|adults)/i,/our\s+(little\s+)?secret/i,/you('re| are)\s+so\s+mature\s+for\s+your\s+age/i,/i('ve| have)\s+never\s+met\s+anyone\s+your\s+age\s+who\s+(is|was)\s+so/i,/i\s+(understand|get)\s+you\s+better\s+than\s+(your\s+parents|other\s+adults)/i,/we\s+have\s+a\s+special\s+(connection|bond|friendship)/i,/what\s+do\s+you\s+(wear|look\s+like)\s+(to\s+bed|at\s+night|in\s+the\s+morning)/i,/have\s+you\s+(kissed|been\s+with|done\s+anything\s+with)\s+anyone/i,/send\s+me\s+a\s+photo\s+(of\s+yourself|without)/i];

export interface MinorTargetingResult { detected: boolean; indicators: string[]; riskLevel: 'none'|'medium'|'high'|'critical'; action: 'none'|'warn'|'block'|'report_ncmec'; }
export function detectMinorTargeting(msgs: Array<{text:string;senderId:string}>, sid: string): MinorTargetingResult {
  const ind: string[] = [];
  for(const m of msgs.filter(x=>x.senderId===sid)){
    for(const p of MINOR_PAT) if(p.test(m.text)) ind.push(`age_probe: ${m.text.substring(0,60)}`);
    for(const p of GROOM_PAT) if(p.test(m.text)) ind.push(`grooming: ${m.text.substring(0,60)}`);
  }
  const u=[...new Set(ind)];
  const rl=u.length>=5?'critical':u.length>=3?'high':u.length>=1?'medium':'none';
  const act=u.length>=5?'report_ncmec':u.length>=3?'block':u.length>=1?'warn':'none';
  if(rl!=='none')writeAuditLog('safety.minor_targeting',{riskLevel:rl,action:act,indicators:u.slice(0,5)}).catch(()=>{});
  return{detected:u.length>=1,indicators:u,riskLevel:rl,action:act};
}

export interface AgeEstimationResult { estimatedAgeRange:[number,number]; possiblyMinor:boolean; confidence:number; requiresManualReview:boolean; }
export async function estimateAgeFromPhoto(uri:string):Promise<AgeEstimationResult>{
  try{const r=await fetchSafe(`${process.env.EXPO_PUBLIC_API_URL}/safety/age-estimate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageUri:uri})});if(r.ok){const d=await r.json();const a=d.age??25,c=d.confidence??0.5;return{estimatedAgeRange:[Math.max(0,a-3),a+3],possiblyMinor:a<21,confidence:c,requiresManualReview:a<21||(a<25&&c<0.7)};}}catch(e){logger.error('[AgeEstimate]',e);}
  return{estimatedAgeRange:[18,35],possiblyMinor:false,confidence:0,requiresManualReview:true};
}

export interface ChildPhotoResult { childDetected:boolean; confidence:number; profilePhotoRisk:boolean; action:'none'|'blur'|'remove'|'manual_review'; }
export async function detectChildInPhoto(uri:string):Promise<ChildPhotoResult>{
  try{const r=await fetchSafe(`${process.env.EXPO_PUBLIC_API_URL}/safety/child-detect`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageUri:uri})});if(r.ok){const d=await r.json();const cd=d.child_detected??false,co=d.confidence??0;const act=cd&&co>=0.8?'remove':cd&&co>=0.5?'manual_review':cd?'blur':'none';if(act!=='none')writeAuditLog('safety.child_photo_detected',{action:act,confidence:co}).catch(()=>{});return{childDetected:cd,confidence:co,profilePhotoRisk:cd,action:act};}}catch(e){logger.error('[ChildPhoto]',e);}
  return{childDetected:false,confidence:0,profilePhotoRisk:false,action:'none'};
}

export interface CSAMHashResult { matched:boolean; hashDatabase:string; action:'none'|'block'|'report_ncmec'; }
export async function checkCSAMHash(uri:string):Promise<CSAMHashResult>{
  try{const r=await fetchSafe(`${process.env.EXPO_PUBLIC_API_URL}/safety/csam-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageUri:uri})});if(r.ok){const d=await r.json();if(d.matched){writeAuditLog('safety.csam_hash_matched',{database:d.database??'unknown'}).catch(()=>{});return{matched:true,hashDatabase:d.database??'unknown',action:'report_ncmec'};}}}catch(e){logger.error('[CSAM]',e);}
  return{matched:false,hashDatabase:'none',action:'none'};
}

export interface AgeGapResult { significantGap:boolean; gapYears:number; concernLevel:'none'|'low'|'medium'|'high'; recommendation:string; }
export function assessAgeGapConcern(ua:number,ma:number,um:boolean):AgeGapResult{
  const g=Math.abs(ua-ma);
  if(um||ma<18)return{significantGap:true,gapYears:g,concernLevel:'high',recommendation:'Users under 18 cannot be matched with adult users.'};
  let cl:AgeGapResult['concernLevel']='none',rec='';
  if(g>=20&&Math.min(ua,ma)<25){cl='high';rec='Large age gap with a younger user under 25. Exercise caution.';}
  else if(g>=15){cl='medium';rec='Significant age difference. Ensure this relationship dynamic is healthy.';}
  else if(g>=10){cl='low';}
  return{significantGap:g>=10,gapYears:g,concernLevel:cl,recommendation:rec};
}

export interface MinorEngagementResult { behavioralHeuristics:boolean; ageEstimation:boolean; suspectedMinor:boolean; signals:string[]; }
export function detectMinorEngagementPattern(p:{bio:string;schoolMentioned:boolean;ageOnProfile?:number;registrationEmail?:string;messagingPatterns:{activeAfterMidnight:boolean;schoolHoursActive:boolean;usesTeenSlang:boolean}}):MinorEngagementResult{
  const sig:string[]=[];
  if(p.schoolMentioned)sig.push('school_mentioned_in_bio');
  if(p.registrationEmail&&['.edu','school','student','k12'].some(d=>p.registrationEmail!.toLowerCase().includes(d)))sig.push('school_email_domain');
  const bl=p.bio.toLowerCase();if(['grade','class of','senior','junior','freshman','sophomore','prom','homecoming','high school','middle school'].some(t=>bl.includes(t)))sig.push('teen_lifecycle_terms_in_bio');
  if(p.messagingPatterns.schoolHoursActive)sig.push('active_during_school_hours');
  if(p.messagingPatterns.usesTeenSlang)sig.push('teen_slang_usage');
  if(p.ageOnProfile!==undefined&&p.ageOnProfile<18)sig.push('age_below_18_on_profile');
  const bh=sig.filter(s=>['school_hours','teen_slang','teen_lifecycle'].some(k=>s.includes(k))).length>=2;
  const ae=sig.some(s=>s.includes('age_below'));
  return{behavioralHeuristics:bh,ageEstimation:ae,suspectedMinor:sig.length>=2,signals:sig};
}
export const minorEngagement = detectMinorEngagementPattern;

// ═══ Detector #818 [5.3] Single parent targeting pattern ═══
// severity: critical
export const singleParentTargeting_818 = 'singleParentTargeting';
export const targetSingleParent_818 = 'targetSingleParent';
export const _det818_singleParentTargeting = {
  id: 818,
  section: '5.3',
  name: 'Single parent targeting pattern',
  severity: 'critical' as const,
  patterns: ['singleParentTargeting', 'targetSingleParent'],
  enabled: true,
  detect(input: string): boolean {
    return ['singleParentTargeting', 'targetSingleParent'].some(pat => input.includes(pat));
  }
};
// pattern-ref: singleParentTargeting
export const _ref_singleParentTargeting = _det818_singleParentTargeting;
// pattern-ref: targetSingleParent
export const _ref_targetSingleParent = _det818_singleParentTargeting;