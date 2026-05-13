import '../src/styles/unistyles';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  type AppStateStatus,
  BackHandler,
  Platform,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import ProfileCompletionCard from '../components/ProfileCompletionCard';
import { EmptyMatchesCard }  from '../src/components/home/EmptyMatchesCard';
import { ErrorScreen }       from '../src/components/home/ErrorScreen';
import { HomeScreenSkeleton } from '../src/components/home/SkeletonBox';
import { homeReducer, initialState } from '../src/components/home/homeReducer';
import { NavigationGrid, buildNavHeightCache } from '../src/components/home/NavigationGrid';
import { OfflineBanner }    from '../src/components/home/OfflineBanner';
import { ProfileHeader }    from '../src/components/home/ProfileHeader';
import { PromptCard }       from '../src/components/home/PromptCard';
import { StrengthCard }     from '../src/components/home/StrengthCard';
import type { AppRoute, NavItem, NotificationData } from '../src/components/home/types';
import { CHAMPION_THRESHOLD } from '../src/components/home/types';
import { auth, db } from '../firebaseConfig';
import { hasAnsweredToday } from '../utils/dailyQuestions';
import { logger } from '../utils/logger';
import { addNotificationResponseListener, registerForPushNotifications } from '../utils/notifications';
import { setOffline, updateLastSeen } from '../utils/onlineStatus';
import { calculateProfileStrength, type ProfileStrengthResult } from '../utils/profileStrength';
import { updateLoginStreak } from '../utils/streakTracker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scheduleIdleTask(cb: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb);
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 100);
  return () => clearTimeout(id);
}

const getGreeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const maskEmail = (e: string) => {
  const [l, d] = e.split('@');
  if (!d || !l) return e;
  if (l.length <= 2) return `${l}@${d}`;
  return `${l[0]}${'*'.repeat(Math.min(l.length - 2, 6))}${l[l.length - 1]}@${d}`;
};

const PRESENCE_INTERVAL_MS = 120_000;

// ─── HomeScreen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router        = useRouter();
  const insets        = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion() ?? false;

  const [state, dispatch] = useReducer(homeReducer, initialState);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const {
    loading, refreshing, error, userData, loginStreak, longestStreak,
    profileStrength, showDailyQuestion, isOnline, loggingOut,
    authReady, userId, userEmail,
  } = state;

  const userName        = userData?.name           ?? 'User';
  const userPhoto       = userData?.photos?.[0]    ?? '';
  const personalityType = userData?.personalityType ?? '';
  const isAdmin         = userData?.isAdmin         === true;
  const selfieVerified  = userData?.selfieVerified  === true;
  const profileViews    = userData?.profileViews    ?? 0;
  const referralCount   = userData?.referralCount   ?? 0;
  const matchCount      = userData?.matchCount      ?? 0;
  const isChampion      = referralCount >= CHAMPION_THRESHOLD;
  const maskedEmail     = userEmail ? maskEmail(userEmail) : '';

  const computedStrength = useMemo<ProfileStrengthResult | null>(
    () => userData ? calculateProfileStrength(userData) : null,
    [userData],
  );

  useEffect(() => {
    dispatch({ type: 'SET_PROFILE_STRENGTH', payload: computedStrength });
  }, [computedStrength]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      if (!isMountedRef.current) return;
      dispatch({
        type: 'SET_AUTH',
        payload: { ready: true, userId: user?.uid ?? null, email: user?.email ?? null },
      });
      if (!user) dispatch({ type: 'SET_LOADING', payload: false });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (authReady && !userId) router.replace('/login' as AppRoute);
  }, [authReady, userId, router]);

  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { key: 'matches',      label: '💕 My Matches',        route: '/my-matches',       colorKey: 'success' },
      { key: 'find',         label: '🔍 Find Matches',      route: '/matches',           colorKey: 'primary' },
      { key: 'second',       label: '👀 Second Look',       route: '/second-look',       colorKey: 'purple'  },
      { key: 'quiz',         label: '🧠 Personality Quiz',  route: '/personality-quiz',  colorKey: 'orange'  },
      { key: 'edit',         label: '✏️ Edit Profile',      route: '/edit-profile',      colorKey: 'blue'    },
      { key: 'stats',        label: '📊 Your Stats',        route: '/dating-stats',      colorKey: 'teal'    },
      { key: 'stories',      label: '📖 Stories',           route: '/stories',           colorKey: 'purple'  },
      { key: 'safety',       label: '🛡️ Date Safety',      route: '/date-checkin',      colorKey: 'success' },
      { key: 'relationship', label: '💕 Relationship Mode', route: '/relationship-mode', colorKey: 'red'     },
      { key: 'spots',        label: '📍 Date Spots',        route: '/date-spot-reviews', colorKey: 'orange'  },
      { key: 'settings',     label: '⚙️ Settings',          route: '/settings',          colorKey: 'dim'     },
      { key: 'referral',     label: '🌟 Invite Friends',    route: '/referral',          colorKey: 'gold', badge: referralCount > 0 ? referralCount : undefined },
      { key: 'admin',        label: '👮 Admin Panel',       route: '/admin',             colorKey: 'purple', show: isAdmin, isBordered: true },
    ];
    if (__DEV__) items.push({ key: 'debug', label: '🐛 Debug', route: '/debug', colorKey: 'dim' });
    return items.filter(i => i.show !== false);
  }, [isAdmin, referralCount]);

  const navHeightCache = useMemo(
    () => buildNavHeightCache(navItems, screenWidth),
    [navItems, screenWidth],
  );

  const loadUserData = useCallback(async () => {
    if (!userId) return;
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    try {
      await currentUser.reload();
      await currentUser.getIdToken(true);
    } catch (err: unknown) {
      logger.error('Account no longer valid:', (err as { code?: string })?.code);
      await auth.signOut().catch(() => {});
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'users', userId));
      if (!isMountedRef.current) return;
      if (!snap.exists()) { router.replace('/profile-setup' as AppRoute); return; }
      const data = snap.data() as NonNullable<typeof userData>;
      dispatch({ type: 'SET_USER_DATA', payload: data });
      dispatch({ type: 'SET_STREAK', payload: { current: data.loginStreak ?? 0, longest: data.longestStreak ?? 0 } });
    } catch (err: unknown) {
      logger.error('loadUserData failed:', err);
      if (isMountedRef.current) dispatch({ type: 'SET_ERROR', payload: 'Failed to load your profile. Please try again.' });
    } finally {
      if (isMountedRef.current) dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [userId, router]);

  const trackStreak = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await updateLoginStreak();
      if (isMountedRef.current) dispatch({ type: 'SET_STREAK', payload: { current: r.currentStreak, longest: r.longestStreak } });
    } catch (err: unknown) {
      logger.error('trackStreak failed:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || !authReady) return;
    return scheduleIdleTask(() => { void loadUserData(); void trackStreak(); });
  }, [userId, authReady, loadUserData, trackStreak]);

  const onRefresh = useCallback(async () => {
    dispatch({ type: 'SET_REFRESHING', payload: true });
    try {
      await Promise.all([loadUserData(), trackStreak()]);
      const answered = await hasAnsweredToday();
      if (isMountedRef.current) dispatch({ type: 'SET_DAILY_QUESTION', payload: !answered });
    } catch (err: unknown) {
      logger.warn('refresh failed:', err);
    } finally {
      if (isMountedRef.current) dispatch({ type: 'SET_REFRESHING', payload: false });
    }
  }, [loadUserData, trackStreak]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const answered = await hasAnsweredToday();
        if (!cancelled && isMountedRef.current) dispatch({ type: 'SET_DAILY_QUESTION', payload: !answered });
      } catch (err: unknown) { logger.error('dailyQuestion check failed:', err); }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void updateLastSeen();
    const interval = setInterval(() => { void updateLastSeen(); }, PRESENCE_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void updateLastSeen();
      else void setOffline();
    });
    return () => { clearInterval(interval); sub.remove(); void setOffline(); };
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => {
        if (isMountedRef.current) dispatch({ type: 'SET_ONLINE', payload: navigator.onLine });
      };
      dispatch({ type: 'SET_ONLINE', payload: navigator.onLine });
      window.addEventListener('online',  update);
      window.addEventListener('offline', update);
      return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
    }
    dispatch({ type: 'SET_ONLINE', payload: true });
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && isMountedRef.current) dispatch({ type: 'SET_ONLINE', payload: true });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void registerForPushNotifications().catch(() => {});
    const sub = addNotificationResponseListener(response => {
      const data = response.notification.request.content.data as NotificationData;
      if (data?.type === 'match')        router.push('/my-matches' as AppRoute);
      else if (data?.type === 'message') router.push({ pathname: '/chat' as AppRoute, params: { matchId: data.matchId ?? '', matchName: data.matchName ?? '' } });
      else if (data?.type === 'profile_view') router.push('/profile-views' as AppRoute);
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Exit App', 'Are you sure you want to exit?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    });
    return () => h.remove();
  }, []);

  useEffect(() => {
    if (!loading && userData) {
      AccessibilityInfo.announceForAccessibility(
        `Home screen loaded. ${getGreeting()}, ${userName}.` +
        `${loginStreak > 1 ? ` ${loginStreak} day login streak.` : ''}` +
        `${profileStrength ? ` Profile strength ${profileStrength.score} percent.` : ''}`,
      );
    }
  }, [loading, userData, userName, loginStreak, profileStrength]);

  const handleNav = useCallback((route: AppRoute) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push(route as AppRoute);
  }, [router]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out', style: 'destructive', onPress: async () => {
          dispatch({ type: 'SET_LOGGING_OUT', payload: true });
          try {
            await setOffline();
            await signOut(auth);
            router.replace('/login' as AppRoute);
          } catch (err: unknown) {
            logger.error('logout failed:', err);
            if (isMountedRef.current) dispatch({ type: 'SET_LOGGING_OUT', payload: false });
            Alert.alert('Error', 'Failed to log out. Please try again.');
          }
        },
      },
    ]);
  }, [loggingOut, router]);

  const handleRetry = useCallback(() => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR',   payload: null });
    void loadUserData();
    void trackStreak();
  }, [loadUserData, trackStreak]);

  const handleEditProfile   = useCallback(() => handleNav('/edit-profile'),   [handleNav]);
  const handleDailyQuestion = useCallback(() => handleNav('/daily-question'), [handleNav]);
  const handleFindMatches   = useCallback(() => handleNav('/matches'),         [handleNav]);
  const handleProfileViews  = useCallback(() => handleNav('/profile-views'),   [handleNav]);

  const animIndices = useMemo(() => {
    let n = 0;
    return {
      strength:     profileStrength != null            ? n++ : -1,
      dailyQ:       showDailyQuestion                  ? n++ : -1,
      profileViews: profileViews > 0                   ? n++ : -1,
      emptyMatches: matchCount === 0 && userData != null ? n++ : -1,
      navStart:     n,
    };
  }, [profileStrength, showDailyQuestion, profileViews, matchCount, userData]);

  const contentStyle = useMemo(
    () => [styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }],
    [insets.top, insets.bottom],
  );

  const refreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />,
    [refreshing, onRefresh],
  );

  if (loading || !authReady) {
    return (
      <>
        <StatusBar style="auto" />
        <HomeScreenSkeleton insets={insets} />
      </>
    );
  }
  if (error) {
    return (
      <>
        <StatusBar style="auto" />
        <ErrorScreen error={error} onRetry={handleRetry} />
      </>
    );
  }
  if (!userId) return null;

  return (
    <>
      <StatusBar style="auto" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={contentStyle}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel="Home screen content"
      >
        {!isOnline && <OfflineBanner />}

        <ProfileHeader
          userPhoto={userPhoto}
          selfieVerified={selfieVerified}
          isChampion={isChampion}
          userName={userName}
          loginStreak={loginStreak}
          longestStreak={longestStreak}
          personalityType={personalityType}
          maskedEmail={maskedEmail}
          reducedMotion={reducedMotion}
        />

        {profileStrength != null && (
          <StrengthCard
            profileStrength={profileStrength}
            onPress={handleEditProfile}
            reducedMotion={reducedMotion}
            index={animIndices.strength}
          />
        )}

        {showDailyQuestion && (
          <PromptCard
            icon="💭"
            title="Today's Question"
            subtitle="Answer to boost your profile!"
            onPress={handleDailyQuestion}
            variant="purple"
            reducedMotion={reducedMotion}
            index={animIndices.dailyQ}
            a11yLabel="Today's daily question. Tap to answer and boost your profile."
            a11yHint="Double tap to open the daily question"
          />
        )}

        {profileViews > 0 && (
          <PromptCard
            icon="👀"
            title={`${profileViews}`}
            subtitle="people viewed your profile"
            onPress={handleProfileViews}
            variant="orange"
            reducedMotion={reducedMotion}
            index={animIndices.profileViews}
            a11yLabel={`${profileViews} people viewed your profile. Tap to see who.`}
            a11yHint="Double tap to see who viewed your profile"
          />
        )}

        {matchCount === 0 && userData != null && (
          <EmptyMatchesCard
            onPress={handleFindMatches}
            reducedMotion={reducedMotion}
            index={animIndices.emptyMatches}
          />
        )}

        {userData != null && <ProfileCompletionCard userData={userData} showDetails />}

        <NavigationGrid
          navItems={navItems}
          onNav={handleNav}
          onLogout={handleLogout}
          loggingOut={loggingOut}
          reducedMotion={reducedMotion}
          screenWidth={screenWidth}
          startIndex={animIndices.navStart}
          heightCache={navHeightCache}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll:   { flex: 1, backgroundColor: theme.colors.background },
  content:  { alignItems: 'center', paddingHorizontal: theme.spacing.xl },
}));