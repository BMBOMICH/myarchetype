import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

// Update user's last seen timestamp
export const updateLastSeen = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      lastSeen: serverTimestamp(),
      isOnline: true,
    });
  } catch (error: any) {
    if (error?.code === 'permission-denied') return; // ✅ silent
    console.error('Error updating last seen:', error);
  }
};

// Set user as offline
export const setOffline = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      isOnline: false,
      lastSeen: serverTimestamp(),
    });
  } catch (error: any) {
    if (error?.code === 'permission-denied') return; // ✅ silent
    console.error('Error setting offline:', error);
  }
};

// Format last seen time
export const formatLastSeen = (lastSeen: any): string => {
  if (!lastSeen) return '';

  try {
    const date = lastSeen.toDate ? lastSeen.toDate() : new Date(lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
};

// Check if user is online (active in last 5 minutes)
export const isUserOnline = (lastSeen: any): boolean => {
  if (!lastSeen) return false;

  try {
    const date = lastSeen.toDate ? lastSeen.toDate() : new Date(lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    return diffMins < 5;
  } catch {
    return false;
  }
};