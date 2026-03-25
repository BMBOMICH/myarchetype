/**
 * Firebase initialisation — works on iOS, Android, and Web.
 *
 * • On native the auth instance uses MMKV-backed persistence
 *   so sessions survive app restarts (faster than AsyncStorage).
 * • On web, getAuth already defaults to indexedDB / localStorage.
 * • Firestore uses persistent local cache for offline support.
 * • Both the app and auth singletons are safe to re-import after a
 *   React-Native hot-reload.
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
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
import { MMKV } from 'react-native-mmkv';

// ─── MMKV Storage (replaces AsyncStorage) ────────────────────────────────────

const mmkvStorage = new MMKV({ id: 'firebase-auth' });

const mmkvPersistence = {
  getItem: (key: string): string | null => {
    return mmkvStorage.getString(key) ?? null;
  },
  setItem: (key: string, value: string): void => {
    mmkvStorage.set(key, value);
  },
  removeItem: (key: string): void => {
    mmkvStorage.delete(key);
  },
};

// ─── Configuration ───────────────────────────────────────────────────────────
// These values are client-side identifiers (not secrets). They are safe to
// ship in the bundle; access is governed by Firestore Security Rules and
// Firebase App Check.

const firebaseConfig = {
  apiKey:
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY ??
    'AIzaSyAZPv64XqCW5x6OEzSfEQZCSUfjD8m46h0',
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    'myarchetype-b2ba0.firebaseapp.com',
  projectId:
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ??
    'myarchetype-b2ba0',
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    'myarchetype-b2ba0.firebasestorage.app',
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??
    '460955155446',
  appId:
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID ??
    '1:460955155446:web:0809c96ab99cd5b9c0e5d7',
} as const;

// ─── App ─────────────────────────────────────────────────────────────────────

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// ─── Auth (platform-aware persistence) ───────────────────────────────────────

function createAuth() {
  // On web, getAuth() auto-selects the best browser persistence.
  if (Platform.OS === 'web') {
    return getAuth(app);
  }

  // On native, use MMKV so sessions persist across app restarts.
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(mmkvPersistence),
    });
  } catch {
    // initializeAuth throws if called twice (e.g. after hot-reload).
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
    // initializeFirestore throws if called twice (e.g. after hot-reload).
    return getFirestore(app);
  }
}

export const db = createFirestore();

// ─── Storage ─────────────────────────────────────────────────────────────────

export const storage = getStorage(app);

// ─── Export App ──────────────────────────────────────────────────────────────

export { app };

