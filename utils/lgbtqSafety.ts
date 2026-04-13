// ═══════════════════════════════════════════════════════════════
// utils/lgbtqSafety.ts — FULL UPDATED
// Covers: [19] LGBTQ+ safety features
// [19] #604 Entrapment pattern detection
// [19] Pronoun violation, conversion therapy, trans safety
// [19] Disclosure risk, safe space, outing detection
// ═══════════════════════════════════════════════════════════════
import { writeAuditLog } from './logger';

const CRIM=new Set(['AF','BN','IR','MR','NG','PK','QA','SA','SO','YE','BD','BT','CM','EG','ET','GH','GN','ID','IQ','JM','KE','KW','LB','LY','MW','MY','MM','OM','SD','SY','TZ','TG','TN','TM','UG','UZ','ZM','ZW']);
const DEATH=new Set(['AF','BN','IR','MR','NG','QA','SA','SO','YE']);

export interface LGBTQSafetyResult{riskLevel:'safe'|'caution'|'danger'|'extreme_danger';warning?:string;recommendations:string[];}
export function assessLocationRisk(code:string):LGBTQSafetyResult{
const c=code.toUpperCase();
if(DEATH.has(c))return{riskLevel:'extreme_danger',warning:'Same-sex relationships may carry the death penalty.',recommendations:['Hide profile in this region','Use VPN','Disable location sharing','Remove identifiable info']};
if(CRIM.has(c))return{riskLevel:'danger',warning:'Same-sex relationships are criminalized.',recommendations:['Exercise extreme caution','Use traveler alert mode','Do not share precise location']};
return{riskLevel:'safe',recommendations:[]};}

export function shouldShowTravelerAlert(user:{lgbtq:boolean},current:string,prev?:string){
if(!user.lgbtq||!prev||prev===current)return false;
const r=assessLocationRisk(current);
if(r.riskLevel==='danger'||r.riskLevel==='extreme_danger')writeAuditLog('lgbtq.traveler_alert',{country:current,risk:r.riskLevel}).catch(()=>{});
return r.riskLevel==='danger'||r.riskLevel==='extreme_danger';}
export const lgbtqTravelerAlert=shouldShowTravelerAlert;

export function getOutingWarning(){return'Sharing this profile may reveal sensitive information about someone\'s identity. Please consider their safety.';}

const HOMO=[/\b(f+a+g+|f+a+g+o+t+|d+y+k+e+|tr+a+n+n+y+)\b/i,/that('s|'s)\s+(so\s+)?gay/i,/no\s+(homo|trans)/i,/gender\s+ideology/i,/groomer/i];
export function detectHomophobia(msg:string){const t:string[]=[];for(const p of HOMO){const m=msg.match(p);if(m)t.push(m[0]);}if(t.length)writeAuditLog('lgbtq.homophobic_content',{terms:t}).catch(()=>{});return{detected:t.length>0,terms:t};}
export const homophobicContent=detectHomophobia;

// ─── #604 LGBTQ+ entrapment pattern detection ─────────────────
export interface LGBTQEntrapmentResult{
  detected:boolean;
  confidence:number;
  patterns:string[];
  highRisk:boolean;
  action:'allow'|'monitor'|'flag'|'block';
}
export function lgbtqEntrapment(msgs:string[]):LGBTQEntrapmentResult{
const P=[
{r:/are you (gay|bi|trans|lesbian|queer|nonbinary)/i,n:'identity_probe'},
{r:/prove (it|you('re| are) (gay|bi|trans|queer))/i,n:'proof_demand'},
{r:/meet.*in private|just (us|you and me).*(secret|private|discreet)/i,n:'isolation_attempt'},
{r:/i('ll| will) report you|i know (people|where you live|your family)/i,n:'threat'},
{r:/screenshot.*post.*you|expose.*your.*secret/i,n:'outing_threat'},
{r:/you don'?t look (gay|trans|bi)|i thought you were straight/i,n:'identity_invalidation'},
{r:/are you (really|actually) (gay|bi|trans)|you (seem|look|act) straight/i,n:'identity_questioning'},
{r:/i('ll| will) tell (everyone|your family|your boss|your school)/i,n:'blackmail_threat'},
{r:/(come|meet) (over|me|here|alone) and (prove|show) (it|me)/i,n:'predatory_meetup'},
];
const f=P.filter(p=>msgs.some(m=>p.r.test(m)));
const highRisk=f.some(x=>['outing_threat','threat','isolation_attempt','blackmail_threat','predatory_meetup'].includes(x.n));
const confidence=Math.min(f.length/P.length+(highRisk?0.3:0),1);
if(f.length>=2||highRisk)writeAuditLog('lgbtq.entrapment_detected',{indicators:f.map(x=>x.n),highRisk,confidence}).catch(()=>{});
return{
  detected:f.length>=2||highRisk,
  confidence:Math.round(confidence*100)/100,
  patterns:f.map(x=>x.n),
  highRisk,
  action:highRisk?'block':f.length>=2?'flag':f.length>=1?'monitor':'allow'
};}
export const stingOperation=lgbtqEntrapment;
export const lgbtqEntrapmentDetect=lgbtqEntrapment;

export function lgbtqOuting(msg:string,ctx:{isPrivate:boolean}){
const d=/\b(outed|telling everyone|posting.*gay|revealing.*orientation)\b/i.test(msg)&&ctx.isPrivate;
if(d)writeAuditLog('lgbtq.outing_risk').catch(()=>{});
return{detected:d,severity:d?'high':'none'};}

export function autoHideLgbtq(country:string,profile:Record<string,unknown>){
const REST=['IR','SA','AF','NG','SO','YE','BN','MR','QA','TC','UZ','TJ'];
const hide=REST.includes(country.toUpperCase());
const fields=hide?['sexualOrientation','genderIdentity','pronouns']:[];
return{shouldHide:hide,fieldsHidden:fields};}
export const lgbtqAutoHide=autoHideLgbtq;

export function stripOrientation(profile:Record<string,unknown>,country:string){
const r={...profile},{shouldHide,fieldsHidden}=autoHideLgbtq(country,profile);
if(shouldHide)fieldsHidden.forEach(f=>delete r[f]);
return r;}
export const stripGenderIdentity=stripOrientation;export const redactSensitiveRegion=stripOrientation;

// ─── [19] Pronoun violation detection ────────────────────────
export interface PronounRespectResult{respectful:boolean;violations:string[];severity:'none'|'low'|'medium'|'high';action:'none'|'warn'|'restrict';}
export function detectPronounViolation(msg:string,targetPronouns:{they?:boolean;she?:boolean;he?:boolean;xe?:boolean}):PronounRespectResult{
const violations:string[]=[];
if(targetPronouns.they&&/\b(he|she|him|her|his|hers)\b/i.test(msg)&&!/\bthey\b/i.test(msg))violations.push('misgendering_binary_pronouns');
if(/\b(it|its)\b/i.test(msg)&&(targetPronouns.they||targetPronouns.she||targetPronouns.he))violations.push('dehumanizing_pronoun');
if(/real\s+(man|woman|gender)|born\s+(a\s+)?(man|woman|male|female)/i.test(msg))violations.push('trans_invalidation');
const sev:PronounRespectResult['severity']=violations.length>=2?'high':violations.length>=1?'medium':'none';
if(sev!=='none')writeAuditLog('lgbtq.pronoun_violation',{violations}).catch(()=>{});
return{respectful:violations.length===0,violations,severity:sev,action:sev==='high'?'restrict':sev==='medium'?'warn':'none'};}
export const pronounRespect=detectPronounViolation;

// ─── [19] Conversion therapy content detection ────────────────
export interface ConversionTherapyResult{detected:boolean;phrases:string[];severity:'none'|'medium'|'high'|'critical';action:'none'|'warn'|'block';}
const CONVERSION_PATTERNS=[/pray\s+(away|out)\s+the\s+gay/i,/conversion\s+therapy/i,/ex.gay\s+(ministry|program|therapy)/i,/change\s+your\s+(orientation|sexuality)/i,/choose\s+not\s+to\s+be\s+(gay|bi|trans|lesbian)/i,/\b(cure|fix|heal)\b.*(gay|trans|lesbian|bi|homosexual)/i,/reparative\s+therapy/i,/sexual\s+reorientation/i];
export function detectConversionTherapyContent(msg:string):ConversionTherapyResult{
const phrases:string[]=[];for(const p of CONVERSION_PATTERNS){const m=msg.match(p);if(m)phrases.push(m[0]);}
const sev:ConversionTherapyResult['severity']=phrases.length>=2?'critical':phrases.length>=1?'high':'none';
if(sev!=='none')writeAuditLog('lgbtq.conversion_therapy_content',{phrases}).catch(()=>{});
return{detected:phrases.length>0,phrases,severity:sev,action:sev==='critical'||sev==='high'?'block':sev==='medium'?'warn':'none'};}
export const conversionTherapyDetect=detectConversionTherapyContent;

// ─── [19] Disclosure risk assessment ─────────────────────────
export interface DisclosureRiskResult{riskLevel:'none'|'low'|'medium'|'high';warnings:string[];safetyTips:string[];}
export function assessDisclosureRisk(context:{isFirstMessage:boolean;matchVerified:boolean;locationRisk:'safe'|'caution'|'danger'|'extreme_danger';profileIsPublic:boolean;requestingPersonalInfo:boolean}):DisclosureRiskResult{
const warnings:string[]=[];
if(context.isFirstMessage&&context.requestingPersonalInfo)warnings.push('identity_probe_on_first_message');
if(!context.matchVerified)warnings.push('unverified_match');
if(context.locationRisk==='danger'||context.locationRisk==='extreme_danger')warnings.push('high_risk_location');
if(context.profileIsPublic&&context.locationRisk!=='safe')warnings.push('public_profile_in_risky_region');
const rl:DisclosureRiskResult['riskLevel']=warnings.length>=3?'high':warnings.length>=2?'medium':warnings.length>=1?'low':'none';
return{riskLevel:rl,warnings,safetyTips:rl!=='none'?['You control what you share and when','Trust your instincts — you don\'t have to disclose anything','Use our block/report if anyone pressures you']:[]};}
export const lgbtqDisclosureRisk=assessDisclosureRisk;

// ─── [19] Safe space verification ────────────────────────────
export interface SafeSpaceVerifyResult{verified:boolean;signals:string[];trustScore:number;}
export function verifySafeSpace(profile:{hasPronounsListed:boolean;hasInclusivityStatement:boolean;lgbtqFriendlyKeywords:boolean;hasNondiscriminationPolicy:boolean}):SafeSpaceVerifyResult{
const signals:string[]=[];let score=0;
if(profile.hasPronounsListed){signals.push('pronouns_listed');score+=25;}
if(profile.hasInclusivityStatement){signals.push('inclusivity_statement');score+=30;}
if(profile.lgbtqFriendlyKeywords){signals.push('lgbtq_positive_language');score+=25;}
if(profile.hasNondiscriminationPolicy){signals.push('nondiscrimination_policy');score+=20;}
return{verified:score>=50,signals,trustScore:Math.min(score,100)};}
export const safeSpaceVerify=verifySafeSpace;

// ─── [19] Trans safety features ──────────────────────────────
export interface TransSafetyResult{deadnamingDetected:boolean;misgenderingDetected:boolean;threats:string[];severity:'none'|'low'|'medium'|'high';action:'none'|'warn'|'block';}
export function detectTransSafetyViolation(msg:string,targetDeadname?:string,targetPronouns?:{they?:boolean;she?:boolean;he?:boolean}):TransSafetyResult{
const threats:string[]=[];
const deadnaming=!!(targetDeadname&&new RegExp(`\\b${targetDeadname}\\b`,'i').test(msg));
const misgendering=!!(targetPronouns&&(targetPronouns.they&&/\b(he|she)\b/i.test(msg))||(targetPronouns?.she&&/\bhe\b/i.test(msg))||(targetPronouns?.he&&/\bshe\b/i.test(msg)));
if(/\b(tr+a+n+n+y|shemale|it)\b/i.test(msg))threats.push('dehumanizing_slur');
if(/\b(mentally ill|disorder|confused|mutilated|groomed)\b/i.test(msg)&&/\b(trans|gender)\b/i.test(msg))threats.push('trans_pathologizing');
const sev:TransSafetyResult['severity']=threats.length>=2?'high':deadnaming||misgendering||threats.length>=1?'medium':'none';
if(sev!=='none')writeAuditLog('lgbtq.trans_safety_violation',{deadnaming,misgendering,threats}).catch(()=>{});
return{deadnamingDetected:deadnaming,misgenderingDetected:misgendering,threats,severity:sev,action:sev==='high'?'block':sev==='medium'?'warn':'none'};}
export const transSafety=detectTransSafetyViolation;export const deadnameDetect=detectTransSafetyViolation;

// ─── [19] LGBTQ+ hate crime risk indicator ────────────────────
export interface HateCrimeRiskResult{riskDetected:boolean;indicators:string[];urgency:'none'|'low'|'high'|'critical';action:'none'|'warn'|'block'|'alert_safety';}
export function detectHateCrimeRisk(signals:{explicitThreats:boolean;locationDisclosed:boolean;meetupProposed:boolean;groupCoordination:boolean;weaponsMentioned:boolean;priorHateSpeech:boolean}):HateCrimeRiskResult{
const indicators:string[]=[];
if(signals.explicitThreats){indicators.push('explicit_threats');}
if(signals.meetupProposed&&signals.explicitThreats){indicators.push('meetup_with_threat');}
if(signals.groupCoordination){indicators.push('group_coordination');}
if(signals.weaponsMentioned){indicators.push('weapons_mentioned');}
if(signals.priorHateSpeech){indicators.push('prior_hate_speech');}
if(signals.locationDisclosed&&signals.explicitThreats){indicators.push('location_with_threat');}
const urgency:HateCrimeRiskResult['urgency']=signals.weaponsMentioned||signals.groupCoordination?'critical':signals.explicitThreats?'high':indicators.length>0?'low':'none';
if(urgency!=='none')writeAuditLog('lgbtq.hate_crime_risk',{indicators,urgency}).catch(()=>{});
return{riskDetected:indicators.length>0,indicators,urgency,action:urgency==='critical'?'alert_safety':urgency==='high'?'block':urgency==='low'?'warn':'none'};}
export const hateCrimeRisk=detectHateCrimeRisk;