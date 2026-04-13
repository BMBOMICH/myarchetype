import { arrayRemove, arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export const REACTION_EMOJIS = ['❤️', '👍', '😂', '🔥', '😢', '😮'];

export interface Reaction { emoji: string; userId: string; timestamp: string; }

export async function addReaction(chatId: string, messageId: string, emoji: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
    const messageDoc = await getDoc(messageRef);
    if (!messageDoc.exists()) return { success: false, error: 'Message not found' };
    const currentReactions: Reaction[] = messageDoc.data().reactions ?? [];
    const existing = currentReactions.find(r => r.userId === user.uid && r.emoji === emoji);
    if (existing) {
      await updateDoc(messageRef, { reactions: arrayRemove(existing) });
    } else {
      const userReaction = currentReactions.find(r => r.userId === user.uid);
      if (userReaction) await updateDoc(messageRef, { reactions: arrayRemove(userReaction) });
      await updateDoc(messageRef, { reactions: arrayUnion({ emoji, userId: user.uid, timestamp: new Date().toISOString() } satisfies Reaction) });
    }
    return { success: true };
  } catch (error: unknown) {
    logger.error('Error adding reaction:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function groupReactions(reactions: Reaction[]): { emoji: string; count: number; userIds: string[] }[] {
  const groups: Record<string, { count: number; userIds: string[] }> = {};
  for (const r of reactions) {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, userIds: [] };
    groups[r.emoji]!.count++;
    groups[r.emoji]!.userIds.push(r.userId);
  }
  return Object.entries(groups).map(([emoji, data]) => ({ emoji, count: data.count, userIds: data.userIds }));
}

export function hasUserReacted(reactions: Reaction[], userId: string, emoji?: string): boolean {
  return emoji ? reactions.some(r => r.userId === userId && r.emoji === emoji) : reactions.some(r => r.userId === userId);
}