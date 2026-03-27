import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, getDocFromCache } from 'firebase/firestore';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { LanguageProvider } from '../utils/languageContext';
import { logger } from '../utils/logger';
import { registerForPushNotifications } from '../utils/notifications';

SplashScreen.preventAutoHideAsync().catch(() => {});

const AUTH_TIMEOUT_MS = 10_000;
const FIRESTORE_TIMEOUT_MS = 8_000;

const COLORS = {
  dark: {
    bg: '#1a1a2e',
    accent: '#53a8b6',
    text: '#ffffff',
  },
  light: {
    bg: '#f5f5f7',
    accent: '#3a8a9a',
    text: '#1a1a2e',
  },
} as const;

const PUBLIC_SCREENS = new Set(['login', 'signup', 'index', 'terms', 'privacy']);

interface UserProfile {
  name?: string;
  age?: number;
  gender?: string;
  interestedIn?: string;
  photos?: string[];
  profileComplete?: boolean;
}

type AppRoute =
  | '/home'
  | '/login'
  | '/signup'
  | '/profile-setup'
  | '/my-matches'
  | '/chat'
  | '/matches'
  | '/profile-views'
  | '/date-safety'
  | '/terms'
  | '/privacy';

interface NotificationData {
  screen?: string;
  matchId?: string;
  matchName?: string;
}

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

function isProfileComplete(data: UserProfile | null): boolean {
  if (!data) return false;
  if (data.profileComplete === true) return true;
  return !!(
    data.name &&
    data.age &&
    data.gender &&
    data.interestedIn &&
    data.photos &&
    data.photos.length > 0
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const cachedDoc = await getDocFromCache(doc(db, 'users', uid)).catch(() => null);
    if (cachedDoc?.exists()) {
      return cachedDoc.data() as UserProfile;
    }
  } catch {
    // Cache miss
  }

  const networkDoc = await withTimeout(
    getDoc(doc(db, 'users', uid)),
    FIRESTORE_TIMEOUT_MS,
    'Firestore getDoc'
  );

  return networkDoc.exists() ? (networkDoc.data() as UserProfile) : null;
}

// ─── Error Boundary ──────────────────────────────────────
class LayoutErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static override getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) {
      console.error('[LayoutErrorBoundary]', error, info);
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorEmoji}>😕</Text>
          <Text style={styles.errorText}>Something went wrong</Text>
          <Text style={styles.errorSubtext}>Please restart the app</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ─── Loading Screen ──────────────────────────────────────
const LoadingScreen = React.memo(function LoadingScreen({
  colorScheme,
}: {
  colorScheme: 'light' | 'dark';
}) {
  const colors = COLORS[colorScheme];

  return (
    <View
      style={[styles.loadingContainer, { backgroundColor: colors.bg }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading application"
      accessibilityState={{ busy: true }}
    >
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
});

// ─── Screen Options ───────────────────────────────────────
const useScreenOptions = (colorScheme: 'light' | 'dark') => {
  return useMemo(
    () => ({
      headerStyle: { backgroundColor: COLORS[colorScheme].bg },
      headerTintColor: COLORS[colorScheme].text,
      headerTitleStyle: { fontWeight: 'bold' as const },
      contentStyle: { backgroundColor: COLORS[colorScheme].bg },
    }),
    [colorScheme]
  );
};

// ─── Root Layout Content ──────────────────────────────────
function RootLayoutContent() {
  const router = useRouter();
  const segments = useSegments();
  const rawScheme = useColorScheme();
  const colorScheme: 'light' | 'dark' = rawScheme === 'light' ? 'light' : 'dark';

  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [authTimedOut, setAuthTimedOut] = useState(false);

  const isMounted = useRef(true);
  const notificationListener = useRef<Notifications.EventSubscription>();
  const responseListener = useRef<Notifications.EventSubscription>();
  const pushRegistered = useRef(false);
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const currentSegment = useMemo(() => segments[0] ?? '', [segments]);
  const isPublicScreen = useMemo(() => PUBLIC_SCREENS.has(currentSegment), [currentSegment]);
  const isProfileSetupScreen = useMemo(() => currentSegment === 'profile-setup', [currentSegment]);

  // Fix TS2367: don't compare segment string union to literal 'index'
  // instead check against known auth screen names explicitly
  const isAuthScreen = useMemo(
    () => ['login', 'signup', 'index'].includes(currentSegment),
    [currentSegment]
  );

  const screenOptions = useScreenOptions(colorScheme);

  const processAuthenticatedUser = useCallback(async (user: User) => {
    if (!user.emailVerified) {
      if (__DEV__) logger.info('[Layout] Email not verified');
      setIsLoggedIn(false);
      setProfileComplete(null);
      return;
    }

    setIsLoggedIn(true);

    try {
      const profile = await fetchUserProfile(user.uid);
      if (!isMounted.current) return;
      setProfileComplete(isProfileComplete(profile));
    } catch (err) {
      if (__DEV__) logger.error('[Layout] Profile fetch failed:', err);
      if (isMounted.current) setProfileComplete(false);
    }

    if (Platform.OS !== 'web' && !pushRegistered.current) {
      pushRegistered.current = true;
      registerForPushNotifications().catch((err) => {
        if (__DEV__) logger.warn('[Layout] Push registration failed:', err);
      });
    }
  }, []);

  // ── Auth state listener ──
  useEffect(() => {
    isMounted.current = true;

    authTimeoutRef.current = setTimeout(() => {
      if (isMounted.current && !isReady) {
        if (__DEV__) logger.warn('[Layout] Auth timed out');
        setAuthTimedOut(true);
        setIsReady(true);
      }
    }, AUTH_TIMEOUT_MS);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted.current) return;

      if (authTimeoutRef.current) {
        clearTimeout(authTimeoutRef.current);
        authTimeoutRef.current = undefined;
      }

      if (user) {
        try {
          await user.reload();
          if (!isMounted.current) return;
          await processAuthenticatedUser(user);
        } catch (error) {
          const err = error as { code?: string };
          if (__DEV__) logger.error('[Layout] Auth error:', err.code);
          if (isMounted.current) {
            setIsLoggedIn(false);
            setProfileComplete(null);
          }
          await auth.signOut().catch(() => {});
        }
      } else {
        if (isMounted.current) {
          setIsLoggedIn(false);
          setProfileComplete(null);
        }
      }

      if (isMounted.current) setIsReady(true);
    });

    return () => {
      isMounted.current = false;
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
      unsubscribe();
    };
  }, [processAuthenticatedUser]);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isReady]);

  const handleNotificationRoute = useCallback(
    (data: NotificationData) => {
      if (!data.screen) return;

      const routes: Record<string, () => void> = {
        'my-matches': () => router.push('/my-matches' as AppRoute),
        chat: () => {
          if (data.matchId && data.matchName) {
            router.push({
              pathname: '/chat' as AppRoute,
              params: { matchId: data.matchId, matchName: data.matchName },
            });
          } else {
            router.push('/my-matches' as AppRoute);
          }
        },
        matches: () => router.push('/matches' as AppRoute),
        'profile-views': () => router.push('/profile-views' as AppRoute),
        'check-in': () => router.push('/date-safety' as AppRoute),
      };

      const route = routes[data.screen];
      if (route) {
        route();
      } else {
        router.push('/home' as AppRoute);
      }
    },
    [router]
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        if (__DEV__) logger.info('[Layout] Notification received:', notification.request.identifier);
      }
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as NotificationData;
        handleNotificationRoute(data);
      }
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [handleNotificationRoute]);

  // ── Auth redirect logic ──
  useEffect(() => {
    if (!isReady) return;

    const task = InteractionManager.runAfterInteractions(() => {
      if (!isMounted.current) return;

      if (__DEV__) {
        logger.info('[Layout] Route check:', {
          isLoggedIn,
          profileComplete,
          currentSegment,
        });
      }

      if (isLoggedIn) {
        if (profileComplete === false && !isProfileSetupScreen) {
          router.replace('/profile-setup' as AppRoute);
        } else if (profileComplete === true && (isAuthScreen || isProfileSetupScreen)) {
          router.replace('/home' as AppRoute);
        }
      } else {
        if (!isPublicScreen && currentSegment.length > 0) {
          router.replace('/login' as AppRoute);
        }
      }
    });

    return () => task.cancel();
  }, [
    isReady,
    isLoggedIn,
    profileComplete,
    currentSegment,
    isPublicScreen,
    isAuthScreen,
    isProfileSetupScreen,
    router,
  ]);

  if (!isReady) {
    return <LoadingScreen colorScheme={colorScheme} />;
  }

  if (authTimedOut && !isLoggedIn) {
    // Could show a retry button here
  }

  return (
    <>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Log In' }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen
          name="profile-setup"
          options={{ title: 'Create Profile', headerBackVisible: false, gestureEnabled: false }}
        />
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="matches" options={{ title: 'Find Matches' }} />
        <Stack.Screen name="my-matches" options={{ title: 'My Matches' }} />
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        <Stack.Screen name="personality-quiz" options={{ title: 'Personality Quiz', headerBackVisible: false }} />
        <Stack.Screen name="edit-profile" options={{ title: 'Edit Profile' }} />
        <Stack.Screen name="video-profile-recorder" options={{ headerShown: false }} />
        <Stack.Screen name="height-verification" options={{ title: 'Verify Height' }} />
        <Stack.Screen name="selfie-verification" options={{ title: 'Verify Identity' }} />
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
        <Stack.Screen name="date-safety" options={{ headerShown: false }} />
        <Stack.Screen name="date-checkin" options={{ headerShown: false }} />
        <Stack.Screen name="post-date-rating" options={{ title: 'Rate Experience' }} />
        <Stack.Screen name="blocked-users" options={{ title: 'Blocked Users' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="referral" options={{ title: 'Invite Friends' }} />
        <Stack.Screen name="referral-leaderboard" options={{ title: 'Leaderboard' }} />
        <Stack.Screen name="profile-views" options={{ title: 'Profile Views' }} />
        <Stack.Screen name="social-verification" options={{ headerShown: false }} />
        <Stack.Screen name="date-spot-reviews" options={{ headerShown: false }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
        <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />
        <Stack.Screen name="admin/index" options={{ title: 'Admin Dashboard' }} />
        <Stack.Screen name="admin/reports" options={{ title: 'User Reports' }} />
        <Stack.Screen name="admin/users" options={{ title: 'Manage Users' }} />
        <Stack.Screen name="admin/stats" options={{ title: 'Statistics' }} />
      </Stack>

      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  return (
    <LayoutErrorBoundary>
      <LanguageProvider>
        <RootLayoutContent />
      </LanguageProvider>
    </LayoutErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 32,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#aaaaaa',
  },
});