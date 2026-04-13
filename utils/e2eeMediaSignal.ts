import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { logger } from './logger';
import { encryptSignalText } from './signalProtocol';

export interface EncryptedMediaUploadResult {
  mediaUrl: string; mediaMimeType: string; mediaSizeBytes: number;
  encryptedMediaKey: string; mediaKeyNonce: string; mediaCipherNonce: string;
  version: number; senderPublicKey: string; senderKeyVersion: number;
  ephemeralPub?: string;
}

const VER = 2;
const b64E = naclUtil.encodeBase64, b64D = naclUtil.decodeBase64;

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!m) throw new Error('Invalid data URL');
  const bin = globalThis.atob(m[2]!), bytes = new Uint8Array(bin.length);
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
  } catch (e) { logger.error('[e2eeMediaSignal] fetchAsBytes:', e); throw e; }
}

function encryptBytes(plain: Uint8Array): { encryptedBytes: Uint8Array; mediaKey: Uint8Array; mediaCipherNonce: Uint8Array } {
  const key = nacl.randomBytes(nacl.secretbox.keyLength), nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return { encryptedBytes: nacl.secretbox(plain, nonce, key), mediaKey: key, mediaCipherNonce: nonce };
}

async function wrapKey(key: Uint8Array, recipientId: string) {
  try {
    const w = await encryptSignalText(b64E(key), recipientId);
    if (!w) throw new Error('Failed to wrap media key');
    return { encryptedMediaKey: w.ciphertext, mediaKeyNonce: w.nonce, senderPublicKey: w.senderPublicKey, senderKeyVersion: w.senderKeyVersion, ephemeralPub: w.ephemeralPub };
  } catch (e) { logger.error('[e2eeMediaSignal] wrapKey:', e); throw e; }
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
  } catch (e) { logger.error('[e2eeMediaSignal] uploadEncrypted:', e); throw e; }
}

async function encryptAndUpload(uri: string, recipientId: string, fallbackMime: string): Promise<EncryptedMediaUploadResult> {
  try {
    const { bytes, mimeType } = await fetchAsBytes(uri, fallbackMime);
    const { encryptedBytes, mediaKey, mediaCipherNonce } = encryptBytes(bytes);
    const wrapped = await wrapKey(mediaKey, recipientId);
    const upload = await uploadEncrypted(encryptedBytes, mimeType);
    return { ...upload, encryptedMediaKey: wrapped.encryptedMediaKey, mediaKeyNonce: wrapped.mediaKeyNonce, mediaCipherNonce: b64E(mediaCipherNonce), version: VER, senderPublicKey: wrapped.senderPublicKey, senderKeyVersion: wrapped.senderKeyVersion, ephemeralPub: wrapped.ephemeralPub };
  } catch (e) { logger.error('[e2eeMediaSignal] encryptAndUpload:', e); throw e; }
}

export const encryptAndUploadImageForRecipient = (uri: string, rid: string) => encryptAndUpload(uri, rid, 'image/jpeg');
export const encryptAndUploadVoiceForRecipient = (uri: string, rid: string) => encryptAndUpload(uri, rid, 'audio/m4a');
export const encryptVoice = encryptAndUploadVoiceForRecipient;
export const e2eeVoice = encryptAndUploadVoiceForRecipient;
export const E2EEAudio = encryptAndUploadVoiceForRecipient;

export async function decryptMediaToRenderableUri(payload: EncryptedMediaUploadResult): Promise<string> {
  try {
    const { decryptSignalText } = await import('./signalProtocol');
    const sigPayload = { ciphertext: payload.encryptedMediaKey, nonce: payload.mediaKeyNonce, version: 2, senderPublicKey: payload.senderPublicKey, ephemeralPub: payload.ephemeralPub, senderKeyVersion: payload.senderKeyVersion };
    const decKeyB64 = await decryptSignalText(sigPayload, payload.senderPublicKey); // Note: pass senderId in real impl
    const key = b64D(decKeyB64!), nonce = b64D(payload.mediaCipherNonce);
    const res = await fetch(payload.mediaUrl);
    if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
    const enc = new Uint8Array(await (await res.blob()).arrayBuffer());
    const opened = nacl.secretbox.open(enc, nonce, key);
    if (!opened) throw new Error('Decryption failed — key mismatch or corrupted data');
    return bytesToDataUrl(opened, payload.mediaMimeType || 'application/octet-stream');
  } catch (e) { logger.error('[e2eeMediaSignal] decryptMediaToRenderableUri:', e); throw e; }
}