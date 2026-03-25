import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { auth } from '../firebaseConfig';
import { LanguageProvider } from '../utils/languageContext';
import { registerForPushNotifications } from '../utils/notifications';

// ─── Notification handler (native only) ──────────────────
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

// ─── Root layout content ──────────────────────────────────
function RootLayoutContent() {
  const router = useRouter();
  const segments = useSegments();
  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const notificationListener = useRef<Notifications.EventSubscription | undefined>(undefined);
  const responseListener = useRef<Notifications.EventSubscription | undefined>(undefined);

  // ── Auth state listener ──────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {

      if (user) {
        try {
          // ✅ Force reload to verify account still exists on Firebase
          await user.reload();
          setIsLoggedIn(true);

          if (Platform.OS !== 'web') {
            registerForPushNotifications().catch((err) => {
              console.log('[Layout] Push registration failed:', err);
            });
          }
        } catch (error: any) {
          // ✅ Account deleted or token invalid — force sign out
          console.log('[Layout] Account no longer valid:', error.code);
          setIsLoggedIn(false);
          await auth.signOut().catch(() => {});
        }
      } else {
        setIsLoggedIn(false);
      }

      // ✅ Only mark ready AFTER we've confirmed auth state
      setIsReady(true);
    });

    return () => unsubscribe();
  }, []);

  // ── Notification listeners (native only) ─────────────
  useEffect(() => {
    if (Platform.OS === 'web') return;

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[Layout] Notification received:', notification);
      }
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log('[Layout] Notification tapped:', response);
        const data = response.notification.request.content.data as Record<string, string>;
        if (!data?.screen) return;

        switch (data.screen) {
          case 'my-matches': router.push('/my-matches'); break;
          case 'chat':
            if (data.matchId && data.matchName) {
              router.push({ pathname: '/chat', params: { matchId: data.matchId, matchName: data.matchName } });
            } else {
              router.push('/my-matches');
            }
            break;
          case 'matches': router.push('/matches'); break;
          case 'profile-views': router.push('/profile-views'); break;
          case 'check-in': router.push('/date-safety'); break;
          default: router.push('/home');
        }
      }
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [router]);

  // ── Auth redirect logic ───────────────────────────────
  useEffect(() => {
    if (!isReady) return;

    const isAuthScreen = ['login', 'signup', 'index'].includes(
      segments[0] as string
    );

    if (isLoggedIn && isAuthScreen) {
      router.replace('/home');
    } else if (!isLoggedIn && !isAuthScreen && segments[0] !== undefined) {
      router.replace('/login');
    }

  }, [isReady, isLoggedIn, segments, router]);

  // ✅ Show blank loading screen until auth is confirmed
  // This prevents ANY screen from flashing before we know the auth state
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: '#1a1a2e' },
        }}
      >
        {/* ── Auth ── */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Log In' }} />
        <Stack.Screen name="signup" options={{ title: 'Sign Up' }} />

        {/* ── Main ── */}
        <Stack.Screen name="profile-setup" options={{ title: 'Create Profile', headerBackVisible: false }} />
        <Stack.Screen name="home" options={{ title: 'Home', headerShown: false }} />
        <Stack.Screen name="matches" options={{ title: 'Find Matches' }} />
        <Stack.Screen name="my-matches" options={{ title: 'My Matches' }} />
        <Stack.Screen name="chat" options={{ headerShown: false }} />

        {/* ── Profile ── */}
        <Stack.Screen name="personality-quiz" options={{ title: 'Personality Quiz' }} />
        <Stack.Screen name="edit-profile" options={{ title: 'Edit Profile' }} />
        <Stack.Screen name="video-profile-recorder" options={{ headerShown: false }} />

        {/* ── Verification ── */}
        <Stack.Screen name="height-verification" options={{ title: 'Verify Height' }} />
        <Stack.Screen name="selfie-verification" options={{ title: 'Verify Identity' }} />

        {/* ── Features ── */}
        <Stack.Screen name="daily-question" options={{ headerShown: false }} />
        <Stack.Screen name="second-look" options={{ headerShown: false }} />
        <Stack.Screen name="dating-stats" options={{ headerShown: false }} />
        <Stack.Screen name="achievements" options={{ headerShown: false }} />
        <Stack.Screen name="interests" options={{ headerShown: false }} />
        <Stack.Screen name="deal-breakers" options={{ headerShown: false }} />
        <Stack.Screen name="icebreaker-game" options={{ headerShown: false }} />
        <Stack.Screen name="compatibility-quiz" options={{ headerShown: false }} />
        <Stack.Screen name="voice-intro-recorder" options={{ headerShown: false }} />
        <Stack.Screen name="smart-photos" options={{ headerShown: false }} />
        <Stack.Screen name="relationship-mode" options={{ headerShown: false }} />
        <Stack.Screen name="stories" options={{ headerShown: false }} />
        <Stack.Screen name="super-likes" options={{ headerShown: false }} />
        <Stack.Screen name="shared-playlist" options={{ headerShown: false }} />

        {/* ── Safety ── */}
        <Stack.Screen name="date-safety" options={{ headerShown: false }} />
        <Stack.Screen name="date-checkin" options={{ headerShown: false }} />
        <Stack.Screen name="post-date-rating" options={{ title: 'Rate Experience' }} />
        <Stack.Screen name="blocked-users" options={{ title: 'Blocked Users' }} />

        {/* ── Social & Referral ── */}
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="referral" options={{ title: 'Invite Friends' }} />
        <Stack.Screen name="referral-leaderboard" options={{ title: 'Leaderboard' }} />
        <Stack.Screen name="profile-views" options={{ title: 'Profile Views' }} />
        <Stack.Screen name="social-verification" options={{ headerShown: false }} />
        <Stack.Screen name="date-spot-reviews" options={{ headerShown: false }} />

        {/* ── Legal ── */}
        <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
        <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />

        {/* ── Admin ── */}
        <Stack.Screen name="admin/index" options={{ title: 'Admin Dashboard' }} />
        <Stack.Screen name="admin/reports" options={{ title: 'User Reports' }} />
        <Stack.Screen name="admin/users" options={{ title: 'Manage Users' }} />
        <Stack.Screen name="admin/stats" options={{ title: 'Statistics' }} />
      </Stack>

      <StatusBar style="light" />
    </>
  );
}

// ─── Root layout ──────────────────────────────────────────
export default function RootLayout() {
  return (
    <LanguageProvider>
      <RootLayoutContent />
    </LanguageProvider>
  );
}