import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  AppStateStatus,
  BackHandler,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  FadeInUp,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ProfileCompletionCard from '../components/ProfileCompletionCard';
import { auth, db } from '../firebaseConfig';
import { hasAnsweredToday } from '../utils/dailyQuestions';
import { logger } from '../utils/logger';
import {
  addNotificationResponseListener,
  registerForPushNotifications,
} from '../utils/notifications';
import { setOffline, updateLastSeen } from '../utils/onlineStatus';
import {
  calculateProfileStrength,
  type ProfileStrengthResult,
} from '../utils/profileStrength';
import { updateLoginStreak } from '../utils/streakTracker';

// ─── Design Tokens ────────────────────────────────────────

const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
} as const;

const FONT_SIZE = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 18,
  xxl: 24,
  xxxl: 28,
  display: 40,
} as const;

const RADIUS = {
  sm: 5,
  md: 12,
  lg: 15,
  xl: 25,
  full: 50,
} as const;

const AVATAR_SIZE = 100;
const MAX_FONT_SCALE = 1.5;
const PRESENCE_INTERVAL_MS = 120_000;
const CHAMPION_THRESHOLD = 10;

const LIGHT_THEME = {
  bg: '#f5f5f7',
  card: '#ffffff',
  border: '#e0e0e0',
  primary: '#3a8a9a',
  success: '#34a853',
  danger: '#ea4335',
  orange: '#e67e22',
  purple: '#8e44ad',
  blue: '#2979ff',
  teal: '#00897b',
  red: '#e53935',
  gold: '#f9a825',
  amber: '#ff8f00',
  text: '#1a1a2e',
  sub: '#555555',
  muted: '#777777',
  dim: '#999999',
  white: '#ffffff',
  skeleton: '#e0e0e0',
} as const;

const DARK_THEME = {
  bg: '#1a1a2e',
  card: '#16213e',
  border: '#0f3460',
  primary: '#53a8b6',
  success: '#5cb85c',
  danger: '#d9534f',
  orange: '#e67e22',
  purple: '#9b59b6',
  blue: '#3498db',
  teal: '#1abc9c',
  red: '#e74c3c',
  gold: '#f1c40f',
  amber: '#f39c12',
  text: '#eeeeee',
  sub: '#aaaaaa',
  muted: '#999999',
  dim: '#777777',
  white: '#ffffff',
  skeleton: '#253454',
} as const;

type ThemeColors = typeof DARK_THEME;

// ─── Types ────────────────────────────────────────────────

interface UserData {
  name?: string;
  photos?: string[];
  personalityType?: string;
  isAdmin?: boolean;
  selfieVerified?: boolean;
  profileViews?: number;
  referralCount?: number;
  loginStreak?: number;
  longestStreak?: number;
  matchCount?: number;
  profileComplete?: boolean;
  age?: number;
  bio?: string;
  gender?: string;
  interestedIn?: string;
  [key: string]: unknown;
}

interface NavItem {
  key: string;
  label: string;
  route: AppRoute;
  color: string;
  show?: boolean;
  badge?: number;
  borderColor?: string;
  a11yHint?: string;
}

type AppRoute =
  | '/login'
  | '/my-matches'
  | '/matches'
  | '/second-look'
  | '/personality-quiz'
  | '/edit-profile'
  | '/dating-stats'
  | '/stories'
  | '/date-checkin'
  | '/relationship-mode'
  | '/date-spot-reviews'
  | '/settings'
  | '/referral'
  | '/admin'
  | '/daily-question'
  | '/profile-views'
  | '/chat'
  | '/debug'
  | '/profile-setup';

interface NotificationData {
  type?: 'match' | 'message' | 'profile_view';
  matchId?: string;
  matchName?: string;
}

interface HomeState {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  userData: UserData | null;
  loginStreak: number;
  longestStreak: number;
  profileStrength: ProfileStrengthResult | null;
  showDailyQuestion: boolean;
  isOnline: boolean;
  loggingOut: boolean;
  authReady: boolean;
  userId: string | null;
  userEmail: string | null;
}

type HomeAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_REFRESHING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_USER_DATA'; payload: UserData }
  | { type: 'SET_STREAK'; payload: { current: number; longest: number } }
  | { type: 'SET_PROFILE_STRENGTH'; payload: ProfileStrengthResult | null }
  | { type: 'SET_DAILY_QUESTION'; payload: boolean }
  | { type: 'SET_ONLINE'; payload: boolean }
  | { type: 'SET_LOGGING_OUT'; payload: boolean }
  | { type: 'SET_AUTH'; payload: { ready: boolean; userId: string | null; email: string | null } }
  | { type: 'RESET' };

// ─── Pure Helpers ─────────────────────────────────────────

function strengthColor(score: number, COL: ThemeColors): string {
  if (score >= 80) return COL.success;
  if (score >= 60) return COL.orange;
  if (score >= 40) return COL.gold;
  return COL.danger;
}

function strengthEmoji(score: number): string {
  if (score >= 90) return '💪🔥';
  if (score >= 80) return '💪';
  if (score >= 60) return '👍';
  if (score >= 40) return '🔨';
  return '🚧';
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 2) return `${local}@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}@${domain}`;
}

/**
 * Checks whether a user has completed enough of their profile
 * to be shown the home screen, or should be redirected to profile setup.
 * Requires: name, age, gender, interestedIn, at least 1 photo.
 */
function isProfileComplete(data: UserData): boolean {
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

// ─── Reducer ──────────────────────────────────────────────

const initialState: HomeState = {
  loading: true,
  refreshing: false,
  error: null,
  userData: null,
  loginStreak: 0,
  longestStreak: 0,
  profileStrength: null,
  showDailyQuestion: false,
  isOnline: true,
  loggingOut: false,
  authReady: false,
  userId: null,
  userEmail: null,
};

function homeReducer(state: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_REFRESHING':
      return { ...state, refreshing: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    case 'SET_USER_DATA':
      return { ...state, userData: action.payload, error: null };
    case 'SET_STREAK':
      return {
        ...state,
        loginStreak: action.payload.current,
        longestStreak: action.payload.longest,
      };
    case 'SET_PROFILE_STRENGTH':
      return { ...state, profileStrength: action.payload };
    case 'SET_DAILY_QUESTION':
      return { ...state, showDailyQuestion: action.payload };
    case 'SET_ONLINE':
      return { ...state, isOnline: action.payload };
    case 'SET_LOGGING_OUT':
      return { ...state, loggingOut: action.payload };
    case 'SET_AUTH':
      return {
        ...state,
        authReady: action.payload.ready,
        userId: action.payload.userId,
        userEmail: action.payload.email,
      };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// ─── Skeleton ─────────────────────────────────────────────

function SkeletonBox({
  width,
  height,
  radius = RADIUS.md,
  style,
  color,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: object;
  color: string;
}) {
  return (
    <View
      style={[
        {
          width: width as any,
          height,
          borderRadius: radius,
          backgroundColor: color,
          opacity: 0.6,
        },
        style,
      ]}
    />
  );
}

function HomeScreenSkeleton({
  COL,
  insets,
}: {
  COL: ThemeColors;
  insets: { top: number; bottom: number };
}) {
  return (
    <View style={[styles.scroll, { backgroundColor: COL.bg }]}>
      <View
        style={[
          styles.scrollContent,
          {
            paddingTop: insets.top + SPACING.xl,
            paddingBottom: insets.bottom + SPACING.xxxxl,
          },
        ]}
      >
        <View style={styles.profileHeader}>
          <SkeletonBox
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            radius={RADIUS.full}
            color={COL.skeleton}
          />
          <SkeletonBox
            width={140}
            height={18}
            style={{ marginTop: SPACING.lg }}
            color={COL.skeleton}
          />
          <SkeletonBox
            width={200}
            height={30}
            style={{ marginTop: SPACING.sm }}
            color={COL.skeleton}
          />
        </View>
        <SkeletonBox
          width="100%"
          height={120}
          radius={RADIUS.lg}
          style={{ marginTop: SPACING.xl }}
          color={COL.skeleton}
        />
        <SkeletonBox
          width="100%"
          height={70}
          radius={RADIUS.lg}
          style={{ marginTop: SPACING.lg }}
          color={COL.skeleton}
        />
        <View style={[styles.skeletonGrid, { marginTop: SPACING.xl }]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBox
              key={i}
              width="48%"
              height={56}
              radius={RADIUS.xl}
              color={COL.skeleton}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Offline Banner ───────────────────────────────────────

function OfflineBanner({ COL }: { COL: ThemeColors }) {
  const shouldAnimate = Platform.OS !== 'web';
  const Wrapper = shouldAnimate ? Animated.View : View;
  const enterProps = shouldAnimate ? { entering: FadeInUp.duration(300) } : {};

  return (
    <Wrapper
      {...enterProps}
      style={[styles.offlineBanner, { backgroundColor: COL.danger }]}
      accessibilityRole="alert"
      accessibilityLabel="You are offline. Some features may not work."
    >
      <Text
        style={[styles.offlineBannerText, { color: COL.white }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        📡 You're offline — some features may be unavailable
      </Text>
    </Wrapper>
  );
}

// ─── Error Screen ─────────────────────────────────────────

function ErrorScreen({
  error,
  onRetry,
  COL,
}: {
  error: string;
  onRetry: () => void;
  COL: ThemeColors;
}) {
  return (
    <View style={[styles.centered, { backgroundColor: COL.bg }]}>
      <Text style={{ fontSize: FONT_SIZE.display, marginBottom: SPACING.lg }}>
        😕
      </Text>
      <Text
        style={[styles.errorText, { color: COL.text }]}
        accessibilityRole="alert"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {error}
      </Text>
      <TouchableOpacity
        style={[styles.retryBtn, { backgroundColor: COL.primary }]}
        onPress={onRetry}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Retry loading"
      >
        <Text
          style={[styles.retryBtnText, { color: COL.white }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          Try Again
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Profile Header ───────────────────────────────────────

function ProfileHeader({
  userPhoto,
  selfieVerified,
  isChampion,
  userName,
  loginStreak,
  longestStreak,
  personalityType,
  maskedEmail,
  COL,
  reducedMotion,
}: {
  userPhoto: string;
  selfieVerified: boolean;
  isChampion: boolean;
  userName: string;
  loginStreak: number;
  longestStreak: number;
  personalityType: string;
  maskedEmail: string;
  COL: ThemeColors;
  reducedMotion: boolean;
}) {
  const greeting = getGreeting();
  const shouldAnimate = !reducedMotion && Platform.OS !== 'web';
  const Wrapper = shouldAnimate ? Animated.View : View;
  const enterProps = shouldAnimate ? { entering: FadeInDown.duration(500) } : {};

  return (
    <Wrapper {...enterProps}>
      <View style={styles.profileHeader}>
        <View style={styles.photoWrap}>
          {userPhoto ? (
            <Image
              source={{ uri: userPhoto }}
              style={[styles.photo, { borderColor: COL.primary }]}
              contentFit="cover"
              transition={200}
              accessibilityLabel={`${userName}'s profile photo`}
              accessibilityRole="image"
            />
          ) : (
            <View
              style={[
                styles.photoPlaceholder,
                { backgroundColor: COL.card, borderColor: COL.primary },
              ]}
              accessibilityLabel="No profile photo set"
            >
              <Text style={[styles.photoPlaceholderText, { color: COL.dim }]}>
                ?
              </Text>
            </View>
          )}

          {selfieVerified && (
            <View
              style={[
                styles.verifiedBadge,
                { backgroundColor: COL.blue, borderColor: COL.bg },
              ]}
              accessibilityLabel="Selfie verified"
            >
              <Text style={[styles.verifiedIcon, { color: COL.white }]}>✓</Text>
            </View>
          )}

          {isChampion && (
            <View
              style={[
                styles.championBadge,
                { backgroundColor: COL.gold, borderColor: COL.bg },
              ]}
              accessibilityLabel="Community champion"
            >
              <Text style={styles.championIcon}>🌟</Text>
            </View>
          )}
        </View>

        <Text
          style={[styles.welcomeText, { color: COL.sub }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {greeting},
        </Text>
        <Text
          style={[styles.userName, { color: COL.text }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityRole="header"
        >
          {userName}!
        </Text>

        {loginStreak > 1 && (
          <View style={[styles.streakBadge, { backgroundColor: COL.orange }]}>
            <Text
              style={[styles.streakText, { color: COL.white }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              accessibilityLabel={`${loginStreak} day login streak${
                loginStreak === longestStreak && loginStreak >= 7
                  ? ', personal best!'
                  : ''
              }`}
            >
              🔥 {loginStreak}-day streak!
              {loginStreak === longestStreak && loginStreak >= 7
                ? ' (Personal best!)'
                : ''}
            </Text>
          </View>
        )}

        {loginStreak === 1 && (
          <View
            style={[
              styles.streakBadge,
              {
                backgroundColor: COL.card,
                borderWidth: 1,
                borderColor: COL.orange,
              },
            ]}
          >
            <Text
              style={[styles.streakText, { color: COL.orange }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              🔥 Come back tomorrow to start a streak!
            </Text>
          </View>
        )}

        {isChampion && (
          <View style={[styles.championLabel, { backgroundColor: COL.gold }]}>
            <Text
              style={[styles.championLabelText, { color: COL.bg }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              🌟 Community Champion
            </Text>
          </View>
        )}

        {personalityType !== '' && (
          <View
            style={[styles.personalityBadge, { backgroundColor: COL.orange }]}
          >
            <Text
              style={[styles.personalityBadgeText, { color: COL.white }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              accessibilityLabel={`Personality type: ${personalityType}`}
            >
              {personalityType}
            </Text>
          </View>
        )}

        <Text
          style={[styles.email, { color: COL.primary }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityLabel={`Email: ${maskedEmail}`}
        >
          {maskedEmail}
        </Text>
      </View>
    </Wrapper>
  );
}

// ─── Strength Card ────────────────────────────────────────

function StrengthCard({
  profileStrength,
  onPress,
  COL,
  reducedMotion,
  index,
}: {
  profileStrength: ProfileStrengthResult;
  onPress: () => void;
  COL: ThemeColors;
  reducedMotion: boolean;
  index: number;
}) {
  const shouldAnimate = !reducedMotion && Platform.OS !== 'web';
  const Wrapper = shouldAnimate ? Animated.View : View;
  const enterProps = shouldAnimate
    ? { entering: FadeInDown.delay(index * 80).duration(400) }
    : {};
  const sColor = strengthColor(profileStrength.score, COL);
  const sEmoji = strengthEmoji(profileStrength.score);

  return (
    <Wrapper {...enterProps} style={{ width: '100%' }}>
      <TouchableOpacity
        style={[
          styles.strengthCard,
          { backgroundColor: COL.card, borderColor: COL.primary },
        ]}
        onPress={onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Profile strength ${profileStrength.score}%. ${profileStrength.label}. Tap to edit profile.`}
      >
        <View style={styles.strengthHeader}>
          <Text
            style={[styles.strengthTitle, { color: COL.text }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {sEmoji} Profile Strength
          </Text>
          <Text
            style={[styles.strengthScore, { color: sColor }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {profileStrength.score}%
          </Text>
        </View>

        <View style={[styles.strengthBarBg, { backgroundColor: COL.border }]}>
          <View
            style={[
              styles.strengthBarFill,
              {
                width: `${profileStrength.score}%` as `${number}%`,
                backgroundColor: sColor,
              },
            ]}
          />
        </View>

        <Text
          style={[styles.strengthLabel, { color: COL.muted }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {profileStrength.label}
        </Text>

        {(profileStrength.suggestions?.length ?? 0) > 0 &&
          profileStrength.score < 100 && (
            <View
              style={[
                styles.suggestionsWrap,
                { borderTopColor: COL.border },
              ]}
            >
              <Text
                style={[styles.suggestionsTitle, { color: COL.primary }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                💡 Tips to improve:
              </Text>
              {(profileStrength.suggestions ?? []).slice(0, 2).map((tip, i) => (
                <Text
                  key={i}
                  style={[styles.suggestionText, { color: COL.sub }]}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                >
                  • {tip}
                </Text>
              ))}
              <Text
                style={[styles.tapHint, { color: COL.primary }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                Tap to edit profile →
              </Text>
            </View>
          )}

        {profileStrength.score >= 100 && (
          <View style={styles.perfectWrap}>
            <Text
              style={[styles.perfectText, { color: COL.success }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              🎉 Your profile is perfect!
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Wrapper>
  );
}

// ─── Prompt Card ──────────────────────────────────────────

function PromptCard({
  icon,
  title,
  subtitle,
  onPress,
  borderColor,
  accentColor,
  COL,
  reducedMotion,
  index,
  a11yLabel,
  rightContent,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  borderColor: string;
  accentColor: string;
  COL: ThemeColors;
  reducedMotion: boolean;
  index: number;
  a11yLabel: string;
  rightContent?: React.ReactNode;
}) {
  const shouldAnimate = !reducedMotion && Platform.OS !== 'web';
  const Wrapper = shouldAnimate ? Animated.View : View;
  const enterProps = shouldAnimate
    ? { entering: FadeInDown.delay(index * 80).duration(400) }
    : {};

  return (
    <Wrapper {...enterProps} style={{ width: '100%' }}>
      <TouchableOpacity
        style={[styles.promptCard, { backgroundColor: COL.card, borderColor }]}
        onPress={onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
      >
        <View style={styles.promptLeft}>
          <Text style={styles.promptIcon} accessibilityElementsHidden>
            {icon}
          </Text>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.promptTitle, { color: accentColor }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {title}
            </Text>
            <Text
              style={[styles.promptSub, { color: COL.muted }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {subtitle}
            </Text>
          </View>
        </View>
        {rightContent ?? (
          <Text
            style={[styles.promptArrow, { color: accentColor }]}
            accessibilityElementsHidden
          >
            →
          </Text>
        )}
      </TouchableOpacity>
    </Wrapper>
  );
}

// ─── Empty Matches Card ───────────────────────────────────

function EmptyMatchesCard({
  COL,
  onPress,
  reducedMotion,
  index,
}: {
  COL: ThemeColors;
  onPress: () => void;
  reducedMotion: boolean;
  index: number;
}) {
  const shouldAnimate = !reducedMotion && Platform.OS !== 'web';
  const Wrapper = shouldAnimate ? Animated.View : View;
  const enterProps = shouldAnimate
    ? { entering: FadeInDown.delay(index * 80).duration(400) }
    : {};

  return (
    <Wrapper {...enterProps} style={{ width: '100%' }}>
      <TouchableOpacity
        style={[
          styles.emptyMatchesCard,
          { backgroundColor: COL.card, borderColor: COL.primary },
        ]}
        onPress={onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="No matches yet. Tap to start finding matches."
      >
        <Text style={styles.emptyMatchesEmoji}>💫</Text>
        <Text
          style={[styles.emptyMatchesTitle, { color: COL.text }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          Start finding your match!
        </Text>
        <Text
          style={[styles.emptyMatchesSub, { color: COL.muted }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          Swipe to discover people who are right for you
        </Text>
      </TouchableOpacity>
    </Wrapper>
  );
}

// ─── Navigation Grid ──────────────────────────────────────

function NavigationGrid({
  navItems,
  onNav,
  onLogout,
  loggingOut,
  COL,
  reducedMotion,
  screenWidth,
  startIndex,
}: {
  navItems: NavItem[];
  onNav: (route: AppRoute) => void;
  onLogout: () => void;
  loggingOut: boolean;
  COL: ThemeColors;
  reducedMotion: boolean;
  screenWidth: number;
  startIndex: number;
}) {
  const isWide = screenWidth >= 600;
  const btnWidth = isWide ? '48%' : ('100%' as any);

  return (
    <View style={[styles.buttonsWrap, isWide && styles.buttonsWrapGrid]}>
      {navItems.map((item, i) => {
        const shouldAnimate = !reducedMotion && Platform.OS !== 'web';
        const Wrapper = shouldAnimate ? Animated.View : View;
        const enterProps = shouldAnimate
          ? { entering: FadeInDown.delay((startIndex + i) * 60).duration(350) }
          : {};

        return (
          <Wrapper key={item.key} {...enterProps} style={{ width: btnWidth }}>
            <TouchableOpacity
              style={[
                styles.navBtn,
                { backgroundColor: item.color },
                item.borderColor != null && {
                  borderWidth: 2,
                  borderColor: item.borderColor,
                },
              ]}
              onPress={() => onNav(item.route)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={item.label.replace(/^\S+\s/, '')}
              accessibilityHint={
                item.a11yHint ??
                `Opens ${item.label.replace(/^\S+\s/, '')}`
              }
            >
              <Text
                style={[styles.navBtnText, { color: COL.white }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {item.label}
              </Text>
              {item.badge != null && item.badge > 0 && (
                <View style={[styles.navBadge, { backgroundColor: COL.bg }]}>
                  <Text
                    style={[styles.navBadgeText, { color: COL.gold }]}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    accessibilityLabel={`${item.badge} notifications`}
                  >
                    {item.badge}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </Wrapper>
        );
      })}

      {/* Logout button */}
      {(() => {
        const shouldAnimateLogout = !reducedMotion && Platform.OS !== 'web';
        const LogoutWrapper = shouldAnimateLogout ? Animated.View : View;
        const logoutEnterProps = shouldAnimateLogout
          ? {
              entering: FadeInDown.delay(
                (startIndex + navItems.length) * 60
              ).duration(350),
            }
          : {};

        return (
          <LogoutWrapper
            {...logoutEnterProps}
            style={{ width: btnWidth }}
          >
            <TouchableOpacity
              style={[styles.logoutBtn, { borderColor: COL.danger }]}
              onPress={onLogout}
              activeOpacity={0.8}
              disabled={loggingOut}
              accessibilityRole="button"
              accessibilityLabel="Log out"
              accessibilityHint="Signs you out of the app"
            >
              <Text
                style={[styles.logoutBtnText, { color: COL.danger }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {loggingOut ? '⏳ Logging out…' : '🚪 Log Out'}
              </Text>
            </TouchableOpacity>
          </LogoutWrapper>
        );
      })()}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────

/**
 * Home screen dashboard.
 *
 * ROUTING LOGIC:
 *  - No user  → /login
 *  - User exists but profile incomplete → /profile-setup
 *  - User exists and profile complete   → show home screen
 */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { width: screenWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion() ?? false;

  const COL: ThemeColors = colorScheme === 'light' ? LIGHT_THEME : DARK_THEME;

  const [state, dispatch] = useReducer(homeReducer, initialState);
  const isMountedRef = useRef(true);

  const {
    loading,
    refreshing,
    error,
    userData,
    loginStreak,
    longestStreak,
    profileStrength,
    showDailyQuestion,
    isOnline,
    loggingOut,
    authReady,
    userId,
    userEmail,
  } = state;

  // ── Derived values ─────────────────────────────────────
  const userName = userData?.name ?? 'User';
  const userPhoto = userData?.photos?.[0] ?? '';
  const personalityType = userData?.personalityType ?? '';
  const isAdmin = !!(userData?.isAdmin);
  const selfieVerified = !!(userData?.selfieVerified);
  const profileViews = userData?.profileViews ?? 0;
  const referralCount = userData?.referralCount ?? 0;
  const matchCount = userData?.matchCount ?? 0;
  const isChampion = referralCount >= CHAMPION_THRESHOLD;
  const maskedEmail = userEmail ? maskEmail(userEmail) : '';

  const computedProfileStrength = useMemo<ProfileStrengthResult | null>(
    () => (userData ? calculateProfileStrength(userData) : null),
    [userData]
  );

  useEffect(() => {
    dispatch({ type: 'SET_PROFILE_STRENGTH', payload: computedProfileStrength });
  }, [computedProfileStrength]);

  // ── Auth state listener ────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!isMountedRef.current) return;
      dispatch({
        type: 'SET_AUTH',
        payload: {
          ready: true,
          userId: user?.uid ?? null,
          email: user?.email ?? null,
        },
      });
      if (!user) {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    });
    return () => unsub();
  }, []);

  // ── Redirect: no user → login ──────────────────────────
  useEffect(() => {
    if (authReady && !userId) {
      router.replace('/login' as any);
    }
  }, [authReady, userId, router]);

  // ── Navigation items ───────────────────────────────────
  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      {
        key: 'matches',
        label: '💕 My Matches',
        route: '/my-matches',
        color: COL.success,
        a11yHint: 'View your current matches',
      },
      {
        key: 'find',
        label: '🔍 Find Matches',
        route: '/matches',
        color: COL.primary,
        a11yHint: 'Browse and discover new matches',
      },
      {
        key: 'second',
        label: '👀 Second Look',
        route: '/second-look',
        color: COL.purple,
        a11yHint: 'Review profiles you previously passed on',
      },
      {
        key: 'quiz',
        label: '🧠 Personality Quiz',
        route: '/personality-quiz',
        color: COL.orange,
        a11yHint: 'Take the personality compatibility quiz',
      },
      {
        key: 'edit',
        label: '✏️ Edit Profile',
        route: '/edit-profile',
        color: COL.blue,
        a11yHint: 'Edit your profile details and photos',
      },
      {
        key: 'stats',
        label: '📊 Your Stats',
        route: '/dating-stats',
        color: COL.teal,
        a11yHint: 'View your dating statistics',
      },
      {
        key: 'stories',
        label: '📖 Stories',
        route: '/stories',
        color: COL.purple,
        a11yHint: 'Read and share dating stories',
      },
      {
        key: 'safety',
        label: '🛡️ Date Safety',
        route: '/date-checkin',
        color: COL.success,
        a11yHint: 'Check in for date safety',
      },
      {
        key: 'relationship',
        label: '💕 Relationship Mode',
        route: '/relationship-mode',
        color: COL.red,
        a11yHint: 'Enable relationship mode with your partner',
      },
      {
        key: 'spots',
        label: '📍 Date Spots',
        route: '/date-spot-reviews',
        color: COL.amber,
        a11yHint: 'Browse and review date spots nearby',
      },
      {
        key: 'settings',
        label: '⚙️ Settings',
        route: '/settings',
        color: COL.border,
        a11yHint: 'Open app settings',
      },
      {
        key: 'referral',
        label: '🌟 Invite Friends',
        route: '/referral',
        color: COL.gold,
        badge: referralCount > 0 ? referralCount : undefined,
        a11yHint: 'Invite friends and earn rewards',
      },
      {
        key: 'admin',
        label: '👮 Admin Panel',
        route: '/admin',
        color: COL.purple,
        show: isAdmin,
        borderColor: COL.gold,
        a11yHint: 'Open the admin control panel',
      },
    ];

    if (__DEV__) {
      items.push({
        key: 'debug',
        label: '🐛 Debug',
        route: '/debug',
        color: COL.dim,
        a11yHint: 'Open debug tools',
      });
    }

    return items.filter((i) => i.show !== false);
  }, [isAdmin, referralCount, COL]);

  // ── Load user data ─────────────────────────────────────
  const loadUserData = useCallback(async () => {
    if (!userId) return;

    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      await currentUser.reload();
      await currentUser.getIdToken(true);
    } catch (err: any) {
      logger.error('Account no longer valid:', err?.code);
      await auth.signOut().catch(() => {});
      return;
    }

    try {
      const snap = await getDoc(doc(db, 'users', userId));
      if (!isMountedRef.current) return;

      if (!snap.exists()) {
        // Document doesn't exist at all — send to profile setup
        router.replace('/profile-setup' as any);
        return;
      }

      const data = snap.data() as UserData;
      dispatch({ type: 'SET_USER_DATA', payload: data });
      dispatch({
        type: 'SET_STREAK',
        payload: {
          current: data.loginStreak ?? 0,
          longest: data.longestStreak ?? 0,
        },
      });
    } catch (err) {
      logger.error('loadUserData failed:', err);
      if (isMountedRef.current) {
        dispatch({
          type: 'SET_ERROR',
          payload: 'Failed to load your profile. Please try again.',
        });
      }
    } finally {
      if (isMountedRef.current) {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
  }, [userId, router]);

  // ── Track login streak ─────────────────────────────────
  const trackStreak = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await updateLoginStreak();
      if (isMountedRef.current) {
        dispatch({
          type: 'SET_STREAK',
          payload: {
            current: result.currentStreak,
            longest: result.longestStreak,
          },
        });
      }
    } catch (err) {
      logger.error('trackStreak failed:', err);
    }
  }, [userId]);

  // ── Initial data load ──────────────────────────────────
  useEffect(() => {
    if (!userId || !authReady) return;
    loadUserData();
    trackStreak();
  }, [userId, authReady, loadUserData, trackStreak]);

  // ── Pull-to-refresh ────────────────────────────────────
  const onRefresh = useCallback(async () => {
    dispatch({ type: 'SET_REFRESHING', payload: true });
    await Promise.all([loadUserData(), trackStreak()]);
    try {
      const answered = await hasAnsweredToday();
      if (isMountedRef.current) {
        dispatch({ type: 'SET_DAILY_QUESTION', payload: !answered });
      }
    } catch {
      // ignore
    }
    if (isMountedRef.current) {
      dispatch({ type: 'SET_REFRESHING', payload: false });
    }
  }, [loadUserData, trackStreak]);

  // ── Daily question check ───────────────────────────────
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const answered = await hasAnsweredToday();
        if (!cancelled && isMountedRef.current) {
          dispatch({ type: 'SET_DAILY_QUESTION', payload: !answered });
        }
      } catch (err) {
        logger.error('dailyQuestion check failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ── Online presence ────────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    updateLastSeen();
    const interval = setInterval(updateLastSeen, PRESENCE_INTERVAL_MS);

    const appStateSub = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') updateLastSeen();
        else setOffline();
      }
    );

    return () => {
      clearInterval(interval);
      appStateSub.remove();
      setOffline();
    };
  }, [userId]);

  // ── Network connectivity ───────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') {
      const updateOnlineStatus = () => {
        if (isMountedRef.current) {
          dispatch({ type: 'SET_ONLINE', payload: navigator.onLine });
        }
      };

      dispatch({ type: 'SET_ONLINE', payload: navigator.onLine });
      window.addEventListener('online', updateOnlineStatus);
      window.addEventListener('offline', updateOnlineStatus);

      return () => {
        window.removeEventListener('online', updateOnlineStatus);
        window.removeEventListener('offline', updateOnlineStatus);
      };
    }

    // Native: assume online; AppState handles reconnect awareness
    dispatch({ type: 'SET_ONLINE', payload: true });

    const sub = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active' && isMountedRef.current) {
          dispatch({ type: 'SET_ONLINE', payload: true });
        }
      }
    );

    return () => sub.remove();
  }, []);

  // ── Push notifications ─────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return;

    registerForPushNotifications().catch(() => {});

    const sub = addNotificationResponseListener((response) => {
      const data = response.notification.request.content
        .data as NotificationData;

      if (data?.type === 'match') {
        router.push('/my-matches' as any);
      } else if (data?.type === 'message') {
        router.push({
          pathname: '/chat' as any,
          params: {
            matchId: data.matchId ?? '',
            matchName: data.matchName ?? '',
          },
        });
      } else if (data?.type === 'profile_view') {
        router.push('/profile-views' as any);
      }
    });

    return () => sub.remove();
  }, [router]);

  // ── Android back button ────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Exit App', 'Are you sure you want to exit?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    });

    return () => handler.remove();
  }, []);

  // ── Accessibility announcement ─────────────────────────
  useEffect(() => {
    if (!loading && userData) {
      AccessibilityInfo.announceForAccessibility(
        `Home screen loaded. ${getGreeting()}, ${userName}.`
      );
    }
  }, [loading, userData, userName]);

  // ── Cleanup ────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Handlers ───────────────────────────────────────────
  const handleNav = useCallback(
    (route: AppRoute) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      router.push(route as any);
    },
    [router]
  );

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;

    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          dispatch({ type: 'SET_LOGGING_OUT', payload: true });
          try {
            await setOffline();
            await signOut(auth);
            router.replace('/login' as any);
          } catch (err) {
            logger.error('logout failed:', err);
            if (isMountedRef.current) {
              dispatch({ type: 'SET_LOGGING_OUT', payload: false });
            }
            Alert.alert('Error', 'Failed to log out. Please try again.');
          }
        },
      },
    ]);
  }, [loggingOut, router]);

  const handleRetry = useCallback(() => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    loadUserData();
    trackStreak();
  }, [loadUserData, trackStreak]);

  // ── Render: loading ────────────────────────────────────
  if (loading || !authReady) {
    return (
      <>
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <HomeScreenSkeleton COL={COL} insets={insets} />
      </>
    );
  }

  // ── Render: error ──────────────────────────────────────
  if (error) {
    return (
      <>
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <ErrorScreen error={error} onRetry={handleRetry} COL={COL} />
      </>
    );
  }

  // ── Render: no user (safety) ───────────────────────────
  if (!userId) return null;

  // ── Animation index ────────────────────────────────────
  let animIndex = 0;

  // ── Render: main ───────────────────────────────────────
  return (
    <>
      <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
      <ScrollView
        style={[styles.scroll, { backgroundColor: COL.bg }]}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + SPACING.xl,
            paddingBottom: insets.bottom + SPACING.xxxxl,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COL.primary}
            colors={[COL.primary]}
            progressBackgroundColor={COL.card}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {!isOnline && <OfflineBanner COL={COL} />}

        <ProfileHeader
          userPhoto={userPhoto}
          selfieVerified={selfieVerified}
          isChampion={isChampion}
          userName={userName}
          loginStreak={loginStreak}
          longestStreak={longestStreak}
          personalityType={personalityType}
          maskedEmail={maskedEmail}
          COL={COL}
          reducedMotion={reducedMotion}
        />

        {profileStrength != null && (
          <StrengthCard
            profileStrength={profileStrength}
            onPress={() => handleNav('/edit-profile')}
            COL={COL}
            reducedMotion={reducedMotion}
            index={animIndex++}
          />
        )}

        {showDailyQuestion && (
          <PromptCard
            icon="💭"
            title="Today's Question"
            subtitle="Answer to boost your profile!"
            onPress={() => handleNav('/daily-question')}
            borderColor={COL.purple}
            accentColor={COL.purple}
            COL={COL}
            reducedMotion={reducedMotion}
            index={animIndex++}
            a11yLabel="Today's daily question. Tap to answer."
          />
        )}

        {profileViews > 0 && (
          <PromptCard
            icon="👀"
            title={`${profileViews}`}
            subtitle="people viewed your profile"
            onPress={() => handleNav('/profile-views')}
            borderColor={COL.orange}
            accentColor={COL.orange}
            COL={COL}
            reducedMotion={reducedMotion}
            index={animIndex++}
            a11yLabel={`${profileViews} people viewed your profile. Tap to see who.`}
            rightContent={
              <Text
                style={[styles.promptArrow, { color: COL.orange }]}
                accessibilityElementsHidden
              >
                →
              </Text>
            }
          />
        )}

        {matchCount === 0 && userData != null && (
          <EmptyMatchesCard
            COL={COL}
            onPress={() => handleNav('/matches')}
            reducedMotion={reducedMotion}
            index={animIndex++}
          />
        )}

        {userData != null && (
          <ProfileCompletionCard userData={userData} showDetails />
        )}

        <NavigationGrid
          navItems={navItems}
          onNav={handleNav}
          onLogout={handleLogout}
          loggingOut={loggingOut}
          COL={COL}
          reducedMotion={reducedMotion}
          screenWidth={screenWidth}
          startIndex={animIndex}
        />
      </ScrollView>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },

  // ── Error ──
  errorText: {
    fontSize: FONT_SIZE.lg,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    lineHeight: 24,
  },
  retryBtn: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xxxl,
    borderRadius: RADIUS.xl,
  },
  retryBtnText: { fontSize: FONT_SIZE.lg, fontWeight: '600' },

  // ── Offline ──
  offlineBanner: {
    width: '100%',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.lg,
    alignItems: 'center',
  },
  offlineBannerText: { fontSize: FONT_SIZE.md, fontWeight: '600', textAlign: 'center' },

  // ── Skeleton ──
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    gap: SPACING.sm,
  },

  // ── Profile header ──
  profileHeader: { alignItems: 'center', marginBottom: SPACING.sm },
  photoWrap: { position: 'relative', marginBottom: SPACING.lg },
  photo: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: RADIUS.full,
    borderWidth: 3,
  },
  photoPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: RADIUS.full,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  photoPlaceholderText: { fontSize: FONT_SIZE.display },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderRadius: RADIUS.lg,
    width: SPACING.xxxl,
    height: SPACING.xxxl,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  verifiedIcon: { fontSize: FONT_SIZE.base, fontWeight: 'bold' },
  championBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    borderRadius: RADIUS.lg,
    width: SPACING.xxxl,
    height: SPACING.xxxl,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  championIcon: { fontSize: FONT_SIZE.base },
  welcomeText: { fontSize: FONT_SIZE.lg },
  userName: { fontSize: FONT_SIZE.xxxl, fontWeight: 'bold', marginTop: SPACING.xs },
  streakBadge: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg,
    marginTop: SPACING.sm + 2,
  },
  streakText: { fontSize: FONT_SIZE.md, fontWeight: 'bold' },
  championLabel: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    marginTop: SPACING.sm,
  },
  championLabelText: { fontSize: FONT_SIZE.sm, fontWeight: 'bold' },
  personalityBadge: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg,
    marginTop: SPACING.sm + 2,
  },
  personalityBadgeText: { fontSize: FONT_SIZE.base, fontWeight: '600' },
  email: { fontSize: FONT_SIZE.base, marginBottom: SPACING.xl },

  // ── Strength card ──
  strengthCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    marginBottom: SPACING.lg,
    borderWidth: 2,
  },
  strengthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  strengthTitle: { fontSize: FONT_SIZE.lg, fontWeight: 'bold' },
  strengthScore: { fontSize: FONT_SIZE.xxxl, fontWeight: 'bold' },
  strengthBarBg: {
    height: 10,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    marginBottom: SPACING.sm + 2,
  },
  strengthBarFill: { height: '100%', borderRadius: RADIUS.sm },
  strengthLabel: { fontSize: FONT_SIZE.base, textAlign: 'center', marginBottom: SPACING.sm },
  suggestionsWrap: {
    borderTopWidth: 1,
    paddingTop: SPACING.md,
    marginTop: SPACING.xs,
  },
  suggestionsTitle: { fontSize: FONT_SIZE.md, marginBottom: SPACING.sm, fontWeight: '600' },
  suggestionText: { fontSize: FONT_SIZE.md, marginBottom: SPACING.xs, lineHeight: 18 },
  tapHint: { fontSize: FONT_SIZE.sm, marginTop: SPACING.sm, fontStyle: 'italic', textAlign: 'right' },
  perfectWrap: { alignItems: 'center', marginTop: SPACING.xs },
  perfectText: { fontSize: FONT_SIZE.base, fontWeight: '600' },

  // ── Prompt / card rows ──
  promptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    marginBottom: SPACING.lg,
    borderWidth: 2,
  },
  promptLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 },
  promptIcon: { fontSize: FONT_SIZE.xxxl },
  promptTitle: { fontSize: FONT_SIZE.lg, fontWeight: 'bold' },
  promptSub: { fontSize: FONT_SIZE.md },
  promptArrow: { fontSize: SPACING.xl },

  // ── Empty matches ──
  emptyMatchesCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.xxl,
    width: '100%',
    marginBottom: SPACING.lg,
    borderWidth: 2,
    alignItems: 'center',
  },
  emptyMatchesEmoji: { fontSize: FONT_SIZE.display + 8, marginBottom: SPACING.sm },
  emptyMatchesTitle: { fontSize: FONT_SIZE.xl, fontWeight: 'bold', marginBottom: SPACING.xs },
  emptyMatchesSub: { fontSize: FONT_SIZE.base, textAlign: 'center' },

  // ── Nav buttons ──
  buttonsWrap: { width: '100%', gap: SPACING.sm + 2, marginTop: SPACING.lg },
  buttonsWrapGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  navBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    borderRadius: RADIUS.xl,
    gap: SPACING.sm + 2,
    minHeight: 48,
  },
  navBtnText: { fontSize: FONT_SIZE.xl, fontWeight: '600' },
  navBadge: { borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xxs },
  navBadgeText: { fontSize: FONT_SIZE.sm, fontWeight: 'bold' },
  logoutBtn: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    paddingVertical: SPACING.lg,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    marginTop: SPACING.sm + 2,
    minHeight: 48,
  },
  logoutBtnText: { fontSize: FONT_SIZE.xl, fontWeight: '600' },
});