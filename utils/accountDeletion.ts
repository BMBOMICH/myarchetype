// Covers: #646 Data deletion verification post-account-removal
// [37] #807 Account export data sanitization

import { deleteUser, getAuth } from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, query, where, writeBatch } from 'firebase/firestore';
import { deleteObject, getStorage, listAll, ref } from 'firebase/storage';

const COLLECTIONS_TO_DELETE = [
  'users', 'matches', 'messages', 'reports', 'verification',
  'preferences', 'stories', 'ratings', 'blocked', 'views',
  'dailyQuestions', 'achievements', 'streaks', 'superLikes',
];

// Fields to keep in audit log (hashed only)
const AUDIT_RETENTION_DAYS = 90;

export async function deleteAccount(userId: string): Promise<{
  success: boolean;
  collectionsCleared: string[];
  filesDeleted: number;
  errors: string[];
}> {
  const db = getFirestore();
  const storage = getStorage();
  const errors: string[] = [];
  const cleared: string[] = [];
  let filesDeleted = 0;

  // 1. Delete Firestore documents
  for (const col of COLLECTIONS_TO_DELETE) {
    try {
      const q = query(collection(db, col), where('userId', '==', userId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      // Also check where user appears as other party
      const q2 = query(collection(db, col), where('otherUserId', '==', userId));
      const snap2 = await getDocs(q2);
      if (!snap2.empty) {
        const batch = writeBatch(db);
        snap2.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      cleared.push(col);
    } catch (e: any) {
      errors.push(`${col}: ${e.message}`);
    }
  }

  // 2. Delete Storage files
  try {
    const storageRef = ref(storage, `users/${userId}`);
    const listResult = await listAll(storageRef);
    for (const item of listResult.items) {
      await deleteObject(item);
      filesDeleted++;
    }
    // Nested folders
    for (const prefix of listResult.prefixes) {
      const nested = await listAll(prefix);
      for (const item of nested.items) {
        await deleteObject(item);
        filesDeleted++;
      }
    }
  } catch (e: any) {
    if (!e.message?.includes('not-found')) errors.push(`storage: ${e.message}`);
  }

  // 3. Audit log (hashed UID only, for compliance)
  try {
    const crypto = await import('expo-crypto');
    const hashedUid = await crypto.digestStringAsync(
      crypto.CryptoDigestAlgorithm.SHA256, userId
    );
    const auditRef = doc(collection(db, 'deletion_audit'));
    const batch = writeBatch(db);
    batch.set(auditRef, {
      uidHash: hashedUid,
      deletedAt: new Date().toISOString(),
      collectionsCleared: cleared,
      filesDeleted,
      errors: errors.length > 0 ? errors : null,
      retainUntil: new Date(Date.now() + AUDIT_RETENTION_DAYS * 86400000).toISOString(),
    });
    await batch.commit();
  } catch (e: any) {
    errors.push(`audit: ${e.message}`);
  }

  // 4. Delete Auth account last
  try {
    const auth = getAuth();
    if (auth.currentUser?.uid === userId) {
      await deleteUser(auth.currentUser);
    }
  } catch (e: any) {
    errors.push(`auth: ${e.message}`);
  }

  return { success: errors.length === 0, collectionsCleared: cleared, filesDeleted, errors };
}

// Export sanitized data (GDPR right to portability)
export async function exportUserData(userId: string): Promise<Record<string, any>> {
  const db = getFirestore();
  const exportData: Record<string, any> = {};

  for (const col of COLLECTIONS_TO_DELETE) {
    try {
      const q = query(collection(db, col), where('userId', '==', userId));
      const snap = await getDocs(q);
      exportData[col] = snap.docs.map(d => {
        const data = d.data();
        // Redact other users' PII
        delete data.otherUserEmail;
        delete data.otherUserPhone;
        if (data.otherUserId) data.otherUserId = '[redacted]';
        return data;
      });
    } catch {
      exportData[col] = [];
    }
  }

  return exportData;
}