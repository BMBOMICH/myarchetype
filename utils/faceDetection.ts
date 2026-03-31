export interface FaceDetectionResult { hasFace: boolean; faceCount: number; confidence: number; reason?: string; }
export interface PhotoQualityResult { passed: boolean; score: number; issues: string[]; }
export interface FullBodyResult { hasFullBody: boolean; confidence: number; reason?: string; }
export interface CloudinaryFace { x: number; y: number; width: number; height: number; }

// #9 + #10: Face exists + exactly 1 face
export function validateFacesFromCloudinary(faces: CloudinaryFace[], imageWidth?: number, imageHeight?: number): FaceDetectionResult {
  if (!faces?.length) return { hasFace: false, faceCount: 0, confidence: 0, reason: 'No face detected. Look directly at the camera with good lighting.' };
  if (faces.length > 1) return { hasFace: false, faceCount: faces.length, confidence: 0.5, reason: `${faces.length} faces detected. Profile photo must show only you.` };
  const face = faces[0]!;
  if (imageWidth && imageHeight) {
    const ratio = (face.width * face.height) / (imageWidth * imageHeight);
    if (ratio < 0.03) return { hasFace: false, faceCount: 1, confidence: 0.3, reason: 'Face is too small. Move closer to the camera.' };
  }
  return { hasFace: true, faceCount: 1, confidence: 0.95 };
}

// #25: Photo quality
export function scorePhotoQuality(data: { width?: number; height?: number; quality_score?: number; format?: string; bytes?: number }, faces: CloudinaryFace[] = []): PhotoQualityResult {
  const issues: string[] = [];
  let score = 100;
  const { width = 0, height = 0, bytes = 0 } = data;
  if (width < 200 || height < 200) { issues.push('Photo is too small. Use a higher resolution image.'); score -= 40; }
  else if (width < 400 || height < 400) { issues.push('Photo resolution is low.'); score -= 15; }
  const px = width * height;
  if (px > 0 && bytes / px < 0.05 && bytes < 20_000) { issues.push('Photo appears blurry or heavily compressed.'); score -= 25; }
  if (data.quality_score !== undefined) {
    if (data.quality_score < 0.3) { issues.push('Photo quality is too low.'); score -= 30; }
    else if (data.quality_score < 0.5) { issues.push('Photo quality could be better.'); score -= 10; }
  }
  if (faces.length === 1 && width > 0 && height > 0) {
    const ratio = (faces[0]!.width * faces[0]!.height) / (width * height);
    if (ratio < 0.05) { issues.push('Move closer so your face is more visible.'); score -= 10; }
    else if (ratio > 0.1) score += 5;
  }
  if (data.format === 'webp' || data.format === 'avif') score += 5;
  return { passed: issues.length === 0 || score >= 50, score: Math.max(0, Math.min(100, score)), issues };
}

// #29: Full body detection
export function detectFullBodyFromTags(tags: Array<{ tag: string; confidence?: number } | string>): FullBodyResult {
  const BODY_TAGS = ['person','people','human','body','full body','full-body','standing','sitting','posing'];
  const norm = tags.map(t => typeof t === 'string' ? t.toLowerCase() : (t.tag ?? '').toLowerCase());
  for (const bt of BODY_TAGS) { if (norm.some(t => t.includes(bt))) return { hasFullBody: true, confidence: 0.85 }; }
  return { hasFullBody: false, confidence: 0.5, reason: 'No full body detected.' };
}

// Cloudinary async fallback
export async function detectFaceInPhoto(imageUrl: string): Promise<FaceDetectionResult> {
  if (!imageUrl.includes('cloudinary.com')) return { hasFace: true, faceCount: 0, confidence: 0 };
  try {
    const res = await fetch(imageUrl.replace('/upload/', '/upload/fl_getinfo/'), { headers: { Accept: 'application/json' } });
    if (!res.ok) return { hasFace: true, faceCount: 0, confidence: 0 };
    const data = await res.json();
    const faces: any[] = data?.info?.detection?.faces?.data ?? data?.faces ?? [];
    if (!faces.length) return { hasFace: false, faceCount: 0, confidence: 0.8, reason: 'No face detected.' };
    return { hasFace: faces.length === 1, faceCount: faces.length, confidence: 0.9, reason: faces.length > 1 ? `${faces.length} faces. Use a solo photo.` : undefined };
  } catch { return { hasFace: true, faceCount: 1, confidence: 0 }; }
}

export interface PhotoValidationResult { valid: boolean; reasons: string[]; faceResult: FaceDetectionResult; qualityResult: PhotoQualityResult; }

export function validateProfilePhoto(faces: CloudinaryFace[], qualityData: { width?: number; height?: number; quality_score?: number; format?: string; bytes?: number }, tags: string[] = [], requireFullBody = false): PhotoValidationResult {
  const reasons: string[] = [];
  const faceResult = validateFacesFromCloudinary(faces, qualityData.width, qualityData.height);
  if (!faceResult.hasFace) reasons.push(faceResult.reason ?? 'Face check failed.');
  const qualityResult = scorePhotoQuality(qualityData, faces);
  reasons.push(...qualityResult.issues);
  if (requireFullBody) { const b = detectFullBodyFromTags(tags); if (!b.hasFullBody) reasons.push(b.reason ?? 'Full body photo required.'); }
  return { valid: reasons.length === 0, reasons, faceResult, qualityResult };
}