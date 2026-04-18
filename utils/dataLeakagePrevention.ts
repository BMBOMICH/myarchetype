import { writeAuditLog } from './logger';

export function anonymousReportSafety(r: { reporterId?: string; deviceFingerprint?: string; ipHash?: string }) { const { reporterId: _r, deviceFingerprint: _d, ipHash: _i, ...s } = r; return { strippedReport: s, tokenId: Math.random().toString(36).slice(2) + Date.now().toString(36) }; }
export const safeAnonymousReport = anonymousReportSafety; export const whistleblowerProtect = anonymousReportSafety;

const STRIP = new Set(['userId', 'reporterId', 'ip', 'deviceId', 'fingerprint', 'sessionId', 'location', 'lat', 'lon', 'timestamp']);
export function reportMetadataStrip(raw: Record<string, unknown>) { return Object.fromEntries(Object.entries(raw).filter(([k]) => !STRIP.has(k))); }
export const stripReportMeta = reportMetadataStrip; export const reportAnonymize = reportMetadataStrip;

export function scoreReportCredibility(r: { hasEvidence: boolean; reporterHistory: number; targetReportCount: number; specificDetails: boolean; timelyReport: boolean }) { let s = 0; if (r.hasEvidence) s += 35; if (r.specificDetails) s += 25; if (r.timelyReport) s += 15; if (r.reporterHistory >= 3) s += 15; if (r.targetReportCount >= 3) s += 10; const w = s >= 70 ? 'high' : s >= 40 ? 'medium' : 'low'; if (s >= 50) writeAuditLog('safety.high_credibility_report', { score: s, weight: w }).catch(() => {}); return { score: s, credible: s >= 50, weight: w }; }
export const reportCredibility = scoreReportCredibility; export const credibilityScore = scoreReportCredibility;

const PII = new Set(['password', 'ssn', 'creditCard', 'bankAccount', 'driverLicense', 'passportNumber', 'privateKey', 'secretKey', 'apiKey', 'accessToken', 'refreshToken', 'biometricTemplate', 'securityAnswer']);
export function apiResponseSanitize(res: Record<string, unknown>) { return Object.fromEntries(Object.entries(res).map(([k, v]) => [k, PII.has(k) ? '[REDACTED]' : v])); }
export const sanitizeApiResponse = apiResponseSanitize; export const piiScrubResponse = apiResponseSanitize;

export function apiFieldProjection<T extends Record<string, unknown>>(obj: T, allowed: (keyof T)[]) { return Object.fromEntries(Object.entries(obj).filter(([k]) => allowed.includes(k as keyof T))) as Partial<T>; }
export const fieldProjection = apiFieldProjection; export const responseFieldLimit = apiFieldProjection;

const exp: Record<string, { c: number; w: number }> = {};
export function bulkDataExportLimit(uid: string, max = 3) { const n = Date.now(), e = exp[uid]; if (!e || n - e.w > 3_600_000) { exp[uid] = { c: 1, w: n }; return { allowed: true, remaining: max - 1 }; } e.c++; return { allowed: e.c <= max, remaining: Math.max(0, max - e.c) }; }
export const exportRateLimit = bulkDataExportLimit; export const dataExportThrottle = bulkDataExportLimit;

export function graphqlFieldMasking(res: Record<string, unknown>, role: 'user' | 'admin' | 'moderator') { const A = new Set(['email', 'phone', 'ipAddress', 'deviceFingerprint', 'internalScore', 'trustScore', 'reportCount', 'safetyFlags']); if (role === 'admin') return res; return Object.fromEntries(Object.entries(res).map(([k, v]) => [k, A.has(k) ? undefined : v])); }
export const fieldMasking = graphqlFieldMasking; export const sensitiveFieldMask = graphqlFieldMasking;

export function apiVersionDeprecation(v: string, dep: string[]) { if (!dep.includes(v)) return { deprecated: false }; return { deprecated: true, message: `API version ${v} deprecated. Migrate to /v2/`, sunsetDate: '2025-12-31' }; }
export const versionDeprecate = apiVersionDeprecation; export const endpointDeprecation = apiVersionDeprecation;

const SQL = [/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE)\b)/i, /('|--|;|\/\*|\*\/)/];
export function sqlInjectionPrevention(i: string) { return { safe: !SQL.some(p => p.test(i)), sanitized: i.replace(/['";\-\-\/\*]/g, '') }; }
export const sqlInjection = sqlInjectionPrevention; export const injectionDetect = sqlInjectionPrevention;

const XSS = [/<script\b/i, /javascript:/i, /on\w+\s*=/i, /<iframe/i, /eval\s*\(/i, /<img\b[^>]+\bon/i, /<svg\b[^>]+\bon/i];
export function xssPrevention(i: string) { return { safe: !XSS.some(p => p.test(i)), sanitized: i.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;') }; }
export const xssDetect = xssPrevention; export const scriptInjection = xssPrevention;

export function cspViolationReport(v: { documentUri: string; violatedDirective: string; blockedUri: string }) { const H = ['script-src', 'object-src', 'base-uri']; const sev = H.some(d => v.violatedDirective.includes(d)) ? 'high' : 'medium'; return { severity: sev, shouldAlert: sev === 'high' }; }
export const cspViolation = cspViolationReport; export const contentSecurityPolicy = cspViolationReport;

export function dependencyVulnerability(pkgs: Array<{ name: string; version: string; severity?: string }>) { return { critical: pkgs.filter(p => p.severity === 'critical').map(p => p.name), high: pkgs.filter(p => p.severity === 'high').map(p => p.name), total: pkgs.length }; }
export const depVulnCheck = dependencyVulnerability; export const packageAudit = dependencyVulnerability;

export function securityHeadersCheck(h: Record<string, string>) { const R = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'content-security-policy', 'referrer-policy', 'permissions-policy']; const l = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])); const m = R.filter(x => !l[x]), p = R.filter(x => !!l[x]); return { score: Math.round((p.length / R.length) * 100), missing: m, passed: p }; }
export const headerAudit = securityHeadersCheck; export const httpSecurityHeaders = securityHeadersCheck;

const PII_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { type: 'credit_card', pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
  { type: 'phone', pattern: /\b(\+?1?\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
  { type: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
  { type: 'dob', pattern: /\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2}\b/ },
  { type: 'address', pattern: /\b\d+\s+[A-Za-z]+\s+(St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road)\b/i },
  { type: 'passport', pattern: /\b[A-Z]\d{8}\b/ },
  { type: 'drivers_license', pattern: /\b[A-Z]{1,2}\d{6,8}\b/ },
  { type: 'bank_account', pattern: /\b\d{8,17}\b/ },
  { type: 'ip_address', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  { type: 'medical_id', pattern: /\b[Mm][Hh][Pp]\d{6,10}\b/ },
];

export function detectPIIInText(text: string): { found: boolean; types: string[]; count: number; redacted: string } {
  const types: string[] = []; let redacted = text;
  for (const { type, pattern } of PII_PATTERNS) {
    if (pattern.test(text)) { types.push(type); redacted = redacted.replace(pattern, `[${type.toUpperCase()}_REDACTED]`); }
  }
  if (types.length > 0) writeAuditLog('leakage.pii_detected', { types, count: types.length }).catch(() => {});
  return { found: types.length > 0, types, count: types.length, redacted };
}
export const piiDetect = detectPIIInText; export const textPII = detectPIIInText;

export function redactLogs(entry: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'apiKey', 'authorization', 'cookie', 'session', 'creditCard', 'ssn', 'phone', 'email', 'ip', 'location', 'lat', 'lng', 'biometric', 'health']);
  return Object.fromEntries(Object.entries(entry).map(([k, v]) => {
    const kl = k.toLowerCase();
    if (SENSITIVE_KEYS.has(kl)) return [k, '[REDACTED]'];
    if (typeof v === 'string') return [k, detectPIIInText(v).redacted];
    if (typeof v === 'object' && v !== null) return [k, redactLogs(v as Record<string, unknown>)];
    return [k, v];
  }));
}
export const logRedaction = redactLogs; export const sanitizeLog = redactLogs;

export function sanitizeErrorMessage(error: Error, isProduction: boolean): { message: string; stack?: string; details?: string } {
  if (!isProduction) return { message: error.message, stack: error.stack, details: error.cause?.toString() };
  const safeMessages: Record<string, string> = { 'ECONNREFUSED': 'Service temporarily unavailable', 'ENOTFOUND': 'Service temporarily unavailable', 'ETIMEDOUT': 'Request timed out', 'ENOENT': 'Resource not found', 'UNAUTHORIZED': 'Authentication required', 'FORBIDDEN': 'Access denied', 'ValidationError': 'Invalid input provided' };
  const msg = safeMessages[error.message] ?? safeMessages[(error as any).code] ?? 'An error occurred. Please try again.';
  return { message: msg };
}
export const errorSanitize = sanitizeErrorMessage; export const productionError = sanitizeErrorMessage;

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';
const FIELD_CLASSIFICATION: Record<string, DataClassification> = {
  name: 'public', bio: 'public', age: 'public', photos: 'public', interests: 'public',
  email: 'confidential', phone: 'confidential', location: 'internal', dateOfBirth: 'confidential',
  password: 'restricted', paymentMethod: 'restricted', ssn: 'restricted', healthData: 'restricted',
  sexualOrientation: 'restricted', politicalViews: 'restricted', religion: 'restricted',
  trustScore: 'internal', reportHistory: 'internal', deviceFingerprint: 'confidential',
  biometricTemplate: 'restricted', chatMessages: 'confidential',
};

export function classifyDataField(fieldName: string): DataClassification { return FIELD_CLASSIFICATION[fieldName] ?? 'internal'; }
export const dataClassification = classifyDataField;

export function enforceDataAccess(fields: string[], userClearance: DataClassification): { allowed: string[]; denied: string[] } {
  const hierarchy: DataClassification[] = ['public', 'internal', 'confidential', 'restricted'];
  const maxIdx = hierarchy.indexOf(userClearance);
  const allowed: string[] = []; const denied: string[] = [];
  for (const f of fields) { const cls = classifyDataField(f); if (hierarchy.indexOf(cls) <= maxIdx) allowed.push(f); else denied.push(f); }
  return { allowed, denied };
}
export const dataAccessControl = enforceDataAccess; export const fieldAccessEnforce = enforceDataAccess;

export function egressMonitor(response: { statusCode: number; body: Record<string, unknown>; endpoint: string; role: string }): { blocked: boolean; reason?: string } {
  if (response.role !== 'admin') {
    const bodyStr = JSON.stringify(response.body);
    if (bodyStr.length > 1_000_000) return { blocked: true, reason: 'response_too_large' };
    const pii = detectPIIInText(bodyStr);
    if (pii.types.includes('ssn') || pii.types.includes('credit_card')) return { blocked: true, reason: 'pii_leakage_detected' };
  }
  return { blocked: false };
}
export const egressFilter = egressMonitor; export const responseMonitor = egressMonitor;

export const SENSITIVE_FIELD_ENCRYPTION = {
  algorithm: 'AES-256-GCM' as const,
  fields: ['sexualOrientation', 'politicalViews', 'religion', 'healthData', 'biometricTemplate', 'location', 'dateOfBirth', 'sexualPreferences', 'kinkPreferences', 'stiStatus'],
  keyRotationDays: 90,
  keyManagement: 'AWS KMS' as const,
  enforceAtRest: true,
  enforceInTransit: true,
};
export const fieldEncryption = SENSITIVE_FIELD_ENCRYPTION; export const encryptionConfig = SENSITIVE_FIELD_ENCRYPTION;

const NOSQL_PATTERNS = [/\$where/i, /\$regex/i, /\$gt/i, /\$lt/i, /\$ne/i, /\$or/i, /\$and/i, /\$not/i, /\$expr/i, /\$lookup/i];
export function noSQLInjectionPrevention(input: unknown): { safe: boolean; sanitized: unknown } {
  if (typeof input === 'string') {
    const safe = !NOSQL_PATTERNS.some(p => p.test(input));
    return { safe, sanitized: safe ? input : input.replace(/\$/g, '') };
  }
  if (typeof input === 'object' && input !== null) {
    const keys = Object.keys(input as Record<string, unknown>);
    const hasDollar = keys.some(k => k.startsWith('$'));
    if (hasDollar) { const sanitized = Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([k]) => !k.startsWith('$'))); return { safe: false, sanitized }; }
    return { safe: true, sanitized: input };
  }
  return { safe: true, sanitized: input };
}
export const noSQLInjection = noSQLInjectionPrevention; export const mongoInjection = noSQLInjectionPrevention;

const PATH_TRAVERSAL = [/\.\./, /\.\.\\/, /%2e%2e/i, /%252e/i, /\.\.%2f/i, /%2f\.\./i];
export function pathTraversalPrevention(input: string): { safe: boolean; sanitized: string } {
  const safe = !PATH_TRAVERSAL.some(p => p.test(input));
  return { safe, sanitized: input.replace(/\.\./g, '').replace(/%2e%2e/gi, '') };
}
export const pathTraversal = pathTraversalPrevention; export const directoryTraversal = pathTraversalPrevention;

const CMD_PATTERNS = [/;\s*(rm|cat|ls|wget|curl|bash|sh|python|perl|nc|ncat|netcat)\b/i, /\|\s*(rm|cat|ls|wget|curl|bash|sh)\b/i, /`[^`]*`/, /\$\([^)]*\)/, /&&\s*(rm|cat|ls|wget|curl)\b/i];
export function commandInjectionPrevention(input: string): { safe: boolean; sanitized: string } {
  const safe = !CMD_PATTERNS.some(p => p.test(input));
  return { safe, sanitized: input.replace(/[;|`$&]/g, '') };
}
export const commandInjection = commandInjectionPrevention; export const cmdInjection = commandInjectionPrevention;

export interface DlpResult{violation:boolean;type:string[];severity:'none'|'low'|'medium'|'high'|'critical';blockedContent:string[];recommendation:string;}
const DLP_PATTERNS=[
  {type:'ssn',pattern:/\b\d{3}-\d{2}-\d{4}\b/g,severity:'critical' as const},
  {type:'credit_card',pattern:/\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,severity:'critical' as const},
  {type:'bank_account',pattern:/\b[0-9]{8,17}\b/g,severity:'high' as const},
  {type:'passport',pattern:/\b[A-Z]{1,2}[0-9]{6,9}\b/g,severity:'high' as const},
  {type:'phone_bulk',pattern:/(\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b[,;\s]){3,}/g,severity:'medium' as const},
  {type:'private_key',pattern:/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,severity:'critical' as const},
  {type:'aws_key',pattern:/AKIA[0-9A-Z]{16}/g,severity:'critical' as const},
  {type:'google_api_key',pattern:/AIza[0-9A-Za-z\-_]{35}/g,severity:'critical' as const},
  {type:'jwt_token',pattern:/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g,severity:'high' as const},
];
export function scanForDlpViolations(content:string,context?:string):DlpResult{
  const types:string[]=[],blocked:string[]=[],sevs:Array<DlpResult['severity']>=[];
  for(const{type,pattern,severity}of DLP_PATTERNS){const matches=[...content.matchAll(pattern)];if(matches.length>0){types.push(type);sevs.push(severity);blocked.push(...matches.map(m=>m[0].replace(/./g,'*')));}}
  const maxSev=sevs.includes('critical')?'critical':sevs.includes('high')?'high':sevs.includes('medium')?'medium':sevs.includes('low')?'low':'none';
  if(maxSev!=='none')writeAuditLog('dlp.violation_detected',{types,severity:maxSev,context}).catch(()=>{});
  return{violation:types.length>0,type:types,severity:maxSev,blockedContent:blocked,recommendation:maxSev==='critical'?'Critical PII/secret detected. Block transmission and alert security team.':maxSev==='high'?'Sensitive data detected. Review before transmission.':maxSev!=='none'?'PII pattern detected. Redact before sending.':'No DLP violations detected.'};
}
export const dataLossPrevention=scanForDlpViolations;export const DLP=scanForDlpViolations;export const sensitiveDataExfil=scanForDlpViolations;export const dlpScan=scanForDlpViolations;