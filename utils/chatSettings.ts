import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface ChatSettings {
  wallpaper: string | null;
  readReceiptsEnabled: boolean;
  typingIndicatorsEnabled: boolean;
  notificationsEnabled: boolean;
}

const DEFAULT_SETTINGS: ChatSettings = {
  wallpaper: null,
  readReceiptsEnabled: true,
  typingIndicatorsEnabled: true,
  notificationsEnabled: true,
};

export const CHAT_WALLPAPERS = [
  { id: 'none', name: 'None (Dark)', color: '#1a1a2e' },
  { id: 'gradient1', name: 'Purple Gradient', gradient: ['#1a1a2e', '#2d1b4e'] },
  { id: 'gradient2', name: 'Ocean Blue', gradient: ['#0f3460', '#16213e'] },
  { id: 'gradient3', name: 'Forest Green', gradient: ['#1a3c34', '#0f2922'] },
  { id: 'gradient4', name: 'Sunset', gradient: ['#2d1f3d', '#1a1a2e'] },
  { id: 'gradient5', name: 'Midnight', gradient: ['#0a0a1a', '#1a1a2e'] },
] as const;

export async function getChatSettings(chatId: string): Promise<ChatSettings> {
  const user = auth.currentUser;
  if (!user || !chatId) return DEFAULT_SETTINGS;

  try {
    const settingsRef = doc(db, 'chatSettings', `${user.uid}_${chatId}`);
    const settingsDoc = await getDoc(settingsRef);

    if (!settingsDoc.exists()) return DEFAULT_SETTINGS;

    return { ...DEFAULT_SETTINGS, ...settingsDoc.data() };
  } catch (error) {
    console.error('Error getting chat settings:', error);
    return DEFAULT_SETTINGS;
  }
}

export async function updateChatSettings(
  chatId: string,
  settings: Partial<ChatSettings>
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (!chatId) return { success: false, error: 'Missing chat ID' };

  try {
    const settingsRef = doc(db, 'chatSettings', `${user.uid}_${chatId}`);

    await setDoc(
      settingsRef,
      {
        ...settings,
        userId: user.uid,
        chatId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true };
  } catch (error: any) {
    console.error('Error updating chat settings:', error);
    return { success: false, error: error?.message ?? 'Unknown error' };
  }
}

export async function setWallpaper(
  chatId: string,
  wallpaperId: string
): Promise<{ success: boolean; error?: string }> {
  return updateChatSettings(chatId, { wallpaper: wallpaperId });
}

export async function toggleReadReceipts(
  chatId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return updateChatSettings(chatId, { readReceiptsEnabled: enabled });
}

export function getWallpaperStyle(
  wallpaperId: string | null
): { backgroundColor?: string } {
  if (!wallpaperId || wallpaperId === 'none') {
    return { backgroundColor: '#1a1a2e' };
  }

  const wallpaper = CHAT_WALLPAPERS.find((w) => w.id === wallpaperId);

  if (!wallpaper) {
    return { backgroundColor: '#1a1a2e' };
  }

  if ('color' in wallpaper) {
    return { backgroundColor: wallpaper.color };
  }

  if (
    'gradient' in wallpaper &&
    Array.isArray(wallpaper.gradient) &&
    wallpaper.gradient.length > 0
  ) {
    return { backgroundColor: wallpaper.gradient[0] };
  }

  return { backgroundColor: '#1a1a2e' };
}