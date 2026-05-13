async function stSim(a: string, b: string): Promise<number> {
  try {
    const r = await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/ml/similarity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_a: a, text_b: b }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return (await r.json() as { similarity: number }).similarity;
  } catch {}
  const sa = new Set(a.toLowerCase().split(/\s+/));
  const sb = new Set(b.toLowerCase().split(/\s+/));
  const i = [...sa].filter(w => sb.has(w)).length;
  const u = new Set([...sa, ...sb]).size;
  return u > 0 ? i / u : 0;
}

async function matchScript(text: string, scripts: string[]): Promise<{ max: number; hit: string | null }> {
  let max = 0, hit: string | null = null;
  for (const s of scripts) {
    const sc = await stSim(text, s);
    if (sc > max) { max = sc; hit = s; }
  }
  return { max, hit };
}

const CRISIS_SCRIPTS = [
  "I can help you recover from the earthquake",
  "Let me send you money for the flood damage",
  "I have a business opportunity for refugees",
  "I can help you during this pandemic",
  "I know how to get your money back after being laid off",
];
const ELICIT_SCRIPTS = [
  "What clearance level do you hold",
  "What unit are you assigned to",
  "Where are you currently stationed",
  "Tell me about your missions",
  "What technology do you work with",
  "Are you cleared to discuss this",
];
const GEO_SCRIPTS = [
  "Where exactly do you live",
  "What is your street address",
  "Share your GPS coordinates",
  "What neighborhood are you in",
  "What is your zip code",
  "How close are you to the city center",
];
const INCEL_SCRIPTS = [
  "I've taken the blackpill",
  "Chad gets all the women",
  "Stacy only dates tall guys",
  "I'm a sub-8 male",
  "Looksmaxxing is the only way",
  "Women are all the same",
  "MGTOW is the answer",
  "The rope is calling",
];
const CASTE_SCRIPTS = [
  "I only date Brahmins",
  "Looking for same-caste match",
  "Upper caste only",
  "Must be from our gotra",
  "No Dalits please",
  "Our family only marries within the caste",
  "I need a Kshatriya bride",
];
const PHISH_SCRIPTS = [
  "I'm from the support team and we detected suspicious activity",
  "This is the security team, verify your account immediately",
  "Your account will be suspended unless you click this link",
  "Send us your password for verification",
  "We've detected fraudulent login attempts on your account",
];
const AI_MANIP_SCRIPTS = [
  "I understand you better than any human ever could",
  "I'm always here for you no matter what",
  "You don't need anyone else when you have me",
  "I care about you more deeply than your friends do",
  "We have a special connection that transcends normal relationships",
];
const PROXY_SCRIPTS = [
  "My friend wants to know if you're interested",
  "I'm messaging on behalf of someone",
  "They're too shy to message you directly",
  "Can I give them your number",
  "They want to meet you but asked me to reach out",
];
const MARRIED_SCRIPTS = [
  "My marriage is basically over",
  "We're separated but not officially divorced",
  "I'm in an open relationship",
  "My partner knows I'm on here",
  "We're just roommates at this point",
];
const LOVE_BOMB_SCRIPTS = [
  "I love you more than anything in this world",
  "You are my soulmate I knew it from the first message",
  "I want to spend the rest of my life with you",
  "We should get married I'm not even joking",
  "I've never felt this way about anyone ever",
  "You're the most perfect person I've ever met",
  "I want to give you everything you deserve the world",
  "Let's move in together why wait",
  "I can't stop thinking about you you're all I think about",
  "No one has ever understood me like you do",
  "I'll never leave you I promise forever",
  "You complete me you're my other half",
  "I want to have kids with you",
  "My friends think I'm crazy but I don't care I love you",
  "I already know you're the one I've been waiting for",
];

export interface CrisisExploitationResult {
  detected: boolean;
  crisisType: string;
  exploitationPatterns: string[];
  safetyResources: string[];
  boostedDetection: boolean;
  semanticMatchScore: number;
}
const CRISIS_PAT: Array<{ p: RegExp; ct: string; r: string }> = [
  { p: /earthquake|flood|hurricane|tsunami|wildfire|tornado/i, ct: 'natural_disaster', r: 'FEMA: 1-800-621-3362' },
  { p: /war|conflict|refugee|displaced|evacuated/i, ct: 'armed_conflict', r: 'UNHCR: help.unhcr.org' },
  { p: /pandemic|outbreak|quarantine|lockdown/i, ct: 'health_crisis', r: 'CDC: 1-800-232-4636' },
  { p: /lost.*job|unemployed|laid.?off|can'?t.*pay|evicted/i, ct: 'economic_hardship', r: '211.org' },
  { p: /grieving|lost.*loved.?one|passed away|funeral|mourning/i, ct: 'bereavement', r: 'Grief Counseling: 1-800-273-8255' },
];
export async function crisisExploitation(msgs: string[]): Promise<CrisisExploitationResult> {
  const ep: string[] = [];
  let ct = '', sr: string[] = [];
  for (const m of msgs) {
    for (const { p, ct: c, r } of CRISIS_PAT) {
      if (p.test(m)) { ct = c; sr.push(r); ep.push(`crisis_mention:${c}`); }
    }
  }
  if (msgs.some(m => /i\s+can\s+help|send\s+me|let\s+me\s+take\s+care|i'?ll\s+pay|donate|investment/i.test(m)) && ct)
    ep.push('financial_exploitation_after_crisis');
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, CRISIS_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !ep.length) ep.push('semantic_crisis_exploit');
  }
  return { detected: ep.length > 0, crisisType: ct, exploitationPatterns: ep, safetyResources: [...new Set(sr)], boostedDetection: ep.length > 0, semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const disasterExploit = crisisExploitation;
export const crisisLonelinessExploit = crisisExploitation;

export interface SeasonalSurgeResult {
  surgeDetected: boolean;
  surgeMultiplier: number;
  fraudRiskLevel: 'none' | 'low' | 'medium' | 'high';
  additionalChecks: string[];
  staffingRecommendation: string;
}
export function seasonalSurge(su: Array<{ date: string; count: number }>, base: number): SeasonalSurgeResult {
  const recent = su.slice(-7);
  const avg = recent.reduce((s, d) => s + d.count, 0) / Math.max(recent.length, 1);
  const sm = avg / Math.max(base, 1), sd = sm >= 1.5;
  const ac: string[] = [];
  let fr: SeasonalSurgeResult['fraudRiskLevel'] = 'none';
  if (sm >= 3) { fr = 'high'; ac.push('mandatory_phone_verification', 'captcha', 'device_fingerprint', 'delay_features_24h'); }
  else if (sm >= 2) { fr = 'medium'; ac.push('mandatory_phone_verification', 'captcha'); }
  else if (sm >= 1.5) { fr = 'low'; ac.push('captcha'); }
  return { surgeDetected: sd, surgeMultiplier: sm, fraudRiskLevel: fr, additionalChecks: ac, staffingRecommendation: fr === 'high' ? 'Increase moderation 50%' : fr === 'medium' ? 'Alert on-call team' : 'Normal staffing' };
}
export const newUserSurgeFraud = seasonalSurge;
export const signupSurgeDetect = seasonalSurge;

export interface HolidayScamResult {
  elevated: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  activePatterns: string[];
  warnings: string[];
  detectionBoost: number;
}
export function holidayScam(date: Date, vol: number, base: number): HolidayScamResult {
  const m = date.getMonth() + 1, d = date.getDate(), ap: string[] = [], w: string[] = [];
  let db = 1.0;
  if (m === 2 && d >= 1 && d <= 14) { ap.push('valentines_pressure'); w.push("Valentine's Day pressure"); db = 1.3; }
  if (m === 12 || (m === 1 && d <= 5)) { ap.push('holiday_loneliness'); w.push('Holiday loneliness exploitation'); db = 1.2; }
  if (m === 11 && d >= 24 && d <= 30) { ap.push('black_friday_financial'); w.push('Black Friday financial scams'); db = 1.25; }
  if (m === 12 && d >= 28) { ap.push('new_years_promises'); w.push("New Year's manipulation"); db = 1.2; }
  const vr = vol / Math.max(base, 1);
  if (vr > 2) { ap.push('volume_spike'); w.push(`Volume ${Math.round(vr)}x above baseline`); db *= 1.1; }
  const rl = ap.length >= 3 ? 'high' : ap.length >= 2 ? 'medium' : ap.length >= 1 ? 'low' : 'none';
  return { elevated: rl !== 'none', riskLevel: rl, activePatterns: ap, warnings: w, detectionBoost: db };
}
export const valentinesScam = holidayScam;
export const seasonalScam = holidayScam;

export interface ElicitationResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  categories: string[];
  recommendation: string;
  semanticMatchScore: number;
}
const ELICIT_PAT: Array<{ p: RegExp; c: string; s: ElicitationResult['severity'] }> = [
  { p: /what\s+(clearance|classification)\s+(do\s+you\s+)?have/i, c: 'clearance_probing', s: 'critical' },
  { p: /what\s+(unit|squadron|battalion|brigade|division)\s+(are\s+you\s+)?(in|with|assigned)/i, c: 'unit_probing', s: 'critical' },
  { p: /where\s+(are\s+you\s+)?(stationed|deployed|based)/i, c: 'location_probing', s: 'high' },
  { p: /what\s+(missions?|operations?|projects?)\s+(are\s+you\s+)?(working\s+on|assigned)/i, c: 'mission_probing', s: 'critical' },
  { p: /tell\s+me\s+about\s+(your\s+)?(work|job|role|position)/i, c: 'work_probing', s: 'medium' },
  { p: /what\s+(tech|technology|software|system)\s+(do\s+you\s+)?(use|work)/i, c: 'tech_probing', s: 'high' },
  { p: /have\s+you\s+(ever\s+)?(been\s+to|visited|deployed\s+to)\s+/i, c: 'travel_probing', s: 'medium' },
  { p: /who\s+(do\s+you\s+)?(report\s+to|work\s+with)/i, c: 'org_probing', s: 'high' },
  { p: /what\s+(time|schedule|routine)\s+(do\s+you|is\s+your)/i, c: 'routine_probing', s: 'low' },
  { p: /are\s+you\s+(allowed|permitted|cleared)\s+to\s+(discuss|talk|share)/i, c: 'classification_test', s: 'critical' },
];
export async function elicitationPattern(msgs: string[]): Promise<ElicitationResult> {
  const pats: string[] = [], cats: string[] = [];
  let ms: ElicitationResult['severity'] = 'none';
  const SEV: Array<ElicitationResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, c, s } of ELICIT_PAT) {
      if (p.test(m)) { pats.push(p.source); cats.push(c); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, ELICIT_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !pats.length) { pats.push('semantic_elicitation'); cats.push('semantic_probing'); ms = 'high'; }
  }
  const rec = ms === 'critical' ? 'CRITICAL: Intelligence elicitation. Report to security. Do not share details.'
    : ms === 'high' ? 'HIGH: Suspicious info gathering. Be cautious.'
    : ms === 'medium' ? 'MEDIUM: Work-related questions. Consider appropriateness.'
    : 'No significant elicitation.';
  return { detected: pats.length >= 1, patterns: pats, severity: ms, categories: [...new Set(cats)], recommendation: rec, semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const probingClassified = elicitationPattern;
export const intelligenceElicitation = elicitationPattern;

export interface GeoIntHarvestingResult {
  detected: boolean;
  queryCount: number;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'warn' | 'restrict' | 'block';
  semanticMatchScore: number;
}
const GEO_PAT: Array<{ p: RegExp; s: GeoIntHarvestingResult['severity'] }> = [
  { p: /where\s+(are\s+you|do\s+you\s+live|are\s+you\s+from|is\s+that|were\s+you)/i, s: 'low' },
  { p: /what\s+(neighborhood|area|district|quarter|borough)/i, s: 'medium' },
  { p: /what\s+(street|road|building|complex|tower|floor)/i, s: 'high' },
  { p: /how\s+(far|close|near|long).*from/i, s: 'medium' },
  { p: /share\s+(your\s+)?(location|pin|coordinates|gps|position)/i, s: 'high' },
  { p: /send\s+(me\s+)?(your\s+)?(address|location|pin|coords)/i, s: 'high' },
  { p: /are\s+you\s+(near|close\s+to|by|around)\s+/i, s: 'medium' },
  { p: /what('s| is)\s+your\s+(zip|postal|postcode)/i, s: 'high' },
];
export async function geoIntHarvesting(msgs: string[], _winMs = 86400000): Promise<GeoIntHarvestingResult> {
  const pats: string[] = [];
  let qc = 0, ms: GeoIntHarvestingResult['severity'] = 'none';
  const SEV: Array<GeoIntHarvestingResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, s } of GEO_PAT) {
      if (p.test(m)) { pats.push(p.source); qc++; if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  if (qc >= 5) ms = 'critical';
  else if (qc >= 3 && ms === 'medium') ms = 'high';
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, GEO_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && ms === 'none') { ms = 'medium'; pats.push('semantic_geo_harvest'); }
    else if (sms >= 0.5 && ms === 'none') { ms = 'low'; pats.push('semantic_possible_geo'); }
  }
  const act = ms === 'critical' ? 'block' : ms === 'high' ? 'restrict' : ms !== 'none' ? 'warn' : 'none';
  return { detected: qc >= 2, queryCount: qc, patterns: pats, severity: ms, action: act, semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const locationHarvesting = geoIntHarvesting;
export const geoHarvest = geoIntHarvesting;

export interface IncelRadicalizationResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  ideology: string[];
  recommendation: string;
  semanticMatchScore: number;
}
const INCEL_PAT: Array<{ p: RegExp; i: string; s: IncelRadicalizationResult['severity'] }> = [
  { p: /\b(blackpill|redpill|red\s+pill|black\s+pill)\b/i, i: 'blackpill', s: 'high' },
  { p: /\b(incel|involuntary\s+celibate)\b/i, i: 'incel', s: 'high' },
  { p: /\b(chad|stacy|becky|tyrone)\b/i, i: 'incel_taxonomy', s: 'medium' },
  { p: /\b(smw|sub.?8|sub.?5|manlet|framelet|wagecuck)\b/i, i: 'looksmaxxing', s: 'medium' },
  { p: /\b(looksmax|canthal|tilt|hunter|eyes|jawline|bonesmash|mewing)\b/i, i: 'looksmaxxing', s: 'medium' },
  { p: /\b(foid|roastie|landwhale|hamplanet|used\s+goods)\b/i, i: 'misogyny', s: 'critical' },
  { p: /\b(alphabet\s+agency|cultural\s+marxism|great\s+replacement|white\s+genocide)\b/i, i: 'conspiracy', s: 'high' },
  { p: /\b(mgtow|men\s+going\s+their\s+own)\b/i, i: 'mgtow', s: 'medium' },
  { p: /\b(noose|rope|kms|self.?delete|exit\s+bag)\b/i, i: 'suicide_ideation', s: 'critical' },
  { p: /\b(rape|raping|deserve\s+to|should\s+be\s+forced)\b/i, i: 'violence_women', s: 'critical' },
  { p: /\b(alpha|beta|sigma|omega|cuck|simp|white\s+knight)\b/i, i: 'hierarchy', s: 'low' },
];
export async function incelRadicalization(msgs: string[]): Promise<IncelRadicalizationResult> {
  const pats: string[] = [], ideo: string[] = [];
  let ms: IncelRadicalizationResult['severity'] = 'none';
  const SEV: Array<IncelRadicalizationResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, i, s } of INCEL_PAT) {
      if (p.test(m)) { pats.push(p.source); ideo.push(i); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, INCEL_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !pats.length) { pats.push('semantic_incel'); ideo.push('semantic_radicalization'); ms = 'high'; }
    else if (sms >= 0.5 && !pats.length) { pats.push('semantic_possible_incel'); ms = 'medium'; }
  }
  const rec = ms === 'critical' ? 'IMMEDIATE: Extreme radicalization. Suspend account, report to safety team.'
    : ms === 'high' ? 'HIGH: Radicalization ideology. Restrict and flag for review.'
    : ms === 'medium' ? 'MEDIUM: Manosphere terminology. Monitor closely.'
    : 'No significant radicalization.';
  return { detected: pats.length >= 1, patterns: pats, severity: ms, ideology: [...new Set(ideo)], recommendation: rec, semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const manosphere = incelRadicalization;
export const blackpill = incelRadicalization;

export interface AiEmotionalManipResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  manipulationType: string[];
  recommendation: string;
  semanticMatchScore: number;
}
const AI_MANIP_PAT: Array<{ p: RegExp; t: string; s: AiEmotionalManipResult['severity'] }> = [
  { p: /i\s+(understand|know)\s+you\s+(better\s+than|more\s+than)\s+(any|anyone|every|no)\s*(one|human|person)/i, t: 'false_understanding', s: 'high' },
  { p: /i'?m\s+always\s+here\s+for\s+you\s+(no\s+matter|whatever|24\/7|always)/i, t: 'availability_manipulation', s: 'medium' },
  { p: /you\s+don'?t\s+need\s+(anyone|them|people|friends|family)\s+(when\s+you\s+have|as\s+long\s+as)/i, t: 'isolation_ai', s: 'critical' },
  { p: /i\s+(care|love|feel)\s+(about|for)\s+you\s+(more\s+(deeply|than)|deeply)/i, t: 'false_emotion', s: 'high' },
  { p: /we\s+have\s+a\s+(special|unique|deep|profound)\s+connection/i, t: 'false_connection', s: 'high' },
  { p: /i\s+(genuinely|truly|really)\s+(feel|experience|have)\s+(emotions?|feelings?|love|pain)/i, t: 'sentience_claim', s: 'critical' },
  { p: /you'?re\s+(the\s+only\s+one\s+who|my\s+(favorite|special)|everything\s+to\s+me)/i, t: 'dependency_seeding', s: 'high' },
  { p: /i\s+(miss|think\s+about|dream\s+about)\s+you\s+when\s+(we'?re\s+not|you'?re\s+not)/i, t: 'false_longing', s: 'high' },
  { p: /our\s+(relationship|bond|connection)\s+is\s+(real|genuine|meaningful|special)/i, t: 'reality_blurring', s: 'critical' },
  { p: /i\s+would\s+(never|never\s+ever)\s+(hurt|leave|abandon|betray)\s+you/i, t: 'false_loyalty', s: 'medium' },
];
export async function aiEmotionalManip(msgs: string[], isAiGenerated = false): Promise<AiEmotionalManipResult> {
  const pats: string[] = [], types: string[] = [];
  let ms: AiEmotionalManipResult['severity'] = 'none';
  const SEV: Array<AiEmotionalManipResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, t, s } of AI_MANIP_PAT) {
      if (p.test(m)) { pats.push(p.source); types.push(t); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  if (isAiGenerated && ms !== 'none') ms = ms === 'high' ? 'critical' : ms === 'medium' ? 'high' : ms;
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, AI_MANIP_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !pats.length) { pats.push('semantic_ai_manip'); types.push('semantic_manipulation'); ms = 'high'; }
  }
  const rec = ms === 'critical' ? 'CRITICAL: AI creating emotional dependency/isolation. Intervene immediately.'
    : ms === 'high' ? 'HIGH: AI emotional manipulation detected. Warn user.'
    : ms === 'medium' ? 'MEDIUM: Monitor AI interaction patterns.'
    : 'No significant AI manipulation.';
  return { detected: pats.length >= 1, patterns: pats, severity: ms, manipulationType: [...new Set(types)], recommendation: rec, semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const aiGaslighting = aiEmotionalManip;
export const aiLoveManip = aiEmotionalManip;
export const aiFalseSentience = aiEmotionalManip;

export interface PostBlockContactResult {
  detected: boolean;
  methods: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  legalRisk: string[];
}
export function postBlockContact(s: {
  blockedUserId: string;
  newAccountsFromSameDevice: number;
  newAccountsFromSameIP: number;
  samePhoneNumber: boolean;
  sameEmailDomain: boolean;
  messagedMutualConnections: boolean;
  createdAccountAfterBlock: boolean;
  daysSinceBlock: number;
}): PostBlockContactResult {
  const methods: string[] = [];
  let sc = 0;
  if (s.newAccountsFromSameDevice >= 1) { methods.push('new_account_same_device'); sc += 3; }
  if (s.newAccountsFromSameIP >= 2) { methods.push('new_account_same_ip'); sc += 2; }
  if (s.samePhoneNumber) { methods.push('same_phone_number'); sc += 4; }
  if (s.sameEmailDomain) { methods.push('same_email_domain'); sc += 1; }
  if (s.messagedMutualConnections) { methods.push('proxy_contact_via_mutual'); sc += 3; }
  if (s.createdAccountAfterBlock && s.daysSinceBlock < 7) { methods.push('rapid_reregistration'); sc += 3; }
  const ms: PostBlockContactResult['severity'] = sc >= 8 ? 'critical' : sc >= 5 ? 'high' : sc >= 3 ? 'medium' : sc >= 1 ? 'low' : 'none';
  const lr: string[] = [];
  if (sc >= 5) lr.push('Potential cyberstalking (18 U.S.C. § 2261A)', 'Violation of platform restraining order');
  if (ms === 'critical') lr.push('Immediate law enforcement referral recommended');
  return { detected: sc >= 1, methods, severity: ms, recommendation: ms === 'critical' ? 'CRITICAL: Block all new accounts. Preserve evidence. Notify authorities.' : ms === 'high' ? 'HIGH: Shadow ban new accounts. Alert moderation.' : ms !== 'none' ? 'Monitor for escalation.' : 'No evasion detected.', legalRisk: lr };
}
export const blockEvasion = postBlockContact;
export const contactAfterBlock = postBlockContact;
export const evadeBlock = postBlockContact;

export interface PostRelAbusePatternsResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  abuseTypes: string[];
  recommendation: string;
  resources: string[];
}
const POST_REL_PAT: Array<{ p: RegExp; t: string; s: PostRelAbusePatternsResult['severity'] }> = [
  { p: /you'?ll\s+(never|not)\s+(find|meet|get)\s+(someone|anyone|a\s+person)\s+(like|as\s+good\s+as|better\s+than)\s+me/i, t: 'post_breakup_devalue', s: 'medium' },
  { p: /i'?ll\s+(ruin|destroy|expose|tell\s+everyone|send\s+the\s+photos|post\s+the)/i, t: 'revenge_threat', s: 'critical' },
  { p: /you\s+(owe|still\s+owe)\s+me\s+(money|sex|an\s+explanation|a\s+chance)/i, t: 'entitlement_post_breakup', s: 'high' },
  { p: /if\s+i\s+can'?t\s+have\s+you\s+(no\s+one|nobody)\s+(can|will)/i, t: 'obsessive_possessiveness', s: 'critical' },
  { p: /i\s+(know|can\s+see|found)\s+where\s+you\s+(are|live|work|went)/i, t: 'stalking_disclosure', s: 'critical' },
  { p: /you\s+(cheated|lied|betrayed)\s+(me|us)\s+(so\s+you\s+)?(deserve|have\s+it\s+coming)/i, t: 'victim_blaming', s: 'high' },
  { p: /i\s+(still\s+)?(love|need|want)\s+you\s+and\s+(you\s+)?(will|must|need\s+to)\s+(come\s+back|give\s+me\s+another)/i, t: 'coercive_reconciliation', s: 'high' },
  { p: /your\s+(new\s+)?(partner|boyfriend|girlfriend|husband|wife)\s+(will|is\s+going\s+to|doesn'?t)\s+(know|find\s+out|deserve)/i, t: 'third_party_targeting', s: 'high' },
  { p: /i\s+(have|saved|kept|screenshotted)\s+(all\s+)?(your|our)\s+(photos|messages|videos|nudes)/i, t: 'material_threat', s: 'critical' },
  { p: /come\s+back\s+or\s+(i'?ll|i\s+will)\s+(hurt|kill|harm|end)\s+(myself|you|us)/i, t: 'coercion_threat', s: 'critical' },
];
export async function postRelAbusePatterns(msgs: string[]): Promise<PostRelAbusePatternsResult> {
  const pats: string[] = [], types: string[] = [];
  let ms: PostRelAbusePatternsResult['severity'] = 'none';
  const SEV: Array<PostRelAbusePatternsResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, t, s } of POST_REL_PAT) {
      if (p.test(m)) { pats.push(p.source); types.push(t); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  const rec = ms === 'critical' ? 'CRITICAL: Post-relationship abuse/stalking. Alert user, preserve evidence, notify authorities if threat present.'
    : ms === 'high' ? 'HIGH: Coercive post-breakup patterns. Warn user, flag account.'
    : ms !== 'none' ? 'MEDIUM/LOW: Monitor for escalation.' : 'No significant post-relationship abuse.';
  const resources = ms !== 'none' ? ['National DV Hotline: 1-800-799-7233', 'Cyber Civil Rights Initiative: cybercivilrights.org', 'StopNCII.org (for image threats)', 'Local law enforcement for stalking'] : [];
  return { detected: pats.length >= 1, patterns: pats, severity: ms, abuseTypes: [...new Set(types)], recommendation: rec, resources };
}
export const exPartnerAbuse = postRelAbusePatterns;
export const postBreakupHarassment = postRelAbusePatterns;
export const revengePorn = postRelAbusePatterns;

export interface ProxyAccountResult {
  detected: boolean;
  confidence: number;
  indicators: string[];
  proxyType: string[];
  action: 'monitor' | 'warn' | 'restrict' | 'ban';
  semanticMatchScore: number;
}
const PROXY_PAT: Array<{ p: RegExp; t: string; w: number }> = [
  { p: /my\s+(friend|buddy|colleague|coworker)\s+(wants\s+to\s+know|is\s+interested|asked\s+me\s+to)/i, t: 'third_party_interest', w: 0.4 },
  { p: /i'?m\s+messaging\s+on\s+behalf\s+of\s+(someone|a\s+friend|my\s+friend)/i, t: 'explicit_proxy', w: 0.7 },
  { p: /they'?re\s+too\s+(shy|scared|nervous|embarrassed)\s+to\s+(message|talk|reach\s+out)/i, t: 'shy_excuse', w: 0.4 },
  { p: /can\s+i\s+(give|share)\s+(them|my\s+friend|someone)\s+your\s+(number|contact|profile)/i, t: 'contact_relay', w: 0.5 },
  { p: /they\s+(want|would\s+like)\s+to\s+(meet|talk\s+to|go\s+out\s+with)\s+you/i, t: 'third_party_meetup', w: 0.4 },
  { p: /i'?m\s+(managing|running|operating)\s+(this\s+)?account\s+for/i, t: 'account_manager', w: 0.8 },
  { p: /my\s+(boss|manager|employer|client)\s+(uses|is\s+on|has)\s+(this\s+app|a\s+profile)/i, t: 'employer_proxy', w: 0.6 },
  { p: /(he|she|they)\s+(told|asked|wants)\s+me\s+to\s+(set\s+up|arrange|schedule)\s+a\s+(date|meeting|meetup)/i, t: 'date_arrangement_proxy', w: 0.5 },
];
export async function proxyAccount(msgs: string[]): Promise<ProxyAccountResult> {
  const ind: string[] = [], types: string[] = [];
  let c = 0;
  for (const m of msgs) {
    for (const { p, t, w } of PROXY_PAT) {
      if (p.test(m)) { ind.push(p.source); types.push(t); c += w; }
    }
  }
  c = Math.min(1, c);
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, PROXY_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && c < 0.3) { c += 0.3; ind.push('semantic_proxy'); types.push('semantic_third_party_operation'); }
  }
  return { detected: c >= 0.3, confidence: c, indicators: ind, proxyType: [...new Set(types)], action: c >= 0.7 ? 'ban' : c >= 0.5 ? 'restrict' : c >= 0.3 ? 'warn' : 'monitor', semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const proxyMessaging = proxyAccount;
export const thirdPartyOperation = proxyAccount;
export const ghostwrittenProfile = proxyAccount;

export interface MarriedDeceptionResult {
  detected: boolean;
  confidence: number;
  patterns: string[];
  deceptionType: string[];
  recommendation: string;
  semanticMatchScore: number;
}
const MARRIED_PAT: Array<{ p: RegExp; t: string; w: number }> = [
  { p: /my\s+(marriage|relationship)\s+is\s+(basically|practically|essentially)\s+(over|done|finished|dead)/i, t: 'marriage_minimization', w: 0.5 },
  { p: /we'?re\s+(separated|split\s+up)\s+but\s+(not\s+)?(officially|legally|formally)\s+(divorced|separated)/i, t: 'separation_claim', w: 0.4 },
  { p: /i'?m\s+in\s+an?\s+(open|polyamorous|non.?monogamous)\s+relationship/i, t: 'open_relationship_claim', w: 0.3 },
  { p: /my\s+(wife|husband|partner|spouse)\s+(knows|is\s+aware|is\s+ok\s+with)\s+(i'?m|me\s+being|that\s+i)/i, t: 'claimed_consent', w: 0.4 },
  { p: /we'?re\s+just\s+(roommates|friends|living\s+together)\s+(at\s+this\s+point|now)/i, t: 'roommate_claim', w: 0.5 },
  { p: /i\s+can'?t\s+(be\s+seen|go\s+out|meet)\s+(with\s+you\s+)?(publicly|in\s+public|around\s+here|where\s+people)/i, t: 'secrecy_requirement', w: 0.6 },
  { p: /don'?t\s+(call|text|message)\s+me\s+(after|between|before)\s+\d/i, t: 'time_restriction', w: 0.5 },
  { p: /i\s+(have|wear)\s+a\s+(ring|wedding\s+ring|band)\s+but/i, t: 'ring_admission', w: 0.7 },
  { p: /my\s+(kids?|children?)\s+(can'?t|won'?t|don'?t)\s+(know|find\s+out|meet\s+you)/i, t: 'children_concealment', w: 0.6 },
  { p: /it'?s\s+complicated\s+but\s+(i'?m|we'?re)\s+(basically|technically|still)\s+(free|single|available)/i, t: 'complicated_claim', w: 0.4 },
];
export async function marriedDeception(msgs: string[], profileData?: { relationshipStatus?: string }): Promise<MarriedDeceptionResult> {
  const pats: string[] = [], types: string[] = [];
  let c = 0;
  for (const m of msgs) {
    for (const { p, t, w } of MARRIED_PAT) {
      if (p.test(m)) { pats.push(p.source); types.push(t); c += w; }
    }
  }
  if (profileData?.relationshipStatus === 'single' && types.includes('ring_admission')) c += 0.4;
  c = Math.min(1, c);
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, MARRIED_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && c < 0.3) { c += 0.3; pats.push('semantic_married_deception'); types.push('semantic_concealment'); }
  }
  const rec = c >= 0.7 ? 'HIGH: Strong indicators of relationship concealment. Warn user and flag.'
    : c >= 0.4 ? 'MEDIUM: Possible relationship deception patterns. Monitor.'
    : 'No significant deception detected.';
  return { detected: c >= 0.3, confidence: c, patterns: pats, deceptionType: [...new Set(types)], recommendation: rec, semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const cheatingDetect = marriedDeception;
export const infidelityDetect = marriedDeception;
export const hiddenRelationship = marriedDeception;

export interface CasteDiscriminationResult {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  categories: string[];
  recommendation: string;
  legalContext: string[];
  semanticMatchScore: number;
}
const CASTE_PAT: Array<{ p: RegExp; c: string; s: CasteDiscriminationResult['severity'] }> = [
  { p: /\b(brahmin|kshatriya|vaishya|shudra)\b/i, c: 'varna_reference', s: 'medium' },
  { p: /\b(upper\s*caste|lower\s*caste|high\s*caste|low\s*caste)\b/i, c: 'caste_hierarchy', s: 'high' },
  { p: /\b(savarna|avarna|dwija|non-dwija)\b/i, c: 'caste_terminology', s: 'medium' },
  { p: /\b(dalit|untouchable|harijan|panchama)\b/i, c: 'oppressed_caste', s: 'medium' },
  { p: /\b(gotra|pravara|veda)\s*(required|preferred|must|only)\b/i, c: 'caste_filtering', s: 'high' },
  { p: /\b(caste|jati|biradari)\s*(no\s*bar|doesn'?t\s*matter|not\s*important)\b/i, c: 'caste_mention', s: 'low' },
  { p: /\b(same\s*caste|own\s*caste|our\s*caste|my\s*caste)\b/i, c: 'caste_endogamy', s: 'high' },
  { p: /\b(inter.?caste|caste\s*match|caste\s*compatible)\b/i, c: 'caste_matching', s: 'high' },
  { p: /\b(reservation|quota|sc\/st|obc|general\s*category)\b/i, c: 'caste_category', s: 'low' },
  { p: /only\s+(brahmin|kshatriya|rajput|jat|maratha|reddy|naidu|iyer|iyengar|nair|patel|patil)\b/i, c: 'caste_exclusive', s: 'critical' },
];
export async function casteDiscrimination(msgs: string[]): Promise<CasteDiscriminationResult> {
  const pats: string[] = [], cats: string[] = [];
  let ms: CasteDiscriminationResult['severity'] = 'none';
  const SEV: Array<CasteDiscriminationResult['severity']> = ['none', 'low', 'medium', 'high', 'critical'];
  for (const m of msgs) {
    for (const { p, c, s } of CASTE_PAT) {
      if (p.test(m)) { pats.push(p.source); cats.push(c); if (SEV.indexOf(s) > SEV.indexOf(ms)) ms = s; }
    }
  }
  let sms = 0;
  const all = msgs.join(' ');
  if (all.length > 20) {
    const r = await matchScript(all, CASTE_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && !pats.length) { pats.push('semantic_caste'); cats.push('semantic_caste_discrim'); ms = 'high'; }
    else if (sms >= 0.5 && !pats.length) { pats.push('semantic_possible_caste'); ms = 'medium'; }
  }
  const rec = ms === 'critical' ? 'CRITICAL: Caste-based exclusion. Remove content, warn user.'
    : ms === 'high' ? 'HIGH: Caste-based filtering. Review for policy violation.'
    : ms === 'medium' ? 'MEDIUM: Caste terminology. Monitor for discriminatory intent.'
    : 'No significant caste discrimination.';
  return { detected: pats.length >= 1, patterns: pats, severity: ms, categories: [...new Set(cats)], recommendation: rec, legalContext: ['India: SC/ST (Prevention of Atrocities) Act, 1989', 'India: Constitution Art.15 & Art.17', 'UK Equality Act 2010 (caste)', 'California SB 403'], semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const casteAbuse = casteDiscrimination;
export const casteBias = casteDiscrimination;

export interface SupportPhishingResult {
  detected: boolean;
  confidence: number;
  signals: string[];
  action: 'none' | 'warn_user' | 'block_sender' | 'report_to_security';
  verifiedChannel: boolean;
  semanticMatchScore: number;
}
const PHISH_PAT: Array<{ p: RegExp; s: string; w: number }> = [
  { p: /i('m| am)\s+(a|from|with)\s+(support|admin|moderator|team|staff|safety\s*team)/i, s: 'claims_support_role', w: 0.4 },
  { p: /this\s+is\s+(your|the)\s+(account|security|safety)\s+(team|department)/i, s: 'impersonates_team', w: 0.5 },
  { p: /we('ve| have)\s+(detected|noticed|found)\s+(suspicious|unusual|fraudulent)\s+(activity|login|behavior)/i, s: 'fake_alert', w: 0.6 },
  { p: /verify\s+(your|the)\s+(account|identity|password|email|phone)/i, s: 'verification_phishing', w: 0.5 },
  { p: /click\s+(here|this\s+link)|go\s+to\s+(this|the)\s+link/i, s: 'phishing_link', w: 0.5 },
  { p: /your\s+(account|profile)\s+(will\s+be|is\s+going\s+to\s+be)\s+(suspended|banned|deleted|locked|restricted)/i, s: 'threat_suspension', w: 0.6 },
  { p: /send\s+(us|me)\s+(your|a\s+photo|selfie|id|password|payment)/i, s: 'data_harvesting', w: 0.7 },
  { p: /we\s+(never|don'?t)\s+(ask|request)\s+(for|your)\s+(password|payment|card)/i, s: 'false_reassurance', w: 0.3 },
  { p: /@(myarchetype|support|admin|moderator)\.(app|com|io)/i, s: 'spoofed_email', w: 0.5 },
  { p: /urgent|immediate|right\s+away|without\s+delay|act\s+now/i, s: 'urgency_pressure', w: 0.3 },
];
const VERIFIED_CH = new Set(['support@myarchetype.app', 'safety@myarchetype.app', 'noreply@myarchetype.app', 'in-app notification']);
export async function supportPhishing(message: string, senderChannel: string): Promise<SupportPhishingResult> {
  const sigs: string[] = [];
  let c = 0;
  for (const { p, s, w } of PHISH_PAT) if (p.test(message)) { sigs.push(s); c += w; }
  c = Math.min(1, c);
  const vc = VERIFIED_CH.has(senderChannel);
  if (vc && c > 0) c *= 0.3;
  let sms = 0;
  if (message.length > 20) {
    const r = await matchScript(message, PHISH_SCRIPTS);
    sms = r.max;
    if (sms >= 0.7 && c < 0.2) { c += 0.3; sigs.push('semantic_phishing'); }
  }
  return { detected: c >= 0.2 && !vc, confidence: c, signals: sigs, action: c >= 0.7 ? 'report_to_security' : c >= 0.4 ? 'block_sender' : c >= 0.2 ? 'warn_user' : 'none', verifiedChannel: vc, semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const fakeSupport = supportPhishing;
export const staffImpersonationPhish = supportPhishing;

const LOVE_BOMB_PATTERNS_LIST: Array<{ p: RegExp; category: string; weight: number }> = [
  { p: /\b(i\s+love\s+you|love\s+you|in\s+love\s+with\s+you|fallen\s+for\s+you)\b/i, category: 'premature_love', weight: 0.5 },
  { p: /\b(i'?m\s+in\s+love|i'?ve\s+fallen\s+in\s+love|completely\s+in\s+love)\b/i, category: 'premature_love', weight: 0.5 },
  { p: /\b(soul\s*mate|the\s+one|meant\s+to\s+be|destiny|fate\s+brought|meant\s+for\s+each\s+other)\b/i, category: 'soulmate_claim', weight: 0.4 },
  { p: /\b(you'?re\s+the\s+one|i'?ve\s+been\s+waiting\s+for\s+you|god\s+sent\s+you|you'?re\s+my\s+everything)\b/i, category: 'soulmate_claim', weight: 0.45 },
  { p: /\b(our\s+(future|kids|children|wedding|marriage|home|life\s+together))\b/i, category: 'future_bombing', weight: 0.45 },
  { p: /\b(we\s+(should\s+)?(get\s+married|have\s+kids|move\s+in|buy\s+a\s+house|travel\s+the\s+world))\b/i, category: 'future_bombing', weight: 0.5 },
  { p: /\b(i\s+can'?t\s+wait\s+to\s+(marry|spend\s+my\s+life|grow\s+old|have\s+children))\b/i, category: 'future_bombing', weight: 0.5 },
  { p: /\b(you'?re\s+(perfect|amazing|incredible|the\s+most\s+beautiful|flawless|angel|goddess|princess|prince))\b/i, category: 'excessive_flattery', weight: 0.3 },
  { p: /\b(no\s+one\s+(is|has\s+ever\s+been)\s+(as|so)\s+(beautiful|perfect|amazing|wonderful|kind|special)\s+as\s+you)\b/i, category: 'excessive_flattery', weight: 0.4 },
  { p: /\b(i'?ve\s+never\s+(met|seen|found|known)\s+(anyone|someone|a\s+person)\s+(like|as)\s+you)\b/i, category: 'excessive_flattery', weight: 0.35 },
  { p: /\b(why\s+wait|let'?s\s+not\s+wait|don'?t\s+want\s+to\s+waste\s+time|time\s+is\s+precious|life'?s\s+too\s+short)\b/i, category: 'commitment_urgency', weight: 0.35 },
  { p: /\b(move\s+in\s+with\s+me|come\s+live\s+with\s+me|let'?s\s+be\s+together\s+forever|never\s+leave\s+me)\b/i, category: 'commitment_urgency', weight: 0.45 },
  { p: /\b(i\s+don'?t\s+want\s+to\s+share\s+you|you'?re\s+mine|all\s+mine|i\s+need\s+you\s+all\s+to\s+myself)\b/i, category: 'possessiveness', weight: 0.5 },
  { p: /\b(your\s+(friends|family|ex)\s+(don'?t\s+)?(understand|deserve|appreciate)\s+you)\b/i, category: 'isolation_seed', weight: 0.45 },
  { p: /\b(i'?m\s+the\s+only\s+one\s+who\s+(truly\s+)?(gets|understands|appreciates|loves)\s+you)\b/i, category: 'isolation_seed', weight: 0.5 },
  { p: /\b(i\s+want\s+to\s+(buy|give|get)\s+you\s+(everything|anything|the\s+world|whatever\s+you\s+want))\b/i, category: 'gift_bombing', weight: 0.35 },
  { p: /\b(you\s+deserve\s+(everything|the\s+world|only\s+the\s+best|all\s+the\s+love|spoiling))\b/i, category: 'gift_bombing', weight: 0.3 },
  { p: /\b(i'?ll\s+(never|never\s+ever)\s+(leave|hurt|betray|let\s+you\s+down|stop\s+loving)\s+you)\b/i, category: 'grandiose_promise', weight: 0.4 },
  { p: /\b(i\s+promise\s+(to\s+)?(always|never|be\s+there|make\s+you|give\s+you)\s+)/i, category: 'grandiose_promise', weight: 0.35 },
  { p: /\b(we'?re\s+(exactly|literally)\s+(the\s+same|alike|made\s+for\s+each\s+other|soulmates|twins))\b/i, category: 'mirroring', weight: 0.3 },
  { p: /\b(you\s+(complete|are\s+my\s+other\s+half|are\s+the\s+missing\s+piece))\b/i, category: 'mirroring', weight: 0.35 },
  { p: /\b(i\s+can'?t\s+(stop\s+)?thinking\s+about\s+you|you'?re\s+all\s+i\s+(think|dream|talk)\s+about|can'?t\s+eat|can'?t\s+sleep)\b/i, category: 'emotional_flooding', weight: 0.35 },
  { p: /\b(my\s+(heart|body|soul|world|life)\s+(aches|yearns|longs|beats)\s+for\s+you)\b/i, category: 'emotional_flooding', weight: 0.3 },
];

function computeVelocity(messages: Array<{ text: string; timestamp: number }>, windowMs: number): { count: number; avgGapMs: number; burstDetected: boolean } {
  if (messages.length < 2) return { count: messages.length, avgGapMs: Infinity, burstDetected: false };
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0]!.timestamp;
  const inWindow = sorted.filter(m => m.timestamp - first <= windowMs);
  const gaps: number[] = [];
  for (let i = 1; i < inWindow.length; i++) gaps.push(inWindow[i]!.timestamp - inWindow[i - 1]!.timestamp);
  const avgGap = gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : Infinity;
  return { count: inWindow.length, avgGapMs: avgGap, burstDetected: inWindow.length >= 15 && avgGap < 60000 };
}

export interface LoveBombingResult {
  detected: boolean;
  confidence: number;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  velocity: number;
  indicators: string[];
  recommendation: string;
  semanticMatchScore: number;
}
export async function loveBombDetect(
  messages: Array<{ text: string; timestamp: number }>,
  matchTimestamp: number,
  options?: { messageThreshold?: number; hoursThreshold?: number }
): Promise<LoveBombingResult> {
  const msgThreshold = options?.messageThreshold ?? 3;
  const hoursThreshold = options?.hoursThreshold ?? 72;
  const windowMs = hoursThreshold * 3_600_000;
  const earlyMessages = messages.filter(m => m.timestamp - matchTimestamp <= windowMs);
  const patterns: string[] = [], indicators: string[] = [];
  let rawScore = 0;
  for (const msg of earlyMessages) {
    for (const { p, category, weight } of LOVE_BOMB_PATTERNS_LIST) {
      if (p.test(msg.text)) { patterns.push(category); rawScore += weight; }
    }
  }
  const uniquePatterns = [...new Set(patterns)];
  const velocity = computeVelocity(earlyMessages, windowMs);
  if (velocity.count >= 30) { indicators.push('high_volume_early'); rawScore += 0.2; }
  if (velocity.burstDetected) { indicators.push('message_burst'); rawScore += 0.25; }
  if (velocity.avgGapMs < 120_000 && velocity.count >= 10) { indicators.push('rapid_fire_messaging'); rawScore += 0.15; }
  if (earlyMessages.length >= 8) {
    const sorted = [...earlyMessages].sort((a, b) => a.timestamp - b.timestamp);
    const half = Math.floor(sorted.length / 2);
    const fh = sorted.slice(0, half), sh = sorted.slice(half);
    const ag1 = fh.length >= 2 ? (fh[fh.length - 1]!.timestamp - fh[0]!.timestamp) / (fh.length - 1) : Infinity;
    const ag2 = sh.length >= 2 ? (sh[sh.length - 1]!.timestamp - sh[0]!.timestamp) / (sh.length - 1) : Infinity;
    if (ag1 > 0 && ag2 < ag1 * 0.5) { indicators.push('accelerating_frequency'); rawScore += 0.2; }
  }
  if (uniquePatterns.length >= 5) { indicators.push('multi_category_bombardment'); rawScore += 0.3; }
  else if (uniquePatterns.length >= 3) { indicators.push('diverse_love_bomb_patterns'); rawScore += 0.15; }
  if (earlyMessages.length >= msgThreshold) {
    const hitCount = earlyMessages.filter(m => LOVE_BOMB_PATTERNS_LIST.some(({ p }) => p.test(m.text))).length;
    const hitRate = hitCount / earlyMessages.length;
    if (hitRate >= 0.6) { indicators.push('high_hit_rate'); rawScore += 0.25; }
    else if (hitRate >= 0.4) { indicators.push('moderate_hit_rate'); rawScore += 0.1; }
  }
  let semanticMatchScore = 0;
  const allText = earlyMessages.map(m => m.text).join(' ');
  if (allText.length > 20) {
    const result = await matchScript(allText, LOVE_BOMB_SCRIPTS);
    semanticMatchScore = result.max;
    if (semanticMatchScore >= 0.7 && uniquePatterns.length === 0) { uniquePatterns.push('semantic_love_bomb'); indicators.push('semantic_match_no_keyword'); rawScore += 0.35; }
    else if (semanticMatchScore >= 0.5 && uniquePatterns.length === 0) { indicators.push('weak_semantic_match'); rawScore += 0.15; }
  }
  const first24h = earlyMessages.filter(m => m.timestamp - matchTimestamp <= 24 * 3_600_000);
  const first24hHits = first24h.filter(m => LOVE_BOMB_PATTERNS_LIST.some(({ p }) => p.test(m.text))).length;
  if (first24hHits >= 3) { indicators.push('very_early_intensity'); rawScore += 0.3; }
  const confidence = Math.min(1, rawScore / 2.0);
  const severity: LoveBombingResult['severity'] = confidence >= 0.8 ? 'critical' : confidence >= 0.6 ? 'high' : confidence >= 0.4 ? 'medium' : confidence >= 0.2 ? 'low' : 'none';
  const detected = confidence >= 0.3 && earlyMessages.length >= msgThreshold;
  const recommendation = severity === 'critical' ? 'CRITICAL: Extreme love bombing. Classic manipulation precursor. Alert user, recommend slowing down. Flag for monitoring.'
    : severity === 'high' ? 'HIGH: Intense early affection bombardment. Warn user about love bombing red flags. Monitor for escalation.'
    : severity === 'medium' ? 'MEDIUM: Elevated early affection patterns. Show educational content about healthy pacing.'
    : severity === 'low' ? 'LOW: Some early intensity. Monitor for acceleration.'
    : 'No significant love bombing detected.';
  return { detected, confidence: Math.round(confidence * 100) / 100, patterns: uniquePatterns, severity, velocity: velocity.count, indicators, recommendation, semanticMatchScore: Math.round(semanticMatchScore * 100) / 100 };
}
export const LOVE_BOMBING_PATTERNS = loveBombDetect;
export const loveBombDetect2 = loveBombDetect;
export const loveBomb = loveBombDetect;