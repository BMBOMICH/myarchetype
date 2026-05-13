import { writeAuditLog } from './logger';

export interface AgeGateCircumventResult {
  circumvented: boolean;
  signals: string[];
  action: 'allow' | 'reverify' | 'suspend';
  confidence: number;
  recommendation: string;
}

export function detectAgeGateCircumvention(signals: {
  dobMismatch: boolean;
  behavioralAgeEstimate?: number;
  accountAgeDays: number;
  multipleAgeAttempts: boolean;
  vpnUsed: boolean;
  minorKeywordsDetected: boolean;
  deviceFingerprintLinkedToMinor?: boolean;
  schoolEmailDomain?: boolean;
}): AgeGateCircumventResult {
  const s: string[] = [];
  let confidence = 0;
  if (signals.dobMismatch) { s.push('dob_mismatch'); confidence += 0.3; }
  if (signals.behavioralAgeEstimate !== undefined && signals.behavioralAgeEstimate < 17) {
    s.push(`behavioral_age_estimate:${signals.behavioralAgeEstimate}`);
    confidence += 0.35;
  }
  if (signals.multipleAgeAttempts) { s.push('multiple_age_entry_attempts'); confidence += 0.25; }
  if (signals.vpnUsed && signals.accountAgeDays < 7) { s.push('vpn_new_account'); confidence += 0.15; }
  if (signals.minorKeywordsDetected) { s.push('minor_keywords_in_content'); confidence += 0.3; }
  if (signals.deviceFingerprintLinkedToMinor) { s.push('device_linked_to_minor_account'); confidence += 0.4; }
  if (signals.schoolEmailDomain) { s.push('school_email_domain'); confidence += 0.2; }
  confidence = Math.min(confidence, 1);
  const action = confidence >= 0.6 ? 'suspend' : confidence >= 0.3 ? 'reverify' : 'allow';
  if (action !== 'allow') writeAuditLog('age.gate_circumvention', { signals: s, confidence, action }).catch(() => {});
  return {
    circumvented: s.length >= 1,
    signals: s,
    action,
    confidence: Math.round(confidence * 100) / 100,
    recommendation: action === 'suspend'
      ? 'High confidence minor attempting age bypass. Suspend and require verified ID.'
      : action === 'reverify'
        ? 'Age circumvention signals detected. Require re-verification via video selfie + ID.'
        : 'No circumvention detected.',
  };
}

export const ageGateCircumvent = detectAgeGateCircumvention;
export const ageBypass = detectAgeGateCircumvention;
export const ageGateEvasion = detectAgeGateCircumvention;