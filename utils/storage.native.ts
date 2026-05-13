import { Platform } from 'react-native';
let createMMKV: typeof import('react-native-mmkv').createMMKV | null = null;
if (Platform.OS !== 'web') { try { createMMKV = require('react-native-mmkv').createMMKV; } catch {} }

export interface StorageAdapter {
  getString:  (key: string) => string | null;
  getBoolean: (key: string) => boolean | undefined;
  getNumber:  (key: string) => number | undefined;
  set:        (key: string, value: string | boolean | number) => void;
  delete:     (key: string) => void;
  clearAll:   () => void;
  getAllKeys:  () => string[];
}

export function createStorage(id: string): StorageAdapter {
  const mmkv = createMMKV({ id });

  return {
    getString:  key => mmkv.getString(key) ?? null,
    getBoolean: key => mmkv.getBoolean(key),
    getNumber:  key => mmkv.getNumber(key),
    set:        (key, value) => mmkv.set(key, value),
    delete:     key => mmkv.remove(key),
    clearAll:   () => mmkv.clearAll(),
    getAllKeys:  () => mmkv.getAllKeys(),
  };
}

export const appStorage      = createStorage('app-storage');
export const settingsStorage = createStorage('settings-storage');
export const profileStorage  = createStorage('profile-setup-storage');
export const langStorage     = createStorage('language-storage');
