// utils/e2ee.ts
import * as SecureStore from 'expo-secure-store';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

const PUB_KEY   = 'e2ee_public_key_v1';
const SEC_KEY   = 'e2ee_secret_key_v1';
const KEY_VER   = 1;
const IS_WEB    = Platform.OS === 'web';
const DB_NAME   = 'myarchetype-e2ee';
const STORE_NAME = 'kv';
const webMem    = new Map<string, string>();

export interface LocalE2EEKeypair       { publicKey: string; secretKey: string; version: number; }
export interface StoredE2EEPublicIdentity { encryptionPublicKey: string; encryptionKeyVersion: number; }
export interface EncryptedTextPayload   { ciphertext: string; nonce: string; version: number; senderPublicKey: string; senderKeyVersion: number; }

const b64Enc     = naclUtil.encodeBase64;
const b64Dec     = naclUtil.decodeBase64;
const utf8Enc    = naclUtil.decodeUTF8;
const utf8Dec    = naclUtil.encodeUTF8;
const getErrMsg  = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;
const canUseIndexedDB = () => IS_WEB && typeof indexedDB !== 'undefined';

function openWebDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const dbx = req.result;
      if (!dbx.objectStoreNames.contains(STORE_NAME)) dbx.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbGet(key: string): Promise<string | null> {
  const dbx = await openWebDb();
  return new Promise((resolve, reject) => {
    const tx  = dbx.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess  = () => resolve(typeof req.result === 'string' ? req.result : null);
    req.onerror    = () => reject(req.error ?? new Error('IndexedDB read failed'));
    tx.oncomplete  = () => dbx.close();
    tx.onabort     = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function idbSet(key: string, value: string): Promise<void> {
  const dbx = await openWebDb();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => { dbx.close(); resolve(); };
    tx.onerror    = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.onabort    = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function idbDelete(key: string): Promise<void> {
  const dbx = await openWebDb();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => { dbx.close(); resolve(); };
    tx.onerror    = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    tx.onabort    = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function setVal(key: string, value: string): Promise<void> {
  if (canUseIndexedDB()) { await idbSet(key, value); return; }
  if (IS_WEB)            { webMem.set(key, value);   return; }
  await SecureStore.setItemAsync(key, value);
}

async function getVal(key: string): Promise<string | null> {
  if (canUseIndexedDB()) return idbGet(key);
  if (IS_WEB)            return webMem.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function delVal(key: string): Promise<void> {
  if (canUseIndexedDB()) { await idbDelete(key);  return; }
  if (IS_WEB)            { webMem.delete(key);    return; }
  await SecureStore.deleteItemAsync(key);
}

export async function generateAndStoreE2EEKeypair(): Promise<LocalE2EEKeypair> {
  const kp        = nacl.box.keyPair();
  const publicKey = b64Enc(kp.publicKey);
  const secretKey = b64Enc(kp.secretKey);
  await Promise.all([setVal(PUB_KEY, publicKey), setVal(SEC_KEY, secretKey)]);
  return { publicKey, secretKey, version: KEY_VER };
}

export async function getLocalE2EEKeypair(): Promise<LocalE2EEKeypair | null> {
  const [publicKey, secretKey] = await Promise.all([getVal(PUB_KEY), getVal(SEC_KEY)]);
  return publicKey && secretKey ? { publicKey, secretKey, version: KEY_VER } : null;
}

export async function ensureLocalE2EEKeypair(): Promise<LocalE2EEKeypair> {
  return (await getLocalE2EEKeypair()) ?? generateAndStoreE2EEKeypair();
}

export async function clearLocalE2EEKeys(): Promise<void> {
  await Promise.all([delVal(PUB_KEY), delVal(SEC_KEY)]);
}

export async function rotateE2EEKeys(): Promise<{ success: boolean; publicKey?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not authenticated' };
  try {
    await clearLocalE2EEKeys();
    const kp = await generateAndStoreE2EEKeypair();
    await setDoc(doc(db, 'users', user.uid), {
      encryptionPublicKey:  kp.publicKey,
      encryptionKeyVersion: kp.version,
      encryptionCreatedAt:  serverTimestamp(),
      encryptionRotatedAt:  serverTimestamp(),
    }, { merge: true });
    await appendKeyTransparencyLog(user.uid, kp.publicKey, 'rotation');
    return { success: true, publicKey: kp.publicKey };
  } catch (e) {
    return { success: false, error: getErrMsg(e, 'Rotation failed') };
  }
}

export function computeKeyFingerprint(publicKeyBase64: string): string {
  const bytes = b64Dec(publicKeyBase64);
  return Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(':');
}

export async function verifyKeyIntegrity(remotePublicKey: string): Promise<{ match: boolean; localFingerprint: string; remoteFingerprint: string }> {
  const local            = await getLocalE2EEKeypair();
  const localFingerprint = local ? computeKeyFingerprint(local.publicKey) : '';
  const remoteFingerprint = computeKeyFingerprint(remotePublicKey);
  return { match: localFingerprint === remoteFingerprint, localFingerprint, remoteFingerprint };
}

export async function appendKeyTransparencyLog(
  userId: string, publicKey: string,
  event: 'initial' | 'rotation' | 'device_added',
): Promise<{ success: boolean; logId?: string }> {
  try {
    const { addDoc, collection } = await import('firebase/firestore');
    const logRef = await addDoc(collection(db, 'keyTransparencyLog'), {
      userId, publicKey, fingerprint: computeKeyFingerprint(publicKey),
      event, version: KEY_VER, timestamp: serverTimestamp(),
    });
    return { success: true, logId: logRef.id };
  } catch (err) {
    logger.error('[e2ee] Key transparency log failed:', err);
    return { success: false };
  }
}

export async function getKeyTransparencyLog(userId: string): Promise<Array<{ fingerprint: string; event: string; timestamp: unknown }>> {
  try {
    const { collection, query, where, orderBy, getDocs } = await import('firebase/firestore');
    const q    = query(collection(db, 'keyTransparencyLog'), where('userId', '==', userId), orderBy('timestamp', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(docSnap => {
      const data = docSnap.data() as { fingerprint?: string; event?: string; timestamp?: unknown };
      return {
        fingerprint: typeof data.fingerprint === 'string' ? data.fingerprint : '',
        event:       typeof data.event       === 'string' ? data.event       : '',
        timestamp:   data.timestamp,
      };
    });
  } catch (err) {
    logger.error('[e2ee] Get transparency log failed:', err);
    return [];
  }
}

export const keyTransparency  = getKeyTransparencyLog;
export const KeyTransparency  = getKeyTransparencyLog;
export const verifiableLog    = appendKeyTransparencyLog;

export async function getRemoteE2EEPublicKey(uid: string): Promise<StoredE2EEPublicIdentity | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data() as { encryptionPublicKey?: unknown; encryptionKeyVersion?: unknown };
  if (typeof data.encryptionPublicKey !== 'string' || !data.encryptionPublicKey) return null;
  return {
    encryptionPublicKey:  data.encryptionPublicKey,
    encryptionKeyVersion: typeof data.encryptionKeyVersion === 'number' ? data.encryptionKeyVersion : KEY_VER,
  };
}

async function userDocExists(uid: string): Promise<boolean> {
  try { return (await getDoc(doc(db, 'users', uid))).exists(); }
  catch (err) { logger.warn('[e2ee] userDocExists check failed:', err); return false; }
}

export async function syncMyE2EEPublicKeyToFirestore(): Promise<{ success: boolean; publicKey?: string; error?: string; skipped?: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not authenticated' };
  try {
    const local = await ensureLocalE2EEKeypair();
    if (!(await userDocExists(user.uid))) {
      return { success: true, publicKey: local.publicKey, skipped: true, error: 'No user doc yet' };
    }
    try {
      await setDoc(doc(db, 'users', user.uid), {
        encryptionPublicKey:  local.publicKey,
        encryptionKeyVersion: local.version,
        encryptionCreatedAt:  serverTimestamp(),
      }, { merge: true });
      await appendKeyTransparencyLog(user.uid, local.publicKey, 'initial');
      return { success: true, publicKey: local.publicKey };
    } catch (e) {
      return { success: true, publicKey: local.publicKey, skipped: true, error: getErrMsg(e, 'Sync skipped') };
    }
  } catch (e) {
    return { success: false, error: getErrMsg(e, 'Sync failed') };
  }
}

export const ensureMyE2EEIdentity = syncMyE2EEPublicKeyToFirestore;

export async function scanBeforeEncrypt(plaintext: string): Promise<{ safe: boolean; reason?: string }> {
  const { checkTextSafety } = await import('./moderation');
  const result = checkTextSafety(plaintext, 'chat');
  return { safe: result.safe, reason: result.safe ? undefined : result.reason };
}

export async function encryptTextForRecipient(plaintext: string, recipientUserId: string): Promise<EncryptedTextPayload> {
  const user = auth.currentUser;
  if (!user)              throw new Error('Not authenticated');
  if (!plaintext.trim())  throw new Error('Missing plaintext');
  const scanResult = await scanBeforeEncrypt(plaintext);
  if (!scanResult.safe)   throw new Error(`Content blocked: ${scanResult.reason}`);
  const [local, remote] = await Promise.all([ensureLocalE2EEKeypair(), getRemoteE2EEPublicKey(recipientUserId)]);
  if (!remote?.encryptionPublicKey) throw new Error('Recipient has no E2EE public key');
  const nonce     = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(utf8Enc(plaintext), nonce, b64Dec(remote.encryptionPublicKey), b64Dec(local.secretKey));
  return { ciphertext: b64Enc(encrypted), nonce: b64Enc(nonce), version: KEY_VER, senderPublicKey: local.publicKey, senderKeyVersion: local.version };
}

export async function decryptTextFromSender(payload: { ciphertext: string; nonce: string; senderPublicKey: string }): Promise<string> {
  const local = await getLocalE2EEKeypair();
  if (!local)                   throw new Error('Missing local private key');
  if (!payload.senderPublicKey) throw new Error('Missing sender public key');
  const opened = nacl.box.open(b64Dec(payload.ciphertext), b64Dec(payload.nonce), b64Dec(payload.senderPublicKey), b64Dec(local.secretKey));
  if (!opened) throw new Error('Unable to decrypt message');
  return utf8Dec(opened);
}

export async function canDecryptMessages(): Promise<boolean> {
  return !!(await getLocalE2EEKeypair())?.secretKey;
}