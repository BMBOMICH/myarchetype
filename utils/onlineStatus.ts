import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

interface FirestoreTimestamp {
  toDate: () => Date;
}

type LastSeen = FirestoreTimestamp | Date | string | number | null | undefined;

function toDate(lastSeen: LastSeen): Date | null {
  if (!lastSeen) return null;
  try {
    if (typeof lastSeen === 'object' && 'toDate' in lastSeen) return lastSeen.toDate();
    return new Date(lastSeen as string | number | Date);
  } catch { return null; }
}

interface FirestoreError { code?: string; }
function getFirestoreErrorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? (e as FirestoreError).code
    : undefined;
}

export const updateLastSeen = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, 'users', user.uid), {
      lastSeen: serverTimestamp(),
      isOnline: true,
    });
  } catch (error: unknown) {
    if (getFirestoreErrorCode(error) === 'permission-denied') return;
    logger.error('Error updating last seen:', error);
  }
};

export const setOffline = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, 'users', user.uid), {
      isOnline: false,
      lastSeen: serverTimestamp(),
    });
  } catch (error: unknown) {
    if (getFirestoreErrorCode(error) === 'permission-denied') return;
    logger.error('Error setting offline:', error);
  }
};

export const formatLastSeen = (lastSeen: LastSeen): string => {
  const date = toDate(lastSeen);
  if (!date) return '';
  try {
    const now = new Date();
    const diffMs    = now.getTime() - date.getTime();
    const diffMins  = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays  = Math.floor(diffMs / 86400000);
    if (diffMins < 1)   return 'Just now';
    if (diffMins < 60)  return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7)   return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch { return ''; }
};

export const isUserOnline = (lastSeen: LastSeen): boolean => {
  const date = toDate(lastSeen);
  if (!date) return false;
  try {
    const diffMs   = new Date().getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    return diffMins < 5;
  } catch { return false; }
};