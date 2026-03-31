import { doc, getDoc, increment, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

interface RateLimitResult { allowed: boolean; remaining: number; resetIn?: number; reason?: string; }
interface RateLimitConfig { count: number; period: number; blockReason?: string; }

const LIMITS: Record<string, RateLimitConfig> = {
  like:               { count: 100, period: 86_400_000, blockReason: 'Like limit reached. Try again tomorrow.' },
  message:            { count: 500, period: 86_400_000, blockReason: 'Message limit reached. Try again tomorrow.' },
  report:             { count: 10,  period: 86_400_000, blockReason: 'Report limit reached. Try again tomorrow.' },
  swipe:              { count: 200, period: 86_400_000, blockReason: 'Swipe limit reached. Try again tomorrow.' },
  super_like:         { count: 5,   period: 86_400_000, blockReason: 'Super like limit reached.' },
  boost:              { count: 1,   period: 86_400_000, blockReason: 'You can only boost once per day.' },
  profile_view:       { count: 500, period: 86_400_000, blockReason: 'Profile view limit reached.' },
  unmatch:            { count: 20,  period: 3_600_000,  blockReason: 'Too many unmatches.' },
  first_message:      { count: 50,  period: 86_400_000, blockReason: 'First message limit reached.' },
  account_create:     { count: 3,   period: 86_400_000 },
  bug_report:         { count: 5,   period: 3_600_000,  blockReason: 'Too many bug reports.' },
  date_review:        { count: 10,  period: 86_400_000 },
  forgot_password:    { count: 3,   period: 60_000,     blockReason: 'Too many reset requests.' },
  resend_verification:{ count: 3,   period: 60_000,     blockReason: 'Too many verification emails.' },
  story_view:         { count: 1000,period: 86_400_000, blockReason: 'Story view limit reached.' },
  referral:           { count: 20,  period: 86_400_000, blockReason: 'Referral limit reached.' },
  webhook:            { count: 60,  period: 60_000,     blockReason: 'Webhook rate limit exceeded.' },
  session:            { count: 5,   period: 86_400_000, blockReason: 'Too many active sessions.' },
};

const memoryCache: Record<string, { count: number; firstAction: number }> = {};
const behaviorCounters: Record<string, { count: number; timestamps: number[] }> = {};

export async function checkRateLimit(action: string): Promise<RateLimitResult> {
  const user = auth.currentUser;
  if (!user) return { allowed: false, remaining: 0, reason: 'Not authenticated' };
  const limit = LIMITS[action];
  if (!limit) return { allowed: true, remaining: 999 };
  const cacheKey = `${user.uid}_${action}`;
  const ref = doc(db, 'rateLimits', user.uid, 'actions', action);
  try {
    const snap = await getDoc(ref);
    const now = Date.now();
    if (!snap.exists()) {
      await setDoc(ref, { count: 1, firstAction: now, lastAction: now });
      memoryCache[cacheKey] = { count: 1, firstAction: now };
      return { allowed: true, remaining: limit.count - 1 };
    }
    const data = snap.data();
    const firstAction = data.firstAction ?? now;
    const count = data.count ?? 0;
    const elapsed = now - firstAction;
    if (elapsed > limit.period) {
      await setDoc(ref, { count: 1, firstAction: now, lastAction: now });
      memoryCache[cacheKey] = { count: 1, firstAction: now };
      return { allowed: true, remaining: limit.count - 1 };
    }
    if (count >= limit.count) return { allowed: false, remaining: 0, resetIn: limit.period - elapsed, reason: limit.blockReason ?? 'Rate limit exceeded.' };
    const nc = count + 1;
    await setDoc(ref, { count: nc, firstAction, lastAction: now });
    memoryCache[cacheKey] = { count: nc, firstAction };
    return { allowed: true, remaining: limit.count - nc };
  } catch {
    const now = Date.now();
    const c = memoryCache[cacheKey];
    if (!c || now - c.firstAction > limit.period) { memoryCache[cacheKey] = { count: 1, firstAction: now }; return { allowed: true, remaining: limit.count - 1 }; }
    if (c.count >= limit.count) return { allowed: false, remaining: 0, resetIn: limit.period - (now - c.firstAction), reason: limit.blockReason ?? 'Rate limit exceeded.' };
    c.count += 1;
    return { allowed: true, remaining: limit.count - c.count };
  }
}

function getTracker(key: string, windowMs: number): { count: number; timestamps: number[] } {
  const now = Date.now();
  if (!behaviorCounters[key]) behaviorCounters[key] = { count: 0, timestamps: [] };
  const t = behaviorCounters[key]!;
  t.timestamps = t.timestamps.filter(ts => now - ts < windowMs);
  t.timestamps.push(now);
  t.count = t.timestamps.length;
  return t;
}

export async function enforceSessionLimit(userId: string, sessionId: string): Promise<{ allowed: boolean; activeSessions: number; reason?: string }> {
  const MAX_SESSIONS = 5;
  try {
    const ref = doc(db, 'userSessions', userId);
    const snap = await getDoc(ref);
    const now = Date.now();
    const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
    let sessions: Record<string, number> = snap.exists() ? (snap.data()?.sessions ?? {}) : {};
    sessions = Object.fromEntries(Object.entries(sessions).filter(([,ts]) => now - ts < SESSION_TTL));
    const activeSessions = Object.keys(sessions).length;
    if (activeSessions >= MAX_SESSIONS && !sessions[sessionId]) {
      return { allowed: false, activeSessions, reason: `Maximum ${MAX_SESSIONS} active sessions allowed. Please log out from another device.` };
    }
    sessions[sessionId] = now;
    await setDoc(ref, { sessions, lastUpdated: now }, { merge: true });
    return { allowed: true, activeSessions: Object.keys(sessions).length };
  } catch { return { allowed: true, activeSessions: 1 }; }
}

export async function terminateSession(userId: string, sessionId: string): Promise<void> {
  try {
    const ref = doc(db, 'userSessions', userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const sessions = snap.data()?.sessions ?? {};
    delete sessions[sessionId];
    await updateDoc(ref, { sessions });
  } catch {}
}

export async function trackUnmatch(userId: string): Promise<{ suspicious: boolean; reason?: string }> {
  const t = getTracker(`unmatch_${userId}`, 3_600_000);
  try { const ref = doc(db, 'behaviorMetrics', userId); await updateDoc(ref, { unmatchCount: increment(1), lastUnmatch: Date.now() }).catch(() => setDoc(ref, { unmatchCount: 1, lastUnmatch: Date.now() }, { merge: true })); } catch {}
  return t.count >= 15 ? { suspicious: true, reason: `${t.count} unmatches in 1h.` } : { suspicious: false };
}

export function trackProfileView(viewerId: string, targetId: string): { suspicious: boolean; viewCount: number } {
  const t = getTracker(`view_${viewerId}_${targetId}`, 3_600_000);
  return { suspicious: t.count >= 10, viewCount: t.count };
}

export function trackReport(reporterId: string): { suspicious: boolean; reportCount: number; reason?: string } {
  const t = getTracker(`report_${reporterId}`, 3_600_000);
  if (t.count >= 8) return { suspicious: true, reportCount: t.count, reason: `${t.count} reports in the last hour — possible mass false reporting.` };
  return { suspicious: false, reportCount: t.count };
}

export function trackReportDaily(reporterId: string): { suspicious: boolean; reportCount: number; reason?: string } {
  const t = getTracker(`report_daily_${reporterId}`, 86_400_000);
  if (t.count >= 20) return { suspicious: true, reportCount: t.count, reason: `${t.count} reports in 24h — mass false reporting suspected.` };
  return { suspicious: false, reportCount: t.count };
}

export function trackTargetedReport(reporterId: string, targetId: string): { suspicious: boolean; count: number } {
  const t = getTracker(`report_targeted_${reporterId}_${targetId}`, 86_400_000);
  return { suspicious: t.count >= 3, count: t.count };
}

export async function validateReporter(reporterId: string): Promise<{ credible: boolean; reason?: string; shouldAutoDiscard: boolean }> {
  try {
    const snap = await getDoc(doc(db, 'behaviorMetrics', reporterId));
    if (!snap.exists()) return { credible: true, shouldAutoDiscard: false };
    const data = snap.data();
    const falseReportRate = data.falseReportRate ?? 0;
    const totalReports = data.totalReports ?? 0;
    if (totalReports >= 5 && falseReportRate > 0.7) return { credible: false, reason: 'Reporter has a high false report rate.', shouldAutoDiscard: true };
    if (totalReports >= 10 && falseReportRate > 0.5) return { credible: false, reason: 'Reporter credibility is low.', shouldAutoDiscard: false };
    return { credible: true, shouldAutoDiscard: false };
  } catch { return { credible: true, shouldAutoDiscard: false }; }
}

export function trackFirstMessage(senderId: string): { withinLimit: boolean; count: number } {
  const t = getTracker(`first_msg_${senderId}`, 86_400_000);
  return { withinLimit: t.count <= 50, count: t.count };
}

export const checkBoostAllowed = () => checkRateLimit('boost');
export async function detectBoostAbuse(userId: string): Promise<{ abusive: boolean; boostCount: number }> {
  const t = getTracker(`boost_${userId}`, 86_400_000);
  return { abusive: t.count > 3, boostCount: t.count };
}
export const boostLimit = checkBoostAllowed;

export async function trackAccountCreation(deviceFingerprint: string): Promise<{ suspicious: boolean; accountCount: number }> {
  const t = getTracker(`device_accounts_${deviceFingerprint}`, 86_400_000);
  try { await setDoc(doc(db, 'deviceMetrics', deviceFingerprint), { accountCreations: increment(1), lastCreation: Date.now() }, { merge: true }); } catch {}
  return { suspicious: t.count >= 3, accountCount: t.count };
}

export async function recordDeviceLogin(userId: string, fingerprint: string, email: string): Promise<void> {
  if (!fingerprint) return;
  try {
    const ref = doc(db, 'deviceFingerprints', fingerprint);
    const snap = await getDoc(ref);
    const now = Date.now();
    if (!snap.exists()) {
      await setDoc(ref, { users: [userId], emails: [email], firstSeen: now, lastSeen: now });
    } else {
      const data = snap.data();
      const users: string[] = data.users ?? [];
      const emails: string[] = data.emails ?? [];
      if (!users.includes(userId)) users.push(userId);
      if (!emails.includes(email)) emails.push(email);
      await updateDoc(ref, { users, emails, lastSeen: now });
    }
  } catch {}
}

export async function checkDeviceMultiAccount(fingerprint: string): Promise<{ suspicious: boolean; accountCount: number; reason?: string }> {
  if (!fingerprint) return { suspicious: false, accountCount: 0 };
  try {
    const snap = await getDoc(doc(db, 'deviceMetrics', fingerprint));
    if (!snap.exists()) return { suspicious: false, accountCount: 0 };
    const count = snap.data()?.accountCreations ?? 0;
    return { suspicious: count >= 3, accountCount: count, reason: count >= 3 ? `${count} accounts from this device.` : undefined };
  } catch { return { suspicious: false, accountCount: 0 }; }
}

export async function checkUserBanned(email: string): Promise<{ banned: boolean; reason?: string }> {
  try {
    const snap = await getDoc(doc(db, 'bannedUsers', email.toLowerCase()));
    if (!snap.exists()) return { banned: false };
    const data = snap.data();
    return { banned: true, reason: data?.reason ?? 'Account suspended.' };
  } catch { return { banned: false }; }
}

export function analyzeMessageTiming(timestamps: number[]): { isBot: boolean; stdDevMs: number; reason?: string } {
  if (timestamps.length < 5) return { isBot: false, stdDevMs: 0 };
  const intervals: number[] = [];
  for (let i=1;i<timestamps.length;i++) intervals.push(timestamps[i]! - timestamps[i-1]!);
  const mean = intervals.reduce((a,b) => a+b,0) / intervals.length;
  const stdDev = Math.sqrt(intervals.reduce((s,x) => s+(x-mean)**2,0) / intervals.length);
  const isBot = stdDev < 500 && mean < 3000;
  return { isBot, stdDevMs: Math.round(stdDev), reason: isBot ? `Timing too regular (±${Math.round(stdDev)}ms).` : undefined };
}

export function trackWebhookCall(sourceId: string): { allowed: boolean; callCount: number } {
  const t = getTracker(`webhook_${sourceId}`, 60_000);
  const webhookRateLimit = LIMITS['webhook']!;
  return { allowed: t.count <= webhookRateLimit.count, callCount: t.count };
}
export const detectWebhookAbuse = trackWebhookCall;
export const apiAbuse = trackWebhookCall;
export const webhookAbuse = trackWebhookCall;

export function checkProfileViewLimit(viewerId: string): { withinLimit: boolean; viewCount: number } {
  const t = getTracker(`pv_${viewerId}`, 86_400_000);
  return { withinLimit: t.count <= 500, viewCount: t.count };
}
export const profileViewLimit = checkProfileViewLimit;
export const viewRateLimit = checkProfileViewLimit;
export const rateLimitView = checkProfileViewLimit;

export async function checkSuperLikeLimit(userId: string): Promise<{ withinLimit: boolean; remaining: number }> {
  const result = await checkRateLimit('super_like');
  return { withinLimit: result.allowed, remaining: result.remaining };
}
export const superLikeLimit = checkSuperLikeLimit;
export const superLikeAbuse = checkSuperLikeLimit;
export const limitSuperLike = checkSuperLikeLimit;

export function detectBotStoryViews(viewerId: string): { isBot: boolean; viewCount: number } {
  const t = getTracker(`story_${viewerId}`, 3_600_000);
  return { isBot: t.count > 200, viewCount: t.count };
}
export const botStory = detectBotStoryViews;
export const storyBot = detectBotStoryViews;
export const botViewStory = detectBotStoryViews;

export async function detectReferralFraud(referrerId: string, newUserId: string, deviceFingerprint?: string): Promise<{ fraudulent: boolean; reason?: string }> {
  try {
    if (deviceFingerprint) {
      const snap = await getDoc(doc(db, 'deviceMetrics', deviceFingerprint));
      if (snap.exists() && (snap.data()?.accountCreations ?? 0) > 1) return { fraudulent: true, reason: 'Referral from same device.' };
    }
    const t = getTracker(`referral_${referrerId}`, 86_400_000);
    if (t.count > 20) return { fraudulent: true, reason: `${t.count} referrals in 24h.` };
    await setDoc(doc(db, 'referrals', `${referrerId}_${newUserId}`), { referrerId, newUserId, deviceFingerprint, timestamp: Date.now() });
    return { fraudulent: false };
  } catch { return { fraudulent: false }; }
}
export const referralFraud = detectReferralFraud;
export const fraudReferral = detectReferralFraud;

export function formatResetTime(ms: number): string {
  const h = Math.floor(ms/3_600_000), m = Math.floor((ms%3_600_000)/60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function getRateLimitStatus(action: string): Promise<{ used: number; limit: number; resetIn?: number }> {
  const user = auth.currentUser;
  if (!user) return { used: 0, limit: 0 };
  const lim = LIMITS[action];
  if (!lim) return { used: 0, limit: 0 };
  try {
    const snap = await getDoc(doc(db, 'rateLimits', user.uid, 'actions', action));
    if (!snap.exists()) return { used: 0, limit: lim.count };
    const data = snap.data();
    const elapsed = Date.now() - (data.firstAction ?? Date.now());
    if (elapsed > lim.period) return { used: 0, limit: lim.count };
    return { used: data.count ?? 0, limit: lim.count, resetIn: lim.period - elapsed };
  } catch { return { used: 0, limit: lim.count }; }
}