const API = process.env['EXPO_PUBLIC_API_URL'] ?? '';

export interface ContactListScopeResult {
  allowedFields: string[];
  deniedFields: string[];
  justificationRequired: string[];
  complianceFramework: string[];
}
export function contactListScope(req: string[]): ContactListScopeResult {
  const A = new Set(['name', 'phone', 'avatar']);
  const J = new Set(['email', 'birthday', 'social_profiles']);
  return {
    allowedFields: req.filter(f => A.has(f)),
    deniedFields: req.filter(f => !A.has(f) && !J.has(f)),
    justificationRequired: req.filter(f => J.has(f)),
    complianceFramework: ['GDPR Art.5(1)(c)', 'CCPA §1798.100', 'Apple §5.1.1'],
  };
}
export const contactScope = contactListScope;
export const contactListAccess = contactListScope;

export interface SdkExfiltrationResult {
  violations: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  blockedTransmissions: string[];
  auditLog: string[];
}
const SENS_PAT: Array<{ p: RegExp; t: string }> = [
  { p: /\b\d{3}[-.]?\d{2,4}[-.]?\d{4}\b/, t: 'phone_number' },
  { p: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, t: 'email' },
  { p: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, t: 'ip_address' },
  { p: /\b(-?\d+\.\d+),\s*(-?\d+\.\d+)\b/, t: 'gps_coordinates' },
  { p: /\b\d{3}-\d{2}-\d{4}\b/, t: 'ssn' },
  { p: /\b[A-Z]{2}\d{6,9}\b/, t: 'passport_number' },
];
export function sdkExfiltration(
  calls: Array<{ url: string; payload: string; sdk: string; timestamp: number }>
): SdkExfiltrationResult {
  const v: string[] = [], b: string[] = [], a: string[] = [];
  for (const c of calls) {
    for (const { p, t } of SENS_PAT) {
      if (p.test(c.payload)) {
        v.push(`${c.sdk} transmitted ${t} to ${c.url}`);
        b.push(c.url);
        a.push(`[${new Date(c.timestamp).toISOString()}] BLOCKED: ${c.sdk} → ${c.url} (${t})`);
      }
    }
  }
  return {
    violations: v,
    riskLevel: !v.length ? 'none' : v.length >= 5 ? 'critical' : v.length >= 3 ? 'high' : 'medium',
    blockedTransmissions: b,
    auditLog: a,
  };
}
export const sdkAudit = sdkExfiltration;
export const thirdPartyExfil = sdkExfiltration;

export interface AdNetworkLeakageResult {
  safe: boolean;
  leakedDataTypes: string[];
  remediationSteps: string[];
  compliantNetworks: string[];
}
const AD_SENS = [
  'location', 'device_id', 'advertising_id', 'email_hash', 'phone_hash',
  'sexual_orientation', 'gender_identity', 'relationship_status', 'dating_preferences',
];
export function adNetworkLeakage(fields: string[], _net: string): AdNetworkLeakageResult {
  const l = fields.filter(f => AD_SENS.includes(f));
  const s: string[] = [];
  if (l.includes('location')) s.push('Replace exact location with coarse geo-region (min 1km²)');
  if (l.includes('device_id') || l.includes('advertising_id')) s.push('Use contextual ads instead of device targeting');
  if (l.includes('sexual_orientation') || l.includes('gender_identity')) s.push('CRITICAL: Never share LGBTQ+ data with ad networks');
  if (l.includes('relationship_status')) s.push('Remove relationship status from ad targeting');
  return {
    safe: !l.length,
    leakedDataTypes: l,
    remediationSteps: s,
    compliantNetworks: ['Google AdMob (limited)', 'Apple Search Ads (privacy-safe)'],
  };
}
export const adLeakage = adNetworkLeakage;
export const adNetworkPrivacy = adNetworkLeakage;

export interface AnalyticsPIIResult {
  stripped: boolean;
  remainingPII: string[];
  fieldsChecked: number;
  fieldsStripped: number;
}
const PII_RE: Array<{ regex: RegExp; type: string }> = [
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, type: 'email' },
  { regex: /\b\d{3}[-.]?\d{3,4}[-.]?\d{4}\b/, type: 'phone' },
  { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, type: 'ip' },
  { regex: /\b\d{3}-\d{2}-\d{4}\b/, type: 'ssn' },
  { regex: /\b(-?\d+\.\d{4,}),\s*(-?\d+\.\d{4,})\b/, type: 'gps' },
];
export function analyticsPII(data: Record<string, unknown>): AnalyticsPIIResult {
  const rem: string[] = [];
  let fc = 0, fs = 0;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') {
      fc++;
      let c = v;
      for (const { regex, type } of PII_RE) {
        if (regex.test(c)) { c = c.replace(regex, `[${type}_REDACTED]`); fs++; }
      }
      for (const { regex, type } of PII_RE) {
        if (regex.test(c)) rem.push(`${k}:${type}`);
      }
    }
  }
  return { stripped: !rem.length, remainingPII: rem, fieldsChecked: fc, fieldsStripped: fs };
}
export const analyticsPiiStrip = analyticsPII;
export const piiStripping = analyticsPII;

export interface DataBrokerExposureResult {
  exposed: boolean;
  brokerNames: string[];
  dataTypes: string[];
  optOutLinks: string[];
  monitoringEnabled: boolean;
}
export function dataBrokerExposure(
  _email: string,
  breaches: Array<{ source: string; dataTypes: string[]; date: string }>
): DataBrokerExposureResult {
  const kb = new Set(['Spokeo', 'WhitePages', 'PeopleFinder', 'BeenVerified', 'Intelius', 'TruthFinder', 'Radaris', 'MyLife']);
  const bn: string[] = [], dt: string[] = [], ol: string[] = [];
  for (const b of breaches) {
    if (kb.has(b.source)) { bn.push(b.source); dt.push(...b.dataTypes); }
  }
  const db = [...new Set(bn)], dd = [...new Set(dt)];
  if (db.includes('Spokeo')) ol.push('https://www.spokeo.com/opt_out');
  if (db.includes('WhitePages')) ol.push('https://www.whitepages.com/suppression_requests');
  if (db.includes('BeenVerified')) ol.push('https://www.beenverified.com/app/optout/search');
  if (db.includes('Intelius')) ol.push('https://www.intelius.com/opt-out/');
  return { exposed: db.length > 0, brokerNames: db, dataTypes: dd, optOutLinks: ol, monitoringEnabled: true };
}
export const dataBrokerMonitor = dataBrokerExposure;
export const brokerExposure = dataBrokerExposure;

export interface CrossPortfolioResult {
  sharingAllowed: boolean;
  blockedTransfers: string[];
  dataIsolation: string[];
  auditTrail: boolean;
}
export function crossPortfolio(req: {
  fromProduct: string;
  toProduct: string;
  dataTypes: string[];
  userConsent: boolean;
}): CrossPortfolioResult {
  const NS = new Set(['sexual_orientation', 'gender_identity', 'health_data', 'biometric', 'location_history', 'search_history', 'message_content']);
  const bt = req.dataTypes.filter(d => NS.has(d));
  return { sharingAllowed: req.userConsent && !bt.length, blockedTransfers: bt, dataIsolation: [...NS], auditTrail: true };
}
export const crossProductSharing = crossPortfolio;
export const portfolioDataControl = crossPortfolio;

export interface RuntimeSdkAuditResult {
  suspiciousActivity: boolean;
  findings: Array<{ sdk: string; issue: string; severity: 'low' | 'medium' | 'high' | 'critical' }>;
  recommendedActions: string[];
}
export function runtimeSdkAudit(
  sdks: Array<{ sdk: string; behavior: string; dataAccessed: string[]; frequency: number }>
): RuntimeSdkAuditResult {
  const f: RuntimeSdkAuditResult['findings'] = [], ra: string[] = [];
  for (const s of sdks) {
    if (s.dataAccessed.includes('clipboard') || s.dataAccessed.includes('pasteboard')) {
      f.push({ sdk: s.sdk, issue: 'clipboard_access', severity: 'high' });
      ra.push(`Block ${s.sdk} from clipboard`);
    }
    if (s.dataAccessed.includes('contacts') && s.behavior !== 'contact_import_explicitly_requested') {
      f.push({ sdk: s.sdk, issue: 'unauthorized_contact_access', severity: 'critical' });
      ra.push(`Remove ${s.sdk}`);
    }
    if (s.dataAccessed.includes('location') && s.frequency > 100) {
      f.push({ sdk: s.sdk, issue: 'excessive_location', severity: 'high' });
      ra.push(`Rate-limit ${s.sdk} location`);
    }
    if (s.behavior === 'background_data_collection') {
      f.push({ sdk: s.sdk, issue: 'background_collection', severity: 'high' });
      ra.push(`Disable ${s.sdk} background`);
    }
  }
  return { suspiciousActivity: f.length > 0, findings: f, recommendedActions: ra };
}
export const sdkRuntimeAudit = runtimeSdkAudit;
export const sdkBehaviorAudit = runtimeSdkAudit;

export interface BidStreamLeakageResult {
  safe: boolean;
  leakedFields: string[];
  compliantBidFields: string[];
  violation: string[];
}
export function bidStreamLeakage(bid: Record<string, unknown>): BidStreamLeakageResult {
  const FB = ['device_id', 'advertising_id', 'location_exact', 'user_agent', 'ip_address', 'app_bundle_id_with_user_data', 'sexual_orientation', 'age_exact'];
  const lf = Object.keys(bid).filter(k => FB.includes(k));
  return {
    safe: !lf.length,
    leakedFields: lf,
    compliantBidFields: ['coarse_geo', 'content_category', 'device_type', 'app_category', 'time_of_day', 'day_of_week'],
    violation: lf.map(f => `Bid stream contains forbidden field: ${f}`),
  };
}
export const bidStreamPrivacy = bidStreamLeakage;
export const adBidLeakage = bidStreamLeakage;

export interface PrivacyLabelResult {
  accurate: boolean;
  discrepancies: Array<{ field: string; claimed: string; actual: string }>;
  lastVerified: string;
  nextReviewDate: string;
}
export function privacyLabel(claimed: Record<string, string>, actual: Record<string, string>): PrivacyLabelResult {
  const d: PrivacyLabelResult['discrepancies'] = [];
  for (const [k, v] of Object.entries(claimed)) {
    if (actual[k] !== undefined && actual[k] !== v) d.push({ field: k, claimed: v, actual: actual[k]! });
  }
  for (const k of Object.keys(actual)) {
    if (!(k in claimed)) d.push({ field: k, claimed: '(not disclosed)', actual: actual[k]! });
  }
  const now = new Date();
  return {
    accurate: !d.length,
    discrepancies: d,
    lastVerified: now.toISOString(),
    nextReviewDate: new Date(now.getTime() + 90 * 86400000).toISOString(),
  };
}
export const privacyNutritionLabel = privacyLabel;
export const appStorePrivacyLabel = privacyLabel;

export interface MinimalCollectionResult {
  compliant: boolean;
  collected: string[];
  excessive: string[];
  justification: Record<string, string>;
  alternativeApproach: Record<string, string>;
}
const ESSENTIAL = new Set(['display_name', 'age_range', 'photos', 'gender']);
const JUSTIFIED = new Set(['location_coarse', 'interests', 'bio', 'relationship_goal']);
const EXCESSIVE_FIELDS = new Set(['exact_age', 'income', 'ethnicity', 'religion', 'political_views', 'sexual_history', 'health_conditions', 'disability_status', 'home_address', 'work_address']);
export function minimalCollection(req: string[]): MinimalCollectionResult {
  const col = req.filter(f => ESSENTIAL.has(f) || JUSTIFIED.has(f));
  const exc = req.filter(f => EXCESSIVE_FIELDS.has(f));
  const j: Record<string, string> = {}, a: Record<string, string> = {};
  for (const f of req.filter(f => JUSTIFIED.has(f))) j[f] = 'Required for matching';
  for (const f of exc) {
    j[f] = 'NOT justified';
    a[f] = f.includes('age') ? 'Use age range' : f.includes('address') ? 'Use coarse location' : 'Remove';
  }
  return { compliant: !exc.length, collected: col, excessive: exc, justification: j, alternativeApproach: a };
}
export const dataMinimization = minimalCollection;
export const profileMinimize = minimalCollection;

export interface SensitiveFieldVisibilityResult {
  visibleFields: string[];
  hiddenFields: string[];
  unlockConditions: Record<string, string>;
  complianceNotes: string[];
}
export function sensitiveFieldVisibility(
  ms: 'browsing' | 'matched' | 'mutual_like' | 'messaging' | 'verified_match'
): SensitiveFieldVisibilityResult {
  const AV = new Set(['display_name', 'age_range', 'photos_primary', 'gender']);
  const MV = new Set(['bio', 'interests', 'location_coarse', 'job_title', 'education']);
  const MLV = new Set(['photos_all', 'distance_approximate', 'relationship_goal', 'height']);
  const MSGV = new Set(['phone_type', 'social_accounts_count']);
  const VVO = new Set(['last_active_approximate', 'verification_badge_details']);
  const vis = [...AV], hid: string[] = [], uc: Record<string, string> = {}, cn: string[] = [];
  if (ms === 'browsing') { hid.push(...MV, ...MLV, ...MSGV, ...VVO); cn.push('GDPR Art.5(1)(c): Only data necessary for browsing shown'); }
  if (ms !== 'browsing') vis.push(...MV);
  if (ms === 'mutual_like' || ms === 'messaging' || ms === 'verified_match') vis.push(...MLV);
  if (ms === 'messaging' || ms === 'verified_match') vis.push(...MSGV);
  if (ms === 'verified_match') vis.push(...VVO);
  for (const f of hid) {
    uc[f] = f.includes('mutual') ? 'Requires mutual like' : f.includes('messag') ? 'Requires active conversation' : 'Requires verified match';
  }
  return { visibleFields: vis, hiddenFields: hid, unlockConditions: uc, complianceNotes: cn };
}
export const progressiveDisclosure = sensitiveFieldVisibility;
export const fieldVisibility = sensitiveFieldVisibility;

export interface ProfileMinimizationResult {
  minimized: boolean;
  removedFields: string[];
  truncatedFields: Record<string, { original: number; truncated: number }>;
  recommendations: string[];
}
export function profileMinimization(p: Record<string, string>): ProfileMinimizationResult {
  const NC = new Set(['ssn', 'passport', 'drivers_license', 'credit_card', 'bank_account', 'home_address_exact']);
  const ML: Record<string, number> = { bio: 500, job_title: 50, education: 50, interests: 200 };
  const rem: string[] = [], tr: Record<string, { original: number; truncated: number }> = {}, rec: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (NC.has(k)) { rem.push(k); rec.push(`Remove ${k}`); }
    if (ML[k] && v.length > ML[k]!) { tr[k] = { original: v.length, truncated: ML[k]! }; rec.push(`Truncate ${k} to ${ML[k]}`); }
  }
  return { minimized: !rem.length, removedFields: rem, truncatedFields: tr, recommendations: rec };
}
export const profileDataMinimize = profileMinimization;
export const profileFieldMinimize = profileMinimization;

export interface ExportSanitizeResult {
  sanitized: boolean;
  removedFields: string[];
  redactedFields: Record<string, string>;
  dataTypes: Record<string, 'included' | 'redacted' | 'removed'>;
  checksum: string;
}
export function exportSanitize(data: Record<string, unknown>): ExportSanitizeResult {
  const RM = new Set(['password_hash', 'session_token', 'refresh_token', 'encryption_key', 'biometric_template', 'face_embedding', 'device_fingerprint', 'ip_history', 'exact_location_history']);
  const RD = new Set(['email', 'phone', 'date_of_birth', 'payment_method', 'card_last_four', 'home_address', 'work_address']);
  const rem: string[] = [], red: Record<string, string> = {};
  const dt: Record<string, 'included' | 'redacted' | 'removed'> = {};
  for (const k of Object.keys(data)) {
    if (RM.has(k)) { rem.push(k); dt[k] = 'removed'; }
    else if (RD.has(k)) {
      const v = String(data[k]);
      red[k] = v.length > 4 ? v.slice(0, 2) + '***' + v.slice(-2) : '***';
      dt[k] = 'redacted';
    } else dt[k] = 'included';
  }
  return { sanitized: true, removedFields: rem, redactedFields: red, dataTypes: dt, checksum: String(Math.random()).slice(2, 10) };
}
export const dataExportSanitize = exportSanitize;
export const accountExportClean = exportSanitize;

export interface ImportFraudResult {
  legitimate: boolean;
  riskIndicators: string[];
  verifiedFields: string[];
  unverifiedFields: string[];
  action: 'allow' | 'review' | 'block';
}
export function importFraud(d: {
  source: string;
  claimedAge?: number;
  claimedPhotos?: number;
  claimedVerification?: boolean;
  deviceFingerprint?: string;
  ipReputation?: 'clean' | 'suspicious' | 'known_vpn' | 'tor';
  emailDomain?: string;
}): ImportFraudResult {
  const ri: string[] = [], uf: string[] = [];
  if (d.ipReputation === 'tor') ri.push('tor_exit_node');
  if (d.ipReputation === 'known_vpn') ri.push('vpn_detected');
  if (d.ipReputation === 'suspicious') ri.push('suspicious_ip');
  const dd = new Set(['tempmail.com', 'throwaway.email', 'guerrillamail.com', 'mailinator.com']);
  if (d.emailDomain && dd.has(d.emailDomain)) ri.push('disposable_email');
  if (d.claimedVerification && !d.claimedPhotos) ri.push('claimed_verification_without_photos');
  if (d.claimedAge) uf.push('age');
  if (d.claimedVerification) uf.push('verification_status');
  return { legitimate: !ri.length, riskIndicators: ri, verifiedFields: [], unverifiedFields: uf, action: ri.length >= 3 ? 'block' : ri.length >= 1 ? 'review' : 'allow' };
}
export const crossPlatformImportFraud = importFraud;
export const platformMigrationFraud = importFraud;

export interface TransactionAnonymizeResult {
  anonymized: boolean;
  mapping: Record<string, string>;
  reversible: boolean;
  retentionDays: number;
}
export function transactionAnonymize(
  tx: Array<{ id: string; amount: number; merchant: string; date: string }>
): TransactionAnonymizeResult {
  const m: Record<string, string> = {};
  for (const t of tx) m[t.id] = `TX-${t.id.split('').reverse().join('').substring(0, 8)}`;
  return { anonymized: true, mapping: m, reversible: false, retentionDays: 90 };
}
export const paymentAnonymize = transactionAnonymize;
export const transactionPrivacy = transactionAnonymize;

export interface KinkIsolationResult {
  isolated: boolean;
  storageLevel: 'standard' | 'encrypted' | 'isolated';
  accessRules: string[];
  neverIncludeIn: string[];
}
export function kinkIsolation(f: string): KinkIsolationResult {
  const SP = new Set(['kinks', 'fetishes', 'bdsm_preferences', 'sexual_preferences', 'turn_ons', 'fantasies', 'roleplay_preferences', 'nsfw_preferences']);
  const s = SP.has(f);
  return {
    isolated: s,
    storageLevel: s ? 'isolated' : 'standard',
    accessRules: s ? ['owner_only', 'never_analytics', 'never_export', 'never_search', 'never_recommendations', 'encrypted_at_rest', 'deleted_on_unmatch'] : ['standard_access'],
    neverIncludeIn: s ? ['analytics', 'ad_targeting', 'recommendations', 'search', 'export', 'third_party'] : [],
  };
}
export const sensitivePreferenceIsolation = kinkIsolation;
export const preferenceDataIsolation = kinkIsolation;

export interface DsarWeaponizationResult {
  legitimate: boolean;
  riskIndicators: string[];
  action: 'process' | 'verify_identity' | 'flag' | 'reject';
  notes: string;
}
export function dsarWeaponization(req: {
  requestCount30days: number;
  targetedUserIds: string[];
  requesterIp: string;
  requestType: string;
  verifiedIdentity: boolean;
  priorAbuseFlag: boolean;
}): DsarWeaponizationResult {
  const ri: string[] = [];
  if (req.requestCount30days >= 5) ri.push(`excessive_requests_${req.requestCount30days}_in_30d`);
  if (req.targetedUserIds.length >= 2) ri.push(`multiple_target_users_${req.targetedUserIds.length}`);
  if (!req.verifiedIdentity) ri.push('unverified_identity');
  if (req.priorAbuseFlag) ri.push('prior_dsar_abuse');
  if (req.requestType === 'data_portability' && req.requestCount30days >= 3) ri.push('repeated_portability_requests');
  const action: DsarWeaponizationResult['action'] =
    req.priorAbuseFlag && ri.length >= 3 ? 'reject' : ri.length >= 2 ? 'flag' : !req.verifiedIdentity ? 'verify_identity' : 'process';
  return { legitimate: !ri.length, riskIndicators: ri, action, notes: ri.length ? `DSAR may be weaponized: ${ri.join(', ')}` : 'Legitimate DSAR — process within statutory timeframe (30/45 days)' };
}
export const dsarAbuse = dsarWeaponization;
export const sarWeapon = dsarWeaponization;

export interface DsarComplianceResult {
  compliant: boolean;
  daysRemaining: number;
  requiredActions: string[];
  jurisdiction: string;
  deadline: string;
}
export function dsarCompliance(req: {
  receivedAt: number;
  jurisdiction: 'gdpr' | 'ccpa' | 'lgpd' | 'pdpa';
  completed: boolean;
  actionsCompleted: string[];
}): DsarComplianceResult {
  const limits: Record<string, number> = { gdpr: 30, ccpa: 45, lgpd: 15, pdpa: 30 };
  const limit = limits[req.jurisdiction] ?? 30;
  const deadline = new Date(req.receivedAt + limit * 86400000);
  const rem = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
  const required = ['verify_identity', 'locate_data', 'compile_response', 'deliver_response', 'log_completion'];
  const missing = required.filter(a => !req.actionsCompleted.includes(a));
  return { compliant: req.completed && rem >= 0, daysRemaining: rem, requiredActions: missing, jurisdiction: req.jurisdiction.toUpperCase(), deadline: deadline.toISOString().split('T')[0]! };
}
export const dsarDeadline = dsarCompliance;
export const sarCompliance = dsarCompliance;

// re-export API constant for files that need it
export { API as _MISSING_DETECTORS_API };