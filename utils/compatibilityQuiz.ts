import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  category: string;
}

export const COMPATIBILITY_QUESTIONS: QuizQuestion[] = [
  { id: 1,  question: 'How do you prefer to resolve conflicts?',        options: ['Talk it out immediately', 'Take time to cool off first', 'Write down my thoughts', 'Avoid confrontation'],     category: 'communication' },
  { id: 2,  question: 'How often do you need quality time together?',   options: ['Every day', 'A few times a week', 'Once a week', 'We both need space'],                                        category: 'communication' },
  { id: 3,  question: 'Ideal weekend activity?',                        options: ['Adventure outdoors', 'Cozy day at home', 'Social events', 'Mix of everything'],                                category: 'lifestyle'     },
  { id: 4,  question: 'How important is physical fitness?',             options: ['Very - I work out daily', 'Moderate - few times a week', 'Occasional - when I can', 'Not a priority'],          category: 'lifestyle'     },
  { id: 5,  question: 'Your relationship with social media?',           options: ['Active user', 'Occasional poster', 'Lurker only', 'Barely use it'],                                             category: 'lifestyle'     },
  { id: 6,  question: 'How important is religion/spirituality?',        options: ['Central to my life', 'Somewhat important', 'Not very important', 'Not at all'],                                 category: 'values'        },
  { id: 7,  question: 'Views on having children?',                      options: ['Definitely want kids', 'Open to it', 'Not sure yet', "Don't want kids"],                                        category: 'values'        },
  { id: 8,  question: 'Career vs relationship priority?',               options: ['Career comes first', 'Relationship comes first', 'Equal priority', 'Depends on the situation'],                 category: 'values'        },
  { id: 9,  question: 'Love language?',                                 options: ['Words of affirmation', 'Physical touch', 'Quality time', 'Acts of service', 'Gifts'],                          category: 'romance'       },
  { id: 10, question: 'PDA comfort level?',                             options: ['Love it!', 'Comfortable with it', 'Keep it private', 'Minimal please'],                                        category: 'romance'       },
  { id: 11, question: 'Ideal date night?',                              options: ['Fancy dinner out', 'Home-cooked meal', 'Activity/adventure', 'Netflix and chill'],                              category: 'romance'       },
  { id: 12, question: 'How do you handle finances?',                    options: ['Detailed budgeter', 'General awareness', 'Go with the flow', 'Partner handles it'],                             category: 'practical'     },
  { id: 13, question: 'Cleanliness level?',                             options: ['Spotless always', 'Generally tidy', 'Organized chaos', "Mess doesn't bother me"],                               category: 'practical'     },
  { id: 14, question: 'Morning or night person?',                       options: ['Early bird', 'Night owl', 'Depends on the day', 'Somewhere in between'],                                        category: 'practical'     },
  { id: 15, question: 'Where do you see yourself in 5 years?',          options: ['Married with kids', 'Focused on career', 'Traveling the world', 'Going with the flow'],                        category: 'future'        },
];

export interface QuizSession {
  id: string; chatId: string;
  player1Id: string; player2Id: string;
  player1Answers: Record<number, string>; player2Answers: Record<number, string>;
  player1Completed: boolean; player2Completed: boolean;
  compatibilityScore: number | null;
  categoryScores: Record<string, number> | null;
  createdAt: string; completedAt: string | null;
}

type QuizUpdate = Partial<Pick<QuizSession,
  'player1Answers' | 'player2Answers' | 'player1Completed' | 'player2Completed' |
  'compatibilityScore' | 'categoryScores' | 'completedAt'
>>;

export async function startCompatibilityQuiz(chatId: string, matchId: string): Promise<{ success: boolean; quizId?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false };
  try {
    const quizId = `quiz_${chatId}_${Date.now()}`;
    const quiz: QuizSession = {
      id: quizId, chatId,
      player1Id: user.uid, player2Id: matchId,
      player1Answers: {}, player2Answers: {},
      player1Completed: false, player2Completed: false,
      compatibilityScore: null, categoryScores: null,
      createdAt: new Date().toISOString(), completedAt: null,
    };
    await setDoc(doc(db, 'compatibilityQuizzes', quizId), quiz);
    return { success: true, quizId };
  } catch (error) {
    logger.error('Error starting quiz:', error);
    return { success: false };
  }
}

export async function submitQuizAnswers(
  quizId: string,
  answers: Record<number, string>,
): Promise<{ success: boolean; bothCompleted?: boolean; score?: number }> {
  const user = auth.currentUser;
  if (!user) return { success: false };
  try {
    const quizDoc = await getDoc(doc(db, 'compatibilityQuizzes', quizId));
    if (!quizDoc.exists()) return { success: false };
    const quiz     = quizDoc.data() as QuizSession;
    const isPlayer1 = quiz.player1Id === user.uid;
    const update: QuizUpdate = isPlayer1
      ? { player1Answers: answers, player1Completed: true }
      : { player2Answers: answers, player2Completed: true };
    const otherCompleted = isPlayer1 ? quiz.player2Completed : quiz.player1Completed;
    const otherAnswers   = isPlayer1 ? quiz.player2Answers   : quiz.player1Answers;
    if (otherCompleted) {
      const { overallScore, categoryScores } = calculateQuizCompatibility(answers, otherAnswers);
      update.compatibilityScore = overallScore;
      update.categoryScores     = categoryScores;
      update.completedAt        = new Date().toISOString();
      await updateDoc(doc(db, 'compatibilityQuizzes', quizId), update);
      return { success: true, bothCompleted: true, score: overallScore };
    }
    await updateDoc(doc(db, 'compatibilityQuizzes', quizId), update);
    return { success: true, bothCompleted: false };
  } catch (error) {
    logger.error('Error submitting quiz answers:', error);
    return { success: false };
  }
}

function calculateQuizCompatibility(
  answers1: Record<number, string>,
  answers2: Record<number, string>,
): { overallScore: number; categoryScores: Record<string, number> } {
  const categoryMatches: Record<string, { matches: number; total: number }> = {};
  COMPATIBILITY_QUESTIONS.forEach((q) => {
    if (!categoryMatches[q.category]) categoryMatches[q.category] = { matches: 0, total: 0 };
    categoryMatches[q.category]!.total++;
    if (answers1[q.id] === answers2[q.id]) categoryMatches[q.category]!.matches++;
  });
  const categoryScores: Record<string, number> = {};
  let totalMatches = 0, totalQuestions = 0;
  Object.entries(categoryMatches).forEach(([category, data]) => {
    categoryScores[category] = Math.round((data.matches / data.total) * 100);
    totalMatches   += data.matches;
    totalQuestions += data.total;
  });
  return { overallScore: Math.round((totalMatches / totalQuestions) * 100), categoryScores };
}

export async function getQuizSession(quizId: string): Promise<QuizSession | null> {
  try {
    const quizDoc = await getDoc(doc(db, 'compatibilityQuizzes', quizId));
    if (!quizDoc.exists()) return null;
    return quizDoc.data() as QuizSession;
  } catch (error) {
    logger.error('Error getting quiz session:', error);
    return null;
  }
}

export function getCompatibilityLabel(score: number): { label: string; emoji: string; color: string } {
  if (score >= 90) return { label: 'Soulmates!',           emoji: '💕', color: '#e74c3c' };
  if (score >= 75) return { label: 'Great Match!',         emoji: '🔥', color: '#e67e22' };
  if (score >= 60) return { label: 'Good Compatibility',   emoji: '👍', color: '#5cb85c' };
  if (score >= 40) return { label: 'Some Common Ground',   emoji: '🤔', color: '#f1c40f' };
  return              { label: 'Opposites Attract?',       emoji: '🎲', color: '#9b59b6' };
}
