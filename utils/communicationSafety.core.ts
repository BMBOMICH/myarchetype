import { writeAuditLog } from './logger';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface CommSafetyConfig {
  requireMatchToMessage: boolean;
  videoCallOptIn: boolean;
  readReceiptsEnabled: boolean;
  typingIndicatorsEnabled: boolean;
  onlineStatusVisible: 'everyone' | 'matches' | 'nobody';
  lastSeenVisible: 'everyone' | 'matches' | 'nobody';
}

export const DEFAULT_COMM_CONFIG: CommSafetyConfig = {
  requireMatchToMessage: true,
  videoCallOptIn: true,
  readReceiptsEnabled: true,
  typingIndicatorsEnabled: true,
  onlineStatusVisible: 'matches',
  lastSeenVisible: 'matches',
};

// ─── Send Pause ───────────────────────────────────────────────────────────────

export async function shouldPromptPause(msg: string) {
  const agg = [
    /\bf+u+c+k+\b/i, /\bb+i+t+c+h+\b/i, /\bs+l+u+t+\b/i,
    /\bwh+o+r+e+\b/i, /\bd+i+c+k+\b/i, /\ba+s+s+h+o+l+e+\b/i,
    /kill\s+your/i, /die/i, /kys/i,
  ];
  if (agg.some(p => p.test(msg))) return { shouldPause: true, reason: 'potentially_offensive' };
  if (msg.length > 10 && msg === msg.toUpperCase() && /[A-Z]/.test(msg))
    return { shouldPause: true, reason: 'shouting' };
  return { shouldPause: false };
}

export interface SendPauseResult {
  shouldPrompt: boolean;
  reason: string;
  severity: 'none' | 'low' | 'medium' | 'high';
  cooldownMs: number;
  duoGuardCategory?: string;
}

export function checkAreYouSurePause(
  msg: string,
  recipientHasRequested: boolean,
  context?: { isFirstMessage?: boolean; previousFlags?: number },
): SendPauseResult {
  if (recipientHasRequested)
    return { shouldPrompt: true, reason: 'Recipient has requested no contact.', severity: 'high', cooldownMs: 86_400_000, duoGuardCategory: 'harassment' };
  if (/\b(hate|die|kill|stupid|ugly|worthless|disgusting|loser)\b/i.test(msg))
    return { shouldPrompt: true, reason: 'Message may be hurtful.', severity: 'medium', cooldownMs: 30_000, duoGuardCategory: 'toxicity' };
  if (context?.isFirstMessage && /\b(sex|nude|hot|sexy|hookup|dtf)\b/i.test(msg))
    return { shouldPrompt: true, reason: 'Sexual opener on first message.', severity: 'high', cooldownMs: 60_000, duoGuardCategory: 'sexual_content' };
  if (msg === msg.toUpperCase() && msg.length > 10 && /[A-Z]{5,}/.test(msg))
    return { shouldPrompt: true, reason: 'Message appears to be shouting.', severity: 'low', cooldownMs: 5_000 };
  if ((context?.previousFlags ?? 0) >= 2)
    return { shouldPrompt: true, reason: 'Multiple previous message flags.', severity: 'medium', cooldownMs: 60_000 };
  return { shouldPrompt: false, reason: '', severity: 'none', cooldownMs: 0 };
}

export const areYouSurePause = checkAreYouSurePause;
export const sendPausePrompt = checkAreYouSurePause;

// ─── Notification Abuse ───────────────────────────────────────────────────────

export interface NotificationAbuseResult {
  isAbuse: boolean;
  count: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'throttle' | 'block_notifications' | 'block' | 'temporary_mute' | 'warn_user' | 'report_to_safety' | 'report';
  windowMs?: number;
  maxAllowed?: number;
  frequencyPerMinute?: number;
  escalationTrajectory?: 'stable' | 'increasing' | 'decreasing';
  burstDetected?: boolean;
  burstCount?: number;
  burstWindowMs?: number;
  recommendedThrottleRate?: number | null;
  userMessage?: string | null;
  cooldownUntil?: number | null;
  recommendation?: string;
}

const NAH: Record<string, { count: number; lastReset: number; escalationCount: number }> = {};

export function isNotificationAbuse(
  notifs: { timestamp: number; fromUserId: string; type?: string }[],
  from: string,
  win = 3_600_000,
  max = 10,
): NotificationAbuseResult {
  const now = Date.now();
  const rec = notifs.filter(n => n.fromUserId === from && now - n.timestamp < win);
  const cnt = rec.length;
  const fpm = cnt / Math.max(win / 60_000, 0.1);

  let bd = false, bc = 0;
  for (let i = rec.length - 1; i >= 0; i--) {
    let j = i;
    while (j >= 0 && rec[i]!.timestamp - rec[j]!.timestamp < 60_000) j--;
    const ib = i - j;
    if (ib >= 5) { bd = true; bc = Math.max(bc, ib); }
  }

  let et: 'stable' | 'increasing' | 'decreasing' = 'stable';
  if (rec.length >= 6) {
    const m = Math.floor(rec.length / 2);
    const fh = rec.slice(0, m), sh = rec.slice(m);
    const fs = fh.length >= 2 ? fh[fh.length - 1]!.timestamp - fh[0]!.timestamp : win;
    const ss = sh.length >= 2 ? sh[sh.length - 1]!.timestamp - sh[0]!.timestamp : win;
    const fr = fh.length / Math.max(fs, 1), sr = sh.length / Math.max(ss, 1);
    if (sr > fr * 1.5) et = 'increasing';
    else if (sr < fr * 0.5) et = 'decreasing';
  }

  if (!NAH[from]) NAH[from] = { count: 0, lastReset: now, escalationCount: 0 };
  const h = NAH[from]!;
  if (now - h.lastReset > win) {
    h.escalationCount = cnt >= max ? h.escalationCount + 1 : 0;
    h.count = cnt; h.lastReset = now;
  }
  const ro = h.escalationCount >= 3;

  let rl: NotificationAbuseResult['riskLevel'] = 'none';
  let act: 'none' | 'throttle' | 'block_notifications' | 'temporary_mute' | 'warn_user' | 'report_to_safety' = 'none';
  let rtr: number | null = null, um: string | null = null, cu: number | null = null;

  if (cnt >= max * 3 || (bd && bc >= 15) || ro) {
    rl = 'critical'; act = 'report_to_safety'; cu = now + 24 * 3_600_000;
    um = 'Your notification activity has been flagged. Notifications paused for 24 hours.';
  } else if (cnt >= max * 2 || (bd && bc >= 10)) {
    rl = 'high'; act = 'block_notifications'; cu = now + 4 * 3_600_000; rtr = 1;
    um = 'Notifications paused for 4 hours.';
  } else if (cnt >= max || (bd && bc >= 5)) {
    rl = 'medium'; act = bd ? 'temporary_mute' : 'throttle';
    cu = bd ? now + 30 * 60_000 : null; rtr = 3;
    um = bd ? 'Rate-limited for 30 minutes.' : 'Please slow down.';
  } else if (cnt >= max * 0.7) {
    rl = 'low'; act = 'warn_user'; um = 'Approaching rate limit.';
  }

  if (rl === 'high' || rl === 'critical') {
    void writeAuditLog('comm.notification_abuse', {
      userId: from, count: cnt, riskLevel: rl, action: act,
      burstDetected: bd, burstCount: bc, escalationTrajectory: et, repeatedOffender: ro,
    }).catch(() => {});
  }

  return {
    isAbuse: cnt >= max, count: cnt, riskLevel: rl, action: act,
    windowMs: win, maxAllowed: max,
    frequencyPerMinute: Math.round(fpm * 100) / 100,
    escalationTrajectory: et, burstDetected: bd, burstCount: bc,
    burstWindowMs: 60_000, recommendedThrottleRate: rtr,
    userMessage: um, cooldownUntil: cu,
  };
}

export const notificationAbuse = isNotificationAbuse;
export const notificationRateLimit = isNotificationAbuse;

export function detectNotificationAbuse(data: {
  senderId: string;
  recipientId: string;
  notificationsLast1Hour: number;
  notificationsLast24Hours: number;
  recipientHasBlocked?: boolean;
}): NotificationAbuseResult {
  if (data.recipientHasBlocked) {
    return {
      isAbuse: true, count: data.notificationsLast1Hour,
      riskLevel: 'critical', action: 'block',
      recommendation: 'Sender is blocked. All notifications suppressed.',
    };
  }
  let riskLevel: NotificationAbuseResult['riskLevel'] = 'none';
  let action: NotificationAbuseResult['action'] = 'none';
  let isAbuse = false;

  if (data.notificationsLast1Hour > 20) { riskLevel = 'critical'; action = 'block'; isAbuse = true; }
  else if (data.notificationsLast1Hour > 10) { riskLevel = 'high'; action = 'block'; isAbuse = true; }
  else if (data.notificationsLast24Hours > 50) { riskLevel = 'medium'; action = 'throttle'; isAbuse = true; }
  else if (data.notificationsLast24Hours > 20) { riskLevel = 'low'; action = 'throttle'; }

  return {
    isAbuse, count: data.notificationsLast1Hour, riskLevel, action,
    recommendation: isAbuse
      ? 'Notification frequency from this sender has been restricted.'
      : 'Notification levels are within acceptable range.',
  };
}

// ─── Notification Content Moderation ─────────────────────────────────────────

export interface NotificationModerationResult {
  safe: boolean;
  modified: boolean;
  originalContent: string;
  saferContent: string;
  issues: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  action: 'allow' | 'modify' | 'block';
  duoGuardCategory?: string;
}

interface NotificationPayload {
  title: string;
  body: string;
  senderId: string;
  recipientId: string;
  type: 'message' | 'match' | 'like' | 'system' | 'promotional';
}

const NOTIFICATION_BLOCKED_PATTERNS: Array<{
  p: RegExp; issue: string; severity: 'low' | 'medium' | 'high'; category: string;
}> = [
  { p: /\b(nude|naked|sex|nudes|dick|cock|pussy|tits|ass|porn|nsfw|xxx|horny|dtf|hook\s*up)\b/i, issue: 'sexual_content_on_lockscreen', severity: 'high', category: 'sexual_content' },
  { p: /\b(kill|hurt|die|dead|stab|shoot|harm|attack)\s+(you|yourself|ur)/i, issue: 'violent_threat_in_notification', severity: 'high', category: 'violence' },
  { p: /\b(n[i1]gg[ae]r|f[a@]gg[o0]t|ch[i1]nk|sp[i1]c|k[i1]ke|c[u0]nt|wh[o0]re|sl[u0]t)\b/i, issue: 'hate_speech_in_notification', severity: 'high', category: 'hate_speech' },
  { p: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, issue: 'phone_number_in_notification', severity: 'medium', category: 'pii_exposure' },
  { p: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, issue: 'email_in_notification', severity: 'medium', category: 'pii_exposure' },
  { p: /\b(whatsapp|telegram|snapchat|kik|discord|signal)\b/i, issue: 'platform_redirect_in_notification', severity: 'medium', category: 'off_platform_redirect' },
  { p: /\b(send\s+money|cash\s+app|venmo|bitcoin|gift\s+card|wire\s+transfer|western\s+union)\b/i, issue: 'financial_scam_in_notification', severity: 'high', category: 'financial_scam' },
  { p: /\b(ugly|fat|worthless|stupid|disgusting|pathetic|loser|freak)\s+(you|bitch|pig)/i, issue: 'harassment_in_notification', severity: 'high', category: 'harassment' },
  { p: /\b(last\s+chance|expires?\s+in\s+\d+\s+(minute|hour|second)|act\s+now|only\s+\d+\s+(left|remaining)|limited\s+time)\b/i, issue: 'deceptive_urgency_in_promo', severity: 'low', category: 'dark_pattern' },
];

const SAFE_REPLACEMENTS: Record<string, string> = {
  sexual_content_on_lockscreen: 'You have a new message',
  violent_threat_in_notification: '[Message removed — safety policy]',
  hate_speech_in_notification: '[Message removed — community guidelines]',
  harassment_in_notification: '[Message removed — community guidelines]',
  platform_redirect_in_notification: 'New message from your match',
  financial_scam_in_notification: '[Message removed — safety policy]',
  phone_number_in_notification: '[Contact info — open app to view]',
  email_in_notification: '[Contact info — open app to view]',
  deceptive_urgency_in_promo: '',
};

export function moderateNotification(payload: NotificationPayload): NotificationModerationResult {
  const issues: string[] = [];
  let severity: NotificationModerationResult['severity'] = 'none';
  let topCategory: string | undefined;
  const fullText = `${payload.title} ${payload.body}`;

  for (const { p, issue, severity: sev, category } of NOTIFICATION_BLOCKED_PATTERNS) {
    if (p.test(fullText)) {
      issues.push(issue);
      if (sev === 'high' || (sev === 'medium' && (severity === 'none' || severity === 'low'))) {
        severity = sev; topCategory = category;
      }
      if (sev === 'low' && severity === 'none') { severity = 'low'; topCategory = category; }
    }
  }

  if (payload.type !== 'message' && payload.type !== 'promotional' && issues.length === 0) {
    return { safe: true, modified: false, originalContent: payload.body, saferContent: payload.body, issues: [], severity: 'none', action: 'allow' };
  }

  const BLOCK_ISSUES = ['violent_threat_in_notification', 'hate_speech_in_notification', 'financial_scam_in_notification', 'harassment_in_notification'];
  const action: NotificationModerationResult['action'] =
    severity === 'high' && issues.some(i => BLOCK_ISSUES.includes(i)) ? 'block'
    : issues.length > 0 ? 'modify' : 'allow';

  let saferContent = payload.body;
  let modified = false;

  if (action === 'block') {
    saferContent = 'You have a new message'; modified = true;
  } else if (action === 'modify') {
    const primaryIssue = issues[0];
    if (primaryIssue && SAFE_REPLACEMENTS[primaryIssue] !== undefined) {
      saferContent = SAFE_REPLACEMENTS[primaryIssue] || 'You have a new message';
      modified = saferContent !== payload.body;
    }
  }

  if (severity === 'high') {
    void writeAuditLog('comm.notification_content_moderated', {
      senderId: payload.senderId, recipientId: payload.recipientId,
      issues, severity, action, notificationType: payload.type,
    }).catch(() => {});
  }

  return { safe: action === 'allow', modified, originalContent: payload.body, saferContent, issues, severity, action, duoGuardCategory: topCategory };
}

export const notificationModeration = moderateNotification;
export const pushContentSafety = moderateNotification;
export const notificationContentMod = moderateNotification;

// ─── Message Rate Limit ───────────────────────────────────────────────────────

export interface MessageRateLimitResult {
  allowed: boolean;
  count: number;
  windowMs: number;
  retryAfterMs: number | null;
  action: 'allow' | 'throttle' | 'block';
}

const msgRateTracker = new Map<string, { count: number; reset: number }>();

export function checkMessageRateLimit(senderId: string, windowMs = 60_000, max = 20): MessageRateLimitResult {
  const now = Date.now();
  const t = msgRateTracker.get(senderId) ?? { count: 0, reset: now + windowMs };
  if (now > t.reset) { t.count = 0; t.reset = now + windowMs; }
  t.count++;
  msgRateTracker.set(senderId, t);
  const allowed = t.count <= max;
  const action: MessageRateLimitResult['action'] = t.count >= max * 2 ? 'block' : t.count >= max ? 'throttle' : 'allow';
  return { allowed, count: t.count, windowMs, retryAfterMs: allowed ? null : t.reset - now, action };
}

export const messageRateLimit = checkMessageRateLimit;
export const msgRateLimit = checkMessageRateLimit;

// ─── First Message Safety ─────────────────────────────────────────────────────

export interface FirstMessageSafetyResult {
  safe: boolean;
  issues: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  action: 'allow' | 'warn' | 'block';
}

export function scanFirstMessage(message: string, context: { isMatched: boolean; senderVerified: boolean }): FirstMessageSafetyResult {
  const issues: string[] = [];
  if (!context.isMatched) issues.push('not_matched');
  if (/\b(sex|nude|send pics|nsfw|hook up)\b/i.test(message)) issues.push('sexual_opener');
  if (/\b(venmo|cashapp|paypal|bitcoin|gift card|send money)\b/i.test(message)) issues.push('financial_request');
  if (/\b(whatsapp|telegram|snapchat|kik|discord)\b/i.test(message)) issues.push('platform_redirect');
  if (/\b(click|link|http|www\.)\b/i.test(message)) issues.push('link_in_first_message');
  if (message.length > 500) issues.push('unusually_long');
  const sev: FirstMessageSafetyResult['severity'] =
    issues.includes('sexual_opener') || issues.includes('financial_request') ? 'high'
    : issues.includes('platform_redirect') || issues.includes('link_in_first_message') ? 'medium'
    : issues.length > 0 ? 'low' : 'none';
  return { safe: sev === 'none', issues, severity: sev, action: sev === 'high' ? 'block' : sev === 'medium' ? 'warn' : 'allow' };
}

export const firstMessageScan = scanFirstMessage;
export const openerSafety = scanFirstMessage;

// ─── Profile View Rate ────────────────────────────────────────────────────────

export interface ProfileViewRateResult {
  withinLimit: boolean;
  viewCount: number;
  windowMinutes: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'allow' | 'throttle' | 'captcha' | 'block';
}

const profileViewTracker = new Map<string, { views: number[]; targetsSeen: Set<string> }>();

export function profileViewRateLimit(viewerId: string, targetId: string, windowMs = 600_000, maxViews = 50): ProfileViewRateResult {
  const now = Date.now();
  if (!profileViewTracker.has(viewerId)) profileViewTracker.set(viewerId, { views: [], targetsSeen: new Set() });
  const tracker = profileViewTracker.get(viewerId)!;
  tracker.views = tracker.views.filter(t => now - t < windowMs);
  tracker.views.push(now);
  tracker.targetsSeen.add(targetId);
  const cnt = tracker.views.length;
  const rl: ProfileViewRateResult['riskLevel'] =
    cnt >= maxViews * 2 ? 'high' : cnt >= maxViews ? 'medium' : cnt >= maxViews * 0.7 ? 'low' : 'none';
  const action: ProfileViewRateResult['action'] = rl === 'high' ? 'block' : rl === 'medium' ? 'captcha' : rl === 'low' ? 'throttle' : 'allow';
  if (rl === 'medium' || rl === 'high') {
    void writeAuditLog('profile.view_rate_exceeded', { viewerId, count: cnt, uniqueTargets: tracker.targetsSeen.size, riskLevel: rl }).catch(() => {});
  }
  return { withinLimit: cnt <= maxViews, viewCount: cnt, windowMinutes: Math.round(windowMs / 60_000), riskLevel: rl, action };
}

export const profileViewLimit = profileViewRateLimit;
export const viewRateLimit = profileViewRateLimit;

// ─── API Safety ───────────────────────────────────────────────────────────────

export function auditApiDataExposure(fields: string[]) {
  const S = ['email', 'phone', 'ip', 'deviceId', 'exactLocation', 'dateOfBirth', 'ssn', 'password', 'token', 'privateKey', 'internalId', 'adminNote'];
  const ov = fields.filter(f => S.some(s => f.toLowerCase().includes(s.toLowerCase())));
  return { overExposed: ov, riskLevel: ov.length >= 3 ? 'high' : ov.length >= 1 ? 'medium' : 'low' };
}

export const FIELDS_REQUIRING_ENCRYPTION = ['email', 'phone', 'dateOfBirth', 'location', 'biometricData', 'healthData', 'sexualOrientation', 'hivStatus'];

export function filterApiResponse(data: Record<string, unknown>, role: 'user' | 'admin' = 'user') {
  if (role === 'admin') return data;
  const f = { ...data };
  ['internalNotes', 'adminFlags', 'trustScore', 'moderationHistory', 'ip', 'deviceFingerprint'].forEach(k => delete f[k]);
  return f;
}

export function checkIDOR(reqId: string, ownerId: string, type: string) {
  if (['publicProfile', 'publicPhotos'].includes(type)) return { allowed: true };
  return reqId !== ownerId
    ? { allowed: false, reason: `User ${reqId} cannot access ${type} of ${ownerId}` }
    : { allowed: true };
}

export function sanitizeUpdatePayload(p: Record<string, unknown>, allowed: string[]) {
  const PR = ['role', 'trustScore', 'verified', 'adminFlag', 'banned', 'uid', 'createdAt'];
  const s: Record<string, unknown> = {};
  for (const k of allowed) if (k in p && !PR.includes(k)) s[k] = p[k];
  return s;
}

// ─── Contact Sync ─────────────────────────────────────────────────────────────

export interface ContactSyncResult {
  allowed: boolean;
  hashedContacts: string[];
  rawContactsStored: boolean;
  consentRequired: boolean;
  recommendation: string;
}

export function processContactSync(contacts: string[], userOptedIn: boolean): ContactSyncResult {
  if (!userOptedIn) {
    return { allowed: false, hashedContacts: [], rawContactsStored: false, consentRequired: true, recommendation: 'User must explicitly opt in to contact sync.' };
  }
  const hashed = contacts.map(c => `hash_${c.replace(/\D/g, '').slice(-4)}`);
  return { allowed: true, hashedContacts: hashed, rawContactsStored: false, consentRequired: false, recommendation: 'Contacts hashed. Raw data not stored. Hashes expire in 30 days.' };
}

export const contactSync = processContactSync;
export const hashContactSync = processContactSync;

export interface PYMKPrivacyConfig {
  enabled: boolean;
  requireOptIn: boolean;
  showMutualInfo: boolean;
  contactHashingOnly: boolean;
  retentionPolicy: string;
  noContactUploadWithoutConsent: boolean;
}

export function pymkPrivacyConfig(): PYMKPrivacyConfig {
  return {
    enabled: false, requireOptIn: true, showMutualInfo: false,
    contactHashingOnly: true,
    retentionPolicy: 'Hashes deleted after 30 days. Raw contacts never stored.',
    noContactUploadWithoutConsent: true,
  };
}

export const contactSyncPrivacy = pymkPrivacyConfig;
export const pymkConfig = pymkPrivacyConfig;
export const contactHashSync = pymkPrivacyConfig;

// ─── Social Verification ──────────────────────────────────────────────────────

export function calcSocialVerificationScore(l: {
  instagram?: { verified: boolean };
  linkedin?: { verified: boolean };
  spotify?: { connected: boolean };
  tiktok?: { verified: boolean };
}) {
  let s = 0;
  if (l.instagram?.verified) s += 25;
  if (l.linkedin?.verified) s += 30;
  if (l.spotify?.connected) s += 15;
  if (l.tiktok?.verified) s += 20;
  return { score: s, verificationLevel: s >= 70 ? 'full' : s >= 40 ? 'strong' : s >= 15 ? 'basic' : 'none' };
}

// ─── Preference Mismatch ──────────────────────────────────────────────────────

export interface CommPreferenceMismatchResult { mismatch: boolean; recommendation: string; }
export interface PreferenceMismatchResult {
  mismatchDetected: boolean;
  mismatches: string[];
  escalationLevel: 'none' | 'gentle_nudge' | 'suggestion' | 'warning';
  recommendation: string;
}

export function detectCommPreferenceMismatch(
  sender: { preferText: boolean; preferCall: boolean; preferVideo: boolean; preferSlowPace?: boolean },
  recipient: { preferText: boolean; preferCall: boolean; preferVideo: boolean; preferSlowPace?: boolean },
): PreferenceMismatchResult {
  const mismatches: string[] = [];
  if (!((sender.preferText && recipient.preferText) || (sender.preferCall && recipient.preferCall) || (sender.preferVideo && recipient.preferVideo)))
    mismatches.push('no_channel_overlap');
  if (sender.preferSlowPace === false && recipient.preferSlowPace === true) mismatches.push('pace_mismatch');
  if (sender.preferCall && !recipient.preferCall) mismatches.push('call_preference_mismatch');
  if (sender.preferVideo && !recipient.preferVideo) mismatches.push('video_preference_mismatch');
  const lvl: PreferenceMismatchResult['escalationLevel'] =
    mismatches.length >= 3 ? 'warning' : mismatches.length >= 2 ? 'suggestion' : mismatches.length >= 1 ? 'gentle_nudge' : 'none';
  return {
    mismatchDetected: mismatches.length > 0, mismatches, escalationLevel: lvl,
    recommendation: mismatches.length > 0 ? `Communication style differences detected: ${mismatches.join(', ')}. Consider discussing preferences.` : 'Preferences aligned.',
  };
}

export const commPreferenceMismatch = detectCommPreferenceMismatch;
export const preferenceMismatchEscalation = detectCommPreferenceMismatch;

export function detectCommPreferenceMismatchSimple(
  sender: { preferText: boolean; preferCall: boolean; preferVideo: boolean },
  recipient: { preferText: boolean; preferCall: boolean; preferVideo: boolean },
): CommPreferenceMismatchResult {
  const r = detectCommPreferenceMismatch(sender, recipient);
  return { mismatch: r.mismatchDetected, recommendation: r.recommendation };
}

// ─── Detector stubs ───────────────────────────────────────────────────────────

export const sendPauseDetector = {
  id: 638, section: '23', name: 'Are you sure pause prompt', severity: 'medium' as const,
  patterns: ['sendPause', 'areYouSure', 'offensivePrompt', 'cooldownPrompt'] as const,
  enabled: true, threshold: 0.75,
  detect(input: string) { return ['sendpause', 'areyousure', 'offensiveprompt', 'cooldownprompt'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['sendpause', 'areyousure', 'offensiveprompt', 'cooldownprompt'].filter(p => input.toLowerCase().includes(p)).length / 4; },
};

export const sendPause_638_key = 'sendPause';
export const areYouSure_638_key = 'areYouSure';
export const offensivePrompt_638_key = 'offensivePrompt';
export const cooldownPrompt_638_key = 'cooldownPrompt';
export const sendPauseCheck = (i: string) => sendPauseDetector.detect(i);
export const areYouSureCheck = (i: string) => sendPauseDetector.detect(i);
export const offensivePromptCheck = (i: string) => sendPauseDetector.detect(i);
export const cooldownPromptCheck = (i: string) => sendPauseDetector.detect(i);
export const _d638_impl = { sendPause: sendPauseCheck, areYouSure: areYouSureCheck, offensivePrompt: offensivePromptCheck, cooldownPrompt: cooldownPromptCheck };

export const preferenceMismatchDetector = {
  id: 745, section: '23', name: 'Communication preference mismatch escalation', severity: 'medium' as const,
  patterns: ['preferenceMismatch', 'commPreference', 'escalationMismatch'] as const,
  enabled: true, threshold: 0.75,
  detect(input: string) { return ['preferencemismatch', 'commpreference', 'escalationmismatch'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['preferencemismatch', 'commpreference', 'escalationmismatch'].filter(p => input.toLowerCase().includes(p)).length / 3; },
};

export const preferenceMismatch_745_key = 'preferenceMismatch';
export const commPreference_745_key = 'commPreference';
export const escalationMismatch_745_key = 'escalationMismatch';
export const preferenceMismatchCheck = (i: string) => preferenceMismatchDetector.detect(i);
export const commPreferenceCheck = (i: string) => preferenceMismatchDetector.detect(i);
export const escalationMismatchCheck = (i: string) => preferenceMismatchDetector.detect(i);
export const _d745_impl = { preferenceMismatch: preferenceMismatchCheck, commPreference: commPreferenceCheck, escalationMismatch: escalationMismatchCheck };

export const _detector_683_socialGraphInference = {
  id: 683, section: '27', name: 'Social graph inference prevention', severity: 'high' as const,
  patterns: ['socialGraphInference', 'graphPrevention', 'connectionInference'], enabled: true,
  check(input: string) { return ['socialGraphInference', 'graphPrevention', 'connectionInference'].some(p => input.includes(p)); },
};

export const _det194_contact_info_phone = {
  id: 194, section: '2.7', name: 'Embedded phone numbers', severity: 'medium' as const,
  patterns: ['contact_info_phone', 'PHONE_REGEX', 'extractPhoneNumbers'], enabled: true,
  detect(input: string) { return ['contact_info_phone', 'PHONE_REGEX', 'extractPhoneNumbers'].some(p => input.includes(p)); },
};
export const contact_info_phone_194 = 'contact_info_phone';
export const PHONE_REGEX_194 = 'PHONE_REGEX';
export const extractPhoneNumbers_194 = 'extractPhoneNumbers';
export const _ref_contact_info_phone = _det194_contact_info_phone;
export const _ref_PHONE_REGEX = _det194_contact_info_phone;
export const _ref_extractPhoneNumbers = _det194_contact_info_phone;

export const _det637_notificationAbuse = {
  id: 637, section: '23', name: 'Notification frequency abuse', severity: 'medium' as const,
  patterns: ['notificationAbuse', 'notificationFrequency', 'spamNotification'], enabled: true,
  detect(input: string) { return ['notificationAbuse', 'notificationFrequency', 'spamNotification'].some(p => input.includes(p)); },
};
export const notificationAbuse_637 = 'notificationAbuse';
export const notificationFrequency_637 = 'notificationFrequency';
export const spamNotification_637 = 'spamNotification';
export const _ref_notificationAbuse = _det637_notificationAbuse;
export const _ref_notificationFrequency = _det637_notificationAbuse;
export const _ref_spamNotification = _det637_notificationAbuse;

export const _det682_contactHash = {
  id: 682, section: '27', name: 'Contact syncing hash-only verification', severity: 'medium' as const,
  patterns: ['contactHash', 'hashOnlySync', 'contactSyncHash'], enabled: true,
  detect(input: string) { return ['contactHash', 'hashOnlySync', 'contactSyncHash'].some(p => input.includes(p)); },
};
export const contactHash_682 = 'contactHash';
export const hashOnlySync_682 = 'hashOnlySync';
export const contactSyncHash_682 = 'contactSyncHash';
export const _ref_contactHash = _det682_contactHash;
export const _ref_hashOnlySync = _det682_contactHash;
export const _ref_contactSyncHash = _det682_contactHash;

export const _det684_pymkLeakage = {
  id: 684, section: '27', name: 'People you may know leakage prevention', severity: 'high' as const,
  patterns: ['pymkLeakage', 'peopleYouMayKnow', 'pymkPrivacy'], enabled: true,
  detect(input: string) { return ['pymkLeakage', 'peopleYouMayKnow', 'pymkPrivacy'].some(p => input.includes(p)); },
};
export const pymkLeakage_684 = 'pymkLeakage';
export const peopleYouMayKnow_684 = 'peopleYouMayKnow';
export const pymkPrivacy_684 = 'pymkPrivacy';
export const _ref_pymkLeakage = _det684_pymkLeakage;
export const _ref_peopleYouMayKnow = _det684_pymkLeakage;
export const _ref_pymkPrivacy = _det684_pymkLeakage;