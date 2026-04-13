/**
 * Conversation Risk Analysis
 * [5.5] #341-352 | [5.4] Engagement Fraud
 */

// ─── #341 Scripted Conversation Detection ─────────────────

export interface ScriptedConversationResult {
  scriptedConversation:  boolean;
  responsePattern:       'verbose' | 'terse' | 'normal' | 'uniform';
  consistencyScore:      number;
  templateMatches:       number;
  suspiciousRepetitions: string[];
}

const KNOWN_SCAM_OPENERS = [
  'hello dear how are you doing today',
  'i saw your profile and i must say',
  'you are so beautiful i had to message',
  'i am a widower with one child',
  'i work on an oil rig',
  'i am a doctor working with nato',
  'god brought us together',
  'i believe in destiny',
];

export function detectScriptedConversation(
  messages:     Array<{ text: string; senderId: string; timestamp: number }>,
  targetUserId: string
): ScriptedConversationResult {
  const targetMsgs = messages
    .filter(m => m.senderId === targetUserId)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (targetMsgs.length < 3) {
    return { scriptedConversation: false, responsePattern: 'normal', consistencyScore: 0, templateMatches: 0, suspiciousRepetitions: [] };
  }

  const texts = targetMsgs.map(m => m.text);
  let maxSim   = 0;
  const suspiciousRepetitions: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const aWords = new Set((texts[i] ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 2));
      const bWords = new Set((texts[j] ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 2));
      const inter  = [...aWords].filter(w => bWords.has(w)).length;
      const union  = new Set([...aWords, ...bWords]).size;
      const sim    = union > 0 ? inter / union : 0;
      if (sim > maxSim) maxSim = sim;
      if (sim > 0.7 && texts[i] && texts[i]!.length > 30)
        suspiciousRepetitions.push(texts[i]!.substring(0, 60));
    }
  }

  const allText       = texts.join(' ').toLowerCase();
  const templateMatches = KNOWN_SCAM_OPENERS.filter(o => allText.includes(o)).length;
  const avgLen        = texts.reduce((s, t) => s + t.length, 0) / texts.length;
  const variance      = texts.reduce((s, t) => s + (t.length - avgLen) ** 2, 0) / texts.length;
  const stdDev        = Math.sqrt(variance);

  let responsePattern: ScriptedConversationResult['responsePattern'] = 'normal';
  if (avgLen > 300)                            responsePattern = 'verbose';
  else if (avgLen < 20)                        responsePattern = 'terse';
  else if (stdDev < 15 && texts.length >= 5)  responsePattern = 'uniform';

  const consistencyScore     = Math.round(maxSim * 100);
  const scriptedConversation =
    maxSim >= 0.75 || templateMatches >= 1 ||
    (responsePattern === 'uniform' && texts.length >= 5) ||
    suspiciousRepetitions.length >= 2;

  return {
    scriptedConversation,
    responsePattern,
    consistencyScore,
    templateMatches,
    suspiciousRepetitions: [...new Set(suspiciousRepetitions)].slice(0, 5),
  };
}

// ─── #342 Response Timing Anomalies ──────────────────────

export interface ResponseTimingResult {
  anomalyDetected:    boolean;
  averageResponseMs:  number;
  tooFastResponses:   number;
  roboticTiming:      boolean;
  analysis:           string;
}

export function analyzeResponseTiming(
  messages:     Array<{ timestamp: number; senderId: string }>,
  targetUserId: string
): ResponseTimingResult {
  const sorted        = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const responseTimes: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (prev.senderId !== targetUserId && curr.senderId === targetUserId) {
      responseTimes.push(curr.timestamp - prev.timestamp);
    }
  }

  if (responseTimes.length < 3) {
    return { anomalyDetected: false, averageResponseMs: 0, tooFastResponses: 0, roboticTiming: false, analysis: 'insufficient_data' };
  }

  const avg              = responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length;
  const tooFastResponses = responseTimes.filter(t => t < 500).length;
  const variance         = responseTimes.reduce((s, t) => s + (t - avg) ** 2, 0) / responseTimes.length;
  const cv               = avg > 0 ? Math.sqrt(variance) / avg : 0;
  const roboticTiming    = cv < 0.1 && responseTimes.length >= 5;
  const anomalyDetected  = tooFastResponses >= 3 || roboticTiming;

  return {
    anomalyDetected,
    averageResponseMs: Math.round(avg),
    tooFastResponses,
    roboticTiming,
    analysis: anomalyDetected ? 'Automated response pattern detected' : 'Response timing appears human',
  };
}

// ─── #343 Conversation Graph Analysis ────────────────────

export interface ConversationGraphResult {
  isOneDirectional:     boolean;
  suspectMessageRatio:  number;
  topicSteeringDetected: boolean;
  topicsIntroduced:     string[];
}

const STEERING_TOPICS = [
  { topic: 'financial',       patterns: [/money|invest|crypto|bitcoin|send|wire|transfer/i] },
  { topic: 'intimacy',        patterns: [/photo|pic|naked|intimate|sexy|bedroom|alone/i] },
  { topic: 'platform_switch', patterns: [/whatsapp|telegram|text\s+me|my\s+number|signal/i] },
  { topic: 'personal_info',   patterns: [/address|location|where\s+do\s+you\s+live|phone\s+number/i] },
  { topic: 'religion',        patterns: [/god|pray|church|religious|faith|bless/i] },
];

export function analyzeConversationGraph(
  messages:  Array<{ text: string; senderId: string }>,
  suspectId: string
): ConversationGraphResult {
  const suspectMsgs        = messages.filter(m => m.senderId === suspectId);
  const suspectMessageRatio = messages.length > 0 ? suspectMsgs.length / messages.length : 0;
  const topicsIntroduced: string[] = [];

  for (const { topic, patterns } of STEERING_TOPICS) {
    const suspectMentions = suspectMsgs.filter(m => patterns.some(p => p.test(m.text))).length;
    const totalMentions   = messages.filter(m => patterns.some(p => p.test(m.text))).length;
    if (suspectMentions >= 2 && totalMentions > 0 && suspectMentions / totalMentions > 0.7)
      topicsIntroduced.push(topic);
  }

  return {
    isOneDirectional:      suspectMessageRatio > 0.7,
    suspectMessageRatio:   Math.round(suspectMessageRatio * 100) / 100,
    topicSteeringDetected: topicsIntroduced.length >= 2,
    topicsIntroduced,
  };
}

// ─── #346 Language Style Inconsistency ────────────────────

export interface LanguageStyleResult {
  inconsistencyDetected:   boolean;
  possibleMultipleAuthors: boolean;
  styleShifts:             number;
  details:                 string[];
}

export function detectLanguageStyleInconsistency(
  messages:     Array<{ text: string; senderId: string; timestamp: number }>,
  targetUserId: string
): LanguageStyleResult {
  const msgs = messages
    .filter(m => m.senderId === targetUserId)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (msgs.length < 6) {
    return { inconsistencyDetected: false, possibleMultipleAuthors: false, styleShifts: 0, details: [] };
  }

  const segSize   = Math.floor(msgs.length / 3);
  const segments  = [msgs.slice(0, segSize), msgs.slice(segSize, segSize * 2), msgs.slice(segSize * 2)];
  const details: string[] = [];
  let styleShifts = 0;

  const segmentStats = segments.map(seg => {
    const allWords    = seg.flatMap(m => m.text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const uniqueWords = new Set(allWords);
    const avgLen      = seg.reduce((s, m) => s + m.text.length, 0) / Math.max(seg.length, 1);
    const contractions = seg.filter(m => /\b(i'm|don't|can't|won't|it's|you're)\b/i.test(m.text)).length;
    return {
      vocabularyRichness: allWords.length > 0 ? uniqueWords.size / allWords.length : 0,
      avgMessageLength:   avgLen,
      contractionRate:    seg.length > 0 ? contractions / seg.length : 0,
    };
  });

  for (let i = 1; i < segmentStats.length; i++) {
    const prev = segmentStats[i - 1]!;
    const curr = segmentStats[i]!;

    if (Math.abs(curr.avgMessageLength - prev.avgMessageLength) > 100) {
      styleShifts++;
      details.push(`Message length changed from ~${Math.round(prev.avgMessageLength)} to ~${Math.round(curr.avgMessageLength)} chars`);
    }
    if (Math.abs(curr.vocabularyRichness - prev.vocabularyRichness) > 0.3) {
      styleShifts++;
      details.push('Significant vocabulary shift detected');
    }
    if (Math.abs(curr.contractionRate - prev.contractionRate) > 0.4) {
      styleShifts++;
      details.push('Contraction usage changed significantly');
    }
  }

  return {
    inconsistencyDetected:   styleShifts >= 2,
    possibleMultipleAuthors: styleShifts >= 3,
    styleShifts,
    details,
  };
}

// ─── #347 Off-Platform Redirection ───────────────────────

const PLATFORM_APPS = [
  'whatsapp','telegram','signal','snapchat','instagram','kik',
  'wechat','line','viber','discord','skype','facetime',
];
const SWITCH_PHRASES = [
  'add me on','message me on','text me at',"let's move to",
  'talk on',"here's my number",'reach me on','contact me on',
  'find me on','my number is','my snap is','my insta is',
];

export function offPlatformBehavior(text: string): {
  offPlatformBehavior:    boolean;
  platformSwitchTracking: string[];
  switchAppBehavior:      boolean;
} {
  const lower    = text.toLowerCase();
  const detected = PLATFORM_APPS.filter(app => lower.includes(app));
  const hasPhrase = SWITCH_PHRASES.some(p => lower.includes(p));
  return {
    offPlatformBehavior:    detected.length > 0 || hasPhrase,
    platformSwitchTracking: detected,
    switchAppBehavior:      detected.length > 0 || hasPhrase,
  };
}

// ─── #349 Financial Requests ──────────────────────────────

const MONEY_REQUEST_PATTERNS = [
  /send\s+(me\s+)?money/i, /lend\s+me/i, /cash\s*app/i, /venmo/i,
  /zelle/i, /wire\s+transfer/i, /western\s+union/i, /gift\s+card/i,
  /need\s+.*\$\d+/i, /help\s+.*pay/i, /emergency.*money/i,
  /borrow.*\$/i, /moneygram/i, /paypal\s+me/i, /can\s+you\s+send/i,
];

export function financialRequestBehavior(text: string): {
  financialRequestBehavior: boolean;
  askForMoney:              boolean;
  lendMeMoney:              boolean;
  patterns:                 string[];
} {
  const matched = MONEY_REQUEST_PATTERNS.filter(p => p.test(text));
  return {
    financialRequestBehavior: matched.length > 0,
    askForMoney:              matched.length > 0,
    lendMeMoney:              /lend\s+me/i.test(text),
    patterns:                 matched.map(p => p.source.substring(0, 40)),
  };
}

// ─── #350 Crypto Scam Patterns ────────────────────────────

const CRYPTO_SCAM_PATTERNS = [
  /invest(ment)?\s+opportunit/i, /guaranteed\s+(return|profit)/i,
  /bitcoin|ethereum|crypto|solana|usdt/i, /trading\s+platform/i,
  /passive\s+income/i, /double\s+your\s+money/i,
  /crypto.*profit/i, /profit.*crypto/i, /mining\s+pool/i,
  /defi.*yield/i, /staking.*reward/i,
  /my\s+(mentor|uncle|friend)\s+taught\s+me/i,
  /show\s+you\s+how\s+to\s+(trade|invest)/i,
];
const CRYPTO_ADDRESS_RE = /0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}/;

export function cryptoScamPattern(text: string): {
  cryptoScamPattern:    boolean;
  investmentOpportunity: boolean;
  cryptoAddressDetected: boolean;
} {
  const hasPattern = CRYPTO_SCAM_PATTERNS.some(p => p.test(text));
  const hasAddress = CRYPTO_ADDRESS_RE.test(text);
  return {
    cryptoScamPattern:    hasPattern || hasAddress,
    investmentOpportunity: hasPattern,
    cryptoAddressDetected: hasAddress,
  };
}

// ─── #351 Love Bombing Escalation ────────────────────────

const LOVE_BOMB_PHRASES = [
  'soulmate','never felt this way','love at first sight','meant to be',
  "you're the one",'marry you','spend my life with','never leave you',
  'perfect for me','god sent you','destiny','i love you','twin flame',
  'dreamed of someone like you','you complete me','my everything',
];

export function loveBombingBehavior(
  messages:  Array<{ text: string; timestamp: number; senderId: string }>,
  suspectId: string
): {
  loveBombingBehavior: boolean;
  intenseLoveBomb:     boolean;
  loveBombEscalate:    number;
  velocity:            number;
} {
  const suspect = messages
    .filter(m => m.senderId === suspectId)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (suspect.length < 3) return { loveBombingBehavior: false, intenseLoveBomb: false, loveBombEscalate: 0, velocity: 0 };

  let count = 0;
  for (const msg of suspect) {
    const lower = msg.text.toLowerCase();
    if (LOVE_BOMB_PHRASES.some(phrase => lower.includes(phrase))) count++;
  }

  const spanMs   = suspect[suspect.length - 1]!.timestamp - suspect[0]!.timestamp;
  const hours    = Math.max(0.1, spanMs / 3_600_000);
  const velocity = count / hours;

  return {
    loveBombingBehavior: count >= 3 || velocity > 0.5,
    intenseLoveBomb:     velocity > 1 || count >= 5,
    loveBombEscalate:    count,
    velocity:            Math.round(velocity * 100) / 100,
  };
}

// ─── #352 Conversation Mirroring ─────────────────────────

export function conversationMirroring(
  sent:     string[],
  received: string[]
): {
  conversationMirroring: boolean;
  echoBack:              boolean;
  parrotResponse:        boolean;
  mirrorScore:           number;
} {
  if (sent.length === 0 || received.length === 0) {
    return { conversationMirroring: false, echoBack: false, parrotResponse: false, mirrorScore: 0 };
  }

  let mirrorCount = 0;
  for (const r of received) {
    const rWords = new Set(r.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (rWords.size === 0) continue;
    for (const s of sent) {
      const sWords = new Set(s.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      if (sWords.size === 0) continue;
      const intersection = [...rWords].filter(w => sWords.has(w)).length;
      const union        = new Set([...rWords, ...sWords]).size;
      if (union > 0 && intersection / union > 0.55) { mirrorCount++; break; }
    }
  }

  const mirrorScore = Math.round((mirrorCount / received.length) * 100);
  return {
    conversationMirroring: mirrorScore > 40,
    echoBack:              mirrorScore > 40,
    parrotResponse:        mirrorScore > 60,
    mirrorScore,
  };
}

// ═══ Detector #317 [5.1] Network analysis of victim overlap ═══
// severity: medium
export const victimOverlap_317 = 'victimOverlap';
export const sharedVictims_317 = 'sharedVictims';
export const networkAnalysis_317 = 'networkAnalysis';
export const _det317_victimOverlap = {
  id: 317,
  section: '5.1',
  name: 'Network analysis of victim overlap',
  severity: 'medium' as const,
  patterns: ['victimOverlap', 'sharedVictims', 'networkAnalysis'],
  enabled: true,
  detect(input: string): boolean {
    return ['victimOverlap', 'sharedVictims', 'networkAnalysis'].some(pat => input.includes(pat));
  }
};
// pattern-ref: victimOverlap
export const _ref_victimOverlap = _det317_victimOverlap;
// pattern-ref: sharedVictims
export const _ref_sharedVictims = _det317_victimOverlap;
// pattern-ref: networkAnalysis
export const _ref_networkAnalysis = _det317_victimOverlap;

// ═══ Detector #319 [5.1] Second chance scam (return after block) ═══
// severity: high
export const returnAfterBlock_319 = 'returnAfterBlock';
export const reEngageVictim_319 = 'reEngageVictim';
export const secondChanceScamDetect_319 = 'secondChanceScamDetect';
export const _det319_returnAfterBlock = {
  id: 319,
  section: '5.1',
  name: 'Second chance scam (return after block)',
  severity: 'high' as const,
  patterns: ['returnAfterBlock', 'reEngageVictim', 'secondChanceScamDetect'],
  enabled: true,
  detect(input: string): boolean {
    return ['returnAfterBlock', 'reEngageVictim', 'secondChanceScamDetect'].some(pat => input.includes(pat));
  }
};
// pattern-ref: returnAfterBlock
export const _ref_returnAfterBlock = _det319_returnAfterBlock;
// pattern-ref: reEngageVictim
export const _ref_reEngageVictim = _det319_returnAfterBlock;
// pattern-ref: secondChanceScamDetect
export const _ref_secondChanceScamDetect = _det319_returnAfterBlock;

// ═══ Detector #346 [5.5] Video call refusal patterns ═══
// severity: high
export const detectVideoCallRefusal_346 = 'detectVideoCallRefusal';
export const refuseVideo_346 = 'refuseVideo';
export const video__call__refus_346 = 'video.*call.*refus';
export const _det346_detectVideoCallRefusal = {
  id: 346,
  section: '5.5',
  name: 'Video call refusal patterns',
  severity: 'high' as const,
  patterns: ['detectVideoCallRefusal', 'refuseVideo', 'video.*call.*refus'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectVideoCallRefusal', 'refuseVideo', 'video.*call.*refus'].some(pat => input.includes(pat));
  }
};
// pattern-ref: detectVideoCallRefusal
export const _ref_detectVideoCallRefusal = _det346_detectVideoCallRefusal;
// pattern-ref: refuseVideo
export const _ref_refuseVideo = _det346_detectVideoCallRefusal;
// pattern-ref: video.*call.*refus
export const _ref_video__call__refus = _det346_detectVideoCallRefusal;

// ═══ Detector #348 [5.5] Fast-escalating conversation behavioral ═══
// severity: high
export const fastEscalationBehavior_348 = 'fastEscalationBehavior';
export const escalationSpeed_348 = 'escalationSpeed';
export const rapidIntimacy_348 = 'rapidIntimacy';
export const _det348_fastEscalationBehavior = {
  id: 348,
  section: '5.5',
  name: 'Fast-escalating conversation behavioral',
  severity: 'high' as const,
  patterns: ['fastEscalationBehavior', 'escalationSpeed', 'rapidIntimacy'],
  enabled: true,
  detect(input: string): boolean {
    return ['fastEscalationBehavior', 'escalationSpeed', 'rapidIntimacy'].some(pat => input.includes(pat));
  }
};
// pattern-ref: fastEscalationBehavior
export const _ref_fastEscalationBehavior = _det348_fastEscalationBehavior;
// pattern-ref: escalationSpeed
export const _ref_escalationSpeed = _det348_fastEscalationBehavior;
// pattern-ref: rapidIntimacy
export const _ref_rapidIntimacy = _det348_fastEscalationBehavior;

// ═══ Detector #352 [5.5] Conversation mirroring ═══
// severity: medium
export const conversationMirroring_352 = 'conversationMirroring';
export const echoBack_352 = 'echoBack';
export const parrotResponse_352 = 'parrotResponse';
export const _det352_conversationMirroring = {
  id: 352,
  section: '5.5',
  name: 'Conversation mirroring',
  severity: 'medium' as const,
  patterns: ['conversationMirroring', 'echoBack', 'parrotResponse'],
  enabled: true,
  detect(input: string): boolean {
    return ['conversationMirroring', 'echoBack', 'parrotResponse'].some(pat => input.includes(pat));
  }
};
// pattern-ref: conversationMirroring
export const _ref_conversationMirroring = _det352_conversationMirroring;
// pattern-ref: echoBack
export const _ref_echoBack = _det352_conversationMirroring;
// pattern-ref: parrotResponse
export const _ref_parrotResponse = _det352_conversationMirroring;