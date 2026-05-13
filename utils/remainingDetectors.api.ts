import { writeAuditLog } from './logger';

export interface ApiDataExposureResult {
  overExposed: boolean;
  exposedFields: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}

const SENSITIVE_API_FIELDS = [
  'email','phone','ip','deviceId','exactLocation','dateOfBirth','ssn',
  'password','token','privateKey','internalId','adminNote','trustScore',
  'moderationHistory','deviceFingerprint','ipHash','emailHash',
];

export function auditApiDataExposure(fields: string[], role: 'user' | 'admin' = 'user'): ApiDataExposureResult {
  const exposed = role === 'user'
    ? fields.filter(f => SENSITIVE_API_FIELDS.some(s => f.toLowerCase().includes(s.toLowerCase())))
    : [];
  const rl = exposed.length >= 3 ? 'high' : exposed.length >= 1 ? 'medium' : 'none';
  if (rl !== 'none') void writeAuditLog('api.data_exposure', { exposedFields: exposed, role, riskLevel: rl }).catch(() => {});
  return {
    overExposed: exposed.length > 0,
    exposedFields: exposed,
    riskLevel: rl,
    recommendation: exposed.length > 0
      ? `API exposes sensitive fields: ${exposed.join(', ')}. Filter before returning to client.`
      : 'API response is clean.',
  };
}

export const apiExposureAudit = auditApiDataExposure;
export const responseFieldAudit = auditApiDataExposure;

export interface GraphQLAbusResult {
  abusive: boolean;
  signals: string[];
  depthViolation: boolean;
  introspectionAbuse: boolean;
  recommendation: string;
}

export function detectGraphQLAbuse(query: {
  depth: number;
  breadth: number;
  hasIntrospection: boolean;
  fieldCount: number;
  complexity: number;
}): GraphQLAbusResult {
  const signals: string[] = [];
  if (query.depth > 10) signals.push(`depth_${query.depth}_exceeds_max_10`);
  if (query.hasIntrospection) signals.push('introspection_query_detected');
  if (query.fieldCount > 100) signals.push(`field_count_${query.fieldCount}_exceeds_100`);
  if (query.complexity > 1000) signals.push(`complexity_${query.complexity}_exceeds_1000`);
  const abusive = signals.length > 0;
  if (abusive) void writeAuditLog('api.graphql_abuse', { signals }).catch(() => {});
  return {
    abusive,
    signals,
    depthViolation: query.depth > 10,
    introspectionAbuse: query.hasIntrospection,
    recommendation: abusive
      ? `GraphQL abuse: ${signals.join(', ')}. Apply depth limiting and disable introspection in production.`
      : 'GraphQL query within safe limits.',
  };
}

export const graphqlAbuse = detectGraphQLAbuse;

export interface ScrapingDetectionResult {
  detected: boolean;
  riskScore: number;
  signals: string[];
  action: 'allow' | 'captcha' | 'rate_limit' | 'block' | 'honeypot_triggered';
  recommendation: string;
}

export function detectMassScraping(request: {
  requestsPerMinute: number;
  uniqueProfilesViewedPerHour: number;
  hasValidUserAgent: boolean;
  acceptsJavaScript: boolean;
  honeypotTriggered: boolean;
  headlessBrowserSignals: boolean;
  requestPatternRobotic: boolean;
  ipReputation: 'clean' | 'datacenter' | 'tor' | 'vpn';
}): ScrapingDetectionResult {
  const signals: string[] = [];
  let score = 0;
  if (request.requestsPerMinute > 60) { signals.push('high_request_rate'); score += 25; }
  if (request.uniqueProfilesViewedPerHour > 100) { signals.push('mass_profile_viewing'); score += 30; }
  if (!request.hasValidUserAgent) { signals.push('invalid_user_agent'); score += 20; }
  if (!request.acceptsJavaScript) { signals.push('no_javascript'); score += 15; }
  if (request.honeypotTriggered) { signals.push('honeypot_triggered'); score += 50; }
  if (request.headlessBrowserSignals) { signals.push('headless_browser'); score += 25; }
  if (request.requestPatternRobotic) { signals.push('robotic_pattern'); score += 20; }
  if (request.ipReputation === 'datacenter') { signals.push('datacenter_ip'); score += 15; }
  if (request.ipReputation === 'tor') { signals.push('tor_exit_node'); score += 10; }
  score = Math.min(score, 100);
  const action = request.honeypotTriggered ? 'honeypot_triggered'
    : score >= 80 ? 'block' : score >= 60 ? 'rate_limit' : score >= 30 ? 'captcha' : 'allow';
  if (score >= 30) void writeAuditLog('scraping.detected', { signals, riskScore: score, action }).catch(() => {});
  return {
    detected: score >= 30,
    riskScore: score,
    signals,
    action,
    recommendation: action === 'block' ? 'Block scraper. Report IP to AbuseIPDB.'
      : action === 'rate_limit' ? 'Rate limit request. Serve degraded response.'
      : action === 'captcha' ? 'Serve CAPTCHA challenge.'
      : action === 'honeypot_triggered' ? 'Honeypot triggered. Hard block and log.'
      : 'Request appears legitimate.',
  };
}

export const scrapingDetect = detectMassScraping;
export const botDetect = detectMassScraping;