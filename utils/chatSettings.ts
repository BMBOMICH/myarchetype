import { doc, getDoc, setDoc } from 'firebase/firestore';
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
];

export async function getChatSettings(chatId: string): Promise<ChatSettings> {
  const user = auth.currentUser;
  if (!user) return DEFAULT_SETTINGS;

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

  try {
    const settingsRef = doc(db, 'chatSettings', `${user.uid}_${chatId}`);
    
    await setDoc(settingsRef, {
      ...settings,
      userId: user.uid,
      chatId,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return { success: true };
  } catch (error: any) {
    console.error('Error updating chat settings:', error);
    return { success: false, error: error.message };
  }
}

export async function setWallpaper(
  chatId: string,
  wallpaperId: string
): Promise<{ success: boolean }> {
  return updateChatSettings(chatId, { wallpaper: wallpaperId });
}

export async function toggleReadReceipts(
  chatId: string,
  enabled: boolean
): Promise<{ success: boolean }> {
  return updateChatSettings(chatId, { readReceiptsEnabled: enabled });
}

export function getWallpaperStyle(wallpaperId: string | null): { backgroundColor?: string } {
  if (!wallpaperId || wallpaperId === 'none') {
    return { backgroundColor: '#1a1a2e' };
  }

  const wallpaper = CHAT_WALLPAPERS.find(w => w.id === wallpaperId);
  if (wallpaper && 'color' in wallpaper) {
    return { backgroundColor: wallpaper.color };
  }

  // For gradients, return the first color (React Native doesn't support gradients natively)
  if (wallpaper && 'gradient' in wallpaper) {
    return { backgroundColor: wallpaper.gradient[0] };
  }

  return { backgroundColor: '#1a1a2e' };
}