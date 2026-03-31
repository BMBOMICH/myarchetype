/**
 * utils/datingStats.ts
 * Detectors: #97 #99 #100 #101 #102 #103 #104 #105 #107 #112 #114 #115 #116
 */
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { detectImpossibleTravel } from './location';
import { writeAuditLog } from './logger';
import { checkTextSafety } from './moderation';
import { analyzeMessageTiming } from './rateLimiter';

export interface DatingStats {
  likesSent: number; likesReceived: number; matchRate: number; totalMatches: number;
  activeMatches: number; expiredMatches: number; profileViews: number; profileViewRate: number;
  bestPhoto: number | null; averageResponseTime: number; messagesSent: number; messagesReceived: number;
  conversationRate: number; averageRating: number; totalRatings: number; trustScore: number;
  peakActivityHour: number; averageSwipesPerDay: number; meetupRate: number; secondDateRate: number;
}

export interface BehaviorReport {
  userId: string; romanceScamScore: number; unmatchRate: number; reportRate: number;
  isGhostProfile: boolean; agePredatorSignal: boolean; escalatesConversationFast: boolean;
  refusesVideoCalls: boolean; botTimingSignal: boolean; ratingManipulationSignal: boolean;
  geographicAnomalySignal: boolean; overallRisk: 'low' | 'medium' | 'high' | 'critical'; signals: string[];
}

// #103
export function detectAgePredatorPattern(userAge: number, targetAges: number[], minTargetAge = 18): { suspicious: boolean; avgTargetAge: number; ageDiff: number } {
  if (targetAges.length < 5) return { suspicious: false, avgTargetAge: 0, ageDiff: 0 };
  const avgTargetAge = targetAges.reduce((a, b) => a + b, 0) / targetAges.length;
  const ageDiff = userAge - avgTargetAge;
  const allNearMinAge = targetAges.every(a => a <= minTargetAge + 3);
  return { suspicious: ageDiff > 15 && allNearMinAge && targetAges.length >= 10, avgTargetAge: Math.round(avgTargetAge), ageDiff: Math.round(ageDiff) };
}

// #112
export function detectFastEscalation(
  messages: Array<{ text: string; timestamp: number; isFromUser: boolean }>
): { escalatesQuickly: boolean; signalCount: number; signals: string[] } {
  if (messages.length < 3) return { escalatesQuickly: false, signalCount: 0, signals: [] };

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

  let signalCount = 0;
  const signals: string[] = [];
  const firstFive = messages.slice(0, 5);

  for (const msg of firstFive) {
    for (const { re, label } of ESCALATION_PATTERNS) {
      if (re.test(msg.text) && !signals.includes(label)) { signalCount++; signals.push(label); }
    }
  }

  const first = messages[0];
  const fifth = messages[Math.min(4, messages.length - 1)];
  if (first && fifth) {
    const windowMin = (fifth.timestamp - first.timestamp) / 60_000;
    if (windowMin < 5 && signalCount > 1) { signalCount += 2; signals.push('rapid_progression_under_5min'); }
    else if (windowMin < 10 && signalCount > 2) { signalCount += 1; signals.push('rapid_progression_under_10min'); }
  }

  const userMessages = messages.filter(m => m.isFromUser).slice(0, 5);
  let userSignalCount = 0;
  for (const msg of userMessages) {
    for (const { re } of ESCALATION_PATTERNS) { if (re.test(msg.text)) userSignalCount++; }
  }
  if (userSignalCount >= 3) signals.push('one_sided_escalation');

  return { escalatesQuickly: signalCount >= 3, signalCount, signals };
}

// #114
export function detectVideoCallRefusal(interactions: Array<{ type: string; outcome: string }>): { refusalRate: number; suspicious: boolean } {
  const requests = interactions.filter(i => i.type === 'video_call_request');
  const refusals = requests.filter(i => i.outcome === 'declined');
  const refusalRate = requests.length > 0 ? refusals.length / requests.length : 0;
  return { refusalRate, suspicious: refusalRate > 0.8 && requests.length >= 3 };
}

// #105
export function detectEloManipulation(scoreHistory: Array<{ score: number; timestamp: number }>): { manipulated: boolean; reason?: string } {
  if (scoreHistory.length < 5) return { manipulated: false };
  for (let i = 1; i < scoreHistory.length; i++) {
    const prev = scoreHistory[i - 1]!;
    const curr = scoreHistory[i]!;
    const jump = curr.score - prev.score;
    const timeMin = (curr.timestamp - prev.timestamp) / 60_000;
    if (jump > 50 && timeMin < 5) return { manipulated: true, reason: `Score jumped ${jump} points in ${timeMin.toFixed(1)} minutes.` };
  }
  return { manipulated: false };
}

// #107
export function wilsonScoreLowerBound(positiveRatings: number, totalRatings: number, confidence = 1.96): number {
  if (totalRatings === 0) return 0;
  const z = confidence, n = totalRatings, pHat = positiveRatings / n;
  const numerator = pHat + (z*z)/(2*n) - z * Math.sqrt((pHat*(1-pHat) + (z*z)/(4*n)) / n);
  const denominator = 1 + (z*z)/n;
  return Math.max(0, Math.min(1, numerator / denominator));
}

export function detectRatingManipulation(ratings: Array<{ score: number; timestamp: number; raterUserId: string }>): { manipulated: boolean; reason?: string } {
  if (ratings.length < 3) return { manipulated: false };
  const sorted = [...ratings].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 2; i < sorted.length; i++) {
    const window3 = sorted.slice(i - 2, i + 1);
    const first = window3[0]!, last = window3[window3.length - 1]!;
    if ((last.timestamp - first.timestamp) / 60_000 < 2) return { manipulated: true, reason: '3 ratings within 2 minutes — possible coordinated manipulation.' };
  }
  if (ratings.length >= 10) {
    if (ratings.every(r => r.score >= 4.5) || ratings.every(r => r.score <= 1.5)) return { manipulated: true, reason: 'Unusually uniform ratings — possible fake review network.' };
  }
  return { manipulated: false };
}

// #104
export function checkFirstMessageSafety(text: string): { safe: boolean; reason?: string } {
  const check = checkTextSafety(text, 'chat');
  if (!check.safe) return { safe: false, reason: check.reason };
  const FIRST_MSG_EXPLICIT = [
    /\b(sex|fuck|nude|naked|body|boobs?|dick|cock|pussy|ass)\b/i,
    /\b(hook\s*up|one\s*night|friends\s*with\s*benefits|fwb|nsa)\b/i,
    /\b(how\s*big|how\s*hot|your\s*type|dtf)\b/i,
  ];
  for (const p of FIRST_MSG_EXPLICIT) {
    if (p.test(text)) return { safe: false, reason: 'Inappropriate first message. Please be respectful.' };
  }
  return { safe: true };
}

// Full behavior report
export async function generateBehaviorReport(targetUserId: string): Promise<BehaviorReport> {
  const signals: string[] = [];
  let romanceScamScore = 0;

  try {
    const userDoc = await getDoc(doc(db, 'users', targetUserId));
    const userData = userDoc.exists() ? userDoc.data() : {};

    // #102: Ghost profile
    const lastSeenMs = userData.lastSeen?.toMillis?.() ?? 0;
    const daysSinceActive = Math.floor((Date.now() - lastSeenMs) / (1000 * 60 * 60 * 24));
    const isGhost = daysSinceActive > 30 && (!(userData.photos?.length) || !(userData.bio));
    if (isGhost) signals.push('Ghost/inactive profile (30+ days)');

    // #103: Age-gap predator
    const userAge = userData.age ?? 30;
    const likedAges: number[] = userData.likedUserAges ?? [];
    const predatorCheck = detectAgePredatorPattern(userAge, likedAges);
    if (predatorCheck.suspicious) { signals.push(`Consistently targets youngest users (avg age gap: ${predatorCheck.ageDiff}y)`); romanceScamScore += 20; }

    // #115: Bot timing
    const msgTimestamps: number[] = userData.recentMessageTimestamps ?? [];
    const timingCheck = analyzeMessageTiming(msgTimestamps);
    if (timingCheck.isBot) { signals.push(timingCheck.reason ?? 'Bot-like message timing'); romanceScamScore += 30; }

    // #99: Unmatch rate
    const unmatchRate = userData.unmatchRate ?? 0;
    if (unmatchRate > 0.5) { signals.push(`High unmatch rate: ${Math.round(unmatchRate * 100)}%`); romanceScamScore += 10; }

    // #101: Report rate
    const reportRate = userData.reportRate ?? 0;
    if (reportRate > 0.1) { signals.push(`High report rate: ${Math.round(reportRate * 100)}%`); romanceScamScore += 20; }

    // #105: Elo manipulation
    const scoreHistory: Array<{ score: number; timestamp: number }> = userData.eloHistory ?? [];
    const eloCheck = detectEloManipulation(scoreHistory);
    if (eloCheck.manipulated) { signals.push(`Elo manipulation: ${eloCheck.reason}`); romanceScamScore += 15; }

    // #107: Rating manipulation
    const ratingHistory = userData.ratingHistory ?? [];
    const ratingCheck = detectRatingManipulation(ratingHistory);
    if (ratingCheck.manipulated) { signals.push(`Rating manipulation: ${ratingCheck.reason}`); romanceScamScore += 15; }

    // #112: Fast escalation
    const recentMessages: Array<{ text: string; timestamp: number; isFromUser: boolean }> = userData.recentConversationSample ?? [];
    const escalationCheck = detectFastEscalation(recentMessages);
    if (escalationCheck.escalatesQuickly) { signals.push(`Fast escalation: ${escalationCheck.signals.join(', ')}`); romanceScamScore += 20; }

    // #116: Geographic impossibility
    const locationHistory: Array<{ latitude: number; longitude: number; timestamp: number }> = userData.locationHistory ?? [];
    let geographicAnomalySignal = false;
    if (locationHistory.length >= 2) {
      const last = locationHistory[locationHistory.length - 1]!;
      const prev = locationHistory[locationHistory.length - 2]!;
      const travelCheck = detectImpossibleTravel(prev, last);
      if (travelCheck.impossible) { signals.push(travelCheck.reason ?? 'Geographic impossibility detected'); geographicAnomalySignal = true; romanceScamScore += 20; }
    }

    romanceScamScore = Math.min(100, romanceScamScore);
    const overallRisk: BehaviorReport['overallRisk'] = romanceScamScore >= 70 ? 'critical' : romanceScamScore >= 50 ? 'high' : romanceScamScore >= 25 ? 'medium' : 'low';

    if (overallRisk === 'critical' || overallRisk === 'high') {
      await writeAuditLog('safety.content_flagged', { targetId: targetUserId, riskLevel: overallRisk, score: romanceScamScore, signals }, targetUserId).catch(() => {});
    }

    return {
      userId: targetUserId, romanceScamScore, unmatchRate, reportRate,
      isGhostProfile: isGhost, agePredatorSignal: predatorCheck.suspicious,
      escalatesConversationFast: escalationCheck.escalatesQuickly,
      refusesVideoCalls: false, botTimingSignal: timingCheck.isBot,
      ratingManipulationSignal: ratingCheck.manipulated, geographicAnomalySignal, overallRisk, signals,
    };
  } catch (err) {
    console.error('[datingStats] generateBehaviorReport error:', err);
    return { userId: targetUserId, romanceScamScore: 0, unmatchRate: 0, reportRate: 0, isGhostProfile: false, agePredatorSignal: false, escalatesConversationFast: false, refusesVideoCalls: false, botTimingSignal: false, ratingManipulationSignal: false, geographicAnomalySignal: false, overallRisk: 'low', signals: [] };
  }
}

export async function calculateDatingStats(): Promise<DatingStats> {
  const user = auth.currentUser;
  if (!user) return getEmptyStats();
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const userData = userDoc.exists() ? userDoc.data() : {};
    const likesSentSnap = await getDocs(query(collection(db, 'likes'), where('fromUserId', '==', user.uid)));
    const likesSent = likesSentSnap.size;
    const likesReceivedSnap = await getDocs(query(collection(db, 'likes'), where('toUserId', '==', user.uid)));
    const likesReceived = likesReceivedSnap.size;
    const matchesSnap = await getDocs(query(collection(db, 'likes'), where('fromUserId', '==', user.uid), where('status', '==', 'matched')));
    const totalMatches = matchesSnap.size;
    const matchRate = likesSent > 0 ? (totalMatches / likesSent) * 100 : 0;

    let activeMatches = 0;
    for (const matchDoc of matchesSnap.docs) {
      const matchId = matchDoc.data().toUserId;
      const chatId = [user.uid, matchId].sort().join('_');
      const msgSnap = await getDocs(collection(db, 'chats', chatId, 'messages'));
      if (!msgSnap.empty) activeMatches++;
    }

    let messagesSent = 0, messagesReceived = 0;
    const messageTimes: number[] = [];
    const chatsSnap = await getDocs(collection(db, 'chats'));
    for (const chatDoc of chatsSnap.docs) {
      if (!chatDoc.id.includes(user.uid)) continue;
      const msgSnap = await getDocs(collection(db, 'chats', chatDoc.id, 'messages'));
      msgSnap.forEach(m => {
        const d = m.data();
        if (d.senderId === user.uid) { messagesSent++; if (d.createdAt?.toMillis) messageTimes.push(d.createdAt.toMillis()); }
        else messagesReceived++;
      });
    }

    const timingCheck = analyzeMessageTiming(messageTimes);
    if (timingCheck.isBot) console.warn('[datingStats] Bot-like timing in own messages detected');

    const peakActivityHour = messageTimes.length > 0 ? (() => {
      const hourCounts = new Array(24).fill(0) as number[];
      messageTimes.forEach(t => { hourCounts[new Date(t).getHours()]!++; });
      return hourCounts.indexOf(Math.max(...hourCounts));
    })() : 0;

    const profileViews = userData.profileViews ?? 0;
    const accountCreatedAt = userData.createdAt ? new Date(userData.createdAt) : new Date();
    const daysSince = Math.max(1, Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)));
    const ratings = userData.ratings ?? {};
    const ratingsSnap = await getDocs(query(collection(db, 'ratings'), where('ratedUserId', '==', user.uid)));

    let meetups = 0, secondDates = 0;
    ratingsSnap.forEach(r => { const d = r.data(); if (d.didYouMeet) meetups++; if (d.wouldMeetAgain) secondDates++; });

    return {
      likesSent, likesReceived, matchRate: Math.round(matchRate), totalMatches, activeMatches,
      expiredMatches: totalMatches - activeMatches, profileViews,
      profileViewRate: Math.round((profileViews / daysSince) * 10) / 10, bestPhoto: null,
      averageResponseTime: 0, messagesSent, messagesReceived,
      conversationRate: totalMatches > 0 ? Math.round((activeMatches / totalMatches) * 100) : 0,
      averageRating: Math.round((ratings.averageOverall ?? 0) * 10) / 10,
      totalRatings: ratings.totalRatings ?? 0, trustScore: ratings.trustScore ?? 0, peakActivityHour,
      averageSwipesPerDay: Math.round((likesSent / daysSince) * 10) / 10,
      meetupRate: totalMatches > 0 ? Math.round((meetups / totalMatches) * 100) : 0,
      secondDateRate: meetups > 0 ? Math.round((secondDates / meetups) * 100) : 0,
    };
  } catch (error) {
    console.error('[datingStats] calculateDatingStats error:', error);
    return getEmptyStats();
  }
}

function getEmptyStats(): DatingStats {
  return { likesSent:0, likesReceived:0, matchRate:0, totalMatches:0, activeMatches:0, expiredMatches:0, profileViews:0, profileViewRate:0, bestPhoto:null, averageResponseTime:0, messagesSent:0, messagesReceived:0, conversationRate:0, averageRating:0, totalRatings:0, trustScore:0, peakActivityHour:0, averageSwipesPerDay:0, meetupRate:0, secondDateRate:0 };
}

export function getMatchRateLevel(rate: number): { level: string; color: string; message: string } {
  if (rate >= 50) return { level: 'Excellent', color: '#27ae60', message: "🔥 You're crushing it! Your profile is highly attractive." };
  if (rate >= 30) return { level: 'Great', color: '#5cb85c', message: '👍 Doing well! Above average match rate.' };
  if (rate >= 15) return { level: 'Good', color: '#f1c40f', message: '✓ Solid match rate. Keep improving your profile!' };
  if (rate >= 5) return { level: 'Average', color: '#e67e22', message: '📈 Room for improvement. Try better photos or bio.' };
  return { level: 'Low', color: '#d9534f', message: '⚠️ Your profile needs work. Update photos and bio!' };
}

export function getConversationRateLevel(rate: number): { level: string; color: string; message: string } {
  if (rate >= 80) return { level: 'Excellent', color: '#27ae60', message: '💬 Great conversationalist! People love talking to you.' };
  if (rate >= 60) return { level: 'Good', color: '#5cb85c', message: '👍 Most of your matches lead to conversations.' };
  if (rate >= 40) return { level: 'Average', color: '#f1c40f', message: '📝 Try using opening lines or icebreakers more!' };
  return { level: 'Low', color: '#d9534f', message: "⚠️ Send the first message! Don't wait for them." };
}