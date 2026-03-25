import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';

export interface VoiceIntro {
  url: string;
  duration: number; // seconds
  uploadedAt: string;
}

export const MAX_VOICE_INTRO_DURATION = 30; // 30 seconds

export async function getVoiceIntro(): Promise<VoiceIntro | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return null;

    const data = userDoc.data();
    if (!data.voiceIntro) return null;

    return data.voiceIntro as VoiceIntro;
  } catch (error) {
    console.error('Error getting voice intro:', error);
    return null;
  }
}

export async function uploadVoiceIntro(
  audioUri: string,
  duration: number
): Promise<{ success: boolean; url?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  if (duration > MAX_VOICE_INTRO_DURATION) {
    return { success: false, error: `Voice intro must be under ${MAX_VOICE_INTRO_DURATION} seconds` };
  }

  try {
    const response = await fetch(audioUri);
    const blob = await response.blob();

    const formData = new FormData();
    formData.append('file', blob);
    formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);
    formData.append('resource_type', 'auto');

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/auto/upload`,
      { method: 'POST', body: formData }
    );

    const uploadData = await uploadResponse.json();

    if (!uploadData.secure_url) {
      return { success: false, error: 'Upload failed' };
    }

    const voiceIntro: VoiceIntro = {
      url: uploadData.secure_url,
      duration: Math.round(duration),
      uploadedAt: new Date().toISOString(),
    };

    await updateDoc(doc(db, 'users', user.uid), {
      voiceIntro: voiceIntro,
    });

    return { success: true, url: uploadData.secure_url };
  } catch (error: any) {
    console.error('Error uploading voice intro:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteVoiceIntro(): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      voiceIntro: null,
    });
    return { success: true };
  } catch (error) {
    console.error('Error deleting voice intro:', error);
    return { success: false };
  }
}

export function formatVoiceDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}