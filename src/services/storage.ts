import { createMMKV } from 'react-native-mmkv';

export const storage = createMMKV();

export const Storage = {
  getString:  (key: string)                 => storage.getString(key),
  setString:  (key: string, value: string)  => storage.set(key, value),
  getBoolean: (key: string)                 => storage.getBoolean(key),
  setBoolean: (key: string, value: boolean) => storage.set(key, value),
  getNumber:  (key: string)                 => storage.getNumber(key),
  setNumber:  (key: string, value: number)  => storage.set(key, value),
  delete:     (key: string)                 => storage.delete(key),
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