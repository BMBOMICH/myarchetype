import { comprehensiveDateSafetyCheck, comprehensiveLoginCheck, comprehensiveMessageCheck, comprehensivePhotoCheck, comprehensiveProfileUpdateCheck, comprehensiveRegistrationCheck, type SafetyAction } from './comprehensiveSafetyOrchestrator';
import { checkForCodeWord, quickExit, type CodeWordConfig } from './ipvSafety';
import { writeAuditLog } from './logger';

// ─── Types ───
export interface SafetyMiddlewareConfig { serverUrl: string; codeWordConfig?: CodeWordConfig; enablePhotoCheck: boolean; enableMessageCheck: boolean; enableLoginCheck: boolean; enableRegistrationCheck: boolean; enableProfileCheck: boolean; autoBlockCritical: boolean; logAllChecks: boolean; }
export const DEFAULT_CONFIG: SafetyMiddlewareConfig = { serverUrl: '', enablePhotoCheck: true, enableMessageCheck: true, enableLoginCheck: true, enableRegistrationCheck: true, enableProfileCheck: true, autoBlockCritical: true, logAllChecks: false };

export type SafetyCallback = (result: { action: SafetyAction; reasons: string[]; riskScore: number; source: string }) => void;
const listeners: SafetyCallback[] = [];
export function onSafetyEvent(cb: SafetyCallback) { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; }
function emit(action: SafetyAction, reasons: string[], riskScore: number, source: string) { for (const cb of listeners) cb({ action, reasons, riskScore, source }); }

// ─── Photo Upload Middleware ───
export async function checkPhotoUpload(imageUri: string, imageHash: string, userId: string, context: 'profile' | 'story' | 'chat' | 'id_document', config: SafetyMiddlewareConfig = DEFAULT_CONFIG): Promise<{ allowed: boolean; shouldBlur: boolean; reasons: string[] }> {
  if (!config.enablePhotoCheck) return { allowed: true, shouldBlur: false, reasons: [] };
  try {
    const result = await comprehensivePhotoCheck(imageUri, imageHash, userId, context, config.serverUrl);
    const allowed = config.autoBlockCritical ? result.action !== 'block' : result.action !== 'block';
    if (config.logAllChecks || !allowed) emit(result.action, result.reasons, result.confidence, 'photo_upload');
    return { allowed, shouldBlur: result.shouldAutoBlur, reasons: result.reasons };
  } catch (e) {
    writeAuditLog('middleware.photo_check_error', { error: String(e) }).catch(() => {});
    return { allowed: true, shouldBlur: false, reasons: ['check_failed'] };
  }
}

// ─── Message Send Middleware ───
export async function checkMessageSend(text: string, senderId: string, recipientId: string, isFirstMessage: boolean, conversationDays: number, config: SafetyMiddlewareConfig = DEFAULT_CONFIG, extra?: { sessions?: Array<{ accountId: string; ip: string; timestamp: number; messagesSent: number }>; messageHistory?: string[]; senderAge?: number; recipientAge?: number }): Promise<{ allowed: boolean; shouldWarn: boolean; warningMessage?: string; reasons: string[]; riskScore: number }> {
  if (!config.enableMessageCheck) return { allowed: true, shouldWarn: false, reasons: [], riskScore: 0 };
  try {
    // Code word check (highest priority)
    if (config.codeWordConfig) { const cw = checkForCodeWord(text, config.codeWordConfig); if (cw.detected) { writeAuditLog('safety.code_word_activated', { word: cw.word, action: cw.action, userId: senderId }).catch(() => {}); return { allowed: true, shouldWarn: false, reasons: ['code_word_activated'], riskScore: 0 }; } }

    const result = await comprehensiveMessageCheck(text, isFirstMessage, conversationDays, config.serverUrl, extra?.sessions, extra?.messageHistory, extra?.senderAge, extra?.recipientAge);
    const allowed = result.action !== 'block';
    const shouldWarn = result.action === 'review' || result.riskScore > 0.3;
    let warningMessage: string | undefined;
    if (shouldWarn) {
      if (result.ipvDetected) warningMessage = 'This message may contain concerning language. Support resources are available.';
      else if (result.groomingDetected) warningMessage = 'This conversation has been flagged for review.';
      else if (result.financialFraud) warningMessage = 'This message may be requesting money or financial information. Be cautious.';
      else if (result.wireTransferRisk) warningMessage = 'This message mentions wire transfers. Please verify the recipient independently.';
      else if (result.evasionDetected) warningMessage = 'This message contains unusual formatting that may be hiding content.';
      else if (result.isExtremist) warningMessage = 'This message may contain extremist content.';
      else warningMessage = 'This message has been flagged for review. Please reconsider sending.';
    }
    if (config.logAllChecks || !allowed || shouldWarn) emit(result.action, result.reasons, result.riskScore, 'message_send');
    return { allowed, shouldWarn, warningMessage, reasons: result.reasons, riskScore: result.riskScore };
  } catch (e) {
    writeAuditLog('middleware.message_check_error', { error: String(e) }).catch(() => {});
    return { allowed: true, shouldWarn: false, reasons: ['check_failed'], riskScore: 0 };
  }
}

// ─── Login Middleware ───
export async function checkLogin(login: { userId: string; ip: string; userAgent: string; deviceId: string; location: string; session: { originalIp: string; currentIp: string; originalUserAgent: string; currentUserAgent: string; originalLocation?: string; currentLocation?: string } }, deviceSignals: { suBinaryPresent: boolean; buildTagsTestKeys: boolean; writableSystemPartition: boolean; unknownSourcesEnabled: boolean; playIntegrityFailed: boolean }, locationData: { ipCountry: string; profileCountry: string; ipLat: number; ipLng: number; profileLat: number; profileLng: number; knownCountries: string[] }, accountSignals: { newDeviceLogin: boolean; newLocationLogin: boolean; passwordChanged: boolean; emailChanged: boolean; phoneChanged: boolean; rapidProfileChanges: boolean; unusualLoginTime: boolean }, config: SafetyMiddlewareConfig = DEFAULT_CONFIG): Promise<{ allowed: boolean; requireMFA: boolean; requireReauth: boolean; reasons: string[]; riskScore: number }> {
  if (!config.enableLoginCheck) return { allowed: true, requireMFA: false, requireReauth: false, reasons: [], riskScore: 0 };
  try {
    const result = await comprehensiveLoginCheck(login, deviceSignals, locationData, accountSignals);
    const allowed = result.action !== 'block';
    const requireMFA = result.riskScore > 0.3;
    const requireReauth = result.action === 'require_verification';
    if (config.logAllChecks || !allowed) emit(result.action, result.reasons, result.riskScore, 'login');
    return { allowed, requireMFA, requireReauth, reasons: result.reasons, riskScore: result.riskScore };
  } catch (e) {
    writeAuditLog('middleware.login_check_error', { error: String(e) }).catch(() => {});
    return { allowed: true, requireMFA: false, requireReauth: false, reasons: ['check_failed'], riskScore: 0 };
  }
}

// ─── Registration Middleware ───
export async function checkRegistration(reg: { email: string; phone: string; ip: string; deviceFingerprint: string; password: string }, config: SafetyMiddlewareConfig = DEFAULT_CONFIG): Promise<{ allowed: boolean; requireExtraVerification: boolean; reasons: string[]; riskScore: number }> {
  if (!config.enableRegistrationCheck) return { allowed: true, requireExtraVerification: false, reasons: [], riskScore: 0 };
  try {
    const result = await comprehensiveRegistrationCheck(reg, config.serverUrl);
    const allowed = result.action !== 'block';
    const requireExtraVerification = result.action === 'require_verification';
    if (config.logAllChecks || !allowed) emit(result.action, result.reasons, result.riskScore, 'registration');
    return { allowed, requireExtraVerification, reasons: result.reasons, riskScore: result.riskScore };
  } catch (e) {
    writeAuditLog('middleware.registration_check_error', { error: String(e) }).catch(() => {});
    return { allowed: true, requireExtraVerification: false, reasons: ['check_failed'], riskScore: 0 };
  }
}

// ─── Profile Update Middleware ───
export async function checkProfileUpdate(updates: { bio?: string; age?: number; photos?: string[]; location?: string }, config: SafetyMiddlewareConfig = DEFAULT_CONFIG): Promise<{ allowed: boolean; warnings: string[]; reasons: string[]; riskScore: number }> {
  if (!config.enableProfileCheck) return { allowed: true, warnings: [], reasons: [], riskScore: 0 };
  try {
    const result = await comprehensiveProfileUpdateCheck(updates, config.serverUrl);
    const allowed = result.action !== 'block';
    if (config.logAllChecks || !allowed) emit(result.action, result.reasons, result.riskScore, 'profile_update');
    return { allowed, warnings: result.reasons, reasons: result.reasons, riskScore: result.riskScore };
  } catch (e) {
    writeAuditLog('middleware.profile_check_error', { error: String(e) }).catch(() => {});
    return { allowed: true, warnings: [], reasons: ['check_failed'], riskScore: 0 };
  }
}

// ─── Date Safety Middleware ───
export function checkDateSafety(date: { venueName?: string; venuePublic: boolean; meetupTime: number; shareLocation: boolean; trustedContactSet: boolean; firstDate: boolean; otherPersonVerified: boolean; otherPersonReportCount: number }): { safe: boolean; warnings: string[]; resources: string[]; riskScore: number } {
  const result = comprehensiveDateSafetyCheck(date);
  if (!result.safe) emit('review', result.warnings, result.riskScore, 'date_safety');
  return { safe: result.safe, warnings: result.warnings, resources: result.resources, riskScore: result.riskScore };
}

// ─── Quick Exit Handler ───
export function handleQuickExit(): void { quickExit(true); }

// ─── Batch Message Analysis (for conversation review) ───
export interface BatchMessageResult { totalMessages: number; flagged: number; riskCategories: Record<string, number>; highestRiskScore: number; action: SafetyAction; }

export async function batchAnalyzeMessages(messages: Array<{ text: string; senderId: string; timestamp: number }>, config: SafetyMiddlewareConfig = DEFAULT_CONFIG): Promise<BatchMessageResult> {
  const categories: Record<string, number> = {}; let flagged = 0, highestRisk = 0; let action: SafetyAction = 'allow';
  for (const msg of messages) {
    const result = await comprehensiveMessageCheck(msg.text, false, 0, config.serverUrl);
    if (result.riskScore > 0.2) { flagged++; for (const r of result.reasons) { categories[r] = (categories[r] || 0) + 1; } highestRisk = Math.max(highestRisk, result.riskScore); action = action === 'block' ? 'block' : result.action === 'block' ? 'block' : action === 'review' ? 'review' : result.action === 'review' ? 'review' : 'allow'; }
  }
  return { totalMessages: messages.length, flagged, riskCategories: categories, highestRiskScore: highestRisk, action };
}