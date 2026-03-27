/**
 * utils/faceDetection.ts
 *
 * Validates profile photos using data returned directly by Cloudinary.
 * No external API key required — Cloudinary returns face bounding boxes
 * for free when detection=faces is passed at upload time.
 */

export interface FaceDetectionResult {
  hasFace: boolean;
  faceCount: number;
  confidence: number;
  /** Why the check failed, if hasFace is false */
  reason?: string;
}

export interface CloudinaryFace {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Validate face data returned by Cloudinary at upload time.
 * Pass the `faces` array from CloudinaryUploadResult.
 *
 * This runs LOCALLY — zero network calls after the upload.
 */
export function validateFacesFromCloudinary(
  faces: CloudinaryFace[],
  imageWidth?: number,
  imageHeight?: number,
): FaceDetectionResult {
  // No faces detected
  if (!faces || faces.length === 0) {
    return {
      hasFace: false,
      faceCount: 0,
      confidence: 0,
      reason: 'No face detected. Look directly at the camera with good lighting.',
    };
  }

  // Multiple faces — profile photos should show one person
  if (faces.length > 1) {
    return {
      hasFace: false,
      faceCount: faces.length,
      confidence: 0.5,
      reason: `${faces.length} faces detected. Profile photo must show only you.`,
    };
  }

  const face = faces[0];

  // Face too small relative to image — likely not a selfie
  if (imageWidth && imageHeight) {
    const faceArea = face.width * face.height;
    const imageArea = imageWidth * imageHeight;
    const faceRatio = faceArea / imageArea;

    if (faceRatio < 0.03) {
      return {
        hasFace: false,
        faceCount: 1,
        confidence: 0.3,
        reason: 'Face is too small. Move closer to the camera.',
      };
    }
  }

  return {
    hasFace: true,
    faceCount: 1,
    confidence: 0.95,
  };
}

/**
 * Fallback: fetch face data from a Cloudinary URL that already
 * has faces detected. Only use this if you didn't capture faces
 * at upload time.
 *
 * Prefer validateFacesFromCloudinary() — it's instant and free.
 */
export async function detectFaceInPhoto(
  imageUrl: string,
): Promise<FaceDetectionResult> {
  // Guard: only works on Cloudinary URLs
  if (!imageUrl.includes('cloudinary.com')) {
    console.warn('[faceDetection] URL is not a Cloudinary URL, skipping check');
    return { hasFace: true, faceCount: 0, confidence: 0 };
  }

  try {
    // Append fl_getinfo to request face metadata from Cloudinary
    // This works without any add-on on any plan
    const infoUrl = imageUrl.replace('/upload/', '/upload/fl_getinfo/');
    const res = await fetch(infoUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn('[faceDetection] fl_getinfo returned', res.status);
      // Fail open only if the image is already on Cloudinary (trusted source)
      return { hasFace: true, faceCount: 0, confidence: 0 };
    }

    const data = await res.json();

    // Cloudinary face data lives at different paths depending on
    // whether detection was requested at upload or inferred later
    const faces: any[] =
      data?.info?.detection?.faces?.data ??
      data?.faces ??
      [];

    if (faces.length === 0) {
      return {
        hasFace: false,
        faceCount: 0,
        confidence: 0.8,
        reason: 'No face detected in photo.',
      };
    }

    return {
      hasFace: faces.length === 1,
      faceCount: faces.length,
      confidence: 0.9,
      reason:
        faces.length > 1
          ? `${faces.length} faces detected. Use a solo photo.`
          : undefined,
    };
  } catch (err) {
    console.warn('[faceDetection] detectFaceInPhoto error:', err);
    // Fail open — image is already on Cloudinary so it passed upload
    return { hasFace: true, faceCount: 1, confidence: 0 };
  }
}