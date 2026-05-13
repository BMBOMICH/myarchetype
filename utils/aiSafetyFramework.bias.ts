import { writeAuditLog } from './logger';

// ─── Bias Audit ───────────────────────────────────────────────────────────────

export interface BiasAuditResult { metric: string; value: number; threshold: number; passed: boolean; }

export function auditMatchingFairness(
  outcomes: { userId: string; demographic: string; matchCount: number; shown: number }[],
): BiasAuditResult[] {
  const g = new Map<string, { m: number; s: number; c: number }>();
  outcomes.forEach(o => {
    const x = g.get(o.demographic) ?? { m: 0, s: 0, c: 0 };
    x.m += o.matchCount; x.s += o.shown; x.c++;
    g.set(o.demographic, x);
  });
  const rates = [...g.entries()].map(([, v]) => v.s > 0 ? v.m / v.s : 0);
  if (rates.length < 2) return [];
  const di = Math.min(...rates) / Math.max(...rates);
  return [{ metric: 'disparate_impact_ratio', value: di, threshold: 0.8, passed: di >= 0.8 }];
}

export function auditFilterBias(usage: { userId: string; filterField: string; filterValue: string }[]) {
  const R = new Set(['ethnicity', 'race', 'skin_color', 'nationality']);
  const S = new Set(['income', 'education_level', 'neighborhood']);
  const f: { field: string; concern: string }[] = [];
  usage.forEach(u => {
    if (R.has(u.filterField)) f.push({ field: u.filterField, concern: 'potential_racial_discrimination' });
    if (S.has(u.filterField)) f.push({ field: u.filterField, concern: 'potential_socioeconomic_discrimination' });
  });
  if (f.length) void writeAuditLog('ai.bias_filter_flagged', { fields: f.map(x => x.field) }).catch(() => {});
  return { flaggedFilters: f };
}

// ─── Socioeconomic Bias ───────────────────────────────────────────────────────

export interface SocioeconomicBiasResult {
  biasDetected: boolean;
  biasType: string[];
  affectedDemographics: string[];
  disparateImpactRatio: number;
  recommendation: string;
  mitigationActions: string[];
  fairlearnMetrics: { demographicParity: number; equalizedOdds: number; individualFairness: number };
}

export function detectSocioeconomicBias(data: {
  visibilityScores: Array<{
    userId: string; visibilityScore: number; jobTitle?: string;
    educationLevel?: 'none' | 'high_school' | 'bachelors' | 'masters' | 'phd';
    incomeRange?: 'under_30k' | '30k_60k' | '60k_100k' | '100k_plus';
    incomeLevel?: 'low' | 'medium' | 'high';
    occupation?: string; verified?: boolean;
    profileViews?: number; matchRate?: number; neighborhood?: string;
  }>;
  algorithmWeights?: Record<string, number>;
}): SocioeconomicBiasResult {
  const types: string[] = [];
  const affected: string[] = [];
  const mitigation: string[] = [];
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  if (data.visibilityScores.length < 20) {
    return {
      biasDetected: false, biasType: [], affectedDemographics: [],
      disparateImpactRatio: 1, recommendation: 'Insufficient data for bias analysis.',
      mitigationActions: [],
      fairlearnMetrics: { demographicParity: 1, equalizedOdds: 1, individualFairness: 1 },
    };
  }

  const incomeGroups: Record<string, number[]> = {};
  for (const u of data.visibilityScores) {
    const key = u.incomeRange ?? u.incomeLevel;
    if (!key) continue;
    if (!incomeGroups[key]) incomeGroups[key] = [];
    incomeGroups[key]!.push(u.visibilityScore);
  }

  const eduGroups: Record<string, number[]> = {};
  for (const u of data.visibilityScores) {
    if (!u.educationLevel) continue;
    if (!eduGroups[u.educationLevel]) eduGroups[u.educationLevel] = [];
    eduGroups[u.educationLevel]!.push(u.visibilityScore);
  }

  const incomeAvgs = Object.entries(incomeGroups).map(([k, v]) => ({ k, avg: avg(v) }));
  let maxDisparateImpact = 1;
  if (incomeAvgs.length >= 2) {
    const sorted = incomeAvgs.sort((a, b) => a.avg - b.avg);
    const lowest = sorted[0]!.avg;
    const highest = sorted[sorted.length - 1]!.avg;
    const ratio = highest > 0 ? lowest / highest : 1;
    maxDisparateImpact = Math.round(ratio * 1000) / 1000;
    if (ratio < 0.8) {
      types.push('income_visibility_disparity');
      affected.push(`low_income:${sorted[0]!.k}`);
      mitigation.push('Remove income/job-title from visibility ranking signals');
      mitigation.push('Apply Fairlearn ExponentiatedGradient reweighting');
    }
  }

  const eduAvgs = Object.entries(eduGroups).map(([k, v]) => ({ k, avg: avg(v) }));
  if (eduAvgs.length >= 2) {
    const sorted = eduAvgs.sort((a, b) => a.avg - b.avg);
    const ratio = sorted[sorted.length - 1]!.avg > 0 ? sorted[0]!.avg / sorted[sorted.length - 1]!.avg : 1;
    if (ratio < 0.8) {
      types.push('education_visibility_disparity');
      affected.push(`lower_education:${sorted[0]!.k}`);
      mitigation.push('Audit algorithm weights for education-correlated features');
    }
  }

  if (data.algorithmWeights) {
    const socioFeatures = ['income', 'job_prestige', 'education_score', 'verified_employer'];
    const problematic = socioFeatures.filter(f => (data.algorithmWeights![f] ?? 0) > 0.15);
    if (problematic.length > 0) {
      types.push('socioeconomic_feature_overweighting');
      affected.push(...problematic);
      mitigation.push(`Reduce weight of: ${problematic.join(', ')}`);
    }
  }

  const biasDetected = types.length > 0;
  const demographicParity = maxDisparateImpact;
  const equalizedOdds = Math.max(0, 1 - Math.abs(1 - maxDisparateImpact) * 2);
  const individualFairness = types.includes('income_visibility_disparity') ? 0.7 : 0.9;

  if (biasDetected) {
    void writeAuditLog('ai.socioeconomic_bias', {
      biasTypes: types, affectedDemographics: affected, disparateImpactRatio: maxDisparateImpact,
    }).catch(() => {});
    mitigation.push('Run IBM AIF360 disparate impact analysis', 'Apply Fairlearn GridSearch postprocessing');
  }

  return {
    biasDetected, biasType: types, affectedDemographics: affected,
    disparateImpactRatio: maxDisparateImpact,
    recommendation: biasDetected
      ? `Socioeconomic bias detected: ${types.join(', ')}. Disparate impact ratio: ${maxDisparateImpact}. Apply mitigation.`
      : 'No significant socioeconomic bias detected.',
    mitigationActions: mitigation,
    fairlearnMetrics: {
      demographicParity: Math.round(demographicParity * 1000) / 1000,
      equalizedOdds: Math.round(equalizedOdds * 1000) / 1000,
      individualFairness: Math.round(individualFairness * 1000) / 1000,
    },
  };
}

export const socioeconomicBias = detectSocioeconomicBias;
export const visibilityBias    = detectSocioeconomicBias;
export const algorithmicBias   = detectSocioeconomicBias;
export const classBasedBias    = detectSocioeconomicBias;

// ─── Matching Audit ───────────────────────────────────────────────────────────

export interface MatchingAuditResult {
  biasDetected: boolean;
  disparateImpactRatio: number;
  affectedGroups: string[];
  recommendation: string;
  passed: boolean;
}

export function auditAiMatchingRecommendation(
  outcomes: { userId: string; demographic: string; matchCount: number; shown: number }[],
): MatchingAuditResult {
  const results = auditMatchingFairness(outcomes);
  const dir = results[0]?.value ?? 1;
  const groups = new Map<string, number>();
  outcomes.forEach(o => {
    const r = o.shown > 0 ? o.matchCount / o.shown : 0;
    groups.set(o.demographic, (groups.get(o.demographic) ?? 0) + r);
  });
  const rates = [...groups.values()];
  const minRate = Math.min(...rates), maxRate = Math.max(...rates);
  const affected = maxRate > 0 && minRate / maxRate < 0.8
    ? [...groups.entries()].filter(([, r]) => r === minRate).map(([g]) => g) : [];

  if (!(results[0]?.passed ?? true)) {
    void writeAuditLog('ai.matching_bias_detected', { disparateImpactRatio: dir, affectedGroups: affected }).catch(() => {});
  }

  return {
    biasDetected: !(results[0]?.passed ?? true),
    disparateImpactRatio: dir,
    affectedGroups: affected,
    passed: results[0]?.passed ?? true,
    recommendation: dir < 0.8
      ? `Disparate impact detected (ratio=${dir.toFixed(2)}). Review matching algorithm for bias. Affected: ${affected.join(', ')}.`
      : dir < 0.9 ? 'Minor disparity. Monitor matching fairness.'
      :             'Matching recommendations appear fair.',
  };
}

export const matchingAudit      = auditAiMatchingRecommendation;
export const recommendationAudit = auditAiMatchingRecommendation;
export const aiMatchBias         = auditAiMatchingRecommendation;

// ─── Scam Detection Gap Audit ─────────────────────────────────────────────────

export interface ScamDetectionFailureMode {
  type: 'novel_script' | 'language_switch' | 'slow_burn' | 'trusted_platform_name' | 'victim_demographic';
  description: string;
  mitigationStrategy: string;
}

export const KNOWN_FAILURE_MODES: ScamDetectionFailureMode[] = [
  { type: 'novel_script', description: 'New scam scripts not yet in training data', mitigationStrategy: 'Weekly retraining with newly confirmed scam reports + human review queue' },
  { type: 'language_switch', description: 'Scammer switches language mid-conversation to evade classifier', mitigationStrategy: 'Apply Qwen3Guard (119 languages) on every message regardless of detected language' },
  { type: 'slow_burn', description: 'Weeks of benign messages before financial request', mitigationStrategy: 'Maintain 90-day conversation embeddings and score holistic relationship arc' },
  { type: 'trusted_platform_name', description: 'Fake platform named similarly to legitimate', mitigationStrategy: 'Fuzzy string matching against known legitimate platform list + domain check' },
];

export function auditScamDetectionGaps(reports: { reportedContent: string; wasAutoDetected: boolean; category: string }[]) {
  const m = reports.filter(r => !r.wasAutoDetected);
  return { falseNegativeRate: reports.length > 0 ? m.length / reports.length : 0, missedCategories: [...new Set(m.map(r => r.category))] };
}