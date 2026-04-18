export interface BaitAndSwitchReport{reporterId:string;reportedUserId:string;reason:'different_person'|'looked_different'|'catfish'|'not_who_expected';severityOverride?:'robbery'|'assault'|'scam';}
export function processBaitAndSwitchReport(r:BaitAndSwitchReport,prev:number,vs:'verified'|'unverified'|'failed'):{riskLevel:'low'|'medium'|'high'|'critical';action:string[]}{
const a:string[]=[];let rl:'low'|'medium'|'high'|'critical'='low';
if(r.severityOverride==='robbery'||r.severityOverride==='assault'){rl='critical';a.push('immediate_ban','preserve_evidence','recommend_police_report');}
else if(prev>=2){rl='high';a.push('suspend_account','require_reverification');}
else if(vs==='unverified'){rl='medium';a.push('require_verification','flag_for_review');}
else a.push('flag_for_review');
return{riskLevel:rl,action:a};}

export function assessLgbtqTargetedRisk(u:{identifiesAsLgbtq:boolean;gender:string;orientation:string},m:{accountAge:number;verificationStatus:string;previousReports:number;messagePatterns:{rushesToMeet:boolean;suggestsIsolatedLocation:boolean;avoidsFaceVerification:boolean}},l:{lgbtqSafetyScore?:number;isIsolated:boolean;lateNight:boolean}):{riskElevated:boolean;riskScore:number;warnings:string[]}{
if(!u.identifiesAsLgbtq)return{riskElevated:false,riskScore:0,warnings:[]};let sc=0;const w:string[]=[];
if(m.accountAge<7){sc+=15;w.push('This match has a very new account');}if(m.verificationStatus!=='verified'){sc+=20;w.push('This match is not verified');}if(m.previousReports>0)sc+=25;
if(m.messagePatterns.rushesToMeet){sc+=15;w.push('This match is pushing to meet quickly');}if(m.messagePatterns.suggestsIsolatedLocation){sc+=20;w.push('Suggested meeting location is isolated');}if(m.messagePatterns.avoidsFaceVerification)sc+=15;
if(l.isIsolated){sc+=15;w.push('Meeting location has few nearby services');}if(l.lateNight){sc+=10;w.push('Late night first meeting — consider daytime instead');}
if(l.lgbtqSafetyScore!==undefined&&l.lgbtqSafetyScore<30){sc+=20;w.push('This area may have elevated safety risks for LGBTQ+ individuals');}
return{riskElevated:sc>=40,riskScore:Math.min(100,sc),warnings:w};}

const HAP=[/come (to|over to) my (place|house|apartment|flat|condo)/i,/my address is/i,/i('ll| will) send you my address/i,/\d+\s+\w+\s+(street|st|avenue|ave|road|rd|blvd|drive|dr|lane|ln|court|ct)/i,/apartment\s+#?\d+/i,/unit\s+#?\d+/i];
const ARP=[/where (do you|are you) live/i,/what's your address/i,/send (me )?your (address|location)/i,/which (apartment|building|floor)/i,/what('s| is) your apartment (number|#)/i,/i('ll| will) (come|drive|uber) to you/i,/live alone/i,/roommates?/i,/anyone (else )?(home|there)/i];

export function detectBurglaryPattern(msgs:Array<{text:string;timestamp:number;senderId:string}>,sid:string):{detected:boolean;homeAddressMentioned:boolean;requestCount:number;action:'none'|'warn'|'flag'}{
const sm=msgs.filter(m=>m.senderId===sid);let rc=0,ham=false;
for(const m of sm)if(ARP.some(p=>p.test(m.text)))rc++;
for(const m of msgs)if(HAP.some(p=>p.test(m.text)))ham=true;
let a:'none'|'warn'|'flag'='none';if(rc>=3)a='flag';else if(rc>=1&&ham)a='warn';
return{detected:rc>=2,homeAddressMentioned:ham,requestCount:rc,action:a};}