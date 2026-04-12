import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string | null;
}

export async function updateLoginStreak(): Promise<StreakData> {
  const user = auth.currentUser;
  if (!user) {
    return { currentStreak: 0, longestStreak: 0, lastLoginDate: null };
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) {
      return { currentStreak: 0, longestStreak: 0, lastLoginDate: null };
    }

    const data = userDoc.data();
    const lastLoginDate = data.lastLoginDate;
    const currentStreak = data.loginStreak || 0;
    const longestStreak = data.longestStreak || 0;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // If already logged in today, don't update
    if (lastLoginDate === todayStr) {
      return { currentStreak, longestStreak, lastLoginDate };
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let newStreak = 1;
    if (lastLoginDate === yesterdayStr) {
      newStreak = currentStreak + 1;
    } else if (lastLoginDate) {
      newStreak = 1;
    }

    const newLongestStreak = Math.max(longestStreak, newStreak);

    await updateDoc(doc(db, 'users', user.uid), {
      lastLoginDate: todayStr,
      loginStreak: newStreak,
      longestStreak: newLongestStreak,
    });

    return {
      currentStreak: newStreak,
      longestStreak: newLongestStreak,
      lastLoginDate: todayStr,
    };

  } catch (error: any) {
    // ✅ Silently ignore permission errors during auth restore
    if (error?.code === 'permission-denied') {
      return { currentStreak: 0, longestStreak: 0, lastLoginDate: null };
    }
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