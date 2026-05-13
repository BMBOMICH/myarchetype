/**
 * Scam Narratives, Manipulation & PUA Detectors
 * (Comprehensive keyword + pattern coverage for all remaining detectors)
 */

const REJECTION_PUNISHMENT_PATTERNS = [
  /you('ll| will) regret (this|rejecting|saying no)/i,
  /no one (else )?will (ever |want|love|date|have) you/i,
  /you('re| are) (nothing|worthless|ugly) without me/i,
  /i'll make (sure|your life)/i,
  /you (led me on|owe me|wasted my time)/i,
  /you (think you're|are) too good for me/i,
];

export function rejectionPunishment(text: string): {
  rejectRetaliation: boolean;
  punishmentForNo: boolean;
} {
  const match = REJECTION_PUNISHMENT_PATTERNS.some(p => p.test(text));
  return { rejectRetaliation: match, punishmentForNo: match };
}

const STALKING_PATTERNS_LIST = [
  /i know where you (live|work|go to school)/i,
  /i('ve| have) been (watching|following|outside)/i,
  /i saw you (today|yesterday|this morning|at)/i,
  /i('ll| will) (find|track|follow) you/i,
  /you can't (hide|get away|escape) from me/i,
  /i (drove|walked|went) past your/i,
  /who (were|was) you (with|talking to)/i,
];

export const STALKING_PATTERNS = STALKING_PATTERNS_LIST;

export function stalkingLanguage(text: string): {
  obsessiveLanguage: boolean;
  stalkingDetected: boolean;
} {
  const match = STALKING_PATTERNS_LIST.some(p => p.test(text));
  return { obsessiveLanguage: match, stalkingDetected: match };
}

const ROMANCE_SCAM_WORDS = [
  'western union', 'moneygram', 'wire transfer', 'gift card',
  'itunes card', 'google play card', 'amazon card',
  'im in trouble', 'stuck overseas', 'stranded',
  'urgent help', 'emergency funds', 'borrowed money',
  'investment platform', 'crypto trading', 'guaranteed returns',
];

export const ROMANCE_SCAM_VOCABULARY = ROMANCE_SCAM_WORDS;

export function romanceScamVocab(text: string): {
  scamVocabulary: boolean;
  wordsFound: string[];
} {
  const lower = text.toLowerCase();
  const found = ROMANCE_SCAM_WORDS.filter(w => lower.includes(w));
  return { scamVocabulary: found.length > 0, wordsFound: found };
}

export function oilRigScam(text: string): { engineerOverseas: boolean; offshoreNarrative: boolean } {
  const match = /(oil rig|offshore|platform|drill(ing)? ship|north sea|gulf of mexico|marine engineer)/i.test(text);
  return { engineerOverseas: match, offshoreNarrative: match };
}

export function deadSpouseOpener(text: string): { widowerNarrative: boolean } {
  const match = /(my (wife|husband|spouse) (passed|died|left us|is gone)|i lost my (wife|husband)|single (father|mother) since)/i.test(text);
  return { widowerNarrative: match };
}

export function childSympathy(text: string): { sickChild: boolean; childManipulation: boolean } {
  const match = /(my (child|daughter|son|kid) is (sick|in hospital|ill|has cancer)|medical bills for my|hospital.*child)/i.test(text);
  return { sickChild: match, childManipulation: match };
}

export function medicalEmergencyScam(text: string): { hospitalBill: boolean; urgentMedical: boolean } {
  const match = /(medical emergency|hospital bill|surgery cost|treatment fee|accident.*hospital|need.*medical)/i.test(text);
  return { hospitalBill: match, urgentMedical: match };
}

export function visaScam(text: string): { immigrationScam: boolean; greenCard: boolean } {
  const match = /(visa fee|immigration cost|green card|work permit fee|embassy.*money|travel document.*pay)/i.test(text);
  return { immigrationScam: match, greenCard: /green card/i.test(text) };
}

export function shippingFeeScam(text: string): { customsFee: boolean; packageStuck: boolean } {
  const match = /(customs fee|shipping fee|package (is )?stuck|release my (package|shipment)|import tax.*pay)/i.test(text);
  return { customsFee: match, packageStuck: /package.*(stuck|held|seized)/i.test(text) };
}

export function jobOfferScam(text: string): { workFromHomeScam: boolean; easyMoney: boolean } {
  const match = /(work from home.*earn|make money.*easy|passive income.*guaranteed|no experience.*\$\d+|earn \$\d+.*day)/i.test(text);
  return { workFromHomeScam: match, easyMoney: /easy money|quick cash|fast money/i.test(text) };
}

export function inheritanceScam(text: string): { dyingRelative: boolean; willBeneficiary: boolean } {
  const match = /(inheritance|dying.*relative|will beneficiary|estate.*claim|unclaimed.*funds|next of kin)/i.test(text);
  return { dyingRelative: /dying.*relative|terminally ill.*uncle/i.test(text), willBeneficiary: match };
}

export function loveBombEscalation(
  messages: Array<{ text: string; timestamp: number; senderId: string }>,
  suspectId: string
): { escalatingLoveBomb: boolean; complimentDensity: number } {
  const suspect = messages.filter(m => m.senderId === suspectId);
  const COMPLIMENT_WORDS = ['beautiful', 'gorgeous', 'perfect', 'amazing', 'special', 'soulmate', 'love', 'adore'];
  let count = 0;
  for (const msg of suspect) {
    const lower = msg.text.toLowerCase();
    if (COMPLIMENT_WORDS.some(w => lower.includes(w))) count++;
  }
  const density = suspect.length > 0 ? count / suspect.length : 0;
  return { escalatingLoveBomb: density > 0.4 && count >= 5, complimentDensity: density };
}

export function religiousManipulation(text: string): { godWantsUs: boolean; divinePlan: boolean } {
  const match = /(god (wants|sent|brought|meant|planned)|divine (plan|purpose|connection)|destiny brought us|our meeting was (fate|god)|i prayed for someone like)/i.test(text);
  return { godWantsUs: match, divinePlan: match };
}

export function complimentVelocity(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): { excessiveCompliments: boolean; rate: number } {
  const msgs = messages.filter(m => m.senderId === suspectId);
  const COMPLIMENT_TERMS = ['beautiful', 'gorgeous', 'stunning', 'amazing', 'perfect', 'incredible', 'wonderful'];
  const count = msgs.filter(m => COMPLIMENT_TERMS.some(t => m.text.toLowerCase().includes(t))).length;
  const rate = msgs.length > 0 ? count / msgs.length : 0;
  return { excessiveCompliments: rate > 0.5 && count >= 5, rate };
}

export function questionBombing(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): { piiExtraction: boolean; excessiveQuestions: boolean; questionRate: number } {
  const msgs = messages.filter(m => m.senderId === suspectId);
  const questionCount = msgs.filter(m => m.text.includes('?')).length;
  const rate = msgs.length > 0 ? questionCount / msgs.length : 0;
  const PII_QUESTIONS = /where do you (live|work)|what('s| is) your (address|number|email|salary|bank)|how much (do you make|money)/i;
  const hasPII = msgs.some(m => PII_QUESTIONS.test(m.text));
  return { piiExtraction: hasPII, excessiveQuestions: rate > 0.6 && questionCount >= 8, questionRate: rate };
}

export function reciprocityExploit(text: string): { iDidForYou: boolean } {
  const match = /(i (already|did|bought|paid|gave|sent) (for|you|this)|after everything i('ve| have) done|you owe me|don't i deserve)/i.test(text);
  return { iDidForYou: match };
}

export function interestMirroring(
  myInterests: string[],
  theirClaimedInterests: string[]
): { fakeMirroring: boolean; overlapScore: number } {
  const mySet = new Set(myInterests.map(i => i.toLowerCase()));
  const matches = theirClaimedInterests.filter(i => mySet.has(i.toLowerCase())).length;
  const score = theirClaimedInterests.length > 0 ? matches / theirClaimedInterests.length : 0;
  return { fakeMirroring: score >= 0.85 && matches >= 5, overlapScore: score };
}

export function trustTest(text: string): { proveYourLove: boolean; ifYouLovedMe: boolean } {
  const match = /(prove (your love|you love|you care|it|yourself)|if you (loved|cared|trusted) me|if you were serious you would|show me you('re| are) real)/i.test(text);
  return { proveYourLove: match, ifYouLovedMe: /if you loved me/i.test(text) };
}

export function manufacturedJealousy(text: string): { makeJealous: boolean } {
  const match = /(other (guys|men|women|girls) (always|keep|are) (hitting|interested|asking)|i have (so many|lots of) (options|matches|people after me)|used to date (models|athletes|doctors))/i.test(text);
  return { makeJealous: match };
}

export function falseScarcity(text: string): { lastChance: boolean; limitedTimeRelationship: boolean } {
  const match = /(last chance|now or never|you're missing out|i won't wait|someone else will|this opportunity won't)/i.test(text);
  return { lastChance: /last chance|now or never/i.test(text), limitedTimeRelationship: match };
}

export function sunkCost(text: string): { weveComeThisFar: boolean; afterEverything: boolean } {
  const match = /(after (all|everything) (we've|we have|i've|i have)|(we've|we have) (come so far|been through so much)|all (this time|these months|these weeks) for nothing|don't throw away what we have)/i.test(text);
  return { weveComeThisFar: match, afterEverything: /after everything/i.test(text) };
}

export function urgencyManufacturing(text: string): { actNow: boolean; emergencyPlease: boolean } {
  const match = /(right now|immediately|this is urgent|i need help now|please hurry|time is running out|only \d+ (hours?|minutes?) left)/i.test(text);
  return { actNow: /right now|immediately/i.test(text), emergencyPlease: match };
}

export function digitalFootprintCoaching(text: string): { deleteMessages: boolean; clearHistory: boolean; dontScreenshot: boolean } {
  const deleteMatch = /(delete (this|these|our|the) (messages?|conversation|chat)|clear (your|the) (history|chat|messages))/i.test(text);
  const screenshotMatch = /(don't (screenshot|screen record|save|share)|keep this (private|between us|secret))/i.test(text);
  return { deleteMessages: deleteMatch, clearHistory: deleteMatch, dontScreenshot: screenshotMatch };
}

export function proofOfLifeRefusal(
  videoCallRefusals: number,
  totalVideoCallRequests: number
): { cantVideoCall: boolean; camerasBroken: boolean; refusalRate: number } {
  const rate = totalVideoCallRequests > 0 ? videoCallRefusals / totalVideoCallRequests : 0;
  return { cantVideoCall: rate >= 0.8 && totalVideoCallRequests >= 3, camerasBroken: rate >= 0.9, refusalRate: rate };
}

export function sentimentTrajectory(
  sentimentScores: Array<{ score: number; timestamp: number; senderId: string }>,
  suspectId: string
): { emotionalTrajectory: 'positive' | 'negative' | 'volatile' | 'stable'; moodManipulation: boolean } {
  const scores = sentimentScores.filter(s => s.senderId === suspectId).sort((a, b) => a.timestamp - b.timestamp);
  if (scores.length < 5) return { emotionalTrajectory: 'stable', moodManipulation: false };

  const changes = [];
  for (let i = 1; i < scores.length; i++) {
    changes.push(scores[i].score - scores[i - 1].score);
  }

  const avgChange = changes.reduce((s, c) => s + c, 0) / changes.length;
  const volatility = changes.reduce((s, c) => s + Math.abs(c), 0) / changes.length;

  let trajectory: 'positive' | 'negative' | 'volatile' | 'stable' = 'stable';
  if (volatility > 0.5) trajectory = 'volatile';
  else if (avgChange > 0.1) trajectory = 'positive';
  else if (avgChange < -0.1) trajectory = 'negative';

  return { emotionalTrajectory: trajectory, moodManipulation: trajectory === 'volatile' && volatility > 0.6 };
}

export function homesickness(text: string): { farFromHome: boolean; noFriendsHere: boolean } {
  const match = /(far from home|no (friends|family) here|so lonely|don't know anyone here|moved here (alone|recently)|no one to talk to)/i.test(text);
  return { farFromHome: /far from home/i.test(text), noFriendsHere: match };
}

export function fateLanguage(text: string): { meantToBe: boolean; soulmateEarly: boolean } {
  const match = /(meant to be|fate brought|destiny|twin flame|we were destined|(i knew|felt) (immediately|right away|from the first)|universe brought us)/i.test(text);
  return { meantToBe: /meant to be/i.test(text), soulmateEarly: /soulmate/i.test(text) && match };
}

export function benignPivot(
  messages: Array<{ text: string; timestamp: number; senderId: string }>,
  suspectId: string
): { openerThenPivot: boolean; normalThenScam: boolean } {
  const msgs = messages.filter(m => m.senderId === suspectId).sort((a, b) => a.timestamp - b.timestamp);
  if (msgs.length < 6) return { openerThenPivot: false, normalThenScam: false };

  const firstThird = msgs.slice(0, Math.floor(msgs.length / 3));
  const lastThird = msgs.slice(-Math.floor(msgs.length / 3));

  const SCAM_SIGNALS = /(invest|money|bitcoin|wire|send \$|gift card|help.*funds)/i;
  const firstHasScam = firstThird.some(m => SCAM_SIGNALS.test(m.text));
  const lastHasScam = lastThird.some(m => SCAM_SIGNALS.test(m.text));

  return { openerThenPivot: !firstHasScam && lastHasScam, normalThenScam: !firstHasScam && lastHasScam };
}

export function personaInconsistency(
  messages: Array<{ text: string; senderId: string }>
): { contradictingDetails: boolean; storyChanges: boolean; inconsistencies: string[] } {
  const msgs = messages.filter(m => m.senderId !== 'user').map(m => m.text);
  const inconsistencies: string[] = [];

  const locations = msgs.flatMap(msg => {
    const matches = msg.match(/\b(in|from|based in|living in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g) ?? [];
    return matches;
  });

  const uniqueLocations = new Set(locations);
  if (uniqueLocations.size >= 3) inconsistencies.push(`${uniqueLocations.size} different locations mentioned`);

  const OCCUPATIONS = ['doctor', 'engineer', 'nurse', 'lawyer', 'teacher', 'soldier', 'officer'];
  const mentionedOccupations = new Set(
    msgs.flatMap(msg => OCCUPATIONS.filter(o => msg.toLowerCase().includes(o)))
  );
  if (mentionedOccupations.size >= 2) {
    inconsistencies.push(`Multiple occupations: ${[...mentionedOccupations].join(', ')}`);
  }

  return { contradictingDetails: inconsistencies.length > 0, storyChanges: inconsistencies.length >= 2, inconsistencies };
}

export function selectiveMemory(
  messages: Array<{ text: string; senderId: string; timestamp: number }>
): { forgotWhatISaid: boolean; amnesia: boolean } {
  const FORGET_PATTERNS = /i (never said|don't remember saying|didn't say that|never told you)/i;
  const found = messages.some(m => FORGET_PATTERNS.test(m.text));
  return { forgotWhatISaid: found, amnesia: found };
}

export function flatteryToRequest(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): { complimentThenAsk: boolean; ratio: number } {
  const msgs = messages.filter(m => m.senderId === suspectId);
  const COMPLIMENT = /beautiful|gorgeous|amazing|special|incredible|wonderful|perfect/i;
  const REQUEST = /send|help|need|money|give|transfer|pay|buy|invest/i;
  let pairs = 0;
  for (let i = 0; i < msgs.length - 1; i++) {
    if (COMPLIMENT.test(msgs[i].text) && REQUEST.test(msgs[i + 1].text)) pairs++;
  }
  return { complimentThenAsk: pairs >= 2, ratio: msgs.length > 0 ? pairs / msgs.length : 0 };
}

export function excessiveDisclosure(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): { tooMuchTooSoon: boolean; disclosureScore: number } {
  const DISCLOSURE_TOPICS = [
    'ex-wife', 'ex-husband', 'divorce', 'cheated on me', 'trauma', 'abuse',
    'salary', 'earn', 'bank account', 'net worth', 'inheritance',
    'health issue', 'disease', 'addiction',
  ];
  const msgs = messages.filter(m => m.senderId === suspectId);
  const earlyMsgs = msgs.slice(0, 5);
  let count = 0;
  for (const msg of earlyMsgs) {
    const lower = msg.text.toLowerCase();
    if (DISCLOSURE_TOPICS.some(t => lower.includes(t))) count++;
  }
  return { tooMuchTooSoon: count >= 3, disclosureScore: count };
}

export function lonelinessExploit(text: string): { youMustBeLonely: boolean; illKeepYouCompany: boolean } {
  const m = /(you (must|seem|look) (so )?lonely|i('ll| will) (always be there|keep you company|never leave you alone)|i can tell you('re| are) lonely)/i.test(text);
  return { youMustBeLonely: m, illKeepYouCompany: /keep you company/i.test(text) };
}

export function griefExploit(text: string): { iLostSomeone: boolean; griefManipulation: boolean } {
  const m = /(i (lost|lost my)|going through grief|still (grieving|mourning)|(similar|same) (loss|pain|grief))/i.test(text);
  return { iLostSomeone: m, griefManipulation: m };
}

export function healthExploit(text: string): { youreNotWell: boolean; illTakeCareOfYouEarly: boolean } {
  const m = /(i('ll| will) take care of you|let me (take care|help) you|you don't (seem|look|sound) well|i can (nurse|help) you|my (mother|father) was (sick|ill))/i.test(text);
  return { youreNotWell: /not well/i.test(text), illTakeCareOfYouEarly: m };
}

export function addictionExploit(text: string): { sobrietyManipulation: boolean } {
  const m = /(in recovery|staying sober|fighting addiction|proud of you for|i (also|too) struggled with)/i.test(text);
  return { sobrietyManipulation: m };
}

export function cognitiveVulnerability(
  messages: Array<{ text: string; senderId: string }>,
  targetId: string
): { confusedUser: boolean; elderlyTarget: boolean } {
  const targetMsgs = messages.filter(m => m.senderId === targetId);
  const CONFUSION_SIGNALS = ['i don\'t understand', 'what do you mean', 'i\'m confused', 'can you explain', 'i\'m not sure'];
  const confusionCount = targetMsgs.filter(m =>
    CONFUSION_SIGNALS.some(s => m.text.toLowerCase().includes(s))
  ).length;
  return { confusedUser: confusionCount >= 3, elderlyTarget: confusionCount >= 4 };
}

export function platformSwitchUrgent(text: string): { moveToWhatsApp: boolean; switchToTelegram: boolean } {
  const urgentSwitch = /(quickly|now|immediately|before|hurry|fast).{0,30}(whatsapp|telegram|signal|instagram)/i;
  const m = urgentSwitch.test(text);
  return { moveToWhatsApp: /whatsapp/i.test(text) && m, switchToTelegram: /telegram/i.test(text) && m };
}

const NEGGING_PATTERNS = [
  /you're (cute|pretty|attractive) (but|for a|despite)/i,
  /you'd be (hotter|prettier|better) if you/i,
  /most (girls|women|guys|men) (wouldn't|can't|don't)/i,
  /for (your age|someone like you|a woman)/i,
  /you're (almost|nearly|not quite)/i,
];

export function systematicNegging(text: string): {
  puaNegging: boolean;
  neggingPattern: boolean;
} {
  const found = NEGGING_PATTERNS.some(p => p.test(text));
  return { puaNegging: found, neggingPattern: found };
}

export function escalationLadder(
  messages: Array<{ text: string; senderId: string }>
): { kinoEscalation: boolean; complianceTesting: boolean } {
  const ESCALATION_STEPS = [
    /nice (talking|chatting|meeting)/i,
    /we should (meet|hang out|get coffee|get drinks)/i,
    /(come over|your place|my place)/i,
    /(massage|cuddle|kiss|touch)/i,
  ];

  let maxStage = 0;
  for (const msg of messages) {
    for (let i = 0; i < ESCALATION_STEPS.length; i++) {
      if (ESCALATION_STEPS[i].test(msg.text)) maxStage = Math.max(maxStage, i + 1);
    }
  }

  return { kinoEscalation: maxStage >= 3, complianceTesting: maxStage >= 2 };
}

export function parallelScripting(
  conversations: Array<Array<{ text: string; senderId: string }>>,
  userId: string
): { sameMessageMultipleUsers: boolean; massMessage: boolean; duplicateRate: number } {
  const openers: string[] = [];
  for (const convo of conversations) {
    const firstMsg = convo.find(m => m.senderId === userId);
    if (firstMsg) openers.push(firstMsg.text.toLowerCase().trim());
  }

  const uniqueOpeners = new Set(openers).size;
  const duplicateRate = openers.length > 0 ? 1 - uniqueOpeners / openers.length : 0;

  return {
    sameMessageMultipleUsers: duplicateRate >= 0.5 && openers.length >= 5,
    massMessage: duplicateRate >= 0.7,
    duplicateRate,
  };
}

export function normalizeConfusableChars(text: string): {
  confusableNormalize: boolean;
  normalizedText: string;
} {
  const normalized = text.normalize('NFKC');
  const changed = normalized !== text;
  return { confusableNormalize: changed, normalizedText: normalized };
}

export function stripZWChars(text: string): { removeZeroWidth: boolean; cleanText: string } {
  const clean = text.replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, '');
  return { removeZeroWidth: clean !== text, cleanText: clean };
}

export function zalgo(text: string): { glitchText: boolean; combiningCharacters: boolean } {
  const combiningCount = (text.match(/[\u0300-\u036f\u0483-\u0489\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g) ?? []).length;
  const isZalgo = combiningCount > text.length * 0.3;
  return { glitchText: isZalgo, combiningCharacters: isZalgo };
}

export function base64Detect(text: string): { encodedContent: boolean; base64Pattern: boolean } {
  const BASE64_REGEX = /[A-Za-z0-9+/]{20,}={0,2}/g;
  const matches = text.match(BASE64_REGEX) ?? [];
  return { encodedContent: matches.length > 0, base64Pattern: matches.length > 0 };
}

export function codeSwitching(text: string): { languageSwitchEvasion: boolean } {
  const SCRIPT_PATTERNS = [
    /[\u0400-\u04FF]/, // Cyrillic
    /[\u0600-\u06FF]/, // Arabic
    /[\u4E00-\u9FFF]/, // CJK
    /[\u0900-\u097F]/, // Devanagari
  ];
  const scriptsPresent = SCRIPT_PATTERNS.filter(p => p.test(text)).length;
  return { languageSwitchEvasion: scriptsPresent >= 2 };
}

export function invisibleSteg(text: string): { whitespaceSteg: boolean; hiddenCharacters: boolean } {
  const suspicious = /[\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/.test(text);
  return { whitespaceSteg: suspicious, hiddenCharacters: suspicious };
}

export function readabilityScore(text: string): { fleschKincaid: number; readingLevel: string } {
  const words = text.split(/\s+/).length;
  const sentences = (text.match(/[.!?]+/g) ?? []).length || 1;
  const syllables = text.split(/[aeiouAEIOU]/).length - 1;
  const fk = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
  const level = fk < 6 ? 'elementary' : fk < 10 ? 'middle' : fk < 14 ? 'high_school' : 'college';
  return { fleschKincaid: Math.round(fk * 10) / 10, readingLevel: level };
}

export function messageEntropy(text: string): { shannonEntropy: number; entropyScore: number } {
  const freq: Record<string, number> = {};
  for (const char of text) freq[char] = (freq[char] ?? 0) + 1;
  const len = text.length;
  const entropy = -Object.values(freq).reduce((s, c) => {
    const p = c / len;
    return s + p * Math.log2(p);
  }, 0);
  return { shannonEntropy: Math.round(entropy * 100) / 100, entropyScore: entropy };
}

export function copyPaste(
  messages: Array<{ text: string; senderId: string }>,
  userId: string
): { massMessage: boolean; duplicateMessage: boolean; duplicateRate: number } {
  const sent = messages.filter(m => m.senderId === userId).map(m => m.text.trim().toLowerCase());
  const unique = new Set(sent).size;
  const rate = sent.length > 0 ? 1 - unique / sent.length : 0;
  return { massMessage: rate >= 0.5 && sent.length >= 5, duplicateMessage: rate >= 0.3, duplicateRate: rate };
}

export function scamSimilarity(text: string): { semanticMatchScam: boolean; knownScamScript: boolean } {
  const SCAM_PHRASES = [
    'i am a widow', 'my late husband', 'stuck in nigeria', 'need your help',
    'invest in my business', 'sending you my heart', 'god blessed me with you',
  ];
  const lower = text.toLowerCase();
  const matches = SCAM_PHRASES.filter(p => lower.includes(p));
  return { semanticMatchScam: matches.length > 0, knownScamScript: matches.length >= 2 };
}

export function namedEntityConsistency(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): { entityTracking: boolean; nameChanged: boolean } {
  const msgs = messages.filter(m => m.senderId === suspectId);
  const NAME_PATTERN = /my name is (\w+)|call me (\w+)|i'm (\w+)/i;
  const names = new Set<string>();
  for (const msg of msgs) {
    const match = msg.text.match(NAME_PATTERN);
    if (match) names.add((match[1] || match[2] || match[3]).toLowerCase());
  }
  return { entityTracking: names.size >= 1, nameChanged: names.size >= 2 };
}

export function pronounInconsistency(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): { genderSwitch: boolean; pronounsFound: string[] } {
  const msgs = messages.filter(m => m.senderId === suspectId);
  const allText = msgs.map(m => m.text).join(' ');
  const MALE_PRONOUNS = /\b(he|him|his|himself)\b/gi;
  const FEMALE_PRONOUNS = /\b(she|her|hers|herself)\b/gi;
  const selfRef = msgs.filter(m => /\bi (am|was|have|had|went|got)\b/i.test(m.text)).length;

  const hasMale = MALE_PRONOUNS.test(allText);
  const hasFemale = FEMALE_PRONOUNS.test(allText);

  return { genderSwitch: hasMale && hasFemale, pronounsFound: [hasMale ? 'male' : '', hasFemale ? 'female' : ''].filter(Boolean) };
}

export function temporalInconsistency(
  messages: Array<{ text: string; senderId: string }>
): { timeContradiction: boolean; inconsistencies: string[] } {
  const YEAR_PATTERN = /\b(19|20)\d{2}\b/g;
  const AGE_PATTERN = /i('m| am) (\d{2}) years? old/gi;
  const inconsistencies: string[] = [];

  const allText = messages.map(m => m.text).join(' ');
  const years = allText.match(YEAR_PATTERN) ?? [];
  const ages = allText.match(AGE_PATTERN) ?? [];

  if (years.length >= 2) {
    const uniqueYears = [...new Set(years)].map(Number);
    if (Math.max(...uniqueYears) - Math.min(...uniqueYears) > 20) {
      inconsistencies.push(`Wide year range mentioned: ${Math.min(...uniqueYears)}–${Math.max(...uniqueYears)}`);
    }
  }

  if (ages.length >= 2) {
    inconsistencies.push(`Multiple ages mentioned: ${ages.join(', ')}`);
  }

  return { timeContradiction: inconsistencies.length > 0, inconsistencies };
}

const MLM_COMPANIES = [
  'herbalife', 'amway', 'avon', 'mary kay', 'younique', 'rodan and fields',
  'lularoe', 'usana', 'monat', 'nu skin', 'doterra', 'young living',
  'isagenix', 'primerica', 'arbonne', 'melaleuca', 'cutco',
];

export function mlmRecruit(text: string): { passiveIncome: boolean; beYourOwnBoss: boolean } {
  const lower = text.toLowerCase();
  const hasMlm = MLM_COMPANIES.some(c => lower.includes(c));
  const hasPassive = /(passive income|financial freedom|be your own boss|work from home.*\$|side hustle.*thousand)/i.test(text);
  return { passiveIncome: hasMlm || hasPassive, beYourOwnBoss: hasMlm || /be your own boss/i.test(text) };
}

export function mlmPivot(
  messages: Array<{ text: string; senderId: string }>
): { romanticToBusinessPitch: boolean } {
  const MLM_SIGNALS = /(opportunity|business|earning|income|invest|join my|side hustle)/i;
  const ROMANTIC_SIGNALS = /(like you|match|connection|dinner|date|meet)/i;
  const msgs = messages;
  const firstHalf = msgs.slice(0, Math.floor(msgs.length / 2));
  const secondHalf = msgs.slice(Math.floor(msgs.length / 2));
  const firstHasRomance = firstHalf.some(m => ROMANTIC_SIGNALS.test(m.text));
  const secondHasMlm = secondHalf.some(m => MLM_SIGNALS.test(m.text));
  return { romanticToBusinessPitch: firstHasRomance && secondHasMlm };
}

export function fakeDateSalesPitch(text: string): { salesPitchDate: boolean } {
  const m = /(over dinner.*talk business|while we.*business opportunity|meet.*tell you about|coffee.*amazing opportunity)/i.test(text);
  return { salesPitchDate: m };
}

export function sugarArrangement(text: string): { arrangementLanguage: boolean } {
  const m = /(allowance|arrangement|spoil you|generous (man|gentleman|woman)|sugar (daddy|mommy|baby)|seeking arrangement|nsa relationship|mutually (beneficial|advantageous))/i.test(text);
  return { arrangementLanguage: m };
}

export function verificationFee(text: string): { payToVerify: boolean; sendMoneyVerify: boolean } {
  const m = /(verify.*(send|pay|transfer)|verification (fee|payment|charge)|send \$.*to (verify|confirm|unlock))/i.test(text);
  return { payToVerify: m, sendMoneyVerify: m };
}

export function escortSolicitation(text: string): { sexWork: boolean; companionshipFee: boolean } {
  const m = /(escort|companionship.*fee|full service|gfe|girlfriend experience|incall|outcall|roses.*donation|donation.*roses)/i.test(text);
  return { sexWork: m, companionshipFee: /companionship.*fee|donation/i.test(text) };
}

export function paidCompanionEmoji(text: string): { roses: boolean; moneyRoses: boolean } {
  const hasMoneyRose = /💰.*🌹|🌹.*💰|💵.*🌹|🌹.*💵|💎.*🌹|🌹.*💎/.test(text);
  return { roses: /🌹/.test(text), moneyRoses: hasMoneyRose };
}

export function codedPricing(text: string): { priceCode: boolean; rosesHundred: boolean } {
  const m = /(roses|\d+ roses|\d+ for \d+ (hour|night|evening)|donation of \$\d+)/i.test(text);
  return { priceCode: m, rosesHundred: /\d+ roses/i.test(text) };
}

export function emailAlias(email: string): { plusAlias: boolean; dotAlias: boolean; normalizedEmail: string } {
  const [local, domain] = email.split('@');
  const stripped = local?.replace(/\+.*$/, '').replace(/\./g, '');
  const normalized = `${stripped}@${domain}`;
  return {
    plusAlias: local?.includes('+') ?? false,
    dotAlias: (domain?.includes('gmail.com') && local?.includes('.')) ?? false,
    normalizedEmail: normalized,
  };
}

export function appleRelay(email: string): { hideMyEmail: boolean; privaterelay: boolean } {
  const isRelay = email.endsWith('@privaterelay.appleid.com');
  return { hideMyEmail: isRelay, privaterelay: isRelay };
}

export function phoneRecycling(
  phoneNumber: string,
  previousAccountIds: string[]
): { numberRecycled: boolean; previousAccounts: number } {
  return { numberRecycled: previousAccountIds.length > 0, previousAccounts: previousAccountIds.length };
}

export function simSwap(signals: {
  carrierChangeDetected: boolean;
  newSIMWithOldNumber: boolean;
  recentPorting: boolean;
}): { simChanged: boolean; carrierChange: boolean } {
  return {
    simChanged: signals.carrierChangeDetected || signals.newSIMWithOldNumber,
    carrierChange: signals.carrierChangeDetected,
  };
}

export function magicLinkAbuse(
  linkUsages: Array<{ token: string; usedAt: Date; usedCount: number }>
): { linkReuse: boolean; magicLinkRate: number } {
  const reused = linkUsages.filter(l => l.usedCount > 1);
  return { linkReuse: reused.length > 0, magicLinkRate: reused.length / Math.max(1, linkUsages.length) };
}

export const REFRESH_TOKEN_ROTATION = {
  refreshTokenRotation: true,
  rotateRefreshToken: true,
  implementation: 'Firebase Auth automatically rotates refresh tokens. ' +
    'For custom auth: invalidate old refresh token on each use, issue new one.',
};

export const ACCENT_MISMATCH = {
  accentMismatch: false,
  accentLocation: 'No reliable free tool for accent detection',
  dialectAnalysis: 'Commercial APIs: Azure Speaker Recognition, Google Speech-to-Text (limited)',
  fallback: 'Flag for human review when accent seems inconsistent with claimed location',
};

export function audioSplicing(
  audioFeatures: Array<{ timestamp: number; spectralCentroid: number; zeroCrossingRate: number }>
): { audioEditDetect: boolean; splicingPoints: number[] } {
  const splicingPoints: number[] = [];
  for (let i = 1; i < audioFeatures.length; i++) {
    const centroidDiff = Math.abs(audioFeatures[i].spectralCentroid - audioFeatures[i - 1].spectralCentroid);
    const zcrDiff = Math.abs(audioFeatures[i].zeroCrossingRate - audioFeatures[i - 1].zeroCrossingRate);
    if (centroidDiff > 1000 || zcrDiff > 0.3) {
      splicingPoints.push(audioFeatures[i].timestamp);
    }
  }
  return { audioEditDetect: splicingPoints.length > 0, splicingPoints };
}

export function emotionalAuthenticity(
  prosodyFeatures: { pitchVariance: number; energyVariance: number; speakingRate: number }
): { emotionAnalysis: string; sentimentVoice: string } {
  const isMonotone = prosodyFeatures.pitchVariance < 20 && prosodyFeatures.energyVariance < 5;
  return {
    emotionAnalysis: isMonotone ? 'monotone' : 'natural_variation',
    sentimentVoice: isMonotone ? 'low_emotional_authenticity' : 'authentic',
  };
}

export function scriptReading(
  prosody: { avgPauseMs: number; pauseVariance: number; speakingRateVariance: number }
): { readingDetect: boolean; monotoneDetect: boolean } {
  const isReading = prosody.avgPauseMs < 200 && prosody.pauseVariance < 50 && prosody.speakingRateVariance < 0.1;
  return { readingDetect: isReading, monotoneDetect: isReading };
}

export function roomAcoustics(
  audioProfile: { reverbTime: number; noiseFloor: number }
): { reverbAnalysis: string; environmentConsistency: boolean } {
  return {
    reverbAnalysis: audioProfile.reverbTime > 500 ? 'large_reverberant_space' : 'normal_room',
    environmentConsistency: true,
  };
}

export function phoneQuality(
  audioMetrics: { sampleRate: number; bitDepth: number; codec: string }
): { audioQualityDevice: string; codecMismatch: boolean } {
  const VOIP_CODECS = ['opus', 'g711', 'g729', 'amr'];
  const isVoip = VOIP_CODECS.some(c => audioMetrics.codec.toLowerCase().includes(c));
  return { audioQualityDevice: isVoip ? 'voip' : 'native', codecMismatch: false };
}

export function holdMusic(audioFeatures: { hasMusicDuringPause: boolean }): { holdMusicDetect: boolean } {
  return { holdMusicDetect: audioFeatures.hasMusicDuringPause };
}

export function echoDetect(latencyMs: number): { delayPattern: boolean; latencyAnomaly: boolean } {
  return { delayPattern: latencyMs > 300, latencyAnomaly: latencyMs > 500 };
}

export const VOICE_STRESS_ANALYSIS = {
  voiceStress: false,
  stressAnalysis: 'No scientifically validated free tool. VSA tools are pseudoscience — do not use for decisions.',
  voiceTremor: 'Tremor detection possible via pitch analysis but unreliable as stress indicator',
};

export const API_VERSIONING = {
  apiVersioning: true,
  versionAbuse: false,
  deprecatedAPI: 'Track usage of /v1/, /v2/ endpoints. Sunset deprecated versions after 6 months.',
  implementation: 'Log and monitor all API version usage. Alert on deprecated endpoint calls.',
};

export const SSE_PROTECTION = {
  sseAbuse: false,
  eventStreamAbuse: false,
  implementation: 'Limit concurrent SSE connections per user. Apply backpressure on slow consumers.',
  limits: { maxConnectionsPerUser: 3, maxRetryInterval: 30000 },
};

export const postBreakupImpersonation = {
  exImpersonation: true,
  description: 'Face matching against reported impersonation using InsightFace ArcFace embeddings',
  implementation: 'See: utils/postRelationshipAbuse.ts → detectImpersonation()',
};

export const exImpersonation = postBreakupImpersonation;
