import { layout, prepare } from '@chenglou/pretext';
import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  InteractionManager,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import TurboImage from 'react-native-turbo-image';
import { StyleSheet } from 'react-native-unistyles';
import { db } from '../firebaseConfig';
import { logger } from '../utils/logger';
import {
  type SuperLike,
  getSuperLikesReceived,
  markSuperLikeRead,
  respondToSuperLike,
} from '../utils/superLike';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LOCAL = {
  white:       '#ffffff',
  gold:        '#f1c40f',
  success:     '#5cb85c',
  danger:      '#d9534f',
  deepSurface: '#0f3460',
  textSub:     '#888888',
  textMuted:   '#666666',
} as const;

const MESSAGE_FONT        = '14px Inter';
const MESSAGE_LINE_HEIGHT = 20 / 14;
const MESSAGE_WIDTH       = SCREEN_WIDTH - 149;

const CARD_FIXED_HEIGHT = 288;

const pretextCache = new Map<string, number>();

function measureMessage(message: string): number {
  const key = `${message}|${MESSAGE_WIDTH}`;
  const hit  = pretextCache.get(key);
  if (hit !== undefined) return hit;

  const prepared = prepare(message, MESSAGE_FONT);
  const result   = layout(prepared, MESSAGE_WIDTH, MESSAGE_LINE_HEIGHT);

  pretextCache.set(key, result.height);
  if (pretextCache.size > 500) {
    const oldest = pretextCache.keys().next().value;
    if (oldest) pretextCache.delete(oldest);
  }
  return result.height;
}

function measureCardHeight(message: string): number {
  return Math.ceil(CARD_FIXED_HEIGHT + measureMessage(message));
}


interface SuperLikeWithProfile extends SuperLike {
  fromUserName?:  string;
  fromUserPhoto?: string;
  fromUserAge?:   number;
}


interface SuperLikeCardProps {
  item:       SuperLikeWithProfile;
  responding: string | null;
  onRespond:  (item: SuperLikeWithProfile, accept: boolean) => void;
}

const SuperLikeCard = React.memo(function SuperLikeCard({
  item, responding, onRespond,
}: SuperLikeCardProps) {
  const isResponding = responding === item.id;

  const onPass     = useCallback(() => onRespond(item, false), [onRespond, item]);
  const onLikeBack = useCallback(() => onRespond(item, true),  [onRespond, item]);

  const passBtnStyle = useMemo(
    () => [s.actionButton, s.passButton, isResponding && s.actionButtonDisabled],
    [isResponding],
  );
  const likeBtnStyle = useMemo(
    () => [s.actionButton, s.likeButton, isResponding && s.actionButtonDisabled],
    [isResponding],
  );

  return (
    <View
      style={s.card}
      accessibilityLabel={`Super like from ${item.fromUserName ?? 'Someone'}, age ${item.fromUserAge ?? 'unknown'}`}
    >
      <View style={s.photoContainer}>
        {item.fromUserPhoto ? (
          <TurboImage
            source={{ uri: item.fromUserPhoto }}
            style={s.photo}
            cachePolicy="dataCache"
            accessibilityLabel={`Photo of ${item.fromUserName ?? 'user'}`}
          />
        ) : (
          <View style={s.photoPlaceholder} accessibilityLabel="No photo available">
            <Text style={s.photoPlaceholderText} accessibilityElementsHidden>?</Text>
          </View>
        )}
        <View style={s.starBadge} accessibilityElementsHidden>
          <Text style={s.starBadgeText}>⭐</Text>
        </View>
      </View>

      <View style={s.info}>
        <Text style={s.name}>
          {item.fromUserName ?? 'Someone'}, {item.fromUserAge ?? '?'}
        </Text>
        <Text style={s.timestamp}>{new Date(item.createdAt).toLocaleDateString()}</Text>
        <View style={s.messageContainer}>
          <Text style={s.messageLabel}>Their message:</Text>
          <Text style={s.messageText}>"{item.message}"</Text>
        </View>
        <View style={s.actions}>
          <TouchableOpacity
            style={passBtnStyle}
            onPress={onPass}
            disabled={isResponding}
            accessibilityLabel={`Pass on ${item.fromUserName ?? 'this person'}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: isResponding }}
          >
            <Text style={s.actionButtonText}>{isResponding ? '...' : '✕ Pass'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={likeBtnStyle}
            onPress={onLikeBack}
            disabled={isResponding}
            accessibilityLabel={`Like back ${item.fromUserName ?? 'this person'}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: isResponding }}
          >
            <Text style={s.actionButtonText}>{isResponding ? '...' : '💕 Like Back'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});


export default function SuperLikesScreen() {
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [superLikes, setSuperLikes] = useState<SuperLikeWithProfile[]>([]);
  const [responding, setResponding] = useState<string | null>(null);

  const isMounted = useRef(true);

  const loadSuperLikes = useCallback(async () => {
    try {
      const likes = await getSuperLikesReceived();
      const withProfiles = await Promise.all(
        likes.map(async (like).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }) => {
          try {
            const snap = await getDoc(doc(db, 'users', like.fromUserId));
            if (snap.exists()) {
              const d = snap.data();
              return {
                ...like,
                fromUserName:  d.name,
                fromUserPhoto: d.photos?.[0],
                fromUserAge:   d.age,
              };
            }
          } catch (error) {
            logger.error('[SuperLikes] profile load error:', error);
          }
          return like;
        }),
      );
      if (!isMounted.current) return;
      setSuperLikes(withProfiles);
      await Promise.allSettled(
        likes.filter((l) => !l.read).map((l) => markSuperLikeRead(l.id)),
      );
    } catch (error) {
      logger.error('[SuperLikes] load error:', error);
      Alert.alert('Error', 'Failed to load super likes.');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    const task = InteractionManager.runAfterInteractions(() => {
      void loadSuperLikes();
    }, []);
    return () => {
      isMounted.current = false;
      task.cancel();
    };
  }, [loadSuperLikes]);

  const handleRespond = useCallback(async (
    superLike: SuperLikeWithProfile, accept: boolean,
  ) => {
    setResponding(superLike.id);
    try {
      const result = await respondToSuperLike(superLike.id, accept);
      if (!result.success) {
        Alert.alert('Error', 'Could not respond to this super like.');
        return;
      }
      if (accept && result.isMatch) {
        Alert.alert(
          "💕 It's a Match!",
          'You both like each other! Start chatting now.',
          [
            {
              text: 'Chat',
              onPress: () => router.push({
                pathname: '/chat',
                params: {
                  matchId:   superLike.fromUserId,
                  matchName: superLike.fromUserName ?? 'Your match',
                },
              }),
            },
            { text: 'Later', style: 'cancel' },
          ],
        );
      } else if (accept) {
        Alert.alert('Liked!', 'You liked them back!');
      } else {
        Alert.alert('Passed', 'You passed on this super like');
      }
      if (isMounted.current) {
        setSuperLikes((prev) => prev.filter((l) => l.id !== superLike.id));
      }
    } catch (error) {
      logger.error('[SuperLikes] respond error:', error);
      Alert.alert('Error', 'Something went wrong while responding.');
    } finally {
      if (isMounted.current) setResponding(null);
    }
  }, [router]);

  const onRespond = useCallback(
    (item: SuperLikeWithProfile, accept: boolean) => void handleRespond(item, accept),
    [handleRespond],
  );

  const keyExtractor = useCallback((item: SuperLikeWithProfile) => item.id, []);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<SuperLikeWithProfile>) => (
      <SuperLikeCard item={item} responding={responding} onRespond={onRespond} />
    ),
    [responding, onRespond],
  );

  const estimatedItemSize = useMemo(() => {
    if (superLikes.length === 0) return CARD_FIXED_HEIGHT + 40;
    let total   = 0;
    let sampled = 0;
    const step  = Math.max(1, Math.floor(superLikes.length / Math.min(superLikes.length, 20)));
    for (let i = 0; i < superLikes.length; i += step) {
      const like = superLikes[i];
      if (!like) continue;
      total += measureCardHeight(like.message ?? '');
      sampled++;
      if (sampled >= 20) break;
    }
    return sampled > 0 ? Math.ceil(total / sampled) : CARD_FIXED_HEIGHT + 40;
  }, [superLikes]);

  const onGoBack = useCallback(() => router.back(), [router]);

  if (loading) {
    return (
      <View style={s.container}>
        <ActivityIndicator size="large" color="#53a8b6" />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={onGoBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={s.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header">⭐ Super Likes</Text>
        <View style={s.headerSpacer} />
      </View>

      {superLikes.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={s.emptyIcon} accessibilityElementsHidden>⭐</Text>
          <Text style={s.emptyTitle} accessibilityRole="header">No Super Likes Yet</Text>
          <Text style={s.emptyText}>
            When someone super likes you, they'll appear here!
          </Text>
        </View>
      ) : (
        <LegendList
          data={superLikes}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={estimatedItemSize}
          recycleItems={false}
          contentContainerStyle={s.list}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create((theme) => ({
  container:            { flex: 1, backgroundColor: theme.colors.background },

  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: theme.colors.surface },
  backButton:           { color: theme.colors.primary, fontSize: 16 },
  title:                { fontSize: 20, fontWeight: 'bold', color: theme.colors.text },
  headerSpacer:         { width: 50 },

  emptyContainer:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:            { fontSize: 80, marginBottom: 20 },
  emptyTitle:           { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 15 },
  emptyText:            { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 24 },

  list:                 { padding: 20, paddingBottom: 40 },

  card:                 { backgroundColor: theme.colors.surface, borderRadius: 15, padding: 15, marginBottom: 15, flexDirection: 'row', gap: 15, borderWidth: 2, borderColor: LOCAL.gold },
  photoContainer:       { position: 'relative' },
  photo:                { width: 80, height: 100, borderRadius: 10 },
  photoPlaceholder:     { width: 80, height: 100, borderRadius: 10, backgroundColor: LOCAL.deepSurface, justifyContent: 'center', alignItems: 'center' },
  photoPlaceholderText: { fontSize: 30, color: LOCAL.textMuted },
  starBadge:            { position: 'absolute', top: -8, right: -8, backgroundColor: LOCAL.gold, width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: theme.colors.surface },
  starBadgeText:        { fontSize: 16 },

  info:                 { flex: 1 },
  name:                 { fontSize: 18, fontWeight: 'bold', color: theme.colors.text, marginBottom: 4 },
  timestamp:            { fontSize: 12, color: theme.colors.textSecondary, marginBottom: 12 },
  messageContainer:     { backgroundColor: LOCAL.deepSurface, borderRadius: 10, padding: 12, marginBottom: 15 },
  messageLabel:         { fontSize: 11, color: LOCAL.textSub, marginBottom: 4 },
  messageText:          { fontSize: 14, color: theme.colors.text, fontStyle: 'italic', lineHeight: 20 },

  actions:              { flexDirection: 'row', gap: 10 },
  actionButton:         { flex: 1, paddingVertical: 12, borderRadius: 20, alignItems: 'center' },
  actionButtonDisabled: { opacity: 0.5 },
  passButton:           { backgroundColor: LOCAL.danger },
  likeButton:           { backgroundColor: LOCAL.success },
  actionButtonText:     { color: LOCAL.white, fontSize: 14, fontWeight: 'bold' },
}));