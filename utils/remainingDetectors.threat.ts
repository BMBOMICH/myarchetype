import { writeAuditLog } from './logger';

const API = process.env['EXPO_PUBLIC_API_URL'] ?? '';
const safeFetch = async <T>(ep: string, body?: unknown, t = 8000): Promise<T | null> => {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), t);
  try {
    const r = await fetch(`${API}${ep}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: c.signal,
    });
    if (!r.ok) return null;
    return r.json() as T;
  } catch { return null; }
  finally { clearTimeout(id); }
};

export interface ThreatIntelFeedResult {
  threat: boolean;
  threatType?: string;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  sources: string[];
  indicators: string[];
  iocMatched: boolean;
  recommendedAction: string;
}

export async function checkThreatIntelFeed(
  indicator: { ip?: string; domain?: string; emailHash?: string; fileHash?: string; url?: string }
): Promise<ThreatIntelFeedResult> {
  const sevOrder = ['none', 'low', 'medium', 'high', 'critical'];
  const results = await Promise.all([
    safeFetch<{ threat?: boolean; type?: string; severity?: string; indicators?: string[] }>('/threat/misp', { indicator }),
    safeFetch<{ threat?: boolean; type?: string; severity?: string; indicators?: string[] }>('/threat/opencti', { indicator }),
    indicator.ip
      ? safeFetch<{ threat?: boolean; abuseScore?: number; categories?: string[] }>('/threat/abuseipdb', { ip: indicator.ip })
      : Promise.resolve(null),
  ]);
  const [misp, opencti, abuseipdb] = results;
  const sources: string[] = [];
  const inds: string[] = [];
  let threat = false;
  let maxSev: ThreatIntelFeedResult['severity'] = 'none';
  let threatType: string | undefined;

  if (misp?.threat) {
    threat = true; sources.push('MISP'); inds.push(...(misp.indicators ?? []));
    threatType = misp.type;
    const s = (misp.severity ?? 'medium') as typeof maxSev;
    if (sevOrder.indexOf(s) > sevOrder.indexOf(maxSev)) maxSev = s;
  }
  if (opencti?.threat) {
    threat = true; sources.push('OpenCTI'); inds.push(...(opencti.indicators ?? []));
    threatType = threatType ?? opencti.type;
    const s = (opencti.severity ?? 'medium') as typeof maxSev;
    if (sevOrder.indexOf(s) > sevOrder.indexOf(maxSev)) maxSev = s;
  }
  if (abuseipdb?.threat || (abuseipdb?.abuseScore ?? 0) >= 50) {
    threat = true; sources.push('AbuseIPDB');
    inds.push(`abuse_score:${abuseipdb?.abuseScore ?? 0}`, ...(abuseipdb?.categories ?? []));
    if (sevOrder.indexOf('high') > sevOrder.indexOf(maxSev)) maxSev = 'high';
  }
  if (threat) writeAuditLog('threat.intel_match', { sources, severity: maxSev, threatType: threatType ?? 'unknown' }).catch(() => {});
  return {
    threat,
    ...(threatType !== undefined ? { threatType } : {}),
    severity: maxSev,
    sources,
    indicators: [...new Set(inds)],
    iocMatched: threat,
    recommendedAction: maxSev === 'critical'
      ? 'BLOCK immediately. Preserve evidence. Notify security team.'
      : maxSev === 'high' ? 'Restrict access. Flag for immediate review.'
      : maxSev === 'medium' ? 'Flag for review. Increase monitoring.'
      : threat ? 'Monitor closely.' : 'No action required.',
  };
}

export const threatIntelFeed = checkThreatIntelFeed;
export const mispCheck = checkThreatIntelFeed;
export const abuseIPDB = checkThreatIntelFeed;
export const openCTI = checkThreatIntelFeed;

export interface STIXIndicatorResult {
  matched: boolean;
  indicatorId: string | null;
  pattern: string | null;
  confidence: number;
  tlp: 'white' | 'green' | 'amber' | 'red';
}

export async function matchSTIXIndicator(
  value: string,
  type: 'ip' | 'domain' | 'email' | 'hash' | 'url'
): Promise<STIXIndicatorResult> {
  const r = await safeFetch<{ matched?: boolean; indicatorId?: string; pattern?: string; confidence?: number; tlp?: string }>('/threat/stix', { value, type });
  if (!r?.matched) return { matched: false, indicatorId: null, pattern: null, confidence: 0, tlp: 'white' };
  writeAuditLog('threat.stix_match', { indicatorId: r.indicatorId ?? 'unknown', type, tlp: r.tlp ?? 'amber' }).catch(() => {});
  return {
    matched: true,
    indicatorId: r.indicatorId ?? null,
    pattern: r.pattern ?? null,
    confidence: r.confidence ?? 0.8,
    tlp: (r.tlp ?? 'amber') as STIXIndicatorResult['tlp'],
  };
}

export const stixMatch = matchSTIXIndicator;
export const taxiiIndicator = matchSTIXIndicator;

export interface IOCBlocklistResult {
  blocked: boolean;
  listName: string | null;
  addedAt: string | null;
  reason: string | null;
}

const LOCAL_IOC_CACHE = new Map<string, { listName: string; addedAt: string; reason: string }>();

export function checkLocalIOCBlocklist(value: string): IOCBlocklistResult {
  const entry = LOCAL_IOC_CACHE.get(value);
  if (entry) return { blocked: true, listName: entry.listName, addedAt: entry.addedAt, reason: entry.reason };
  return { blocked: false, listName: null, addedAt: null, reason: null };
}

export function addToIOCBlocklist(value: string, listName: string, reason: string): void {
  LOCAL_IOC_CACHE.set(value, { listName, addedAt: new Date().toISOString(), reason });
  writeAuditLog('threat.ioc_added', { value: value.substring(0, 16), listName, reason }).catch(() => {});
}

export const iocBlocklist = checkLocalIOCBlocklist;
export const localThreatList = checkLocalIOCBlocklist;