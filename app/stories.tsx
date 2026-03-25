import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    BackHandler,
    Dimensions,
    FlatList,
    Image,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { auth } from '../firebaseConfig';
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

// ─── Constants ────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } =
  Dimensions.get('window');

const STORY_VIEW_MS = 5_000;

const C = {
  bg: '#1a1a2e',
  card: '#16213e',
  border: '#0f3460',
  primary: '#53a8b6',
  accent: '#5cb85c',
  danger: '#d9534f',
  ring: '#e67e22',
  ringViewed: '#555',
  text: '#eee',
  sub: '#888',
  muted: '#666',
  white: '#fff',
  black: '#000',
  overlay: 'rgba(0,0,0,0.8)',
  overlayDense: 'rgba(0,0,0,0.9)',
  overlayLight: 'rgba(0,0,0,0.7)',
  progressBg: 'rgba(255,255,255,0.3)',
  dangerBg: 'rgba(217,83,79,0.9)',
} as const;

const TOP_INSET = Platform.OS === 'ios' ? 60 : 50;

// ─── Video sub-component ──────────────────────────────────
// Hooks MUST be at the top level of a component — not inside
// conditionals or ternaries. So we wrap VideoView in its own
// component that always calls useVideoPlayer.

const StoryVideo = React.memo(function StoryVideo({
  uri,
  style,
}: {
  uri: string;
  style: any;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      nativeControls={false}
    />
  );
});

// ─── Main Component ───────────────────────────────────────

export default function StoriesScreen() {
  const router = useRouter();
  const uid = auth.currentUser?.uid;

  // ── state ──────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [stories, setStories] = useState<Story[]>([]);
  const [storyIndex, setStoryIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // ── refs ───────────────────────────────────────────────
  const progressAnim = useRef(new Animated.Value(0)).current;
  const animCtrl = useRef<Animated.CompositeAnimation | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef = useRef(storyIndex);
  indexRef.current = storyIndex;

  // ── derived ────────────────────────────────────────────
  const currentStory: Story | undefined = stories[storyIndex];

  const storyGroups: StoryGroup[] = useMemo(
    () => (uid ? groupStoriesByUser(stories, uid) : []),
    [stories, uid]
  );

  // ── load ───────────────────────────────────────────────

  const loadStories = useCallback(async () => {
    if (!uid) return;
    try {
      const data = await getActiveStories(uid);
      setStories(data);
    } catch (e) {
      console.error('[StoriesScreen] load:', e);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  // ── timer helpers ──────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (animCtrl.current) {
      animCtrl.current.stop();
      animCtrl.current = null;
    }
  }, []);

  const goNext = useCallback(() => {
    clearTimers();
    const idx = indexRef.current;
    if (idx < stories.length - 1) {
      setStoryIndex(idx + 1);
    } else {
      setViewerOpen(false);
      setStoryIndex(0);
    }
  }, [clearTimers, stories.length]);

  const goPrev = useCallback(() => {
    clearTimers();
    setStoryIndex((i) => Math.max(0, i - 1));
  }, [clearTimers]);

  const startTimer = useCallback(() => {
    clearTimers();
    progressAnim.setValue(0);

    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_VIEW_MS,
      useNativeDriver: false,
    });
    animCtrl.current = anim;
    anim.start();

    timerRef.current = setTimeout(goNext, STORY_VIEW_MS);
  }, [clearTimers, progressAnim, goNext]);

  useEffect(() => {
    if (viewerOpen && stories.length > 0) {
      startTimer();
    }
    return clearTimers;
  }, [viewerOpen, storyIndex, startTimer, clearTimers, stories.length]);

  // ── mark viewed when story changes ─────────────────────

  useEffect(() => {
    if (!viewerOpen || !currentStory || !uid) return;
    if (currentStory.userId !== uid) {
      markStoryViewed(currentStory.id).catch(() => {});
    }
  }, [viewerOpen, currentStory, uid]);

  // ── Android back button closes viewer ──────────────────

  useEffect(() => {
    if (!viewerOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeViewer();
      return true;
    });
    return () => sub.remove();
  }, [viewerOpen]);

  // ── handlers ───────────────────────────────────────────

  const closeViewer = useCallback(() => {
    clearTimers();
    setViewerOpen(false);
    setStoryIndex(0);
  }, [clearTimers]);

  const openGroup = useCallback(
    (group: StoryGroup) => {
      const firstStory = group.stories[0];
      if (!firstStory) return;
      const idx = stories.findIndex((s) => s.id === firstStory.id);
      if (idx < 0) return;
      setStoryIndex(idx);
      setViewerOpen(true);
    },
    [stories]
  );

  const handleTap = useCallback(
    (x: number) => {
      if (x < SCREEN_WIDTH / 3) {
        goPrev();
      } else {
        goNext();
      }
    },
    [goPrev, goNext]
  );

  // ── media picker ───────────────────────────────────────

  const pickMedia = useCallback(
    async (camera: boolean) => {
      try {
        if (camera) {
          const { status } =
            await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert(
              'Permission Required',
              'Camera access is needed to take photos and videos.'
            );
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

        if (result.canceled || !result.assets || !result.assets[0]) return;

        const asset = result.assets[0];
        const type: 'photo' | 'video' =
          asset.type === 'video' ? 'video' : 'photo';

        setCreateOpen(false);
        setUploading(true);

        const res = await createStory(asset.uri, type);
        setUploading(false);

        if (res.success) {
          Alert.alert('Story Posted!', 'Your story is live for 24 hours.');
          loadStories();
        } else {
          Alert.alert('Upload Failed', res.error ?? 'Please try again.');
        }
      } catch (err) {
        setUploading(false);
        console.error('[StoriesScreen] pickMedia:', err);
        Alert.alert('Error', 'Could not process media.');
      }
    },
    [loadStories]
  );

  // ── delete ─────────────────────────────────────────────

  const confirmDelete = useCallback(
    (id: string) => {
      Alert.alert(
        'Delete Story',
        'Are you sure you want to delete this story?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const res = await deleteStory(id);
              if (res.success) {
                closeViewer();
                loadStories();
              } else {
                Alert.alert('Error', res.error ?? 'Could not delete story.');
              }
            },
          },
        ]
      );
    },
    [closeViewer, loadStories]
  );

  // ── list renderers ─────────────────────────────────────

  const renderCircle = useCallback(
    ({ item: g }: { item: StoryGroup }) => {
      const own = g.userId === uid;
      const firstStory = g.stories[0];

      return (
        <TouchableOpacity
          style={styles.circle}
          onPress={() => openGroup(g)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.ring,
              !own && !g.hasUnviewed && styles.ringViewed,
            ]}
          >
            {g.userPhoto ? (
              <Image source={{ uri: g.userPhoto }} style={styles.circleImg} />
            ) : (
              <View style={[styles.circleImg, styles.placeholder]}>
                <Text style={styles.placeholderEmoji}>👤</Text>
              </View>
            )}
          </View>
          <Text style={styles.circleName} numberOfLines={1}>
            {g.userName}
          </Text>
          {own && firstStory != null && (
            <Text style={styles.circleMeta}>
              {g.stories.length} · {getStoryTimeRemaining(firstStory.expiresAt)}
            </Text>
          )}
        </TouchableOpacity>
      );
    },
    [uid, openGroup]
  );

  const circleKey = useCallback((g: StoryGroup) => g.userId, []);

  // ── loading gate ───────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingTxt}>Loading stories...</Text>
      </View>
    );
  }

  // ── render ─────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.headerBack}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Stories</Text>
        <TouchableOpacity
          onPress={() => setCreateOpen(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.headerAdd}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* ── Story circles ── */}
      {storyGroups.length > 0 && (
        <FlatList
          data={storyGroups}
          keyExtractor={circleKey}
          renderItem={renderCircle}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.circlesRow}
          style={styles.circlesWrap}
        />
      )}

      {/* ── Empty ── */}
      {stories.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📖</Text>
          <Text style={styles.emptyTitle}>No Stories Yet</Text>
          <Text style={styles.emptyText}>
            Be the first to share a moment!
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => setCreateOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.emptyBtnTxt}>+ Create Story</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ══════════════════════════════════════════════
          ══  VIEWER MODAL  ═══════════════════════════
          ══════════════════════════════════════════════ */}
      <Modal
        visible={viewerOpen && currentStory != null}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeViewer}
      >
        {currentStory != null && (
          <View style={styles.viewer}>
            {/* progress bars */}
            <View style={styles.progRow}>
              {stories.map((_, i) => (
                <View key={`prog_${i}`} style={styles.progBg}>
                  {i === storyIndex ? (
                    <Animated.View
                      style={[
                        styles.progFill,
                        {
                          width: progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  ) : i < storyIndex ? (
                    <View style={styles.progDone} />
                  ) : null}
                </View>
              ))}
            </View>

            {/* header overlay */}
            <View style={styles.vHead}>
              {currentStory.userPhoto ? (
                <Image
                  source={{ uri: currentStory.userPhoto }}
                  style={styles.vHeadImg}
                />
              ) : (
                <View style={[styles.vHeadImg, styles.placeholder]}>
                  <Text style={styles.placeholderEmoji}>👤</Text>
                </View>
              )}
              <View style={styles.vHeadInfo}>
                <Text style={styles.vHeadName}>
                  {currentStory.userId === uid
                    ? 'Your Story'
                    : currentStory.userName}
                </Text>
                <Text style={styles.vHeadTime}>
                  {getStoryTimeRemaining(currentStory.expiresAt)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeViewer}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* media — tap left/right */}
            <TouchableOpacity
              style={styles.mediaWrap}
              activeOpacity={1}
              onPress={(e) => handleTap(e.nativeEvent.locationX)}
            >
              {currentStory.mediaType === 'video' ? (
                <StoryVideo
                  uri={currentStory.mediaUrl}
                  style={styles.media}
                />
              ) : (
                <Image
                  source={{ uri: currentStory.mediaUrl }}
                  style={styles.media}
                  resizeMode="cover"
                />
              )}
            </TouchableOpacity>

            {/* footer — own story only */}
            {currentStory.userId === uid && (
              <View style={styles.vFoot}>
                <View style={styles.viewsBadge}>
                  <Text style={styles.viewsTxt}>
                    👁️ {currentStory.viewCount} view
                    {currentStory.viewCount !== 1 ? 's' : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.delBtn}
                  onPress={() => confirmDelete(currentStory.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.delBtnTxt}>🗑️ Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </Modal>

      {/* ══════════════════════════════════════════════
          ══  CREATE MODAL  ═══════════════════════════
          ══════════════════════════════════════════════ */}
      <Modal
        visible={createOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCreateOpen(false)}
      >
        <View style={styles.cModal}>
          <View style={styles.cContent}>
            <Text style={styles.cTitle}>Create Story</Text>

            <TouchableOpacity
              style={styles.cOption}
              onPress={() => pickMedia(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.cOptionIcon}>📷</Text>
              <Text style={styles.cOptionTxt}>Take Photo / Video</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cOption}
              onPress={() => pickMedia(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.cOptionIcon}>🖼️</Text>
              <Text style={styles.cOptionTxt}>Choose from Library</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cCancel}
              onPress={() => setCreateOpen(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.cCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Uploading overlay ── */}
      {uploading && (
        <View style={styles.uploadOverlay}>
          <ActivityIndicator size="large" color={C.white} />
          <Text style={styles.uploadTxt}>Uploading story...</Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  /* layout */
  root: { flex: 1, backgroundColor: C.bg },
  centered: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTxt: { color: C.sub, marginTop: 12, fontSize: 14 },

  /* header */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: TOP_INSET,
    backgroundColor: C.card,
  },
  headerBack: { color: C.primary, fontSize: 16 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: C.text },
  headerAdd: { color: C.accent, fontSize: 16, fontWeight: 'bold' },

  /* circles */
  circlesWrap: { maxHeight: 130 },
  circlesRow: { paddingHorizontal: 15, paddingVertical: 15, gap: 15 },
  circle: { alignItems: 'center', width: 80 },
  ring: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: C.ring,
    padding: 3,
    marginBottom: 5,
  },
  ringViewed: { borderColor: C.ringViewed },
  circleImg: { width: '100%', height: '100%', borderRadius: 32 },
  circleName: {
    color: C.text,
    fontSize: 12,
    textAlign: 'center',
    width: '100%',
  },
  circleMeta: { color: C.sub, fontSize: 10 },

  placeholder: {
    backgroundColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderEmoji: { fontSize: 24 },

  /* empty */
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon: { fontSize: 80, marginBottom: 20 },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: C.text,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 16,
    color: C.sub,
    textAlign: 'center',
    marginBottom: 30,
  },
  emptyBtn: {
    backgroundColor: C.accent,
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  emptyBtnTxt: { color: C.white, fontSize: 16, fontWeight: 'bold' },

  /* viewer */
  viewer: { flex: 1, backgroundColor: C.black },
  progRow: {
    position: 'absolute',
    top: TOP_INSET - 6,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    zIndex: 10,
  },
  progBg: {
    flex: 1,
    height: 3,
    backgroundColor: C.progressBg,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progFill: {
    height: '100%',
    backgroundColor: C.white,
    borderRadius: 2,
  },
  progDone: {
    height: '100%',
    width: '100%',
    backgroundColor: C.white,
    borderRadius: 2,
  },

  vHead: {
    position: 'absolute',
    top: TOP_INSET + 10,
    left: 15,
    right: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 10,
  },
  vHeadImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: C.white,
  },
  vHeadInfo: { flex: 1 },
  vHeadName: { color: C.white, fontSize: 16, fontWeight: 'bold' },
  vHeadTime: { color: '#ddd', fontSize: 12 },
  closeBtn: { color: C.white, fontSize: 28, fontWeight: 'bold' },

  mediaWrap: { flex: 1 },
  media: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },

  vFoot: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 50 : 30,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
  },
  viewsBadge: {
    backgroundColor: C.overlayLight,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  viewsTxt: { color: C.white, fontSize: 14 },
  delBtn: {
    backgroundColor: C.dangerBg,
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 25,
  },
  delBtnTxt: { color: C.white, fontSize: 16, fontWeight: 'bold' },

  /* create modal */
  cModal: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: 'flex-end',
  },
  cContent: {
    backgroundColor: C.card,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    padding: 25,
    paddingBottom: Platform.OS === 'ios' ? 40 : 25,
  },
  cTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: C.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  cOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.border,
    padding: 18,
    borderRadius: 15,
    marginBottom: 12,
    gap: 15,
  },
  cOptionIcon: { fontSize: 28 },
  cOptionTxt: { color: C.text, fontSize: 16, fontWeight: '600' },
  cCancel: {
    backgroundColor: C.danger,
    padding: 16,
    borderRadius: 15,
    marginTop: 10,
  },
  cCancelTxt: {
    color: C.white,
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  /* uploading */
  uploadOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.overlayDense,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadTxt: { color: C.white, fontSize: 16, marginTop: 15 },
});