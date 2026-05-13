/**
 * Financial Sextortion Detection — Detector #831
 *
 * #831 — financialSextortionEscalation | sextortionPaymentDemand | moneyThreatEscalation
 *
 * Detects the pattern: intimate content exchange → threat → financial demand → escalating demands
 */

interface SextortionEscalationResult {
  detected: boolean;
  stage: 'none' | 'grooming' | 'exchange' | 'threat' | 'demand' | 'escalation';
  confidence: number;
  financialDemandDetected: boolean;
  demandAmount: string | null;
  escalationRate: number; // demands per hour
  action: 'none' | 'warn_victim' | 'block_and_report' | 'crisis_intervention';
  resources: typeof SEXTORTION_CRISIS_RESOURCES;
}

const INTIMATE_EXCHANGE_PATTERNS = [
  /send (me )?(a )?(pic|photo|video|nude|selfie)/i,
  /show (me|yourself)/i,
  /(took|have) (a )?screenshot/i,
  /recorded (our|the|your) (call|video|chat)/i,
  /i (saved|downloaded|have) (your|the) (pic|photo|video|nude)/i,
];

const THREAT_PATTERNS = [
  /i('ll| will) (share|send|post|leak|upload|expose|spread)/i,
  /everyone (will |gonna |is going to )?see/i,
  /(send|share|post) (it |them |this )?(to|on) (your )?(friends|family|boss|coworkers|school|employer|facebook|instagram|twitter)/i,
  /ruin (your )?(life|reputation|career)/i,
  /imagine (if|when|what) (everyone|they|your)/i,
  /your (family|friends|boss|wife|husband|partner) (will|would|should) (see|know)/i,
];

const FINANCIAL_DEMAND_PATTERNS = [
  /send (\$|€|£)?\d+/i,
  /pay (me |us )?\$?\d+/i,
  /(\$|€|£)\s*\d[\d,]*/,
  /bitcoin|btc|ethereum|eth|crypto|usdt/i,
  /cash\s?app|venmo|zelle|paypal|wire|western union|moneygram/i,
  /gift\s?card/i,
  /transfer\s+(money|funds|\$)/i,
];

const ESCALATION_PATTERNS = [
  /not enough/i,
  /more money/i,
  /last chance/i,
  /running out of (time|patience)/i,
  /\d+ (hour|minute|day)s? (left|remaining|or else|until)/i,
  /double|triple|increase/i,
  /next time.*(more|\$\d+)/i,
  /price (just )?went up/i,
];

const SEXTORTION_CRISIS_RESOURCES = {
  general: {
    US_FBI: 'https://www.ic3.gov (FBI Internet Crime)',
    US_NCMEC: 'https://report.cybertip.org',
    hotline: 'Call 1-800-THE-LOST (1-800-843-5678)',
    stopSextortion: 'https://www.thorn.org/sextortion/',
  },
  minors: {
    takeItDown: 'https://takeitdown.ncmec.org',
    crisisText: 'Text HELLO to 741741',
    teenHelp: 'https://www.connectsafely.org/sextortion/',
  },
  immediate: [
    'Do NOT pay — paying almost always leads to more demands',
    'Do NOT delete evidence — screenshot everything',
    'Block the person on all platforms',
    'Report to the platform immediately',
    'Report to law enforcement (FBI IC3, local police)',
    'You are a victim of a crime — this is NOT your fault',
  ],
};

/**
 * #831 — financialSextortionEscalation
 * Analyzes a conversation for the full sextortion lifecycle:
 * grooming → intimate exchange → threat → financial demand → escalation
 */
export function detectFinancialSextortionEscalation(
  messages: Array<{
    text: string;
    timestamp: number;
    senderId: string;
  }>,
  suspectId: string
): SextortionEscalationResult {
  const suspectMsgs = messages
    .filter((m) => m.senderId === suspectId)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (suspectMsgs.length < 3) {
    return {
      detected: false,
      stage: 'none',
      confidence: 0,
      financialDemandDetected: false,
      demandAmount: null,
      escalationRate: 0,
      action: 'none',
      resources: SEXTORTION_CRISIS_RESOURCES,
    };
  }

  const stages = {
    exchange: false,
    threat: false,
    demand: false,
    escalation: false,
  };

  let firstDemandTime: number | null = null;
  let demandCount = 0;
  let lastDemandTime: number | null = null;
  let demandAmount: string | null = null;

  for (const msg of suspectMsgs) {
    const text = msg.text;

    if (INTIMATE_EXCHANGE_PATTERNS.some((p) => p.test(text))) {
      stages.exchange = true;
    }

    if (THREAT_PATTERNS.some((p) => p.test(text))) {
      stages.threat = true;
    }

    if (FINANCIAL_DEMAND_PATTERNS.some((p) => p.test(text))) {
      stages.demand = true;
      demandCount++;

      if (!firstDemandTime) firstDemandTime = msg.timestamp;
      lastDemandTime = msg.timestamp;

      const amountMatch = text.match(/(\$|€|£)\s*[\d,]+(\.\d{2})?/);
      if (amountMatch) {
        demandAmount = amountMatch[0];
      }

      const numMatch = text.match(/\b(\d[\d,]*)\s*(dollar|usd|euro|pound)/i);
      if (numMatch && !demandAmount) {
        demandAmount = `$${numMatch[1]}`;
      }
    }

    if (ESCALATION_PATTERNS.some((p) => p.test(text))) {
      stages.escalation = true;
    }
  }

  let escalationRate = 0;
  if (firstDemandTime && lastDemandTime && demandCount > 1) {
    const hoursBetween = Math.max(
      0.1,
      (lastDemandTime - firstDemandTime) / (1000 * 60 * 60)
    );
    escalationRate = demandCount / hoursBetween;
  }

  let stage: SextortionEscalationResult['stage'] = 'none';
  const activeStages = Object.values(stages).filter(Boolean).length;

  if (stages.escalation && stages.demand) {
    stage = 'escalation';
  } else if (stages.demand) {
    stage = 'demand';
  } else if (stages.threat) {
    stage = 'threat';
  } else if (stages.exchange) {
    stage = 'exchange';
  }

  let confidence = activeStages * 0.25;
  if (stages.threat && stages.demand) confidence = Math.max(confidence, 0.85);
  if (stages.escalation) confidence = Math.max(confidence, 0.95);

  let action: SextortionEscalationResult['action'] = 'none';
  const detected = activeStages >= 2 && (stages.threat || stages.demand);

  if (detected) {
    if (stages.escalation || (stages.threat && stages.demand)) {
      action = 'block_and_report';
    } else if (stages.threat) {
      action = 'crisis_intervention'; // show resources to potential victim
    } else if (stages.demand) {
      action = 'warn_victim';
    }
  }

  return {
    detected,
    stage,
    confidence,
    financialDemandDetected: stages.demand,
    demandAmount,
    escalationRate,
    action,
    resources: SEXTORTION_CRISIS_RESOURCES,
  };
}

/**
 * Quick check for a single message — used in real-time chat monitoring
 */
export function quickSextortionCheck(
  messageText: string
): { isThreat: boolean; isDemand: boolean; severity: 'none' | 'medium' | 'high' | 'critical' } {
  const isThreat = THREAT_PATTERNS.some((p) => p.test(messageText));
  const isDemand = FINANCIAL_DEMAND_PATTERNS.some((p) => p.test(messageText));
  const isEscalation = ESCALATION_PATTERNS.some((p) => p.test(messageText));

  let severity: 'none' | 'medium' | 'high' | 'critical' = 'none';

  export const financialSextortionEscalation = detectFinancialSextortionEscalation;
export const sextortionPaymentDemand = detectFinancialSextortionEscalation;
export const moneyThreatEscalation = detectFinancialSextortionEscalation;
export const sextortionEscalation = detectFinancialSextortionEscalation;
export const quickSextortion = quickSextortionCheck;

  if (isThreat && isDemand) severity = 'critical';
  else if (isDemand && isEscalation) severity = 'critical';
  else if (isThreat) severity = 'high';
  else if (isDemand) severity = 'medium';

  return { isThreat, isDemand, severity };
}
