import { arrayRemove, arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export const REACTION_EMOJIS = ['❤️', '👍', '😂', '🔥', '😢', '😮'];

export interface Reaction {
  emoji: string;
  userId: string;
  timestamp: string;
}

export async function addReaction(
  chatId: string,
  messageId: string,
  emoji: string
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  try {
    const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
    const messageDoc = await getDoc(messageRef);
    
    if (!messageDoc.exists()) {
      return { success: false, error: 'Message not found' };
    }

    const currentReactions = messageDoc.data().reactions || [];
    
    // Check if user already reacted with this emoji
    const existingReaction = currentReactions.find(
      (r: Reaction) => r.userId === user.uid && r.emoji === emoji
    );

    if (existingReaction) {
      // Remove the reaction
      await updateDoc(messageRef, {
        reactions: arrayRemove(existingReaction)
      });
    } else {
      // Remove any existing reaction from this user first
      const userReaction = currentReactions.find((r: Reaction) => r.userId === user.uid);
      if (userReaction) {
        await updateDoc(messageRef, {
          reactions: arrayRemove(userReaction)
        });
      }
      
      // Add new reaction
      const newReaction: Reaction = {
        emoji,
        userId: user.uid,
        timestamp: new Date().toISOString(),
      };
      
      await updateDoc(messageRef, {
        reactions: arrayUnion(newReaction)
      });
    }

    return { success: true };
  } catch (error: any) {
    logger.error('Error adding reaction:', error);
    return { success: false, error: error.message };
  }
}

export function groupReactions(reactions: Reaction[]): { emoji: string; count: number; userIds: string[] }[] {
  const groups: { [key: string]: { count: number; userIds: string[] } } = {};
  
  reactions.forEach((r) => {
    if (!groups[r.emoji]) {
      groups[r.emoji] = { count: 0, userIds: [] };
    }
    groups[r.emoji].count++;
    groups[r.emoji].userIds.push(r.userId);
  });

  return Object.entries(groups).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    userIds: data.userIds,
  }));
}

export function hasUserReacted(reactions: Reaction[], userId: string, emoji?: string): boolean {
  if (emoji) {
    return reactions.some((r) => r.userId === userId && r.emoji === emoji);
  }
  return reactions.some((r) => r.userId === userId);
}