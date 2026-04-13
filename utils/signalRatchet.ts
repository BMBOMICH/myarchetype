import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import type { SessionState } from './signalKeyStore';

const b64Dec = naclUtil.decodeBase64, b64Enc = naclUtil.encodeBase64;

// HKDF-SHA256 using expo-crypto
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, naclUtil.encodeUTF8(naclUtil.encodeBase64(salt)) + naclUtil.encodeUTF8(naclUtil.encodeBase64(ikm)));
  const okm = new Uint8Array(len);
  let t = new Uint8Array(0);
  for (let i = 0; i < Math.ceil(len / 32); i++) {
    const data = new Uint8Array([...t, ...info, new Uint8Array([i + 1])]);
    t = new Uint8Array(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, naclUtil.encodeUTF8(naclUtil.encodeBase64(prk)) + naclUtil.encodeUTF8(naclUtil.encodeBase64(data))));
    okm.set(t, i * 32);
  }
  return okm.slice(0, len);
}

// X3DH Key Agreement
export async function x3dhAgreement(
  myIdPriv: string, myEphemPriv: string,
  theirIdPub: string, theirSignedPub: string, theirOneTimePub?: string
): Promise<Uint8Array> {
  const dh1 = nacl.box.before(b64Dec(theirIdPub), b64Dec(myIdPriv));
  const dh2 = nacl.box.before(b64Dec(theirSignedPub), b64Dec(myEphemPriv));
  const dh3 = nacl.box.before(b64Dec(theirSignedPub), b64Dec(myIdPriv));
  const dh4 = theirOneTimePub ? nacl.box.before(b64Dec(theirOneTimePub), b64Dec(myEphemPriv)) : new Uint8Array(32);
  const combined = new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4]);
  return hkdf(combined, new Uint8Array(32), new TextEncoder().encode('Signal_X3DH'), 64);
}

// AES-GCM via WebCrypto (available in RN 0.83+)
async function aesGcmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }> {
  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const result = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, plaintext);
  const out = new Uint8Array(result);
  return { ciphertext: out.slice(0, -16), tag: out.slice(-16) };
}

async function aesGcmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = new Uint8Array([...ciphertext, ...tag]);
  const result = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, combined);
  return new Uint8Array(result);
}

// Double Ratchet Step
export async function ratchetStep(
  state: SessionState,
  isSender: boolean,
  plaintextOrCiphertext: Uint8Array,
  associatedData?: string
): Promise<{ newState: SessionState; output: Uint8Array; nonce: Uint8Array }> {
  const { rootKey, sendingChainKey, receivingChainKey, sendingMsgCounter, receivingMsgCounter, skippedKeys } = state;
  const chainKey = isSender ? sendingChainKey : receivingChainKey;
  const counter = isSender ? sendingMsgCounter : receivingMsgCounter;

  // Derive message key & next chain key
  const msgKey = await hkdf(new TextEncoder().encode(chainKey), new Uint8Array(0), new TextEncoder().encode('msg_key'), 32);
  const nextChainKey = await hkdf(new TextEncoder().encode(chainKey), new Uint8Array(0), new TextEncoder().encode('chain_key'), 32);

  const nonce = new Uint8Array(12);
  nonce.set(new TextEncoder().encode(counter.toString().padStart(12, '0')));

  let output: Uint8Array;
  if (isSender) {
    const { ciphertext, tag } = await aesGcmEncrypt(msgKey, nonce, plaintextOrCiphertext);
    output = new Uint8Array([...ciphertext, ...tag]);
  } else {
    const tag = plaintextOrCiphertext.slice(-16);
    const ct = plaintextOrCiphertext.slice(0, -16);
    output = await aesGcmDecrypt(msgKey, nonce, ct, tag);
  }

  const newState: SessionState = {
    ...state,
    rootKey,
    sendingChainKey: isSender ? nextChainKey : sendingChainKey,
    receivingChainKey: isSender ? receivingChainKey : nextChainKey,
    sendingMsgCounter: isSender ? counter + 1 : sendingMsgCounter,
    receivingMsgCounter: isSender ? receivingMsgCounter : counter + 1,
    skippedKeys: isSender ? skippedKeys : { ...skippedKeys, [counter.toString()]: b64Enc(msgKey) },
    sendingRatchetPriv: state.sendingRatchetPriv,
    receivingRatchetPub: state.receivingRatchetPub,
  };

  return { newState, output, nonce };
}

// DH Ratchet Update
export async function dhRatchetUpdate(
  state: SessionState,
  isInitiator: boolean,
  receivedPub?: string
): Promise<SessionState> {
  const myPriv = isInitiator ? state.sendingRatchetPriv : naclUtil.encodeBase64(nacl.box.keyPair().secretKey);
  const theirPub = receivedPub || state.receivingRatchetPub;
  const shared = nacl.box.before(b64Dec(theirPub), b64Dec(myPriv));
  const newRoot = await hkdf(new TextEncoder().encode(state.rootKey), shared, new TextEncoder().encode('dh_ratchet'), 64);
  const newChain = await hkdf(newRoot, new Uint8Array(0), new TextEncoder().encode('chain_key'), 32);

  return {
    ...state,
    rootKey: b64Enc(newRoot),
    sendingChainKey: isInitiator ? newChain : state.sendingChainKey,
    receivingChainKey: isInitiator ? state.receivingChainKey : newChain,
    sendingRatchetPriv: myPriv,
    receivingRatchetPub: isInitiator ? theirPub : naclUtil.encodeBase64(nacl.box.keyPair().publicKey),
    sendingMsgCounter: 0,
    receivingMsgCounter: 0,
    skippedKeys: {},
  };
}