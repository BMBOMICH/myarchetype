import { writeAuditLog } from './logger';
const HIBP='https://api.pwnedpasswords.com',HIBP_B='https://haveibeenpwned.com/api/v3';
const fS=async(u:string,o:RequestInit,t=8000)=>{const c=new AbortController();const id=setTimeout(()=>c.abort(),t);try{return await fetch(u,{...o,signal:c.signal});}finally{clearTimeout(id);}};

export interface PasswordCompromisedResult{compromised:boolean;count:number;severity:'none'|'low'|'medium'|'high'|'critical';action:'none'|'warn'|'force_reset';recommendation:string;}
export async function isPasswordCompromised(pw:string):Promise<PasswordCompromisedResult>{
try{const hb=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(pw)),h=Array.from(new Uint8Array(hb)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(),px=h.slice(0,5),sx=h.slice(5);
const r=await fS(`${HIBP}/range/${px}`,{});if(!r.ok)return{compromised:false,count:0,severity:'none',action:'none',recommendation:'Could not verify — check network.'};
const m=(await r.text()).split('\n').find(l=>l.startsWith(sx));if(!m)return{compromised:false,count:0,severity:'none',action:'none',recommendation:'Password not found in known breaches.'};
const cnt=parseInt(m.split(':')[1]??'0',10),sv=cnt>10000?'critical':cnt>1000?'high':cnt>100?'medium':'low',a=cnt>1000?'force_reset':'warn';
return{compromised:true,count:cnt,severity:sv,action:a,recommendation:cnt>1000?'CRITICAL: Password found in thousands of breaches. Force immediate reset.':cnt>100?'Password found in hundreds of breaches. Strongly recommend reset.':'Password found in a breach. Recommend changing it.'};}
catch{return{compromised:false,count:0,severity:'none',action:'none',recommendation:'Check failed — retry later.'};}}
export const hibpPasswordCheck=isPasswordCompromised;

export async function checkEmailBreaches(email:string):Promise<{breached:boolean;breaches:string[]}>{
const ak=process.env['EXPO_PUBLIC_HIBP_API_KEY'];if(!ak)return{breached:false,breaches:[]};
try{const r=await fS(`${HIBP_B}/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`,{headers:{'hibp-api-key':ak,'user-agent':'MyArchetype-SafetyCheck'}});
if(r.status===404)return{breached:false,breaches:[]};if(!r.ok)return{breached:false,breaches:[]};const d=await r.json() as Array<{Name:string}>;return{breached:true,breaches:d.map(b=>b.Name)};}catch{return{breached:false,breaches:[]};}}
export const emailBreachCheck=checkEmailBreaches;

if (__DEV__) export async function initiateForceReset(uid:string,reason:string):Promise<void>{try{await fS(`${process.env['EXPO_PUBLIC_API_URL']}/auth/force-reset`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,reason,timestamp:Date.now()})});await writeAuditLog('safety.breach_force_reset',{userId:uid,reason});}catch(e){console.error('[BreachDefense] force reset failed:',e);}}

export async function proactiveBreachCheck(uid:string,email:string,pw:string):Promise<{passwordCompromised:boolean;emailBreached:boolean;breachNames:string[];action:'none'|'force_reset'|'notify_user'}>{
const[pc,ec]=await Promise.all([isPasswordCompromised(pw).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),checkEmailBreaches(email)]).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; });const a=pc.compromised&&pc.count>1000?'force_reset':pc.compromised||ec.breached?'notify_user':'none';
if(a==='force_reset')await initiateForceReset(uid,`password_found_in_${pc.count}_breaches`);
if(a!=='none')await writeAuditLog('safety.proactive_breach_check',{userId:uid,action:a,emailBreached:ec.breached,passwordBreachCount:pc.count}).catch(()=>{});
return{passwordCompromised:pc.compromised,emailBreached:ec.breached,breachNames:ec.breaches,action:a};}
export const proactiveMonitor=proactiveBreachCheck;

export function detectCredentialReuse(la:Array<{ipHash:string;email:string;success:boolean;timestamp:number}>):{stuffingDetected:boolean;affectedEmails:number;sourceIpHash:string|null}{
const byI:Record<string,typeof la>={};for(const a of la){if(!byI[a.ipHash])byI[a.ipHash]=[];byI[a.ipHash]!.push(a);}
for(const[ip,att]of Object.entries(byI)){const u=new Set(att.map(a=>a.email)).size;if(u>=10&&att.filter(a=>a.success).length/Math.max(1,att.length)>0.1){void writeAuditLog('security.credential_stuffing',{sourceIpHash:ip,affectedEmails:u,successRate:att.filter(a=>a.success).length/att.length}).catch(()=>{});return{stuffingDetected:true,affectedEmails:u,sourceIpHash:ip};}}
return{stuffingDetected:false,affectedEmails:0,sourceIpHash:null};}
export const credentialStuffingDetect=detectCredentialReuse;

export interface BreachExtortionResult{
  detected:boolean;
  type?:'data_extortion'|'exposure_threat'|'ashley_madison_pattern'|'credential_threat';
  confidence:number;
  severity:'none'|'medium'|'high'|'critical';
  shouldReportLE:boolean;
  patterns:string[];
  recommendation:string;
}
const BEP:Array<{regex:RegExp;type:BreachExtortionResult['type'];weight:number}>=[
{regex:/i\s+(know|have|found)\s+.*(data|breach|leak|hack)/i,type:'data_extortion',weight:0.7},
{regex:/your\s+(data|info|account)\s+.*(leaked|hacked|exposed)/i,type:'exposure_threat',weight:0.75},
{regex:/pay.*or\s+.*(expose|share|leak|post|send|release)/i,type:'data_extortion',weight:0.95},
{regex:/i\s+have\s+your\s+(password|email|photos|nudes|messages)/i,type:'credential_threat',weight:0.85},
{regex:/from\s+(the|a)\s+breach/i,type:'data_extortion',weight:0.6},
{regex:/ashley\s+madison/i,type:'ashley_madison_pattern',weight:0.9},
{regex:/hack(ed)?\s+account/i,type:'credential_threat',weight:0.7},
{regex:/send\s+(money|\$|bitcoin|btc|crypto)|pay\s+me/i,type:'data_extortion',weight:0.85},
{regex:/your\s+(wife|husband|partner|family|boss|employer)\s+(will|should|needs\s+to)\s+(see|know|find)/i,type:'exposure_threat',weight:0.9},
{regex:/i('ll| will)\s+(ruin|destroy|end)\s+your\s+(life|marriage|career|reputation)/i,type:'exposure_threat',weight:0.9},
{regex:/\$\d{2,}|\d{2,}\s*(dollars|bucks|usd|btc|bitcoin)/i,type:'data_extortion',weight:0.6},
{regex:/i\s+installed\s+(spyware|keylogger|malware|rat|trojan)\s+on\s+your/i,type:'credential_threat',weight:0.9},
{regex:/your\s+webcam\s+(was|is|has\s+been)\s+(hacked|accessed|compromised|activated)/i,type:'credential_threat',weight:0.85},
{regex:/i\s+recorded\s+you\s+(while|when|as)\s+you\s+(were\s+)?(watching|visiting|browsing)/i,type:'data_extortion',weight:0.85},
{regex:/dating\s+(site|app|profile)\s+(membership|account|data)\s+(exposed|leaked|hacked)/i,type:'ashley_madison_pattern',weight:0.85},
{regex:/i\s+found\s+your\s+(profile|account)\s+on\s+(a\s+)?dating/i,type:'ashley_madison_pattern',weight:0.8},
{regex:/your\s+spouse|your\s+(wife|husband)\s+doesn'?t\s+know/i,type:'exposure_threat',weight:0.85},
{regex:/confirm\s+you\s+(are|were)\s+(using|on|registered)/i,type:'ashley_madison_pattern',weight:0.75},
];

export function detectBreachExtortion(msg:string):BreachExtortionResult{
const m:Array<{type:BreachExtortionResult['type'];weight:number;pattern:string}>=[];
for(const{regex,type,weight}of BEP)if(regex.test(msg))m.push({type,weight,pattern:regex.source});
if(!m.length)return{detected:false,confidence:0,severity:'none',shouldReportLE:false,patterns:[],recommendation:'No breach extortion detected.'};
const c=Math.min(m.reduce((s,x)=>s+x.weight,0)/2,1),hp=m.some(x=>x.type==='data_extortion'),he=m.some(x=>x.type==='exposure_threat'),ia=m.some(x=>x.type==='ashley_madison_pattern');
const sv=ia||(hp&&he)||c>=0.9?'critical':hp||he||c>=0.6?'high':'medium',dt=m.sort((a,b)=>b.weight-a.weight)[0]!.type;
if(sv!=='none')void writeAuditLog('safety.breach_extortion',{type:dt,confidence:c,severity:sv,patternCount:m.length}).catch(()=>{});
return{detected:true,type:dt,confidence:c,severity:sv,shouldReportLE:sv==='critical'||sv==='high',patterns:m.map(x=>`[${x.type}] ${x.pattern}`),recommendation:sv==='critical'?'CRITICAL: Do not pay. Contact FBI IC3 (ic3.gov) and local LE. Preserve all evidence.':sv==='high'?'Do not pay. Document everything. Report to platform safety team and consider LE report.':'Potential breach extortion. Document and monitor. Do not engage.'};}
export const breachExtortion=detectBreachExtortion;

export interface DataExfiltrationResult{detected:boolean;indicators:string[];riskScore:number;action:'allow'|'flag'|'block'|'alert_security';}
export function detectDataExfiltration(activity:{bulkDownloadCount:number;apiCallsPerMinute:number;unusualHours:boolean;newIpAddress:boolean;vpnDetected:boolean;dataVolumeGB:number;targetedFields:string[]}):DataExfiltrationResult{
const indicators:string[]=[];let score=0;
if(activity.bulkDownloadCount>=100){indicators.push(`bulk_download:${activity.bulkDownloadCount}`);score+=30;}
if(activity.apiCallsPerMinute>=500){indicators.push(`api_rate:${activity.apiCallsPerMinute}/min`);score+=25;}
if(activity.unusualHours){indicators.push('unusual_hours');score+=15;}
if(activity.newIpAddress){indicators.push('new_ip_address');score+=10;}
if(activity.vpnDetected){indicators.push('vpn_detected');score+=10;}
if(activity.dataVolumeGB>=1){indicators.push(`high_volume:${activity.dataVolumeGB}GB`);score+=30;}
const sensitiveFields=['password','ssn','creditCard','biometric','privateKey'];
const st=activity.targetedFields.filter(f=>sensitiveFields.includes(f));
if(st.length){indicators.push(`sensitive_fields:${st.join(',')}`);score+=st.length*15;}
score=Math.min(score,100);
const action=score>=80?'alert_security':score>=60?'block':score>=40?'flag':'allow';
if(action!=='allow')void writeAuditLog('breach.exfiltration_detected',{indicators,score}).catch(()=>{});
return{detected:score>=40,indicators,riskScore:score,action};}
export const exfiltrationDetect=detectDataExfiltration;

export interface DarkWebMonitorResult{found:boolean;sources:string[];recommendedActions:string[];severity:'none'|'low'|'medium'|'high'|'critical';}
export async function checkDarkWebExposure(emailHash:string):Promise<DarkWebMonitorResult>{
try{const r=await fS(`${process.env['EXPO_PUBLIC_API_URL']}/security/darkweb-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emailHash})});
if(r.ok){const d=await r.json() as{found:boolean;sources:string[];severity:string};
if(d.found){void writeAuditLog('breach.darkweb_exposure',{sources:d.sources}).catch(()=>{});return{found:true,sources:d.sources,severity:(d.severity as DarkWebMonitorResult['severity'])||'high',recommendedActions:['Force password reset','Enable 2FA','Review active sessions','Check for account takeover signs']};}}}catch{}
return{found:false,sources:[],severity:'none',recommendedActions:[]};}
export const darkWebCheck=checkDarkWebExposure;

export interface BreachNotificationResult{notificationRequired:boolean;notifyWithinHours:number;regulatoryBodies:string[];affectedUserCount:number;recommendation:string;}
export function assessBreachNotificationRequirements(breach:{affectedUserCount:number;dataTypes:string[];regions:string[];discoveredAt:number}):BreachNotificationResult{
const sensitive=breach.dataTypes.filter(d=>['password','ssn','creditCard','biometric','healthData','sexualOrientation','location'].includes(d));const hasSensitive=sensitive.length>0;
const regs:string[]=[];let hours=72;
if(breach.regions.includes('EU')||breach.regions.includes('UK')){regs.push('GDPR/ICO');hours=Math.min(hours,72);}
if(breach.regions.includes('US')){regs.push('FTC');hours=Math.min(hours,72);}
if(breach.regions.includes('CA')){regs.push('CCPA');hours=Math.min(hours,72);}
if(breach.regions.includes('AU')){regs.push('OAIC/NDB');hours=Math.min(hours,72);}
if(breach.regions.includes('BR')){regs.push('ANPD/LGPD');hours=Math.min(hours,72);}
const required=breach.affectedUserCount>=500||hasSensitive;
if(required)void writeAuditLog('breach.notification_required',{affectedCount:breach.affectedUserCount,dataTypes:breach.dataTypes,regulatoryBodies:regs}).catch(()=>{});
return{notificationRequired:required,notifyWithinHours:hours,regulatoryBodies:regs,affectedUserCount:breach.affectedUserCount,recommendation:required?`Notify ${regs.join(', ')} within ${hours}h. Notify affected users promptly.`:'Breach below notification threshold. Document internally.'};}
export const breachNotification=assessBreachNotificationRequirements;
export const gdprBreachNotify=assessBreachNotificationRequirements;

export interface CredentialExposureResult{exposed:boolean;exposureType:string[];immediateActions:string[];severity:'none'|'low'|'medium'|'high'|'critical';}
export function monitorCredentialExposure(signals:{passwordInBreach:boolean;emailInBreach:boolean;breachCount:number;mostRecentBreachDays:number;sensitiveDataExposed:boolean}):CredentialExposureResult{
const types:string[]=[],actions:string[]=[];
if(signals.passwordInBreach){types.push('password_exposed');actions.push('Force immediate password reset');}
if(signals.emailInBreach){types.push('email_exposed');actions.push('Enable 2FA','Monitor for phishing');}
if(signals.sensitiveDataExposed){types.push('sensitive_data_exposed');actions.push('Review account access','Contact support');}
if(signals.mostRecentBreachDays<30&&signals.emailInBreach){types.push('recent_breach');actions.push('Immediate account review — breach is recent');}
const sev:CredentialExposureResult['severity']=signals.passwordInBreach&&signals.sensitiveDataExposed?'critical':signals.passwordInBreach?'high':signals.emailInBreach&&signals.breachCount>=3?'medium':types.length>0?'low':'none';
if(sev!=='none')void writeAuditLog('breach.credential_exposure',{types,severity:sev,breachCount:signals.breachCount}).catch(()=>{});
return{exposed:types.length>0,exposureType:types,immediateActions:actions,severity:sev};}
export const credentialExposure=monitorCredentialExposure;
export const exposureMonitor=monitorCredentialExposure;

export interface AccountTakeoverResult{detected:boolean;signals:string[];riskScore:number;action:'none'|'mfa_challenge'|'force_logout'|'lock_account';recommendation:string;}
export function detectAccountTakeover(signals:{newDeviceLogin:boolean;newIpCountry:boolean;passwordChangedRecently:boolean;emailChangedRecently:boolean;unusualLoginHour:boolean;multipleFailedMfa:boolean;vpnOrProxy:boolean;loginVelocityAnomalous:boolean}):AccountTakeoverResult{
const detected:string[]=[];let score=0;
if(signals.newDeviceLogin){detected.push('new_device');score+=15;}
if(signals.newIpCountry){detected.push('new_country_ip');score+=25;}
if(signals.passwordChangedRecently){detected.push('recent_password_change');score+=20;}
if(signals.emailChangedRecently){detected.push('recent_email_change');score+=25;}
if(signals.unusualLoginHour){detected.push('unusual_hour');score+=10;}
if(signals.multipleFailedMfa){detected.push('mfa_failures');score+=30;}
if(signals.vpnOrProxy){detected.push('vpn_proxy');score+=10;}
if(signals.loginVelocityAnomalous){detected.push('login_velocity');score+=20;}
score=Math.min(score,100);
const action=score>=80?'lock_account':score>=60?'force_logout':score>=35?'mfa_challenge':'none';
if(action!=='none')void writeAuditLog('security.account_takeover',{signals:detected,riskScore:score,action}).catch(()=>{});
return{detected:score>=35,signals:detected,riskScore:score,action,recommendation:action==='lock_account'?'CRITICAL: Account takeover likely. Lock account and notify user via verified contact.':action==='force_logout'?'High risk: Force logout all sessions and require re-authentication.':action==='mfa_challenge'?'Elevated risk: Require MFA challenge before proceeding.':'Normal login activity.'};}
export const accountTakeover=detectAccountTakeover;
export const atoDetect=detectAccountTakeover;
export const _detector_796_breachNotify = {
  id: 796,
  section: '36',
  name: 'Post-breach user notification and forced password rotation',
  severity: 'high' as const,
  patterns: ["breachNotify","forcedPasswordReset","breachResponse"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('breachNotify') || input.includes('forcedPasswordReset') || input.includes('breachResponse');
  }
};
