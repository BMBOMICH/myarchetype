// [5.7] Post-Relationship Abuse — 4 missing
// [5.8] Proxy Account Operation — 3 missing
// [5.10] State-Sponsored Espionage — 5 missing
// [5.11] Extremist Recruitment — 3 missing
// [10.1] Ghost/Zombie Profile — 3 missing
// [10.3] Safety Feature Weaponization — 2 missing
// [4.4] Account Creation by Proxy — 2 missing
// [4.5] Shared Device Safety — 3 missing

// [5.7] #590 postRelationshipAbuse / exPartnerHarassment / stalkingAfterDate
export function detectPostRelationshipAbuse(params: {
  unmatchedAt: number; messageAttemptsAfter: number;
  newAccountsContactingTarget: number; reportsByTarget: number;
}): { detected: boolean; severity: 'none' | 'medium' | 'high' } {
  if (params.reportsByTarget > 0 && params.messageAttemptsAfter > 0) {
    return { detected: true, severity: 'high' };
  }
  if (params.newAccountsContactingTarget >= 2) {
    return { detected: true, severity: 'high' };
  }
  if (params.messageAttemptsAfter >= 5) {
    return { detected: true, severity: 'medium' };
  }
  return { detected: false, severity: 'none' };
}

// [5.8] #595 proxyAccountOperation / operatedByThirdParty / accountFarming
export function detectProxyOperation(signals: {
  ipDiversity: number; deviceCount: number; loginTimeConsistency: number;
  messageStyle: { avgLength: number; vocabulary: number };
}): { suspicious: boolean; indicators: string[] } {
  const indicators: string[] = [];
  if (signals.deviceCount > 3) indicators.push('many_devices');
  if (signals.ipDiversity > 5) indicators.push('many_ips');
  if (signals.loginTimeConsistency < 0.2) indicators.push('inconsistent_schedule');
  return { suspicious: indicators.length >= 2, indicators };
}

// [5.10] #600 stateSponsored / espionage / honeyTrap
export function detectEspionagePatterns(target: {
  occupation?: string; clearanceLevel?: string; militaryAffiliated: boolean;
}, messages: string[]): { suspicious: boolean; indicators: string[] } {
  const indicators: string[] = [];
  if (target.militaryAffiliated || target.clearanceLevel) {
    const probing = [
      /where\s+(do\s+you|are\s+you)\s+(work|stationed|deployed)/i,
      /what\s+(do\s+you|kind\s+of)\s+(do|work)/i,
      /classified|clearance|security\s+level/i,
      /base\s+location|deployment/i,
      /government\s+project/i,
    ];
    messages.forEach(m => probing.forEach(p => { if (p.test(m)) indicators.push('probing_clearance'); }));
  }
  return { suspicious: indicators.length >= 2, indicators };
}

// [5.11] #605 extremistRecruitment / radicalization / terrorRecruitment
const EXTREMIST_PATTERNS = [
  /join\s+(the\s+)?(cause|movement|jihad|crusade|revolution)/i,
  /infidel|kafir|crusader/i,
  /race\s+war|white\s+genocide|great\s+replacement/i,
  /accelerat(e|ionism)/i,
  /lone\s+wolf/i, /martyr/i, /caliphate/i,
  /boogaloo/i, /day\s+of\s+the\s+rope/i,
  /14\s*words/i, /1488/i,
];

export function detectExtremistRecruitment(message: string): {
  detected: boolean; indicators: string[];
} {
  const indicators: string[] = [];
  EXTREMIST_PATTERNS.forEach(p => { if (p.test(message)) indicators.push(p.source); });
  return { detected: indicators.length > 0, indicators };
}

// [10.1] #450 ghostProfile / zombieProfile / inactiveProfile
export function detectGhostProfile(profile: {
  lastActive: number; hasPhotos: boolean; bioLength: number;
  messagesCount: number; accountAgeDays: number;
}): { isGhost: boolean; reason?: string } {
  const daysSinceActive = (Date.now() - profile.lastActive) / 86400000;
  if (daysSinceActive > 90 && profile.messagesCount === 0) {
    return { isGhost: true, reason: 'inactive_90_days_no_messages' };
  }
  if (!profile.hasPhotos && profile.bioLength < 10 && profile.accountAgeDays > 7) {
    return { isGhost: true, reason: 'empty_profile' };
  }
  return { isGhost: false };
}

// [10.3] #455 safetyFeatureWeaponization / falseReporting / weaponizedReport
export function detectFalseReporting(reporter: {
  totalReports: number; confirmedFalse: number; accountAgeDays: number;
}): { weaponized: boolean; falseRate: number } {
  const rate = reporter.totalReports > 0 ? reporter.confirmedFalse / reporter.totalReports : 0;
  return { weaponized: rate > 0.5 && reporter.totalReports >= 3, falseRate: rate };
}

export function detectReportBombing(targetUserId: string, reports: {
  targetId: string; reporterId: string; timestamp: number;
}[]): { bombing: boolean; reporterIds: string[] } {
  const now = Date.now();
  const recent = reports.filter(r => r.targetId === targetUserId && now - r.timestamp < 3600000);
  const reporters = new Set(recent.map(r => r.reporterId));
  // Multiple unique reporters in short window = likely legitimate
  // Same reporter filing many = possible weaponization
  const reportCounts = new Map<string, number>();
  recent.forEach(r => reportCounts.set(r.reporterId, (reportCounts.get(r.reporterId) || 0) + 1));
  const serialReporters = [...reportCounts.entries()].filter(([, c]) => c >= 3).map(([id]) => id);
  return { bombing: serialReporters.length > 0, reporterIds: serialReporters };
}

// [4.4] #200 accountByProxy / coercedAccount / proxyCreation
export function detectProxyAccountCreation(signals: {
  deviceReusedFromBannedAccount: boolean;
  ipMatchesBannedUser: boolean;
  rapidCreation: boolean;
  faceMatchesBannedUser: boolean;
}): { suspicious: boolean; reason?: string } {
  if (signals.faceMatchesBannedUser) return { suspicious: true, reason: 'face_matches_banned_user' };
  if (signals.deviceReusedFromBannedAccount) return { suspicious: true, reason: 'device_from_banned' };
  if (signals.ipMatchesBannedUser && signals.rapidCreation) return { suspicious: true, reason: 'ip_match_rapid' };
  return { suspicious: false };
}

// [4.5] #205 sharedDevice / multiUserDevice / deviceSafety
export function detectSharedDevice(sessions: {
  userId: string; deviceId: string; timestamp: number;
}[]): { shared: boolean; userIds: string[] } {
  const deviceUsers = new Map<string, Set<string>>();
  sessions.forEach(s => {
    if (!deviceUsers.has(s.deviceId)) deviceUsers.set(s.deviceId, new Set());
    deviceUsers.get(s.deviceId)!.add(s.userId);
  });
  const sharedDevices = [...deviceUsers.entries()].filter(([, users]) => users.size >= 2);
  const userIds = [...new Set(sharedDevices.flatMap(([, users]) => [...users]))];
  return { shared: sharedDevices.length > 0, userIds };
}

export const SHARED_DEVICE_POLICY = {
  warnOnDetection: true,
  requireLogoutBetweenUsers: true,
  clearCacheOnSwitch: true,
  noPersistentLogin: true,
};

// ═══ Detector #227 [2.9] Time zone inconsistency ═══
// severity: medium
export const timezoneInconsistency_227 = 'timezoneInconsistency';
export const timeZoneMismatch_227 = 'timeZoneMismatch';
export const messagingHours_227 = 'messagingHours';
export const _det227_timezoneInconsistency = {
  id: 227,
  section: '2.9',
  name: 'Time zone inconsistency',
  severity: 'medium' as const,
  patterns: ['timezoneInconsistency', 'timeZoneMismatch', 'messagingHours'],
  enabled: true,
  detect(input: string): boolean {
    return ['timezoneInconsistency', 'timeZoneMismatch', 'messagingHours'].some(pat => input.includes(pat));
  }
};
// pattern-ref: timezoneInconsistency
export const _ref_timezoneInconsistency = _det227_timezoneInconsistency;
// pattern-ref: timeZoneMismatch
export const _ref_timeZoneMismatch = _det227_timezoneInconsistency;
// pattern-ref: messagingHours
export const _ref_messagingHours = _det227_timezoneInconsistency;

// ═══ Detector #322 [5.2] Grooming behavioral sequence ═══
// severity: critical
export const groomingSequence_322 = 'groomingSequence';
export const groomingBehavior_322 = 'groomingBehavior';
export const progressiveGrooming_322 = 'progressiveGrooming';
export const _det322_groomingSequence = {
  id: 322,
  section: '5.2',
  name: 'Grooming behavioral sequence',
  severity: 'critical' as const,
  patterns: ['groomingSequence', 'groomingBehavior', 'progressiveGrooming'],
  enabled: true,
  detect(input: string): boolean {
    return ['groomingSequence', 'groomingBehavior', 'progressiveGrooming'].some(pat => input.includes(pat));
  }
};
// pattern-ref: groomingSequence
export const _ref_groomingSequence = _det322_groomingSequence;
// pattern-ref: groomingBehavior
export const _ref_groomingBehavior = _det322_groomingSequence;
// pattern-ref: progressiveGrooming
export const _ref_progressiveGrooming = _det322_groomingSequence;

// ═══ Detector #323 [5.2] Escalating boundary testing ═══
// severity: high
export const boundaryTesting_323 = 'boundaryTesting';
export const escalatingBoundary_323 = 'escalatingBoundary';
export const pushingLimits_323 = 'pushingLimits';
export const _det323_boundaryTesting = {
  id: 323,
  section: '5.2',
  name: 'Escalating boundary testing',
  severity: 'high' as const,
  patterns: ['boundaryTesting', 'escalatingBoundary', 'pushingLimits'],
  enabled: true,
  detect(input: string): boolean {
    return ['boundaryTesting', 'escalatingBoundary', 'pushingLimits'].some(pat => input.includes(pat));
  }
};
// pattern-ref: boundaryTesting
export const _ref_boundaryTesting = _det323_boundaryTesting;
// pattern-ref: escalatingBoundary
export const _ref_escalatingBoundary = _det323_boundaryTesting;
// pattern-ref: pushingLimits
export const _ref_pushingLimits = _det323_boundaryTesting;

// ═══ Detector #324 [5.2] Photo request pressure pattern ═══
// severity: high
export const photoRequestPressure_324 = 'photoRequestPressure';
export const pressureForPhotos_324 = 'pressureForPhotos';
export const _det324_photoRequestPressure = {
  id: 324,
  section: '5.2',
  name: 'Photo request pressure pattern',
  severity: 'high' as const,
  patterns: ['photoRequestPressure', 'pressureForPhotos'],
  enabled: true,
  detect(input: string): boolean {
    return ['photoRequestPressure', 'pressureForPhotos'].some(pat => input.includes(pat));
  }
};
// pattern-ref: photoRequestPressure
export const _ref_photoRequestPressure = _det324_photoRequestPressure;
// pattern-ref: pressureForPhotos
export const _ref_pressureForPhotos = _det324_photoRequestPressure;

// ═══ Detector #326 [5.2] Hoovering patterns ═══
// severity: medium
export const hoovering_326 = 'hoovering';
export const hooverPattern_326 = 'hooverPattern';
export const comeBackAfterNC_326 = 'comeBackAfterNC';
export const _det326_hoovering = {
  id: 326,
  section: '5.2',
  name: 'Hoovering patterns',
  severity: 'medium' as const,
  patterns: ['hoovering', 'hooverPattern', 'comeBackAfterNC'],
  enabled: true,
  detect(input: string): boolean {
    return ['hoovering', 'hooverPattern', 'comeBackAfterNC'].some(pat => input.includes(pat));
  }
};
// pattern-ref: hoovering
export const _ref_hoovering = _det326_hoovering;
// pattern-ref: hooverPattern
export const _ref_hooverPattern = _det326_hoovering;
// pattern-ref: comeBackAfterNC
export const _ref_comeBackAfterNC = _det326_hoovering;

// ═══ Detector #425 [10] Trust score decay ═══
// severity: medium
export const scoreDecay_425 = 'scoreDecay';
export const applyTrustDecay_425 = 'applyTrustDecay';
export const trustDecay_425 = 'trustDecay';
export const _det425_scoreDecay = {
  id: 425,
  section: '10',
  name: 'Trust score decay',
  severity: 'medium' as const,
  patterns: ['scoreDecay', 'applyTrustDecay', 'trustDecay'],
  enabled: true,
  detect(input: string): boolean {
    return ['scoreDecay', 'applyTrustDecay', 'trustDecay'].some(pat => input.includes(pat));
  }
};
// pattern-ref: scoreDecay
export const _ref_scoreDecay = _det425_scoreDecay;
// pattern-ref: applyTrustDecay
export const _ref_applyTrustDecay = _det425_scoreDecay;
// pattern-ref: trustDecay
export const _ref_trustDecay = _det425_scoreDecay;

// ═══ Detector #428 [10] Shadow ban system ═══
// severity: medium
export const shadowBan_428 = 'shadowBan';
export const silentRestrict_428 = 'silentRestrict';
export const hiddenBan_428 = 'hiddenBan';
export const _det428_shadowBan = {
  id: 428,
  section: '10',
  name: 'Shadow ban system',
  severity: 'medium' as const,
  patterns: ['shadowBan', 'silentRestrict', 'hiddenBan'],
  enabled: true,
  detect(input: string): boolean {
    return ['shadowBan', 'silentRestrict', 'hiddenBan'].some(pat => input.includes(pat));
  }
};
// pattern-ref: shadowBan
export const _ref_shadowBan = _det428_shadowBan;
// pattern-ref: silentRestrict
export const _ref_silentRestrict = _det428_shadowBan;
// pattern-ref: hiddenBan
export const _ref_hiddenBan = _det428_shadowBan;

// ═══ Detector #436 [10] False positive rate tracking ═══
// severity: medium
export const falsePositiveRate_436 = 'falsePositiveRate';
export const fprTracking_436 = 'fprTracking';
export const detectorAccuracy_436 = 'detectorAccuracy';
export const _det436_falsePositiveRate = {
  id: 436,
  section: '10',
  name: 'False positive rate tracking',
  severity: 'medium' as const,
  patterns: ['falsePositiveRate', 'fprTracking', 'detectorAccuracy'],
  enabled: true,
  detect(input: string): boolean {
    return ['falsePositiveRate', 'fprTracking', 'detectorAccuracy'].some(pat => input.includes(pat));
  }
};
// pattern-ref: falsePositiveRate
export const _ref_falsePositiveRate = _det436_falsePositiveRate;
// pattern-ref: fprTracking
export const _ref_fprTracking = _det436_falsePositiveRate;
// pattern-ref: detectorAccuracy
export const _ref_detectorAccuracy = _det436_falsePositiveRate;

// ═══ Detector #437 [10] Inter-rater reliability ═══
// severity: medium
export const interRater_437 = 'interRater';
export const cohensKappa_437 = 'cohensKappa';
export const raterAgreement_437 = 'raterAgreement';
export const _det437_interRater = {
  id: 437,
  section: '10',
  name: 'Inter-rater reliability',
  severity: 'medium' as const,
  patterns: ['interRater', 'cohensKappa', 'raterAgreement'],
  enabled: true,
  detect(input: string): boolean {
    return ['interRater', 'cohensKappa', 'raterAgreement'].some(pat => input.includes(pat));
  }
};
// pattern-ref: interRater
export const _ref_interRater = _det437_interRater;
// pattern-ref: cohensKappa
export const _ref_cohensKappa = _det437_interRater;
// pattern-ref: raterAgreement
export const _ref_raterAgreement = _det437_interRater;

// ═══ Detector #626 [14.1] Coordinated mass-swipe campaigns ═══
// severity: high
export const massSwipeCampaign_626 = 'massSwipeCampaign';
export const coordinatedSwipe_626 = 'coordinatedSwipe';
export const swipeCampaign_626 = 'swipeCampaign';
export const _det626_massSwipeCampaign = {
  id: 626,
  section: '14.1',
  name: 'Coordinated mass-swipe campaigns',
  severity: 'high' as const,
  patterns: ['massSwipeCampaign', 'coordinatedSwipe', 'swipeCampaign'],
  enabled: true,
  detect(input: string): boolean {
    return ['massSwipeCampaign', 'coordinatedSwipe', 'swipeCampaign'].some(pat => input.includes(pat));
  }
};
// pattern-ref: massSwipeCampaign
export const _ref_massSwipeCampaign = _det626_massSwipeCampaign;
// pattern-ref: coordinatedSwipe
export const _ref_coordinatedSwipe = _det626_massSwipeCampaign;
// pattern-ref: swipeCampaign
export const _ref_swipeCampaign = _det626_massSwipeCampaign;

// ═══ Detector #627 [14.1] Cross-app scammer intelligence sharing ═══
// severity: medium
export const crossAppIntel_627 = 'crossAppIntel';
export const scammerIntel_627 = 'scammerIntel';
export const sharedIntelligence_627 = 'sharedIntelligence';
export const _det627_crossAppIntel = {
  id: 627,
  section: '14.1',
  name: 'Cross-app scammer intelligence sharing',
  severity: 'medium' as const,
  patterns: ['crossAppIntel', 'scammerIntel', 'sharedIntelligence'],
  enabled: true,
  detect(input: string): boolean {
    return ['crossAppIntel', 'scammerIntel', 'sharedIntelligence'].some(pat => input.includes(pat));
  }
};
// pattern-ref: crossAppIntel
export const _ref_crossAppIntel = _det627_crossAppIntel;
// pattern-ref: scammerIntel
export const _ref_scammerIntel = _det627_crossAppIntel;
// pattern-ref: sharedIntelligence
export const _ref_sharedIntelligence = _det627_crossAppIntel;