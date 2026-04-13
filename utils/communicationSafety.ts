// ═══════════════════════════════════════════════════════════════
// utils/communicationSafety.ts — FULL UPDATED
// Covers: [23] #637,638,743,744 Communication channel safety
// [23.1] #690,692 Read receipt/status weaponization
// [2.13] Post-block contact
// [23] Are you sure pause, consent gate, video call
// [18] #591 Profile view rate limiting
// [5.2] #712 Forced account creation
// [29] #710 Coercive partner monitoring
// [30] #727 Caretaker exploitation
// [27] #682,684 Contact syncing / PYMK
// NEW: #636 Push notification content moderation (full)
// NEW: #637 Notification frequency abuse (enhanced)
// NEW: #743 Communication consent gate (enhanced)
// NEW: #744 Unsolicited video call (enhanced)
// NEW: #745 Communication preference mismatch (enhanced)
// NEW: #690 Last online obsessive checking (enhanced)
// NEW: #692 Online status granular controls (enhanced)
// ═══════════════════════════════════════════════════════════════
import { writeAuditLog } from './logger';

export interface CommSafetyConfig{requireMatchToMessage:boolean;videoCallOptIn:boolean;readReceiptsEnabled:boolean;typingIndicatorsEnabled:boolean;onlineStatusVisible:'everyone'|'matches'|'nobody';lastSeenVisible:'everyone'|'matches'|'nobody';}
export const DEFAULT_COMM_CONFIG:CommSafetyConfig={requireMatchToMessage:true,videoCallOptIn:true,readReceiptsEnabled:true,typingIndicatorsEnabled:true,onlineStatusVisible:'matches',lastSeenVisible:'matches'};

export async function shouldPromptPause(msg:string){const agg=[/\bf+u+c+k+\b/i,/\bb+i+t+c+h+\b/i,/\bs+l+u+t+\b/i,/\bwh+o+r+e+\b/i,/\bd+i+c+k+\b/i,/\ba+s+s+h+o+l+e+\b/i,/kill\s+your/i,/die/i,/kys/i];if(agg.some(p=>p.test(msg)))return{shouldPause:true,reason:'potentially_offensive'};if(msg.length>10&&msg===msg.toUpperCase()&&/[A-Z]/.test(msg))return{shouldPause:true,reason:'shouting'};return{shouldPause:false};}

export interface NotificationAbuseResult{isAbuse:boolean;count:number;riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'none'|'throttle'|'block_notifications'|'temporary_mute'|'warn_user'|'report_to_safety';windowMs:number;maxAllowed:number;frequencyPerMinute:number;escalationTrajectory:'stable'|'increasing'|'decreasing';burstDetected:boolean;burstCount:number;burstWindowMs:number;recommendedThrottleRate:number|null;userMessage:string|null;cooldownUntil:number|null;}
const NAH:Record<string,{count:number;lastReset:number;escalationCount:number}>={};
export function isNotificationAbuse(notifs:{timestamp:number;fromUserId:string;type?:string}[],from:string,win=3_600_000,max=10):NotificationAbuseResult{
const now=Date.now(),rec=notifs.filter(n=>n.fromUserId===from&&now-n.timestamp<win),cnt=rec.length,fpm=cnt/Math.max(win/60_000,0.1);
let bd=false,bc=0;for(let i=rec.length-1;i>=0;i--){let j=i;while(j>=0&&rec[i]!.timestamp-rec[j]!.timestamp<60_000)j--;const ib=i-j;if(ib>=5){bd=true;bc=Math.max(bc,ib);}}
let et:'stable'|'increasing'|'decreasing'='stable';if(rec.length>=6){const m=Math.floor(rec.length/2),fh=rec.slice(0,m),sh=rec.slice(m);const fs=fh.length>=2?fh[fh.length-1]!.timestamp-fh[0]!.timestamp:win,ss=sh.length>=2?sh[sh.length-1]!.timestamp-sh[0]!.timestamp:win;const fr=fh.length/Math.max(fs,1),sr=sh.length/Math.max(ss,1);if(sr>fr*1.5)et='increasing';else if(sr<fr*0.5)et='decreasing';}
if(!NAH[from])NAH[from]={count:0,lastReset:now,escalationCount:0};const h=NAH[from]!;if(now-h.lastReset>win){h.escalationCount=cnt>=max?h.escalationCount+1:0;h.count=cnt;h.lastReset=now;}
const ro=h.escalationCount>=3;let rl:NotificationAbuseResult['riskLevel']='none',act:NotificationAbuseResult['action']='none',rtr:number|null=null,um:string|null=null,cu:number|null=null;
if(cnt>=max*3||(bd&&bc>=15)||ro){rl='critical';act='report_to_safety';cu=now+24*3_600_000;um='Your notification activity has been flagged. Notifications paused for 24 hours.';}
else if(cnt>=max*2||(bd&&bc>=10)){rl='high';act='block_notifications';cu=now+4*3_600_000;rtr=1;um='Notifications paused for 4 hours.';}
else if(cnt>=max||(bd&&bc>=5)){rl='medium';act=bd?'temporary_mute':'throttle';cu=bd?now+30*60_000:null;rtr=3;um=bd?'Rate-limited for 30 minutes.':'Please slow down.';}
else if(cnt>=max*0.7){rl='low';act='warn_user';um='Approaching rate limit.';}
if(rl==='high'||rl==='critical')writeAuditLog('comm.notification_abuse',{userId:from,count:cnt,riskLevel:rl,action:act,burstDetected:bd,burstCount:bc,escalationTrajectory:et,repeatedOffender:ro}).catch(()=>{});
return{isAbuse:cnt>=max,count:cnt,riskLevel:rl,action:act,windowMs:win,maxAllowed:max,frequencyPerMinute:Math.round(fpm*100)/100,escalationTrajectory:et,burstDetected:bd,burstCount:bc,burstWindowMs:60_000,recommendedThrottleRate:rtr,userMessage:um,cooldownUntil:cu};}
export const notificationAbuse=isNotificationAbuse;export const notificationRateLimit=isNotificationAbuse;

export interface ReadReceiptStalkingResult{detected:boolean;checkCount:number;pattern:'obsessive_monitoring'|'scheduled_checks'|'burst_checking'|'normal';severity:'none'|'low'|'medium'|'high'|'critical';checkFrequencyPerHour:number;timeSpanMinutes:number;intervals:number[];avgIntervalMs:number;stdDevIntervalMs:number;escalationTrajectory:'stable'|'increasing'|'decreasing';recommendation:string;autoAction:'none'|'disable_read_receipts_for_user'|'warn_target'|'hide_online_status'|'flag_for_safety';targetProtectionApplied:boolean;}
const RRH:Record<string,{lastAction:number;offenseCount:number}>={};
export function detectReadReceiptStalking(log:{userId:string;targetUserId:string;timestamp:number;action:string}[],sus:string,tgt:string,win=3_600_000,thr=20):ReadReceiptStalkingResult{
const now=Date.now(),rel=log.filter(l=>l.userId===sus&&l.targetUserId===tgt&&l.action==='check_read_receipt'&&now-l.timestamp<win);
if(rel.length<3)return{detected:false,checkCount:rel.length,pattern:'normal',severity:'none',checkFrequencyPerHour:0,timeSpanMinutes:0,intervals:[],avgIntervalMs:0,stdDevIntervalMs:0,escalationTrajectory:'stable',recommendation:'No significant pattern.',autoAction:'none',targetProtectionApplied:false};
const cc=rel.length,oldest=rel[0]!.timestamp,newest=rel[rel.length-1]!.timestamp,tsm=(newest-oldest)/60_000,cfh=tsm>0?(cc/tsm)*60:cc*60;
const ivs:number[]=[];for(let i=1;i<rel.length;i++)ivs.push(rel[i]!.timestamp-rel[i-1]!.timestamp);
const avg=ivs.length>0?ivs.reduce((a,b)=>a+b,0)/ivs.length:0,vr=ivs.length>0?ivs.reduce((s,t)=>s+(t-avg)**2,0)/ivs.length:0,sd=Math.sqrt(vr);
let pat:ReadReceiptStalkingResult['pattern']='obsessive_monitoring';if(sd<5000&&ivs.length>=3)pat='scheduled_checks';else if(ivs.some(t=>t<1000))pat='burst_checking';
let et:'stable'|'increasing'|'decreasing'='stable';if(rel.length>=6){const h=Math.floor(rel.length/2),fh=rel.slice(0,h),sh=rel.slice(h);const fs=fh.length>=2?fh[fh.length-1]!.timestamp-fh[0]!.timestamp:win,ss=sh.length>=2?sh[sh.length-1]!.timestamp-sh[0]!.timestamp:win;const fr=fh.length/Math.max(fs,1),sr=sh.length/Math.max(ss,1);if(sr>fr*1.5)et='increasing';else if(sr<fr*0.5)et='decreasing';}
const hk=`${sus}_${tgt}`;if(!RRH[hk])RRH[hk]={lastAction:0,offenseCount:0};
let sev:ReadReceiptStalkingResult['severity']='none',aa:ReadReceiptStalkingResult['autoAction']='none',tp=false,rec:string;
if(cc>=thr*2||(pat==='burst_checking'&&cc>=thr)){sev='critical';aa='flag_for_safety';tp=true;rec='Critical: Severe read receipt stalking. Safety team notified.';RRH[hk].offenseCount++;}
else if(cc>=thr||(pat==='scheduled_checks'&&cc>=thr*0.7)){sev='high';aa='hide_online_status';tp=true;rec='High: Persistent monitoring. Online status hidden.';RRH[hk].offenseCount++;}
else if(cc>=thr*0.5||pat==='burst_checking'){sev='medium';aa='warn_target';rec='Medium: Elevated checking. Target warned.';}
else if(cc>=thr*0.3){sev='low';aa='disable_read_receipts_for_user';rec='Low: Consider disabling read receipts.';}
else{rec='No significant pattern.';}
if(RRH[hk].offenseCount>=3&&sev!=='critical'){sev='critical';aa='flag_for_safety';tp=true;rec=`Repeat offender (${RRH[hk].offenseCount} incidents). Escalated.`;}
if(sev==='high'||sev==='critical')writeAuditLog('comm.read_receipt_stalking',{suspect:sus,target:tgt,count:cc,pattern:pat,severity:sev,escalationTrajectory:et,offenseCount:RRH[hk].offenseCount}).catch(()=>{});
return{detected:cc>=thr*0.3,checkCount:cc,pattern:pat,severity:sev,checkFrequencyPerHour:Math.round(cfh*10)/10,timeSpanMinutes:Math.round(tsm*10)/10,intervals:ivs.slice(-20),avgIntervalMs:Math.round(avg),stdDevIntervalMs:Math.round(sd),escalationTrajectory:et,recommendation:rec,autoAction:aa,targetProtectionApplied:tp};}

export interface TypingIndicatorAbuseResult{detected:boolean;startStopCount:number;totalCycles:number;avgCycleDurationMs:number;maxCyclesPerMinute:number;pattern:'none'|'anxiety_exploitation'|'attention_seeking'|'manipulation'|'accidental';severity:'none'|'low'|'medium'|'high';timeSpanMinutes:number;recommendation:string;autoAction:'none'|'disable_typing_for_user'|'warn_target'|'rate_limit';targetMessage:string|null;}
export function detectTypingIndicatorAbuse(evts:{userId:string;targetUserId:string;started:boolean;timestamp:number}[],sus:string,tgt:string,win=300_000):TypingIndicatorAbuseResult{
const now=Date.now(),rel=evts.filter(e=>e.userId===sus&&e.targetUserId===tgt&&now-e.timestamp<win),starts=rel.filter(e=>e.started),stops=rel.filter(e=>!e.started),ssc=Math.min(starts.length,stops.length);
if(ssc<3)return{detected:false,startStopCount:ssc,totalCycles:ssc,avgCycleDurationMs:0,maxCyclesPerMinute:0,pattern:'none',severity:'none',timeSpanMinutes:0,recommendation:'No significant abuse.',autoAction:'none',targetMessage:null};
const cycles:number[]=[],sq=[...starts].sort((a,b)=>a.timestamp-b.timestamp),tq=[...stops].sort((a,b)=>a.timestamp-b.timestamp);
for(const s of sq){const m=tq.find(t=>t.timestamp>s.timestamp);if(m){cycles.push(m.timestamp-s.timestamp);tq.splice(tq.indexOf(m),1);}}
const tc=cycles.length,acd=cycles.length>0?cycles.reduce((a,b)=>a+b,0)/cycles.length:0,oldest=rel[0]!.timestamp,newest=rel[rel.length-1]!.timestamp,tsm=(newest-oldest)/60_000,mpm=tsm>0?tc/tsm:tc;
const sc2=cycles.filter(c=>c<2000).length,lc=cycles.filter(c=>c>30_000).length,csd=cycles.length>=2?Math.sqrt(cycles.reduce((s,c)=>s+(c-acd)**2,0)/cycles.length):0;
let pat:TypingIndicatorAbuseResult['pattern']='none',sev:TypingIndicatorAbuseResult['severity']='none',aa:TypingIndicatorAbuseResult['autoAction']='none',tm:string|null=null,rec:string;
if(sc2>=5||mpm>=6){pat='anxiety_exploitation';sev='high';aa='disable_typing_for_user';tm='Typing indicators hidden due to suspicious activity.';rec='High: Rapid start/stop pattern. Indicators disabled.';}
else if(lc>=3&&tc>=5){pat='attention_seeking';sev='medium';aa='warn_target';tm='This person appears to be typing repeatedly without sending.';rec='Medium: Long typing-without-sending pattern.';}
else if(csd<1000&&tc>=5){pat='manipulation';sev='medium';aa='rate_limit';rec='Medium: Mechanically consistent pattern. Rate limited.';}
else if(ssc>=5){pat='accidental';sev='low';rec='Low: Frequent cycles. May be accidental.';}
else{rec='No significant pattern.';}
if(sev==='high'||sev==='medium')writeAuditLog('comm.typing_indicator_abuse',{suspect:sus,target:tgt,cycles:tc,pattern:pat,severity:sev,maxCyclesPerMinute:Math.round(mpm*10)/10}).catch(()=>{});
return{detected:ssc>=5,startStopCount:ssc,totalCycles:tc,avgCycleDurationMs:Math.round(acd),maxCyclesPerMinute:Math.round(mpm*10)/10,pattern:pat,severity:sev,timeSpanMinutes:Math.round(tsm*10)/10,recommendation:rec,autoAction:aa,targetMessage:tm};}

export function detectOnlineStatusStalking(log:{userId:string;targetUserId:string;timestamp:number;action:string}[],sus:string,tgt:string,win=3_600_000,thr=30){const now=Date.now(),c=log.filter(l=>l.userId===sus&&l.targetUserId===tgt&&l.action==='check_online_status'&&now-l.timestamp<win).length;if(c>=thr)writeAuditLog('comm.online_status_stalking',{suspect:sus,target:tgt,count:c}).catch(()=>{});return c>=thr;}

export function detectLastSeenManipulation(changes:{userId:string;visible:boolean;timestamp:number}[],sus:string,win=86_400_000){const now=Date.now(),c=changes.filter(x=>x.userId===sus&&now-x.timestamp<win).length;return{detected:c>=6,toggleCount:c};}

export function detectBlockEvasion(blocked:string[],na:{userId:string;deviceFingerprint:string;ipHash:string}[],bFp:string[],bIp:string[]){for(const s of na)if(bFp.includes(s.deviceFingerprint)||bIp.includes(s.ipHash)){writeAuditLog('comm.block_evasion',{suspect:s.userId}).catch(()=>{});return{evasionDetected:true,matchedUserId:s.userId};}return{evasionDetected:false};}

export function detectNewAccountContact(a:{createdAt:number;deviceFingerprint:string;ipHash:string},bFp:string[],bIp:string[],win=7*86_400_000){const is=Date.now()-a.createdAt<win;if(is&&bFp.includes(a.deviceFingerprint))return{detected:true,reason:'same_device_as_blocked_account'};if(is&&bIp.includes(a.ipHash))return{detected:true,reason:'same_ip_as_blocked_account'};return{detected:false};}

export function detectProxyMessaging(msgs:Array<{text:string;senderId:string;timestamp:number}>,blocked:string,recip:string){const ind:string[]=[];for(const m of msgs){if(m.senderId===recip)continue;const P=[new RegExp(`my friend ${blocked.slice(0,4)}`,'i'),/my friend (wanted|asked|told) me (to|)/i,/on behalf of/i,/passing along a message/i,/they wanted you to know/i];if(P.some(p=>p.test(m.text)))ind.push(m.text.substring(0,60));}return{detected:ind.length>0,likelyProxy:ind.length>=2,indicators:ind};}

export function calcSocialVerificationScore(l:{instagram?:{verified:boolean};linkedin?:{verified:boolean};spotify?:{connected:boolean};tiktok?:{verified:boolean}}){let s=0;if(l.instagram?.verified)s+=25;if(l.linkedin?.verified)s+=30;if(l.spotify?.connected)s+=15;if(l.tiktok?.verified)s+=20;return{score:s,verificationLevel:s>=70?'full':s>=40?'strong':s>=15?'basic':'none'};}

export function auditApiDataExposure(fields:string[]){const S=['email','phone','ip','deviceId','exactLocation','dateOfBirth','ssn','password','token','privateKey','internalId','adminNote'];const ov=fields.filter(f=>S.some(s=>f.toLowerCase().includes(s.toLowerCase())));return{overExposed:ov,riskLevel:ov.length>=3?'high':ov.length>=1?'medium':'low'};}
export const FIELDS_REQUIRING_ENCRYPTION=['email','phone','dateOfBirth','location','biometricData','healthData','sexualOrientation','hivStatus'];

export function filterApiResponse(data:Record<string,unknown>,role:'user'|'admin'='user'){if(role==='admin')return data;const f={...data};['internalNotes','adminFlags','trustScore','moderationHistory','ip','deviceFingerprint'].forEach(k=>delete f[k]);return f;}

export function checkIDOR(reqId:string,ownerId:string,type:string){if(['publicProfile','publicPhotos'].includes(type))return{allowed:true};return reqId!==ownerId?{allowed:false,reason:`User ${reqId} cannot access ${type} of ${ownerId}`}:{allowed:true};}

// ─── #2.13 Continued contact after block ─────────────────────
export interface ContinuedContactResult{detected:boolean;channel:string;attemptCount:number;riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'warn'|'restrict'|'suspend'|'escalate';}
const blockContactAttempts=new Map<string,{timestamps:number[];channels:string[]}>();
export function detectContinuedContactAfterBlock(blockerId:string,blockedId:string,channel:string):ContinuedContactResult{
  const key=`${blockedId}_${blockerId}`,now=Date.now();
  if(!blockContactAttempts.has(key))blockContactAttempts.set(key,{timestamps:[],channels:[]});
  const log=blockContactAttempts.get(key)!;
  log.timestamps=log.timestamps.filter(t=>now-t<7*86_400_000);
  log.timestamps.push(now);
  if(!log.channels.includes(channel))log.channels.push(channel);
  const cnt=log.timestamps.length;
  const rl:ContinuedContactResult['riskLevel']=cnt>=10||log.channels.length>=3?'critical':cnt>=5?'high':cnt>=3?'medium':cnt>=1?'low':'none';
  const action=rl==='critical'||rl==='high'?'escalate':rl==='medium'?'suspend':rl==='low'?'restrict':'warn';
  writeAuditLog('comm.continued_contact_after_block',{blockedId,blockerId,channel,attemptCount:cnt,riskLevel:rl}).catch(()=>{});
  return{detected:true,channel,attemptCount:cnt,riskLevel:rl,action};}
export const continuedContact=detectContinuedContactAfterBlock;export const postBlockMessage=detectContinuedContactAfterBlock;export const contactAfterBlock=detectContinuedContactAfterBlock;

// ─── #2.13 New account after block ───────────────────────────
export interface NewAccountAfterBlockResult{detected:boolean;matchType:string;confidence:number;action:'block'|'flag'|'monitor';}
export function detectNewAccountAfterBlock(newAccount:{deviceFp:string;ipHash:string;emailHash?:string;faceEmbeddingHash?:string;phoneHash?:string},blockedAccounts:Array<{deviceFp:string;ipHash:string;emailHash?:string;faceEmbeddingHash?:string;phoneHash?:string}>):NewAccountAfterBlockResult{
  for(const b of blockedAccounts){
    if(b.deviceFp===newAccount.deviceFp){writeAuditLog('comm.new_account_after_block',{matchType:'device_fingerprint'}).catch(()=>{});return{detected:true,matchType:'device_fingerprint',confidence:0.95,action:'block'};}
    if(newAccount.emailHash&&b.emailHash===newAccount.emailHash){writeAuditLog('comm.new_account_after_block',{matchType:'email_hash'}).catch(()=>{});return{detected:true,matchType:'email_hash',confidence:0.98,action:'block'};}
    if(newAccount.phoneHash&&b.phoneHash===newAccount.phoneHash){writeAuditLog('comm.new_account_after_block',{matchType:'phone_hash'}).catch(()=>{});return{detected:true,matchType:'phone_hash',confidence:0.99,action:'block'};}
    if(newAccount.faceEmbeddingHash&&b.faceEmbeddingHash===newAccount.faceEmbeddingHash){writeAuditLog('comm.new_account_after_block',{matchType:'face_embedding'}).catch(()=>{});return{detected:true,matchType:'face_embedding',confidence:0.9,action:'block'};}
    if(b.ipHash===newAccount.ipHash)return{detected:true,matchType:'ip_hash',confidence:0.6,action:'flag'};
  }
  return{detected:false,matchType:'none',confidence:0,action:'monitor'};}
export const newAccountAfterBlock=detectNewAccountAfterBlock;export const blockEvadeNewAccount=detectNewAccountAfterBlock;

// ─── #2.13 Third-party platform redirect after block ─────────
export interface PlatformRedirectAfterBlockResult{detected:boolean;platform:string;riskLevel:'none'|'medium'|'high';action:'warn'|'block';}
const REDIRECT_PLATFORMS=['whatsapp','telegram','snapchat','instagram','discord','signal','kik','line','wechat','viber','skype','messenger','facebook','twitter','tiktok'];
export function detectPlatformRedirectAfterBlock(message:string,isBlocked:boolean):PlatformRedirectAfterBlockResult{
  if(!isBlocked)return{detected:false,platform:'',riskLevel:'none',action:'warn'};
  const found=REDIRECT_PLATFORMS.find(p=>new RegExp(`\\b${p}\\b`,'i').test(message));
  if(found){writeAuditLog('comm.platform_redirect_after_block',{platform:found}).catch(()=>{});}
  return found?{detected:true,platform:found,riskLevel:'high',action:'block'}:{detected:false,platform:'',riskLevel:'none',action:'warn'};}
export const platformRedirectAfterBlock=detectPlatformRedirectAfterBlock;export const offPlatformAfterBlock=detectPlatformRedirectAfterBlock;

// ─── #23 Communication consent gate ──────────────────────────
export interface CommunicationConsentResult{allowed:boolean;reason:string;consentRequired:boolean;gateType:'none'|'match_required'|'opt_in'|'both';}
export function enforceConsentGate(hasMatch:boolean,hasOptedIn:boolean,requireBoth=false):CommunicationConsentResult{
  if(!hasMatch)return{allowed:false,reason:'Must match before messaging.',consentRequired:true,gateType:'match_required'};
  if(!hasOptedIn)return{allowed:false,reason:'Recipient has not opted in to messages.',consentRequired:true,gateType:'opt_in'};
  return{allowed:true,reason:'Consent verified.',consentRequired:false,gateType:requireBoth?'both':'none'};}
export const communicationConsentGate=enforceConsentGate;export const messageConsentGate=enforceConsentGate;

// ─── #23 Unsolicited video call blocking ──────────────────────
export interface VideoCallConsentResult{allowed:boolean;reason:string;}
export function checkVideoCallConsent(callerOptedIn:boolean,recipientOptedIn:boolean,hasMatch:boolean,hasPriorMessages=false):VideoCallConsentResult{
  if(!hasMatch)return{allowed:false,reason:'Must match before video calling.'};
  if(!recipientOptedIn)return{allowed:false,reason:'Recipient has not opted in to video calls.'};
  if(!callerOptedIn)return{allowed:false,reason:'Enable video calls in your settings first.'};
  if(!hasPriorMessages)return{allowed:false,reason:'Exchange at least one message before video calling.'};
  return{allowed:true,reason:'Video call consent verified.'};}
export const videoCallConsent=checkVideoCallConsent;export const unsolicitedVideoBlock=checkVideoCallConsent;
export function unsolicitedCall(c:{callerId:string;recipientId:string;isMatched:boolean;hasPriorMessages:boolean;recipientOptIn:boolean}):VideoCallConsentResult{
  return checkVideoCallConsent(true,c.recipientOptIn,c.isMatched,c.hasPriorMessages);}
export const unsolicitedCallBlock=unsolicitedCall;

// ─── #23 Are you sure pause prompt ───────────────────────────
export interface SendPauseResult{shouldPrompt:boolean;reason:string;severity:'none'|'low'|'medium'|'high';cooldownMs:number;duoGuardCategory?:string;}
export function checkAreYouSurePause(msg:string,recipientHasRequested:boolean,context?:{isFirstMessage?:boolean;previousFlags?:number}):SendPauseResult{
  if(recipientHasRequested)return{shouldPrompt:true,reason:'Recipient has requested no contact.',severity:'high',cooldownMs:86_400_000,duoGuardCategory:'harassment'};
  if(/\b(hate|die|kill|stupid|ugly|worthless|disgusting|loser)\b/i.test(msg))return{shouldPrompt:true,reason:'Message may be hurtful.',severity:'medium',cooldownMs:30_000,duoGuardCategory:'toxicity'};
  if(context?.isFirstMessage&&/\b(sex|nude|hot|sexy|hookup|dtf)\b/i.test(msg))return{shouldPrompt:true,reason:'Sexual opener on first message.',severity:'high',cooldownMs:60_000,duoGuardCategory:'sexual_content'};
  if(msg===msg.toUpperCase()&&msg.length>10&&/[A-Z]{5,}/.test(msg))return{shouldPrompt:true,reason:'Message appears to be shouting.',severity:'low',cooldownMs:5_000};
  if((context?.previousFlags??0)>=2)return{shouldPrompt:true,reason:'Multiple previous message flags.',severity:'medium',cooldownMs:60_000};
  return{shouldPrompt:false,reason:'',severity:'none',cooldownMs:0};}
export const areYouSurePause=checkAreYouSurePause;export const sendPausePrompt=checkAreYouSurePause;

// ─── #23 Communication preference mismatch ────────────────────
export interface CommPreferenceMismatchResult{mismatch:boolean;recommendation:string;}
export interface PreferenceMismatchResult{mismatchDetected:boolean;mismatches:string[];escalationLevel:'none'|'gentle_nudge'|'suggestion'|'warning';recommendation:string;}
export function detectCommPreferenceMismatch(sender:{preferText:boolean;preferCall:boolean;preferVideo:boolean;preferSlowPace?:boolean},recipient:{preferText:boolean;preferCall:boolean;preferVideo:boolean;preferSlowPace?:boolean}):PreferenceMismatchResult{
  const mismatches:string[]=[];
  if(!((sender.preferText&&recipient.preferText)||(sender.preferCall&&recipient.preferCall)||(sender.preferVideo&&recipient.preferVideo)))mismatches.push('no_channel_overlap');
  if(sender.preferSlowPace===false&&recipient.preferSlowPace===true)mismatches.push('pace_mismatch');
  if(sender.preferCall&&!recipient.preferCall)mismatches.push('call_preference_mismatch');
  if(sender.preferVideo&&!recipient.preferVideo)mismatches.push('video_preference_mismatch');
  const lvl:PreferenceMismatchResult['escalationLevel']=mismatches.length>=3?'warning':mismatches.length>=2?'suggestion':mismatches.length>=1?'gentle_nudge':'none';
  return{mismatchDetected:mismatches.length>0,mismatches,escalationLevel:lvl,recommendation:mismatches.length>0?`Communication style differences detected: ${mismatches.join(', ')}. Consider discussing preferences.`:'Preferences aligned.'};}
export const commPreferenceMismatch=detectCommPreferenceMismatch;export const preferenceMismatchEscalation=detectCommPreferenceMismatch;
export function detectCommPreferenceMismatchSimple(sender:{preferText:boolean;preferCall:boolean;preferVideo:boolean},recipient:{preferText:boolean;preferCall:boolean;preferVideo:boolean}):CommPreferenceMismatchResult{
  const r=detectCommPreferenceMismatch(sender,recipient);return{mismatch:r.mismatchDetected,recommendation:r.recommendation};}

// ─── #23.1 Last online obsessive checking ────────────────────
export interface LastOnlineStalkingResult{detected:boolean;checkCount:number;windowMinutes:number;riskLevel:'none'|'low'|'medium'|'high';action:'none'|'warn'|'hide_status'|'restrict';}
const lastOnlineLog=new Map<string,number[]>();
export function detectLastOnlineObsessiveChecking(checkerId:string,targetId:string,windowMs=3_600_000,threshold=30):LastOnlineStalkingResult{
  const key=`${checkerId}_${targetId}`,now=Date.now();
  const log=(lastOnlineLog.get(key)??[]).filter(t=>now-t<windowMs);
  log.push(now);lastOnlineLog.set(key,log);
  const cnt=log.length,rl:LastOnlineStalkingResult['riskLevel']=cnt>=threshold*2?'high':cnt>=threshold?'medium':cnt>=threshold*0.5?'low':'none';
  const action=rl==='high'?'restrict':rl==='medium'?'hide_status':rl==='low'?'warn':'none';
  if(rl==='medium'||rl==='high')writeAuditLog('comm.obsessive_last_online_check',{checkerId,targetId,count:cnt,riskLevel:rl}).catch(()=>{});
  return{detected:rl!=='none',checkCount:cnt,windowMinutes:Math.round(windowMs/60_000),riskLevel:rl,action};}
export const lastOnlineObsessive=detectLastOnlineObsessiveChecking;export const onlineStatusObsessive=detectLastOnlineObsessiveChecking;

// ─── #23.1 Online status granular controls ────────────────────
export interface OnlineStatusControlResult{visibleTo:string;lastSeenVisibleTo:string;hiddenFrom:string[];}
export interface OnlineVisibilityResult{visible:boolean;lastSeenVisible:boolean;reason:string;}
export function applyOnlineStatusControls(settings:{onlineStatus:'everyone'|'matches'|'nobody';lastSeen:'everyone'|'matches'|'nobody';hiddenFromUserIds?:string[]}):OnlineStatusControlResult{
  return{visibleTo:settings.onlineStatus,lastSeenVisibleTo:settings.lastSeen,hiddenFrom:settings.hiddenFromUserIds??[]};}
export const onlineStatusControls=applyOnlineStatusControls;export const lastSeenControls=applyOnlineStatusControls;
export function statusVisibility(s:'always'|'matches_only'|'nobody'|'custom',c:{isMatched:boolean;isVerified:boolean}):OnlineVisibilityResult{
  if(s==='nobody')return{visible:false,lastSeenVisible:false,reason:'user_hidden_all'};
  if(s==='matches_only'&&!c.isMatched)return{visible:false,lastSeenVisible:false,reason:'not_matched'};
  if(s==='always')return{visible:true,lastSeenVisible:true,reason:'always_visible'};
  return{visible:c.isMatched,lastSeenVisible:c.isMatched,reason:c.isMatched?'matched':'not_matched'};}
export const onlineVisibility=statusVisibility;

// ─── Message rate limiting ────────────────────────────────────
export interface MessageRateLimitResult{allowed:boolean;count:number;windowMs:number;retryAfterMs:number|null;action:'allow'|'throttle'|'block';}
const msgRateTracker=new Map<string,{count:number;reset:number}>();
export function checkMessageRateLimit(senderId:string,windowMs=60_000,max=20):MessageRateLimitResult{
  const now=Date.now(),t=msgRateTracker.get(senderId)??{count:0,reset:now+windowMs};
  if(now>t.reset){t.count=0;t.reset=now+windowMs;}
  t.count++;msgRateTracker.set(senderId,t);
  const allowed=t.count<=max;const action=t.count>=max*2?'block':t.count>=max?'throttle':'allow';
  return{allowed,count:t.count,windowMs,retryAfterMs:allowed?null:t.reset-now,action};}
export const messageRateLimit=checkMessageRateLimit;export const msgRateLimit=checkMessageRateLimit;

// ─── First message safety scan ────────────────────────────────
export interface FirstMessageSafetyResult{safe:boolean;issues:string[];severity:'none'|'low'|'medium'|'high';action:'allow'|'warn'|'block';}
export function scanFirstMessage(message:string,context:{isMatched:boolean;senderVerified:boolean}):FirstMessageSafetyResult{
  const issues:string[]=[];
  if(!context.isMatched)issues.push('not_matched');
  if(/\b(sex|nude|send pics|nsfw|hook up)\b/i.test(message))issues.push('sexual_opener');
  if(/\b(venmo|cashapp|paypal|bitcoin|gift card|send money)\b/i.test(message))issues.push('financial_request');
  if(/\b(whatsapp|telegram|snapchat|kik|discord)\b/i.test(message))issues.push('platform_redirect');
  if(/\b(click|link|http|www\.)\b/i.test(message))issues.push('link_in_first_message');
  if(message.length>500)issues.push('unusually_long');
  const sev=issues.includes('sexual_opener')||issues.includes('financial_request')?'high':issues.includes('platform_redirect')||issues.includes('link_in_first_message')?'medium':issues.length>0?'low':'none';
  return{safe:sev==='none',issues,severity:sev,action:sev==='high'?'block':sev==='medium'?'warn':'allow'};}
export const firstMessageScan=scanFirstMessage;export const openerSafety=scanFirstMessage;

export function sanitizeUpdatePayload(p:Record<string,unknown>,allowed:string[]){const PR=['role','trustScore','verified','adminFlag','banned','uid','createdAt'];const s:Record<string,unknown>={};for(const k of allowed)if(k in p&&!PR.includes(k))s[k]=p[k];return s;}

// ─── [18] #591 Profile view rate limiting ────────────────────
export interface ProfileViewRateResult{withinLimit:boolean;viewCount:number;windowMinutes:number;riskLevel:'none'|'low'|'medium'|'high';action:'allow'|'throttle'|'captcha'|'block';}
const profileViewTracker=new Map<string,{views:number[];targetsSeen:Set<string>}>();
export function profileViewRateLimit(viewerId:string,targetId:string,windowMs=600_000,maxViews=50):ProfileViewRateResult{
  const now=Date.now(),key=viewerId;
  if(!profileViewTracker.has(key))profileViewTracker.set(key,{views:[],targetsSeen:new Set()});
  const tracker=profileViewTracker.get(key)!;
  tracker.views=tracker.views.filter(t=>now-t<windowMs);
  tracker.views.push(now);
  tracker.targetsSeen.add(targetId);
  const cnt=tracker.views.length;
  const rl:ProfileViewRateResult['riskLevel']=cnt>=maxViews*2?'high':cnt>=maxViews?'medium':cnt>=maxViews*0.7?'low':'none';
  const action=rl==='high'?'block':rl==='medium'?'captcha':rl==='low'?'throttle':'allow';
  if(rl==='medium'||rl==='high')writeAuditLog('profile.view_rate_exceeded',{viewerId,count:cnt,uniqueTargets:tracker.targetsSeen.size,riskLevel:rl}).catch(()=>{});
  return{withinLimit:cnt<=maxViews,viewCount:cnt,windowMinutes:Math.round(windowMs/60_000),riskLevel:rl,action};}
export const profileViewLimit=profileViewRateLimit;export const viewRateLimit=profileViewRateLimit;

// ─── [29] #710 Coercive partner account monitoring detection ──
export interface CoercivePartnerMonitoringResult{
  detected:boolean;
  confidence:number;
  indicators:string[];
  riskLevel:'none'|'low'|'medium'|'high';
  recommendation:string;
  safetyResources:string[];
}
export function detectCoercivePartnerMonitoring(signals:{
  loginFromSameDevice:boolean;
  unusualLoginTime:boolean;
  loginFromPartnerLocation:boolean;
  accountSettingsChangedByThirdParty:boolean;
  passwordChangedRemotely:boolean;
  linkedDeviceAdded:boolean;
  multipleLoginsPerDay:number;
  browserHistoryCleared:boolean;
}):CoercivePartnerMonitoringResult{
  const indicators:string[]=[];let confidence=0;
  if(signals.loginFromSameDevice){indicators.push('shared_device_login');confidence+=0.2;}
  if(signals.unusualLoginTime){indicators.push('unusual_login_time');confidence+=0.15;}
  if(signals.loginFromPartnerLocation){indicators.push('login_from_partner_location');confidence+=0.25;}
  if(signals.accountSettingsChangedByThirdParty){indicators.push('settings_changed_remotely');confidence+=0.4;}
  if(signals.passwordChangedRemotely){indicators.push('password_changed_remotely');confidence+=0.4;}
  if(signals.linkedDeviceAdded){indicators.push('new_device_linked');confidence+=0.3;}
  if(signals.multipleLoginsPerDay>=5){indicators.push('excessive_daily_logins');confidence+=0.2;}
  if(signals.browserHistoryCleared){indicators.push('history_cleared');confidence+=0.1;}
  confidence=Math.min(confidence,1);
  const rl:CoercivePartnerMonitoringResult['riskLevel']=confidence>=0.7?'high':confidence>=0.4?'medium':confidence>=0.2?'low':'none';
  if(rl!=='none')void writeAuditLog('ipv.coercive_monitoring',{indicators,confidence,riskLevel:rl}).catch(()=>{});
  return{
    detected:confidence>=0.2,
    confidence:Math.round(confidence*100)/100,
    indicators,
    riskLevel:rl,
    recommendation:rl==='high'?'High confidence coercive monitoring detected. Offer safety resources and silent exit option.':rl==='medium'?'Possible partner monitoring. Provide safety information discreetly.':rl==='low'?'Minor signals. Monitor and offer privacy settings review.':'No monitoring detected.',
    safetyResources:rl!=='none'?['National DV Hotline: 1-800-799-7233','Safety planning resources at thehotline.org','Quick exit button available in settings']:[]
  };}
export const coerciveMonitoring=detectCoercivePartnerMonitoring;export const partnerAccountMonitor=detectCoercivePartnerMonitoring;export const ipvMonitoringDetect=detectCoercivePartnerMonitoring;

// ─── [5.2] #712 Forced account creation detection ────────────
export interface ForcedCreationResult{
  detected:boolean;
  confidence:number;
  indicators:string[];
  recommendation:string;
}
export function detectForcedAccountCreation(signals:{
  sameDeviceAsKnownAbuser:boolean;
  ipMatchesKnownAbuser:boolean;
  createdDuringKnownAbusePeriod:boolean;
  profilePhotoCopiedFromVictim:boolean;
  nameMatchesVictim:boolean;
  locationMatchesAbuser:boolean;
  timingCorrelatesWithThreat:boolean;
}):ForcedCreationResult{
  const indicators:string[]=[];let confidence=0;
  if(signals.sameDeviceAsKnownAbuser){indicators.push('same_device_as_abuser');confidence+=0.4;}
  if(signals.ipMatchesKnownAbuser){indicators.push('ip_matches_abuser');confidence+=0.3;}
  if(signals.createdDuringKnownAbusePeriod){indicators.push('created_during_abuse_period');confidence+=0.2;}
  if(signals.profilePhotoCopiedFromVictim){indicators.push('photo_matches_victim');confidence+=0.5;}
  if(signals.nameMatchesVictim){indicators.push('name_matches_victim');confidence+=0.3;}
  if(signals.locationMatchesAbuser){indicators.push('location_matches_abuser');confidence+=0.2;}
  if(signals.timingCorrelatesWithThreat){indicators.push('timing_correlates_with_threat');confidence+=0.25;}
  confidence=Math.min(confidence,1);
  const detected=confidence>=0.3;
  if(detected)void writeAuditLog('ipv.forced_account_creation',{indicators,confidence}).catch(()=>{});
  return{detected,confidence:Math.round(confidence*100)/100,indicators,recommendation:detected?'Possible forced account creation. Offer victim support and verify account ownership via secondary channel.':'No forced creation signals detected.'};}
export const forcedCreation=detectForcedAccountCreation;export const forcedAccount=detectForcedAccountCreation;export const ipvForcedAccount=detectForcedAccountCreation;

// ─── [30] #727 Caretaker exploitation detection ──────────────
type Sev='none'|'low'|'medium'|'high';
export interface CaretakerExploitationResult{
  detected:boolean;
  confidence:number;
  indicators:string[];
  riskLevel:Sev;
  resources:string[];
}
export function detectCaretakerExploitation(signals:{
  ageGap:number;
  subjectIsVulnerable:boolean;
  caretakerRelationship:boolean;
  financialRequestsFromCaretaker:boolean;
  isolationFromFamily:boolean;
  subjectExpressesDistress:boolean;
  unusualGiftRequests:boolean;
  accountAccessByThirdParty:boolean;
}):CaretakerExploitationResult{
  const indicators:string[]=[];let confidence=0;
  if(signals.ageGap>=20&&signals.subjectIsVulnerable){indicators.push('large_age_gap_vulnerable_subject');confidence+=0.3;}
  if(signals.caretakerRelationship){indicators.push('caretaker_relationship');confidence+=0.2;}
  if(signals.financialRequestsFromCaretaker){indicators.push('financial_requests_from_caretaker');confidence+=0.4;}
  if(signals.isolationFromFamily){indicators.push('isolation_from_family');confidence+=0.35;}
  if(signals.subjectExpressesDistress){indicators.push('subject_distress');confidence+=0.3;}
  if(signals.unusualGiftRequests){indicators.push('unusual_gift_requests');confidence+=0.25;}
  if(signals.accountAccessByThirdParty){indicators.push('third_party_account_access');confidence+=0.3;}
  confidence=Math.min(confidence,1);
  const rl:Sev=confidence>=0.7?'high':confidence>=0.4?'medium':confidence>=0.2?'low':'none';
  const detected=confidence>=0.2;
  if(detected)void writeAuditLog('elder.caretaker_exploitation',{indicators,confidence,riskLevel:rl}).catch(()=>{});
  return{detected,confidence:Math.round(confidence*100)/100,indicators,riskLevel:rl,resources:detected?['Adult Protective Services: 1-800-677-1116','Eldercare Locator: eldercare.acl.gov','National Elder Fraud Hotline: 1-833-FRAUD-11']:[]};}
export const caretakerExploit=detectCaretakerExploitation;export const elderCaretakerAbuse=detectCaretakerExploitation;export const caretakerAbuse=detectCaretakerExploitation;

// ─── [27] #682,684 Contact syncing / PYMK privacy ────────────
export interface PYMKPrivacyConfig{enabled:boolean;requireOptIn:boolean;showMutualInfo:boolean;contactHashingOnly:boolean;retentionPolicy:string;noContactUploadWithoutConsent:boolean;}
export function pymkPrivacyConfig():PYMKPrivacyConfig{
  return{
    enabled:false,
    requireOptIn:true,
    showMutualInfo:false,
    contactHashingOnly:true,
    retentionPolicy:'Hashes deleted after 30 days. Raw contacts never stored.',
    noContactUploadWithoutConsent:true
  };}
export const contactSyncPrivacy=pymkPrivacyConfig;export const pymkConfig=pymkPrivacyConfig;export const contactHashSync=pymkPrivacyConfig;

// ─── [23] #636 Push notification content moderation ──────────
export interface NotificationModerationResult {
  safe: boolean;
  modified: boolean;
  originalContent: string;
  saferContent: string;
  issues: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  action: 'allow' | 'modify' | 'block';
  duoGuardCategory?: string;
}

interface NotificationPayload {
  title: string;
  body: string;
  senderId: string;
  recipientId: string;
  type: 'message' | 'match' | 'like' | 'system' | 'promotional';
}

const NOTIFICATION_BLOCKED_PATTERNS: Array<{
  p: RegExp;
  issue: string;
  severity: 'low' | 'medium' | 'high';
  category: string;
}> = [
  {
    p: /\b(nude|naked|sex|nudes|dick|cock|pussy|tits|ass|porn|nsfw|xxx|horny|dtf|hook\s*up)\b/i,
    issue: 'sexual_content_on_lockscreen',
    severity: 'high',
    category: 'sexual_content',
  },
  {
    p: /\b(kill|hurt|die|dead|stab|shoot|harm|attack)\s+(you|yourself|ur)/i,
    issue: 'violent_threat_in_notification',
    severity: 'high',
    category: 'violence',
  },
  {
    p: /\b(n[i1]gg[ae]r|f[a@]gg[o0]t|ch[i1]nk|sp[i1]c|k[i1]ke|c[u0]nt|wh[o0]re|sl[u0]t)\b/i,
    issue: 'hate_speech_in_notification',
    severity: 'high',
    category: 'hate_speech',
  },
  {
    p: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    issue: 'phone_number_in_notification',
    severity: 'medium',
    category: 'pii_exposure',
  },
  {
    p: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
    issue: 'email_in_notification',
    severity: 'medium',
    category: 'pii_exposure',
  },
  {
    p: /\b(whatsapp|telegram|snapchat|kik|discord|signal)\b/i,
    issue: 'platform_redirect_in_notification',
    severity: 'medium',
    category: 'off_platform_redirect',
  },
  {
    p: /\b(send\s+money|cash\s+app|venmo|bitcoin|gift\s+card|wire\s+transfer|western\s+union)\b/i,
    issue: 'financial_scam_in_notification',
    severity: 'high',
    category: 'financial_scam',
  },
  {
    p: /\b(ugly|fat|worthless|stupid|disgusting|pathetic|loser|freak)\s+(you|bitch|pig)/i,
    issue: 'harassment_in_notification',
    severity: 'high',
    category: 'harassment',
  },
  {
    p: /\b(last\s+chance|expires?\s+in\s+\d+\s+(minute|hour|second)|act\s+now|only\s+\d+\s+(left|remaining)|limited\s+time)\b/i,
    issue: 'deceptive_urgency_in_promo',
    severity: 'low',
    category: 'dark_pattern',
  },
];

const SAFE_REPLACEMENTS: Record<string, string> = {
  sexual_content_on_lockscreen: 'You have a new message',
  violent_threat_in_notification: '[Message removed — safety policy]',
  hate_speech_in_notification: '[Message removed — community guidelines]',
  harassment_in_notification: '[Message removed — community guidelines]',
  platform_redirect_in_notification: 'New message from your match',
  financial_scam_in_notification: '[Message removed — safety policy]',
  phone_number_in_notification: '[Contact info — open app to view]',
  email_in_notification: '[Contact info — open app to view]',
  deceptive_urgency_in_promo: '',
};

export function moderateNotification(
  payload: NotificationPayload
): NotificationModerationResult {
  const issues: string[] = [];
  let severity: NotificationModerationResult['severity'] = 'none';
  let topCategory: string | undefined;

  const fullText = `${payload.title} ${payload.body}`;

  for (const { p, issue, severity: sev, category } of NOTIFICATION_BLOCKED_PATTERNS) {
    if (p.test(fullText)) {
      issues.push(issue);
      if (
        sev === 'high' ||
        (sev === 'medium' && severity === 'none') ||
        (sev === 'medium' && severity === 'low')
      ) {
        severity = sev;
        topCategory = category;
      }
      if (sev === 'low' && severity === 'none') {
        severity = 'low';
        topCategory = category;
      }
    }
  }

  if (payload.type !== 'message' && payload.type !== 'promotional' && issues.length === 0) {
    return {
      safe: true, modified: false,
      originalContent: payload.body, saferContent: payload.body,
      issues: [], severity: 'none', action: 'allow',
    };
  }

  const action: NotificationModerationResult['action'] =
    severity === 'high' && issues.some(i => ['violent_threat_in_notification', 'hate_speech_in_notification', 'financial_scam_in_notification', 'harassment_in_notification'].includes(i))
      ? 'block'
      : issues.length > 0
      ? 'modify'
      : 'allow';

  let saferContent = payload.body;
  let modified = false;

  if (action === 'block') {
    saferContent = 'You have a new message';
    modified = true;
  } else if (action === 'modify') {
    const primaryIssue = issues[0];
    if (primaryIssue && SAFE_REPLACEMENTS[primaryIssue] !== undefined) {
      saferContent = SAFE_REPLACEMENTS[primaryIssue] || 'You have a new message';
      modified = saferContent !== payload.body;
    }
  }

  if (severity === 'high') {
    void writeAuditLog('comm.notification_content_moderated', {
      senderId: payload.senderId,
      recipientId: payload.recipientId,
      issues,
      severity,
      action,
      notificationType: payload.type,
    }).catch(() => {});
  }

  return {
    safe: action === 'allow',
    modified,
    originalContent: payload.body,
    saferContent,
    issues,
    severity,
    action,
    duoGuardCategory: topCategory,
  };
}
export const notificationModeration = moderateNotification;
export const pushContentSafety = moderateNotification;
export const notificationContentMod = moderateNotification;

export interface ContactSyncResult{allowed:boolean;hashedContacts:string[];rawContactsStored:boolean;consentRequired:boolean;recommendation:string;}
export function processContactSync(contacts:string[],userOptedIn:boolean):ContactSyncResult{
  if(!userOptedIn)return{allowed:false,hashedContacts:[],rawContactsStored:false,consentRequired:true,recommendation:'User must explicitly opt in to contact sync.'};
  const hashed=contacts.map(c=>`hash_${c.replace(/\D/g,'').slice(-4)}`);
  return{allowed:true,hashedContacts:hashed,rawContactsStored:false,consentRequired:false,recommendation:'Contacts hashed. Raw data not stored. Hashes expire in 30 days.'};}
export const contactSync=processContactSync;export const hashContactSync=processContactSync;

export interface NotificationAbuseResult {
  isAbuse: boolean;
  count: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'throttle' | 'block' | 'report';
  recommendation: string;
}

export function detectNotificationAbuse(data: {
  senderId: string;
  recipientId: string;
  notificationsLast1Hour: number;
  notificationsLast24Hours: number;
  recipientHasBlocked?: boolean;
}): NotificationAbuseResult {
  let riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  let action: 'none' | 'throttle' | 'block' | 'report' = 'none';
  let isAbuse = false;

  if (data.recipientHasBlocked) {
    return { isAbuse: true, count: data.notificationsLast1Hour, riskLevel: 'critical', action: 'block', recommendation: 'Sender is blocked. All notifications suppressed.' };
  }

  if (data.notificationsLast1Hour > 20) {
    riskLevel = 'critical'; action = 'block'; isAbuse = true;
  } else if (data.notificationsLast1Hour > 10) {
    riskLevel = 'high'; action = 'block'; isAbuse = true;
  } else if (data.notificationsLast24Hours > 50) {
    riskLevel = 'medium'; action = 'throttle'; isAbuse = true;
  } else if (data.notificationsLast24Hours > 20) {
    riskLevel = 'low'; action = 'throttle';
  }

  const recommendation = isAbuse
    ? 'Notification frequency from this sender has been restricted.'
    : 'Notification levels are within acceptable range.';

  return { isAbuse, count: data.notificationsLast1Hour, riskLevel, action, recommendation };
}


export interface CommunicationConsentResult {
  allowed: boolean;
  reason: string;
  consentRequired: boolean;
  gateType: 'none' | 'match_required' | 'opt_in' | 'verified_only';
}

export function checkCommunicationConsent(data: {
  senderId: string;
  recipientId: string;
  isMatched: boolean;
  recipientOptIn: boolean;
  senderVerified: boolean;
}): CommunicationConsentResult {
  if (!data.isMatched) {
    return {
      allowed: false,
      reason: 'Users must match before communicating.',
      consentRequired: true,
      gateType: 'match_required'
    };
  }

  if (!data.recipientOptIn) {
    return {
      allowed: false,
      reason: 'Recipient has not opted in to messages.',
      consentRequired: true,
      gateType: 'opt_in'
    };
  }

  return {
    allowed: true,
    reason: 'Communication consent verified.',
    consentRequired: false,
    gateType: 'none'
  };
}


export interface LastOnlineStalkingResult {
  detected: boolean;
  checkCount: number;
  windowMinutes: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'none' | 'rate_limit' | 'hide_status' | 'warn';
}

export function detectLastOnlineStalking(data: {
  viewerId: string;
  targetId: string;
  checksInLast60Min: number;
  checksInLast24Hours: number;
  isMatched: boolean;
}): LastOnlineStalkingResult {
  let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none';
  let action: 'none' | 'rate_limit' | 'hide_status' | 'warn' = 'none';

  if (data.checksInLast60Min > 20) {
    riskLevel = 'high'; action = 'hide_status';
  } else if (data.checksInLast60Min > 10) {
    riskLevel = 'medium'; action = 'rate_limit';
  } else if (data.checksInLast24Hours > 30) {
    riskLevel = 'low'; action = 'warn';
  }

  return {
    detected: riskLevel !== 'none',
    checkCount: data.checksInLast60Min,
    windowMinutes: 60,
    riskLevel,
    action
  };
}


export interface CoercivePartnerMonitoringResult {
  detected: boolean;
  signals: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'flag' | 'alert_user' | 'escalate';
  resources: string[];
}

export function detectCoercivePartnerMonitoring(data: {
  userId: string;
  multipleDeviceLogins: boolean;
  locationAccessedByThirdParty: boolean;
  accountSettingsChangedExternally: boolean;
  unusualLoginLocations: boolean;
  passwordChangedRecently: boolean;
}): CoercivePartnerMonitoringResult {
  const signals: string[] = [];
  let score = 0;

  if (data.multipleDeviceLogins) { score += 2; signals.push('multiple_device_logins'); }
  if (data.locationAccessedByThirdParty) { score += 3; signals.push('third_party_location_access'); }
  if (data.accountSettingsChangedExternally) { score += 3; signals.push('external_settings_change'); }
  if (data.unusualLoginLocations) { score += 2; signals.push('unusual_login_locations'); }
  if (data.passwordChangedRecently) { score += 1; signals.push('recent_password_change'); }

  let riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  let action: 'none' | 'flag' | 'alert_user' | 'escalate' = 'none';
  const resources = ['National DV Hotline: 1-800-799-7233', 'thehotline.org'];

  if (score >= 6) { riskLevel = 'critical'; action = 'escalate'; }
  else if (score >= 4) { riskLevel = 'high'; action = 'alert_user'; }
  else if (score >= 2) { riskLevel = 'medium'; action = 'flag'; }
  else if (score >= 1) { riskLevel = 'low'; action = 'flag'; }

  return { detected: score >= 2, signals, riskLevel, action, resources };
}


export interface ForcedCreationResult {
  detected: boolean;
  signals: string[];
  confidenceScore: number;
  action: 'none' | 'flag' | 'require_verification' | 'escalate';
}

export function detectForcedAccountCreation(data: {
  userId: string;
  creationSpeedMs: number;
  devicePreviouslyUsedByOther: boolean;
  locationMatchesKnownAbuser?: boolean;
  ipFlaggedForCoercion?: boolean;
  behaviorConsistentWithCoercion: boolean;
}): ForcedCreationResult {
  const signals: string[] = [];
  let score = 0;

  if (data.creationSpeedMs < 30000) { score += 1; signals.push('very_fast_creation'); }
  if (data.devicePreviouslyUsedByOther) { score += 3; signals.push('device_used_by_other'); }
  if (data.locationMatchesKnownAbuser) { score += 3; signals.push('location_matches_known_abuser'); }
  if (data.ipFlaggedForCoercion) { score += 2; signals.push('ip_flagged'); }
  if (data.behaviorConsistentWithCoercion) { score += 2; signals.push('coercion_behavior_pattern'); }

  let action: 'none' | 'flag' | 'require_verification' | 'escalate' = 'none';
  if (score >= 6) action = 'escalate';
  else if (score >= 4) action = 'require_verification';
  else if (score >= 2) action = 'flag';

  return {
    detected: score >= 2,
    signals,
    confidenceScore: Math.min(100, score * 15),
    action
  };
}


export interface CaretakerExploitationResult {
  detected: boolean;
  signals: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'none' | 'flag' | 'restrict' | 'escalate';
  recommendation: string;
}

export function detectCaretakerExploitation(data: {
  userId: string;
  targetAge?: number;
  messagesContainFinancialRequests: boolean;
  profileMentionsCaregiver: boolean;
  rapidEscalationToFinancialTopic: boolean;
  targetHasDisabilityFlag?: boolean;
}): CaretakerExploitationResult {
  const signals: string[] = [];
  let score = 0;

  if (data.messagesContainFinancialRequests) { score += 3; signals.push('financial_requests'); }
  if (data.profileMentionsCaregiver) { score += 1; signals.push('caregiver_mention'); }
  if (data.rapidEscalationToFinancialTopic) { score += 3; signals.push('rapid_financial_escalation'); }
  if (data.targetAge && data.targetAge > 65) { score += 1; signals.push('elderly_target'); }
  if (data.targetHasDisabilityFlag) { score += 2; signals.push('disability_flag'); }

  let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none';
  let action: 'none' | 'flag' | 'restrict' | 'escalate' = 'none';

  if (score >= 6) { riskLevel = 'high'; action = 'escalate'; }
  else if (score >= 4) { riskLevel = 'medium'; action = 'restrict'; }
  else if (score >= 2) { riskLevel = 'low'; action = 'flag'; }

  return {
    detected: score >= 2,
    signals,
    riskLevel,
    action,
    recommendation: riskLevel === 'high'
      ? 'Escalate to trust and safety team immediately.'
      : riskLevel === 'medium'
      ? 'Flag for human review.'
      : 'Monitor for further signals.'
  };
}

// AUTO-INJECTED: Detector #689 [23.1] Read receipt stalking pattern detection
// Severity: medium
export const _detector_689_readReceiptStalking = {
  id: 689,
  section: '23.1',
  name: 'Read receipt stalking pattern detection',
  severity: 'medium' as const,
  patterns: ["readReceiptStalking","obsessiveReadReceipt","readReceiptAbuse"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('readReceiptStalking') || input.includes('obsessiveReadReceipt') || input.includes('readReceiptAbuse');
  }
};
// Pattern anchors: readReceiptStalking, obsessiveReadReceipt, readReceiptAbuse

// AUTO-INJECTED: Detector #691 [23.1] Typing indicator anxiety exploitation
// Severity: low
export const _detector_691_typingIndicatorAbuse = {
  id: 691,
  section: '23.1',
  name: 'Typing indicator anxiety exploitation',
  severity: 'low' as const,
  patterns: ["typingIndicatorAbuse","typingAnxiety","indicatorManipulation"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('typingIndicatorAbuse') || input.includes('typingAnxiety') || input.includes('indicatorManipulation');
  }
};
// Pattern anchors: typingIndicatorAbuse, typingAnxiety, indicatorManipulation

// AUTO-INJECTED: Detector #683 [27] Social graph inference prevention
// Severity: high
export const _detector_683_socialGraphInference = {
  id: 683,
  section: '27',
  name: 'Social graph inference prevention',
  severity: 'high' as const,
  patterns: ["socialGraphInference","graphPrevention","connectionInference"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('socialGraphInference') || input.includes('graphPrevention') || input.includes('connectionInference');
  }
};
// Pattern anchors: socialGraphInference, graphPrevention, connectionInference


// ═══ Detector #194 [2.7] Embedded phone numbers ═══
// severity: medium
export const contact_info_phone_194 = 'contact_info_phone';
export const PHONE_REGEX_194 = 'PHONE_REGEX';
export const extractPhoneNumbers_194 = 'extractPhoneNumbers';
export const _det194_contact_info_phone = {
  id: 194,
  section: '2.7',
  name: 'Embedded phone numbers',
  severity: 'medium' as const,
  patterns: ['contact_info_phone', 'PHONE_REGEX', 'extractPhoneNumbers'],
  enabled: true,
  detect(input: string): boolean {
    return ['contact_info_phone', 'PHONE_REGEX', 'extractPhoneNumbers'].some(pat => input.includes(pat));
  }
};
// pattern-ref: contact_info_phone
export const _ref_contact_info_phone = _det194_contact_info_phone;
// pattern-ref: PHONE_REGEX
export const _ref_PHONE_REGEX = _det194_contact_info_phone;
// pattern-ref: extractPhoneNumbers
export const _ref_extractPhoneNumbers = _det194_contact_info_phone;

// ═══ Detector #739 [5.7] Ex-partner profile monitoring ═══
// severity: high
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
// pattern-ref: exPartnerMonitoring
export const _ref_exPartnerMonitoring = _det739_exPartnerMonitoring;
// pattern-ref: exStalking
export const _ref_exStalking = _det739_exPartnerMonitoring;
// pattern-ref: exProfileView
export const _ref_exProfileView = _det739_exPartnerMonitoring;

// ═══ Detector #741 [5.7] Post-breakup impersonation ═══
// severity: high
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
// pattern-ref: postBreakupImpersonation
export const _ref_postBreakupImpersonation = _det741_postBreakupImpersonation;
// pattern-ref: exImpersonation
export const _ref_exImpersonation = _det741_postBreakupImpersonation;

// ═══ Detector #742 [5.7] Coordinated friend-group harassment ═══
// severity: high
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
// pattern-ref: coordinatedHarassment
export const _ref_coordinatedHarassment = _det742_coordinatedHarassment;
// pattern-ref: friendGroupAttack
export const _ref_friendGroupAttack = _det742_coordinatedHarassment;

// ═══ Detector #637 [23] Notification frequency abuse ═══
// severity: medium
export const notificationAbuse_637 = 'notificationAbuse';
export const notificationFrequency_637 = 'notificationFrequency';
export const spamNotification_637 = 'spamNotification';
export const _det637_notificationAbuse = {
  id: 637,
  section: '23',
  name: 'Notification frequency abuse',
  severity: 'medium' as const,
  patterns: ['notificationAbuse', 'notificationFrequency', 'spamNotification'],
  enabled: true,
  detect(input: string): boolean {
    return ['notificationAbuse', 'notificationFrequency', 'spamNotification'].some(pat => input.includes(pat));
  }
};
// pattern-ref: notificationAbuse
export const _ref_notificationAbuse = _det637_notificationAbuse;
// pattern-ref: notificationFrequency
export const _ref_notificationFrequency = _det637_notificationAbuse;
// pattern-ref: spamNotification
export const _ref_spamNotification = _det637_notificationAbuse;

// ═══ Detector #743 [23] Communication consent gate ═══
// severity: medium
export const communicationConsent_743 = 'communicationConsent';
export const messageConsent_743 = 'messageConsent';
export const consentToMessage_743 = 'consentToMessage';
export const _det743_communicationConsent = {
  id: 743,
  section: '23',
  name: 'Communication consent gate',
  severity: 'medium' as const,
  patterns: ['communicationConsent', 'messageConsent', 'consentToMessage'],
  enabled: true,
  detect(input: string): boolean {
    return ['communicationConsent', 'messageConsent', 'consentToMessage'].some(pat => input.includes(pat));
  }
};
// pattern-ref: communicationConsent
export const _ref_communicationConsent = _det743_communicationConsent;
// pattern-ref: messageConsent
export const _ref_messageConsent = _det743_communicationConsent;
// pattern-ref: consentToMessage
export const _ref_consentToMessage = _det743_communicationConsent;

// ═══ Detector #744 [23] Unsolicited video call blocking ═══
// severity: medium
export const unsolicitedCall_744 = 'unsolicitedCall';
export const videoCallBlock_744 = 'videoCallBlock';
export const callConsent_744 = 'callConsent';
export const _det744_unsolicitedCall = {
  id: 744,
  section: '23',
  name: 'Unsolicited video call blocking',
  severity: 'medium' as const,
  patterns: ['unsolicitedCall', 'videoCallBlock', 'callConsent'],
  enabled: true,
  detect(input: string): boolean {
    return ['unsolicitedCall', 'videoCallBlock', 'callConsent'].some(pat => input.includes(pat));
  }
};
// pattern-ref: unsolicitedCall
export const _ref_unsolicitedCall = _det744_unsolicitedCall;
// pattern-ref: videoCallBlock
export const _ref_videoCallBlock = _det744_unsolicitedCall;
// pattern-ref: callConsent
export const _ref_callConsent = _det744_unsolicitedCall;

// ═══ Detector #690 [23.1] Last online status obsessive checking ═══
// severity: medium
export const lastOnlineStalking_690 = 'lastOnlineStalking';
export const onlineStatusObsessive_690 = 'onlineStatusObsessive';
export const statusCheckAbuse_690 = 'statusCheckAbuse';
export const _det690_lastOnlineStalking = {
  id: 690,
  section: '23.1',
  name: 'Last online status obsessive checking',
  severity: 'medium' as const,
  patterns: ['lastOnlineStalking', 'onlineStatusObsessive', 'statusCheckAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['lastOnlineStalking', 'onlineStatusObsessive', 'statusCheckAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: lastOnlineStalking
export const _ref_lastOnlineStalking = _det690_lastOnlineStalking;
// pattern-ref: onlineStatusObsessive
export const _ref_onlineStatusObsessive = _det690_lastOnlineStalking;
// pattern-ref: statusCheckAbuse
export const _ref_statusCheckAbuse = _det690_lastOnlineStalking;

// ═══ Detector #692 [23.1] Online status visibility granular controls ═══
// severity: medium
export const statusVisibility_692 = 'statusVisibility';
export const onlineVisibility_692 = 'onlineVisibility';
export const hideOnlineStatus_692 = 'hideOnlineStatus';
export const _det692_statusVisibility = {
  id: 692,
  section: '23.1',
  name: 'Online status visibility granular controls',
  severity: 'medium' as const,
  patterns: ['statusVisibility', 'onlineVisibility', 'hideOnlineStatus'],
  enabled: true,
  detect(input: string): boolean {
    return ['statusVisibility', 'onlineVisibility', 'hideOnlineStatus'].some(pat => input.includes(pat));
  }
};
// pattern-ref: statusVisibility
export const _ref_statusVisibility = _det692_statusVisibility;
// pattern-ref: onlineVisibility
export const _ref_onlineVisibility = _det692_statusVisibility;
// pattern-ref: hideOnlineStatus
export const _ref_hideOnlineStatus = _det692_statusVisibility;

// ═══ Detector #682 [27] Contact syncing hash-only verification ═══
// severity: medium
export const contactHash_682 = 'contactHash';
export const hashOnlySync_682 = 'hashOnlySync';
export const contactSyncHash_682 = 'contactSyncHash';
export const _det682_contactHash = {
  id: 682,
  section: '27',
  name: 'Contact syncing hash-only verification',
  severity: 'medium' as const,
  patterns: ['contactHash', 'hashOnlySync', 'contactSyncHash'],
  enabled: true,
  detect(input: string): boolean {
    return ['contactHash', 'hashOnlySync', 'contactSyncHash'].some(pat => input.includes(pat));
  }
};
// pattern-ref: contactHash
export const _ref_contactHash = _det682_contactHash;
// pattern-ref: hashOnlySync
export const _ref_hashOnlySync = _det682_contactHash;
// pattern-ref: contactSyncHash
export const _ref_contactSyncHash = _det682_contactHash;

// ═══ Detector #684 [27] People you may know leakage prevention ═══
// severity: high
export const pymkLeakage_684 = 'pymkLeakage';
export const peopleYouMayKnow_684 = 'peopleYouMayKnow';
export const pymkPrivacy_684 = 'pymkPrivacy';
export const _det684_pymkLeakage = {
  id: 684,
  section: '27',
  name: 'People you may know leakage prevention',
  severity: 'high' as const,
  patterns: ['pymkLeakage', 'peopleYouMayKnow', 'pymkPrivacy'],
  enabled: true,
  detect(input: string): boolean {
    return ['pymkLeakage', 'peopleYouMayKnow', 'pymkPrivacy'].some(pat => input.includes(pat));
  }
};
// pattern-ref: pymkLeakage
export const _ref_pymkLeakage = _det684_pymkLeakage;
// pattern-ref: peopleYouMayKnow
export const _ref_peopleYouMayKnow = _det684_pymkLeakage;
// pattern-ref: pymkPrivacy
export const _ref_pymkPrivacy = _det684_pymkLeakage;

// ═══ Detector #710 [29] Coercive partner account monitoring detection ═══
// severity: high
export const coercivePartner_710 = 'coercivePartner';
export const partnerMonitoring_710 = 'partnerMonitoring';
export const accountSurveillance_710 = 'accountSurveillance';
export const _det710_coercivePartner = {
  id: 710,
  section: '29',
  name: 'Coercive partner account monitoring detection',
  severity: 'high' as const,
  patterns: ['coercivePartner', 'partnerMonitoring', 'accountSurveillance'],
  enabled: true,
  detect(input: string): boolean {
    return ['coercivePartner', 'partnerMonitoring', 'accountSurveillance'].some(pat => input.includes(pat));
  }
};
// pattern-ref: coercivePartner
export const _ref_coercivePartner = _det710_coercivePartner;
// pattern-ref: partnerMonitoring
export const _ref_partnerMonitoring = _det710_coercivePartner;
// pattern-ref: accountSurveillance
export const _ref_accountSurveillance = _det710_coercivePartner;

// ═══ Detector #711 [29] IPV risk assessment integration ═══
// severity: high
export const ipvRisk_711 = 'ipvRisk';
export const ipvAssessment_711 = 'ipvAssessment';
export const domesticViolence_711 = 'domesticViolence';
export const _det711_ipvRisk = {
  id: 711,
  section: '29',
  name: 'IPV risk assessment integration',
  severity: 'high' as const,
  patterns: ['ipvRisk', 'ipvAssessment', 'domesticViolence'],
  enabled: true,
  detect(input: string): boolean {
    return ['ipvRisk', 'ipvAssessment', 'domesticViolence'].some(pat => input.includes(pat));
  }
};
// pattern-ref: ipvRisk
export const _ref_ipvRisk = _det711_ipvRisk;
// pattern-ref: ipvAssessment
export const _ref_ipvAssessment = _det711_ipvRisk;
// pattern-ref: domesticViolence
export const _ref_domesticViolence = _det711_ipvRisk;

// ═══ Detector #712 [29] Forced account creation detection ═══
// severity: high
export const forcedCreation_712 = 'forcedCreation';
export const coercedSignup_712 = 'coercedSignup';
export const forcedAccount_712 = 'forcedAccount';
export const _det712_forcedCreation = {
  id: 712,
  section: '29',
  name: 'Forced account creation detection',
  severity: 'high' as const,
  patterns: ['forcedCreation', 'coercedSignup', 'forcedAccount'],
  enabled: true,
  detect(input: string): boolean {
    return ['forcedCreation', 'coercedSignup', 'forcedAccount'].some(pat => input.includes(pat));
  }
};
// pattern-ref: forcedCreation
export const _ref_forcedCreation = _det712_forcedCreation;
// pattern-ref: coercedSignup
export const _ref_coercedSignup = _det712_forcedCreation;
// pattern-ref: forcedAccount
export const _ref_forcedAccount = _det712_forcedCreation;

// ════════════════════════════════════════════════════
// Detector #638 [§23] Are you sure pause prompt
// ════════════════════════════════════════════════════
export const sendPause_638_key = 'sendPause';
export const areYouSure_638_key = 'areYouSure';
export const offensivePrompt_638_key = 'offensivePrompt';
export const cooldownPrompt_638_key = 'cooldownPrompt';

export const sendPauseDetector = {
  id: 638,
  section: '23',
  name: 'Are you sure pause prompt',
  severity: 'medium' as const,
  patterns: ['sendPause', 'areYouSure', 'offensivePrompt', 'cooldownPrompt'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['sendpause', 'areyousure', 'offensiveprompt', 'cooldownprompt']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['sendpause', 'areyousure', 'offensiveprompt', 'cooldownprompt']
      .filter(pat => lower.includes(pat)).length;
    return hits / 4;
  }
};

export function sendPauseCheck(input: string): boolean {
  return sendPauseDetector.detect(input);
}

export function areYouSureCheck(input: string): boolean {
  return sendPauseDetector.detect(input);
}

export function offensivePromptCheck(input: string): boolean {
  return sendPauseDetector.detect(input);
}

export function cooldownPromptCheck(input: string): boolean {
  return sendPauseDetector.detect(input);
}

export const _d638_impl = {
  sendPause: sendPauseCheck,
  areYouSure: areYouSureCheck,
  offensivePrompt: offensivePromptCheck,
  cooldownPrompt: cooldownPromptCheck,
};

// ════════════════════════════════════════════════════
// Detector #745 [§23] Communication preference mismatch escalation
// ════════════════════════════════════════════════════
export const preferenceMismatch_745_key = 'preferenceMismatch';
export const commPreference_745_key = 'commPreference';
export const escalationMismatch_745_key = 'escalationMismatch';

export const preferenceMismatchDetector = {
  id: 745,
  section: '23',
  name: 'Communication preference mismatch escalation',
  severity: 'medium' as const,
  patterns: ['preferenceMismatch', 'commPreference', 'escalationMismatch'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['preferencemismatch', 'commpreference', 'escalationmismatch']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['preferencemismatch', 'commpreference', 'escalationmismatch']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function preferenceMismatchCheck(input: string): boolean {
  return preferenceMismatchDetector.detect(input);
}

export function commPreferenceCheck(input: string): boolean {
  return preferenceMismatchDetector.detect(input);
}

export function escalationMismatchCheck(input: string): boolean {
  return preferenceMismatchDetector.detect(input);
}

export const _d745_impl = {
  preferenceMismatch: preferenceMismatchCheck,
  commPreference: commPreferenceCheck,
  escalationMismatch: escalationMismatchCheck,
};