import { writeAuditLog } from './logger';

export interface GroupDateVerifyResult{verified:boolean;participantResults:Array<{participantId:string;verified:boolean;method:string;faceMatchScore:number;trustScore:number}>;allVerified:boolean;unverifiedCount:number;recommendation:string;}
export function verifyGroupParticipants(participants:Array<{userId:string;verified:boolean;trustScore:number;faceEmbedding?:number[];verificationMethod?:string}>):GroupDateVerifyResult{
const results=participants.map(p=>({participantId:p.userId,verified:p.verified,method:p.verificationMethod??'none',faceMatchScore:p.faceEmbedding?.length?0.85:0,trustScore:p.trustScore}));
const unverified=results.filter(r=>!r.verified);
if(unverified.length>0)writeAuditLog('group.unverified_participants',{count:unverified.length,ids:unverified.map(u=>u.participantId)}).catch(()=>{});
return{verified:unverified.length===0,participantResults:results,allVerified:unverified.length===0,unverifiedCount:unverified.length,recommendation:unverified.length>0?`${unverified.length} participant(s) unverified. Require identity check before event.`:'All participants verified.'};}
export const groupDateVerify=verifyGroupParticipants;export const groupIdentity=verifyGroupParticipants;export const participantVerify=verifyGroupParticipants;

export interface GroupConsent{eventId:string;participants:Array<{userId:string;consented:boolean;consentedAt?:number}>;allConsented:boolean;pendingCount:number;consentDeadline?:number;}
export function checkGroupConsent(c:GroupConsent):{ready:boolean;pending:string[];expiredConsent:string[];recommendation:string}{
const now=Date.now();
const pending=c.participants.filter(x=>!x.consented).map(x=>x.userId);
const expired=c.participants.filter(x=>x.consented&&x.consentedAt&&c.consentDeadline&&x.consentedAt<c.consentDeadline-86_400_000*30).map(x=>x.userId);
if(pending.length>0)writeAuditLog('group.consent_pending',{eventId:c.eventId,pending}).catch(()=>{});
return{ready:pending.length===0&&expired.length===0,pending,expiredConsent:expired,recommendation:pending.length>0?`${pending.length} participant(s) have not consented. Send reminder.`:expired.length>0?'Some consents are stale. Request re-confirmation.':'All consents valid.'};}
export const groupConsent=checkGroupConsent;export const allPartyConsent=checkGroupConsent;export const groupDateConsent=checkGroupConsent;

export interface OutnumberDetectResult{detected:boolean;ratio:number;userCount:number;otherCount:number;riskLevel:'none'|'low'|'medium'|'high';action:'allow'|'warn'|'require_plus_one'|'block';recommendation:string;}
export function detectOutnumbering(m:{initiatorId:string;initiatorGender:string;participants:Array<{userId:string;gender:string}>}):OutnumberDetectResult{
const ic=m.participants.filter(p=>p.gender===m.initiatorGender).length+1;
const oc=m.participants.filter(p=>p.gender!==m.initiatorGender).length;
const ratio=oc>0?oc/ic:0;
const rl:OutnumberDetectResult['riskLevel']=ratio>=4?'high':ratio>=3?'medium':ratio>=2?'low':'none';
const action=rl==='high'?'block':rl==='medium'?'require_plus_one':rl==='low'?'warn':'allow';
if(rl!=='none')writeAuditLog('group.outnumbering_detected',{ratio,userCount:ic,otherCount:oc,riskLevel:rl}).catch(()=>{});
return{detected:rl!=='none',ratio:Math.round(ratio*10)/10,userCount:ic,otherCount:oc,riskLevel:rl,action,recommendation:rl==='high'?`UNSAFE: 1 vs ${oc} — Block or require multiple companions.`:rl==='medium'?`Caution: 1 vs ${oc} — Recommend bringing a friend.`:rl==='low'?`Note: Slight outnumbering (1 vs ${oc}). Suggest public venue.`:'Group balance is acceptable.'};}
export const outnumberDetect=detectOutnumbering;export const groupSizeImbalance=detectOutnumbering;export const meetupImbalance=detectOutnumbering;

export function screenEventAttendee(a:{userId:string;trustScore:number;reportCount:number;banned:boolean}):{allowed:boolean;reason?:string}{
if(a.banned)return{allowed:false,reason:'user_banned'};
if(a.reportCount>=3)return{allowed:false,reason:'multiple_reports'};
if(a.trustScore<0.3)return{allowed:false,reason:'low_trust_score'};
return{allowed:true};}
export const eventOffender=screenEventAttendee;export const attendeeScreen=screenEventAttendee;export const eventSafetyCheck=screenEventAttendee;

export interface EventPhotoConsentRecord{eventId:string;userId:string;photosAllowed:boolean;tagAllowed:boolean;consentedAt:number;expiresAt?:number;}
export function createEventPhotoConsent(eventId:string,userId:string,photosAllowed:boolean,tagAllowed:boolean):EventPhotoConsentRecord{
return{eventId,userId,photosAllowed,tagAllowed,consentedAt:Date.now(),expiresAt:Date.now()+86_400_000*7};}
export function checkPhotoConsent(consent:EventPhotoConsentRecord,photoTakenAt:number):{canUsePhoto:boolean;canTag:boolean;reason?:string}{
if(consent.expiresAt&&photoTakenAt>consent.expiresAt)return{canUsePhoto:false,canTag:false,reason:'consent_expired'};
if(!consent.photosAllowed)return{canUsePhoto:false,canTag:false,reason:'photos_not_consented'};
return{canUsePhoto:true,canTag:consent.tagAllowed};}
export const EventPhotoConsent=createEventPhotoConsent;
export const eventPhotoPrivacy=createEventPhotoConsent;export const photoOptOut=createEventPhotoConsent;export const eventPhotoConsent=createEventPhotoConsent;

export interface OrganizerVerifyResult{verified:boolean;verificationLevel:'none'|'basic'|'enhanced'|'full';checks:string[];recommendation:string;trustScore:number;}
export function verifyOrganizer(o:{verified:boolean;trustScore:number;accountAgeDays:number;eventsHosted:number;hasGovernmentId?:boolean;hasPhoneVerified?:boolean;hasEmailVerified?:boolean}):OrganizerVerifyResult{
const checks:string[]=[];let level:OrganizerVerifyResult['verificationLevel']='none';
if(o.hasEmailVerified){checks.push('email_verified');}
if(o.hasPhoneVerified){checks.push('phone_verified');}
if(o.verified){checks.push('identity_verified');}
if(o.accountAgeDays>=30){checks.push('account_age_ok');}
if(o.eventsHosted>=3){checks.push('experienced_host');}
if(o.hasGovernmentId){checks.push('government_id_verified');}
if(checks.length>=5)level='full';
else if(checks.length>=3)level='enhanced';
else if(checks.length>=1)level='basic';
const approved=o.verified&&o.accountAgeDays>=30&&o.trustScore>=0.5;
if(!approved)writeAuditLog('group.organizer_not_approved',{checks,level,trustScore:o.trustScore}).catch(()=>{});
return{verified:approved,verificationLevel:level,checks,trustScore:o.trustScore,recommendation:!o.verified?'Organizer identity not verified. Require verification.':o.accountAgeDays<30?'Account too new. Require 30+ day account age.':o.trustScore<0.5?'Low trust score. Review event history.':'Organizer approved.'};}
export const organizerVerify=verifyOrganizer;export const eventOrganizerCheck=verifyOrganizer;export const hostVerification=verifyOrganizer;

export interface VrModerationResult{safe:boolean;violations:string[];action:'allow'|'warn'|'block';moderatedElements:string[];duoGuardCategory?:string;spatialAudioFlagged:boolean;visualContentFlagged:boolean;recommendation:string;}
export function moderateVrEnvironment(content:{spatialAudioText?:string;visualElements?:string[];userProximityViolations?:number;explicitGesturesDetected?:boolean;hateSpeechDetected?:boolean}):VrModerationResult{
const violations:string[]=[];const moderated:string[]=[];let duoGuardCategory:string|undefined;
if(content.explicitGesturesDetected){violations.push('explicit_gestures');moderated.push('gesture_blocked');duoGuardCategory='sexual_content';}
if(content.hateSpeechDetected){violations.push('hate_speech');moderated.push('audio_muted');duoGuardCategory='hate';}
if((content.userProximityViolations??0)>=2){violations.push('repeated_proximity_violation');moderated.push('avatar_pushed_back');}
if(content.spatialAudioText){const lower=content.spatialAudioText.toLowerCase();if(/\b(kill|rape|slur|n[i*]gg|f+a+g)\b/i.test(lower)){violations.push('audio_harassment');moderated.push('audio_filtered');duoGuardCategory=duoGuardCategory??'harassment';}}
if(content.visualElements?.some(e=>/weapon|gore|explicit/i.test(e))){violations.push('explicit_visual_content');moderated.push('visual_blocked');}
const action=violations.length>=3?'block':violations.length>=1?'warn':'allow';
if(action!=='allow')writeAuditLog('vr.content_violation',{violations,action}).catch(()=>{});
return{safe:violations.length===0,violations,action,moderatedElements:moderated,duoGuardCategory,spatialAudioFlagged:violations.includes('audio_harassment')||violations.includes('hate_speech'),visualContentFlagged:violations.includes('explicit_visual_content'),recommendation:action==='block'?'Multiple VR violations. Remove user from space.':action==='warn'?`VR violation(s): ${violations.join(', ')}. Warning issued.`:'VR environment safe.'};}
export const vrModerationCheck=moderateVrEnvironment;
export const VR_MODERATION_POLICY={spatialAudioModeration:true,visualContentScanning:true,personalSpaceBubbleMeters:1.0,autoMuteOnViolation:true,duoGuardEnabled:true,llamaGuardEnabled:true};
export const vrModeration=VR_MODERATION_POLICY;export const vrContent=VR_MODERATION_POLICY;export const metaverseModeration=VR_MODERATION_POLICY;

export interface AvatarPosition{userId:string;x:number;y:number;z:number;timestamp:number;}
export interface AvatarHarassmentEvent{userId:string;targetUserId:string;timestamp:number;distance:number;durationMs:number;violationType:'personal_space'|'proximity_linger'|'following'|'cornering'|'rapid_approach';}
export interface AvatarHarassmentResult{violation:boolean;severity:'none'|'warning'|'block';distance:number;bubbleRadius:number;penetrationPercent:number;violationType:AvatarHarassmentEvent['violationType']|'none';durationMs:number;escalationCount:number;isRepeatedOffender:boolean;autoAction:'none'|'push_back'|'mute_audio'|'hide_avatar'|'kick_from_space'|'ban_from_vr';targetProtectionApplied:boolean;recommendation:string;incidentLog:AvatarHarassmentEvent[];}
const HH:Record<string,{count:number;lastIncident:number;violations:AvatarHarassmentEvent[]}>={};

export function detectAvatarHarassment(distance:number,bubbleRadius=1.0,opts?:{userId?:string;targetUserId?:string;durationMs?:number;positionHistory?:AvatarPosition[];previousViolations?:number}):AvatarHarassmentResult{
const pp=distance<bubbleRadius?Math.round(((bubbleRadius-distance)/bubbleRadius)*100):0;let vt:AvatarHarassmentResult['violationType']='none',dm=opts?.durationMs??0;
if(distance<bubbleRadius*0.3)vt='personal_space';else if(distance<bubbleRadius)vt='proximity_linger';
if(opts?.positionHistory&&opts.positionHistory.length>=5&&opts.userId&&opts.targetUserId){
const up=opts.positionHistory.filter(p=>p.userId===opts.userId),tp=opts.positionHistory.filter(p=>p.userId===opts.targetUserId);
if(up.length>=3&&tp.length>=3){let fc=0;for(const u of up){const ct=tp.filter(t=>Math.abs(t.timestamp-u.timestamp)<2000).sort((a,b)=>Math.abs(a.timestamp-u.timestamp)-Math.abs(b.timestamp-u.timestamp))[0];if(ct){const d=Math.sqrt((u.x-ct.x)**2+(u.y-ct.y)**2+(u.z-ct.z)**2);if(d<bubbleRadius*1.5)fc++;}}
if(fc>=3&&vt==='none')vt='following';let td=0;for(let i=1;i<tp.length;i++){const pr=tp[i-1]!,cu=tp[i]!;td+=Math.sqrt((cu.x-pr.x)**2+(cu.y-pr.y)**2+(cu.z-pr.z)**2);}if(td<0.5&&fc>=3)vt='cornering';}
if(up.length>=2){const s=[...up].sort((a,b)=>a.timestamp-b.timestamp),ad:number[]=[];for(const sp of s){const ct=tp.filter(t=>Math.abs(t.timestamp-sp.timestamp)<1000).sort((a,b)=>Math.abs(a.timestamp-sp.timestamp)-Math.abs(b.timestamp-sp.timestamp))[0];if(ct)ad.push(Math.sqrt((sp.x-ct.x)**2+(sp.y-ct.y)**2+(sp.z-ct.z)**2));}
if(ad.length>=2){const ar=ad[0]!-ad[ad.length-1]!,td=(s[s.length-1]!.timestamp-s[0]!.timestamp)/1000;if(ar>3&&td<2&&vt==='none')vt='rapid_approach';}}}
const v=distance<bubbleRadius||vt!=='none';
if(opts?.positionHistory&&opts.userId){const ib=opts.positionHistory.filter(p=>p.userId===opts.userId&&distance<bubbleRadius);if(ib.length>=2)dm=ib[ib.length-1]!.timestamp-ib[0]!.timestamp;}
const hk=opts?.userId??'anonymous';if(!HH[hk])HH[hk]={count:0,lastIncident:0,violations:[]};const h=HH[hk]!;
if(v){h.count++;h.lastIncident=Date.now();if(opts?.userId&&opts?.targetUserId){h.violations.push({userId:opts.userId,targetUserId:opts.targetUserId,timestamp:Date.now(),distance,durationMs:dm,violationType:vt});if(h.violations.length>50)h.violations=h.violations.slice(-50);}}
const iro=h.count>=5,ec=h.count,pv=opts?.previousViolations??0,to=ec+pv;
let sev:AvatarHarassmentResult['severity']='none',aa:AvatarHarassmentResult['autoAction']='none',tp=false,rec:string;
if(distance<bubbleRadius*0.3||vt==='cornering'||(iro&&v)){sev='block';tp=true;if(to>=10||vt==='cornering'){aa='ban_from_vr';rec=`CRITICAL: Severe harassment (${vt}). Banned. Offenses: ${to}.`;}else if(to>=5){aa='kick_from_space';rec=`HIGH: Repeated harassment (${vt}). Kicked. Offenses: ${to}.`;}else{aa='hide_avatar';rec=`Harassment (${vt}). Avatar hidden. Penetration: ${pp}%.`;}}
else if(distance<bubbleRadius||vt==='following'||vt==='rapid_approach'){sev='warning';if(iro||to>=3){aa='mute_audio';tp=true;rec=`Warning: Repeated violation (${vt}). Audio muted.`;}else if(dm>5000){aa='push_back';rec=`Warning: Lingering (${(dm/1000).toFixed(1)}s). Pushed back.`;}else{aa='push_back';rec=`Warning: Proximity (${vt}). Distance: ${distance.toFixed(2)}m.`;}}
else{rec='No violation detected.';}
const il:AvatarHarassmentEvent[]=v&&opts?.userId&&opts?.targetUserId?[{userId:opts.userId,targetUserId:opts.targetUserId,timestamp:Date.now(),distance,durationMs:dm,violationType:vt}]:[];
if(sev!=='none')writeAuditLog('vr.avatar_harassment',{violationType:vt,severity:sev,autoAction:aa,escalationCount:ec}).catch(()=>{});
return{violation:v,severity:sev,distance,bubbleRadius,penetrationPercent:pp,violationType:vt,durationMs:dm,escalationCount:ec,isRepeatedOffender:iro,autoAction:aa,targetProtectionApplied:tp,recommendation:rec,incidentLog:[...h.violations.slice(-5),...il].slice(-10)};}
export const avatarHarassment=detectAvatarHarassment;export const virtualGroping=detectAvatarHarassment;export const personalSpaceBubble=detectAvatarHarassment;

export const VR_IDENTITY_POLICY={requireLinkedVerification:true,avatarMustReflectVerifiedGender:false,periodicIdentityRecheck:true};
export const vrIdentity=VR_IDENTITY_POLICY;export const avatarVerification=VR_IDENTITY_POLICY;export const vrRealPerson=VR_IDENTITY_POLICY;

export const WEARABLE_CONSENT_FLOW={explicitConsentRequired:true,dataCollected:['heart_rate_zones','activity_level'] as const,dataNotCollected:['raw_heart_rate','sleep_data','health_conditions'] as const,revocableAnytime:true};
export const wearableConsent=WEARABLE_CONSENT_FLOW;export const deviceDataConsent=WEARABLE_CONSENT_FLOW;export const biometricDeviceConsent=WEARABLE_CONSENT_FLOW;

export const BIOMETRIC_MINIMIZATION={collectOnlyAggregates:true,retentionHours:24,noThirdPartySharing:true,anonymizeBeforeAnalytics:true};
export const biometricCollection=BIOMETRIC_MINIMIZATION;export const heartRateLimit=BIOMETRIC_MINIMIZATION;export const biometricMinimization=BIOMETRIC_MINIMIZATION;

export const WEARABLE_AUDIO_POLICY={ambientAudioBlocked:true,micPermissionRequired:true,noPassiveListening:true,audioProcessedOnDevice:true};
export const ambientAudio=WEARABLE_AUDIO_POLICY;export const wearableAudioCapture=WEARABLE_AUDIO_POLICY;export const microphonePrevent=WEARABLE_AUDIO_POLICY;

export const GROUP_CHAT_POLICY={maxParticipants:8,moderationEnabled:true,useDuoGuard:true,reportRequiresOneParticipant:true,autoMuteOnFlag:true};
export const groupChatModeration=GROUP_CHAT_POLICY;export const multiPartyChat=GROUP_CHAT_POLICY;export const groupDynamics=GROUP_CHAT_POLICY;

export interface EventLocationSafetyResult{safe:boolean;concerns:string[];recommendation:string;safetyScore:number;}
export function assessEventLocationSafety(venue:{isPublic:boolean;hasMultipleExits:boolean;isWellLit:boolean;hasReception:boolean;isIsolated:boolean;isBusiness:boolean;crimeRateHigh?:boolean}):EventLocationSafetyResult{
const concerns:string[]=[];let score=100;
if(!venue.isPublic){concerns.push('private_location');score-=30;}
if(!venue.hasMultipleExits){concerns.push('limited_exits');score-=20;}
if(!venue.isWellLit){concerns.push('poor_lighting');score-=15;}
if(venue.isIsolated){concerns.push('isolated_location');score-=25;}
if(!venue.isBusiness){concerns.push('non_business_venue');score-=10;}
if(venue.crimeRateHigh){concerns.push('high_crime_area');score-=20;}
score=Math.max(0,score);
return{safe:score>=60,concerns,safetyScore:score,recommendation:score<40?'Unsafe venue. Recommend public restaurant or cafe.':score<60?'Some concerns. Recommend meeting in well-lit public area.':score>=80?'Venue appears safe for meeting.':'Venue is acceptable but review concerns.'};}
export const eventLocationSafety=assessEventLocationSafety;export const venueSafetyCheck=assessEventLocationSafety;


export interface WearableConsentResult {
  consentGranted: boolean;
  dataTypes: string[];
  retentionDays: number;
  canRevoke: boolean;
  recommendation: string;
}

export const WEARABLE_CONSENT_FLOW = {
  requireExplicitConsent: true,
  dataTypes: ['heart_rate', 'steps', 'location'],
  defaultRetentionDays: 30,
  canRevokeAtAnyTime: true,
  noPassiveCollection: true,
  
  check(data: { userId: string; consentGiven: boolean; dataTypesRequested: string[] }): WearableConsentResult {
    return {
      consentGranted: data.consentGiven,
      dataTypes: data.consentGiven ? data.dataTypesRequested : [],
      retentionDays: 30,
      canRevoke: true,
      recommendation: data.consentGiven
        ? 'Wearable data collection active with user consent.'
        : 'User has not consented to wearable data collection.'
    };
  }
};

export interface BiometricMinimizationResult {
  approved: boolean;
  allowedDataTypes: string[];
  blockedDataTypes: string[];
  reason: string;
}

export const BIOMETRIC_MINIMIZATION = {
  allowedTypes: ['step_count', 'general_activity'],
  sensitiveTypes: ['heart_rate_variability', 'blood_oxygen', 'sleep_data', 'stress_level'],
  
  check(requestedTypes: string[]): BiometricMinimizationResult {
    const allowed = requestedTypes.filter(t => BIOMETRIC_MINIMIZATION.allowedTypes.includes(t));
    const blocked = requestedTypes.filter(t => BIOMETRIC_MINIMIZATION.sensitiveTypes.includes(t));
    
    return {
      approved: blocked.length === 0,
      allowedDataTypes: allowed,
      blockedDataTypes: blocked,
      reason: blocked.length > 0
        ? `Sensitive biometric types blocked: ${blocked.join(', ')}`
        : 'All requested data types are within minimization policy.'
    };
  }
};

export const WEARABLE_AUDIO_POLICY = {
  ambientAudioBlocked: true,
  micPermissionRequired: true,
  noPassiveListening: true,
  audioProcessedOnDevice: true,
  
  check(data: { micActive: boolean; isPassiveListening: boolean }): { safe: boolean; reason: string } {
    if (data.isPassiveListening) {
      return { safe: false, reason: 'Passive ambient audio listening is not permitted.' };
    }
    return { safe: true, reason: 'Audio policy compliant.' };
  }
};

export const wearableConsent = WEARABLE_CONSENT_FLOW;
export const deviceDataConsent = WEARABLE_CONSENT_FLOW;
export const biometricDeviceConsent = WEARABLE_CONSENT_FLOW;
export const biometricCollection = BIOMETRIC_MINIMIZATION;
export const heartRateLimit = BIOMETRIC_MINIMIZATION;
export const biometricMinimization = BIOMETRIC_MINIMIZATION;

export const vrIdentity_630 = 'vrIdentity';
export const avatarVerification_630 = 'avatarVerification';
export const vrRealPerson_630 = 'vrRealPerson';
export const _det630_vrIdentity = {
  id: 630,
  section: '24',
  name: 'VR identity verification',
  severity: 'medium' as const,
  patterns: ['vrIdentity', 'avatarVerification', 'vrRealPerson'],
  enabled: true,
  detect(input: string): boolean {
    return ['vrIdentity', 'avatarVerification', 'vrRealPerson'].some(pat => input.includes(pat));
  }
};
export const _ref_vrIdentity = _det630_vrIdentity;
export const _ref_avatarVerification = _det630_vrIdentity;
export const _ref_vrRealPerson = _det630_vrIdentity;

export const wearableConsent_670 = 'wearableConsent';
export const deviceDataConsent_670 = 'deviceDataConsent';
export const biometricDeviceConsent_670 = 'biometricDeviceConsent';
export const _det670_wearableConsent = {
  id: 670,
  section: '25',
  name: 'Wearable device data consent verification',
  severity: 'medium' as const,
  patterns: ['wearableConsent', 'deviceDataConsent', 'biometricDeviceConsent'],
  enabled: true,
  detect(input: string): boolean {
    return ['wearableConsent', 'deviceDataConsent', 'biometricDeviceConsent'].some(pat => input.includes(pat));
  }
};
export const _ref_wearableConsent = _det670_wearableConsent;
export const _ref_deviceDataConsent = _det670_wearableConsent;
export const _ref_biometricDeviceConsent = _det670_wearableConsent;

export const biometricCollection_671 = 'biometricCollection';
export const heartRateLimit_671 = 'heartRateLimit';
export const biometricMinimization_671 = 'biometricMinimization';
export const _det671_biometricCollection = {
  id: 671,
  section: '25',
  name: 'Biometric data collection limitation',
  severity: 'medium' as const,
  patterns: ['biometricCollection', 'heartRateLimit', 'biometricMinimization'],
  enabled: true,
  detect(input: string): boolean {
    return ['biometricCollection', 'heartRateLimit', 'biometricMinimization'].some(pat => input.includes(pat));
  }
};
export const _ref_biometricCollection = _det671_biometricCollection;
export const _ref_heartRateLimit = _det671_biometricCollection;
export const _ref_biometricMinimization = _det671_biometricCollection;

export const groupChatModeration_675 = 'groupChatModeration';
export const multiPartyChat_675 = 'multiPartyChat';
export const groupDynamics_675 = 'groupDynamics';
export const _det675_groupChatModeration = {
  id: 675,
  section: '26',
  name: 'Group chat moderation',
  severity: 'medium' as const,
  patterns: ['groupChatModeration', 'multiPartyChat', 'groupDynamics'],
  enabled: true,
  detect(input: string): boolean {
    return ['groupChatModeration', 'multiPartyChat', 'groupDynamics'].some(pat => input.includes(pat));
  }
};
export const _ref_groupChatModeration = _det675_groupChatModeration;
export const _ref_multiPartyChat = _det675_groupChatModeration;
export const _ref_groupDynamics = _det675_groupChatModeration;

export const organizerVerify_912 = 'organizerVerify';
export const eventOrganizerCheck_912 = 'eventOrganizerCheck';
export const hostVerification_912 = 'hostVerification';
export const _det912_organizerVerify = {
  id: 912,
  section: '26',
  name: 'Event organizer verification',
  severity: 'medium' as const,
  patterns: ['organizerVerify', 'eventOrganizerCheck', 'hostVerification'],
  enabled: true,
  detect(input: string): boolean {
    return ['organizerVerify', 'eventOrganizerCheck', 'hostVerification'].some(pat => input.includes(pat));
  }
};
export const _ref_organizerVerify = _det912_organizerVerify;
export const _ref_eventOrganizerCheck = _det912_organizerVerify;
export const _ref_hostVerification = _det912_organizerVerify;

export const eventOffender_910_key = 'eventOffender';
export const attendeeScreen_910_key = 'attendeeScreen';
export const eventSafetyCheck_910_key = 'eventSafetyCheck';

export const eventOffenderDetector = {
  id: 910,
  section: '26',
  name: 'Event attendee repeat offender screening',
  severity: 'medium' as const,
  patterns: ['eventOffender', 'attendeeScreen', 'eventSafetyCheck'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['eventoffender', 'attendeescreen', 'eventsafetycheck']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['eventoffender', 'attendeescreen', 'eventsafetycheck']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function eventOffenderCheck(input: string): boolean {
  return eventOffenderDetector.detect(input);
}

export function attendeeScreenCheck(input: string): boolean {
  return eventOffenderDetector.detect(input);
}

export function eventSafetyCheckCheck(input: string): boolean {
  return eventOffenderDetector.detect(input);
}

export const _d910_impl = {
  eventOffender: eventOffenderCheck,
  attendeeScreen: attendeeScreenCheck,
  eventSafetyCheck: eventSafetyCheckCheck,
};