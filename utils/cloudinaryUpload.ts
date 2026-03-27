/**
 * Cloudinary upload utility for React Native / Expo.
 */

import { Platform } from 'react-native';

const CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '';
const BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;
const IS_WEB = Platform.OS === 'web';

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
  /** Only present when a moderation add-on is enabled on the preset */
  moderationStatus?: 'approved' | 'rejected' | 'pending';
  /** Raw face data returned by Cloudinary's detection layer */
  faces?: Array<{ x: number; y: number; width: number; height: number }>;
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
  /** Present when the upload preset has a moderation add-on */
  moderation?: Array<{ kind: string; status: string }>;
  /** Present when detection: { faces: true } is set on the preset */
  faces?: Array<[number, number, number, number]>;
  /** Present when quality_analysis: true is set on the preset */
  quality_analysis?: { focus: number };
}

// ─── Helpers ──────────────────────────────────────────────

function getResourceType(tag: MediaTag): 'image' | 'video' | 'auto' {
  if (tag === 'story_video') return 'video';
  if (tag === 'chat_media') return 'auto';
  return 'image';
}

function getMimeType(uri: string, tag: MediaTag): string {
  if (tag === 'story_video') return 'video/mp4';
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':  return 'image/png';
    case 'gif':  return 'image/gif';
    case 'webp': return 'image/webp';
    case 'mp4':  return 'video/mp4';
    case 'mov':  return 'video/quicktime';
    default:     return 'image/jpeg';
  }
}

function getFileName(uri: string): string {
  return uri.split('/').pop() ?? `upload_${Date.now()}`;
}

function dataUriToBlob(dataUri: string): Blob {
  const parts = dataUri.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime: string = mimeMatch?.[1] ?? 'image/jpeg';
  const base64String: string = parts[1] ?? '';
  const byteString = atob(base64String);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  return new Blob([arrayBuffer], { type: mime });
}

// ─── Upload ───────────────────────────────────────────────

export async function uploadToCloudinary(
  fileUri: string,
  tag: MediaTag = 'profile_photo',
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
      const blob = dataUriToBlob(fileUri);
      (body as any).append('file', blob, `upload_${Date.now()}.jpg`);
    } else if (IS_WEB && !isDataUri) {
      const fetchRes = await fetch(fileUri);
      const blob = await fetchRes.blob();
      (body as any).append('file', blob, getFileName(fileUri));
    } else {
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

    // ── Request face detection & quality data from Cloudinary ──
    // These are FREE features — no add-on needed.
    // They return face bounding boxes and a focus/quality score.
    if (tag === 'profile_photo') {
      body.append('detection', 'faces');        // returns faces[] array
      body.append('quality_analysis', 'true');  // returns quality_analysis.focus
    }

    const endpoint = `${BASE_URL}/${resourceType}/upload`;
    const res = await fetch(endpoint, {
      method: 'POST',
      body,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`[Cloudinary] Upload failed (${res.status}):`, errorBody);
      return {
        success: false,
        error: `Upload failed with status ${res.status}`,
      };
    }

    const data: CloudinaryApiResponse = await res.json();

    // ── Moderation status (only present if add-on is enabled) ──
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

    // ── Face data (free, no add-on needed) ──
    // Cloudinary returns faces as [[x, y, w, h], ...]
    const faces = (data.faces ?? []).map(([x, y, width, height]) => ({
      x,
      y,
      width,
      height,
    }));

    console.log(
      `[Cloudinary] Upload OK | faces: ${faces.length}` +
      ` | moderation: ${moderationStatus ?? 'not enabled'}` +
      ` | focus: ${data.quality_analysis?.focus ?? 'n/a'}`,
    );

    return {
      success: true,
      url: data.secure_url,
      publicId: data.public_id,
      moderationStatus,
      faces,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown upload error';
    console.error('[Cloudinary] upload error:', message);
    return { success: false, error: message };
  }
}