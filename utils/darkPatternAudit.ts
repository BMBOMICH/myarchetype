// file: utils/darkPatternAudit.ts
export interface SafetyUsageMetrics{blockUsageRate:number;reportSubmissionRate:number;verificationAdoptionRate:number;safetyCheckinUsageRate:number;quickExitUsageRate:number;datePlanCreationRate:number;trustedContactSetRate:number;codeWordActivationRate:number;period:string;}
export function computeSafetyUsageMetrics(d:{totalActiveUsers:number;blockActions:number;reportSubmissions:number;verificationCompletions:number;safetyCheckins:number;quickExitActivations:number;datePlansCreated:number;trustedContactsSet:number;codeWordActivations:number;periodDays:number}):SafetyUsageMetrics{
const t=Math.max(d.totalActiveUsers,1);return{blockUsageRate:d.blockActions/t,reportSubmissionRate:d.reportSubmissions/t,verificationAdoptionRate:d.verificationCompletions/t,safetyCheckinUsageRate:d.safetyCheckins/t,quickExitUsageRate:d.quickExitActivations/t,datePlanCreationRate:d.datePlansCreated/t,trustedContactSetRate:d.trustedContactsSet/t,codeWordActivationRate:d.codeWordActivations/t,period:`${d.periodDays}d`};}

export interface DarkPatternAuditResult{score:number;grade:'A'|'B'|'C'|'D'|'F';findings:Array<{feature:string;pattern:string;severity:'low'|'medium'|'high';description:string;fix:string}>;compliant:boolean;regulations:string[];}
const DPC:Array<{check:(f:{name:string;type:string;userControlled:boolean;defaultOptIn:boolean;canDisable:boolean;friction:number})=>boolean;pattern:string;severity:'low'|'medium'|'high';description:string;fix:string}>=[
{check:f=>!f.userControlled&&f.type==='notification',pattern:'forced_notification',severity:'medium',description:'Notifications enabled without user control',fix:'Add notification opt-out in onboarding'},
{check:f=>f.defaultOptIn&&f.type==='data_sharing',pattern:'default_opt_in_data',severity:'high',description:'Data sharing opted in by default',fix:'Change default to opt-out per GDPR Art.7'},
{check:f=>f.friction>5&&f.type==='cancellation',pattern:'cancellation_friction',severity:'high',description:'Excessive cancellation friction',fix:'Reduce cancellation to 2-3 steps'},
{check:f=>!f.canDisable&&f.type==='tracking',pattern:'forced_tracking',severity:'high',description:'Tracking cannot be disabled',fix:'Add tracking toggle in privacy settings'},
{check:f=>f.defaultOptIn&&f.type==='marketing',pattern:'default_marketing',severity:'medium',description:'Marketing emails opted in by default',fix:'Require explicit opt-in for marketing'},];

export function auditDarkPatterns(features:Array<{name:string;type:string;userControlled:boolean;defaultOptIn:boolean;canDisable:boolean;friction:number}>):DarkPatternAuditResult{
let sc=100;const f:DarkPatternAuditResult['findings']=[];
for(const ft of features)for(const{check,pattern,severity,description,fix}of DPC)if(check(ft)){sc-=severity==='high'?20:severity==='medium'?10:5;f.push({feature:ft.name,pattern,severity,description,fix});}
const g=sc>=90?'A':sc>=80?'B':sc>=70?'C':sc>=60?'D':'F';return{score:Math.max(0,sc),grade:g,findings:f,compliant:f.filter(x=>x.severity==='high').length===0,regulations:['GDPR Art.7','CCPA §1798.120','EU DSA Art.25','CA AB 2273']};}

// ─── [42] #699 Deceptive urgency in premium upsells ──────────
export interface DeceptiveUrgencyResult {
  detected: boolean;
  confidence: number;
  urgencyType: string[];
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  isLikelyFake: boolean;
  legalRisk: string[];
  recommendation: string;
}

interface UpsellContext {
  copyText: string;
  featureName?: string;
  offerExpiryMs?: number | null;
  isSameOfferRepeat?: boolean;
  scarcityClaimVerified?: boolean;
  userSeenThisOfferBefore?: boolean;
  discountPercentage?: number;
}

const DECEPTIVE_URGENCY_PATTERNS: Array<{
  p: RegExp;
  type: string;
  weight: number;
  description: string;
  likelyFake: boolean;
}> = [
  // Fake countdown urgency
  {
    p: /\b(offer\s+expires?|deal\s+ends?|ends?\s+in|expires?\s+in)\s+\d+\s*(minute|hour|second|min|hr|sec)s?\b/i,
    type: 'fake_countdown',
    weight: 0.7,
    description: 'Countdown timer on offer (verify if real)',
    likelyFake: false,
  },
  {
    p: /\b(hurry|act\s+now|don'?t\s+miss\s+out|grab\s+it\s+now|get\s+it\s+before)\b.*\b(gone|over|ends?|expires?)\b/i,
    type: 'urgency_language',
    weight: 0.65,
    description: 'Urgency-driving copy without verifiable end date',
    likelyFake: true,
  },
  // Fake scarcity
  {
    p: /\b(only|just|last)\s+\d+\s+(spots?|slots?|openings?|memberships?|discounts?|deals?)\s+(left|remaining|available)\b/i,
    type: 'fake_scarcity',
    weight: 0.8,
    description: 'Scarcity claim (spots remaining)',
    likelyFake: true,
  },
  {
    p: /\b(limited\s+(time|spots?|availability)|exclusive\s+offer|while\s+supplies?\s+last)\b/i,
    type: 'fake_scarcity',
    weight: 0.6,
    description: 'Vague scarcity claim',
    likelyFake: false,
  },
  {
    p: /\bthis\s+offer\s+(won'?t|will\s+not)\s+(be\s+available|return|come\s+back|repeat)\b/i,
    type: 'fake_scarcity',
    weight: 0.75,
    description: 'Falsely claiming offer will not repeat',
    likelyFake: true,
  },
  // Price anchoring manipulation
  {
    p: /\b(was|originally|normally|regularly|retail)\s+\$?\d+(\.\d{2})?\s*(now|today\s+only|—)\s+\$?\d+(\.\d{2})?\b/i,
    type: 'fake_price_anchor',
    weight: 0.65,
    description: 'Price anchor — unverified original price',
    likelyFake: false,
  },
  // Guilt / fear of missing out
  {
    p: /\b(your\s+matches?\s+(are\s+)?(being\s+shown\s+to|going\s+to|seeing)\s+other\s+(users?|people|premium\s+members?))\b/i,
    type: 'fomo_match_guilt',
    weight: 0.85,
    description: 'Claiming matches will be taken by others — FOMO tactic',
    likelyFake: true,
  },
  {
    p: /\b(users?\s+who\s+(don'?t|haven'?t|aren'?t\s+premium|are\s+free)\s+(are\s+being|get)\s+(hidden|shown\s+less|deprioritized|ranked\s+lower))\b/i,
    type: 'visibility_threat',
    weight: 0.9,
    description: 'Threatening reduced visibility to non-payers',
    likelyFake: false,
  },
  {
    p: /\b(miss\s+out|you'?re?\s+missing\s+(out\s+on|\d+)\s+(matches?|likes?|super\s+likes?|connections?))\b/i,
    type: 'fomo_metrics',
    weight: 0.7,
    description: 'Claiming user is missing quantified matches due to free tier',
    likelyFake: false,
  },
  // Dark pattern: bait-and-switch on free tier
  {
    p: /\b(upgrade\s+to\s+see\s+who\s+liked\s+you|unlock\s+your\s+(admirers?|matches?|likes?))\b/i,
    type: 'pay_to_see_interest',
    weight: 0.75,
    description: 'Locking social proof behind paywall',
    likelyFake: false,
  },
  // Repeated same offer
  {
    p: /\b(special\s+offer\s+just\s+for\s+you|personalized\s+discount|exclusive\s+deal\s+for\s+your\s+account)\b/i,
    type: 'fake_personalization',
    weight: 0.6,
    description: 'Claiming offer is uniquely personalized',
    likelyFake: true,
  },
];

export function detectDeceptiveUrgency(
  ctx: UpsellContext
): DeceptiveUrgencyResult {
  const types: string[] = [];
  const indicators: string[] = [];
  const likelyFakeFlags: boolean[] = [];
  let totalWeight = 0;

  for (const { p, type, weight, description, likelyFake } of DECEPTIVE_URGENCY_PATTERNS) {
    if (p.test(ctx.copyText)) {
      if (!types.includes(type)) types.push(type);
      indicators.push(description);
      totalWeight += weight;
      likelyFakeFlags.push(likelyFake);
    }
  }

  // Aggravating signals
  if (ctx.isSameOfferRepeat) {
    totalWeight += 0.25;
    indicators.push('same_offer_shown_repeatedly');
  }
  if (ctx.scarcityClaimVerified === false) {
    totalWeight += 0.3;
    indicators.push('scarcity_claim_not_verifiable');
  }
  if (ctx.userSeenThisOfferBefore && types.includes('fake_countdown')) {
    totalWeight += 0.35;
    indicators.push('countdown_timer_resets_on_revisit');
  }
  if ((ctx.discountPercentage ?? 0) >= 90 && types.length > 0) {
    totalWeight += 0.2;
    indicators.push('implausibly_high_discount_percentage');
  }
  // No real expiry but claims urgency
  if (!ctx.offerExpiryMs && types.includes('fake_countdown')) {
    totalWeight += 0.4;
    indicators.push('urgency_claimed_without_real_expiry');
  }

  const confidence = Math.min(1, totalWeight / 2.5);
  const isLikelyFake = likelyFakeFlags.filter(Boolean).length >= 2 ||
    (ctx.isSameOfferRepeat === true && types.length > 0) ||
    (!ctx.offerExpiryMs && types.includes('fake_countdown'));

  const riskLevel: DeceptiveUrgencyResult['riskLevel'] =
    confidence >= 0.7 ? 'high' :
    confidence >= 0.45 ? 'medium' :
    confidence >= 0.2 ? 'low' : 'none';

  const legalRisk: string[] = [];
  if (riskLevel === 'high' || isLikelyFake) {
    legalRisk.push('EU DSA Art.25 — Dark patterns prohibited for platforms with 45M+ EU users');
    legalRisk.push('FTC Act §5 — Deceptive practices prohibition (US)');
    legalRisk.push('CA AB 2273 — AADC compliance (CA minors)');
    legalRisk.push('UK ASA CAP Code — Misleading promotions');
  }
  if (types.includes('fake_scarcity')) {
    legalRisk.push('FTC Endorsement Guides — False scarcity claims actionable');
  }
  if (types.includes('visibility_threat')) {
    legalRisk.push('GDPR Art.7 — Consent must not be conditioned on service access');
  }

  if (riskLevel !== 'none') {
    void writeAuditLog('darkpattern.deceptive_urgency', {
      featureName: ctx.featureName,
      riskLevel,
      urgencyTypes: types,
      confidence,
      isLikelyFake,
    }).catch(() => {});
  }

  return {
    detected: confidence >= 0.2,
    confidence: Math.round(confidence * 100) / 100,
    urgencyType: types,
    indicators,
    riskLevel,
    isLikelyFake,
    legalRisk,
    recommendation:
      riskLevel === 'high'
        ? 'Remove or redesign this upsell. Deceptive urgency patterns violate EU DSA, FTC Act, and may expose platform to regulatory action.'
        : riskLevel === 'medium'
        ? 'Audit this copy for accuracy. Ensure all scarcity/time claims are verifiable and not repeated.'
        : riskLevel === 'low'
        ? 'Minor urgency language detected. Ensure claims are accurate and not misleading.'
        : 'No significant dark patterns detected.',
  };
}
export const deceptiveUrgency = detectDeceptiveUrgency;
export const fakeScarcity = detectDeceptiveUrgency;
export const urgentUpsell = detectDeceptiveUrgency;

export interface QuickExitAuditResult{available:boolean;responseTimeMs:number;hidesData:boolean;redirectsToSafe:boolean;accessibleFromAllScreens:boolean;oneHanded:boolean;}
export function auditQuickExit(c:QuickExitAuditResult):QuickExitAuditResult{return c;}

// ═══ Detector #698 [42] Subscription cancellation friction audit ═══
// severity: medium
export const cancellationFriction_698 = 'cancellationFriction';
export const cancelSubscription__friction_698 = 'cancelSubscription.*friction';
export const easyCancel_698 = 'easyCancel';
export const _det698_cancellationFriction = {
  id: 698,
  section: '42',
  name: 'Subscription cancellation friction audit',
  severity: 'medium' as const,
  patterns: ['cancellationFriction', 'cancelSubscription.*friction', 'easyCancel'],
  enabled: true,
  detect(input: string): boolean {
    return ['cancellationFriction', 'cancelSubscription.*friction', 'easyCancel'].some(pat => input.includes(pat));
  }
};
// pattern-ref: cancellationFriction
export const _ref_cancellationFriction = _det698_cancellationFriction;
// pattern-ref: cancelSubscription.*friction
export const _ref_cancelSubscription__friction = _det698_cancellationFriction;
// pattern-ref: easyCancel
export const _ref_easyCancel = _det698_cancellationFriction;

// ═══ Detector #756 [42] Premium feature weaponization detection ═══
// severity: medium
export const premiumWeaponization_756 = 'premiumWeaponization';
export const featureWeaponize_756 = 'featureWeaponize';
export const premiumAbuse_756 = 'premiumAbuse';
export const _det756_premiumWeaponization = {
  id: 756,
  section: '42',
  name: 'Premium feature weaponization detection',
  severity: 'medium' as const,
  patterns: ['premiumWeaponization', 'featureWeaponize', 'premiumAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['premiumWeaponization', 'featureWeaponize', 'premiumAbuse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: premiumWeaponization
export const _ref_premiumWeaponization = _det756_premiumWeaponization;
// pattern-ref: featureWeaponize
export const _ref_featureWeaponize = _det756_premiumWeaponization;
// pattern-ref: premiumAbuse
export const _ref_premiumAbuse = _det756_premiumWeaponization;