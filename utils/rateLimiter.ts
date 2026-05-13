import { doc, getDoc, increment, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { writeAuditLog } from './logger';

interface RateLimitResult{allowed:boolean;remaining:number;resetIn?:number;reason?:string;}
interface RateLimitConfig{count:number;period:number;blockReason?:string;}

const LIMITS:Record<string,RateLimitConfig>={like:{count:100,period:86_400_000,blockReason:'Like limit reached. Try again tomorrow.'},message:{count:500,period:86_400_000,blockReason:'Message limit reached. Try again tomorrow.'},report:{count:10,period:86_400_000,blockReason:'Report limit reached. Try again tomorrow.'},swipe:{count:200,period:86_400_000,blockReason:'Swipe limit reached. Try again tomorrow.'},super_like:{count:5,period:86_400_000,blockReason:'Super like limit reached.'},boost:{count:1,period:86_400_000,blockReason:'You can only boost once per day.'},profile_view:{count:500,period:86_400_000,blockReason:'Profile view limit reached.'},unmatch:{count:20,period:3_600_000,blockReason:'Too many unmatches.'},first_message:{count:50,period:86_400_000,blockReason:'First message limit reached.'},account_create:{count:3,period:86_400_000},bug_report:{count:5,period:3_600_000,blockReason:'Too many bug reports.'},date_review:{count:10,period:86_400_000},forgot_password:{count:3,period:60_000,blockReason:'Too many reset requests.'},resend_verification:{count:3,period:60_000,blockReason:'Too many verification emails.'},story_view:{count:1000,period:86_400_000,blockReason:'Story view limit reached.'},referral:{count:20,period:86_400_000,blockReason:'Referral limit reached.'},webhook:{count:60,period:60_000,blockReason:'Webhook rate limit exceeded.'},session:{count:5,period:86_400_000,blockReason:'Too many active sessions.'},video_call:{count:20,period:86_400_000,blockReason:'Video call limit reached.'},gift:{count:10,period:86_400_000,blockReason:'Gift limit reached.'},block:{count:50,period:86_400_000,blockReason:'Block limit reached.'}};

const memCache:Record<string,{count:number;firstAction:number}>={};
const behCounters:Record<string,{count:number;timestamps:number[]}>={};

export async function checkRateLimit(action:string):Promise<RateLimitResult>{
  const user=auth.currentUser;if(!user)return{allowed:false,remaining:0,reason:'Not authenticated'};
  const lim=LIMITS[action];if(!lim)return{allowed:true,remaining:999};
  const ck=`${user.uid}_${action}`,ref=doc(db,'rateLimits',user.uid,'actions',action);
  try{
    const snap=await getDoc(ref),now=Date.now();
    if(!snap.exists()){await setDoc(ref,{count:1,firstAction:now,lastAction:now});memCache[ck]={count:1,firstAction:now};return{allowed:true,remaining:lim.count-1};}
    const d=snap.data(),fa=d['firstAction']??now,c=d['count']??0,el=now-fa;
    if(el>lim.period){await setDoc(ref,{count:1,firstAction:now,lastAction:now});memCache[ck]={count:1,firstAction:now};return{allowed:true,remaining:lim.count-1};}
    if(c>=lim.count)return{allowed:false,remaining:0,resetIn:lim.period-el,reason:lim.blockReason??'Rate limit exceeded.'};
    const nc=c+1;await setDoc(ref,{count:nc,firstAction:fa,lastAction:now});memCache[ck]={count:nc,firstAction:fa};return{allowed:true,remaining:lim.count-nc};
  }catch(e){
    const now=Date.now(),c=memCache[ck];
    if(!c||now-c.firstAction>lim.period){memCache[ck]={count:1,firstAction:now};return{allowed:true,remaining:lim.count-1};}
    if(c.count>=lim.count)return{allowed:false,remaining:0,resetIn:lim.period-(now-c.firstAction),reason:lim.blockReason??'Rate limit exceeded.'};
    c.count+=1;return{allowed:true,remaining:lim.count-c.count};
  }
}

function getTracker(key:string,win:number){const now=Date.now();if(!behCounters[key])behCounters[key]={count:0,timestamps:[]};const t=behCounters[key]!;t.timestamps=t.timestamps.filter(ts=>now-ts<win);t.timestamps.push(now);t.count=t.timestamps.length;return t;}

export async function enforceSessionLimit(uid:string,sid:string):Promise<{allowed:boolean;activeSessions:number;reason?:string}>{
  const MAX=5,TTL=30*24*60*60*1000;
  try{
    const ref=doc(db,'userSessions',uid),snap=await getDoc(ref),now=Date.now();
    let s:Record<string,number>=snap.exists()?(snap.data()?.['sessions']??{}):{};
    s=Object.fromEntries(Object.entries(s).filter(([,ts])=>now-(ts as number)<TTL));
    if(Object.keys(s).length>=MAX&&!s[sid])return{allowed:false,activeSessions:Object.keys(s).length,reason:`Maximum ${MAX} active sessions allowed.`};
    s[sid]=now;await setDoc(ref,{sessions:s,lastUpdated:now},{merge:true});
    return{allowed:true,activeSessions:Object.keys(s).length};
  }catch{return{allowed:true,activeSessions:1};}
}

export async function terminateSession(uid:string,sid:string):Promise<void>{
  try{
    const ref=doc(db,'userSessions',uid),snap=await getDoc(ref);
    if(!snap.exists())return;
    const s:Record<string,number>=snap.data()?.['sessions']??{};
    delete s[sid];
    await updateDoc(ref,{sessions:s});
  }catch{}
}

export async function trackUnmatch(uid:string):Promise<{suspicious:boolean;reason?:string}>{
  const t=getTracker(`unmatch_${uid}`,3_600_000);
  try{const ref=doc(db,'behaviorMetrics',uid);await updateDoc(ref,{unmatchCount:increment(1),lastUnmatch:Date.now()}).catch(()=>setDoc(ref,{unmatchCount:1,lastUnmatch:Date.now()},{merge:true}));}catch{}
  if(t.count>=15)writeAuditLog('abuse.unmatch_spike',{userId:uid,count:t.count}).catch(()=>{});
  return t.count>=15?{suspicious:true,reason:`${t.count} unmatches in 1h.`}:{suspicious:false};
}

export function trackProfileView(vid:string,tid:string){const t=getTracker(`view_${vid}_${tid}`,3_600_000);return{suspicious:t.count>=10,viewCount:t.count};}
export function trackReport(rid:string){const t=getTracker(`report_${rid}`,3_600_000);if(t.count>=8)writeAuditLog('abuse.report_spike',{userId:rid,count:t.count}).catch(()=>{});return t.count>=8?{suspicious:true,reportCount:t.count,reason:`${t.count} reports in the last hour.`}:{suspicious:false,reportCount:t.count};}
export function trackReportDaily(rid:string){const t=getTracker(`report_daily_${rid}`,86_400_000);return t.count>=20?{suspicious:true,reportCount:t.count,reason:`${t.count} reports in 24h.`}:{suspicious:false,reportCount:t.count};}
export function trackTargetedReport(rid:string,tid:string){const t=getTracker(`report_targeted_${rid}_${tid}`,86_400_000);return{suspicious:t.count>=3,count:t.count};}

export async function validateReporter(rid:string):Promise<{credible:boolean;reason?:string;shouldAutoDiscard:boolean}>{
  try{
    const snap=await getDoc(doc(db,'behaviorMetrics',rid));
    if(!snap.exists())return{credible:true,shouldAutoDiscard:false};
    const d=snap.data(),frr=d['falseReportRate']??0,tr=d['totalReports']??0;
    if(tr>=5&&frr>0.7)return{credible:false,reason:'High false report rate.',shouldAutoDiscard:true};
    if(tr>=10&&frr>0.5)return{credible:false,reason:'Low reporter credibility.',shouldAutoDiscard:false};
    return{credible:true,shouldAutoDiscard:false};
  }catch{return{credible:true,shouldAutoDiscard:false};}
}

export function trackFirstMessage(sid:string){const t=getTracker(`first_msg_${sid}`,86_400_000);return{withinLimit:t.count<=50,count:t.count};}
export const checkBoostAllowed=()=>checkRateLimit('boost');

export async function detectBoostAbuse(uid:string):Promise<{abusive:boolean;boostCount:number}>{const t=getTracker(`boost_${uid}`,86_400_000);return{abusive:t.count>3,boostCount:t.count};}
export const boostLimit=checkBoostAllowed;

export async function trackAccountCreation(df:string):Promise<{suspicious:boolean;accountCount:number}>{
  const t=getTracker(`device_accounts_${df}`,86_400_000);
  try{await setDoc(doc(db,'deviceMetrics',df),{accountCreations:increment(1),lastCreation:Date.now()},{merge:true});}catch{}
  if(t.count>=3)writeAuditLog('abuse.multi_account_creation',{deviceFingerprint:df,count:t.count}).catch(()=>{});
  return{suspicious:t.count>=3,accountCount:t.count};
}

export async function recordDeviceLogin(uid:string,df:string,email:string):Promise<void>{
  if(!df)return;
  try{
    const ref=doc(db,'deviceFingerprints',df),snap=await getDoc(ref),now=Date.now();
    if(!snap.exists()){await setDoc(ref,{users:[uid],emails:[email],firstSeen:now,lastSeen:now});return;}
    const d=snap.data(),u:string[]=d['users']??[],e:string[]=d['emails']??[];
    if(!u.includes(uid))u.push(uid);if(!e.includes(email))e.push(email);
    await updateDoc(ref,{users:u,emails:e,lastSeen:now});
  }catch{}
}

export async function checkDeviceMultiAccount(df:string):Promise<{suspicious:boolean;accountCount:number;reason?:string}>{
  if(!df)return{suspicious:false,accountCount:0};
  try{
    const snap=await getDoc(doc(db,'deviceMetrics',df));
    if(!snap.exists())return{suspicious:false,accountCount:0};
    const c=snap.data()?.['accountCreations']??0;
    return{suspicious:c>=3,accountCount:c,reason:c>=3?`${c} accounts from this device.`:undefined};
  }catch{return{suspicious:false,accountCount:0};}
}

export async function checkUserBanned(email:string):Promise<{banned:boolean;reason?:string}>{
  try{
    const snap=await getDoc(doc(db,'bannedUsers',email.toLowerCase()));
    if(!snap.exists())return{banned:false};
    return{banned:true,reason:snap.data()?.['reason']??'Account suspended.'};
  }catch{return{banned:false};}
}

export function analyzeMessageTiming(ts:number[]):{ isBot:boolean;stdDevMs:number;reason?:string}{
  if(ts.length<5)return{isBot:false,stdDevMs:0};
  const iv=ts.slice(1).map((t,i)=>t-ts[i]!),mn=iv.reduce((a,b)=>a+b,0)/iv.length,sd=Math.sqrt(iv.reduce((s,x)=>s+(x-mn)**2,0)/iv.length);
  const ib=sd<500&&mn<3000;
  if(ib)writeAuditLog('abuse.bot_timing_detected',{stdDevMs:Math.round(sd),meanMs:Math.round(mn)}).catch(()=>{});
  return{isBot:ib,stdDevMs:Math.round(sd),reason:ib?`Timing too regular (±${Math.round(sd)}ms).`:undefined};
}

export function trackWebhookCall(sid:string){const t=getTracker(`webhook_${sid}`,60_000);if(t.count>LIMITS['webhook']!.count)writeAuditLog('abuse.webhook_spike',{sourceId:sid,count:t.count}).catch(()=>{});return{allowed:t.count<=LIMITS['webhook']!.count,callCount:t.count};}
export const detectWebhookAbuse=trackWebhookCall;export const apiAbuse=trackWebhookCall;export const webhookAbuse=trackWebhookCall;

export function checkProfileViewLimit(vid:string){const t=getTracker(`pv_${vid}`,86_400_000);return{withinLimit:t.count<=500,viewCount:t.count};}
export const profileViewLimit=checkProfileViewLimit;export const viewRateLimit=checkProfileViewLimit;export const rateLimitView=checkProfileViewLimit;

export async function checkSuperLikeLimit(uid:string):Promise<{withinLimit:boolean;remaining:number}>{void uid;const r=await checkRateLimit('super_like');return{withinLimit:r.allowed,remaining:r.remaining};}
export const superLikeLimit=checkSuperLikeLimit;export const superLikeAbuse=checkSuperLikeLimit;export const limitSuperLike=checkSuperLikeLimit;

export function detectBotStoryViews(vid:string){const t=getTracker(`story_${vid}`,3_600_000);return{isBot:t.count>200,viewCount:t.count};}
export const botStory=detectBotStoryViews;export const storyBot=detectBotStoryViews;export const botViewStory=detectBotStoryViews;

export async function detectReferralFraud(rid:string,nuid:string,df?:string):Promise<{fraudulent:boolean;reason?:string}>{
  try{
    if(df){const snap=await getDoc(doc(db,'deviceMetrics',df));if(snap.exists()&&(snap.data()?.['accountCreations']??0)>1)return{fraudulent:true,reason:'Referral from same device.'};}
    const t=getTracker(`referral_${rid}`,86_400_000);
    if(t.count>20)return{fraudulent:true,reason:`${t.count} referrals in 24h.`};
    await setDoc(doc(db,'referrals',`${rid}_${nuid}`),{referrerId:rid,newUserId:nuid,deviceFingerprint:df,timestamp:Date.now()});
    return{fraudulent:false};
  }catch{return{fraudulent:false};}
}
export const referralFraud=detectReferralFraud;export const fraudReferral=detectReferralFraud;

export function formatResetTime(ms:number):string{const h=Math.floor(ms/3_600_000),m=Math.floor((ms%3_600_000)/60_000);return h>0?`${h}h ${m}m`:`${m}m`;}

export async function getRateLimitStatus(action:string):Promise<{used:number;limit:number;resetIn?:number}>{
  const user=auth.currentUser;if(!user)return{used:0,limit:0};
  const lim=LIMITS[action];if(!lim)return{used:0,limit:0};
  try{
    const snap=await getDoc(doc(db,'rateLimits',user.uid,'actions',action));
    if(!snap.exists())return{used:0,limit:lim.count};
    const d=snap.data(),el=Date.now()-(d['firstAction']??Date.now());
    if(el>lim.period)return{used:0,limit:lim.count};
    return{used:d['count']??0,limit:lim.count,resetIn:lim.period-el};
  }catch{return{used:0,limit:lim.count};}
}

export interface ProfileViewRateResult{withinLimit:boolean;viewCount:number;riskLevel:'none'|'low'|'medium'|'high';action:'allow'|'rate_limit'|'block';}
export function checkProfileViewRateLimit(vid:string,windowMin=10):ProfileViewRateResult{
  const t=getTracker(`pvr_${vid}`,windowMin*60_000);
  const rl=t.count>100?'high':t.count>50?'medium':t.count>20?'low':'none';
  return{withinLimit:t.count<=500,viewCount:t.count,riskLevel:rl,action:rl==='high'?'block':rl==='medium'?'rate_limit':'allow'};}
export const profileViewRateLimit=checkProfileViewRateLimit;export const profileViewRate=checkProfileViewRateLimit;

export function profileViewRateLimitCheck(views:Array<{targetId:string;timestamp:number}>,windowMin=10):ProfileViewRateResult{
  const now=Date.now(),recent=views.filter(v=>now-v.timestamp<windowMin*60_000);
  const rl=recent.length>100?'high':recent.length>50?'medium':recent.length>20?'low':'none';
  return{withinLimit:recent.length<=500,viewCount:recent.length,riskLevel:rl,action:rl==='high'?'block':rl==='medium'?'rate_limit':'allow'};}
export const profileViewWindow=profileViewRateLimitCheck;

export interface PostBlockContactResult{detected:boolean;attemptCount:number;methods:string[];riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'none'|'warn'|'restrict'|'suspend'|'escalate';}
const blockContactLog=new Map<string,{timestamps:number[];methods:string[]}>();
export function detectPostBlockContact(blockerId:string,blockedId:string,method:'message'|'profile_view'|'new_account'|'phone'|'social'|'proxy'):PostBlockContactResult{
  const key=`${blockedId}_${blockerId}`,now=Date.now();
  if(!blockContactLog.has(key))blockContactLog.set(key,{timestamps:[],methods:[]});
  const log=blockContactLog.get(key)!;
  log.timestamps=log.timestamps.filter(t=>now-t<7*86_400_000);
  log.timestamps.push(now);if(!log.methods.includes(method))log.methods.push(method);
  const cnt=log.timestamps.length,methods=log.methods;
  writeAuditLog('safety.post_block_contact',{blockedId,blockerId,method,attemptCount:cnt}).catch(()=>{});
  const rl=method==='new_account'||cnt>=10?'critical':cnt>=5||methods.length>=3?'high':cnt>=3?'medium':cnt>=1?'low':'none';
  return{detected:true,attemptCount:cnt,methods,riskLevel:rl,action:rl==='critical'?'escalate':rl==='high'?'suspend':rl==='medium'?'restrict':'warn'};}
export const postBlockContact=detectPostBlockContact;export const contactAfterBlock=detectPostBlockContact;export const blockEvasionContact=detectPostBlockContact;

export interface GhostProfileAuditResult{ghostCount:number;activeCount:number;ratio:number;inflationary:boolean;recommendation:string;}
export function auditGhostProfiles(profiles:Array<{lastActiveAt:number;messagesSent:number;profileComplete:boolean}>):GhostProfileAuditResult{
  const now=Date.now();
  const ghosts=profiles.filter(p=>now-p.lastActiveAt>90*86_400_000&&p.messagesSent===0);
  const active=profiles.length-ghosts.length;
  const ratio=profiles.length>0?ghosts.length/profiles.length:0;
  const inflationary=ratio>0.3;
  if(inflationary)writeAuditLog('platform.ghost_profile_inflation',{ghostCount:ghosts.length,total:profiles.length,ratio}).catch(()=>{});
  return{ghostCount:ghosts.length,activeCount:active,ratio:Math.round(ratio*100)/100,inflationary,recommendation:inflationary?`${Math.round(ratio*100)}% of profiles are ghost accounts. Archive or prompt reactivation to maintain trust metrics.`:'Ghost profile ratio within acceptable range.'};}
export const ghostProfileAudit=auditGhostProfiles;export const zombieProfileAudit=auditGhostProfiles;export const inactiveProfileRatio=auditGhostProfiles;
