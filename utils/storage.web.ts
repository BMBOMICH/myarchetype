/**
 * Web storage implementation using localStorage.
 * Must match StorageAdapter from storage.native.ts exactly —
 * Metro picks the right file at bundle time; TypeScript sees one interface.
 */

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
  const prefix = `${id}:`;

  const raw = (key: string): string | null => {
    try   { return localStorage.getItem(prefix + key); }
    catch { return null; }
  };

  return {
    getString: raw,

    getBoolean: (key) => {
      const v = raw(key);
      if (v === null)    return undefined;
      if (v === 'true')  return true;
      if (v === 'false') return false;
      return undefined;
    },

    getNumber: (key) => {
      const v = raw(key);
      if (v === null) return undefined;
      const n = Number(v);
      return Number.isNaN(n) ? undefined : n;
    },

    set: (key, value) => {
      try { localStorage.setItem(prefix + key, String(value)); } catch {}
    },

    delete: (key) => {
      try { localStorage.removeItem(prefix + key); } catch {}
    },

    clearAll: () => {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .forEach((k) => localStorage.removeItem(k));
      } catch {}
    },

    getAllKeys: () => {
      try {
        return Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .map((k)    => k.slice(prefix.length));
      } catch { return []; }
    },
  };
}

export const appStorage      = createStorage('app-storage');
export const settingsStorage = createStorage('settings-storage');
export const profileStorage  = createStorage('profile-setup-storage');
export const langStorage     = createStorage('language-storage');