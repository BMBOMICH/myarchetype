import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface SuperLike { fromUserId: string; toUserId: string; note: string; createdAt: string; seen: boolean; }

export async function sendSuperLike(toUserId: string, note: string): Promise<{ success: boolean; isMatch?: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (note.length > 200) return { success: false, error: 'Note must be under 200 characters' };
  try {
    const existing = await getDoc(doc(db, 'superLikes', `${user.uid}_${toUserId}`));
    if (existing.exists()) return { success: false, error: 'You already super liked this person' };
    const now = new Date().toISOString();
    const trimmedNote = note.trim();
    await setDoc(doc(db, 'superLikes', `${user.uid}_${toUserId}`), { fromUserId: user.uid, toUserId, note: trimmedNote, createdAt: now, seen: false });
    await setDoc(doc(db, 'likes', `${user.uid}_${toUserId}`), { fromUserId: user.uid, toUserId, status: 'pending', isSuperLike: true, superLikeNote: trimmedNote, createdAt: now });
    const theirSnap = await getDocs(query(collection(db, 'likes'), where('fromUserId', '==', toUserId), where('toUserId', '==', user.uid)));
    if (!theirSnap.empty) {
      const theirDoc = theirSnap.docs[0]!;
      await setDoc(doc(db, 'likes', theirDoc.id), { ...theirDoc.data(), status: 'matched', matchedAt: now });
      await setDoc(doc(db, 'likes', `${user.uid}_${toUserId}`), { fromUserId: user.uid, toUserId, status: 'matched', isSuperLike: true, superLikeNote: trimmedNote, createdAt: now, matchedAt: now });
      return { success: true, isMatch: true };
    }
    return { success: true, isMatch: false };
  } catch (error: unknown) {
    logger.error('Error sending super like:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getSuperLikesReceived(): Promise<SuperLike[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(query(collection(db, 'superLikes'), where('toUserId', '==', user.uid), where('seen', '==', false)));
    return snap.docs.map(d => d.data() as SuperLike);
  } catch (error: unknown) { logger.error('Error getting super likes:', error); return []; }
}

export async function markSuperLikeSeen(fromUserId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, 'superLikes', `${fromUserId}_${user.uid}`), { seen: true }, { merge: true });
  } catch (error: unknown) { logger.error('Error marking super like seen:', error); }
}