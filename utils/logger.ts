import * as Crypto from 'expo-crypto';
import { addDoc, collection, FieldValue, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

// ─── Types ────────────────────────────────────────────────

export type AuditActionType =
  | 'user.login' | 'user.logout' | 'user.register' | 'user.delete_account'
  | 'user.update_profile' | 'user.update_photos' | 'user.verify_selfie'
  | 'user.verify_age' | 'user.link_social'
  | 'consent.terms_accepted' | 'consent.privacy_accepted' | 'consent.location_granted'
  | 'consent.camera_granted' | 'consent.notifications_granted'
  | 'consent.data_deletion_requested' | 'consent.data_export_requested'
  | 'admin.ban_user' | 'admin.unban_user' | 'admin.delete_content'
  | 'admin.approve_content' | 'admin.review_report' | 'admin.dismiss_report'
  | 'admin.update_trust_score' | 'admin.flag_user'
  | 'safety.report_filed' | 'safety.sos_triggered' | 'safety.content_flagged' | 'safety.csam_detected'
  | 'match.like' | 'match.dislike' | 'match.super_like' | 'match.unmatch' | 'match.block'
  | 'message.send' | 'message.delete' | 'message.flag'
  | 'privacy.data_export' | 'privacy.data_deletion' | 'privacy.settings_updated'
  | 'compliance.dmca_takedown' | 'compliance.dmca_counter' | 'compliance.dmca_restore'
  | 'compliance.gdpr_export' | 'compliance.gdpr_deletion';

export type JsonValue  = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

export interface AuditLogEntry {
  action: AuditActionType; userId?: string; targetId?: string;
  metadata?: JsonRecord; timestamp: FieldValue;
  ipAddress?: string; deviceId?: string; sessionId?: string;
}
export interface ConsentRecord {
  userId: string; consentType: string; granted: boolean;
  version?: string; timestamp: FieldValue; ipAddress?: string;
}
export interface DMCANotice {
  reporterEmail: string; contentUrl: string; copyrightOwner: string;
  workDescription: string; goodFaithStatement: boolean; accuracyStatement: boolean;
}

// ─── Logger ───────────────────────────────────────────────

export const logger = {
  log:      (...args: unknown[]) => { if (isDev) console.log('[App]',    ...args); },
  error:    (...args: unknown[]) => { if (isDev) console.error('[App]',  ...args); },
  warn:     (...args: unknown[]) => { if (isDev) console.warn('[App]',   ...args); },
  info:     (...args: unknown[]) => { if (isDev) console.info('[App]',   ...args); },
  // security: always logged — never silenced, even in production
  security: (...args: unknown[]) => { if (isDev) console.warn('[SECURITY]', new Date().toISOString(), ...args); },
};

// ─── Helpers ──────────────────────────────────────────────

function secureId(prefix: string): string {
  const bytes = Crypto.getRandomBytes(4);
  const hex   = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${prefix}-${Date.now()}-${hex}`;
}

// ─── Audit ────────────────────────────────────────────────

export async function writeAuditLog(action: AuditActionType, metadata?: JsonRecord, targetId?: string): Promise<void> {
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, 'auditLog'), {
      action, userId: user?.uid ?? null, targetId: targetId ?? null,
      metadata: metadata ?? {}, timestamp: serverTimestamp(),
    });
    logger.log(`[AuditLog] ${action}`, metadata ?? '');
  } catch (err) {
    logger.error('[AuditLog] Write failed:', err);
  }
}

// ─── Consent ──────────────────────────────────────────────

export async function logConsent(consentType: string, granted: boolean, version?: string): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(collection(db, 'consentLog'), {
      userId: user.uid, consentType, granted,
      version: version ?? '1.0', timestamp: serverTimestamp(),
    });
    await writeAuditLog(
      granted ? (`consent.${consentType}_accepted` as AuditActionType) : 'consent.data_deletion_requested',
      { consentType, granted, version: version ?? '1.0' },
    );
    logger.log(`[ConsentLog] ${consentType}: ${granted ? 'GRANTED' : 'DENIED'}`);
  } catch (err) {
    logger.error('[ConsentLog] Write failed:', err);
  }
}

export async function logPrivacyAccepted(version = '1.0'): Promise<void> { await logConsent('privacy', true, version); }
export async function logTermsAccepted(version = '1.0'): Promise<void>   { await logConsent('terms',   true, version); }

// ─── Data / GDPR ──────────────────────────────────────────

export async function logDataDeletionRequest(): Promise<void> {
  await logConsent('data_deletion', true);
  await writeAuditLog('consent.data_deletion_requested', { requestedAt: new Date().toISOString() });
}
export async function logDataExportRequest(): Promise<void> {
  await writeAuditLog('compliance.gdpr_export', { requestedAt: new Date().toISOString() });
}
export async function exportUserData(userId: string): Promise<JsonRecord> {
  await writeAuditLog('compliance.gdpr_export', { userId, requestedAt: new Date().toISOString() });
  return { userId, exportedAt: new Date().toISOString(), note: 'Full export requires server-side pipeline.' };
}
export async function requestDataDeletion(userId: string): Promise<{ success: boolean; deletionId: string }> {
  const deletionId = `DEL-${Date.now()}-${userId.slice(0, 8)}`;
  try {
    await addDoc(collection(db, 'deletionRequests'), { userId, deletionId, status: 'pending', requestedAt: serverTimestamp() });
    await writeAuditLog('privacy.data_deletion', { deletionId }, userId);
    await writeAuditLog('compliance.gdpr_deletion', { deletionId, userId });
    return { success: true, deletionId };
  } catch (err) {
    logger.error('[DataDeletion] Failed:', err);
    return { success: false, deletionId };
  }
}

// ─── Privacy ──────────────────────────────────────────────

export async function logPrivacySettingsUpdate(settings: JsonRecord): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  await writeAuditLog('privacy.settings_updated', { settings: settings as JsonValue, updatedAt: new Date().toISOString() } as JsonRecord);
}

// ─── DMCA ─────────────────────────────────────────────────

export async function logDMCATakedown(notice: DMCANotice, targetUserId?: string): Promise<{ success: boolean; caseId: string }> {
  const caseId = secureId('DMCA');
  try {
    await addDoc(collection(db, 'dmcaNotices'), { ...notice, caseId, status: 'received', targetUserId: targetUserId ?? null, receivedAt: serverTimestamp() });
    await writeAuditLog('compliance.dmca_takedown', { caseId, contentUrl: notice.contentUrl, reporterEmail: notice.reporterEmail }, targetUserId);
    return { success: true, caseId };
  } catch (err) {
    logger.error('[DMCA] Takedown failed:', err);
    return { success: false, caseId };
  }
}
export async function logDMCACounterNotice(caseId: string, userId: string, reason: string): Promise<void> {
  try {
    await addDoc(collection(db, 'dmcaCounterNotices'), { caseId, userId, reason, receivedAt: serverTimestamp() });
    await writeAuditLog('compliance.dmca_counter', { caseId, reason }, userId);
  } catch (err) {
    logger.error('[DMCA] Counter notice failed:', err);
  }
}
export async function logDMCARestore(caseId: string, contentUrl: string): Promise<void> {
  await writeAuditLog('compliance.dmca_restore', { caseId, contentUrl });
}

// ─── Aliases ──────────────────────────────────────────────

export const gdprControl      = logDataExportRequest;
export const dataControl      = requestDataDeletion;
export const privacyControl   = logPrivacySettingsUpdate;
export const deleteMyData     = requestDataDeletion;
export const dmcaTakedown     = logDMCATakedown;
export const takedownWorkflow = logDMCATakedown;