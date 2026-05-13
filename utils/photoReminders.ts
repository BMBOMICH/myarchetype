import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

const PHOTO_FRESHNESS_DAYS = 180; // 6 months
const REMINDER_COOLDOWN_DAYS = 30; // Don't remind more than once per month

export interface PhotoFreshnessResult {
  shouldRemind: boolean;
  oldestPhotoDays: number;
  message: string;
}

export async function checkPhotoFreshness(): Promise<PhotoFreshnessResult> {
  const user = auth.currentUser;
  if (!user) {
    return { shouldRemind: false, oldestPhotoDays: 0, message: '' };
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) {
      return { shouldRemind: false, oldestPhotoDays: 0, message: '' };
    }

    const data = userDoc.data();
    const profileCreatedAt = data.createdAt;
    const lastPhotoUpdate = data.lastPhotoUpdate || profileCreatedAt;
    const lastPhotoReminder = data.lastPhotoReminder;

    if (!lastPhotoUpdate) {
      return { shouldRemind: false, oldestPhotoDays: 0, message: '' };
    }

    const photoDate = new Date(lastPhotoUpdate);
    const now = new Date();
    const daysSinceUpdate = Math.floor(
      (now.getTime() - photoDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (lastPhotoReminder) {
      const reminderDate = new Date(lastPhotoReminder);
      const daysSinceReminder = Math.floor(
        (now.getTime() - reminderDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceReminder < REMINDER_COOLDOWN_DAYS) {
        return { shouldRemind: false, oldestPhotoDays: daysSinceUpdate, message: '' };
      }
    }

    if (daysSinceUpdate >= PHOTO_FRESHNESS_DAYS) {
      const months = Math.floor(daysSinceUpdate / 30);
      return {
        shouldRemind: true,
        oldestPhotoDays: daysSinceUpdate,
        message: `Your photos are ${months} month${months !== 1 ? 's' : ''} old. Update them to get more matches!`,
      };
    }

    return { shouldRemind: false, oldestPhotoDays: daysSinceUpdate, message: '' };
  } catch (error) {
    logger.error('Error checking photo freshness:', error);
    return { shouldRemind: false, oldestPhotoDays: 0, message: '' };
  }
}

export async function dismissPhotoReminder(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      lastPhotoReminder: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error dismissing photo reminder:', error);
  }
}

export async function markPhotosUpdated(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      lastPhotoUpdate: new Date().toISOString(),
      lastPhotoReminder: null,
    });
  } catch (error) {
    logger.error('Error marking photos updated:', error);
  }
}
