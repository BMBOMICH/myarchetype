import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const storage = new MMKV({ id: 'notifications' });

// ✅ Replace with your Render.com URL
const SERVER_URL = 'https://myarchetype-server.onrender.com';

// ─── Expo Push (iOS + Android) ────────────────────────────────────────────────

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission denied');
    return null;
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  storage.set('expoPushToken', token);
  return token;
}

export async function sendMobilePushNotification({
  expoPushToken,
  title,
  body,
  screen,
}: {
  expoPushToken: string;
  title: string;
  body: string;
  screen: string;
}): Promise<void> {
  await fetch(`${SERVER_URL}/send-expo-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expoPushToken, title, body, screen }),
  });
}

// ─── Web Push (Browsers) ──────────────────────────────────────────────────────

export async function registerWebPush(): Promise<void> {
  if (Platform.OS !== 'web') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const registration = await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY,
  });

  // Save subscription to Firestore
  storage.set('webPushSubscription', JSON.stringify(subscription));
}

export async function sendWebPushNotification({
  subscription,
  title,
  body,
  screen,
}: {
  subscription: PushSubscription;
  title: string;
  body: string;
  screen: string;
}): Promise<void> {
  await fetch(`${SERVER_URL}/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, title, body, screen }),
  });
}

// ─── Send to Any Platform ─────────────────────────────────────────────────────

export async function sendPushNotification({
  title,
  body,
  screen,
  expoPushToken,
  webSubscription,
}: {
  title: string;
  body: string;
  screen: string;
  expoPushToken?: string;
  webSubscription?: PushSubscription;
}): Promise<void> {
  if (expoPushToken) {
    await sendMobilePushNotification({ expoPushToken, title, body, screen });
  }

  if (webSubscription) {
    await sendWebPushNotification({ subscription: webSubscription, title, body, screen });
  }
}