import {
    arrayRemove,
    arrayUnion,
    doc,
    getDoc,
    onSnapshot,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

// ─── Types ──────────────────────────────────────────────

export interface PlaylistTrack {
  trackId: string;
  name: string;
  artist: string;
  albumArt: string;
  addedBy: string;
  addedAt: string;
  spotifyUri: string;
}

/** Track data before it's been assigned to a user (search results) */
export type TrackSearchResult = Omit<PlaylistTrack, 'addedBy' | 'addedAt'>;

export interface SharedPlaylist {
  id: string;
  chatId: string;
  matchId: string;
  createdBy: string;
  tracks: PlaylistTrack[];
  createdAt: string;
  lastUpdated: string;
}

/** Typed shape of a single track object from Spotify's Web API */
interface SpotifyTrackItem {
  id: string;
  name: string;
  uri: string;
  artists: Array<{ name: string }>;
  album: { images: Array<{ url: string }> };
}

interface SpotifySearchResponse {
  tracks?: { items?: SpotifyTrackItem[] };
}

// ─── Helpers ────────────────────────────────────────────

const COLLECTION = 'sharedPlaylists' as const;

function playlistRef(id: string) {
  return doc(db, COLLECTION, id);
}

function requireAuth() {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  return user;
}

function timestamp() {
  return new Date().toISOString();
}

// ─── Playlist CRUD ──────────────────────────────────────

/**
 * Returns an existing playlist for the given chat,
 * or creates a fresh one if none exists yet.
 */
export async function getOrCreateSharedPlaylist(
  chatId: string,
  matchId: string
): Promise<{ success: boolean; playlistId?: string }> {
  try {
    const playlistId = `playlist_${chatId}`;
    const snap = await getDoc(playlistRef(playlistId));

    if (snap.exists()) return { success: true, playlistId };

    // Doesn't exist yet → create it
    return createSharedPlaylist(chatId, matchId);
  } catch (error) {
    console.error('[SharedPlaylist] getOrCreate error:', error);
    return { success: false };
  }
}

export async function createSharedPlaylist(
  chatId: string,
  matchId: string
): Promise<{ success: boolean; playlistId?: string }> {
  try {
    const user = requireAuth();
    const playlistId = `playlist_${chatId}`;
    const now = timestamp();

    const playlist: SharedPlaylist = {
      id: playlistId,
      chatId,
      matchId,
      createdBy: user.uid,
      tracks: [],
      createdAt: now,
      lastUpdated: now,
    };

    await setDoc(playlistRef(playlistId), playlist);
    return { success: true, playlistId };
  } catch (error) {
    console.error('[SharedPlaylist] create error:', error);
    return { success: false };
  }
}

export async function getSharedPlaylist(
  playlistId: string
): Promise<SharedPlaylist | null> {
  try {
    const snap = await getDoc(playlistRef(playlistId));
    return snap.exists() ? (snap.data() as SharedPlaylist) : null;
  } catch (error) {
    console.error('[SharedPlaylist] get error:', error);
    return null;
  }
}

/** Real‑time listener – returns an unsubscribe function. */
export function subscribeToPlaylist(
  playlistId: string,
  onUpdate: (playlist: SharedPlaylist | null) => void
) {
  return onSnapshot(
    playlistRef(playlistId),
    (snap) => onUpdate(snap.exists() ? (snap.data() as SharedPlaylist) : null),
    (error) => {
      console.error('[SharedPlaylist] subscription error:', error);
      onUpdate(null);
    }
  );
}

export async function addTrackToPlaylist(
  playlistId: string,
  track: TrackSearchResult
): Promise<{ success: boolean }> {
  try {
    const user = requireAuth();

    const fullTrack: PlaylistTrack = {
      ...track,
      addedBy: user.uid,
      addedAt: timestamp(),
    };

    await updateDoc(playlistRef(playlistId), {
      tracks: arrayUnion(fullTrack),
      lastUpdated: timestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error('[SharedPlaylist] addTrack error:', error);
    return { success: false };
  }
}

export async function removeTrackFromPlaylist(
  playlistId: string,
  track: PlaylistTrack
): Promise<{ success: boolean }> {
  try {
    requireAuth();

    await updateDoc(playlistRef(playlistId), {
      tracks: arrayRemove(track),
      lastUpdated: timestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error('[SharedPlaylist] removeTrack error:', error);
    return { success: false };
  }
}

// ─── Spotify Search ─────────────────────────────────────

export async function searchSpotifyTracks(
  query: string,
  accessToken: string,
  limit = 10
): Promise<TrackSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const url =
      `https://api.spotify.com/v1/search` +
      `?q=${encodeURIComponent(trimmed)}` +
      `&type=track` +
      `&limit=${limit}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error(
        `[Spotify] search failed (${response.status}):`,
        await response.text()
      );
      return [];
    }

    const data: SpotifySearchResponse = await response.json();
    const items = data.tracks?.items;
    if (!items?.length) return [];

    return items.map((item) => ({
      trackId: item.id,
      name: item.name,
      artist: item.artists[0]?.name ?? 'Unknown Artist',
      albumArt: item.album.images[0]?.url ?? '',
      spotifyUri: item.uri,
    }));
  } catch (error) {
    console.error('[Spotify] search error:', error);
    return [];
  }
}