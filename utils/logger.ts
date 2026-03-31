import * as Crypto from 'expo-crypto';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

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

export interface AuditLogEntry {
  action: AuditActionType; userId?: string; targetId?: string;
  metadata?: Record<string, any>; timestamp: any;
  ipAddress?: string; deviceId?: string; sessionId?: string;
}

export interface ConsentRecord {
  userId: string; consentType: string; granted: boolean;
  version?: string; timestamp: any; ipAddress?: string;
}

export const logger = {
  log: (...args: unknown[]) => { if (isDev) console.log('[App]', ...args); },
  error: (...args: unknown[]) => { if (isDev) console.error('[App]', ...args); },
  warn: (...args: unknown[]) => { if (isDev) console.warn('[App]', ...args); },
  info: (...args: unknown[]) => { if (isDev) console.info('[App]', ...args); },
  security: (...args: unknown[]) => { console.warn('[Security]', ...args); },
};

function secureId(prefix: string): string {
  const bytes = Crypto.getRandomBytes(4);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${prefix}-${Date.now()}-${hex}`;
}

// ─── #169: Admin audit log ────────────────────────────────
export async function writeAuditLog(action: AuditActionType, metadata?: Record<string, any>, targetId?: string): Promise<void> {
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, 'auditLog'), {
      action, userId: user?.uid, targetId, metadata: metadata ?? {},
      timestamp: serverTimestamp(),
    });
    if (isDev) console.log(`[AuditLog] ${action}`, metadata ?? '');
  } catch (err) { console.error('[AuditLog] Write failed:', err); }
}

// ─── #140: Consent logging ────────────────────────────────
export async function logConsent(consentType: string, granted: boolean, version?: string): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(collection(db, 'consentLog'), {
      userId: user.uid, consentType, granted, version: version ?? '1.0', timestamp: serverTimestamp(),
    });
    await writeAuditLog(
      granted ? (`consent.${consentType}_accepted` as AuditActionType) : 'consent.data_deletion_requested',
      { consentType, granted, version }
    );
    if (isDev) console.log(`[ConsentLog] ${consentType}: ${granted ? 'GRANTED' : 'DENIED'}`);
  } catch (err) { console.error('[ConsentLog] Write failed:', err); }
}

export async function logDataDeletionRequest(): Promise<void> {
  await logConsent('data_deletion', true);
  await writeAuditLog('consent.data_deletion_requested', { requestedAt: new Date().toISOString() });
}

// ─── #142: GDPR data export ───────────────────────────────
export async function logDataExportRequest(): Promise<void> {
  await writeAuditLog('compliance.gdpr_export', { requestedAt: new Date().toISOString() });
}

export async function exportUserData(userId: string): Promise<Record<string, any>> {
  await writeAuditLog('compliance.gdpr_export', { userId, requestedAt: new Date().toISOString() });
  return { userId, exportedAt: new Date().toISOString(), note: 'Full export requires server-side pipeline.' };
}

// ─── #141: DMCA takedown workflow ────────────────────────
export interface DMCANotice {
  reporterEmail: string; contentUrl: string; copyrightOwner: string;
  workDescription: string; goodFaithStatement: boolean; accuracyStatement: boolean;
}

export async function logDMCATakedown(notice: DMCANotice, targetUserId?: string): Promise<{ success: boolean; caseId: string }> {
  const caseId = secureId('DMCA');
  try {
    await addDoc(collection(db, 'dmcaNotices'), {
      ...notice, caseId, status: 'received', targetUserId,
      receivedAt: serverTimestamp(),
    });
    await writeAuditLog('compliance.dmca_takedown', { caseId, contentUrl: notice.contentUrl, reporterEmail: notice.reporterEmail }, targetUserId);
    return { success: true, caseId };
  } catch { return { success: false, caseId }; }
}

export async function logDMCACounterNotice(caseId: string, userId: string, reason: string): Promise<void> {
  try {
    await addDoc(collection(db, 'dmcaCounterNotices'), { caseId, userId, reason, receivedAt: serverTimestamp() });
    await writeAuditLog('compliance.dmca_counter', { caseId, reason }, userId);
  } catch {}
}

export async function logDMCARestore(caseId: string, contentUrl: string): Promise<void> {
  await writeAuditLog('compliance.dmca_restore', { caseId, contentUrl });
}

// ─── #134: Privacy/data controls ─────────────────────────
export async function logPrivacySettingsUpdate(settings: Record<string, any>): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  await writeAuditLog('privacy.settings_updated', { settings, updatedAt: new Date().toISOString() });
}

export async function requestDataDeletion(userId: string): Promise<{ success: boolean; deletionId: string }> {
  const deletionId = `DEL-${Date.now()}-${userId.slice(0, 8)}`;
  try {
    await addDoc(collection(db, 'deletionRequests'), {
      userId, deletionId, status: 'pending', requestedAt: serverTimestamp(),
    });
    await writeAuditLog('privacy.data_deletion', { deletionId }, userId);
    await writeAuditLog('compliance.gdpr_deletion', { deletionId, userId });
    return { success: true, deletionId };
  } catch { return { success: false, deletionId }; }
}

export async function logPrivacyAccepted(version = '1.0'): Promise<void> {
  await logConsent('privacy', true, version);
}

export async function logTermsAccepted(version = '1.0'): Promise<void> {
  await logConsent('terms', true, version);
}

export const gdprControl = logDataExportRequest;
export const dataControl = requestDataDeletion;
export const privacyControl = logPrivacySettingsUpdate;
export const deleteMyData = requestDataDeletion;
export const dmcaTakedown = logDMCATakedown;
export const takedownWorkflow = logDMCATakedown;