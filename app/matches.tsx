// app/matches.tsx
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HeightBadge from '../components/HeightBadge';
import TrustScoreDisplay from '../components/TrustScoreDisplay';
import VerificationBadge from '../components/VerificationBadge';
import { auth, db } from '../firebaseConfig';
import { getAgeVerificationLevel } from '../utils/ageVerification';
import { calculateDistance } from '../utils/location';
import { formatLastSeen, isUserOnline } from '../utils/onlineStatus';
import { recordSkippedProfile } from '../utils/secondLook';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_WIDTH = SCREEN_WIDTH - 80;

const BODY_TYPES = ['Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size'];
const RELIGIOUS_OPTIONS = ['Traditional', 'Modern', 'Spiritual', 'None'];
const LIFESTYLE_OPTIONS = ['Natural', 'Fitness', 'Social', 'Homebody'];
const RELATIONSHIP_OPTIONS = ['Marriage', 'Long-term', 'Exploring'];
const PERSONALITY_OPTIONS = ['Social Butterfly', 'Balanced Explorer', 'Thoughtful Soul', 'Mixed'];
const DISTANCE_OPTIONS = [{ v: '10', l: '10 km' }, { v: '25', l: '25 km' }, { v: '50', l: '50 km' }, { v: '100', l: '100 km' }, { v: '250', l: '250 km' }, { v: '9999', l: 'Any' }];
const ACTIVE_WITHIN_OPTIONS = [{ value: 'any', label: 'Any time' }, { value: '24h', label: 'Today' }, { value: '7d', label: 'This week' }, { value: '30d', label: 'This month' }];

// ── Types ──────────────────────────────────────────────────

interface AgeVerification {
  verified: boolean;
  method: 'self-reported' | 'ai-estimated' | 'id-verified';
  estimatedAge: number | null;
  statedAge: number;
  ageDifference: number | null;
  verifiedAt: string;
  confidence: number;
}

interface UserProfile {
  uid: string; name: string; age: number; gender: string;
  height: number | { value: number; verificationMethod?: string; confidence?: number };
  bodyType: string; lookingFor: string; email: string;
  photos?: string[]; bio?: string; religiousViews?: string;
  lifestyle?: string; relationshipGoal?: string; personalityType?: string;
  personalityScores?: { serious: number; social: number };
  blockedUsers?: string[];
  location?: { latitude: number; longitude: number; city?: string; country?: string };
  lastSeen?: any; isOnline?: boolean;
  selfieVerified?: boolean; ageVerified?: boolean; ageVerification?: AgeVerification;
  hasFullBodyPhoto?: boolean; pushToken?: string;
  icebreaker?: string; icebreakerPrompt?: string;
  ratings?: { totalRatings: number; averagePhotosMatch: number; heightAccuracyRate: number; bodyTypeAccuracyRate: number; ageAccuracyRate: number; averagePersonalityMatch: number; averageOverall: number; trustScore: number };
}

interface Filters {
  minAge: string; maxAge: string; maxDistance: string;
  minHeight: string; maxHeight: string;
  bodyTypes: string[]; religiousViews: string[]; lifestyles: string[];
  relationshipGoals: string[]; personalityTypes: string[];
  verifiedOnly: boolean; activeWithin: string; hasBio: boolean; minPhotos: number;
}

type MatchEntry = { user: UserProfile; score: number; reasons: string[] };

const DEFAULT_FILTERS: Filters = {
  minAge: '18', maxAge: '99', maxDistance: '9999',
  minHeight: '', maxHeight: '',
  bodyTypes: [], religiousViews: [], lifestyles: [],
  relationshipGoals: [], personalityTypes: [],
  verifiedOnly: false, activeWithin: 'any', hasBio: false, minPhotos: 1,
};

// ── Helpers ────────────────────────────────────────────────

const getHeightValue = (h: any): number => (typeof h === 'object' ? h?.value ?? 0 : h ?? 0);

const formatDistance = (km: number): string =>
  km < 1 ? 'Less than 1 km away' : km < 10 ? `${km.toFixed(1)} km away` : `${Math.round(km)} km away`;

const getScoreColor = (s: number): string =>
  s >= 80 ? '#5cb85c' : s >= 60 ? '#53a8b6' : s >= 40 ? '#e67e22' : '#d9534f';

const toggleArr = (arr: string[], item: string): string[] =>
  arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item];

const SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://myarchetype-server.vercel.app';

async function sendPush(token: string, title: string, body: string, type: string): Promise<void> {
  try {
    await fetch(`${SERVER}/send-expo-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expoPushToken: token, title, body, screen: type }),
    });
  } catch { /* non-critical */ }
}

function calcCompatibility(me: UserProfile, them: UserProfile): { score: number; reasons: string[] } {
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
    if (me.personalityType === them.personalityType) { score += 25; reasons.push(`Same personality: ${them.personalityType}`); }
    else if (me.personalityType === 'Mixed' || them.personalityType === 'Mixed') { score += 15; reasons.push(`Compatible personality: ${them.personalityType}`); }
    else score += 5;
  } else score += 10;

  if (me.religiousViews && them.religiousViews) {
    if (me.religiousViews === them.religiousViews) { score += 15; reasons.push(`Same views: ${them.religiousViews}`); }
    else score += 5;
  } else score += 7;

  if (me.lifestyle && them.lifestyle) {
    if (me.lifestyle === them.lifestyle) { score += 15; reasons.push(`Same lifestyle: ${them.lifestyle}`); }
    else score += 5;
  } else score += 7;

  if (me.relationshipGoal && them.relationshipGoal) {
    if (me.relationshipGoal === them.relationshipGoal) { score += 15; reasons.push(`Same goal: ${them.relationshipGoal}`); }
    else if (
      (me.relationshipGoal === 'Marriage' && them.relationshipGoal === 'Long-term') ||
      (me.relationshipGoal === 'Long-term' && them.relationshipGoal === 'Marriage')
    ) score += 10;
    else score += 3;
  } else score += 7;

  if (them.selfieVerified) { score += 5; reasons.push('Verified identity'); }

  return { score: Math.min(Math.max(Math.round(score), 0), 100), reasons };
}

// ── Component ──────────────────────────────────────────────

export default function MatchesScreen() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [matches, setMatches] = useState<MatchEntry[]>([]);
  const [filtered, setFiltered] = useState<MatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [lastSkipped, setLastSkipped] = useState<MatchEntry | null>(null);

  useEffect(() => { loadMatches(); }, []);
  useEffect(() => { setPhotoIdx(0); }, [idx]);
  useEffect(() => { applyFilters(); }, [matches, filters]);

  const applyFilters = () => {
    const minAge = parseInt(filters.minAge) || 18;
    const maxAge = parseInt(filters.maxAge) || 99;
    const maxDist = parseInt(filters.maxDistance) || 9999;
    const minH = parseInt(filters.minHeight) || 0;
    const maxH = parseInt(filters.maxHeight) || 999;
    const now = Date.now();

    const result = matches.filter(m => {
      const u = m.user;
      if (u.age < minAge || u.age > maxAge) return false;
      if (currentUser?.location && u.location && maxDist < 9999) {
        const d = calculateDistance(currentUser.location.latitude, currentUser.location.longitude, u.location.latitude, u.location.longitude);
        if (d > maxDist) return false;
      }
      const h = getHeightValue(u.height);
      if (minH > 0 && h < minH) return false;
      if (maxH < 999 && h > maxH) return false;
      if (filters.bodyTypes.length && !filters.bodyTypes.includes(u.bodyType)) return false;
      if (filters.religiousViews.length && u.religiousViews && !filters.religiousViews.includes(u.religiousViews)) return false;
      if (filters.lifestyles.length && u.lifestyle && !filters.lifestyles.includes(u.lifestyle)) return false;
      if (filters.relationshipGoals.length && u.relationshipGoal && !filters.relationshipGoals.includes(u.relationshipGoal)) return false;
      if (filters.personalityTypes.length && u.personalityType && !filters.personalityTypes.includes(u.personalityType)) return false;
      if (filters.verifiedOnly && !u.selfieVerified) return false;
      if (filters.activeWithin !== 'any') {
        const lastSeen = u.lastSeen?.toMillis?.() ?? 0;
        const limits: Record<string, number> = { '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };
        if (now - lastSeen > (limits[filters.activeWithin] ?? Infinity)) return false;
      }
      if (filters.hasBio && (!u.bio || u.bio.length < 10)) return false;
      if (filters.minPhotos > 1 && (!u.photos || u.photos.length < filters.minPhotos)) return false;
      return true;
    });

    result.sort((a, b) => {
      if (a.user.selfieVerified && !b.user.selfieVerified) return -1;
      if (!a.user.selfieVerified && b.user.selfieVerified) return 1;
      return b.score - a.score;
    });

    setFiltered(result);
    setIdx(0);
  };

  const loadMatches = async () => {
    try {
      const user = auth.currentUser;
      if (!user) { setTimeout(() => router.replace('/login'), 100); return; }

      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (!userSnap.exists()) { setTimeout(() => router.replace('/profile-setup'), 100); setLoading(false); return; }

      const me = userSnap.data() as UserProfile;
      setCurrentUser(me);
      const blocked = me.blockedUsers ?? [];

      const likesSnap = await getDocs(query(collection(db, 'likes'), where('fromUserId', '==', user.uid)));
      const liked = new Set<string>(likesSnap.docs.map(d => d.data().toUserId));

      const snap = await getDocs(query(collection(db, 'users'), where('profileComplete', '==', true), where('gender', '!=', me.gender)));
      const scored: MatchEntry[] = [];

      snap.forEach(docSnap => {
        const them = docSnap.data() as UserProfile;
        if (them.uid === user.uid) return;
        if (blocked.includes(them.uid)) return;
        if (them.blockedUsers?.includes(user.uid)) return;
        if (liked.has(them.uid)) return;
        const bodyOk = (me.lookingFor === 'Any' || them.bodyType === me.lookingFor) &&
                       (them.lookingFor === 'Any' || me.bodyType === them.lookingFor);
        if (!bodyOk) return;
        scored.push({ user: them, ...calcCompatibility(me, them) });
      });

      scored.sort((a, b) => b.score - a.score);
      setMatches(scored);
    } catch (e) {
      alert(`Error loading matches: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async () => {
    const entry = filtered[idx];
    const them = entry.user;
    const user = auth.currentUser;
    if (!user) return;

    setLastSkipped(null);

    try {
      const theirLike = await getDocs(query(collection(db, 'likes'), where('fromUserId', '==', them.uid), where('toUserId', '==', user.uid)));
      const isMatch = !theirLike.empty;

      if (isMatch) {
        await setDoc(doc(db, 'likes', theirLike.docs[0]!.id), { ...theirLike.docs[0]!.data(), status: 'matched', matchedAt: new Date().toISOString() });
        await setDoc(doc(db, 'likes', `${user.uid}_${them.uid}`), { fromUserId: user.uid, toUserId: them.uid, status: 'matched', createdAt: new Date().toISOString(), matchedAt: new Date().toISOString() });
        if (them.pushToken) await sendPush(them.pushToken, "It's a Match! 💕", `${currentUser?.name ?? 'Someone'} likes you too!`, 'match');
        alert(`It's a Match! 💕\n\nYou and ${them.name} like each other!\n\nCompatibility: ${entry.score}%`);
      } else {
        await setDoc(doc(db, 'likes', `${user.uid}_${them.uid}`), { fromUserId: user.uid, toUserId: them.uid, status: 'pending', createdAt: new Date().toISOString() });
        if (them.pushToken) await sendPush(them.pushToken, 'Someone likes you! 💝', 'Open the app to see who!', 'like');
        alert(`Like sent to ${them.name}! 💝`);
      }

      nextProfile();
    } catch (e) { alert(`Error saving like: ${e}`); }
  };

  const handleSkip = async () => {
    const entry = filtered[idx];
    setLastSkipped(entry);
    await recordSkippedProfile(entry.user.uid, entry.user.name);
    nextProfile();
  };

  const handleUndo = () => {
    if (!lastSkipped) return;
    const i = filtered.findIndex(m => m.user.uid === lastSkipped.user.uid);
    if (i !== -1) setIdx(i);
    setLastSkipped(null);
    alert(`Undo successful! Here's ${lastSkipped.user.name} again.`);
  };

  const handleReport = async () => {
    const them = filtered[idx]?.user;
    const user = auth.currentUser;
    if (!user || !them) return;
    const reason = prompt(`Why are you reporting ${them.name}?`);
    if (!reason) return;
    try {
      await setDoc(doc(db, 'reports', `${user.uid}_${them.uid}_${Date.now()}`), { reporterId: user.uid, reportedUserId: them.uid, reportedUserName: them.name, reason, createdAt: new Date().toISOString(), status: 'pending' });
      alert('Report submitted. Thank you for keeping the community safe!');
      nextProfile();
    } catch { alert('Error submitting report'); }
  };

  const handleBlock = async () => {
    const them = filtered[idx]?.user;
    const user = auth.currentUser;
    if (!user || !them) return;
    if (!confirm(`Block ${them.name}?\n\nThey won't be able to see your profile or contact you.`)) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const current = snap.data()?.blockedUsers ?? [];
      await updateDoc(doc(db, 'users', user.uid), { blockedUsers: [...current, them.uid] });
      await setDoc(doc(db, 'blockedUsers', `${user.uid}_${them.uid}`), { blockerId: user.uid, blockedId: them.uid, blockedAt: new Date().toISOString() });
      alert(`${them.name} has been blocked.`);
      setMatches(prev => prev.filter(m => m.user.uid !== them.uid));
    } catch { alert('Error blocking user'); }
  };

  const nextProfile = () => setIdx(i => i + 1);

  const getActiveFilterCount = (): number => {
    let n = 0;
    if (filters.minAge !== '18' || filters.maxAge !== '99') n++;
    if (filters.maxDistance !== '9999') n++;
    if (filters.minHeight || filters.maxHeight) n++;
    if (filters.bodyTypes.length) n++;
    if (filters.religiousViews.length) n++;
    if (filters.lifestyles.length) n++;
    if (filters.relationshipGoals.length) n++;
    if (filters.personalityTypes.length) n++;
    if (filters.verifiedOnly) n++;
    if (filters.activeWithin !== 'any') n++;
    if (filters.hasBio) n++;
    if (filters.minPhotos > 1) n++;
    return n;
  };

  const setF = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));

  // ── Loading ──
  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator size="large" color="#53a8b6" />
      <Text style={s.loadingText}>Finding your best matches...</Text>
    </View>
  );

  // ── No matches ──
  if (filtered.length === 0) return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>😔</Text>
      <Text style={s.title}>No Matches Found</Text>
      <Text style={s.subtitle}>{matches.length > 0 ? 'Try adjusting your filters.' : 'Check back later!'}</Text>
      {matches.length > 0 && <TouchableOpacity style={s.resetBtn} onPress={() => setFilters(DEFAULT_FILTERS)}><Text style={s.resetBtnText}>Reset Filters</Text></TouchableOpacity>}
      <TouchableOpacity style={s.btn} onPress={() => router.push('/home')}><Text style={s.btnText}>Go Home</Text></TouchableOpacity>
    </View>
  );

  // ── All swiped ──
  if (idx >= filtered.length) return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🎉</Text>
      <Text style={s.title}>That's Everyone!</Text>
      <Text style={s.subtitle}>You've seen all {filtered.length} matches.{'\n'}Check back later!</Text>
      {lastSkipped && <TouchableOpacity style={s.undoBtn} onPress={handleUndo}><Text style={s.undoBtnText}>↩️ Undo Last Skip</Text></TouchableOpacity>}
      <TouchableOpacity style={s.btn} onPress={() => router.push('/home')}><Text style={s.btnText}>Go Home</Text></TouchableOpacity>
      <TouchableOpacity style={[s.btn, { backgroundColor: '#53a8b6', marginTop: 10 }]} onPress={() => router.push('/my-matches')}><Text style={s.btnText}>View My Matches</Text></TouchableOpacity>
    </View>
  );

  // ── Main view ──
  const entry = filtered[idx]!;
  const u = entry.user;
  const scoreColor = getScoreColor(entry.score);
  const photoCount = u.photos?.length ?? 0;
  const dist = currentUser?.location && u.location ? calculateDistance(currentUser.location.latitude, currentUser.location.longitude, u.location.latitude, u.location.longitude) : null;
  const ageBadge = getAgeVerificationLevel(u.ageVerification);
  const activeFilters = getActiveFilterCount();

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
      {/* Header */}
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => router.push('/home')}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.headerCount}>{idx + 1} of {filtered.length}</Text>
        <View style={s.headerRight}>
          {lastSkipped && <TouchableOpacity style={s.undoSmall} onPress={handleUndo}><Text>↩️</Text></TouchableOpacity>}
          <TouchableOpacity style={s.filterBtn} onPress={() => setShowFilters(true)}>
            <Text style={s.filterBtnText}>🎛️{activeFilters > 0 ? ` (${activeFilters})` : ''}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filters Modal */}
      <Modal visible={showFilters} animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowFilters(false)}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Filters</Text>
            <TouchableOpacity onPress={() => setFilters(DEFAULT_FILTERS)}><Text style={s.modalReset}>Reset</Text></TouchableOpacity>
          </View>

          <ScrollView style={s.modalBody}>
            {/* Age */}
            <Text style={s.filterLabel}>Age Range</Text>
            <View style={s.rangeRow}>
              <TextInput style={s.rangeInput} value={filters.minAge} onChangeText={t => setF({ minAge: t.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={2} placeholder="18" placeholderTextColor="#666" />
              <Text style={s.rangeDash}>to</Text>
              <TextInput style={s.rangeInput} value={filters.maxAge} onChangeText={t => setF({ maxAge: t.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={2} placeholder="99" placeholderTextColor="#666" />
            </View>

            {/* Distance */}
            {currentUser?.location && <>
              <Text style={s.filterLabel}>Max Distance</Text>
              <View style={s.chipRow}>
                {DISTANCE_OPTIONS.map(o => (
                  <TouchableOpacity key={o.v} style={[s.chip, filters.maxDistance === o.v && s.chipOn]} onPress={() => setF({ maxDistance: o.v })}>
                    <Text style={[s.chipTxt, filters.maxDistance === o.v && s.chipTxtOn]}>{o.l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>}

            {/* Height */}
            <Text style={s.filterLabel}>Height (cm)</Text>
            <View style={s.rangeRow}>
              <TextInput style={s.rangeInput} value={filters.minHeight} onChangeText={t => setF({ minHeight: t.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={3} placeholder="Min" placeholderTextColor="#666" />
              <Text style={s.rangeDash}>to</Text>
              <TextInput style={s.rangeInput} value={filters.maxHeight} onChangeText={t => setF({ maxHeight: t.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={3} placeholder="Max" placeholderTextColor="#666" />
            </View>

            {/* Multi-select filter sections */}
            {([
              { label: 'Body Type', key: 'bodyTypes', opts: BODY_TYPES },
              { label: 'Religious Views', key: 'religiousViews', opts: RELIGIOUS_OPTIONS },
              { label: 'Lifestyle', key: 'lifestyles', opts: LIFESTYLE_OPTIONS },
              { label: 'Relationship Goal', key: 'relationshipGoals', opts: RELATIONSHIP_OPTIONS },
              { label: 'Personality', key: 'personalityTypes', opts: PERSONALITY_OPTIONS },
            ] as const).map(({ label, key, opts }) => (
              <View key={key}>
                <Text style={s.filterLabel}>{label}</Text>
                <View style={s.chipRow}>
                  {opts.map(o => {
                    const active = (filters[key] as string[]).includes(o);
                    return (
                      <TouchableOpacity key={o} style={[s.chip, active && s.chipOn]} onPress={() => setF({ [key]: toggleArr(filters[key] as string[], o) } as any)}>
                        <Text style={[s.chipTxt, active && s.chipTxtOn]}>{o}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}

            {/* Last active */}
            <Text style={s.filterLabel}>🕒 Last Active</Text>
            <View style={s.chipRow}>
              {ACTIVE_WITHIN_OPTIONS.map(o => (
                <TouchableOpacity key={o.value} style={[s.chip, filters.activeWithin === o.value && s.chipOn]} onPress={() => setF({ activeWithin: o.value })}>
                  <Text style={[s.chipTxt, filters.activeWithin === o.value && s.chipTxtOn]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Profile quality */}
            <Text style={s.filterLabel}>✨ Profile Quality</Text>
            <TouchableOpacity style={s.toggleRow} onPress={() => setF({ hasBio: !filters.hasBio })}>
              <Text style={s.toggleTxt}>📝 Must have bio</Text>
              <View style={[s.checkbox, filters.hasBio && s.checkboxOn]}>{filters.hasBio && <Text style={s.checkmark}>✓</Text>}</View>
            </TouchableOpacity>
            <View style={s.photoFilterRow}>
              <Text style={s.toggleTxt}>Min photos:</Text>
              <View style={s.chipRow}>
                {[1, 2, 3, 4].map(n => (
                  <TouchableOpacity key={n} style={[s.chip, filters.minPhotos === n && s.chipOn]} onPress={() => setF({ minPhotos: n })}>
                    <Text style={[s.chipTxt, filters.minPhotos === n && s.chipTxtOn]}>{n}+</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Verified only */}
            <TouchableOpacity style={s.toggleRow} onPress={() => setF({ verifiedOnly: !filters.verifiedOnly })}>
              <Text style={s.toggleTxt}>✓ Verified users only</Text>
              <View style={[s.checkbox, filters.verifiedOnly && s.checkboxOn]}>{filters.verifiedOnly && <Text style={s.checkmark}>✓</Text>}</View>
            </TouchableOpacity>

            <View style={{ height: 100 }} />
          </ScrollView>

          <View style={s.modalFooter}>
            <TouchableOpacity style={s.applyBtn} onPress={() => setShowFilters(false)}>
              <Text style={s.applyBtnText}>Show {filtered.length} Matches</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Profile Card */}
      <View style={s.card}>
        {/* Photos */}
        {photoCount > 0 ? (
          <View style={s.photoWrap}>
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onScroll={e => setPhotoIdx(Math.round(e.nativeEvent.contentOffset.x / PHOTO_WIDTH))}
              scrollEventThrottle={16}>
              {u.photos!.map((uri, i) => <Image key={i} source={{ uri }} style={[s.photo, { width: PHOTO_WIDTH }]} />)}
            </ScrollView>
            {photoCount > 1 && <>
              <View style={s.photoBadge}><Text style={s.photoBadgeTxt}>{photoIdx + 1} / {photoCount}</Text></View>
              <View style={s.dots}>{u.photos!.map((_, i) => <View key={i} style={[s.dot, photoIdx === i && s.dotOn]} />)}</View>
            </>}
            {u.selfieVerified && <View style={s.photoVerified}><VerificationBadge selfieVerified size="small" ratings={u.ratings} /></View>}
          </View>
        ) : (
          <View style={s.noPhoto}><Text style={s.noPhotoTxt}>No Photo</Text></View>
        )}

        {/* Compatibility */}
        <View style={[s.compatBadge, { backgroundColor: scoreColor }]}>
          <Text style={s.compatTxt}>{entry.score}% Match</Text>
        </View>

        {/* Mutual interests */}
        {entry.reasons.length > 0 && (
          <View style={s.mutualRow}>
            {entry.reasons.slice(0, 2).map((r, i) => (
              <View key={i} style={s.mutualChip}><Text style={s.mutualTxt}>✓ {r}</Text></View>
            ))}
          </View>
        )}

        {/* Name & age */}
        <View style={s.nameSection}>
          <View style={s.nameRow}>
            <Text style={s.name}>{u.name}, {u.age}</Text>
            {u.selfieVerified && <Text style={s.verified}>✓</Text>}
          </View>
          {ageBadge.level !== 'unverified' && (
            <View style={[s.ageBadge, { backgroundColor: ageBadge.color }]}>
              <Text style={s.ageBadgeIcon}>{ageBadge.icon}</Text>
              <Text style={s.ageBadgeTxt}>{ageBadge.label}</Text>
            </View>
          )}
        </View>

        {/* Online */}
        {isUserOnline(u.lastSeen)
          ? <View style={s.online}><View style={s.onlineDot} /><Text style={s.onlineTxt}>Online now</Text></View>
          : u.lastSeen ? <Text style={s.lastSeen}>Last seen {formatLastSeen(u.lastSeen)}</Text> : null}

        {/* Distance */}
        {dist !== null && <View style={s.distBadge}><Text style={s.distTxt}>📍 {formatDistance(dist)}</Text></View>}

        {/* Icebreaker */}
        {u.icebreaker && (
          <View style={s.icebreaker}>
            <Text style={s.icebreakerLabel}>💬 {u.icebreakerPrompt ?? 'Icebreaker'}</Text>
            <Text style={s.icebreakerTxt}>{u.icebreaker}</Text>
          </View>
        )}

        {/* Bio */}
        {u.bio && <View style={s.bio}><Text style={s.sectionTitle}>About Me</Text><Text style={s.bioTxt}>"{u.bio}"</Text></View>}

        {/* Info */}
        <View style={s.infoSection}>
          <View style={s.infoRow}><Text style={s.label}>Height</Text><HeightBadge height={u.height} /></View>
          <View style={s.infoRow}><Text style={s.label}>Body Type</Text><Text style={s.value}>{u.bodyType}</Text></View>
          <View style={s.infoRow}><Text style={s.label}>Looking For</Text><Text style={s.value}>{u.lookingFor}</Text></View>
          {u.location?.city && <View style={s.infoRow}><Text style={s.label}>Location</Text><Text style={s.value}>{u.location.city}</Text></View>}
        </View>

        {/* Trust */}
        {(u.selfieVerified || (u.ratings?.totalRatings ?? 0) > 0) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Trust & Verification</Text>
            <TrustScoreDisplay ratings={u.ratings} selfieVerified={u.selfieVerified} ageVerified={u.ageVerification?.verified} heightVerified={typeof u.height === 'object' && u.height.verificationMethod === 'manual-measured'} size="small" />
          </View>
        )}

        {/* Values */}
        {(u.religiousViews || u.lifestyle || u.relationshipGoal) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Beliefs & Values</Text>
            {u.religiousViews && <View style={s.infoRow}><Text style={s.label}>Views</Text><Text style={[s.tag, currentUser?.religiousViews === u.religiousViews && s.tagMatch]}>{u.religiousViews}{currentUser?.religiousViews === u.religiousViews ? ' ✓' : ''}</Text></View>}
            {u.lifestyle && <View style={s.infoRow}><Text style={s.label}>Lifestyle</Text><Text style={[s.tag, currentUser?.lifestyle === u.lifestyle && s.tagMatch]}>{u.lifestyle}{currentUser?.lifestyle === u.lifestyle ? ' ✓' : ''}</Text></View>}
            {u.relationshipGoal && <View style={s.infoRow}><Text style={s.label}>Goal</Text><Text style={[s.tag, currentUser?.relationshipGoal === u.relationshipGoal && s.tagMatch]}>{u.relationshipGoal}{currentUser?.relationshipGoal === u.relationshipGoal ? ' ✓' : ''}</Text></View>}
          </View>
        )}

        {/* Personality */}
        {u.personalityType && (
          <View style={[s.section, { alignItems: 'center' }]}>
            <Text style={s.sectionTitle}>Personality</Text>
            <View style={s.personalityBadge}><Text style={s.personalityTxt}>{u.personalityType}</Text></View>
            {currentUser?.personalityType === u.personalityType && <Text style={s.personalityMatch}>Same personality as you! 🎉</Text>}
          </View>
        )}

        {/* Match reasons */}
        {entry.reasons.length > 0 && (
          <View style={s.reasons}>
            <Text style={s.reasonsTitle}>💫 Why you matched:</Text>
            {entry.reasons.map((r, i) => <Text key={i} style={s.reasonTxt}>• {r}</Text>)}
          </View>
        )}
      </View>

      {/* Safety */}
      <View style={s.safetyRow}>
        <TouchableOpacity style={s.reportBtn} onPress={handleReport}><Text style={s.reportBtnTxt}>🚩 Report</Text></TouchableOpacity>
        <TouchableOpacity style={s.blockBtn} onPress={handleBlock}><Text style={s.blockBtnTxt}>🚫 Block</Text></TouchableOpacity>
      </View>

      {/* Actions */}
      <View style={s.actions}>
        <TouchableOpacity style={s.skipBtn} onPress={handleSkip}><Text style={s.skipBtnTxt}>✗ Skip</Text></TouchableOpacity>
        <TouchableOpacity style={s.likeBtn} onPress={handleLike}><Text style={s.likeBtnTxt}>♥ Like</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#1a1a2e' },
  scrollContent: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#1a1a2e', padding: 20, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', fontSize: 16, marginTop: 20, textAlign: 'center' },
  bigEmoji: { fontSize: 60, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#eee', marginBottom: 15, textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#aaa', textAlign: 'center', marginBottom: 20, lineHeight: 24 },
  btn: { backgroundColor: '#0f3460', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 25 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  resetBtn: { backgroundColor: '#53a8b6', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 20, marginBottom: 15 },
  resetBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  undoBtn: { backgroundColor: '#e67e22', paddingVertical: 15, paddingHorizontal: 30, borderRadius: 25, marginBottom: 15 },
  undoBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, marginTop: 10 },
  back: { color: '#53a8b6', fontSize: 16 },
  headerCount: { color: '#aaa', fontSize: 14 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  undoSmall: { backgroundColor: '#e67e22', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15 },
  filterBtn: { backgroundColor: '#0f3460', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 15 },
  filterBtnText: { color: '#53a8b6', fontSize: 14, fontWeight: '600' },
  modal: { flex: 1, backgroundColor: '#1a1a2e' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  modalCancel: { color: '#d9534f', fontSize: 16 },
  modalTitle: { color: '#eee', fontSize: 18, fontWeight: 'bold' },
  modalReset: { color: '#53a8b6', fontSize: 16 },
  modalBody: { flex: 1, padding: 20 },
  modalFooter: { padding: 20, borderTopWidth: 1, borderTopColor: '#0f3460' },
  applyBtn: { backgroundColor: '#5cb85c', paddingVertical: 16, borderRadius: 25, alignItems: 'center' },
  applyBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  filterLabel: { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 12 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 },
  rangeInput: { backgroundColor: '#16213e', color: '#fff', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, fontSize: 18, fontWeight: '600', width: 90, textAlign: 'center' },
  rangeDash: { color: '#888', fontSize: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  chip: { backgroundColor: '#16213e', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 2, borderColor: '#16213e' },
  chipOn: { backgroundColor: '#0f3460', borderColor: '#53a8b6' },
  chipTxt: { color: '#888', fontSize: 14 },
  chipTxtOn: { color: '#53a8b6', fontWeight: '600' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', padding: 15, borderRadius: 10, marginTop: 10 },
  toggleTxt: { color: '#eee', fontSize: 15 },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: '#53a8b6', justifyContent: 'center', alignItems: 'center' },
  checkboxOn: { backgroundColor: '#53a8b6' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  photoFilterRow: { marginTop: 12 },
  card: { backgroundColor: '#16213e', borderRadius: 20, padding: 20, marginBottom: 15, borderWidth: 2, borderColor: '#0f3460' },
  photoWrap: { position: 'relative', marginBottom: 15, borderRadius: 15, overflow: 'hidden' },
  photo: { height: 400, borderRadius: 15, resizeMode: 'cover' },
  photoBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  photoBadgeTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  dots: { position: 'absolute', bottom: 15, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#fff', width: 10, height: 10, borderRadius: 5 },
  photoVerified: { position: 'absolute', top: 10, left: 10 },
  noPhoto: { width: '100%', height: 400, borderRadius: 15, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  noPhotoTxt: { color: '#666', fontSize: 18 },
  compatBadge: { paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20, alignSelf: 'center', marginBottom: 15 },
  compatTxt: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  mutualRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 15 },
  mutualChip: { backgroundColor: '#1a5c3a', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: '#5cb85c' },
  mutualTxt: { color: '#5cb85c', fontSize: 12, fontWeight: '600' },
  nameSection: { alignItems: 'center', marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  name: { fontSize: 30, fontWeight: 'bold', color: '#eee', textAlign: 'center' },
  verified: { fontSize: 24, color: '#3498db' },
  ageBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  ageBadgeIcon: { fontSize: 14, marginRight: 4, color: '#fff' },
  ageBadgeTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  online: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(92,184,92,0.2)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, alignSelf: 'center', marginBottom: 5 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#5cb85c', marginRight: 6 },
  onlineTxt: { color: '#5cb85c', fontSize: 12, fontWeight: '600' },
  lastSeen: { color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 5 },
  distBadge: { backgroundColor: '#0f3460', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 15, alignSelf: 'center', marginBottom: 15 },
  distTxt: { color: '#53a8b6', fontSize: 13 },
  icebreaker: { backgroundColor: '#0f3460', borderRadius: 15, padding: 15, marginBottom: 15 },
  icebreakerLabel: { color: '#e67e22', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  icebreakerTxt: { color: '#eee', fontSize: 15, fontStyle: 'italic', lineHeight: 22 },
  bio: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 5, marginBottom: 10 },
  bioTxt: { color: '#ddd', fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  infoSection: { marginBottom: 5 },
  section: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 15, marginTop: 10, marginBottom: 10 },
  sectionTitle: { color: '#53a8b6', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label: { color: '#aaa', fontSize: 15 },
  value: { color: '#eee', fontSize: 15, fontWeight: '600' },
  tag: { backgroundColor: '#0f3460', color: '#aaa', paddingVertical: 5, paddingHorizontal: 14, borderRadius: 12, fontSize: 14, overflow: 'hidden' },
  tagMatch: { backgroundColor: '#1a5c3a', color: '#5cb85c', fontWeight: '600' },
  personalityBadge: { backgroundColor: '#e67e22', paddingVertical: 8, paddingHorizontal: 24, borderRadius: 20, marginBottom: 8 },
  personalityTxt: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  personalityMatch: { color: '#5cb85c', fontSize: 12, marginTop: 4 },
  reasons: { marginTop: 10, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#0f3460' },
  reasonsTitle: { color: '#53a8b6', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  reasonTxt: { color: '#aaa', fontSize: 14, marginBottom: 5, lineHeight: 20 },
  safetyRow: { flexDirection: 'row', justifyContent: 'center', gap: 30, marginBottom: 15 },
  reportBtn: { paddingVertical: 8, paddingHorizontal: 15 },
  reportBtnTxt: { color: '#e67e22', fontSize: 14 },
  blockBtn: { paddingVertical: 8, paddingHorizontal: 15 },
  blockBtnTxt: { color: '#d9534f', fontSize: 14 },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  skipBtn: { backgroundColor: '#d9534f', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, flex: 1, marginRight: 10 },
  skipBtnTxt: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  likeBtn: { backgroundColor: '#5cb85c', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25, flex: 1, marginLeft: 10 },
  likeBtnTxt: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
});