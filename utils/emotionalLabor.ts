import { writeAuditLog } from './logger';

export function calculateHarassmentExposure(inc: { type: string; severity: number; timestamp: number }[], win = 30) {
  const now = Date.now();
  const rec = inc.filter(i => now - i.timestamp < win * 86_400_000);
  const bd: Record<string, number> = {};
  rec.forEach(i => { bd[i.type] = (bd[i.type] ?? 0) + i.severity; });
  const sc = Object.values(bd).reduce((a, b) => a + b, 0);
  const lv = sc >= 20 ? 'critical' : sc >= 10 ? 'high' : sc >= 5 ? 'moderate' : 'low';
  const act = sc >= 10;
  if (act) writeAuditLog('wellbeing.harassment_exposure', { score: sc, level: lv }).catch(() => {});
  return {
    score: sc,
    level: lv,
    breakdown: bd,
    interventionRequired: act,
    recommendedAction: sc >= 20
      ? 'Contact safety team immediately.'
      : sc >= 10
      ? 'Take a break. Messages flagged for review.'
      : sc >= 5
      ? 'Some interactions flagged. Report/block as needed.'
      : 'Experience looks okay. Keep reporting concerns.',
  };
}

export const harassmentExposure = calculateHarassmentExposure;

export interface EmotionalFatigueResult {
  fatigued: boolean;
  fatigueScore: number;
  indicators: string[];
  interventionType: 'none' | 'gentle_nudge' | 'break_suggestion' | 'resources';
  triggerCategory: string[];
  message: string | null;
  suggestedBreakMinutes: number;
  resources: string[];
}

export function detectEmotionalFatigue(signals: {
  sessionsToday: number;
  avgSessionMinutes: number;
  negativeInteractions: number;
  reportsMade: number;
  blocksThisWeek: number;
  unmatchesReceived?: number;
  harassmentEventsToday?: number;
  selfReportedDistress?: boolean;
  daysSincePositiveInteraction?: number;
}): EmotionalFatigueResult {
  const indicators: string[] = [];
  const triggers: string[] = [];
  let score = 0;

  if (signals.sessionsToday >= 8) { indicators.push('excessive_daily_sessions'); triggers.push('compulsive_use'); score += 20; }
  else if (signals.sessionsToday >= 5) { indicators.push('elevated_daily_sessions'); score += 10; }

  if (signals.avgSessionMinutes >= 120) { indicators.push('very_long_sessions'); triggers.push('extended_exposure'); score += 20; }
  else if (signals.avgSessionMinutes >= 60) { indicators.push('long_sessions'); score += 10; }

  if (signals.negativeInteractions >= 5) { indicators.push('high_negative_interactions'); triggers.push('repeated_negative_content'); score += 25; }
  else if (signals.negativeInteractions >= 3) { indicators.push('elevated_negative_interactions'); score += 12; }

  if (signals.reportsMade >= 3) { indicators.push('multiple_reports_today'); triggers.push('harassment_exposure'); score += 20; }

  if (signals.blocksThisWeek >= 10) { indicators.push('high_block_rate'); triggers.push('safety_actions_elevated'); score += 15; }

  if ((signals.unmatchesReceived ?? 0) >= 5) { indicators.push('high_unmatches_received'); triggers.push('rejection_pattern'); score += 15; }

  if ((signals.harassmentEventsToday ?? 0) >= 2) { indicators.push('repeated_harassment_today'); triggers.push('harassment_exposure'); score += 25; }

  if (signals.selfReportedDistress) { indicators.push('self_reported_distress'); triggers.push('direct_user_signal'); score += 30; }

  if ((signals.daysSincePositiveInteraction ?? 0) >= 7) { indicators.push('no_positive_interaction_7d'); triggers.push('sustained_negative_environment'); score += 15; }

  score = Math.min(100, score);
  const fatigued = score >= 30;

  const interventionType: EmotionalFatigueResult['interventionType'] =
    score >= 70 ? 'resources' : score >= 45 ? 'break_suggestion' : score >= 20 ? 'gentle_nudge' : 'none';

  const suggestedBreakMinutes = interventionType === 'resources' ? 1440 : interventionType === 'break_suggestion' ? 60 : interventionType === 'gentle_nudge' ? 15 : 0;

  const message = interventionType === 'resources'
    ? 'It seems like you may be going through a really tough time. Please know support is available.'
    : interventionType === 'break_suggestion'
    ? "You've had a lot of difficult interactions today. Taking a break can help."
    : interventionType === 'gentle_nudge'
    ? 'Dating can be emotionally taxing. Remember to take care of yourself.'
    : null;

  const resources = interventionType === 'resources'
    ? ['Crisis Text Line: Text HOME to 741741', 'NAMI Helpline: 1-800-950-NAMI', 'BetterHelp', 'Headspace']
    : [];

  if (fatigued) {
    void writeAuditLog('wellbeing.emotional_fatigue', { fatigueScore: score, indicators, interventionType, triggerCategory: triggers }).catch(() => {});
  }

  return { fatigued, fatigueScore: score, indicators, interventionType, triggerCategory: triggers, message, suggestedBreakMinutes, resources };
}

export const emotionalFatigue = detectEmotionalFatigue;
export const fatigueDetect = detectEmotionalFatigue;
export const fatigueIntervention = detectEmotionalFatigue;

export interface HarassmentNormalizationResult {
  normalized: boolean;
  threshold: number;
  receivedCount: number;
  normalizedTypes: string[];
  escalationLevel: 'none' | 'monitor' | 'intervene' | 'escalate';
  recommendation: string;
  autoAction: 'none' | 'warn_sender' | 'restrict_sender' | 'escalate';
  recipientResources: string[];
  platformAction: string[];
}

interface HarassmentEvent {
  timestamp: number;
  type: string;
  senderId: string;
  severity?: 'low' | 'medium' | 'high';
  content?: string;
}

export function detectHarassmentNormalization(
  events: HarassmentEvent[],
  recipientId: string,
  windowMs = 7 * 86_400_000
): HarassmentNormalizationResult {
  const now = Date.now();
  const recent = events.filter(e => now - e.timestamp < windowMs);
  const threshold = 3;

  const uniqueSenders = new Set(recent.map(e => e.senderId)).size;
  const typeBreakdown = new Map<string, number>();
  for (const e of recent) {
    typeBreakdown.set(e.type, (typeBreakdown.get(e.type) ?? 0) + 1);
  }
  const normalizedTypes = [...typeBreakdown.entries()].filter(([, cnt]) => cnt >= 2).map(([type]) => type);

  const normalized = recent.length >= threshold;
  const highSeverityCount = recent.filter(e => e.severity === 'high').length;

  const escalationLevel: HarassmentNormalizationResult['escalationLevel'] =
    highSeverityCount >= 3 || recent.length >= 10 ? 'escalate' :
    recent.length >= 5 || uniqueSenders >= 3 ? 'intervene' :
    recent.length >= threshold ? 'monitor' : 'none';

  const autoAction: HarassmentNormalizationResult['autoAction'] =
    escalationLevel === 'escalate' ? 'escalate' : escalationLevel === 'intervene' ? 'restrict_sender' : escalationLevel === 'monitor' ? 'warn_sender' : 'none';

  const platformAction: string[] = [];
  if (escalationLevel === 'escalate') {
    platformAction.push('Escalate to Trust & Safety', 'Auto-mute senders', 'Send support resources');
  } else if (escalationLevel === 'intervene') {
    platformAction.push('Warn senders', 'Reduce visibility');
  } else if (escalationLevel === 'monitor') {
    platformAction.push('Warn primary sender', 'Log for analysis');
  }

  const recipientResources = normalized
    ? ['Block users from profile', 'Crisis Text Line: Text HOME to 741741', 'RAINN: 1-800-656-4673']
    : [];

  if (normalized) {
    void writeAuditLog('wellbeing.harassment_normalization', { recipientId, count: recent.length, uniqueSenders, escalationLevel, autoAction }).catch(() => {});
  }

  return {
    normalized,
    threshold,
    receivedCount: recent.length,
    normalizedTypes,
    escalationLevel,
    recommendation: normalized
      ? `${recent.length} harassment events from ${uniqueSenders} sender(s). Action required.`
      : 'Harassment levels within expected thresholds.',
    autoAction,
    recipientResources,
    platformAction,
  };
}

export const harassmentNormalization = detectHarassmentNormalization;
export const normalizedHarassment = detectHarassmentNormalization;

export interface ContentRotationResult {
  rotated: boolean;
  currentQueue: string[];
  maxConsecutiveHeavy: number;
  recommendation: string;
}

export function rotateModeratorContent(queue: Array<{ contentType: 'csam' | 'violence' | 'harassment' | 'spam' | 'standard'; severity: number }>): ContentRotationResult {
  const heavy = queue.filter(q => q.contentType === 'csam' || q.contentType === 'violence');
  const consecutive = queue.slice(0, 5).filter(q => q.contentType === 'csam' || q.contentType === 'violence').length;
  const shouldRotate = consecutive >= 3 || heavy.length / Math.max(queue.length, 1) > 0.4;

  if (shouldRotate) {
    const standard = queue.filter(q => q.contentType === 'standard' || q.contentType === 'spam');
    const heavyItems = queue.filter(q => q.contentType !== 'standard' && q.contentType !== 'spam');
    const rotated: typeof queue = [];
    for (let i = 0; i < heavyItems.length; i++) {
      rotated.push(heavyItems[i]!);
      if (standard[i]) rotated.push(standard[i]!);
    }
    writeAuditLog('mod.content_rotated', { heavyCount: heavy.length, queueLength: queue.length }).catch(() => {});
    return { rotated: true, currentQueue: rotated.map(q => q.contentType), maxConsecutiveHeavy: 3, recommendation: 'Queue rotated to prevent secondary trauma.' };
  }
  return { rotated: false, currentQueue: queue.map(q => q.contentType), maxConsecutiveHeavy: 3, recommendation: 'Queue balance is acceptable.' };
}

export const contentRotation = rotateModeratorContent;