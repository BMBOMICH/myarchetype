import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';
import {
    Achievement,
    getAchievementProgress,
    getLockedAchievements,
    getUserAchievements
} from '../utils/achievements';

export default function AchievementsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [unlockedAchievements, setUnlockedAchievements] = useState<Achievement[]>([]);
  const [lockedAchievements, setLockedAchievements] = useState<Achievement[]>([]);
  const [progress, setProgress] = useState({ total: 0, unlocked: 0, points: 0 });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = ['profile', 'social', 'dating', 'safety', 'community'];

  useEffect(() => {
    loadAchievements();
  }, []);

  const loadAchievements = async () => {
    try {
      const unlocked = await getUserAchievements();
      const locked = await getLockedAchievements();
      
      setUnlockedAchievements(unlocked);
      setLockedAchievements(locked);

      const user = auth.currentUser;
      if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const prog = getAchievementProgress(userDoc.data());
          setProgress(prog);
        }
      }
    } catch (error) {
      console.error('Error loading achievements:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredAchievements = (achievements: Achievement[]): Achievement[] => {
    if (!selectedCategory) return achievements;
    return achievements.filter(a => a.category === selectedCategory);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🏆 Achievements</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Progress Card */}
      <View style={styles.progressCard}>
        <View style={styles.progressStats}>
          <View style={styles.progressStat}>
            <Text style={styles.progressNumber}>{progress.unlocked}</Text>
            <Text style={styles.progressLabel}>Unlocked</Text>
          </View>
          <View style={styles.progressDivider} />
          <View style={styles.progressStat}>
            <Text style={styles.progressNumber}>{progress.total}</Text>
            <Text style={styles.progressLabel}>Total</Text>
          </View>
          <View style={styles.progressDivider} />
          <View style={styles.progressStat}>
            <Text style={[styles.progressNumber, styles.pointsNumber]}>{progress.points}</Text>
            <Text style={styles.progressLabel}>Points</Text>
          </View>
        </View>
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBar, { width: `${(progress.unlocked / progress.total) * 100}%` }]} />
        </View>
        <Text style={styles.progressPercent}>
          {Math.round((progress.unlocked / progress.total) * 100)}% Complete
        </Text>
      </View>

      {/* Category Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
        <TouchableOpacity
          style={[styles.categoryChip, !selectedCategory && styles.categoryChipActive]}
          onPress={() => setSelectedCategory(null)}
        >
          <Text style={[styles.categoryChipText, !selectedCategory && styles.categoryChipTextActive]}>
            All
          </Text>
        </TouchableOpacity>
        {categories.map(cat => (
          <TouchableOpacity
            key={cat}
            style={[styles.categoryChip, selectedCategory === cat && styles.categoryChipActive]}
            onPress={() => setSelectedCategory(cat)}
          >
            <Text style={[styles.categoryChipText, selectedCategory === cat && styles.categoryChipTextActive]}>
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Unlocked Achievements */}
      {getFilteredAchievements(unlockedAchievements).length > 0 && (
        <>
          <Text style={styles.sectionTitle}>✅ Unlocked</Text>
          <View style={styles.achievementsGrid}>
            {getFilteredAchievements(unlockedAchievements).map(achievement => (
              <View key={achievement.id} style={[styles.achievementCard, styles.achievementUnlocked]}>
                <Text style={styles.achievementIcon}>{achievement.icon}</Text>
                <Text style={styles.achievementName}>{achievement.name}</Text>
                <Text style={styles.achievementDescription}>{achievement.description}</Text>
                <View style={styles.achievementPoints}>
                  <Text style={styles.achievementPointsText}>+{achievement.points} pts</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Locked Achievements */}
      {getFilteredAchievements(lockedAchievements).length > 0 && (
        <>
          <Text style={styles.sectionTitle}>🔒 Locked</Text>
          <View style={styles.achievementsGrid}>
            {getFilteredAchievements(lockedAchievements).map(achievement => (
              <View key={achievement.id} style={[styles.achievementCard, styles.achievementLocked]}>
                <Text style={styles.achievementIconLocked}>{achievement.icon}</Text>
                <Text style={styles.achievementNameLocked}>{achievement.name}</Text>
                <Text style={styles.achievementDescriptionLocked}>{achievement.description}</Text>
                <View style={styles.achievementPointsLocked}>
                  <Text style={styles.achievementPointsTextLocked}>+{achievement.points} pts</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      <View style={{ height: 50 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  backButton: { color: '#53a8b6', fontSize: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#eee' },

  progressCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 20, marginBottom: 20, borderWidth: 2, borderColor: '#e67e22' },
  progressStats: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 15 },
  progressStat: { alignItems: 'center' },
  progressNumber: { fontSize: 28, fontWeight: 'bold', color: '#eee' },
  pointsNumber: { color: '#e67e22' },
  progressLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  progressDivider: { width: 1, backgroundColor: '#0f3460' },
  progressBarContainer: { height: 8, backgroundColor: '#0f3460', borderRadius: 4, overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: '#5cb85c', borderRadius: 4 },
  progressPercent: { color: '#888', fontSize: 12, textAlign: 'center', marginTop: 10 },

  categoryScroll: { marginBottom: 20 },
  categoryChip: { backgroundColor: '#16213e', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: '#0f3460' },
  categoryChipActive: { backgroundColor: '#53a8b6', borderColor: '#53a8b6' },
  categoryChipText: { color: '#888', fontSize: 14 },
  categoryChipTextActive: { color: '#fff', fontWeight: '600' },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#eee', marginBottom: 15, marginTop: 10 },

  achievementsGrid: { gap: 12 },
  achievementCard: { borderRadius: 15, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  achievementUnlocked: { backgroundColor: '#16213e', borderWidth: 1, borderColor: '#5cb85c' },
  achievementLocked: { backgroundColor: '#0f3460', opacity: 0.7 },
  achievementIcon: { fontSize: 36 },
  achievementIconLocked: { fontSize: 36, opacity: 0.5 },
  achievementName: { fontSize: 16, fontWeight: 'bold', color: '#eee', flex: 1 },
  achievementNameLocked: { fontSize: 16, fontWeight: 'bold', color: '#666', flex: 1 },
  achievementDescription: { fontSize: 12, color: '#888', position: 'absolute', bottom: 16, left: 64 },
  achievementDescriptionLocked: { fontSize: 12, color: '#555', position: 'absolute', bottom: 16, left: 64 },
  achievementPoints: { backgroundColor: '#5cb85c', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  achievementPointsText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  achievementPointsLocked: { backgroundColor: '#333', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  achievementPointsTextLocked: { color: '#666', fontSize: 12, fontWeight: 'bold' },
});