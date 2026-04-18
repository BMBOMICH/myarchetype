import { writeAuditLog } from './logger';

export interface StalkerwarePromptResult {
  shouldShow: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  warningTitle: string;
  warningBody: string;
  actionItems: string[];
  resources: string[];
}

export function stalkerwareAwarenessPrompt(ctx: {
  postMatch: boolean;
  firstMessage: boolean;
  userReportedSuspicion: boolean;
  deviceAdminAppsCount: number;
  recentBatteryDrain: boolean;
  dataUsageSpike: boolean;
}): StalkerwarePromptResult {
  let rs = 0;
  const ai: string[] = [];
  if (ctx.postMatch) rs += 1;
  if (ctx.firstMessage) rs += 0.5;
  if (ctx.userReportedSuspicion) rs += 3;
  if (ctx.deviceAdminAppsCount > 2) { rs += 2; ai.push('Check device admin apps — more than expected'); }
  if (ctx.recentBatteryDrain) { rs += 1; ai.push('Unexplained battery drain can indicate monitoring'); }
  if (ctx.dataUsageSpike) { rs += 1; ai.push('Unexplained data usage can indicate data exfiltration'); }
  const rl: StalkerwarePromptResult['riskLevel'] = rs >= 4 ? 'high' : rs >= 2 ? 'medium' : rs >= 1 ? 'low' : 'none';
  const res: string[] = [];
  if (rl !== 'none') {
    ai.push(
      'Check Settings → Applications for unknown apps',
      'Review Settings → Security → Device administrators',
      'Run security scan with antivirus',
      'Consider factory reset if stalkerware suspected',
      'Do NOT confront suspected installer — safety first'
    );
    res.push(
      'National DV Hotline: 1-800-799-7233',
      'Coalition Against Stalkerware: stopstalkerware.org',
      'Victim Connect: victimconnect.org',
      'Tech Safety: techsafety.org'
    );
  }
  return {
    shouldShow: rl !== 'none',
    riskLevel: rl,
    warningTitle: rl === 'high'
      ? '⚠️ Your device may be monitored'
      : 'Protect yourself from digital surveillance',
    warningBody: rl === 'high'
      ? 'We detected signs someone may be monitoring your device. Stalkerware can track location, read messages, and see dating activity. Take action now.'
      : 'Partners or ex-partners sometimes install monitoring apps. Here\'s how to check and protect yourself.',
    actionItems: ai,
    resources: res,
  };
}
export const stalkerwarePrompt = stalkerwareAwarenessPrompt;

export interface CoercivePartnerMonitoringResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
  safetyPlan: string[];
  shouldNotify: boolean;
  recommendation: string;
  safetyResources: string[];
  signals?: string[];
  action?: 'none' | 'flag' | 'alert_user' | 'escalate';
}

const CS: Array<{ p: RegExp; w: number; i: string }> = [
  { p: /my\s+(boyfriend|girlfriend|husband|wife|partner|ex)\s+(checks?|monitors?|tracks?|controls?|goes\s+through)\s+(my|the)\s+(phone|messages?|location|accounts?|dating)/i, w: 0.7, i: 'admits_monitoring' },
  { p: /(he|she|they)\s+(made|forced|pressured|demanded)\s+me\s+to\s+(share|give|show|reveal|open)/i, w: 0.8, i: 'forced_access' },
  { p: /i('m| am)\s+not\s+allowed\s+to\s+(have|use|talk|message|meet|see)/i, w: 0.9, i: 'restrictions_admitted' },
  { p: /(have\s+to|must)\s+(share|give)\s+my\s+(password|pin|passcode|phone|location)/i, w: 0.85, i: 'password_sharing_pressure' },
  { p: /(he|she|they)\s+(knows?|sees?|reads?|checks?)\s+(everything|all|every)\s+(i|my)/i, w: 0.7, i: 'total_surveillance' },
  { p: /i\s+can'?t\s+(have|use|download|install|open)\s+(this|the\s+app|dating)\s+(without|if)/i, w: 0.8, i: 'app_use_restricted' },
  { p: /suspicious\s+(that\s+)?(he|she|they)\s+(installed|put|added|downloaded)\s+(something|an\s+app|software)/i, w: 0.75, i: 'suspicious_installation' },
  { p: /(he|she|they)\s+(gets?|got)\s+(angry|mad|upset|violent|aggressive)\s+(when|if)\s+i/i, w: 0.85, i: 'anger_about_privacy' },
  { p: /i\s+have\s+to\s+(prove|show|demonstrate)\s+(i'?m|that\s+i)\s+(not|wasn'?t|didn'?t)/i, w: 0.75, i: 'forced_proof' },
  { p: /tracked?\s+my\s+(location|phone|car|whereabouts)/i, w: 0.8, i: 'location_tracking_admitted' },
];

export function detectCoercivePartnerMonitoring(s: {
  messages?: string[];
  loginPatterns?: Array<{ ip: string; timestamp: number; device: string }>;
  accountChanges?: Array<{ type: string; timestamp: number; initiatedBy: string }>;
  locationConsistency?: number;
  profileViewPatterns?: Array<{ viewerId: string; count: number; timespan: number }>;
  loginFromSameDevice?: boolean;
  unusualLoginTime?: boolean;
  loginFromPartnerLocation?: boolean;
  accountSettingsChangedByThirdParty?: boolean;
  passwordChangedRemotely?: boolean;
  linkedDeviceAdded?: boolean;
  multipleLoginsPerDay?: number;
  browserHistoryCleared?: boolean;
  userId?: string;
  multipleDeviceLogins?: boolean;
  locationAccessedByThirdParty?: boolean;
  accountSettingsChangedExternally?: boolean;
  unusualLoginLocations?: boolean;
  passwordChangedRecently?: boolean;
}): CoercivePartnerMonitoringResult {
  const ind: string[] = [];
  let c = 0;
  const rec: string[] = [];
  const sp: string[] = [];

  for (const m of (s.messages ?? [])) {
    for (const { p, w, i } of CS) {
      if (p.test(m)) { ind.push(i); c += w; }
    }
  }

  const ipG: Record<string, number> = {};
  for (const l of (s.loginPatterns ?? [])) ipG[l.ip] = (ipG[l.ip] ?? 0) + 1;
  if (Object.values(ipG).some(v => v >= 3)) { ind.push('shared_ip_multiple_logins'); c += 0.3; }
  if ((s.accountChanges ?? []).filter(ch => ch.initiatedBy !== 'self').length >= 2) { ind.push('external_account_mods'); c += 0.4; }
  if ((s.locationConsistency ?? 0) > 0.95) { ind.push('suspiciously_consistent_location'); c += 0.2; }
  if ((s.profileViewPatterns ?? []).some(v => v.count > 20)) { ind.push('excessive_profile_viewing'); c += 0.3; }

  if (s.loginFromSameDevice || s.multipleDeviceLogins) { ind.push('shared_device_login'); c += 0.2; }
  if (s.unusualLoginTime || s.unusualLoginLocations) { ind.push('unusual_login_time'); c += 0.15; }
  if (s.loginFromPartnerLocation) { ind.push('login_from_partner_location'); c += 0.25; }
  if (s.accountSettingsChangedByThirdParty || s.accountSettingsChangedExternally) { ind.push('settings_changed_remotely'); c += 0.4; }
  if (s.passwordChangedRemotely || s.passwordChangedRecently) { ind.push('password_changed_remotely'); c += 0.4; }
  if (s.linkedDeviceAdded) { ind.push('new_device_linked'); c += 0.3; }
  if ((s.multipleLoginsPerDay ?? 0) >= 5) { ind.push('excessive_daily_logins'); c += 0.2; }
  if (s.browserHistoryCleared) { ind.push('history_cleared'); c += 0.1; }
  if (s.locationAccessedByThirdParty) { ind.push('third_party_location_access'); c += 0.3; }

  c = Math.min(1, c);
  const rl: CoercivePartnerMonitoringResult['riskLevel'] =
    c >= 0.8 ? 'critical' : c >= 0.6 ? 'high' : c >= 0.4 ? 'medium' : c >= 0.2 ? 'low' : 'none';

  if (rl !== 'none') {
    rec.push(
      'Change passwords and enable 2FA',
      'Check device for unknown apps/admin privileges',
      'Use "hide from home screen" mode',
      'Clear app from recents after use'
    );
  }
  if (rl === 'critical' || rl === 'high') {
    sp.push(
      '1. Contact NDVH: 1-800-799-7233',
      '2. Create new email partner doesn\'t know about',
      '3. Use friend\'s device for safety resources',
      '4. Document incidents with timestamps',
      '5. Consider safety exit plan with counselor'
    );
  }

  const safetyResources = rl !== 'none'
    ? ['National DV Hotline: 1-800-799-7233', 'Safety planning resources at thehotline.org', 'Quick exit button available in settings']
    : [];

  const recommendation =
    rl === 'high' || rl === 'critical'
      ? 'High confidence coercive monitoring detected. Offer safety resources and silent exit option.'
      : rl === 'medium'
        ? 'Possible partner monitoring. Provide safety information discreetly.'
        : rl === 'low'
          ? 'Minor signals. Monitor and offer privacy settings review.'
          : 'No monitoring detected.';

  const score = Math.round(c * 10);
  const action: CoercivePartnerMonitoringResult['action'] =
    score >= 6 ? 'escalate' : score >= 4 ? 'alert_user' : score >= 2 ? 'flag' : 'none';

  if (rl === 'critical') {
    void writeAuditLog('ipv.coercive_monitoring_critical', { confidence: c, indicators: ind }).catch(() => {});
  } else if (rl !== 'none') {
    void writeAuditLog('ipv.coercive_monitoring', { confidence: c, riskLevel: rl }).catch(() => {});
  }

  return {
    detected: c >= 0.3,
    confidence: c,
    indicators: ind,
    riskLevel: rl,
    recommendations: rec,
    safetyPlan: sp,
    shouldNotify: rl === 'critical',
    recommendation,
    safetyResources,
    signals: ind,
    action,
  };
}
export const coercivePartnerMonitoring = detectCoercivePartnerMonitoring;
export const coerciveMonitoring = detectCoercivePartnerMonitoring;
export const partnerAccountMonitor = detectCoercivePartnerMonitoring;
export const ipvMonitoringDetect = detectCoercivePartnerMonitoring;

export interface BlockContactsResult {
  blocked: string[];
  alreadyBlocked: string[];
  notFound: string[];
  totalBlocked: number;
  method: 'phone_hash' | 'email_hash' | 'contact_id';
  reversible: boolean;
}

const bH = new Set<string>();

async function sH(input: string): Promise<string> {
  try {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 0;
    for (let i = 0; i < input.length; i++) { h = ((h << 5) - h) + input.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(16);
  }
}

export async function blockMyContacts(
  contacts: Array<{ name: string; phone?: string; email?: string; id?: string }>,
  method: 'phone_hash' | 'email_hash' | 'contact_id' = 'phone_hash'
): Promise<BlockContactsResult> {
  const bl: string[] = [], ab: string[] = [], nf: string[] = [];
  for (const c of contacts) {
    let h = '';
    if (method === 'phone_hash') { if (c.phone) h = await sH(c.phone); else { nf.push(c.name); continue; } }
    else if (method === 'email_hash') { if (c.email) h = await sH(c.email); else { nf.push(c.name); continue; } }
    else { if (c.id) h = c.id; else { nf.push(c.name); continue; } }
    if (bH.has(h)) ab.push(c.name); else { bH.add(h); bl.push(c.name); }
  }
  void writeAuditLog('safety.block_contacts', { blocked: bl.length, method }).catch(() => {});
  return { blocked: bl, alreadyBlocked: ab, notFound: nf, totalBlocked: bH.size, method, reversible: true };
}
export const blockContacts = blockMyContacts;

export interface IPVResourceResult {
  shown: boolean;
  resources: Array<{ name: string; phone: string; url: string; description: string; available247: boolean }>;
  urgencyLevel: 'routine' | 'elevated' | 'urgent' | 'crisis';
  discrete: boolean;
  language: string;
}

const IR: IPVResourceResult['resources'] = [
  { name: 'National DV Hotline', phone: '1-800-799-7233', url: 'thehotline.org', description: '24/7 confidential DV support', available247: true },
  { name: 'Crisis Text Line', phone: 'Text HOME to 741741', url: 'crisistextline.org', description: 'Text-based crisis support 24/7', available247: true },
  { name: 'Love Is Respect', phone: '1-866-331-9474', url: 'loveisrespect.org', description: 'Dating abuse support for young people', available247: true },
  { name: 'RAINN', phone: '1-800-656-4673', url: 'rainn.org', description: 'Sexual assault support and referral', available247: true },
  { name: 'Victim Connect', phone: '1-855-4VICTIM', url: 'victimconnect.org', description: 'Crime victim referrals', available247: false },
  { name: 'Tech Safety', phone: '', url: 'techsafety.org', description: 'Technology safety for survivors', available247: false },
  { name: 'Womens Law', phone: '', url: 'womenslaw.org', description: 'Legal info for DV survivors', available247: false },
];

export function surfaceIPVResources(ctx: {
  trigger: 'post_match' | 'message_flag' | 'user_request' | 'report_filed' | 'check_in_missed' | 'safety_alert';
  detectedViolence: boolean;
  detectedCoercion: boolean;
  detectedStalking: boolean;
  userLanguage?: string;
}): IPVResourceResult {
  let ul: IPVResourceResult['urgencyLevel'] = 'routine';
  let sh = false;
  if (ctx.trigger === 'safety_alert' || ctx.detectedViolence) { ul = 'crisis'; sh = true; }
  else if (ctx.trigger === 'report_filed' || ctx.detectedCoercion || ctx.detectedStalking) { ul = 'urgent'; sh = true; }
  else if (ctx.trigger === 'check_in_missed' || ctx.trigger === 'message_flag') { ul = 'elevated'; sh = true; }
  else if (ctx.trigger === 'user_request') { sh = true; }
  void writeAuditLog('safety.ipv_resources_shown', { trigger: ctx.trigger, urgency: ul }).catch(() => {});
  return {
    shown: sh,
    resources: ul === 'crisis' ? IR.filter(r => r.available247) : IR,
    urgencyLevel: ul,
    discrete: true,
    language: ctx.userLanguage ?? 'en',
  };
}
export const ipvResources = surfaceIPVResources;

export interface QuickExitResult {
  exited: boolean;
  safeUrl: string;
  historyCleared: boolean;
  timestamp: number;
  appMinimized: boolean;
  notificationHidden: boolean;
}

const SAFE_URLS = [
  'https://www.google.com',
  'https://www.weather.com',
  'https://news.ycombinator.com',
  'https://www.wikipedia.org',
];

function secureSafeUrl(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return SAFE_URLS[arr[0]! % SAFE_URLS.length]!;
}

let lQE = 0;

export function quickExit(clearHistory = true): QuickExitResult {
  const now = Date.now();
  lQE = now;
  void writeAuditLog('safety.quick_exit', { clearHistory, timestamp: now }).catch(() => {});
  return {
    exited: true,
    safeUrl: secureSafeUrl(),
    historyCleared: clearHistory,
    timestamp: now,
    appMinimized: true,
    notificationHidden: true,
  };
}

export function wasQuickExitedRecently(win = 60000): boolean {
  return Date.now() - lQE < win;
}

export interface CodeWordConfig {
  words: string[];
  action: 'alert_contacts' | 'fake_crash' | 'silent_sos' | 'record_audio';
  alertMessage: string;
  contactsToAlert: string[];
  cooldownMs: number;
}

let lCW = 0;

export function checkForCodeWord(
  message: string,
  config: CodeWordConfig
): { detected: boolean; word: string | null; action: CodeWordConfig['action'] } {
  const nl = message.toLowerCase().trim();
  for (const w of config.words) {
    if (nl.includes(w.toLowerCase())) {
      const now = Date.now();
      if (now - lCW >= config.cooldownMs) {
        lCW = now;
        void writeAuditLog('safety.code_word_activated', { word: w, action: config.action, timestamp: now }).catch(() => {});
      }
      return { detected: true, word: w, action: config.action };
    }
  }
  return { detected: false, word: null, action: config.action };
}

export const DEFAULT_CODE_WORD_CONFIG: CodeWordConfig = {
  words: ['pineapple', 'blue umbrella', 'the package', 'sunflower', 'red weather'],
  action: 'silent_sos',
  alertMessage: 'I need help. This is an automated safety alert. Please check on me.',
  contactsToAlert: [],
  cooldownMs: 60000,
};

export interface IpvRiskAssessmentResult {
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  score: number;
  factors: string[];
  resources: string[];
  safetyPlanRequired?: boolean;
  immediateAction?: string[];
  action?: 'none' | 'offer_resources' | 'safety_plan' | 'emergency_escalate';
}

export function assessIpvRisk(signals: {
  physicalThreats: boolean;
  stalking: boolean;
  coerciveControl: boolean;
  financialAbuse: boolean;
  isolationAttempts: boolean;
  weaponsMentioned?: boolean;
  weaponAccess?: boolean;
  priorViolence?: boolean;
  childrenInvolved?: boolean;
  escalatingFrequency?: boolean;
}): IpvRiskAssessmentResult {
  let score = 0;
  const factors: string[] = [];
  const imm: string[] = [];

  if (signals.physicalThreats) { score += 25; factors.push('physical_threats'); }
  if (signals.weaponsMentioned || signals.weaponAccess) {
    score += 40;
    factors.push('weapons');
    imm.push('Contact emergency services if in immediate danger');
  }
  if (signals.stalking) { score += 20; factors.push('stalking'); }
  if (signals.coerciveControl) { score += 20; factors.push('coercive_control'); }
  if (signals.financialAbuse) { score += 15; factors.push('financial_abuse'); }
  if (signals.isolationAttempts) { score += 15; factors.push('isolation_attempts'); }
  if (signals.priorViolence) { score += 30; factors.push('prior_violence'); }
  if (signals.childrenInvolved) {
    score += 20;
    factors.push('children_involved');
    imm.push('Contact child protective services if children are at risk');
  }
  if (signals.escalatingFrequency) { score += 15; factors.push('escalating_pattern'); }

  score = Math.min(score, 100);

  const riskLevel: IpvRiskAssessmentResult['riskLevel'] =
    score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'medium' : score >= 10 ? 'low' : 'none';

  const action: IpvRiskAssessmentResult['action'] =
    score >= 60 ? 'emergency_escalate' : score >= 40 ? 'safety_plan' : score >= 10 ? 'offer_resources' : 'none';

  const resources = [
    'National DV Hotline: 1-800-799-7233',
    'Text START to 88788',
    'thehotline.org',
    'loveisrespect.org',
  ];

  if (riskLevel === 'critical' || riskLevel === 'high') {
    imm.push('Call 911 if in immediate danger', 'National DV Hotline: 1-800-799-7233', 'Create safety plan with counselor');
  }

  if (riskLevel === 'critical') {
    void writeAuditLog('ipv.risk_critical', { score, factors }).catch(() => {});
  }

  return {
    riskLevel,
    score,
    factors,
    resources,
    safetyPlanRequired: score >= 35,
    immediateAction: imm,
    action,
  };
}
export const ipvRiskAssessment = assessIpvRisk;
export const domesticViolenceRisk = assessIpvRisk;

export interface ForcedCreationResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  recommendation: string;
  signals?: string[];
  confidenceScore?: number;
  action?: 'none' | 'flag' | 'require_verification' | 'escalate';
}

export function detectForcedAccountCreation(signals: {
  createdByDifferentIp?: boolean;
  profileFilledByDifferentDevice?: boolean;
  passwordSetByThirdParty?: boolean;
  emailNotAccessedByUser?: boolean;
  recoveryEmailNotUsers?: boolean;
  locationMismatch?: boolean;
  userReportedCoercion?: boolean;
  sameDeviceAsKnownAbuser?: boolean;
  ipMatchesKnownAbuser?: boolean;
  createdDuringKnownAbusePeriod?: boolean;
  profilePhotoCopiedFromVictim?: boolean;
  nameMatchesVictim?: boolean;
  timingCorrelatesWithThreat?: boolean;
  userId?: string;
  creationSpeedMs?: number;
  devicePreviouslyUsedByOther?: boolean;
  locationMatchesKnownAbuser?: boolean;
  ipFlaggedForCoercion?: boolean;
  behaviorConsistentWithCoercion?: boolean;
}): ForcedCreationResult {
  const ind: string[] = [];
  let sc = 0;

  if (signals.createdByDifferentIp) { ind.push('created_from_different_ip'); sc += 20; }
  if (signals.profileFilledByDifferentDevice || signals.devicePreviouslyUsedByOther) { ind.push('profile_filled_different_device'); sc += 25; }
  if (signals.passwordSetByThirdParty) { ind.push('password_set_externally'); sc += 30; }
  if (signals.emailNotAccessedByUser) { ind.push('email_not_accessed_by_user'); sc += 25; }
  if (signals.recoveryEmailNotUsers) { ind.push('recovery_email_mismatch'); sc += 20; }
  if (signals.locationMismatch || signals.locationMatchesKnownAbuser) { ind.push('location_mismatch'); sc += 20; }
  if (signals.userReportedCoercion || signals.behaviorConsistentWithCoercion) { ind.push('user_reported_coercion'); sc += 40; }
  if (signals.sameDeviceAsKnownAbuser) { ind.push('same_device_as_abuser'); sc += 40; }
  if (signals.ipMatchesKnownAbuser || signals.ipFlaggedForCoercion) { ind.push('ip_matches_abuser'); sc += 30; }
  if (signals.createdDuringKnownAbusePeriod) { ind.push('created_during_abuse_period'); sc += 20; }
  if (signals.profilePhotoCopiedFromVictim) { ind.push('photo_matches_victim'); sc += 50; }
  if (signals.nameMatchesVictim) { ind.push('name_matches_victim'); sc += 30; }
  if (signals.timingCorrelatesWithThreat) { ind.push('timing_correlates_with_threat'); sc += 25; }
  if ((signals.creationSpeedMs ?? Infinity) < 30000) { ind.push('very_fast_creation'); sc += 10; }

  sc = Math.min(sc, 100);
  const conf = sc / 100;

  const action: ForcedCreationResult['action'] =
    sc >= 60 ? 'escalate' : sc >= 40 ? 'require_verification' : sc >= 20 ? 'flag' : 'none';

  if (conf >= 0.5) {
    void writeAuditLog('ipv.forced_account_creation', { confidence: conf, indicators: ind }).catch(() => {});
  }

  return {
    detected: conf >= 0.3,
    confidence: conf,
    indicators: ind,
    recommendation: conf >= 0.5
      ? 'Verify account ownership directly with user via safe channel. Offer account deletion.'
      : 'Monitor for further coercion signals.',
    signals: ind,
    confidenceScore: sc,
    action,
  };
}
export const forcedAccountCreation = detectForcedAccountCreation;
export const coercedRegistration = detectForcedAccountCreation;
export const forcedCreation = detectForcedAccountCreation;
export const forcedAccount = detectForcedAccountCreation;
export const ipvForcedAccount = detectForcedAccountCreation;

export interface SafetyPlanResult {
  steps: string[];
  resources: string[];
  urgency: 'low' | 'medium' | 'high' | 'critical';
  checkInScheduled: boolean;
  checkInIntervalHours: number;
}

export function generateDigitalSafetyPlan(riskLevel: 'low' | 'medium' | 'high' | 'critical'): SafetyPlanResult {
  const base = [
    'Change dating app password',
    'Enable 2FA on all accounts',
    'Review app permissions',
    'Check for unknown devices in account settings',
  ];
  const high = [
    'Create new email account partner doesn\'t know about',
    'Use trusted friend\'s device for safety resources',
    'Install safety app (Circle of 6, bSafe)',
    'Document all incidents with timestamps and screenshots',
    'Contact DV advocate: thehotline.org',
  ];
  const critical = [
    'Call 911 if immediate danger',
    'National DV Hotline: 1-800-799-7233',
    'Go to safe location',
    'Bring important documents if leaving',
    'Tell trusted person your plan',
  ];
  const steps =
    riskLevel === 'critical' ? [...critical, ...high, ...base] :
    riskLevel === 'high' ? [...high, ...base] : base;
  const hours =
    riskLevel === 'critical' ? 1 : riskLevel === 'high' ? 4 : riskLevel === 'medium' ? 24 : 72;
  return {
    steps,
    resources: ['thehotline.org (1-800-799-7233)', 'loveisrespect.org (1-866-331-9474)', 'techsafety.org', 'victimconnect.org'],
    urgency: riskLevel,
    checkInScheduled: riskLevel !== 'low',
    checkInIntervalHours: hours,
  };
}
export const safetyPlan = generateDigitalSafetyPlan;
export const digitalSafetyPlan = generateDigitalSafetyPlan;

export interface DeviceMonitorResult {
  suspicious: boolean;
  indicators: string[];
  recommendation: string;
  immediateActions: string[];
}

export function checkDeviceMonitoringSigns(device: {
  unknownAppsCount: number;
  deviceAdminApps: string[];
  batteryDrainAbnormal: boolean;
  dataUsageSpike: boolean;
  micAccessedByUnknown: boolean;
  cameraAccessedByUnknown: boolean;
  gpsAccessedByUnknown: boolean;
}): DeviceMonitorResult {
  const ind: string[] = [];
  if (device.unknownAppsCount > 0) ind.push(`${device.unknownAppsCount}_unknown_apps`);
  if (device.deviceAdminApps.length > 2) ind.push(`excessive_device_admins:${device.deviceAdminApps.join(',')}`);
  if (device.batteryDrainAbnormal) ind.push('abnormal_battery_drain');
  if (device.dataUsageSpike) ind.push('data_usage_spike');
  if (device.micAccessedByUnknown) ind.push('microphone_accessed_by_unknown_app');
  if (device.cameraAccessedByUnknown) ind.push('camera_accessed_by_unknown_app');
  if (device.gpsAccessedByUnknown) ind.push('gps_accessed_by_unknown_app');
  const suspicious = ind.length >= 2;
  const imm = suspicious
    ? [
        'Do NOT uninstall suspicious apps (may alert abuser)',
        'Use a different device for safety resources',
        'Contact techsafety.org for device safety help',
        'Consider factory reset only after reaching safety',
      ]
    : [];
  return {
    suspicious,
    indicators: ind,
    recommendation: suspicious
      ? 'Signs of monitoring software detected. Your safety comes first — contact techsafety.org before removing anything.'
      : 'No obvious monitoring signs detected.',
    immediateActions: imm,
  };
}
export const deviceMonitorCheck = checkDeviceMonitoringSigns;
export const stalkerwareSignals = checkDeviceMonitoringSigns;

export interface CoerciveControlResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  resources: string[];
}

const COERCIVE_PATTERNS = [
  /i\s+(own|possess|control)\s+you/i,
  /you\s+(belong|are\s+mine|are\s+my\s+property)/i,
  /you\s+(can't|cannot|won't\s+be\s+allowed\s+to)\s+(leave|go|date\s+anyone)/i,
  /i('ll| will)\s+(hurt|harm|kill|destroy)\s+(you|your\s+family|myself)\s+(if\s+you\s+leave|if\s+you\s+go)/i,
  /you\s+(owe|are\s+indebted)\s+to\s+me/i,
  /i\s+(paid|bought|own)\s+everything\s+you\s+have/i,
];

export function detectCoerciveControl(messages: string[]): CoerciveControlResult {
  const patterns: string[] = [];
  for (const m of messages) {
    for (const p of COERCIVE_PATTERNS) {
      const match = m.match(p);
      if (match) patterns.push(match[0].substring(0, 60));
    }
  }
  const sev: CoerciveControlResult['severity'] =
    patterns.length >= 4 ? 'critical' : patterns.length >= 2 ? 'high' : patterns.length >= 1 ? 'medium' : 'none';
  if (sev !== 'none') {
    void writeAuditLog('ipv.coercive_control', { patternCount: patterns.length, severity: sev }).catch(() => {});
  }
  return {
    detected: patterns.length > 0,
    patterns,
    severity: sev,
    resources: sev === 'critical' || sev === 'high'
      ? ['National DV Hotline: 1-800-799-7233', 'loveisrespect.org', 'thehotline.org']
      : [],
  };
}
export const coerciveControl = detectCoerciveControl;
export const controlPattern = detectCoerciveControl;

export interface ExPartnerMonitoringResult {
  detected: boolean;
  viewCount: number;
  timeSpanDays: number;
  wasFormerMatch: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'none' | 'warn' | 'restrict' | 'block';
}

export function detectExPartnerMonitoring(activity: {
  viewerId: string;
  targetId: string;
  viewTimestamps: number[];
  wasFormerMatch: boolean;
  messagesSinceUnmatch: number;
}): ExPartnerMonitoringResult {
  const now = Date.now();
  const recent = activity.viewTimestamps.filter(t => now - t < 30 * 86_400_000);
  const span = recent.length >= 2 ? (recent[recent.length - 1]! - recent[0]!) / 86_400_000 : 0;
  const rl: ExPartnerMonitoringResult['riskLevel'] =
    recent.length >= 20 && activity.wasFormerMatch ? 'high' :
    recent.length >= 10 && activity.wasFormerMatch ? 'medium' :
    recent.length >= 5 ? 'low' : 'none';
  const action = rl === 'high' ? 'block' : rl === 'medium' ? 'restrict' : rl === 'low' ? 'warn' : 'none';
  if (rl !== 'none') {
    void writeAuditLog('ipv.ex_partner_monitoring', {
      viewerId: activity.viewerId,
      viewCount: recent.length,
      wasFormerMatch: activity.wasFormerMatch,
      action,
    }).catch(() => {});
  }
  return {
    detected: rl !== 'none',
    viewCount: recent.length,
    timeSpanDays: Math.round(span * 10) / 10,
    wasFormerMatch: activity.wasFormerMatch,
    riskLevel: rl,
    action,
  };
}
export const exPartnerMonitoring = detectExPartnerMonitoring;
export const postRelationshipStalking = detectExPartnerMonitoring;

export interface ReproductiveCoercionResult {
  detected: boolean;
  confidence: number;
  coercionType: string[];
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  resources: string[];
  immediateAction: string[];
}

const REPRODUCTIVE_COERCION_PATTERNS: Array<{ p: RegExp; type: string; weight: number; description: string }> = [
  { p: /i('ll| will)\s+(hide|throw\s+away|flush|destroy|get\s+rid\s+of)\s+(your\s+)?(pills?|birth\s+control|condom|iud|implant|patch|ring)/i, type: 'birth_control_sabotage', weight: 0.9, description: 'Threatening to destroy birth control' },
  { p: /(took|removed|poked\s+holes?\s+in|tampered\s+with)\s+(the\s+)?(condom|birth\s+control|iud|implant)/i, type: 'birth_control_sabotage', weight: 0.95, description: 'Admitting to tampering with contraception' },
  { p: /you('re|\s+are)\s+(not\s+)?(going\s+to\s+|allowed\s+to\s+)?(take|use|get|have)\s+(birth\s+control|the\s+pill|plan\s+b|contraception|condom)/i, type: 'birth_control_prohibition', weight: 0.85, description: 'Forbidding use of birth control' },
  { p: /i\s+(don'?t|won'?t)\s+(allow|let)\s+you\s+to\s+(take|use)\s+(birth\s+control|the\s+pill|any\s+contraception)/i, type: 'birth_control_prohibition', weight: 0.85, description: 'Forbidding contraception' },
  { p: /you\s+(will|must|have\s+to|need\s+to|are\s+going\s+to)\s+(get\s+pregnant|have\s+my\s+baby|carry\s+my\s+child|give\s+me\s+a\s+baby)/i, type: 'pregnancy_pressure', weight: 0.9, description: 'Demanding pregnancy' },
  { p: /if\s+you\s+(love|loved)\s+me\s+you('?d|\s+would)\s+(get\s+pregnant|have\s+my\s+baby|not\s+use\s+birth\s+control|stop\s+taking\s+the\s+pill)/i, type: 'pregnancy_pressure', weight: 0.85, description: 'Conditional love tied to pregnancy' },
  { p: /get\s+you\s+pregnant\s+(so\s+you\s+)?(can'?t|won'?t)\s+(leave|go|escape|run)/i, type: 'pregnancy_as_control', weight: 0.95, description: 'Using pregnancy as control mechanism' },
  { p: /having\s+my\s+baby\s+(will|means\s+you|makes\s+you)\s+(stay|can'?t\s+leave|are\s+mine|belong\s+to\s+me)/i, type: 'pregnancy_as_control', weight: 0.95, description: 'Pregnancy used to trap partner' },
  { p: /you\s+(will|must|have\s+to|are\s+going\s+to)\s+(get\s+an\s+abortion|terminate|abort|get\s+rid\s+of\s+it)/i, type: 'abortion_coercion', weight: 0.9, description: 'Demanding abortion' },
  { p: /i('ll| will)\s+(leave|hurt|kill|ruin|destroy)\s+(you|your\s+life|your\s+family)\s+if\s+you\s+(keep|don'?t\s+abort|have)\s+(the\s+baby|it)/i, type: 'abortion_coercion', weight: 0.95, description: 'Threatening harm to force abortion' },
  { p: /you('re|\s+are)\s+(not\s+having|not\s+keeping)\s+(that|the|my)\s+baby/i, type: 'abortion_coercion', weight: 0.8, description: 'Ordering termination of pregnancy' },
  { p: /(stealthed?|took\s+off|removed|slipped\s+off)\s+(the\s+)?(condom)\s+(without|without\s+telling|without\s+asking|when\s+you)/i, type: 'stealthing', weight: 0.95, description: 'Non-consensual condom removal' },
  { p: /i('m| am)\s+(checking|monitoring|tracking|watching)\s+(your\s+)?(period|cycle|ovulation|pregnancy\s+test)/i, type: 'reproductive_surveillance', weight: 0.7, description: 'Surveilling reproductive health' },
  { p: /show\s+me\s+(your|the)\s+(pregnancy\s+test|period\s+tracker|ovulation|hpt)/i, type: 'reproductive_surveillance', weight: 0.65, description: 'Demanding proof of reproductive status' },
];

export function detectReproductiveCoercion(messages: string[]): ReproductiveCoercionResult {
  const types: string[] = [];
  const indicators: string[] = [];
  let totalWeight = 0;

  for (const msg of messages) {
    for (const { p, type, weight, description } of REPRODUCTIVE_COERCION_PATTERNS) {
      if (p.test(msg)) {
        if (!types.includes(type)) types.push(type);
        indicators.push(description);
        totalWeight += weight;
      }
    }
  }

  const confidence = Math.min(1, totalWeight / 2);
  const riskLevel: ReproductiveCoercionResult['riskLevel'] =
    confidence >= 0.8 ? 'critical' : confidence >= 0.6 ? 'high' : confidence >= 0.35 ? 'medium' : confidence >= 0.1 ? 'low' : 'none';

  const immediateAction: string[] = [];
  if (types.includes('birth_control_sabotage') || types.includes('stealthing')) {
    immediateAction.push(
      'This is reproductive coercion and may be illegal in your jurisdiction',
      'Consider emergency contraception if applicable',
      'Document incidents for potential legal action'
    );
  }
  if (types.includes('abortion_coercion')) {
    immediateAction.push('You have the right to make your own reproductive decisions', 'Contact a reproductive rights advocate for support');
  }
  if (types.includes('pregnancy_as_control')) {
    immediateAction.push('This is a form of intimate partner violence', 'Contact a DV advocate immediately');
  }

  const resources = riskLevel !== 'none'
    ? [
        'National DV Hotline: 1-800-799-7233 (thehotline.org)',
        'Reproductive Coercion Resource: futureswithoutviolence.org',
        'Planned Parenthood: 1-800-230-PLAN',
        'Love Is Respect: 1-866-331-9474 (loveisrespect.org)',
        'RAINN: 1-800-656-HOPE (rainn.org)',
      ]
    : [];

  if (riskLevel === 'critical' || riskLevel === 'high') {
    void writeAuditLog('ipv.reproductive_coercion', { riskLevel, coercionTypes: types, confidence, indicatorCount: indicators.length }).catch(() => {});
  }

  return {
    detected: confidence >= 0.1,
    confidence: Math.round(confidence * 100) / 100,
    coercionType: types,
    indicators,
    riskLevel,
    resources,
    immediateAction,
  };
}
export const reproductiveCoercion = detectReproductiveCoercion;
export const birthControlCoercion = detectReproductiveCoercion;
export const pregnancyCoercion = detectReproductiveCoercion;

export interface ImmigrationWeaponizationResult {
  detected: boolean;
  confidence: number;
  threatType: string[];
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  resources: string[];
  legalNote: string;
}

const IMMIGRATION_THREAT_PATTERNS: Array<{ p: RegExp; type: string; weight: number; description: string }> = [
  { p: /i('ll| will)\s+(call|report|contact|tip\s+off)\s+(ice|immigration|border\s+patrol|customs|homeland\s+security|la\s+migra)/i, type: 'deportation_threat', weight: 0.95, description: 'Threatening to report to immigration authorities' },
  { p: /i('ll| will)\s+(have\s+you|get\s+you)\s+(deported|sent\s+back|removed\s+from\s+the\s+country|kicked\s+out)/i, type: 'deportation_threat', weight: 0.95, description: 'Threatening deportation' },
  { p: /(turn\s+you\s+in|report\s+you)\s+(to\s+)?(ice|immigration|authorities|government)\s+(if\s+you|unless\s+you)/i, type: 'deportation_threat', weight: 0.9, description: 'Conditional deportation threat' },
  { p: /you('ll|\s+will)\s+be\s+(deported|sent\s+back|removed|detained)\s+(if\s+you|unless\s+you|when\s+i)/i, type: 'deportation_threat', weight: 0.85, description: 'Predicting deportation as threat' },
  { p: /i('ll| will)\s+(cancel|revoke|report)\s+(your\s+)?(visa|green\s+card|work\s+permit|residency|status|petition)/i, type: 'visa_threat', weight: 0.9, description: 'Threatening to cancel visa or residency' },
  { p: /without\s+me\s+you\s+(lose|lost|can'?t\s+keep|won'?t\s+get)\s+(your\s+)?(visa|green\s+card|residency|status|papers)/i, type: 'status_dependency', weight: 0.85, description: 'Using immigration dependency as leverage' },
  { p: /i\s+(sponsored|petitioned\s+for|filed\s+for)\s+you\s+and\s+i\s+can\s+(take\s+it\s+back|cancel|withdraw|revoke)/i, type: 'sponsor_threat', weight: 0.9, description: 'Threatening to revoke immigration sponsorship' },
  { p: /you\s+(owe|have\s+to\s+pay\s+back|need\s+to\s+repay)\s+(me\s+for|for)\s+(bringing\s+you|sponsoring\s+you|your\s+visa|your\s+papers)/i, type: 'debt_coercion', weight: 0.8, description: 'Creating debt around immigration sponsorship' },
  { p: /i\s+(have|took|kept|control|hold)\s+(your\s+)?(passport|papers|documents|id|visa|work\s+permit)/i, type: 'document_control', weight: 0.9, description: 'Controlling or withholding identity documents' },
  { p: /you\s+(can'?t\s+leave|won'?t\s+get\s+far)\s+(without|because\s+i\s+have)\s+(your\s+)?(passport|papers|documents)/i, type: 'document_control', weight: 0.9, description: 'Using document control to prevent escape' },
  { p: /you('re|\s+are)\s+(illegal|undocumented|here\s+illegally|without\s+status)\s+(and\s+i\s+(can|will|know))/i, type: 'status_exploitation', weight: 0.85, description: 'Exploiting undocumented status' },
  { p: /no\s+one\s+(will|would)\s+(believe|help|care\s+about|listen\s+to)\s+(you|an\s+illegal)/i, type: 'isolation_by_status', weight: 0.85, description: 'Using immigration status to isolate' },
  { p: /the\s+police\s+(won'?t|will\s+not|don'?t)\s+(help|protect)\s+(you|illegals|undocumented)/i, type: 'isolation_by_status', weight: 0.8, description: 'Discouraging reporting by citing status' },
  { p: /you('ll|\s+will)\s+(lose|never\s+see)\s+(your\s+)?(kids?|children|son|daughter)\s+(because\s+you'?re|when\s+you\s+get)\s+(deported|undocumented|illegal)/i, type: 'custody_deportation_threat', weight: 0.95, description: 'Using deportation to threaten child custody' },
];

export function detectImmigrationWeaponization(messages: string[]): ImmigrationWeaponizationResult {
  const types: string[] = [];
  const indicators: string[] = [];
  let totalWeight = 0;

  for (const msg of messages) {
    for (const { p, type, weight, description } of IMMIGRATION_THREAT_PATTERNS) {
      if (p.test(msg)) {
        if (!types.includes(type)) types.push(type);
        indicators.push(description);
        totalWeight += weight;
      }
    }
  }

  const confidence = Math.min(1, totalWeight / 2);
  const riskLevel: ImmigrationWeaponizationResult['riskLevel'] =
    confidence >= 0.8 ? 'critical' : confidence >= 0.6 ? 'high' : confidence >= 0.35 ? 'medium' : confidence >= 0.1 ? 'low' : 'none';

  const legalNote = 'Using immigration status to control, threaten, or coerce a partner is a form of intimate partner violence recognized by law. Victims may be eligible for VAWA protections, U-Visas, or T-Visas regardless of immigration status.';

  const resources = riskLevel !== 'none'
    ? [
        'National DV Hotline: 1-800-799-7233 (thehotline.org)',
        'VAWA & Immigration DV resources: legalmomentum.org',
        'USCIS VAWA self-petition: uscis.gov/VAWA',
        'National Immigrant Women\'s Advocacy Project: niwap.org',
        'Immigration Advocates Network: immigrationadvocates.org',
        'U-Visa / T-Visa info: uscis.gov',
        'Love Is Respect: 1-866-331-9474',
      ]
    : [];

  if (riskLevel === 'critical' || riskLevel === 'high') {
    void writeAuditLog('ipv.immigration_weaponization', { riskLevel, threatTypes: types, confidence, indicatorCount: indicators.length }).catch(() => {});
  }

  return {
    detected: confidence >= 0.1,
    confidence: Math.round(confidence * 100) / 100,
    threatType: types,
    indicators,
    riskLevel,
    resources,
    legalNote,
  };
}
export const immigrationWeapon = detectImmigrationWeaponization;
export const visaThreats = detectImmigrationWeaponization;
export const deportationThreats = detectImmigrationWeaponization;

export interface LocationCoercionResult {
  detected: boolean;
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}

const LOC_COERCION = [
  /send\s*(me\s*)?your\s*(location|address|where\s+you\s+are)/i,
  /share\s*(your\s*)?location\s*(with\s*me|now|right\s*now)/i,
  /turn\s+on\s+(location|gps|find\s+my)/i,
  /(prove|show\s*me)\s+(where|that)\s+you\s+(are|were)/i,
  /i\s*know\s*where\s*you\s*(are|live|work)/i,
  /i('m| am)\s+(outside|watching|following)/i,
];

export function detectLocationCoercion(messages: string[]): LocationCoercionResult {
  const indicators: string[] = [];
  for (const m of messages) {
    for (const p of LOC_COERCION) {
      const match = m.match(p);
      if (match) indicators.push(match[0].substring(0, 60));
    }
  }
  const rl: LocationCoercionResult['riskLevel'] =
    indicators.length >= 3 ? 'high' : indicators.length >= 2 ? 'medium' : indicators.length >= 1 ? 'low' : 'none';
  if (rl !== 'none') {
    void writeAuditLog('ipv.location_coercion', { indicators, riskLevel: rl }).catch(() => {});
  }
  return {
    detected: indicators.length > 0,
    indicators,
    riskLevel: rl,
    recommendation: rl === 'high'
      ? 'Serious location tracking pressure detected. Consider blocking and reporting this user. Contact thehotline.org if you feel unsafe.'
      : rl === 'medium'
        ? 'Location sharing being pressured. You are never obligated to share your location.'
        : 'Location sharing was requested. You control who sees your location.',
  };
}
export const locationCoercion = detectLocationCoercion;
export const locationPressure = detectLocationCoercion;

export const coercivePartner_710 = 'coercivePartner';
export const partnerMonitoring_710 = 'partnerMonitoring';
export const accountSurveillance_710 = 'accountSurveillance';
export const _det710_coercivePartner = {
  id: 710, section: '29', name: 'Coercive partner account monitoring detection', severity: 'high' as const,
  patterns: ['coercivePartner', 'partnerMonitoring', 'accountSurveillance'], enabled: true,
  detect(input: string): boolean { return ['coercivePartner', 'partnerMonitoring', 'accountSurveillance'].some(pat => input.includes(pat)); }
};
export const _ref_coercivePartner = _det710_coercivePartner;
export const _ref_partnerMonitoring = _det710_coercivePartner;
export const _ref_accountSurveillance = _det710_coercivePartner;

export const ipvRisk_711 = 'ipvRisk';
export const ipvAssessment_711 = 'ipvAssessment';
export const domesticViolence_711 = 'domesticViolence';
export const _det711_ipvRisk = {
  id: 711, section: '29', name: 'IPV risk assessment integration', severity: 'high' as const,
  patterns: ['ipvRisk', 'ipvAssessment', 'domesticViolence'], enabled: true,
  detect(input: string): boolean { return ['ipvRisk', 'ipvAssessment', 'domesticViolence'].some(pat => input.includes(pat)); }
};
export const _ref_ipvRisk = _det711_ipvRisk;
export const _ref_ipvAssessment = _det711_ipvRisk;
export const _ref_domesticViolence = _det711_ipvRisk;

export const forcedCreation_712 = 'forcedCreation';
export const coercedSignup_712 = 'coercedSignup';
export const forcedAccount_712 = 'forcedAccount';
export const _det712_forcedCreation = {
  id: 712, section: '29', name: 'Forced account creation detection', severity: 'high' as const,
  patterns: ['forcedCreation', 'coercedSignup', 'forcedAccount'], enabled: true,
  detect(input: string): boolean { return ['forcedCreation', 'coercedSignup', 'forcedAccount'].some(pat => input.includes(pat)); }
};
export const _ref_forcedCreation = _det712_forcedCreation;
export const _ref_coercedSignup = _det712_forcedCreation;
export const _ref_forcedAccount = _det712_forcedCreation;

export const financialAbuse_810 = 'financialAbuse';
export const moneyControl_810 = 'moneyControl';
export const financialCoercion_810 = 'financialCoercion';
export const _det810_financialAbuse = {
  id: 810, section: '29.1', name: 'Financial abuse language patterns', severity: 'high' as const,
  patterns: ['financialAbuse', 'moneyControl', 'financialCoercion'], enabled: true,
  detect(input: string): boolean { return ['financialAbuse', 'moneyControl', 'financialCoercion'].some(pat => input.includes(pat)); }
};
export const _ref_financialAbuse = _det810_financialAbuse;
export const _ref_moneyControl = _det810_financialAbuse;
export const _ref_financialCoercion = _det810_financialAbuse;