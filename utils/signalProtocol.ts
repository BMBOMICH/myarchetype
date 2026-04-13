import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { auth } from '../firebaseConfig';
import { decryptTextFromSender, encryptTextForRecipient as naclEncrypt } from './e2ee';
import { consumePreKey, ensureIdentityKey, getLocalPreKeyBundle, loadSession, saveSession, type SessionState } from './signalKeyStore';
import { dhRatchetUpdate, ratchetStep, x3dhAgreement } from './signalRatchet';

const b64Dec = naclUtil.decodeBase64, b64Enc = naclUtil.encodeBase64;
const utf8Enc = naclUtil.decodeUTF8, utf8Dec = naclUtil.encodeUTF8;

export interface SignalPayload {
  ciphertext: string; nonce: string; version: 2; senderPublicKey: string; senderKeyVersion: number;
  ephemeralPub: string; preKeyId?: number; chainKeyUpdate?: string;
}

export async function ensureSignalIdentity(): Promise<void> {
  const user = auth.currentUser; if (!user) return;
  await ensureIdentityKey(user.uid);
}

export async function establishSignalSession(recipientId: string): Promise<SessionState | null> {
  const user = auth.currentUser; if (!user) return null;
  const myId = await ensureIdentityKey(user.uid);
  const preKeys = await getLocalPreKeyBundle(recipientId);
  if (!preKeys.length) return null;

  const preKey = preKeys[0]!;
  const ephemeral = nacl.box.keyPair();
  const shared = await x3dhAgreement(myId.secretKey, b64Enc(ephemeral.secretKey), preKey.publicKey, preKey.publicKey);
  const rootKey = shared.slice(0, 32);
  const chainKey = shared.slice(32, 64);

  const state: SessionState = {
    rootKey: b64Enc(rootKey),
    sendingChainKey: b64Enc(chainKey),
    receivingChainKey: b64Enc(chainKey),
    sendingRatchetPriv: b64Enc(ephemeral.secretKey),
    receivingRatchetPub: preKey.publicKey,
    sendingMsgCounter: 0, receivingMsgCounter: 0, skippedKeys: {},
  };
  saveSession(user.uid, recipientId, state);
  await consumePreKey(recipientId, preKey.id);
  return state;
}

export async function encryptSignalText(plaintext: string, recipientId: string): Promise<SignalPayload | null> {
  const user = auth.currentUser; if (!user) return null;
  let state = loadSession(user.uid, recipientId);
  if (!state) {
    state = await establishSignalSession(recipientId);
    if (!state) return null;
  }

  const { newState, output, nonce } = await ratchetStep(state, true, utf8Enc(plaintext));
  saveSession(user.uid, recipientId, newState);

  const ephemeralPub = naclUtil.encodeBase64(nacl.box.keyPair().publicKey);
  return {
    ciphertext: b64Enc(output), nonce: b64Enc(nonce), version: 2,
    senderPublicKey: (await ensureIdentityKey(user.uid)).publicKey, senderKeyVersion: 2,
    ephemeralPub, preKeyId: undefined, chainKeyUpdate: undefined,
  };
}

export async function decryptSignalText(payload: SignalPayload, senderId: string): Promise<string | null> {
  const user = auth.currentUser; if (!user) return null;
  let state = loadSession(user.uid, senderId);
  if (!state) {
    state = await establishSignalSession(senderId);
    if (!state) return null;
  }

  if (payload.ephemeralPub && payload.ephemeralPub !== state.receivingRatchetPub) {
    state = await dhRatchetUpdate(state, false, payload.ephemeralPub);
  }

  const { newState, output } = await ratchetStep(state, false, b64Dec(payload.ciphertext));
  saveSession(user.uid, senderId, newState);
  return utf8Dec(output);
}

// 🔀 Migration Router
export async function encryptTextForRecipient(plaintext: string, recipientId: string) {
  const sig = await encryptSignalText(plaintext, recipientId);
  if (sig) return sig;
  return naclEncrypt(plaintext, recipientId); // Fallback to v1
}

export async function decryptTextFromSender(payload: { ciphertext: string; nonce: string; senderPublicKey: string; version?: number }, senderId: string) {
  if (payload.version === 2) {
    const res = await decryptSignalText(payload as SignalPayload, senderId);
    if (res) return res;
  }
  return decryptTextFromSender(payload); // Fallback to v1
}