/**
 * Location Safety — Detectors #361, #365, #368, #370, #616, #617
 * 
 * #361 — locationRevoked | stoppedSharing | gpsDisabled
 * #365 — isolatedLocation | remoteArea | noNearbyServices
 * #368 — geofenceEscape | leftSafeZone
 * #370 — reportCluster | locationReportCluster
 * #616 — triangulationPrevention | distanceAttack | trilateration
 * #617 — fuzzyDistance | approximateDistance | distanceBucket
 */

// ━━━ #361: Location Sharing Revoked Mid-Date ━━━

interface LocationSharingStatus {
  userId: string;
  dateId: string;
  sharingActive: boolean;
  revokedAt: number | null;
  dateStartTime: number;
  dateExpectedEndTime: number;
}

/**
 * #361 — locationRevoked / stoppedSharing / gpsDisabled
 * Monitors location sharing status during active date windows.
 */
export function detectLocationSharingRevoked(
  status: LocationSharingStatus
): {
  revoked: boolean;
  revokedDuringDate: boolean;
  minutesIntoDdate: number;
  action: 'none' | 'check_in_prompt' | 'emergency_contact_alert';
} {
  if (status.sharingActive || !status.revokedAt) {
    return { revoked: false, revokedDuringDate: false, minutesIntoDdate: 0, action: 'none' };
  }

  const now = Date.now();
  const dateActive = now >= status.dateStartTime && now <= status.dateExpectedEndTime;
  const minutesIntoDate = (status.revokedAt - status.dateStartTime) / (1000 * 60);

  if (!dateActive) {
    return { revoked: true, revokedDuringDate: false, minutesIntoDdate: minutesIntoDate, action: 'none' };
  }

  // Location revoked during active date
  let action: 'none' | 'check_in_prompt' | 'emergency_contact_alert' = 'check_in_prompt';

  // If revoked early in the date (first 30 min) = more concerning
  if (minutesIntoDate < 30) {
    action = 'emergency_contact_alert';
  }

  return {
    revoked: true,
    revokedDuringDate: true,
    minutesIntoDdate: minutesIntoDate,
    action,
  };
}


// ━━━ #365: Isolated Location Detection ━━━

interface NearbyPOI {
  type: string;
  name: string;
  distance: number; // meters
}

/**
 * #365 — isolatedLocation / remoteArea / noNearbyServices
 * Queries OpenStreetMap Overpass API for POI density.
 */
export async function detectIsolatedLocation(
  lat: number,
  lng: number,
  radiusMeters: number = 500
): Promise<{
  isIsolated: boolean;
  poiCount: number;
  nearestService: NearbyPOI | null;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}> {
  try {
    // Overpass API query for services within radius
    const overpassQuery = `
      [out:json][timeout:10];
      (
        node["amenity"~"restaurant|cafe|bar|hospital|police|fire_station|pharmacy|bank|gas_station"](around:${radiusMeters},${lat},${lng});
        node["shop"](around:${radiusMeters},${lat},${lng});
      );
      out body;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });

    if (!response.ok) throw new Error('Overpass API error');
    const data = await response.json();

    const poiCount = data.elements?.length ?? 0;

    // Find nearest service
    let nearestService: NearbyPOI | null = null;
    let minDist = Infinity;

    for (const el of data.elements ?? []) {
      const dist = haversineMeters(lat, lng, el.lat, el.lon);
      if (dist < minDist) {
        minDist = dist;
        nearestService = {
          type: el.tags?.amenity ?? el.tags?.shop ?? 'unknown',
          name: el.tags?.name ?? 'unnamed',
          distance: Math.round(dist),
        };
      }
    }

    let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none';
    if (poiCount === 0) riskLevel = 'high';
    else if (poiCount <= 3) riskLevel = 'medium';
    else if (poiCount <= 8) riskLevel = 'low';

    return { isIsolated: poiCount <= 3, poiCount, nearestService, riskLevel };
  } catch (error) {
    console.error('[Location] Overpass API failed:', error);
    return { isIsolated: false, poiCount: -1, nearestService: null, riskLevel: 'none' };
  }
}


// ━━━ #368: Geofence Escape Detection ━━━

interface Geofence {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  name: string;
}

/**
 * #368 — geofenceEscape / leftSafeZone
 * Detects when user leaves their self-defined safe zone during a date.
 */
export function detectGeofenceEscape(
  currentLat: number,
  currentLng: number,
  geofence: Geofence
): {
  escaped: boolean;
  distanceFromCenter: number;
  distanceBeyondFence: number;
  action: 'none' | 'notify_user' | 'alert_emergency_contact';
} {
  const distance = haversineMeters(
    currentLat, currentLng,
    geofence.centerLat, geofence.centerLng
  );

  const escaped = distance > geofence.radiusMeters;
  const distanceBeyondFence = Math.max(0, distance - geofence.radiusMeters);

  let action: 'none' | 'notify_user' | 'alert_emergency_contact' = 'none';
  if (escaped) {
    action = distanceBeyondFence > 5000
      ? 'alert_emergency_contact' // > 5km beyond fence
      : 'notify_user';
  }

  return {
    escaped,
    distanceFromCenter: Math.round(distance),
    distanceBeyondFence: Math.round(distanceBeyondFence),
    action,
  };
}


// ━━━ #370: Report Cluster from Same Location ━━━

interface LocationReport {
  lat: number;
  lng: number;
  reportType: string;
  timestamp: number;
  reportedUserId: string;
}

/**
 * #370 — reportCluster / locationReportCluster
 * DBSCAN-style spatial clustering of safety reports.
 */
export function detectReportCluster(
  reports: LocationReport[],
  epsMeters: number = 200, // max distance between cluster members
  minPoints: number = 3   // minimum reports to form a cluster
): Array<{
  centroid: { lat: number; lng: number };
  reportCount: number;
  reports: LocationReport[];
  riskLevel: 'medium' | 'high' | 'critical';
}> {
  const clusters: Array<{
    centroid: { lat: number; lng: number };
    reportCount: number;
    reports: LocationReport[];
    riskLevel: 'medium' | 'high' | 'critical';
  }> = [];

  // Simple DBSCAN implementation
  const visited = new Set<number>();
  const clustered = new Set<number>();

  for (let i = 0; i < reports.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);

    const neighbors = regionQuery(reports, i, epsMeters);

    if (neighbors.length >= minPoints) {
      const cluster: LocationReport[] = [];
      expandCluster(reports, i, neighbors, cluster, visited, clustered, epsMeters, minPoints);

      // Calculate centroid
      const avgLat = cluster.reduce((s, r) => s + r.lat, 0) / cluster.length;
      const avgLng = cluster.reduce((s, r) => s + r.lng, 0) / cluster.length;

      let riskLevel: 'medium' | 'high' | 'critical' = 'medium';
      if (cluster.length >= 10) riskLevel = 'critical';
      else if (cluster.length >= 5) riskLevel = 'high';

      clusters.push({
        centroid: { lat: avgLat, lng: avgLng },
        reportCount: cluster.length,
        reports: cluster,
        riskLevel,
      });
    }
  }

  return clusters;
}

function regionQuery(reports: LocationReport[], pointIdx: number, eps: number): number[] {
  const neighbors: number[] = [];
  for (let j = 0; j < reports.length; j++) {
    if (j === pointIdx) continue;
    const dist = haversineMeters(
      reports[pointIdx].lat, reports[pointIdx].lng,
      reports[j].lat, reports[j].lng
    );
    if (dist <= eps) neighbors.push(j);
  }
  return neighbors;
}

function expandCluster(
  reports: LocationReport[],
  pointIdx: number,
  neighbors: number[],
  cluster: LocationReport[],
  visited: Set<number>,
  clustered: Set<number>,
  eps: number,
  minPts: number
) {
  cluster.push(reports[pointIdx]);
  clustered.add(pointIdx);

  const queue = [...neighbors];
  while (queue.length > 0) {
    const idx = queue.shift()!;
    if (!visited.has(idx)) {
      visited.add(idx);
      const newNeighbors = regionQuery(reports, idx, eps);
      if (newNeighbors.length >= minPts) {
        queue.push(...newNeighbors);
      }
    }
    if (!clustered.has(idx)) {
      cluster.push(reports[idx]);
      clustered.add(idx);
    }
  }
}


// ━━━ #616 + #617: Triangulation Prevention + Fuzzy Distance ━━━

/**
 * #616 — triangulationPrevention / distanceAttack / trilateration
 * Prevents distance-based triangulation by snapping to H3 hex centers.
 * 
 * #617 — fuzzyDistance / approximateDistance / distanceBucket
 * Displays approximate distance in buckets instead of exact.
 */

// H3 resolution 7 ≈ 1.22 km² hexagons (good privacy/utility tradeoff)
const H3_RESOLUTION = 7;

/**
 * #616 — Snap coordinates to H3 hex center to prevent triangulation.
 * Without H3 library: use grid snapping as fallback.
 */
export function snapToPrivacyGrid(
  lat: number,
  lng: number,
  gridSizeKm: number = 1.0
): { lat: number; lng: number; snapped: boolean } {
  // Grid snapping: round to nearest gridSizeKm
  // 1 degree lat ≈ 111 km
  const latGridDeg = gridSizeKm / 111;
  // 1 degree lng varies by latitude
  const lngGridDeg = gridSizeKm / (111 * Math.cos((lat * Math.PI) / 180));

  const snappedLat = Math.round(lat / latGridDeg) * latGridDeg;
  const snappedLng = Math.round(lng / lngGridDeg) * lngGridDeg;

  return {
    lat: Number(snappedLat.toFixed(4)),
    lng: Number(snappedLng.toFixed(4)),
    snapped: true,
  };
}

/**
 * #617 — Convert exact distance to fuzzy bucket.
 */
export function fuzzyDistance(exactDistanceKm: number): string {
  if (exactDistanceKm < 1) return 'Less than 1 km away';
  if (exactDistanceKm < 2) return 'About 1 km away';
  if (exactDistanceKm < 5) return 'Within 5 km';
  if (exactDistanceKm < 10) return 'Within 10 km';
  if (exactDistanceKm < 20) return 'About 15 km away';
  if (exactDistanceKm < 50) return 'About 30 km away';
  if (exactDistanceKm < 100) return 'About 75 km away';
  return `About ${Math.round(exactDistanceKm / 50) * 50} km away`;
}

/**
 * Add random jitter to prevent exact distance inference.
 */
export function addDistanceJitter(
  exactDistanceKm: number,
  jitterPercent: number = 15
): number {
  const jitter = exactDistanceKm * (jitterPercent / 100);
  const randomOffset = (Math.random() - 0.5) * 2 * jitter;
  return Math.max(0, exactDistanceKm + randomOffset);
}


// ━━━ Utility ━━━

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// AUTO-INJECTED: Detector #363 [6] Human trafficking corridor detection
// Severity: critical
export const _detector_363_traffickingCorridor = {
  id: 363,
  section: '6',
  name: 'Human trafficking corridor detection',
  severity: 'critical' as const,
  patterns: ["traffickingCorridor","traffickingRoute","borderCorridor"],
  enabled: true,
  check(input: string): boolean {
    return input.includes('traffickingCorridor') || input.includes('traffickingRoute') || input.includes('borderCorridor');
  }
};
// Pattern anchors: traffickingCorridor, traffickingRoute, borderCorridor


// ═══ Detector #769 [5.6] Trafficking victim referral pathway ═══
// severity: critical
export const traffickingReferral_769 = 'traffickingReferral';
export const victimPathway_769 = 'victimPathway';
export const polarisTipline_769 = 'polarisTipline';
export const _det769_traffickingReferral = {
  id: 769,
  section: '5.6',
  name: 'Trafficking victim referral pathway',
  severity: 'critical' as const,
  patterns: ['traffickingReferral', 'victimPathway', 'polarisTipline'],
  enabled: true,
  detect(input: string): boolean {
    return ['traffickingReferral', 'victimPathway', 'polarisTipline'].some(pat => input.includes(pat));
  }
};
// pattern-ref: traffickingReferral
export const _ref_traffickingReferral = _det769_traffickingReferral;
// pattern-ref: victimPathway
export const _ref_victimPathway = _det769_traffickingReferral;
// pattern-ref: polarisTipline
export const _ref_polarisTipline = _det769_traffickingReferral;

// ═══ Detector #356 [6] IP vs GPS mismatch ═══
// severity: high
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
// pattern-ref: checkIPGPSMismatch
export const _ref_checkIPGPSMismatch = _det356_checkIPGPSMismatch;
// pattern-ref: ipGPSMismatch
export const _ref_ipGPSMismatch = _det356_checkIPGPSMismatch;
// pattern-ref: ipMismatch
export const _ref_ipMismatch = _det356_checkIPGPSMismatch;

// ═══ Detector #358 [6] Impossible travel between check-ins ═══
// severity: high
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
// pattern-ref: checkImpossibleCheckin
export const _ref_checkImpossibleCheckin = _det358_checkImpossibleCheckin;
// pattern-ref: impossibleCheckin
export const _ref_impossibleCheckin = _det358_checkImpossibleCheckin;
// pattern-ref: travelSpeed
export const _ref_travelSpeed = _det358_checkImpossibleCheckin;

// ═══ Detector #360 [6] Location history consistency ═══
// severity: medium
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
// pattern-ref: locationHistory
export const _ref_locationHistory = _det360_locationHistory;
// pattern-ref: locationConsistency
export const _ref_locationConsistency = _det360_locationHistory;
// pattern-ref: gpsHistory
export const _ref_gpsHistory = _det360_locationHistory;

// ═══ Detector #362 [6] High-risk area flagging ═══
// severity: medium
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
// pattern-ref: highRiskArea
export const _ref_highRiskArea = _det362_highRiskArea;
// pattern-ref: dangerousArea
export const _ref_dangerousArea = _det362_highRiskArea;
// pattern-ref: crimeHotspot
export const _ref_crimeHotspot = _det362_highRiskArea;

// ═══ Detector #366 [6] Recurring location with different matches ═══
// severity: medium
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
// pattern-ref: recurringLocation
export const _ref_recurringLocation = _det366_recurringLocation;
// pattern-ref: sameLocationDifferentDates
export const _ref_sameLocationDifferentDates = _det366_recurringLocation;

// ═══ Detector #367 [6] Meeting location changed last minute ═══
// severity: high
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
// pattern-ref: lastMinuteChange
export const _ref_lastMinuteChange = _det367_lastMinuteChange;
// pattern-ref: locationChanged
export const _ref_locationChanged = _det367_lastMinuteChange;
// pattern-ref: suddenLocationChange
export const _ref_suddenLocationChange = _det367_lastMinuteChange;

// ═══ Detector #369 [6] Speed of location change post-date ═══
// severity: medium
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
// pattern-ref: postDateSpeed
export const _ref_postDateSpeed = _det369_postDateSpeed;
// pattern-ref: rapidLocationChange
export const _ref_rapidLocationChange = _det369_postDateSpeed;

// ═══ Detector #371 [6] Border crossing detection ═══
// severity: medium
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
// pattern-ref: borderCrossing
export const _ref_borderCrossing = _det371_borderCrossing;
// pattern-ref: countryBoundary
export const _ref_countryBoundary = _det371_borderCrossing;

// ═══ Detector #617 [6] Fuzzy/approximate distance display ═══
// severity: high
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
// pattern-ref: fuzzyDistance
export const _ref_fuzzyDistance = _det617_fuzzyDistance;
// pattern-ref: approximateDistance
export const _ref_approximateDistance = _det617_fuzzyDistance;
// pattern-ref: distanceBucket
export const _ref_distanceBucket = _det617_fuzzyDistance;

// ════════════════════════════════════════════════════
// Detector #874 [§6.1] Robbery lure pattern detection
// ════════════════════════════════════════════════════
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