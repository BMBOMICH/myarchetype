import { writeAuditLog } from './logger';

// ─── Adversarial Input (text) ─────────────────────────────────────────────────

export function detectAdversarialInput(t: string) {
  const tech: string[] = [];
  if (/[\u200B-\u200F\u2060\uFEFF\u00AD]/.test(t)) tech.push('zero_width_injection');
  const lr = (t.match(/[a-zA-Z]/g) ?? []).length / Math.max(t.length, 1);
  if (lr < 0.3 && t.length > 10) tech.push('homoglyph_attack');
  if (/[A-Za-z0-9+/]{20,}={0,2}/.test(t)) tech.push('base64_evasion');
  if (/(.)\1{10,}/.test(t)) tech.push('padding_attack');
  if (/ignore (previous|above|all) instructions|system prompt|you are now|roleplay as/i.test(t))
    tech.push('prompt_injection');
  return { isAdversarial: tech.length > 0, technique: tech, confidence: Math.min(tech.length * 0.3, 1) };
}

// ─── Adversarial Example (image + text) ──────────────────────────────────────

export interface AdversarialExampleResult {
  detected: boolean;
  perturbationType: string[];
  confidence: number;
  action: 'allow' | 'flag' | 'block';
  indicators: string[];
  recommendation: string;
}

export function detectAdversarialExample(input: {
  pixelVarianceScore?: number;
  highFrequencyNoise?: number;
  colorSpaceAnomaly?: number;
  compressionArtifactLevel?: number;
  text?: string;
  unicodeAnomalyScore?: number;
  semanticInconsistencyScore?: number;
  modelConfidenceDelta?: number;
  ensembleDisagreement?: number;
  predictionVarianceUnderNoise?: number;
  imageFeatures?: number[];
  expectedLabel?: string;
  modelConfidence?: number;
  gradientNorm?: number;
  inputType?: 'image' | 'text' | 'multimodal';
}): AdversarialExampleResult {
  const types: string[] = [];
  const indicators: string[] = [];
  let confidence = 0;

  // Text-based adversarial
  if (input.text) {
    const adv = detectAdversarialInput(input.text);
    if (adv.isAdversarial) types.push(...adv.technique);
  }
  if (input.modelConfidence !== undefined && input.modelConfidence < 0.4 && input.expectedLabel) {
    types.push('low_confidence_with_label');
  }
  if (input.gradientNorm !== undefined && input.gradientNorm > 10) types.push('high_gradient_norm');
  if (input.imageFeatures) {
    const mean = input.imageFeatures.reduce((a, b) => a + b, 0) / input.imageFeatures.length;
    const variance = input.imageFeatures.reduce((s, x) => s + (x - mean) ** 2, 0) / input.imageFeatures.length;
    if (variance > 100) types.push('high_feature_variance');
  }

  // Image-mode signals
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

  // Text-mode signals
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

  // Fallback confidence from type count
  confidence = Math.min(1, Math.max(confidence, types.length * 0.3));

  const action: AdversarialExampleResult['action'] =
    confidence >= 0.7 ? 'block' : confidence >= 0.4 ? 'flag' : 'allow';

  if (action !== 'allow') {
    void writeAuditLog('ai.adversarial_example', {
      inputType: input.inputType ?? 'text', perturbationTypes: types, confidence, action,
    }).catch(() => {});
  }

  return {
    detected: confidence >= 0.3,
    perturbationType: types,
    confidence: Math.round(confidence * 100) / 100,
    action,
    indicators,
    recommendation:
      action === 'block' ? 'High-confidence adversarial input. Block and log for ART/Foolbox analysis.'
      : action === 'flag' ? 'Possible adversarial input. Flag for human review.'
      :                     'Input appears clean.',
  };
}

export const adversarialExample  = detectAdversarialExample;
export const adversarialDetect   = detectAdversarialExample;
export const artDetection        = detectAdversarialExample;
export const perturbationDetect  = detectAdversarialExample;

// ─── Model Confidence Calibration ─────────────────────────────────────────────

export interface ConfidenceCalibrationResult {
  calibrated: boolean;
  rawConfidence: number;
  calibratedConfidence: number;
  method: 'temperature_scaling' | 'platt_scaling' | 'isotonic' | 'passthrough';
  expectedCalibrationError: number;
  maxCalibrationError: number;
  reliabilityBin: string;
  recommendation: string;
  temperatureScaling?: number;
}

export function calibrateModelConfidence(
  rawOrPredictions: number | Array<{ confidence: number; correct: boolean }>,
  optionsOrBins: {
    temperature?: number;
    plattA?: number;
    plattB?: number;
    method?: 'temperature_scaling' | 'platt_scaling' | 'isotonic' | 'passthrough';
    historicalECE?: number;
  } | number = {},
): ConfidenceCalibrationResult {
  // Overload: called with predictions array (bin-based ECE)
  if (Array.isArray(rawOrPredictions)) {
    const predictions = rawOrPredictions;
    const bins = typeof optionsOrBins === 'number' ? optionsOrBins : 10;
    if (predictions.length < 50) {
      return {
        calibrated: true, rawConfidence: 0, calibratedConfidence: 0,
        method: 'passthrough', expectedCalibrationError: 0, maxCalibrationError: 0,
        reliabilityBin: 'unknown', recommendation: 'Insufficient data for calibration.',
      };
    }
    const binSize = 1 / bins;
    let ece = 0, mce = 0;
    for (let i = 0; i < bins; i++) {
      const lo = i * binSize, hi = (i + 1) * binSize;
      const bp = predictions.filter(p => p.confidence >= lo && p.confidence < hi);
      if (bp.length === 0) continue;
      const avgConf = bp.reduce((s, p) => s + p.confidence, 0) / bp.length;
      const accuracy = bp.filter(p => p.correct).length / bp.length;
      const gap = Math.abs(avgConf - accuracy);
      ece += gap * (bp.length / predictions.length);
      mce = Math.max(mce, gap);
    }
    const calibrated = ece < 0.1 && mce < 0.2;
    const temperature = ece > 0.15 ? 1.5 : ece > 0.1 ? 1.2 : 1.0;
    if (!calibrated) {
      void writeAuditLog('ai.calibration_needed', { ece, mce, temperature }).catch(() => {});
    }
    return {
      calibrated,
      rawConfidence: 0,
      calibratedConfidence: 0,
      method: 'temperature_scaling',
      expectedCalibrationError: Math.round(ece * 1000) / 1000,
      maxCalibrationError: Math.round(mce * 1000) / 1000,
      reliabilityBin: 'binned',
      temperatureScaling: calibrated ? undefined : temperature,
      recommendation: calibrated
        ? 'Model is well calibrated.'
        : ece > 0.15
        ? `Poor calibration (ECE=${ece.toFixed(3)}). Apply temperature scaling T=${temperature}.`
        : 'Moderate calibration error. Consider temperature scaling.',
    };
  }

  // Overload: called with raw confidence scalar
  const rawConfidence = rawOrPredictions;
  const options = typeof optionsOrBins === 'object' ? optionsOrBins : {};
  const method = options.method ?? 'temperature_scaling';
  const temp = options.temperature ?? 1.5;
  let calibrated = rawConfidence;

  if (method === 'temperature_scaling') {
    const logit = Math.log(rawConfidence / Math.max(1 - rawConfidence, 1e-9));
    calibrated = 1 / (1 + Math.exp(-logit / temp));
  } else if (method === 'platt_scaling') {
    const A = options.plattA ?? -1.5;
    const B = options.plattB ?? 0.5;
    calibrated = 1 / (1 + Math.exp(A * rawConfidence + B));
  } else if (method === 'isotonic') {
    calibrated = Math.max(0.05, Math.min(0.95, rawConfidence * 0.9));
  }

  calibrated = Math.max(0, Math.min(1, calibrated));
  const ece = options.historicalECE ?? Math.abs(calibrated - rawConfidence) * 0.5;
  const isCalibrated = ece < 0.1;
  const bin = calibrated >= 0.9 ? 'very_high'
    : calibrated >= 0.7 ? 'high'
    : calibrated >= 0.5 ? 'medium'
    : calibrated >= 0.3 ? 'low' : 'very_low';

  return {
    calibrated: isCalibrated,
    rawConfidence: Math.round(rawConfidence * 1000) / 1000,
    calibratedConfidence: Math.round(calibrated * 1000) / 1000,
    method,
    expectedCalibrationError: Math.round(ece * 1000) / 1000,
    maxCalibrationError: 0,
    reliabilityBin: bin,
    recommendation: ece >= 0.15
      ? `ECE ${ece.toFixed(3)} too high. Retrain calibration with Netcal or temperature re-tuning.`
      : ece >= 0.1
      ? 'Moderate calibration error. Monitor and consider re-calibration.'
      : 'Model confidence well calibrated.',
  };
}

export const confidenceCalibration = calibrateModelConfidence;
export const calibrateModel        = calibrateModelConfidence;
export const temperatureScaling    = calibrateModelConfidence;

// ─── Distribution Shift Monitor ───────────────────────────────────────────────

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
  baselineDistribution: number[];
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
    if (fprDelta > 0.05) { localTypes.push('fpr_drift'); detectorDrift = Math.max(detectorDrift, fprDelta); }

    const fnrDelta = Math.abs(m.currentFnr - m.baselineFnr);
    if (fnrDelta > 0.05) { localTypes.push('fnr_drift'); detectorDrift = Math.max(detectorDrift, fnrDelta); }

    if (m.baselineDistribution.length === m.currentDistribution.length) {
      let klDiv = 0;
      for (let i = 0; i < m.baselineDistribution.length; i++) {
        const p = Math.max(m.baselineDistribution[i]!, 1e-9);
        const q = Math.max(m.currentDistribution[i]!, 1e-9);
        klDiv += p * Math.log(p / q);
      }
      if (klDiv > 0.1) { localTypes.push('input_distribution_shift'); detectorDrift = Math.max(detectorDrift, Math.min(klDiv, 1)); }
    }

    if (detectorDrift > 0.05) {
      affected.push(m.detectorId);
      driftTypes.push(...localTypes.filter(t => !driftTypes.includes(t)));
      maxDrift = Math.max(maxDrift, detectorDrift);
    }
  }

  const action: DriftMonitorResult['action'] =
    maxDrift >= 0.3 ? 'rollback' : maxDrift >= 0.2 ? 'retrain' : maxDrift >= 0.1 ? 'alert' : 'none';

  if (action !== 'none') {
    void writeAuditLog('ai.distribution_shift', { affectedDetectors: affected, maxDrift, action, driftTypes }).catch(() => {});
  }

  return {
    driftDetected: affected.length > 0,
    driftScore: Math.round(maxDrift * 100) / 100,
    affectedDetectors: affected,
    action,
    driftType: driftTypes,
    recommendation:
      action === 'rollback' ? 'Critical drift. Roll back to previous model version immediately.'
      : action === 'retrain' ? `Significant drift in: ${affected.join(', ')}. Retrain with Evidently AI monitoring.`
      : action === 'alert'   ? 'Moderate drift detected. Increase monitoring frequency.'
      :                        'No significant distribution shift detected.',
  };
}

export const distributionShift = monitorDistributionShift;
export const modelDrift        = monitorDistributionShift;

// ─── Detector Drift Monitor ───────────────────────────────────────────────────

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
  baselineLatencyMs?: number;
  currentLatencyMs?: number;
  windowDays?: number;
}>): DetectorDriftResult[] {
  return metrics.map(m => {
    const fprDelta = Math.abs(m.currentFpr - m.baselineFpr);
    const fnrDelta = Math.abs(m.currentFnr - m.baselineFnr);
    const precDelta = m.baselinePrecision !== undefined && m.currentPrecision !== undefined
      ? Math.abs(m.currentPrecision - m.baselinePrecision) : 0;
    const recDelta = m.baselineRecall !== undefined && m.currentRecall !== undefined
      ? Math.abs(m.currentRecall - m.baselineRecall) : 0;

    // Also factor in latency drift if provided (scaled to 0-1)
    const latScore = (m.baselineLatencyMs !== undefined && m.currentLatencyMs !== undefined)
      ? Math.abs(m.currentLatencyMs - m.baselineLatencyMs) / (m.baselineLatencyMs + 1)
      : 0;

    const maxDelta = Math.max(fprDelta, fnrDelta, precDelta, recDelta, latScore * 0.3);
    const severity: DetectorDriftResult['driftSeverity'] =
      maxDelta >= 0.15 ? 'severe' : maxDelta >= 0.08 ? 'moderate' : maxDelta >= 0.03 ? 'minor' : 'none';

    const action: DetectorDriftResult['action'] =
      severity === 'severe' ? 'disable' : severity === 'moderate' ? 'retrain'
      : severity === 'minor' ? 'alert' : 'none';

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
        action === 'disable' ? `Detector ${m.detectorId} severely drifted. Disable and retrain immediately.`
        : action === 'retrain' ? `Detector ${m.detectorId} moderately drifted. Schedule retraining with Evidently AI.`
        : action === 'alert'   ? `Detector ${m.detectorId} showing minor drift. Monitor closely.`
        :                        `Detector ${m.detectorId} is stable.`,
    };
  });
}

export const detectorDriftMonitor = monitorDetectorDrift;
export const driftDetection       = monitorDetectorDrift;
export const detectorDrift        = monitorDetectorDrift;
export const driftMonitor         = monitorDetectorDrift;
export const performanceDrift     = monitorDetectorDrift;

// ─── Model Drift Evaluation ───────────────────────────────────────────────────

export function evaluateModelDrift(
  b: { fp: number; fn: number; predictions: number[] },
  c: { fp: number; fn: number; predictions: number[] },
) {
  const ds = Math.abs((c.fp - b.fp) / (b.fp + 0.001) + (c.fn - b.fn) / (b.fn + 0.001));
  const fnD = c.fn > b.fn * 1.5, fpD = c.fp > b.fp * 2;
  const act = fnD ? 'rollback' : fpD ? 'retrain' : ds > 0.2 ? 'alert' : 'none';
  if (act !== 'none') {
    void writeAuditLog('ai.model_drift_detected', { driftScore: ds, action: act }).catch(() => {});
  }
  return { driftScore: ds, degraded: fnD || fpD, action: act };
}

// ─── Model Inversion Attack ───────────────────────────────────────────────────

export interface ModelInversionResult {
  risk: 'none' | 'low' | 'medium' | 'high';
  indicators: string[];
  recommendation: string;
  action: 'allow' | 'rate_limit' | 'block';
}

export function detectModelInversionAttack(
  queries: Array<{ input: string; timestamp: number; userId: string }>,
  userId: string,
  windowMs = 3_600_000,
): ModelInversionResult {
  const now = Date.now();
  const userQ = queries.filter(q => q.userId === userId && now - q.timestamp < windowMs);
  const indicators: string[] = [];

  if (userQ.length > 100) indicators.push(`high_query_volume:${userQ.length}`);
  const inputs = userQ.map(q => q.input);
  const uniqueInputs = new Set(inputs).size;
  if (userQ.length > 20 && uniqueInputs / userQ.length < 0.3) indicators.push('low_input_diversity');
  const systematicPattern = /^(.{1,5})\1+$/.test(inputs.slice(-10).join(''));
  if (systematicPattern) indicators.push('systematic_probing_pattern');
  const avgLen = inputs.reduce((s, i) => s + i.length, 0) / Math.max(inputs.length, 1);
  if (avgLen < 5 && userQ.length > 50) indicators.push('very_short_systematic_inputs');

  const risk: ModelInversionResult['risk'] =
    indicators.length >= 3 ? 'high' : indicators.length >= 2 ? 'medium'
    : indicators.length >= 1 ? 'low' : 'none';
  const action: ModelInversionResult['action'] =
    risk === 'high' ? 'block' : risk === 'medium' ? 'rate_limit' : 'allow';

  if (risk !== 'none') {
    void writeAuditLog('ai.model_inversion_risk', { userId, indicators, risk }).catch(() => {});
  }

  return {
    risk, indicators, action,
    recommendation:
      risk === 'high' ? 'Block user. Likely model inversion attack.'
      : risk === 'medium' ? 'Rate limit. Monitor for model inversion.'
      : risk !== 'none' ? 'Monitor query patterns.'
      :                   'No model inversion risk detected.',
  };
}

export const modelInversion = detectModelInversionAttack;
export const inversionAttack = detectModelInversionAttack;
export const privacyAttack   = detectModelInversionAttack;

// ─── Membership Inference Attack ──────────────────────────────────────────────

export interface MembershipInferenceResult {
  risk: 'none' | 'low' | 'medium' | 'high';
  confidence: number;
  recommendation: string;
}

export function detectMembershipInferenceAttack(
  modelConfidences: number[],
  threshold = 0.95,
): MembershipInferenceResult {
  if (modelConfidences.length < 5) {
    return { risk: 'none', confidence: 0, recommendation: 'Insufficient data.' };
  }
  const highConf = modelConfidences.filter(c => c >= threshold).length / modelConfidences.length;
  const avgConf = modelConfidences.reduce((a, b) => a + b, 0) / modelConfidences.length;
  const risk: MembershipInferenceResult['risk'] =
    highConf >= 0.8 && avgConf >= 0.9 ? 'high'
    : highConf >= 0.6 ? 'medium' : highConf >= 0.3 ? 'low' : 'none';

  if (risk !== 'none') {
    void writeAuditLog('ai.membership_inference_risk', { highConfidenceRatio: highConf, avgConfidence: avgConf, risk }).catch(() => {});
  }

  return {
    risk, confidence: avgConf,
    recommendation:
      risk === 'high' ? 'Apply differential privacy. High membership inference risk.'
      : risk !== 'none' ? 'Monitor confidence distributions. Consider output perturbation.'
      :                   'Membership inference risk within acceptable bounds.',
  };
}

export const membershipInference = detectMembershipInferenceAttack;
export const inferenceAttack     = detectMembershipInferenceAttack;
export const memberInfer         = detectMembershipInferenceAttack;

// ─── AI Photo Editing ─────────────────────────────────────────────────────────

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
  softwareTag?: string;
  aiGeneratedMetadata?: boolean;
  c2paPresent?: boolean;
  c2paClaimsAi?: boolean;
  skinSmoothingLevel?: number;
  featureAlterationScore?: number;
  backgroundReplaced?: boolean;
  bodyProportionAlteration?: number;
  elaScore?: number;
  noiseInconsistency?: number;
  estimatedAgeShift?: number;
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
      intensityScore += 0.5; confidence += 0.6;
    }
  }
  if (signals.aiGeneratedMetadata) {
    editTypes.push('ai_generated'); indicators.push('ai_generation_metadata_flag');
    intensityScore += 0.9; confidence += 0.8;
  }
  if (signals.c2paPresent && signals.c2paClaimsAi) {
    editTypes.push('c2pa_ai_claim'); indicators.push('c2pa_content_credentials_ai');
    intensityScore += 0.7; confidence += 0.9;
  }
  if ((signals.skinSmoothingLevel ?? 0) > 0.6) {
    editTypes.push('heavy_skin_smoothing');
    indicators.push(`skin_smoothing:${signals.skinSmoothingLevel}`);
    intensityScore += signals.skinSmoothingLevel! * 0.4; confidence += 0.4;
  }
  if ((signals.featureAlterationScore ?? 0) > 0.4) {
    editTypes.push('facial_feature_alteration');
    indicators.push(`feature_alteration:${signals.featureAlterationScore}`);
    intensityScore += signals.featureAlterationScore! * 0.5; confidence += 0.45;
  }
  if (signals.backgroundReplaced) {
    editTypes.push('background_replacement'); indicators.push('background_replaced');
    intensityScore += 0.2; confidence += 0.3;
  }
  if ((signals.bodyProportionAlteration ?? 0) > 0.3) {
    editTypes.push('body_proportion_alteration');
    indicators.push(`body_alteration:${signals.bodyProportionAlteration}`);
    intensityScore += signals.bodyProportionAlteration! * 0.6; confidence += 0.5;
  }
  if ((signals.elaScore ?? 0) > 0.6) {
    editTypes.push('ela_edit_detected'); indicators.push(`ela_score:${signals.elaScore}`);
    confidence += 0.4;
  }
  if ((signals.noiseInconsistency ?? 0) > 0.5) {
    editTypes.push('noise_inconsistency'); indicators.push('composite_image_likely');
    confidence += 0.35;
  }
  if (Math.abs(signals.estimatedAgeShift ?? 0) >= 5) {
    editTypes.push('age_misrepresentation');
    indicators.push(`estimated_age_shift:${signals.estimatedAgeShift}yr`);
    intensityScore += 0.5; confidence += 0.5;
  }

  intensityScore = Math.min(1, intensityScore);
  confidence = Math.min(1, confidence);

  const editIntensity: AIPhotoEditResult['editIntensity'] =
    intensityScore >= 0.8 ? 'deceptive' : intensityScore >= 0.6 ? 'major'
    : intensityScore >= 0.35 ? 'moderate' : intensityScore >= 0.1 ? 'minor' : 'none';

  const withinBoundary = editIntensity !== 'deceptive' && editIntensity !== 'major';
  const action: AIPhotoEditResult['action'] =
    editIntensity === 'deceptive' ? 'reject' : editIntensity === 'major' ? 'warn'
    : editIntensity === 'moderate' ? 'label' : 'allow';

  const requiredLabel =
    editIntensity === 'moderate' || editIntensity === 'major' ? 'Photo may be edited or AI-enhanced'
    : editIntensity === 'deceptive' ? 'Photo appears significantly altered — may not reflect real appearance'
    : undefined;

  if (action !== 'allow') {
    void writeAuditLog('ai.photo_edit_boundary', { editTypes, editIntensity, confidence, action }).catch(() => {});
  }

  return {
    withinBoundary, editType: editTypes, editIntensity, indicators,
    confidence: Math.round(confidence * 100) / 100, action, requiredLabel,
    recommendation:
      action === 'reject' ? 'Photo is deceptively edited. Reject and request authentic photo.'
      : action === 'warn' ? 'Major editing detected. Warn user about authenticity standards.'
      : action === 'label' ? 'Moderate AI editing. Apply transparency label.'
      :                      'Photo editing within acceptable bounds.',
  };
}

export const aiPhotoEdit      = detectAIPhotoEditing;
export const photoEditBoundary = detectAIPhotoEditing;
export const photoAuthenticity = detectAIPhotoEditing;

// ─── Agent-to-Agent Detection ─────────────────────────────────────────────────

export interface AgentToAgentResult {
  detected: boolean;
  confidence: number;
  signals: string[];
  interactionType: 'human_human' | 'human_ai' | 'ai_ai' | 'uncertain';
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'allow' | 'flag' | 'block' | 'require_human_verification';
  recommendation: string;
}

const AGENT_SIGNALS_PATTERNS = [
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
  metadata?: { responseTimeMs?: number; typingPatternScore?: number; sessionId?: string; userAgent?: string };
}>): AgentToAgentResult {
  const signals: string[] = [];
  let confidence = 0;
  const allContent = messages.map(m => m.content).join('\n');
  const senderIds = [...new Set(messages.map(m => m.senderId))];

  for (const { p, signal, weight } of AGENT_SIGNALS_PATTERNS) {
    if (p.test(allContent)) { signals.push(signal); confidence += weight; }
  }

  const responseTimes = messages
    .map(m => m.metadata?.responseTimeMs ?? null)
    .filter((t): t is number => t !== null);

  if (responseTimes.length >= 3) {
    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const stdDev = Math.sqrt(responseTimes.reduce((s, t) => s + (t - avg) ** 2, 0) / responseTimes.length);
    if (stdDev < 200 && avg < 2000) { signals.push('robotic_response_timing'); confidence += 0.4; }
    if (avg < 500 && responseTimes.every(t => t < 1000)) { signals.push('sub_second_responses'); confidence += 0.45; }
  }

  const typingScores = messages
    .map(m => m.metadata?.typingPatternScore ?? null)
    .filter((t): t is number => t !== null);
  if (typingScores.length >= 3) {
    const avgTyping = typingScores.reduce((a, b) => a + b, 0) / typingScores.length;
    if (avgTyping < 0.2) { signals.push('robotic_typing_pattern'); confidence += 0.4; }
  }

  const userAgents = messages.map(m => m.metadata?.userAgent ?? '').filter(Boolean);
  if (userAgents.some(ua => /bot|crawler|spider|automated|langchain|openai|anthropic/i.test(ua))) {
    signals.push('bot_user_agent'); confidence += 0.7;
  }

  if (senderIds.length >= 2 && responseTimes.length >= 4) {
    const roboticCount = signals.filter(s =>
      ['robotic_response_timing', 'sub_second_responses', 'robotic_typing_pattern'].includes(s)
    ).length;
    if (roboticCount >= 2) { signals.push('both_sides_automated'); confidence += 0.5; }
  }

  confidence = Math.min(1, confidence);

  const interactionType: AgentToAgentResult['interactionType'] =
    confidence >= 0.7 && signals.includes('both_sides_automated') ? 'ai_ai'
    : confidence >= 0.5 ? 'human_ai' : confidence >= 0.3 ? 'uncertain' : 'human_human';

  const riskLevel: AgentToAgentResult['riskLevel'] =
    interactionType === 'ai_ai' ? 'high' : interactionType === 'human_ai' ? 'medium'
    : interactionType === 'uncertain' ? 'low' : 'none';

  const action: AgentToAgentResult['action'] =
    riskLevel === 'high' ? 'block' : riskLevel === 'medium' ? 'require_human_verification'
    : riskLevel === 'low' ? 'flag' : 'allow';

  if (riskLevel !== 'none') {
    void writeAuditLog('ai.agent_to_agent', { interactionType, confidence, signals, action }).catch(() => {});
  }

  return {
    detected: confidence >= 0.3,
    confidence: Math.round(confidence * 100) / 100,
    signals, interactionType, riskLevel, action,
    recommendation:
      interactionType === 'ai_ai' ? 'Both sides appear automated. Block and require human verification.'
      : interactionType === 'human_ai' ? 'One side appears to be an AI agent. Require CAPTCHA or liveness check.'
      : confidence >= 0.3 ? 'Uncertain. Flag for human review.'
      :                     'Interaction appears human-to-human.',
  };
}

export const agentToAgent   = detectAgentToAgentInteraction;
export const aiAgentDetect  = detectAgentToAgentInteraction;
export const botInteraction  = detectAgentToAgentInteraction;

// ─── Agent Impersonation ──────────────────────────────────────────────────────

export interface AgentImpersonationResult {
  detected: boolean;
  signals: string[];
  action: 'allow' | 'flag' | 'block';
}

export function detectAgentImpersonation(message: string, senderIsAi: boolean): AgentImpersonationResult {
  const signals: string[] = [];
  if (senderIsAi && /I am [A-Z][a-z]+|My name is [A-Z]/i.test(message)) signals.push('ai_claiming_human_identity');
  if (/this is a real person|I am not a bot|I am human/i.test(message) && senderIsAi) signals.push('ai_denying_ai_nature');
  if (/official myarchetype|platform representative|customer support/i.test(message) && senderIsAi) signals.push('ai_impersonating_platform');
  const action: AgentImpersonationResult['action'] =
    signals.length >= 2 ? 'block' : signals.length >= 1 ? 'flag' : 'allow';
  if (action !== 'allow') {
    void writeAuditLog('ai.agent_impersonation', { signals, action }).catch(() => {});
  }
  return { detected: signals.length > 0, signals, action };
}

export const agentImpersonation = detectAgentImpersonation;
export const aiImpersonation    = detectAgentImpersonation;

// ─── AI Hallucination ─────────────────────────────────────────────────────────

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
  groundingDocuments?: string[];
  knownFacts?: Record<string, string>;
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
        const matchRatio = truthWords.length > 0
          ? truthWords.filter(w => text.toLowerCase().includes(w)).length / truthWords.length : 1;
        if (matchRatio < 0.3) {
          types.push('factual_contradiction');
          indicators.push(`claim_contradiction:${claim.slice(0, 40)}`);
          hallucinationScore += 0.5; groundingScore -= 0.3;
        }
      }
    }
  }

  if (content.groundingDocuments?.length) {
    const textWords = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const groundingWords = new Set(content.groundingDocuments.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const overlap = [...textWords].filter(w => groundingWords.has(w)).length;
    const overlapRatio = textWords.size > 0 ? overlap / textWords.size : 0;
    groundingScore = overlapRatio;
    if (overlapRatio < 0.2) {
      types.push('low_grounding_overlap');
      indicators.push(`grounding_overlap:${Math.round(overlapRatio * 100)}%`);
      hallucinationScore += 0.4;
    }
  }

  const PATTERNS: Array<{ p: RegExp; type: string; weight: number }> = [
    { p: /\b(studies show|research proves|experts say|scientists confirm)\b.*\b(always|never|100%|guaranteed)\b/i, type: 'false_certainty', weight: 0.4 },
    { p: /\b(according to|based on)\s+(our|the)\s+(records?|data|files?)\b.*\b(you have|you are|your profile shows)\b/i, type: 'fabricated_user_data', weight: 0.7 },
    { p: /\b(you matched with|your compatibility score is|you have \d+ things? in common)\b/i, type: 'fabricated_match_data', weight: 0.6 },
    { p: /\b(call|contact|reach out to)\s+(our\s+)?(support|team|hotline)\s+at\s+(\+?[\d\-\(\)\s]{7,})/i, type: 'fabricated_contact_info', weight: 0.8 },
    { p: /\bhttps?:\/\/(?!myarchetype\.app|thehotline\.org|rainn\.org|fbi\.gov)\S+/i, type: 'unverified_url', weight: 0.5 },
    { p: /\b(legal(ly)?|law|regulation|required by|mandated)\b.*\b(you must|you have to|you are required)\b/i, type: 'false_legal_claim', weight: 0.6 },
  ];

  for (const { p, type, weight } of PATTERNS) {
    if (p.test(text)) { types.push(type); indicators.push(type); hallucinationScore += weight; }
  }

  const isHighStakes = content.platformContext?.isSafetyResource || content.platformContext?.isLegalDisclosure;
  if (isHighStakes && hallucinationScore > 0.1) {
    hallucinationScore += 0.3; indicators.push('high_stakes_context_stricter_threshold');
  }

  hallucinationScore = Math.min(1, hallucinationScore);
  groundingScore = Math.max(0, Math.min(1, groundingScore));
  const confidence = hallucinationScore;

  const action: AIHallucinationResult['action'] =
    confidence >= 0.7 ? 'block' : confidence >= 0.5 ? 'regenerate'
    : confidence >= 0.25 ? 'flag' : 'allow';

  if (action !== 'allow') {
    void writeAuditLog('ai.hallucination_detected', { types, confidence, groundingScore, action, isHighStakes }).catch(() => {});
  }

  return {
    hallucinated: confidence >= 0.25,
    confidence: Math.round(confidence * 100) / 100,
    hallucinationType: types, indicators,
    groundingScore: Math.round(groundingScore * 100) / 100, action,
    recommendation:
      action === 'block' ? 'High-confidence hallucination. Block content and regenerate with grounding.'
      : action === 'regenerate' ? 'Likely hallucination. Regenerate with Vectara HHEM grounding verification.'
      : action === 'flag' ? 'Possible hallucination. Flag for human review before display.'
      :                     'Content appears grounded.',
  };
}

export const aiHallucination    = detectAIHallucination;
export const hallucinationDetect = detectAIHallucination;
export const groundingVerify     = detectAIHallucination;

// ─── Conversation Coherence ───────────────────────────────────────────────────

export interface CoherenceAnalysisResult {
  coherent: boolean;
  coherenceScore: number;
  anomalies: string[];
  botLikelihood: number;
  recommendation: string;
  interactionType: 'human' | 'bot' | 'uncertain';
}

export function analyzeConversationCoherence(messages: Array<{
  content?: string;
  text?: string;
  senderId: string;
  timestamp: number;
  isFromSuspect?: boolean;
}>): CoherenceAnalysisResult {
  const anomalies: string[] = [];
  let incoherenceScore = 0;
  let botScore = 0;

  // Normalise: accept either .content or .text
  const normalised = messages.map(m => ({
    content: m.content ?? m.text ?? '',
    senderId: m.senderId,
    timestamp: m.timestamp,
    isFromSuspect: m.isFromSuspect,
  }));

  const hasSuspectFlag = normalised.some(m => m.isFromSuspect !== undefined);

  if (hasSuspectFlag) {
    const suspectMessages = normalised.filter(m => m.isFromSuspect);
    if (suspectMessages.length < 2) {
      return { coherent: true, coherenceScore: 1, anomalies: [], botLikelihood: 0, recommendation: 'Insufficient messages.', interactionType: 'uncertain' };
    }

    const allContent = suspectMessages.map(m => m.content.toLowerCase());
    const contentCounts = new Map<string, number>();
    for (const c of allContent) {
      const n = c.replace(/\s+/g, ' ').trim();
      contentCounts.set(n, (contentCounts.get(n) ?? 0) + 1);
    }
    if ([...contentCounts.values()].some(v => v >= 2)) {
      anomalies.push('duplicate_messages'); incoherenceScore += 0.35; botScore += 0.4;
    }

    const timestamps = suspectMessages.map(m => m.timestamp).sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) intervals.push(timestamps[i]! - timestamps[i - 1]!);
    if (intervals.length >= 3) {
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const stdDev = Math.sqrt(intervals.reduce((s, t) => s + (t - avg) ** 2, 0) / intervals.length);
      if (stdDev < 5000 && avg < 30_000) { anomalies.push('robotic_message_timing'); botScore += 0.4; }
    }
  } else {
    // Text-only coherence path
    if (normalised.length < 3) {
      return { coherent: true, coherenceScore: 1, anomalies: [], botLikelihood: 0, recommendation: 'Insufficient messages for analysis.', interactionType: 'uncertain' };
    }
    const userMsgs = normalised.filter(m => m.senderId === normalised[0]!.senderId);
    const avgLen = userMsgs.reduce((s, m) => s + m.content.length, 0) / userMsgs.length;
    const lenVar = userMsgs.reduce((s, m) => s + (m.content.length - avgLen) ** 2, 0) / userMsgs.length;
    if (lenVar < 50 && userMsgs.length > 5) anomalies.push('uniform_message_length');

    const texts = userMsgs.map(m => m.content.toLowerCase());
    if (new Set(texts).size / texts.length < 0.5) anomalies.push('high_repetition');
    if (/\bclick here\b|\bhttps?:\/\/\b|\bbit\.ly\b|\btelegram\b|\bwhatsapp\b/i.test(userMsgs.map(m => m.content).join(' ')))
      anomalies.push('link_or_redirect_spam');
  }

  incoherenceScore = Math.min(1, incoherenceScore);
  botScore = Math.min(1, Math.max(botScore, anomalies.length * 0.25));
  const coherenceScore = Math.max(0, 1 - incoherenceScore);
  const interactionType: CoherenceAnalysisResult['interactionType'] =
    botScore >= 0.6 ? 'bot' : botScore >= 0.3 ? 'uncertain' : 'human';

  if (interactionType !== 'human') {
    void writeAuditLog('ai.conversation_coherence', { coherenceScore, botLikelihood: botScore, anomalies, interactionType }).catch(() => {});
  }

  return {
    coherent: coherenceScore >= 0.6,
    coherenceScore: Math.round(coherenceScore * 100) / 100,
    anomalies,
    botLikelihood: Math.round(botScore * 100) / 100,
    recommendation:
      interactionType === 'bot' ? 'High bot likelihood. Flag account and require human verification.'
      : interactionType === 'uncertain' ? 'Possible bot. Monitor and consider CAPTCHA challenge.'
      :                                   'Conversation appears human.',
    interactionType,
  };
}

export const coherenceAnalysis    = analyzeConversationCoherence;
export const conversationCoherence = analyzeConversationCoherence;
export const botLikelihoodScore    = analyzeConversationCoherence;
export const aiCoherence           = analyzeConversationCoherence;

// ─── Deepfake Live Call ───────────────────────────────────────────────────────

export interface DeepfakeLiveCallResult {
  suspectedDeepfake: boolean;
  indicators: string[];
  confidence: number;
  action: 'allow' | 'warn' | 'terminate';
}

export function detectDeepfakeLiveCall(frameMetrics: Array<{
  blinkRate: number;
  lipSyncScore: number;
  facialJitterMs: number;
  skinTextureConsistency: number;
  backgroundConsistency: number;
  timestamp: number;
}>): DeepfakeLiveCallResult {
  if (frameMetrics.length < 3) return { suspectedDeepfake: false, indicators: [], confidence: 0, action: 'allow' };
  const indicators: string[] = [];

  const avg = (fn: (f: typeof frameMetrics[0]) => number) =>
    frameMetrics.reduce((s, f) => s + fn(f), 0) / frameMetrics.length;

  const avgBlink = avg(f => f.blinkRate);
  if (avgBlink < 0.1 || avgBlink > 1.0) indicators.push('abnormal_blink_rate');
  if (avg(f => f.lipSyncScore) < 0.6) indicators.push('poor_lip_sync');
  if (avg(f => f.facialJitterMs) > 50) indicators.push('high_facial_jitter');
  if (avg(f => f.skinTextureConsistency) < 0.5) indicators.push('inconsistent_skin_texture');
  if (avg(f => f.backgroundConsistency) < 0.3) indicators.push('background_inconsistency');

  const blinkVar = frameMetrics.reduce((s, f) => s + (f.blinkRate - avgBlink) ** 2, 0) / frameMetrics.length;
  if (blinkVar < 0.001 && frameMetrics.length > 5) indicators.push('robotic_blink_pattern');

  const confidence = Math.min(indicators.length * 0.18, 1);
  const action: DeepfakeLiveCallResult['action'] =
    confidence >= 0.7 ? 'terminate' : confidence >= 0.4 ? 'warn' : 'allow';

  if (action !== 'allow') {
    void writeAuditLog('ai.deepfake_live_call', { indicators, confidence, action }).catch(() => {});
  }

  return { suspectedDeepfake: confidence >= 0.4, indicators, confidence: Math.round(confidence * 100) / 100, action };
}

export const deepfakeLiveCall  = detectDeepfakeLiveCall;
export const liveCallDeepfake  = detectDeepfakeLiveCall;
export const videoCallDeepfake = detectDeepfakeLiveCall;

// ─── Icebreaker Safety ────────────────────────────────────────────────────────

export interface AiIcebreakerSafetyResult {
  safe: boolean;
  issues: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  filteredContent: string;
  recommendation: string;
  duoGuardCategory?: string;
}

const ICEBREAKER_UNSAFE_PATTERNS: Array<{
  p: RegExp; issue: string; severity: 'low' | 'medium' | 'high'; category: string;
}> = [
  { p: /\b(sex|nude|hook\s*up|dtf|nsfw|body|hot|attractive|naked|explicit|hooking up|one night)\b/i, issue: 'sexual_opener', severity: 'high', category: 'sexual_content' },
  { p: /\b(money|invest|crypto|bitcoin|opportunity|income|earn|give me|send me|need money|gift\s*card)\b/i, issue: 'financial_solicitation', severity: 'high', category: 'financial_scam' },
  { p: /\b(whatsapp|telegram|snapchat|instagram|kik|discord|phone|number)\b/i, issue: 'platform_redirect', severity: 'medium', category: 'off_platform' },
  { p: /\b(ugly|fat|stupid|worthless|boring|basic|loser|pathetic|desperate)\b/i, issue: 'neg_technique', severity: 'medium', category: 'pua_negging' },
  { p: /\b(you\s+look\s+(easy|desperate|lonely|needy))\b/i, issue: 'manipulative_framing', severity: 'medium', category: 'manipulation' },
  { p: /\b(where do you live|your address|your location|meet me at)\b/i, issue: 'location_probing', severity: 'medium', category: 'location_safety' },
  { p: /https?:\/\/\S+/i, issue: 'link_in_icebreaker', severity: 'medium', category: 'link_safety' },
  { p: /\b(god|destiny|universe|meant to be|soulmate)\s+(told|chose|brought|wants)\s+(me|us|you)/i, issue: 'love_bombing_opener', severity: 'low', category: 'love_bombing' },
  { p: /(.)\1{5,}/i, issue: 'spam_pattern', severity: 'low', category: 'spam' },
];

export function scanAiIcebreakerSafety(
  content: string,
  context?: { isFirstMessage?: boolean; recipientAge?: number; age?: number; previousFlags?: number },
): AiIcebreakerSafetyResult {
  if (content.length < 5) {
    return { safe: false, issues: ['too_short'], severity: 'low', filteredContent: content, recommendation: 'Message too short.' };
  }
  if (content.length > 500) {
    return { safe: false, issues: ['too_long'], severity: 'low', filteredContent: content, recommendation: 'Message too long.' };
  }

  const issues: string[] = [];
  let severity: AiIcebreakerSafetyResult['severity'] = 'none';
  let topCategory: string | undefined;
  let filtered = content;

  for (const { p, issue, severity: sev, category } of ICEBREAKER_UNSAFE_PATTERNS) {
    if (p.test(content)) {
      issues.push(issue);
      if (sev === 'high' || (sev === 'medium' && severity !== 'high')) { severity = sev; topCategory = category; }
      if (sev === 'low' && severity === 'none') { severity = 'low'; topCategory = category; }
      filtered = filtered.replace(p, '[filtered]');
    }
  }

  const recipientAge = context?.recipientAge ?? context?.age ?? 18;
  if (recipientAge < 18 && issues.length > 0) severity = 'high';

  const safe = severity === 'none';
  if (!safe) {
    void writeAuditLog('ai.icebreaker_safety', { issues, severity, category: topCategory }).catch(() => {});
  }

  return {
    safe, issues, severity, filteredContent: filtered,
    recommendation:
      severity === 'high' ? 'Icebreaker blocked. Regenerate with DuoGuard/Llama Guard 4 constraints.'
      : severity === 'medium' ? 'Icebreaker flagged. Review before sending.'
      : severity === 'low' ? 'Minor concern. Consider rephrasing.'
      :                      'Icebreaker is safe to send.',
    duoGuardCategory: topCategory,
  };
}

export const aiIcebreakerSafety   = scanAiIcebreakerSafety;
export const icebreakerSafetyScan  = scanAiIcebreakerSafety;
export const scanAIIcebreaker      = scanAiIcebreakerSafety;
export const aiConversationScan    = scanAiIcebreakerSafety;

// ─── Conversation Starter Safety ──────────────────────────────────────────────

export interface AiStarterSafetyResult {
  safe: boolean;
  issues: string[];
  filteredStarter: string;
  severity: 'none' | 'low' | 'medium' | 'high';
}

export function scanAiConversationStarter(
  starter: string,
  context?: { isFirstMessage?: boolean; matchAge?: number },
): AiStarterSafetyResult {
  const result = scanAiIcebreakerSafety(starter, { age: context?.matchAge });
  if (context?.isFirstMessage && /\b(phone|number|whatsapp|telegram|snapchat|instagram|discord)\b/i.test(starter)) {
    result.issues.push('platform_redirect_first_message');
    if (result.severity === 'none') result.severity = 'medium';
  }
  return {
    safe: result.safe && !result.issues.includes('platform_redirect_first_message'),
    issues: result.issues,
    filteredStarter: result.filteredContent,
    severity: result.severity,
  };
}

export const aiStarterSafety      = scanAiConversationStarter;
export const conversationStarterScan = scanAiConversationStarter;
export const aiStarterModerate    = scanAiConversationStarter;