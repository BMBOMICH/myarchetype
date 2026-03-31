export interface StorageAdapter {
  getString: (key: string) => string | null;
  getBoolean: (key: string) => boolean | undefined;
  getNumber: (key: string) => number | undefined;
  set: (key: string, value: string | boolean | number) => void;
  delete: (key: string) => void;
  clearAll: () => void;
  getAllKeys: () => string[];
}

const hasDocument = typeof document !== 'undefined';
const mem = new Map<string, Map<string, string>>();

function getMemStore(id: string) {
  if (!mem.has(id)) mem.set(id, new Map());
  return mem.get(id)!;
}

function readCookies() {
  if (!hasDocument || !document.cookie) return [];
  return document.cookie.split('; ').filter(Boolean);
}

function secureAttr() {
  return typeof location !== 'undefined' && location.protocol === 'https:' ? '; secure' : '';
}

export function createStorage(id: string): StorageAdapter {
  const prefix = `${encodeURIComponent(id)}__`;
  const store = getMemStore(id);
  const cookieName = (key: string) => `${prefix}${encodeURIComponent(key)}`;
  const decodeKey = (name: string) => decodeURIComponent(name.slice(prefix.length));

  const getCookie = (name: string) => {
    for (const part of readCookies()) {
      const idx = part.indexOf('=');
      const key = idx === -1 ? part : part.slice(0, idx);
      if (key === name) return decodeURIComponent(idx === -1 ? '' : part.slice(idx + 1));
    }
    return null;
  };

  const setCookie = (name: string, value: string) => {
    if (!hasDocument) return;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax${secureAttr()}`;
  };

  const delCookie = (name: string) => {
    if (!hasDocument) return;
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax${secureAttr()}`;
  };

  const raw = (key: string) => {
    const name = cookieName(key);
    if (hasDocument) return getCookie(name);
    return store.get(key) ?? null;
  };

  return {
    getString: raw,
    getBoolean: key => {
      const v = raw(key);
      if (v === null) return undefined;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    },
    getNumber: key => {
      const v = raw(key);
      if (v === null) return undefined;
      const n = Number(v);
      return Number.isNaN(n) ? undefined : n;
    },
    set: (key, value) => {
      const str = String(value);
      if (hasDocument) setCookie(cookieName(key), str);
      else store.set(key, str);
    },
    delete: key => {
      if (hasDocument) delCookie(cookieName(key));
      else store.delete(key);
    },
    clearAll: () => {
      if (hasDocument) {
        for (const part of readCookies()) {
          const idx = part.indexOf('=');
          const key = idx === -1 ? part : part.slice(0, idx);
          if (key.startsWith(prefix)) delCookie(key);
        }
      } else {
        store.clear();
      }
    },
    getAllKeys: () => {
      if (hasDocument) {
        return readCookies()
          .map(part => {
            const idx = part.indexOf('=');
            return idx === -1 ? part : part.slice(0, idx);
          })
          .filter(key => key.startsWith(prefix))
          .map(decodeKey);
      }
      return [...store.keys()];
    },
  };
}

export const appStorage = createStorage('app-storage');
export const settingsStorage = createStorage('settings-storage');
export const profileStorage = createStorage('profile-setup-storage');
export const langStorage = createStorage('language-storage');