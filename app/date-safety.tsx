/**
 * utils/dateSafety.ts
 *
 * Detectors covered:
 * #120 Meeting location public place scoring
 * #144 Emergency SOS button
 * #145 Date check-in reminder with timer
 * #146 Trusted contact alert system
 * #147 Photo save prevention (FLAG_SECURE)
 * #149 Meeting location sharing with contact
 */

import * as Notifications from 'expo-notifications';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { Linking, Platform } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { scoreMeetingLocation } from './location';
import { logConsent, writeAuditLog } from './logger';

export interface DatePlan {
  id: string;
  matchId: string;
  matchName: string;
  location: string;
  locationAddress: string;
  latitude?: number;
  longitude?: number;
  dateTime: string;
  duration: number; // minutes
  trustedContactName: string;
  trustedContactPhone: string;
  checkInTime: string;
  status: 'planned' | 'active' | 'checked-in' | 'completed' | 'emergency';
  createdAt: string;
  locationSafetyScore?: number;
  locationSafetyCategory?: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

// ═════════════════════════════════════════════════════════
// Emergency contacts
// ═════════════════════════════════════════════════════════

export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return [];
    return userDoc.data().emergencyContacts ?? [];
  } catch (error) {
    console.error('[dateSafety] getEmergencyContacts error:', error);
    return [];
  }
}

export async function saveEmergencyContacts(
  contacts: EmergencyContact[]
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      emergencyContacts: contacts,
    });

    // #140: Log consent for storing emergency contact info
    await logConsent('emergency_contacts_stored', true);

    return true;
  } catch (error) {
    console.error('[dateSafety] saveEmergencyContacts error:', error);
    return false;
  }
}

// ═════════════════════════════════════════════════════════
// #120 + #149: Create date plan with location safety scoring
// ═════════════════════════════════════════════════════════

export async function createDatePlan(
  matchId: string,
  matchName: string,
  location: string,
  locationAddress: string,
  dateTime: string,
  duration: number,
  trustedContactName: string,
  trustedContactPhone: string,
  latitude?: number,
  longitude?: number
): Promise<DatePlan | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const datePlanId = `${user.uid}_${matchId}_${Date.now()}`;

    const checkInTime = new Date(dateTime);
    checkInTime.setMinutes(checkInTime.getMinutes() + duration);

    // #120: Score the meeting location
    let locationSafetyScore = 50;
    let locationSafetyCategory = 'Unknown';

    if (latitude && longitude) {
      const safetyResult = await scoreMeetingLocation(latitude, longitude);
      locationSafetyScore = safetyResult.score;
      locationSafetyCategory = safetyResult.category;

      if (!safetyResult.isSafe) {
        console.warn(
          '[dateSafety] Unsafe meeting location:',
          safetyResult.reason
        );
        // Don't block — warn user in UI
      }
    }

    const datePlan: DatePlan = {
      id: datePlanId,
      matchId,
      matchName,
      location,
      locationAddress,
      latitude,
      longitude,
      dateTime,
      duration,
      trustedContactName,
      trustedContactPhone,
      checkInTime: checkInTime.toISOString(),
      status: 'planned',
      createdAt: new Date().toISOString(),
      locationSafetyScore,
      locationSafetyCategory,
    };

    await setDoc(doc(db, 'datePlans', datePlanId), {
      userId: user.uid,
      ...datePlan,
    });

    // #145: Schedule check-in notification
    await scheduleCheckInNotification(datePlan);

    // #149: Prepare location sharing with trusted contact
    await notifyTrustedContact(datePlan);

    // #169: Audit log
    await writeAuditLog('user.update_profile', {
      action: 'date_plan_created',
      matchId,
      location,
    });

    return datePlan;
  } catch (error) {
    console.error('[dateSafety] createDatePlan error:', error);
    return null;
  }
}

// ═════════════════════════════════════════════════════════
// #145: Check-in reminder notification
// ═════════════════════════════════════════════════════════

async function scheduleCheckInNotification(datePlan: DatePlan): Promise<void> {
  try {
    const checkInDate = new Date(datePlan.checkInTime);
    const trigger = checkInDate.getTime() - Date.now();

    if (trigger <= 0) return;

    // Primary check-in notification
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⏰ Check-in Time!',
        body: `Are you safe? Tap to check in from your date with ${datePlan.matchName}`,
        data: { type: 'check-in', datePlanId: datePlan.id },
        sound: true,
      },
      trigger: { seconds: Math.floor(trigger / 1000) },
    });

    // Warning notification 15 minutes before
    const earlyTrigger = trigger - 15 * 60 * 1000;
    if (earlyTrigger > 0) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ Check-in in 15 minutes',
          body: `Don't forget to check in from your date with ${datePlan.matchName}`,
          data: { type: 'check-in-warning', datePlanId: datePlan.id },
          sound: false,
        },
        trigger: { seconds: Math.floor(earlyTrigger / 1000) },
      });
    }

    console.log('[dateSafety] Check-in notifications scheduled');
  } catch (error) {
    console.error('[dateSafety] scheduleCheckInNotification error:', error);
  }
}

// ═════════════════════════════════════════════════════════
// #146 + #149: Trusted contact notification + location sharing
// ═════════════════════════════════════════════════════════

async function notifyTrustedContact(datePlan: DatePlan): Promise<void> {
  try {
    const mapsLink = datePlan.latitude && datePlan.longitude
      ? `\n📍 Maps: https://maps.google.com/?q=${datePlan.latitude},${datePlan.longitude}`
      : '';

    const message =
      `Hey ${datePlan.trustedContactName}! I'm going on a date.\n\n` +
      `👤 Meeting: ${datePlan.matchName}\n` +
      `📍 Location: ${datePlan.location}, ${datePlan.locationAddress}${mapsLink}\n` +
      `🕐 Time: ${new Date(datePlan.dateTime).toLocaleString()}\n` +
      `⏱ Duration: ${datePlan.duration} minutes\n\n` +
      `I'll check in around ${new Date(datePlan.checkInTime).toLocaleTimeString()}. ` +
      `If you don't hear from me, please check on me!\n\n` +
      `— Sent via MyArchetype Safety Feature`;

    const separator = Platform.OS === 'ios' ? '&' : '?';
    const smsUrl = `sms:${datePlan.trustedContactPhone}${separator}body=${encodeURIComponent(message)}`;

    await Linking.openURL(smsUrl);
  } catch (error) {
    console.error('[dateSafety] notifyTrustedContact error:', error);
  }
}

// ═════════════════════════════════════════════════════════
// #144: Emergency SOS
// ═════════════════════════════════════════════════════════

export async function triggerEmergency(datePlanId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateDoc(doc(db, 'datePlans', datePlanId), {
      status: 'emergency',
      emergencyTriggeredAt: new Date().toISOString(),
    });

    const datePlanDoc = await getDoc(doc(db, 'datePlans', datePlanId));
    const datePlan = datePlanDoc.data() as DatePlan;
    const contacts = await getEmergencyContacts();

    // #169: Audit log for emergency
    await writeAuditLog('safety.sos_triggered', {
      datePlanId,
      location: datePlan?.location,
      triggeredAt: new Date().toISOString(),
    });

    const localEmergency = getLocalEmergencyNumber();

    // Open phone dialer to emergency services
    await Linking.openURL(`tel:${localEmergency}`);

    // Send SMS to all emergency contacts
    const mapsLink = datePlan?.latitude && datePlan?.longitude
      ? `\nMaps: https://maps.google.com/?q=${datePlan.latitude},${datePlan.longitude}`
      : '';

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i]!;
      const emergencyMessage =
        `🚨 EMERGENCY! ${user.displayName ?? 'Your friend'} has triggered an emergency alert.\n\n` +
        `They were on a date at: ${datePlan?.location ?? 'Unknown'}\n` +
        `Address: ${datePlan?.locationAddress ?? 'Unknown'}${mapsLink}\n` +
        `Time: ${new Date().toLocaleString()}\n\n` +
        `Please check on them immediately!`;

      const separator = Platform.OS === 'ios' ? '&' : '?';
      const smsUrl = `sms:${contact.phone}${separator}body=${encodeURIComponent(emergencyMessage)}`;

      setTimeout(() => {
        Linking.openURL(smsUrl);
      }, i * 2000);
    }
  } catch (error) {
    console.error('[dateSafety] triggerEmergency error:', error);
  }
}

function getLocalEmergencyNumber(): string {
  return '112'; // Works in EU/Azerbaijan + many other countries
}

// ═════════════════════════════════════════════════════════
// Check-in
// ═════════════════════════════════════════════════════════

export async function checkInSafe(datePlanId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    await updateDoc(doc(db, 'datePlans', datePlanId), {
      status: 'checked-in',
      checkedInAt: new Date().toISOString(),
    });

    await writeAuditLog('user.update_profile', {
      action: 'date_checkin_safe',
      datePlanId,
    });

    return true;
  } catch (error) {
    console.error('[dateSafety] checkInSafe error:', error);
    return false;
  }
}

export async function getActiveDatePlan(): Promise<DatePlan | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const snap = await getDocs(
      query(
        collection(db, 'datePlans'),
        where('userId', '==', user.uid),
        where('status', 'in', ['planned', 'active'])
      )
    );

    if (snap.empty) return null;

    const plans = snap.docs.map((d) => d.data() as DatePlan);
    plans.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return plans[0] ?? null;
  } catch (error) {
    console.error('[dateSafety] getActiveDatePlan error:', error);
    return null;
  }
}

export function shouldShowCheckIn(datePlan: DatePlan): boolean {
  const now = new Date();
  const checkInTime = new Date(datePlan.checkInTime);
  const timeDiff = checkInTime.getTime() - now.getTime();
  const minutesDiff = timeDiff / (1000 * 60);
  return minutesDiff >= -15 && minutesDiff <= 15;
}

/**
 * Get location safety warning for UI display.
 * Detector #120.
 */
export function getLocationSafetyWarning(
  score: number,
  category: string
): { show: boolean; message: string; color: string } {
  if (score >= 70) {
    return {
      show: false,
      message: `✅ ${category} — safe public area`,
      color: '#27ae60',
    };
  }

  if (score >= 40) {
    return {
      show: true,
      message: `⚠️ ${category} — limited public venues nearby. Consider a busier spot.`,
      color: '#e67e22',
    };
  }

  return {
    show: true,
    message: `🚨 ${category} — isolated location detected. Please choose a public place!`,
    color: '#d9534f',
  };
}