import { doc, getDoc, increment, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface PhotoStats {
  photoUrl: string;
  impressions: number;
  rightSwipes: number;
  leftSwipes: number;
  superLikes: number;
  score: number; // Calculated score for ranking
}

export interface SmartPhotoData {
  photoStats: PhotoStats[];
  lastReordered: string | null;
  autoReorderEnabled: boolean;
}

export async function recordPhotoImpression(
  userId: string,
  photoIndex: number,
  action: 'view' | 'swipe_right' | 'swipe_left' | 'super_like'
): Promise<void> {
  try {
    const statsRef = doc(db, 'photoStats', `${userId}_${photoIndex}`);
    const statsDoc = await getDoc(statsRef);

    if (!statsDoc.exists()) {
      await setDoc(statsRef, {
        userId,
        photoIndex,
        impressions: action === 'view' ? 1 : 0,
        rightSwipes: action === 'swipe_right' ? 1 : 0,
        leftSwipes: action === 'swipe_left' ? 1 : 0,
        superLikes: action === 'super_like' ? 1 : 0,
        createdAt: new Date().toISOString(),
      });
    } else {
      const updateData: any = {};
      if (action === 'view') updateData.impressions = increment(1);
      if (action === 'swipe_right') updateData.rightSwipes = increment(1);
      if (action === 'swipe_left') updateData.leftSwipes = increment(1);
      if (action === 'super_like') updateData.superLikes = increment(1);

      await updateDoc(statsRef, updateData);
    }
  } catch (error) {
    console.error('Error recording photo impression:', error);
  }
}

export async function getPhotoStats(userId: string): Promise<PhotoStats[]> {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) return [];

    const photos = userDoc.data().photos || [];
    const stats: PhotoStats[] = [];

    for (let i = 0; i < photos.length; i++) {
      const statsDoc = await getDoc(doc(db, 'photoStats', `${userId}_${i}`));
      
      if (statsDoc.exists()) {
        const data = statsDoc.data();
        const impressions = data.impressions || 1;
        const rightSwipes = data.rightSwipes || 0;
        const superLikes = data.superLikes || 0;
        
        // Score formula: (rightSwipes + superLikes*2) / impressions * 100
        const score = ((rightSwipes + superLikes * 2) / impressions) * 100;

        stats.push({
          photoUrl: photos[i],
          impressions,
          rightSwipes,
          leftSwipes: data.leftSwipes || 0,
          superLikes,
          score: Math.round(score * 10) / 10,
        });
      } else {
        stats.push({
          photoUrl: photos[i],
          impressions: 0,
          rightSwipes: 0,
          leftSwipes: 0,
          superLikes: 0,
          score: 0,
        });
      }
    }

    return stats;
  } catch (error) {
    console.error('Error getting photo stats:', error);
    return [];
  }
}

export async function getOptimalPhotoOrder(userId: string): Promise<string[]> {
  const stats = await getPhotoStats(userId);
  
  // Sort by score descending
  const sorted = [...stats].sort((a, b) => b.score - a.score);
  
  return sorted.map(s => s.photoUrl);
}

export async function autoReorderPhotos(): Promise<{ success: boolean; reordered: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false, reordered: false };

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { success: false, reordered: false };

    const userData = userDoc.data();
    const autoReorder = userData.smartPhotosEnabled || false;

    if (!autoReorder) return { success: true, reordered: false };

    const currentPhotos = userData.photos || [];
    if (currentPhotos.length < 2) return { success: true, reordered: false };

    const optimalOrder = await getOptimalPhotoOrder(user.uid);

    // Check if order changed
    const orderChanged = currentPhotos.some((photo: string, i: number) => photo !== optimalOrder[i]);

    if (orderChanged) {
      await updateDoc(doc(db, 'users', user.uid), {
        photos: optimalOrder,
        lastSmartPhotoReorder: new Date().toISOString(),
      });
      return { success: true, reordered: true };
    }

    return { success: true, reordered: false };
  } catch (error) {
    console.error('Error auto-reordering photos:', error);
    return { success: false, reordered: false };
  }
}

export async function toggleSmartPhotos(enabled: boolean): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      smartPhotosEnabled: enabled,
    });
    return { success: true };
  } catch (error) {
    console.error('Error toggling smart photos:', error);
    return { success: false };
  }
}

export function getPhotoPerformanceLabel(score: number): { label: string; color: string } {
  if (score >= 50) return { label: '🔥 Hot', color: '#e74c3c' };
  if (score >= 30) return { label: '👍 Good', color: '#5cb85c' };
  if (score >= 15) return { label: '👌 OK', color: '#f1c40f' };
  if (score > 0) return { label: '😐 Low', color: '#e67e22' };
  return { label: '📊 No data', color: '#888' };
}