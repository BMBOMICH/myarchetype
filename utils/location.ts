/**
 * Location service
 *
 * Provides permission handling, coordinate retrieval with reverse-geocoding,
 * Haversine distance calculation, and Firestore persistence.
 */

import * as Location from 'expo-location';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { auth, db } from '../firebaseConfig';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UserLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly city: string;
  readonly country: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Mean radius of the Earth in kilometres (WGS-84 average). */
const EARTH_RADIUS_KM = 6_371;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Maximum time (ms) to wait for the device to return a position fix
 * before treating the request as failed.
 */
const LOCATION_TIMEOUT_MS = 15_000;

// ─── Pure helpers ────────────────────────────────────────────────────────────

function toRadians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/**
 * Races `promise` against a timeout. Resolves with the promise's value or
 * rejects with a timeout error — whichever comes first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timed out after ${ms} ms`)),
      ms,
    );
  });

  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timeoutId),
  );
}

// ─── Distance ────────────────────────────────────────────────────────────────

/**
 * Calculates the great-circle distance between two geographic coordinates
 * using the **Haversine** formula.
 *
 * Assumes a perfect sphere (accuracy ≈ 0.3 % vs. WGS-84 ellipsoid).
 *
 * @returns Distance in whole kilometres (rounded).
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a = Math.min(
    1,
    Math.sin(dLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) ** 2,
  );

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c);
}

/**
 * Formats a distance in kilometres into a human-readable string.
 */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return 'Unknown distance';
  if (km < 1) return 'Less than 1 km';
  if (km === 1) return '1 km away';
  if (km < 100) return `${km} km away`;
  return `${km}+ km away`;
}

// ─── Device location ─────────────────────────────────────────────────────────

/**
 * Requests foreground location permission and returns the device's current
 * coordinates together with a best-effort reverse-geocoded city and country.
 *
 * @returns `null` if permission is denied, the request times out, or any
 *          other error occurs — callers should handle gracefully.
 */
export async function requestLocationPermission(): Promise<UserLocation | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== 'granted') {
      if (__DEV__) console.log('Location permission denied.');
      return null;
    }

    const position = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      LOCATION_TIMEOUT_MS,
    );

    const { latitude, longitude } = position.coords;

    // Reverse-geocode — best-effort; failures are non-fatal.
    let city = '';
    let country = '';

    try {
      const addresses = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });
      const address = addresses[0];
      if (address) {
        city = address.city ?? address.subregion ?? '';
        country = address.country ?? '';
      }
    } catch {
      if (__DEV__) console.log('Reverse geocoding unavailable.');
    }

    if (__DEV__) {
      console.log(
        `Location: ${city || '?'}, ${country || '?'} ` +
          `(${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
      );
    }

    return { latitude, longitude, city, country };
  } catch (error) {
    if (__DEV__) console.error('Failed to get location:', error);
    return null;
  }
}

// ─── Firestore persistence ───────────────────────────────────────────────────

/**
 * Saves the given location to the authenticated user's Firestore profile.
 *
 * Uses `serverTimestamp()` so `locationUpdatedAt` is authoritative regardless
 * of client clock skew.
 */
export async function saveUserLocation(
  location: UserLocation,
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        city: location.city,
        country: location.country,
      },
      locationUpdatedAt: serverTimestamp(),
    });

    if (__DEV__) console.log('Location saved.');
    return true;
  } catch (error) {
    if (__DEV__) console.error('Failed to save location:', error);
    return false;
  }
}