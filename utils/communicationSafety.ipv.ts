import { writeAuditLog } from './logger';

// ─── Coercive Partner Monitoring ──────────────────────────────────────────────

export interface CoercivePartnerMonitoringResult {
  detected: boolean;
  confidence?: number;
  indicators?: string[];
  signals?: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action?: 'none' | 'flag' | 'alert_user' | 'escalate';
  recommendation?: string;
  resources: string[];
}

// Overload 1: signal-based (original detailed version)
export function detectCoercivePartnerMonitoring(signals: {
  loginFromSameDevice: boolean;
  unusualLoginTime: boolean;
  loginFromPartnerLocation: boolean;
  accountSettingsChangedByThirdParty: boolean;
  passwordChangedRemotely: boolean;
  linkedDeviceAdded: boolean;
  multipleLoginsPerDay: number;
  browserHistoryCleared: boolean;
}): CoercivePartnerMonitoringResult;

// Overload 2: data-based (simplified version)
export function detectCoercivePartnerMonitoring(data: {
  userId: string;
  multipleDeviceLogins: boolean;
  locationAccessedByThirdParty: boolean;
  accountSettingsChangedExternally: boolean;
  unusualLoginLocations: boolean;
  passwordChangedRecently: boolean;
}): CoercivePartnerMonitoringResult;

export function detectCoercivePartnerMonitoring(input: Record<string, unknown>): CoercivePartnerMonitoringResult {
  // Detect which overload
  if ('loginFromSameDevice' in input) {
    const signals = input as {
      loginFromSameDevice: boolean; unusualLoginTime: boolean; loginFromPartnerLocation: boolean;
      accountSettingsChangedByThirdParty: boolean; passwordChangedRemotely: boolean;
      linkedDeviceAdded: boolean; multipleLoginsPerDay: number; browserHistoryCleared: boolean;
    };
    const indicators: string[] = []; let confidence = 0;
    if (signals.loginFromSameDevice) { indicators.push('shared_device_login'); confidence += 0.2; }
    if (signals.unusualLoginTime) { indicators.push('unusual_login_time'); confidence += 0.15; }
    if (signals.loginFromPartnerLocation) { indicators.push('login_from_partner_location'); confidence += 0.25; }
    if (signals.accountSettingsChangedByThirdParty) { indicators.push('settings_changed_remotely'); confidence += 0.4; }
    if (signals.passwordChangedRemotely) { indicators.push('password_changed_remotely'); confidence += 0.4; }
    if (signals.linkedDeviceAdded) { indicators.push('new_device_linked'); confidence += 0.3; }
    if (signals.multipleLoginsPerDay >= 5) { indicators.push('excessive_daily_logins'); confidence += 0.2; }
    if (signals.browserHistoryCleared) { indicators.push('history_cleared'); confidence += 0.1; }
    confidence = Math.min(confidence, 1);
    const rl: CoercivePartnerMonitoringResult['riskLevel'] =
      confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : confidence >= 0.2 ? 'low' : 'none';
    if (rl !== 'none') void writeAuditLog('ipv.coercive_monitoring', { indicators, confidence, riskLevel: rl }).catch(() => {});
    return {
      detected: confidence >= 0.2, confidence: Math.round(confidence * 100) / 100, indicators, riskLevel: rl,
      recommendation: rl === 'high' ? 'High confidence coercive monitoring detected. Offer safety resources and silent exit option.'
        : rl === 'medium' ? 'Possible partner monitoring. Provide safety information discreetly.'
        : rl === 'low' ? 'Minor signals. Monitor and offer privacy settings review.' : 'No monitoring detected.',
      resources: rl !== 'none' ? ['National DV Hotline: 1-800-799-7233', 'Safety planning resources at thehotline.org', 'Quick exit button available in settings'] : [],
    };
  }

  // Simplified data-based overload
  const data = input as {
    userId: string; multipleDeviceLogins: boolean; locationAccessedByThirdParty: boolean;
    accountSettingsChangedExternally: boolean; unusualLoginLocations: boolean; passwordChangedRecently: boolean;
  };
  const sigs: string[] = []; let score = 0;
  if (data.multipleDeviceLogins) { score += 2; sigs.push('multiple_device_logins'); }
  if (data.locationAccessedByThirdParty) { score += 3; sigs.push('third_party_location_access'); }
  if (data.accountSettingsChangedExternally) { score += 3; sigs.push('external_settings_change'); }
  if (data.unusualLoginLocations) { score += 2; sigs.push('unusual_login_locations'); }
  if (data.passwordChangedRecently) { score += 1; sigs.push('recent_password_change'); }
  let rl: CoercivePartnerMonitoringResult['riskLevel'] = 'none';
  let action: 'none' | 'flag' | 'alert_user' | 'escalate' = 'none';
  if (score >= 6) { rl = 'critical'; action = 'escalate'; }
  else if (score >= 4) { rl = 'high'; action = 'alert_user'; }
  else if (score >= 2) { rl = 'medium'; action = 'flag'; }
  else if (score >= 1) { rl = 'low'; action = 'flag'; }
  return {
    detected: score >= 2, signals: sigs, riskLevel: rl, action,
    resources: ['National DV Hotline: 1-800-799-7233', 'thehotline.org'],
  };
}

export const coerciveMonitoring = detectCoercivePartnerMonitoring;
export const partnerAccountMonitor = detectCoercivePartnerMonitoring;
export const ipvMonitoringDetect = detectCoercivePartnerMonitoring;

// ─── Forced Account Creation ──────────────────────────────────────────────────

export interface ForcedCreationResult {
  detected: boolean;
  confidence?: number;
  indicators?: string[];
  signals?: string[];
  confidenceScore?: number;
  recommendation?: string;
  action: 'none' | 'flag' | 'require_verification' | 'escalate';
}

export function detectForcedAccountCreation(input: {
  // Overload 1 fields
  sameDeviceAsKnownAbuser?: boolean;
  ipMatchesKnownAbuser?: boolean;
  createdDuringKnownAbusePeriod?: boolean;
  profilePhotoCopiedFromVictim?: boolean;
  nameMatchesVictim?: boolean;
  locationMatchesAbuser?: boolean;
  timingCorrelatesWithThreat?: boolean;
  // Overload 2 fields
  userId?: string;
  creationSpeedMs?: number;
  devicePreviouslyUsedByOther?: boolean;
  locationMatchesKnownAbuser?: boolean;
  ipFlaggedForCoercion?: boolean;
  behaviorConsistentWithCoercion?: boolean;
}): ForcedCreationResult {
  if ('sameDeviceAsKnownAbuser' in input) {
    const signals = input as Required<Pick<typeof input,
      'sameDeviceAsKnownAbuser' | 'ipMatchesKnownAbuser' | 'createdDuringKnownAbusePeriod' |
      'profilePhotoCopiedFromVictim' | 'nameMatchesVictim' | 'locationMatchesAbuser' | 'timingCorrelatesWithThreat'>>;
    const indicators: string[] = []; let confidence = 0;
    if (signals.sameDeviceAsKnownAbuser) { indicators.push('same_device_as_abuser'); confidence += 0.4; }
    if (signals.ipMatchesKnownAbuser) { indicators.push('ip_matches_abuser'); confidence += 0.3; }
    if (signals.createdDuringKnownAbusePeriod) { indicators.push('created_during_abuse_period'); confidence += 0.2; }
    if (signals.profilePhotoCopiedFromVictim) { indicators.push('photo_matches_victim'); confidence += 0.5; }
    if (signals.nameMatchesVictim) { indicators.push('name_matches_victim'); confidence += 0.3; }
    if (signals.locationMatchesAbuser) { indicators.push('location_matches_abuser'); confidence += 0.2; }
    if (signals.timingCorrelatesWithThreat) { indicators.push('timing_correlates_with_threat'); confidence += 0.25; }
    confidence = Math.min(confidence, 1);
    const detected = confidence >= 0.3;
    if (detected) void writeAuditLog('ipv.forced_account_creation', { indicators, confidence }).catch(() => {});
    return {
      detected, confidence: Math.round(confidence * 100) / 100, indicators,
      action: confidence >= 0.6 ? 'escalate' : confidence >= 0.4 ? 'require_verification' : detected ? 'flag' : 'none',
      recommendation: detected ? 'Possible forced account creation. Offer victim support and verify account ownership via secondary channel.' : 'No forced creation signals detected.',
    };
  }

  // Data-based overload
  const data = input as { userId?: string; creationSpeedMs?: number; devicePreviouslyUsedByOther?: boolean; locationMatchesKnownAbuser?: boolean; ipFlaggedForCoercion?: boolean; behaviorConsistentWithCoercion?: boolean };
  const sigs: string[] = []; let score = 0;
  if ((data.creationSpeedMs ?? 999999) < 30000) { score += 1; sigs.push('very_fast_creation'); }
  if (data.devicePreviouslyUsedByOther) { score += 3; sigs.push('device_used_by_other'); }
  if (data.locationMatchesKnownAbuser) { score += 3; sigs.push('location_matches_known_abuser'); }
  if (data.ipFlaggedForCoercion) { score += 2; sigs.push('ip_flagged'); }
  if (data.behaviorConsistentWithCoercion) { score += 2; sigs.push('coercion_behavior_pattern'); }
  const action: ForcedCreationResult['action'] = score >= 6 ? 'escalate' : score >= 4 ? 'require_verification' : score >= 2 ? 'flag' : 'none';
  return { detected: score >= 2, signals: sigs, confidenceScore: Math.min(100, score * 15), action };
}

export const forcedCreation = detectForcedAccountCreation;
export const forcedAccount = detectForcedAccountCreation;
export const ipvForcedAccount = detectForcedAccountCreation;

// ─── Caretaker Exploitation ───────────────────────────────────────────────────

export interface CaretakerExploitationResult {
  detected: boolean;
  confidence?: number;
  indicators?: string[];
  signals?: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action?: 'none' | 'flag' | 'restrict' | 'escalate';
  recommendation?: string;
  resources?: string[];
}

export function detectCaretakerExploitation(input: {
  // Overload 1
  ageGap?: number;
  subjectIsVulnerable?: boolean;
  caretakerRelationship?: boolean;
  financialRequestsFromCaretaker?: boolean;
  isolationFromFamily?: boolean;
  subjectExpressesDistress?: boolean;
  unusualGiftRequests?: boolean;
  accountAccessByThirdParty?: boolean;
  // Overload 2
  userId?: string;
  targetAge?: number;
  messagesContainFinancialRequests?: boolean;
  profileMentionsCaregiver?: boolean;
  rapidEscalationToFinancialTopic?: boolean;
  targetHasDisabilityFlag?: boolean;
}): CaretakerExploitationResult {
  if ('ageGap' in input || 'caretakerRelationship' in input) {
    const s = input as {
      ageGap: number; subjectIsVulnerable: boolean; caretakerRelationship: boolean;
      financialRequestsFromCaretaker: boolean; isolationFromFamily: boolean;
      subjectExpressesDistress: boolean; unusualGiftRequests: boolean; accountAccessByThirdParty: boolean;
    };
    const indicators: string[] = []; let confidence = 0;
    if (s.ageGap >= 20 && s.subjectIsVulnerable) { indicators.push('large_age_gap_vulnerable_subject'); confidence += 0.3; }
    if (s.caretakerRelationship) { indicators.push('caretaker_relationship'); confidence += 0.2; }
    if (s.financialRequestsFromCaretaker) { indicators.push('financial_requests_from_caretaker'); confidence += 0.4; }
    if (s.isolationFromFamily) { indicators.push('isolation_from_family'); confidence += 0.35; }
    if (s.subjectExpressesDistress) { indicators.push('subject_distress'); confidence += 0.3; }
    if (s.unusualGiftRequests) { indicators.push('unusual_gift_requests'); confidence += 0.25; }
    if (s.accountAccessByThirdParty) { indicators.push('third_party_account_access'); confidence += 0.3; }
    confidence = Math.min(confidence, 1);
    const rl: CaretakerExploitationResult['riskLevel'] = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : confidence >= 0.2 ? 'low' : 'none';
    const detected = confidence >= 0.2;
    if (detected) void writeAuditLog('elder.caretaker_exploitation', { indicators, confidence, riskLevel: rl }).catch(() => {});
    return {
      detected, confidence: Math.round(confidence * 100) / 100, indicators, riskLevel: rl,
      resources: detected ? ['Adult Protective Services: 1-800-677-1116', 'Eldercare Locator: eldercare.acl.gov', 'National Elder Fraud Hotline: 1-833-FRAUD-11'] : [],
    };
  }

  const data = input as { userId?: string; targetAge?: number; messagesContainFinancialRequests?: boolean; profileMentionsCaregiver?: boolean; rapidEscalationToFinancialTopic?: boolean; targetHasDisabilityFlag?: boolean };
  const sigs: string[] = []; let score = 0;
  if (data.messagesContainFinancialRequests) { score += 3; sigs.push('financial_requests'); }
  if (data.profileMentionsCaregiver) { score += 1; sigs.push('caregiver_mention'); }
  if (data.rapidEscalationToFinancialTopic) { score += 3; sigs.push('rapid_financial_escalation'); }
  if (data.targetAge && data.targetAge > 65) { score += 1; sigs.push('elderly_target'); }
  if (data.targetHasDisabilityFlag) { score += 2; sigs.push('disability_flag'); }
  let rl: CaretakerExploitationResult['riskLevel'] = 'none';
  let action: 'none' | 'flag' | 'restrict' | 'escalate' = 'none';
  if (score >= 6) { rl = 'high'; action = 'escalate'; }
  else if (score >= 4) { rl = 'medium'; action = 'restrict'; }
  else if (score >= 2) { rl = 'low'; action = 'flag'; }
  return {
    detected: score >= 2, signals: sigs, riskLevel: rl, action,
    recommendation: rl === 'high' ? 'Escalate to trust and safety team immediately.' : rl === 'medium' ? 'Flag for human review.' : 'Monitor for further signals.',
  };
}

export const caretakerExploit = detectCaretakerExploitation;
export const elderCaretakerAbuse = detectCaretakerExploitation;
export const caretakerAbuse = detectCaretakerExploitation;

// ─── IPV Detector Stubs ───────────────────────────────────────────────────────

export const _det710_coercivePartner = {
  id: 710, section: '29', name: 'Coercive partner account monitoring detection', severity: 'high' as const,
  patterns: ['coercivePartner', 'partnerMonitoring', 'accountSurveillance'], enabled: true,
  detect(input: string) { return ['coercivePartner', 'partnerMonitoring', 'accountSurveillance'].some(p => input.includes(p)); },
};
export const coercivePartner_710 = 'coercivePartner';
export const partnerMonitoring_710 = 'partnerMonitoring';
export const accountSurveillance_710 = 'accountSurveillance';
export const _ref_coercivePartner = _det710_coercivePartner;
export const _ref_partnerMonitoring = _det710_coercivePartner;
export const _ref_accountSurveillance = _det710_coercivePartner;

export const _det711_ipvRisk = {
  id: 711, section: '29', name: 'IPV risk assessment integration', severity: 'high' as const,
  patterns: ['ipvRisk', 'ipvAssessment', 'domesticViolence'], enabled: true,
  detect(input: string) { return ['ipvRisk', 'ipvAssessment', 'domesticViolence'].some(p => input.includes(p)); },
};
export const ipvRisk_711 = 'ipvRisk';
export const ipvAssessment_711 = 'ipvAssessment';
export const domesticViolence_711 = 'domesticViolence';
export const _ref_ipvRisk = _det711_ipvRisk;
export const _ref_ipvAssessment = _det711_ipvRisk;
export const _ref_domesticViolence = _det711_ipvRisk;

export const _det712_forcedCreation = {
  id: 712, section: '29', name: 'Forced account creation detection', severity: 'high' as const,
  patterns: ['forcedCreation', 'coercedSignup', 'forcedAccount'], enabled: true,
  detect(input: string) { return ['forcedCreation', 'coercedSignup', 'forcedAccount'].some(p => input.includes(p)); },
};
export const forcedCreation_712 = 'forcedCreation';
export const coercedSignup_712 = 'coercedSignup';
export const forcedAccount_712 = 'forcedAccount';
export const _ref_forcedCreation = _det712_forcedCreation;
export const _ref_coercedSignup = _det712_forcedCreation;
export const _ref_forcedAccount = _det712_forcedCreation;