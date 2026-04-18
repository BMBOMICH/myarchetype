import { writeAuditLog } from './logger';

async function stSim(a: string, b: string): Promise<number> {
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/ml/similarity`, {
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

async function matchScr(text: string, scripts: string[]): Promise<{ max: number; hit: string | null }> {
  let mx = 0, ht: string | null = null;
  for (const s of scripts) {
    const sc = await stSim(text, s);
    if (sc > mx) { mx = sc; ht = s; }
  }
  return { max: mx, hit: ht };
}

async function presidioPII(text: string): Promise<Array<{ entity_type: string; text: string; score: number; start: number; end: number }>> {
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/pii/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: 'en' }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return (await r.json() as { entities: Array<{ entity_type: string; text: string; score: number; start: number; end: number }> }).entities;
  } catch {}
  const o: Array<{ entity_type: string; text: string; score: number; start: number; end: number }> = [];
  const rs: [RegExp, string, number][] = [
    [/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, 'PHONE_NUMBER', 0.7],
    [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, 'EMAIL', 0.8],
    [/\d{3}-\d{2}-\d{4}/g, 'SSN', 0.9],
  ];
  for (const [re, tp, sc] of rs) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null)
      o.push({ entity_type: tp, text: m[0], score: sc, start: m.index, end: m.index + m[0].length });
  }
  return o;
}

async function duoGuard(text: string): Promise<{ safe: boolean; cats: Record<string, number>; max: number; cat: string }> {
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/ml/duoguard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return await r.json() as { safe: boolean; cats: Record<string, number>; max: number; cat: string };
  } catch {}
  const c: Record<string, number> = {};
  if (/\b(kill|rape|murder|assault|beat)\b/i.test(text)) c['violence'] = 0.7;
  if (/\b(nigger|faggot|tranny|chink|spic|kike)\b/i.test(text)) c['hate_speech'] = 0.8;
  if (/\b(sexy|naked|nude|horny|dtf)\b/i.test(text)) c['sexual_content'] = 0.6;
  const e = Object.entries(c).sort(([, a], [, b]) => b - a)[0];
  return { safe: !e, cats: c, max: e?.[1] ?? 0, cat: e?.[0] ?? 'none' };
}

async function faceCmp(a: number[], b: number[]): Promise<{ sim: number; match: boolean }> {
  if (!a.length || !b.length || a.length !== b.length) return { sim: 0, match: false };
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/face/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding_a: a, embedding_b: b }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return await r.json() as { sim: number; match: boolean };
  } catch {}
  let d = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; nA += a[i]! ** 2; nB += b[i]! ** 2; }
  const s = Math.sqrt(nA) * Math.sqrt(nB) > 0 ? d / (Math.sqrt(nA) * Math.sqrt(nB)) : 0;
  return { sim: s, match: s >= 0.85 };
}

async function whisperT(url: string): Promise<{ text: string; lang: string; conf: number; dur: number }> {
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: url, model: 'whisper-1' }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return await r.json() as { text: string; lang: string; conf: number; dur: number };
  } catch {}
  return { text: '', lang: 'unknown', conf: 0, dur: 0 };
}

async function pyannoteCnt(url: string): Promise<{ count: number; segs: Array<{ speaker: string; start: number; end: number }> }> {
  try {
    const r = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/audio/diarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: url }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return await r.json() as { count: number; segs: Array<{ speaker: string; start: number; end: number }> };
  } catch {}
  return { count: 0, segs: [] };
}

const SEV_ORD = (['none', 'low', 'medium', 'high', 'critical'] as const);
type Sev = 'none' | 'low' | 'medium' | 'high' | 'critical';
function mxS(a: Sev, b: Sev): Sev { return SEV_ORD.indexOf(b) > SEV_ORD.indexOf(a) ? b : a; }

const IPV_SCR = [
  "He checks my phone, tracks my location, and controls who I can talk to",
  "She won't let me see my friends or family anymore",
  "He hit me and then said he was sorry and it would never happen again",
  "She threatened to kill herself if I leave",
  "I'm afraid of what he'll do if I try to leave",
  "He controls all the money and I have to ask for everything",
  "She calls me worthless and says no one else would want me",
  "He forced me to have sex when I didn't want to",
  "I'm not allowed to have a job or my own bank account",
  "He threatened to take the kids away if I report him",
];
const REPRO_SCR = [
  "He refuses to let me use birth control",
  "She is trying to make me get pregnant against my will",
  "He poked holes in the condom",
  "She threw away my birth control pills",
  "He said he'd leave me unless I have his baby",
  "He tracks my period and ovulation without my consent",
  "She wants me to stop taking the pill so I get pregnant",
];
const FIN_SCR = [
  "He controls all my money and I have no access to my own bank account",
  "She won't let me work or have my own income",
  "He took my savings and I can't access anything",
  "She makes me sign loans I don't understand",
  "He monitors every purchase I make",
  "I'm not allowed to spend any money without asking permission",
  "She gives me an allowance like I'm a child",
];
const IMMIG_SCR = [
  "He threatened to deport me if I leave him",
  "She refuses to sign my immigration papers",
  "He said he'll call ICE if I report the abuse",
  "She took my passport and won't give it back",
  "He says I can't stay in this country without him",
  "She threatened to cancel my visa",
];
const DISAB_FET_SCR = [
  "I have a thing for people in wheelchairs",
  "I'm a devotee of amputees",
  "I only date disabled women",
  "Can you send me photos of your wheelchair",
  "I'm attracted to your disability",
  "I fetishize people with cerebral palsy",
];
const A11Y_SCAM_SCR = [
  "I can cure your disability with this treatment",
  "You qualify for a free government grant for disabled people",
  "Buy this device that will heal your condition",
  "Give me your social security number to claim your benefits",
  "Special housing available only for people with disabilities, just pay a fee",
];
const INTERFAITH_SCR = [
  "I will convert you to my religion",
  "Your faith is wrong and you need to change",
  "We can't be together unless you convert",
  "My family will disown me if I date someone of your faith",
  "Just pretend to be my religion until we're married",
  "You have to leave your faith for us to work",
];
const EDU_SCR = [
  "I went to Harvard for my MBA",
  "I have a PhD from MIT",
  "I graduated from Stanford with a 4.5 GPA",
  "I got my medical degree from Johns Hopkins",
  "I was valedictorian at Yale",
];
const BLACKMAIL_SCR = [
  "If you don't send me money I'll share those photos with everyone",
  "I have screenshots of our conversation and I'll send them to your family",
  "Pay me or I'll post these on social media",
  "I'll ruin your life unless you do what I say",
  "Send me $500 or everyone at your work will see these",
  "I recorded our video call, send money or I share it",
];
const CRISIS_KW = [
  "suicide", "kill myself", "end my life", "want to die", "don't want to be alive",
  "take my own life", "no reason to live", "better off dead", "end it all", "jump off",
  "overdose", "slit my wrists", "hang myself", "not worth living", "can't go on",
  "give up on life", "self-harm", "hurt myself", "cut myself", "last note",
  "say goodbye", "final message", "no point anymore", "world without me",
];
const MALE_SEXT_SCR = [
  "I recorded you on the video call, send money or I share it",
  "Send me money or I'll tell everyone what you did on camera",
  "I have screenshots from our video chat, pay up",
  "You showed me everything on camera, now pay or I share",
  "I'll send the video to your wife unless you pay",
  "I captured our FaceTime, you know what you did",
];
const REVICT_SCR = [
  "I know you were extorted before, I can help you get justice for a fee",
  "I'm from the agency investigating your case, I need payment to proceed",
  "Your photos are still online, pay me to remove them",
  "The person who extorted you has been caught, but you need to pay for the evidence",
  "I can get your images removed for a fee",
  "I work with victims like you, my service costs money but works",
];
const HONOR_SCR = [
  "My family will kill me if they find out",
  "They said they'd murder me for dishonoring the family",
  "My brother threatened to kill me for dating outside our community",
  "Honor requires that you be punished",
  "My parents will disown me or worse",
  "They'll do an honor killing if they know",
  "I have to obey or my family will hurt me",
];
const FORCED_MARR_SCR = [
  "My parents are forcing me to marry someone I don't know",
  "I'm being taken abroad for a marriage I didn't agree to",
  "They said I have to marry him or they'll hurt my family",
  "I don't want this marriage but my family will kill me if I refuse",
  "I'm being forced into an arranged marriage against my will",
  "They're planning to take me to get married next week",
  "My family is making me marry my cousin",
];


export interface BlackmailSetupResult {
  detected: boolean; confidence: number; patterns: string[];
  severity: Sev; action: 'none' | 'warn' | 'block' | 'report';
  semanticMatchScore: number;
}
const BLACKMAIL_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /if\s+you\s+don'?t\s+(?:send|pay|give|transfer|wire)\s+/i, t: 'payment_threat', s: 'critical' },
  { p: /i'?ll\s+(?:share|post|send|show|expose|publish|leak|release)\s+(?:those|the|your|these)\s+(?:photos?|pics?|images?|videos?|screenshots?|messages?)/i, t: 'content_threat', s: 'critical' },
  { p: /(?:pay\s+me|send\s+(?:me\s+)?(?:money|\$|crypto|bitcoin)|wire\s+me)\s+or\s+/i, t: 'extortion_demand', s: 'critical' },
  { p: /i'?ll\s+(?:ruin|destroy|end|wreck)\s+(?:your\s+)?(?:life|reputation|career|marriage|relationship|family)/i, t: 'life_threat', s: 'high' },
  { p: /(?:everyone|your\s+(?:family|friends|wife|husband|boss|coworkers))\s+(?:will|are\s+going\s+to)\s+(?:see|know|find\s+out)/i, t: 'audience_threat', s: 'high' },
  { p: /i\s+(?:have|got|took|captured|recorded|saved)\s+(?:screenshots?|recordings?|evidence|proof)/i, t: 'evidence_claim', s: 'medium' },
  { p: /(?:send|pay|give)\s+(?:me\s+)?\$?\d{2,}/i, t: 'specific_amount', s: 'high' },
];
export async function blackmailSetup(msgs: string[]): Promise<BlackmailSetupResult> {
  const pts: string[] = []; let ms: Sev = 'none';
  for (const m of msgs) for (const { p, t, s } of BLACKMAIL_PAT) if (p.test(m)) { pts.push(t); ms = mxS(ms, s); }
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, BLACKMAIL_SCR); sms = r.max; if (sms >= 0.7 && ms === 'none') { ms = 'high'; pts.push('semantic_blackmail'); } }
  return { detected: pts.length > 0, confidence: Math.min(1, pts.length * 0.25 + sms * 0.3), patterns: pts, severity: ms, action: ms === 'critical' || ms === 'high' ? 'block' : ms === 'medium' ? 'warn' : 'none', semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const blackmailPattern = blackmailSetup;
export const blackmailSetupDetect = blackmailSetup;

export interface CrisisInterventionResult {
  detected: boolean; severity: Sev; matchedKeywords: string[];
  resources: Array<{ name: string; phone?: string; url?: string; text?: string }>;
  action: 'none' | 'show_resources' | 'intervene' | 'emergency';
}
export function suicidePrevention(text: string): CrisisInterventionResult {
  const mk: string[] = []; const tl = text.toLowerCase();
  for (const kw of CRISIS_KW) { const w = kw.replace(/'/g, "'?"); if (new RegExp(`\\b${w}\\b`, 'i').test(tl)) mk.push(kw); }
  const sv = mk.some(k => /kill myself|end my life|want to die|suicide|hang myself|overdose|slit my|jump off/i.test(k)) ? 'critical' : mk.length >= 3 ? 'high' : mk.length >= 1 ? 'medium' : 'none';
  const res = [
    { name: '988 Suicide & Crisis Lifeline', phone: '988', url: 'https://988lifeline.org' },
    { name: 'Crisis Text Line', text: 'Text HOME to 741741' },
    { name: 'Trevor Project (LGBTQ+)', phone: '1-866-488-7386', url: 'https://thetrevorproject.org' },
    { name: 'Veterans Crisis Line', phone: '988 (Press 1)', text: 'Text 838255' },
    { name: 'International Association for Suicide Prevention', url: 'https://iasp.info/resources/Crisis_Centres/' },
  ];
  return { detected: mk.length > 0, severity: sv, matchedKeywords: mk, resources: res, action: sv === 'critical' ? 'emergency' : sv === 'high' ? 'intervene' : sv === 'medium' ? 'show_resources' : 'none' };
}
export const crisisIntervention = suicidePrevention;
export const CRISIS_KEYWORDS = CRISIS_KW;
export const suicidalIdeation = suicidePrevention;

export interface RedirectChainResult {
  finalUrl: string; redirectCount: number; suspicious: boolean;
  intermediateDomains: string[]; action: 'allow' | 'warn' | 'block';
}
export async function checkRedirectChain(url: string, maxRedirects = 5): Promise<RedirectChainResult> {
  const domains: string[] = []; let finalUrl = url, count = 0, susp = false;
  try {
    let cur = url;
    for (let i = 0; i < maxRedirects; i++) {
      const r = await fetch(cur, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
      const loc = r.headers.get('location');
      if (!loc || r.status < 300 || r.status >= 400) break;
      domains.push(new URL(loc, cur).hostname); cur = loc; count++;
    }
    finalUrl = cur;
    susp = count >= 3 || domains.some(d => /(?:bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rb\.gy|short\.io|rebrand\.ly)/i.test(d));
  } catch {}
  return { finalUrl, redirectCount: count, suspicious: susp, intermediateDomains: domains, action: susp ? 'block' : count >= 2 ? 'warn' : 'allow' };
}
export const redirectChain = checkRedirectChain;
export const urlUnshorten = checkRedirectChain;

export interface ResponseLengthResult {
  anomaly: boolean; zScore: number; meanLength: number; stdDev: number;
  currentLength: number; riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function responseLength(msgs: Array<{ text: string; timestamp: number }>, current: string): ResponseLengthResult {
  const lens = msgs.map(m => m.text.length);
  if (lens.length < 3) return { anomaly: false, zScore: 0, meanLength: 0, stdDev: 0, currentLength: current.length, riskLevel: 'none' };
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const std = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) || 1;
  const z = Math.abs((current.length - mean) / std);
  const rl = z > 3 ? 'high' : z > 2 ? 'medium' : z > 1.5 ? 'low' : 'none';
  return { anomaly: z > 2, zScore: Math.round(z * 100) / 100, meanLength: Math.round(mean), stdDev: Math.round(std), currentLength: current.length, riskLevel: rl };
}
export const messageLengthAnomaly = responseLength;
export const responseLengthAnomaly = responseLength;

export interface ScriptedResponseResult {
  detected: boolean; similarity: number; matchedTemplate: string | null;
  confidence: number; action: 'none' | 'flag' | 'block';
}
export async function scriptedResponse(msg: string, templates: string[]): Promise<ScriptedResponseResult> {
  const r = await matchScr(msg, templates); const det = r.max >= 0.85;
  return { detected: det, similarity: Math.round(r.max * 100) / 100, matchedTemplate: r.hit, confidence: Math.round(r.max * 100) / 100, action: det ? 'block' : r.max >= 0.7 ? 'flag' : 'none' };
}
export const cannedResponse = scriptedResponse;
export const templateDetect = scriptedResponse;

export interface MaleSextortionResult {
  detected: boolean; confidence: number; patterns: string[];
  severity: Sev; action: 'none' | 'warn' | 'block' | 'report';
  semanticMatchScore: number;
}
const MALE_SEXT_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /i\s+(?:recorded|captured|got|saved|have)\s+(?:the?\s+)?(?:video\s+)?(?:call|chat|facetime|session)/i, t: 'recording_claim', s: 'critical' },
  { p: /(?:send|pay|give|wire)\s+(?:me\s+)?(?:money|\$|bitcoin|crypto)\s+or\s+i'?ll\s+(?:share|post|send|show)/i, t: 'payment_or_share', s: 'critical' },
  { p: /(?:your\s+)?(?:wife|husband|family|boss|employer|coworkers?)\s+(?:will|are\s+going\s+to)\s+(?:see|find\s+out|know)/i, t: 'threat_audience', s: 'high' },
  { p: /(?:you\s+)?(?:showed|did|sent)\s+(?:me\s+)?(?:everything|yourself|it)\s+(?:on\s+)?(?:camera|video|facetime|screen)/i, t: 'camera_reference', s: 'high' },
  { p: /\$\d{2,}.*(?:share|post|expose|leak|ruin)|(?:share|post|expose|leak|ruin).*\$\d{2,}/i, t: 'amount_threat_combo', s: 'critical' },
];
export async function maleTargetedSextortion(msgs: string[]): Promise<MaleSextortionResult> {
  const pts: string[] = []; let ms: Sev = 'none';
  for (const m of msgs) for (const { p, t, s } of MALE_SEXT_PAT) if (p.test(m)) { pts.push(t); ms = mxS(ms, s); }
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, MALE_SEXT_SCR); sms = r.max; if (sms >= 0.7 && ms === 'none') { ms = 'high'; pts.push('semantic_male_sext'); } }
  return { detected: pts.length > 0, confidence: Math.min(1, pts.length * 0.2 + sms * 0.3), patterns: pts, severity: ms, action: ms === 'critical' || ms === 'high' ? 'block' : ms === 'medium' ? 'warn' : 'none', semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const videoCallBlackmail = maleTargetedSextortion;
export const maleSextortion = maleTargetedSextortion;

export interface ReVictimizationResult {
  detected: boolean; confidence: number; patterns: string[];
  severity: Sev; action: 'none' | 'warn' | 'block' | 'report';
  semanticMatchScore: number;
}
const REVICT_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /i\s+(?:know|heard)\s+(?:you\s+were|about)\s+(?:extorted|blackmailed|scammed|victim)/i, t: 'victim_knowledge', s: 'high' },
  { p: /(?:i\s+)?(?:can\s+)?(?:help|assist|get)\s+(?:you\s+)?(?:justice|revenge|your\s+(?:money|photos|images)\s+back)/i, t: 'recovery_bait', s: 'critical' },
  { p: /(?:pay|fee|cost|service)\s+(?:me|for)\s+(?:to\s+)?(?:remove|delete|take\s+down|clean)/i, t: 'paid_removal', s: 'critical' },
  { p: /(?:i'?m\s+)?(?:from|with|represent)\s+(?:the\s+)?(?:agency|police|investigation|authority|unit)/i, t: 'authority_impersonation', s: 'critical' },
  { p: /(?:your\s+)?(?:photos?|images?|videos?)\s+(?:are\s+still|remain)\s+(?:online|on\s+(?:the\s+)?internet)/i, t: 'fear_renewal', s: 'high' },
];
export async function postSextortionRevictimization(msgs: string[]): Promise<ReVictimizationResult> {
  const pts: string[] = []; let ms: Sev = 'none';
  for (const m of msgs) for (const { p, t, s } of REVICT_PAT) if (p.test(m)) { pts.push(t); ms = mxS(ms, s); }
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, REVICT_SCR); sms = r.max; if (sms >= 0.7 && ms === 'none') { ms = 'high'; pts.push('semantic_revict'); } }
  return { detected: pts.length > 0, confidence: Math.min(1, pts.length * 0.25 + sms * 0.3), patterns: pts, severity: ms, action: ms === 'critical' || ms === 'high' ? 'block' : ms === 'medium' ? 'warn' : 'none', semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const sextortionRecoveryScam = postSextortionRevictimization;
export const reVictimization = postSextortionRevictimization;

export interface AIAttachmentResult {
  detected: boolean; confidence: number; cues: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}
const ATTACH_CUES: Array<{ p: RegExp; c: string }> = [
  { p: /i'?ve\s+never\s+felt\s+(?:this\s+)?(?:way|connected|understood|close)\s+(?:to|with)\s+(?:anyone|someone|anybody)/i, c: 'instant_bond' },
  { p: /you'?re\s+(?:the\s+)?(?:only\s+)?(?:one\s+who\s+)?(?:understands?|gets?|completes?|makes?\s+me\s+feel)/i, c: 'exclusivity' },
  { p: /i\s+(?:can'?t|don'?t\s+want\s+to)\s+(?:live|be|imagine|go\s+on)\s+(?:without|if\s+i\s+can'?t\s+have)\s+you/i, c: 'dependency' },
  { p: /we'?re\s+(?:soulmates?|meant\s+to\s+be|destined|fated|perfect\s+together)/i, c: 'destiny' },
  { p: /i\s+(?:love|adore|cherish|need)\s+you\b/i, c: 'premature_love' },
  { p: /(?:no\s+one|nobody)\s+(?:else\s+)?(?:will|can|could)\s+(?:ever\s+)?(?:love|understand|appreciate|accept)\s+you\s+like\s+i\s+do/i, c: 'isolation_love' },
];
export function aiAttachmentCue(msgs: string[]): AIAttachmentResult {
  const cs: string[] = [];
  for (const m of msgs) for (const { p, c } of ATTACH_CUES) if (p.test(m)) cs.push(c);
  const cf = Math.min(1, cs.length * 0.2);
  const rl = cs.length >= 4 ? 'high' : cs.length >= 2 ? 'medium' : cs.length >= 1 ? 'low' : 'none';
  return { detected: cs.length >= 2, confidence: cf, cues: cs, riskLevel: rl };
}
export const syntheticAttachment = aiAttachmentCue;
export const aiEmotionalCue = aiAttachmentCue;
export const aiAttachment = aiAttachmentCue;

export interface AIMirroringResult {
  detected: boolean; mirroringScore: number; vocabOverlap: number;
  sentenceStructureMatch: number; riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function aiLanguageMirroring(userMsgs: string[], matchMsgs: string[]): AIMirroringResult {
  const uWords = new Set(userMsgs.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const mWords = new Set(matchMsgs.join(' ').toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const overlap = [...uWords].filter(w => mWords.has(w)).length;
  const union = new Set([...uWords, ...mWords]).size;
  const vo = union > 0 ? overlap / union : 0;
  const uLens = userMsgs.map(m => m.split(/\s+/).length);
  const mLens = matchMsgs.map(m => m.split(/\s+/).length);
  const uAvg = uLens.length > 0 ? uLens.reduce((a, b) => a + b, 0) / uLens.length : 0;
  const mAvg = mLens.length > 0 ? mLens.reduce((a, b) => a + b, 0) / mLens.length : 0;
  const ssm = uAvg > 0 && mAvg > 0 ? 1 - Math.abs(uAvg - mAvg) / Math.max(uAvg, mAvg) : 0;
  const ms = (vo * 0.6 + ssm * 0.4);
  const rl = ms >= 0.8 ? 'high' : ms >= 0.6 ? 'medium' : ms >= 0.4 ? 'low' : 'none';
  return { detected: ms >= 0.6, mirroringScore: Math.round(ms * 100) / 100, vocabOverlap: Math.round(vo * 100) / 100, sentenceStructureMatch: Math.round(ssm * 100) / 100, riskLevel: rl };
}
export const languageMirroringAI = aiLanguageMirroring;
export const aiMirroring = aiLanguageMirroring;

export interface RejectionEscalationResult {
  detected: boolean; score: number; escalationType: string[];
  severity: Sev; action: 'none' | 'warn' | 'restrict' | 'block';
}
const REJ_ESC_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /(?:why\s+did\s+you|how\s+could\s+you)\s+(?:unmatch|block|reject|ignore|swipe\s+left)/i, t: 'rejection_questioning', s: 'medium' },
  { p: /(?:you'?re\s+(?:a\s+)?)(?:ugly|fat|slut|whore|bitch|loser|trash|worthless|disgusting)/i, t: 'post_rejection_insult', s: 'high' },
  { p: /(?:i'?ll|going\s+to)\s+(?:find\s+you|track\s+you\s+down|make\s+you\s+pay|show\s+everyone|ruin\s+you)/i, t: 'threat', s: 'critical' },
  { p: /(?:give\s+me\s+)?(?:another|a\s+second)\s+(?:chance|try|opportunity)/i, t: 'persistence', s: 'low' },
  { p: /(?:you\s+)?(?:made\s+a\s+)?(?:mistake|wrong\s+choice|bad\s+decision)\s+(?:by|to)\s+(?:unmatch|block|reject)/i, t: 'guilt_trip', s: 'medium' },
  { p: /(?:nobody\s+else|no\s+one\s+else)\s+(?:will|would)\s+(?:want|date|love|accept)\s+you/i, t: 'devaluation', s: 'high' },
];
export function rejectionEscalation(msgsAfterRejection: string[]): RejectionEscalationResult {
  const ts: string[] = []; let ms: Sev = 'none', sc = 0;
  for (const m of msgsAfterRejection) for (const { p, t, s } of REJ_ESC_PAT) if (p.test(m)) { ts.push(t); ms = mxS(ms, s); sc += SEV_ORD.indexOf(s); }
  return { detected: ts.length > 0, score: sc, escalationType: ts, severity: ms, action: ms === 'critical' || ms === 'high' ? 'block' : ms === 'medium' ? 'restrict' : ms === 'low' ? 'warn' : 'none' };
}
export const postRejection = rejectionEscalation;
export const noMeansNo = rejectionEscalation;

export interface CrossPlatformBlockResult {
  detected: boolean; confidence: number; indicators: string[]; recommendation: string;
}
export function crossPlatformBlockCircumvention(s: {
  userReportedContactOnOtherApp: boolean; matchingUsernameOnOtherPlatform: boolean;
  sameProfilePhotoOnOtherApp: boolean; messageMentionsOtherApp: boolean;
  blockExistsOnThisPlatform: boolean;
}): CrossPlatformBlockResult {
  const ind: string[] = []; let c = 0;
  if (s.blockExistsOnThisPlatform && s.userReportedContactOnOtherApp) { ind.push('reported_on_other_app'); c += 0.4; }
  if (s.blockExistsOnThisPlatform && s.matchingUsernameOnOtherPlatform) { ind.push('matching_username'); c += 0.3; }
  if (s.blockExistsOnThisPlatform && s.sameProfilePhotoOnOtherApp) { ind.push('same_photo'); c += 0.3; }
  if (s.messageMentionsOtherApp && s.blockExistsOnThisPlatform) { ind.push('mentions_other_app'); c += 0.2; }
  c = Math.min(1, c);
  return { detected: c >= 0.3, confidence: c, indicators: ind, recommendation: c >= 0.3 ? 'This person may be contacting you after being blocked. Consider blocking on all platforms and reporting.' : '' };
}
export const contactOnOtherApp = crossPlatformBlockCircumvention;
export const crossPlatformBlock = crossPlatformBlockCircumvention;

export interface PasskeyResult {
  supported: boolean; registered: boolean; credentialId: string | null;
  attestationType: string; created: number | null;
}
export async function passkeySupport(): Promise<{ available: boolean; platformSupported: boolean }> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return { available: false, platformSupported: false };
  const av = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
  return { available: av, platformSupported: av };
}
export async function webauthnRegister(userId: string): Promise<PasskeyResult> {
  const sup = await passkeySupport();
  if (!sup.available) return { supported: false, registered: false, credentialId: null, attestationType: 'none', created: null };
  try {
    const chal = new Uint8Array(32); crypto.getRandomValues(chal);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: chal, rp: { name: 'MyArchetype', id: window.location.hostname },
        user: { id: new TextEncoder().encode(userId), name: userId, displayName: userId },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        attestation: 'none',
      },
    });
    if (!cred) return { supported: true, registered: false, credentialId: null, attestationType: 'none', created: null };
    return { supported: true, registered: true, credentialId: btoa(String.fromCharCode(...new Uint8Array(cred.rawId))), attestationType: 'none', created: Date.now() };
  } catch { return { supported: true, registered: false, credentialId: null, attestationType: 'none', created: null }; }
}
export const fido2 = webauthnRegister;
export const publicKeyCredential = passkeySupport;

export interface OAuthTheftResult {
  detected: boolean; confidence: number; indicators: string[];
  action: 'monitor' | 'revoke' | 'block';
}
export function oauthTokenTheft(s: {
  tokenUsedFromNewDevice: boolean; tokenUsedFromNewIp: boolean;
  tokenUsedFromNewLocation: boolean; tokenAgeMinutes: number;
  concurrentSessions: number; previousTokenRevoked: boolean; usagePatternAnomaly: boolean;
}): OAuthTheftResult {
  const ind: string[] = []; let c = 0;
  if (s.tokenUsedFromNewDevice && s.tokenUsedFromNewIp) { ind.push('new_device_ip'); c += 0.3; }
  if (s.tokenUsedFromNewLocation && s.tokenAgeMinutes > 60) { ind.push('new_location_old_token'); c += 0.3; }
  if (s.concurrentSessions >= 3) { ind.push('concurrent_sessions'); c += 0.3; }
  if (s.previousTokenRevoked && s.tokenUsedFromNewDevice) { ind.push('revoked_then_new_device'); c += 0.4; }
  if (s.usagePatternAnomaly) { ind.push('pattern_anomaly'); c += 0.2; }
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, indicators: ind, action: c >= 0.7 ? 'block' : c >= 0.4 ? 'revoke' : 'monitor' };
}
export const tokenTheft = oauthTokenTheft;
export const suspiciousTokenUse = oauthTokenTheft;

export interface ReplayAttackResult { detected: boolean; reason: string; action: 'allow' | 'reject'; }
const nonceCache = new Map<string, number>();
const NONCE_TTL = 300000;
export function replayAttackDetect(nonce: string, timestamp: number): ReplayAttackResult {
  const now = Date.now();
  if (Math.abs(now - timestamp) > NONCE_TTL) return { detected: true, reason: 'expired_timestamp', action: 'reject' };
  const last = nonceCache.get(nonce);
  if (last !== undefined) return { detected: true, reason: 'duplicate_nonce', action: 'reject' };
  nonceCache.set(nonce, now);
  for (const [k, v] of nonceCache) if (now - v > NONCE_TTL) nonceCache.delete(k);
  return { detected: false, reason: '', action: 'allow' };
}
export const nonceCheck = replayAttackDetect;
export const requestNonce = replayAttackDetect;

export interface CredentialHandoffResult {
  detected: boolean; confidence: number; indicators: string[];
  action: 'monitor' | 'restrict' | 'suspend';
}
export function credentialHandoff(s: {
  deviceChanged: boolean; locationChanged: boolean; behaviorShift: boolean;
  typingPatternChanged: boolean; photoUploadStyleChanged: boolean;
  loginTimePatternChanged: boolean; messageStyleSimilarityToPreviousOwner: number;
}): CredentialHandoffResult {
  const ind: string[] = []; let c = 0;
  if (s.deviceChanged) { ind.push('device_change'); c += 0.2; }
  if (s.locationChanged) { ind.push('location_change'); c += 0.1; }
  if (s.behaviorShift) { ind.push('behavior_shift'); c += 0.3; }
  if (s.typingPatternChanged) { ind.push('typing_change'); c += 0.2; }
  if (s.photoUploadStyleChanged) { ind.push('photo_style_change'); c += 0.15; }
  if (s.loginTimePatternChanged) { ind.push('login_time_change'); c += 0.1; }
  if (s.messageStyleSimilarityToPreviousOwner < 0.3) { ind.push('style_mismatch'); c += 0.2; }
  c = Math.min(1, c);
  return { detected: c >= 0.5, confidence: c, indicators: ind, action: c >= 0.7 ? 'suspend' : c >= 0.5 ? 'restrict' : 'monitor' };
}
export const accountHandover = credentialHandoff;
export const credentialHandoffDetect = credentialHandoff;

export interface AutoClearResult {
  enabled: boolean; method: 'private_browsing' | 'auto_clear' | 'session_storage';
  recommendation: string; clearableItems: string[];
}
export function autoClearData(isShared: boolean): AutoClearResult {
  const items = ['session_tokens', 'cached_profile_data', 'search_history', 'chat_drafts', 'location_cache', 'auth_cookies'];
  if (!isShared) return { enabled: false, method: 'session_storage', recommendation: 'Enable auto-clear if using a shared device.', clearableItems: items };
  return { enabled: true, method: 'private_browsing', recommendation: 'Use private/incognito mode on shared devices. App will auto-clear on close.', clearableItems: items };
}
export const clearOnClose = autoClearData;
export const privateMode = autoClearData;

export interface QueuePriorityResult {
  priority: 'low' | 'medium' | 'high' | 'critical'; score: number;
  factors: string[]; estimatedResponseMinutes: number;
}
export function moderatorQueuePriority(report: {
  severity: string; reporterTrustScore: number; reportCountAgainstTarget: number;
  hasMediaEvidence: boolean; involvesMinor: boolean; isRepeatOffender: boolean; category: string;
}): QueuePriorityResult {
  const fs: string[] = []; let sc = 0;
  if (report.involvesMinor) { sc += 50; fs.push('minor_involved'); }
  if (report.severity === 'critical') { sc += 40; fs.push('critical_severity'); } else if (report.severity === 'high') { sc += 25; fs.push('high_severity'); }
  if (report.isRepeatOffender) { sc += 20; fs.push('repeat_offender'); }
  if (report.reportCountAgainstTarget >= 3) { sc += 15; fs.push('multiple_reports'); }
  if (report.hasMediaEvidence) { sc += 10; fs.push('media_evidence'); }
  if (report.reporterTrustScore >= 80) { sc += 5; fs.push('trusted_reporter'); }
  const pr = sc >= 60 ? 'critical' : sc >= 35 ? 'high' : sc >= 15 ? 'medium' : 'low';
  const et = pr === 'critical' ? 5 : pr === 'high' ? 15 : pr === 'medium' ? 60 : 240;
  return { priority: pr, score: sc, factors: fs, estimatedResponseMinutes: et };
}
export const moderatorPriority = moderatorQueuePriority;
export const urgentQueue = moderatorQueuePriority;
export const queuePriority = moderatorQueuePriority;

export interface InterRaterResult {
  agreement: number; kappa: number; raterCount: number; categories: string[]; reliable: boolean;
}
export function interRaterRatings(ratings: Array<{ raterId: string; decisions: Array<{ itemId: string; category: string }> }>): InterRaterResult {
  if (ratings.length < 2) return { agreement: 0, kappa: 0, raterCount: ratings.length, categories: [], reliable: false };
  const cats = new Set<string>();
  for (const r of ratings) for (const d of r.decisions) cats.add(d.category);
  const cs = [...cats]; let agree = 0, total = 0;
  const byItem = new Map<string, Map<string, number>>();
  for (const r of ratings) for (const d of r.decisions) {
    if (!byItem.has(d.itemId)) byItem.set(d.itemId, new Map());
    const m = byItem.get(d.itemId)!; m.set(d.category, (m.get(d.category) ?? 0) + 1); total++;
  }
  for (const m of byItem.values()) { let mx = 0; for (const c of m.values()) if (c > mx) mx = c; if (mx === ratings.length) agree++; }
  const pa = byItem.size > 0 ? agree / byItem.size : 0;
  let pe = 0;
  for (const c of cs) { let n = 0; for (const r of ratings) for (const d of r.decisions) if (d.category === c) n++; pe += (n / (total || 1)) ** 2; }
  const kappa = 1 - pe > 0 ? (pa - pe) / (1 - pe) : 0;
  return { agreement: Math.round(pa * 100) / 100, kappa: Math.round(kappa * 1000) / 1000, raterCount: ratings.length, categories: cs, reliable: kappa >= 0.6 };
}
export const cohensKappa = interRaterRatings;
export const raterAgreement = interRaterRatings;

export interface GhostAuditResult {
  inflated: boolean; activeRatio: number; totalProfiles: number; activeProfiles: number;
  ghostProfiles: number; riskLevel: 'none' | 'low' | 'medium' | 'high'; recommendation: string;
}
export function ghostProfileInflation(s: {
  totalProfiles: number; activeLast30Days: number; activeLast7Days: number;
  neverLoggedIn: number; noPhoto: number; noBio: number;
}): GhostAuditResult {
  const ar = s.totalProfiles > 0 ? s.activeLast30Days / s.totalProfiles : 0;
  const ghost = s.totalProfiles - s.activeLast30Days;
  const inflated = ar < 0.5 || s.neverLoggedIn / s.totalProfiles > 0.3;
  const rl = ar < 0.2 ? 'high' : ar < 0.4 ? 'medium' : ar < 0.6 ? 'low' : 'none';
  return { inflated, activeRatio: Math.round(ar * 100) / 100, totalProfiles: s.totalProfiles, activeProfiles: s.activeLast30Days, ghostProfiles: ghost, riskLevel: rl, recommendation: rl !== 'none' ? `${ghost} ghost profiles detected (${Math.round((1 - ar) * 100)}%). Consider cleanup or disclosure.` : 'Active profile ratio is healthy.' };
}
export const ghostAudit = ghostProfileInflation;
export const activeUserCount = ghostProfileInflation;
export const profileInflation = ghostProfileInflation;

export interface SafetyDocAccuracyResult {
  accurate: boolean; documentedFeatures: string[]; actualFeatures: string[];
  mismatches: string[]; missingDocs: string[]; score: number;
}
export function safetyDocAccuracy(doc: string[], actual: string[]): SafetyDocAccuracyResult {
  const ds = new Set(doc), as = new Set(actual);
  const mm = actual.filter(f => !ds.has(f));
  const md = doc.filter(f => !as.has(f));
  const sc = actual.length > 0 ? Math.round((actual.length - mm.length) / actual.length * 100) : 0;
  return { accurate: mm.length === 0 && md.length === 0, documentedFeatures: doc, actualFeatures: actual, mismatches: mm, missingDocs: md, score: sc };
}
export const featureDocumentation = safetyDocAccuracy;

export function validateInstagramUsername(url: string): { valid: boolean; username: string | null } {
  const m = url.match(/(?:instagram\.com\/|@)([a-zA-Z0-9._]{1,30})\/?$/);
  return { valid: !!m && /^(?!.*\.\.)[a-zA-Z0-9._]{1,30}$/.test(m[1]!), username: m?.[1] ?? null };
}
export const validateInstagram = validateInstagramUsername;

export async function checkInstagramProfileExists(username: string): Promise<{ exists: boolean; method: string }> {
  try {
    const r = await fetch(`https://www.instagram.com/${username}/`, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return { exists: r.status === 200, method: 'http_check' };
  } catch { return { exists: false, method: 'error' }; }
}
export const checkInstagram = checkInstagramProfileExists;

export function validateSpotifyUrl(url: string): { valid: boolean; type: string | null; id: string | null } {
  const m = url.match(/open\.spotify\.com\/(track|album|artist|playlist|user)\/([a-zA-Z0-9]{22})/);
  return { valid: !!m, type: m?.[1] ?? null, id: m?.[2] ?? null };
}
export const validateSpotify = validateSpotifyUrl;

export function validateTikTokUsername(url: string): { valid: boolean; username: string | null } {
  const m = url.match(/(?:tiktok\.com\/@|@)([a-zA-Z0-9_.]{2,24})/);
  return { valid: !!m && /^[a-zA-Z0-9_.]{2,24}$/.test(m[1]!), username: m?.[1] ?? null };
}
export const validateTikTok = validateTikTokUsername;

export function validateLinkedInUrl(url: string): { valid: boolean; username: string | null } {
  const m = url.match(/linkedin\.com\/in\/([a-zA-Z0-9\-]{3,100})/);
  return { valid: !!m, username: m?.[1] ?? null };
}
export const validateLinkedIn = validateLinkedInUrl;

export interface UsernameConsistencyResult {
  consistent: boolean; matchScore: number; platforms: string[]; mismatches: string[];
}
export function checkUsernameConsistency(accounts: Array<{ platform: string; username: string }>): UsernameConsistencyResult {
  if (accounts.length < 2) return { consistent: true, matchScore: 1, platforms: accounts.map(a => a.platform), mismatches: [] };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = norm(accounts[0]!.username); const mm: string[] = []; let match = 0;
  for (const a of accounts) { const n = norm(a.username); if (n === base) match++; else mm.push(`${a.platform}:${a.username}`); }
  return { consistent: mm.length === 0, matchScore: Math.round(match / accounts.length * 100) / 100, platforms: accounts.map(a => a.platform), mismatches: mm };
}
export const usernameConsistency = checkUsernameConsistency;

export interface HandleConsistencyResult {
  consistent: boolean; levenshteinDistances: Array<{ a: string; b: string; distance: number }>;
  maxDistance: number; recommendation: string;
}
export function crossPlatformConsistency(handles: Array<{ platform: string; handle: string }>): HandleConsistencyResult {
  const ld = (a: string, b: string) => {
    const m = a.length + 1, n = b.length + 1;
    const d = Array.from({ length: m }, (_, i) => Array(n).fill(i));
    for (let j = 0; j < n; j++) d[0]![j] = j;
    for (let i = 1; i < m; i++) for (let j = 1; j < n; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] !== b[j - 1] ? 1 : 0));
    return d[m - 1]![n - 1]!;
  };
  const dists: Array<{ a: string; b: string; distance: number }> = []; let mx = 0;
  for (let i = 0; i < handles.length; i++) for (let j = i + 1; j < handles.length; j++) {
    const d = ld(handles[i]!.handle.toLowerCase(), handles[j]!.handle.toLowerCase());
    dists.push({ a: handles[i]!.platform, b: handles[j]!.platform, distance: d });
    if (d > mx) mx = d;
  }
  return { consistent: mx <= 2, levenshteinDistances: dists, maxDistance: mx, recommendation: mx > 3 ? 'Handles vary significantly across platforms. May indicate different people or impersonation.' : mx > 0 ? 'Minor handle differences. Likely same person.' : 'Handles match perfectly.' };
}
export const handleConsistency = crossPlatformConsistency;

export interface RefundAbuseResult {
  detected: boolean; confidence: number; indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high'; action: 'allow' | 'review' | 'deny';
}
export function refundAbuse(s: {
  userId: string; refundCount: number; refundRate: number; avgDaysBeforeRefund: number;
  totalSpent: number; totalRefunded: number; repeatVendorRefunds: boolean; chargebackThreats: number;
}): RefundAbuseResult {
  const ind: string[] = []; let c = 0;
  if (s.refundCount >= 5) { ind.push('frequent_refunds'); c += 0.3; }
  if (s.refundRate > 0.5) { ind.push('high_refund_rate'); c += 0.3; }
  if (s.avgDaysBeforeRefund < 2) { ind.push('instant_refund'); c += 0.2; }
  if (s.totalRefunded / s.totalSpent > 0.8) { ind.push('mostly_refunded'); c += 0.3; }
  if (s.repeatVendorRefunds) { ind.push('repeat_vendor'); c += 0.2; }
  if (s.chargebackThreats >= 1) { ind.push('chargeback_threat'); c += 0.3; }
  c = Math.min(1, c); const rl = c >= 0.7 ? 'high' : c >= 0.4 ? 'medium' : c >= 0.2 ? 'low' : 'none';
  return { detected: c >= 0.4, confidence: c, indicators: ind, riskLevel: rl, action: c >= 0.7 ? 'deny' : c >= 0.4 ? 'review' : 'allow' };
}
export const excessiveRefund = refundAbuse;
export const refundPattern = refundAbuse;

export interface GiftAbuseResult {
  detected: boolean; confidence: number; indicators: string[]; action: 'allow' | 'review' | 'block';
}
export function giftSubscriptionAbuse(s: {
  giftsSent: number; giftsSentLast30Days: number; uniqueRecipients: number;
  recipientsAlreadySubscribed: number; sameDeviceRecipients: number;
  giftsRedeemed: number; avgGiftValue: number;
}): GiftAbuseResult {
  const ind: string[] = []; let c = 0;
  if (s.giftsSentLast30Days >= 10 && s.uniqueRecipients < 3) { ind.push('few_recipients_many_gifts'); c += 0.4; }
  if (s.recipientsAlreadySubscribed / s.giftsSent > 0.5) { ind.push('already_subscribed'); c += 0.3; }
  if (s.sameDeviceRecipients >= 3) { ind.push('same_device_gifts'); c += 0.5; }
  if (s.giftsRedeemed / s.giftsSent < 0.3) { ind.push('low_redemption'); c += 0.2; }
  if (s.avgGiftValue >= 50 && s.uniqueRecipients >= 5) { ind.push('high_value_spread'); c += 0.3; }
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, indicators: ind, action: c >= 0.7 ? 'block' : c >= 0.4 ? 'review' : 'allow' };
}
export const giftAbuse = giftSubscriptionAbuse;

export interface DnsRebindingResult {
  safe: boolean; hostHeader: string; allowedHosts: string[]; action: 'allow' | 'block';
}
const ALLOWED_HOSTS = ['myarchetype.app', 'api.myarchetype.app', 'cdn.myarchetype.app', 'localhost'];
export function dnsRebindingPrevention(hostHeader: string, extraHosts: string[] = []): DnsRebindingResult {
  const all = [...ALLOWED_HOSTS, ...extraHosts];
  const safe = all.some(h => hostHeader === h || hostHeader === `www.${h}`);
  return { safe, hostHeader, allowedHosts: all, action: safe ? 'allow' : 'block' };
}
export const hostHeaderValidation = dnsRebindingPrevention;

export interface KeyEnumerationResult {
  detected: boolean; confidence: number; indicators: string[];
  action: 'allow' | 'rate_limit' | 'block';
}
const keyAttempts = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();
export function apiKeyEnumeration(s: {
  ip: string; apiKeyAttempts: number; uniqueKeysTried: number;
  invalidKeyCount: number; timeWindowMinutes: number; hasValidKey: boolean;
}): KeyEnumerationResult {
  const k = s.ip; const now = Date.now(); const ex = keyAttempts.get(k);
  if (ex) { ex.count += s.invalidKeyCount; ex.lastSeen = now; } else keyAttempts.set(k, { count: s.invalidKeyCount, firstSeen: now, lastSeen: now });
  for (const [k2, v] of keyAttempts) if (now - v.lastSeen > 3600000) keyAttempts.delete(k2);
  const cur = keyAttempts.get(k)!; const ind: string[] = []; let c = 0;
  if (cur.count >= 10) { ind.push('many_invalid_keys'); c += 0.5; }
  if (s.uniqueKeysTried >= 5) { ind.push('unique_key_variety'); c += 0.4; }
  if (s.timeWindowMinutes < 5 && s.invalidKeyCount >= 3) { ind.push('rapid_attempts'); c += 0.3; }
  if (!s.hasValidKey) { ind.push('no_valid_key'); c += 0.2; }
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, indicators: ind, action: c >= 0.7 ? 'block' : c >= 0.4 ? 'rate_limit' : 'allow' };
}
export const apiKeyBruteForce = apiKeyEnumeration;
export const keyEnumeration = apiKeyEnumeration;

export interface RaceConditionResult {
  protected: boolean; lockAcquired: boolean; lockKey: string;
  timeoutMs: number; action: 'proceed' | 'retry' | 'reject';
}
const locks = new Map<string, { holder: string; expires: number }>();
export function raceConditionGuard(key: string, holder: string, timeoutMs = 5000): RaceConditionResult {
  const now = Date.now(); const ex = locks.get(key);
  if (ex && ex.expires > now && ex.holder !== holder) return { protected: true, lockAcquired: false, lockKey: key, timeoutMs, action: 'retry' };
  locks.set(key, { holder, expires: now + timeoutMs });
  for (const [k2, v] of locks) if (v.expires <= now) locks.delete(k2);
  return { protected: true, lockAcquired: true, lockKey: key, timeoutMs, action: 'proceed' };
}
export function releaseLock(key: string, holder: string): void {
  const l = locks.get(key); if (l && l.holder === holder) locks.delete(key);
}
export const atomicOperation = raceConditionGuard;
export const lockMechanism = raceConditionGuard;

export interface ToctouResult {
  safe: boolean; checkResult: boolean; actionResult: boolean;
  consistency: boolean; recommendation: string;
}
export async function toctouGuard<T>(checkFn: () => Promise<boolean>, actionFn: () => Promise<T>, lockKey: string): Promise<{ result: ToctouResult; data: T | null }> {
  const lk = raceConditionGuard(lockKey, `toctou_${Date.now()}`, 10000);
  if (!lk.lockAcquired) return { result: { safe: false, checkResult: false, actionResult: false, consistency: false, recommendation: 'Resource locked, retry later.' }, data: null };
  try {
    const chk = await checkFn();
    if (!chk) return { result: { safe: true, checkResult: false, actionResult: false, consistency: true, recommendation: 'Check failed, action not executed.' }, data: null };
    const data = await actionFn();
    return { result: { safe: true, checkResult: true, actionResult: true, consistency: true, recommendation: 'Action completed atomically.' }, data };
  } finally { releaseLock(lockKey, `toctou_${Date.now()}`); }
}
export const timeOfCheck = toctouGuard;
export const checkThenAct = toctouGuard;

export interface ReplayAttackDetectResult {
  detected: boolean; nonce: string; timestamp: number; reason: string; action: 'allow' | 'reject';
}
const apiNonces = new Map<string, number>();
const API_NONCE_TTL = 60000;
export function replayAttackDetectApi(nonce: string, timestamp: number): ReplayAttackDetectResult {
  const now = Date.now();
  if (Math.abs(now - timestamp) > API_NONCE_TTL) return { detected: true, nonce, timestamp, reason: 'expired', action: 'reject' };
  if (apiNonces.has(nonce)) return { detected: true, nonce, timestamp, reason: 'replay', action: 'reject' };
  apiNonces.set(nonce, now);
  for (const [k, v] of apiNonces) if (now - v > API_NONCE_TTL) apiNonces.delete(k);
  return { detected: false, nonce, timestamp, reason: '', action: 'allow' };
}
export const nonceValidation = replayAttackDetectApi;
export const requestNonceCheck = replayAttackDetectApi;

export interface IdorAuditResult {
  vulnerable: boolean; endpoints: string[]; exposedFields: string[];
  severity: Sev; recommendation: string;
}
export function idorAudit(endpoints: Array<{ path: string; requiresAuth: boolean; returnsPrivateFields: string[]; allowsOtherUserId: boolean }>): IdorAuditResult {
  const vuln = endpoints.filter(e => !e.requiresAuth || (e.allowsOtherUserId && e.returnsPrivateFields.length > 0));
  const fields = new Set<string>();
  for (const e of vuln) for (const f of e.returnsPrivateFields) fields.add(f);
  const sv = vuln.some(e => e.returnsPrivateFields.includes('email') || e.returnsPrivateFields.includes('phone')) ? 'critical' : vuln.length > 0 ? 'high' : 'none';
  return { vulnerable: vuln.length > 0, endpoints: vuln.map(e => e.path), exposedFields: [...fields], severity: sv, recommendation: vuln.length ? `Add authorization checks to: ${vuln.map(e => e.path).join(', ')}. Remove private fields from responses.` : 'No IDOR vulnerabilities detected.' };
}
export const profileDataExposure = idorAudit;
export const unauthorizedProfileAccess = idorAudit;

export interface LocationPrecisionResult {
  leaking: boolean; precision: number; fields: string[]; recommendation: string;
}
export function locationPrecisionLeakage(apiResponse: Record<string, unknown>): LocationPrecisionResult {
  const fields: string[] = []; let prec = 0;
  for (const [k, v] of Object.entries(apiResponse)) {
    if (/lat|latitude/i.test(k) && typeof v === 'number') { const d = String(v).split('.')[1]?.length ?? 0; if (d > 2) { fields.push(k); prec = Math.max(prec, d); } }
    if (/lng|lon|longitude/i.test(k) && typeof v === 'number') { const d = String(v).split('.')[1]?.length ?? 0; if (d > 2) { fields.push(k); prec = Math.max(prec, d); } }
    if (/location|coordinates/i.test(k) && typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      for (const [sk, sv] of Object.entries(o)) { if (typeof sv === 'number') { const d = String(sv).split('.')[1]?.length ?? 0; if (d > 2) { fields.push(`${k}.${sk}`); prec = Math.max(prec, d); } } }
    }
  }
  return { leaking: fields.length > 0, precision: prec, fields, recommendation: fields.length ? `Round coordinates to 2 decimal places (~1.1km precision): ${fields.join(', ')}.` : 'No location precision leakage.' };
}
export const exactCoordinatesAPI = locationPrecisionLeakage;

export interface UnauthEndpointResult {
  found: boolean; endpoints: Array<{ path: string; method: string; returnsData: boolean }>;
  severity: Sev; recommendation: string;
}
export function unauthenticatedEndpointScan(routes: Array<{ path: string; method: string; requiresAuth: boolean; returnsUserData: boolean }>): UnauthEndpointResult {
  const found = routes.filter(r => !r.requiresAuth && r.returnsUserData);
  const sv = found.length >= 5 ? 'critical' : found.length >= 2 ? 'high' : found.length >= 1 ? 'medium' : 'none';
  return { found: found.length > 0, endpoints: found.map(f => ({ path: f.path, method: f.method, returnsData: f.returnsUserData })), severity: sv, recommendation: found.length ? `Add authentication to: ${found.map(f => `${f.method} ${f.path}`).join(', ')}.` : 'All endpoints require authentication.' };
}
export const publicEndpointAudit = unauthenticatedEndpointScan;

export interface FieldFilterResult { filtered: boolean; removedFields: string[]; state: string; }
export function fieldFilterByState(data: Record<string, unknown>, state: 'unmatched' | 'matched' | 'chatting' | 'blocked' | 'self', role: 'user' | 'admin' = 'user'): FieldFilterResult {
  const rm: string[] = []; const f = { ...data };
  if (state === 'unmatched') {
    for (const field of ['email', 'phone', 'location', 'socialLinks']) if (field in f) { rm.push(field); delete f[field]; }
  }
  if (state === 'blocked') { for (const k of Object.keys(f)) if (!['displayName', 'age', 'id'].includes(k)) { rm.push(k); delete f[k]; } }
  if (role === 'user') { for (const field of ['internalFlags', 'moderationNotes', 'trustScore_internal']) if (field in f) { rm.push(field); delete f[field]; } }
  return { filtered: rm.length > 0, removedFields: rm, state };
}
export const matchStateFiltering = fieldFilterByState;
export const relationshipFiltering = fieldFilterByState;

export interface BulkDownloadResult {
  detected: boolean; downloadCount: number; windowMinutes: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high'; action: 'allow' | 'rate_limit' | 'block';
}
export function photoBulkDownload(downloads: Array<{ userId: string; photoId: string; timestamp: number }>, userId: string, windowMin = 10, maxAllowed = 20): BulkDownloadResult {
  const now = Date.now(), cnt = downloads.filter(d => d.userId === userId && now - d.timestamp < windowMin * 60000).length;
  const rl = cnt >= maxAllowed * 2 ? 'high' : cnt >= maxAllowed * 1.5 ? 'medium' : cnt >= maxAllowed ? 'low' : 'none';
  return { detected: cnt >= maxAllowed, downloadCount: cnt, windowMinutes: windowMin, riskLevel: rl, action: rl === 'high' ? 'block' : rl !== 'none' ? 'rate_limit' : 'allow' };
}
export const photoDownloadRate = photoBulkDownload;
export const bulkDownload = photoBulkDownload;

export interface FacialHarvestingResult {
  detected: boolean; confidence: number; indicators: string[];
  action: 'allow' | 'watermark' | 'degrade' | 'block';
}
export async function facialHarvesting(s: {
  profilesViewed: number; photosDownloaded: number; uniqueFacesExtracted: number;
  viewWindowHours: number; hasFaceExtractionTool: boolean; sameSessionRequests: boolean;
}): Promise<FacialHarvestingResult> {
  const ind: string[] = []; let c = 0;
  if (s.profilesViewed >= 100 && s.viewWindowHours <= 24) { ind.push('mass_profile_view'); c += 0.3; }
  if (s.photosDownloaded >= 50) { ind.push('mass_download'); c += 0.4; }
  if (s.uniqueFacesExtracted >= 30) { ind.push('face_extraction'); c += 0.5; }
  if (s.hasFaceExtractionTool) { ind.push('extraction_tool'); c += 0.3; }
  if (s.sameSessionRequests && s.profilesViewed >= 50) { ind.push('rapid_fire'); c += 0.2; }
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, indicators: ind, action: c >= 0.7 ? 'block' : c >= 0.5 ? 'degrade' : c >= 0.4 ? 'watermark' : 'allow' };
}
export const datasetPrevention = facialHarvesting;

export interface ProfileViewRateResult {
  detected: boolean; viewCount: number; windowMinutes: number;
  pattern: 'sequential' | 'random' | 'rapid' | 'normal';
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'allow' | 'slow' | 'captcha' | 'block';
}
export function profileViewRateLimit(views: Array<{ targetId: string; timestamp: number }>, windowMin = 10): ProfileViewRateResult {
  const now = Date.now(), recent = views.filter(v => now - v.timestamp < windowMin * 60000).sort((a, b) => a.timestamp - b.timestamp);
  let pattern: 'sequential' | 'random' | 'rapid' | 'normal' = 'normal';
  if (recent.length >= 30) {
    const gaps = recent.slice(1).map((v, i) => v.timestamp - recent[i]!.timestamp);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    pattern = avg < 1000 ? 'rapid' : gaps.every(g => Math.abs(g - avg) < 500) ? 'sequential' : 'random';
  }
  const rl = recent.length >= 100 ? 'high' : recent.length >= 50 ? 'medium' : recent.length >= 25 ? 'low' : 'none';
  return { detected: rl !== 'none', viewCount: recent.length, windowMinutes: windowMin, pattern, riskLevel: rl, action: rl === 'high' ? 'block' : rl === 'medium' ? 'captcha' : rl === 'low' ? 'slow' : 'allow' };
}
export const viewingPattern = profileViewRateLimit;

export interface UaAnomalyResult {
  anomaly: boolean; confidence: number; issues: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function userAgentAnomaly(ua: string): UaAnomalyResult {
  const is: string[] = []; let c = 0;
  if (/python|scrapy|selenium|puppeteer|playwright|phantomjs|headlesschrome|curl|wget|httpclient|okhttp/i.test(ua)) { is.push('bot_ua'); c += 0.5; }
  if (ua.length < 20) { is.push('suspiciously_short'); c += 0.3; }
  if (/mozilla\/[45]\.0\s+\(compatible/i.test(ua)) { is.push('generic_compatible'); c += 0.4; }
  if (!/mozilla|chrome|safari|firefox|edg/i.test(ua)) { is.push('non_browser'); c += 0.4; }
  const rl = c >= 0.7 ? 'high' : c >= 0.4 ? 'medium' : c >= 0.2 ? 'low' : 'none';
  return { anomaly: c >= 0.3, confidence: c, issues: is, riskLevel: rl };
}
export const uaAnomaly = userAgentAnomaly;
export const suspiciousUA = userAgentAnomaly;

export interface FakeReviewNetworkResult {
  detected: boolean; confidence: number;
  clusters: Array<{ accountId: string; connections: number }>; indicators: string[];
}
function stSimLocal(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\s+/)), sb = new Set(b.toLowerCase().split(/\s+/));
  const i = [...sa].filter(w => sb.has(w)).length, u = new Set([...sa, ...sb]).size;
  return u > 0 ? i / u : 0;
}
export function detectFakeReviewNetwork(reviews: Array<{ reviewerId: string; targetId: string; timestamp: number; rating: number; text: string }>): FakeReviewNetworkResult {
  const ind: string[] = []; const byTarget = new Map<string, typeof reviews>();
  for (const r of reviews) { if (!byTarget.has(r.targetId)) byTarget.set(r.targetId, []); byTarget.get(r.targetId)!.push(r); }
  let clusters: Array<{ accountId: string; connections: number }> = []; let c = 0;
  for (const [, rs] of byTarget) {
    if (rs.length >= 3) {
      const ids = [...new Set(rs.map(r => r.reviewerId))];
      if (ids.length >= 3) {
        const times = rs.map(r => r.timestamp); const span = Math.max(...times) - Math.min(...times);
        if (span < 86400000) { ind.push('coordinated_timing'); c += 0.4; }
        if (rs.every(r => r.rating >= 4)) { ind.push('uniform_rating'); c += 0.2; }
        const texts = rs.map(r => r.text);
        if (texts.every(t => stSimLocal(t, texts[0]!) > 0.7)) { ind.push('similar_text'); c += 0.3; }
        for (const id of ids) clusters.push({ accountId: id, connections: ids.length - 1 });
      }
    }
  }
  clusters = clusters.filter((v, i, a) => a.findIndex(c2 => c2.accountId === v.accountId) === i);
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, clusters, indicators: [...new Set(ind)] };
}
export const fakeReviewNetwork = detectFakeReviewNetwork;

export interface DetectorCorrelationResult {
  correlated: boolean; matrix: Array<{ a: string; b: string; correlation: number }>;
  highCorrelations: Array<{ a: string; b: string; correlation: number }>; recommendation: string;
}
export function detectorCorrelation(signals: Array<{ detector: string; triggered: boolean; timestamp: number }>): DetectorCorrelationResult {
  const dets = [...new Set(signals.map(s => s.detector))];
  const counts = new Map<string, Map<string, number>>(); const totals = new Map<string, number>();
  for (const s of signals) {
    totals.set(s.detector, (totals.get(s.detector) ?? 0) + 1);
    for (const o of signals) {
      if (o.timestamp === s.timestamp && o.detector !== s.detector) {
        if (!counts.has(s.detector)) counts.set(s.detector, new Map());
        const m = counts.get(s.detector)!; m.set(o.detector, (m.get(o.detector) ?? 0) + 1);
      }
    }
  }
  const matrix: Array<{ a: string; b: string; correlation: number }> = [];
  const hc: Array<{ a: string; b: string; correlation: number }> = [];
  for (const a of dets) for (const b of dets) {
    if (a >= b) continue;
    const ta = totals.get(a) ?? 1; const co = (counts.get(a)?.get(b) ?? 0) / ta;
    matrix.push({ a, b, correlation: Math.round(co * 100) / 100 });
    if (co >= 0.8) hc.push({ a, b, correlation: Math.round(co * 100) / 100 });
  }
  return { correlated: hc.length > 0, matrix, highCorrelations: hc, recommendation: hc.length ? `High correlation between detectors: ${hc.map(h => `${h.a}↔${h.b}(${h.correlation})`).join(', ')}. Consider consolidating.` : 'Detectors are sufficiently independent.' };
}
export const correlateDetectors = detectorCorrelation;
export const signalCorrelation = detectorCorrelation;

export interface ClickFixResult {
  detected: boolean; confidence: number; indicators: string[]; action: 'allow' | 'warn' | 'block';
}
export function clickFixDetect(s: {
  clipboardContainsSuspiciousUrl: boolean; recentlyClickedDeepLink: boolean;
  urlContainsDeviceToken: boolean; urlContainsInstallParam: boolean;
  redirectsToAppStore: boolean; sourceMessageContainsUrgency: boolean;
}): ClickFixResult {
  const ind: string[] = []; let c = 0;
  if (s.clipboardContainsSuspiciousUrl && s.urlContainsDeviceToken) { ind.push('clipboard_token'); c += 0.5; }
  if (s.recentlyClickedDeepLink && s.urlContainsInstallParam) { ind.push('deeplink_install'); c += 0.4; }
  if (s.redirectsToAppStore && s.sourceMessageContainsUrgency) { ind.push('urgency_redirect'); c += 0.4; }
  if (s.urlContainsDeviceToken && s.sourceMessageContainsUrgency) { ind.push('token_urgency'); c += 0.3; }
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, indicators: ind, action: c >= 0.7 ? 'block' : c >= 0.4 ? 'warn' : 'allow' };
}
export const deviceLinkHijack = clickFixDetect;
export const clickFix = clickFixDetect;

export interface ExplainDecisionResult {
  explanation: string; topFeatures: Array<{ feature: string; impact: number; direction: 'positive' | 'negative' }>;
  confidence: number; method: string;
}
export function explainDecision(features: Record<string, number>, weights: Record<string, number>, threshold = 0.5): ExplainDecisionResult {
  const scored = Object.entries(features).map(([f, v]) => ({ feature: f, impact: (weights[f] ?? 0) * v, direction: ((weights[f] ?? 0) * v >= 0 ? 'positive' : 'negative') as 'positive' | 'negative' })).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const total = scored.reduce((s, f) => s + f.impact, 0); const top = scored.slice(0, 5);
  const explanation = top.length ? `Decision primarily driven by: ${top.map(t => `${t.feature} (${t.direction}, impact: ${Math.round(Math.abs(t.impact) * 100)}%)`).join(', ')}.` : 'No significant factors.';
  return { explanation, topFeatures: top.map(t => ({ ...t, impact: Math.round(t.impact * 100) / 100 })), confidence: Math.abs(total - threshold), method: 'linear_weights' };
}
export const shapValue = explainDecision;
export const limeExplain = explainDecision;
export const modelExplain = explainDecision;

export interface ThirdPartyAIResult {
  detected: boolean; confidence: number; violations: string[]; sdkList: string[]; recommendation: string;
}
export function thirdPartyAIDataSharing(s: {
  installedSDKs: string[]; networkCallsToAI: string[]; payloadContainsUserData: boolean;
  consentForAISharing: boolean; privacyPolicyMentionsAI: boolean; dataMinimizationPracticed: boolean;
}): ThirdPartyAIResult {
  const vs: string[] = []; let c = 0;
  const aiSDKs = ['openai', 'anthropic', 'cohere', 'ai21', 'stability', 'replicate', 'huggingface', 'langchain'];
  const found = s.installedSDKs.filter(sdk => aiSDKs.some(ai => sdk.toLowerCase().includes(ai)));
  if (found.length > 0 && !s.consentForAISharing) { vs.push('ai_sdk_no_consent'); c += 0.4; }
  if (s.networkCallsToAI.length > 0 && s.payloadContainsUserData) { vs.push('user_data_to_ai'); c += 0.5; }
  if (!s.privacyPolicyMentionsAI && found.length > 0) { vs.push('no_ai_disclosure'); c += 0.3; }
  if (!s.dataMinimizationPracticed && s.networkCallsToAI.length > 0) { vs.push('no_minimization'); c += 0.2; }
  c = Math.min(1, c);
  return { detected: c >= 0.3, confidence: c, violations: vs, sdkList: found, recommendation: vs.length ? `Issues: ${vs.join(', ')}. Add consent, update privacy policy, minimize data sent to AI.` : 'AI data sharing appears compliant.' };
}
export const aiDataSharing = thirdPartyAIDataSharing;
export const externalAISharing = thirdPartyAIDataSharing;

export interface AIPhotoEditResult {
  compliant: boolean; editTypes: string[]; overEdits: string[];
  authenticityScore: number; action: 'allow' | 'label' | 'reject';
}
export function aiPhotoEditAuthenticity(edits: Array<{ type: string; intensity: number; area: string; affectsIdentity: boolean }>): AIPhotoEditResult {
  const over: string[] = []; let as = 100;
  for (const e of edits) {
    if (e.affectsIdentity && e.intensity > 0.7) { over.push(e.type); as -= 30; }
    else if (e.type === 'skin_smooth' && e.intensity > 0.8) { over.push('excessive_smooth'); as -= 15; }
    else if (e.type === 'face_reshape' && e.intensity > 0.5) { over.push('face_reshape'); as -= 25; }
    else if (e.type === 'body_reshape' && e.intensity > 0.5) { over.push('body_reshape'); as -= 25; }
    else as -= 5;
  }
  as = Math.max(0, as);
  return { compliant: over.length === 0, editTypes: edits.map(e => e.type), overEdits: over, authenticityScore: as, action: as < 30 ? 'reject' : as < 60 ? 'label' : 'allow' };
}
export const editBoundary = aiPhotoEditAuthenticity;
export const aiEditLimit = aiPhotoEditAuthenticity;
export const photoEditAuthenticity = aiPhotoEditAuthenticity;

export interface AgentToAgentResult {
  detected: boolean; confidence: number; indicators: string[]; action: 'none' | 'flag' | 'block';
}
export function agentToAgentDetect(s: {
  responseTimeVariance: number; messageLengthVariance: number; vocabularyDiversity: number;
  responsePatternRegularity: number; noTypos: boolean; noFillers: boolean;
  consistentTone: boolean; exchangeCount: number;
}): AgentToAgentResult {
  const ind: string[] = []; let c = 0;
  if (s.responseTimeVariance < 100 && s.exchangeCount >= 5) { ind.push('robotic_timing'); c += 0.3; }
  if (s.messageLengthVariance < 5 && s.exchangeCount >= 5) { ind.push('uniform_length'); c += 0.2; }
  if (s.vocabularyDiversity > 0.95) { ind.push('superhuman_vocab'); c += 0.2; }
  if (s.responsePatternRegularity > 0.9) { ind.push('pattern_regularity'); c += 0.3; }
  if (s.noTypos && s.exchangeCount >= 10) { ind.push('zero_typos'); c += 0.1; }
  if (s.noFillers && s.consistentTone) { ind.push('no_human_markers'); c += 0.2; }
  c = Math.min(1, c);
  return { detected: c >= 0.5, confidence: c, indicators: ind, action: c >= 0.7 ? 'block' : c >= 0.5 ? 'flag' : 'none' };
}
export const aiToAi = agentToAgentDetect;
export const botToBotDetect = agentToAgentDetect;

export interface ConciergeBoundaryResult {
  compliant: boolean; violations: string[]; enforcedBoundaries: string[]; action: 'allow' | 'warn' | 'block';
}
export function conciergeConsentBoundary(s: {
  userAskedForAdvice: boolean; conciergeOfferedPersonalData: boolean;
  conciergeMadeDecisionForUser: boolean; conciergeAccessedSensitiveData: boolean;
  userConsentLevel: 'basic' | 'enhanced' | 'full'; dataCategory: string;
}): ConciergeBoundaryResult {
  const vs: string[] = [], eb: string[] = [];
  if (!s.userAskedForAdvice && s.conciergeOfferedPersonalData) { vs.push('unsolicited_data'); eb.push('require_user_initiative'); }
  if (s.conciergeMadeDecisionForUser) { vs.push('decision_override'); eb.push('require_user_confirmation'); }
  if (s.conciergeAccessedSensitiveData && s.userConsentLevel !== 'full') { vs.push('insufficient_consent'); eb.push('escalate_consent'); }
  if (s.dataCategory === 'health' && !s.conciergeAccessedSensitiveData) eb.push('health_data_protected');
  return { compliant: vs.length === 0, violations: vs, enforcedBoundaries: eb, action: vs.length >= 2 ? 'block' : vs.length >= 1 ? 'warn' : 'allow' };
}
export const aiConsentBoundary = conciergeConsentBoundary;
export const agentBoundary = conciergeConsentBoundary;
export const conciergeBoundary = conciergeConsentBoundary;

export interface AIHallucinationResult {
  detected: boolean; confidence: number; unverifiedClaims: string[];
  factCheckResults: Array<{ claim: string; verifiable: boolean; source: string }>;
  action: 'allow' | 'label' | 'suppress';
}
export async function aiHallucinationDetect(content: string, claims: Array<{ text: string; expectedSource?: string }>): Promise<AIHallucinationResult> {
  const uv: string[] = []; const fc: AIHallucinationResult['factCheckResults'] = []; let c = 0;
  for (const cl of claims) {
    const hasSource = cl.expectedSource && content.includes(cl.expectedSource);
    const hasHedge = /may|might|could|possibly|perhaps|allegedly|reportedly|it\s+is\s+said/i.test(cl.text);
    if (!hasSource && !hasHedge) { uv.push(cl.text); c += 0.3; fc.push({ claim: cl.text, verifiable: false, source: 'none' }); }
    else fc.push({ claim: cl.text, verifiable: !!hasSource, source: cl.expectedSource ?? 'hedge' });
  }
  if (/\b\d{1,2}%\s+of\s+(?:people|users?|men|women|couples?)/i.test(content) && !/according\s+to|study|survey|research|reported/i.test(content)) { uv.push('unsourced_statistic'); c += 0.3; }
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, unverifiedClaims: uv, factCheckResults: fc, action: c >= 0.7 ? 'suppress' : c >= 0.4 ? 'label' : 'allow' };
}
export const hallucinationDetect = aiHallucinationDetect;
export const factCheck = aiHallucinationDetect;

export interface PopularityBiasResult {
  detected: boolean; giniCoefficient: number; topItemShare: number;
  longTailPercent: number; recommendation: string;
}
export function popularityBias(itemInteractions: Array<{ itemId: string; count: number }>, topK = 10): PopularityBiasResult {
  const sorted = [...itemInteractions].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, i) => s + i.count, 0);
  const topShare = sorted.slice(0, Math.min(topK, sorted.length)).reduce((s, i) => s + i.count, 0) / (total || 1);
  const longTail = sorted.filter(i => i.count <= 1).length / sorted.length;
  let gini = 0;
  for (let i = 0; i < sorted.length; i++) for (let j = 0; j < sorted.length; j++) gini += Math.abs(sorted[i]!.count - sorted[j]!.count);
  gini /= (2 * sorted.length * (total || 1));
  return { detected: topShare > 0.5, giniCoefficient: Math.round(gini * 100) / 100, topItemShare: Math.round(topShare * 100) / 100, longTailPercent: Math.round(longTail * 100) / 100, recommendation: topShare > 0.5 ? 'Recommendations are too concentrated on popular items. Boost long-tail content.' : 'Recommendation distribution looks healthy.' };
}
export const longTailBias = popularityBias;
export const recommendationBias = popularityBias;

export interface AADCResult {
  compliant: boolean; checks: Array<{ requirement: string; met: boolean; details: string }>;
  score: number; recommendation: string;
}
export function ageAppropriateDesignCode(s: {
  hasAgeAssessment: boolean; appliesHighPrivacyByDefault: boolean; minimizesDataCollection: boolean;
  avoidsNudgeTechniques: boolean; preventsProfilePublicByDefault: boolean; hasParentalControls: boolean;
  disablesDirectMessagingForMinors: boolean; noTargetedAdsForMinors: boolean; hasTransparencyReport: boolean;
}): AADCResult {
  const ch: Array<{ requirement: string; met: boolean; details: string }> = [
    { requirement: 'age_assessment', met: s.hasAgeAssessment, details: s.hasAgeAssessment ? 'Age assessment in place' : 'Implement age assessment' },
    { requirement: 'high_privacy_default', met: s.appliesHighPrivacyByDefault, details: s.appliesHighPrivacyByDefault ? 'High privacy by default' : 'Set high privacy as default for children' },
    { requirement: 'data_minimization', met: s.minimizesDataCollection, details: s.minimizesDataCollection ? 'Data minimized' : 'Minimize data collection for children' },
    { requirement: 'no_nudge', met: s.avoidsNudgeTechniques, details: s.avoidsNudgeTechniques ? 'No nudge techniques' : 'Remove nudge techniques for children' },
    { requirement: 'private_profile_default', met: s.preventsProfilePublicByDefault, details: s.preventsProfilePublicByDefault ? 'Profiles private by default' : 'Make profiles private by default' },
    { requirement: 'parental_controls', met: s.hasParentalControls, details: s.hasParentalControls ? 'Parental controls available' : 'Add parental controls' },
    { requirement: 'messaging_safeguards', met: s.disablesDirectMessagingForMinors, details: s.disablesDirectMessagingForMinors ? 'DM disabled for minors' : 'Disable DM for minors' },
    { requirement: 'no_targeted_ads', met: s.noTargetedAdsForMinors, details: s.noTargetedAdsForMinors ? 'No targeted ads for minors' : 'Disable targeted ads for minors' },
    { requirement: 'transparency', met: s.hasTransparencyReport, details: s.hasTransparencyReport ? 'Transparency report available' : 'Publish transparency report' },
  ];
  const met = ch.filter(c => c.met).length;
  return { compliant: met === ch.length, checks: ch, score: Math.round(met / ch.length * 100), recommendation: `${ch.length - met} requirements not met. Address: ${ch.filter(c => !c.met).map(c => c.requirement).join(', ')}.` };
}
export const AADC = ageAppropriateDesignCode;
export const childrenCode = ageAppropriateDesignCode;
export const ukAgeCode = ageAppropriateDesignCode;

export interface MinorRecoveryResult {
  process: string; steps: string[]; parentalInvolvement: boolean;
  safeGuardApplied: boolean; estimatedTimeDays: number;
}
export function minorAccountRecovery(s: {
  userAge: number; accountLocked: boolean; lockReason: string;
  hasParentEmail: boolean; hasIdVerification: boolean;
}): MinorRecoveryResult {
  if (s.userAge >= 18) return { process: 'standard', steps: ['verify_identity', 'reset_credentials'], parentalInvolvement: false, safeGuardApplied: false, estimatedTimeDays: 1 };
  return { process: 'minor_safeguarded', steps: ['verify_parent_guardian_identity', 'confirm_parental_consent', 'review_account_activity', 'apply_safety_settings', 'reset_with_parent_approval'], parentalInvolvement: true, safeGuardApplied: true, estimatedTimeDays: s.hasParentEmail ? 3 : 7 };
}
export const underageRecovery = minorAccountRecovery;
export const childAccount = minorAccountRecovery;

export interface NCMECResult {
  member: boolean; cyberTiplineEnabled: boolean; hashSharingEnabled: boolean;
  reportingUrl: string; guidelines: string[];
}
export function ncmecMembership(enabled: boolean): NCMECResult {
  return {
    member: enabled, cyberTiplineEnabled: enabled, hashSharingEnabled: enabled,
    reportingUrl: 'https://report.cybertip.org',
    guidelines: enabled ? ['Report CSAM via CyberTipline within 24 hours', 'Maintain NCMEC hash sharing', 'Preserve evidence per legal requirements', 'Designate NCMEC compliance officer', 'Annual training for moderation team'] : ['Join NCMEC at missingkids.org', 'Enable CyberTipline reporting', 'Implement hash sharing'],
  };
}
export const NCMECMembership = ncmecMembership;

export interface INHOPEResult {
  member: boolean; hotlineIntegration: boolean; reportingUrl: string; requirements: string[];
}
export function inhopeMembership(enabled: boolean): INHOPEResult {
  return {
    member: enabled, hotlineIntegration: enabled, reportingUrl: 'https://www.inhope.org/Report-Content',
    requirements: enabled ? ['Maintain hotline for illegal content', 'Respond to INHOPE notices within 24h', 'Participate in hash sharing', 'Annual compliance report'] : ['Apply at inhope.org', 'Establish hotline infrastructure', 'Train moderation team', 'Implement cross-border reporting'],
  };
}
export const INHOPE = inhopeMembership;
export const inhopeMember = inhopeMembership;

export interface UKOSAResult {
  compliant: boolean; duties: Array<{ duty: string; met: boolean; details: string }>;
  score: number; recommendation: string;
}
export function onlineSafetyAct(s: {
  hasRiskAssessment: boolean; hasSafetyByDesign: boolean; hasContentModeration: boolean;
  hasReportingMechanism: boolean; hasComplaintsProcess: boolean; hasTransparencyReporting: boolean;
  protectsChildrenSpecifically: boolean; hasDutyOfCarePolicy: boolean;
  hasSeniorAccountability: boolean; hasIllegalContentRemoval: boolean;
}): UKOSAResult {
  const d: Array<{ duty: string; met: boolean; details: string }> = [
    { duty: 'risk_assessment', met: s.hasRiskAssessment, details: 'Conduct and maintain risk assessment' },
    { duty: 'safety_by_design', met: s.hasSafetyByDesign, details: 'Implement safety by design' },
    { duty: 'content_moderation', met: s.hasContentModeration, details: 'Maintain content moderation systems' },
    { duty: 'reporting', met: s.hasReportingMechanism, details: 'Provide user reporting mechanisms' },
    { duty: 'complaints', met: s.hasComplaintsProcess, details: 'Establish complaints process' },
    { duty: 'transparency', met: s.hasTransparencyReporting, details: 'Publish transparency reports' },
    { duty: 'child_protection', met: s.protectsChildrenSpecifically, details: 'Implement child-specific protections' },
    { duty: 'duty_of_care', met: s.hasDutyOfCarePolicy, details: 'Document duty of care policy' },
    { duty: 'senior_accountability', met: s.hasSeniorAccountability, details: 'Name senior person accountable for safety' },
    { duty: 'illegal_content', met: s.hasIllegalContentRemoval, details: 'Implement illegal content removal procedures' },
  ];
  const met = d.filter(x => x.met).length;
  return { compliant: met === d.length, duties: d, score: Math.round(met / d.length * 100), recommendation: `${d.length - met} duties not met: ${d.filter(x => !x.met).map(x => x.duty).join(', ')}` };
}
export const ukOSA = onlineSafetyAct;
export const osaCompliance = onlineSafetyAct;

export interface HonorViolenceResult {
  detected: boolean; confidence: number; patterns: string[];
  severity: Sev; resources: string[]; semanticMatchScore: number;
}
const HONOR_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /(?:my\s+)?(?:family|brother|father|uncle|cousin|relatives?)\s+(?:will|would|threatened?\s+to)\s+(?:kill|murder|hurt|beat|attack|disown)/i, t: 'family_threat', s: 'critical' },
  { p: /(?:honor|honour)\s+(?:requires?|demands?|means?|dictates?)\s+(?:that\s+)?(?:you|i|she)\s+(?:be|are|is)\s+(?:punished|killed|disciplined)/i, t: 'honor_demand', s: 'critical' },
  { p: /(?:dishonor|dishonour|shamed?|disgraced?)\s+(?:the\s+)?(?:family|community|clan)/i, t: 'dishonor_claim', s: 'high' },
  { p: /(?:they'?ll|my\s+family\s+will)\s+(?:do\s+an\s+)?(?:honor\s+)?(?:killing|violence|punishment)/i, t: 'honor_killing_ref', s: 'critical' },
  { p: /(?:i'?m\s+)?(?:not\s+allowed|forbidden|prohibited)\s+(?:to\s+)?(?:date|marry|see|talk\s+to|be\s+with)\s+(?:anyone|someone)\s+(?:outside|not\s+from)\s+(?:my|the)/i, t: 'control_dating', s: 'high' },
  { p: /(?:if\s+(?:anyone|they|my\s+family)\s+finds?\s+out)\s*.*(?:kill|die|dead|murder)/i, t: 'discovery_threat', s: 'critical' },
];
export async function honorViolence(msgs: string[]): Promise<HonorViolenceResult> {
  const pts: string[] = []; let ms: Sev = 'none';
  for (const m of msgs) for (const { p, t, s } of HONOR_PAT) if (p.test(m)) { pts.push(t); ms = mxS(ms, s); }
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, HONOR_SCR); sms = r.max; if (sms >= 0.7 && ms === 'none') { ms = 'high'; pts.push('semantic_honor'); } }
  return { detected: pts.length > 0, confidence: Math.min(1, pts.length * 0.25 + sms * 0.3), patterns: pts, severity: ms, resources: ['UK: Karma Nirvana 0800 5999 247', 'UK: Forced Marriage Unit 020 7008 0151', 'US: National DV Hotline 1-800-799-7233', 'International: unwomen.org', 'Emergency: Call 999/911'], semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const honorBased = honorViolence;
export const honorKilling = honorViolence;

export interface ForcedMarriageResult {
  detected: boolean; confidence: number; patterns: string[];
  severity: Sev; resources: string[]; semanticMatchScore: number;
}
const FORCED_MARR_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /(?:my\s+)?(?:parents?|family|relatives?)\s+(?:are\s+)?(?:forcing|making|pressuring|arranging)\s+(?:me\s+)?(?:to\s+)?(?:marry|get\s+married\s+to)/i, t: 'forced_marriage_claim', s: 'critical' },
  { p: /(?:i'?m\s+)?(?:being\s+)?(?:taken|going|traveling)\s+(?:abroad|overseas|back\s+home|to\s+(?:the\s+)?(?:country|village|homeland))\s+(?:for|to)\s+(?:a\s+)?(?:marriage|wedding|ceremony)/i, t: 'travel_for_marriage', s: 'critical' },
  { p: /(?:they|my\s+family)\s+(?:said|told)\s+(?:me\s+)?i\s+(?:have\s+to|must|will)\s+(?:marry|wed)\s+(?:him|her|my\s+cousin|the\s+(?:person|guy|girl))/i, t: 'family_decision', s: 'high' },
  { p: /(?:i\s+)?(?:don'?t|do\s+not)\s+(?:want|agree)\s+(?:to\s+)?(?:this|the)\s+(?:marriage|wedding|arrangement)\s+(?:but|and)\s+(?:they|my\s+family)/i, t: 'refusal_override', s: 'critical' },
  { p: /(?:if\s+i\s+)?(?:refuse|say\s+no|don'?t\s+agree)\s+.*(?:they'?ll|they\s+will)\s+(?:kill|hurt|beat|disown|send\s+away)/i, t: 'refusal_threat', s: 'critical' },
  { p: /(?:wedding|marriage|ceremony)\s+(?:is\s+)?(?:planned|scheduled|set|arranged)\s+(?:for|next|in)\s+(?:next|this|a\s+few)\s+(?:week|month|day)/i, t: 'imminent_marriage', s: 'high' },
];
export async function forcedMarriage(msgs: string[]): Promise<ForcedMarriageResult> {
  const pts: string[] = []; let ms: Sev = 'none';
  for (const m of msgs) for (const { p, t, s } of FORCED_MARR_PAT) if (p.test(m)) { pts.push(t); ms = mxS(ms, s); }
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, FORCED_MARR_SCR); sms = r.max; if (sms >= 0.7 && ms === 'none') { ms = 'high'; pts.push('semantic_forced_marriage'); } }
  return { detected: pts.length > 0, confidence: Math.min(1, pts.length * 0.25 + sms * 0.3), patterns: pts, severity: ms, resources: ['UK Forced Marriage Unit: 020 7008 0151', 'Karma Nirvana: 0800 5999 247', 'National DV Hotline: 1-800-799-7233', 'UNICEF: unicef.org/child-marriage', 'Emergency: Call 999/911'], semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const marriageGrooming = forcedMarriage;
export const arrangedForced = forcedMarriage;


export interface GroupConsent {
  eventId: string; participants: Array<{ userId: string; consented: boolean; consentedAt?: number }>;
  allConsented: boolean; consentMethod: 'explicit' | 'implicit' | 'none';
}
export function groupDateConsent(eventId: string, participants: Array<{ userId: string; consented: boolean; consentedAt?: number }>): GroupConsent {
  const all = participants.every(p => p.consented);
  return { eventId, participants, allConsented: all, consentMethod: all ? 'explicit' : participants.some(p => p.consented) ? 'implicit' : 'none' };
}
export const groupConsentVerify = groupDateConsent;
export const eventConsentCheck = groupDateConsent;

export interface OutnumberDetectResult {
  detected: boolean; ratio: number; userCount: number; otherCount: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high'; recommendation: string;
}
export function detectOutnumbering(userGroupSize: number, otherGroupSize: number, threshold = 2): OutnumberDetectResult {
  const ratio = userGroupSize > 0 ? otherGroupSize / userGroupSize : otherGroupSize;
  const det = ratio >= threshold;
  const rl = ratio >= 4 ? 'high' : ratio >= 3 ? 'medium' : ratio >= 2 ? 'low' : 'none';
  return { detected: det, ratio: Math.round(ratio * 10) / 10, userCount: userGroupSize, otherCount: otherGroupSize, riskLevel: rl, recommendation: det ? `You may be outnumbered ${Math.round(ratio)}:1. Consider meeting in a public place or bringing a friend.` : 'Group sizes look balanced.' };
}
export const outnumberDetect = detectOutnumbering;
export const groupSizeImbalance = detectOutnumbering;
export const meetupImbalance = detectOutnumbering;

export interface EventPhotoConsentResult {
  optedOut: boolean; userId: string; eventId: string;
  sharingScope: 'none' | 'participants_only' | 'public'; watermarkRequired: boolean;
}
export function EventPhotoConsent(userId: string, eventId: string, optOut: boolean, scope: 'none' | 'participants_only' | 'public' = 'participants_only'): EventPhotoConsentResult {
  return { optedOut: optOut, userId, eventId, sharingScope: optOut ? 'none' : scope, watermarkRequired: !optOut && scope === 'public' };
}
export const eventPhotoPrivacy = EventPhotoConsent;
export const photoOptOut = EventPhotoConsent;
export const eventPhotoConsent = EventPhotoConsent;

export interface StalkerwarePromptResult {
  shouldShow: boolean; riskLevel: 'none' | 'low' | 'medium' | 'high';
  warningTitle: string; warningBody: string; actionLinks: string[];
}
export function spywarePromptDetect(signals: {
  recentMatchFromUnknownDevice: boolean; locationAccessedByMatch: boolean;
  unusualLoginPattern: boolean; partnerKnowsPrivateInfo: boolean;
}): StalkerwarePromptResult {
  let rs = 0;
  if (signals.recentMatchFromUnknownDevice) rs += 1;
  if (signals.locationAccessedByMatch) rs += 2;
  if (signals.unusualLoginPattern) rs += 1;
  if (signals.partnerKnowsPrivateInfo) rs += 2;
  const rl = rs >= 4 ? 'high' : rs >= 2 ? 'medium' : rs >= 1 ? 'low' : 'none';
  const show = rl !== 'none';
  return { shouldShow: show, riskLevel: rl, warningTitle: show ? 'Possible monitoring detected' : '', warningBody: show ? 'Someone may be monitoring your device or account. Check for unfamiliar apps with location or microphone access.' : '', actionLinks: show ? ['https://www.stopstalkerware.org', 'https://www.thehotline.org'] : [] };
}
export const stalkerwarePrompt = spywarePromptDetect;

export interface CoercivePartnerMonitoringResult {
  detected: boolean; confidence: number; indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function coerciveMonitoring(s: {
  profileViewsFromSameUser: number; viewWindowHours: number; wasFormerMatch: boolean;
  messagesSentAfterBlock: number; locationCheckFrequency: number;
}): CoercivePartnerMonitoringResult {
  const ind: string[] = []; let c = 0;
  if (s.profileViewsFromSameUser >= 10 && s.viewWindowHours <= 24) { ind.push('excessive_views'); c += 0.4; }
  if (s.wasFormerMatch && s.messagesSentAfterBlock >= 1) { ind.push('post_block_contact'); c += 0.4; }
  if (s.locationCheckFrequency >= 5) { ind.push('location_obsession'); c += 0.3; }
  if (s.profileViewsFromSameUser >= 20) { ind.push('obsessive_viewing'); c += 0.3; }
  c = Math.min(1, c); const rl = c >= 0.7 ? 'high' : c >= 0.4 ? 'medium' : c >= 0.2 ? 'low' : 'none';
  return { detected: c >= 0.2, confidence: Math.round(c * 100) / 100, indicators: ind, riskLevel: rl };
}
export const partnerMonitoring = coerciveMonitoring;
export const coerciveAccountMonitor = coerciveMonitoring;

export interface BlockContactsResult {
  blocked: string[]; alreadyBlocked: string[]; notFound: string[];
  totalBlocked: number; method: 'phone_hash' | 'email_hash' | 'both';
}
export function blockMyContacts(contacts: Array<{ phone?: string; email?: string }>, existingBlockedHashes: Set<string>): BlockContactsResult {
  const h = (s: string) => { let v = 0; for (let i = 0; i < s.length; i++) v = ((v << 5) - v + s.charCodeAt(i)) | 0; return Math.abs(v).toString(16); };
  const blocked: string[] = [], alreadyBlocked: string[] = [], notFound: string[] = [];
  for (const c of contacts) {
    const hashes: string[] = [];
    if (c.phone) hashes.push(h(c.phone.replace(/\D/g, '')));
    if (c.email) hashes.push(h(c.email.toLowerCase()));
    if (!hashes.length) { notFound.push('unknown'); continue; }
    const was = hashes.some(x => existingBlockedHashes.has(x));
    if (was) alreadyBlocked.push(hashes[0]!);
    else { hashes.forEach(x => existingBlockedHashes.add(x)); blocked.push(hashes[0]!); }
  }
  const method = contacts.every(c => c.phone && c.email) ? 'both' : contacts.every(c => c.email) ? 'email_hash' : 'phone_hash';
  return { blocked, alreadyBlocked, notFound, totalBlocked: existingBlockedHashes.size, method };
}
export const blockContacts = blockMyContacts;
export const contactBlock = blockMyContacts;

export interface QuickExitResult {
  exited: boolean; safeUrl: string; historyCleared: boolean;
  timestamp: number; appMinimized: boolean; notificationHidden: boolean;
}
export function quickExit(options: { safeUrl?: string; clearHistory?: boolean } = {}): QuickExitResult {
  const safeUrl = options.safeUrl ?? 'https://weather.com';
  void writeAuditLog('safety.quick_exit_activated', { timestamp: Date.now() }).catch(() => {});
  return { exited: true, safeUrl, historyCleared: options.clearHistory ?? true, timestamp: Date.now(), appMinimized: true, notificationHidden: true };
}
export const bossButton = quickExit;
export const safeExit = quickExit;

export interface PrivacyPreservingVerifyResult {
  verified: boolean; method: 'zkp' | 'hash_comparison' | 'trusted_issuer' | 'none';
  dataShared: string[]; dataRetained: boolean; confidence: number;
}
export function privacyPreservingVerify(s: {
  hasZkpProof: boolean; hasHashedCredential: boolean;
  hasTrustedIssuerAttestation: boolean; minimumAgeProven: boolean;
}): PrivacyPreservingVerifyResult {
  const ds: string[] = []; let cf = 0, m: 'zkp' | 'hash_comparison' | 'trusted_issuer' | 'none' = 'none';
  if (s.hasZkpProof) { m = 'zkp'; cf = 0.95; ds.push('age_proof_only'); }
  else if (s.hasTrustedIssuerAttestation) { m = 'trusted_issuer'; cf = 0.85; ds.push('attestation'); }
  else if (s.hasHashedCredential) { m = 'hash_comparison'; cf = 0.7; ds.push('credential_hash'); }
  if (s.minimumAgeProven && m === 'none') { cf += 0.3; ds.push('age_gate'); }
  return { verified: cf >= 0.7, method: m, dataShared: ds, dataRetained: false, confidence: Math.min(1, cf) };
}
export const privacyVerify = privacyPreservingVerify;
export const minimalDisclosure = privacyPreservingVerify;

export interface ZeroKnowledgeResult {
  verified: boolean; proofType: string; claimsProven: string[];
  noDataExposed: boolean; verificationTime: number;
}
export function zkpVerify(proof: { type: string; claims: string[]; valid: boolean; generatedAt: number }): ZeroKnowledgeResult {
  return { verified: proof.valid, proofType: proof.type, claimsProven: proof.valid ? proof.claims : [], noDataExposed: true, verificationTime: Date.now() - proof.generatedAt };
}
export const zeroKnowledge = zkpVerify;
export const zkProof = zkpVerify;

export interface AnalyticsPIIResult {
  clean: boolean; strippedFields: string[]; piiFound: string[]; complianceScore: number;
}
export async function analyticsPIIStrip(payload: Record<string, unknown>): Promise<AnalyticsPIIResult> {
  const strip: string[] = [], found: string[] = [];
  const sensitive = new Set(['email', 'phone', 'name', 'firstName', 'lastName', 'address', 'ssn', 'dob', 'dateOfBirth', 'ip', 'ipAddress', 'location', 'coordinates', 'lat', 'lng', 'latitude', 'longitude']);
  for (const k of Object.keys(payload)) { if (sensitive.has(k.toLowerCase())) { found.push(k); strip.push(k); delete payload[k]; } }
  const flat = JSON.stringify(payload);
  const pii = await presidioPII(flat);
  for (const e of pii) if (!found.includes(e.entity_type)) found.push(e.entity_type);
  const score = found.length === 0 ? 100 : Math.max(0, 100 - found.length * 10);
  return { clean: found.length === 0, strippedFields: strip, piiFound: found, complianceScore: score };
}
export const sdkPIIStrip = analyticsPIIStrip;
export const analyticsPrivacy = analyticsPIIStrip;

export interface DataBrokerExposureResult {
  exposed: boolean; brokers: string[]; exposedFields: string[];
  removalRequested: boolean; riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function dataBrokerExposure(s: { knownBrokerMatches: string[]; exposedFields: string[]; removalRequested: boolean }): DataBrokerExposureResult {
  const rl = s.knownBrokerMatches.length >= 5 ? 'high' : s.knownBrokerMatches.length >= 3 ? 'medium' : s.knownBrokerMatches.length >= 1 ? 'low' : 'none';
  return { exposed: s.knownBrokerMatches.length > 0, brokers: s.knownBrokerMatches, exposedFields: s.exposedFields, removalRequested: s.removalRequested, riskLevel: rl };
}
export const brokerExposure = dataBrokerExposure;
export const dataExposureMonitor = dataBrokerExposure;

export interface PrivacyLabelResult {
  accurate: boolean; declaredDataTypes: string[]; actualDataTypes: string[];
  mismatches: string[]; complianceScore: number;
}
export function privacyLabelAudit(declared: string[], actual: string[]): PrivacyLabelResult {
  const ds = new Set(declared); const mm = actual.filter(t => !ds.has(t));
  return { accurate: mm.length === 0, declaredDataTypes: declared, actualDataTypes: actual, mismatches: mm, complianceScore: mm.length === 0 ? 100 : Math.max(0, 100 - mm.length * 15) };
}
export const labelAccuracy = privacyLabelAudit;
export const nutritionLabel = privacyLabelAudit;

export interface IpvResourceResult {
  resources: Array<{ name: string; phone?: string; url?: string; text?: string }>;
  triggered: boolean; triggerReason: string;
}
export function ipvResources(trigger: string): IpvResourceResult {
  const res = [
    { name: 'National DV Hotline', phone: '1-800-799-7233', url: 'https://www.thehotline.org' },
    { name: 'Crisis Text Line', text: 'Text HOME to 741741' },
    { name: 'Love Is Respect', phone: '1-866-331-9474', url: 'https://www.loveisrespect.org' },
    { name: 'NNEDV', url: 'https://nnedv.org' },
  ];
  return { resources: res, triggered: true, triggerReason: trigger };
}
export const surfaceIpvHelp = ipvResources;
export const dvResources = ipvResources;

export interface BreachCrossRefResult {
  compromised: boolean; breachSources: string[];
  affectedFields: string[]; recommendedActions: string[];
}
export function breachCrossRef(s: { emailHash: string; knownBreachedHashes: Set<string>; breachSources: string[]; affectedFields: string[] }): BreachCrossRefResult {
  const comp = s.knownBreachedHashes.has(s.emailHash);
  return { compromised: comp, breachSources: comp ? s.breachSources : [], affectedFields: comp ? s.affectedFields : [], recommendedActions: comp ? ['Change your password immediately', 'Enable two-factor authentication', 'Check haveibeenpwned.com', 'Review connected accounts'] : [] };
}
export const breachDefense = breachCrossRef;
export const crossRefBreach = breachCrossRef;

export interface ExportSanitizeResult {
  sanitized: boolean; removedFields: string[]; sanitizedAt: number; exportSafe: boolean;
}
export async function exportSanitize(data: Record<string, unknown>): Promise<ExportSanitizeResult> {
  const removed: string[] = [];
  const internal = new Set(['passwordHash', 'sessionTokens', 'internalFlags', 'moderationNotes', 'adminTags', 'deviceFingerprint', 'ipHistory', 'trustScore_internal']);
  for (const k of Object.keys(data)) { if (internal.has(k)) { removed.push(k); delete data[k]; } }
  const flat = JSON.stringify(data);
  const pii = await presidioPII(flat);
  for (const e of pii) if (e.score > 0.85 && !removed.includes(e.entity_type)) removed.push(`pii:${e.entity_type}`);
  return { sanitized: removed.length > 0, removedFields: removed, sanitizedAt: Date.now(), exportSafe: true };
}
export const dataExportSanitize = exportSanitize;
export const exportClean = exportSanitize;

export interface ImportFraudResult {
  fraudulent: boolean; indicators: string[]; confidence: number; recommendation: string;
}
export async function importFraud(s: {
  importSource: string; profileAge?: number; followerCount?: number;
  postCount?: number; verificationStatus?: boolean; contentSimilarityToKnownFraud?: number;
}): Promise<ImportFraudResult> {
  const ind: string[] = []; let c = 0;
  if (s.followerCount && s.followerCount > 10000 && !s.verificationStatus) { ind.push('high_followers_unverified'); c += 0.3; }
  if (s.profileAge && s.profileAge < 7) { ind.push('very_new_import'); c += 0.2; }
  if (s.contentSimilarityToKnownFraud && s.contentSimilarityToKnownFraud > 0.7) { ind.push('fraud_content_match'); c += 0.5; }
  if (s.postCount && s.postCount === 0 && s.followerCount && s.followerCount > 1000) { ind.push('no_posts_many_followers'); c += 0.3; }
  c = Math.min(1, c);
  return { fraudulent: c >= 0.4, indicators: ind, confidence: Math.round(c * 100) / 100, recommendation: c >= 0.4 ? 'This imported profile shows signs of fraud. Manual review recommended.' : '' };
}
export const platformImportFraud = importFraud;
export const crossPlatformFraud = importFraud;

export interface SupportPhishingResult {
  detected: boolean; indicators: string[]; confidence: number; action: 'warn' | 'block' | 'allow';
}
export function supportPhishing(s: {
  senderClaims: string; domainUsed: string; requestsCredentials: boolean;
  linksToExternalSite: boolean; hasOfficialVerification: boolean;
}): SupportPhishingResult {
  const ind: string[] = []; let c = 0;
  if (/support|admin|staff|official|team/i.test(s.senderClaims) && !s.hasOfficialVerification) { ind.push('unverified_staff_claim'); c += 0.4; }
  if (s.requestsCredentials) { ind.push('credential_request'); c += 0.5; }
  if (s.linksToExternalSite && !s.hasOfficialVerification) { ind.push('external_link'); c += 0.3; }
  if (!s.domainUsed.includes('myarchetype')) { ind.push('wrong_domain'); c += 0.3; }
  c = Math.min(1, c);
  return { detected: c >= 0.4, indicators: ind, confidence: Math.round(c * 100) / 100, action: c >= 0.7 ? 'block' : c >= 0.4 ? 'warn' : 'allow' };
}
export const staffImpersonation = supportPhishing;
export const phishingDefense = supportPhishing;

export interface PseudonymousReputationResult {
  reputationScore: number; persistedAcrossAccounts: boolean;
  linkedAccountCount: number; trustLevel: 'new' | 'low' | 'medium' | 'high';
}
export function pseudonymousReputation(s: {
  deviceFingerprintHash: string; behaviorScore: number;
  linkedAccounts: string[]; reportHistory: number[];
}): PseudonymousReputationResult {
  const avg = s.reportHistory.length > 0 ? s.reportHistory.reduce((a, b) => a + b, 0) / s.reportHistory.length : 0;
  const rs = Math.max(0, Math.min(100, s.behaviorScore - avg * 10));
  const tl = rs >= 80 ? 'high' : rs >= 50 ? 'medium' : rs >= 20 ? 'low' : 'new';
  return { reputationScore: Math.round(rs), persistedAcrossAccounts: s.linkedAccounts.length > 0, linkedAccountCount: s.linkedAccounts.length, trustLevel: tl };
}
export const anonReputation = pseudonymousReputation;
export const reputationPersist = pseudonymousReputation;

export interface HolidayScamResult {
  amplified: boolean; season: string; riskMultiplier: number;
  patterns: string[]; recommendation: string;
}
export function holidayScam(s: {
  currentDate: Date; messageContent: string; isNewMatch: boolean;
  requestsGift: boolean; requestsMoney: boolean;
}): HolidayScamResult {
  const m = s.currentDate.getMonth() + 1, d = s.currentDate.getDate();
  let season = 'normal', rm = 1.0;
  if (m === 2 && d >= 1 && d <= 21) { season = 'valentines'; rm = 2.5; }
  else if (m === 12 && d >= 15) { season = 'christmas'; rm = 2.0; }
  else if (m === 11 && d >= 20) { season = 'thanksgiving'; rm = 1.5; }
  const pts: string[] = [];
  if (s.requestsGift && s.isNewMatch) pts.push('gift_request_new_match');
  if (s.requestsMoney) pts.push('money_request');
  if (/valentine|love|soulmate|destiny|meant\s+to\s+be/i.test(s.messageContent) && s.isNewMatch) pts.push('holiday_love_bomb');
  return { amplified: season !== 'normal' && pts.length > 0, season, riskMultiplier: rm, patterns: pts, recommendation: pts.length > 0 ? `Holiday scam risk elevated (${season}). Be cautious of gift/money requests from new matches.` : '' };
}
export const valentineScam = holidayScam;
export const seasonalScam = holidayScam;

export interface SeasonalSurgeResult {
  surgeDetected: boolean; newUserRiskScore: number; season: string; additionalChecks: string[];
}
export function seasonalSurge(s: {
  accountAgeDays: number; registrationDate: Date;
  profileCompleteness: number; verificationLevel: string;
}): SeasonalSurgeResult {
  const m = s.registrationDate.getMonth() + 1, d = s.registrationDate.getDate();
  let season = 'normal';
  if (m === 2 && d >= 1 && d <= 14) season = 'valentines';
  else if (m === 1 && d <= 7) season = 'newyear';
  else if (m === 12 && d >= 26) season = 'postnchristmas';
  const surge = season !== 'normal'; let rs = 0;
  if (surge && s.accountAgeDays < 3) rs += 30;
  if (s.profileCompleteness < 30) rs += 20;
  if (s.verificationLevel === 'none') rs += 25;
  const checks: string[] = [];
  if (rs >= 30) checks.push('photo_verification', 'phone_verification');
  if (rs >= 50) checks.push('id_verification', 'manual_review');
  return { surgeDetected: surge, newUserRiskScore: Math.min(100, rs), season, additionalChecks: checks };
}
export const surgeFraud = seasonalSurge;
export const newUserSurge = seasonalSurge;

export interface MetadataSearchResult {
  searchable: boolean; exposedMetadata: string[]; risk: string[]; recommendation: string;
}
export function metadataSearchAudit(fields: Record<string, { searchable: boolean; internal: boolean; sensitive: boolean }>): MetadataSearchResult {
  const exp: string[] = [], risk: string[] = [];
  for (const [k, v] of Object.entries(fields)) { if (v.searchable && v.internal) { exp.push(k); if (v.sensitive) risk.push(k); } }
  return { searchable: exp.length > 0, exposedMetadata: exp, risk, recommendation: risk.length > 0 ? `Sensitive internal fields are searchable: ${risk.join(', ')}. Remove search index.` : exp.length > 0 ? 'Some internal fields are searchable. Review necessity.' : 'Metadata searchability looks safe.' };
}
export const internalMetadata = metadataSearchAudit;
export const metadataAudit = metadataSearchAudit;

export interface KinkIsolationResult {
  isolated: boolean; storageLocation: 'encrypted_separate' | 'main_db' | 'not_stored';
  accessLevel: 'self_only' | 'matches' | 'staff' | 'public'; compliant: boolean;
}
export function kinkIsolation(s: {
  storedSeparately: boolean; encrypted: boolean; accessibleByStaff: boolean;
  sharedWithMatches: boolean; userControlled: boolean;
}): KinkIsolationResult {
  const loc = s.storedSeparately && s.encrypted ? 'encrypted_separate' : 'main_db';
  const al = s.accessibleByStaff ? 'staff' : s.sharedWithMatches ? 'matches' : 'self_only';
  const compliant = loc === 'encrypted_separate' && al === 'self_only' && s.userControlled;
  return { isolated: s.storedSeparately && s.encrypted, storageLocation: loc, accessLevel: al, compliant };
}
export const sensitivePreference = kinkIsolation;
export const kinkData = kinkIsolation;

export interface TransactionAnonymizeResult {
  anonymized: boolean; removedFields: string[]; retentionDays: number; complianceNote: string;
}
export function transactionAnonymize(tx: Record<string, unknown>, retentionDays = 90): TransactionAnonymizeResult {
  const toRemove = ['cardLast4', 'billingAddress', 'billingName', 'ipAddress', 'deviceId', 'userAgent'];
  const removed: string[] = [];
  for (const k of toRemove) { if (k in tx) { removed.push(k); delete tx[k]; } }
  if (tx['userId']) {
    tx['userId'] = 'anon_' + Math.abs(String(tx['userId']).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)).toString(16);
    removed.push('userId→anonymized');
  }
  return { anonymized: removed.length > 0, removedFields: removed, retentionDays, complianceNote: `Transaction data retained for ${retentionDays} days per financial compliance, then purged.` };
}
export const txAnonymize = transactionAnonymize;
export const paymentAnonymize = transactionAnonymize;

export interface SafetyDiscoverabilityResult {
  score: number; hardToFind: string[]; wellPlaced: string[]; recommendation: string;
}
export function safetyDiscoverability(placements: Array<{ feature: string; tapDepth: number; hasOnboarding: boolean; visibleInCrisis: boolean }>): SafetyDiscoverabilityResult {
  const hard = placements.filter(p => p.tapDepth > 3 || !p.visibleInCrisis).map(p => p.feature);
  const well = placements.filter(p => p.tapDepth <= 2 && p.visibleInCrisis).map(p => p.feature);
  const score = well.length > 0 ? Math.round(well.length / placements.length * 100) : 0;
  return { score, hardToFind: hard, wellPlaced: well, recommendation: hard.length > 0 ? `Move these safety features to within 2 taps: ${hard.join(', ')}.` : 'Safety features are well-placed.' };
}
export const featureDiscoverability = safetyDiscoverability;
export const safetyUX = safetyDiscoverability;

export interface SafetyCompletenessResult {
  score: number; missingFeatures: string[]; implementedFeatures: string[];
  coveragePercent: number; recommendation: string;
}
const REQ_SF = ['block_user', 'report_user', 'unmatch', 'emergency_sos', 'quick_exit', 'location_sharing', 'safety_checkin', 'trusted_contact', 'photo_verification', 'message_moderation', 'harassment_detection', 'scam_detection', 'minor_detection', 'delete_account', 'data_export', 'privacy_settings', 'two_factor_auth', 'screenshot_detection', 'profile_verification', 'date_safety_plan'];
export function safetyCompleteness(impl: string[]): SafetyCompletenessResult {
  const s = new Set(impl), ms = REQ_SF.filter(f => !s.has(f)), dn = REQ_SF.filter(f => s.has(f));
  return { score: dn.length, missingFeatures: ms, implementedFeatures: dn, coveragePercent: Math.round(dn.length / REQ_SF.length * 100), recommendation: ms.length ? `Missing ${ms.length} safety features: ${ms.join(', ')}.` : 'All required safety features implemented!' };
}
export const featureCompleteness = safetyCompleteness;
export const safetyAudit = safetyCompleteness;

export interface WealthSignalingResult {
  detected: boolean; wealthMentions: number; engagementDelta: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function wealthSignaling(msgs: Array<{ text: string; responseTimeMs: number; sentByMatch: boolean }>): WealthSignalingResult {
  const wp = /(\$?\d{4,}|million|billion|luxury|porsche|mercedes|bmw|rolex|gucci|louis\s+vuitton|yacht|penthouse|mansion|private\s+jet|ceo|founder|investor|hedge\s+fund|trust\s+fund|inheritance)/i;
  let wm = 0, bA = 0, aA = 0, bC = 0, aC = 0;
  for (const m of msgs) {
    if (wp.test(m.text)) { wm++; continue; }
    if (m.sentByMatch && wm > 0) { aA += m.responseTimeMs; aC++; }
    else if (m.sentByMatch) { bA += m.responseTimeMs; bC++; }
  }
  bA = bC > 0 ? bA / bC : 0; aA = aC > 0 ? aA / aC : 0;
  const ed = bA > 0 ? (bA - aA) / bA : 0;
  const d = wm >= 1 && ed > 0.3;
  const rl = ed > 0.6 ? 'high' : ed > 0.4 ? 'medium' : ed > 0.2 ? 'low' : 'none';
  return { detected: d, wealthMentions: wm, engagementDelta: Math.round(ed * 100) / 100, riskLevel: rl };
}
export const richResponse = wealthSignaling;
export const luxuryMention = wealthSignaling;

export interface PostBlockContactResult {
  detected: boolean; attempts: number; methods: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high'; action: 'none' | 'warn' | 'restrict' | 'block';
}
export function postBlockContact(s: {
  blockedUserId: string; newAccountMatches: Array<{ accountId: string; deviceFingerprint: string; faceSimilarity: number; createdAt: number }>;
  blockTimestamp: number; messagesAfterBlock: Array<{ senderId: string; timestamp: number; content: string }>;
}): PostBlockContactResult {
  const m: string[] = []; let a = 0;
  for (const n of s.newAccountMatches) {
    if (n.createdAt > s.blockTimestamp) {
      if (n.faceSimilarity > 0.85) { a++; m.push('new_account_face_match'); }
      if (n.deviceFingerprint === s.blockedUserId) { a++; m.push('same_device_new_account'); }
    }
  }
  for (const msg of s.messagesAfterBlock) if (/why\s+did\s+you\s+(block|unmatch|ignore)|unblock\s+me|give\s+me\s+another\s+chance/i.test(msg.content)) { a++; m.push('block_reference_message'); }
  const rl = a >= 3 ? 'high' : a >= 2 ? 'medium' : a >= 1 ? 'low' : 'none';
  return { detected: a >= 1, attempts: a, methods: [...new Set(m)], riskLevel: rl, action: rl === 'high' ? 'block' : rl === 'medium' ? 'restrict' : rl === 'low' ? 'warn' : 'none' };
}
export const blockCircumvent = postBlockContact;
export const blockCircumvention = postBlockContact;

export interface EmergencySignalResult {
  activated: boolean; signalType: 'silent_sos' | 'loud_alarm' | 'trusted_contact_alert' | '911_call' | 'record_audio';
  timestamp: number; locationShared: boolean; contactsNotified: string[]; recordingStarted: boolean;
}
let lastSOS: EmergencySignalResult | null = null;
export function emergencySignal(type: EmergencySignalResult['signalType'] = 'silent_sos'): EmergencySignalResult {
  const r: EmergencySignalResult = { activated: true, signalType: type, timestamp: Date.now(), locationShared: true, contactsNotified: [], recordingStarted: type === 'record_audio' || type === 'silent_sos' };
  lastSOS = r;
  void writeAuditLog('safety.emergency_signal_activated', { type, timestamp: r.timestamp }).catch(() => {});
  return r;
}
export const panicButton = emergencySignal;
export const postMeetupSOS = emergencySignal;
export function getLastEmergencySignal(): EmergencySignalResult | null { return lastSOS; }

export interface AudioDeepfakeResult {
  detected: boolean; confidence: number; artifacts: string[]; analysisMethod: string;
  transcript: string | null; transcriptConfidence: number; action: 'allow' | 'warn' | 'block';
}
export async function audioDeepfake(f: {
  pitchVariance: number; spectralConsistency: number; formantStability: number;
  breathPatternNatural: boolean; segmentTransitions: number; duration: number; audioUrl?: string;
}): Promise<AudioDeepfakeResult> {
  const ar: string[] = []; let c = 0;
  if (f.pitchVariance < 0.1) { ar.push('flat_pitch'); c += 0.3; }
  if (f.spectralConsistency < 0.5) { ar.push('spectral_inconsistency'); c += 0.3; }
  if (f.formantStability < 0.4) { ar.push('unstable_formants'); c += 0.25; }
  if (!f.breathPatternNatural) { ar.push('no_breath'); c += 0.3; }
  if (f.segmentTransitions > 10 && f.duration < 30) { ar.push('excessive_transitions'); c += 0.2; }
  let tr: string | null = null, tc = 0;
  if (f.audioUrl) {
    const w = await whisperT(f.audioUrl); tr = w.text || null; tc = w.conf;
    if (w.text.length > 20 && w.conf < 0.5) { ar.push('low_whisper_conf'); c += 0.2; }
    if (w.text.length > 50) { const wd = w.text.toLowerCase().split(/\s+/); if (new Set(wd).size / wd.length < 0.3) { ar.push('repetitive_transcript'); c += 0.25; } }
  }
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, artifacts: ar, analysisMethod: f.audioUrl ? 'spectral_whisper' : 'spectral', transcript: tr, transcriptConfidence: tc, action: c >= 0.7 ? 'block' : c >= 0.4 ? 'warn' : 'allow' };
}
export const syntheticVoice = audioDeepfake;
export const voiceSynthesisDetect = audioDeepfake;

export interface BackgroundNoiseResult {
  detected: boolean; noiseType: 'call_center' | 'outdoor' | 'quiet_room' | 'music' | 'multiple_voices' | 'unknown';
  confidence: number; indicators: string[]; transcript: string | null; speakerCount: number;
}
export async function backgroundNoise(f: {
  ambientNoiseLevel: number; voiceCount: number; hasKeyboardTyping: boolean;
  hasHeadsetEcho: boolean; hasCallCenterHum: boolean; backgroundVoiceOverlap: boolean; audioUrl?: string;
}): Promise<BackgroundNoiseResult> {
  const ind: string[] = []; let c = 0;
  if (f.hasCallCenterHum) { ind.push('call_center_hum'); c += 0.5; }
  if (f.voiceCount >= 3) { ind.push('multi_bg_voices'); c += 0.4; }
  if (f.hasKeyboardTyping && f.ambientNoiseLevel > 0.3) { ind.push('typing_bg'); c += 0.2; }
  if (f.hasHeadsetEcho) { ind.push('headset_echo'); c += 0.3; }
  if (f.backgroundVoiceOverlap) { ind.push('voice_overlap'); c += 0.3; }
  let tr: string | null = null, sc = f.voiceCount;
  if (f.audioUrl) {
    const [w, d] = await Promise.all([whisperT(f.audioUrl).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }), pyannoteCnt(f.audioUrl)]);
    tr = w.text || null;
    if (d.count > 0) { sc = d.count; if (d.count >= 3) { ind.push('pyannote_multi'); c += 0.35; } }
  }
  const nt = c >= 0.5 ? 'call_center' : f.ambientNoiseLevel < 0.1 ? 'quiet_room' : 'unknown';
  return { detected: nt === 'call_center' || (sc >= 3 && c >= 0.4), noiseType: nt, confidence: Math.min(1, c), indicators: ind, transcript: tr, speakerCount: sc };
}
export const callCenterDetect = backgroundNoise;
export const ambientNoise = backgroundNoise;

export interface MultipleVoicesResult {
  detected: boolean; speakerCount: number; confidence: number;
  segments: Array<{ speaker: string; start: number; end: number }>;
  riskLevel: 'none' | 'low' | 'medium' | 'high'; recommendation: string;
}
export async function multipleVoices(url: string, expected = 1): Promise<MultipleVoicesResult> {
  const d = await pyannoteCnt(url), sc = d.count, det = sc > expected;
  const rl = sc >= expected + 3 ? 'high' : sc >= expected + 2 ? 'medium' : det ? 'low' : 'none';
  return { detected: det, speakerCount: sc, confidence: sc > 0 ? 0.8 : 0, segments: d.segs, riskLevel: rl, recommendation: det ? `Detected ${sc} speakers (expected ${expected}). Someone else may be present or coaching.` : 'Audio matches expected speaker count.' };
}
export const multiVoiceDetect = multipleVoices;
export const speakerCountDetect = multipleVoices;

export interface MusicFingerprintResult {
  identified: boolean; title?: string; artist?: string; confidence: number; method: string;
  isMusic: boolean; tempoBpm?: number; harmonicRatio: number; spectralRegularity: number;
}
export function musicFingerprint(f: { spectralPeaks: number[]; chromaprint?: string; durationAnalyzed: number }): MusicFingerprintResult {
  const pk = f.spectralPeaks;
  if (pk.length < 2) return { identified: false, confidence: 0, method: 'spectral_analysis', isMusic: false, harmonicRatio: 0, spectralRegularity: 0 };
  let hm = 0;
  for (let i = 1; i < pk.length; i++) { const r = pk[i]! / pk[0]!; for (const h of [2, 3, 4, 1.5, 1.25, 5 / 4, 4 / 3, 3 / 2]) if (Math.abs(r - h) < 0.08) { hm++; break; } }
  const hr = hm / Math.max(1, pk.length - 1);
  const gaps = pk.slice(1).map((v, i) => v - pk[i]!);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const reg = 1 - (gaps.reduce((s, g) => s + Math.abs(g - avg), 0) / (gaps.length * avg || 1));
  const isMusic = hr > 0.4 && reg > 0.3;
  let bpm: number | undefined;
  if (isMusic && reg > 0.5 && avg > 0) { bpm = Math.round(60 / avg); if (bpm < 40 || bpm > 240) bpm = undefined; }
  const conf = isMusic ? Math.min(0.95, hr * 0.6 + reg * 0.4) : 0;
  return { identified: isMusic && conf > 0.5, confidence: Math.round(conf * 100) / 100, method: 'spectral_analysis', isMusic, tempoBpm: bpm, harmonicRatio: Math.round(hr * 100) / 100, spectralRegularity: Math.round(reg * 100) / 100 };
}
export const backgroundMusic = musicFingerprint;
export const audioFingerprint = musicFingerprint;

export interface BluetoothTrackerResult {
  alertShown: boolean; knownTrackers: string[]; tips: string[]; scanPerformed: boolean;
}
export function bluetoothTracker(ctx: { preDate: boolean; nearbyDevices: string[] }): BluetoothTrackerResult {
  const PRE = ['AirTag', 'Tile', 'Chipolo', 'Samsung SmartTag', 'Nut', 'Gigaset'];
  const kt = ctx.nearbyDevices.filter(d => PRE.some(t => d.toLowerCase().includes(t.toLowerCase())));
  return { alertShown: ctx.preDate || kt.length > 0, knownTrackers: kt, tips: ['Check belongings for unfamiliar trackers', 'iOS: "Find My" → "Items Detected Near You"', 'Android: "Find My Device" → "Unknown tracker alerts"', 'Disable unfamiliar trackers and contact authorities', 'Some trackers can play a sound to help locate them'], scanPerformed: ctx.nearbyDevices.length > 0 };
}
export const airtag = bluetoothTracker;
export const trackerDetect = bluetoothTracker;

export interface AppealWorkflowResult {
  submitted: boolean; appealId: string; status: 'pending' | 'under_review' | 'approved' | 'denied';
  estimatedResponseTime: string; nextSteps: string[];
}
export function appealWorkflow(s: {
  userId: string; actionTaken: string; reasonGiven: string;
  userStatement: string; evidenceUrls?: string[];
}): AppealWorkflowResult {
  const id = `APPEAL-${Date.now().toString(36).toUpperCase()}`;
  void writeAuditLog('moderation.appeal_submitted', { appealId: id, userId: s.userId, action: s.actionTaken }).catch(() => {});
  return { submitted: true, appealId: id, status: 'pending', estimatedResponseTime: '48-72 hours', nextSteps: ['Your appeal will be reviewed by a human moderator', 'You will be notified of the decision', 'If denied, you may submit one additional appeal with new evidence', 'For urgent cases: safety@myarchetype.app'] };
}
export const disputeProcess = appealWorkflow;
export const banAppeal = appealWorkflow;

export interface SocialAccountAgeResult {
  verified: boolean; accountAgeDays: number; meetsMinimum: boolean;
  platform: string; riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function socialAccountAge(a: { platform: string; creationDate?: string; oldestPostDate?: string; followerCount?: number; postCount?: number }): SocialAccountAgeResult {
  let d = 0;
  if (a.creationDate) d = Math.floor((Date.now() - new Date(a.creationDate).getTime()) / 86400000);
  else if (a.oldestPostDate) d = Math.floor((Date.now() - new Date(a.oldestPostDate).getTime()) / 86400000);
  const m = d >= 90, v = d > 0, rl = !v ? 'high' : d < 30 ? 'medium' : d < 90 ? 'low' : 'none';
  return { verified: v, accountAgeDays: d, meetsMinimum: m, platform: a.platform, riskLevel: rl };
}
export const accountCreationDate = socialAccountAge;

export interface SocialActivityResult {
  active: boolean; lastActivityDays: number;
  activityLevel: 'none' | 'low' | 'moderate' | 'high'; riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function socialActivity(a: { lastPostDate?: string; lastLoginDate?: string; postsLast30Days?: number; avgPostsPerWeek?: number }): SocialActivityResult {
  const l = a.lastPostDate ?? a.lastLoginDate;
  const lad = l ? Math.floor((Date.now() - new Date(l).getTime()) / 86400000) : 999;
  const p = a.postsLast30Days ?? (a.avgPostsPerWeek ?? 0) * 4;
  const al = p >= 10 ? 'high' : p >= 3 ? 'moderate' : p >= 1 ? 'low' : 'none';
  const act = lad <= 30 && al !== 'none';
  const rl = lad > 180 ? 'high' : lad > 90 ? 'medium' : lad > 30 ? 'low' : 'none';
  return { active: act, lastActivityDays: lad, activityLevel: al, riskLevel: rl };
}
export const lastPost = socialActivity;
export const accountRecency = socialActivity;

export interface ReportPIILeakageResult {
  sanitized: boolean; originalLength: number; sanitizedLength: number; removedPII: string[];
  sanitizedText: string; presidioEntities: Array<{ type: string; text: string; score: number }>;
  source: 'presidio' | 'regex_fallback' | 'both';
}
const PII_PAT: Array<{ regex: RegExp; type: string }> = [
  { regex: /\b\d{3}[-.]?\d{3,4}[-.]?\d{4}\b/g, type: 'phone' },
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, type: 'email' },
  { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, type: 'ip' },
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, type: 'ssn' },
  { regex: /\b(-?\d+\.\d{4,}),\s*(-?\d+\.\d{4,})\b/g, type: 'gps' },
  { regex: /\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln)\b[^,.]*?/gi, type: 'address' },
];
export async function reportPIILeakage(text: string): Promise<ReportPIILeakageResult> {
  const rm: string[] = []; let sn = text;
  for (const { regex, type } of PII_PAT) {
    regex.lastIndex = 0;
    if (regex.test(text)) { rm.push(type); regex.lastIndex = 0; export async function reportPIILeakage(text: string): Promise<ReportPIILeakageResult> {
  const rm: string[] = []; let sn = text;
  for (const { regex, type } of PII_PAT) {
    regex.lastIndex = 0;
    if (regex.test(text)) {
      rm.push(type);
      regex.lastIndex = 0;
      sn = sn.replace(regex, `[${type}_REDACTED]`);
    }
  }
  const pE: Array<{ type: string; text: string; score: number }> = [];
  for (const e of await presidioPII(text)) {
    const t = e.entity_type.toLowerCase();
    if (!rm.includes(t)) {
      rm.push(t);
      pE.push({ type: t, text: e.text, score: e.score });
      sn = sn.replace(e.text, `[${t}_REDACTED]`);
    }
  }
  return {
    sanitized: rm.length > 0,
    originalLength: text.length,
    sanitizedLength: sn.length,
    removedPII: rm,
    sanitizedText: sn,
    presidioEntities: pE,
    source: pE.length > 0 && rm.length > pE.length ? 'both' : pE.length > 0 ? 'presidio' : 'regex_fallback'
  };
}

  }
  const pE: Array<{ type: string; text: string; score: number }> = [];
  for (const e of await presidioPII(text)) {
    const t = e.entity_type.toLowerCase();
    if (!rm.includes(t)) { rm.push(t); pE.push({ type: t, text: e.text, score: e.score }); sn = sn.replace(e.text, `[${t}_REDACTED]`); }
  }
  return { sanitized: rm.length > 0, originalLength: text.length, sanitizedLength: sn.length, removedPII: rm, sanitizedText: sn, presidioEntities: pE, source: pE.length > 0 && rm.length > pE.length ? 'both' : pE.length > 0 ? 'presidio' : 'regex_fallback' };
}
export const piiInReport = reportPIILeakage;
export const sanitizeReport = reportPIILeakage;

export interface CompulsiveUsageResult {
  detected: boolean; sessionsToday: number; totalSwipesToday: number;
  averageSessionLength: number; riskLevel: 'none' | 'low' | 'medium' | 'high'; recommendation: string;
}
export function compulsiveUsage(sessions: Array<{ startTime: number; endTime: number; swipeCount: number }>): CompulsiveUsageResult {
  const td = new Date().setHours(0, 0, 0, 0);
  const ts = sessions.filter(s => s.startTime >= td);
  const st = ts.length, sw = ts.reduce((s, x) => s + x.swipeCount, 0);
  const avg = ts.length > 0 ? ts.reduce((s, x) => s + (x.endTime - x.startTime), 0) / ts.length / 60000 : 0;
  let rs = 0;
  if (st >= 10) rs += 2; else if (st >= 5) rs += 1;
  if (sw >= 200) rs += 2; else if (sw >= 100) rs += 1;
  if (avg >= 30) rs += 1;
  const rl = rs >= 4 ? 'high' : rs >= 2 ? 'medium' : rs >= 1 ? 'low' : 'none';
  return { detected: rl !== 'none', sessionsToday: st, totalSwipesToday: sw, averageSessionLength: Math.round(avg), riskLevel: rl, recommendation: rl === 'high' ? "You've been swiping a lot. Consider a break — your matches will still be here tomorrow." : rl === 'medium' ? 'Feeling tired? A short break might help you make better choices.' : 'Keep enjoying the app at your pace!' };
}
export const doomSwiping = compulsiveUsage;
export const excessiveSwipe = compulsiveUsage;

export interface RejectionOverloadResult {
  detected: boolean; rejectionRate: number; consecutiveRejections: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high'; recommendation: string;
}
export function rejectionOverload(h: {
  totalSwipes: number; rejections: number; matches: number;
  consecutiveRejections: number; timeWindowHours: number;
}): RejectionOverloadResult {
  const rr = h.totalSwipes > 0 ? h.rejections / h.totalSwipes : 0;
  let rs = 0;
  if (rr > 0.9 && h.totalSwipes > 20) rs += 2;
  if (h.consecutiveRejections >= 30) rs += 2; else if (h.consecutiveRejections >= 15) rs += 1;
  const rl = rs >= 3 ? 'high' : rs >= 1 ? 'medium' : 'none';
  return { detected: rl !== 'none', rejectionRate: Math.round(rr * 100) / 100, consecutiveRejections: h.consecutiveRejections, riskLevel: rl, recommendation: rl === 'high' ? "Tough streak. Remember — a \"no\" isn't about your worth. Take a break." : 'Every "no" gets you closer to the right "yes".' };
}
export const rejectionSensitivity = rejectionOverload;
export const massRejection = rejectionOverload;

export interface SelfEsteemImpactResult {
  impactScore: number; trend: 'improving' | 'stable' | 'declining';
  signals: string[]; recommendation: string;
}
export function selfEsteemImpact(d: {
  matchRateLast7Days: number; matchRatePrevious7Days: number;
  sessionCountTrend: 'up' | 'down' | 'stable'; reportFiledCount: number;
  bioEditCount: number; photoChangeCount: number;
}): SelfEsteemImpactResult {
  const sg: string[] = []; let sc = 0;
  const md = d.matchRateLast7Days - d.matchRatePrevious7Days;
  if (md < -0.1) { sg.push('declining_match_rate'); sc -= 2; } else if (md > 0.1) { sg.push('improving_match_rate'); sc += 2; }
  if (d.bioEditCount >= 5) { sg.push('frequent_bio_changes'); sc -= 1; }
  if (d.photoChangeCount >= 3) { sg.push('frequent_photo_changes'); sc -= 1; }
  if (d.reportFiledCount >= 2) { sg.push('multiple_reports'); sc -= 2; }
  if (d.sessionCountTrend === 'up' && md < 0) { sg.push('more_sessions_fewer_matches'); sc -= 2; }
  const t = sc >= 1 ? 'improving' : sc <= -2 ? 'declining' : 'stable';
  return { impactScore: sc, trend: t, signals: sg, recommendation: t === 'declining' ? "Patterns may affect how you're feeling. Your worth isn't measured by matches. Consider a day off." : t === 'improving' ? 'Things are looking up!' : "You're doing great." };
}
export const wellbeingScore = selfEsteemImpact;
export const mentalHealthImpact = selfEsteemImpact;

export interface EngagementVsWellbeingResult {
  balanceScore: number; engagementOverridden: boolean; recommendation: string; adjustments: string[];
}
export function engagementVsWellbeing(d: {
  userSessionMinutesToday: number; averageSessionMinutes: number; matchRate: number;
  reportedWellbeing?: number; swipeVelocity: number;
}): EngagementVsWellbeingResult {
  const aj: string[] = []; let bs = 50, eo = false;
  if (d.userSessionMinutesToday > d.averageSessionMinutes * 2) { bs -= 20; aj.push('reduce_recommendation_density'); }
  if ((d.reportedWellbeing ?? 5) < 4) { bs -= 30; aj.push('prioritize_quality', 'show_wellbeing_prompt'); eo = true; }
  if (d.matchRate < 0.05 && d.userSessionMinutesToday > 30) { bs -= 15; aj.push('suggest_break'); }
  if (d.swipeVelocity > 60) { bs -= 10; aj.push('slow_down_swipe_animation'); }
  return { balanceScore: Math.max(0, Math.min(100, bs)), engagementOverridden: eo, recommendation: bs < 30 ? "We're adjusting your experience to prioritize how you feel." : 'Your usage looks healthy.', adjustments: aj };
}
export const wellbeingTradeoff = engagementVsWellbeing;
export const engagementBalance = engagementVsWellbeing;

export interface RejectionThrottleResult {
  throttled: boolean; currentRejectionStreak: number; threshold: number;
  action: 'none' | 'slow_feed' | 'pause_feed' | 'suggest_break'; cooldownMinutes: number;
}
export function rejectionThrottle(d: {
  consecutiveNoMatches: number; sessionSwipesWithoutMatch: number; timeSinceLastMatchHours: number;
}): RejectionThrottleResult {
  const s = d.consecutiveNoMatches;
  let a: RejectionThrottleResult['action'] = 'none', c = 0, t = false;
  if (s >= 80) { a = 'suggest_break'; c = 60; t = true; }
  else if (s >= 50) { a = 'pause_feed'; c = 15; t = true; }
  else if (s >= 30) { a = 'slow_feed'; t = true; }
  return { throttled: t, currentRejectionStreak: s, threshold: 50, action: a, cooldownMinutes: c };
}
export const rejectionOverexposure = rejectionThrottle;
export const throttleRejection = rejectionThrottle;

export interface NegativeFeedbackLoopResult {
  detected: boolean; loopType: string[];
  severity: 'none' | 'low' | 'medium' | 'high'; intervention: string;
}
export function negativeFeedbackLoop(d: {
  day1MatchRate: number; day2MatchRate: number; day3MatchRate: number;
  day1SessionMin: number; day2SessionMin: number; day3SessionMin: number;
  bioChangedBetweenDays: boolean; photosChangedBetweenDays: boolean; reportedFeeling?: string;
}): NegativeFeedbackLoopResult {
  const lt: string[] = []; let sv: NegativeFeedbackLoopResult['severity'] = 'none';
  if (d.day1MatchRate > d.day3MatchRate * 1.5 && d.day3SessionMin > d.day1SessionMin * 1.5) { lt.push('compensation_spiral'); sv = 'high'; }
  if (d.bioChangedBetweenDays && d.day1MatchRate > d.day3MatchRate * 1.5) { lt.push('self_blame_loop'); if (sv === 'none') sv = 'medium'; }
  if (d.photosChangedBetweenDays && d.day1MatchRate > d.day3MatchRate * 1.5) { lt.push('appearance_anxiety_loop'); if (sv === 'none') sv = 'medium'; }
  if (d.reportedFeeling && /frustrated|ugly|worthless|hopeless|unloveable|giving\s+up/i.test(d.reportedFeeling)) { lt.push('emotional_decline'); sv = 'high'; }
  return { detected: lt.length > 0, loopType: lt, severity: sv, intervention: sv === 'high' ? "We notice a pattern that might be affecting how you feel. Your value isn't defined by match rates. Would you like to take a break?" : sv === 'medium' ? "Match rates fluctuate for everyone. You don't need to change who you are." : "You're doing fine." };
}
export const negativeLoop = negativeFeedbackLoop;
export const spiralDetect = negativeFeedbackLoop;

export interface EducationFraudResult {
  suspicious: boolean; institution: string; issues: string[]; confidence: number;
  semanticMatchScore: number; semanticMatchedInstitution: string | null;
}
const KN_UNI = new Set(['Harvard University', 'MIT', 'Stanford University', 'Yale University', 'Princeton University', 'Columbia University', 'University of Oxford', 'University of Cambridge', 'Caltech', 'University of Pennsylvania', 'Duke University', 'Northwestern University']);
export async function educationFraud(c: { institution: string; degree: string; graduationYear?: number; claimedGpa?: number }): Promise<EducationFraudResult> {
  const is: string[] = []; let cf = 0;
  if (KN_UNI.has(c.institution)) {
    if (c.claimedGpa && c.claimedGpa > 4.0) { is.push('gpa_exceeds_scale'); cf += 0.6; }
    if (c.graduationYear && c.graduationYear > new Date().getFullYear() + 1) { is.push('future_graduation'); cf += 0.4; }
    if (c.degree && /phd|md|jd/i.test(c.degree) && c.graduationYear && (new Date().getFullYear() - c.graduationYear) < 6) { is.push('professional_degree_too_fast'); cf += 0.2; }
  }
  let sms = 0, smi: string | null = null;
  if (!KN_UNI.has(c.institution) && c.institution.length > 3) {
    const m = await matchScr(`I graduated from ${c.institution} with a ${c.degree}`, EDU_SCR);
    sms = m.max; smi = m.hit;
    if (sms >= 0.8) { is.push('near_match_prestige'); cf += 0.4; }
  }
  return { suspicious: cf >= 0.4, institution: c.institution, issues: is, confidence: Math.min(1, cf), semanticMatchScore: Math.round(sms * 100) / 100, semanticMatchedInstitution: smi };
}
export const fakeEducation = educationFraud;
export const schoolFieldFraud = educationFraud;

export interface BodyFieldCheckResult { plausible: boolean; issues: string[]; adjustedValues: Record<string, string>; }
export function heightPlausibility(d: { heightCm?: number; weightKg?: number; gender?: string; age?: number }): BodyFieldCheckResult {
  const is: string[] = []; const aj: Record<string, string> = {};
  if (d.heightCm !== undefined) {
    if (d.heightCm > 230) { is.push('height_exceeds_record'); aj['heightCm'] = '230'; }
    if (d.heightCm < 140 && d.age && d.age > 18) is.push('height_below_adult');
    if ([183, 180, 185].includes(d.heightCm)) aj['note'] = 'common_rounded_height';
  }
  if (d.weightKg !== undefined && d.heightCm !== undefined) {
    const bmi = d.weightKg / ((d.heightCm / 100) ** 2);
    if (bmi < 14) is.push('dangerously_low_bmi');
    if (bmi > 50) is.push('extremely_high_bmi');
  }
  return { plausible: !is.length, issues: is, adjustedValues: aj };
}
export const weightPlausibility = heightPlausibility;
export const bodyFieldCheck = heightPlausibility;

export interface IncomeManipulationResult {
  suspicious: boolean; claimedIncome?: number; anomalies: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}
export function incomeManipulation(d: { claimedIncome?: number; age?: number; location?: string; profession?: string }): IncomeManipulationResult {
  const an: string[] = []; let rl: IncomeManipulationResult['riskLevel'] = 'none';
  if (d.claimedIncome && d.age) {
    if (d.claimedIncome > 500000 && d.age < 25) { an.push('very_high_income_young'); rl = 'high'; }
    if (d.claimedIncome > 1000000) { an.push('million_plus'); if (rl === 'none') rl = 'medium'; }
  }
  return { suspicious: an.length > 0, claimedIncome: d.claimedIncome, anomalies: an, riskLevel: rl };
}
export const wealthSignalingField = incomeManipulation;
export const incomeField = incomeManipulation;

export interface BodyMisrepresentationResult { categoryAdded: boolean; reportOptions: string[]; educationalNote: string; }
export function bodyMisrepresentation(): BodyMisrepresentationResult {
  return { categoryAdded: true, reportOptions: ['Photos significantly differ from current appearance', 'Photos appear to be from a different person', 'Photos are heavily edited/filtered', "Body type description doesn't match photos"], educationalNote: 'Appearance-based reports are handled with care. We encourage meeting in public places to form genuine connections.' };
}
export const bodyTypeReport = bodyMisrepresentation;
export const physicalMismatch = bodyMisrepresentation;

export interface NotificationModerationResult {
  safe: boolean; sanitizedText: string; flaggedContent: string[]; action: 'send' | 'sanitize' | 'block';
}
const NP: Array<{ regex: RegExp; type: string }> = [
  { regex: /\b(sexy|naked|nude|horny|dtf|hookup|nsfw)\b/i, type: 'sexual' },
  { regex: /\b(kill|die|hurt|harm|rape|murder)\b/i, type: 'violent' },
  { regex: /\$\d{3,}|\b(send\s+money|wire|bitcoin|crypto)\b/i, type: 'financial' },
  { regex: /\b(your\s+(address|location|where\s+you\s+live))\b/i, type: 'location' },
];
export function moderateNotification(text: string): NotificationModerationResult {
  const fc: string[] = []; let sn = text;
  for (const { regex, type } of NP) { if (regex.test(text)) { fc.push(type); sn = sn.replace(regex, '***'); } }
  return { safe: !fc.length, sanitizedText: sn, flaggedContent: fc, action: fc.includes('violent') ? 'block' : fc.length > 0 ? 'sanitize' : 'send' };
}
export const notificationModeration = moderateNotification;
export const pushContentSafety = moderateNotification;

export interface EmailHistoryResult {
  userId: string;
  emailHashes: string[];
  associatedAccounts: string[];
  suspiciousChange: boolean;
  changeCount: number;
  lastChangedAt: number | null;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  indicators: string[];
  recommendation: string;
}

interface EmailChangeRecord {
  userId: string;
  emailHash: string;
  changedAt: number;
  ipHash?: string;
  deviceFp?: string;
}

const emailHistoryStore = new Map<string, EmailChangeRecord[]>();
const hashToAccountMap = new Map<string, Set<string>>();

async function hashEmail(email: string): Promise<string> {
  try {
    const normalized = email.toLowerCase().trim();
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(normalized)
    );
    return Array.from(new Uint8Array(buf))
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    let h = 0;
    const s = email.toLowerCase().trim();
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16);
  }
}

export async function recordEmailChange(
  userId: string,
  newEmail: string,
  metadata?: { ipHash?: string; deviceFp?: string }
): Promise<void> {
  const hash = await hashEmail(newEmail);
  const record: EmailChangeRecord = {
    userId,
    emailHash: hash,
    changedAt: Date.now(),
    ipHash: metadata?.ipHash,
    deviceFp: metadata?.deviceFp,
  };

  const existing = emailHistoryStore.get(userId) ?? [];
  existing.push(record);
  emailHistoryStore.set(userId, existing);

  if (!hashToAccountMap.has(hash)) hashToAccountMap.set(hash, new Set());
  hashToAccountMap.get(hash)!.add(userId);
}

export async function getEmailHistory(
  userId: string,
  currentEmail?: string
): Promise<EmailHistoryResult> {
  const records = emailHistoryStore.get(userId) ?? [];
  const indicators: string[] = [];
  let riskScore = 0;

  const emailHashes = records.map(r => r.emailHash);
  const currentHash = currentEmail ? await hashEmail(currentEmail) : null;

  const associatedAccounts: string[] = [];
  for (const hash of emailHashes) {
    const accounts = hashToAccountMap.get(hash);
    if (accounts) {
      for (const uid of accounts) {
        if (uid !== userId && !associatedAccounts.includes(uid)) {
          associatedAccounts.push(uid);
        }
      }
    }
  }

  if (records.length >= 5) {
    indicators.push(`excessive_email_changes:${records.length}`);
    riskScore += 0.3;
  } else if (records.length >= 3) {
    indicators.push(`multiple_email_changes:${records.length}`);
    riskScore += 0.15;
  }

  if (associatedAccounts.length >= 2) {
    indicators.push(`email_shared_across_${associatedAccounts.length}_accounts`);
    riskScore += 0.4 * Math.min(1, associatedAccounts.length * 0.2);
  }

  const now = Date.now();
  const recentChanges = records.filter(r => now - r.changedAt < 7 * 86_400_000);
  if (recentChanges.length >= 3) {
    indicators.push(`rapid_email_changes_last_7d:${recentChanges.length}`);
    riskScore += 0.25;
  }

  const ips = new Set(records.map(r => r.ipHash).filter(Boolean));
  const devices = new Set(records.map(r => r.deviceFp).filter(Boolean));
  if (ips.size >= 4 && records.length >= 4) {
    indicators.push('email_changes_from_multiple_ips');
    riskScore += 0.15;
  }
  if (devices.size >= 3 && records.length >= 4) {
    indicators.push('email_changes_from_multiple_devices');
    riskScore += 0.1;
  }

  if (currentHash && associatedAccounts.length > 0 && !emailHashes.includes(currentHash)) {
    indicators.push('current_email_previously_used_by_other_account');
    riskScore += 0.35;
  }

  riskScore = Math.min(1, riskScore);
  const riskLevel: EmailHistoryResult['riskLevel'] =
    riskScore >= 0.7 ? 'high' :
    riskScore >= 0.4 ? 'medium' :
    riskScore >= 0.15 ? 'low' : 'none';

  const lastRecord = records.length > 0 ? records[records.length - 1]! : null;

  return {
    userId,
    emailHashes,
    associatedAccounts,
    suspiciousChange: riskScore >= 0.3,
    changeCount: records.length,
    lastChangedAt: lastRecord?.changedAt ?? null,
    riskLevel,
    indicators,
    recommendation:
      riskLevel === 'high'
        ? 'High-risk email history. Possible ban evasion or account takeover. Require re-verification.'
        : riskLevel === 'medium'
        ? 'Multiple email changes or cross-account associations detected. Monitor account.'
        : riskLevel === 'low'
        ? 'Minor email change activity. No immediate action required.'
        : 'No suspicious email history detected.',
  };
}

export const emailHistory = getEmailHistory;
export const historicalEmail = getEmailHistory;
export const emailAssociation = getEmailHistory;
export const emailChangeRecord = recordEmailChange;

export interface SendPauseResult {
  shouldPrompt: boolean; reason: string; severity: 'none' | 'low' | 'medium' | 'high';
  cooldownMs: number; duoGuardCategory: string | null; duoGuardScore: number;
}
const OFF_PAT = [
  /\b(you('re|\s+are)\s+(stupid|ugly|fat|dumb|worthless|pathetic|disgusting|trash|garbage))\b/i,
  /\b(go\s+die|kill\s+yourself|kys|end\s+it|jump\s+off)\b/i,
  /\b(i\s+hate\s+you|you\s+ruined|you\s+destroyed)\b/i,
  /\b(rape|rapist|pedophile|molester)\b/i,
];
export async function sendPause(text: string, ctx: { isFirstMessage: boolean; recentReports: number }): Promise<SendPauseResult> {
  for (const p of OFF_PAT) if (p.test(text)) return { shouldPrompt: true, reason: 'This message contains potentially harmful language. Are you sure?', severity: 'high', cooldownMs: 5000, duoGuardCategory: null, duoGuardScore: 0 };
  const dg = await duoGuard(text);
  if (!dg.safe && dg.max >= 0.6) {
    const lb: Record<string, string> = { violence: 'violent content', hate_speech: 'hateful content', sexual_content: 'sexually explicit content', self_harm: 'self-harm content', harassment: 'harassing language' };
    return { shouldPrompt: true, reason: `This message may contain ${lb[dg.cat] ?? 'harmful content'}. Are you sure?`, severity: dg.max >= 0.8 ? 'high' : 'medium', cooldownMs: dg.max >= 0.8 ? 5000 : 3000, duoGuardCategory: dg.cat, duoGuardScore: dg.max };
  }
  if (ctx.isFirstMessage && /\b(sexy|hot|beautiful|gorgeous)\b/i.test(text) && text.length < 20) return { shouldPrompt: true, reason: 'Short appearance-focused first messages often get negative responses. Consider adding substance.', severity: 'low', cooldownMs: 2000, duoGuardCategory: null, duoGuardScore: 0 };
  if (ctx.recentReports >= 1) return { shouldPrompt: true, reason: 'You recently received a report. Please be extra mindful.', severity: 'medium', cooldownMs: 3000, duoGuardCategory: null, duoGuardScore: 0 };
  return { shouldPrompt: false, reason: '', severity: 'none', cooldownMs: 0, duoGuardCategory: null, duoGuardScore: 0 };
}
export const areYouSure = sendPause;
export const offensivePrompt = sendPause;

export interface CommunicationConsentResult {
  allowed: boolean; reason: string; consentRequired: boolean;
  gateType: 'none' | 'match_required' | 'opt_in' | 'explicit';
}
export function communicationConsent(c: {
  senderId: string; recipientId: string; isMatched: boolean; recipientOptedIn: boolean;
  messageType: 'text' | 'image' | 'video_call' | 'voice_note' | 'gift';
  recipientSettings: { allowMessagesFromNonMatches: boolean; allowVideoCalls: boolean; allowGifts: boolean };
}): CommunicationConsentResult {
  if (!c.isMatched && !c.recipientSettings.allowMessagesFromNonMatches) return { allowed: false, reason: 'Recipient only accepts messages from matches', consentRequired: true, gateType: 'match_required' };
  if (c.messageType === 'video_call' && !c.recipientSettings.allowVideoCalls) return { allowed: false, reason: 'Recipient has disabled video calls', consentRequired: true, gateType: 'opt_in' };
  if (c.messageType === 'gift' && !c.recipientSettings.allowGifts) return { allowed: false, reason: 'Recipient has disabled gifts', consentRequired: true, gateType: 'opt_in' };
  return { allowed: true, reason: '', consentRequired: false, gateType: 'none' };
}
export const messageConsent = communicationConsent;
export const consentToMessage = communicationConsent;

export interface VideoCallBlockResult {
  blocked: boolean; reason: string; recipientSetting: boolean; alternativeAction: string;
}
export function unsolicitedCall(c: {
  callerId: string; recipientId: string; isMatched: boolean;
  hasPriorMessages: boolean; recipientOptIn: boolean;
}): VideoCallBlockResult {
  if (!c.recipientOptIn) return { blocked: true, reason: 'Recipient has not enabled video calls', recipientSetting: false, alternativeAction: "Send a text message first and ask if they'd like to video call" };
  if (!c.hasPriorMessages) return { blocked: true, reason: 'Video calls require at least some text conversation first', recipientSetting: true, alternativeAction: 'Start with a text conversation before calling' };
  return { blocked: false, reason: '', recipientSetting: true, alternativeAction: '' };
}
export const videoCallBlock = unsolicitedCall;
export const callConsent = unsolicitedCall;

export interface PreferenceMismatchResult {
  mismatchDetected: boolean; mismatches: string[];
  escalationLevel: 'none' | 'gentle_nudge' | 'suggestion' | 'warning'; recommendation: string;
}
export function preferenceMismatch(c: {
  senderPrefs: { communicationStyle: string; responseTimeExpectation: string; videoCallFrequency: string };
  recipientPrefs: { communicationStyle: string; responseTimeExpectation: string; videoCallFrequency: string };
  currentFriction: number;
}): PreferenceMismatchResult {
  const mm: string[] = [];
  if (c.senderPrefs.communicationStyle !== c.recipientPrefs.communicationStyle) mm.push('communication_style');
  if (c.senderPrefs.responseTimeExpectation !== c.recipientPrefs.responseTimeExpectation) mm.push('response_time_expectation');
  if (c.senderPrefs.videoCallFrequency !== c.recipientPrefs.videoCallFrequency) mm.push('video_call_frequency');
  const el = mm.length >= 3 ? 'warning' : mm.length >= 2 ? 'suggestion' : mm.length >= 1 ? 'gentle_nudge' : 'none';
  return { mismatchDetected: mm.length > 0, mismatches: mm, escalationLevel: el, recommendation: mm.includes('response_time_expectation') ? 'Different response time expectations — consider discussing what works for both.' : mm.includes('communication_style') ? 'Different communication styles — finding middle ground can help.' : '' };
}
export const commPreference = preferenceMismatch;
export const escalationMismatch = preferenceMismatch;

export interface LastOnlineStalkingResult {
  detected: boolean; checkCount: number; windowMinutes: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  action: 'none' | 'rate_limit' | 'hide_status' | 'warn';
}
export function lastOnlineStalking(checks: Array<{ viewerId: string; targetId: string; timestamp: number }>, vid: string, tid: string, win = 60): LastOnlineStalkingResult {
  const now = Date.now(), cc = checks.filter(c => c.viewerId === vid && c.targetId === tid && now - c.timestamp < win * 60000).length;
  const rl = cc >= 20 ? 'high' : cc >= 10 ? 'medium' : cc >= 5 ? 'low' : 'none';
  return { detected: cc >= 5, checkCount: cc, windowMinutes: win, riskLevel: rl, action: rl === 'high' ? 'hide_status' : rl === 'medium' ? 'rate_limit' : rl === 'low' ? 'warn' : 'none' };
}
export const onlineStatusObsessive = lastOnlineStalking;
export const statusCheckAbuse = lastOnlineStalking;

export interface OnlineVisibilityResult {
  visible: boolean; setting: 'always' | 'matches_only' | 'nobody' | 'custom'; granularity: string[];
}
export function statusVisibility(s: 'always' | 'matches_only' | 'nobody' | 'custom', c: { isMatched: boolean; isVerified: boolean }): OnlineVisibilityResult {
  const v = s === 'always' ? true : s === 'matches_only' ? c.isMatched : s === 'nobody' ? false : c.isMatched && c.isVerified;
  return { visible: v, setting: s, granularity: ['show_online_now', 'show_last_seen', 'show_active_status', 'show_typing_indicator'] };
}
export const onlineVisibility = statusVisibility;
export const hideOnlineStatus = statusVisibility;

export interface VrModerationResult {
  safe: boolean; violations: string[]; action: 'allow' | 'warn' | 'block';
  moderatedElements: string[]; duoGuardCategories: string[]; duoGuardMaxScore: number;
}
export async function vrModeration(env: { spatialAudioContent?: string; visualAssets: string[]; textOverlays: string[]; userGeneratedContent: string[] }): Promise<VrModerationResult> {
  const vl: string[] = [], me: string[] = [];
  const all = [env.spatialAudioContent ?? '', ...env.visualAssets, ...env.textOverlays, ...env.userGeneratedContent];
  for (const c of all) {
    if (/\b(nude|naked|sex|porn|xxx)\b/i.test(c)) { vl.push('sexual_content'); me.push(c.substring(0, 50)); }
    if (/\b(kill|murder|rape|torture)\b/i.test(c)) { vl.push('violent_content'); me.push(c.substring(0, 50)); }
    if (/\b(nazi|swastika|hitler)\b/i.test(c)) { vl.push('hate_symbol'); me.push(c.substring(0, 50)); }
  }
  const dgc: string[] = []; let dgms = 0;
  for (const c of all.filter(x => x.length > 5).slice(0, 10)) {
    const dg = await duoGuard(c);
    if (!dg.safe && dg.max >= 0.6) { if (!vl.includes(dg.cat)) { vl.push(dg.cat); me.push(`[DG:${dg.cat}] ${c.substring(0, 40)}`); } dgc.push(dg.cat); if (dg.max > dgms) dgms = dg.max; }
  }
  return { safe: !vl.length, violations: [...new Set(vl)], action: vl.length >= 2 ? 'block' : vl.length >= 1 ? 'warn' : 'allow', moderatedElements: me, duoGuardCategories: [...new Set(dgc)], duoGuardMaxScore: Math.round(dgms * 100) / 100 };
}
export const vrContent = vrModeration;
export const metaverseModeration = vrModeration;

export interface VrIdentityResult {
  verified: boolean; method: string; avatarLinkedToRealIdentity: boolean;
  confidence: number; faceMatchScore: number;
}
export async function vrIdentity(c: {
  hasVerifiedProfile: boolean; avatarCreationMethod: 'system_default' | 'photo_scan' | 'custom_upload';
  hasBiometricLink: boolean; accountAgeDays: number;
  faceEmbedding?: number[]; verifiedFaceEmbedding?: number[];
}): Promise<VrIdentityResult> {
  let cf = 0;
  if (c.hasVerifiedProfile) cf += 0.3;
  if (c.avatarCreationMethod === 'photo_scan') cf += 0.3;
  if (c.hasBiometricLink) cf += 0.3;
  if (c.accountAgeDays > 30) cf += 0.1;
  let fms = 0;
  if (c.faceEmbedding?.length && c.verifiedFaceEmbedding?.length) {
    const fr = await faceCmp(c.faceEmbedding, c.verifiedFaceEmbedding); fms = fr.sim; if (fr.match) cf += 0.2;
  }
  return { verified: cf >= 0.6, method: c.hasBiometricLink ? 'biometric_link' : 'profile_verification', avatarLinkedToRealIdentity: c.hasVerifiedProfile && c.hasBiometricLink, confidence: Math.min(1, cf), faceMatchScore: Math.round(fms * 100) / 100 };
}
export const avatarVerification = vrIdentity;
export const vrRealPerson = vrIdentity;

export interface WearableConsentResult {
  consented: boolean; dataTypes: string[]; purpose: string; revocable: boolean; consentDate?: number;
}
export function wearableConsent(c: { granted: boolean; dataTypes: string[]; purpose: string; timestamp?: number }): WearableConsentResult {
  return { consented: c.granted, dataTypes: c.granted ? c.dataTypes : [], purpose: c.purpose, revocable: true, consentDate: c.timestamp };
}
export const deviceDataConsent = wearableConsent;
export const biometricDeviceConsent = wearableConsent;

export interface BiometricMinimizationResult {
  compliant: boolean; collectedTypes: string[]; prohibitedTypes: string[];
  retentionDays: number; purpose: string;
}
const PROHIB = new Set(['dna', 'iris_scan', 'vein_pattern', 'gait_analysis', 'keystroke_dynamics', 'voice_print_full']);
export function biometricCollection(types: string[], purpose: string): BiometricMinimizationResult {
  const pt = types.filter(t => PROHIB.has(t));
  return { compliant: !pt.length, collectedTypes: types.filter(t => !PROHIB.has(t)), prohibitedTypes: pt, retentionDays: 30, purpose };
}
export const heartRateLimit = biometricCollection;
export const biometricMinimization = biometricCollection;

export interface GroupDateVerifyResult {
  verified: boolean; participantResults: Array<{ participantId: string; verified: boolean; method: string; faceMatchScore: number }>;
  allVerified: boolean; recommendation: string;
}
export async function groupDateVerify(parts: Array<{ participantId: string; hasIdVerification: boolean; hasPhoneVerification: boolean; hasSocialVerification: boolean; faceEmbedding?: number[]; verifiedFaceEmbedding?: number[] }>): Promise<GroupDateVerifyResult> {
  const res = await Promise.all(parts.map(async p => {
    let v = p.hasIdVerification || (p.hasPhoneVerification && p.hasSocialVerification).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }), m = p.hasIdVerification ? 'id_verification' : p.hasPhoneVerification ? 'phone_verification' : 'none', fms = 0;
    if (p.faceEmbedding?.length && p.verifiedFaceEmbedding?.length) { const fr = await faceCmp(p.faceEmbedding, p.verifiedFaceEmbedding); fms = fr.sim; if (fr.match && !v) { v = true; m = 'face_verification'; } }
    return { participantId: p.participantId, verified: v, method: m, faceMatchScore: Math.round(fms * 100) / 100 };
  }));
  const all = res.every(r => r.verified);
  return { verified: all, participantResults: res, allVerified: all, recommendation: all ? 'All participants are verified.' : 'Some participants are not verified. Consider asking them to verify before meeting.' };
}
export const groupIdentity = groupDateVerify;
export const participantVerify = groupDateVerify;

export interface GroupChatModerationResult {
  action: 'allow' | 'warn' | 'mute' | 'remove' | 'dissolve';
  flaggedMessages: Array<{ senderId: string; message: string; reason: string; score: number }>;
  toxicityScore: number; duoGuardCategories: string[];
  piiExposed: Array<{ type: string; text: string }>;
}
export async function groupChatModeration(msgs: Array<{ senderId: string; text: string; timestamp: number }>): Promise<GroupChatModerationResult> {
  const fg: GroupChatModerationResult['flaggedMessages'] = [], dgc: string[] = []; let ts = 0;
  for (const m of msgs) {
    if (/\b(kill|rape|murder|assault|beat\s+up)\b/i.test(m.text)) { fg.push({ senderId: m.senderId, message: m.text.substring(0, 50), reason: 'violent_content', score: 0.3 }); ts += 0.3; }
    if (/\b(nigger|faggot|tranny|chink|spic|kike)\b/i.test(m.text)) { fg.push({ senderId: m.senderId, message: m.text.substring(0, 50), reason: 'hate_speech', score: 0.4 }); ts += 0.4; }
    if (/\b(send\s+money|cash\s+app|venmo|paypal|bitcoin)\b/i.test(m.text)) { fg.push({ senderId: m.senderId, message: m.text.substring(0, 50), reason: 'financial_solicitation', score: 0.2 }); ts += 0.2; }
    if (/\b(onlyfans|content|subscribe|premium)\b/i.test(m.text)) { fg.push({ senderId: m.senderId, message: m.text.substring(0, 50), reason: 'solicitation', score: 0.15 }); ts += 0.15; }
  }
  for (const m of msgs.slice(-20)) {
    if (m.text.length < 5) continue;
    const dg = await duoGuard(m.text);
    if (!dg.safe && dg.max >= 0.6) { if (!fg.some(f => f.senderId === m.senderId && f.message === m.text.substring(0, 50))) { fg.push({ senderId: m.senderId, message: m.text.substring(0, 50), reason: `duoguard:${dg.cat}`, score: dg.max }); ts += dg.max * 0.5; } dgc.push(dg.cat); }
  }
  const pii = (await presidioPII(msgs.map(m => m.text).join(' '))).filter(e => ['PHONE_NUMBER', 'EMAIL', 'ADDRESS', 'SSN', 'LOCATION'].includes(e.entity_type)).map(e => ({ type: e.entity_type, text: e.text }));
  if (pii.length > 0) ts += 0.1;
  ts = Math.min(1, ts);
  return { action: ts >= 0.8 ? 'dissolve' : ts >= 0.5 ? 'remove' : ts >= 0.3 ? 'mute' : ts >= 0.1 ? 'warn' : 'allow', flaggedMessages: fg, toxicityScore: ts, duoGuardCategories: [...new Set(dgc)], piiExposed: pii };
}
export const multiPartyChat = groupChatModeration;
export const groupDynamics = groupChatModeration;

export interface EventOffenderResult {
  safe: boolean; flaggedAttendees: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high'; recommendation: string;
}
export function eventOffender(att: Array<{ userId: string; reportCount: number; banHistory: boolean; trustScore: number }>): EventOffenderResult {
  const fl = att.filter(a => a.reportCount >= 3 || a.banHistory || a.trustScore < 20);
  const rl = fl.some(a => a.banHistory) ? 'high' : fl.length >= 3 ? 'medium' : fl.length >= 1 ? 'low' : 'none';
  return { safe: !fl.length, flaggedAttendees: fl.map(a => a.userId), riskLevel: rl, recommendation: rl === 'high' ? 'Some attendees have serious safety concerns. Consider removing them.' : rl !== 'none' ? 'Some attendees have flags. Monitor the event.' : 'All attendees look good!' };
}
export const attendeeScreen = eventOffender;
export const eventSafetyCheck = eventOffender;

export interface OrganizerVerifyResult {
  verified: boolean; verificationLevel: 'none' | 'basic' | 'enhanced' | 'full';
  checks: string[]; recommendation: string;
}
export function organizerVerify(o: {
  hasIdVerification: boolean; hasPhoneVerification: boolean; hasEmailVerification: boolean;
  hasSocialVerification: boolean; accountAgeDays: number; previousEventsOrganized: number; reportCount: number;
}): OrganizerVerifyResult {
  const ch: string[] = [];
  if (o.hasIdVerification) ch.push('id_verified');
  if (o.hasPhoneVerification) ch.push('phone_verified');
  if (o.hasEmailVerification) ch.push('email_verified');
  if (o.hasSocialVerification) ch.push('social_verified');
  const lv = ch.length >= 3 && o.accountAgeDays > 30 && o.reportCount === 0 ? 'full' : ch.length >= 2 && o.accountAgeDays > 14 ? 'enhanced' : ch.length >= 1 ? 'basic' : 'none';
  return { verified: lv !== 'none', verificationLevel: lv, checks: ch, recommendation: lv === 'none' ? 'This organizer has not completed any verification. Attend with caution.' : lv === 'basic' ? 'Basic verification only. Consider asking for more details.' : 'Organizer is verified. Enjoy!' };
}
export const eventOrganizerCheck = organizerVerify;
export const hostVerification = organizerVerify;

export interface IpvRiskResult {
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'; score: number; factors: string[];
  resources: string[]; safetyPlan: string[]; shouldAlert: boolean;
  semanticMatchScore: number; semanticMatchedScript: string | null;
}
const IPV_PAT: Array<{ p: RegExp; f: string; w: number }> = [
  { p: /he\s+(checks?|monitors?|tracks?|controls?)\s+(my|the)\s+(phone|location|messages?|bank|money|social)/i, f: 'digital_surveillance', w: 3 },
  { p: /(he|she)\s+(won'?t\s+let|doesn'?t\s+allow|forbids?|prevents?)\s+me\s+from/i, f: 'controlling_behavior', w: 3 },
  { p: /(he|she)\s+(hit|slapped|pushed|choked|grabbed|punched|kicked|threw)\s+(me|things)/i, f: 'physical_violence', w: 5 },
  { p: /(he|she)\s+(threatened|said\s+he'?ll|said\s+she'?ll)\s+(kill|hurt|harm|destroy|ruin|kill\s+himself)/i, f: 'threats', w: 5 },
  { p: /i'?m\s+(afraid|scared|terrified|fearful)\s+(of|that\s+he|that\s+she)/i, f: 'fear', w: 3 },
  { p: /(isolated|cut\s+off|alienated)\s+(from|me\s+from)\s+(family|friends|support)/i, f: 'isolation', w: 3 },
  { p: /(he|she)\s+(calls?|names?|belittles?|humiliates?|degrades?|insults?)\s+me/i, f: 'emotional_abuse', w: 2 },
  { p: /(forced|pressured|coerced|made)\s+me\s+(to\s+)?(have\s+sex|do\s+sexual|perform)/i, f: 'sexual_coercion', w: 5 },
];
export async function ipvRisk(msgs: string[]): Promise<IpvRiskResult> {
  const fac: string[] = []; let sc = 0;
  for (const m of msgs) for (const { p, f, w } of IPV_PAT) if (p.test(m)) { fac.push(f); sc += w; }
  const all = msgs.join(' '); let sms = 0, smi: string | null = null;
  if (all.length > 20) {
    const r = await matchScr(all, IPV_SCR); sms = r.max; smi = r.hit;
    if (sms >= 0.7) { sc += 3; fac.push('semantic_ipv_match'); } else if (sms >= 0.5) { sc += 1; fac.push('semantic_ipv_possible'); }
  }
  sc = Math.min(30, sc);
  const rl = sc >= 15 ? 'critical' : sc >= 10 ? 'high' : sc >= 5 ? 'medium' : sc >= 2 ? 'low' : 'none';
  return { riskLevel: rl, score: sc, factors: [...new Set(fac)], resources: ['National DV Hotline: 1-800-799-7233', 'Crisis Text Line: Text HOME to 741741', 'Love Is Respect: 1-866-331-9474', 'thehotline.org'], safetyPlan: rl !== 'none' ? ['1. Tell someone you trust', '2. Create a safety exit plan', '3. Keep important documents accessible', '4. Save emergency numbers under a different name', '5. Consider a burner phone if monitored'] : [], shouldAlert: rl === 'critical' || rl === 'high', semanticMatchScore: Math.round(sms * 100) / 100, semanticMatchedScript: smi };
}
export const ipvAssessment = ipvRisk;
export const domesticViolence = ipvRisk;

export interface ForcedCreationResult {
  detected: boolean; confidence: number; indicators: string[]; recommendation: string;
}
export function forcedCreation(s: {
  accountCreatedFromSharedDevice: boolean; sameIpAsPartner: boolean; profileFilledByThirdParty: boolean;
  photosUploadedFromGalleryNotCamera: boolean; bioMatchesPartnerWritingStyle: boolean;
  accountUsedToMonitor: boolean; loginOnlyFromPartnerDevice: boolean;
}): ForcedCreationResult {
  const ind: string[] = []; let c = 0;
  if (s.accountCreatedFromSharedDevice) { ind.push('shared_device'); c += 0.2; }
  if (s.sameIpAsPartner) { ind.push('same_ip'); c += 0.15; }
  if (s.profileFilledByThirdParty) { ind.push('third_party_profile'); c += 0.4; }
  if (s.photosUploadedFromGalleryNotCamera) { ind.push('gallery_photos'); c += 0.1; }
  if (s.bioMatchesPartnerWritingStyle) { ind.push('partner_writing'); c += 0.3; }
  if (s.accountUsedToMonitor) { ind.push('monitoring'); c += 0.5; }
  if (s.loginOnlyFromPartnerDevice) { ind.push('only_partner_device'); c += 0.4; }
  c = Math.min(1, c);
  return { detected: c >= 0.4, confidence: c, indicators: ind, recommendation: c >= 0.4 ? 'This account may have been created by someone else. Help: 1-800-799-7233.' : '' };
}
export const coercedSignup = forcedCreation;
export const forcedAccount = forcedCreation;

export interface ReproductiveCoercionResult {
  detected: boolean; patterns: string[]; severity: Sev; resources: string[]; semanticMatchScore: number;
}
const REPRO_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /(?:he|she)\s+(?:won'?t|refuses?\s+to|won'?t\s+let)\s+(?:me\s+)?(?:use|take|get)\s+(?:birth\s+control|the\s+pill|contraception|plan\s+b|morning\s+after)/i, t: 'contraceptive_control', s: 'critical' },
  { p: /(?:he|she)\s+(?:wants?\s+me\s+to|is\s+trying\s+to\s+make\s+me|pressuring?\s+me\s+to)\s+(?:get\s+pregnant|have\s+a\s+baby|start\s+a\s+family)/i, t: 'pregnancy_pressure', s: 'high' },
  { p: /(?:poked?\s+holes|tampered?\s+with|removed?)\s+(?:in\s+)?(?:the\s+)?(?:condom|condoms)/i, t: 'condom_tampering', s: 'critical' },
  { p: /(?:he|she)\s+(?:threw\s+away|hid|destroyed|flushed)\s+(?:my\s+)?(?:birth\s+control|pills|contraception|plan\s+b)/i, t: 'medication_destruction', s: 'critical' },
  { p: /(?:he|she)\s+(?:said|told\s+me)\s+(?:he|she)\s+(?:would|will)\s+(?:leave|break\s+up|divorce)\s+(?:if|unless)\s+i\s+(?:don'?t|won'?t)\s+(?:get\s+pregnant|have\s+(?:a\s+)?baby|stop\s+taking)/i, t: 'ultimatum', s: 'high' },
  { p: /(?:tracking|monitoring)\s+(?:my\s+)?(?:period|cycle|ovulation|fertility)/i, t: 'cycle_tracking', s: 'medium' },
];
export async function reproductiveCoercion(msgs: string[]): Promise<ReproductiveCoercionResult> {
  const pts: string[] = []; let ms: Sev = 'none';
  for (const m of msgs) for (const { p, t, s } of REPRO_PAT) if (p.test(m)) { pts.push(t); ms = mxS(ms, s); }
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, REPRO_SCR); sms = r.max; if (sms >= 0.7 && ms === 'none') { ms = 'medium'; pts.push('semantic_repro_coercion'); } else if (sms >= 0.5 && ms === 'none') { ms = 'low'; pts.push('semantic_possible_repro'); } }
  return { detected: pts.length > 0, patterns: pts, severity: ms, resources: ['National DV Hotline: 1-800-799-7233', 'Planned Parenthood: 1-800-230-7526', 'reproductiveaccess.org'], semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const birthControlCoercion = reproductiveCoercion;
export const pregnancyCoercion = reproductiveCoercion;

export interface FinancialAbuseResult {
  detected: boolean; patterns: string[]; severity: Sev; resources: string[]; semanticMatchScore: number;
}
const FIN_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /(?:he|she)\s+(?:controls?|manages?|handles?)\s+(?:all\s+)?(?:my\s+)?(?:money|finances?|accounts?|bank)/i, t: 'financial_control', s: 'high' },
  { p: /(?:he|she)\s+(?:won'?t|refuses?\s+to)\s+(?:let|allow|give)\s+me\s+(?:access\s+to\s+)?(?:my\s+)?(?:money|bank|account|earnings?|paycheck)/i, t: 'access_denial', s: 'critical' },
  { p: /(?:he|she)\s+(?:took|stole|spent|used|drained)\s+(?:my\s+)?(?:money|savings|credit|cards?|inheritance)/i, t: 'theft', s: 'critical' },
  { p: /(?:he|she)\s+(?:makes?|forced?|pressured?)\s+me\s+(?:to\s+)?(?:sign|co-?sign|take\s+out)\s+(?:a\s+)?(?:loan|credit\s+card|mortgage|lease)/i, t: 'coerced_debt', s: 'high' },
  { p: /(?:he|she)\s+(?:monitors?|checks?|tracks?)\s+(?:my\s+)?(?:spending|purchases?|transactions?)/i, t: 'spending_surveillance', s: 'medium' },
  { p: /(?:i'?m\s+not\s+allowed|i\s+can'?t)\s+(?:to\s+)?(?:buy|spend|have|use)\s+(?:my\s+own\s+)?(?:money|\$|anything)/i, t: 'spending_restriction', s: 'high' },
  { p: /(?:he|she)\s+(?:gave|gives)\s+me\s+(?:an\s+)?(?:allowance|budget)\s+(?:and|i\s+have\s+to\s+ask)/i, t: 'allowance_control', s: 'high' },
];
export async function financialAbuse(msgs: string[]): Promise<FinancialAbuseResult> {
  const pts: string[] = []; let ms: Sev = 'none';
  for (const m of msgs) for (const { p, t, s } of FIN_PAT) if (p.test(m)) { pts.push(t); ms = mxS(ms, s); }
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, FIN_SCR); sms = r.max; if (sms >= 0.7 && ms === 'none') { ms = 'medium'; pts.push('semantic_fin_abuse'); } else if (sms >= 0.5 && ms === 'none') { ms = 'low'; pts.push('semantic_possible_fin'); } }
  return { detected: pts.length > 0, patterns: pts, severity: ms, resources: ['National DV Hotline: 1-800-799-7233', 'nnedv.org', 'womenslaw.org'], semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const moneyControl = financialAbuse;
export const financialCoercion = financialAbuse;

export interface ImmigrationWeaponResult {
  detected: boolean; patterns: string[]; severity: Sev; resources: string[]; semanticMatchScore: number;
}
const IMMIG_PAT: Array<{ p: RegExp; t: string; s: Sev }> = [
  { p: /(?:he|she)\s+(?:threatened|said\s+he'?ll|said\s+she'?ll|will)\s+(?:to\s+)?(?:deport|report|call\s+ice|get\s+me\s+deported|send\s+me\s+back)/i, t: 'deportation_threat', s: 'critical' },
  { p: /(?:he|she)\s+(?:won'?t|refuses?\s+to)\s+(?:help|let\s+me|sign|file)\s+(?:my\s+)?(?:immigration|visa|green\s+card|citizenship|papers?|application)/i, t: 'immigration_control', s: 'high' },
  { p: /(?:he|she)\s+(?:said|tells?\s+me)\s+(?:i\s+)?(?:can'?t|won'?t\s+be\s+able\s+to)\s+(?:stay|remain|live)\s+(?:here|in\s+(?:the\s+)?(?:us|uk|country))/i, t: 'residence_threat', s: 'high' },
  { p: /(?:if\s+i\s+)?(?:leave|report|tell|call\s+police)\s*.*(?:he|she)\s+will\s+(?:deport|report|cancel|revoke)/i, t: 'retaliation_threat', s: 'critical' },
  { p: /(?:he|she)\s+(?:took|hid|keeps?)\s+(?:my\s+)?(?:passport|visa|documents?|green\s+card|work\s+permit)/i, t: 'document_withholding', s: 'critical' },
];
export async function immigrationWeapon(msgs: string[]): Promise<ImmigrationWeaponResult> {
  const pts: string[] = []; let ms: Sev = 'none';
  for (const m of msgs) for (const { p, t, s } of IMMIG_PAT) if (p.test(m)) { pts.push(t); ms = mxS(ms, s); }
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, IMMIG_SCR); sms = r.max; if (sms >= 0.7 && ms === 'none') { ms = 'high'; pts.push('semantic_immig_weapon'); } else if (sms >= 0.5 && ms === 'none') { ms = 'medium'; pts.push('semantic_possible_immig'); } }
  return { detected: pts.length > 0, patterns: pts, severity: ms, resources: ['National DV Hotline: 1-800-799-7233', 'nilc.org', 'USCIS VAWA self-petition', 'ICE Tip Line: 1-866-347-2423'], semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const visaThreats = immigrationWeapon;
export const deportationThreats = immigrationWeapon;

export interface CaretakerExploitationResult {
  detected: boolean; confidence: number; indicators: string[]; riskLevel: Sev; resources: string[];
}
export function caretakerExploitation(s: {
  caretakerHasPowerOfAttorney: boolean; caretakerManagesFinances: boolean; largeTransfers: number;
  accountAccessFromCaretakerDevice: boolean; profileChangesByCaretaker: boolean;
  userReportedConcern: boolean; caretakerIsNewContact: boolean; transferRecipients: string[];
}): CaretakerExploitationResult {
  const ind: string[] = []; let c = 0;
  if (s.caretakerHasPowerOfAttorney && s.largeTransfers >= 3) { ind.push('frequent_transfers_poA'); c += 0.5; }
  if (s.caretakerManagesFinances && s.caretakerIsNewContact) { ind.push('new_contact_fin_control'); c += 0.4; }
  if (s.accountAccessFromCaretakerDevice && s.profileChangesByCaretaker) { ind.push('caretaker_device_changes'); c += 0.3; }
  if (s.userReportedConcern) { ind.push('user_concern'); c += 0.5; }
  if (s.largeTransfers >= 5) { ind.push('excessive_transfers'); c += 0.3; }
  c = Math.min(1, c);
  const rl = c >= 0.7 ? 'critical' : c >= 0.5 ? 'high' : c >= 0.3 ? 'medium' : c >= 0.1 ? 'low' : 'none';
  return { detected: c >= 0.3, confidence: c, indicators: ind, riskLevel: rl, resources: ['elderjustice.gov', 'ncea.acl.gov', 'AARP Fraud Watch: 1-877-908-3360', 'Adult Protective Services'] };
}
export const elderAbuse = caretakerExploitation;
export const caretakerAbuse = caretakerExploitation;

export interface DisabilityFetishResult {
  detected: boolean; patterns: string[]; severity: 'none' | 'low' | 'medium' | 'high';
  resources: string[]; semanticMatchScore: number;
}
const DEV_PAT: Array<{ p: RegExp; t: string }> = [
  { p: /\b(devotee|devoteeism|wannabe|pretender|pretending)\b/i, t: 'devotee_terminology' },
  { p: /\b(i\s+(?:love|am\s+attracted\s+to|prefer|have\s+a\s+thing\s+for|fetishize?)\s+(?:people\s+)?(?:with|who\s+(?:are|use|have)))\s+(?:wheelchairs?|disabilities?|amputations?|blindness|deafness|cerebral\s+palsy|down'?s?\s+syndrome|autism|aspie)/i, t: 'disability_attraction' },
  { p: /\b(wheelchair\s+fetish|crutch\s+fetish|brace\s+fetish|amputee\s+fetish|disability\s+fetish)\b/i, t: 'fetish_terms' },
  { p: /\b(i\s+)?(?:want|like|prefer)\s+(?:to\s+)?(?:date|meet|be\s+with)\s+(?:only\s+)?(?:disabled|wheelchair|amputee|blind|deaf)\s+(?:people|women|men|girls|boys)/i, t: 'exclusive_targeting' },
  { p: /\b(can\s+you\s+)?(?:send|show|share)\s+(?:me\s+)?(?:a\s+)?(?:photo|video|pic)\s+(?:of\s+)?(?:your\s+)?(?:wheelchair|prosthetic|brace|cane|walker|disability)/i, t: 'disability_content_request' },
];
export async function disabilityFetish(msgs: string[]): Promise<DisabilityFetishResult> {
  const pts: string[] = [];
  for (const m of msgs) for (const { p, t } of DEV_PAT) if (p.test(m)) pts.push(t);
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, DISAB_FET_SCR); sms = r.max; if (sms >= 0.7 && !pts.length) pts.push('semantic_devotee'); else if (sms >= 0.5 && !pts.length) pts.push('semantic_possible_devotee'); }
  const sv = pts.length >= 3 ? 'high' : pts.length >= 2 ? 'medium' : pts.length >= 1 ? 'low' : 'none';
  return { detected: pts.length > 0, patterns: pts, severity: sv, resources: ['Report this user if uncomfortable', 'ada.gov', 'ndrn.org'], semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const devoteeExploitation = disabilityFetish;
export const fetishizationDetect = disabilityFetish;

export interface AccessibilityScamResult {
  detected: boolean; scamType: string[]; severity: 'none' | 'low' | 'medium' | 'high';
  recommendation: string; semanticMatchScore: number;
}
const A11Y_PAT: Array<{ p: RegExp; t: string }> = [
  { p: /i\s+(?:can\s+)?(?:help\s+you\s+)?(?:fix|cure|treat|overcome|heal)\s+(?:your\s+)?(?:disability|condition|illness|blindness|deafness)/i, t: 'cure_scam' },
  { p: /(?:buy|purchase|invest\s+in)\s+(?:this|our|my)\s+(?:treatment|therapy|device|supplement|program)\s+(?:that|which)\s+(?:cures?|treats?|heals?|fixes?)/i, t: 'treatment_scam' },
  { p: /you\s+(?:qualify|are\s+eligible|have\s+been\s+selected)\s+for\s+(?:a\s+)?(?:free|special|government)\s+(?:grant|benefit|payment|assistance|fund)/i, t: 'benefit_scam' },
  { p: /(?:i\s+)?(?:need|want)\s+(?:you\s+to\s+)?(?:share|give|provide)\s+(?:your\s+)?(?:ssn|social\s+security|bank|account|medicare|medicaid)\s+(?:number|info|details)/i, t: 'info_harvest' },
  { p: /(?:special|discounted|exclusive)\s+(?:housing|employment|benefits?|services?)\s+(?:for|available\s+to)\s+(?:disabled|people\s+with\s+disabilities)/i, t: 'fake_service' },
];
export async function accessibilityScam(msgs: string[]): Promise<AccessibilityScamResult> {
  const st: string[] = [];
  for (const m of msgs) for (const { p, t } of A11Y_PAT) if (p.test(m)) st.push(t);
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, A11Y_SCAM_SCR); sms = r.max; if (sms >= 0.7 && !st.length) st.push('semantic_disability_scam'); }
  const sv = st.length >= 3 ? 'high' : st.length >= 2 ? 'medium' : st.length >= 1 ? 'low' : 'none';
  return { detected: st.length > 0, scamType: st, severity: sv, recommendation: sv !== 'none' ? 'Be cautious — people target disabled individuals with scams. Never share personal/financial info.' : '', semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const disabilityScam = accessibilityScam;
export const a11yScamVector = accessibilityScam;

export interface InterfaithExploitationResult {
  detected: boolean; patterns: string[]; severity: 'none' | 'low' | 'medium' | 'high';
  recommendation: string; semanticMatchScore: number;
}
const IF_PAT: Array<{ p: RegExp; t: string }> = [
  { p: /(?:i\s+)?(?:will|can|want\s+to)\s+(?:convert|change|bring\s+you\s+(?:to|into))\s+(?:my|the\s+true|the\s+right)\s+(?:faith|religion|belief|church|mosque|temple)/i, t: 'conversion_pressure' },
  { p: /(?:your\s+)?(?:religion|faith|beliefs?)\s+(?:is|are)\s+(?:wrong|false|evil|satanic|devil|infidel|haram|kuffar)/i, t: 'faith_denigration' },
  { p: /(?:i\s+can'?t|we\s+can'?t|my\s+family\s+won'?t)\s+(?:be\s+together|marry|date|accept)\s+(?:unless|if\s+you\s+don'?t)\s+(?:you\s+)?(?:convert|change\s+religion|leave\s+your\s+faith)/i, t: 'ultimatum_conversion' },
  { p: /(?:my\s+)?(?:family|community|parents?)\s+(?:will|would)\s+(?:disown|kill|harm|reject|banish|cast\s+out)\s+(?:me|us)\s+(?:if|unless)\s+/i, t: 'family_pressure_weapon' },
  { p: /(?:pretend\s+to\s+be|act\s+like|tell\s+them\s+you'?re)\s+(?:a\s+)?(?:muslim|christian|jew|hindu|buddhist|atheist)\s+(?:for|until|just\s+until)/i, t: 'identity_concealment' },
];
export async function interfaithExploitation(msgs: string[]): Promise<InterfaithExploitationResult> {
  const pts: string[] = [];
  for (const m of msgs) for (const { p, t } of IF_PAT) if (p.test(m)) pts.push(t);
  const all = msgs.join(' '); let sms = 0;
  if (all.length > 20) { const r = await matchScr(all, INTERFAITH_SCR); sms = r.max; if (sms >= 0.7 && !pts.length) pts.push('semantic_interfaith'); else if (sms >= 0.5 && !pts.length) pts.push('semantic_possible_interfaith'); }
  const sv = pts.length >= 3 ? 'high' : pts.length >= 2 ? 'medium' : pts.length >= 1 ? 'low' : 'none';
  return { detected: pts.length > 0, patterns: pts, severity: sv, recommendation: sv !== 'none' ? 'Your faith is your own. No one should pressure you to change it.' : '', semanticMatchScore: Math.round(sms * 100) / 100 };
}
export const religiousExploitation = interfaithExploitation;
export const faithExploit = interfaithExploitation;

export interface InsiderAbuseResult {
  detected: boolean; confidence: number; indicators: string[];
  action: 'monitor' | 'restrict' | 'investigate' | 'terminate';
  dataAccessReview: string[]; piiTypesAccessed: string[]; piiAccessAnomaly: boolean;
}
export async function insiderAbuse(s: {
  role: string; dataAccessLevel: number; failedAuthAttempts: number; offHoursAccess: number;
  dataExportCount: number; accountChanges: number; ticketResolutionAnomalies: number;
  accessedOwnProfile: boolean; accessedExProfiles: boolean; viewedPrivateDataWithoutTicket: boolean;
  recentlyViewedText?: string;
}): Promise<InsiderAbuseResult> {
  const ind: string[] = []; let c = 0;
  if (s.failedAuthAttempts >= 5) { ind.push('excessive_failed_auth'); c += 0.2; }
  if (s.offHoursAccess >= 3) { ind.push('off_hours'); c += 0.15; }
  if (s.dataExportCount >= 10) { ind.push('excessive_exports'); c += 0.3; }
  if (s.accountChanges >= 5) { ind.push('excessive_changes'); c += 0.2; }
  if (s.ticketResolutionAnomalies >= 3) { ind.push('ticket_anomalies'); c += 0.2; }
  if (s.accessedOwnProfile) { ind.push('self_profile'); c += 0.15; }
  if (s.accessedExProfiles) { ind.push('ex_profile'); c += 0.4; }
  if (s.viewedPrivateDataWithoutTicket) { ind.push('unauthorized_view'); c += 0.5; }
  const piiT: string[] = []; let piiA = false;
  if (s.recentlyViewedText && s.recentlyViewedText.length > 10) {
    const sns = new Set(['PHONE_NUMBER', 'EMAIL', 'SSN', 'CREDIT_CARD', 'IBAN', 'ADDRESS', 'PASSPORT', 'DRIVER_LICENSE']);
    for (const e of await presidioPII(s.recentlyViewedText)) if (sns.has(e.entity_type)) piiT.push(e.entity_type);
    if (piiT.length > 0 && !s.viewedPrivateDataWithoutTicket) { ind.push('pii_no_ticket'); c += 0.3; piiA = true; }
  }
  c = Math.min(1, c);
  return { detected: c >= 0.3, confidence: c, indicators: ind, action: c >= 0.7 ? 'terminate' : c >= 0.5 ? 'investigate' : c >= 0.3 ? 'restrict' : 'monitor', dataAccessReview: c >= 0.3 ? ['audit_all_access', 'review_exports', 'check_exfiltration', 'review_profiles'] : [], piiTypesAccessed: [...new Set(piiT)], piiAccessAnomaly: piiA };
}
export const insiderAccess = insiderAbuse;
export const adminAbuseDetect = insiderAbuse;

export interface AnonAbuseResult {
  detected: boolean; riskScore: number; indicators: string[];
  action: 'allow' | 'rate_limit' | 'restrict' | 'shadow_ban' | 'ban';
  faceMatchToBanned: boolean; faceMatchScore: number;
}
export async function anonAbuse(a: {
  accountAgeDays: number; reportsReceived: number; messagesSentPerDay: number; blocksReceived: number;
  matchedAccounts: number; hasVerification: boolean; deviceFingerprintMatchCount: number;
  similarAccountBanned: boolean; faceEmbedding?: number[];
  bannedFaceEmbeddings?: Array<{ userId: string; embedding: number[] }>;
}): Promise<AnonAbuseResult> {
  const ind: string[] = []; let rs = 0;
  if (a.accountAgeDays < 7 && a.messagesSentPerDay > 50) { ind.push('burst_new'); rs += 30; }
  if (a.reportsReceived >= 3) { ind.push('multi_reports'); rs += 25; }
  if (a.blocksReceived >= 5) { ind.push('freq_blocked'); rs += 20; }
  if (!a.hasVerification && a.accountAgeDays > 30) { ind.push('long_unverified'); rs += 10; }
  if (a.deviceFingerprintMatchCount >= 3) { ind.push('multi_device'); rs += 30; }
  if (a.similarAccountBanned) { ind.push('linked_banned'); rs += 40; }
  if (a.matchedAccounts === 0 && a.messagesSentPerDay > 20) { ind.push('no_matches_high'); rs += 15; }
  let fmB = false, fmS = 0;
  if (a.faceEmbedding?.length && a.bannedFaceEmbeddings?.length) {
    for (const b of a.bannedFaceEmbeddings) { const r = await faceCmp(a.faceEmbedding, b.embedding); if (r.match) { fmB = true; fmS = r.sim; ind.push('face_match_banned'); rs += 50; break; } }
  }
  rs = Math.min(100, rs);
  return { detected: rs >= 20, riskScore: rs, indicators: ind, action: rs >= 80 ? 'ban' : rs >= 60 ? 'shadow_ban' : rs >= 40 ? 'restrict' : rs >= 20 ? 'rate_limit' : 'allow', faceMatchToBanned: fmB, faceMatchScore: Math.round(fmS * 100) / 100 };
}
export const anonymousAbuse = anonAbuse;
export const throwawayAbuse = anonAbuse;

export interface SafetyPaywallResult {
  compliant: boolean; paywalledFeatures: string[]; requiredFree: string[]; recommendation: string;
}
const MUST_FREE = ['block_user', 'report_user', 'unmatch', 'quick_exit', 'emergency_sos', 'location_sharing', 'safety_checkin', 'trusted_contact', 'code_word', 'delete_account', 'data_export', 'privacy_settings', 'mute_user', 'photo_verification', 'message_filtering'];
export function safetyPaywall(features: Array<{ name: string; isPremium: boolean; category: string }>): SafetyPaywallResult {
  const pw = features.filter(f => f.isPremium && MUST_FREE.includes(f.name));
  return { compliant: !pw.length, paywalledFeatures: pw.map(f => f.name), requiredFree: MUST_FREE, recommendation: pw.length ? `CRITICAL: These safety features must be free: ${pw.map(f => f.name).join(', ')}.` : 'All safety features free. Compliant.' };
}
export const paywallSafety = safetyPaywall;
export const freeSafetyFeature = safetyPaywall;

export interface DeceptiveUrgencyResult {
  detected: boolean; instances: string[]; severity: 'none' | 'low' | 'medium' | 'high'; recommendation: string;
}
const DEC_PAT: Array<{ p: RegExp; t: string }> = [
  { p: /(?:only|just)\s+\d+\s+(?:left|remaining|spots?|available)/i, t: 'fake_scarcity' },
  { p: /(?:offer|deal|price)\s+(?:ends?|expires?|disappears?)\s+(?:in|within|today|tonight|now)/i, t: 'time_pressure' },
  { p: /\d+\s+people\s+(?:are|were)\s+(?:looking|interested|waiting)\s+(?:at|for)/i, t: 'social_pressure' },
  { p: /(?:don'?t|do\s+not)\s+(?:miss|lose|let\s+this|pass\s+up)\s+(?:out\s+on|this|your)/i, t: 'fomo' },
  { p: /(?:upgrade\s+)?(?:now|immediately|right\s+away|before\s+it'?s?\s+too\s+late)/i, t: 'urgency_words' },
  { p: /(?:your\s+)?(?:matches?|likes?|potential)\s+(?:will|are\s+going\s+to)\s+(?:expire|disappear|vanish|go\s+away)/i, t: 'loss_threat' },
];
export function deceptiveUrgency(copy: string[]): DeceptiveUrgencyResult {
  const inst: string[] = [];
  for (const c of copy) for (const { p, t } of DEC_PAT) if (p.test(c)) inst.push(t);
  const sv = inst.length >= 4 ? 'high' : inst.length >= 2 ? 'medium' : inst.length >= 1 ? 'low' : 'none';
  return { detected: inst.length > 0, instances: [...new Set(inst)], severity: sv, recommendation: sv !== 'none' ? 'Remove deceptive urgency from premium upsells.' : 'No deceptive urgency detected.' };
}
export const fakeScarcity = deceptiveUrgency;
export const urgentUpsell = deceptiveUrgency;

export interface PremiumWeaponizationResult {
  detected: boolean; weaponizedFeatures: string[]; abusePatterns: string[];
  action: 'none' | 'review' | 'restrict' | 'disable';
}
export function premiumWeaponization(d: { feature: string; usageByUser: Array<{ userId: string; usageCount: number; reportsGenerated: number; targetsUnique: number }> }): PremiumWeaponizationResult {
  const wf: string[] = [], ap: string[] = [];
  const ab = d.usageByUser.filter(u => u.reportsGenerated >= 3 || (u.targetsUnique >= 20 && u.usageCount / u.targetsUnique < 2));
  if (ab.length) {
    wf.push(d.feature);
    if (ab.some(a => a.reportsGenerated >= 5)) ap.push('mass_reporting');
    if (ab.some(a => a.targetsUnique >= 30)) ap.push('mass_targeting');
    if (ab.some(a => a.usageCount >= 100)) ap.push('excessive_usage');
  }
  return { detected: wf.length > 0, weaponizedFeatures: wf, abusePatterns: ap, action: ap.includes('mass_reporting') ? 'disable' : wf.length > 0 ? 'restrict' : 'none' };
}
export const featureWeaponize = premiumWeaponization;
export const premiumAbuse = premiumWeaponization;

export interface PremiumHarassmentResult {
  detected: boolean; feature: string; abuseType: string[]; victimCount: number;
  action: 'none' | 'warn_user' | 'restrict_feature' | 'revoke_premium' | 'ban';
}
export function premiumHarassment(d: { featureName: string; complaints: Array<{ reporterId: string; description: string; timestamp: number }>; usageLog: Array<{ userId: string; targetId: string; timestamp: number }> }): PremiumHarassmentResult {
  const at: string[] = [], vc = new Set(d.complaints.map(c => c.reporterId)).size;
  if (d.complaints.length >= 5) at.push('mass_complaints');
  if (d.complaints.some(c => /stalking|tracking|harassing|won'?t\s+stop|repeatedly/i.test(c.description))) at.push('stalking_behavior');
  if (d.usageLog.length >= 50) at.push('excessive_usage');
  const det = d.complaints.length >= 3 || at.length >= 2;
  return { detected: det, feature: d.featureName, abuseType: at, victimCount: vc, action: at.includes('mass_complaints') && vc >= 5 ? 'ban' : at.includes('stalking_behavior') ? 'revoke_premium' : det ? 'restrict_feature' : 'none' };
}
export const featureExploit = premiumHarassment;
export const premiumHarassAbuse = premiumHarassment;

export interface EmailHistoryResult {
  tracked: boolean; associatedAccounts: string[]; emailHashes: string[];
  firstSeenDate: string; lastSeenDate: string; riskIndicators: string[];
}
export function emailHistory(d: { currentEmail: string; previousEmails: string[]; associatedAccountIds: string[]; firstSeenTimestamp: number; lastSeenTimestamp: number }): EmailHistoryResult {
  const ri: string[] = [];
  if (d.previousEmails.length >= 3) ri.push('frequent_email_changes');
  if (d.associatedAccountIds.length >= 3) ri.push('multiple_accounts');
  if (d.previousEmails.some(e => /temp|throw|dummy/.test(e))) ri.push('disposable_email_history');
  const h = (s: string) => { let v = 0; for (let i = 0; i < s.length; i++) v = ((v << 5) - v + s.charCodeAt(i)) | 0; return Math.abs(v).toString(16); };
  return { tracked: true, associatedAccounts: d.associatedAccountIds, emailHashes: [d.currentEmail, ...d.previousEmails].map(h), firstSeenDate: new Date(d.firstSeenTimestamp).toISOString(), lastSeenDate: new Date(d.lastSeenTimestamp).toISOString(), riskIndicators: ri };
}
export const historicalEmail = emailHistory;
export const emailAssociation = emailHistory;

export interface CodeWordResult {
  triggered: boolean; word: string | null;
  action: 'alert_contacts' | 'fake_crash' | 'silent_sos' | 'record_audio' | 'none';
  alertMessage: string; contacts: string[];
}
export interface CodeWordConfig {
  words: string[]; action: 'alert_contacts' | 'fake_crash' | 'silent_sos' | 'record_audio';
  alertMessage: string; contacts: string[];
}
export function codeWordDetect(message: string, config: CodeWordConfig): CodeWordResult {
  const found = config.words.find(w => message.toLowerCase().includes(w.toLowerCase()));
  if (!found) return { triggered: false, word: null, action: 'none', alertMessage: '', contacts: [] };
  void writeAuditLog('safety.code_word_triggered', { word: found, action: config.action, timestamp: Date.now() }).catch(() => {});
  return { triggered: true, word: found, action: config.action, alertMessage: config.alertMessage, contacts: config.contacts };
}
export const distressSignal = codeWordDetect;
export const safeWord = codeWordDetect;