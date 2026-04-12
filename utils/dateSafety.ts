// utils/dateSafety.ts
import * as Notifications from 'expo-notifications';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { Linking, Platform } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { scoreMeetingLocation } from './location';
import { logConsent, writeAuditLog } from './logger';
import { logger } from './logger';

export interface DatePlan {
  id: string; matchId: string; matchName: string; location: string; locationAddress: string;
  latitude?: number; longitude?: number; dateTime: string; duration: number;
  trustedContactName: string; trustedContactPhone: string; checkInTime: string;
  status: 'planned' | 'active' | 'checked-in' | 'completed' | 'emergency';
  createdAt: string; locationSafetyScore?: number; locationSafetyCategory?: string;
}

export interface EmergencyContact { name: string; phone: string; relationship: string; }

// ── Emergency contacts ───────────────────────────────────
export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    return userDoc.exists() ? (userDoc.data().emergencyContacts ?? []) : [];
  } catch (e) { logger.error('[dateSafety] getEmergencyContacts error:', e); return []; }
}

export async function saveEmergencyContacts(contacts: EmergencyContact[]): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    await updateDoc(doc(db, 'users', user.uid), { emergencyContacts: contacts });
    await logConsent('emergency_contacts_stored', true);
    return true;
  } catch (e) { logger.error('[dateSafety] saveEmergencyContacts error:', e); return false; }
}

// ── #147: Prevent photo saving (FLAG_SECURE) ─────────────
export function enableScreenshotPrevention(): { enabled: boolean; method: string } {
  if (Platform.OS === 'android') {
    try { const { NativeModules } = require('react-native'); NativeModules.FlagSecure?.activate?.(); return { enabled: true, method: 'FLAG_SECURE' }; }
    catch { return { enabled: false, method: 'FLAG_SECURE_unavailable' }; }
  }
  if (Platform.OS === 'ios') return { enabled: true, method: 'ios_secure_field_overlay' };
  return { enabled: false, method: 'unsupported_platform' };
}
export function disableScreenshotPrevention(): void {
  if (Platform.OS === 'android') { try { const { NativeModules } = require('react-native'); NativeModules.FlagSecure?.deactivate?.(); } catch {} }
}
export const preventSave = enableScreenshotPrevention;
export const preventScreenshot = enableScreenshotPrevention;

// ── #120: Safe meeting location validation ───────────────
const UNSAFE_LOCATION_TYPES = ['private_residence', 'hotel', 'motel', 'parking_lot', 'industrial', 'warehouse', 'remote', 'isolated'];
const PUBLIC_LOCATION_TYPES = ['cafe', 'restaurant', 'bar', 'park', 'museum', 'mall', 'shopping'];

export function validateMeetingLocationSafety(lat: number, lng: number, placeName?: string, placeType?: string): { safe: boolean; safetyScore: number; warnings: string[]; suggestions: string[] } {
  const warnings: string[] = [], suggestions: string[] = [];
  let score = 50;
  if (placeType && UNSAFE_LOCATION_TYPES.some(t => placeType.toLowerCase().includes(t))) { warnings.push(`"${placeType}" is not a recommended first-date location.`); score -= 30; }
  if (placeType && PUBLIC_LOCATION_TYPES.some(t => placeType.toLowerCase().includes(t))) score += 25;
  if (placeName && placeName.trim().length > 3) score += 10; else { warnings.push('No venue name provided. Consider meeting at a named, public location.'); score -= 10; }
  if (score < 50) { suggestions.push('Consider meeting at a busy café or restaurant instead.'); suggestions.push('Choose a location with staff present and good lighting.'); suggestions.push('Share the meeting location with a trusted friend.'); }
  return { safe: score >= 40, safetyScore: Math.max(0, Math.min(100, score)), warnings, suggestions };
}

export function getSafeMeetingLocationSuggestions(): string[] {
  return ['Popular café or coffee shop', 'Well-reviewed restaurant', 'Busy public park during daytime', 'Museum or gallery', 'Shopping center food court'];
}

// ── #120 + #149: Create date plan ────────────────────────
export async function createDatePlan(
  matchId: string, matchName: string, location: string, locationAddress: string,
  dateTime: string, duration: number, trustedContactName: string, trustedContactPhone: string,
  latitude?: number, longitude?: number,
): Promise<DatePlan | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const datePlanId = `${user.uid}_${matchId}_${Date.now()}`;
    const checkInTime = new Date(dateTime);
    checkInTime.setMinutes(checkInTime.getMinutes() + duration);
    let locationSafetyScore = 50, locationSafetyCategory = 'Unknown';
    if (latitude && longitude) {
      const safetyResult = await scoreMeetingLocation(latitude, longitude);
      locationSafetyScore = safetyResult.score; locationSafetyCategory = safetyResult.category;
      if (!safetyResult.isSafe) logger.warn('[dateSafety] Unsafe meeting location:', safetyResult.reason);
    }
    const datePlan: DatePlan = { id: datePlanId, matchId, matchName, location, locationAddress, latitude, longitude, dateTime, duration, trustedContactName, trustedContactPhone, checkInTime: checkInTime.toISOString(), status: 'planned', createdAt: new Date().toISOString(), locationSafetyScore, locationSafetyCategory };
    await setDoc(doc(db, 'datePlans', datePlanId), { userId: user.uid, ...datePlan });
    await scheduleCheckInNotification(datePlan);
    await notifyTrustedContact(datePlan);
    await writeAuditLog('user.update_profile', { action: 'date_plan_created', matchId, location });
    return datePlan;
  } catch (e) { logger.error('[dateSafety] createDatePlan error:', e); return null; }
}

// ── #145: Check-in reminder ──────────────────────────────
async function scheduleCheckInNotification(datePlan: DatePlan): Promise<void> {
  try {
    const trigger = new Date(datePlan.checkInTime).getTime() - Date.now();
    if (trigger <= 0) return;
    await Notifications.scheduleNotificationAsync({ content: { title: '⏰ Check-in Time!', body: `Are you safe? Tap to check in from your date with ${datePlan.matchName}`, data: { type: 'check-in', datePlanId: datePlan.id }, sound: true }, trigger: { seconds: Math.floor(trigger / 1000) } });
    const early = trigger - 15 * 60 * 1000;
    if (early > 0) await Notifications.scheduleNotificationAsync({ content: { title: '⚠️ Check-in in 15 minutes', body: `Don't forget to check in from your date with ${datePlan.matchName}`, data: { type: 'check-in-warning', datePlanId: datePlan.id }, sound: false }, trigger: { seconds: Math.floor(early / 1000) } });
  } catch (e) { logger.error('[dateSafety] scheduleCheckInNotification error:', e); }
}

// ── #146 + #149: Trusted contact notification ────────────
async function notifyTrustedContact(datePlan: DatePlan): Promise<void> {
  try {
    const mapsLink = datePlan.latitude && datePlan.longitude ? `\n📍 Maps: https://maps.google.com/?q=${datePlan.latitude},${datePlan.longitude}` : '';
    const message = `Hey ${datePlan.trustedContactName}! I'm going on a date.\n\n👤 Meeting: ${datePlan.matchName}\n📍 Location: ${datePlan.location}, ${datePlan.locationAddress}${mapsLink}\n🕐 Time: ${new Date(datePlan.dateTime).toLocaleString()}\n⏱ Duration: ${datePlan.duration} minutes\n\nI'll check in around ${new Date(datePlan.checkInTime).toLocaleTimeString()}. If you don't hear from me, please check on me!\n\n— Sent via MyArchetype Safety Feature`;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    await Linking.openURL(`sms:${datePlan.trustedContactPhone}${sep}body=${encodeURIComponent(message)}`);
  } catch (e) { logger.error('[dateSafety] notifyTrustedContact error:', e); }
}

// ── #144: Emergency SOS ──────────────────────────────────
export async function triggerEmergency(datePlanId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, 'datePlans', datePlanId), { status: 'emergency', emergencyTriggeredAt: new Date().toISOString() });
    const datePlanDoc = await getDoc(doc(db, 'datePlans', datePlanId));
    const datePlan = datePlanDoc.data() as DatePlan;
    const contacts = await getEmergencyContacts();
    await writeAuditLog('safety.sos_triggered', { datePlanId, location: datePlan?.location, triggeredAt: new Date().toISOString() });
    await Linking.openURL('tel:112');
    const mapsLink = datePlan?.latitude && datePlan?.longitude ? `\nMaps: https://maps.google.com/?q=${datePlan.latitude},${datePlan.longitude}` : '';
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i]!;
      const msg = `🚨 EMERGENCY! ${user.displayName ?? 'Your friend'} has triggered an emergency alert.\n\nThey were on a date at: ${datePlan?.location ?? 'Unknown'}\nAddress: ${datePlan?.locationAddress ?? 'Unknown'}${mapsLink}\nTime: ${new Date().toLocaleString()}\n\nPlease check on them immediately!`;
      const sep = Platform.OS === 'ios' ? '&' : '?';
      setTimeout(() => Linking.openURL(`sms:${c.phone}${sep}body=${encodeURIComponent(msg)}`), i * 2000);
    }
  } catch (e) { logger.error('[dateSafety] triggerEmergency error:', e); }
}

export async function checkInSafe(datePlanId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try { await updateDoc(doc(db, 'datePlans', datePlanId), { status: 'checked-in', checkedInAt: new Date().toISOString() }); await writeAuditLog('user.update_profile', { action: 'date_checkin_safe', datePlanId }); return true; }
  catch (e) { logger.error('[dateSafety] checkInSafe error:', e); return false; }
}

export async function getActiveDatePlan(): Promise<DatePlan | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const snap = await getDocs(query(collection(db, 'datePlans'), where('userId', '==', user.uid), where('status', 'in', ['planned', 'active'])));
    if (snap.empty) return null;
    const plans = snap.docs.map(d => d.data() as DatePlan).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return plans[0] ?? null;
  } catch (e) { logger.error('[dateSafety] getActiveDatePlan error:', e); return null; }
}

export function shouldShowCheckIn(datePlan: DatePlan): boolean {
  const minutesDiff = (new Date(datePlan.checkInTime).getTime() - Date.now()) / 60_000;
  return minutesDiff >= -15 && minutesDiff <= 15;
}

export function getLocationSafetyWarning(score: number, category: string): { show: boolean; message: string; color: string } {
  if (score >= 70) return { show: false, message: `✅ ${category} — safe public area`, color: '#27ae60' };
  if (score >= 40) return { show: true, message: `⚠️ ${category} — limited public venues nearby. Consider a busier spot.`, color: '#e67e22' };
  return { show: true, message: `🚨 ${category} — isolated location detected. Please choose a public place!`, color: '#d9534f' };
}