import { arrayRemove, arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface PinnedMessage { messageId: string; text: string; pinnedBy: string; pinnedAt: string; }

export async function pinMessage(chatId: string, messageId: string, messageText: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    const pinned: PinnedMessage = { messageId, text: messageText.substring(0, 100), pinnedBy: user.uid, pinnedAt: new Date().toISOString() };
    await updateDoc(doc(db, 'chats', chatId), { pinnedMessages: arrayUnion(pinned) });
    return { success: true };
  } catch (error: unknown) {
    logger.error('Error pinning message:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function unpinMessage(chatId: string, messageId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const chatRef = doc(db, 'chats', chatId);
    const chatDoc = await getDoc(chatRef);
    if (!chatDoc.exists()) return { success: false, error: 'Chat not found' };
    const toUnpin = (chatDoc.data().pinnedMessages as PinnedMessage[] ?? []).find(m => m.messageId === messageId);
    if (toUnpin) await updateDoc(chatRef, { pinnedMessages: arrayRemove(toUnpin) });
    return { success: true };
  } catch (error: unknown) {
    logger.error('Error unpinning message:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getPinnedMessages(chatId: string): Promise<PinnedMessage[]> {
  try {
    const chatDoc = await getDoc(doc(db, 'chats', chatId));
    if (!chatDoc.exists()) return [];
    return (chatDoc.data().pinnedMessages as PinnedMessage[]) ?? [];
  } catch (error: unknown) { logger.error('Error getting pinned messages:', error); return []; }
}
