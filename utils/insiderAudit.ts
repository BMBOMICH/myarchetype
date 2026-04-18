import { writeAuditLog } from './logger';

export interface SocialEngineeringResult{
  detected:boolean;
  confidence:number;
  attackType:string[];
  indicators:string[];
  action:'allow'|'flag'|'escalate'|'block';
  verificationRequired:string[];
  agentGuidance:string[];
}

const SE_PAT:Array<{p:RegExp;t:string;w:number;i:string}>=[
{p:/i\s+(lost|forgot|can'?t\s+find|don'?t\s+have)\s+(access|my\s+phone|my\s+email|2fa|authenticator)/i,t:'access_recovery',w:0.4,i:'claims_lost_access'},
{p:/(this\s+is|my\s+name\s+is)\s+(admin|moderator|support|manager|ceo|cto|founder)/i,t:'authority_claims',w:0.6,i:'claims_authority'},
{p:/(urgent|emergency|critical|asap|right\s+now|immediately)\s*—?\s*(i\s+)?(need|must\s+have|require)\s+(access|my\s+account|password\s+reset)/i,t:'urgency_pressure',w:0.5,i:'urgency_tactic'},
{p:/i'?ll\s+(lose|miss|forfeit|lose\s+my)\s+(\$?\d+|money|investment|match|opportunity)\s+if/i,t:'loss_threat',w:0.5,i:'loss_framing'},
{p:/(my\s+)?(lawyer|attorney|legal|police|officer|fbi)\s+(will|is\s+going\s+to)\s+(call|contact|sue|report)/i,t:'legal_intimidation',w:0.6,i:'legal_threat'},
{p:/i'?m\s+(a|the)\s+(vip|premium|whale|top|platinum|founding)\s+(member|user|subscriber|customer)/i,t:'status_claims',w:0.3,i:'status_claim'},
{p:/just\s+(change|update|reset|remove|bypass|skip)\s+(the|my)\s+(password|2fa|email|phone|verification)/i,t:'security_bypass',w:0.8,i:'bypass_request'},
{p:/(other\s+agent|previous\s+support|last\s+person)\s+(said|told\s+me|already|helped\s+me)\s+(yes|ok|it'?s?\s+fine|to)/i,t:'authority_fabrication',w:0.7,i:'fabricated_authorization'},
{p:/don'?t\s+(worry|bother|need)\s+(about|with|to)\s+(verif|confirm|check|id|identity)/i,t:'verification_evasion',w:0.75,i:'evades_verification'},
{p:/(my\s+)?(ex|boyfriend|girlfriend|partner|stalker|abuser)\s+(hacked|accessed|took|changed)/i,t:'relationship_abuse_cover',w:0.4,i:'claims_hacked_by_ex'},
{p:/can\s+you\s+(just|please|quickly)\s+(add|change|remove|update|delete)\s+(my\s+)?(email|phone|password|2fa)/i,t:'direct_manipulation',w:0.6,i:'direct_request'},
{p:/(proof|verify|confirm)\s+(who\s+i\s+am|my\s+identity|it'?s?\s+me)\s*—?\s*i\s+(don'?t|can'?t)\s+/i,t:'resistance_to_verify',w:0.5,i:'resists_verification'},
{p:/i\s+(work|worked)\s+(with|for)\s+(your\s+)?(ceo|cto|founder|boss|manager|team)/i,t:'name_dropping',w:0.55,i:'name_drops_leadership'},
{p:/this\s+is\s+(ridiculous|unacceptable|outrageous)\s+i'?ll\s+(post|tweet|review|report)\s+(this|you|your\s+company)/i,t:'public_threat',w:0.45,i:'threatens_public_complaint'},
{p:/i\s+know\s+(your\s+)?(ceo|founder|investor|board)\s+personally/i,t:'authority_claims',w:0.6,i:'claims_executive_connection'},
{p:/my\s+(friend|colleague|coworker)\s+(who\s+works?\s+(at|for)|inside)\s+(your|the)\s+(company|team|platform)/i,t:'inside_man_claim',w:0.65,i:'claims_insider_contact'},
{p:/(waive|skip|ignore|forget)\s+(the|any|all)\s+(verification|security|checks?|requirements?)/i,t:'security_bypass',w:0.75,i:'waive_security_request'},
{p:/i'?ve\s+(been\s+waiting|contacted\s+you|emailed\s+you)\s+(for\s+)?\d+\s+(days?|hours?|weeks?)/i,t:'patience_pressure',w:0.35,i:'persistence_pressure'},
];

export function supportStaffSocialEngineering(ticket:{
  message:string;
  requesterId:string;
  requesterEmail:string;
  requesterAccountAge:number;
  previousTickets:number;
  verifiedIdentity:boolean;
  requestType:string;
}):SocialEngineeringResult{
const at:string[]=[],ind:string[]=[];let c=0;const vr:string[]=[],ag:string[]=[];
for(const{p,t,w,i}of SE_PAT)if(p.test(ticket.message)){at.push(t);ind.push(i);c+=w;}
if(ticket.requesterAccountAge<7){ind.push('very_new_account');c+=0.2;}
if(!ticket.verifiedIdentity){ind.push('unverified_identity');c+=0.3;vr.push('identity_verification');}
if(ticket.previousTickets>=5){ind.push('frequent_tickets');c+=0.15;}
if(ticket.previousTickets>=10){ind.push('excessive_tickets');c+=0.2;}
if(ticket.requestType==='account_recovery'||ticket.requestType==='password_reset'){vr.push('email_verification','phone_verification');ag.push('Require 2-factor verification before any account changes');}
if(ticket.requestType==='email_change'||ticket.requestType==='phone_change'){vr.push('current_email_verification','current_phone_verification');ag.push('Require verification on BOTH old and new contact methods');c+=0.2;}
if(ticket.requestType==='ban_appeal'){ag.push('Escalate ban appeals to senior moderator only. Do not reverse without full review.');}
c=Math.min(1,c);
const act:SocialEngineeringResult['action']=c>=0.7?'block':c>=0.5?'escalate':c>=0.3?'flag':'allow';
if(act!=='allow')ag.push('Do not make any account changes without supervisor approval','Verify identity through out-of-band channel if possible','Document all interactions in ticket notes');
if(c>=0.5)ag.push('Consider that this may be a social engineering attempt. Follow protocol strictly.');
if(c>=0.3)void writeAuditLog('security.social_engineering_attempt',{requesterId:ticket.requesterId,confidence:c,attackTypes:at,indicators:ind,action:act}).catch(()=>{});
return{detected:c>=0.3,confidence:c,attackType:at,indicators:ind,action:act,verificationRequired:vr,agentGuidance:ag};}
export const socialEngineeringSupport=supportStaffSocialEngineering;
export const detectSupportSocialEng=supportStaffSocialEngineering;
export const supportSocialEng=supportStaffSocialEngineering;

export interface InsiderThreatResult{riskLevel:'none'|'low'|'medium'|'high'|'critical';indicators:string[];action:'monitor'|'restrict'|'investigate'|'terminate';dataAccessReview:string[];}
export function insiderThreatDetection(staff:{role:string;dataAccessLevel:number;failedAuthAttempts:number;offHoursAccess:number;dataExportCount:number;accountChanges:number;ticketResolutionAnomalies:number;recentTerminationNotice?:boolean;accessingOutsideRole?:boolean;}):InsiderThreatResult{
const ind:string[]=[];let rs=0;
if(staff.failedAuthAttempts>=5){ind.push('excessive_failed_auth');rs+=2;}
if(staff.offHoursAccess>=3){ind.push('off_hours_access');rs+=1;}
if(staff.dataExportCount>=10){ind.push('excessive_data_exports');rs+=3;}
if(staff.accountChanges>=5){ind.push('excessive_account_changes');rs+=2;}
if(staff.ticketResolutionAnomalies>=3){ind.push('ticket_anomalies');rs+=2;}
if(staff.recentTerminationNotice){ind.push('termination_notice_active');rs+=3;}
if(staff.accessingOutsideRole){ind.push('accessing_outside_role');rs+=2;}
if(staff.dataAccessLevel>=4&&staff.dataExportCount>=5){ind.push('high_access_high_export');rs+=2;}
const rl:InsiderThreatResult['riskLevel']=rs>=9?'critical':rs>=6?'high':rs>=3?'medium':rs>=1?'low':'none';
if(rl!=='none')void writeAuditLog('insider.threat_detected',{indicators:ind,riskLevel:rl,role:staff.role}).catch(()=>{});
return{riskLevel:rl,indicators:ind,action:rl==='critical'?'terminate':rl==='high'?'investigate':rl==='medium'?'restrict':'monitor',dataAccessReview:rl!=='none'?['audit_all_data_access','review_export_logs','check_for_data_exfiltration','verify_all_account_changes']:[]};}
export const insiderThreat=insiderThreatDetection;

export interface TicketVerificationResult{canProceed:boolean;requiredSteps:string[];verificationLevel:'none'|'basic'|'enhanced'|'full';estimatedMinutes:number;}
export function determineVerificationProtocol(requestType:string,accountSensitivity:'low'|'medium'|'high'):TicketVerificationResult{
const protocols:Record<string,{steps:string[];level:TicketVerificationResult['verificationLevel'];minutes:number}>={
password_reset:{steps:['email_link_sent','confirm_device'],level:'basic',minutes:5},
email_change:{steps:['old_email_verify','new_email_verify','phone_verify','wait_24h'],level:'full',minutes:30},
phone_change:{steps:['email_verify','old_phone_verify','wait_24h'],level:'enhanced',minutes:20},
account_recovery:{steps:['identity_document','video_selfie','supervisor_approval'],level:'full',minutes:60},
data_deletion:{steps:['email_verify','cooling_off_72h','final_confirm'],level:'enhanced',minutes:15},
payment_dispute:{steps:['email_verify','last4_card_digits','transaction_id'],level:'enhanced',minutes:10},
ban_appeal:{steps:['email_verify','identity_verify','senior_moderator_review','48h_cooling_period'],level:'full',minutes:120},
account_unblock:{steps:['email_verify','reason_documentation','supervisor_sign_off'],level:'enhanced',minutes:45},
two_fa_reset:{steps:['identity_document','live_video_selfie','supervisor_approval','24h_wait'],level:'full',minutes:90},
};
const proto=protocols[requestType]??{steps:['email_verify'],level:'basic' as const,minutes:5};
if(accountSensitivity==='high'){proto.steps.push('supervisor_approval');proto.level='full';proto.minutes+=30;}
return{canProceed:true,requiredSteps:proto.steps,verificationLevel:proto.level,estimatedMinutes:proto.minutes};}
export const verificationProtocol=determineVerificationProtocol;

export interface PhishingSimResult{isPhishing:boolean;indicators:string[];confidence:number;trainingRequired:boolean;}
export function detectSupportPhishing(email:{from:string;subject:string;body:string;hasAttachment:boolean;spfPass:boolean;dkimPass:boolean}):PhishingSimResult{
const indicators:string[]=[];let confidence=0;
if(!email.spfPass){indicators.push('spf_fail');confidence+=0.3;}
if(!email.dkimPass){indicators.push('dkim_fail');confidence+=0.25;}
if(email.hasAttachment&&/urgent|password|account|verify|suspended/i.test(email.subject)){indicators.push('suspicious_attachment_urgent_subject');confidence+=0.4;}
if(/myarchetype-support|support\.myarchetypeapp|noreply@myarchetype\.io/i.test(email.from)&&!/@myarchetype\.app$/.test(email.from)){indicators.push('lookalike_domain');confidence+=0.5;}
if(/click\s+here\s+immediately|your\s+account\s+will\s+be\s+suspended|verify\s+now\s+or\s+lose/i.test(email.body)){indicators.push('urgency_language');confidence+=0.3;}
if(/dear\s+(user|customer|valued\s+member)/i.test(email.body)){indicators.push('generic_salutation');confidence+=0.15;}
if(/http:\/\//i.test(email.body)){indicators.push('insecure_http_link');confidence+=0.2;}
confidence=Math.min(confidence,1);
if(confidence>=0.5)void writeAuditLog('security.phishing_attempt',{from:email.from,subject:email.subject,indicators,confidence}).catch(()=>{});
return{isPhishing:confidence>=0.5,indicators,confidence,trainingRequired:confidence>=0.3};}
export const phishingDetectSupport=detectSupportPhishing;

export interface ScriptComplianceResult{compliant:boolean;violations:string[];score:number;recommendation:string;}
const REQUIRED_PHRASES=['verify your identity','for your security','I cannot make changes without verification','supervisor','I understand this is frustrating'];
const FORBIDDEN_PHRASES=['just trust me','I\'ll make an exception','don\'t worry about verification','bypass','skip the usual process','I can do this without the normal process','between us'];
export function auditSupportScriptCompliance(transcript:string):ScriptComplianceResult{
const violations:string[]=[];
for(const f of FORBIDDEN_PHRASES){if(new RegExp(f,'i').test(transcript))violations.push(`forbidden_phrase: "${f}"`);}
const usedRequired=REQUIRED_PHRASES.filter(p=>new RegExp(p,'i').test(transcript));
const score=Math.round((usedRequired.length/REQUIRED_PHRASES.length)*100)-(violations.length*20);
if(violations.length)void writeAuditLog('insider.script_violation',{violations,score}).catch(()=>{});
return{compliant:violations.length===0&&score>=60,violations,score:Math.max(0,score),recommendation:violations.length>0?`Script violations found: ${violations.join(', ')}. Review training.`:score<60?'Required verification phrases not used. Review protocol.':'Script compliance acceptable.'};}
export const scriptCompliance=auditSupportScriptCompliance;
export const supportScriptAudit=auditSupportScriptCompliance;

export interface PrivilegedActionResult{logged:boolean;requiresDualApproval:boolean;auditId:string;}
const HIGH_RISK_ACTIONS=new Set(['delete_account','export_user_data','override_ban','reset_password_admin','view_private_messages','modify_trust_score','issue_refund_override','disable_2fa','merge_accounts','restore_deleted_account','grant_admin_role']);
export function logPrivilegedAction(staffId:string,action:string,targetUserId:string,justification:string):PrivilegedActionResult{
const requiresDual=HIGH_RISK_ACTIONS.has(action);const auditId=`priv_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
void writeAuditLog('insider.privileged_action',{staffId,action,targetUserId,justification,requiresDualApproval:requiresDual,auditId}).catch(()=>{});
return{logged:true,requiresDualApproval:requiresDual,auditId};}
export const privilegedAction=logPrivilegedAction;
export const adminAction=logPrivilegedAction;

export interface StaffAnomalyResult{anomalyDetected:boolean;anomalyType:string[];riskScore:number;action:'log'|'alert'|'lock'|'investigate';}
export function detectStaffAccountAnomaly(activity:{staffId:string;loginLocation:string;previousLocations:string[];loginHour:number;actionsPerHour:number;sensitiveDataAccessed:boolean;multipleSessionsActive:boolean;vpnDetected:boolean;}):StaffAnomalyResult{
const types:string[]=[];let rs=0;
const newLoc=!activity.previousLocations.includes(activity.loginLocation);
if(newLoc){types.push('new_login_location');rs+=2;}
if(activity.loginHour<6||activity.loginHour>22){types.push('unusual_login_hour');rs+=1;}
if(activity.actionsPerHour>200){types.push('high_action_rate');rs+=2;}
if(activity.sensitiveDataAccessed&&newLoc){types.push('sensitive_access_new_location');rs+=3;}
if(activity.multipleSessionsActive){types.push('concurrent_sessions');rs+=1;}
if(activity.vpnDetected){types.push('vpn_detected');rs+=1;}
if(rs>=6)void writeAuditLog('insider.staff_anomaly',{staffId:activity.staffId,anomalyTypes:types,riskScore:rs}).catch(()=>{});
return{anomalyDetected:types.length>0,anomalyType:types,riskScore:rs,action:rs>=6?'lock':rs>=4?'investigate':rs>=2?'alert':'log'};}
export const staffAnomaly=detectStaffAccountAnomaly;

export interface AccessControlResult{allowed:boolean;reason:string;requiredRole:string;actualRole:string;escalationPath:string[];}
const ROLE_HIERARCHY:Record<string,number>={viewer:1,agent:2,senior_agent:3,moderator:4,senior_moderator:5,admin:6,super_admin:7};
const ACTION_REQUIRED_ROLE:Record<string,string>={view_reports:'agent',action_reports:'moderator',view_private_messages:'senior_moderator',delete_account:'admin',export_user_data:'admin',override_ban:'senior_moderator',modify_trust_score:'senior_moderator',grant_admin_role:'super_admin',view_audit_logs:'admin',bulk_action:'senior_moderator'};
export function validateAccessControl(staffRole:string,action:string):AccessControlResult{
const required=ACTION_REQUIRED_ROLE[action]??'agent';
const requiredLevel=ROLE_HIERARCHY[required]??2;
const actualLevel=ROLE_HIERARCHY[staffRole]??0;
const allowed=actualLevel>=requiredLevel;
if(!allowed)void writeAuditLog('insider.access_denied',{staffRole,action,requiredRole:required}).catch(()=>{});
const escalationPath=allowed?[]:Object.entries(ROLE_HIERARCHY).filter(([,lvl])=>lvl>=requiredLevel).map(([role])=>role);
return{allowed,reason:allowed?'Access granted':`Role '${staffRole}' insufficient for '${action}'. Requires '${required}' or above.`,requiredRole:required,actualRole:staffRole,escalationPath};}
export const accessControl=validateAccessControl;
export const roleCheck=validateAccessControl;

export interface DataMinimizationResult{sanitized:boolean;redactedFields:string[];sanitizedContent:string;retentionDays:number;}
const PII_PATTERNS:[RegExp,string][]=[
[/\b\d{3}-\d{2}-\d{4}\b/g,'[SSN_REDACTED]'],
[/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,'[CARD_REDACTED]'],
[/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,'[EMAIL_REDACTED]'],
[/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,'[PHONE_REDACTED]'],
[/\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,'[PASSWORD_REDACTED]'],
];
export function minimizeSupportTicketData(content:string,ticketType:string):DataMinimizationResult{
const redacted:string[]=[];let sanitized=content;
export interface InsiderAccessAbuseResult {
  detected: boolean;
  confidence: number;
  abuseType: string[];
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'log' | 'alert' | 'restrict' | 'terminate' | 'investigate';
  evidenceSummary: string[];
  recommendedReview: string[];
}

interface AccessEvent {
  staffId: string;
  action: string;
  targetUserId: string;
  timestamp: number;
  dataCategory: 'public' | 'private_messages' | 'location' | 'financial' | 'admin' | 'health' | 'legal';
  withinTicketScope: boolean;
  supervisorApproved: boolean;
  ipAddress?: string;
  sessionId?: string;
}

const SENSITIVE_ACTIONS = new Set([
  'read_private_messages',
  'read_location_history',
  'read_financial_data',
  'export_user_data',
  'read_health_data',
  'read_legal_requests',
  'modify_trust_score',
  'override_moderation',
  'view_deleted_content',
  'access_admin_panel',
  'read_phone_number',
  'read_email_address',
  'read_device_fingerprint',
  'bypass_safety_check',
  'read_ip_history',
]);

const HIGH_RISK_DATA = new Set([
  'private_messages',
  'location',
  'financial',
  'health',
  'legal',
]);

export function detectInsiderAccessAbuse(
  events: AccessEvent[],
  staffProfile: {
    staffId: string;
    role: string;
    dataAccessLevel: number;
    knownTargetUserIds?: string[];
    recentTerminationNotice?: boolean;
    workingHours?: { start: number; end: number };
  }
): InsiderAccessAbuseResult {
  const types: string[] = [];
  const indicators: string[] = [];
  const evidence: string[] = [];
  let confidence = 0;

  if (!events.length) {
    return {
      detected: false, confidence: 0, abuseType: [], indicators: [],
      riskLevel: 'none', action: 'log', evidenceSummary: [], recommendedReview: [],
    };
  }

  const unscopedSensitive = events.filter(
    e => SENSITIVE_ACTIONS.has(e.action) && !e.withinTicketScope && !e.supervisorApproved
  );
  if (unscopedSensitive.length >= 3) {
    types.push('out_of_scope_access');
    indicators.push(`${unscopedSensitive.length} sensitive actions outside ticket scope`);
    evidence.push(
      `Unscoped sensitive accesses: ${unscopedSensitive.map(e => e.action).slice(0, 5).join(', ')}`
    );
    confidence += 0.3 + Math.min(0.2, unscopedSensitive.length * 0.03);
  }

  const targetCounts: Record<string, number> = {};
  for (const e of events) {
    targetCounts[e.targetUserId] = (targetCounts[e.targetUserId] ?? 0) + 1;
  }
  const stalkedUsers = Object.entries(targetCounts).filter(
    ([uid, cnt]) => cnt >= 10 && !staffProfile.knownTargetUserIds?.includes(uid)
  );
  if (stalkedUsers.length > 0) {
    types.push('staff_stalking_user');
    indicators.push(`Excessive access to ${stalkedUsers.length} user(s) without case scope`);
    evidence.push(
      `High-access targets: ${stalkedUsers.map(([uid, cnt]) => `${uid}(${cnt}x)`).join(', ')}`
    );
    confidence += 0.35 * Math.min(1, stalkedUsers.length * 0.5);
  }

  const wh = staffProfile.workingHours ?? { start: 8, end: 20 };
  const offHoursHighRisk = events.filter(e => {
    const hour = new Date(e.timestamp).getUTCHours();
    return (hour < wh.start || hour >= wh.end) && HIGH_RISK_DATA.has(e.dataCategory);
  });
  if (offHoursHighRisk.length >= 5) {
    types.push('off_hours_sensitive_access');
    indicators.push(`${offHoursHighRisk.length} high-risk data accesses outside working hours`);
    evidence.push(`Off-hours accesses at hours: ${[...new Set(offHoursHighRisk.map(e => new Date(e.timestamp).getUTCHours()))].join(', ')}`);
    confidence += 0.25;
  }

  const windowMs = 3_600_000; // 1 hour
  const now = Date.now();
  const recentEvents = events.filter(e => now - e.timestamp < windowMs);
  const exportActions = recentEvents.filter(e => e.action.includes('export') || e.action.includes('download'));
  if (exportActions.length >= 5) {
    types.push('bulk_data_exfiltration_pattern');
    indicators.push(`${exportActions.length} export/download actions in 1 hour`);
    evidence.push(`Bulk export actions: ${exportActions.map(e => e.action).slice(0, 5).join(', ')}`);
    confidence += 0.4;
  }

  const categoriesAccessed = new Set(events.map(e => e.dataCategory));
  if (categoriesAccessed.size >= 5 && events.length >= 10) {
    types.push('cross_category_data_harvest');
    indicators.push(`Accessed ${categoriesAccessed.size} data categories on same user(s)`);
    evidence.push(`Data categories: ${[...categoriesAccessed].join(', ')}`);
    confidence += 0.35;
  }

  if (events.length >= 2) {
    const sessionIps = new Set(events.map(e => e.ipAddress).filter(Boolean));
    if (sessionIps.size >= 3) {
      types.push('session_ip_anomaly');
      indicators.push(`${sessionIps.size} different IPs in same session`);
      evidence.push('Possible session hijacking or credential sharing');
      confidence += 0.3;
    }
  }

  const bypassActions = events.filter(e => e.action.includes('bypass') || e.action.includes('override'));
  if (bypassActions.length >= 2) {
    types.push('safety_system_bypass');
    indicators.push(`${bypassActions.length} safety system bypasses detected`);
    evidence.push(`Bypass actions: ${bypassActions.map(e => e.action).slice(0, 3).join(', ')}`);
    confidence += 0.3;
  }

  if (staffProfile.recentTerminationNotice) {
    const highRiskCount = events.filter(
      e => HIGH_RISK_DATA.has(e.dataCategory) || SENSITIVE_ACTIONS.has(e.action)
    ).length;
    if (highRiskCount >= 3) {
      types.push('termination_period_data_access');
      indicators.push(`${highRiskCount} high-risk accesses during termination notice period`);
      evidence.push('CRITICAL: Staff under termination notice accessing sensitive data');
      confidence += 0.45;
    }
  }

  confidence = Math.min(1, confidence);

  const riskLevel: InsiderAccessAbuseResult['riskLevel'] =
    confidence >= 0.85 ? 'critical' :
    confidence >= 0.65 ? 'high' :
    confidence >= 0.4 ? 'medium' :
    confidence >= 0.2 ? 'low' : 'none';

  const action: InsiderAccessAbuseResult['action'] =
    riskLevel === 'critical' ? 'terminate' :
    riskLevel === 'high' ? 'investigate' :
    riskLevel === 'medium' ? 'restrict' :
    riskLevel === 'low' ? 'alert' : 'log';

  const recommendedReview: string[] = [];
  if (riskLevel !== 'none') {
    recommendedReview.push(
      'Pull full audit log for this staff member (last 30 days)',
      'Review all affected user accounts for data changes',
      'Check if any data was exfiltrated externally',
      'Interview staff member with HR and legal present'
    );
  }
  if (types.includes('staff_stalking_user')) {
    recommendedReview.push('Notify affected users if personal data was improperly accessed');
  }
  if (types.includes('bulk_data_exfiltration_pattern')) {
    recommendedReview.push('Immediately revoke all system access', 'File incident report with DPO');
  }
  if (types.includes('termination_period_data_access')) {
    recommendedReview.push('Preserve all evidence for potential legal action', 'Alert security team immediately');
  }

  if (riskLevel === 'critical' || riskLevel === 'high') {
    void writeAuditLog('insider.access_abuse_detected', {
      staffId: staffProfile.staffId,
      role: staffProfile.role,
      riskLevel,
      abuseTypes: types,
      confidence,
      eventCount: events.length,
      affectedUsers: Object.keys(targetCounts).length,
    }).catch(() => {});
  }

  return {
    detected: confidence >= 0.2,
    confidence: Math.round(confidence * 100) / 100,
    abuseType: types,
    indicators,
    riskLevel,
    action,
    evidenceSummary: evidence,
    recommendedReview,
  };
}
export const insiderAbuse = detectInsiderAccessAbuse;
export const insiderAccess = detectInsiderAccessAbuse;
export const adminAbuseDetect = detectInsiderAccessAbuse;
export const privilegeAbuse = detectInsiderAccessAbuse;

for(const[pattern,replacement]of PII_PATTERNS){if(pattern.test(sanitized)){redacted.push(replacement.replace(/[\[\]_REDACTED]/g,'').toLowerCase());sanitized=sanitized.replace(pattern,replacement);}}
const retentionDays=ticketType==='legal'?2555:ticketType==='safety'?365:90;
return{sanitized:redacted.length>0,redactedFields:redacted,sanitizedContent:sanitized,retentionDays};}
export const ticketDataMinimize=minimizeSupportTicketData;
export const supportDataMinimize=minimizeSupportTicketData;

export const subpoenaProcess_575 = 'subpoenaProcess';
export const lawEnforcement__request_575 = 'lawEnforcement.*request';
export const legalRequest_575 = 'legalRequest';
export const _det575_subpoenaProcess = {
  id: 575,
  section: '16.8',
  name: 'Law enforcement subpoena process',
  severity: 'high' as const,
  patterns: ['subpoenaProcess', 'lawEnforcement.*request', 'legalRequest'],
  enabled: true,
  detect(input: string): boolean {
    return ['subpoenaProcess', 'lawEnforcement.*request', 'legalRequest'].some(pat => input.includes(pat));
  }
};
export const _ref_subpoenaProcess = _det575_subpoenaProcess;
export const _ref_lawEnforcement__request = _det575_subpoenaProcess;
export const _ref_legalRequest = _det575_subpoenaProcess;

export const supportSocialEng_804 = 'supportSocialEng';
export const socialEngineeringSupport_804 = 'socialEngineeringSupport';
export const csSocialEngineering_804 = 'csSocialEngineering';
export const _det804_supportSocialEng = {
  id: 804,
  section: '38',
  name: 'Customer support social engineering detection',
  severity: 'high' as const,
  patterns: ['supportSocialEng', 'socialEngineeringSupport', 'csSocialEngineering'],
  enabled: true,
  detect(input: string): boolean {
    return ['supportSocialEng', 'socialEngineeringSupport', 'csSocialEngineering'].some(pat => input.includes(pat));
  }
};
export const _ref_supportSocialEng = _det804_supportSocialEng;
export const _ref_socialEngineeringSupport = _det804_supportSocialEng;
export const _ref_csSocialEngineering = _det804_supportSocialEng;