import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, getDocFromCache } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, InteractionManager, Platform,
  StyleSheet, Text, TouchableOpacity, useColorScheme, View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { loadFaceVerification } from '../utils/faceVerification';
import { LanguageProvider } from '../utils/languageContext';
import { logger } from '../utils/logger';
import { preloadSafetyModel } from '../utils/moderation';
import { registerForPushNotifications } from '../utils/notifications';

SplashScreen.preventAutoHideAsync().catch(() => {});

const AUTH_TIMEOUT_MS     = 10_000;
const FIRESTORE_TIMEOUT_MS = 8_000;

const COLORS = {
  dark:  { bg: '#1a1a2e', accent: '#53a8b6', text: '#ffffff' },
  light: { bg: '#f5f5f7', accent: '#3a8a9a', text: '#1a1a2e' },
} as const;

const PUBLIC_SCREENS  = new Set(['login', 'signup', 'index', 'terms', 'privacy']);
const AUTH_SCREENS    = new Set(['login', 'signup', 'index']);

interface UserProfile {
  name?: string; age?: number; gender?: string;
  interestedIn?: string; photos?: string[]; profileComplete?: boolean;
}

type AppRoute =
  | '/home' | '/login' | '/signup' | '/profile-setup' | '/my-matches'
  | '/chat' | '/matches' | '/profile-views' | '/date-safety' | '/terms' | '/privacy';

interface NotificationData { screen?: string; matchId?: string; matchName?: string; }

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true,
      shouldShowBanner: true, shouldShowList: true,
    }),
  });
}

if (typeof ErrorUtils !== 'undefined') {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    console.error('[GlobalError]', isFatal ? 'FATAL' : 'non-fatal', error?.message ?? error);
    prev?.(error, isFatal);
  });
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    console.error('[UnhandledRejection]', e.reason);
  });
}

function isProfileComplete(data: UserProfile | null): boolean {
  if (!data) return false;
  if (data.profileComplete === true) return true;
  return !!(data.name && data.age && data.gender && data.interestedIn && data.photos?.length);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const cached = await getDocFromCache(doc(db, 'users', uid)).catch(() => null);
    if (cached?.exists()) return cached.data() as UserProfile;
  } catch { /* cache miss */ }
  const snap = await withTimeout(getDoc(doc(db, 'users', uid)), FIRESTORE_TIMEOUT_MS, 'Firestore getDoc');
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

// ─── Error Boundary ───────────────────────────────────────
class LayoutErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static override getDerivedStateFromError() { return { hasError: true }; }
  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[LayoutErrorBoundary]', error, info);
  }
  override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorEmoji}>😕</Text>
        <Text style={styles.errorText}>Something went wrong</Text>
        <Text style={styles.errorSubtext}>Please restart the app</Text>
      </View>
    );
  }
}

// ─── Loading Screen ───────────────────────────────────────
const LoadingScreen = React.memo(function LoadingScreen({ colorScheme }: { colorScheme: 'light' | 'dark' }) {
  const { bg, accent } = COLORS[colorScheme];
  return (
    <View style={[styles.loadingContainer, { backgroundColor: bg }]}
      accessible accessibilityRole="progressbar"
      accessibilityLabel="Loading application"
      accessibilityState={{ busy: true }}>
      <ActivityIndicator size="large" color={accent} />
    </View>
  );
});

// ─── Timeout Screen ───────────────────────────────────────
const TimeoutScreen = React.memo(function TimeoutScreen({
  colorScheme, onRetry,
}: { colorScheme: 'light' | 'dark'; onRetry: () => void }) {
  const { bg, accent, text } = COLORS[colorScheme];
  return (
    <View style={[styles.errorContainer, { backgroundColor: bg }]}>
      <Text style={styles.errorEmoji}>⏱️</Text>
      <Text style={[styles.errorText, { color: text }]}>Connection timed out</Text>
      <Text style={styles.errorSubtext}>Check your internet connection</Text>
      <TouchableOpacity
        style={[styles.retryButton, { backgroundColor: accent }]}
        onPress={onRetry}
        accessibilityLabel="Retry connection"
        accessibilityRole="button">
        <Text style={styles.retryButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
});

const useScreenOptions = (colorScheme: 'light' | 'dark') =>
  useMemo(() => ({
    headerStyle:      { backgroundColor: COLORS[colorScheme].bg },
    headerTintColor:  COLORS[colorScheme].text,
    headerTitleStyle: { fontWeight: 'bold' as const },
    contentStyle:     { backgroundColor: COLORS[colorScheme].bg },
  }), [colorScheme]);

// ─── Root Layout Content ──────────────────────────────────
function RootLayoutContent() {
  const router        = useRouter();
  const segments      = useSegments();
  const rawScheme     = useColorScheme();
  const colorScheme: 'light' | 'dark' = rawScheme === 'light' ? 'light' : 'dark';

  const [isReady,         setIsReady]         = useState(false);
  const [isLoggedIn,      setIsLoggedIn]      = useState(false);
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [authTimedOut,    setAuthTimedOut]    = useState(false);

  const isMounted           = useRef(true);
  const notifListener       = useRef<Notifications.EventSubscription>();
  const responseListener    = useRef<Notifications.EventSubscription>();
  const pushRegistered      = useRef(false);
  const authTimeoutRef      = useRef<ReturnType<typeof setTimeout>>();

  const currentSegment      = segments[0] ?? '';
  const isPublicScreen      = PUBLIC_SCREENS.has(currentSegment);
  const isProfileSetupScreen = currentSegment === 'profile-setup';
  const isAuthScreen        = AUTH_SCREENS.has(currentSegment);
  const screenOptions       = useScreenOptions(colorScheme);

  const handleRetry = useCallback(() => {
    setAuthTimedOut(false);
    setIsReady(false);
  }, []);

  // Preload ML models on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    preloadSafetyModel()
      .then((ok) => { if (__DEV__) logger.info('[Layout] NSFW model:', ok ? 'ready' : 'unavailable'); })
      .catch(() => {});
    loadFaceVerification()
      .then((ok) => { if (__DEV__) logger.info('[Layout] Face model:', ok ? 'ready' : 'unavailable'); })
      .catch(() => {});
  }, []);

  const processAuthenticatedUser = useCallback(async (user: User) => {
    if (!user.emailVerified) {
      setIsLoggedIn(false); setProfileComplete(null); return;
    }
    setIsLoggedIn(true);
    try {
      const profile = await fetchUserProfile(user.uid);
      if (isMounted.current) setProfileComplete(isProfileComplete(profile));
    } catch (err) {
      if (__DEV__) logger.error('[Layout] Profile fetch failed:', err);
      if (isMounted.current) setProfileComplete(false);
    }
    if (Platform.OS !== 'web' && !pushRegistered.current) {
      pushRegistered.current = true;
      registerForPushNotifications()
        .catch((err) => { if (__DEV__) logger.warn('[Layout] Push registration failed:', err); });
    }
  }, []); // stable — no external deps

  // Auth listener — isReady intentionally excluded from deps to avoid re-subscribing
  useEffect(() => {
    isMounted.current = true;

    authTimeoutRef.current = setTimeout(() => {
      if (isMounted.current && !isReady) {
        if (__DEV__) logger.warn('[Layout] Auth timed out');
        setAuthTimedOut(true);
        setIsReady(true);
      }
    }, AUTH_TIMEOUT_MS);

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!isMounted.current) return;
      clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = undefined;

      if (user) {
        try {
          await user.reload();
          if (!isMounted.current) return;
          await processAuthenticatedUser(user);
        } catch (error) {
          const err = error as { code?: string };
          if (__DEV__) logger.error('[Layout] Auth error:', err.code);
          if (isMounted.current) { setIsLoggedIn(false); setProfileComplete(null); }
          await auth.signOut().catch(() => {});
        }
      } else {
        if (isMounted.current) { setIsLoggedIn(false); setProfileComplete(null); }
      }
      if (isMounted.current) setIsReady(true);
    });

    return () => {
      isMounted.current = false;
      clearTimeout(authTimeoutRef.current);
      unsub();
    };
  }, [processAuthenticatedUser]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (isReady) SplashScreen.hideAsync().catch(() => {}); }, [isReady]);

  const handleNotificationRoute = useCallback((data: NotificationData) => {
    if (!data.screen) return;
    const routes: Record<string, () => void> = {
      'my-matches':    () => router.push('/my-matches' as AppRoute),
      chat:            () => data.matchId && data.matchName
        ? router.push({ pathname: '/chat' as AppRoute, params: { matchId: data.matchId, matchName: data.matchName } })
        : router.push('/my-matches' as AppRoute),
      matches:         () => router.push('/matches' as AppRoute),
      'profile-views': () => router.push('/profile-views' as AppRoute),
      'check-in':      () => router.push('/date-safety' as AppRoute),
    };
    (routes[data.screen] ?? (() => router.push('/home' as AppRoute)))();
  }, [router]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    notifListener.current = Notifications.addNotificationReceivedListener((n) => {
      if (__DEV__) logger.info('[Layout] Notification received:', n.request.identifier);
    });
    responseListener.current = Notifications.addNotificationResponseReceivedListener((r) => {
      handleNotificationRoute(r.notification.request.content.data as NotificationData);
    });
    return () => { notifListener.current?.remove(); responseListener.current?.remove(); };
  }, [handleNotificationRoute]);

  useEffect(() => {
    if (!isReady) return;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!isMounted.current) return;
      if (__DEV__) logger.info('[Layout] Route check:', { isLoggedIn, profileComplete, currentSegment });
      if (isLoggedIn) {
        if (profileComplete === false && !isProfileSetupScreen) router.replace('/profile-setup' as AppRoute);
        else if (profileComplete === true && (isAuthScreen || isProfileSetupScreen)) router.replace('/home' as AppRoute);
      } else if (!isPublicScreen && currentSegment.length > 0) {
        router.replace('/login' as AppRoute);
      }
    });
    return () => task.cancel();
  }, [isReady, isLoggedIn, profileComplete, currentSegment, isPublicScreen, isAuthScreen, isProfileSetupScreen, router]);

  if (!isReady) return <LoadingScreen colorScheme={colorScheme} />;
  if (authTimedOut && !isLoggedIn) return <TimeoutScreen colorScheme={colorScheme} onRetry={handleRetry} />;

  return (
    <>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index"                  options={{ headerShown: false }} />
        <Stack.Screen name="login"                  options={{ title: 'Log In' }} />
        <Stack.Screen name="signup"                 options={{ headerShown: false }} />
        <Stack.Screen name="profile-setup"          options={{ title: 'Create Profile', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="home"                   options={{ headerShown: false }} />
        <Stack.Screen name="matches"                options={{ title: 'Find Matches' }} />
        <Stack.Screen name="my-matches"             options={{ title: 'My Matches' }} />
        <Stack.Screen name="chat"                   options={{ headerShown: false }} />
        <Stack.Screen name="personality-quiz"       options={{ title: 'Personality Quiz', headerBackVisible: false }} />
        <Stack.Screen name="edit-profile"           options={{ title: 'Edit Profile' }} />
        <Stack.Screen name="video-profile-recorder" options={{ headerShown: false }} />
        <Stack.Screen name="height-verification"    options={{ title: 'Verify Height' }} />
        <Stack.Screen name="selfie-verification"    options={{ title: 'Verify Identity' }} />
        <Stack.Screen name="daily-question"         options={{ headerShown: false }} />
        <Stack.Screen name="second-look"            options={{ headerShown: false }} />
        <Stack.Screen name="dating-stats"           options={{ headerShown: false }} />
        <Stack.Screen name="achievements"           options={{ headerShown: false }} />
        <Stack.Screen name="interests"              options={{ headerShown: false }} />
        <Stack.Screen name="deal-breakers"          options={{ headerShown: false }} />
        <Stack.Screen name="icebreaker-game"        options={{ headerShown: false }} />
        <Stack.Screen name="compatibility-quiz"     options={{ headerShown: false }} />
        <Stack.Screen name="voice-intro-recorder"   options={{ headerShown: false }} />
        <Stack.Screen name="smart-photos"           options={{ headerShown: false }} />
        <Stack.Screen name="relationship-mode"      options={{ headerShown: false }} />
        <Stack.Screen name="stories"                options={{ headerShown: false }} />
        <Stack.Screen name="super-likes"            options={{ headerShown: false }} />
        <Stack.Screen name="shared-playlist"        options={{ headerShown: false }} />
        <Stack.Screen name="date-safety"            options={{ headerShown: false }} />
        <Stack.Screen name="date-checkin"           options={{ headerShown: false }} />
        <Stack.Screen name="post-date-rating"       options={{ title: 'Rate Experience' }} />
        <Stack.Screen name="blocked-users"          options={{ title: 'Blocked Users' }} />
        <Stack.Screen name="settings"               options={{ title: 'Settings' }} />
        <Stack.Screen name="referral"               options={{ title: 'Invite Friends' }} />
        <Stack.Screen name="referral-leaderboard"   options={{ title: 'Leaderboard' }} />
        <Stack.Screen name="profile-views"          options={{ title: 'Profile Views' }} />
        <Stack.Screen name="social-verification"    options={{ headerShown: false }} />
        <Stack.Screen name="date-spot-reviews"      options={{ headerShown: false }} />
        <Stack.Screen name="privacy"                options={{ title: 'Privacy Policy' }} />
        <Stack.Screen name="terms"                  options={{ title: 'Terms of Service' }} />
        <Stack.Screen name="admin/index"            options={{ title: 'Admin Dashboard' }} />
        <Stack.Screen name="admin/reports"          options={{ title: 'User Reports' }} />
        <Stack.Screen name="admin/users"            options={{ title: 'Manage Users' }} />
        <Stack.Screen name="admin/stats"            options={{ title: 'Statistics' }} />
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
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer:   { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e', padding: 32 },
  errorEmoji:       { fontSize: 48, marginBottom: 16 },
  errorText:        { fontSize: 20, fontWeight: 'bold', color: '#ffffff', marginBottom: 8 },
  errorSubtext:     { fontSize: 14, color: '#aaaaaa', marginBottom: 24 },
  retryButton:      { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 25 },
  retryButtonText:  { color: '#fff', fontSize: 16, fontWeight: '600' },
});