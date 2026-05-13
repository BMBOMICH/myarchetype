import { getPrepared, LINE_H_BUBBLE } from './constants';
import type { Message } from './types';

export const getErrMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'An unknown error occurred';
};

export function parseMessage(d: { id: string; data: () => Record<string, unknown> }): Message {
  const raw = d.data();
  const ts = raw['timestamp'];
  return {
    id: d.id,
    senderId: typeof raw['senderId'] === 'string' ? raw['senderId'] : '',
    text: typeof raw['text'] === 'string' ? raw['text'] : typeof raw['ciphertext'] === 'string' ? raw['ciphertext'] : '',
    timestamp: ts != null && typeof (ts as { toDate?: unknown }).toDate === 'function' ? (ts as { toDate: () => Date }).toDate() : null,
    read: typeof raw['read'] === 'boolean' ? raw['read'] : false,
    type: (raw['messageType'] as Message['type']) ?? (raw['isGif'] === true ? 'gif' : 'text'),
    mediaUrl: typeof raw['mediaUrl'] === 'string' ? raw['mediaUrl'] : undefined,
    mediaMimeType: typeof raw['mediaMimeType'] === 'string' ? raw['mediaMimeType'] : undefined,
    mediaSizeBytes: typeof raw['mediaSizeBytes'] === 'number' ? raw['mediaSizeBytes'] : undefined,
    reactions: Array.isArray(raw['reactions']) ? (raw['reactions'] as Message['reactions']) : [],
    pinned: typeof raw['pinned'] === 'boolean' ? raw['pinned'] : false,
    translatedText: typeof raw['translatedText'] === 'string' ? raw['translatedText'] : undefined,
    isTranslating: typeof raw['isTranslating'] === 'boolean' ? raw['isTranslating'] : false,
    voiceDuration: typeof raw['voiceDuration'] === 'number' ? raw['voiceDuration'] : undefined,
    voiceWaveform: Array.isArray(raw['voiceWaveform']) ? (raw['voiceWaveform'] as number[]) : undefined,
    encryptedMediaKey: typeof raw['encryptedMediaKey'] === 'string' ? raw['encryptedMediaKey'] : undefined,
    mediaKeyNonce: typeof raw['mediaKeyNonce'] === 'string' ? raw['mediaKeyNonce'] : undefined,
    mediaCipherNonce: typeof raw['mediaCipherNonce'] === 'string' ? raw['mediaCipherNonce'] : undefined,
    version: typeof raw['version'] === 'number' ? raw['version'] : undefined,
    ciphertext: typeof raw['ciphertext'] === 'string' ? raw['ciphertext'] : undefined,
    nonce: typeof raw['nonce'] === 'string' ? raw['nonce'] : undefined,
    senderPublicKey: typeof raw['senderPublicKey'] === 'string' ? raw['senderPublicKey'] : undefined,
    senderKeyVersion: typeof raw['senderKeyVersion'] === 'number' ? raw['senderKeyVersion'] : undefined,
    isGif: typeof raw['isGif'] === 'boolean' ? raw['isGif'] : false,
  };
}

export function estimateMessageHeight(msg: Message, isMine: boolean, showDateSep: boolean): number {
  let total = showDateSep ? 36 : 0;
  if (msg.type === 'system') return total + 36 + 2;
  if (msg.type === 'image' || msg.type === 'gif') return total + 180 + 20 + 24 + 2;
  if (msg.type === 'voice') return total + 48 + 20 + 24 + 2;

  const text = msg.translatedText ?? msg.text ?? '';
  let textH = 0;
  if (text.length > 0) {
    const availableW = isMine ? 0.75 : 0.75 - 30;
    const prepared = getPrepared(text);
    const result = pretextLayout(prepared, availableW - 20, LINE_H_BUBBLE);
    textH = result.height;
  }
  const reactionsH = (msg.reactions?.length ?? 0) > 0 ? 28 : 0;
  const pinnedH = msg.pinned ? 16 : 0;
  total += 20 + textH + 24 + reactionsH + pinnedH + 2;
  return total;
}

export function buildHeightCache(messages: Message[], userId: string): Map<string, number> {
  const cache = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const prev = messages[i - 1];
    const isMine = msg.senderId === userId;
    const showDateSep = !prev || !prev.timestamp || !msg.timestamp
      ? i === 0
      : msg.timestamp.getTime() - prev.timestamp.getTime() > 300_000;
    cache.set(msg.id, estimateMessageHeight(msg, isMine, showDateSep));
  }
  return cache;
}