import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  InteractionManager,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import TurboImage from 'react-native-turbo-image';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LOCAL = {
  white:        '#ffffff',
  gold:         '#f1c40f',
  silver:       '#bdc3c7',
  bronze:       '#e67e22',
  deepSurface:  '#0f3460',
  textMuted:    '#666666',
  textSub:      '#888888',
  championBg:   '#1a1a2e',
} as const;

const ENTRY_FIXED_HEIGHT    = 119;
const CHAMPION_TAG_HEIGHT   = 26;
const ESTIMATED_ITEM_HEIGHT = Math.ceil(ENTRY_FIXED_HEIGHT + CHAMPION_TAG_HEIGHT * 0.3);

interface LeaderboardEntry {
  oduid:         string;
  name:          string;
  photo:         string;
  referralCount: number;
  isChampion:    boolean;
  rank:          number;
}

function getRankDisplay(rank: number): { emoji: string; color: string } {
  if (rank === 1) return { emoji: '🥇', color: LOCAL.gold   };
  if (rank === 2) return { emoji: '🥈', color: LOCAL.silver };
  if (rank === 3) return { emoji: '🥉', color: LOCAL.bronze };
  return { emoji: `#${rank}`, color: LOCAL.textSub };
}

interface EntryCardProps {
  item:          LeaderboardEntry;
  isCurrentUser: boolean;
}

const EntryCard = React.memo(function EntryCard({ item, isCurrentUser }: EntryCardProps) {
  const rankInfo = getRankDisplay(item.rank);

  const cardStyle    = useMemo(
    () => [styles.entryCard, isCurrentUser && styles.entryCardCurrent],
    [isCurrentUser],
  );
  const rankNumStyle = useMemo(
    () => [styles.rankNumber, { color: rankInfo.color }],
    [rankInfo.color],
  );
  const nameStyle = useMemo(
    () => [styles.name, isCurrentUser && styles.nameCurrent],
    [isCurrentUser],
  );

  return (
    <View
      style={cardStyle}
      accessibilityLabel={`Rank ${item.rank}: ${item.name}, ${item.referralCount} referrals${isCurrentUser ? ', this is you' : ''}${item.isChampion ? ', community champion' : ''}`}
    >
      <View style={styles.rankContainer}>
        {item.rank <= 3
          ? <Text style={styles.rankEmoji}>{rankInfo.emoji}</Text>
          : <Text style={rankNumStyle}>#{item.rank}</Text>
        }
      </View>

      {item.photo ? (
        <TurboImage
          source={{ uri: item.photo }}
          style={styles.photo}
          cachePolicy="dataCache"
          accessibilityLabel={`Photo of ${item.name}`}
        />
      ) : (
        <View style={styles.photoPlaceholder} accessibilityLabel={`No photo for ${item.name}`}>
          <Text style={styles.photoPlaceholderText} accessibilityElementsHidden>?</Text>
        </View>
      )}

      <View style={styles.infoContainer}>
        <View style={styles.nameRow}>
          <Text style={nameStyle}>
            {item.name}{isCurrentUser ? ' (You)' : ''}
          </Text>
          {item.isChampion && (
            <Text style={styles.championBadge} accessibilityElementsHidden>🌟</Text>
          )}
        </View>
        <Text style={styles.referralCount}>
          {item.referralCount} referral{item.referralCount !== 1 ? 's' : ''}
        </Text>
      </View>

      {item.isChampion && (
        <View style={styles.championTag}>
          <Text style={styles.championTagText}>Champion</Text>
        </View>
      )}
    </View>
  );
});

export default function ReferralLeaderboardScreen() {
  const user = auth.currentUser;

  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userEntry,   setUserEntry]   = useState<LeaderboardEntry | null>(null);

  const isMounted = useRef(true);

  const loadLeaderboard = useCallback(async () => {
    try {
      const snap = await getDocs(query(
        collection(db, 'users'),
        orderBy('referralCount', 'desc'),
        limit(100),
      ));
      const entries: LeaderboardEntry[] = [];
      let rank = 1;
      let currentUserEntry: LeaderboardEntry | null = null;

      snap.forEach((docSnap) => {
        const data          = docSnap.data();
        const referralCount = (data.referralCount as number) || 0;
        if (referralCount > 0) {
          const entry: LeaderboardEntry = {
            oduid:         docSnap.id,
            name:          data.name || 'Anonymous',
            photo:         data.photos?.[0] || '',
            referralCount,
            isChampion:    referralCount >= 10,
            rank,
          };
          entries.push(entry);
          if (docSnap.id === user?.uid) currentUserEntry = entry;
          rank++;
        }
      });

      if (!isMounted.current) return;
      setLeaderboard(entries);
      setUserEntry(currentUserEntry);
    } catch (error) {
      logger.error('[Leaderboard] loadLeaderboard error:', error);
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user]);

  useEffect(() => {
    isMounted.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void loadLeaderboard();
    }, []);
    return () => {
      isMounted.current = false;
      task.cancel();
    };
  }, [loadLeaderboard]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadLeaderboard();
  }, [loadLeaderboard]);

  const currentUserId = user?.uid;

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<LeaderboardEntry>) => (
      <EntryCard item={item} isCurrentUser={item.oduid === currentUserId} />
    ),
    [currentUserId],
  );

  const keyExtractor = useCallback((item: LeaderboardEntry) => item.oduid, []);

  const refreshControl = useMemo(() => (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor="#53a8b6"
      colors={['#53a8b6']}
    />
  ), [refreshing, handleRefresh]);

  const listHeader = useMemo(() => (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">🏆 Referral Leaderboard</Text>
      <Text style={styles.subtitle}>Top community champions who spread the love</Text>

      {leaderboard.length >= 3 && (
        <View style={styles.podium} accessibilityElementsHidden>
          {([1, 0, 2] as const).map((pos) => {
            const entry   = leaderboard[pos];
            if (!entry) return null;
            const sizes   = [styles.podiumPhoto2, styles.podiumPhoto1, styles.podiumPhoto3] as const;
            const emojis  = ['🥈', '🥇', '🥉'] as const;
            const sizeIdx = pos === 0 ? 1 : pos === 1 ? 0 : 2;
            return (
              <View key={pos} style={styles.podiumItem}>
                {entry.photo ? (
                  <TurboImage
                    source={{ uri: entry.photo }}
                    style={sizes[sizeIdx]}
                    cachePolicy="dataCache"
                    accessibilityLabel={`${entry.name} in position ${entry.rank}`}
                  />
                ) : (
                  <View style={[styles.podiumPhotoPlaceholder, sizes[sizeIdx]]}>
                    <Text style={styles.podiumPhotoText} accessibilityElementsHidden>?</Text>
                  </View>
                )}
                <Text style={styles.podiumEmoji} accessibilityElementsHidden>
                  {emojis[sizeIdx]}
                </Text>
                <Text style={styles.podiumName} numberOfLines={1}>{entry.name}</Text>
                <Text style={styles.podiumCount}>{entry.referralCount}</Text>
              </View>
            );
          })}
        </View>
      )}

      {userEntry && (
        <View
          style={styles.yourRankCard}
          accessibilityLabel={`Your rank is ${userEntry.rank} with ${userEntry.referralCount} referrals`}
        >
          <Text style={styles.yourRankLabel}>Your Rank</Text>
          <Text style={styles.yourRankNumber}>#{userEntry.rank}</Text>
          <Text style={styles.yourRankReferrals}>{userEntry.referralCount} referrals</Text>
        </View>
      )}

      <Text style={styles.listTitle} accessibilityRole="header">All Rankings</Text>
    </View>
  ), [leaderboard, userEntry]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading leaderboard...</Text>
      </View>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon} accessibilityElementsHidden>🏆</Text>
        <Text style={styles.emptyTitle} accessibilityRole="header">No referrals yet</Text>
        <Text style={styles.emptyText}>
          Be the first to invite friends and top the leaderboard!
        </Text>
      </View>
    );
  }

  return (
    <LegendList
      data={leaderboard}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={listHeader}
      estimatedItemSize={ESTIMATED_ITEM_HEIGHT}
      recycleItems={true}
      refreshControl={refreshControl}
      contentContainerStyle={styles.listContent}
      style={styles.container}
    />
  );
}

void SCREEN_WIDTH;

const styles = StyleSheet.create((theme) => ({
  container:              { flex: 1, backgroundColor: theme.colors.background },
  loadingContainer:       { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText:            { color: theme.colors.textSecondary, marginTop: 15, fontSize: 16 },
  emptyContainer:         { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon:              { fontSize: 60, marginBottom: 20 },
  emptyTitle:             { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10 },
  emptyText:              { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  listContent:            { paddingBottom: 40 },

  header:                 { padding: 20 },
  title:                  { fontSize: 28, fontWeight: 'bold', color: theme.colors.text, textAlign: 'center', marginBottom: 8 },
  subtitle:               { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 25 },

  podium:                 { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', marginBottom: 25, gap: 15 },
  podiumItem:             { alignItems: 'center' },
  podiumPhoto1:           { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: LOCAL.gold   },
  podiumPhoto2:           { width: 65, height: 65, borderRadius: 33, borderWidth: 3, borderColor: LOCAL.silver },
  podiumPhoto3:           { width: 60, height: 60, borderRadius: 30, borderWidth: 3, borderColor: LOCAL.bronze },
  podiumPhotoPlaceholder: { backgroundColor: LOCAL.deepSurface, justifyContent: 'center', alignItems: 'center' },
  podiumPhotoText:        { color: LOCAL.textMuted, fontSize: 24 },
  podiumEmoji:            { fontSize: 24, marginTop: 8 },
  podiumName:             { color: theme.colors.text, fontSize: 12, fontWeight: '600', marginTop: 4, maxWidth: 80, textAlign: 'center' },
  podiumCount:            { color: theme.colors.primary, fontSize: 14, fontWeight: 'bold', marginTop: 2 },

  yourRankCard:           { backgroundColor: theme.colors.surface, borderRadius: 15, padding: 20, alignItems: 'center', marginBottom: 25, borderWidth: 2, borderColor: theme.colors.primary },
  yourRankLabel:          { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 5 },
  yourRankNumber:         { color: theme.colors.primary, fontSize: 36, fontWeight: 'bold' },
  yourRankReferrals:      { color: theme.colors.textSecondary, fontSize: 14, marginTop: 5 },
  listTitle:              { fontSize: 16, fontWeight: '600', color: theme.colors.primary, marginBottom: 15 },

  entryCard:              { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, marginHorizontal: 20, marginBottom: 10, borderRadius: 12, padding: 12, gap: 12 },
  entryCardCurrent:       { borderWidth: 2, borderColor: theme.colors.primary },
  rankContainer:          { width: 45, alignItems: 'center' },
  rankEmoji:              { fontSize: 28 },
  rankNumber:             { fontSize: 16, fontWeight: 'bold' },
  photo:                  { width: 45, height: 45, borderRadius: 23 },
  photoPlaceholder:       { width: 45, height: 45, borderRadius: 23, backgroundColor: LOCAL.deepSurface, justifyContent: 'center', alignItems: 'center' },
  photoPlaceholderText:   { color: LOCAL.textMuted, fontSize: 20 },
  infoContainer:          { flex: 1 },
  nameRow:                { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:                   { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  nameCurrent:            { color: theme.colors.primary },
  championBadge:          { fontSize: 14 },
  referralCount:          { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  championTag:            { backgroundColor: LOCAL.gold, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  championTagText:        { color: LOCAL.championBg, fontSize: 10, fontWeight: 'bold' },
}));