import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Linking } from 'react-native';
import { auth, db } from '../firebaseConfig';

export interface SocialLinks {
  instagram?: {
    username: string;
    verified: boolean;
    linkedAt: string;
  };
  linkedin?: {
    profileUrl: string;
    verified: boolean;
    linkedAt: string;
  };
  spotify?: {
    connected: boolean;
    topArtists?: string[];
    topTracks?: string[];
    linkedAt: string;
  };
}

export async function getSocialLinks(): Promise<SocialLinks> {
  const user = auth.currentUser;
  if (!user) return {};

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return {};

    const data = userDoc.data();
    return data.socialLinks || {};
  } catch (error) {
    console.error('Error getting social links:', error);
    return {};
  }
}

export async function linkInstagram(username: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not authenticated' };

  try {
    // Clean username (remove @ if present)
    const cleanUsername = username.replace('@', '').trim().toLowerCase();

    if (!cleanUsername) {
      return { success: false, error: 'Please enter a username' };
    }

    // Basic validation
    if (!/^[a-z0-9._]+$/.test(cleanUsername)) {
      return { success: false, error: 'Invalid Instagram username' };
    }

    if (cleanUsername.length < 1 || cleanUsername.length > 30) {
      return { success: false, error: 'Username must be 1-30 characters' };
    }

    // Save to Firestore
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const currentLinks = userDoc.exists() ? userDoc.data().socialLinks || {} : {};

    await updateDoc(doc(db, 'users', user.uid), {
      socialLinks: {
        ...currentLinks,
        instagram: {
          username: cleanUsername,
          verified: false, // Manual verification required
          linkedAt: new Date().toISOString(),
        },
      },
    });

    return { success: true };
  } catch (error: any) {
    console.error('Error linking Instagram:', error);
    return { success: false, error: error.message || 'Failed to link Instagram' };
  }
}

export async function linkLinkedIn(profileUrl: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not authenticated' };

  try {
    // Validate LinkedIn URL
    const cleanUrl = profileUrl.trim();

    if (!cleanUrl.includes('linkedin.com/in/')) {
      return { success: false, error: 'Please enter a valid LinkedIn profile URL' };
    }

    // Save to Firestore
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const currentLinks = userDoc.exists() ? userDoc.data().socialLinks || {} : {};

    await updateDoc(doc(db, 'users', user.uid), {
      socialLinks: {
        ...currentLinks,
        linkedin: {
          profileUrl: cleanUrl,
          verified: false, // Manual verification required
          linkedAt: new Date().toISOString(),
        },
      },
    });

    return { success: true };
  } catch (error: any) {
    console.error('Error linking LinkedIn:', error);
    return { success: false, error: error.message || 'Failed to link LinkedIn' };
  }
}

export async function unlinkSocial(platform: 'instagram' | 'linkedin' | 'spotify'): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const currentLinks = userDoc.exists() ? userDoc.data().socialLinks || {} : {};

    delete currentLinks[platform];

    await updateDoc(doc(db, 'users', user.uid), {
      socialLinks: currentLinks,
    });

    return true;
  } catch (error) {
    console.error('Error unlinking social:', error);
    return false;
  }
}

export function openInstagramProfile(username: string): void {
  const url = `https://instagram.com/${username}`;
  Linking.openURL(url);
}

export function openLinkedInProfile(profileUrl: string): void {
  Linking.openURL(profileUrl);
}

export function getSocialTrustBonus(socialLinks: SocialLinks): number {
  let bonus = 0;

  if (socialLinks.instagram?.username) {
    bonus += 5; // +5 for linking
    if (socialLinks.instagram.verified) bonus += 5; // +5 more if verified
  }

  if (socialLinks.linkedin?.profileUrl) {
    bonus += 5;
    if (socialLinks.linkedin.verified) bonus += 5;
  }

  if (socialLinks.spotify?.connected) {
    bonus += 3;
  }

  return bonus; // Max +23 trust points
}

export function formatSocialLinkDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const daysSince = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSince === 0) return 'Today';
  if (daysSince === 1) return 'Yesterday';
  if (daysSince < 7) return `${daysSince} days ago`;
  if (daysSince < 30) return `${Math.floor(daysSince / 7)} weeks ago`;
  return date.toLocaleDateString();
}