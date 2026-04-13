import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface StreakData { currentStreak: number; longestStreak: number; lastLoginDate: string | null; }

export async function updateLoginStreak(): Promise<StreakData> {
  const user = auth.currentUser;
  if (!user) return { currentStreak: 0, longestStreak: 0, lastLoginDate: null };
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { currentStreak: 0, longestStreak: 0, lastLoginDate: null };
    const data = userDoc.data();
    const lastLoginDate: string | null = data.lastLoginDate ?? null;
    const currentStreak: number = data.loginStreak ?? 0;
    const longestStreak: number = data.longestStreak ?? 0;
    const todayStr = new Date().toISOString().split('T')[0]!;
    if (lastLoginDate === todayStr) return { currentStreak, longestStreak, lastLoginDate };
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0]!;
    const newStreak = lastLoginDate === yesterdayStr ? currentStreak + 1 : 1;
    const newLongest = Math.max(longestStreak, newStreak);
    await updateDoc(doc(db, 'users', user.uid), { lastLoginDate: todayStr, loginStreak: newStreak, longestStreak: newLongest });
    return { currentStreak: newStreak, longestStreak: newLongest, lastLoginDate: todayStr };
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'permission-denied') return { currentStreak: 0, longestStreak: 0, lastLoginDate: null };
    logger.error('Error updating login streak:', error);
    return { currentStreak: 0, longestStreak: 0, lastLoginDate: null };
  }
}

export function formatStreakMessage(streak: number): string {
  if (streak === 0) return '';
  if (streak === 1) return '1 day';
  if (streak < 7) return `${streak} days 🔥`;
  if (streak < 30) return `${streak} days 🔥🔥`;
  if (streak < 100) return `${streak} days 🔥🔥🔥`;
  return `${streak} days 🏆`;
}