import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Keyboard,
  RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
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

export default function SharedPlaylistScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ chatId: string; matchId: string; matchName?: string; playlistId?: string }>();
  const chatId            = asString(params.chatId);
  const matchId           = asString(params.matchId);
  const matchName         = asString(params.matchName) || 'Your Match';
  const existingPlaylistId = asString(params.playlistId);

  const [initializing, setInitializing]     = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [playlist, setPlaylist]             = useState<SharedPlaylist | null>(null);
  const [activePlaylistId, setActiveId]     = useState(existingPlaylistId);
  const [searchQuery, setSearchQuery]       = useState('');
  const [searchResults, setSearchResults]   = useState<TrackSearchResult[]>([]);
  const [searching, setSearching]           = useState(false);
  const [addingTrackId, setAddingTrackId]   = useState<string | null>(null);
  const [spotifyToken, setSpotifyToken]     = useState<string | null>(null);
  const [refreshing, setRefreshing]         = useState(false);

  const searchInputRef = useRef<TextInput>(null);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const profile = await getSpotifyProfile();
        if (!cancelled && profile?.accessToken) setSpotifyToken(profile.accessToken);
        if (!chatId && !existingPlaylistId) { if (!cancelled) setError('Missing chat information.'); return; }
        let resolvedId = existingPlaylistId;
        if (!resolvedId && chatId) {
          const result = await getOrCreateSharedPlaylist(chatId, matchId);
          if (result.success && result.playlistId) resolvedId = result.playlistId;
        }
        if (!cancelled) resolvedId ? setActiveId(resolvedId) : setError('Could not load playlist.');
      } catch (err) {
        logger.error('[SharedPlaylist] init error:', err);
        if (!cancelled) setError('Something went wrong.');
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [chatId, matchId, existingPlaylistId]);

  useEffect(() => {
    if (!activePlaylistId) return;
    return subscribeToPlaylist(activePlaylistId, setPlaylist);
  }, [activePlaylistId]);

  const handleSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed || !spotifyToken) return;
    Keyboard.dismiss();
    setSearching(true);
    setSearchResults(await searchSpotifyTracks(trimmed, spotifyToken));
    setSearching(false);
  }, [searchQuery, spotifyToken]);

  const handleAddTrack = useCallback(async (track: TrackSearchResult) => {
    if (!activePlaylistId) return;
    if (playlist?.tracks.some((t) => t.trackId === track.trackId)) {
      Alert.alert('Already Added', `"${track.name}" is already in the playlist.`); return;
    }
    setAddingTrackId(track.trackId);
    const result = await addTrackToPlaylist(activePlaylistId, track);
    setAddingTrackId(null);
    if (result.success) { Alert.alert('Added! 🎵', `"${track.name}" added`); setSearchQuery(''); setSearchResults([]); }
    else Alert.alert('Error', 'Could not add track.');
  }, [activePlaylistId, playlist?.tracks]);

  const handleRemoveTrack = useCallback((track: PlaylistTrack) => {
    if (!activePlaylistId) return;
    Alert.alert('Remove Track', `Remove "${track.name}" from the playlist?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const result = await removeTrackFromPlaylist(activePlaylistId, track);
        if (!result.success) Alert.alert('Error', 'Could not remove track.');
      }},
    ]);
  }, [activePlaylistId]);

  const handleClearSearch = useCallback(() => { setSearchQuery(''); setSearchResults([]); searchInputRef.current?.blur(); }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const profile = await getSpotifyProfile();
    if (profile?.accessToken) setSpotifyToken(profile.accessToken);
    setRefreshing(false);
  }, []);

  const openInSpotify = useCallback(() => {
    if (!playlist?.tracks.length) { Alert.alert('Empty Playlist', 'Add some tracks first!'); return; }
    Alert.alert('Open in Spotify', 'Feature coming soon!');
  }, [playlist?.tracks.length]);

  const renderTrackItem = useCallback(({ item, index }: { item: PlaylistTrack; index: number }) => {
    const isOwn = item.addedBy === uid;
    return (
      <View style={st.trackItem} accessibilityLabel={`${item.name} by ${item.artist}, added by ${isOwn ? 'you' : matchName}`}>
        <Text style={st.trackNumber}>{index + 1}</Text>
        {item.albumArt
          ? <Image source={{ uri: item.albumArt }} style={st.trackAlbumArt} accessibilityLabel={`${item.name} album art`} />
          : <View style={[st.trackAlbumArt, st.placeholderArt]}><Text style={st.placeholderText} accessibilityElementsHidden>🎵</Text></View>
        }
        <View style={st.trackInfo}>
          <Text style={st.trackName} numberOfLines={1}>{item.name}</Text>
          <Text style={st.trackArtist} numberOfLines={1}>{item.artist}</Text>
          <Text style={st.trackAddedBy}>Added by {isOwn ? 'You' : matchName}</Text>
        </View>
        {isOwn && (
          <TouchableOpacity style={st.removeButton} onPress={() => handleRemoveTrack(item)} hitSlop={8} accessibilityLabel={`Remove ${item.name}`} accessibilityRole="button">
            <Text style={st.removeButtonText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [uid, matchName, handleRemoveTrack]);

  const keyExtractor = useCallback((item: PlaylistTrack, index: number) => `${item.trackId}_${item.addedAt}_${index}`, []);

  const trackCount = playlist?.tracks.length ?? 0;
  const trackLabel = `${trackCount} song${trackCount !== 1 ? 's' : ''}`;

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
        <TouchableOpacity style={st.linkButton} onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={st.linkButtonText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!spotifyToken) {
    return (
      <View style={st.container}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityLabel="Go back" accessibilityRole="button">
            <Text style={st.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={st.title} accessibilityRole="header">🎵 Shared Playlist</Text>
          <View style={st.headerSpacer} />
        </View>
        <View style={st.emptyContainer}>
          <Text style={st.emptyIcon} accessibilityElementsHidden>🎵</Text>
          <Text style={st.emptyTitle}>Spotify Required</Text>
          <Text style={st.emptyText}>Link your Spotify account to create shared playlists with your matches!</Text>
          <TouchableOpacity style={st.linkButton} onPress={() => router.push('/social-verification')} accessibilityLabel="Link Spotify account" accessibilityRole="button">
            <Text style={st.linkButtonText}>🎵 Link Spotify</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={st.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={st.title} accessibilityRole="header">🎵 Playlist</Text>
        <TouchableOpacity onPress={openInSpotify} hitSlop={12} accessibilityLabel="Open playlist in Spotify" accessibilityRole="button">
          <Text style={st.openButton}>Open in Spotify</Text>
        </TouchableOpacity>
      </View>

      <View style={st.searchContainer}>
        <View style={st.searchInputWrapper}>
          <TextInput
            ref={searchInputRef} style={st.searchInput}
            placeholder="Search for songs…" placeholderTextColor="#666"
            value={searchQuery} onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch} returnKeyType="search" autoCorrect={false}
            accessibilityLabel="Search for songs"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity style={st.clearButton} onPress={handleClearSearch} hitSlop={6} accessibilityLabel="Clear search" accessibilityRole="button">
              <Text style={st.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[st.searchButton, (!searchQuery.trim() || searching) && st.searchButtonDisabled]}
          onPress={handleSearch} disabled={searching || !searchQuery.trim()}
          accessibilityLabel="Search" accessibilityRole="button"
          accessibilityState={{ disabled: searching || !searchQuery.trim() }}
        >
          {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.searchButtonText}>🔍</Text>}
        </TouchableOpacity>
      </View>

      {searchResults.length > 0 && (
        <View style={st.resultsContainer}>
          <Text style={st.resultsTitle}>Search Results ({searchResults.length})</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {searchResults.map((track) => {
              const isAdding      = addingTrackId === track.trackId;
              const alreadyAdded  = playlist?.tracks.some((t) => t.trackId === track.trackId);
              return (
                <View key={track.trackId} style={st.resultItem} accessibilityLabel={`${track.name} by ${track.artist}`}>
                  {track.albumArt
                    ? <Image source={{ uri: track.albumArt }} style={st.resultAlbumArt} accessibilityLabel={`${track.name} album art`} />
                    : <View style={[st.resultAlbumArt, st.placeholderArt]}><Text style={st.placeholderText} accessibilityElementsHidden>🎵</Text></View>
                  }
                  <View style={st.resultInfo}>
                    <Text style={st.resultName} numberOfLines={1}>{track.name}</Text>
                    <Text style={st.resultArtist} numberOfLines={1}>{track.artist}</Text>
                  </View>
                  {alreadyAdded
                    ? <View style={st.addedBadge} accessibilityLabel="Already added"><Text style={st.addedBadgeText}>✓</Text></View>
                    : (
                      <TouchableOpacity
                        style={[st.addButton, isAdding && st.addButtonDisabled]}
                        onPress={() => handleAddTrack(track)} disabled={isAdding}
                        accessibilityLabel={`Add ${track.name}`} accessibilityRole="button"
                        accessibilityState={{ disabled: isAdding }}
                      >
                        {isAdding ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.addButtonText}>+</Text>}
                      </TouchableOpacity>
                    )
                  }
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
          <FlatList
            data={playlist!.tracks} keyExtractor={keyExtractor} renderItem={renderTrackItem}
            contentContainerStyle={st.tracksList} showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#53a8b6" colors={['#53a8b6']} />}
          />
        )}
      </View>
    </View>
  );
}

const C = { bg: '#1a1a2e', card: '#16213e', border: '#0f3460', primary: '#53a8b6', spotify: '#1DB954', text: '#eee', sub: '#888', muted: '#666', danger: '#e74c3c' } as const;

const st = StyleSheet.create({
  container:            { flex: 1, backgroundColor: C.bg },
  centered:             { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText:          { color: C.sub, marginTop: 12, fontSize: 14 },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: C.card },
  headerSpacer:         { width: 50 },
  backButton:           { color: C.primary, fontSize: 16 },
  title:                { fontSize: 20, fontWeight: 'bold', color: C.text },
  openButton:           { color: C.spotify, fontSize: 14, fontWeight: 'bold' },
  searchContainer:      { flexDirection: 'row', padding: 15, gap: 10 },
  searchInputWrapper:   { flex: 1, position: 'relative', justifyContent: 'center' },
  searchInput:          { backgroundColor: C.card, borderRadius: 25, paddingVertical: 12, paddingHorizontal: 20, paddingRight: 40, color: C.text, fontSize: 16, borderWidth: 1, borderColor: C.border },
  clearButton:          { position: 'absolute', right: 14, width: 22, height: 22, borderRadius: 11, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  clearButtonText:      { color: C.bg, fontSize: 12, fontWeight: 'bold' },
  searchButton:         { backgroundColor: C.spotify, width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  searchButtonDisabled: { opacity: 0.5 },
  searchButtonText:     { fontSize: 20 },
  resultsContainer:     { maxHeight: 260, backgroundColor: C.card, marginHorizontal: 15, borderRadius: 15, padding: 10 },
  resultsTitle:         { color: C.sub, fontSize: 12, marginBottom: 8, paddingHorizontal: 10 },
  resultItem:           { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  resultAlbumArt:       { width: 50, height: 50, borderRadius: 8 },
  resultInfo:           { flex: 1 },
  resultName:           { color: C.text, fontSize: 14, fontWeight: '600' },
  resultArtist:         { color: C.sub, fontSize: 12, marginTop: 2 },
  addButton:            { backgroundColor: C.spotify, width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  addButtonDisabled:    { backgroundColor: '#555' },
  addButtonText:        { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  addedBadge:           { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: C.spotify, justifyContent: 'center', alignItems: 'center' },
  addedBadgeText:       { color: C.spotify, fontSize: 16, fontWeight: 'bold' },
  playlistContainer:    { flex: 1, marginTop: 15 },
  playlistHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 },
  playlistTitle:        { fontSize: 16, fontWeight: 'bold', color: C.text },
  playlistCount:        { fontSize: 14, color: C.sub },
  emptyPlaylist:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyPlaylistIcon:    { fontSize: 60, marginBottom: 15 },
  emptyPlaylistText:    { fontSize: 14, color: C.sub, textAlign: 'center', lineHeight: 20 },
  tracksList:           { paddingHorizontal: 15, paddingBottom: 40 },
  trackItem:            { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 10, gap: 10 },
  trackNumber:          { color: C.muted, fontSize: 16, fontWeight: 'bold', width: 25, textAlign: 'center' },
  trackAlbumArt:        { width: 60, height: 60, borderRadius: 8 },
  trackInfo:            { flex: 1 },
  trackName:            { color: C.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  trackArtist:          { color: C.sub, fontSize: 13, marginBottom: 4 },
  trackAddedBy:         { color: C.spotify, fontSize: 11 },
  removeButton:         { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(231,76,60,0.15)', alignItems: 'center', justifyContent: 'center' },
  removeButtonText:     { color: C.danger, fontSize: 14, fontWeight: 'bold' },
  placeholderArt:       { backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  placeholderText:      { fontSize: 20 },
  emptyContainer:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:            { fontSize: 80, marginBottom: 20 },
  emptyTitle:           { fontSize: 24, fontWeight: 'bold', color: C.text, marginBottom: 15, textAlign: 'center' },
  emptyText:            { fontSize: 16, color: C.sub, textAlign: 'center', lineHeight: 24, marginBottom: 30 },
  linkButton:           { backgroundColor: C.spotify, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 25 },
  linkButtonText:       { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});