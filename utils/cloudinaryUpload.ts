import { Platform } from 'react-native';
import { detectFullBodyFromTags, scorePhotoQuality, validateFacesFromCloudinary } from './faceDetection';
import { checkImageSafety } from './moderation';

const CLOUD_NAME = process.env['EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME'] ?? '';
const UPLOAD_PRESET = process.env['EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET'] ?? '';
const BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;
const IS_WEB = Platform.OS === 'web';

export type MediaTag = 'story_photo' | 'story_video' | 'profile_photo' | 'chat_media' | 'edit_profile' | 'voice_thumbnail';

export interface CloudinaryUploadResult {
  success: boolean; url?: string; publicId?: string; error?: string;
  moderationStatus?: 'approved' | 'rejected' | 'pending';
  faces?: Array<{ x: number; y: number; width: number; height: number }>;
  width?: number; height?: number; bytes?: number; format?: string;
  faceCount?: number; qualityScore?: number; hasFullBody?: boolean;
  aiGeneratedWarning?: boolean; exifTimestamp?: string; hasCameraMetadata?: boolean;
}

interface CloudinaryApiResponse {
  secure_url: string; public_id: string; resource_type: string; format: string;
  width?: number; height?: number; bytes?: number; duration?: number;
  moderation?: Array<{ kind: string; status: string }>;
  faces?: Array<[number, number, number, number]>;
  quality_analysis?: { focus: number }; tags?: string[];
  image_metadata?: { Make?: string; Model?: string; DateTimeOriginal?: string; Software?: string; DateTime?: string };
}

interface SpotifyArtistItem { name: string; genres?: string[]; }
interface SpotifyTrackItem { name: string; artists?: Array<{ name: string }>; }

function getResType(tag: MediaTag): 'image' | 'video' | 'auto' {
  if (tag === 'story_video') return 'video';
  if (tag === 'chat_media') return 'auto';
  return 'image';
}

function getMime(uri: string, tag: MediaTag): string {
  if (tag === 'story_video') return 'video/mp4';
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  return ({ png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' } as Record<string, string>)[ext] ?? 'image/jpeg';
}

function dataUriToBlob(d: string): Blob {
  const [h, b] = d.split(',');
  const mime = h?.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const bin = atob(b ?? '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function detectAIGeneratedFromMetadata(meta: { Make?: string; Model?: string; Software?: string; DateTimeOriginal?: string }): { likelyAI: boolean; signals: string[] } {
  const signals: string[] = [];
  const sw = (meta.Software ?? '').toLowerCase();
  if (['stable diffusion','midjourney','dall-e','dalle','adobe firefly','nightcafe','dreamstudio','comfyui','automatic1111','novelai','runway'].some(k => sw.includes(k))) signals.push(`AI software: ${meta.Software}`);
  if (!meta.Make && !meta.Model) signals.push('No camera make/model');
  if (!meta.DateTimeOriginal) signals.push('No capture timestamp');
  return { likelyAI: signals.length >= 2, signals };
}

export function validateExifMetadata(meta: { Make?: string; Model?: string; DateTimeOriginal?: string; DateTime?: string }): { hasCameraMetadata: boolean; hasTimestamp: boolean; photoAge?: number } {
  const hasCam = !!(meta.Make || meta.Model);
  const ts = meta.DateTimeOriginal ?? meta.DateTime;
  let age: number | undefined;
  if (ts) { const d = new Date(ts.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')); if (!isNaN(d.getTime())) age = Math.floor((Date.now() - d.getTime()) / 86_400_000); }
  return { hasCameraMetadata: hasCam, hasTimestamp: !!ts, photoAge: age };
}

interface NativeFileEntry { uri: string; type: string; name: string; }

export async function uploadToCloudinary(fileUri: string, tag: MediaTag = 'profile_photo'): Promise<CloudinaryUploadResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) return { success: false, error: 'Cloudinary not configured.' };
  if (!fileUri) return { success: false, error: 'No file URI provided' };

  if (tag !== 'story_video') {
    const ctx = ({ profile_photo: 'profile', chat_media: 'chat', edit_profile: 'edit', story_photo: 'story', voice_thumbnail: 'voice_thumbnail' } as const)[tag] ?? 'general';
    const nsfw = await checkImageSafety(fileUri, ctx);
    if (!nsfw.safe) return { success: false, error: nsfw.reason };
  }

  try {
    const resType = getResType(tag);
    const body = new FormData();
    const isData = fileUri.startsWith('data:');
    if (IS_WEB && isData) {
      (body as FormData).append('file', dataUriToBlob(fileUri), `upload_${Date.now()}.jpg`);
    } else if (IS_WEB) {
      const r = await fetch(fileUri);
      (body as FormData).append('file', await r.blob(), fileUri.split('/').pop());
    } else {
      const nativeFile: NativeFileEntry = { uri: fileUri, type: getMime(fileUri, tag), name: fileUri.split('/').pop() ?? `upload_${Date.now()}` };
      body.append('file', nativeFile as unknown as Blob);
    }

    body.append('upload_preset', UPLOAD_PRESET);
    body.append('tags', tag);

    const isProfile = tag === 'profile_photo' || tag === 'edit_profile';
    if (isProfile) { body.append('detection', 'faces'); body.append('quality_analysis', 'true'); body.append('image_metadata', 'true'); }

    const res = await fetch(`${BASE_URL}/${resType}/upload`, { method: 'POST', body, headers: { Accept: 'application/json' } });
    if (!res.ok) return { success: false, error: `Upload failed (${res.status})` };
    const data: CloudinaryApiResponse = await res.json() as CloudinaryApiResponse;

    let modStatus: 'approved' | 'rejected' | 'pending' | undefined;
    if (data.moderation?.length) { const s = data.moderation[0]?.status; if (s === 'approved' || s === 'rejected' || s === 'pending') modStatus = s; }
    if (modStatus === 'rejected') return { success: false, error: 'Image rejected by content moderation.' };

    const faces = (data.faces ?? []).map(([x, y, w, h]) => ({ x, y, width: w, height: h }));

    if (isProfile) {
      const fv = validateFacesFromCloudinary(faces, data.width, data.height);
      if (!fv.hasFace) return { success: false, error: fv.reason ?? 'No face detected.' };
    }

    const q = scorePhotoQuality({ width: data.width, height: data.height, bytes: data.bytes, format: data.format, quality_score: data.quality_analysis?.focus }, faces);
    const bd = detectFullBodyFromTags(data.tags ?? []);
    const meta = data.image_metadata ?? {};
    const ai = detectAIGeneratedFromMetadata(meta);
    const exif = validateExifMetadata(meta);

    return {
      success: true, url: data.secure_url, publicId: data.public_id, moderationStatus: modStatus,
      faces, width: data.width, height: data.height, bytes: data.bytes, format: data.format,
      faceCount: faces.length, qualityScore: q.score, hasFullBody: bd.hasFullBody,
      aiGeneratedWarning: ai.likelyAI, exifTimestamp: meta.DateTimeOriginal ?? meta.DateTime,
      hasCameraMetadata: exif.hasCameraMetadata,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload error';
    return { success: false, error: msg };
  }
}

export const uploadProfilePhoto = (uri: string) => uploadToCloudinary(uri, 'profile_photo');
export const uploadChatMedia = (uri: string) => uploadToCloudinary(uri, 'chat_media');
export const uploadEditProfilePhoto = (uri: string) => uploadToCloudinary(uri, 'edit_profile');
export const uploadStoryPhoto = (uri: string) => uploadToCloudinary(uri, 'story_photo');
export const uploadVoiceThumbnail = (uri: string) => uploadToCloudinary(uri, 'voice_thumbnail');
