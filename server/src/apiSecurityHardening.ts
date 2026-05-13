import crypto from 'crypto';
import type express from 'express';

export const PROFILE_FIELD_ACL = {
  displayName:   { sensitivity: 'public',    ttl: 0,         rateLimit: 1000 },
  age:           { sensitivity: 'public',    ttl: 0,         rateLimit: 1000 },
  photos:        { sensitivity: 'public',    ttl: 0,         rateLimit: 500  },
  exactLocation: { sensitivity: 'match_only',ttl: 3600*24,   rateLimit: 10   },
  phoneNumber:   { sensitivity: 'private',   ttl: 0,         rateLimit: 5    },
  email:         { sensitivity: 'private',   ttl: 0,         rateLimit: 0,   neverExpose: true },
  realName:      { sensitivity: 'match_only',ttl: 3600*72,   rateLimit: 20   },
  workLocation:  { sensitivity: 'match_only',ttl: 3600*24,   rateLimit: 10   },
  dateOfBirth:   { sensitivity: 'private',   ttl: 0,         rateLimit: 0,   neverExpose: true },
  deviceIds:     { sensitivity: 'private',   ttl: 0,         rateLimit: 0,   neverExpose: true },
  ipHistory:     { sensitivity: 'private',   ttl: 0,         rateLimit: 0,   neverExpose: true },
} as const;

export function enforceProfileFieldACL(
  profileData: Record<string, unknown>,
  requesterId: string,
  profileOwner: string,
  context: { isMatched: boolean; isPremium: boolean; matchAgeMs?: number }
): Record<string, unknown> {
  if (requesterId === profileOwner) return profileData;
  return Object.fromEntries(
    Object.entries(profileData).filter(([field]) => {
      const acl = PROFILE_FIELD_ACL[field];
      if (!acl || acl.neverExpose) return !acl?.neverExpose;
      if (acl.rateLimit === 0) return false;
      if (acl.sensitivity === 'match_only' && !context.isMatched) return false;
      if (acl.ttl > 0 && context.matchAgeMs && context.matchAgeMs > acl.ttl * 1000) return false;
      return true;
    })
  );
}

const ID_SECRET = process.env.ID_OBFUSCATION_SECRET ?? 'fallback-change-in-prod';
export function obfuscateUserId(id: string, requester: string): string {
  return crypto.createHmac('sha256', ID_SECRET).update(`${id}:${requester}`).digest('hex').slice(0, 16);
}
export class ObfuscatedIdRegistry {
  private map = new Map<string, string>();
  register(id: string, req: string): string { const o = obfuscateUserId(id, req); this.map.set(o, id); return o; }
  resolve(o: string): string | null { return this.map.get(o) ?? null; }
}

export class BulkFetchDetector {
  private windows = new Map<string, { reqs: number; since: number; ids: Set<string>; ips: Set<string> }>();
  private readonly WIN_MS = 60_000;
  private readonly MAX_REQ = 50;
  private readonly MAX_UNIQUE = 30;

  isAbusive(userId: string, profileId: string, ip: string): { abusive: boolean; score: number; reason?: string } {
    const now = Date.now();
    const key = `${userId}:bulk`;
    let w = this.windows.get(key);
    if (!w || now - w.since > this.WIN_MS) w = { reqs: 0, since: now, ids: new Set(), ips: new Set() };

    w.reqs++; w.ids.add(profileId); w.ips.add(ip);
    this.windows.set(key, w);

    const score = (w.reqs / this.MAX_REQ) * 0.4 + (w.ids.size / this.MAX_UNIQUE) * 0.4 + (w.ips.size > 1 ? 0.2 : 0);
    if (w.reqs > this.MAX_REQ) return { abusive: true, score, reason: `${w.reqs} reqs/60s` };
    if (w.ids.size > this.MAX_UNIQUE) return { abusive: true, score, reason: `${w.ids.size} unique profiles/60s` };
    if (score > 0.8) return { abusive: true, score, reason: 'high scraping probability' };
    return { abusive: false, score };
  }
  getStats(uid: string) { const w = this.windows.get(`${uid}:bulk`); return { reqs: w?.reqs ?? 0, unique: w?.ids.size ?? 0 }; }
}

export function enforceQueryDepth(q: Record<string, unknown>, max = 3, depth = 0): { allowed: boolean; depth: number } {
  if (depth > max) return { allowed: false, depth };
  let d = depth;
  for (const v of Object.values(q)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r = enforceQueryDepth(v as Record<string, unknown>, max, depth + 1);
      if (!r.allowed) return r;
      if (r.depth > d) d = r.depth;
    }
  }
  return { allowed: true, depth: d };
}

export function securityHeadersMiddleware(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://res.cloudinary.com data:; connect-src 'self' https://firestore.googleapis.com wss://; script-src 'self'; style-src 'self' 'unsafe-inline';");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

const INTERNAL = new Set(['passwordHash','salt','internalNotes','trustScoreHistory','moderationFlags','ipHistory','deviceIds','adminNotes','bannedAt','autoBan','shadowBanned','_firestore']);
export function sanitizeApiResponse(d: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).filter(([k]) => !INTERNAL.has(k) && !k.startsWith('_')));
}

export type AnomalySignal = {
  type: 'sequential_id_scan'|'credential_stuffing'|'bulk_download'|'geolocation_probing'|'automation_fingerprint'|'parameter_tampering'|'rate_limit_probing';
  userId?: string; ip: string; severity: 'low'|'medium'|'high'|'critical'; blockRecommended: boolean; evidence?: string;
};
export function detectApiAnomaly(logs: { ip: string; userId?: string; endpoint: string; timestamp: number; responseCode: number }[]): AnomalySignal[] {
  const byIp = new Map<string, typeof logs>();
  for (const l of logs) { const a = byIp.get(l.ip) ?? []; a.push(l); byIp.set(l.ip, a); }
  const sigs: AnomalySignal[] = [];
  for (const [ip, reqs] of byIp) {
    const n = reqs.length; if (!n) continue;
    const fails = reqs.filter(r => r.responseCode === 401 || r.responseCode === 403).length;
    if (fails > 20) sigs.push({ type:'credential_stuffing', ip, severity:'high', blockRecommended:true, evidence:`${fails} auth fails` });
    const profs = reqs.filter(r => r.endpoint.includes('/profile/')).length;
    if (profs > 100) sigs.push({ type:'sequential_id_scan', ip, severity:'critical', blockRecommended:true, evidence:`${profs} profile hits` });
    const eps = new Set(reqs.map(r => r.endpoint));
    if (eps.size > 80 && n > 200) sigs.push({ type:'bulk_download', ip, severity:'high', blockRecommended:true, evidence:`${eps.size} endpoints` });
    const geo = reqs.filter(r => /location|geo/i.test(r.endpoint)).length;
    if (geo > 50) sigs.push({ type:'geolocation_probing', ip, severity:'medium', blockRecommended:false, evidence:`${geo} geo reqs` });
    if (n > 10) {
      const ints = reqs.slice(1).map((r,i) => r.timestamp - reqs[i]!.timestamp);
      const avg = ints.reduce((a,b)=>a+b,0)/ints.length;
      const sd = Math.sqrt(ints.reduce((a,b)=>a+(b-avg)**2,0)/ints.length);
      if (sd < 50 && n > 50) sigs.push({ type:'automation_fingerprint', ip, severity:'high', blockRecommended:true, evidence:`StdDev=${sd.toFixed(1)}ms` });
    }
    const r429 = reqs.filter(r=>r.responseCode===429).length;
    if (r429>5) sigs.push({ type:'rate_limit_probing', ip, severity:'medium', blockRecommended:false, evidence:`${r429} 429s` });
    const r400 = reqs.filter(r=>r.responseCode===400).length;
    if (r400>30) sigs.push({ type:'parameter_tampering', ip, severity:'medium', blockRecommended:false, evidence:`${r400} 400s` });
  }
  return sigs;
}

export function enforcePagination(page: number, perPage: number, max = 20) {
  if (page<1) return { page:1, perPage:max, offset:0, valid:false, reason:'page>=1' };
  if (perPage>max) return { page, perPage:max, offset:(page-1)*max, valid:false, reason:`capped@${max}` };
  if (perPage<1) return { page, perPage:10, offset:(page-1)*10, valid:false, reason:'perPage>=1' };
  return { page, perPage, offset:(page-1)*perPage, valid:true };
}

export function auditSensitiveAccess(endpoint: string, userId: string, ip: string, success: boolean, dataTypes: string[]) {
  const id = `AUDIT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  process.stdout.write(JSON.stringify({ severity:'AUDIT', auditId:id, endpoint, userId, ip, success, dataTypes, ts: new Date().toISOString() })+'\n');
  return { auditId: id, logged: true };
}

export function injectHoneypotField(p: Record<string, unknown>): Record<string, unknown> { return { ...p, _h: crypto.randomBytes(4).toString('hex') }; }
export function detectHoneypotAccess(fields: string[]): boolean { return fields.includes('_h'); }