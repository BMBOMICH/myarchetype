import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';
import { deriveVerificationLevel, getVerificationBadgeConfig } from './profileCompletion';

export interface ProfileStrengthResult {
  score: number; maxScore: number; percentage: number;
  level: 'Weak' | 'Basic' | 'Good' | 'Strong' | 'Excellent'; color: string;
  criteria: Array<{ completed: boolean; label: string; points: number; icon: string; tip?: string }>;
  recommendations: string[]; isGhostProfile: boolean; isNewAccount: boolean;
  accountAgeDays: number; verificationBadge: ReturnType<typeof getVerificationBadgeConfig>;
}

// #102: Ghost profile detection
export function detectGhostProfile(data: { lastSeen?: { toMillis?: () => number } | string; photos?: string[]; bio?: string }): { isGhost: boolean; daysSinceActive: number } {
  const lastMs = typeof data.lastSeen === 'object' && data.lastSeen !== null && typeof data.lastSeen.toMillis === 'function'
    ? data.lastSeen.toMillis()
    : data.lastSeen ? new Date(data.lastSeen as string).getTime() : 0;
  const days = lastMs ? Math.floor((Date.now() - lastMs) / 86_400_000) : 9999;
  const minimal = (!data.photos || data.photos.length === 0) || (!data.bio || data.bio.length < 10);
  return { isGhost: days > 30 && minimal, daysSinceActive: days };
}

// #174: Account age gate
export function checkAccountAgeGate(createdAt?: string | number, action?: string): { allowed: boolean; isNew: boolean; ageDays: number; hoursRemaining: number; restrictions: string[] } {
  const created = typeof createdAt === 'number' ? createdAt : createdAt ? new Date(createdAt).getTime() : Date.now();
  const ageMs = Date.now() - created;
  const ageDays = Math.floor(ageMs / 86_400_000);
  const ageHours = ageMs / 3_600_000;
  const restrictions: string[] = [];
  let minHours = 0;
  if (action === 'chat' || action === 'message') minHours = 1;
  else if (action === 'story' || action === 'post') minHours = 24;
  else if (action === 'superlike') minHours = 72;
  if (ageDays < 1) { restrictions.push('Super likes unavailable for first 24 hours'); restrictions.push('Limited to 50 swipes per day'); }
  else if (ageDays < 3) restrictions.push('Super likes available after 3 days');
  else if (ageDays < 7) restrictions.push('Profile boost available after 7 days');
  const allowed = ageHours >= minHours;
  return { allowed, isNew: ageDays < 7, ageDays, hoursRemaining: allowed ? 0 : Math.ceil(minHours - ageHours), restrictions };
}
export const accountAgeGate = checkAccountAgeGate;

// #155: Trust score decay
export function applyTrustDecay(currentScore: number, violations: Array<{ timestamp: string; severity: 'low' | 'medium' | 'high' | 'critical' }>, windowDays = 30): number {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const rates: Record<string, number> = { low: 2, medium: 5, high: 15, critical: 30 };
  let decay = 0;
  for (const v of violations) { if (new Date(v.timestamp).getTime() > cutoff) decay += rates[v.severity] ?? 5; }
  return Math.max(0, currentScore - decay);
}
export const trustDecay = applyTrustDecay;
export const scoreDecay = applyTrustDecay;

interface UserData {
  photos?: string[]; videoProfile?: unknown; bio?: string; icebreaker?: unknown;
  dailyQuestion?: { date?: string }; personalityType?: unknown; selfieVerified?: boolean;
  height?: { verificationMethod?: string }; ageVerification?: { verified?: boolean };
  lastSeen?: { toMillis?: () => number } | string; lastPhotoUpdate?: string;
  violations?: Array<{ timestamp: string; severity: 'low' | 'medium' | 'high' | 'critical' }>;
  createdAt?: string;
}

export async function calculateProfileStrength(): Promise<ProfileStrengthResult> {
  const user = auth.currentUser;
  const def: ProfileStrengthResult = { score: 0, maxScore: 100, percentage: 0, level: 'Weak', color: '#d9534f', criteria: [], recommendations: ['Please log in'], isGhostProfile: false, isNewAccount: false, accountAgeDays: 0, verificationBadge: getVerificationBadgeConfig('none') };
  if (!user) return def;
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { ...def, recommendations: ['Profile not found'] };
    const data = userDoc.data() as UserData;
    const criteria: ProfileStrengthResult['criteria'] = [];
    let score = 0;
    const add = (completed: boolean, label: string, points: number, icon: string, tip?: string) => { criteria.push({ completed, label, points, icon, tip }); if (completed) score += points; };
    add((data.photos?.length ?? 0) >= 1, 'Main profile photo', 10, '📷', 'Add a clear photo');
    add((data.photos?.length ?? 0) >= 3, '3+ photos', 10, '🖼️', 'Add more photos');
    add(!!data.videoProfile, 'Video profile', 10, '🎥', 'Record a 15s video intro');
    add((data.bio?.length ?? 0) >= 50, 'Bio (50+ chars)', 8, '✍️', 'Write a meaningful bio');
    add(!!data.icebreaker, 'Icebreaker prompt', 7, '💬', 'Answer an icebreaker');
    add(data.dailyQuestion?.date === new Date().toISOString().split('T')[0], "Today's question", 5, '💭', 'Answer the daily question');
    add(!!data.personalityType, 'Personality quiz', 10, '🧠', 'Take the personality quiz');
    add(!!data.selfieVerified, 'Selfie verified', 10, '✓', 'Verify with a selfie');
    add(typeof data.height === 'object' && data.height?.verificationMethod === 'manual-measured', 'Height verified', 8, '📏', 'Verify your height');
    add(!!data.ageVerification?.verified, 'Age verified', 7, '🎂', 'Verify your age');
    const lastMs = typeof data.lastSeen === 'object' && data.lastSeen !== null && typeof data.lastSeen.toMillis === 'function' ? data.lastSeen.toMillis() : 0;
    add(Date.now() - lastMs < 7 * 86_400_000, 'Active in 7 days', 5, '🟢', 'Stay active');
    const photoAge = data.lastPhotoUpdate ? (Date.now() - new Date(data.lastPhotoUpdate).getTime()) / 86_400_000 : 999;
    add(photoAge < 180, 'Photos updated recently', 5, '🔄', 'Update photos every 6 months');
    score = applyTrustDecay(score, data.violations ?? []);
    const pct = Math.round((score / 100) * 100);
    let level: ProfileStrengthResult['level'], color: string;
    if (pct < 30) { level = 'Weak'; color = '#d9534f'; }
    else if (pct < 50) { level = 'Basic'; color = '#e67e22'; }
    else if (pct < 70) { level = 'Good'; color = '#f1c40f'; }
    else if (pct < 85) { level = 'Strong'; color = '#5cb85c'; }
    else { level = 'Excellent'; color = '#27ae60'; }
    const recs = criteria.filter(c => !c.completed).sort((a, b) => b.points - a.points).slice(0, 3).map(c => c.tip ?? '').filter(Boolean);
    if (!recs.length) recs.push('Your profile is excellent! Keep staying active.');
    const ghost = detectGhostProfile(data);
    const age = checkAccountAgeGate(data.createdAt);
    return { score, maxScore: 100, percentage: pct, level, color, criteria, recommendations: recs, isGhostProfile: ghost.isGhost, isNewAccount: age.isNew, accountAgeDays: age.ageDays, verificationBadge: getVerificationBadgeConfig(deriveVerificationLevel(data)) };
  } catch (e: unknown) { logger.error('[profileStrength] Error:', e); return def; }
}

export function getStrengthMessage(level: string): string {
  const msgs: Record<string, string> = { Excellent: '🌟 Outstanding! Maximum visibility!', Strong: '💪 Great profile! Just a few tweaks.', Good: '👍 Solid! Add more to stand out.', Basic: '📝 Getting there! Complete more sections.', Weak: '⚠️ Needs work! Fill out your profile.' };
  return msgs[level] ?? '';
}