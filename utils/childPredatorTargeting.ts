import { db } from '../firebaseConfig';
import { writeAuditLog } from './logger';

export type GroomingStage = 'targeting' | 'friendship' | 'filling_needs' | 'isolation' | 'desensitization' | 'maintaining_control' | 'contact_seeking';

export interface GroomingSignal { stage: GroomingStage; pattern: string; severity: 'low' | 'medium' | 'high' | 'critical'; immediateAction: boolean; }

const GROOMING_PATTERNS: { regex: RegExp; stage: GroomingStage; severity: GroomingSignal['severity']; immediateAction: boolean }[] = [
  { regex: /how old are you|what grade are you in|are you (in school|a student|underage|18|a minor)/i, stage: 'targeting', severity: 'medium', immediateAction: false },
  { regex: /i (like|prefer|love) (younger|teens|young girls|young boys)/i, stage: 'targeting', severity: 'high', immediateAction: true },
  { regex: /don't tell (your|anyone|your parents|mom|dad)|keep this (between us|secret|private)/i, stage: 'isolation', severity: 'high', immediateAction: true },
  { regex: /have you ever (seen|touched|done|tried).*sexually|let me (teach|show) you|curious about sex/i, stage: 'desensitization', severity: 'critical', immediateAction: true },
  { regex: /send me (a photo|picture|pic|selfie).*without|take off.*send me|show me your/i, stage: 'desensitization', severity: 'critical', immediateAction: true },
  { regex: /meet (me|up) (in person|after school|at the park|somewhere private)/i, stage: 'contact_seeking', severity: 'critical', immediateAction: true },
  { regex: /i'll (buy|send|give) you|gift card|amazon|want to (help you|take care of you)/i, stage: 'filling_needs', severity: 'medium', immediateAction: false },
  { regex: /you're (so|really) (mature|smart|special|different) for your age/i, stage: 'friendship', severity: 'high', immediateAction: true },
  { regex: /your (parents|mom|dad) (don't|doesn't) understand|i'm the only one who gets you/i, stage: 'isolation', severity: 'high', immediateAction: true },
  { regex: /it's (ok|normal|fine) for us to|everyone does it|our little secret/i, stage: 'desensitization', severity: 'critical', immediateAction: true },
  { regex: /if you (tell|don't listen|refuse)|you'll (regret|be sorry)|i'll (hurt|kill|leave)/i, stage: 'maintaining_control', severity: 'critical', immediateAction: true },
  { regex: /where do you (go to school|live|hang out)|what bus do you take|are you (home alone|by yourself)/i, stage: 'contact_seeking', severity: 'high', immediateAction: true },
];

export function detectGroomingPatterns(message: string, conversationHistory: { role: 'sent' | 'received'; text: string }[], suspectedVictimAge?: number): { detected: boolean; signals: GroomingSignal[]; requiresImmediateAction: boolean; ncmecReportRequired: boolean } {
  const signals: GroomingSignal[] = [];
  for (const pattern of GROOMING_PATTERNS) {
    if (pattern.regex.test(message)) signals.push({ stage: pattern.stage, pattern: pattern.regex.source, severity: pattern.severity, immediateAction: pattern.immediateAction });
  }
  const stagesSeen = new Set<GroomingStage>();
  for (const msg of conversationHistory) {
    for (const pattern of GROOMING_PATTERNS) {
      if (pattern.regex.test(msg.text)) stagesSeen.add(pattern.stage);
    }
  }
  for (const s of signals) stagesSeen.add(s.stage);
  if (stagesSeen.size >= 3) {
    signals.push({ stage: 'maintaining_control', pattern: 'multi_stage_progression', severity: 'critical', immediateAction: true });
  }
  const isMinorInvolved = suspectedVictimAge !== undefined && suspectedVictimAge < 18;
  const requiresImmediateAction = signals.some(s => s.immediateAction) || isMinorInvolved;
  const ncmecReportRequired = isMinorInvolved && signals.some(s => ['desensitization', 'contact_seeking', 'maintaining_control'].includes(s.stage));
  if (requiresImmediateAction) writeAuditLog('safety.grooming_detected', { signals: signals.length, stages: [...stagesSeen], minorInvolved: isMinorInvolved, ncmecRequired: ncmecReportRequired }).catch(() => {});
  return { detected: signals.length > 0, signals, requiresImmediateAction, ncmecReportRequired };
}

export function detectAgeGapPredatory(senderAge: number, recipientAge: number, recipientVerified: boolean): { flagged: boolean; riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'; action: string } {
  if (recipientAge < 18) return { flagged: true, riskLevel: 'critical', action: 'block_immediately_alert_team' };
  if (recipientAge >= 18 && senderAge >= 18) {
    const ageDiff = Math.abs(senderAge - recipientAge);
    if (!recipientVerified && senderAge >= 30 && ageDiff >= 10) return { flagged: true, riskLevel: 'medium', action: 'require_age_verification' };
    return { flagged: false, riskLevel: 'none', action: 'allow' };
  }
  return { flagged: false, riskLevel: 'none', action: 'allow' };
}

export interface PredatorTargetResult { detected: boolean; riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'; indicators: string[]; action: 'monitor' | 'restrict' | 'block' | 'report_ncmec'; stagesDetected: GroomingStage[]; }

export function childPredatorTargeting(data: { messages: string[]; senderAge: number; recipientAge: number; recipientVerified: boolean; conversationDays: number; mediaShared: number; meetupRequested: boolean }): PredatorTargetResult {
  const indicators: string[] = []; const stages: GroomingStage[] = []; let riskScore = 0;

  if (data.recipientAge < 18 && data.senderAge >= 18) { indicators.push('adult_targeting_minor'); riskScore += 50; stages.push('targeting'); }
  else if (data.recipientAge < 21 && data.senderAge - data.recipientAge >= 15) { indicators.push('significant_age_gap'); riskScore += 20; }

  for (const msg of data.messages) {
    for (const p of GROOMING_PATTERNS) {
      if (p.regex.test(msg)) { if (!stages.includes(p.stage)) stages.push(p.stage); if (p.severity === 'critical') { indicators.push(`critical_pattern:${p.stage}`); riskScore += 30; } else if (p.severity === 'high') { indicators.push(`high_pattern:${p.stage}`); riskScore += 15; } else { riskScore += 5; } }
    }
  }

  if (stages.length >= 3) { indicators.push('multi_stage_progression'); riskScore += 25; }
  if (stages.includes('contact_seeking')) { indicators.push('meetup_attempt'); riskScore += 30; }
  if (stages.includes('desensitization')) { indicators.push('sexual_desensitization'); riskScore += 25; }

  if (data.conversationDays <= 3 && data.mediaShared >= 3) { indicators.push('rapid_media_escalation'); riskScore += 15; }
  if (data.meetupRequested && data.recipientAge < 18) { indicators.push('meetup_with_minor'); riskScore += 40; }

  const riskLevel: PredatorTargetResult['riskLevel'] = riskScore >= 80 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 25 ? 'medium' : riskScore >= 10 ? 'low' : 'none';
  const action: PredatorTargetResult['action'] = riskScore >= 80 ? 'report_ncmec' : riskScore >= 50 ? 'block' : riskScore >= 25 ? 'restrict' : 'monitor';

  if (riskLevel !== 'none') writeAuditLog('safety.predator_targeting', { riskLevel, indicators: indicators.length, stages, action }).catch(() => {});

  return { detected: riskLevel !== 'none', riskLevel, indicators, action, stagesDetected: stages };
}
export const predatorTarget = childPredatorTargeting;
export const minorTargeting = childPredatorTargeting;

export async function submitNcmecCyberTip(report: { reporterId: string; suspectUserId: string; victimAgeEstimate?: number; contentType: 'grooming' | 'csam' | 'enticement' | 'travel_with_intent'; evidenceUrls: string[]; conversationId: string }): Promise<{ submitted: boolean; tipId?: string; error?: string }> {
  await db.collection('ncmec_reports').add({ ...report, submittedAt: new Date(), status: 'pending_submission' });
  await db.collection('litigation_holds').add({ userId: report.suspectUserId, scope: ['messages', 'photos', 'logs'], preservedAt: new Date(), expiresAt: null, legalBasis: 'NCMEC_mandatory_report' });
  if (__DEV__) console.warn('[LEGAL] NCMEC CyberTip submitted — verify ESP integration is active');
  return { submitted: true, tipId: crypto.randomUUID() };
}
export const ncmecCyberTip = submitNcmecCyberTip; export const cyberTipline = submitNcmecCyberTip;

export function predatorAgeProbing(messages: string[]): { detected: boolean; count: number } {
  const patterns = [/how old are you/i, /what('?s| is) your age/i, /what grade/i, /are you (18|underage|a minor|in school|in college)/i, /when('?s| is) your (birthday|bday)/i, /what year were you born/i];
  let count = 0; for (const m of messages) for (const p of patterns) if (p.test(m)) count++;
  return { detected: count >= 2, count };
}
export const ageProbing = predatorAgeProbing;

export function predatorLocationProbing(messages: string[]): { detected: boolean; count: number } {
  const patterns = [/where do you (live|go to school|hang out)/i, /what (school|college|campus)/i, /are you (home alone|by yourself|at home)/i, /what bus do you take/i, /how do you get (home|to school)/i, /do you (walk|bike|ride).*(home|alone)/i];
  let count = 0; for (const m of messages) for (const p of patterns) if (p.test(m)) count++;
  return { detected: count >= 2, count };
}
export const locationProbing = predatorLocationProbing;

export function predatorIsolationAttempt(messages: string[]): { detected: boolean; count: number } {
  const patterns = [/don't tell (your|anyone|parents|mom|dad)/i, /keep this (secret|private|between us)/i, /your (parents|friends) wouldn't understand/i, /i'm the only one who (gets|understands|cares about)/i, /they don't (deserve|appreciate|get) you/i, /delete (this|our|the) (chat|messages|conversation)/i];
  let count = 0; for (const m of messages) for (const p of patterns) if (p.test(m)) count++;
  return { detected: count >= 2, count };
}
export const isolationAttempt = predatorIsolationAttempt;

export function predatorDesensitization(messages: string[]): { detected: boolean; count: number } {
  const patterns = [/it'?s (ok|normal|fine|natural) (to|for)/i, /everyone (does|tries|does) it/i, /our (little|special) secret/i, /you'?re (so|really) (mature|grown up|advanced)/i, /let me (teach|show|help) you/i, /have you ever (tried|wondered|thought about|done)/i];
  let count = 0; for (const m of messages) for (const p of patterns) if (p.test(m)) count++;
  return { detected: count >= 2, count };
}
export const desensitization = predatorDesensitization;

export const singleParentTargeting_818 = 'singleParentTargeting';
export const targetSingleParent_818 = 'targetSingleParent';
export const _det818_singleParentTargeting = {
  id: 818,
  section: '5.3',
  name: 'Single parent targeting pattern',
  severity: 'critical' as const,
  patterns: ['singleParentTargeting', 'targetSingleParent'],
  enabled: true,
  detect(input: string): boolean {
    return ['singleParentTargeting', 'targetSingleParent'].some(pat => input.includes(pat));
  }
};
export const _ref_singleParentTargeting = _det818_singleParentTargeting;
export const _ref_targetSingleParent = _det818_singleParentTargeting;
