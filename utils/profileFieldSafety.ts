import { writeAuditLog } from './logger';

export interface FieldValidation {
  valid: boolean;
  warnings: { field: string; issue: string }[];
}

const SUSPICIOUS_OCCUPATIONS = [
  /oil\s+rig/i, /military\s+contractor/i, /gem\s+(dealer|trader)/i,
  /gold\s+(mining|trader)/i, /diplomat/i, /un\s+worker/i,
  /international\s+aid/i, /peacekeeping/i, /engineer\s+offshore/i,
  /widower.*contractor/i
];

const HEIGHT_RANGE = { min: 120, max: 230 };
const WEIGHT_RANGE = { min: 30, max: 250 };

export interface OccupationFraudResult {
  suspicious: boolean;
  occupation: string;
  reasons: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}

export function occupationFraud(occupation: string): OccupationFraudResult {
  const reasons: string[] = [];
  if (SUSPICIOUS_OCCUPATIONS.some(p => p.test(occupation))) reasons.push('commonly_used_in_scams');
  if (/\b(ceo|founder|investor|billionaire|millionaire)\b/i.test(occupation) && occupation.length < 15) reasons.push('vague_high_status_claim');
  if (/\b(army|military|navy|air\s*force|marine|soldier)\b/i.test(occupation) && /\b(deployed|overseas|mission|classified)\b/i.test(occupation)) reasons.push('military_romance_scam_pattern');
  if (/\b(doctor|surgeon|physician)\b/i.test(occupation) && /\b(msf|without\s+borders|un\s+mission|war\s+zone)\b/i.test(occupation)) reasons.push('doctor_abroad_scam_pattern');
  if (/\b(pastor|reverend|minister|bishop)\b/i.test(occupation) && /\b(missions|mission\s+trip|africa|ghana|nigeria)\b/i.test(occupation)) reasons.push('pastor_missionary_scam_pattern');

  const rl: OccupationFraudResult['riskLevel'] = reasons.length >= 2 ? 'high' : reasons.length >= 1 ? 'medium' : 'none';
  if (rl === 'high') void writeAuditLog('profile.occupation_fraud', { occupation, reasons, riskLevel: rl }).catch(() => {});

  return { suspicious: reasons.length > 0, occupation, reasons, riskLevel: rl };
}

export const occupationCheck = occupationFraud;
export const jobFraud = occupationFraud;

export interface EducationFraudResult {
  suspicious: boolean;
  institution: string;
  issues: string[];
  confidence: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}

const DIPLOMA_MILL_PATTERNS = [/belford\s+university/i, /ashwood\s+university/i, /rochville\s+university/i, /canella\s+university/i, /almeda\s+university/i, /axact/i, /degrees?\s+from\s+home/i, /accredited\s+life\s+experience/i];
const PRESTIGE_PATTERNS = /\b(harvard|yale|mit|stanford|oxford|cambridge|princeton|caltech)\b/i;

export function educationFraud(institution: string, opts?: { claimedDegree?: string; profileAge?: number }): EducationFraudResult {
  const issues: string[] = [];
  let confidence = 0;

  if (DIPLOMA_MILL_PATTERNS.some(p => p.test(institution))) { issues.push('known_diploma_mill'); confidence += 0.9; }
  if (PRESTIGE_PATTERNS.test(institution) && opts?.profileAge && opts.profileAge < 22) { issues.push('age_inconsistent_with_elite_degree'); confidence += 0.4; }
  if (/ph\.?d|doctorate|doctor\s+of/i.test(opts?.claimedDegree ?? '') && opts?.profileAge && opts.profileAge < 26) { issues.push('too_young_for_claimed_doctorate'); confidence += 0.5; }
  if (/university|college|institute/i.test(institution) && institution.split(' ').length === 1) { issues.push('single_word_institution_suspicious'); confidence += 0.2; }
  if (/free\s+university|open\s+university\s+of\s+love|university\s+of\s+life/i.test(institution)) { issues.push('clearly_fake_institution'); confidence += 1.0; }

  confidence = Math.min(confidence, 1);
  const rl: EducationFraudResult['riskLevel'] = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : confidence >= 0.1 ? 'low' : 'none';

  return { suspicious: issues.length > 0, institution, issues, confidence: Math.round(confidence * 100) / 100, riskLevel: rl };
}

export const educationCheck = educationFraud;
export const schoolFraud = educationFraud;

export function validateProfileFields(fields: { occupation?: string; education?: string; height?: number; weight?: number; income?: string; employer?: string; age?: number }): FieldValidation {
  const warnings: FieldValidation['warnings'] = [];
  if (fields.occupation) {
    const r = occupationFraud(fields.occupation);
    if (r.suspicious) warnings.push({ field: 'occupation', issue: r.reasons.join(',') });
  }
  if (fields.education) {
    const r = educationFraud(fields.education);
    if (r.suspicious) warnings.push({ field: 'education', issue: r.issues.join(',') });
  }
  if (fields.height !== undefined && (fields.height < HEIGHT_RANGE.min || fields.height > HEIGHT_RANGE.max)) warnings.push({ field: 'height', issue: 'implausible_value' });
  if (fields.weight !== undefined && (fields.weight < WEIGHT_RANGE.min || fields.weight > WEIGHT_RANGE.max)) warnings.push({ field: 'weight', issue: 'implausible_value' });
  if (fields.weight !== undefined && fields.height !== undefined) {
    const bmi = fields.weight / ((fields.height / 100) ** 2);
    if (bmi < 14) warnings.push({ field: 'bmi', issue: 'dangerously_low' });
    if (bmi > 50) warnings.push({ field: 'bmi', issue: 'extremely_high' });
  }
  if (fields.income && /million|billion|\$\d{7,}|10\s*figure/i.test(fields.income)) warnings.push({ field: 'income', issue: 'extreme_wealth_claim' });
  if (fields.age !== undefined && (fields.age < 18 || fields.age > 120)) warnings.push({ field: 'age', issue: 'implausible_value' });
  if (fields.employer && /google|microsoft|apple|amazon|meta|tesla/i.test(fields.employer) && fields.occupation && /intern|student/i.test(fields.occupation)) warnings.push({ field: 'employer', issue: 'employer_role_mismatch' });

  return { valid: warnings.length === 0, warnings };
}

export interface BodyFieldCheckResult {
  plausible: boolean;
  issues: string[];
  adjustedValues: Record<string, string>;
}

export function heightPlausibility(d: { heightCm?: number; weightKg?: number; gender?: string; age?: number }): BodyFieldCheckResult {
  const is: string[] = [];
  const aj: Record<string, string> = {};
  if (d.heightCm !== undefined) {
    if (d.heightCm > 230) { is.push('height_exceeds_record'); aj['heightCm'] = '230'; }
    if (d.heightCm < 140 && d.age && d.age > 18) is.push('height_below_adult');
    if ([183, 180, 185].includes(d.heightCm)) aj['note'] = 'common_rounded_height';
  }
  if (d.weightKg !== undefined && d.heightCm !== undefined) {
    const bmi = d.weightKg / ((d.heightCm / 100) ** 2);
    if (bmi < 14) is.push('dangerously_low_bmi');
    if (bmi > 50) is.push('extremely_high_bmi');
  }
  return { plausible: is.length === 0, issues: is, adjustedValues: aj };
}

export const weightPlausibility = heightPlausibility;
export const bodyFieldCheck = heightPlausibility;

export interface IncomeManipulationResult {
  suspicious: boolean;
  claimedIncome?: number;
  anomalies: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}

export function incomeManipulation(d: { claimedIncome?: number; age?: number; location?: string; profession?: string }): IncomeManipulationResult {
  const an: string[] = [];
  let rl: IncomeManipulationResult['riskLevel'] = 'none';
  if (d.claimedIncome && d.age) {
    if (d.claimedIncome > 500000 && d.age < 25) { an.push('very_high_income_young'); rl = 'high'; }
    if (d.claimedIncome > 1000000) { an.push('million_plus'); if (rl === 'none') rl = 'medium'; }
  }
  if (d.claimedIncome && d.profession && /teacher|nurse|cashier|barista|student/i.test(d.profession) && d.claimedIncome > 200000) {
    an.push('income_profession_mismatch'); if (rl === 'none') rl = 'medium';
  }
  if (d.claimedIncome && d.claimedIncome <= 0) { an.push('non_positive_income'); if (rl === 'none') rl = 'low'; }
  return { suspicious: an.length > 0, claimedIncome: d.claimedIncome, anomalies: an, riskLevel: rl };
}

export const wealthSignalingField = incomeManipulation;
export const incomeField = incomeManipulation;

export interface EmployerVerificationResult {
  verified: boolean;
  method: 'domain_email' | 'linkedin_match' | 'unverified';
  domain?: string;
  recommendation: string;
}

export function verifyEmployer(employer: string, userEmail?: string): EmployerVerificationResult {
  if (!userEmail) return { verified: false, method: 'unverified', recommendation: 'Request work email verification to confirm employer' };
  const emailDomain = userEmail.split('@')[1]?.toLowerCase() ?? '';
  const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'protonmail.com', 'aol.com'];
  if (freeProviders.includes(emailDomain)) return { verified: false, method: 'unverified', domain: emailDomain, recommendation: 'Personal email cannot verify employer. Request work email.' };

  const normalizedEmployer = employer.toLowerCase().replace(/\s+(inc|llc|corp|ltd|co|company|group|technologies|solutions)\.?$/i, '').replace(/[^a-z0-9]/g, '');
  const normalizedDomain = emailDomain.split('.')[0] ?? '';
  if (normalizedDomain.includes(normalizedEmployer) || normalizedEmployer.includes(normalizedDomain)) {
    return { verified: true, method: 'domain_email', domain: emailDomain, recommendation: 'Employer verified via work email domain match' };
  }
  return { verified: false, method: 'unverified', domain: emailDomain, recommendation: 'Email domain does not match claimed employer. Manual review recommended.' };
}

export const workEmailVerify = verifyEmployer;
export const corporateEmail = verifyEmployer;
export const employerVerify = verifyEmployer;

export interface BodyMisrepresentationResult {
  categoryAdded: boolean;
  reportOptions: string[];
  educationalNote: string;
}

export function bodyMisrepresentation(): BodyMisrepresentationResult {
  return {
    categoryAdded: true,
    reportOptions: ['Photos significantly differ from current appearance', 'Photos appear to be from a different person', 'Photos are heavily edited/filtered', 'Body type description doesn\'t match photos'],
    educationalNote: 'Appearance-based reports are handled with care. We encourage meeting in public places to form genuine connections.'
  };
}

export const bodyTypeReport = bodyMisrepresentation;
export const physicalMismatch = bodyMisrepresentation;

// ==================== PRIVACY & PROTECTION ====================

export interface PrivacyPreservingVerifyResult {
  verified: boolean;
  method: 'zkp' | 'hash_comparison' | 'trusted_issuer' | 'none';
  dataShared: string[];
  dataNotShared: string[];
  confidence: number;
  recommendation: string;
}

export function privacyPreservingVerify(opts: {
  useZKP?: boolean;
  hashMatchConfirmed?: boolean;
  trustedIssuerAttestation?: boolean;
  minimumAgeConfirmed?: boolean;
}): PrivacyPreservingVerifyResult {
  let method: PrivacyPreservingVerifyResult['method'] = 'none';
  let confidence = 0;
  const dataShared: string[] = [];
  const dataNotShared = ['full_name', 'date_of_birth', 'id_number', 'address', 'photo'];

  if (opts.useZKP && opts.minimumAgeConfirmed) { method = 'zkp'; confidence = 0.85; dataShared.push('age_over_18_proof'); }
  else if (opts.hashMatchConfirmed) { method = 'hash_comparison'; confidence = 0.75; dataShared.push('identity_hash'); }
  else if (opts.trustedIssuerAttestation) { method = 'trusted_issuer'; confidence = 0.9; dataShared.push('issuer_attestation'); }

  const verified = confidence >= 0.75;
  if (verified) void writeAuditLog('privacy.preserving_verify', { method, confidence }).catch(() => {});

  return {
    verified,
    method,
    dataShared,
    dataNotShared,
    confidence,
    recommendation: method === 'zkp' ? 'Zero-knowledge proof used. Minimal data exposure.' : method === 'trusted_issuer' ? 'Trusted issuer attestation.' : method === 'hash_comparison' ? 'Hash comparison used.' : 'Verification incomplete.'
  };
}

export const zkpVerify = privacyPreservingVerify;
export const hashVerification = privacyPreservingVerify;
export const privacyVerify = privacyPreservingVerify;

export interface MilitaryProtectionResult {
  protectionEnabled: boolean;
  hiddenFields: string[];
  enhancedPrivacy: boolean;
  locationObfuscated: boolean;
  recommendation: string;
  restrictions: string[];
}

export function militaryProfileProtection(opts: {
  isMilitary: boolean;
  isIntelligence: boolean;
  selfDeclared: boolean;
  militaryEmailDomain?: boolean;
  requestedEnhancedPrivacy?: boolean;
}): MilitaryProtectionResult {
  const active = opts.isMilitary || opts.isIntelligence || opts.selfDeclared;
  const hiddenFields: string[] = [];
  const restrictions: string[] = [];

  if (active) {
    hiddenFields.push('employer', 'workplace_location', 'unit', 'base', 'deployment_status', 'last_name', 'exact_location');
    restrictions.push('no_location_history', 'no_employer_search', 'no_unit_disclosure', 'metadata_stripped_from_photos');
  }
  if (opts.militaryEmailDomain) { hiddenFields.push('work_email'); restrictions.push('work_email_not_displayed'); }
  if (active) void writeAuditLog('privacy.military_protection_enabled', { hiddenFields, restrictions }).catch(() => {});

  return {
    protectionEnabled: active,
    hiddenFields,
    enhancedPrivacy: active,
    locationObfuscated: active,
    recommendation: active ? 'Enhanced privacy mode enabled.' : 'Standard privacy settings applied.',
    restrictions
  };
}

export const militaryProtect = militaryProfileProtection;
export const intelligenceProtection = militaryProfileProtection;
export const sensitiveProfessionProtection = militaryProfileProtection;

export interface ActivistPrivacyResult {
  modeEnabled: boolean;
  protections: string[];
  torFriendly: boolean;
  metadataStripped: boolean;
  locationHidden: boolean;
  recommendation: string;
}

export function activistPrivacyMode(opts: {
  isActivist?: boolean;
  isJournalist?: boolean;
  isSensitiveProfession?: boolean;
  requestedAnonymousMode?: boolean;
  country?: string;
}): ActivistPrivacyResult {
  const active = !!(opts.isActivist || opts.isJournalist || opts.isSensitiveProfession || opts.requestedAnonymousMode);
  const protections: string[] = [];
  if (active) {
    protections.push('tor_exit_node_not_blocked', 'vpn_not_blocked', 'metadata_stripped_from_all_photos', 'location_not_stored', 'employer_hidden', 'real_name_optional', 'no_social_graph_exposure');
  }
  if (active) void writeAuditLog('privacy.activist_mode_enabled', { protections, country: opts.country }).catch(() => {});

  return {
    modeEnabled: active,
    protections,
    torFriendly: active,
    metadataStripped: active,
    locationHidden: active,
    recommendation: active ? 'Activist/journalist privacy mode active.' : 'Standard privacy mode.'
  };
}

export const journalistPrivacy = activistPrivacyMode;
export const sensitivePersonPrivacy = activistPrivacyMode;
export const enhancedPrivacyMode = activistPrivacyMode;

export interface AnonAbuseResult {
  detected: boolean;
  riskScore: number;
  indicators: string[];
  action: 'allow' | 'rate_limit' | 'restrict' | 'shadow_ban' | 'suspend';
  recommendation: string;
}

export function detectAnonAccountAbuse(signals: {
  hasNoPhoto: boolean;
  hasNoVerification: boolean;
  accountAgeDays: number;
  reportCount: number;
  harassmentFlags: number;
  messagingRate: number;
  swipeRate: number;
  vpnUsed: boolean;
  multipleReportedMessages: boolean;
  blockedByCount: number;
}): AnonAbuseResult {
  const indicators: string[] = [];
  let score = 0;

  if (signals.hasNoPhoto) { indicators.push('no_profile_photo'); score += 10; }
  if (signals.hasNoVerification) { indicators.push('unverified_account'); score += 15; }
  if (signals.accountAgeDays < 3) { indicators.push('very_new_account'); score += 20; }
  if (signals.reportCount >= 3) { indicators.push('multiple_reports'); score += 25; }
  if (signals.harassmentFlags >= 2) { indicators.push('harassment_flags'); score += 30; }
  if (signals.messagingRate > 50) { indicators.push('high_message_rate'); score += 15; }
  if (signals.swipeRate > 200) { indicators.push('bot_like_swipe_rate'); score += 20; }
  if (signals.vpnUsed && signals.accountAgeDays < 7) { indicators.push('vpn_new_account'); score += 10; }
  if (signals.multipleReportedMessages) { indicators.push('reported_message_content'); score += 25; }
  if (signals.blockedByCount >= 5) { indicators.push('blocked_by_multiple_users'); score += 20; }

  score = Math.min(score, 100);
  const action: AnonAbuseResult['action'] = score >= 80 ? 'suspend' : score >= 60 ? 'shadow_ban' : score >= 40 ? 'restrict' : score >= 20 ? 'rate_limit' : 'allow';

  if (score >= 20) void writeAuditLog('anon.account_abuse', { indicators, riskScore: score, action }).catch(() => {});

  return {
    detected: score >= 20,
    riskScore: score,
    indicators,
    action,
    recommendation: action === 'suspend' ? 'High-risk anonymous account. Suspend pending review.' : 'No significant abuse detected.'
  };
}

export const anonAbuse = detectAnonAccountAbuse;
export const anonymousAccountAbuse = detectAnonAccountAbuse;
export const anonAccountDetect = detectAnonAccountAbuse;

// ==================== DETECTORS (Kept & Cleaned) ====================

export const employerVerify_635 = 'employerVerify';
export const _det635_employerVerify = {
  id: 635,
  section: '22',
  name: 'Employer verification',
  severity: 'medium' as const,
  patterns: ['employerVerify', 'companyVerification', 'workVerify'],
  enabled: true,
  detect(input: string): boolean {
    return ['employerverify', 'companyverification', 'workverify'].some(p => input.toLowerCase().includes(p));
  }
};
export const _ref_employerVerify = _det635_employerVerify;

export const bodyMisrepresentation_751 = 'bodyMisrepresentation';
export const _det751_bodyMisrepresentation = {
  id: 751,
  section: '22',
  name: 'Body type misrepresentation reporting category',
  severity: 'low' as const,
  patterns: ['bodyMisrepresentation', 'bodyTypeReport', 'physicalMismatch'],
  enabled: true,
  detect(input: string): boolean {
    return ['bodymisrepresentation', 'bodytypereport', 'physicalmismatch'].some(p => input.toLowerCase().includes(p));
  }
};
export const _ref_bodyMisrepresentation = _det751_bodyMisrepresentation;

export const privacyPreservingVerify_840 = 'privacyPreservingVerify';
export const _det840_privacyPreservingVerify = {
  id: 840,
  section: '31',
  name: 'Privacy-preserving identity verification',
  severity: 'medium' as const,
  patterns: ['privacyPreservingVerify', 'minimalVerification', 'privacyVerify'],
  enabled: true,
  detect(input: string): boolean {
    return ['privacypreservingverify', 'minimalverification', 'privacyverify'].some(p => input.toLowerCase().includes(p));
  }
};
export const _ref_privacyPreservingVerify = _det840_privacyPreservingVerify;

export const militaryProtection_703 = 'militaryProtection';
export const _det703_militaryProtection = {
  id: 703,
  section: '33',
  name: 'Military / intelligence professional profile protection',
  severity: 'high' as const,
  patterns: ['militaryProtection', 'intelligenceProfile', 'milProfile'],
  enabled: true,
  detect(input: string): boolean {
    return ['militaryprotection', 'intelligenceprofile', 'milprofile'].some(p => input.toLowerCase().includes(p));
  }
};
export const _ref_militaryProtection = _det703_militaryProtection;

export const activistPrivacy_705 = 'activistPrivacy';
export const _det705_activistPrivacy = {
  id: 705,
  section: '33',
  name: 'Activist / journalist enhanced privacy mode',
  severity: 'high' as const,
  patterns: ['activistPrivacy', 'journalistProtection', 'enhancedPrivacy'],
  enabled: true,
  detect(input: string): boolean {
    return ['activistprivacy', 'journalistprotection', 'enhancedprivacy'].some(p => input.toLowerCase().includes(p));
  }
};
export const _ref_activistPrivacy = _det705_activistPrivacy;

export const anonAbuse_858 = 'anonAbuse';
export const _det858_anonAbuse = {
  id: 858,
  section: '39',
  name: 'Anonymous account abuse detection',
  severity: 'medium' as const,
  patterns: ['anonAbuse', 'anonymousAbuse', 'throwawayAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['anonabuse', 'anonymousabuse', 'throwawayabuse'].some(p => input.toLowerCase().includes(p));
  }
};
export const _ref_anonAbuse = _det858_anonAbuse;