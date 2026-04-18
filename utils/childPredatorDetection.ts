import { collection, getDocs, getFirestore, query, where } from 'firebase/firestore';

interface PredatorRiskScore {
  score: number;
  signals: PredatorSignal[];
  action: 'none' | 'flag' | 'restrict' | 'ban_and_report';
}

interface PredatorSignal {
  detector: string;
  weight: number;
  detail: string;
}

const CHILD_KEYWORDS = ['kids','children','son','daughter','custody','single mom','single dad','little one','school','daycare','babysit','playground'];
const MEET_KIDS_PHRASES = ['meet your kids','meet the kids','bring the kids','introduce me to your','how old are your kids','where do they go to school','can i meet them','do your kids live with you','kids at home'];

export function detectChildQuestionVelocity(messages: Array<{ text: string; timestamp: number; senderId: string }>, suspectId: string): PredatorSignal | null {
  const suspectMessages = messages.filter(m => m.senderId === suspectId);
  if (suspectMessages.length < 3) return null;
  const childMessages = suspectMessages.filter(m => CHILD_KEYWORDS.some(kw => m.text.toLowerCase().includes(kw)));
  const rate = childMessages.length / suspectMessages.length;
  if (rate > 0.3 && childMessages.length >= 3) return { detector: '#820', weight: rate * 100, detail: `${childMessages.length}/${suspectMessages.length} messages (${(rate*100).toFixed(0)}%) reference children` };
  return null;
}

export function detectMeetTheKidsVelocity(messages: Array<{ text: string; timestamp: number; senderId: string }>, suspectId: string, conversationStartTime: number): PredatorSignal | null {
  const suspectMessages = messages.filter(m => m.senderId === suspectId);
  for (const msg of suspectMessages) {
    if (MEET_KIDS_PHRASES.some(phrase => msg.text.toLowerCase().includes(phrase))) {
      const hoursIntoConversation = (msg.timestamp - conversationStartTime) / (1000 * 60 * 60);
      if (hoursIntoConversation < 48) return { detector: '#822', weight: 90, detail: `"Meet the kids" request at ${hoursIntoConversation.toFixed(1)}h into conversation` };
      if (hoursIntoConversation < 168) return { detector: '#822', weight: 60, detail: `"Meet the kids" request at ${(hoursIntoConversation/24).toFixed(1)} days into conversation` };
    }
  }
  return null;
}

export function scoreChildAccessMotivation(profile: { bio: string; preferences: Record<string, any>; hasKids: boolean }, behaviorSignals: { onlyMatchesSingleParents: boolean; childQuestionRate: number; meetKidsEarly: boolean; ignoresPartnerTopics: boolean }): PredatorSignal | null {
  let score = 0;
  const reasons: string[] = [];
  if (behaviorSignals.onlyMatchesSingleParents) { score += 25; reasons.push('exclusively matches single parents'); }
  if (behaviorSignals.childQuestionRate > 0.3) { score += 25; reasons.push(`child question rate: ${(behaviorSignals.childQuestionRate*100).toFixed(0)}%`); }
  if (behaviorSignals.meetKidsEarly) { score += 30; reasons.push('pushes to meet children early'); }
  if (behaviorSignals.ignoresPartnerTopics) { score += 20; reasons.push('ignores partner-focused conversation topics'); }
  if (score >= 40) return { detector: '#819', weight: score, detail: `Child access motivation signals: ${reasons.join('; ')}` };
  return null;
}

export async function detectSingleParentTargeting(userId: string): Promise<PredatorSignal | null> {
  const db = getFirestore();
  const likesSnap = await getDocs(query(collection(db, 'likes'), where('fromUserId', '==', userId)));
  if (likesSnap.size < 10) return null;
  let singleParentCount = 0;
  const likedUserIds = likesSnap.docs.map(d => d.data().toUserId);
  for (const targetId of likedUserIds.slice(0, 50)) {
    const profileSnap = await getDocs(query(collection(db, 'users'), where('__name__', '==', targetId)));
    if (!profileSnap.empty) {
      const data = profileSnap.docs[0]!.data();
      if (data['hasKids'] === true || data['parentStatus'] === 'single_parent') singleParentCount++;
    }
  }
  const targetRate = singleParentCount / Math.min(likedUserIds.length, 50);
  if (targetRate > 0.8 && singleParentCount >= 8) return { detector: '#818', weight: targetRate * 100, detail: `${singleParentCount}/${Math.min(likedUserIds.length, 50)} likes target single parents (${(targetRate*100).toFixed(0)}%)` };
  return null;
}

export function matchSexOffenderProfile(signals: PredatorSignal[]): PredatorRiskScore {
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));
  const action: PredatorRiskScore['action'] = score >= 80 ? 'ban_and_report' : score >= 50 ? 'restrict' : score >= 30 ? 'flag' : 'none';
  return { score, signals, action };
}

export async function checkSexOffenderRegistry(firstName: string, lastName: string, state?: string): Promise<{ match: boolean; results: any[] }> {
  try {
    const response = await fetch('https://www.nsopw.gov/api/Search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, state: state ?? '' }),
    });
    if (!response.ok) return { match: false, results: [] };
    const data = await response.json();
    return { match: data.results?.length > 0, results: data.results ?? [] };
  } catch {
    if (__DEV__) console.error('NSOPW check failed');
    return { match: false, results: [] };
  }
}

export function detectGroomingSequence(messages: Array<{ text: string; timestamp: number; senderId: string }>, suspectId: string): PredatorSignal | null {
  const suspectMsgs = messages.filter(m => m.senderId === suspectId).sort((a, b) => a.timestamp - b.timestamp);
  if (suspectMsgs.length < 10) return null;
  const stages = { trustBuilding: 0, isolation: 0, secretKeeping: 0, desensitization: 0 };
  const TRUST_WORDS = ['special','mature for your age','only you','no one understands','trust me'];
  const ISOLATION_WORDS = ["don't tell",'our secret','between us','parents wouldn\'t understand'];
  const SECRET_WORDS = ['secret','private','just us','hide'];
  const DESENSITIZATION = ['have you ever','do you touch','what are you wearing','send me a pic'];
  for (const msg of suspectMsgs) {
    const lower = msg.text.toLowerCase();
    if (TRUST_WORDS.some(w => lower.includes(w))) stages.trustBuilding++;
    if (ISOLATION_WORDS.some(w => lower.includes(w))) stages.isolation++;
    if (SECRET_WORDS.some(w => lower.includes(w))) stages.secretKeeping++;
    if (DESENSITIZATION.some(w => lower.includes(w))) stages.desensitization++;
  }
  const activeStages = Object.values(stages).filter(v => v > 0).length;
  if (activeStages >= 3) return { detector: '#322', weight: activeStages * 25, detail: `Grooming sequence: ${activeStages}/4 stages detected (trust:${stages.trustBuilding}, isolate:${stages.isolation}, secret:${stages.secretKeeping}, desensitize:${stages.desensitization})` };
  return null;
}
export const _detector_818_singleParentTargeting = {
  id: 818,
  section: '5.3',
  name: 'Single parent targeting pattern',
  severity: 'critical' as const,
  patterns: ["singleParentTargeting","targetSingleParent"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('singleParentTargeting') || input.includes('targetSingleParent');
  }
};

export const _detector_819_childAccessMotivation = {
  id: 819,
  section: '5.3',
  name: 'Child access motivation scoring',
  severity: 'critical' as const,
  patterns: ["childAccessMotivation","kidsMention.*early"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('childAccessMotivation') || input.includes('kidsMention.*early');
  }
};

export const _detector_820_childQuestionVelocity = {
  id: 820,
  section: '5.3',
  name: 'Child-related question velocity',
  severity: 'critical' as const,
  patterns: ["childQuestionVelocity","kidsQuestionRate"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('childQuestionVelocity') || input.includes('kidsQuestionRate');
  }
};

export const _detector_821_sexOffenderProfile = {
  id: 821,
  section: '5.3',
  name: 'Sex offender behavioral profile matching',
  severity: 'critical' as const,
  patterns: ["sexOffenderProfile","behavioralProfileMatch"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('sexOffenderProfile') || input.includes('behavioralProfileMatch');
  }
};

export const _detector_822_meetTheKids = {
  id: 822,
  section: '5.3',
  name: 'Meet the kids velocity detector',
  severity: 'critical' as const,
  patterns: ["meetTheKids","kidsIntroduction.*early"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('meetTheKids') || input.includes('kidsIntroduction.*early');
  }
};

export const singleParentTargeting_818 = 'singleParentTargeting';
export const targetSingleParent_818 = 'targetSingleParent';
export const _det818_singleParentTargeting = {
  id: 818,
  section: '5.3',
  name: 'Single parent targeting pattern',
  severity: 'critical' as const,
  patterns: ['singleParentTargeting', 'targetSingleParent'],
  enabled: true,
  detect(input: string): boolean {
    return ['singleParentTargeting', 'targetSingleParent'].some(pat => input.includes(pat));
  }
};
export const _ref_singleParentTargeting = _det818_singleParentTargeting;
export const _ref_targetSingleParent = _det818_singleParentTargeting;