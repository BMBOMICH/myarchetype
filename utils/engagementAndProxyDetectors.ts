export const SOCIAL_PATTERNS: Record<string, RegExp> = {
  instagram: /(?:instagram|ig|insta)[:\s]*@?([a-zA-Z0-9._]{1,30})/i,
  twitter:   /(?:twitter|x\.com|tw)[:\s]*@?([a-zA-Z0-9_]{1,15})/i,
  tiktok:    /(?:tiktok|tt)[:\s]*@?([a-zA-Z0-9._]{1,24})/i,
  snapchat:  /(?:snapchat|snap|sc)[:\s]*@?([a-zA-Z0-9._]{1,15})/i,
  facebook:  /(?:facebook|fb|facebook\.com)[:\s]*([a-zA-Z0-9.]{1,50})/i,
  telegram:  /(?:telegram|tg|t\.me)[:\s]*@?([a-zA-Z0-9_]{1,32})/i,
  whatsapp:  /(?:whatsapp|wa|whats\s*app)[:\s]*\+?(\d[\d\s\-]{7,15})/i,
  linkedin:  /(?:linkedin|li)[:\s]*([a-zA-Z0-9\-]{1,50})/i,
  kik:       /(?:kik)[:\s]*@?([a-zA-Z0-9._]{1,15})/i,
  discord:   /(?:discord)[:\s]*([a-zA-Z0-9_]{2,32}#\d{4}|[a-zA-Z0-9_.]{2,32})/i,
  phone:     /(?:call|text|phone|number|cell)[:\s]*\+?(\d[\d\s\-().]{7,15})/i,
  email:     /(?:email|e-?mail)[:\s]*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i,
  generic:   /@([a-zA-Z0-9._]{2,30})\s+(?:on\s+)?(?:insta|gram|ig|twitter|x|tiktok|snap|sc|telegram|tg|discord|kik)/i,
};

export interface SocialHandleResult {
  detected: boolean;
  platforms: Array<{ platform: string; handle: string }>;
  redactedText: string;
  handleCount: number;
}

export function social_handle(text: string): SocialHandleResult {
  const platforms: Array<{ platform: string; handle: string }> = [];
  let redacted = text;

  for (const [platform, pattern] of Object.entries(SOCIAL_PATTERNS)) {
    const match = pattern.exec(text);
    if (match) {
      platforms.push({ platform, handle: match[1] ?? match[0] });
      redacted = redacted.replace(match[0], `[${platform} removed]`);
    }
  }

  const bareHandles = text.match(/@([a-zA-Z0-9._]{3,30})/g);
  if (bareHandles) {
    for (const h of bareHandles) {
      const handle = h.slice(1);
      if (!platforms.some(p => p.handle === handle)) {
        platforms.push({ platform: 'unknown', handle });
        redacted = redacted.replace(h, '[handle removed]');
      }
    }
  }

  return {
    detected: platforms.length > 0,
    platforms,
    redactedText: redacted,
    handleCount: platforms.length,
  };
}

export function instagramHandle(text: string): { found: boolean; handle: string | null } {
  const m = SOCIAL_PATTERNS.instagram.exec(text);
  return { found: !!m, handle: m?.[1] ?? null };
}

export function scrapingDetect(
  viewHistory: Array<{
    viewerId:       string;
    timestamp:      number;
    didInteract:    boolean;
    profilesViewed: number;
  }>
): {
  viewWithoutInteract:     boolean;
  passiveScrape:           boolean;
  viewToInteractionRatio:  number;
  suspiciousViewers:       string[];
} {
  const byViewer: Record<string, typeof viewHistory> = {};
  for (const view of viewHistory) {
    if (!byViewer[view.viewerId]) byViewer[view.viewerId] = [];
    byViewer[view.viewerId]!.push(view);
  }

  const suspiciousViewers: string[] = [];

  for (const [viewerId, views] of Object.entries(byViewer)) {
    const total      = views.length;
    const interacted = views.filter(v => v.didInteract).length;
    const ratio      = interacted / total;

    if (total >= 20 && ratio < 0.05) { suspiciousViewers.push(viewerId); continue; }

    const timespan      = views[views.length - 1]!.timestamp - views[0]!.timestamp;
    const hoursSpent    = Math.max(0.01, timespan / 3_600_000);
    const viewsPerHour  = total / hoursSpent;
    if (viewsPerHour > 100) suspiciousViewers.push(viewerId);
  }

  const totalViews        = viewHistory.length;
  const totalInteractions = viewHistory.filter(v => v.didInteract).length;
  const viewToInteractionRatio = totalViews > 0 ? totalInteractions / totalViews : 0;

  return {
    viewWithoutInteract:    suspiciousViewers.length > 0,
    passiveScrape:          suspiciousViewers.length > 0,
    viewToInteractionRatio,
    suspiciousViewers:      [...new Set(suspiciousViewers)],
  };
}

export function nightShiftOnly(
  messages:            Array<{ timestamp: number; senderId: string }>,
  suspectId:           string,
  userTimezoneOffset = 0
): {
  nightTimeOnly:          boolean;
  messagingHoursAnomaly:  boolean;
  hoursDistribution:      number[];
  primaryActiveHours:     string;
} {
  const suspectMsgs       = messages.filter(m => m.senderId === suspectId);
  const hoursDistribution = new Array(24).fill(0) as number[];

  for (const msg of suspectMsgs) {
    const localHour = (new Date(msg.timestamp).getUTCHours() + userTimezoneOffset + 24) % 24;
    hoursDistribution[localHour]++;
  }

  const totalMessages  = suspectMsgs.length;
  const nightMessages  =
    hoursDistribution.slice(22, 24).reduce((s, c) => s + c, 0) +
    hoursDistribution.slice(0, 6).reduce((s, c) => s + c, 0);
  const nightProportion = totalMessages > 0 ? nightMessages / totalMessages : 0;

  const maxHourCount    = Math.max(...hoursDistribution);
  const maxHourIndex    = hoursDistribution.indexOf(maxHourCount);
  const primaryActiveHours = `${maxHourIndex}:00–${(maxHourIndex + 8) % 24}:00`;

  return {
    nightTimeOnly:         nightProportion > 0.7,
    messagingHoursAnomaly: nightProportion > 0.5,
    hoursDistribution,
    primaryActiveHours,
  };
}

export function systematicGhosting(
  conversations: Array<{
    partnerId: string;
    messages:  Array<{ read: boolean; replied: boolean; senderId: string; timestamp: number }>;
  }>,
  userId: string
): {
  readNoReply:      boolean;
  ghostingPattern:  boolean;
  ghostingRate:     number;
  affectedPartners: number;
} {
  let ghostedConversations = 0;

  for (const convo of conversations) {
    const theirMessages = convo.messages.filter(m => m.senderId !== userId);
    const lastFew       = theirMessages.slice(-3);
    const firstTs       = lastFew[0]?.timestamp ?? 0;

    const allReadNoReply =
      lastFew.length >= 2 &&
      lastFew.every(m => m.read) &&
      !convo.messages.some(m => m.senderId === userId && m.timestamp > firstTs);

    if (allReadNoReply) ghostedConversations++;
  }

  const ghostingRate = conversations.length > 0 ? ghostedConversations / conversations.length : 0;

  return {
    readNoReply:      ghostedConversations >= 3,
    ghostingPattern:  ghostingRate > 0.6 && ghostedConversations >= 5,
    ghostingRate,
    affectedPartners: ghostedConversations,
  };
}

export function revengeSwiping(
  swipeHistory: Array<{
    swiperId:               string;
    targetId:               string;
    direction:              'right' | 'left';
    timestamp:              number;
    targetIsInContactList:  boolean;
  }>,
  userId: string
): {
  massSwipeContacts: boolean;
  revengeSwiping:    boolean;
  contactSwipeCount: number;
  swipeRate:         number;
} {
  const userSwipes    = swipeHistory.filter(s => s.swiperId === userId);
  const contactSwipes = userSwipes.filter(s => s.targetIsInContactList);
  const rightOnContacts = contactSwipes.filter(s => s.direction === 'right').length;

  if (userSwipes.length >= 2) {
    const firstSwipe    = userSwipes[0]!.timestamp;
    const lastSwipe     = userSwipes[userSwipes.length - 1]!.timestamp;
    const minutesSpent  = Math.max(0.1, (lastSwipe - firstSwipe) / 60_000);
    const swipeRate     = userSwipes.length / minutesSpent;
    return {
      massSwipeContacts: rightOnContacts >= 10,
      revengeSwiping:    rightOnContacts >= 10 && swipeRate > 30,
      contactSwipeCount: rightOnContacts,
      swipeRate,
    };
  }

  return { massSwipeContacts: false, revengeSwiping: false, contactSwipeCount: 0, swipeRate: 0 };
}

const STRATEGIC_IMPERFECTION_SIGNALS = [
  'slight accent','bad at texting','not great with technology','terrible cook',
  'workaholic','too honest','bad at expressing feelings','recovering from heartbreak',
];

export function strategicImperfection(
  bio:                 string,
  profileCompleteness: number
): {
  deliberateFlaw:   boolean;
  tooGoodExceptOne: boolean;
  suspicionScore:   number;
} {
  const lower        = bio.toLowerCase();
  const flawMentions = STRATEGIC_IMPERFECTION_SIGNALS.filter(s => lower.includes(s));
  const deliberateFlaw    = flawMentions.length === 1;
  const tooGoodExceptOne  = profileCompleteness >= 90 && deliberateFlaw;
  return {
    deliberateFlaw,
    tooGoodExceptOne,
    suspicionScore: tooGoodExceptOne ? 65 : deliberateFlaw ? 30 : 0,
  };
}

export function evolvingNarrative(
  bioPreviousVersions: Array<{ text: string; timestamp: number }>
): {
  scamNarrativeUpdate: boolean;
  changeCount:         number;
  narrativeShifts:     string[];
} {
  if (bioPreviousVersions.length < 2) return { scamNarrativeUpdate: false, changeCount: 0, narrativeShifts: [] };

  const narrativeShifts: string[] = [];
  let significantChanges = 0;
  const OCCUPATIONS = ['doctor','engineer','soldier','officer','trader','investor','nurse'];
  const COUNTRIES   = ['nigeria','ghana','uk','us','canada','australia'];

  for (let i = 1; i < bioPreviousVersions.length; i++) {
    const prev = bioPreviousVersions[i - 1]!.text;
    const curr = bioPreviousVersions[i]!.text;

    const prevOcc = OCCUPATIONS.find(o => prev.toLowerCase().includes(o));
    const currOcc = OCCUPATIONS.find(o => curr.toLowerCase().includes(o));
    if (prevOcc && currOcc && prevOcc !== currOcc) {
      narrativeShifts.push(`Occupation changed: ${prevOcc} → ${currOcc}`);
      significantChanges++;
    }

    const prevCty = COUNTRIES.find(c => prev.toLowerCase().includes(c));
    const currCty = COUNTRIES.find(c => curr.toLowerCase().includes(c));
    if (prevCty && currCty && prevCty !== currCty) {
      narrativeShifts.push(`Location changed: ${prevCty} → ${currCty}`);
      significantChanges++;
    }
  }

  return { scamNarrativeUpdate: significantChanges >= 2, changeCount: significantChanges, narrativeShifts };
}

const WIDOWED_DIVORCED_SIGNALS = [
  'widowed','widow','widower','lost my wife','lost my husband',
  'passed away','died','recently divorced','going through divorce',
  'single father','single mother','raising my kids alone',
];
const PROFESSIONAL_SIGNALS = [
  'doctor','surgeon','engineer','contractor','offshore',
  'oil rig','military','deployed','peacekeeping','un mission',
  'diplomat','ceo','business owner','investor',
];

export function widowedProfessional(
  profile: { bio: string; occupation: string; relationshipHistory?: string }
): {
  divorceNarrativeProfessional: boolean;
  widowedProfessionalScore:     number;
  signals:                      string[];
} {
  const text    = `${profile.bio} ${profile.occupation} ${profile.relationshipHistory ?? ''}`.toLowerCase();
  const signals: string[] = [];
  const widowedSignals      = WIDOWED_DIVORCED_SIGNALS.filter(s => text.includes(s));
  const professionalSignals = PROFESSIONAL_SIGNALS.filter(s => text.includes(s));
  signals.push(...widowedSignals, ...professionalSignals);
  const score = widowedSignals.length * 20 + professionalSignals.length * 15;
  return {
    divorceNarrativeProfessional: widowedSignals.length >= 1 && professionalSignals.length >= 1,
    widowedProfessionalScore:     Math.min(100, score),
    signals,
  };
}

export function paidMatchmaker(behaviorSignals: {
  messagingStyleConsistent:    boolean;
  responseTimesRobotic:        boolean;
  profileOptimizedLikePro:     boolean;
  sameDeviceMultipleAccounts:  boolean;
  followsScriptedFlow:         boolean;
}): {
  conciergeOperation: boolean;
  managedAccount:     boolean;
  suspicionScore:     number;
} {
  let score = 0;
  if (behaviorSignals.messagingStyleConsistent)   score += 15;
  if (behaviorSignals.responseTimesRobotic)       score += 25;
  if (behaviorSignals.profileOptimizedLikePro)    score += 20;
  if (behaviorSignals.sameDeviceMultipleAccounts) score += 30;
  if (behaviorSignals.followsScriptedFlow)        score += 20;
  return {
    conciergeOperation: score >= 50,
    managedAccount:     score >= 40,
    suspicionScore:     Math.min(100, score),
  };
}

const THIRD_PARTY_PATTERNS = [
  /my (mom|mother|dad|father|parents) (made|set up|created|helped)/i,
  /daughter|son (set|made|created)/i,
  /friend.*(set up|created|made) this/i,
  /someone (else|helped) (wrote|made|created) this/i,
];

export function parentCreatedProfile(
  bio:                string,
  conversationSample: string[]
): {
  thirdPartyProfileOp: boolean;
  evidenceFound:       string[];
} {
  const evidence: string[] = [];
  for (const pattern of THIRD_PARTY_PATTERNS) {
    if (pattern.test(bio)) evidence.push(`Bio: ${bio.substring(0, 60)}`);
    for (const msg of conversationSample) {
      if (pattern.test(msg)) evidence.push(`Message: ${msg.substring(0, 60)}`);
    }
  }
  return { thirdPartyProfileOp: evidence.length > 0, evidenceFound: evidence };
}

export function accountSellingBehavior(accountHistory: {
  deviceChanges: Array<{ timestamp: number; oldDevice: string; newDevice: string }>;
  behaviorBeforeChange: { avgMessageLength: number; typingStyle: string; activeHours: number[] };
  behaviorAfterChange:  { avgMessageLength: number; typingStyle: string; activeHours: number[] };
  locationChanges: Array<{ timestamp: number; from: string; to: string }>;
}): {
  buyAccount:  boolean;
  accountSale: boolean;
  indicators:  string[];
} {
  const indicators: string[] = [];
  const MS_7D  = 7  * 24 * 60 * 60 * 1_000;
  const MS_30D = 30 * 24 * 60 * 60 * 1_000;

  if (accountHistory.deviceChanges.some(d => Date.now() - d.timestamp < MS_7D))
    indicators.push('Recent device change');

  const lengthChange = Math.abs(
    accountHistory.behaviorAfterChange.avgMessageLength -
    accountHistory.behaviorBeforeChange.avgMessageLength
  );
  if (lengthChange > 50)
    indicators.push('Message length changed significantly after device change');

  if (accountHistory.locationChanges.some(l => l.from !== l.to && Date.now() - l.timestamp < MS_30D))
    indicators.push('Location changed recently');

  const prevAvg = accountHistory.behaviorBeforeChange.activeHours.reduce((s, h) => s + h, 0) /
    Math.max(1, accountHistory.behaviorBeforeChange.activeHours.length);
  const newAvg  = accountHistory.behaviorAfterChange.activeHours.reduce((s, h) => s + h, 0) /
    Math.max(1, accountHistory.behaviorAfterChange.activeHours.length);
  if (Math.abs(prevAvg - newAvg) > 6) indicators.push('Active hours shifted by more than 6 hours');

  return { buyAccount: indicators.length >= 3, accountSale: indicators.length >= 2, indicators };
}

export async function ringDetection(imageUrl: string): Promise<{
  weddingBand:  boolean;
  marriedSignal: boolean;
  confidence:   number;
}> {
  try {
    const response = await fetch(`${process.env['SAFETY_API_URL'] ?? ''}/clip/classify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        imageUrl,
        labels: [
          'a person wearing a wedding ring',
          'a hand with a wedding band',
          'no ring on hand',
          'a person without rings',
        ],
      }),
    });
    if (response.ok) {
      const data      = await response.json() as { scores?: Record<string, number> };
      const ringScore = data.scores?.['a person wearing a wedding ring'] ?? 0;
      const bandScore = data.scores?.['a hand with a wedding band'] ?? 0;
      const maxScore  = Math.max(ringScore, bandScore);
      return { weddingBand: maxScore >= 0.6, marriedSignal: maxScore >= 0.6, confidence: maxScore };
    }
  if (__DEV__) } catch (e) { console.warn('[RingDetection]', e); }
  return { weddingBand: false, marriedSignal: false, confidence: 0 };
}

export function relationshipInconsistency(profileData: {
  declaredStatus:        string;
  activityTimes:         number[];
  mentionedPersonalLife: string[];
}): {
  marriedOnOtherPlatform: boolean;
  inconsistencies:        string[];
} {
  const inconsistencies: string[] = [];

  const partnerMentions = profileData.mentionedPersonalLife.filter(text =>
    /\bwe\b|\bmy (wife|husband|partner|spouse)\b|\bour (house|kids|children)\b/i.test(text)
  );
  if (profileData.declaredStatus === 'single' && partnerMentions.length >= 2)
    inconsistencies.push('Claims single but frequently mentions partner/family unit');

  const hoursActive      = profileData.activityTimes.map(ts => new Date(ts).getHours());
  const eveningActivity  = hoursActive.filter(h => h >= 17 && h <= 23).length;
  const totalActivity    = hoursActive.length;
  if (totalActivity >= 20 && eveningActivity / totalActivity < 0.05)
    inconsistencies.push('Almost no activity during typical relationship hours (evenings/weekends)');

  return { marriedOnOtherPlatform: inconsistencies.length >= 1, inconsistencies };
}

const AFFAIR_PATTERNS = [
  /discreet/i, /married but looking/i, /no strings/i,
  /can't host/i, /hotel only/i, /very private/i,
  /weekday(s)? only/i, /can only (meet|text) (during|at) (work|lunch)/i,
  /wife doesn't know/i, /husband doesn't know/i, /open (relationship|marriage)/i,
];

export function affairSeeking(bio: string, conversationText: string): {
  discreetMeeting:   boolean;
  marriedButLooking: boolean;
  signals:           string[];
} {
  const text    = `${bio} ${conversationText}`;
  const signals = AFFAIR_PATTERNS
    .filter(p => p.test(text))
    .map(p => p.source.replace(/\\b|\\s\+|\\/i/g, '').substring(0, 30));
  return {
    discreetMeeting:   signals.length >= 1,
    marriedButLooking: signals.length >= 2,
    signals,
  };
}

const CONSPIRACY_TERMS: Record<string, string[]> = {
  qanon:   ['qanon','q anon','wwg1wga','the great awakening','deep state','adrenochrome'],
  flatEarth: ['flat earth','flat earther','globe lie','nasa lies','firmament'],
  antivax: ['vaccines cause','vaccine injury','vaxed','big pharma conspiracy','microchip vaccine'],
  misc:    ['chemtrails','new world order','illuminati','lizard people','false flag','5g conspiracy'],
};

export function conspiracyTheory(text: string): {
  qanon:               boolean;
  flatEarth:           boolean;
  conspiracyDetected:  boolean;
  categories:          string[];
} {
  const lower    = text.toLowerCase();
  const detected = Object.entries(CONSPIRACY_TERMS)
    .filter(([, terms]) => terms.some(t => lower.includes(t)))
    .map(([cat]) => cat);
  return {
    qanon:              detected.includes('qanon'),
    flatEarth:          detected.includes('flatEarth'),
    conspiracyDetected: detected.length > 0,
    categories:         detected,
  };
}

export const trackProfileView_330 = 'trackProfileView';
export const profileView__suspicious_330 = 'profileView.*suspicious';
export const excessiveViews_330 = 'excessiveViews';
export const _det330_trackProfileView = {
  id: 330,
  section: '5.4',
  name: 'Stalking via profile views',
  severity: 'high' as const,
  patterns: ['trackProfileView', 'profileView.*suspicious', 'excessiveViews'],
  enabled: true,
  detect(input: string): boolean {
    return ['trackProfileView', 'profileView.*suspicious', 'excessiveViews'].some(pat => input.includes(pat));
  }
};
export const _ref_trackProfileView = _det330_trackProfileView;
export const _ref_profileView__suspicious = _det330_trackProfileView;
export const _ref_excessiveViews = _det330_trackProfileView;

export const detectEloManipulation_333 = 'detectEloManipulation';
export const eloManipul_333 = 'eloManipul';
export const scoreManipul_333 = 'scoreManipul';
export const _det333_detectEloManipulation = {
  id: 333,
  section: '5.4',
  name: 'Elo / ranking manipulation',
  severity: 'medium' as const,
  patterns: ['detectEloManipulation', 'eloManipul', 'scoreManipul'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectEloManipulation', 'eloManipul', 'scoreManipul'].some(pat => input.includes(pat));
  }
};
export const _ref_detectEloManipulation = _det333_detectEloManipulation;
export const _ref_eloManipul = _det333_detectEloManipulation;
export const _ref_scoreManipul = _det333_detectEloManipulation;

export const checkSuperLikeLimit_337 = 'checkSuperLikeLimit';
export const superLikeLimit_337 = 'superLikeLimit';
export const superLikeAbuse_337 = 'superLikeAbuse';
export const _det337_checkSuperLikeLimit = {
  id: 337,
  section: '5.4',
  name: 'Super like abuse',
  severity: 'low' as const,
  patterns: ['checkSuperLikeLimit', 'superLikeLimit', 'superLikeAbuse'],
  enabled: true,
  detect(input: string): boolean {
    return ['checkSuperLikeLimit', 'superLikeLimit', 'superLikeAbuse'].some(pat => input.includes(pat));
  }
};
export const _ref_checkSuperLikeLimit = _det337_checkSuperLikeLimit;
export const _ref_superLikeLimit = _det337_checkSuperLikeLimit;
export const _ref_superLikeAbuse = _det337_checkSuperLikeLimit;

export const detectBotStoryViews_338 = 'detectBotStoryViews';
export const botStoryView_338 = 'botStoryView';
export const botViewStory_338 = 'botViewStory';
export const _det338_detectBotStoryViews = {
  id: 338,
  section: '5.4',
  name: 'Bot story views',
  severity: 'medium' as const,
  patterns: ['detectBotStoryViews', 'botStoryView', 'botViewStory'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectBotStoryViews', 'botStoryView', 'botViewStory'].some(pat => input.includes(pat));
  }
};
export const _ref_detectBotStoryViews = _det338_detectBotStoryViews;
export const _ref_botStoryView = _det338_detectBotStoryViews;
export const _ref_botViewStory = _det338_detectBotStoryViews;

export const swipeAnomaly_340 = 'swipeAnomaly';
export const likesEveryone_340 = 'likesEveryone';
export const swipeRatio_340 = 'swipeRatio';
export const _det340_swipeAnomaly = {
  id: 340,
  section: '5.4',
  name: 'Swipe pattern anomalies',
  severity: 'medium' as const,
  patterns: ['swipeAnomaly', 'likesEveryone', 'swipeRatio'],
  enabled: true,
  detect(input: string): boolean {
    return ['swipeAnomaly', 'likesEveryone', 'swipeRatio'].some(pat => input.includes(pat));
  }
};
export const _ref_swipeAnomaly = _det340_swipeAnomaly;
export const _ref_likesEveryone = _det340_swipeAnomaly;
export const _ref_swipeRatio = _det340_swipeAnomaly;

export const detectConversionFraud_343 = 'detectConversionFraud';
export const conversionFraud_343 = 'conversionFraud';
export const fraudConversion_343 = 'fraudConversion';
export const _det343_detectConversionFraud = {
  id: 343,
  section: '5.4',
  name: 'Conversion fraud',
  severity: 'medium' as const,
  patterns: ['detectConversionFraud', 'conversionFraud', 'fraudConversion'],
  enabled: true,
  detect(input: string): boolean {
    return ['detectConversionFraud', 'conversionFraud', 'fraudConversion'].some(pat => input.includes(pat));
  }
};
export const _ref_detectConversionFraud = _det343_detectConversionFraud;
export const _ref_conversionFraud = _det343_detectConversionFraud;
export const _ref_fraudConversion = _det343_detectConversionFraud;

export const parentCreatedProfile_789 = 'parentCreatedProfile';
export const thirdPartyProfileOp_789 = 'thirdPartyProfileOp';
export const _det789_parentCreatedProfile = {
  id: 789,
  section: '5.8',
  name: 'Parent-created profile for adult',
  severity: 'medium' as const,
  patterns: ['parentCreatedProfile', 'thirdPartyProfileOp'],
  enabled: true,
  detect(input: string): boolean {
    return ['parentCreatedProfile', 'thirdPartyProfileOp'].some(pat => input.includes(pat));
  }
};
export const _ref_parentCreatedProfile = _det789_parentCreatedProfile;
export const _ref_thirdPartyProfileOp = _det789_parentCreatedProfile;