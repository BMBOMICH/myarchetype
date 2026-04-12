import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { calculateDatingStats, DatingStats, getConversationRateLevel, getMatchRateLevel } from '../utils/datingStats';
import { logger } from '../utils/logger';

interface Section { key: string; render: () => React.ReactElement }

export default function DatingStatsScreen() {
  const router  = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats]     = useState<DatingStats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await calculateDatingStats());
    } catch (error) {
      logger.error('[Stats] Load error:', error);
      Alert.alert('Error', 'Failed to calculate stats.');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Calculating your stats...</Text>
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.errorText}>Failed to load stats.</Text>
      </View>
    );
  }

  const matchRateInfo        = getMatchRateLevel(stats.matchRate);
  const conversationRateInfo = getConversationRateLevel(stats.conversationRate);

  const sections: Section[] = [
    {
      key: 'header',
      render: () => (
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>📊 Your Dating Stats</Text>
          <View style={{ width: 60 }} />
        </View>
      ),
    },
    {
      key: 'overview',
      render: () => (
        <View style={styles.overviewGrid}>
          {[
            { n: stats.totalMatches, l: 'Total Matches', c: '#53a8b6' },
            { n: `${stats.matchRate}%`, l: 'Match Rate', c: matchRateInfo.color },
            { n: stats.profileViews, l: 'Profile Views', c: '#53a8b6' },
            { n: stats.trustScore,   l: 'Trust Score',   c: '#53a8b6' },
          ].map((item) => (
            <View key={item.l} style={styles.overviewCard} accessibilityLabel={`${item.l}: ${item.n}`}>
              <Text style={[styles.overviewNumber, { color: item.c }]}>{item.n}</Text>
              <Text style={styles.overviewLabel}>{item.l}</Text>
            </View>
          ))}
        </View>
      ),
    },
    {
      key: 'matchPerf',
      render: () => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Match Performance</Text>
          <View style={[styles.ratingCard, { borderColor: matchRateInfo.color }]}>
            <View style={styles.ratingHeader}>
              <Text style={styles.ratingLabel}>Match Rate</Text>
              <View style={[styles.ratingBadge, { backgroundColor: matchRateInfo.color }]}>
                <Text style={styles.ratingBadgeText}>{matchRateInfo.level}</Text>
              </View>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${stats.matchRate}%`, backgroundColor: matchRateInfo.color }]} />
            </View>
            <Text style={styles.ratingMessage}>{matchRateInfo.message}</Text>
          </View>
          <View style={styles.statsGrid}>
            {[
              { n: stats.likesSent,      l: 'Likes Sent' },
              { n: stats.likesReceived,  l: 'Likes Received' },
              { n: stats.activeMatches,  l: 'Active Chats' },
              { n: stats.expiredMatches, l: 'Expired' },
            ].map((item) => (
              <View key={item.l} style={styles.statItem} accessibilityLabel={`${item.l}: ${item.n}`}>
                <Text style={styles.statNumber}>{item.n}</Text>
                <Text style={styles.statLabel}>{item.l}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },
    {
      key: 'convStats',
      render: () => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conversation Stats</Text>
          <View style={[styles.ratingCard, { borderColor: conversationRateInfo.color }]}>
            <View style={styles.ratingHeader}>
              <Text style={styles.ratingLabel}>Conversation Rate</Text>
              <View style={[styles.ratingBadge, { backgroundColor: conversationRateInfo.color }]}>
                <Text style={styles.ratingBadgeText}>{conversationRateInfo.level}</Text>
              </View>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${stats.conversationRate}%`, backgroundColor: conversationRateInfo.color }]} />
            </View>
            <Text style={styles.ratingMessage}>{conversationRateInfo.message}</Text>
          </View>
          <View style={styles.statsGrid}>
            {[
              { n: stats.messagesSent,     l: 'Messages Sent' },
              { n: stats.messagesReceived, l: 'Messages Received' },
            ].map((item) => (
              <View key={item.l} style={styles.statItem} accessibilityLabel={`${item.l}: ${item.n}`}>
                <Text style={styles.statNumber}>{item.n}</Text>
                <Text style={styles.statLabel}>{item.l}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },
    {
      key: 'profilePerf',
      render: () => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile Performance</Text>
          <View style={styles.infoCard}>
            {[
              { l: 'Profile Views',   v: stats.profileViews },
              { l: 'Views per Day',   v: stats.profileViewRate },
              { l: 'Swipes per Day',  v: stats.averageSwipesPerDay },
            ].map((item) => (
              <View key={item.l} style={styles.infoRow} accessibilityLabel={`${item.l}: ${item.v}`}>
                <Text style={styles.infoLabel}>{item.l}</Text>
                <Text style={styles.infoValue}>{item.v}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },
    ...(stats.totalRatings > 0 ? [{
      key: 'success',
      render: () => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dating Success</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow} accessibilityLabel={`Average rating: ${stats.averageRating}`}>
              <Text style={styles.infoLabel}>Average Rating</Text>
              <Text style={[styles.infoValue, { color: '#f1c40f' }]}>{stats.averageRating} ⭐</Text>
            </View>
            <View style={styles.infoRow} accessibilityLabel={`Total ratings: ${stats.totalRatings}`}>
              <Text style={styles.infoLabel}>Total Ratings</Text>
              <Text style={styles.infoValue}>{stats.totalRatings}</Text>
            </View>
            <View style={styles.infoRow} accessibilityLabel={`Meetup rate: ${stats.meetupRate} percent`}>
              <Text style={styles.infoLabel}>Meetup Rate</Text>
              <Text style={styles.infoValue}>{stats.meetupRate}%</Text>
            </View>
            {stats.secondDateRate > 0 && (
              <View style={styles.infoRow} accessibilityLabel={`Second date rate: ${stats.secondDateRate} percent`}>
                <Text style={styles.infoLabel}>Second Date Rate</Text>
                <Text style={[styles.infoValue, { color: '#5cb85c' }]}>{stats.secondDateRate}%</Text>
              </View>
            )}
          </View>
        </View>
      ),
    }] : []),
    {
      key: 'tips',
      render: () => (
        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>💡 Tips to Improve</Text>
          {stats.matchRate < 15 && <Text style={styles.tipText}>• Update your photos - use recent, clear, smiling pictures{'\n'}• Write a better bio - be specific and interesting{'\n'}• Complete your profile</Text>}
          {stats.conversationRate < 40 && <Text style={styles.tipText}>• Send the first message - don't wait for them{'\n'}• Use opening lines feature for conversation starters{'\n'}• Ask questions about their interests</Text>}
          {stats.profileViewRate < 5 && <Text style={styles.tipText}>• Be more active - swipe daily to appear in more searches{'\n'}• Answer the daily question - boosts visibility{'\n'}• Update your profile regularly</Text>}
          {stats.matchRate >= 30 && stats.conversationRate >= 60 && <Text style={styles.tipText}>✅ You're doing great! Keep being yourself and stay active.</Text>}
        </View>
      ),
    },
  ];

  return (
    <FlatList
      data={sections}
      keyExtractor={(item) => item.key}
      renderItem={({ item }) => item.render()}
      contentContainerStyle={styles.content}
      style={styles.container}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 40 },
  loadingText: { color: '#aaa', fontSize: 16, marginTop: 15, textAlign: 'center' },
  errorText: { color: '#d9534f', fontSize: 16, textAlign: 'center', marginTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 30, marginBottom: 20 },
  backButton: { color: '#53a8b6', fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 25 },
  overviewCard: { flex: 1, minWidth: '45%', backgroundColor: '#16213e', borderRadius: 15, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  overviewNumber: { fontSize: 32, fontWeight: 'bold', marginBottom: 5 },
  overviewLabel: { fontSize: 13, color: '#888', textAlign: 'center' },
  section: { marginBottom: 25 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#53a8b6', marginBottom: 15 },
  ratingCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, borderWidth: 2, marginBottom: 15 },
  ratingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  ratingLabel: { fontSize: 16, fontWeight: '600', color: '#eee' },
  ratingBadge: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12 },
  ratingBadgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  progressBar: { height: 10, backgroundColor: '#0f3460', borderRadius: 5, overflow: 'hidden', marginBottom: 12 },
  progressFill: { height: '100%', borderRadius: 5 },
  ratingMessage: { color: '#aaa', fontSize: 14, lineHeight: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statItem: { flex: 1, minWidth: '45%', backgroundColor: '#16213e', borderRadius: 12, padding: 15, alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  statNumber: { fontSize: 24, fontWeight: 'bold', color: '#eee', marginBottom: 5 },
  statLabel: { fontSize: 12, color: '#888', textAlign: 'center' },
  infoCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, borderWidth: 1, borderColor: '#0f3460' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  infoLabel: { fontSize: 15, color: '#aaa' },
  infoValue: { fontSize: 16, fontWeight: 'bold', color: '#eee' },
  tipsCard: { backgroundColor: 'rgba(83,168,182,0.1)', borderRadius: 15, padding: 20, borderWidth: 1, borderColor: 'rgba(83,168,182,0.3)' },
  tipsTitle: { fontSize: 16, fontWeight: 'bold', color: '#53a8b6', marginBottom: 12 },
  tipText: { color: '#aaa', fontSize: 14, lineHeight: 22 },
});