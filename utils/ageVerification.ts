export interface AgeVerification {
  verified: boolean;
  method: 'self-reported' | 'ai-estimated' | 'id-verified';
  estimatedAge: number | null;
  statedAge: number;
  ageDifference: number | null;
  verifiedAt: string;
  confidence: number;
}

export const getAgeVerificationLevel = (verification: AgeVerification | null | undefined): {
  level: 'unverified' | 'ai-verified' | 'id-verified';
  color: string;
  label: string;
  icon: string;
} => {
  if (!verification) {
    return {
      level: 'unverified',
      color: '#888',
      label: 'Unverified',
      icon: 'O',
    };
  }

  if (verification.method === 'id-verified') {
    return {
      level: 'id-verified',
      color: '#f1c40f',
      label: 'ID Verified',
      icon: '*',
    };
  }

  if (verification.verified && verification.method === 'ai-estimated') {
    return {
      level: 'ai-verified',
      color: '#3498db',
      label: 'Age Verified',
      icon: '✓',
    };
  }

  if (verification.ageDifference && verification.ageDifference > 5) {
    return {
      level: 'unverified',
      color: '#e67e22',
      label: 'Unverified Age',
      icon: '!',
    };
  }

  return {
    level: 'unverified',
    color: '#888',
    label: 'Unverified',
    icon: 'O',
  };
};

export const getAgeVerificationTooltip = (verification: AgeVerification | null | undefined): string => {
  if (!verification) {
    return 'Age not verified';
  }

  if (verification.method === 'id-verified') {
    return 'Age verified with government ID';
  }

  if (verification.verified && verification.method === 'ai-estimated') {
    return 'Age verified by AI. Estimated: ' + (verification.estimatedAge || 'unknown') + ', Stated: ' + verification.statedAge;
  }

  if (verification.ageDifference && verification.ageDifference > 5) {
    return 'Age differs from AI estimate by ' + verification.ageDifference + ' years';
  }

  return 'Age self-reported, not verified';
};