import { LegendList, LegendListRenderItemProps } from '@legendapp/list';
import { observable } from '@legendapp/state';
import { observer } from '@legendapp/state/react';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import TurboImage from '../src/components/TurboImage';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';

const LOCAL = {
  white:       '#ffffff',
  gold:        '#f1c40f',
  success:     '#5cb85c',
  deepSurface: '#0f3460',
  cardSurface: '#16213e',
  textMuted:   '#666666',
  textSub:     '#aaaaaa',
} as const;

interface LeaderboardEntry {
  uid:           string;
  name:          string;
  photo:         string;
  referralCount: number;
  isChampion:    boolean;
}

interface FirestoreUserData {
  referralCode?:  string;
  referralCount?: number;
  name?:          string;
  photos?:        string[];
}

const screen$ = observable({
  loading:       true,
  referralCode:  '',
  referralCount: 0,
  leaderboard:   [] as LeaderboardEntry[],
  userRank:      null as number | null,
});

// ─── Leaderboard row ─────────────────────────────────────────────────────────

interface LeaderboardRowProps {
  item:          LeaderboardEntry;
  rank:          number;
  isCurrentUser: boolean;
  getRankEmoji:  (rank: number) => string;
}

const LeaderboardRow = React.memo<LeaderboardRowProps>(
  ({ item, rank, isCurrentUser, getRankEmoji }) => {
    const itemStyle = useMemo(
      () => [s.leaderboardItem, isCurrentUser && s.leaderboardItemCurrent],
      [isCurrentUser],
    );
    const nameStyle = useMemo(
      () => [s.leaderboardName, isCurrentUser && s.leaderboardNameCurrent],
      [isCurrentUser],
    );
    return (
      <View
        style={itemStyle}
        accessibilityLabel={`Rank ${getRankEmoji(rank)}: ${item.name}${isCurrentUser ? ' (You)' : ''}, ${item.referralCount} referral${item.referralCount !== 1 ? 's' : ''}${item.isChampion ? ', Community Champion' : ''}`}
      >
        <Text style={s.leaderboardRank} accessibilityElementsHidden>
          {getRankEmoji(rank)}
        </Text>
        {item.photo ? (
          <TurboImage
            source={{ uri: item.photo }}
            style={s.leaderboardPhoto}
            cachePolicy="dataCache"
            accessibilityLabel={`${item.name}'s profile photo`}
          />
        ) : (
          <View
            style={s.leaderboardPhotoPlaceholder}
            accessibilityLabel={`${item.name} has no photo`}
          >
            <Text style={s.leaderboardPhotoText} accessibilityElementsHidden>?</Text>
          </View>
        )}
        <View style={s.leaderboardInfo}>
          <View style={s.leaderboardNameRow}>
            <Text style={nameStyle}>
              {item.name}{isCurrentUser ? ' (You)' : ''}
            </Text>
            {item.isChampion && (
              <Text style={s.leaderboardChampion} accessibilityElementsHidden>🌟</Text>
            )}
          </View>
          <Text style={s.leaderboardCount}>
            {item.referralCount} referral{item.referralCount !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    );
  },
);
LeaderboardRow.displayName = 'LeaderboardRow';

// ─── How It Works steps ───────────────────────────────────────────────────────
// Stable data defined at module level — never changes, no index-key issue
// because these are fixed items with stable identities.

const HOW_IT_WORKS_STEPS = [
  { key: 'step1', n: 1, text: 'Share your code with friends' },
  { key: 'step2', n: 2, text: 'They sign up using your code' },
  { key: 'step3', n: 3, text: 'Get 10 referrals = Community Champion badge!' },
] as const;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default observer(function ReferralScreen() {
  const router = useRouter();
  const user   = auth.currentUser;

  const isMounted = useRef(true);
  useEffect(() => { return () => { isMounted.current = false; }; }, []);

  const generateReferralCode = useCallback(
    (uid: string): string => `MA${uid.substring(0, 6).toUpperCase()}`,
    [],
  );

  const loadReferralData = useCallback(async () => {
    if (!user) { router.replace('/login'); return; }
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      let userReferralCount = 0;
      if (userDoc.exists()) {
        const data = userDoc.data() as FirestoreUserData;
        screen$.referralCode.set(data.referralCode ?? generateReferralCode(user.uid));
        userReferralCount = data.referralCount ?? 0;
        screen$.referralCount.set(userReferralCount);
      }

      const leaderboardSnap = await getDocs(query(
        collection(db, 'users'),
        orderBy('referralCount', 'desc'),
        limit(20),
      ));

      const leaderboardData: LeaderboardEntry[] = [];
      let rank      = 1;
      let foundUser = false;

      leaderboardSnap.forEach((docSnap) => {
        const data = docSnap.data() as FirestoreUserData;
        if ((data.referralCount ?? 0) > 0) {
          leaderboardData.push({
            uid:           docSnap.id,
            name:          data.name        ?? 'Anonymous',
            photo:         data.photos?.[0] ?? '',
            referralCount: data.referralCount ?? 0,
            isChampion:    (data.referralCount ?? 0) >= 10,
          });
          if (docSnap.id === user.uid) {
            screen$.userRank.set(rank);
            foundUser = true;
          }
          rank++;
        }
      });
      screen$.leaderboard.set(leaderboardData);

      if (!foundUser && userReferralCount > 0) {
        const allUsersSnap = await getDocs(query(collection(db, 'users')));
        let rankCalc = 1;
        allUsersSnap.forEach((d) => {
          const data = d.data() as FirestoreUserData;
          if ((data.referralCount ?? 0) > userReferralCount) rankCalc++;
        });
        screen$.userRank.set(rankCalc);
      }
    } catch (error) {
      logger.error('[Referral] Error loading referral data:', error);
    } finally {
      screen$.loading.set(false);
    }
  }, [user, router, generateReferralCode]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      void loadReferralData();
    });
    return () => task.cancel();
  }, [loadReferralData]);

  const referralCode  = screen$.referralCode.get();
  const referralCount = screen$.referralCount.get();
  const leaderboard   = screen$.leaderboard.get();
  const userRank      = screen$.userRank.get();
  const loading       = screen$.loading.get();

  const handleCopyCode = useCallback(async () => {
    await Clipboard.setStringAsync(referralCode);
    Alert.alert('Copied!', 'Referral code copied to clipboard');
  }, [referralCode]);

  const handleShare = useCallback(async () => {
    const message = `Join me on MyArchetype - the 100% FREE dating app for genuine connections! 💕\n\nUse my code: ${referralCode}\n\n🚀 No premium, no restrictions, just real people finding real love.\n\nDownload: https://myarchetype.app`;
    try {
      await Share.share({ message, title: 'Join MyArchetype' });
    } catch (error) {
      logger.warn('[Referral] Share failed, falling back to clipboard:', error);
      await Clipboard.setStringAsync(`Join MyArchetype with code: ${referralCode}`);
      Alert.alert('Copied!', 'Share message copied to clipboard');
    }
  }, [referralCode]);

  const getRankEmoji = useCallback((rank: number): string => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  }, []);

  const renderLeaderboardItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<LeaderboardEntry>) => (
      <LeaderboardRow
        item={item}
        rank={index + 1}
        isCurrentUser={item.uid === user?.uid}
        getRankEmoji={getRankEmoji}
      />
    ),
    [user?.uid, getRankEmoji],
  );

  const leaderboardKeyExtractor = useCallback(
    (item: LeaderboardEntry) => item.uid,
    [],
  );

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={s.loadingText}>Loading...</Text>
      </View>
    );
  }

  const isChampion         = referralCount >= 10;
  const progressToChampion = Math.min((referralCount / 10) * 100, 100);

  const progressBarStyle = [s.progressBar, { width: `${progressToChampion}%` as `${number}%` }];

  const ListHeader = (
    <View style={s.headerCard}>
      <Text style={s.headerTitle} accessibilityRole="header">🌟 Invite Friends</Text>
      <Text style={s.headerSubtitle}>
        Share MyArchetype and become a Community Champion!
      </Text>

      <View style={s.codeBox} accessibilityLabel={`Your referral code: ${referralCode}`}>
        <Text style={s.codeLabel}>Your Referral Code</Text>
        <Text style={s.code} accessibilityElementsHidden>{referralCode}</Text>
      </View>

      <View style={s.shareButtons}>
        <TouchableOpacity
          style={s.copyButton}
          onPress={handleCopyCode}
          accessibilityLabel="Copy referral code to clipboard"
          accessibilityRole="button"
        >
          <Text style={s.copyButtonText}>📋 Copy</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.shareButton}
          onPress={handleShare}
          accessibilityLabel="Share referral code"
          accessibilityRole="button"
        >
          <Text style={s.shareButtonText}>📤 Share</Text>
        </TouchableOpacity>
      </View>

      <View style={s.statsRow}>
        <View style={s.statItem} accessibilityLabel={`${referralCount} referrals`}>
          <Text style={s.statValue}>{referralCount}</Text>
          <Text style={s.statLabel}>Referrals</Text>
        </View>
        <View
          style={s.statItem}
          accessibilityLabel={userRank ? `Your rank: #${userRank}` : 'Not ranked yet'}
        >
          <Text style={s.statValue}>{userRank ? `#${userRank}` : '-'}</Text>
          <Text style={s.statLabel}>Your Rank</Text>
        </View>
      </View>

      {!isChampion && (
        <View
          style={s.progressContainer}
          accessibilityLabel={`${10 - referralCount} more referrals needed to become Community Champion`}
        >
          <Text style={s.progressLabel}>
            {10 - referralCount} more to become Community Champion 🌟
          </Text>
          <View style={s.progressBarBg}>
            <View
              style={progressBarStyle}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: progressToChampion }}
            />
          </View>
        </View>
      )}

      {isChampion && (
        <View style={s.championContainer} accessibilityLabel="Community Champion badge earned">
          <Text style={s.championBadge}>🌟 Community Champion 🌟</Text>
          <Text style={s.championText}>
            Thank you for spreading the love! Your badge is visible on your profile.
          </Text>
        </View>
      )}

      <Text style={s.leaderboardTitle} accessibilityRole="header">🏆 Top Referrers</Text>
    </View>
  );

  const ListFooter = (
    <View style={s.howItWorks}>
      <Text style={s.howItWorksTitle} accessibilityRole="header">How it works</Text>
      {HOW_IT_WORKS_STEPS.map((step) => (
        <View
          key={step.key}
          style={s.howItWorksItem}
          accessibilityLabel={`Step ${step.n}: ${step.text}`}
        >
          <Text style={s.howItWorksNumber} accessibilityElementsHidden>{step.n}</Text>
          <Text style={s.howItWorksText}>{step.text}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={s.container}>
      {leaderboard.length > 0 ? (
        <LegendList
          data={leaderboard}
          keyExtractor={leaderboardKeyExtractor}
          renderItem={renderLeaderboardItem}
          estimatedItemSize={68}
          recycleItems={true}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.leaderboardList}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
        />
      ) : (
        <>
          {ListHeader}
          <View style={s.emptyLeaderboard}>
            <Text style={s.emptyLeaderboardText}>No referrals yet. Be the first! 🚀</Text>
          </View>
          {ListFooter}
        </>
      )}
    </View>
  );
});

const s = StyleSheet.create((theme) => ({
  container:                   { flex: 1, backgroundColor: theme.colors.background },
  loadingContainer:            { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText:                 { color: theme.colors.textSecondary, marginTop: 15, fontSize: 16 },

  headerCard:                  { backgroundColor: LOCAL.cardSurface, margin: 20, borderRadius: 20, padding: 25, borderWidth: 2, borderColor: LOCAL.gold },
  headerTitle:                 { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center', marginBottom: 8 },
  headerSubtitle:              { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 20 },

  codeBox:                     { backgroundColor: LOCAL.deepSurface, borderRadius: 15, padding: 20, marginBottom: 15, alignItems: 'center' },
  codeLabel:                   { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 8 },
  code:                        { color: LOCAL.gold, fontSize: 32, fontWeight: 'bold', letterSpacing: 4 },

  shareButtons:                { flexDirection: 'row', gap: 10, marginBottom: 20 },
  copyButton:                  { flex: 1, backgroundColor: LOCAL.deepSurface, paddingVertical: 14, borderRadius: 25, alignItems: 'center' },
  copyButtonText:              { color: theme.colors.primary, fontSize: 16, fontWeight: '600' },
  shareButton:                 { flex: 1, backgroundColor: LOCAL.gold, paddingVertical: 14, borderRadius: 25, alignItems: 'center' },
  shareButtonText:             { color: theme.colors.background, fontSize: 16, fontWeight: '600' },

  statsRow:                    { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 15 },
  statItem:                    { alignItems: 'center' },
  statValue:                   { color: LOCAL.success, fontSize: 28, fontWeight: 'bold' },
  statLabel:                   { color: theme.colors.textSecondary, fontSize: 12 },

  progressContainer:           { marginTop: 10 },
  progressLabel:               { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'center', marginBottom: 8 },
  progressBarBg:               { height: 8, backgroundColor: LOCAL.deepSurface, borderRadius: 4, overflow: 'hidden' },
  progressBar:                 { height: '100%', backgroundColor: LOCAL.gold, borderRadius: 4 },

  championContainer:           { marginTop: 15, alignItems: 'center' },
  championBadge:               { fontSize: 20, fontWeight: 'bold', color: LOCAL.gold, marginBottom: 8 },
  championText:                { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'center' },

  leaderboardTitle:            { fontSize: 18, fontWeight: 'bold', color: theme.colors.text, marginTop: 20, marginBottom: 5 },
  leaderboardList:             { paddingBottom: 20 },

  leaderboardItem:             { flexDirection: 'row', alignItems: 'center', backgroundColor: LOCAL.cardSurface, padding: 12, marginHorizontal: 20, borderRadius: 12, marginBottom: 8, gap: 12 },
  leaderboardItemCurrent:      { borderWidth: 2, borderColor: theme.colors.primary },
  leaderboardRank:             { fontSize: 20, width: 40, textAlign: 'center' },
  leaderboardPhoto:            { width: 40, height: 40, borderRadius: 20 },
  leaderboardPhotoPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: LOCAL.deepSurface, justifyContent: 'center', alignItems: 'center' },
  leaderboardPhotoText:        { color: LOCAL.textMuted, fontSize: 18 },
  leaderboardInfo:             { flex: 1 },
  leaderboardNameRow:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leaderboardName:             { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  leaderboardNameCurrent:      { color: theme.colors.primary },
  leaderboardChampion:         { fontSize: 14 },
  leaderboardCount:            { color: theme.colors.textSecondary, fontSize: 12 },

  emptyLeaderboard:            { padding: 30, alignItems: 'center' },
  emptyLeaderboardText:        { color: LOCAL.textMuted, fontSize: 14 },

  howItWorks:                  { padding: 20, paddingTop: 0 },
  howItWorksTitle:             { fontSize: 16, fontWeight: '600', color: theme.colors.primary, marginBottom: 12 },
  howItWorksItem:              { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 12 },
  howItWorksNumber:            { width: 24, height: 24, borderRadius: 12, backgroundColor: LOCAL.deepSurface, color: theme.colors.primary, fontSize: 14, fontWeight: 'bold', textAlign: 'center', lineHeight: 24 },
  howItWorksText:              { color: LOCAL.textSub, fontSize: 13 },
}));