import { Platform } from 'react-native';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { CLOUDINARY_CONFIG } from '../cloudinaryConfig';
import { decryptTextFromSender, encryptTextForRecipient } from './e2ee';

export interface EncryptedMediaUploadResult {
  mediaUrl: string;
  mediaMimeType: string;
  mediaSizeBytes: number;
  encryptedMediaKey: string;
  mediaKeyNonce: string;
  mediaCipherNonce: string;
  version: number;
  senderPublicKey: string;
  senderKeyVersion: number;
}

export interface DecryptableMediaPayload {
  mediaUrl: string;
  encryptedMediaKey: string;
  mediaKeyNonce: string;
  mediaCipherNonce: string;
  senderPublicKey: string;
}

const MEDIA_E2EE_VERSION = 1;

function bytesToBase64(bytes: Uint8Array): string {
  return naclUtil.encodeBase64(bytes);
}

function base64ToBytes(value: string): Uint8Array {
  return naclUtil.decodeBase64(value);
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }

  const mimeType = match[1] || 'application/octet-stream';
  const base64 = match[2];
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return { bytes, mimeType };
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType};base64,${globalThis.btoa(binary)}`;
}

async function fetchUriAsBytes(
  uri: string,
  fallbackMimeType = 'application/octet-stream'
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (uri.startsWith('data:')) {
    return dataUrlToBytes(uri);
  }

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error('Failed to read local media');
  }

  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  return {
    bytes: new Uint8Array(arrayBuffer),
    mimeType: blob.type || fallbackMimeType,
  };
}

function encryptBytesWithSecretbox(
  plaintextBytes: Uint8Array
): {
  encryptedBytes: Uint8Array;
  mediaKey: Uint8Array;
  mediaCipherNonce: Uint8Array;
} {
  const mediaKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const mediaCipherNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encryptedBytes = nacl.secretbox(plaintextBytes, mediaCipherNonce, mediaKey);

  return {
    encryptedBytes,
    mediaKey,
    mediaCipherNonce,
  };
}

async function wrapMediaKeyForRecipient(
  mediaKey: Uint8Array,
  recipientUserId: string
): Promise<{
  encryptedMediaKey: string;
  mediaKeyNonce: string;
  senderPublicKey: string;
  senderKeyVersion: number;
}> {
  const wrapped = await encryptTextForRecipient(
    bytesToBase64(mediaKey),
    recipientUserId
  );

  return {
    encryptedMediaKey: wrapped.ciphertext,
    mediaKeyNonce: wrapped.nonce,
    senderPublicKey: wrapped.senderPublicKey,
    senderKeyVersion: wrapped.senderKeyVersion,
  };
}

async function uploadEncryptedBytesToCloudinary(
  encryptedBytes: Uint8Array,
  resourceType: 'image' | 'video' | 'raw',
  mimeType: string
): Promise<{ mediaUrl: string; mediaSizeBytes: number; mediaMimeType: string }> {
  const base64 = bytesToBase64(encryptedBytes);
  const dataUri = `data:${mimeType};base64,${base64}`;

  const formData = new FormData();
  formData.append('file', dataUri);
  formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
  formData.append('cloud_name', CLOUDINARY_CONFIG.cloudName);
  if (resourceType !== 'image') {
    formData.append('resource_type', resourceType);
  }

  const endpoint =
    resourceType === 'image'
      ? `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`
      : `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/${resourceType}/upload`;

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  const json = await response.json();

  if (!response.ok || !json.secure_url) {
    throw new Error(json?.error?.message || 'Encrypted media upload failed');
  }

  return {
    mediaUrl: json.secure_url,
    mediaSizeBytes: encryptedBytes.byteLength,
    mediaMimeType: mimeType,
  };
}

export async function encryptAndUploadImageForRecipient(
  localUri: string,
  recipientUserId: string
): Promise<EncryptedMediaUploadResult> {
  const { bytes, mimeType } = await fetchUriAsBytes(localUri, 'image/jpeg');
  const { encryptedBytes, mediaKey, mediaCipherNonce } = encryptBytesWithSecretbox(bytes);

  const wrappedKey = await wrapMediaKeyForRecipient(mediaKey, recipientUserId);

  const upload = await uploadEncryptedBytesToCloudinary(
    encryptedBytes,
    'image',
    'application/octet-stream'
  );

  return {
    mediaUrl: upload.mediaUrl,
    mediaMimeType: mimeType,
    mediaSizeBytes: upload.mediaSizeBytes,
    encryptedMediaKey: wrappedKey.encryptedMediaKey,
    mediaKeyNonce: wrappedKey.mediaKeyNonce,
    mediaCipherNonce: bytesToBase64(mediaCipherNonce),
    version: MEDIA_E2EE_VERSION,
    senderPublicKey: wrappedKey.senderPublicKey,
    senderKeyVersion: wrappedKey.senderKeyVersion,
  };
}

export async function encryptAndUploadVoiceForRecipient(
  localUri: string,
  recipientUserId: string
): Promise<EncryptedMediaUploadResult> {
  const { bytes, mimeType } = await fetchUriAsBytes(localUri, 'audio/m4a');
  const { encryptedBytes, mediaKey, mediaCipherNonce } = encryptBytesWithSecretbox(bytes);

  const wrappedKey = await wrapMediaKeyForRecipient(mediaKey, recipientUserId);

  const upload = await uploadEncryptedBytesToCloudinary(
    encryptedBytes,
    'raw',
    'application/octet-stream'
  );

  return {
    mediaUrl: upload.mediaUrl,
    mediaMimeType: mimeType,
    mediaSizeBytes: upload.mediaSizeBytes,
    encryptedMediaKey: wrappedKey.encryptedMediaKey,
    mediaKeyNonce: wrappedKey.mediaKeyNonce,
    mediaCipherNonce: bytesToBase64(mediaCipherNonce),
    version: MEDIA_E2EE_VERSION,
    senderPublicKey: wrappedKey.senderPublicKey,
    senderKeyVersion: wrappedKey.senderKeyVersion,
  };
}

export async function decryptMediaToRenderableUri(
  payload: DecryptableMediaPayload & { mediaMimeType?: string }
): Promise<string> {
  const decryptedKeyBase64 = await decryptTextFromSender({
    ciphertext: payload.encryptedMediaKey,
    nonce: payload.mediaKeyNonce,
    senderPublicKey: payload.senderPublicKey,
  });

  const mediaKey = base64ToBytes(decryptedKeyBase64);
  const mediaCipherNonce = base64ToBytes(payload.mediaCipherNonce);

  const response = await fetch(payload.mediaUrl);
  if (!response.ok) {
    throw new Error('Failed to download encrypted media');
  }

  const blob = await response.blob();
  const encryptedBytes = new Uint8Array(await blob.arrayBuffer());

  const opened = nacl.secretbox.open(encryptedBytes, mediaCipherNonce, mediaKey);
  if (!opened) {
    throw new Error('Unable to decrypt media');
  }

  const mimeType = payload.mediaMimeType || 'application/octet-stream';

  if (Platform.OS === 'web') {
    return bytesToDataUrl(opened, mimeType);
  }

  // Native fallback:
  // return data URL as well for now. Some renderers/players may need a temp file path later.
  return bytesToDataUrl(opened, mimeType);
}