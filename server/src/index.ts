import express, { Request, Response } from 'express';
import * as webpush from 'web-push';

const app = express();
app.use(express.json());

const vapidEmail = process.env.VAPID_EMAIL;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidEmail || !vapidPublicKey || !vapidPrivateKey) {
  console.warn('[Server] Missing VAPID environment variables.');
} else {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

type SendNotificationBody = {
  subscription?: webpush.PushSubscription;
  title?: string;
  body?: string;
  screen?: string;
};

type ExpoNotificationBody = {
  expoPushToken?: string;
  title?: string;
  body?: string;
  screen?: string;
};

app.post('/send-notification', async (req: Request, res: Response) => {
  try {
    const { subscription, title, body, screen } = req.body as SendNotificationBody;

    if (!subscription || !title || !body) {
      res.status(400).json({ success: false, reason: 'missing_fields' });
      return;
    }

    if (!vapidEmail || !vapidPublicKey || !vapidPrivateKey) {
      res.status(500).json({ success: false, reason: 'missing_vapid_config' });
      return;
    }

    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title,
        body,
        data: { screen: screen ?? 'home' },
      })
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Web Push] Error:', error);
    res.status(500).json({ success: false, reason: 'failed' });
  }
});

app.post('/send-expo-notification', async (req: Request, res: Response) => {
  try {
    const { expoPushToken, title, body, screen } = req.body as ExpoNotificationBody;

    if (!expoPushToken || !title || !body) {
      res.status(400).json({ success: false, reason: 'missing_fields' });
      return;
    }

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
        data: { screen: screen ?? 'home' },
      }),
    });

    const data = await response.json();
    res.json({ success: response.ok, data });
  } catch (error) {
    console.error('[Expo Push] Error:', error);
    res.status(500).json({ success: false, reason: 'failed' });
  }
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});