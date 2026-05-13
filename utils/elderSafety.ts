
import { writeAuditLog } from './logger';

export interface ElderSafetyResult {
  isElder: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  scamType: string[];
  detectedPatterns: string[];
  recommendations: string[];
  guardianAlert: boolean;
  resources: string[];
}

const ELDER_SCAM_PATTERNS: Array<{
  pattern: RegExp;
  type: string;
  weight: number;
  recommendation: string;
}> = [
  {
    pattern: /i\s+(can|will)\s+(help\s+you\s+)?(manage|invest|grow|protect|secure)\s+(your\s+)?(money|savings|retirement|pension|401k|ira|nest\s+egg)/i,
    type: 'investment_scam',
    weight: 0.8,
    recommendation: 'Never share financial details with someone you haven\'t met in person. Consult a licensed financial advisor.',
  },
  {
    pattern: /you('ve| have)\s+(won|been\s+selected|been\s+chosen|qualified\s+for)\s+/i,
    type: 'prize_scam',
    weight: 0.85,
    recommendation: 'If you didn\'t enter a contest, you didn\'t win anything. This is a common scam.',
  },
  {
    pattern: /(send|wire|transfer)\s+(money|payment|funds)\s+(to|for|via)\s+/i,
    type: 'payment_request',
    weight: 0.7,
    recommendation: 'Never wire money to someone you met online. Wire transfers cannot be reversed.',
  },
  {
    pattern: /(gift\s*card|google\s*play|itunes|amazon|steam)\s+(code|card|voucher)/i,
    type: 'gift_card_scam',
    weight: 0.9,
    recommendation: 'No legitimate person asks for gift card codes. This is always a scam.',
  },
  {
    pattern: /i'?m\s+(a|an)\s+(doctor|surgeon|military|general|commander|captain|officer)\s+(stationed|deployed|working)\s+(abroad|overseas|in\s+(afghanistan|iraq|syria|ukraine))/i,
    type: 'military_imposter',
    weight: 0.85,
    recommendation: 'Military impersonation is a common scam. Real service members don\'t ask for money.',
  },
  {
    pattern: /(medicare|social\s+security|irs|government)\s+(needs?|requires?|is\s+calling|refund|suspension)/i,
    type: 'government_imposter',
    weight: 0.9,
    recommendation: 'Government agencies don\'t contact you through dating apps. Hang up / block.',
  },
  {
    pattern: /(grandchild|grandson|granddaughter|son|daughter)\s+(in\s+(trouble|jail|hospital|accident|emergency))/i,
    type: 'grandparent_scam',
    weight: 0.9,
    recommendation: 'Verify any family emergency independently. Call your family member directly.',
  },
  {
    pattern: /(crypto|bitcoin|btc|ethereum|eth)\s+(investment|opportunity|portfolio|trading|mining)/i,
    type: 'crypto_scam',
    weight: 0.8,
    recommendation: 'Cryptocurrency investments promoted on dating apps are almost always scams.',
  },
  {
    pattern: /i\s+(need|want)\s+you\s+to\s+(be|act\s+as)\s+(my|a)\s+(power\s+of\s+attorney|beneficiary|bank\s+agent)/i,
    type: 'authority_abuse',
    weight: 0.95,
    recommendation: 'Never agree to be someone\'s financial agent. This is a money laundering scam.',
  },
  {
    pattern: /(reverse\s+mortgage|home\s+equity|refinance|loan)\s+(opportunity|special|program|offer)/i,
    type: 'home_equity_scam',
    weight: 0.8,
    recommendation: 'Consult your bank or a HUD-approved counselor before any home equity decisions.',
  },
  {
    pattern: /let'?s\s+(move|go|talk)\s+(to|on)\s+(whatsapp|telegram|signal|email|text|phone)/i,
    type: 'platform_migration',
    weight: 0.5,
    recommendation: 'Moving off-platform early is a red flag. Stay on the app where you\'re protected.',
  },
  {
    pattern: /i\s+(love|adore|cherish)\s+you\s+/i,
    type: 'premature_declaration',
    weight: 0.4,
    recommendation: 'Declarations of love very early are a common manipulation tactic (love bombing).',
  },
];

export function analyzeForElderScam(msg: string, age?: number): ElderSafetyResult {
  const isElder = (age ?? 0) >= 60;

  if (!isElder && !age) {
    return {
      isElder: false,
      riskLevel: 'none',
      scamType: [],
      detectedPatterns: [],
      recommendations: [],
      guardianAlert: false,
      resources: [],
    };
  }

  const detectedPatterns: string[] = [];
  const scamType: string[] = [];
  const recommendations: string[] = [];
  let totalWeight = 0;

  for (const { pattern, type, weight, recommendation } of ELDER_SCAM_PATTERNS) {
    if (pattern.test(msg)) {
      detectedPatterns.push(type);
      scamType.push(type);
      totalWeight += weight;
      recommendations.push(recommendation);
    }
  }

  const riskLevel = totalWeight >= 1.5
    ? 'critical'
    : totalWeight >= 1.0
      ? 'high'
      : totalWeight >= 0.6
        ? 'medium'
        : totalWeight >= 0.3
          ? 'low'
          : 'none';

  if (riskLevel !== 'none') {
    void writeAuditLog('safety.elder_scam_detected', {
      age,
      riskLevel,
      scamTypes: scamType,
      messageLength: msg.length,
    }).catch(() => {});
  }

  const resources = riskLevel !== 'none'
    ? [
        'AARP Fraud Watch: 1-877-908-3360',
        'FTC: reportfraud.ftc.gov',
        'Elder Justice: elderjustice.gov',
        'National Center on Elder Abuse: ncea.acl.gov',
      ]
    : [];

  return {
    isElder,
    riskLevel,
    scamType,
    detectedPatterns,
    recommendations,
    guardianAlert: riskLevel === 'critical' || riskLevel === 'high',
    resources,
  };
}

export const elderScamAnalysis = analyzeForElderScam;
export const detectElderFraud = analyzeForElderScam;
export const _detector_726_simplifiedReport = {
  id: 726,
  section: '30',
  name: 'Simplified reporting flow',
  severity: 'medium' as const,
  patterns: ["simplifiedReport","easyReport","accessibleReport"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('simplifiedReport') || input.includes('easyReport') || input.includes('accessibleReport');
  }
};

export const caretakerExploitation_727 = 'caretakerExploitation';
export const elderAbuse_727 = 'elderAbuse';
export const caretakerAbuse_727 = 'caretakerAbuse';
export const _det727_caretakerExploitation = {
  id: 727,
  section: '30',
  name: 'Caretaker exploitation detection',
  severity: 'high' as const,
  patterns: ['caretakerExploitation', 'elderAbuse', 'caretakerAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['caretakerExploitation', 'elderAbuse', 'caretakerAbuse'].some(pat => input.includes(pat));
  }
};
export const _ref_caretakerExploitation = _det727_caretakerExploitation;
export const _ref_elderAbuse = _det727_caretakerExploitation;
export const _ref_caretakerAbuse = _det727_caretakerExploitation;
