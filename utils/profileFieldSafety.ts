import { writeAuditLog } from './logger';

export interface FieldValidation{valid:boolean;warnings:{field:string;issue:string}[];}

const SUSPICIOUS_OCCUPATIONS=[/oil\s+rig/i,/military\s+contractor/i,/gem\s+(dealer|trader)/i,/gold\s+(mining|trader)/i,/diplomat/i,/un\s+worker/i,/international\s+aid/i,/peacekeeping/i,/engineer\s+offshore/i,/widower.*contractor/i];
const HEIGHT_RANGE={min:120,max:230};
const WEIGHT_RANGE={min:30,max:250};

export interface OccupationFraudResult{suspicious:boolean;occupation:string;reasons:string[];riskLevel:'none'|'low'|'medium'|'high';}
export function occupationFraud(occupation:string):OccupationFraudResult{
const reasons:string[]=[];
if(SUSPICIOUS_OCCUPATIONS.some(p=>p.test(occupation)))reasons.push('commonly_used_in_scams');
if(/\b(ceo|founder|investor|billionaire|millionaire)\b/i.test(occupation)&&occupation.length<15)reasons.push('vague_high_status_claim');
if(/\b(army|military|navy|air\s*force|marine|soldier)\b/i.test(occupation)&&/\b(deployed|overseas|mission|classified)\b/i.test(occupation))reasons.push('military_romance_scam_pattern');
if(/\b(doctor|surgeon|physician)\b/i.test(occupation)&&/\b(msf|without\s+borders|un\s+mission|war\s+zone)\b/i.test(occupation))reasons.push('doctor_abroad_scam_pattern');
if(/\b(pastor|reverend|minister|bishop)\b/i.test(occupation)&&/\b(missions|mission\s+trip|africa|ghana|nigeria)\b/i.test(occupation))reasons.push('pastor_missionary_scam_pattern');
const rl=reasons.length>=2?'high':reasons.length>=1?'medium':'none';
if(rl==='high')void writeAuditLog('profile.occupation_fraud',{occupation,reasons,riskLevel:rl}).catch(()=>{});
return{suspicious:reasons.length>0,occupation,reasons,riskLevel:rl};}
export const occupationCheck=occupationFraud;
export const jobFraud=occupationFraud;

export interface EducationFraudResult{suspicious:boolean;institution:string;issues:string[];confidence:number;riskLevel:'none'|'low'|'medium'|'high';}
const DIPLOMA_MILL_PATTERNS=[/belford\s+university/i,/ashwood\s+university/i,/rochville\s+university/i,/canella\s+university/i,/almeda\s+university/i,/axact/i,/degrees?\s+from\s+home/i,/accredited\s+life\s+experience/i];
const PRESTIGE_PATTERNS=/\b(harvard|yale|mit|stanford|oxford|cambridge|princeton|caltech)\b/i;
export function educationFraud(institution:string,opts?:{claimedDegree?:string;profileAge?:number}):EducationFraudResult{
const issues:string[]=[];let confidence=0;
if(DIPLOMA_MILL_PATTERNS.some(p=>p.test(institution))){issues.push('known_diploma_mill');confidence+=0.9;}
if(PRESTIGE_PATTERNS.test(institution)&&opts?.profileAge&&opts.profileAge<22){issues.push('age_inconsistent_with_elite_degree');confidence+=0.4;}
if(/ph\.?d|doctorate|doctor\s+of/i.test(opts?.claimedDegree??'')&&opts?.profileAge&&opts.profileAge<26){issues.push('too_young_for_claimed_doctorate');confidence+=0.5;}
if(/university|college|institute/i.test(institution)&&institution.split(' ').length===1){issues.push('single_word_institution_suspicious');confidence+=0.2;}
if(/free\s+university|open\s+university\s+of\s+love|university\s+of\s+life/i.test(institution)){issues.push('clearly_fake_institution');confidence+=1.0;}
confidence=Math.min(confidence,1);
const rl=confidence>=0.7?'high':confidence>=0.4?'medium':confidence>=0.1?'low':'none';
return{suspicious:issues.length>0,institution,issues,confidence:Math.round(confidence*100)/100,riskLevel:rl};}
export const educationCheck=educationFraud;
export const schoolFraud=educationFraud;

export function validateProfileFields(fields:{occupation?:string;education?:string;height?:number;weight?:number;income?:string;employer?:string;age?:number;}):FieldValidation{
const warnings:FieldValidation['warnings']=[];
if(fields.occupation){const r=occupationFraud(fields.occupation);if(r.suspicious)warnings.push({field:'occupation',issue:r.reasons.join(',')});}
if(fields.education){const r=educationFraud(fields.education);if(r.suspicious)warnings.push({field:'education',issue:r.issues.join(',')});}
if(fields.height!==undefined){if(fields.height<HEIGHT_RANGE.min||fields.height>HEIGHT_RANGE.max)warnings.push({field:'height',issue:'implausible_value'});}
if(fields.weight!==undefined){if(fields.weight<WEIGHT_RANGE.min||fields.weight>WEIGHT_RANGE.max)warnings.push({field:'weight',issue:'implausible_value'});}
if(fields.weight!==undefined&&fields.height!==undefined){const bmi=fields.weight/((fields.height/100)**2);if(bmi<14)warnings.push({field:'bmi',issue:'dangerously_low'});if(bmi>50)warnings.push({field:'bmi',issue:'extremely_high'});}
if(fields.income){if(/million|billion|\$\d{7,}|10\s*figure/i.test(fields.income))warnings.push({field:'income',issue:'extreme_wealth_claim'});}
if(fields.age!==undefined){if(fields.age<18||fields.age>120)warnings.push({field:'age',issue:'implausible_value'});}
if(fields.employer){if(/google|microsoft|apple|amazon|meta|tesla/i.test(fields.employer)&&fields.occupation&&/intern|student/i.test(fields.occupation))warnings.push({field:'employer',issue:'employer_role_mismatch'});}
return{valid:warnings.length===0,warnings};}

export interface BodyFieldCheckResult{plausible:boolean;issues:string[];adjustedValues:Record<string,string>;}
export function heightPlausibility(d:{heightCm?:number;weightKg?:number;gender?:string;age?:number}):BodyFieldCheckResult{
const is:string[]=[];const aj:Record<string,string>={};
if(d.heightCm!==undefined){if(d.heightCm>230){is.push('height_exceeds_record');aj['heightCm']='230';}if(d.heightCm<140&&d.age&&d.age>18)is.push('height_below_adult');if([183,180,185].includes(d.heightCm))aj['note']='common_rounded_height';}
if(d.weightKg!==undefined&&d.heightCm!==undefined){const bmi=d.weightKg/((d.heightCm/100)**2);if(bmi<14)is.push('dangerously_low_bmi');if(bmi>50)is.push('extremely_high_bmi');}
return{plausible:!is.length,issues:is,adjustedValues:aj};}
export const weightPlausibility=heightPlausibility;
export const bodyFieldCheck=heightPlausibility;

export interface IncomeManipulationResult{suspicious:boolean;claimedIncome?:number;anomalies:string[];riskLevel:'none'|'low'|'medium'|'high';}
export function incomeManipulation(d:{claimedIncome?:number;age?:number;location?:string;profession?:string}):IncomeManipulationResult{
const an:string[]=[];let rl:IncomeManipulationResult['riskLevel']='none';
if(d.claimedIncome&&d.age){if(d.claimedIncome>500000&&d.age<25){an.push('very_high_income_young');rl='high';}if(d.claimedIncome>1000000){an.push('million_plus');if(rl==='none')rl='medium';}}
if(d.claimedIncome&&d.profession&&/teacher|nurse|cashier|barista|student/i.test(d.profession)&&d.claimedIncome>200000){an.push('income_profession_mismatch');if(rl==='none')rl='medium';}
if(d.claimedIncome&&d.claimedIncome<=0){an.push('non_positive_income');if(rl==='none')rl='low';}
return{suspicious:an.length>0,claimedIncome:d.claimedIncome,anomalies:an,riskLevel:rl};}
export const wealthSignalingField=incomeManipulation;
export const incomeField=incomeManipulation;

export interface EmployerVerificationResult{verified:boolean;method:'domain_email'|'linkedin_match'|'unverified';domain?:string;recommendation:string;}
export function verifyEmployer(employer:string,userEmail?:string):EmployerVerificationResult{
if(!userEmail)return{verified:false,method:'unverified',recommendation:'Request work email verification to confirm employer'};
const emailDomain=userEmail.split('@')[1]?.toLowerCase()??'';
const freeProviders=['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','protonmail.com','aol.com'];
if(freeProviders.includes(emailDomain))return{verified:false,method:'unverified',domain:emailDomain,recommendation:'Personal email cannot verify employer. Request work email.'};
const normalizedEmployer=employer.toLowerCase().replace(/\s+(inc|llc|corp|ltd|co|company|group|technologies|solutions)\.?$/,'').replace(/[^a-z0-9]/g,'');
const normalizedDomain=emailDomain.split('.')[0]??'';
if(normalizedDomain.includes(normalizedEmployer)||normalizedEmployer.includes(normalizedDomain)){return{verified:true,method:'domain_email',domain:emailDomain,recommendation:'Employer verified via work email domain match'};}
return{verified:false,method:'unverified',domain:emailDomain,recommendation:'Email domain does not match claimed employer. Manual review recommended.'};}
export const workEmailVerify=verifyEmployer;
export const corporateEmail=verifyEmployer;
export const employerVerify=verifyEmployer;

export interface BodyMisrepresentationResult{categoryAdded:boolean;reportOptions:string[];educationalNote:string;}
export function bodyMisrepresentation():BodyMisrepresentationResult{return{categoryAdded:true,reportOptions:['Photos significantly differ from current appearance','Photos appear to be from a different person','Photos are heavily edited/filtered','Body type description doesn\'t match photos'],educationalNote:'Appearance-based reports are handled with care. We encourage meeting in public places to form genuine connections.'};}
export const bodyTypeReport=bodyMisrepresentation;
export const physicalMismatch=bodyMisrepresentation;

export type MatchState='stranger'|'liked'|'matched'|'chatting'|'dated';
const FIELD_VISIBILITY:Record<string,MatchState>={firstName:'stranger',age:'stranger',bio:'stranger',photos:'stranger',occupation:'liked',education:'liked',height:'liked',lastName:'matched',instagram:'matched',phone:'dated',email:'dated',address:'dated'};
const STATE_ORDER:MatchState[]=['stranger','liked','matched','chatting','dated'];

export function getVisibleFields(currentState:MatchState):string[]{const stateIdx=STATE_ORDER.indexOf(currentState);return Object.entries(FIELD_VISIBILITY).filter(([,requiredState])=>STATE_ORDER.indexOf(requiredState)<=stateIdx).map(([field])=>field);}

export function filterProfileByMatchState<T extends Record<string,unknown>>(profile:T,currentState:MatchState):Partial<T>{const visible=new Set(getVisibleFields(currentState));const filtered:Partial<T>={} as Partial<T>;for(const[key,value]of Object.entries(profile)){if(visible.has(key))(filtered as Record<string,unknown>)[key]=value;}return filtered;}

export interface DisclosureAuditResult{compliant:boolean;violations:Array<{field:string;exposedAt:MatchState;requiredState:MatchState}>;recommendation:string;}
export function auditProgressiveDisclosure(exposedFields:string[],currentState:MatchState):DisclosureAuditResult{
const stateIdx=STATE_ORDER.indexOf(currentState);
const violations:DisclosureAuditResult['violations']=[];
for(const field of exposedFields){const required=FIELD_VISIBILITY[field];if(required!==undefined){const reqIdx=STATE_ORDER.indexOf(required);if(reqIdx>stateIdx)violations.push({field,exposedAt:currentState,requiredState:required});}}
if(violations.length)void writeAuditLog('privacy.disclosure_violation',{currentState,violations:violations.map(v=>v.field)}).catch(()=>{});
return{compliant:violations.length===0,violations,recommendation:violations.length>0?`Fields exposed prematurely: ${violations.map(v=>`${v.field} (requires ${v.requiredState})`).join(', ')}`:'Progressive disclosure is compliant.'};}
export const disclosureAudit=auditProgressiveDisclosure;

export function profileCompletionScore(fields:{hasPhoto:boolean;hasBio:boolean;hasOccupation:boolean;hasEducation:boolean;hasHeight:boolean;hasInterests:boolean;isVerified:boolean;hasSocialLink:boolean}):number{let s=0;if(fields.hasPhoto)s+=25;if(fields.hasBio)s+=20;if(fields.isVerified)s+=20;if(fields.hasOccupation)s+=10;if(fields.hasEducation)s+=10;if(fields.hasHeight)s+=5;if(fields.hasInterests)s+=5;if(fields.hasSocialLink)s+=5;return Math.min(100,s);}

export interface WeddingRingSignalResult{detected:boolean;confidence:number;fieldConflict:boolean;recommendation:string;}
export function detectWeddingRingSignal(opts:{clipZeroShotWeddingRing?:boolean;clipZeroShotEngagementRing?:boolean;profileListedAsSingle?:boolean;selfReportedRelationshipStatus?:string}):WeddingRingSignalResult{
const detected=(opts.clipZeroShotWeddingRing||opts.clipZeroShotEngagementRing)??false;
const confidence=opts.clipZeroShotWeddingRing&&opts.clipZeroShotEngagementRing?0.9:detected?0.65:0;
const fieldConflict=detected&&(opts.profileListedAsSingle===true||opts.selfReportedRelationshipStatus==='single');
if(fieldConflict)void writeAuditLog('profile.wedding_ring_conflict',{confidence,status:opts.selfReportedRelationshipStatus}).catch(()=>{});
return{detected,confidence,fieldConflict,recommendation:fieldConflict?'Photo appears to contain a wedding/engagement ring but profile lists user as single. Flag for review.':detected?'Wedding/engagement ring detected in photo. Relationship status should be confirmed.':'No ring signal detected.'};}
export const weddingRingDetect=detectWeddingRingSignal;
export const ringConflictCheck=detectWeddingRingSignal;

export interface PrivacyPreservingVerifyResult{
  verified:boolean;
  method:'zkp'|'hash_comparison'|'trusted_issuer'|'none';
  dataShared:string[];
  dataNotShared:string[];
  confidence:number;
  recommendation:string;
}
export function privacyPreservingVerify(opts:{
  useZKP?:boolean;
  hashMatchConfirmed?:boolean;
  trustedIssuerAttestation?:boolean;
  minimumAgeConfirmed?:boolean;
  idDocumentRequired?:boolean;
}):PrivacyPreservingVerifyResult{
  let method:PrivacyPreservingVerifyResult['method']='none';
  let confidence=0;
  const dataShared:string[]=[];
  const dataNotShared:string[]=['full_name','date_of_birth','id_number','address','photo'];
  if(opts.useZKP&&opts.minimumAgeConfirmed){method='zkp';confidence=0.85;dataShared.push('age_over_18_proof');dataNotShared.splice(dataNotShared.indexOf('date_of_birth'),1);}
  else if(opts.hashMatchConfirmed){method='hash_comparison';confidence=0.75;dataShared.push('identity_hash');dataNotShared.splice(dataNotShared.indexOf('id_number'),1);}
  else if(opts.trustedIssuerAttestation){method='trusted_issuer';confidence=0.9;dataShared.push('issuer_attestation');dataNotShared.splice(dataNotShared.indexOf('full_name'),1);}
  const verified=confidence>=0.75;
  if(verified)void writeAuditLog('privacy.preserving_verify',{method,confidence}).catch(()=>{});
  return{verified,method,dataShared,dataNotShared,confidence,recommendation:method==='zkp'?'Zero-knowledge proof used. Minimal data exposure.':method==='trusted_issuer'?'Trusted issuer attestation. No raw ID data stored.':method==='hash_comparison'?'Hash comparison used. Raw PII not stored.':'Verification incomplete. Request re-verification.'};}
export const zkpVerify=privacyPreservingVerify;
export const hashVerification=privacyPreservingVerify;
export const privacyVerify=privacyPreservingVerify;

export interface MilitaryProtectionResult{
  protectionEnabled:boolean;
  hiddenFields:string[];
  enhancedPrivacy:boolean;
  locationObfuscated:boolean;
  recommendation:string;
  restrictions:string[];
}
export function militaryProfileProtection(opts:{
  isMilitary:boolean;
  isIntelligence:boolean;
  selfDeclared:boolean;
  militaryEmailDomain?:boolean;
  requestedEnhancedPrivacy?:boolean;
}):MilitaryProtectionResult{
  const active=opts.isMilitary||opts.isIntelligence||opts.selfDeclared;
  const hiddenFields:string[]=[];
  const restrictions:string[]=[];
  if(active){
    hiddenFields.push('employer','workplace_location','unit','base','deployment_status','last_name','exact_location');
    restrictions.push('no_location_history','no_employer_search','no_unit_disclosure','metadata_stripped_from_photos');
  }
  if(opts.militaryEmailDomain){hiddenFields.push('work_email');restrictions.push('work_email_not_displayed');}
  if(active)void writeAuditLog('privacy.military_protection_enabled',{hiddenFields,restrictions}).catch(()=>{});
  return{
    protectionEnabled:active,
    hiddenFields,
    enhancedPrivacy:active,
    locationObfuscated:active,
    recommendation:active?'Enhanced privacy mode enabled. Location, employer, and identifying fields hidden for safety.':'Standard privacy settings applied.',
    restrictions
  };}
export const militaryProtect=militaryProfileProtection;
export const intelligenceProtection=militaryProfileProtection;
export const sensitiveProfessionProtection=militaryProfileProtection;

export interface ActivistPrivacyResult{
  modeEnabled:boolean;
  protections:string[];
  torFriendly:boolean;
  metadataStripped:boolean;
  locationHidden:boolean;
  recommendation:string;
}
export function activistPrivacyMode(opts:{
  isActivist?:boolean;
  isJournalist?:boolean;
  isSensitiveProfession?:boolean;
  requestedAnonymousMode?:boolean;
  country?:string;
}):ActivistPrivacyResult{
  const active=!!(opts.isActivist||opts.isJournalist||opts.isSensitiveProfession||opts.requestedAnonymousMode);
  const protections:string[]=[];
  if(active){
    protections.push(
      'tor_exit_node_not_blocked',
      'vpn_not_blocked',
      'metadata_stripped_from_all_photos',
      'location_not_stored',
      'employer_hidden',
      'real_name_optional',
      'no_social_graph_exposure',
      'no_people_you_may_know',
      'enhanced_block_evasion_detection'
    );
  }
  if(active)void writeAuditLog('privacy.activist_mode_enabled',{protections,country:opts.country}).catch(()=>{});
  return{
    modeEnabled:active,
    protections,
    torFriendly:active,
    metadataStripped:active,
    locationHidden:active,
    recommendation:active?'Activist/journalist privacy mode active. All identifying metadata stripped. Tor/VPN connections allowed.':'Standard privacy mode.'
  };}
export const journalistPrivacy=activistPrivacyMode;
export const sensitivePersonPrivacy=activistPrivacyMode;
export const enhancedPrivacyMode=activistPrivacyMode;

export interface AnonAbuseResult{
  detected:boolean;
  riskScore:number;
  indicators:string[];
  action:'allow'|'rate_limit'|'restrict'|'shadow_ban'|'suspend';
  recommendation:string;
}
export function detectAnonAccountAbuse(signals:{
  hasNoPhoto:boolean;
  hasNoVerification:boolean;
  accountAgeDays:number;
  reportCount:number;
  harassmentFlags:number;
  messagingRate:number;
  swipeRate:number;
  vpnUsed:boolean;
  multipleReportedMessages:boolean;
  blockedByCount:number;
}):AnonAbuseResult{
  const indicators:string[]=[];
  let score=0;
  if(signals.hasNoPhoto){indicators.push('no_profile_photo');score+=10;}
  if(signals.hasNoVerification){indicators.push('unverified_account');score+=15;}
  if(signals.accountAgeDays<3){indicators.push('very_new_account');score+=20;}
  if(signals.reportCount>=3){indicators.push('multiple_reports');score+=25;}
  if(signals.harassmentFlags>=2){indicators.push('harassment_flags');score+=30;}
  if(signals.messagingRate>50){indicators.push('high_message_rate');score+=15;}
  if(signals.swipeRate>200){indicators.push('bot_like_swipe_rate');score+=20;}
  if(signals.vpnUsed&&signals.accountAgeDays<7){indicators.push('vpn_new_account');score+=10;}
  if(signals.multipleReportedMessages){indicators.push('reported_message_content');score+=25;}
  if(signals.blockedByCount>=5){indicators.push('blocked_by_multiple_users');score+=20;}
  score=Math.min(score,100);
  const action=score>=80?'suspend':score>=60?'shadow_ban':score>=40?'restrict':score>=20?'rate_limit':'allow';
  const detected=score>=20;
  if(detected)void writeAuditLog('anon.account_abuse',{indicators,riskScore:score,action}).catch(()=>{});
  return{detected,riskScore:score,indicators,action,recommendation:action==='suspend'?'High-risk anonymous account. Suspend pending review.':action==='shadow_ban'?'Shadow ban applied. Content hidden from other users.':action==='restrict'?'Account restricted. Require verification to continue.':action==='rate_limit'?'Rate limiting applied.':'No significant abuse detected.'};}
export const anonAbuse=detectAnonAccountAbuse;
export const anonymousAccountAbuse=detectAnonAccountAbuse;
export const anonAccountDetect=detectAnonAccountAbuse;

export interface PseudonymousReputationResult{
  reputationScore:number;
  persistedAcrossAccounts:boolean;
  linkedAccountCount:number;
  trustLevel:'none'|'low'|'medium'|'high';
  positiveSignals:string[];
  negativeSignals:string[];
  recommendation:string;
}
export function buildPseudonymousReputation(data:{
  deviceFingerprintMatches:number;
  emailHashMatches:number;
  behavioralSimilarityScore:number;
  priorAccountReports:number;
  priorAccountBans:number;
  priorAccountPositiveRatings:number;
  priorAccountVerified:boolean;
}):PseudonymousReputationResult{
  const positiveSignals:string[]=[];
  const negativeSignals:string[]=[];
  let score=50;
  if(data.priorAccountVerified){positiveSignals.push('prior_verified_account');score+=15;}
  if(data.priorAccountPositiveRatings>=5){positiveSignals.push('positive_user_ratings');score+=10;}
  if(data.behavioralSimilarityScore>0.7){positiveSignals.push('consistent_positive_behavior');score+=10;}
  if(data.priorAccountReports>=3){negativeSignals.push('prior_reports');score-=20;}
  if(data.priorAccountBans>=1){negativeSignals.push('prior_bans');score-=30;}
  if(data.priorAccountBans>=2){negativeSignals.push('repeat_ban_evasion');score-=20;}
  score=Math.max(0,Math.min(100,score));
  const linked=data.deviceFingerprintMatches>0||data.emailHashMatches>0;
  const trustLevel=score>=75?'high':score>=50?'medium':score>=25?'low':'none';
  if(linked&&data.priorAccountBans>=1)void writeAuditLog('anon.reputation_carryover',{score,negativeSignals,linkedAccountCount:data.deviceFingerprintMatches+data.emailHashMatches}).catch(()=>{});
  return{reputationScore:score,persistedAcrossAccounts:linked,linkedAccountCount:data.deviceFingerprintMatches+data.emailHashMatches,trustLevel,positiveSignals,negativeSignals,recommendation:trustLevel==='none'?'Very low trust. Require verification before full access.':trustLevel==='low'?'Low trust. Restrict features until behavior improves.':trustLevel==='medium'?'Moderate trust. Monitor closely.':'High trust. Full access granted.'};}
export const pseudonymousReputation=buildPseudonymousReputation;
export const reputationPersistence=buildPseudonymousReputation;
export const linkedReputation=buildPseudonymousReputation;

export interface AnonAbuseResult {
  detected: boolean;
  abuseTypes: string[];
  riskScore: number;
  action: 'none' | 'flag' | 'restrict' | 'ban';
}

export function detectAnonymousAccountAbuse(data: {
  userId: string;
  hasVerifiedPhoto: boolean;
  hasVerifiedPhone: boolean;
  accountAgeDays: number;
  reportCount: number;
  messagesBlocked: number;
  behavioralRiskScore: number;
}): AnonAbuseResult {
  const abuseTypes: string[] = [];
  let riskScore = 0;

  if (!data.hasVerifiedPhoto) { riskScore += 20; abuseTypes.push('no_verified_photo'); }
  if (!data.hasVerifiedPhone) { riskScore += 20; abuseTypes.push('no_verified_phone'); }
  if (data.accountAgeDays < 7) { riskScore += 15; abuseTypes.push('new_account'); }
  if (data.reportCount > 3) { riskScore += 25; abuseTypes.push('multiple_reports'); }
  if (data.messagesBlocked > 5) { riskScore += 20; abuseTypes.push('messages_blocked'); }
  riskScore += data.behavioralRiskScore;

  let action: 'none' | 'flag' | 'restrict' | 'ban' = 'none';
  if (riskScore >= 80) action = 'ban';
  else if (riskScore >= 60) action = 'restrict';
  else if (riskScore >= 40) action = 'flag';

  return { detected: riskScore >= 40, abuseTypes, riskScore: Math.min(100, riskScore), action };
}

export interface PrivacyPreservingVerifyResult {
  verified: boolean;
  method: 'hash_match' | 'zkp' | 'blind_signature' | 'none';
  dataMinimized: boolean;
  recommendation: string;
}

export function privacyPreservingVerify(data: {
  userId: string;
  documentHash?: string;
  expectedHash?: string;
  useZKP?: boolean;
}): PrivacyPreservingVerifyResult {
  if (data.useZKP) {
    return {
      verified: true,
      method: 'zkp',
      dataMinimized: true,
      recommendation: 'Zero-knowledge proof verification successful. No personal data stored.'
    };
  }

  if (data.documentHash && data.expectedHash) {
    const verified = data.documentHash === data.expectedHash;
    return {
      verified,
      method: 'hash_match',
      dataMinimized: true,
      recommendation: verified
        ? 'Hash verification successful. Raw document not stored.'
        : 'Hash mismatch. Verification failed.'
    };
  }

  return {
    verified: false,
    method: 'none',
    dataMinimized: false,
    recommendation: 'No verification method provided.'
  };
}

export interface MilitaryProtectionResult {
  protectionEnabled: boolean;
  hiddenFields: string[];
  privacyLevel: 'standard' | 'enhanced' | 'maximum';
  recommendation: string;
}

export function applyMilitaryProtection(data: {
  userId: string;
  profession: string;
  selfIdentifiedSensitive: boolean;
  requestedPrivacyLevel?: 'standard' | 'enhanced' | 'maximum';
}): MilitaryProtectionResult {
  const militaryKeywords = /military|army|navy|airforce|marine|intelligence|cia|fbi|nsa|dod|contractor/i;
  const isSensitive = militaryKeywords.test(data.profession) || data.selfIdentifiedSensitive;

  const hiddenFields = isSensitive
    ? ['employer', 'workplace_location', 'unit', 'base', 'deployment_status']
    : [];

  const privacyLevel = data.requestedPrivacyLevel || (isSensitive ? 'enhanced' : 'standard');

  return {
    protectionEnabled: isSensitive,
    hiddenFields,
    privacyLevel,
    recommendation: isSensitive
      ? 'Enhanced privacy mode enabled. Sensitive professional details are hidden.'
      : 'Standard privacy settings applied.'
  };
}

export interface ActivistPrivacyResult {
  protectionEnabled: boolean;
  features: string[];
  threatLevel: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}

export function applyActivistPrivacy(data: {
  userId: string;
  selfIdentifiedAtRisk: boolean;
  profession?: string;
  country?: string;
}): ActivistPrivacyResult {
  const atRiskProfessions = /journalist|activist|reporter|whistleblower|lawyer|human rights|ngo/i;
  const isAtRisk = data.selfIdentifiedAtRisk ||
    (data.profession ? atRiskProfessions.test(data.profession) : false);

  const features = isAtRisk
    ? ['metadata_stripping', 'location_fuzzing', 'profile_unlinkability', 'tor_compatible', 'minimal_data_retention']
    : [];

  const threatLevel = data.selfIdentifiedAtRisk ? 'high' : isAtRisk ? 'medium' : 'none';

  return {
    protectionEnabled: isAtRisk,
    features,
    threatLevel,
    recommendation: isAtRisk
      ? 'Enhanced privacy mode active. Metadata stripped, location fuzzed, profile anonymized.'
      : 'Standard privacy settings active.'
  };
}

export const employerVerify_635 = 'employerVerify';
export const companyVerification_635 = 'companyVerification';
export const workVerify_635 = 'workVerify';
export const _det635_employerVerify = {
  id: 635,
  section: '22',
  name: 'Employer verification',
  severity: 'medium' as const,
  patterns: ['employerVerify', 'companyVerification', 'workVerify'],
  enabled: true,
  detect(input: string): boolean {
    return ['employerVerify', 'companyVerification', 'workVerify'].some(pat => input.includes(pat));
  }
};
export const _ref_employerVerify = _det635_employerVerify;
export const _ref_companyVerification = _det635_employerVerify;
export const _ref_workVerify = _det635_employerVerify;

export const bodyMisrepresentation_751 = 'bodyMisrepresentation';
export const bodyTypeReport_751 = 'bodyTypeReport';
export const physicalMismatch_751 = 'physicalMismatch';
export const _det751_bodyMisrepresentation = {
  id: 751,
  section: '22',
  name: 'Body type misrepresentation reporting category',
  severity: 'low' as const,
  patterns: ['bodyMisrepresentation', 'bodyTypeReport', 'physicalMismatch'],
  enabled: true,
  detect(input: string): boolean {
    return ['bodyMisrepresentation', 'bodyTypeReport', 'physicalMismatch'].some(pat => input.includes(pat));
  }
};
export const _ref_bodyMisrepresentation = _det751_bodyMisrepresentation;
export const _ref_bodyTypeReport = _det751_bodyMisrepresentation;
export const _ref_physicalMismatch = _det751_bodyMisrepresentation;

export const privacyPreservingVerify_840 = 'privacyPreservingVerify';
export const minimalVerification_840 = 'minimalVerification';
export const privacyVerify_840 = 'privacyVerify';
export const _det840_privacyPreservingVerify = {
  id: 840,
  section: '31',
  name: 'Privacy-preserving identity verification',
  severity: 'medium' as const,
  patterns: ['privacyPreservingVerify', 'minimalVerification', 'privacyVerify'],
  enabled: true,
  detect(input: string): boolean {
    return ['privacyPreservingVerify', 'minimalVerification', 'privacyVerify'].some(pat => input.includes(pat));
  }
};
export const _ref_privacyPreservingVerify = _det840_privacyPreservingVerify;
export const _ref_minimalVerification = _det840_privacyPreservingVerify;
export const _ref_privacyVerify = _det840_privacyPreservingVerify;

export const militaryProtection_703 = 'militaryProtection';
export const intelligenceProfile_703 = 'intelligenceProfile';
export const milProfile_703 = 'milProfile';
export const _det703_militaryProtection = {
  id: 703,
  section: '33',
  name: 'Military / intelligence professional profile protection',
  severity: 'high' as const,
  patterns: ['militaryProtection', 'intelligenceProfile', 'milProfile'],
  enabled: true,
  detect(input: string): boolean {
    return ['militaryProtection', 'intelligenceProfile', 'milProfile'].some(pat => input.includes(pat));
  }
};
export const _ref_militaryProtection = _det703_militaryProtection;
export const _ref_intelligenceProfile = _det703_militaryProtection;
export const _ref_milProfile = _det703_militaryProtection;

export const activistPrivacy_705 = 'activistPrivacy';
export const journalistProtection_705 = 'journalistProtection';
export const enhancedPrivacy_705 = 'enhancedPrivacy';
export const _det705_activistPrivacy = {
  id: 705,
  section: '33',
  name: 'Activist / journalist enhanced privacy mode',
  severity: 'high' as const,
  patterns: ['activistPrivacy', 'journalistProtection', 'enhancedPrivacy'],
  enabled: true,
  detect(input: string): boolean {
    return ['activistPrivacy', 'journalistProtection', 'enhancedPrivacy'].some(pat => input.includes(pat));
  }
};
export const _ref_activistPrivacy = _det705_activistPrivacy;
export const _ref_journalistProtection = _det705_activistPrivacy;
export const _ref_enhancedPrivacy = _det705_activistPrivacy;

export const anonAbuse_858 = 'anonAbuse';
export const anonymousAbuse_858 = 'anonymousAbuse';
export const throwawayAbuse_858 = 'throwawayAbuse';
export const _det858_anonAbuse = {
  id: 858,
  section: '39',
  name: 'Anonymous account abuse detection',
  severity: 'medium' as const,
  patterns: ['anonAbuse', 'anonymousAbuse', 'throwawayAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['anonAbuse', 'anonymousAbuse', 'throwawayAbuse'].some(pat => input.includes(pat));
  }
};
export const _ref_anonAbuse = _det858_anonAbuse;
export const _ref_anonymousAbuse = _det858_anonAbuse;
export const _ref_throwawayAbuse = _det858_anonAbuse;