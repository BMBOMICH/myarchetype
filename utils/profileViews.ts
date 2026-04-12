/**
 * utils/profileViews.ts
 *
 * Detectors covered:
 * #100 Stalking behavior (excessive profile views)
 * #175 Profile view rate limiting
 */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { writeAuditLog } from './logger';
import { trackProfileView } from './rateLimiter';
import { logger } from './logger';

export interface ProfileView {
  id: string;
  viewerId: string;
  viewedUserId: string;
  viewedAt: string;
  viewerName?: string;
  viewerPhoto?: string;
}

export interface ProfileViewStats {
  totalViews: number;
  uniqueViewers: number;
  viewsToday: number;
  viewsThisWeek: number;
  recentViewers: ProfileView[];
}

export interface StalkingAlert {
  detected: boolean;
  viewerId: string;
  viewCount: number;
  windowHours: number;
  reason: string;
}

// ═════════════════════════════════════════════════════════
// #100 + #175: Record a profile view with stalking detection
// ═════════════════════════════════════════════════════════

/**
 * Record that a user viewed a profile.
 * Applies rate limiting (#175) and stalking detection (#100).
 */
export async function recordProfileView(
  viewedUserId: string
): Promise<{ recorded: boolean; stalkingAlert?: StalkingAlert }> {
  const viewer = auth.currentUser;
  if (!viewer) return { recorded: false };

  // Don't record self-views
  if (viewer.uid === viewedUserId) return { recorded: false };

  // #175: Rate limiting
  const stalkCheck = trackProfileView(viewer.uid, viewedUserId);

  let stalkingAlert: StalkingAlert | undefined;

  if (stalkCheck.suspicious) {
    stalkingAlert = {
      detected: true,
      viewerId: viewer.uid,
      viewCount: stalkCheck.viewCount,
      windowHours: 1,
      reason: `${stalkCheck.viewCount} profile views in 1 hour — possible stalking behavior.`,
    };

    // Log to audit trail
    await writeAuditLog('safety.content_flagged', {
      type: 'stalking_view_pattern',
      viewerId: viewer.uid,
      targetId: viewedUserId,
      viewCount: stalkCheck.viewCount,
    }, viewedUserId);

    logger.warn('[profileViews] Stalking pattern detected:', stalkingAlert.reason);
  }

  // #175: Block excessive views
  if (stalkCheck.viewCount > 20) {
    return { recorded: false, stalkingAlert };
  }

  try {
    // Get viewer's display info
    const viewerDoc = await getDoc(doc(db, 'users', viewer.uid));
    const viewerData = viewerDoc.exists() ? viewerDoc.data() : {};

    await addDoc(collection(db, 'profileViews'), {
      viewerId: viewer.uid,
      viewedUserId,
      viewedAt: serverTimestamp(),
      viewerName: viewerData.name ?? '',
      viewerPhoto: viewerData.photos?.[0] ?? '',
    });

    return { recorded: true, stalkingAlert };
  } catch (err) {
    logger.error('[profileViews] recordProfileView error:', err);
    return { recorded: false };
  }
}

// ═════════════════════════════════════════════════════════
// Get profile view stats
// ═════════════════════════════════════════════════════════

export async function getProfileViewStats(
  userId?: string
): Promise<ProfileViewStats> {
  const targetId = userId ?? auth.currentUser?.uid;
  if (!targetId) {
    return {
      totalViews: 0,
      uniqueViewers: 0,
      viewsToday: 0,
      viewsThisWeek: 0,
      recentViewers: [],
    };
  }

  try {
    const viewsCol = collection(db, 'profileViews');
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [totalSnap, todaySnap, weekSnap, recentSnap] = await Promise.all([
      getDocs(query(viewsCol, where('viewedUserId', '==', targetId))),
      getDocs(
        query(
          viewsCol,
          where('viewedUserId', '==', targetId),
          where('viewedAt', '>=', todayStart)
        )
      ),
      getDocs(
        query(
          viewsCol,
          where('viewedUserId', '==', targetId),
          where('viewedAt', '>=', weekStart)
        )
      ),
      getDocs(
        query(
          viewsCol,
          where('viewedUserId', '==', targetId),
          orderBy('viewedAt', 'desc'),
          limit(20)
        )
      ),
    ]);

    const uniqueViewers = new Set<string>();
    totalSnap.forEach((d) => uniqueViewers.add(d.data().viewerId));

    const recentViewers: ProfileView[] = [];
    recentSnap.forEach((d) => {
      recentViewers.push({ id: d.id, ...d.data() } as ProfileView);
    });

    return {
      totalViews: totalSnap.size,
      uniqueViewers: uniqueViewers.size,
      viewsToday: todaySnap.size,
      viewsThisWeek: weekSnap.size,
      recentViewers,
    };
  } catch (err) {
    logger.error('[profileViews] getStats error:', err);
    return {
      totalViews: 0,
      uniqueViewers: 0,
      viewsToday: 0,
      viewsThisWeek: 0,
      recentViewers: [],
    };
  }
}

export async function getWhoViewedMe(limitCount = 20): Promise<ProfileView[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const snap = await getDocs(
      query(
        collection(db, 'profileViews'),
        where('viewedUserId', '==', user.uid),
        orderBy('viewedAt', 'desc'),
        limit(limitCount)
      )
    );

    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    })) as ProfileView[];
  } catch (err) {
    logger.error('[profileViews] getWhoViewedMe error:', err);
    return [];
  }
}