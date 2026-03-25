import { arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'profile' | 'social' | 'dating' | 'safety' | 'community';
  points: number;
  unlockedAt?: string;
}

export const ALL_ACHIEVEMENTS: Achievement[] = [
  // Profile achievements
  { id: 'complete_profile', name: 'Profile Pro', description: 'Complete your profile 100%', icon: '✨', category: 'profile', points: 50 },
  { id: 'add_5_photos', name: 'Photogenic', description: 'Add 5 photos to your profile', icon: '📸', category: 'profile', points: 30 },
  { id: 'add_video', name: 'Movie Star', description: 'Add a video intro', icon: '🎬', category: 'profile', points: 40 },
  { id: 'add_voice', name: 'Voice Actor', description: 'Add a voice intro', icon: '🎤', category: 'profile', points: 40 },
  { id: 'verified_selfie', name: 'Verified', description: 'Complete selfie verification', icon: '✓', category: 'profile', points: 100 },
  { id: 'verified_height', name: 'Tall Tale', description: 'Verify your height', icon: '📏', category: 'profile', points: 50 },
  { id: 'link_spotify', name: 'Music Lover', description: 'Link your Spotify account', icon: '🎵', category: 'profile', points: 30 },
  { id: 'link_instagram', name: 'Influencer', description: 'Link your Instagram', icon: '📱', category: 'profile', points: 30 },

  // Social achievements
  { id: 'first_match', name: 'First Spark', description: 'Get your first match', icon: '💕', category: 'social', points: 20 },
  { id: 'ten_matches', name: 'Popular', description: 'Get 10 matches', icon: '🔥', category: 'social', points: 50 },
  { id: 'fifty_matches', name: 'Heartthrob', description: 'Get 50 matches', icon: '💖', category: 'social', points: 100 },
  { id: 'hundred_matches', name: 'Dating Legend', description: 'Get 100 matches', icon: '👑', category: 'social', points: 200 },
  { id: 'first_message', name: 'Ice Breaker', description: 'Send your first message', icon: '💬', category: 'social', points: 20 },
  { id: 'hundred_messages', name: 'Chatterbox', description: 'Send 100 messages', icon: '📝', category: 'social', points: 50 },
  { id: 'send_gif', name: 'GIF Master', description: 'Send your first GIF', icon: '🎭', category: 'social', points: 10 },
  { id: 'video_call', name: 'Face to Face', description: 'Complete a video call', icon: '📹', category: 'social', points: 40 },

  // Dating achievements
  { id: 'first_date', name: 'First Date', description: 'Go on your first date', icon: '🌹', category: 'dating', points: 100 },
  { id: 'five_dates', name: 'Serial Dater', description: 'Go on 5 dates', icon: '💃', category: 'dating', points: 150 },
  { id: 'rate_date', name: 'Critic', description: 'Rate a date experience', icon: '⭐', category: 'dating', points: 30 },
  { id: 'play_game', name: 'Game On', description: 'Play an icebreaker game', icon: '🎮', category: 'dating', points: 20 },
  { id: 'take_quiz', name: 'Quiz Master', description: 'Complete compatibility quiz', icon: '📊', category: 'dating', points: 30 },
  { id: 'share_playlist', name: 'DJ Duo', description: 'Create a shared playlist', icon: '🎧', category: 'dating', points: 30 },

  // Safety achievements
  { id: 'use_checkin', name: 'Safety First', description: 'Use date check-in', icon: '🛡️', category: 'safety', points: 50 },
  { id: 'add_emergency', name: 'Prepared', description: 'Add emergency contact', icon: '🆘', category: 'safety', points: 30 },
  { id: 'report_user', name: 'Community Guardian', description: 'Report inappropriate behavior', icon: '🚫', category: 'safety', points: 20 },

  // Community achievements
  { id: 'first_referral', name: 'Matchmaker', description: 'Refer your first friend', icon: '🎁', category: 'community', points: 50 },
  { id: 'ten_referrals', name: 'Community Champion', description: 'Refer 10 friends', icon: '🌟', category: 'community', points: 200 },
  { id: 'post_story', name: 'Storyteller', description: 'Post your first story', icon: '📖', category: 'community', points: 20 },
  { id: 'review_spot', name: 'Date Guru', description: 'Review a date spot', icon: '📍', category: 'community', points: 30 },
  { id: 'daily_streak_7', name: 'Dedicated', description: '7-day login streak', icon: '🔥', category: 'community', points: 50 },
  { id: 'daily_streak_30', name: 'Committed', description: '30-day login streak', icon: '💎', category: 'community', points: 150 },
  { id: 'answer_questions', name: 'Open Book', description: 'Answer 10 daily questions', icon: '💭', category: 'community', points: 40 },
];

export async function getUserAchievements(): Promise<Achievement[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return [];

    const unlockedIds = userDoc.data().achievements || [];
    
    return ALL_ACHIEVEMENTS.filter(a => unlockedIds.includes(a.id)).map(a => ({
      ...a,
      unlockedAt: userDoc.data().achievementDates?.[a.id] || null,
    }));
  } catch (error) {
    console.error('Error getting achievements:', error);
    return [];
  }
}

export async function getLockedAchievements(): Promise<Achievement[]> {
  const user = auth.currentUser;
  if (!user) return ALL_ACHIEVEMENTS;

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return ALL_ACHIEVEMENTS;

    const unlockedIds = userDoc.data().achievements || [];
    
    return ALL_ACHIEVEMENTS.filter(a => !unlockedIds.includes(a.id));
  } catch (error) {
    console.error('Error getting locked achievements:', error);
    return ALL_ACHIEVEMENTS;
  }
}

export async function unlockAchievement(achievementId: string): Promise<{ success: boolean; isNew: boolean; achievement?: Achievement }> {
  const user = auth.currentUser;
  if (!user) return { success: false, isNew: false };

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return { success: false, isNew: false };

    const currentAchievements = userDoc.data().achievements || [];
    
    // Already unlocked
    if (currentAchievements.includes(achievementId)) {
      return { success: true, isNew: false };
    }

    const achievement = ALL_ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!achievement) return { success: false, isNew: false };

    // Unlock it
    await updateDoc(doc(db, 'users', user.uid), {
      achievements: arrayUnion(achievementId),
      [`achievementDates.${achievementId}`]: new Date().toISOString(),
      achievementPoints: (userDoc.data().achievementPoints || 0) + achievement.points,
    });

    return { success: true, isNew: true, achievement };
  } catch (error) {
    console.error('Error unlocking achievement:', error);
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

    const userData = userDoc.data();
    const currentAchievements = userData.achievements || [];

    // Check profile achievements
    if (!currentAchievements.includes('complete_profile')) {
      const completion = userData.profileCompletion || 0;
      if (completion >= 100) {
        const result = await unlockAchievement('complete_profile');
        if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
      }
    }

    if (!currentAchievements.includes('add_5_photos')) {
      const photos = userData.photos || [];
      if (photos.length >= 5) {
        const result = await unlockAchievement('add_5_photos');
        if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
      }
    }

    if (!currentAchievements.includes('add_video') && userData.introVideo) {
      const result = await unlockAchievement('add_video');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }

    if (!currentAchievements.includes('add_voice') && userData.voiceIntro) {
      const result = await unlockAchievement('add_voice');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }

    if (!currentAchievements.includes('verified_selfie') && userData.selfieVerified) {
      const result = await unlockAchievement('verified_selfie');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }

    if (!currentAchievements.includes('link_spotify') && userData.spotifyProfile) {
      const result = await unlockAchievement('link_spotify');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }

    // Check match achievements
    const matchCount = userData.matchCount || 0;
    if (!currentAchievements.includes('first_match') && matchCount >= 1) {
      const result = await unlockAchievement('first_match');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }
    if (!currentAchievements.includes('ten_matches') && matchCount >= 10) {
      const result = await unlockAchievement('ten_matches');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }
    if (!currentAchievements.includes('fifty_matches') && matchCount >= 50) {
      const result = await unlockAchievement('fifty_matches');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }
    if (!currentAchievements.includes('hundred_matches') && matchCount >= 100) {
      const result = await unlockAchievement('hundred_matches');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }

    // Check referral achievements
    const referralCount = userData.referralCount || 0;
    if (!currentAchievements.includes('first_referral') && referralCount >= 1) {
      const result = await unlockAchievement('first_referral');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }
    if (!currentAchievements.includes('ten_referrals') && referralCount >= 10) {
      const result = await unlockAchievement('ten_referrals');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }

    // Check streak achievements
    const loginStreak = userData.loginStreak || 0;
    if (!currentAchievements.includes('daily_streak_7') && loginStreak >= 7) {
      const result = await unlockAchievement('daily_streak_7');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }
    if (!currentAchievements.includes('daily_streak_30') && loginStreak >= 30) {
      const result = await unlockAchievement('daily_streak_30');
      if (result.isNew && result.achievement) newlyUnlocked.push(result.achievement);
    }

    return newlyUnlocked;
  } catch (error) {
    console.error('Error checking achievements:', error);
    return [];
  }
}

export function getAchievementProgress(userData: any): { total: number; unlocked: number; points: number } {
  const unlockedCount = (userData.achievements || []).length;
  const totalPoints = userData.achievementPoints || 0;

  return {
    total: ALL_ACHIEVEMENTS.length,
    unlocked: unlockedCount,
    points: totalPoints,
  };
}

export function getCategoryAchievements(category: string): Achievement[] {
  return ALL_ACHIEVEMENTS.filter(a => a.category === category);
}