import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

WebBrowser.maybeCompleteAuthSession();

// Replace with your Spotify app credentials from https://developer.spotify.com/dashboard
const SPOTIFY_CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID';
const REDIRECT_URI = AuthSession.makeRedirectUri({ useProxy: true });

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

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

export async function linkSpotifyAccount(): Promise<{ success: boolean; error?: string }> {
  try {
    const [request, response, promptAsync] = AuthSession.useAuthRequest(
      {
        clientId: SPOTIFY_CLIENT_ID,
        scopes: ['user-read-email', 'user-top-read', 'user-read-recently-played'],
        redirectUri: REDIRECT_URI,
        responseType: AuthSession.ResponseType.Token,
      },
      discovery
    );

    const result = await promptAsync();

    if (result.type === 'success') {
      const { access_token } = result.params;
      
      // Fetch Spotify profile data
      const profileData = await fetchSpotifyProfile(access_token);
      
      if (!profileData) {
        return { success: false, error: 'Failed to fetch profile' };
      }

      // Save to Firestore
      const user = auth.currentUser;
      if (!user) return { success: false, error: 'Not logged in' };

      await updateDoc(doc(db, 'users', user.uid), {
        spotifyProfile: profileData,
      });

      return { success: true };
    }

    return { success: false, error: 'Authorization cancelled' };
  } catch (error: any) {
    console.error('Error linking Spotify:', error);
    return { success: false, error: error.message };
  }
}

async function fetchSpotifyProfile(accessToken: string): Promise<SpotifyProfile | null> {
  try {
    // Get user profile
    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json();

    // Get top artists
    const artistsRes = await fetch('https://api.spotify.com/v1/me/top/artists?limit=10&time_range=medium_term', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const artistsData = await artistsRes.json();
    const topArtists = artistsData.items.map((a: any) => a.name);

    // Get top tracks
    const tracksRes = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=medium_term', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const tracksData = await tracksRes.json();
    const topTracks = tracksData.items.map((t: any) => `${t.name} - ${t.artists[0].name}`);

    // Extract genres from top artists
    const allGenres = artistsData.items.flatMap((a: any) => a.genres);
    const genreCounts: { [key: string]: number } = {};
    allGenres.forEach((g: string) => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
    const topGenres = Object.entries(genreCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([genre]) => genre);

    return {
      accessToken,
      refreshToken: '', // Expo doesn't support refresh tokens easily
      displayName: profile.display_name,
      profileUrl: profile.external_urls.spotify,
      topArtists,
      topGenres,
      topTracks,
      linkedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error fetching Spotify profile:', error);
    return null;
  }
}

export async function unlinkSpotifyAccount(): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      spotifyProfile: null,
    });
    return { success: true };
  } catch (error) {
    console.error('Error unlinking Spotify:', error);
    return { success: false };
  }
}

export async function getSpotifyProfile(): Promise<SpotifyProfile | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return null;

    return userDoc.data().spotifyProfile || null;
  } catch (error) {
    console.error('Error getting Spotify profile:', error);
    return null;
  }
}

export function calculateMusicCompatibility(
  profile1: SpotifyProfile,
  profile2: SpotifyProfile
): { score: number; sharedArtists: string[]; sharedGenres: string[] } {
  const sharedArtists = profile1.topArtists.filter(a => profile2.topArtists.includes(a));
  const sharedGenres = profile1.topGenres.filter(g => profile2.topGenres.includes(g));

  const artistScore = (sharedArtists.length / Math.max(profile1.topArtists.length, profile2.topArtists.length)) * 50;
  const genreScore = (sharedGenres.length / Math.max(profile1.topGenres.length, profile2.topGenres.length)) * 50;

  const score = Math.round(artistScore + genreScore);

  return { score, sharedArtists, sharedGenres };
}