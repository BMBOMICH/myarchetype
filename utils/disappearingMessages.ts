import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export type DisappearingMode = 'off' | '24h' | '7d' | '30d';

export interface DisappearingSettings {
  mode: DisappearingMode;
  enabledAt: string;
  enabledBy: string;
}

export async function setDisappearingMode(
  chatId: string,
  mode: DisappearingMode
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  try {
    const chatRef = doc(db, 'chats', chatId);
    
    await updateDoc(chatRef, {
      disappearingMessages: {
        mode,
        enabledAt: new Date().toISOString(),
        enabledBy: user.uid,
      }
    });

    return { success: true };
  } catch (error: any) {
    console.error('Error setting disappearing mode:', error);
    return { success: false, error: error.message };
  }
}

export async function getDisappearingSettings(chatId: string): Promise<DisappearingSettings | null> {
  try {
    const chatRef = doc(db, 'chats', chatId);
    const chatDoc = await getDoc(chatRef);
    
    if (!chatDoc.exists()) return null;
    
    return chatDoc.data().disappearingMessages || null;
  } catch (error) {
    console.error('Error getting disappearing settings:', error);
    return null;
  }
}

export async function cleanupExpiredMessages(chatId: string): Promise<number> {
  try {
    const settings = await getDisappearingSettings(chatId);
    if (!settings || settings.mode === 'off') return 0;

    const now = new Date();
    let expiryMs: number;
    
    switch (settings.mode) {
      case '24h':
        expiryMs = 24 * 60 * 60 * 1000;
        break;
      case '7d':
        expiryMs = 7 * 24 * 60 * 60 * 1000;
        break;
      case '30d':
        expiryMs = 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        return 0;
    }

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const messagesSnapshot = await getDocs(messagesRef);
    
    let deletedCount = 0;

    for (const msgDoc of messagesSnapshot.docs) {
      const data = msgDoc.data();
      const timestamp = data.timestamp?.toDate?.() || new Date(data.timestamp);
      const messageAge = now.getTime() - timestamp.getTime();

      if (messageAge > expiryMs) {
        await deleteDoc(doc(db, 'chats', chatId, 'messages', msgDoc.id));
        deletedCount++;
      }
    }

    return deletedCount;
  } catch (error) {
    console.error('Error cleaning up messages:', error);
    return 0;
  }
}

export function getDisappearingLabel(mode: DisappearingMode): string {
  switch (mode) {
    case '24h': return '24 hours';
    case '7d': return '7 days';
    case '30d': return '30 days';
    default: return 'Off';
  }
}