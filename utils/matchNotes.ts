import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface MatchNote {
  matchId: string;
  note: string;
  lastUpdated: string;
}

export async function getMatchNote(matchId: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) return '';

  try {
    const noteDoc = await getDoc(doc(db, 'matchNotes', `${user.uid}_${matchId}`));
    
    if (noteDoc.exists()) {
      return noteDoc.data().note || '';
    }
    
    return '';
  } catch (error) {
    console.error('Error getting match note:', error);
    return '';
  }
}

export async function saveMatchNote(matchId: string, note: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    await setDoc(doc(db, 'matchNotes', `${user.uid}_${matchId}`), {
      userId: user.uid,
      matchId: matchId,
      note: note,
      lastUpdated: new Date().toISOString(),
    });

    return true;
  } catch (error) {
    console.error('Error saving match note:', error);
    return false;
  }
}

export async function getAllMatchNotes(): Promise<Map<string, string>> {
  const user = auth.currentUser;
  if (!user) return new Map();

  try {
    const notesMap = new Map<string, string>();
    
    // This is simplified - in production you'd query a collection
    // For now, notes are stored individually
    
    return notesMap;
  } catch (error) {
    console.error('Error getting all notes:', error);
    return new Map();
  }
}