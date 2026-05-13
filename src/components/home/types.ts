import type { ProfileStrengthResult } from '../../utils/profileStrength';

export type AppRoute =
  | '/login' | '/my-matches' | '/matches' | '/second-look' | '/personality-quiz'
  | '/edit-profile' | '/dating-stats' | '/stories' | '/date-checkin'
  | '/relationship-mode' | '/date-spot-reviews' | '/settings' | '/referral'
  | '/admin' | '/daily-question' | '/profile-views' | '/chat' | '/debug' | '/profile-setup';

export interface NavItem {
  key: string;
  label: string;
  route: AppRoute;
  colorKey: 'success' | 'primary' | 'purple' | 'orange' | 'blue' | 'teal' | 'red' | 'gold' | 'dim';
  show?: boolean;
  badge?: number;
  isBordered?: boolean;
  a11yHint?: string;
}

export interface UserData {
  name?: string; photos?: string[]; personalityType?: string; isAdmin?: boolean;
  selfieVerified?: boolean; profileViews?: number; referralCount?: number;
  loginStreak?: number; longestStreak?: number; matchCount?: number;
  profileComplete?: boolean; age?: number; bio?: string; gender?: string;
  interestedIn?: string; occupation?: string;
  height?: number | { value: number; verificationMethod?: string };
  bodyType?: string; interests?: string[]; dealBreakers?: string[];
  relationshipGoal?: string; pushToken?: string;
}

export interface HomeState {
  loading: boolean; refreshing: boolean; error: string | null;
  userData: UserData | null; loginStreak: number; longestStreak: number;
  profileStrength: ProfileStrengthResult | null; showDailyQuestion: boolean;
  isOnline: boolean; loggingOut: boolean; authReady: boolean;
  userId: string | null; userEmail: string | null;
}

export type HomeAction =
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

export interface NotificationData {
  type?: 'match' | 'message' | 'profile_view';
  matchId?: string;
  matchName?: string;
}

export const MAX_FONT_SCALE    = 1.3;
export const AVATAR_SIZE       = 100;
export const CHAMPION_THRESHOLD = 10;