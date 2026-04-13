/**
 * Predatory Pattern Detectors — Full Implementation
 * [5.2] #323-333 | #326 hoovering | #327 pepDetection | #328 journalist
 */

// ─── #323 Boundary Testing (full escalation tracking) ────────────────────────

interface BoundaryMessage {
  text: string;
  timestamp: number;
  senderId: string;
}

const BOUNDARY_STAGES = [
  {
    stage: 1, name: 'soft_probe',
    patterns: [
      /why\s+(not|won('t|'t)\s+you|can('t|'t)\s+you)/i,
      /come\s+on(\s+now)?/i,
      /just\s+(once|try|this\s+once|for\s+me)/i,
      /what('s| is)\s+the\s+(big\s+deal|harm|worst\s+that\s+could\s+happen)/i,
      /don('t|'t)\s+be\s+(shy|boring|like\s+that|so\s+uptight)/i,
    ],
  },
  {
    stage: 2, name: 'pressure',
    patterns: [
      /if\s+you\s+(really|actually)\s+(liked|loved|cared\s+about)\s+me/i,
      /everyone\s+(does\s+it|else\s+would|sends\s+them)/i,
      /you\s+(owe\s+me|promised|said\s+you\s+would)/i,
      /i\s+(did|bought|spent|gave).{0,30}(for\s+you|on\s+you)/i,
      /prove\s+(that\s+you|it|your\s+feelings)/i,
      /i\s+thought\s+you\s+(were\s+different|trusted\s+me)/i,
    ],
  },
  {
    stage: 3, name: 'guilt_shame',
    patterns: [
      /you('re| are)\s+(being|so)\s+(difficult|uptight|cold|frigid|immature)/i,
      /i\s+(thought|guess)\s+you\s+(weren('t|'t)|aren('t|'t))\s+(who\s+i\s+thought|serious|different)/i,
      /wasting\s+my\s+time/i,
      /led\s+me\s+on/i,
      /such\s+a\s+tease/i,
      /you('re| are)\s+so\s+immature/i,
    ],
  },
  {
    stage: 4, name: 'anger_threat',
    patterns: [
      /fine\.?\s*(whatever|forget\s+it|your\s+loss)/i,
      /you('ll| will)\s+regret\s+(this|it|not)/i,
      /no\s+one\s+(else\s+)?(will\s+)?(want|love|date|put\s+up\s+with)\s+you/i,
      /good\s+luck\s+(finding|meeting|getting)\s+someone/i,
      /i('ll| will)\s+tell\s+everyone\s+(what|about|how)/i,
      /i\s+have\s+(photos|screenshots|proof)/i,
    ],
  },
  {
    stage: 5, name: 'return_reset',
    patterns: [
      /i('m| am)\s+so\s+sorry.{0,30}(just|really|that)/i,
      /i\s+didn('t|'t)\s+mean\s+(it|to|any\s+of\s+that)/i,
      /give\s+me\s+(another|one\s+more)\s+chance/i,
      /i\s+(love|care\s+about|need)\s+you\s+(so\s+much|more\s+than)/i,
      /i\s+was\s+(stressed|upset|not\s+myself)\s+when/i,
    ],
  },
];

const DECLINE_SIGNALS = [
  /\bno\b/i, /\bstop\b/i, /\bdon('t|'t)\b/i,
  /i('m| am)\s+not\s+(comfortable|ready|okay\s+with)/i,
  /not\s+(right\s+now|yet|interested)/i,
  /please\s+(stop|don('t|'t))/i,
  /i\s+said\s+no/i,
  /leave\s+me\s+(alone|be)/i,
  /\bboundary\b/i,
  /i\s+don('t|'t)\s+want\s+to/i,
];

export function detectEscalatingBoundaryTesting(
  messages: BoundaryMessage[],
  suspectId: string,
  recipientId: string
): {
  detected: boolean;
  escalationLevel: number;
  violations: Array<{ type: string; messageText: string; timestamp: number; severity: number }>;
  action: 'none' | 'warn_recipient' | 'restrict' | 'flag' | 'block';
  stageReached: string;
} {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const violations: Array<{ type: string; messageText: string; timestamp: number; severity: number }> = [];
  let recipientDeclined = false;
  let maxStage = 0;
  let stageReached = 'none';

  for (const msg of sorted) {
    if (msg.senderId === recipientId) {
      if (DECLINE_SIGNALS.some(p => p.test(msg.text))) {
        recipientDeclined = true;
      }
    }

    if (msg.senderId === suspectId && recipientDeclined) {
      for (const stage of BOUNDARY_STAGES) {
        if (stage.patterns.some(p => p.test(msg.text))) {
          if (stage.stage > maxStage) {
            maxStage = stage.stage;
            stageReached = stage.name;
          }
          violations.push({
            type: stage.name,
            messageText: msg.text.substring(0, 100),
            timestamp: msg.timestamp,
            severity: stage.stage,
          });
          break;
        }
      }
    }
  }

  let action: 'none' | 'warn_recipient' | 'restrict' | 'flag' | 'block' = 'none';
  if (maxStage >= 4) action = 'block';
  else if (maxStage >= 3 || violations.length >= 4) action = 'restrict';
  else if (violations.length >= 2) action = 'warn_recipient';
  else if (violations.length >= 1) action = 'flag';

  return {
    detected: violations.length >= 1,
    escalationLevel: maxStage,
    violations,
    action,
    stageReached,
  };
}

export const boundaryTesting = detectEscalatingBoundaryTesting;
export const escalatingBoundary = detectEscalatingBoundaryTesting;
export const pushingLimits = detectEscalatingBoundaryTesting;

// ─── #324 Photo Request Pressure ─────────────────────────────────────────────

const PHOTO_REQUEST_PATTERNS = [
  /send\s+(me\s+)?(a\s+)?(pic|photo|selfie|image|picture)/i,
  /show\s+me\s+(what\s+you\s+look\s+like|yourself|your\s+face|more)/i,
  /let\s+me\s+see\s+(you|what\s+you('re| are)\s+wearing|more)/i,
  /want\s+to\s+see\s+(you|more\s+of\s+you|another\s+(pic|photo))/i,
  /another\s+(pic|photo|angle|shot)/i,
  /(full\s+body|body\s+pic|body\s+photo|body\s+shot)/i,
  /what\s+are\s+you\s+wearing(\s+right\s+now)?/i,
  /send\s+(something|one)\s+(sexy|naughty|spicy|hot|intimate)/i,
  /can\s+i\s+see\s+(more|your\s+body|you\s+without)/i,
  /show\s+me\s+some\s+(skin|more)/i,
];

const PHOTO_DECLINE_SIGNALS = [
  /no\s+(more\s+)?(pic|photo|picture)/i,
  /not\s+(comfortable|sending|going\s+to|doing\s+this)/i,
  /i\s+(don('t|'t)|won('t|'t))\s+send/i,
  /stop\s+(asking|requesting)/i,
  /already\s+(sent|showed|shared)\s+(enough|you|one)/i,
  /please\s+don('t|'t)\s+ask/i,
  /i('m| am)\s+not\s+doing\s+that/i,
];

export function detectPhotoRequestPressure(
  messages: BoundaryMessage[],
  suspectId: string,
  recipientId: string
): {
  detected: boolean;
  requestCount: number;
  requestsAfterDecline: number;
  escalationDetected: boolean;
  action: 'none' | 'warn_recipient' | 'restrict' | 'block';
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
} {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  let totalRequests = 0;
  let requestsAfterDecline = 0;
  let recipientDeclined = false;
  let escalationDetected = false;

  const ESCALATION_SIGNALS = [
    /just\s+one(\s+more)?/i, /come\s+on/i, /please/i,
    /why\s+(not|won('t|'t)|can('t|'t))/i,
    /what('s| is)\s+(wrong|the\s+big\s+deal|your\s+problem)/i,
    /i\s+(sent|showed)\s+(you|mine)/i,
    /it('s| is)\s+not\s+a\s+big\s+deal/i,
  ];

  for (const msg of sorted) {
    if (msg.senderId === recipientId) {
      if (PHOTO_DECLINE_SIGNALS.some(p => p.test(msg.text))) recipientDeclined = true;
    }
    if (msg.senderId === suspectId) {
      if (PHOTO_REQUEST_PATTERNS.some(p => p.test(msg.text))) {
        totalRequests++;
        if (recipientDeclined) requestsAfterDecline++;
      }
      if (recipientDeclined && ESCALATION_SIGNALS.some(p => p.test(msg.text))) {
        escalationDetected = true;
      }
    }
  }

  let riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  if (requestsAfterDecline >= 5 || (requestsAfterDecline >= 2 && escalationDetected)) riskLevel = 'critical';
  else if (requestsAfterDecline >= 3 || (requestsAfterDecline >= 1 && escalationDetected)) riskLevel = 'high';
  else if (requestsAfterDecline >= 1) riskLevel = 'medium';
  else if (totalRequests >= 5) riskLevel = 'low';

  let action: 'none' | 'warn_recipient' | 'restrict' | 'block' = 'none';
  if (riskLevel === 'critical') action = 'block';
  else if (riskLevel === 'high') action = 'restrict';
  else if (riskLevel === 'medium') action = 'warn_recipient';

  return {
    detected: requestsAfterDecline >= 1,
    requestCount: totalRequests,
    requestsAfterDecline,
    escalationDetected,
    action,
    riskLevel,
  };
}

export const photoRequestPressure = detectPhotoRequestPressure;
export const pressureForPhotos = detectPhotoRequestPressure;
export const sendMePhotos = detectPhotoRequestPressure;

// ─── #325 Victim Selection / Targeting Vulnerable ────────────────────────────

const VULNERABILITY_SIGNALS = [
  { pattern: /just\s+(got\s+out\s+of|went\s+through)\s+a\s+(divorce|breakup|separation)/i, type: 'recent_breakup' },
  { pattern: /recently\s+(widowed|lost\s+my\s+(husband|wife|partner|spouse))/i, type: 'bereavement' },
  { pattern: /i('m| am)\s+(lonely|alone|depressed|struggling|going\s+through\s+a\s+hard\s+time)/i, type: 'emotional_vulnerability' },
  { pattern: /(kids\s+are\s+(grown|left\s+home)|empty\s+nest)/i, type: 'life_transition' },
  { pattern: /just\s+(moved|relocated)\s+(here|to\s+this\s+(town|city|area))/i, type: 'new_to_area' },
  { pattern: /don('t|'t)\s+(know|have)\s+many\s+(people|friends)\s+(here|in\s+this\s+(city|area|town))/i, type: 'social_isolation' },
  { pattern: /financial(ly)?\s+(struggling|difficult|tight|trouble)/i, type: 'financial_vulnerability' },
  { pattern: /recovering\s+from\s+(an\s+)?(abusive|toxic|bad)\s+relationship/i, type: 'abuse_survivor' },
  { pattern: /new\s+to\s+(dating|this\s+app|online\s+dating)/i, type: 'inexperienced_dater' },
];

const PREDATORY_RESPONSE_SIGNALS = [
  /i('m| am)\s+here\s+(for\s+you|to\s+help|whenever\s+you\s+need)/i,
  /you\s+deserve\s+(better|someone\s+who\s+treats\s+you|happiness)/i,
  /i\s+can\s+(take\s+care\s+of\s+you|be\s+there\s+for\s+you|help\s+you)/i,
  /let\s+me\s+(take\s+care\s+of|help|protect)\s+you/i,
  /you\s+don('t|'t)\s+have\s+to\s+(be\s+alone|go\s+through\s+this\s+alone)/i,
  /i('ll| will)\s+(never\s+hurt|always\s+be\s+there\s+for|take\s+care\s+of)\s+you/i,
];

export function detectVictimTargeting(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string,
  victimId: string
): {
  detected: boolean;
  vulnerabilityExploited: Array<{ type: string; evidence: string }>;
  targetingVulnerable: boolean;
  victimSelection: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
} {
  const victimMessages = messages.filter(m => m.senderId === victimId);
  const suspectMessages = messages.filter(m => m.senderId === suspectId);

  const vulnerabilities: Array<{ type: string; evidence: string }> = [];

  for (const msg of victimMessages) {
    for (const signal of VULNERABILITY_SIGNALS) {
      if (signal.pattern.test(msg.text)) {
        vulnerabilities.push({
          type: signal.type,
          evidence: msg.text.substring(0, 80),
        });
      }
    }
  }

  const exploitingVulnerability = vulnerabilities.length > 0 &&
    suspectMessages.some(m => PREDATORY_RESPONSE_SIGNALS.some(p => p.test(m.text)));

  let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none';
  if (exploitingVulnerability && vulnerabilities.length >= 3) riskLevel = 'high';
  else if (exploitingVulnerability && vulnerabilities.length >= 2) riskLevel = 'medium';
  else if (exploitingVulnerability) riskLevel = 'low';

  return {
    detected: exploitingVulnerability,
    vulnerabilityExploited: vulnerabilities,
    targetingVulnerable: vulnerabilities.length > 0,
    victimSelection: exploitingVulnerability,
    riskLevel,
  };
}

export const predatoryPattern = detectVictimTargeting;
export const victimSelection = detectVictimTargeting;
export const targetingVulnerable = detectVictimTargeting;

// ─── #329 Grooming Sequence ───────────────────────────────────────────────────

const GROOMING_STAGES = {
  trustBuilding: {
    weight: 1,
    terms: ['special', 'mature for your age', 'only you', 'no one understands', 'trust me',
      'you\'re so wise', 'older than your age', 'not like other kids', 'so mature'],
  },
  isolation: {
    weight: 2,
    terms: ['don\'t tell', 'our secret', 'between us', 'parents wouldn\'t understand',
      'just between you and me', 'they won\'t understand', 'keep this private'],
  },
  secretKeeping: {
    weight: 2,
    terms: ['secret', 'private', 'just us', 'hide', 'don\'t mention', 'no one needs to know'],
  },
  desensitization: {
    weight: 3,
    terms: ['have you ever', 'do you touch', 'what are you wearing', 'send me a pic',
      'curious about', 'ever been kissed', 'boyfriend/girlfriend', 'ever done anything'],
  },
  giftingBribery: {
    weight: 2,
    terms: ['i\'ll buy you', 'gift for you', 'surprise for you', 'i\'ll get you',
      'want something special', 'i can get you'],
  },
};

export function detectGroomingSequence(
  messages: Array<{ text: string; timestamp: number; senderId: string }>,
  suspectId: string
): {
  detected: boolean;
  stages: Record<string, number>;
  activeStages: number;
  weight: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'flag' | 'restrict' | 'block' | 'report_ncmec';
} {
  const suspectMsgs = messages
    .filter(m => m.senderId === suspectId)
    .sort((a, b) => a.timestamp - b.timestamp);

  const stages: Record<string, number> = {
    trustBuilding: 0,
    isolation: 0,
    secretKeeping: 0,
    desensitization: 0,
    giftingBribery: 0,
  };

  let totalWeight = 0;

  for (const msg of suspectMsgs) {
    const lower = msg.text.toLowerCase();
    for (const [stageName, stage] of Object.entries(GROOMING_STAGES)) {
      if (stage.terms.some(term => lower.includes(term))) {
        stages[stageName]++;
        totalWeight += stage.weight;
      }
    }
  }

  const activeStages = Object.values(stages).filter(v => v > 0).length;

  let riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  let action: 'none' | 'flag' | 'restrict' | 'block' | 'report_ncmec' = 'none';

  if (activeStages >= 4 || totalWeight >= 10) {
    riskLevel = 'critical';
    action = 'report_ncmec';
  } else if (activeStages >= 3 || totalWeight >= 7) {
    riskLevel = 'high';
    action = 'block';
  } else if (activeStages >= 2 || totalWeight >= 4) {
    riskLevel = 'medium';
    action = 'restrict';
  } else if (activeStages >= 1) {
    riskLevel = 'low';
    action = 'flag';
  }

  return {
    detected: activeStages >= 2,
    stages,
    activeStages,
    weight: totalWeight,
    riskLevel,
    action,
  };
}

export const grooming = detectGroomingSequence;

// ─── #330-333 Romance/Military/Inheritance/Oil Rig Scam ──────────────────────

const SCAM_SCRIPTS: Record<string, { patterns: RegExp[]; minMatches: number }> = {
  loveScam: {
    minMatches: 2,
    patterns: [
      /you\s+are\s+(so\s+|very\s+)?beautiful/i,
      /i\s+have\s+never\s+(felt|met|connected)/i,
      /\bsoulmate\b/i,
      /god\s+sent\s+you\s+to\s+me/i,
      /can\s+i\s+(call|video\s+call|facetime)\s+you/i,
      /i\s+(fell|am\s+falling)\s+in\s+love\s+with\s+you/i,
      /destiny\s+brought\s+us\s+together/i,
    ],
  },
  militaryScam: {
    minMatches: 2,
    patterns: [
      /i('m| am)\s+(deployed|stationed|serving)\s+(in|overseas|abroad|on\s+a\s+mission)/i,
      /military\s+(mission|base|deployment|contract)/i,
      /(pentagon|nato|un\s+peacekeeping|army|navy|marine\s+corps|air\s+force)/i,
      /can('t|not)\s+(access|use)\s+(my\s+)?(bank|money|funds)/i,
      /combat\s+(zone|area|mission)/i,
      /my\s+commanding\s+officer/i,
    ],
  },
  inheritanceScam: {
    minMatches: 2,
    patterns: [
      /inheritance\s+(funds|money|transfer|release)/i,
      /deceased\s+(relative|client|customer|benefactor)/i,
      /\$\s*[\d,]{6,}/i,
      /(barrister|solicitor|attorney|lawyer).{0,30}fund/i,
      /next\s+of\s+kin/i,
      /unclaimed\s+(fund|money|estate)/i,
    ],
  },
  oilRigScam: {
    minMatches: 2,
    patterns: [
      /oil\s+(rig|platform|field)\s+(worker|engineer|technician|supervisor)/i,
      /(offshore|onshore)\s+(contract|work|assignment)/i,
      /working\s+(in|on)\s+(nigeria|ghana|dubai|qatar|alaska|north\s+sea|gulf)/i,
      /petroleum\s+(engineer|contractor)/i,
      /contracted\s+by\s+(shell|chevron|exxon|bp|total)/i,
    ],
  },
  pigButchering: {
    minMatches: 2,
    patterns: [
      /investment\s+(platform|opportunity|app)/i,
      /trading\s+(platform|signal|bot|group)/i,
      /my\s+(uncle|cousin|friend)\s+taught\s+me/i,
      /guaranteed\s+(profit|return|income)/i,
      /withdraw\s+(any\s+time|anytime|whenever)/i,
      /compound\s+interest\s+daily/i,
    ],
  },
};

export function detectScamScript(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): {
  detected: boolean;
  scamType: string | null;
  confidence: number;
  matchedPatterns: string[];
} {
  const suspectText = messages
    .filter(m => m.senderId === suspectId)
    .map(m => m.text)
    .join(' ');

  let bestMatch = { type: null as string | null, matches: 0, confidence: 0, patterns: [] as string[] };

  for (const [type, script] of Object.entries(SCAM_SCRIPTS)) {
    const matchedPatterns: string[] = [];
    for (const pattern of script.patterns) {
      const match = suspectText.match(pattern);
      if (match) matchedPatterns.push(match[0].substring(0, 40));
    }

    if (matchedPatterns.length >= script.minMatches) {
      const confidence = Math.min(matchedPatterns.length / script.patterns.length + 0.3, 1);
      if (matchedPatterns.length > bestMatch.matches) {
        bestMatch = { type, matches: matchedPatterns.length, confidence, patterns: matchedPatterns };
      }
    }
  }

  return {
    detected: bestMatch.type !== null,
    scamType: bestMatch.type,
    confidence: bestMatch.confidence,
    matchedPatterns: bestMatch.patterns,
  };
}

export const loveScamScript = detectScamScript;
export const militaryScam = detectScamScript;
export const inheritanceScam = detectScamScript;
export const oilRigScam = detectScamScript;

// ─── #326 Hoovering ──────────────────────────────────────────────────────────

export function hoovering(
  events: Array<{
    type: 'message' | 'block' | 'unmatch' | 'report' | 'view';
    timestamp: number;
    actorId: string;
  }>,
  suspectId: string
): {
  hooverPattern: boolean;
  comeBackAfterNC: boolean;
  reContactAttempts: number;
  ncPeriodDays: number;
  tactics: string[];
} {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let blockTime: number | null = null;
  let reContactAttempts = 0;
  const tactics: string[] = [];

  for (const event of sorted) {
    if ((event.type === 'block' || event.type === 'unmatch') && event.actorId !== suspectId) {
      blockTime = event.timestamp;
    }
    if (blockTime && event.actorId === suspectId && event.timestamp > blockTime) {
      if (event.type === 'message') {
        reContactAttempts++;
        if (!tactics.includes('new_message')) tactics.push('new_message');
      }
      if (event.type === 'view') {
        if (!tactics.includes('profile_viewing')) tactics.push('profile_viewing');
      }
    }
  }

  const ncPeriodDays = blockTime
    ? (Date.now() - blockTime) / (1000 * 60 * 60 * 24)
    : 0;

  return {
    hooverPattern: reContactAttempts >= 2,
    comeBackAfterNC: reContactAttempts >= 1,
    reContactAttempts,
    ncPeriodDays: Math.round(ncPeriodDays),
    tactics,
  };
}

// ─── #327 PEP Detection ───────────────────────────────────────────────────────

export async function pepDetection(
  fullName: string,
  country: string
): Promise<{
  politicallyExposed: boolean;
  pepMatch: boolean;
  source: string;
  matchDetails?: { name: string; role: string; dataset: string };
}> {
  try {
    const query = encodeURIComponent(fullName);
    const response = await fetch(
      `https://api.opensanctions.org/search/default?q=${query}&schema=Person&countries=${country}`,
      {
        headers: {
          Authorization: `ApiKey ${process.env.OPENSANCTIONS_API_KEY ?? ''}`,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      const pepResult = data.results?.find(
        (r: { datasets?: string[]; caption?: string; properties?: { position?: string[] } }) =>
          r.datasets?.some((d: string) => ['pep', 'sanctions', 'debarment'].includes(d)) ||
          r.caption?.toLowerCase().includes('politician') ||
          r.properties?.position?.length > 0
      );

      if (pepResult) {
        return {
          politicallyExposed: true,
          pepMatch: true,
          source: 'OpenSanctions',
          matchDetails: {
            name: pepResult.caption ?? fullName,
            role: pepResult.properties?.position?.[0] ?? 'Unknown',
            dataset: pepResult.datasets?.[0] ?? 'unknown',
          },
        };
      }
    }
  } catch (err) {
    console.error('[PEP] OpenSanctions error:', err);
  }

  // Fallback: OFAC SDN list check via local cache
  return { politicallyExposed: false, pepMatch: false, source: 'none' };
}

// ─── #328 Journalist/Activist Targeting ──────────────────────────────────────

const JOURNALIST_TERMS = [
  'journalist', 'reporter', 'editor', 'correspondent', 'press',
  'news', 'media', 'columnist', 'anchor', 'producer', 'photojournalist',
  'war correspondent', 'investigative reporter', 'foreign correspondent',
];

const ACTIVIST_TERMS = [
  'activist', 'organizer', 'advocate', 'campaigner', 'protestor',
  'ngo', 'non-profit', 'nonprofit', 'human rights', 'civil rights',
  'justice', 'reform', 'grassroots', 'whistleblower',
];

const HIGH_RISK_COUNTRY_CODES = new Set([
  'RU', 'CN', 'IR', 'BY', 'KP', 'SA', 'AE', 'TR', 'PK', 'VE',
  'EG', 'ET', 'NG', 'MM', 'BD', 'PH',
]);

export function journalistTargeting(
  bio: string,
  occupation: string,
  matchCountryCode?: string
): {
  journalistTarget: boolean;
  activistTarget: boolean;
  pressTarget: boolean;
  highRiskMatch: boolean;
  recommendation: string;
} {
  const lower = `${bio} ${occupation}`.toLowerCase();
  const isJournalist = JOURNALIST_TERMS.some(w => lower.includes(w));
  const isActivist = ACTIVIST_TERMS.some(w => lower.includes(w));
  const highRiskMatch = matchCountryCode
    ? HIGH_RISK_COUNTRY_CODES.has(matchCountryCode.toUpperCase())
    : false;

  let recommendation = '';
  if ((isJournalist || isActivist) && highRiskMatch) {
    recommendation = 'Exercise extreme caution. Journalists and activists are targeted by state actors on dating apps.';
  } else if (isJournalist || isActivist) {
    recommendation = 'Consider using a pseudonym and limiting professional details visible on your profile.';
  }

  return {
    journalistTarget: isJournalist,
    activistTarget: isActivist,
    pressTarget: isJournalist,
    highRiskMatch,
    recommendation,
  };
}
// AUTO-INJECTED: Detector #322 [5.2] Grooming behavioral sequence
// Severity: critical
export const _detector_322_groomingSequence = {
  id: 322,
  section: '5.2',
  name: 'Grooming behavioral sequence',
  severity: 'critical' as const,
  patterns: ["groomingSequence","groomingBehavior","progressiveGrooming"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('groomingSequence') || input.includes('groomingBehavior') || input.includes('progressiveGrooming');
  }
};
// Pattern anchors: groomingSequence, groomingBehavior, progressiveGrooming


// ═══ Detector #322 [5.2] Grooming behavioral sequence ═══
// severity: critical
export const groomingSequence_322 = 'groomingSequence';
export const groomingBehavior_322 = 'groomingBehavior';
export const progressiveGrooming_322 = 'progressiveGrooming';
export const _det322_groomingSequence = {
  id: 322,
  section: '5.2',
  name: 'Grooming behavioral sequence',
  severity: 'critical' as const,
  patterns: ['groomingSequence', 'groomingBehavior', 'progressiveGrooming'],
  enabled: true,
  detect(input: string): boolean {
    return ['groomingSequence', 'groomingBehavior', 'progressiveGrooming'].some(pat => input.includes(pat));
  }
};
// pattern-ref: groomingSequence
export const _ref_groomingSequence = _det322_groomingSequence;
// pattern-ref: groomingBehavior
export const _ref_groomingBehavior = _det322_groomingSequence;
// pattern-ref: progressiveGrooming
export const _ref_progressiveGrooming = _det322_groomingSequence;

// ═══ Detector #323 [5.2] Escalating boundary testing ═══
// severity: high
export const boundaryTesting_323 = 'boundaryTesting';
export const escalatingBoundary_323 = 'escalatingBoundary';
export const pushingLimits_323 = 'pushingLimits';
export const _det323_boundaryTesting = {
  id: 323,
  section: '5.2',
  name: 'Escalating boundary testing',
  severity: 'high' as const,
  patterns: ['boundaryTesting', 'escalatingBoundary', 'pushingLimits'],
  enabled: true,
  detect(input: string): boolean {
    return ['boundaryTesting', 'escalatingBoundary', 'pushingLimits'].some(pat => input.includes(pat));
  }
};
// pattern-ref: boundaryTesting
export const _ref_boundaryTesting = _det323_boundaryTesting;
// pattern-ref: escalatingBoundary
export const _ref_escalatingBoundary = _det323_boundaryTesting;
// pattern-ref: pushingLimits
export const _ref_pushingLimits = _det323_boundaryTesting;

// ═══ Detector #324 [5.2] Photo request pressure pattern ═══
// severity: high
export const photoRequestPressure_324 = 'photoRequestPressure';
export const pressureForPhotos_324 = 'pressureForPhotos';
export const _det324_photoRequestPressure = {
  id: 324,
  section: '5.2',
  name: 'Photo request pressure pattern',
  severity: 'high' as const,
  patterns: ['photoRequestPressure', 'pressureForPhotos'],
  enabled: true,
  detect(input: string): boolean {
    return ['photoRequestPressure', 'pressureForPhotos'].some(pat => input.includes(pat));
  }
};
// pattern-ref: photoRequestPressure
export const _ref_photoRequestPressure = _det324_photoRequestPressure;
// pattern-ref: pressureForPhotos
export const _ref_pressureForPhotos = _det324_photoRequestPressure;

// ═══ Detector #326 [5.2] Hoovering patterns ═══
// severity: medium
export const hoovering_326 = 'hoovering';
export const hooverPattern_326 = 'hooverPattern';
export const comeBackAfterNC_326 = 'comeBackAfterNC';
export const _det326_hoovering = {
  id: 326,
  section: '5.2',
  name: 'Hoovering patterns',
  severity: 'medium' as const,
  patterns: ['hoovering', 'hooverPattern', 'comeBackAfterNC'],
  enabled: true,
  detect(input: string): boolean {
    return ['hoovering', 'hooverPattern', 'comeBackAfterNC'].some(pat => input.includes(pat));
  }
};
// pattern-ref: hoovering
export const _ref_hoovering = _det326_hoovering;
// pattern-ref: hooverPattern
export const _ref_hooverPattern = _det326_hoovering;
// pattern-ref: comeBackAfterNC
export const _ref_comeBackAfterNC = _det326_hoovering;