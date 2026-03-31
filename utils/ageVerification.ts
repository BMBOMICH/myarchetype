export interface AgeVerification { verified: boolean; method: 'self-reported' | 'ai-estimated' | 'id-verified'; estimatedAge: number | null; statedAge: number; ageDifference: number | null; verifiedAt: string; confidence: number; requiresManualReview?: boolean; flaggedForReview?: boolean; }

// #138: Level display
export const getAgeVerificationLevel = (v: AgeVerification | null | undefined): { level: 'unverified' | 'ai-verified' | 'id-verified'; color: string; label: string; icon: string } => {
  if (!v) return { level: 'unverified', color: '#888', label: 'Unverified', icon: 'O' };
  if (v.method === 'id-verified') return { level: 'id-verified', color: '#f1c40f', label: 'ID Verified', icon: '*' };
  if (v.verified && v.method === 'ai-estimated') return { level: 'ai-verified', color: '#3498db', label: 'Age Verified', icon: '✓' };
  if (v.ageDifference && v.ageDifference > 5) return { level: 'unverified', color: '#e67e22', label: 'Unverified Age', icon: '!' };
  return { level: 'unverified', color: '#888', label: 'Unverified', icon: 'O' };
};

export const getAgeVerificationTooltip = (v: AgeVerification | null | undefined): string => {
  if (!v) return 'Age not verified';
  if (v.method === 'id-verified') return 'Age verified with government ID';
  if (v.verified && v.method === 'ai-estimated') return `Age verified by AI. Estimated: ${v.estimatedAge ?? 'unknown'}, Stated: ${v.statedAge}`;
  if (v.ageDifference && v.ageDifference > 5) return `Age differs from AI estimate by ${v.ageDifference} years`;
  return 'Age self-reported, not verified';
};

// #139: Age-gated content
export type ContentRating = 'G' | 'PG' | 'PG13' | 'R' | 'EXPLICIT';
const RATINGS: Record<ContentRating, { minimumAge: number; description: string }> = {
  G: { minimumAge: 0, description: 'General audience' },
  PG: { minimumAge: 13, description: 'Parental guidance' },
  PG13: { minimumAge: 13, description: 'Ages 13+' },
  R: { minimumAge: 18, description: 'Ages 18+' },
  EXPLICIT: { minimumAge: 18, description: 'Adults only 18+' },
};

export function canViewContent(userAge: number, rating: ContentRating): { allowed: boolean; reason?: string } {
  const r = RATINGS[rating];
  return userAge < r.minimumAge ? { allowed: false, reason: `Requires users to be ${r.minimumAge}+.` } : { allowed: true };
}

export function getMaxContentRatingForAge(age: number): ContentRating {
  if (age < 13) return 'G';
  if (age < 18) return 'PG13';
  return 'EXPLICIT';
}

// #143: COPPA
export function checkCOPPACompliance(dob: string): { compliant: boolean; age: number; reason?: string } {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return { compliant: false, age: 0, reason: 'Invalid date of birth.' };
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  if (age < 0 || age > 120) return { compliant: false, age: 0, reason: 'Invalid date of birth.' };
  if (age < 13) return { compliant: false, age, reason: 'This app is not available for users under 13 (COPPA).' };
  if (age < 18) return { compliant: false, age, reason: 'You must be 18 or older to use this app.' };
  return { compliant: true, age };
}

export function calculateAge(dob: string): number {
  const d = new Date(dob), today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return Math.max(0, age);
}

export function isAdult(dob: string): boolean { return calculateAge(dob) >= 18; }
export function getMinimumAllowedDOB(): Date { const t = new Date(); return new Date(t.getFullYear() - 18, t.getMonth(), t.getDate()); }
export function getMaximumAllowedDOB(): Date { const t = new Date(); return new Date(t.getFullYear() - 120, t.getMonth(), t.getDate()); }

export function validateDateOfBirth(dob: string): { valid: boolean; age: number; reason?: string } {
  const coppa = checkCOPPACompliance(dob);
  if (!coppa.compliant) return { valid: false, age: coppa.age, reason: coppa.reason };
  if (new Date(dob) > new Date()) return { valid: false, age: 0, reason: 'Date of birth cannot be in the future.' };
  if (coppa.age > 120) return { valid: false, age: coppa.age, reason: 'Please enter a valid date of birth.' };
  return { valid: true, age: coppa.age };
}

export function createAgeVerificationRecord(statedAge: number, estimatedAge: number | null, method: AgeVerification['method'], confidence: number, requiresManualReview = false): AgeVerification {
  const diff = estimatedAge !== null ? Math.abs(statedAge - estimatedAge) : null;
  return { verified: true, method, estimatedAge, statedAge, ageDifference: diff, verifiedAt: new Date().toISOString(), confidence, requiresManualReview, flaggedForReview: requiresManualReview || (diff !== null && diff > 8) };
}