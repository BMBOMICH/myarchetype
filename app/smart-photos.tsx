import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebaseConfig';
import {
    autoReorderPhotos,
    getPhotoPerformanceLabel,
    getPhotoStats,
    PhotoStats,
    toggleSmartPhotos,
} from '../utils/smartPhotos';

export default function SmartPhotosScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [photoStats, setPhotoStats] = useState<PhotoStats[]>([]);
  const [smartPhotosEnabled, setSmartPhotosEnabled] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        setSmartPhotosEnabled(userDoc.data().smartPhotosEnabled || false);
      }

      const stats = await getPhotoStats(user.uid);
      setPhotoStats(stats);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSmartPhotos = async (enabled: boolean) => {
    setSmartPhotosEnabled(enabled);
    await toggleSmartPhotos(enabled);

    if (enabled) {
      handleOptimize();
    }
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    const result = await autoReorderPhotos();
    setOptimizing(false);

    if (result.reordered) {
      alert('Photos have been reordered for better performance!');
      loadData(); // Reload stats
    } else {
      alert('Your photos are already in optimal order!');
    }
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
        <Text style={styles.title}>📊 Smart Photos</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Info Card */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>What is Smart Photos?</Text>
        <Text style={styles.infoText}>
          We analyze which of your photos get the most right swipes and automatically reorder them for better match rates!
        </Text>
      </View>

      {/* Toggle */}
      <View style={styles.toggleContainer}>
        <View style={styles.toggleTextContainer}>
          <Text style={styles.toggleLabel}>Auto-Optimize Photos</Text>
          <Text style={styles.toggleDescription}>
            Automatically reorder photos based on performance
          </Text>
        </View>
        <Switch
          value={smartPhotosEnabled}
          onValueChange={handleToggleSmartPhotos}
          trackColor={{ false: '#555', true: '#53a8b6' }}
          thumbColor="#fff"
        />
      </View>

      {/* Optimize Button */}
      <TouchableOpacity
        style={[styles.optimizeButton, optimizing && styles.optimizeButtonDisabled]}
        onPress={handleOptimize}
        disabled={optimizing}
      >
        <Text style={styles.optimizeButtonText}>
          {optimizing ? 'Optimizing...' : '✨ Optimize Now'}
        </Text>
      </TouchableOpacity>

      {/* Photo Stats */}
      <Text style={styles.sectionTitle}>Photo Performance</Text>

      {photoStats.length === 0 ? (
        <View style={styles.noDataContainer}>
          <Text style={styles.noDataText}>
            No photo data yet. Keep using the app to collect insights!
          </Text>
        </View>
      ) : (
        <View style={styles.photoGrid}>
          {photoStats.map((stat, index) => {
            const { label, color } = getPhotoPerformanceLabel(stat.score);

            return (
              <View key={index} style={styles.photoCard}>
                <Image source={{ uri: stat.photoUrl }} style={styles.photoImage} />
                
                <View style={styles.photoStatsContainer}>
                  <View style={[styles.performanceBadge, { backgroundColor: color }]}>
                    <Text style={styles.performanceBadgeText}>{label}</Text>
                  </View>

                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>👀 Impressions</Text>
                    <Text style={styles.statValue}>{stat.impressions}</Text>
                  </View>

                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>➡️ Right Swipes</Text>
                    <Text style={styles.statValue}>{stat.rightSwipes}</Text>
                  </View>

                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>⬅️ Left Swipes</Text>
                    <Text style={styles.statValue}>{stat.leftSwipes}</Text>
                  </View>

                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>💝 Super Likes</Text>
                    <Text style={styles.statValue}>{stat.superLikes}</Text>
                  </View>

                  <View style={styles.scoreRow}>
                    <Text style={styles.scoreLabel}>Score</Text>
                    <Text style={[styles.scoreValue, { color }]}>{stat.score}%</Text>
                  </View>
                </View>

                {index === 0 && (
                  <View style={styles.primaryBadge}>
                    <Text style={styles.primaryBadgeText}>Main Photo</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Tips */}
      <View style={styles.tipsContainer}>
        <Text style={styles.tipsTitle}>💡 Photo Tips</Text>
        <Text style={styles.tipText}>• Your first photo should be a clear face shot</Text>
        <Text style={styles.tipText}>• Include at least one full-body photo</Text>
        <Text style={styles.tipText}>• Show your hobbies and interests</Text>
        <Text style={styles.tipText}>• Avoid group photos as your main</Text>
        <Text style={styles.tipText}>• Natural lighting works best</Text>
      </View>

      <View style={{ height: 50 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  backButton: { color: '#53a8b6', fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#eee' },

  infoCard: { backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#53a8b6' },
  infoTitle: { color: '#53a8b6', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  infoText: { color: '#888', fontSize: 14, lineHeight: 20 },

  toggleContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginBottom: 20 },
  toggleTextContainer: { flex: 1, marginRight: 15 },
  toggleLabel: { color: '#eee', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  toggleDescription: { color: '#888', fontSize: 13 },

  optimizeButton: { backgroundColor: '#e67e22', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginBottom: 25 },
  optimizeButtonDisabled: { backgroundColor: '#555' },
  optimizeButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },

  sectionTitle: { color: '#eee', fontSize: 18, fontWeight: 'bold', marginBottom: 15 },

  noDataContainer: { backgroundColor: '#16213e', borderRadius: 15, padding: 30, alignItems: 'center' },
  noDataText: { color: '#888', fontSize: 14, textAlign: 'center' },

  photoGrid: { gap: 15 },
  photoCard: { backgroundColor: '#16213e', borderRadius: 15, overflow: 'hidden', position: 'relative' },
  photoImage: { width: '100%', height: 200, resizeMode: 'cover' },
  photoStatsContainer: { padding: 15 },
  performanceBadge: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12, marginBottom: 12 },
  performanceBadgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel: { color: '#888', fontSize: 14 },
  statValue: { color: '#eee', fontSize: 14, fontWeight: '600' },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#0f3460', marginTop: 8 },
  scoreLabel: { color: '#53a8b6', fontSize: 16, fontWeight: '600' },
  scoreValue: { fontSize: 20, fontWeight: 'bold' },
  primaryBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: '#5cb85c', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  primaryBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },

  tipsContainer: { backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginTop: 20 },
  tipsTitle: { color: '#53a8b6', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  tipText: { color: '#888', fontSize: 14, marginBottom: 6 },
});