
export type SensitiveHealthCategory =
  | 'hiv_status'
  | 'sti_status'
  | 'reproductive_health'
  | 'mental_health'
  | 'disability'
  | 'substance_use'
  | 'medication';

export interface HealthDataPolicy {
  category: SensitiveHealthCategory;
  storageAllowed: boolean;
  encryptionRequired: boolean;
  thirdPartyShareAllowed: boolean;
  retentionDays: number;
  deletionOnRequest: 'immediate' | 'within_30_days';
  legalBasis: 'explicit_consent' | 'vital_interest' | 'prohibited';
}

const HEALTH_DATA_POLICIES: Record<
  SensitiveHealthCategory,
  HealthDataPolicy
> = {
  hiv_status: {
    category: 'hiv_status',
    storageAllowed: true,
    encryptionRequired: true,
    thirdPartyShareAllowed: false,
    retentionDays: 0,          // Never retained beyond session
    deletionOnRequest: 'immediate',
    legalBasis: 'explicit_consent',
  },
  sti_status: {
    category: 'sti_status',
    storageAllowed: false,      // Do NOT store
    encryptionRequired: true,
    thirdPartyShareAllowed: false,
    retentionDays: 0,
    deletionOnRequest: 'immediate',
    legalBasis: 'prohibited',
  },
  mental_health: {
    category: 'mental_health',
    storageAllowed: true,
    encryptionRequired: true,
    thirdPartyShareAllowed: false,
    retentionDays: 365,
    deletionOnRequest: 'immediate',
    legalBasis: 'explicit_consent',
  },
  disability: {
    category: 'disability',
    storageAllowed: true,
    encryptionRequired: true,
    thirdPartyShareAllowed: false,
    retentionDays: 730,
    deletionOnRequest: 'immediate',
    legalBasis: 'explicit_consent',
  },
  reproductive_health: {
    category: 'reproductive_health',
    storageAllowed: false,
    encryptionRequired: true,
    thirdPartyShareAllowed: false,
    retentionDays: 0,
    deletionOnRequest: 'immediate',
    legalBasis: 'prohibited',
  },
  substance_use: {
    category: 'substance_use',
    storageAllowed: true,
    encryptionRequired: true,
    thirdPartyShareAllowed: false,
    retentionDays: 180,
    deletionOnRequest: 'immediate',
    legalBasis: 'explicit_consent',
  },
  medication: {
    category: 'medication',
    storageAllowed: false,
    encryptionRequired: true,
    thirdPartyShareAllowed: false,
    retentionDays: 0,
    deletionOnRequest: 'immediate',
    legalBasis: 'prohibited',
  },
};

export function validateHealthDataStorage(
  category: SensitiveHealthCategory,
  hasExplicitConsent: boolean
): { allowed: boolean; reason: string } {
  const policy = HEALTH_DATA_POLICIES[category];

  if (policy.legalBasis === 'prohibited') {
    return {
      allowed: false,
      reason: `Storage of ${category} data is prohibited by platform policy`,
    };
  }

  if (!hasExplicitConsent) {
    return {
      allowed: false,
      reason: `Explicit consent required for ${category} data`,
    };
  }

  return { allowed: policy.storageAllowed, reason: 'Policy satisfied' };
}

const HEALTH_DISCLOSURE_PATTERNS: Record<SensitiveHealthCategory, RegExp[]> = {
  hiv_status: [
    /\bHIV\s*(positive|negative|poz|neg)\b/i,
    /\bundetectable\b/i,
    /\bPrEP\b/i,
    /\bPEP\b/i,
    /\bART\b.{0,20}\bHIV\b/i,
  ],
  sti_status: [
    /\b(chlamydia|gonorrhea|syphilis|herpes|HPV|STI|STD)\b/i,
    /\bclean\b.{0,10}\bSTI\b/i,
    /\btested\b.{0,20}\b(clean|clear|negative)\b/i,
  ],
  reproductive_health: [
    /\bpregnant\b/i,
    /\bfertility\b/i,
    /\bIVF\b/i,
    /\babortion\b/i,
    /\bmiscarriage\b/i,
  ],
  mental_health: [
    /\bdepression\b/i,
    /\banxiety\b/i,
    /\bbipolar\b/i,
    /\btherapy\b/i,
    /\bmedicated\b/i,
  ],
  disability: [/\bdisability\b/i, /\bdisabled\b/i, /\bwheelchair\b/i],
  substance_use: [/\bsober\b/i, /\brecovery\b/i, /\baddiction\b/i],
  medication: [/\bmedication\b/i, /\bprescription\b/i],
};

export function detectHealthDisclosure(message: string): {
  detected: boolean;
  categories: SensitiveHealthCategory[];
  requiresSecureHandling: boolean;
} {
  const detected: SensitiveHealthCategory[] = [];

  for (const [category, patterns] of Object.entries(
    HEALTH_DISCLOSURE_PATTERNS
  )) {
    if (patterns.some(p => p.test(message))) {
      detected.push(category as SensitiveHealthCategory);
    }
  }

  return {
    detected: detected.length > 0,
    categories: detected,
    requiresSecureHandling: detected.length > 0,
  };
}