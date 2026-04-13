import * as Notifications from 'expo-notifications';
import { doc, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';

type WebPushSubscriptionData = Record<string, unknown>;

interface SimpleStorage {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
}

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? '';

function createStorage(): SimpleStorage {
  if (Platform.OS === 'web') {
    return {
      getString: key => (typeof window !== 'undefined' ? window.localStorage?.getItem(key) : null) ?? undefined,
      set: (key, value) => { if (typeof window !== 'undefined') window.localStorage?.setItem(key, value); },
    };
  }
  try {
    const { MMKV } = require('react-native-mmkv') as { MMKV: new (opts: { id: string }) => SimpleStorage };
    return new MMKV({ id: 'notifications' });
  } catch {
    const mem: Record<string, string> = {};
    return { getString: key => mem[key], set: (key, value) => { mem[key] = value; } };
  }
}

const storage = createStorage();

function toUint8Array(base64Url: string) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof atob === 'function' ? atob(base64) : '';
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch (e) {
    logger.warn('[notifications] Failed to get auth token:', e);
  }
  return headers;
}

async function saveUserFields(fields: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, 'users', user.uid), fields);
  } catch (e) {
    logger.error('[notifications] saveUserFields:', e);
  }
}

async function post(path: string, body: Record<string, unknown>) {
  if (!SERVER_URL) throw new Error('Missing EXPO_PUBLIC_SERVER_URL / EXPO_PUBLIC_FUNCTIONS_URL');
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    storage.set('expoPushToken', token);
    await saveUserFields({ pushToken: token, pushTokenUpdatedAt: new Date().toISOString() });
    return token;
  } catch (e) {
    logger.error('[notifications] registerForPushNotifications:', e);
    return null;
  }
}

export async function sendMobilePushNotification({
  expoPushToken, title, body, screen,
}: {
  expoPushToken: string;
  title: string;
  body: string;
  screen: string;
}): Promise<void> {
  try {
    await post('/send-expo-notification', { expoPushToken, title, body, screen });
  } catch (e) {
    logger.error('[notifications] sendMobilePushNotification:', e);
  }
}

export async function registerWebPush(): Promise<void> {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const vapidKey = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey || vapidKey === 'your-new-public-key') return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toUint8Array(vapidKey),
    });
    const subscriptionJson = JSON.stringify(subscription);
    storage.set('webPushSubscription', subscriptionJson);
    await saveUserFields({ webPushSubscription: subscriptionJson });
  } catch (e) {
    logger.error('[notifications] registerWebPush:', e);
  }
}

export async function sendWebPushNotification({
  subscription, title, body, screen,
}: {
  subscription: WebPushSubscriptionData;
  title: string;
  body: string;
  screen: string;
}): Promise<void> {
  try {
    await post('/send-notification', { subscription, title, body, screen });
  } catch (e) {
    logger.error('[notifications] sendWebPushNotification:', e);
  }
}

export async function sendPushNotification({
  title, body, screen, expoPushToken, webSubscription,
}: {
  title: string;
  body: string;
  screen: string;
  expoPushToken?: string;
  webSubscription?: WebPushSubscriptionData;
}): Promise<void> {
  if (expoPushToken) await sendMobilePushNotification({ expoPushToken, title, body, screen });
  if (webSubscription) await sendWebPushNotification({ subscription: webSubscription, title, body, screen });
}