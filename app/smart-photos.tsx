import { LegendList, LegendListRenderItemProps } from '@legendapp/list';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import TurboImage from '../src/components/TurboImage';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';
import {
  autoReorderPhotos,
  getPhotoPerformanceLabel,
  getPhotoStats,
  PhotoStats,
  toggleSmartPhotos,
} from '../utils/smartPhotos';

const LOCAL = {
  white:        '#ffffff',
  success:      '#5cb85c',
  warning:      '#e67e22',
  headerSpacer: 50,
} as const;

const STAT_ROWS = [
  { icon: '👀', label: 'Impressions',  key: 'impressions'  },
  { icon: '➡️', label: 'Right Swipes', key: 'rightSwipes'  },
  { icon: '⬅️', label: 'Left Swipes',  key: 'leftSwipes'   },
  { icon: '💝', label: 'Super Likes',  key: 'superLikes'   },
] as const;

export default function SmartPhotosScreen() {
  const router = useRouter();

  const [loading,            setLoading]    = useState(true);
  const [photoStats,         setPhotoStats] = useState<PhotoStats[]>([]);
  const [smartPhotosEnabled, setSmartEnabled] = useState(false);
  const [optimizing,         setOptimizing] = useState(false);
  const isMounted                           = useRef(true);

  const loadData = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!isMounted.current) return;
      if (userDoc.exists()) setSmartEnabled(userDoc.data().smartPhotosEnabled ?? false);
      const stats = await getPhotoStats(user.uid);
      if (!isMounted.current) return;
      setPhotoStats(stats);
    } catch (error) {
      logger.error('[SmartPhotos] load error:', error);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  const optimizeBtnStyle = useMemo(
    () => [s.optimizeBtn, optimizing && s.optimizeBtnDisabled],
    [optimizing],
  );

  useEffect(() => {
    isMounted.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void loadData();
    });
    return () => {
      isMounted.current = false;
      task.cancel();
    };
  }, [loadData]);

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

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      setSmartEnabled(enabled);
      await toggleSmartPhotos(enabled);
      if (enabled) void handleOptimize();
    },
    [handleOptimize],
  );

  const renderPhotoCard = useCallback(
    ({ item: stat, index }: LegendListRenderItemProps<PhotoStats>) => {
      const { label, color } = getPhotoPerformanceLabel(stat.score);
      const perfBadgeStyle = [s.perfBadge, { backgroundColor: color }];
      const scoreValueStyle = [s.scoreValue, { color }];
      return (
        <View
          style={s.photoCard}
          accessibilityLabel={`Photo ${index + 1}: ${label}, score ${stat.score}%, ${stat.impressions} impressions, ${stat.rightSwipes} right swipes`}
        >
          <TurboImage
            source={{ uri: stat.photoUrl }}
            style={s.photoImage}
            cachePolicy="dataCache"
            resizeMode="cover"
            accessibilityLabel={`Your photo ${index + 1}`}
          />

          <View style={s.photoStatsWrap}>
            <View style={perfBadgeStyle}>
              <Text style={s.perfBadgeText}>{label}</Text>
            </View>

            {STAT_ROWS.map((row) => (
              <View key={row.label} style={s.statRow}>
                <Text style={s.statLabel} accessibilityElementsHidden>
                  {row.icon}{' '}
                </Text>
                <Text style={s.statLabel}>{row.label}</Text>
                <Text style={s.statValue}>{stat[row.key]}</Text>
              </View>
            ))}

            <View style={s.scoreRow}>
              <Text style={s.scoreLabel}>Score</Text>
              <Text style={scoreValueStyle}>{stat.score}%</Text>
            </View>
          </View>

          {index === 0 && (
            <View style={s.primaryBadge}>
              <Text style={s.primaryBadgeText}>Main Photo</Text>
            </View>
          )}
        </View>
      );
    },
    [],
  );

  const photoKeyExtractor = useCallback(
    (_: PhotoStats, index: number) => String(index),
    [],
  );

  if (loading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  const ListHeader = (
    <>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={s.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header">📊 Smart Photos</Text>
        <View style={s.headerSpacer} />
      </View>

      <View style={s.infoCard}>
        <Text style={s.infoTitle}>What is Smart Photos?</Text>
        <Text style={s.infoText}>
          We analyze which of your photos get the most right swipes and
          automatically reorder them for better match rates!
        </Text>
      </View>

      <View style={s.toggleContainer}>
        <View style={s.toggleTextWrap}>
          <Text style={s.toggleLabel}>Auto-Optimize Photos</Text>
          <Text style={s.toggleDesc}>
            Automatically reorder photos based on performance
          </Text>
        </View>
        <Switch
          value={smartPhotosEnabled}
          onValueChange={handleToggle}
          trackColor={{ false: '#555', true: '#53a8b6' }}
          thumbColor={LOCAL.white}
          accessibilityLabel="Toggle auto-optimize photos"
          accessibilityRole="switch"
        />
      </View>

      <TouchableOpacity
        style={optimizeBtnStyle}
        onPress={handleOptimize}
        disabled={optimizing}
        accessibilityLabel={optimizing ? 'Optimizing photos' : 'Optimize photos now'}
        accessibilityRole="button"
        accessibilityState={{ disabled: optimizing }}
      >
        <Text style={s.optimizeBtnText}>
          {optimizing ? 'Optimizing...' : '✨ Optimize Now'}
        </Text>
      </TouchableOpacity>

      <Text style={s.sectionTitle} accessibilityRole="header">Photo Performance</Text>

      {photoStats.length === 0 && (
        <View style={s.noDataContainer}>
          <Text style={s.noDataText}>
            No photo data yet. Keep using the app to collect insights!
          </Text>
        </View>
      )}
    </>
  );

  const ListFooter = (
    <>
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
      <View style={s.bottomSpacer} />
    </>
  );

  return (
    <LegendList
      data={photoStats}
      keyExtractor={photoKeyExtractor}
      renderItem={renderPhotoCard}
      estimatedItemSize={320}
      recycleItems={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.content}
      ListHeaderComponent={ListHeader}
      ListFooterComponent={ListFooter}
    />
  );
}

const s = StyleSheet.create((theme) => ({
  container:           { flex: 1, backgroundColor: theme.colors.background },
  content:             { padding: 20, backgroundColor: theme.colors.background },

  header:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  backButton:          { color: theme.colors.primary, fontSize: 16 },
  title:               { fontSize: 20, fontWeight: 'bold', color: theme.colors.text },
  headerSpacer:        { width: LOCAL.headerSpacer },

  infoCard:            { backgroundColor: theme.colors.surface, borderRadius: 15, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: theme.colors.primary },
  infoTitle:           { color: theme.colors.primary, fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  infoText:            { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },

  toggleContainer:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 15, padding: 16, marginBottom: 20 },
  toggleTextWrap:      { flex: 1, marginRight: 15 },
  toggleLabel:         { color: theme.colors.text, fontSize: 16, fontWeight: '600', marginBottom: 4 },
  toggleDesc:          { color: theme.colors.textSecondary, fontSize: 13 },

  optimizeBtn:         { backgroundColor: LOCAL.warning, paddingVertical: 16, borderRadius: 25, alignItems: 'center', marginBottom: 25 },
  optimizeBtnDisabled: { backgroundColor: '#555' },
  optimizeBtnText:     { color: LOCAL.white, fontSize: 18, fontWeight: '600' },

  sectionTitle:        { color: theme.colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 15 },

  noDataContainer:     { backgroundColor: theme.colors.surface, borderRadius: 15, padding: 30, alignItems: 'center' },
  noDataText:          { color: theme.colors.textSecondary, fontSize: 14, textAlign: 'center' },

  photoCard:           { backgroundColor: theme.colors.surface, borderRadius: 15, overflow: 'hidden', position: 'relative', marginBottom: 15 },
  photoImage:          { width: '100%', height: 200 },

  photoStatsWrap:      { padding: 15 },
  perfBadge:           { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12, marginBottom: 12 },
  perfBadgeText:       { color: LOCAL.white, fontSize: 12, fontWeight: 'bold' },

  statRow:             { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel:           { color: theme.colors.textSecondary, fontSize: 14 },
  statValue:           { color: theme.colors.text, fontSize: 14, fontWeight: '600' },

  scoreRow:            { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 8 },
  scoreLabel:          { color: theme.colors.primary, fontSize: 16, fontWeight: '600' },
  scoreValue:          { fontSize: 20, fontWeight: 'bold' },

  primaryBadge:        { position: 'absolute', top: 10, left: 10, backgroundColor: LOCAL.success, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  primaryBadgeText:    { color: LOCAL.white, fontSize: 11, fontWeight: 'bold' },

  tipsContainer:       { backgroundColor: theme.colors.surface, borderRadius: 15, padding: 16, marginTop: 20 },
  tipsTitle:           { color: theme.colors.primary, fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  tipText:             { color: theme.colors.textSecondary, fontSize: 14, marginBottom: 6 },

  bottomSpacer:        { height: 50 },
}));