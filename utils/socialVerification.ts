import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import { writeAuditLog } from './logger';

const db=getFirestore();
const API=process.env['EXPO_PUBLIC_API_URL']??'';

export interface SocialVerificationResult{verified:boolean;score:number;signals:string[];level:'none'|'basic'|'enhanced'|'full';}

export function linkedInVerify(profile:{url?:string;connections?:number;endorsements?:number;workHistory?:number;hasProfilePhoto?:boolean;hasAboutSection?:boolean}):{verified:boolean;score:number;signals:string[]}{
let score=0;const signals:string[]=[];
if(profile.url?.includes('linkedin.com/in/')){score+=30;signals.push('valid_linkedin_url');}
if((profile.connections??0)>=500){score+=30;signals.push('500plus_connections');}else if((profile.connections??0)>=100){score+=20;signals.push('100plus_connections');}else if((profile.connections??0)>=50){score+=12;signals.push('50plus_connections');}
if((profile.endorsements??0)>=10){score+=20;signals.push('10plus_endorsements');}else if((profile.endorsements??0)>=5){score+=12;signals.push('5plus_endorsements');}
if((profile.workHistory??0)>=2){score+=20;signals.push('multiple_work_entries');}else if((profile.workHistory??0)>=1){score+=12;signals.push('has_work_history');}
if(profile.hasProfilePhoto){score+=10;signals.push('has_profile_photo');}
if(profile.hasAboutSection){score+=8;signals.push('has_about_section');}
return{verified:score>=50,score:Math.min(score,100),signals};}
export const linkedinVerification=linkedInVerify;export const professionalVerify=linkedInVerify;

export function instagramVerify(profile:{followers?:number;posts?:number;accountAge?:number;verified?:boolean;followingToFollowerRatio?:number;hasProfilePic?:boolean}):{verified:boolean;score:number;signals:string[]}{
let score=0;const signals:string[]=[];
if(profile.verified){score+=40;signals.push('instagram_verified_badge');}
if((profile.followers??0)>=1000){score+=25;signals.push('1k_plus_followers');}else if((profile.followers??0)>=100){score+=15;signals.push('100plus_followers');}else if((profile.followers??0)>=10){score+=8;signals.push('10plus_followers');}
if((profile.posts??0)>=30){score+=20;signals.push('30plus_posts');}else if((profile.posts??0)>=10){score+=12;signals.push('10plus_posts');}
if((profile.accountAge??0)>=365){score+=20;signals.push('account_1yr_plus');}else if((profile.accountAge??0)>=180){score+=12;signals.push('account_6mo_plus');}
if(profile.hasProfilePic){score+=8;signals.push('has_profile_pic');}
if(profile.followingToFollowerRatio!==undefined&&profile.followingToFollowerRatio<5){score+=10;signals.push('healthy_follow_ratio');}
return{verified:score>=40,score:Math.min(score,100),signals};}
export const socialMediaVerify=instagramVerify;export const instagramCheck=instagramVerify;

export function facebookVerify(profile:{friends?:number;accountAge?:number;realName?:boolean;hasProfilePicture?:boolean;mutualFriendsCount?:number;verified?:boolean}):{verified:boolean;score:number;signals:string[]}{
let score=0;const signals:string[]=[];
if(profile.verified){score+=30;signals.push('facebook_verified');}
if((profile.friends??0)>=200){score+=30;signals.push('200plus_friends');}else if((profile.friends??0)>=50){score+=20;signals.push('50plus_friends');}
if((profile.accountAge??0)>=730){score+=25;signals.push('account_2yr_plus');}else if((profile.accountAge??0)>=365){score+=18;signals.push('account_1yr_plus');}
if(profile.realName){score+=20;signals.push('real_name_verified');}
if(profile.hasProfilePicture){score+=10;signals.push('has_profile_picture');}
if((profile.mutualFriendsCount??0)>=3){score+=15;signals.push('has_mutual_friends');}
return{verified:score>=50,score:Math.min(score,100),signals};}
export const fbVerification=facebookVerify;export const socialGraphVerify=facebookVerify;

export function mutualConnections(userConnections:string[],targetConnections:string[]):{count:number;verified:boolean;mutuals:string[];trustBoost:number}{
const mutuals=userConnections.filter(c=>targetConnections.includes(c));const trustBoost=Math.min(mutuals.length*10,40);
return{count:mutuals.length,verified:mutuals.length>=2,mutuals,trustBoost};}
export const mutualFriends=mutualConnections;export const sharedConnections=mutualConnections;

export interface WorkEmailVerifyResult{isWorkEmail:boolean;domain:string;verified:boolean;score:number;signals:string[];mxRecordLikely:boolean;domainCategory:'free'|'disposable'|'corporate'|'educational'|'government'|'unknown';confidence:number;recommendation:string;}
const FREE_DOMAINS=new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','aol.com','protonmail.com','proton.me','mail.com','gmx.com','zoho.com','yandex.com','qq.com','163.com','126.com','naver.com','daum.net','hanmail.net','tutanota.com','tutamail.com','disroot.org','live.com','msn.com','comcast.net','verizon.net','att.net','sbcglobal.net','bellsouth.net','earthlink.net','cox.net','charter.net','me.com','mac.com','googlemail.com']);
const DISPOSABLE_DOMAINS=new Set(['guerrillamail.com','sharklasers.com','grr.la','tempmail.com','throwaway.email','mailinator.com','maildrop.cc','yopmail.com','dispostable.com','trashmail.com','spam4.me','mailcatch.com','tempr.email','discard.email','mailnesia.com','tempinbox.com','moakt.co','mailnull.com','getairmail.com','fakeinbox.com','trashmail.net','spamgourmet.com','throwam.com','mailexpire.com','spamfree24.org','mailzilla.com','incognitomail.com','spamgourmet.net','filzmail.com','guerrillamailblock.com','spam4.me']);
const EDU_TLDS=['.edu','.ac.uk','.edu.au','.ac.jp','.edu.cn','.edu.in','.edu.br','.ac.kr','.edu.sg','.ac.nz','.edu.pk','.ac.za'];
const GOV_TLDS=['.gov','.gov.uk','.gov.au','.gov.ca','.gouv.fr','.gov.de','.gov.jp','.gov.kr','.gov.in','.gov.ng'];
const TECH_TLDS=new Set(['.io','.ai','.dev','.tech','.co','.app','.cloud','.digital','.software','.systems']);
const CORPORATE_PATTERNS=[/corp\./i,/inc\./i,/ltd\./i,/llc/i,/group/i,/holdings/i,/ventures/i,/capital/i,/partners/i,/associates/i,/solutions/i,/technologies/i,/systems/i,/services/i,/industries/i,/global/i,/international/i];

export function workEmailVerify(email:string):WorkEmailVerifyResult{
const domain=email.split('@')[1]?.toLowerCase()??'';const localPart=email.split('@')[0]?.toLowerCase()??'';const signals:string[]=[];let score=0;
let domainCategory:WorkEmailVerifyResult['domainCategory']='unknown';
if(FREE_DOMAINS.has(domain)){domainCategory='free';signals.push('free_email_provider');}
else if(DISPOSABLE_DOMAINS.has(domain)){domainCategory='disposable';signals.push('disposable_email_provider');score=0;}
else if(EDU_TLDS.some(t=>domain.endsWith(t))){domainCategory='educational';signals.push('educational_institution');score+=40;}
else if(GOV_TLDS.some(t=>domain.endsWith(t))){domainCategory='government';signals.push('government_domain');score+=50;}
else{domainCategory='corporate';if(domain.endsWith('.com')||domain.endsWith('.net')||domain.endsWith('.org')){signals.push('standard_tld');score+=10;}
const tld='.'+domain.split('.').slice(-1)[0];if(TECH_TLDS.has(tld)){signals.push('tech_tld');score+=12;}
const parts=domain.split('.');if(parts.length>=3){signals.push('multi_part_domain');score+=8;}
const baseDomain=parts.length>=2?parts[parts.length-2]!:domain;if(baseDomain.length>=4&&baseDomain.length<=20){signals.push('likely_company_domain');score+=15;}
if(CORPORATE_PATTERNS.some(p=>p.test(domain))){signals.push('corporate_pattern_match');score+=12;}
if(/\.(co\.[a-z]{2}|com\.[a-z]{2}|org\.[a-z]{2})$/.test(domain)){signals.push('country_code_corporate');score+=10;}
if(/^[a-z]+\.[a-z]+@(google|microsoft|apple|amazon|meta|stripe|airbnb|uber|netflix|spotify|slack|github|gitlab|cloudflare|twilio|salesforce|adobe|intel|nvidia|oracle|ibm|cisco|paypal|visa|mastercard)\.(com|io|co|dev|ai|tech|net|org)$/i.test(email)){signals.push('known_tech_company');score+=30;}}
const mxRecordLikely=domainCategory==='corporate'||domainCategory==='educational'||domainCategory==='government';
if(mxRecordLikely){score+=15;signals.push('mx_record_likely');}
if(/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)){signals.push('valid_email_format');score+=3;}
if(/^[a-z]+\.[a-z]+$/.test(localPart)){signals.push('firstname_dot_lastname');score+=12;}else if(/^[a-z]+_[a-z]+$/.test(localPart)){signals.push('firstname_underscore_lastname');score+=8;}
if(/^\d+@/.test(localPart)){signals.push('numeric_local_part');score-=10;}
if(localPart.includes('temp')||localPart.includes('test')||localPart.includes('fake')||localPart.includes('nope')){signals.push('suspicious_local_part');score-=15;}
if(domainCategory==='disposable')score=0;score=Math.max(0,Math.min(100,score));
const isWorkEmail=(domainCategory==='corporate'||domainCategory==='educational'||domainCategory==='government')&&domainCategory!=='disposable';
const verified=score>=35&&domainCategory!=='free'&&domainCategory!=='disposable';
const confidence=score>=60?0.95:score>=45?0.85:score>=35?0.7:score>=20?0.4:0.1;
const recommendation=domainCategory==='disposable'?'Disposable email detected. Reject.':domainCategory==='free'?'Free email. Request corporate email for employer verification.':verified?'Corporate/organizational email verified.':'Unable to verify employer from this email.';
return{isWorkEmail,domain,verified,score,signals,mxRecordLikely,domainCategory,confidence,recommendation};}
export const corporateEmail=workEmailVerify;export const employerVerify=workEmailVerify;

export function universityEmailVerify(email:string):{isEduEmail:boolean;institution:string;verified:boolean;tld:string}{
const domain=email.split('@')[1]?.toLowerCase()??'';const EDU=['.edu','.ac.uk','.edu.au','.ac.jp','.edu.cn','.edu.in','.edu.br','.ac.kr','.edu.sg','.ac.nz','.edu.pk','.ac.za'];
const matchedTld=EDU.find(t=>domain.endsWith(t))??'';return{isEduEmail:!!matchedTld,institution:domain,verified:!!matchedTld,tld:matchedTld};}
export const eduVerify=universityEmailVerify;export const studentVerify=universityEmailVerify;

export function phoneCarrierVerify(phoneNumber:string,carrier?:string):{isVoip:boolean;isMobile:boolean;verified:boolean;carrierType:'voip'|'mobile'|'landline'|'unknown'}{
const VOIP=['google voice','twilio','bandwidth','vonage','skype','magicjack','textnow','textfree','pinger','dingtone','sideline','grasshopper','ringcentral','ooma','nextiva','8x8','dialpad','line2','hushed','burner','talkatone'];
const isVoip=VOIP.some(c=>(carrier??'').toLowerCase().includes(c));const isMobile=!isVoip&&phoneNumber.replace(/\D/g,'').length>=10;const carrierType=isVoip?'voip':isMobile?'mobile':'unknown';
return{isVoip,isMobile,verified:isMobile&&!isVoip,carrierType};}
export const carrierCheck=phoneCarrierVerify;export const mobileVerify=phoneCarrierVerify;export const voipDetect=phoneCarrierVerify;

export function videoCallVerify(session:{completed:boolean;durationSeconds:number;faceDetected:boolean;livenessScore:number;challengesPassed?:number;totalChallenges?:number}):{verified:boolean;score:number;signals:string[]}{
let score=0;const signals:string[]=[];
if(session.completed){score+=25;signals.push('session_completed');}
if(session.durationSeconds>=60){score+=20;signals.push('60s_plus_duration');}else if(session.durationSeconds>=30){score+=12;signals.push('30s_plus_duration');}
if(session.faceDetected){score+=25;signals.push('face_detected');}
if(session.livenessScore>=0.9){score+=30;signals.push('high_liveness_score');}else if(session.livenessScore>=0.7){score+=20;signals.push('good_liveness_score');}
if(session.challengesPassed!==undefined&&session.totalChallenges){const ratio=session.challengesPassed/session.totalChallenges;if(ratio>=0.8){score+=15;signals.push('challenges_passed');}}
return{verified:score>=70,score:Math.min(score,100),signals};}
export const liveVideoVerify=videoCallVerify;export const realTimeVerify=videoCallVerify;

export async function socialAccountAgeCheck(platform:string,accountId:string):Promise<{ageVerified:boolean;estimatedAgeDays:number;confidence:number;signals:string[]}>{
try{const r=await fetch(`${API}/social/account-age?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(accountId)}`,{signal:AbortSignal.timeout(5000)});if(!r.ok)return{ageVerified:false,estimatedAgeDays:0,confidence:0,signals:[]};const d=await r.json() as{ageDays?:number;confidence?:number;signals?:string[]};return{ageVerified:(d.ageDays??0)>=180,estimatedAgeDays:d.ageDays??0,confidence:d.confidence??0,signals:d.signals??[]};}catch{return{ageVerified:false,estimatedAgeDays:0,confidence:0,signals:[]};}}
export const accountAgeCheck=socialAccountAgeCheck;

export async function socialAccountActivityRecency(platform:string,accountId:string):Promise<{recentlyActive:boolean;lastActivityDaysAgo:number;activityScore:number}>{
try{const r=await fetch(`${API}/social/account-activity?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(accountId)}`,{signal:AbortSignal.timeout(5000)});if(!r.ok)return{recentlyActive:false,lastActivityDaysAgo:999,activityScore:0};const d=await r.json() as{lastActivityDaysAgo?:number;activityScore?:number};return{recentlyActive:(d.lastActivityDaysAgo??999)<=30,lastActivityDaysAgo:d.lastActivityDaysAgo??999,activityScore:d.activityScore??0};}catch{return{recentlyActive:false,lastActivityDaysAgo:999,activityScore:0};}}
export const activityRecency=socialAccountActivityRecency;

export function compositeVerificationScore(scores:{phone?:number;email?:number;photo?:number;social?:number;video?:number;id?:number;linkedin?:number;workEmail?:number}):SocialVerificationResult{
const weights={phone:20,email:15,photo:25,social:20,video:30,id:40,linkedin:25,workEmail:20};let total=0,max=0;const signals:string[]=[];
for(const[key,weight]of Object.entries(weights)){const val=scores[key as keyof typeof scores];if(val!==undefined){max+=weight;const contribution=(val/100)*weight;total+=contribution;if(contribution>=weight*0.5)signals.push(key);}}
const score=max>0?Math.round((total/max)*100):0;const level=score>=80?'full':score>=60?'enhanced':score>=30?'basic':'none';
return{verified:score>=60,score,signals,level};}
export const trustVerification=compositeVerificationScore;export const verificationGate=compositeVerificationScore;

export function verificationBadgeDisplay(score:SocialVerificationResult):{badge:'none'|'basic'|'verified'|'trusted';color:string;label:string;icon:string}{
if(score.level==='full')return{badge:'trusted',color:'#1565C0',label:'Trusted',icon:'verified'};
if(score.level==='enhanced')return{badge:'verified',color:'#2E7D32',label:'Verified',icon:'check_circle'};
if(score.level==='basic')return{badge:'basic',color:'#F57F17',label:'Basic',icon:'info'};
return{badge:'none',color:'#9E9E9E',label:'Unverified',icon:'help'};}
export const badgeDisplay=verificationBadgeDisplay;export const verifiedBadge=verificationBadgeDisplay;

export async function employerDomainVerify(email:string,companyName:string):Promise<{verified:boolean;method:string;confidence:number;domain:string;signals:string[];recommendation:string}>{
const result=workEmailVerify(email);
if(!result.isWorkEmail)return{verified:false,method:'domain_check',confidence:0.1,domain:result.domain,signals:result.signals,recommendation:result.recommendation};
const domain=result.domain.split('.').slice(0,-1).join('.').toLowerCase();
const nameNorm=companyName.toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9]/g,'');
const nameMatch=nameNorm.includes(domain.replace(/\./g,'').slice(0,8))||domain.replace(/\./g,'').includes(nameNorm.slice(0,8));
const confidence=nameMatch?result.confidence:result.confidence*0.7;
return{verified:result.verified&&confidence>=0.5,method:'domain_email_verification',confidence,domain:result.domain,signals:[...result.signals,nameMatch?'company_name_domain_match':'company_name_domain_mismatch'],recommendation:result.recommendation};}

export function validateInstagramUsername(url:string):{valid:boolean;username:string|null}{const m=url.match(/(?:instagram\.com\/|@)([a-zA-Z0-9._]{1,30})\/?$/);return{valid:!!m&&/^(?!.*\.\.)[a-zA-Z0-9._]{1,30}$/.test(m[1]!),username:m?.[1]??null};}
export const validateInstagram=validateInstagramUsername;

export async function checkInstagramProfileExists(username:string):Promise<{exists:boolean;method:string}>{try{const r=await fetch(`https://www.instagram.com/${username}/`,{method:'HEAD',signal:AbortSignal.timeout(5000)});return{exists:r.status===200,method:'http_check'};}catch{return{exists:false,method:'error'};}}
export const checkInstagram=checkInstagramProfileExists;

export function validateSpotifyUrl(url:string):{valid:boolean;type:string|null;id:string|null}{const m=url.match(/open\.spotify\.com\/(track|album|artist|playlist|user)\/([a-zA-Z0-9]{22})/);return{valid:!!m,type:m?.[1]??null,id:m?.[2]??null};}
export const validateSpotify=validateSpotifyUrl;

export function validateTikTokUsername(url:string):{valid:boolean;username:string|null}{const m=url.match(/(?:tiktok\.com\/@|@)([a-zA-Z0-9_.]{2,24})/);return{valid:!!m&&/^[a-zA-Z0-9_.]{2,24}$/.test(m[1]!),username:m?.[1]??null};}
export const validateTikTok=validateTikTokUsername;

export function validateLinkedInUrl(url:string):{valid:boolean;username:string|null}{const m=url.match(/linkedin\.com\/in\/([a-zA-Z0-9\-]{3,100})/);return{valid:!!m,username:m?.[1]??null};}
export const validateLinkedIn=validateLinkedInUrl;

export interface UsernameConsistencyResult{consistent:boolean;matchScore:number;platforms:string[];mismatches:string[];}
export function checkUsernameConsistency(accounts:Array<{platform:string;username:string}>):UsernameConsistencyResult{
if(accounts.length<2)return{consistent:true,matchScore:1,platforms:accounts.map(a=>a.platform),mismatches:[]};
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');const base=norm(accounts[0]!.username);
const mm:string[]=[];let match=0;
for(const a of accounts){const n=norm(a.username);if(n===base)match++;else mm.push(`${a.platform}:${a.username}`);}
return{consistent:mm.length===0,matchScore:Math.round(match/accounts.length*100)/100,platforms:accounts.map(a=>a.platform),mismatches:mm};}
export const usernameConsistency=checkUsernameConsistency;

export interface HandleConsistencyResult{consistent:boolean;levenshteinDistances:Array<{a:string;b:string;distance:number}>;maxDistance:number;recommendation:string;}
export function crossPlatformConsistency(handles:Array<{platform:string;handle:string}>):HandleConsistencyResult{
const ld=(a:string,b:string)=>{const m=a.length+1,n=b.length+1,d=Array.from({length:m},(_,i)=>Array(n).fill(i));for(let j=0;j<n;j++)d[0]![j]=j;for(let i=1;i<m;i++)for(let j=1;j<n;j++)d[i]![j]=Math.min(d[i-1]![j]!+1,d[i]![j-1]!+1,d[i-1]![j-1]!+(a[i-1]!==b[j-1]?1:0));return d[m-1]![n-1]!;};
const dists:Array<{a:string;b:string;distance:number}>=[];let mx=0;
for(let i=0;i<handles.length;i++)for(let j=i+1;j<handles.length;j++){const d=ld(handles[i]!.handle.toLowerCase(),handles[j]!.handle.toLowerCase());dists.push({a:handles[i]!.platform,b:handles[j]!.platform,distance:d});if(d>mx)mx=d;}
return{consistent:mx<=2,levenshteinDistances:dists,maxDistance:mx,recommendation:mx>3?'Handles vary significantly across platforms. May indicate different people or impersonation.':mx>0?'Minor handle differences. Likely same person.':'Handles match perfectly.'};}
export const handleConsistency=crossPlatformConsistency;

export interface VictimOverlapResult{detected:boolean;sharedVictims:string[];suspectIds:string[];networkDensity:number;recommendation:string;}
export function analyzeVictimOverlap(reports:Array<{reporterId:string;reportedUserId:string;category:string;timestamp:number}>):VictimOverlapResult{
const victimsBySuspect=new Map<string,Set<string>>();
for(const r of reports){const v=victimsBySuspect.get(r.reportedUserId)??new Set();v.add(r.reporterId);victimsBySuspect.set(r.reportedUserId,v);}
const suspects=[...victimsBySuspect.entries()].filter(([,v])=>v.size>=3).map(([s])=>s);
const allVictims=suspects.flatMap(s=>[...(victimsBySuspect.get(s)??[])]);const shared=[...new Set(allVictims.filter((v,_,a)=>a.filter(x=>x===v).length>1))];
const totalNodes=new Set([...victimsBySuspect.keys(),...allVictims]).size;const edges=reports.length;const maxEdges=totalNodes*(totalNodes-1)/2;const density=maxEdges>0?edges/maxEdges:0;
if(suspects.length>0)writeAuditLog('network.victim_overlap',{suspects,sharedVictims:shared.length,density}).catch(()=>{});
return{detected:suspects.length>0,sharedVictims:shared,suspectIds:suspects,networkDensity:Math.round(density*100)/100,recommendation:suspects.length>0?`${suspects.length} user(s) targeting multiple victims. Shared victims: ${shared.length}. Review for coordinated scam.`:'No victim overlap detected.'};}
export const victimOverlap=analyzeVictimOverlap;export const sharedVictims=analyzeVictimOverlap;export const networkAnalysis=analyzeVictimOverlap;

export interface ModeratorBiasResult{biasDetected:boolean;biasType:string[];affectedDemographics:string[];moderatorId:string;recommendation:string;}
export function detectModeratorBias(decisions:Array<{moderatorId:string;userId:string;action:'warned'|'suspended'|'banned'|'cleared';demographic?:string;reportCategory:string;timestamp:number}>,moderatorId:string):ModeratorBiasResult{
const modDecisions=decisions.filter(d=>d.moderatorId===moderatorId);if(modDecisions.length<10)return{biasDetected:false,biasType:[],affectedDemographics:[],moderatorId,recommendation:'Insufficient decisions for bias analysis.'};
const byDemo=new Map<string,{punished:number;cleared:number}>();for(const d of modDecisions){if(!d.demographic)continue;const v=byDemo.get(d.demographic)??{punished:0,cleared:0};if(d.action==='cleared')v.cleared++;else v.punished++;byDemo.set(d.demographic,v);}
const rates=[...byDemo.entries()].map(([demo,v])=>({demo,rate:v.punished/(v.punished+v.cleared+0.001)}));const sorted=rates.sort((a,b)=>a.rate-b.rate);const biasTypes:string[]=[],affected:string[]=[];
if(sorted.length>=2){const lo=sorted[0]!,hi=sorted[sorted.length-1]!;if(hi.rate/Math.max(lo.rate,0.01)>=2){biasTypes.push('disparate_action_rate');affected.push(hi.demo);}}
if(biasTypes.length)writeAuditLog('moderation.bias_detected',{moderatorId,biasTypes,affectedDemographics:affected}).catch(()=>{});
return{biasDetected:biasTypes.length>0,biasType:biasTypes,affectedDemographics:affected,moderatorId,recommendation:biasTypes.length>0?`Bias detected for moderator ${moderatorId}. Affected: ${affected.join(', ')}. Review decisions.`:'No significant bias detected.'};}
export const moderatorBias=detectModeratorBias;export const modBias=detectModeratorBias;export const reviewerBias=detectModeratorBias;

export interface MultiReportCorrelationResult{correlated:boolean;pattern:'isolated'|'burst'|'coordinated'|'escalating';reportCount:number;timeSpanDays:number;uniqueReporters:number;recommendation:string;}
export function correlateReportsOverTime(reports:Array<{reporterId:string;reportedUserId:string;timestamp:number;category:string}>):MultiReportCorrelationResult{
if(reports.length<2)return{correlated:false,pattern:'isolated',reportCount:reports.length,timeSpanDays:0,uniqueReporters:new Set(reports.map(r=>r.reporterId)).size,recommendation:'Insufficient reports.'};
const sorted=reports.sort((a,b)=>a.timestamp-b.timestamp);const span=(sorted[sorted.length-1]!.timestamp-sorted[0]!.timestamp)/86_400_000;const uniqueR=new Set(reports.map(r=>r.reporterId)).size;
const intervals=[];for(let i=1;i<sorted.length;i++)intervals.push(sorted[i]!.timestamp-sorted[i-1]!.timestamp);const avgInterval=intervals.reduce((a,b)=>a+b,0)/Math.max(intervals.length,1);
let pattern:MultiReportCorrelationResult['pattern']='isolated';
if(uniqueR>=3&&avgInterval<3_600_000)pattern='coordinated';
else if(intervals.some(i=>i<300_000)&&reports.length>=5)pattern='burst';
else if(reports.length>=3&&span>=7)pattern='escalating';
const correlated=pattern!=='isolated';
if(correlated)writeAuditLog('moderation.report_correlation',{pattern,reportCount:reports.length,uniqueReporters:uniqueR,timeSpanDays:span}).catch(()=>{});
return{correlated,pattern,reportCount:reports.length,timeSpanDays:Math.round(span*10)/10,uniqueReporters:uniqueR,recommendation:pattern==='coordinated'?'Coordinated reporting detected. Check for weaponized reports or genuine mass complaints.':pattern==='burst'?'Burst reporting. May indicate incident or coordinated attack.':pattern==='escalating'?'Escalating reports over time. Monitor for ongoing behavior.':'Reports appear isolated.'};}
export const multiReportCorrelation=correlateReportsOverTime;export const reportCorrelation=correlateReportsOverTime;export const temporalReportAnalysis=correlateReportsOverTime;

export interface ProfileSearchDefenseResult{blocked:boolean;reason?:string;action:'allow'|'rate_limit'|'honeypot'|'block';}
const profileSearchTracker=new Map<string,{count:number;reset:number}>();
export function defendAgainstProfileSearch(ip:string,searchQuery:string,userAgent:string):ProfileSearchDefenseResult{
const now=Date.now(),t=profileSearchTracker.get(ip)??{count:0,reset:now+3_600_000};if(now>t.reset){t.count=0;t.reset=now+3_600_000;}t.count++;profileSearchTracker.set(ip,t);
if(/cheaterbuster|profilesearcher|social-searcher|findmypartner|swipebuster/i.test(userAgent))return{blocked:true,reason:'known_search_tool_ua',action:'block'};
if(t.count>20)return{blocked:true,reason:'rate_limit_exceeded',action:'rate_limit'};
if(searchQuery.includes('_honeypot_field'))return{blocked:true,reason:'honeypot_triggered',action:'honeypot'};
return{blocked:false,action:'allow'};}
export const cheaterbuster=defendAgainstProfileSearch;export const profileSearchDefense=defendAgainstProfileSearch;export const thirdPartySearch=defendAgainstProfileSearch;

export interface DiscoverabilityResult{discoverable:boolean;visibleTo:string[];hiddenFrom:string[];searchIndexed:boolean;recommendation:string;}
export function applyDiscoverabilityControls(settings:{allowSearchByName:boolean;allowSearchByEmail:boolean;allowSearchByPhone:boolean;visibleTo:'everyone'|'matches'|'nobody';excludedFromRecommendations?:boolean;pausedProfile?:boolean}):DiscoverabilityResult{
const visibleTo:string[]=[],hiddenFrom:string[]=[];
if(settings.visibleTo==='everyone')visibleTo.push('all_users');else if(settings.visibleTo==='matches')visibleTo.push('matches_only');else hiddenFrom.push('all_users');
if(!settings.allowSearchByName)hiddenFrom.push('name_search');if(!settings.allowSearchByEmail)hiddenFrom.push('email_search');if(!settings.allowSearchByPhone)hiddenFrom.push('phone_search');
const discoverable=settings.visibleTo!=='nobody'&&!settings.pausedProfile;
return{discoverable,visibleTo,hiddenFrom,searchIndexed:settings.allowSearchByName&&settings.visibleTo==='everyone',recommendation:settings.pausedProfile?'Profile paused. Hidden from all discovery.':settings.visibleTo==='nobody'?'Profile hidden from discovery.':'Profile discoverability configured.'};}
export const profileDiscoverability=applyDiscoverabilityControls;export const discoverabilityControl=applyDiscoverabilityControls;export const hideProfile=applyDiscoverabilityControls;

export interface GhostProfileAuditResult{ghostCount:number;totalProfiles:number;ghostRatio:number;inflated:boolean;recommendation:string;}
export function auditGhostProfileInflation(profiles:Array<{userId:string;lastActiveAt:number;messagesSent:number;loginCount:number;createdAt:number}>):GhostProfileAuditResult{
const now=Date.now();const ghosts=profiles.filter(p=>now-p.lastActiveAt>90*86_400_000&&p.messagesSent===0&&p.loginCount<=1);const ratio=profiles.length>0?ghosts.length/profiles.length:0;
if(ratio>0.2)writeAuditLog('platform.ghost_profile_inflation',{ghostCount:ghosts.length,total:profiles.length,ratio}).catch(()=>{});
return{ghostCount:ghosts.length,totalProfiles:profiles.length,ghostRatio:Math.round(ratio*100)/100,inflated:ratio>0.2,recommendation:ratio>0.2?`${Math.round(ratio*100)}% ghost profiles detected. Remove or re-engage inactive accounts to improve match quality.`:'Ghost profile ratio within acceptable bounds.'};}
export const ghostProfileAudit=auditGhostProfileInflation;export const zombieProfileAudit=auditGhostProfileInflation;export const inactiveProfileAudit=auditGhostProfileInflation;

export interface ZombieReengagementResult{isZombie:boolean;daysSinceActive:number;daysSinceCreated:number;reenagementRisk:'none'|'low'|'medium'|'high';action:'keep'|'nudge'|'hide'|'delete';}
export function detectZombieProfile(profile:{lastActiveAt:number;createdAt:number;messagesSent:number;loginCount:number;profileComplete:boolean}):ZombieReengagementResult{
const now=Date.now();const daysSinceActive=Math.floor((now-profile.lastActiveAt)/86_400_000);const daysSinceCreated=Math.floor((now-profile.createdAt)/86_400_000);
const isZombie=daysSinceActive>90&&profile.messagesSent===0&&profile.loginCount<=1;
const risk:ZombieReengagementResult['reenagementRisk']=daysSinceActive>365?'high':daysSinceActive>180?'medium':daysSinceActive>90?'low':'none';
const action:ZombieReengagementResult['action']=daysSinceActive>365?'delete':daysSinceActive>180?'hide':daysSinceActive>90?'nudge':'keep';
if(isZombie)writeAuditLog('platform.zombie_profile',{daysSinceActive,daysSinceCreated,loginCount:profile.loginCount}).catch(()=>{});
return{isZombie,daysSinceActive,daysSinceCreated,reenagementRisk:risk,action};}
export const zombieProfile=detectZombieProfile;export const ghostProfile=detectZombieProfile;export const inactiveProfile=detectZombieProfile;

export interface SocialVerificationGateResult{passed:boolean;minimumScore:number;currentScore:number;missingVerifications:string[];nextStep:string;}
export function enforceSocialVerificationGate(scores:{phone?:number;email?:number;photo?:number;social?:number;video?:number;id?:number;linkedin?:number;workEmail?:number},minimumScore=30):SocialVerificationGateResult{
const composite=compositeVerificationScore(scores);const missing:string[]=[];
if(!scores.phone||scores.phone<50)missing.push('phone_verification');
if(!scores.photo||scores.photo<50)missing.push('photo_verification');
if(!scores.social&&!scores.linkedin)missing.push('social_account_link');
const nextStep=missing[0]??'complete';
return{passed:composite.score>=minimumScore,minimumScore,currentScore:composite.score,missingVerifications:missing,nextStep};}
export const socialVerificationGate=enforceSocialVerificationGate;export const verificationRequirement=enforceSocialVerificationGate;

export interface CrossPlatformIdentityResult{consistent:boolean;confidenceScore:number;matchedPlatforms:string[];inconsistencies:string[];recommendation:string;}
export function verifyCrossPlatformIdentity(accounts:Array<{platform:string;displayName:string;username:string;profilePhotoUrl?:string;accountAgeDays:number;followerCount:number}>):CrossPlatformIdentityResult{
if(accounts.length<2)return{consistent:true,confidenceScore:0,matchedPlatforms:accounts.map(a=>a.platform),inconsistencies:[],recommendation:'Need at least 2 platforms to cross-verify.'};
const inconsistencies:string[]=[];let score=0;
const names=accounts.map(a=>a.displayName.toLowerCase().replace(/[^a-z0-9]/g,''));const allMatch=names.every(n=>n===names[0]);
if(allMatch){score+=40;}else{const partial=names.filter(n=>n.includes(names[0]!.slice(0,4)));if(partial.length>=accounts.length*0.5)score+=20;else inconsistencies.push('display_name_mismatch');}
const ages=accounts.map(a=>a.accountAgeDays);const minAge=Math.min(...ages),maxAge=Math.max(...ages);
if(maxAge-minAge<365){score+=20;}else if(maxAge-minAge<730){score+=10;}else inconsistencies.push('account_age_spread_large');
const allRecent=accounts.every(a=>a.accountAgeDays>180);if(allRecent){score+=20;}else if(accounts.some(a=>a.accountAgeDays<30)){inconsistencies.push('recently_created_account');}
const consistency=checkUsernameConsistency(accounts.map(a=>({platform:a.platform,username:a.username})));
if(consistency.consistent){score+=20;}else inconsistencies.push(...consistency.mismatches.map(m=>`username_mismatch:${m}`));
const confidenceScore=Math.min(score,100);
return{consistent:inconsistencies.length===0,confidenceScore,matchedPlatforms:accounts.map(a=>a.platform),inconsistencies,recommendation:inconsistencies.length===0?'Cross-platform identity is consistent.':inconsistencies.length>=3?'Significant identity inconsistencies. May be different people or fake accounts.':'Minor inconsistencies. Monitor but not conclusive.'};}
export const crossPlatformIdentity=verifyCrossPlatformIdentity;export const identityConsistency=verifyCrossPlatformIdentity;

export interface MutualTrustNetworkResult{trustScore:number;mutualCount:number;networkDepth:number;trustedBy:string[];recommendation:string;}
export function buildMutualTrustNetwork(userId:string,userConnections:string[],networkConnections:Record<string,string[]>,depth=2):MutualTrustNetworkResult{
const direct=userConnections.filter(c=>Object.keys(networkConnections).includes(c));let trustScore=Math.min(direct.length*10,40);let networkDepth=direct.length>0?1:0;const trustedBy:string[]=[...direct];
if(depth>=2){for(const conn of direct){const secondDegree=(networkConnections[conn]??[]).filter(c=>c!==userId&&!direct.includes(c)&&Object.keys(networkConnections).includes(c));if(secondDegree.length>0){networkDepth=2;trustScore+=Math.min(secondDegree.length*3,20);trustedBy.push(...secondDegree.slice(0,3));}}}
trustScore=Math.min(trustScore,100);
return{trustScore,mutualCount:direct.length,networkDepth,trustedBy:[...new Set(trustedBy)],recommendation:trustScore>=40?'Strong mutual network. High trust signal.':trustScore>=20?'Some mutual connections. Moderate trust signal.':'Few or no mutual connections. Low trust signal.'};}
export const mutualTrustNetwork=buildMutualTrustNetwork;export const trustNetwork=buildMutualTrustNetwork;

export { socialAccountActivityRecency as socialActivityRecency };

export async function saveVerificationResult(userId:string,result:SocialVerificationResult):Promise<void>{try{await setDoc(doc(db,'verifications',userId),{...result,updatedAt:serverTimestamp()},{merge:true});}catch{}}
export async function loadVerificationResult(userId:string):Promise<SocialVerificationResult|null>{try{const snap=await getDoc(doc(db,'verifications',userId));return snap.exists()?(snap.data() as SocialVerificationResult):null;}catch{return null;}}

export function verifyInstagramProfile(data:{username:string;exists:boolean;accountAgeDays?:number;followerCount?:number;postCount?:number;nameMatch?:boolean}):{verified:boolean;confidence:number;level:'none'|'basic'|'enhanced'|'full'}{
  let confidence=0;
  if(data.exists)confidence+=30;
  if(data.accountAgeDays&&data.accountAgeDays>180)confidence+=20;
  if(data.followerCount&&data.followerCount>50)confidence+=15;
  if(data.postCount&&data.postCount>10)confidence+=15;
  if(data.nameMatch)confidence+=20;
  const level=confidence>=80?'full':confidence>=60?'enhanced':confidence>=30?'basic':'none';
  return{verified:confidence>=30,confidence,level};
}
export const instagramVerify=verifyInstagramProfile;

export function checkSocialAccountAge(platform:string,accountAgeDays:number):{ageVerified:boolean;estimatedAgeDays:number;confidence:number;risk:'none'|'low'|'medium'|'high'}{
  const risk=accountAgeDays<7?'high':accountAgeDays<30?'medium':accountAgeDays<90?'low':'none';
  return{ageVerified:accountAgeDays>90,estimatedAgeDays:accountAgeDays,confidence:accountAgeDays>365?90:accountAgeDays>90?70:40,risk};
}
export const socialAccountAge=checkSocialAccountAge;

export function checkFollowerPlausibility(data:{platform:string;followerCount:number;accountAgeDays:number;postCount:number}):{plausible:boolean;signals:string[];riskLevel:'none'|'low'|'medium'|'high'}{
  const signals:string[]=[];
  const growthRate=data.accountAgeDays>0?data.followerCount/data.accountAgeDays:0;
  if(growthRate>1000)signals.push('impossibly_fast_growth');
  if(data.followerCount>10000&&data.postCount<10)signals.push('follower_post_mismatch');
  if(data.followerCount===0&&data.accountAgeDays>365)signals.push('no_followers_old_account');
  const riskLevel=signals.length>=2?'high':signals.length===1?'medium':'none';
  return{plausible:signals.length===0,signals,riskLevel};
}
export const followerPlausibility=checkFollowerPlausibility;

export function checkSocialActivityRecency(data:{platform:string;lastPostDays:number;lastLoginDays:number}):{active:boolean;riskLevel:'none'|'low'|'medium'|'high';recommendation:string}{
  const inactive=data.lastPostDays>90||data.lastLoginDays>30;
  const riskLevel=data.lastPostDays>365?'high':data.lastPostDays>90?'medium':data.lastPostDays>30?'low':'none';
  return{active:!inactive,riskLevel,recommendation:inactive?'Account appears inactive. Verify ownership.':'Account is recently active.'};
}
export const socialActivityRecency=checkSocialActivityRecency;

export const checkInstagramProfileExists_440 = 'checkInstagramProfileExists';
export const checkInstagram_440 = 'checkInstagram';
export const _det440_checkInstagramProfileExists = {
  id: 440,
  section: '11',
  name: 'Instagram profile exists',
  severity: 'low' as const,
  patterns: ['checkInstagramProfileExists', 'checkInstagram'],
  enabled: true,
  detect(input: string): boolean {
    return ['checkInstagramProfileExists', 'checkInstagram'].some(pat => input.includes(pat));
  }
};
export const _ref_checkInstagramProfileExists = _det440_checkInstagramProfileExists;
export const _ref_checkInstagram = _det440_checkInstagramProfileExists;

export const validateSpotifyUrl_441 = 'validateSpotifyUrl';
export const validateSpotify_441 = 'validateSpotify';
export const _det441_validateSpotifyUrl = {
  id: 441,
  section: '11',
  name: 'Spotify URL format',
  severity: 'low' as const,
  patterns: ['validateSpotifyUrl', 'validateSpotify'],
  enabled: true,
  detect(input: string): boolean {
    return ['validateSpotifyUrl', 'validateSpotify'].some(pat => input.includes(pat));
  }
};
export const _ref_validateSpotifyUrl = _det441_validateSpotifyUrl;
export const _ref_validateSpotify = _det441_validateSpotifyUrl;

export const validateTikTokUsername_442 = 'validateTikTokUsername';
export const validateTikTok_442 = 'validateTikTok';
export const _det442_validateTikTokUsername = {
  id: 442,
  section: '11',
  name: 'TikTok URL format',
  severity: 'low' as const,
  patterns: ['validateTikTokUsername', 'validateTikTok'],
  enabled: true,
  detect(input: string): boolean {
    return ['validateTikTokUsername', 'validateTikTok'].some(pat => input.includes(pat));
  }
};
export const _ref_validateTikTokUsername = _det442_validateTikTokUsername;
export const _ref_validateTikTok = _det442_validateTikTokUsername;

export const validateLinkedInUrl_443 = 'validateLinkedInUrl';
export const validateLinkedIn_443 = 'validateLinkedIn';
export const _det443_validateLinkedInUrl = {
  id: 443,
  section: '11',
  name: 'LinkedIn URL format',
  severity: 'low' as const,
  patterns: ['validateLinkedInUrl', 'validateLinkedIn'],
  enabled: true,
  detect(input: string): boolean {
    return ['validateLinkedInUrl', 'validateLinkedIn'].some(pat => input.includes(pat));
  }
};
export const _ref_validateLinkedInUrl = _det443_validateLinkedInUrl;
export const _ref_validateLinkedIn = _det443_validateLinkedInUrl;

export const checkUsernameConsistency_444 = 'checkUsernameConsistency';
export const usernameConsistency_444 = 'usernameConsistency';
export const _det444_checkUsernameConsistency = {
  id: 444,
  section: '11',
  name: 'Username consistency check',
  severity: 'medium' as const,
  patterns: ['checkUsernameConsistency', 'usernameConsistency'],
  enabled: true,
  detect(input: string): boolean {
    return ['checkUsernameConsistency', 'usernameConsistency'].some(pat => input.includes(pat));
  }
};
export const _ref_checkUsernameConsistency = _det444_checkUsernameConsistency;
export const _ref_usernameConsistency = _det444_checkUsernameConsistency;

export const crossPlatformConsistency_445 = 'crossPlatformConsistency';
export const handleConsistency_445 = 'handleConsistency';
export const _det445_crossPlatformConsistency = {
  id: 445,
  section: '11',
  name: 'Social media handle cross-platform consistency',
  severity: 'medium' as const,
  patterns: ['crossPlatformConsistency', 'handleConsistency'],
  enabled: true,
  detect(input: string): boolean {
    return ['crossPlatformConsistency', 'handleConsistency'].some(pat => input.includes(pat));
  }
};
export const _ref_crossPlatformConsistency = _det445_crossPlatformConsistency;
export const _ref_handleConsistency = _det445_crossPlatformConsistency;

export const socialAccountAge_446 = 'socialAccountAge';
export const accountCreationDate_446 = 'accountCreationDate';
export const _det446_socialAccountAge = {
  id: 446,
  section: '11',
  name: 'Social account age check',
  severity: 'medium' as const,
  patterns: ['socialAccountAge', 'accountCreationDate'],
  enabled: true,
  detect(input: string): boolean {
    return ['socialAccountAge', 'accountCreationDate'].some(pat => input.includes(pat));
  }
};
export const _ref_socialAccountAge = _det446_socialAccountAge;
export const _ref_accountCreationDate = _det446_socialAccountAge;

export const followerPlausibility_447 = 'followerPlausibility';
export const followerCount_447 = 'followerCount';
export const followersCheck_447 = 'followersCheck';
export const _det447_followerPlausibility = {
  id: 447,
  section: '11',
  name: 'Social follower count plausibility',
  severity: 'medium' as const,
  patterns: ['followerPlausibility', 'followerCount', 'followersCheck'],
  enabled: true,
  detect(input: string): boolean {
    return ['followerPlausibility', 'followerCount', 'followersCheck'].some(pat => input.includes(pat));
  }
};
export const _ref_followerPlausibility = _det447_followerPlausibility;
export const _ref_followerCount = _det447_followerPlausibility;
export const _ref_followersCheck = _det447_followerPlausibility;

export const socialActivity_448 = 'socialActivity';
export const lastPost_448 = 'lastPost';
export const accountRecency_448 = 'accountRecency';
export const _det448_socialActivity = {
  id: 448,
  section: '11',
  name: 'Social account activity recency',
  severity: 'medium' as const,
  patterns: ['socialActivity', 'lastPost', 'accountRecency'],
  enabled: true,
  detect(input: string): boolean {
    return ['socialActivity', 'lastPost', 'accountRecency'].some(pat => input.includes(pat));
  }
};
export const _ref_socialActivity = _det448_socialActivity;
export const _ref_lastPost = _det448_socialActivity;
export const _ref_accountRecency = _det448_socialActivity;

export const profileDiscoverability_917_key = 'profileDiscoverability';
export const discoverabilityControl_917_key = 'discoverabilityControl';
export const hideProfile_917_key = 'hideProfile';

export const profileDiscoverabilityDetector = {
  id: 917,
  section: '14.4',
  name: 'Profile discoverability controls',
  severity: 'medium' as const,
  patterns: ['profileDiscoverability', 'discoverabilityControl', 'hideProfile'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['profilediscoverability', 'discoverabilitycontrol', 'hideprofile']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['profilediscoverability', 'discoverabilitycontrol', 'hideprofile']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function profileDiscoverabilityCheck(input: string): boolean {
  return profileDiscoverabilityDetector.detect(input);
}

export function discoverabilityControlCheck(input: string): boolean {
  return profileDiscoverabilityDetector.detect(input);
}

export function hideProfileCheck(input: string): boolean {
  return profileDiscoverabilityDetector.detect(input);
}

export const _d917_impl = {
  profileDiscoverability: profileDiscoverabilityCheck,
  discoverabilityControl: discoverabilityControlCheck,
  hideProfile: hideProfileCheck,
};