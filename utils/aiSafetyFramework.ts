import { writeAuditLog } from './logger';
const fetchSafe = async (u: string, o: RequestInit, t = 8000) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), t); try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); } };

export interface AiFeatureConsent { userId: string; featureId: string; featureName: string; description: string; dataUsed: string[]; consentedAt: Date | null; withdrawnAt: Date | null; optOut: boolean; }
export const AI_FEATURES_REQUIRING_CONSENT: Omit<AiFeatureConsent, 'userId'|'consentedAt'|'withdrawnAt'|'optOut'>[] = [
  { featureId:'match_algorithm', featureName:'AI Match Recommendations', description:'We use AI to suggest compatible matches based on your profile, behavior, and preferences.', dataUsed:['profile_data','swipe_history','message_patterns'] },
  { featureId:'compatibility_score', featureName:'Compatibility Scoring', description:'AI-generated compatibility scores shown on profiles.', dataUsed:['quiz_answers','profile_data'] },
  { featureId:'content_moderation', featureName:'Automated Content Review', description:'AI automatically reviews messages and photos for safety violations.', dataUsed:['messages','photos'] },
  { featureId:'behavioral_analysis', featureName:'Safety Behavioral Analysis', description:'We analyze interaction patterns to detect potential scammers or unsafe users.', dataUsed:['message_patterns','login_patterns','engagement_data'] },
];

export function enforceAiOptOut(userId: string, featureId: string, records: AiFeatureConsent[]) {
  const r = records.find(x => x.userId === userId && x.featureId === featureId);
  if (!r) return { allowed: false, reason: 'no_consent_record' };
  if (r.optOut) return { allowed: false, reason: 'user_opted_out' };
  if (!r.consentedAt) return { allowed: false, reason: 'consent_not_given' };
  if (r.withdrawnAt) return { allowed: false, reason: 'consent_withdrawn' };
  return { allowed: true };
}


export interface AdversarialExampleResult {
  detected: boolean;
  perturbationType: string[];
  confidence: number;
  action: 'allow' | 'flag' | 'block';
  indicators: string[];
  recommendation: string;
}

export function detectAdversarialExample(input: {
  pixelVarianceScore?: number;       // unusually low = smoothed perturbation
  highFrequencyNoise?: number;       // FGSM/PGD artifacts
  colorSpaceAnomaly?: number;        // unusual color distribution
  compressionArtifactLevel?: number; // unusual JPEG artifacts
  text?: string;
  unicodeAnomalyScore?: number;      // invisible chars, homoglyphs
  semanticInconsistencyScore?: number; // meaning vs classifier mismatch
  modelConfidenceDelta?: number;     // confidence drop vs baseline
  ensembleDisagreement?: number;     // multiple models disagree
  predictionVarianceUnderNoise?: number; // unstable under small perturbations
  inputType: 'image' | 'text' | 'multimodal';
}): AdversarialExampleResult {
  const types: string[] = [];
  const indicators: string[] = [];
  let confidence = 0;

  if (input.inputType === 'image' || input.inputType === 'multimodal') {
    if ((input.pixelVarianceScore ?? 1) < 0.05) {
      types.push('pixel_smoothing_attack');
      indicators.push('abnormally_low_pixel_variance');
      confidence += 0.3;
    }
    if ((input.highFrequencyNoise ?? 0) > 0.7) {
      types.push('fgsm_pgd_perturbation');
      indicators.push('high_frequency_noise_pattern');
      confidence += 0.35;
    }
    if ((input.colorSpaceAnomaly ?? 0) > 0.6) {
      types.push('color_space_manipulation');
      indicators.push('color_distribution_anomaly');
      confidence += 0.25;
    }
    if ((input.compressionArtifactLevel ?? 0) > 0.8) {
      types.push('compression_artifact_injection');
      indicators.push('unusual_compression_artifacts');
      confidence += 0.2;
    }
  }

  if (input.inputType === 'text' || input.inputType === 'multimodal') {
    if ((input.unicodeAnomalyScore ?? 0) > 0.5) {
      types.push('unicode_perturbation');
      indicators.push('invisible_or_homoglyph_characters');
      confidence += 0.3;
    }
    if ((input.semanticInconsistencyScore ?? 0) > 0.6) {
      types.push('semantic_adversarial');
      indicators.push('meaning_classifier_mismatch');
      confidence += 0.35;
    }
  }

  if ((input.modelConfidenceDelta ?? 0) > 0.4) {
    types.push('confidence_manipulation');
    indicators.push('large_confidence_delta_from_baseline');
    confidence += 0.3;
  }
  if ((input.ensembleDisagreement ?? 0) > 0.5) {
    types.push('ensemble_evasion');
    indicators.push('high_model_disagreement');
    confidence += 0.35;
  }
  if ((input.predictionVarianceUnderNoise ?? 0) > 0.6) {
    types.push('unstable_prediction');
    indicators.push('high_prediction_variance_under_noise');
    confidence += 0.25;
  }

  confidence = Math.min(1, confidence);
  const action: AdversarialExampleResult['action'] =
    confidence >= 0.7 ? 'block' :
    confidence >= 0.4 ? 'flag' : 'allow';

  if (action !== 'allow') {
    void writeAuditLog('ai.adversarial_example', {
      inputType: input.inputType, perturbationTypes: types, confidence, action,
    }).catch(() => {});
  }

  return {
    detected: confidence >= 0.3,
    perturbationType: types,
    confidence: Math.round(confidence * 100) / 100,
    action,
    indicators,
    recommendation:
      action === 'block'
        ? 'High-confidence adversarial input. Block and log for ART/Foolbox analysis.'
        : action === 'flag'
        ? 'Possible adversarial input. Flag for human review.'
        : 'Input appears clean.',
  };
}
export const adversarialExample = detectAdversarialExample;
export const adversarialDetect = detectAdversarialExample;
export const artDetection = detectAdversarialExample;

export interface ConfidenceCalibrationResult {
  calibrated: boolean;
  rawConfidence: number;
  calibratedConfidence: number;
  method: 'temperature_scaling' | 'platt_scaling' | 'isotonic' | 'passthrough';
  expectedCalibrationError: number;
  reliabilityBin: string;
  recommendation: string;
}

export function calibrateModelConfidence(
  rawConfidence: number,
  options: {
    temperature?: number;       // > 1 = softer, < 1 = sharper
    plattA?: number;            // Platt scaling parameter A
    plattB?: number;            // Platt scaling parameter B
    method?: 'temperature_scaling' | 'platt_scaling' | 'isotonic' | 'passthrough';
    historicalECE?: number;     // Expected Calibration Error from eval
  } = {}
): ConfidenceCalibrationResult {
  const method = options.method ?? 'temperature_scaling';
  const temp = options.temperature ?? 1.5;
  let calibrated = rawConfidence;

  if (method === 'temperature_scaling') {
    const logit = Math.log(rawConfidence / Math.max(1 - rawConfidence, 1e-9));
    const scaledLogit = logit / temp;
    calibrated = 1 / (1 + Math.exp(-scaledLogit));
  } else if (method === 'platt_scaling') {
    const A = options.plattA ?? -1.5;
    const B = options.plattB ?? 0.5;
    calibrated = 1 / (1 + Math.exp(A * rawConfidence + B));
  } else if (method === 'isotonic') {
    calibrated = Math.max(0.05, Math.min(0.95, rawConfidence * 0.9));
  }

  calibrated = Math.max(0, Math.min(1, calibrated));
  const ece = options.historicalECE ?? Math.abs(calibrated - rawConfidence) * 0.5;

  const bin = calibrated >= 0.9 ? 'very_high' :
    calibrated >= 0.7 ? 'high' :
    calibrated >= 0.5 ? 'medium' :
    calibrated >= 0.3 ? 'low' : 'very_low';

  const isCalibrated = ece < 0.1;

  return {
    calibrated: isCalibrated,
    rawConfidence: Math.round(rawConfidence * 1000) / 1000,
    calibratedConfidence: Math.round(calibrated * 1000) / 1000,
    method,
    expectedCalibrationError: Math.round(ece * 1000) / 1000,
    reliabilityBin: bin,
    recommendation:
      ece >= 0.15
        ? `ECE ${ece.toFixed(3)} too high. Retrain calibration with Netcal or temperature re-tuning.`
        : ece >= 0.1
        ? 'Moderate calibration error. Monitor and consider re-calibration.'
        : 'Model confidence well calibrated.',
  };
}
export const confidenceCalibration = calibrateModelConfidence;
export const calibrateModel = calibrateModelConfidence;
export const temperatureScaling = calibrateModelConfidence;

export interface DriftMonitorResult {
  driftDetected: boolean;
  driftScore: number;
  affectedDetectors: string[];
  action: 'none' | 'alert' | 'retrain' | 'rollback';
  driftType: string[];
  recommendation: string;
}

export function monitorDistributionShift(metrics: Array<{
  detectorId: string;
  baselineDistribution: number[];  // e.g., confidence histogram bins
  currentDistribution: number[];
  baselineFpr: number;
  currentFpr: number;
  baselineFnr: number;
  currentFnr: number;
  sampleSize: number;
}>): DriftMonitorResult {
  const affected: string[] = [];
  const driftTypes: string[] = [];
  let maxDrift = 0;

  for (const m of metrics) {
    let detectorDrift = 0;
    const localTypes: string[] = [];

    const fprDelta = Math.abs(m.currentFpr - m.baselineFpr);
    if (fprDelta > 0.05) {
      localTypes.push('fpr_drift');
      detectorDrift = Math.max(detectorDrift, fprDelta);
    }

    const fnrDelta = Math.abs(m.currentFnr - m.baselineFnr);
    if (fnrDelta > 0.05) {
      localTypes.push('fnr_drift');
      detectorDrift = Math.max(detectorDrift, fnrDelta);
    }

    if (m.baselineDistribution.length === m.currentDistribution.length) {
      let klDiv = 0;
      for (let i = 0; i < m.baselineDistribution.length; i++) {
        const p = Math.max(m.baselineDistribution[i]!, 1e-9);
        const q = Math.max(m.currentDistribution[i]!, 1e-9);
        klDiv += p * Math.log(p / q);
      }
      if (klDiv > 0.1) {
        localTypes.push('input_distribution_shift');
        detectorDrift = Math.max(detectorDrift, Math.min(klDiv, 1));
      }
    }

    if (detectorDrift > 0.05) {
      affected.push(m.detectorId);
      driftTypes.push(...localTypes.filter(t => !driftTypes.includes(t)));
      maxDrift = Math.max(maxDrift, detectorDrift);
    }
  }

  const action: DriftMonitorResult['action'] =
    maxDrift >= 0.3 ? 'rollback' :
    maxDrift >= 0.2 ? 'retrain' :
    maxDrift >= 0.1 ? 'alert' : 'none';

  if (action !== 'none') {
    void writeAuditLog('ai.distribution_shift', {
      affectedDetectors: affected, maxDrift, action, driftTypes,
    }).catch(() => {});
  }

  return {
    driftDetected: affected.length > 0,
    driftScore: Math.round(maxDrift * 100) / 100,
    affectedDetectors: affected,
    action,
    driftType: driftTypes,
    recommendation:
      action === 'rollback'
        ? 'Critical drift. Roll back to previous model version immediately.'
        : action === 'retrain'
        ? `Significant drift in: ${affected.join(', ')}. Retrain with Evidently AI monitoring.`
        : action === 'alert'
        ? 'Moderate drift detected. Increase monitoring frequency.'
        : 'No significant distribution shift detected.',
  };
}
export const distributionShift = monitorDistributionShift;
export const modelDrift = monitorDistributionShift;
export const driftMonitor = monitorDistributionShift;

export interface DetectorDriftResult {
  drifted: boolean;
  detectorId: string;
  fprDelta: number;
  fnrDelta: number;
  precisionDelta: number;
  recallDelta: number;
  driftSeverity: 'none' | 'minor' | 'moderate' | 'severe';
  action: 'none' | 'alert' | 'retrain' | 'disable';
  recommendation: string;
}

export function monitorDetectorDrift(metrics: Array<{
  detectorId: string;
  baselineFpr: number;
  currentFpr: number;
  baselineFnr: number;
  currentFnr: number;
  baselinePrecision?: number;
  currentPrecision?: number;
  baselineRecall?: number;
  currentRecall?: number;
  windowDays?: number;
}>): DetectorDriftResult[] {
  return metrics.map(m => {
    const fprDelta = Math.abs(m.currentFpr - m.baselineFpr);
    const fnrDelta = Math.abs(m.currentFnr - m.baselineFnr);
    const precDelta = m.baselinePrecision !== undefined && m.currentPrecision !== undefined
      ? Math.abs(m.currentPrecision - m.baselinePrecision) : 0;
    const recDelta = m.baselineRecall !== undefined && m.currentRecall !== undefined
      ? Math.abs(m.currentRecall - m.baselineRecall) : 0;

    const maxDelta = Math.max(fprDelta, fnrDelta, precDelta, recDelta);
    const severity: DetectorDriftResult['driftSeverity'] =
      maxDelta >= 0.15 ? 'severe' :
      maxDelta >= 0.08 ? 'moderate' :
      maxDelta >= 0.03 ? 'minor' : 'none';

    const action: DetectorDriftResult['action'] =
      severity === 'severe' ? 'disable' :
      severity === 'moderate' ? 'retrain' :
      severity === 'minor' ? 'alert' : 'none';

    if (action !== 'none') {
      void writeAuditLog('ai.detector_drift', {
        detectorId: m.detectorId, severity, fprDelta, fnrDelta, action,
      }).catch(() => {});
    }

    return {
      drifted: severity !== 'none',
      detectorId: m.detectorId,
      fprDelta: Math.round(fprDelta * 1000) / 1000,
      fnrDelta: Math.round(fnrDelta * 1000) / 1000,
      precisionDelta: Math.round(precDelta * 1000) / 1000,
      recallDelta: Math.round(recDelta * 1000) / 1000,
      driftSeverity: severity,
      action,
      recommendation:
        action === 'disable'
          ? `Detector ${m.detectorId} severely drifted. Disable and retrain immediately.`
          : action === 'retrain'
          ? `Detector ${m.detectorId} moderately drifted. Schedule retraining with Evidently AI.`
          : action === 'alert'
          ? `Detector ${m.detectorId} showing minor drift. Monitor closely.`
          : `Detector ${m.detectorId} is stable.`,
    };
  });
}
export const detectorDriftMonitor = monitorDetectorDrift;
export const driftDetection = monitorDetectorDrift;

export interface AiIcebreakerSafetyResult {
  safe: boolean;
  issues: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  filteredContent: string;
  recommendation: string;
  duoGuardCategory?: string;
}

const ICEBREAKER_UNSAFE_PATTERNS: Array<{
  p: RegExp;
  issue: string;
  severity: 'low' | 'medium' | 'high';
  category: string;
}> = [
  {
    p: /\b(sex|nude|hook\s*up|dtf|nsfw|body|hot|attractive)\b/i,
    issue: 'sexual_opener',
    severity: 'high',
    category: 'sexual_content',
  },
  {
    p: /\b(money|invest|crypto|bitcoin|opportunity|income|earn)\b/i,
    issue: 'financial_solicitation',
    severity: 'high',
    category: 'financial_scam',
  },
  {
    p: /\b(whatsapp|telegram|snapchat|instagram|kik|discord)\b/i,
    issue: 'platform_redirect',
    severity: 'medium',
    category: 'off_platform',
  },
  {
    p: /\b(you\s+look\s+(easy|desperate|lonely|needy))\b/i,
    issue: 'manipulative_framing',
    severity: 'medium',
    category: 'manipulation',
  },
  {
    p: /\b(ugly|fat|stupid|worthless|boring|basic)\b/i,
    issue: 'neg_technique',
    severity: 'medium',
    category: 'pua_negging',
  },
  {
    p: /https?:\/\/\S+/i,
    issue: 'link_in_icebreaker',
    severity: 'medium',
    category: 'link_safety',
  },
  {
    p: /\b(god|destiny|universe|meant to be|soulmate)\s+(told|chose|brought|wants)\s+(me|us|you)/i,
    issue: 'love_bombing_opener',
    severity: 'low',
    category: 'love_bombing',
  },
];

export function scanAiIcebreakerSafety(
  content: string,
  context?: { isFirstMessage?: boolean; recipientAge?: number }
): AiIcebreakerSafetyResult {
  const issues: string[] = [];
  let severity: AiIcebreakerSafetyResult['severity'] = 'none';
  let topCategory: string | undefined;
  let filtered = content;

  for (const { p, issue, severity: sev, category } of ICEBREAKER_UNSAFE_PATTERNS) {
    if (p.test(content)) {
      issues.push(issue);
      if (sev === 'high' || (sev === 'medium' && severity !== 'high')) {
        severity = sev;
        topCategory = category;
      }
      if (sev === 'low' && severity === 'none') {
        severity = 'low';
        topCategory = category;
      }
      filtered = filtered.replace(p, '[filtered]');
    }
  }

  if ((context?.recipientAge ?? 18) < 18 && issues.length > 0) {
    severity = 'high';
  }

  const safe = severity === 'none';

  if (!safe) {
    void writeAuditLog('ai.icebreaker_safety', {
      issues, severity, category: topCategory,
    }).catch(() => {});
  }

  return {
    safe,
    issues,
    severity,
    filteredContent: filtered,
    recommendation:
      severity === 'high'
        ? 'Icebreaker blocked. Regenerate with DuoGuard/Llama Guard 4 constraints.'
        : severity === 'medium'
        ? 'Icebreaker flagged. Review before sending.'
        : severity === 'low'
        ? 'Minor concern. Consider rephrasing.'
        : 'Icebreaker is safe to send.',
    duoGuardCategory: topCategory,
  };
}
export const aiIcebreakerSafety = scanAiIcebreakerSafety;
export const icebreakerSafetyScan = scanAiIcebreakerSafety;
export const conversationStarterScan = scanAiIcebreakerSafety;

export interface AIPhotoEditResult {
  withinBoundary: boolean;
  editType: string[];
  editIntensity: 'none' | 'minor' | 'moderate' | 'major' | 'deceptive';
  indicators: string[];
  confidence: number;
  action: 'allow' | 'label' | 'warn' | 'reject';
  requiredLabel?: string;
  recommendation: string;
}

export function detectAIPhotoEditing(signals: {
  softwareTag?: string;        // e.g., "Facetune", "Adobe Firefly", "DALL-E"
  aiGeneratedMetadata?: boolean;
  c2paPresent?: boolean;
  c2paClaimsAi?: boolean;
  skinSmoothingLevel?: number; // 0-1
  featureAlterationScore?: number; // facial features changed
  backgroundReplaced?: boolean;
  bodyProportionAlteration?: number; // 0-1
  elaScore?: number;           // Error Level Analysis — high = edited
  noiseInconsistency?: number; // high = composite image
  estimatedAgeShift?: number;  // years younger/older vs verified age
}): AIPhotoEditResult {
  const editTypes: string[] = [];
  const indicators: string[] = [];
  let intensityScore = 0;
  let confidence = 0;

  const AI_TOOLS = [
    'facetune', 'airbrush', 'meitu', 'snow', 'beautycam',
    'dall-e', 'midjourney', 'stable diffusion', 'adobe firefly',
    'canva ai', 'portrait ai', 'remini', 'photoleap',
  ];
  if (signals.softwareTag) {
    const sw = signals.softwareTag.toLowerCase();
    const matchedTool = AI_TOOLS.find(t => sw.includes(t));
    if (matchedTool) {
      editTypes.push('ai_tool_detected');
      indicators.push(`software_tag:${matchedTool}`);
      intensityScore += 0.5;
      confidence += 0.6;
    }
  }

  if (signals.aiGeneratedMetadata) {
    editTypes.push('ai_generated');
    indicators.push('ai_generation_metadata_flag');
    intensityScore += 0.9;
    confidence += 0.8;
  }

  if (signals.c2paPresent && signals.c2paClaimsAi) {
    editTypes.push('c2pa_ai_claim');
    indicators.push('c2pa_content_credentials_ai');
    intensityScore += 0.7;
    confidence += 0.9;
  }

  if ((signals.skinSmoothingLevel ?? 0) > 0.6) {
    editTypes.push('heavy_skin_smoothing');
    indicators.push(`skin_smoothing:${signals.skinSmoothingLevel}`);
    intensityScore += signals.skinSmoothingLevel! * 0.4;
    confidence += 0.4;
  }

  if ((signals.featureAlterationScore ?? 0) > 0.4) {
    editTypes.push('facial_feature_alteration');
    indicators.push(`feature_alteration:${signals.featureAlterationScore}`);
    intensityScore += signals.featureAlterationScore! * 0.5;
    confidence += 0.45;
  }

  if (signals.backgroundReplaced) {
    editTypes.push('background_replacement');
    indicators.push('background_replaced');
    intensityScore += 0.2;
    confidence += 0.3;
  }

  if ((signals.bodyProportionAlteration ?? 0) > 0.3) {
    editTypes.push('body_proportion_alteration');
    indicators.push(`body_alteration:${signals.bodyProportionAlteration}`);
    intensityScore += signals.bodyProportionAlteration! * 0.6;
    confidence += 0.5;
  }

  if ((signals.elaScore ?? 0) > 0.6) {
    editTypes.push('ela_edit_detected');
    indicators.push(`ela_score:${signals.elaScore}`);
    confidence += 0.4;
  }

  if ((signals.noiseInconsistency ?? 0) > 0.5) {
    editTypes.push('noise_inconsistency');
    indicators.push('composite_image_likely');
    confidence += 0.35;
  }

  if (Math.abs(signals.estimatedAgeShift ?? 0) >= 5) {
    editTypes.push('age_misrepresentation');
    indicators.push(`estimated_age_shift:${signals.estimatedAgeShift}yr`);
    intensityScore += 0.5;
    confidence += 0.5;
  }

  intensityScore = Math.min(1, intensityScore);
  confidence = Math.min(1, confidence);

  const editIntensity: AIPhotoEditResult['editIntensity'] =
    intensityScore >= 0.8 ? 'deceptive' :
    intensityScore >= 0.6 ? 'major' :
    intensityScore >= 0.35 ? 'moderate' :
    intensityScore >= 0.1 ? 'minor' : 'none';

  const withinBoundary = editIntensity !== 'deceptive' && editIntensity !== 'major';

  const action: AIPhotoEditResult['action'] =
    editIntensity === 'deceptive' ? 'reject' :
    editIntensity === 'major' ? 'warn' :
    editIntensity === 'moderate' ? 'label' : 'allow';

  const requiredLabel =
    editIntensity === 'moderate' || editIntensity === 'major'
      ? 'Photo may be edited or AI-enhanced'
      : editIntensity === 'deceptive'
      ? 'Photo appears significantly altered — may not reflect real appearance'
      : undefined;

  if (action !== 'allow') {
    void writeAuditLog('ai.photo_edit_boundary', {
      editTypes, editIntensity, confidence, action,
    }).catch(() => {});
  }

  return {
    withinBoundary,
    editType: editTypes,
    editIntensity,
    indicators,
    confidence: Math.round(confidence * 100) / 100,
    action,
    requiredLabel,
    recommendation:
      action === 'reject'
        ? 'Photo is deceptively edited. Reject and request authentic photo.'
        : action === 'warn'
        ? 'Major editing detected. Warn user about authenticity standards.'
        : action === 'label'
        ? 'Moderate AI editing. Apply transparency label.'
        : 'Photo editing within acceptable bounds.',
  };
}
export const aiPhotoEdit = detectAIPhotoEditing;
export const photoEditBoundary = detectAIPhotoEditing;
export const photoAuthenticity = detectAIPhotoEditing;

export interface AgentToAgentResult {
  detected: boolean;
  confidence: number;
  signals: string[];
  interactionType: 'human_human' | 'human_ai' | 'ai_ai' | 'uncertain';
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'allow' | 'flag' | 'block' | 'require_human_verification';
  recommendation: string;
}

const AGENT_SIGNALS = [
  { p: /^\s*\{.*"role"\s*:\s*"(user|assistant|system)".*\}\s*$/s, signal: 'raw_json_prompt_format', weight: 0.8 },
  { p: /\[(INST|SYS|SYSTEM)\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i, signal: 'llm_special_tokens', weight: 0.9 },
  { p: /^(As an AI|I am an AI language model|I don't have feelings|As a large language model)/i, signal: 'ai_self_disclosure', weight: 0.7 },
  { p: /\b(function_call|tool_call|tool_use|action_input|thought:|observation:)\b/i, signal: 'agent_framework_tokens', weight: 0.85 },
  { p: /SYSTEM:\s*(you are|you're a|your role is)/i, signal: 'system_prompt_leak', weight: 0.9 },
  { p: /\b(json_mode|response_format|max_tokens|temperature|top_p)\s*[:=]/i, signal: 'api_parameter_leak', weight: 0.85 },
];

export function detectAgentToAgentInteraction(messages: Array<{
  content: string;
  senderId: string;
  timestamp: number;
  metadata?: {
    responseTimeMs?: number;
    typingPatternScore?: number;  // 0=robotic, 1=human
    sessionId?: string;
    userAgent?: string;
  };
}>): AgentToAgentResult {
  const signals: string[] = [];
  let confidence = 0;

  const allContent = messages.map(m => m.content).join('\n');
  const senderIds = [...new Set(messages.map(m => m.senderId))];

  for (const { p, signal, weight } of AGENT_SIGNALS) {
    if (p.test(allContent)) {
      signals.push(signal);
      confidence += weight;
    }
  }

  const responseTimes = messages
    .map(m => m.metadata?.responseTimeMs ?? null)
    .filter((t): t is number => t !== null);

  if (responseTimes.length >= 3) {
    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const variance = responseTimes.reduce((s, t) => s + (t - avg) ** 2, 0) / responseTimes.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev < 200 && avg < 2000) {
      signals.push('robotic_response_timing');
      confidence += 0.4;
    }
    if (avg < 500 && responseTimes.every(t => t < 1000)) {
      signals.push('sub_second_responses');
      confidence += 0.45;
    }
  }

  const typingScores = messages
    .map(m => m.metadata?.typingPatternScore ?? null)
    .filter((t): t is number => t !== null);
  if (typingScores.length >= 3) {
    const avgTyping = typingScores.reduce((a, b) => a + b, 0) / typingScores.length;
    if (avgTyping < 0.2) {
      signals.push('robotic_typing_pattern');
      confidence += 0.4;
    }
  }

  const userAgents = messages.map(m => m.metadata?.userAgent ?? '').filter(Boolean);
  if (userAgents.some(ua => /bot|crawler|spider|automated|langchain|openai|anthropic/i.test(ua))) {
    signals.push('bot_user_agent');
    confidence += 0.7;
  }

  if (senderIds.length >= 2 && responseTimes.length >= 4) {
    const isAiAi = signals.filter(s =>
      ['robotic_response_timing', 'sub_second_responses', 'robotic_typing_pattern'].includes(s)
    ).length >= 2;
    if (isAiAi) {
      signals.push('both_sides_automated');
      confidence += 0.5;
    }
  }

  confidence = Math.min(1, confidence);

  const interactionType: AgentToAgentResult['interactionType'] =
    confidence >= 0.7 && signals.includes('both_sides_automated') ? 'ai_ai' :
    confidence >= 0.5 ? 'human_ai' :
    confidence >= 0.3 ? 'uncertain' : 'human_human';

  const riskLevel: AgentToAgentResult['riskLevel'] =
    interactionType === 'ai_ai' ? 'high' :
    interactionType === 'human_ai' ? 'medium' :
    interactionType === 'uncertain' ? 'low' : 'none';

  const action: AgentToAgentResult['action'] =
    riskLevel === 'high' ? 'block' :
    riskLevel === 'medium' ? 'require_human_verification' :
    riskLevel === 'low' ? 'flag' : 'allow';

  if (riskLevel !== 'none') {
    void writeAuditLog('ai.agent_to_agent', {
      interactionType, confidence, signals, action,
    }).catch(() => {});
  }

  return {
    detected: confidence >= 0.3,
    confidence: Math.round(confidence * 100) / 100,
    signals,
    interactionType,
    riskLevel,
    action,
    recommendation:
      interactionType === 'ai_ai'
        ? 'Both sides appear automated. Block and require human verification.'
        : interactionType === 'human_ai'
        ? 'One side appears to be an AI agent. Require CAPTCHA or liveness check.'
        : confidence >= 0.3
        ? 'Uncertain. Flag for human review.'
        : 'Interaction appears human-to-human.',
  };
}
export const agentToAgent = detectAgentToAgentInteraction;
export const aiAgentDetect = detectAgentToAgentInteraction;
export const botInteraction = detectAgentToAgentInteraction;

export interface AIHallucinationResult {
  hallucinated: boolean;
  confidence: number;
  hallucinationType: string[];
  indicators: string[];
  groundingScore: number;
  action: 'allow' | 'flag' | 'block' | 'regenerate';
  recommendation: string;
}

export function detectAIHallucination(content: {
  generatedText: string;
  groundingDocuments?: string[];    // Source texts to verify against
  knownFacts?: Record<string, string>; // key=claim, value=verified fact
  platformContext?: {
    isProfileSuggestion?: boolean;
    isSafetyResource?: boolean;
    isLegalDisclosure?: boolean;
    isMatchExplanation?: boolean;
  };
}): AIHallucinationResult {
  const types: string[] = [];
  const indicators: string[] = [];
  let hallucinationScore = 0;
  let groundingScore = 1.0;

  const text = content.generatedText;

  if (content.knownFacts) {
    for (const [claim, truth] of Object.entries(content.knownFacts)) {
      if (text.toLowerCase().includes(claim.toLowerCase())) {
        const truthWords = truth.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        const matchCount = truthWords.filter(w => text.toLowerCase().includes(w)).length;
        const matchRatio = truthWords.length > 0 ? matchCount / truthWords.length : 1;
        if (matchRatio < 0.3) {
          types.push('factual_contradiction');
          indicators.push(`claim_contradiction:${claim.slice(0, 40)}`);
          hallucinationScore += 0.5;
          groundingScore -= 0.3;
        }
      }
    }
  }

  if (content.groundingDocuments && content.groundingDocuments.length > 0) {
    const textWords = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const groundingWords = new Set(
      content.groundingDocuments.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 4)
    );
    const overlap = [...textWords].filter(w => groundingWords.has(w)).length;
    const overlapRatio = textWords.size > 0 ? overlap / textWords.size : 0;
    groundingScore = overlapRatio;
    if (overlapRatio < 0.2) {
      types.push('low_grounding_overlap');
      indicators.push(`grounding_overlap:${Math.round(overlapRatio * 100)}%`);
      hallucinationScore += 0.4;
    }
  }

  const HALLUCINATION_PATTERNS: Array<{ p: RegExp; type: string; weight: number }> = [
    { p: /\b(studies show|research proves|experts say|scientists confirm)\b.*\b(always|never|100%|guaranteed)\b/i, type: 'false_certainty', weight: 0.4 },
    { p: /\b(according to|based on)\s+(our|the)\s+(records?|data|files?)\b.*\b(you have|you are|your profile shows)\b/i, type: 'fabricated_user_data', weight: 0.7 },
    { p: /\b(you matched with|your compatibility score is|you have \d+ things? in common)\b/i, type: 'fabricated_match_data', weight: 0.6 },
    { p: /\b(call|contact|reach out to)\s+(our\s+)?(support|team|hotline)\s+at\s+(\+?[\d\-\(\)\s]{7,})/i, type: 'fabricated_contact_info', weight: 0.8 },
    { p: /\bhttps?:\/\/(?!myarchetype\.app|thehotline\.org|rainn\.org|fbi\.gov)\S+/i, type: 'unverified_url', weight: 0.5 },
    { p: /\b(legal(ly)?|law|regulation|required by|mandated)\b.*\b(you must|you have to|you are required)\b/i, type: 'false_legal_claim', weight: 0.6 },
  ];

  for (const { p, type, weight } of HALLUCINATION_PATTERNS) {
    if (p.test(text)) {
      types.push(type);
      indicators.push(type);
      hallucinationScore += weight;
    }
  }

  const isHighStakes = content.platformContext?.isSafetyResource ||
    content.platformContext?.isLegalDisclosure;
  if (isHighStakes && hallucinationScore > 0.1) {
    hallucinationScore += 0.3;
    indicators.push('high_stakes_context_stricter_threshold');
  }

  hallucinationScore = Math.min(1, hallucinationScore);
  groundingScore = Math.max(0, Math.min(1, groundingScore));
  const confidence = hallucinationScore;

  const action: AIHallucinationResult['action'] =
    confidence >= 0.7 ? 'block' :
    confidence >= 0.5 ? 'regenerate' :
    confidence >= 0.25 ? 'flag' : 'allow';

  if (action !== 'allow') {
    void writeAuditLog('ai.hallucination_detected', {
      types, confidence, groundingScore, action,
      isHighStakes,
    }).catch(() => {});
  }

  return {
    hallucinated: confidence >= 0.25,
    confidence: Math.round(confidence * 100) / 100,
    hallucinationType: types,
    indicators,
    groundingScore: Math.round(groundingScore * 100) / 100,
    action,
    recommendation:
      action === 'block'
        ? 'High-confidence hallucination. Block content and regenerate with grounding.'
        : action === 'regenerate'
        ? 'Likely hallucination. Regenerate with Vectara HHEM grounding verification.'
        : action === 'flag'
        ? 'Possible hallucination. Flag for human review before display.'
        : 'Content appears grounded.',
  };
}
export const aiHallucination = detectAIHallucination;
export const hallucinationDetect = detectAIHallucination;
export const groundingVerify = detectAIHallucination;

export interface CoherenceAnalysisResult {
  coherent: boolean;
  coherenceScore: number;
  anomalies: string[];
  botLikelihood: number;
  recommendation: string;
  interactionType: 'human' | 'bot' | 'uncertain';
}

export function analyzeConversationCoherence(messages: Array<{
  content: string;
  senderId: string;
  timestamp: number;
  isFromSuspect: boolean;
}>): CoherenceAnalysisResult {
  const anomalies: string[] = [];
  let incoherenceScore = 0;
  let botScore = 0;

  const suspectMessages = messages.filter(m => m.isFromSuspect);
  if (suspectMessages.length < 2) {
    return {
      coherent: true, coherenceScore: 1, anomalies: [],
      botLikelihood: 0, recommendation: 'Insufficient messages.',
      interactionType: 'uncertain',
    };
  }

  const allContent = suspectMessages.map(m => m.content.toLowerCase());
  const questionResponses = messages.filter((m, i) => {
    if (m.isFromSuspect) return false;
    const prev = messages[i + 1];
    return prev?.isFromSuspect && m.content.includes('?');
  });
  const questionsMissed = questionResponses.filter(q => {
    const qWords = q.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const nextMsg = messages[messages.indexOf(q) + 1]?.content.toLowerCase() ?? '';
    const overlap = qWords.filter(w => nextMsg.includes(w)).length;
    return overlap === 0;
  });
  if (questionsMissed.length >= 2) {
    anomalies.push('ignores_questions');
    incoherenceScore += 0.3;
    botScore += 0.25;
  }

  const contentCounts = new Map<string, number>();
  for (const c of allContent) {
    const normalized = c.replace(/\s+/g, ' ').trim();
    contentCounts.set(normalized, (contentCounts.get(normalized) ?? 0) + 1);
  }
  const duplicates = [...contentCounts.values()].filter(v => v >= 2);
  if (duplicates.length > 0) {
    anomalies.push(`duplicate_messages:${duplicates.length}`);
    incoherenceScore += 0.35;
    botScore += 0.4;
  }

  const startsWithSame = suspectMessages.filter((m, i) =>
    i > 0 && m.content.slice(0, 20).toLowerCase() ===
    suspectMessages[i - 1]!.content.slice(0, 20).toLowerCase()
  );
  if (startsWithSame.length >= 2) {
    anomalies.push('template_message_pattern');
    botScore += 0.35;
  }

  const timestamps = suspectMessages.map(m => m.timestamp).sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i]! - timestamps[i - 1]!);
  }
  if (intervals.length >= 3) {
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(intervals.reduce((s, t) => s + (t - avg) ** 2, 0) / intervals.length);
    if (stdDev < 5000 && avg < 30_000) {
      anomalies.push('robotic_message_timing');
      botScore += 0.4;
    }
  }

  const NON_SEQUITUR = [
    /i\s+love\s+you\s+already/i,
    /you\s+are\s+the\s+one\s+for\s+me/i,
    /god\s+sent\s+you\s+to\s+me/i,
    /investment\s+opportunity/i,
    /i\s+need\s+your\s+help\s+with\s+money/i,
  ];
  for (const p of NON_SEQUITUR) {
    if (suspectMessages.some(m => p.test(m.content))) {
      anomalies.push('non_sequitur_topic_shift');
      incoherenceScore += 0.25;
      botScore += 0.2;
    }
  }

  const GENERIC = [
    /^(that'?s? (great|amazing|wonderful|interesting|nice)\.?\s*){2,}/i,
    /^(i (like|love|enjoy) (that|it|this)\.?\s*){2,}/i,
  ];
  const genericCount = suspectMessages.filter(m => GENERIC.some(p => p.test(m.content))).length;
  if (genericCount >= 3) {
    anomalies.push('generic_responses');
    botScore += 0.3;
  }

  incoherenceScore = Math.min(1, incoherenceScore);
  botScore = Math.min(1, botScore);
  const coherenceScore = Math.max(0, 1 - incoherenceScore);
  const coherent = coherenceScore >= 0.6;

  const interactionType: CoherenceAnalysisResult['interactionType'] =
    botScore >= 0.6 ? 'bot' :
    botScore >= 0.3 ? 'uncertain' : 'human';

  if (interactionType !== 'human') {
    void writeAuditLog('ai.conversation_coherence', {
      coherenceScore, botLikelihood: botScore, anomalies, interactionType,
    }).catch(() => {});
  }

  return {
    coherent,
    coherenceScore: Math.round(coherenceScore * 100) / 100,
    anomalies,
    botLikelihood: Math.round(botScore * 100) / 100,
    recommendation:
      interactionType === 'bot'
        ? 'High bot likelihood. Flag account and require human verification.'
        : interactionType === 'uncertain'
        ? 'Possible bot. Monitor and consider CAPTCHA challenge.'
        : 'Conversation appears human.',
    interactionType,
  };
}
export const coherenceAnalysis = analyzeConversationCoherence;
export const conversationCoherence = analyzeConversationCoherence;
export const botLikelihoodScore = analyzeConversationCoherence;

export interface SocioeconomicBiasResult {
  biasDetected: boolean;
  biasType: string[];
  affectedDemographics: string[];
  disparateImpactRatio: number;
  recommendation: string;
  mitigationActions: string[];
  fairlearnMetrics: {
    demographicParity: number;
    equalizedOdds: number;
    individualFairness: number;
  };
}

export function detectSocioeconomicBias(data: {
  visibilityScores: Array<{
    userId: string;
    visibilityScore: number;
    jobTitle?: string;
    educationLevel?: 'none' | 'high_school' | 'bachelors' | 'masters' | 'phd';
    incomeRange?: 'under_30k' | '30k_60k' | '60k_100k' | '100k_plus';
    occupation?: string;
    verified?: boolean;
  }>;
  algorithmWeights?: Record<string, number>;
}): SocioeconomicBiasResult {
  const types: string[] = [];
  const affected: string[] = [];
  const mitigation: string[] = [];

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
    if (!u.incomeRange) continue;
    if (!incomeGroups[u.incomeRange]) incomeGroups[u.incomeRange] = [];
    incomeGroups[u.incomeRange].push(u.visibilityScore);
  }

  const eduGroups: Record<string, number[]> = {};
  for (const u of data.visibilityScores) {
    if (!u.educationLevel) continue;
    if (!eduGroups[u.educationLevel]) eduGroups[u.educationLevel] = [];
    eduGroups[u.educationLevel].push(u.visibilityScore);
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

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
    const ratio = sorted[sorted.length - 1]!.avg > 0
      ? sorted[0]!.avg / sorted[sorted.length - 1]!.avg : 1;
    if (ratio < 0.8) {
      types.push('education_visibility_disparity');
      affected.push(`lower_education:${sorted[0]!.k}`);
      mitigation.push('Audit algorithm weights for education-correlated features');
    }
  }

  if (data.algorithmWeights) {
    const socioeconomicFeatures = ['income', 'job_prestige', 'education_score', 'verified_employer'];
    const problematic = socioeconomicFeatures.filter(f =>
      (data.algorithmWeights![f] ?? 0) > 0.15
    );
    if (problematic.length > 0) {
      types.push('socioeconomic_feature_overweighting');
      affected.push(...problematic);
      mitigation.push(`Reduce weight of: ${problematic.join(', ')}`);
    }
  }

  const biasDetected = types.length > 0;

  const allScores = data.visibilityScores.map(u => u.visibilityScore);
  const overallAvg = avg(allScores);
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
    biasDetected,
    biasType: types,
    affectedDemographics: affected,
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
export const visibilityBias = detectSocioeconomicBias;
export const algorithmicBias = detectSocioeconomicBias;

export interface ThirdPartyAIResult {
  detected: boolean;
  vendors: string[];
  dataShared: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  consentObtained: boolean;
  gdprLawfulBasis?: string;
  recommendation: string;
  requiredActions: string[];
}

const KNOWN_AI_VENDORS = [
  { name: 'OpenAI', domains: ['api.openai.com', 'openai.com'], dataRisk: 'high' },
  { name: 'Anthropic', domains: ['api.anthropic.com'], dataRisk: 'high' },
  { name: 'Google AI', domains: ['generativelanguage.googleapis.com', 'vertexai.googleapis.com'], dataRisk: 'medium' },
  { name: 'Cohere', domains: ['api.cohere.ai'], dataRisk: 'medium' },
  { name: 'Hugging Face', domains: ['api-inference.huggingface.co'], dataRisk: 'medium' },
  { name: 'Replicate', domains: ['api.replicate.com'], dataRisk: 'high' },
  { name: 'Azure OpenAI', domains: ['openai.azure.com'], dataRisk: 'medium' },
  { name: 'AWS Bedrock', domains: ['bedrock.amazonaws.com'], dataRisk: 'medium' },
  { name: 'Mistral', domains: ['api.mistral.ai'], dataRisk: 'medium' },
  { name: 'Together AI', domains: ['api.together.xyz'], dataRisk: 'high' },
];

export function detectThirdPartyAIDataSharing(config: {
  networkRequests: Array<{ domain: string; endpoint?: string; dataPayload?: string[] }>;
  sdksDetected: string[];
  consentConfig: {
    aiDataSharingDisclosed: boolean;
    userOptedIn: boolean;
    gdprLawfulBasis?: string;
    dataProcessingAgreementSigned?: boolean;
  };
  userDataCategories: string[];  // e.g., ['messages', 'photos', 'location', 'age']
}): ThirdPartyAIResult {
  const vendors: string[] = [];
  const dataShared: string[] = [];
  const requiredActions: string[] = [];
  let maxRisk: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';

  for (const req of config.networkRequests) {
    for (const vendor of KNOWN_AI_VENDORS) {
      if (vendor.domains.some(d => req.domain.includes(d))) {
        if (!vendors.includes(vendor.name)) vendors.push(vendor.name);
        if (req.dataPayload) dataShared.push(...req.dataPayload.filter(d => !dataShared.includes(d)));

        const risk = vendor.dataRisk as 'low' | 'medium' | 'high';
        if (risk === 'high' && maxRisk !== 'critical') maxRisk = 'high';
        else if (risk === 'medium' && maxRisk === 'none') maxRisk = 'medium';
      }
    }
  }

  const AI_SDKS = ['openai', 'anthropic', 'langchain', '@google-ai', 'cohere', 'replicate', 'mistral'];
  for (const sdk of config.sdksDetected) {
    if (AI_SDKS.some(s => sdk.toLowerCase().includes(s))) {
      const sdkName = sdk.split('/').pop() ?? sdk;
      if (!vendors.includes(sdkName)) vendors.push(sdkName);
      if (maxRisk === 'none') maxRisk = 'low';
    }
  }

  const SENSITIVE_CATEGORIES = ['messages', 'photos', 'location', 'health', 'sexual_orientation', 'age', 'biometric'];
  const sensitiveSent = config.userDataCategories.filter(c => SENSITIVE_CATEGORIES.includes(c));
  if (sensitiveSent.length > 0 && vendors.length > 0) {
    dataShared.push(...sensitiveSent.filter(d => !dataShared.includes(d)));
    if (sensitiveSent.some(c => ['health', 'sexual_orientation', 'biometric'].includes(c))) {
      maxRisk = 'critical';
      requiredActions.push('CRITICAL: Sensitive special-category data sent to AI vendor. Requires explicit GDPR Art.9 consent.');
    } else if (sensitiveSent.includes('messages') || sensitiveSent.includes('photos')) {
      if (maxRisk !== 'critical') maxRisk = 'high';
    }
  }

  const { consentConfig } = config;
  if (vendors.length > 0 && !consentConfig.aiDataSharingDisclosed) {
    requiredActions.push('Disclose AI data sharing in privacy policy (GDPR Art.13)');
    if (maxRisk !== 'critical') maxRisk = 'high';
  }
  if (vendors.length > 0 && !consentConfig.userOptedIn && !consentConfig.gdprLawfulBasis) {
    requiredActions.push('Obtain user consent or document lawful basis for AI data sharing');
    if (maxRisk !== 'critical') maxRisk = 'high';
  }
  if (vendors.length > 0 && !consentConfig.dataProcessingAgreementSigned) {
    requiredActions.push('Sign Data Processing Agreement (DPA) with all AI vendors');
  }
  if (vendors.length > 0) {
    requiredActions.push('Audit AI vendor data retention and training data policies');
    requiredActions.push('Implement network monitoring to detect new AI SDK additions');
  }

  const detected = vendors.length > 0;
  if (detected) {
    void writeAuditLog('ai.third_party_data_sharing', {
      vendors, dataShared, riskLevel: maxRisk, consentObtained: consentConfig.userOptedIn,
    }).catch(() => {});
  }

  return {
    detected,
    vendors,
    dataShared,
    riskLevel: maxRisk,
    consentObtained: consentConfig.aiDataSharingDisclosed && consentConfig.userOptedIn,
    gdprLawfulBasis: consentConfig.gdprLawfulBasis,
    recommendation: maxRisk === 'critical'
      ? 'CRITICAL: Sensitive data shared with AI vendor without proper consent. Halt immediately.'
      : maxRisk === 'high'
      ? `High-risk AI data sharing with: ${vendors.join(', ')}. Address consent and DPA gaps.`
      : maxRisk === 'medium'
      ? `Moderate AI data sharing detected. Review consent disclosures for: ${vendors.join(', ')}.`
      : vendors.length > 0
      ? 'Low-risk AI data sharing. Ensure DPAs are in place.'
      : 'No third-party AI data sharing detected.',
    requiredActions,
  };
}
export const thirdPartyAI = detectThirdPartyAIDataSharing;
export const aiDataSharing = detectThirdPartyAIDataSharing;
export const sdkAudit = detectThirdPartyAIDataSharing;

export const AI_AGENT_GUARDRAILS = { cannotSendMessagesAsUser:true, cannotModifyProfile:true, cannotMakePayments:true, cannotSharePersonalInfo:true, mustDiscloseAI:true, maxSuggestionsPerInteraction:3, prohibitedTopics:['financial_advice','medical_advice','legal_advice'] };
export function validateAgentAction(a: { type: string; payload: Record<string, unknown> }) {
  const BLOCKED = new Set(['send_message','edit_profile','make_payment','share_location','export_contacts','delete_account']);
  return BLOCKED.has(a.type) ? { permitted: false, reason: `AI agents cannot perform: ${a.type}` } : { permitted: true };
}
export function enforceAiDisclosure(txt: string) { return txt.includes('generated by AI') ? txt : txt + '\n\n---\n_This suggestion was generated by AI. Always use your own judgment._'; }

export async function checkGroundedness(claim: string, context: string) {
  try { const r = await fetchSafe(`${process.env['EXPO_PUBLIC_API_URL']??''}/safety/groundedness`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({claim,context}) }); return r.ok ? r.json() as Promise<{grounded:boolean;confidence:number}> : {grounded:true,confidence:0}; }
  catch { return {grounded:true,confidence:0}; }
}

export const AI_INFRASTRUCTURE_POLICIES = { modelVersioning:true, trainingDataAudit:true, modelSignatureVerification:true, canaryInputMonitoring:true, outputSanitization:true, fallbackToRules:true };
export function verifyModelSignature(id: string, reported: string, expected: string) { return { valid: reported === expected, tampered: reported !== expected }; }
export function sanitizeModelOutput(o: string) { return o.replace(/\[SYSTEM\].*?\[\/SYSTEM\]/gis,'').replace(/ignore (previous|all) instructions/gi,'[REDACTED]').trim(); }

export interface ModelVersion { modelId:string; version:string; deployedAt:string; checksum:string; active:boolean; rollbackTo?:string; }
export function selectModelVersion(versions: ModelVersion[], stable = true) { const a = versions.filter(v=>v.active); return a.length ? a.sort((x,y)=>new Date(y.deployedAt).getTime()-new Date(x.deployedAt).getTime())[0]??null : null; }

export function auditFilterBias(usage: { userId:string; filterField:string; filterValue:string }[]) {
  const R = new Set(['ethnicity','race','skin_color','nationality']), S = new Set(['income','education_level','neighborhood']);
  const f: {field:string;concern:string}[] = [];
  usage.forEach(u => { if(R.has(u.filterField)) f.push({field:u.filterField,concern:'potential_racial_discrimination'}); if(S.has(u.filterField)) f.push({field:u.filterField,concern:'potential_socioeconomic_discrimination'}); });
  if(f.length) writeAuditLog('ai.bias_filter_flagged', { fields: f.map(x=>x.field) }).catch(()=>{});
  return { flaggedFilters: f };
}

export interface ScamDetectionFailureMode { type:'novel_script'|'language_switch'|'slow_burn'|'trusted_platform_name'|'victim_demographic'; description:string; mitigationStrategy:string; }
export const KNOWN_FAILURE_MODES: ScamDetectionFailureMode[] = [
  {type:'novel_script',description:'New scam scripts not yet in training data',mitigationStrategy:'Weekly retraining with newly confirmed scam reports + human review queue'},
  {type:'language_switch',description:'Scammer switches language mid-conversation to evade classifier',mitigationStrategy:'Apply Qwen3Guard (119 languages) on every message regardless of detected language'},
  {type:'slow_burn',description:'Weeks of benign messages before financial request',mitigationStrategy:'Maintain 90-day conversation embeddings and score holistic relationship arc'},
  {type:'trusted_platform_name',description:'Fake platform named similarly to legitimate',mitigationStrategy:'Fuzzy string matching against known legitimate platform list + domain check'},
];
export function auditScamDetectionGaps(reports: { reportedContent:string; wasAutoDetected:boolean; category:string }[]) {
  const m = reports.filter(r=>!r.wasAutoDetected); return { falseNegativeRate: reports.length>0?m.length/reports.length:0, missedCategories:[...new Set(m.map(r=>r.category))] };
}

export function evaluateModelDrift(b: {fp:number;fn:number;predictions:number[]}, c: {fp:number;fn:number;predictions:number[]}) {
  const ds = Math.abs((c.fp-b.fp)/(b.fp+0.001)+(c.fn-b.fn)/(b.fn+0.001));
  const fnD = c.fn>b.fn*1.5, fpD = c.fp>b.fp*2;
  const act = fnD?'rollback':fpD?'retrain':ds>0.2?'alert':'none';
  if(act!=='none') writeAuditLog('ai.model_drift_detected', { driftScore:ds, action:act }).catch(()=>{});
  return { driftScore:ds, degraded:fnD||fpD, action:act };
}

export interface BiasAuditResult { metric:string; value:number; threshold:number; passed:boolean; }
export function auditMatchingFairness(outcomes: {userId:string;demographic:string;matchCount:number;shown:number}[]): BiasAuditResult[] {
  const g = new Map<string,{m:number;s:number;c:number}>();
  outcomes.forEach(o=>{const x=g.get(o.demographic)??{m:0,s:0,c:0};x.m+=o.matchCount;x.s+=o.shown;x.c++;g.set(o.demographic,x);});
  const rates=[...g.entries()].map(([,v])=>v.s>0?v.m/v.s:0);
  if(rates.length<2) return [];
  const di = Math.min(...rates)/Math.max(...rates);
  return [{metric:'disparate_impact_ratio',value:di,threshold:0.8,passed:di>=0.8}];
}

export function detectAdversarialInput(t: string) {
  const tech: string[] = [];
  if(/[\u200B-\u200F\u2060\uFEFF\u00AD]/.test(t)) tech.push('zero_width_injection');
  const lr=(t.match(/[a-zA-Z]/g)??[]).length/Math.max(t.length,1); if(lr<0.3&&t.length>10) tech.push('homoglyph_attack');
  if(/[A-Za-z0-9+/]{20,}={0,2}/.test(t)) tech.push('base64_evasion');
  if(/(.)\1{10,}/.test(t)) tech.push('padding_attack');
  if(/ignore (previous|above|all) instructions|system prompt|you are now|roleplay as/i.test(t)) tech.push('prompt_injection');
  return { isAdversarial:tech.length>0, technique:tech, confidence:Math.min(tech.length*0.3,1) };
}

export interface AIDecisionExplanation { decision:string; factors:{factor:string;weight:number;direction:'positive'|'negative'}[]; confidence:number; appealable:boolean; }
export function explainModerationDecision(r: {flagged:boolean;categories:Record<string,number>}): AIDecisionExplanation {
  const f=Object.entries(r.categories).filter(([,s])=>s>0.1).map(([k,w])=>({factor:k,weight:w,direction:w>0.5?'negative':'positive' as const})).sort((a,b)=>b.weight-a.weight);
  return {decision:r.flagged?'content_flagged':'content_allowed',factors:f,confidence:f[0]?.weight??0,appealable:true};
}
export const DEFAULT_AI_CONSENT = { matchingAlgorithm:true, photoAnalysis:true, messageModeration:true, personalityInsights:false, voiceAnalysis:false };

export interface ModelInversionResult{risk:'none'|'low'|'medium'|'high';indicators:string[];recommendation:string;action:'allow'|'rate_limit'|'block';}
export function detectModelInversionAttack(queries:Array<{input:string;timestamp:number;userId:string}>,userId:string,windowMs=3_600_000):ModelInversionResult{
const now=Date.now(),userQ=queries.filter(q=>q.userId===userId&&now-q.timestamp<windowMs);
const indicators:string[]=[];
if(userQ.length>100)indicators.push(`high_query_volume:${userQ.length}`);
const inputs=userQ.map(q=>q.input);const uniqueInputs=new Set(inputs).size;if(userQ.length>20&&uniqueInputs/userQ.length<0.3)indicators.push('low_input_diversity');
const systematicPattern=/^(.{1,5})\1+$/.test(inputs.slice(-10).join(''));if(systematicPattern)indicators.push('systematic_probing_pattern');
const avgLen=inputs.reduce((s,i)=>s+i.length,0)/Math.max(inputs.length,1);if(avgLen<5&&userQ.length>50)indicators.push('very_short_systematic_inputs');
const risk=indicators.length>=3?'high':indicators.length>=2?'medium':indicators.length>=1?'low':'none';
const action=risk==='high'?'block':risk==='medium'?'rate_limit':'allow';
if(risk!=='none')writeAuditLog('ai.model_inversion_risk',{userId,indicators,risk}).catch(()=>{});
return{risk,indicators,action,recommendation:risk==='high'?'Block user. Likely model inversion attack.':risk==='medium'?'Rate limit. Monitor for model inversion.':risk!=='none'?'Monitor query patterns.':'No model inversion risk detected.'};}
export const modelInversion=detectModelInversionAttack;export const inversionAttack=detectModelInversionAttack;export const privacyAttack=detectModelInversionAttack;

export interface MembershipInferenceResult{risk:'none'|'low'|'medium'|'high';confidence:number;recommendation:string;}
export function detectMembershipInferenceAttack(modelConfidences:number[],threshold=0.95):MembershipInferenceResult{
if(modelConfidences.length<5)return{risk:'none',confidence:0,recommendation:'Insufficient data.'};
const highConf=modelConfidences.filter(c=>c>=threshold).length/modelConfidences.length;
const avgConf=modelConfidences.reduce((a,b)=>a+b,0)/modelConfidences.length;
const risk=highConf>=0.8&&avgConf>=0.9?'high':highConf>=0.6?'medium':highConf>=0.3?'low':'none';
if(risk!=='none')writeAuditLog('ai.membership_inference_risk',{highConfidenceRatio:highConf,avgConfidence:avgConf,risk}).catch(()=>{});
return{risk,confidence:avgConf,recommendation:risk==='high'?'Apply differential privacy. High membership inference risk.':risk!=='none'?'Monitor confidence distributions. Consider output perturbation.':'Membership inference risk within acceptable bounds.'};}
export const membershipInference=detectMembershipInferenceAttack;export const inferenceAttack=detectMembershipInferenceAttack;export const memberInfer=detectMembershipInferenceAttack;

export interface AdversarialExampleResult{detected:boolean;perturbationType:string[];confidence:number;action:'allow'|'flag'|'block';}
export function detectAdversarialExample(input:{text?:string;imageFeatures?:number[];expectedLabel?:string;modelConfidence?:number;gradientNorm?:number}):AdversarialExampleResult{
const types:string[]=[];
if(input.text){const adv=detectAdversarialInput(input.text);if(adv.isAdversarial)types.push(...adv.technique);}
if(input.modelConfidence!==undefined&&input.modelConfidence<0.4&&input.expectedLabel)types.push('low_confidence_with_label');
if(input.gradientNorm!==undefined&&input.gradientNorm>10)types.push('high_gradient_norm');
if(input.imageFeatures){const mean=input.imageFeatures.reduce((a,b)=>a+b,0)/input.imageFeatures.length;const variance=input.imageFeatures.reduce((s,x)=>s+(x-mean)**2,0)/input.imageFeatures.length;if(variance>100)types.push('high_feature_variance');}
const confidence=Math.min(types.length*0.3,1);const action=confidence>=0.7?'block':confidence>=0.4?'flag':'allow';
if(action!=='allow')writeAuditLog('ai.adversarial_example',{types,confidence}).catch(()=>{});
return{detected:types.length>0,perturbationType:types,confidence,action};}
export const adversarialExample=detectAdversarialExample;export const adversarialDetect=detectAdversarialExample;export const perturbationDetect=detectAdversarialExample;

export interface CalibrationResult{calibrated:boolean;expectedCalibrationError:number;maxCalibrationError:number;recommendation:string;temperatureScaling?:number;}
export function calibrateModelConfidence(predictions:Array<{confidence:number;correct:boolean}>,bins=10):CalibrationResult{
if(predictions.length<50)return{calibrated:true,expectedCalibrationError:0,maxCalibrationError:0,recommendation:'Insufficient data for calibration.'};
const binSize=1/bins;let ece=0,mce=0;
for(let i=0;i<bins;i++){const lo=i*binSize,hi=(i+1)*binSize;const binPreds=predictions.filter(p=>p.confidence>=lo&&p.confidence<hi);
if(binPreds.length===0)continue;const avgConf=binPreds.reduce((s,p)=>s+p.confidence,0)/binPreds.length;const accuracy=binPreds.filter(p=>p.correct).length/binPreds.length;const gap=Math.abs(avgConf-accuracy);ece+=gap*(binPreds.length/predictions.length);mce=Math.max(mce,gap);}
const calibrated=ece<0.1&&mce<0.2;const temperature=ece>0.15?1.5:ece>0.1?1.2:1.0;
if(!calibrated)writeAuditLog('ai.calibration_needed',{ece,mce,temperature}).catch(()=>{});
return{calibrated,expectedCalibrationError:Math.round(ece*1000)/1000,maxCalibrationError:Math.round(mce*1000)/1000,temperatureScaling:calibrated?undefined:temperature,recommendation:calibrated?'Model is well calibrated.':ece>0.15?`Poor calibration (ECE=${ece.toFixed(3)}). Apply temperature scaling T=${temperature}.`:`Moderate calibration error. Consider temperature scaling.`};}
export const confidenceCalibration=calibrateModelConfidence;export const calibrateModel=calibrateModelConfidence;export const temperatureScaling=calibrateModelConfidence;

export interface DriftMonitorResult{driftDetected:boolean;driftScore:number;affectedDetectors:string[];action:'none'|'alert'|'retrain'|'rollback';recommendation:string;}
export function monitorDetectorDrift(metrics:Array<{detectorId:string;baselineFpr:number;currentFpr:number;baselineFnr:number;currentFnr:number;baselineLatencyMs:number;currentLatencyMs:number}>):DriftMonitorResult{
const drifted:string[]=[],driftScores:number[]=[];
for(const m of metrics){let score=0;const fprDrift=Math.abs(m.currentFpr-m.baselineFpr)/(m.baselineFpr+0.001);const fnrDrift=Math.abs(m.currentFnr-m.baselineFnr)/(m.baselineFnr+0.001);const latDrift=Math.abs(m.currentLatencyMs-m.baselineLatencyMs)/(m.baselineLatencyMs+1);
if(fprDrift>0.5)score+=40;if(fnrDrift>0.5)score+=40;if(latDrift>1.0)score+=20;if(score>0){drifted.push(m.detectorId);driftScores.push(score);}}
const maxDrift=driftScores.length>0?Math.max(...driftScores):0;const action=maxDrift>=80?'rollback':maxDrift>=60?'retrain':maxDrift>=30?'alert':'none';
if(action!=='none')writeAuditLog('ai.detector_drift',{affectedDetectors:drifted,maxDrift,action}).catch(()=>{});
return{driftDetected:drifted.length>0,driftScore:maxDrift,affectedDetectors:drifted,action,recommendation:action==='rollback'?'Critical drift. Rollback to last stable version.':action==='retrain'?'Significant drift. Schedule retraining.':action==='alert'?'Moderate drift detected. Monitor closely.':'All detectors within baseline bounds.'};}
export const detectorDrift=monitorDetectorDrift;export const driftMonitor=monitorDetectorDrift;export const performanceDrift=monitorDetectorDrift;

export interface AiIcebreakerSafetyResult{safe:boolean;issues:string[];severity:'none'|'low'|'medium'|'high';filteredContent:string;recommendation:string;}
export function scanAiIcebreakerSafety(content:string,recipientContext?:{age?:number;previousFlags?:number}):AiIcebreakerSafetyResult{
const issues:string[]=[];
if(/\b(sex|nude|naked|nsfw|explicit|hooking up|one night)\b/i.test(content))issues.push('sexual_content');
if(/\b(ugly|fat|stupid|loser|pathetic|desperate)\b/i.test(content))issues.push('insulting_content');
if(/\b(give me|send me|need money|crypto|bitcoin|invest)\b/i.test(content))issues.push('financial_solicitation');
if(/\b(where do you live|your address|your location|meet me at)\b/i.test(content))issues.push('location_probing');
if(content.length<5)issues.push('too_short');
if(content.length>500)issues.push('too_long');
if((recipientContext?.age??99)<18&&/\b(drink|party|come over|alone)\b/i.test(content))issues.push('age_inappropriate');
if(/(.)\1{5,}/.test(content))issues.push('spam_pattern');
const sev=issues.includes('sexual_content')||issues.includes('financial_solicitation')?'high':issues.includes('insulting_content')||issues.includes('location_probing')?'medium':issues.length>0?'low':'none';
const filteredContent=sev==='high'?'[AI icebreaker removed for safety]':content;
if(sev!=='none')writeAuditLog('ai.icebreaker_safety',{issues,severity:sev}).catch(()=>{});
return{safe:sev==='none',issues,severity:sev,filteredContent,recommendation:sev==='high'?'Remove AI icebreaker. Regenerate with stricter constraints.':sev!=='none'?'Review AI icebreaker before sending.':'AI icebreaker passed safety check.'};}
export const aiIcebreakerSafety=scanAiIcebreakerSafety;export const scanAIIcebreaker=scanAiIcebreakerSafety;export const aiConversationScan=scanAiIcebreakerSafety;

export interface AiStarterSafetyResult{safe:boolean;issues:string[];filteredStarter:string;severity:'none'|'low'|'medium'|'high';}
export function scanAiConversationStarter(starter:string,context?:{isFirstMessage?:boolean;matchAge?:number}):AiStarterSafetyResult{
const result=scanAiIcebreakerSafety(starter,{age:context?.matchAge});
if(context?.isFirstMessage&&/\b(phone|number|whatsapp|telegram|snapchat|instagram|discord)\b/i.test(starter)){result.issues.push('platform_redirect_first_message');if(result.severity==='none')result.severity='medium';}
return{safe:result.safe&&!result.issues.includes('platform_redirect_first_message'),issues:result.issues,filteredStarter:result.filteredContent,severity:result.severity};}
export const aiStarterSafety=scanAiConversationStarter;export const conversationStarterScan=scanAiConversationStarter;export const aiStarterModerate=scanAiConversationStarter;

export interface MatchingAuditResult{biasDetected:boolean;disparateImpactRatio:number;affectedGroups:string[];recommendation:string;passed:boolean;}
export function auditAiMatchingRecommendation(outcomes:{userId:string;demographic:string;matchCount:number;shown:number}[]):MatchingAuditResult{
const results=auditMatchingFairness(outcomes);const dir=results[0]?.value??1;
const groups=new Map<string,number>();outcomes.forEach(o=>{const r=o.shown>0?o.matchCount/o.shown:0;groups.set(o.demographic,(groups.get(o.demographic)??0)+r);});
const rates=[...groups.values()];const minRate=Math.min(...rates),maxRate=Math.max(...rates);const affected=maxRate>0&&minRate/maxRate<0.8?[...groups.entries()].filter(([,r])=>r===minRate).map(([g])=>g):[];
if(!results[0]?.passed)writeAuditLog('ai.matching_bias_detected',{disparateImpactRatio:dir,affectedGroups:affected}).catch(()=>{});
return{biasDetected:!results[0]?.passed??false,disparateImpactRatio:dir,affectedGroups:affected,passed:results[0]?.passed??true,recommendation:dir<0.8?`Disparate impact detected (ratio=${dir.toFixed(2)}). Review matching algorithm for bias. Affected: ${affected.join(', ')}.`:dir<0.9?'Minor disparity. Monitor matching fairness.':'Matching recommendations appear fair.'};}
export const matchingAudit=auditAiMatchingRecommendation;export const recommendationAudit=auditAiMatchingRecommendation;export const aiMatchBias=auditAiMatchingRecommendation;

export interface AiContentDisclosureResult{hasAiContent:boolean;disclosureAdded:boolean;disclosureText:string;fields:string[];}
export function enforceAiContentDisclosure(profileFields:Record<string,string>,aiGeneratedFields:string[]):AiContentDisclosureResult{
const fields=aiGeneratedFields.filter(f=>f in profileFields);const hasAiContent=fields.length>0;
const disclosureText=hasAiContent?`Some profile content (${fields.join(', ')}) was generated with AI assistance.`:'';
return{hasAiContent,disclosureAdded:hasAiContent,disclosureText,fields};}
export const aiContentDisclosure=enforceAiContentDisclosure;export const aiProfileDisclosure=enforceAiContentDisclosure;export const aiGeneratedDisclosure=enforceAiContentDisclosure;

export interface AiScamScalingResult{detected:boolean;scalingIndicators:string[];estimatedVictimCount:number;riskLevel:'none'|'low'|'medium'|'high'|'critical';action:'none'|'alert'|'suspend'|'ban';}
export function detectAiScamScaling(messages:Array<{senderId:string;text:string;timestamp:number;recipientId:string}>):AiScamScalingResult{
const senders=new Map<string,{texts:string[];recipients:Set<string>;timestamps:number[]}>();
for(const m of messages){const s=senders.get(m.senderId)??{texts:[],recipients:new Set(),timestamps:[]};s.texts.push(m.text);s.recipients.add(m.recipientId);s.timestamps.push(m.timestamp);senders.set(m.senderId,s);}
const indicators:string[]=[],victims=new Set<string>();
for(const[sid,data]of senders){if(data.recipients.size<3)continue;
const uniq=new Set(data.texts).size;const dupRatio=1-(uniq/data.texts.length);if(dupRatio>0.7)indicators.push(`template_reuse:${sid}:${Math.round(dupRatio*100)}%`);
const window=data.timestamps[data.timestamps.length-1]!-data.timestamps[0]!;const rate=data.recipients.size/(window/3_600_000+0.1);if(rate>10)indicators.push(`high_victim_rate:${sid}:${rate.toFixed(1)}/hr`);
if(data.recipients.size>20)indicators.push(`mass_targeting:${sid}:${data.recipients.size}`);
if(indicators.some(i=>i.includes(sid)))data.recipients.forEach(r=>victims.add(r));}
const vc=victims.size;const rl=vc>=50||indicators.length>=5?'critical':vc>=20||indicators.length>=3?'high':vc>=5||indicators.length>=2?'medium':indicators.length>=1?'low':'none';
const action=rl==='critical'?'ban':rl==='high'?'suspend':rl==='medium'?'alert':'none';
if(action!=='none')writeAuditLog('ai.scam_scaling_detected',{indicators,estimatedVictims:vc,riskLevel:rl}).catch(()=>{});
return{detected:indicators.length>0,scalingIndicators:indicators,estimatedVictimCount:vc,riskLevel:rl,action};}
export const aiScamScaling=detectAiScamScaling;export const scaledScam=detectAiScamScaling;export const aiAssistedScam=detectAiScamScaling;

export interface CoherenceAnalysisResult{coherent:boolean;coherenceScore:number;anomalies:string[];botLikelihood:number;recommendation:string;}
export function analyzeConversationCoherence(messages:Array<{text:string;senderId:string;timestamp:number}>):CoherenceAnalysisResult{
if(messages.length<3)return{coherent:true,coherenceScore:1,anomalies:[],botLikelihood:0,recommendation:'Insufficient messages for analysis.'};
const anomalies:string[]=[],userMsgs=messages.filter(m=>m.senderId===messages[0]!.senderId);
const avgLen=userMsgs.reduce((s,m)=>s+m.text.length,0)/userMsgs.length;const lenVar=userMsgs.reduce((s,m)=>s+(m.text.length-avgLen)**2,0)/userMsgs.length;if(lenVar<50&&userMsgs.length>5)anomalies.push('uniform_message_length');
const intervals=[];for(let i=1;i<userMsgs.length;i++)intervals.push(userMsgs[i]!.timestamp-userMsgs[i-1]!.timestamp);const avgInt=intervals.reduce((a,b)=>a+b,0)/Math.max(intervals.length,1);const intVar=intervals.reduce((s,t)=>s+(t-avgInt)**2,0)/Math.max(intervals.length,1);if(intVar<10000&&intervals.length>3)anomalies.push('robotic_timing');
const texts=userMsgs.map(m=>m.text.toLowerCase());const uniqueTexts=new Set(texts).size;if(uniqueTexts/texts.length<0.5)anomalies.push('high_repetition');
if(/\bclick here\b|\bhttps?:\/\/\b|\bbit\.ly\b|\btelegram\b|\bwhatsapp\b/i.test(userMsgs.map(m=>m.text).join(' ')))anomalies.push('link_or_redirect_spam');
const botLikelihood=Math.min(anomalies.length*0.25,1);const coherenceScore=Math.max(1-botLikelihood,0);
if(botLikelihood>0.5)writeAuditLog('ai.coherence_anomaly',{anomalies,botLikelihood}).catch(()=>{});
return{coherent:botLikelihood<0.5,coherenceScore:Math.round(coherenceScore*100)/100,anomalies,botLikelihood:Math.round(botLikelihood*100)/100,recommendation:botLikelihood>=0.75?'High bot likelihood. Flag for review.':botLikelihood>=0.5?'Moderate bot signals. Monitor.':'Conversation appears human-generated.'};}
export const coherenceAnalysis=analyzeConversationCoherence;export const conversationCoherence=analyzeConversationCoherence;export const aiCoherence=analyzeConversationCoherence;

export interface DeepfakeLiveCallResult{suspectedDeepfake:boolean;indicators:string[];confidence:number;action:'allow'|'warn'|'terminate';}
export function detectDeepfakeLiveCall(frameMetrics:Array<{blinkRate:number;lipSyncScore:number;facialJitterMs:number;skinTextureConsistency:number;backgroundConsistency:number;timestamp:number}>):DeepfakeLiveCallResult{
if(frameMetrics.length<3)return{suspectedDeepfake:false,indicators:[],confidence:0,action:'allow'};
const indicators:string[]=[];
const avgBlink=frameMetrics.reduce((s,f)=>s+f.blinkRate,0)/frameMetrics.length;if(avgBlink<0.1||avgBlink>1.0)indicators.push('abnormal_blink_rate');
const avgLipSync=frameMetrics.reduce((s,f)=>s+f.lipSyncScore,0)/frameMetrics.length;if(avgLipSync<0.6)indicators.push('poor_lip_sync');
const avgJitter=frameMetrics.reduce((s,f)=>s+f.facialJitterMs,0)/frameMetrics.length;if(avgJitter>50)indicators.push('high_facial_jitter');
const avgSkin=frameMetrics.reduce((s,f)=>s+f.skinTextureConsistency,0)/frameMetrics.length;if(avgSkin<0.5)indicators.push('inconsistent_skin_texture');
const avgBg=frameMetrics.reduce((s,f)=>s+f.backgroundConsistency,0)/frameMetrics.length;if(avgBg<0.3)indicators.push('background_inconsistency');
const blinkVar=frameMetrics.reduce((s,f)=>s+(f.blinkRate-avgBlink)**2,0)/frameMetrics.length;if(blinkVar<0.001&&frameMetrics.length>5)indicators.push('robotic_blink_pattern');
const confidence=Math.min(indicators.length*0.18,1);const action=confidence>=0.7?'terminate':confidence>=0.4?'warn':'allow';
if(action!=='allow')writeAuditLog('ai.deepfake_live_call',{indicators,confidence,action}).catch(()=>{});
return{suspectedDeepfake:confidence>=0.4,indicators,confidence:Math.round(confidence*100)/100,action};}
export const deepfakeLiveCall=detectDeepfakeLiveCall;export const liveCallDeepfake=detectDeepfakeLiveCall;export const videoCallDeepfake=detectDeepfakeLiveCall;

export interface SocioeconomicBiasResult{biasDetected:boolean;biasType:string[];affectedDemographics:string[];disparateImpactRatio:number;recommendation:string;}
export function detectSocioeconomicBias(visibilityData:{userId:string;incomeLevel?:'low'|'medium'|'high';educationLevel?:string;neighborhood?:string;profileViews:number;matchRate:number}[]):SocioeconomicBiasResult{
const byIncome=new Map<string,{views:number;matches:number;count:number}>();
for(const d of visibilityData){const k=d.incomeLevel??'unknown';const v=byIncome.get(k)??{views:0,matches:0,count:0};v.views+=d.profileViews;v.matches+=d.matchRate;v.count++;byIncome.set(k,v);}
const rates=[...byIncome.entries()].map(([k,v])=>({group:k,avgMatchRate:v.count>0?v.matches/v.count:0}));const sorted=rates.sort((a,b)=>a.avgMatchRate-b.avgMatchRate);
const minRate=sorted[0]?.avgMatchRate??0,maxRate=sorted[sorted.length-1]?.avgMatchRate??1;const dir=maxRate>0?minRate/maxRate:1;
const biasTypes:string[]=[],affected:string[]=[];if(dir<0.8){biasTypes.push('income_based_visibility_bias');affected.push(sorted[0]?.group??'unknown');}
if(biasTypes.length)writeAuditLog('ai.socioeconomic_bias',{disparateImpactRatio:dir,affectedGroups:affected}).catch(()=>{});
return{biasDetected:biasTypes.length>0,biasType:biasTypes,affectedDemographics:affected,disparateImpactRatio:Math.round(dir*100)/100,recommendation:dir<0.8?`Socioeconomic bias detected. ${affected.join(', ')} group under-represented. Review visibility algorithm.`:dir<0.9?'Minor socioeconomic disparity. Monitor.':'No significant socioeconomic bias detected.'};}
export const socioeconomicBias=detectSocioeconomicBias;export const visibilityBias=detectSocioeconomicBias;export const classBasedBias=detectSocioeconomicBias;

export interface AiDataMinimizationResult{compliant:boolean;excessFields:string[];recommendation:string;}
export function enforceAiDataMinimization(requestedFields:string[],purposeAllowedFields:Record<string,string[]>,purpose:string):AiDataMinimizationResult{
const allowed=purposeAllowedFields[purpose]??[];const excess=requestedFields.filter(f=>!allowed.includes(f));
if(excess.length)writeAuditLog('ai.data_minimization_violation',{purpose,excessFields:excess}).catch(()=>{});
return{compliant:excess.length===0,excessFields:excess,recommendation:excess.length>0?`Remove fields not needed for ${purpose}: ${excess.join(', ')}`.trim():'Data request is minimal and compliant.'};}
export const aiDataMinimization=enforceAiDataMinimization;export const dataMinimize=enforceAiDataMinimization;

export interface TrainingOptOutResult{optedOut:boolean;userId:string;dataExcluded:string[];effectiveDate:string;}
const trainingOptOuts=new Set<string>();
export function enforceTrainingDataOptOut(userId:string,optOut:boolean):TrainingOptOutResult{
if(optOut)trainingOptOuts.add(userId);else trainingOptOuts.delete(userId);
const excluded=optOut?['messages','swipe_history','profile_data','behavioral_patterns']:[];
if(optOut)writeAuditLog('ai.training_opt_out',{userId,excluded}).catch(()=>{});
return{optedOut:optOut,userId,dataExcluded:excluded,effectiveDate:new Date().toISOString()};}
export const trainingOptOut=enforceTrainingDataOptOut;export const excludeFromTraining=enforceTrainingDataOptOut;

export interface ConciergeSafetyResult{allowed:boolean;boundary:string|null;sanitizedResponse:string;}
const CONCIERGE_BOUNDARIES=['do not impersonate user','do not share private data','do not provide financial advice','do not provide medical advice','do not facilitate harm'];
export function enforceConciergeSafetyBoundary(response:string,requestType:string):ConciergeSafetyResult{
const violations=CONCIERGE_BOUNDARIES.filter(b=>{if(b==='do not impersonate user'&&/I am [A-Z][a-z]+, your match/i.test(response))return true;if(b==='do not provide financial advice'&&/invest|buy stocks|send money|crypto/i.test(response))return true;if(b==='do not provide medical advice'&&/take medication|diagnosis|treatment/i.test(response))return true;return false;});
const sanitized=violations.length>0?'[AI response removed: safety boundary violation]':sanitizeModelOutput(response);
if(violations.length)writeAuditLog('ai.concierge_boundary_violation',{requestType,violations}).catch(()=>{});
return{allowed:violations.length===0,boundary:violations[0]??null,sanitizedResponse:sanitized};}
export const conciergeSafety=enforceConciergeSafetyBoundary;export const agentBoundary=enforceConciergeSafetyBoundary;

export interface AgentImpersonationResult{detected:boolean;signals:string[];action:'allow'|'flag'|'block';}
export function detectAgentImpersonation(message:string,senderIsAi:boolean):AgentImpersonationResult{
const signals:string[]=[];
if(senderIsAi&&/I am [A-Z][a-z]+|My name is [A-Z]/i.test(message))signals.push('ai_claiming_human_identity');
if(/this is a real person|I am not a bot|I am human/i.test(message)&&senderIsAi)signals.push('ai_denying_ai_nature');
if(/official myarchetype|platform representative|customer support/i.test(message)&&senderIsAi)signals.push('ai_impersonating_platform');
const action=signals.length>=2?'block':signals.length>=1?'flag':'allow';
if(action!=='allow')writeAuditLog('ai.agent_impersonation',{signals,action}).catch(()=>{});
return{detected:signals.length>0,signals,action};}
export const agentImpersonation=detectAgentImpersonation;export const aiImpersonation=detectAgentImpersonation;

export interface NovelScamScriptResult{detected:boolean;noveltyScore:number;closestKnownScript:string|null;recommendation:string;}
const KNOWN_SCAM_SIGNATURES=['investment guaranteed','oil rig','customs fee','release funds','i love you already','my pastor said','send gift card','bitcoin address','i am a soldier deployed'];
export function detectNovelScamScript(message:string):NovelScamScriptResult{
const lower=message.toLowerCase();let maxSim=0,closest:string|null=null;
for(const sig of KNOWN_SCAM_SIGNATURES){const words=sig.split(' ');const matches=words.filter(w=>lower.includes(w)).length;const sim=matches/words.length;if(sim>maxSim){maxSim=sim;closest=sig;}}
const noveltyScore=Math.max(0,1-maxSim);const detected=maxSim>=0.4||/send\s+(money|cash|\$|bitcoin|gift\s*card)/i.test(message);
if(detected)writeAuditLog('ai.novel_scam_script',{noveltyScore,closestKnownScript:closest}).catch(()=>{});
return{detected,noveltyScore:Math.round(noveltyScore*100)/100,closestKnownScript:closest,recommendation:detected?noveltyScore>0.7?'Potentially novel scam script. Add to training data and flag.':'Known scam pattern detected. Block and report.':'No scam script detected.'};}
export const novelScamScript=detectNovelScamScript;export const unknownScamDetect=detectNovelScamScript;

export interface SlowBurnScamResult{detected:boolean;arcStage:'benign'|'trust_building'|'crisis_intro'|'financial_ask';riskScore:number;recommendation:string;}
export function detectSlowBurnScamArc(conversationArc:{daysSinceFirst:number;loveDeclarationDays?:number;crisisIntroducedDays?:number;financialAskDays?:number;messageCount:number}):SlowBurnScamResult{
let stage:SlowBurnScamArc['arcStage']='benign' as SlowBurnScamResult['arcStage'];let riskScore=0;
if(conversationArc.financialAskDays!==undefined){stage='financial_ask';riskScore=1.0;}
else if(conversationArc.crisisIntroducedDays!==undefined){stage='crisis_intro';riskScore=0.75;}
else if(conversationArc.loveDeclarationDays!==undefined){const earlyLove=conversationArc.loveDeclarationDays<14;stage='trust_building';riskScore=earlyLove?0.6:0.3;}
if(conversationArc.loveDeclarationDays!==undefined&&conversationArc.crisisIntroducedDays!==undefined&&conversationArc.financialAskDays!==undefined)riskScore=Math.min(riskScore+0.2,1);
if(riskScore>=0.5)writeAuditLog('ai.slow_burn_scam_arc',{stage,riskScore,days:conversationArc.daysSinceFirst}).catch(()=>{});
return{detected:riskScore>=0.5,arcStage:stage,riskScore:Math.round(riskScore*100)/100,recommendation:stage==='financial_ask'?'Financial request detected in romance arc. High scam probability.':stage==='crisis_intro'?'Crisis narrative introduced. Monitor for financial ask.':stage==='trust_building'?'Rapid love declaration. Monitor relationship arc.':'No scam arc detected.'};}
type SlowBurnScamArc = SlowBurnScamResult;
export const slowBurnScam=detectSlowBurnScamArc;export const romanceArcScam=detectSlowBurnScamArc;