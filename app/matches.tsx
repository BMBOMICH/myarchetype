import { layout, prepare } from '@chenglou/pretext';
import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import {
  collection, doc, getDoc, getDocs,
  query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  InteractionManager,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import TurboImage from '../src/components/TurboImage';
import { StyleSheet } from 'react-native-unistyles';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import VerificationBadge from '../components/VerificationBadge';
import { auth, db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { calculateDistance } from '../utils/location';
import { logger } from '../utils/logger';
import { formatLastSeen, isUserOnline } from '../utils/onlineStatus';
import { recordSkippedProfile } from '../utils/secondLook';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_WIDTH = SCREEN_WIDTH - 80;
const SERVER      = process.env['EXPO_PUBLIC_SERVER_URL'] ?? 'https://myarchetype-server.vercel.app';

const LOCAL = {
  white:            '#ffffff',
  success:          '#5cb85c',
  warning:          '#e67e22',
  danger:           '#d9534f',
  verifiedBlue:     '#3498db',
  cardSurface:      '#16213e',
  deepSurface:      '#0f3460',
  matchBg:          '#1a5c3a',
  matchText:        '#5cb85c',
  textMuted:        '#666666',
  textSub:          '#888888',
  overlayPhoto:     'rgba(0,0,0,0.6)',
  onlineBg:         'rgba(92,184,92,0.2)',
  dotInactive:      'rgba(255,255,255,0.4)',
  bioText:          '#dddddd',
  placeholderInput: '#555555',
} as const;

const BODY_FONT        = '15px Inter';
const BODY_LINE_HEIGHT = 22 / 15;
const CARD_INNER_WIDTH = SCREEN_WIDTH - 20 * 2 - 20 * 2;
const CARD_FIXED_HEIGHT = 1216;

const pretextCache = new Map<string, number>();

function measureText(text: string, containerWidth: number): number {
  const key = `${text}|${containerWidth}`;
  const hit = pretextCache.get(key);
  if (hit !== undefined) return hit;
  const prepared = prepare(text, BODY_FONT);
  const result   = layout(prepared, containerWidth, BODY_LINE_HEIGHT);
  pretextCache.set(key, result.height);
  if (pretextCache.size > 1000) {
    const oldest = pretextCache.keys().next().value;
    if (oldest) pretextCache.delete(oldest);
  }
  return result.height;
}

function measureCardHeight(user: UserProfile): number {
  let textHeight = 0;
  if (user.bio && user.bio.length > 0) {
    const bioChrome = 53;
    textHeight += bioChrome + measureText(`"${user.bio}"`, CARD_INNER_WIDTH);
  }
  if (user.icebreaker && user.icebreaker.length > 0) {
    const icebreakerChrome = 69;
    textHeight += icebreakerChrome + measureText(user.icebreaker, CARD_INNER_WIDTH - 30);
  }
  return CARD_FIXED_HEIGHT + textHeight;
}

const BODY_TYPES           = ['Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size']                 as const;
const RELIGIOUS_OPTIONS    = ['Traditional', 'Modern', 'Spiritual', 'None']                         as const;
const LIFESTYLE_OPTIONS    = ['Natural', 'Fitness', 'Social', 'Homebody']                           as const;
const RELATIONSHIP_OPTIONS = ['Marriage', 'Long-term', 'Exploring']                                 as const;
const PERSONALITY_OPTIONS  = ['Social Butterfly', 'Balanced Explorer', 'Thoughtful Soul', 'Mixed'] as const;
const DISTANCE_OPTIONS = [
  { v: '10',   l: '10 km'  },
  { v: '25',   l: '25 km'  },
  { v: '50',   l: '50 km'  },
  { v: '100',  l: '100 km' },
  { v: '250',  l: '250 km' },
  { v: '9999', l: 'Any'    },
] as const;
const ACTIVE_WITHIN_OPTIONS = [
  { value: 'any', label: 'Any time'   },
  { value: '24h', label: 'Today'      },
  { value: '7d',  label: 'This week'  },
  { value: '30d', label: 'This month' },
] as const;

interface AgeVerification {
  verified:      boolean;
  method:        'self-reported' | 'ai-estimated' | 'id-verified';
  estimatedAge:  number | null;
  statedAge:     number;
  ageDifference: number | null;
  verifiedAt:    string;
  confidence:    number;
}
interface UserRatings {
  totalRatings:            number;
  averagePhotosMatch:      number;
  heightAccuracyRate:      number;
  bodyTypeAccuracyRate:    number;
  ageAccuracyRate:         number;
  averagePersonalityMatch: number;
  averageOverall:          number;
  trustScore:              number;
}
interface UserProfile {
  uid:               string;
  name:              string;
  age:               number;
  gender:            string;
  height:            number | { value: number; verificationMethod?: string; confidence?: number };
  bodyType:          string;
  lookingFor:        string;
  email:             string;
  photos?:           string[];
  bio?:              string;
  religiousViews?:   string;
  lifestyle?:        string;
  relationshipGoal?: string;
  personalityType?:  string;
  personalityScores?: { serious: number; social: number };
  blockedUsers?:     string[];
  location?:         { latitude: number; longitude: number; city?: string; country?: string };
  lastSeen?:         { toMillis?: () => number };
  isOnline?:         boolean;
  selfieVerified?:   boolean;
  ageVerified?:      boolean;
  ageVerification?:  AgeVerification;
  hasFullBodyPhoto?: boolean;
  pushToken?:        string;
  icebreaker?:       string;
  icebreakerPrompt?: string;
  ratings?:          UserRatings;
}
interface FirestoreUserData { blockedUsers?: string[]; }
interface Filters {
  minAge:            string;
  maxAge:            string;
  maxDistance:       string;
  minHeight:         string;
  maxHeight:         string;
  bodyTypes:         string[];
  religiousViews:    string[];
  lifestyles:        string[];
  relationshipGoals: string[];
  personalityTypes:  string[];
  verifiedOnly:      boolean;
  activeWithin:      string;
  hasBio:            boolean;
  minPhotos:         number;
}
type MatchEntry = { user: UserProfile; score: number; reasons: string[] };
interface LikeDoc {
  fromUserId: string;
  toUserId:   string;
  status:     string;
  createdAt?: string;
  matchedAt?: string;
}

const DEFAULT_FILTERS: Filters = {
  minAge: '18', maxAge: '99', maxDistance: '9999', minHeight: '', maxHeight: '',
  bodyTypes: [], religiousViews: [], lifestyles: [], relationshipGoals: [], personalityTypes: [],
  verifiedOnly: false, activeWithin: 'any', hasBio: false, minPhotos: 1,
};

const getHeightValue = (h: UserProfile['height']): number =>
  typeof h === 'object' ? h?.value ?? 0 : h ?? 0;

const formatDistance = (km: number): string =>
  km < 1  ? 'Less than 1 km away' :
  km < 10 ? `${km.toFixed(1)} km away` :
  `${Math.round(km)} km away`;

const getScoreColor = (sc: number): string =>
  sc >= 80 ? LOCAL.success  :
  sc >= 60 ? '#53a8b6'      :
  sc >= 40 ? LOCAL.warning  :
  LOCAL.danger;

const toggleArr = (arr: string[], item: string): string[] =>
  arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item];

async function sendPush(
  token: string, title: string, body: string, type: string,
): Promise<void> {
  try {
    await fetch(`${SERVER}/send-expo-notification`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ expoPushToken: token, title, body, screen: type }),
    });
  } catch (err: unknown) {
    logger.warn('[Matches] sendPush failed:', err);
  }
}

function calcCompatibility(
  me: UserProfile, them: UserProfile,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (me.lookingFor === 'Any' || them.bodyType === me.lookingFor) {
    score += 15;
    if (them.bodyType === me.lookingFor) reasons.push(`Body type: ${them.bodyType} (your preference)`);
  }
  if (them.lookingFor === 'Any' || me.bodyType === them.lookingFor) {
    score += 15;
    reasons.push('You match their preferred body type');
  }
  if (me.personalityType && them.personalityType) {
    if (me.personalityType === them.personalityType) {
      score += 25; reasons.push(`Same personality: ${them.personalityType}`);
    } else if (me.personalityType === 'Mixed' || them.personalityType === 'Mixed') {
      score += 15; reasons.push(`Compatible personality: ${them.personalityType}`);
    } else score += 5;
  } else score += 10;

  if (me.religiousViews && them.religiousViews) {
    if (me.religiousViews === them.religiousViews) {
      score += 15; reasons.push(`Same views: ${them.religiousViews}`);
    } else score += 5;
  } else score += 7;

  if (me.lifestyle && them.lifestyle) {
    if (me.lifestyle === them.lifestyle) {
      score += 15; reasons.push(`Same lifestyle: ${them.lifestyle}`);
    } else score += 5;
  } else score += 7;

  if (me.relationshipGoal && them.relationshipGoal) {
    if (me.relationshipGoal === them.relationshipGoal) {
      score += 15; reasons.push(`Same goal: ${them.relationshipGoal}`);
    } else if (
      (me.relationshipGoal === 'Marriage'  && them.relationshipGoal === 'Long-term') ||
      (me.relationshipGoal === 'Long-term' && them.relationshipGoal === 'Marriage')
    ) score += 10;
    else score += 3;
  } else score += 7;

  if (them.selfieVerified) { score += 5; reasons.push('Verified identity'); }

  return { score: Math.min(Math.max(Math.round(score), 0), 100), reasons };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const PhotoDot = React.memo(function PhotoDot({ active }: { active: boolean }) {
  const dotStyle = useMemo(() => [s.dot, active && s.dotOn], [active]);
  return <View style={dotStyle} />;
});

interface FilterChipProps {
  label:     string;
  active:    boolean;
  onPress:   () => void;
  a11yLabel: string;
}
const FilterChip = React.memo(function FilterChip({
  label, active, onPress, a11yLabel,
}: FilterChipProps) {
  const chipStyle = useMemo(() => [s.chip, active && s.chipOn],       [active]);
  const txtStyle  = useMemo(() => [s.chipTxt, active && s.chipTxtOn], [active]);
  return (
    <TouchableOpacity
      style={chipStyle}
      onPress={onPress}
      accessibilityLabel={a11yLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={txtStyle}>{label}</Text>
    </TouchableOpacity>
  );
});

interface FilterToggleProps {
  label:     string;
  value:     boolean;
  onPress:   () => void;
  a11yLabel: string;
}
const FilterToggle = React.memo(function FilterToggle({
  label, value, onPress, a11yLabel,
}: FilterToggleProps) {
  const boxStyle = useMemo(() => [s.checkbox, value && s.checkboxOn], [value]);
  return (
    <TouchableOpacity
      style={s.toggleRow}
      onPress={onPress}
      accessibilityLabel={a11yLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <Text style={s.toggleTxt}>{label}</Text>
      <View style={boxStyle}>
        {value && <Text style={s.checkmark}>✓</Text>}
      </View>
    </TouchableOpacity>
  );
});

const PhotoItem = React.memo(function PhotoItem({
  uri, index, userName,
}: { uri: string; index: number; userName: string }) {
  // PHOTO_WIDTH is a module-level constant — no deps needed
  const photoStyle = useMemo(() => [s.photo, { width: PHOTO_WIDTH }], []);
  return (
    <TurboImage
      source={{ uri }}
      style={photoStyle}
      resizeMode="cover"
      cachePolicy="dataCache"
      accessibilityLabel={`Photo ${index + 1} of ${userName}`}
    />
  );
});

interface ChipGroupProps {
  label:     string;
  filterKey: string;
  opts:      readonly string[];
  selected:  string[];
  onToggle:  (key: string, val: string) => void;
}
const ChipGroup = React.memo(function ChipGroup({
  label, filterKey, opts, selected, onToggle,
}: ChipGroupProps) {
  return (
    <View>
      <Text style={s.filterLabel}>{label}</Text>
      <View style={s.chipRow}>
        {opts.map(o => {
          const active = selected.includes(o);
          return (
            <ChipGroupItem
              key={o}
              label={label}
              filterKey={filterKey}
              value={o}
              active={active}
              onToggle={onToggle}
            />
          );
        })}
      </View>
    </View>
  );
});

// Extracted so each chip gets its own stable onPress via useCallback
const ChipGroupItem = React.memo(function ChipGroupItem({
  label,
  filterKey,
  value,
  active,
  onToggle,
}: {
  label:     string;
  filterKey: string;
  value:     string;
  active:    boolean;
  onToggle:  (key: string, val: string) => void;
}) {
  const onPress = useCallback(() => onToggle(filterKey, value), [onToggle, filterKey, value]);
  return (
    <FilterChip
      label={value}
      active={active}
      onPress={onPress}
      a11yLabel={`${label}: ${value}${active ? ', selected' : ''}`}
    />
  );
});

interface PhotoStripProps {
  photos:   string[];
  userName: string;
  onScroll: (e: { nativeEvent: { contentOffset: { x: number } } }) => void;
  photoIdx: number;
}
const PhotoStrip = React.memo(function PhotoStrip({
  photos, userName, onScroll,
}: PhotoStripProps) {
  const renderPhoto = useCallback(
    ({ item: uri, index: i }: LegendListRenderItemProps<string>) => (
      <PhotoItem uri={uri} index={i} userName={userName} />
    ),
    [userName],
  );
  // uri and i are parameters — no external deps
  const keyExtractor = useCallback((uri: string, i: number) => `${uri}_${i}`, []);
  return (
    <LegendList
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      data={photos}
      keyExtractor={keyExtractor}
      onScroll={onScroll}
      scrollEventThrottle={16}
      renderItem={renderPhoto}
      recycleItems={true}
      estimatedItemSize={PHOTO_WIDTH}
      accessibilityLabel={`Photos of ${userName}, ${photos.length} total`}
    />
  );
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MatchesScreen() {
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [matches,     setMatches]     = useState<MatchEntry[]>([]);
  const [filtered,    setFiltered]    = useState<MatchEntry[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [idx,         setIdx]         = useState(0);
  const [photoIdx,    setPhotoIdx]    = useState(0);
  const [filters,     setFilters]     = useState<Filters>(DEFAULT_FILTERS);
  const [lastSkipped, setLastSkipped] = useState<MatchEntry | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const matchesRef     = useRef(matches);
  const filtersRef     = useRef(filters);
  const currentUserRef = useRef(currentUser);
  const mountedRef     = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { matchesRef.current     = matches;     }, [matches]);
  useEffect(() => { filtersRef.current     = filters;     }, [filters]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  const setF = useCallback(
    (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch })),
    [],
  );

  const handleChipToggle = useCallback((key: string, val: string) => {
    setFilters(f => ({ ...f, [key]: toggleArr(f[key as keyof Filters] as string[], val) }));
  }, []);

  const applyFilters = useCallback(() => {
    const f       = filtersRef.current;
    const cur     = currentUserRef.current;
    const src     = matchesRef.current;
    const minAge  = parseInt(f.minAge)      || 18;
    const maxAge  = parseInt(f.maxAge)      || 99;
    const maxDist = parseInt(f.maxDistance) || 9_999;
    const minH    = parseInt(f.minHeight)   || 0;
    const maxH    = parseInt(f.maxHeight)   || 999;
    const now     = Date.now();
    const limits: Record<string, number> = { '24h': 864e5, '7d': 6_048e5, '30d': 2_592e6 };

    const result = src.filter(m => {
      const u = m.user;
      if (u.age < minAge || u.age > maxAge) return false;
      if (cur?.location && u.location && maxDist < 9_999) {
        const d = calculateDistance(
          cur.location.latitude, cur.location.longitude,
          u.location.latitude,   u.location.longitude,
        );
        if (d > maxDist) return false;
      }
      const h = getHeightValue(u.height);
      if (minH > 0   && h < minH) return false;
      if (maxH < 999 && h > maxH) return false;
      if (f.bodyTypes.length         && !f.bodyTypes.includes(u.bodyType))                                              return false;
      if (f.religiousViews.length    && u.religiousViews   && !f.religiousViews.includes(u.religiousViews))             return false;
      if (f.lifestyles.length        && u.lifestyle        && !f.lifestyles.includes(u.lifestyle))                      return false;
      if (f.relationshipGoals.length && u.relationshipGoal && !f.relationshipGoals.includes(u.relationshipGoal))        return false;
      if (f.personalityTypes.length  && u.personalityType  && !f.personalityTypes.includes(u.personalityType))          return false;
      if (f.verifiedOnly && !u.selfieVerified) return false;
      if (f.activeWithin !== 'any') {
        const lastSeen = u.lastSeen?.toMillis?.() ?? 0;
        if (now - lastSeen > (limits[f.activeWithin] ?? Infinity)) return false;
      }
      if (f.hasBio && (!u.bio || u.bio.length < 10)) return false;
      if (f.minPhotos > 1 && (!u.photos || u.photos.length < f.minPhotos)) return false;
      return true;
    });

    result.sort((a, b) => {
      if (a.user.selfieVerified && !b.user.selfieVerified)  return -1;
      if (!a.user.selfieVerified && b.user.selfieVerified)  return  1;
      return b.score - a.score;
    });

    if (mountedRef.current) { setFiltered(result); setIdx(0); }
  }, []);

  const loadMatches = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) { router.replace('/login'); return; }

      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (!userSnap.exists()) {
        router.replace('/profile-setup');
        if (mountedRef.current) setLoading(false);
        return;
      }
      const me = userSnap.data() as UserProfile;
      if (mountedRef.current) setCurrentUser(me);
      const blocked = me.blockedUsers ?? [];

      let likesSnap: Awaited<ReturnType<typeof getDocs>>;
      let snap:      Awaited<ReturnType<typeof getDocs>>;
      try {
        [likesSnap, snap] = await Promise.all([
          getDocs(query(
            collection(db, 'likes'),
            where('fromUserId', '==', user.uid),
          )),
          getDocs(query(
            collection(db, 'users'),
            where('profileComplete', '==', true),
            where('gender', '!=', me.gender),
          )),
        ]);
      } catch (err: unknown) {
        logger.error('[Matches] Failed to fetch users:', err);
        if (mountedRef.current) setLoading(false);
        return;
      }

      const liked   = new Set<string>(likesSnap.docs.map(d => (d.data() as LikeDoc).toUserId));
      const scored: MatchEntry[] = [];

      snap.forEach(docSnap => {
        const them = docSnap.data() as UserProfile;
        if (
          them.uid === user.uid              ||
          blocked.includes(them.uid)        ||
          them.blockedUsers?.includes(user.uid) ||
          liked.has(them.uid)
        ) return;
        const bodyOk =
          (me.lookingFor === 'Any' || them.bodyType === me.lookingFor) &&
          (them.lookingFor === 'Any' || me.bodyType === them.lookingFor);
        if (!bodyOk) return;
        scored.push({ user: them, ...calcCompatibility(me, them) });
      });

      scored.sort((a, b) => b.score - a.score);
      if (mountedRef.current) setMatches(scored);
    } catch (e: unknown) {
      logger.error('[Matches] loadMatches error:', e);
      if (mountedRef.current) Alert.alert('Error', 'Failed to load matches. Please try again.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (mountedRef.current) setPhotoIdx(0);
    }, 0);
    return () => clearTimeout(timer);
  }, [idx]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      applyFilters();
    });
    return () => task.cancel();
  }, [matches, filters, applyFilters]);

  const handlePhotoScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      setPhotoIdx(Math.round(e.nativeEvent.contentOffset.x / PHOTO_WIDTH));
    },
    [],
  );

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const handleMinAge         = useCallback((t: string) => setF({ minAge:      t.replace(/\D/g, '') }), [setF]);
  const handleMaxAge         = useCallback((t: string) => setF({ maxAge:      t.replace(/\D/g, '') }), [setF]);
  const handleMinHeight      = useCallback((t: string) => setF({ minHeight:   t.replace(/\D/g, '') }), [setF]);
  const handleMaxHeight      = useCallback((t: string) => setF({ maxHeight:   t.replace(/\D/g, '') }), [setF]);
  const handleToggleBio      = useCallback(() => setF({ hasBio:       !filtersRef.current.hasBio       }), [setF]);
  const handleToggleVerified = useCallback(() => setF({ verifiedOnly: !filtersRef.current.verifiedOnly }), [setF]);
  const handleOpenFilters    = useCallback(() => setShowFilters(true),  []);
  const handleCloseFilters   = useCallback(() => setShowFilters(false), []);
  const handleApplyFilters   = useCallback(() => { applyFilters(); setShowFilters(false); }, [applyFilters]);

  const nextProfile = useCallback(() => setIdx(i => i + 1), []);

  const handleLike = useCallback(async () => {
    const entry = filtered[idx];
    if (!entry) return;
    const them = entry.user;
    const user = auth.currentUser;
    if (!user) return;
    setLastSkipped(null);
    try {
      let theirLike: Awaited<ReturnType<typeof getDocs>>;
      try {
        theirLike = await getDocs(query(
          collection(db, 'likes'),
          where('fromUserId', '==', them.uid),
          where('toUserId',   '==', user.uid),
        ));
      } catch (err: unknown) {
        logger.error('[Matches] handleLike fetch error:', err);
        Alert.alert('Error', 'Failed to send like. Please try again.');
        return;
      }

      const isMatch = !theirLike.empty;
      if (isMatch) {
        const theirDoc = theirLike.docs[0];
        if (!theirDoc) throw new Error('Like doc missing');
        const theirData = theirDoc.data() as LikeDoc;
        try {
          await Promise.all([
            setDoc(doc(db, 'likes', theirDoc.id), {
              ...theirData,
              status:    'matched',
              matchedAt: new Date().toISOString(),
            }),
            setDoc(doc(db, 'likes', `${user.uid}_${them.uid}`), {
              fromUserId: user.uid,
              toUserId:   them.uid,
              status:     'matched',
              createdAt:  new Date().toISOString(),
              matchedAt:  new Date().toISOString(),
            }),
          ]);
        } catch (err: unknown) {
          logger.error('[Matches] handleLike match write error:', err);
          Alert.alert('Error', 'Failed to record match. Please try again.');
          return;
        }
        if (them.pushToken) {
          await sendPush(
            them.pushToken,
            "It's a Match! 💕",
            `${currentUser?.name ?? 'Someone'} likes you too!`,
            'match',
          );
        }
        Alert.alert(
          "It's a Match! 💕",
          `You and ${them.name} like each other!\n\nCompatibility: ${entry.score}%`,
        );
      } else {
        try {
          await setDoc(doc(db, 'likes', `${user.uid}_${them.uid}`), {
            fromUserId: user.uid,
            toUserId:   them.uid,
            status:     'pending',
            createdAt:  new Date().toISOString(),
          });
        } catch (err: unknown) {
          logger.error('[Matches] handleLike pending write error:', err);
          Alert.alert('Error', 'Failed to send like. Please try again.');
          return;
        }
        if (them.pushToken) {
          await sendPush(them.pushToken, 'Someone likes you! 💝', 'Open the app to see who!', 'like');
        }
        Alert.alert('Like Sent! 💝', `Your like was sent to ${them.name}!`);
      }
      nextProfile();
    } catch (e: unknown) {
      logger.error('[Matches] handleLike error:', e);
      Alert.alert('Error', 'Failed to send like. Please try again.');
    }
  }, [filtered, idx, currentUser, nextProfile]);

  const handleSkip = useCallback(async () => {
    const entry = filtered[idx];
    if (!entry) return;
    setLastSkipped(entry);
    try {
      await recordSkippedProfile(entry.user.uid, entry.user.name);
    } catch (err: unknown) {
      logger.error('[Matches] recordSkippedProfile error:', err);
    }
    nextProfile();
  }, [filtered, idx, nextProfile]);

  const handleUndo = useCallback(() => {
    if (!lastSkipped) return;
    const i = filtered.findIndex(m => m.user.uid === lastSkipped.user.uid);
    if (i !== -1) setIdx(i);
    setLastSkipped(null);
    Alert.alert('Undo', `Here's ${lastSkipped.user.name} again.`);
  }, [lastSkipped, filtered]);

  const handleReport = useCallback(() => {
    const them = filtered[idx]?.user;
    const user = auth.currentUser;
    if (!user || !them) return;
    Alert.prompt(
      `Report ${them.name}`,
      'Why are you reporting this user?',
      async (reason) => {
        if (!reason) return;
        try {
          await setDoc(
            doc(db, 'reports', `${user.uid}_${them.uid}_${Date.now()}`),
            {
              reporterId:       user.uid,
              reportedUserId:   them.uid,
              reportedUserName: them.name,
              reason,
              createdAt: new Date().toISOString(),
              status:    'pending',
            },
          );
          Alert.alert('Reported', 'Thank you for keeping the community safe!');
          nextProfile();
        } catch (err: unknown) {
          logger.error('[Matches] handleReport error:', err);
          Alert.alert('Error', 'Failed to submit report');
        }
      },
      'plain-text',
    );
  }, [filtered, idx, nextProfile]);

  const handleBlock = useCallback(() => {
    const them = filtered[idx]?.user;
    const user = auth.currentUser;
    if (!user || !them) return;
    Alert.alert(
      `Block ${them.name}?`,
      "They won't be able to see your profile or contact you.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:  'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              const snap    = await getDoc(doc(db, 'users', user.uid));
              const current = (snap.data() as FirestoreUserData | undefined)?.blockedUsers ?? [];
              try {
                await Promise.all([
                  updateDoc(
                    doc(db, 'users', user.uid),
                    { blockedUsers: [...current, them.uid] },
                  ),
                  setDoc(
                    doc(db, 'blockedUsers', `${user.uid}_${them.uid}`),
                    { blockerId: user.uid, blockedId: them.uid, blockedAt: new Date().toISOString() },
                  ),
                ]);
              } catch (err: unknown) {
                logger.error('[Matches] handleBlock write error:', err);
                Alert.alert('Error', 'Failed to block user');
                return;
              }
              Alert.alert('Blocked', `${them.name} has been blocked.`);
              if (mountedRef.current) {
                setMatches(prev => prev.filter(m => m.user.uid !== them.uid));
              }
            } catch (err: unknown) {
              logger.error('[Matches] handleBlock error:', err);
              Alert.alert('Error', 'Failed to block user');
            }
          },
        },
      ],
    );
  }, [filtered, idx]);

  const activeFilterCount = useMemo((): number => {
    let n = 0;
    if (filters.minAge !== '18' || filters.maxAge !== '99') n++;
    if (filters.maxDistance !== '9999')    n++;
    if (filters.minHeight || filters.maxHeight) n++;
    if (filters.bodyTypes.length)          n++;
    if (filters.religiousViews.length)     n++;
    if (filters.lifestyles.length)         n++;
    if (filters.relationshipGoals.length)  n++;
    if (filters.personalityTypes.length)   n++;
    if (filters.verifiedOnly)              n++;
    if (filters.activeWithin !== 'any')    n++;
    if (filters.hasBio)                    n++;
    if (filters.minPhotos > 1)             n++;
    return n;
  }, [filters]);

  const distanceHandlers = useMemo(() =>
    DISTANCE_OPTIONS.reduce<Record<string, () => void>>((acc, o) => {
      acc[o.v] = () => setF({ maxDistance: o.v });
      return acc;
    }, {}),
  [setF]);

  const activeWithinHandlers = useMemo(() =>
    ACTIVE_WITHIN_OPTIONS.reduce<Record<string, () => void>>((acc, o) => {
      acc[o.value] = () => setF({ activeWithin: o.value });
      return acc;
    }, {}),
  [setF]);

  const minPhotosHandlers = useMemo(() =>
    ([1, 2, 3, 4] as const).reduce<Record<number, () => void>>((acc, n) => {
      acc[n] = () => setF({ minPhotos: n });
      return acc;
    }, {}),
  [setF]);

  const onGoHome      = useCallback(() => router.push('/home'),       [router]);
  const onGoMyMatches = useCallback(() => router.push('/my-matches'), [router]);
  const onHandleLike  = useCallback(() => void handleLike(),          [handleLike]);
  const onHandleSkip  = useCallback(() => void handleSkip(),          [handleSkip]);

  // ─── Derived values (not hooks) ────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={s.loadingText}>Finding your best matches...</Text>
      </View>
    );
  }

  if (filtered.length === 0) {
    return (
      <View style={s.center}>
        <Text style={s.bigEmoji} accessibilityElementsHidden>😔</Text>
        <Text style={s.title} accessibilityRole="header">No Matches Found</Text>
        <Text style={s.subtitle}>
          {matches.length > 0 ? 'Try adjusting your filters.' : 'Check back later!'}
        </Text>
        {matches.length > 0 && (
          <TouchableOpacity
            style={s.resetBtn}
            onPress={resetFilters}
            accessibilityLabel="Reset all filters"
            accessibilityRole="button"
          >
            <Text style={s.resetBtnText}>Reset Filters</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={s.btn}
          onPress={onGoHome}
          accessibilityLabel="Go back home"
          accessibilityRole="button"
        >
          <Text style={s.btnText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (idx >= filtered.length) {
    return (
      <View style={s.center}>
        <Text style={s.bigEmoji} accessibilityElementsHidden>🎉</Text>
        <Text style={s.title} accessibilityRole="header">That&apos;s Everyone!</Text>
        <Text style={s.subtitle}>
          You&apos;ve seen all {filtered.length} matches.{'\n'}Check back later!
        </Text>
        {lastSkipped && (
          <TouchableOpacity
            style={s.undoBtn}
            onPress={handleUndo}
            accessibilityLabel="Undo last skip"
            accessibilityRole="button"
          >
            <Text style={s.undoBtnText}>↩️ Undo Last Skip</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={s.btn}
          onPress={onGoHome}
          accessibilityLabel="Go back home"
          accessibilityRole="button"
        >
          <Text style={s.btnText}>Go Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, s.viewMatchesBtn]}
          onPress={onGoMyMatches}
          accessibilityLabel="View my matches"
          accessibilityRole="button"
        >
          <Text style={s.btnText}>View My Matches</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const entry          = filtered[idx]!;
  const u              = entry.user;
  const scoreColor     = getScoreColor(entry.score);
  const photoCount     = u.photos?.length ?? 0;
  const dist           = currentUser?.location && u.location
    ? calculateDistance(
        currentUser.location.latitude, currentUser.location.longitude,
        u.location.latitude,           u.location.longitude,
      )
    : null;
  const ageBadge       = getAgeVerificationLevel(u.ageVerification);
  const heightIsObj    = typeof u.height === 'object' && u.height !== null;
  const heightVerified = heightIsObj &&
    (u.height as { verificationMethod?: string }).verificationMethod === 'manual-measured';

  // These are plain expressions — not hooks — computed after early returns.
  // They depend on u which changes per profile, so useMemo would give no benefit
  // (new object on every render anyway). Kept as plain style arrays.
  const compatBadgeStyle = [s.compatBadge, { backgroundColor: scoreColor }];
  const ageBadgeStyle    = [s.ageBadge,    { backgroundColor: ageBadge.color }];

  const religiousViewsStyle    = [s.tag, currentUser?.religiousViews === u.religiousViews && s.tagMatch];
  const lifestyleStyle         = [s.tag, currentUser?.lifestyle      === u.lifestyle      && s.tagMatch];
  const relationshipGoalStyle  = [s.tag, currentUser?.relationshipGoal === u.relationshipGoal && s.tagMatch];
  const centeredSectionStyle   = [s.section, s.centeredSection];
  const estimatedCardHeight = measureCardHeight(u);

  const listHeader = (
    <View style={s.headerRow}>
      <TouchableOpacity
        onPress={onGoHome}
        accessibilityLabel="Go back home"
        accessibilityRole="button"
      >
        <Text style={s.back}>← Back</Text>
      </TouchableOpacity>
      <Text style={s.headerCount} accessibilityLabel={`Profile ${idx + 1} of ${filtered.length}`}>
        {idx + 1} of {filtered.length}
      </Text>
      <View style={s.headerRight}>
        {lastSkipped && (
          <TouchableOpacity
            style={s.undoSmall}
            onPress={handleUndo}
            accessibilityLabel="Undo last skip"
            accessibilityRole="button"
          >
            <Text accessibilityElementsHidden>↩️</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={s.filterBtn}
          onPress={handleOpenFilters}
          accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
          accessibilityRole="button"
        >
          <Text style={s.filterBtnText}>
            🎛️{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const listFooter = (
    <View>
      <View style={s.safetyRow}>
        <TouchableOpacity
          style={s.reportBtn}
          onPress={handleReport}
          accessibilityLabel={`Report ${u.name}`}
          accessibilityRole="button"
        >
          <Text style={s.reportBtnTxt}>🚩 Report</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.blockBtn}
          onPress={handleBlock}
          accessibilityLabel={`Block ${u.name}`}
          accessibilityRole="button"
        >
          <Text style={s.blockBtnTxt}>🚫 Block</Text>
        </TouchableOpacity>
      </View>
      <View style={s.actions}>
        <TouchableOpacity
          style={s.skipBtn}
          onPress={onHandleSkip}
          accessibilityLabel={`Skip ${u.name}`}
          accessibilityRole="button"
        >
          <Text style={s.skipBtnTxt}>✗ Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.likeBtn}
          onPress={onHandleLike}
          accessibilityLabel={`Like ${u.name}`}
          accessibilityRole="button"
        >
          <Text style={s.likeBtnTxt}>♥ Like</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={s.flex}>
      {/*
        data={[entry]} is intentional — a single-item LegendList is used
        to get ListHeaderComponent / ListFooterComponent scroll behavior
        with the profile card as the scrollable body. This is correct.
        recycleItems={false} is correct — the card JSX is unique per profile.
      */}
      <LegendList
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        data={[entry]}
        keyExtractor={(item: MatchEntry) => item.user.uid}
        recycleItems={false}
        estimatedItemSize={estimatedCardHeight}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        renderItem={() => (
          <View style={s.card}>
            {photoCount > 0 ? (
              <View style={s.photoWrap}>
                <PhotoStrip
                  photos={u.photos ?? []}
                  userName={u.name}
                  onScroll={handlePhotoScroll}
                  photoIdx={photoIdx}
                />
                {photoCount > 1 && (
                  <>
                    <View
                      style={s.photoBadge}
                      accessibilityLabel={`Photo ${photoIdx + 1} of ${photoCount}`}
                    >
                      <Text style={s.photoBadgeTxt}>{photoIdx + 1} / {photoCount}</Text>
                    </View>
                    <View style={s.dots} accessibilityElementsHidden>
                      {(u.photos ?? []).map((uri, i) => (
                        <PhotoDot key={uri} active={photoIdx === i} />
                      ))}
                    </View>
                  </>
                )}
                {u.selfieVerified && (
                  <View style={s.photoVerified}>
                    <VerificationBadge selfieVerified size="small" ratings={u.ratings} />
                  </View>
                )}
              </View>
            ) : (
              <View style={s.noPhoto} accessibilityLabel={`${u.name} has no photo`}>
                <Text style={s.noPhotoTxt}>No Photo</Text>
              </View>
            )}

            <View
              style={compatBadgeStyle}
              accessibilityLabel={`${entry.score} percent compatibility match`}
            >
              <Text style={s.compatTxt}>{entry.score}% Match</Text>
            </View>

            {entry.reasons.length > 0 && (
              <View style={s.mutualRow} accessibilityElementsHidden>
                {entry.reasons.slice(0, 2).map((r) => (
                  <View key={r} style={s.mutualChip}>
                    <Text style={s.mutualTxt}>✓ {r}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={s.nameSection}>
              <View style={s.nameRow}>
                <Text style={s.name} accessibilityRole="header">
                  {u.name}, {u.age}
                </Text>
                {u.selfieVerified && (
                  <Text style={s.verified} accessibilityLabel="Verified user">✓</Text>
                )}
              </View>
              {ageBadge.level !== 'unverified' && (
                <View
                  style={ageBadgeStyle}
                  accessibilityLabel={`Age verification: ${ageBadge.label}`}
                >
                  <Text style={s.ageBadgeIcon} accessibilityElementsHidden>
                    {ageBadge.icon}
                  </Text>
                  <Text style={s.ageBadgeTxt}>{ageBadge.label}</Text>
                </View>
              )}
            </View>

            {isUserOnline(u.lastSeen) ? (
              <View style={s.online} accessibilityLabel="User is online now">
                <View style={s.onlineDot} accessibilityElementsHidden />
                <Text style={s.onlineTxt}>Online now</Text>
              </View>
            ) : u.lastSeen ? (
              <Text style={s.lastSeen}>Last seen {formatLastSeen(u.lastSeen)}</Text>
            ) : null}

            {dist !== null && (
              <View style={s.distBadge} accessibilityLabel={formatDistance(dist)}>
                <Text style={s.distTxt}>📍 {formatDistance(dist)}</Text>
              </View>
            )}

            {u.icebreaker && (
              <View
                style={s.icebreaker}
                accessibilityLabel={`Icebreaker: ${u.icebreakerPrompt ?? 'Question'}: ${u.icebreaker}`}
              >
                <Text style={s.icebreakerLabel}>💬 {u.icebreakerPrompt ?? 'Icebreaker'}</Text>
                <Text style={s.icebreakerTxt}>{u.icebreaker}</Text>
              </View>
            )}

            {u.bio && (
              <View style={s.bio} accessibilityLabel={`Bio: ${u.bio}`}>
                <Text style={s.sectionTitle}>About Me</Text>
                <Text style={s.bioTxt}>"{u.bio}"</Text>
              </View>
            )}

            <View style={s.infoSection}>
              <View style={s.infoRow}>
                <Text style={s.label}>Height</Text>
                <HeightBadge height={u.height} />
              </View>
              <View style={s.infoRow}>
                <Text style={s.label}>Body Type</Text>
                <Text style={s.value}>{u.bodyType}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.label}>Looking For</Text>
                <Text style={s.value}>{u.lookingFor}</Text>
              </View>
              {u.location?.city && (
                <View style={s.infoRow}>
                  <Text style={s.label}>Location</Text>
                  <Text style={s.value}>{u.location.city}</Text>
                </View>
              )}
            </View>

            {(u.selfieVerified === true || (u.ratings?.totalRatings ?? 0) > 0) && u.ratings && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Trust &amp; Verification</Text>
                <TrustScoreDisplay
                  ratings={u.ratings}
                  selfieVerified={u.selfieVerified}
                  ageVerified={u.ageVerification?.verified}
                  heightVerified={heightVerified}
                  size="small"
                />
              </View>
            )}

            {(u.religiousViews ?? u.lifestyle ?? u.relationshipGoal) && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Beliefs &amp; Values</Text>
                {u.religiousViews && (
                  <View style={s.infoRow}>
                    <Text style={s.label}>Views</Text>
                    <Text style={religiousViewsStyle}>
                      {u.religiousViews}
                      {currentUser?.religiousViews === u.religiousViews ? ' ✓' : ''}
                    </Text>
                  </View>
                )}
                {u.lifestyle && (
                  <View style={s.infoRow}>
                    <Text style={s.label}>Lifestyle</Text>
                    <Text style={lifestyleStyle}>
                      {u.lifestyle}
                      {currentUser?.lifestyle === u.lifestyle ? ' ✓' : ''}
                    </Text>
                  </View>
                )}
                {u.relationshipGoal && (
                  <View style={s.infoRow}>
                    <Text style={s.label}>Goal</Text>
                    <Text style={relationshipGoalStyle}>
                      {u.relationshipGoal}
                      {currentUser?.relationshipGoal === u.relationshipGoal ? ' ✓' : ''}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {u.personalityType && (
              <View style={centeredSectionStyle}>
                <Text style={s.sectionTitle}>Personality</Text>
                <View
                  style={s.personalityBadge}
                  accessibilityLabel={`Personality type: ${u.personalityType}`}
                >
                  <Text style={s.personalityTxt}>{u.personalityType}</Text>
                </View>
                {currentUser?.personalityType === u.personalityType && (
                  <Text style={s.personalityMatch}>Same personality as you! 🎉</Text>
                )}
              </View>
            )}

            {entry.reasons.length > 0 && (
              <View
                style={s.reasons}
                accessibilityLabel={`Why you matched: ${entry.reasons.join(', ')}`}
              >
                <Text style={s.reasonsTitle} accessibilityElementsHidden>
                  💫 Why you matched:
                </Text>
                {entry.reasons.map((r) => (
                  <Text key={r} style={s.reasonTxt}>
                    • {r}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
      />

      {showFilters && (
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity
              onPress={handleCloseFilters}
              accessibilityLabel="Cancel filters"
              accessibilityRole="button"
            >
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>Filters</Text>
            <TouchableOpacity
              onPress={resetFilters}
              accessibilityLabel="Reset all filters"
              accessibilityRole="button"
            >
              <Text style={s.modalReset}>Reset</Text>
            </TouchableOpacity>
          </View>

          {/*
            data={['filters']} is intentional — single-item LegendList
            used to get scrollable filter body with sticky header/footer.
            recycleItems={false} is correct — filter form JSX is unique.
          */}
          <LegendList
            style={s.flex}
            contentContainerStyle={s.modalBody}
            data={['filters']}
            keyExtractor={(item: string) => item}
            recycleItems={false}
            estimatedItemSize={1200}
            renderItem={() => (
              <View>
                <Text style={s.filterLabel}>Age Range</Text>
                <View style={s.rangeRow}>
                  <TextInput
                    style={s.rangeInput}
                    value={filters.minAge}
                    onChangeText={handleMinAge}
                    keyboardType="numeric"
                    maxLength={2}
                    accessibilityLabel="Minimum age"
                  />
                  <Text style={s.rangeDash}>–</Text>
                  <TextInput
                    style={s.rangeInput}
                    value={filters.maxAge}
                    onChangeText={handleMaxAge}
                    keyboardType="numeric"
                    maxLength={2}
                    accessibilityLabel="Maximum age"
                  />
                </View>

                <Text style={s.filterLabel}>Max Distance</Text>
                <View style={s.chipRow}>
                  {DISTANCE_OPTIONS.map(o => (
                    <FilterChip
                      key={o.v}
                      label={o.l}
                      active={filters.maxDistance === o.v}
                      onPress={distanceHandlers[o.v] ?? (() => {})}
                      a11yLabel={`Distance: ${o.l}${filters.maxDistance === o.v ? ', selected' : ''}`}
                    />
                  ))}
                </View>

                <Text style={s.filterLabel}>Height (cm)</Text>
                <View style={s.rangeRow}>
                  <TextInput
                    style={s.rangeInput}
                    value={filters.minHeight}
                    onChangeText={handleMinHeight}
                    keyboardType="numeric"
                    maxLength={3}
                    placeholder="Min"
                    placeholderTextColor={LOCAL.placeholderInput}
                    accessibilityLabel="Minimum height in centimetres"
                  />
                  <Text style={s.rangeDash}>–</Text>
                  <TextInput
                    style={s.rangeInput}
                    value={filters.maxHeight}
                    onChangeText={handleMaxHeight}
                    keyboardType="numeric"
                    maxLength={3}
                    placeholder="Max"
                    placeholderTextColor={LOCAL.placeholderInput}
                    accessibilityLabel="Maximum height in centimetres"
                  />
                </View>

                <ChipGroup label="Body Type"         filterKey="bodyTypes"         opts={BODY_TYPES}           selected={filters.bodyTypes}         onToggle={handleChipToggle} />
                <ChipGroup label="Religious Views"   filterKey="religiousViews"    opts={RELIGIOUS_OPTIONS}    selected={filters.religiousViews}    onToggle={handleChipToggle} />
                <ChipGroup label="Lifestyle"         filterKey="lifestyles"        opts={LIFESTYLE_OPTIONS}    selected={filters.lifestyles}        onToggle={handleChipToggle} />
                <ChipGroup label="Relationship Goal" filterKey="relationshipGoals" opts={RELATIONSHIP_OPTIONS} selected={filters.relationshipGoals} onToggle={handleChipToggle} />
                <ChipGroup label="Personality Type"  filterKey="personalityTypes"  opts={PERSONALITY_OPTIONS}  selected={filters.personalityTypes}  onToggle={handleChipToggle} />

                <FilterToggle label="Verified users only" value={filters.verifiedOnly} onPress={handleToggleVerified} a11yLabel="Show verified users only" />
                <FilterToggle label="Must have bio"       value={filters.hasBio}       onPress={handleToggleBio}      a11yLabel="Show users with bio only" />

                <Text style={s.filterLabel}>Active Within</Text>
                <View style={s.chipRow}>
                  {ACTIVE_WITHIN_OPTIONS.map(o => (
                    <FilterChip
                      key={o.value}
                      label={o.label}
                      active={filters.activeWithin === o.value}
                      onPress={activeWithinHandlers[o.value] ?? (() => {})}
                      a11yLabel={`Active within: ${o.label}${filters.activeWithin === o.value ? ', selected' : ''}`}
                    />
                  ))}
                </View>

                <Text style={s.filterLabel}>Minimum Photos</Text>
                <View style={s.chipRow}>
                  {([1, 2, 3, 4] as const).map(n => (
                    <FilterChip
                      key={n}
                      label={String(n)}
                      active={filters.minPhotos === n}
                      onPress={minPhotosHandlers[n] ?? (() => {})}
                      a11yLabel={`Minimum ${n} photo${n > 1 ? 's' : ''}${filters.minPhotos === n ? ', selected' : ''}`}
                    />
                  ))}
                </View>

                <View style={s.filterSpacer} />
              </View>
            )}
          />

          <View style={s.modalFooter}>
            <TouchableOpacity
              style={s.applyBtn}
              onPress={handleApplyFilters}
              accessibilityLabel="Apply filters"
              accessibilityRole="button"
            >
              <Text style={s.applyBtnText}>
                Apply Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create((theme) => ({
  flex:             { flex: 1 },
  scroll:           { flex: 1, backgroundColor: theme.colors.background },
  scrollContent:    { padding: 20, paddingBottom: 40 },
  center:           { flex: 1, backgroundColor: theme.colors.background, padding: 20, justifyContent: 'center', alignItems: 'center' },
  loadingText:      { color: theme.colors.textSecondary, fontSize: 16, marginTop: 20, textAlign: 'center' },
  bigEmoji:         { fontSize: 60, marginBottom: 20 },
  title:            { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, marginBottom: 15, textAlign: 'center' },
  subtitle:         { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 20, lineHeight: 24 },

  btn:              { backgroundColor: LOCAL.deepSurface, paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25 },
  btnText:          { color: LOCAL.white, fontSize: 18, fontWeight: '600' },
  viewMatchesBtn:   { backgroundColor: theme.colors.primary, marginTop: 10 },
  resetBtn:         { backgroundColor: theme.colors.primary, paddingVertical: 12, paddingHorizontal: 25, borderRadius: 20, marginBottom: 15 },
  resetBtnText:     { color: LOCAL.white, fontSize: 14, fontWeight: '600' },
  undoBtn:          { backgroundColor: LOCAL.warning, paddingVertical: 15, paddingHorizontal: 30, borderRadius: 25, marginBottom: 15 },
  undoBtnText:      { color: LOCAL.white, fontSize: 16, fontWeight: '600' },

  headerRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, marginTop: 10 },
  back:             { color: theme.colors.primary, fontSize: 16 },
  headerCount:      { color: theme.colors.textSecondary, fontSize: 14 },
  headerRight:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  undoSmall:        { backgroundColor: LOCAL.warning, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15 },
  filterBtn:        { backgroundColor: LOCAL.deepSurface, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 15 },
  filterBtnText:    { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },

  card:             { backgroundColor: LOCAL.cardSurface, borderRadius: 20, padding: 20, marginBottom: 15, borderWidth: 2, borderColor: LOCAL.deepSurface },
  photoWrap:        { position: 'relative', marginBottom: 15, borderRadius: 15, overflow: 'hidden' },
  photo:            { height: 400, borderRadius: 15 },
  photoBadge:       { position: 'absolute', top: 10, right: 10, backgroundColor: LOCAL.overlayPhoto, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  photoBadgeTxt:    { color: LOCAL.white, fontSize: 12, fontWeight: '600' },
  dots:             { position: 'absolute', bottom: 15, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:              { width: 8, height: 8, borderRadius: 4, backgroundColor: LOCAL.dotInactive },
  dotOn:            { backgroundColor: LOCAL.white, width: 10, height: 10, borderRadius: 5 },
  photoVerified:    { position: 'absolute', top: 10, left: 10 },
  noPhoto:          { width: '100%', height: 400, borderRadius: 15, backgroundColor: LOCAL.deepSurface, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  noPhotoTxt:       { color: LOCAL.textMuted, fontSize: 18 },

  compatBadge:      { paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20, alignSelf: 'center', marginBottom: 15 },
  compatTxt:        { color: LOCAL.white, fontSize: 18, fontWeight: 'bold' },
  mutualRow:        { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 15 },
  mutualChip:       { backgroundColor: LOCAL.matchBg, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: LOCAL.matchText },
  mutualTxt:        { color: LOCAL.matchText, fontSize: 12, fontWeight: '600' },

  nameSection:      { alignItems: 'center', marginBottom: 10 },
  nameRow:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  name:             { fontSize: 30, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center' },
  verified:         { fontSize: 24, color: LOCAL.verifiedBlue },
  ageBadge:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  ageBadgeIcon:     { fontSize: 14, marginRight: 4, color: LOCAL.white },
  ageBadgeTxt:      { color: LOCAL.white, fontSize: 12, fontWeight: '600' },

  online:           { flexDirection: 'row', alignItems: 'center', backgroundColor: LOCAL.onlineBg, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, alignSelf: 'center', marginBottom: 5 },
  onlineDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: LOCAL.success, marginRight: 6 },
  onlineTxt:        { color: LOCAL.success, fontSize: 12, fontWeight: '600' },
  lastSeen:         { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'center', marginBottom: 5 },
  distBadge:        { backgroundColor: LOCAL.deepSurface, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 15, alignSelf: 'center', marginBottom: 15 },
  distTxt:          { color: theme.colors.primary, fontSize: 13 },

  icebreaker:       { backgroundColor: LOCAL.deepSurface, borderRadius: 15, padding: 15, marginBottom: 15 },
  icebreakerLabel:  { color: LOCAL.warning, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  icebreakerTxt:    { color: theme.colors.text, fontSize: 15, fontStyle: 'italic', lineHeight: 22 },
  bio:              { borderTopWidth: 1, borderTopColor: LOCAL.deepSurface, paddingTop: 15, marginTop: 5, marginBottom: 10 },
  bioTxt:           { color: LOCAL.bioText, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },

  infoSection:      { marginBottom: 5 },
  section:          { borderTopWidth: 1, borderTopColor: LOCAL.deepSurface, paddingTop: 15, marginTop: 10, marginBottom: 10 },
  centeredSection:  { alignItems: 'center' },
  sectionTitle:     { color: theme.colors.primary, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  infoRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label:            { color: theme.colors.textSecondary, fontSize: 15 },
  value:            { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  tag:              { backgroundColor: LOCAL.deepSurface, color: theme.colors.textSecondary, paddingVertical: 5, paddingHorizontal: 14, borderRadius: 12, fontSize: 14, overflow: 'hidden' },
  tagMatch:         { backgroundColor: LOCAL.matchBg, color: LOCAL.matchText, fontWeight: '600' },
  personalityBadge: { backgroundColor: LOCAL.warning, paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20, marginBottom: 8 },
  personalityTxt:   { color: LOCAL.white, fontSize: 16, fontWeight: 'bold' },
  personalityMatch: { color: LOCAL.success, fontSize: 12, marginTop: 4 },
  reasons:          { marginTop: 10, paddingTop: 15, borderTopWidth: 1, borderTopColor: LOCAL.deepSurface },
  reasonsTitle:     { color: theme.colors.primary, fontSize: 14, fontWeight: '600', marginBottom: 10 },
  reasonTxt:        { color: theme.colors.textSecondary, fontSize: 14, marginBottom: 5, lineHeight: 20 },

  safetyRow:        { flexDirection: 'row', justifyContent: 'center', gap: 30, marginBottom: 15 },
  reportBtn:        { paddingVertical: 8, paddingHorizontal: 15 },
  reportBtnTxt:     { color: LOCAL.warning, fontSize: 14 },
  blockBtn:         { paddingVertical: 8, paddingHorizontal: 15 },
  blockBtnTxt:      { color: theme.colors.error, fontSize: 14 },
  actions:          { flexDirection: 'row', justifyContent: 'space-around' },
  skipBtn:          { backgroundColor: theme.colors.error, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, flex: 1, marginRight: 10, alignItems: 'center' },
  skipBtnTxt:       { color: LOCAL.white, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  likeBtn:          { backgroundColor: LOCAL.success, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, flex: 1, marginLeft: 10, alignItems: 'center' },
  likeBtnTxt:       { color: LOCAL.white, fontSize: 18, fontWeight: '600', textAlign: 'center' },

  modal:            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.background, zIndex: 100 },
  modalHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: LOCAL.deepSurface },
  modalCancel:      { color: theme.colors.error, fontSize: 16 },
  modalTitle:       { color: theme.colors.text, fontSize: 18, fontWeight: 'bold' },
  modalReset:       { color: theme.colors.primary, fontSize: 16 },
  modalBody:        { padding: 20 },
  modalFooter:      { padding: 20, borderTopWidth: 1, borderTopColor: LOCAL.deepSurface },
  applyBtn:         { backgroundColor: LOCAL.success, paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  applyBtnText:     { color: LOCAL.white, fontSize: 18, fontWeight: '600' },

  filterLabel:      { color: theme.colors.primary, fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 12 },
  rangeRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 },
  rangeInput:       { backgroundColor: LOCAL.cardSurface, color: theme.colors.text, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, fontSize: 18, fontWeight: '600', width: 90, textAlign: 'center' },
  rangeDash:        { color: theme.colors.textSecondary, fontSize: 16 },
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  chip:             { backgroundColor: LOCAL.cardSurface, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 2, borderColor: LOCAL.cardSurface },
  chipOn:           { backgroundColor: LOCAL.deepSurface, borderColor: theme.colors.primary },
  chipTxt:          { color: theme.colors.textSecondary, fontSize: 14 },
  chipTxtOn:        { color: theme.colors.primary, fontWeight: '600' },
  toggleRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: LOCAL.cardSurface, padding: 15, borderRadius: 10, marginTop: 10 },
  toggleTxt:        { color: theme.colors.text, fontSize: 15 },
  checkbox:         { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
  checkboxOn:       { backgroundColor: theme.colors.primary },
  checkmark:        { color: LOCAL.white, fontSize: 14, fontWeight: 'bold' },
  filterSpacer:     { height: 100 },
}));