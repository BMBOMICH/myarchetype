import { arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'profile' | 'social' | 'dating' | 'safety' | 'community';
  points: number;
  unlockedAt?: string;
}

interface UserAchievementData {
  achievements?: string[];
  achievementDates?: Record<string, string>;
  achievementPoints?: number;
  profileCompletion?: number;
  photos?: string[];
  introVideo?: string;
  voiceIntro?: string;
  selfieVerified?: boolean;
  spotifyProfile?: string;
  matchCount?: number;
  referralCount?: number;
  loginStreak?: number;
}

export const ALL_ACHIEVEMENTS: Achievement[] = [
  { id: 'complete_profile', name: 'Profile Pro',         description: 'Complete your profile 100%',              icon: '✨', category: 'profile',   points: 50  },
  { id: 'add_5_photos',     name: 'Photogenic',          description: 'Add 5 photos to your profile',            icon: '📸', category: 'profile',   points: 30  },
  { id: 'add_video',        name: 'Movie Star',          description: 'Add a video intro',                       icon: '🎬', category: 'profile',   points: 40  },
  { id: 'add_voice',        name: 'Voice Actor',         description: 'Add a voice intro',                       icon: '🎤', category: 'profile',   points: 40  },
  { id: 'verified_selfie',  name: 'Verified',            description: 'Complete selfie verification',            icon: '✓',  category: 'profile',   points: 100 },
  { id: 'verified_height',  name: 'Tall Tale',           description: 'Verify your height',                      icon: '📏', category: 'profile',   points: 50  },
  { id: 'link_spotify',     name: 'Music Lover',         description: 'Link your Spotify account',               icon: '🎵', category: 'profile',   points: 30  },
  { id: 'link_instagram',   name: 'Influencer',          description: 'Link your Instagram',                     icon: '📱', category: 'profile',   points: 30  },
  { id: 'first_match',      name: 'First Spark',         description: 'Get your first match',                    icon: '💕', category: 'social',    points: 20  },
  { id: 'ten_matches',      name: 'Popular',             description: 'Get 10 matches',                          icon: '🔥', category: 'social',    points: 50  },
  { id: 'fifty_matches',    name: 'Heartthrob',          description: 'Get 50 matches',                          icon: '💖', category: 'social',    points: 100 },
  { id: 'hundred_matches',  name: 'Dating Legend',       description: 'Get 100 matches',                         icon: '👑', category: 'social',    points: 200 },
  { id: 'first_message',    name: 'Ice Breaker',         description: 'Send your first message',                 icon: '💬', category: 'social',    points: 20  },
  { id: 'hundred_messages', name: 'Chatterbox',          description: 'Send 100 messages',                       icon: '📝', category: 'social',    points: 50  },
  { id: 'send_gif',         name: 'GIF Master',          description: 'Send your first GIF',                     icon: '🎭', category: 'social',    points: 10  },
  { id: 'video_call',       name: 'Face to Face',        description: 'Complete a video call',                   icon: '📹', category: 'social',    points: 40  },
  { id: 'first_date',       name: 'First Date',          description: 'Go on your first date',                   icon: '🌹', category: 'dating',    points: 100 },
  { id: 'five_dates',       name: 'Serial Dater',        description: 'Go on 5 dates',                           icon: '💃', category: 'dating',    points: 150 },
  { id: 'rate_date',        name: 'Critic',              description: 'Rate a date experience',                  icon: '⭐', category: 'dating',    points: 30  },
  { id: 'play_game',        name: 'Game On',             description: 'Play an icebreaker game',                 icon: '🎮', category: 'dating',    points: 20  },
  { id: 'take_quiz',        name: 'Quiz Master',         description: 'Complete compatibility quiz',             icon: '📊', category: 'dating',    points: 30  },
  { id: 'share_playlist',   name: 'DJ Duo',              description: 'Create a shared playlist',                icon: '🎧', category: 'dating',    points: 30  },
  { id: 'use_checkin',      name: 'Safety First',        description: 'Use date check-in',                       icon: '🛡️', category: 'safety',    points: 50  },
  { id: 'add_emergency',    name: 'Prepared',            description: 'Add emergency contact',                   icon: '🆘', category: 'safety',    points: 30  },
  { id: 'report_user',      name: 'Community Guardian',  description: 'Report inappropriate behavior',           icon: '🚫', category: 'safety',    points: 20  },
  { id: 'first_referral',   name: 'Matchmaker',          description: 'Refer your first friend',                 icon: '🎁', category: 'community', points: 50  },
  { id: 'ten_referrals',    name: 'Community Champion',  description: 'Refer 10 friends',                        icon: '🌟', category: 'community', points: 200 },
  { id: 'post_story',       name: 'Storyteller',         description: 'Post your first story',                   icon: '📖', category: 'community', points: 20  },
  { id: 'review_spot',      name: 'Date Guru',           description: 'Review a date spot',                      icon: '📍', category: 'community', points: 30  },
  { id: 'daily_streak_7',   name: 'Dedicated',           description: '7-day login streak',                      icon: '🔥', category: 'community', points: 50  },
  { id: 'daily_streak_30',  name: 'Committed',           description: '30-day login streak',                     icon: '💎', category: 'community', points: 150 },
  { id: 'answer_questions', name: 'Open Book',           description: 'Answer 10 daily questions',               icon: '💭', category: 'community', points: 40  },
];

export async function getUserAchievements(): Promise<Achievement[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return [];
    const data = userDoc.data() as UserAchievementData;
    const unlockedIds: string[] = data.achievements ?? [];
    return ALL_ACHIEVEMENTS
      .filter(a => unlockedIds.includes(a.id))
      .map(a => ({ ...a, unlockedAt: data.achievementDates?.[a.id] ?? undefined }));
  } catch (error) {
    logger.error('Error getting achievements:', error);
    return [];
  }
}

export async function getLockedAchievements(): Promise<Achievement[]> {
  const user = auth.currentUser;
  if (!user) return ALL_ACHIEVEMENTS;
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return ALL_ACHIEVEMENTS;
    const data = userDoc.data() as UserAchievementData;
    const unlockedIds: string[] = data.achievements ?? [];
    return ALL_ACHIEVEMENTS.filter(a => !unlockedIds.includes(a.id));
  } catch (error) {
    logger.error('Error getting locked achievements:', error);
    return ALL_ACHIEVEMENTS;
  }
}

export async function unlockAchievement(achievementId: string): Promise<{ success: boolean; isNew: boolean; achievement?: Achievement }> {
  const user = auth.currentUser;
  if (!user) return { success: false, isNew: false };
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { success: false, isNew: false };
    const data = userDoc.data() as UserAchievementData;
    const currentAchievements: string[] = data.achievements ?? [];
    if (currentAchievements.includes(achievementId)) return { success: true, isNew: false };
    const achievement = ALL_ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!achievement) return { success: false, isNew: false };
    await updateDoc(doc(db, 'users', user.uid), {
      achievements: arrayUnion(achievementId),
      [`achievementDates.${achievementId}`]: new Date().toISOString(),
      achievementPoints: (data.achievementPoints ?? 0) + achievement.points,
    });
    return { success: true, isNew: true, achievement };
  } catch (error) {
    logger.error('Error unlocking achievement:', error);
    return { success: false, isNew: false };
  }
}

export async function checkAndUnlockAchievements(): Promise<Achievement[]> {
  const user = auth.currentUser;
  if (!user) return [];
  const newlyUnlocked: Achievement[] = [];
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return [];
    const userData = userDoc.data() as UserAchievementData;
    const current: string[] = userData.achievements ?? [];

    const tryUnlock = async (id: string) => {
      if (current.includes(id)) return;
      const result = await unlockAchievement(id);
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    };

    if ((userData.profileCompletion ?? 0) >= 100)  await tryUnlock('complete_profile');
    if ((userData.photos ?? []).length >= 5)        await tryUnlock('add_5_photos');
    if (userData.introVideo)                        await tryUnlock('add_video');
    if (userData.voiceIntro)                        await tryUnlock('add_voice');
    if (userData.selfieVerified)                    await tryUnlock('verified_selfie');
    if (userData.spotifyProfile)                    await tryUnlock('link_spotify');

    const matchCount = userData.matchCount ?? 0;
    if (matchCount >= 1)   await tryUnlock('first_match');
    if (matchCount >= 10)  await tryUnlock('ten_matches');
    if (matchCount >= 50)  await tryUnlock('fifty_matches');
    if (matchCount >= 100) await tryUnlock('hundred_matches');

    const referralCount = userData.referralCount ?? 0;
    if (referralCount >= 1)  await tryUnlock('first_referral');
    if (referralCount >= 10) await tryUnlock('ten_referrals');

    const loginStreak = userData.loginStreak ?? 0;
    if (loginStreak >= 7)  await tryUnlock('daily_streak_7');
    if (loginStreak >= 30) await tryUnlock('daily_streak_30');

    return newlyUnlocked;
  } catch (error) {
    logger.error('Error checking achievements:', error);
    return [];
  }
}

export function getAchievementProgress(userData: UserAchievementData): { total: number; unlocked: number; points: number } {
  return {
    total:    ALL_ACHIEVEMENTS.length,
    unlocked: (userData.achievements ?? []).length,
    points:   userData.achievementPoints ?? 0,
  };
}

export function getCategoryAchievements(category: string): Achievement[] {
  return ALL_ACHIEVEMENTS.filter(a => a.category === category);
}