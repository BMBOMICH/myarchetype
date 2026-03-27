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

import { Platform } from 'react-native';

// ─── Config ───────────────────────────────────────────────

const CLOUD_NAME =
  process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
const UPLOAD_PRESET =
  process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '';

const BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;

const IS_WEB = Platform.OS === 'web';

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
  moderationStatus?: 'approved' | 'rejected' | 'pending';
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
  moderation?: Array<{ status: string }>;
}

// ─── Helpers ──────────────────────────────────────────────

function getResourceType(tag: MediaTag): 'image' | 'video' | 'auto' {
  if (tag === 'story_video') return 'video';
  if (tag === 'chat_media') return 'auto';
  return 'image';
}

function getMimeType(uri: string, tag: MediaTag): string {
  if (tag === 'story_video') return 'video/mp4';

  // Fix: use nullish coalescing to guarantee a string before switch
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
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
  // Fix: guarantee a string return — pop() may be undefined
  return uri.split('/').pop() ?? `upload_${Date.now()}`;
}

/**
 * Convert a data URI to a Blob (web only).
 * Works without needing 'dom' lib in tsconfig.
 */
function dataUriToBlob(dataUri: string): Blob {
  const parts = dataUri.split(',');

  // Fix: narrow the match result before accessing index [1]
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime: string = mimeMatch?.[1] ?? 'image/jpeg';

  // Fix: parts[1] may be undefined — fall back to empty string
  const base64String: string = parts[1] ?? '';
  const byteString = atob(base64String);

  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);

  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }

  // Fix: pass arrayBuffer (not uint8Array) — Blob constructor
  // accepts ArrayBuffer directly and satisfies the type checker
  return new Blob([arrayBuffer], { type: mime });
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
    const body = new FormData();

    const isDataUri = fileUri.startsWith('data:');

    if (IS_WEB && isDataUri) {
      // Web with data URI from canvas — convert to Blob manually
      const blob = dataUriToBlob(fileUri);
      (body as any).append('file', blob, `upload_${Date.now()}.jpg`);
    } else if (IS_WEB && !isDataUri) {
      // Web with regular URL — fetch and convert to Blob
      const fetchRes = await fetch(fileUri);
      const blob = await fetchRes.blob();
      (body as any).append('file', blob, getFileName(fileUri));
    } else {
      // Native: use uri object (React Native FormData format)
      const mimeType = getMimeType(fileUri, tag);
      const fileName = getFileName(fileUri);
      body.append('file', {
        uri: fileUri,
        type: mimeType,
        name: fileName,
      } as unknown as Blob);
    }

    body.append('upload_preset', UPLOAD_PRESET);
    body.append('tags', tag);

    const endpoint = `${BASE_URL}/${resourceType}/upload`;

    const res = await fetch(endpoint, {
      method: 'POST',
      body,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(
        `[Cloudinary] Upload failed (${res.status}):`,
        errorBody
      );
      return {
        success: false,
        error: `Upload failed with status ${res.status}`,
      };
    }

    const data: CloudinaryApiResponse = await res.json();

    // Fix: guard array access — check length then read index safely
    let moderationStatus: 'approved' | 'rejected' | 'pending' | undefined;
    if (data.moderation && data.moderation.length > 0) {
      const firstEntry = data.moderation[0];
      if (firstEntry !== undefined) {
        const { status } = firstEntry;
        if (
          status === 'approved' ||
          status === 'rejected' ||
          status === 'pending'
        ) {
          moderationStatus = status;
        }
      }
    }

    return {
      success: true,
      url: data.secure_url,
      publicId: data.public_id,
      moderationStatus,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown upload error';
    console.error('[Cloudinary] upload error:', message);
    return { success: false, error: message };
  }
}