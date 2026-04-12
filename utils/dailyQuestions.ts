// utils/dailyQuestions.ts
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { checkDailyQuestionAnswer, detectEmojiCodedLanguage, detectEmojiSpam } from './moderation';
import { logger } from './logger';

export interface DailyQuestion { id: string; question: string; date: string; category: string; }
export interface UserAnswer { questionId: string; answer: string; answeredAt: string; }

const QUESTIONS: DailyQuestion[] = [
  { id: '1', question: 'If you could have dinner with anyone, dead or alive, who would it be?', date: '', category: 'fun' },
  { id: '2', question: "What's the most spontaneous thing you've ever done?", date: '', category: 'adventure' },
  { id: '3', question: 'What song always puts you in a good mood?', date: '', category: 'music' },
  { id: '4', question: "What's your go-to comfort food?", date: '', category: 'food' },
  { id: '5', question: 'If you could live anywhere in the world, where would it be?', date: '', category: 'travel' },
  { id: '6', question: "What's the best advice you've ever received?", date: '', category: 'life' },
  { id: '7', question: "What's your favorite way to spend a lazy Sunday?", date: '', category: 'lifestyle' },
  { id: '8', question: "What's something you're terrible at but love doing anyway?", date: '', category: 'fun' },
  { id: '9', question: 'What childhood memory makes you smile?', date: '', category: 'nostalgia' },
  { id: '10', question: "What's the most beautiful place you've ever been?", date: '', category: 'travel' },
  { id: '11', question: 'If you could master any skill instantly, what would it be?', date: '', category: 'fun' },
  { id: '12', question: "What's your guilty pleasure TV show or movie?", date: '', category: 'entertainment' },
  { id: '13', question: 'What makes you laugh every single time?', date: '', category: 'fun' },
  { id: '14', question: "What's the best gift you've ever received?", date: '', category: 'life' },
  { id: '15', question: 'If you could only eat one cuisine for the rest of your life, what would it be?', date: '', category: 'food' },
  { id: '16', question: "What's something you believe that most people don't?", date: '', category: 'life' },
  { id: '17', question: "What's your favorite season and why?", date: '', category: 'lifestyle' },
  { id: '18', question: "What's the last thing that made you feel really proud?", date: '', category: 'life' },
  { id: '19', question: 'If you could have any superpower, what would you choose?', date: '', category: 'fun' },
  { id: '20', question: "What's your perfect date night?", date: '', category: 'romance' },
  { id: '21', question: 'What book changed your perspective on life?', date: '', category: 'books' },
  { id: '22', question: "What's the best concert or live show you've been to?", date: '', category: 'music' },
  { id: '23', question: 'What do you do when you need to de-stress?', date: '', category: 'wellness' },
  { id: '24', question: "What's your earliest memory?", date: '', category: 'nostalgia' },
  { id: '25', question: 'If you could relive one day of your life, which would it be?', date: '', category: 'nostalgia' },
  { id: '26', question: 'What do you want to learn this year?', date: '', category: 'goals' },
  { id: '27', question: 'What makes you feel most alive?', date: '', category: 'life' },
  { id: '28', question: "What's your favorite family tradition?", date: '', category: 'family' },
  { id: '29', question: "What's the most adventurous thing on your bucket list?", date: '', category: 'adventure' },
  { id: '30', question: 'What small thing always makes your day better?', date: '', category: 'life' },
];

export function getTodaysQuestion(): DailyQuestion {
  const today = new Date();
  const q = QUESTIONS[(today.getDate() - 1) % QUESTIONS.length]!;
  return { ...q, date: today.toISOString().split('T')[0]! };
}

export async function getUserAnswer(userId: string, questionId: string): Promise<UserAnswer | null> {
  try {
    const d = await getDoc(doc(db, 'dailyAnswers', `${userId}_${questionId}`));
    if (!d.exists()) return null;
    const data = d.data();
    return { questionId: data.questionId, answer: data.answer, answeredAt: data.answeredAt };
  } catch { return null; }
}

export async function saveUserAnswer(questionId: string, answer: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not logged in' };
  if (!answer.trim()) return { success: false, error: 'Answer cannot be empty.' };
  if (answer.length > 500) return { success: false, error: 'Answer must be under 500 characters.' };
  const es = detectEmojiSpam(answer, 0.6);
  if (es.isSpam) return { success: false, error: 'Too many emojis. Please write a real answer.' };
  // #53: emoji-coded language
  const ec = detectEmojiCodedLanguage(answer);
  if (ec.detected) return { success: false, error: 'This content is not allowed.' };
  const m = checkDailyQuestionAnswer(answer);
  if (!m.safe) return { success: false, error: m.reason };
  try {
    const today = new Date().toISOString().split('T')[0]!;
    await setDoc(doc(db, 'dailyAnswers', `${user.uid}_${questionId}`), { userId: user.uid, questionId, answer: answer.trim(), answeredAt: new Date().toISOString(), date: today });
    await setDoc(doc(db, 'users', user.uid), { dailyQuestion: { questionId, answer: answer.trim(), date: today } }, { merge: true });
    return { success: true };
  } catch (e) { logger.error('[dailyQuestions] saveUserAnswer error:', e); return { success: false, error: 'Failed to save answer' }; }
}

export async function hasAnsweredToday(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const d = await getDoc(doc(db, 'users', user.uid));
    return d.exists() ? d.data().dailyQuestion?.date === new Date().toISOString().split('T')[0] : false;
  } catch { return false; }
}

export function getQuestionEmoji(category: string): string {
  const map: Record<string, string> = { fun: '🎉', adventure: '🏔️', music: '🎵', food: '🍕', travel: '✈️', life: '💭', lifestyle: '🏡', nostalgia: '🕰️', entertainment: '🎬', romance: '💕', books: '📚', wellness: '🧘', goals: '🎯', family: '👨‍👩‍👧‍👦' };
  return map[category] ?? '❓';
}

export function getQuestionById(id: string): DailyQuestion | null { return QUESTIONS.find(q => q.id === id) ?? null; }
export function getQuestionsByCategory(category: string): DailyQuestion[] { return QUESTIONS.filter(q => q.category === category); }