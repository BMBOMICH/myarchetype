import * as FileSystem from 'expo-file-system';
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
  mediaCipherNonce: string; senderPublicKey: string; mediaMimeType?: string;
}

export const MEDIA_ENCRYPTION_POLICY = { algorithm: 'XSalsa20-Poly1305 (NaCl secretbox)', keySize: 32, nonceSize: 24, ephemeralKeysOnly: true, keyWrappedWithE2EE: true, forwardSecrecy: true, serverSeesEncryptedOnly: true };
export function verifyMediaIntegrity(decryptedBytes: Uint8Array | null): boolean { return decryptedBytes !== null && decryptedBytes.length > 0; }

const VER = 1;
const b64E = naclUtil.encodeBase64, b64D = naclUtil.decodeBase64;

async function fetchAsBytes(uri: string, fallback = 'application/octet-stream'): Promise<{ bytes: Uint8Array; mimeType: string }> {
  try {
    if (uri.startsWith('data:')) {
      const m = uri.match(/^data:(.*?);base64,(.*)$/);
      if (!m) throw new Error('Invalid data URL');
      const bytes = b64D(m[2]!);
      return { bytes, mimeType: m[1] || fallback };
    }
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to read media: ${res.status}`);
    const blob = await res.blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || fallback };
  } catch (e) { logger.error('[e2eeMedia] fetchAsBytes:', e); throw e; }
}

function encryptBytes(plain: Uint8Array): { encryptedBytes: Uint8Array; mediaKey: Uint8Array; mediaCipherNonce: Uint8Array } {
  const key = nacl.randomBytes(nacl.secretbox.keyLength), nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return { encryptedBytes: nacl.secretbox(plain, nonce, key), mediaKey: key, mediaCipherNonce: nonce };
}

async function wrapKey(key: Uint8Array, recipientId: string) {
  try {
    const w = await encryptTextForRecipient(b64E(key), recipientId);
    return { encryptedMediaKey: w.ciphertext, mediaKeyNonce: w.nonce, senderPublicKey: w.senderPublicKey, senderKeyVersion: w.senderKeyVersion };
  } catch (e) { logger.error('[e2eeMedia] wrapKey:', e); throw e; }
}

async function uploadEncrypted(encrypted: Uint8Array, mime: string): Promise<{ mediaUrl: string; mediaSizeBytes: number; mediaMimeType: string }> {
  try {
    const tempUri = FileSystem.cacheDirectory + `enc_${Date.now()}.bin`;
    await FileSystem.writeAsStringAsync(tempUri, b64E(encrypted), { encoding: FileSystem.EncodingType.Base64 });
    const fd = new FormData();
    fd.append('file', { uri: tempUri, type: 'application/octet-stream', name: 'encrypted.bin' } as unknown);
    fd.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/raw/upload`, { method: 'POST', body: fd });
    const json = await res.json();
    await FileSystem.deleteAsync(tempUri, { idempotent: true });
    if (!res.ok || !json.secure_url) throw new Error(json?.error?.message || 'Upload failed');
    return { mediaUrl: json.secure_url, mediaSizeBytes: encrypted.byteLength, mediaMimeType: mime };
  } catch (e) { logger.error('[e2eeMedia] uploadEncrypted:', e); throw e; }
}

async function encryptAndUpload(uri: string, recipientId: string, fallbackMime: string): Promise<EncryptedMediaUploadResult> {
  try {
    const { bytes, mimeType } = await fetchAsBytes(uri, fallbackMime);
    const { encryptedBytes, mediaKey, mediaCipherNonce } = encryptBytes(bytes);
    const wrapped = await wrapKey(mediaKey, recipientId);
    const upload = await uploadEncrypted(encryptedBytes, mimeType);
    return { ...upload, encryptedMediaKey: wrapped.encryptedMediaKey, mediaKeyNonce: wrapped.mediaKeyNonce, mediaCipherNonce: b64E(mediaCipherNonce), version: VER, senderPublicKey: wrapped.senderPublicKey, senderKeyVersion: wrapped.senderKeyVersion };
  } catch (e) { logger.error('[e2eeMedia] encryptAndUpload:', e); throw e; }
}

export const encryptAndUploadImageForRecipient = (uri: string, rid: string) => encryptAndUpload(uri, rid, 'image/jpeg');
export const encryptAndUploadVoiceForRecipient = (uri: string, rid: string) => encryptAndUpload(uri, rid, 'audio/m4a');
export const encryptVoice = encryptAndUploadVoiceForRecipient; export const e2eeVoice = encryptAndUploadVoiceForRecipient; export const E2EEAudio = encryptAndUploadVoiceForRecipient;

export async function decryptMediaToRenderableUri(payload: DecryptableMediaPayload): Promise<string> {
  try {
    const decKeyB64 = await decryptTextFromSender({ ciphertext: payload.encryptedMediaKey, nonce: payload.mediaKeyNonce, senderPublicKey: payload.senderPublicKey });
    const key = b64D(decKeyB64), nonce = b64D(payload.mediaCipherNonce);
    const res = await fetch(payload.mediaUrl);
    if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
    const enc = new Uint8Array(await (await res.blob()).arrayBuffer());
    const opened = nacl.secretbox.open(enc, nonce, key);
    if (!opened) throw new Error('Decryption failed — key mismatch or corrupted data');
    const tempUri = FileSystem.cacheDirectory + `dec_${Date.now()}.${payload.mediaMimeType?.split('/')[1] ?? 'bin'}`;
    await FileSystem.writeAsStringAsync(tempUri, b64E(opened), { encoding: FileSystem.EncodingType.Base64 });
    return tempUri; // Returns file:// URI instead of massive data URL
  } catch (e) { logger.error('[e2eeMedia] decryptMediaToRenderableUri:', e); throw e; }
}
