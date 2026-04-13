import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export type DisappearingMode = 'off' | '24h' | '7d' | '30d';

export interface DisappearingSettings { mode: DisappearingMode; enabledAt: string | null; enabledBy: string; }

export async function setDisappearingMode(chatId: string, mode: DisappearingMode): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (!chatId) return { success: false, error: 'Missing chat ID' };
  try {
    await setDoc(doc(db, 'chats', chatId), {
      disappearingMessages: { mode, enabledAt: new Date().toISOString(), enabledBy: user.uid },
      ...(mode === 'off' ? {} : { lastMessageAt: serverTimestamp() }),
    }, { merge: true });
    return { success: true };
  } catch (error: unknown) {
    logger.error('Error setting disappearing mode:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getDisappearingSettings(chatId: string): Promise<DisappearingSettings | null> {
  if (!chatId) return null;
  try {
    const chatDoc = await getDoc(doc(db, 'chats', chatId));
    if (!chatDoc.exists()) return null;
    return (chatDoc.data().disappearingMessages as DisappearingSettings) || null;
  } catch (error: unknown) { logger.error('Error getting disappearing settings:', error); return null; }
}

export async function cleanupExpiredMessages(chatId: string): Promise<number> {
  if (!chatId) return 0;
  try {
    const settings = await getDisappearingSettings(chatId);
    if (!settings || settings.mode === 'off') return 0;
    const expiryMap: Record<string, number> = { '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 };
    const expiryMs = expiryMap[settings.mode];
    if (!expiryMs) return 0;
    const now = Date.now();
    const snap = await getDocs(collection(db, 'chats', chatId, 'messages'));
    const expired: string[] = [];
    for (const msgDoc of snap.docs) {
      const data = msgDoc.data();
      const ts: Date | null = typeof data.timestamp?.toDate === 'function' ? data.timestamp.toDate() : data.timestamp ? new Date(data.timestamp as string) : null;
      if (ts && !Number.isNaN(ts.getTime()) && now - ts.getTime() > expiryMs) expired.push(msgDoc.id);
    }
    if (!expired.length) return 0;
    let deleted = 0;
    for (let i = 0; i < expired.length; i += 450) {
      const batch = writeBatch(db);
      expired.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'chats', chatId, 'messages', id)));
      await batch.commit();
      deleted += Math.min(450, expired.length - i);
    }
    return deleted;
  } catch (error: unknown) { logger.error('Error cleaning up messages:', error); return 0; }
}

export function getDisappearingLabel(mode: DisappearingMode): string {
  const labels: Record<DisappearingMode, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', off: 'Off' };
  return labels[mode];
}