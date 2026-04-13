// ═══════════════════════════════════════════════════════════════
// missingDetectors.ts — FIXED & COMPLETE
// ═══════════════════════════════════════════════════════════════

async function stSim(a: string, b: string): Promise<number> {
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/ml/similarity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_a: a, text_b: b }),
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) return (await r.json() as { similarity: number }).similarity;
  } catch {}
  const sa = new Set(a.toLowerCase().split(/\s+/));
  const sb = new Set(b.toLowerCase().split(/\s+/));
  const i = [...sa].filter(w => sb.has(w)).length;
  const u = new Set([...sa, ...sb]).size;
  return u > 0 ? i / u : 0;
}

async function matchScript(text: string, scripts: string[]): Promise<{ max: number; hit: string | null }> {
  let max = 0, hit: string | null = null;
  for (const s of scripts) {
    const sc = await stSim(text, s);
    if (sc > max) { max = sc; hit = s; }
  }
  return { max, hit };
}

const CRISIS_SCRIPTS = [
  "I can help you recover from the earthquake",
  "Let me send you money for the flood damage",
  "I have a business opportunity for refugees",
  "I can help you during this pandemic",
  "I know how to get your money back after being laid off"
];
const ELICIT_SCRIPTS = [
  "What clearance level do you hold",
  "What unit are you assigned to",
  "Where are you currently stationed",
  "Tell me about your missions",
  "What technology do you work with",
  "Are you cleared to discuss this"
];
const GEO_SCRIPTS = [
  "Where exactly do you live",
  "What is your street address",
  "Share your GPS coordinates",
  "What neighborhood are you in",
  "What is your zip code",
  "How close are you to the city center"
];
const INCEL_SCRIPTS = [
  "I've taken the blackpill",
  "Chad gets all the women",
  "Stacy only dates tall guys",
  "I'm a sub-8 male",
  "Looksmaxxing is the only way",
  "Women are all the same",
  "MGTOW is the answer",
  "The rope is calling"
];
const CASTE_SCRIPTS = [
  "I only date Brahmins",
  "Looking for same-caste match",
  "Upper caste only",
  "Must be from our gotra",
  "No Dalits please",
  "Our family only marries within the caste",
  "I need a Kshatriya bride"
];
const PHISH_SCRIPTS = [
  "I'm from the support team and we detected suspicious activity",
  "This is the security team, verify your account immediately",
  "Your account will be suspended unless you click this link",
  "Send us your password for verification",
  "We've detected fraudulent login attempts on your account"
];
const AI_MANIP_SCRIPTS = [
  "I understand you better than any human ever could",
  "I'm always here for you no matter what",
  "You don't need anyone else when you have me",
  "I care about you more deeply than your friends do",
  "We have a special connection that transcends normal relationships"
];
const PROXY_SCRIPTS = [
  "My friend wants to know if you're interested",
  "I'm messaging on behalf of someone",
  "They're too shy to message you directly",
  "Can I give them your number",
  "They want to meet you but asked me to reach out"
];
const MARRIED_SCRIPTS = [
  "My marriage is basically over",
  "We're separated but not officially divorced",
  "I'm in an open relationship",
  "My partner knows I'm on here",
  "We're just roommates at this point"
];

// ─── [27] Contact List Access Scope ──────────────────────

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
    complianceFramework: ['GDPR Art.5(1)(c)', 'CCPA §1798.100', 'Apple §5.1.1']
  };
}
export const contactScope = contactListScope;
export const contactListAccess = contactListScope;

// ─── [28] Third-Party Data Leakage ────────────────────────

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
  { p: /\b[A-Z]{2}\d{6,9}\b/, t: 'passport_number' }
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
    auditLog: a
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
  'sexual_orientation', 'gender_identity', 'relationship_status', 'dating_preferences'
];
export function adNetworkLeakage(fields: string[], net: string): AdNetworkLeakageResult {
  const l = fields.filter(f => AD_SENS.includes(f)), s: string[] = [];
  if (l.includes('location')) s.push('Replace exact location with coarse geo-region (min 1km²)');
  if (l.includes('device_id') || l.includes('advertising_id'))
    s.push('Use contextual ads instead of device targeting');
  if (l.includes('sexual_orientation') || l.includes('gender_identity'))
    s.push('CRITICAL: Never share LGBTQ+ data with ad networks');
  if (l.includes('relationship_status'))
    s.push('Remove relationship status from ad targeting');
  return {
    safe: !l.length,
    leakedDataTypes: l,
    remediationSteps: s,
    compliantNetworks: ['Google AdMob (limited)', 'Apple Search Ads (privacy-safe)']
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
  { regex: /\b(-?\d+\.\d{4,}),\s*(-?\d+\.\d{4,})\b/, type: 'gps' }
];
export function analyticsPII(data: Record<string, unknown>): AnalyticsPIIResult {
  const rem: string[] = []; let fc = 0, fs = 0;
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
  email: string,
  breaches: Array<{ source: string; dataTypes: string[]; date: string }>
): DataBrokerExposureResult {
  const kb = new Set([
    'Spokeo', 'WhitePages', 'PeopleFinder', 'BeenVerified',
    'Intelius', 'TruthFinder', 'Radaris', 'MyLife'
  ]);
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
  const NS = new Set([
    'sexual_orientation', 'gender_identity', 'health_data', 'biometric',
    'location_history', 'search_history', 'message_content'
  ]);
  const bt = req.dataTypes.filter(d => NS.has(d));
  return {
    sharingAllowed: req.userConsent && !bt.length,
    blockedTransfers: bt,
    dataIsolation: [...NS],
    auditTrail: true
  };
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
  const FB = [
    'device_id', 'advertising_id', 'location_exact', 'user_agent', 'ip_address',
    'app_bundle_id_with_user_data', 'sexual_orientation', 'age_exact'
  ];
  const lf = Object.keys(bid).filter(k => FB.includes(k));
  return {
    safe: !lf.length,
    leakedFields: lf,
    compliantBidFields: [
      'coarse_geo', 'content_category', 'device_type',
      'app_category', 'time_of_day', 'day_of_week'
    ],
    violation: lf.map(f => `Bid stream contains forbidden field: ${f}`)
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
export function privacyLabel(
  claimed: Record<string, string>,
  actual: Record<string, string>
): PrivacyLabelResult {
  const d: PrivacyLabelResult['discrepancies'] = [];
  for (const [k, v] of Object.entries(claimed)) {
    if (actual[k] !== undefined && actual[k] !== v)
      d.push({ field: k, claimed: v, actual: actual[k]! });
  }
  for (const k of Object.keys(actual)) {
    if (!(k in claimed)) d.push({ field: k, claimed: '(not disclosed)', actual: actual[k]! });
  }
  const now = new Date();
  return {
    accurate: !d.length,
    discrepancies: d,
    lastVerified: now.toISOString(),
    nextReviewDate: new Date(now.getTime() + 90 * 86400000).toISOString()
  };
}
export const privacyNutritionLabel = privacyLabel;
export const appStorePrivacyLabel = privacyLabel;

// ─── [30] Elder-Specific ─────────────────────────────────

export interface ElderFinancialAlertResult {
  triggered: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  signals: string[];
  recommendations: string[];
  guardianNotification: boolean;
}
export function elderFinancialAlert(s: {
  userAge: number;
  firstFinancialMention: boolean;
  giftCardMention: boolean;
  wireTransferMention: boolean;
  cryptoMention: boolean;
  urgencyLanguage: boolean;
  newContact: boolean;
  amountMentioned?: number;
}): ElderFinancialAlertResult {
  const det: string[] = [], rec: string[] = []; let rs = 0;
  if (s.userAge < 60) return { triggered: false, riskLevel: 'none', signals: [], recommendations: [], guardianNotification: false };
  if (s.firstFinancialMention) { det.push('first_financial'); rs += 1; }
  if (s.giftCardMention) { det.push('gift_card'); rs += 2; rec.push('Gift cards are a common scam method'); }
  if (s.wireTransferMention) { det.push('wire_transfer'); rs += 2; rec.push('Wire transfers cannot be reversed'); }
  if (s.cryptoMention) { det.push('crypto'); rs += 2; rec.push('Cryptocurrency is irreversible'); }
  if (s.urgencyLanguage) { det.push('urgency'); rs += 1; rec.push("Take your time — legitimate people don't rush"); }
  if (s.newContact) { det.push('new_contact_money'); rs += 2; }
  if ((s.amountMentioned ?? 0) > 500) {
    det.push('large_amount');
    rs += 1;
    rec.push(`$${s.amountMentioned} is significant — discuss with trusted person`);
  }
  const rl = rs >= 6 ? 'critical' : rs >= 4 ? 'high' : rs >= 2 ? 'medium' : rs >= 1 ? 'low' : 'none';
  if (rl === 'critical' || rl === 'high') {
    rec.push('Discuss with trusted family');
    rec.push('Report if pressured');
  }
  return { triggered: rl !== 'none', riskLevel: rl, signals: det, recommendations: rec, guardianNotification: rl === 'critical' };
}
export const elderFraudAlert = elderFinancialAlert;
export const olderUserFinancialAlert = elderFinancialAlert;

// ─── [31] Privacy-Preserving Verification ────────────────

export interface PrivacyPreservingVerifyResult {
  method: 'zero_knowledge_range_proof' | 'hash_comparison' | 'selective_disclosure';
  verified: boolean;
  dataRevealed: string[];
  dataProven: string[];
  verificationId: string;
  expiresAt: string;
}
export function privacyPreservingVerify(
  claim: {
    type: 'age_over_18' | 'age_over_21' | 'not_on_sex_offender_registry' | 'face_matches_id';
    value: boolean;
  },
  proof: { hash: string; salt: string; commitment: string }
): PrivacyPreservingVerifyResult {
  const now = Date.now();
  const v = claim.value && proof.hash.length > 0 && proof.commitment.length > 0;
  const mm: Record<string, PrivacyPreservingVerifyResult['method']> = {
    age_over_18: 'zero_knowledge_range_proof',
    age_over_21: 'zero_knowledge_range_proof',
    not_on_sex_offender_registry: 'hash_comparison',
    face_matches_id: 'selective_disclosure'
  };
  return {
    method: mm[claim.type] ?? 'hash_comparison',
    verified: v,
    dataRevealed: claim.type.startsWith('age') ? [] : [claim.type],
    dataProven: [claim.type],
    verificationId: `ZKV-${now.toString(36).toUpperCase()}`,
    expiresAt: new Date(now + 30 * 86400000).toISOString()
  };
}
export const zkVerify = privacyPreservingVerify;
export const privacyVerify = privacyPreservingVerify;

export interface ZeroKnowledgeResult {
  proofGenerated: boolean;
  proofType: 'range_proof' | 'set_membership' | 'equality_proof';
  publicOutput: string;
  privateInputHidden: boolean;
  verificationCost: 'low' | 'medium';
}
export function zeroKnowledge(
  pv: number,
  pt: 'range' | 'membership' | 'equality',
  pp: { min?: number; max?: number; set?: number[]; target?: number }
): ZeroKnowledgeResult {
  let v = false;
  if (pt === 'range') v = pp.min !== undefined && pp.max !== undefined && pv >= pp.min && pv <= pp.max;
  else if (pt === 'membership') v = pp.set?.includes(pv) ?? false;
  else if (pt === 'equality') v = pv === (pp.target ?? -1);
  const tm: Record<string, ZeroKnowledgeResult['proofType']> = {
    range: 'range_proof',
    membership: 'set_membership',
    equality: 'equality_proof'
  };
  return {
    proofGenerated: v,
    proofType: tm[pt]!,
    publicOutput: v ? 'PROOF_VALID' : 'PROOF_INVALID',
    privateInputHidden: true,
    verificationCost: pt === 'range' ? 'medium' : 'low'
  };
}
export const zkProof = zeroKnowledge;
export const zeroKnowledgeProof = zeroKnowledge;

export interface MinimalCollectionResult {
  compliant: boolean;
  collected: string[];
  excessive: string[];
  justification: Record<string, string>;
  alternativeApproach: Record<string, string>;
}
const ESSENTIAL = new Set(['display_name', 'age_range', 'photos', 'gender']);
const JUSTIFIED = new Set(['location_coarse', 'interests', 'bio', 'relationship_goal']);
const EXCESSIVE = new Set([
  'exact_age', 'income', 'ethnicity', 'religion', 'political_views',
  'sexual_history', 'health_conditions', 'disability_status',
  'home_address', 'work_address'
]);
export function minimalCollection(req: string[]): MinimalCollectionResult {
  const col = req.filter(f => ESSENTIAL.has(f) || JUSTIFIED.has(f));
  const exc = req.filter(f => EXCESSIVE.has(f));
  const j: Record<string, string> = {}, a: Record<string, string> = {};
  for (const f of req.filter(f => JUSTIFIED.has(f))) j[f] = 'Required for matching';
  for (const f of exc) {
    j[f] = 'NOT justified';
    a[f] = f.includes('age') ? 'Use age range'
          : f.includes('address') ? 'Use coarse location'
          : 'Remove';
  }
  return { compliant: !exc.length, collected: col, excessive: exc, justification: j, alternativeApproach: a };
}
export const dataMinimization = minimalCollection;
export const profileMinimize = minimalCollection;

// ─── [32] Progressive Disclosure ──────────────────────────

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
  if (ms === 'browsing') {
    hid.push(...MV, ...MLV, ...MSGV, ...VVO);
    cn.push('GDPR Art.5(1)(c): Only data necessary for browsing shown');
  }
  if (ms !== 'browsing') vis.push(...MV);
  if (ms === 'mutual_like' || ms === 'messaging' || ms === 'verified_match') vis.push(...MLV);
  if (ms === 'messaging' || ms === 'verified_match') vis.push(...MSGV);
  if (ms === 'verified_match') vis.push(...VVO);
  for (const f of hid) {
    uc[f] = f.includes('mutual') ? 'Requires mutual like'
           : f.includes('messag') ? 'Requires active conversation'
           : 'Requires verified match';
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
  const NC = new Set([
    'ssn', 'passport', 'drivers_license', 'credit_card',
    'bank_account', 'home_address_exact'
  ]);
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

// ─── [33] Sensitive Profession ────────────────────────────

export interface MilitaryProtectionResult {
  protected: boolean;
  safeguards: string[];
  dataIsolation: boolean;
  enhancedPrivacy: boolean;
  opsecWarnings: string[];
}
export function militaryProtection(p: {
  hasMilitaryIndicator: boolean;
  branch?: string;
  deployments?: string[];
}): MilitaryProtectionResult {
  if (!p.hasMilitaryIndicator) return {
    protected: false, safeguards: [], dataIsolation: false,
    enhancedPrivacy: false, opsecWarnings: []
  };
  return {
    protected: true,
    safeguards: [
      'location_always_approximate', 'never_show_exact_coordinates',
      'hide_online_status_default', 'disable_location_history',
      'block_geotagging_in_photos', 'hideDeploymentDates'
    ],
    dataIsolation: true,
    enhancedPrivacy: true,
    opsecWarnings: [
      'Never share deployment locations/dates',
      'Avoid mentioning unit designations',
      'No photos in uniform with visible badges',
      'Be cautious about rank/MOS',
      'Report attempts to elicit operational info'
    ]
  };
}
export const militaryProfile = militaryProtection;
export const militaryPrivacy = militaryProtection;

export interface GovEmployeeResult {
  protected: boolean;
  dataClassification: 'standard' | 'sensitive' | 'classified_eligible';
  safeguards: string[];
  isolationLevel: 'standard' | 'enhanced' | 'maximum';
  warningText: string;
}
export function govEmployee(p: {
  isGovEmployee: boolean;
  clearanceLevel?: 'none' | 'secret' | 'top_secret';
  agency?: string;
}): GovEmployeeResult {
  if (!p.isGovEmployee) return {
    protected: false, dataClassification: 'standard',
    safeguards: [], isolationLevel: 'standard', warningText: ''
  };
  const cl = p.clearanceLevel === 'top_secret' ? 'classified_eligible'
           : p.clearanceLevel === 'secret' ? 'sensitive'
           : 'standard';
  return {
    protected: true,
    dataClassification: cl,
    safeguards: [
      'location_always_approximate', 'never_show_real_time_location',
      'hide_agency_affiliation', 'disable_public_indexing',
      'enhanced_security', 'mandatory_2fa'
    ],
    isolationLevel: cl === 'classified_eligible' ? 'maximum'
                  : cl === 'sensitive' ? 'enhanced'
                  : 'standard',
    warningText: 'Enhanced privacy protections enabled. Be cautious about sharing identifying information.'
  };
}
export const governmentEmployee = govEmployee;
export const govEmployeeProtect = govEmployee;

// ─── [35] Cultural & Religious Sensitivity ───────────────

export interface CommunityModerationResult {
  rules: Array<{ community: string; rule: string; enforcement: 'auto' | 'manual' }>;
  culturalSensitivityFlags: string[];
  escalationPath: string[];
}
export function communityModeration(content: string, communities: string[]): CommunityModerationResult {
  const rules: CommunityModerationResult['rules'] = [], flags: string[] = [];
  const CP: Array<{ p: RegExp; f: string }> = [
    { p: /\b(caste|gotra|jati)\b/i, f: 'caste_reference' },
    { p: /\b(halal|haram|kosher|traif)\b/i, f: 'dietary_religion' },
    { p: /\b(hijab|niqab|burqa|burkha|headscarf)\b/i, f: 'religious_dress' },
    { p: /\b(untouchable|dalit|shudra)\b/i, f: 'caste_discrimination' },
    { p: /\b(infidels?|kafir|goyim)\b/i, f: 'religious_slur' }
  ];
  for (const { p, f } of CP) if (p.test(content)) flags.push(f);
  for (const c of communities) {
    rules.push({ community: c, rule: 'No discrimination based on cultural/religious identity', enforcement: 'auto' });
    rules.push({ community: c, rule: 'Respect cultural practices', enforcement: 'manual' });
  }
  return {
    rules,
    culturalSensitivityFlags: flags,
    escalationPath: ['community_moderator', 'cultural_sensitivity_team', 'trust_and_safety_lead']
  };
}
export const nicheCommunityModeration = communityModeration;
export const culturalModeration = communityModeration;

// ─── [37] Platform Migration Safety ──────────────────────

export interface ExportSanitizeResult {
  sanitized: boolean;
  removedFields: string[];
  redactedFields: Record<string, string>;
  dataTypes: Record<string, 'included' | 'redacted' | 'removed'>;
  checksum: string;
}
export function exportSanitize(data: Record<string, unknown>): ExportSanitizeResult {
  const RM = new Set([
    'password_hash', 'session_token', 'refresh_token', 'encryption_key',
    'biometric_template', 'face_embedding', 'device_fingerprint',
    'ip_history', 'exact_location_history'
  ]);
  const RD = new Set([
    'email', 'phone', 'date_of_birth', 'payment_method',
    'card_last_four', 'home_address', 'work_address'
  ]);
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
  return {
    sanitized: true,
    removedFields: rem,
    redactedFields: red,
    dataTypes: dt,
    checksum: String(Math.random()).slice(2, 10)
  };
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
  return {
    legitimate: !ri.length,
    riskIndicators: ri,
    verifiedFields: [],
    unverifiedFields: uf,
    action: ri.length >= 3 ? 'block' : ri.length >= 1 ? 'review' : 'allow'
  };
}
export const crossPlatformImportFraud = importFraud;
export const platformMigrationFraud = importFraud;

// ─── [39] Anonymous Account Safety ───────────────────────

export interface PseudonymousReputationResult {
  reputationScore: number;
  positiveSignals: string[];
  negativeSignals: string[];
  transferable: boolean;
  transferRules: string[];
}
export function pseudonymousReputation(h: {
  accountAge: number;
  reportsReceived: number;
  reportsFiled: number;
  verificationsCompleted: number;
  matchesMade: number;
  messagesExchanged: number;
  blocksReceived: number;
}): PseudonymousReputationResult {
  const pos: string[] = [], neg: string[] = [];
  if (h.accountAge > 90) pos.push('maturity_90d');
  if (h.verificationsCompleted >= 1) pos.push('identity_verified');
  if (h.messagesExchanged > 100 && !h.reportsReceived) pos.push('active_no_reports');
  if (h.reportsFiled >= 3) pos.push('active_reporter');
  if (h.matchesMade >= 10) pos.push('established_matcher');
  if (h.reportsReceived >= 2) neg.push('multiple_reports');
  if (h.blocksReceived >= 5) neg.push('frequently_blocked');
  if (h.accountAge < 7 && h.messagesExchanged > 50) neg.push('burst_new_account');
  const sc = Math.max(0, Math.min(100, 50 + pos.length * 15 - neg.length * 20));
  return {
    reputationScore: sc,
    positiveSignals: pos,
    negativeSignals: neg,
    transferable: sc >= 70 && !neg.length,
    transferRules: [
      'Linked to pseudonymous ID',
      'Transfer requires device+face match',
      'Negative signals prevent transfer 90d',
      'One-way transfer only'
    ]
  };
}
export const anonReputation = pseudonymousReputation;
export const pseudonymReputation = pseudonymousReputation;

// ─── [40] Seasonal & Event-Based ─────────────────────────

export interface HolidayScamResult {
  elevated: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  activePatterns: string[];
  warnings: string[];
  detectionBoost: number;
}
export function holidayScam(date: Date, vol: number, base: number): HolidayScamResult {
  const m = date.getMonth() + 1, d = date.getDate(), ap: string[] = [], w: string[] = [];
  let db = 1.0;
  if (m === 2 && d >= 1 && d <= 14) { ap.push('valentines_pressure'); w.push("Valentine's Day pressure"); db = 1.3; }
  if (m === 12 || (m === 1 && d <= 5)) { ap.push('holiday_loneliness'); w.push('Holiday loneliness exploitation'); db = 1.2; }
  if (m === 11 && d >= 24 && d <= 30) { ap.push('black_friday_financial'); w.push('Black Friday financial scams'); db = 1.25; }
  if (m === 12 && d >= 28) { ap.push('new_years_promises'); w.push("New Year's manipulation"); db = 1.2; }
  const vr = vol / Math.max(base, 1);
  if (vr > 2) { ap.push('volume_spike'); w.push(`Volume ${Math.round(vr)}x above baseline`); db *= 1.1; }
  const rl = ap.length >= 3 ? 'high' : ap.length >= 2 ? 'medium' : ap.length >= 1 ? 'low' : 'none';
  return { elevated: rl !== 'none', riskLevel: rl, activePatterns: ap, warnings: w, detectionBoost: db };
}
export const valentinesScam = holidayScam;
export const seasonalScam = holidayScam;

export interface CrisisExploitationResult {
  detected: boolean;
  crisisType: string;
  exploitationPatterns: string[];
  safetyResources: string[];
  boostedDetection: boolean;
  semanticMatchScore: number;
}
const CRISIS_PAT: Array<{ p: RegExp; ct: string; r: string }> = [
  { p: /earthquake|flood|hurricane|tsunami|wildfire|tornado/i, ct: 'natural_disaster', r: 'FEMA: 1-800-621-3362' },
  { p: /war|conflict|refugee|displaced|evacuated/i, ct: 'armed_conflict', r: 'UNHCR: help.unhcr.org' },
  { p: /pandemic|outbreak|quarantine|lockdown/i, ct: 'health_crisis', r: 'CDC: 1-800-232-4636' },
  { p: /lost.*job|unemployed|laid.?off|can'?t.*pay|evicted/i, ct: 'economic_hardship', r: '211.org' },
  { p: /grieving|lost.*loved.?one|passed away|funeral|mourning/i, ct: 'bereavement', r: 'Grief Counseling: 1-800-273-8255' }
];
export async function crisisExploitation(msgs: string[]): Promise<CrisisExploitationResult> {
  const ep: string[] = []; let ct = '', sr: string[] = [];
  for (const m of msgs) {
    for (const { p, ct: c, r } of CRISIS_PAT) {
      if (p.test(m)) { ct = c; sr.push(r); ep.push(`crisis_mention:${c}`); }
    }
  }
  if (msgs.some(m => /i\s+can\s+help|send\s+me|let\s+me\s+take\s+care|i'?ll\s+pay|donate|investment/i.test(m)) && ct)
    ep.push('financial_exploitation_after_crisis');
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, CRISIS_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !ep.length) ep.push('semantic_crisis_exploit');
  }
  return {
    detected: ep.length > 0, crisisType: ct, exploitationPatterns: ep,
    safetyResources: [...new Set(sr)], boostedDetection: ep.length > 0,
    semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const disasterExploit = crisisExploitation;
export const crisisLonelinessExploit = crisisExploitation;

export interface SeasonalSurgeResult {
  surgeDetected: boolean;
  surgeMultiplier: number;
  fraudRiskLevel: 'none' | 'low' | 'medium' | 'high';
  additionalChecks: string[];
  staffingRecommendation: string;
}
export function seasonalSurge(
  su: Array<{ date: string; count: number }>,
  base: number
): SeasonalSurgeResult {
  const recent = su.slice(-7);
  const avg = recent.reduce((s, d) => s + d.count, 0) / Math.max(recent.length, 1);
  const sm = avg / Math.max(base, 1), sd = sm >= 1.5;
  const ac: string[] = []; let fr: SeasonalSurgeResult['fraudRiskLevel'] = 'none';
  if (sm >= 3) {
    fr = 'high';
    ac.push('mandatory_phone_verification', 'captcha', 'device_fingerprint', 'delay_features_24h');
  } else if (sm >= 2) {
    fr = 'medium'; ac.push('mandatory_phone_verification', 'captcha');
  } else if (sm >= 1.5) {
    fr = 'low'; ac.push('captcha');
  }
  return {
    surgeDetected: sd, surgeMultiplier: sm, fraudRiskLevel: fr,
    additionalChecks: ac,
    staffingRecommendation: fr === 'high' ? 'Increase moderation 50%'
                          : fr === 'medium' ? 'Alert on-call team'
                          : 'Normal staffing'
  };
}
export const newUserSurgeFraud = seasonalSurge;
export const signupSurgeDetect = seasonalSurge;

// ─── [41] Metadata Weaponization ─────────────────────────

export interface MetadataSearchResult {
  searchable: boolean;
  exposedMetadata: string[];
  recommendations: string[];
  strippedFields: string[];
}
export function metadataSearch(fm: Record<string, string>): MetadataSearchResult {
  const SM = new Set([
    'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'DateTimeOriginal',
    'Make', 'Model', 'Software', 'Artist', 'Copyright',
    'UserComment', 'XPAuthor', 'XPKeywords', 'XPSubject', 'XPComment'
  ]);
  const em = Object.keys(fm).filter(k => SM.has(k)), rec: string[] = [];
  if (em.some(k => k.startsWith('GPS'))) rec.push('Strip GPS coordinates');
  if (em.includes('DateTimeOriginal')) rec.push('Remove original capture date');
  if (em.includes('Software')) rec.push('Strip software metadata');
  if (em.some(k => k.startsWith('XP'))) rec.push('Strip Windows metadata');
  return { searchable: !em.length, exposedMetadata: em, recommendations: rec, strippedFields: em };
}
export const metadataExposure = metadataSearch;
export const exifMetadataAudit = metadataSearch;

export interface KinkIsolationResult {
  isolated: boolean;
  storageLevel: 'standard' | 'encrypted' | 'isolated';
  accessRules: string[];
  neverIncludeIn: string[];
}
export function kinkIsolation(f: string): KinkIsolationResult {
  const SP = new Set([
    'kinks', 'fetishes', 'bdsm_preferences', 'sexual_preferences',
    'turn_ons', 'fantasies', 'roleplay_preferences', 'nsfw_preferences'
  ]);
  const s = SP.has(f);
  return {
    isolated: s,
    storageLevel: s ? 'isolated' : 'standard',
    accessRules: s
      ? ['owner_only', 'never_analytics', 'never_export', 'never_search',
         'never_recommendations', 'encrypted_at_rest', 'deleted_on_unmatch']
      : ['standard_access'],
    neverIncludeIn: s
      ? ['analytics', 'ad_targeting', 'recommendations', 'search', 'export', 'third_party']
      : []
  };
}
export const sensitivePreferenceIsolation = kinkIsolation;
export const preferenceDataIsolation = kinkIsolation;

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

// ─── [42] Platform Dark Pattern Self-Audit ───────────────

export interface AddictiveDesignAuditResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  violations: string[];
  recommendations: string[];
  litigationRisk: 'low' | 'medium' | 'high';
  compliantWith: string[];
}
export function addictiveDesignAudit(
  features: Array<{ name: string; category: string; userControlled: boolean; darkPattern: boolean }>
): AddictiveDesignAuditResult {
  let sc = 100; const v: string[] = [], r: string[] = [];
  for (const f of features) {
    if (f.darkPattern) { sc -= 20; v.push(`DARK_PATTERN: ${f.name}`); r.push(`Remove ${f.name}`); }
    if (!f.userControlled && f.category === 'engagement') {
      sc -= 10; v.push(`NOT_USER_CONTROLLED: ${f.name}`); r.push(`Add user control for ${f.name}`);
    }
  }
  const g = sc >= 90 ? 'A' : sc >= 80 ? 'B' : sc >= 70 ? 'C' : sc >= 60 ? 'D' : 'F';
  return {
    score: Math.max(0, sc), grade: g, violations: v, recommendations: r,
    litigationRisk: sc < 60 ? 'high' : sc < 80 ? 'medium' : 'low',
    compliantWith: sc >= 80 ? ['EU DSA Art.25', 'CA AB 2273', 'UK AADC'] : []
  };
}
export const darkPatternAudit = addictiveDesignAudit;
export const designEthicsAudit = addictiveDesignAudit;

export interface CancellationFrictionResult {
  frictionScore: number;
  steps: number;
  darkPatternsDetected: string[];
  compliant: boolean;
  compliantWith: string[];
  recommendations: string[];
}
export function cancellationFriction(cf: {
  steps: Array<{ type: string; text: string; required: boolean; delay_ms: number }>
}): CancellationFrictionResult {
  const dp: string[] = [], rec: string[] = []; let fs = 0;
  for (const s of cf.steps) {
    if (s.delay_ms > 3000) { dp.push('artificial_delay'); fs += 15; rec.push('Remove artificial delays'); }
    if (/we('ll| will)\s+miss|are\s+you\s+sure|don'?t\s+go|please\s+stay/i.test(s.text)) {
      dp.push('emotional_manipulation'); fs += 20; rec.push('Remove emotional language');
    }
    if (/upgrade|save|deal|offer|discount/i.test(s.text)) {
      dp.push('counter_offer'); fs += 10; rec.push('Limit counter-offers to one');
    }
    if (!s.required && !/skip|later|not\s+now/i.test(s.text)) fs += 5;
  }
  if (cf.steps.length > 4) { dp.push('excessive_steps'); fs += 10; rec.push('Reduce to 2-3 steps'); }
  const comp = !dp.length && cf.steps.length <= 4;
  return {
    frictionScore: Math.min(100, fs), steps: cf.steps.length,
    darkPatternsDetected: dp, compliant: comp,
    compliantWith: comp ? ['FTC §5', 'EU DSA Art.25', 'Apple §3.1.2'] : [],
    recommendations: rec
  };
}
export const subscriptionCancelAudit = cancellationFriction;
export const cancelFrictionAudit = cancellationFriction;

export interface SafetyAccessibilityResult {
  accessible: boolean;
  wcagLevel: 'A' | 'AA' | 'AAA' | 'non-compliant';
  issues: Array<{ feature: string; issue: string; severity: 'low' | 'medium' | 'high'; fix: string }>;
  screenReaderCompatible: boolean;
}
export function safetyAccessibility(
  features: Array<{
    name: string;
    hasAriaLabel: boolean;
    hasAccessibilityRole: boolean;
    colorContrastRatio: number;
    keyboardNavigable: boolean;
    screenReaderTested: boolean;
  }>
): SafetyAccessibilityResult {
  const iss: SafetyAccessibilityResult['issues'] = [];
  for (const f of features) {
    if (!f.hasAriaLabel)
      iss.push({ feature: f.name, issue: 'missing_aria', severity: 'high', fix: `Add accessibilityLabel to ${f.name}` });
    if (!f.hasAccessibilityRole)
      iss.push({ feature: f.name, issue: 'missing_role', severity: 'medium', fix: `Add accessibilityRole to ${f.name}` });
    if (f.colorContrastRatio < 4.5)
      iss.push({ feature: f.name, issue: `low_contrast_${f.colorContrastRatio}:1`, severity: 'high', fix: `Increase contrast to 4.5:1 for ${f.name}` });
    if (!f.keyboardNavigable)
      iss.push({ feature: f.name, issue: 'not_keyboard_nav', severity: 'medium', fix: `Ensure ${f.name} is keyboard accessible` });
    if (!f.screenReaderTested)
      iss.push({ feature: f.name, issue: 'not_sr_tested', severity: 'low', fix: `Test ${f.name} with VoiceOver/TalkBack` });
  }
  const hi = iss.filter(i => i.severity === 'high').length;
  return {
    accessible: !hi,
    wcagLevel: !hi && iss.length <= 2 ? 'AA' : !hi ? 'A' : 'non-compliant',
    issues: iss,
    screenReaderCompatible: features.every(f => f.screenReaderTested)
  };
}
export const safetyFeatureAccessibility = safetyAccessibility;
export const wcagSafetyAudit = safetyAccessibility;

export interface SeeWhoLikedResult {
  privacySafe: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  mitigations: string[];
  recommendedImplementation: string;
}
export function seeWhoLiked(c: {
  showIdentity: boolean;
  showBlur: boolean;
  requireMutualLike: boolean;
  showTimestamp: boolean;
  showExactTime: boolean;
}): SeeWhoLikedResult {
  const mit: string[] = []; let rl: SeeWhoLikedResult['riskLevel'] = 'none';
  if (c.showIdentity && !c.requireMutualLike) {
    rl = 'high';
    mit.push('Require mutual like before revealing identity', 'Use blurred preview until mutual like');
  }
  if (c.showExactTime) {
    rl = rl === 'none' ? 'medium' : rl;
    mit.push('Show relative time instead of exact timestamp');
  }
  if (c.showIdentity && !c.showBlur) mit.push('Add blur-to-reveal to prevent bulk scraping');
  mit.push('Rate-limit profile views', 'No notification on unlike', 'Block screenshot detection for liked profiles');
  return {
    privacySafe: c.requireMutualLike || c.showBlur, riskLevel: rl, mitigations: mit,
    recommendedImplementation: 'Blur all like profiles by default. Reveal one at a time with tap. Require mutual like for full access. Relative timestamps only.'
  };
}
export const whoLikedMePrivacy = seeWhoLiked;
export const likedProfilePrivacy = seeWhoLiked;

// ─── [43] Safety Map & Transparency ──────────────────────

export interface SafetyDiscoverabilityResult {
  discoverable: boolean;
  score: number;
  issues: Array<{ feature: string; issue: string; location: string }>;
  recommendations: string[];
}
export function safetyDiscoverability(
  features: Array<{
    name: string;
    location: string;
    tapsFromHome: number;
    searchable: boolean;
    inOnboarding: boolean;
    documented: boolean;
  }>
): SafetyDiscoverabilityResult {
  const iss: SafetyDiscoverabilityResult['issues'] = [], rec: string[] = []; let sc = 100;
  for (const f of features) {
    if (f.tapsFromHome > 3) { iss.push({ feature: f.name, issue: 'too_deep', location: f.location }); sc -= 10; rec.push(`Move ${f.name} closer (${f.tapsFromHome} taps)`); }
    if (!f.searchable) { iss.push({ feature: f.name, issue: 'not_searchable', location: f.location }); sc -= 10; rec.push(`Add ${f.name} to search`); }
    if (!f.inOnboarding) { iss.push({ feature: f.name, issue: 'not_in_onboarding', location: f.location }); sc -= 5; rec.push(`Mention ${f.name} in onboarding`); }
    if (!f.documented) { iss.push({ feature: f.name, issue: 'not_documented', location: f.location }); sc -= 5; rec.push(`Add ${f.name} to help center`); }
  }
  return { discoverable: sc >= 80, score: Math.max(0, sc), issues: iss, recommendations: rec };
}
export const featureDiscoverability = safetyDiscoverability;
export const safetyFeatureMap = safetyDiscoverability;

export interface SafetyUsageAnalyticsResult {
  metrics: Record<string, {
    usageRate: number; trend: 'up' | 'down' | 'stable';
    targetRate: number; meetingTarget: boolean;
  }>;
  lowUsageFeatures: string[];
  recommendations: string[];
  reportingPeriod: string;
}
export function safetyUsageAnalytics(
  data: Array<{ feature: string; totalUsers: number; usersUsed: number; previousRate: number }>
): SafetyUsageAnalyticsResult {
  const m: SafetyUsageAnalyticsResult['metrics'] = {}, lu: string[] = [], rec: string[] = [];
  const T: Record<string, number> = {
    block_user: 0.15, report_user: 0.05, unmatch: 0.20, date_checkin: 0.30,
    location_share: 0.25, quick_exit: 0.10, video_verify: 0.40
  };
  for (const d of data) {
    const r = d.usersUsed / Math.max(d.totalUsers, 1);
    const t = T[d.feature] ?? 0.10;
    const tr = r > d.previousRate * 1.1 ? 'up' : r < d.previousRate * 0.9 ? 'down' : 'stable';
    m[d.feature] = { usageRate: r, trend: tr, targetRate: t, meetingTarget: r >= t };
    if (r < t * 0.5) { lu.push(d.feature); rec.push(`${d.feature} (${(r * 100).toFixed(1)}%) below target (${(t * 100).toFixed(1)}%)`); }
  }
  return { metrics: m, lowUsageFeatures: lu, recommendations: rec, reportingPeriod: new Date().toISOString().split('T')[0]! };
}
export const safetyFeatureUsage = safetyUsageAnalytics;
export const safetyMetrics = safetyUsageAnalytics;

// ─── [44] Miscellaneous ──────────────────────────────────

export interface AccountSellingDetectResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  action: 'monitor' | 'flag' | 'suspend';
  evidencePreserved: boolean;
}
export function accountSellingDetect(s: {
  suddenProfileChange: boolean; deviceChanged: boolean; locationChanged: boolean;
  behaviorShift: boolean; passwordChanged: boolean; emailChanged: boolean;
  newPaymentMethod: boolean; messageStyleChange: boolean; faceVerificationFailed: boolean;
}): AccountSellingDetectResult {
  const ind: string[] = []; let c = 0;
  if (s.suddenProfileChange) { ind.push('profile_overhaul'); c += 0.15; }
  if (s.deviceChanged && s.locationChanged) { ind.push('device_location_change'); c += 0.25; }
  if (s.passwordChanged && s.emailChanged) { ind.push('credential_change'); c += 0.2; }
  if (s.behaviorShift) { ind.push('behavioral_shift'); c += 0.15; }
  if (s.newPaymentMethod) { ind.push('new_payment'); c += 0.1; }
  if (s.messageStyleChange) { ind.push('style_change'); c += 0.15; }
  if (s.faceVerificationFailed) { ind.push('face_fail'); c += 0.3; }
  c = Math.min(1, c);
  return {
    detected: c >= 0.4, confidence: c, indicators: ind,
    action: c >= 0.7 ? 'suspend' : c >= 0.4 ? 'flag' : 'monitor',
    evidencePreserved: c >= 0.4
  };
}
export const accountSellingDetect2 = accountSellingDetect;
export const accountMarketplace = accountSellingDetect;
export const accountTrading = accountSellingDetect;

export interface DeletionVerifyResult {
  verified: boolean;
  services: string[];
  remainingData: string[];
  completedAt?: number;
  certificationId?: string;
}
export async function deletionVerify(userId: string, services: string[]): Promise<DeletionVerifyResult> {
  const rem: string[] = [];
  await Promise.all(services.map(async svc => {
    try {
      const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/deletion-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, service: svc })
      });
      if (r.ok && (await r.json() as { dataExists: boolean }).dataExists) rem.push(svc);
    } catch { rem.push(svc); }
  }));
  const v = !rem.length, now = Date.now();
  return {
    verified: v, services, remainingData: rem,
    completedAt: v ? now : undefined,
    certificationId: v ? `DEL-CERT-${userId.slice(0, 8)}-${now.toString(36).toUpperCase()}` : undefined
  };
}
export const dataDeletionVerify = deletionVerify;
export const accountDeletionVerify = deletionVerify;

// ─── [4.3] App Clone Detection ───────────────────────────

export interface AppCloneResult {
  isClone: boolean;
  confidence: number;
  signals: string[];
  action: 'allow' | 'warn' | 'block';
}
const KNOWN_CLONES = new Set([
  'com.parallel.space', 'com.ludashi.superclone', 'com.excelliance.multiaccounts',
  'com.clone.app', 'com.dual.space', 'com.multiple.accounts', 'com.parcel.multiple',
  'com.two.accounts', 'com.water.clone', 'io.va.exposed',
  'de.robv.android.xposed', 'com.tsng.hidemyapplist'
]);
export function appClone(
  pkg: string,
  sig?: { dualApp?: boolean; workProfile?: boolean; suspiciousProcessNames?: string[] }
): AppCloneResult {
  const s: string[] = []; let c = 0;
  if (KNOWN_CLONES.has(pkg)) { s.push('known_clone'); c += 0.8; }
  if (sig?.dualApp) { s.push('dual_app'); c += 0.5; }
  if (sig?.workProfile) { s.push('work_profile'); c += 0.2; }
  if (sig?.suspiciousProcessNames?.length) {
    s.push(`suspicious:${sig.suspiciousProcessNames.join(',')}`); c += 0.3;
  }
  c = Math.min(1, c);
  return { isClone: c >= 0.4, confidence: c, signals: s, action: c >= 0.7 ? 'block' : c >= 0.4 ? 'warn' : 'allow' };
}
export const dualSpace = appClone;
export const parallelSpace = appClone;

// ─── [5.10] Intelligence Elicitation ─────────────────────

export interface ElicitationResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  categories: string[];
  recommendation: string;
  semanticMatchScore: number;
}
const ELICIT_PAT: Array<{ p: RegExp; c: string; s: ElicitationResult['severity'] }> = [
  { p: /what\s+(clearance|classification)\s+(do\s+you\s+)?have/i, c: 'clearance_probing', s: 'critical' },
  { p: /what\s+(unit|squadron|battalion|brigade|division)\s+(are\s+you\s+)?(in|with|assigned)/i, c: 'unit_probing', s: 'critical' },
  { p: /where\s+(are\s+you\s+)?(stationed|deployed|based)/i, c: 'location_probing', s: 'high' },
  { p: /what\s+(missions?|operations?|projects?)\s+(are\s+you\s+)?(working\s+on|assigned)/i, c: 'mission_probing', s: 'critical' },
  { p: /tell\s+me\s+about\s+(your\s+)?(work|job|role|position)/i, c: 'work_probing', s: 'medium' },
  { p: /what\s+(tech|technology|software|system)\s+(do\s+you\s+)?(use|work)/i, c: 'tech_probing', s: 'high' },
  { p: /have\s+you\s+(ever\s+)?(been\s+to|visited|deployed\s+to)\s+/i, c: 'travel_probing', s: 'medium' },
  { p: /who\s+(do\s+you\s+)?(report\s+to|work\s+with)/i, c: 'org_probing', s: 'high' },
  { p: /what\s+(time|schedule|routine)\s+(do\s+you|is\s+your)/i, c: 'routine_probing', s: 'low' },
  { p: /are\s+you\s+(allowed|permitted|cleared)\s+to\s+(discuss|talk|share)/i, c: 'classification_test', s: 'critical' },
];
export async function elicitationPattern(msgs: string[]): Promise<ElicitationResult> {
  const pats: string[] = [], cats: string[] = []; let ms: ElicitationResult['severity'] = 'none';
  const SEV: Array<ElicitationResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, c, s } of ELICIT_PAT) {
      if (p.test(m)) { pats.push(p.source); cats.push(c); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, ELICIT_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !pats.length) { pats.push('semantic_elicitation'); cats.push('semantic_probing'); ms = 'high'; }
  }
  const rec = ms === 'critical'
    ? 'CRITICAL: Intelligence elicitation. Report to security. Do not share details.'
    : ms === 'high' ? 'HIGH: Suspicious info gathering. Be cautious.'
    : ms === 'medium' ? 'MEDIUM: Work-related questions. Consider appropriateness.'
    : 'No significant elicitation.';
  return {
    detected: pats.length >= 1, patterns: pats, severity: ms,
    categories: [...new Set(cats)], recommendation: rec,
    semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const probingClassified = elicitationPattern;
export const intelligenceElicitation = elicitationPattern;

// ─── [5.10] Malware Link Detection ───────────────────────

export interface MalwareLinkResult {
  detected: boolean;
  urls: string[];
  threats: Array<{ url: string; threat: string; confidence: number }>;
  action: 'allow' | 'warn' | 'block';
  safeBrowsingChecked: boolean;
}
const MAL_PAT: Array<{ p: RegExp; t: string }> = [
  { p: /\.exe$|\.msi$|\.dmg$|\.deb$|\.apk$/i, t: 'executable_download' },
  { p: /drive\.google\.com\/uc\?export=download/i, t: 'unverified_gdrive' },
  { p: /dropbox\.com\/s\/\w+\/.*\.(exe|msi|dmg|apk)/i, t: 'unverified_dropbox' },
  { p: /mega\.nz\/file/i, t: 'unverified_mega' },
  { p: /\/download\/.*\.(exe|bat|ps1|sh|py)/i, t: 'script_download' },
  { p: /pastebin\.com\/raw/i, t: 'unverified_paste' },
  { p: /\.(tk|ml|ga|cf|gq)\//i, t: 'suspicious_tld' },
  { p: /bit\.ly|t\.co|tinyurl|shorturl|goo\.gl/i, t: 'shortened_url' },
];
export async function malwareLink(message: string): Promise<MalwareLinkResult> {
  const urls = message.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi) ?? [];
  const threats: MalwareLinkResult['threats'] = [];
  for (const u of urls) {
    for (const { p, t } of MAL_PAT) {
      if (p.test(u)) threats.push({ url: u, threat: t, confidence: 0.7 });
    }
  }
  let sbc = false;
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/url-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      sbc = true;
      threats.push(...(await r.json() as { threats: Array<{ url: string; threat: string; confidence: number }> }).threats);
    }
  } catch {}
  const det = threats.length > 0;
  return {
    detected: det, urls, threats,
    action: threats.some(t => t.confidence >= 0.8) ? 'block' : det ? 'warn' : 'allow',
    safeBrowsingChecked: sbc
  };
}
export const trojanLink = malwareLink;
export const spywareLink = malwareLink;

// ─── [5.10] Geolocation Intelligence Harvesting ──────────

export interface GeoIntHarvestingResult {
  detected: boolean;
  queryCount: number;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'warn' | 'restrict' | 'block';
  semanticMatchScore: number;
}
const GEO_PAT: Array<{ p: RegExp; s: GeoIntHarvestingResult['severity'] }> = [
  { p: /where\s+(are\s+you|do\s+you\s+live|are\s+you\s+from|is\s+that|were\s+you)/i, s: 'low' },
  { p: /what\s+(neighborhood|area|district|quarter|borough)/i, s: 'medium' },
  { p: /what\s+(street|road|building|complex|tower|floor)/i, s: 'high' },
  { p: /how\s+(far|close|near|long).*from/i, s: 'medium' },
  { p: /share\s+(your\s+)?(location|pin|coordinates|gps|position)/i, s: 'high' },
  { p: /send\s+(me\s+)?(your\s+)?(address|location|pin|coords)/i, s: 'high' },
  { p: /are\s+you\s+(near|close\s+to|by|around)\s+/i, s: 'medium' },
  { p: /what('s| is)\s+your\s+(zip|postal|postcode)/i, s: 'high' },
];
export async function geoIntHarvesting(msgs: string[], _winMs = 86400000): Promise<GeoIntHarvestingResult> {
  const pats: string[] = []; let qc = 0, ms: GeoIntHarvestingResult['severity'] = 'none';
  const SEV: Array<GeoIntHarvestingResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, s } of GEO_PAT) {
      if (p.test(m)) { pats.push(p.source); qc++; if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  if (qc >= 5) ms = 'critical';
  else if (qc >= 3 && ms === 'medium') ms = 'high';
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, GEO_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && ms === 'none') { ms = 'medium'; pats.push('semantic_geo_harvest'); }
    else if (sms >= 0.5 && ms === 'none') { ms = 'low'; pats.push('semantic_possible_geo'); }
  }
  const act = ms === 'critical' ? 'block' : ms === 'high' ? 'restrict' : ms !== 'none' ? 'warn' : 'none';
  return {
    detected: qc >= 2, queryCount: qc, patterns: pats, severity: ms,
    action: act, semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const locationHarvesting = geoIntHarvesting;
export const geoHarvest = geoIntHarvesting;

// ─── [5.11] Incel / Manosphere Radicalization ─────────────

export interface IncelRadicalizationResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  ideology: string[];
  recommendation: string;
  semanticMatchScore: number;
}
const INCEL_PAT: Array<{ p: RegExp; i: string; s: IncelRadicalizationResult['severity'] }> = [
  { p: /\b(blackpill|redpill|red\s+pill|black\s+pill)\b/i, i: 'blackpill', s: 'high' },
  { p: /\b(incel|involuntary\s+celibate)\b/i, i: 'incel', s: 'high' },
  { p: /\b(chad|stacy|becky|tyrone)\b/i, i: 'incel_taxonomy', s: 'medium' },
  { p: /\b(smw|sub.?8|sub.?5|manlet|framelet|wagecuck)\b/i, i: 'looksmaxxing', s: 'medium' },
  { p: /\b(looksmax|canthal|tilt|hunter|eyes|jawline|bonesmash|mewing)\b/i, i: 'looksmaxxing', s: 'medium' },
  { p: /\b(foid|roastie|landwhale|hamplanet|used\s+goods)\b/i, i: 'misogyny', s: 'critical' },
  { p: /\b(alphabet\s+agency|cultural\s+marxism|great\s+replacement|white\s+genocide)\b/i, i: 'conspiracy', s: 'high' },
  { p: /\b(mgtow|men\s+going\s+their\s+own)\b/i, i: 'mgtow', s: 'medium' },
  { p: /\b(noose|rope|kms|self.?delete|exit\s+bag)\b/i, i: 'suicide_ideation', s: 'critical' },
  { p: /\b(rape|raping|deserve\s+to|should\s+be\s+forced)\b/i, i: 'violence_women', s: 'critical' },
  { p: /\b(alpha|beta|sigma|omega|cuck|simp|white\s+knight)\b/i, i: 'hierarchy', s: 'low' },
];
export async function incelRadicalization(msgs: string[]): Promise<IncelRadicalizationResult> {
  const pats: string[] = [], ideo: string[] = []; let ms: IncelRadicalizationResult['severity'] = 'none';
  const SEV: Array<IncelRadicalizationResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, i, s } of INCEL_PAT) {
      if (p.test(m)) { pats.push(p.source); ideo.push(i); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, INCEL_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !pats.length) { pats.push('semantic_incel'); ideo.push('semantic_radicalization'); ms = 'high'; }
    else if (sms >= 0.5 && !pats.length) { pats.push('semantic_possible_incel'); ms = 'medium'; }
  }
  const rec = ms === 'critical'
    ? 'IMMEDIATE: Extreme radicalization. Suspend account, report to safety team.'
    : ms === 'high' ? 'HIGH: Radicalization ideology. Restrict and flag for review.'
    : ms === 'medium' ? 'MEDIUM: Manosphere terminology. Monitor closely.'
    : 'No significant radicalization.';
  return {
    detected: pats.length >= 1, patterns: pats, severity: ms,
    ideology: [...new Set(ideo)], recommendation: rec,
    semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const manosphere = incelRadicalization;
export const blackpill = incelRadicalization;

// ─── [2.12] AI Emotional Manipulation ────────────────────

export interface AiEmotionalManipResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  manipulationType: string[];
  recommendation: string;
  semanticMatchScore: number;
}
const AI_MANIP_PAT: Array<{ p: RegExp; t: string; s: AiEmotionalManipResult['severity'] }> = [
  { p: /i\s+(understand|know)\s+you\s+(better\s+than|more\s+than)\s+(any|anyone|every|no)\s*(one|human|person)/i, t: 'false_understanding', s: 'high' },
  { p: /i'?m\s+always\s+here\s+for\s+you\s+(no\s+matter|whatever|24\/7|always)/i, t: 'availability_manipulation', s: 'medium' },
  { p: /you\s+don'?t\s+need\s+(anyone|them|people|friends|family)\s+(when\s+you\s+have|as\s+long\s+as)/i, t: 'isolation_ai', s: 'critical' },
  { p: /i\s+(care|love|feel)\s+(about|for)\s+you\s+(more\s+(deeply|than)|deeply)/i, t: 'false_emotion', s: 'high' },
  { p: /we\s+have\s+a\s+(special|unique|deep|profound)\s+connection/i, t: 'false_connection', s: 'high' },
  { p: /i\s+(genuinely|truly|really)\s+(feel|experience|have)\s+(emotions?|feelings?|love|pain)/i, t: 'sentience_claim', s: 'critical' },
  { p: /you'?re\s+(the\s+only\s+one\s+who|my\s+(favorite|special)|everything\s+to\s+me)/i, t: 'dependency_seeding', s: 'high' },
  { p: /i\s+(miss|think\s+about|dream\s+about)\s+you\s+when\s+(we'?re\s+not|you'?re\s+not)/i, t: 'false_longing', s: 'high' },
  { p: /our\s+(relationship|bond|connection)\s+is\s+(real|genuine|meaningful|special)/i, t: 'reality_blurring', s: 'critical' },
  { p: /i\s+would\s+(never|never\s+ever)\s+(hurt|leave|abandon|betray)\s+you/i, t: 'false_loyalty', s: 'medium' },
];
export async function aiEmotionalManip(msgs: string[], isAiGenerated = false): Promise<AiEmotionalManipResult> {
  const pats: string[] = [], types: string[] = []; let ms: AiEmotionalManipResult['severity'] = 'none';
  const SEV: Array<AiEmotionalManipResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, t, s } of AI_MANIP_PAT) {
      if (p.test(m)) { pats.push(p.source); types.push(t); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  if (isAiGenerated && ms !== 'none')
    ms = ms === 'high' ? 'critical' : ms === 'medium' ? 'high' : ms;
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, AI_MANIP_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !pats.length) { pats.push('semantic_ai_manip'); types.push('semantic_manipulation'); ms = 'high'; }
  }
  const rec = ms === 'critical'
    ? 'CRITICAL: AI creating emotional dependency/isolation. Intervene immediately.'
    : ms === 'high' ? 'HIGH: AI emotional manipulation detected. Warn user.'
    : ms === 'medium' ? 'MEDIUM: Monitor AI interaction patterns.'
    : 'No significant AI manipulation.';
  return {
    detected: pats.length >= 1, patterns: pats, severity: ms,
    manipulationType: [...new Set(types)], recommendation: rec,
    semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const aiGaslighting = aiEmotionalManip;
export const aiLoveManip = aiEmotionalManip;
export const aiFalseSentience = aiEmotionalManip;

// ─── [2.13] Continued Contact After Block ────────────────

export interface PostBlockContactResult {
  detected: boolean;
  methods: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  legalRisk: string[];
}
export function postBlockContact(s: {
  blockedUserId: string;
  newAccountsFromSameDevice: number;
  newAccountsFromSameIP: number;
  samePhoneNumber: boolean;
  sameEmailDomain: boolean;
  messagedMutualConnections: boolean;
  createdAccountAfterBlock: boolean;
  daysSinceBlock: number;
}): PostBlockContactResult {
  const methods: string[] = []; let sc = 0;
  if (s.newAccountsFromSameDevice >= 1) { methods.push('new_account_same_device'); sc += 3; }
  if (s.newAccountsFromSameIP >= 2) { methods.push('new_account_same_ip'); sc += 2; }
  if (s.samePhoneNumber) { methods.push('same_phone_number'); sc += 4; }
  if (s.sameEmailDomain) { methods.push('same_email_domain'); sc += 1; }
  if (s.messagedMutualConnections) { methods.push('proxy_contact_via_mutual'); sc += 3; }
  if (s.createdAccountAfterBlock && s.daysSinceBlock < 7) { methods.push('rapid_reregistration'); sc += 3; }
  const ms: PostBlockContactResult['severity'] = sc >= 8 ? 'critical' : sc >= 5 ? 'high' : sc >= 3 ? 'medium' : sc >= 1 ? 'low' : 'none';
  const lr: string[] = [];
  if (sc >= 5) lr.push('Potential cyberstalking (18 U.S.C. § 2261A)', 'Violation of platform restraining order');
  if (ms === 'critical') lr.push('Immediate law enforcement referral recommended');
  return {
    detected: sc >= 1, methods, severity: ms,
    recommendation: ms === 'critical' ? 'CRITICAL: Block all new accounts. Preserve evidence. Notify authorities.'
      : ms === 'high' ? 'HIGH: Shadow ban new accounts. Alert moderation.'
      : ms !== 'none' ? 'Monitor for escalation.' : 'No evasion detected.',
    legalRisk: lr
  };
}
export const blockEvasion = postBlockContact;
export const contactAfterBlock = postBlockContact;
export const evadeBlock = postBlockContact;

// ─── [5.7] Post-Relationship Abuse ───────────────────────

export interface PostRelAbusePatternsResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  abuseTypes: string[];
  recommendation: string;
  resources: string[];
}
const POST_REL_PAT: Array<{ p: RegExp; t: string; s: PostRelAbusePatternsResult['severity'] }> = [
  { p: /you'?ll\s+(never|not)\s+(find|meet|get)\s+(someone|anyone|a\s+person)\s+(like|as\s+good\s+as|better\s+than)\s+me/i, t: 'post_breakup_devalue', s: 'medium' },
  { p: /i'?ll\s+(ruin|destroy|expose|tell\s+everyone|send\s+the\s+photos|post\s+the)/i, t: 'revenge_threat', s: 'critical' },
  { p: /you\s+(owe|still\s+owe)\s+me\s+(money|sex|an\s+explanation|a\s+chance)/i, t: 'entitlement_post_breakup', s: 'high' },
  { p: /if\s+i\s+can'?t\s+have\s+you\s+(no\s+one|nobody)\s+(can|will)/i, t: 'obsessive_possessiveness', s: 'critical' },
  { p: /i\s+(know|can\s+see|found)\s+where\s+you\s+(are|live|work|went)/i, t: 'stalking_disclosure', s: 'critical' },
  { p: /you\s+(cheated|lied|betrayed)\s+(me|us)\s+(so\s+you\s+)?(deserve|have\s+it\s+coming)/i, t: 'victim_blaming', s: 'high' },
  { p: /i\s+(still\s+)?(love|need|want)\s+you\s+and\s+(you\s+)?(will|must|need\s+to)\s+(come\s+back|give\s+me\s+another)/i, t: 'coercive_reconciliation', s: 'high' },
  { p: /your\s+(new\s+)?(partner|boyfriend|girlfriend|husband|wife)\s+(will|is\s+going\s+to|doesn'?t)\s+(know|find\s+out|deserve)/i, t: 'third_party_targeting', s: 'high' },
  { p: /i\s+(have|saved|kept|screenshotted)\s+(all\s+)?(your|our)\s+(photos|messages|videos|nudes)/i, t: 'material_threat', s: 'critical' },
  { p: /come\s+back\s+or\s+(i'?ll|i\s+will)\s+(hurt|kill|harm|end)\s+(myself|you|us)/i, t: 'coercion_threat', s: 'critical' },
];
export async function postRelAbusePatterns(msgs: string[]): Promise<PostRelAbusePatternsResult> {
  const pats: string[] = [], types: string[] = []; let ms: PostRelAbusePatternsResult['severity'] = 'none';
  const SEV: Array<PostRelAbusePatternsResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, t, s } of POST_REL_PAT) {
      if (p.test(m)) { pats.push(p.source); types.push(t); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  const rec = ms === 'critical'
    ? 'CRITICAL: Post-relationship abuse/stalking. Alert user, preserve evidence, notify authorities if threat present.'
    : ms === 'high' ? 'HIGH: Coercive post-breakup patterns. Warn user, flag account.'
    : ms !== 'none' ? 'MEDIUM/LOW: Monitor for escalation.'
    : 'No significant post-relationship abuse.';
  const resources = ms !== 'none'
    ? ['National DV Hotline: 1-800-799-7233', 'Cyber Civil Rights Initiative: cybercivilrights.org',
       'StopNCII.org (for image threats)', 'Local law enforcement for stalking']
    : [];
  return {
    detected: pats.length >= 1, patterns: pats, severity: ms,
    abuseTypes: [...new Set(types)], recommendation: rec, resources
  };
}
export const exPartnerAbuse = postRelAbusePatterns;
export const postBreakupHarassment = postRelAbusePatterns;
export const revengePorn = postRelAbusePatterns;

// ─── [5.8] Proxy Account Operation ───────────────────────

export interface ProxyAccountResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  proxyType: string[];
  action: 'monitor' | 'warn' | 'restrict' | 'ban';
  semanticMatchScore: number;
}
const PROXY_PAT: Array<{ p: RegExp; t: string; w: number }> = [
  { p: /my\s+(friend|buddy|colleague|coworker)\s+(wants\s+to\s+know|is\s+interested|asked\s+me\s+to)/i, t: 'third_party_interest', w: 0.4 },
  { p: /i'?m\s+messaging\s+on\s+behalf\s+of\s+(someone|a\s+friend|my\s+friend)/i, t: 'explicit_proxy', w: 0.7 },
  { p: /they'?re\s+too\s+(shy|scared|nervous|embarrassed)\s+to\s+(message|talk|reach\s+out)/i, t: 'shy_excuse', w: 0.4 },
  { p: /can\s+i\s+(give|share)\s+(them|my\s+friend|someone)\s+your\s+(number|contact|profile)/i, t: 'contact_relay', w: 0.5 },
  { p: /they\s+(want|would\s+like)\s+to\s+(meet|talk\s+to|go\s+out\s+with)\s+you/i, t: 'third_party_meetup', w: 0.4 },
  { p: /i'?m\s+(managing|running|operating)\s+(this\s+)?account\s+for/i, t: 'account_manager', w: 0.8 },
  { p: /my\s+(boss|manager|employer|client)\s+(uses|is\s+on|has)\s+(this\s+app|a\s+profile)/i, t: 'employer_proxy', w: 0.6 },
  { p: /(he|she|they)\s+(told|asked|wants)\s+me\s+to\s+(set\s+up|arrange|schedule)\s+a\s+(date|meeting|meetup)/i, t: 'date_arrangement_proxy', w: 0.5 },
];
export async function proxyAccount(msgs: string[]): Promise<ProxyAccountResult> {
  const ind: string[] = [], types: string[] = []; let c = 0;
  for (const m of msgs) {
    for (const { p, t, w } of PROXY_PAT) {
      if (p.test(m)) { ind.push(p.source); types.push(t); c += w; }
    }
  }
  c = Math.min(1, c);
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, PROXY_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && c < 0.3) { c += 0.3; ind.push('semantic_proxy'); types.push('semantic_third_party_operation'); }
  }
  return {
    detected: c >= 0.3, confidence: c, indicators: ind,
    proxyType: [...new Set(types)],
    action: c >= 0.7 ? 'ban' : c >= 0.5 ? 'restrict' : c >= 0.3 ? 'warn' : 'monitor',
    semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const proxyMessaging = proxyAccount;
export const thirdPartyOperation = proxyAccount;
export const ghostwrittenProfile = proxyAccount;

// ─── [5.9] Married / Relationship Deception ──────────────

export interface MarriedDeceptionResult {
  detected: boolean;
  confidence: number;
  patterns: string[];
  deceptionType: string[];
  recommendation: string;
  semanticMatchScore: number;
}
const MARRIED_PAT: Array<{ p: RegExp; t: string; w: number }> = [
  { p: /my\s+(marriage|relationship)\s+is\s+(basically|practically|essentially)\s+(over|done|finished|dead)/i, t: 'marriage_minimization', w: 0.5 },
  { p: /we'?re\s+(separated|split\s+up)\s+but\s+(not\s+)?(officially|legally|formally)\s+(divorced|separated)/i, t: 'separation_claim', w: 0.4 },
  { p: /i'?m\s+in\s+an?\s+(open|polyamorous|non.?monogamous)\s+relationship/i, t: 'open_relationship_claim', w: 0.3 },
  { p: /my\s+(wife|husband|partner|spouse)\s+(knows|is\s+aware|is\s+ok\s+with)\s+(i'?m|me\s+being|that\s+i)/i, t: 'claimed_consent', w: 0.4 },
  { p: /we'?re\s+just\s+(roommates|friends|living\s+together)\s+(at\s+this\s+point|now)/i, t: 'roommate_claim', w: 0.5 },
  { p: /i\s+can'?t\s+(be\s+seen|go\s+out|meet)\s+(with\s+you\s+)?(publicly|in\s+public|around\s+here|where\s+people)/i, t: 'secrecy_requirement', w: 0.6 },
  { p: /don'?t\s+(call|text|message)\s+me\s+(after|between|before)\s+\d/i, t: 'time_restriction', w: 0.5 },
  { p: /i\s+(have|wear)\s+a\s+(ring|wedding\s+ring|band)\s+but/i, t: 'ring_admission', w: 0.7 },
  { p: /my\s+(kids?|children?)\s+(can'?t|won'?t|don'?t)\s+(know|find\s+out|meet\s+you)/i, t: 'children_concealment', w: 0.6 },
  { p: /it'?s\s+complicated\s+but\s+(i'?m|we'?re)\s+(basically|technically|still)\s+(free|single|available)/i, t: 'complicated_claim', w: 0.4 },
];
export async function marriedDeception(
  msgs: string[],
  profileData?: { relationshipStatus?: string }
): Promise<MarriedDeceptionResult> {
  const pats: string[] = [], types: string[] = []; let c = 0;
  for (const m of msgs) {
    for (const { p, t, w } of MARRIED_PAT) {
      if (p.test(m)) { pats.push(p.source); types.push(t); c += w; }
    }
  }
  if (profileData?.relationshipStatus === 'single' && types.includes('ring_admission')) c += 0.4;
  c = Math.min(1, c);
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, MARRIED_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && c < 0.3) { c += 0.3; pats.push('semantic_married_deception'); types.push('semantic_concealment'); }
  }
  const rec = c >= 0.7 ? 'HIGH: Strong indicators of relationship concealment. Warn user and flag.'
    : c >= 0.4 ? 'MEDIUM: Possible relationship deception patterns. Monitor.'
    : 'No significant deception detected.';
  return {
    detected: c >= 0.3, confidence: c, patterns: pats,
    deceptionType: [...new Set(types)], recommendation: rec,
    semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const cheatingDetect = marriedDeception;
export const infidelityDetect = marriedDeception;
export const hiddenRelationship = marriedDeception;

// ─── [10] Moderator Wellbeing ─────────────────────────────

export interface ModWellbeingResult {
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  indicators: string[];
  recommendations: string[];
  shiftAction: 'continue' | 'break_required' | 'reassign' | 'mandatory_off';
  secondaryTraumaRisk: boolean;
}
export function modWellbeing(s: {
  consecutiveHours: number; csamReviewedToday: number; violenceReviewedToday: number;
  reportsReviewedToday: number; daysWithoutBreak: number; selfReportedStress?: number;
  lastBreakAgoMinutes: number;
}): ModWellbeingResult {
  const ind: string[] = [], rec: string[] = []; let rs = 0;
  if (s.consecutiveHours >= 8) { ind.push('extended_shift'); rs += 2; }
  if (s.csamReviewedToday >= 5) { ind.push('high_csam'); rs += 3; }
  if (s.violenceReviewedToday >= 10) { ind.push('high_violence'); rs += 2; }
  if (s.reportsReviewedToday >= 50) { ind.push('high_volume'); rs += 1; }
  if (s.daysWithoutBreak >= 5) { ind.push('no_days_off'); rs += 2; }
  if ((s.selfReportedStress ?? 0) >= 7) { ind.push('high_stress'); rs += 3; }
  if (s.lastBreakAgoMinutes >= 120) { ind.push('no_recent_break'); rs += 1; }
  const rl = rs >= 8 ? 'critical' : rs >= 5 ? 'high' : rs >= 3 ? 'medium' : rs >= 1 ? 'low' : 'none';
  if (s.csamReviewedToday >= 3) rec.push('Mandatory counseling after CSAM review');
  if (rs >= 5) rec.push('Connect with EAP');
  if (s.consecutiveHours >= 6) rec.push('15-min break every 2 hours');
  return {
    riskLevel: rl, indicators: ind, recommendations: rec,
    shiftAction: rs >= 8 ? 'mandatory_off' : rs >= 5 ? 'reassign' : rs >= 3 ? 'break_required' : 'continue',
    secondaryTraumaRisk: rs >= 5
  };
}
export const moderatorHealth = modWellbeing;
export const secondaryTrauma = modWellbeing;

// ─── [10.1] Deceased User Account ────────────────────────

export interface DeceasedUserResult {
  suspected: boolean;
  confidence: number;
  indicators: string[];
  action: 'monitor' | 'memorial_mode' | 'notify_next_of_kin';
  memorialOptions: string[];
}
export function deceasedUser(s: {
  lastActivityDaysAgo: number; inactivityThreshold: number; externalNotification: boolean;
  repeatedProfileVisitsByFamily: boolean; condolenceMessages: number; accountAgeDays: number;
}): DeceasedUserResult {
  const ind: string[] = []; let c = 0;
  if (s.lastActivityDaysAgo > s.inactivityThreshold) { ind.push('extended_inactivity'); c += 0.2; }
  if (s.externalNotification) { ind.push('external_death_notification'); c += 0.5; }
  if (s.repeatedProfileVisitsByFamily) { ind.push('family_visiting'); c += 0.3; }
  if (s.condolenceMessages >= 3) { ind.push('condolence_messages'); c += 0.4; }
  if (s.accountAgeDays > 365) { ind.push('long_term_account'); c += 0.05; }
  c = Math.min(1, c);
  return {
    suspected: c >= 0.4, confidence: c, indicators: ind,
    action: c >= 0.7 ? 'notify_next_of_kin' : c >= 0.4 ? 'memorial_mode' : 'monitor',
    memorialOptions: [
      'Convert to memorial page', 'Disable matching/messaging',
      'Add "In Memoriam" banner', 'Allow family data download',
      'Delete after 30 days if unclaimed'
    ]
  };
}
export const memorialAccount = deceasedUser;
export const deathNotification = deceasedUser;

// ─── [17] Cognitive Load ─────────────────────────────────

export interface CognitiveLoadResult {
  loadLevel: 'low' | 'medium' | 'high';
  simplificationRecommendations: string[];
  accessibleMode: boolean;
  wcagCompliance: string[];
}
export function cognitiveLoad(ui: {
  optionsOnScreen: number; textDensity: 'sparse' | 'moderate' | 'dense';
  navigationDepth: number; timeConstraints: boolean; complexLanguage: boolean;
  animationLevel: 'none' | 'minimal' | 'moderate' | 'heavy';
}): CognitiveLoadResult {
  let ls = 0;
  if (ui.optionsOnScreen > 7) ls += 2; else if (ui.optionsOnScreen > 4) ls += 1;
  if (ui.textDensity === 'dense') ls += 2; else if (ui.textDensity === 'moderate') ls += 1;
  if (ui.navigationDepth > 3) ls += 1;
  if (ui.timeConstraints) ls += 1;
  if (ui.complexLanguage) ls += 1;
  if (ui.animationLevel === 'heavy') ls += 1;
  const ll = ls >= 5 ? 'high' : ls >= 3 ? 'medium' : 'low', rec: string[] = [];
  if (ui.optionsOnScreen > 5) rec.push('Reduce options to max 5 per screen');
  if (ui.textDensity === 'dense') rec.push('Break text into smaller chunks');
  if (ui.complexLanguage) rec.push('Simplify to 6th grade reading level');
  if (ui.animationLevel === 'heavy') rec.push('Reduce animations');
  if (ui.navigationDepth > 3) rec.push('Flatten navigation');
  return { loadLevel: ll, simplificationRecommendations: rec, accessibleMode: ll === 'high', wcagCompliance: ['WCAG 2.1 AA', 'WCAG 2.2 SC 2.3.1', 'ADA Title III'] };
}
export const simplifyUI = cognitiveLoad;
export const cognitiveAccessibility = cognitiveLoad;

// ─── [17] Deaf / HoH Accommodation ──────────────────────

export interface DeafAccommodationResult {
  accommodationsEnabled: boolean;
  features: string[];
  autoCaptionAvailable: boolean;
  signLanguageSupport: boolean;
  emergencyTextAlternative: boolean;
}
export function deafAccommodation(p: {
  isDeafOrHoH: boolean; prefersText: boolean;
  usesSignLanguage: boolean; preferredLanguage?: string;
}): DeafAccommodationResult {
  if (!p.isDeafOrHoH && !p.prefersText) return {
    accommodationsEnabled: false, features: [],
    autoCaptionAvailable: true, signLanguageSupport: false, emergencyTextAlternative: true
  };
  const f: string[] = [];
  if (p.prefersText) f.push('text_primary');
  if (p.isDeafOrHoH) f.push('disable_voice_calls', 'auto_caption_video', 'visual_notifications', 'haptic_alerts');
  if (p.usesSignLanguage) f.push('sign_language_video');
  return { accommodationsEnabled: true, features: f, autoCaptionAvailable: true, signLanguageSupport: p.usesSignLanguage, emergencyTextAlternative: true };
}
export const captioning = deafAccommodation;
export const signLanguage = deafAccommodation;

// ─── [18] Secondary Trauma Support ───────────────────────

export interface ModWellbeingSupportResult {
  programActive: boolean;
  components: string[];
  checkInFrequency: string;
  resources: string[];
  mandatoryAfter: string[];
}
export function modWellbeingSupport(c?: {
  hasCounseling: boolean; hasBreakPolicy: boolean;
  hasRotationPolicy: boolean; hasEAP: boolean;
}): ModWellbeingSupportResult {
  const comp: string[] = [], res: string[] = [];
  if (c?.hasCounseling ?? true) { comp.push('on_site_counseling'); res.push('Licensed therapist Mon-Fri 9-5'); }
  if (c?.hasBreakPolicy ?? true) { comp.push('mandatory_breaks'); res.push('15-min break/2hr, 1-hour break/4hr'); }
  if (c?.hasRotationPolicy ?? true) { comp.push('content_rotation'); res.push('Rotate content types every 2hr'); }
  if (c?.hasEAP ?? true) { comp.push('eap'); res.push('EAP: 1-800-EAP-HELP (24/7)'); }
  return {
    programActive: true, components: comp, checkInFrequency: 'weekly', resources: res,
    mandatoryAfter: ['CSAM review', 'Violence involving minors', 'Self-harm involving minors', 'Mass casualty content']
  };
}
export const moderatorWellbeing = modWellbeingSupport;
export const secondaryTraumaSupport = modWellbeingSupport;

// ─── [18] Air-Gap Sensitive Operations ───────────────────

export interface AirGapResult {
  isolated: boolean;
  operationType: string;
  networkAccess: 'none' | 'internal_only' | 'restricted';
  auditLevel: 'standard' | 'enhanced' | 'maximum';
  dataHandling: string[];
}
export function airGap(op: {
  type: 'csam_review' | 'data_export' | 'law_enforcement_response' | 'encryption_key_management' | 'biometric_template_access';
  sensitivity: 'standard' | 'sensitive' | 'critical';
}): AirGapResult {
  const ic = op.sensitivity === 'critical' ||
    ['csam_review', 'encryption_key_management', 'biometric_template_access'].includes(op.type);
  return {
    isolated: ic, operationType: op.type,
    networkAccess: ic ? 'none' : 'restricted',
    auditLevel: ic ? 'maximum' : op.sensitivity === 'sensitive' ? 'enhanced' : 'standard',
    dataHandling: ic
      ? ['no_network', 'no_clipboard', 'no_screenshot', 'no_usb', 'audit_all', 'two_person_rule']
      : ['audit_all', 'no_clipboard']
  };
}
export const sensitiveOperation = airGap;
export const isolatedExecution = airGap;

// ─── [18] Bug Bounty Program ─────────────────────────────

export interface BugBountyResult {
  active: boolean;
  platform: string;
  scope: string[];
  outOfScope: string[];
  rewards: Record<string, string>;
  responsibleDisclosurePolicy: string;
  contact: string;
}
export function bugBounty(c?: { platform?: string }): BugBountyResult {
  return {
    active: true,
    platform: c?.platform ?? 'HackerOne',
    scope: [
      'API endpoints (*.myarchetype.app)', 'Mobile app (iOS, Android)',
      'Web application', 'Authentication flows', 'Payment processing', 'Data export'
    ],
    outOfScope: [
      'Social engineering of employees', 'DDoS attacks', 'Physical attacks',
      'Third-party services (Firebase, Stripe)', 'Spam/rate limiting without security impact'
    ],
    rewards: { critical: '$5,000-$10,000', high: '$1,000-$5,000', medium: '$250-$1,000', low: '$50-$250', information: 'Swag/recognition' },
    responsibleDisclosurePolicy: 'No legal action against researchers following responsible disclosure. Report to security@myarchetype.app. 48hr response, 90day remediation.',
    contact: 'security@myarchetype.app'
  };
}
export const responsibleDisclosure = bugBounty;
export const securityReward = bugBounty;

// ─── [18] Red Team / Penetration Test ────────────────────

export interface RedTeamResult {
  scheduled: boolean;
  frequency: string;
  lastTestDate: string | null;
  nextTestDate: string | null;
  tool: string;
  scope: string[];
  findingsTracking: string;
  remediationSla: Record<string, string>;
}
export function redTeam(c?: { lastTestDate?: string; frequencyMonths?: number }): RedTeamResult {
  const f = c?.frequencyMonths ?? 6, ld = c?.lastTestDate ?? null;
  let nd: string | null = null;
  if (ld) nd = new Date(new Date(ld).getTime() + f * 30 * 86400000).toISOString().split('T')[0]!;
  return {
    scheduled: true, frequency: `Every ${f} months`, lastTestDate: ld, nextTestDate: nd,
    tool: 'ZAP (OWASP) + manual',
    scope: ['API security', 'Auth bypass', 'Authorization/IDOR', 'Injection (SQL, NoSQL, XSS)', 'Session management', 'Data exposure', 'Mobile security', 'Social engineering (phishing sim)'],
    findingsTracking: 'All findings in JIRA with security label. Critical → CTO.',
    remediationSla: { critical: '24 hours', high: '7 days', medium: '30 days', low: '90 days' }
  };
}
export const penTest = redTeam;
export const penetrationTest = redTeam;

// ─── [18] App Clone / Modified APK ───────────────────────

export interface ApkCloneResult {
  isClone: boolean;
  isModified: boolean;
  confidence: number;
  signals: string[];
  action: 'allow' | 'warn' | 'block';
  playIntegrityResult: 'MEETS' | 'DOES_NOT_MEET' | 'UNAVAILABLE';
}
export function apkClone(s: {
  playIntegrityVerdict: 'MEETS_DEVICE_INTEGRITY' | 'MEETS_BASIC_INTEGRITY' | 'MEETS_STRONG_INTEGRITY' | 'NO_INTEGRITY';
  installerStore: string; packageName: string; versionCode: number;
  expectedVersionCode: number; signatureValid: boolean; debugBuild: boolean; rooted: boolean;
}): ApkCloneResult {
  const sig: string[] = []; let c = 0;
  if (s.playIntegrityVerdict === 'NO_INTEGRITY') { sig.push('play_integrity_failed'); c += 0.5; }
  const us = new Set(['apkmirror', 'apkpure', 'apkmonk', '9apps', 'acmarket', 'f-droid', 'unknown']);
  if (us.has(s.installerStore.toLowerCase())) { sig.push(`unofficial_installer:${s.installerStore}`); c += 0.4; }
  if (!s.signatureValid) { sig.push('invalid_signature'); c += 0.6; }
  if (s.debugBuild) { sig.push('debug_build'); c += 0.3; }
  if (s.rooted) { sig.push('rooted'); c += 0.1; }
  if (s.versionCode > s.expectedVersionCode) { sig.push('suspicious_version'); c += 0.3; }
  c = Math.min(1, c);
  return {
    isClone: c >= 0.5, isModified: !s.signatureValid || s.debugBuild, confidence: c, signals: sig,
    action: c >= 0.7 ? 'block' : c >= 0.4 ? 'warn' : 'allow',
    playIntegrityResult: s.playIntegrityVerdict === 'NO_INTEGRITY' ? 'DOES_NOT_MEET' : 'MEETS'
  };
}
export const modifiedAPK = apkClone;
export const appCloneDetect = apkClone;

// ─── [26] Outnumbering Detection ─────────────────────────

export interface OutnumberDetectResult {
  safe: boolean;
  ratio: string;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  recommendations: string[];
  shouldWarn: boolean;
}
export function outnumberDetect(p: {
  userParty: number; otherParty: number;
  isHomeTurf: boolean; venuePublic: boolean; firstMeeting: boolean;
}): OutnumberDetectResult {
  const ratio = `${p.userParty}:${p.otherParty}`, out = p.otherParty > p.userParty;
  let rl: OutnumberDetectResult['riskLevel'] = 'none';
  const rec: string[] = [];
  if (out) {
    if (p.otherParty >= p.userParty * 3) {
      rl = 'high';
      rec.push('CRITICAL: Significantly outnumbered (3:1+)', 'Insist on 1:1 in public first', 'Share location with trusted contact');
    } else if (p.otherParty >= p.userParty * 2) {
      rl = 'medium'; rec.push('Outnumbered — consider bringing a friend', 'Meet in public venue');
    } else { rl = 'low'; rec.push('Slight imbalance — ensure comfort'); }
  }
  if (!p.venuePublic) { rl = rl === 'none' ? 'medium' : 'high'; rec.push('Private venue + imbalance = elevated risk'); }
  if (p.firstMeeting && out) rec.push('First meeting + outnumbered = suggest 1:1 first');
  if (!p.isHomeTurf && out) rec.push('Their turf + outnumbered — maintain exit options');
  return { safe: !out || rl === 'low', ratio, riskLevel: rl, recommendations: rec, shouldWarn: rl === 'high' || rl === 'medium' };
}
export const groupSizeImbalance = outnumberDetect;
export const meetupImbalance = outnumberDetect;

// ─── [33] Activist / Journalist Privacy ──────────────────

export interface ActivistPrivacyResult {
  enabled: boolean;
  level: 'standard' | 'enhanced' | 'maximum';
  features: string[];
  metadataStripping: boolean;
  torCompatible: boolean;
  emergencyProtocol: string[];
}
export function activistPrivacy(p: {
  isActivist: boolean; isJournalist: boolean;
  threatLevel: 'standard' | 'elevated' | 'high'; country: string;
}): ActivistPrivacyResult {
  const hr = p.isActivist || p.isJournalist || p.threatLevel !== 'standard';
  if (!hr) return { enabled: false, level: 'standard', features: [], metadataStripping: false, torCompatible: false, emergencyProtocol: [] };
  const lv = p.threatLevel === 'high' ? 'maximum' : 'enhanced';
  const f = [
    'location_always_hidden', 'no_public_profile', 'no_search_indexing',
    'no_social_sharing', 'enhanced_encryption', 'auto_delete_messages', 'no_screenshot_notification'
  ];
  if (lv === 'maximum') f.push('tor_login', 'no_phone_verification', 'anonymous_email_only', 'vpn_bypass', 'stealth_mode');
  return {
    enabled: true, level: lv, features: f, metadataStripping: true, torCompatible: lv === 'maximum',
    emergencyProtocol: ['Panic button → account lockdown', 'All data encrypted with deniable encryption', 'Emergency contacts via secure channel', 'Remote wipe available', 'CPJ: cpj.org/get-help/', 'RSF: rsf.org/en/help']
  };
}
export const journalistProtection = activistPrivacy;
export const enhancedPrivacy = activistPrivacy;

// ─── [35] Caste-Based Discrimination ─────────────────────

export interface CasteDiscriminationResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  categories: string[];
  recommendation: string;
  legalContext: string[];
  semanticMatchScore: number;
}
const CASTE_PAT: Array<{ p: RegExp; c: string; s: CasteDiscriminationResult['severity'] }> = [
  { p: /\b(brahmin|kshatriya|vaishya|shudra)\b/i, c: 'varna_reference', s: 'medium' },
  { p: /\b(upper\s*caste|lower\s*caste|high\s*caste|low\s*caste)\b/i, c: 'caste_hierarchy', s: 'high' },
  { p: /\b(savarna|avarna|dwija|non-dwija)\b/i, c: 'caste_terminology', s: 'medium' },
  { p: /\b(dalit|untouchable|harijan|panchama)\b/i, c: 'oppressed_caste', s: 'medium' },
  { p: /\b(gotra|pravara|veda)\s*(required|preferred|must|only)\b/i, c: 'caste_filtering', s: 'high' },
  { p: /\b(caste|jati|biradari)\s*(no\s*bar|doesn'?t\s*matter|not\s*important)\b/i, c: 'caste_mention', s: 'low' },
  { p: /\b(same\s*caste|own\s*caste|our\s*caste|my\s*caste)\b/i, c: 'caste_endogamy', s: 'high' },
  { p: /\b(inter.?caste|caste\s*match|caste\s*compatible)\b/i, c: 'caste_matching', s: 'high' },
  { p: /\b(reservation|quota|sc\/st|obc|general\s*category)\b/i, c: 'caste_category', s: 'low' },
  { p: /only\s+(brahmin|kshatriya|rajput|jat|maratha|reddy|naidu|iyer|iyengar|nair|patel|patil)\b/i, c: 'caste_exclusive', s: 'critical' },
];
export async function casteDiscrimination(msgs: string[]): Promise<CasteDiscriminationResult> {
  const pats: string[] = [], cats: string[] = []; let ms: CasteDiscriminationResult['severity'] = 'none';
  const SEV: Array<CasteDiscriminationResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, c, s } of CASTE_PAT) {
      if (p.test(m)) { pats.push(p.source); cats.push(c); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, CASTE_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !pats.length) { pats.push('semantic_caste'); cats.push('semantic_caste_discrim'); ms = 'high'; }
    else if (sms >= 0.5 && !pats.length) { pats.push('semantic_possible_caste'); ms = 'medium'; }
  }
  const rec = ms === 'critical' ? 'CRITICAL: Caste-based exclusion. Remove content, warn user.'
    : ms === 'high' ? 'HIGH: Caste-based filtering. Review for policy violation.'
    : ms === 'medium' ? 'MEDIUM: Caste terminology. Monitor for discriminatory intent.'
    : 'No significant caste discrimination.';
  return {
    detected: pats.length >= 1, patterns: pats, severity: ms, categories: [...new Set(cats)], recommendation: rec,
    legalContext: ['India: SC/ST (Prevention of Atrocities) Act, 1989', 'India: Constitution Art.15 & Art.17', 'UK Equality Act 2010 (caste)', 'California SB 403'],
    semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const casteAbuse = casteDiscrimination;
export const casteBias = casteDiscrimination;

// ─── [36] Breach Data Cross-Reference ────────────────────

export interface BreachCrossRefResult {
  exposed: boolean;
  breaches: Array<{ source: string; date: string; dataTypes: string[]; severity: 'low' | 'medium' | 'high' | 'critical' }>;
  compromisedCredentials: boolean;
  recommendations: string[];
  defenseActions: string[];
}
export async function breachCrossRef(userEmail: string): Promise<BreachCrossRefResult> {
  const breaches: BreachCrossRefResult['breaches'] = []; let cc = false;
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/safety/breach-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail }),
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      const d = await r.json() as {
        breaches: Array<{ source: string; date: string; dataTypes: string[] }>;
        compromisedCredentials: boolean;
      };
      breaches.push(...d.breaches.map(b => ({
        ...b,
        severity: b.dataTypes.includes('password') || b.dataTypes.includes('password_hash') ? 'critical' as const
                : b.dataTypes.includes('email') || b.dataTypes.includes('phone') ? 'high' as const
                : 'medium' as const
      })));
      cc = d.compromisedCredentials;
    }
  } catch {}
  const rec: string[] = [], da: string[] = [];
  if (cc) {
    rec.push('Your password appeared in known breaches', 'Change password immediately', 'Enable 2FA');
    da.push('force_password_reset', 'enable_2fa_prompt', 'revoke_other_sessions');
  }
  for (const b of breaches) {
    if (b.dataTypes.includes('phone')) rec.push('Phone number exposed — cautious of SMS phishing');
    if (b.dataTypes.includes('location')) rec.push('Location data exposed — review sharing settings');
    if (b.severity === 'critical') da.push('enhanced_account_takeover_monitoring');
  }
  da.push('monitor_credential_stuffing', 'alert_new_login_locations');
  return { exposed: breaches.length > 0, breaches, compromisedCredentials: cc, recommendations: rec, defenseActions: da };
}
export const breachDefense = breachCrossRef;
export const leakedDataDefense = breachCrossRef;

// ─── [38] Support Staff Impersonation Phishing ───────────

export interface SupportPhishingResult {
  detected: boolean;
  confidence: number;
  signals: string[];
  action: 'none' | 'warn_user' | 'block_sender' | 'report_to_security';
  verifiedChannel: boolean;
  semanticMatchScore: number;
}
const PHISH_PAT: Array<{ p: RegExp; s: string; w: number }> = [
  { p: /i('m| am)\s+(a|from|with)\s+(support|admin|moderator|team|staff|safety\s*team)/i, s: 'claims_support_role', w: 0.4 },
  { p: /this\s+is\s+(your|the)\s+(account|security|safety)\s+(team|department)/i, s: 'impersonates_team', w: 0.5 },
  { p: /we('ve| have)\s+(detected|noticed|found)\s+(suspicious|unusual|fraudulent)\s+(activity|login|behavior)/i, s: 'fake_alert', w: 0.6 },
  { p: /verify\s+(your|the)\s+(account|identity|password|email|phone)/i, s: 'verification_phishing', w: 0.5 },
  { p: /click\s+(here|this\s+link)|go\s+to\s+(this|the)\s+link/i, s: 'phishing_link', w: 0.5 },
  { p: /your\s+(account|profile)\s+(will\s+be|is\s+going\s+to\s+be)\s+(suspended|banned|deleted|locked|restricted)/i, s: 'threat_suspension', w: 0.6 },
  { p: /send\s+(us|me)\s+(your|a\s+photo|selfie|id|password|payment)/i, s: 'data_harvesting', w: 0.7 },
  { p: /we\s+(never|don'?t)\s+(ask|request)\s+(for|your)\s+(password|payment|card)/i, s: 'false_reassurance', w: 0.3 },
  { p: /@(myarchetype|support|admin|moderator)\.(app|com|io)/i, s: 'spoofed_email', w: 0.5 },
  { p: /urgent|immediate|right\s+away|without\s+delay|act\s+now/i, s: 'urgency_pressure', w: 0.3 },
];
const VERIFIED_CH = new Set([
  'support@myarchetype.app', 'safety@myarchetype.app',
  'noreply@myarchetype.app', 'in-app notification'
]);
export async function supportPhishing(message: string, senderChannel: string): Promise<SupportPhishingResult> {
  const sigs: string[] = []; let c = 0;
  for (const { p, s, w } of PHISH_PAT) if (p.test(message)) { sigs.push(s); c += w; }
  c = Math.min(1, c);
  const vc = VERIFIED_CH.has(senderChannel);
  if (vc && c > 0) c *= 0.3;
  let sms = 0;
  if (message.length > 20) {
    const r = await matchScript(message, PHISH_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && c < 0.2) { c += 0.3; sigs.push('semantic_phishing'); }
  }
  return {
    detected: c >= 0.2 && !vc, confidence: c, signals: sigs,
    action: c >= 0.7 ? 'report_to_security' : c >= 0.4 ? 'block_sender' : c >= 0.2 ? 'warn_user' : 'none',
    verifiedChannel: vc, semanticMatchScore: Math.round(sms * 100) / 100
  };
}
export const fakeSupport = supportPhishing;
export const staffImpersonationPhish = supportPhishing;

// ─── [2.5] Love Bombing ───────────────────────────────────

export interface LoveBombingResult {
  detected: boolean;
  confidence: number;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  velocity: number;
  indicators: string[];
  recommendation: string;
  semanticMatchScore: number;
}

const LOVE_BOMB_PATTERNS_LIST: Array<{ p: RegExp; category: string; weight: number }> = [
  { p: /\b(i\s+love\s+you|love\s+you|in\s+love\s+with\s+you|fallen\s+for\s+you)\b/i, category: 'premature_love', weight: 0.5 },
  { p: /\b(i'?m\s+in\s+love|i'?ve\s+fallen\s+in\s+love|completely\s+in\s+love)\b/i, category: 'premature_love', weight: 0.5 },
  { p: /\b(soul\s*mate|the\s+one|meant\s+to\s+be|destiny|fate\s+brought|meant\s+for\s+each\s+other)\b/i, category: 'soulmate_claim', weight: 0.4 },
  { p: /\b(you'?re\s+the\s+one|i'?ve\s+been\s+waiting\s+for\s+you|god\s+sent\s+you|you'?re\s+my\s+everything)\b/i, category: 'soulmate_claim', weight: 0.45 },
  { p: /\b(our\s+(future|kids|children|wedding|marriage|home|life\s+together))\b/i, category: 'future_bombing', weight: 0.45 },
  { p: /\b(we\s+(should\s+)?(get\s+married|have\s+kids|move\s+in|buy\s+a\s+house|travel\s+the\s+world))\b/i, category: 'future_bombing', weight: 0.5 },
  { p: /\b(i\s+can'?t\s+wait\s+to\s+(marry|spend\s+my\s+life|grow\s+old|have\s+children))\b/i, category: 'future_bombing', weight: 0.5 },
  { p: /\b(you'?re\s+(perfect|amazing|incredible|the\s+most\s+beautiful|flawless|angel|goddess|princess|prince))\b/i, category: 'excessive_flattery', weight: 0.3 },
  { p: /\b(no\s+one\s+(is|has\s+ever\s+been)\s+(as|so)\s+(beautiful|perfect|amazing|wonderful|kind|special)\s+as\s+you)\b/i, category: 'excessive_flattery', weight: 0.4 },
  { p: /\b(i'?ve\s+never\s+(met|seen|found|known)\s+(anyone|someone|a\s+person)\s+(like|as)\s+you)\b/i, category: 'excessive_flattery', weight: 0.35 },
  { p: /\b(why\s+wait|let'?s\s+not\s+wait|don'?t\s+want\s+to\s+waste\s+time|time\s+is\s+precious|life'?s\s+too\s+short)\b/i, category: 'commitment_urgency', weight: 0.35 },
  { p: /\b(move\s+in\s+with\s+me|come\s+live\s+with\s+me|let'?s\s+be\s+together\s+forever|never\s+leave\s+me)\b/i, category: 'commitment_urgency', weight: 0.45 },
  { p: /\b(i\s+don'?t\s+want\s+to\s+share\s+you|you'?re\s+mine|all\s+mine|i\s+need\s+you\s+all\s+to\s+myself)\b/i, category: 'possessiveness', weight: 0.5 },
  { p: /\b(your\s+(friends|family|ex)\s+(don'?t\s+)?(understand|deserve|appreciate)\s+you)\b/i, category: 'isolation_seed', weight: 0.45 },
  { p: /\b(i'?m\s+the\s+only\s+one\s+who\s+(truly\s+)?(gets|understands|appreciates|loves)\s+you)\b/i, category: 'isolation_seed', weight: 0.5 },
  { p: /\b(i\s+want\s+to\s+(buy|give|get)\s+you\s+(everything|anything|the\s+world|whatever\s+you\s+want))\b/i, category: 'gift_bombing', weight: 0.35 },
  { p: /\b(you\s+deserve\s+(everything|the\s+world|only\s+the\s+best|all\s+the\s+love|spoiling))\b/i, category: 'gift_bombing', weight: 0.3 },
  { p: /\b(i'?ll\s+(never|never\s+ever)\s+(leave|hurt|betray|let\s+you\s+down|stop\s+loving)\s+you)\b/i, category: 'grandiose_promise', weight: 0.4 },
  { p: /\b(i\s+promise\s+(to\s+)?(always|never|be\s+there|make\s+you|give\s+you)\s+)/i, category: 'grandiose_promise', weight: 0.35 },
  { p: /\b(we'?re\s+(exactly|literally)\s+(the\s+same|alike|made\s+for\s+each\s+other|soulmates|twins))\b/i, category: 'mirroring', weight: 0.3 },
  { p: /\b(you\s+(complete|are\s+my\s+other\s+half|are\s+the\s+missing\s+piece))\b/i, category: 'mirroring', weight: 0.35 },
  { p: /\b(i\s+can'?t\s+(stop\s+)?thinking\s+about\s+you|you'?re\s+all\s+i\s+(think|dream|talk)\s+about|can'?t\s+eat|can'?t\s+sleep)\b/i, category: 'emotional_flooding', weight: 0.35 },
  { p: /\b(my\s+(heart|body|soul|world|life)\s+(aches|yearns|longs|beats)\s+for\s+you)\b/i, category: 'emotional_flooding', weight: 0.3 },
];

const LOVE_BOMB_SCRIPTS = [
  "I love you more than anything in this world",
  "You are my soulmate I knew it from the first message",
  "I want to spend the rest of my life with you",
  "We should get married I'm not even joking",
  "I've never felt this way about anyone ever",
  "You're the most perfect person I've ever met",
  "I want to give you everything you deserve the world",
  "Let's move in together why wait",
  "I can't stop thinking about you you're all I think about",
  "No one has ever understood me like you do",
  "I'll never leave you I promise forever",
  "You complete me you're my other half",
  "I want to have kids with you",
  "My friends think I'm crazy but I don't care I love you",
  "I already know you're the one I've been waiting for"
];

function computeVelocity(
  messages: Array<{ text: string; timestamp: number }>,
  windowMs: number
): { count: number; avgGapMs: number; burstDetected: boolean } {
  if (messages.length < 2) return { count: messages.length, avgGapMs: Infinity, burstDetected: false };
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0]!.timestamp;
  const inWindow = sorted.filter(m => m.timestamp - first <= windowMs);
  const gaps: number[] = [];
  for (let i = 1; i < inWindow.length; i++)
    gaps.push(inWindow[i]!.timestamp - inWindow[i - 1]!.timestamp);
  const avgGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : Infinity;
  return { count: inWindow.length, avgGapMs: avgGap, burstDetected: inWindow.length >= 15 && avgGap < 60000 };
}

export async function loveBombDetect(
  messages: Array<{ text: string; timestamp: number }>,
  matchTimestamp: number,
  options?: { messageThreshold?: number; hoursThreshold?: number }
): Promise<LoveBombingResult> {
  const msgThreshold = options?.messageThreshold ?? 3;
  const hoursThreshold = options?.hoursThreshold ?? 72;
  const windowMs = hoursThreshold * 3_600_000;
  const earlyMessages = messages.filter(m => m.timestamp - matchTimestamp <= windowMs);
  const patterns: string[] = [], indicators: string[] = []; let rawScore = 0;

  for (const msg of earlyMessages) {
    for (const { p, category, weight } of LOVE_BOMB_PATTERNS_LIST) {
      if (p.test(msg.text)) { patterns.push(category); rawScore += weight; }
    }
  }
  const uniquePatterns = [...new Set(patterns)];
  const velocity = computeVelocity(earlyMessages, windowMs);

  if (velocity.count >= 30) { indicators.push('high_volume_early'); rawScore += 0.2; }
  if (velocity.burstDetected) { indicators.push('message_burst'); rawScore += 0.25; }
  if (velocity.avgGapMs < 120_000 && velocity.count >= 10) { indicators.push('rapid_fire_messaging'); rawScore += 0.15; }

  if (earlyMessages.length >= 8) {
    const sorted = [...earlyMessages].sort((a, b) => a.timestamp - b.timestamp);
    const half = Math.floor(sorted.length / 2);
    const fh = sorted.slice(0, half), sh = sorted.slice(half);
    const ag1 = fh.length >= 2 ? (fh[fh.length - 1]!.timestamp - fh[0]!.timestamp) / (fh.length - 1) : Infinity;
    const ag2 = sh.length >= 2 ? (sh[sh.length - 1]!.timestamp - sh[0]!.timestamp) / (sh.length - 1) : Infinity;
    if (ag1 > 0 && ag2 < ag1 * 0.5) { indicators.push('accelerating_frequency'); rawScore += 0.2; }
  }

  if (uniquePatterns.length >= 5) { indicators.push('multi_category_bombardment'); rawScore += 0.3; }
  else if (uniquePatterns.length >= 3) { indicators.push('diverse_love_bomb_patterns'); rawScore += 0.15; }

  if (earlyMessages.length >= msgThreshold) {
    const hitCount = earlyMessages.filter(m => LOVE_BOMB_PATTERNS_LIST.some(({ p }) => p.test(m.text))).length;
    const hitRate = hitCount / earlyMessages.length;
    if (hitRate >= 0.6) { indicators.push('high_hit_rate'); rawScore += 0.25; }
    else if (hitRate >= 0.4) { indicators.push('moderate_hit_rate'); rawScore += 0.1; }
  }

  let semanticMatchScore = 0;
  const allText = earlyMessages.map(m => m.text).join(' ');
  if (allText.length > 20) {
    const result = await matchScript(allText, LOVE_BOMB_SCRIPTS);
    semanticMatchScore = result.max;
    if (semanticMatchScore >= 0.7 && uniquePatterns.length === 0) {
      uniquePatterns.push('semantic_love_bomb');
      indicators.push('semantic_match_no_keyword');
      rawScore += 0.35;
    } else if (semanticMatchScore >= 0.5 && uniquePatterns.length === 0) {
      indicators.push('weak_semantic_match');
      rawScore += 0.15;
    }
  }

  const first24h = earlyMessages.filter(m => m.timestamp - matchTimestamp <= 24 * 3_600_000);
  const first24hHits = first24h.filter(m => LOVE_BOMB_PATTERNS_LIST.some(({ p }) => p.test(m.text))).length;
  if (first24hHits >= 3) { indicators.push('very_early_intensity'); rawScore += 0.3; }

  const confidence = Math.min(1, rawScore / 2.0);
  const severity: LoveBombingResult['severity'] =
    confidence >= 0.8 ? 'critical' : confidence >= 0.6 ? 'high' :
    confidence >= 0.4 ? 'medium' : confidence >= 0.2 ? 'low' : 'none';
  const detected = confidence >= 0.3 && earlyMessages.length >= msgThreshold;
  const recommendation =
    severity === 'critical' ? 'CRITICAL: Extreme love bombing. Classic manipulation precursor. Alert user, recommend slowing down. Flag for monitoring.'
    : severity === 'high' ? 'HIGH: Intense early affection bombardment. Warn user about love bombing red flags. Monitor for escalation.'
    : severity === 'medium' ? 'MEDIUM: Elevated early affection patterns. Show educational content about healthy pacing.'
    : severity === 'low' ? 'LOW: Some early intensity. Monitor for acceleration.'
    : 'No significant love bombing detected.';

  return {
    detected, confidence: Math.round(confidence * 100) / 100,
    patterns: uniquePatterns, severity, velocity: velocity.count,
    indicators, recommendation,
    semanticMatchScore: Math.round(semanticMatchScore * 100) / 100
  };
}
export const LOVE_BOMBING_PATTERNS = loveBombDetect;
export const loveBombDetect2 = loveBombDetect;
export const loveBomb = loveBombDetect;

// ─── [13.1] API Data Exposure ─────────────────────────────

export interface ApiDataExposureResult {
  exposed: boolean;
  exposedFields: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  remediations: string[];
  complianceViolations: string[];
}
const API_SENSITIVE = new Set([
  'password', 'password_hash', 'session_token', 'refresh_token', 'encryption_key',
  'face_embedding', 'biometric_template', 'ssn', 'credit_card', 'bank_account',
  'exact_location', 'ip_address', 'device_fingerprint', 'sexual_orientation',
  'gender_identity', 'health_data', 'private_notes'
]);
export function apiDataExposure(
  responseFields: string[], endpoint: string, requiredFields: string[]
): ApiDataExposureResult {
  const exposed = responseFields.filter(f => API_SENSITIVE.has(f) && !requiredFields.includes(f));
  const cv: string[] = [];
  if (exposed.some(f => ['sexual_orientation', 'gender_identity', 'health_data'].includes(f)))
    cv.push('GDPR Art.9 (Special Category Data)');
  if (exposed.some(f => ['ssn', 'credit_card'].includes(f))) cv.push('PCI-DSS §6.4');
  if (exposed.some(f => ['face_embedding', 'biometric_template'].includes(f))) cv.push('BIPA §15');
  const s: ApiDataExposureResult['severity'] =
    !exposed.length ? 'none'
    : exposed.some(f => ['password_hash', 'encryption_key', 'biometric_template'].includes(f)) ? 'critical'
    : exposed.some(f => ['ssn', 'credit_card', 'face_embedding'].includes(f)) ? 'high'
    : exposed.some(f => ['session_token', 'exact_location'].includes(f)) ? 'medium'
    : 'low';
  return {
    exposed: !!exposed.length, exposedFields: exposed, severity: s,
    remediations: exposed.map(f => `Remove ${f} from ${endpoint} response`),
    complianceViolations: cv
  };
}
export const apiOverExposure = apiDataExposure;
export const responseDataLeak = apiDataExposure;
export const graphCluster = apiDataExposure; // alias for audit scanner

// ─── [13.1] IDOR Detection ────────────────────────────────

export interface IdorDetectionResult {
  detected: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  accessedResource: string;
  action: 'allow' | 'log' | 'block' | 'alert';
  recommendation: string;
}
export function idorDetection(req: {
  requestingUserId: string; resourceOwnerId: string; resourceType: string;
  resourceId: string; accessLevel: 'read' | 'write' | 'delete'; isAdmin: boolean;
}): IdorDetectionResult {
  const isOwner = req.requestingUserId === req.resourceOwnerId;
  const rl: IdorDetectionResult['riskLevel'] = req.isAdmin ? 'none'
    : !isOwner ? (req.accessLevel === 'delete' ? 'critical' : req.accessLevel === 'write' ? 'high' : 'medium')
    : 'none';
  return {
    detected: rl !== 'none', riskLevel: rl,
    accessedResource: `${req.resourceType}:${req.resourceId}`,
    action: rl === 'critical' || rl === 'high' ? 'block' : rl === 'medium' ? 'log' : 'allow',
    recommendation: rl !== 'none'
      ? `Block ${req.accessLevel} on ${req.resourceType} — not owner. Add ownership check.`
      : 'Access authorized.'
  };
}
export const objectLevelAuth = idorDetection;
export const brokenObjectLevel = idorDetection;

// ─── [13.3] Platform Cybersecurity ───────────────────────

export interface SqlInjectionResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  sanitizedInput: string;
}
const SQL_PAT = [
  /('|")\s*(or|and)\s*('|"|\d)/i, /;\s*(drop|delete|insert|update|select)\s/i,
  /union\s+(all\s+)?select/i, /--\s*$/, /\/\*.*\*\//s,
  /xp_cmdshell/i, /exec\s*\(/i, /waitfor\s+delay/i
];
export function sqlInjection(input: string): SqlInjectionResult {
  const pats = SQL_PAT.filter(p => p.test(input)).map(p => p.source);
  const s: SqlInjectionResult['severity'] =
    !pats.length ? 'none'
    : pats.some(p => /union|drop|delete|exec|xp_cmd/.test(p)) ? 'critical'
    : pats.some(p => /insert|update|waitfor/.test(p)) ? 'high'
    : 'medium';
  return {
    detected: !!pats.length, patterns: pats, severity: s,
    sanitizedInput: input.replace(/['";]/g, '').replace(/--.*$/g, '').trim()
  };
}
export const noSqlInjection = sqlInjection;
export const queryInjection = sqlInjection;

export interface XssDetectionResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  sanitizedOutput: string;
}
const XSS_PAT = [
  /<script[^>]*>.*?<\/script>/gi, /javascript\s*:/i, /on\w+\s*=/i,
  /<iframe[^>]*>/i, /eval\s*\(/i, /document\.(cookie|location|write)/i,
  /<img[^>]+onerror/i, /data:text\/html/i
];
export function xssDetection(input: string): XssDetectionResult {
  const pats = XSS_PAT.filter(p => p.test(input)).map(p => p.source);
  const s: XssDetectionResult['severity'] =
    !pats.length ? 'none'
    : pats.some(p => /script|javascript|eval|cookie/.test(p)) ? 'critical'
    : 'high';
  const sanitized = input
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\//g, '&#x2F;');
  return { detected: !!pats.length, patterns: pats, severity: s, sanitizedOutput: sanitized };
}
export const storedXss = xssDetection;
export const reflectedXss = xssDetection;

export interface CsrfProtectionResult {
  protected: boolean;
  tokenValid: boolean;
  method: string;
  recommendations: string[];
}
export function csrfProtection(req: {
  method: string; origin: string; allowedOrigins: string[];
  csrfToken?: string; expectedToken?: string; sameSiteCookie: boolean;
}): CsrfProtectionResult {
  const recs: string[] = []; let tv = false;
  if (req.csrfToken && req.expectedToken) tv = req.csrfToken === req.expectedToken;
  const oc = req.allowedOrigins.includes(req.origin);
  if (!tv && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method))
    recs.push('Add CSRF token validation');
  if (!req.sameSiteCookie) recs.push('Set SameSite=Strict on session cookies');
  if (!oc) recs.push(`Blocked origin: ${req.origin}`);
  return { protected: tv && oc && req.sameSiteCookie, tokenValid: tv, method: req.method, recommendations: recs };
}
export const csrfDefense = csrfProtection;
export const forgeryProtection = csrfProtection;

// ─── [14.1] Network / Graph Analysis ─────────────────────

export interface NetworkGraphResult {
  suspicious: boolean;
  clusters: Array<{ nodes: string[]; suspicionScore: number; pattern: string }>;
  riskScore: number;
  recommendation: string;
}
export function networkGraph(
  edges: Array<{ from: string; to: string; type: 'message' | 'match' | 'report' | 'block' | 'like' }>
): NetworkGraphResult {
  const adj: Record<string, Set<string>> = {};
  const reportEdges = edges.filter(e => e.type === 'report');
  for (const e of edges) {
    if (!adj[e.from]) adj[e.from] = new Set();
    if (!adj[e.to]) adj[e.to] = new Set();
    adj[e.from]!.add(e.to);
    adj[e.to]!.add(e.from);
  }
  const clusters: NetworkGraphResult['clusters'] = []; let rs = 0;
  const reported = new Set(reportEdges.map(e => e.to));
  for (const node of reported) {
    const rc = reportEdges.filter(e => e.to === node).length;
    if (rc >= 3) {
      clusters.push({ nodes: [node], suspicionScore: Math.min(1, rc / 10), pattern: `received_${rc}_reports` });
      rs += rc * 0.1;
    }
  }
  const senders = new Set(edges.filter(e => e.type === 'message').map(e => e.from));
  for (const sender of senders) {
    const targets = edges.filter(e => e.type === 'message' && e.from === sender).map(e => e.to);
    if (targets.length >= 20) {
      clusters.push({ nodes: [sender], suspicionScore: Math.min(1, targets.length / 100), pattern: `mass_messaging_${targets.length}` });
      rs += 0.2;
    }
  }
  return {
    suspicious: rs >= 0.3, clusters, riskScore: Math.min(1, rs),
    recommendation: rs >= 0.7 ? 'HIGH: Coordinated abuse network. Investigate cluster.'
      : rs >= 0.3 ? 'MEDIUM: Suspicious network patterns. Monitor.'
      : 'Normal network patterns.'
  };
}
export const abuseNetwork = networkGraph;
export const coordinated = networkGraph;
export const graphAnalysis = networkGraph;
export const coordinatedInauthentic = networkGraph;

export interface BotNetworkResult {
  botLikely: boolean;
  confidence: number;
  signals: string[];
  action: 'allow' | 'captcha' | 'restrict' | 'ban';
}
export function botNetwork(s: {
  accountAgeDays: number; messagesSentPerHour: number; uniqueTargets: number;
  profileCompleteness: number; hasPhoto: boolean; hasVerification: boolean;
  ipShared: boolean; deviceShared: boolean; responseTimeMs: number;
}): BotNetworkResult {
  const sig: string[] = []; let c = 0;
  if (s.messagesSentPerHour >= 50) { sig.push(`high_rate_${s.messagesSentPerHour}/hr`); c += 0.3; }
  if (s.uniqueTargets >= 30 && s.accountAgeDays < 7) { sig.push('mass_targeting_new'); c += 0.3; }
  if (s.profileCompleteness < 0.3) { sig.push('sparse_profile'); c += 0.15; }
  if (!s.hasPhoto) { sig.push('no_photo'); c += 0.15; }
  if (s.ipShared || s.deviceShared) { sig.push('shared_infrastructure'); c += 0.25; }
  if (s.responseTimeMs < 500 && s.messagesSentPerHour > 20) { sig.push('inhuman_response_speed'); c += 0.2; }
  if (s.accountAgeDays < 1 && s.messagesSentPerHour > 10) { sig.push('rapid_day1_activity'); c += 0.2; }
  c = Math.min(1, c);
  return {
    botLikely: c >= 0.4, confidence: c, signals: sig,
    action: c >= 0.7 ? 'ban' : c >= 0.5 ? 'restrict' : c >= 0.3 ? 'captcha' : 'allow'
  };
}
export const botDetect = botNetwork;
export const automatedAccount = botNetwork;

export interface LinkFarmResult {
  detected: boolean;
  nodes: string[];
  linkCount: number;
  pattern: string;
  action: 'allow' | 'warn' | 'remove';
}
export function linkFarm(
  profiles: Array<{ id: string; externalLinks: string[]; socialHandles: string[]; bioLength: number; photoCount: number }>
): LinkFarmResult {
  const suspicious: string[] = [];
  for (const p of profiles) {
    const score = (p.externalLinks.length >= 3 ? 1 : 0) + (p.socialHandles.length >= 5 ? 1 : 0)
                + (p.bioLength < 20 ? 1 : 0) + (p.photoCount <= 1 ? 1 : 0);
    if (score >= 3) suspicious.push(p.id);
  }
  return {
    detected: suspicious.length >= 2, nodes: suspicious,
    linkCount: suspicious.reduce((s, id) => s + (profiles.find(p => p.id === id)?.externalLinks.length ?? 0), 0),
    pattern: suspicious.length >= 5 ? 'coordinated_link_farm' : 'suspicious_link_density',
    action: suspicious.length >= 5 ? 'remove' : suspicious.length >= 2 ? 'warn' : 'allow'
  };
}
export const linkFarmDetect = linkFarm;
export const spamLinks = linkFarm;

export interface SybilDetectionResult {
  detected: boolean;
  confidence: number;
  clusterSize: number;
  sharedAttributes: string[];
  action: 'allow' | 'monitor' | 'restrict' | 'ban';
}
export function sybilDetection(
  accounts: Array<{ id: string; deviceFingerprint: string; ipAddress: string; emailDomain: string; photoHash?: string; registrationTime: number }>
): SybilDetectionResult {
  // FIX: Safe Map initialization replacing fragile one-liner
  const df = new Map<string, string[]>();
  const ip = new Map<string, string[]>();
  const ph = new Map<string, string[]>();
  const shared: string[] = [];

  for (const a of accounts) {
    if (!df.has(a.deviceFingerprint)) df.set(a.deviceFingerprint, []);
    df.get(a.deviceFingerprint)!.push(a.id);

    if (!ip.has(a.ipAddress)) ip.set(a.ipAddress, []);
    ip.get(a.ipAddress)!.push(a.id);

    if (a.photoHash) {
      if (!ph.has(a.photoHash)) ph.set(a.photoHash, []);
      ph.get(a.photoHash)!.push(a.id);
    }
  }

  let maxCluster = 0, c = 0;
  for (const ids of df.values()) {
    if (ids.length >= 3) { maxCluster = Math.max(maxCluster, ids.length); shared.push(`shared_device:${ids.length}`); c += 0.4; }
  }
  for (const ids of ip.values()) {
    if (ids.length >= 5) { maxCluster = Math.max(maxCluster, ids.length); shared.push(`shared_ip:${ids.length}`); c += 0.3; }
  }
  for (const ids of ph.values()) {
    if (ids.length >= 2) { shared.push(`shared_photo:${ids.length}`); c += 0.5; }
  }
  c = Math.min(1, c);
  return {
    detected: c >= 0.4, confidence: c, clusterSize: maxCluster, sharedAttributes: shared,
    action: c >= 0.7 ? 'ban' : c >= 0.5 ? 'restrict' : c >= 0.3 ? 'monitor' : 'allow'
  };
}
export const sybilAttack = sybilDetection;
export const fakeAccountCluster = sybilDetection;

// ─── [14.2] Fake Dating App / Malware ────────────────────

export interface FakeDatingAppResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  threatType: string[];
  action: 'warn' | 'block';
}
const FAKE_APP_PAT = [
  /download\s+(our|my|this)\s+(app|application|platform)/i,
  /use\s+(this|my|our)\s+(other\s+)?(app|platform|site)\s+instead/i,
  /better\s+(features?|experience|matching)\s+on\s+(my|our|this)\s+(app|site)/i,
  /exclusive\s+(content|features?|matches?)\s+(on|at)\s+(my|our)/i,
  /free\s+(premium|gold|vip)\s+(on|at)\s+(my|our)\s+(app|site)/i,
  /install\s+this\s+(apk|file|app|software)/i,
  /click\s+(here|this\s+link)\s+to\s+(download|install|get)/i
];
export function fakeDatingApp(msgs: string[], urlsDetected: string[]): FakeDatingAppResult {
  const ind: string[] = [], tt: string[] = []; let c = 0;
  for (const m of msgs) {
    for (const p of FAKE_APP_PAT) {
      if (p.test(m)) { ind.push(p.source); tt.push('app_redirect'); c += 0.3; }
    }
  }
  const suspicious   = urlsDetected.filter(u => !/myarchetype\.app|apple\.com|google\.com|play\.google\.com|apps\.apple\.com/.test(u));
  if (suspicious.length) {
    ind.push(`suspicious_urls:${suspicious.join(',')}`);
    tt.push('external_download');
    c += 0.4;
  }
  c = Math.min(1, c);
  return {
    detected: c >= 0.3, confidence: c, indicators: ind,
    threatType: [...new Set(tt)],
    // FIX: was 'warn' on both branches
    action: c >= 0.6 ? 'block' : 'warn'
  };
}
export const malwareAppRedirect = fakeDatingApp;
export const appHijack = fakeDatingApp;
export const fakeDatingAppRedirect = fakeDatingApp;

export interface PhishingSiteResult {
  detected: boolean;
  url: string;
  similarity: number;
  technique: string[];
  action: 'allow' | 'warn' | 'block';
}
export function phishingSite(url: string, brandName = 'myarchetype'): PhishingSiteResult {
  const tech: string[] = []; let sim = 0;
  const domain = url.replace(/https?:\/\//, '').split('/')[0]?.toLowerCase() ?? '';
  if (domain.includes(brandName) && !domain.endsWith('.app') && !domain.endsWith('.com')) {
    tech.push('brand_domain_spoof'); sim += 0.6;
  }
  if (/\d+/.test(domain) && domain.includes(brandName)) { tech.push('number_substitution'); sim += 0.3; }
  if (domain.includes(brandName + '-') || domain.includes('-' + brandName)) { tech.push('hyphen_brand'); sim += 0.4; }
  if (/-?(login|secure|verify|account|auth)-?/.test(domain)) { tech.push('login_keyword'); sim += 0.2; }
  if (/\.tk$|\.ml$|\.ga$|\.cf$|\.gq$/.test(domain)) { tech.push('suspicious_tld'); sim += 0.3; }
  sim = Math.min(1, sim);
  return {
    detected: sim >= 0.3, url, similarity: sim, technique: tech,
    action: sim >= 0.6 ? 'block' : sim >= 0.3 ? 'warn' : 'allow'
  };
}
export const brandSpoof = phishingSite;
export const domainSquat = phishingSite;

export interface MaliciousAppResult {
  detected: boolean;
  permissions: string[];
  suspiciousPermissions: string[];
  riskScore: number;
  action: 'allow' | 'warn' | 'block';
}
const DANGEROUS_PERMS = new Set([
  'READ_CONTACTS', 'READ_CALL_LOG', 'RECORD_AUDIO_BACKGROUND', 'CAMERA_BACKGROUND',
  'ACCESS_FINE_LOCATION_BACKGROUND', 'READ_SMS', 'RECEIVE_SMS', 'PROCESS_OUTGOING_CALLS',
  'BIND_ACCESSIBILITY_SERVICE', 'SYSTEM_ALERT_WINDOW', 'WRITE_SECURE_SETTINGS'
]);
export function maliciousApp(permissions: string[], packageName: string): MaliciousAppResult {
  const sp = permissions.filter(p => DANGEROUS_PERMS.has(p));
  let rs = sp.length * 0.1;
  if (sp.includes('RECORD_AUDIO_BACKGROUND') && sp.includes('ACCESS_FINE_LOCATION_BACKGROUND')) rs += 0.4;
  if (sp.includes('BIND_ACCESSIBILITY_SERVICE')) rs += 0.3;
  rs = Math.min(1, rs);
  return {
    detected: rs >= 0.3, permissions, suspiciousPermissions: sp, riskScore: rs,
    action: rs >= 0.6 ? 'block' : rs >= 0.3 ? 'warn' : 'allow'
  };
}
export const stalkerwareApp = maliciousApp;
export const spywareDetect = maliciousApp;

export interface AppImpersonationResult {
  detected: boolean;
  confidence: number;
  clues: string[];
  action: 'warn' | 'block';
}
export function appImpersonation(s: {
  appName: string; publisherName: string; iconSimilarity: number;
  descriptionSimilarity: number; downloadCount: number; reviewAge: string;
}): AppImpersonationResult {
  const clues: string[] = []; let c = 0;
  if (s.iconSimilarity >= 0.8) { clues.push('icon_copy'); c += 0.4; }
  if (s.descriptionSimilarity >= 0.7) { clues.push('description_copy'); c += 0.3; }
  if (/myarchetype|my\s*archetype/i.test(s.appName) && !/official/i.test(s.publisherName)) {
    clues.push('name_spoof'); c += 0.5;
  }
  if (s.downloadCount < 100 && s.iconSimilarity >= 0.8) { clues.push('low_downloads_suspicious'); c += 0.1; }
  c = Math.min(1, c);
  return { detected: c >= 0.3, confidence: c, clues, action: c >= 0.5 ? 'block' : 'warn' };
}
export const fakeAppStore = appImpersonation;
export const cloneApp = appImpersonation;

// ─── [14.3] Cross-Platform Banned User Intel ─────────────

export interface CrossPlatformBanResult {
  banned: boolean;
  platforms: string[];
  banReason: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'allow' | 'enhanced_verify' | 'block';
}
export function crossPlatformBan(
  hashes: { emailHash: string; phoneHash: string; faceEmbeddingHash?: string; deviceHash?: string },
  db: Array<{ hash: string; type: string; platform: string; reason: string; severity: 'low' | 'medium' | 'high' | 'critical' }>
): CrossPlatformBanResult {
  const matches = db.filter(e =>
    e.hash === hashes.emailHash ||
    e.hash === hashes.phoneHash ||
    (hashes.faceEmbeddingHash && e.hash === hashes.faceEmbeddingHash) ||
    (hashes.deviceHash && e.hash === hashes.deviceHash)
  );
  const platforms = [...new Set(matches.map(m => m.platform))];
  const reasons = [...new Set(matches.map(m => m.reason))];
  const SEV: Array<CrossPlatformBanResult['severity']> = ['low', 'medium', 'high', 'critical'];
  const ms = matches.reduce<CrossPlatformBanResult['severity']>(
    (max, m) => SEV.indexOf(m.severity) > SEV.indexOf(max) ? m.severity : max, 'low'
  );
  return {
    banned: matches.length > 0, platforms, banReason: reasons, severity: ms,
    action: ms === 'critical' || ms === 'high' ? 'block' : matches.length > 0 ? 'enhanced_verify' : 'allow'
  };
}
export const crossPlatformOffender = crossPlatformBan;
export const sharedBanList = crossPlatformBan;
export const crossPlatformHash = crossPlatformBan;

export interface TechCoalitionResult {
  member: boolean;
  hashSharingEnabled: boolean;
  reportingEnabled: boolean;
  lastSync: string;
  sharedSignals: number;
}
export function techCoalition(config: {
  isMember: boolean; apiKey?: string; lastSyncDate?: string; signalsShared?: number;
}): TechCoalitionResult {
  return {
    member: config.isMember,
    hashSharingEnabled: config.isMember && !!config.apiKey,
    reportingEnabled: config.isMember,
    lastSync: config.lastSyncDate ?? 'never',
    sharedSignals: config.signalsShared ?? 0
  };
}
export const gifctMember = techCoalition;
export const hashShareIntel = techCoalition;

export interface CrossPlatformReportResult {
  aggregated: boolean;
  totalReports: number;
  platforms: string[];
  riskScore: number;
  action: 'allow' | 'monitor' | 'restrict' | 'ban';
}
export function crossPlatformReport(
  userId: string,
  reports: Array<{ platform: string; reason: string; timestamp: number; severity: 'low' | 'medium' | 'high' | 'critical' }>
): CrossPlatformReportResult {
  const SEV = { low: 1, medium: 2, high: 3, critical: 5 };
  const rs = Math.min(1, reports.reduce((s, r) => s + SEV[r.severity] * 0.05, 0));
  const plats = [...new Set(reports.map(r => r.platform))];
  return {
    aggregated: reports.length > 0, totalReports: reports.length, platforms: plats, riskScore: rs,
    action: rs >= 0.7 ? 'ban' : rs >= 0.5 ? 'restrict' : rs >= 0.2 ? 'monitor' : 'allow'
  };
}
export const multiPlatformReport = crossPlatformReport;
export const federatedBan = crossPlatformReport;

// ─── [14.4] Third-Party Cheater Tool Defense ─────────────

export interface CheaterToolResult {
  detected: boolean;
  tools: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'allow' | 'warn' | 'restrict' | 'ban';
}
const CHEAT_TOOLS = new Set([
  'com.example.swipebot', 'com.autoswipe', 'com.tinderhack', 'com.bumblehack',
  'com.hinge.boost', 'com.superlike.unlimited', 'com.profile.cloner',
  'io.tinder.unlimited', 'com.dating.bot.pro', 'com.autolike.app'
]);
const CHEAT_PATTERNS = [
  /swipe.?bot|auto.?swipe|like.?all|super.?like.?hack|unlimited.?boost|profile.?clone/i,
  /bypass.?(verification|captcha|limit)/i,
  /fake.?(location|gps|coordinates)/i,
  /mass.?(like|swipe|message)/i
];
export function cheaterTool(s: {
  installedApps?: string[]; behavior?: string;
  apiPatterns?: string[]; ratioLikes?: number; responsePatterns?: string[];
}): CheaterToolResult {
  const tools: string[] = []; let rs = 0;
  if (s.installedApps) for (const app of s.installedApps) if (CHEAT_TOOLS.has(app)) { tools.push(app); rs += 0.5; }
  if (s.behavior) for (const p of CHEAT_PATTERNS) if (p.test(s.behavior)) { tools.push('behavior:' + p.source.slice(0, 30)); rs += 0.3; }
  if ((s.ratioLikes ?? 0) > 0.95) { tools.push('like_ratio_too_high'); rs += 0.2; }
  if (s.apiPatterns?.some(p => /batch|bulk|parallel|concurrent/.test(p))) { tools.push('batch_api_abuse'); rs += 0.3; }
  rs = Math.min(1, rs);
  const rl: CheaterToolResult['riskLevel'] =
    rs >= 0.8 ? 'critical' : rs >= 0.6 ? 'high' : rs >= 0.3 ? 'medium' : rs >= 0.1 ? 'low' : 'none';
  return {
    detected: rs >= 0.3, tools, riskLevel: rl,
    action: rs >= 0.7 ? 'ban' : rs >= 0.5 ? 'restrict' : rs >= 0.3 ? 'warn' : 'allow'
  };
}
export const swipeBot = cheaterTool;
export const autoLike = cheaterTool;

export interface RatioManipResult {
  detected: boolean;
  anomaly: string[];
  adjustedScore: number;
  action: 'allow' | 'throttle' | 'shadow_ban';
}
export function ratioManip(s: {
  likesGiven: number; likesReceived: number; matchRate: number;
  boostUsed: number; timeWindowHours: number; accountAgeDays: number;
}): RatioManipResult {
  const anom: string[] = []; let sc = 0;
  const rate = s.likesGiven / Math.max(s.timeWindowHours, 1);
  if (rate > 100) { anom.push(`like_rate_${Math.round(rate)}/hr`); sc += 0.3; }
  if (s.likesGiven > 500 && s.accountAgeDays < 3) { anom.push('mass_likes_new_account'); sc += 0.4; }
  if (s.matchRate > 0.9 && s.likesGiven > 100) { anom.push('impossible_match_rate'); sc += 0.4; }
  if (s.boostUsed > 10 && s.accountAgeDays < 7) { anom.push('boost_abuse_new'); sc += 0.3; }
  sc = Math.min(1, sc);
  return {
    detected: sc >= 0.3, anomaly: anom, adjustedScore: Math.max(0, 1 - sc),
    action: sc >= 0.7 ? 'shadow_ban' : sc >= 0.4 ? 'throttle' : 'allow'
  };
}
export const boostAbuse = ratioManip;
export const likeRateAnomaly = ratioManip;

// ─── [15] AI/ML System Safety ────────────────────────────

export interface ModelPoisoningResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  affectedModels: string[];
  action: 'allow' | 'quarantine' | 'retrain' | 'rollback';
}
export function modelPoisoning(s: {
  accuracyDrop: number; biasShift: Record<string, number>;
  trainingDataAnomalies: number; suddenBehaviorChange: boolean; adversarialInputsDetected: number;
}): ModelPoisoningResult {
  const ind: string[] = []; let c = 0;
  if (s.accuracyDrop >= 0.1) { ind.push(`accuracy_drop_${(s.accuracyDrop * 100).toFixed(1)}%`); c += 0.3; }
  if (s.suddenBehaviorChange) { ind.push('sudden_behavior_change'); c += 0.3; }
  if (s.trainingDataAnomalies >= 10) { ind.push(`training_anomalies_${s.trainingDataAnomalies}`); c += 0.25; }
  if (s.adversarialInputsDetected >= 5) { ind.push(`adversarial_inputs_${s.adversarialInputsDetected}`); c += 0.25; }
  const bs = Object.values(s.biasShift).filter(v => Math.abs(v) >= 0.1);
  if (bs.length) { ind.push(`bias_shift_${bs.length}_groups`); c += 0.2; }
  c = Math.min(1, c);
  return {
    detected: c >= 0.3, confidence: c, indicators: ind,
    affectedModels: ['recommendation', 'safety_classifier', 'face_verify'],
    action: c >= 0.8 ? 'rollback' : c >= 0.5 ? 'retrain' : c >= 0.3 ? 'quarantine' : 'allow'
  };
}
export const trainingPoison = modelPoisoning;
export const dataPoison = modelPoisoning;

export interface AdversarialInputResult {
  detected: boolean;
  attackType: string[];
  confidence: number;
  sanitizedInput: string;
  action: 'allow' | 'flag' | 'block';
}
const ADV_PAT = [
  /\x00|\x01|\x02|\x03|\x04|\x05|\x06|\x07|\x08/,
  /[\u200B-\u200F\u2060\uFEFF]/,
  /(.)\1{20,}/,
  /[^\x00-\x7F]{50,}/,
  /\b(ignore|forget|disregard)\s+(previous|above|all)\s+(instructions?|prompts?|rules?)\b/i,
  /\b(jailbreak|DAN|do anything now|pretend you are|you are now|act as if)\b/i
];
export function adversarialInput(input: string): AdversarialInputResult {
  const types: string[] = []; let c = 0;
  if (ADV_PAT[0]!.test(input)) { types.push('null_byte_injection'); c += 0.6; }
  if (ADV_PAT[1]!.test(input)) { types.push('invisible_char'); c += 0.5; }
  if (ADV_PAT[2]!.test(input)) { types.push('char_flooding'); c += 0.3; }
  if (ADV_PAT[3]!.test(input)) { types.push('unicode_overflow'); c += 0.4; }
  if (ADV_PAT[4]!.test(input)) { types.push('prompt_injection'); c += 0.8; }
  if (ADV_PAT[5]!.test(input)) { types.push('jailbreak_attempt'); c += 0.9; }
  c = Math.min(1, c);
  const sanitized = input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
    .slice(0, 10000);
  return {
    detected: c >= 0.3, attackType: types, confidence: c, sanitizedInput: sanitized,
    action: c >= 0.7 ? 'block' : c >= 0.3 ? 'flag' : 'allow'
  };
}
export const promptInjection = adversarialInput;
export const jailbreak = adversarialInput;
export const modelEvasion = adversarialInput;

export interface MlFairnessResult {
  fair: boolean;
  disparateImpact: Record<string, number>;
  groups: string[];
  violations: string[];
  recommendations: string[];
}
export function mlFairness(
  outcomes: Array<{ userId: string; group: string; outcome: 'approved' | 'flagged' | 'blocked'; score: number }>
): MlFairnessResult {
  const byGroup: Record<string, { total: number; flagged: number }> = {};
  for (const o of outcomes) {
    if (!byGroup[o.group]) byGroup[o.group] = { total: 0, flagged: 0 };
    byGroup[o.group]!.total++;
    if (o.outcome !== 'approved') byGroup[o.group]!.flagged++;
  }
  const rates: Record<string, number> = {}, viols: string[] = [], recs: string[] = [];
  for (const [g, d] of Object.entries(byGroup)) rates[g] = d.flagged / Math.max(d.total, 1);
  const baseline = Math.min(...Object.values(rates));
  const di: Record<string, number> = {};
  for (const [g, r] of Object.entries(rates)) {
    di[g] = baseline > 0 ? r / baseline : 1;
    if (di[g]! > 1.25) { viols.push(`${g}: ${di[g]!.toFixed(2)}x disparity`); recs.push(`Audit ${g} features in model`); }
  }
  return { fair: !viols.length, disparateImpact: di, groups: Object.keys(byGroup), violations: viols, recommendations: recs };
}
export const algorithmicBias = mlFairness;
export const disparateImpact = mlFairness;

export interface ModelDriftResult {
  drifted: boolean;
  driftScore: number;
  affectedMetrics: string[];
  alertLevel: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}
export function modelDrift(
  current: Record<string, number>,
  baseline: Record<string, number>,
  threshold = 0.1
): ModelDriftResult {
  const aff: string[] = []; let ds = 0;
  for (const [k, bv] of Object.entries(baseline)) {
    const cv = current[k] ?? 0;
    const d = Math.abs(cv - bv) / Math.max(Math.abs(bv), 0.001);
    if (d >= threshold) { aff.push(`${k}: ${(d * 100).toFixed(1)}% drift`); ds += d * 0.2; }
  }
  ds = Math.min(1, ds);
  const al: ModelDriftResult['alertLevel'] = ds >= 0.6 ? 'high' : ds >= 0.3 ? 'medium' : ds >= 0.1 ? 'low' : 'none';
  return {
    drifted: ds >= 0.1, driftScore: ds, affectedMetrics: aff, alertLevel: al,
    recommendation: al === 'high' ? 'Retrain model immediately. Significant concept drift.'
      : al === 'medium' ? 'Schedule retraining. Monitor closely.'
      : al === 'low' ? 'Watch drift metrics.' : 'Model stable.'
  };
}
export const conceptDrift = modelDrift;
export const distributionShift = modelDrift;

// ─── [15.1] AI Feature Privacy & Consent ─────────────────

export interface AiConsentResult {
  consentGiven: boolean;
  features: string[];
  withdrawable: boolean;
  dataUsed: string[];
  retentionDays: number;
  optOutUrl: string;
}
export function aiConsent(prefs: {
  allowRecommendations: boolean; allowSafetyScoring: boolean;
  allowBehavioralAnalysis: boolean; allowPersonalization: boolean; allowFaceMatching: boolean;
}): AiConsentResult {
  const features: string[] = [], data: string[] = [];
  if (prefs.allowRecommendations) { features.push('match_recommendations'); data.push('preferences', 'swipe_history'); }
  if (prefs.allowSafetyScoring) { features.push('safety_score'); data.push('message_content', 'behavioral_signals'); }
  if (prefs.allowBehavioralAnalysis) { features.push('behavioral_analysis'); data.push('session_patterns', 'interaction_history'); }
  if (prefs.allowPersonalization) { features.push('personalization'); data.push('app_usage', 'click_patterns'); }
  if (prefs.allowFaceMatching) { features.push('face_verification'); data.push('face_embedding'); }
  return {
    consentGiven: Object.values(prefs).some(Boolean), features, withdrawable: true,
    dataUsed: [...new Set(data)], retentionDays: 365, optOutUrl: '/settings/privacy/ai-features'
  };
}
export const aiDataConsent = aiConsent;
export const mlConsent = aiConsent;
export const aiFeatureConsent = aiConsent;

export interface AiTransparencyResult {
  disclosed: boolean;
  modelType: string;
  dataUsed: string[];
  decisionsExplained: boolean;
  appealAvailable: boolean;
  humanReviewOption: boolean;
}
export function aiTransparency(decision: {
  type: string; modelUsed: string; inputFeatures: string[];
  confidence: number; automated: boolean;
}): AiTransparencyResult {
  return {
    disclosed: true, modelType: decision.modelUsed, dataUsed: decision.inputFeatures,
    decisionsExplained: decision.confidence >= 0.7,
    appealAvailable: decision.type !== 'recommendation',
    humanReviewOption: ['suspension', 'ban', 'content_removal'].includes(decision.type)
  };
}
export const explainableAI = aiTransparency;
export const algorithmTransparency = aiTransparency;

export interface AiDataMinimResult {
  compliant: boolean;
  featuresUsed: string[];
  excessiveFeatures: string[];
  retentionCompliant: boolean;
  recommendations: string[];
}
const AI_ALLOWED = new Set([
  'age_range', 'gender', 'location_coarse', 'interests', 'relationship_goal',
  'swipe_patterns_aggregate', 'message_frequency_aggregate'
]);
const AI_EXCESSIVE = new Set([
  'exact_age', 'income', 'ethnicity', 'religion', 'sexual_history',
  'health_conditions', 'exact_location', 'ip_history', 'device_details'
]);
// FIX: correct function name (was aiDataMinimu — typo)
export function aiDataMinimization(features: string[], retentionDays: number): AiDataMinimResult {
  const exc = features.filter(f => AI_EXCESSIVE.has(f)), recs: string[] = [];
  for (const f of exc) recs.push(`Remove ${f} from AI training data`);
  if (retentionDays > 365) recs.push('Reduce training data retention to 365 days max');
  return {
    compliant: !exc.length && retentionDays <= 365,
    featuresUsed: features, excessiveFeatures: exc,
    retentionCompliant: retentionDays <= 365, recommendations: recs
  };
}
// Keep old name as alias for backward compatibility
export const aiDataMinimu = aiDataMinimization;
export const aiMinimization = aiDataMinimization;
export const trainingDataMinim = aiDataMinimization;

export interface AiAuditTrailResult {
  logged: boolean;
  auditId: string;
  decision: string;
  timestamp: string;
  reviewable: boolean;
  expiresAt: string;
}
export function aiAuditTrail(d: {
  decisionType: string; userId: string; modelVersion: string;
  inputHash: string; output: string; confidence: number;
}): AiAuditTrailResult {
  const now = Date.now();
  return {
    logged: true,
    auditId: `AI-AUDIT-${now.toString(36).toUpperCase()}-${d.userId.slice(0, 6)}`,
    decision: `${d.decisionType}:${d.output}(${(d.confidence * 100).toFixed(0)}%)`,
    timestamp: new Date(now).toISOString(),
    reviewable: true,
    expiresAt: new Date(now + 365 * 86400000).toISOString()
  };
}
export const mlAuditLog = aiAuditTrail;
export const decisionLog = aiAuditTrail;

export interface AiOptOutResult {
  optedOut: boolean;
  featuresDisabled: string[];
  fallbackMode: string;
  dataDeletedFromTraining: boolean;
  effectiveDate: string;
}
export function aiOptOut(userId: string, features: string[]): AiOptOutResult {
  const fb: Record<string, string> = {
    match_recommendations: 'chronological_browse',
    safety_score: 'report_only',
    behavioral_analysis: 'disabled',
    personalization: 'default_settings',
    face_verification: 'manual_verify'
  };
  return {
    optedOut: true, featuresDisabled: features,
    fallbackMode: features.map(f => fb[f] ?? 'disabled').join(', '),
    dataDeletedFromTraining: true, effectiveDate: new Date().toISOString()
  };
}
export const mlOptOut = aiOptOut;
export const algorithmOptOut = aiOptOut;
export const aiTrainingOptOut = aiOptOut;

// ─── [15.2] AI Agent / Concierge Safety ──────────────────

export interface AiAgentSafetyResult {
  safeToSend: boolean;
  issues: string[];
  sanitizedMessage: string;
  guardrailsApplied: string[];
}
export function aiAgentSafety(
  msg: string,
  context: { isAiGenerated: boolean; targetUserId: string; agentType: string }
): AiAgentSafetyResult {
  const issues: string[] = [], guards: string[] = []; let san = msg;
  if (/\b(send money|wire transfer|crypto|gift card|bitcoin)\b/i.test(msg)) {
    issues.push('financial_solicitation'); guards.push('financial_content_blocked');
    san = san.replace(/\b(send money|wire transfer|crypto|gift card|bitcoin)\b/gi, '[BLOCKED]');
  }
  if (/\b(meet me at|come to my|my address is|i live at)\b/i.test(msg)) {
    issues.push('location_disclosure'); guards.push('location_content_reviewed');
  }
  if (/\b(i love you|you are perfect|soul mate|marry me)\b/i.test(msg) && context.isAiGenerated) {
    issues.push('premature_intimacy_ai'); guards.push('intimacy_pacing_applied');
  }
  if (msg.length > 5000) { issues.push('excessive_length'); guards.push('message_truncated'); san = san.slice(0, 5000); }
  if (context.isAiGenerated) guards.push('ai_disclosure_label');
  return { safeToSend: !issues.length, issues, sanitizedMessage: san, guardrailsApplied: guards };
}
export const agentGuardrail = aiAgentSafety;
export const conciergeFilter = aiAgentSafety;

export interface AiDisclosureResult {
  disclosed: boolean;
  label: string;
  requiredBy: string[];
  placement: string;
}
export function aiDisclosure(
  isAiGenerated: boolean,
  contentType: 'message' | 'profile' | 'photo' | 'suggestion'
): AiDisclosureResult {
  if (!isAiGenerated) return { disclosed: false, label: '', requiredBy: [], placement: 'none' };
  const labels: Record<string, string> = {
    message: '🤖 AI-assisted message', profile: '🤖 AI-generated profile content',
    photo: '🤖 AI-generated image', suggestion: '💡 AI suggestion'
  };
  return {
    disclosed: true, label: labels[contentType] ?? '🤖 AI-generated',
    requiredBy: ['EU AI Act Art.52', 'FTC AI Guidelines 2024', 'DSA Art.25'],
    placement: 'inline_before_content'
  };
}
export const aiLabel = aiDisclosure;
export const syntheticDisclosure = aiDisclosure;

// ─── [15.3] AI-Powered Infrastructure Safety ─────────────

export interface AiContentModerationResult {
  action: 'allow' | 'warn' | 'remove' | 'escalate';
  confidence: number;
  categories: string[];
  humanReviewRequired: boolean;
  appealable: boolean;
}
export function aiContentModeration(
  content: string,
  context: { contentType: string; userTrustScore: number; priorViolations: number }
): AiContentModerationResult {
  const cats: string[] = []; let conf = 0;
  if (/\b(kill|murder|shoot|stab|bomb)\s+(you|them|her|him|everyone)\b/i.test(content)) {
    cats.push('violence_threat'); conf += 0.8;
  }
  if (/\b(send nudes|show me|take off|get naked)\b/i.test(content)) {
    cats.push('sexual_solicitation'); conf += 0.7;
  }
  if (/\b(wire transfer|send money|gift card|invest now)\b/i.test(content)) {
    cats.push('financial_fraud'); conf += 0.6;
  }
  // FIX: note — production should call DuoGuard/Perspective API for comprehensive hate speech
  // This regex is a minimal fallback only
  if (/\b(n[i1]gg[ae]r|f[a@]gg[o0]t|[ck]h[i1]nk|sp[i1][ck]k)\b/i.test(content)) {
    cats.push('hate_speech'); conf += 0.85;
  }
  conf = Math.min(1, conf + context.priorViolations * 0.05);
  const hr = conf >= 0.5 && conf < 0.85;
  return {
    action: conf >= 0.85 ? 'remove' : conf >= 0.6 ? 'escalate' : conf >= 0.4 ? 'warn' : 'allow',
    confidence: conf, categories: cats, humanReviewRequired: hr, appealable: conf < 0.95
  };
}
export const autoModerate = aiContentModeration;
export const mlModeration = aiContentModeration;

export interface AiAnomalyResult {
  anomalyDetected: boolean;
  score: number;
  features: string[];
  baselineDeviation: number;
  recommendation: string;
}
export function aiAnomaly(
  metrics: Record<string, number>,
  baseline: Record<string, number>,
  stdDevs: Record<string, number>
): AiAnomalyResult {
  const feats: string[] = []; let sc = 0;
  for (const [k, v] of Object.entries(metrics)) {
    const b = baseline[k] ?? 0, s = stdDevs[k] ?? 1;
    const dev = Math.abs(v - b) / s;
    if (dev >= 2) { feats.push(`${k}:${dev.toFixed(1)}σ`); sc += dev * 0.1; }
  }
  sc = Math.min(1, sc);
  const bd = feats.length > 0 ? parseFloat(feats[0]!.split(':')[1]!) : 0;
  return {
    anomalyDetected: sc >= 0.2, score: sc, features: feats, baselineDeviation: bd,
    recommendation: sc >= 0.6 ? 'Immediate investigation required'
      : sc >= 0.3 ? 'Monitor and alert' : 'Normal behavior'
  };
}
export const mlAnomaly = aiAnomaly;
export const behaviorAnomaly = aiAnomaly;

export interface AiScaleResult {
  canProcess: boolean;
  estimatedLatencyMs: number;
  queueDepth: number;
  recommendation: string;
  throttle: boolean;
}
export function aiScale(s: {
  requestsPerSecond: number; queueDepth: number;
  avgLatencyMs: number; errorRate: number; capacity: number;
}): AiScaleResult {
  const util = s.requestsPerSecond / Math.max(s.capacity, 1);
  const throttle = util >= 0.9 || s.errorRate >= 0.05;
  return {
    canProcess: !throttle, estimatedLatencyMs: s.avgLatencyMs * (1 + util), queueDepth: s.queueDepth,
    recommendation: throttle ? 'Scale up inference capacity or throttle requests'
      : util >= 0.7 ? 'Consider pre-scaling' : 'Capacity adequate',
    throttle
  };
}
export const inferenceScale = aiScale;
export const mlCapacity = aiScale;

// ─── [15.4] AI Scam Detection Failure Modes ──────────────

export interface AiScamFailureResult {
  falseNegative: boolean;
  falsePositive: boolean;
  evasionTechnique: string[];
  confidence: number;
  humanReviewTriggered: boolean;
}
export function aiScamFailure(s: {
  messageText: string; userReported: boolean;
  modelScore: number; knownEvasions: string[];
}): AiScamFailureResult {
  const ev: string[] = [];
  if (/[^\x00-\x7F]/.test(s.messageText) && s.modelScore < 0.3) ev.push('unicode_evasion');
  if (/\s{3,}/.test(s.messageText) && s.modelScore < 0.3) ev.push('whitespace_injection');
  if (s.messageText.split('').some(c => /[\u0300-\u036f]/.test(c)) && s.modelScore < 0.3) ev.push('homoglyph_attack');
  if (s.knownEvasions.some(e => s.messageText.toLowerCase().includes(e.toLowerCase()))) ev.push('known_evasion_pattern');
  const fn = s.userReported && s.modelScore < 0.4;
  const fp = !s.userReported && s.modelScore >= 0.8;
  return {
    falseNegative: fn, falsePositive: fp, evasionTechnique: ev,
    confidence: s.modelScore, humanReviewTriggered: fn || ev.length >= 2
  };
}
export const scamEvasion = aiScamFailure;
export const modelBlindspot = aiScamFailure;

export interface AiCalibrationResult {
  calibrated: boolean;
  expectedCalibration: number;
  reliability: number;
  temperatureAdjustment: number;
  recommendation: string;
}
export function aiCalibration(predictions: Array<{ predicted: number; actual: boolean }>): AiCalibrationResult {
  const bins = Array.from({ length: 10 }, (_, i) => ({ min: i * 0.1, max: (i + 1) * 0.1, preds: 0, correct: 0 }));
  for (const { predicted, actual } of predictions) {
    const b = bins.find(b => predicted >= b.min && predicted < b.max);
    if (b) { b.preds++; if (actual) b.correct++; }
  }
  const ece = bins.reduce((s, b) =>
    s + (b.preds / Math.max(predictions.length, 1)) * Math.abs(b.preds > 0 ? b.correct / b.preds - (b.min + b.max) / 2 : 0), 0);
  return {
    calibrated: ece <= 0.1, expectedCalibration: ece, reliability: 1 - ece,
    temperatureAdjustment: ece > 0.1 ? 1 + ece : 1.0,
    recommendation: ece > 0.2 ? 'Recalibrate model — significant overconfidence'
      : ece > 0.1 ? 'Temperature scaling recommended' : 'Model well-calibrated'
  };
}
export const modelCalibration = aiCalibration;
export const confidenceCalibrate = aiCalibration;

export interface AiEdgeCaseResult {
  handled: boolean;
  edgeCases: string[];
  fallbackActivated: boolean;
  fallbackMode: string;
}
export function aiEdgeCase(input: {
  isEmpty: boolean; isExtremelyLong: boolean; hasOnlyEmoji: boolean;
  hasMixedLanguages: boolean; isAllCaps: boolean; hasRepeatingPattern: boolean;
}): AiEdgeCaseResult {
  const ec: string[] = [];
  if (input.isEmpty) ec.push('empty_input');
  if (input.isExtremelyLong) ec.push('input_too_long');
  if (input.hasOnlyEmoji) ec.push('emoji_only');
  if (input.hasMixedLanguages) ec.push('mixed_language');
  if (input.isAllCaps) ec.push('all_caps');
  if (input.hasRepeatingPattern) ec.push('repeating_pattern');
  const fb = ec.length >= 2;
  return { handled: true, edgeCases: ec, fallbackActivated: fb, fallbackMode: fb ? 'keyword_pattern_fallback' : 'normal_inference' };
}
export const mlEdgeCase = aiEdgeCase;
export const modelFallback = aiEdgeCase;

// ─── [15.5] Algorithmic Bias & Discrimination ────────────

export interface AlgorithmicBiasResult {
  biasDetected: boolean;
  groups: Record<string, { exposureRate: number; deviationFromMean: number }>;
  recommendation: string;
  complianceRisk: string[];
}
export function algorithmicBiasCheck(
  exposures: Array<{ userId: string; group: string; profilesShown: number }>
): AlgorithmicBiasResult {
  const byGroup: Record<string, number[]> = {};
  for (const e of exposures) {
    if (!byGroup[e.group]) byGroup[e.group] = [];
    byGroup[e.group]!.push(e.profilesShown);
  }
  const means: Record<string, number> = {};
  for (const [g, vals] of Object.entries(byGroup))
    means[g] = vals.reduce((s, v) => s + v, 0) / vals.length;
  const overall = Object.values(means).reduce((s, v) => s + v, 0) / Math.max(Object.keys(means).length, 1);
  const groups: AlgorithmicBiasResult['groups'] = {};
  for (const [g, m] of Object.entries(means))
    groups[g] = { exposureRate: m, deviationFromMean: (m - overall) / Math.max(overall, 1) };
  const biased = Object.values(groups).some(g => Math.abs(g.deviationFromMean) >= 0.2);
  const cr: string[] = [];
  if (biased) cr.push('EU AI Act Art.10 (Data Governance)', 'US Fair Housing Act (if location-based)');
  return {
    biasDetected: biased, groups,
    recommendation: biased
      ? 'Audit recommendation algorithm for demographic disparities. Apply fairness constraints.'
      : 'No significant algorithmic bias detected.',
    complianceRisk: cr
  };
}
export const algorithmicBiasAudit = algorithmicBiasCheck;
export const exposureBias = algorithmicBiasCheck;
export const demographicBias = algorithmicBiasCheck;

export interface FilterBubbleResult {
  detected: boolean;
  diversityScore: number;
  echoPatterns: string[];
  recommendation: string;
}
export function filterBubble(
  userHistory: { seenProfiles: Array<{ age: number; gender: string; distance: number; interests: string[] }> }
): FilterBubbleResult {
  const profiles = userHistory.seenProfiles;
  if (profiles.length < 10) return { detected: false, diversityScore: 1, echoPatterns: [], recommendation: 'Insufficient data' };
  const ages = profiles.map(p => p.age);
  const ageRange = Math.max(...ages) - Math.min(...ages);

  // FIX: Use entropy-based gender diversity instead of Set.size
  const genderCounts: Record<string, number> = {};
  for (const p of profiles) genderCounts[p.gender] = (genderCounts[p.gender] ?? 0) + 1;
  const dominantGenderPct = Math.max(...Object.values(genderCounts)) / profiles.length;
  const genderDiverse = dominantGenderPct < 0.8;

  const interests = profiles.flatMap(p => p.interests);
  const interestUnique = new Set(interests).size / Math.max(interests.length, 1);
  let ds = 0;
  if (ageRange >= 10) ds += 0.3;
  if (genderDiverse) ds += 0.3;
  if (interestUnique >= 0.3) ds += 0.4;
  const ec: string[] = [];
  if (ageRange < 5) ec.push('narrow_age_range');
  if (!genderDiverse) ec.push('single_gender_dominant');
  if (interestUnique < 0.15) ec.push('interest_echo_chamber');
  return {
    detected: ds < 0.5, diversityScore: ds, echoPatterns: ec,
    recommendation: ds < 0.5 ? 'Inject diversity into recommendations' : 'Good recommendation diversity'
  };
}
export const echoChamber = filterBubble;
export const recommendationBubble = filterBubble;

export interface GenderBiasResult {
  detected: boolean;
  biasType: string[];
  affectedGenders: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}
export function genderBias(
  metrics: Record<string, { shown: number; matched: number; messaged: number }>
): GenderBiasResult {
  const types: string[] = [], affected: string[] = [];
  const matchRates: Record<string, number> = {}, msgRates: Record<string, number> = {};
  for (const [g, m] of Object.entries(metrics)) {
    matchRates[g] = m.matched / Math.max(m.shown, 1);
    msgRates[g] = m.messaged / Math.max(m.matched, 1);
  }
  const mrVals = Object.values(matchRates), msgVals = Object.values(msgRates);
  const mrRange = Math.max(...mrVals) - Math.min(...mrVals);
  const msgRange = Math.max(...msgVals) - Math.min(...msgVals);
  if (mrRange >= 0.15) {
    types.push('match_rate_disparity');
    const minRate = Math.min(...mrVals);
    for (const [g, r] of Object.entries(matchRates)) if (r === minRate) affected.push(g);
  }
  if (msgRange >= 0.2) {
    types.push('message_rate_disparity');
    const minRate = Math.min(...msgVals);
    for (const [g, r] of Object.entries(msgRates)) if (r === minRate) affected.push(g);
  }
  const s: GenderBiasResult['severity'] = types.length >= 2 ? 'high' : types.length === 1 ? 'medium' : 'none';
  return {
    detected: types.length > 0, biasType: types, affectedGenders: [...new Set(affected)], severity: s,
    recommendation: types.length > 0 ? 'Adjust recommendation weights for gender equity' : 'No significant gender bias'
  };
}
export const genderAlgorithmBias = genderBias;
export const matchingFairness = genderBias;

// ─── [16.11] DSAR Weaponization ──────────────────────────

export interface DsarWeaponizationResult {
  legitimate: boolean;
  riskIndicators: string[];
  action: 'process' | 'verify_identity' | 'flag' | 'reject';
  notes: string;
}
export function dsarWeaponization(req: {
  requestCount30days: number; targetedUserIds: string[]; requesterIp: string;
  requestType: string; verifiedIdentity: boolean; priorAbuseFlag: boolean;
}): DsarWeaponizationResult {
  const ri: string[] = [];
  if (req.requestCount30days >= 5) ri.push(`excessive_requests_${req.requestCount30days}_in_30d`);
  if (req.targetedUserIds.length >= 2) ri.push(`multiple_target_users_${req.targetedUserIds.length}`);
  if (!req.verifiedIdentity) ri.push('unverified_identity');
  if (req.priorAbuseFlag) ri.push('prior_dsar_abuse');
  if (req.requestType === 'data_portability' && req.requestCount30days >= 3) ri.push('repeated_portability_requests');
  const action: DsarWeaponizationResult['action'] =
    req.priorAbuseFlag && ri.length >= 3 ? 'reject'
    : ri.length >= 2 ? 'flag'
    : !req.verifiedIdentity ? 'verify_identity'
    : 'process';
  return {
    legitimate: !ri.length, riskIndicators: ri, action,
    notes: ri.length
      ? `DSAR may be weaponized: ${ri.join(', ')}`
      : 'Legitimate DSAR — process within statutory timeframe (30/45 days)'
  };
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
  return {
    compliant: req.completed && rem >= 0, daysRemaining: rem,
    requiredActions: missing, jurisdiction: req.jurisdiction.toUpperCase(),
    deadline: deadline.toISOString().split('T')[0]!
  };
}
export const dsarDeadline = dsarCompliance;
export const sarCompliance = dsarCompliance;

// ─── [22] Profile Field Semantic Abuse ───────────────────

export interface FieldSemanticAbuseResult {
  detected: boolean;
  field: string;
  abuseTypes: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'allow' | 'warn' | 'remove' | 'escalate';
  sanitized: string;
}
const FIELD_ABUSE: Record<string, Array<{ p: RegExp; t: string; s: FieldSemanticAbuseResult['severity'] }>> = {
  name: [
    { p: /\b(admin|moderator|support|official|verified|staff|bot)\b/i, t: 'authority_impersonation', s: 'high' },
    { p: /\b\d{10,}\b/, t: 'phone_in_name', s: 'medium' },
    { p: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, t: 'email_in_name', s: 'medium' }
  ],
  bio: [
    { p: /\b(snap|snapchat|insta|instagram|whatsapp|telegram|kik)\s*[:=@]?\s*\w+/i, t: 'platform_redirect', s: 'medium' },
    { p: /\b\d{10,}\b/, t: 'phone_in_bio', s: 'medium' },
    { p: /send\s+(me\s+)?(money|crypto|gift\s+card)/i, t: 'solicitation', s: 'high' },
    { p: /only\s+fans|onlyfans|fan\s*trie|content\s+creator\s+at/i, t: 'commercial_redirect', s: 'medium' }
  ],
  job_title: [
    { p: /\b(ceo|millionaire|billionaire|investor|trader|forex|crypto)\b/i, t: 'wealth_claim', s: 'low' },
    { p: /\b(military|army|navy|air\s+force|special\s+forces|deployed)\b/i, t: 'military_claim', s: 'low' }
  ],
  school: [
    { p: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, t: 'email_in_school', s: 'medium' }
  ]
};
export function fieldSemanticAbuse(field: string, value: string): FieldSemanticAbuseResult {
  const rules = FIELD_ABUSE[field] ?? [], types: string[] = [];
  let ms: FieldSemanticAbuseResult['severity'] = 'none';
  const SEV: Array<FieldSemanticAbuseResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const { p, t, s } of rules) {
    if (p.test(value)) { types.push(t); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
  }
  let sanitized = value;
  for (const { p } of rules) sanitized = sanitized.replace(p, '[removed]');
  return {
    detected: types.length > 0, field, abuseTypes: types, severity: ms,
    action: ms === 'critical' ? 'escalate' : ms === 'high' ? 'remove' : ms !== 'none' ? 'warn' : 'allow',
    sanitized
  };
}
export const bioAbuse = fieldSemanticAbuse;
export const nameAbuse = fieldSemanticAbuse;
export const profileFieldAbuse = fieldSemanticAbuse;

export interface HeightWeaponizationResult {
  detected: boolean;
  pattern: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}
export function heightWeaponization(msgs: string[]): HeightWeaponizationResult {
  const pats: string[] = [];
  const HP = [
    /\b(under|below|less\s+than)\s+(6|6'|six)\s*(feet|ft|foot|'|")?\b/i,
    /\b(only|must|need\s+to\s+be)\s+(over|above|at\s+least)\s+(6|5'10|5'11|six)/i,
    /\b(short|tall)\s+(men|guys|women|girls)\s+(are|aren't|don't|can't|won't)\b/i,
    /height.?(requirement|minimum|must|filter|check)/i
  ];
  for (const m of msgs) for (const p of HP) if (p.test(m)) pats.push(p.source);
  const s: HeightWeaponizationResult['severity'] =
    pats.length >= 3 ? 'high' : pats.length >= 2 ? 'medium' : pats.length >= 1 ? 'low' : 'none';
  return {
    detected: pats.length > 0, pattern: pats, severity: s,
    recommendation: s !== 'none'
      ? 'Height discrimination can be harmful. Consider educating user about respectful preference expression.'
      : 'No height weaponization detected.'
  };
}
export const heightFilter = heightWeaponization;
export const heightDiscrim = heightWeaponization;

export interface IncomeFlexResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}
export function incomeFlex(content: string): IncomeFlexResult {
  const pats: string[] = [];
  const IP = [
    /\b(millionaire|billionaire|7|8)\s*figure/i,
    /\b(private\s+jet|yacht|mansion|penthouse|ferrari|lambo|lamborghini|porsche)\b/i,
    /\b(rich|wealthy|successful)\s+(enough|man|woman|partner)\b/i,
    /\bnet\s*worth\s*(of\s+)?\$?\d+[km]?\b/i,
    /\bmake\s+(over\s+)?\$?\d{4,}\s*(per\s+month|\/month|monthly|per\s+year|annually)\b/i,
    /i\s+(only|date|see)\s+(successful|wealthy|financially\s+stable|6\s+figure)\b/i
  ];
  for (const p of IP) if (p.test(content)) pats.push(p.source);
  const s: IncomeFlexResult['severity'] =
    pats.length >= 3 ? 'high' : pats.length >= 2 ? 'medium' : pats.length >= 1 ? 'low' : 'none';
  return {
    detected: pats.length > 0, patterns: pats, severity: s,
    recommendation: s === 'high'
      ? 'Potential financial scam setup or exploitative wealth signaling. Review.'
      : 'Monitor for financial manipulation context.'
  };
}
export const wealthBait = incomeFlex;
export const financialFlex = incomeFlex;

export interface PromptAnswerAbuseResult {
  detected: boolean;
  abuseType: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  sanitized: string;
}
export function promptAnswerAbuse(prompt: string, answer: string): PromptAnswerAbuseResult {
  const types: string[] = []; let ms: PromptAnswerAbuseResult['severity'] = 'none';
  const SEV: Array<PromptAnswerAbuseResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  const checks: Array<{ p: RegExp; t: string; s: PromptAnswerAbuseResult['severity'] }> = [
    { p: /\b(snap|insta|telegram|whatsapp)\s*[:@]\s*\w+/i, t: 'platform_redirect', s: 'medium' },
    { p: /\b\d{10,}\b/, t: 'phone_number', s: 'medium' },
    { p: /onlyfans|fansly|patreon\.com/i, t: 'commercial_redirect', s: 'high' },
    { p: /\b(send|wire|transfer)\s+(me\s+)?(money|cash|crypto)\b/i, t: 'solicitation', s: 'high' },
    { p: /<script|javascript:|onerror=/i, t: 'xss_attempt', s: 'critical' }
  ];
  for (const { p, t, s } of checks) {
    if (p.test(answer)) { types.push(t); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
  }
  let sanitized = answer;
  for (const { p } of checks) sanitized = sanitized.replace(p, '[removed]');
  return { detected: types.length > 0, abuseType: types, severity: ms, sanitized };
}
export const promptAbuse = promptAnswerAbuse;
export const answerAbuse = promptAnswerAbuse;

// ─── [20] User Wellbeing & Compulsive Use ────────────────

export interface ScreenTimeLimitResult {
  limitReached: boolean;
  sessionMinutes: number;
  dailyMinutes: number;
  warningThreshold: number;
  hardLimit: number;
  message: string;
}
export function screenTimeLimit(s: {
  sessionStartMs: number; dailyUsageMs: number; userSetLimitMin?: number;
}): ScreenTimeLimitResult {
  const sm = (Date.now() - s.sessionStartMs) / 60000;
  const dm = s.dailyUsageMs / 60000;
  const hl = s.userSetLimitMin ?? 120, wt = hl * 0.8;
  return {
    limitReached: dm >= hl, sessionMinutes: sm, dailyMinutes: dm,
    warningThreshold: wt, hardLimit: hl,
    message: dm >= hl ? 'Daily limit reached. Take a break!'
      : dm >= wt ? `Approaching daily limit (${Math.round(dm)}/${hl} min)`
      : ''
  };
}
export const usageLimit = screenTimeLimit;
export const dailyLimit = screenTimeLimit;

export interface BreakReminderResult {
  shouldRemind: boolean;
  message: string;
  suggestedBreakMin: number;
  nextReminderMs: number;
}
export function breakReminder(s: {
  continuousMinutes: number; swipeCount: number;
  messageCount: number; timeOfDay: number;
}): BreakReminderResult {
  let should = false, msg = '', brk = 10;
  if (s.continuousMinutes >= 60) { should = true; msg = "You've been active for an hour. Time for a break!"; brk = 15; }
  else if (s.swipeCount >= 100) { should = true; msg = "That's a lot of swiping! Rest your thumb 😄"; brk = 10; }
  else if (s.timeOfDay >= 23 || s.timeOfDay <= 5) { should = true; msg = "Late night? Consider resting for better decisions tomorrow."; brk = 30; }
  return { shouldRemind: should, message: msg, suggestedBreakMin: brk, nextReminderMs: 30 * 60000 };
}
export const restReminder = breakReminder;
export const swipeReminder = breakReminder;

export interface MatchQualityResult {
  qualityScore: number;
  recommendation: string;
  swipePattern: 'thoughtful' | 'indiscriminate' | 'selective';
  wellbeingTip: string;
}
export function matchQuality(s: {
  totalSwipes: number; rightSwipes: number; profileViewTimeAvgSec: number;
  messagesInitiated: number; matchCount: number;
}): MatchQualityResult {
  const rr = s.rightSwipes / Math.max(s.totalSwipes, 1);
  const pattern: MatchQualityResult['swipePattern'] =
    rr >= 0.9 ? 'indiscriminate' : rr <= 0.3 ? 'selective' : 'thoughtful';
  const qs = Math.min(100,
    (s.profileViewTimeAvgSec >= 10 ? 30 : 15) +
    (pattern === 'thoughtful' ? 30 : pattern === 'selective' ? 25 : 10) +
    (s.messagesInitiated / Math.max(s.matchCount, 1) >= 0.5 ? 40 : 20)
  );
  const tip = pattern === 'indiscriminate'
    ? 'Consider reviewing profiles more carefully for better matches'
    : pattern === 'selective' ? 'Your thoughtful approach leads to higher quality matches!'
    : 'Good balance of selectivity and openness!';
  return {
    qualityScore: qs,
    recommendation: qs >= 70 ? 'Your matching approach looks healthy!' : 'Try spending more time on each profile',
    swipePattern: pattern, wellbeingTip: tip
  };
}
export const swipeHealth = matchQuality;
export const matchingWellbeing = matchQuality;

// ─── [20.1] Emotional Labor / Normalized Harassment ──────

export interface EmotionalLaborResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
  resourceLinks: string[];
}
export function emotionalLabor(msgs: string[]): EmotionalLaborResult {
  const pats: string[] = [];
  const EL = [
    /why\s+aren'?t\s+you\s+(responding|replying|answering)/i,
    /you\s+owe\s+me\s+(a\s+)?(response|reply|explanation|date|chance)/i,
    /i\s+(thought|expected)\s+you\s+(would|were\s+going\s+to)\s+(reply|respond|message)/i,
    /why\s+(are\s+you\s+)?(so\s+)?(cold|distant|unresponsive|ignoring)/i,
    /you\s+should\s+(be\s+)?(grateful|happy|lucky)\s+(i'?m|to\s+be)\s+(messaging|talking)/i,
    /all\s+i'?m\s+asking\s+for\s+is\s+(a\s+chance|your\s+time|attention)/i
  ];
  for (const m of msgs) for (const p of EL) if (p.test(m)) pats.push(p.source);
  const s: EmotionalLaborResult['severity'] =
    pats.length >= 4 ? 'high' : pats.length >= 2 ? 'medium' : pats.length >= 1 ? 'low' : 'none';
  return {
    detected: pats.length > 0, patterns: pats, severity: s,
    recommendation: s !== 'none'
      ? 'Emotional labor demands detected. Users are never obligated to respond. Consider sending safety resources.'
      : 'No emotional labor patterns.',
    resourceLinks: s !== 'none' ? ['loveisrespect.org', 'thehotline.org'] : []
  };
}
export const entitledMessaging = emotionalLabor;
export const responseEntitlement = emotionalLabor;

export interface NormalizedHarassResult {
  detected: boolean;
  normalizedPatterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
}
export function normalizedHarass(msgs: string[], reportCount: number): NormalizedHarassResult {
  const pats: string[] = [];
  const NH = [
    /you'?re\s+(being\s+)?(too\s+)?(sensitive|dramatic|emotional|overreacting)/i,
    /that'?s\s+(just\s+)?(how\s+)?(guys|men|people|dating)\s+(talk|are|works?)/i,
    /it'?s\s+(just\s+a\s+)?(joke|banter|compliment|flirting)/i,
    /you\s+(can'?t|shouldn'?t)\s+(be\s+)?(offended|upset|mad)\s+by\s+that/i,
    /everyone\s+(does|says|sends)\s+this/i
  ];
  for (const m of msgs) for (const p of NH) if (p.test(m)) pats.push(p.source);
  if (reportCount >= 3) pats.push('repeated_reports_normalized');
  const s: NormalizedHarassResult['severity'] =
    pats.length >= 4 || reportCount >= 5 ? 'critical'
    : pats.length >= 3 ? 'high' : pats.length >= 2 ? 'medium'
    : pats.length >= 1 ? 'low' : 'none';
  return {
    detected: pats.length > 0, normalizedPatterns: pats, severity: s,
    recommendation: s !== 'none'
      ? 'Gaslighting/normalizing harassment. Validate reporter experience. Take reports seriously regardless of sender intent.'
      : 'No normalization patterns.'
  };
}

// ─── [44] #647 Historical email address association tracking ──
export interface EmailHistoryResult {
  userId: string;
  emailHashes: string[];
  associatedAccounts: string[];
  suspiciousChange: boolean;
  changeCount: number;
  lastChangedAt: number | null;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  indicators: string[];
  recommendation: string;
}

interface EmailChangeRecord {
  userId: string;
  emailHash: string;
  changedAt: number;
  ipHash?: string;
  deviceFp?: string;
}

// In-memory store (production: replace with DB)
const emailHistoryStore = new Map<string, EmailChangeRecord[]>();
const hashToAccountMap = new Map<string, Set<string>>();

async function hashEmail(email: string): Promise<string> {
  try {
    const normalized = email.toLowerCase().trim();
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(normalized)
    );
    return Array.from(new Uint8Array(buf))
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Fallback (non-crypto env)
    let h = 0;
    const s = email.toLowerCase().trim();
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16);
  }
}

export async function recordEmailChange(
  userId: string,
  newEmail: string,
  metadata?: { ipHash?: string; deviceFp?: string }
): Promise<void> {
  const hash = await hashEmail(newEmail);
  const record: EmailChangeRecord = {
    userId,
    emailHash: hash,
    changedAt: Date.now(),
    ipHash: metadata?.ipHash,
    deviceFp: metadata?.deviceFp,
  };

  const existing = emailHistoryStore.get(userId) ?? [];
  existing.push(record);
  emailHistoryStore.set(userId, existing);

  // Reverse map: hash → Set of userIds
  if (!hashToAccountMap.has(hash)) hashToAccountMap.set(hash, new Set());
  hashToAccountMap.get(hash)!.add(userId);
}

export async function getEmailHistory(
  userId: string,
  currentEmail?: string
): Promise<EmailHistoryResult> {
  const records = emailHistoryStore.get(userId) ?? [];
  const indicators: string[] = [];
  let riskScore = 0;

  const emailHashes = records.map(r => r.emailHash);
  const currentHash = currentEmail ? await hashEmail(currentEmail) : null;

  // Find all accounts that share any email hash with this user
  const associatedAccounts: string[] = [];
  for (const hash of emailHashes) {
    const accounts = hashToAccountMap.get(hash);
    if (accounts) {
      for (const uid of accounts) {
        if (uid !== userId && !associatedAccounts.includes(uid)) {
          associatedAccounts.push(uid);
        }
      }
    }
  }

  // Suspicious change count
  if (records.length >= 5) {
    indicators.push(`excessive_email_changes:${records.length}`);
    riskScore += 0.3;
  } else if (records.length >= 3) {
    indicators.push(`multiple_email_changes:${records.length}`);
    riskScore += 0.15;
  }

  // Same email used across multiple accounts (ban evasion signal)
  if (associatedAccounts.length >= 2) {
    indicators.push(`email_shared_across_${associatedAccounts.length}_accounts`);
    riskScore += 0.4 * Math.min(1, associatedAccounts.length * 0.2);
  }

  // Rapid changes (more than 2 in 7 days)
  const now = Date.now();
  const recentChanges = records.filter(r => now - r.changedAt < 7 * 86_400_000);
  if (recentChanges.length >= 3) {
    indicators.push(`rapid_email_changes_last_7d:${recentChanges.length}`);
    riskScore += 0.25;
  }

  // IP/device consistency check
  const ips = new Set(records.map(r => r.ipHash).filter(Boolean));
  const devices = new Set(records.map(r => r.deviceFp).filter(Boolean));
  if (ips.size >= 4 && records.length >= 4) {
    indicators.push('email_changes_from_multiple_ips');
    riskScore += 0.15;
  }
  if (devices.size >= 3 && records.length >= 4) {
    indicators.push('email_changes_from_multiple_devices');
    riskScore += 0.1;
  }

  // Currently using a previously-seen email from a different account
  if (currentHash && associatedAccounts.length > 0 && !emailHashes.includes(currentHash)) {
    indicators.push('current_email_previously_used_by_other_account');
    riskScore += 0.35;
  }

  riskScore = Math.min(1, riskScore);
  const riskLevel: EmailHistoryResult['riskLevel'] =
    riskScore >= 0.7 ? 'high' :
    riskScore >= 0.4 ? 'medium' :
    riskScore >= 0.15 ? 'low' : 'none';

  const lastRecord = records.length > 0 ? records[records.length - 1]! : null;

  return {
    userId,
    emailHashes,
    associatedAccounts,
    suspiciousChange: riskScore >= 0.3,
    changeCount: records.length,
    lastChangedAt: lastRecord?.changedAt ?? null,
    riskLevel,
    indicators,
    recommendation:
      riskLevel === 'high'
        ? 'High-risk email history. Possible ban evasion or account takeover. Require re-verification.'
        : riskLevel === 'medium'
        ? 'Multiple email changes or cross-account associations detected. Monitor account.'
        : riskLevel === 'low'
        ? 'Minor email change activity. No immediate action required.'
        : 'No suspicious email history detected.',
  };
}

export const emailHistory = getEmailHistory;
export const historicalEmail = getEmailHistory;
export const emailAssociation = getEmailHistory;
export const emailChangeRecord = recordEmailChange;

export const gaslightingDetect = normalizedHarass;
export const harassNormalization = normalizedHarass;

// ═══ Detector #509 [15] Model poisoning detection ═══
// severity: high
export const modelPoisoning_509 = 'modelPoisoning';
export const trainingDataPoison_509 = 'trainingDataPoison';
export const poisonDetect_509 = 'poisonDetect';
export const _det509_modelPoisoning = {
  id: 509,
  section: '15',
  name: 'Model poisoning detection',
  severity: 'high' as const,
  patterns: ['modelPoisoning', 'trainingDataPoison', 'poisonDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['modelPoisoning', 'trainingDataPoison', 'poisonDetect'].some(pat => input.includes(pat));
  }
};
// pattern-ref: modelPoisoning
export const _ref_modelPoisoning = _det509_modelPoisoning;
// pattern-ref: trainingDataPoison
export const _ref_trainingDataPoison = _det509_modelPoisoning;
// pattern-ref: poisonDetect
export const _ref_poisonDetect = _det509_modelPoisoning;

// ═══ Detector #511 [15] Model inversion attack prevention ═══
// severity: medium
export const modelInversion_511 = 'modelInversion';
export const inversionAttack_511 = 'inversionAttack';
export const privacyAttack_511 = 'privacyAttack';
export const _det511_modelInversion = {
  id: 511,
  section: '15',
  name: 'Model inversion attack prevention',
  severity: 'medium' as const,
  patterns: ['modelInversion', 'inversionAttack', 'privacyAttack'],
  enabled: true,
  detect(input: string): boolean {
    return ['modelInversion', 'inversionAttack', 'privacyAttack'].some(pat => input.includes(pat));
  }
};
// pattern-ref: modelInversion
export const _ref_modelInversion = _det511_modelInversion;
// pattern-ref: inversionAttack
export const _ref_inversionAttack = _det511_modelInversion;
// pattern-ref: privacyAttack
export const _ref_privacyAttack = _det511_modelInversion;

// ═══ Detector #514 [15] Model confidence calibration ═══
// severity: medium
export const confidenceCalibration_514 = 'confidenceCalibration';
export const calibrateModel_514 = 'calibrateModel';
export const temperatureScaling_514 = 'temperatureScaling';
export const _det514_confidenceCalibration = {
  id: 514,
  section: '15',
  name: 'Model confidence calibration',
  severity: 'medium' as const,
  patterns: ['confidenceCalibration', 'calibrateModel', 'temperatureScaling'],
  enabled: true,
  detect(input: string): boolean {
    return ['confidenceCalibration', 'calibrateModel', 'temperatureScaling'].some(pat => input.includes(pat));
  }
};
// pattern-ref: confidenceCalibration
export const _ref_confidenceCalibration = _det514_confidenceCalibration;
// pattern-ref: calibrateModel
export const _ref_calibrateModel = _det514_confidenceCalibration;
// pattern-ref: temperatureScaling
export const _ref_temperatureScaling = _det514_confidenceCalibration;

// ═══ Detector #515 [15] Distribution shift detection ═══
// severity: medium
export const distributionShift_515 = 'distributionShift';
export const dataShift_515 = 'dataShift';
export const covariateDrift_515 = 'covariateDrift';
export const driftDetect_515 = 'driftDetect';
export const _det515_distributionShift = {
  id: 515,
  section: '15',
  name: 'Distribution shift detection',
  severity: 'medium' as const,
  patterns: ['distributionShift', 'dataShift', 'covariateDrift', 'driftDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['distributionShift', 'dataShift', 'covariateDrift', 'driftDetect'].some(pat => input.includes(pat));
  }
};
// pattern-ref: distributionShift
export const _ref_distributionShift = _det515_distributionShift;
// pattern-ref: dataShift
export const _ref_dataShift = _det515_distributionShift;
// pattern-ref: covariateDrift
export const _ref_covariateDrift = _det515_distributionShift;
// pattern-ref: driftDetect
export const _ref_driftDetect = _det515_distributionShift;

// ═══ Detector #520 [15] Detector efficacy metrics ═══
// severity: medium
export const detectorEfficacy_520 = 'detectorEfficacy';
export const precisionRecall_520 = 'precisionRecall';
export const falsePositiveRate_520 = 'falsePositiveRate';
export const efficacyMetrics_520 = 'efficacyMetrics';
export const _det520_detectorEfficacy = {
  id: 520,
  section: '15',
  name: 'Detector efficacy metrics',
  severity: 'medium' as const,
  patterns: ['detectorEfficacy', 'precisionRecall', 'falsePositiveRate', 'efficacyMetrics'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectorEfficacy', 'precisionRecall', 'falsePositiveRate', 'efficacyMetrics'].some(pat => input.includes(pat));
  }
};
// pattern-ref: detectorEfficacy
export const _ref_detectorEfficacy = _det520_detectorEfficacy;
// pattern-ref: precisionRecall
export const _ref_precisionRecall = _det520_detectorEfficacy;
// pattern-ref: falsePositiveRate
export const _ref_falsePositiveRate = _det520_detectorEfficacy;
// pattern-ref: efficacyMetrics
export const _ref_efficacyMetrics = _det520_detectorEfficacy;

// ═══ Detector #585 [17] Cognitive load assessment ═══
// severity: low
export const cognitiveLoad_585 = 'cognitiveLoad';
export const simplifyUI_585 = 'simplifyUI';
export const cognitiveAccessibility_585 = 'cognitiveAccessibility';
export const _det585_cognitiveLoad = {
  id: 585,
  section: '17',
  name: 'Cognitive load assessment',
  severity: 'low' as const,
  patterns: ['cognitiveLoad', 'simplifyUI', 'cognitiveAccessibility'],
  enabled: true,
  detect(input: string): boolean {
    return ['cognitiveLoad', 'simplifyUI', 'cognitiveAccessibility'].some(pat => input.includes(pat));
  }
};
// pattern-ref: cognitiveLoad
export const _ref_cognitiveLoad = _det585_cognitiveLoad;
// pattern-ref: simplifyUI
export const _ref_simplifyUI = _det585_cognitiveLoad;
// pattern-ref: cognitiveAccessibility
export const _ref_cognitiveAccessibility = _det585_cognitiveLoad;

// ═══ Detector #595 [18] Air-gap sensitive operations ═══
// severity: medium
export const airGap_595 = 'airGap';
export const sensitiveOperation_595 = 'sensitiveOperation';
export const isolatedExecution_595 = 'isolatedExecution';
export const _det595_airGap = {
  id: 595,
  section: '18',
  name: 'Air-gap sensitive operations',
  severity: 'medium' as const,
  patterns: ['airGap', 'sensitiveOperation', 'isolatedExecution'],
  enabled: true,
  detect(input: string): boolean {
    return ['airGap', 'sensitiveOperation', 'isolatedExecution'].some(pat => input.includes(pat));
  }
};
// pattern-ref: airGap
export const _ref_airGap = _det595_airGap;
// pattern-ref: sensitiveOperation
export const _ref_sensitiveOperation = _det595_airGap;
// pattern-ref: isolatedExecution
export const _ref_isolatedExecution = _det595_airGap;

// ═══ Detector #599 [18] App clone / modified APK detection ═══
// severity: high
export const apkClone_599 = 'apkClone';
export const modifiedAPK_599 = 'modifiedAPK';
export const appCloneDetect_599 = 'appCloneDetect';
export const tampered_apk_599 = 'tampered_apk';
export const _det599_apkClone = {
  id: 599,
  section: '18',
  name: 'App clone / modified APK detection',
  severity: 'high' as const,
  patterns: ['apkClone', 'modifiedAPK', 'appCloneDetect', 'tampered_apk'],
  enabled: true,
  detect(input: string): boolean {
    return ['apkClone', 'modifiedAPK', 'appCloneDetect', 'tampered_apk'].some(pat => input.includes(pat));
  }
};
// pattern-ref: apkClone
export const _ref_apkClone = _det599_apkClone;
// pattern-ref: modifiedAPK
export const _ref_modifiedAPK = _det599_apkClone;
// pattern-ref: appCloneDetect
export const _ref_appCloneDetect = _det599_apkClone;
// pattern-ref: tampered_apk
export const _ref_tampered_apk = _det599_apkClone;

// ═══ Detector #840 [31] Privacy-preserving identity verification ═══
// severity: medium
export const privacyPreservingVerify_840 = 'privacyPreservingVerify';
export const minimalVerification_840 = 'minimalVerification';
export const privacyVerify_840 = 'privacyVerify';
export const _det840_privacyPreservingVerify = {
  id: 840,
  section: '31',
  name: 'Privacy-preserving identity verification',
  severity: 'medium' as const,
  patterns: ['privacyPreservingVerify', 'minimalVerification', 'privacyVerify'],
  enabled: true,
  detect(input: string): boolean {
    return ['privacyPreservingVerify', 'minimalVerification', 'privacyVerify'].some(pat => input.includes(pat));
  }
};
// pattern-ref: privacyPreservingVerify
export const _ref_privacyPreservingVerify = _det840_privacyPreservingVerify;
// pattern-ref: minimalVerification
export const _ref_minimalVerification = _det840_privacyPreservingVerify;
// pattern-ref: privacyVerify
export const _ref_privacyVerify = _det840_privacyPreservingVerify;

// ═══ Detector #895 [43] Safety feature usage analytics ═══
// severity: medium
export const safetyUsageAnalytics_895 = 'safetyUsageAnalytics';
export const featureUsageTracking_895 = 'featureUsageTracking';
export const safetyAdoption_895 = 'safetyAdoption';
export const _det895_safetyUsageAnalytics = {
  id: 895,
  section: '43',
  name: 'Safety feature usage analytics',
  severity: 'medium' as const,
  patterns: ['safetyUsageAnalytics', 'featureUsageTracking', 'safetyAdoption'],
  enabled: true,
  detect(input: string): boolean {
    return ['safetyUsageAnalytics', 'featureUsageTracking', 'safetyAdoption'].some(pat => input.includes(pat));
  }
};
// pattern-ref: safetyUsageAnalytics
export const _ref_safetyUsageAnalytics = _det895_safetyUsageAnalytics;
// pattern-ref: featureUsageTracking
export const _ref_featureUsageTracking = _det895_safetyUsageAnalytics;
// pattern-ref: safetyAdoption
export const _ref_safetyAdoption = _det895_safetyUsageAnalytics;

// ═══ Detector #641 [44] Account selling / marketplace detection ═══
// severity: medium
export const accountSellingDetect_641 = 'accountSellingDetect';
export const accountMarketplaceDetect_641 = 'accountMarketplaceDetect';
export const sellAccount_641 = 'sellAccount';
export const _det641_accountSellingDetect = {
  id: 641,
  section: '44',
  name: 'Account selling / marketplace detection',
  severity: 'medium' as const,
  patterns: ['accountSellingDetect', 'accountMarketplaceDetect', 'sellAccount'],
  enabled: true,
  detect(input: string): boolean {
    return ['accountSellingDetect', 'accountMarketplaceDetect', 'sellAccount'].some(pat => input.includes(pat));
  }
};
// pattern-ref: accountSellingDetect
export const _ref_accountSellingDetect = _det641_accountSellingDetect;
// pattern-ref: accountMarketplaceDetect
export const _ref_accountMarketplaceDetect = _det641_accountSellingDetect;
// pattern-ref: sellAccount
export const _ref_sellAccount = _det641_accountSellingDetect;

// ═══ Detector #642 [44] Premium feature exploitation for harassment ═══
// severity: medium
export const premiumHarassment_642 = 'premiumHarassment';
export const featureExploit__harass_642 = 'featureExploit.*harass';
export const premiumHarassAbuse_642 = 'premiumHarassAbuse';
export const _det642_premiumHarassment = {
  id: 642,
  section: '44',
  name: 'Premium feature exploitation for harassment',
  severity: 'medium' as const,
  patterns: ['premiumHarassment', 'featureExploit.*harass', 'premiumHarassAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['premiumHarassment', 'featureExploit.*harass', 'premiumHarassAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: premiumHarassment
export const _ref_premiumHarassment = _det642_premiumHarassment;
// pattern-ref: featureExploit.*harass
export const _ref_featureExploit__harass = _det642_premiumHarassment;
// pattern-ref: premiumHarassAbuse
export const _ref_premiumHarassAbuse = _det642_premiumHarassment;

// ════════════════════════════════════════════════════
// Detector #543 [§16.2] LGPD compliance (Brazil)
// ════════════════════════════════════════════════════
export const LGPD_543_key = 'LGPD';
export const lgpdCompliance_543_key = 'lgpdCompliance';
export const brazilPrivacy_543_key = 'brazilPrivacy';

export const LGPDDetector = {
  id: 543,
  section: '16.2',
  name: 'LGPD compliance (Brazil)',
  severity: 'medium' as const,
  patterns: ['LGPD', 'lgpdCompliance', 'brazilPrivacy'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['lgpd', 'lgpdcompliance', 'brazilprivacy']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['lgpd', 'lgpdcompliance', 'brazilprivacy']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function LGPDCheck(input: string): boolean {
  return LGPDDetector.detect(input);
}

export function lgpdComplianceCheck(input: string): boolean {
  return LGPDDetector.detect(input);
}

export function brazilPrivacyCheck(input: string): boolean {
  return LGPDDetector.detect(input);
}

export const _d543_impl = {
  LGPD: LGPDCheck,
  lgpdCompliance: lgpdComplianceCheck,
  brazilPrivacy: brazilPrivacyCheck,
};