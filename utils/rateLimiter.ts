import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn?: number;
}

const LIMITS = {
  like: { count: 100, period: 86400000 }, // 100 per day
  message: { count: 500, period: 86400000 }, // 500 per day
  report: { count: 10, period: 86400000 }, // 10 per day
};

export async function checkRateLimit(action: 'like' | 'message' | 'report'): Promise<RateLimitResult> {
  const user = auth.currentUser;
  if (!user) {
    return { allowed: false, remaining: 0 };
  }

  const limit = LIMITS[action];
  const rateLimitRef = doc(db, 'rateLimits', `${user.uid}_${action}`);

  try {
    const docSnap = await getDoc(rateLimitRef);
    const now = Date.now();

    if (!docSnap.exists()) {
      // First action
      await setDoc(rateLimitRef, {
        count: 1,
        firstAction: now,
        lastAction: now,
      });
      return { allowed: true, remaining: limit.count - 1 };
    }

    const data = docSnap.data();
    const timeSinceFirst = now - data.firstAction;

    if (timeSinceFirst > limit.period) {
      // Reset period
      await setDoc(rateLimitRef, {
        count: 1,
        firstAction: now,
        lastAction: now,
      });
      return { allowed: true, remaining: limit.count - 1 };
    }

    if (data.count >= limit.count) {
      // Rate limit exceeded
      return {
        allowed: false,
        remaining: 0,
        resetIn: limit.period - timeSinceFirst,
      };
    }

    // Increment count
    await updateDoc(rateLimitRef, {
      count: data.count + 1,
      lastAction: now,
    });

    return {
      allowed: true,
      remaining: limit.count - data.count - 1,
    };
  } catch (error) {
    console.error('Rate limit check error:', error);
    return { allowed: true, remaining: 0 }; // Fail open (allow on error)
  }
}

export function formatResetTime(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}