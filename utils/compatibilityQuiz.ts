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
  // Communication
  { id: 1, question: "How do you prefer to resolve conflicts?", options: ["Talk it out immediately", "Take time to cool off first", "Write down my thoughts", "Avoid confrontation"], category: "communication" },
  { id: 2, question: "How often do you need quality time together?", options: ["Every day", "A few times a week", "Once a week", "We both need space"], category: "communication" },
  
  // Lifestyle
  { id: 3, question: "Ideal weekend activity?", options: ["Adventure outdoors", "Cozy day at home", "Social events", "Mix of everything"], category: "lifestyle" },
  { id: 4, question: "How important is physical fitness?", options: ["Very - I work out daily", "Moderate - few times a week", "Occasional - when I can", "Not a priority"], category: "lifestyle" },
  { id: 5, question: "Your relationship with social media?", options: ["Active user", "Occasional poster", "Lurker only", "Barely use it"], category: "lifestyle" },
  
  // Values
  { id: 6, question: "How important is religion/spirituality?", options: ["Central to my life", "Somewhat important", "Not very important", "Not at all"], category: "values" },
  { id: 7, question: "Views on having children?", options: ["Definitely want kids", "Open to it", "Not sure yet", "Don't want kids"], category: "values" },
  { id: 8, question: "Career vs relationship priority?", options: ["Career comes first", "Relationship comes first", "Equal priority", "Depends on the situation"], category: "values" },
  
  // Romance
  { id: 9, question: "Love language?", options: ["Words of affirmation", "Physical touch", "Quality time", "Acts of service", "Gifts"], category: "romance" },
  { id: 10, question: "PDA comfort level?", options: ["Love it!", "Comfortable with it", "Keep it private", "Minimal please"], category: "romance" },
  { id: 11, question: "Ideal date night?", options: ["Fancy dinner out", "Home-cooked meal", "Activity/adventure", "Netflix and chill"], category: "romance" },
  
  // Practical
  { id: 12, question: "How do you handle finances?", options: ["Detailed budgeter", "General awareness", "Go with the flow", "Partner handles it"], category: "practical" },
  { id: 13, question: "Cleanliness level?", options: ["Spotless always", "Generally tidy", "Organized chaos", "Mess doesn't bother me"], category: "practical" },
  { id: 14, question: "Morning or night person?", options: ["Early bird", "Night owl", "Depends on the day", "Somewhere in between"], category: "practical" },
  
  // Future
  { id: 15, question: "Where do you see yourself in 5 years?", options: ["Married with kids", "Focused on career", "Traveling the world", "Going with the flow"], category: "future" },
];

export interface QuizSession {
  id: string;
  chatId: string;
  player1Id: string;
  player2Id: string;
  player1Answers: { [questionId: number]: string };
  player2Answers: { [questionId: number]: string };
  player1Completed: boolean;
  player2Completed: boolean;
  compatibilityScore: number | null;
  categoryScores: { [category: string]: number } | null;
  createdAt: string;
  completedAt: string | null;
}

export async function startCompatibilityQuiz(
  chatId: string,
  matchId: string
): Promise<{ success: boolean; quizId?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    const quizId = `quiz_${chatId}_${Date.now()}`;

    const quiz: QuizSession = {
      id: quizId,
      chatId,
      player1Id: user.uid,
      player2Id: matchId,
      player1Answers: {},
      player2Answers: {},
      player1Completed: false,
      player2Completed: false,
      compatibilityScore: null,
      categoryScores: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
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
  answers: { [questionId: number]: string }
): Promise<{ success: boolean; bothCompleted?: boolean; score?: number }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    const quizDoc = await getDoc(doc(db, 'compatibilityQuizzes', quizId));
    if (!quizDoc.exists()) return { success: false };

    const quiz = quizDoc.data() as QuizSession;
    const isPlayer1 = quiz.player1Id === user.uid;

    const updateData: any = {};
    if (isPlayer1) {
      updateData.player1Answers = answers;
      updateData.player1Completed = true;
    } else {
      updateData.player2Answers = answers;
      updateData.player2Completed = true;
    }

    // Check if both completed
    const otherCompleted = isPlayer1 ? quiz.player2Completed : quiz.player1Completed;
    const otherAnswers = isPlayer1 ? quiz.player2Answers : quiz.player1Answers;

    if (otherCompleted) {
      // Calculate compatibility
      const { overallScore, categoryScores } = calculateQuizCompatibility(
        answers,
        otherAnswers
      );

      updateData.compatibilityScore = overallScore;
      updateData.categoryScores = categoryScores;
      updateData.completedAt = new Date().toISOString();

      await updateDoc(doc(db, 'compatibilityQuizzes', quizId), updateData);

      return { success: true, bothCompleted: true, score: overallScore };
    }

    await updateDoc(doc(db, 'compatibilityQuizzes', quizId), updateData);

    return { success: true, bothCompleted: false };
  } catch (error) {
    logger.error('Error submitting quiz answers:', error);
    return { success: false };
  }
}

function calculateQuizCompatibility(
  answers1: { [questionId: number]: string },
  answers2: { [questionId: number]: string }
): { overallScore: number; categoryScores: { [category: string]: number } } {
  const categoryMatches: { [category: string]: { matches: number; total: number } } = {};

  COMPATIBILITY_QUESTIONS.forEach((q) => {
    const category = q.category;
    if (!categoryMatches[category]) {
      categoryMatches[category] = { matches: 0, total: 0 };
    }

    categoryMatches[category].total++;

    if (answers1[q.id] === answers2[q.id]) {
      categoryMatches[category].matches++;
    }
  });

  const categoryScores: { [category: string]: number } = {};
  let totalMatches = 0;
  let totalQuestions = 0;

  Object.entries(categoryMatches).forEach(([category, data]) => {
    categoryScores[category] = Math.round((data.matches / data.total) * 100);
    totalMatches += data.matches;
    totalQuestions += data.total;
  });

  const overallScore = Math.round((totalMatches / totalQuestions) * 100);

  return { overallScore, categoryScores };
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
  if (score >= 90) return { label: "Soulmates!", emoji: "💕", color: "#e74c3c" };
  if (score >= 75) return { label: "Great Match!", emoji: "🔥", color: "#e67e22" };
  if (score >= 60) return { label: "Good Compatibility", emoji: "👍", color: "#5cb85c" };
  if (score >= 40) return { label: "Some Common Ground", emoji: "🤔", color: "#f1c40f" };
  return { label: "Opposites Attract?", emoji: "🎲", color: "#9b59b6" };
}