/**
 * Cloudinary upload utility for React Native / Expo.
 *
 * Setup:
 * 1. Create an unsigned upload preset in your Cloudinary dashboard:
 *    Settings > Upload > Upload presets > Add unsigned preset
 * 2. Set environment variables in your .env / app.config:
 *    EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud_name
 *    EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your_preset
 */

// ─── Config ───────────────────────────────────────────────

const CLOUD_NAME =
  process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
const UPLOAD_PRESET =
  process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '';

const BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;

// ─── Types ────────────────────────────────────────────────

export type MediaTag =
  | 'story_photo'
  | 'story_video'
  | 'profile_photo'
  | 'chat_media';

export interface CloudinaryUploadResult {
  success: boolean;
  url?: string;
  publicId?: string;
  error?: string;
}

interface CloudinaryApiResponse {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format: string;
  width?: number;
  height?: number;
  bytes?: number;
  duration?: number;
}

// ─── Helpers ──────────────────────────────────────────────

function getResourceType(tag: MediaTag): 'image' | 'video' | 'auto' {
  if (tag === 'story_video') return 'video';
  if (tag === 'chat_media') return 'auto';
  return 'image';
}

function getMimeType(uri: string, tag: MediaTag): string {
  if (tag === 'story_video') return 'video/mp4';

  const ext = uri.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    default:
      return 'image/jpeg';
  }
}

function getFileName(uri: string): string {
  return uri.split('/').pop() ?? `upload_${Date.now()}`;
}

// ─── Upload ───────────────────────────────────────────────

export async function uploadToCloudinary(
  fileUri: string,
  tag: MediaTag = 'profile_photo'
): Promise<CloudinaryUploadResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    const msg =
      'Cloudinary not configured. Set EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME ' +
      'and EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET in your environment.';
    console.error(`[Cloudinary] ${msg}`);
    return { success: false, error: msg };
  }

  if (!fileUri) {
    return { success: false, error: 'No file URI provided' };
  }

  try {
    const resourceType = getResourceType(tag);
    const mimeType = getMimeType(fileUri, tag);
    const fileName = getFileName(fileUri);

    const body = new FormData();
    body.append('file', {
      uri: fileUri,
      type: mimeType,
      name: fileName,
    } as unknown as Blob);
    body.append('upload_preset', UPLOAD_PRESET);
    body.append('tags', tag);

    const endpoint = `${BASE_URL}/${resourceType}/upload`;

    const response = await fetch(endpoint, {
      method: 'POST',
      body,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `[Cloudinary] Upload failed (${response.status}):`,
        errorBody
      );
      return {
        success: false,
        error: `Upload failed with status ${response.status}`,
      };
    }

    const data: CloudinaryApiResponse = await response.json();

    return {
      success: true,
      url: data.secure_url,
      publicId: data.public_id,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown upload error';
    console.error('[Cloudinary] upload error:', message);
    return { success: false, error: message };
  }
}