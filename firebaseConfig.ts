import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, type Persistence } from 'firebase/auth';
import {
  getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

type MMKVStore = {
  getString: (key: string) => string | undefined;
  set:       (key: string, value: string) => void;
  delete:    (key: string) => void;
};

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function getFirebaseConfig() {
  return {
    apiKey:            requireEnv('EXPO_PUBLIC_FIREBASE_API_KEY'),
    authDomain:        requireEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId:         requireEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
    storageBucket:     requireEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requireEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
    appId:             requireEnv('EXPO_PUBLIC_FIREBASE_APP_ID'),
  };
}

const app = getApps().length ? getApp() : initializeApp(getFirebaseConfig());

function getMMKV(): MMKVStore | null {
  try {
    const { MMKV } = require('react-native-mmkv') as { MMKV: new (opts: { id: string }) => MMKVStore };
    return new MMKV({ id: 'firebase-auth' });
  } catch { return null; }
}

function createPersistence(store: MMKVStore): Persistence {
  return {
    type:            'LOCAL',
    _isAvailable:    async () => true,
    _set:            async (key, value) => store.set(key, JSON.stringify(value)),
    _get:            async (key) => { const v = store.getString(key); return v ? JSON.parse(v) : null; },
    _remove:         async (key) => store.delete(key),
    _addListener:    () => {},
    _removeListener: () => {},
  } as Persistence;
}

function createAuth() {
  if (Platform.OS === 'web') return getAuth(app);
  const store = getMMKV();
  if (!store) return getAuth(app);
  try { return initializeAuth(app, { persistence: createPersistence(store) }); }
  catch { return getAuth(app); }
}

function createFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: Platform.OS === 'web'
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : persistentLocalCache({}),
    });
  } catch { return getFirestore(app); }
}

export const auth    = createAuth();
export const db      = createFirestore();
export const storage = getStorage(app);
export { app };

