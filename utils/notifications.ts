import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { auth, db } from '../firebaseConfig';

// ─── Notification Handler (native only) ──────────────────
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

// ─── Dummy subscription for web ───────────────────────────
const DUMMY_SUBSCRIPTION: Notifications.EventSubscription = {
  remove: () => {},
};

// ─── Register for push notifications ─────────────────────
export async function registerForPushNotifications(): Promise<string | null> {
  // Skip entirely on web
  if (Platform.OS === 'web') return null;

  // Skip on emulator/simulator
  if (!Device.isDevice) {
    console.log('[Notifications] Push only works on physical devices');
    return null;
  }

  try {
    // Check/request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission denied');
      return null;
    }

    // Get push token
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Save token to Firestore
    const user = auth.currentUser;
    if (user && token) {
      await updateDoc(doc(db, 'users', user.uid), {
        pushToken: token,
        pushTokenUpdatedAt: new Date().toISOString(),
      });
      console.log('[Notifications] Token saved to Firebase');
    }

    // Set up Android notification channels
    if (Platform.OS === 'android') {
      await Promise.all([
        Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#53a8b6',
        }),
        Notifications.setNotificationChannelAsync('matches', {
          name: 'New Matches',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 500, 250, 500],
          lightColor: '#5cb85c',
        }),
        Notifications.setNotificationChannelAsync('messages', {
          name: 'Messages',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250],
          lightColor: '#53a8b6',
        }),
        Notifications.setNotificationChannelAsync('likes', {
          name: 'Likes',
          importance: Notifications.AndroidImportance.DEFAULT,
          lightColor: '#e67e22',
        }),
      ]);
    }

    return token;
  } catch (error) {
    console.error('[Notifications] Registration error:', error);
    return null;
  }
}

// ─── Local notification ───────────────────────────────────
export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (Platform.OS === 'web') return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      sound: true,
    },
    trigger: null,
  });
}

// ─── Send push via Expo API ───────────────────────────────
export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<boolean> {
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: expoPushToken,
        sound: 'default',
        title,
        body,
        data: data ?? {},
      }),
    });

    const result = await response.json();
    console.log('[Notifications] Push sent:', result);
    return true;
  } catch (error) {
    console.error('[Notifications] Push send error:', error);
    return false;
  }
}

// ─── Notification type helpers ────────────────────────────
export type NotificationType = 'match' | 'message' | 'like' | 'rating_prompt';

export async function notifyNewMatch(
  recipientToken: string,
  matcherName: string
): Promise<void> {
  await sendPushNotification(
    recipientToken,
    "It's a Match! 💕",
    `You and ${matcherName} liked each other!`,
    { type: 'match', screen: 'my-matches' }
  );
}

export async function notifyNewMessage(
  recipientToken: string,
  senderName: string,
  messagePreview: string
): Promise<void> {
  const preview =
    messagePreview.length > 50
      ? messagePreview.substring(0, 50) + '...'
      : messagePreview;

  await sendPushNotification(
    recipientToken,
    senderName,
    preview,
    { type: 'message', screen: 'chat' }
  );
}

export async function notifyNewLike(recipientToken: string): Promise<void> {
  await sendPushNotification(
    recipientToken,
    'Someone likes you! 😍',
    'Open the app to see who it is',
    { type: 'like', screen: 'matches' }
  );
}

export async function notifyRatingPrompt(
  recipientToken: string,
  matchName: string
): Promise<void> {
  await sendPushNotification(
    recipientToken,
    'How was your date? 📝',
    `Rate your experience with ${matchName} to help the community`,
    { type: 'rating_prompt', screen: 'my-matches' }
  );
}

// ─── Event listeners (web-safe) ───────────────────────────
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
): Notifications.EventSubscription {
  if (Platform.OS === 'web') return DUMMY_SUBSCRIPTION;
  return Notifications.addNotificationReceivedListener(callback);
}

export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void
): Notifications.EventSubscription {
  if (Platform.OS === 'web') return DUMMY_SUBSCRIPTION;
  return Notifications.addNotificationResponseReceivedListener(callback);
}

// ─── Badge helpers (web-safe) ─────────────────────────────
export async function getBadgeCount(): Promise<number> {
  if (Platform.OS === 'web') return 0;
  return Notifications.getBadgeCountAsync();
}

export async function setBadgeCount(count: number): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.setBadgeCountAsync(count);
}

export async function clearAllNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.dismissAllNotificationsAsync();
  await setBadgeCount(0);
}