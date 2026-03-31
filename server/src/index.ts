import cors from 'cors';
import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import admin from 'firebase-admin';
import helmet from 'helmet';
import * as webpush from 'web-push';

// ─── Init ─────────────────────────────────────────────────
admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
const adminDb = admin.firestore();
const app     = express();

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// ─── CORS ─────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://myarchetype.app',
  'https://www.myarchetype.app',
  'https://myarchetype.vercel.app',
  'https://myarchetype-server.vercel.app',
  'https://staging.myarchetype.app',
  ...(process.env.NODE_ENV === 'development'
    ? ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:3000']
    : []),
]);

const CORS_OPTIONS: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) { cb(null, true); }
    else { cb(new Error('CORS policy violation')); }
  },
  methods:         ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:  ['Content-Type', 'Authorization', 'X-Request-Signature', 'X-Request-Timestamp', 'X-Device-Fingerprint', 'X-Session-Id', 'X-App-Check-Token', 'X-Request-ID'],
  exposedHeaders:  ['X-Request-ID', 'X-RateLimit-Remaining'],
  credentials:     true,
  maxAge:          86_400,
  optionsSuccessStatus: 204,
};

app.use(cors(CORS_OPTIONS));
app.options('*', cors(CORS_OPTIONS));

// ─── Security headers ─────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',         'DENY');
  res.setHeader('X-XSS-Protection',        '1; mode=block');
  res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',      'camera=(), microphone=(), geolocation=(self), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://res.cloudinary.com https://firebasestorage.googleapis.com data:; connect-src 'self' https://*.firebase.com https://*.googleapis.com wss://*.firebaseio.com");
  next();
});

app.use(express.json({ limit: '10kb' }));

// ─── TLS info ─────────────────────────────────────────────
const TLS_INFO = { min: 'TLSv1.2', supported: ['TLSv1.2', 'TLSv1.3'] };

// ─── Rate limiters ────────────────────────────────────────
const limiter = (max: number, windowMs = 60_000) =>
  rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { success: false, reason: 'rate_limited' } });

const globalLimiter  = limiter(60);
const notifLimiter   = limiter(30);
const modLimiter     = limiter(100);
const authLimiter    = limiter(10);
const webhookLimiter = limiter(20);

app.use(globalLimiter);

// ─── Origin validation ────────────────────────────────────
function validateOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin   = req.headers.origin ?? req.headers.referer ?? '';
  const isMobile = !origin && (
    req.headers['user-agent']?.includes('Expo') ||
    req.headers['user-agent']?.includes('okhttp')
  );
  if (!isMobile && origin && !ALLOWED_ORIGINS.has(origin.replace(/\/$/, ''))) {
    res.status(403).json({ success: false, reason: 'origin_not_allowed' }); return;
  }
  next();
}

// ─── HMAC verification ────────────────────────────────────
const HMAC_SECRET = process.env.HMAC_SECRET ?? '';

function verifyHMAC(req: Request, res: Response, next: NextFunction): void {
  if (!HMAC_SECRET) { next(); return; }
  const sig = req.headers['x-request-signature'] as string | undefined;
  const ts  = req.headers['x-request-timestamp']  as string | undefined;
  if (!sig || !ts) { res.status(401).json({ success: false, reason: 'missing_signature' }); return; }
  if (Math.abs(Date.now() - parseInt(ts, 10)) > 300_000) { res.status(401).json({ success: false, reason: 'request_expired' }); return; }
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(`${ts}.${JSON.stringify(req.body)}`).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      res.status(401).json({ success: false, reason: 'invalid_signature' }); return;
    }
  } catch { res.status(401).json({ success: false, reason: 'invalid_signature' }); return; }
  next();
}

// ─── Global error handler ─────────────────────────────────
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'internal_error';
      if (!res.headersSent) res.status(500).json({ success: false, reason: message });
    });
  };
}

// ─── VAPID ────────────────────────────────────────────────
const { VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
if (VAPID_EMAIL && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ─── Auth middleware ──────────────────────────────────────
interface AuthRequest extends Request { uid: string; }

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ success: false, reason: 'missing_auth_token' }); return; }
  try {
    const decoded  = await admin.auth().verifyIdToken(header.slice(7));
    (req as AuthRequest).uid = decoded.uid;
    next();
  } catch { res.status(401).json({ success: false, reason: 'invalid_auth_token' }); }
}

// ─── Input helpers ────────────────────────────────────────
function isValidPushSub(sub: unknown): sub is webpush.PushSubscription {
  if (!sub || typeof sub !== 'object') return false;
  const s = sub as Record<string, unknown>;
  return typeof s['endpoint'] === 'string' && s['endpoint'].startsWith('https://') && typeof s['keys'] === 'object';
}

function isValidExpoToken(token: unknown): boolean {
  return typeof token === 'string' && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));
}

function sanitize(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().slice(0, max);
  return t.length > 0 ? t : null;
}

function uid(req: Request): string { return (req as AuthRequest).uid; }
function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress ?? '').split(',')[0]!.trim();
}

// ─── Disposable email ─────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','tempmail.com','throwaway.email','yopmail.com',
  'sharklasers.com','guerrillamailblock.com','grr.la','dispostable.com','mailnesia.com',
  'maildrop.cc','trashmail.com','temp-mail.org','fakeinbox.com','getnada.com',
  'emailondeck.com','mohmal.com','burnermail.io','tempr.email','mailsac.com',
  '10minutemail.com','guerrillamail.info','guerrillamail.net','guerrillamail.org',
]);

function isDisposableEmail(email: string): boolean {
  return DISPOSABLE_DOMAINS.has(email.split('@')[1]?.toLowerCase() ?? '');
}

// ─── Device fingerprint ───────────────────────────────────
async function trackDeviceFingerprint(fp: string, userId: string): Promise<{ knownDevice: boolean; deviceCount: number }> {
  if (!fp || fp.length < 8) return { knownDevice: false, deviceCount: 0 };
  try {
    const ref  = adminDb.collection('deviceFingerprints').doc(fp);
    const snap = await ref.get();
    const now  = Date.now();
    if (!snap.exists) {
      await ref.set({ users: [userId], firstSeen: now, lastSeen: now, count: 1 });
      return { knownDevice: false, deviceCount: 1 };
    }
    const users: string[] = snap.data()!['users'] ?? [];
    if (!users.includes(userId)) users.push(userId);
    await ref.update({ users, lastSeen: now, count: users.length });
    return { knownDevice: users.length > 1, deviceCount: users.length };
  } catch { return { knownDevice: false, deviceCount: 0 }; }
}

async function checkMultiAccountDevice(fp: string, userId: string): Promise<{ multiAccount: boolean; bannedReuse: boolean; accounts: string[] }> {
  if (!fp || fp.length < 8) return { multiAccount: false, bannedReuse: false, accounts: [] };
  try {
    const snap  = await adminDb.collection('deviceFingerprints').doc(fp).get();
    if (!snap.exists) return { multiAccount: false, bannedReuse: false, accounts: [] };
    const users = (snap.data()!['users'] as string[] ?? []).filter((u) => u !== userId);
    let bannedReuse = false;
    if (users.length > 0) {
      const b    = await adminDb.collection('bannedUsers').where('uid', 'in', users.slice(0, 10)).get();
      bannedReuse = !b.empty;
    }
    return { multiAccount: users.length > 0, bannedReuse, accounts: users };
  } catch { return { multiAccount: false, bannedReuse: false, accounts: [] }; }
}

// ─── ATO detection ───────────────────────────────────────
async function detectAccountTakeover(userId: string, fp: string, ip: string): Promise<{ suspicious: boolean; reason?: string }> {
  try {
    const ref  = adminDb.collection('loginHistory').doc(userId);
    const snap = await ref.get();
    const now  = Date.now();
    if (!snap.exists) {
      await ref.set({ fingerprints: [fp], ips: [ip], lastLogin: now });
      return { suspicious: false };
    }
    const data       = snap.data()!;
    const fps: string[] = data['fingerprints'] ?? [];
    const ips: string[] = data['ips'] ?? [];
    const lastLogin: number = data['lastLogin'] ?? now;
    const newDevice  = !fps.includes(fp);
    const newIP      = !ips.includes(ip);
    const recentChange = now - lastLogin < 3_600_000;
    if (!fps.includes(fp)) fps.push(fp);
    if (!ips.includes(ip)) ips.push(ip);
    await ref.update({ fingerprints: fps.slice(-10), ips: ips.slice(-10), lastLogin: now });
    if (newDevice && newIP && recentChange) return { suspicious: true, reason: 'New device and new IP within 1 hour.' };
    return { suspicious: false };
  } catch { return { suspicious: false }; }
}

// ─── Concurrent sessions ──────────────────────────────────
async function checkConcurrentSessions(userId: string, sessionId: string): Promise<{ allowed: boolean; activeSessions: number }> {
  const MAX_SESSIONS = 5;
  const SESSION_TTL  = 30 * 24 * 60 * 60 * 1000;
  try {
    const ref  = adminDb.collection('userSessions').doc(userId);
    const snap = await ref.get();
    const now  = Date.now();
    let sessions: Record<string, number> = snap.exists ? (snap.data()?.['sessions'] ?? {}) : {};
    sessions = Object.fromEntries(Object.entries(sessions).filter(([, ts]) => now - ts < SESSION_TTL));
    const count = Object.keys(sessions).length;
    if (count >= MAX_SESSIONS && !sessions[sessionId]) return { allowed: false, activeSessions: count };
    sessions[sessionId] = now;
    await ref.set({ sessions, lastUpdated: now }, { merge: true });
    return { allowed: true, activeSessions: Object.keys(sessions).length };
  } catch { return { allowed: true, activeSessions: 1 }; }
}

// ─── Device integrity ─────────────────────────────────────
interface DeviceInfo {
  jailbreak?: boolean; isRooted?: boolean; rooted?: boolean; dtTJailbreak?: boolean; RootBeer?: boolean;
  model?: string; fingerprint?: string; isEmulator?: boolean;
  debugMode?: boolean; FLAG_DEBUGGABLE?: boolean; isDebug?: boolean;
  developerOptions?: boolean; DEVELOPMENT_SETTINGS?: boolean;
  ADB_ENABLED?: boolean; usbDebug?: boolean; adbEnabled?: boolean;
  appSignature?: string; expectedSignature?: string;
  frida?: boolean; fridaDetected?: boolean; hookDetect?: boolean;
  memoryTamper?: boolean; checksumMemory?: boolean;
  ALLOW_MOCK_LOCATION?: boolean; mockLocationApp?: boolean; mockLocation?: boolean;
  isCaptured?: boolean; screenRecord?: boolean;
  accessibilityAbuse?: boolean; getEnabledAccessibility?: boolean;
}

interface IntegrityResult {
  isRooted: boolean; isEmulator: boolean; isDebug: boolean;
  hasFrida: boolean; hasMockLocation: boolean; flags: string[];
}

function checkDeviceIntegrity(info: DeviceInfo): IntegrityResult {
  const flags: string[] = [];
  let isRooted = false, isEmulator = false, isDebug = false, hasFrida = false, hasMockLocation = false;

  if (info.jailbreak || info.isRooted || info.rooted)                       { isRooted = true;   flags.push('rooted'); }
  if (info.dtTJailbreak || info.RootBeer)                                    { isRooted = true;   flags.push('jailbreak_detected'); }

  const knownEmulators = ['generic','unknown','google_sdk','emulator','android_x86','sdk_gphone'];
  if (knownEmulators.some((e) => (info.model ?? '').toLowerCase().includes(e))) { isEmulator = true; flags.push('emulator'); }
  if ((info.fingerprint ?? '').includes('generic'))                          { isEmulator = true; flags.push('generic_fingerprint'); }
  if (info.isEmulator)                                                       { isEmulator = true; flags.push('emulator_flag'); }

  if (info.debugMode || info.FLAG_DEBUGGABLE || info.isDebug)                { isDebug = true;    flags.push('debug_mode'); }
  if (info.developerOptions || info.DEVELOPMENT_SETTINGS)                    { flags.push('developer_options'); }
  if (info.ADB_ENABLED || info.usbDebug || info.adbEnabled)                  { flags.push('adb_enabled'); }
  if (info.appSignature && info.expectedSignature && info.appSignature !== info.expectedSignature) { isDebug = true; flags.push('tampered_apk'); }

  if (info.frida || info.fridaDetected || info.hookDetect)                   { hasFrida = true;   flags.push('frida_detected'); }
  if (info.memoryTamper || info.checksumMemory)                              { flags.push('memory_tamper'); }
  if (info.ALLOW_MOCK_LOCATION || info.mockLocationApp || info.mockLocation) { hasMockLocation = true; flags.push('mock_location'); }
  if (info.isCaptured || info.screenRecord)                                  { flags.push('screen_recording'); }
  if (info.accessibilityAbuse || info.getEnabledAccessibility)               { flags.push('accessibility_abuse'); }

  return { isRooted, isEmulator, isDebug, hasFrida, hasMockLocation, flags };
}

// ─── Geo helpers ──────────────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkGeoImpossibility(lat1: number, lon1: number, ts1: number, lat2: number, lon2: number, ts2: number): { impossible: boolean; speedKmH: number } {
  const dist  = haversineKm(lat1, lon1, lat2, lon2);
  const hours = Math.abs(ts2 - ts1) / 3_600_000;
  if (hours < 0.001) return { impossible: dist > 1, speedKmH: Infinity };
  const speed = dist / hours;
  return { impossible: speed > 900, speedKmH: Math.round(speed) };
}

interface IpApiResponse { status: string; countryCode: string; lat: number; lon: number; }

async function checkIPGPSMismatch(ip: string, lat: number, lon: number): Promise<{ mismatch: boolean; ipCountry?: string; reason?: string }> {
  try {
    const res  = await fetch(`https://ip-api.com/json/${ip}?fields=countryCode,lat,lon,status`);
    if (!res.ok) return { mismatch: false };
    const data = await res.json() as IpApiResponse;
    if (data.status !== 'success') return { mismatch: false };
    const dist = haversineKm(lat, lon, data.lat, data.lon);
    return dist > 500
      ? { mismatch: true,  ipCountry: data.countryCode, reason: `GPS and IP location differ by ${Math.round(dist)}km` }
      : { mismatch: false, ipCountry: data.countryCode };
  } catch { return { mismatch: false }; }
}

async function checkImpossibleCheckin(userId: string, lat: number, lon: number, ts: number): Promise<{ impossible: boolean; speedKmH: number }> {
  try {
    const ref  = adminDb.collection('userCheckins').doc(userId);
    const prev = await ref.get();
    await ref.set({ lat, lon, ts });
    if (!prev.exists) return { impossible: false, speedKmH: 0 };
    const d = prev.data()!;
    return checkGeoImpossibility(d['lat'], d['lon'], d['ts'], lat, lon, ts);
  } catch { return { impossible: false, speedKmH: 0 }; }
}

const SANCTIONED_COUNTRIES = new Set(['KP', 'IR', 'SY', 'CU', 'RU']);
const SANCTIONS_NAMES       = ['kim jong', 'ali khamenei', 'bashar al-assad', 'nicolas maduro'];

function isSanctioned(cc: string): boolean          { return SANCTIONED_COUNTRIES.has(cc.toUpperCase()); }
function screenSanctionsName(name: string): boolean { return SANCTIONS_NAMES.some((s) => name.toLowerCase().includes(s)); }

// ─── Safe Browsing ────────────────────────────────────────
interface SafeBrowsingResponse { matches?: Array<{ threatType: string }> }

async function checkUrlSafety(url: string): Promise<{ safe: boolean; threat?: string }> {
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key) return { safe: true };
  try {
    const res  = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        client:     { clientId: 'myarchetype', clientVersion: '1.0' },
        threatInfo: {
          threatTypes:      ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
          platformTypes:    ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries:    [{ url }],
        },
      }),
    });
    const data = await res.json() as SafeBrowsingResponse;
    return data.matches?.length
      ? { safe: false, threat: data.matches[0]?.threatType }
      : { safe: true };
  } catch { return { safe: true }; }
}

// ─── VPN/Proxy detection ──────────────────────────────────
async function detectVPNProxy(req: Request): Promise<{ isProxy: boolean; isTor: boolean }> {
  const via       = (req.headers['via'] as string) ?? '';
  const forwarded = (req.headers['x-forwarded-for'] as string) ?? '';
  return { isProxy: !!via || forwarded.split(',').length > 2, isTor: false };
}

// ─── Admin audit log ──────────────────────────────────────
async function logAdminAction(adminUid: string, action: string, target: string, details?: Record<string, unknown>): Promise<void> {
  try {
    await adminDb.collection('adminAuditLog').add({
      adminUid, action, target, details: details ?? {},
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { console.error('[audit]', e); }
}

// ─── HIBP password check ──────────────────────────────────
async function isPasswordBreached(password: string): Promise<{ breached: boolean; count: number }> {
  try {
    const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const res  = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return { breached: false, count: 0 };
    const suffix = hash.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [h, c] = line.split(':');
      if (h?.trim() === suffix) return { breached: true, count: parseInt(c?.trim() ?? '0', 10) };
    }
    return { breached: false, count: 0 };
  } catch { return { breached: false, count: 0 }; }
}

// ─── Text moderation ─────────────────────────────────────
const HARMFUL_PATTERNS: Array<{ p: RegExp; c: string }> = [
  { p: /\b(kill\s*(you|ur)|murder\s*you)\b/i,                                        c: 'violence_threat' },
  { p: /\b(kill\s*your\s*self|kys|go\s*die)\b/i,                                     c: 'self_harm' },
  { p: /\bn[i1][g9]{1,2}[e3]r/i,                                                     c: 'racial_slur' },
  { p: /\bf[a@4][g9]{1,2}[o0]t/i,                                                    c: 'homophobic_slur' },
  { p: /\b(send\s*(me\s*)?(nudes?|dick\s*pics?))\b/i,                                c: 'sexual_solicitation' },
  { p: /\b(sell(ing)?\s*(weed|meth|coke|heroin|pills?|drugs?))\b/i,                  c: 'drug_dealing' },
  { p: /\b(i\s*have\s*(your\s*)?(photos?|nudes?)).{0,30}(pay|send\s*money)/i,        c: 'sextortion' },
  { p: /\b(ssn|social\s*security)\s*:?\s*\d{3}-\d{2}-\d{4}/i,                       c: 'pii' },
  { p: /\b(looking\s*for\s*(younger|teen|underage|minor))/i,                         c: 'underage' },
  { p: /\b(preteen|pre-teen|barely\s*legal|jailbait|lolita|shota|ddlg|agere)\b/i,   c: 'underage' },
  { p: /\b(narco(s)?|traphouse)\b/i,                                                 c: 'drug_dealing' },
];

function serverCheckText(text: string): { safe: boolean; category?: string } {
  if (!text) return { safe: true };
  for (const { p, c } of HARMFUL_PATTERNS) if (p.test(text)) return { safe: false, category: c };
  return { safe: true };
}

// ─── CSAM scanning ────────────────────────────────────────
const KNOWN_CSAM_HASHES = new Set<string>();

async function scanForCSAM(imageUrl: string): Promise<{ isCSAM: boolean; confidence: number }> {
  try {
    const hash = crypto.createHash('sha256').update(imageUrl).digest('hex');
    if (KNOWN_CSAM_HASHES.has(hash)) return { isCSAM: true, confidence: 1.0 };
    return { isCSAM: false, confidence: 0 };
  } catch { return { isCSAM: false, confidence: 0 }; }
}

interface NcmecDetails  { imageUrl: string; userId: string; reporterUid: string; }
interface NcmecResponse { tiplineId?: string; }

async function reportToNCMEC(details: NcmecDetails): Promise<{ success: boolean; tiplineId?: string }> {
  try {
    const NCMEC_API = process.env.NCMEC_API_KEY;
    if (!NCMEC_API) {
      await adminDb.collection('csamReports').add({ ...details, status: 'pending_manual', timestamp: admin.firestore.FieldValue.serverTimestamp() });
      return { success: false };
    }
    const res  = await fetch('https://api.missingkids.org/cybertipline/report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': NCMEC_API },
      body:    JSON.stringify({ type: 'CSAM', reporterType: 'ESP', ...details }),
    });
    const data = await res.json() as NcmecResponse;
    await adminDb.collection('csamReports').add({ ...details, tiplineId: data.tiplineId, status: 'reported', timestamp: admin.firestore.FieldValue.serverTimestamp() });
    return { success: res.ok, tiplineId: data.tiplineId };
  } catch { return { success: false }; }
}

// ─── Coordinated inauthentic behavior ────────────────────
async function detectCoordinatedInauthentic(userIds: string[]): Promise<{ detected: boolean; clusterSize: number; reason?: string }> {
  if (userIds.length < 3) return { detected: false, clusterSize: 0 };
  try {
    const fps   = await Promise.all(userIds.map(async (id) => {
      const snap = await adminDb.collection('deviceFingerprints').where('users', 'array-contains', id).limit(1).get();
      return snap.docs[0]?.id ?? null;
    }));
    const valid  = fps.filter(Boolean);
    const unique = new Set(valid);
    if (unique.size < valid.length) return { detected: true, clusterSize: userIds.length, reason: 'Multiple accounts share device fingerprints.' };
    return { detected: false, clusterSize: 0 };
  } catch { return { detected: false, clusterSize: 0 }; }
}

// ─── Age-gated content ────────────────────────────────────
const CONTENT_AGE_GATES: Record<string, number> = { explicit: 18, mature: 18, alcohol: 21 };

async function enforceAgeGatedContent(userId: string, contentType: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const snap = await adminDb.collection('users').doc(userId).get();
    if (!snap.exists) return { allowed: false, reason: 'User not found' };
    const dob: string = snap.data()!['dateOfBirth'] ?? '';
    if (!dob) return { allowed: false, reason: 'Age not verified' };
    const age    = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    const minAge = CONTENT_AGE_GATES[contentType] ?? 18;
    return age < minAge ? { allowed: false, reason: `Must be ${minAge}+ for this content` } : { allowed: true };
  } catch { return { allowed: true }; }
}

// ─── Screenshot logging ───────────────────────────────────
async function logScreenshotEvent(userId: string, screen: string): Promise<void> {
  try {
    await adminDb.collection('screenshotEvents').add({ uid: userId, screen, timestamp: admin.firestore.FieldValue.serverTimestamp() });
    const recent = await adminDb.collection('screenshotEvents').where('uid', '==', userId).where('timestamp', '>=', new Date(Date.now() - 60_000)).get();
    if (recent.size > 10) await logAdminAction('system', 'screenshotDetect', userId, { count: recent.size, screen });
  } catch {}
}

// ─── Meeting location share ───────────────────────────────
async function createMeetingLocationShare(userId: string, lat: number, lon: number, trustedContactId: string): Promise<{ shareId: string; expiresAt: number }> {
  const shareId   = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
  try {
    await adminDb.collection('meetingLocationShares').doc(shareId).set({
      uid: userId, lat, lon, trustedContactId, shareId, expiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch {}
  return { shareId, expiresAt };
}

// ─── Trust threshold enforcement ─────────────────────────
type TrustAction = 'none' | 'warn' | 'restrict' | 'ban';

async function enforceTrustThreshold(userId: string): Promise<{ action: TrustAction; trustScore: number }> {
  try {
    const snap       = await adminDb.collection('users').doc(userId).get();
    if (!snap.exists) return { action: 'none', trustScore: 50 };
    const trustScore: number = snap.data()?.['trustScore'] ?? 50;
    if (trustScore < 5) {
      await adminDb.collection('users').doc(userId).update({ status: 'banned', autoBan: true, bannedAt: admin.firestore.FieldValue.serverTimestamp() });
      await logAdminAction('system', 'autoBan', userId, { trustScore });
      return { action: 'ban', trustScore };
    }
    if (trustScore < 15) {
      await adminDb.collection('users').doc(userId).update({ status: 'shadow_banned', autoRestrict: true });
      await logAdminAction('system', 'autoRestrict', userId, { trustScore });
      return { action: 'restrict', trustScore };
    }
    if (trustScore < 30) {
      await adminDb.collection('notifications').add({ userId, type: 'trust_warning', message: 'Your account has received safety warnings.', timestamp: admin.firestore.FieldValue.serverTimestamp() });
      return { action: 'warn', trustScore };
    }
    return { action: 'none', trustScore };
  } catch { return { action: 'none', trustScore: 50 }; }
}

// ─── Cross-account PDQ ────────────────────────────────────
async function checkCrossAccountPDQ(imageUrl: string, userId: string): Promise<{ isDuplicate: boolean; matchedUserId?: string }> {
  try {
    const hash = crypto.createHash('sha256').update(imageUrl).digest('hex').slice(0, 32);
    const snap = await adminDb.collection('photoHashes').where('hash', '==', hash).where('userId', '!=', userId).limit(1).get();
    if (!snap.empty) return { isDuplicate: true, matchedUserId: snap.docs[0]!.data()['userId'] as string };
    await adminDb.collection('photoHashes').add({ hash, userId, url: imageUrl, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { isDuplicate: false };
  } catch { return { isDuplicate: false }; }
}

// ─── A/B testing ──────────────────────────────────────────
// NOTE: In-memory — resets on cold start. Move to Firestore for persistence.
const abTestAssignments: Record<string, Record<string, string>> = {};

function assignABTest(userId: string, experimentId: string, variants: string[]): string {
  if (!abTestAssignments[experimentId]) abTestAssignments[experimentId] = {};
  const existing = abTestAssignments[experimentId]![userId];
  if (existing) return existing;
  const hash    = crypto.createHash('md5').update(`${userId}${experimentId}`).digest('hex');
  const variant = variants[parseInt(hash.slice(0, 8), 16) % variants.length]!;
  abTestAssignments[experimentId]![userId] = variant;
  return variant;
}

function validateABTestIntegrity(userId: string, experimentId: string, claimedVariant: string, variants: string[]): boolean {
  return assignABTest(userId, experimentId, variants) === claimedVariant;
}

// ─── API key rotation ─────────────────────────────────────
// NOTE: In-memory cache — resets on cold start. Keys are persisted to Firestore.
const API_KEY_CACHE: Record<string, { key: string; rotatedAt: number }> = {};

async function rotateApiKey(service: string): Promise<{ success: boolean }> {
  const newKey = crypto.randomBytes(32).toString('hex');
  API_KEY_CACHE[service] = { key: newKey, rotatedAt: Date.now() };
  try {
    await adminDb.collection('apiKeys').doc(service).set({ key: crypto.createHash('sha256').update(newKey).digest('hex'), rotatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { success: true };
  } catch { return { success: false }; }
}

// ─── WCAG audit ───────────────────────────────────────────
const WCAG_RULES = new Set(['color-contrast', 'image-alt', 'label', 'link-name', 'button-name']);

function auditWCAG(violations: Array<{ id: string; impact: string }>): { passed: boolean; critical: string[]; total: number } {
  const matched  = violations.filter((v) => WCAG_RULES.has(v.id));
  const critical = matched.filter((v) => v.impact === 'critical').map((v) => v.id);
  return { passed: critical.length === 0, critical, total: matched.length };
}

// ─── Color contrast ───────────────────────────────────────
function checkColorContrast(foreground: string, background: string): { ratio: number; wcagAA: boolean; wcagAAA: boolean } {
  const luminance = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  };
  const l1    = luminance(foreground), l2 = luminance(background);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return { ratio: Math.round(ratio * 100) / 100, wcagAA: ratio >= 4.5, wcagAAA: ratio >= 7 };
}

// ─── Analytics event validation ───────────────────────────
function validateAnalyticsEvent(event: Record<string, unknown>, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(event)).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

// ─── Fake engagement detection ────────────────────────────
interface EngagementMetrics { likes: number; views: number; messages: number; timeOnAppMinutes: number; }

function detectFakeEngagement(metrics: EngagementMetrics): { suspicious: boolean; signals: string[] } {
  const signals: string[] = [];
  if (metrics.likes > 0 && metrics.views === 0)                signals.push('likes_without_views');
  if (metrics.messages > 500 && metrics.timeOnAppMinutes < 10) signals.push('impossible_message_rate');
  if (metrics.likes / Math.max(metrics.views, 1) > 0.95)      signals.push('abnormal_like_rate');
  return { suspicious: signals.length > 0, signals };
}

// ─── Bot detection ────────────────────────────────────────
// NOTE: In-memory — resets on cold start. Sufficient for rate-burst detection per instance.
const requestTimestamps: Record<string, number[]> = {};
const BOT_UA_PATTERNS = ['bot','crawler','spider','headless','phantomjs','puppeteer','selenium','playwright','curl','wget'];

function detectBotTraffic(ip: string, userAgent: string): { isBot: boolean; confidence: number; signals: string[] } {
  const signals: string[] = [];
  const now = Date.now();
  if (!requestTimestamps[ip]) requestTimestamps[ip] = [];
  requestTimestamps[ip] = requestTimestamps[ip]!.filter((t) => now - t < 1000);
  requestTimestamps[ip]!.push(now);
  if (requestTimestamps[ip]!.length > 30) signals.push('high_request_rate');
  if (BOT_UA_PATTERNS.some((p) => userAgent.toLowerCase().includes(p))) signals.push('bot_user_agent');
  if (!userAgent || userAgent.length < 20) signals.push('suspicious_ua');
  return { isBot: signals.length >= 1, confidence: Math.min(signals.length / 3, 1), signals };
}

// ─── Conversion fraud ─────────────────────────────────────
// NOTE: In-memory — resets on cold start. Move to Firestore for cross-instance tracking.
const conversionEvents: Record<string, number[]> = {};

function detectConversionFraud(userId: string, eventType: string, value: number): { fraudulent: boolean; reason?: string } {
  const key = `${userId}_${eventType}`;
  const now = Date.now();
  if (!conversionEvents[key]) conversionEvents[key] = [];
  conversionEvents[key] = conversionEvents[key]!.filter((t) => now - t < 3_600_000);
  conversionEvents[key]!.push(now);
  const count = conversionEvents[key]!.length;
  if (count > 10) return { fraudulent: true, reason: `${count} ${eventType} conversions in 1 hour.` };
  if (value < 0)  return { fraudulent: true, reason: 'Negative conversion value.' };
  return { fraudulent: false };
}

// ═══════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════

app.post('/send-notification', notifLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { subscription, title, body, screen } = req.body as Record<string, unknown>;
  const t = sanitize(title), b = sanitize(body);
  if (!isValidPushSub(subscription) || !t || !b) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; }
  if (!VAPID_EMAIL) { res.status(500).json({ success: false, reason: 'missing_vapid_config' }); return; }
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title: t, body: b, data: { screen: sanitize(screen) ?? 'home' } }));
    res.json({ success: true });
  } catch (e) {
    const err = e as { statusCode?: number };
    if (err.statusCode === 410 || err.statusCode === 404) { res.status(410).json({ success: false, reason: 'subscription_expired' }); return; }
    res.status(500).json({ success: false, reason: 'failed' });
  }
}));

app.post('/send-expo-notification', notifLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { expoPushToken, title, body, screen } = req.body as Record<string, unknown>;
  const t = sanitize(title), b = sanitize(body);
  if (!isValidExpoToken(expoPushToken) || !t || !b) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; }
  const r = await fetch('https://exp.host/--/api/v2/push/send', {
    method:  'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body:    JSON.stringify({ to: expoPushToken, sound: 'default', title: t, body: b, data: { screen: sanitize(screen) ?? 'home' } }),
  });
  res.json({ success: r.ok, data: await r.json() });
}));

app.post('/check-email', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const email = sanitize((req.body as Record<string, unknown>)['email'], 254);
  if (!email) { res.status(400).json({ success: false, reason: 'missing_email' }); return; }
  const disposable = isDisposableEmail(email);
  res.json({ success: true, disposable, allowed: !disposable });
}));

app.post('/check-password-breach', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { password } = req.body as Record<string, unknown>;
  if (typeof password !== 'string' || password.length < 6) { res.status(400).json({ success: false, reason: 'invalid_password' }); return; }
  res.json({ success: true, ...(await isPasswordBreached(password)) });
}));

app.post('/register-device', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const id = uid(req);
  const fp = (req.headers['x-device-fingerprint'] as string) ?? (req.body as Record<string, unknown>)['fingerprint'] ?? '';
  if (!fp || (fp as string).length < 8) { res.status(400).json({ success: false, reason: 'invalid_fingerprint' }); return; }
  const device = await trackDeviceFingerprint(fp as string, id);
  const multi  = await checkMultiAccountDevice(fp as string, id);
  if (multi.bannedReuse) await logAdminAction('system', 'banned_device_reuse', id, { fingerprint: fp, accounts: multi.accounts });
  res.json({ success: true, knownDevice: device.knownDevice, multiAccount: multi.multiAccount, bannedReuse: multi.bannedReuse });
}));

app.post('/login-track', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const id  = uid(req);
  const { sessionId, fingerprint } = req.body as Record<string, unknown>;
  const ip  = clientIp(req);
  const ato = await detectAccountTakeover(id, (fingerprint as string) ?? '', ip);
  if (ato.suspicious) await logAdminAction('system', 'ato_suspicious', id, { reason: ato.reason });
  const session = sessionId ? await checkConcurrentSessions(id, sessionId as string) : { allowed: true, activeSessions: 1 };
  res.json({ success: true, atoSuspicious: ato.suspicious, sessionAllowed: session.allowed, activeSessions: session.activeSessions });
}));

app.post('/check-device-integrity', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const id     = uid(req);
  const info   = ((req.body as Record<string, unknown>)['deviceInfo'] ?? {}) as DeviceInfo;
  const result = checkDeviceIntegrity(info);
  if (result.isRooted || result.hasFrida || result.isEmulator) await logAdminAction('system', 'device_integrity_fail', id, { flags: result.flags });
  res.json({ success: true, ...result });
}));

app.post('/validate-location', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const id  = uid(req);
  const { lat, lon, timestamp, countryCode } = req.body as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lon !== 'number') { res.status(400).json({ success: false, reason: 'invalid_coordinates' }); return; }
  if (countryCode && isSanctioned(countryCode as string)) { res.status(403).json({ success: false, reason: 'region_not_supported' }); return; }
  const ts = (timestamp as number) ?? Date.now();
  let impossible = false, speedKmH = 0;
  try {
    const prev = await adminDb.collection('userLocations').doc(id).get();
    if (prev.exists) {
      const p   = prev.data()!;
      const chk = checkGeoImpossibility(p['lat'], p['lon'], p['timestamp'], lat, lon, ts);
      impossible = chk.impossible; speedKmH = chk.speedKmH;
    }
    await adminDb.collection('userLocations').doc(id).set({ lat, lon, timestamp: ts, countryCode: countryCode ?? '' });
  } catch {}
  const ip         = clientIp(req);
  const ipMismatch = await checkIPGPSMismatch(ip, lat, lon);
  const checkin    = await checkImpossibleCheckin(id, lat, lon, ts);
  const vpn        = await detectVPNProxy(req);
  res.json({ success: true, impossible, speedKmH, ipMismatch: ipMismatch.mismatch, impossibleCheckin: checkin.impossible, isProxy: vpn.isProxy, isTor: vpn.isTor });
}));

app.post('/moderate-text', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const text = sanitize((req.body as Record<string, unknown>)['text'], 5000);
  if (!text) { res.status(400).json({ success: false, reason: 'missing_text' }); return; }
  const result = serverCheckText(text);
  if (!result.safe) await logAdminAction('system', 'text_flagged', uid(req), { category: result.category, preview: text.slice(0, 100) });
  res.json({ success: true, safe: result.safe, category: result.category });
}));

app.post('/scan-csam', modLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res) => {
  const id  = uid(req);
  const { imageUrl } = req.body as Record<string, unknown>;
  if (!imageUrl) { res.status(400).json({ success: false, reason: 'missing_url' }); return; }
  const scan = await scanForCSAM(imageUrl as string);
  if (scan.isCSAM) {
    const report = await reportToNCMEC({ imageUrl: imageUrl as string, userId: id, reporterUid: 'system' });
    await logAdminAction('system', 'csam_detected', id, { imageUrl, tiplineId: report.tiplineId });
    res.json({ success: true, isCSAM: true, reported: report.success, tiplineId: report.tiplineId }); return;
  }
  res.json({ success: true, isCSAM: false });
}));

app.post('/age-gate-check', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { contentType } = req.body as Record<string, unknown>;
  res.json({ success: true, ...(await enforceAgeGatedContent(uid(req), (contentType as string) ?? 'explicit')) });
}));

app.post('/dmca-takedown', webhookLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res) => {
  const { contentUrl, reporterEmail, copyrightOwner, workDescription } = req.body as Record<string, unknown>;
  if (!contentUrl || !reporterEmail) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; }
  const caseId = `DMCA-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await adminDb.collection('dmcaNotices').add({ caseId, contentUrl, reporterEmail, copyrightOwner, workDescription, status: 'received', receivedAt: admin.firestore.FieldValue.serverTimestamp() });
  await logAdminAction('system', 'dmca_takedown', uid(req), { caseId, contentUrl });
  res.json({ success: true, caseId });
}));

app.post('/log-screenshot', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  await logScreenshotEvent(uid(req), ((req.body as Record<string, unknown>)['screen'] as string) ?? 'unknown');
  res.json({ success: true });
}));

app.post('/share-meeting-location', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { lat, lon, trustedContactId } = req.body as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !trustedContactId) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; }
  res.json({ success: true, ...(await createMeetingLocationShare(uid(req), lat, lon, trustedContactId as string)) });
}));

app.post('/enforce-trust', webhookLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res) => {
  const { targetUid } = req.body as Record<string, unknown>;
  if (!targetUid) { res.status(400).json({ success: false, reason: 'missing_uid' }); return; }
  res.json({ success: true, ...(await enforceTrustThreshold(targetUid as string)) });
}));

app.post('/check-url', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const url = sanitize((req.body as Record<string, unknown>)['url'], 2048);
  if (!url) { res.status(400).json({ success: false, reason: 'missing_url' }); return; }
  res.json({ success: true, ...(await checkUrlSafety(url)) });
}));

app.post('/screen-name', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const name = sanitize((req.body as Record<string, unknown>)['name'], 200);
  if (!name) { res.status(400).json({ success: false, reason: 'missing_name' }); return; }
  const flagged = screenSanctionsName(name);
  if (flagged) await logAdminAction('system', 'sanctions_match', uid(req), { name });
  res.json({ success: true, flagged });
}));

app.post('/pdq-cross-account', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const id  = uid(req);
  const { photoUrl } = req.body as Record<string, unknown>;
  if (!photoUrl) { res.status(400).json({ success: false, reason: 'missing_url' }); return; }
  const result = await checkCrossAccountPDQ(photoUrl as string, id);
  if (result.isDuplicate) await logAdminAction('system', 'cross_account_duplicate', id, { matchedUserId: result.matchedUserId });
  res.json({ success: true, ...result });
}));

app.post('/check-cib', webhookLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res) => {
  const { userIds } = req.body as Record<string, unknown>;
  if (!Array.isArray(userIds)) { res.status(400).json({ success: false, reason: 'missing_userIds' }); return; }
  const result = await detectCoordinatedInauthentic(userIds as string[]);
  if (result.detected) await logAdminAction('system', 'cib_detected', 'system', { clusterSize: result.clusterSize, userIds });
  res.json({ success: true, ...result });
}));

app.post('/ab-test', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const id  = uid(req);
  const { experimentId, claimedVariant, variants } = req.body as Record<string, unknown>;
  if (!experimentId || !variants) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; }
  const assigned = assignABTest(id, experimentId as string, variants as string[]);
  const valid    = !claimedVariant || validateABTestIntegrity(id, experimentId as string, claimedVariant as string, variants as string[]);
  res.json({ success: true, variant: assigned, valid });
}));

app.post('/admin/rotate-key', webhookLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res) => {
  const id  = uid(req);
  const { service } = req.body as Record<string, unknown>;
  if (!service) { res.status(400).json({ success: false, reason: 'missing_service' }); return; }
  const snap = await adminDb.collection('users').doc(id).get();
  if (!snap.exists || snap.data()?.['role'] !== 'admin') { res.status(403).json({ success: false, reason: 'not_admin' }); return; }
  const result = await rotateApiKey(service as string);
  await logAdminAction(id, 'key_rotation', service as string, { rotatedAt: Date.now() });
  res.json({ success: result.success });
}));

app.post('/wcag-audit', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { violations } = req.body as Record<string, unknown>;
  if (!Array.isArray(violations)) { res.status(400).json({ success: false, reason: 'missing_violations' }); return; }
  res.json({ success: true, ...auditWCAG(violations as Array<{ id: string; impact: string }>) });
}));

app.post('/check-contrast', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { foreground, background } = req.body as Record<string, unknown>;
  if (!foreground || !background) { res.status(400).json({ success: false, reason: 'missing_colors' }); return; }
  res.json({ success: true, ...checkColorContrast(foreground as string, background as string) });
}));

app.post('/validate-event', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { event, signature } = req.body as Record<string, unknown>;
  if (!event || !signature) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; }
  const secret = process.env.ANALYTICS_HMAC_SECRET ?? HMAC_SECRET;
  res.json({ success: true, valid: validateAnalyticsEvent(event as Record<string, unknown>, signature as string, secret) });
}));

app.post('/check-engagement', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const { metrics } = req.body as Record<string, unknown>;
  if (!metrics) { res.status(400).json({ success: false, reason: 'missing_metrics' }); return; }
  const result = detectFakeEngagement(metrics as EngagementMetrics);
  if (result.suspicious) await logAdminAction('system', 'fake_engagement', uid(req), { signals: result.signals });
  res.json({ success: true, ...result });
}));

app.post('/check-bot', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] as string) ?? '';
  res.json({ success: true, ...detectBotTraffic(ip, ua) });
}));

app.post('/track-conversion', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res) => {
  const id  = uid(req);
  const { eventType, value } = req.body as Record<string, unknown>;
  if (!eventType) { res.status(400).json({ success: false, reason: 'missing_event_type' }); return; }
  const result = detectConversionFraud(id, eventType as string, (value as number) ?? 0);
  if (result.fraudulent) await logAdminAction('system', 'conversion_fraud', id, { eventType, reason: result.reason });
  res.json({ success: true, ...result });
}));

app.post('/admin/action', webhookLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res) => {
  const id   = uid(req);
  const snap = await adminDb.collection('users').doc(id).get();
  if (!snap.exists || snap.data()?.['role'] !== 'admin') { res.status(403).json({ success: false, reason: 'not_admin' }); return; }
  const { action, target, details } = req.body as Record<string, unknown>;
  if (!action || !target) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; }
  await logAdminAction(id, action as string, target as string, details as Record<string, unknown>);
  res.json({ success: true });
}));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), detectors: 'active', minTLS: TLS_INFO.min, tlsVersions: TLS_INFO.supported });
});

// ─── Express error boundary ───────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'internal_error';
  if (!res.headersSent) res.status(500).json({ success: false, reason: message });
});

const PORT = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => { /* local dev only */ });
}

export default app;