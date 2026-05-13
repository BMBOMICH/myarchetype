/**
 * Body Type Detection
 *
 * Uses Cloudinary face bounding box data to determine if a photo
 * shows a full body or just a face/headshot.
 *
 * Face-to-image ratio logic:
 *   Face > 40% of image height  →  headshot / close-up
 *   Face 25–40%                 →  upper body
 *   Face 15–25%                 →  half body
 *   Face < 15% (upper portion)  →  full body
 *
 * IMPORTANT: Use detectBodyTypeFromCloudinaryFaces() when you already
 * have face data from the upload. Only call detectFullBodyPhoto() for
 * legacy photos uploaded without face data.
 */

import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { logger } from './logger';

export interface BodyTypeDetectionResult {
  isFullBody: boolean;
  confidence: number;
  estimatedType?: 'Slim' | 'Average' | 'Athletic' | 'Curvy';
  feedback?: string;
}

function analyzeFaceRatio(
  imageWidth: number,
  imageHeight: number,
  faces: Array<[number, number, number, number]>,
): BodyTypeDetectionResult {
  if (!imageWidth || !imageHeight || faces.length === 0) {
    return {
      isFullBody: false,
      confidence: 30,
      feedback: 'Could not detect a face in this photo. Make sure you are visible.',
    };
  }

  let largestFace = faces[0]!;
  for (const face of faces) {
    if (face[2]! * face[3]! > largestFace[2]! * largestFace[3]!) {
      largestFace = face;
    }
  }

  const [, faceY, , faceH] = largestFace;
  const faceHeightRatio = faceH! / imageHeight;
  const faceCenterY = ((faceY ?? 0) + (faceH ?? 0) / 2) / imageHeight;

  logger.log(
    `[bodyType] faceHeightRatio: ${faceHeightRatio.toFixed(2)}, ` +
    `faceCenterY: ${faceCenterY.toFixed(2)}`
  );

  if (faceHeightRatio < 0.15 && faceCenterY < 0.3) {
    return {
      isFullBody: true,
      confidence: 90,
      feedback: 'Great! This appears to show your full body.',
    };
  }

  if (faceHeightRatio < 0.25 && faceCenterY < 0.4) {
    return {
      isFullBody: true,
      confidence: 75,
      feedback: 'This looks like a full or near-full body photo.',
    };
  }

  if (faceHeightRatio < 0.40) {
    return {
      isFullBody: false,
      confidence: 65,
      feedback: 'This appears to show your upper body. Consider adding a full-body photo.',
    };
  }

  return {
    isFullBody: false,
    confidence: 85,
    feedback: 'This appears to be a close-up or headshot. Please upload a full-body photo.',
  };
}

/**
 * Use this when you already have Cloudinary face data from the upload.
 * Zero extra network calls — instant, free.
 *
 * Pass the faces array directly from your Cloudinary upload response.
 * Cloudinary faces format: [[x, y, width, height], ...]
 */
export function detectBodyTypeFromCloudinaryFaces(
  imageWidth: number,
  imageHeight: number,
  faces: Array<[number, number, number, number]>,
): BodyTypeDetectionResult {
  return analyzeFaceRatio(imageWidth, imageHeight, faces);
}

/**
 * Use this ONLY for legacy photos that were uploaded without face data.
 * Re-uploads the photo to Cloudinary to get face bounding boxes.
 *
 * For new uploads: pass faces=true at upload time and use
 * detectBodyTypeFromCloudinaryFaces() instead — it is instant and free.
 */
export async function detectFullBodyPhoto(
  photoUrl: string
): Promise<BodyTypeDetectionResult> {
  try {
    logger.log('[bodyType] Re-uploading photo to get face data...');

    const form = new FormData();
    form.append('file', photoUrl);
    form.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    form.append('faces', 'true');

    const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
    const res = await fetch(endpoint, { method: 'POST', body: form });

    if (!res.ok) {
      return {
        isFullBody: false,
        confidence: 30,
        feedback: 'Could not analyze photo. Please try again.',
      };
    }

    const data = await res.json();
    const faces: Array<[number, number, number, number]> =
      Array.isArray(data.faces) ? data.faces : [];

    return analyzeFaceRatio(
      data.width ?? 0,
      data.height ?? 0,
      faces,
    );
  } catch (error) {
    logger.error('[bodyType] Detection error:', error);
    return {
      isFullBody: false,
      confidence: 30,
      feedback: 'Photo analysis failed. Please try again.',
    };
  }
}

/**
 * Check if user has at least one full-body photo.
 * Pass Cloudinary face data when available to avoid re-uploading.
 */
export async function validateFullBodyPhotos(
  photoUrls: string[]
): Promise<{
  hasFullBody: boolean;
  fullBodyIndex: number;
  feedback: string;
}> {
  for (let i = 0; i < photoUrls.length; i++) {
    const result = await detectFullBodyPhoto(photoUrls[i]!);

    if (result.isFullBody && result.confidence >= 70) {
      return {
        hasFullBody: true,
        fullBodyIndex: i,
        feedback: 'You have a full-body photo.',
      };
    }
  }

  return {
    hasFullBody: false,
    fullBodyIndex: -1,
    feedback: 'Please upload at least one full-body photo to complete your profile.',
  };
}

/**
 * Body type is self-reported by the user — we do not estimate it from photos.
 * This function exists for API compatibility but always returns confidence 0.
 */
export async function estimateBodyType(
  _photoUrl: string
): Promise<{
  estimatedType: 'Slim' | 'Average' | 'Athletic' | 'Curvy';
  confidence: number;
}> {
  return {
    estimatedType: 'Average',
    confidence: 0,
  };
}
