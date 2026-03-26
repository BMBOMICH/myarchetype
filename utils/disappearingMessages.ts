import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export type DisappearingMode = 'off' | '24h' | '7d' | '30d';

export interface DisappearingSettings {
  mode: DisappearingMode;
  enabledAt: string | null;
  enabledBy: string;
}

export async function setDisappearingMode(
  chatId: string,
  mode: DisappearingMode
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (!chatId) return { success: false, error: 'Missing chat ID' };

  try {
    const chatRef = doc(db, 'chats', chatId);

    await setDoc(
      chatRef,
      {
        disappearingMessages: {
          mode,
          enabledAt: new Date().toISOString(),
          enabledBy: user.uid,
        },
        ...(mode === 'off'
          ? {}
          : {
              lastMessageAt: serverTimestamp(),
            }),
      },
      { merge: true }
    );

    return { success: true };
  } catch (error: any) {
    console.error('Error setting disappearing mode:', error);
    return { success: false, error: error?.message ?? 'Unknown error' };
  }
}

export async function getDisappearingSettings(
  chatId: string
): Promise<DisappearingSettings | null> {
  if (!chatId) return null;

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
  if (!chatId) return 0;

  try {
    const settings = await getDisappearingSettings(chatId);
    if (!settings || settings.mode === 'off') return 0;

    const now = Date.now();
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

    const expiredMessageIds: string[] = [];

    for (const msgDoc of messagesSnapshot.docs) {
      const data = msgDoc.data();
      const timestamp =
        typeof data.timestamp?.toDate === 'function'
          ? data.timestamp.toDate()
          : data.timestamp
          ? new Date(data.timestamp)
          : null;

      if (!timestamp || Number.isNaN(timestamp.getTime())) continue;

      const messageAge = now - timestamp.getTime();

      if (messageAge > expiryMs) {
        expiredMessageIds.push(msgDoc.id);
      }
    }

    if (expiredMessageIds.length === 0) return 0;

    let deletedCount = 0;
    for (let i = 0; i < expiredMessageIds.length; i += 450) {
      const batch = writeBatch(db);
      const chunk = expiredMessageIds.slice(i, i + 450);

      chunk.forEach((messageId) => {
        batch.delete(doc(db, 'chats', chatId, 'messages', messageId));
      });

      await batch.commit();
      deletedCount += chunk.length;
    }

    return deletedCount;
  } catch (error) {
    console.error('Error cleaning up messages:', error);
    return 0;
  }
}

export function getDisappearingLabel(mode: DisappearingMode): string {
  switch (mode) {
    case '24h':
      return '24 hours';
    case '7d':
      return '7 days';
    case '30d':
      return '30 days';
    default:
      return 'Off';
  }
}