/**
 * utils/matchExpiration.ts
 * #177 Match expiration enforcement
 * #102 Ghost profile detection component
 */
import { collection, doc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger, writeAuditLog } from './logger';

export interface Match {
  id: string; fromUserId: string; toUserId: string;
  status: 'matched' | 'expired' | 'unmatched';
  matchedAt: string; expiresAt?: string; lastMessageAt?: string;
}

export interface ExpirationConfig { defaultExpiryDays: number; inactiveExpiryDays: number; warningBeforeExpiryHours: number; }

const DEFAULT_CONFIG: ExpirationConfig = { defaultExpiryDays: 7, inactiveExpiryDays: 3, warningBeforeExpiryHours: 24 };

export function calculateMatchExpiry(matchedAt: Date, config: ExpirationConfig = DEFAULT_CONFIG): Date {
  return new Date(matchedAt.getTime() + config.defaultExpiryDays * 86_400_000);
}

export function isMatchExpired(match: Match): boolean {
  if (match.status === 'expired') return true;
  if (match.expiresAt) return new Date(match.expiresAt) < new Date();
  return !match.lastMessageAt && Date.now() - new Date(match.matchedAt).getTime() > DEFAULT_CONFIG.inactiveExpiryDays * 86_400_000;
}

export function isMatchExpiringSoon(match: Match, config: ExpirationConfig = DEFAULT_CONFIG): boolean {
  if (!match.expiresAt) return false;
  const timeUntilExpiry = new Date(match.expiresAt).getTime() - Date.now();
  return timeUntilExpiry > 0 && timeUntilExpiry < config.warningBeforeExpiryHours * 3_600_000;
}

export function getMatchTimeRemaining(match: Match): string {
  if (!match.expiresAt) return '';
  const diff = new Date(match.expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export async function expireStaleMatches(): Promise<number> {
  try {
    const now = new Date().toISOString();
    const snap = await getDocs(query(collection(db, 'likes'), where('status', '==', 'matched'), where('expiresAt', '<', now)));
    if (snap.empty) return 0;
    let expired = 0;
    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 500).forEach(d => batch.update(doc(db, 'likes', d.id), { status: 'expired', expiredAt: now }));
      await batch.commit();
      expired += Math.min(500, snap.docs.length - i);
    }
    if (expired > 0) {
      logger.warn(`[matchExpiration] Expired ${expired} stale matches`);
      await writeAuditLog('admin.delete_content', { reason: 'match_expiration', count: expired });
    }
    return expired;
  } catch (err: unknown) { logger.error('[matchExpiration] Error:', err); return 0; }
}

export async function extendMatchOnMessage(matchId: string, config: ExpirationConfig = DEFAULT_CONFIG): Promise<void> {
  try {
    await updateDoc(doc(db, 'likes', matchId), { expiresAt: calculateMatchExpiry(new Date(), config).toISOString(), lastMessageAt: new Date().toISOString() });
  } catch (err: unknown) { logger.error('[matchExpiration] extendMatchOnMessage error:', err); }
}

export async function getExpiringMatches(config: ExpirationConfig = DEFAULT_CONFIG): Promise<Match[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const threshold = new Date(Date.now() + config.warningBeforeExpiryHours * 3_600_000).toISOString();
    const col = collection(db, 'likes');
    const baseQuery = (field: string) => query(col, where(field, '==', user.uid), where('status', '==', 'matched'), where('expiresAt', '<', threshold));
    const [fromSnap, toSnap] = await Promise.all([getDocs(baseQuery('fromUserId')), getDocs(baseQuery('toUserId'))]);
    const matches: Match[] = [];
    const addSnap = (snap: typeof fromSnap) => snap.forEach(d => { const data = d.data() as Omit<Match, 'id'>; if (!isMatchExpired({ id: d.id, ...data })) matches.push({ id: d.id, ...data }); });
    addSnap(fromSnap); addSnap(toSnap);
    return matches;
  } catch (err: unknown) { logger.error('[matchExpiration] getExpiringMatches error:', err); return []; }
}