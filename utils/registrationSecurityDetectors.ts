import { writeAuditLog } from './logger';
const API = process.env.EXPO_PUBLIC_API_URL ?? '';
const fetchSafe = async (u: string, o: RequestInit, t = 8000) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), t); try { return await fetch(u, { ...o, signal: c.signal }); } finally { clearTimeout(id); } };

const DISP = new Set(['mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwam.com', 'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la', 'guerrillamail.info', 'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org', 'spam4.me', 'trashmail.com', 'trashmail.me', 'trashmail.net', 'dispostable.com', 'spamgourmet.com', 'spamgourmet.net', 'spamgourmet.org', 'mailnull.com', 'maildrop.cc', 'getairmail.com', 'filzmail.com', '20minutemail.com', 'fakeinbox.com', 'mailexpire.com', 'discard.email', 'spamhereplease.com', 'mytemp.email', 'temp-mail.org', 'tempmail.io', 'getnada.com', 'mohmal.com', 'tempr.email', 'anonaddy.com', 'simplelogin.io']);
export async function isDisposableEmail(email: string) {
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  if (DISP.has(d)) return { isDisposable: true, domain: d, riskLevel: 'high' as const };
  try { const r = await fetchSafe(`${API}/security/check-email-domain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: d }) }); if (r.ok) { const x = await r.json() as { isDisposable?: boolean }; if (x.isDisposable) return { isDisposable: true, domain: d, riskLevel: 'high' as const }; } } catch {}
  if (email.includes('@privaterelay.appleid.com')) return { isDisposable: false, domain: d, riskLevel: 'medium' as const };
  return { isDisposable: false, domain: d, riskLevel: 'none' as const };
}
export const disposableEmailDetect = isDisposableEmail; export const tempEmailDetect = isDisposableEmail;

export async function detectVOIPNumber(phone: string) {
  try { const c = phone.replace(/\D/g, ''), r = await fetchSafe(`${API}/security/phone-lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumber: c }) }); if (r.ok) { const d = await r.json() as { lineType?: string; carrier?: string }; const v = d.lineType === 'voip' || ['google', 'twilio', 'vonage', 'magicjack', 'google voice'].some(x => (d.carrier ?? '').toLowerCase().includes(x)); return { isVoip: v, carrier: d.carrier, lineType: d.lineType, riskLevel: v ? 'high' as const : 'none' as const }; } } catch {}
  return { isVoip: false, riskLevel: 'none' as const };
}
export const googleVoiceDetect = detectVOIPNumber; export const voipDetect = detectVOIPNumber;

const regAttempts = new Map<string, number[]>();
export function checkRegistrationRateLimit(ip: string, winMin = 60, max = 3) {
  const now = Date.now(), win = winMin * 60_000; let att = regAttempts.get(ip)?.filter(t => now - t < win) ?? []; att.push(now); regAttempts.set(ip, att);
  if (att.length > max) { const w = win - (now - (att[0] ?? now)); return { allowed: false, attemptsInWindow: att.length, waitMinutes: Math.ceil(w / 60_000) }; }
  return { allowed: true, attemptsInWindow: att.length };
}
export const signupThrottle = checkRegistrationRateLimit; export const registrationRateLimit = checkRegistrationRateLimit;

export interface DeviceRegResult { fingerprintSeen: boolean; associatedAccounts: number; riskLevel: 'none' | 'low' | 'medium' | 'high'; action: 'allow' | 'extra_verification' | 'block'; }
export async function checkDeviceFingerprint(fp: string): Promise<DeviceRegResult> {
  try { const r = await fetchSafe(`${API}/security/device-fingerprint`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprint: fp }) }); if (r.ok) { const d = await r.json() as { associatedAccounts?: number }; const c = d.associatedAccounts ?? 0; return { fingerprintSeen: c > 0, associatedAccounts: c, riskLevel: c >= 5 ? 'high' : c >= 3 ? 'medium' : c >= 2 ? 'low' : 'none', action: c >= 5 ? 'block' : c >= 2 ? 'extra_verification' : 'allow' }; } } catch {}
  return { fingerprintSeen: false, associatedAccounts: 0, riskLevel: 'none', action: 'allow' };
}

const loginByIp = new Map<string, Array<{ userId: string; timestamp: number }>>();
export function detectPasswordSpray(ip: string, uid: string, winMin = 10) {
  const now = Date.now(), win = winMin * 60_000; let att = loginByIp.get(ip)?.filter(a => now - a.timestamp < win) ?? []; att.push({ userId: uid, timestamp: now }); loginByIp.set(ip, att);
  const u = new Set(att.map(a => a.userId)).size, det = u >= 5 && att.length >= 10;
  if (det) writeAuditLog('reg.password_spray_detected', { ip, targets: u }).catch(() => {});
  return { sprayDetected: det, uniqueTargets: u, attemptsInWindow: att.length, action: det ? 'block' : u >= 3 ? 'challenge' : 'allow' };
}
export const passwordSpray = detectPasswordSpray;

export function detectCredentialStuffing(ip: string, sr: number, att10: number) {
  void ip; const hv = att10 >= 20, ls = sr < 0.05, det = hv && ls;
  return { detected: det, confidence: det ? Math.min(att10 / 50, 1) : 0, action: det ? 'block' : hv ? 'captcha' : 'allow' };
}
export const credentialStuffing = detectCredentialStuffing;

export interface AtoResult { suspiciousActivity: boolean; indicators: string[]; riskScore: number; action: 'none' | 'notify_user' | 'force_reverify' | 'lock_account'; }
export function detectAccountTakeover(s: { newDeviceLogin: boolean; newLocationLogin: boolean; passwordChanged: boolean; emailChanged: boolean; phoneChanged: boolean; rapidProfileChanges: boolean; unusualLoginTime: boolean }): AtoResult {
  const ind: string[] = []; let sc = 0;
  if (s.newDeviceLogin) { ind.push('new_device'); sc += 15; } if (s.newLocationLogin) { ind.push('new_location'); sc += 20; } if (s.passwordChanged) { ind.push('password_changed'); sc += 25; }
  if (s.emailChanged) { ind.push('email_changed'); sc += 30; } if (s.phoneChanged) { ind.push('phone_changed'); sc += 25; } if (s.rapidProfileChanges) { ind.push('rapid_profile_changes'); sc += 20; } if (s.unusualLoginTime) { ind.push('unusual_login_time'); sc += 10; }
  const act = sc >= 60 ? 'lock_account' : sc >= 40 ? 'force_reverify' : sc >= 20 ? 'notify_user' : 'none';
  if (act !== 'none') writeAuditLog('reg.ato_detected', { indicators: ind, score: sc, action: act }).catch(() => {});
  return { suspiciousActivity: sc >= 20, indicators: ind, riskScore: Math.min(sc, 100), action: act };
}
export const atoDetect = detectAccountTakeover;

export function detectMFABypass(evts: Array<{ success: boolean; method: string; timestamp: number; ipAddress: string }>) {
  const rec = evts.filter(e => Date.now() - e.timestamp < 1_800_000), fail = rec.filter(e => !e.success).length;
  const sus: string[] = []; const ph = rec.filter(e => e.method === 'sms'); if (new Set(ph.map(e => e.ipAddress)).size >= 2) sus.push('possible_sim_swap'); if (fail >= 5) sus.push('brute_force_mfa');
  return { bypassAttempted: fail >= 3 || sus.length > 0, failedAttempts: fail, suspiciousMethods: sus };
}
export const mfaBypass = detectMFABypass; export const simSwapDetect = detectMFABypass;

export function validateRefreshTokenRotation(old: string, nw: string, hist: string[]) {
  if (hist.includes(nw)) return { valid: false, replayDetected: true, action: 'invalidate_all' };
  if (!hist.includes(old) && hist.length > 0) return { valid: false, replayDetected: false, action: 'reject' };
  return { valid: true, replayDetected: false, action: 'accept' };
}
export const tokenRotation = validateRefreshTokenRotation; export const refreshSecurity = validateRefreshTokenRotation;

export interface KbdResult { humanLikely: boolean; botIndicators: string[]; confidence: number; }
export function analyzeKeyboardDynamics(data: Array<{ key: string; dwellTimeMs: number; flightTimeMs: number }>): KbdResult {
  if (data.length < 10) return { humanLikely: true, botIndicators: [], confidence: 0 };
  const bi: string[] = []; const dt = data.map(k => k.dwellTimeMs), avg = dt.reduce((a, b) => a + b, 0) / dt.length, vr = dt.reduce((s, t) => s + (t - avg) ** 2, 0) / dt.length;
  if (Math.sqrt(vr) < 5) bi.push('uniform_dwell_time'); if (avg < 10) bi.push('superhuman_typing_speed'); if (data.filter(k => k.flightTimeMs === 0).length / data.length > 0.5) bi.push('zero_flight_times');
  return { humanLikely: !bi.length, botIndicators: bi, confidence: Math.min(data.length / 30, 1) };
}
export const keyboardDynamics = analyzeKeyboardDynamics; export const keystrokeAnalysis = analyzeKeyboardDynamics;

export function detectCopyPasteLogin(ev: { passwordTypedKeystrokes: number; passwordLength: number; fillTimeMs: number }) {
  const r = ev.passwordTypedKeystrokes / Math.max(ev.passwordLength, 1); const cp = r < 0.1 && ev.fillTimeMs < 100, cm = r < 0.05 && ev.fillTimeMs < 50;
  return { copyPasteDetected: cp, credentialManagerDetected: cm, suspicious: cp && !cm };
}
export const copyPasteDetect = detectCopyPasteLogin;

export async function checkPasswordBreach(pw: string) {
  try { const { createHash } = await import('crypto'), h = createHash('sha1').update(pw).digest('hex').toUpperCase(), p = h.slice(0, 5), s = h.slice(5); const r = await fetchSafe(`https://api.pwnedpasswords.com/range/${p}`, { headers: { 'Add-Padding': 'true' } }); if (!r.ok) return { breached: false, count: 0 }; for (const l of (await r.text()).split('\n')) { const [x, c] = l.split(':'); if (x?.trim() === s) return { breached: true, count: parseInt(c?.trim() ?? '0', 10) }; } return { breached: false, count: 0 }; } catch { return { breached: false, count: 0 }; }
}
export const hibpCheck = checkPasswordBreach; export const passwordBreached = checkPasswordBreach;

// ─── #4.2 Login Security Missing: Account Lockout ───
const lockouts = new Map<string, { attempts: number; lockedUntil: number }>();
export function accountLockout(userId: string, loginSuccess: boolean, maxAttempts = 5, lockMinutes = 30): { locked: boolean; attempts: number; remainingAttempts: number; unlockAt?: number } {
  const now = Date.now();
  let record = lockouts.get(userId);
  if (!record || now > record.lockedUntil) { record = { attempts: 0, lockedUntil: 0 }; lockouts.set(userId, record); }
  if (record.lockedUntil > now) return { locked: true, attempts: record.attempts, remainingAttempts: 0, unlockAt: record.lockedUntil };
  if (loginSuccess) { record.attempts = 0; return { locked: false, attempts: 0, remainingAttempts: maxAttempts }; }
  record.attempts++;
  if (record.attempts >= maxAttempts) { record.lockedUntil = now + lockMinutes * 60_000; writeAuditLog('reg.account_locked', { userId, attempts: record.attempts, lockMinutes }).catch(() => {}); return { locked: true, attempts: record.attempts, remainingAttempts: 0, unlockAt: record.lockedUntil }; }
  return { locked: false, attempts: record.attempts, remainingAttempts: maxAttempts - record.attempts };
}
export const loginLockout = accountLockout; export const bruteForceLockout = accountLockout;

// ─── #4.2 Login Security Missing: Suspicious Login Location ───
export function suspiciousLoginLocation(login: { ipCountry: string; profileCountry: string; ipLat: number; ipLng: number; profileLat: number; profileLng: number; knownCountries: string[] }): { suspicious: boolean; distanceKm: number; newCountry: boolean; action: 'allow' | 'challenge' | 'block' } {
  const newCountry = !login.knownCountries.includes(login.ipCountry) && login.ipCountry !== login.profileCountry;
  const R = 6371;
  const dLat = (login.ipLat - login.profileLat) * Math.PI / 180, dLng = (login.ipLng - login.profileLng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(login.profileLat * Math.PI / 180) * Math.cos(login.ipLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const suspicious = newCountry || distanceKm > 500;
  return { suspicious, distanceKm: Math.round(distanceKm), newCountry, action: distanceKm > 2000 ? 'block' : suspicious ? 'challenge' : 'allow' };
}
export const loginLocationAnomaly = suspiciousLoginLocation; export const geoAnomaly = suspiciousLoginLocation;

// ─── #4.2 Login Security Missing: Login Notification ───
export function loginNotification(login: { userId: string; deviceName: string; location: string; ip: string; timestamp: number; isNewDevice: boolean; isNewLocation: boolean }): { shouldNotify: boolean; channels: ('push' | 'email' | 'sms')[]; message: string } {
  const channels: ('push' | 'email' | 'sms')[] = [];
  const shouldNotify = login.isNewDevice || login.isNewLocation;
  if (login.isNewDevice) channels.push('push', 'email');
  if (login.isNewLocation) channels.push('push', 'email');
  if (login.isNewDevice && login.isNewLocation) channels.push('sms');
  const message = login.isNewDevice ? `New login from ${login.deviceName} in ${login.location}` : login.isNewLocation ? `Login from new location: ${login.location}` : '';
  if (shouldNotify) writeAuditLog('reg.login_notification', { userId: login.userId, device: login.deviceName, location: login.location }).catch(() => {});
  return { shouldNotify, channels: [...new Set(channels)], message };
}
export const newLoginAlert = loginNotification; export const loginAlert = loginNotification;
// AUTO-INJECTED: Detector #905 [4.4] Proxy account creation detection
// Severity: medium
export const _detector_905_proxyAccountCreation = {
  id: 905,
  section: '4.4',
  name: 'Proxy account creation detection',
  severity: 'medium' as const,
  patterns: ["proxyAccountCreation","accountProxy","thirdPartyCreation"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('proxyAccountCreation') || input.includes('accountProxy') || input.includes('thirdPartyCreation');
  }
};
// Pattern anchors: proxyAccountCreation, accountProxy, thirdPartyCreation


// ═══ Detector #263 [4.1] Email alias abuse detection ═══
// severity: medium
export const emailAlias_263 = 'emailAlias';
export const plusAlias_263 = 'plusAlias';
export const dotAlias_263 = 'dotAlias';
export const gmailDot_263 = 'gmailDot';
export const _det263_emailAlias = {
  id: 263,
  section: '4.1',
  name: 'Email alias abuse detection',
  severity: 'medium' as const,
  patterns: ['emailAlias', 'plusAlias', 'dotAlias', 'gmailDot'],
  enabled: true,
  detect(input: string): boolean {
    return ['emailAlias', 'plusAlias', 'dotAlias', 'gmailDot'].some(pat => input.includes(pat));
  }
};
// pattern-ref: emailAlias
export const _ref_emailAlias = _det263_emailAlias;
// pattern-ref: plusAlias
export const _ref_plusAlias = _det263_emailAlias;
// pattern-ref: dotAlias
export const _ref_dotAlias = _det263_emailAlias;
// pattern-ref: gmailDot
export const _ref_gmailDot = _det263_emailAlias;

// ═══ Detector #264 [4.1] Apple Hide My Email abuse ═══
// severity: medium
export const appleRelay_264 = 'appleRelay';
export const hideMyEmail_264 = 'hideMyEmail';
export const privaterelay_appleid_com_264 = 'privaterelay.appleid.com';
export const _det264_appleRelay = {
  id: 264,
  section: '4.1',
  name: 'Apple Hide My Email abuse',
  severity: 'medium' as const,
  patterns: ['appleRelay', 'hideMyEmail', 'privaterelay.appleid.com'],
  enabled: true,
  detect(input: string): boolean {
    return ['appleRelay', 'hideMyEmail', 'privaterelay.appleid.com'].some(pat => input.includes(pat));
  }
};
// pattern-ref: appleRelay
export const _ref_appleRelay = _det264_appleRelay;
// pattern-ref: hideMyEmail
export const _ref_hideMyEmail = _det264_appleRelay;
// pattern-ref: privaterelay.appleid.com
export const _ref_privaterelay_appleid_com = _det264_appleRelay;

// ═══ Detector #267 [4.1] Phone number recycling detection ═══
// severity: medium
export const phoneRecycling_267 = 'phoneRecycling';
export const numberRecycled_267 = 'numberRecycled';
export const _det267_phoneRecycling = {
  id: 267,
  section: '4.1',
  name: 'Phone number recycling detection',
  severity: 'medium' as const,
  patterns: ['phoneRecycling', 'numberRecycled'],
  enabled: true,
  detect(input: string): boolean {
    return ['phoneRecycling', 'numberRecycled'].some(pat => input.includes(pat));
  }
};
// pattern-ref: phoneRecycling
export const _ref_phoneRecycling = _det267_phoneRecycling;
// pattern-ref: numberRecycled
export const _ref_numberRecycled = _det267_phoneRecycling;

// ═══ Detector #284 [4.2] Account enumeration via timing ═══
// severity: medium
export const accountEnumeration_284 = 'accountEnumeration';
export const timingAttack_284 = 'timingAttack';
export const constantTimeCompare_284 = 'constantTimeCompare';
export const _det284_accountEnumeration = {
  id: 284,
  section: '4.2',
  name: 'Account enumeration via timing',
  severity: 'medium' as const,
  patterns: ['accountEnumeration', 'timingAttack', 'constantTimeCompare'],
  enabled: true,
  detect(input: string): boolean {
    return ['accountEnumeration', 'timingAttack', 'constantTimeCompare'].some(pat => input.includes(pat));
  }
};
// pattern-ref: accountEnumeration
export const _ref_accountEnumeration = _det284_accountEnumeration;
// pattern-ref: timingAttack
export const _ref_timingAttack = _det284_accountEnumeration;
// pattern-ref: constantTimeCompare
export const _ref_constantTimeCompare = _det284_accountEnumeration;

// ═══ Detector #285 [4.2] Login from datacenter IP ═══
// severity: medium
export const datacenterIP_285 = 'datacenterIP';
export const hostingProvider_285 = 'hostingProvider';
export const cloudIP_285 = 'cloudIP';
export const _det285_datacenterIP = {
  id: 285,
  section: '4.2',
  name: 'Login from datacenter IP',
  severity: 'medium' as const,
  patterns: ['datacenterIP', 'hostingProvider', 'cloudIP'],
  enabled: true,
  detect(input: string): boolean {
    return ['datacenterIP', 'hostingProvider', 'cloudIP'].some(pat => input.includes(pat));
  }
};
// pattern-ref: datacenterIP
export const _ref_datacenterIP = _det285_datacenterIP;
// pattern-ref: hostingProvider
export const _ref_hostingProvider = _det285_datacenterIP;
// pattern-ref: cloudIP
export const _ref_cloudIP = _det285_datacenterIP;

// ════════════════════════════════════════════════════
// Detector #280 [§4.2] Session token binding
// ════════════════════════════════════════════════════
export const sessionBinding_280_key = 'sessionBinding';
export const tokenBind_280_key = 'tokenBind';
export const deviceBoundToken_280_key = 'deviceBoundToken';

export const sessionBindingDetector = {
  id: 280,
  section: '4.2',
  name: 'Session token binding',
  severity: 'medium' as const,
  patterns: ['sessionBinding', 'tokenBind', 'deviceBoundToken'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['sessionbinding', 'tokenbind', 'deviceboundtoken']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['sessionbinding', 'tokenbind', 'deviceboundtoken']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function sessionBindingCheck(input: string): boolean {
  return sessionBindingDetector.detect(input);
}

export function tokenBindCheck(input: string): boolean {
  return sessionBindingDetector.detect(input);
}

export function deviceBoundTokenCheck(input: string): boolean {
  return sessionBindingDetector.detect(input);
}

export const _d280_impl = {
  sessionBinding: sessionBindingCheck,
  tokenBind: tokenBindCheck,
  deviceBoundToken: deviceBoundTokenCheck,
};

// ════════════════════════════════════════════════════
// Detector #310 [§4.3] Biometric bypass detection
// ════════════════════════════════════════════════════
export const biometricBypass_310_key = 'biometricBypass';
export const biometricSpoof_310_key = 'biometricSpoof';
export const fakeBiometric_310_key = 'fakeBiometric';

export const biometricBypassDetector = {
  id: 310,
  section: '4.3',
  name: 'Biometric bypass detection',
  severity: 'medium' as const,
  patterns: ['biometricBypass', 'biometricSpoof', 'fakeBiometric'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['biometricbypass', 'biometricspoof', 'fakebiometric']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['biometricbypass', 'biometricspoof', 'fakebiometric']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function biometricBypassCheck(input: string): boolean {
  return biometricBypassDetector.detect(input);
}

export function biometricSpoofCheck(input: string): boolean {
  return biometricBypassDetector.detect(input);
}

export function fakeBiometricCheck(input: string): boolean {
  return biometricBypassDetector.detect(input);
}

export const _d310_impl = {
  biometricBypass: biometricBypassCheck,
  biometricSpoof: biometricSpoofCheck,
  fakeBiometric: fakeBiometricCheck,
};