/**
 * utils/e2eeMedia.ts
 * Detectors: #129 E2EE images, #130 E2EE voice/audio
 */
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { decryptTextFromSender, encryptTextForRecipient } from './e2ee';
import { logger } from './logger';

export interface EncryptedMediaUploadResult {
  mediaUrl: string; mediaMimeType: string; mediaSizeBytes: number;
  encryptedMediaKey: string; mediaKeyNonce: string; mediaCipherNonce: string;
  version: number; senderPublicKey: string; senderKeyVersion: number;
}

export interface DecryptableMediaPayload {
  mediaUrl: string; encryptedMediaKey: string; mediaKeyNonce: string;
  mediaCipherNonce: string; senderPublicKey: string;
}

const VER = 1;
const b64E = naclUtil.encodeBase64, b64D = naclUtil.decodeBase64;

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!m) throw new Error('Invalid data URL');
  const bin = globalThis.atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mimeType: m[1] || 'application/octet-stream' };
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${globalThis.btoa(bin)}`;
}

async function fetchAsBytes(uri: string, fallback = 'application/octet-stream'): Promise<{ bytes: Uint8Array; mimeType: string }> {
  try {
    if (uri.startsWith('data:')) return dataUrlToBytes(uri);
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to read media: ${res.status}`);
    const blob = await res.blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || fallback };
  } catch (error) {
    logger.error('[e2eeMedia] fetchAsBytes failed:', error);
    throw error;
  }
}

function encryptBytes(plain: Uint8Array): { encryptedBytes: Uint8Array; mediaKey: Uint8Array; mediaCipherNonce: Uint8Array } {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return { encryptedBytes: nacl.secretbox(plain, nonce, key), mediaKey: key, mediaCipherNonce: nonce };
}

async function wrapKey(key: Uint8Array, recipientId: string) {
  try {
    const w = await encryptTextForRecipient(b64E(key), recipientId);
    return { encryptedMediaKey: w.ciphertext, mediaKeyNonce: w.nonce, senderPublicKey: w.senderPublicKey, senderKeyVersion: w.senderKeyVersion };
  } catch (error) {
    logger.error('[e2eeMedia] wrapKey failed:', error);
    throw error;
  }
}

async function uploadEncrypted(encrypted: Uint8Array, mime: string): Promise<{ mediaUrl: string; mediaSizeBytes: number; mediaMimeType: string }> {
  try {
    const fd = new FormData();
    fd.append('file', `data:application/octet-stream;base64,${b64E(encrypted)}`);
    fd.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/raw/upload`, { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok || !json.secure_url) throw new Error(json?.error?.message || 'Upload failed');
    return { mediaUrl: json.secure_url, mediaSizeBytes: encrypted.byteLength, mediaMimeType: mime };
  } catch (error) {
    logger.error('[e2eeMedia] uploadEncrypted failed:', error);
    throw error;
  }
}

async function encryptAndUpload(uri: string, recipientId: string, fallbackMime: string): Promise<EncryptedMediaUploadResult> {
  try {
    const { bytes, mimeType } = await fetchAsBytes(uri, fallbackMime);
    const { encryptedBytes, mediaKey, mediaCipherNonce } = encryptBytes(bytes);
    const wrapped = await wrapKey(mediaKey, recipientId);
    const upload = await uploadEncrypted(encryptedBytes, mimeType);
    return { ...upload, encryptedMediaKey: wrapped.encryptedMediaKey, mediaKeyNonce: wrapped.mediaKeyNonce, mediaCipherNonce: b64E(mediaCipherNonce), version: VER, senderPublicKey: wrapped.senderPublicKey, senderKeyVersion: wrapped.senderKeyVersion };
  } catch (error) {
    logger.error('[e2eeMedia] encryptAndUpload failed:', error);
    throw error;
  }
}

// ─── #129: E2EE for images ────────────────────────────────
export const encryptAndUploadImageForRecipient = (uri: string, rid: string) => encryptAndUpload(uri, rid, 'image/jpeg');

// ─── #130: E2EE for voice/audio ───────────────────────────
export const encryptAndUploadVoiceForRecipient = (uri: string, rid: string) => encryptAndUpload(uri, rid, 'audio/m4a');
export const encryptVoice = encryptAndUploadVoiceForRecipient;
export const e2eeVoice = encryptAndUploadVoiceForRecipient;
export const E2EEAudio = encryptAndUploadVoiceForRecipient;

export async function decryptMediaToRenderableUri(payload: DecryptableMediaPayload & { mediaMimeType?: string }): Promise<string> {
  try {
    const decKeyB64 = await decryptTextFromSender({ ciphertext: payload.encryptedMediaKey, nonce: payload.mediaKeyNonce, senderPublicKey: payload.senderPublicKey });
    const key = b64D(decKeyB64), nonce = b64D(payload.mediaCipherNonce);
    const res = await fetch(payload.mediaUrl);
    if (!res.ok) throw new Error(`Failed to download encrypted media: ${res.status}`);
    const enc = new Uint8Array(await (await res.blob()).arrayBuffer());
    const opened = nacl.secretbox.open(enc, nonce, key);
    if (!opened) throw new Error('Unable to decrypt media — key mismatch or corrupted data');
    return bytesToDataUrl(opened, payload.mediaMimeType || 'application/octet-stream');
  } catch (error) {
    logger.error('[e2eeMedia] decryptMediaToRenderableUri failed:', error);
    throw error;
  }
}