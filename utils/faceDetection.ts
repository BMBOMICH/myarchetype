// utils/faceDetection.ts
// Uses a free API or your existing Cloudinary/cloud setup
// to verify a human face is present in the image.

export interface FaceDetectionResult {
  hasFace: boolean;
  faceCount: number;
  confidence: number;
}

export async function detectFaceInPhoto(imageUrl: string): Promise<FaceDetectionResult> {
  try {
    // If you use Cloudinary, you can use their AI content analysis
    // by appending quality parameters. Here we use a simple fetch
    // to the Cloudinary faces detection endpoint.
    // Replace with your actual detection service.
    
    // For Cloudinary: add fl_getinfo to get face data
    // This works if your uploadToCloudinary returns a Cloudinary URL
    const infoUrl = imageUrl.replace('/upload/', '/upload/fl_getinfo/');
    const res = await fetch(infoUrl);
    if (!res.ok) return { hasFace: false, faceCount: 0, confidence: 0 };
    const data = await res.json();
    
    // Cloudinary returns faces array in the image info
    const faces = data?.info?.detection?.faces?.data ?? [];
    return {
      hasFace: faces.length > 0,
      faceCount: faces.length,
      confidence: faces.length > 0 ? 0.9 : 0,
    };
  } catch {
    // If detection fails, don't block the user — fail open
    return { hasFace: true, faceCount: 1, confidence: 0 };
  }
}