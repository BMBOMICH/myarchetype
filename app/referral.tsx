import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';

interface LeaderboardEntry {
  uid: string;
  name: string;
  photo: string;
  referralCount: number;
  isChampion: boolean;
}

export default function ReferralScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [referralCode, setReferralCode] = useState('');
  const [referralCount, setReferralCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);

  useEffect(() => {
    loadReferralData();
  }, []);

  const loadReferralData = async () => {
    if (!user) {
      router.replace('/login');
      return;
    }

    try {
      // Load user's referral data
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setReferralCode(data.referralCode || generateReferralCode(user.uid));
        setReferralCount(data.referralCount || 0);
      }

      // Load leaderboard
      const leaderboardQuery = query(
        collection(db, 'users'),
        orderBy('referralCount', 'desc'),
        limit(20)
      );
      const leaderboardSnapshot = await getDocs(leaderboardQuery);
      
      const leaderboardData: LeaderboardEntry[] = [];
      let rank = 1;
      let foundUser = false;

      leaderboardSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.referralCount > 0) {
          leaderboardData.push({
            uid: docSnap.id,
            name: data.name || 'Anonymous',
            photo: data.photos?.[0] || '',
            referralCount: data.referralCount || 0,
            isChampion: (data.referralCount || 0) >= 10,
          });
          
          if (docSnap.id === user.uid) {
            setUserRank(rank);
            foundUser = true;
          }
          rank++;
        }
      });

      setLeaderboard(leaderboardData);

      // If user not in top 20, find their rank
      if (!foundUser && userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.referralCount > 0) {
          // Simple estimate - count users with more referrals
          const countQuery = query(collection(db, 'users'));
          const allUsers = await getDocs(countQuery);
          let userRankCalc = 1;
          allUsers.forEach((d) => {
            if (d.data().referralCount > (userData.referralCount || 0)) {
              userRankCalc++;
            }
          });
          setUserRank(userRankCalc);
        }
      }

    } catch (error) {
      console.error('Error loading referral data:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateReferralCode = (oduid: string): string => {
    const prefix = 'MA';
    const suffix = oduid.substring(0, 6).toUpperCase();
    return `${prefix}${suffix}`;
  };

  const handleCopyCode = async () => {
    await Clipboard.setStringAsync(referralCode);
    Alert.alert('Copied!', 'Referral code copied to clipboard');
  };

  const handleShare = async () => {
    try {
      const message = `Join me on MyArchetype - the 100% FREE dating app for genuine connections! 💕\n\nUse my code: ${referralCode}\n\n🚀 No premium, no restrictions, just real people finding real love.\n\nDownload: https://myarchetype.app`;
      
      await Share.share({
        message,
        title: 'Join MyArchetype',
      });
    } catch (error) {
      // Fallback to clipboard
      await Clipboard.setStringAsync(`Join MyArchetype with code: ${referralCode}`);
      Alert.alert('Copied!', 'Share message copied to clipboard');
    }
  };

  const getRankEmoji = (rank: number): string => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const renderLeaderboardItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isCurrentUser = item.uid === user?.uid;
    const rank = index + 1;

    return (
      <View style={[styles.leaderboardItem, isCurrentUser && styles.leaderboardItemCurrent]}>
        <Text style={styles.leaderboardRank}>{getRankEmoji(rank)}</Text>
        
        {item.photo ? (
          <Image source={{ uri: item.photo }} style={styles.leaderboardPhoto} />
        ) : (
          <View style={styles.leaderboardPhotoPlaceholder}>
            <Text style={styles.leaderboardPhotoText}>?</Text>
          </View>
        )}

        <View style={styles.leaderboardInfo}>
          <View style={styles.leaderboardNameRow}>
            <Text style={[styles.leaderboardName, isCurrentUser && styles.leaderboardNameCurrent]}>
              {item.name}
              {isCurrentUser && ' (You)'}
            </Text>
            {item.isChampion && (
              <Text style={styles.leaderboardChampion}>🌟</Text>
            )}
          </View>
          <Text style={styles.leaderboardCount}>
            {item.referralCount} referral{item.referralCount !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const isChampion = referralCount >= 10;
  const progressToChampion = Math.min((referralCount / 10) * 100, 100);

  return (
    <View style={styles.container}>
      {/* HEADER CARD */}
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>🌟 Invite Friends</Text>
        <Text style={styles.headerSubtitle}>
          Share MyArchetype and become a Community Champion!
        </Text>

        {/* REFERRAL CODE */}
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Your Referral Code</Text>
          <Text style={styles.code}>{referralCode}</Text>
        </View>

        {/* SHARE BUTTONS */}
        <View style={styles.shareButtons}>
          <TouchableOpacity style={styles.copyButton} onPress={handleCopyCode}>
            <Text style={styles.copyButtonText}>📋 Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
            <Text style={styles.shareButtonText}>📤 Share</Text>
          </TouchableOpacity>
        </View>

        {/* STATS */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{referralCount}</Text>
            <Text style={styles.statLabel}>Referrals</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{userRank ? `#${userRank}` : '-'}</Text>
            <Text style={styles.statLabel}>Your Rank</Text>
          </View>
        </View>

        {/* CHAMPION PROGRESS */}
        {!isChampion && (
          <View style={styles.progressContainer}>
            <Text style={styles.progressLabel}>
              {10 - referralCount} more to become Community Champion 🌟
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBar, { width: `${progressToChampion}%` }]} />
            </View>
          </View>
        )}

        {isChampion && (
          <View style={styles.championContainer}>
            <Text style={styles.championBadge}>🌟 Community Champion 🌟</Text>
            <Text style={styles.championText}>
              Thank you for spreading the love! Your badge is visible on your profile.
            </Text>
          </View>
        )}
      </View>

      {/* LEADERBOARD */}
      <View style={styles.leaderboardSection}>
        <Text style={styles.leaderboardTitle}>🏆 Top Referrers</Text>
        
        {leaderboard.length > 0 ? (
          <FlatList
            data={leaderboard}
            keyExtractor={(item) => item.uid}
            renderItem={renderLeaderboardItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.leaderboardList}
          />
        ) : (
          <View style={styles.emptyLeaderboard}>
            <Text style={styles.emptyLeaderboardText}>
              No referrals yet. Be the first! 🚀
            </Text>
          </View>
        )}
      </View>

      {/* HOW IT WORKS */}
      <View style={styles.howItWorks}>
        <Text style={styles.howItWorksTitle}>How it works</Text>
        <View style={styles.howItWorksItem}>
          <Text style={styles.howItWorksNumber}>1</Text>
          <Text style={styles.howItWorksText}>Share your code with friends</Text>
        </View>
        <View style={styles.howItWorksItem}>
          <Text style={styles.howItWorksNumber}>2</Text>
          <Text style={styles.howItWorksText}>They sign up using your code</Text>
        </View>
        <View style={styles.howItWorksItem}>
          <Text style={styles.howItWorksNumber}>3</Text>
          <Text style={styles.howItWorksText}>Get 10 referrals = Community Champion badge!</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#aaa',
    marginTop: 15,
    fontSize: 16,
  },
  headerCard: {
    backgroundColor: '#16213e',
    margin: 20,
    borderRadius: 20,
    padding: 25,
    borderWidth: 2,
    borderColor: '#f1c40f',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#eee',
    textAlign: 'center',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 20,
  },
  codeBox: {
    backgroundColor: '#0f3460',
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
    alignItems: 'center',
  },
  codeLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  code: {
    color: '#f1c40f',
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  shareButtons: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  copyButton: {
    flex: 1,
    backgroundColor: '#0f3460',
    paddingVertical: 14,
    borderRadius: 25,
    alignItems: 'center',
  },
  copyButtonText: {
    color: '#53a8b6',
    fontSize: 16,
    fontWeight: '600',
  },
  shareButton: {
    flex: 1,
    backgroundColor: '#f1c40f',
    paddingVertical: 14,
    borderRadius: 25,
    alignItems: 'center',
  },
  shareButtonText: {
    color: '#1a1a2e',
    fontSize: 16,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 15,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    color: '#5cb85c',
    fontSize: 28,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#888',
    fontSize: 12,
  },
  progressContainer: {
    marginTop: 10,
  },
  progressLabel: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#0f3460',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#f1c40f',
    borderRadius: 4,
  },
  championContainer: {
    marginTop: 15,
    alignItems: 'center',
  },
  championBadge: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f1c40f',
    marginBottom: 8,
  },
  championText: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
  },
  leaderboardSection: {
    flex: 1,
    paddingHorizontal: 20,
  },
  leaderboardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#eee',
    marginBottom: 15,
  },
  leaderboardList: {
    paddingBottom: 20,
  },
  leaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  leaderboardItemCurrent: {
    borderWidth: 2,
    borderColor: '#53a8b6',
  },
  leaderboardRank: {
    fontSize: 20,
    width: 40,
    textAlign: 'center',
  },
  leaderboardPhoto: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  leaderboardPhotoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaderboardPhotoText: {
    color: '#666',
    fontSize: 18,
  },
  leaderboardInfo: {
    flex: 1,
  },
  leaderboardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leaderboardName: {
    color: '#eee',
    fontSize: 15,
    fontWeight: '600',
  },
  leaderboardNameCurrent: {
    color: '#53a8b6',
  },
  leaderboardChampion: {
    fontSize: 14,
  },
  leaderboardCount: {
    color: '#888',
    fontSize: 12,
  },
  emptyLeaderboard: {
    padding: 30,
    alignItems: 'center',
  },
  emptyLeaderboardText: {
    color: '#666',
    fontSize: 14,
  },
  howItWorks: {
    padding: 20,
    paddingTop: 0,
  },
  howItWorksTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#53a8b6',
    marginBottom: 12,
  },
  howItWorksItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  howItWorksNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0f3460',
    color: '#53a8b6',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 24,
  },
  howItWorksText: {
    color: '#aaa',
    fontSize: 13,
  },
});