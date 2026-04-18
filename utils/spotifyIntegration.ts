import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

WebBrowser.maybeCompleteAuthSession();

const SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';
const REDIRECT_URI = AuthSession.makeRedirectUri();

export interface SpotifyProfile {
  accessToken: string; refreshToken: string; displayName: string;
  profileUrl: string; topArtists: string[]; topGenres: string[];
  topTracks: string[]; linkedAt: string;
}

interface SpotifyProfileApiResponse {
  display_name?: string; id?: string;
  external_urls?: { spotify?: string };
}

interface SpotifyArtistItem { name: string; genres?: string[]; }
interface SpotifyTrackItem { name: string; artists?: Array<{ name: string }>; }
interface SpotifyTopArtistsResponse { items?: SpotifyArtistItem[]; }
interface SpotifyTopTracksResponse { items?: SpotifyTrackItem[]; }

const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const SPOTIFY_SCOPES = ['user-read-email', 'user-top-read', 'user-read-recently-played'];

export function getSpotifyAuthConfig() {
  return {
    clientId: SPOTIFY_CLIENT_ID, scopes: SPOTIFY_SCOPES,
    redirectUri: REDIRECT_URI, responseType: AuthSession.ResponseType.Token, usePKCE: false,
  };
}

export const spotifyDiscovery = SPOTIFY_DISCOVERY;

export async function handleSpotifyAuthSuccess(accessToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Not logged in' };
    if (!accessToken) return { success: false, error: 'No access token' };
    const profileData = await fetchSpotifyProfile(accessToken);
    if (!profileData) return { success: false, error: 'Failed to fetch Spotify profile' };
    await updateDoc(doc(db, 'users', user.uid), { spotifyProfile: profileData, spotifyLinkedAt: new Date().toISOString() });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Spotify] Error linking account:', error);
    return { success: false, error: msg };
  }
}

async function fetchSpotifyProfile(accessToken: string): Promise<SpotifyProfile | null> {
  try {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [profileRes, artistsRes, tracksRes] = await Promise.all([
      fetch('https://api.spotify.com/v1/me', { headers }).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),
      fetch('https://api.spotify.com/v1/me/top/artists?limit=10&time_range=medium_term', { headers }),
      fetch('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term', { headers }),
    ]);
    if (!profileRes.ok) { logger.error('[Spotify] Profile fetch failed:', profileRes.status); return null; }
    const [profile, artistsData, tracksData] = await Promise.all([
      profileRes.json().catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }) as Promise<SpotifyProfileApiResponse>,
      artistsRes.ok ? artistsRes.json() as Promise<SpotifyTopArtistsResponse> : Promise.resolve({ items: [] }),
      tracksRes.ok ? tracksRes.json() as Promise<SpotifyTopTracksResponse> : Promise.resolve({ items: [] }),
    ]);
    const topArtists = (artistsData.items ?? []).map(a => a.name);
    const topTracks = (tracksData.items ?? []).map(t => `${t.name} - ${t.artists?.[0]?.name ?? 'Unknown'}`);
    const genreCounts: Record<string, number> = {};
    for (const artist of artistsData.items ?? []) {
      for (const genre of artist.genres ?? []) { genreCounts[genre] = (genreCounts[genre] ?? 0) + 1; }
    }
    const topGenres = Object.entries(genreCounts).sort(([,a],[,b]) => b-a).slice(0,5).map(([genre]) => genre);
    return {
      accessToken, refreshToken: '',
      displayName: profile.display_name ?? profile.id ?? 'Spotify User',
      profileUrl: profile.external_urls?.spotify ?? '',
      topArtists, topGenres, topTracks, linkedAt: new Date().toISOString(),
    };
  } catch (error) { logger.error('[Spotify] Error fetching profile:', error); return null; }
}

export async function unlinkSpotifyAccount(): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    await updateDoc(doc(db, 'users', user.uid), { spotifyProfile: null, spotifyLinkedAt: null });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Spotify] Error unlinking:', error);
    return { success: false, error: msg };
  }
}

export async function getSpotifyProfile(): Promise<SpotifyProfile | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return null;
    return userDoc.data().spotifyProfile as SpotifyProfile ?? null;
  } catch (error) { logger.error('[Spotify] Error getting profile:', error); return null; }
}

export function calculateMusicCompatibility(profile1: SpotifyProfile, profile2: SpotifyProfile): { score: number; sharedArtists: string[]; sharedGenres: string[] } {
  const sharedArtists = profile1.topArtists.filter(a => profile2.topArtists.includes(a));
  const sharedGenres = profile1.topGenres.filter(g => profile2.topGenres.includes(g));
  const maxArtists = Math.max(profile1.topArtists.length, profile2.topArtists.length, 1);
  const maxGenres = Math.max(profile1.topGenres.length, profile2.topGenres.length, 1);
  const score = Math.round((sharedArtists.length / maxArtists) * 50 + (sharedGenres.length / maxGenres) * 50);
  return { score, sharedArtists, sharedGenres };
}

export function isSpotifyConfigured(): boolean { return SPOTIFY_CLIENT_ID.length > 0; }