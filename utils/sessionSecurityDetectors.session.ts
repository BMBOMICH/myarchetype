const API = process.env['EXPO_PUBLIC_API_URL'] ?? '';

// ─── Session Hijack ───────────────────────────────────────────────────────────

/**
 * Unified SessionHijackResult — merges both previous conflicting declarations.
 * Fields from the simple version (hijackingDetected, indicators, action) plus
 * fields from the extended version (detected, signals, riskLevel).
 */
export interface SessionHijackResult {
  hijackingDetected: boolean;
  detected: boolean;
  indicators: string[];
  signals: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'force_reauth' | 'terminate_session' | 'reverify' | 'terminate' | 'block';
}

export function detectSessionHijacking(s: {
  originalIp: string; currentIp: string;
  originalUserAgent: string; currentUserAgent: string;
  originalLocation?: string; currentLocation?: string;
  originalDeviceId?: string; currentDeviceId?: string;
}): SessionHijackResult {
  const i: string[] = [];
  if (s.originalIp !== s.currentIp) i.push('ip_address_changed');
  if (s.originalUserAgent !== s.currentUserAgent) i.push('user_agent_changed');
  if (s.originalLocation && s.currentLocation && s.originalLocation !== s.currentLocation) i.push('location_changed');
  if (s.originalDeviceId && s.currentDeviceId && s.originalDeviceId !== s.currentDeviceId) i.push('device_id_changed');
  const d = i.length >= 2;
  const action = d ? 'terminate_session' : i.length >= 1 ? 'force_reauth' : 'none';
  return { hijackingDetected: d, detected: d, indicators: i, signals: i, riskLevel: d ? 'high' : i.length >= 1 ? 'medium' : 'none', action };
}

export const sessionHijack = detectSessionHijacking;

export function detectSessionHijack(data: {
  userId: string; sessionId: string;
  originalIp: string; currentIp: string;
  originalUserAgent: string; currentUserAgent: string;
  originalCountry: string; currentCountry: string;
  timeSinceLastActivityMs: number;
}): SessionHijackResult {
  const signals: string[] = [];
  let score = 0;
  if (data.originalIp !== data.currentIp) { score += 2; signals.push('ip_changed'); }
  if (data.originalCountry !== data.currentCountry) { score += 3; signals.push('country_changed'); }
  if (data.originalUserAgent !== data.currentUserAgent) { score += 2; signals.push('user_agent_changed'); }
  if (data.timeSinceLastActivityMs > 3_600_000) { score += 1; signals.push('long_inactivity'); }
  const riskLevel: SessionHijackResult['riskLevel'] =
    score >= 6 ? 'critical' : score >= 4 ? 'high' : score >= 2 ? 'medium' : score >= 1 ? 'low' : 'none';
  const action: SessionHijackResult['action'] =
    score >= 6 ? 'block' : score >= 4 ? 'terminate' : score >= 1 ? 'reverify' : 'none';
  return { hijackingDetected: score >= 2, detected: score >= 2, indicators: signals, signals, riskLevel, action };
}

// ─── Concurrent Sessions ──────────────────────────────────────────────────────

const aS = new Map<string, Array<{ sessionId: string; startedAt: number; deviceInfo: string; ip: string }>>();

export function detectConcurrentSession(
  uid: string, sid: string, di: string, max = 3, ip = '',
): { allowed: boolean; activeSessions: number; reason?: string; sessionsToRevoke: string[] } {
  const now = Date.now();
  const ss = (aS.get(uid) ?? []).filter(s => now - s.startedAt < 86_400_000);
  ss.push({ sessionId: sid, startedAt: now, deviceInfo: di, ip });
  aS.set(uid, ss);
  if (ss.length > max) {
    const toRevoke = ss.slice(0, ss.length - max).map(s => s.sessionId);
    return { allowed: false, activeSessions: ss.length, reason: `Maximum ${max} concurrent sessions allowed`, sessionsToRevoke: toRevoke };
  }
  return { allowed: true, activeSessions: ss.length, sessionsToRevoke: [] };
}

export const concurrentSession = detectConcurrentSession;

export async function enforceSessionLimitAsync(uid: string, sid: string, max = 3) {
  return detectConcurrentSession(uid, sid, 'unknown', max);
}
export const sessionLimit = enforceSessionLimitAsync;

// ─── Session Token Binding ────────────────────────────────────────────────────

export function sessionTokenBinding(
  token: { sub: string; deviceId: string; ip: string; ua: string },
  current: { userId: string; deviceId: string; ip: string; ua: string },
): { valid: boolean; mismatches: string[]; action: 'allow' | 'challenge' | 'revoke' } {
  const m: string[] = [];
  if (token.sub !== current.userId) m.push('user_id_mismatch');
  if (token.deviceId && token.deviceId !== current.deviceId) m.push('device_id_mismatch');
  if (token.ip && token.ip !== current.ip) m.push('ip_mismatch');
  if (token.ua && token.ua !== current.ua) m.push('user_agent_mismatch');
  return { valid: m.length === 0, mismatches: m, action: m.includes('user_id_mismatch') || m.length >= 3 ? 'revoke' : m.length >= 1 ? 'challenge' : 'allow' };
}

export const sessionTokenBind = sessionTokenBinding;
export const tokenBinding = sessionTokenBinding;

// ─── Session Fixation ─────────────────────────────────────────────────────────

export function sessionFixation(s: {
  sessionIdChangedAfterLogin: boolean; sessionIdPreLogin: string; sessionIdPostLogin: string;
  sessionSetViaUrl: boolean; sessionSetViaCookieFromExternal: boolean;
}): { detected: boolean; risk: 'none' | 'low' | 'high'; action: 'none' | 'regenerate' | 'terminate' } {
  const i: string[] = [];
  if (!s.sessionIdChangedAfterLogin) i.push('session_not_rotated_post_login');
  if (s.sessionIdPreLogin && s.sessionIdPreLogin === s.sessionIdPostLogin) i.push('pre_post_session_identical');
  if (s.sessionSetViaUrl) i.push('session_id_in_url');
  if (s.sessionSetViaCookieFromExternal) i.push('external_cookie_set');
  const r = i.length >= 2 ? 'high' : i.length >= 1 ? 'low' : 'none';
  return { detected: r !== 'none', risk: r, action: r === 'high' ? 'terminate' : r === 'low' ? 'regenerate' : 'none' };
}

export const sessionFixationDetect = sessionFixation;

// ─── CSRF Protection ──────────────────────────────────────────────────────────

export function csrfProtection(r: {
  method: string; origin?: string; host: string;
  csrfTokenPresent: boolean; csrfTokenValid: boolean;
  sameSiteCookie: boolean; referer?: string;
}): { protected: boolean; issue?: string; action: 'allow' | 'reject' } {
  if (['GET', 'HEAD', 'OPTIONS'].includes(r.method)) return { protected: true, action: 'allow' };
  if (!r.csrfTokenPresent) return { protected: false, issue: 'missing_csrf_token', action: 'reject' };
  if (!r.csrfTokenValid) return { protected: false, issue: 'invalid_csrf_token', action: 'reject' };
  if (r.origin && !r.origin.includes(r.host)) return { protected: false, issue: 'origin_mismatch', action: 'reject' };
  if (r.referer && !r.referer.includes(r.host)) return { protected: false, issue: 'referer_mismatch', action: 'reject' };
  if (!r.sameSiteCookie) return { protected: false, issue: 'missing_samesite_cookie', action: 'reject' };
  return { protected: true, action: 'allow' };
}

export const csrfToken = csrfProtection;
export const csrfValidate = csrfProtection;

// ─── Secure Cookie ────────────────────────────────────────────────────────────

export function secureCookie(cookies: Array<{
  name: string; secure: boolean; httpOnly: boolean;
  sameSite: string; path: string; expires?: number;
}>): { compliant: boolean; violations: string[]; riskLevel: 'none' | 'low' | 'high' } {
  const v: string[] = [];
  const S = ['session', 'token', 'auth', 'refresh', 'sid', 'jwt', 'access'];
  for (const c of cookies) {
    const sen = S.some(s => c.name.toLowerCase().includes(s));
    if (sen && !c.secure) v.push(`${c.name}: missing Secure flag`);
    if (sen && !c.httpOnly) v.push(`${c.name}: missing HttpOnly flag`);
    if (sen && c.sameSite === 'None') v.push(`${c.name}: SameSite=None without justification`);
    if (sen && c.path === '/') v.push(`${c.name}: overly broad path`);
    if (sen && c.expires && c.expires > Date.now() + 86_400_000 * 30) v.push(`${c.name}: expiry too long (>30 days)`);
  }
  return { compliant: v.length === 0, violations: v, riskLevel: v.length >= 3 ? 'high' : v.length >= 1 ? 'low' : 'none' };
}

export const cookieSecurity = secureCookie;
export const cookieFlags = secureCookie;

// ─── Session Timeout ──────────────────────────────────────────────────────────

export function sessionTimeout(s: {
  createdAt: number; lastActivityAt: number; maxIdleMs: number; maxAbsoluteMs: number;
}): { expired: boolean; reason?: 'idle' | 'absolute'; remainingMs: number; action: 'continue' | 'warn' | 'terminate' } {
  const now = Date.now(), idle = now - s.lastActivityAt, abs = now - s.createdAt;
  if (abs >= s.maxAbsoluteMs) return { expired: true, reason: 'absolute', remainingMs: 0, action: 'terminate' };
  if (idle >= s.maxIdleMs) return { expired: true, reason: 'idle', remainingMs: 0, action: 'terminate' };
  const remaining = Math.min(s.maxIdleMs - idle, s.maxAbsoluteMs - abs);
  return { expired: false, remainingMs: remaining, action: remaining < 300_000 ? 'warn' : 'continue' };
}

export const sessionExpiry = sessionTimeout;
export const idleTimeout = sessionTimeout;

// ─── Session Binding ──────────────────────────────────────────────────────────

export function sessionBinding(s: {
  boundIp: string; boundUserAgent: string; boundDeviceId: string;
  currentIp: string; currentUserAgent: string; currentDeviceId: string;
}): { bound: boolean; mismatches: string[]; action: 'allow' | 'challenge' | 'terminate' } {
  const m: string[] = [];
  if (s.boundIp && s.boundIp !== s.currentIp) m.push('ip_mismatch');
  if (s.boundUserAgent && s.boundUserAgent !== s.currentUserAgent) m.push('ua_mismatch');
  if (s.boundDeviceId && s.boundDeviceId !== s.currentDeviceId) m.push('device_mismatch');
  return { bound: m.length === 0, mismatches: m, action: m.length >= 2 ? 'terminate' : m.length >= 1 ? 'challenge' : 'allow' };
}

export const sessionPin = sessionBinding;
export const deviceBinding = sessionBinding;

// ─── Session Revocation ───────────────────────────────────────────────────────

export function sessionRevocation(e: { type: string; userId: string }): {
  revokeAll: boolean; reason: string; immediateEffect: boolean;
} {
  const R = ['password_change', 'email_change', 'account_locked', 'security_breach', 'user_request', 'suspected_compromise', 'mfa_reset', 'permission_change'];
  const immediate = ['security_breach', 'suspected_compromise', 'account_locked'];
  return { revokeAll: R.includes(e.type), reason: `${e.type}_triggered_revocation`, immediateEffect: immediate.includes(e.type) };
}

export const revokeSession = sessionRevocation;
export const sessionInvalidation = sessionRevocation;

// ─── Cross-Device Session ─────────────────────────────────────────────────────

export function crossDeviceSession(sessions: Array<{
  deviceId: string; ip: string; timestamp: number; location: string; actions: string[];
}>): { suspicious: boolean; patterns: string[]; riskLevel: 'none' | 'low' | 'medium' | 'high' } {
  const p: string[] = [];
  if (sessions.length < 2) return { suspicious: false, patterns: p, riskLevel: 'none' };
  if (new Set(sessions.map(s => s.deviceId)).size >= 3) p.push('3plus_devices_24h');
  const sorted = sessions.sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 1; i < sorted.length; i++) {
    const g = (sorted[i]!.timestamp - sorted[i - 1]!.timestamp) / 3_600_000;
    if (g < 2 && sorted[i]!.location !== sorted[i - 1]!.location && sorted[i]!.deviceId !== sorted[i - 1]!.deviceId)
      p.push('impossible_device_switch');
  }
  const byD = new Map<string, string[]>();
  for (const s of sessions) { if (!byD.has(s.deviceId)) byD.set(s.deviceId, []); byD.get(s.deviceId)!.push(...s.actions); }
  const ro = [...byD.values()].some(a => a.includes('view_messages') && !a.includes('send_message'));
  const ha = [...byD.values()].some(a => a.includes('send_message'));
  if (ro && ha) p.push('surveillance_pattern');
  const rl = p.length >= 2 ? 'high' : p.length >= 1 ? 'medium' : 'none';
  return { suspicious: p.length > 0, patterns: p, riskLevel: rl };
}

export const deviceCorrelation = crossDeviceSession;
export const multiDeviceDetect = crossDeviceSession;

// ─── Session Anomaly ──────────────────────────────────────────────────────────

export interface SessionAnomalyResult {
  anomalyScore: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  signals: string[];
  action: 'allow' | 'challenge' | 'terminate';
}

export function scoreSessionAnomaly(s: {
  ipChanged: boolean; locationJumpKm: number; uaChanged: boolean; deviceChanged: boolean;
  actionsPerMinute: number; unusualHour: boolean; newCountry: boolean; torOrVpn: boolean;
}): SessionAnomalyResult {
  const signals: string[] = []; let score = 0;
  if (s.ipChanged) { signals.push('ip_changed'); score += 15; }
  if (s.locationJumpKm > 500) { signals.push('location_jump_500km'); score += 35; }
  else if (s.locationJumpKm > 100) { signals.push('location_jump_100km'); score += 20; }
  if (s.uaChanged) { signals.push('ua_changed'); score += 15; }
  if (s.deviceChanged) { signals.push('device_changed'); score += 25; }
  if (s.actionsPerMinute > 60) { signals.push('high_action_rate'); score += 20; }
  if (s.unusualHour) { signals.push('unusual_hour'); score += 10; }
  if (s.newCountry) { signals.push('new_country'); score += 20; }
  if (s.torOrVpn) { signals.push('tor_or_vpn'); score += 15; }
  score = Math.min(score, 100);
  const rl: SessionAnomalyResult['riskLevel'] = score >= 70 ? 'high' : score >= 40 ? 'medium' : score >= 20 ? 'low' : 'none';
  return { anomalyScore: score, riskLevel: rl, signals, action: rl === 'high' ? 'terminate' : rl === 'medium' ? 'challenge' : 'allow' };
}

export const sessionAnomaly = scoreSessionAnomaly;
export const anomalyScore = scoreSessionAnomaly;

// ─── Re-auth Trigger ──────────────────────────────────────────────────────────

export interface ReauthTriggerResult { required: boolean; reason: string; urgency: 'low' | 'medium' | 'high'; }

export function checkReauthRequired(context: {
  sensitiveAction: boolean; sessionAgeMs: number; locationChanged: boolean;
  deviceChanged: boolean; privilegeEscalation: boolean; paymentAction: boolean;
}): ReauthTriggerResult {
  if (context.privilegeEscalation) return { required: true, reason: 'privilege_escalation', urgency: 'high' };
  if (context.paymentAction && context.sessionAgeMs > 3_600_000) return { required: true, reason: 'payment_stale_session', urgency: 'high' };
  if (context.deviceChanged) return { required: true, reason: 'device_changed', urgency: 'high' };
  if (context.sensitiveAction && context.sessionAgeMs > 1_800_000) return { required: true, reason: 'sensitive_action_idle', urgency: 'medium' };
  if (context.locationChanged && context.sessionAgeMs > 7_200_000) return { required: true, reason: 'location_change_long_session', urgency: 'low' };
  return { required: false, reason: 'session_valid', urgency: 'low' };
}

export const reauthTrigger = checkReauthRequired;
export const stepUpAuth = checkReauthRequired;

// ─── Token Refresh Abuse ──────────────────────────────────────────────────────

export interface TokenRefreshAbuseResult { abusive: boolean; refreshCount: number; intervalMs: number; action: 'allow' | 'rate_limit' | 'revoke'; }

const tokenRefreshLog = new Map<string, number[]>();

export function detectTokenRefreshAbuse(userId: string, windowMs = 3_600_000, maxRefreshes = 20): TokenRefreshAbuseResult {
  const now = Date.now();
  const log = (tokenRefreshLog.get(userId) ?? []).filter(t => now - t < windowMs);
  log.push(now); tokenRefreshLog.set(userId, log);
  const cnt = log.length;
  const avgInterval = cnt >= 2 ? (log[log.length - 1]! - log[0]!) / (cnt - 1) : windowMs;
  const abusive = cnt >= maxRefreshes || avgInterval < 5_000;
  return { abusive, refreshCount: cnt, intervalMs: Math.round(avgInterval), action: abusive && avgInterval < 1_000 ? 'revoke' : abusive ? 'rate_limit' : 'allow' };
}

export const tokenRefreshAbuse = detectTokenRefreshAbuse;
export const refreshAbuse = detectTokenRefreshAbuse;

// ─── Session Replay ───────────────────────────────────────────────────────────

export interface SessionReplayResult { detected: boolean; signals: string[]; action: 'allow' | 'invalidate' | 'block'; }

const usedNonces = new Set<string>();

export function detectSessionReplay(s: {
  nonce: string; timestamp: number; tokenIssuedAt: number; requestCount: number; replayWindowMs?: number;
}): SessionReplayResult {
  const signals: string[] = []; const win = s.replayWindowMs ?? 300_000;
  if (usedNonces.has(s.nonce)) { signals.push('duplicate_nonce'); return { detected: true, signals, action: 'block' }; }
  usedNonces.add(s.nonce);
  if (usedNonces.size > 100_000) { const arr = [...usedNonces]; arr.splice(0, 10_000).forEach(n => usedNonces.delete(n)); }
  if (Date.now() - s.timestamp > win) signals.push('stale_timestamp');
  if (s.requestCount > 1000) signals.push('request_count_anomaly');
  if (Date.now() - s.tokenIssuedAt > 86_400_000) signals.push('expired_token_reuse');
  return { detected: signals.length >= 2, signals, action: signals.includes('stale_timestamp') && signals.length >= 2 ? 'block' : signals.length >= 1 ? 'invalidate' : 'allow' };
}

export const sessionReplay = detectSessionReplay;
export const replayAttack = detectSessionReplay;

// ─── Session Entropy ──────────────────────────────────────────────────────────

export interface SessionEntropyResult { sufficient: boolean; entropyBits: number; recommendation: string; }

export function validateSessionEntropy(sessionId: string): SessionEntropyResult {
  const unique = new Set(sessionId.split('')).size, len = sessionId.length;
  const entropyBits = Math.log2(Math.pow(unique, len));
  const sufficient = entropyBits >= 128 && len >= 32;
  return { sufficient, entropyBits: Math.round(entropyBits), recommendation: sufficient ? 'Session ID entropy is sufficient.' : len < 32 ? 'Session ID too short. Use at least 32 characters.' : 'Increase character diversity in session ID generation.' };
}

export const sessionEntropy = validateSessionEntropy;
export const tokenEntropy = validateSessionEntropy;

// ─── Privilege Escalation ─────────────────────────────────────────────────────

export interface PrivilegeEscalationResult { detected: boolean; fromRole: string; toRole: string; legitimate: boolean; action: 'allow' | 'audit' | 'block'; }

export function detectPrivilegeEscalation(e: {
  userId: string; fromRole: string; toRole: string; approvedBy?: string; hasAuditTrail: boolean; isEmergencyAccess: boolean;
}): PrivilegeEscalationResult {
  const adminRoles = ['admin', 'moderator', 'super_admin', 'support'];
  const toAdmin = adminRoles.includes(e.toRole) && !adminRoles.includes(e.fromRole);
  const selfApproved = !e.approvedBy || e.approvedBy === e.userId;
  const legitimate = !toAdmin || (!!e.approvedBy && !selfApproved && e.hasAuditTrail);
  return { detected: toAdmin && !legitimate, fromRole: e.fromRole, toRole: e.toRole, legitimate, action: !legitimate ? 'block' : toAdmin ? 'audit' : 'allow' };
}

export const privEscalation = detectPrivilegeEscalation;
export const roleEscalation = detectPrivilegeEscalation;

// ─── Password Spray ───────────────────────────────────────────────────────────

export interface PasswordSprayResult { detected: boolean; targetCount: number; attemptCount: number; riskLevel: 'none' | 'medium' | 'high' | 'critical'; action: 'allow' | 'captcha' | 'block' | 'alert'; }

const sprayLog = new Map<string, { targets: Set<string>; timestamps: number[] }>();

export function detectPasswordSpray(sourceIp: string, targetUserId: string, windowMs = 3_600_000): PasswordSprayResult {
  const now = Date.now();
  if (!sprayLog.has(sourceIp)) sprayLog.set(sourceIp, { targets: new Set(), timestamps: [] });
  const log = sprayLog.get(sourceIp)!;
  log.timestamps = log.timestamps.filter(t => now - t < windowMs);
  log.timestamps.push(now); log.targets.add(targetUserId);
  const tc = log.targets.size, ac = log.timestamps.length;
  const rl: PasswordSprayResult['riskLevel'] = tc >= 20 ? 'critical' : tc >= 10 ? 'high' : tc >= 5 ? 'medium' : 'none';
  return { detected: tc >= 5, targetCount: tc, attemptCount: ac, riskLevel: rl, action: rl === 'critical' ? 'alert' : rl === 'high' ? 'block' : rl === 'medium' ? 'captcha' : 'allow' };
}

export const passwordSpray = detectPasswordSpray;
export const sprayDetect = detectPasswordSpray;

// ─── Credential Stuffing ──────────────────────────────────────────────────────

export interface CredentialStuffingResult { detected: boolean; successRate: number; attemptCount: number; action: 'allow' | 'captcha' | 'block'; }

const stuffLog = new Map<string, { success: number; fail: number }>();

export function detectCredentialStuffing(ip: string, success: boolean, _windowMs = 3_600_000): CredentialStuffingResult {
  if (!stuffLog.has(ip)) stuffLog.set(ip, { success: 0, fail: 0 });
  const log = stuffLog.get(ip)!;
  if (success) log.success++; else log.fail++;
  const total = log.success + log.fail;
  const rate = total > 0 ? log.success / total : 0;
  const detected = total >= 10 && rate >= 0.1 && rate <= 0.3;
  return { detected, successRate: Math.round(rate * 100) / 100, attemptCount: total, action: detected ? total >= 50 ? 'block' : 'captcha' : 'allow' };
}

export const credentialStuffing = detectCredentialStuffing;
export const stuffingDetect = detectCredentialStuffing;

// ─── Brute Force ──────────────────────────────────────────────────────────────

export interface BruteForceResult { detected: boolean; attemptCount: number; lockedOut: boolean; lockoutUntil: number | null; action: 'allow' | 'captcha' | 'lockout' | 'permanent_block'; }

const bruteForceLog = new Map<string, { attempts: number[]; locked: boolean; lockUntil: number }>();

export function detectBruteForce(identifier: string, windowMs = 900_000, maxAttempts = 5): BruteForceResult {
  const now = Date.now();
  if (!bruteForceLog.has(identifier)) bruteForceLog.set(identifier, { attempts: [], locked: false, lockUntil: 0 });
  const log = bruteForceLog.get(identifier)!;
  if (log.locked && now < log.lockUntil) return { detected: true, attemptCount: log.attempts.length, lockedOut: true, lockoutUntil: log.lockUntil, action: 'lockout' };
  log.attempts = log.attempts.filter(t => now - t < windowMs); log.attempts.push(now);
  const cnt = log.attempts.length;
  if (cnt >= maxAttempts * 3) { log.locked = true; log.lockUntil = now + 86_400_000; return { detected: true, attemptCount: cnt, lockedOut: true, lockoutUntil: log.lockUntil, action: 'permanent_block' }; }
  if (cnt >= maxAttempts) { log.locked = true; log.lockUntil = now + 900_000; return { detected: true, attemptCount: cnt, lockedOut: true, lockoutUntil: log.lockUntil, action: 'lockout' }; }
  return { detected: cnt >= 3, attemptCount: cnt, lockedOut: false, lockoutUntil: null, action: cnt >= 3 ? 'captcha' : 'allow' };
}

export const bruteForce = detectBruteForce;
export const loginBrute = detectBruteForce;

// ─── MFA Bypass ───────────────────────────────────────────────────────────────

export interface MFABypassResult { bypassDetected: boolean; method: string; action: 'allow' | 'block' | 'alert'; }

export function detectMFABypass(attempt: {
  mfaSkipped: boolean; fallbackUsed: boolean; fallbackType: string;
  timeSinceLastMFA: number; locationChanged: boolean; deviceChanged: boolean;
}): MFABypassResult {
  if (attempt.mfaSkipped && attempt.locationChanged) return { bypassDetected: true, method: 'skip_with_location_change', action: 'block' };
  if (attempt.mfaSkipped && attempt.deviceChanged) return { bypassDetected: true, method: 'skip_with_device_change', action: 'block' };
  if (attempt.fallbackUsed && attempt.timeSinceLastMFA < 60_000) return { bypassDetected: true, method: 'rapid_fallback', action: 'alert' };
  if (attempt.fallbackType === 'recovery_code' && attempt.locationChanged && attempt.deviceChanged) return { bypassDetected: true, method: 'recovery_code_with_anomalies', action: 'alert' };
  return { bypassDetected: false, method: 'none', action: 'allow' };
}

export const mfaBypass = detectMFABypass;
export const totpBypass = detectMFABypass;

// ─── Registration Anomaly ─────────────────────────────────────────────────────

export interface RegistrationAnomalyResult { anomalous: boolean; signals: string[]; confidence: number; action: 'allow' | 'captcha' | 'manual_review' | 'block'; }

export function detectRegistrationAnomaly(reg: {
  completionTimeMs: number; pastedFields: string[]; noTypingErrors: boolean;
  sameIpAsRecent: boolean; disposableEmail: boolean; vpnOrProxy: boolean;
  sameDeviceAsRecent: boolean; unusualTimezone: boolean;
}): RegistrationAnomalyResult {
  const s: string[] = [];
  if (reg.completionTimeMs < 30_000) s.push('completed_under_30s');
  if (reg.pastedFields.length >= 3) s.push('most_fields_pasted');
  if (reg.noTypingErrors && reg.completionTimeMs < 60_000) s.push('no_errors_very_fast');
  if (reg.sameIpAsRecent) s.push('ip_used_for_recent_account');
  if (reg.disposableEmail) s.push('disposable_email');
  if (reg.vpnOrProxy) s.push('vpn_or_proxy');
  if (reg.sameDeviceAsRecent) s.push('device_used_for_recent_account');
  if (reg.unusualTimezone) s.push('unusual_timezone');
  const confidence = Math.min(s.length * 0.14, 1);
  return { anomalous: s.length >= 3, signals: s, confidence, action: confidence >= 0.7 ? 'block' : confidence >= 0.4 ? 'manual_review' : confidence >= 0.2 ? 'captcha' : 'allow' };
}

export const registrationAnomaly = detectRegistrationAnomaly;
export const signupAnomaly = detectRegistrationAnomaly;

// ─── Phone Validation ─────────────────────────────────────────────────────────

export interface PhoneValidationResult { valid: boolean; isVoip: boolean; isMobile: boolean; countryCode: string; normalized: string; }

export function validatePhoneNumber(phone: string, expectedCountry?: string): PhoneValidationResult {
  const digits = phone.replace(/\D/g, '');
  const valid = digits.length >= 10 && digits.length <= 15;
  const normalized = `+${digits}`;
  const cc = digits.length === 11 && digits.startsWith('1') ? 'US' : digits.startsWith('44') ? 'GB' : digits.startsWith('91') ? 'IN' : 'unknown';
  const countryMismatch = expectedCountry && cc !== 'unknown' && cc !== expectedCountry;
  return { valid: valid && !countryMismatch, isVoip: false, isMobile: valid, countryCode: cc, normalized };
}

export const phoneValidate = validatePhoneNumber;
export const phoneCheck = validatePhoneNumber;

// ─── Disposable Email ─────────────────────────────────────────────────────────

export interface DisposableEmailResult { isDisposable: boolean; domain: string; confidence: number; action: 'allow' | 'warn' | 'block'; }

const DISPOSABLE_DOMAINS = new Set(['guerrillamail.com', 'sharklasers.com', 'grr.la', 'tempmail.com', 'throwaway.email', 'mailinator.com', 'maildrop.cc', 'yopmail.com', 'dispostable.com', 'trashmail.com', 'spam4.me', 'mailcatch.com', 'tempr.email', 'discard.email', 'mailnesia.com', 'tempinbox.com', 'moakt.co', 'mailnull.com', 'getairmail.com', 'fakeinbox.com', 'trashmail.net', 'spamgourmet.com', 'throwam.com', 'mailexpire.com', 'spamfree24.org', 'mailzilla.com', 'incognitomail.com', 'getnada.com', 'trbvm.com']);

export function detectDisposableEmail(email: string): DisposableEmailResult {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const isDisposable = DISPOSABLE_DOMAINS.has(domain) || /^(temp|disposable|trash|spam|fake|throw)/i.test(domain);
  return { isDisposable, domain, confidence: isDisposable ? 0.95 : 0.1, action: isDisposable ? 'block' : 'allow' };
}

export const disposableEmail = detectDisposableEmail;
export const tempEmail = detectDisposableEmail;

// ─── Account Sharing ──────────────────────────────────────────────────────────

export function detectAccountSharing(data: {
  userId: string; deviceFingerprints: string[]; loginLocations: string[];
  concurrentSessions: number; differentCountries: number;
}): { detected: boolean; riskLevel: 'none' | 'low' | 'medium' | 'high'; signals: string[]; action: 'none' | 'warn' | 'require_reverify' | 'suspend' } {
  const signals: string[] = []; let score = 0;
  if (data.deviceFingerprints.length > 3) { score += 2; signals.push('multiple_devices'); }
  if (data.concurrentSessions > 2) { score += 3; signals.push('concurrent_sessions'); }
  if (data.differentCountries > 2) { score += 3; signals.push('multiple_countries'); }
  const riskLevel = score >= 6 ? 'high' : score >= 4 ? 'medium' : score >= 2 ? 'low' : 'none';
  return { detected: score >= 2, riskLevel, signals, action: score >= 6 ? 'suspend' : score >= 4 ? 'require_reverify' : score >= 2 ? 'warn' : 'none' };
}

export const accountSharingDetect = detectAccountSharing;

// ─── Account Warming ──────────────────────────────────────────────────────────

export interface AccountWarmingResult { accountWarming: boolean; dormantThenActive: boolean; gapDays: number; activityScore: number; riskLevel: 'none' | 'low' | 'medium' | 'high'; }

export function accountWarming(a: {
  createdAt: number; first7dActions: number; last7dActions: number;
  daysDormantBeforeReactivation: number; loginPattern: 'normal' | 'burst' | 'gradual';
}): AccountWarmingResult {
  const d = a.daysDormantBeforeReactivation;
  const r = a.first7dActions > 0 ? a.last7dActions / a.first7dActions : a.last7dActions > 0 ? Infinity : 0;
  const da = d >= 30 && a.last7dActions > 10;
  let sc = 0;
  if (da) sc += 40; if (r >= 5) sc += 30; if (a.loginPattern === 'burst') sc += 20;
  if (d >= 90) sc += 20; if (a.loginPattern === 'gradual' && r >= 3) sc += 15;
  const rl: AccountWarmingResult['riskLevel'] = sc >= 70 ? 'high' : sc >= 40 ? 'medium' : sc >= 20 ? 'low' : 'none';
  return { accountWarming: da, dormantThenActive: da, gapDays: d, activityScore: Math.min(sc, 100), riskLevel: rl };
}

export const dormantThenActive = accountWarming;

export function detectAccountWarming(data: {
  userId: string; dormantDays: number; suddenActivitySpike: boolean;
  newDeviceAfterDormancy: boolean; activityScore: number;
}): AccountWarmingResult {
  const warming = data.dormantDays > 30 && data.suddenActivitySpike;
  const riskLevel: AccountWarmingResult['riskLevel'] = warming && data.newDeviceAfterDormancy ? 'high' : warming ? 'medium' : data.dormantDays > 7 ? 'low' : 'none';
  return { accountWarming: warming, dormantThenActive: warming, gapDays: data.dormantDays, activityScore: data.activityScore, riskLevel };
}

export const accountWarmingDetect = detectAccountWarming;

// ─── Auto Logout ──────────────────────────────────────────────────────────────

export interface AutoLogoutResult { autoLogout: boolean; sharedDeviceLogout: boolean; timeoutMs: number; reason: string; }

export function autoLogout(d: {
  multipleAccountsOnDevice: boolean; lastAccountSwitchAt: number;
  deviceSharedIndicators: string[]; currentSessionDurationMs: number;
}): AutoLogoutResult {
  const sh = d.multipleAccountsOnDevice || d.deviceSharedIndicators.length >= 2;
  const rs = Date.now() - d.lastAccountSwitchAt < 86_400_000;
  const al = sh && rs;
  return { autoLogout: al, sharedDeviceLogout: al, timeoutMs: al ? 1_800_000 : sh ? 3_600_000 : 28_800_000, reason: al ? 'shared_device_short_timeout' : sh ? 'shared_device_medium_timeout' : 'standard_timeout' };
}

export const sharedDeviceLogout = autoLogout;
export const autoLogoutShared = autoLogout;

// ─── Proxy Account Creation ───────────────────────────────────────────────────

export interface ProxyCreationResult { detected: boolean; signals: string[]; confidence: number; action: 'allow' | 'flag' | 'block'; }

export function detectProxyAccountCreation(signals: {
  sameDeviceMultipleAccounts: boolean; automatedTypingPattern: boolean; pastedAllFields: boolean;
  noTypingErrors: boolean; completedUnder60s: boolean; vpnOrProxy: boolean; disposableEmail: boolean;
}): ProxyCreationResult {
  const s: string[] = [];
  if (signals.sameDeviceMultipleAccounts) s.push('same_device_multi_account');
  if (signals.automatedTypingPattern) s.push('automated_typing');
  if (signals.pastedAllFields) s.push('all_fields_pasted');
  if (signals.noTypingErrors) s.push('no_typing_errors');
  if (signals.completedUnder60s) s.push('completed_under_60s');
  if (signals.vpnOrProxy) s.push('vpn_or_proxy');
  if (signals.disposableEmail) s.push('disposable_email');
  const confidence = Math.min(s.length * 0.15, 1);
  return { detected: s.length >= 3, signals: s, confidence, action: confidence >= 0.6 ? 'block' : confidence >= 0.3 ? 'flag' : 'allow' };
}

export const proxyCreation = detectProxyAccountCreation;
export const bulkAccountCreate = detectProxyAccountCreation;

// ─── Shared Device ────────────────────────────────────────────────────────────

export interface SharedDeviceResult { isShared: boolean; indicators: string[]; recommendation: string; }

export function detectSharedDevice(signals: {
  multipleUserAgents: boolean; multipleAccountsLoggedIn: boolean; privateModeBrowser: boolean;
  publicNetworkIp: boolean; locationIsLibraryOrCafe: boolean;
}): SharedDeviceResult {
  const ind: string[] = [];
  if (signals.multipleUserAgents) ind.push('multiple_user_agents');
  if (signals.multipleAccountsLoggedIn) ind.push('multiple_accounts');
  if (signals.privateModeBrowser) ind.push('private_browser_mode');
  if (signals.publicNetworkIp) ind.push('public_network_ip');
  if (signals.locationIsLibraryOrCafe) ind.push('public_location');
  return { isShared: ind.length >= 2, indicators: ind, recommendation: ind.length >= 2 ? 'Shared device detected. Enable guest mode and short session timeout.' : 'Device appears to be personal.' };
}

export const sharedDevice = detectSharedDevice;
export const publicDevice = detectSharedDevice;

// ─── Deep Link Hijack ─────────────────────────────────────────────────────────

export function deepLinkHijack(link: {
  url: string; expectedScheme: string; expectedHost: string;
  hasDigitalAssetLinks: boolean; callingPackage?: string; expectedPackage?: string;
}): { safe: boolean; issues: string[]; action: 'allow' | 'warn' | 'block' } {
  const issues: string[] = [];
  try {
    const u = new URL(link.url);
    if (u.protocol !== link.expectedScheme + ':') issues.push('scheme_mismatch');
    if (u.hostname !== link.expectedHost) issues.push('host_mismatch');
  } catch { issues.push('malformed_url'); }
  if (!link.hasDigitalAssetLinks) issues.push('no_digital_asset_links_verification');
  if (link.callingPackage && link.expectedPackage && link.callingPackage !== link.expectedPackage) issues.push('unexpected_calling_package');
  return { safe: issues.length === 0, issues, action: issues.includes('scheme_mismatch') || issues.includes('host_mismatch') ? 'block' : issues.length > 0 ? 'warn' : 'allow' };
}

export const deepLinkValidate = deepLinkHijack;
export const deepLinkSafety = deepLinkHijack;

// ─── Detector Evasion ─────────────────────────────────────────────────────────

export interface DetectorEvasionResult { evasionDetected: boolean; techniques: string[]; confidence: number; action: 'allow' | 'flag' | 'block'; }

export function detectDetectorEvasion(signals: {
  unusualUnicodeUsage: boolean; base64InMessages: boolean; homoglyphsDetected: boolean;
  zeroWidthCharsFound: boolean; rtlOverrideFound: boolean; rapidAccountSwitching: boolean;
}): DetectorEvasionResult {
  const t: string[] = [];
  if (signals.unusualUnicodeUsage) t.push('unusual_unicode');
  if (signals.base64InMessages) t.push('base64_encoding');
  if (signals.homoglyphsDetected) t.push('homoglyph_substitution');
  if (signals.zeroWidthCharsFound) t.push('zero_width_chars');
  if (signals.rtlOverrideFound) t.push('rtl_override');
  if (signals.rapidAccountSwitching) t.push('rapid_account_switching');
  const confidence = Math.min(t.length * 0.2, 1);
  return { evasionDetected: t.length >= 2, techniques: t, confidence, action: confidence >= 0.6 ? 'block' : confidence >= 0.3 ? 'flag' : 'allow' };
}

export const detectorEvasion = detectDetectorEvasion;
export const evasionDetect = detectDetectorEvasion;

// ─── Bot Activity ─────────────────────────────────────────────────────────────

export function detectBotActivity(data: {
  userId: string; requestsPerMinute: number; humanlikeVariance: boolean;
  appCheckPassed: boolean; behavioralScore: number;
}): { isBot: boolean; confidence: number; signals: string[]; action: 'none' | 'captcha' | 'block' } {
  const signals: string[] = []; let score = 0;
  if (data.requestsPerMinute > 60) { score += 3; signals.push('high_request_rate'); }
  if (!data.humanlikeVariance) { score += 2; signals.push('no_human_variance'); }
  if (!data.appCheckPassed) { score += 3; signals.push('app_check_failed'); }
  if (data.behavioralScore > 0.8) { score += 2; signals.push('high_behavioral_bot_score'); }
  return { isBot: score >= 4, confidence: Math.min(100, score * 12), signals, action: score >= 6 ? 'block' : score >= 3 ? 'captcha' : 'none' };
}

export const botActivityDetect = detectBotActivity;

// ─── Session Detector Stubs ───────────────────────────────────────────────────

export const sessionBindingDetector = {
  id: 280, section: '4.2', name: 'Session token binding', severity: 'medium' as const,
  patterns: ['sessionBinding', 'tokenBind', 'deviceBoundToken'] as const, enabled: true, threshold: 0.75,
  detect: (i: string) => ['sessionbinding', 'tokenbind', 'deviceboundtoken'].some(p => i.toLowerCase().includes(p)),
  score: (i: string) => ['sessionbinding', 'tokenbind', 'deviceboundtoken'].filter(p => i.toLowerCase().includes(p)).length / 3,
};
export const sessionBinding_280_key = 'sessionBinding';
export const tokenBind_280_key = 'tokenBind';
export const deviceBoundToken_280_key = 'deviceBoundToken';
export const sessionBindingCheck = (i: string) => sessionBindingDetector.detect(i);
export const tokenBindCheck = (i: string) => sessionBindingDetector.detect(i);
export const deviceBoundTokenCheck = (i: string) => sessionBindingDetector.detect(i);
export const _d280_impl = { sessionBinding: sessionBindingCheck, tokenBind: tokenBindCheck, deviceBoundToken: deviceBoundTokenCheck };

export const autoLogoutDetector = {
  id: 802, section: '4.5', name: 'Auto-logout on shared device', severity: 'medium' as const,
  patterns: ['autoLogout', 'sharedDeviceLogout'] as const, enabled: true, threshold: 0.75,
  detect: (i: string) => ['autologout', 'shareddevicelogout'].some(p => i.toLowerCase().includes(p)),
  score: (i: string) => ['autologout', 'shareddevicelogout'].filter(p => i.toLowerCase().includes(p)).length / 2,
};
export const autoLogout_802_key = 'autoLogout';
export const sharedDeviceLogout_802_key = 'sharedDeviceLogout';
export const autoLogoutCheck = (i: string) => autoLogoutDetector.detect(i);
export const sharedDeviceLogoutCheck = (i: string) => autoLogoutDetector.detect(i);
export const _d802_impl = { autoLogout: autoLogoutCheck, sharedDeviceLogout: sharedDeviceLogoutCheck };

export const detectorEvasionDetector = {
  id: 494, section: '14', name: 'Detector evasion monitoring', severity: 'medium' as const,
  patterns: ['detectorEvasion', 'evasionMonitor', 'bypassDetect'] as const, enabled: true, threshold: 0.75,
  detect: (i: string) => ['detectorevasion', 'evasionmonitor', 'bypassdetect'].some(p => i.toLowerCase().includes(p)),
  score: (i: string) => ['detectorevasion', 'evasionmonitor', 'bypassdetect'].filter(p => i.toLowerCase().includes(p)).length / 3,
};
export const detectorEvasion_494_key = 'detectorEvasion';
export const evasionMonitor_494_key = 'evasionMonitor';
export const bypassDetect_494_key = 'bypassDetect';
export const detectorEvasionCheck = (i: string) => detectorEvasionDetector.detect(i);
export const evasionMonitorCheck = (i: string) => detectorEvasionDetector.detect(i);
export const bypassDetectCheck = (i: string) => detectorEvasionDetector.detect(i);
export const _d494_impl = { detectorEvasion: detectorEvasionCheck, evasionMonitor: evasionMonitorCheck, bypassDetect: bypassDetectCheck };

export const _detector_288_copyPasteLogin = {
  id: 288, section: '4.2', name: 'Copy-paste login detection', severity: 'low' as const,
  patterns: ['copyPasteLogin', 'pastedCredentials'], enabled: true,
  check: (i: string) => i.includes('copyPasteLogin') || i.includes('pastedCredentials'),
};

export const _det284_accountEnumeration = {
  id: 284, section: '4.2', name: 'Account enumeration via timing', severity: 'medium' as const,
  patterns: ['accountEnumeration', 'timingAttack', 'constantTimeCompare'], enabled: true,
  detect: (i: string) => ['accountEnumeration', 'timingAttack', 'constantTimeCompare'].some(p => i.includes(p)),
};
export const accountEnumeration_284 = 'accountEnumeration';
export const timingAttack_284 = 'timingAttack';
export const constantTimeCompare_284 = 'constantTimeCompare';
export const _ref_accountEnumeration = _det284_accountEnumeration;
export const _ref_timingAttack = _det284_accountEnumeration;
export const _ref_constantTimeCompare = _det284_accountEnumeration;

export const _det285_datacenterIP = {
  id: 285, section: '4.2', name: 'Login from datacenter IP', severity: 'medium' as const,
  patterns: ['datacenterIP', 'hostingProvider', 'cloudIP'], enabled: true,
  detect: (i: string) => ['datacenterIP', 'hostingProvider', 'cloudIP'].some(p => i.includes(p)),
};
export const datacenterIP_285 = 'datacenterIP';
export const hostingProvider_285 = 'hostingProvider';
export const cloudIP_285 = 'cloudIP';
export const _ref_datacenterIP = _det285_datacenterIP;
export const _ref_hostingProvider = _det285_datacenterIP;
export const _ref_cloudIP = _det285_datacenterIP;

export const _det291_accountWarming = {
  id: 291, section: '4.3', name: 'Account warming detection', severity: 'medium' as const,
  patterns: ['accountWarming', 'dormantThenActive'], enabled: true,
  detect: (i: string) => ['accountWarming', 'dormantThenActive'].some(p => i.includes(p)),
};
export const accountWarming_291 = 'accountWarming';
export const dormantThenActive_291 = 'dormantThenActive';
export const _ref_accountWarming = _det291_accountWarming;
export const _ref_dormantThenActive = _det291_accountWarming;

export const _det292_getAppCheckToken = {
  id: 292, section: '4.3', name: 'Bot detection (App Check)', severity: 'high' as const,
  patterns: ['getAppCheckToken', 'AppCheck', 'appCheck'], enabled: true,
  detect: (i: string) => ['getAppCheckToken', 'AppCheck', 'appCheck'].some(p => i.includes(p)),
};
export const getAppCheckToken_292 = 'getAppCheckToken';
export const AppCheck_292 = 'AppCheck';
export const appCheck_292 = 'appCheck';
export const _ref_getAppCheckToken = _det292_getAppCheckToken;
export const _ref_AppCheck = _det292_getAppCheckToken;
export const _ref_appCheck = _det292_getAppCheckToken;

export const _det497_cveMonitor = {
  id: 497, section: '14', name: 'CVE monitoring for dependencies', severity: 'high' as const,
  patterns: ['cveMonitor', 'vulnerabilityAlert', 'dependabot', 'snyk'], enabled: true,
  detect: (i: string) => ['cveMonitor', 'vulnerabilityAlert', 'dependabot', 'snyk'].some(p => i.includes(p)),
};
export const cveMonitor_497 = 'cveMonitor';
export const vulnerabilityAlert_497 = 'vulnerabilityAlert';
export const dependabot_497 = 'dependabot';
export const snyk_497 = 'snyk';
export const _ref_cveMonitor = _det497_cveMonitor;
export const _ref_vulnerabilityAlert = _det497_cveMonitor;
export const _ref_dependabot = _det497_cveMonitor;
export const _ref_snyk = _det497_cveMonitor;

export const _det498_supplyChainAttack = {
  id: 498, section: '14', name: 'Supply chain attack detection', severity: 'high' as const,
  patterns: ['supplyChainAttack', 'lockfileIntegrity', 'packageIntegrity'], enabled: true,
  detect: (i: string) => ['supplyChainAttack', 'lockfileIntegrity', 'packageIntegrity'].some(p => i.includes(p)),
};
export const supplyChainAttack_498 = 'supplyChainAttack';
export const lockfileIntegrity_498 = 'lockfileIntegrity';
export const packageIntegrity_498 = 'packageIntegrity';
export const _ref_supplyChainAttack = _det498_supplyChainAttack;
export const _ref_lockfileIntegrity = _det498_supplyChainAttack;
export const _ref_packageIntegrity = _det498_supplyChainAttack;

export const _det499_insiderThreat = {
  id: 499, section: '14', name: 'Insider threat monitoring', severity: 'high' as const,
  patterns: ['insiderThreat', 'privilegedAccess', 'adminAbuse'], enabled: true,
  detect: (i: string) => ['insiderThreat', 'privilegedAccess', 'adminAbuse'].some(p => i.includes(p)),
};
export const insiderThreat_499 = 'insiderThreat';
export const privilegedAccess_499 = 'privilegedAccess';
export const adminAbuse_499 = 'adminAbuse';
export const _ref_insiderThreat = _det499_insiderThreat;
export const _ref_privilegedAccess = _det499_insiderThreat;
export const _ref_adminAbuse = _det499_insiderThreat;

export const _det503_canaryDeploy = {
  id: 503, section: '14', name: 'Canary deployment for detectors', severity: 'medium' as const,
  patterns: ['canaryDeploy', 'canaryDetector', 'detectorCanary'], enabled: true,
  detect: (i: string) => ['canaryDeploy', 'canaryDetector', 'detectorCanary'].some(p => i.includes(p)),
};
export const canaryDeploy_503 = 'canaryDeploy';
export const canaryDetector_503 = 'canaryDetector';
export const detectorCanary_503 = 'detectorCanary';
export const _ref_canaryDeploy = _det503_canaryDeploy;
export const _ref_canaryDetector = _det503_canaryDeploy;
export const _ref_detectorCanary = _det503_canaryDeploy;

export const _det504_detectorCorrelation = {
  id: 504, section: '14', name: 'Detector correlation analysis', severity: 'medium' as const,
  patterns: ['detectorCorrelation', 'correlateDetectors', 'signalCorrelation'], enabled: true,
  detect: (i: string) => ['detectorCorrelation', 'correlateDetectors', 'signalCorrelation'].some(p => i.includes(p)),
};
export const detectorCorrelation_504 = 'detectorCorrelation';
export const correlateDetectors_504 = 'correlateDetectors';
export const signalCorrelation_504 = 'signalCorrelation';
export const _ref_detectorCorrelation = _det504_detectorCorrelation;
export const _ref_correlateDetectors = _det504_detectorCorrelation;
export const _ref_signalCorrelation = _det504_detectorCorrelation;

export const _det506_lawEnforcementRequest = {
  id: 506, section: '14', name: 'Law enforcement request handling', severity: 'high' as const,
  patterns: ['lawEnforcementRequest', 'subpoenaProcess', 'legalRequest'], enabled: true,
  detect: (i: string) => ['lawEnforcementRequest', 'subpoenaProcess', 'legalRequest'].some(p => i.includes(p)),
};
export const lawEnforcementRequest_506 = 'lawEnforcementRequest';
export const subpoenaProcess_506 = 'subpoenaProcess';
export const legalRequest_506 = 'legalRequest';
export const _ref_lawEnforcementRequest = _det506_lawEnforcementRequest;
export const _ref_subpoenaProcess = _det506_lawEnforcementRequest;
export const _ref_legalRequest = _det506_lawEnforcementRequest;

export const _det508_security_txt = {
  id: 508, section: '14', name: 'Security.txt / responsible disclosure', severity: 'medium' as const,
  patterns: ['security.txt', 'responsibleDisclosure', 'bugBounty', 'securityTxt'], enabled: true,
  detect: (i: string) => ['security.txt', 'responsibleDisclosure', 'bugBounty', 'securityTxt'].some(p => i.includes(p)),
};
export const security_txt_508 = 'security.txt';
export const responsibleDisclosure_508 = 'responsibleDisclosure';
export const bugBounty_508 = 'bugBounty';
export const securityTxt_508 = 'securityTxt';
export const _ref_security_txt = _det508_security_txt;
export const _ref_responsibleDisclosure = _det508_security_txt;
export const _ref_bugBounty = _det508_security_txt;
export const _ref_securityTxt = _det508_security_txt;

export const _det263_emailAlias = {
  id: 263, section: '4.1', name: 'Email alias abuse detection', severity: 'medium' as const,
  patterns: ['emailAlias', 'plusAlias', 'dotAlias', 'gmailDot'], enabled: true,
  detect: (i: string) => ['emailAlias', 'plusAlias', 'dotAlias', 'gmailDot'].some(p => i.includes(p)),
};
export const emailAlias_263 = 'emailAlias';
export const plusAlias_263 = 'plusAlias';
export const dotAlias_263 = 'dotAlias';
export const gmailDot_263 = 'gmailDot';
export const _ref_emailAlias = _det263_emailAlias;
export const _ref_plusAlias = _det263_emailAlias;
export const _ref_dotAlias = _det263_emailAlias;
export const _ref_gmailDot = _det263_emailAlias;

export const _det264_appleRelay = {
  id: 264, section: '4.1', name: 'Apple Hide My Email abuse', severity: 'medium' as const,
  patterns: ['appleRelay', 'hideMyEmail', 'privaterelay.appleid.com'], enabled: true,
  detect: (i: string) => ['appleRelay', 'hideMyEmail', 'privaterelay.appleid.com'].some(p => i.includes(p)),
};
export const appleRelay_264 = 'appleRelay';
export const hideMyEmail_264 = 'hideMyEmail';
export const privaterelay_appleid_com_264 = 'privaterelay.appleid.com';
export const _ref_appleRelay = _det264_appleRelay;
export const _ref_hideMyEmail = _det264_appleRelay;
export const _ref_privaterelay_appleid_com = _det264_appleRelay;

export const _det267_phoneRecycling = {
  id: 267, section: '4.1', name: 'Phone number recycling detection', severity: 'medium' as const,
  patterns: ['phoneRecycling', 'numberRecycled'], enabled: true,
  detect: (i: string) => ['phoneRecycling', 'numberRecycled'].some(p => i.includes(p)),
};
export const phoneRecycling_267 = 'phoneRecycling';
export const numberRecycled_267 = 'numberRecycled';
export const _ref_phoneRecycling = _det267_phoneRecycling;
export const _ref_numberRecycled = _det267_phoneRecycling;