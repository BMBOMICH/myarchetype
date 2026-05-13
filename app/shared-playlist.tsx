import { LegendList, LegendListRenderItemProps } from '@legendapp/list';
import { observable } from '@legendapp/state';
import { observer } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator, Alert, InteractionManager, Keyboard,
  RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import TurboImage from '../src/components/TurboImage';
import { StyleSheet } from 'react-native-unistyles';
import { auth } from '../firebaseConfig';
import { logger } from '../utils/logger';
import {
  type PlaylistTrack, type SharedPlaylist, type TrackSearchResult,
  addTrackToPlaylist, getOrCreateSharedPlaylist,
  removeTrackFromPlaylist, searchSpotifyTracks, subscribeToPlaylist,
} from '../utils/sharedPlaylist';
import { getSpotifyProfile } from '../utils/spotifyIntegration';

function asString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

const screen$ = observable({
  initializing:  true,
  error:         null as string | null,
  playlist:      null as SharedPlaylist | null,
  activeId:      '',
  searchQuery:   '',
  searchResults: [] as TrackSearchResult[],
  searching:     false,
  addingTrackId: null as string | null,
  spotifyToken:  null as string | null,
  refreshing:    false,
});

// Stable style arrays — computed once at module level since they have no runtime deps
const trackAlbumArtPlaceholderStyle = [
  { width: 60, height: 60, borderRadius: 8 },
  { backgroundColor: '#0f3460', alignItems: 'center' as const, justifyContent: 'center' as const },
];
const resultAlbumArtPlaceholderStyle = [
  { width: 50, height: 50, borderRadius: 8 },
  { backgroundColor: '#0f3460', alignItems: 'center' as const, justifyContent: 'center' as const },
];

export default observer(function SharedPlaylistScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ chatId: string; matchId: string; matchName?: string; playlistId?: string }>();
  const chatId             = asString(params.chatId);
  const matchId            = asString(params.matchId);
  const matchName          = asString(params.matchName) || 'Your Match';
  const existingPlaylistId = asString(params.playlistId);

  const searchInputRef = useRef<TextInput>(null);
  const uid = auth.currentUser?.uid;

  const initializing  = screen$.initializing.get();
  const error         = screen$.error.get();
  const playlist      = screen$.playlist.get();
  const searchQuery   = screen$.searchQuery.get();
  const searchResults = screen$.searchResults.get();
  const searching     = screen$.searching.get();
  const addingTrackId = screen$.addingTrackId.get();
  const spotifyToken  = screen$.spotifyToken.get();
  const refreshing    = screen$.refreshing.get();

  // activeId is read reactively inside effects and callbacks via screen$.activeId.get()
  // so we do not need a local derived variable for it here.

  // Computed style that depends on runtime state
  const searchButtonStyle = useMemo(
    () => [st.searchButton, (!searchQuery.trim() || searching) && st.searchButtonDisabled],
    [searchQuery, searching],
  );

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      let cancelled = false;
      async function init() {
        try {
          const profile = await getSpotifyProfile();
          if (!cancelled && profile?.accessToken) {
            screen$.spotifyToken.set(profile.accessToken);
          }
          if (!chatId && !existingPlaylistId) {
            if (!cancelled) screen$.error.set('Missing chat information.');
            return;
          }
          let resolvedId = existingPlaylistId;
          if (!resolvedId && chatId) {
            const result = await getOrCreateSharedPlaylist(chatId, matchId);
            if (result.success && result.playlistId) resolvedId = result.playlistId;
          }
          if (!cancelled) {
            if (resolvedId) {
              screen$.activeId.set(resolvedId);
            } else {
              screen$.error.set('Could not load playlist.');
            }
          }
        } catch (err) {
          logger.error('[SharedPlaylist] init error:', err);
          if (!cancelled) screen$.error.set('Something went wrong.');
        } finally {
          if (!cancelled) screen$.initializing.set(false);
        }
      }
      void init();
      return () => { cancelled = true; };
    });
    return () => task.cancel();
  }, [chatId, matchId, existingPlaylistId]);

  useEffect(() => {
    const activeId = screen$.activeId.get();
    if (!activeId) return;
    const unsubscribe = subscribeToPlaylist(activeId, (p) => screen$.playlist.set(p));
    return () => unsubscribe();
  }, []);

  const handleSearchQueryChange = useCallback((v: string) => screen$.searchQuery.set(v), []);

  const handleSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    const token   = screen$.spotifyToken.get();
    if (!trimmed || !token) return;
    Keyboard.dismiss();
    screen$.searching.set(true);
    screen$.searchResults.set(await searchSpotifyTracks(trimmed, token));
    screen$.searching.set(false);
  }, [searchQuery]);

  const handleAddTrack = useCallback(async (track: TrackSearchResult) => {
    const id = screen$.activeId.get();
    if (!id) return;
    const currentPlaylist = screen$.playlist.get();
    if (currentPlaylist?.tracks.some((t) => t.trackId === track.trackId)) {
      Alert.alert('Already Added', `"${track.name}" is already in the playlist.`);
      return;
    }
    screen$.addingTrackId.set(track.trackId);
    const result = await addTrackToPlaylist(id, track);
    screen$.addingTrackId.set(null);
    if (result.success) {
      Alert.alert('Added! 🎵', `"${track.name}" added`);
      screen$.searchQuery.set('');
      screen$.searchResults.set([]);
    } else {
      Alert.alert('Error', 'Could not add track.');
    }
  }, []);

  const handleRemoveTrack = useCallback((track: PlaylistTrack) => {
    const id = screen$.activeId.get();
    if (!id) return;
    Alert.alert('Remove Track', `Remove "${track.name}" from the playlist?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          const result = await removeTrackFromPlaylist(id, track);
          if (!result.success) Alert.alert('Error', 'Could not remove track.');
        },
      },
    ]);
  }, []);

  const handleClearSearch = useCallback(() => {
    screen$.searchQuery.set('');
    screen$.searchResults.set([]);
    searchInputRef.current?.blur();
  }, []);

  const handleRefresh = useCallback(async () => {
    screen$.refreshing.set(true);
    const profile = await getSpotifyProfile();
    if (profile?.accessToken) screen$.spotifyToken.set(profile.accessToken);
    screen$.refreshing.set(false);
  }, []);

  const openInSpotify = useCallback(() => {
    const tracks = screen$.playlist.get()?.tracks ?? [];
    if (!tracks.length) { Alert.alert('Empty Playlist', 'Add some tracks first!'); return; }
    Alert.alert('Open in Spotify', 'Feature coming soon!');
  }, []);

  const handleAddTrackPress = useCallback(
    (track: TrackSearchResult) => { void handleAddTrack(track); },
    [handleAddTrack],
  );

  const renderTrackItem = useCallback(({ item, index }: LegendListRenderItemProps<PlaylistTrack>) => {
    const isOwn = item.addedBy === uid;
    return (
      <View
        style={st.trackItem}
        accessibilityLabel={`${item.name} by ${item.artist}, added by ${isOwn ? 'you' : matchName}`}
      >
        <Text style={st.trackNumber}>{index + 1}</Text>
        {item.albumArt ? (
          <TurboImage
            source={{ uri: item.albumArt }}
            style={st.trackAlbumArt}
            cachePolicy="dataCache"
            accessibilityLabel={`${item.name} album art`}
          />
        ) : (
          <View style={trackAlbumArtPlaceholderStyle}>
            <Text style={st.placeholderText} accessibilityElementsHidden>🎵</Text>
          </View>
        )}
        <View style={st.trackInfo}>
          <Text style={st.trackName}   numberOfLines={1}>{item.name}</Text>
          <Text style={st.trackArtist} numberOfLines={1}>{item.artist}</Text>
          <Text style={st.trackAddedBy}>Added by {isOwn ? 'You' : matchName}</Text>
        </View>
        {isOwn && (
          <TouchableOpacity
            style={st.removeButton}
            onPress={() => handleRemoveTrack(item)}
            hitSlop={8}
            accessibilityLabel={`Remove ${item.name}`}
            accessibilityRole="button"
          >
            <Text style={st.removeButtonText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [uid, matchName, handleRemoveTrack]);

  const keyExtractor = useCallback(
    (item: PlaylistTrack, index: number) => `${item.trackId}_${item.addedAt}_${index}`,
    [],
  );

  const trackCount = playlist?.tracks.length ?? 0;
  const trackLabel = `${trackCount} song${trackCount !== 1 ? 's' : ''}`;

  const onGoBack         = useCallback(() => router.back(),                       [router]);
  const onGoSocialVerify = useCallback(() => router.push('/social-verification'), [router]);

  if (initializing) {
    return (
      <View style={st.centered}>
        <ActivityIndicator size="large" color="#53a8b6" />
        <Text style={st.loadingText}>Setting up playlist…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={st.centered}>
        <Text style={st.emptyIcon} accessibilityElementsHidden>⚠️</Text>
        <Text style={st.emptyTitle}>{error}</Text>
        <TouchableOpacity
          style={st.linkButton}
          onPress={onGoBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={st.linkButtonText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!spotifyToken) {
    return (
      <View style={st.container}>
        <View style={st.header}>
          <TouchableOpacity
            onPress={onGoBack}
            hitSlop={12}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Text style={st.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={st.title} accessibilityRole="header">🎵 Shared Playlist</Text>
          <View style={st.headerSpacer} />
        </View>
        <View style={st.emptyContainer}>
          <Text style={st.emptyIcon} accessibilityElementsHidden>🎵</Text>
          <Text style={st.emptyTitle}>Spotify Required</Text>
          <Text style={st.emptyText}>Link your Spotify account to create shared playlists with your matches!</Text>
          <TouchableOpacity
            style={st.linkButton}
            onPress={onGoSocialVerify}
            accessibilityLabel="Link Spotify account"
            accessibilityRole="button"
          >
            <Text style={st.linkButtonText}>🎵 Link Spotify</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={st.container}>
      <View style={st.header}>
        <TouchableOpacity
          onPress={onGoBack}
          hitSlop={12}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={st.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={st.title} accessibilityRole="header">🎵 Playlist</Text>
        <TouchableOpacity
          onPress={openInSpotify}
          hitSlop={12}
          accessibilityLabel="Open playlist in Spotify"
          accessibilityRole="button"
        >
          <Text style={st.openButton}>Open in Spotify</Text>
        </TouchableOpacity>
      </View>

      <View style={st.searchContainer}>
        <View style={st.searchInputWrapper}>
          <TextInput
            ref={searchInputRef}
            style={st.searchInput}
            placeholder="Search for songs…"
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={handleSearchQueryChange}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search for songs"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={st.clearButton}
              onPress={handleClearSearch}
              hitSlop={6}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
            >
              <Text style={st.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={searchButtonStyle}
          onPress={handleSearch}
          disabled={searching || !searchQuery.trim()}
          accessibilityLabel="Search"
          accessibilityRole="button"
          accessibilityState={{ disabled: searching || !searchQuery.trim() }}
        >
          {searching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={st.searchButtonText}>🔍</Text>}
        </TouchableOpacity>
      </View>

      {searchResults.length > 0 && (
        <View style={st.resultsContainer}>
          <Text style={st.resultsTitle}>Search Results ({searchResults.length})</Text>
          {/*
            ScrollView wraps search results which are bounded in count
            (Spotify API returns max 20 results) and have a maxHeight cap.
            LegendList is not appropriate for this bounded, capped list.
          */}
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {searchResults.map((track) => {
              const isAdding     = addingTrackId === track.trackId;
              const alreadyAdded = playlist?.tracks.some((t) => t.trackId === track.trackId);
              const addBtnStyle  = [st.addButton, isAdding && st.addButtonDisabled];
              return (
                <View
                  key={track.trackId}
                  style={st.resultItem}
                  accessibilityLabel={`${track.name} by ${track.artist}`}
                >
                  {track.albumArt ? (
                    <TurboImage
                      source={{ uri: track.albumArt }}
                      style={st.resultAlbumArt}
                      cachePolicy="dataCache"
                      accessibilityLabel={`${track.name} album art`}
                    />
                  ) : (
                    <View style={resultAlbumArtPlaceholderStyle}>
                      <Text style={st.placeholderText} accessibilityElementsHidden>🎵</Text>
                    </View>
                  )}
                  <View style={st.resultInfo}>
                    <Text style={st.resultName}   numberOfLines={1}>{track.name}</Text>
                    <Text style={st.resultArtist} numberOfLines={1}>{track.artist}</Text>
                  </View>
                  {alreadyAdded ? (
                    <View style={st.addedBadge} accessibilityLabel="Already added">
                      <Text style={st.addedBadgeText}>✓</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={addBtnStyle}
                      onPress={() => handleAddTrackPress(track)}
                      disabled={isAdding}
                      accessibilityLabel={`Add ${track.name}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isAdding }}
                    >
                      {isAdding
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={st.addButtonText}>+</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={st.playlistContainer}>
        <View style={st.playlistHeader}>
          <Text style={st.playlistTitle} accessibilityRole="header">Playlist with {matchName}</Text>
          <Text style={st.playlistCount}>{trackLabel}</Text>
        </View>
        {trackCount === 0 ? (
          <View style={st.emptyPlaylist}>
            <Text style={st.emptyPlaylistIcon} accessibilityElementsHidden>🎵</Text>
            <Text style={st.emptyPlaylistText}>Search and add songs to start building your playlist together!</Text>
          </View>
        ) : (
          <LegendList
            data={playlist?.tracks}
            keyExtractor={keyExtractor}
            renderItem={renderTrackItem}
            estimatedItemSize={84}
            recycleItems={true}
            contentContainerStyle={st.tracksList}
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
});

const C = {
  bg: '#1a1a2e', card: '#16213e', border: '#0f3460', primary: '#53a8b6',
  spotify: '#1DB954', text: '#eee', sub: '#888', muted: '#666', danger: '#e74c3c',
} as const;

const st = StyleSheet.create((theme) => ({
  container:            { flex: 1, backgroundColor: theme.colors.background },
  centered:             { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText:          { color: theme.colors.textSecondary, marginTop: 12, fontSize: 14 },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: C.card },
  headerSpacer:         { width: 50 },
  backButton:           { color: C.primary, fontSize: 16 },
  title:                { fontSize: 20, fontWeight: 'bold', color: theme.colors.text },
  openButton:           { color: C.spotify, fontSize: 14, fontWeight: 'bold' },
  searchContainer:      { flexDirection: 'row', padding: 15, gap: 10 },
  searchInputWrapper:   { flex: 1, position: 'relative', justifyContent: 'center' },
  searchInput:          { backgroundColor: C.card, borderRadius: 25, paddingVertical: 12, paddingHorizontal: 20, paddingRight: 40, color: theme.colors.text, fontSize: 16, borderWidth: 1, borderColor: C.border },
  clearButton:          { position: 'absolute', right: 14, width: 22, height: 22, borderRadius: 11, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  clearButtonText:      { color: C.bg, fontSize: 12, fontWeight: 'bold' },
  searchButton:         { backgroundColor: C.spotify, width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  searchButtonDisabled: { opacity: 0.5 },
  searchButtonText:     { fontSize: 20 },
  resultsContainer:     { maxHeight: 260, backgroundColor: C.card, marginHorizontal: 15, borderRadius: 15, padding: 10 },
  resultsTitle:         { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 8, paddingHorizontal: 10 },
  resultItem:           { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  resultAlbumArt:       { width: 50, height: 50, borderRadius: 8 },
  resultInfo:           { flex: 1 },
  resultName:           { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  resultArtist:         { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  addButton:            { backgroundColor: C.spotify, width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  addButtonDisabled:    { backgroundColor: '#555' },
  addButtonText:        { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  addedBadge:           { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: C.spotify, justifyContent: 'center', alignItems: 'center' },
  addedBadgeText:       { color: C.spotify, fontSize: 16, fontWeight: 'bold' },
  playlistContainer:    { flex: 1, marginTop: 15 },
  playlistHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 },
  playlistTitle:        { fontSize: 16, fontWeight: 'bold', color: theme.colors.text },
  playlistCount:        { fontSize: 14, color: theme.colors.textSecondary },
  emptyPlaylist:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyPlaylistIcon:    { fontSize: 60, marginBottom: 15 },
  emptyPlaylistText:    { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  tracksList:           { paddingHorizontal: 15, paddingBottom: 40 },
  trackItem:            { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 10, gap: 10 },
  trackNumber:          { color: C.muted, fontSize: 16, fontWeight: 'bold', width: 25, textAlign: 'center' },
  trackAlbumArt:        { width: 60, height: 60, borderRadius: 8 },
  trackInfo:            { flex: 1 },
  trackName:            { color: theme.colors.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  trackArtist:          { color: theme.colors.textSecondary, fontSize: 13, marginBottom: 4 },
  trackAddedBy:         { color: C.spotify, fontSize: 11 },
  removeButton:         { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(231,76,60,0.15)', alignItems: 'center', justifyContent: 'center' },
  removeButtonText:     { color: C.danger, fontSize: 14, fontWeight: 'bold' },
  placeholderArt:       { backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  placeholderText:      { fontSize: 20 },
  emptyContainer:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:            { fontSize: 80, marginBottom: 20 },
  emptyTitle:           { fontSize: 24, fontWeight: 'bold', color: theme.colors.text, marginBottom: 15, textAlign: 'center' },
  emptyText:            { fontSize: 16, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: 30 },
  linkButton:           { backgroundColor: C.spotify, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25 },
  linkButtonText:       { color: '#fff', fontSize: 18, fontWeight: 'bold' },
}));