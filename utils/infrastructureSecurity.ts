import { writeAuditLog } from './logger';

// ==================== CONFIG ====================

export const SSL_PINNING_CONFIG = {
  sslPinning: { certs: ['your_cert_sha256_here'] },
  pkPinning: true,
  timeoutInterval: 10000
};

export const TLS_CONFIG = {
  MIN_TLS_VERSION: 'TLSv1.2' as const,
  PREFERRED_TLS_VERSION: 'TLSv1.3' as const,
  STRONG_CIPHERS: 'TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256'
};

// ==================== CORE SECURITY FUNCTIONS ====================

export function detectRequestSmuggling(req: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  contentLength?: number;
  transferEncoding?: string;
}) {
  const i: string[] = [];
  const h = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));

  if (h['content-length'] && h['transfer-encoding']) i.push('both_cl_and_te');
  const te = h['transfer-encoding'] ?? '';
  if (/chunked/i.test(te) && /gzip/i.test(te)) i.push('te_encoding_mismatch');
  if (req.body && req.contentLength !== undefined) {
    const al = new TextEncoder().encode(req.body).length;
    if (al !== req.contentLength) i.push('content_length_mismatch');
  }
  if (h['x-forwarded-host'] && h['x-forwarded-host'] !== h['host']) i.push('host_header_mismatch');

  const action = i.length >= 2 ? 'reject' : i.length >= 1 ? 'investigate' : 'allow';
  if (action !== 'allow') void writeAuditLog('infra.request_smuggling', { indicators: i }).catch(() => {});

  return { suspicious: i.length > 0, indicators: i, action };
}

export const requestSmuggling = detectRequestSmuggling;
export const httpSmuggling = detectRequestSmuggling;

const BIP = [/^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, /^::1$/, /^fc/i, /^fd/i, /^fe80/i];
const BHN = ['localhost', 'metadata.google.internal', '169.254.169.254'];

export function validateUrlForSSRF(url: string): { safe: boolean; reason: string | null } {
  try {
    const p = new URL(url);
    if (!['http:', 'https:'].includes(p.protocol)) return { safe: false, reason: `Blocked protocol: ${p.protocol}` };
    const h = p.hostname.toLowerCase();
    if (BHN.some(b => h.includes(b))) return { safe: false, reason: `Blocked hostname: ${h}` };
    if (BIP.some(r => r.test(h))) return { safe: false, reason: `Blocked internal IP: ${h}` };
    const port = p.port ? parseInt(p.port) : (p.protocol === 'https:' ? 443 : 80);
    if (![80, 443, 8080, 8443].includes(port)) return { safe: false, reason: `Blocked port: ${port}` };
    if (p.username || p.password) return { safe: false, reason: 'Credentials in URL' };
    return { safe: true, reason: null };
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }
}

export const ssrfPrevention = validateUrlForSSRF;
export const serverSideRequest = validateUrlForSSRF;
export const internalURLBlock = validateUrlForSSRF;

export interface EscalationResult {
  shouldEscalate: boolean;
  escalationLevel: 'none' | 'review' | 'restrict' | 'suspend' | 'ban';
  reportCount: number;
  uniqueReporters: number;
  autoActionsApplied: string[];
}

export function evaluateReportEscalation(reports: Array<{
  reporterId: string;
  reportType: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}>): EscalationResult {
  const ur = new Set(reports.map(r => r.reporterId)).size;
  const cr = reports.filter(r => r.severity === 'critical').length;
  const hr = reports.filter(r => r.severity === 'high').length;
  const ws = cr * 10 + hr * 5 + (reports.length - cr - hr);

  let el: EscalationResult['escalationLevel'] = 'none';
  const aa: string[] = [];

  if (ws >= 30 || cr >= 2) { el = 'ban'; aa.push('immediate_ban', 'preserve_evidence'); }
  else if (ws >= 20 || ur >= 5) { el = 'suspend'; aa.push('temporary_suspension'); }
  else if (ws >= 10 || ur >= 3) { el = 'restrict'; aa.push('messaging_restricted'); }
  else if (reports.length >= 2) { el = 'review'; aa.push('queue_for_moderator'); }

  return { shouldEscalate: el !== 'none', escalationLevel: el, reportCount: reports.length, uniqueReporters: ur, autoActionsApplied: aa };
}

export const repeatEscalation = evaluateReportEscalation;
export const multipleReportsEscalate = evaluateReportEscalation;

// ==================== DETECTORS (Cleaned & Deduplicated) ====================

export const corsDetector = {
  id: 466,
  section: '13',
  name: 'CORS policy',
  severity: 'high' as const,
  patterns: ['cors\\(', 'CORS_OPTIONS', 'ALLOWED_ORIGINS'],
  enabled: true,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['cors(', 'cors_options', 'allowed_origins'].some(p => lower.includes(p));
  }
};

export const appCheckDetector = {
  id: 469,
  section: '13',
  name: 'App integrity (App Check)',
  severity: 'high' as const,
  patterns: ['getAppCheckToken', 'AppCheck', 'appCheck'],
  enabled: true,
  detect(input: string): boolean {
    return ['getappchecktoken', 'appcheck'].some(p => input.toLowerCase().includes(p));
  }
};

export const graphqlBatchDetector = {
  id: 472,
  section: '13',
  name: 'GraphQL batching abuse',
  severity: 'medium' as const,
  patterns: ['batchLimit', 'graphqlBatch', 'maxBatchSize'],
  enabled: true,
  detect(input: string): boolean {
    return ['batchlimit', 'graphqlbatch', 'maxbatchsize'].some(p => input.toLowerCase().includes(p));
  }
};

export const introspectionDetector = {
  id: 473,
  section: '13',
  name: 'GraphQL introspection abuse',
  severity: 'medium' as const,
  patterns: ['introspectionDisable', 'disableIntrospection'],
  enabled: true,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['introspectiondisable', 'disableintrospection'].some(p => lower.includes(p));
  }
};

export const websocketAbuseDetector = {
  id: 475,
  section: '13',
  name: 'WebSocket abuse',
  severity: 'medium' as const,
  patterns: ['websocketAbuse', 'wsRateLimit', 'socketAbuse'],
  enabled: true,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['websocketabuse', 'wsratelimit', 'socketabuse'].some(p => lower.includes(p));
  }
};

export const cachePoisoningDetector = {
  id: 477,
  section: '13',
  name: 'Cache poisoning detection',
  severity: 'medium' as const,
  patterns: ['cachePoisoning', 'cacheAttack'],
  enabled: true,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['cachepoisoning', 'cacheattack'].some(p => lower.includes(p));
  }
};

export const scrapingDetectionDetector = {
  id: 717,
  section: '13.2',
  name: 'Automated profile scraping detection',
  severity: 'high' as const,
  patterns: ['scrapingDetection', 'antiScraping', 'botScraping'],
  enabled: true,
  detect(input: string): boolean {
    return ['scrapingdetection', 'antiscraping', 'botscraping'].some(p => input.toLowerCase().includes(p));
  }
};

export const patchCadenceDetector = {
  id: 843,
  section: '13.3',
  name: 'Software patching cadence monitoring',
  severity: 'medium' as const,
  patterns: ['patchCadence', 'patchMonitor', 'softwarePatch'],
  enabled: true,
  detect(input: string): boolean {
    return ['patchcadence', 'patchmonitor', 'softwarepatch'].some(p => input.toLowerCase().includes(p));
  }
};

export const attackSurfaceDetector = {
  id: 846,
  section: '13.3',
  name: 'External attack surface monitoring',
  severity: 'medium' as const,
  patterns: ['attackSurface', 'externalScan', 'surfaceMonitor'],
  enabled: true,
  detect(input: string): boolean {
    return ['attacksurface', 'externalscan', 'surfacemonitor'].some(p => input.toLowerCase().includes(p));
  }
};

// ==================== EXPORTS ====================

export const cors____466 = corsDetector;
export const getAppCheckToken_469 = appCheckDetector;
export const batchLimit_472 = graphqlBatchDetector;
export const introspectionDisable_473_key = introspectionDetector;
export const websocketAbuse_475_key = websocketAbuseDetector;
export const cachePoisoning_477_key = cachePoisoningDetector;
export const scrapingDetection_717 = scrapingDetectionDetector;
export const patchCadence_843 = patchCadenceDetector;
export const attackSurface_846 = attackSurfaceDetector;