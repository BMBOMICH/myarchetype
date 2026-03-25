import type * as Notifications from 'expo-notifications';

// ─── Types ────────────────────────────────────────────────
export type NotificationType = 'match' | 'message' | 'like' | 'rating_prompt';

// ─── Dummy subscription ───────────────────────────────────
const DUMMY_SUBSCRIPTION: Notifications.EventSubscription = {
  remove: () => {},
};

// ─── VAPID public key ─────────────────────────────────────
const VAPID_PUBLIC_KEY =
  'BMothFbf8iMeqOrdqMI2OmY4qWNn1sEvKaXr7MnrYqIW_dAFhxu6tm9XH0m9iF9aKzznDBEdgvO-IhuKGr1N7C0';

// ─── Helper ───────────────────────────────────────────────
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

// ─── Register for web push notifications ─────────────────
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    // Check browser support
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('[Web Notifications] Not supported in this browser');
      return null;
    }

    // Check/request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('[Web Notifications] Permission denied');
      return null;
    }

    // Register service worker
    const registration = await navigator.serviceWorker.register(
      '/service-worker.js'
    );
    await navigator.serviceWorker.ready;
    console.log('[Web Notifications] Service worker ready');

    // Check for existing subscription first
    let subscription = await registration.pushManager.getSubscription();

    // Create new subscription if none exists
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const token = JSON.stringify(subscription);

    // Save to Firebase
    const { auth, db } = await import('../firebaseConfig');
    const { doc, updateDoc } = await import('firebase/firestore');
    const user = auth.currentUser;
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), {
        webPushSubscription: token,
        webPushUpdatedAt: new Date().toISOString(),
      });
      console.log('[Web Notifications] Subscription saved to Firebase');
    }

    return token;
  } catch (error) {
    console.error('[Web Notifications] Registration error:', error);
    return null;
  }
}

// ─── Local notification ───────────────────────────────────
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

// ─── Send push (handled server-side for web) ──────────────
export async function sendPushNotification(
  _token: string,
  _title: string,
  _body: string,
  _data?: Record<string, unknown>
): Promise<boolean> {
  console.log('[Web Notifications] Push sending is handled server-side');
  return true;
}

// ─── Notification helpers ─────────────────────────────────
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

// ─── Event listeners (no-op on web) ──────────────────────
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

// ─── Badge / clear (no-op on web) ────────────────────────
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
    console.error('[Web Notifications] Clear error:', error);
  }
}