import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, ScrollView, StyleSheet,
  Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';
import {
  autoReorderPhotos, getPhotoPerformanceLabel,
  getPhotoStats, PhotoStats, toggleSmartPhotos,
} from '../utils/smartPhotos';

export default function SmartPhotosScreen() {
  const router = useRouter();
  const [loading, setLoading]                   = useState(true);
  const [photoStats, setPhotoStats]             = useState<PhotoStats[]>([]);
  const [smartPhotosEnabled, setSmartEnabled]   = useState(false);
  const [optimizing, setOptimizing]             = useState(false);

  const loadData = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) setSmartEnabled(userDoc.data().smartPhotosEnabled ?? false);
      setPhotoStats(await getPhotoStats(user.uid));
    } catch (error) {
      logger.error('[SmartPhotos] load error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleOptimize = useCallback(async () => {
    setOptimizing(true);
    try {
      const result = await autoReorderPhotos();
      if (result.reordered) {
        alert('Photos have been reordered for better performance!');
        void loadData();
      } else {
        alert('Your photos are already in optimal order!');
      }
    } finally {
      setOptimizing(false);
    }
  }, [loadData]);

  const handleToggle = useCallback(async (enabled: boolean) => {
    setSmartEnabled(enabled);
    await toggleSmartPhotos(enabled);
    if (enabled) void handleOptimize();
  }, [handleOptimize]);

  if (loading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={s.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header">📊 Smart Photos</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={s.infoCard}>
        <Text style={s.infoTitle}>What is Smart Photos?</Text>
        <Text style={s.infoText}>We analyze which of your photos get the most right swipes and automatically reorder them for better match rates!</Text>
      </View>

      <View style={s.toggleContainer}>
        <View style={s.toggleTextWrap}>
          <Text style={s.toggleLabel}>Auto-Optimize Photos</Text>
          <Text style={s.toggleDesc}>Automatically reorder photos based on performance</Text>
        </View>
        <Switch
          value={smartPhotosEnabled}
          onValueChange={handleToggle}
          trackColor={{ false: '#555', true: '#53a8b6' }}
          thumbColor="#fff"
          accessibilityLabel="Toggle auto-optimize photos"
          accessibilityRole="switch"
        />
      </View>

      <TouchableOpacity
        style={[s.optimizeBtn, optimizing && s.optimizeBtnDisabled]}
        onPress={handleOptimize}
        disabled={optimizing}
        accessibilityLabel={optimizing ? 'Optimizing photos' : 'Optimize photos now'}
        accessibilityRole="button"
        accessibilityState={{ disabled: optimizing }}
      >
        <Text style={s.optimizeBtnText}>{optimizing ? 'Optimizing...' : '✨ Optimize Now'}</Text>
      </TouchableOpacity>

      <Text style={s.sectionTitle} accessibilityRole="header">Photo Performance</Text>

      {photoStats.length === 0 ? (
        <View style={s.noDataContainer}>
          <Text style={s.noDataText}>No photo data yet. Keep using the app to collect insights!</Text>
        </View>
      ) : (
        <View style={s.photoGrid}>
          {photoStats.map((stat, index) => {
            const { label, color } = getPhotoPerformanceLabel(stat.score);
            return (
              <View
                key={index}
                style={s.photoCard}
                accessibilityLabel={`Photo ${index + 1}: ${label}, score ${stat.score}%, ${stat.impressions} impressions, ${stat.rightSwipes} right swipes`}
              >
                <Image
                  source={{ uri: stat.photoUrl }}
                  style={s.photoImage}
                  accessibilityLabel={`Your photo ${index + 1}`}
                />
                <View style={s.photoStatsWrap}>
                  <View style={[s.perfBadge, { backgroundColor: color }]}>
                    <Text style={s.perfBadgeText}>{label}</Text>
                  </View>
                  {[
                    { icon: '👀', label: 'Impressions', val: stat.impressions },
                    { icon: '➡️', label: 'Right Swipes', val: stat.rightSwipes },
                    { icon: '⬅️', label: 'Left Swipes',  val: stat.leftSwipes  },
                    { icon: '💝', label: 'Super Likes',  val: stat.superLikes  },
                  ].map((row) => (
                    <View key={row.label} style={s.statRow}>
                      <Text style={s.statLabel} accessibilityElementsHidden>{row.icon} </Text>
                      <Text style={s.statLabel}>{row.label}</Text>
                      <Text style={s.statValue}>{row.val}</Text>
                    </View>
                  ))}
                  <View style={s.scoreRow}>
                    <Text style={s.scoreLabel}>Score</Text>
                    <Text style={[s.scoreValue, { color }]}>{stat.score}%</Text>
                  </View>
                </View>
                {index === 0 && (
                  <View style={s.primaryBadge}>
                    <Text style={s.primaryBadgeText}>Main Photo</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View style={s.tipsContainer}>
        <Text style={s.tipsTitle}>💡 Photo Tips</Text>
        {[
          'Your first photo should be a clear face shot',
          'Include at least one full-body photo',
          'Show your hobbies and interests',
          'Avoid group photos as your main',
          'Natural lighting works best',
        ].map((tip) => (
          <Text key={tip} style={s.tipText}>• {tip}</Text>
        ))}
      </View>

      <View style={{ height: 50 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#1a1a2e' },
  content:          { padding: 20 },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  backButton:       { color: '#53a8b6', fontSize: 16 },
  title:            { fontSize: 20, fontWeight: 'bold', color: '#eee' },
  infoCard:         { backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#53a8b6' },
  infoTitle:        { color: '#53a8b6', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  infoText:         { color: '#888', fontSize: 14, lineHeight: 20 },
  toggleContainer:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginBottom: 20 },
  toggleTextWrap:   { flex: 1, marginRight: 15 },
  toggleLabel:      { color: '#eee', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  toggleDesc:       { color: '#888', fontSize: 13 },
  optimizeBtn:      { backgroundColor: '#e67e22', paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginBottom: 25 },
  optimizeBtnDisabled: { backgroundColor: '#555' },
  optimizeBtnText:  { color: '#fff', fontSize: 18, fontWeight: '600' },
  sectionTitle:     { color: '#eee', fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  noDataContainer:  { backgroundColor: '#16213e', borderRadius: 15, padding: 30, alignItems: 'center' },
  noDataText:       { color: '#888', fontSize: 14, textAlign: 'center' },
  photoGrid:        { gap: 15 },
  photoCard:        { backgroundColor: '#16213e', borderRadius: 15, overflow: 'hidden', position: 'relative' },
  photoImage:       { width: '100%', height: 200, resizeMode: 'cover' },
  photoStatsWrap:   { padding: 15 },
  perfBadge:        { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12, marginBottom: 12 },
  perfBadgeText:    { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  statRow:          { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel:        { color: '#888', fontSize: 14 },
  statValue:        { color: '#eee', fontSize: 14, fontWeight: '600' },
  scoreRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#0f3460', marginTop: 8 },
  scoreLabel:       { color: '#53a8b6', fontSize: 16, fontWeight: '600' },
  scoreValue:       { fontSize: 20, fontWeight: 'bold' },
  primaryBadge:     { position: 'absolute', top: 10, left: 10, backgroundColor: '#5cb85c', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  primaryBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  tipsContainer:    { backgroundColor: '#16213e', borderRadius: 15, padding: 16, marginTop: 20 },
  tipsTitle:        { color: '#53a8b6', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  tipText:          { color: '#888', fontSize: 14, marginBottom: 6 },
});