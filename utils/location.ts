// utils/location.ts
import * as Location from 'expo-location';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger, writeAuditLog } from './logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVER_URL            = process.env['EXPO_PUBLIC_FUNCTIONS_URL'] ?? process.env['EXPO_PUBLIC_SERVER_URL'] ?? '';
const EARTH_RADIUS_KM       = 6_371;
const DEG_TO_RAD            = Math.PI / 180;
const LOCATION_TIMEOUT_MS   = 15_000;
const MAX_TRAVEL_SPEED_KMH  = 1000;

const SANCTIONED_COUNTRIES  = new Set(['KP','IR','SY','CU','RU','BY','MM','SD','VE','YE']);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserLocation {
  readonly latitude:     number;
  readonly longitude:    number;
  readonly city:         string;
  readonly country:      string;
  readonly countryCode?: string;
}

export interface LocationSafetyResult {
  safe:                boolean;
  warnings:            string[];
  isSpoofed:           boolean;
  isVPN:               boolean;
  isSanctionedCountry: boolean;
  ipCountry?:          string;
  gpsCountry?:         string;
}

export interface ImpossibleTravelResult {
  impossible:  boolean;
  distanceKm:  number;
  timeMs:      number;
  speedKmh:    number;
  reason?:     string;
}

export interface MeetingLocationScore {
  score:         number;
  isSafe:        boolean;
  category:      string;
  nearbyVenues:  number;
  reason?:       string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toRadians(deg: number): number {
  return deg * DEG_TO_RAD;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
}

// ─── Distance ─────────────────────────────────────────────────────────────────

export function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.min(
    1,
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2,
  );
  return Math.round(EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return 'Unknown distance';
  if (km < 1)   return 'Less than 1 km';
  if (km === 1) return '1 km away';
  if (km < 100) return `${km} km away`;
  return `${km}+ km away`;
}

// ─── Impossible travel ────────────────────────────────────────────────────────

export function detectImpossibleTravel(
  loc1: { latitude: number; longitude: number; timestamp: number },
  loc2: { latitude: number; longitude: number; timestamp: number },
): ImpossibleTravelResult {
  const dist   = calculateDistance(loc1.latitude, loc1.longitude, loc2.latitude, loc2.longitude);
  const timeMs = Math.abs(loc2.timestamp - loc1.timestamp);
  const timeH  = timeMs / 3_600_000;

  if (timeH === 0) {
    return {
      impossible:  dist > 1,
      distanceKm:  dist,
      timeMs,
      speedKmh:    Infinity,
      reason:      dist > 1 ? 'Instant location change detected.' : undefined,
    };
  }

  const speed      = dist / timeH;
  const impossible = speed > MAX_TRAVEL_SPEED_KMH && dist > 50;

  if (impossible) {
    writeAuditLog('safety.impossible_travel', {
      speedKmh:   Math.round(speed),
      distanceKm: dist,
    }).catch(() => {});
  }

  return {
    impossible,
    distanceKm: dist,
    timeMs,
    speedKmh:   Math.round(speed),
    reason:     impossible
      ? `Moved ${dist}km in ${Math.round(timeH * 60)}m (${Math.round(speed)} km/h).`
      : undefined,
  };
}

export const impossibleTravelDetect = detectImpossibleTravel;
export const teleportDetect         = detectImpossibleTravel;

// ─── Mock location detection ──────────────────────────────────────────────────

interface LocationData {
  latitude:   number;
  longitude:  number;
  accuracy?:  number;
  altitude?:  number | null;
  mocked?:    boolean;
}

export function detectMockLocation(loc: LocationData): { isMocked: boolean; signals: string[] } {
  const signals: string[] = [];

  if (loc.mocked === true) signals.push('Device reports mock location');

  const latDecimals = (loc.latitude.toString().split('.')[1]  ?? '').length;
  const lonDecimals = (loc.longitude.toString().split('.')[1] ?? '').length;
  if (latDecimals <= 2 || lonDecimals <= 2) signals.push('Suspiciously low coordinate precision');

  if (loc.accuracy === 0 || loc.accuracy === 1) signals.push('Suspiciously perfect GPS accuracy');

  if (loc.altitude === null && Platform.OS === 'android') {
    signals.push('No altitude data (common in mock locations)');
  }

  return { isMocked: signals.length >= 2, signals };
}

export const mockLocationDetect = detectMockLocation;
export const gpsSpoofDetect     = detectMockLocation;

// ─── IP safety ────────────────────────────────────────────────────────────────

export async function checkIPSafety(gpsCountryCode?: string): Promise<LocationSafetyResult> {
  try {
    const controller = new AbortController();
    const timerId    = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${SERVER_URL}/validate-location`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ gpsCountryCode }),
      signal:  controller.signal,
    });
    clearTimeout(timerId);

    if (!res.ok) {
      return { safe: true, warnings: [], isSpoofed: false, isVPN: false, isSanctionedCountry: false };
    }

    const d = await res.json() as {
      countryCode?: string;
      isVPN?:       boolean;
      isProxy?:     boolean;
      isTor?:       boolean;
      country?:     string;
    };

    const warnings: string[] = [];
    const ipCC = d.countryCode ?? '';

    const isSanctioned = SANCTIONED_COUNTRIES.has(ipCC);
    if (isSanctioned) warnings.push('Service not available in your region.');

    const isVPN = d.isVPN ?? d.isProxy ?? d.isTor ?? false;
    if (isVPN) warnings.push('VPN or proxy detected.');

    let isSpoofed = false;
    if (gpsCountryCode && ipCC && gpsCountryCode !== ipCC) {
      isSpoofed = true;
      warnings.push(`Location mismatch: GPS ${gpsCountryCode} vs IP ${ipCC}.`);
    }

    return {
      safe:                !isSanctioned && !isVPN,
      warnings,
      isSpoofed,
      isVPN,
      isSanctionedCountry: isSanctioned,
      ipCountry:           d.country,
      gpsCountry:          gpsCountryCode,
    };
  } catch (err: unknown) {
    logger.warn('[location] IP safety check error:', err);
    return { safe: true, warnings: [], isSpoofed: false, isVPN: false, isSanctionedCountry: false };
  }
}

// ─── Meeting location score ───────────────────────────────────────────────────

export async function scoreMeetingLocation(
  lat:     number,
  lon:     number,
  radiusM: number = 200,
): Promise<MeetingLocationScore> {
  try {
    const q = [
      `[out:json][timeout:10];`,
      `(`,
      `node[amenity](around:${radiusM},${lat},${lon});`,
      `node[leisure](around:${radiusM},${lat},${lon});`,
      `node[shop](around:${radiusM},${lat},${lon});`,
      `);out count;`,
    ].join('');

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(q)}`,
      signal:  AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { score: 50, isSafe: true, category: 'Unknown', nearbyVenues: 0, reason: 'Could not assess location safety.' };
    }

    const d = await res.json() as { elements?: Array<{ tags?: { total?: number } }> };
    const n = d?.elements?.[0]?.tags?.total ?? 0;

    const score = n >= 20 ? 100 : n >= 10 ? 85 : n >= 5 ? 70 : n >= 2 ? 50 : n >= 1 ? 30 : 10;
    const cat   = n >= 10 ? 'Busy public area' : n >= 5 ? 'Public area' : n >= 1 ? 'Some public venues' : 'Isolated location';

    return {
      score,
      isSafe:       score >= 50,
      category:     cat,
      nearbyVenues: n,
      reason:       score < 50 ? 'This location appears isolated.' : undefined,
    };
  } catch (err: unknown) {
    logger.warn('[location] Meeting location score error:', err);
    return { score: 50, isSafe: true, category: 'Unknown', nearbyVenues: 0 };
  }
}

export const meetingLocationScore = scoreMeetingLocation;

// ─── Request location permission ──────────────────────────────────────────────

export async function requestLocationPermission(): Promise<UserLocation | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      LOCATION_TIMEOUT_MS,
    );

    const { latitude, longitude } = pos.coords;

    const mock = detectMockLocation({
      latitude,
      longitude,
      accuracy:  pos.coords.accuracy  ?? undefined,
      altitude:  pos.coords.altitude,
      mocked:    (pos as unknown as { mocked?: boolean }).mocked,
    });
    if (mock.isMocked) logger.warn('[location] Mock GPS detected:', mock.signals);

    let city = '', country = '', countryCode = '';
    try {
      const addr = (await Location.reverseGeocodeAsync({ latitude, longitude }))[0];
      if (addr) {
        city        = addr.city        ?? addr.subregion ?? '';
        country     = addr.country     ?? '';
        countryCode = addr.isoCountryCode ?? '';
      }
    } catch { /* non-critical */ }

    return { latitude, longitude, city, country, countryCode };
  } catch (error: unknown) {
    logger.error('[location] Failed:', error);
    return null;
  }
}

// ─── Save user location ───────────────────────────────────────────────────────

export async function saveUserLocation(
  loc: UserLocation,
): Promise<{ saved: boolean; travelWarning?: ImpossibleTravelResult }> {
  const user = auth.currentUser;
  if (!user) return { saved: false };

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    let travelWarning: ImpossibleTravelResult | undefined;

    if (snap.exists()) {
      const d = snap.data() as {
        location?:          { latitude?: number; longitude?: number };
        locationUpdatedAt?: { toMillis?: () => number };
      };
      const last = d.location;
      const ts   = d.locationUpdatedAt?.toMillis?.();

      if (last?.latitude && ts) {
        const chk = detectImpossibleTravel(
          { latitude: last.latitude, longitude: last.longitude ?? 0, timestamp: ts },
          { latitude: loc.latitude,  longitude: loc.longitude,       timestamp: Date.now() },
        );
        if (chk.impossible) travelWarning = chk;
      }
    }

    await updateDoc(doc(db, 'users', user.uid), {
      location: {
        latitude:    loc.latitude,
        longitude:   loc.longitude,
        city:        loc.city,
        country:     loc.country,
        countryCode: loc.countryCode,
      },
      locationUpdatedAt: serverTimestamp(),
    });

    return { saved: true, travelWarning };
  } catch (error: unknown) {
    logger.error('[location] Save failed:', error);
    return { saved: false };
  }
}

// ─── Safe meeting suggestions ─────────────────────────────────────────────────

export function getSafeMeetingLocationSuggestions(): string[] {
  return [
    'Coffee shop or café',
    'Shopping mall or food court',
    'Public library',
    'Restaurant (lunch/dinner)',
    'Museum or art gallery',
    'Public park (daytime)',
    'Movie theater lobby',
    'Busy bookstore',
    'Hotel lobby bar',
    'Community center',
  ];
}
