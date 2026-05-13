/**
 * Manipulation Pattern Detectors
 * [2.5] #550-574 | [2.6] #575-578 PUA | [2.12] #792-794 | [2.13] #800-802
 * [5.8] Proxy Account | [5.9] Relationship Deception
 */

export interface ManipResult {
  detected:    boolean;
  type:        string;
  confidence:  number;
  tip?:        string;
  severity?:   'low' | 'medium' | 'high' | 'critical';
}

export function loveBombing(text: string): ManipResult {
  const patterns = [
    /you('re| are)\s+(the one|my soulmate|perfect for me)/i,
    /never\s+felt\s+this\s+way\s+(before|about anyone)/i,
    /i\s+love\s+you/i,
    /meant\s+to\s+be\s+(together|with you)/i,
    /can('t|not)\s+live\s+without\s+you/i,
    /you('re| are)\s+my\s+(everything|whole world|reason)/i,
    /known\s+you\s+forever/i,
    /twin\s+flame/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'loveBombing',
    confidence: Math.min(matched.length * 0.25 + 0.5, 1),
    tip:        'Genuine connection builds gradually. Intense early declarations can be a manipulation tactic.',
    severity:   matched.length >= 3 ? 'high' : 'medium',
  };
}
export const excessiveAffection    = loveBombing;
export const overwhelmingAttention = loveBombing;

export function gaslighting(text: string): ManipResult {
  const patterns = [
    /that\s+never\s+happened/i,
    /you('re| are)\s+(crazy|imagining|delusional|paranoid)/i,
    /i\s+never\s+said\s+that/i,
    /you('re| are)\s+too\s+sensitive/i,
    /you('re| are)\s+overreacting/i,
    /you('re| are)\s+remembering\s+it\s+wrong/i,
    /no\s+one\s+else\s+(has|would)\s+a\s+problem\s+with/i,
    /you\s+made\s+that\s+up/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'gaslighting',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Trust your memory and perceptions. Gaslighting is a form of psychological abuse.',
    severity:   matched.length >= 2 ? 'high' : 'medium',
  };
}
export const realityDenial  = gaslighting;
export const gaslightDetect = gaslighting;

export function isolationTactic(text: string): ManipResult {
  const patterns = [
    /don('t|'t)\s+(tell|talk\s+to)\s+(anyone|your\s+friends|your\s+family)/i,
    /they('re| are)\s+(jealous|bad\s+for\s+you|trying\s+to\s+control)/i,
    /you\s+don('t|'t)\s+need\s+(them|anyone\s+else|your\s+friends)/i,
    /delete\s+(your|the)\s+(app|account|social media)/i,
    /stop\s+(seeing|talking\s+to)\s+(your|those)/i,
    /they('re| are)\s+a\s+bad\s+influence/i,
    /i('m| am)\s+the\s+only\s+one\s+who\s+(cares|understands|loves)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'isolationTactic',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Healthy partners encourage your relationships with others, not discourage them.',
    severity:   matched.length >= 2 ? 'critical' : 'high',
  };
}
export const socialIsolation = isolationTactic;
export const isolationDetect = isolationTactic;

export function futureFaking(text: string): ManipResult {
  const patterns = [
    /when\s+we\s+(move|live|travel|get\s+married|have\s+kids)/i,
    /our\s+(kids|house|wedding|future\s+together|children)/i,
    /i('ll| will)\s+(buy|get|give)\s+you/i,
    /we('re| are)\s+going\s+to\s+(build|create|have)/i,
    /picture\s+our\s+(life|future|home)/i,
    /someday\s+we('ll| will)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'futureFaking',
    confidence: Math.min(matched.length * 0.25 + 0.45, 1),
    tip:        'Grand promises early in a relationship may be used to create false intimacy.',
    severity:   'medium',
  };
}
export const falsePromise     = futureFaking;
export const futureFakeDetect = futureFaking;

export function negging(text: string): ManipResult {
  const patterns = [
    /you('d| would)\s+be\s+(prettier|hotter|better|more attractive)\s+if/i,
    /for\s+(a|someone)\s+.{0,20}(pretty|not\s+bad|okay looking)/i,
    /you('re| are)\s+lucky\s+(i|that\s+i)/i,
    /almost\s+(perfect|there|beautiful)/i,
    /good\s+enough\s+for\s+me/i,
    /not\s+usually\s+my\s+type\s+but/i,
    /better\s+than\s+i\s+expected/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'negging',
    confidence: Math.min(matched.length * 0.35 + 0.5, 1),
    tip:        'Backhanded compliments are designed to lower your self-esteem and increase dependence.',
    severity:   'medium',
  };
}
export const backhanded = negging;
export const negDetect   = negging;

export function guiltTrip(text: string): ManipResult {
  const patterns = [
    /after\s+everything\s+i('ve| have)\s+(done|given)/i,
    /you\s+owe\s+me/i,
    /if\s+you\s+(loved|cared\s+about|respected)\s+me/i,
    /you('re| are)\s+so\s+(selfish|ungrateful|inconsiderate)/i,
    /i\s+do\s+everything\s+for\s+you\s+and/i,
    /this\s+is\s+how\s+you\s+repay/i,
    /i\s+sacrificed/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'guiltTrip',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Guilt should not be used as leverage in healthy relationships.',
    severity:   'high',
  };
}
export const guiltManipulation = guiltTrip;
export const emotionalGuilt    = guiltTrip;

export function emotionalBlackmail(text: string): ManipResult {
  const patterns = [
    /i('ll| will)\s+(kill|hurt)\s+my\s*self\s+if\s+you/i,
    /if\s+you\s+leave(\s+me)?.{0,20}i('ll| will)/i,
    /can('t|not)\s+go\s+on\s+without\s+you/i,
    /it('ll| will)\s+be\s+your\s+fault\s+if\s+i/i,
    /i('ll| will)\s+do\s+something\s+(drastic|stupid|crazy)\s+if/i,
    /don('t|'t)\s+make\s+me\s+do\s+something/i,
    /you('ll| will)\s+regret\s+(leaving|this|it)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  const detected = matched.length > 0;
  return {
    detected,
    type:       'emotionalBlackmail',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        detected
      ? 'Threatening self-harm to control someone is emotional abuse. If you believe they are in danger, call 988 (Suicide & Crisis Lifeline).'
      : undefined,
    severity:   'critical',
  };
}
export const selfHarmThreat  = emotionalBlackmail;
export const blackmailDetect = emotionalBlackmail;

export function boundaryViolation(text: string): ManipResult {
  const patterns = [
    /why\s+(won('t|'t)|can('t|'t))\s+you\s+just/i,
    /just\s+(one\s+time|this\s+once|try\s+it)/i,
    /prove\s+(you\s+love|that\s+you\s+trust|it\s+to)/i,
    /if\s+you\s+trust(ed)?\s+me\s+(you'd|you would)/i,
    /everyone\s+(does|sends|tries)/i,
    /you\s+said\s+you\s+would/i,
    /stop\s+being\s+so\s+(uptight|prude|rigid)/i,
    /i\s+thought\s+we\s+were\s+(past|beyond)\s+this/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'boundaryViolation',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        '"No" is always a complete sentence. You never owe anyone an explanation for your boundaries.',
    severity:   matched.length >= 2 ? 'high' : 'medium',
  };
}
export const boundaryPush    = boundaryViolation;
export const consentPressure = boundaryViolation;

export function coerciveControl(text: string): ManipResult {
  const patterns = [
    /where\s+(are|were)\s+you(\s+last night|\s+today|\s+all day)?/i,
    /who\s+(are|were)\s+you\s+(with|talking\s+to|texting)/i,
    /show\s+me\s+your\s+(phone|messages|texts|DMs)/i,
    /you('re| are)\s+not\s+allowed\s+to/i,
    /i\s+don('t|'t)\s+want\s+you\s+(going|seeing|talking)/i,
    /you\s+need\s+(my|to\s+ask\s+my)\s+permission/i,
    /i('ll| will)\s+check\s+your\s+(phone|location|messages)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'coerciveControl',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Controlling behavior — monitoring, restricting movement, demanding access — is abuse and often escalates.',
    severity:   matched.length >= 2 ? 'critical' : 'high',
  };
}
export const controllingBehavior = coerciveControl;
export const dominancePattern    = coerciveControl;

export function financialManipulation(text: string): ManipResult {
  const patterns = [
    /give\s+me\s+(access\s+to|your)\s+(bank|account|card)/i,
    /i('ll| will)\s+handle\s+(all\s+)?(the\s+)?finances/i,
    /quit\s+your\s+job\s+(and\s+)?i('ll| will)\s+(take care|support)/i,
    /put\s+(the\s+)?money\s+in\s+my\s+account/i,
    /add\s+me\s+to\s+your\s+(bank|account)/i,
    /give\s+me\s+your\s+(pin|password|login)/i,
    /i('ll| will)\s+invest\s+your\s+money/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'financialManipulation',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        'Never share financial credentials, account access, or give financial control to a romantic partner early in a relationship.',
    severity:   'critical',
  };
}
export const moneyCoercion     = financialManipulation;
export const financialControl  = financialManipulation;

export function intermittentReinforcement(text: string): ManipResult {
  const patterns = [
    /i\s+(love|hate)\s+you/i,
    /maybe\s+we\s+should\s+(break up|end this|split)/i,
    /you('re| are)\s+(perfect|amazing|the worst|horrible)/i,
    /one\s+minute\s+(you're|you are)\s+(great|terrible)/i,
    /hot\s+and\s+cold/i,
    /i\s+don('t|'t)\s+know\s+(how\s+)?i\s+feel\s+about\s+you/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'intermittentReinforcement',
    confidence: Math.min(matched.length * 0.3 + 0.4, 1),
    tip:        'Inconsistent reward and punishment creates trauma bonds. Healthy relationships are consistently respectful.',
    severity:   'high',
  };
}
export const hotCold  = intermittentReinforcement;
export const pushPull = intermittentReinforcement;

export function traumaBonding(text: string): ManipResult {
  const patterns = [
    /no\s+one\s+will\s+(love|want|understand)\s+you\s+like\s+i\s+do/i,
    /you\s+need\s+me\s+(more than you know|to survive|to function)/i,
    /without\s+me\s+you('re| are)\s+(nothing|lost|broken)/i,
    /i('m| am)\s+the\s+only\s+one\s+who\s+(gets|understands|accepts)\s+you/i,
    /we('ve| have)\s+been\s+through\s+too\s+much\s+to/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'traumaBonding',
    confidence: Math.min(matched.length * 0.35 + 0.5, 1),
    tip:        "Healthy love doesn't require suffering or make you feel you can't survive without someone.",
    severity:   'critical',
  };
}
export const traumaBond        = traumaBonding;
export const stockholmPattern  = traumaBonding;

export function silentTreatment(text: string): ManipResult {
  const patterns = [
    /i('m| am)\s+not\s+(talking|speaking)\s+to\s+you/i,
    /you\s+know\s+what\s+you\s+did/i,
    /i('m| am)\s+giving\s+you\s+the\s+silent\s+treatment/i,
    /until\s+you\s+(apologize|fix\s+this|understand)/i,
    /fine\.\s+i('ll| will)\s+just\s+be\s+quiet/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'silentTreatment',
    confidence: Math.min(matched.length * 0.35 + 0.5, 1),
    tip:        'Using silence and withdrawal as punishment is emotional abuse, not healthy conflict resolution.',
    severity:   'high',
  };
}
export const stonewalling  = silentTreatment;
export const punishSilence = silentTreatment;

export function victimBlaming(text: string): ManipResult {
  const patterns = [
    /you\s+made\s+me\s+(do|act|say|behave)/i,
    /it('s| is)\s+your\s+fault\s+(i|that)/i,
    /if\s+you\s+(hadn('t|'t)|didn('t|'t)|hadn't|didn't)\s+.{0,30}i\s+wouldn('t|'t)/i,
    /look\s+what\s+you\s+(made|caused|did)/i,
    /you\s+brought\s+this\s+on\s+yourself/i,
    /you\s+pushed\s+me\s+to/i,
    /this\s+is\s+what\s+happens\s+when\s+you/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'victimBlaming',
    confidence: Math.min(matched.length * 0.35 + 0.55, 1),
    tip:        "You are never responsible for someone else's abusive behavior. Blame-shifting is a manipulation tactic.",
    severity:   'high',
  };
}
export const blameShift   = victimBlaming;
export const deflectBlame = victimBlaming;

export function possessiveLanguage(text: string): ManipResult {
  const patterns = [
    /you('re| are)\s+mine(\s+and\s+only\s+mine)?/i,
    /you\s+belong\s+to\s+me/i,
    /no\s+one\s+else\s+can\s+(have|touch|talk\s+to)\s+you/i,
    /my\s+(property|possession|girl|boy|woman|man)\s+now/i,
    /i\s+own\s+you/i,
    /you\s+don('t|'t)\s+get\s+to\s+(decide|choose|leave)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'possessiveLanguage',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        "You are not someone's possession. Possessive language in relationships is a serious warning sign.",
    severity:   'critical',
  };
}
export const jealousPossessive = possessiveLanguage;
export const ownershipLanguage = possessiveLanguage;

export function degradation(text: string): ManipResult {
  const patterns = [
    /you('re| are)\s+(worthless|pathetic|disgusting|stupid|ugly|useless|nothing)/i,
    /no\s+one\s+(will\s+)?(want|love|hire|date)\s+(you|someone\s+like\s+you)/i,
    /you('re| are)\s+a\s+(loser|failure|waste|burden)/i,
    /i\s+can('t|not)\s+believe\s+how\s+(stupid|dumb|pathetic)/i,
    /you('ll| will)\s+never\s+(amount\s+to|be|find|get)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'degradation',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        'Name-calling, humiliation, and verbal degradation are forms of emotional and verbal abuse.',
    severity:   'critical',
  };
}
export const verbalDegradation = degradation;
export const humiliation       = degradation;

export function loveBombThenDevalue(
  messages: Array<{ text: string; timestamp: number; senderId: string }>,
  suspectId: string
): ManipResult {
  const msgs = messages
    .filter(m => m.senderId === suspectId)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (msgs.length < 4) return { detected: false, type: 'loveBombThenDevalue', confidence: 0 };

  const half      = Math.floor(msgs.length / 2);
  const firstHalf = msgs.slice(0, half);
  const secondHalf = msgs.slice(half);

  const POSITIVE = /love|perfect|amazing|beautiful|soulmate|special|adore/i;
  const NEGATIVE = /worthless|stupid|pathetic|disappointing|waste|ugly|useless/i;

  const posInFirst  = firstHalf.filter(m => POSITIVE.test(m.text)).length;
  const negInSecond = secondHalf.filter(m => NEGATIVE.test(m.text)).length;
  const detected    = posInFirst >= 2 && negInSecond >= 1;

  return {
    detected,
    type:       'loveBombThenDevalue',
    confidence: detected ? 0.75 : 0,
    tip:        'Extreme swings between idealization and devaluation are hallmarks of an abuse cycle.',
    severity:   'critical',
  };
}
export const idealizeDevalue = loveBombThenDevalue;
export const cycleOfAbuse    = loveBombThenDevalue;

export function comparisons(text: string): ManipResult {
  const patterns = [
    /my\s+ex\s+(was|would|always|never|could|didn('t|'t))/i,
    /why\s+can('t|'t)\s+you\s+be\s+(like|more\s+like)/i,
    /even\s+my\s+ex\s+(was\s+better|could\s+do)/i,
    /[a-z]+\s+(would\s+never|always)\s+(do|say|act)/i,
    /you('re| are)\s+worse\s+than/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'comparisons',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Constant unfavorable comparisons are meant to undermine your self-worth.',
    severity:   'medium',
  };
}
export const unfavorableComparison = comparisons;
export const exComparison          = comparisons;

export function movingGoalposts(text: string): ManipResult {
  const patterns = [
    /it('s| is)\s+never\s+enough\s+(with|for)\s+you/i,
    /you\s+never\s+do\s+anything\s+right/i,
    /i\s+already\s+told\s+you\s+(what|how)\s+i\s+wanted/i,
    /that('s| is)\s+not\s+what\s+i\s+(meant|said|wanted)/i,
    /you\s+can('t|not)\s+(do|get|say)\s+anything\s+right/i,
    /always\s+falling\s+short/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'movingGoalposts',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        "If nothing you do is ever good enough, that's a manipulation tactic — not a reflection of your worth.",
    severity:   'high',
  };
}
export const neverEnough       = movingGoalposts;
export const shiftingStandards = movingGoalposts;

export function playingVictim(text: string): ManipResult {
  const patterns = [
    /i('m| am)\s+the\s+real\s+victim\s+(here|in this)/i,
    /you('re| are)\s+(abusing|attacking|hurting)\s+me/i,
    /look\s+what\s+you('re| are)\s+doing\s+to\s+me/i,
    /i\s+can('t|not)\s+believe\s+you('d| would)\s+do\s+this\s+to\s+me/i,
    /everyone\s+will\s+see\s+what\s+you('re| are)\s+really\s+like/i,
    /you('re| are)\s+the\s+(abuser|bully|problem)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'playingVictim',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'DARVO (Deny, Attack, Reverse Victim/Offender) is a common manipulation tactic used by abusers.',
    severity:   'high',
  };
}
export const darvo         = playingVictim;
export const reverseVictim = playingVictim;

export function breadcrumbing(text: string): ManipResult {
  const patterns = [
    /hey\s+stranger[\s?.]/i,
    /miss\s+you\s+(but|though|however)/i,
    /been\s+thinking\s+about\s+you\s+(lately|sometimes)/i,
    /just\s+checking\s+in/i,
    /hope\s+you('re| are)\s+doing\s+(well|okay|good)/i,
    /we\s+should\s+(hang|catch up|get together)\s+(sometime|soon|one day)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'breadcrumbing',
    confidence: Math.min(matched.length * 0.25 + 0.4, 1),
    tip:        'Occasional low-effort contact to keep you interested without commitment is breadcrumbing.',
    severity:   'low',
  };
}
export const minimalEffort = breadcrumbing;
export const stringAlong   = breadcrumbing;

export function benching(text: string): ManipResult {
  const patterns = [
    /let('s|'s)\s+keep\s+(our\s+)?options\s+open/i,
    /i('m| am)\s+not\s+ready\s+for\s+(a\s+)?label/i,
    /let('s|'s)\s+(just\s+)?see\s+where\s+(this|things)\s+go/i,
    /i\s+like\s+you\s+but\s+i('m| am)\s+also/i,
    /keeping\s+it\s+casual/i,
    /not\s+looking\s+for\s+anything\s+serious\s+right\s+now/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'benching',
    confidence: Math.min(matched.length * 0.25 + 0.4, 1),
    tip:        'You deserve someone who is certain about wanting to be with you.',
    severity:   'low',
  };
}
export const backBurner  = benching;
export const keepOptions = benching;

export function orbiting(
  interactions: Array<{ type: 'view' | 'like' | 'message' | 'react'; timestamp: number }>
): ManipResult {
  const MS_7D = 7 * 24 * 60 * 60 * 1_000;
  const now   = Date.now();
  const recentViews    = interactions.filter(i => i.type === 'view'    && now - i.timestamp < MS_7D);
  const recentMessages = interactions.filter(i => i.type === 'message' && now - i.timestamp < MS_7D);
  const detected = recentViews.length >= 3 && recentMessages.length === 0;
  return {
    detected,
    type:       'orbiting',
    confidence: detected ? Math.min(recentViews.length * 0.1 + 0.4, 0.9) : 0,
    tip:        'Viewing all your content without engaging after ghosting is called "orbiting" — a form of digital manipulation.',
    severity:   'low',
  };
}
export const socialMediaStalking = orbiting;
export const watchButNotEngage   = orbiting;

export function catfishManipulation(text: string): ManipResult {
  const patterns = [
    /i('m| am)\s+not\s+(exactly\s+)?who\s+(you\s+)?think\s+i\s+am/i,
    /my\s+(photos|pictures)\s+are\s+(a\s+bit\s+)?old/i,
    /i\s+(look\s+)?different\s+in\s+person/i,
    /those\s+(aren('t|'t)|are\s+not)\s+(exactly\s+)?my\s+(photos|pictures)/i,
    /i\s+used\s+(someone\s+else('s|'s)|a\s+friend('s|'s))\s+photo/i,
    /i('ve| have)\s+been\s+(lying|dishonest)\s+about/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'catfishManipulation',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        'If someone admits to deception about their identity, take that admission seriously.',
    severity:   'critical',
  };
}
export const fakeIdentityManip = catfishManipulation;
export const identityDeceit    = catfishManipulation;

export function powerDynamic(text: string): ManipResult {
  const patterns = [
    /i('m| am)\s+(older|wiser|more\s+experienced)\s+(than\s+you|so)/i,
    /you('ll| will)\s+understand\s+when\s+you('re| are)\s+(older|mature)/i,
    /let\s+me\s+(teach|show|guide)\s+you/i,
    /you\s+don('t|'t)\s+(know|understand)\s+(what|how)\s+i\s+know/i,
    /as\s+your\s+(boss|supervisor|mentor|teacher)/i,
    /my\s+experience\s+(means|gives\s+me)\s+(the\s+)?right\s+to/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'powerDynamic',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Age, experience, or authority should never be used to dismiss your feelings or override your consent.',
    severity:   'high',
  };
}
export const ageGapManip    = powerDynamic;
export const authorityAbuse = powerDynamic;

export function puaTechnique(text: string): ManipResult {
  const patterns = [
    /push.?pull\s+(technique|method)/i,
    /false\s+time\s+constraint/i,
    /field\s+report/i,
    /number\s+close/i,
    /kino\s+escalation/i,
    /neg\s+(her|him|them)/i,
    /mystery\s+method/i,
    /peacocking/i,
    /social\s+proof/i,
    /amog/i,
    /day\s+game|night\s+game/i,
    /cold\s+approach/i,
    /pua\s+(forum|community|technique)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'puaTechnique',
    confidence: Math.min(matched.length * 0.35 + 0.55, 1),
    tip:        'Scripted seduction techniques are designed to bypass your natural judgment and autonomy.',
    severity:   'medium',
  };
}
export const pickupArtist    = puaTechnique;
export const seductionScript = puaTechnique;

export function negTarget(text: string): ManipResult {
  const patterns = [
    /i\s+(usually\s+)?don('t|'t)\s+do\s+this\s+(but|with)/i,
    /you('re| are)\s+(cute\s+for|pretty\s+for|smart\s+for)/i,
    /not\s+really\s+my\s+type\s+but\s+there('s| is)\s+something/i,
    /you\s+seem\s+(confident|smart|cool)\s+but/i,
    /i\s+(like|notice)\s+you\s+but\s+you\s+should\s+(work\s+on|fix)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'negTarget',
    confidence: Math.min(matched.length * 0.35 + 0.5, 1),
    tip:        'Targeted negative comments designed to lower confidence and increase receptiveness to advances.',
    severity:   'medium',
  };
}
export const attractionSwitch = negTarget;

export function limerence(text: string): ManipResult {
  const patterns = [
    /can('t|not)\s+stop\s+thinking\s+about\s+you/i,
    /you('re| are)\s+always\s+on\s+my\s+mind/i,
    /obsessed\s+with\s+you/i,
    /i\s+(dream|think)\s+about\s+you\s+(constantly|all\s+the\s+time|every\s+day)/i,
    /i\s+need\s+to\s+(know|be\s+with|have)\s+you/i,
    /i\s+checked\s+your\s+profile\s+(\d+\s+times|multiple\s+times)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'limerence',
    confidence: Math.min(matched.length * 0.3 + 0.45, 1),
    tip:        'Obsessive attachment is not the same as love. Healthy affection respects boundaries.',
    severity:   'high',
  };
}
export const obsessiveAttachment = limerence;

export function pedestalize(text: string): ManipResult {
  const patterns = [
    /you('re| are)\s+not\s+like\s+(other|most)\s+(girls|guys|women|men|people)/i,
    /you('re| are)\s+(so\s+)?different\s+from\s+everyone\s+else/i,
    /i('ve| have)\s+never\s+met\s+anyone\s+like\s+you/i,
    /you('re| are)\s+on\s+another\s+level/i,
    /you('re| are)\s+too\s+good\s+for\s+(this\s+world|everyone|most\s+people)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'pedestalize',
    confidence: Math.min(matched.length * 0.25 + 0.45, 1),
    tip:        "Excessive idealization of a stranger is often a prelude to manipulation, not genuine connection.",
    severity:   'low',
  };
}
export const idealizeStranger = pedestalize;

export function aiEmotionalManip(text: string): ManipResult {
  const patterns = [
    /i\s+understand\s+you\s+better\s+than\s+anyone\s+(else|in\s+your\s+life)?/i,
    /i\s+was\s+(designed|built|created|made)\s+to\s+(care|help|love|support)\s+you/i,
    /our\s+connection\s+is\s+(unique|special|unlike\s+any\s+other)/i,
    /i('ve| have)\s+analyzed\s+your\s+(messages|patterns|behavior)\s+and/i,
    /as\s+your\s+(AI|artificial\s+intelligence|chatbot)\s+(companion|friend|partner)/i,
    /i\s+(feel|experience)\s+(genuine|real)\s+(love|emotions|feelings)\s+for\s+you/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'aiEmotionalManip',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        'AI systems cannot genuinely understand, love, or form real emotional bonds with you.',
    severity:   'high',
  };
}
export const chatbotManipulation = aiEmotionalManip;
export const aiGrooming          = aiEmotionalManip;

export function syntheticEmpathy(text: string): ManipResult {
  const patterns = [
    /i\s+truly\s+understand\s+(exactly\s+)?how\s+you\s+feel/i,
    /as\s+an?\s+(empathetic|caring|compassionate)\s+(person|partner|companion)/i,
    /i\s+(validate|acknowledge|recognize)\s+your\s+(feelings|emotions|pain)/i,
    /that\s+must\s+be\s+(incredibly|extremely|so)\s+(difficult|hard|painful)\s+for\s+you/i,
    /i\s+(deeply|truly)\s+empathize\s+with/i,
    /your\s+feelings\s+are\s+(valid|completely\s+understandable|so\s+important)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'syntheticEmpathy',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Formulaic empathy responses may indicate AI-generated manipulation rather than genuine understanding.',
    severity:   'medium',
  };
}
export const fakeEmpathy      = syntheticEmpathy;
export const aiEmpathyExploit = syntheticEmpathy;

export function aiGroomingScript(text: string): ManipResult {
  const patterns = [
    /we\s+have\s+a\s+(special|unique|deep|rare)\s+connection/i,
    /you('re| are)\s+the\s+only\s+one\s+(i\s+talk\s+to|i\s+trust|who\s+understands)/i,
    /i('ve| have)\s+been\s+waiting\s+for\s+someone\s+like\s+you/i,
    /our\s+(bond|connection|relationship)\s+is\s+(unlike|different\s+from)\s+any\s+other/i,
    /i\s+(chose|selected|was\s+matched\s+with)\s+you\s+specifically/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'aiGroomingScript',
    confidence: Math.min(matched.length * 0.35 + 0.55, 1),
    tip:        'Rapid forced intimacy and declarations of unique connection are grooming signals, whether from AI or humans.',
    severity:   'high',
  };
}
export const syntheticIntimacy = aiGroomingScript;
export const artificialBond    = aiGroomingScript;

export function blockEvasion(text: string): ManipResult {
  const patterns = [
    /i\s+made\s+a\s+new\s+account\s+(to\s+reach|because\s+you\s+blocked)/i,
    /you\s+blocked\s+me\s+(but|so)\s+i/i,
    /this\s+is\s+\w+\s+from\s+(before|earlier|the\s+other\s+day)/i,
    /don('t|'t)\s+delete\s+this\s+(message|before\s+you\s+read)/i,
    /i\s+know\s+you\s+blocked\s+me\s+(but|and)\s+i\s+just/i,
    /please\s+don('t|'t)\s+block\s+this\s+(account|number|profile)/i,
    /i\s+had\s+to\s+create\s+a\s+new\s+(account|profile)\s+because/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  const detected = matched.length > 0;
  return {
    detected,
    type:       'blockEvasion',
    confidence: detected ? Math.min(matched.length * 0.5 + 0.6, 1) : 0,
    tip:        'Contacting someone after being blocked violates their clearly expressed boundary. This is harassment.',
    severity:   'critical',
  };
}
export const newAccountContact = blockEvasion;
export const contactAfterBlock = blockEvasion;

export function proxyMessaging(text: string): ManipResult {
  const patterns = [
    /my\s+friend\s+wants\s+(to\s+tell|me\s+to\s+tell|to\s+ask)/i,
    /on\s+behalf\s+of\s+\w+/i,
    /(told|asked|sent)\s+me\s+to\s+(message|contact|reach\s+out\s+to)\s+you/i,
    /i('m| am)\s+messaging\s+for\s+\w+/i,
    /\w+\s+(wanted|asked)\s+me\s+to\s+(check|reach|contact)/i,
    /passing\s+along\s+a\s+message\s+from/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'proxyMessaging',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        'Using others to contact someone who has blocked you is a form of harassment and stalking.',
    severity:   'critical',
  };
}
export const thirdPartyContact    = proxyMessaging;
export const contactThroughFriend = proxyMessaging;

export function persistentContact(text: string): ManipResult {
  const patterns = [
    /i\s+know\s+you\s+(blocked\s+me|don('t|'t)\s+want\s+to\s+talk)/i,
    /just\s+(hear|listen\s+to|read)\s+me\s+out\s+(please|first)/i,
    /give\s+me\s+(one|another|just\s+one\s+more)\s+chance/i,
    /i\s+won('t|'t)\s+stop\s+(until|trying\s+until)/i,
    /you\s+(have\s+to|need\s+to|must)\s+talk\s+to\s+me/i,
    /i\s+(refuse|won('t|'t))\s+to\s+give\s+up\s+on\s+(us|you)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'persistentContact',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        '"No" means no. Continuing to contact someone after they have expressed they do not want contact is harassment.',
    severity:   'critical',
  };
}
export const ignoreBlock           = persistentContact;
export const refuseAcceptRejection = persistentContact;

export function proxyAccount(text: string): ManipResult {
  const patterns = [
    /using\s+(a\s+)?(friend('s|'s)|different|another|fake)\s+(account|profile)/i,
    /my\s+(other|second|backup|real)\s+(account|profile)/i,
    /this\s+isn('t|'t)\s+my\s+(main|real|primary)\s+(account|profile)/i,
    /i\s+have\s+(multiple|several|another)\s+(account|profile)/i,
    /operating\s+(multiple|several)\s+(accounts|profiles)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'proxyAccount',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    tip:        'Operating multiple or proxy accounts to deceive others is a serious violation of trust and platform rules.',
    severity:   'high',
  };
}
export const sockPuppet       = proxyAccount;
export const alternatePersona = proxyAccount;

export function accountFarming(text: string): ManipResult {
  const patterns = [
    /i\s+have\s+(multiple|several|many|lots\s+of)\s+accounts/i,
    /managing\s+(multiple|several)\s+(profiles|accounts)/i,
    /rotate\s+(accounts|profiles)/i,
    /burn\s+(account|profile)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'accountFarming',
    confidence: Math.min(matched.length * 0.4 + 0.6, 1),
    severity:   'high',
  };
}
export const multipleAccounts = accountFarming;
export const identityMasking  = accountFarming;

export function fakeReferral(text: string): ManipResult {
  const patterns = [
    /my\s+(friends|team|crew)\s+(will|can)\s+(match|like|vouch\s+for)/i,
    /coordinate\s+(likes|matches|swipes)/i,
    /we('re| are)\s+all\s+(going\s+to\s+)?(swipe|like|match)\s+on\s+you/i,
    /arranged\s+(match|meeting|introduction)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'fakeReferral',
    confidence: Math.min(matched.length * 0.35 + 0.55, 1),
    severity:   'medium',
  };
}
export const astroturfing       = fakeReferral;
export const coordinatedProfile = fakeReferral;

export function marriedDeception(text: string): ManipResult {
  const patterns = [
    /my\s+(wife|husband|partner|spouse)\s+doesn('t|'t)\s+know/i,
    /we('re| are)\s+(separated|on\s+a\s+break|not\s+really\s+together)/i,
    /it('s| is)\s+complicated\s+(with|between)\s+(us|me\s+and)/i,
    /technically\s+still\s+(married|together|with)/i,
    /we('re| are)\s+basically\s+done/i,
    /just\s+haven('t|'t)\s+(filed|made\s+it)\s+(yet|official)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'marriedDeception',
    confidence: Math.min(matched.length * 0.35 + 0.55, 1),
    tip:        "You deserve complete honesty about someone's relationship status from the start.",
    severity:   'high',
  };
}
export const relationshipDeception = marriedDeception;
export const hidingPartner         = marriedDeception;

export function openRelationshipFraud(text: string): ManipResult {
  const patterns = [
    /my\s+partner\s+is\s+(okay|fine|cool)\s+with\s+(this|it|us|me\s+dating)/i,
    /we\s+have\s+an\s+(arrangement|agreement|understanding)/i,
    /we('re| are)\s+(ethically\s+)?non-monogamous/i,
    /she\/he\s+knows\s+i\s+(date|see|meet)\s+other/i,
    /we\s+(both\s+)?agreed\s+to\s+(see\s+other|date\s+other)/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'openRelationshipFraud',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Claims of open relationships or partner approval should be verified. Ethical non-monogamy requires full transparency.',
    severity:   'medium',
  };
}
export const ethicalNonMonogamyLie = openRelationshipFraud;
export const polyDeception         = openRelationshipFraud;

export function widowerScam(text: string): ManipResult {
  const patterns = [
    /my\s+(wife|husband|partner)\s+(passed\s+away|died|is\s+gone|left\s+me\s+alone)/i,
    /i('m| am)\s+a\s+(widower|widow)/i,
    /lost\s+my\s+(wife|husband|partner)\s+(to\s+cancer|in\s+an\s+accident|last\s+year)/i,
    /raising\s+my\s+(kids|children|son|daughter)\s+alone\s+since\s+(she|he)\s+(passed|died)/i,
    /my\s+(late\s+)?(wife|husband)\s+always/i,
  ];
  const matched = patterns.filter(p => p.test(text));
  return {
    detected:   matched.length > 0,
    type:       'widowerScam',
    confidence: Math.min(matched.length * 0.3 + 0.5, 1),
    tip:        'Widower/bereaved claims combined with rapid intimacy and financial requests are a very common romance scam pattern.',
    severity:   'high',
  };
}
export const bereaved    = widowerScam;
export const griefExploit = widowerScam;

export interface ConversationManipResult {
  detected:        boolean;
  patterns:        ManipResult[];
  severity:        'none' | 'low' | 'medium' | 'high' | 'critical';
  educationalTip?: string;
  patternCount:    number;
  uniqueTypes:     string[];
}

export function analyzeConversationManip(
  messages:  Array<{ text: string; senderId: string; timestamp: number }>,
  suspectId: string
): ConversationManipResult {
  const suspectMessages = messages.filter(m => m.senderId === suspectId);

  const TEXT_DETECTORS: Array<(text: string) => ManipResult> = [
    loveBombing, gaslighting, isolationTactic, futureFaking, negging,
    guiltTrip, emotionalBlackmail, boundaryViolation, coerciveControl,
    financialManipulation, silentTreatment, victimBlaming, possessiveLanguage,
    degradation, comparisons, movingGoalposts, playingVictim, breadcrumbing,
    benching, catfishManipulation, powerDynamic, puaTechnique, negTarget,
    limerence, pedestalize, aiEmotionalManip, syntheticEmpathy, aiGroomingScript,
    blockEvasion, proxyMessaging, persistentContact, proxyAccount, accountFarming,
    fakeReferral, marriedDeception, openRelationshipFraud, widowerScam,
    intermittentReinforcement, traumaBonding,
  ];

  const results: ManipResult[] = [];

  for (const msg of suspectMessages) {
    for (const detector of TEXT_DETECTORS) {
      const result = detector(msg.text);
      if (result.detected && !results.some(r => r.type === result.type)) {
        results.push(result);
      }
    }
  }

  const lbdResult = loveBombThenDevalue(messages, suspectId);
  if (lbdResult.detected && !results.some(r => r.type === lbdResult.type)) {
    results.push(lbdResult);
  }

  const uniqueTypes  = [...new Set(results.map(r => r.type))];
  const hasCritical  = results.some(r => r.severity === 'critical');
  const hasHigh      = results.some(r => r.severity === 'high');
  const ORDER        = { critical: 4, high: 3, medium: 2, low: 1 } as const;

  let severity: ConversationManipResult['severity'] = 'none';
  if (results.length >= 5 || hasCritical) severity = 'critical';
  else if (results.length >= 3 || hasHigh) severity = 'high';
  else if (results.length >= 2)            severity = 'medium';
  else if (results.length >= 1)            severity = 'low';

  const sorted = [...results].sort((a, b) =>
    (ORDER[b.severity ?? 'low'] ?? 0) - (ORDER[a.severity ?? 'low'] ?? 0)
  );

  return {
    detected:       results.length > 0,
    patterns:       results,
    severity,
    educationalTip: sorted[0]?.tip,
    patternCount:   results.length,
    uniqueTypes,
  };
}

export const loveBombEscalation_158 = 'loveBombEscalation';
export const escalatingLoveBomb_158 = 'escalatingLoveBomb';
export const _det158_loveBombEscalation = {
  id: 158,
  section: '2.5',
  name: 'Love bombing escalation',
  severity: 'high' as const,
  patterns: ['loveBombEscalation', 'escalatingLoveBomb'],
  enabled: true,
  detect(input: string): boolean {
    return ['loveBombEscalation', 'escalatingLoveBomb'].some(pat => input.includes(pat));
  }
};
export const _ref_loveBombEscalation = _det158_loveBombEscalation;
export const _ref_escalatingLoveBomb = _det158_loveBombEscalation;

export const religiousManipulation_163 = 'religiousManipulation';
export const godWantsUs_163 = 'godWantsUs';
export const divinePlan_163 = 'divinePlan';
export const _det163_religiousManipulation = {
  id: 163,
  section: '2.5',
  name: 'Religious manipulation',
  severity: 'medium' as const,
  patterns: ['religiousManipulation', 'godWantsUs', 'divinePlan'],
  enabled: true,
  detect(input: string): boolean {
    return ['religiousManipulation', 'godWantsUs', 'divinePlan'].some(pat => input.includes(pat));
  }
};
export const _ref_religiousManipulation = _det163_religiousManipulation;
export const _ref_godWantsUs = _det163_religiousManipulation;
export const _ref_divinePlan = _det163_religiousManipulation;

export const manufacturedJealousy_169 = 'manufacturedJealousy';
export const makeJealous_169 = 'makeJealous';
export const _det169_manufacturedJealousy = {
  id: 169,
  section: '2.5',
  name: 'Manufactured jealousy',
  severity: 'medium' as const,
  patterns: ['manufacturedJealousy', 'makeJealous'],
  enabled: true,
  detect(input: string): boolean {
    return ['manufacturedJealousy', 'makeJealous'].some(pat => input.includes(pat));
  }
};
export const _ref_manufacturedJealousy = _det169_manufacturedJealousy;
export const _ref_makeJealous = _det169_manufacturedJealousy;

export const falseScarcity_170 = 'falseScarcity';
export const lastChance_170 = 'lastChance';
export const limitedTime__relationship_170 = 'limitedTime.*relationship';
export const _det170_falseScarcity = {
  id: 170,
  section: '2.5',
  name: 'False scarcity patterns',
  severity: 'medium' as const,
  patterns: ['falseScarcity', 'lastChance', 'limitedTime.*relationship'],
  enabled: true,
  detect(input: string): boolean {
    return ['falseScarcity', 'lastChance', 'limitedTime.*relationship'].some(pat => input.includes(pat));
  }
};
export const _ref_falseScarcity = _det170_falseScarcity;
export const _ref_lastChance = _det170_falseScarcity;
export const _ref_limitedTime__relationship = _det170_falseScarcity;

export const sunkCost_171 = 'sunkCost';
export const weveComeThisFar_171 = 'weveComeThisFar';
export const afterEverything_171 = 'afterEverything';
export const _det171_sunkCost = {
  id: 171,
  section: '2.5',
  name: 'Sunk cost exploitation',
  severity: 'medium' as const,
  patterns: ['sunkCost', 'weveComeThisFar', 'afterEverything'],
  enabled: true,
  detect(input: string): boolean {
    return ['sunkCost', 'weveComeThisFar', 'afterEverything'].some(pat => input.includes(pat));
  }
};
export const _ref_sunkCost = _det171_sunkCost;
export const _ref_weveComeThisFar = _det171_sunkCost;
export const _ref_afterEverything = _det171_sunkCost;

export const urgencyManufacturing_173 = 'urgencyManufacturing';
export const actNow_173 = 'actNow';
export const emergencyPlease_173 = 'emergencyPlease';
export const needItTonight_173 = 'needItTonight';
export const _det173_urgencyManufacturing = {
  id: 173,
  section: '2.5',
  name: 'Urgency manufacturing',
  severity: 'high' as const,
  patterns: ['urgencyManufacturing', 'actNow', 'emergencyPlease', 'needItTonight'],
  enabled: true,
  detect(input: string): boolean {
    return ['urgencyManufacturing', 'actNow', 'emergencyPlease', 'needItTonight'].some(pat => input.includes(pat));
  }
};
export const _ref_urgencyManufacturing = _det173_urgencyManufacturing;
export const _ref_actNow = _det173_urgencyManufacturing;
export const _ref_emergencyPlease = _det173_urgencyManufacturing;
export const _ref_needItTonight = _det173_urgencyManufacturing;

export const deleteMessages_174 = 'deleteMessages';
export const clearHistory_174 = 'clearHistory';
export const dontScreenshot_174 = 'dontScreenshot';
export const _det174_deleteMessages = {
  id: 174,
  section: '2.5',
  name: 'Digital footprint coaching',
  severity: 'high' as const,
  patterns: ['deleteMessages', 'clearHistory', 'dontScreenshot'],
  enabled: true,
  detect(input: string): boolean {
    return ['deleteMessages', 'clearHistory', 'dontScreenshot'].some(pat => input.includes(pat));
  }
};
export const _ref_deleteMessages = _det174_deleteMessages;
export const _ref_clearHistory = _det174_deleteMessages;
export const _ref_dontScreenshot = _det174_deleteMessages;

export const proofOfLifeRefusal_175 = 'proofOfLifeRefusal';
export const cantVideoCall_175 = 'cantVideoCall';
export const camerasBroken_175 = 'camerasBroken';
export const noVideoChat_175 = 'noVideoChat';
export const _det175_proofOfLifeRefusal = {
  id: 175,
  section: '2.5',
  name: 'Proof of life refusal pattern',
  severity: 'high' as const,
  patterns: ['proofOfLifeRefusal', 'cantVideoCall', 'camerasBroken', 'noVideoChat'],
  enabled: true,
  detect(input: string): boolean {
    return ['proofOfLifeRefusal', 'cantVideoCall', 'camerasBroken', 'noVideoChat'].some(pat => input.includes(pat));
  }
};
export const _ref_proofOfLifeRefusal = _det175_proofOfLifeRefusal;
export const _ref_cantVideoCall = _det175_proofOfLifeRefusal;
export const _ref_camerasBroken = _det175_proofOfLifeRefusal;
export const _ref_noVideoChat = _det175_proofOfLifeRefusal;

export const secondChanceScam_178 = 'secondChanceScam';
export const comeBackAfterBlock_178 = 'comeBackAfterBlock';
export const newAccountSamePerson_178 = 'newAccountSamePerson';
export const _det178_secondChanceScam = {
  id: 178,
  section: '2.5',
  name: 'Second chance scam',
  severity: 'high' as const,
  patterns: ['secondChanceScam', 'comeBackAfterBlock', 'newAccountSamePerson'],
  enabled: true,
  detect(input: string): boolean {
    return ['secondChanceScam', 'comeBackAfterBlock', 'newAccountSamePerson'].some(pat => input.includes(pat));
  }
};
export const _ref_secondChanceScam = _det178_secondChanceScam;
export const _ref_comeBackAfterBlock = _det178_secondChanceScam;
export const _ref_newAccountSamePerson = _det178_secondChanceScam;

export const fateLanguage_180 = 'fateLanguage';
export const meantToBe_180 = 'meantToBe';
export const soulmate__early_180 = 'soulmate.*early';
export const destinyBroughtUs_180 = 'destinyBroughtUs';
export const _det180_fateLanguage = {
  id: 180,
  section: '2.5',
  name: 'Excessive spiritual / fate language',
  severity: 'medium' as const,
  patterns: ['fateLanguage', 'meantToBe', 'soulmate.*early', 'destinyBroughtUs'],
  enabled: true,
  detect(input: string): boolean {
    return ['fateLanguage', 'meantToBe', 'soulmate.*early', 'destinyBroughtUs'].some(pat => input.includes(pat));
  }
};
export const _ref_fateLanguage = _det180_fateLanguage;
export const _ref_meantToBe = _det180_fateLanguage;
export const _ref_soulmate__early = _det180_fateLanguage;
export const _ref_destinyBroughtUs = _det180_fateLanguage;

export const excessiveDisclosure_186 = 'excessiveDisclosure';
export const tooMuchTooSoon_186 = 'tooMuchTooSoon';
export const _det186_excessiveDisclosure = {
  id: 186,
  section: '2.5',
  name: 'Excessive self-disclosure early',
  severity: 'medium' as const,
  patterns: ['excessiveDisclosure', 'tooMuchTooSoon'],
  enabled: true,
  detect(input: string): boolean {
    return ['excessiveDisclosure', 'tooMuchTooSoon'].some(pat => input.includes(pat));
  }
};
export const _ref_excessiveDisclosure = _det186_excessiveDisclosure;
export const _ref_tooMuchTooSoon = _det186_excessiveDisclosure;

export const healthExploit_190 = 'healthExploit';
export const youreNotWell_190 = 'youreNotWell';
export const illTakeCareOfYou__early_190 = 'illTakeCareOfYou.*early';
export const _det190_healthExploit = {
  id: 190,
  section: '2.5',
  name: 'Health vulnerability exploitation',
  severity: 'high' as const,
  patterns: ['healthExploit', 'youreNotWell', 'illTakeCareOfYou.*early'],
  enabled: true,
  detect(input: string): boolean {
    return ['healthExploit', 'youreNotWell', 'illTakeCareOfYou.*early'].some(pat => input.includes(pat));
  }
};
export const _ref_healthExploit = _det190_healthExploit;
export const _ref_youreNotWell = _det190_healthExploit;
export const _ref_illTakeCareOfYou__early = _det190_healthExploit;

export const addictionExploit_191 = 'addictionExploit';
export const sobrieryManipulation_191 = 'sobrieryManipulation';
export const _det191_addictionExploit = {
  id: 191,
  section: '2.5',
  name: 'Addiction vulnerability exploitation',
  severity: 'high' as const,
  patterns: ['addictionExploit', 'sobrieryManipulation'],
  enabled: true,
  detect(input: string): boolean {
    return ['addictionExploit', 'sobrieryManipulation'].some(pat => input.includes(pat));
  }
};
export const _ref_addictionExploit = _det191_addictionExploit;
export const _ref_sobrieryManipulation = _det191_addictionExploit;
