import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface SuperLike {
  fromUserId: string;
  toUserId: string;
  note: string;
  createdAt: string;
  seen: boolean;
}

export async function sendSuperLike(
  toUserId: string,
  note: string
): Promise<{ success: boolean; isMatch?: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  if (note.length > 200) {
    return { success: false, error: 'Note must be under 200 characters' };
  }

  try {
    // Check if already super liked
    const existingDoc = await getDoc(doc(db, 'superLikes', `${user.uid}_${toUserId}`));
    if (existingDoc.exists()) {
      return { success: false, error: 'You already super liked this person' };
    }

    // Create super like
    await setDoc(doc(db, 'superLikes', `${user.uid}_${toUserId}`), {
      fromUserId: user.uid,
      toUserId: toUserId,
      note: note.trim(),
      createdAt: new Date().toISOString(),
      seen: false,
    });

    // Also create regular like for matching logic
    await setDoc(doc(db, 'likes', `${user.uid}_${toUserId}`), {
      fromUserId: user.uid,
      toUserId: toUserId,
      status: 'pending',
      isSuperLike: true,
      superLikeNote: note.trim(),
      createdAt: new Date().toISOString(),
    });

    // Check if they already liked us (it's a match!)
    const theirLikeQuery = query(
      collection(db, 'likes'),
      where('fromUserId', '==', toUserId),
      where('toUserId', '==', user.uid)
    );
    const theirLikeSnapshot = await getDocs(theirLikeQuery);

    if (!theirLikeSnapshot.empty) {
      // It's a match! Update both records
      const theirLikeDoc = theirLikeSnapshot.docs[0];
      await setDoc(doc(db, 'likes', theirLikeDoc.id), {
        ...theirLikeDoc.data(),
        status: 'matched',
        matchedAt: new Date().toISOString(),
      });

      await setDoc(doc(db, 'likes', `${user.uid}_${toUserId}`), {
        fromUserId: user.uid,
        toUserId: toUserId,
        status: 'matched',
        isSuperLike: true,
        superLikeNote: note.trim(),
        createdAt: new Date().toISOString(),
        matchedAt: new Date().toISOString(),
      });

      return { success: true, isMatch: true };
    }

    return { success: true, isMatch: false };
  } catch (error: any) {
    logger.error('Error sending super like:', error);
    return { success: false, error: error.message };
  }
}

export async function getSuperLikesReceived(): Promise<SuperLike[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const q = query(
      collection(db, 'superLikes'),
      where('toUserId', '==', user.uid),
      where('seen', '==', false)
    );
    const snapshot = await getDocs(q);

    const superLikes: SuperLike[] = [];
    snapshot.forEach((doc) => {
      superLikes.push(doc.data() as SuperLike);
    });

    return superLikes;
  } catch (error) {
    logger.error('Error getting super likes:', error);
    return [];
  }
}

export async function markSuperLikeSeen(fromUserId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await setDoc(doc(db, 'superLikes', `${fromUserId}_${user.uid}`), {
      seen: true,
    }, { merge: true });
  } catch (error) {
    logger.error('Error marking super like seen:', error);
  }
}