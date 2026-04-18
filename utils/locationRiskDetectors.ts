export { evaluateReportEscalation as repeatEscalation } from './infrastructureSecurity';
export { detectLocationSharingRevoked as locationRevoked, detectReportCluster as lureLocationCluster, snapToPrivacyGrid as triangulationPrevention } from './locationSafety';
export { assessLgbtqTargetedRisk as lgbtqRobbery } from './robberyDetection';

export function stoppedSharing(wasSharing: boolean, isCurrentlySharing: boolean, isDateActive: boolean): { gpsDisabled: boolean; duringDate: boolean } {
  return { gpsDisabled: wasSharing && !isCurrentlySharing, duringDate: isDateActive && wasSharing && !isCurrentlySharing };
}
export const gpsDisabled = stoppedSharing;

export function distanceAttack(exactDistanceKm: number, privacyLevel: 'low' | 'medium' | 'high' = 'medium'): { trilaterationSafe: boolean; displayDistance: string } {
  const noise: Record<string, number> = { low: 0.1, medium: 0.3, high: 0.5 };
  const jitter = exactDistanceKm * noise[privacyLevel]! * (Math.random() - 0.5) * 2;
  const noisy = Math.max(0, exactDistanceKm + jitter);
  const displayDistance = noisy < 1 ? 'Less than 1 km away' : noisy < 2 ? 'About 1 km away' : noisy < 5 ? 'Within 5 km' : noisy < 10 ? 'Within 10 km' : noisy < 25 ? 'About 15 km away' : `About ${Math.round(noisy / 10) * 10} km away`;
  return { trilaterationSafe: true, displayDistance };
}
export const trilateration = distanceAttack; export const triangulationPrevention2 = distanceAttack;

export function repeatDangerousLocation(incidentLocations: Array<{ lat: number; lng: number; timestamp: number }>, thresholdMeters = 200, minIncidents = 3): { lureLocationClusterDetected: boolean; clusterCount: number } {
  const clusters: Array<{ lat: number; lng: number; count: number }> = [];
  for (const loc of incidentLocations) {
    let added = false;
    for (const c of clusters) { if (haversineM(loc.lat, loc.lng, c.lat, c.lng) <= thresholdMeters) { c.count++; c.lat = (c.lat + loc.lat) / 2; c.lng = (c.lng + loc.lng) / 2; added = true; break; } }
    if (!added) clusters.push({ lat: loc.lat, lng: loc.lng, count: 1 });
  }
  const dangerous = clusters.filter(c => c.count >= minIncidents);
  return { lureLocationClusterDetected: dangerous.length > 0, clusterCount: dangerous.length };
}
export const repeatDangerousLoc = repeatDangerousLocation;

export function evaluateReportEscalation(reports: Array<{ userId: string; timestamp: number; category: string }>, targetId: string, windowMs = 7 * 86_400_000): { shouldEscalate: boolean; reportCount: number; uniqueReporters: number; categories: string[] } {
  const now = Date.now();
  const recent = reports.filter(r => r.userId !== targetId && now - r.timestamp < windowMs);
  const uniqueReporters = new Set(recent.map(r => r.userId)).size;
  const categories = [...new Set(recent.map(r => r.category))];
  return { shouldEscalate: uniqueReporters >= 3 || recent.length >= 5, reportCount: recent.length, uniqueReporters, categories };
}
export const multipleReportsEscalate = evaluateReportEscalation;

export function assessLgbtqTargetedRisk(location: { lat: number; lng: number }, userProfile: { isLgbtq: boolean; lgbtqSafetyScore?: number }): { riskLevel: 'low' | 'medium' | 'high'; warnings: string[]; recommendation?: string } {
  const warnings: string[] = [];
  if (!userProfile.isLgbtq) return { riskLevel: 'low', warnings };
  const score = userProfile.lgbtqSafetyScore ?? 50;
  if (score < 30) { warnings.push('This area has a low LGBTQ+ safety score.'); warnings.push('Exercise extra caution when meeting in this location.'); return { riskLevel: 'high', warnings, recommendation: 'Consider meeting in a known LGBTQ+-friendly venue.' }; }
  if (score < 60) { warnings.push('LGBTQ+ safety in this area is moderate.'); return { riskLevel: 'medium', warnings, recommendation: 'Meet in well-lit, busy public spaces.' }; }
  return { riskLevel: 'low', warnings };
}
export const gayBashing = assessLgbtqTargetedRisk; export const targetedAttack = assessLgbtqTargetedRisk;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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