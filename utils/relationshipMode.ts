import { deleteField, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface RelationshipStatus {
  inRelationship: boolean;
  partnerId?: string;
  partnerName?: string;
  startDate?: string;
  anniversary?: string;
}

export async function enterRelationshipMode(
  partnerId: string,
  partnerName: string,
  startDate?: string
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  try {
    const now = new Date().toISOString();
    const relationship: RelationshipStatus = {
      inRelationship: true,
      partnerId,
      partnerName,
      startDate: startDate || now,
      anniversary: startDate || now,
    };

    // Update current user
    await updateDoc(doc(db, 'users', user.uid), {
      relationshipStatus: relationship,
      isVisible: false, // Hide from discovery
    });

    // Update partner (if they haven't already)
    const partnerDoc = await getDoc(doc(db, 'users', partnerId));
    if (partnerDoc.exists()) {
      const partnerData = partnerDoc.data();
      if (!partnerData.relationshipStatus?.inRelationship) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const userName = userDoc.data()?.name || 'Your match';

        await updateDoc(doc(db, 'users', partnerId), {
          relationshipStatus: {
            inRelationship: true,
            partnerId: user.uid,
            partnerName: userName,
            startDate: startDate || now,
            anniversary: startDate || now,
          },
          isVisible: false,
        });
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error entering relationship mode:', error);
    return { success: false, error: error.message };
  }
}

export async function exitRelationshipMode(): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    // Get current relationship info
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { success: false };

    const relationship = userDoc.data().relationshipStatus as RelationshipStatus;

    // Update current user
    await updateDoc(doc(db, 'users', user.uid), {
      relationshipStatus: deleteField(),
      isVisible: true, // Show in discovery again
    });

    // Optionally update partner too
    if (relationship?.partnerId) {
      try {
        await updateDoc(doc(db, 'users', relationship.partnerId), {
          relationshipStatus: deleteField(),
          isVisible: true,
        });
      } catch (e) {
        // Partner may have already exited
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error exiting relationship mode:', error);
    return { success: false };
  }
}

export async function getRelationshipStatus(): Promise<RelationshipStatus | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return null;

    return userDoc.data().relationshipStatus || null;
  } catch (error) {
    console.error('Error getting relationship status:', error);
    return null;
  }
}

export function calculateRelationshipDuration(startDate: string): string {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (days < 30) {
    return `${days} day${days !== 1 ? 's' : ''}`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} month${months !== 1 ? 's' : ''}`;
  }

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  
  if (remainingMonths === 0) {
    return `${years} year${years !== 1 ? 's' : ''}`;
  }
  
  return `${years} year${years !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
}

export function getNextAnniversary(startDate: string): { date: Date; daysUntil: number } {
  const start = new Date(startDate);
  const now = new Date();
  
  let nextAnniversary = new Date(start);
  nextAnniversary.setFullYear(now.getFullYear());
  
  if (nextAnniversary < now) {
    nextAnniversary.setFullYear(now.getFullYear() + 1);
  }

  const daysUntil = Math.ceil((nextAnniversary.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return { date: nextAnniversary, daysUntil };
}