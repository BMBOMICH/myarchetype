import { writeAuditLog } from './logger';

export interface SecurityHeadersResult {
  compliant: boolean;
  missing: string[];
  present: string[];
  score: number;
  recommendation: string;
}

const REQUIRED_HEADERS: Record<string, string> = {
  'content-security-policy': 'CSP',
  'strict-transport-security': 'HSTS',
  'x-content-type-options': 'X-Content-Type-Options',
  'x-frame-options': 'X-Frame-Options',
  'referrer-policy': 'Referrer-Policy',
  'permissions-policy': 'Permissions-Policy',
};

export function auditSecurityHeaders(headers: Record<string, string | undefined>): SecurityHeadersResult {
  const missing: string[] = [];
  const present: string[] = [];
  for (const [h, name] of Object.entries(REQUIRED_HEADERS)) {
    if (headers[h]) present.push(name); else missing.push(name);
  }
  const score = Math.round((present.length / Object.keys(REQUIRED_HEADERS).length) * 100);
  if (missing.length) void writeAuditLog('security.headers_missing', { missing, score }).catch(() => {});
  return {
    compliant: missing.length === 0,
    missing,
    present,
    score,
    recommendation: missing.length > 0 ? `Add security headers: ${missing.join(', ')}.` : 'All security headers present.',
  };
}

export const securityHeaders = auditSecurityHeaders;

export interface DependencyAuditResult {
  vulnerable: boolean;
  criticalCount: number;
  highCount: number;
  packages: Array<{ name: string; severity: string; advisory: string }>;
  recommendation: string;
}

export function buildDependencyAuditResult(auditOutput: {
  vulnerabilities: { critical: number; high: number; moderate: number; low: number };
  advisories: Array<{ name: string; severity: string; url: string }>;
}): DependencyAuditResult {
  const critical = auditOutput.vulnerabilities.critical;
  const high = auditOutput.vulnerabilities.high;
  const packages = auditOutput.advisories
    .filter(a => ['critical', 'high'].includes(a.severity))
    .map(a => ({ name: a.name, severity: a.severity, advisory: a.url }));
  if (critical > 0 || high > 0) void writeAuditLog('security.vulnerable_dependencies', { critical, high, packages: packages.map(p => p.name) }).catch(() => {});
  return {
    vulnerable: critical > 0 || high > 0,
    criticalCount: critical,
    highCount: high,
    packages,
    recommendation: critical > 0
      ? `CRITICAL: ${critical} critical vulnerabilities. Patch immediately.`
      : high > 0 ? `HIGH: ${high} high severity vulnerabilities. Patch within 7 days.`
      : 'No critical/high vulnerabilities detected.',
  };
}

export const dependencyAudit = buildDependencyAuditResult;

export interface AccountSellingDetectResult {
  detected: boolean;
  confidence: number;
  signals: string[];
  action: 'none' | 'warn' | 'restrict' | 'suspend';
  recommendation: string;
}

export function detectAccountSelling(signals: {
  bioContainsSellKeywords: boolean;
  externalListingDetected: boolean;
  unusualLoginLocations: boolean;
  multipleDevicesInShortPeriod: boolean;
  profileCompletelyChangedOvernight: boolean;
  paymentHandleInBio: boolean;
  messagingAboutAccountTransfer: boolean;
}): AccountSellingDetectResult {
  const found: string[] = [];
  let confidence = 0;
  if (signals.bioContainsSellKeywords) { found.push('sell_keywords_in_bio'); confidence += 0.3; }
  if (signals.externalListingDetected) { found.push('external_marketplace_listing'); confidence += 0.5; }
  if (signals.unusualLoginLocations) { found.push('unusual_login_locations'); confidence += 0.2; }
  if (signals.multipleDevicesInShortPeriod) { found.push('multiple_devices'); confidence += 0.15; }
  if (signals.profileCompletelyChangedOvernight) { found.push('overnight_profile_overhaul'); confidence += 0.25; }
  if (signals.paymentHandleInBio) { found.push('payment_handle_in_bio'); confidence += 0.2; }
  if (signals.messagingAboutAccountTransfer) { found.push('transfer_discussion_in_messages'); confidence += 0.4; }
  confidence = Math.min(confidence, 1);
  const detected = confidence >= 0.3;
  const action = confidence >= 0.7 ? 'suspend' : confidence >= 0.5 ? 'restrict' : confidence >= 0.3 ? 'warn' : 'none';
  if (detected) void writeAuditLog('integrity.account_selling', { signals: found, confidence, action }).catch(() => {});
  return {
    detected,
    confidence: Math.round(confidence * 100) / 100,
    signals: found,
    action,
    recommendation: detected
      ? `Account selling detected (confidence ${Math.round(confidence * 100)}%). Action: ${action}. Account transfers violate ToS.`
      : 'No account selling signals detected.',
  };
}

export const accountSelling = detectAccountSelling;
export const accountMarketplace = detectAccountSelling;
export const accountTransfer = detectAccountSelling;

export interface SystematicFailureResult {
  detected: boolean;
  patternType: string[];
  affectedUsers: number;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
}

export function detectSystematicFailure(data: {
  reportClusters: Array<{ type: string; count: number; timeWindowHours: number }>;
  safetyFeatureOutages: string[];
  escalatedCases: number;
  legalHolds: number;
}): SystematicFailureResult {
  const patterns: string[] = [];
  for (const c of data.reportClusters) {
    if (c.count >= 10 && c.timeWindowHours <= 24) patterns.push(`${c.type}_cluster_${c.count}`);
  }
  if (data.safetyFeatureOutages.length > 0) patterns.push(`safety_outages:${data.safetyFeatureOutages.join(',')}`);
  if (data.escalatedCases >= 5) patterns.push(`escalated_cases:${data.escalatedCases}`);
  if (data.legalHolds >= 1) patterns.push(`legal_holds:${data.legalHolds}`);
  const affectedUsers = data.reportClusters.reduce((s, c) => s + c.count, 0);
  const sev = patterns.length >= 4 || data.legalHolds >= 3 ? 'critical'
    : patterns.length >= 3 ? 'high' : patterns.length >= 2 ? 'medium'
    : patterns.length >= 1 ? 'low' : 'none';
  if (sev !== 'none') void writeAuditLog('litigation.systematic_failure', { patterns, affectedUsers, severity: sev }).catch(() => {});
  return {
    detected: patterns.length > 0,
    patternType: patterns,
    affectedUsers,
    severity: sev,
    recommendation: sev === 'critical'
      ? 'CRITICAL: Systematic safety failure. Legal team, CISO, and executives must be notified immediately.'
      : sev === 'high' ? 'HIGH: Significant failure pattern. Escalate to safety leadership.'
      : sev === 'none' ? 'No systematic failures detected.'
      : 'Moderate pattern detected. Monitor and prepare incident report.',
  };
}

export const systematicFailure = detectSystematicFailure;
export const litigationSupport = detectSystematicFailure;

export interface PremiumHarassmentResult {
  detected: boolean;
  feature: string;
  abuseType: string[];
  victimCount: number;
  action: 'none' | 'warn_user' | 'revoke_feature' | 'suspend';
  recommendation: string;
}

export function detectPremiumHarassment(data: {
  feature: 'super_like' | 'boost' | 'read_receipt' | 'see_who_liked' | 'rewind' | 'unlimited_likes' | 'spotlight';
  usageCount: number;
  reportedByUsers: string[];
  targetedSameUserCount: number;
  rapidSuperLikes: boolean;
  boostDuringTargetActiveHours: boolean;
  readsWithoutReply: number;
}): PremiumHarassmentResult {
  const abuseType: string[] = [];
  if (data.feature === 'super_like' && data.usageCount >= 10 && data.targetedSameUserCount >= 3) abuseType.push('super_like_harassment');
  if (data.rapidSuperLikes) abuseType.push('rapid_super_like_bombing');
  if (data.feature === 'boost' && data.boostDuringTargetActiveHours && data.reportedByUsers.length >= 2) abuseType.push('targeted_boost_harassment');
  if (data.feature === 'read_receipt' && data.readsWithoutReply >= 10) abuseType.push('read_receipt_weaponization');
  if (data.reportedByUsers.length >= 3) abuseType.push('multiple_victims_reported');
  const detected = abuseType.length > 0;
  const victimCount = data.reportedByUsers.length;
  const action = victimCount >= 5 || abuseType.length >= 3 ? 'suspend'
    : victimCount >= 3 || abuseType.length >= 2 ? 'revoke_feature'
    : detected ? 'warn_user' : 'none';
  if (detected) void writeAuditLog('premium.harassment_abuse', { feature: data.feature, abuseType, victimCount, action }).catch(() => {});
  return {
    detected,
    feature: data.feature,
    abuseType,
    victimCount,
    action,
    recommendation: detected
      ? `Premium feature "${data.feature}" used for harassment: ${abuseType.join(', ')}. ${action.replace(/_/g, ' ')}.`
      : 'No premium harassment detected.',
  };
}

export const premiumHarassment = detectPremiumHarassment;
export const featureAbuse = detectPremiumHarassment;
export const premiumAbuse = detectPremiumHarassment;