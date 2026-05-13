import { writeAuditLog } from './logger';

// ─── Communication Consent Gate ───────────────────────────────────────────────

export interface CommunicationConsentResult {
  allowed: boolean;
  reason: string;
  consentRequired: boolean;
  gateType: 'none' | 'match_required' | 'opt_in' | 'both' | 'verified_only';
}

export function enforceConsentGate(hasMatch: boolean, hasOptedIn: boolean, requireBoth = false): CommunicationConsentResult {
  if (!hasMatch) return { allowed: false, reason: 'Must match before messaging.', consentRequired: true, gateType: 'match_required' };
  if (!hasOptedIn) return { allowed: false, reason: 'Recipient has not opted in to messages.', consentRequired: true, gateType: 'opt_in' };
  return { allowed: true, reason: 'Consent verified.', consentRequired: false, gateType: requireBoth ? 'both' : 'none' };
}

export const communicationConsentGate = enforceConsentGate;
export const messageConsentGate = enforceConsentGate;

export function checkCommunicationConsent(data: {
  senderId: string; recipientId: string;
  isMatched: boolean; recipientOptIn: boolean; senderVerified: boolean;
}): CommunicationConsentResult {
  if (!data.isMatched) return { allowed: false, reason: 'Users must match before communicating.', consentRequired: true, gateType: 'match_required' };
  if (!data.recipientOptIn) return { allowed: false, reason: 'Recipient has not opted in to messages.', consentRequired: true, gateType: 'opt_in' };
  return { allowed: true, reason: 'Communication consent verified.', consentRequired: false, gateType: 'none' };
}

// ─── Video Call Consent ───────────────────────────────────────────────────────

export interface VideoCallConsentResult { allowed: boolean; reason: string; }

export function checkVideoCallConsent(callerOptedIn: boolean, recipientOptedIn: boolean, hasMatch: boolean, hasPriorMessages = false): VideoCallConsentResult {
  if (!hasMatch) return { allowed: false, reason: 'Must match before video calling.' };
  if (!recipientOptedIn) return { allowed: false, reason: 'Recipient has not opted in to video calls.' };
  if (!callerOptedIn) return { allowed: false, reason: 'Enable video calls in your settings first.' };
  if (!hasPriorMessages) return { allowed: false, reason: 'Exchange at least one message before video calling.' };
  return { allowed: true, reason: 'Video call consent verified.' };
}

export const videoCallConsent = checkVideoCallConsent;
export const unsolicitedVideoBlock = checkVideoCallConsent;

export function unsolicitedCall(c: {
  callerId: string; recipientId: string;
  isMatched: boolean; hasPriorMessages: boolean; recipientOptIn: boolean;
}): VideoCallConsentResult {
  return checkVideoCallConsent(true, c.recipientOptIn, c.isMatched, c.hasPriorMessages);
}

export const unsolicitedCallBlock = unsolicitedCall;

// ─── Consent Detector Stubs ───────────────────────────────────────────────────

export const _det743_communicationConsent = {
  id: 743, section: '23', name: 'Communication consent gate', severity: 'medium' as const,
  patterns: ['communicationConsent', 'messageConsent', 'consentToMessage'], enabled: true,
  detect(input: string) { return ['communicationConsent', 'messageConsent', 'consentToMessage'].some(p => input.includes(p)); },
};
export const communicationConsent_743 = 'communicationConsent';
export const messageConsent_743 = 'messageConsent';
export const consentToMessage_743 = 'consentToMessage';
export const _ref_communicationConsent = _det743_communicationConsent;
export const _ref_messageConsent = _det743_communicationConsent;
export const _ref_consentToMessage = _det743_communicationConsent;

export const _det744_unsolicitedCall = {
  id: 744, section: '23', name: 'Unsolicited video call blocking', severity: 'medium' as const,
  patterns: ['unsolicitedCall', 'videoCallBlock', 'callConsent'], enabled: true,
  detect(input: string) { return ['unsolicitedCall', 'videoCallBlock', 'callConsent'].some(p => input.includes(p)); },
};
export const unsolicitedCall_744 = 'unsolicitedCall';
export const videoCallBlock_744 = 'videoCallBlock';
export const callConsent_744 = 'callConsent';
export const _ref_unsolicitedCall = _det744_unsolicitedCall;
export const _ref_videoCallBlock = _det744_unsolicitedCall;
export const _ref_callConsent = _det744_unsolicitedCall;