import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { logger } from './logger';

export interface DealBreakers {
  // Must have
  mustHaveVerified: boolean;
  mustHaveBio: boolean;
  mustHaveMultiplePhotos: boolean;
  
  // Age
  minAge: number | null;
  maxAge: number | null;
  
  // Height
  minHeight: number | null;
  maxHeight: number | null;
  
  // Lifestyle
  noSmoking: boolean;
  noDrinking: boolean;
  noDrugs: boolean;
  
  // Life choices
  mustWantKids: boolean;
  mustNotWantKids: boolean;
  mustHaveKids: boolean;
  mustNotHaveKids: boolean;
  
  // Religion
  sameReligionOnly: boolean;
  requiredReligion: string | null;
  
  // Distance
  maxDistanceKm: number | null;
}

export const DEFAULT_DEAL_BREAKERS: DealBreakers = {
  mustHaveVerified: false,
  mustHaveBio: false,
  mustHaveMultiplePhotos: false,
  minAge: null,
  maxAge: null,
  minHeight: null,
  maxHeight: null,
  noSmoking: false,
  noDrinking: false,
  noDrugs: false,
  mustWantKids: false,
  mustNotWantKids: false,
  mustHaveKids: false,
  mustNotHaveKids: false,
  sameReligionOnly: false,
  requiredReligion: null,
  maxDistanceKm: null,
};

export async function getDealBreakers(): Promise<DealBreakers> {
  const user = auth.currentUser;
  if (!user) return DEFAULT_DEAL_BREAKERS;

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return DEFAULT_DEAL_BREAKERS;

    const data = userDoc.data();
    return {
      ...DEFAULT_DEAL_BREAKERS,
      ...(data.dealBreakers || {}),
    };
  } catch (error) {
    logger.error('Error getting deal breakers:', error);
    return DEFAULT_DEAL_BREAKERS;
  }
}

export async function saveDealBreakers(dealBreakers: DealBreakers): Promise<{ success: boolean }> {
  const user = auth.currentUser;
  if (!user) return { success: false };

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      dealBreakers: dealBreakers,
      dealBreakersUpdatedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (error) {
    logger.error('Error saving deal breakers:', error);
    return { success: false };
  }
}

export function checkDealBreakers(
  myDealBreakers: DealBreakers,
  theirProfile: any,
  myProfile: any,
  distanceKm?: number
): { passes: boolean; failedReasons: string[] } {
  const failedReasons: string[] = [];

  // Verified check
  if (myDealBreakers.mustHaveVerified && !theirProfile.selfieVerified) {
    failedReasons.push('Not verified');
  }

  // Bio check
  if (myDealBreakers.mustHaveBio && (!theirProfile.bio || theirProfile.bio.length < 10)) {
    failedReasons.push('No bio');
  }

  // Multiple photos check
  if (myDealBreakers.mustHaveMultiplePhotos && (!theirProfile.photos || theirProfile.photos.length < 3)) {
    failedReasons.push('Less than 3 photos');
  }

  // Age check
  if (myDealBreakers.minAge && theirProfile.age < myDealBreakers.minAge) {
    failedReasons.push(`Too young (min ${myDealBreakers.minAge})`);
  }
  if (myDealBreakers.maxAge && theirProfile.age > myDealBreakers.maxAge) {
    failedReasons.push(`Too old (max ${myDealBreakers.maxAge})`);
  }

  // Height check
  const theirHeight = typeof theirProfile.height === 'object' 
    ? theirProfile.height.value 
    : theirProfile.height;
  
  if (myDealBreakers.minHeight && theirHeight < myDealBreakers.minHeight) {
    failedReasons.push(`Too short (min ${myDealBreakers.minHeight}cm)`);
  }
  if (myDealBreakers.maxHeight && theirHeight > myDealBreakers.maxHeight) {
    failedReasons.push(`Too tall (max ${myDealBreakers.maxHeight}cm)`);
  }

  // Lifestyle checks
  if (myDealBreakers.noSmoking && theirProfile.smoking === true) {
    failedReasons.push('Smoker');
  }
  if (myDealBreakers.noDrinking && theirProfile.drinking === true) {
    failedReasons.push('Drinks alcohol');
  }
  if (myDealBreakers.noDrugs && theirProfile.drugs === true) {
    failedReasons.push('Uses drugs');
  }

  // Kids checks
  if (myDealBreakers.mustWantKids && theirProfile.wantsKids === false) {
    failedReasons.push("Doesn't want kids");
  }
  if (myDealBreakers.mustNotWantKids && theirProfile.wantsKids === true) {
    failedReasons.push('Wants kids');
  }
  if (myDealBreakers.mustHaveKids && !theirProfile.hasKids) {
    failedReasons.push("Doesn't have kids");
  }
  if (myDealBreakers.mustNotHaveKids && theirProfile.hasKids) {
    failedReasons.push('Has kids');
  }

  // Religion check
  if (myDealBreakers.sameReligionOnly) {
    if (theirProfile.religiousViews !== myProfile.religiousViews) {
      failedReasons.push('Different religion');
    }
  }
  if (myDealBreakers.requiredReligion && theirProfile.religiousViews !== myDealBreakers.requiredReligion) {
    failedReasons.push(`Not ${myDealBreakers.requiredReligion}`);
  }

  // Distance check
  if (myDealBreakers.maxDistanceKm && distanceKm && distanceKm > myDealBreakers.maxDistanceKm) {
    failedReasons.push(`Too far (${Math.round(distanceKm)}km)`);
  }

  return {
    passes: failedReasons.length === 0,
    failedReasons,
  };
}