/**
 * utils/dateCheckin.ts
 * #144 Emergency SOS button
 * #145 Date check-in reminder with timer
 * #146 Trusted contact alert system (missed check-in)
 * #149 Meeting location sharing with contact
 */
import * as Notifications from 'expo-notifications';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { Linking, Platform } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { logger, writeAuditLog } from './logger';

export interface DateCheckin {
  id: string; userId: string; matchId: string; matchName: string;
  location: string; latitude?: number; longitude?: number;
  startTime: string; expectedEndTime: string; checkinInterval: number;
  nextCheckinDue: string; emergencyContact?: { name: string; phone: string };
  status: 'active' | 'completed' | 'missed' | 'emergency';
  checkins: CheckinEvent[]; createdAt: string; missedCheckinAlertSent?: boolean;
}

export interface CheckinEvent { timestamp: string; status: 'ok' | 'extend' | 'end' | 'sos'; note?: string; }

type EmergencyContact = { name: string; phone: string };

export async function startDateCheckin(
  matchId: string, matchName: string, location: string, durationHours: number,
  checkinIntervalMinutes = 60, emergencyContact?: EmergencyContact,
  latitude?: number, longitude?: number
): Promise<{ success: boolean; checkinId?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    const checkinId = `checkin_${user.uid}_${Date.now()}`;
    const now = new Date();
    const expectedEnd = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
    const nextCheckin = new Date(now.getTime() + checkinIntervalMinutes * 60 * 1000);
    const checkin: DateCheckin = {
      id: checkinId, userId: user.uid, matchId, matchName, location, latitude, longitude,
      startTime: now.toISOString(), expectedEndTime: expectedEnd.toISOString(),
      checkinInterval: checkinIntervalMinutes, nextCheckinDue: nextCheckin.toISOString(),
      emergencyContact, status: 'active', checkins: [], createdAt: now.toISOString(), missedCheckinAlertSent: false,
    };
    await setDoc(doc(db, 'dateCheckins', checkinId), checkin);
    await scheduleCheckinReminder(checkinId, matchName, checkinIntervalMinutes);
    await scheduleMissedCheckinAlert(checkinId, matchName, checkinIntervalMinutes + 15, emergencyContact);
    if (emergencyContact) await shareLocationWithContact(emergencyContact, matchName, location, latitude, longitude, nextCheckin.toLocaleTimeString());
    await writeAuditLog('user.update_profile', { action: 'date_checkin_started', checkinId, matchId });
    return { success: true, checkinId };
  } catch (error: unknown) {
    logger.error('[dateCheckin] startDateCheckin error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function scheduleCheckinReminder(checkinId: string, matchName: string, minutesFromNow: number): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🛡️ Date Check-in',
        body: `Time to check in! Are you safe on your date with ${matchName}?`,
        data: { type: 'date_checkin', checkinId },
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: minutesFromNow * 60 },
    });
  } catch (error: unknown) { logger.error('[dateCheckin] scheduleCheckinReminder error:', error); }
}

async function scheduleMissedCheckinAlert(checkinId: string, matchName: string, minutesFromNow: number, emergencyContact?: EmergencyContact): Promise<void> {
  if (!emergencyContact) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ Missed Check-in Alert',
        body: "You missed your check-in! Tap to let your contact know you're safe.",
        data: { type: 'missed_checkin', checkinId, contactPhone: emergencyContact.phone, contactName: emergencyContact.name, matchName },
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: minutesFromNow * 60 },
    });
  } catch (error: unknown) { logger.error('[dateCheckin] scheduleMissedCheckinAlert error:', error); }
}

async function shareLocationWithContact(contact: EmergencyContact, matchName: string, location: string, latitude?: number, longitude?: number, checkInTime?: string): Promise<void> {
  try {
    const mapsLink = latitude && longitude ? `\n📍 Maps: https://maps.google.com/?q=${latitude},${longitude}` : '';
    const message =
      `Hi ${contact.name}! I'm starting a date check-in.\n\n` +
      `👤 With: ${matchName}\n📍 Location: ${location}${mapsLink}\n` +
      `🕐 Check-in due: ${checkInTime ?? 'soon'}\n\n` +
      `If I don't check in, please contact me or emergency services.\n\n— MyArchetype Safety`;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    await Linking.openURL(`sms:${contact.phone}${sep}body=${encodeURIComponent(message)}`);
  } catch (error: unknown) { logger.error('[dateCheckin] shareLocationWithContact error:', error); }
}

export async function performCheckin(
  checkinId: string, status: 'ok' | 'extend' | 'end' | 'sos', note?: string, extendMinutes?: number
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    const checkinRef = doc(db, 'dateCheckins', checkinId);
    const checkinDoc = await getDoc(checkinRef);
    if (!checkinDoc.exists()) return { success: false, error: 'Check-in not found' };
    const checkin = checkinDoc.data() as DateCheckin;
    if (checkin.userId !== user.uid) return { success: false, error: 'Not your check-in' };
    const event: CheckinEvent = { timestamp: new Date().toISOString(), status, note };
    const updateData: Record<string, unknown> = { checkins: [...checkin.checkins, event] };
    if (status === 'ok') {
      const nextCheckin = new Date(Date.now() + checkin.checkinInterval * 60 * 1000);
      updateData.nextCheckinDue = nextCheckin.toISOString();
      updateData.missedCheckinAlertSent = false;
      await scheduleCheckinReminder(checkinId, checkin.matchName, checkin.checkinInterval);
      await scheduleMissedCheckinAlert(checkinId, checkin.matchName, checkin.checkinInterval + 15, checkin.emergencyContact);
    } else if (status === 'extend' && extendMinutes) {
      updateData.expectedEndTime = new Date(new Date(checkin.expectedEndTime).getTime() + extendMinutes * 60 * 1000).toISOString();
      updateData.nextCheckinDue = new Date(Date.now() + checkin.checkinInterval * 60 * 1000).toISOString();
      await scheduleCheckinReminder(checkinId, checkin.matchName, checkin.checkinInterval);
    } else if (status === 'end') {
      updateData.status = 'completed';
      await writeAuditLog('user.update_profile', { action: 'date_checkin_completed', checkinId });
    } else if (status === 'sos') {
      updateData.status = 'emergency';
      await triggerSOSAlert(checkin);
    }
    await updateDoc(checkinRef, updateData);
    return { success: true };
  } catch (error: unknown) {
    logger.error('[dateCheckin] performCheckin error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function triggerSOSAlert(checkin: DateCheckin): Promise<void> {
  const user = auth.currentUser;
  try {
    await writeAuditLog('safety.sos_triggered', { checkinId: checkin.id, location: checkin.location, matchId: checkin.matchId, triggeredAt: new Date().toISOString() });
    await Linking.openURL('tel:112');
    if (checkin.emergencyContact) {
      const mapsLink = checkin.latitude && checkin.longitude ? `\nMaps: https://maps.google.com/?q=${checkin.latitude},${checkin.longitude}` : '';
      const msg =
        `🚨 SOS! ${user?.displayName ?? 'Your friend'} has triggered an emergency alert!\n\n` +
        `They were on a date with: ${checkin.matchName}\nLocation: ${checkin.location}${mapsLink}\n` +
        `Time: ${new Date().toLocaleString()}\n\nPlease call them or emergency services immediately!`;
      const sep = Platform.OS === 'ios' ? '&' : '?';
      setTimeout(() => Linking.openURL(`sms:${checkin.emergencyContact!.phone}${sep}body=${encodeURIComponent(msg)}`), 2000);
    }
  } catch (error: unknown) { logger.error('[dateCheckin] triggerSOSAlert error:', error); }
}

export async function handleMissedCheckin(checkinId: string): Promise<void> {
  try {
    const checkinRef = doc(db, 'dateCheckins', checkinId);
    const checkinDoc = await getDoc(checkinRef);
    if (!checkinDoc.exists()) return;
    const checkin = checkinDoc.data() as DateCheckin;
    if (checkin.status !== 'active' || checkin.missedCheckinAlertSent) return;
    await updateDoc(checkinRef, { status: 'missed', missedCheckinAlertSent: true, missedAt: new Date().toISOString() });
    if (checkin.emergencyContact) {
      const mapsLink = checkin.latitude && checkin.longitude ? `\nLast known location: https://maps.google.com/?q=${checkin.latitude},${checkin.longitude}` : '';
      const msg =
        `⚠️ MISSED CHECK-IN ALERT\n\n${checkin.userId} has missed their check-in from their date.\n\n` +
        `They were at: ${checkin.location}${mapsLink}\nDate started: ${new Date(checkin.startTime).toLocaleString()}\n` +
        `Check-in was due: ${new Date(checkin.nextCheckinDue).toLocaleString()}\n\nPlease try to contact them!`;
      const sep = Platform.OS === 'ios' ? '&' : '?';
      await Linking.openURL(`sms:${checkin.emergencyContact.phone}${sep}body=${encodeURIComponent(msg)}`);
    }
    await writeAuditLog('safety.content_flagged', { type: 'missed_date_checkin', checkinId, location: checkin.location });
  } catch (error: unknown) { logger.error('[dateCheckin] handleMissedCheckin error:', error); }
}

export async function getActiveCheckin(): Promise<DateCheckin | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const snap = await getDocs(query(collection(db, 'dateCheckins'), where('userId', '==', user.uid), where('status', '==', 'active')));
    if (snap.empty) return null;
    return snap.docs.map(d => d.data() as DateCheckin).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  } catch (error: unknown) { logger.error('[dateCheckin] getActiveCheckin error:', error); return null; }
}

export async function cancelCheckin(checkinId: string): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };
  try {
    await deleteDoc(doc(db, 'dateCheckins', checkinId));
    return { success: true };
  } catch (error: unknown) { logger.error('[dateCheckin] cancelCheckin error:', error); return { success: false }; }
}

export function formatCheckinStatus(checkin: DateCheckin): { label: string; color: string; icon: string } {
  const overdue = new Date() > new Date(checkin.nextCheckinDue);
  if (checkin.status === 'emergency') return { label: 'EMERGENCY', color: '#d9534f', icon: '🚨' };
  if (checkin.status === 'completed') return { label: 'Completed', color: '#5cb85c', icon: '✅' };
  if (checkin.status === 'missed') return { label: 'Missed!', color: '#d9534f', icon: '⚠️' };
  if (overdue) return { label: 'Check-in Overdue!', color: '#e67e22', icon: '⚠️' };
  return { label: 'Active', color: '#53a8b6', icon: '🛡️' };
}

export function getTimeUntilNextCheckin(nextCheckinDue: string): string {
  const diff = new Date(nextCheckinDue).getTime() - Date.now();
  if (diff <= 0) return 'Now!';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function isCheckinOverdue(checkin: DateCheckin): boolean {
  return checkin.status === 'active' && new Date() > new Date(checkin.nextCheckinDue);
}

export function getCheckinProgressPercent(checkin: DateCheckin): number {
  const start = new Date(checkin.startTime).getTime();
  const end = new Date(checkin.expectedEndTime).getTime();
  const now = Date.now();
  if (now >= end) return 100;
  if (now <= start) return 0;
  return Math.round(((now - start) / (end - start)) * 100);
}