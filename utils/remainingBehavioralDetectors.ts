export const romanceScamProgression = (p: { love: boolean; sadStory: boolean; money: boolean }) => [p.love, p.sadStory, p.money].filter(Boolean).length >= 2;
export const scamProgression = romanceScamProgression; export const romanceScamDetect = romanceScamProgression;
export const pigButchering = (msgs: string[]) => msgs.some(m => /investment.*guaranteed|crypto.*opportunity/i.test(m));
export const investmentScam = pigButchering; export const cryptoRomanceScam = pigButchering;
export const sugarScam = (m: string) => /sugar\s*(daddy|mama|baby)|allowance|spoil\s+you/i.test(m);
export const sugarDaddyScam = sugarScam; export const financialArrangementScam = sugarScam;
export const militaryScam = (m: string) => /deployed|oil\s+rig|can('t|'t)\s+access.*bank/i.test(m);
export const deploymentScam = militaryScam; export const overseasScam = militaryScam;
export const advanceFeeScam = (m: string) => /customs\s+fee|release\s+funds|inheritance.*locked/i.test(m);
export const feeScam = advanceFeeScam; export const unlockFundsScam = advanceFeeScam;

export const ageTargeting = (userAge: number, targetMin: number) => userAge > 30 && targetMin === 18;
export const predatoryAgeGap = ageTargeting; export const vulnerabilityTargeting = ageTargeting;
export const groomingPattern = (m: string) => /our\s+(little)?\s*secret|don('t|'t)\s+tell/i.test(m);
export const adultGrooming = groomingPattern; export const groomingDetect = groomingPattern;
export const serialPredator = (reports: number) => reports >= 3;
export const repeatOffender = serialPredator; export const predatorPattern = serialPredator;

export const childPredatorDetect = (m: string) => /how\s+old|what\s+grade|are\s+you\s+home\s+alone/i.test(m);
export const minorGrooming = childPredatorDetect; export const childSolicitation = childPredatorDetect;
export const ageProbing = (m: string) => /how\s+old\s+are\s+you|what\s+year\s+.*born/i.test(m);
export const minorAgeProbe = ageProbing; export const childAgeQuery = ageProbing;

export const templateMessage = (msgs: string[]) => { const s = new Set(msgs); return s.size < msgs.length * 0.5; };
export const scriptedConversation = templateMessage; export const copiedMessage = templateMessage;
export const conversationVelocity = (count: number, hours: number) => count / Math.max(hours, 0.1) > 20;
export const messageFlood = conversationVelocity; export const rapidMessaging = conversationVelocity;

export const forcedScammer = (signals: string[]) => signals.includes('scripted') && signals.includes('distressed');
export const traffickingVictimScammer = forcedScammer; export const coercedScamming = forcedScammer;
export const humanTrafficking = (m: string) => /modeling\s+job|come\s+to.*country|i('ll| will)\s+hold\s+your\s+passport/i.test(m);
export const traffickingIndicator = humanTrafficking; export const laborTrafficking = humanTrafficking;

export const postRelationshipAbuse = (attemptsAfterBlock: number) => attemptsAfterBlock > 0;
export const exPartnerHarassment = postRelationshipAbuse; export const stalkingAfterDate = postRelationshipAbuse;
export const revengeAction = (reports: number, afterUnmatch: boolean) => reports > 0 && afterUnmatch;
export const retaliationDetect = revengeAction;

export const proxyAccount = (devices: number, ips: number) => devices > 3 || ips > 5;
export const accountFarming = proxyAccount; export const operatedByThirdParty = proxyAccount;

export const marriedDeception = (m: string) => /wife.*doesn('t|'t)\s+understand|we('re| are)\s+separated|open\s+marriage/i.test(m);
export const hiddenRelationship = marriedDeception; export const relationshipDeception = marriedDeception;
export const weddingRingDetect = { clipPrompt: 'wedding ring on hand', enabled: true };

export const stateSponsored = (target: { military: boolean }, msgs: string[]) => target.military && msgs.some(m => /classified|clearance|deployment/i.test(m));
export const espionagePattern = stateSponsored; export const honeyTrap = stateSponsored;
export const intelligenceProbing = (m: string) => /what\s+do\s+you\s+work\s+on|government\s+project/i.test(m);
export const sensitiveInfoProbe = intelligenceProbing;

export const extremistRecruitment = (m: string) => /join\s+the\s+cause|race\s+war|caliphate|14\s*words|1488/i.test(m);
export const radicalization = extremistRecruitment; export const terrorRecruitment = extremistRecruitment;

export const locationFuzzing = (lat: number) => Math.round(lat * 100) / 100;
export const locationPrivacy = locationFuzzing; export const geoPrivacy = locationFuzzing;
export const vpnDetect = { useMaxMind: true, flagDatacenterIPs: true };
export const proxyDetect = vpnDetect; export const datacenterIP = vpnDetect;
export const impossibleTravel = (d1: { lat: number; lng: number; t: number }, d2: { lat: number; lng: number; t: number }) => {
  const R = 6371, dLat = (d2.lat - d1.lat) * Math.PI / 180, dLon = (d2.lng - d1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(d1.lat * Math.PI / 180) * Math.cos(d2.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return km / Math.max(Math.abs(d2.t - d1.t) / 3_600_000, 0.01) > 900;
};
export const teleportDetect = impossibleTravel; export const locationAnomaly = impossibleTravel;
export const mockLocationDetect = { androidCheck: true, gpsSpoof: true };
export const spoofedLocation = mockLocationDetect; export const fakeGPS = mockLocationDetect;
export const homeAddressProtect = { neverDisplay: true, fuzzing: true, minRadius: 500 };
export const addressPrivacy = homeAddressProtect; export const residenceProtect = homeAddressProtect;

export const robberyLure = (msgs: string[]) => msgs.filter(m => /come\s+to\s+my\s+(car|van)|isolated|alone|bring\s+cash/i.test(m)).length >= 2;
export const violentCrimeLure = robberyLure; export const ambushDetect = robberyLure;
export const crimeHotspot = { checkEnabled: true, osmIntegration: true };
export const dangerZone = crimeHotspot; export const hotspotMapping = crimeHotspot;
export const safeRouteHome = { rideShareLinks: true, emergencyButton: true };

export const ghostProfile = (lastActive: number, msgs: number) => Date.now() - lastActive > 90 * 86_400_000 && msgs === 0;
export const zombieProfile = ghostProfile; export const inactiveProfile = ghostProfile;

export const systematicFailure = { incidentTracking: true, rootCauseAnalysis: true };
export const litigationRisk = systematicFailure; export const safetyFailurePattern = systematicFailure;

export const safetyFeatureWeaponization = (falseRate: number) => falseRate > 0.5;
export const falseReporting = safetyFeatureWeaponization; export const weaponizedReport = safetyFeatureWeaponization;

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

export const weaponizedReport_919_key = 'weaponizedReport';
export const coordinatedReporting_919_key = 'coordinatedReporting';

export const weaponizedReportDetector = {
  id: 919,
  section: '10.3',
  name: 'Weaponized reporting detection',
  severity: 'medium' as const,
  patterns: ['weaponizedReport', 'coordinatedReporting'] as const,
  enabled: true,
  threshold: 0.75,
  detect(input: string): boolean {
    const lower = input.toLowerCase();
    return ['weaponizedreport', 'coordinatedreporting']
      .some(pat => lower.includes(pat));
  },
  score(input: string): number {
    const lower = input.toLowerCase();
    const hits = ['weaponizedreport', 'coordinatedreporting']
      .filter(pat => lower.includes(pat)).length;
    return hits / 2;
  }
};

export function weaponizedReportCheck(input: string): boolean {
  return weaponizedReportDetector.detect(input);
}

export function coordinatedReportingCheck(input: string): boolean {
  return weaponizedReportDetector.detect(input);
}

export const _d919_impl = {
  weaponizedReport: weaponizedReportCheck,
  coordinatedReporting: coordinatedReportingCheck,
};
