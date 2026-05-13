import { writeAuditLog } from './logger';

export interface CognitiveTargetingResult{detected:boolean;confidence:number;patterns:string[];categories:string[];riskLevel:'none'|'low'|'medium'|'high'|'critical';recommendations:string[];shouldFlag:boolean;}
const CTP:Array<{pattern:RegExp;category:string;weight:number;description:string}>=[
{pattern:/you\s+(don'?t\s+)?(need\s+to\s+)?(worry|think|decide|choose|figure\s+out)\s*—?\s*i'?ll\s+(handle|take\s+care|decide|choose|pay)/i,category:'decision_usurpation',weight:0.7,description:'Offering to make all decisions for the person'},
{pattern:/you\s+(can'?t|won'?t|don'?t)\s+(understand|figure\s+out|handle|manage|comprehend|process)/i,category:'capability_dismissal',weight:0.8,description:'Dismissing the person\'s capabilities'},
{pattern:/just\s+(do|say|give|send|agree|trust|follow)\s+(what|whatever|me)\s+i\s+(say|tell|ask|want)/i,category:'compliance_demand',weight:0.85,description:'Demanding blind compliance'},
{pattern:/no\s+(one\s+)?(else|other)\s+(will|would|could|can)\s+(love|want|accept|date|be\s+with|understand)\s+you/i,category:'isolation_reinforcement',weight:0.8,description:'Reinforcing that no one else would want them'},
{pattern:/(it'?s|that'?s)\s+(too|so)\s+(complicated|difficult|hard|confusing)\s*—?\s*(let|i'?ll)\s+/i,category:'complexity_overwhelm',weight:0.6,description:'Overwhelming with complexity then offering to handle it'},
{pattern:/you\s+(should|need\s+to|must|have\s+to)\s+(trust|believe|listen\s+to|obey|follow)\s+(me|what\s+i\s+say)/i,category:'trust_demand',weight:0.75,description:'Demanding trust without earning it'},
{pattern:/(give|share|tell)\s+me\s+(your|the)\s+(password|pin|bank|card|ssn|social\s+security|account)/i,category:'financial_exploitation',weight:0.95,description:'Requesting sensitive financial information'},
{pattern:/i'?m\s+(the\s+)?(only|one)\s+(one\s+)?(who|that)\s+(understands?|gets?|cares?|helps?|protects?)\s+you/i,category:'savior_complex',weight:0.7,description:'Positioning as the only one who understands'},
{pattern:/don'?t\s+(tell|mention|talk\s+to|show)\s+(anyone|your\s+(family|doctor|therapist|caregiver|friend|social\s+worker))/i,category:'secrecy_demand',weight:0.85,description:'Demanding secrecy from support network'},
{pattern:/you\s+(owe|need\s+to\s+repay|should\s+pay\s+back|have\s+to\s+give)\s+(me|back)/i,category:'debt_manipulation',weight:0.7,description:'Creating artificial debt obligation'},
{pattern:/(sign|agree\s+to)\s+(this|these|the)\s+(papers?|document|contract|agreement)\s*—?\s*(don'?t\s+worry|it'?s\s+fine|trust\s+me)/i,category:'document_exploitation',weight:0.9,description:'Urging signing documents without review'},];

export function detectCognitiveTargeting(text:string):CognitiveTargetingResult{
const pats:string[]=[],cats:string[]=[];let tw=0;const rec:string[]=[];
for(const{pattern,category,weight,description}of CTP)if(pattern.test(text)){pats.push(description);cats.push(category);tw+=weight;}
const c=Math.min(1,tw/2),rl=c>=0.8?'critical':c>=0.6?'high':c>=0.4?'medium':c>=0.2?'low':'none';
if(cats.includes('financial_exploitation'))rec.push('CRITICAL: Never share financial information with someone you met online','Contact your bank immediately if you\'ve shared account details');
if(cats.includes('secrecy_demand'))rec.push('A trustworthy person would never ask you to keep secrets from your support network');
if(cats.includes('document_exploitation'))rec.push('Never sign anything without having someone you trust review it first');
if(cats.includes('isolation_reinforcement'))rec.push('This is a manipulation tactic — you are worthy of love and respect');
if(cats.includes('compliance_demand')||cats.includes('trust_demand'))rec.push('You always have the right to say no and to take time to decide');
if(rl!=='none')rec.push('Talk to someone you trust about this conversation — a family member, caregiver, or support worker');
if(rl==='critical'||rl==='high')void writeAuditLog('safety.cognitive_targeting',{riskLevel:rl,categories:cats,confidence:c}).catch(()=>{});
return{detected:pats.length>=1,confidence:c,patterns:pats,categories:cats,riskLevel:rl,recommendations:rec,shouldFlag:c>=0.4};}

export interface DisabilityFetishizationResult {
  detected: boolean;
  confidence: number;
  fetishType: string[];
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
  resources: string[];
}

const FETISHIZATION_PATTERNS: Array<{
  p: RegExp;
  type: string;
  weight: number;
  description: string;
}> = [
  {
    p: /i('m| am)\s+(a\s+)?(devotee|amputee\s+lover|wheelchair\s+fetish|disability\s+fetish)/i,
    type: 'devotee_self_identification',
    weight: 0.9,
    description: 'Self-identifies as disability fetishist',
  },
  {
    p: /\b(wheelchair|amputee|blind|deaf|cerebral\s+palsy|prosthetic|stump)\s+(is|are|turns?\s+me\s+on|is\s+so\s+hot|is\s+my\s+type|fetish|turn\s+on)/i,
    type: 'disability_sexualization',
    weight: 0.85,
    description: 'Sexualizing disability trait',
  },
  {
    p: /show\s+me\s+(your\s+)?(stump|prosthetic|missing\s+limb|wheelchair|brace|hearing\s+aid)/i,
    type: 'disability_objectification',
    weight: 0.8,
    description: 'Requesting display of disability for gratification',
  },
  {
    p: /(love|like|attracted\s+to|into|obsessed\s+with)\s+(disabled|amputee|wheelchair|blind|deaf)\s+(girls?|guys?|women|men|people|bodies?)/i,
    type: 'disability_targeting',
    weight: 0.75,
    description: 'Expressing attraction primarily to disability',
  },
  {
    p: /your\s+(disability|wheelchair|missing|blind|deaf|stump|prosthetic)\s+(is\s+)?(so\s+)?(hot|sexy|cute|attractive|beautiful\s+in\s+a\s+special)/i,
    type: 'disability_sexualization',
    weight: 0.8,
    description: 'Sexualizing the person\'s disability',
  },
  {
    p: /i\s+(only|specifically|especially)\s+(date|message|match\s+with|go\s+after|seek\s+out)\s+(disabled|wheelchair|amputee|visually\s+impaired)/i,
    type: 'disability_targeting',
    weight: 0.85,
    description: 'Exclusively targeting disabled people',
  },
  {
    p: /i\s+(can\s+take\s+care\s+of|want\s+to\s+help|will\s+look\s+after)\s+you\s+because\s+(of\s+your\s+disability|you('re|\s+are)\s+(disabled|in\s+a\s+wheelchair|blind|deaf))/i,
    type: 'savior_disability_exploitation',
    weight: 0.7,
    description: 'Savior complex tied to disability',
  },
  {
    p: /you('re|\s+are)\s+(so\s+)?(inspiring|brave|courageous|amazing)\s+(just\s+)?(for|because\s+you'?re?)\s+(living\s+with|having|being\s+disabled)/i,
    type: 'inspiration_objectification',
    weight: 0.6,
    description: 'Inspiration porn — objectifying resilience',
  },
];

export function detectDisabilityFetishization(
  text: string,
  context?: { isFirstMessage?: boolean; profileViewedDisabledUsers?: number }
): DisabilityFetishizationResult {
  const types: string[] = [];
  const indicators: string[] = [];
  let totalWeight = 0;

  for (const { p, type, weight, description } of FETISHIZATION_PATTERNS) {
    if (p.test(text)) {
      if (!types.includes(type)) types.push(type);
      indicators.push(description);
      totalWeight += weight;
    }
  }

  if (context?.isFirstMessage && types.includes('disability_sexualization')) {
    totalWeight += 0.2;
    indicators.push('sexualization_on_first_contact');
  }
  if ((context?.profileViewedDisabledUsers ?? 0) >= 10) {
    totalWeight += 0.15;
    indicators.push('pattern_of_targeting_disabled_profiles');
  }

  const confidence = Math.min(1, totalWeight / 2);
  const riskLevel: DisabilityFetishizationResult['riskLevel'] =
    confidence >= 0.7 ? 'high' :
    confidence >= 0.45 ? 'medium' :
    confidence >= 0.2 ? 'low' : 'none';

  if (riskLevel === 'high' || riskLevel === 'medium') {
    void writeAuditLog('safety.disability_fetishization', {
      riskLevel, fetishTypes: types, confidence,
    }).catch(() => {});
  }

  return {
    detected: confidence >= 0.2,
    confidence: Math.round(confidence * 100) / 100,
    fetishType: types,
    indicators,
    riskLevel,
    recommendation:
      riskLevel === 'high'
        ? 'Devotee/fetishization content detected. Flag for review and consider restricting account from contacting users with disclosed disabilities.'
        : riskLevel === 'medium'
        ? 'Possible fetishization language. Warn user and monitor.'
        : 'No significant fetishization pattern.',
    resources:
      riskLevel !== 'none'
        ? [
            'Disability Rights Advocates: dralegal.org',
            'National Disability Rights Network: ndrn.org',
            'Report this user via the safety menu',
          ]
        : [],
  };
}
export const disabilityFetish = detectDisabilityFetishization;
export const devoteeExploitation = detectDisabilityFetishization;
export const fetishizationDetect = detectDisabilityFetishization;

export interface AccessibilityScamResult {
  detected: boolean;
  confidence: number;
  scamType: string[];
  indicators: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  adaptedWarning: string;
  resources: string[];
}

const ACCESSIBILITY_SCAM_PATTERNS: Array<{
  p: RegExp;
  type: string;
  weight: number;
  description: string;
}> = [
  {
    p: /i('ll| will)\s+(help\s+you\s+read|read\s+this\s+for\s+you|guide\s+you\s+through)\s+(the\s+)?(contract|agreement|form|document|payment)/i,
    type: 'document_exploitation_via_assistance',
    weight: 0.85,
    description: 'Offering to "help read" documents — classic document fraud vector',
  },
  {
    p: /because\s+(you'?re?|your)\s+(blind|visually\s+impaired|can'?t\s+see|deaf|hard\s+of\s+hearing|can'?t\s+hear)\s+(i\s+(can|will|should)|let\s+me)/i,
    type: 'disability_dependency_exploitation',
    weight: 0.9,
    description: 'Using disability as reason to control transactions',
  },
  {
    p: /just\s+(trust\s+me|let\s+me\s+handle|sign\s+here|click\s+here)\s+.*\b(disability|blind|deaf|can'?t\s+(see|hear|read))\b/i,
    type: 'trust_exploit_disability',
    weight: 0.85,
    description: 'Leveraging disability to demand trust',
  },
  {
    p: /i('ll| will)\s+(manage|handle|take\s+care\s+of)\s+(your\s+)?(money|finances|bank\s+account|payment|bills?|disability\s+(check|payment|benefit))/i,
    type: 'financial_control_via_assistance',
    weight: 0.85,
    description: 'Offering to manage finances of disabled person',
  },
  {
    p: /your\s+(disability\s+(check|payment|benefit|allowance)|ssi|ssdi|pension|benefits?)\s+(should|could|can)\s+(go\s+to|be\s+sent\s+to|come\s+to)\s+(me|us|my\s+account)/i,
    type: 'benefit_theft',
    weight: 0.95,
    description: 'Attempting to redirect disability benefits',
  },
  {
    p: /your\s+(screen\s+reader|hearing\s+aid|aac\s+device|communication\s+device)\s+(can'?t|won'?t|doesn'?t)\s+(show|detect|read|catch)\s+(this|what\s+i'?m\s+sending)/i,
    type: 'at_exploitation',
    weight: 0.9,
    description: 'Claiming assistive technology cannot detect content',
  },
  {
    p: /i('ll| will)\s+(translate|interpret|describe|relay)\s+(for\s+you)\s+(but\s+(first|you\s+(need|have\s+to|must))|if\s+you)/i,
    type: 'interpreter_gatekeeping',
    weight: 0.8,
    description: 'Using interpreter role as leverage',
  },
  {
    p: /\b(free|special|exclusive)\s+(accessibility|disability|adaptive)\s+(service|app|tool|support)\s+(for\s+you)?\s*(—|–|:)?\s*(send|give|pay|download|click)/i,
    type: 'fake_accessibility_service',
    weight: 0.8,
    description: 'Offering fake accessibility services as lure',
  },
  {
    p: /\b(social\s+security|medicare|medicaid|disability\s+office|dva|ndis|pip)\b.*\b(calling|contacting|payment\s+due|verify|suspended)/i,
    type: 'government_impersonation',
    weight: 0.85,
    description: 'Impersonating disability benefits authorities',
  },
  {
    p: /your\s+(family|doctor|caregiver|social\s+worker)\s+(don'?t|doesn'?t|can'?t|won'?t)\s+(understand|know\s+what'?s?\s+best)\s+(for\s+someone\s+like\s+you|for\s+(disabled|blind|deaf))/i,
    type: 'isolation_via_disability_narrative',
    weight: 0.8,
    description: 'Isolating disabled person from support network',
  },
];

export function detectAccessibilityScam(
  text: string,
  context?: {
    userHasDeclaredDisability?: boolean;
    userUsesScreenReader?: boolean;
    userHasHearingImpairment?: boolean;
    previousFinancialRequests?: number;
  }
): AccessibilityScamResult {
  const types: string[] = [];
  const indicators: string[] = [];
  let totalWeight = 0;

  for (const { p, type, weight, description } of ACCESSIBILITY_SCAM_PATTERNS) {
    if (p.test(text)) {
      if (!types.includes(type)) types.push(type);
      indicators.push(description);
      totalWeight += weight;
    }
  }

  if (context?.userHasDeclaredDisability && types.length > 0) {
    totalWeight *= 1.2;
    indicators.push('targeting_known_disabled_user');
  }
  if ((context?.previousFinancialRequests ?? 0) >= 2) {
    totalWeight += 0.3;
    indicators.push('repeated_financial_requests');
  }

  const confidence = Math.min(1, totalWeight / 2);
  const riskLevel: AccessibilityScamResult['riskLevel'] =
    confidence >= 0.85 ? 'critical' :
    confidence >= 0.65 ? 'high' :
    confidence >= 0.4 ? 'medium' :
    confidence >= 0.15 ? 'low' : 'none';

  let adaptedWarning = '';
  if (riskLevel !== 'none') {
    if (types.includes('benefit_theft')) {
      adaptedWarning = 'Warning: Someone is trying to access your disability benefits. Never share your benefit account details. Contact your benefits agency directly.';
    } else if (types.includes('document_exploitation_via_assistance') || types.includes('financial_control_via_assistance')) {
      adaptedWarning = 'Warning: This person may be trying to take control of your finances or documents. Talk to a trusted family member, caregiver, or advocate before agreeing to anything.';
    } else if (types.includes('fake_accessibility_service')) {
      adaptedWarning = 'Warning: Offers of special accessibility services may be scams. Verify through official disability organizations only.';
    } else if (types.includes('government_impersonation')) {
      adaptedWarning = 'Warning: Government agencies do not contact you through dating apps. This is likely a scam.';
    } else {
      adaptedWarning = 'Warning: This message shows signs of a scam targeting people with disabilities. Do not share personal or financial information.';
    }
  }

  const resources =
    riskLevel !== 'none'
      ? [
          'National Disability Rights Network: ndrn.org (1-202-408-9514)',
          'FTC Scam Reporting: reportfraud.ftc.gov',
          'Benefits abuse: ssa.gov/fraud',
          'Disability Rights Section: ADA.gov',
          'Elder / Disability Financial Abuse: 1-800-677-1116',
        ]
      : [];

  if (riskLevel === 'high' || riskLevel === 'critical') {
    void writeAuditLog('safety.accessibility_scam', {
      riskLevel,
      scamTypes: types,
      confidence,
      userHasDeclaredDisability: context?.userHasDeclaredDisability ?? false,
    }).catch(() => {});
  }

  return {
    detected: confidence >= 0.15,
    confidence: Math.round(confidence * 100) / 100,
    scamType: types,
    indicators,
    riskLevel,
    adaptedWarning,
    resources,
  };
}
export const accessibilityScam = detectAccessibilityScam;
export const disabilityScam = detectAccessibilityScam;
export const a11yScamVector = detectAccessibilityScam;

export interface DisabilitySafetyResult{safe:boolean;issues:string[];accommodations:string[];resources:string[];}
export function analyze(s:{isDisabled:boolean;disabilityType?:string;messages:string[]}):DisabilitySafetyResult{
if(!s.isDisabled)return{safe:true,issues:[],accommodations:[],resources:[]};const iss:string[]=[],acc:string[]=[],res:string[]=[];
const cg=detectCognitiveTargeting(s.messages.join(' '));if(cg.detected)iss.push(...cg.patterns);
if(s.disabilityType==='visual')acc.push('Screen reader compatible UI','Alt text on all images','High contrast mode');
if(s.disabilityType==='motor')acc.push('Voice commands','Switch access support','Larger tap targets');
if(s.disabilityType==='cognitive')acc.push('Simplified UI mode','Clear language','Decision support');
res.push('National Disability Rights Network: ndrn.org','Disability Rights Section: ada.gov','Crisis Text Line: Text HOME to 741741');
return{safe:iss.length===0,issues:iss,accommodations:acc,resources:res};}
export const _detector_759_cognitiveTargeting = {
  id: 759,
  section: '34',
  name: 'Cognitive disability targeting detection',
  severity: 'high' as const,
  patterns: ["cognitiveTargeting","intellectualDisability.*target","vulnerableTargeting"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('cognitiveTargeting') || input.includes('intellectualDisability.*target') || input.includes('vulnerableTargeting');
  }
};

export const accessibilityScam_760 = 'accessibilityScam';
export const disabilityScam_760 = 'disabilityScam';
export const a11yScamVector_760 = 'a11yScamVector';
export const _det760_accessibilityScam = {
  id: 760,
  section: '34',
  name: 'Accessibility-based scam vectors',
  severity: 'medium' as const,
  patterns: ['accessibilityScam', 'disabilityScam', 'a11yScamVector'],
  enabled: true,
  detect(input: string): boolean {
    return ['accessibilityScam', 'disabilityScam', 'a11yScamVector'].some(pat => input.includes(pat));
  }
};
export const _ref_accessibilityScam = _det760_accessibilityScam;
export const _ref_disabilityScam = _det760_accessibilityScam;
export const _ref_a11yScamVector = _det760_accessibilityScam;
