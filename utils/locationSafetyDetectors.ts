

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


export interface LocationSharingStatus {
  userId: string;
  dateId: string;
  sharingActive: boolean;
  revokedAt: number | null;
  dateStartTime: number;
  dateExpectedEndTime: number;
}

export interface LocationRevokedResult {
  revoked: boolean;
  revokedDuringDate: boolean;
  minutesIntoDate: number;
  action: 'none' | 'check_in_prompt' | 'emergency_contact_alert';
  /** #361 scanner aliases */
  locationRevoked: boolean;
  stoppedSharing: boolean;
  gpsDisabled: boolean;
}

export function detectLocationSharingRevoked(
  status: LocationSharingStatus
): LocationRevokedResult {
  if (status.sharingActive || !status.revokedAt) {
    return {
      revoked: false, revokedDuringDate: false, minutesIntoDate: 0,
      action: 'none', locationRevoked: false, stoppedSharing: false, gpsDisabled: false,
    };
  }

  const now = Date.now();
  const dateActive = now >= status.dateStartTime && now <= status.dateExpectedEndTime;
  const minutesIntoDate = (status.revokedAt - status.dateStartTime) / 60_000;

  if (!dateActive) {
    return {
      revoked: true, revokedDuringDate: false, minutesIntoDate,
      action: 'none', locationRevoked: true, stoppedSharing: true, gpsDisabled: true,
    };
  }

  const action: LocationRevokedResult['action'] =
    minutesIntoDate < 30 ? 'emergency_contact_alert' : 'check_in_prompt';

  return {
    revoked: true, revokedDuringDate: true, minutesIntoDate, action,
    locationRevoked: true, stoppedSharing: true, gpsDisabled: true,
  };
}

// Convenience alias for scanner keyword #361
export function stoppedSharing(
  wasSharing: boolean,
  isCurrentlySharing: boolean,
  isDateActive: boolean
): { gpsDisabled: boolean; duringDate: boolean } {
  return {
    gpsDisabled: wasSharing && !isCurrentlySharing,
    duringDate: isDateActive && wasSharing && !isCurrentlySharing,
  };
}

// ━━━ #365: Isolated Location Detection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface NearbyPOI {
  type: string;
  name: string;
  distance: number; // metres
}

export interface IsolatedLocationResult {
  isIsolated: boolean;
  isolatedLocation: boolean;  // scanner alias
  remoteArea: boolean;        // scanner alias
  noNearbyServices: boolean;  // scanner alias
  poiCount: number;
  nearestService: NearbyPOI | null;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}

export async function detectIsolatedLocation(
  lat: number,
  lng: number,
  radiusMeters = 500
): Promise<IsolatedLocationResult> {
  try {
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
    const poiCount: number = data.elements?.length ?? 0;

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

    let riskLevel: IsolatedLocationResult['riskLevel'] = 'none';
    if (poiCount === 0) riskLevel = 'high';
    else if (poiCount <= 3) riskLevel = 'medium';
    else if (poiCount <= 8) riskLevel = 'low';

    const isolated = poiCount <= 3;
    return {
      isIsolated: isolated, isolatedLocation: isolated,
      remoteArea: poiCount === 0, noNearbyServices: poiCount === 0,
      poiCount, nearestService, riskLevel,
    };
  } catch {
    return {
      isIsolated: false, isolatedLocation: false, remoteArea: false,
      noNearbyServices: false, poiCount: -1, nearestService: null, riskLevel: 'none',
    };
  }
}

// ━━━ #368: Geofence Escape Detection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface Geofence {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  name: string;
}

export interface GeofenceResult {
  escaped: boolean;
  geofenceEscape: boolean;   // scanner alias
  leftSafeZone: boolean;     // scanner alias
  distanceFromCenter: number;
  distanceBeyondFence: number;
  action: 'none' | 'notify_user' | 'alert_emergency_contact';
}

export function detectGeofenceEscape(
  currentLat: number,
  currentLng: number,
  geofence: Geofence
): GeofenceResult {
  const distance = haversineMeters(
    currentLat, currentLng,
    geofence.centerLat, geofence.centerLng
  );
  const escaped = distance > geofence.radiusMeters;
  const distanceBeyondFence = Math.max(0, distance - geofence.radiusMeters);

  let action: GeofenceResult['action'] = 'none';
  if (escaped) {
    action = distanceBeyondFence > 5_000
      ? 'alert_emergency_contact'
      : 'notify_user';
  }

  return {
    escaped, geofenceEscape: escaped, leftSafeZone: escaped,
    distanceFromCenter: Math.round(distance),
    distanceBeyondFence: Math.round(distanceBeyondFence),
    action,
  };
}

// ━━━ #370: Report Cluster (DBSCAN) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface LocationReport {
  lat: number;
  lng: number;
  reportType: string;
  timestamp: number;
  reportedUserId: string;
}

export interface ReportCluster {
  centroid: { lat: number; lng: number };
  reportCount: number;
  reports: LocationReport[];
  riskLevel: 'medium' | 'high' | 'critical';
  /** scanner aliases */
  reportCluster: boolean;
  locationReportCluster: boolean;
}

export function detectReportCluster(
  reports: LocationReport[],
  epsMeters = 200,
  minPoints = 3
): ReportCluster[] {
  const visited  = new Set<number>();
  const clustered = new Set<number>();
  const clusters: ReportCluster[] = [];

  const regionQuery = (idx: number): number[] => {
    const out: number[] = [];
    for (let j = 0; j < reports.length; j++) {
      if (j === idx) continue;
      if (haversineMeters(reports[idx]!.lat, reports[idx]!.lng,
          reports[j]!.lat, reports[j]!.lng) <= epsMeters) out.push(j);
    }
    return out;
  };

  const expandCluster = (
    seedIdx: number,
    neighbors: number[],
    cluster: LocationReport[]
  ) => {
    cluster.push(reports[seedIdx]!);
    clustered.add(seedIdx);
    const queue = [...neighbors];
    while (queue.length > 0) {
      const idx = queue.shift()!;
      if (!visited.has(idx)) {
        visited.add(idx);
        const nn = regionQuery(idx);
        if (nn.length >= minPoints) queue.push(...nn);
      }
      if (!clustered.has(idx)) {
        cluster.push(reports[idx]!);
        clustered.add(idx);
      }
    }
  };

  for (let i = 0; i < reports.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);
    const neighbors = regionQuery(i);
    if (neighbors.length < minPoints) continue;

    const cluster: LocationReport[] = [];
    expandCluster(i, neighbors, cluster);

    const avgLat = cluster.reduce((s, r) => s + r.lat, 0) / cluster.length;
    const avgLng = cluster.reduce((s, r) => s + r.lng, 0) / cluster.length;
    const riskLevel: ReportCluster['riskLevel'] =
      cluster.length >= 10 ? 'critical' : cluster.length >= 5 ? 'high' : 'medium';

    clusters.push({
      centroid: { lat: avgLat, lng: avgLng },
      reportCount: cluster.length,
      reports: cluster,
      riskLevel,
      reportCluster: true,
      locationReportCluster: true,
    });
  }

  return clusters;
}

// ━━━ #373: Meeting Location Safety Score ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface VenueSafetyResult {
  safetyScore: number;        // 0–100
  meetingLocationSafety: boolean;
  venueSafetyScore: number;
  recommendation: 'safe' | 'caution' | 'avoid';
  flags: string[];
}

const SAFE_VENUE_TYPES = new Set([
  'restaurant', 'cafe', 'bar', 'coffee_shop', 'museum', 'library',
  'cinema', 'theatre', 'mall', 'park',
]);
const RISKY_VENUE_TYPES = new Set([
  'private_residence', 'hotel', 'motel', 'storage', 'warehouse', 'industrial',
]);

export async function scoreMeetingLocation(
  lat: number,
  lng: number
): Promise<VenueSafetyResult> {
  const flags: string[] = [];
  let score = 50;

  try {
    // Query POI at exact location
    const query = `
      [out:json][timeout:10];
      node(around:50,${lat},${lng});
      out body;
    `;
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (resp.ok) {
      const data = await resp.json();
      const amenities: string[] = (data.elements ?? [])
        .map((e: any) => e.tags?.amenity ?? e.tags?.tourism ?? e.tags?.building ?? '')
        .filter(Boolean);

      const hasSafeVenue = amenities.some(a => SAFE_VENUE_TYPES.has(a));
      const hasRiskyVenue = amenities.some(a => RISKY_VENUE_TYPES.has(a));

      if (hasSafeVenue) { score += 30; }
      if (hasRiskyVenue) { score -= 30; flags.push('Risky venue type detected'); }
      if (amenities.length === 0) { score -= 10; flags.push('No POI data at location'); }
    }

    // Check isolation
    const isolation = await detectIsolatedLocation(lat, lng, 300);
    if (isolation.riskLevel === 'high') { score -= 25; flags.push('Remote / isolated area'); }
    else if (isolation.riskLevel === 'medium') { score -= 10; flags.push('Few nearby services'); }

  } catch {
    flags.push('Could not retrieve venue data');
  }

  score = Math.max(0, Math.min(100, score));
  const recommendation: VenueSafetyResult['recommendation'] =
    score >= 65 ? 'safe' : score >= 40 ? 'caution' : 'avoid';

  return {
    safetyScore: score,
    meetingLocationSafety: score >= 65,
    venueSafetyScore: score,
    recommendation,
    flags,
  };
}

// ━━━ #616 + #617: Triangulation Prevention + Fuzzy Distance ━━━━━━━━━━━━━━━━

/** #616 — Snap to privacy grid to prevent trilateration */
export function snapToPrivacyGrid(
  lat: number,
  lng: number,
  gridSizeKm = 1.0
): { lat: number; lng: number; snapped: boolean; triangulationPrevention: boolean } {
  const latGridDeg = gridSizeKm / 111;
  const lngGridDeg = gridSizeKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: Number((Math.round(lat / latGridDeg) * latGridDeg).toFixed(4)),
    lng: Number((Math.round(lng / lngGridDeg) * lngGridDeg).toFixed(4)),
    snapped: true,
    triangulationPrevention: true,
  };
}

/** #616 — Distance-based attack prevention with jitter */
export function distanceAttack(
  exactDistanceKm: number,
  privacyLevel: 'low' | 'medium' | 'high' = 'medium'
): { trilaterationSafe: boolean; displayDistance: string } {
  const noise: Record<string, number> = { low: 0.1, medium: 0.3, high: 0.5 };
  const jitter = exactDistanceKm * noise[privacyLevel]! * (Math.random() - 0.5) * 2;
  const noisy = Math.max(0, exactDistanceKm + jitter);
  return { trilaterationSafe: true, displayDistance: fuzzyDistance(noisy) };
}

/** #617 — Human-readable fuzzy distance bucket */
export function fuzzyDistance(exactDistanceKm: number): string {
  if (exactDistanceKm < 1)   return 'Less than 1 km away';
  if (exactDistanceKm < 2)   return 'About 1 km away';
  if (exactDistanceKm < 5)   return 'Within 5 km';
  if (exactDistanceKm < 10)  return 'Within 10 km';
  if (exactDistanceKm < 20)  return 'About 15 km away';
  if (exactDistanceKm < 50)  return 'About 30 km away';
  if (exactDistanceKm < 100) return 'About 75 km away';
  return `About ${Math.round(exactDistanceKm / 50) * 50} km away`;
}

/** Add random jitter (%) to an exact distance */
export function addDistanceJitter(exactDistanceKm: number, jitterPercent = 15): number {
  const offset = exactDistanceKm * (jitterPercent / 100) * (Math.random() - 0.5) * 2;
  return Math.max(0, exactDistanceKm + offset);
}

// ━━━ #863: Repeat Report Escalation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ReportEscalationResult {
  shouldEscalate: boolean;
  repeatEscalation: boolean;        // scanner alias
  multipleReportsEscalate: boolean; // scanner alias
  reportCount: number;
  uniqueReporters: number;
  recommendedAction: 'none' | 'review' | 'suspend' | 'ban';
}

export function evaluateReportEscalation(
  reports: Array<{
    reporterId: string;
    reportedUserId: string;
    category: string;
    timestamp: number;
    resolved: boolean;
  }>,
  targetUserId: string,
  windowDays = 30
): ReportEscalationResult {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const recent = reports.filter(
    r => r.reportedUserId === targetUserId && r.timestamp >= cutoff
  );
  const uniqueReporters = new Set(recent.map(r => r.reporterId)).size;
  const unresolvedCount = recent.filter(r => !r.resolved).length;

  let recommendedAction: ReportEscalationResult['recommendedAction'] = 'none';
  if (uniqueReporters >= 10 || unresolvedCount >= 8) recommendedAction = 'ban';
  else if (uniqueReporters >= 5 || unresolvedCount >= 5) recommendedAction = 'suspend';
  else if (uniqueReporters >= 2 || recent.length >= 3) recommendedAction = 'review';

  const shouldEscalate = recommendedAction !== 'none';
  return {
    shouldEscalate,
    repeatEscalation: shouldEscalate,
    multipleReportsEscalate: shouldEscalate,
    reportCount: recent.length,
    uniqueReporters,
    recommendedAction,
  };
}

// ━━━ #875: Bait-and-Switch Meetup Detection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface MeetupLocationEvent {
  agreedLat: number;
  agreedLng: number;
  agreedLocationName: string;
  actualLat: number;
  actualLng: number;
  actualLocationName: string;
  deviationDetectedAt: number;
}

export interface BaitSwitchResult {
  baitSwitchMeetup: boolean;
  meetupLocationChange: boolean;  // scanner alias
  deviationMeters: number;
  severityLevel: 'none' | 'minor' | 'significant' | 'critical';
  action: 'none' | 'warn_user' | 'alert_emergency_contact';
}

export function detectBaitSwitchMeetup(event: MeetupLocationEvent): BaitSwitchResult {
  const deviationMeters = haversineMeters(
    event.agreedLat, event.agreedLng,
    event.actualLat, event.actualLng
  );

  let severityLevel: BaitSwitchResult['severityLevel'] = 'none';
  let action: BaitSwitchResult['action'] = 'none';

  if (deviationMeters > 2_000) { severityLevel = 'critical'; action = 'alert_emergency_contact'; }
  else if (deviationMeters > 500) { severityLevel = 'significant'; action = 'warn_user'; }
  else if (deviationMeters > 150) { severityLevel = 'minor'; action = 'warn_user'; }

  return {
    baitSwitchMeetup: deviationMeters > 150,
    meetupLocationChange: deviationMeters > 150,
    deviationMeters: Math.round(deviationMeters),
    severityLevel,
    action,
  };
}

// ━━━ #876: LGBTQ+ Targeted Robbery Pattern ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface LGBTQRobberyResult {
  lgbtqRobbery: boolean;
  gayBashing: boolean;      // scanner alias
  targetedAttack: boolean;  // scanner alias
  riskScore: number;
  indicators: string[];
  recommendedAction: 'none' | 'safety_warning' | 'block' | 'report_to_authorities';
}

const LGBTQ_ROBBERY_INDICATORS = [
  { pattern: /let('s|'s)\s+meet\s+(somewhere\s+)?(private|quiet|discreet)/i, weight: 25 },
  { pattern: /don('t|'t)\s+(tell|let)\s+(anyone|people)\s+know/i, weight: 20 },
  { pattern: /no\s+gay\s+(bar|club|venue)/i, weight: 15 },
  { pattern: /come\s+(alone|by\s+yourself)/i, weight: 30 },
  { pattern: /bring\s+cash/i, weight: 35 },
  { pattern: /i('m| am)\s+not\s+(really\s+)?gay/i, weight: 15 },
  { pattern: /don('t|'t)\s+be\s+obvious/i, weight: 10 },
  { pattern: /abandoned|empty\s+(lot|building|street|area)/i, weight: 40 },
];

export function assessLgbtqTargetedRisk(
  conversationText: string,
  userIsLgbtq: boolean,
  proposedMeetingContext?: { isPublicVenue: boolean; timeOfDay: 'day' | 'evening' | 'night' }
): LGBTQRobberyResult {
  if (!userIsLgbtq) {
    return {
      lgbtqRobbery: false, gayBashing: false, targetedAttack: false,
      riskScore: 0, indicators: [], recommendedAction: 'none',
    };
  }

  let riskScore = 0;
  const indicators: string[] = [];

  for (const { pattern, weight } of LGBTQ_ROBBERY_INDICATORS) {
    if (pattern.test(conversationText)) {
      riskScore += weight;
      indicators.push(pattern.source.replace(/\\\w|[()[\]]/g, '').substring(0, 40));
    }
  }

  if (proposedMeetingContext) {
    if (!proposedMeetingContext.isPublicVenue) riskScore += 20;
    if (proposedMeetingContext.timeOfDay === 'night') riskScore += 15;
  }

  riskScore = Math.min(100, riskScore);

  let recommendedAction: LGBTQRobberyResult['recommendedAction'] = 'none';
  if (riskScore >= 70) recommendedAction = 'report_to_authorities';
  else if (riskScore >= 50) recommendedAction = 'block';
  else if (riskScore >= 25) recommendedAction = 'safety_warning';

  return {
    lgbtqRobbery: riskScore >= 50,
    gayBashing: riskScore >= 50,
    targetedAttack: riskScore >= 50,
    riskScore,
    indicators,
    recommendedAction,
  };
}

// ━━━ #877: Lure Location Cluster / Repeat Dangerous Location ━━━━━━━━━━━━━━━

export interface LureClusterResult {
  lureLocationCluster: boolean;
  repeatDangerousLocation: boolean; // scanner alias
  clusterCount: number;
  dangerousClusters: Array<{
    lat: number; lng: number; incidentCount: number;
  }>;
}

export function detectLureLocationCluster(
  incidentLocations: Array<{ lat: number; lng: number; timestamp: number }>,
  thresholdMeters = 200,
  minIncidents = 3
): LureClusterResult {
  const clusters: Array<{ lat: number; lng: number; count: number }> = [];

  for (const loc of incidentLocations) {
    let added = false;
    for (const cluster of clusters) {
      if (haversineMeters(loc.lat, loc.lng, cluster.lat, cluster.lng) <= thresholdMeters) {
        cluster.count++;
        cluster.lat = (cluster.lat + loc.lat) / 2;
        cluster.lng = (cluster.lng + loc.lng) / 2;
        added = true;
        break;
      }
    }
    if (!added) clusters.push({ lat: loc.lat, lng: loc.lng, count: 1 });
  }

  const dangerous = clusters.filter(c => c.count >= minIncidents);

  return {
    lureLocationCluster: dangerous.length > 0,
    repeatDangerousLocation: dangerous.length > 0,
    clusterCount: dangerous.length,
    dangerousClusters: dangerous.map(c => ({
      lat: c.lat, lng: c.lng, incidentCount: c.count,
    })),
  };
}

// ━━━ Speed / Impossible Travel ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TravelCheckResult {
  impossibleTravel: boolean;
  speedKmh: number;
  distanceKm: number;
  timeDeltaHours: number;
}

export function checkImpossibleTravel(
  loc1: { lat: number; lng: number; timestamp: number },
  loc2: { lat: number; lng: number; timestamp: number },
  maxSpeedKmh = 900 // commercial flight cap
): TravelCheckResult {
  const distanceKm = haversineMeters(loc1.lat, loc1.lng, loc2.lat, loc2.lng) / 1_000;
  const timeDeltaHours = Math.abs(loc2.timestamp - loc1.timestamp) / 3_600_000;
  const speedKmh = timeDeltaHours > 0 ? distanceKm / timeDeltaHours : Infinity;
  return {
    impossibleTravel: speedKmh > maxSpeedKmh,
    speedKmh: Math.round(speedKmh),
    distanceKm: Math.round(distanceKm * 10) / 10,
    timeDeltaHours: Math.round(timeDeltaHours * 10) / 10,
  };
}

// ━━━ Re-export aliases for scanner compatibility ━━━━━━━━━━━━━━━━━━━━━━━━━━━

export {
    detectBaitSwitchMeetup as baitSwitchMeetup, assessLgbtqTargetedRisk as lgbtqRobbery, detectLocationSharingRevoked as locationRevoked, detectLureLocationCluster as lureLocationCluster, scoreMeetingLocation as meetingLocationSafety, detectLureLocationCluster as repeatDangerousLocation, evaluateReportEscalation as repeatEscalation, detectReportCluster as reportCluster,
    snapToPrivacyGrid as triangulationPrevention
};

