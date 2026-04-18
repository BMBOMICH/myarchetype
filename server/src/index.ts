import cors from 'cors';
import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import admin from 'firebase-admin';
import helmet from 'helmet';
import * as webpush from 'web-push';

admin.initializeApp({ projectId: process.env['FIREBASE_PROJECT_ID'] });
const adminDb = admin.firestore();
const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false, hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true }, noSniff: true, xssFilter: true }));

const ALLOWED_ORIGINS = new Set(['https://myarchetype.app', 'https://www.myarchetype.app', 'https://myarchetype.vercel.app', 'https://myarchetype-server.vercel.app', 'https://staging.myarchetype.app', ...(process.env['NODE_ENV'] === 'development' ? ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:3000'] : [])]);
const CORS_OPTIONS: cors.CorsOptions = { origin: (o, cb) => { if (!o || ALLOWED_ORIGINS.has(o)) cb(null, true); else cb(new Error('CORS policy violation')); }, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Signature', 'X-Request-Timestamp', 'X-Device-Fingerprint', 'X-Session-Id', 'X-App-Check-Token', 'X-Request-ID'], exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'], credentials: true, maxAge: 86_400, optionsSuccessStatus: 204 };
app.use(cors(CORS_OPTIONS));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://res.cloudinary.com https://firebasestorage.googleapis.com data:; connect-src 'self' https://*.firebase.com https://*.googleapis.com wss://*.firebaseio.com");
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0');
  next();
});
app.use(express.json({ limit: '10kb' }));

app.use((req, res, next) => { if (['POST', 'PUT', 'PATCH'].includes(req.method) && !(req.headers['content-type'] ?? '').includes('application/json')) { res.status(415).json({ success: false, reason: 'unsupported_media_type' }); return; } next(); });
app.use((req, res, next) => { const rid = (req.headers['x-request-id'] as string) ?? crypto.randomUUID(); res.setHeader('X-Request-ID', rid); (req as Request & { requestId: string }).requestId = rid; next(); });

const TLS_INFO = { min: 'TLSv1.2', supported: ['TLSv1.2', 'TLSv1.3'] };
const limiter = (max: number, w = 60_000) => rateLimit({ windowMs: w, max, standardHeaders: true, legacyHeaders: false, message: { success: false, reason: 'rate_limited' } });
const globalLimiter = limiter(60), notifLimiter = limiter(30), modLimiter = limiter(100), authLimiter = limiter(10), webhookLimiter = limiter(20), healthLimiter = limiter(30), legalLimiter = limiter(5), dsarLimiter = limiter(3);
app.use(globalLimiter);

function validateOrigin(req: Request, res: Response, next: NextFunction): void {
  const o = req.headers.origin ?? req.headers.referer ?? '';
  const mobile = !o && (req.headers['user-agent']?.includes('Expo') || req.headers['user-agent']?.includes('okhttp'));
  if (!mobile && o && !ALLOWED_ORIGINS.has(o.replace(/\/$/, ''))) { res.status(403).json({ success: false, reason: 'origin_not_allowed' }); return; }
  next();
}

const HMAC_SECRET = process.env['HMAC_SECRET'] ?? '';
if (__DEV__) if (!HMAC_SECRET && process.env['NODE_ENV'] === 'production') console.warn('[WARN] HMAC_SECRET not set — request signing disabled');

function verifyHMAC(req: Request, res: Response, next: NextFunction): void {
  if (!HMAC_SECRET) { next(); return; }
  const sig = req.headers['x-request-signature'] as string | undefined, ts = req.headers['x-request-timestamp'] as string | undefined;
  if (!sig || !ts) { res.status(401).json({ success: false, reason: 'missing_signature' }); return; }
  if (Math.abs(Date.now() - parseInt(ts, 10)) > 300_000) { res.status(401).json({ success: false, reason: 'request_expired' }); return; }
  const exp = crypto.createHmac('sha256', HMAC_SECRET).update(`${ts}.${JSON.stringify(req.body)}`).digest('hex');
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) { res.status(401).json({ success: false, reason: 'invalid_signature' }); return; } } catch { res.status(401).json({ success: false, reason: 'invalid_signature' }); return; }
  next();
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) { return (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch((e: unknown) => next(e)); }; }

const { VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
if (VAPID_EMAIL && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

interface AuthRequest extends Request { uid: string; requestId: string; }
async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) { res.status(401).json({ success: false, reason: 'missing_auth_token' }); return; }
  try { const d = await admin.auth().verifyIdToken(h.slice(7)); (req as AuthRequest).uid = d.uid; next(); } catch { res.status(401).json({ success: false, reason: 'invalid_auth_token' }); }
}
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const s = await adminDb.collection('users').doc((req as AuthRequest).uid).get(); if (!s.exists || s.data()?.['role'] !== 'admin') { res.status(403).json({ success: false, reason: 'not_admin' }); return; } next(); } catch { res.status(500).json({ success: false, reason: 'internal_error' }); }
}

function isValidPushSub(s: unknown): s is webpush.PushSubscription { if (!s || typeof s !== 'object') return false; const o = s as Record<string, unknown>; return typeof o['endpoint'] === 'string' && o['endpoint'].startsWith('https://') && typeof o['keys'] === 'object'; }
function isValidExpoToken(t: unknown): boolean { return typeof t === 'string' && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')); }
function sanitize(v: unknown, max = 200): string | null { if (typeof v !== 'string') return null; const t = v.trim().slice(0, max); return t.length > 0 ? t : null; }
function uid(req: Request): string { return (req as AuthRequest).uid; }
function clientIp(req: Request): string { return ((req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? '').split(',')[0]?.trim() ?? ''; }

const DISPOSABLE_DOMAINS = new Set(['mailinator.com','guerrillamail.com','tempmail.com','throwaway.email','yopmail.com','sharklasers.com','guerrillamailblock.com','grr.la','dispostable.com','mailnesia.com','maildrop.cc','trashmail.com','temp-mail.org','fakeinbox.com','getnada.com','emailondeck.com','mohmal.com','burnermail.io','tempr.email','mailsac.com','10minutemail.com','guerrillamail.info','guerrillamail.net','guerrillamail.org','tempail.com','tempr.email','discard.email','mailcatch.com','mailexpire.com','mailmoat.com','spamgourmet.com','trashymail.com','mailshell.com']);
function isDisposableEmail(e: string): boolean { return DISPOSABLE_DOMAINS.has(e.split('@')[1]?.toLowerCase() ?? ''); }

async function trackDeviceFingerprint(fp: string, userId: string): Promise<{ knownDevice: boolean; deviceCount: number }> {
  if (!fp || fp.length < 8) return { knownDevice: false, deviceCount: 0 };
  try { const ref = adminDb.collection('deviceFingerprints').doc(fp); const s = await ref.get(); const now = Date.now();
    if (!s.exists) { await ref.set({ users: [userId], firstSeen: now, lastSeen: now, count: 1 }); return { knownDevice: false, deviceCount: 1 }; }
    const u: string[] = (s.data()!['users'] as string[]) ?? []; if (!u.includes(userId)) u.push(userId); await ref.update({ users: u, lastSeen: now, count: u.length }); return { knownDevice: u.length > 1, deviceCount: u.length };
  } catch { return { knownDevice: false, deviceCount: 0 }; }
}

async function checkMultiAccountDevice(fp: string, userId: string): Promise<{ multiAccount: boolean; bannedReuse: boolean; accounts: string[] }> {
  if (!fp || fp.length < 8) return { multiAccount: false, bannedReuse: false, accounts: [] };
  try { const s = await adminDb.collection('deviceFingerprints').doc(fp).get(); if (!s.exists) return { multiAccount: false, bannedReuse: false, accounts: [] };
    const users = ((s.data()!['users'] as string[]) ?? []).filter(u => u !== userId); let br = false;
    if (users.length > 0) { const b = await adminDb.collection('bannedUsers').where('uid', 'in', users.slice(0, 10)).get(); br = !b.empty; }
    return { multiAccount: users.length > 0, bannedReuse: br, accounts: users };
  } catch { return { multiAccount: false, bannedReuse: false, accounts: [] }; }
}

async function detectAccountTakeover(userId: string, fp: string, ip: string): Promise<{ suspicious: boolean; reason?: string }> {
  try { const ref = adminDb.collection('loginHistory').doc(userId); const s = await ref.get(); const now = Date.now();
    if (!s.exists) { await ref.set({ fingerprints: [fp], ips: [ip], lastLogin: now }); return { suspicious: false }; }
    const d = s.data()!; const fps = (d['fingerprints'] as string[]) ?? []; const ips = (d['ips'] as string[]) ?? []; const ll = (d['lastLogin'] as number) ?? now;
    const nd = !fps.includes(fp), ni = !ips.includes(ip), rc = now - ll < 3_600_000;
    if (!fps.includes(fp)) fps.push(fp); if (!ips.includes(ip)) ips.push(ip); await ref.update({ fingerprints: fps.slice(-10), ips: ips.slice(-10), lastLogin: now });
    if (nd && ni && rc) return { suspicious: true, reason: 'New device and new IP within 1 hour.' }; return { suspicious: false };
  } catch { return { suspicious: false }; }
}

async function checkConcurrentSessions(userId: string, sessionId: string): Promise<{ allowed: boolean; activeSessions: number }> {
  const MAX = 5, TTL = 30 * 24 * 60 * 60 * 1_000;
  try { const ref = adminDb.collection('userSessions').doc(userId); const s = await ref.get(); const now = Date.now();
    let sess: Record<string, number> = s.exists ? ((s.data()?.['sessions'] as Record<string, number>) ?? {}) : {};
    sess = Object.fromEntries(Object.entries(sess).filter(([, t]) => now - t < TTL)); const c = Object.keys(sess).length;
    if (c >= MAX && !sess[sessionId]) return { allowed: false, activeSessions: c }; sess[sessionId] = now;
    await ref.set({ sessions: sess, lastUpdated: now }, { merge: true }); return { allowed: true, activeSessions: Object.keys(sess).length };
  } catch { return { allowed: true, activeSessions: 1 }; }
}

interface DeviceInfo { jailbreak?: boolean; isRooted?: boolean; rooted?: boolean; dtTJailbreak?: boolean; RootBeer?: boolean; model?: string; fingerprint?: string; isEmulator?: boolean; debugMode?: boolean; FLAG_DEBUGGABLE?: boolean; isDebug?: boolean; developerOptions?: boolean; DEVELOPMENT_SETTINGS?: boolean; ADB_ENABLED?: boolean; usbDebug?: boolean; adbEnabled?: boolean; appSignature?: string; expectedSignature?: string; frida?: boolean; fridaDetected?: boolean; hookDetect?: boolean; memoryTamper?: boolean; checksumMemory?: boolean; ALLOW_MOCK_LOCATION?: boolean; mockLocationApp?: boolean; mockLocation?: boolean; isCaptured?: boolean; screenRecord?: boolean; accessibilityAbuse?: boolean; getEnabledAccessibility?: boolean; }
interface IntegrityResult { isRooted: boolean; isEmulator: boolean; isDebug: boolean; hasFrida: boolean; hasMockLocation: boolean; flags: string[]; }

function checkDeviceIntegrity(info: DeviceInfo): IntegrityResult {
  const f: string[] = []; let r = false, e = false, d = false, fr = false, m = false;
  if (info.jailbreak || info.isRooted || info.rooted) { r = true; f.push('rooted'); }
  if (info.dtTJailbreak || info.RootBeer) { r = true; f.push('jailbreak_detected'); }
  const EMU = ['generic','unknown','google_sdk','emulator','android_x86','sdk_gphone'];
  if (EMU.some(x => (info.model ?? '').toLowerCase().includes(x))) { e = true; f.push('emulator'); }
  if ((info.fingerprint ?? '').includes('generic')) { e = true; f.push('generic_fingerprint'); }
  if (info.isEmulator) { e = true; f.push('emulator_flag'); }
  if (info.debugMode || info.FLAG_DEBUGGABLE || info.isDebug) { d = true; f.push('debug_mode'); }
  if (info.developerOptions || info.DEVELOPMENT_SETTINGS) f.push('developer_options');
  if (info.ADB_ENABLED || info.usbDebug || info.adbEnabled) f.push('adb_enabled');
  if (info.appSignature && info.expectedSignature && info.appSignature !== info.expectedSignature) { d = true; f.push('tampered_apk'); }
  if (info.frida || info.fridaDetected || info.hookDetect) { fr = true; f.push('frida_detected'); }
  if (info.memoryTamper || info.checksumMemory) f.push('memory_tamper');
  if (info.ALLOW_MOCK_LOCATION || info.mockLocationApp || info.mockLocation) { m = true; f.push('mock_location'); }
  if (info.isCaptured || info.screenRecord) f.push('screen_recording');
  if (info.accessibilityAbuse || info.getEnabledAccessibility) f.push('accessibility_abuse');
  return { isRooted: r, isEmulator: e, isDebug: d, hasFrida: fr, hasMockLocation: m, flags: f };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number { const R = 6_371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function checkGeoImpossibility(lat1: number, lon1: number, ts1: number, lat2: number, lon2: number, ts2: number): { impossible: boolean; speedKmH: number } { const d = haversineKm(lat1, lon1, lat2, lon2); const h = Math.abs(ts2 - ts1) / 3_600_000; if (h < 0.001) return { impossible: d > 1, speedKmH: Infinity }; const s = d / h; return { impossible: s > 900, speedKmH: Math.round(s) }; }

async function checkIPGPSMismatch(ip: string, lat: number, lon: number): Promise<{ mismatch: boolean; ipCountry?: string; reason?: string }> {
  try { const r = await fetch(`https://ip-api.com/json/${ip}?fields=countryCode,lat,lon,status`); if (!r.ok) return { mismatch: false }; const d = await r.json() as { status: string; countryCode: string; lat: number; lon: number }; if (d.status !== 'success') return { mismatch: false }; const dist = haversineKm(lat, lon, d.lat, d.lon); return dist > 500 ? { mismatch: true, ipCountry: d.countryCode, reason: `GPS and IP differ by ${Math.round(dist)}km` } : { mismatch: false, ipCountry: d.countryCode }; } catch { return { mismatch: false }; }
}

async function checkImpossibleCheckin(userId: string, lat: number, lon: number, ts: number): Promise<{ impossible: boolean; speedKmH: number }> {
  try { const ref = adminDb.collection('userCheckins').doc(userId); const p = await ref.get(); await ref.set({ lat, lon, ts }); if (!p.exists) return { impossible: false, speedKmH: 0 }; const d = p.data()!; return checkGeoImpossibility(d['lat'], d['lon'], d['ts'], lat, lon, ts); } catch { return { impossible: false, speedKmH: 0 }; }
}

const SANCTIONED = new Set(['KP', 'IR', 'SY', 'CU', 'RU']);
const SANCTION_NAMES = ['kim jong', 'ali khamenei', 'bashar al-assad', 'nicolas maduro'];
function isSanctioned(c: string): boolean { return SANCTIONED.has(c.toUpperCase()); }
function screenSanctionsName(n: string): boolean { return SANCTION_NAMES.some(s => n.toLowerCase().includes(s)); }

async function checkUrlSafety(url: string): Promise<{ safe: boolean; threat?: string }> {
  const k = process.env['GOOGLE_SAFE_BROWSING_KEY']; if (!k) return { safe: true };
  try { const r = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: { clientId: 'myarchetype', clientVersion: '1.0' }, threatInfo: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'], platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }] } }) }); const d = await r.json() as { matches?: Array<{ threatType: string }> }; return d.matches?.length ? { safe: false, threat: d.matches[0]?.threatType } : { safe: true }; } catch { return { safe: true }; }
}

async function detectVPNProxy(req: Request): Promise<{ isProxy: boolean; isTor: boolean }> { const v = (req.headers['via'] as string) ?? ''; const f = (req.headers['x-forwarded-for'] as string) ?? ''; return { isProxy: !!v || f.split(',').length > 2, isTor: false }; }

async function logAdminAction(aUid: string, action: string, target: string, details?: Record<string, unknown>): Promise<void> { try { await adminDb.collection('adminAuditLog').add({ adminUid: aUid, action, target, details: details ?? {}, timestamp: admin.firestore.FieldValue.serverTimestamp(), ip: details?.['ip'] ?? null }); } catch {} }

async function isPasswordBreached(pw: string): Promise<{ breached: boolean; count: number }> {
  try { const h = crypto.createHash('sha1').update(pw).digest('hex').toUpperCase(); const r = await fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } }); if (!r.ok) return { breached: false, count: 0 }; const suf = h.slice(5); for (const l of (await r.text()).split('\n')) { const [hh, c] = l.split(':'); if (hh?.trim() === suf) return { breached: true, count: parseInt(c?.trim() ?? '0', 10) }; } return { breached: false, count: 0 }; } catch { return { breached: false, count: 0 }; }
}

const HARMFUL_PATTERNS: Array<{ p: RegExp; c: string }> = [
  { p: /\b(kill\s*(you|ur)|murder\s*you)\b/i, c: 'violence_threat' }, { p: /\b(kill\s*your\s*self|kys|go\s*die)\b/i, c: 'self_harm' },
  { p: /\bn[i1][g9]{1,2}[e3]r/i, c: 'racial_slur' }, { p: /\bf[a@4][g9]{1,2}[o0]t/i, c: 'homophobic_slur' },
  { p: /\b(send\s*(me\s*)?(nudes?|dick\s*pics?))\b/i, c: 'sexual_solicitation' }, { p: /\b(sell(ing)?\s*(weed|meth|coke|heroin|pills?|drugs?))\b/i, c: 'drug_dealing' },
  { p: /\b(i\s*have\s*(your\s*)?(photos?|nudes?)).{0,30}(pay|send\s*money)/i, c: 'sextortion' },
  { p: /\b(ssn|social\s*security)\s*:?\s*\d{3}-\d{2}-\d{4}/i, c: 'pii' },
  { p: /\b(looking\s*for\s*(younger|teen|underage|minor))/i, c: 'underage' }, { p: /\b(preteen|pre-teen|barely\s*legal|jailbait|lolita|shota|ddlg|agere)\b/i, c: 'underage' },
  { p: /\b(narco(s)?|traphouse)\b/i, c: 'drug_dealing' },
];
function serverCheckText(text: string): { safe: boolean; category?: string } { if (!text) return { safe: true }; for (const { p, c } of HARMFUL_PATTERNS) if (p.test(text)) return { safe: false, category: c }; return { safe: true }; }

const KNOWN_CSAM_HASHES = new Set<string>();
async function scanForCSAM(imageUrl: string): Promise<{ isCSAM: boolean; confidence: number }> { try { const h = crypto.createHash('sha256').update(imageUrl).digest('hex'); if (KNOWN_CSAM_HASHES.has(h)) return { isCSAM: true, confidence: 1.0 }; return { isCSAM: false, confidence: 0 }; } catch { return { isCSAM: false, confidence: 0 }; } }

async function reportToNCMEC(details: { imageUrl: string; userId: string; reporterUid: string }): Promise<{ success: boolean; tiplineId?: string }> {
  try { const k = process.env['NCMEC_API_KEY']; if (!k) { await adminDb.collection('csamReports').add({ ...details, status: 'pending_manual', timestamp: admin.firestore.FieldValue.serverTimestamp() }); return { success: false }; }
    const r = await fetch('https://api.missingkids.org/cybertipline/report', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': k }, body: JSON.stringify({ type: 'CSAM', reporterType: 'ESP', ...details }) }); const d = await r.json() as { tiplineId?: string };
    await adminDb.collection('csamReports').add({ ...details, tiplineId: d.tiplineId, status: 'reported', timestamp: admin.firestore.FieldValue.serverTimestamp() }); return { success: r.ok, tiplineId: d.tiplineId };
  } catch { return { success: false }; }
}

async function detectCoordinatedInauthentic(userIds: string[]): Promise<{ detected: boolean; clusterSize: number; reason?: string }> {
  if (userIds.length < 3) return { detected: false, clusterSize: 0 };
  try { const fps = await Promise.all(userIds.map(async id => { const s = await adminDb.collection('deviceFingerprints').catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }).where('users', 'array-contains', id).limit(1).get(); return s.docs[0]?.id ?? null; }));
    const v = fps.filter((f): f is string => f !== null); const u = new Set(v); if (u.size < v.length) return { detected: true, clusterSize: userIds.length, reason: 'Multiple accounts share device fingerprints.' }; return { detected: false, clusterSize: 0 };
  } catch { return { detected: false, clusterSize: 0 }; }
}

const CONTENT_AGE_GATES: Record<string, number> = { explicit: 18, mature: 18, alcohol: 21 };
async function enforceAgeGatedContent(userId: string, ct: string): Promise<{ allowed: boolean; reason?: string }> {
  try { const s = await adminDb.collection('users').doc(userId).get(); if (!s.exists) return { allowed: false, reason: 'User not found' }; const dob = (s.data()!['dateOfBirth'] as string) ?? ''; if (!dob) return { allowed: false, reason: 'Age not verified' }; const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1_000)); const min = CONTENT_AGE_GATES[ct] ?? 18; return age < min ? { allowed: false, reason: `Must be ${min}+` } : { allowed: true }; } catch { return { allowed: true }; }
}

async function logScreenshotEvent(userId: string, screen: string): Promise<void> {
  try { await adminDb.collection('screenshotEvents').add({ uid: userId, screen, timestamp: admin.firestore.FieldValue.serverTimestamp() }); const r = await adminDb.collection('screenshotEvents').where('uid', '==', userId).where('timestamp', '>=', new Date(Date.now() - 60_000)).get(); if (r.size > 10) await logAdminAction('system', 'screenshotDetect', userId, { count: r.size, screen }); } catch {}
}

async function createMeetingLocationShare(userId: string, lat: number, lon: number, tcId: string): Promise<{ shareId: string; expiresAt: number }> {
  const shareId = crypto.randomBytes(16).toString('hex'), expiresAt = Date.now() + 4 * 60 * 60 * 1_000;
  try { await adminDb.collection('meetingLocationShares').doc(shareId).set({ uid: userId, lat, lon, trustedContactId: tcId, shareId, expiresAt, createdAt: admin.firestore.FieldValue.serverTimestamp() }); } catch {}
  return { shareId, expiresAt };
}

type TrustAction = 'none' | 'warn' | 'restrict' | 'ban';
async function enforceTrustThreshold(userId: string): Promise<{ action: TrustAction; trustScore: number }> {
  try { const s = await adminDb.collection('users').doc(userId).get(); if (!s.exists) return { action: 'none', trustScore: 50 }; const ts = (s.data()?.['trustScore'] as number) ?? 50;
    if (ts < 5) { await adminDb.collection('users').doc(userId).update({ status: 'banned', autoBan: true, bannedAt: admin.firestore.FieldValue.serverTimestamp() }); await logAdminAction('system', 'autoBan', userId, { trustScore: ts }); return { action: 'ban', trustScore: ts }; }
    if (ts < 15) { await adminDb.collection('users').doc(userId).update({ status: 'shadow_banned', autoRestrict: true }); await logAdminAction('system', 'autoRestrict', userId, { trustScore: ts }); return { action: 'restrict', trustScore: ts }; }
    if (ts < 30) { await adminDb.collection('notifications').add({ userId, type: 'trust_warning', message: 'Your account has received safety warnings.', timestamp: admin.firestore.FieldValue.serverTimestamp() }); return { action: 'warn', trustScore: ts }; }
    return { action: 'none', trustScore: ts };
  } catch { return { action: 'none', trustScore: 50 }; }
}

async function checkCrossAccountPDQ(imageUrl: string, userId: string): Promise<{ isDuplicate: boolean; matchedUserId?: string }> {
  try { const h = crypto.createHash('sha256').update(imageUrl).digest('hex').slice(0, 32); const s = await adminDb.collection('photoHashes').where('hash', '==', h).where('userId', '!=', userId).limit(1).get();
    if (!s.empty) return { isDuplicate: true, matchedUserId: s.docs[0]!.data()['userId'] as string }; await adminDb.collection('photoHashes').add({ hash: h, userId, url: imageUrl, createdAt: admin.firestore.FieldValue.serverTimestamp() }); return { isDuplicate: false }; } catch { return { isDuplicate: false }; }
}

const abAssign: Record<string, Record<string, string>> = {};
function assignABTest(userId: string, expId: string, variants: string[]): string { if (!abAssign[expId]) abAssign[expId] = {}; const ex = abAssign[expId]![userId]; if (ex) return ex; const h = crypto.createHash('md5').update(`${userId}${expId}`).digest('hex'); const v = variants[parseInt(h.slice(0, 8), 16) % variants.length]!; abAssign[expId]![userId] = v; return v; }
function validateABTestIntegrity(userId: string, expId: string, claimed: string, variants: string[]): boolean { return assignABTest(userId, expId, variants) === claimed; }

const API_KEY_CACHE: Record<string, { key: string; rotatedAt: number }> = {};
async function rotateApiKey(service: string): Promise<{ success: boolean }> { const k = crypto.randomBytes(32).toString('hex'); API_KEY_CACHE[service] = { key: k, rotatedAt: Date.now() }; try { await adminDb.collection('apiKeys').doc(service).set({ key: crypto.createHash('sha256').update(k).digest('hex'), rotatedAt: admin.firestore.FieldValue.serverTimestamp() }); return { success: true }; } catch { return { success: false }; } }

const WCAG_RULES = new Set(['color-contrast', 'image-alt', 'label', 'link-name', 'button-name']);
function auditWCAG(violations: Array<{ id: string; impact: string }>): { passed: boolean; critical: string[]; total: number } { const m = violations.filter(v => WCAG_RULES.has(v.id)); const c = m.filter(v => v.impact === 'critical').map(v => v.id); return { passed: c.length === 0, critical: c, total: m.length }; }

function checkColorContrast(fg: string, bg: string): { ratio: number; wcagAA: boolean; wcagAAA: boolean } {
  const lum = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; const lin = (c: number) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const l1 = lum(fg), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); return { ratio: Math.round(ratio * 100) / 100, wcagAA: ratio >= 4.5, wcagAAA: ratio >= 7 };
}

function validateAnalyticsEvent(event: Record<string, unknown>, sig: string, secret: string): boolean { const exp = crypto.createHmac('sha256', secret).update(JSON.stringify(event)).digest('hex'); try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp)); } catch { return false; } }

interface EngagementMetrics { likes: number; views: number; messages: number; timeOnAppMinutes: number; }
function detectFakeEngagement(m: EngagementMetrics): { suspicious: boolean; signals: string[] } { const s: string[] = []; if (m.likes > 0 && m.views === 0) s.push('likes_without_views'); if (m.messages > 500 && m.timeOnAppMinutes < 10) s.push('impossible_message_rate'); if (m.likes / Math.max(m.views, 1) > 0.95) s.push('abnormal_like_rate'); return { suspicious: s.length > 0, signals: s }; }

const reqTs: Record<string, number[]> = {};
const BOT_UA = ['bot', 'crawler', 'spider', 'headless', 'phantomjs', 'puppeteer', 'selenium', 'playwright', 'curl', 'wget'];
function detectBotTraffic(ip: string, ua: string): { isBot: boolean; confidence: number; signals: string[] } { const s: string[] = [], now = Date.now(); if (!reqTs[ip]) reqTs[ip] = []; reqTs[ip] = reqTs[ip]!.filter(t => now - t < 1_000); reqTs[ip]!.push(now); if (reqTs[ip]!.length > 30) s.push('high_request_rate'); if (BOT_UA.some(p => ua.toLowerCase().includes(p))) s.push('bot_user_agent'); if (!ua || ua.length < 20) s.push('suspicious_ua'); return { isBot: s.length >= 1, confidence: Math.min(s.length / 3, 1), signals: s }; }

const convEvents: Record<string, number[]> = {};
function detectConversionFraud(userId: string, eventType: string, value: number): { fraudulent: boolean; reason?: string } { const k = `${userId}_${eventType}`, now = Date.now(); if (!convEvents[k]) convEvents[k] = []; convEvents[k] = convEvents[k]!.filter(t => now - t < 3_600_000); convEvents[k]!.push(now); const c = convEvents[k]!.length; if (c > 10) return { fraudulent: true, reason: `${c} ${eventType} in 1h` }; if (value < 0) return { fraudulent: true, reason: 'Negative value' }; return { fraudulent: false }; }

interface LERequest { requestType: 'MLAT' | 'emergency_disclosure' | 'subpoena' | 'court_order' | 'preservation'; requestingAgency: string; caseNumber: string; targetUserId?: string; dataCategories: string[]; legalBasis: string; emergencyJustification?: string; submittedBy: string; contactEmail: string; }
async function handleLawEnforcementRequest(req: LERequest, aUid: string): Promise<{ caseId: string; status: string; acknowledgedAt: string; nextSteps: string[] }> {
  const caseId = `LEA-${req.requestType}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, ack = new Date().toISOString(), isEm = req.requestType === 'emergency_disclosure' && !!req.emergencyJustification, sla = isEm ? 4 : req.requestType === 'MLAT' ? 168 : 72;
  await adminDb.collection('lawEnforcementRequests').doc(caseId).set({ caseId, ...req, status: 'received', isEmergency: isEm, slaHours: sla, acknowledgedAt: ack, receivedAt: admin.firestore.FieldValue.serverTimestamp(), processedBy: aUid });
  await logAdminAction(aUid, 'law_enforcement_request', req.targetUserId ?? 'platform', { caseId, requestType: req.requestType, agency: req.requestingAgency, isEmergency: isEm });
  return { caseId, status: 'received', acknowledgedAt: ack, nextSteps: isEm ? ['Emergency review within 4 hours', 'Legal team notified immediately', 'User data preserved'] : ['Legal team review within 72 hours', 'Verification of legal authority required', 'Response via secure channel'] };
}

interface TRData { periodStart: string; periodEnd: string; totalLERequests: number; requestsByType: Record<string, number>; requestsByCountry: Record<string, number>; dataDisclosed: number; dataRejected: number; emergencyDisclosures: number; governmentRemovals: number; ncmecReports: number; dsarRequests: number; dsarFulfilled: number; }
async function generateTransparencyReport(pStart: string, pEnd: string, aUid: string): Promise<{ reportId: string; data: TRData; generatedAt: string }> {
  const rid = `TR-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, gen = new Date().toISOString(), start = new Date(pStart), end = new Date(pEnd);
  try {
    const leSnap = await adminDb.collection('lawEnforcementRequests').where('receivedAt', '>=', start).where('receivedAt', '<=', end).get();
    const byType: Record<string, number> = {}, byCountry: Record<string, number> = {}; let disclosed = 0, rejected = 0, emergencies = 0;
    leSnap.docs.forEach(d => { const data = d.data(); const t = data['requestType'] as string, c = (data['requestingCountry'] as string) ?? 'unknown'; byType[t] = (byType[t] ?? 0) + 1; byCountry[c] = (byCountry[c] ?? 0) + 1; if (data['status'] === 'disclosed') disclosed++; if (data['status'] === 'rejected') rejected++; if (data['isEmergency']) emergencies++; });
    const ncmecSnap = await adminDb.collection('csamReports').where('timestamp', '>=', start).where('timestamp', '<=', end).get();
    const dsarSnap = await adminDb.collection('dsarRequests').where('submittedAt', '>=', start).where('submittedAt', '<=', end).get();
    const dsarF = dsarSnap.docs.filter(d => d.data()['status'] === 'fulfilled').length;
    const data: TRData = { periodStart: pStart, periodEnd: pEnd, totalLERequests: leSnap.size, requestsByType: byType, requestsByCountry: byCountry, dataDisclosed: disclosed, dataRejected: rejected, emergencyDisclosures: emergencies, governmentRemovals: 0, ncmecReports: ncmecSnap.size, dsarRequests: dsarSnap.size, dsarFulfilled: dsarF };
    await adminDb.collection('transparencyReports').doc(rid).set({ reportId: rid, ...data, generatedAt: gen, generatedBy: aUid, publishedAt: null, timestamp: admin.firestore.FieldValue.serverTimestamp() });
    await logAdminAction(aUid, 'transparency_report_generated', rid, { periodStart: pStart, periodEnd: pEnd });
    return { reportId: rid, data, generatedAt: gen };
  } catch { return { reportId: rid, generatedAt: gen, data: { periodStart: pStart, periodEnd: pEnd, totalLERequests: 0, requestsByType: {}, requestsByCountry: {}, dataDisclosed: 0, dataRejected: 0, emergencyDisclosures: 0, governmentRemovals: 0, ncmecReports: 0, dsarRequests: 0, dsarFulfilled: 0 } }; }
}

interface DsarReq { requestType: 'access' | 'deletion' | 'portability' | 'rectification' | 'restriction' | 'objection'; targetUserId: string; requesterEmail: string; jurisdiction: string; verificationMethod: string; notes?: string; }
async function handleDsarRequest(req: DsarReq, subUid: string): Promise<{ dsarId: string; slaDeadline: string; status: string }> {
  const dsarId = `DSAR-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, slaDays = req.jurisdiction === 'GDPR' ? 30 : req.jurisdiction === 'CCPA' ? 45 : 30, sla = new Date(Date.now() + slaDays * 24 * 60 * 60 * 1_000).toISOString();
  await adminDb.collection('dsarRequests').doc(dsarId).set({ dsarId, ...req, status: 'received', slaDeadline: sla, submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: subUid, auditTrail: [{ action: 'received', by: subUid, at: new Date().toISOString() }] });
  await logAdminAction(subUid, 'dsar_received', req.targetUserId, { dsarId, requestType: req.requestType, jurisdiction: req.jurisdiction });
  return { dsarId, slaDeadline: sla, status: 'received' };
}

async function logVulnerabilityReport(email: string, severity: 'low' | 'medium' | 'high' | 'critical', desc: string, endpoint?: string): Promise<{ reportId: string; cvssEstimate?: string }> {
  const rid = `VR-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, cvss: Record<string, string> = { low: '0.1-3.9', medium: '4.0-6.9', high: '7.0-8.9', critical: '9.0-10.0' };
  await adminDb.collection('vulnerabilityReports').add({ reportId: rid, reporterEmail: email, severity, description: desc, affectedEndpoint: endpoint ?? null, status: 'triaging', slaHours: { low: 168, medium: 72, high: 24, critical: 4 }[severity], cvssRange: cvss[severity], receivedAt: admin.firestore.FieldValue.serverTimestamp() });
  await logAdminAction('system', 'vulnerability_reported', rid, { severity, affectedEndpoint: endpoint });
  return { reportId: rid, cvssEstimate: cvss[severity] };
}

app.options('*', cors(CORS_OPTIONS));

app.post('/send-notification', notifLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => {
  try { const { subscription, title, body, screen } = req.body as Record<string, unknown>; const t = sanitize(title), b = sanitize(body); if (!isValidPushSub(subscription) || !t || !b) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; } if (!VAPID_EMAIL) { res.status(500).json({ success: false, reason: 'missing_vapid_config' }); return; } await webpush.sendNotification(subscription, JSON.stringify({ title: t, body: b, data: { screen: sanitize(screen) ?? 'home' } })); res.json({ success: true }); } catch (e) { const err = e as { statusCode?: number }; if (err.statusCode === 410 || err.statusCode === 404) { res.status(410).json({ success: false, reason: 'subscription_expired' }); return; } next(e); }
}));

app.post('/send-expo-notification', notifLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => {
  try { const { expoPushToken, title, body, screen } = req.body as Record<string, unknown>; const t = sanitize(title), b = sanitize(body); if (!isValidExpoToken(expoPushToken) || !t || !b) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; } const r = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ to: expoPushToken, sound: 'default', title: t, body: b, data: { screen: sanitize(screen) ?? 'home' } }) }); res.json({ success: r.ok, data: await r.json() }); } catch (e) { next(e); }
}));

app.post('/check-email', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const e = sanitize((req.body as Record<string, unknown>)['email'], 254); if (!e) { res.status(400).json({ success: false, reason: 'missing_email' }); return; } const d = isDisposableEmail(e); res.json({ success: true, disposable: d, allowed: !d }); } catch (e) { next(e); } }));

app.post('/check-password-breach', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { password } = req.body as Record<string, unknown>; if (typeof password !== 'string' || password.length < 6) { res.status(400).json({ success: false, reason: 'invalid_password' }); return; } res.json({ success: true, ...(await isPasswordBreached(password)) }); } catch (e) { next(e); } }));

app.post('/register-device', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => {
  try { const id = uid(req); const fp = ((req.headers['x-device-fingerprint'] as string) ?? (req.body as Record<string, unknown>)['fingerprint'] ?? '') as string; if (!fp || fp.length < 8) { res.status(400).json({ success: false, reason: 'invalid_fingerprint' }); return; } const d = await trackDeviceFingerprint(fp, id); const m = await checkMultiAccountDevice(fp, id); if (m.bannedReuse) await logAdminAction('system', 'banned_device_reuse', id, { fingerprint: fp, accounts: m.accounts }); res.json({ success: true, knownDevice: d.knownDevice, multiAccount: m.multiAccount, bannedReuse: m.bannedReuse }); } catch (e) { next(e); }
}));

app.post('/login-track', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => {
  try { const id = uid(req); const { sessionId, fingerprint } = req.body as Record<string, unknown>; const ip = clientIp(req); const ato = await detectAccountTakeover(id, (fingerprint as string) ?? '', ip); if (ato.suspicious) await logAdminAction('system', 'ato_suspicious', id, { reason: ato.reason, ip }); const sess = sessionId ? await checkConcurrentSessions(id, sessionId as string) : { allowed: true, activeSessions: 1 }; res.json({ success: true, atoSuspicious: ato.suspicious, sessionAllowed: sess.allowed, activeSessions: sess.activeSessions }); } catch (e) { next(e); }
}));

app.post('/check-device-integrity', authLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const r = checkDeviceIntegrity(((req.body as Record<string, unknown>)['deviceInfo'] ?? {}) as DeviceInfo); if (r.isRooted || r.hasFrida || r.isEmulator) await logAdminAction('system', 'device_integrity_fail', uid(req), { flags: r.flags }); res.json({ success: true, ...r }); } catch (e) { next(e); } }));

app.post('/validate-location', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => {
  try { const id = uid(req); const { lat, lon, timestamp, countryCode } = req.body as Record<string, unknown>; if (typeof lat !== 'number' || typeof lon !== 'number') { res.status(400).json({ success: false, reason: 'invalid_coordinates' }); return; } if (countryCode && isSanctioned(countryCode as string)) { res.status(403).json({ success: false, reason: 'region_not_supported' }); return; }
    const ts = (timestamp as number) ?? Date.now(); let impossible = false, speedKmH = 0;
    try { const prev = await adminDb.collection('userLocations').doc(id).get(); if (prev.exists) { const p = prev.data()!; const c = checkGeoImpossibility(p['lat'], p['lon'], p['timestamp'], lat, lon, ts); impossible = c.impossible; speedKmH = c.speedKmH; } await adminDb.collection('userLocations').doc(id).set({ lat, lon, timestamp: ts, countryCode: countryCode ?? '' }); } catch {}
    const ip = clientIp(req); const ipM = await checkIPGPSMismatch(ip, lat, lon); const chk = await checkImpossibleCheckin(id, lat, lon, ts); const vpn = await detectVPNProxy(req);
    res.json({ success: true, impossible, speedKmH, ipMismatch: ipM.mismatch, impossibleCheckin: chk.impossible, isProxy: vpn.isProxy, isTor: vpn.isTor }); } catch (e) { next(e); }
}));

app.post('/moderate-text', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const t = sanitize((req.body as Record<string, unknown>)['text'], 5_000); if (!t) { res.status(400).json({ success: false, reason: 'missing_text' }); return; } const r = serverCheckText(t); if (!r.safe) await logAdminAction('system', 'text_flagged', uid(req), { category: r.category, preview: t.slice(0, 100) }); res.json({ success: true, safe: r.safe, category: r.category }); } catch (e) { next(e); } }));

app.post('/scan-csam', modLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res, next) => {
  try { const id = uid(req); const { imageUrl } = req.body as Record<string, unknown>; if (!imageUrl) { res.status(400).json({ success: false, reason: 'missing_url' }); return; } const scan = await scanForCSAM(imageUrl as string); if (scan.isCSAM) { const rpt = await reportToNCMEC({ imageUrl: imageUrl as string, userId: id, reporterUid: 'system' }); await logAdminAction('system', 'csam_detected', id, { imageUrl, tiplineId: rpt.tiplineId }); res.json({ success: true, isCSAM: true, reported: rpt.success, tiplineId: rpt.tiplineId }); return; } res.json({ success: true, isCSAM: false }); } catch (e) { next(e); }
}));

app.post('/age-gate-check', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { res.json({ success: true, ...(await enforceAgeGatedContent(uid(req), ((req.body as Record<string, unknown>)['contentType'] as string) ?? 'explicit')) }); } catch (e) { next(e); } }));

app.post('/dmca-takedown', webhookLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res, next) => {
  try { const { contentUrl, reporterEmail, copyrightOwner, workDescription } = req.body as Record<string, unknown>; if (!contentUrl || !reporterEmail) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; } const caseId = `DMCA-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; await adminDb.collection('dmcaNotices').add({ caseId, contentUrl, reporterEmail, copyrightOwner, workDescription, status: 'received', receivedAt: admin.firestore.FieldValue.serverTimestamp() }); await logAdminAction('system', 'dmca_takedown', uid(req), { caseId, contentUrl }); res.json({ success: true, caseId }); } catch (e) { next(e); }
}));

app.post('/log-screenshot', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { await logScreenshotEvent(uid(req), ((req.body as Record<string, unknown>)['screen'] as string) ?? 'unknown'); res.json({ success: true }); } catch (e) { next(e); } }));

app.post('/share-meeting-location', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { lat, lon, trustedContactId } = req.body as Record<string, unknown>; if (typeof lat !== 'number' || typeof lon !== 'number' || !trustedContactId) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; } res.json({ success: true, ...(await createMeetingLocationShare(uid(req), lat, lon, trustedContactId as string)) }); } catch (e) { next(e); } }));

app.post('/enforce-trust', webhookLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res, next) => { try { const { targetUid } = req.body as Record<string, unknown>; if (!targetUid) { res.status(400).json({ success: false, reason: 'missing_uid' }); return; } res.json({ success: true, ...(await enforceTrustThreshold(targetUid as string)) }); } catch (e) { next(e); } }));

app.post('/check-url', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const u = sanitize((req.body as Record<string, unknown>)['url'], 2_048); if (!u) { res.status(400).json({ success: false, reason: 'missing_url' }); return; } res.json({ success: true, ...(await checkUrlSafety(u)) }); } catch (e) { next(e); } }));

app.post('/screen-name', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const n = sanitize((req.body as Record<string, unknown>)['name'], 200); if (!n) { res.status(400).json({ success: false, reason: 'missing_name' }); return; } const f = screenSanctionsName(n); if (f) await logAdminAction('system', 'sanctions_match', uid(req), { name: n }); res.json({ success: true, flagged: f }); } catch (e) { next(e); } }));

app.post('/pdq-cross-account', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { photoUrl } = req.body as Record<string, unknown>; if (!photoUrl) { res.status(400).json({ success: false, reason: 'missing_url' }); return; } const r = await checkCrossAccountPDQ(photoUrl as string, uid(req)); if (r.isDuplicate) await logAdminAction('system', 'cross_account_duplicate', uid(req), { matchedUserId: r.matchedUserId }); res.json({ success: true, ...r }); } catch (e) { next(e); } }));

app.post('/check-cib', webhookLimiter, validateOrigin, requireAuth, verifyHMAC, asyncHandler(async (req, res, next) => { try { const { userIds } = req.body as Record<string, unknown>; if (!Array.isArray(userIds)) { res.status(400).json({ success: false, reason: 'missing_userIds' }); return; } const r = await detectCoordinatedInauthentic(userIds as string[]); if (r.detected) await logAdminAction('system', 'cib_detected', 'system', { clusterSize: r.clusterSize, userIds }); res.json({ success: true, ...r }); } catch (e) { next(e); } }));

app.post('/ab-test', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { experimentId, claimedVariant, variants } = req.body as Record<string, unknown>; if (!experimentId || !variants) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; } const a = assignABTest(uid(req), experimentId as string, variants as string[]); const v = !claimedVariant || validateABTestIntegrity(uid(req), experimentId as string, claimedVariant as string, variants as string[]); res.json({ success: true, variant: a, valid: v }); } catch (e) { next(e); } }));

app.post('/admin/rotate-key', webhookLimiter, validateOrigin, requireAuth, requireAdmin, verifyHMAC, asyncHandler(async (req, res, next) => { try { const { service } = req.body as Record<string, unknown>; if (!service) { res.status(400).json({ success: false, reason: 'missing_service' }); return; } const r = await rotateApiKey(service as string); await logAdminAction(uid(req), 'key_rotation', service as string, { rotatedAt: Date.now() }); res.json({ success: r.success }); } catch (e) { next(e); } }));

app.post('/wcag-audit', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { violations } = req.body as Record<string, unknown>; if (!Array.isArray(violations)) { res.status(400).json({ success: false, reason: 'missing_violations' }); return; } res.json({ success: true, ...auditWCAG(violations as Array<{ id: string; impact: string }>) }); } catch (e) { next(e); } }));

app.post('/check-contrast', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { foreground, background } = req.body as Record<string, unknown>; if (!foreground || !background) { res.status(400).json({ success: false, reason: 'missing_colors' }); return; } res.json({ success: true, ...checkColorContrast(foreground as string, background as string) }); } catch (e) { next(e); } }));

app.post('/validate-event', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { event, signature } = req.body as Record<string, unknown>; if (!event || !signature) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; } res.json({ success: true, valid: validateAnalyticsEvent(event as Record<string, unknown>, signature as string, process.env['ANALYTICS_HMAC_SECRET'] ?? HMAC_SECRET) }); } catch (e) { next(e); } }));

app.post('/check-engagement', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { metrics } = req.body as Record<string, unknown>; if (!metrics) { res.status(400).json({ success: false, reason: 'missing_metrics' }); return; } const r = detectFakeEngagement(metrics as EngagementMetrics); if (r.suspicious) await logAdminAction('system', 'fake_engagement', uid(req), { signals: r.signals }); res.json({ success: true, ...r }); } catch (e) { next(e); } }));

app.post('/check-bot', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { res.json({ success: true, ...detectBotTraffic(clientIp(req), (req.headers['user-agent'] as string) ?? '') }); } catch (e) { next(e); } }));

app.post('/track-conversion', modLimiter, validateOrigin, requireAuth, asyncHandler(async (req, res, next) => { try { const { eventType, value } = req.body as Record<string, unknown>; if (!eventType) { res.status(400).json({ success: false, reason: 'missing_event_type' }); return; } const r = detectConversionFraud(uid(req), eventType as string, (value as number) ?? 0); if (r.fraudulent) await logAdminAction('system', 'conversion_fraud', uid(req), { eventType, reason: r.reason }); res.json({ success: true, ...r }); } catch (e) { next(e); } }));

app.post('/admin/action', webhookLimiter, validateOrigin, requireAuth, requireAdmin, verifyHMAC, asyncHandler(async (req, res, next) => { try { const { action, target, details } = req.body as Record<string, unknown>; if (!action || !target) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; } await logAdminAction(uid(req), action as string, target as string, details as Record<string, unknown>); res.json({ success: true }); } catch (e) { next(e); } }));

app.post('/admin/law-enforcement-request', legalLimiter, validateOrigin, requireAuth, requireAdmin, verifyHMAC, asyncHandler(async (req, res, next) => { try { const b = req.body as Record<string, unknown>; const { requestType, requestingAgency, caseNumber, dataCategories, legalBasis, contactEmail } = b; if (!requestType || !requestingAgency || !caseNumber || !dataCategories || !legalBasis || !contactEmail) { res.status(400).json({ success: false, reason: 'missing_required_fields' }); return; } res.json({ success: true, ...(await handleLawEnforcementRequest(b as unknown as LERequest, uid(req))) }); } catch (e) { next(e); } }));

app.post('/admin/transparency-report', legalLimiter, validateOrigin, requireAuth, requireAdmin, verifyHMAC, asyncHandler(async (req, res, next) => { try { const { periodStart, periodEnd } = req.body as Record<string, unknown>; if (!periodStart || !periodEnd) { res.status(400).json({ success: false, reason: 'missing_period' }); return; } res.json({ success: true, ...(await generateTransparencyReport(periodStart as string, periodEnd as string, uid(req))) }); } catch (e) { next(e); } }));

app.post('/admin/dsar', dsarLimiter, validateOrigin, requireAuth, requireAdmin, verifyHMAC, asyncHandler(async (req, res, next) => { try { const b = req.body as Record<string, unknown>; const { requestType, targetUserId, requesterEmail, jurisdiction, verificationMethod } = b; if (!requestType || !targetUserId || !requesterEmail || !jurisdiction || !verificationMethod) { res.status(400).json({ success: false, reason: 'missing_required_fields' }); return; } res.json({ success: true, ...(await handleDsarRequest(b as unknown as DsarReq, uid(req))) }); } catch (e) { next(e); } }));

app.post('/security/report', legalLimiter, validateOrigin, asyncHandler(async (req, res, next) => { try { const { reporterEmail, severity, description, affectedEndpoint } = req.body as Record<string, unknown>; if (!reporterEmail || !severity || !description) { res.status(400).json({ success: false, reason: 'missing_fields' }); return; } if (!['low', 'medium', 'high', 'critical'].includes(severity as string)) { res.status(400).json({ success: false, reason: 'invalid_severity' }); return; } const r = await logVulnerabilityReport(reporterEmail as string, severity as 'low' | 'medium' | 'high' | 'critical', sanitize(description, 5_000) ?? '', affectedEndpoint as string | undefined); res.json({ success: true, ...r, message: 'Thank you for your report. Our security team will review it promptly.' }); } catch (e) { next(e); } }));

app.get('/health', healthLimiter, (_req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString(), detectors: 'active', minTLS: TLS_INFO.min, tlsVersions: TLS_INFO.supported }); });

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => { if (process.env['NODE_ENV'] !== 'production') process.stderr.write(`[server error] ${String(err)}\n`); if (!res.headersSent) res.status(500).json({ success: false, reason: 'internal_error' }); });

const PORT = Number(process.env['PORT'] ?? 3_000);
if (process.env['NODE_ENV'] !== 'production') app.listen(PORT, () => {});
export default app;