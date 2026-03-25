/**
 * Simple height estimation based on door reference method
 * In production, replace with ML model (TensorFlow/PyTorch)
 */

export interface HeightEstimationResult {
  height: number; // cm
  confidence: number; // 0-100%
}

export async function estimateHeightFromPhoto(photoUrl: string): Promise<HeightEstimationResult | null> {
  try {
    console.log('Running AI height estimation...');

    // PLACEHOLDER: In production, call ML API here
    // For now, return mock estimation
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mock estimation (replace with real ML)
    const estimatedHeight = 165 + Math.floor(Math.random() * 25); // 165-190cm
    const confidence = 60 + Math.floor(Math.random() * 30); // 60-90%

    console.log('Estimated: ' + estimatedHeight + 'cm (' + confidence + '% confidence)');

    return {
      height: estimatedHeight,
      confidence: confidence,
    };

  } catch (error) {
    console.error('Height estimation error:', error);
    return null;
  }
}

/**
 * Calculate height ratio between person and reference object (door)
 * Standard door height = 200cm
 */
export function calculateHeightFromDoorRatio(personHeightPx: number, doorHeightPx: number): number {
  const STANDARD_DOOR_HEIGHT_CM = 200;
  const ratio = personHeightPx / doorHeightPx;
  return Math.round(ratio * STANDARD_DOOR_HEIGHT_CM);
}

/**
 * Get confidence score based on image quality
 */
export function getConfidenceScore(imageQuality: any): number {
  // Placeholder: in production, analyze image quality factors:
  // - Resolution
  // - Lighting
  // - Distance from camera
  // - Clarity of reference object
  
  return 75; // Default confidence
}