import { createMMKV } from 'react-native-mmkv';


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
    delete:     key => mmkv.delete(key),
    clearAll:   () => mmkv.clearAll(),
    getAllKeys:  () => mmkv.getAllKeys(),
  };
}


export const appStorage      = createStorage('app-storage');
export const settingsStorage = createStorage('settings-storage');
export const profileStorage  = createStorage('profile-setup-storage');
export const langStorage     = createStorage('language-storage');