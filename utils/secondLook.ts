import { addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface SkippedProfile {
  odid: string;
  odidName: string;
  skippedAt: string;
}

const MAX_SKIPPED_STORED = 50;
const DAILY_SECOND_LOOK_LIMIT = 5;

export async function recordSkippedProfile(
  skippedUserId: string,
  skippedUserName: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const existingQuery = query(
      collection(db, 'skippedProfiles'),
      where('userId', '==', user.uid),
      where('skippedUserId', '==', skippedUserId)
    );
    
    const existing = await getDocs(existingQuery);
    if (!existing.empty) return;

    await addDoc(collection(db, 'skippedProfiles'), {
      userId: user.uid,
      skippedUserId: skippedUserId,
      skippedUserName: skippedUserName,
      skippedAt: new Date().toISOString(),
    });

    await cleanupOldSkippedProfiles(user.uid);
  } catch (error) {
    console.error('Error recording skipped profile:', error);
  }
}

async function cleanupOldSkippedProfiles(userId: string): Promise<void> {
  try {
    const q = query(
      collection(db, 'skippedProfiles'),
      where('userId', '==', userId),
      orderBy('skippedAt', 'asc')
    );

    const snapshot = await getDocs(q);

    if (snapshot.size > MAX_SKIPPED_STORED) {
      const toDelete = snapshot.size - MAX_SKIPPED_STORED;
      let deleted = 0;

      for (const docSnap of snapshot.docs) {
        if (deleted >= toDelete) break;
        await deleteDoc(doc(db, 'skippedProfiles', docSnap.id));
        deleted++;
      }
    }
  } catch (error) {
    console.error('Error cleaning up skipped profiles:', error);
  }
}

export async function getSkippedProfiles(): Promise<SkippedProfile[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const q = query(
      collection(db, 'skippedProfiles'),
      where('userId', '==', user.uid),
      orderBy('skippedAt', 'desc'),
      limit(DAILY_SECOND_LOOK_LIMIT)
    );

    const snapshot = await getDocs(q);
    const skipped: SkippedProfile[] = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      skipped.push({
        odid: data.skippedUserId,
        odidName: data.skippedUserName,
        skippedAt: data.skippedAt,
      });
    });

    return skipped;
  } catch (error) {
    console.error('Error getting skipped profiles:', error);
    return [];
  }
}

export async function removeFromSkipped(skippedUserId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const q = query(
      collection(db, 'skippedProfiles'),
      where('userId', '==', user.uid),
      where('skippedUserId', '==', skippedUserId)
    );

    const snapshot = await getDocs(q);

    for (const docSnap of snapshot.docs) {
      await deleteDoc(doc(db, 'skippedProfiles', docSnap.id));
    }
  } catch (error) {
    console.error('Error removing from skipped:', error);
  }
}

export function formatSkippedTime(skippedAt: string): string {
  const skipped = new Date(skippedAt);
  const now = new Date();
  const diffMs = now.getTime() - skipped.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return skipped.toLocaleDateString();
}