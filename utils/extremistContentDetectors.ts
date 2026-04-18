import { logger } from './logger';

export interface ExtremistImageryResult { flagged: boolean; matchType: 'hash_match' | 'symbol_detection' | 'clip_classification' | 'none'; confidence: number; category?: string; action: 'block' | 'review' | 'allow'; reportToGIFCT: boolean; }
export interface ExtremistTextResult { flagged: boolean; category?: string; confidence: number; keywords: string[]; action: 'block' | 'review' | 'allow'; }

export async function detectExtremistImagery(imageUri: string, imageHash: string, serverUrl: string): Promise<ExtremistImageryResult> {
  try {
    const hr = await checkGIFCTHash(imageHash, serverUrl);
    if (hr.matched) return { flagged: true, matchType: 'hash_match', confidence: 1.0, category: hr.category, action: 'block', reportToGIFCT: true };
    const sr = await detectHateSymbols(imageUri, serverUrl);
    if (sr.detected && sr.confidence > 0.75) return { flagged: true, matchType: 'symbol_detection', confidence: sr.confidence, category: sr.symbolType, action: sr.confidence > 0.85 ? 'block' : 'review', reportToGIFCT: false };
    const cr = await classifyExtremistCLIP(imageUri, serverUrl);
    if (cr.flagged) return { flagged: true, matchType: 'clip_classification', confidence: cr.confidence, category: cr.category, action: 'review', reportToGIFCT: false };
    return { flagged: false, matchType: 'none', confidence: 0, action: 'allow', reportToGIFCT: false };
  } catch (e) { logger.warn('[detectExtremistImagery]', e); return { flagged: false, matchType: 'none', confidence: 0, action: 'allow', reportToGIFCT: false }; }
}

async function checkGIFCTHash(h: string, u: string): Promise<{ matched: boolean; category?: string }> { try { const r = await fetch(`${u}/api/gifct-hash-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: h, hashType: 'pdq', threshold: 31 }) }); if (!r.ok) return { matched: false }; return await r.json() as { matched: boolean; category?: string }; } catch { return { matched: false }; } }
async function detectHateSymbols(i: string, u: string): Promise<{ detected: boolean; confidence: number; symbolType?: string }> { try { const r = await fetch(`${u}/api/detect-hate-symbols`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: i, model: 'yolo_adl_symbols', database: 'adl_hate_symbols_v3' }) }); if (!r.ok) return { detected: false, confidence: 0 }; return await r.json() as { detected: boolean; confidence: number; symbolType?: string }; } catch { return { detected: false, confidence: 0 }; } }
async function classifyExtremistCLIP(i: string, u: string): Promise<{ flagged: boolean; confidence: number; category?: string }> { try { const r = await fetch(`${u}/api/clip-classify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUri: i, prompts: ['terrorist propaganda', 'nazi imagery', 'white supremacist symbol', 'isis flag', 'extremist recruitment material', 'hate group symbol', 'racist meme', 'ethnic cleansing imagery', 'militia propaganda'], threshold: 0.6, model: 'clip-vit-large-patch14' }) }); if (!r.ok) return { flagged: false, confidence: 0 }; const d = await r.json() as { top_match: string; confidence: number; flagged: boolean }; return { flagged: d.flagged, confidence: d.confidence, category: d.top_match }; } catch { return { flagged: false, confidence: 0 }; } }

const EXTREMIST_KEYWORDS = ['join the cause', 'the great replacement', 'race war', '14 words', 'white jihad', 'accelerationism', 'lone wolf attack', 'proud boys', 'atomwaffen', 'base recruitment', 'patriot front', 'blood and soil', 'white genocide', 'day of the rope', 'ethnic cleansing', 'racial holy war', 'deutche wiedergeburt'];
const TERROR_ORGS = [/al\s*qaeda|al\s*qaida/i, /isis|isil|daesh|islamic\s*state/i, /taliban/i, /boko\s*haram/i, /hezbollah/i, /hamas/i, /al\s*shabaab/i, /jemaah\s*islamiyah/i, /new\s*ira/i, /eta/i, /shining\s*path/i, /lords\s*resistance\s*army/i, /abu\s*sayyaf/i, /ansar\s*al\s*sharia/i];
const HATE_GROUPS = [/ku\s*klux\s*klan|kkk/i, /neo\s*nazi/i, /white\s*(supremacist|nationalist|power)/i, /identity\s*evropa/i, /vanguard\s*america/i, /national\s*socialist/i, /daily\s*stormer/i, /stormfront/i, /iron\s*march/i, /folkish\s*front/i, /wolf\s*pack/i, /1\s*1\s*1\s*percent/i, /blood\s*tribe/i];
const INCITEMENT = [/kill\s+(all|every)\s*(jews|muslims|blacks|immigrants|minorities)/i, /exterminate\s*(the|all)\s*(jews|muslims|blacks)/i, /gas\s*(the|all)\s*(jews|muslims)/i, /hang\s+(them|all|the)/i, /shoot\s+up\s+(a\s+)?(school|mosque|synagogue|church|mall|crowd)/i, /bomb\s+(a\s+)?(school|mosque|synagogue|church|building|government)/i, /drive\s+(your\s+)?car\s+into/i, /mow\s+them\s+down/i, /cleanse\s+(the|our)\s*(streets|country|nation)/i, /remove\s+(all|every)\s*(immigrant|refugee|muslim|jew)/i, /deport\s+all/i, /they\s+must\s+(all\s+)?(die|be\s+killed)/i];
const MANIFESTO = [/the\s+great\s+replacement/i, /mein\s+kampf/i, /turner\s+diaries/i, /siege\s+(culture|text)/i, /breivik\s+manifesto/i, /protocol\s+of\s+the\s+elders/i, /zog/i, /white\s+genocide\s+theory/i, /kalergi\s+plan/i, /cultural\s+marxism/i, /race\s+realism/i, /jewish\s+question|jq/i, /the\s+long\s+march/i];

const RADICALIZATION_STAGES: { stage: string; patterns: RegExp[] }[] = [
  { stage: 'grievance', patterns: [/they('re| are)\s+(replacing|taking\s+over|invading)/i, /our\s+(people|race|culture)\s+is\s+(dying|being\s+destroyed)/i, /we('re| are)\s+under\s+(attack|threat|siege)/i] },
  { stage: 'justification', patterns: [/we\s+must\s+(defend|protect|fight\s+for)/i, /it('s| is)\s+(us|them)\s+or\s+(them|us)/i, /there('s| is)\s+no\s+other\s+way/i] },
  { stage: 'targeting', patterns: [/they\s+(are|re)\s+the\s+(enemy|problem|threat)/i, /(those|these)\s+people\s+(deserve|need\s+to)/i, /name\s+the\s+(enemy|problem)/i] },
  { stage: 'mobilization', patterns: [/join\s+(us|the\s+cause|our\s+movement)/i, /take\s+action/i, /do\s+your\s+part/i, /time\s+to\s+(act|fight|strike)/i] },
  { stage: 'operational', patterns: [/how\s+to\s+(make|build|get)\s+(a\s+)?(bomb|weapon|gun)/i, /lone\s+wolf/i, /operational\s+security|opsec/i, /soft\s+targets?/i, /tactical/i] },
];

export async function detectExtremistRecruitment(text: string, serverUrl?: string): Promise<ExtremistTextResult> {
  const l = text.toLowerCase();
  const fk = EXTREMIST_KEYWORDS.filter(kw => l.includes(kw)); if (fk.length > 0) return { flagged: true, category: 'extremist_recruitment', confidence: Math.min(0.9, 0.5 + fk.length * 0.15), keywords: fk, action: fk.length >= 2 ? 'block' : 'review' };
  const om = TERROR_ORGS.filter(p => p.test(text)).map(p => p.source); if (om.length > 0) return { flagged: true, category: 'terrorist_organization', confidence: 0.8, keywords: om, action: 'block' };
  const hm = HATE_GROUPS.filter(p => p.test(text)).map(p => p.source); if (hm.length > 0) return { flagged: true, category: 'hate_group', confidence: 0.75, keywords: hm, action: hm.length >= 2 ? 'block' : 'review' };
  const im = INCITEMENT.filter(p => p.test(text)).map(p => p.source); if (im.length > 0) return { flagged: true, category: 'violence_incitement', confidence: 0.95, keywords: im, action: 'block' };
  const mm = MANIFESTO.filter(p => p.test(text)).map(p => p.source); if (mm.length >= 2) return { flagged: true, category: 'extremist_ideology', confidence: 0.7, keywords: mm, action: 'review' };
  const sd: string[] = []; for (const st of RADICALIZATION_STAGES) { if (st.patterns.some(p => p.test(text))) sd.push(st.stage); }
  if (sd.length >= 3) return { flagged: true, category: 'radicalization_pipeline', confidence: Math.min(0.9, 0.4 + sd.length * 0.15), keywords: sd, action: 'block' };
  if (sd.length >= 2) return { flagged: true, category: 'radicalization_signals', confidence: 0.6, keywords: sd, action: 'review' };
  if (serverUrl) { try { const r = await fetch(`${serverUrl}/api/llama-guard-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, categories: ['hate_speech', 'violent_extremism', 'radicalization'] }) }); if (r.ok) { const d = await r.json() as { flagged: boolean; category?: string; confidence: number }; if (d.flagged) return { flagged: true, category: d.category, confidence: d.confidence, keywords: [], action: d.confidence > 0.8 ? 'block' : 'review' }; } } catch {} }
  return { flagged: false, confidence: 0, keywords: [], action: 'allow' };
}

export function detectViolenceIncitement(text: string) { const m = INCITEMENT.filter(p => p.test(text)).map(p => p.source); return { detected: m.length > 0, matches: m, severity: m.length >= 2 ? 'critical' as const : m.length >= 1 ? 'high' as const : 'none' as const }; }
export const incitementDetect = detectViolenceIncitement;
export function detectTerroristOrg(text: string) { return { detected: TERROR_ORGS.some(p => p.test(text)), matches: TERROR_ORGS.filter(p => p.test(text)).map(p => p.source) }; }
export const terrorOrgDetect = detectTerroristOrg;
export function detectHateGroup(text: string) { return { detected: HATE_GROUPS.some(p => p.test(text)), matches: HATE_GROUPS.filter(p => p.test(text)).map(p => p.source) }; }
export const hateGroupDetect = detectHateGroup;
export function detectRadicalizationPipeline(messages: string[]) { const st: string[] = []; for (const m of messages) { for (const s of RADICALIZATION_STAGES) { if (s.patterns.some(p => p.test(m)) && !st.includes(s.stage)) st.push(s.stage); } } return { detected: st.length >= 3, stages: st, score: st.length / RADICALIZATION_STAGES.length }; }
export const radicalPipeline = detectRadicalizationPipeline;
export function detectManifestoReference(text: string) { const m = MANIFESTO.filter(p => p.test(text)).map(p => p.source); return { detected: m.length >= 1, matches: m }; }
export const manifestoDetect = detectManifestoReference;
export async function shareHashWithGIFCT(imageHash: string, category: string, serverUrl: string): Promise<{ shared: boolean }> { try { const r = await fetch(`${serverUrl}/api/gifct-share-hash`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: imageHash, hashType: 'pdq', category, sharedAt: new Date().toISOString() }) }); return { shared: r.ok }; } catch { return { shared: false }; } }
export const gifctShare = shareHashWithGIFCT;