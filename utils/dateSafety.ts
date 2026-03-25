import * as Notifications from 'expo-notifications';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Linking } from 'react-native';
import { auth, db } from '../firebaseConfig';

export interface DatePlan {
  id: string;
  matchId: string;
  matchName: string;
  location: string;
  locationAddress: string;
  dateTime: string;
  duration: number; // minutes
  trustedContactName: string;
  trustedContactPhone: string;
  checkInTime: string;
  status: 'planned' | 'active' | 'checked-in' | 'completed' | 'emergency';
  createdAt: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return [];

    const data = userDoc.data();
    return data.emergencyContacts || [];
  } catch (error) {
    console.error('Error getting emergency contacts:', error);
    return [];
  }
}

export async function saveEmergencyContacts(contacts: EmergencyContact[]): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      emergencyContacts: contacts,
    });
    return true;
  } catch (error) {
    console.error('Error saving emergency contacts:', error);
    return false;
  }
}

export async function createDatePlan(
  matchId: string,
  matchName: string,
  location: string,
  locationAddress: string,
  dateTime: string,
  duration: number,
  trustedContactName: string,
  trustedContactPhone: string
): Promise<DatePlan | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const datePlanId = `${user.uid}_${matchId}_${Date.now()}`;
    
    const checkInTime = new Date(dateTime);
    checkInTime.setMinutes(checkInTime.getMinutes() + duration);

    const datePlan: DatePlan = {
      id: datePlanId,
      matchId,
      matchName,
      location,
      locationAddress,
      dateTime,
      duration,
      trustedContactName,
      trustedContactPhone,
      checkInTime: checkInTime.toISOString(),
      status: 'planned',
      createdAt: new Date().toISOString(),
    };

    await setDoc(doc(db, 'datePlans', datePlanId), {
      userId: user.uid,
      ...datePlan,
    });

    // Schedule check-in notification
    await scheduleCheckInNotification(datePlan);

    // Send SMS to trusted contact (if available)
    await notifyTrustedContact(datePlan);

    return datePlan;
  } catch (error) {
    console.error('Error creating date plan:', error);
    return null;
  }
}

async function scheduleCheckInNotification(datePlan: DatePlan): Promise<void> {
  try {
    const checkInDate = new Date(datePlan.checkInTime);
    const trigger = checkInDate.getTime() - Date.now();

    if (trigger > 0) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⏰ Check-in Time!',
          body: `Are you safe? Tap to check in from your date with ${datePlan.matchName}`,
          data: { type: 'check-in', datePlanId: datePlan.id },
          sound: true,
        },
        trigger: {
          seconds: Math.floor(trigger / 1000),
        },
      });
      console.log('Check-in notification scheduled');
    }
  } catch (error) {
    console.error('Error scheduling notification:', error);
  }
}

async function notifyTrustedContact(datePlan: DatePlan): Promise<void> {
  try {
    const message = 
      `Hey! I'm going on a date with ${datePlan.matchName}.\n\n` +
      `📍 Location: ${datePlan.location}, ${datePlan.locationAddress}\n` +
      `🕐 Time: ${new Date(datePlan.dateTime).toLocaleString()}\n` +
      `⏱ Duration: ${datePlan.duration} minutes\n\n` +
      `I'll check in around ${new Date(datePlan.checkInTime).toLocaleTimeString()}. ` +
      `If you don't hear from me, please check on me!`;

    // Note: SMS sending requires native module or third-party service
    // For now, we'll just open SMS app with pre-filled message
    const smsUrl = `sms:${datePlan.trustedContactPhone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`;
    
    console.log('SMS URL prepared:', smsUrl);
    // User will manually send it
    
  } catch (error) {
    console.error('Error notifying trusted contact:', error);
  }
}

export async function checkInSafe(datePlanId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  try {
    await updateDoc(doc(db, 'datePlans', datePlanId), {
      status: 'checked-in',
      checkedInAt: new Date().toISOString(),
    });

    console.log('Checked in as safe');
    return true;
  } catch (error) {
    console.error('Error checking in:', error);
    return false;
  }
}

export async function triggerEmergency(datePlanId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  try {
    // Update status
    await updateDoc(doc(db, 'datePlans', datePlanId), {
      status: 'emergency',
      emergencyTriggeredAt: new Date().toISOString(),
    });

    // Get date plan and emergency contacts
    const datePlanDoc = await getDoc(doc(db, 'datePlans', datePlanId));
    const datePlan = datePlanDoc.data() as DatePlan;

    const contacts = await getEmergencyContacts();

    // Call local emergency number
    const localEmergency = getLocalEmergencyNumber();
    
    alert(
      '🚨 EMERGENCY ACTIVATED\n\n' +
      `Calling ${localEmergency}...\n\n` +
      'Your emergency contacts will be notified.'
    );

    // Open phone dialer
    Linking.openURL(`tel:${localEmergency}`);

    // Send SMS to all emergency contacts
    for (const contact of contacts) {
      const emergencyMessage = 
        `🚨 EMERGENCY! ${user.displayName || 'Your friend'} has triggered an emergency alert.\n\n` +
        `They were on a date at: ${datePlan?.location}\n` +
        `Address: ${datePlan?.locationAddress}\n` +
        `Time: ${new Date().toLocaleString()}\n\n` +
        `Please check on them immediately!`;

      const smsUrl = `sms:${contact.phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(emergencyMessage)}`;
      
      // Open SMS (user sends manually)
      setTimeout(() => {
        Linking.openURL(smsUrl);
      }, 2000);
    }

  } catch (error) {
    console.error('Error triggering emergency:', error);
  }
}

function getLocalEmergencyNumber(): string {
  // TODO: Detect user's country and return appropriate number
  // For now, returning international emergency numbers
  return '112'; // Works in EU, including Azerbaijan
}

export async function getActiveDatePlan(): Promise<DatePlan | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const datePlansSnapshot = await getDocs(
      query(
        collection(db, 'datePlans'),
        where('userId', '==', user.uid),
        where('status', 'in', ['planned', 'active'])
      )
    );

    if (datePlansSnapshot.empty) return null;

    // Return most recent
    const plans = datePlansSnapshot.docs.map(d => d.data() as DatePlan);
    plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return plans[0];
  } catch (error) {
    console.error('Error getting active date plan:', error);
    return null;
  }
}

export function shouldShowCheckIn(datePlan: DatePlan): boolean {
  const now = new Date();
  const checkInTime = new Date(datePlan.checkInTime);
  
  // Show check-in if within 15 minutes of check-in time
  const timeDiff = checkInTime.getTime() - now.getTime();
  const minutesDiff = timeDiff / (1000 * 60);
  
  return minutesDiff >= -15 && minutesDiff <= 15;
}