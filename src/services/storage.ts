import { Platform } from 'react-native';
import { Platform } from 'react-native';
let createMMKV: typeof import('react-native-mmkv').createMMKV | null = null;
if (Platform.OS !== 'web') { try { createMMKV = require('react-native-mmkv').createMMKV; } catch {} }
import * as SecureStore from 'expo-secure-store';

const ENCRYPTION_KEY_NAME = 'mmkv_encryption_key';

export const storage = createMMKV();

async function initMMKVEncryption() {
  if (Platform.OS === 'web') return;

  try {
    let key = await SecureStore.getItemAsync(ENCRYPTION_KEY_NAME, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    if (!key) {
      key = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 36).toString(36),
      ).join('');

      await SecureStore.setItemAsync(ENCRYPTION_KEY_NAME, key, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }

    storage.encrypt(key, 'AES-256');
  } catch {
    // Graceful fallback: storage remains unencrypted if key setup fails
  }
}

initMMKVEncryption();

export const Storage = {
  getString:  (key: string)                 => storage.getString(key),
  setString:  (key: string, value: string)  => storage.set(key, value),
  getBoolean: (key: string)                 => storage.getBoolean(key),
  setBoolean: (key: string, value: boolean) => storage.set(key, value),
  getNumber:  (key: string)                 => storage.getNumber(key),
  setNumber:  (key: string, value: number)  => storage.set(key, value),
  delete:     (key: string)                 => storage.remove(key),
  contains:   (key: string)                 => storage.contains(key),

  getObject: <T>(key: string): T | undefined => {
    const raw = storage.getString(key);
    if (!raw) return undefined;
    try   { return JSON.parse(raw) as T; }
    catch { return undefined; }
  },
  setObject: <T>(key: string, value: T): void => {
    storage.set(key, JSON.stringify(value));
  },
};