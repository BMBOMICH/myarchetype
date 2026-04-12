import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as webpush from 'web-push';
import { logger } from '../../utils/logger';

admin.initializeApp();

webpush.setVapidDetails(
  'mailto:elxanhusey5555@gmail.com',
  'BMothFbf8iMeqOrdqMI2OmY4qWNn1sEvKaXr7MnrYqIW_dAFhxu6tm9XH0m9iF9aKzznDBEdgvO-IhuKGr1N7C0',
  'I-YUITF4_pm379DtPogdVraMRm70HbnqFBVEDsTe9cE'
);

export const sendWebPushNotification = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { recipientUserId, title, body, screen } = request.data as {
    recipientUserId: string;
    title: string;
    body: string;
    screen: string;
  };

  try {
    const userDoc = await admin
      .firestore()
      .collection('users')
      .doc(recipientUserId)
      .get();

    const webPushSubscription = userDoc.data()?.webPushSubscription;

    if (!webPushSubscription) {
      logger.log('[Web Push] No subscription found for user');
      return { success: false, reason: 'no_subscription' };
    }

    const subscription = JSON.parse(webPushSubscription as string);

    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, data: { screen } })
    );

    logger.log('[Web Push] Notification sent to:', recipientUserId);
    return { success: true };
  } catch (error) {
    logger.error('[Web Push] Error:', error);
    throw new HttpsError('internal', 'Failed to send notification');
  }
});