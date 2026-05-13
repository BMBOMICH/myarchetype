import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { app, auth, db } from '../firebaseConfig';
import { logger } from './logger';

const functions = getFunctions(app, 'europe-west1');

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true,
      shouldShowBanner: true, shouldShowList: true,
    }),
  });
}

const DUMMY_SUBSCRIPTION: Notifications.EventSubscription = { remove: () => {} };

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) { logger.log('[Notifications] Push only works on physical devices'); return null; }
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') { logger.log('[Notifications] Permission denied'); return null; }
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token     = tokenData.data;
    const user      = auth.currentUser;
    if (user && token) {
      await updateDoc(doc(db, 'users', user.uid), { pushToken: token, pushTokenUpdatedAt: serverTimestamp() })
        .catch(async () => { await setDoc(doc(db, 'users', user.uid), { pushToken: token, pushTokenUpdatedAt: serverTimestamp() }, { merge: true }); });
      logger.log('[Notifications] Token saved to Firestore');
    }
    if (Platform.OS === 'android') {
      await Promise.all([
        Notifications.setNotificationChannelAsync('default',  { name: 'Default',      importance: Notifications.AndroidImportance.MAX,     vibrationPattern: [0,250,250,250], lightColor: '#53a8b6' }).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),
        Notifications.setNotificationChannelAsync('matches',  { name: 'New Matches',  importance: Notifications.AndroidImportance.HIGH,    vibrationPattern: [0,500,250,500], lightColor: '#5cb85c' }),
        Notifications.setNotificationChannelAsync('messages', { name: 'Messages',     importance: Notifications.AndroidImportance.HIGH,    vibrationPattern: [0,250],         lightColor: '#53a8b6' }),
        Notifications.setNotificationChannelAsync('likes',    { name: 'Likes',        importance: Notifications.AndroidImportance.DEFAULT,                                    lightColor: '#e67e22' }),
      ]).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; });
    }
    return token;
  } catch (error) { logger.error('[Notifications] Registration error:', error); return null; }
}

export async function saveWebPushSubscription(subscription: PushSubscription): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  const user = auth.currentUser;
  if (!user) return false;
  try {
    await setDoc(doc(db, 'users', user.uid), { webPushSubscription: JSON.stringify(subscription) }, { merge: true });
    return true;
  } catch (error) { logger.error('[Notifications] Failed to save web push subscription:', error); return false; }
}

export async function sendLocalNotification(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.scheduleNotificationAsync({ content: { title, body, data: data ?? {}, sound: true }, trigger: null });
}

export async function sendPushNotification(targetUserId: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  try {
    const callable = httpsCallable<
      { targetUserId: string; title: string; body: string; data?: Record<string, string> },
      { success: boolean; reason?: string }
    >(functions, 'sendNotification');
    const result = await callable({ targetUserId, title, body, data });
    return !!result.data?.success;
  } catch (error) { logger.error('[Notifications] Push send error:', error); return false; }
}

export type NotificationType = 'match' | 'message' | 'like' | 'rating_prompt';

export async function notifyNewMatch(recipientUserId: string, matcherName: string): Promise<void> {
  await sendPushNotification(recipientUserId, "It's a Match! 💕", `You and ${matcherName} liked each other!`, { type: 'match', screen: 'my-matches' });
}

export async function notifyNewMessage(recipientUserId: string, senderName: string, messagePreview: string): Promise<void> {
  const preview = messagePreview.length > 50 ? `${messagePreview.substring(0, 50)}...` : messagePreview;
  await sendPushNotification(recipientUserId, senderName, preview, { type: 'message', screen: 'chat' });
}

export async function notifyNewLike(recipientUserId: string): Promise<void> {
  await sendPushNotification(recipientUserId, 'Someone likes you! 😍', 'Open the app to see who it is', { type: 'like', screen: 'matches' });
}

export async function notifyRatingPrompt(recipientUserId: string, matchName: string): Promise<void> {
  await sendPushNotification(recipientUserId, 'How was your date? 📝', `Rate your experience with ${matchName} to help the community`, { type: 'rating_prompt', screen: 'my-matches' });
}

export function addNotificationReceivedListener(callback: (notification: Notifications.Notification) => void): Notifications.EventSubscription {
  if (Platform.OS === 'web') return DUMMY_SUBSCRIPTION;
  return Notifications.addNotificationReceivedListener(callback);
}

export function addNotificationResponseListener(callback: (response: Notifications.NotificationResponse) => void): Notifications.EventSubscription {
  if (Platform.OS === 'web') return DUMMY_SUBSCRIPTION;
  return Notifications.addNotificationResponseReceivedListener(callback);
}

export async function getBadgeCount(): Promise<number>         { if (Platform.OS === 'web') return 0; return Notifications.getBadgeCountAsync(); }
export async function setBadgeCount(count: number): Promise<void> { if (Platform.OS === 'web') return; await Notifications.setBadgeCountAsync(count); }
export async function clearAllNotifications(): Promise<void>   { if (Platform.OS === 'web') return; await Notifications.dismissAllNotificationsAsync(); await setBadgeCount(0); }
