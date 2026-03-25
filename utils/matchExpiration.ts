import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    query,
    where,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';

const MATCH_EXPIRY_DAYS = 30;

export interface ExpiredMatch {
  matchId: string;
  matchName: string;
  matchedAt: string;
  daysRemaining: number;
  isExpired: boolean;
  isWarning: boolean; // Less than 7 days remaining
}

export function getMatchExpiryInfo(
  matchedAt: string,
  hasMessages: boolean
): { daysRemaining: number; isExpired: boolean; isWarning: boolean } {
  // If they have exchanged messages, match never expires
  if (hasMessages) {
    return { daysRemaining: -1, isExpired: false, isWarning: false };
  }

  const matchDate = new Date(matchedAt);
  const now = new Date();
  const daysSinceMatch = Math.floor(
    (now.getTime() - matchDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const daysRemaining = MATCH_EXPIRY_DAYS - daysSinceMatch;

  return {
    daysRemaining: Math.max(0, daysRemaining),
    isExpired: daysRemaining <= 0,
    isWarning: daysRemaining > 0 && daysRemaining <= 7,
  };
}

export async function checkIfChatHasMessages(
  userId: string,
  matchId: string
): Promise<boolean> {
  try {
    const chatId = [userId, matchId].sort().join('_');
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const messagesSnapshot = await getDocs(messagesRef);
    return !messagesSnapshot.empty;
  } catch (error) {
    console.error('Error checking messages:', error);
    return false;
  }
}

export async function removeExpiredMatch(
  userId: string,
  matchId: string
): Promise<void> {
  try {
    // Delete like in both directions
    try {
      await deleteDoc(doc(db, 'likes', `${userId}_${matchId}`));
    } catch (e) {}

    try {
      await deleteDoc(doc(db, 'likes', `${matchId}_${userId}`));
    } catch (e) {}

    console.log('Expired match removed:', matchId);
  } catch (error) {
    console.error('Error removing expired match:', error);
  }
}

export async function cleanupExpiredMatches(userId: string): Promise<number> {
  let removedCount = 0;

  try {
    // Get all matches where user is involved
    const q1 = query(
      collection(db, 'likes'),
      where('fromUserId', '==', userId),
      where('status', '==', 'matched')
    );

    const q2 = query(
      collection(db, 'likes'),
      where('toUserId', '==', userId),
      where('status', '==', 'matched')
    );

    const [snapshot1, snapshot2] = await Promise.all([
      getDocs(q1),
      getDocs(q2),
    ]);

    const allMatches: { matchId: string; matchedAt: string; docId: string }[] = [];

    snapshot1.forEach((docSnap) => {
      const data = docSnap.data();
      allMatches.push({
        matchId: data.toUserId,
        matchedAt: data.matchedAt || data.createdAt,
        docId: docSnap.id,
      });
    });

    snapshot2.forEach((docSnap) => {
      const data = docSnap.data();
      allMatches.push({
        matchId: data.fromUserId,
        matchedAt: data.matchedAt || data.createdAt,
        docId: docSnap.id,
      });
    });

    // Check each match
    for (const match of allMatches) {
      const hasMessages = await checkIfChatHasMessages(userId, match.matchId);
      const expiryInfo = getMatchExpiryInfo(match.matchedAt, hasMessages);

      if (expiryInfo.isExpired) {
        await removeExpiredMatch(userId, match.matchId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`Cleaned up ${removedCount} expired matches`);
    }

  } catch (error) {
    console.error('Error cleaning up expired matches:', error);
  }

  return removedCount;
}

export function formatExpiryWarning(daysRemaining: number): string {
  if (daysRemaining <= 0) return 'Match expired';
  if (daysRemaining === 1) return '⚠️ Expires tomorrow! Send a message';
  if (daysRemaining <= 3) return `⚠️ Expires in ${daysRemaining} days!`;
  if (daysRemaining <= 7) return `Expires in ${daysRemaining} days`;
  return `${daysRemaining} days remaining`;
}