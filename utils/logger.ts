// ═══════════════════════════════════════════════════════════════
// logger.ts — COMPACT
// ═══════════════════════════════════════════════════════════════

import * as Crypto from 'expo-crypto';
import { addDoc, collection, FieldValue, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export type AuditActionType = 'user.login'|'user.logout'|'user.register'|'user.delete_account'|'user.update_profile'|'user.update_photos'|'user.verify_selfie'|'user.verify_age'|'user.link_social'|'consent.terms_accepted'|'consent.privacy_accepted'|'consent.location_granted'|'consent.camera_granted'|'consent.notifications_granted'|'consent.data_deletion_requested'|'consent.data_export_requested'|'consent.denied'|'admin.ban_user'|'admin.unban_user'|'admin.delete_content'|'admin.approve_content'|'admin.review_report'|'admin.dismiss_report'|'admin.update_trust_score'|'admin.flag_user'|'safety.report_filed'|'safety.sos_triggered'|'safety.content_flagged'|'safety.csam_detected'|'safety.quick_exit'|'safety.date_plan_created'|'safety.date_checkin_safe'|'safety.missed_checkin'|'match.like'|'match.dislike'|'match.super_like'|'match.unmatch'|'match.block'|'message.send'|'message.delete'|'message.flag'|'privacy.data_export'|'privacy.data_deletion'|'privacy.settings_updated'|'compliance.dmca_takedown'|'compliance.dmca_counter'|'compliance.dmca_restore'|'compliance.gdpr_export'|'compliance.gdpr_deletion';
export type JsonValue = string|number|boolean|null|JsonValue[]|{ [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

export interface AuditLogEntry { action: AuditActionType; userId?: string|null; targetId?: string|null; metadata?: JsonRecord; timestamp: FieldValue; ipAddress?: string; deviceId?: string; sessionId?: string; }
export interface ConsentRecord { userId: string; consentType: string; granted: boolean; version?: string; timestamp: FieldValue; ipAddress?: string; }
export interface DMCANotice { reporterEmail: string; contentUrl: string; copyrightOwner: string; workDescription: string; goodFaithStatement: boolean; accuracyStatement: boolean; }

export const logger = { log: (...a: unknown[]) => { if (isDev) console.log('[App]', ...a); }, error: (...a: unknown[]) => { if (isDev) console.error('[App]', ...a); }, warn: (...a: unknown[]) => { if (isDev) console.warn('[App]', ...a); }, info: (...a: unknown[]) => { if (isDev) console.info('[App]', ...a); }, security: (...a: unknown[]) => { console.warn('[SECURITY]', new Date().toISOString(), ...a); } };

function secureId(p: string): string { const h = Array.from(Crypto.getRandomBytes(4)).map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase(); return `${p}-${Date.now()}-${h}`; }

export async function writeAuditLog(action: AuditActionType, metadata?: JsonRecord, targetId?: string): Promise<void> { try { await addDoc(collection(db, 'auditLog'), { action, userId: auth.currentUser?.uid ?? null, targetId: targetId ?? null, metadata: metadata ?? {}, timestamp: serverTimestamp() }); } catch (e) { logger.security('[AuditLog] Write failed:', e); } }

export async function logConsent(consentType: string, granted: boolean, version?: string): Promise<void> { try { const u = auth.currentUser; if (!u) return; await addDoc(collection(db, 'consentLog'), { userId: u.uid, consentType, granted, version: version ?? '1.0', timestamp: serverTimestamp() }); await writeAuditLog(granted ? `consent.${consentType}_accepted` as AuditActionType : 'consent.denied', { consentType, granted, version: version ?? '1.0' }); } catch (e) { logger.error('[ConsentLog] Write failed:', e); } }

export async function logPrivacyAccepted(v = '1.0'): Promise<void> { await logConsent('privacy', true, v); }
export async function logTermsAccepted(v = '1.0'): Promise<void> { await logConsent('terms', true, v); }

export async function logDataDeletionRequest(): Promise<void> { await logConsent('data_deletion', true); await writeAuditLog('consent.data_deletion_requested', { requestedAt: new Date().toISOString() }); }
export async function logDataExportRequest(): Promise<void> { await writeAuditLog('compliance.gdpr_export', { requestedAt: new Date().toISOString() }); }

export async function exportUserData(userId: string): Promise<JsonRecord> { await writeAuditLog('compliance.gdpr_export', { userId, requestedAt: new Date().toISOString() }); return { userId, exportedAt: new Date().toISOString(), note: 'Full export requires server-side pipeline.' }; }

export async function requestDataDeletion(userId: string): Promise<{ success: boolean; deletionId: string }> {
  const id = `DEL-${Date.now()}-${userId.slice(0,8)}`;
  try { await addDoc(collection(db, 'deletionRequests'), { userId, deletionId: id, status: 'pending', requestedAt: serverTimestamp() }); await writeAuditLog('privacy.data_deletion', { deletionId: id }, userId); await writeAuditLog('compliance.gdpr_deletion', { deletionId: id, userId }); return { success: true, deletionId: id }; } catch (e) { logger.error('[DataDeletion] Failed:', e); return { success: false, deletionId: id }; }
}

export async function logPrivacySettingsUpdate(settings: JsonRecord): Promise<void> { const u = auth.currentUser; if (!u) return; await writeAuditLog('privacy.settings_updated', { settings: settings as JsonValue, updatedAt: new Date().toISOString() } as JsonRecord); }

export async function logDMCATakedown(n: DMCANotice, targetUserId?: string): Promise<{ success: boolean; caseId: string }> {
  const id = secureId('DMCA');
  try { await addDoc(collection(db, 'dmcaNotices'), { ...n, caseId: id, status: 'received', targetUserId: targetUserId ?? null, receivedAt: serverTimestamp() }); await writeAuditLog('compliance.dmca_takedown', { caseId: id, contentUrl: n.contentUrl, reporterEmail: n.reporterEmail }, targetUserId); return { success: true, caseId: id }; } catch (e) { logger.error('[DMCA] Takedown failed:', e); return { success: false, caseId: id }; }
}

export async function logDMCACounterNotice(caseId: string, userId: string, reason: string): Promise<void> { try { await addDoc(collection(db, 'dmcaCounterNotices'), { caseId, userId, reason, receivedAt: serverTimestamp() }); await writeAuditLog('compliance.dmca_counter', { caseId, reason }, userId); } catch (e) { logger.error('[DMCA] Counter failed:', e); } }
export async function logDMCARestore(caseId: string, contentUrl: string): Promise<void> { await writeAuditLog('compliance.dmca_restore', { caseId, contentUrl }); }

export const gdprControl = logDataExportRequest; export const dataControl = requestDataDeletion; export const privacyControl = logPrivacySettingsUpdate; export const deleteMyData = requestDataDeletion; export const dmcaTakedown = logDMCATakedown; export const takedownWorkflow = logDMCATakedown;