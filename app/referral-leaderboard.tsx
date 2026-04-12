import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, RefreshControl,
  StyleSheet, Text, View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';

interface LeaderboardEntry {
  oduid: string; name: string; photo: string;
  referralCount: number; isChampion: boolean; rank: number;
}

function getRankDisplay(rank: number): { emoji: string; color: string } {
  if (rank === 1) return { emoji: '🥇', color: '#f1c40f' };
  if (rank === 2) return { emoji: '🥈', color: '#bdc3c7' };
  if (rank === 3) return { emoji: '🥉', color: '#e67e22' };
  return { emoji: `#${rank}`, color: '#888' };
}

export default function ReferralLeaderboardScreen() {
  const user = auth.currentUser;
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userEntry, setUserEntry]   = useState<LeaderboardEntry | null>(null);

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
        const data = docSnap.data();
        const referralCount = (data.referralCount as number) || 0;
        if (referralCount > 0) {
          const entry: LeaderboardEntry = {
            oduid: docSnap.id,
            name: data.name || 'Anonymous',
            photo: data.photos?.[0] || '',
            referralCount, isChampion: referralCount >= 10, rank,
          };
          entries.push(entry);
          if (docSnap.id === user?.uid) currentUserEntry = entry;
          rank++;
        }
      });

      setLeaderboard(entries);
      setUserEntry(currentUserEntry);
    } catch (error) {
      logger.error('[Leaderboard] loadLeaderboard error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadLeaderboard();
  }, [loadLeaderboard]);

  const renderHeader = useCallback(() => (
    <View style={styles.header}>
      <Text style={styles.title}>🏆 Referral Leaderboard</Text>
      <Text style={styles.subtitle}>Top community champions who spread the love</Text>

      {leaderboard.length >= 3 && (
        <View style={styles.podium}>
          {([1, 0, 2] as const).map((pos) => {
            const entry = leaderboard[pos];
            if (!entry) return null;
            const sizes = [styles.podiumPhoto2, styles.podiumPhoto1, styles.podiumPhoto3] as const;
            const emojis = ['🥈', '🥇', '🥉'] as const;
            return (
              <View key={pos} style={styles.podiumItem}>
                {entry.photo ? (
                  <Image
                    source={{ uri: entry.photo }}
                    style={sizes[pos === 0 ? 1 : pos === 1 ? 0 : 2]}
                    accessibilityLabel={`${entry.name} in position ${entry.rank}`}
                  />
                ) : (
                  <View style={[styles.podiumPhotoPlaceholder, sizes[pos === 0 ? 1 : pos === 1 ? 0 : 2]]} accessibilityLabel={`No photo for ${entry.name}`}>
                    <Text style={styles.podiumPhotoText}>?</Text>
                  </View>
                )}
                <Text style={styles.podiumEmoji}>{emojis[pos === 0 ? 1 : pos === 1 ? 0 : 2]}</Text>
                <Text style={styles.podiumName} numberOfLines={1}>{entry.name}</Text>
                <Text style={styles.podiumCount}>{entry.referralCount}</Text>
              </View>
            );
          })}
        </View>
      )}

      {userEntry && (
        <View style={styles.yourRankCard} accessibilityLabel={`Your rank is ${userEntry.rank} with ${userEntry.referralCount} referrals`}>
          <Text style={styles.yourRankLabel}>Your Rank</Text>
          <Text style={styles.yourRankNumber}>#{userEntry.rank}</Text>
          <Text style={styles.yourRankReferrals}>{userEntry.referralCount} referrals</Text>
        </View>
      )}

      <Text style={styles.listTitle}>All Rankings</Text>
    </View>
  ), [leaderboard, userEntry]);

  const renderItem = useCallback(({ item }: { item: LeaderboardEntry }) => {
    const isCurrentUser = item.oduid === user?.uid;
    const rankInfo = getRankDisplay(item.rank);
    return (
      <View
        style={[styles.entryCard, isCurrentUser && styles.entryCardCurrent]}
        accessibilityLabel={`Rank ${item.rank}: ${item.name}, ${item.referralCount} referrals${isCurrentUser ? ', this is you' : ''}${item.isChampion ? ', community champion' : ''}`}
      >
        <View style={styles.rankContainer}>
          {item.rank <= 3
            ? <Text style={styles.rankEmoji}>{rankInfo.emoji}</Text>
            : <Text style={[styles.rankNumber, { color: rankInfo.color }]}>#{item.rank}</Text>
          }
        </View>
        {item.photo ? (
          <Image source={{ uri: item.photo }} style={styles.photo} accessibilityLabel={`Photo of ${item.name}`} />
        ) : (
          <View style={styles.photoPlaceholder} accessibilityLabel={`No photo for ${item.name}`}>
            <Text style={styles.photoPlaceholderText}>?</Text>
          </View>
        )}
        <View style={styles.infoContainer}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, isCurrentUser && styles.nameCurrent]}>
              {item.name}{isCurrentUser ? ' (You)' : ''}
            </Text>
            {item.isChampion && <Text style={styles.championBadge}>🌟</Text>}
          </View>
          <Text style={styles.referralCount}>{item.referralCount} referral{item.referralCount !== 1 ? 's' : ''}</Text>
        </View>
        {item.isChampion && (
          <View style={styles.championTag}>
            <Text style={styles.championTagText}>Champion</Text>
          </View>
        )}
      </View>
    );
  }, [user]);

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
        <Text style={styles.emptyIcon}>🏆</Text>
        <Text style={styles.emptyTitle}>No referrals yet</Text>
        <Text style={styles.emptyText}>Be the first to invite friends and top the leaderboard!</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={leaderboard}
      keyExtractor={(item) => item.oduid}
      renderItem={renderItem}
      ListHeaderComponent={renderHeader}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#53a8b6" />}
      contentContainerStyle={styles.listContent}
      style={styles.container}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', marginTop: 15, fontSize: 16 },
  emptyContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 60, marginBottom: 20 },
  emptyTitle: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 10 },
  emptyText: { fontSize: 14, color: '#888', textAlign: 'center' },
  listContent: { paddingBottom: 40 },
  header: { padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 25 },
  podium: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', marginBottom: 25, gap: 15 },
  podiumItem: { alignItems: 'center' },
  podiumPhoto1: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#f1c40f' },
  podiumPhoto2: { width: 65, height: 65, borderRadius: 33, borderWidth: 3, borderColor: '#bdc3c7' },
  podiumPhoto3: { width: 60, height: 60, borderRadius: 30, borderWidth: 3, borderColor: '#e67e22' },
  podiumPhotoPlaceholder: { backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  podiumPhotoText: { color: '#666', fontSize: 24 },
  podiumEmoji: { fontSize: 24, marginTop: 8 },
  podiumName: { color: '#eee', fontSize: 12, fontWeight: '600', marginTop: 4, maxWidth: 80, textAlign: 'center' },
  podiumCount: { color: '#53a8b6', fontSize: 14, fontWeight: 'bold', marginTop: 2 },
  yourRankCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, alignItems: 'center', marginBottom: 25, borderWidth: 2, borderColor: '#53a8b6' },
  yourRankLabel: { color: '#888', fontSize: 12, marginBottom: 5 },
  yourRankNumber: { color: '#53a8b6', fontSize: 36, fontWeight: 'bold' },
  yourRankReferrals: { color: '#888', fontSize: 14, marginTop: 5 },
  listTitle: { fontSize: 16, fontWeight: '600', color: '#53a8b6', marginBottom: 15 },
  entryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', marginHorizontal: 20, marginBottom: 10, borderRadius: 12, padding: 12, gap: 12 },
  entryCardCurrent: { borderWidth: 2, borderColor: '#53a8b6' },
  rankContainer: { width: 45, alignItems: 'center' },
  rankEmoji: { fontSize: 28 },
  rankNumber: { fontSize: 16, fontWeight: 'bold' },
  photo: { width: 45, height: 45, borderRadius: 23 },
  photoPlaceholder: { width: 45, height: 45, borderRadius: 23, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  photoPlaceholderText: { color: '#666', fontSize: 20 },
  infoContainer: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: '#eee', fontSize: 15, fontWeight: '600' },
  nameCurrent: { color: '#53a8b6' },
  championBadge: { fontSize: 14 },
  referralCount: { color: '#888', fontSize: 12, marginTop: 2 },
  championTag: { backgroundColor: '#f1c40f', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  championTagText: { color: '#1a1a2e', fontSize: 10, fontWeight: 'bold' },
});