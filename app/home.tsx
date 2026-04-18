import { prepare, layout as pretextLayout } from '@chenglou/pretext';
import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
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
  Dimensions,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TurboImage from 'react-native-turbo-image';
import { StyleSheet } from 'react-native-unistyles';
import ProfileCompletionCard from '../components/ProfileCompletionCard';
import { auth, db } from '../firebaseConfig';
import { hasAnsweredToday } from '../utils/dailyQuestions';
import { logger } from '../utils/logger';
import { addNotificationResponseListener, registerForPushNotifications } from '../utils/notifications';
import { setOffline, updateLastSeen } from '../utils/onlineStatus';
import { calculateProfileStrength, type ProfileStrengthResult } from '../utils/profileStrength';
import { updateLoginStreak } from '../utils/streakTracker';

const scheduleIdleTask = (cb: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb);
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 100);
  return () => clearTimeout(id);
};


const AVATAR_SIZE          = 100;
const PRESENCE_INTERVAL_MS = 120_000;
const CHAMPION_THRESHOLD   = 10;
const MAX_FONT_SCALE       = 1.3;

const NAV_FONT          = '18px Inter';
const NAV_LINE_H        = 24;
const NAV_BTN_V_PADDING = 32;   // paddingVertical theme.spacing.lg (16) × 2
const NAV_BTN_MIN_H     = 48;
const SCREEN_W          = Dimensions.get('window').width;

const navPrepareCache = new Map<string, ReturnType<typeof prepare>>();

function getNavPrepared(label: string): ReturnType<typeof prepare> {
  const hit = navPrepareCache.get(label);
  if (hit) return hit;
  const result = prepare(label, NAV_FONT);
  navPrepareCache.set(label, result);
  return result;
}

function buildNavHeightCache(items: NavItem[], screenWidth: number): Map<string, number> {
  const cache  = new Map<string, number>();
  const isWide = screenWidth >= 600;
  const baseW  = screenWidth - 64;
  const btnW   = isWide ? baseW * 0.48 : baseW;
  const textW  = btnW - 20; // 10px gap × 2 sides

  for (const item of items) {
    const prepared = getNavPrepared(item.label);
    const result   = pretextLayout(prepared, textW, NAV_LINE_H);
    const textH    = result.height;
    const totalH   = Math.max(NAV_BTN_MIN_H, textH + NAV_BTN_V_PADDING);
    cache.set(item.key, totalH);
  }
  cache.set('__logout__', NAV_BTN_MIN_H + NAV_BTN_V_PADDING);
  return cache;
}


interface UserData {
  name?: string; photos?: string[]; personalityType?: string; isAdmin?: boolean;
  selfieVerified?: boolean; profileViews?: number; referralCount?: number;
  loginStreak?: number; longestStreak?: number; matchCount?: number;
  profileComplete?: boolean; age?: number; bio?: string; gender?: string;
  interestedIn?: string; occupation?: string;
  height?: number | { value: number; verificationMethod?: string };
  bodyType?: string; interests?: string[]; dealBreakers?: string[];
  relationshipGoal?: string; pushToken?: string;
}

type AppRoute =
  | '/login' | '/my-matches' | '/matches' | '/second-look' | '/personality-quiz'
  | '/edit-profile' | '/dating-stats' | '/stories' | '/date-checkin'
  | '/relationship-mode' | '/date-spot-reviews' | '/settings' | '/referral'
  | '/admin' | '/daily-question' | '/profile-views' | '/chat' | '/debug' | '/profile-setup';

interface NavItem {
  key: string; label: string; route: AppRoute;
  colorKey: keyof typeof NAV_COLOR_KEYS;
  show?: boolean; badge?: number;
  isBordered?: boolean; a11yHint?: string;
}

const NAV_COLOR_KEYS = {
  success: true, primary: true, purple: true, orange: true,
  blue: true, teal: true, red: true, gold: true, dim: true,
} as const;

interface NotificationData {
  type?: 'match' | 'message' | 'profile_view';
  matchId?: string;
  matchName?: string;
}

interface HomeState {
  loading: boolean; refreshing: boolean; error: string | null;
  userData: UserData | null; loginStreak: number; longestStreak: number;
  profileStrength: ProfileStrengthResult | null; showDailyQuestion: boolean;
  isOnline: boolean; loggingOut: boolean; authReady: boolean;
  userId: string | null; userEmail: string | null;
}

type HomeAction =
  | { type: 'SET_LOADING';          payload: boolean }
  | { type: 'SET_REFRESHING';       payload: boolean }
  | { type: 'SET_ERROR';            payload: string | null }
  | { type: 'SET_USER_DATA';        payload: UserData }
  | { type: 'SET_STREAK';           payload: { current: number; longest: number } }
  | { type: 'SET_PROFILE_STRENGTH'; payload: ProfileStrengthResult | null }
  | { type: 'SET_DAILY_QUESTION';   payload: boolean }
  | { type: 'SET_ONLINE';           payload: boolean }
  | { type: 'SET_LOGGING_OUT';      payload: boolean }
  | { type: 'SET_AUTH';             payload: { ready: boolean; userId: string | null; email: string | null } }
  | { type: 'RESET' };


const strengthEmoji = (score: number) =>
  score >= 90 ? '💪🔥' : score >= 80 ? '💪' : score >= 60 ? '👍' : score >= 40 ? '🔨' : '🚧';

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


const initialState: HomeState = {
  loading: true, refreshing: false, error: null, userData: null,
  loginStreak: 0, longestStreak: 0, profileStrength: null,
  showDailyQuestion: false, isOnline: true, loggingOut: false,
  authReady: false, userId: null, userEmail: null,
};

function homeReducer(state: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case 'SET_LOADING':          return { ...state, loading:           action.payload };
    case 'SET_REFRESHING':       return { ...state, refreshing:        action.payload };
    case 'SET_ERROR':            return { ...state, error:             action.payload, loading: false };
    case 'SET_USER_DATA':        return { ...state, userData:          action.payload, error: null };
    case 'SET_STREAK':           return { ...state, loginStreak:       action.payload.current, longestStreak: action.payload.longest };
    case 'SET_PROFILE_STRENGTH': return { ...state, profileStrength:   action.payload };
    case 'SET_DAILY_QUESTION':   return { ...state, showDailyQuestion: action.payload };
    case 'SET_ONLINE':           return { ...state, isOnline:          action.payload };
    case 'SET_LOGGING_OUT':      return { ...state, loggingOut:        action.payload };
    case 'SET_AUTH':             return { ...state, authReady: action.payload.ready, userId: action.payload.userId, userEmail: action.payload.email };
    case 'RESET':                return initialState;
    default:                     return state;
  }
}


interface SkeletonBoxProps {
  width: number | `${number}%`; height: number; radius?: number; style?: object;
}
const SkeletonBox = React.memo(function SkeletonBox({ width, height, radius, style }: SkeletonBoxProps) {
  return (
    <View
      style={[
        skeletonStyles.box,
        { width, height, borderRadius: radius ?? skeletonStyles.box.borderRadius },
        style,
      ]}
      importantForAccessibility="no"
      accessibilityElementsHidden
    />
  );
});

const skeletonStyles = StyleSheet.create((theme) => ({
  box: {
    borderRadius:    theme.radius.md,
    backgroundColor: theme.colors.skeleton,
    opacity:         0.6,
  },
}));

const HomeScreenSkeleton = React.memo(function HomeScreenSkeleton({
  insets,
}: {
  insets: { top: number; bottom: number };
}) {
  return (
    <View
      style={[
        skeletonScreenStyles.screen,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 },
      ]}
      accessibilityLabel="Loading home screen"
    >
      <View style={skeletonScreenStyles.header}>
        <SkeletonBox width={AVATAR_SIZE} height={AVATAR_SIZE} radius={9999} />
        <SkeletonBox width={140} height={18} style={{ marginTop: 16 }} />
        <SkeletonBox width={200} height={30} style={{ marginTop: 8 }} />
      </View>
      <SkeletonBox width="100%" height={120} style={{ marginTop: 20 }} />
      <SkeletonBox width="100%" height={70}  style={{ marginTop: 16 }} />
      <View style={skeletonScreenStyles.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBox key={i} width="48%" height={56} radius={25} />
        ))}
      </View>
    </View>
  );
});

const skeletonScreenStyles = StyleSheet.create((theme) => ({
  screen: {
    flex:            1,
    backgroundColor: theme.colors.background,
    alignItems:      'center',
    paddingHorizontal: theme.spacing.xl,
  },
  header: { alignItems: 'center' },
  grid: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    justifyContent: 'space-between',
    width:          '100%',
    gap:            theme.spacing.sm,
    marginTop:      theme.spacing.xl,
  },
}));

const OfflineBanner = React.memo(function OfflineBanner() {
  const inner = (
    <View
      style={offlineStyles.banner}
      accessibilityRole="alert"
      accessibilityLabel="You are offline. Some features may not work."
      accessibilityLiveRegion="assertive"
    >
      <Text style={offlineStyles.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        📡 You're offline — some features may be unavailable
      </Text>
    </View>
  );
  if (Platform.OS !== 'web') {
    return <Animated.View entering={FadeInUp.duration(300)}>{inner}</Animated.View>;
  }
  return inner;
});

const offlineStyles = StyleSheet.create((theme) => ({
  banner: {
    width:           '100%',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius:    theme.radius.md,
    marginBottom:    theme.spacing.lg,
    alignItems:      'center',
    backgroundColor: theme.colors.danger,
  },
  text: {
    fontSize:   13,
    fontWeight: '600',
    textAlign:  'center',
    color:      theme.colors.white,
  },
}));

const ErrorScreen = React.memo(function ErrorScreen({
  error, onRetry,
}: {
  error: string; onRetry: () => void;
}) {
  return (
    <View style={errorStyles.container} accessibilityRole="alert">
      <Text style={errorStyles.emoji} accessibilityElementsHidden>😕</Text>
      <Text
        style={errorStyles.message}
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {error}
      </Text>
      <TouchableOpacity
        style={errorStyles.btn}
        onPress={onRetry}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Retry loading"
        accessibilityHint="Double tap to retry"
      >
        <Text style={errorStyles.btnText} maxFontSizeMultiplier={MAX_FONT_SCALE}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
});

const errorStyles = StyleSheet.create((theme) => ({
  container: {
    flex:             1,
    alignItems:       'center',
    justifyContent:   'center',
    paddingHorizontal: theme.spacing.xl,
    backgroundColor:  theme.colors.background,
  },
  emoji:   { fontSize: 40, marginBottom: 16 },
  message: {
    fontSize:     16,
    textAlign:    'center',
    marginBottom: theme.spacing.xl,
    lineHeight:   24,
    color:        theme.colors.text,
  },
  btn: {
    paddingVertical:   theme.spacing.md,
    paddingHorizontal: theme.spacing.xxxl,
    borderRadius:      theme.radius.xl,
    minHeight:         48,
    justifyContent:    'center',
    alignItems:        'center',
    backgroundColor:   theme.colors.primary,
  },
  btnText: {
    fontSize:   16,
    fontWeight: '600',
    color:      theme.colors.white,
  },
}));

interface ProfileHeaderProps {
  userPhoto: string; selfieVerified: boolean; isChampion: boolean; userName: string;
  loginStreak: number; longestStreak: number; personalityType: string; maskedEmail: string;
  reducedMotion: boolean;
}
const ProfileHeader = React.memo(function ProfileHeader({
  userPhoto, selfieVerified, isChampion, userName, loginStreak, longestStreak,
  personalityType, maskedEmail, reducedMotion,
}: ProfileHeaderProps) {
  const greeting   = getGreeting();
  const streakA11y = loginStreak > 1
    ? `${loginStreak} day login streak${loginStreak === longestStreak && loginStreak >= 7 ? ', personal best!' : ''}`
    : loginStreak === 1 ? 'Come back tomorrow to start a streak' : '';

  const content = (
    <View style={profileHeaderStyles.container} accessibilityRole="summary">
      <View style={profileHeaderStyles.photoWrap}>
        {userPhoto ? (
          <TurboImage
            source={{ uri: userPhoto }}
            style={profileHeaderStyles.photo}
            resizeMode="cover"
            cachePolicy="dataCache"
            accessibilityLabel={`${userName}'s profile photo`}
          />
        ) : (
          <View
            style={profileHeaderStyles.photoPlaceholder}
            accessibilityLabel="No profile photo. Tap Edit Profile to add one."
            accessibilityRole="image"
          >
            <Text style={profileHeaderStyles.photoPlaceholderText} accessibilityElementsHidden>?</Text>
          </View>
        )}
        {selfieVerified && (
          <View
            style={profileHeaderStyles.verifiedBadge}
            accessibilityLabel="Selfie verified"
            accessibilityRole="image"
          >
            <Text style={profileHeaderStyles.verifiedIcon} accessibilityElementsHidden>✓</Text>
          </View>
        )}
        {isChampion && (
          <View
            style={profileHeaderStyles.championBadge}
            accessibilityLabel="Community champion"
            accessibilityRole="image"
          >
            <Text style={profileHeaderStyles.championIcon} accessibilityElementsHidden>🌟</Text>
          </View>
        )}
      </View>

      <Text style={profileHeaderStyles.welcomeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {greeting},
      </Text>
      <Text
        style={profileHeaderStyles.userName}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityRole="header"
        accessibilityLabel={`${greeting}, ${userName}`}
      >
        {userName}!
      </Text>

      {loginStreak > 1 && (
        <View style={profileHeaderStyles.streakBadge} accessibilityRole="text" accessibilityLabel={streakA11y}>
          <Text style={profileHeaderStyles.streakText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            🔥 {loginStreak}-day streak!{loginStreak === longestStreak && loginStreak >= 7 ? ' (Personal best!)' : ''}
          </Text>
        </View>
      )}
      {loginStreak === 1 && (
        <View style={profileHeaderStyles.streakBadgeOutline} accessibilityRole="text" accessibilityLabel={streakA11y}>
          <Text style={profileHeaderStyles.streakTextOutline} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            🔥 Come back tomorrow to start a streak!
          </Text>
        </View>
      )}
      {isChampion && (
        <View style={profileHeaderStyles.championLabel} accessibilityRole="text" accessibilityLabel="Community Champion">
          <Text style={profileHeaderStyles.championLabelText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            🌟 Community Champion
          </Text>
        </View>
      )}
      {personalityType !== '' && (
        <View style={profileHeaderStyles.personalityBadge} accessibilityRole="text" accessibilityLabel={`Personality type: ${personalityType}`}>
          <Text style={profileHeaderStyles.personalityBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            {personalityType}
          </Text>
        </View>
      )}
      <Text style={profileHeaderStyles.email} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={`Email: ${maskedEmail}`}>
        {maskedEmail}
      </Text>
    </View>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return <Animated.View entering={FadeInDown.duration(500)}>{content}</Animated.View>;
  }
  return content;
});

const profileHeaderStyles = StyleSheet.create((theme) => ({
  container:             { alignItems: 'center', marginBottom: theme.spacing.sm },
  photoWrap:             { position: 'relative', marginBottom: theme.spacing.lg },
  photo: {
    width:        AVATAR_SIZE,
    height:       AVATAR_SIZE,
    borderRadius: 50,
    borderWidth:  3,
    borderColor:  theme.colors.primary,
  },
  photoPlaceholder: {
    width:           AVATAR_SIZE,
    height:          AVATAR_SIZE,
    borderRadius:    50,
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     3,
    backgroundColor: theme.colors.surface,
    borderColor:     theme.colors.primary,
  },
  photoPlaceholderText: { fontSize: 40, color: theme.colors.textSecondary },
  verifiedBadge: {
    position:        'absolute',
    bottom:          0,
    right:           0,
    borderRadius:    15,
    width:           32,
    height:          32,
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     3,
    backgroundColor: theme.colors.blue,
    borderColor:     theme.colors.background,
  },
  verifiedIcon:       { fontSize: 14, fontWeight: 'bold', color: theme.colors.white },
  championBadge: {
    position:        'absolute',
    top:             -5,
    right:           -5,
    borderRadius:    15,
    width:           32,
    height:          32,
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     3,
    backgroundColor: theme.colors.gold,
    borderColor:     theme.colors.background,
  },
  championIcon:         { fontSize: 14 },
  welcomeText:          { fontSize: 16, color: theme.colors.textSecondary },
  userName:             { fontSize: 28, fontWeight: 'bold', marginTop: theme.spacing.xs, color: theme.colors.text },
  streakBadge: {
    paddingVertical:   6,
    paddingHorizontal: theme.spacing.lg,
    borderRadius:      theme.radius.lg,
    marginTop:         10,
    backgroundColor:   theme.colors.orange,
  },
  streakText:           { fontSize: 13, fontWeight: 'bold', color: theme.colors.white },
  streakBadgeOutline: {
    paddingVertical:   6,
    paddingHorizontal: theme.spacing.lg,
    borderRadius:      theme.radius.lg,
    marginTop:         10,
    borderWidth:       1,
    backgroundColor:   theme.colors.surface,
    borderColor:       theme.colors.orange,
  },
  streakTextOutline:  { fontSize: 13, fontWeight: 'bold', color: theme.colors.orange },
  championLabel: {
    paddingVertical:   theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius:      theme.radius.md,
    marginTop:         theme.spacing.sm,
    backgroundColor:   theme.colors.gold,
  },
  championLabelText:    { fontSize: 12, fontWeight: 'bold', color: theme.colors.background },
  personalityBadge: {
    paddingVertical:   6,
    paddingHorizontal: theme.spacing.lg,
    borderRadius:      theme.radius.lg,
    marginTop:         10,
    backgroundColor:   theme.colors.orange,
  },
  personalityBadgeText: { fontSize: 14, fontWeight: '600', color: theme.colors.white },
  email:                { fontSize: 14, marginBottom: theme.spacing.xl, color: theme.colors.primary },
}));

interface StrengthCardProps {
  profileStrength: ProfileStrengthResult; onPress: () => void;
  reducedMotion: boolean; index: number;
}
const StrengthCard = React.memo(function StrengthCard({
  profileStrength, onPress, reducedMotion, index,
}: StrengthCardProps) {
  const score = profileStrength.score;

  const barFillStyle = useMemo(() => ({ width: `${score}%` as `${number}%` }), [score]);

  const content = (
    <TouchableOpacity
      style={strengthStyles.card}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Profile strength ${score}%. ${profileStrength.label}. Tap to edit profile.`}
      accessibilityHint="Double tap to open profile editor"
    >
      <View style={strengthStyles.header}>
        <Text style={strengthStyles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
          {strengthEmoji(score)} Profile Strength
        </Text>
        <Text
          style={[
            strengthStyles.score,
            score >= 80 ? strengthStyles.scoreSuccess
              : score >= 60 ? strengthStyles.scoreOrange
              : score >= 40 ? strengthStyles.scoreGold
              : strengthStyles.scoreDanger,
          ]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityElementsHidden
        >
          {score}%
        </Text>
      </View>
      <View
        style={strengthStyles.barBg}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: score, text: `${score}%` }}
      >
        <View
          style={[
            strengthStyles.barFill,
            barFillStyle,
            score >= 80 ? strengthStyles.barSuccess
              : score >= 60 ? strengthStyles.barOrange
              : score >= 40 ? strengthStyles.barGold
              : strengthStyles.barDanger,
          ]}
          importantForAccessibility="no"
        />
      </View>
      <Text style={strengthStyles.label} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        {profileStrength.label}
      </Text>
      {(profileStrength.suggestions?.length ?? 0) > 0 && score < 100 && (
        <View style={strengthStyles.suggestions} importantForAccessibility="no">
          <Text style={strengthStyles.suggestionsTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            💡 Tips to improve:
          </Text>
          {(profileStrength.suggestions ?? []).slice(0, 2).map((tip, i) => (
            <Text key={i} style={strengthStyles.suggestionText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              • {tip}
            </Text>
          ))}
          <Text style={strengthStyles.tapHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Tap to edit profile →
          </Text>
        </View>
      )}
      {score >= 100 && (
        <View style={strengthStyles.perfectWrap} importantForAccessibility="no">
          <Text style={strengthStyles.perfectText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            🎉 Your profile is perfect!
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return (
      <Animated.View entering={FadeInDown.delay(index * 80).duration(400)} style={strengthStyles.fullWidth}>
        {content}
      </Animated.View>
    );
  }
  return <View style={strengthStyles.fullWidth}>{content}</View>;
});

const strengthStyles = StyleSheet.create((theme) => ({
  fullWidth: { width: '100%' },
  card: {
    borderRadius:    theme.radius.lg,
    padding:         theme.spacing.lg,
    width:           '100%',
    marginBottom:    theme.spacing.lg,
    borderWidth:     2,
    backgroundColor: theme.colors.surface,
    borderColor:     theme.colors.primary,
  },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md },
  title:        { fontSize: 16, fontWeight: 'bold', color: theme.colors.text },
  score:        { fontSize: 28, fontWeight: 'bold' },
  scoreSuccess: { color: theme.colors.success },
  scoreOrange:  { color: theme.colors.orange },
  scoreGold:    { color: theme.colors.gold },
  scoreDanger:  { color: theme.colors.danger },
  barBg:        { height: 10, borderRadius: theme.radius.sm, overflow: 'hidden', marginBottom: 10, backgroundColor: theme.colors.border },
  barFill:      { height: '100%', borderRadius: theme.radius.sm },
  barSuccess:   { backgroundColor: theme.colors.success },
  barOrange:    { backgroundColor: theme.colors.orange },
  barGold:      { backgroundColor: theme.colors.gold },
  barDanger:    { backgroundColor: theme.colors.danger },
  label:        { fontSize: 14, textAlign: 'center', marginBottom: theme.spacing.sm, color: theme.colors.textSecondary },
  suggestions:  { borderTopWidth: 1, paddingTop: theme.spacing.md, marginTop: theme.spacing.xs, borderTopColor: theme.colors.border },
  suggestionsTitle: { fontSize: 13, marginBottom: theme.spacing.sm, fontWeight: '600', color: theme.colors.primary },
  suggestionText:   { fontSize: 13, marginBottom: theme.spacing.xs, lineHeight: 18, color: theme.colors.textSecondary },
  tapHint:          { fontSize: 12, marginTop: theme.spacing.sm, fontStyle: 'italic', textAlign: 'right', color: theme.colors.primary },
  perfectWrap:      { alignItems: 'center', marginTop: theme.spacing.xs },
  perfectText:      { fontSize: 14, fontWeight: '600', color: theme.colors.success },
}));

interface PromptCardProps {
  icon: string; title: string; subtitle: string; onPress: () => void;
  variant: 'purple' | 'orange'; reducedMotion: boolean;
  index: number; a11yLabel: string; a11yHint?: string; rightContent?: React.ReactNode;
}
const PromptCard = React.memo(function PromptCard({
  icon, title, subtitle, onPress, variant,
  reducedMotion, index, a11yLabel, a11yHint, rightContent,
}: PromptCardProps) {
  const cardStyle  = variant === 'purple' ? promptStyles.cardPurple  : promptStyles.cardOrange;
  const titleStyle = variant === 'purple' ? promptStyles.titlePurple : promptStyles.titleOrange;
  const arrowStyle = variant === 'purple' ? promptStyles.arrowPurple : promptStyles.arrowOrange;

  const content = (
    <TouchableOpacity
      style={[promptStyles.card, cardStyle]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={a11yHint ?? `Double tap to open ${title}`}
    >
      <View style={promptStyles.left}>
        <Text style={promptStyles.icon} accessibilityElementsHidden>{icon}</Text>
        <View style={promptStyles.textWrap}>
          <Text style={[promptStyles.title, titleStyle]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            {title}
          </Text>
          <Text style={promptStyles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            {subtitle}
          </Text>
        </View>
      </View>
      {rightContent ?? (
        <Text style={[promptStyles.arrow, arrowStyle]} accessibilityElementsHidden>→</Text>
      )}
    </TouchableOpacity>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return (
      <Animated.View entering={FadeInDown.delay(index * 80).duration(400)} style={promptStyles.fullWidth}>
        {content}
      </Animated.View>
    );
  }
  return <View style={promptStyles.fullWidth}>{content}</View>;
});

const promptStyles = StyleSheet.create((theme) => ({
  fullWidth: { width: '100%' },
  card: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    borderRadius:   theme.radius.lg,
    padding:        theme.spacing.lg,
    width:          '100%',
    marginBottom:   theme.spacing.lg,
    borderWidth:    2,
    minHeight:      48,
    backgroundColor: theme.colors.surface,
  },
  cardPurple:  { borderColor: theme.colors.purple },
  cardOrange:  { borderColor: theme.colors.orange },
  left:        { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, flex: 1 },
  textWrap:    { flex: 1 },
  icon:        { fontSize: 28 },
  title:       { fontSize: 16, fontWeight: 'bold' },
  titlePurple: { color: theme.colors.purple },
  titleOrange: { color: theme.colors.orange },
  sub:         { fontSize: 13, color: theme.colors.textSecondary },
  arrow:       { fontSize: 20 },
  arrowPurple: { color: theme.colors.purple },
  arrowOrange: { color: theme.colors.orange },
}));

const EmptyMatchesCard = React.memo(function EmptyMatchesCard({
  onPress, reducedMotion, index,
}: {
  onPress: () => void; reducedMotion: boolean; index: number;
}) {
  const content = (
    <TouchableOpacity
      style={emptyStyles.card}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="No matches yet. Tap to start finding matches."
      accessibilityHint="Double tap to browse profiles"
    >
      <Text style={emptyStyles.emoji} accessibilityElementsHidden>💫</Text>
      <Text style={emptyStyles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        Start finding your match!
      </Text>
      <Text style={emptyStyles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        Swipe to discover people who are right for you
      </Text>
    </TouchableOpacity>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return (
      <Animated.View entering={FadeInDown.delay(index * 80).duration(400)} style={emptyStyles.fullWidth}>
        {content}
      </Animated.View>
    );
  }
  return <View style={emptyStyles.fullWidth}>{content}</View>;
});

const emptyStyles = StyleSheet.create((theme) => ({
  fullWidth: { width: '100%' },
  card: {
    borderRadius:    theme.radius.lg,
    padding:         theme.spacing.xxl,
    width:           '100%',
    marginBottom:    theme.spacing.lg,
    borderWidth:     2,
    alignItems:      'center',
    backgroundColor: theme.colors.surface,
    borderColor:     theme.colors.primary,
  },
  emoji: { fontSize: 48, marginBottom: theme.spacing.sm },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: theme.spacing.xs, color: theme.colors.text },
  sub:   { fontSize: 14, textAlign: 'center', color: theme.colors.textSecondary },
}));

interface NavItemRendererProps {
  item: NavItem; onNav: (r: AppRoute) => void;
  reducedMotion: boolean; index: number; isWide: boolean;
}
const NavItemRenderer = React.memo(function NavItemRenderer({
  item, onNav, reducedMotion, index, isWide,
}: NavItemRendererProps) {
  const widthStyle = isWide ? navStyles.btnWide : navStyles.btnFull;
  const cleanLabel = item.label.replace(/^\S+\s/, '');
  const handlePress = useCallback(() => onNav(item.route), [onNav, item.route]);

  const btn = (
    <TouchableOpacity
      style={[
        navStyles.btn,
        widthStyle,
        navStyles[`btn_${item.colorKey}` as keyof typeof navStyles] as object,
        item.isBordered ? navStyles.btnBordered : undefined,
      ]}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityRole="menuitem"
      accessibilityLabel={item.badge ? `${cleanLabel}, ${item.badge} notifications` : cleanLabel}
      accessibilityHint={item.a11yHint ?? `Double tap to open ${cleanLabel}`}
    >
      <Text style={navStyles.btnText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        {item.label}
      </Text>
      {!!item.badge && (
        <View style={navStyles.badge} accessibilityElementsHidden>
          <Text style={navStyles.badgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {item.badge}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>{btn}</Animated.View>;
  }
  return btn;
});

interface LogoutButtonProps {
  onLogout: () => void; loggingOut: boolean;
  reducedMotion: boolean; index: number; isWide: boolean;
}
const LogoutButton = React.memo(function LogoutButton({
  onLogout, loggingOut, reducedMotion, index, isWide,
}: LogoutButtonProps) {
  const widthStyle = isWide ? navStyles.btnWide : navStyles.btnFull;
  const btn = (
    <TouchableOpacity
      style={[navStyles.logoutBtn, widthStyle]}
      onPress={onLogout}
      activeOpacity={0.8}
      disabled={loggingOut}
      accessibilityRole="button"
      accessibilityLabel={loggingOut ? 'Logging out' : 'Log out'}
      accessibilityHint="Double tap to sign out"
      accessibilityState={{ disabled: loggingOut, busy: loggingOut }}
    >
      <Text style={navStyles.logoutText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        {loggingOut ? '⏳ Logging out…' : '🚪 Log Out'}
      </Text>
    </TouchableOpacity>
  );

  if (!reducedMotion && Platform.OS !== 'web') {
    return <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>{btn}</Animated.View>;
  }
  return btn;
});

const navStyles = StyleSheet.create((theme) => ({
  btn: {
    flexDirection:  'row',
    justifyContent: 'center',
    alignItems:     'center',
    paddingVertical: theme.spacing.lg,
    borderRadius:   theme.radius.xl,
    gap:            10,
    minHeight:      48,
  },
  btnWide: { width: '48%' as const },
  btnFull: { width: '100%' as const },
  btn_success: { backgroundColor: theme.colors.success },
  btn_primary: { backgroundColor: theme.colors.primary },
  btn_purple:  { backgroundColor: theme.colors.purple },
  btn_orange:  { backgroundColor: theme.colors.orange },
  btn_blue:    { backgroundColor: theme.colors.blue },
  btn_teal:    { backgroundColor: theme.colors.teal },
  btn_red:     { backgroundColor: theme.colors.red },
  btn_gold:    { backgroundColor: theme.colors.gold },
  btn_dim:     { backgroundColor: theme.colors.textSecondary },
  btnBordered: { borderWidth: 2, borderColor: theme.colors.gold },
  btnText:     { fontSize: 18, fontWeight: '600', color: theme.colors.white },
  badge: {
    borderRadius:     theme.radius.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical:  2,
    backgroundColor:  theme.colors.background,
  },
  badgeText: { fontSize: 12, fontWeight: 'bold', color: theme.colors.gold },
  logoutBtn: {
    backgroundColor: 'transparent',
    borderWidth:     2,
    paddingVertical: theme.spacing.lg,
    borderRadius:    theme.radius.xl,
    alignItems:      'center',
    marginTop:       10,
    minHeight:       48,
    borderColor:     theme.colors.danger,
  },
  logoutText: { fontSize: 18, fontWeight: '600', color: theme.colors.danger },
}));

type NavListItem = NavItem | { key: '__logout__' };

interface NavigationGridProps {
  navItems: NavItem[]; onNav: (r: AppRoute) => void; onLogout: () => void;
  loggingOut: boolean; reducedMotion: boolean;
  screenWidth: number; startIndex: number;
  heightCache: Map<string, number>;
}
const NavigationGrid = React.memo(function NavigationGrid({
  navItems, onNav, onLogout, loggingOut, reducedMotion, screenWidth, startIndex, heightCache,
}: NavigationGridProps) {
  const isWide     = screenWidth >= 600;
  const numColumns = isWide ? 2 : 1;
  const listData   = useMemo<NavListItem[]>(() => [...navItems, { key: '__logout__' }], [navItems]);

  const getEstimatedItemSize = useCallback(
    (item: NavListItem) => heightCache.get(item.key) ?? 80,
    [heightCache],
  );

  const renderItem = useCallback(({ item, index }: LegendListRenderItemProps<NavListItem>) => {
    if (item.key === '__logout__') {
      return (
        <LogoutButton
          onLogout={onLogout} loggingOut={loggingOut}
          reducedMotion={reducedMotion} index={startIndex + index} isWide={isWide}
        />
      );
    }
    return (
      <NavItemRenderer
        item={item as NavItem} onNav={onNav}
        reducedMotion={reducedMotion} index={startIndex + index} isWide={isWide}
      />
    );
  }, [onNav, onLogout, loggingOut, reducedMotion, startIndex, isWide]);

  const keyExtractor = useCallback((item: NavListItem) => item.key, []);

  return (
    <LegendList
      data={listData}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={numColumns}
      key={numColumns}
      recycleItems={true}
      estimatedItemSize={80}
      getEstimatedItemSize={getEstimatedItemSize}
      scrollEnabled={false}
      contentContainerStyle={navGridStyles.content}
      columnWrapperStyle={isWide ? navGridStyles.columnWrapper : undefined}
      accessibilityRole="menu"
      accessibilityLabel="Navigation menu"
      removeClippedSubviews={false}
    />
  );
});

const navGridStyles = StyleSheet.create((theme) => ({
  content:       { gap: 10, paddingTop: theme.spacing.lg, width: '100%' },
  columnWrapper: { justifyContent: 'space-between' },
}));


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
    dispatch({ type: 'SET_PROFILE_STRENGTH', payload: computedStrength }, []);
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
      { key: 'matches',      label: '💕 My Matches',        route: '/my-matches',       colorKey: 'success', a11yHint: 'Double tap to view your matches' },
      { key: 'find',         label: '🔍 Find Matches',      route: '/matches',           colorKey: 'primary', a11yHint: 'Double tap to browse new matches' },
      { key: 'second',       label: '👀 Second Look',       route: '/second-look',       colorKey: 'purple',  a11yHint: 'Double tap to review skipped profiles' },
      { key: 'quiz',         label: '🧠 Personality Quiz',  route: '/personality-quiz',  colorKey: 'orange',  a11yHint: 'Double tap to take the personality quiz' },
      { key: 'edit',         label: '✏️ Edit Profile',      route: '/edit-profile',      colorKey: 'blue',    a11yHint: 'Double tap to edit your profile' },
      { key: 'stats',        label: '📊 Your Stats',        route: '/dating-stats',      colorKey: 'teal',    a11yHint: 'Double tap to view your stats' },
      { key: 'stories',      label: '📖 Stories',           route: '/stories',           colorKey: 'purple',  a11yHint: 'Double tap to read stories' },
      { key: 'safety',       label: '🛡️ Date Safety',      route: '/date-checkin',      colorKey: 'success', a11yHint: 'Double tap to set up safety check-ins' },
      { key: 'relationship', label: '💕 Relationship Mode', route: '/relationship-mode', colorKey: 'red',     a11yHint: 'Double tap for relationship mode' },
      { key: 'spots',        label: '📍 Date Spots',        route: '/date-spot-reviews', colorKey: 'orange',  a11yHint: 'Double tap to browse date spots' },
      { key: 'settings',     label: '⚙️ Settings',          route: '/settings',          colorKey: 'dim',     a11yHint: 'Double tap to open settings' },
      { key: 'referral',     label: '🌟 Invite Friends',    route: '/referral',          colorKey: 'gold',    badge: referralCount > 0 ? referralCount : undefined, a11yHint: 'Double tap to invite friends' },
      { key: 'admin',        label: '👮 Admin Panel',       route: '/admin',             colorKey: 'purple',  show: isAdmin, isBordered: true, a11yHint: 'Double tap to open admin panel' },
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
      const data = snap.data() as UserData;
      dispatch({ type: 'SET_USER_DATA', payload: data });
      dispatch({
        type: 'SET_STREAK',
        payload: { current: data.loginStreak ?? 0, longest: data.longestStreak ?? 0 },
      });
    } catch (err: unknown) {
      logger.error('loadUserData failed:', err);
      if (isMountedRef.current) {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to load your profile. Please try again.' });
      }
    } finally {
      if (isMountedRef.current) dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [userId, router]);

  const trackStreak = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await updateLoginStreak();
      if (isMountedRef.current) {
        dispatch({ type: 'SET_STREAK', payload: { current: r.currentStreak, longest: r.longestStreak } });
      }
    } catch (err: unknown) {
      logger.error('trackStreak failed:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || !authReady) return;
    return scheduleIdleTask(() => {
      void loadUserData();
      void trackStreak();
    }, []);
  }, [userId, authReady, loadUserData, trackStreak]);

  const onRefresh = useCallback(async () => {
    dispatch({ type: 'SET_REFRESHING', payload: true });
    try {
      await Promise.all([loadUserData().catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }), trackStreak()]);
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
        if (!cancelled && isMountedRef.current) {
          dispatch({ type: 'SET_DAILY_QUESTION', payload: !answered });
        }
      } catch (err: unknown) {
        logger.error('dailyQuestion check failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void updateLastSeen();
    const interval = setInterval(() => { void updateLastSeen(); }, PRESENCE_INTERVAL_MS);
  // FIXME: add removeEventListener cleanup for the listener below
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void updateLastSeen();
      else void setOffline();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
      void setOffline();
    };
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => {
        if (isMountedRef.current) dispatch({ type: 'SET_ONLINE', payload: navigator.onLine }, []);
      };
      dispatch({ type: 'SET_ONLINE', payload: navigator.onLine });
      window.addEventListener('online',  update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online',  update);
        window.removeEventListener('offline', update);
      };
    }
    dispatch({ type: 'SET_ONLINE', payload: true });
  // FIXME: add removeEventListener cleanup for the listener below
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && isMountedRef.current) dispatch({ type: 'SET_ONLINE', payload: true });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    registerForPushNotifications().catch(() => {}, []);
    const sub = addNotificationResponseListener(response => {
      const data = response.notification.request.content.data as NotificationData;
      if (data?.type === 'match') {
        router.push('/my-matches' as AppRoute);
      } else if (data?.type === 'message') {
        router.push({ pathname: '/chat' as AppRoute, params: { matchId: data.matchId ?? '', matchName: data.matchName ?? '' } });
      } else if (data?.type === 'profile_view') {
        router.push('/profile-views' as AppRoute);
      }
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
  // FIXME: add removeEventListener cleanup for the listener below
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
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
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

  const animIndices = useMemo(() => {
    let n = 0;
    return {
      strength:     profileStrength    != null ? n++ : -1,
      dailyQ:       showDailyQuestion           ? n++ : -1,
      profileViews: profileViews > 0            ? n++ : -1,
      emptyMatches: matchCount === 0 && userData != null ? n++ : -1,
      navStart:     n,
    };
  }, [profileStrength, showDailyQuestion, profileViews, matchCount, userData]);

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
        style={screenStyles.scroll}
        contentContainerStyle={[
          screenStyles.content,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 },
        ]}
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
            onPress={useCallback(() => handleNav('/profile-views'), [])}
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

const screenStyles = StyleSheet.create((theme) => ({
  scroll:  { flex: 1, backgroundColor: theme.colors.background },
  content: { alignItems: 'center', paddingHorizontal: theme.spacing.xl },
}));