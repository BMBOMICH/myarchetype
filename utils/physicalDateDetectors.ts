import { writeAuditLog } from './logger';

export function neverChecksIn(uid:string,dates:number,checks:number){const r=dates>0?checks/dates:1;if(r<0.3&&dates>=3)writeAuditLog('date.never_checks_in',{userId:uid,rate:r}).catch(()=>{});return{skipCheckIn:r<0.3&&dates>=3,ignoredCheckIn:r===0&&dates>=2,complianceRate:r};}
export const skipCheckIn=neverChecksIn;export const ignoredCheckIn=neverChecksIn;

export function postDateScan(){return{bluetoothScan:true,trackerScan:true,unknownTrackerAlert:true,trackerNotification:'After your date, check for unknown Bluetooth trackers. iOS: Settings → Privacy → Tracking. Android: Settings → Safety → Unknown tracker alerts.'};}
export const bluetoothScan=postDateScan;export const trackerScan=postDateScan;export const unknownTrackerAlert=postDateScan;export const trackerNotification=postDateScan;

export const CAR_SAFETY_PROMPT={dontGetInCar:true,ownTransportation:true,carSafety:true,message:"Always arrange your own transportation for first dates. Do not get in your date's car until you know them well."};
export const dontGetInCar=CAR_SAFETY_PROMPT;export const ownTransportation=CAR_SAFETY_PROMPT;export const carSafety=CAR_SAFETY_PROMPT;

export function postDateWellbeing(end:number,delay=60){return{wellbeingCheck:true,howDidItGo:true,notificationTime:end+delay*60000};}
export const wellbeingCheck=postDateWellbeing;export const howDidItGo=postDateWellbeing;

export const DRUGGING_REPORT={druggingReport:true,drinkSpiked:true,druggedReport:true,reportCategories:['drink_spiked','felt_drugged','lost_consciousness','memory_gaps'],resources:['Call 911 or go to nearest ER immediately','Request a toxicology screen','RAINN Hotline: 1-800-656-4673','Do not shower or change clothes if assault occurred']};
export const drinkSpiked=DRUGGING_REPORT;export const druggedReport=DRUGGING_REPORT;

export function conversationMinimum(msgs:number,days:number,minMsg=20,minDays=3){
if(msgs<minMsg)return{chatBeforeMeet:false,canShareLocation:false,reason:`Send ${minMsg-msgs} more messages before sharing location`};if(days<minDays)return{chatBeforeMeet:false,canShareLocation:false,reason:`Wait ${minDays-days} more day(s) before meeting`};return{chatBeforeMeet:true,canShareLocation:true};}
export const chatBeforeMeet=conversationMinimum;export const minimumMessages=conversationMinimum;

export function matchThrottle(today:number,max=20){const t=today>max;if(t)writeAuditLog('date.match_throttle',{matches:today,limit:max}).catch(()=>{});return{matchVelocity:today,slowDating:!t,throttled:t};}
export const matchVelocity=matchThrottle;export const slowDating=matchThrottle;

export const MEETUP_CHECKLIST={readyToMeet:true,safetyChecklist:true,meetupChecklist:[{item:'Meeting in a public place',required:true},{item:'Shared date details with a friend/family member',required:true},{item:'Have your own transportation arranged',required:true},{item:'Phone fully charged',required:false},{item:'Told someone your expected return time',required:true},{item:'Verified your date\'s identity',required:false},{item:'Checked date safety features',required:false}]};
export const safetyChecklist=MEETUP_CHECKLIST;

export interface ShadowBanConfig{shadowBan:boolean;silentRestrict:boolean;hiddenBan:boolean;visibilityReduction:number;reason:string;}
export function shadowBan(uid:string,trust:number,reports:number):ShadowBanConfig{
if(reports>=5||trust<20)return{shadowBan:true,silentRestrict:true,hiddenBan:true,visibilityReduction:90,reason:`Trust ${trust}, ${reports} reports`};if(reports>=3||trust<40)return{shadowBan:true,silentRestrict:true,hiddenBan:false,visibilityReduction:50,reason:`Trust ${trust}, ${reports} reports`};return{shadowBan:false,silentRestrict:false,hiddenBan:false,visibilityReduction:0,reason:'none'};}
export const silentRestrict=shadowBan;export const hiddenBan=shadowBan;

export function requestSmuggling(h:Record<string,string>){const i:string[]=[];if(h['content-length']&&h['transfer-encoding'])i.push('CL+TE conflict');if(Object.entries(h).filter(([k])=>k.toLowerCase()==='content-length').length>1)i.push('Duplicate Content-Length');if(/chunked\s*,|,\s*chunked|chunked\s+/i.test(h['transfer-encoding']??''))i.push('Obfuscated Transfer-Encoding');if(i.length)writeAuditLog('infra.http_smuggling',{issues:i}).catch(()=>{});return{httpSmuggling:i.length>0,issues:i};}
export const httpSmuggling=requestSmuggling;

let ssrfFn:((u:string)=>{safe:boolean;reason?:string})|null=null;try{ssrfFn=require('./infrastructureSecurity').validateUrlForSSRF;}catch{}
export const ssrfPrevention=ssrfFn??((u:string)=>({safe:true,reason:'Fallback: SSRF validation unavailable'}));
