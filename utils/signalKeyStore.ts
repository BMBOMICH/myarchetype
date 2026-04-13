import * as SecureStore from 'expo-secure-store';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { db } from '../firebaseConfig';

export const signalStorage = new MMKV({ id: 'signal-protocol-store' });

const getIdKey = (uid: string) => `sig_id_${uid}`;
const getPreKeyPrefix = (uid: string) => `sig_pre_${uid}_`;
const getSessionKey = (uid: string, peer: string) => `sig_sess_${uid}_${peer}`;

export interface IdentityKeyPair { publicKey: string; secretKey: string; }
export interface PreKeyRecord { id: number; publicKey: string; secretKey: string; used: boolean; }
export interface SessionState {
  rootKey: string; sendingChainKey: string; receivingChainKey: string;
  sendingRatchetPriv: string; receivingRatchetPub: string;
  sendingMsgCounter: number; receivingMsgCounter: number;
  skippedKeys: Record<string, string>;
}

export async function ensureIdentityKey(uid: string): Promise<IdentityKeyPair> {
  const raw = await SecureStore.getItemAsync(getIdKey(uid));
  if (raw) return JSON.parse(raw);
  const kp = nacl.box.keyPair();
  const pair = { publicKey: naclUtil.encodeBase64(kp.publicKey), secretKey: naclUtil.encodeBase64(kp.secretKey) };
  await SecureStore.setItemAsync(getIdKey(uid), JSON.stringify(pair));
  return pair;
}

export async function generatePreKeyBundle(uid: string, count = 50): Promise<PreKeyRecord[]> {
  const keys: PreKeyRecord[] = [];
  const batch = [];
  for (let i = 0; i < count; i++) {
    const kp = nacl.box.keyPair();
    const id = Date.now() + i;
    keys.push({ id, publicKey: naclUtil.encodeBase64(kp.publicKey), secretKey: naclUtil.encodeBase64(kp.secretKey), used: false });
    batch.push(setDoc(doc(db, 'users', uid, 'prekeys', id.toString()), { publicKey: naclUtil.encodeBase64(kp.publicKey), used: false, createdAt: serverTimestamp() }));
  }
  await Promise.all(batch);
  return keys;
}

export async function getLocalPreKeyBundle(uid: string): Promise<PreKeyRecord[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'prekeys'), where('used', '==', false)));
  return snap.docs.map(d => ({ id: parseInt(d.id), publicKey: d.data().publicKey, secretKey: '', used: false }));
}

export async function consumePreKey(uid: string, preKeyId: number): Promise<void> {
  signalStorage.set(`${getPreKeyPrefix(uid)}${preKeyId}`, 'used');
  await updateDoc(doc(db, 'users', uid, 'prekeys', preKeyId.toString()), { used: true });
}

export function saveSession(uid: string, peer: string, state: SessionState): void {
  signalStorage.set(getSessionKey(uid, peer), JSON.stringify(state));
}

export function loadSession(uid: string, peer: string): SessionState | null {
  const raw = signalStorage.getString(getSessionKey(uid, peer));
  return raw ? JSON.parse(raw) : null;
}

export function deleteSession(uid: string, peer: string): void {
  signalStorage.delete(getSessionKey(uid, peer));
}