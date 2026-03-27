/**
 * utils/faceComparison.ts
 *
 * Compares selfie against profile photos.
 * Uses Cloudinary face data for basic validation.
 * The simulateFaceMatch() function has been removed — it was always
 * returning a fake 70-95% confidence score regardless of input.
 */

import { doc, getDoc } from 'firebase/firestore';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { db } from '../firebaseConfig';
import { detectFaceInPhoto } from './faceDetection';

export interface FaceComparisonResult {
  match: boolean;
  confidence: number;
  error?: string;
}

/**
 * Verify that a selfie and a profile photo both contain exactly one face.
 *
 * NOTE: True face *matching* (confirming it's the same person) requires
 * a paid API such as AWS Rekognition or Azure Face API.
 * This function performs the free version: confirming both photos have
 * a detected face, which is the minimum required for selfie verification.
 */
export async function compareFaces(
  userId: string,
  selfieUri: string,
): Promise<FaceComparisonResult> {
  try {
    // 1. Get user's profile photos
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) {
      return { match: false, confidence: 0, error: 'User not found' };
    }

    const userData = userDoc.data();
    const profilePhotos: string[] = userData.photos ?? [];

    if (profilePhotos.length === 0) {
      return { match: false, confidence: 0, error: 'No profile photos to compare against' };
    }

    // 2. Upload selfie and get Cloudinary face data
    const selfieUrl = await uploadSelfieToCloudinary(selfieUri);
    if (!selfieUrl) {
      return { match: false, confidence: 0, error: 'Failed to upload selfie' };
    }

    // 3. Verify selfie has exactly one face
    const selfieCheck = await detectFaceInPhoto(selfieUrl);
    if (!selfieCheck.hasFace) {
      return {
        match: false,
        confidence: 0,
        error: selfieCheck.reason ?? 'No face detected in selfie',
      };
    }

    // 4. Verify profile photo has a face
    const profileCheck = await detectFaceInPhoto(profilePhotos[0] ?? '');
    if (!profileCheck.hasFace) {
      return {
        match: false,
        confidence: 0,
        error: 'No face detected in profile photo',
      };
    }

    // 5. Both photos have one face — basic verification passes
    // Confidence is honest: we confirmed faces exist, not that they match
    return {
      match: true,
      confidence: 70, // honest: face present, not identity-matched
    };
  } catch (error) {
    console.error('[faceComparison] error:', error);
    return { match: false, confidence: 0, error: 'Comparison failed' };
  }
}

async function uploadSelfieToCloudinary(
  photoUri: string,
): Promise<string | null> {
  try {
    const response = await fetch(photoUri);
    const blob = await response.blob();

    const formData = new FormData();
    formData.append('file', blob as any);
    formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    formData.append('detection', 'faces'); // request face data

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`,
      { method: 'POST', body: formData },
    );

    const uploadData = await uploadResponse.json();
    return uploadData.secure_url ?? null;
  } catch (error) {
    console.error('[faceComparison] uploadSelfie error:', error);
    return null;
  }
}

/**
 * Cosine similarity between two face embedding vectors.
 * Only useful if you integrate a real face recognition SDK.
 */
export function compareFaceEmbeddings(
  embedding1: number[],
  embedding2: number[],
): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += (embedding1[i] ?? 0) * (embedding2[i] ?? 0);
    norm1 += (embedding1[i] ?? 0) ** 2;
    norm2 += (embedding2[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denom === 0) return 0;
  return Math.round((dotProduct / denom) * 100);
}