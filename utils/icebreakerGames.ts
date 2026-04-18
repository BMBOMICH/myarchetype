import * as Crypto from 'expo-crypto';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { checkIcebreakerAnswer, detectEmojiCodedLanguage, detectEmojiSpam } from './moderation';

function secureRandInt(max: number): number {
  const bytes = Crypto.getRandomBytes(4);
  const val = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return val % max;
}

function secureShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}


export const WOULD_YOU_RATHER_QUESTIONS: WouldYouRatherQuestion[] = [
  { a: 'Travel to the past', b: 'Travel to the future' },
  { a: 'Be able to fly', b: 'Be able to read minds' },
  { a: 'Live in the city', b: 'Live in the countryside' },
  { a: 'Have unlimited money', b: 'Have unlimited time' },
  { a: 'Always be 10 minutes late', b: 'Always be 20 minutes early' },
  { a: 'Never use social media again', b: 'Never watch TV/movies again' },
  { a: 'Be famous', b: 'Be rich but unknown' },
  { a: 'Have a rewind button', b: 'Have a pause button' },
  { a: 'Speak every language', b: 'Play every instrument' },
  { a: 'Live without music', b: 'Live without movies' },
  { a: 'Be too hot', b: 'Be too cold' },
  { a: 'Have a personal chef', b: 'Have a personal driver' },
  { a: 'Know how you die', b: 'Know when you die' },
  { a: 'Be invisible', b: 'Be able to teleport' },
  { a: 'Have 3 wishes now', b: 'Have 1 wish in 10 years' },
  { a: 'Beach vacation', b: 'Mountain vacation' },
  { a: 'Sweet food', b: 'Savory food' },
  { a: 'Morning person', b: 'Night owl' },
  { a: 'Read the book', b: 'Watch the movie' },
  { a: 'Text communication', b: 'Call communication' },
  { a: 'Cook dinner together', b: 'Order takeout together' },
  { a: 'First date at a café', b: 'First date at a park' },
  { a: 'Slow dance', b: 'Wild dance' },
  { a: 'Love letter', b: 'Love song' },
  { a: 'Small wedding', b: 'Big wedding' },
  { a: 'Road trip adventure', b: 'Luxury cruise' },
  { a: 'Surprise date night', b: 'Planned date night' },
  { a: 'Stay up talking all night', b: 'Wake up early for sunrise' },
  { a: 'Matching outfits', b: 'Complementary outfits' },
  { a: 'Share one dessert', b: 'Get your own desserts' },
];

export const THIS_OR_THAT_QUESTIONS: ThisOrThatQuestion[] = [
  { a: '☕ Coffee', b: '🍵 Tea' },
  { a: '🐕 Dogs', b: '🐱 Cats' },
  { a: '🏖️ Beach', b: '🏔️ Mountains' },
  { a: '🌅 Sunrise', b: '🌆 Sunset' },
  { a: '📚 Books', b: '🎬 Movies' },
  { a: '🍕 Pizza', b: '🍔 Burger' },
  { a: '🎵 Music', b: '📺 Podcasts' },
  { a: '🏠 Stay in', b: '🎉 Go out' },
  { a: '🌙 Night', b: '☀️ Day' },
  { a: '🍦 Ice cream', b: '🍰 Cake' },
  { a: '🚗 Road trip', b: '✈️ Flying' },
  { a: '🍿 Cinema', b: '📺 Netflix' },
  { a: '💬 Texting', b: '📞 Calling' },
  { a: '🌃 City life', b: '🏡 Suburban life' },
  { a: '🍳 Cooking', b: '🍽️ Eating out' },
  { a: '📱 iPhone', b: '🤖 Android' },
  { a: '🎮 Gaming', b: '🏃 Sports' },
  { a: '💪 Gym', b: '🧘 Yoga' },
  { a: '🎸 Rock', b: '🎤 Pop' },
  { a: '🥗 Healthy', b: '🍟 Junk food' },
  { a: '🎨 Art museum', b: '🎭 Theatre' },
  { a: '🛁 Bath', b: '🚿 Shower' },
  { a: '🌊 Ocean', b: '🏔️ Lake' },
  { a: '🎄 Winter', b: '☀️ Summer' },
  { a: '🧀 Cheese', b: '🍫 Chocolate' },
  { a: '📖 Fiction', b: '📘 Non-fiction' },
  { a: '🎪 Festival', b: '🎵 Concert' },
  { a: '🌮 Tacos', b: '🌯 Burritos' },
  { a: '🏋️ Cardio', b: '💪 Weights' },
  { a: '🧃 Juice', b: '🥤 Smoothie' },
];

export const COMPATIBILITY_QUESTIONS: CompatibilityQuestion[] = [
  { question: 'How do you handle conflict?', options: ['Talk it out immediately','Take space then discuss','Write down feelings first','Seek a compromise quickly'] },
  { question: 'Ideal weekend looks like...', options: ['Adventure outdoors','Cozy day at home','Social gathering','Mix of both active and chill'] },
  { question: 'Love language?', options: ['Words of affirmation','Quality time','Physical touch','Acts of service','Gifts'] },
  { question: 'How important is alone time?', options: ['Need lots of it','Some is good','Prefer being together','Flexible either way'] },
  { question: 'Views on planning?', options: ['Plan everything','Loose plans','Spontaneous','Depends on the situation'] },
  { question: 'Social battery?', options: ['Introvert','Extrovert','Ambivert','Depends on my mood'] },
  { question: 'Communication style?', options: ['Direct and honest','Gentle and diplomatic','Humorous','Thoughtful and measured'] },
  { question: 'Deal with stress by...', options: ['Exercising','Talking to someone','Being alone','Creative outlet','Sleeping it off'] },
  { question: 'In relationships, I value most...', options: ['Trust','Communication','Humor','Adventure','Stability'] },
  { question: 'Morning routine?', options: ['Up early, productive','Slow and relaxed','Snooze 5 times','What routine?'] },
];

export const RAPID_FIRE_QUESTIONS: string[] = [
  'Biggest green flag in a person?',
  "Song that describes your love life?",
  "Worst date you've been on?",
  "Most spontaneous thing you've done?",
  'Guilty pleasure TV show?',
  "Best meal you've ever had?",
  'If you could live anywhere, where?',
  'Hidden talent?',
  'Most controversial food opinion?',
  'Dream vacation destination?',
  'Favorite way to spend a rainy day?',
  'Last thing that made you laugh out loud?',
  'Something on your bucket list?',
  'Unpopular opinion you stand by?',
  'What makes you instantly trust someone?',
  'Favorite childhood memory?',
  "One thing you can't live without?",
  "What are you passionate about?",
  'Biggest pet peeve?',
  'Three words your friends would use to describe you?',
];


export interface WouldYouRatherQuestion { a: string; b: string; }
export interface ThisOrThatQuestion     { a: string; b: string; }
export interface CompatibilityQuestion  { question: string; options: string[]; }
export interface RapidFireQuestion      { question: string; }

type GameQuestion = WouldYouRatherQuestion | ThisOrThatQuestion | CompatibilityQuestion | RapidFireQuestion;


export interface TwoTruthsGame {
  id: string; creatorId: string; matchId: string; statements: string[];
  lieIndex: number; createdAt: string; guessedIndex: number | null;
  guessedAt: string | null; revealed: boolean;
}

export interface GameSession {
  id: string; chatId: string;
  gameType: 'would_you_rather' | 'this_or_that' | 'two_truths' | 'compatibility' | 'rapid_fire';
  currentQuestionIndex: number; player1Id: string; player2Id: string;
  player1Answers: string[]; player2Answers: string[];
  matchCount: number; totalQuestions: number;
  createdAt: string; updatedAt: string;
  status: 'active' | 'completed' | 'expired' | 'abandoned';
  questions?: GameQuestion[];
  compatibilityScore?: number;
}

export interface GameResult {
  gameId: string; gameType: string; player1Id: string; player2Id: string;
  matchCount: number; totalQuestions: number; matchPercentage: number;
  compatibilityScore: number; completedAt: string; highlights: string[];
}

export interface RapidFireRound {
  id: string; chatId: string; senderId: string; receiverId: string;
  question: string; senderAnswer: string; receiverAnswer: string | null;
  createdAt: string; answeredAt: string | null; moderated: boolean;
}

interface FirestoreError { message: string; }
function getErrorMessage(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e
    ? (e as FirestoreError).message
    : 'Unknown error';
}


function moderateGameAnswer(answer: string): { safe: boolean; reason?: string } {
  if (!answer?.trim()) return { safe: true };
  const emojiSpam = detectEmojiSpam(answer, 0.7);
  if (emojiSpam.isSpam) return { safe: false, reason: 'Too many emojis in answer.' };
  const emojiCoded = detectEmojiCodedLanguage(answer);
  if (emojiCoded.detected) return { safe: false, reason: `This content is not allowed: ${emojiCoded.matches[0]?.meaning ?? 'inappropriate content'}.` };
  const textCheck = checkIcebreakerAnswer(answer);
  if (!textCheck.safe) return { safe: false, reason: textCheck.reason ?? 'This answer contains inappropriate content.' };
  if (answer.length > 500) return { safe: false, reason: 'Answer is too long. Please keep it under 500 characters.' };
  return { safe: true };
}

function moderateStatements(statements: string[]): { safe: boolean; reason?: string; failedIndex?: number } {
  for (let i = 0; i < statements.length; i++) {
    const result = moderateGameAnswer(statements[i]!);
    if (!result.safe) return { safe: false, reason: result.reason, failedIndex: i };
  }
  return { safe: true };
}


type StandardGameType = 'would_you_rather' | 'this_or_that' | 'compatibility';

function getQuestionBank(gameType: StandardGameType): GameQuestion[] {
  switch (gameType) {
    case 'would_you_rather': return WOULD_YOU_RATHER_QUESTIONS;
    case 'this_or_that':     return THIS_OR_THAT_QUESTIONS;
    case 'compatibility':    return COMPATIBILITY_QUESTIONS;
  }
}

interface CompatibilityResult {
  matchCount: number; matchPercentage: number; compatibilityScore: number; highlights: string[];
}

function calculateCompatibilityScore(p1Answers: string[], p2Answers: string[], totalQuestions: number): CompatibilityResult {
  let matchCount = 0;
  const highlights: string[] = [];
  const minLen = Math.min(p1Answers.length, p2Answers.length);

  for (let i = 0; i < minLen; i++) { if (p1Answers[i] === p2Answers[i]) matchCount++; }

  const matchPercentage = totalQuestions > 0 ? Math.round((matchCount / totalQuestions) * 100) : 0;

  let weightedScore = 0, totalWeight = 0;
  for (let i = 0; i < minLen; i++) {
    const weight = 1 + (0.1 * (minLen - i));
    totalWeight += weight;
    if (p1Answers[i] === p2Answers[i]) weightedScore += weight;
  }
  const compatibilityScore = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;

  if (matchPercentage >= 80)      highlights.push('🔥 Incredible compatibility! You two are on the same wavelength.');
  else if (matchPercentage >= 60) highlights.push('✨ Great compatibility! You share many preferences.');
  else if (matchPercentage >= 40) highlights.push('🌟 Good balance! You agree on the important stuff.');
  else if (matchPercentage >= 20) highlights.push('🎭 Opposites attract! You bring different perspectives.');
  else                            highlights.push('🌈 Very different tastes — could make for interesting conversations!');

  if (matchCount >= 3) highlights.push(`🤝 You agreed on ${matchCount} out of ${totalQuestions} questions.`);

  return { matchCount, matchPercentage, compatibilityScore, highlights };
}


export async function startGame(chatId: string, matchId: string, gameType: StandardGameType): Promise<{ success: boolean; gameId?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    const existingGame = await getActiveGameForChat(chatId);
    if (existingGame) return { success: false, error: 'There is already an active game in this chat. Complete it first!' };
    const gameId = `${chatId}_${gameType}_${Date.now()}`;
    const questions = secureShuffle(getQuestionBank(gameType)).slice(0, 10);
    const now = new Date().toISOString();
    const session: GameSession = { id: gameId, chatId, gameType, currentQuestionIndex: 0, player1Id: user.uid, player2Id: matchId, player1Answers: [], player2Answers: [], matchCount: 0, totalQuestions: 10, createdAt: now, updatedAt: now, status: 'active', questions };
    await setDoc(doc(db, 'games', gameId), session);
    return { success: true, gameId };
  } catch (e: unknown) {
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function startRapidFire(chatId: string, matchId: string): Promise<{ success: boolean; gameId?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    const gameId = `${chatId}_rapid_fire_${Date.now()}`;
    const questions = secureShuffle(RAPID_FIRE_QUESTIONS).slice(0, 10);
    const now = new Date().toISOString();
    const session: GameSession = {
      id: gameId, chatId, gameType: 'rapid_fire', currentQuestionIndex: 0,
      player1Id: user.uid, player2Id: matchId, player1Answers: [], player2Answers: [],
      matchCount: 0, totalQuestions: 10, createdAt: now, updatedAt: now, status: 'active',
      questions: questions.map(q => ({ question: q })),
    };
    await setDoc(doc(db, 'games', gameId), session);
    return { success: true, gameId };
  } catch (e: unknown) {
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function submitAnswer(gameId: string, answer: string): Promise<{ success: boolean; bothAnswered?: boolean; matched?: boolean; error?: string; gameComplete?: boolean; result?: GameResult }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (answer !== 'a' && answer !== 'b') {
    const modResult = moderateGameAnswer(answer);
    if (!modResult.safe) return { success: false, error: modResult.reason };
  }
  try {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await getDoc(gameRef);
    if (!gameSnap.exists()) return { success: false, error: 'Game not found' };
    const game = gameSnap.data() as GameSession & { questions: GameQuestion[] };
    if (game.status !== 'active') return { success: false, error: 'Game is no longer active' };
    const isPlayer1 = game.player1Id === user.uid;
    const isPlayer2 = game.player2Id === user.uid;
    if (!isPlayer1 && !isPlayer2) return { success: false, error: 'You are not a player in this game' };
    const myAnswers    = isPlayer1 ? game.player1Answers : game.player2Answers;
    const otherAnswers = isPlayer1 ? game.player2Answers : game.player1Answers;
    const questionIndex = myAnswers.length;
    if (questionIndex >= game.totalQuestions) return { success: false, error: 'You have already answered all questions' };
    const newAnswers = [...myAnswers, answer];
    const updates: Record<string, string | number | string[]> = {
      [isPlayer1 ? 'player1Answers' : 'player2Answers']: newAnswers,
      updatedAt: new Date().toISOString(),
    };
    const bothAnswered = otherAnswers.length > questionIndex;
    let matched = false, gameComplete = false;
    let result: GameResult | undefined;
    if (bothAnswered) {
      matched = answer === otherAnswers[questionIndex];
      if (matched) updates['matchCount'] = (game.matchCount ?? 0) + 1;
      const newMatchCount = matched ? (game.matchCount ?? 0) + 1 : game.matchCount ?? 0;
      if (questionIndex + 1 >= game.totalQuestions) {
        updates['status'] = 'completed';
        gameComplete = true;
        const compatibility = calculateCompatibilityScore(
          isPlayer1 ? newAnswers : game.player1Answers,
          isPlayer1 ? game.player2Answers : newAnswers,
          game.totalQuestions,
        );
        updates['compatibilityScore'] = compatibility.compatibilityScore;
        result = {
          gameId: game.id, gameType: game.gameType, player1Id: game.player1Id, player2Id: game.player2Id,
          matchCount: newMatchCount, totalQuestions: game.totalQuestions,
          matchPercentage: compatibility.matchPercentage, compatibilityScore: compatibility.compatibilityScore,
          completedAt: new Date().toISOString(), highlights: compatibility.highlights,
        };
        await setDoc(doc(db, 'gameResults', game.id), result);
      } else {
        updates['currentQuestionIndex'] = questionIndex + 1;
      }
    }
    await updateDoc(gameRef, updates);
    return { success: true, bothAnswered, matched, gameComplete, result };
  } catch (e: unknown) {
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function submitRapidFireAnswer(gameId: string, answer: string): Promise<{ success: boolean; error?: string; bothAnswered?: boolean; gameComplete?: boolean }> {
  const modResult = moderateGameAnswer(answer);
  if (!modResult.safe) return { success: false, error: modResult.reason };
  return submitAnswer(gameId, answer);
}

export async function createTwoTruthsGame(matchId: string, statements: string[], lieIndex: number): Promise<{ success: boolean; gameId?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (!statements || statements.length !== 3) return { success: false, error: 'You must provide exactly 3 statements.' };
  if (lieIndex < 0 || lieIndex > 2) return { success: false, error: 'Lie index must be 0, 1, or 2.' };
  const modResult = moderateStatements(statements);
  if (!modResult.safe) return { success: false, error: `Statement ${(modResult.failedIndex ?? 0) + 1} is not appropriate: ${modResult.reason}` };
  for (let i = 0; i < statements.length; i++) {
    if (statements[i]!.trim().length < 5)   return { success: false, error: `Statement ${i + 1} is too short.` };
    if (statements[i]!.trim().length > 200)  return { success: false, error: `Statement ${i + 1} is too long.` };
  }
  try {
    const gameId = `two_truths_${user.uid}_${matchId}_${Date.now()}`;
    const game: TwoTruthsGame = { id: gameId, creatorId: user.uid, matchId, statements: statements.map(s => s.trim()), lieIndex, createdAt: new Date().toISOString(), guessedIndex: null, guessedAt: null, revealed: false };
    await setDoc(doc(db, 'twoTruthsGames', gameId), game);
    return { success: true, gameId };
  } catch (e: unknown) {
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function guessTwoTruthsLie(gameId: string, guessedIndex: number): Promise<{ success: boolean; correct?: boolean; actualLieIndex?: number; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (guessedIndex < 0 || guessedIndex > 2) return { success: false, error: 'Guess must be 0, 1, or 2.' };
  try {
    const gameRef = doc(db, 'twoTruthsGames', gameId);
    const gameSnap = await getDoc(gameRef);
    if (!gameSnap.exists()) return { success: false, error: 'Game not found' };
    const game = gameSnap.data() as TwoTruthsGame;
    if (game.matchId !== user.uid) return { success: false, error: 'Only the other player can guess.' };
    if (game.guessedIndex !== null) return { success: false, error: 'You already guessed!' };
    await updateDoc(gameRef, { guessedIndex, guessedAt: new Date().toISOString(), revealed: true });
    return { success: true, correct: guessedIndex === game.lieIndex, actualLieIndex: game.lieIndex };
  } catch (e: unknown) {
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getTwoTruthsGame(gameId: string): Promise<TwoTruthsGame | null> {
  try {
    const snap = await getDoc(doc(db, 'twoTruthsGames', gameId));
    return snap.exists() ? snap.data() as TwoTruthsGame : null;
  } catch { return null; }
}

export async function getTwoTruthsForChat(myId: string, matchId: string): Promise<TwoTruthsGame[]> {
  try {
    const games: TwoTruthsGame[] = [];
    const q1 = query(collection(db, 'twoTruthsGames'), where('creatorId', '==', myId), where('matchId', '==', matchId), orderBy('createdAt', 'desc'), limit(10));
    const q2 = query(collection(db, 'twoTruthsGames'), where('creatorId', '==', matchId), where('matchId', '==', myId), orderBy('createdAt', 'desc'), limit(10));
    const [snap1, snap2] = await Promise.all([getDocs(q1).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }), getDocs(q2)]);
    snap1.forEach(d => games.push(d.data() as TwoTruthsGame));
    snap2.forEach(d => games.push(d.data() as TwoTruthsGame));
    return games.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch { return []; }
}

export async function getGameSession(gameId: string): Promise<GameSession | null> {
  try {
    const snap = await getDoc(doc(db, 'games', gameId));
    return snap.exists() ? snap.data() as GameSession : null;
  } catch { return null; }
}

export async function getActiveGameForChat(chatId: string): Promise<GameSession | null> {
  try {
    const q = query(collection(db, 'games'), where('chatId', '==', chatId), where('status', '==', 'active'), limit(1));
    const snap = await getDocs(q);
    return snap.empty ? null : snap.docs[0]!.data() as GameSession;
  } catch { return null; }
}

export async function getGameHistory(chatId: string, maxResults = 20): Promise<GameSession[]> {
  try {
    const q = query(collection(db, 'games'), where('chatId', '==', chatId), orderBy('createdAt', 'desc'), limit(maxResults));
    const snap = await getDocs(q);
    const games: GameSession[] = [];
    snap.forEach(d => games.push(d.data() as GameSession));
    return games;
  } catch { return []; }
}

export async function getGameResult(gameId: string): Promise<GameResult | null> {
  try {
    const snap = await getDoc(doc(db, 'gameResults', gameId));
    return snap.exists() ? snap.data() as GameResult : null;
  } catch { return null; }
}

export async function abandonGame(gameId: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  try {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await getDoc(gameRef);
    if (!gameSnap.exists()) return { success: false, error: 'Game not found' };
    const game = gameSnap.data() as GameSession;
    if (game.player1Id !== user.uid && game.player2Id !== user.uid) return { success: false, error: 'You are not a player in this game' };
    if (game.status !== 'active') return { success: false, error: 'Game is not active' };
    await updateDoc(gameRef, { status: 'abandoned', updatedAt: new Date().toISOString() });
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function expireStaleGames(chatId: string): Promise<number> {
  const STALE_MS = 24 * 60 * 60 * 1000;
  try {
    const q = query(collection(db, 'games'), where('chatId', '==', chatId), where('status', '==', 'active'));
    const snap = await getDocs(q);
    let expired = 0;
    for (const gameDoc of snap.docs) {
      const game = gameDoc.data() as GameSession;
      if (Date.now() - new Date(game.updatedAt || game.createdAt).getTime() > STALE_MS) {
        await updateDoc(gameDoc.ref, { status: 'expired', updatedAt: new Date().toISOString() });
        expired++;
      }
    }
    return expired;
  } catch { return 0; }
}

interface GameStats {
  totalGamesPlayed: number; completedGames: number; overallCompatibility: number;
  favoriteGameType: string | null; totalMatchedAnswers: number; totalQuestions: number;
}

export async function getGameStats(chatId: string): Promise<GameStats> {
  const empty: GameStats = { totalGamesPlayed: 0, completedGames: 0, overallCompatibility: 0, favoriteGameType: null, totalMatchedAnswers: 0, totalQuestions: 0 };
  try {
    const history = await getGameHistory(chatId, 50);
    const completed = history.filter(g => g.status === 'completed');
    if (completed.length === 0) return { ...empty, totalGamesPlayed: history.length };
    const totalMatched = completed.reduce((sum, g) => sum + (g.matchCount ?? 0), 0);
    const totalQ       = completed.reduce((sum, g) => sum + g.totalQuestions, 0);
    const overallCompatibility = totalQ > 0 ? Math.round((totalMatched / totalQ) * 100) : 0;
    const typeCounts: Record<string, number> = {};
    for (const g of completed) typeCounts[g.gameType] = (typeCounts[g.gameType] ?? 0) + 1;
    const favoriteGameType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { totalGamesPlayed: history.length, completedGames: completed.length, overallCompatibility, favoriteGameType, totalMatchedAnswers: totalMatched, totalQuestions: totalQ };
  } catch { return empty; }
}

interface CurrentQuestion {
  question: GameQuestion; questionIndex: number; totalQuestions: number;
  myAnswer: string | null; theyAnswered: boolean; gameType: string;
}

export async function getCurrentQuestion(gameId: string): Promise<CurrentQuestion | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const game = await getGameSession(gameId);
    if (!game || game.status !== 'active' || !game.questions) return null;
    const isPlayer1  = game.player1Id === user.uid;
    const myAnswers   = isPlayer1 ? game.player1Answers : game.player2Answers;
    const theirAnswers = isPlayer1 ? game.player2Answers : game.player1Answers;
    const questionIndex = myAnswers.length;
    if (questionIndex >= game.totalQuestions) return null;
    return {
      question: game.questions[questionIndex]!,
      questionIndex,
      totalQuestions: game.totalQuestions,
      myAnswer: myAnswers[questionIndex] ?? null,
      theyAnswered: theirAnswers.length > questionIndex,
      gameType: game.gameType,
    };
  } catch { return null; }
}

const ICEBREAKER_PROMPTS: string[] = [
  "What's the most adventurous thing on your bucket list? 🌍",
  "If you could have dinner with anyone, dead or alive, who would it be? 🍽️",
  "What's your go-to karaoke song? 🎤",
  "What's the best trip you've ever taken? ✈️",
  "If you won the lottery tomorrow, what's the first thing you'd do? 💰",
  "What's a hobby you've always wanted to pick up? 🎨",
  "What's your most unpopular food opinion? 🍕",
  "Early bird or night owl, and why? 🌙",
  "What's the last show you binged? 📺",
  "If you could instantly master any skill, what would it be? 🧠",
  "What's your love language? 💕",
  "Beach day or mountain hike? 🏖️🏔️",
  "What's something that always makes you smile? 😊",
  "What's your go-to comfort food? 🍜",
  "If you could teleport anywhere right now, where would you go? ✨",
  "What's a fun fact about you that surprises people? 🎉",
  "What's the best concert or event you've been to? 🎵",
  "Do you believe in astrology? What's your sign? ♈",
  "What's your ideal Sunday morning? ☀️",
  "What are you passionate about outside of work? 🔥",
];

export function getRandomIcebreakerPrompt(): string {
  return ICEBREAKER_PROMPTS[secureRandInt(ICEBREAKER_PROMPTS.length)] ?? ICEBREAKER_PROMPTS[0]!;
}

export function getRandomIcebreakerPrompts(count = 3): string[] {
  return secureShuffle(ICEBREAKER_PROMPTS).slice(0, Math.min(count, ICEBREAKER_PROMPTS.length));
}

export function getDailyIcebreakerQuestion(): { question: string; date: string } {
  const today = new Date();
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
  return { question: ICEBREAKER_PROMPTS[dayOfYear % ICEBREAKER_PROMPTS.length] ?? ICEBREAKER_PROMPTS[0]!, date: today.toISOString().split('T')[0]! };
}