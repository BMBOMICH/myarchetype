/**
 * utils/matchNotes.ts
 *
 * Detectors covered:
 * #68 Match notes — content moderation
 */

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { checkMatchNotes } from './moderation';
import { logger } from './logger';

export interface MatchNote {
  matchId: string;
  note: string;
  lastUpdated: string;
}

export async function getMatchNote(matchId: string): Promise<string> {
  const user = auth.currentUser;
  if (!user || !matchId) return '';

  try {
    const noteDoc = await getDoc(
      doc(db, 'matchNotes', `${user.uid}_${matchId}`)
    );
    return noteDoc.exists() ? (noteDoc.data().note ?? '') : '';
  } catch (error) {
    logger.error('[matchNotes] getMatchNote error:', error);
    return '';
  }
}

export async function saveMatchNote(
  matchId: string,
  note: string
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user || !matchId) return { success: false, error: 'Not authenticated' };

  if (note.trim().length > 0) {
    const moderation = checkMatchNotes(note);
    if (!moderation.safe) {
      return { success: false, error: moderation.reason };
    }
  }

  if (note.length > 500) {
    return {
      success: false,
      error: 'Note must be under 500 characters.',
    };
  }

  try {
    await setDoc(
      doc(db, 'matchNotes', `${user.uid}_${matchId}`),
      {
        userId: user.uid,
        matchId,
        note: note.trim(),
        lastUpdated: serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true };
  } catch (error) {
    logger.error('[matchNotes] saveMatchNote error:', error);
    return { success: false, error: 'Failed to save note' };
  }
}

export async function deleteMatchNote(matchId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !matchId) return false;

  try {
    await setDoc(
      doc(db, 'matchNotes', `${user.uid}_${matchId}`),
      { note: '', lastUpdated: serverTimestamp() },
      { merge: true }
    );
    return true;
  } catch (error) {
    logger.error('[matchNotes] deleteMatchNote error:', error);
    return false;
  }
}

export async function getAllMatchNotes(): Promise<Map<string, string>> {
  const user = auth.currentUser;
  if (!user) return new Map();

  try {
    return new Map();
  } catch (error) {
    logger.error('[matchNotes] getAllMatchNotes error:', error);
    return new Map();
  }
}
