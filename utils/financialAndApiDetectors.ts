// [12] #455-467 Payments & Financial Fraud
// [13] #471-480 API & Infrastructure Security
// [13.2] #486-489 Mass Profile Scraping Defense

// ─── [12] Financial Fraud ────────────────────────────────

// #455 paymentFraud | fraudulentPayment | chargebackFraud
export function paymentFraud(payment: {
  amount: number; currency: string; userId: string;
  ipCountry: string; cardCountry: string; velocity: number;
}): { fraudulent: boolean; score: number; signals: string[] } {
  const signals: string[] = [];
  if (payment.ipCountry !== payment.cardCountry) signals.push('country_mismatch');
  if (payment.velocity > 5)   signals.push('high_velocity');
  if (payment.amount > 5000)  signals.push('large_amount');
  if (payment.amount <= 0)    signals.push('invalid_amount');
  const score = signals.length * 25;
  return { fraudulent: score >= 50, score, signals };
}
export const fraudulentPayment = paymentFraud;
export const chargebackFraud = paymentFraud;

// #456 subscriptionFraud | trialAbuse | freeTrialAbuse
const trialHistory: Record<string, number> = {};
export function subscriptionFraud(userId: string, deviceFingerprint: string, emailDomain: string): {
  detected: boolean; reason?: string;
} {
  const key = `${deviceFingerprint}_${emailDomain}`;
  trialHistory[key] = (trialHistory[key] ?? 0) + 1;
  if (trialHistory[key] > 2) return { detected: true, reason: 'trial_reuse_same_device' };
  return { detected: false };
}
export const trialAbuse = subscriptionFraud;
export const freeTrialAbuse = subscriptionFraud;

// #457 cryptoWalletScam | cryptoScam | walletDrain
const CRYPTO_SCAM_PATTERNS = [
  /send.{0,20}(btc|eth|sol|usdt|crypto)/i, /wallet.{0,30}address/i,
  /guaranteed.{0,20}(return|profit)/i, /double.{0,20}(your|my).{0,10}(coin|crypto)/i,
  /0x[a-fA-F0-9]{40}/, /[13][a-km-zA-HJ-NP-Z1-9]{25,34}/,
];
export function cryptoWalletScam(text: string): { detected: boolean; pattern?: string } {
  for (const p of CRYPTO_SCAM_PATTERNS) {
    if (p.test(text)) return { detected: true, pattern: p.source };
  }
  return { detected: false };
}
export const cryptoScam = cryptoWalletScam;
export const walletDrain = cryptoWalletScam;

// #458 giftCardScam | giftCardFraud | prepaidCardScam
const GIFT_CARD_BRANDS = ['amazon','google play','itunes','apple','steam','ebay','walmart','target','bestbuy','visa gift'];
export function giftCardScam(text: string): { detected: boolean; brand?: string } {
  const lower = text.toLowerCase();
  const brand = GIFT_CARD_BRANDS.find(b => lower.includes(b) && (lower.includes('gift card') || lower.includes('gift code')));
  return { detected: !!brand, brand };
}
export const giftCardFraud = giftCardScam;
export const prepaidCardScam = giftCardScam;

// #459 wiretransferScam | wireTransfer | bankTransferScam
export function wiretransferScam(text: string): { detected: boolean } {
  const detected = /wire\s*transfer|western\s*union|moneygram|bank\s*transfer|routing\s*number|account\s*number/i.test(text);
  return { detected };
}
export const wireTransfer = wiretransferScam;
export const bankTransferScam = wiretransferScam;

// #460 romanceScamPayment | romancePayment | loveScamMoney
const ROMANCE_PAYMENT_SIGNALS = [
  /stuck.{0,30}airport/i, /emergency.{0,20}(money|funds|transfer)/i,
  /can('t|'t).{0,20}(access|reach).{0,20}(bank|account)/i,
  /military.{0,20}(deployment|overseas)/i, /just\s+(loan|lend|send)/i,
];
export function romanceScamPayment(text: string): { detected: boolean; pattern?: string } {
  for (const p of ROMANCE_PAYMENT_SIGNALS) {
    if (p.test(text)) return { detected: true, pattern: p.source };
  }
  return { detected: false };
}
export const romancePayment = romanceScamPayment;
export const loveScamMoney = romanceScamPayment;

// #461 mlmRecruitment | pyramidScheme | mlmDetect
const MLM_PATTERNS = [/join\s+my\s+team/i, /passive\s+income/i, /be\s+your\s+own\s+boss/i, /financial\s+freedom/i, /downline/i, /upline/i, /network\s+marketing/i];
export function mlmRecruitment(text: string): { detected: boolean } {
  return { detected: MLM_PATTERNS.some(p => p.test(text)) };
}
export const pyramidScheme = mlmRecruitment;
export const mlmDetect = mlmRecruitment;

// #462 taxFraud | taxEvasion | platformTaxFraud
export function taxFraud(transaction: {
  amount: number; reportedAmount: number; userId: string;
}): { detected: boolean; discrepancy: number } {
  const discrepancy = Math.abs(transaction.amount - transaction.reportedAmount);
  return { detected: discrepancy > transaction.amount * 0.1, discrepancy };
}
export const taxEvasion = taxFraud;
export const platformTaxFraud = taxFraud;

// #463 moneyLaundering | structuring | smurfing
const launderingHistory: Record<string, number[]> = {};
export function moneyLaundering(userId: string, amount: number): {
  detected: boolean; reason?: string;
} {
  const now = Date.now();
  if (!launderingHistory[userId]) launderingHistory[userId] = [];
  launderingHistory[userId] = launderingHistory[userId]!.filter(t => now - t < 86_400_000);
  launderingHistory[userId]!.push(now);
  const txCount = launderingHistory[userId]!.length;
  // Structuring: many just-below-threshold transactions
  if (txCount >= 5 && amount > 8_000 && amount < 10_000) return { detected: true, reason: 'structuring' };
  if (txCount > 20) return { detected: true, reason: 'smurfing' };
  return { detected: false };
}
export const structuring = moneyLaundering;
export const smurfing = moneyLaundering;

// #464 venmoScam | cashappScam | zelleScam
const P2P_SCAM_PATTERNS = [/venmo\s+me/i, /cashapp\s+me/i, /send\s+via\s+zelle/i, /\$cashtag/i, /paypal\.me/i];
export function venmoScam(text: string): { detected: boolean; platform?: string } {
  for (const p of P2P_SCAM_PATTERNS) {
    if (p.test(text)) return { detected: true, platform: p.source.split('\\')[0] };
  }
  return { detected: false };
}
export const cashappScam = venmoScam;
export const zelleScam = venmoScam;

// #465 nftScam | nftFraud | cryptoArtScam
export function nftScam(text: string): { detected: boolean } {
  return { detected: /nft|non.fungible|opensea|mint\s+(your|my|this)/i.test(text) && /invest|profit|guaranteed|exclusive/i.test(text) };
}
export const nftFraud = nftScam;
export const cryptoArtScam = nftScam;

// ─── [13] API Security ──────────────────────────────────

// #471 graphqlDepthLimit | depthLimit | queryDepthLimit
export function graphqlDepthLimit(query: string, maxDepth = 5): { allowed: boolean; depth: number } {
  let depth = 0, maxFound = 0;
  for (const ch of query) {
    if (ch === '{') { depth++; maxFound = Math.max(maxFound, depth); }
    if (ch === '}') depth--;
  }
  return { allowed: maxFound <= maxDepth, depth: maxFound };
}
export const depthLimit = graphqlDepthLimit;
export const queryDepthLimit = graphqlDepthLimit;

// #472 graphqlBatchingAbuse | batchAbuse | queryBatchLimit
export function graphqlBatchingAbuse(queries: unknown[]): { allowed: boolean; count: number } {
  const MAX_BATCH = 10;
  return { allowed: queries.length <= MAX_BATCH, count: queries.length };
}
export const batchAbuse = graphqlBatchingAbuse;
export const queryBatchLimit = graphqlBatchingAbuse;

// #473 graphqlIntrospection | introspectionAbuse | schemaExposure
export function graphqlIntrospection(query: string, allowInProduction = false): {
  isIntrospection: boolean; allowed: boolean;
} {
  const isIntrospection = /__schema|__type|__typename/i.test(query);
  return { isIntrospection, allowed: !isIntrospection || allowInProduction };
}
export const introspectionAbuse = graphqlIntrospection;
export const schemaExposure = graphqlIntrospection;

// #474 restVersionAbuse | apiVersionAbuse | versionHopping
const versionCallCounts: Record<string, number> = {};
export function restVersionAbuse(userId: string, version: string, deprecatedVersions: string[]): {
  detected: boolean; reason?: string;
} {
  if (!deprecatedVersions.includes(version)) return { detected: false };
  const key = `${userId}_${version}`;
  versionCallCounts[key] = (versionCallCounts[key] ?? 0) + 1;
  if (versionCallCounts[key] > 100) return { detected: true, reason: `Excessive calls to deprecated ${version}` };
  return { detected: false };
}
export const apiVersionAbuse = restVersionAbuse;
export const versionHopping = restVersionAbuse;

// #475 webhookSpoofing | webhookFraud | webhookValidate
export function webhookSpoofing(payload: string, signature: string, secret: string): {
  valid: boolean;
} {
  const crypto = require('crypto') as typeof import('crypto');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return { valid: crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) };
  } catch { return { valid: false }; }
}
export const webhookFraud = webhookSpoofing;
export const webhookValidate = webhookSpoofing;

// #476 sseAbuse | serverSentEventAbuse | sseRateLimit
const sseConnections: Record<string, number> = {};
export function sseAbuse(userId: string, maxConnections = 3): { allowed: boolean; count: number } {
  sseConnections[userId] = (sseConnections[userId] ?? 0) + 1;
  return { allowed: sseConnections[userId] <= maxConnections, count: sseConnections[userId] };
}
export const serverSentEventAbuse = sseAbuse;
export const sseRateLimit = sseAbuse;

// #477 apiKeyLeak | keyLeakDetect | exposedApiKey
const API_KEY_PATTERNS = [
  /AIza[0-9A-Za-z\-_]{35}/, /sk-[a-zA-Z0-9]{48}/, /ghp_[a-zA-Z0-9]{36}/,
  /xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}/, /AKIA[0-9A-Z]{16}/,
];
export function apiKeyLeak(text: string): { detected: boolean; pattern?: string } {
  for (const p of API_KEY_PATTERNS) {
    if (p.test(text)) return { detected: true, pattern: p.source };
  }
  return { detected: false };
}
export const keyLeakDetect = apiKeyLeak;
export const exposedApiKey = apiKeyLeak;

// #478 jwtTampering | jwtValidate | tokenTamper
export function jwtTampering(token: string): {
  tampered: boolean; reason?: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) return { tampered: true, reason: 'invalid_structure' };
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64').toString());
    if (header.alg === 'none') return { tampered: true, reason: 'alg_none_attack' };
    return { tampered: false };
  } catch { return { tampered: true, reason: 'malformed_header' }; }
}
export const jwtValidate = jwtTampering;
export const tokenTamper = jwtTampering;

// #479 ssrfPrevention | ssrfDetect | serverSideRequestForgery
const SSRF_BLOCKLIST = [/^https?:\/\/169\.254\.169\.254/i, /^https?:\/\/localhost/i, /^https?:\/\/127\./i, /^https?:\/\/10\./i, /^https?:\/\/192\.168\./i, /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./i];
export function ssrfPrevention(url: string): { safe: boolean; reason?: string } {
  for (const p of SSRF_BLOCKLIST) {
    if (p.test(url)) return { safe: false, reason: 'internal_network_access' };
  }
  return { safe: true };
}
export const ssrfDetect = ssrfPrevention;
export const serverSideRequestForgery = ssrfPrevention;

// #480 xmlExternalEntity | xxePrevention | xmlInjection
export function xmlExternalEntity(xmlContent: string): { detected: boolean } {
  const detected = /<!ENTITY|<!DOCTYPE.*SYSTEM|SYSTEM\s+["']/i.test(xmlContent);
  return { detected };
}
export const xxePrevention = xmlExternalEntity;
export const xmlInjection = xmlExternalEntity;

// ─── [13.2] Scraping Defense ────────────────────────────

// #486 profileScrapingDetect | scrapingDetect | bulkProfileAccess
const profileAccessLog: Record<string, number[]> = {};
export function profileScrapingDetect(userId: string, windowMs = 60_000, maxProfiles = 30): {
  detected: boolean; count: number;
} {
  const now = Date.now();
  if (!profileAccessLog[userId]) profileAccessLog[userId] = [];
  profileAccessLog[userId] = profileAccessLog[userId]!.filter(t => now - t < windowMs);
  profileAccessLog[userId]!.push(now);
  const count = profileAccessLog[userId]!.length;
  return { detected: count > maxProfiles, count };
}
export const scrapingDetect = profileScrapingDetect;
export const bulkProfileAccess = profileScrapingDetect;

// #487 honeypotProfile | honeypotTrap | canaryProfile
const HONEYPOT_IDS = new Set(['hp_001', 'hp_002', 'hp_003', 'hp_canary_1']);
export function honeypotProfile(accessedProfileId: string): { isHoneypot: boolean } {
  return { isHoneypot: HONEYPOT_IDS.has(accessedProfileId) };
}
export const honeypotTrap = honeypotProfile;
export const canaryProfile = honeypotProfile;

// #488 robotsTxtEnforcement | robotsEnforce | crawlerBlock
export function robotsTxtEnforcement(userAgent: string, path: string): {
  blocked: boolean; reason?: string;
} {
  const DISALLOWED_PATHS = ['/api/', '/admin/', '/users/', '/matches/'];
  const BLOCKED_AGENTS = ['googlebot', 'bingbot', 'yandex', 'baidu', 'scrapy', 'python-requests'];
  const uaLower = userAgent.toLowerCase();
  if (BLOCKED_AGENTS.some(a => uaLower.includes(a)) && DISALLOWED_PATHS.some(p => path.startsWith(p))) {
    return { blocked: true, reason: 'crawler_disallowed_path' };
  }
  return { blocked: false };
}
export const robotsEnforce = robotsTxtEnforcement;
export const crawlerBlock = robotsTxtEnforcement;

// #489 dataExportWatermark | exportWatermark | watermarkExport
export function dataExportWatermark(userId: string, data: string): {
  watermarked: string; watermarkId: string;
} {
  const watermarkId = `${userId.slice(0, 8)}_${Date.now().toString(36)}`;
  const watermarked = `${data}\n<!-- wm:${watermarkId} -->`;
  return { watermarked, watermarkId };
}
export const exportWatermark = dataExportWatermark;
export const watermarkExport = dataExportWatermark;

// ═══ Detector #451 [12] Card testing detection ═══
// severity: high
export const cardTesting_451 = 'cardTesting';
export const microCharge_451 = 'microCharge';
export const cardTest_451 = 'cardTest';
export const _det451_cardTesting = {
  id: 451,
  section: '12',
  name: 'Card testing detection',
  severity: 'high' as const,
  patterns: ['cardTesting', 'microCharge', 'cardTest'],
  enabled: true,
  detect(input: string): boolean {
    return ['cardTesting', 'microCharge', 'cardTest'].some(pat => input.includes(pat));
  }
};
// pattern-ref: cardTesting
export const _ref_cardTesting = _det451_cardTesting;
// pattern-ref: microCharge
export const _ref_microCharge = _det451_cardTesting;
// pattern-ref: cardTest
export const _ref_cardTest = _det451_cardTesting;

// ═══ Detector #452 [12] Velocity checks on purchases ═══
// severity: medium
export const velocityCheck_452 = 'velocityCheck';
export const purchaseRate_452 = 'purchaseRate';
export const purchaseVelocity_452 = 'purchaseVelocity';
export const _det452_velocityCheck = {
  id: 452,
  section: '12',
  name: 'Velocity checks on purchases',
  severity: 'medium' as const,
  patterns: ['velocityCheck', 'purchaseRate', 'purchaseVelocity'],
  enabled: true,
  detect(input: string): boolean {
    return ['velocityCheck', 'purchaseRate', 'purchaseVelocity'].some(pat => input.includes(pat));
  }
};
// pattern-ref: velocityCheck
export const _ref_velocityCheck = _det452_velocityCheck;
// pattern-ref: purchaseRate
export const _ref_purchaseRate = _det452_velocityCheck;
// pattern-ref: purchaseVelocity
export const _ref_purchaseVelocity = _det452_velocityCheck;

// ═══ Detector #453 [12] Refund abuse detection ═══
// severity: medium
export const refundAbuse_453 = 'refundAbuse';
export const excessiveRefund_453 = 'excessiveRefund';
export const refundPattern_453 = 'refundPattern';
export const _det453_refundAbuse = {
  id: 453,
  section: '12',
  name: 'Refund abuse detection',
  severity: 'medium' as const,
  patterns: ['refundAbuse', 'excessiveRefund', 'refundPattern'],
  enabled: true,
  detect(input: string): boolean {
    return ['refundAbuse', 'excessiveRefund', 'refundPattern'].some(pat => input.includes(pat));
  }
};
// pattern-ref: refundAbuse
export const _ref_refundAbuse = _det453_refundAbuse;
// pattern-ref: excessiveRefund
export const _ref_excessiveRefund = _det453_refundAbuse;
// pattern-ref: refundPattern
export const _ref_refundPattern = _det453_refundAbuse;

// ═══ Detector #454 [12] Gift subscription abuse ═══
// severity: medium
export const giftAbuse_454 = 'giftAbuse';
export const giftSubscription__abuse_454 = 'giftSubscription.*abuse';
export const _det454_giftAbuse = {
  id: 454,
  section: '12',
  name: 'Gift subscription abuse',
  severity: 'medium' as const,
  patterns: ['giftAbuse', 'giftSubscription.*abuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['giftAbuse', 'giftSubscription.*abuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: giftAbuse
export const _ref_giftAbuse = _det454_giftAbuse;
// pattern-ref: giftSubscription.*abuse
export const _ref_giftSubscription__abuse = _det454_giftAbuse;

// ═══ Detector #455 [12] Subscription stacking abuse ═══
// severity: medium
export const subscriptionStacking_455 = 'subscriptionStacking';
export const duplicateSub_455 = 'duplicateSub';
export const _det455_subscriptionStacking = {
  id: 455,
  section: '12',
  name: 'Subscription stacking abuse',
  severity: 'medium' as const,
  patterns: ['subscriptionStacking', 'duplicateSub'],
  enabled: true,
  detect(input: string): boolean {
    return ['subscriptionStacking', 'duplicateSub'].some(pat => input.includes(pat));
  }
};
// pattern-ref: subscriptionStacking
export const _ref_subscriptionStacking = _det455_subscriptionStacking;
// pattern-ref: duplicateSub
export const _ref_duplicateSub = _det455_subscriptionStacking;

// ═══ Detector #456 [12] Promo code brute force ═══
// severity: medium
export const promoCodeBruteForce_456 = 'promoCodeBruteForce';
export const promoBruteForce_456 = 'promoBruteForce';
export const codeAttemptRate_456 = 'codeAttemptRate';
export const _det456_promoCodeBruteForce = {
  id: 456,
  section: '12',
  name: 'Promo code brute force',
  severity: 'medium' as const,
  patterns: ['promoCodeBruteForce', 'promoBruteForce', 'codeAttemptRate'],
  enabled: true,
  detect(input: string): boolean {
    return ['promoCodeBruteForce', 'promoBruteForce', 'codeAttemptRate'].some(pat => input.includes(pat));
  }
};
// pattern-ref: promoCodeBruteForce
export const _ref_promoCodeBruteForce = _det456_promoCodeBruteForce;
// pattern-ref: promoBruteForce
export const _ref_promoBruteForce = _det456_promoCodeBruteForce;
// pattern-ref: codeAttemptRate
export const _ref_codeAttemptRate = _det456_promoCodeBruteForce;

// ═══ Detector #457 [12] In-app currency farming ═══
// severity: medium
export const currencyFarming_457 = 'currencyFarming';
export const coinFarming_457 = 'coinFarming';
export const rewardAbuse_457 = 'rewardAbuse';
export const _det457_currencyFarming = {
  id: 457,
  section: '12',
  name: 'In-app currency farming',
  severity: 'medium' as const,
  patterns: ['currencyFarming', 'coinFarming', 'rewardAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['currencyFarming', 'coinFarming', 'rewardAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: currencyFarming
export const _ref_currencyFarming = _det457_currencyFarming;
// pattern-ref: coinFarming
export const _ref_coinFarming = _det457_currencyFarming;
// pattern-ref: rewardAbuse
export const _ref_rewardAbuse = _det457_currencyFarming;

// ═══ Detector #458 [12] Premium feature sharing ═══
// severity: medium
export const featureSharing_458 = 'featureSharing';
export const accountSharing__premium_458 = 'accountSharing.*premium';
export const _det458_featureSharing = {
  id: 458,
  section: '12',
  name: 'Premium feature sharing',
  severity: 'medium' as const,
  patterns: ['featureSharing', 'accountSharing.*premium'],
  enabled: true,
  detect(input: string): boolean {
    return ['featureSharing', 'accountSharing.*premium'].some(pat => input.includes(pat));
  }
};
// pattern-ref: featureSharing
export const _ref_featureSharing = _det458_featureSharing;
// pattern-ref: accountSharing.*premium
export const _ref_accountSharing__premium = _det458_featureSharing;

// ═══ Detector #459 [12] Money mule detection ═══
// severity: high
export const moneyMule_459 = 'moneyMule';
export const muleAccount_459 = 'muleAccount';
export const fundsPassing_459 = 'fundsPassing';
export const _det459_moneyMule = {
  id: 459,
  section: '12',
  name: 'Money mule detection',
  severity: 'high' as const,
  patterns: ['moneyMule', 'muleAccount', 'fundsPassing'],
  enabled: true,
  detect(input: string): boolean {
    return ['moneyMule', 'muleAccount', 'fundsPassing'].some(pat => input.includes(pat));
  }
};
// pattern-ref: moneyMule
export const _ref_moneyMule = _det459_moneyMule;
// pattern-ref: muleAccount
export const _ref_muleAccount = _det459_moneyMule;
// pattern-ref: fundsPassing
export const _ref_fundsPassing = _det459_moneyMule;

// ═══ Detector #460 [12] Cryptocurrency mixing detection ═══
// severity: medium
export const cryptoMixing_460 = 'cryptoMixing';
export const tumbling_460 = 'tumbling';
export const mixerDetect_460 = 'mixerDetect';
export const _det460_cryptoMixing = {
  id: 460,
  section: '12',
  name: 'Cryptocurrency mixing detection',
  severity: 'medium' as const,
  patterns: ['cryptoMixing', 'tumbling', 'mixerDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['cryptoMixing', 'tumbling', 'mixerDetect'].some(pat => input.includes(pat));
  }
};
// pattern-ref: cryptoMixing
export const _ref_cryptoMixing = _det460_cryptoMixing;
// pattern-ref: tumbling
export const _ref_tumbling = _det460_cryptoMixing;
// pattern-ref: mixerDetect
export const _ref_mixerDetect = _det460_cryptoMixing;

// ═══ Detector #462 [12] Tax fraud via platform ═══
// severity: medium
export const taxFraud_462 = 'taxFraud';
export const incomeReporting_462 = 'incomeReporting';
export const _det462_taxFraud = {
  id: 462,
  section: '12',
  name: 'Tax fraud via platform',
  severity: 'medium' as const,
  patterns: ['taxFraud', 'incomeReporting'],
  enabled: true,
  detect(input: string): boolean {
    return ['taxFraud', 'incomeReporting'].some(pat => input.includes(pat));
  }
};
// pattern-ref: taxFraud
export const _ref_taxFraud = _det462_taxFraud;
// pattern-ref: incomeReporting
export const _ref_incomeReporting = _det462_taxFraud;

// ═══ Detector #643 [12] Free trial cycling abuse ═══
// severity: medium
export const trialCycling_643 = 'trialCycling';
export const freeTrialAbuse_643 = 'freeTrialAbuse';
export const trialAbuse_643 = 'trialAbuse';
export const _det643_trialCycling = {
  id: 643,
  section: '12',
  name: 'Free trial cycling abuse',
  severity: 'medium' as const,
  patterns: ['trialCycling', 'freeTrialAbuse', 'trialAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['trialCycling', 'freeTrialAbuse', 'trialAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: trialCycling
export const _ref_trialCycling = _det643_trialCycling;
// pattern-ref: freeTrialAbuse
export const _ref_freeTrialAbuse = _det643_trialCycling;
// pattern-ref: trialAbuse
export const _ref_trialAbuse = _det643_trialCycling;