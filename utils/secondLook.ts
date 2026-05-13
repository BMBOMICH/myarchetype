import { addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface SkippedProfile {
  odid: string;
  odidName: string;
  skippedAt: string;
}

const MAX_SKIPPED_STORED      = 50;
const DAILY_SECOND_LOOK_LIMIT = 5;

export async function recordSkippedProfile(skippedUserId: string, skippedUserName: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const existing = await getDocs(query(
      collection(db, 'skippedProfiles'),
      where('userId', '==', user.uid),
      where('skippedUserId', '==', skippedUserId)
    ));
    if (!existing.empty) return;
    await addDoc(collection(db, 'skippedProfiles'), {
      userId: user.uid, skippedUserId, skippedUserName,
      skippedAt: new Date().toISOString(),
    });
    await cleanupOldSkippedProfiles(user.uid);
  } catch (error) {
    logger.error('Error recording skipped profile:', error);
  }
}

async function cleanupOldSkippedProfiles(userId: string): Promise<void> {
  try {
    const snapshot = await getDocs(query(
      collection(db, 'skippedProfiles'),
      where('userId', '==', userId),
      orderBy('skippedAt', 'asc')
    ));
    if (snapshot.size <= MAX_SKIPPED_STORED) return;
    const toDelete = snapshot.docs.slice(0, snapshot.size - MAX_SKIPPED_STORED);
    await Promise.all(toDelete.map((d) => deleteDoc(doc(db, 'skippedProfiles', d.id))));
  } catch (error) {
    logger.error('Error cleaning up skipped profiles:', error);
  }
}

export async function getSkippedProfiles(): Promise<SkippedProfile[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const snapshot = await getDocs(query(
      collection(db, 'skippedProfiles'),
      where('userId', '==', user.uid),
      orderBy('skippedAt', 'desc'),
      limit(DAILY_SECOND_LOOK_LIMIT)
    ));
    return snapshot.docs.map((d) => {
      const data = d.data();
      return { odid: data.skippedUserId, odidName: data.skippedUserName, skippedAt: data.skippedAt };
    });
  } catch (error) {
    logger.error('Error getting skipped profiles:', error);
    return [];
  }
}

export async function removeFromSkipped(skippedUserId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const snapshot = await getDocs(query(
      collection(db, 'skippedProfiles'),
      where('userId', '==', user.uid),
      where('skippedUserId', '==', skippedUserId)
    ));
    await Promise.all(snapshot.docs.map((d) => deleteDoc(doc(db, 'skippedProfiles', d.id))));
  } catch (error) {
    logger.error('Error removing from skipped:', error);
  }
}

export function formatSkippedTime(skippedAt: string): string {
  const skipped  = new Date(skippedAt);
  const diffMs   = Date.now() - skipped.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs  = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs  < 24) return `${diffHrs}h ago`;
  if (diffDays <  7) return `${diffDays}d ago`;
  return skipped.toLocaleDateString();
}