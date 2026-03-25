import { doc, updateDoc } from 'firebase/firestore';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';

export interface VideoUploadResult {
  success: boolean;
  videoUrl?: string;
  error?: string;
}

const MAX_VIDEO_SIZE_MB = 50;
const MAX_VIDEO_DURATION_SECONDS = 15;

export async function uploadVideoProfile(videoUri: string): Promise<VideoUploadResult> {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: 'User not authenticated' };
  }

  try {
    console.log('Starting video upload...');

    // Fetch video as blob
    const response = await fetch(videoUri);
    const blob = await response.blob();

    // Check file size
    const sizeInMB = blob.size / (1024 * 1024);
    if (sizeInMB > MAX_VIDEO_SIZE_MB) {
      return { 
        success: false, 
        error: `Video too large (${sizeInMB.toFixed(1)}MB). Maximum is ${MAX_VIDEO_SIZE_MB}MB` 
      };
    }

    // Upload to Cloudinary
    const formData = new FormData();
    formData.append('file', blob);
    formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);
    formData.append('resource_type', 'video');

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/video/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    const uploadData = await uploadResponse.json();

    if (!uploadData.secure_url) {
      return { success: false, error: 'Upload failed - no URL returned' };
    }

    // Check video duration
    const duration = uploadData.duration || 0;
    if (duration > MAX_VIDEO_DURATION_SECONDS) {
      return { 
        success: false, 
        error: `Video too long (${duration}s). Maximum is ${MAX_VIDEO_DURATION_SECONDS}s` 
      };
    }

    // Save to Firestore
    await updateDoc(doc(db, 'users', user.uid), {
      videoProfile: uploadData.secure_url,
      videoProfileUploadedAt: new Date().toISOString(),
      videoProfileDuration: duration,
    });

    console.log('Video uploaded successfully:', uploadData.secure_url);

    return { 
      success: true, 
      videoUrl: uploadData.secure_url 
    };

  } catch (error: any) {
    console.error('Error uploading video:', error);
    return { 
      success: false, 
      error: error.message || 'Unknown error during upload' 
    };
  }
}

export async function deleteVideoProfile(): Promise<VideoUploadResult> {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: 'User not authenticated' };
  }

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      videoProfile: null,
      videoProfileUploadedAt: null,
      videoProfileDuration: null,
    });

    console.log('Video profile deleted');

    return { success: true };

  } catch (error: any) {
    console.error('Error deleting video:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to delete video' 
    };
  }
}

export function isVideoOld(uploadedAt: string | null): boolean {
  if (!uploadedAt) return false;

  const uploadDate = new Date(uploadedAt);
  const now = new Date();
  const daysSince = Math.floor((now.getTime() - uploadDate.getTime()) / (1000 * 60 * 60 * 24));
  
  return daysSince > 180; // 6 months
}

export function getVideoAge(uploadedAt: string | null): string {
  if (!uploadedAt) return '';

  const uploadDate = new Date(uploadedAt);
  const now = new Date();
  const daysSince = Math.floor((now.getTime() - uploadDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSince === 0) return 'Today';
  if (daysSince === 1) return 'Yesterday';
  if (daysSince < 30) return `${daysSince} days ago`;
  if (daysSince < 60) return '1 month ago';
  if (daysSince < 365) return `${Math.floor(daysSince / 30)} months ago`;
  return 'Over a year ago';
}