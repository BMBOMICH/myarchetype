import { doc, getDoc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export async function recordProfileView(viewedUserId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  
  // Don't record viewing your own profile
  if (user.uid === viewedUserId) return;

  try {
    const viewId = `${user.uid}_${viewedUserId}_${new Date().toISOString().split('T')[0]}`;
    
    // Check if already viewed today
    const existingView = await getDoc(doc(db, 'profileViews', viewId));
    if (existingView.exists()) return;

    // Record the view
    await setDoc(doc(db, 'profileViews', viewId), {
      viewerId: user.uid,
      viewedUserId: viewedUserId,
      viewedAt: serverTimestamp(),
    });

    // Increment view count on the viewed user's profile
    try {
      await updateDoc(doc(db, 'users', viewedUserId), {
        profileViews: increment(1),
      });
    } catch (e) {
      console.log('Could not update view count');
    }

  } catch (error) {
    console.error('Error recording profile view:', error);
  }
}