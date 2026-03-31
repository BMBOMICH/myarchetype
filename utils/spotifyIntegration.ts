import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

WebBrowser.maybeCompleteAuthSession();

// Get from https://developer.spotify.com/dashboard
// Add EXPO_PUBLIC_SPOTIFY_CLIENT_ID to your .env file
const SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';
const REDIRECT_URI = AuthSession.makeRedirectUri();

export interface SpotifyProfile {
  accessToken: string;
  refreshToken: string;
  displayName: string;
  profileUrl: string;
  topArtists: string[];
  topGenres: string[];
  topTracks: string[];
  linkedAt: string;
}

const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const SPOTIFY_SCOPES = [
  'user-read-email',
  'user-top-read',
  'user-read-recently-played',
];

// ── NOTE: useAuthRequest is a React hook ──────────────────
// It MUST be called from a component, not a utility function.
// Export the config instead and let the component handle it.

export function getSpotifyAuthConfig() {
  return {
    clientId: SPOTIFY_CLIENT_ID,
    scopes: SPOTIFY_SCOPES,
    redirectUri: REDIRECT_URI,
    responseType: AuthSession.ResponseType.Token,
    usePKCE: false,
  };
}

export const spotifyDiscovery = SPOTIFY_DISCOVERY;

// ── Call this from your component after promptAsync() succeeds ──

export async function handleSpotifyAuthSuccess(
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Not logged in' };

    if (!accessToken) return { success: false, error: 'No access token' };

    const profileData = await fetchSpotifyProfile(accessToken);

    if (!profileData) {
      return { success: false, error: 'Failed to fetch Spotify profile' };
    }

    await updateDoc(doc(db, 'users', user.uid), {
      spotifyProfile: profileData,
      spotifyLinkedAt: new Date().toISOString(),
    });

    return { success: true };
  } catch (error: any) {
    console.error('[Spotify] Error linking account:', error);
    return { success: false, error: error?.message ?? 'Unknown error' };
  }
}

// ── Fetch profile data from Spotify API ───────────────────

async function fetchSpotifyProfile(
  accessToken: string
): Promise<SpotifyProfile | null> {
  try {
    const headers = { Authorization: `Bearer ${accessToken}` };

    // Fetch in parallel for speed
    const [profileRes, artistsRes, tracksRes] = await Promise.all([
      fetch('https://api.spotify.com/v1/me', { headers }),
      fetch('https://api.spotify.com/v1/me/top/artists?limit=10&time_range=medium_term', { headers }),
      fetch('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term', { headers }),
    ]);

    // Check for API errors
    if (!profileRes.ok) {
      console.error('[Spotify] Profile fetch failed:', profileRes.status);
      return null;
    }

    const [profile, artistsData, tracksData] = await Promise.all([
      profileRes.json(),
      artistsRes.ok ? artistsRes.json() : { items: [] },
      tracksRes.ok ? tracksRes.json() : { items: [] },
    ]);

    // Extract top artists
    const topArtists: string[] = (artistsData.items ?? []).map(
      (a: any) => a.name as string
    );

    // Extract top tracks
    const topTracks: string[] = (tracksData.items ?? []).map(
      (t: any) => `${t.name} - ${t.artists?.[0]?.name ?? 'Unknown'}`
    );

    // Extract and rank genres from top artists
    const genreCounts: Record<string, number> = {};
    for (const artist of artistsData.items ?? []) {
      for (const genre of artist.genres ?? []) {
        genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;
      }
    }
    const topGenres = Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([genre]) => genre);

    return {
      accessToken,
      refreshToken: '',
      displayName: profile.display_name ?? profile.id ?? 'Spotify User',
      profileUrl: profile.external_urls?.spotify ?? '',
      topArtists,
      topGenres,
      topTracks,
      linkedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Spotify] Error fetching profile:', error);
    return null;
  }
}

// ── Unlink Spotify ────────────────────────────────────────

export async function unlinkSpotifyAccount(): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      spotifyProfile: null,
      spotifyLinkedAt: null,
    });
    return { success: true };
  } catch (error: any) {
    console.error('[Spotify] Error unlinking:', error);
    return { success: false, error: error?.message ?? 'Unknown error' };
  }
}

// ── Get cached Spotify profile ────────────────────────────

export async function getSpotifyProfile(): Promise<SpotifyProfile | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return null;
    return userDoc.data().spotifyProfile ?? null;
  } catch (error) {
    console.error('[Spotify] Error getting profile:', error);
    return null;
  }
}

// ── Music compatibility scoring ───────────────────────────

export function calculateMusicCompatibility(
  profile1: SpotifyProfile,
  profile2: SpotifyProfile
): { score: number; sharedArtists: string[]; sharedGenres: string[] } {
  const sharedArtists = profile1.topArtists.filter(a =>
    profile2.topArtists.includes(a)
  );
  const sharedGenres = profile1.topGenres.filter(g =>
    profile2.topGenres.includes(g)
  );

  const maxArtists = Math.max(
    profile1.topArtists.length,
    profile2.topArtists.length,
    1
  );
  const maxGenres = Math.max(
    profile1.topGenres.length,
    profile2.topGenres.length,
    1
  );

  const artistScore = (sharedArtists.length / maxArtists) * 50;
  const genreScore = (sharedGenres.length / maxGenres) * 50;
  const score = Math.round(artistScore + genreScore);

  return { score, sharedArtists, sharedGenres };
}

// ── Check if Spotify is configured ───────────────────────

export function isSpotifyConfigured(): boolean {
  return SPOTIFY_CLIENT_ID.length > 0;
}