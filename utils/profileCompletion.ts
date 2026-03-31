/**
 * utils/profileCompletion.ts
 *
 * Detectors covered:
 * #153 Profile completeness score (0-100)
 * #154 Verification level display badge
 */

export interface ProfileCompletionResult {
  percentage: number;
  completed: string[];
  missing: string[];
  tips: string[];
  verificationLevel: VerificationLevel;
  trustBonus: number;
}

export type VerificationLevel = 'none' | 'basic' | 'verified' | 'trusted';

// ═════════════════════════════════════════════════════════
// #153: Profile completeness score
// ═════════════════════════════════════════════════════════

export function calculateProfileCompletion(userData: any): ProfileCompletionResult {
  const completed: string[] = [];
  const missing: string[] = [];
  const tips: string[] = [];

  // Required fields (40 points)
  const requiredFields = [
    { key: 'name', label: 'Name', points: 8 },
    { key: 'age', label: 'Age', points: 8 },
    { key: 'gender', label: 'Gender', points: 8 },
    { key: 'bodyType', label: 'Body Type', points: 8 },
    { key: 'lookingFor', label: 'Preference', points: 8 },
  ];

  // Photo scoring (25 points)
  const photoThresholds = [
    { count: 1, points: 8, label: '1 Photo' },
    { count: 2, points: 17, label: '2 Photos' },
    { count: 3, points: 25, label: '3+ Photos' },
  ];

  // Optional fields (20 points)
  const optionalFields = [
    { key: 'bio', label: 'Bio', points: 5, tip: 'Add a bio to show your personality!' },
    { key: 'religiousViews', label: 'Religious Views', points: 2 },
    { key: 'lifestyle', label: 'Lifestyle', points: 2 },
    { key: 'relationshipGoal', label: 'Relationship Goal', points: 4, tip: "Let others know what you're looking for" },
    { key: 'personalityType', label: 'Personality Quiz', points: 5, tip: 'Take the personality quiz for better matches!' },
    { key: 'location', label: 'Location', points: 2, tip: 'Add your location to find nearby matches' },
  ];

  // Verification bonuses (15 points)
  const verificationFields = [
    { key: 'selfieVerified', label: 'Identity Verified', points: 5, tip: 'Verify your identity to build trust!' },
    { key: 'ageVerification.verified', label: 'Age Verified', points: 5 },
    { key: 'height.verificationMethod', value: 'manual-measured', label: 'Height Verified', points: 5 },
  ];

  let totalPoints = 0;
  let earnedPoints = 0;

  // Check required fields
  for (const field of requiredFields) {
    totalPoints += field.points;
    if (userData[field.key]) {
      earnedPoints += field.points;
      completed.push(field.label);
    } else {
      missing.push(field.label);
    }
  }

  // Photos
  totalPoints += 25;
  const photoCount = userData.photos?.length ?? 0;
  const photoTier = [...photoThresholds]
    .reverse()
    .find((t) => photoCount >= t.count);

  if (photoTier) {
    earnedPoints += photoTier.points;
    completed.push(photoTier.label);
    if (photoCount < 3) {
      tips.push('Add more photos — profiles with 3+ photos get 3x more likes!');
    }
  } else {
    missing.push('Photos');
    tips.push('Add photos to get matches!');
  }

  // Optional fields
  for (const field of optionalFields) {
    totalPoints += field.points;

    let hasValue = false;
    if (field.key === 'location') {
      hasValue = !!(userData.location?.city ?? userData.location?.latitude);
    } else {
      hasValue = !!userData[field.key];
    }

    if (hasValue) {
      earnedPoints += field.points;
      completed.push(field.label);
    } else {
      missing.push(field.label);
      if (field.tip) tips.push(field.tip);
    }
  }

  // Verification fields
  for (const field of verificationFields) {
    totalPoints += field.points;

    let isVerified = false;
    if (field.key.includes('.')) {
      const parts = field.key.split('.');
      const parent = parts[0]!;
      const child = parts[1]!;
      isVerified = field.value
        ? userData[parent]?.[child] === field.value
        : !!userData[parent]?.[child];
    } else {
      isVerified = !!userData[field.key];
    }

    if (isVerified) {
      earnedPoints += field.points;
      completed.push(field.label);
    } else {
      missing.push(field.label);
      if (field.tip) tips.push(field.tip);
    }
  }

  const percentage = Math.round((earnedPoints / totalPoints) * 100);

  // #154: Derive verification level from completion data
  const verificationLevel = deriveVerificationLevel(userData);
  const trustBonus = computeTrustBonus(userData);

  return {
    percentage,
    completed,
    missing,
    tips: tips.slice(0, 3),
    verificationLevel,
    trustBonus,
  };
}

// ═════════════════════════════════════════════════════════
// #154: Verification level badge
// ═════════════════════════════════════════════════════════

/**
 * Determine verification level from user data.
 * Detector #154.
 *
 * Levels:
 *   none    — email only
 *   basic   — email + selfie
 *   verified — email + selfie + age verified
 *   trusted — email + selfie + age + social links + phone
 */
export function deriveVerificationLevel(userData: any): VerificationLevel {
  const hasEmail = !!userData.emailVerified;
  const hasSelfie = !!userData.selfieVerified;
  const hasAge = !!userData.ageVerification?.verified;
  const hasPhone = !!userData.phoneVerified;
  const hasSocial =
    userData.socialLinks?.instagram?.username ||
    userData.socialLinks?.linkedin?.profileUrl;

  if (hasSelfie && hasAge && hasPhone && hasSocial) return 'trusted';
  if (hasSelfie && hasAge) return 'verified';
  if (hasSelfie) return 'basic';
  return 'none';
}

export function getVerificationBadgeConfig(level: VerificationLevel): {
  label: string;
  color: string;
  icon: string;
  description: string;
} {
  switch (level) {
    case 'trusted':
      return {
        label: 'Trusted',
        color: '#f1c40f',
        icon: '★',
        description: 'Identity, age, phone, and social verified',
      };
    case 'verified':
      return {
        label: 'Verified',
        color: '#3498db',
        icon: '✓',
        description: 'Identity and age verified',
      };
    case 'basic':
      return {
        label: 'Photo Verified',
        color: '#27ae60',
        icon: '◉',
        description: 'Selfie verified',
      };
    case 'none':
    default:
      return {
        label: 'Unverified',
        color: '#95a5a6',
        icon: '○',
        description: 'Complete verification to build trust',
      };
  }
}

function computeTrustBonus(userData: any): number {
  let bonus = 0;
  if (userData.emailVerified) bonus += 5;
  if (userData.selfieVerified) bonus += 15;
  if (userData.ageVerification?.verified) bonus += 10;
  if (userData.phoneVerified) bonus += 10;
  if (userData.socialLinks?.instagram?.username) bonus += 5;
  if (userData.socialLinks?.linkedin?.profileUrl) bonus += 5;
  return Math.min(bonus, 50);
}

export function getCompletionColor(percentage: number): string {
  if (percentage >= 90) return '#5cb85c';
  if (percentage >= 70) return '#53a8b6';
  if (percentage >= 50) return '#e67e22';
  return '#d9534f';
}

export function getCompletionMessage(percentage: number): string {
  if (percentage >= 100) return 'Perfect! Your profile is complete!';
  if (percentage >= 90) return 'Almost there! Just a few more touches.';
  if (percentage >= 70) return 'Good progress! Keep going.';
  if (percentage >= 50) return 'Halfway there! Add more details.';
  return 'Just getting started! Complete your profile for more matches.';
}