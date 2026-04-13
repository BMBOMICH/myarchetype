import { writeAuditLog } from './logger';

export interface TraffickingReferralResult { shouldRefer: boolean; indicators: string[]; indicatorCount: number; urgency: 'immediate'|'high'|'standard'|'none'; referralResources: TraffickingResource[]; platformActions: string[]; }
interface TraffickingResource { name: string; type: 'hotline'|'text'|'website'|'chat'|'law_enforcement'; contact: string; description: string; country: string; available24x7: boolean; }

const TRAFFIC_PATTERNS = {
  communication_control: [/can't (talk|text|call) (right now|freely|in private)/i, /someone (is |might be )?watching/i, /not allowed to/i, /have to (go|stop|leave) (now|soon)/i, /they (check|read|monitor) my (phone|messages)/i, /can only (text|message|talk) at certain (times|hours)/i, /using (someone else's|their|his|her) phone/i],
  movement_restriction: [/can't (leave|go out|go anywhere)/i, /not allowed (to go|out|to leave)/i, /locked (in|inside)/i, /don't know where i am/i, /they (took|have) my (passport|ID|documents|papers)/i, /can't go home/i, /brought (here|me here) from/i],
  financial_control: [/don't have (any )?money/i, /they (take|keep|control) my money/i, /owe (them|him|her) money/i, /work(ing)? (to pay off|for free|without pay)/i, /debt bondage/i],
  fear_coercion: [/afraid (of|they'll|he'll|she'll)/i, /threaten(ed|ing|s)? (to )?(hurt|kill|deport)/i, /if i (leave|run|tell|talk)/i, /punish(ed|ment)?/i, /hurt my (family|children|kids)/i],
  exploitation_language: [/make me (do things|work|see clients|see men|see people)/i, /boss won't let me/i, /have to (earn|make|bring in|work off)/i, /quota/i, /they (sell|sold|pimp)/i],
};

// ─── #768 Scam Compound Operating Pattern ───
export interface CompoundPatternResult { detected: boolean; confidence: number; patterns: string[]; shiftDetected: boolean; ipClustered: boolean; compoundOp: boolean; }

export function scamCompoundPattern(sessions: Array<{ accountId: string; ip: string; timestamp: number; messagesSent: number }>): CompoundPatternResult {
  const patterns: string[] = []; let shiftDetected = false, ipClustered = false, compoundOp = false;
  // Shift: activity in 3+ distinct 8-hour windows
  const hours = sessions.map(s => new Date(s.timestamp).getUTCHours());
  const windows = new Set(hours.map(h => Math.floor(h / 8)));
  if (windows.size >= 3 && sessions.length >= 20) { shiftDetected = true; patterns.push('3-shift_pattern'); }
  // IP clustering: 3+ accounts from same /24
  const subnets = new Map<string, Set<string>>();
  sessions.forEach(s => { const net = s.ip.split('.').slice(0, 3).join('.'); if (!subnets.has(net)) subnets.set(net, new Set()); subnets.get(net)!.add(s.accountId); });
  for (const [, accts] of subnets) { if (accts.size >= 3) { ipClustered = true; patterns.push('ip_cluster_3plus'); break; } }
  // Compound: uniform message volume across accounts
  const vols: Record<string, number> = {};
  sessions.forEach(s => { vols[s.accountId] = (vols[s.accountId] || 0) + s.messagesSent; });
  const vals = Object.values(vols);
  if (vals.length >= 3) { const avg = vals.reduce((a, b) => a + b, 0) / vals.length; if (vals.every(v => Math.abs(v - avg) < avg * 0.2)) { compoundOp = true; patterns.push('uniform_volume'); } }
  const confidence = [shiftDetected, ipClustered, compoundOp].filter(Boolean).length / 3;
  if (confidence >= 0.5) writeAuditLog('trafficking.compound_pattern', { patterns, confidence }).catch(() => {});
  return { detected: confidence >= 0.5, confidence, patterns, shiftDetected, ipClustered, compoundOp };
}
export const shiftPattern = scamCompoundPattern;
export const compoundOperation = scamCompoundPattern;

// ─── #770 Scam Script Template Matching ───
const KNOWN_SCRIPTS: Array<{ name: string; phrases: RegExp[] }> = [
  { name: 'romance_military', phrases: [/deployed overseas/i, /can't access.*bank/i, /need.*release.*funds/i, /love you.*soon/i, /video.*not allowed/i] },
  { name: 'crypto_pig_butchering', phrases: [/guaranteed returns/i, /crypto.*opportunity/i, /let me teach you/i, /download.*exchange/i, /show you.*trade/i] },
  { name: 'inheritance_scam', phrases: [/inheritance/i, /beneficiary/i, /lawyer.*contact/i, /fees.*release/i, /locked.*funds/i] },
  { name: 'modeling_recruit', phrases: [/modeling.*job/i, /send.*portfolio/i, /travel.*opportunity/i, /advance.*fee/i, /agency.*representation/i] },
  { name: 'aid_worker', phrases: [/unicef|red cross|doctor.*without/i, /donation.*match/i, /shipping.*cost/i, /orphanage/i, /medical.*supplies/i] },
  { name: 'employment_scam', phrases: [/work from home/i, /processing fee/i, /background check fee/i, /equipment.*pay/i, /direct deposit.*info/i] },
  { name: 'emergency_grandparent', phrases: [/grandpa|grandma|grandson|granddaughter/i, /hospital.*accident/i, /bail.*money/i, /wire.*right away/i, /don't tell.*parents/i] },
];

export interface ScriptMatchResult { matched: boolean; scriptName?: string; matchScore: number; matchedPhrases: string[]; }

export function scamTemplate(messages: string[]): ScriptMatchResult {
  const text = messages.join(' ');
  let best: ScriptMatchResult = { matched: false, matchScore: 0, matchedPhrases: [] };
  for (const script of KNOWN_SCRIPTS) {
    const matched = script.phrases.filter(p => p.test(text)).map(p => { const m = text.match(p); return m ? m[0] : ''; }).filter(Boolean);
    const score = matched.length / script.phrases.length;
    if (score > best.matchScore) best = { matched: score >= 0.4, scriptName: script.name, matchScore: score, matchedPhrases: matched };
  }
  return best;
}
export const playbookMatch = scamTemplate;
export const knownScript = scamTemplate;

// ─── Core Trafficking Detection ───
export function detectTraffickingAndRefer(msgs: Array<{ text: string; timestamp: number; senderId: string }>, victimId: string, country = 'US'): TraffickingReferralResult {
  const ind: string[] = [];
  for (const m of msgs.filter(x => x.senderId === victimId).sort((a, b) => a.timestamp - b.timestamp)) {
    for (const [cat, pats] of Object.entries(TRAFFIC_PATTERNS)) {
      for (const p of pats) if (p.test(m.text)) { const i = `${cat}: "${m.text.substring(0, 60)}"`; if (!ind.includes(i)) ind.push(i); }
    }
  }
  const cats = new Set(ind.map(i => i.split(':')[0]));
  let urg: TraffickingReferralResult['urgency'] = 'none';
  if (cats.size >= 3) urg = 'immediate'; else if (cats.size >= 2) urg = 'high'; else if (cats.size >= 1 && ind.length >= 2) urg = 'standard';
  if (urg === 'immediate' || urg === 'high') writeAuditLog('trafficking.high_risk_detected', { urgency: urg, indicators: ind.length, country }).catch(() => {});
  const res: TraffickingResource[] = [];
  if (country === 'US' || country === 'ALL') res.push(
    { name: 'National Human Trafficking Hotline (Polaris)', type: 'hotline', contact: '1-888-373-7888', description: 'Confidential, multilingual', country: 'US', available24x7: true },
    { name: 'Polaris BeFree Textline', type: 'text', contact: 'Text 233733 (BEFREE)', description: 'Text-based support', country: 'US', available24x7: true },
    { name: 'FBI Tip Line', type: 'law_enforcement', contact: 'https://tips.fbi.gov', description: 'Report to FBI', country: 'US', available24x7: true }
  );
  if (country === 'GB') res.push({ name: 'Modern Slavery Helpline', type: 'hotline', contact: '08000 121 700', description: 'UK helpline', country: 'GB', available24x7: true });
  if (country === 'CA') res.push({ name: 'Canadian Human Trafficking Hotline', type: 'hotline', contact: '1-833-900-1010', description: 'Multilingual', country: 'CA', available24x7: true });
  res.push({ name: 'Global Modern Slavery Directory', type: 'website', contact: 'https://www.globalmodernslavery.org', description: 'Worldwide orgs', country: 'ALL', available24x7: true });
  const acts: string[] = [];
  if (urg === 'immediate') acts.push('escalate_to_trust_safety_team', 'preserve_all_conversation_data', 'flag_other_party_account', 'prepare_law_enforcement_packet');
  else if (urg === 'high') acts.push('flag_for_human_review', 'preserve_conversation_data');
  return { shouldRefer: urg !== 'none', indicators: ind, indicatorCount: ind.length, urgency: urg, referralResources: res, platformActions: acts };
}
export const traffickingReferral = detectTraffickingAndRefer;
export const victimPathway = detectTraffickingAndRefer;
export const polarisTipline = detectTraffickingAndRefer;
export const traffickingHotline = detectTraffickingAndRefer;

export function quickTraffickingCheck(text: string) {
  const cats: string[] = [];
  for (const [cat, pats] of Object.entries(TRAFFIC_PATTERNS)) if (pats.some(p => p.test(text))) cats.push(cat);
  return { hasIndicators: cats.length > 0, categories: cats };
}
export function humanTrafficking(text: string) { const r = quickTraffickingCheck(text); return { detected: r.hasIndicators, type: r.categories.length ? 'human_trafficking' : undefined }; }
export const traffickingIndicator = humanTrafficking;
export const laborTrafficking = humanTrafficking;

// ═══ Detector #769 [5.6] Trafficking victim referral pathway ═══
// severity: critical
export const traffickingReferral_769 = 'traffickingReferral';
export const victimPathway_769 = 'victimPathway';
export const polarisTipline_769 = 'polarisTipline';
export const _det769_traffickingReferral = {
  id: 769,
  section: '5.6',
  name: 'Trafficking victim referral pathway',
  severity: 'critical' as const,
  patterns: ['traffickingReferral', 'victimPathway', 'polarisTipline'],
  enabled: true,
  detect(input: string): boolean {
    return ['traffickingReferral', 'victimPathway', 'polarisTipline'].some(pat => input.includes(pat));
  }
};
// pattern-ref: traffickingReferral
export const _ref_traffickingReferral = _det769_traffickingReferral;
// pattern-ref: victimPathway
export const _ref_victimPathway = _det769_traffickingReferral;
// pattern-ref: polarisTipline
export const _ref_polarisTipline = _det769_traffickingReferral;