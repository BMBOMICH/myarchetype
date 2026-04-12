// utils/location.ts
import * as Location from 'expo-location';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

const SERVER_URL = process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? process.env.EXPO_PUBLIC_SERVER_URL ?? '';

export interface UserLocation           { readonly latitude: number; readonly longitude: number; readonly city: string; readonly country: string; readonly countryCode?: string; }
export interface LocationSafetyResult  { safe: boolean; warnings: string[]; isSpoofed: boolean; isVPN: boolean; isSanctionedCountry: boolean; ipCountry?: string; gpsCountry?: string; }
export interface ImpossibleTravelResult { impossible: boolean; distanceKm: number; timeMs: number; speedKmh: number; reason?: string; }
export interface MeetingLocationScore  { score: number; isSafe: boolean; category: string; nearbyVenues: number; reason?: string; }

interface IPSafetyResponse { countryCode?: string; isVPN?: boolean; isProxy?: boolean; isTor?: boolean; country?: string; }
interface OverpassResponse { elements?: Array<{ tags?: { total?: number } }> }

const EARTH_RADIUS_KM       = 6_371;
const DEG_TO_RAD            = Math.PI / 180;
const LOCATION_TIMEOUT_MS   = 15_000;
const MAX_TRAVEL_SPEED_KMH  = 1000;
const SANCTIONED_COUNTRIES  = new Set(['KP','IR','SY','CU','RU','BY','MM','SD','VE','YE']);

function toRadians(deg: number): number { return deg * DEG_TO_RAD; }
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { id = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1), dLon = toRadians(lon2 - lon1);
  const a    = Math.min(1, Math.sin(dLat/2)**2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon/2)**2);
  return Math.round(EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return 'Unknown distance';
  if (km < 1)   return 'Less than 1 km';
  if (km === 1) return '1 km away';
  if (km < 100) return `${km} km away`;
  return `${km}+ km away`;
}

export function detectImpossibleTravel(
  loc1: { latitude: number; longitude: number; timestamp: number },
  loc2: { latitude: number; longitude: number; timestamp: number },
): ImpossibleTravelResult {
  const distanceKm  = calculateDistance(loc1.latitude, loc1.longitude, loc2.latitude, loc2.longitude);
  const timeMs      = Math.abs(loc2.timestamp - loc1.timestamp);
  const timeHours   = timeMs / 3_600_000;
  if (timeHours === 0) return { impossible: distanceKm > 1, distanceKm, timeMs, speedKmh: Infinity, reason: distanceKm > 1 ? 'Instant location change detected.' : undefined };
  const speedKmh    = distanceKm / timeHours;
  const impossible  = speedKmh > MAX_TRAVEL_SPEED_KMH && distanceKm > 50;
  return { impossible, distanceKm, timeMs, speedKmh: Math.round(speedKmh), reason: impossible ? `Moved ${distanceKm}km in ${Math.round(timeHours*60)} minutes (${Math.round(speedKmh)} km/h). Possible location spoofing.` : undefined };
}

interface LocationData {
  latitude: number; longitude: number;
  accuracy?: number; altitude?: number | null; mocked?: boolean;
}
export function detectMockLocation(locationData: LocationData): { isMocked: boolean; signals: string[] } {
  const signals: string[] = [];
  if (locationData.mocked === true) signals.push('Device reports mock location');
  const latDecimals = (locationData.latitude.toString().split('.')[1]  ?? '').length;
  const lonDecimals = (locationData.longitude.toString().split('.')[1] ?? '').length;
  if (latDecimals <= 2 || lonDecimals <= 2)                            signals.push('Suspiciously low coordinate precision');
  if (locationData.accuracy === 0 || locationData.accuracy === 1)      signals.push('Suspiciously perfect GPS accuracy');
  if (locationData.altitude === null && Platform.OS === 'android')     signals.push('No altitude data (common in mock locations)');
  return { isMocked: signals.length >= 2, signals };
}

export async function checkIPSafety(gpsCountryCode?: string): Promise<LocationSafetyResult> {
  try {
    const response = await fetch(`${SERVER_URL}/validate-location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gpsCountryCode }) });
    if (!response.ok) return { safe: true, warnings: [], isSpoofed: false, isVPN: false, isSanctionedCountry: false };
    const data: IPSafetyResponse = await response.json() as IPSafetyResponse;
    const warnings: string[]   = [];
    const ipCountryCode        = data.countryCode ?? '';
    const isSanctionedCountry = SANCTIONED_COUNTRIES.has(ipCountryCode);
    if (isSanctionedCountry) warnings.push('Service not available in your region.');
    const isVPN = data.isVPN ?? data.isProxy ?? data.isTor ?? false;
    if (isVPN) warnings.push('VPN or proxy detected. Please disable and try again.');
    let isSpoofed = false;
    if (gpsCountryCode && ipCountryCode && gpsCountryCode !== ipCountryCode) { isSpoofed = true; warnings.push(`Location mismatch: GPS shows ${gpsCountryCode}, IP shows ${ipCountryCode}.`); }
    return { safe: !isSanctionedCountry && !isVPN, warnings, isSpoofed, isVPN, isSanctionedCountry, ipCountry: data.country, gpsCountry: gpsCountryCode };
  } catch (err) { logger.warn('[location] IP safety check error:', err); return { safe: true, warnings: [], isSpoofed: false, isVPN: false, isSanctionedCountry: false }; }
}

export async function scoreMeetingLocation(latitude: number, longitude: number, radiusM = 200): Promise<MeetingLocationScore> {
  try {
    const overpassQuery = `[out:json][timeout:10];(node[amenity](around:${radiusM},${latitude},${longitude});node[leisure](around:${radiusM},${latitude},${longitude});node[shop](around:${radiusM},${latitude},${longitude}););out count;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(overpassQuery)}`, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { score: 50, isSafe: true, category: 'Unknown', nearbyVenues: 0, reason: 'Could not assess location safety.' };
    const data         = await response.json() as OverpassResponse;
    const nearbyVenues = data?.elements?.[0]?.tags?.total ?? 0;
    const score        = nearbyVenues >= 20 ? 100 : nearbyVenues >= 10 ? 85 : nearbyVenues >= 5 ? 70 : nearbyVenues >= 2 ? 50 : nearbyVenues >= 1 ? 30 : 10;
    const category     = nearbyVenues >= 10 ? 'Busy public area' : nearbyVenues >= 5 ? 'Public area' : nearbyVenues >= 1 ? 'Some public venues nearby' : 'Isolated location';
    return { score, isSafe: score >= 50, category, nearbyVenues, reason: score < 50 ? 'This location appears isolated. Choose a busier public place.' : undefined };
  } catch (err) { logger.warn('[location] Meeting location score error:', err); return { score: 50, isSafe: true, category: 'Unknown', nearbyVenues: 0 }; }
}

export async function requestLocationPermission(): Promise<UserLocation | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { logger.log('[location] Permission denied.'); return null; }
    const position  = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), LOCATION_TIMEOUT_MS);
    const { latitude, longitude } = position.coords;
    // expo-location wraps the native result — mocked flag exists at runtime on Android
    const rawPosition = position as Location.LocationObject & { mocked?: boolean };
    const mockCheck = detectMockLocation({ latitude, longitude, accuracy: position.coords.accuracy ?? undefined, altitude: position.coords.altitude, mocked: rawPosition.mocked });
    if (mockCheck.isMocked) logger.warn('[location] Mock GPS detected:', mockCheck.signals);
    let city = '', country = '', countryCode = '';
    try {
      const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
      const address   = addresses[0];
      if (address) { city = address.city ?? address.subregion ?? ''; country = address.country ?? ''; countryCode = address.isoCountryCode ?? ''; }
    } catch (err) { logger.log('[location] Reverse geocoding unavailable:', err); }
    logger.log(`[location] ${city||'?'}, ${country||'?'} (${latitude.toFixed(4)}, ${longitude.toFixed(4)})${mockCheck.isMocked ? ' ⚠️ MOCKED' : ''}`);
    return { latitude, longitude, city, country, countryCode };
  } catch (error) { logger.error('[location] Failed:', error); return null; }
}

export async function saveUserLocation(location: UserLocation): Promise<{ saved: boolean; travelWarning?: ImpossibleTravelResult }> {
  const user = auth.currentUser;
  if (!user) return { saved: false };
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    let travelWarning: ImpossibleTravelResult | undefined;
    if (userDoc.exists()) {
      const data     = userDoc.data() as { location?: { latitude?: number; longitude?: number }; locationUpdatedAt?: { toMillis?: () => number } };
      const lastLoc  = data.location;
      const lastUpdated = data.locationUpdatedAt?.toMillis?.();
      if (lastLoc?.latitude && lastUpdated) {
        const travelCheck = detectImpossibleTravel(
          { latitude: lastLoc.latitude, longitude: lastLoc.longitude ?? 0, timestamp: lastUpdated },
          { latitude: location.latitude, longitude: location.longitude, timestamp: Date.now() },
        );
        if (travelCheck.impossible) { logger.warn('[location] Impossible travel detected:', travelCheck.reason); travelWarning = travelCheck; }
      }
    }
    await updateDoc(doc(db, 'users', user.uid), {
      location: { latitude: location.latitude, longitude: location.longitude, city: location.city, country: location.country, countryCode: location.countryCode },
      locationUpdatedAt: serverTimestamp(),
    });
    logger.log('[location] Saved.');
    return { saved: true, travelWarning };
  } catch (error) { logger.error('[location] Save failed:', error); return { saved: false }; }
}

export function getSafeMeetingLocationSuggestions(): string[] {
  return ['Coffee shop or café','Shopping mall or food court','Public library','Restaurant (lunch or dinner)','Museum or art gallery','Public park (daytime)','Movie theater lobby','Busy bookstore','Hotel lobby bar','Community center'];
}