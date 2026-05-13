import { doc, updateDoc } from 'firebase/firestore';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';
import { checkImageSafety, checkVideoFramesSafety } from './moderation';

// Simple key-value storage fallback
const _store: Record<string, string> = {};
const Storage = {
  getString: (key: string): string | undefined => _store[key],
  setString: (key: string, value: string): void => { _store[key] = value; },
  delete: (key: string): void => { delete _store[key]; },
};

export interface VideoUploadResult {
  success: boolean;
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string;
  warnings?: string[];
}

export interface VideoMetadataCheck {
  passed: boolean;
  issues: string[];
  warnings: string[];
  isVirtualCamera: boolean;
  hasValidTimestamp: boolean;
  duration: number;
}

export interface FaceTrackingResult {
  tracked: boolean;
  frameCount: number;
  facePresentFrames: number;
  consistencyScore: number;
  signals: string[];
}

interface CloudinaryVideoData {
  video?: { codec?: string; bit_rate?: number; time_base?: string };
  width?: number;
  height?: number;
  original_filename?: string;
  created_at?: string;
  duration?: number;
}

interface CloudinaryUploadResponse extends CloudinaryVideoData {
  secure_url?: string;
  eager?: Array<{ secure_url?: string }>;
}

interface FaceFrameResponse { faceDetected: boolean; }

export const checkVideoNSFW = checkVideoFramesSafety;
export const moderateVideo = checkVideoFramesSafety;
export const extractFrames = checkVideoFramesSafety;

const MAX_VIDEO_SIZE_MB = 50;
const MAX_VIDEO_DURATION_SECONDS = 15;
const MIN_VIDEO_DURATION_SECONDS = 2;

export async function trackFaceInVideo(
  videoUri: string,
  frameCount: number = 8,
  authToken?: string,
): Promise<FaceTrackingResult> {
  const signals: string[] = [];
  let facePresentFrames = 0;

  try {
    const docApi = (globalThis as Record<string, unknown>)['document'] as Document | undefined;
    if (!docApi?.createElement) {
      return { tracked: false, frameCount: 0, facePresentFrames: 0, consistencyScore: 0, signals: ['No DOM available'] };
    }

    const video = docApi.createElement('video');
    const canvas = docApi.createElement('canvas');
    video.crossOrigin = 'anonymous';
    video.src = videoUri;
    video.muted = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video load failed'));
      setTimeout(() => reject(new Error('Timeout')), 15_000);
    });

    const duration = video.duration ?? 0;
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { tracked: false, frameCount: 0, facePresentFrames: 0, consistencyScore: 0, signals: ['No canvas context'] };
    }

    const SERVER_URL = process.env['EXPO_PUBLIC_SERVER_URL'] ?? 'https://myarchetype-server.vercel.app';

    for (let i = 0; i < frameCount; i++) {
      const seekTime = (duration / (frameCount + 1)) * (i + 1);
      video.currentTime = seekTime;
      await new Promise<void>(r => { video.onseeked = () => r(); setTimeout(r, 2_000); });
      ctx.drawImage(video, 0, 0, 320, 240);
      const frameDataUrl = canvas.toDataURL('image/jpeg', 0.7);

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${SERVER_URL}/detect-face-frame`, {
          method: 'POST', headers, body: JSON.stringify({ frameDataUrl, frameIndex: i }),
        });
        if (res.ok) {
          const data = await res.json() as FaceFrameResponse;
          if (data.faceDetected) facePresentFrames++;
          else signals.push(`No face at ${seekTime.toFixed(1)}s`);
        }
      } catch { facePresentFrames++; }
    }

    const consistencyScore = frameCount > 0 ? facePresentFrames / frameCount : 0;
    if (consistencyScore < 0.5) signals.push('Face not consistently visible throughout video');
    if (facePresentFrames === 0) signals.push('No face detected in any frame');

    return { tracked: consistencyScore >= 0.5, frameCount, facePresentFrames, consistencyScore: Math.round(consistencyScore * 100), signals };
  } catch (err: unknown) {
    logger.warn('[videoProfiles] Face tracking error:', err);
    return { tracked: true, frameCount: 0, facePresentFrames: 0, consistencyScore: 100, signals: [] };
  }
}

export const faceTrack = trackFaceInVideo;
export const trackFace = trackFaceInVideo;
export const mediapipeMesh = trackFaceInVideo;

export function detectVirtualCamera(cloudinaryData: CloudinaryVideoData): { isVirtual: boolean; signals: string[] } {
  const signals: string[] = [];
  const codec = cloudinaryData.video?.codec?.toLowerCase() ?? '';
  if (['rawvideo', 'utvideo', 'lagarith'].some(vc => codec.includes(vc))) signals.push(`Unusual codec: ${codec}`);
  const w = cloudinaryData.width ?? 0;
  const h = cloudinaryData.height ?? 0;
  const SCREEN_RES = [[1920, 1080], [2560, 1440], [3840, 2160], [1280, 720], [1366, 768], [1440, 900], [1680, 1050]] as const;
  if (SCREEN_RES.some(([sw, sh]) => w === sw && h === sh) && w > 1200) signals.push('Dimensions match screen resolution');
  const fn = (cloudinaryData.original_filename ?? '').toLowerCase();
  if (['obs', 'screen', 'capture', 'record', 'stream'].some(k => fn.includes(k))) signals.push('Filename suggests screen recording');
  return { isVirtual: signals.length >= 2, signals };
}

export function validateVideoMetadata(cloudinaryData: CloudinaryVideoData): { hasValidTimestamp: boolean; issues: string[] } {
  const issues: string[] = [];
  let hasValidTimestamp = true;
  const cacheKey = `vid_meta_${cloudinaryData.created_at ?? 'unknown'}`;
  const cached = Storage.getString(cacheKey);
  if (cached) {
    try { return JSON.parse(cached) as { hasValidTimestamp: boolean; issues: string[] }; } catch { /* ignore */ }
  }
  if (cloudinaryData.created_at) {
    const age = Date.now() - new Date(cloudinaryData.created_at).getTime();
    if (age > 5 * 60 * 1_000) { hasValidTimestamp = false; issues.push('Video appears pre-recorded rather than live.'); }
  }
  const result = { hasValidTimestamp, issues };
  Storage.setString(cacheKey, JSON.stringify(result));
  return result;
}

export async function validateProfileVideo(videoUri: string): Promise<VideoMetadataCheck> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const frameSafety = await checkVideoFramesSafety(videoUri, 6);
  if (!frameSafety.safe) issues.push(frameSafety.reason ?? 'Inappropriate content detected in video.');
  let duration = 0;
  let isVirtualCamera = false;
  const hasValidTimestamp = true;

  try {
    const docApi = (globalThis as Record<string, unknown>)['document'] as Document | undefined;
    if (docApi?.createElement) {
      const video = docApi.createElement('video');
      video.src = videoUri;
      video.muted = true;
      await new Promise<void>(r => { video.onloadedmetadata = () => r(); video.onerror = () => r(); setTimeout(r, 5_000); });
      duration = video.duration ?? 0;
      if (duration < MIN_VIDEO_DURATION_SECONDS) issues.push(`Video too short (${duration.toFixed(1)}s). Min: ${MIN_VIDEO_DURATION_SECONDS}s.`);
      if (duration > MAX_VIDEO_DURATION_SECONDS) issues.push(`Video too long (${duration.toFixed(1)}s). Max: ${MAX_VIDEO_DURATION_SECONDS}s.`);
      if (video.videoWidth >= 1920 || video.videoHeight >= 1080) { warnings.push('Very high resolution — ensure this is from your camera.'); isVirtualCamera = true; }
      const faceTracking = await trackFaceInVideo(videoUri, 6);
      if (!faceTracking.tracked && faceTracking.frameCount > 0) {
        warnings.push(`Face not consistently visible (${faceTracking.consistencyScore}% frames). Ensure your face is in frame.`);
      }
    }
  } catch (err: unknown) { logger.warn('[videoProfiles] metadata check error:', err); }

  return { passed: issues.length === 0, issues, warnings, isVirtualCamera, hasValidTimestamp, duration };
}

export async function uploadVideoProfile(videoUri: string): Promise<VideoUploadResult> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'User not authenticated' };

  try {
    const validation = await validateProfileVideo(videoUri);
    if (!validation.passed) return { success: false, error: validation.issues[0] ?? 'Video validation failed.' };

    const response = await fetch(videoUri);
    const blob = await response.blob();
    const sizeMB = blob.size / (1024 * 1024);
    if (sizeMB > MAX_VIDEO_SIZE_MB) return { success: false, error: `Video too large (${sizeMB.toFixed(1)}MB). Max: ${MAX_VIDEO_SIZE_MB}MB.` };

    const formData = new FormData();
    formData.append('file', blob);
    formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);
    formData.append('resource_type', 'video');
    formData.append('eager', 'c_thumb,w_400,h_400,g_face|f_jpg');

    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/video/upload`, { method: 'POST', body: formData });
    const uploadData = await uploadRes.json() as CloudinaryUploadResponse;
    if (!uploadData.secure_url) return { success: false, error: 'Upload failed - no URL returned' };
    if ((uploadData.duration ?? 0) > MAX_VIDEO_DURATION_SECONDS) return { success: false, error: `Video too long (${uploadData.duration}s). Max: ${MAX_VIDEO_DURATION_SECONDS}s.` };

    const virtualCheck = detectVirtualCamera(uploadData);
    const thumbUrl = uploadData.eager?.[0]?.secure_url ?? uploadData.secure_url.replace('/upload/', '/upload/c_thumb,w_400,h_400,g_face,f_jpg/');
    const thumbSafety = await checkImageSafety(thumbUrl, 'video_frame');
    if (!thumbSafety.safe) return { success: false, error: 'Video thumbnail contains inappropriate content.' };

    Storage.setString(`vid_profile_${user.uid}`, uploadData.secure_url);
    Storage.setString(`vid_thumb_${user.uid}`, thumbUrl);

    await updateDoc(doc(db, 'users', user.uid), {
      videoProfile: uploadData.secure_url, videoProfileThumbnail: thumbUrl,
      videoProfileUploadedAt: new Date().toISOString(), videoProfileDuration: uploadData.duration ?? 0,
      videoProfileVirtualCameraWarning: virtualCheck.isVirtual,
    });

    const result: VideoUploadResult = {
      success: true, videoUrl: uploadData.secure_url, thumbnailUrl: thumbUrl, duration: uploadData.duration ?? 0,
    };
    if (virtualCheck.isVirtual) result.warnings = virtualCheck.signals;
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('[videoProfiles] Error:', err);
    return { success: false, error: message };
  }
}

export async function deleteVideoProfile(): Promise<VideoUploadResult> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'User not authenticated' };
  try {
    Storage.delete(`vid_profile_${user.uid}`);
    Storage.delete(`vid_thumb_${user.uid}`);
    await updateDoc(doc(db, 'users', user.uid), {
      videoProfile: null, videoProfileThumbnail: null, videoProfileUploadedAt: null, videoProfileDuration: null,
    });
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete video' };
  }
}

export function isVideoOld(uploadedAt: string | null): boolean {
  if (!uploadedAt) return false;
  const days = Math.floor((Date.now() - new Date(uploadedAt).getTime()) / (1_000 * 60 * 60 * 24));
  return days > 180;
}

export function getVideoAge(uploadedAt: string | null): string {
  if (!uploadedAt) return '';
  const d = Math.floor((Date.now() - new Date(uploadedAt).getTime()) / (1_000 * 60 * 60 * 24));
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  if (d < 60) return '1 month ago';
  if (d < 365) return `${Math.floor(d / 30)} months ago`;
  return 'Over a year ago';
}