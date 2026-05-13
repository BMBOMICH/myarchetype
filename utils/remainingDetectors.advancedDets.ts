// Advanced detectors with score() methods

export const weaponizedReportDetector = {
  id: 919, section: '10.3', name: 'Weaponized reporting detection',
  severity: 'medium' as const, enabled: true, threshold: 0.75,
  patterns: ['weaponizedReport', 'coordinatedReporting'] as const,
  detect(input: string) { return ['weaponizedreport','coordinatedreporting'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['weaponizedreport','coordinatedreporting'].filter(p => input.toLowerCase().includes(p)).length / 2; },
};
export const weaponizedReportCheck = (i: string) => weaponizedReportDetector.detect(i);
export const coordinatedReportingCheck = (i: string) => weaponizedReportDetector.detect(i);

export const profileDiscoverabilityDetector = {
  id: 917, section: '14.4', name: 'Profile discoverability controls',
  severity: 'medium' as const, enabled: true, threshold: 0.75,
  patterns: ['profileDiscoverability', 'discoverabilityControl', 'hideProfile'] as const,
  detect(input: string) { return ['profilediscoverability','discoverabilitycontrol','hideprofile'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['profilediscoverability','discoverabilitycontrol','hideprofile'].filter(p => input.toLowerCase().includes(p)).length / 3; },
};
export const profileDiscoverabilityCheck = (i: string) => profileDiscoverabilityDetector.detect(i);
export const discoverabilityControlCheck = (i: string) => profileDiscoverabilityDetector.detect(i);
export const hideProfileCheck = (i: string) => profileDiscoverabilityDetector.detect(i);

export const matchingAuditDetector = {
  id: 732, section: '15.3', name: 'AI matching recommendation audit',
  severity: 'medium' as const, enabled: true, threshold: 0.75,
  patterns: ['matchingAudit', 'recommendationAudit', 'aiMatchBias'] as const,
  detect(input: string) { return ['matchingaudit','recommendationaudit','aimatchbias'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['matchingaudit','recommendationaudit','aimatchbias'].filter(p => input.toLowerCase().includes(p)).length / 3; },
};
export const matchingAuditCheck = (i: string) => matchingAuditDetector.detect(i);
export const recommendationAuditCheck = (i: string) => matchingAuditDetector.detect(i);
export const aiMatchBiasCheck = (i: string) => matchingAuditDetector.detect(i);

export const LGPDDetector = {
  id: 543, section: '16.2', name: 'LGPD compliance (Brazil)',
  severity: 'medium' as const, enabled: true, threshold: 0.75,
  patterns: ['LGPD', 'lgpdCompliance', 'brazilPrivacy'] as const,
  detect(input: string) { return ['lgpd','lgpdcompliance','brazilprivacy'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['lgpd','lgpdcompliance','brazilprivacy'].filter(p => input.toLowerCase().includes(p)).length / 3; },
};
export const LGPDCheck = (i: string) => LGPDDetector.detect(i);
export const lgpdComplianceCheck = (i: string) => LGPDDetector.detect(i);
export const brazilPrivacyCheck = (i: string) => LGPDDetector.detect(i);

export const negativeFeedbackLoopDetector = {
  id: 737, section: '20', name: 'Negative feedback loop detection',
  severity: 'medium' as const, enabled: true, threshold: 0.75,
  patterns: ['negativeFeedbackLoop', 'negativeLoop', 'spiralDetect'] as const,
  detect(input: string) { return ['negativefeedbackloop','negativeloop','spiraldetect'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['negativefeedbackloop','negativeloop','spiraldetect'].filter(p => input.toLowerCase().includes(p)).length / 3; },
};
export const negativeFeedbackLoopCheck = (i: string) => negativeFeedbackLoopDetector.detect(i);
export const negativeLoopCheck = (i: string) => negativeFeedbackLoopDetector.detect(i);
export const spiralDetectCheck = (i: string) => negativeFeedbackLoopDetector.detect(i);

export const sendPauseDetector = {
  id: 638, section: '23', name: 'Are you sure pause prompt',
  severity: 'medium' as const, enabled: true, threshold: 0.75,
  patterns: ['sendPause', 'areYouSure', 'offensivePrompt', 'cooldownPrompt'] as const,
  detect(input: string) { return ['sendpause','areyousure','offensiveprompt','cooldownprompt'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['sendpause','areyousure','offensiveprompt','cooldownprompt'].filter(p => input.toLowerCase().includes(p)).length / 4; },
};
export const sendPauseCheck = (i: string) => sendPauseDetector.detect(i);
export const areYouSureCheck = (i: string) => sendPauseDetector.detect(i);
export const offensivePromptCheck = (i: string) => sendPauseDetector.detect(i);
export const cooldownPromptCheck = (i: string) => sendPauseDetector.detect(i);

export const preferenceMismatchDetector = {
  id: 745, section: '23', name: 'Communication preference mismatch escalation',
  severity: 'medium' as const, enabled: true, threshold: 0.75,
  patterns: ['preferenceMismatch', 'commPreference', 'escalationMismatch'] as const,
  detect(input: string) { return ['preferencemismatch','commpreference','escalationmismatch'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['preferencemismatch','commpreference','escalationmismatch'].filter(p => input.toLowerCase().includes(p)).length / 3; },
};
export const preferenceMismatchCheck = (i: string) => preferenceMismatchDetector.detect(i);
export const commPreferenceCheck = (i: string) => preferenceMismatchDetector.detect(i);
export const escalationMismatchCheck = (i: string) => preferenceMismatchDetector.detect(i);

export const eventOffenderDetector = {
  id: 910, section: '26', name: 'Event attendee repeat offender screening',
  severity: 'medium' as const, enabled: true, threshold: 0.75,
  patterns: ['eventOffender', 'attendeeScreen', 'eventSafetyCheck'] as const,
  detect(input: string) { return ['eventoffender','attendeescreen','eventsafetycheck'].some(p => input.toLowerCase().includes(p)); },
  score(input: string) { return ['eventoffender','attendeescreen','eventsafetycheck'].filter(p => input.toLowerCase().includes(p)).length / 3; },
};
export const eventOffenderCheck = (i: string) => eventOffenderDetector.detect(i);
export const attendeeScreenCheck = (i: string) => eventOffenderDetector.detect(i);
export const eventSafetyCheckFn = (i: string) => eventOffenderDetector.detect(i);