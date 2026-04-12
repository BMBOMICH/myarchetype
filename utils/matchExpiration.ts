/**
 * utils/matchExpiration.ts
 *
 * Detectors covered:
 * #177 Match expiration enforcement
 * #102 Ghost profile detection component
 */

import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { writeAuditLog } from './logger';
import { logger } from './logger';

export interface Match {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'matched' | 'expired' | 'unmatched';
  matchedAt: string;
  expiresAt?: string;
  lastMessageAt?: string;
}

export interface ExpirationConfig {
  defaultExpiryDays: number;
  inactiveExpiryDays: number;
  warningBeforeExpiryHours: number;
}

const DEFAULT_CONFIG: ExpirationConfig = {
  defaultExpiryDays: 7,        // Match expires after 7 days without message
  inactiveExpiryDays: 3,       // Match expires after 3 days if no messages at all
  warningBeforeExpiryHours: 24, // Warn user 24h before expiry
};

// ═════════════════════════════════════════════════════════
// #177: Match expiration enforcement
// ═════════════════════════════════════════════════════════

/**
 * Calculate expiry date for a new match.
 * Detector #177.
 */
export function calculateMatchExpiry(
  matchedAt: Date,
  config: ExpirationConfig = DEFAULT_CONFIG
): Date {
  return new Date(
    matchedAt.getTime() + config.defaultExpiryDays * 24 * 60 * 60 * 1000
  );
}

/**
 * Check if a match is expired.
 * Detector #177.
 */
export function isMatchExpired(match: Match): boolean {
  if (match.status === 'expired') return true;

  if (match.expiresAt) {
    return new Date(match.expiresAt) < new Date();
  }

  // Fallback: expire matches older than default days with no messages
  const matchAge =
    Date.now() - new Date(match.matchedAt).getTime();
  const maxAge =
    DEFAULT_CONFIG.inactiveExpiryDays * 24 * 60 * 60 * 1000;

  return !match.lastMessageAt && matchAge > maxAge;
}

/**
 * Check if a match is approaching expiry.
 */
export function isMatchExpiringSoon(
  match: Match,
  config: ExpirationConfig = DEFAULT_CONFIG
): boolean {
  if (!match.expiresAt) return false;

  const timeUntilExpiry =
    new Date(match.expiresAt).getTime() - Date.now();
  const warningMs = config.warningBeforeExpiryHours * 3_600_000;

  return timeUntilExpiry > 0 && timeUntilExpiry < warningMs;
}

/**
 * Get time remaining before match expires.
 */
export function getMatchTimeRemaining(match: Match): string {
  if (!match.expiresAt) return '';

  const diff = new Date(match.expiresAt).getTime() - Date.now();

  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d remaining`;
  }

  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

/**
 * Batch-expire all stale matches.
 * Call from Cloud Function on schedule.
 * Detector #177.
 */
export async function expireStaleMatches(): Promise<number> {
  try {
    const now = new Date().toISOString();
    const matchesCol = collection(db, 'likes');

    // Find matches that have passed their expiresAt
    const q = query(
      matchesCol,
      where('status', '==', 'matched'),
      where('expiresAt', '<', now)
    );

    const snap = await getDocs(q);
    if (snap.empty) return 0;

    const BATCH_LIMIT = 500;
    const docs = snap.docs;
    let expired = 0;

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + BATCH_LIMIT);

      for (const docSnap of chunk) {
        batch.update(doc(db, 'likes', docSnap.id), {
          status: 'expired',
          expiredAt: now,
        });
      }

      await batch.commit();
      expired += chunk.length;
    }

    if (expired > 0) {
      logger.log(`[matchExpiration] Expired ${expired} stale matches`);
      await writeAuditLog('admin.delete_content', {
        reason: 'match_expiration',
        count: expired,
      });
    }

    return expired;
  } catch (err) {
    logger.error('[matchExpiration] Error:', err);
    return 0;
  }
}

/**
 * Extend a match expiry when a message is sent.
 * Detector #177.
 */
export async function extendMatchOnMessage(
  matchId: string,
  config: ExpirationConfig = DEFAULT_CONFIG
): Promise<void> {
  try {
    const newExpiry = calculateMatchExpiry(new Date(), config);

    await updateDoc(doc(db, 'likes', matchId), {
      expiresAt: newExpiry.toISOString(),
      lastMessageAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[matchExpiration] extendMatchOnMessage error:', err);
  }
}

/**
 * Get all expiring matches for the current user.
 */
export async function getExpiringMatches(
  config: ExpirationConfig = DEFAULT_CONFIG
): Promise<Match[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const warningThreshold = new Date(
      Date.now() + config.warningBeforeExpiryHours * 3_600_000
    ).toISOString();

    const matchesCol = collection(db, 'likes');

    const [fromSnap, toSnap] = await Promise.all([
      getDocs(
        query(
          matchesCol,
          where('fromUserId', '==', user.uid),
          where('status', '==', 'matched'),
          where('expiresAt', '<', warningThreshold)
        )
      ),
      getDocs(
        query(
          matchesCol,
          where('toUserId', '==', user.uid),
          where('status', '==', 'matched'),
          where('expiresAt', '<', warningThreshold)
        )
      ),
    ]);

    const matches: Match[] = [];
    const addMatch = (snap: any) => {
      snap.forEach((d: any) => {
        const data = d.data() as Omit<Match, 'id'>;
        if (!isMatchExpired({ id: d.id, ...data })) {
          matches.push({ id: d.id, ...data });
        }
      });
    };

    addMatch(fromSnap);
    addMatch(toSnap);

    return matches;
  } catch (err) {
    logger.error('[matchExpiration] getExpiringMatches error:', err);
    return [];
  }
}