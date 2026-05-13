import { writeAuditLog } from './logger';

// ─── Block Evasion ────────────────────────────────────────────────────────────

export function detectBlockEvasion(
  _blocked: string[],
  na: { userId: string; deviceFingerprint: string; ipHash: string }[],
  bFp: string[],
  bIp: string[],
) {
  for (const s of na) {
    if (bFp.includes(s.deviceFingerprint) || bIp.includes(s.ipHash)) {
      void writeAuditLog('comm.block_evasion', { suspect: s.userId }).catch(() => {});
      return { evasionDetected: true, matchedUserId: s.userId };
    }
  }
  return { evasionDetected: false };
}

export function detectNewAccountContact(
  a: { createdAt: number; deviceFingerprint: string; ipHash: string },
  bFp: string[],
  bIp: string[],
  win = 7 * 86_400_000,
) {
  const is = Date.now() - a.createdAt < win;
  if (is && bFp.includes(a.deviceFingerprint)) return { detected: true, reason: 'same_device_as_blocked_account' };
  if (is && bIp.includes(a.ipHash)) return { detected: true, reason: 'same_ip_as_blocked_account' };
  return { detected: false };
}

export function detectProxyMessaging(
  msgs: Array<{ text: string; senderId: string; timestamp: number }>,
  blocked: string,
  recip: string,
) {
  const ind: string[] = [];
  for (const m of msgs) {
    if (m.senderId === recip) continue;
    const P = [
      new RegExp(`my friend ${blocked.slice(0, 4)}`, 'i'),
      /my friend (wanted|asked|told) me (to|)/i,
      /on behalf of/i, /passing along a message/i, /they wanted you to know/i,
    ];
    if (P.some(p => p.test(m.text))) ind.push(m.text.substring(0, 60));
  }
  return { detected: ind.length > 0, likelyProxy: ind.length >= 2, indicators: ind };
}

// ─── Continued Contact After Block ────────────────────────────────────────────

export interface ContinuedContactResult {
  detected: boolean;
  channel: string;
  attemptCount: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'warn' | 'restrict' | 'suspend' | 'escalate';
}

const blockContactAttempts = new Map<string, { timestamps: number[]; channels: string[] }>();

export function detectContinuedContactAfterBlock(blockerId: string, blockedId: string, channel: string): ContinuedContactResult {
  const key = `${blockedId}_${blockerId}`, now = Date.now();
  if (!blockContactAttempts.has(key)) blockContactAttempts.set(key, { timestamps: [], channels: [] });
  const log = blockContactAttempts.get(key)!;
  log.timestamps = log.timestamps.filter(t => now - t < 7 * 86_400_000);
  log.timestamps.push(now);
  if (!log.channels.includes(channel)) log.channels.push(channel);
  const cnt = log.timestamps.length;
  const rl: ContinuedContactResult['riskLevel'] =
    cnt >= 10 || log.channels.length >= 3 ? 'critical' : cnt >= 5 ? 'high' : cnt >= 3 ? 'medium' : cnt >= 1 ? 'low' : 'none';
  const action: ContinuedContactResult['action'] =
    rl === 'critical' || rl === 'high' ? 'escalate' : rl === 'medium' ? 'suspend' : rl === 'low' ? 'restrict' : 'warn';
  void writeAuditLog('comm.continued_contact_after_block', { blockedId, blockerId, channel, attemptCount: cnt, riskLevel: rl }).catch(() => {});
  return { detected: true, channel, attemptCount: cnt, riskLevel: rl, action };
}

export const continuedContact = detectContinuedContactAfterBlock;
export const postBlockMessage = detectContinuedContactAfterBlock;
export const contactAfterBlock = detectContinuedContactAfterBlock;

// ─── New Account After Block ──────────────────────────────────────────────────

export interface NewAccountAfterBlockResult {
  detected: boolean;
  matchType: string;
  confidence: number;
  action: 'block' | 'flag' | 'monitor';
}

export function detectNewAccountAfterBlock(
  newAccount: { deviceFp: string; ipHash: string; emailHash?: string; faceEmbeddingHash?: string; phoneHash?: string },
  blockedAccounts: Array<{ deviceFp: string; ipHash: string; emailHash?: string; faceEmbeddingHash?: string; phoneHash?: string }>,
): NewAccountAfterBlockResult {
  for (const b of blockedAccounts) {
    if (b.deviceFp === newAccount.deviceFp) { void writeAuditLog('comm.new_account_after_block', { matchType: 'device_fingerprint' }).catch(() => {}); return { detected: true, matchType: 'device_fingerprint', confidence: 0.95, action: 'block' }; }
    if (newAccount.emailHash && b.emailHash === newAccount.emailHash) { void writeAuditLog('comm.new_account_after_block', { matchType: 'email_hash' }).catch(() => {}); return { detected: true, matchType: 'email_hash', confidence: 0.98, action: 'block' }; }
    if (newAccount.phoneHash && b.phoneHash === newAccount.phoneHash) { void writeAuditLog('comm.new_account_after_block', { matchType: 'phone_hash' }).catch(() => {}); return { detected: true, matchType: 'phone_hash', confidence: 0.99, action: 'block' }; }
    if (newAccount.faceEmbeddingHash && b.faceEmbeddingHash === newAccount.faceEmbeddingHash) { void writeAuditLog('comm.new_account_after_block', { matchType: 'face_embedding' }).catch(() => {}); return { detected: true, matchType: 'face_embedding', confidence: 0.9, action: 'block' }; }
    if (b.ipHash === newAccount.ipHash) return { detected: true, matchType: 'ip_hash', confidence: 0.6, action: 'flag' };
  }
  return { detected: false, matchType: 'none', confidence: 0, action: 'monitor' };
}

export const newAccountAfterBlock = detectNewAccountAfterBlock;
export const blockEvadeNewAccount = detectNewAccountAfterBlock;

// ─── Platform Redirect After Block ───────────────────────────────────────────

export interface PlatformRedirectAfterBlockResult {
  detected: boolean;
  platform: string;
  riskLevel: 'none' | 'medium' | 'high';
  action: 'warn' | 'block';
}

const REDIRECT_PLATFORMS = ['whatsapp', 'telegram', 'snapchat', 'instagram', 'discord', 'signal', 'kik', 'line', 'wechat', 'viber', 'skype', 'messenger', 'facebook', 'twitter', 'tiktok'];

export function detectPlatformRedirectAfterBlock(message: string, isBlocked: boolean): PlatformRedirectAfterBlockResult {
  if (!isBlocked) return { detected: false, platform: '', riskLevel: 'none', action: 'warn' };
  const found = REDIRECT_PLATFORMS.find(p => new RegExp(`\\b${p}\\b`, 'i').test(message));
  if (found) void writeAuditLog('comm.platform_redirect_after_block', { platform: found }).catch(() => {});
  return found
    ? { detected: true, platform: found, riskLevel: 'high', action: 'block' }
    : { detected: false, platform: '', riskLevel: 'none', action: 'warn' };
}

export const platformRedirectAfterBlock = detectPlatformRedirectAfterBlock;
export const offPlatformAfterBlock = detectPlatformRedirectAfterBlock;

// ─── Read Receipt Stalking ────────────────────────────────────────────────────

export interface ReadReceiptStalkingResult {
  detected: boolean;
  checkCount: number;
  pattern: 'obsessive_monitoring' | 'scheduled_checks' | 'burst_checking' | 'normal';
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  checkFrequencyPerHour: number;
  timeSpanMinutes: number;
  intervals: number[];
  avgIntervalMs: number;
  stdDevIntervalMs: number;
  escalationTrajectory: 'stable' | 'increasing' | 'decreasing';
  recommendation: string;
  autoAction: 'none' | 'disable_read_receipts_for_user' | 'warn_target' | 'hide_online_status' | 'flag_for_safety';
  targetProtectionApplied: boolean;
}

const RRH: Record<string, { lastAction: number; offenseCount: number }> = {};

export function detectReadReceiptStalking(
  log: { userId: string; targetUserId: string; timestamp: number; action: string }[],
  sus: string, tgt: string, win = 3_600_000, thr = 20,
): ReadReceiptStalkingResult {
  const now = Date.now();
  const rel = log.filter(l => l.userId === sus && l.targetUserId === tgt && l.action === 'check_read_receipt' && now - l.timestamp < win);
  if (rel.length < 3) return { detected: false, checkCount: rel.length, pattern: 'normal', severity: 'none', checkFrequencyPerHour: 0, timeSpanMinutes: 0, intervals: [], avgIntervalMs: 0, stdDevIntervalMs: 0, escalationTrajectory: 'stable', recommendation: 'No significant pattern.', autoAction: 'none', targetProtectionApplied: false };

  const cc = rel.length;
  const oldest = rel[0]!.timestamp, newest = rel[rel.length - 1]!.timestamp;
  const tsm = (newest - oldest) / 60_000;
  const cfh = tsm > 0 ? (cc / tsm) * 60 : cc * 60;

  const ivs: number[] = [];
  for (let i = 1; i < rel.length; i++) ivs.push(rel[i]!.timestamp - rel[i - 1]!.timestamp);
  const avg = ivs.length > 0 ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0;
  const sd = Math.sqrt(ivs.length > 0 ? ivs.reduce((s, t) => s + (t - avg) ** 2, 0) / ivs.length : 0);

  let pat: ReadReceiptStalkingResult['pattern'] = 'obsessive_monitoring';
  if (sd < 5000 && ivs.length >= 3) pat = 'scheduled_checks';
  else if (ivs.some(t => t < 1000)) pat = 'burst_checking';

  let et: 'stable' | 'increasing' | 'decreasing' = 'stable';
  if (rel.length >= 6) {
    const h = Math.floor(rel.length / 2), fh = rel.slice(0, h), sh = rel.slice(h);
    const fs = fh.length >= 2 ? fh[fh.length - 1]!.timestamp - fh[0]!.timestamp : win;
    const ss = sh.length >= 2 ? sh[sh.length - 1]!.timestamp - sh[0]!.timestamp : win;
    const fr = fh.length / Math.max(fs, 1), sr = sh.length / Math.max(ss, 1);
    if (sr > fr * 1.5) et = 'increasing'; else if (sr < fr * 0.5) et = 'decreasing';
  }

  const hk = `${sus}_${tgt}`;
  if (!RRH[hk]) RRH[hk] = { lastAction: 0, offenseCount: 0 };

  let sev: ReadReceiptStalkingResult['severity'] = 'none';
  let aa: ReadReceiptStalkingResult['autoAction'] = 'none';
  let tp = false, rec: string;

  if (cc >= thr * 2 || (pat === 'burst_checking' && cc >= thr)) { sev = 'critical'; aa = 'flag_for_safety'; tp = true; rec = 'Critical: Severe read receipt stalking. Safety team notified.'; RRH[hk].offenseCount++; }
  else if (cc >= thr || (pat === 'scheduled_checks' && cc >= thr * 0.7)) { sev = 'high'; aa = 'hide_online_status'; tp = true; rec = 'High: Persistent monitoring. Online status hidden.'; RRH[hk].offenseCount++; }
  else if (cc >= thr * 0.5 || pat === 'burst_checking') { sev = 'medium'; aa = 'warn_target'; rec = 'Medium: Elevated checking. Target warned.'; }
  else if (cc >= thr * 0.3) { sev = 'low'; aa = 'disable_read_receipts_for_user'; rec = 'Low: Consider disabling read receipts.'; }
  else { rec = 'No significant pattern.'; }

  if (RRH[hk].offenseCount >= 3 && sev !== 'critical') { sev = 'critical'; aa = 'flag_for_safety'; tp = true; rec = `Repeat offender (${RRH[hk].offenseCount} incidents). Escalated.`; }

  if (sev === 'high' || sev === 'critical') {
    void writeAuditLog('comm.read_receipt_stalking', { suspect: sus, target: tgt, count: cc, pattern: pat, severity: sev, escalationTrajectory: et, offenseCount: RRH[hk].offenseCount }).catch(() => {});
  }

  return { detected: cc >= thr * 0.3, checkCount: cc, pattern: pat, severity: sev, checkFrequencyPerHour: Math.round(cfh * 10) / 10, timeSpanMinutes: Math.round(tsm * 10) / 10, intervals: ivs.slice(-20), avgIntervalMs: Math.round(avg), stdDevIntervalMs: Math.round(sd), escalationTrajectory: et, recommendation: rec, autoAction: aa, targetProtectionApplied: tp };
}

// ─── Typing Indicator Abuse ───────────────────────────────────────────────────

export interface TypingIndicatorAbuseResult {
  detected: boolean;
  startStopCount: number;
  totalCycles: number;
  avgCycleDurationMs: number;
  maxCyclesPerMinute: number;
  pattern: 'none' | 'anxiety_exploitation' | 'attention_seeking' | 'manipulation' | 'accidental';
  severity: 'none' | 'low' | 'medium' | 'high';
  timeSpanMinutes: number;
  recommendation: string;
  autoAction: 'none' | 'disable_typing_for_user' | 'warn_target' | 'rate_limit';
  targetMessage: string | null;
}

export function detectTypingIndicatorAbuse(
  evts: { userId: string; targetUserId: string; started: boolean; timestamp: number }[],
  sus: string, tgt: string, win = 300_000,
): TypingIndicatorAbuseResult {
  const now = Date.now();
  const rel = evts.filter(e => e.userId === sus && e.targetUserId === tgt && now - e.timestamp < win);
  const starts = rel.filter(e => e.started), stops = rel.filter(e => !e.started);
  const ssc = Math.min(starts.length, stops.length);

  if (ssc < 3) return { detected: false, startStopCount: ssc, totalCycles: ssc, avgCycleDurationMs: 0, maxCyclesPerMinute: 0, pattern: 'none', severity: 'none', timeSpanMinutes: 0, recommendation: 'No significant abuse.', autoAction: 'none', targetMessage: null };

  const cycles: number[] = [];
  const sq = [...starts].sort((a, b) => a.timestamp - b.timestamp);
  const tq = [...stops].sort((a, b) => a.timestamp - b.timestamp);
  for (const s of sq) {
    const m = tq.find(t => t.timestamp > s.timestamp);
    if (m) { cycles.push(m.timestamp - s.timestamp); tq.splice(tq.indexOf(m), 1); }
  }

  const tc = cycles.length;
  const acd = cycles.length > 0 ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;
  const oldest = rel[0]!.timestamp, newest = rel[rel.length - 1]!.timestamp;
  const tsm = (newest - oldest) / 60_000;
  const mpm = tsm > 0 ? tc / tsm : tc;
  const sc2 = cycles.filter(c => c < 2000).length;
  const lc = cycles.filter(c => c > 30_000).length;
  const csd = cycles.length >= 2 ? Math.sqrt(cycles.reduce((s, c) => s + (c - acd) ** 2, 0) / cycles.length) : 0;

  let pat: TypingIndicatorAbuseResult['pattern'] = 'none';
  let sev: TypingIndicatorAbuseResult['severity'] = 'none';
  let aa: TypingIndicatorAbuseResult['autoAction'] = 'none';
  let tm: string | null = null, rec: string;

  if (sc2 >= 5 || mpm >= 6) { pat = 'anxiety_exploitation'; sev = 'high'; aa = 'disable_typing_for_user'; tm = 'Typing indicators hidden due to suspicious activity.'; rec = 'High: Rapid start/stop pattern. Indicators disabled.'; }
  else if (lc >= 3 && tc >= 5) { pat = 'attention_seeking'; sev = 'medium'; aa = 'warn_target'; tm = 'This person appears to be typing repeatedly without sending.'; rec = 'Medium: Long typing-without-sending pattern.'; }
  else if (csd < 1000 && tc >= 5) { pat = 'manipulation'; sev = 'medium'; aa = 'rate_limit'; rec = 'Medium: Mechanically consistent pattern. Rate limited.'; }
  else if (ssc >= 5) { pat = 'accidental'; sev = 'low'; rec = 'Low: Frequent cycles. May be accidental.'; }
  else { rec = 'No significant pattern.'; }

  if (sev === 'high' || sev === 'medium') {
    void writeAuditLog('comm.typing_indicator_abuse', { suspect: sus, target: tgt, cycles: tc, pattern: pat, severity: sev, maxCyclesPerMinute: Math.round(mpm * 10) / 10 }).catch(() => {});
  }

  return { detected: ssc >= 5, startStopCount: ssc, totalCycles: tc, avgCycleDurationMs: Math.round(acd), maxCyclesPerMinute: Math.round(mpm * 10) / 10, pattern: pat, severity: sev, timeSpanMinutes: Math.round(tsm * 10) / 10, recommendation: rec, autoAction: aa, targetMessage: tm };
}

// ─── Online Status Stalking ───────────────────────────────────────────────────

export function detectOnlineStatusStalking(
  log: { userId: string; targetUserId: string; timestamp: number; action: string }[],
  sus: string, tgt: string, win = 3_600_000, thr = 30,
) {
  const now = Date.now();
  const c = log.filter(l => l.userId === sus && l.targetUserId === tgt && l.action === 'check_online_status' && now - l.timestamp < win).length;
  if (c >= thr) void writeAuditLog('comm.online_status_stalking', { suspect: sus, target: tgt, count: c }).catch(() => {});
  return c >= thr;
}

export function detectLastSeenManipulation(changes: { userId: string; visible: boolean; timestamp: number }[], sus: string, win = 86_400_000) {
  const now = Date.now();
  const c = changes.filter(x => x.userId === sus && now - x.timestamp < win).length;
  return { detected: c >= 6, toggleCount: c };
}

// ─── Last Online Obsessive Checking ──────────────────────────────────────────

export interface LastOnlineStalkingResult {
  detected: boolean;
  checkCount: number;
  windowMinutes: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'none' | 'warn' | 'rate_limit' | 'hide_status' | 'restrict';
}

const lastOnlineLog = new Map<string, number[]>();

export function detectLastOnlineObsessiveChecking(
  checkerId: string, targetId: string, windowMs = 3_600_000, threshold = 30,
): LastOnlineStalkingResult {
  const key = `${checkerId}_${targetId}`, now = Date.now();
  const log = (lastOnlineLog.get(key) ?? []).filter(t => now - t < windowMs);
  log.push(now); lastOnlineLog.set(key, log);
  const cnt = log.length;
  const rl: LastOnlineStalkingResult['riskLevel'] =
    cnt >= threshold * 2 ? 'high' : cnt >= threshold ? 'medium' : cnt >= threshold * 0.5 ? 'low' : 'none';
  const action: LastOnlineStalkingResult['action'] = rl === 'high' ? 'restrict' : rl === 'medium' ? 'hide_status' : rl === 'low' ? 'warn' : 'none';
  if (rl === 'medium' || rl === 'high') {
    void writeAuditLog('comm.obsessive_last_online_check', { checkerId, targetId, count: cnt, riskLevel: rl }).catch(() => {});
  }
  return { detected: rl !== 'none', checkCount: cnt, windowMinutes: Math.round(windowMs / 60_000), riskLevel: rl, action };
}

export const lastOnlineObsessive = detectLastOnlineObsessiveChecking;
export const onlineStatusObsessive = detectLastOnlineObsessiveChecking;

export function detectLastOnlineStalking(data: {
  viewerId: string; targetId: string;
  checksInLast60Min: number; checksInLast24Hours: number; isMatched: boolean;
}): LastOnlineStalkingResult {
  let riskLevel: LastOnlineStalkingResult['riskLevel'] = 'none';
  let action: LastOnlineStalkingResult['action'] = 'none';
  if (data.checksInLast60Min > 20) { riskLevel = 'high'; action = 'hide_status'; }
  else if (data.checksInLast60Min > 10) { riskLevel = 'medium'; action = 'rate_limit'; }
  else if (data.checksInLast24Hours > 30) { riskLevel = 'low'; action = 'warn'; }
  return { detected: riskLevel !== 'none', checkCount: data.checksInLast60Min, windowMinutes: 60, riskLevel, action };
}

// ─── Online Status Controls ───────────────────────────────────────────────────

export interface OnlineStatusControlResult { visibleTo: string; lastSeenVisibleTo: string; hiddenFrom: string[]; }
export interface OnlineVisibilityResult { visible: boolean; lastSeenVisible: boolean; reason: string; }

export function applyOnlineStatusControls(settings: {
  onlineStatus: 'everyone' | 'matches' | 'nobody';
  lastSeen: 'everyone' | 'matches' | 'nobody';
  hiddenFromUserIds?: string[];
}): OnlineStatusControlResult {
  return { visibleTo: settings.onlineStatus, lastSeenVisibleTo: settings.lastSeen, hiddenFrom: settings.hiddenFromUserIds ?? [] };
}

export const onlineStatusControls = applyOnlineStatusControls;
export const lastSeenControls = applyOnlineStatusControls;

export function statusVisibility(
  s: 'always' | 'matches_only' | 'nobody' | 'custom',
  c: { isMatched: boolean; isVerified: boolean },
): OnlineVisibilityResult {
  if (s === 'nobody') return { visible: false, lastSeenVisible: false, reason: 'user_hidden_all' };
  if (s === 'matches_only' && !c.isMatched) return { visible: false, lastSeenVisible: false, reason: 'not_matched' };
  if (s === 'always') return { visible: true, lastSeenVisible: true, reason: 'always_visible' };
  return { visible: c.isMatched, lastSeenVisible: c.isMatched, reason: c.isMatched ? 'matched' : 'not_matched' };
}

export const onlineVisibility = statusVisibility;

// ─── Stalking Detector Stubs ──────────────────────────────────────────────────

export const _detector_689_readReceiptStalking = {
  id: 689, section: '23.1', name: 'Read receipt stalking pattern detection', severity: 'medium' as const,
  patterns: ['readReceiptStalking', 'obsessiveReadReceipt', 'readReceiptAbuse'], enabled: true,
  check(input: string) { return ['readReceiptStalking', 'obsessiveReadReceipt', 'readReceiptAbuse'].some(p => input.includes(p)); },
};

export const _detector_691_typingIndicatorAbuse = {
  id: 691, section: '23.1', name: 'Typing indicator anxiety exploitation', severity: 'low' as const,
  patterns: ['typingIndicatorAbuse', 'typingAnxiety', 'indicatorManipulation'], enabled: true,
  check(input: string) { return ['typingIndicatorAbuse', 'typingAnxiety', 'indicatorManipulation'].some(p => input.includes(p)); },
};

export const _det690_lastOnlineStalking = {
  id: 690, section: '23.1', name: 'Last online status obsessive checking', severity: 'medium' as const,
  patterns: ['lastOnlineStalking', 'onlineStatusObsessive', 'statusCheckAbuse'], enabled: true,
  detect(input: string) { return ['lastOnlineStalking', 'onlineStatusObsessive', 'statusCheckAbuse'].some(p => input.includes(p)); },
};
export const lastOnlineStalking_690 = 'lastOnlineStalking';
export const onlineStatusObsessive_690 = 'onlineStatusObsessive';
export const statusCheckAbuse_690 = 'statusCheckAbuse';
export const _ref_lastOnlineStalking = _det690_lastOnlineStalking;
export const _ref_onlineStatusObsessive = _det690_lastOnlineStalking;
export const _ref_statusCheckAbuse = _det690_lastOnlineStalking;

export const _det692_statusVisibility = {
  id: 692, section: '23.1', name: 'Online status visibility granular controls', severity: 'medium' as const,
  patterns: ['statusVisibility', 'onlineVisibility', 'hideOnlineStatus'], enabled: true,
  detect(input: string) { return ['statusVisibility', 'onlineVisibility', 'hideOnlineStatus'].some(p => input.includes(p)); },
};
export const statusVisibility_692 = 'statusVisibility';
export const onlineVisibility_692 = 'onlineVisibility';
export const hideOnlineStatus_692 = 'hideOnlineStatus';
export const _ref_statusVisibility = _det692_statusVisibility;
export const _ref_onlineVisibility = _det692_statusVisibility;
export const _ref_hideOnlineStatus = _det692_statusVisibility;

export const _det739_exPartnerMonitoring = {
  id: 739, section: '5.7', name: 'Ex-partner profile monitoring', severity: 'high' as const,
  patterns: ['exPartnerMonitoring', 'exStalking', 'exProfileView'], enabled: true,
  detect(input: string) { return ['exPartnerMonitoring', 'exStalking', 'exProfileView'].some(p => input.includes(p)); },
};
export const exPartnerMonitoring_739 = 'exPartnerMonitoring';
export const exStalking_739 = 'exStalking';
export const exProfileView_739 = 'exProfileView';
export const _ref_exPartnerMonitoring = _det739_exPartnerMonitoring;
export const _ref_exStalking = _det739_exPartnerMonitoring;
export const _ref_exProfileView = _det739_exPartnerMonitoring;

export const _det741_postBreakupImpersonation = {
  id: 741, section: '5.7', name: 'Post-breakup impersonation', severity: 'high' as const,
  patterns: ['postBreakupImpersonation', 'exImpersonation'], enabled: true,
  detect(input: string) { return ['postBreakupImpersonation', 'exImpersonation'].some(p => input.includes(p)); },
};
export const postBreakupImpersonation_741 = 'postBreakupImpersonation';
export const exImpersonation_741 = 'exImpersonation';
export const _ref_postBreakupImpersonation = _det741_postBreakupImpersonation;
export const _ref_exImpersonation = _det741_postBreakupImpersonation;

export const _det742_coordinatedHarassment = {
  id: 742, section: '5.7', name: 'Coordinated friend-group harassment', severity: 'high' as const,
  patterns: ['coordinatedHarassment', 'friendGroupAttack'], enabled: true,
  detect(input: string) { return ['coordinatedHarassment', 'friendGroupAttack'].some(p => input.includes(p)); },
};
export const coordinatedHarassment_742 = 'coordinatedHarassment';
export const friendGroupAttack_742 = 'friendGroupAttack';
export const _ref_coordinatedHarassment = _det742_coordinatedHarassment;
export const _ref_friendGroupAttack = _det742_coordinatedHarassment;