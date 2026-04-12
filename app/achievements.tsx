import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { Achievement, getAchievementProgress, getLockedAchievements, getUserAchievements } from '../utils/achievements';
import { logger } from '../utils/logger';

const CATEGORIES = ['profile', 'social', 'dating', 'safety', 'community'] as const;
type Category = typeof CATEGORIES[number];
interface AchievementItem extends Achievement { _type: 'unlocked' | 'locked' }

export default function AchievementsScreen() {
  const router = useRouter();
  const [loading, setLoading]           = useState(true);
  const [unlocked, setUnlocked]         = useState<Achievement[]>([]);
  const [locked, setLocked]             = useState<Achievement[]>([]);
  const [progress, setProgress]         = useState({ total: 0, unlocked: 0, points: 0 });
  const [selectedCategory, setCategory] = useState<Category | null>(null);

  const loadAchievements = useCallback(async () => {
    try {
      const [u, l] = await Promise.all([getUserAchievements(), getLockedAchievements()]);
      setUnlocked(u);
      setLocked(l);
      const user = auth.currentUser;
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) setProgress(getAchievementProgress(snap.data()));
      }
    } catch (error) {
      logger.error('[Achievements] load error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAchievements(); }, [loadAchievements]);

  const filteredUnlocked = useMemo(() =>
    selectedCategory ? unlocked.filter(a => a.category === selectedCategory) : unlocked,
  [unlocked, selectedCategory]);

  const filteredLocked = useMemo(() =>
    selectedCategory ? locked.filter(a => a.category === selectedCategory) : locked,
  [locked, selectedCategory]);

  const listData = useMemo((): AchievementItem[] => [
    ...filteredUnlocked.map(a => ({ ...a, _type: 'unlocked' as const })),
    ...filteredLocked.map(a =>   ({ ...a, _type: 'locked'   as const })),
  ], [filteredUnlocked, filteredLocked]);

  const pct = progress.total > 0 ? Math.round((progress.unlocked / progress.total) * 100) : 0;

  const renderAchievement = useCallback(({ item }: { item: AchievementItem }) => {
    const isLocked = item._type === 'locked';
    return (
      <View
        style={[s.achievementCard, isLocked ? s.achievementLocked : s.achievementUnlocked]}
        accessibilityLabel={`${item.name}: ${item.description}, ${item.points} points, ${isLocked ? 'locked' : 'unlocked'}`}
        accessibilityRole="text"
      >
        <Text style={isLocked ? s.achievementIconLocked : s.achievementIcon} accessibilityElementsHidden>{item.icon}</Text>
        <View style={s.achievementTextWrap}>
          <Text style={isLocked ? s.achievementNameLocked : s.achievementName}>{item.name}</Text>
          <Text style={isLocked ? s.achievementDescriptionLocked : s.achievementDescription}>{item.description}</Text>
        </View>
        <View style={isLocked ? s.achievementPointsLocked : s.achievementPoints}>
          <Text style={isLocked ? s.achievementPointsTextLocked : s.achievementPointsText}>+{item.points} pts</Text>
        </View>
      </View>
    );
  }, []);

  const firstLockedId = filteredLocked[0]?.id;

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <FlatList
      style={s.container}
      contentContainerStyle={s.content}
      data={listData}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={() => (
        <>
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
              <Text style={s.backButton}>← Back</Text>
            </TouchableOpacity>
            <Text style={s.title} accessibilityRole="header">🏆 Achievements</Text>
            <View style={{ width: 50 }} />
          </View>

          <View
            style={s.progressCard}
            accessibilityLabel={`Progress: ${progress.unlocked} of ${progress.total} unlocked, ${progress.points} points, ${pct}% complete`}
          >
            <View style={s.progressStats}>
              {([
                { n: progress.unlocked, l: 'Unlocked', c: '#eee' },
                { n: progress.total,    l: 'Total',    c: '#eee' },
                { n: progress.points,   l: 'Points',   c: '#e67e22' },
              ] as const).map((item, i) => (
                <React.Fragment key={item.l}>
                  {i > 0 && <View style={s.progressDivider} />}
                  <View style={s.progressStat}>
                    <Text style={[s.progressNumber, { color: item.c }]}>{item.n}</Text>
                    <Text style={s.progressLabel}>{item.l}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
            <View style={s.progressBarContainer}>
              <View style={[s.progressBar, { width: `${pct}%` }]} />
            </View>
            <Text style={s.progressPercent}>{pct}% Complete</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.categoryScroll}>
            <TouchableOpacity
              style={[s.categoryChip, !selectedCategory && s.categoryChipActive]}
              onPress={() => setCategory(null)}
              accessibilityLabel="Show all categories"
              accessibilityRole="button"
              accessibilityState={{ selected: !selectedCategory }}
            >
              <Text style={[s.categoryChipText, !selectedCategory && s.categoryChipTextActive]}>All</Text>
            </TouchableOpacity>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[s.categoryChip, selectedCategory === cat && s.categoryChipActive]}
                onPress={() => setCategory(cat)}
                accessibilityLabel={`Filter by ${cat}`}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedCategory === cat }}
              >
                <Text style={[s.categoryChipText, selectedCategory === cat && s.categoryChipTextActive]}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {filteredUnlocked.length > 0 && (
            <Text style={s.sectionTitle} accessibilityRole="header">✅ Unlocked</Text>
          )}
        </>
      )}
      renderItem={({ item }) => {
        const isFirstLocked = item._type === 'locked' && item.id === firstLockedId;
        return (
          <>
            {isFirstLocked && <Text style={s.sectionTitle} accessibilityRole="header">🔒 Locked</Text>}
            {renderAchievement({ item })}
          </>
        );
      }}
      ListEmptyComponent={
        <View style={s.center}>
          <Text style={s.emptyText}>No achievements found</Text>
        </View>
      }
      ListFooterComponent={() => <View style={{ height: 50 }} />}
    />
  );
}

const s = StyleSheet.create({
  container:                    { flex: 1, backgroundColor: '#1a1a2e' },
  center:                       { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  content:                      { padding: 20 },
  emptyText:                    { color: '#666', fontSize: 16 },
  header:                       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  backButton:                   { color: '#53a8b6', fontSize: 16 },
  title:                        { fontSize: 22, fontWeight: 'bold', color: '#eee' },
  progressCard:                 { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 20, borderWidth: 2, borderColor: '#e67e22' },
  progressStats:                { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 15 },
  progressStat:                 { alignItems: 'center' },
  progressNumber:               { fontSize: 28, fontWeight: 'bold' },
  progressLabel:                { fontSize: 12, color: '#888', marginTop: 4 },
  progressDivider:              { width: 1, backgroundColor: '#0f3460' },
  progressBarContainer:         { height: 8, backgroundColor: '#0f3460', borderRadius: 4, overflow: 'hidden' },
  progressBar:                  { height: '100%', backgroundColor: '#5cb85c', borderRadius: 4 },
  progressPercent:              { color: '#888', fontSize: 12, textAlign: 'center', marginTop: 10 },
  categoryScroll:               { marginBottom: 20 },
  categoryChip:                 { backgroundColor: '#16213e', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: '#0f3460' },
  categoryChipActive:           { backgroundColor: '#53a8b6', borderColor: '#53a8b6' },
  categoryChipText:             { color: '#888', fontSize: 14 },
  categoryChipTextActive:       { color: '#fff', fontWeight: '600' },
  sectionTitle:                 { fontSize: 18, fontWeight: 'bold', color: '#eee', marginBottom: 15, marginTop: 10 },
  achievementCard:              { borderRadius: 15, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  achievementUnlocked:          { backgroundColor: '#16213e', borderWidth: 1, borderColor: '#5cb85c' },
  achievementLocked:            { backgroundColor: '#0f3460', opacity: 0.7 },
  achievementIcon:              { fontSize: 36 },
  achievementIconLocked:        { fontSize: 36, opacity: 0.5 },
  achievementTextWrap:          { flex: 1 },
  achievementName:              { fontSize: 16, fontWeight: 'bold', color: '#eee' },
  achievementNameLocked:        { fontSize: 16, fontWeight: 'bold', color: '#666' },
  achievementDescription:       { fontSize: 12, color: '#888', marginTop: 4 },
  achievementDescriptionLocked: { fontSize: 12, color: '#555', marginTop: 4 },
  achievementPoints:            { backgroundColor: '#5cb85c', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  achievementPointsText:        { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  achievementPointsLocked:      { backgroundColor: '#333', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  achievementPointsTextLocked:  { color: '#666', fontSize: 12, fontWeight: 'bold' },
});