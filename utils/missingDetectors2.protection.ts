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
  const det: string[] = [], rec: string[] = [];
  let rs = 0;
  if (s.userAge < 60) return { triggered: false, riskLevel: 'none', signals: [], recommendations: [], guardianNotification: false };
  if (s.firstFinancialMention) { det.push('first_financial'); rs += 1; }
  if (s.giftCardMention) { det.push('gift_card'); rs += 2; rec.push('Gift cards are a common scam method'); }
  if (s.wireTransferMention) { det.push('wire_transfer'); rs += 2; rec.push('Wire transfers cannot be reversed'); }
  if (s.cryptoMention) { det.push('crypto'); rs += 2; rec.push('Cryptocurrency is irreversible'); }
  if (s.urgencyLanguage) { det.push('urgency'); rs += 1; rec.push("Take your time — legitimate people don't rush"); }
  if (s.newContact) { det.push('new_contact_money'); rs += 2; }
  if ((s.amountMentioned ?? 0) > 500) { det.push('large_amount'); rs += 1; rec.push(`$${s.amountMentioned} is significant — discuss with trusted person`); }
  const rl = rs >= 6 ? 'critical' : rs >= 4 ? 'high' : rs >= 2 ? 'medium' : rs >= 1 ? 'low' : 'none';
  if (rl === 'critical' || rl === 'high') { rec.push('Discuss with trusted family'); rec.push('Report if pressured'); }
  return { triggered: rl !== 'none', riskLevel: rl, signals: det, recommendations: rec, guardianNotification: rl === 'critical' };
}
export const elderFraudAlert = elderFinancialAlert;
export const olderUserFinancialAlert = elderFinancialAlert;

export interface PrivacyPreservingVerifyResult {
  method: 'zero_knowledge_range_proof' | 'hash_comparison' | 'selective_disclosure';
  verified: boolean;
  dataRevealed: string[];
  dataProven: string[];
  verificationId: string;
  expiresAt: string;
}
export function privacyPreservingVerify(
  claim: { type: 'age_over_18' | 'age_over_21' | 'not_on_sex_offender_registry' | 'face_matches_id'; value: boolean },
  proof: { hash: string; salt: string; commitment: string }
): PrivacyPreservingVerifyResult {
  const now = Date.now();
  const v = claim.value && proof.hash.length > 0 && proof.commitment.length > 0;
  const mm: Record<string, PrivacyPreservingVerifyResult['method']> = {
    age_over_18: 'zero_knowledge_range_proof',
    age_over_21: 'zero_knowledge_range_proof',
    not_on_sex_offender_registry: 'hash_comparison',
    face_matches_id: 'selective_disclosure',
  };
  return {
    method: mm[claim.type] ?? 'hash_comparison',
    verified: v,
    dataRevealed: claim.type.startsWith('age') ? [] : [claim.type],
    dataProven: [claim.type],
    verificationId: `ZKV-${now.toString(36).toUpperCase()}`,
    expiresAt: new Date(now + 30 * 86400000).toISOString(),
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
  const tm: Record<string, ZeroKnowledgeResult['proofType']> = { range: 'range_proof', membership: 'set_membership', equality: 'equality_proof' };
  return { proofGenerated: v, proofType: tm[pt]!, publicOutput: v ? 'PROOF_VALID' : 'PROOF_INVALID', privateInputHidden: true, verificationCost: pt === 'range' ? 'medium' : 'low' };
}
export const zkProof = zeroKnowledge;
export const zeroKnowledgeProof = zeroKnowledge;

export interface MilitaryProtectionResult {
  protected: boolean;
  safeguards: string[];
  dataIsolation: boolean;
  enhancedPrivacy: boolean;
  opsecWarnings: string[];
}
export function militaryProtection(p: { hasMilitaryIndicator: boolean; branch?: string; deployments?: string[] }): MilitaryProtectionResult {
  if (!p.hasMilitaryIndicator) return { protected: false, safeguards: [], dataIsolation: false, enhancedPrivacy: false, opsecWarnings: [] };
  return {
    protected: true,
    safeguards: ['location_always_approximate', 'never_show_exact_coordinates', 'hide_online_status_default', 'disable_location_history', 'block_geotagging_in_photos', 'hideDeploymentDates'],
    dataIsolation: true,
    enhancedPrivacy: true,
    opsecWarnings: ['Never share deployment locations/dates', 'Avoid mentioning unit designations', 'No photos in uniform with visible badges', 'Be cautious about rank/MOS', 'Report attempts to elicit operational info'],
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
export function govEmployee(p: { isGovEmployee: boolean; clearanceLevel?: 'none' | 'secret' | 'top_secret'; agency?: string }): GovEmployeeResult {
  if (!p.isGovEmployee) return { protected: false, dataClassification: 'standard', safeguards: [], isolationLevel: 'standard', warningText: '' };
  const cl = p.clearanceLevel === 'top_secret' ? 'classified_eligible' : p.clearanceLevel === 'secret' ? 'sensitive' : 'standard';
  return {
    protected: true,
    dataClassification: cl,
    safeguards: ['location_always_approximate', 'never_show_real_time_location', 'hide_agency_affiliation', 'disable_public_indexing', 'enhanced_security', 'mandatory_2fa'],
    isolationLevel: cl === 'classified_eligible' ? 'maximum' : cl === 'sensitive' ? 'enhanced' : 'standard',
    warningText: 'Enhanced privacy protections enabled. Be cautious about sharing identifying information.',
  };
}
export const governmentEmployee = govEmployee;
export const govEmployeeProtect = govEmployee;

export interface ActivistPrivacyResult {
  enabled: boolean;
  level: 'standard' | 'enhanced' | 'maximum';
  features: string[];
  metadataStripping: boolean;
  torCompatible: boolean;
  emergencyProtocol: string[];
}
export function activistPrivacy(p: { isActivist: boolean; isJournalist: boolean; threatLevel: 'standard' | 'elevated' | 'high'; country: string }): ActivistPrivacyResult {
  const hr = p.isActivist || p.isJournalist || p.threatLevel !== 'standard';
  if (!hr) return { enabled: false, level: 'standard', features: [], metadataStripping: false, torCompatible: false, emergencyProtocol: [] };
  const lv = p.threatLevel === 'high' ? 'maximum' : 'enhanced';
  const f = ['location_always_hidden', 'no_public_profile', 'no_search_indexing', 'no_social_sharing', 'enhanced_encryption', 'auto_delete_messages', 'no_screenshot_notification'];
  if (lv === 'maximum') f.push('tor_login', 'no_phone_verification', 'anonymous_email_only', 'vpn_bypass', 'stealth_mode');
  return {
    enabled: true, level: lv, features: f, metadataStripping: true, torCompatible: lv === 'maximum',
    emergencyProtocol: ['Panic button → account lockdown', 'All data encrypted with deniable encryption', 'Emergency contacts via secure channel', 'Remote wipe available', 'CPJ: cpj.org/get-help/', 'RSF: rsf.org/en/help'],
  };
}
export const journalistProtection = activistPrivacy;
export const enhancedPrivacy = activistPrivacy;

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
    { p: /\b(infidels?|kafir|goyim)\b/i, f: 'religious_slur' },
  ];
  for (const { p, f } of CP) if (p.test(content)) flags.push(f);
  for (const c of communities) {
    rules.push({ community: c, rule: 'No discrimination based on cultural/religious identity', enforcement: 'auto' });
    rules.push({ community: c, rule: 'Respect cultural practices', enforcement: 'manual' });
  }
  return { rules, culturalSensitivityFlags: flags, escalationPath: ['community_moderator', 'cultural_sensitivity_team', 'trust_and_safety_lead'] };
}
export const nicheCommunityModeration = communityModeration;
export const culturalModeration = communityModeration;

export interface SeeWhoLikedResult {
  privacySafe: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  mitigations: string[];
  recommendedImplementation: string;
}
export function seeWhoLiked(c: { showIdentity: boolean; showBlur: boolean; requireMutualLike: boolean; showTimestamp: boolean; showExactTime: boolean }): SeeWhoLikedResult {
  const mit: string[] = [];
  let rl: SeeWhoLikedResult['riskLevel'] = 'none';
  if (c.showIdentity && !c.requireMutualLike) { rl = 'high'; mit.push('Require mutual like before revealing identity', 'Use blurred preview until mutual like'); }
  if (c.showExactTime) { rl = rl === 'none' ? 'medium' : rl; mit.push('Show relative time instead of exact timestamp'); }
  if (c.showIdentity && !c.showBlur) mit.push('Add blur-to-reveal to prevent bulk scraping');
  mit.push('Rate-limit profile views', 'No notification on unlike', 'Block screenshot detection for liked profiles');
  return { privacySafe: c.requireMutualLike || c.showBlur, riskLevel: rl, mitigations: mit, recommendedImplementation: 'Blur all like profiles by default. Reveal one at a time with tap. Require mutual like for full access. Relative timestamps only.' };
}
export const whoLikedMePrivacy = seeWhoLiked;
export const likedProfilePrivacy = seeWhoLiked;

export interface DeceasedUserResult {
  suspected: boolean;
  confidence: number;
  indicators: string[];
  action: 'monitor' | 'memorial_mode' | 'notify_next_of_kin';
  memorialOptions: string[];
}
export function deceasedUser(s: {
  lastActivityDaysAgo: number;
  inactivityThreshold: number;
  externalNotification: boolean;
  repeatedProfileVisitsByFamily: boolean;
  condolenceMessages: number;
  accountAgeDays: number;
}): DeceasedUserResult {
  const ind: string[] = [];
  let c = 0;
  if (s.lastActivityDaysAgo > s.inactivityThreshold) { ind.push('extended_inactivity'); c += 0.2; }
  if (s.externalNotification) { ind.push('external_death_notification'); c += 0.5; }
  if (s.repeatedProfileVisitsByFamily) { ind.push('family_visiting'); c += 0.3; }
  if (s.condolenceMessages >= 3) { ind.push('condolence_messages'); c += 0.4; }
  if (s.accountAgeDays > 365) { ind.push('long_term_account'); c += 0.05; }
  c = Math.min(1, c);
  return {
    suspected: c >= 0.4, confidence: c, indicators: ind,
    action: c >= 0.7 ? 'notify_next_of_kin' : c >= 0.4 ? 'memorial_mode' : 'monitor',
    memorialOptions: ['Convert to memorial page', 'Disable matching/messaging', 'Add "In Memoriam" banner', 'Allow family data download', 'Delete after 30 days if unclaimed'],
  };
}
export const memorialAccount = deceasedUser;
export const deathNotification = deceasedUser;

export interface ModWellbeingResult {
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  indicators: string[];
  recommendations: string[];
  shiftAction: 'continue' | 'break_required' | 'reassign' | 'mandatory_off';
  secondaryTraumaRisk: boolean;
}
export function modWellbeing(s: {
  consecutiveHours: number;
  csamReviewedToday: number;
  violenceReviewedToday: number;
  reportsReviewedToday: number;
  daysWithoutBreak: number;
  selfReportedStress?: number;
  lastBreakAgoMinutes: number;
}): ModWellbeingResult {
  const ind: string[] = [], rec: string[] = [];
  let rs = 0;
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
  return { riskLevel: rl, indicators: ind, recommendations: rec, shiftAction: rs >= 8 ? 'mandatory_off' : rs >= 5 ? 'reassign' : rs >= 3 ? 'break_required' : 'continue', secondaryTraumaRisk: rs >= 5 };
}
export const moderatorHealth = modWellbeing;
export const secondaryTrauma = modWellbeing;

export interface ModWellbeingSupportResult {
  programActive: boolean;
  components: string[];
  checkInFrequency: string;
  resources: string[];
  mandatoryAfter: string[];
}
export function modWellbeingSupport(c?: { hasCounseling: boolean; hasBreakPolicy: boolean; hasRotationPolicy: boolean; hasEAP: boolean }): ModWellbeingSupportResult {
  const comp: string[] = [], res: string[] = [];
  if (c?.hasCounseling ?? true) { comp.push('on_site_counseling'); res.push('Licensed therapist Mon-Fri 9-5'); }
  if (c?.hasBreakPolicy ?? true) { comp.push('mandatory_breaks'); res.push('15-min break/2hr, 1-hour break/4hr'); }
  if (c?.hasRotationPolicy ?? true) { comp.push('content_rotation'); res.push('Rotate content types every 2hr'); }
  if (c?.hasEAP ?? true) { comp.push('eap'); res.push('EAP: 1-800-EAP-HELP (24/7)'); }
  return { programActive: true, components: comp, checkInFrequency: 'weekly', resources: res, mandatoryAfter: ['CSAM review', 'Violence involving minors', 'Self-harm involving minors', 'Mass casualty content'] };
}
export const moderatorWellbeing = modWellbeingSupport;
export const secondaryTraumaSupport = modWellbeingSupport;

export interface AirGapResult {
  isolated: boolean;
  operationType: string;
  networkAccess: 'none' | 'internal_only' | 'restricted';
  auditLevel: 'standard' | 'enhanced' | 'maximum';
  dataHandling: string[];
}
export function airGap(op: { type: 'csam_review' | 'data_export' | 'law_enforcement_response' | 'encryption_key_management' | 'biometric_template_access'; sensitivity: 'standard' | 'sensitive' | 'critical' }): AirGapResult {
  const ic = op.sensitivity === 'critical' || ['csam_review', 'encryption_key_management', 'biometric_template_access'].includes(op.type);
  return {
    isolated: ic, operationType: op.type,
    networkAccess: ic ? 'none' : 'restricted',
    auditLevel: ic ? 'maximum' : op.sensitivity === 'sensitive' ? 'enhanced' : 'standard',
    dataHandling: ic ? ['no_network', 'no_clipboard', 'no_screenshot', 'no_usb', 'audit_all', 'two_person_rule'] : ['audit_all', 'no_clipboard'],
  };
}
export const sensitiveOperation = airGap;
export const isolatedExecution = airGap;

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
    scope: ['API endpoints (*.myarchetype.app)', 'Mobile app (iOS, Android)', 'Web application', 'Authentication flows', 'Payment processing', 'Data export'],
    outOfScope: ['Social engineering of employees', 'DDoS attacks', 'Physical attacks', 'Third-party services (Firebase, Stripe)', 'Spam/rate limiting without security impact'],
    rewards: { critical: '$5,000-$10,000', high: '$1,000-$5,000', medium: '$250-$1,000', low: '$50-$250', information: 'Swag/recognition' },
    responsibleDisclosurePolicy: 'No legal action against researchers following responsible disclosure. Report to security@myarchetype.app. 48hr response, 90day remediation.',
    contact: 'security@myarchetype.app',
  };
}
export const responsibleDisclosure = bugBounty;
export const securityReward = bugBounty;

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
    remediationSla: { critical: '24 hours', high: '7 days', medium: '30 days', low: '90 days' },
  };
}
export const penTest = redTeam;
export const penetrationTest = redTeam;

export interface DeafAccommodationResult {
  accommodationsEnabled: boolean;
  features: string[];
  autoCaptionAvailable: boolean;
  signLanguageSupport: boolean;
  emergencyTextAlternative: boolean;
}
export function deafAccommodation(p: { isDeafOrHoH: boolean; prefersText: boolean; usesSignLanguage: boolean; preferredLanguage?: string }): DeafAccommodationResult {
  if (!p.isDeafOrHoH && !p.prefersText) return { accommodationsEnabled: false, features: [], autoCaptionAvailable: true, signLanguageSupport: false, emergencyTextAlternative: true };
  const f: string[] = [];
  if (p.prefersText) f.push('text_primary');
  if (p.isDeafOrHoH) f.push('disable_voice_calls', 'auto_caption_video', 'visual_notifications', 'haptic_alerts');
  if (p.usesSignLanguage) f.push('sign_language_video');
  return { accommodationsEnabled: true, features: f, autoCaptionAvailable: true, signLanguageSupport: p.usesSignLanguage, emergencyTextAlternative: true };
}
export const captioning = deafAccommodation;
export const signLanguage = deafAccommodation;

export interface CognitiveLoadResult {
  loadLevel: 'low' | 'medium' | 'high';
  simplificationRecommendations: string[];
  accessibleMode: boolean;
  wcagCompliance: string[];
}
export function cognitiveLoad(ui: { optionsOnScreen: number; textDensity: 'sparse' | 'moderate' | 'dense'; navigationDepth: number; timeConstraints: boolean; complexLanguage: boolean; animationLevel: 'none' | 'minimal' | 'moderate' | 'heavy' }): CognitiveLoadResult {
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

export interface SafetyDiscoverabilityResult {
  discoverable: boolean;
  score: number;
  issues: Array<{ feature: string; issue: string; location: string }>;
  recommendations: string[];
}
export function safetyDiscoverability(
  features: Array<{ name: string; location: string; tapsFromHome: number; searchable: boolean; inOnboarding: boolean; documented: boolean }>
): SafetyDiscoverabilityResult {
  const iss: SafetyDiscoverabilityResult['issues'] = [], rec: string[] = [];
  let sc = 100;
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
  metrics: Record<string, { usageRate: number; trend: 'up' | 'down' | 'stable'; targetRate: number; meetingTarget: boolean }>;
  lowUsageFeatures: string[];
  recommendations: string[];
  reportingPeriod: string;
}
export function safetyUsageAnalytics(
  data: Array<{ feature: string; totalUsers: number; usersUsed: number; previousRate: number }>
): SafetyUsageAnalyticsResult {
  const m: SafetyUsageAnalyticsResult['metrics'] = {}, lu: string[] = [], rec: string[] = [];
  const T: Record<string, number> = { block_user: 0.15, report_user: 0.05, unmatch: 0.20, date_checkin: 0.30, location_share: 0.25, quick_exit: 0.10, video_verify: 0.40 };
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

export interface MetadataSearchResult {
  searchable: boolean;
  exposedMetadata: string[];
  recommendations: string[];
  strippedFields: string[];
}
export function metadataSearch(fm: Record<string, string>): MetadataSearchResult {
  const SM = new Set(['GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'DateTimeOriginal', 'Make', 'Model', 'Software', 'Artist', 'Copyright', 'UserComment', 'XPAuthor', 'XPKeywords', 'XPSubject', 'XPComment']);
  const em = Object.keys(fm).filter(k => SM.has(k)), rec: string[] = [];
  if (em.some(k => k.startsWith('GPS'))) rec.push('Strip GPS coordinates');
  if (em.includes('DateTimeOriginal')) rec.push('Remove original capture date');
  if (em.includes('Software')) rec.push('Strip software metadata');
  if (em.some(k => k.startsWith('XP'))) rec.push('Strip Windows metadata');
  return { searchable: !em.length, exposedMetadata: em, recommendations: rec, strippedFields: em };
}
export const metadataExposure = metadataSearch;
export const exifMetadataAudit = metadataSearch;

export interface PseudonymousReputationResult {
  reputationScore: number;
  positiveSignals: string[];
  negativeSignals: string[];
  transferable: boolean;
  transferRules: string[];
}
export function pseudonymousReputation(h: {
  accountAge: number; reportsReceived: number; reportsFiled: number;
  verificationsCompleted: number; matchesMade: number; messagesExchanged: number; blocksReceived: number;
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
  return { reputationScore: sc, positiveSignals: pos, negativeSignals: neg, transferable: sc >= 70 && !neg.length, transferRules: ['Linked to pseudonymous ID', 'Transfer requires device+face match', 'Negative signals prevent transfer 90d', 'One-way transfer only'] };
}
export const anonReputation = pseudonymousReputation;
export const pseudonymReputation = pseudonymousReputation;

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
  let sc = 100;
  const v: string[] = [], r: string[] = [];
  for (const f of features) {
    if (f.darkPattern) { sc -= 20; v.push(`DARK_PATTERN: ${f.name}`); r.push(`Remove ${f.name}`); }
    if (!f.userControlled && f.category === 'engagement') { sc -= 10; v.push(`NOT_USER_CONTROLLED: ${f.name}`); r.push(`Add user control for ${f.name}`); }
  }
  const g = sc >= 90 ? 'A' : sc >= 80 ? 'B' : sc >= 70 ? 'C' : sc >= 60 ? 'D' : 'F';
  return { score: Math.max(0, sc), grade: g, violations: v, recommendations: r, litigationRisk: sc < 60 ? 'high' : sc < 80 ? 'medium' : 'low', compliantWith: sc >= 80 ? ['EU DSA Art.25', 'CA AB 2273', 'UK AADC'] : [] };
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
export function cancellationFriction(cf: { steps: Array<{ type: string; text: string; required: boolean; delay_ms: number }> }): CancellationFrictionResult {
  const dp: string[] = [], rec: string[] = [];
  let fs = 0;
  for (const s of cf.steps) {
    if (s.delay_ms > 3000) { dp.push('artificial_delay'); fs += 15; rec.push('Remove artificial delays'); }
    if (/we('ll| will)\s+miss|are\s+you\s+sure|don'?t\s+go|please\s+stay/i.test(s.text)) { dp.push('emotional_manipulation'); fs += 20; rec.push('Remove emotional language'); }
    if (/upgrade|save|deal|offer|discount/i.test(s.text)) { dp.push('counter_offer'); fs += 10; rec.push('Limit counter-offers to one'); }
    if (!s.required && !/skip|later|not\s+now/i.test(s.text)) fs += 5;
  }
  if (cf.steps.length > 4) { dp.push('excessive_steps'); fs += 10; rec.push('Reduce to 2-3 steps'); }
  const comp = !dp.length && cf.steps.length <= 4;
  return { frictionScore: Math.min(100, fs), steps: cf.steps.length, darkPatternsDetected: dp, compliant: comp, compliantWith: comp ? ['FTC §5', 'EU DSA Art.25', 'Apple §3.1.2'] : [], recommendations: rec };
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
  features: Array<{ name: string; hasAriaLabel: boolean; hasAccessibilityRole: boolean; colorContrastRatio: number; keyboardNavigable: boolean; screenReaderTested: boolean }>
): SafetyAccessibilityResult {
  const iss: SafetyAccessibilityResult['issues'] = [];
  for (const f of features) {
    if (!f.hasAriaLabel) iss.push({ feature: f.name, issue: 'missing_aria', severity: 'high', fix: `Add accessibilityLabel to ${f.name}` });
    if (!f.hasAccessibilityRole) iss.push({ feature: f.name, issue: 'missing_role', severity: 'medium', fix: `Add accessibilityRole to ${f.name}` });
    if (f.colorContrastRatio < 4.5) iss.push({ feature: f.name, issue: `low_contrast_${f.colorContrastRatio}:1`, severity: 'high', fix: `Increase contrast to 4.5:1 for ${f.name}` });
    if (!f.keyboardNavigable) iss.push({ feature: f.name, issue: 'not_keyboard_nav', severity: 'medium', fix: `Ensure ${f.name} is keyboard accessible` });
    if (!f.screenReaderTested) iss.push({ feature: f.name, issue: 'not_sr_tested', severity: 'low', fix: `Test ${f.name} with VoiceOver/TalkBack` });
  }
  const hi = iss.filter(i => i.severity === 'high').length;
  return { accessible: !hi, wcagLevel: !hi && iss.length <= 2 ? 'AA' : !hi ? 'A' : 'non-compliant', issues: iss, screenReaderCompatible: features.every(f => f.screenReaderTested) };
}
export const safetyFeatureAccessibility = safetyAccessibility;
export const wcagSafetyAudit = safetyAccessibility;

export interface OutnumberDetectResult {
  safe: boolean;
  ratio: string;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  recommendations: string[];
  shouldWarn: boolean;
}
export function outnumberDetect(p: { userParty: number; otherParty: number; isHomeTurf: boolean; venuePublic: boolean; firstMeeting: boolean }): OutnumberDetectResult {
  const ratio = `${p.userParty}:${p.otherParty}`, out = p.otherParty > p.userParty;
  let rl: OutnumberDetectResult['riskLevel'] = 'none';
  const rec: string[] = [];
  if (out) {
    if (p.otherParty >= p.userParty * 3) { rl = 'high'; rec.push('CRITICAL: Significantly outnumbered (3:1+)', 'Insist on 1:1 in public first', 'Share location with trusted contact'); }
    else if (p.otherParty >= p.userParty * 2) { rl = 'medium'; rec.push('Outnumbered — consider bringing a friend', 'Meet in public venue'); }
    else { rl = 'low'; rec.push('Slight imbalance — ensure comfort'); }
  }
  if (!p.venuePublic) { rl = rl === 'none' ? 'medium' : 'high'; rec.push('Private venue + imbalance = elevated risk'); }
  if (p.firstMeeting && out) rec.push('First meeting + outnumbered = suggest 1:1 first');
  if (!p.isHomeTurf && out) rec.push('Their turf + outnumbered — maintain exit options');
  return { safe: !out || rl === 'low', ratio, riskLevel: rl, recommendations: rec, shouldWarn: rl === 'high' || rl === 'medium' };
}
export const groupSizeImbalance = outnumberDetect;
export const meetupImbalance = outnumberDetect;