/**
 * Firebase initialisation — works on iOS, Android, and Web.
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

// ─── Dev warning for missing env keys ────────────────────────────────────────

if (__DEV__ && !process.env.EXPO_PUBLIC_FIREBASE_API_KEY) {
  console.warn(
    '[firebaseConfig] Using hardcoded Firebase keys. ' +
    'Set EXPO_PUBLIC_FIREBASE_* in your .env file for production.',
  );
}

// ─── Configuration ───────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY            ?? 'AIzaSyAZPv64XqCW5x6OEzSfEQZCSUfjD8m46h0',
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN        ?? 'myarchetype-b2ba0.firebaseapp.com',
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID         ?? 'myarchetype-b2ba0',
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET     ?? 'myarchetype-b2ba0.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '460955155446',
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID             ?? '1:460955155446:web:0809c96ab99cd5b9c0e5d7',
} as const;

// ─── App ─────────────────────────────────────────────────────────────────────

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// ─── Auth (platform-aware persistence via MMKV) ─────────────────────────────

function createAuth() {
  if (Platform.OS === 'web') {
    return getAuth(app);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mmkvModule = require('react-native-mmkv');
    const MMKVClass = mmkvModule.MMKV ?? mmkvModule.default;
    const mmkv = new MMKVClass({ id: 'firebase-auth' });

    return initializeAuth(app, {
      persistence: {
        type: 'LOCAL' as const,
        _get: async (key: string) => {
          const value = mmkv.getString(key);
          return value ? JSON.parse(value) : null;
        },
        _set: async (key: string, value: unknown) => {
          mmkv.set(key, JSON.stringify(value));
        },
        _remove: async (key: string) => {
          mmkv.delete(key);
        },
        _addListener: () => {},
        _removeListener: () => {},
      },
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();

// ─── Firestore (with offline persistence) ────────────────────────────────────

function createFirestore() {
  try {
    if (Platform.OS === 'web') {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    }

    return initializeFirestore(app, {
      localCache: persistentLocalCache({}),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createFirestore();

// ─── Storage ─────────────────────────────────────────────────────────────────

export const storage = getStorage(app);

export { app };

