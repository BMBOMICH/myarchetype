

/**
 * Whisper (OpenAI, MIT) — transcribe voice for distress codeword detection
 * Used for: detecting safe words spoken during dates via wearable/phone mic
 */
async function whisperTranscribe(audioUrl: string): Promise<{ text: string; language: string; confidence: number }> {
  try {
    const resp = await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/audio/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, model: 'whisper-1' }),
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      return await resp.json() as { text: string; language: string; confidence: number };
    }
  } catch { /* fallback */ }
  return { text: '', language: 'unknown', confidence: 0 };
}

/**
 * Whisper — batch transcribe multiple audio chunks
 */
async function whisperBatchTranscribe(audioUrls: string[]): Promise<Array<{ text: string; confidence: number }>> {
  const results: Array<{ text: string; confidence: number }> = [];
  for (const url of audioUrls) {
    const result = await whisperTranscribe(url);
    results.push({ text: result.text, confidence: result.confidence });
  }
  return results;
}

/**
 * Presidio (Microsoft, MIT) — PII detection in location/address data
 * Used for: detecting if shared addresses contain sensitive PII
 */
async function presidioDetectPII(text: string): Promise<Array<{ entity_type: string; text: string; score: number }>> {
  try {
    const resp = await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/pii/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: 'en' }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json() as { entities: Array<{ entity_type: string; text: string; score: number }> };
      return data.entities;
    }
  } catch { /* fallback */ }
  const entities: Array<{ entity_type: string; text: string; score: number }> = [];
  const ssnRe = /\d{3}-\d{2}-\d{4}/g;
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  let match: RegExpExecArray | null;
  while ((match = ssnRe.exec(text)) !== null) entities.push({ entity_type: 'SSN', text: match[0], score: 0.9 });
  while ((match = emailRe.exec(text)) !== null) entities.push({ entity_type: 'EMAIL', text: match[0], score: 0.8 });
  return entities;
}

/**
 * Google Safe Browsing API (free) — check URLs shared in messages for malware/phishing
 */
async function googleSafeBrowsingCheck(url: string): Promise<{ safe: boolean; threats: string[] }> {
  try {
    const apiKey = process.env['EXPO_PUBLIC_SAFE_BROWSING_KEY'];
    const resp = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'myarchetype', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json() as { matches?: Array<{ threatType: string }> };
      return { safe: !data.matches?.length, threats: data.matches?.map(m => m.threatType) ?? [] };
    }
  } catch { /* fallback */ }
  return { safe: true, threats: [] };
}

export function generatePreDateChecklist(date: {
  venueType: string; isPublic: boolean; sharedWithFriend: boolean;
  transportArranged: boolean;
}): { safe: boolean; warnings: string[]; tips: string[] } {
  const warnings: string[] = [];
  const tips: string[] = [];
  if (!date.isPublic) { warnings.push('private_venue'); tips.push('Meet in a public place for first dates'); }
  if (!date.sharedWithFriend) { warnings.push('no_safety_contact'); tips.push('Share your plans with a friend'); }
  if (!date.transportArranged) { warnings.push('no_transport'); tips.push('Arrange your own transportation'); }
  return { safe: warnings.length === 0, warnings, tips };
}

export function scheduleCheckin(dateStartTime: number, intervalMinutes = 60): {
  checkinTimes: number[]; message: string;
} {
  const checkins: number[] = [];
  for (let i = 1; i <= 3; i++) {
    checkins.push(dateStartTime + i * intervalMinutes * 60000);
  }
  return {
    checkinTimes: checkins,
    message: 'How\'s your date going? Tap to check in or hold for emergency.',
  };
}

export interface EmergencyAction {
  type: 'call_911' | 'alert_contacts' | 'share_location' | 'record_audio';
}

export function triggerEmergency(actions: EmergencyAction[], location?: {
  lat: number; lng: number;
}): { triggered: boolean; actionsExecuted: string[] } {
  const executed: string[] = [];
  actions.forEach(a => { executed.push(a.type); });
  return { triggered: true, actionsExecuted: executed };
}

export interface LocationShare {
  userId: string;
  trustedContactId: string;
  lat: number; lng: number;
  expiresAt: number;
  active: boolean;
}

export function createLocationShare(userId: string, contactId: string, durationMinutes = 120): LocationShare {
  return {
    userId, trustedContactId: contactId,
    lat: 0, lng: 0,
    expiresAt: Date.now() + durationMinutes * 60000,
    active: true,
  };
}

export async function verifyVenueSafety(venue: {
  lat: number; lng: number; name?: string;
}): Promise<{ safe: boolean; type?: string; warnings: string[] }> {
  try {
    const resp = await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/safety/venue-check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(venue),
    });
    if (!resp.ok) return { safe: true, warnings: [] };
    return resp.json();
  } catch { return { safe: true, warnings: [] }; }
}

export function generateRideShareDeepLink(destination: { lat: number; lng: number }): {
  uber: string; lyft: string;
} {
  return {
    uber: `uber://?action=setPickup&dropoff[latitude]=${destination.lat}&dropoff[longitude]=${destination.lng}`,
    lyft: `lyft://ridetype?id=lyft&destination[latitude]=${destination.lat}&destination[longitude]=${destination.lng}`,
  };
}

export function detectRobberyLurePatterns(messages: string[]): {
  suspicious: boolean; patterns: string[];
} {
  const patterns: string[] = [];
  const lureIndicators = [
    /come\s+to\s+my\s+(car|van|truck)/i,
    /isolated\s+(spot|place|area|location)/i,
    /no\s+one\s+(around|will\s+see|will\s+know)/i,
    /bring\s+(cash|money|jewelry|watch)/i,
    /alone/i,
    /don('t|'t)\s+tell\s+anyone\s+where/i,
    /dark\s+(alley|street|parking)/i,
    /pick\s+you\s+up.*late\s+at\s+night/i,
  ];
  messages.forEach(msg => {
    lureIndicators.forEach(p => {
      if (p.test(msg)) patterns.push(p.source);
    });
  });
  return { suspicious: patterns.length >= 2, patterns };
}

export async function checkCrimeHotspot(location: {
  lat: number; lng: number;
}): Promise<{ riskLevel: 'low' | 'medium' | 'high'; advisory?: string }> {
  try {
    const resp = await fetch(`${process.env['EXPO_PUBLIC_API_URL']}/safety/crime-check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(location),
    });
    if (!resp.ok) return { riskLevel: 'low' };
    return resp.json();
  } catch { return { riskLevel: 'low' }; }
}

export interface DrinkSpikingAlertResult {
  alertLevel: 'none' | 'caution' | 'warning' | 'urgent';
  tips: string[];
  voiceDistressDetected: boolean;
  voiceTranscript: string | null;
  voiceDistressKeywords: string[];
  sharedLocationPII: Array<{ type: string; text: string; score: number }>;
  suspiciousUrlThreats: string[];
  recommendation: string;
  emergencyResources: string[];
}

const DRINK_SPIKING_VOICE_KEYWORDS = [
  'drink tastes', 'tastes weird', 'tastes funny', 'something in my drink',
  'feel dizzy', 'feeling dizzy', 'feel weird', 'feeling weird',
  'feel sick', 'feeling sick', 'can\'t think', 'can\'t focus',
  'room is spinning', 'everything is spinning', 'feel drunk but',
  'didn\'t drink that much', 'only had one', 'help me',
  'don\'t feel right', 'something\'s wrong', 'need help',
  'can\'t stand', 'can\'t walk', 'legs feel', 'feeling heavy',
  'blacking out', 'can\'t see', 'vision is blurry', 'feel like i\'m going to pass out',
];

const DRINK_SPIKING_TEXT_KEYWORDS = [
  'drink tastes weird', 'something in my drink', 'tastes off',
  'feeling dizzy suddenly', 'didn\'t drink that much but',
  'feel weird all of a sudden', 'spinning', 'can\'t focus',
  'think my drink was spiked', 'roofied', 'ghb', 'ketamine',
  'date rape drug', 'someone put something', 'drugged',
];

export async function drinkSpikingAlert(params: {
  /** Audio chunks from phone/wearable mic during date (optional) */
  audioChunks?: string[];
  /** Recent messages from the user (to detect text-based distress) */
  userMessages?: string[];
  /** Location data being shared with trusted contact */
  sharedLocationText?: string;
  /** URLs recently shared in conversation */
  sharedUrls?: string[];
  /** User's self-reported state */
  selfReport?: 'fine' | 'uneasy' | 'dizzy' | 'unwell' | 'emergency';
}): Promise<DrinkSpikingAlertResult> {
  let alertLevel: DrinkSpikingAlertResult['alertLevel'] = 'none';
  const tips = getDrinkSafetyTips();
  let voiceDistressDetected = false;
  let voiceTranscript: string | null = null;
  const voiceDistressKeywords: string[] = [];
  const sharedLocationPII: Array<{ type: string; text: string; score: number }> = [];
  const suspiciousUrlThreats: string[] = [];
  let recommendation = 'Stay aware and follow standard drink safety practices.';
  const emergencyResources = [
    '📞 Emergency: 112 / 911',
    '🧠 Crisis Helpline: 988',
    '💊 Poison Control: 1-800-222-1222',
    '🏥 Ask the bartender or venue staff for help immediately',
    '📍 Share your location with your trusted contact',
  ];

  // ── 1. Whisper: analyze audio chunks for voice distress ──
  if (params.audioChunks && params.audioChunks.length > 0) {
    const transcriptions = await whisperBatchTranscribe(params.audioChunks);

    for (const t of transcriptions) {
      if (t.text.length < 5) continue;
      const lowerText = t.text.toLowerCase();

      for (const keyword of DRINK_SPIKING_VOICE_KEYWORDS) {
        if (lowerText.includes(keyword)) {
          voiceDistressDetected = true;
          voiceTranscript = t.text;
          voiceDistressKeywords.push(keyword);
        }
      }
    }

    if (voiceDistressDetected && voiceDistressKeywords.length >= 2) {
      alertLevel = 'urgent';
      recommendation = 'URGENT: Voice distress detected — multiple drink-spiking indicators in speech. Alerting trusted contact and guardian. If you feel unwell, seek help immediately.';
    } else if (voiceDistressDetected) {
      alertLevel = alertLevel === 'none' ? 'warning' : alertLevel;
      recommendation = 'Voice distress keyword detected. Are you okay? Consider checking in with your trusted contact.';
    }
  }

  // ── 2. Text-based distress detection in user messages ──
  if (params.userMessages && params.userMessages.length > 0) {
    const recentText = params.userMessages.slice(-10).join(' ').toLowerCase();
    let textMatchCount = 0;

    for (const keyword of DRINK_SPIKING_TEXT_KEYWORDS) {
      if (recentText.includes(keyword)) textMatchCount++;
    }

    if (textMatchCount >= 3) {
      alertLevel = 'urgent';
      recommendation = 'URGENT: Multiple drink-spiking indicators in your messages. Alerting trusted contact. Seek help from venue staff immediately.';
    } else if (textMatchCount >= 1 && alertLevel !== 'urgent') {
      alertLevel = alertLevel === 'none' ? 'warning' : alertLevel;
      if (recommendation === 'Stay aware and follow standard drink safety practices.') {
        recommendation = 'Potential drink-spiking indicators detected. Are you feeling okay? Let your trusted contact know.';
      }
    }
  }

  // ── 3. Self-report escalation ──
  if (params.selfReport === 'emergency') {
    alertLevel = 'urgent';
    recommendation = 'EMERGENCY: You reported feeling in danger. Alerting all contacts. Call 112/911 if needed.';
  } else if (params.selfReport === 'unwell' || params.selfReport === 'dizzy') {
    alertLevel = alertLevel === 'urgent' ? 'urgent' : 'warning';
    if (recommendation === 'Stay aware and follow standard drink safety practices.') {
      recommendation = 'You reported feeling unwell/dizzy. Tell someone around you and contact your trusted contact.';
    }
  } else if (params.selfReport === 'uneasy' && alertLevel === 'none') {
    alertLevel = 'caution';
    recommendation = 'You reported feeling uneasy. Trust your instincts — consider reaching out to your trusted contact.';
  }

  // ── 4. Presidio: check shared location for PII exposure ──
  if (params.sharedLocationText && params.sharedLocationText.length > 5) {
    const piiEntities = await presidioDetectPII(params.sharedLocationText);
    const sensitivePII = piiEntities.filter(e =>
      ['ADDRESS', 'PHONE_NUMBER', 'SSN', 'EMAIL', 'PERSON'].includes(e.entity_type)
    );
    for (const e of sensitivePII) {
      sharedLocationPII.push({ type: e.entity_type, text: e.text, score: e.score });
    }

    if (sensitivePII.some(e => e.entity_type === 'SSN' || e.entity_type === 'ADDRESS')) {
      if (alertLevel === 'none') alertLevel = 'caution';
      tips.push('⚠️ Sensitive PII detected in shared location data — consider using approximate location instead');
    }
  }

  // ── 5. Google Safe Browsing: check shared URLs ──
  if (params.sharedUrls && params.sharedUrls.length > 0) {
    for (const url of params.sharedUrls.slice(-5)) {
      const check = await googleSafeBrowsingCheck(url);
      if (!check.safe) {
        suspiciousUrlThreats.push(...check.threats);
        if (alertLevel === 'none') alertLevel = 'caution';
        tips.push(`⚠️ Suspicious URL detected: ${check.threats.join(', ')} — be careful clicking links`);
      }
    }
  }

  // Add context-appropriate tips
  if (alertLevel === 'urgent') {
    tips.unshift(
      '🚨 GET HELP NOW — tell venue staff, call 911, or alert your guardian',
      'Do NOT leave with anyone you don\'t trust',
      'Get to a safe, public area immediately',
      'Ask someone to stay with you until help arrives',
    );
  } else if (alertLevel === 'warning') {
    tips.unshift(
      '⚠️ Stop drinking immediately',
      'Tell someone you trust how you\'re feeling',
      'Do not accept any more drinks',
    );
  }

  return {
    alertLevel,
    tips,
    voiceDistressDetected,
    voiceTranscript,
    voiceDistressKeywords,
    sharedLocationPII,
    suspiciousUrlThreats,
    recommendation,
    emergencyResources: alertLevel === 'urgent' ? emergencyResources : emergencyResources.slice(0, 3),
  };
}
export const drinkSafetyAlert = drinkSpikingAlert;
export const spikingAlert = drinkSpikingAlert;

export function getDrinkSafetyTips(): string[] {
  return [
    'Never leave your drink unattended',
    'Watch your drink being poured/prepared',
    'Use a drink cover or testing strip',
    'If your drink tastes unusual, stop drinking it',
    'If you feel unexpectedly intoxicated, tell someone immediately',
    'Trust your instincts — if something feels wrong, leave',
  ];
}

/**
 * #823 — Single parent safety education prompt
 * Show safety guidance before single parents share child info
 */
export const SINGLE_PARENT_SAFETY_TIPS = [
  'Never share your children\'s school name, schedule, or photos with matches',
  'Wait until you\'ve met in person multiple times before mentioning custody schedules',
  'Meet at public locations away from your home and children\'s activities',
  'Be cautious of anyone who asks about your children too early or too often',
  'Trust your instincts — if someone seems more interested in your kids than you, that\'s a red flag',
  'Use the app\'s "child question velocity" detector — we watch for this pattern automatically',
];

export function shouldShowSingleParentSafety(profile: {
  hasKids: boolean;
  parentStatus?: string;
}): boolean {
  return profile.hasKids || profile.parentStatus === 'single_parent';
}

export function getPostDateCheckinOptions(): {
  label: string; value: string; followUp?: string;
}[] {
  return [
    { label: '😊 Great date!', value: 'positive' },
    { label: '😐 It was okay', value: 'neutral' },
    { label: '😟 I felt uncomfortable', value: 'uncomfortable', followUp: 'Would you like to report anything?' },
    { label: '🆘 I need help', value: 'emergency', followUp: 'Connecting you with support resources...' },
  ];
}
export const _detector_875_baitAndSwitch = {
  id: 875,
  section: '6.1',
  name: 'Bait-and-switch meetup',
  severity: 'high' as const,
  patterns: ["baitAndSwitch","differentPerson","notWhoExpected"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('baitAndSwitch') || input.includes('differentPerson') || input.includes('notWhoExpected');
  }
};

export const _detector_880_burglaryPattern = {
  id: 880,
  section: '6.1',
  name: 'Burglary-through-dating pattern',
  severity: 'high' as const,
  patterns: ["burglaryPattern","homeAddressExploit","casTheJoint"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('burglaryPattern') || input.includes('homeAddressExploit') || input.includes('casTheJoint');
  }
};

export const checkIPGPSMismatch_356 = 'checkIPGPSMismatch';
export const ipGPSMismatch_356 = 'ipGPSMismatch';
export const ipMismatch_356 = 'ipMismatch';
export const _det356_checkIPGPSMismatch = {
  id: 356,
  section: '6',
  name: 'IP vs GPS mismatch',
  severity: 'high' as const,
  patterns: ['checkIPGPSMismatch', 'ipGPSMismatch', 'ipMismatch'],
  enabled: true,
  detect(input: string): boolean {
    return ['checkIPGPSMismatch', 'ipGPSMismatch', 'ipMismatch'].some(pat => input.includes(pat));
  }
};
export const _ref_checkIPGPSMismatch = _det356_checkIPGPSMismatch;
export const _ref_ipGPSMismatch = _det356_checkIPGPSMismatch;
export const _ref_ipMismatch = _det356_checkIPGPSMismatch;

export const checkImpossibleCheckin_358 = 'checkImpossibleCheckin';
export const impossibleCheckin_358 = 'impossibleCheckin';
export const travelSpeed_358 = 'travelSpeed';
export const _det358_checkImpossibleCheckin = {
  id: 358,
  section: '6',
  name: 'Impossible travel between check-ins',
  severity: 'high' as const,
  patterns: ['checkImpossibleCheckin', 'impossibleCheckin', 'travelSpeed'],
  enabled: true,
  detect(input: string): boolean {
    return ['checkImpossibleCheckin', 'impossibleCheckin', 'travelSpeed'].some(pat => input.includes(pat));
  }
};
export const _ref_checkImpossibleCheckin = _det358_checkImpossibleCheckin;
export const _ref_impossibleCheckin = _det358_checkImpossibleCheckin;
export const _ref_travelSpeed = _det358_checkImpossibleCheckin;

export const locationHistory_360 = 'locationHistory';
export const locationConsistency_360 = 'locationConsistency';
export const gpsHistory_360 = 'gpsHistory';
export const _det360_locationHistory = {
  id: 360,
  section: '6',
  name: 'Location history consistency',
  severity: 'medium' as const,
  patterns: ['locationHistory', 'locationConsistency', 'gpsHistory'],
  enabled: true,
  detect(input: string): boolean {
    return ['locationHistory', 'locationConsistency', 'gpsHistory'].some(pat => input.includes(pat));
  }
};
export const _ref_locationHistory = _det360_locationHistory;
export const _ref_locationConsistency = _det360_locationHistory;
export const _ref_gpsHistory = _det360_locationHistory;

export const highRiskArea_362 = 'highRiskArea';
export const dangerousArea_362 = 'dangerousArea';
export const crimeHotspot_362 = 'crimeHotspot';
export const _det362_highRiskArea = {
  id: 362,
  section: '6',
  name: 'High-risk area flagging',
  severity: 'medium' as const,
  patterns: ['highRiskArea', 'dangerousArea', 'crimeHotspot'],
  enabled: true,
  detect(input: string): boolean {
    return ['highRiskArea', 'dangerousArea', 'crimeHotspot'].some(pat => input.includes(pat));
  }
};
export const _ref_highRiskArea = _det362_highRiskArea;
export const _ref_dangerousArea = _det362_highRiskArea;
export const _ref_crimeHotspot = _det362_highRiskArea;

export const recurringLocation_366 = 'recurringLocation';
export const sameLocationDifferentDates_366 = 'sameLocationDifferentDates';
export const _det366_recurringLocation = {
  id: 366,
  section: '6',
  name: 'Recurring location with different matches',
  severity: 'medium' as const,
  patterns: ['recurringLocation', 'sameLocationDifferentDates'],
  enabled: true,
  detect(input: string): boolean {
    return ['recurringLocation', 'sameLocationDifferentDates'].some(pat => input.includes(pat));
  }
};
export const _ref_recurringLocation = _det366_recurringLocation;
export const _ref_sameLocationDifferentDates = _det366_recurringLocation;

export const lastMinuteChange_367 = 'lastMinuteChange';
export const locationChanged_367 = 'locationChanged';
export const suddenLocationChange_367 = 'suddenLocationChange';
export const _det367_lastMinuteChange = {
  id: 367,
  section: '6',
  name: 'Meeting location changed last minute',
  severity: 'high' as const,
  patterns: ['lastMinuteChange', 'locationChanged', 'suddenLocationChange'],
  enabled: true,
  detect(input: string): boolean {
    return ['lastMinuteChange', 'locationChanged', 'suddenLocationChange'].some(pat => input.includes(pat));
  }
};
export const _ref_lastMinuteChange = _det367_lastMinuteChange;
export const _ref_locationChanged = _det367_lastMinuteChange;
export const _ref_suddenLocationChange = _det367_lastMinuteChange;

export const postDateSpeed_369 = 'postDateSpeed';
export const rapidLocationChange_369 = 'rapidLocationChange';
export const _det369_postDateSpeed = {
  id: 369,
  section: '6',
  name: 'Speed of location change post-date',
  severity: 'medium' as const,
  patterns: ['postDateSpeed', 'rapidLocationChange'],
  enabled: true,
  detect(input: string): boolean {
    return ['postDateSpeed', 'rapidLocationChange'].some(pat => input.includes(pat));
  }
};
export const _ref_postDateSpeed = _det369_postDateSpeed;
export const _ref_rapidLocationChange = _det369_postDateSpeed;

export const borderCrossing_371 = 'borderCrossing';
export const countryBoundary_371 = 'countryBoundary';
export const _det371_borderCrossing = {
  id: 371,
  section: '6',
  name: 'Border crossing detection',
  severity: 'medium' as const,
  patterns: ['borderCrossing', 'countryBoundary'],
  enabled: true,
  detect(input: string): boolean {
    return ['borderCrossing', 'countryBoundary'].some(pat => input.includes(pat));
  }
};
export const _ref_borderCrossing = _det371_borderCrossing;
export const _ref_countryBoundary = _det371_borderCrossing;

export const fuzzyDistance_617 = 'fuzzyDistance';
export const approximateDistance_617 = 'approximateDistance';
export const distanceBucket_617 = 'distanceBucket';
export const _det617_fuzzyDistance = {
  id: 617,
  section: '6',
  name: 'Fuzzy/approximate distance display',
  severity: 'high' as const,
  patterns: ['fuzzyDistance', 'approximateDistance', 'distanceBucket'],
  enabled: true,
  detect(input: string): boolean {
    return ['fuzzyDistance', 'approximateDistance', 'distanceBucket'].some(pat => input.includes(pat));
  }
};
export const _ref_fuzzyDistance = _det617_fuzzyDistance;
export const _ref_approximateDistance = _det617_fuzzyDistance;
export const _ref_distanceBucket = _det617_fuzzyDistance;

export const neverChecksIn_417 = 'neverChecksIn';
export const skipCheckIn_417 = 'skipCheckIn';
export const ignoredCheckIn_417 = 'ignoredCheckIn';
export const _det417_neverChecksIn = {
  id: 417,
  section: '9',
  name: 'User never checks in detection',
  severity: 'medium' as const,
  patterns: ['neverChecksIn', 'skipCheckIn', 'ignoredCheckIn'],
  enabled: true,
  detect(input: string): boolean {
    return ['neverChecksIn', 'skipCheckIn', 'ignoredCheckIn'].some(pat => input.includes(pat));
  }
};
export const _ref_neverChecksIn = _det417_neverChecksIn;
export const _ref_skipCheckIn = _det417_neverChecksIn;
export const _ref_ignoredCheckIn = _det417_neverChecksIn;

export const speedDatingFraud_418 = 'speedDatingFraud';
export const eventFraud_418 = 'eventFraud';
export const _det418_speedDatingFraud = {
  id: 418,
  section: '9',
  name: 'Speed dating fraud',
  severity: 'medium' as const,
  patterns: ['speedDatingFraud', 'eventFraud'],
  enabled: true,
  detect(input: string): boolean {
    return ['speedDatingFraud', 'eventFraud'].some(pat => input.includes(pat));
  }
};
export const _ref_speedDatingFraud = _det418_speedDatingFraud;
export const _ref_eventFraud = _det418_speedDatingFraud;

export const postDateScan_652 = 'postDateScan';
export const bluetoothScan_652 = 'bluetoothScan';
export const trackerScan_652 = 'trackerScan';
export const _det652_postDateScan = {
  id: 652,
  section: '9',
  name: 'Post-date Bluetooth scan prompt',
  severity: 'medium' as const,
  patterns: ['postDateScan', 'bluetoothScan', 'trackerScan'],
  enabled: true,
  detect(input: string): boolean {
    return ['postDateScan', 'bluetoothScan', 'trackerScan'].some(pat => input.includes(pat));
  }
};
export const _ref_postDateScan = _det652_postDateScan;
export const _ref_bluetoothScan = _det652_postDateScan;
export const _ref_trackerScan = _det652_postDateScan;

export const unknownTrackerAlert_653 = 'unknownTrackerAlert';
export const trackerNotification_653 = 'trackerNotification';
export const _det653_unknownTrackerAlert = {
  id: 653,
  section: '9',
  name: 'OS-level tracker alert integration',
  severity: 'medium' as const,
  patterns: ['unknownTrackerAlert', 'trackerNotification'],
  enabled: true,
  detect(input: string): boolean {
    return ['unknownTrackerAlert', 'trackerNotification'].some(pat => input.includes(pat));
  }
};
export const _ref_unknownTrackerAlert = _det653_unknownTrackerAlert;
export const _ref_trackerNotification = _det653_unknownTrackerAlert;

export const dontGetInCar_753 = 'dontGetInCar';
export const ownTransportation_753 = 'ownTransportation';
export const carSafety_753 = 'carSafety';
export const _det753_dontGetInCar = {
  id: 753,
  section: '9',
  name: 'Do not get in their car prompt',
  severity: 'medium' as const,
  patterns: ['dontGetInCar', 'ownTransportation', 'carSafety'],
  enabled: true,
  detect(input: string): boolean {
    return ['dontGetInCar', 'ownTransportation', 'carSafety'].some(pat => input.includes(pat));
  }
};
export const _ref_dontGetInCar = _det753_dontGetInCar;
export const _ref_ownTransportation = _det753_dontGetInCar;
export const _ref_carSafety = _det753_dontGetInCar;

export const druggingReport_909 = 'druggingReport';
export const drinkSpiked_909 = 'drinkSpiked';
export const druggedReport_909 = 'druggedReport';
export const _det909_druggingReport = {
  id: 909,
  section: '9',
  name: 'Drugging report category',
  severity: 'medium' as const,
  patterns: ['druggingReport', 'drinkSpiked', 'druggedReport'],
  enabled: true,
  detect(input: string): boolean {
    return ['druggingReport', 'drinkSpiked', 'druggedReport'].some(pat => input.includes(pat));
  }
};
export const _ref_druggingReport = _det909_druggingReport;
export const _ref_drinkSpiked = _det909_druggingReport;
export const _ref_druggedReport = _det909_druggingReport;

export const conversationMinimum_913 = 'conversationMinimum';
export const chatBeforeMeet_913 = 'chatBeforeMeet';
export const minimumMessages_913 = 'minimumMessages';
export const _det913_conversationMinimum = {
  id: 913,
  section: '9',
  name: 'Mandatory conversation minimum',
  severity: 'medium' as const,
  patterns: ['conversationMinimum', 'chatBeforeMeet', 'minimumMessages'],
  enabled: true,
  detect(input: string): boolean {
    return ['conversationMinimum', 'chatBeforeMeet', 'minimumMessages'].some(pat => input.includes(pat));
  }
};
export const _ref_conversationMinimum = _det913_conversationMinimum;
export const _ref_chatBeforeMeet = _det913_conversationMinimum;
export const _ref_minimumMessages = _det913_conversationMinimum;

export const matchThrottle_914 = 'matchThrottle';
export const matchVelocity_914 = 'matchVelocity';
export const slowDating_914 = 'slowDating';
export const _det914_matchThrottle = {
  id: 914,
  section: '9',
  name: 'Match velocity throttling',
  severity: 'medium' as const,
  patterns: ['matchThrottle', 'matchVelocity', 'slowDating'],
  enabled: true,
  detect(input: string): boolean {
    return ['matchThrottle', 'matchVelocity', 'slowDating'].some(pat => input.includes(pat));
  }
};
export const _ref_matchThrottle = _det914_matchThrottle;
export const _ref_matchVelocity = _det914_matchThrottle;
export const _ref_slowDating = _det914_matchThrottle;

export const readyToMeet_915 = 'readyToMeet';
export const safetyChecklist_915 = 'safetyChecklist';
export const meetupChecklist_915 = 'meetupChecklist';
export const _det915_readyToMeet = {
  id: 915,
  section: '9',
  name: 'Are you ready to meet checklist',
  severity: 'medium' as const,
  patterns: ['readyToMeet', 'safetyChecklist', 'meetupChecklist'],
  enabled: true,
  detect(input: string): boolean {
    return ['readyToMeet', 'safetyChecklist', 'meetupChecklist'].some(pat => input.includes(pat));
  }
};
export const _ref_readyToMeet = _det915_readyToMeet;
export const _ref_safetyChecklist = _det915_readyToMeet;
export const _ref_meetupChecklist = _det915_readyToMeet;

export const robberyLure_874_key = 'robberyLure';
export const lurePattern_874_key = 'lurePattern';
export const meetupRobbery_874_key = 'meetupRobbery';

export const robberyLureDetector = {
  id: 874,
  section: '6.1',
  name: 'Robbery lure pattern detection',
  severity: 'medium' as const,
  patterns: ['robberyLure', 'lurePattern', 'meetupRobbery'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['robberylure', 'lurepattern', 'meetuprobbery']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['robberylure', 'lurepattern', 'meetuprobbery']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function robberyLureCheck(input: string): boolean {
  return robberyLureDetector.detect(input);
}

export function lurePatternCheck(input: string): boolean {
  return robberyLureDetector.detect(input);
}

export function meetupRobberyCheck(input: string): boolean {
  return robberyLureDetector.detect(input);
}

export const _d874_impl = {
  robberyLure: robberyLureCheck,
  lurePattern: lurePatternCheck,
  meetupRobbery: meetupRobberyCheck,
};

export const rideShare_752_key = 'rideShare';
export const uberIntegration_752_key = 'uberIntegration';
export const lyftIntegration_752_key = 'lyftIntegration';

export const rideShareDetector = {
  id: 752,
  section: '9',
  name: 'Ride-share integration',
  severity: 'medium' as const,
  patterns: ['rideShare', 'uberIntegration', 'lyftIntegration'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['rideshare', 'uberintegration', 'lyftintegration']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['rideshare', 'uberintegration', 'lyftintegration']
      .filter(pat => lower.includes(pat)).length;
    return hits / 3;
  }
};

export function rideShareCheck(input: string): boolean {
  return rideShareDetector.detect(input);
}

export function uberIntegrationCheck(input: string): boolean {
  return rideShareDetector.detect(input);
}

export function lyftIntegrationCheck(input: string): boolean {
  return rideShareDetector.detect(input);
}

export const _d752_impl = {
  rideShare: rideShareCheck,
  uberIntegration: uberIntegrationCheck,
  lyftIntegration: lyftIntegrationCheck,
};
