import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export const INTERESTS_CATEGORIES = {
  'Sports & Fitness': [
    '🏋️ Gym', '🏃 Running', '🧘 Yoga', '🏊 Swimming', '⚽ Football',
    '🏀 Basketball', '🎾 Tennis', '🥾 Hiking', '🚴 Cycling', '🏂 Snowboarding',
    '🎿 Skiing', '🧗 Rock Climbing', '🥊 Boxing', '💃 Dancing', '🏄 Surfing',
  ],
  'Entertainment': [
    '🎬 Movies', '📺 TV Shows', '🎮 Gaming', '🎵 Music', '🎭 Theater',
    '🎤 Concerts', '🎪 Festivals', '📚 Reading', '🎨 Art', '📷 Photography',
    '✍️ Writing', '🎸 Playing Instrument', '🎧 Podcasts', '🃏 Board Games', '🎯 Darts',
  ],
  'Food & Drinks': [
    '☕ Coffee', '🍷 Wine', '🍺 Craft Beer', '🍣 Sushi', '🍕 Pizza',
    '🌮 Tacos', '🍜 Ramen', '🥗 Healthy Eating', '🍳 Cooking', '🧁 Baking',
    '🍦 Desserts', '🥩 BBQ', '🌱 Vegetarian', '🥬 Vegan', '🍔 Burgers',
  ],
  'Travel & Adventure': [
    '✈️ Traveling', '🏖️ Beach', '🏔️ Mountains', '🏕️ Camping', '🚗 Road Trips',
    '🌍 Backpacking', '🏰 History', '🗽 City Trips', '🏝️ Islands', '🌅 Sunsets',
    '🎢 Theme Parks', '🚂 Train Travel', '🛳️ Cruises', '🦁 Safari', '🌌 Stargazing',
  ],
  'Lifestyle': [
    '🐕 Dogs', '🐱 Cats', '🌿 Plants', '🏠 Interior Design', '💅 Self-care',
    '🧘 Meditation', '📈 Investing', '🎓 Learning', '💼 Entrepreneurship', '🌍 Environment',
    '🤝 Volunteering', '👨‍👩‍👧 Family', '🧳 Minimalism', '💪 Fitness Lifestyle', '🌙 Night Owl',
  ],
  'Social': [
    '🎉 Parties', '🍻 Bar Hopping', '🎳 Bowling', '🎤 Karaoke', '🎲 Game Nights',
    '🍿 Movie Nights', '🥂 Wine Tasting', '☕ Coffee Dates', '🌃 Nightlife', '🏠 House Parties',
  ],
};

export const ALL_INTERESTS = Object.values(INTERESTS_CATEGORIES).flat();

export interface UserInterests {
  interests: string[];
  updatedAt: string;
}

export async function getUserInterests(): Promise<string[]> {
  const user = auth.currentUser;
  if (!user) return [];

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return [];

    return userDoc.data().interests || [];
  } catch (error) {
    logger.error('Error getting interests:', error);
    return [];
  }
}

export async function saveUserInterests(interests: string[]): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  // Limit to 15 interests
  const limitedInterests = interests.slice(0, 15);

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      interests: limitedInterests,
      interestsUpdatedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (error) {
    logger.error('Error saving interests:', error);
    return { success: false };
  }
}

export function getSharedInterests(myInterests: string[], theirInterests: string[]): string[] {
  return myInterests.filter(interest => theirInterests.includes(interest));
}

export function calculateInterestCompatibility(myInterests: string[], theirInterests: string[]): number {
  if (myInterests.length === 0 || theirInterests.length === 0) return 0;

  const shared = getSharedInterests(myInterests, theirInterests);
  const totalUnique = new Set([...myInterests, ...theirInterests]).size;

  return Math.round((shared.length / totalUnique) * 100);
}