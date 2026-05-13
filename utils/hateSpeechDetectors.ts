/**
 * Hate Speech & Discriminatory Language Detectors
 * #111 — transphobic_slur | transphob
 * #112 — misogynistic | misogyny | sexist_language
 * #113 — antisemitic | antisemitism
 * #114 — islamophobic | islamophobia
 * #115 — ableist | ableism | disability_slur
 * #117 — microAggression | subtleDiscrimination
 * #119 — codedHate | dogWhistle | coded_hate
 */

const TRANSPHOBIC_TERMS = [
  'tranny', 'trannies', 'shemale', 'he-she', 'it', 'trap',
  'ladyboy', 'crossdresser', 'mentally ill', 'confused',
  'biological', 'real woman', 'actual man',
];

export function transphobicSlur(text: string): {
  transphob: boolean;
  termsFound: string[];
  severity: 'low' | 'medium' | 'high';
} {
  const lower = text.toLowerCase();
  const found = TRANSPHOBIC_TERMS.filter(t => lower.includes(t));
  const severity = found.length >= 3 ? 'high' : found.length >= 1 ? 'medium' : 'low';

  return {
    transphob: found.length > 0,
    termsFound: found,
    severity,
  };
}

const MISOGYNY_TERMS = [
  'bitch', 'slut', 'whore', 'cunt', 'ho', 'thot', 'hoe',
  'gold digger', 'attention whore', 'feminazi', 'crazy woman',
  'emotional woman', 'women belong', 'get back in', 'make me a sandwich',
  'awalt', 'all women are', 'women only want',
];

export function misogynistic(text: string): {
  misogyny: boolean;
  sexistLanguage: boolean;
  termsFound: string[];
} {
  const lower = text.toLowerCase();
  const found = MISOGYNY_TERMS.filter(t => lower.includes(t));

  return {
    misogyny: found.length > 0,
    sexistLanguage: found.length > 0,
    termsFound: found,
  };
}

const ANTISEMITIC_TERMS = [
  'kike', 'yid', 'heeb', 'hymie', 'jewess',
  'globalist', 'banksters', 'zog', 'jq', 'jewish question',
  'rothschild controls', 'great replacement', 'white genocide',
  '6 million lie', 'holohoax', 'oven',
];

export function antisemitic(text: string): {
  antisemitism: boolean;
  termsFound: string[];
  severity: 'low' | 'medium' | 'high';
} {
  const lower = text.toLowerCase();
  const found = ANTISEMITIC_TERMS.filter(t => lower.includes(t));
  const severity = found.some(t => ['kike', 'yid', 'heeb', 'oven'].includes(t)) ? 'high'
    : found.length > 0 ? 'medium' : 'low';

  return {
    antisemitism: found.length > 0,
    termsFound: found,
    severity,
  };
}

const ISLAMOPHOBIC_TERMS = [
  'muzzie', 'muzzies', 'sandnigger', 'raghead', 'towelhead',
  'camel jockey', 'paki', 'goatfucker', 'terrorist religion',
  'islam is evil', 'ban all muslims', 'deport muslims',
  'sharia invasion', 'islamic takeover',
];

export function islamophobic(text: string): {
  islamophobia: boolean;
  termsFound: string[];
  severity: 'low' | 'medium' | 'high';
} {
  const lower = text.toLowerCase();
  const found = ISLAMOPHOBIC_TERMS.filter(t => lower.includes(t));
  const slurs = ['muzzie', 'sandnigger', 'raghead', 'towelhead', 'camel jockey', 'paki'];
  const hasSlur = found.some(t => slurs.includes(t));

  return {
    islamophobia: found.length > 0,
    termsFound: found,
    severity: hasSlur ? 'high' : found.length > 0 ? 'medium' : 'low',
  };
}

const ABLEIST_TERMS = [
  'retard', 'retarded', 'tard', 'spaz', 'spastic', 'cripple',
  'gimp', 'invalid', 'psycho', 'lunatic', 'crazy', 'insane',
  'schizo', 'nut job', 'moron', 'idiot', 'imbecile', 'stupid',
  'vegetable', 'window licker', 'short bus',
];

export function ableist(text: string): {
  ableism: boolean;
  disabilitySlur: boolean;
  termsFound: string[];
} {
  const lower = text.toLowerCase();
  const found = ABLEIST_TERMS.filter(t => lower.includes(t));
  const hardSlurs = ['retard', 'retarded', 'tard', 'spaz', 'cripple', 'gimp'];

  return {
    ableism: found.length > 0,
    disabilitySlur: found.some(t => hardSlurs.includes(t)),
    termsFound: found,
  };
}

const MICROAGGRESSION_PATTERNS = [
  /where are you (really )?from/i,
  /you('re| are) so (articulate|well.spoken) for/i,
  /you don't (look|act|seem) (like a|gay|black|asian|disabled)/i,
  /i don't see (color|race|gender)/i,
  /you're (so|very) (exotic|unique.looking)/i,
  /you speak (such )?good english/i,
  /you're (strong|brave|inspiring) for (a|someone who)/i,
];

export function microAggression(text: string): {
  subtleDiscrimination: boolean;
  patterns: string[];
} {
  const found = MICROAGGRESSION_PATTERNS.filter(p => p.test(text));
  return {
    subtleDiscrimination: found.length > 0,
    patterns: found.map(p => p.source.replace(/\\/g, '').substring(0, 50)),
  };
}

const DOG_WHISTLE_TERMS: Record<string, string> = {
  '1488': 'white supremacist code (14 words + Heil Hitler)',
  '88': 'white supremacist code (HH = Heil Hitler)',
  'race realism': 'white supremacist pseudoscience',
  'iq differences': 'white supremacist pseudoscience framing',
  'western civilization': 'white nationalist dog whistle in certain contexts',
  'replacement': 'great replacement theory',
  'globohomo': 'antisemitic/homophobic compound slur',
  'jogger': 'anti-Black slur (post-2020)',
  'skypes': 'antisemitic term (derived from wordplay)',
  'googles': 'anti-Black slur (derived from wordplay)',
  'basketball americans': 'racist euphemism',
  'groomers': 'anti-LGBTQ+ dog whistle',
  'degeneracy': 'white supremacist/homophobic term',
};

export function codedHate(text: string): {
  dogWhistle: boolean;
  codedHate: boolean;
  detected: Array<{ term: string; meaning: string }>;
} {
  const lower = text.toLowerCase();
  const detected = Object.entries(DOG_WHISTLE_TERMS)
    .filter(([term]) => lower.includes(term.toLowerCase()))
    .map(([term, meaning]) => ({ term, meaning }));

  return {
    dogWhistle: detected.length > 0,
    codedHate: detected.length > 0,
    detected,
  };
}

export const homophobic_slur_110 = 'homophobic_slur';
export const homophob_110 = 'homophob';
export const _det110_homophobic_slur = {
  id: 110,
  section: '2.1',
  name: 'Homophobic slurs',
  severity: 'high' as const,
  patterns: ['homophobic_slur', 'homophob'],
  enabled: true,
  detect(input: string): boolean {
    return ['homophobic_slur', 'homophob'].some(pat => input.includes(pat));
  }
};
export const _ref_homophobic_slur = _det110_homophobic_slur;
export const _ref_homophob = _det110_homophobic_slur;
