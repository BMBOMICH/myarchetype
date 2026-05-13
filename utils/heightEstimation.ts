import { logger } from './logger';
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

  const faceRatio = faceH / imageHeight;

  if (faceRatio > 0.35) {
    logger.log('[heightEstimation] Not a full-body photo (face ratio:', faceRatio.toFixed(3), ')');
    return null;
  }

  if (faceRatio < 0.03) {
    logger.log('[heightEstimation] Person too far (face ratio:', faceRatio.toFixed(3), ')');
    return null;
  }

  const AVERAGE_FACE_CM = 23;

  const headTopY = Math.max(0, faceY - faceH * 0.3);

  const personHeightPixels = imageHeight - headTopY;

  if (personHeightPixels <= 0) return null;

  const facesInBody = personHeightPixels / faceH;

  const estimatedHeight = Math.round(facesInBody * AVERAGE_FACE_CM);

  let confidence = 60;

  if (facesInBody >= 6.5 && facesInBody <= 8.5) confidence += 10;
  if (facesInBody >= 7.0 && facesInBody <= 8.0) confidence += 5;

  if (estimatedHeight >= 150 && estimatedHeight <= 200) confidence += 5;
  if (estimatedHeight >= 155 && estimatedHeight <= 195) confidence += 5;

  const facePositionRatio = faceY / imageHeight;
  if (facePositionRatio < 0.25) confidence += 5;

  confidence = Math.min(confidence, 85);

  if (estimatedHeight < 130 || estimatedHeight > 230) {
    logger.log('[heightEstimation] Unreasonable result:', estimatedHeight, 'cm');
    return null;
  }

  logger.log(
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
    if (params.faceRatio >= 0.05 && params.faceRatio <= 0.25) confidence += 15;
    else if (params.faceRatio >= 0.03 && params.faceRatio <= 0.35) confidence += 5;
  }

  if (params.facesInBody !== undefined) {
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
