import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

// ========== WOULD YOU RATHER ==========
export const WOULD_YOU_RATHER_QUESTIONS = [
  { a: "Travel to the past", b: "Travel to the future" },
  { a: "Be able to fly", b: "Be able to read minds" },
  { a: "Live in the city", b: "Live in the countryside" },
  { a: "Have unlimited money", b: "Have unlimited time" },
  { a: "Always be 10 minutes late", b: "Always be 20 minutes early" },
  { a: "Never use social media again", b: "Never watch TV/movies again" },
  { a: "Be famous", b: "Be rich but unknown" },
  { a: "Have a rewind button", b: "Have a pause button" },
  { a: "Speak every language", b: "Play every instrument" },
  { a: "Live without music", b: "Live without movies" },
  { a: "Be too hot", b: "Be too cold" },
  { a: "Have a personal chef", b: "Have a personal driver" },
  { a: "Know how you die", b: "Know when you die" },
  { a: "Be invisible", b: "Be able to teleport" },
  { a: "Have 3 wishes now", b: "Have 1 wish in 10 years" },
  { a: "Beach vacation", b: "Mountain vacation" },
  { a: "Sweet food", b: "Savory food" },
  { a: "Morning person", b: "Night owl" },
  { a: "Read the book", b: "Watch the movie" },
  { a: "Text communication", b: "Call communication" },
];

// ========== TWO TRUTHS AND A LIE ==========
export interface TwoTruthsGame {
  id: string;
  creatorId: string;
  matchId: string;
  statements: string[];
  lieIndex: number; // 0, 1, or 2
  createdAt: string;
  guessedIndex: number | null;
  guessedAt: string | null;
  revealed: boolean;
}

// ========== THIS OR THAT ==========
export const THIS_OR_THAT_QUESTIONS = [
  { a: "☕ Coffee", b: "🍵 Tea" },
  { a: "🐕 Dogs", b: "🐱 Cats" },
  { a: "🏖️ Beach", b: "🏔️ Mountains" },
  { a: "🌅 Sunrise", b: "🌆 Sunset" },
  { a: "📚 Books", b: "🎬 Movies" },
  { a: "🍕 Pizza", b: "🍔 Burger" },
  { a: "🎵 Music", b: "📺 Podcasts" },
  { a: "🏠 Stay in", b: "🎉 Go out" },
  { a: "🌙 Night", b: "☀️ Day" },
  { a: "🍦 Ice cream", b: "🍰 Cake" },
  { a: "🚗 Road trip", b: "✈️ Flying" },
  { a: "🍿 Cinema", b: "📺 Netflix" },
  { a: "💬 Texting", b: "📞 Calling" },
  { a: "🌃 City life", b: "🏡 Suburban life" },
  { a: "🍳 Cooking", b: "🍽️ Eating out" },
  { a: "📱 iPhone", b: "🤖 Android" },
  { a: "🎮 Gaming", b: "🏃 Sports" },
  { a: "💪 Gym", b: "🧘 Yoga" },
  { a: "🎸 Rock", b: "🎤 Pop" },
  { a: "🥗 Healthy", b: "🍟 Junk food" },
];

export interface GameSession {
  id: string;
  chatId: string;
  gameType: 'would_you_rather' | 'this_or_that' | 'two_truths';
  currentQuestionIndex: number;
  player1Id: string;
  player2Id: string;
  player1Answers: string[];
  player2Answers: string[];
  matchCount: number;
  totalQuestions: number;
  createdAt: string;
  status: 'active' | 'completed';
}

export async function startGame(
  chatId: string,
  matchId: string,
  gameType: 'would_you_rather' | 'this_or_that'
): Promise<{ success: boolean; gameId?: string; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };

  try {
    const gameId = `${chatId}_${gameType}_${Date.now()}`;
    
    const questions = gameType === 'would_you_rather' 
      ? WOULD_YOU_RATHER_QUESTIONS 
      : THIS_OR_THAT_QUESTIONS;

    // Shuffle and pick 10 random questions
    const shuffled = [...questions].sort(() => Math.random() - 0.5);
    const selectedQuestions = shuffled.slice(0, 10);

    const gameSession: GameSession = {
      id: gameId,
      chatId,
      gameType,
      currentQuestionIndex: 0,
      player1Id: user.uid,
      player2Id: matchId,
      player1Answers: [],
      player2Answers: [],
      matchCount: 0,
      totalQuestions: 10,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    await setDoc(doc(db, 'games', gameId), {
      ...gameSession,
      questions: selectedQuestions,
    });

    return { success: true, gameId };
  } catch (error: any) {
    console.error('Error starting game:', error);
    return { success: false, error: error.message };
  }
}

export async function submitAnswer(
  gameId: string,
  answer: string
): Promise<{ success: boolean; bothAnswered?: boolean; matched?: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    const gameDoc = await getDoc(doc(db, 'games', gameId));
    if (!gameDoc.exists()) return { success: false };

    const game = gameDoc.data() as GameSession & { questions: any[] };
    const isPlayer1 = game.player1Id === user.uid;

    const currentAnswers = isPlayer1 ? game.player1Answers : game.player2Answers;
    const otherAnswers = isPlayer1 ? game.player2Answers : game.player1Answers;

    // Add answer
    const newAnswers = [...currentAnswers, answer];

    const updateData: any = {};
    if (isPlayer1) {
      updateData.player1Answers = newAnswers;
    } else {
      updateData.player2Answers = newAnswers;
    }

    // Check if both have answered this question
    const questionIndex = currentAnswers.length;
    const bothAnswered = otherAnswers.length > questionIndex;

    if (bothAnswered) {
      // Check if answers match
      const otherAnswer = otherAnswers[questionIndex];
      if (answer === otherAnswer) {
        updateData.matchCount = (game.matchCount || 0) + 1;
      }

      // Move to next question or complete
      if (questionIndex + 1 >= game.totalQuestions) {
        updateData.status = 'completed';
      } else {
        updateData.currentQuestionIndex = questionIndex + 1;
      }
    }

    await updateDoc(doc(db, 'games', gameId), updateData);

    return { 
      success: true, 
      bothAnswered,
      matched: bothAnswered && otherAnswers[questionIndex] === answer,
    };
  } catch (error) {
    console.error('Error submitting answer:', error);
    return { success: false };
  }
}

export async function getGameSession(gameId: string): Promise<GameSession | null> {
  try {
    const gameDoc = await getDoc(doc(db, 'games', gameId));
    if (!gameDoc.exists()) return null;
    return gameDoc.data() as GameSession;
  } catch (error) {
    console.error('Error getting game session:', error);
    return null;
  }
}

export async function createTwoTruthsGame(
  matchId: string,
  statements: string[],
  lieIndex: number
): Promise<{ success: boolean; gameId?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  if (statements.length !== 3 || lieIndex < 0 || lieIndex > 2) {
    return { success: false };
  }

  try {
    const gameId = `two_truths_${user.uid}_${matchId}_${Date.now()}`;

    const game: TwoTruthsGame = {
      id: gameId,
      creatorId: user.uid,
      matchId,
      statements,
      lieIndex,
      createdAt: new Date().toISOString(),
      guessedIndex: null,
      guessedAt: null,
      revealed: false,
    };

    await setDoc(doc(db, 'twoTruthsGames', gameId), game);

    return { success: true, gameId };
  } catch (error) {
    console.error('Error creating two truths game:', error);
    return { success: false };
  }
}

export async function guessTwoTruths(
  gameId: string,
  guessedIndex: number
): Promise<{ success: boolean; correct?: boolean }> {
  try {
    const gameDoc = await getDoc(doc(db, 'twoTruthsGames', gameId));
    if (!gameDoc.exists()) return { success: false };

    const game = gameDoc.data() as TwoTruthsGame;

    await updateDoc(doc(db, 'twoTruthsGames', gameId), {
      guessedIndex,
      guessedAt: new Date().toISOString(),
      revealed: true,
    });

    return { 
      success: true, 
      correct: guessedIndex === game.lieIndex,
    };
  } catch (error) {
    console.error('Error guessing two truths:', error);
    return { success: false };
  }
}

export function calculateCompatibilityFromGame(matchCount: number, totalQuestions: number): number {
  return Math.round((matchCount / totalQuestions) * 100);
}