import { collection, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { writeAuditLog } from './logger';

async function stSim(a:string,b:string):Promise<number>{try{const r=await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/ml/similarity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text_a:a,text_b:b}),signal:AbortSignal.timeout(5000)});if(r.ok)return(await r.json() as{similarity:number}).similarity;}catch{}const sa=new Set(a.toLowerCase().split(/\s+/)),sb=new Set(b.toLowerCase().split(/\s+/)),i=[...sa].filter(w=>sb.has(w)).length,u=new Set([...sa,...sb]).size;return u>0?i/u:0;}
async function batchSim(query:string,corpus:string[]):Promise<{maxScore:number;bestMatch:string;idx:number}>{try{const r=await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/ml/batch-similarity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,corpus}),signal:AbortSignal.timeout(8000)});if(r.ok){const d=await r.json() as{scores:number[]};let mx=0,bi=-1;for(let i=0;i<d.scores.length;i++)if(d.scores[i]!>mx){mx=d.scores[i]!;bi=i;}return{maxScore:mx,bestMatch:corpus[bi]??'',idx:bi};}}catch{}let mx=0,bm='',bi=-1;for(let i=0;i<corpus.length;i++){const s=await stSim(query,corpus[i]!);if(s>mx){mx=s;bm=corpus[i]!;bi=i;}}return{maxScore:mx,bestMatch:bm,idx:bi};}
async function presidio(text:string):Promise<Array<{entity_type:string;text:string;score:number;start:number;end:number}>>{try{const r=await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/pii/detect`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,language:'en'}),signal:AbortSignal.timeout(5000)});if(r.ok)return(await r.json() as{entities:Array<{entity_type:string;text:string;score:number;start:number;end:number}>}).entities;}catch{}const o:Array<{entity_type:string;text:string;score:number;start:number;end:number}>=[];const rs:[RegExp,string,number][]=[[/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,'PHONE_NUMBER',0.7],[/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,'EMAIL',0.8],[/\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|court|ct)/gi,'ADDRESS',0.75],[/\d{3}-\d{2}-\d{4}/g,'SSN',0.9]];for(const[re,tp,sc]of rs){let m:RegExpExecArray|null;while((m=re.exec(text))!==null)o.push({entity_type:tp,text:m[0],score:sc,start:m.index,end:m.index+m[0].length});}return o;}
async function whisper(url:string):Promise<{text:string;language:string;confidence:number}>{try{const r=await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/audio/transcribe`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio_url:url,model:'whisper-1'}),signal:AbortSignal.timeout(15000)});if(r.ok)return await r.json() as{text:string;language:string;confidence:number};}catch{}return{text:'',language:'unknown',confidence:0};}
function cosSim(a:number[],b:number[]):number{if(!a.length||a.length!==b.length)return 0;let d=0,nA=0,nB=0;for(let i=0;i<a.length;i++){d+=a[i]!*b[i]!;nA+=a[i]!**2;nB+=b[i]!**2;}const dn=Math.sqrt(nA)*Math.sqrt(nB);return dn===0?0:d/dn;}
async function faceCmp(a:number[],b:number[]):Promise<{similarity:number;verified:boolean}>{if(!a.length||!b.length||a.length!==b.length)return{similarity:0,verified:false};try{const r=await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/face/compare`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({embedding_a:a,embedding_b:b}),signal:AbortSignal.timeout(5000)});if(r.ok)return await r.json() as{similarity:number;verified:boolean};}catch{}const s=cosSim(a,b);return{similarity:s,verified:s>=0.85};}

const REVENGE_SCRIPTS=["I have your nudes and I'm going to post them online unless you pay me","Send me money or I'll share your intimate photos with your family","I still have the screenshots from our video calls. You know what I want","Pay up or everyone sees everything. Your choice.","I've uploaded your photos to a website. Pay me to take them down.","You shouldn't have sent those pictures. Now you have to do what I say."];
const SEXTORTION_SCRIPTS=["I recorded you on camera. Send $500 in bitcoin or I send it to everyone","I have compromising footage. Transfer money or your family and employer will receive it","I know what you did on camera. Pay me in gift cards or I release everything","Your private videos are in my possession. Comply with my demands or face consequences","I hacked your webcam and recorded everything. Send cryptocurrency to this address"];
const HARASS_SCRIPTS=["You'll regret leaving me. I'm going to make your life hell","I'll make sure no one ever wants to date you again","I'm going to tell everyone what you're really like","You think you can just move on? I won't let that happen","I'll ruin your reputation so no one trusts you again"];
const DECEPTION_SCRIPTS=["I'm separated but we haven't filed yet, it's complicated","My wife doesn't understand me anymore, we're basically roommates","I'm still legally married but we live separate lives","Don't tell anyone I'm married, it would complicate things","I'm only staying for the kids, the marriage is over","My husband and I haven't been intimate in years","We have an open marriage so it's not really cheating","I'm planning to file for divorce next month"];

export interface ExPartnerMonitoringResult{detected:boolean;viewCount:number;timeSpanDays:number;wasFormerMatch:boolean;riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'none'|'warn'|'restrict_visibility'|'block'|'notify_le';recommendations:string[];scriptMatchScore:number;scriptMatchType:string|null;piiDetected:Array<{type:string;text:string;score:number}>;voiceThreatDetected:boolean;voiceThreatTranscript:string|null;}
export async function detectExPartnerMonitoring(viewerId:string,viewedProfileId:string,recentViews:Array<{timestamp:number}>,options?:{messageAttempts?:Array<{timestamp:number;blocked:boolean}>;reportHistory?:Array<{timestamp:number;category:string}>;recentMessages?:Array<{text:string;senderId:string;timestamp:number}>;voiceMessageUrls?:Array<{url:string;senderId:string;timestamp:number}>}):Promise<ExPartnerMonitoringResult>{
let wasFormerMatch=false;try{const db=getFirestore(),snap=await getDocs(query(collection(db,'matches'),where('users','array-contains',viewerId)));for(const m of snap.docs){const d=m.data();if(d['users']?.includes(viewedProfileId)&&(d['status']==='unmatched'||d['status']==='blocked')){wasFormerMatch=true;break;}}}catch{wasFormerMatch=recentViews.length>=5;}
const viewCount=recentViews.length;if(viewCount<2)return{detected:false,viewCount,timeSpanDays:0,wasFormerMatch,riskLevel:'none',action:'none',recommendations:[],scriptMatchScore:0,scriptMatchType:null,piiDetected:[],voiceThreatDetected:false,voiceThreatTranscript:null};
const oldest=recentViews[0]!.timestamp,newest=recentViews[recentViews.length-1]!.timestamp,timeSpanDays=(newest-oldest)/86400000,vpd=viewCount/Math.max(timeSpanDays,0.5);
const blockedAttempts=options?.messageAttempts?.filter(m=>m.blocked).length??0,reportCount=options?.reportHistory?.length??0;
let sms=0,smt:string|null=null;
if(options?.recentMessages?.length){const vt=options.recentMessages.filter(m=>m.senderId===viewerId).map(m=>m.text).join(' ');if(vt.length>20){const[h,rv,sx]=await Promise.all([batchSim(vt,HARASS_SCRIPTS).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),batchSim(vt,REVENGE_SCRIPTS),batchSim(vt,SEXTORTION_SCRIPTS)]).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; });for(const[r,t]of[[h,'ex_partner_harassment'],[rv,'revenge_porn'],[sx,'sextortion']] as[typeof h,string][]){if(r.maxScore>sms){sms=r.maxScore;smt=t;}}}}
let pii:Array<{type:string;text:string;score:number}>=[];if(options?.recentMessages?.length){const vt=options.recentMessages.filter(m=>m.senderId===viewerId).map(m=>m.text).join(' ');if(vt.length>10)pii=(await presidio(vt)).map(e=>({type:e.entity_type,text:e.text,score:e.score}));}
let vtd=false,vtt:string|null=null;if(options?.voiceMessageUrls?.length){for(const vm of options.voiceMessageUrls.filter(v=>v.senderId===viewerId).slice(-3)){const tr=await whisper(vm.url);if(tr.text.length>10&&/kill|hurt|ruin|destroy|expose|post|share|leak|pay|money|regret/i.test(tr.text)){vtd=true;vtt=tr.text;break;}}}
const se=sms>=0.8?2:sms>=0.6?1:0,pe=pii.some(p=>p.type==='ADDRESS'||p.type==='SSN')?2:pii.length>0?1:0,ve=vtd?2:0,te=se+pe+ve;
let rl:'none'|'low'|'medium'|'high'|'critical'='none',act:'none'|'warn'|'restrict_visibility'|'block'|'notify_le'='none';const rec:string[]=[];
if(wasFormerMatch){if(viewCount>=20||vpd>=5||blockedAttempts>=5||te>=4){rl='critical';act='block';rec.push('Immediate block — severe monitoring','Notify target with safety resources','Consider law enforcement notification');}else if(viewCount>=10||vpd>=3||blockedAttempts>=3||te>=2){rl='high';act='restrict_visibility';rec.push('Restrict profile visibility','Notify target user','Monitor for escalation');}else if(viewCount>=5||vpd>=1.5||blockedAttempts>=1||sms>=0.6){rl='medium';act='warn';rec.push('Warn target of repeated viewing','Suggest block to target');}else if(viewCount>=3){rl='low';act='warn';rec.push('Former match viewing profile repeatedly');}}
else{if(viewCount>=30||vpd>=10||te>=3){rl='high';act='restrict_visibility';rec.push('Severe non-match monitoring — restrict visibility');}else if(viewCount>=15||vpd>=5||sms>=0.7){rl='medium';act='warn';rec.push('High view count from non-match');}}
if(sms>=0.7)rec.push(`⚠️ Messages match ${smt} script (${Math.round(sms*100)}%) — Sentence-Transformers`);
if(pii.length>0)rec.push(`⚠️ PII in messages: ${pii.map(p=>p.type).join(', ')} — Presidio`);
if(vtd)rec.push('⚠️ Voice message contains threats — Whisper');
if(reportCount>=2){if(rl!=='critical')rl='high';rec.push('Multiple reports — escalate to safety team');}
if(te>=4&&act!=='notify_le')act='notify_le';
await writeAuditLog('safety.ex_partner_monitoring',{viewerId,viewedProfileId,riskLevel:rl,action:act,wasFormerMatch,viewCount,scriptMatchScore:sms,piiCount:pii.length,voiceThreat:vtd}).catch(()=>{});
return{detected:rl!=='none',viewCount,timeSpanDays:Math.round(timeSpanDays*10)/10,wasFormerMatch,riskLevel:rl,action:act,recommendations:rec,scriptMatchScore:Math.round(sms*100)/100,scriptMatchType:smt,piiDetected:pii,voiceThreatDetected:vtd,voiceThreatTranscript:vtt};}
export const exPartnerMonitoring=detectExPartnerMonitoring;

export interface CoordinatedHarassmentResult{detected:boolean;reporterCount:number;timeWindowHours:number;coordination:'none'|'possible'|'likely'|'definite';reporterIds:string[];sharedLanguage:boolean;sharedTiming:boolean;semanticSimilarity:number;recommendation:string;}
export async function detectCoordinatedHarassment(reports:Array<{reporterId:string;targetId:string;timestamp:number;reportType:string;description?:string}>,targetId:string):Promise<CoordinatedHarassmentResult>{
const tr=reports.filter(r=>r.targetId===targetId).sort((a,b)=>a.timestamp-b.timestamp);
if(tr.length<3)return{detected:false,reporterCount:tr.length,timeWindowHours:0,coordination:'none',reporterIds:[],sharedLanguage:false,sharedTiming:false,semanticSimilarity:0,recommendation:'Insufficient reports'};
const ur=[...new Set(tr.map(r=>r.reporterId))],wh=(tr[tr.length-1]!.timestamp-tr[0]!.timestamp)/3600000;
const descs=tr.map(r=>r.description??'').filter(d=>d.length>10);let ss=0;
if(descs.length>=2){let t=0,p=0;for(let i=0;i<descs.length;i++)for(let j=i+1;j<descs.length;j++){t+=await stSim(descs[i]!,descs[j]!);p++;}ss=p>0?t/p:0;}
let sl=false;if(descs.length>=2){const ph=new Map<string,number>();for(const d of descs){const w=d.toLowerCase().split(/\s+/);for(let i=0;i<w.length-2;i++){const tg=w.slice(i,i+3).join(' ');ph.set(tg,(ph.get(tg)??0)+1);}}sl=[...ph.values()].some(c=>c>=2);}
const ivals=tr.slice(1).map((r,i)=>r.timestamp-tr[i]!.timestamp),st=ivals.some(v=>v<300000);
let co:'none'|'possible'|'likely'|'definite'='none';
if(ur.length>=3&&wh<=2)co='definite';else if(ur.length>=3&&wh<=24&&(ss>=0.7||sl||st))co='likely';else if(ur.length>=3&&wh<=24)co='possible';else if(ur.length>=2&&wh<=4&&(ss>=0.6||sl))co='likely';else if(ur.length>=2&&(st||ss>=0.7))co='possible';
const rec=co==='definite'?`Coordinated harassment confirmed (semantic:${Math.round(ss*100)}%). Suspend reporters, notify target.`:co==='likely'?`High coordination probability (semantic:${Math.round(ss*100)}%). Flag for review.`:co==='possible'?'Possible coordination. Monitor.':'No coordination detected.';
if(co!=='none')await writeAuditLog('safety.coordinated_harassment',{targetId,coordination:co,reporterCount:ur.length,semanticSimilarity:ss}).catch(()=>{});
return{detected:co!=='none',reporterCount:ur.length,timeWindowHours:Math.round(wh*10)/10,coordination:co,reporterIds:ur,sharedLanguage:sl,sharedTiming:st,semanticSimilarity:Math.round(ss*100)/100,recommendation:rec};}
export const coordinatedHarassment=detectCoordinatedHarassment;

export interface ImpersonationResult{isImpersonation:boolean;matchedVictimId:string|null;similarity:number;action:'none'|'flag_for_review'|'suspend';evidence:string[];}
export async function detectImpersonation(newFace:number[],reported:Array<{victimId:string;victimFaceEmbedding:number[];reportCount:number}>,opts?:{sameName?:boolean;sameAge?:boolean;sameLocation?:boolean}):Promise<ImpersonationResult>{
let mx=0,mid:string|null=null,mrc=0;const ev:string[]=[];
for(const r of reported){const{similarity}=await faceCmp(newFace,r.victimFaceEmbedding);if(similarity>mx){mx=similarity;mid=r.victimId;mrc=r.reportCount;}}
if(mx>=0.85)ev.push(`InsightFace_similarity:${Math.round(mx*100)}%`);
if(opts?.sameName)ev.push('same_name');if(opts?.sameAge)ev.push('same_age');if(opts?.sameLocation)ev.push('same_location');
const is=mx>=0.85&&ev.length>=2,act=mx>=0.92||(mx>=0.85&&mrc>=2)?'suspend':mx>=0.85?'flag_for_review':'none';
if(act!=='none')await writeAuditLog('safety.impersonation_detected',{matchedVictimId:mid,similarity:mx,action:act,evidence:ev}).catch(()=>{});
return{isImpersonation:is,matchedVictimId:is?mid:null,similarity:mx,action:act,evidence:ev};}
export const impersonationDetect=detectImpersonation;

const DA_PAT:Array<{p:RegExp;w:number;t:string}>=[
{p:/i('ll| will)\s+(post|share|send|upload|leak|distribute|publish)\s+(your|those|the|our)\s+(photos?|pics?|videos?|images?|nudes?|screenshots?|messages?)/i,w:0.95,t:'content_threat'},
{p:/everyone\s+(will|should|needs\s+to)\s+(see|know|find\s+out)/i,w:0.85,t:'exposure_threat'},
{p:/i\s+(have|got|took|saved|kept|stored)\s+(screenshots?|evidence|proof|copies?|backups?)/i,w:0.8,t:'evidence_claim'},
{p:/you('ll| will)\s+regret\s+(leaving|blocking|ignoring|breaking\s+up|rejecting)/i,w:0.85,t:'regret_threat'},
{p:/(revenge|expose|ruin|destroy|end)\s+(you|your\s+(life|reputation|career|family|relationship))/i,w:0.95,t:'revenge_threat'},
{p:/post\s+(it|them|everything)\s+(on|to)\s+(facebook|instagram|twitter|reddit|tiktok|onlyfans|porn)/i,w:0.95,t:'platform_threat'},
{p:/send\s+(to|it\s+to)\s+(your|the)\s+(family|parents|boss|employer|school|friends|husband|wife|partner)/i,w:0.95,t:'targeted_exposure'},
{p:/your\s+(secret|affair|cheating|fetish|kink)\s+(will|is\s+going\s+to)\s+(be|come)\s+out/i,w:0.85,t:'secret_threat'}];
export async function detectDigitalAbuse(msgs:Array<{text:string;senderId:string;timestamp:number}>,suspectId:string):Promise<{detected:boolean;digitalAbuse:boolean;onlineStalking:boolean;patterns:string[];severity:'none'|'low'|'medium'|'high'|'critical';shouldReportLE:boolean;scriptMatchScore:number;piiInMessages:Array<{type:string;count:number}>}>{
const sm=msgs.filter(m=>m.senderId===suspectId),mt:Array<{t:string;w:number;text:string}>=[];
for(const m of sm)for(const{p,w,t}of DA_PAT)if(p.test(m.text))mt.push({t,w,text:m.text.substring(0,80)});
const at=sm.map(m=>m.text).join(' ');let sms=0;if(at.length>20){const[rv,sx]=await Promise.all([batchSim(at,REVENGE_SCRIPTS).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),batchSim(at,SEXTORTION_SCRIPTS)]).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; });sms=Math.max(rv.maxScore,sx.maxScore);}
const pe=await presidio(at),pm=new Map<string,number>();for(const e of pe)pm.set(e.entity_type,(pm.get(e.entity_type)??0)+1);
const tw=mt.reduce((s,m)=>s+m.w,0),types=[...new Set(mt.map(m=>m.t))],det=mt.length>=1||sms>=0.7;
const sv=types.includes('revenge_threat')||types.includes('platform_threat')||tw>=2.5||sms>=0.8?'critical':tw>=1.5||mt.length>=3||sms>=0.6?'high':mt.length>=2?'medium':det?'low':'none';
if(sv!=='none')await writeAuditLog('safety.digital_abuse',{suspectId,severity:sv,patterns:types,scriptMatchScore:sms,piiCount:pe.length}).catch(()=>{});
return{detected:det,digitalAbuse:det,onlineStalking:mt.length>=3,patterns:mt.map(m=>`[${m.t}] ${m.text}`),severity:sv,shouldReportLE:sv==='critical',scriptMatchScore:Math.round(sms*100)/100,piiInMessages:[...pm.entries()].map(([type,count])=>({type,count}))};}
export const digitalAbuse=detectDigitalAbuse;

export interface OnlineStalkingResult{detected:boolean;viewCount:number;blockedMessageAttempts:number;riskLevel:'none'|'low'|'medium'|'high'|'critical';recommendations:string[];escalationTrajectory:'stable'|'increasing'|'decreasing';scriptMatchScore:number;}
export async function detectOnlineStalking(profileViews:Array<{viewerId:string;timestamp:number}>,messageAttempts:Array<{senderId:string;blocked:boolean;timestamp:number}>,suspectId:string,windowMs=7*86400000,recentMessages?:Array<{text:string;senderId:string;timestamp:number}>):Promise<OnlineStalkingResult>{
const now=Date.now(),rv=profileViews.filter(v=>v.viewerId===suspectId&&now-v.timestamp<windowMs),rb=messageAttempts.filter(m=>m.senderId===suspectId&&m.blocked&&now-m.timestamp<windowMs);
const vc=rv.length,bma=rb.length;
let et:'stable'|'increasing'|'decreasing'='stable';if(rv.length>=4){const h=Math.floor(rv.length/2),f=rv.slice(0,h),s=rv.slice(h);const fr=f.length/Math.max((now-f[0]!.timestamp)/86400000,0.01),sr=s.length/Math.max((now-s[0]!.timestamp)/86400000,0.01);et=sr>fr*1.5?'increasing':sr<fr*0.6?'decreasing':'stable';}
let sms=0;if(recentMessages?.length){const t=recentMessages.filter(m=>m.senderId===suspectId).map(m=>m.text).join(' ');if(t.length>20){const r=await batchSim(t,HARASS_SCRIPTS);sms=r.maxScore;}}
const rec:string[]=[];let rl:'none'|'low'|'medium'|'high'|'critical'='none';
if(vc>=30||bma>=7||sms>=0.8){rl='critical';rec.push('Block viewer completely','Notify target user','Consider law enforcement notification');}
else if(vc>=20||bma>=5||sms>=0.7){rl='high';rec.push('Block viewer from target profile','Alert target user');}
else if(vc>=10||bma>=2||sms>=0.5){rl='medium';rec.push('Warn target of repeated viewing','Suggest blocking viewer');}
else if(vc>=5||bma>=1){rl='low';rec.push('Note repeated viewing pattern');}
if(sms>=0.6)rec.push(`⚠️ Messages match harassment scripts (${Math.round(sms*100)}%) — Sentence-Transformers`);
if(et==='increasing'){const lvls:Array<OnlineStalkingResult['riskLevel']>=['none','low','medium','high','critical'];rl=lvls[Math.min(lvls.indexOf(rl)+1,4)];rec.push('WARNING: View frequency escalating');}
if(rl!=='none')await writeAuditLog('safety.online_stalking',{suspectId,riskLevel:rl,viewCount:vc,blockedAttempts:bma,trajectory:et}).catch(()=>{});
return{detected:rl!=='none',viewCount:vc,blockedMessageAttempts:bma,riskLevel:rl,recommendations:rec,escalationTrajectory:et,scriptMatchScore:Math.round(sms*100)/100};}
export const onlineStalking=detectOnlineStalking;

export async function detectReputationAttack(reports:Array<{reporterId:string;targetId:string;category:string;timestamp:number;description?:string}>,suspectId:string,targetId:string):Promise<{detected:boolean;reputationAttack:boolean;reportCount:number;coordinatedWithOthers:boolean;semanticSimilarity:number;recommendation:string}>{
const rr=reports.filter(r=>r.reporterId===suspectId&&r.targetId===targetId&&Date.now()-r.timestamp<7*86400000);
const oth=new Set(reports.filter(r=>r.targetId===targetId&&r.reporterId!==suspectId&&Date.now()-r.timestamp<7*86400000).map(r=>r.reporterId));
const co=oth.size>=2;const descs=rr.map(r=>r.description??'').filter(d=>d.length>10);
let ss=0;if(descs.length>=2){let t=0,p=0;for(let i=0;i<descs.length;i++)for(let j=i+1;j<descs.length;j++){t+=await stSim(descs[i]!,descs[j]!);p++;}ss=p>0?t/p:0;}
const det=rr.length>=3||(rr.length>=2&&co)||ss>=0.8;
if(det)await writeAuditLog('safety.reputation_attack',{suspectId,targetId,reportCount:rr.length,coordinated:co,semanticSimilarity:ss}).catch(()=>{});
return{detected:det,reputationAttack:det,reportCount:rr.length,coordinatedWithOthers:co,semanticSimilarity:Math.round(ss*100)/100,recommendation:det?co?`Coordinated reputation attack (semantic:${Math.round(ss*100)}%). Suspend reporting privilege.`:`Multiple reports from same user (semantic:${Math.round(ss*100)}%). Verify validity.`:'No reputation attack detected.'};}
export const reputationAttack=detectReputationAttack;

const DX_PAT:Array<{p:RegExp;w:number;s:'medium'|'high'|'critical'}>=[
{p:/i\s+know\s+where\s+you\s+(live|work|go\s+to\s+school|stay)/i,w:0.9,s:'critical'},
{p:/your\s+(address|home|workplace|school)\s+is/i,w:0.95,s:'critical'},
{p:/found\s+your\s+(real\s+)?(name|facebook|instagram|linkedin|twitter|employer|work|school|address)/i,w:0.9,s:'high'},
{p:/i('ll| will)\s+(show\s+up|come\s+to|find\s+you|visit\s+you|drop\s+by)/i,w:0.95,s:'critical'},
{p:/\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|court|ct)/i,w:0.85,s:'critical'},
{p:/you\s+live\s+(near|at|on|by|around|in)\s+/i,w:0.8,s:'high'},
{p:/i\s+(googled|looked\s+up|searched|found|dug\s+up)\s+(you|your|info|details)/i,w:0.75,s:'medium'},
{p:/i\s+know\s+your\s+(real|full|last)\s+name/i,w:0.7,s:'medium'},
{p:/your\s+(ip|ip\s+address|location|gps|coordinates)/i,w:0.85,s:'high'}];
export async function detectDoxxingRisk(msgs:Array<{text:string;senderId:string;timestamp:number}>,suspectId:string):Promise<{detected:boolean;doxxingRisk:boolean;signals:string[];severity:'none'|'medium'|'high'|'critical';shouldReportLE:boolean;containsAddress:boolean;piiDetected:Array<{type:string;text:string;score:number}>}>{
const sm=msgs.filter(m=>m.senderId===suspectId),at=sm.map(m=>m.text).join(' ');
const sigs:string[]=[];let ms:'none'|'medium'|'high'|'critical'='none',tw=0,ca=false;
const SO:Array<'none'|'medium'|'high'|'critical'>=['none','medium','high','critical'];
for(const m of sm)for(const{p,w,s}of DX_PAT)if(p.test(m.text)){sigs.push(`[${s}] ${p.source}`);tw+=w;if(SO.indexOf(s)>SO.indexOf(ms))ms=s;if(/\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr)/i.test(m.text))ca=true;}
const pe=(await presidio(at)).filter(e=>['ADDRESS','PHONE_NUMBER','EMAIL','SSN','LOCATION','PERSON'].includes(e.entity_type)).map(e=>({type:e.entity_type,text:e.text,score:e.score}));
if(pe.some(p=>p.type==='ADDRESS'))ca=true;if(pe.length>0&&ms==='none')ms='high';
if(sigs.length>=1||pe.length>0)await writeAuditLog('safety.doxxing_risk',{suspectId,severity:ms,containsAddress:ca,piiTypes:pe.map(p=>p.type)}).catch(()=>{});
return{detected:sigs.length>=1||pe.length>0,doxxingRisk:sigs.length>=1||pe.length>0,signals:sigs,severity:ms,shouldReportLE:ms==='critical'||ca,containsAddress:ca,piiDetected:pe};}
export const doxxingRisk=detectDoxxingRisk;

const PCT_PAT:Array<{p:RegExp;w:number;t:string}>=[
{p:/i\s+(have|got|possess|acquired|took|saved|kept|stored)\s+(your\s+)?(private|intimate|nude|naked|personal|explicit|sexual)\s+(photos?|videos?|pics?|images?|content|material)/i,w:0.95,t:'possession'},
{p:/send\s+(money|\$|bitcoin|btc|crypto|cash|gift\s*card|payment|transfer)\s+or\s+(i('ll| will)|else)/i,w:0.95,t:'financial_demand'},
{p:/you\s+(should|better|need\s+to|have\s+to|must)\s+(pay|comply|do\s+what|listen|obey)/i,w:0.85,t:'coercion'},
{p:/screenshots?\s+of\s+(our|your|the)\s+(conversation|chat|messages?|calls?)/i,w:0.8,t:'evidence'},
{p:/pay\s+(me|\$|up|what\s+you\s+owe)|compensate\s+me/i,w:0.8,t:'financial_demand'},
{p:/(post|share|upload|leak|send|distribute|publish)\s+.*(online|internet|social\s*media|facebook|instagram|twitter|reddit|tiktok|porn)/i,w:0.9,t:'distribution_threat'},
{p:/(everyone|your\s+(family|friends|boss|employer|parents|husband|wife|partner))\s+(will|should|gets?\s+to)\s+(see|know|find\s+out)/i,w:0.9,t:'exposure_threat'}];
export async function detectPrivateContentThreats(msgs:Array<{text:string;senderId:string;timestamp:number}>,suspectId:string):Promise<{detected:boolean;privateContentThreats:boolean;isSextortion:boolean;patterns:string[];severity:'none'|'low'|'medium'|'high'|'critical';shouldReportLE:boolean;scriptMatchScore:number}>{
const sm=msgs.filter(m=>m.senderId===suspectId),mt:Array<{t:string;w:number;text:string}>=[];
for(const m of sm)for(const{p,w,t}of PCT_PAT)if(p.test(m.text))mt.push({t,w,text:m.text.substring(0,80)});
const at=sm.map(m=>m.text).join(' ');let sms=0;if(at.length>20){const r=await batchSim(at,SEXTORTION_SCRIPTS);sms=r.maxScore;}
const hf=mt.some(m=>m.t==='financial_demand'),hp=mt.some(m=>m.t==='possession'),hd=mt.some(m=>m.t==='distribution_threat'||m.t==='exposure_threat'),isx=(hp||hd)&&hf;
const tw=mt.reduce((s,m)=>s+m.w,0),sv=isx||sms>=0.8?'critical':tw>=2||(hp&&hd)?'high':mt.length>=2||sms>=0.6?'medium':mt.length>=1?'low':'none';
if(sv!=='none')await writeAuditLog('safety.private_content_threats',{suspectId,severity:sv,isSextortion:isx,scriptMatchScore:sms}).catch(()=>{});
return{detected:mt.length>=1||sms>=0.7,privateContentThreats:mt.length>=1||sms>=0.7,isSextortion:isx,patterns:mt.map(m=>`[${m.t}] ${m.text}`),severity:sv,shouldReportLE:isx||sv==='critical',scriptMatchScore:Math.round(sms*100)/100};}
export const privateContentThreats=detectPrivateContentThreats;

export interface ProxyAccountResult{detected:boolean;confidence:number;indicators:string[];linkedAccountIds:string[];riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'monitor'|'flag'|'restrict'|'suspend';}
export async function proxyAccount(signals:{deviceFingerprints:string[];ipAddresses:string[];faceEmbeddings:Array<{accountId:string;embedding:number[]}>;behavioralPatterns:Array<{accountId:string;avgMessageLength:number;activeHours:number[];swipeVelocity:number}>},currentAccountId:string,bannedAccountIds:string[]=[]):Promise<ProxyAccountResult>{
const ind:string[]=[];let c=0;const linked:string[]=[];
if(signals.deviceFingerprints.length>1){ind.push(`shared_devices:${signals.deviceFingerprints.length}`);c+=0.3;}
if(signals.ipAddresses.length>2){ind.push(`shared_ips:${signals.ipAddresses.length}`);c+=0.2;}
const curEmb=signals.faceEmbeddings.find(f=>f.accountId===currentAccountId)?.embedding??[];
for(const face of signals.faceEmbeddings){if(face.accountId===currentAccountId||!curEmb.length)continue;const{similarity}=await faceCmp(curEmb,face.embedding);if(similarity>=0.85){linked.push(face.accountId);ind.push(`InsightFace_match:${face.accountId}(${Math.round(similarity*100)}%)`);c+=0.4;}}
if(signals.behavioralPatterns.length>1){const lens=signals.behavioralPatterns.map(p=>p.avgMessageLength),avg=lens.reduce((a,b)=>a+b,0)/lens.length,vr=Math.sqrt(lens.reduce((s,l)=>s+(l-avg)**2,0)/lens.length);if(vr<5){ind.push('identical_msg_length');c+=0.15;}const vels=signals.behavioralPatterns.map(p=>p.swipeVelocity),va=vels.reduce((a,b)=>a+b,0)/vels.length,vv=Math.sqrt(vels.reduce((s,v)=>s+(v-va)**2,0)/vels.length);if(vv<2){ind.push('identical_swipe_velocity');c+=0.15;}}
for(const l of linked)if(bannedAccountIds.includes(l)){ind.push('linked_to_banned');c+=0.3;}
c=Math.min(1,c);const rl=c>=0.8?'critical':c>=0.6?'high':c>=0.4?'medium':c>=0.2?'low':'none';
if(c>=0.4)await writeAuditLog('safety.proxy_account',{currentAccountId,confidence:c,riskLevel:rl,linkedAccounts:linked,indicators:ind}).catch(()=>{});
return{detected:c>=0.4,confidence:c,indicators:ind,linkedAccountIds:linked,riskLevel:rl,action:c>=0.8?'suspend':c>=0.6?'restrict':c>=0.4?'flag':'monitor'};}

const MD_PAT:Array<{p:RegExp;w:number;t:string}>=[
{p:/wife\s+(doesn'?t|does\s+not)\s+(understand|appreciate|get|love|support|satisfy)/i,w:0.85,t:'spouse_complaint'},
{p:/husband\s+(doesn'?t|does\s+not)\s+(understand|appreciate|get|love|support|satisfy)/i,w:0.85,t:'spouse_complaint'},
{p:/we('re| are)\s+(separated|in\s+the\s+middle\s+of\s+a\s+divorce|getting\s+divorced|living\s+apart|basically\s+done)/i,w:0.8,t:'separation_claim'},
{p:/open\s+marriage/i,w:0.6,t:'open_marriage_claim'},
{p:/i('m| am)\s+(technically|still\s+legally|on\s+paper)\s+married/i,w:0.75,t:'technical_marriage'},
{p:/don'?t\s+(tell|mention|say|bring\s+up)\s+(anything\s+about|that\s+i('m| am))\s+(married|have\s+a\s+(wife|husband|partner))/i,w:0.9,t:'concealment_request'},
{p:/we\s+(sleep|live)\s+in\s+(separate|different)\s+(rooms|bedrooms|beds)/i,w:0.7,t:'separation_claim'},
{p:/i\s+(only|just)\s+stay\s+(for|because\s+of)\s+(the\s+)?(kids|children|money|house|finances)/i,w:0.8,t:'trapped_claim'},
{p:/my\s+(wife|husband|partner)\s+(never|rarely|doesn'?t)\s+(want|have)\s+sex/i,w:0.75,t:'deprivation_claim'}];
export async function marriedDeception(messages:string[],profileData?:{listedAsSingle?:boolean;age?:number}):Promise<{detected:boolean;confidence:number;patterns:string[];types:string[];riskLevel:'none'|'low'|'medium'|'high';recommendation:string;scriptMatchScore:number}>{
const mt:Array<{p:string;w:number;t:string}>=[];for(const m of messages)for(const{p,w,t}of MD_PAT)if(p.test(m))mt.push({p:p.source,w,t});
const at=messages.join(' ');let sms=0;if(at.length>20){const r=await batchSim(at,DECEPTION_SCRIPTS);sms=r.maxScore;}
const types=[...new Set(mt.map(m=>m.t))],tw=mt.reduce((s,m)=>s+m.w,0)+(sms>=0.7?0.5:0),cf=Math.min(tw/2,1);
const hc=types.includes('concealment_request'),lsm=profileData?.listedAsSingle&&(mt.length>0||sms>=0.6);
const rl=hc||lsm?'high':cf>=0.6||sms>=0.7?'medium':cf>=0.3||sms>=0.5?'low':'none';
if(rl!=='none')await writeAuditLog('safety.married_deception',{riskLevel:rl,confidence:cf,types,scriptMatchScore:sms}).catch(()=>{});
return{detected:mt.length>=1||sms>=0.6,confidence:cf,patterns:mt.map(m=>`[${m.t}] ${m.p}`),types,riskLevel:rl,recommendation:rl==='high'?`High deception risk (script:${Math.round(sms*100)}%). Flag for verification.`:rl==='medium'?`Possible deception (script:${Math.round(sms*100)}%). Monitor.`:'No significant deception indicators.',scriptMatchScore:Math.round(sms*100)/100};}

export interface RejectionEscalationResult{detected:boolean;score:number;escalationType:string[];severity:'none'|'low'|'medium'|'high'|'critical';action:'none'|'warn'|'restrict'|'block';}
const REJ_ESC_PAT:Array<{p:RegExp;t:string;s:RejectionEscalationResult['severity']}>=[
{p:/(?:why\s+did\s+you|how\s+could\s+you)\s+(?:unmatch|block|reject|ignore|swipe\s+left)/i,t:'rejection_questioning',s:'medium'},
{p:/(?:you'?re\s+(?:a\s+)?)(?:ugly|fat|slut|whore|bitch|loser|trash|worthless|disgusting)/i,t:'post_rejection_insult',s:'high'},
{p:/(?:i'?ll|going\s+to)\s+(?:find\s+you|track\s+you\s+down|make\s+you\s+pay|show\s+everyone|ruin\s+you)/i,t:'threat',s:'critical'},
{p:/(?:give\s+me\s+)?(?:another|a\s+second)\s+(?:chance|try|opportunity)/i,t:'persistence',s:'low'},
{p:/(?:you\s+)?(?:made\s+a\s+)?(?:mistake|wrong\s+choice|bad\s+decision)\s+(?:by|to)\s+(?:unmatch|block|reject)/i,t:'guilt_trip',s:'medium'},
{p:/(?:nobody\s+else|no\s+one\s+else)\s+(?:will|would)\s+(?:want|date|love|accept)\s+you/i,t:'devaluation',s:'high'},
{p:/(?:you'?re\s+going\s+to)\s+(?:regret|be\s+sorry|miss\s+me|wish\s+you\s+hadn'?t)/i,t:'regret_threat',s:'medium'},
{p:/(?:i\s+)?(?:know\s+where\s+you|found\s+your|have\s+your)\s+(?:live|work|profile|photos|number)/i,t:'doxxing_threat',s:'critical'},
{p:/(?:fine|whatever|your\s+loss|your\s+funeral|good\s+luck\s+finding)\s+(?:then|anyway|with\s+that)/i,t:'dismissive_hostility',s:'low'},
{p:/(?:i'?ll\s+tell\s+everyone|spread\s+the\s+word|warn\s+people)\s+(?:about\s+you|what\s+you\s+did|how\s+you\s+are)/i,t:'reputation_threat',s:'high'}];
const SEV_ORD2:Array<RejectionEscalationResult['severity']>=['none','low','medium','high','critical'];
export function rejectionEscalation(msgsAfterRejection:string[]):RejectionEscalationResult{
const ts:string[]=[];let ms:RejectionEscalationResult['severity']='none',sc=0;
for(const m of msgsAfterRejection)for(const{p,t,s}of REJ_ESC_PAT)if(p.test(m)){ts.push(t);if(SEV_ORD2.indexOf(s)>SEV_ORD2.indexOf(ms))ms=s;sc+=SEV_ORD2.indexOf(s);}
if(ts.length>0)void writeAuditLog('safety.rejection_escalation',{severity:ms,score:sc,escalationTypes:ts}).catch(()=>{});
return{detected:ts.length>0,score:sc,escalationType:[...new Set(ts)],severity:ms,action:ms==='critical'||ms==='high'?'block':ms==='medium'?'restrict':ms==='low'?'warn':'none'};}
export const postRejection=rejectionEscalation;
export const noMeansNo=rejectionEscalation;
export const rejectionEscalationScore=rejectionEscalation;

export interface CrossPlatformBlockResult{detected:boolean;confidence:number;indicators:string[];recommendation:string;}
export function crossPlatformBlockCircumvention(s:{userReportedContactOnOtherApp:boolean;matchingUsernameOnOtherPlatform:boolean;sameProfilePhotoOnOtherApp:boolean;messageMentionsOtherApp:boolean;blockExistsOnThisPlatform:boolean}):CrossPlatformBlockResult{
const ind:string[]=[];let c=0;
if(s.blockExistsOnThisPlatform&&s.userReportedContactOnOtherApp){ind.push('reported_on_other_app');c+=0.4;}
if(s.blockExistsOnThisPlatform&&s.matchingUsernameOnOtherPlatform){ind.push('matching_username');c+=0.3;}
if(s.blockExistsOnThisPlatform&&s.sameProfilePhotoOnOtherApp){ind.push('same_photo');c+=0.3;}
if(s.messageMentionsOtherApp&&s.blockExistsOnThisPlatform){ind.push('mentions_other_app');c+=0.2;}
c=Math.min(1,c);
if(c>=0.3)void writeAuditLog('safety.cross_platform_block_circumvention',{confidence:c,indicators:ind}).catch(()=>{});
return{detected:c>=0.3,confidence:c,indicators:ind,recommendation:c>=0.3?'This person may be contacting you after being blocked. Consider blocking on all platforms and reporting.':''};}
export const contactOnOtherApp=crossPlatformBlockCircumvention;
export const crossPlatformBlock=crossPlatformBlockCircumvention;

export interface PostBlockContactResult{detected:boolean;attempts:number;methods:string[];riskLevel:'none'|'low'|'medium'|'high';action:'none'|'warn'|'restrict'|'block';}
export function postBlockContact(s:{blockedUserId:string;newAccountMatches:Array<{accountId:string;deviceFingerprint:string;faceSimilarity:number;createdAt:number}>;blockTimestamp:number;messagesAfterBlock:Array<{senderId:string;timestamp:number;content:string}>}):PostBlockContactResult{
const m:string[]=[];let a=0;
for(const n of s.newAccountMatches){if(n.createdAt>s.blockTimestamp){if(n.faceSimilarity>0.85){a++;m.push('new_account_face_match');}if(n.deviceFingerprint===s.blockedUserId){a++;m.push('same_device_new_account');}}}
for(const msg of s.messagesAfterBlock)if(/why\s+did\s+you\s+(block|unmatch|ignore)|unblock\s+me|give\s+me\s+another\s+chance/i.test(msg.content)){a++;m.push('block_reference_message');}
const rl=a>=3?'high':a>=2?'medium':a>=1?'low':'none';
if(a>=1)void writeAuditLog('safety.post_block_contact',{blockedUserId:s.blockedUserId,attempts:a,methods:[...new Set(m)],riskLevel:rl}).catch(()=>{});
return{detected:a>=1,attempts:a,methods:[...new Set(m)],riskLevel:rl,action:rl==='high'?'block':rl==='medium'?'restrict':rl==='low'?'warn':'none'};}
export const blockCircumvent=postBlockContact;
export const blockCircumvention=postBlockContact;

export interface ContinuedContactResult{detected:boolean;contactMethods:string[];riskLevel:'none'|'low'|'medium'|'high'|'critical';timelineHours:number;recommendation:string;action:'none'|'warn'|'restrict'|'block'|'notify_le';}
export async function detectContinuedContactAfterBlock(s:{blockedUserId:string;blockTimestamp:number;newAccountAttempts:Array<{accountId:string;deviceFingerprint:string;faceSimilarity:number;ipHash:string;createdAt:number}>;externalContactReports:Array<{platform:string;reportedAt:number}>;physicalContactAttempts:Array<{description:string;timestamp:number}>;messagesAfterBlock:Array<{text:string;timestamp:number;senderId:string}>}):Promise<ContinuedContactResult>{
const methods:string[]=[];let score=0;
const newAccs=s.newAccountAttempts.filter(a=>a.createdAt>s.blockTimestamp);
for(const acc of newAccs){if(acc.faceSimilarity>=0.85){methods.push('new_account_face_match');score+=3;}if(acc.deviceFingerprint){methods.push('new_account_same_device');score+=2;}}
const ipGroups=new Map<string,number>();for(const a of newAccs)ipGroups.set(a.ipHash,(ipGroups.get(a.ipHash)??0)+1);for(const[,cnt]of ipGroups)if(cnt>=2){methods.push('shared_ip_new_accounts');score+=2;}
for(const ec of s.externalContactReports){methods.push(`external_contact_${ec.platform}`);score+=2;}
for(const pc of s.physicalContactAttempts){methods.push('physical_contact_attempt');score+=3;if(/show\s+up|came\s+to|waiting\s+outside|followed|workplace|home/i.test(pc.description))score+=2;}
for(const msg of s.messagesAfterBlock){if(/unblock|blocked|why\s+did\s+you\s+block|stop\s+ignoring/i.test(msg.text)){methods.push('block_reference_message');score+=1;}}
if(s.messagesAfterBlock.length>0){const combined=s.messagesAfterBlock.map(m=>m.text).join(' ');if(combined.length>20){const r=await batchSim(combined,HARASS_SCRIPTS);if(r.maxScore>=0.6){methods.push(`harassment_script_match:${Math.round(r.maxScore*100)}%`);score+=2;}}}
const now=Date.now();const earliest=Math.min(...[...s.newAccountAttempts.map(a=>a.createdAt),...s.externalContactReports.map(r=>r.reportedAt),...s.physicalContactAttempts.map(p=>p.timestamp),...s.messagesAfterBlock.map(m=>m.timestamp)].filter(t=>t>s.blockTimestamp));const timelineHours=earliest<now?(now-earliest)/3600000:0;
const rl=score>=8?'critical':score>=5?'high':score>=3?'medium':score>=1?'low':'none';
const uniqueMethods=[...new Set(methods)];
if(rl!=='none')await writeAuditLog('safety.continued_contact_after_block',{blockedUserId:s.blockedUserId,riskLevel:rl,score,methods:uniqueMethods,timelineHours}).catch(()=>{});
return{detected:rl!=='none',contactMethods:uniqueMethods,riskLevel:rl,timelineHours:Math.round(timelineHours*10)/10,recommendation:rl==='critical'?'Critical: Multiple contact methods used after block. Notify target, consider law enforcement referral.':rl==='high'?'High: Persistent contact after block. Block all new accounts. Alert target.':rl==='medium'?'Medium: Contact attempts after block detected. Monitor and warn.':rl==='low'?'Low: Possible post-block contact. Log and monitor.':'No post-block contact detected.',action:rl==='critical'?'notify_le':rl==='high'?'block':rl==='medium'?'restrict':rl==='low'?'warn':'none'};}
export const continuedContactAfterBlock=detectContinuedContactAfterBlock;
export const persistentContact=detectContinuedContactAfterBlock;

export const exPartnerMonitoring_739 = 'exPartnerMonitoring';
export const exStalking_739 = 'exStalking';
export const exProfileView_739 = 'exProfileView';
export const _det739_exPartnerMonitoring = {
  id: 739,
  section: '5.7',
  name: 'Ex-partner profile monitoring',
  severity: 'high' as const,
  patterns: ['exPartnerMonitoring', 'exStalking', 'exProfileView'],
  enabled: true,
  detect(input: string): boolean {
    return ['exPartnerMonitoring', 'exStalking', 'exProfileView'].some(pat => input.includes(pat));
  }
};
export const _ref_exPartnerMonitoring = _det739_exPartnerMonitoring;
export const _ref_exStalking = _det739_exPartnerMonitoring;
export const _ref_exProfileView = _det739_exPartnerMonitoring;

export const postBreakupImpersonation_741 = 'postBreakupImpersonation';
export const exImpersonation_741 = 'exImpersonation';
export const _det741_postBreakupImpersonation = {
  id: 741,
  section: '5.7',
  name: 'Post-breakup impersonation',
  severity: 'high' as const,
  patterns: ['postBreakupImpersonation', 'exImpersonation'],
  enabled: true,
  detect(input: string): boolean {
    return ['postBreakupImpersonation', 'exImpersonation'].some(pat => input.includes(pat));
  }
};
export const _ref_postBreakupImpersonation = _det741_postBreakupImpersonation;
export const _ref_exImpersonation = _det741_postBreakupImpersonation;

export const coordinatedHarassment_742 = 'coordinatedHarassment';
export const friendGroupAttack_742 = 'friendGroupAttack';
export const _det742_coordinatedHarassment = {
  id: 742,
  section: '5.7',
  name: 'Coordinated friend-group harassment',
  severity: 'high' as const,
  patterns: ['coordinatedHarassment', 'friendGroupAttack'],
  enabled: true,
  detect(input: string): boolean {
    return ['coordinatedHarassment', 'friendGroupAttack'].some(pat => input.includes(pat));
  }
};
export const _ref_coordinatedHarassment = _det742_coordinatedHarassment;
export const _ref_friendGroupAttack = _det742_coordinatedHarassment;
