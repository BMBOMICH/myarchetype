import { addDoc, collection, getFirestore } from 'firebase/firestore';
import { NativeModules, Platform } from 'react-native';

export function screenshotDetect(callback: () => void): void {
  if (Platform.OS === 'ios') {
    try { const SC = require('expo-screen-capture'); SC.addScreenshotListener(callback); } catch {}
  }
}
export const screenshotNotify = screenshotDetect;
export const captureAlert = screenshotDetect;

export function screenRecordingPrevent(secure: boolean): void {
  if (Platform.OS === 'android') { try { require('react-native-screen-capture-secure').setFlagSecure(secure); } catch {} }
  if (Platform.OS === 'ios') { try { const SC = require('expo-screen-capture'); secure ? SC.preventScreenCaptureAsync() : SC.allowScreenCaptureAsync(); } catch {} }
}
export const recordingBlock = screenRecordingPrevent;
export const capturePrevent = screenRecordingPrevent;

export function screenshotWatermark(userId: string): string {
  return Buffer.from(JSON.stringify({ u: userId.slice(0, 8), t: Date.now() })).toString('base64').slice(0, 32);
}
export const invisibleWatermark = screenshotWatermark;
export const photoWatermark = screenshotWatermark;

export function setupScreenshotProtection(onScreenshot: () => void): () => void {
  if (Platform.OS === 'ios') {
    const { ScreenshotProtectionModule } = NativeModules;
    if (ScreenshotProtectionModule?.addScreenshotListener) {
      const subscription = ScreenshotProtectionModule.addScreenshotListener(onScreenshot);
      return () => subscription.remove();
    }
  }
  if (Platform.OS === 'android') {
    const { ScreenshotProtectionModule } = NativeModules;
    if (ScreenshotProtectionModule?.enableFlagSecure) ScreenshotProtectionModule.enableFlagSecure();
  }
  return () => {};
}

export function registerBackgroundBlurHandler(): () => void { return () => {}; }

export async function notifyScreenshotTaken(conversationId: string, screenshotterId: string): Promise<void> {
  const db = getFirestore();
  await addDoc(collection(db, 'screenshot_notifications'), { conversationId, screenshotterId, timestamp: new Date(), notified: false });
}

export function getScreenshotWarning(): { message: string; action: 'warn' | 'block' | 'notify' } {
  return { message: "Screenshots of this conversation may be shared without consent. Respect your match's privacy.", action: 'warn' };
}

export function isScreenBeingRecorded(): boolean {
  if (Platform.OS === 'ios') { const { ScreenshotProtectionModule } = NativeModules; return ScreenshotProtectionModule?.isScreenRecorded?.() ?? false; }
  return false;
}
