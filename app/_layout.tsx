import '../utils/ssr-shim';
import 'react-native-gesture-handler';
import '../src/styles/unistyles';

import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, getDocFromCache } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Platform,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../firebaseConfig';
import { loadFaceVerification } from '../utils/faceVerification';
import { LanguageProvider } from '../utils/LanguageContext';
import { logger } from '../utils/logger';
import { preloadSafetyModel } from '../utils/moderation';
import { registerForPushNotifications } from '../utils/notifications';

enableScreens(true);

function sanitizeEvent(event: any): any {
  const scrub = (str: string): string =>
    str.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
  if (event.message && typeof event.message === 'string') {
    event.message = scrub(event.message);
  }
  if (event.exception?.values) {
    event.exception.values.forEach((val: any) => {
      if (val.value && typeof val.value === 'string') {
        val.value = scrub(val.value);
      }
    });
  }
  return event;
}

Sentry.init({
  dsn: process.env['EXPO_PUBLIC_SENTRY_DSN'] ?? '',
  enabled: !__DEV__,
  tracesSampleRate: 0.2,
  environment: __DEV__ ? 'development' : 'production',
  integrations: [Sentry.mobileReplayIntegration()],
  beforeSend: sanitizeEvent,
});

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const AUTH_TIMEOUT_MS = 10_000;
const FIRESTORE_TIMEOUT_MS = 8_000;

const COLORS = {
  dark: { bg: '#1a1a2e', accent: '#53a8b6', text: '#ffffff' },
  light: { bg: '#f5f5f7', accent: '#3a8a9a', text: '#1a1a2e' },
} as const;

const ROUTES = {
  home: '/home',
  login: '/login',
  signup: '/signup',
  profileSetup: '/profile-setup',
  myMatches: '/my-matches',
  chat: '/chat',
  matches: '/matches',
  profileViews: '/profile-views',
  dateSafety: '/date-safety',
  terms: '/terms',
  privacy: '/privacy',
} as const;

const PUBLIC_SCREEN_NAMES = ['login', 'signup', 'index', 'terms', 'privacy'] as const;
const AUTH_SCREEN_NAMES = ['login', 'signup', 'index'] as const;
const PUBLIC_SCREENS = new Set<string>(PUBLIC_SCREEN_NAMES);
const AUTH_SCREENS = new Set<string>(AUTH_SCREEN_NAMES);

interface UserProfile {
  name?: string;
  age?: number;
  gender?: string;
  interestedIn?: string;
  photos?: string[];
  profileComplete?: boolean;
}

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
  Notifications.registerTaskAsync('BACKGROUND_NOTIFICATION_TASK').catch(() => {});
}

if (typeof ErrorUtils !== 'undefined') {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    logger.error('[GlobalError]', isFatal ? 'FATAL' : 'non-fatal', error?.message ?? error);
    Sentry.captureException(error, { extra: { isFatal: isFatal ?? false } });
    prev?.(error, isFatal);
  });
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    logger.error('[UnhandledRejection]', e.reason);
    Sentry.captureException(
      e.reason instanceof Error ? e.reason : new Error(String(e.reason)),
    );
  });
}

function validateUserProfile(data: unknown): UserProfile | null {
  if (typeof data !== 'object' || data === null) {
    if (__DEV__) logger.warn('[Layout] Profile data is not an object');
    return null;
  }
  const d = data as Record<string, unknown>;
  const profile: UserProfile = {
    name: typeof d.name === 'string' ? d.name : undefined,
    age: typeof d.age === 'number' ? d.age : undefined,
    gender: typeof d.gender === 'string' ? d.gender : undefined,
    interestedIn: typeof d.interestedIn === 'string' ? d.interestedIn : undefined,
    photos: Array.isArray(d.photos)
      ? d.photos.filter((p): p is string => typeof p === 'string')
      : undefined,
    profileComplete: typeof d.profileComplete === 'boolean' ? d.profileComplete : undefined,
  };
  if (__DEV__) {
    const expectedKeys = ['name', 'age', 'gender', 'interestedIn', 'photos', 'profileComplete'];
    const unexpected = Object.keys(d).filter(k => !expectedKeys.includes(k));
    if (unexpected.length > 0) {
      logger.warn('[Layout] Unexpected profile fields:', unexpected);
    }
  }
  return profile;
}

function isProfileComplete(data: UserProfile | null): boolean {
  if (!data) return false;
  if (data.profileComplete === true) return true;
  return !!(data.name && data.age && data.gender && data.interestedIn && data.photos?.length);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

const profileCache = new Map<string, Promise<UserProfile | null>>();

async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  const cached = profileCache.get(uid);
  if (cached) return cached;
  const promise = (async (): Promise<UserProfile | null> => {
    try {
      const cachedDoc = await getDocFromCache(doc(db, 'users', uid)).catch(() => null);
      if (cachedDoc?.exists()) return validateUserProfile(cachedDoc.data());
    } catch { /* cache miss */ }
    const snap = await withTimeout(
      getDoc(doc(db, 'users', uid)),
      FIRESTORE_TIMEOUT_MS,
      'Firestore getDoc',
    );
    return snap.exists() ? validateUserProfile(snap.data()) : null;
  })();
  profileCache.set(uid, promise);
  promise.catch(() => profileCache.delete(uid));
  return promise;
}

const SCREENS: Array<{ name: string; options: Record<string, unknown> }> = [
  { name: 'index', options: { headerShown: false } },
  { name: 'login', options: { title: 'Log In' } },
  { name: 'signup', options: { headerShown: false } },
  { name: 'profile-setup', options: { title: 'Create Profile', headerBackVisible: false, gestureEnabled: false } },
  { name: 'home', options: { headerShown: false } },
  { name: 'matches', options: { title: 'Find Matches' } },
  { name: 'my-matches', options: { title: 'My Matches' } },
  { name: 'chat', options: { headerShown: false } },
  { name: 'personality-quiz', options: { title: 'Personality Quiz', headerBackVisible: false } },
  { name: 'edit-profile', options: { title: 'Edit Profile' } },
  { name: 'video-profile-recorder', options: { headerShown: false } },
  { name: 'height-verification', options: { title: 'Verify Height' } },
  { name: 'selfie-verification', options: { title: 'Verify Identity' } },
  { name: 'daily-question', options: { headerShown: false } },
  { name: 'second-look', options: { headerShown: false } },
  { name: 'dating-stats', options: { headerShown: false } },
  { name: 'achievements', options: { headerShown: false } },
  { name: 'interests', options: { headerShown: false } },
  { name: 'deal-breakers', options: { headerShown: false } },
  { name: 'icebreaker-game', options: { headerShown: false } },
  { name: 'compatibility-quiz', options: { headerShown: false } },
  { name: 'voice-intro-recorder', options: { headerShown: false } },
  { name: 'smart-photos', options: { headerShown: false } },
  { name: 'relationship-mode', options: { headerShown: false } },
  { name: 'stories', options: { headerShown: false } },
  { name: 'super-likes', options: { headerShown: false } },
  { name: 'shared-playlist', options: { headerShown: false } },
  { name: 'date-safety', options: { headerShown: false } },
  { name: 'date-checkin', options: { headerShown: false } },
  { name: 'post-date-rating', options: { title: 'Rate Experience' } },
  { name: 'blocked-users', options: { title: 'Blocked Users' } },
  { name: 'settings', options: { title: 'Settings' } },
  { name: 'referral', options: { title: 'Invite Friends' } },
  { name: 'referral-leaderboard', options: { title: 'Leaderboard' } },
  { name: 'profile-views', options: { title: 'Profile Views' } },
  { name: 'social-verification', options: { headerShown: false } },
  { name: 'date-spot-reviews', options: { headerShown: false } },
  { name: 'privacy', options: { title: 'Privacy Policy' } },
  { name: 'terms', options: { title: 'Terms of Service' } },
  { name: 'admin/index', options: { title: 'Admin Dashboard' } },
  { name: 'admin/reports', options: { title: 'User Reports' } },
  { name: 'admin/users', options: { title: 'Manage Users' } },
  { name: 'admin/stats', options: { title: 'Statistics' } },
];

class LayoutErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null };

  static override getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error('[LayoutErrorBoundary]', error, info);
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack ?? '' },
    });
  }

  override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorEmoji}>😕</Text>
        <Text style={styles.errorText}>Something went wrong</Text>
        <Text style={styles.errorSubtext}>Please restart the app</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => this.setState({ hasError: false, error: null })}
          accessibilityRole="button"
          accessibilityLabel="Retry after error"
        >
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
        {__DEV__ && this.state.error && (
          <Text style={styles.devErrorText}>
            {this.state.error.message}
          </Text>
        )}
      </View>
    );
  }
}

const LoadingScreen = React.memo(function LoadingScreen({
  colorScheme,
}: {
  colorScheme: 'light' | 'dark';
}) {
  const { bg, accent } = COLORS[colorScheme];
  return (
    <View
      style={[styles.loadingContainer, { backgroundColor: bg }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading application"
      accessibilityState={{ busy: true }}
      accessibilityValue={{ text: 'Loading' }}
    >
      <ActivityIndicator size="large" color={accent} />
    </View>
  );
});

const TimeoutScreen = React.memo(function TimeoutScreen({
  colorScheme,
  onRetry,
}: {
  colorScheme: 'light' | 'dark';
  onRetry: () => void;
}) {
  const { bg, accent, text } = COLORS[colorScheme];
  return (
    <View style={[styles.errorContainer, { backgroundColor: bg }]}>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLabel="Connection timed out. Check your internet connection. Try again button."
      >
        <Text style={styles.errorEmoji}>⏱️</Text>
        <Text style={[styles.errorText, { color: text }]}>Connection timed out</Text>
        <Text style={styles.errorSubtext}>Check your internet connection</Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: accent }]}
          onPress={onRetry}
          accessibilityLabel="Retry connection"
          accessibilityRole="button"
        >
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const OfflineBanner = React.memo(function OfflineBanner() {
  return (
    <View
      style={styles.offlineBanner}
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
    >
      <Text style={styles.offlineBannerText}>⚠️  No internet connection</Text>
    </View>
  );
});

const useScreenOptions = (colorScheme: 'light' | 'dark') =>
  useMemo(
    () => ({
      headerStyle: { backgroundColor: COLORS[colorScheme].bg },
      headerTintColor: COLORS[colorScheme].text,
      headerTitleStyle: { fontWeight: 'bold' as const },
      contentStyle: { backgroundColor: COLORS[colorScheme].bg },
    }),
    [colorScheme],
  );

const AppStack = React.memo(function AppStack({
  screenOptions,
}: {
  screenOptions: Record<string, unknown>;
}) {
  return (
    <Stack screenOptions={screenOptions}>
      {SCREENS.map(({ name, options }) => (
        <Stack.Screen key={name} name={name} options={options} />
      ))}
    </Stack>
  );
});

function RootLayoutContent() {
  const router = useRouter();
  const segments = useSegments();
  const rawScheme = useColorScheme();
  const colorScheme: 'light' | 'dark' = rawScheme === 'light' ? 'light' : 'dark';

  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);

  const pushRegistered = useRef(false);
  const isNavigating = useRef(false);

  const currentSegment = segments[0] ?? '';
  const isPublicScreen = PUBLIC_SCREENS.has(currentSegment);
  const isProfileSetupScreen = currentSegment === 'profile-setup';
  const isAuthScreen = AUTH_SCREENS.has(currentSegment);
  const screenOptions = useScreenOptions(colorScheme);

  useEffect(() => {
    let currentState = AppState.currentState;
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (currentState.match(/inactive|background/) && nextState === 'active') {
        logger.info('[Layout] App foregrounded');
        auth.currentUser?.reload().catch((err: unknown) =>
          logger.warn('[Layout] reload failed:', err),
        );
      }
      currentState = nextState;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleOnline = () => { setIsOnline(true); logger.info('[Layout] Network: online'); };
    const handleOffline = () => { setIsOnline(false); logger.warn('[Layout] Network: offline'); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleRetry = useCallback(() => {
    setAuthTimedOut(false);
    setIsReady(false);
    setRetryNonce(n => n + 1);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    void Promise.all([
      preloadSafetyModel()
        .then(ok => logger.info('[Layout] NSFW model:', ok ? 'ready' : 'unavailable'))
        .catch((err: unknown) => logger.warn('[Layout] NSFW model failed:', err)),
      loadFaceVerification()
        .then(ok => logger.info('[Layout] Face model:', ok ? 'ready' : 'unavailable'))
        .catch((err: unknown) => logger.warn('[Layout] Face model failed:', err)),
    ]);
  }, []);

  const processAuthenticatedUser = useCallback(async (user: User) => {
    if (!user.emailVerified) {
      setIsLoggedIn(false);
      setProfileComplete(null);
      return;
    }
    setIsLoggedIn(true);
    Sentry.setUser({ id: user.uid, email: user.email ?? undefined });
    try {
      await withTimeout(user.reload(), 3000, 'Auth reload').catch((err: unknown) => {
        const code = (err as { code?: string }).code;
        if (code === 'auth/user-not-found' || code === 'auth/user-disabled') {
          throw err;
        }
        logger.warn('[Layout] Auth reload warning:', err);
      });
      const profile = await fetchUserProfile(user.uid);
      setProfileComplete(isProfileComplete(profile));
    } catch (err: unknown) {
      logger.error('[Layout] Profile fetch failed:', err);
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      setProfileComplete(false);
    }
    if (Platform.OS !== 'web' && !pushRegistered.current) {
      pushRegistered.current = true;
      registerForPushNotifications().catch((err: unknown) =>
        logger.warn('[Layout] Push registration failed:', err),
      );
    }
  }, []);

  useEffect(() => {
    let authTimeout = setTimeout(() => {
      logger.warn('[Layout] Auth timed out');
      setAuthTimedOut(true);
      setIsReady(true);
    }, AUTH_TIMEOUT_MS);

    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(authTimeout);
      if (user) {
        try {
          await processAuthenticatedUser(user);
        } catch (error: unknown) {
          const err = error as { code?: string; message?: string };
          logger.error('[Layout] Auth error:', err.code ?? err.message ?? 'unknown');
          Sentry.captureException(
            error instanceof Error ? error : new Error(String(error)),
          );
          setIsLoggedIn(false);
          setProfileComplete(null);
          await auth.signOut().catch((e: unknown) =>
            logger.error('[Layout] SignOut failed:', e),
          );
        }
      } else {
        Sentry.setUser(null);
        profileCache.clear();
        setIsLoggedIn(false);
        setProfileComplete(null);
      }
      setIsReady(true);
    });

    return () => {
      clearTimeout(authTimeout);
      unsub();
    };
  }, [processAuthenticatedUser, retryNonce]);

  useEffect(() => {
    if (isReady) SplashScreen.hideAsync().catch(() => {});
  }, [isReady]);

  const handleNotificationRoute = useCallback(
    (data: NotificationData) => {
      if (!data.screen) return;
      const chatRoute = () => {
        if (data.matchId && data.matchName) {
          router.push({
            pathname: ROUTES.chat,
            params: { matchId: data.matchId, matchName: data.matchName },
          });
        } else {
          router.push(ROUTES.myMatches);
        }
      };
      const routes: Record<string, () => void> = {
        'my-matches': () => router.push(ROUTES.myMatches),
        'chat': chatRoute,
        'matches': () => router.push(ROUTES.matches),
        'profile-views': () => router.push(ROUTES.profileViews),
        'check-in': () => router.push(ROUTES.dateSafety),
      };
      (routes[data.screen] ?? (() => router.push(ROUTES.home)))();
    },
    [router],
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const notifSub = Notifications.addNotificationReceivedListener(n => {
      logger.info('[Layout] Notification received:', n.request.identifier);
    });
    const responseSub = Notifications.addNotificationResponseReceivedListener(r => {
      handleNotificationRoute(r.notification.request.content.data as NotificationData);
    });
    return () => {
      notifSub.remove();
      responseSub.remove();
    };
  }, [handleNotificationRoute]);

  useEffect(() => {
    if (!isReady) return;
    if (isNavigating.current) return;
    logger.info('[Layout] Route check:', { isLoggedIn, profileComplete, currentSegment });
    let target: string | null = null;
    if (isLoggedIn) {
      if (profileComplete === false && !isProfileSetupScreen) {
        target = ROUTES.profileSetup;
      } else if (profileComplete === true && (isAuthScreen || isProfileSetupScreen)) {
        target = ROUTES.home;
      }
    } else if (!isPublicScreen && currentSegment.length > 0) {
      target = ROUTES.login;
    }
    if (target) {
      isNavigating.current = true;
      router.replace(target);
      const t = setTimeout(() => { isNavigating.current = false; }, 500);
      return () => clearTimeout(t);
    }
  }, [
    isReady, isLoggedIn, profileComplete, currentSegment,
    isPublicScreen, isAuthScreen, isProfileSetupScreen, router,
  ]);

  if (!isReady) return <LoadingScreen colorScheme={colorScheme} />;
  if (authTimedOut && !isLoggedIn) {
    return <TimeoutScreen colorScheme={colorScheme} onRetry={handleRetry} />;
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.flex}>
        {!isOnline && <OfflineBanner />}
        <AppStack screenOptions={screenOptions} />
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(function RootLayout() {
  return (
    <LayoutErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <RootLayoutContent />
        </LanguageProvider>
      </QueryClientProvider>
    </LayoutErrorBoundary>
  );
});

const styles = StyleSheet.create(theme => ({
  flex: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorEmoji: { fontSize: 48, marginBottom: theme.spacing.md },
  errorText: { fontSize: 20, fontWeight: 'bold', color: theme.colors.text, marginBottom: theme.spacing.sm, textAlign: 'center' },
  errorSubtext: { fontSize: 14, color: theme.colors.textSecondary, marginBottom: theme.spacing.lg, textAlign: 'center' },
  devErrorText: { fontSize: 11, color: theme.colors.error, textAlign: 'center', marginTop: theme.spacing.sm, fontFamily: 'monospace' },
  retryButton: { paddingVertical: 14, paddingHorizontal: 32, borderRadius: theme.radius.full },
  retryButtonText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  offlineBanner: { backgroundColor: theme.colors.error, paddingVertical: 8, paddingHorizontal: theme.spacing.md, alignItems: 'center' },
  offlineBannerText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
}));