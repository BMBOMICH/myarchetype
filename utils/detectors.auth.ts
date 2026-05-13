/**
 * Authentication security detectors.
 * Covers: Passkeys, WebAuthn, OAuth token theft,
 * replay attacks, race conditions, TOCTOU, IDOR, and API key enumeration.
 */

// ── Passkey / WebAuthn ────────────────────────────────────────────────────────

export interface PasskeyResult {
  supported: boolean;
  registered: boolean;
  credentialId: string | null;
  attestationType: string;
  created: number | null;
}

export async function passkeySupport(): Promise<{
  available: boolean;
  platformSupported: boolean;
}> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return { available: false, platformSupported: false };
  }

  const av =
    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(
      () => false
    );

  return { available: av, platformSupported: av };
}

export async function webauthnRegister(
  userId: string
): Promise<PasskeyResult> {
  const sup = await passkeySupport();

  if (!sup.available) {
    return {
      supported: false,
      registered: false,
      credentialId: null,
      attestationType: 'none',
      created: null,
    };
  }

  try {
    const chal = new Uint8Array(32);
    crypto.getRandomValues(chal);

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: chal,
        rp: { name: 'MyArchetype', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(userId),
          name: userId,
          displayName: userId,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        attestation: 'none',
      },
    });

    if (!cred) {
      return {
        supported: true,
        registered: false,
        credentialId: null,
        attestationType: 'none',
        created: null,
      };
    }

    return {
      supported: true,
      registered: true,
      credentialId: btoa(
        String.fromCharCode(...new Uint8Array(cred.rawId))
      ),
      attestationType: 'none',
      created: Date.now(),
    };
  } catch {
    return {
      supported: true,
      registered: false,
      credentialId: null,
      attestationType: 'none',
      created: null,
    };
  }
}

export const fido2 = webauthnRegister;
export const publicKeyCredential = passkeySupport;

// ── OAuth Token Theft ─────────────────────────────────────────────────────────

export interface OAuthTheftResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  action: 'monitor' | 'revoke' | 'block';
}

export function oauthTokenTheft(s: {
  tokenUsedFromNewDevice: boolean;
  tokenUsedFromNewIp: boolean;
  tokenUsedFromNewLocation: boolean;
  tokenAgeMinutes: number;
  concurrentSessions: number;
  previousTokenRevoked: boolean;
  usagePatternAnomaly: boolean;
}): OAuthTheftResult {
  const ind: string[] = [];
  let c = 0;

  if (s.tokenUsedFromNewDevice && s.tokenUsedFromNewIp) {
    ind.push('new_device_ip');
    c += 0.3;
  }
  if (s.tokenUsedFromNewLocation && s.tokenAgeMinutes > 60) {
    ind.push('new_location_old_token');
    c += 0.3;
  }
  if (s.concurrentSessions >= 3) {
    ind.push('concurrent_sessions');
    c += 0.3;
  }
  if (s.previousTokenRevoked && s.tokenUsedFromNewDevice) {
    ind.push('revoked_then_new_device');
    c += 0.4;
  }
  if (s.usagePatternAnomaly) {
    ind.push('pattern_anomaly');
    c += 0.2;
  }

  c = Math.min(1, c);

  return {
    detected: c >= 0.4,
    confidence: c,
    indicators: ind,
    action: c >= 0.7 ? 'block' : c >= 0.4 ? 'revoke' : 'monitor',
  };
}

export const tokenTheft = oauthTokenTheft;
export const suspiciousTokenUse = oauthTokenTheft;

// ── Replay Attack ─────────────────────────────────────────────────────────────

export interface ReplayAttackResult {
  detected: boolean;
  reason: string;
  action: 'allow' | 'reject';
}

const nonceCache = new Map<string, number>();
const NONCE_TTL = 300_000;

export function replayAttackDetect(
  nonce: string,
  timestamp: number
): ReplayAttackResult {
  const now = Date.now();

  if (Math.abs(now - timestamp) > NONCE_TTL) {
    return { detected: true, reason: 'expired_timestamp', action: 'reject' };
  }

  if (nonceCache.get(nonce) !== undefined) {
    return { detected: true, reason: 'duplicate_nonce', action: 'reject' };
  }

  nonceCache.set(nonce, now);
  for (const [k, v] of nonceCache) {
    if (now - v > NONCE_TTL) nonceCache.delete(k);
  }

  return { detected: false, reason: '', action: 'allow' };
}

export const nonceCheck = replayAttackDetect;
export const requestNonce = replayAttackDetect;

// ── API Replay Attack ─────────────────────────────────────────────────────────

export interface ReplayAttackDetectResult {
  detected: boolean;
  nonce: string;
  timestamp: number;
  reason: string;
  action: 'allow' | 'reject';
}

const apiNonces = new Map<string, number>();
const API_NONCE_TTL = 60_000;

export function replayAttackDetectApi(
  nonce: string,
  timestamp: number
): ReplayAttackDetectResult {
  const now = Date.now();

  if (Math.abs(now - timestamp) > API_NONCE_TTL) {
    return {
      detected: true,
      nonce,
      timestamp,
      reason: 'expired',
      action: 'reject',
    };
  }

  if (apiNonces.has(nonce)) {
    return {
      detected: true,
      nonce,
      timestamp,
      reason: 'replay',
      action: 'reject',
    };
  }

  apiNonces.set(nonce, now);
  for (const [k, v] of apiNonces) {
    if (now - v > API_NONCE_TTL) apiNonces.delete(k);
  }

  return { detected: false, nonce, timestamp, reason: '', action: 'allow' };
}

export const nonceValidation = replayAttackDetectApi;
export const requestNonceCheck = replayAttackDetectApi;

// ── Race Condition Guard ──────────────────────────────────────────────────────

export interface RaceConditionResult {
  protected: boolean;
  lockAcquired: boolean;
  lockKey: string;
  timeoutMs: number;
  action: 'proceed' | 'retry' | 'reject';
}

const locks = new Map<string, { holder: string; expires: number }>();

export function raceConditionGuard(
  key: string,
  holder: string,
  timeoutMs = 5000
): RaceConditionResult {
  const now = Date.now();
  const ex = locks.get(key);

  if (ex && ex.expires > now && ex.holder !== holder) {
    return {
      protected: true,
      lockAcquired: false,
      lockKey: key,
      timeoutMs,
      action: 'retry',
    };
  }

  locks.set(key, { holder, expires: now + timeoutMs });
  for (const [k2, v] of locks) {
    if (v.expires <= now) locks.delete(k2);
  }

  return {
    protected: true,
    lockAcquired: true,
    lockKey: key,
    timeoutMs,
    action: 'proceed',
  };
}

export function releaseLock(key: string, holder: string): void {
  const l = locks.get(key);
  if (l && l.holder === holder) locks.delete(key);
}

export const atomicOperation = raceConditionGuard;
export const lockMechanism = raceConditionGuard;

// ── TOCTOU Guard ──────────────────────────────────────────────────────────────

export interface ToctouResult {
  safe: boolean;
  checkResult: boolean;
  actionResult: boolean;
  consistency: boolean;
  recommendation: string;
}

export async function toctouGuard<T>(
  checkFn: () => Promise<boolean>,
  actionFn: () => Promise<T>,
  lockKey: string
): Promise<{ result: ToctouResult; data: T | null }> {
  const lk = raceConditionGuard(lockKey, `toctou_${Date.now()}`, 10000);

  if (!lk.lockAcquired) {
    return {
      result: {
        safe: false,
        checkResult: false,
        actionResult: false,
        consistency: false,
        recommendation: 'Resource locked, retry later.',
      },
      data: null,
    };
  }

  try {
    const chk = await checkFn();

    if (!chk) {
      return {
        result: {
          safe: true,
          checkResult: false,
          actionResult: false,
          consistency: true,
          recommendation: 'Check failed, action not executed.',
        },
        data: null,
      };
    }

    const data = await actionFn();

    return {
      result: {
        safe: true,
        checkResult: true,
        actionResult: true,
        consistency: true,
        recommendation: 'Action completed atomically.',
      },
      data,
    };
  } finally {
    releaseLock(lockKey, `toctou_${Date.now()}`);
  }
}

export const timeOfCheck = toctouGuard;
export const checkThenAct = toctouGuard;

// ── IDOR Audit ────────────────────────────────────────────────────────────────

export interface IdorAuditResult {
  vulnerable: boolean;
  endpoints: string[];
  exposedFields: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
}

export function idorAudit(
  endpoints: Array<{
    path: string;
    requiresAuth: boolean;
    returnsPrivateFields: string[];
    allowsOtherUserId: boolean;
  }>
): IdorAuditResult {
  const vuln = endpoints.filter(
    e =>
      !e.requiresAuth ||
      (e.allowsOtherUserId && e.returnsPrivateFields.length > 0)
  );

  const fields = new Set<string>();
  for (const e of vuln) {
    for (const f of e.returnsPrivateFields) fields.add(f);
  }

  const sv = vuln.some(
    e =>
      e.returnsPrivateFields.includes('email') ||
      e.returnsPrivateFields.includes('phone')
  )
    ? 'critical'
    : vuln.length > 0
    ? 'high'
    : 'none';

  return {
    vulnerable: vuln.length > 0,
    endpoints: vuln.map(e => e.path),
    exposedFields: [...fields],
    severity: sv,
    recommendation: vuln.length
      ? `Add authorization checks to: ${vuln
          .map(e => e.path)
          .join(', ')}. Remove private fields from responses.`
      : 'No IDOR vulnerabilities detected.',
  };
}

export const profileDataExposure = idorAudit;
export const unauthorizedProfileAccess = idorAudit;

// ── API Key Enumeration ───────────────────────────────────────────────────────

export interface KeyEnumerationResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  action: 'allow' | 'rate_limit' | 'block';
}

const keyAttempts = new Map<
  string,
  { count: number; firstSeen: number; lastSeen: number }
>();

export function apiKeyEnumeration(s: {
  ip: string;
  apiKeyAttempts: number;
  uniqueKeysTried: number;
  invalidKeyCount: number;
  timeWindowMinutes: number;
  hasValidKey: boolean;
}): KeyEnumerationResult {
  const k = s.ip;
  const now = Date.now();
  const ex = keyAttempts.get(k);

  if (ex) {
    ex.count += s.invalidKeyCount;
    ex.lastSeen = now;
  } else {
    keyAttempts.set(k, {
      count: s.invalidKeyCount,
      firstSeen: now,
      lastSeen: now,
    });
  }

  for (const [k2, v] of keyAttempts) {
    if (now - v.lastSeen > 3_600_000) keyAttempts.delete(k2);
  }

  const cur = keyAttempts.get(k)!;
  const ind: string[] = [];
  let c = 0;

  if (cur.count >= 10) { ind.push('many_invalid_keys'); c += 0.5; }
  if (s.uniqueKeysTried >= 5) { ind.push('unique_key_variety'); c += 0.4; }
  if (s.timeWindowMinutes < 5 && s.invalidKeyCount >= 3) {
    ind.push('rapid_attempts');
    c += 0.3;
  }
  if (!s.hasValidKey) { ind.push('no_valid_key'); c += 0.2; }

  c = Math.min(1, c);

  return {
    detected: c >= 0.4,
    confidence: c,
    indicators: ind,
    action: c >= 0.7 ? 'block' : c >= 0.4 ? 'rate_limit' : 'allow',
  };
}

export const apiKeyBruteForce = apiKeyEnumeration;
export const keyEnumeration = apiKeyEnumeration;

// ── Credential Handoff ────────────────────────────────────────────────────────

export interface CredentialHandoffResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  action: 'monitor' | 'restrict' | 'suspend';
}

export function credentialHandoff(s: {
  deviceChanged: boolean;
  locationChanged: boolean;
  behaviorShift: boolean;
  typingPatternChanged: boolean;
  photoUploadStyleChanged: boolean;
  loginTimePatternChanged: boolean;
  messageStyleSimilarityToPreviousOwner: number;
}): CredentialHandoffResult {
  const ind: string[] = [];
  let c = 0;

  if (s.deviceChanged) { ind.push('device_change'); c += 0.2; }
  if (s.locationChanged) { ind.push('location_change'); c += 0.1; }
  if (s.behaviorShift) { ind.push('behavior_shift'); c += 0.3; }
  if (s.typingPatternChanged) { ind.push('typing_change'); c += 0.2; }
  if (s.photoUploadStyleChanged) { ind.push('photo_style_change'); c += 0.15; }
  if (s.loginTimePatternChanged) { ind.push('login_time_change'); c += 0.1; }
  if (s.messageStyleSimilarityToPreviousOwner < 0.3) {
    ind.push('style_mismatch');
    c += 0.2;
  }

  c = Math.min(1, c);

  return {
    detected: c >= 0.5,
    confidence: c,
    indicators: ind,
    action: c >= 0.7 ? 'suspend' : c >= 0.5 ? 'restrict' : 'monitor',
  };
}

export const accountHandover = credentialHandoff;
export const credentialHandoffDetect = credentialHandoff;

// ── DNS Rebinding Prevention ──────────────────────────────────────────────────

export interface DnsRebindingResult {
  safe: boolean;
  hostHeader: string;
  allowedHosts: string[];
  action: 'allow' | 'block';
}

const ALLOWED_HOSTS = [
  'myarchetype.app',
  'api.myarchetype.app',
  'cdn.myarchetype.app',
  'localhost',
];

export function dnsRebindingPrevention(
  hostHeader: string,
  extraHosts: string[] = []
): DnsRebindingResult {
  const all = [...ALLOWED_HOSTS, ...extraHosts];
  const safe = all.some(
    h => hostHeader === h || hostHeader === `www.${h}`
  );

  return {
    safe,
    hostHeader,
    allowedHosts: all,
    action: safe ? 'allow' : 'block',
  };
}

export const hostHeaderValidation = dnsRebindingPrevention;

// ── Unauthenticated Endpoint Scan ─────────────────────────────────────────────

export interface UnauthEndpointResult {
  found: boolean;
  endpoints: Array<{ path: string; method: string; returnsData: boolean }>;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
}

export function unauthenticatedEndpointScan(
  routes: Array<{
    path: string;
    method: string;
    requiresAuth: boolean;
    returnsUserData: boolean;
  }>
): UnauthEndpointResult {
  const found = routes.filter(r => !r.requiresAuth && r.returnsUserData);

  const sv =
    found.length >= 5
      ? 'critical'
      : found.length >= 2
      ? 'high'
      : found.length >= 1
      ? 'medium'
      : 'none';

  return {
    found: found.length > 0,
    endpoints: found.map(f => ({
      path: f.path,
      method: f.method,
      returnsData: f.returnsUserData,
    })),
    severity: sv,
    recommendation: found.length
      ? `Add authentication to: ${found
          .map(f => `${f.method} ${f.path}`)
          .join(', ')}.`
      : 'All endpoints require authentication.',
  };
}

export const publicEndpointAudit = unauthenticatedEndpointScan;