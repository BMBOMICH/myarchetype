import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { detectImpossibleTravel } from './location';
import { logger, writeAuditLog } from './logger';
import { checkTextSafety } from './moderation';
import { analyzeMessageTiming } from './rateLimiter';

export interface DatingStats {
  likesSent: number;
  likesReceived: number;
  matchRate: number;
  totalMatches: number;
  activeMatches: number;
  expiredMatches: number;
  profileViews: number;
  profileViewRate: number;
  bestPhoto: number | null;
  averageResponseTime: number;
  messagesSent: number;
  messagesReceived: number;
  conversationRate: number;
  averageRating: number;
  totalRatings: number;
  trustScore: number;
  peakActivityHour: number;
  averageSwipesPerDay: number;
  meetupRate: number;
  secondDateRate: number;
}

export interface BehaviorReport {
  userId: string;
  romanceScamScore: number;
  unmatchRate: number;
  reportRate: number;
  isGhostProfile: boolean;
  agePredatorSignal: boolean;
  escalatesConversationFast: boolean;
  refusesVideoCalls: boolean;
  botTimingSignal: boolean;
  ratingManipulationSignal: boolean;
  geographicAnomalySignal: boolean;
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  signals: string[];
}

const ESCALATION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(i love you|you're my soulmate|perfect for me|meant to be|destiny)\b/i, label: 'premature_love_declaration' },
  { re: /\b(come over|my place|your place|meet tonight|meet now|come see me)\b/i, label: 'immediate_meetup_push' },
  { re: /\b(so beautiful|so gorgeous|stunning|perfect body|sexy|hot af)\b/i, label: 'appearance_hyperfocus' },
  { re: /\b(give me your number|call me|text me|whatsapp|telegram|move to)\b/i, label: 'off_platform_redirect' },
  { re: /\b(send me a photo|send me pics|what are you wearing|show me)\b/i, label: 'photo_solicitation' },
  { re: /\b(i've never felt this way|you're different|you're special|not like others)\b/i, label: 'love_bombing' },
  { re: /\b(do you live alone|are you home|is anyone with you)\b/i, label: 'isolation_probing' },
  { re: /\b(how much do you make|what's your address|where do you work exactly)\b/i, label: 'pii_probing' },
];

export function detectAgePredatorPattern(
  userAge: number,
  targetAges: number[],
  minAge = 18
): { suspicious: boolean; avgTargetAge: number; ageDiff: number } {
  if (targetAges.length < 5) return { suspicious: false, avgTargetAge: 0, ageDiff: 0 };
  const avg = targetAges.reduce((a, b) => a + b, 0) / targetAges.length;
  const ageDiff = userAge - avg;
  return {
    suspicious: ageDiff > 15 && targetAges.every(a => a <= minAge + 3) && targetAges.length >= 10,
    avgTargetAge: Math.round(avg),
    ageDiff: Math.round(ageDiff),
  };
}

export function detectFastEscalation(
  msgs: Array<{ text: string; timestamp: number; isFromUser: boolean }>
): { escalatesQuickly: boolean; signalCount: number; signals: string[] } {
  if (msgs.length < 3) return { escalatesQuickly: false, signalCount: 0, signals: [] };

  let signalCount = 0;
  const signals: string[] = [];
  const first5 = msgs.slice(0, 5);

  for (const m of first5) {
    for (const { re, label } of ESCALATION_PATTERNS) {
      if (re.test(m.text) && !signals.includes(label)) {
        signalCount++;
        signals.push(label);
      }
    }
  }

  const firstMsg = msgs[0];
  const fifthMsg = msgs[Math.min(4, msgs.length - 1)];

  if (firstMsg && fifthMsg) {
    const windowMinutes = (fifthMsg.timestamp - firstMsg.timestamp) / 60_000;
    if (windowMinutes < 5 && signalCount > 1) {
      signalCount += 2;
      signals.push('rapid_progression_under_5min');
    } else if (windowMinutes < 10 && signalCount > 2) {
      signalCount += 1;
      signals.push('rapid_progression_under_10min');
    }
  }

  const userMsgs = msgs.filter(m => m.isFromUser).slice(0, 5);
  let userSignalCount = 0;
  for (const m of userMsgs) {
    for (const { re } of ESCALATION_PATTERNS) {
      if (re.test(m.text)) userSignalCount++;
    }
  }
  if (userSignalCount >= 3) signals.push('one_sided_escalation');

  return { escalatesQuickly: signalCount >= 3, signalCount, signals };
}

export function detectVideoCallRefusal(
  interactions: Array<{ type: string; outcome: string }>
): { refusalRate: number; suspicious: boolean } {
  const requests = interactions.filter(x => x.type === 'video_call_request');
  const refusals = requests.filter(x => x.outcome === 'declined');
  const refusalRate = requests.length > 0 ? refusals.length / requests.length : 0;
  return { refusalRate, suspicious: refusalRate > 0.8 && requests.length >= 3 };
}

export function detectEloManipulation(
  scoreHistory: Array<{ score: number; timestamp: number }>
): { manipulated: boolean; reason?: string } {
  if (scoreHistory.length < 5) return { manipulated: false };
  for (let i = 1; i < scoreHistory.length; i++) {
    const jump = scoreHistory[i]!.score - scoreHistory[i - 1]!.score;
    const minutesDelta = (scoreHistory[i]!.timestamp - scoreHistory[i - 1]!.timestamp) / 60_000;
    if (jump > 50 && minutesDelta < 5) {
      return { manipulated: true, reason: `Score jumped ${jump} points in ${minutesDelta.toFixed(1)} minutes.` };
    }
  }
  return { manipulated: false };
}

export function wilsonScoreLowerBound(positives: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const pHat = positives / total;
  const z2 = z * z;
  const num = pHat + z2 / (2 * total) - z * Math.sqrt((pHat * (1 - pHat) + z2 / (4 * total)) / total);
  const den = 1 + z2 / total;
  return Math.max(0, Math.min(1, num / den));
}

export function detectRatingManipulation(
  ratings: Array<{ score: number; timestamp: number; raterUserId: string }>
): { manipulated: boolean; reason?: string } {
  if (ratings.length < 3) return { manipulated: false };

  const sorted = [...ratings].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 2; i < sorted.length; i++) {
    const window = sorted.slice(i - 2, i + 1);
    if ((window[2]!.timestamp - window[0]!.timestamp) / 60_000 < 2) {
      return { manipulated: true, reason: '3 ratings within 2 minutes — possible coordinated manipulation.' };
    }
  }

  if (ratings.length >= 10 && (ratings.every(x => x.score >= 4.5) || ratings.every(x => x.score <= 1.5))) {
    return { manipulated: true, reason: 'Unusually uniform ratings — possible fake review network.' };
  }

  return { manipulated: false };
}

export function checkFirstMessageSafety(text: string): { safe: boolean; reason?: string } {
  const check = checkTextSafety(text, 'chat');
  if (!check.safe) return { safe: false, reason: check.reason };

  const FIRST_MSG_PATTERNS = [
    /\b(sex|fuck|nude|naked|body|boobs?|dick|cock|pussy|ass)\b/i,
    /\b(hook\s*up|one\s*night|friends\s*with\s*benefits|fwb|nsa)\b/i,
    /\b(how\s*big|how\s*hot|your\s*type|dtf)\b/i,
  ];

  for (const pattern of FIRST_MSG_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: 'Inappropriate first message. Please be respectful.' };
    }
  }
  return { safe: true };
}

export async function generateBehaviorReport(targetId: string): Promise<BehaviorReport> {
  const signals: string[] = [];
  let riskScore = 0;

  try {
    const userDoc = await getDoc(doc(db, 'users', targetId));
    const userData = userDoc.exists() ? userDoc.data() : {};

    const lastSeenMs = userData.lastSeen?.toMillis?.() ?? 0;
    const daysSinceActive = Math.floor((Date.now() - lastSeenMs) / 86_400_000);
    const isGhostProfile = daysSinceActive > 30 && (!userData.photos?.length || !userData.bio);
    if (isGhostProfile) signals.push('Ghost/inactive profile (30+ days)');

    const userAge = userData.age ?? 30;
    const likedAges: number[] = userData.likedUserAges ?? [];
    const ageCheck = detectAgePredatorPattern(userAge, likedAges);
    if (ageCheck.suspicious) {
      signals.push(`Consistently targets youngest users (avg age gap: ${ageCheck.ageDiff}y)`);
      riskScore += 20;
    }

    const msgTimestamps: number[] = userData.recentMessageTimestamps ?? [];
    const timingCheck = analyzeMessageTiming(msgTimestamps);
    if (timingCheck.isBot) {
      signals.push(timingCheck.reason ?? 'Bot-like message timing');
      riskScore += 30;
    }

    const unmatchRate = userData.unmatchRate ?? 0;
    if (unmatchRate > 0.5) {
      signals.push(`High unmatch rate: ${Math.round(unmatchRate * 100)}%`);
      riskScore += 10;
    }

    const reportRate = userData.reportRate ?? 0;
    if (reportRate > 0.1) {
      signals.push(`High report rate: ${Math.round(reportRate * 100)}%`);
      riskScore += 20;
    }

    const eloHistory: Array<{ score: number; timestamp: number }> = userData.eloHistory ?? [];
    const eloCheck = detectEloManipulation(eloHistory);
    if (eloCheck.manipulated) {
      signals.push(`Elo manipulation: ${eloCheck.reason}`);
      riskScore += 15;
    }

    const ratingHistory = userData.ratingHistory ?? [];
    const ratingCheck = detectRatingManipulation(ratingHistory);
    if (ratingCheck.manipulated) {
      signals.push(`Rating manipulation: ${ratingCheck.reason}`);
      riskScore += 15;
    }

    const conversationSample: Array<{ text: string; timestamp: number; isFromUser: boolean }> = userData.recentConversationSample ?? [];
    const escalationCheck = detectFastEscalation(conversationSample);
    if (escalationCheck.escalatesQuickly) {
      signals.push(`Fast escalation: ${escalationCheck.signals.join(', ')}`);
      riskScore += 20;
    }

    const locationHistory: Array<{ latitude: number; longitude: number; timestamp: number }> = userData.locationHistory ?? [];
    let geographicAnomalySignal = false;
    if (locationHistory.length >= 2) {
      const latest = locationHistory[locationHistory.length - 1]!;
      const previous = locationHistory[locationHistory.length - 2]!;
      const travelCheck = detectImpossibleTravel(previous, latest);
      if (travelCheck.impossible) {
        signals.push(travelCheck.reason ?? 'Geographic impossibility detected');
        geographicAnomalySignal = true;
        riskScore += 20;
      }
    }

    riskScore = Math.min(100, riskScore);
    const overallRisk: BehaviorReport['overallRisk'] = riskScore >= 70 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 25 ? 'medium' : 'low';

    if (overallRisk === 'critical' || overallRisk === 'high') {
      await writeAuditLog('safety.content_flagged', { targetId, riskLevel: overallRisk, score: riskScore, signals }, targetId).catch(() => {});
    }

    return {
      userId: targetId,
      romanceScamScore: riskScore,
      unmatchRate,
      reportRate,
      isGhostProfile,
      agePredatorSignal: ageCheck.suspicious,
      escalatesConversationFast: escalationCheck.escalatesQuickly,
      refusesVideoCalls: false,
      botTimingSignal: timingCheck.isBot,
      ratingManipulationSignal: ratingCheck.manipulated,
      geographicAnomalySignal,
      overallRisk,
      signals,
    };
  } catch (e) {
    logger.error('[datingStats] generateBehaviorReport:', e);
    return {
      userId: targetId,
      romanceScamScore: 0,
      unmatchRate: 0,
      reportRate: 0,
      isGhostProfile: false,
      agePredatorSignal: false,
      escalatesConversationFast: false,
      refusesVideoCalls: false,
      botTimingSignal: false,
      ratingManipulationSignal: false,
      geographicAnomalySignal: false,
      overallRisk: 'low',
      signals: [],
    };
  }
}

export async function calculateDatingStats(): Promise<DatingStats> {
  const user = auth.currentUser;
  if (!user) return emptyStats();

  try {
    const [userDoc, likesSentSnap, likesReceivedSnap, matchesSnap, chatsSnap, ratingsSnap] = await Promise.all([
      getDoc(doc(db, 'users', user.uid)),
      getDocs(query(collection(db, 'likes'), where('fromUserId', '==', user.uid))),
      getDocs(query(collection(db, 'likes'), where('toUserId', '==', user.uid))),
      getDocs(query(collection(db, 'likes'), where('fromUserId', '==', user.uid), where('status', '==', 'matched'))),
      getDocs(collection(db, 'chats')),
      getDocs(query(collection(db, 'ratings'), where('ratedUserId', '==', user.uid))),
    ]);

    const userData = userDoc.exists() ? userDoc.data() : {};
    const likesSent = likesSentSnap.size;
    const likesReceived = likesReceivedSnap.size;
    const totalMatches = matchesSnap.size;
    const matchRate = likesSent > 0 ? (totalMatches / likesSent) * 100 : 0;

    const activeMatchResults = await Promise.all(
      matchesSnap.docs.map(async matchDoc => {
        try {
          const data = matchDoc.data();
          const otherId = data.toUserId as string;
          const chatId = [user.uid, otherId].sort().join('_');
          const messages = await getDocs(collection(db, 'chats', chatId, 'messages'));
          return messages.empty ? 0 : 1;
        } catch {
          return 0;
        }
      })
    );
    const activeMatches = activeMatchResults.reduce((s, v) => s + v, 0);

    const userChats = chatsSnap.docs.filter(d => d.id.includes(user.uid));
    const chatMessageSnaps = await Promise.all(
      userChats.map(chatDoc => getDocs(collection(db, 'chats', chatDoc.id, 'messages')).catch(() => null))
    );

    let messagesSent = 0;
    let messagesReceived = 0;
    const messageTimes: number[] = [];

    for (const snap of chatMessageSnaps) {
      if (!snap) continue;
      snap.forEach(m => {
        const data = m.data();
        if (data.senderId === user.uid) {
          messagesSent++;
          if (data.createdAt?.toMillis) messageTimes.push(data.createdAt.toMillis());
        } else {
          messagesReceived++;
        }
      });
    }

    const timingCheck = analyzeMessageTiming(messageTimes);
    if (timingCheck.isBot) logger.warn('[datingStats] Bot-like timing detected');

    const peakActivityHour = messageTimes.length > 0
      ? (() => {
          const hourCounts = new Array<number>(24).fill(0);
          messageTimes.forEach(t => { hourCounts[new Date(t).getHours()]!++; });
          return hourCounts.indexOf(Math.max(...hourCounts));
        })()
      : 0;

    const profileViews = userData.profileViews ?? 0;
    const createdAt = userData.createdAt ? new Date(userData.createdAt) : new Date();
    const daysSinceJoin = Math.max(1, Math.floor((Date.now() - createdAt.getTime()) / 86_400_000));
    const ratingsData = userData.ratings ?? {};

    let meetupCount = 0;
    let secondDateCount = 0;
    ratingsSnap.forEach(r => {
      const data = r.data();
      if (data.didYouMeet) meetupCount++;
      if (data.wouldMeetAgain) secondDateCount++;
    });

    return {
      likesSent,
      likesReceived,
      matchRate: Math.round(matchRate),
      totalMatches,
      activeMatches,
      expiredMatches: totalMatches - activeMatches,
      profileViews,
      profileViewRate: Math.round((profileViews / daysSinceJoin) * 10) / 10,
      bestPhoto: null,
      averageResponseTime: 0,
      messagesSent,
      messagesReceived,
      conversationRate: totalMatches > 0 ? Math.round((activeMatches / totalMatches) * 100) : 0,
      averageRating: Math.round((ratingsData.averageOverall ?? 0) * 10) / 10,
      totalRatings: ratingsData.totalRatings ?? 0,
      trustScore: ratingsData.trustScore ?? 0,
      peakActivityHour,
      averageSwipesPerDay: Math.round((likesSent / daysSinceJoin) * 10) / 10,
      meetupRate: totalMatches > 0 ? Math.round((meetupCount / totalMatches) * 100) : 0,
      secondDateRate: meetupCount > 0 ? Math.round((secondDateCount / meetupCount) * 100) : 0,
    };
  } catch (e) {
    logger.error('[datingStats] calculateDatingStats:', e);
    return emptyStats();
  }
}

function emptyStats(): DatingStats {
  return {
    likesSent: 0,
    likesReceived: 0,
    matchRate: 0,
    totalMatches: 0,
    activeMatches: 0,
    expiredMatches: 0,
    profileViews: 0,
    profileViewRate: 0,
    bestPhoto: null,
    averageResponseTime: 0,
    messagesSent: 0,
    messagesReceived: 0,
    conversationRate: 0,
    averageRating: 0,
    totalRatings: 0,
    trustScore: 0,
    peakActivityHour: 0,
    averageSwipesPerDay: 0,
    meetupRate: 0,
    secondDateRate: 0,
  };
}

export function getMatchRateLevel(rate: number): { level: string; color: string; message: string } {
  if (rate >= 50) return { level: 'Excellent', color: '#27ae60', message: "🔥 You're crushing it!" };
  if (rate >= 30) return { level: 'Great', color: '#5cb85c', message: '👍 Above average match rate.' };
  if (rate >= 15) return { level: 'Good', color: '#f1c40f', message: '✓ Solid. Keep improving!' };
  if (rate >= 5) return { level: 'Average', color: '#e67e22', message: '📈 Room for improvement.' };
  return { level: 'Low', color: '#d9534f', message: '⚠️ Profile needs work.' };
}

export function getConversationRateLevel(rate: number): { level: string; color: string; message: string } {
  if (rate >= 80) return { level: 'Excellent', color: '#27ae60', message: '💬 Great conversationalist!' };
  if (rate >= 60) return { level: 'Good', color: '#5cb85c', message: '👍 Most matches lead to conversations.' };
  if (rate >= 40) return { level: 'Average', color: '#f1c40f', message: '📝 Try better opening lines!' };
  return { level: 'Low', color: '#d9534f', message: "⚠️ Send the first message!" };
}