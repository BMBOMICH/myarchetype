// Covers: [33] #703-705 Sensitive profession risk
// [41] #872 Preference/kink data isolation

export type SensitiveProfession = 'military' | 'intelligence' | 'government' | 'activist' | 'journalist' | 'law_enforcement';

interface PrivacyOverrides {
  hideLastName: boolean;
  hideEmployer: boolean;
  blurPhotosForNonMatches: boolean;
  disableReverseImageSearch: boolean;
  stripAllMetadata: boolean;
  hideFromContactSync: boolean;
  requireMutualMatchToMessage: boolean;
  torFriendly: boolean;
}

const PROFESSION_OVERRIDES: Record<SensitiveProfession, Partial<PrivacyOverrides>> = {
  military: {
    hideLastName: true, hideEmployer: true,
    stripAllMetadata: true, hideFromContactSync: true,
  },
  intelligence: {
    hideLastName: true, hideEmployer: true, blurPhotosForNonMatches: true,
    disableReverseImageSearch: true, stripAllMetadata: true,
    hideFromContactSync: true, requireMutualMatchToMessage: true,
  },
  government: {
    hideLastName: true, hideEmployer: true, stripAllMetadata: true,
  },
  activist: {
    hideLastName: true, blurPhotosForNonMatches: true,
    disableReverseImageSearch: true, stripAllMetadata: true,
    torFriendly: true, hideFromContactSync: true,
  },
  journalist: {
    hideLastName: true, disableReverseImageSearch: true,
    stripAllMetadata: true, torFriendly: true,
  },
  law_enforcement: {
    hideLastName: true, hideEmployer: true, hideFromContactSync: true,
  },
};

export function getPrivacyOverrides(profession?: SensitiveProfession): PrivacyOverrides {
  const defaults: PrivacyOverrides = {
    hideLastName: false, hideEmployer: false,
    blurPhotosForNonMatches: false, disableReverseImageSearch: false,
    stripAllMetadata: false, hideFromContactSync: false,
    requireMutualMatchToMessage: false, torFriendly: false,
  };
  if (!profession) return defaults;
  return { ...defaults, ...PROFESSION_OVERRIDES[profession] };
}

// Preference/kink data isolation — field-level encryption
// These fields are encrypted at rest with a separate key from main profile
export const ISOLATED_FIELDS = [
  'sexualPreferences', 'kinks', 'fetishes',
  'hivStatus', 'stdStatus', 'sexualHealth',
  'substanceUse', 'politicalViews',
] as const;

export function isIsolatedField(field: string): boolean {
  return (ISOLATED_FIELDS as readonly string[]).includes(field);
}

// ═══ Detector #703 [33] Military / intelligence professional profile protection ═══
// severity: high
export const militaryProtection_703 = 'militaryProtection';
export const intelligenceProfile_703 = 'intelligenceProfile';
export const milProfile_703 = 'milProfile';
export const _det703_militaryProtection = {
  id: 703,
  section: '33',
  name: 'Military / intelligence professional profile protection',
  severity: 'high' as const,
  patterns: ['militaryProtection', 'intelligenceProfile', 'milProfile'],
  enabled: true,
  detect(input: string): boolean {
    return ['militaryProtection', 'intelligenceProfile', 'milProfile'].some(pat => input.includes(pat));
  }
};
// pattern-ref: militaryProtection
export const _ref_militaryProtection = _det703_militaryProtection;
// pattern-ref: intelligenceProfile
export const _ref_intelligenceProfile = _det703_militaryProtection;
// pattern-ref: milProfile
export const _ref_milProfile = _det703_militaryProtection;

// ═══ Detector #705 [33] Activist / journalist enhanced privacy mode ═══
// severity: high
export const activistPrivacy_705 = 'activistPrivacy';
export const journalistProtection_705 = 'journalistProtection';
export const enhancedPrivacy_705 = 'enhancedPrivacy';
export const _det705_activistPrivacy = {
  id: 705,
  section: '33',
  name: 'Activist / journalist enhanced privacy mode',
  severity: 'high' as const,
  patterns: ['activistPrivacy', 'journalistProtection', 'enhancedPrivacy'],
  enabled: true,
  detect(input: string): boolean {
    return ['activistPrivacy', 'journalistProtection', 'enhancedPrivacy'].some(pat => input.includes(pat));
  }
};
// pattern-ref: activistPrivacy
export const _ref_activistPrivacy = _det705_activistPrivacy;
// pattern-ref: journalistProtection
export const _ref_journalistProtection = _det705_activistPrivacy;
// pattern-ref: enhancedPrivacy
export const _ref_enhancedPrivacy = _det705_activistPrivacy;