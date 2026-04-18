import type * as Notifications from 'expo-notifications';
import { logger } from './logger';

export type NotificationType = 'match' | 'message' | 'like' | 'rating_prompt';

const DUMMY_SUBSCRIPTION: Notifications.EventSubscription = {
  remove: () => {},
};

const VAPID_PUBLIC_KEY =
  'BMothFbf8iMeqOrdqMI2OmY4qWNn1sEvKaXr7MnrYqIW_dAFhxu6tm9XH0m9iF9aKzznDBEdgvO-IhuKGr1N7C0';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      logger.log('[Web Notifications] Not supported in this browser');
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      logger.log('[Web Notifications] Permission denied');
      return null;
    }

    const registration = await navigator.serviceWorker.register(
      '/service-worker.js'
    );
    await navigator.serviceWorker.ready;
    logger.log('[Web Notifications] Service worker ready');

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const token = JSON.stringify(subscription);

    const { auth, db } = await import('../firebaseConfig');
    const { doc, updateDoc } = await import('firebase/firestore');
    const user = auth.currentUser;
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), {
        webPushSubscription: token,
        webPushUpdatedAt: new Date().toISOString(),
      });
      logger.log('[Web Notifications] Subscription saved to Firebase');
    }

    return token;
  } catch (error) {
    logger.error('[Web Notifications] Registration error:', error);
    return null;
  }
}

export async function sendLocalNotification(
  title: string,
  body: string,
  _data?: Record<string, unknown>
): Promise<void> {
  if (Notification.permission === 'granted') {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification(title, {
        body,
        icon: '/icon.png',
      });
    } else {
      new Notification(title, { body, icon: '/icon.png' });
    }
  }
}

export async function sendPushNotification(
  _token: string,
  _title: string,
  _body: string,
  _data?: Record<string, unknown>
): Promise<boolean> {
  logger.log('[Web Notifications] Push sending is handled server-side');
  return true;
}

export async function notifyNewMatch(
  _recipientToken: string,
  _matcherName: string
): Promise<void> {}

export async function notifyNewMessage(
  _recipientToken: string,
  _senderName: string,
  _messagePreview: string
): Promise<void> {}

export async function notifyNewLike(_recipientToken: string): Promise<void> {}

export async function notifyRatingPrompt(
  _recipientToken: string,
  _matchName: string
): Promise<void> {}

export function addNotificationReceivedListener(
  _callback: (notification: Notifications.Notification) => void
): Notifications.EventSubscription {
  return DUMMY_SUBSCRIPTION;
}

export function addNotificationResponseListener(
  _callback: (response: Notifications.NotificationResponse) => void
): Notifications.EventSubscription {
  return DUMMY_SUBSCRIPTION;
}

export async function getBadgeCount(): Promise<number> {
  return 0;
}

export async function setBadgeCount(_count: number): Promise<void> {}

export async function clearAllNotifications(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      const notifications = await registration.getNotifications();
      notifications.forEach((n) => n.close());
    }
  } catch (error) {
    logger.error('[Web Notifications] Clear error:', error);
  }
}