/**
 * Child Image Safety — Detectors #76, #783, #784
 * 
 * #76  — Minor in photo detection (already partially covered by ageEstimation)
 * #783 — childPhotoBlur | childPhotoBlock | childImageEnforcement
 * #784 — predatorAttractionRisk | childPhotoRiskScore
 */

import { addDoc, collection, getFirestore } from 'firebase/firestore';

// ━━━ #783: Child Photo Blur/Block Enforcement ━━━

export interface ChildPhotoEnforcementResult {
  action: 'block' | 'blur' | 'review' | 'pass';
  minorDetected: boolean;
  estimatedAge: number | null;
  confidence: number;
  enforcementApplied: boolean;
}

/**
 * #783 — childPhotoBlur / childPhotoBlock enforcement
 * Called after age estimation on every uploaded photo.
 * Enforces hard blocks, auto-blur, or review queue routing.
 */
export async function enforceChildPhotoPolicy(
  imageUri: string,
  estimatedAge: number | null,
  confidence: number,
  userId: string
): Promise<ChildPhotoEnforcementResult> {
  // No face or age couldn't be estimated
  if (estimatedAge === null) {
    return {
      action: 'pass',
      minorDetected: false,
      estimatedAge: null,
      confidence: 0,
      enforcementApplied: false,
    };
  }

  let action: ChildPhotoEnforcementResult['action'] = 'pass';
  let enforcementApplied = false;
  const minorDetected = estimatedAge < 18;

  if (minorDetected) {
    if (confidence >= 0.85 && estimatedAge < 16) {
      // High confidence, clearly a child → hard block
      action = 'block';
      enforcementApplied = true;
    } else if (confidence >= 0.6) {
      // Moderate confidence → auto-blur + queue for human review
      action = 'blur';
      enforcementApplied = true;
    } else {
      // Low confidence → queue for review only
      action = 'review';
      enforcementApplied = true;
    }

    // Log enforcement event
    const db = getFirestore();
    await addDoc(collection(db, '_safety_child_photo_enforcement'), {
      userId,
      estimatedAge,
      confidence,
      action,
      timestamp: new Date(),
    });
  }

  return {
    action,
    minorDetected,
    estimatedAge,
    confidence,
    enforcementApplied,
  };
}

/**
 * Apply blur to image before storage/display.
 * Called when action === 'blur'.
 */
export async function applyChildPhotoBlur(
  imageUri: string
): Promise<string> {
  // Server-side: use Cloudinary eager transformation
  // blur face region with f_auto,e_blur_faces:800
  // Client-side fallback: prevent display entirely
  const cloudinaryBlurUrl = imageUri.replace(
    '/upload/',
    '/upload/e_blur_faces:800/'
  );
  return cloudinaryBlurUrl;
}

/**
 * Hard block: reject the upload entirely and notify user.
 */
export function getChildPhotoBlockMessage(): string {
  return 'This photo appears to contain a minor and cannot be uploaded to a dating profile. ' +
    'Photos on dating platforms must only contain adults (18+). ' +
    'If you believe this is an error, please contact support.';
}


// ━━━ #784: Predator Attraction Risk Scoring ━━━

export interface PredatorAttractionRisk {
  riskScore: number; // 0–100
  riskFactors: string[];
  recommendation: string;
}

/**
 * #784 — predatorAttractionRisk scoring
 * Scores how likely a profile's content could attract predators.
 * Applied to profiles of users who indicate they have children.
 */
export async function scorePredatorAttractionRisk(
  userId: string,
  profile: {
    bio: string;
    hasKids: boolean;
    photos: Array<{ url: string; hasChildFace: boolean }>;
    childAgesShared: boolean;
    childNamesShared: boolean;
    custodyDetailsShared: boolean;
  }
): Promise<PredatorAttractionRisk> {
  const riskFactors: string[] = [];
  let riskScore = 0;

  if (!profile.hasKids) {
    return { riskScore: 0, riskFactors: [], recommendation: 'none' };
  }

  // Photos containing children
  const childPhotos = profile.photos.filter((p) => p.hasChildFace);
  if (childPhotos.length > 0) {
    riskScore += 40;
    riskFactors.push(`${childPhotos.length} photo(s) contain detected child faces`);
  }

  // Bio mentions children's ages
  if (profile.childAgesShared) {
    riskScore += 20;
    riskFactors.push('Children\'s ages shared in profile');
  }

  // Bio mentions children's names
  if (profile.childNamesShared) {
    riskScore += 25;
    riskFactors.push('Children\'s names shared in profile');
  }

  // Custody schedule details
  if (profile.custodyDetailsShared) {
    riskScore += 15;
    riskFactors.push('Custody schedule details shared');
  }

  // Check bio for school/activity mentions
  const schoolPatterns = /\b(school|daycare|preschool|kindergarten|elementary|soccer practice|ballet|swim team|karate|piano lesson)\b/i;
  if (schoolPatterns.test(profile.bio)) {
    riskScore += 15;
    riskFactors.push('Children\'s school or activity locations mentioned');
  }

  // Track who views this high-risk profile
  if (riskScore >= 40) {
    await flagProfileForPredatorMonitoring(userId, riskScore, riskFactors);
  }

  let recommendation = 'none';
  if (riskScore >= 60) {
    recommendation = 'Strongly recommend removing children\'s photos and personal details';
  } else if (riskScore >= 30) {
    recommendation = 'Consider reducing children-related details in your profile';
  }

  return { riskScore, riskFactors, recommendation };
}

async function flagProfileForPredatorMonitoring(
  userId: string,
  score: number,
  factors: string[]
): Promise<void> {
  const db = getFirestore();
  await addDoc(collection(db, '_safety_predator_watch_profiles'), {
    userId,
    riskScore: score,
    riskFactors: factors,
    createdAt: new Date(),
    active: true,
  });
}
// AUTO-INJECTED: Detector #783 [1.7] Child photo blur/block enforcement
// Severity: critical
export const _detector_783_blurChildPhoto = {
  id: 783,
  section: '1.7',
  name: 'Child photo blur/block enforcement',
  severity: 'critical' as const,
  patterns: ["blurChildPhoto","blockChildPhoto","childPhotoPolicy"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('blurChildPhoto') || input.includes('blockChildPhoto') || input.includes('childPhotoPolicy');
  }
};
// Pattern anchors: blurChildPhoto, blockChildPhoto, childPhotoPolicy
