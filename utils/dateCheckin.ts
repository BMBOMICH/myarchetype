import * as Notifications from 'expo-notifications';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface DateCheckin {
  id: string;
  userId: string;
  matchId: string;
  matchName: string;
  location: string;
  startTime: string;
  expectedEndTime: string;
  checkinInterval: number; // minutes
  nextCheckinDue: string;
  emergencyContact?: {
    name: string;
    phone: string;
  };
  status: 'active' | 'completed' | 'missed' | 'emergency';
  checkins: CheckinEvent[];
  createdAt: string;
}

export interface CheckinEvent {
  timestamp: string;
  status: 'ok' | 'extend' | 'end' | 'sos';
  note?: string;
}

export async function startDateCheckin(
  matchId: string,
  matchName: string,
  location: string,
  durationHours: number,
  checkinIntervalMinutes: number = 60,
  emergencyContact?: { name: string; phone: string }
): Promise<{ success: boolean; checkinId?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  try {
    const checkinId = `checkin_${user.uid}_${Date.now()}`;
    const now = new Date();
    const expectedEnd = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
    const nextCheckin = new Date(now.getTime() + checkinIntervalMinutes * 60 * 1000);

    const checkin: DateCheckin = {
      id: checkinId,
      userId: user.uid,
      matchId,
      matchName,
      location,
      startTime: now.toISOString(),
      expectedEndTime: expectedEnd.toISOString(),
      checkinInterval: checkinIntervalMinutes,
      nextCheckinDue: nextCheckin.toISOString(),
      emergencyContact,
      status: 'active',
      checkins: [],
      createdAt: now.toISOString(),
    };

    await setDoc(doc(db, 'dateCheckins', checkinId), checkin);

    // Schedule notification for check-in reminder
    await scheduleCheckinReminder(checkinId, checkinIntervalMinutes);

    return { success: true, checkinId };
  } catch (error: any) {
    console.error('Error starting date check-in:', error);
    return { success: false, error: error.message };
  }
}

async function scheduleCheckinReminder(checkinId: string, minutesFromNow: number): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🛡️ Date Check-in',
        body: 'Time to check in! Let us know you\'re safe.',
        data: { type: 'date_checkin', checkinId },
      },
      trigger: { seconds: minutesFromNow * 60 },
    });
  } catch (error) {
    console.error('Error scheduling check-in reminder:', error);
  }
}

export async function performCheckin(
  checkinId: string,
  status: 'ok' | 'extend' | 'end' | 'sos',
  note?: string,
  extendMinutes?: number
): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  try {
    const checkinRef = doc(db, 'dateCheckins', checkinId);
    const checkinDoc = await getDoc(checkinRef);
    
    if (!checkinDoc.exists()) {
      return { success: false, error: 'Check-in not found' };
    }

    const checkin = checkinDoc.data() as DateCheckin;

    if (checkin.userId !== user.uid) {
      return { success: false, error: 'Not your check-in' };
    }

    const event: CheckinEvent = {
      timestamp: new Date().toISOString(),
      status,
      note,
    };

    const updateData: any = {
      checkins: [...checkin.checkins, event],
    };

    if (status === 'ok') {
      // Schedule next check-in
      const nextCheckin = new Date(Date.now() + checkin.checkinInterval * 60 * 1000);
      updateData.nextCheckinDue = nextCheckin.toISOString();
      await scheduleCheckinReminder(checkinId, checkin.checkinInterval);
    } else if (status === 'extend' && extendMinutes) {
      // Extend the date
      const newEnd = new Date(new Date(checkin.expectedEndTime).getTime() + extendMinutes * 60 * 1000);
      updateData.expectedEndTime = newEnd.toISOString();
      const nextCheckin = new Date(Date.now() + checkin.checkinInterval * 60 * 1000);
      updateData.nextCheckinDue = nextCheckin.toISOString();
      await scheduleCheckinReminder(checkinId, checkin.checkinInterval);
    } else if (status === 'end') {
      // Date completed safely
      updateData.status = 'completed';
    } else if (status === 'sos') {
      // Emergency!
      updateData.status = 'emergency';
      await triggerEmergencyAlert(checkin);
    }

    await updateDoc(checkinRef, updateData);

    return { success: true };
  } catch (error: any) {
    console.error('Error performing check-in:', error);
    return { success: false, error: error.message };
  }
}

async function triggerEmergencyAlert(checkin: DateCheckin): Promise<void> {
  // In a real app, this would:
  // 1. Send SMS to emergency contact
  // 2. Share live location
  // 3. Alert local emergency services
  // For now, we'll just log it
  console.log('🚨 EMERGENCY ALERT:', checkin);

  // You could integrate with Twilio for SMS:
  // await sendEmergencySMS(checkin.emergencyContact?.phone, checkin.location);
}

export async function getActiveCheckin(): Promise<DateCheckin | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const q = query(
      collection(db, 'dateCheckins'),
      where('userId', '==', user.uid),
      where('status', '==', 'active')
    );

    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return null;

    // Return most recent active check-in
    const checkins: DateCheckin[] = [];
    snapshot.forEach(doc => {
      checkins.push(doc.data() as DateCheckin);
    });

    return checkins.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  } catch (error) {
    console.error('Error getting active check-in:', error);
    return null;
  }
}

export async function cancelCheckin(checkinId: string): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    await deleteDoc(doc(db, 'dateCheckins', checkinId));
    return { success: true };
  } catch (error) {
    console.error('Error canceling check-in:', error);
    return { success: false };
  }
}

export function formatCheckinStatus(checkin: DateCheckin): { label: string; color: string; icon: string } {
  const now = new Date();
  const nextDue = new Date(checkin.nextCheckinDue);
  const overdue = now > nextDue;

  if (checkin.status === 'emergency') {
    return { label: 'EMERGENCY', color: '#d9534f', icon: '🚨' };
  }
  if (checkin.status === 'completed') {
    return { label: 'Completed', color: '#5cb85c', icon: '✅' };
  }
  if (overdue) {
    return { label: 'Check-in Overdue!', color: '#e67e22', icon: '⚠️' };
  }
  return { label: 'Active', color: '#53a8b6', icon: '🛡️' };
}

export function getTimeUntilNextCheckin(nextCheckinDue: string): string {
  const now = new Date().getTime();
  const due = new Date(nextCheckinDue).getTime();
  const diff = due - now;

  if (diff <= 0) return 'Now!';

  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}