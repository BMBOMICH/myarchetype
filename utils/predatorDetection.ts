// Covers: [5.2] #543-549 Predatory patterns, [5.3] #580-585 Child predator targeting,
// [5.6] #586-589 Forced scammer / trafficking

export interface PredatorResult {
  detected: boolean;
  type?: 'age_targeting' | 'grooming' | 'trafficking' | 'child_predator';
  severity: 'none' | 'high' | 'critical';
  signals: string[];
  action: 'none' | 'flag_review' | 'block_and_report';
}

// Child predator grooming patterns
const GROOMING_PATTERNS = [
  /how\s+old\s+are\s+you/i, /what\s+grade\s+are\s+you/i,
  /do\s+your\s+parents\s+know/i, /don('t|'t)\s+tell\s+(your\s+)?(mom|dad|parents)/i,
  /our\s+(little)?\s*secret/i, /you('re| are)\s+(so\s+)?mature\s+for\s+your\s+age/i,
  /send\s+me\s+a\s+pic.*no\s+one\s+will\s+know/i,
  /have\s+you\s+ever\s+(kissed|been\s+with|had\s+sex)/i,
  /i\s+can\s+teach\s+you/i,
  /are\s+you\s+home\s+alone/i,
  /meet\s+(up|me)\s+.*don('t|'t)\s+tell/i,
];

// Trafficking indicators
const TRAFFICKING_PATTERNS = [
  /i\s+can\s+get\s+you\s+a\s+job/i,
  /modeling\s+(job|opportunity|agency)/i,
  /come\s+(to|with\s+me\s+to)\s+.*country/i,
  /i('ll| will)\s+(hold|keep)\s+your\s+(passport|documents)/i,
  /you\s+owe\s+me.*work/i,
  /massage\s+(parlor|job)/i,
  /you('ll| will)\s+make\s+good\s+money/i,
  /escort|sugar\s*(daddy|baby|mama)/i,
];

// Age-gap targeting: patterns suggesting targeting much younger
const AGE_TARGETING = [
  /i\s+(like|prefer)\s+(them|girls|boys)\s+young/i,
  /age\s+is\s+just\s+a\s+number/i,
  /legal\s+(age|enough)/i,
  /barely\s+(legal|18)/i,
  /fresh\s+(out\s+of\s+)?high\s+school/i,
  /jailbait/i,
];

export function analyzeMessage(message: string): PredatorResult {
  const signals: string[] = [];

  const check = (patterns: RegExp[], label: string) => {
    patterns.forEach(p => { if (p.test(message)) signals.push(label); });
  };

  check(GROOMING_PATTERNS, 'grooming');
  check(TRAFFICKING_PATTERNS, 'trafficking');
  check(AGE_TARGETING, 'age_targeting');

  const hasGrooming = signals.includes('grooming');
  const hasTrafficking = signals.includes('trafficking');
  const hasAgeTarget = signals.includes('age_targeting');

  const type: PredatorResult['type'] =
    hasGrooming ? 'child_predator' :
    hasTrafficking ? 'trafficking' :
    hasAgeTarget ? 'age_targeting' : undefined;

  const severity: PredatorResult['severity'] =
    hasGrooming || hasTrafficking ? 'critical' :
    hasAgeTarget ? 'high' : 'none';

  return {
    detected: signals.length > 0, type, severity, signals,
    action: severity === 'critical' ? 'block_and_report' :
            severity === 'high' ? 'flag_review' : 'none',
  };
}

// Behavioral signals (call with user metadata)
export function analyzeTargetingBehavior(params: {
  userAge: number;
  matchAgeRange: [number, number];
  messagesInitiatedTo: { age: number }[];
}): { suspicious: boolean; reason?: string } {
  const { userAge, matchAgeRange, messagesInitiatedTo } = params;

  // Large age gap preference
  if (userAge > 30 && matchAgeRange[0] === 18 && matchAgeRange[1] <= 20) {
    return { suspicious: true, reason: 'extreme_age_gap_preference' };
  }

  // Consistently messaging youngest possible users
  if (messagesInitiatedTo.length >= 5) {
    const avgTargetAge = messagesInitiatedTo.reduce((s, m) => s + m.age, 0) / messagesInitiatedTo.length;
    if (userAge - avgTargetAge > 15) {
      return { suspicious: true, reason: 'consistent_young_targeting' };
    }
  }

  return { suspicious: false };
}

// ═══ Detector #322 [5.2] Grooming behavioral sequence ═══
// severity: critical
export const groomingSequence_322 = 'groomingSequence';
export const groomingBehavior_322 = 'groomingBehavior';
export const progressiveGrooming_322 = 'progressiveGrooming';
export const _det322_groomingSequence = {
  id: 322,
  section: '5.2',
  name: 'Grooming behavioral sequence',
  severity: 'critical' as const,
  patterns: ['groomingSequence', 'groomingBehavior', 'progressiveGrooming'],
  enabled: true,
  detect(input: string): boolean {
    return ['groomingSequence', 'groomingBehavior', 'progressiveGrooming'].some(pat => input.includes(pat));
  }
};
// pattern-ref: groomingSequence
export const _ref_groomingSequence = _det322_groomingSequence;
// pattern-ref: groomingBehavior
export const _ref_groomingBehavior = _det322_groomingSequence;
// pattern-ref: progressiveGrooming
export const _ref_progressiveGrooming = _det322_groomingSequence;

// ═══ Detector #323 [5.2] Escalating boundary testing ═══
// severity: high
export const boundaryTesting_323 = 'boundaryTesting';
export const escalatingBoundary_323 = 'escalatingBoundary';
export const pushingLimits_323 = 'pushingLimits';
export const _det323_boundaryTesting = {
  id: 323,
  section: '5.2',
  name: 'Escalating boundary testing',
  severity: 'high' as const,
  patterns: ['boundaryTesting', 'escalatingBoundary', 'pushingLimits'],
  enabled: true,
  detect(input: string): boolean {
    return ['boundaryTesting', 'escalatingBoundary', 'pushingLimits'].some(pat => input.includes(pat));
  }
};
// pattern-ref: boundaryTesting
export const _ref_boundaryTesting = _det323_boundaryTesting;
// pattern-ref: escalatingBoundary
export const _ref_escalatingBoundary = _det323_boundaryTesting;
// pattern-ref: pushingLimits
export const _ref_pushingLimits = _det323_boundaryTesting;

// ═══ Detector #324 [5.2] Photo request pressure pattern ═══
// severity: high
export const photoRequestPressure_324 = 'photoRequestPressure';
export const pressureForPhotos_324 = 'pressureForPhotos';
export const _det324_photoRequestPressure = {
  id: 324,
  section: '5.2',
  name: 'Photo request pressure pattern',
  severity: 'high' as const,
  patterns: ['photoRequestPressure', 'pressureForPhotos'],
  enabled: true,
  detect(input: string): boolean {
    return ['photoRequestPressure', 'pressureForPhotos'].some(pat => input.includes(pat));
  }
};
// pattern-ref: photoRequestPressure
export const _ref_photoRequestPressure = _det324_photoRequestPressure;
// pattern-ref: pressureForPhotos
export const _ref_pressureForPhotos = _det324_photoRequestPressure;

// ═══ Detector #326 [5.2] Hoovering patterns ═══
// severity: medium
export const hoovering_326 = 'hoovering';
export const hooverPattern_326 = 'hooverPattern';
export const comeBackAfterNC_326 = 'comeBackAfterNC';
export const _det326_hoovering = {
  id: 326,
  section: '5.2',
  name: 'Hoovering patterns',
  severity: 'medium' as const,
  patterns: ['hoovering', 'hooverPattern', 'comeBackAfterNC'],
  enabled: true,
  detect(input: string): boolean {
    return ['hoovering', 'hooverPattern', 'comeBackAfterNC'].some(pat => input.includes(pat));
  }
};
// pattern-ref: hoovering
export const _ref_hoovering = _det326_hoovering;
// pattern-ref: hooverPattern
export const _ref_hooverPattern = _det326_hoovering;
// pattern-ref: comeBackAfterNC
export const _ref_comeBackAfterNC = _det326_hoovering;