// ═══════════════════════════════════════════════════════════════
// finalDetectors.ts — [32] Progressive Disclosure + [9] Physical Date
// Upgrades: #706, #649
// ═══════════════════════════════════════════════════════════════

// ─── #706 STI Access / Progressive Disclosure ────────────

export interface STIAccessResult {
  progressiveDisclosure: boolean;
  userControlled: boolean;
  matchStateRequired: 'any' | 'matched' | 'mutual_like' | 'messaging' | 'verified';
  neverShowOnProfile: boolean;
  neverIncludeInSearch: boolean;
  neverIncludeInAnalytics: boolean;
  fieldLevelEncryption: boolean;
  disclosureLogRequired: boolean;
  disclosureSteps: string[];
}

export function stiAccess(matchState: 'browsing' | 'matched' | 'mutual_like' | 'messaging' | 'verified_match' = 'mutual_like'): STIAccessResult {
  return {
    progressiveDisclosure: true,
    userControlled: true,
    matchStateRequired: matchState === 'browsing' ? 'mutual_like' : matchState === 'matched' ? 'mutual_like' : matchState as any,
    neverShowOnProfile: true,
    neverIncludeInSearch: true,
    neverIncludeInAnalytics: true,
    fieldLevelEncryption: true,
    disclosureLogRequired: true,
    disclosureSteps: [
      '1. User opts in to sharing STI status',
      '2. Status only visible after mutual like',
      '3. Reveal is one-way (user sees that they shared, not the actual status)',
      '4. Full status visible only in active messaging',
      '5. All disclosures logged for audit',
      '6. Data encrypted with user-specific key',
      '7. Auto-delete on unmatch',
    ],
  };
}

// ─── #649 Drink Spiking / Safety Awareness ───────────────

export interface DrinkSpikingAlertResult {
  safetyTips: string[];
  contextualAlerts: boolean;
  triggerWords: string[];
  alertLevel: 'none' | 'info' | 'warning' | 'urgent';
  resources: string[];
}

const DRINK_SAFETY_TRIGGER_WORDS = [
  /drink\s+(spiking?|tampered|drugged|roofied|ghb|ketamine)/i,
  /my\s+drink\s+(tastes?|smells?|looks?)\s+(weird|funny|off|strange|wrong)/i,
  /i\s+feel\s+(dizzy|woozy|confused|fuzzy|strange|out\s+of\s+it|really\s+drunk)\s+(but|and\s+i'?ve\s+only)/i,
  /(someone\s+)?(put|slipped|dropped|poured)\s+(something|a\s+pill|drugs?)\s+(in|into)\s+/i,
  /(roofie|ghb|ketamine|rohypnol|xanax|benzo)/i,
];

export function drinkSpikingAlert(message?: string): DrinkSpikingAlertResult {
  const safetyTips = [
    'Never leave your drink unattended — take it with you or finish it first',
    'Watch your drink being prepared or poured',
    'Use a drink cover or spiked drink test strip (available at many bars)',
    'If your drink tastes unusual, stop drinking it immediately',
    'If you feel unexpectedly intoxicated, tell someone immediately — bar staff, a friend, or call for help',
    'Trust your instincts — if something feels wrong, leave',
    'Look out for your friends — if someone seems unexpectedly intoxicated, help them get to safety',
    'Know your limits — alternate alcoholic drinks with water',
  ];

  const resources = [
    'National Sexual Assault Hotline: 1-800-656-4673 (RAINN)',
    'Crisis Text Line: Text HELP to 741741',
    'If you suspect you\'ve been drugged, call 911 or go to the ER immediately',
    'Ask for a drug test at the hospital — some substances leave the system quickly',
  ];

  if (!message) {
    return {
      safetyTips,
      contextualAlerts: true,
      triggerWords: [],
      alertLevel: 'info',
      resources,
    };
  }

  const triggerWords: string[] = [];
  let alertLevel: DrinkSpikingAlertResult['alertLevel'] = 'info';

  for (const pattern of DRINK_SAFETY_TRIGGER_WORDS) {
    if (pattern.test(message)) {
      triggerWords.push(pattern.source);
    }
  }

  if (triggerWords.length >= 2) {
    alertLevel = 'urgent';
  } else if (triggerWords.length >= 1) {
    alertLevel = 'warning';
  }

  return {
    safetyTips,
    contextualAlerts: true,
    triggerWords,
    alertLevel,
    resources,
  };
}

export const drinkSafetyTips = drinkSpikingAlert;
export const spikingAlert = drinkSpikingAlert;

// ─── Re-exports for backward compatibility ───────────────

export const getDrinkSafetyTips = () => drinkSpikingAlert().safetyTips;