import { arrayRemove, arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface PinnedMessage {
  messageId: string;
  text: string;
  pinnedBy: string;
  pinnedAt: string;
}

export async function pinMessage(
  chatId: string,
  messageId: string,
  messageText: string
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  try {
    const chatRef = doc(db, 'chats', chatId);
    
    const pinnedMessage: PinnedMessage = {
      messageId,
      text: messageText.substring(0, 100), // Limit to 100 chars
      pinnedBy: user.uid,
      pinnedAt: new Date().toISOString(),
    };

    await updateDoc(chatRef, {
      pinnedMessages: arrayUnion(pinnedMessage)
    });

    return { success: true };
  } catch (error: any) {
    console.error('Error pinning message:', error);
    return { success: false, error: error.message };
  }
}

export async function unpinMessage(
  chatId: string,
  messageId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const chatRef = doc(db, 'chats', chatId);
    const chatDoc = await getDoc(chatRef);
    
    if (!chatDoc.exists()) {
      return { success: false, error: 'Chat not found' };
    }

    const pinnedMessages = chatDoc.data().pinnedMessages || [];
    const messageToUnpin = pinnedMessages.find((m: PinnedMessage) => m.messageId === messageId);

    if (messageToUnpin) {
      await updateDoc(chatRef, {
        pinnedMessages: arrayRemove(messageToUnpin)
      });
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error unpinning message:', error);
    return { success: false, error: error.message };
  }
}

export async function getPinnedMessages(chatId: string): Promise<PinnedMessage[]> {
  try {
    const chatRef = doc(db, 'chats', chatId);
    const chatDoc = await getDoc(chatRef);
    
    if (!chatDoc.exists()) return [];
    
    return chatDoc.data().pinnedMessages || [];
  } catch (error) {
    console.error('Error getting pinned messages:', error);
    return [];
  }
}