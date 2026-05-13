import { writeAuditLog } from './logger';

// ─── AI Scam Scaling ──────────────────────────────────────────────────────────

export interface AiScamScalingResult {
  detected: boolean;
  scalingIndicators: string[];
  estimatedVictimCount: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'alert' | 'suspend' | 'ban';
}

export function detectAiScamScaling(messages: Array<{
  senderId: string; text: string; timestamp: number; recipientId: string;
}>): AiScamScalingResult {
  const senders = new Map<string, { texts: string[]; recipients: Set<string>; timestamps: number[] }>();
  for (const m of messages) {
    const s = senders.get(m.senderId) ?? { texts: [], recipients: new Set(), timestamps: [] };
    s.texts.push(m.text); s.recipients.add(m.recipientId); s.timestamps.push(m.timestamp);
    senders.set(m.senderId, s);
  }

  const indicators: string[] = [];
  const victims = new Set<string>();

  for (const [sid, data] of senders) {
    if (data.recipients.size < 3) continue;
    const uniq = new Set(data.texts).size;
    const dupRatio = 1 - (uniq / data.texts.length);
    if (dupRatio > 0.7) indicators.push(`template_reuse:${sid}:${Math.round(dupRatio * 100)}%`);
    const windowMs = data.timestamps[data.timestamps.length - 1]! - data.timestamps[0]!;
    const rate = data.recipients.size / (windowMs / 3_600_000 + 0.1);
    if (rate > 10) indicators.push(`high_victim_rate:${sid}:${rate.toFixed(1)}/hr`);
    if (data.recipients.size > 20) indicators.push(`mass_targeting:${sid}:${data.recipients.size}`);
    if (indicators.some(i => i.includes(sid))) data.recipients.forEach(r => victims.add(r));
  }

  const vc = victims.size;
  const rl: AiScamScalingResult['riskLevel'] =
    vc >= 50 || indicators.length >= 5 ? 'critical'
    : vc >= 20 || indicators.length >= 3 ? 'high'
    : vc >= 5 || indicators.length >= 2 ? 'medium'
    : indicators.length >= 1 ? 'low' : 'none';

  const action: AiScamScalingResult['action'] =
    rl === 'critical' ? 'ban' : rl === 'high' ? 'suspend' : rl === 'medium' ? 'alert' : 'none';

  if (action !== 'none') {
    void writeAuditLog('ai.scam_scaling_detected', { indicators, estimatedVictims: vc, riskLevel: rl }).catch(() => {});
  }

  return { detected: indicators.length > 0, scalingIndicators: indicators, estimatedVictimCount: vc, riskLevel: rl, action };
}

export const aiScamScaling  = detectAiScamScaling;
export const scaledScam     = detectAiScamScaling;
export const aiAssistedScam = detectAiScamScaling;

// ─── Novel Scam Script ────────────────────────────────────────────────────────

export interface NovelScamScriptResult {
  detected: boolean;
  noveltyScore: number;
  closestKnownScript: string | null;
  recommendation: string;
}

const KNOWN_SCAM_SIGNATURES = [
  'investment guaranteed', 'oil rig', 'customs fee', 'release funds',
  'i love you already', 'my pastor said', 'send gift card', 'bitcoin address',
  'i am a soldier deployed',
];

export function detectNovelScamScript(message: string): NovelScamScriptResult {
  const lower = message.toLowerCase();
  let maxSim = 0, closest: string | null = null;
  for (const sig of KNOWN_SCAM_SIGNATURES) {
    const words = sig.split(' ');
    const sim = words.filter(w => lower.includes(w)).length / words.length;
    if (sim > maxSim) { maxSim = sim; closest = sig; }
  }
  const noveltyScore = Math.max(0, 1 - maxSim);
  const detected = maxSim >= 0.4 || /send\s+(money|cash|\$|bitcoin|gift\s*card)/i.test(message);
  if (detected) {
    void writeAuditLog('ai.novel_scam_script', { noveltyScore, closestKnownScript: closest }).catch(() => {});
  }
  return {
    detected,
    noveltyScore: Math.round(noveltyScore * 100) / 100,
    closestKnownScript: closest,
    recommendation: detected
      ? noveltyScore > 0.7 ? 'Potentially novel scam script. Add to training data and flag.'
        :                    'Known scam pattern detected. Block and report.'
      : 'No scam script detected.',
  };
}

export const novelScamScript    = detectNovelScamScript;
export const unknownScamDetect  = detectNovelScamScript;

// ─── Slow Burn Scam Arc ───────────────────────────────────────────────────────

export interface SlowBurnScamResult {
  detected: boolean;
  arcStage: 'benign' | 'trust_building' | 'crisis_intro' | 'financial_ask';
  riskScore: number;
  recommendation: string;
}

export function detectSlowBurnScamArc(conversationArc: {
  daysSinceFirst: number;
  loveDeclarationDays?: number;
  crisisIntroducedDays?: number;
  financialAskDays?: number;
  messageCount: number;
}): SlowBurnScamResult {
  let stage: SlowBurnScamResult['arcStage'] = 'benign';
  let riskScore = 0;

  if (conversationArc.financialAskDays !== undefined) {
    stage = 'financial_ask'; riskScore = 1.0;
  } else if (conversationArc.crisisIntroducedDays !== undefined) {
    stage = 'crisis_intro'; riskScore = 0.75;
  } else if (conversationArc.loveDeclarationDays !== undefined) {
    stage = 'trust_building';
    riskScore = conversationArc.loveDeclarationDays < 14 ? 0.6 : 0.3;
  }

  if (conversationArc.loveDeclarationDays !== undefined
    && conversationArc.crisisIntroducedDays !== undefined
    && conversationArc.financialAskDays !== undefined) {
    riskScore = Math.min(riskScore + 0.2, 1);
  }

  if (riskScore >= 0.5) {
    void writeAuditLog('ai.slow_burn_scam_arc', { stage, riskScore, days: conversationArc.daysSinceFirst }).catch(() => {});
  }

  return {
    detected: riskScore >= 0.5, arcStage: stage,
    riskScore: Math.round(riskScore * 100) / 100,
    recommendation:
      stage === 'financial_ask' ? 'Financial request detected in romance arc. High scam probability.'
      : stage === 'crisis_intro' ? 'Crisis narrative introduced. Monitor for financial ask.'
      : stage === 'trust_building' ? 'Rapid love declaration. Monitor relationship arc.'
      :                              'No scam arc detected.',
  };
}

export const slowBurnScam    = detectSlowBurnScamArc;
export const romanceArcScam  = detectSlowBurnScamArc;