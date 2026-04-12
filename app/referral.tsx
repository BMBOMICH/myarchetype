// app/referral.tsx
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image,
  Share, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';

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

export default function ReferralScreen() {
  const router = useRouter();
  const user   = auth.currentUser;

  const [loading, setLoading]           = useState(true);
  const [referralCode, setReferralCode] = useState('');
  const [referralCount, setReferralCount] = useState(0);
  const [leaderboard, setLeaderboard]   = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank]         = useState<number | null>(null);

  const generateReferralCode = useCallback((uid: string): string => {
    return `MA${uid.substring(0, 6).toUpperCase()}`;
  }, []);

  const loadReferralData = useCallback(async () => {
    if (!user) { router.replace('/login'); return; }
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      let userReferralCount = 0;
      if (userDoc.exists()) {
        const data = userDoc.data() as FirestoreUserData;
        setReferralCode(data.referralCode ?? generateReferralCode(user.uid));
        userReferralCount = data.referralCount ?? 0;
        setReferralCount(userReferralCount);
      }

      const leaderboardSnap = await getDocs(query(
        collection(db, 'users'),
        orderBy('referralCount', 'desc'),
        limit(20),
      ));

      const leaderboardData: LeaderboardEntry[] = [];
      let rank = 1;
      let foundUser = false;

      leaderboardSnap.forEach((docSnap) => {
        const data = docSnap.data() as FirestoreUserData;
        if ((data.referralCount ?? 0) > 0) {
          leaderboardData.push({
            uid:           docSnap.id,
            name:          data.name    ?? 'Anonymous',
            photo:         data.photos?.[0] ?? '',
            referralCount: data.referralCount ?? 0,
            isChampion:    (data.referralCount ?? 0) >= 10,
          });
          if (docSnap.id === user.uid) { setUserRank(rank); foundUser = true; }
          rank++;
        }
      });
      setLeaderboard(leaderboardData);

      if (!foundUser && userReferralCount > 0) {
        const allUsersSnap = await getDocs(query(collection(db, 'users')));
        let rankCalc = 1;
        allUsersSnap.forEach((d) => {
          const data = d.data() as FirestoreUserData;
          if ((data.referralCount ?? 0) > userReferralCount) rankCalc++;
        });
        setUserRank(rankCalc);
      }
    } catch (error) {
      logger.error('[Referral] Error loading referral data:', error);
    } finally {
      setLoading(false);
    }
  }, [user, router, generateReferralCode]);

  useEffect(() => { void loadReferralData(); }, [loadReferralData]);

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

  const renderLeaderboardItem = useCallback(({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isCurrentUser = item.uid === user?.uid;
    const rank          = index + 1;
    return (
      <View
        style={[s.leaderboardItem, isCurrentUser && s.leaderboardItemCurrent]}
        accessibilityLabel={`Rank ${getRankEmoji(rank)}: ${item.name}${isCurrentUser ? ' (You)' : ''}, ${item.referralCount} referral${item.referralCount !== 1 ? 's' : ''}${item.isChampion ? ', Community Champion' : ''}`}
      >
        <Text style={s.leaderboardRank} accessibilityElementsHidden>{getRankEmoji(rank)}</Text>
        {item.photo ? (
          <Image
            source={{ uri: item.photo }}
            style={s.leaderboardPhoto}
            accessibilityLabel={`${item.name}'s profile photo`}
          />
        ) : (
          <View style={s.leaderboardPhotoPlaceholder} accessibilityLabel={`${item.name} has no photo`}>
            <Text style={s.leaderboardPhotoText} accessibilityElementsHidden>?</Text>
          </View>
        )}
        <View style={s.leaderboardInfo}>
          <View style={s.leaderboardNameRow}>
            <Text style={[s.leaderboardName, isCurrentUser && s.leaderboardNameCurrent]}>
              {item.name}{isCurrentUser ? ' (You)' : ''}
            </Text>
            {item.isChampion && <Text style={s.leaderboardChampion} accessibilityElementsHidden>🌟</Text>}
          </View>
          <Text style={s.leaderboardCount}>{item.referralCount} referral{item.referralCount !== 1 ? 's' : ''}</Text>
        </View>
      </View>
    );
  }, [user?.uid, getRankEmoji]);

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={s.loadingText}>Loading...</Text>
      </View>
    );
  }

  const isChampion          = referralCount >= 10;
  const progressToChampion  = Math.min((referralCount / 10) * 100, 100);

  return (
    <View style={s.container}>
      <View style={s.headerCard}>
        <Text style={s.headerTitle} accessibilityRole="header">🌟 Invite Friends</Text>
        <Text style={s.headerSubtitle}>Share MyArchetype and become a Community Champion!</Text>

        <View style={s.codeBox} accessibilityLabel={`Your referral code: ${referralCode}`}>
          <Text style={s.codeLabel}>Your Referral Code</Text>
          <Text style={s.code} accessibilityElementsHidden>{referralCode}</Text>
        </View>

        <View style={s.shareButtons}>
          <TouchableOpacity style={s.copyButton} onPress={handleCopyCode} accessibilityLabel="Copy referral code to clipboard" accessibilityRole="button">
            <Text style={s.copyButtonText}>📋 Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.shareButton} onPress={handleShare} accessibilityLabel="Share referral code" accessibilityRole="button">
            <Text style={s.shareButtonText}>📤 Share</Text>
          </TouchableOpacity>
        </View>

        <View style={s.statsRow}>
          <View style={s.statItem} accessibilityLabel={`${referralCount} referrals`}>
            <Text style={s.statValue}>{referralCount}</Text>
            <Text style={s.statLabel}>Referrals</Text>
          </View>
          <View style={s.statItem} accessibilityLabel={userRank ? `Your rank: #${userRank}` : 'Not ranked yet'}>
            <Text style={s.statValue}>{userRank ? `#${userRank}` : '-'}</Text>
            <Text style={s.statLabel}>Your Rank</Text>
          </View>
        </View>

        {!isChampion && (
          <View style={s.progressContainer} accessibilityLabel={`${10 - referralCount} more referrals needed to become Community Champion`}>
            <Text style={s.progressLabel}>{10 - referralCount} more to become Community Champion 🌟</Text>
            <View style={s.progressBarBg}>
              <View style={[s.progressBar, { width: `${progressToChampion}%` as `${number}%` }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progressToChampion }} />
            </View>
          </View>
        )}

        {isChampion && (
          <View style={s.championContainer} accessibilityLabel="Community Champion badge earned">
            <Text style={s.championBadge}>🌟 Community Champion 🌟</Text>
            <Text style={s.championText}>Thank you for spreading the love! Your badge is visible on your profile.</Text>
          </View>
        )}
      </View>

      <View style={s.leaderboardSection}>
        <Text style={s.leaderboardTitle} accessibilityRole="header">🏆 Top Referrers</Text>
        {leaderboard.length > 0 ? (
          <FlatList
            data={leaderboard}
            keyExtractor={(item) => item.uid}
            renderItem={renderLeaderboardItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.leaderboardList}
          />
        ) : (
          <View style={s.emptyLeaderboard}>
            <Text style={s.emptyLeaderboardText}>No referrals yet. Be the first! 🚀</Text>
          </View>
        )}
      </View>

      <View style={s.howItWorks}>
        <Text style={s.howItWorksTitle} accessibilityRole="header">How it works</Text>
        {([
          'Share your code with friends',
          'They sign up using your code',
          'Get 10 referrals = Community Champion badge!',
        ] as const).map((step, i) => (
          <View key={i} style={s.howItWorksItem} accessibilityLabel={`Step ${i + 1}: ${step}`}>
            <Text style={s.howItWorksNumber} accessibilityElementsHidden>{i + 1}</Text>
            <Text style={s.howItWorksText}>{step}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container:                { flex: 1, backgroundColor: '#1a1a2e' },
  loadingContainer:         { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText:              { color: '#aaa', marginTop: 15, fontSize: 16 },
  headerCard:               { backgroundColor: '#16213e', margin: 20, borderRadius: 20, padding: 25, borderWidth: 2, borderColor: '#f1c40f' },
  headerTitle:              { fontSize: 24, fontWeight: 'bold', color: '#eee', textAlign: 'center', marginBottom: 8 },
  headerSubtitle:           { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 20 },
  codeBox:                  { backgroundColor: '#0f3460', borderRadius: 15, padding: 20, marginBottom: 15, alignItems: 'center' },
  codeLabel:                { color: '#888', fontSize: 12, marginBottom: 8 },
  code:                     { color: '#f1c40f', fontSize: 32, fontWeight: 'bold', letterSpacing: 4 },
  shareButtons:             { flexDirection: 'row', gap: 10, marginBottom: 20 },
  copyButton:               { flex: 1, backgroundColor: '#0f3460', paddingVertical: 14, borderRadius: 25, alignItems: 'center' },
  copyButtonText:           { color: '#53a8b6', fontSize: 16, fontWeight: '600' },
  shareButton:              { flex: 1, backgroundColor: '#f1c40f', paddingVertical: 14, borderRadius: 25, alignItems: 'center' },
  shareButtonText:          { color: '#1a1a2e', fontSize: 16, fontWeight: '600' },
  statsRow:                 { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 15 },
  statItem:                 { alignItems: 'center' },
  statValue:                { color: '#5cb85c', fontSize: 28, fontWeight: 'bold' },
  statLabel:                { color: '#888', fontSize: 12 },
  progressContainer:        { marginTop: 10 },
  progressLabel:            { color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 8 },
  progressBarBg:            { height: 8, backgroundColor: '#0f3460', borderRadius: 4, overflow: 'hidden' },
  progressBar:              { height: '100%', backgroundColor: '#f1c40f', borderRadius: 4 },
  championContainer:        { marginTop: 15, alignItems: 'center' },
  championBadge:            { fontSize: 20, fontWeight: 'bold', color: '#f1c40f', marginBottom: 8 },
  championText:             { color: '#888', fontSize: 12, textAlign: 'center' },
  leaderboardSection:       { flex: 1, paddingHorizontal: 20 },
  leaderboardTitle:         { fontSize: 18, fontWeight: 'bold', color: '#eee', marginBottom: 15 },
  leaderboardList:          { paddingBottom: 20 },
  leaderboardItem:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', padding: 12, borderRadius: 12, marginBottom: 8, gap: 12 },
  leaderboardItemCurrent:   { borderWidth: 2, borderColor: '#53a8b6' },
  leaderboardRank:          { fontSize: 20, width: 40, textAlign: 'center' },
  leaderboardPhoto:         { width: 40, height: 40, borderRadius: 20 },
  leaderboardPhotoPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  leaderboardPhotoText:     { color: '#666', fontSize: 18 },
  leaderboardInfo:          { flex: 1 },
  leaderboardNameRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leaderboardName:          { color: '#eee', fontSize: 15, fontWeight: '600' },
  leaderboardNameCurrent:   { color: '#53a8b6' },
  leaderboardChampion:      { fontSize: 14 },
  leaderboardCount:         { color: '#888', fontSize: 12 },
  emptyLeaderboard:         { padding: 30, alignItems: 'center' },
  emptyLeaderboardText:     { color: '#666', fontSize: 14 },
  howItWorks:               { padding: 20, paddingTop: 0 },
  howItWorksTitle:          { fontSize: 16, fontWeight: '600', color: '#53a8b6', marginBottom: 12 },
  howItWorksItem:           { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 12 },
  howItWorksNumber:         { width: 24, height: 24, borderRadius: 12, backgroundColor: '#0f3460', color: '#53a8b6', fontSize: 14, fontWeight: 'bold', textAlign: 'center', lineHeight: 24 },
  howItWorksText:           { color: '#aaa', fontSize: 13 },
});