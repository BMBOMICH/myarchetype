// app/home.tsx
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  AccessibilityInfo, Alert, AppState, type AppStateStatus,
  BackHandler, FlatList, Platform,
  RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, useColorScheme, useWindowDimensions, View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ProfileCompletionCard from '../components/ProfileCompletionCard';
import { auth, db } from '../firebaseConfig';
import { hasAnsweredToday } from '../utils/dailyQuestions';
import { logger } from '../utils/logger';
import { addNotificationResponseListener, registerForPushNotifications } from '../utils/notifications';
import { setOffline, updateLastSeen } from '../utils/onlineStatus';
import { calculateProfileStrength, type ProfileStrengthResult } from '../utils/profileStrength';
import { updateLoginStreak } from '../utils/streakTracker';

const SPACING   = { xxs:2, xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32, xxxxl:40 } as const;
const FONT_SIZE = { xs:11, sm:12, md:13, base:14, lg:16, xl:18, xxl:24, xxxl:28, display:40 } as const;
const RADIUS    = { sm:5, md:12, lg:15, xl:25, full:50 } as const;
const AVATAR_SIZE          = 100;
const PRESENCE_INTERVAL_MS = 120_000;
const CHAMPION_THRESHOLD   = 10;
const MAX_FONT_SCALE       = 1.3;

const DARK_THEME = {
  bg:'#1a1a2e', card:'#16213e', border:'#0f3460', primary:'#53a8b6',
  success:'#5cb85c', danger:'#d9534f', orange:'#e67e22', purple:'#9b59b6',
  blue:'#3498db', teal:'#1abc9c', red:'#e74c3c', gold:'#f1c40f', amber:'#f39c12',
  text:'#eeeeee', sub:'#aaaaaa', muted:'#999999', dim:'#777777', white:'#ffffff', skeleton:'#253454',
} as const;

const LIGHT_THEME = {
  bg:'#f5f5f7', card:'#ffffff', border:'#e0e0e0', primary:'#3a8a9a',
  success:'#34a853', danger:'#ea4335', orange:'#e67e22', purple:'#8e44ad',
  blue:'#2979ff', teal:'#00897b', red:'#e53935', gold:'#f9a825', amber:'#ff8f00',
  text:'#1a1a2e', sub:'#555555', muted:'#777777', dim:'#999999', white:'#ffffff', skeleton:'#e0e0e0',
} as const;

type ThemeColors = typeof DARK_THEME;

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
  key: string; label: string; route: AppRoute; color: string;
  show?: boolean; badge?: number; borderColor?: string; a11yHint?: string;
}

interface NotificationData {
  type?: 'match' | 'message' | 'profile_view'; matchId?: string; matchName?: string;
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

const strengthColor = (score: number, C: ThemeColors) => score >= 80 ? C.success : score >= 60 ? C.orange : score >= 40 ? C.gold : C.danger;
const strengthEmoji = (score: number) => score >= 90 ? '💪🔥' : score >= 80 ? '💪' : score >= 60 ? '👍' : score >= 40 ? '🔨' : '🚧';
const getGreeting   = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const maskEmail     = (e: string) => {
  const [l, d] = e.split('@');
  if (!d || !l) return e;
  if (l.length <= 2) return `${l}@${d}`;
  return `${l[0]}${'*'.repeat(Math.min(l.length - 2, 6))}${l[l.length - 1]}@${d}`;
};

const initialState: HomeState = {
  loading:true, refreshing:false, error:null, userData:null,
  loginStreak:0, longestStreak:0, profileStrength:null,
  showDailyQuestion:false, isOnline:true, loggingOut:false,
  authReady:false, userId:null, userEmail:null,
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

// ── Sub-components ──────────────────────────────────────────

interface SkeletonBoxProps { width: number | `${number}%`; height: number; radius?: number; style?: object; color: string; }
const SkeletonBox = React.memo(function SkeletonBox({ width, height, radius = RADIUS.md, style, color }: SkeletonBoxProps) {
  return <View style={[{ width, height, borderRadius: radius, backgroundColor: color, opacity: 0.6 }, style]} importantForAccessibility="no" accessibilityElementsHidden />;
});

const HomeScreenSkeleton = React.memo(function HomeScreenSkeleton({ COL, insets }: { COL: ThemeColors; insets: { top: number; bottom: number } }) {
  return (
    <View style={[s.scroll, { backgroundColor: COL.bg }]} accessibilityLabel="Loading home screen">
      <View style={[s.scrollContent, { paddingTop: insets.top + SPACING.xl, paddingBottom: insets.bottom + SPACING.xxxxl }]}>
        <View style={s.profileHeader}>
          <SkeletonBox width={AVATAR_SIZE} height={AVATAR_SIZE} radius={RADIUS.full} color={COL.skeleton} />
          <SkeletonBox width={140} height={18} style={{ marginTop: SPACING.lg }} color={COL.skeleton} />
          <SkeletonBox width={200} height={30} style={{ marginTop: SPACING.sm }} color={COL.skeleton} />
        </View>
        <SkeletonBox width="100%" height={120} radius={RADIUS.lg} style={{ marginTop: SPACING.xl }} color={COL.skeleton} />
        <SkeletonBox width="100%" height={70}  radius={RADIUS.lg} style={{ marginTop: SPACING.lg }} color={COL.skeleton} />
        <View style={s.skeletonGrid}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonBox key={i} width="48%" height={56} radius={RADIUS.xl} color={COL.skeleton} />)}
        </View>
      </View>
    </View>
  );
});

const OfflineBanner = React.memo(function OfflineBanner({ COL }: { COL: ThemeColors }) {
  const inner = (
    <View style={[s.offlineBanner, { backgroundColor: COL.danger }]} accessibilityRole="alert"
      accessibilityLabel="You are offline. Some features may not work." accessibilityLiveRegion="assertive">
      <Text style={[s.offlineBannerText, { color: COL.white }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        📡 You're offline — some features may be unavailable
      </Text>
    </View>
  );
  if (Platform.OS !== 'web') return <Animated.View entering={FadeInUp.duration(300)}>{inner}</Animated.View>;
  return inner;
});

const ErrorScreen = React.memo(function ErrorScreen({ error, onRetry, COL }: { error: string; onRetry: () => void; COL: ThemeColors }) {
  return (
    <View style={[s.centered, { backgroundColor: COL.bg }]} accessibilityRole="alert">
      <Text style={{ fontSize: FONT_SIZE.display, marginBottom: SPACING.lg }} accessibilityElementsHidden>😕</Text>
      <Text style={[s.errorText, { color: COL.text }]} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE}>{error}</Text>
      <TouchableOpacity style={[s.retryBtn, { backgroundColor: COL.primary }]} onPress={onRetry} activeOpacity={0.8}
        accessibilityRole="button" accessibilityLabel="Retry loading" accessibilityHint="Double tap to retry">
        <Text style={[s.retryBtnText, { color: COL.white }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
});

interface ProfileHeaderProps {
  userPhoto: string; selfieVerified: boolean; isChampion: boolean; userName: string;
  loginStreak: number; longestStreak: number; personalityType: string; maskedEmail: string;
  COL: ThemeColors; reducedMotion: boolean;
}
const ProfileHeader = React.memo(function ProfileHeader({ userPhoto, selfieVerified, isChampion, userName, loginStreak, longestStreak, personalityType, maskedEmail, COL, reducedMotion }: ProfileHeaderProps) {
  const greeting   = getGreeting();
  const streakA11y = loginStreak > 1
    ? `${loginStreak} day login streak${loginStreak === longestStreak && loginStreak >= 7 ? ', personal best!' : ''}`
    : loginStreak === 1 ? 'Come back tomorrow to start a streak' : '';
  const content = (
    <View style={s.profileHeader} accessibilityRole="summary">
      <View style={s.photoWrap}>
        {userPhoto ? (
          <Image source={{ uri: userPhoto }} style={[s.photo, { borderColor: COL.primary }]} contentFit="cover" transition={200}
            accessibilityLabel={`${userName}'s profile photo`} accessibilityRole="image" />
        ) : (
          <View style={[s.photoPlaceholder, { backgroundColor: COL.card, borderColor: COL.primary }]}
            accessibilityLabel="No profile photo. Tap Edit Profile to add one." accessibilityRole="image">
            <Text style={[s.photoPlaceholderText, { color: COL.dim }]} accessibilityElementsHidden>?</Text>
          </View>
        )}
        {selfieVerified && (
          <View style={[s.verifiedBadge, { backgroundColor: COL.blue, borderColor: COL.bg }]}
            accessibilityLabel="Selfie verified" accessibilityRole="image">
            <Text style={[s.verifiedIcon, { color: COL.white }]} accessibilityElementsHidden>✓</Text>
          </View>
        )}
        {isChampion && (
          <View style={[s.championBadge, { backgroundColor: COL.gold, borderColor: COL.bg }]}
            accessibilityLabel="Community champion" accessibilityRole="image">
            <Text style={s.championIcon} accessibilityElementsHidden>🌟</Text>
          </View>
        )}
      </View>
      <Text style={[s.welcomeText, { color: COL.sub }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{greeting},</Text>
      <Text style={[s.userName, { color: COL.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityRole="header" accessibilityLabel={`${greeting}, ${userName}`}>{userName}!</Text>
      {loginStreak > 1 && (
        <View style={[s.streakBadge, { backgroundColor: COL.orange }]} accessibilityRole="text" accessibilityLabel={streakA11y}>
          <Text style={[s.streakText, { color: COL.white }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            🔥 {loginStreak}-day streak!{loginStreak === longestStreak && loginStreak >= 7 ? ' (Personal best!)' : ''}
          </Text>
        </View>
      )}
      {loginStreak === 1 && (
        <View style={[s.streakBadge, { backgroundColor: COL.card, borderWidth: 1, borderColor: COL.orange }]}
          accessibilityRole="text" accessibilityLabel={streakA11y}>
          <Text style={[s.streakText, { color: COL.orange }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
            🔥 Come back tomorrow to start a streak!
          </Text>
        </View>
      )}
      {isChampion && (
        <View style={[s.championLabel, { backgroundColor: COL.gold }]} accessibilityRole="text" accessibilityLabel="Community Champion">
          <Text style={[s.championLabelText, { color: COL.bg }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>🌟 Community Champion</Text>
        </View>
      )}
      {personalityType !== '' && (
        <View style={[s.personalityBadge, { backgroundColor: COL.orange }]} accessibilityRole="text" accessibilityLabel={`Personality type: ${personalityType}`}>
          <Text style={[s.personalityBadgeText, { color: COL.white }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>{personalityType}</Text>
        </View>
      )}
      <Text style={[s.email, { color: COL.primary }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={`Email: ${maskedEmail}`}>{maskedEmail}</Text>
    </View>
  );
  if (!reducedMotion && Platform.OS !== 'web') return <Animated.View entering={FadeInDown.duration(500)}>{content}</Animated.View>;
  return content;
});

interface StrengthCardProps { profileStrength: ProfileStrengthResult; onPress: () => void; COL: ThemeColors; reducedMotion: boolean; index: number; }
const StrengthCard = React.memo(function StrengthCard({ profileStrength, onPress, COL, reducedMotion, index }: StrengthCardProps) {
  const sColor  = strengthColor(profileStrength.score, COL);
  const content = (
    <TouchableOpacity style={[s.strengthCard, { backgroundColor: COL.card, borderColor: COL.primary }]} onPress={onPress} activeOpacity={0.8}
      accessibilityRole="button" accessibilityLabel={`Profile strength ${profileStrength.score}%. ${profileStrength.label}. Tap to edit profile.`}
      accessibilityHint="Double tap to open profile editor">
      <View style={s.strengthHeader}>
        <Text style={[s.strengthTitle, { color: COL.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
          {strengthEmoji(profileStrength.score)} Profile Strength
        </Text>
        <Text style={[s.strengthScore, { color: sColor }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>{profileStrength.score}%</Text>
      </View>
      <View style={[s.strengthBarBg, { backgroundColor: COL.border }]}
        accessibilityRole="progressbar" accessibilityValue={{ min:0, max:100, now:profileStrength.score, text:`${profileStrength.score}%` }}>
        <View style={[s.strengthBarFill, { width:`${profileStrength.score}%` as `${number}%`, backgroundColor: sColor }]} importantForAccessibility="no" />
      </View>
      <Text style={[s.strengthLabel, { color: COL.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>{profileStrength.label}</Text>
      {(profileStrength.suggestions?.length ?? 0) > 0 && profileStrength.score < 100 && (
        <View style={[s.suggestionsWrap, { borderTopColor: COL.border }]} importantForAccessibility="no">
          <Text style={[s.suggestionsTitle, { color: COL.primary }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>💡 Tips to improve:</Text>
          {(profileStrength.suggestions ?? []).slice(0, 2).map((tip, i) => (
            <Text key={i} style={[s.suggestionText, { color: COL.sub }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>• {tip}</Text>
          ))}
          <Text style={[s.tapHint, { color: COL.primary }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>Tap to edit profile →</Text>
        </View>
      )}
      {profileStrength.score >= 100 && (
        <View style={s.perfectWrap} importantForAccessibility="no">
          <Text style={[s.perfectText, { color: COL.success }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>🎉 Your profile is perfect!</Text>
        </View>
      )}
    </TouchableOpacity>
  );
  if (!reducedMotion && Platform.OS !== 'web') return <Animated.View entering={FadeInDown.delay(index * 80).duration(400)} style={s.fullWidth}>{content}</Animated.View>;
  return <View style={s.fullWidth}>{content}</View>;
});

interface PromptCardProps {
  icon: string; title: string; subtitle: string; onPress: () => void;
  borderColor: string; accentColor: string; COL: ThemeColors; reducedMotion: boolean;
  index: number; a11yLabel: string; a11yHint?: string; rightContent?: React.ReactNode;
}
const PromptCard = React.memo(function PromptCard({ icon, title, subtitle, onPress, borderColor, accentColor, COL, reducedMotion, index, a11yLabel, a11yHint, rightContent }: PromptCardProps) {
  const content = (
    <TouchableOpacity style={[s.promptCard, { backgroundColor: COL.card, borderColor }]} onPress={onPress} activeOpacity={0.8}
      accessibilityRole="button" accessibilityLabel={a11yLabel} accessibilityHint={a11yHint ?? `Double tap to open ${title}`}>
      <View style={s.promptLeft}>
        <Text style={s.promptIcon} accessibilityElementsHidden>{icon}</Text>
        <View style={s.promptTextWrap}>
          <Text style={[s.promptTitle, { color: accentColor }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>{title}</Text>
          <Text style={[s.promptSub, { color: COL.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>{subtitle}</Text>
        </View>
      </View>
      {rightContent ?? <Text style={[s.promptArrow, { color: accentColor }]} accessibilityElementsHidden>→</Text>}
    </TouchableOpacity>
  );
  if (!reducedMotion && Platform.OS !== 'web') return <Animated.View entering={FadeInDown.delay(index * 80).duration(400)} style={s.fullWidth}>{content}</Animated.View>;
  return <View style={s.fullWidth}>{content}</View>;
});

const EmptyMatchesCard = React.memo(function EmptyMatchesCard({ COL, onPress, reducedMotion, index }: { COL: ThemeColors; onPress: () => void; reducedMotion: boolean; index: number }) {
  const content = (
    <TouchableOpacity style={[s.emptyMatchesCard, { backgroundColor: COL.card, borderColor: COL.primary }]} onPress={onPress} activeOpacity={0.8}
      accessibilityRole="button" accessibilityLabel="No matches yet. Tap to start finding matches." accessibilityHint="Double tap to browse profiles">
      <Text style={s.emptyMatchesEmoji} accessibilityElementsHidden>💫</Text>
      <Text style={[s.emptyMatchesTitle, { color: COL.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>Start finding your match!</Text>
      <Text style={[s.emptyMatchesSub, { color: COL.muted }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>Swipe to discover people who are right for you</Text>
    </TouchableOpacity>
  );
  if (!reducedMotion && Platform.OS !== 'web') return <Animated.View entering={FadeInDown.delay(index * 80).duration(400)} style={s.fullWidth}>{content}</Animated.View>;
  return <View style={s.fullWidth}>{content}</View>;
});

interface NavItemRendererProps { item: NavItem; onNav: (r: AppRoute) => void; COL: ThemeColors; reducedMotion: boolean; index: number; isWide: boolean; }
const NavItemRenderer = React.memo(function NavItemRenderer({ item, onNav, COL, reducedMotion, index, isWide }: NavItemRendererProps) {
  const btnWidth: '48%' | '100%' = isWide ? '48%' : '100%';
  const cleanLabel = item.label.replace(/^\S+\s/, '');
  const handlePress = useCallback(() => onNav(item.route), [onNav, item.route]);
  const btn = (
    <TouchableOpacity
      style={[s.navBtn, { backgroundColor: item.color, width: btnWidth }, item.borderColor != null && { borderWidth: 2, borderColor: item.borderColor }]}
      onPress={handlePress} activeOpacity={0.8} accessibilityRole="menuitem"
      accessibilityLabel={item.badge ? `${cleanLabel}, ${item.badge} notifications` : cleanLabel}
      accessibilityHint={item.a11yHint ?? `Double tap to open ${cleanLabel}`}>
      <Text style={[s.navBtnText, { color: COL.white }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>{item.label}</Text>
      {!!item.badge && (
        <View style={[s.navBadge, { backgroundColor: COL.bg }]} accessibilityElementsHidden>
          <Text style={[s.navBadgeText, { color: COL.gold }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>{item.badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
  if (!reducedMotion && Platform.OS !== 'web') return <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>{btn}</Animated.View>;
  return btn;
});

interface LogoutButtonProps { onLogout: () => void; loggingOut: boolean; COL: ThemeColors; reducedMotion: boolean; index: number; isWide: boolean; }
const LogoutButton = React.memo(function LogoutButton({ onLogout, loggingOut, COL, reducedMotion, index, isWide }: LogoutButtonProps) {
  const btnWidth: '48%' | '100%' = isWide ? '48%' : '100%';
  const btn = (
    <TouchableOpacity style={[s.logoutBtn, { borderColor: COL.danger, width: btnWidth }]} onPress={onLogout} activeOpacity={0.8} disabled={loggingOut}
      accessibilityRole="button" accessibilityLabel={loggingOut ? 'Logging out' : 'Log out'}
      accessibilityHint="Double tap to sign out" accessibilityState={{ disabled: loggingOut, busy: loggingOut }}>
      <Text style={[s.logoutBtnText, { color: COL.danger }]} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden>
        {loggingOut ? '⏳ Logging out…' : '🚪 Log Out'}
      </Text>
    </TouchableOpacity>
  );
  if (!reducedMotion && Platform.OS !== 'web') return <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>{btn}</Animated.View>;
  return btn;
});

type NavListItem = NavItem | { key: '__logout__' };

interface NavigationGridProps {
  navItems: NavItem[]; onNav: (r: AppRoute) => void; onLogout: () => void;
  loggingOut: boolean; COL: ThemeColors; reducedMotion: boolean; screenWidth: number; startIndex: number;
}
const NavigationGrid = React.memo(function NavigationGrid({ navItems, onNav, onLogout, loggingOut, COL, reducedMotion, screenWidth, startIndex }: NavigationGridProps) {
  const isWide     = screenWidth >= 600;
  const numColumns = isWide ? 2 : 1;
  const listData   = useMemo<NavListItem[]>(() => [...navItems, { key: '__logout__' }], [navItems]);

  const renderItem = useCallback(({ item, index }: { item: NavListItem; index: number }) => {
    if (item.key === '__logout__') {
      return <LogoutButton onLogout={onLogout} loggingOut={loggingOut} COL={COL} reducedMotion={reducedMotion} index={startIndex + index} isWide={isWide} />;
    }
    return <NavItemRenderer item={item as NavItem} onNav={onNav} COL={COL} reducedMotion={reducedMotion} index={startIndex + index} isWide={isWide} />;
  }, [onNav, onLogout, loggingOut, COL, reducedMotion, startIndex, isWide]);

  const keyExtractor = useCallback((item: NavListItem) => item.key, []);

  return (
    <FlatList
      data={listData} renderItem={renderItem} keyExtractor={keyExtractor}
      numColumns={numColumns} key={numColumns} scrollEnabled={false}
      contentContainerStyle={s.navListContent}
      columnWrapperStyle={isWide ? s.navColumnWrapper : undefined}
      accessibilityRole="menu" accessibilityLabel="Navigation menu"
      removeClippedSubviews={false}
    />
  );
});

// ── Main ────────────────────────────────────────────────────

export default function HomeScreen() {
  const router        = useRouter();
  const insets        = useSafeAreaInsets();
  const colorScheme   = useColorScheme();
  const { width: screenWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion() ?? false;
  const COL: ThemeColors = colorScheme === 'light' ? LIGHT_THEME : DARK_THEME;
  const [state, dispatch] = useReducer(homeReducer, initialState);
  const isMountedRef  = useRef(true);

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  const {
    loading, refreshing, error, userData, loginStreak, longestStreak,
    profileStrength, showDailyQuestion, isOnline, loggingOut,
    authReady, userId, userEmail,
  } = state;

  const userName        = userData?.name          ?? 'User';
  const userPhoto       = userData?.photos?.[0]   ?? '';
  const personalityType = userData?.personalityType ?? '';
  const isAdmin         = userData?.isAdmin        === true;
  const selfieVerified  = userData?.selfieVerified === true;
  const profileViews    = userData?.profileViews   ?? 0;
  const referralCount   = userData?.referralCount  ?? 0;
  const matchCount      = userData?.matchCount     ?? 0;
  const isChampion      = referralCount >= CHAMPION_THRESHOLD;
  const maskedEmail     = userEmail ? maskEmail(userEmail) : '';

  const computedStrength = useMemo<ProfileStrengthResult | null>(
    () => userData ? calculateProfileStrength(userData) : null,
    [userData],
  );
  useEffect(() => { dispatch({ type: 'SET_PROFILE_STRENGTH', payload: computedStrength }); }, [computedStrength]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      if (!isMountedRef.current) return;
      dispatch({ type: 'SET_AUTH', payload: { ready: true, userId: user?.uid ?? null, email: user?.email ?? null } });
      if (!user) dispatch({ type: 'SET_LOADING', payload: false });
    });
    return () => unsub();
  }, []);

  useEffect(() => { if (authReady && !userId) router.replace('/login' as AppRoute); }, [authReady, userId, router]);

  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { key:'matches',      label:'💕 My Matches',        route:'/my-matches',       color:COL.success, a11yHint:'Double tap to view your matches' },
      { key:'find',         label:'🔍 Find Matches',      route:'/matches',           color:COL.primary, a11yHint:'Double tap to browse new matches' },
      { key:'second',       label:'👀 Second Look',       route:'/second-look',       color:COL.purple,  a11yHint:'Double tap to review skipped profiles' },
      { key:'quiz',         label:'🧠 Personality Quiz',  route:'/personality-quiz',  color:COL.orange,  a11yHint:'Double tap to take the personality quiz' },
      { key:'edit',         label:'✏️ Edit Profile',      route:'/edit-profile',      color:COL.blue,    a11yHint:'Double tap to edit your profile' },
      { key:'stats',        label:'📊 Your Stats',        route:'/dating-stats',      color:COL.teal,    a11yHint:'Double tap to view your stats' },
      { key:'stories',      label:'📖 Stories',           route:'/stories',           color:COL.purple,  a11yHint:'Double tap to read stories' },
      { key:'safety',       label:'🛡️ Date Safety',      route:'/date-checkin',      color:COL.success, a11yHint:'Double tap to set up safety check-ins' },
      { key:'relationship', label:'💕 Relationship Mode', route:'/relationship-mode', color:COL.red,     a11yHint:'Double tap for relationship mode' },
      { key:'spots',        label:'📍 Date Spots',        route:'/date-spot-reviews', color:COL.amber,   a11yHint:'Double tap to browse date spots' },
      { key:'settings',     label:'⚙️ Settings',          route:'/settings',          color:COL.border,  a11yHint:'Double tap to open settings' },
      { key:'referral',     label:'🌟 Invite Friends',    route:'/referral',          color:COL.gold,    badge: referralCount > 0 ? referralCount : undefined, a11yHint:'Double tap to invite friends' },
      { key:'admin',        label:'👮 Admin Panel',       route:'/admin',             color:COL.purple,  show: isAdmin, borderColor: COL.gold, a11yHint:'Double tap to open admin panel' },
    ];
    if (__DEV__) items.push({ key:'debug', label:'🐛 Debug', route:'/debug', color:COL.dim });
    return items.filter(i => i.show !== false);
  }, [isAdmin, referralCount, COL]);

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
    void loadUserData();
    void trackStreak();
  }, [userId, authReady, loadUserData, trackStreak]);

  const onRefresh = useCallback(async () => {
    dispatch({ type: 'SET_REFRESHING', payload: true });
    await Promise.all([loadUserData(), trackStreak()]);
    try {
      const answered = await hasAnsweredToday();
      if (isMountedRef.current) dispatch({ type: 'SET_DAILY_QUESTION', payload: !answered });
    } catch (err: unknown) {
      logger.warn('dailyQuestion refresh check failed:', err);
    }
    if (isMountedRef.current) dispatch({ type: 'SET_REFRESHING', payload: false });
  }, [loadUserData, trackStreak]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const answered = await hasAnsweredToday();
        if (!cancelled && isMountedRef.current) dispatch({ type: 'SET_DAILY_QUESTION', payload: !answered });
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
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void updateLastSeen(); else void setOffline();
    });
    return () => { clearInterval(interval); sub.remove(); void setOffline(); };
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => { if (isMountedRef.current) dispatch({ type: 'SET_ONLINE', payload: navigator.onLine }); };
      dispatch({ type: 'SET_ONLINE', payload: navigator.onLine });
      window.addEventListener('online', update);
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
    registerForPushNotifications().catch(() => {});
    const sub = addNotificationResponseListener(response => {
      const data = response.notification.request.content.data as NotificationData;
      if (data?.type === 'match')             router.push('/my-matches' as AppRoute);
      else if (data?.type === 'message')      router.push({ pathname: '/chat' as AppRoute, params: { matchId: data.matchId ?? '', matchName: data.matchName ?? '' } });
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
        `Home screen loaded. ${getGreeting()}, ${userName}.${loginStreak > 1 ? ` ${loginStreak} day login streak.` : ''}${profileStrength ? ` Profile strength ${profileStrength.score} percent.` : ''}`,
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
      { text: 'Log Out', style: 'destructive', onPress: async () => {
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
      }},
    ]);
  }, [loggingOut, router]);

  const handleRetry         = useCallback(() => { dispatch({ type: 'SET_LOADING', payload: true }); dispatch({ type: 'SET_ERROR', payload: null }); void loadUserData(); void trackStreak(); }, [loadUserData, trackStreak]);
  const handleEditProfile   = useCallback(() => handleNav('/edit-profile'),   [handleNav]);
  const handleDailyQuestion = useCallback(() => handleNav('/daily-question'), [handleNav]);
  const handleProfileViews  = useCallback(() => handleNav('/profile-views'),  [handleNav]);
  const handleFindMatches   = useCallback(() => handleNav('/matches'),         [handleNav]);

  const animIndices = useMemo(() => {
    let n = 0;
    return {
      strength:     profileStrength   != null ? n++ : -1,
      dailyQ:       showDailyQuestion          ? n++ : -1,
      profileViews: profileViews > 0           ? n++ : -1,
      emptyMatches: matchCount === 0 && userData != null ? n++ : -1,
      navStart:     n,
    };
  }, [profileStrength, showDailyQuestion, profileViews, matchCount, userData]);

  if (loading || !authReady) return <><StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} /><HomeScreenSkeleton COL={COL} insets={insets} /></>;
  if (error)                 return <><StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} /><ErrorScreen error={error} onRetry={handleRetry} COL={COL} /></>;
  if (!userId)               return null;

  return (
    <>
      <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
      <ScrollView
        style={[s.scroll, { backgroundColor: COL.bg }]}
        contentContainerStyle={[s.scrollContent, { paddingTop: insets.top + SPACING.xl, paddingBottom: insets.bottom + SPACING.xxxxl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COL.primary} colors={[COL.primary]} progressBackgroundColor={COL.card} />}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel="Home screen content">

        {!isOnline && <OfflineBanner COL={COL} />}

        <ProfileHeader
          userPhoto={userPhoto} selfieVerified={selfieVerified} isChampion={isChampion}
          userName={userName} loginStreak={loginStreak} longestStreak={longestStreak}
          personalityType={personalityType} maskedEmail={maskedEmail}
          COL={COL} reducedMotion={reducedMotion}
        />

        {profileStrength != null && (
          <StrengthCard profileStrength={profileStrength} onPress={handleEditProfile} COL={COL} reducedMotion={reducedMotion} index={animIndices.strength} />
        )}

        {showDailyQuestion && (
          <PromptCard icon="💭" title="Today's Question" subtitle="Answer to boost your profile!"
            onPress={handleDailyQuestion} borderColor={COL.purple} accentColor={COL.purple}
            COL={COL} reducedMotion={reducedMotion} index={animIndices.dailyQ}
            a11yLabel="Today's daily question. Tap to answer and boost your profile."
            a11yHint="Double tap to open the daily question" />
        )}

        {profileViews > 0 && (
          <PromptCard icon="👀" title={`${profileViews}`} subtitle="people viewed your profile"
            onPress={handleProfileViews} borderColor={COL.orange} accentColor={COL.orange}
            COL={COL} reducedMotion={reducedMotion} index={animIndices.profileViews}
            a11yLabel={`${profileViews} people viewed your profile. Tap to see who.`}
            a11yHint="Double tap to see who viewed your profile"
            rightContent={<Text style={[s.promptArrow, { color: COL.orange }]} accessibilityElementsHidden>→</Text>} />
        )}

        {matchCount === 0 && userData != null && (
          <EmptyMatchesCard COL={COL} onPress={handleFindMatches} reducedMotion={reducedMotion} index={animIndices.emptyMatches} />
        )}

        {userData != null && <ProfileCompletionCard userData={userData} showDetails />}

        <NavigationGrid
          navItems={navItems} onNav={handleNav} onLogout={handleLogout}
          loggingOut={loggingOut} COL={COL} reducedMotion={reducedMotion}
          screenWidth={screenWidth} startIndex={animIndices.navStart}
        />
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  scroll:               { flex: 1 },
  scrollContent:        { alignItems: 'center', paddingHorizontal: SPACING.xl },
  fullWidth:            { width: '100%' },
  centered:             { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl },
  errorText:            { fontSize: FONT_SIZE.lg, textAlign: 'center', marginBottom: SPACING.xl, lineHeight: 24 },
  retryBtn:             { paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxxl, borderRadius: RADIUS.xl, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  retryBtnText:         { fontSize: FONT_SIZE.lg, fontWeight: '600' },
  offlineBanner:        { width: '100%', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.md, marginBottom: SPACING.lg, alignItems: 'center' },
  offlineBannerText:    { fontSize: FONT_SIZE.md, fontWeight: '600', textAlign: 'center' },
  skeletonGrid:         { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%', gap: SPACING.sm, marginTop: SPACING.xl },
  profileHeader:        { alignItems: 'center', marginBottom: SPACING.sm },
  photoWrap:            { position: 'relative', marginBottom: SPACING.lg },
  photo:                { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: RADIUS.full, borderWidth: 3 },
  photoPlaceholder:     { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: RADIUS.full, justifyContent: 'center', alignItems: 'center', borderWidth: 3 },
  photoPlaceholderText: { fontSize: FONT_SIZE.display },
  verifiedBadge:        { position: 'absolute', bottom: 0, right: 0, borderRadius: RADIUS.lg, width: SPACING.xxxl, height: SPACING.xxxl, justifyContent: 'center', alignItems: 'center', borderWidth: 3 },
  verifiedIcon:         { fontSize: FONT_SIZE.base, fontWeight: 'bold' },
  championBadge:        { position: 'absolute', top: -5, right: -5, borderRadius: RADIUS.lg, width: SPACING.xxxl, height: SPACING.xxxl, justifyContent: 'center', alignItems: 'center', borderWidth: 3 },
  championIcon:         { fontSize: FONT_SIZE.base },
  welcomeText:          { fontSize: FONT_SIZE.lg },
  userName:             { fontSize: FONT_SIZE.xxxl, fontWeight: 'bold', marginTop: SPACING.xs },
  streakBadge:          { paddingVertical: SPACING.xs + 2, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.lg, marginTop: SPACING.sm + 2 },
  streakText:           { fontSize: FONT_SIZE.md, fontWeight: 'bold' },
  championLabel:        { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.sm },
  championLabelText:    { fontSize: FONT_SIZE.sm, fontWeight: 'bold' },
  personalityBadge:     { paddingVertical: SPACING.xs + 2, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.lg, marginTop: SPACING.sm + 2 },
  personalityBadgeText: { fontSize: FONT_SIZE.base, fontWeight: '600' },
  email:                { fontSize: FONT_SIZE.base, marginBottom: SPACING.xl },
  strengthCard:         { borderRadius: RADIUS.lg, padding: SPACING.lg, width: '100%', marginBottom: SPACING.lg, borderWidth: 2 },
  strengthHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  strengthTitle:        { fontSize: FONT_SIZE.lg, fontWeight: 'bold' },
  strengthScore:        { fontSize: FONT_SIZE.xxxl, fontWeight: 'bold' },
  strengthBarBg:        { height: 10, borderRadius: RADIUS.sm, overflow: 'hidden', marginBottom: SPACING.sm + 2 },
  strengthBarFill:      { height: '100%', borderRadius: RADIUS.sm },
  strengthLabel:        { fontSize: FONT_SIZE.base, textAlign: 'center', marginBottom: SPACING.sm },
  suggestionsWrap:      { borderTopWidth: 1, paddingTop: SPACING.md, marginTop: SPACING.xs },
  suggestionsTitle:     { fontSize: FONT_SIZE.md, marginBottom: SPACING.sm, fontWeight: '600' },
  suggestionText:       { fontSize: FONT_SIZE.md, marginBottom: SPACING.xs, lineHeight: 18 },
  tapHint:              { fontSize: FONT_SIZE.sm, marginTop: SPACING.sm, fontStyle: 'italic', textAlign: 'right' },
  perfectWrap:          { alignItems: 'center', marginTop: SPACING.xs },
  perfectText:          { fontSize: FONT_SIZE.base, fontWeight: '600' },
  promptCard:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: RADIUS.lg, padding: SPACING.lg, width: '100%', marginBottom: SPACING.lg, borderWidth: 2, minHeight: 48 },
  promptLeft:           { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 },
  promptTextWrap:       { flex: 1 },
  promptIcon:           { fontSize: FONT_SIZE.xxxl },
  promptTitle:          { fontSize: FONT_SIZE.lg, fontWeight: 'bold' },
  promptSub:            { fontSize: FONT_SIZE.md },
  promptArrow:          { fontSize: SPACING.xl },
  emptyMatchesCard:     { borderRadius: RADIUS.lg, padding: SPACING.xxl, width: '100%', marginBottom: SPACING.lg, borderWidth: 2, alignItems: 'center' },
  emptyMatchesEmoji:    { fontSize: FONT_SIZE.display + 8, marginBottom: SPACING.sm },
  emptyMatchesTitle:    { fontSize: FONT_SIZE.xl, fontWeight: 'bold', marginBottom: SPACING.xs },
  emptyMatchesSub:      { fontSize: FONT_SIZE.base, textAlign: 'center' },
  navListContent:       { gap: SPACING.sm + 2, paddingTop: SPACING.lg, width: '100%' },
  navColumnWrapper:     { justifyContent: 'space-between' },
  navBtn:               { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: SPACING.lg, borderRadius: RADIUS.xl, gap: SPACING.sm + 2, minHeight: 48 },
  navBtnText:           { fontSize: FONT_SIZE.xl, fontWeight: '600' },
  navBadge:             { borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xxs },
  navBadgeText:         { fontSize: FONT_SIZE.sm, fontWeight: 'bold' },
  logoutBtn:            { backgroundColor: 'transparent', borderWidth: 2, paddingVertical: SPACING.lg, borderRadius: RADIUS.xl, alignItems: 'center', marginTop: SPACING.sm + 2, minHeight: 48 },
  logoutBtnText:        { fontSize: FONT_SIZE.xl, fontWeight: '600' },
});