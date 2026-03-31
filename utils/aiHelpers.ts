/**
 * utils/aiHelpers.ts
 * #59 #97 #98 #109 #110 #111 #113 #114 #58
 */
import * as Crypto from 'expo-crypto';
import type { CatfishInput, CatfishScore } from './faceComparison';
import { computeCatfishScore, computeEnrichedCatfishScore } from './faceComparison';
import { detectAIGeneratedText, detectFinancialRequest, detectOffPlatformRedirect, scoreMessageRisk } from './moderation';

// ─── Secure random ────────────────────────────────────────

function secureRandInt(max: number): number {
  const bytes = Crypto.getRandomBytes(4);
  const val = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return val % max;
}

function secureRandFloat(): number {
  const bytes = Crypto.getRandomBytes(4);
  const val = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return val / 0xFFFFFFFF;
}

function secureShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ─── Types ────────────────────────────────────────────────

export interface RomanceScamScore {
  score: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  signals: string[];
  recommendation: string;
}

export interface ConversationRiskAnalysis {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  signals: string[];
  financialRequestDetected: boolean;
  offPlatformRedirectDetected: boolean;
  loveBombingDetected: boolean;
  cryptoScamDetected: boolean;
  aiGeneratedMessages: number;
  catfishScore?: CatfishScore;
}

// ─── Bio generation ───────────────────────────────────────

const BIO_TEMPLATES = [
  "I'm a {adjective} person who loves {hobby}. When I'm not {activity}, you'll find me {alternative}. Looking for someone who {quality}.",
  "{emoji} {adjective} soul with a passion for {hobby}. My ideal weekend involves {activity} and {alternative}. Let's {quality} together!",
  "Part-time {hobby} enthusiast, full-time {adjective} human. I believe in {quality} and never say no to {activity}.",
  "If you're looking for someone who's {adjective}, loves {hobby}, and can {activity} - swipe right! Bonus points if you {quality}.",
];

const ADJECTIVES = ['adventurous','curious','creative','ambitious','laid-back','spontaneous','thoughtful','genuine','witty','passionate'];
const HOBBIES = ['cooking','traveling','hiking','reading','music','photography','fitness','art','gaming','movies'];
const ACTIVITIES = ['exploring new places','trying new restaurants','binge-watching shows','working out','learning new skills'];
const QUALITIES = ['appreciates good conversations','loves to laugh','is up for adventures','values authenticity','enjoys the little things'];
const EMOJIS = ['✨','🌟','🎯','💫','🌈','☀️','🎭','🎨'];

export interface BioInput { personality: string; interests: string[]; lookingFor: string; }

export function generateBio(input?: BioInput): string {
  const template = BIO_TEMPLATES[secureRandInt(BIO_TEMPLATES.length)] ?? BIO_TEMPLATES[0]!;
  return template
    .replace('{adjective}', ADJECTIVES[secureRandInt(ADJECTIVES.length)] ?? 'genuine')
    .replace('{hobby}', input?.interests?.[0] ?? HOBBIES[secureRandInt(HOBBIES.length)] ?? 'traveling')
    .replace('{activity}', ACTIVITIES[secureRandInt(ACTIVITIES.length)] ?? 'exploring new places')
    .replace('{alternative}', ACTIVITIES[secureRandInt(ACTIVITIES.length)] ?? 'trying new restaurants')
    .replace('{quality}', QUALITIES[secureRandInt(QUALITIES.length)] ?? 'loves to laugh')
    .replace('{emoji}', EMOJIS[secureRandInt(EMOJIS.length)] ?? '✨');
}

export function generateMultipleBios(count = 3): string[] {
  return Array.from({ length: count }, () => generateBio());
}

// ─── Conversation starters ───────────────────────────────

const CONVERSATION_STARTERS = {
  general: [
    "What's the most spontaneous thing you've ever done? 🎲",
    "If you could have dinner with anyone, dead or alive, who would it be? 🍽️",
    "What's your go-to comfort food after a long day? 🍕",
    "Beach vacation or mountain adventure? 🏖️⛰️",
    "What's the last thing that made you laugh out loud? 😂",
    "If you won the lottery tomorrow, what's the first thing you'd do? 💰",
  ],
  personality: {
    'Social Butterfly': [
      "You seem like someone who knows all the best spots in town! Where should we go? 🌃",
      "What's the most memorable party you've ever been to? 🎉",
    ],
    'Thoughtful Soul': [
      "I love deep conversations. What's something you've been thinking about lately? 💭",
      "Do you have a favorite book that changed your perspective? 📚",
    ],
    'Balanced Explorer': [
      "You seem like you have the perfect balance! How do you unwind after an adventure? 🧘",
      "What's on your bucket list that you're most excited about? ✨",
    ],
  },
  interests: {
    cooking: ["What's your signature dish? I'm always looking for new recipes! 👨‍🍳"],
    traveling: ["What's your favorite place you've visited? Where's next on your list? ✈️"],
    fitness: ["What's your workout routine like? I'm always looking for motivation! 💪"],
    music: ["What's your current favorite song on repeat? 🎵"],
    reading: ["Read any good books lately? I need recommendations! 📖"],
  },
};

export function getConversationStarters(theirPersonality?: string, theirInterests?: string[]): string[] {
  const starters: string[] = [...CONVERSATION_STARTERS.general];
  if (theirPersonality && CONVERSATION_STARTERS.personality[theirPersonality as keyof typeof CONVERSATION_STARTERS.personality]) {
    starters.push(...CONVERSATION_STARTERS.personality[theirPersonality as keyof typeof CONVERSATION_STARTERS.personality]);
  }
  if (theirInterests) {
    theirInterests.forEach(interest => {
      const key = interest.toLowerCase();
      const specific = CONVERSATION_STARTERS.interests[key as keyof typeof CONVERSATION_STARTERS.interests];
      if (specific) starters.push(...specific);
    });
  }
  return secureShuffle(starters).slice(0, 5);
}

// ─── Date ideas ───────────────────────────────────────────

const DATE_IDEAS = {
  casual: [
    { idea: "Coffee and a walk in the park ☕🌳", vibe: "relaxed" },
    { idea: "Visit a local farmers market 🥬", vibe: "casual" },
    { idea: "Try a new ice cream shop 🍦", vibe: "sweet" },
    { idea: "Explore a bookstore together 📚", vibe: "intellectual" },
    { idea: "Grab street food and people-watch 🌮", vibe: "adventurous" },
  ],
  active: [
    { idea: "Go hiking at a scenic trail 🥾", vibe: "adventurous" },
    { idea: "Take a bike ride around the city 🚴", vibe: "active" },
    { idea: "Try rock climbing together 🧗", vibe: "challenging" },
    { idea: "Play mini golf or bowling 🎳", vibe: "playful" },
    { idea: "Kayaking or paddleboarding 🛶", vibe: "adventurous" },
  ],
  creative: [
    { idea: "Paint and sip night 🎨🍷", vibe: "creative" },
    { idea: "Take a cooking class together 👨‍🍳", vibe: "interactive" },
    { idea: "Visit an art gallery or museum 🖼️", vibe: "cultural" },
    { idea: "Pottery or craft workshop 🏺", vibe: "hands-on" },
    { idea: "Attend a live music show 🎵", vibe: "energetic" },
  ],
  romantic: [
    { idea: "Sunset picnic at a scenic spot 🌅", vibe: "romantic" },
    { idea: "Stargazing night 🌟", vibe: "intimate" },
    { idea: "Fancy dinner at a rooftop restaurant 🍽️", vibe: "elegant" },
    { idea: "Wine tasting experience 🍷", vibe: "sophisticated" },
    { idea: "Beach day with a bonfire 🔥", vibe: "cozy" },
  ],
};

export interface DateIdea { idea: string; vibe: string; category: string; }

export function getDateIdeas(myLifestyle?: string, theirLifestyle?: string, count = 5): DateIdea[] {
  const allIdeas: DateIdea[] = [];
  Object.entries(DATE_IDEAS).forEach(([category, ideas]) => {
    ideas.forEach(idea => allIdeas.push({ ...idea, category }));
  });

  let sortedIdeas = [...allIdeas];
  if (myLifestyle === 'Fitness' || theirLifestyle === 'Fitness') {
    sortedIdeas.sort((a, b) => (a.category === 'active' ? -1 : b.category === 'active' ? 1 : 0));
  } else if (myLifestyle === 'Homebody' || theirLifestyle === 'Homebody') {
    sortedIdeas.sort((a, b) => (a.category === 'casual' || a.category === 'creative' ? -1 : b.category === 'casual' || b.category === 'creative' ? 1 : 0));
  }

  return secureShuffle(sortedIdeas).slice(0, count);
}

// ─── Photo suggestions ───────────────────────────────────

export interface PhotoSuggestion { index: number; suggestion: string; priority: 'high' | 'medium' | 'low'; }

export function getPhotoSuggestions(photoCount: number): PhotoSuggestion[] {
  const suggestions: PhotoSuggestion[] = [];
  if (photoCount === 0) suggestions.push({ index: 0, suggestion: 'Add at least one clear face photo as your main picture', priority: 'high' });
  if (photoCount === 1) suggestions.push(
    { index: 1, suggestion: 'Add a full-body photo to show your style', priority: 'high' },
    { index: 2, suggestion: 'Add a photo doing something you love', priority: 'medium' }
  );
  if (photoCount === 2) suggestions.push({ index: 2, suggestion: 'Add a photo showing your personality or hobbies', priority: 'medium' });
  if (photoCount >= 1) suggestions.push({ index: 0, suggestion: 'Your first photo should be a clear, smiling face shot', priority: 'high' });
  return suggestions;
}

export const PHOTO_TIPS = [
  '🎯 First photo: Clear face shot with a genuine smile',
  '👔 Second photo: Full body shot showing your style',
  '🎨 Third photo: Doing an activity or hobby you love',
  '❌ Avoid: Group photos, sunglasses, filters, old photos',
  '✅ Use: Natural lighting, recent photos, variety of settings',
];

// ─── Romance scam score (#97) ────────────────────────────

export function scoreRomanceScamRisk(factors: {
  messageHistory: Array<{ text: string; timestamp: number; isFromUser: boolean }>;
  profileCompleteness: number;
  accountAgeDays: number;
  hasVerifiedSelfie: boolean;
  hasVerifiedSocial: boolean;
  askedForMoney: boolean;
  triedToMoveOffPlatform: boolean;
  videoCallRefused: boolean;
  loveBombedUser: boolean;
}): RomanceScamScore {
  let score = 0;
  const signals: string[] = [];

  if (factors.askedForMoney) { score += 40; signals.push('Requested money or financial help'); }
  if (factors.triedToMoveOffPlatform) { score += 25; signals.push('Tried to move conversation off-platform'); }
  if (factors.loveBombedUser) { score += 15; signals.push('Love bombing behavior detected'); }
  if (factors.videoCallRefused) { score += 20; signals.push('Refused video call requests'); }
  if (!factors.hasVerifiedSelfie) { score += 10; signals.push('No selfie verification'); }
  if (factors.accountAgeDays < 7) { score += 10; signals.push('Very new account'); }
  if (factors.profileCompleteness < 40) { score += 5; signals.push('Profile is very incomplete'); }

  for (const msg of factors.messageHistory.filter(m => !m.isFromUser).map(m => m.text)) {
    const risk = scoreMessageRisk(msg);
    if (risk.score > 30) {
      score += Math.round(risk.score * 0.3);
      for (const s of risk.signals) { if (!signals.includes(s)) signals.push(s); }
    }
  }

  score = Math.min(100, score);
  const risk: RomanceScamScore['risk'] = score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  const recommendation = risk === 'critical' ? 'High scam risk. Block and report this user immediately.'
    : risk === 'high' ? 'Several scam signals detected. Be very cautious.'
    : risk === 'medium' ? 'Some suspicious patterns. Proceed carefully.'
    : 'Low risk. Stay safe and trust your instincts.';

  return { score, risk, signals, recommendation };
}

// ─── Re-exports ───────────────────────────────────────────

export { computeCatfishScore, computeEnrichedCatfishScore, detectAIGeneratedText, detectFinancialRequest, detectOffPlatformRedirect };
export type { CatfishInput, CatfishScore };

export function detectCryptoScam(text: string): boolean {
  const risk = scoreMessageRisk(text);
  return risk.signals.some(s => ['investment_scam','crypto_address','scam','financial_solicitation'].includes(s));
}

// ─── Conversation analysis (#58 #97 #98 #109 #110 #111 #113 #114) ──

export function analyzeConversation(
  messages: Array<{ text: string; timestamp: number; senderId: string }>,
  theirUserId: string,
  catfishInput?: Partial<CatfishInput>,
): ConversationRiskAnalysis {
  const signals: string[] = [];
  let riskScore = 0;
  let financialRequestDetected = false;
  let offPlatformRedirectDetected = false;
  let loveBombingDetected = false;
  let cryptoScamDetected = false;
  let aiGeneratedMessages = 0;
  const messageRiskScores: number[] = [];

  for (const msg of messages.filter(m => m.senderId === theirUserId)) {
    const { text } = msg;
    if (detectFinancialRequest(text)) { financialRequestDetected = true; riskScore += 40; if (!signals.includes('Financial request detected')) signals.push('Financial request detected'); }
    if (detectOffPlatformRedirect(text)) { offPlatformRedirectDetected = true; riskScore += 25; if (!signals.includes('Attempting to move off-platform')) signals.push('Attempting to move off-platform'); }
    if (detectCryptoScam(text)) { cryptoScamDetected = true; riskScore += 35; if (!signals.includes('Crypto/investment scam language')) signals.push('Crypto/investment scam language'); }
    if (detectAIGeneratedText(text).likelyAI) { aiGeneratedMessages++; if (aiGeneratedMessages === 3 && !signals.includes('Multiple AI-generated messages')) { signals.push('Multiple AI-generated messages detected'); riskScore += 15; } }
    const msgRisk = scoreMessageRisk(text);
    messageRiskScores.push(msgRisk.score);
    if (msgRisk.signals.includes('love_bombing')) { loveBombingDetected = true; if (!signals.includes('Love bombing patterns')) { signals.push('Love bombing patterns'); riskScore += 15; } }
  }

  riskScore = Math.min(100, riskScore);

  let catfishScore: CatfishScore | undefined;
  if (catfishInput) {
    catfishScore = computeCatfishScore({
      faceMatchConfidence: catfishInput.faceMatchConfidence ?? 50,
      photoConsistencyConfidence: catfishInput.photoConsistencyConfidence ?? 50,
      ...catfishInput,
      askedForMoney: catfishInput.askedForMoney ?? financialRequestDetected,
      triedToMoveOffPlatform: catfishInput.triedToMoveOffPlatform ?? offPlatformRedirectDetected,
      loveBombingDetected: catfishInput.loveBombingDetected ?? loveBombingDetected,
      messageRiskScores,
    });
    if (catfishScore.score > 50) {
      riskScore = Math.min(100, riskScore + Math.round(catfishScore.score * 0.2));
      if (!signals.includes('High catfish likelihood')) signals.push(`High catfish likelihood (${catfishScore.risk})`);
    }
  }

  const overallRisk: ConversationRiskAnalysis['overallRisk'] = riskScore >= 70 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 25 ? 'medium' : 'low';
  return { overallRisk, riskScore, signals, financialRequestDetected, offPlatformRedirectDetected, loveBombingDetected, cryptoScamDetected, aiGeneratedMessages, catfishScore };
}