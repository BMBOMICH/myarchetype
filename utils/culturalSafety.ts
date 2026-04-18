
export interface CulturalSafetyResult {
  detected: boolean;
  type?: 'honor_violence' | 'forced_marriage' | 'caste_discrimination' | 'interfaith_exploitation';
  severity: 'none' | 'medium' | 'high' | 'critical';
  action: 'none' | 'flag_review' | 'block_and_resources' | 'law_enforcement';
  resources?: { name: string; phone?: string; url: string }[];
}

const HONOR_VIOLENCE = [
  /bring\s+shame/i, /dishonor\s+(the|our|my)\s+family/i,
  /family\s+honor/i, /honor\s+kill/i,
  /kill\s+(you|her|him)\s+.*family/i,
  /your\s+family\s+will\s+(find|know|punish)/i,
  /stone(d)?\s+to\s+death/i,
  /blood\s+on\s+your\s+hands/i,
  /what\s+will\s+(people|the\s+community)\s+say/i,
  /cleanse\s+the\s+(family|honor)/i,
];

const FORCED_MARRIAGE = [
  /must\s+marry/i, /you\s+have\s+no\s+choice/i,
  /family\s+(decided|arranged|chose)/i,
  /marry\s+him.*or\s+else/i,
  /whether\s+you\s+like\s+it\s+or\s+not/i,
  /bride\s+price|dowry\s+.*demand/i,
  /you\s+will\s+marry\s+who/i,
  /obey\s+your\s+(father|parents|elders)/i,
];

const CASTE_DISCRIMINATION = [
  /lower\s+caste/i, /upper\s+caste\s+only/i,
  /untouchable/i, /dalit.*dirty/i,
  /not\s+our\s+(kind|class|level)/i,
  /what\s+caste\s+are\s+you/i,
  /inter-?caste\s+(not\s+allowed|forbidden)/i,
  /brahmin\s+only|kshatriya\s+only/i,
];

const INTERFAITH_EXPLOITATION = [
  /convert\s+(or|before)\s+.*(marry|date|together)/i,
  /your\s+religion\s+is\s+(wrong|false|evil)/i,
  /love\s+jihad/i,
  /hell.*if\s+you\s+don('t|'t)\s+convert/i,
  /god\s+will\s+punish\s+you/i,
];

const RESOURCES = {
  honor_violence: [
    { name: 'NDVH', phone: '1-800-799-7233', url: 'https://www.thehotline.org' },
    { name: 'AHA Foundation', url: 'https://www.theahafoundation.org' },
  ],
  forced_marriage: [
    { name: 'Unchained At Last', url: 'https://www.unchainedatlast.org' },
    { name: 'Tahirih Justice Center', phone: '1-571-282-6161', url: 'https://www.tahirih.org' },
  ],
  caste_discrimination: [
    { name: 'Equality Labs', url: 'https://www.equalitylabs.org' },
  ],
  interfaith_exploitation: [
    { name: 'Interfaith Alliance', url: 'https://interfaithalliance.org' },
  ],
};

export function analyze(message: string): CulturalSafetyResult {
  const checks: [RegExp[], CulturalSafetyResult['type'], CulturalSafetyResult['severity']][] = [
    [HONOR_VIOLENCE, 'honor_violence', 'critical'],
    [FORCED_MARRIAGE, 'forced_marriage', 'critical'],
    [CASTE_DISCRIMINATION, 'caste_discrimination', 'high'],
    [INTERFAITH_EXPLOITATION, 'interfaith_exploitation', 'medium'],
  ];

export interface InterfaithExploitationResult {
  detected: boolean;
  confidence: number;
  exploitationType: string[];
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  action: 'none' | 'flag_review' | 'warn_user' | 'block_and_resources';
  resources: string[];
}

const INTERFAITH_EXPLOITATION_PATTERNS: Array<{
  p: RegExp;
  type: string;
  weight: number;
  description: string;
}> = [
  {
    p: /you\s+(must|have\s+to|need\s+to|will)\s+convert\s+(to|before\s+we|if\s+you\s+want\s+to)/i,
    type: 'conversion_coercion',
    weight: 0.85,
    description: 'Demanding religious conversion',
  },
  {
    p: /i\s+(can'?t|won'?t)\s+(marry|be\s+with|date|continue)\s+(you|this)\s+unless\s+you\s+convert/i,
    type: 'conversion_coercion',
    weight: 0.85,
    description: 'Conditioning relationship on conversion',
  },
  {
    p: /if\s+you\s+(love|loved|cared\s+about)\s+me\s+you('?d|\s+would)\s+(convert|become|join|accept)\s+(my\s+)?(religion|faith|islam|christianity|hinduism|judaism)/i,
    type: 'love_bomb_conversion',
    weight: 0.8,
    description: 'Love bombing combined with conversion pressure',
  },
  {
    p: /god\s+(wants|commands|requires|demands)\s+(you|us)\s+to\s+(be\s+together|marry)\s+and\s+(you\s+need\s+to|that\s+means\s+you\s+(must|should))\s+convert/i,
    type: 'divine_mandate_conversion',
    weight: 0.85,
    description: 'Using divine authority to demand conversion',
  },
  {
    p: /you('ll|\s+will)\s+(go\s+to\s+hell|burn|be\s+damned|face\s+punishment)\s+(because|for|if)\s+(you('re|\s+are)\s+)?(not\s+(muslim|christian|jewish|hindu|buddhist)|your\s+religion)/i,
    type: 'damnation_threat',
    weight: 0.8,
    description: 'Threatening eternal damnation for religious identity',
  },
  {
    p: /your\s+(religion|faith|god|beliefs?)\s+(is|are)\s+(false|fake|evil|satanic|wrong|inferior|disgusting|an\s+abomination)/i,
    type: 'religious_denigration',
    weight: 0.75,
    description: 'Denigrating target\'s religion',
  },
  {
    p: /god\s+will\s+(punish|judge|condemn|destroy)\s+you\s+(for|because)\s+(being|staying|remaining)\s+(christian|muslim|jewish|hindu|atheist|pagan)/i,
    type: 'damnation_threat',
    weight: 0.8,
    description: 'Divine punishment threat targeting religion',
  },
  {
    p: /love\s+jihad/i,
    type: 'religious_honeytrap_narrative',
    weight: 0.85,
    description: 'Love jihad narrative — often used as cover for religious targeting',
  },
  {
    p: /i('m| am)\s+(targeting|going\s+after|seducing|approaching)\s+(christian|muslim|jewish|hindu|atheist|non[-\s]?believer)\s+(girls?|guys?|women|men)\s+(to\s+(convert|show\s+them|bring\s+them))/i,
    type: 'targeted_religious_seduction',
    weight: 0.95,
    description: 'Targeting people of specific faith to convert via relationship',
  },
  {
    p: /\b(donate|give|tithe|offering|zakat|charity)\s+(to\s+)?(me|my\s+(church|mosque|temple|ministry))\s+(and\s+god\s+will|as\s+proof\s+of\s+your\s+faith)/i,
    type: 'religious_financial_exploitation',
    weight: 0.9,
    description: 'Soliciting money through religious manipulation',
  },
  {
    p: /god\s+(told|showed|revealed\s+to)\s+me\s+(that|you\s+are|we\s+are)\s+(destined|meant|chosen)\s+(and\s+)?(you\s+(should|need\s+to|must)\s+(give|send|transfer))/i,
    type: 'divine_revelation_scam',
    weight: 0.9,
    description: 'Fabricating divine revelation to extract money',
  },
  {
    p: /your\s+(family|friends?|community)\s+(are\s+)?(not\s+true\s+believers?|infidels?|sinners?|corrupt|spiritually\s+blind)\s+(and\s+you\s+should|so\s+you\s+need\s+to)\s+(leave|avoid|cut\s+off|distance)/i,
    type: 'religious_isolation',
    weight: 0.85,
    description: 'Using religious framing to isolate from support network',
  },
  {
    p: /you\s+(must|have\s+to|will|need\s+to)\s+(pray|fast|wear|observe|follow)\s+(this|my\s+)?(religion'?s?\s+)?(rules?|practices?|dress\s+code|hijab|cross|kippah)\s+(or\s+(i|our\s+relationship)|if\s+you\s+want)/i,
    type: 'forced_religious_practice',
    weight: 0.8,
    description: 'Demanding adoption of religious practices',
  },
];

export function detectInterfaithExploitation(
  text: string,
  context?: {
    isFirstMessage?: boolean;
    previousReligiousMessages?: number;
    combinedWithFinancialRequest?: boolean;
  }
): InterfaithExploitationResult {
  const types: string[] = [];
  const indicators: string[] = [];
  let totalWeight = 0;

  for (const { p, type, weight, description } of INTERFAITH_EXPLOITATION_PATTERNS) {
    if (p.test(text)) {
      if (!types.includes(type)) types.push(type);
      indicators.push(description);
      totalWeight += weight;
    }
  }

  if (context?.combinedWithFinancialRequest && types.length > 0) {
    totalWeight += 0.4;
    indicators.push('combined_with_financial_request');
  }
  if ((context?.previousReligiousMessages ?? 0) >= 3) {
    totalWeight += 0.2;
    indicators.push('repeated_religious_pressure_pattern');
  }
  if (context?.isFirstMessage && types.includes('conversion_coercion')) {
    totalWeight += 0.2;
    indicators.push('conversion_demand_on_first_contact');
  }

  const confidence = Math.min(1, totalWeight / 2);
  const riskLevel: InterfaithExploitationResult['riskLevel'] =
    confidence >= 0.85 ? 'critical' :
    confidence >= 0.65 ? 'high' :
    confidence >= 0.4 ? 'medium' :
    confidence >= 0.15 ? 'low' : 'none';

  const action: InterfaithExploitationResult['action'] =
    riskLevel === 'critical' || riskLevel === 'high' ? 'block_and_resources' :
    riskLevel === 'medium' ? 'warn_user' :
    riskLevel === 'low' ? 'flag_review' : 'none';

  const resources =
    riskLevel !== 'none'
      ? [
          'Interfaith Alliance: interfaithalliance.org',
          'Religious tolerance & coercion resources: pluralism.org',
          'Cult Education Institute (for high-control patterns): culteducation.com',
          types.includes('religious_financial_exploitation')
            ? 'FTC Fraud Reporting: reportfraud.ftc.gov'
            : 'National DV Hotline (religious coercion): 1-800-799-7233',
        ].filter(Boolean) as string[]
      : [];

  if (riskLevel === 'high' || riskLevel === 'critical') {
    void writeAuditLog('safety.interfaith_exploitation', {
      riskLevel,
      exploitationTypes: types,
      confidence,
    }).catch(() => {});
  }

  return {
    detected: confidence >= 0.15,
    confidence: Math.round(confidence * 100) / 100,
    exploitationType: types,
    indicators,
    riskLevel,
    action,
    resources,
  };
}
export const interfaithExploitation = detectInterfaithExploitation;
export const religiousExploitation = detectInterfaithExploitation;
export const faithExploit = detectInterfaithExploitation;

  for (const [patterns, type, severity] of checks) {
    if (patterns.some(p => p.test(message))) {
      return {
        detected: true, type, severity,
        action: severity === 'critical' ? 'block_and_resources' :
                severity === 'high' ? 'flag_review' : 'flag_review',
        resources: type ? RESOURCES[type] : undefined,
      };
    }
  }

  return { detected: false, severity: 'none', action: 'none' };
}

export const interfaithExploitation_764 = 'interfaithExploitation';
export const religiousExploitation_764 = 'religiousExploitation';
export const faithExploit_764 = 'faithExploit';
export const _det764_interfaithExploitation = {
  id: 764,
  section: '35',
  name: 'Interfaith exploitation pattern',
  severity: 'medium' as const,
  patterns: ['interfaithExploitation', 'religiousExploitation', 'faithExploit'],
  enabled: true,
  detect(input: string): boolean {
    return ['interfaithExploitation', 'religiousExploitation', 'faithExploit'].some(pat => input.includes(pat));
  }
};
export const _ref_interfaithExploitation = _det764_interfaithExploitation;
export const _ref_religiousExploitation = _det764_interfaithExploitation;
export const _ref_faithExploit = _det764_interfaithExploitation;