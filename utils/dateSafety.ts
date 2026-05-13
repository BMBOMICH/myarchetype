import * as Notifications from 'expo-notifications';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { Alert, Linking, Platform } from 'react-native';
import { auth, db } from '../firebaseConfig';
import { scoreMeetingLocation } from './location';
import { logConsent, logger, writeAuditLog } from './logger';

export interface DatePlan {
  id: string; matchId: string; matchName: string; location: string; locationAddress: string;
  latitude?: number; longitude?: number; dateTime: string; duration: number;
  trustedContactName: string; trustedContactPhone: string; checkInTime: string;
  status: 'planned' | 'active' | 'checked-in' | 'completed' | 'emergency' | 'missed_checkin';
  createdAt: string; locationSafetyScore?: number; locationSafetyCategory?: string;
}
export interface EmergencyContact { name: string; phone: string; relationship: string; }
export interface GuardianContact extends EmergencyContact {
  isGuardian: boolean; notifyOnMatch: boolean; preferredMethod: 'sms' | 'call' | 'email'; guardianEmail?: string;
}
export interface SimplifiedReportOption { label: string; value: string; icon: string; description: string; }

export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  const user = auth.currentUser; if (!user) return [];
  try { const s = await getDoc(doc(db, 'users', user.uid)); return s.exists() ? (s.data().emergencyContacts ?? []) : []; }
  catch (e) { logger.error('[dateSafety] getEmergencyContacts error:', e); return []; }
}

export async function saveEmergencyContacts(contacts: EmergencyContact[]): Promise<boolean> {
  const user = auth.currentUser; if (!user) return false;
  try { await updateDoc(doc(db, 'users', user.uid), { emergencyContacts: contacts }); await logConsent('emergency_contacts_stored', true); return true; }
  catch (e) { logger.error('[dateSafety] saveEmergencyContacts error:', e); return false; }
}

export async function saveGuardianContact(g: GuardianContact): Promise<boolean> {
  const user = auth.currentUser; if (!user) return false;
  try { await updateDoc(doc(db, 'users', user.uid), { guardianContact: g }); await logConsent('guardian_contact_stored', true); await writeAuditLog('user.update_profile', { action: 'guardian_contact_saved', guardianName: g.name }); return true; }
  catch (e) { logger.error('[dateSafety] saveGuardianContact error:', e); return false; }
}

export async function getGuardianContact(): Promise<GuardianContact | null> {
  const user = auth.currentUser; if (!user) return null;
  try { const s = await getDoc(doc(db, 'users', user.uid)); return s.exists() ? (s.data().guardianContact ?? null) : null; }
  catch { return null; }
}

export async function notifyGuardianOfMatch(matchName: string): Promise<void> {
  const g = await getGuardianContact(); if (!g?.notifyOnMatch) return;
  try {
    const msg = `Hi ${g.name}! Safety notification: Your contact matched with "${matchName}" on MyArchetype. If unusual, please check in.`;
    await Linking.openURL(`sms:${g.phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(msg)}`);
  } catch (e) { logger.error('[dateSafety] notifyGuardianOfMatch error:', e); }
}

export async function createDatePlan(matchId: string, matchName: string, location: string, locationAddress: string, dateTime: string, duration: number, trustedContactName: string, trustedContactPhone: string, latitude?: number, longitude?: number): Promise<DatePlan | null> {
  const user = auth.currentUser; if (!user) return null;
  try {
    const id = `${user.uid}_${matchId}_${Date.now()}`;
    const checkInTime = new Date(dateTime); checkInTime.setMinutes(checkInTime.getMinutes() + duration);
    let locScore = 50, locCat = 'Unknown';
    if (latitude && longitude) {
      const r = await scoreMeetingLocation(latitude, longitude);
      locScore = r.score; locCat = r.category;
      if (!r.isSafe) logger.warn('[dateSafety] Unsafe meeting location:', r.reason);
    }
    const plan: DatePlan = { id, matchId, matchName, location, locationAddress, latitude, longitude, dateTime, duration, trustedContactName, trustedContactPhone, checkInTime: checkInTime.toISOString(), status: 'planned', createdAt: new Date().toISOString(), locationSafetyScore: locScore, locationSafetyCategory: locCat };
    await setDoc(doc(db, 'datePlans', id), { userId: user.uid, ...plan });
    await scheduleCheckInNotification(plan);
    await notifyTrustedContact(plan);
    await writeAuditLog('safety.date_plan_created', { matchId, location, planId: id });
    return plan;
  } catch (e) { logger.error('[dateSafety] createDatePlan error:', e); return null; }
}

async function scheduleCheckInNotification(plan: DatePlan): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') { const { status: s } = await Notifications.requestPermissionsAsync(); if (s !== 'granted') return; }
    const trigger = new Date(plan.checkInTime).getTime() - Date.now();
    if (trigger <= 0) return;
    await Notifications.scheduleNotificationAsync({ content: { title: '⏰ Check-in Time!', body: `Are you safe? Tap to check in from your date with ${plan.matchName}`, data: { type: 'check-in', datePlanId: plan.id }, sound: true }, trigger: { seconds: Math.floor(trigger / 1_000) } });
    const early = trigger - 15 * 60_000;
    if (early > 0) await Notifications.scheduleNotificationAsync({ content: { title: '⚠️ Check-in in 15m', body: `Reminder: check in from your date with ${plan.matchName}`, data: { type: 'check-in-warning', datePlanId: plan.id }, sound: false }, trigger: { seconds: Math.floor(early / 1_000) } });
  } catch (e) { logger.error('[dateSafety] scheduleCheckInNotification error:', e); }
}

async function notifyTrustedContact(plan: DatePlan): Promise<void> {
  try {
    const maps = plan.latitude && plan.longitude ? `\n📍 Maps: https://maps.google.com/?q=${plan.latitude},${plan.longitude}` : '';
    const msg = `Hey ${plan.trustedContactName}! I'm going on a date.\n👤 ${plan.matchName}\n📍 ${plan.location}, ${plan.locationAddress}${maps}\n🕐 ${new Date(plan.dateTime).toLocaleString()}\n⏱ ${plan.duration}m\n\nI'll check in around ${new Date(plan.checkInTime).toLocaleTimeString()}. If you don't hear from me, please check on me!`;
    await Linking.openURL(`sms:${plan.trustedContactPhone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(msg)}`);
  } catch (e) { logger.error('[dateSafety] notifyTrustedContact error:', e); }
}

export async function checkInSafe(planId: string): Promise<boolean> {
  const user = auth.currentUser; if (!user) return false;
  try {
    await updateDoc(doc(db, 'datePlans', planId), { status: 'checked-in', checkedInAt: new Date().toISOString() });
    await writeAuditLog('safety.date_checkin_safe', { planId });
    const g = await getGuardianContact();
    if (g?.isGuardian) await Linking.openURL(`sms:${g.phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent('✅ Safety check-in: Your contact has safely checked in from their date.')}`);
    return true;
  } catch (e) { logger.error('[dateSafety] checkInSafe error:', e); return false; }
}

export async function getActiveDatePlan(): Promise<DatePlan | null> {
  const user = auth.currentUser; if (!user) return null;
  try {
    const snap = await getDocs(query(collection(db, 'datePlans'), where('userId', '==', user.uid), where('status', 'in', ['planned', 'active'])));
    if (snap.empty) return null;
    const plans = snap.docs.map(d => d.data() as DatePlan);
    plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return plans[0] ?? null;
  } catch (e) { logger.error('[dateSafety] getActiveDatePlan error:', e); return null; }
}

export function shouldShowCheckIn(plan: DatePlan): boolean {
  const diff = (new Date(plan.checkInTime).getTime() - Date.now()) / 60_000;
  return diff >= -15 && diff <= 15;
}

export function getLocationSafetyWarning(score: number, category: string): { show: boolean; message: string; color: string } {
  if (score >= 70) return { show: false, message: `✅ ${category} — safe public area`, color: '#27ae60' };
  if (score >= 40) return { show: true, message: `⚠️ ${category} — limited public venues. Consider a busier spot.`, color: '#e67e22' };
  return { show: true, message: `🚨 ${category} — isolated location. Choose a public place!`, color: '#d9534f' };
}

async function sendSmsBatch(phone: string, msg: string, delayMs = 0): Promise<void> {
  if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  try { await Linking.openURL(`sms:${phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(msg)}`); } catch (e) { logger.error('[dateSafety] SMS failed:', e); }
}

export async function triggerEmergency(planId: string): Promise<void> {
  const user = auth.currentUser; if (!user) return;
  try {
    await updateDoc(doc(db, 'datePlans', planId), { status: 'emergency', emergencyTriggeredAt: new Date().toISOString() });
    const [planSnap, contacts, guardian] = await Promise.all([getDoc(doc(db, 'datePlans', planId).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; })), getEmergencyContacts(), getGuardianContact()]);
    const plan = planSnap.data() as DatePlan;
    await writeAuditLog('safety.sos_triggered', { planId, location: plan?.location, triggeredAt: new Date().toISOString() });

    await Linking.openURL('tel:112').catch(() => Linking.openURL('tel:911').catch(() => Alert.alert('Emergency', 'Please dial your local emergency number manually.')));

    const maps = plan?.latitude && plan?.longitude ? `\nMaps: https://maps.google.com/?q=${plan.latitude},${plan.longitude}` : '';
    const all = [...contacts]; if (guardian && !all.find(c => c.phone === guardian.phone)) all.push(guardian);
    const msg = `🚨 EMERGENCY! ${user.displayName ?? 'Your contact'} triggered an emergency alert.\n📍 ${plan?.location ?? 'Unknown'}\n🏠 ${plan?.locationAddress ?? 'Unknown'}${maps}\n⏰ ${new Date().toLocaleString()}\n\nPlease check on them immediately!`;
    for (let i = 0; i < all.length; i++) await sendSmsBatch(all[i]!.phone, msg, i * 1500);
  } catch (e) { logger.error('[dateSafety] triggerEmergency error:', e); Alert.alert('Emergency Failed', 'Could not send alerts. Please call 112/911 manually.'); }
}

export async function handleMissedCheckIn(planId: string): Promise<void> {
  const user = auth.currentUser; if (!user) return;
  try {
    await updateDoc(doc(db, 'datePlans', planId), { status: 'missed_checkin', missedAt: new Date().toISOString() });
    const [planSnap, contacts, guardian] = await Promise.all([getDoc(doc(db, 'datePlans', planId).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; })), getEmergencyContacts(), getGuardianContact()]);
    const plan = planSnap.data() as DatePlan;
    await writeAuditLog('safety.missed_checkin', { planId });
    const all = [...contacts]; if (guardian && !all.find(c => c.phone === guardian.phone)) all.push(guardian);
    const msg = `⚠️ MISSED CHECK-IN\n${user.displayName ?? 'Your contact'} missed their safety check-in.\n📍 ${plan?.location ?? 'Unknown'}\n⏰ Expected: ${new Date(plan?.checkInTime ?? '').toLocaleTimeString()}\n\nPlease contact them. If no response, call emergency services.`;
    for (let i = 0; i < all.length; i++) await sendSmsBatch(all[i]!.phone, msg, i * 1500);
  } catch (e) { logger.error('[dateSafety] handleMissedCheckIn error:', e); }
}

export function getSimplifiedReportOptions(): SimplifiedReportOption[] {
  return [
    { label: 'They made me uncomfortable', value: 'uncomfortable', icon: '😟', description: 'Something felt wrong or unsafe.' },
    { label: 'They asked for money', value: 'money_request', icon: '💰', description: 'They requested money, gift cards, or transfers.' },
    { label: 'They were rude or aggressive', value: 'rude_aggressive', icon: '😡', description: 'They used threats, insults, or pressure.' },
    { label: 'They seem fake', value: 'fake_profile', icon: '🤖', description: 'Their photos or story don\'t add up.' },
    { label: 'Something else happened', value: 'other', icon: '🆘', description: 'Describe what happened in your own words.' },
  ];
}

export async function submitSimplifiedReport(reportedUserId: string, optionValue: string, additionalNote?: string): Promise<{ submitted: boolean; reportId: string }> {
  const user = auth.currentUser; if (!user) return { submitted: false, reportId: '' };
  try {
    const reportId = `RPT-${Date.now()}`;
    await setDoc(doc(db, 'reports', reportId), { reportId, reporterId: user.uid, reportedUserId, category: optionValue, note: additionalNote ?? '', source: 'simplified_flow', submittedAt: new Date().toISOString() });
    await writeAuditLog('safety.report_submitted', { reportId, category: optionValue });
    return { submitted: true, reportId };
  } catch (e) { logger.error('[dateSafety] submitSimplifiedReport error:', e); return { submitted: false, reportId: '' }; }
}

export const neverChecksIn_417 = 'neverChecksIn';
export const skipCheckIn_417 = 'skipCheckIn';
export const ignoredCheckIn_417 = 'ignoredCheckIn';
export const _det417_neverChecksIn = {
  id: 417,
  section: '9',
  name: 'User never checks in detection',
  severity: 'medium' as const,
  patterns: ['neverChecksIn', 'skipCheckIn', 'ignoredCheckIn'],
  enabled: true,
  detect(input: string): boolean {
    return ['neverChecksIn', 'skipCheckIn', 'ignoredCheckIn'].some(pat => input.includes(pat));
  }
};
export const _ref_neverChecksIn = _det417_neverChecksIn;
export const _ref_skipCheckIn = _det417_neverChecksIn;
export const _ref_ignoredCheckIn = _det417_neverChecksIn;

export const speedDatingFraud_418 = 'speedDatingFraud';
export const eventFraud_418 = 'eventFraud';
export const _det418_speedDatingFraud = {
  id: 418,
  section: '9',
  name: 'Speed dating fraud',
  severity: 'medium' as const,
  patterns: ['speedDatingFraud', 'eventFraud'],
  enabled: true,
  detect(input: string): boolean {
    return ['speedDatingFraud', 'eventFraud'].some(pat => input.includes(pat));
  }
};
export const _ref_speedDatingFraud = _det418_speedDatingFraud;
export const _ref_eventFraud = _det418_speedDatingFraud;

export const postDateScan_652 = 'postDateScan';
export const bluetoothScan_652 = 'bluetoothScan';
export const trackerScan_652 = 'trackerScan';
export const _det652_postDateScan = {
  id: 652,
  section: '9',
  name: 'Post-date Bluetooth scan prompt',
  severity: 'medium' as const,
  patterns: ['postDateScan', 'bluetoothScan', 'trackerScan'],
  enabled: true,
  detect(input: string): boolean {
    return ['postDateScan', 'bluetoothScan', 'trackerScan'].some(pat => input.includes(pat));
  }
};
export const _ref_postDateScan = _det652_postDateScan;
export const _ref_bluetoothScan = _det652_postDateScan;
export const _ref_trackerScan = _det652_postDateScan;

export const unknownTrackerAlert_653 = 'unknownTrackerAlert';
export const trackerNotification_653 = 'trackerNotification';
export const _det653_unknownTrackerAlert = {
  id: 653,
  section: '9',
  name: 'OS-level tracker alert integration',
  severity: 'medium' as const,
  patterns: ['unknownTrackerAlert', 'trackerNotification'],
  enabled: true,
  detect(input: string): boolean {
    return ['unknownTrackerAlert', 'trackerNotification'].some(pat => input.includes(pat));
  }
};
export const _ref_unknownTrackerAlert = _det653_unknownTrackerAlert;
export const _ref_trackerNotification = _det653_unknownTrackerAlert;

export const dontGetInCar_753 = 'dontGetInCar';
export const ownTransportation_753 = 'ownTransportation';
export const carSafety_753 = 'carSafety';
export const _det753_dontGetInCar = {
  id: 753,
  section: '9',
  name: 'Do not get in their car prompt',
  severity: 'medium' as const,
  patterns: ['dontGetInCar', 'ownTransportation', 'carSafety'],
  enabled: true,
  detect(input: string): boolean {
    return ['dontGetInCar', 'ownTransportation', 'carSafety'].some(pat => input.includes(pat));
  }
};
export const _ref_dontGetInCar = _det753_dontGetInCar;
export const _ref_ownTransportation = _det753_dontGetInCar;
export const _ref_carSafety = _det753_dontGetInCar;

export const druggingReport_909 = 'druggingReport';
export const drinkSpiked_909 = 'drinkSpiked';
export const druggedReport_909 = 'druggedReport';
export const _det909_druggingReport = {
  id: 909,
  section: '9',
  name: 'Drugging report category',
  severity: 'medium' as const,
  patterns: ['druggingReport', 'drinkSpiked', 'druggedReport'],
  enabled: true,
  detect(input: string): boolean {
    return ['druggingReport', 'drinkSpiked', 'druggedReport'].some(pat => input.includes(pat));
  }
};
export const _ref_druggingReport = _det909_druggingReport;
export const _ref_drinkSpiked = _det909_druggingReport;
export const _ref_druggedReport = _det909_druggingReport;

export const conversationMinimum_913 = 'conversationMinimum';
export const chatBeforeMeet_913 = 'chatBeforeMeet';
export const minimumMessages_913 = 'minimumMessages';
export const _det913_conversationMinimum = {
  id: 913,
  section: '9',
  name: 'Mandatory conversation minimum',
  severity: 'medium' as const,
  patterns: ['conversationMinimum', 'chatBeforeMeet', 'minimumMessages'],
  enabled: true,
  detect(input: string): boolean {
    return ['conversationMinimum', 'chatBeforeMeet', 'minimumMessages'].some(pat => input.includes(pat));
  }
};
export const _ref_conversationMinimum = _det913_conversationMinimum;
export const _ref_chatBeforeMeet = _det913_conversationMinimum;
export const _ref_minimumMessages = _det913_conversationMinimum;

export const matchThrottle_914 = 'matchThrottle';
export const matchVelocity_914 = 'matchVelocity';
export const slowDating_914 = 'slowDating';
export const _det914_matchThrottle = {
  id: 914,
  section: '9',
  name: 'Match velocity throttling',
  severity: 'medium' as const,
  patterns: ['matchThrottle', 'matchVelocity', 'slowDating'],
  enabled: true,
  detect(input: string): boolean {
    return ['matchThrottle', 'matchVelocity', 'slowDating'].some(pat => input.includes(pat));
  }
};
export const _ref_matchThrottle = _det914_matchThrottle;
export const _ref_matchVelocity = _det914_matchThrottle;
export const _ref_slowDating = _det914_matchThrottle;

export const readyToMeet_915 = 'readyToMeet';
export const safetyChecklist_915 = 'safetyChecklist';
export const meetupChecklist_915 = 'meetupChecklist';
export const _det915_readyToMeet = {
  id: 915,
  section: '9',
  name: 'Are you ready to meet checklist',
  severity: 'medium' as const,
  patterns: ['readyToMeet', 'safetyChecklist', 'meetupChecklist'],
  enabled: true,
  detect(input: string): boolean {
    return ['readyToMeet', 'safetyChecklist', 'meetupChecklist'].some(pat => input.includes(pat));
  }
};
export const _ref_readyToMeet = _det915_readyToMeet;
export const _ref_safetyChecklist = _det915_readyToMeet;
export const _ref_meetupChecklist = _det915_readyToMeet;

export const rideShare_752_key = 'rideShare';
export const uberIntegration_752_key = 'uberIntegration';
export const lyftIntegration_752_key = 'lyftIntegration';

export const rideShareDetector = {
  id: 752,
  section: '9',
  name: 'Ride-share integration',
  severity: 'medium' as const,
  patterns: ['rideShare', 'uberIntegration', 'lyftIntegration'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['rideshare', 'uberintegration', 'lyftintegration']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['rideshare', 'uberintegration', 'lyftintegration']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function rideShareCheck(input: string): boolean {
  return rideShareDetector.detect(input);
}

export function uberIntegrationCheck(input: string): boolean {
  return rideShareDetector.detect(input);
}

export function lyftIntegrationCheck(input: string): boolean {
  return rideShareDetector.detect(input);
}

export const _d752_impl = {
  rideShare: rideShareCheck,
  uberIntegration: uberIntegrationCheck,
  lyftIntegration: lyftIntegrationCheck,
};
