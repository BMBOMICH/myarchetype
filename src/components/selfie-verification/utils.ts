import { Platform } from 'react-native';
let QuickCrypto: typeof import('react-native-quick-crypto').default | null = null;
if (Platform.OS !== 'web') { try { QuickCrypto = require('react-native-quick-crypto').default; } catch {} }
import { writeAuditLog } from '../../../utils/logger';
import type { PoseInstruction, UploadResult, CloudinaryResponse } from './types';
import { ALL_POSES, NUM_POSES, SERVER_URL, VIRTUAL_CAM_KW } from './constants';
import { CLOUDINARY_CONFIG } from '@/cloudinaryConfig';

export const isVirtualCam = (l: string) => {
  const lo = l.toLowerCase();
  return VIRTUAL_CAM_KW.some(k => lo.includes(k));
};

export async function logAudit(event: string, data: Record<string, unknown>) {
  try { await writeAuditLog(event, data); } catch (err: unknown) { void err; }
}

export function secureRandInt(max: number): number {
  const b = QuickCrypto.randomBytes(4);
  return (((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0) % max;
}

export function secureShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function makeInitialPoses(): PoseInstruction[] {
  return secureShuffle(ALL_POSES).slice(0, NUM_POSES);
}

export function enforceInAppCaptureOnly(uri: string, isWeb: boolean): boolean {
  if (isWeb) return uri.startsWith('data:') || uri.startsWith('blob:');
  if (uri.startsWith('file://') || uri.startsWith('content://')) return true;
  return !/^https?:\/\//i.test(uri) || uri.includes('localhost');
}

export function dataUriToBlob(uri: string): Blob {
  const [h = '', b = ''] = uri.split(',');
  const mime = h.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const bin  = atob(b);
  const arr  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function appendFile(form: FormData, uri: string, name: string): void {
  const ap = form.append.bind(form) as (k: string, v: unknown, n?: string) => void;
  if (uri.startsWith('data:'))        ap('file', dataUriToBlob(uri), name);
  else if (/^https?:\/\//i.test(uri)) form.append('file', uri);
  else                                ap('file', { uri, type: 'image/jpeg', name });
}

export function getFaceCropUrl(url: string): string {
  return url.split('?')[0]!.replace('/upload/', '/upload/w_200,h_200,c_thumb,g_face,f_jpg/');
}

export function checkTimings(ts: number[]): { ok: boolean; reason: string } {
  if (ts.length < 2) return { ok: true, reason: 'OK' };
  const total = ts[ts.length - 1]! - ts[0]!;
  if (total < 1000)           return { ok: false, reason: 'Photos captured too quickly.' };
  if (total > 5 * 60 * 1000) return { ok: false, reason: 'Session too long. Please restart.' };
  for (let i = 1; i < ts.length; i++) {
    if (ts[i]! - ts[i - 1]! < 500) return { ok: false, reason: 'Photos captured too quickly. Follow each pose carefully.' };
  }
  return { ok: true, reason: 'OK' };
}

export function checkDimensions(w: number, h: number): { ok: boolean; reason: string } {
  if (!w || !h) return { ok: true, reason: 'OK' };
  if (w < 200 || h < 200) return { ok: false, reason: 'Photo resolution too low.' };
  if (w === h) {
    const p2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
    if (p2(w) && w >= 256) return { ok: false, reason: 'Photo dimensions look AI-generated.' };
  }
  if (Math.max(w, h) / Math.min(w, h) > 3) return { ok: false, reason: 'Unusual proportions. Take a normal selfie.' };
  return { ok: true, reason: 'OK' };
}

export function checkExifForAI(meta?: Record<string, unknown>): { likelyAI: boolean; reason?: string } {
  if (!meta) return { likelyAI: false };
  const tools = ['stable diffusion','midjourney','dall-e','dalle','adobe firefly','nightcafe','dreamstudio','novelai','comfyui','automatic1111','runway'];
  const sw    = typeof meta['Software'] === 'string' ? meta['Software'].toLowerCase() : '';
  return tools.some(k => sw.includes(k))
    ? { likelyAI: true, reason: `AI software in metadata: ${String(meta['Software'])}` }
    : { likelyAI: false };
}

export async function verifyPhotoNSFWServer(imageUri: string) {
  if (!SERVER_URL) return { safe: true };
  const isDataUri = imageUri.startsWith('data:');
  const body = isDataUri
    ? { image: imageUri.split(',')[1], checks: ['nsfw', 'nudity'] }
    : { imageUrl: imageUri, checks: ['nsfw', 'nudity'] };
  const res = await fetch(`${SERVER_URL}/api/verify-photo-nsfw`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) return { safe: true };
  return res.json() as Promise<{ safe: boolean; reason?: string }>;
}

export async function uploadToCloudinary(uri: string): Promise<UploadResult> {
  const ep = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
  const build = (full: boolean) => {
    const f = new FormData();
    appendFile(f, uri, `selfie_${Date.now()}.jpg`);
    f.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    if (full) { f.append('faces', 'true'); f.append('image_metadata', 'true'); }
    return f;
  };
  let res = await fetch(ep, { method: 'POST', body: build(true) });
  if (!res.ok && res.status === 400) res = await fetch(ep, { method: 'POST', body: build(false) });
  const raw = await res.json() as CloudinaryResponse;
  if (!res.ok)         throw new Error(raw.error?.message ?? `Upload failed (${res.status})`);
  if (!raw.secure_url) throw new Error('Upload returned no URL');
  const getFaceCount = (f: unknown) => Array.isArray(f) ? f.length : 0;
  const getNum       = (v: unknown) => typeof v === 'number' ? v : 0;
  const getMeta      = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  return {
    url:       raw.secure_url,
    faceCount: getFaceCount(raw.faces),
    width:     getNum(raw.width),
    height:    getNum(raw.height),
    metadata:  getMeta(raw.image_metadata),
  };
}