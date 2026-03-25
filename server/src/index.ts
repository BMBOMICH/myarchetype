import express, { Request, Response } from 'express';
import * as webpush from 'web-push';

const app = express();
app.use(express.json());

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

app.post('/send-notification', async (req: Request, res: Response) => {
  try {
    const { subscription, title, body, screen } = req.body as {
      subscription: webpush.PushSubscription;
      title: string;
      body: string;
      screen: string;
    };

    if (!subscription || !title || !body) {
      res.status(400).json({ success: false, reason: 'missing_fields' });
      return;
    }

    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, data: { screen } })
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Web Push] Error:', error);
    res.status(500).json({ success: false, reason: 'failed' });
  }
});

app.post('/send-expo-notification', async (req: Request, res: Response) => {
  try {
    const { expoPushToken, title, body, screen } = req.body as {
      expoPushToken: string;
      title: string;
      body: string;
      screen: string;
    };

    if (!expoPushToken || !title || !body) {
      res.status(400).json({ success: false, reason: 'missing_fields' });
      return;
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: expoPushToken,
        sound: 'default',
        title,
        body,
        data: { screen },
      }),
    });

    const data = await response.json();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Expo Push] Error:', error);
    res.status(500).json({ success: false, reason: 'failed' });
  }
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});