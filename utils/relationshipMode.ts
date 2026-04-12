import { deleteField, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

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
  startDate?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    const now = new Date().toISOString();
    const relationship: RelationshipStatus = {
      inRelationship: true, partnerId, partnerName,
      startDate: startDate ?? now, anniversary: startDate ?? now,
    };
    await updateDoc(doc(db, 'users', user.uid), { relationshipStatus: relationship, isVisible: false });

    const partnerDoc = await getDoc(doc(db, 'users', partnerId));
    if (partnerDoc.exists() && !partnerDoc.data().relationshipStatus?.inRelationship) {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userName = String(userDoc.data()?.name ?? 'Your match');
      await updateDoc(doc(db, 'users', partnerId), {
        relationshipStatus: {
          inRelationship: true, partnerId: user.uid, partnerName: userName,
          startDate: startDate ?? now, anniversary: startDate ?? now,
        },
        isVisible: false,
      });
    }
    return { success: true };
  } catch (error: unknown) {
    logger.error('[RelationshipMode] enterRelationshipMode error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function exitRelationshipMode(): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { success: false };
    const relationship = userDoc.data().relationshipStatus as RelationshipStatus | undefined;

    await updateDoc(doc(db, 'users', user.uid), { relationshipStatus: deleteField(), isVisible: true });

    if (relationship?.partnerId) {
      try {
        await updateDoc(doc(db, 'users', relationship.partnerId), { relationshipStatus: deleteField(), isVisible: true });
      } catch {
        // Partner may have already exited — safe to ignore
      }
    }
    return { success: true };
  } catch (error: unknown) {
    logger.error('[RelationshipMode] exitRelationshipMode error:', error);
    return { success: false };
  }
}

export async function getRelationshipStatus(): Promise<RelationshipStatus | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return null;
    return (userDoc.data().relationshipStatus as RelationshipStatus) ?? null;
  } catch (error: unknown) {
    logger.error('[RelationshipMode] getRelationshipStatus error:', error);
    return null;
  }
}

export function calculateRelationshipDuration(startDate: string): string {
  const days = Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`;
  const years = Math.floor(months / 12);
  const rem   = months % 12;
  return rem === 0
    ? `${years} year${years !== 1 ? 's' : ''}`
    : `${years} year${years !== 1 ? 's' : ''}, ${rem} month${rem !== 1 ? 's' : ''}`;
}

export function getNextAnniversary(startDate: string): { date: Date; daysUntil: number } {
  const start = new Date(startDate);
  const now   = new Date();
  const next  = new Date(start);
  next.setFullYear(now.getFullYear());
  if (next < now) next.setFullYear(now.getFullYear() + 1);
  return { date: next, daysUntil: Math.ceil((next.getTime() - now.getTime()) / 86400000) };
}