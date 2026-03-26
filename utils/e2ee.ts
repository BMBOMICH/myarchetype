import * as SecureStore from 'expo-secure-store';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { auth, db } from '../firebaseConfig';

const E2EE_PUBLIC_KEY_KEY = 'e2ee_public_key_v1';
const E2EE_SECRET_KEY_KEY = 'e2ee_secret_key_v1';
const E2EE_KEY_VERSION = 1;

export interface LocalE2EEKeypair {
  publicKey: string;
  secretKey: string;
  version: number;
}

export interface StoredE2EEPublicIdentity {
  encryptionPublicKey: string;
  encryptionKeyVersion: number;
}

export interface EncryptedTextPayload {
  ciphertext: string;
  nonce: string;
  version: number;
  senderPublicKey: string;
  senderKeyVersion: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  return naclUtil.encodeBase64(bytes);
}

function base64ToBytes(value: string): Uint8Array {
  return naclUtil.decodeBase64(value);
}

function utf8ToBytes(value: string): Uint8Array {
  return naclUtil.decodeUTF8(value);
}

function bytesToUtf8(bytes: Uint8Array): string {
  return naclUtil.encodeUTF8(bytes);
}

function canUseWebStorage(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && !!window.localStorage;
}

async function setStoredValue(key: string, value: string): Promise<void> {
  if (canUseWebStorage()) {
    window.localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

async function getStoredValue(key: string): Promise<string | null> {
  if (canUseWebStorage()) {
    return window.localStorage.getItem(key);
  }

  return await SecureStore.getItemAsync(key);
}

async function deleteStoredValue(key: string): Promise<void> {
  if (canUseWebStorage()) {
    window.localStorage.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}

export async function generateAndStoreE2EEKeypair(): Promise<LocalE2EEKeypair> {
  const keyPair = nacl.box.keyPair();

  const publicKey = bytesToBase64(keyPair.publicKey);
  const secretKey = bytesToBase64(keyPair.secretKey);

  await Promise.all([
    setStoredValue(E2EE_PUBLIC_KEY_KEY, publicKey),
    setStoredValue(E2EE_SECRET_KEY_KEY, secretKey),
  ]);

  return {
    publicKey,
    secretKey,
    version: E2EE_KEY_VERSION,
  };
}

export async function getLocalE2EEKeypair(): Promise<LocalE2EEKeypair | null> {
  const [publicKey, secretKey] = await Promise.all([
    getStoredValue(E2EE_PUBLIC_KEY_KEY),
    getStoredValue(E2EE_SECRET_KEY_KEY),
  ]);

  if (!publicKey || !secretKey) return null;

  return {
    publicKey,
    secretKey,
    version: E2EE_KEY_VERSION,
  };
}

export async function ensureLocalE2EEKeypair(): Promise<LocalE2EEKeypair> {
  const existing = await getLocalE2EEKeypair();
  if (existing) return existing;
  return generateAndStoreE2EEKeypair();
}

export async function clearLocalE2EEKeys(): Promise<void> {
  await Promise.all([
    deleteStoredValue(E2EE_PUBLIC_KEY_KEY),
    deleteStoredValue(E2EE_SECRET_KEY_KEY),
  ]);
}

export async function getRemoteE2EEPublicKey(
  uid: string
): Promise<StoredE2EEPublicIdentity | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;

  const data = snap.data();
  if (
    typeof data.encryptionPublicKey !== 'string' ||
    data.encryptionPublicKey.length === 0
  ) {
    return null;
  }

  return {
    encryptionPublicKey: data.encryptionPublicKey,
    encryptionKeyVersion:
      typeof data.encryptionKeyVersion === 'number'
        ? data.encryptionKeyVersion
        : E2EE_KEY_VERSION,
  };
}

async function userDocExists(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists();
  } catch (error) {
    console.warn('Failed checking user doc existence for E2EE:', error);
    return false;
  }
}

export async function syncMyE2EEPublicKeyToFirestore(): Promise<{
  success: boolean;
  publicKey?: string;
  error?: string;
  skipped?: boolean;
}> {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const local = await ensureLocalE2EEKeypair();

    const exists = await userDocExists(user.uid);
    if (!exists) {
      return {
        success: true,
        publicKey: local.publicKey,
        skipped: true,
        error: 'User profile document does not exist yet; skipped Firestore sync',
      };
    }

    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          encryptionPublicKey: local.publicKey,
          encryptionKeyVersion: local.version,
          encryptionCreatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return { success: true, publicKey: local.publicKey };
    } catch (error: any) {
      console.error('Failed to sync E2EE public key:', error);
      return {
        success: true,
        publicKey: local.publicKey,
        skipped: true,
        error: error?.message ?? 'Firestore sync skipped',
      };
    }
  } catch (error: any) {
    console.error('Failed to initialize local E2EE identity:', error);
    return {
      success: false,
      error: error?.message ?? 'Unknown error',
    };
  }
}

export async function ensureMyE2EEIdentity(): Promise<{
  success: boolean;
  publicKey?: string;
  error?: string;
  skipped?: boolean;
}> {
  return await syncMyE2EEPublicKeyToFirestore();
}

export async function encryptTextForRecipient(
  plaintext: string,
  recipientUserId: string
): Promise<EncryptedTextPayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  if (!plaintext.trim()) throw new Error('Missing plaintext');

  const [local, remote] = await Promise.all([
    ensureLocalE2EEKeypair(),
    getRemoteE2EEPublicKey(recipientUserId),
  ]);

  if (!remote?.encryptionPublicKey) {
    throw new Error('Recipient has no E2EE public key');
  }

  const senderSecretKey = base64ToBytes(local.secretKey);
  const recipientPublicKey = base64ToBytes(remote.encryptionPublicKey);

  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = utf8ToBytes(plaintext);

  const encrypted = nacl.box(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderSecretKey
  );

  return {
    ciphertext: bytesToBase64(encrypted),
    nonce: bytesToBase64(nonce),
    version: E2EE_KEY_VERSION,
    senderPublicKey: local.publicKey,
    senderKeyVersion: local.version,
  };
}

export async function decryptTextFromSender(payload: {
  ciphertext: string;
  nonce: string;
  senderPublicKey: string;
}): Promise<string> {
  const local = await getLocalE2EEKeypair();
  if (!local) throw new Error('Missing local private key');

  if (!payload.senderPublicKey) {
    throw new Error('Missing sender public key on message');
  }

  const mySecretKey = base64ToBytes(local.secretKey);
  const senderPublicKey = base64ToBytes(payload.senderPublicKey);
  const nonce = base64ToBytes(payload.nonce);
  const ciphertext = base64ToBytes(payload.ciphertext);

  const opened = nacl.box.open(
    ciphertext,
    nonce,
    senderPublicKey,
    mySecretKey
  );

  if (!opened) {
    throw new Error('Unable to decrypt message');
  }

  return bytesToUtf8(opened);
}

export async function canDecryptMessages(): Promise<boolean> {
  const keypair = await getLocalE2EEKeypair();
  return !!keypair?.secretKey;
}