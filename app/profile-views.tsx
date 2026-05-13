import type { LegendListRenderItemProps } from '@legendapp/list';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import TurboImage from '../src/components/TurboImage';
import { StyleSheet } from 'react-native-unistyles';
import { auth, db } from '../firebaseConfig';
import { logger } from '../utils/logger';
import { formatLastSeen } from '../utils/onlineStatus';

const VIEWER_ITEM_HEIGHT = 85;

const LOCAL = {
  white:        '#ffffff',
  success:      '#5cb85c',
  warning:      '#e67e22',
  verifiedBlue: '#3498db',
  deepSurface:  '#0f3460',
} as const;

interface ProfileViewer {
  oduid:          string;
  name:           string;
  age:            number;
  photo:          string;
  viewedAt:       { toMillis?: () => number } | null;
  selfieVerified: boolean;
  isMatch:        boolean;
}

interface ViewerCardProps {
  item:   ProfileViewer;
  onChat: (oduid: string, name: string) => void;
}

const ViewerCard = React.memo(function ViewerCard({ item, onChat }: ViewerCardProps) {
  const handleChat = useCallback(
    () => onChat(item.oduid, item.name),
    [onChat, item.oduid, item.name],
  );

  return (
    <View
      style={styles.viewerCard}
      accessibilityLabel={`${item.name}, age ${item.age}, viewed your profile${item.isMatch ? ', you are matched' : ''}`}
    >
      <View style={styles.viewerInfo}>
        {item.photo ? (
          <View style={styles.photoContainer}>
            <TurboImage
              source={{ uri: item.photo }}
              style={styles.viewerPhoto}
              cachePolicy="dataCache"
              accessibilityLabel={`Photo of ${item.name}`}
            />
            {item.selfieVerified && (
              <View style={styles.verifiedBadge} accessibilityLabel="Verified user">
                <Text style={styles.verifiedText} accessibilityElementsHidden>✓</Text>
              </View>
            )}
          </View>
        ) : (
          <View
            style={styles.viewerPhotoPlaceholder}
            accessibilityLabel={`No photo for ${item.name}`}
          >
            <Text style={styles.viewerPhotoText} accessibilityElementsHidden>?</Text>
          </View>
        )}

        <View style={styles.viewerDetails}>
          <View style={styles.nameRow}>
            <Text style={styles.viewerName}>{item.name}, {item.age}</Text>
            {item.isMatch && (
              <View style={styles.matchBadge} accessibilityLabel="You are matched">
                <Text style={styles.matchBadgeText}>Match 💕</Text>
              </View>
            )}
          </View>
          <Text style={styles.viewedTime}>
            Viewed {item.viewedAt ? formatLastSeen(item.viewedAt) : ''}
          </Text>
        </View>
      </View>

      {item.isMatch && (
        <TouchableOpacity
          style={styles.chatButton}
          onPress={handleChat}
          accessibilityLabel={`Chat with ${item.name}`}
          accessibilityRole="button"
        >
          <Text style={styles.chatButtonText}>Chat</Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

const ListHeader = React.memo(function ListHeader() {
  return <Text style={styles.listHeader}>Recent Viewers</Text>;
});

export default function ProfileViewsScreen() {
  const router = useRouter();
  const user   = auth.currentUser;

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewers,    setViewers]    = useState<ProfileViewer[]>([]);
  const [totalViews, setTotalViews] = useState(0);

  const loadProfileViews = useCallback(async () => {
    if (!user) { router.replace('/login'); return; }
    try {
      const viewsSnap = await getDocs(query(
        collection(db, 'profileViews'),
        where('viewedUserId', '==', user.uid),
        orderBy('viewedAt', 'desc'),
      ));

      const matchesSnap = await getDocs(query(
        collection(db, 'likes'),
        where('status', '==', 'matched'),
      ));
      const matchedIds = new Set<string>();
      matchesSnap.forEach((d) => {
        const data = d.data();
        if (data.fromUserId === user.uid) matchedIds.add(data.toUserId as string);
        else if (data.toUserId === user.uid) matchedIds.add(data.fromUserId as string);
      });

      const seen = new Set<string>();
      const list: ProfileViewer[] = [];

      for (const viewDoc of viewsSnap.docs) {
        const viewData = viewDoc.data();
        const viewerId = viewData.viewerId as string;
        if (seen.has(viewerId)) continue;
        seen.add(viewerId);
        try {
          const snap = await getDoc(doc(db, 'users', viewerId));
          if (snap.exists()) {
            const d = snap.data();
            list.push({
              oduid:          viewerId,
              name:           d.name || 'Anonymous',
              age:            d.age || 0,
              photo:          d.photos?.[0] || '',
              viewedAt:       viewData.viewedAt ?? null,
              selfieVerified: d.selfieVerified || false,
              isMatch:        matchedIds.has(viewerId),
            });
          }
        } catch {
          logger.warn('[ProfileViews] Could not load viewer:', viewerId);
        }
      }

      if (!isMounted.current) return;
      setViewers(list);
      setTotalViews(viewsSnap.size);
    } catch (error) {
      logger.error('[ProfileViews] loadProfileViews error:', error);
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user, router]);

  useEffect(() => { void loadProfileViews(); }, [loadProfileViews]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadProfileViews();
  }, [loadProfileViews]);

  const navigateToChat = useCallback((oduid: string, name: string) => {
    router.push({ pathname: '/chat', params: { matchId: oduid, matchName: name } });
  }, [router]);

  const keyExtractor = useCallback((item: ProfileViewer) => item.oduid, []);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ProfileViewer>) => (
      <ViewerCard item={item} onChat={navigateToChat} />
    ),
    [navigateToChat],
  );

  const refreshControl = useMemo(() => (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor="#53a8b6"
      colors={['#53a8b6']}
    />
  ), [refreshing, handleRefresh]);

  const onGoMatches = useCallback(() => router.push('/matches'), [router]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Loading views...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={styles.statsCard}
        accessibilityLabel={`${totalViews} people viewed your profile`}
      >
        <Text style={styles.statsIcon} accessibilityElementsHidden>👀</Text>
        <Text style={styles.statsNumber}>{totalViews}</Text>
        <Text style={styles.statsLabel}>
          {totalViews === 1 ? 'person viewed your profile' : 'people viewed your profile'}
        </Text>
      </View>

      {viewers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon} accessibilityElementsHidden>👀</Text>
          <Text style={styles.emptyTitle} accessibilityRole="header">No views yet</Text>
          <Text style={styles.emptyText}>
            When someone views your profile, they'll appear here.
          </Text>
          <TouchableOpacity
            style={styles.findMatchesButton}
            onPress={onGoMatches}
            accessibilityLabel="Find matches"
            accessibilityRole="button"
          >
            <Text style={styles.findMatchesButtonText}>Find Matches</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <LegendList
          data={viewers}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={VIEWER_ITEM_HEIGHT}
          recycleItems={true}
          refreshControl={refreshControl}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={ListHeader}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container:              { flex: 1, backgroundColor: theme.colors.background },
  loadingContainer:       { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' },
  loadingText:            { color: theme.colors.textSecondary, marginTop: 15, fontSize: 16 },

  statsCard:              { backgroundColor: theme.colors.surface, margin: 20, marginBottom: 10, borderRadius: 20, padding: 25, alignItems: 'center', borderWidth: 2, borderColor: LOCAL.warning },
  statsIcon:              { fontSize: 40, marginBottom: 10 },
  statsNumber:            { fontSize: 48, fontWeight: 'bold', color: LOCAL.warning },
  statsLabel:             { color: theme.colors.textSecondary, fontSize: 14, marginTop: 5 },

  listContent:            { padding: 20, paddingTop: 10 },
  listHeader:             { fontSize: 16, fontWeight: '600', color: theme.colors.primary, marginBottom: 15 },

  viewerCard:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.colors.surface, borderRadius: 15, padding: 15, marginBottom: 10 },
  viewerInfo:             { flexDirection: 'row', alignItems: 'center', flex: 1 },
  photoContainer:         { position: 'relative' },
  viewerPhoto:            { width: 55, height: 55, borderRadius: 28 },
  viewerPhotoPlaceholder: { width: 55, height: 55, borderRadius: 28, backgroundColor: LOCAL.deepSurface, justifyContent: 'center', alignItems: 'center' },
  viewerPhotoText:        { color: theme.colors.textSecondary, fontSize: 24 },
  verifiedBadge:          { position: 'absolute', bottom: 0, right: 0, backgroundColor: LOCAL.verifiedBlue, borderRadius: 10, width: 18, height: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: theme.colors.surface },
  verifiedText:           { color: LOCAL.white, fontSize: 10, fontWeight: 'bold' },

  viewerDetails:          { marginLeft: 15, flex: 1 },
  nameRow:                { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  viewerName:             { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  matchBadge:             { backgroundColor: LOCAL.success, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  matchBadgeText:         { color: LOCAL.white, fontSize: 10, fontWeight: '600' },
  viewedTime:             { color: theme.colors.textSecondary, fontSize: 12, marginTop: 3 },

  chatButton:             { backgroundColor: theme.colors.primary, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20 },
  chatButtonText:         { color: LOCAL.white, fontSize: 14, fontWeight: '600' },

  emptyContainer:         { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon:              { fontSize: 60, marginBottom: 20 },
  emptyTitle:             { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 10 },
  emptyText:              { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 30 },
  findMatchesButton:      { backgroundColor: LOCAL.success, paddingVertical: 14, paddingHorizontal: 30, borderRadius: 25 },
  findMatchesButtonText:  { color: LOCAL.white, fontSize: 16, fontWeight: '600' },
}));