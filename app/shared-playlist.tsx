import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Keyboard,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { auth } from '../firebaseConfig';
import {
    type PlaylistTrack,
    type SharedPlaylist,
    type TrackSearchResult,
    addTrackToPlaylist,
    getOrCreateSharedPlaylist,
    removeTrackFromPlaylist,
    searchSpotifyTracks,
    subscribeToPlaylist,
} from '../utils/sharedPlaylist';
import { getSpotifyProfile } from '../utils/spotifyIntegration';

// ─── Helpers ────────────────────────────────────────────

/** Safely coerce a search‑param value to a plain string. */
function asString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

// ─── Component ──────────────────────────────────────────

export default function SharedPlaylistScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    chatId: string;
    matchId: string;
    matchName?: string;
    playlistId?: string;
  }>();

  const chatId = asString(params.chatId);
  const matchId = asString(params.matchId);
  const matchName = asString(params.matchName) || 'Your Match';
  const existingPlaylistId = asString(params.playlistId);

  // ── State ──────────────────────────────────────────────

  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<SharedPlaylist | null>(null);
  const [activePlaylistId, setActivePlaylistId] = useState(existingPlaylistId);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TrackSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);

  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const searchInputRef = useRef<TextInput>(null);
  const uid = auth.currentUser?.uid;

  // ── Initialization ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // 1 · Check Spotify link
        const profile = await getSpotifyProfile();
        if (!cancelled && profile?.accessToken) {
          setSpotifyToken(profile.accessToken);
        }

        // 2 · Resolve playlist ID
        if (!chatId && !existingPlaylistId) {
          if (!cancelled) setError('Missing chat information.');
          return;
        }

        let resolvedId = existingPlaylistId;

        if (!resolvedId && chatId) {
          const result = await getOrCreateSharedPlaylist(chatId, matchId);
          if (result.success && result.playlistId) {
            resolvedId = result.playlistId;
          }
        }

        if (!cancelled) {
          if (resolvedId) {
            setActivePlaylistId(resolvedId);
          } else {
            setError('Could not load playlist.');
          }
        }
      } catch (err) {
        console.error('[SharedPlaylistScreen] init error:', err);
        if (!cancelled) setError('Something went wrong.');
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [chatId, matchId, existingPlaylistId]);

  // ── Real‑time subscription ─────────────────────────────

  useEffect(() => {
    if (!activePlaylistId) return;
    const unsubscribe = subscribeToPlaylist(activePlaylistId, setPlaylist);
    return unsubscribe;
  }, [activePlaylistId]);

  // ── Handlers ───────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed || !spotifyToken) return;

    Keyboard.dismiss();
    setSearching(true);
    const results = await searchSpotifyTracks(trimmed, spotifyToken);
    setSearchResults(results);
    setSearching(false);
  }, [searchQuery, spotifyToken]);

  const handleAddTrack = useCallback(
    async (track: TrackSearchResult) => {
      if (!activePlaylistId) return;

      // Duplicate guard
      if (playlist?.tracks.some((t) => t.trackId === track.trackId)) {
        Alert.alert('Already Added', `"${track.name}" is already in the playlist.`);
        return;
      }

      setAddingTrackId(track.trackId);
      const result = await addTrackToPlaylist(activePlaylistId, track);
      setAddingTrackId(null);

      if (result.success) {
        Alert.alert('Added! 🎵', `"${track.name}" added to playlist`);
        setSearchQuery('');
        setSearchResults([]);
      } else {
        Alert.alert('Error', 'Could not add track. Please try again.');
      }
    },
    [activePlaylistId, playlist?.tracks]
  );

  const handleRemoveTrack = useCallback(
    (track: PlaylistTrack) => {
      if (!activePlaylistId) return;

      Alert.alert('Remove Track', `Remove "${track.name}" from the playlist?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const result = await removeTrackFromPlaylist(activePlaylistId, track);
            if (!result.success) {
              Alert.alert('Error', 'Could not remove track.');
            }
          },
        },
      ]);
    },
    [activePlaylistId]
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    searchInputRef.current?.blur();
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const profile = await getSpotifyProfile();
    if (profile?.accessToken) setSpotifyToken(profile.accessToken);
    setRefreshing(false);
  }, []);

  const openInSpotify = useCallback(() => {
    if (!playlist?.tracks.length) {
      Alert.alert('Empty Playlist', 'Add some tracks first!');
      return;
    }
    Alert.alert(
      'Open in Spotify',
      'This would create a Spotify playlist with these tracks. Feature coming soon!'
    );
  }, [playlist?.tracks.length]);

  // ── Derived values ─────────────────────────────────────

  const trackCount = playlist?.tracks.length ?? 0;
  const trackLabel = `${trackCount} song${trackCount !== 1 ? 's' : ''}`;
  const isSpotifyLinked = !!spotifyToken;

  // ── List renderers ─────────────────────────────────────

  const renderTrackItem = useCallback(
    ({ item, index }: { item: PlaylistTrack; index: number }) => {
      const isOwn = item.addedBy === uid;

      return (
        <View style={styles.trackItem}>
          <Text style={styles.trackNumber}>{index + 1}</Text>
          {item.albumArt ? (
            <Image source={{ uri: item.albumArt }} style={styles.trackAlbumArt} />
          ) : (
            <View style={[styles.trackAlbumArt, styles.placeholderArt]}>
              <Text style={styles.placeholderText}>🎵</Text>
            </View>
          )}
          <View style={styles.trackInfo}>
            <Text style={styles.trackName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.trackArtist} numberOfLines={1}>
              {item.artist}
            </Text>
            <Text style={styles.trackAddedBy}>
              Added by {isOwn ? 'You' : matchName}
            </Text>
          </View>
          {isOwn && (
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => handleRemoveTrack(item)}
              hitSlop={8}
            >
              <Text style={styles.removeButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    },
    [uid, matchName, handleRemoveTrack]
  );

  const keyExtractor = useCallback(
    (item: PlaylistTrack, index: number) =>
      `${item.trackId}_${item.addedAt}_${index}`,
    []
  );

  // ── Screens ────────────────────────────────────────────

  if (initializing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={styles.loadingText}>Setting up playlist…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyIcon}>⚠️</Text>
        <Text style={styles.emptyTitle}>{error}</Text>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={styles.linkButtonText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isSpotifyLinked) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>🎵 Shared Playlist</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🎵</Text>
          <Text style={styles.emptyTitle}>Spotify Required</Text>
          <Text style={styles.emptyText}>
            Link your Spotify account to create shared playlists with your
            matches!
          </Text>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.push('/social-verification')}
            activeOpacity={0.8}
          >
            <Text style={styles.linkButtonText}>🎵 Link Spotify</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main ───────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🎵 Playlist</Text>
        <TouchableOpacity onPress={openInSpotify} hitSlop={12}>
          <Text style={styles.openButton}>Open in Spotify</Text>
        </TouchableOpacity>
      </View>

      {/* ── Search Bar ── */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search for songs…"
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClearSearch}
              hitSlop={6}
            >
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[
            styles.searchButton,
            (!searchQuery.trim() || searching) && styles.searchButtonDisabled,
          ]}
          onPress={handleSearch}
          disabled={searching || !searchQuery.trim()}
          activeOpacity={0.7}
        >
          {searching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>🔍</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Search Results ── */}
      {searchResults.length > 0 && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsTitle}>
            Search Results ({searchResults.length})
          </Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {searchResults.map((track) => {
              const isAdding = addingTrackId === track.trackId;
              const alreadyAdded = playlist?.tracks.some(
                (t) => t.trackId === track.trackId
              );

              return (
                <View key={track.trackId} style={styles.resultItem}>
                  {track.albumArt ? (
                    <Image
                      source={{ uri: track.albumArt }}
                      style={styles.resultAlbumArt}
                    />
                  ) : (
                    <View
                      style={[styles.resultAlbumArt, styles.placeholderArt]}
                    >
                      <Text style={styles.placeholderText}>🎵</Text>
                    </View>
                  )}
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {track.name}
                    </Text>
                    <Text style={styles.resultArtist} numberOfLines={1}>
                      {track.artist}
                    </Text>
                  </View>
                  {alreadyAdded ? (
                    <View style={styles.addedBadge}>
                      <Text style={styles.addedBadgeText}>✓</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.addButton,
                        isAdding && styles.addButtonDisabled,
                      ]}
                      onPress={() => handleAddTrack(track)}
                      disabled={isAdding}
                      activeOpacity={0.7}
                    >
                      {isAdding ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.addButtonText}>+</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* ── Playlist ── */}
      <View style={styles.playlistContainer}>
        <View style={styles.playlistHeader}>
          <Text style={styles.playlistTitle}>Playlist with {matchName}</Text>
          <Text style={styles.playlistCount}>{trackLabel}</Text>
        </View>

        {trackCount === 0 ? (
          <View style={styles.emptyPlaylist}>
            <Text style={styles.emptyPlaylistIcon}>🎵</Text>
            <Text style={styles.emptyPlaylistText}>
              Search and add songs to start building your playlist together!
            </Text>
          </View>
        ) : (
          <FlatList
            data={playlist!.tracks}
            keyExtractor={keyExtractor}
            renderItem={renderTrackItem}
            contentContainerStyle={styles.tracksList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#53a8b6"
                colors={['#53a8b6']}
              />
            }
          />
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────

const COLORS = {
  bg: '#1a1a2e',
  card: '#16213e',
  border: '#0f3460',
  primary: '#53a8b6',
  spotify: '#1DB954',
  text: '#eee',
  textSecondary: '#888',
  textMuted: '#666',
  danger: '#e74c3c',
} as const;

const styles = StyleSheet.create({
  /* ── Layout ── */
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: { color: COLORS.textSecondary, marginTop: 12, fontSize: 14 },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    backgroundColor: COLORS.card,
  },
  headerSpacer: { width: 50 },
  backButton: { color: COLORS.primary, fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  openButton: { color: COLORS.spotify, fontSize: 14, fontWeight: 'bold' },

  /* ── Search ── */
  searchContainer: { flexDirection: 'row', padding: 15, gap: 10 },
  searchInputWrapper: { flex: 1, position: 'relative', justifyContent: 'center' },
  searchInput: {
    backgroundColor: COLORS.card,
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 20,
    paddingRight: 40,
    color: COLORS.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  clearButton: {
    position: 'absolute',
    right: 14,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: { color: COLORS.bg, fontSize: 12, fontWeight: 'bold' },
  searchButton: {
    backgroundColor: COLORS.spotify,
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonDisabled: { opacity: 0.5 },
  searchButtonText: { fontSize: 20 },

  /* ── Search Results ── */
  resultsContainer: {
    maxHeight: 260,
    backgroundColor: COLORS.card,
    marginHorizontal: 15,
    borderRadius: 15,
    padding: 10,
  },
  resultsTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  resultAlbumArt: { width: 50, height: 50, borderRadius: 8 },
  resultInfo: { flex: 1 },
  resultName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  resultArtist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  addButton: {
    backgroundColor: COLORS.spotify,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: { backgroundColor: '#555' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  addedBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: COLORS.spotify,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addedBadgeText: { color: COLORS.spotify, fontSize: 16, fontWeight: 'bold' },

  /* ── Playlist ── */
  playlistContainer: { flex: 1, marginTop: 15 },
  playlistHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  playlistTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  playlistCount: { fontSize: 14, color: COLORS.textSecondary },

  emptyPlaylist: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyPlaylistIcon: { fontSize: 60, marginBottom: 15 },
  emptyPlaylistText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  tracksList: { paddingHorizontal: 15, paddingBottom: 40 },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  trackNumber: {
    color: COLORS.textMuted,
    fontSize: 16,
    fontWeight: 'bold',
    width: 25,
    textAlign: 'center',
  },
  trackAlbumArt: { width: 60, height: 60, borderRadius: 8 },
  trackInfo: { flex: 1 },
  trackName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  trackArtist: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginBottom: 4,
  },
  trackAddedBy: { color: COLORS.spotify, fontSize: 11 },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(231,76,60,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: 'bold',
  },

  /* ── Placeholder art ── */
  placeholderArt: {
    backgroundColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { fontSize: 20 },

  /* ── Not linked / empty states ── */
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon: { fontSize: 80, marginBottom: 20 },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 15,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  linkButton: {
    backgroundColor: COLORS.spotify,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 25,
  },
  linkButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});