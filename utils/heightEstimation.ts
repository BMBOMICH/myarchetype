/**
 * Height Estimation
 *
 * Uses Cloudinary face detection data to estimate height
 * from face-to-body proportions (anthropometric method).
 *
 * Scientific basis: Average adult face height ≈ 23cm.
 * Adult body ≈ 7.5 face heights tall.
 *
 * Accuracy: ±10cm. Not a substitute for manual measurement.
 */

export interface HeightEstimationResult {
  height: number;       // cm
  confidence: number;   // 0-100%
}

export interface CloudinaryFaceData {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Estimate height from a full-body photo using Cloudinary face data.
 *
 * @param face - Face bounding box from Cloudinary (pixels)
 * @param imageWidth - Full image width (pixels)
 * @param imageHeight - Full image height (pixels)
 * @returns Estimation result, or null if calculation is not possible
 */
export function estimateHeightFromFaceData(
  face: CloudinaryFaceData,
  imageWidth: number,
  imageHeight: number,
): HeightEstimationResult | null {
  if (!face || imageHeight <= 0 || imageWidth <= 0) {
    return null;
  }

  const faceH = face.height;
  const faceY = face.y;

  if (faceH <= 0) return null;

  // Check if this looks like a full-body photo
  const faceRatio = faceH / imageHeight;

  if (faceRatio > 0.35) {
    // Face takes up too much of the image — not a full body photo
    console.log('[heightEstimation] Not a full-body photo (face ratio:', faceRatio.toFixed(3), ')');
    return null;
  }

  if (faceRatio < 0.03) {
    // Person is too far from camera
    console.log('[heightEstimation] Person too far (face ratio:', faceRatio.toFixed(3), ')');
    return null;
  }

  // Average face bounding box height ≈ 23cm (includes forehead to chin + margin)
  const AVERAGE_FACE_CM = 23;

  // Estimate top of head (face box starts at forehead, skull extends above)
  const headTopY = Math.max(0, faceY - faceH * 0.3);

  // Assume feet are near bottom of image (user was instructed: full body visible)
  const personHeightPixels = imageHeight - headTopY;

  if (personHeightPixels <= 0) return null;

  // How many "face heights" tall is the person?
  const facesInBody = personHeightPixels / faceH;

  // Estimated height using face-to-body ratio
  const estimatedHeight = Math.round(facesInBody * AVERAGE_FACE_CM);

  // Calculate confidence
  let confidence = 60;

  // Typical facesInBody ratio for adults is 6.5-8.5
  if (facesInBody >= 6.5 && facesInBody <= 8.5) confidence += 10;
  if (facesInBody >= 7.0 && facesInBody <= 8.0) confidence += 5;

  // Height in normal human range?
  if (estimatedHeight >= 150 && estimatedHeight <= 200) confidence += 5;
  if (estimatedHeight >= 155 && estimatedHeight <= 195) confidence += 5;

  // Face position should be in upper portion of image for full body
  const facePositionRatio = faceY / imageHeight;
  if (facePositionRatio < 0.25) confidence += 5;

  // Cap confidence — this method is inherently ±10cm
  confidence = Math.min(confidence, 85);

  // Sanity check
  if (estimatedHeight < 130 || estimatedHeight > 230) {
    console.log('[heightEstimation] Unreasonable result:', estimatedHeight, 'cm');
    return null;
  }

  console.log(
    `[heightEstimation] Estimated: ${estimatedHeight}cm (${confidence}% confidence) | ` +
    `Face ratio: ${faceRatio.toFixed(3)}, Faces in body: ${facesInBody.toFixed(1)}`
  );

  return {
    height: estimatedHeight,
    confidence,
  };
}

/**
 * Calculate height using door as reference object.
 * Standard interior door height = 200cm (203cm in US).
 *
 * @param personHeightPx - Person's height in pixels
 * @param doorHeightPx - Door's height in pixels
 * @param doorHeightCm - Actual door height in cm (default 200)
 */
export function calculateHeightFromDoorRatio(
  personHeightPx: number,
  doorHeightPx: number,
  doorHeightCm: number = 200
): number {
  if (doorHeightPx <= 0 || personHeightPx <= 0) return 0;
  const ratio = personHeightPx / doorHeightPx;
  return Math.round(ratio * doorHeightCm);
}

/**
 * Calculate confidence based on how good the reference measurement is.
 * Takes into account face visibility, image proportions, etc.
 */
export function getConfidenceScore(params: {
  faceRatio?: number;     // face height / image height
  facesInBody?: number;   // person height / face height
  facePositionY?: number; // where face sits in image (0 = top)
  imageHeight?: number;
}): number {
  let confidence = 50;

  if (params.faceRatio !== undefined) {
    // Good range for full-body photos
    if (params.faceRatio >= 0.05 && params.faceRatio <= 0.25) confidence += 15;
    else if (params.faceRatio >= 0.03 && params.faceRatio <= 0.35) confidence += 5;
  }

  if (params.facesInBody !== undefined) {
    // Normal adult proportions
    if (params.facesInBody >= 7.0 && params.facesInBody <= 8.0) confidence += 15;
    else if (params.facesInBody >= 6.5 && params.facesInBody <= 8.5) confidence += 5;
  }

  if (params.facePositionY !== undefined && params.imageHeight) {
    const posRatio = params.facePositionY / params.imageHeight;
    if (posRatio < 0.2) confidence += 10;
    else if (posRatio < 0.3) confidence += 5;
  }

  return Math.min(confidence, 85);
}