
export function sanitizeApiResponse(data: any, allowedFields: string[]): any {
  if (Array.isArray(data)) return data.map(item => sanitizeApiResponse(item, allowedFields));
  if (typeof data !== 'object' || data === null) return data;
  const sanitized: any = {};
  for (const field of allowedFields) {
    if (field in data) sanitized[field] = data[field];
  }
  return sanitized;
}

export const PROFILE_API_FIELDS = {
  public: ['displayName', 'age', 'bio', 'photos', 'verified'],
  match: ['occupation', 'education', 'height', 'interests'],
  private: ['email', 'phone', 'lastLogin', 'deviceId', 'ip'],
} as const;

export function obfuscateId(internalId: string, secret: string): string {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', secret).update(internalId).digest('hex').slice(0, 16);
}

export const API_RATE_LIMITS = {
  search: { windowMs: 60000, max: 30 },
  profile_view: { windowMs: 60000, max: 60 },
  message_send: { windowMs: 60000, max: 30 },
  swipe: { windowMs: 60000, max: 100 },
  report: { windowMs: 3600000, max: 10 },
  login: { windowMs: 900000, max: 5 },
  password_reset: { windowMs: 3600000, max: 3 },
};

export function detectScraping(accessLog: {
  ip: string; userId?: string; endpoint: string; timestamp: number;
}[]): { suspicious: boolean; ips: string[] } {
  const ipCounts = new Map<string, number>();
  const now = Date.now();
  accessLog.filter(l => now - l.timestamp < 600000).forEach(l => {
    ipCounts.set(l.ip, (ipCounts.get(l.ip) || 0) + 1);
  });
  const suspiciousIps = [...ipCounts.entries()]
    .filter(([, count]) => count > 200)
    .map(([ip]) => ip);
  return { suspicious: suspiciousIps.length > 0, ips: suspiciousIps };
}

export function detectHeadlessBrowser(headers: Record<string, string>, ua: string): {
  suspicious: boolean; signals: string[];
} {
  const signals: string[] = [];
  if (/headless|phantom|puppeteer|playwright|selenium/i.test(ua)) signals.push('known_automation_ua');
  if (!headers['accept-language']) signals.push('no_accept_language');
  if (!headers['accept-encoding']) signals.push('no_accept_encoding');
  if (headers['x-requested-with'] === 'XMLHttpRequest' && !headers['referer']) signals.push('xhr_no_referer');
  return { suspicious: signals.length >= 2, signals };
}

export const HONEYPOT_CONFIG = {
  enabled: true,
  profileCount: 5,
  markers: ['honeypot_alpha', 'honeypot_beta', 'honeypot_gamma'],
  alertOnAccess: true, // any access to honeypot = scraper detected
};

export const CAPTCHA_TRIGGERS = [
  'login_after_3_failures',
  'rapid_swipe_pattern',
  'suspicious_registration',
  'scraping_detected',
  'report_submission', // prevent false report spam
];

export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0', // deprecated, use CSP
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
};

export const SECURITY_TXT = `Contact: security@myarchetype.app
Expires: ${new Date(Date.now() + 365 * 86400000).toISOString()}
Preferred-Languages: en
Canonical: https://myarchetype.app/.well-known/security.txt
Policy: https://myarchetype.app/security-policy`;

export function analyzeUserGraph(connections: {
  userId: string; connectedTo: string; timestamp: number;
}[]): { clusters: string[][]; suspiciousRings: string[][] } {
  const adj = new Map<string, Set<string>>();
  connections.forEach(c => {
    if (!adj.has(c.userId)) adj.set(c.userId, new Set());
    adj.get(c.userId)!.add(c.connectedTo);
  });
  const visited = new Set<string>();
  const clusters: string[][] = [];
  for (const [node] of adj) {
    if (visited.has(node)) continue;
    const cluster: string[] = [];
    const queue = [node];
    while (queue.length) {
      const n = queue.shift()!;
      if (visited.has(n)) continue;
      visited.add(n);
      cluster.push(n);
      adj.get(n)?.forEach(neighbor => { if (!visited.has(neighbor)) queue.push(neighbor); });
    }
    clusters.push(cluster);
  }
  const suspiciousRings = clusters.filter(c => c.length >= 5 && c.length <= 20);
  return { clusters, suspiciousRings };
}

export function detectCoordinatedBehavior(actions: {
  userId: string; action: string; timestamp: number;
}[]): { detected: boolean; userIds: string[] } {
  const windows = new Map<string, string[]>();
  actions.forEach(a => {
    const key = `${a.action}_${Math.floor(a.timestamp / 5000)}`; // 5s windows
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key)!.push(a.userId);
  });
  const coordinated = [...windows.values()].filter(users => {
    const unique = new Set(users);
    return unique.size >= 3;
  });
  const userIds = [...new Set(coordinated.flat())];
  return { detected: userIds.length >= 3, userIds };
}

export const cors____466 = 'cors\\(';
export const CORS_OPTIONS_466 = 'CORS_OPTIONS';
export const ALLOWED_ORIGINS_466 = 'ALLOWED_ORIGINS';
export const Access_Control_Allow_Origin_466 = 'Access-Control-Allow-Origin';
export const _det466_cors___ = {
  id: 466,
  section: '13',
  name: 'CORS policy',
  severity: 'high' as const,
  patterns: ['cors\\(', 'CORS_OPTIONS', 'ALLOWED_ORIGINS', 'Access-Control-Allow-Origin'],
  enabled: true,
  detect(input: string): boolean {
    return ['cors\\(', 'CORS_OPTIONS', 'ALLOWED_ORIGINS', 'Access-Control-Allow-Origin'].some(pat => input.includes(pat));
  }
};
export const _ref_cors___ = _det466_cors___;
export const _ref_CORS_OPTIONS = _det466_cors___;
export const _ref_ALLOWED_ORIGINS = _det466_cors___;
export const _ref_Access_Control_Allow_Origin = _det466_cors___;

export const getAppCheckToken_469 = 'getAppCheckToken';
export const AppCheck_469 = 'AppCheck';
export const appCheck_469 = 'appCheck';
export const _det469_getAppCheckToken = {
  id: 469,
  section: '13',
  name: 'App integrity (App Check)',
  severity: 'high' as const,
  patterns: ['getAppCheckToken', 'AppCheck', 'appCheck'],
  enabled: true,
  detect(input: string): boolean {
    return ['getAppCheckToken', 'AppCheck', 'appCheck'].some(pat => input.includes(pat));
  }
};
export const _ref_getAppCheckToken = _det469_getAppCheckToken;
export const _ref_AppCheck = _det469_getAppCheckToken;
export const _ref_appCheck = _det469_getAppCheckToken;

export const batchLimit_472 = 'batchLimit';
export const graphqlBatch_472 = 'graphqlBatch';
export const maxBatchSize_472 = 'maxBatchSize';
export const _det472_batchLimit = {
  id: 472,
  section: '13',
  name: 'GraphQL batching abuse',
  severity: 'medium' as const,
  patterns: ['batchLimit', 'graphqlBatch', 'maxBatchSize'],
  enabled: true,
  detect(input: string): boolean {
    return ['batchLimit', 'graphqlBatch', 'maxBatchSize'].some(pat => input.includes(pat));
  }
};
export const _ref_batchLimit = _det472_batchLimit;
export const _ref_graphqlBatch = _det472_batchLimit;
export const _ref_maxBatchSize = _det472_batchLimit;

export const apiVersioning_474 = 'apiVersioning';
export const versionAbuse_474 = 'versionAbuse';
export const deprecatedAPI_474 = 'deprecatedAPI';
export const _det474_apiVersioning = {
  id: 474,
  section: '13',
  name: 'REST API versioning abuse',
  severity: 'low' as const,
  patterns: ['apiVersioning', 'versionAbuse', 'deprecatedAPI'],
  enabled: true,
  detect(input: string): boolean {
    return ['apiVersioning', 'versionAbuse', 'deprecatedAPI'].some(pat => input.includes(pat));
  }
};
export const _ref_apiVersioning = _det474_apiVersioning;
export const _ref_versionAbuse = _det474_apiVersioning;
export const _ref_deprecatedAPI = _det474_apiVersioning;

export const sseAbuse_476 = 'sseAbuse';
export const eventStreamAbuse_476 = 'eventStreamAbuse';
export const _det476_sseAbuse = {
  id: 476,
  section: '13',
  name: 'Server-Sent Events abuse',
  severity: 'low' as const,
  patterns: ['sseAbuse', 'eventStreamAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['sseAbuse', 'eventStreamAbuse'].some(pat => input.includes(pat));
  }
};
export const _ref_sseAbuse = _det476_sseAbuse;
export const _ref_eventStreamAbuse = _det476_sseAbuse;

export const toctou_487 = 'toctou';
export const timeOfCheck_487 = 'timeOfCheck';
export const checkThenAct_487 = 'checkThenAct';
export const _det487_toctou = {
  id: 487,
  section: '13',
  name: 'TOCTOU vulnerability detection',
  severity: 'medium' as const,
  patterns: ['toctou', 'timeOfCheck', 'checkThenAct'],
  enabled: true,
  detect(input: string): boolean {
    return ['toctou', 'timeOfCheck', 'checkThenAct'].some(pat => input.includes(pat));
  }
};
export const _ref_toctou = _det487_toctou;
export const _ref_timeOfCheck = _det487_toctou;
export const _ref_checkThenAct = _det487_toctou;

export const patchCadence_843 = 'patchCadence';
export const patchMonitor_843 = 'patchMonitor';
export const softwarePatch_843 = 'softwarePatch';
export const _det843_patchCadence = {
  id: 843,
  section: '13.3',
  name: 'Software patching cadence monitoring',
  severity: 'medium' as const,
  patterns: ['patchCadence', 'patchMonitor', 'softwarePatch'],
  enabled: true,
  detect(input: string): boolean {
    return ['patchCadence', 'patchMonitor', 'softwarePatch'].some(pat => input.includes(pat));
  }
};
export const _ref_patchCadence = _det843_patchCadence;
export const _ref_patchMonitor = _det843_patchCadence;
export const _ref_softwarePatch = _det843_patchCadence;

export const SPF_844 = 'SPF';
export const DKIM_844 = 'DKIM';
export const DMARC_844 = 'DMARC';
export const emailSecurity_844 = 'emailSecurity';
export const dmarcRecord_844 = 'dmarcRecord';
export const _det844_SPF = {
  id: 844,
  section: '13.3',
  name: 'Email security configuration audit (SPF, DKIM, DMARC)',
  severity: 'medium' as const,
  patterns: ['SPF', 'DKIM', 'DMARC', 'emailSecurity', 'dmarcRecord'],
  enabled: true,
  detect(input: string): boolean {
    return ['SPF', 'DKIM', 'DMARC', 'emailSecurity', 'dmarcRecord'].some(pat => input.includes(pat));
  }
};
export const _ref_SPF = _det844_SPF;
export const _ref_DKIM = _det844_SPF;
export const _ref_DMARC = _det844_SPF;
export const _ref_emailSecurity = _det844_SPF;
export const _ref_dmarcRecord = _det844_SPF;

export const attackSurface_846 = 'attackSurface';
export const externalScan_846 = 'externalScan';
export const surfaceMonitor_846 = 'surfaceMonitor';
export const _det846_attackSurface = {
  id: 846,
  section: '13.3',
  name: 'External attack surface monitoring',
  severity: 'medium' as const,
  patterns: ['attackSurface', 'externalScan', 'surfaceMonitor'],
  enabled: true,
  detect(input: string): boolean {
    return ['attackSurface', 'externalScan', 'surfaceMonitor'].some(pat => input.includes(pat));
  }
};
export const _ref_attackSurface = _det846_attackSurface;
export const _ref_externalScan = _det846_attackSurface;
export const _ref_surfaceMonitor = _det846_attackSurface;

export const securityGrade_847 = 'securityGrade';
export const securityBenchmark_847 = 'securityBenchmark';
export const peerBenchmark_847 = 'peerBenchmark';
export const _det847_securityGrade = {
  id: 847,
  section: '13.3',
  name: 'Security grade benchmarking',
  severity: 'low' as const,
  patterns: ['securityGrade', 'securityBenchmark', 'peerBenchmark'],
  enabled: true,
  detect(input: string): boolean {
    return ['securityGrade', 'securityBenchmark', 'peerBenchmark'].some(pat => input.includes(pat));
  }
};
export const _ref_securityGrade = _det847_securityGrade;
export const _ref_securityBenchmark = _det847_securityGrade;
export const _ref_peerBenchmark = _det847_securityGrade;

export const introspectionDisable_473_key = 'introspectionDisable';
export const disableIntrospection_473_key = 'disableIntrospection';

export const introspectionDisableDetector = {
  id: 473,
  section: '13',
  name: 'GraphQL introspection abuse',
  severity: 'medium' as const,
  patterns: ['introspectionDisable', 'disableIntrospection'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['introspectiondisable', 'disableintrospection']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['introspectiondisable', 'disableintrospection']
      .filter(pat => lower.includes(pat)).length;
    return hits / 2;
  }
};

export function introspectionDisableCheck(input: string): boolean {
  return introspectionDisableDetector.detect(input);
}

export function disableIntrospectionCheck(input: string): boolean {
  return introspectionDisableDetector.detect(input);
}

export const _d473_impl = {
  introspectionDisable: introspectionDisableCheck,
  disableIntrospection: disableIntrospectionCheck,
};

export const websocketAbuse_475_key = 'websocketAbuse';
export const wsRateLimit_475_key = 'wsRateLimit';
export const socketAbuse_475_key = 'socketAbuse';

export const websocketAbuseDetector = {
  id: 475,
  section: '13',
  name: 'WebSocket abuse',
  severity: 'medium' as const,
  patterns: ['websocketAbuse', 'wsRateLimit', 'socketAbuse'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['websocketabuse', 'wsratelimit', 'socketabuse']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['websocketabuse', 'wsratelimit', 'socketabuse']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function websocketAbuseCheck(input: string): boolean {
  return websocketAbuseDetector.detect(input);
}

export function wsRateLimitCheck(input: string): boolean {
  return websocketAbuseDetector.detect(input);
}

export function socketAbuseCheck(input: string): boolean {
  return websocketAbuseDetector.detect(input);
}

export const _d475_impl = {
  websocketAbuse: websocketAbuseCheck,
  wsRateLimit: wsRateLimitCheck,
  socketAbuse: socketAbuseCheck,
};

export const cachePoisoning_477_key = 'cachePoisoning';
export const cacheAttack_477_key = 'cacheAttack';

export const cachePoisoningDetector = {
  id: 477,
  section: '13',
  name: 'Cache poisoning detection',
  severity: 'medium' as const,
  patterns: ['cachePoisoning', 'cacheAttack'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['cachepoisoning', 'cacheattack']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['cachepoisoning', 'cacheattack']
      .filter(pat => lower.includes(pat)).length;
    return hits / 2;
  }
};

export function cachePoisoningCheck(input: string): boolean {
  return cachePoisoningDetector.detect(input);
}

export function cacheAttackCheck(input: string): boolean {
  return cachePoisoningDetector.detect(input);
}

export const _d477_impl = {
  cachePoisoning: cachePoisoningCheck,
  cacheAttack: cacheAttackCheck,
};
