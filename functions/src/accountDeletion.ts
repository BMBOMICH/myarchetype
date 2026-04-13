// functions/src/accountDeletion.ts
export const deleteAccount = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new Error('Unauthorized');

  const collections = [
    'users', 'matches', 'messages', 'reports', 
    'photos', 'verification', 'preferences'
  ];

  const batch = admin.firestore().batch();
  
  for (const collection of collections) {
    const docs = await admin.firestore()
      .collection(collection)
      .where('userId', '==', uid)
      .get();
    docs.forEach(doc => batch.delete(doc.ref));
  }

  // Delete storage files
  const bucket = admin.storage().bucket();
  await bucket.deleteFiles({ prefix: `users/${uid}/` });

  // Delete auth account
  await admin.auth().deleteUser(uid);

  await batch.commit();

  // Audit log (retained for compliance)
  await admin.firestore().collection('deletion_audit').add({
    uid_hash: crypto.createHash('sha256').update(uid).digest('hex'),
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    collectionsCleared: collections,
  });
});