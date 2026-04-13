import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface DealBreakers {
  mustHaveVerified: boolean; mustHaveBio: boolean; mustHaveMultiplePhotos: boolean;
  minAge: number | null; maxAge: number | null;
  minHeight: number | null; maxHeight: number | null;
  noSmoking: boolean; noDrinking: boolean; noDrugs: boolean;
  mustWantKids: boolean; mustNotWantKids: boolean; mustHaveKids: boolean; mustNotHaveKids: boolean;
  sameReligionOnly: boolean; requiredReligion: string | null;
  maxDistanceKm: number | null;
}

export const DEFAULT_DEAL_BREAKERS: DealBreakers = {
  mustHaveVerified: false, mustHaveBio: false, mustHaveMultiplePhotos: false,
  minAge: null, maxAge: null, minHeight: null, maxHeight: null,
  noSmoking: false, noDrinking: false, noDrugs: false,
  mustWantKids: false, mustNotWantKids: false, mustHaveKids: false, mustNotHaveKids: false,
  sameReligionOnly: false, requiredReligion: null, maxDistanceKm: null,
};

interface Profile {
  selfieVerified?: boolean; bio?: string; photos?: string[]; age?: number;
  height?: number | { value: number }; smoking?: boolean; drinking?: boolean;
  drugs?: boolean; wantsKids?: boolean; hasKids?: boolean; religiousViews?: string;
}

export async function getDealBreakers(): Promise<DealBreakers> {
  const user = auth.currentUser;
  if (!user) return DEFAULT_DEAL_BREAKERS;
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return DEFAULT_DEAL_BREAKERS;
    return { ...DEFAULT_DEAL_BREAKERS, ...(userDoc.data().dealBreakers ?? {}) };
  } catch (error: unknown) { logger.error('Error getting deal breakers:', error); return DEFAULT_DEAL_BREAKERS; }
}

export async function saveDealBreakers(dealBreakers: DealBreakers): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };
  try {
    await updateDoc(doc(db, 'users', user.uid), { dealBreakers, dealBreakersUpdatedAt: new Date().toISOString() });
    return { success: true };
  } catch (error: unknown) { logger.error('Error saving deal breakers:', error); return { success: false }; }
}

export function checkDealBreakers(
  myDealBreakers: DealBreakers, theirProfile: Profile, myProfile: Profile, distanceKm?: number
): { passes: boolean; failedReasons: string[] } {
  const failedReasons: string[] = [];
  if (myDealBreakers.mustHaveVerified && !theirProfile.selfieVerified) failedReasons.push('Not verified');
  if (myDealBreakers.mustHaveBio && (!theirProfile.bio || theirProfile.bio.length < 10)) failedReasons.push('No bio');
  if (myDealBreakers.mustHaveMultiplePhotos && (!theirProfile.photos || theirProfile.photos.length < 3)) failedReasons.push('Less than 3 photos');
  if (myDealBreakers.minAge != null && (theirProfile.age ?? 0) < myDealBreakers.minAge) failedReasons.push(`Too young (min ${myDealBreakers.minAge})`);
  if (myDealBreakers.maxAge != null && (theirProfile.age ?? 0) > myDealBreakers.maxAge) failedReasons.push(`Too old (max ${myDealBreakers.maxAge})`);
  const theirHeight = typeof theirProfile.height === 'object' && theirProfile.height !== null ? theirProfile.height.value : (theirProfile.height ?? 0);
  if (myDealBreakers.minHeight != null && theirHeight < myDealBreakers.minHeight) failedReasons.push(`Too short (min ${myDealBreakers.minHeight}cm)`);
  if (myDealBreakers.maxHeight != null && theirHeight > myDealBreakers.maxHeight) failedReasons.push(`Too tall (max ${myDealBreakers.maxHeight}cm)`);
  if (myDealBreakers.noSmoking && theirProfile.smoking === true) failedReasons.push('Smoker');
  if (myDealBreakers.noDrinking && theirProfile.drinking === true) failedReasons.push('Drinks alcohol');
  if (myDealBreakers.noDrugs && theirProfile.drugs === true) failedReasons.push('Uses drugs');
  if (myDealBreakers.mustWantKids && theirProfile.wantsKids === false) failedReasons.push("Doesn't want kids");
  if (myDealBreakers.mustNotWantKids && theirProfile.wantsKids === true) failedReasons.push('Wants kids');
  if (myDealBreakers.mustHaveKids && !theirProfile.hasKids) failedReasons.push("Doesn't have kids");
  if (myDealBreakers.mustNotHaveKids && theirProfile.hasKids) failedReasons.push('Has kids');
  if (myDealBreakers.sameReligionOnly && theirProfile.religiousViews !== myProfile.religiousViews) failedReasons.push('Different religion');
  if (myDealBreakers.requiredReligion && theirProfile.religiousViews !== myDealBreakers.requiredReligion) failedReasons.push(`Not ${myDealBreakers.requiredReligion}`);
  if (myDealBreakers.maxDistanceKm != null && distanceKm != null && distanceKm > myDealBreakers.maxDistanceKm) failedReasons.push(`Too far (${Math.round(distanceKm)}km)`);
  return { passes: failedReasons.length === 0, failedReasons };
}