import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { observable } from '@legendapp/state';
import { observer } from '@legendapp/state/react';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  InteractionManager,
  Modal,
  Platform,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import TurboImage from 'react-native-turbo-image';
import { StyleSheet } from 'react-native-unistyles';
import { auth } from '../firebaseConfig';
import { logger } from '../utils/logger';
import { checkImageSafety } from '../utils/moderation';
import {
  type Story,
  type StoryGroup,
  createStory,
  deleteStory,
  getActiveStories,
  getStoryTimeRemaining,
  groupStoriesByUser,
  markStoryViewed,
} from '../utils/stories';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORY_VIEW_MS     = 5_000;
const TOP_INSET         = Platform.OS === 'ios' ? 60 : 50;
const CIRCLE_ITEM_WIDTH = 80 + 15; // width + gap

const LOCAL = {
  black:        '#000000',
  white:        '#ffffff',
  ring:         '#e67e22',
  ringViewed:   '#555555',
  progressBg:   'rgba(255,255,255,0.3)',
  overlay:      'rgba(0,0,0,0.8)',
  overlayDense: 'rgba(0,0,0,0.9)',
  overlayLight: 'rgba(0,0,0,0.7)',
  dangerBg:     'rgba(217,83,79,0.9)',
  vHeadTime:    '#dddddd',
  accent:       '#5cb85c',
} as const;

const screen$ = observable({
  loading:    true,
  stories:    [] as Story[],
  storyIndex: 0,
  viewerOpen: false,
  createOpen: false,
  uploading:  false,
});


const StoryVideo = React.memo(function StoryVideo({
  uri, style,
}: { uri: string; style: ViewStyle }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      nativeControls={false}
    />
  );
});


interface StoryCircleProps {
  item:    StoryGroup;
  uid:     string | undefined;
  onPress: (group: StoryGroup) => void;
}

const StoryCircle = React.memo(function StoryCircle({
  item: g, uid, onPress,
}: StoryCircleProps) {
  const own        = g.userId === uid;
  const firstStory = g.stories[0];

  const handlePress = useCallback(() => onPress(g), [onPress, g]);

  return (
    <TouchableOpacity
      style={styles.circle}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${g.userName}'s story${g.hasUnviewed ? ', new' : ''}`}
      accessibilityRole="button"
    >
      <View style={[styles.ring, !own && !g.hasUnviewed && styles.ringViewed]}>
        {g.userPhoto ? (
          <TurboImage
            source={{ uri: g.userPhoto }}
            style={styles.circleImg}
            cachePolicy="dataCache"
            accessibilityLabel={`${g.userName}'s photo`}
          />
        ) : (
          <View style={[styles.circleImg, styles.placeholder]}>
            <Text style={styles.placeholderEmoji} accessibilityElementsHidden>👤</Text>
          </View>
        )}
      </View>
      <Text style={styles.circleName} numberOfLines={1}>{g.userName}</Text>
      {own && firstStory != null && (
        <Text style={styles.circleMeta}>
          {g.stories.length} · {getStoryTimeRemaining(firstStory.expiresAt)}
        </Text>
      )}
    </TouchableOpacity>
  );
});


export default observer(function StoriesScreen() {
  const router = useRouter();
  const uid    = auth.currentUser?.uid;

  const progressAnim = useSharedValue(0);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef     = useRef(0);

  const stories    = screen$.stories.get();
  const storyIndex = screen$.storyIndex.get();
  const viewerOpen = screen$.viewerOpen.get();
  const createOpen = screen$.createOpen.get();
  const uploading  = screen$.uploading.get();
  const loading    = screen$.loading.get();

  indexRef.current = storyIndex;

  const currentStory: Story | undefined = stories[storyIndex];

  const storyGroups: StoryGroup[] = uid
    ? groupStoriesByUser(stories, uid)
    : [];

  const loadStories = useCallback(async () => {
    if (!uid) return;
    try {
      const data = await getActiveStories(uid);
      screen$.stories.set(data);
    } catch (e) {
      logger.error('[StoriesScreen] load:', e);
    } finally {
      screen$.loading.set(false);
    }
  }, [uid]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      void loadStories();
    }, []);
    return () => task.cancel();
  }, [loadStories]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    cancelAnimation(progressAnim);
    progressAnim.value = 0;
  }, [progressAnim]);

  const goNext = useCallback(() => {
    clearTimers();
    const idx = indexRef.current;
    if (idx < stories.length - 1) {
      screen$.storyIndex.set(idx + 1);
    } else {
      screen$.viewerOpen.set(false);
      screen$.storyIndex.set(0);
    }
  }, [clearTimers, stories.length]);

  const goPrev = useCallback(() => {
    clearTimers();
    screen$.storyIndex.set(Math.max(0, indexRef.current - 1));
  }, [clearTimers]);

  const startTimer = useCallback(() => {
    clearTimers();
    progressAnim.value = 0;
    progressAnim.value = withTiming(1, { duration: STORY_VIEW_MS });
    timerRef.current   = setTimeout(goNext, STORY_VIEW_MS);
  }, [clearTimers, progressAnim, goNext]);

  useEffect(() => {
    if (viewerOpen && stories.length > 0) startTimer();
    return clearTimers;
  }, [viewerOpen, storyIndex, startTimer, clearTimers, stories.length]);

  useEffect(() => {
    if (!viewerOpen || !currentStory || !uid) return;
    if (currentStory.userId !== uid) {
      markStoryViewed(currentStory.id).catch(() => {}, []);
    }
  }, [viewerOpen, currentStory, uid]);

  const closeViewer = useCallback(() => {
    clearTimers();
    screen$.viewerOpen.set(false);
    screen$.storyIndex.set(0);
  }, [clearTimers]);

  useEffect(() => {
    if (!viewerOpen) return;
  // FIXME: add removeEventListener cleanup for the listener below
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeViewer();
      return true;
    }, []);
    return () => sub.remove();
  }, [viewerOpen, closeViewer]);

  const openGroup = useCallback((group: StoryGroup) => {
    const firstStory = group.stories[0];
    if (!firstStory) return;
    const idx = stories.findIndex((s) => s.id === firstStory.id);
    if (idx < 0) return;
    screen$.storyIndex.set(idx);
    screen$.viewerOpen.set(true);
  }, [stories]);

  const handleTap = useCallback((x: number) => {
    if (x < SCREEN_WIDTH / 3) goPrev(); else goNext();
  }, [goPrev, goNext]);

  const handleOpenCreate  = useCallback(() => screen$.createOpen.set(true),  []);
  const handleCloseCreate = useCallback(() => screen$.createOpen.set(false), []);
  const handleBack        = useCallback(() => router.back(),                 [router]);

  const pickMedia = useCallback(async (camera: boolean) => {
    try {
      if (camera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Camera access is needed to take photos and videos.');
          return;
        }
      }
      const launch = camera
        ? ImagePicker.launchCameraAsync
        : ImagePicker.launchImageLibraryAsync;
      const result = await launch({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 15,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const type: 'photo' | 'video' = asset.type === 'video' ? 'video' : 'photo';
      screen$.createOpen.set(false);
      if (type === 'photo') {
        const safety = await checkImageSafety(asset.uri);
        if (!safety.safe) { Alert.alert('Content Not Allowed', safety.reason); return; }
      }
      screen$.uploading.set(true);
      const res = await createStory(asset.uri, type);
      screen$.uploading.set(false);
      if (res.success) {
        Alert.alert('Story Posted!', 'Your story is live for 24 hours.');
        void loadStories();
      } else {
        Alert.alert('Upload Failed', res.error ?? 'Please try again.');
      }
    } catch (err) {
      screen$.uploading.set(false);
      logger.error('[StoriesScreen] pickMedia:', err);
      Alert.alert('Error', 'Could not process media.');
    }
  }, [loadStories]);

  const handlePickCamera  = useCallback(() => void pickMedia(true),  [pickMedia]);
  const handlePickLibrary = useCallback(() => void pickMedia(false), [pickMedia]);

  const confirmDelete = useCallback((id: string) => {
    Alert.alert('Delete Story', 'Are you sure you want to delete this story?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const res = await deleteStory(id);
          if (res.success) { closeViewer(); void loadStories(); }
          else { Alert.alert('Error', res.error ?? 'Could not delete story.'); }
        },
      },
    ]);
  }, [closeViewer, loadStories]);

  const renderCircle = useCallback(
    ({ item: g }: LegendListRenderItemProps<StoryGroup>) => (
      <StoryCircle item={g} uid={uid} onPress={openGroup} />
    ),
    [uid, openGroup],
  );

  const circleKey = useCallback((g: StoryGroup) => g.userId, []);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressAnim.value * 100}%` as `${number}%`,
  }));

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingTxt}>Loading stories...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={styles.headerBack}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} accessibilityRole="header">Stories</Text>
        <TouchableOpacity
          onPress={handleOpenCreate}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Add story"
          accessibilityRole="button"
        >
          <Text style={styles.headerAdd}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {storyGroups.length > 0 && (
        <LegendList
          data={storyGroups}
          keyExtractor={circleKey}
          renderItem={renderCircle}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.circlesRow}
          style={styles.circlesWrap}
          estimatedItemSize={CIRCLE_ITEM_WIDTH}
          recycleItems={true}
        />
      )}

      {stories.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon} accessibilityElementsHidden>📖</Text>
          <Text style={styles.emptyTitle} accessibilityRole="header">No Stories Yet</Text>
          <Text style={styles.emptyText}>Be the first to share a moment!</Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={handleOpenCreate}
            activeOpacity={0.8}
            accessibilityLabel="Create story"
            accessibilityRole="button"
          >
            <Text style={styles.emptyBtnTxt}>+ Create Story</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Story viewer modal ─────────────────────────────────────────── */}
      <Modal
        visible={viewerOpen && currentStory != null}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeViewer}
      >
        {currentStory != null && (
          <View style={styles.viewer}>
            {/* Progress bars */}
            <View style={styles.progRow}>
              {stories.map((_, i) => (
                <View key={`prog_${i}`} style={styles.progBg}>
                  {i === storyIndex ? (
                    <Animated.View style={[styles.progFill, progressStyle]} />
                  ) : i < storyIndex ? (
                    <View style={styles.progDone} />
                  ) : null}
                </View>
              ))}
            </View>

            {/* Header */}
            <View style={styles.vHead}>
              {currentStory.userPhoto ? (
                <TurboImage
                  source={{ uri: currentStory.userPhoto }}
                  style={styles.vHeadImg}
                  cachePolicy="dataCache"
                  accessibilityLabel={`${currentStory.userId === uid ? 'Your' : currentStory.userName + "'s"} photo`}
                />
              ) : (
                <View style={[styles.vHeadImg, styles.placeholder]}>
                  <Text style={styles.placeholderEmoji} accessibilityElementsHidden>👤</Text>
                </View>
              )}
              <View style={styles.vHeadInfo}>
                <Text style={styles.vHeadName}>
                  {currentStory.userId === uid ? 'Your Story' : currentStory.userName}
                </Text>
                <Text style={styles.vHeadTime}>
                  {getStoryTimeRemaining(currentStory.expiresAt)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeViewer}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Close story viewer"
                accessibilityRole="button"
              >
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Media */}
            <TouchableOpacity
              style={styles.mediaWrap}
              activeOpacity={1}
              onPress={(e) = accessibilityLabel="button"> handleTap(e.nativeEvent.locationX)}
              accessibilityLabel="Tap left for previous story, right for next"
              accessibilityRole="button"
            >
              {currentStory.mediaType === 'video' ? (
                <StoryVideo uri={currentStory.mediaUrl} style={styles.media} />
              ) : (
                <TurboImage
                  source={{ uri: currentStory.mediaUrl }}
                  style={styles.media}
                  resizeMode="cover"
                  cachePolicy="dataCache"
                  accessibilityLabel={`Story by ${currentStory.userId === uid ? 'you' : currentStory.userName}`}
                />
              )}
            </TouchableOpacity>

            {/* Own story footer */}
            {currentStory.userId === uid && (
              <View style={styles.vFoot}>
                <View style={styles.viewsBadge}>
                  <Text style={styles.viewsTxt}>
                    👁️ {currentStory.viewCount} view{currentStory.viewCount !== 1 ? 's' : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.delBtn}
                  onPress={() = accessibilityLabel="button"> confirmDelete(currentStory.id)}
                  activeOpacity={0.8}
                  accessibilityLabel="Delete this story"
                  accessibilityRole="button"
                >
                  <Text style={styles.delBtnTxt}>🗑️ Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </Modal>

      {/* ── Create story modal ─────────────────────────────────────────── */}
      <Modal
        visible={createOpen}
        animationType="slide"
        transparent
        onRequestClose={handleCloseCreate}
      >
        <View style={styles.cModal}>
          <View style={styles.cContent}>
            <Text style={styles.cTitle} accessibilityRole="header">Create Story</Text>
            <TouchableOpacity
              style={styles.cOption}
              onPress={handlePickCamera}
              activeOpacity={0.7}
              accessibilityLabel="Take photo or video"
              accessibilityRole="button"
            >
              <Text style={styles.cOptionIcon} accessibilityElementsHidden>📷</Text>
              <Text style={styles.cOptionTxt}>Take Photo / Video</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cOption}
              onPress={handlePickLibrary}
              activeOpacity={0.7}
              accessibilityLabel="Choose from library"
              accessibilityRole="button"
            >
              <Text style={styles.cOptionIcon} accessibilityElementsHidden>🖼️</Text>
              <Text style={styles.cOptionTxt}>Choose from Library</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cCancel}
              onPress={handleCloseCreate}
              activeOpacity={0.8}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <Text style={styles.cCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Upload overlay ─────────────────────────────────────────────── */}
      {uploading && (
        <View style={styles.uploadOverlay}>
          <ActivityIndicator size="large" color={LOCAL.white} />
          <Text style={styles.uploadTxt}>Uploading story...</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  root:             { flex: 1, backgroundColor: theme.colors.background },
  centered:         { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingTxt:       { color: theme.colors.textSecondary, marginTop: 12, fontSize: 14 },

  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: TOP_INSET, backgroundColor: theme.colors.surface },
  headerBack:       { color: theme.colors.primary, fontSize: 16 },
  headerTitle:      { fontSize: 20, fontWeight: 'bold', color: theme.colors.text },
  headerAdd:        { color: LOCAL.accent, fontSize: 16, fontWeight: 'bold' },

  circlesWrap:      { maxHeight: 130 },
  circlesRow:       { paddingHorizontal: 15, paddingVertical: 15, gap: 15 },
  circle:           { alignItems: 'center', width: 80 },
  ring:             { width: 70, height: 70, borderRadius: 35, borderWidth: 3, borderColor: LOCAL.ring, padding: 3, marginBottom: 5 },
  ringViewed:       { borderColor: LOCAL.ringViewed },
  circleImg:        { width: '100%', height: '100%', borderRadius: 32 },
  circleName:       { color: theme.colors.text, fontSize: 12, textAlign: 'center', width: '100%' },
  circleMeta:       { color: theme.colors.textSecondary, fontSize: 10 },
  placeholder:      { backgroundColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  placeholderEmoji: { fontSize: 24 },

  empty:            { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:        { fontSize: 80, marginBottom: 20 },
  emptyTitle:       { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10 },
  emptyText:        { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 30 },
  emptyBtn:         { backgroundColor: LOCAL.accent, paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25 },
  emptyBtnTxt:      { color: LOCAL.white, fontSize: 16, fontWeight: 'bold' },

  viewer:           { flex: 1, backgroundColor: LOCAL.black },
  progRow:          { position: 'absolute', top: TOP_INSET - 6, left: 0, right: 0, flexDirection: 'row', gap: 4, paddingHorizontal: 8, zIndex: 10 },
  progBg:           { flex: 1, height: 3, backgroundColor: LOCAL.progressBg, borderRadius: 2, overflow: 'hidden' },
  progFill:         { height: '100%', backgroundColor: LOCAL.white, borderRadius: 2 },
  progDone:         { height: '100%', width: '100%', backgroundColor: LOCAL.white, borderRadius: 2 },

  vHead:            { position: 'absolute', top: TOP_INSET + 10, left: 15, right: 15, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 10 },
  vHeadImg:         { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: LOCAL.white },
  vHeadInfo:        { flex: 1 },
  vHeadName:        { color: LOCAL.white, fontSize: 16, fontWeight: 'bold' },
  vHeadTime:        { color: LOCAL.vHeadTime, fontSize: 12 },
  closeBtn:         { color: LOCAL.white, fontSize: 28, fontWeight: 'bold' },
  mediaWrap:        { flex: 1 },
  media:            { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },

  vFoot:            { position: 'absolute', bottom: Platform.OS === 'ios' ? 50 : 30, left: 0, right: 0, alignItems: 'center', gap: 12 },
  viewsBadge:       { backgroundColor: LOCAL.overlayLight, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  viewsTxt:         { color: LOCAL.white, fontSize: 14 },
  delBtn:           { backgroundColor: LOCAL.dangerBg, paddingVertical: 12, paddingHorizontal: 25, borderRadius: 25 },
  delBtnTxt:        { color: LOCAL.white, fontSize: 16, fontWeight: 'bold' },

  cModal:           { flex: 1, backgroundColor: LOCAL.overlay, justifyContent: 'flex-end' },
  cContent:         { backgroundColor: theme.colors.surface, borderTopLeftRadius: 25, borderTopRightRadius: 25, padding: 25, paddingBottom: Platform.OS === 'ios' ? 40 : 25 },
  cTitle:           { fontSize: 20, fontWeight: 'bold', color: theme.colors.text, marginBottom: 20, textAlign: 'center' },
  cOption:          { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.border, padding: 18, borderRadius: 15, marginBottom: 12, gap: 15 },
  cOptionIcon:      { fontSize: 28 },
  cOptionTxt:       { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  cCancel:          { backgroundColor: theme.colors.error, padding: 16, borderRadius: 15, marginTop: 10 },
  cCancelTxt:       { color: LOCAL.white, fontSize: 16, fontWeight: 'bold', textAlign: 'center' },

  uploadOverlay:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: LOCAL.overlayDense, justifyContent: 'center', alignItems: 'center' },
  uploadTxt:        { color: LOCAL.white, fontSize: 16, marginTop: 15 },
}));