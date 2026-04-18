/**
 * Extended Location & Physical Date Safety Detectors
 * #364 — motelDetect | hotelAddress | lodgingDetect
 * #366 — recurringLocation | sameLocationDifferentDates
 * #369 — postDateSpeed | rapidLocationChange
 * #371 — borderCrossing | countryBoundary
 * #374 — lateNightMeeting | firstDateNight | meetingHourCheck
 * #418 — speedDatingFraud | eventFraud
 * #419 — recurringSameLocation | alwaysSamePlace
 * #754 — transportationBarrier | noTransportation | controlMechanism
 */


export async function motelDetect(
  lat: number,
  lng: number
): Promise<{
  hotelAddress: boolean;
  lodgingDetect: boolean;
  lodgingType: string | null;
  name: string | null;
}> {
  try {
    const overpassQuery = `
      [out:json][timeout:10];
      (
        node["tourism"~"hotel|motel|hostel|guest_house"](around:100,${lat},${lng});
        node["amenity"~"hotel|motel"](around:100,${lat},${lng});
      );
      out body;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });

    if (response.ok) {
      const data = await response.json();
      const firstResult = data.elements?.[0];

      if (firstResult) {
        const lodgingType = firstResult.tags?.tourism ?? firstResult.tags?.amenity ?? 'lodging';
        return {
          hotelAddress: true,
          lodgingDetect: true,
          lodgingType,
          name: firstResult.tags?.name ?? null,
        };
      }
    }
  } catch { /* fall through */ }

  return { hotelAddress: false, lodgingDetect: false, lodgingType: null, name: null };
}


export function recurringLocation(
  meetingLocations: Array<{
    lat: number;
    lng: number;
    matchId: string;
    timestamp: number;
  }>,
  radiusMeters: number = 200
): {
  sameLocationDifferentDates: boolean;
  suspiciousLocations: Array<{ lat: number; lng: number; matchCount: number }>;
} {
  const clusters: Array<{ lat: number; lng: number; matchIds: Set<string> }> = [];

  for (const loc of meetingLocations) {
    let added = false;

    for (const cluster of clusters) {
      const dist = haversineMeters(loc.lat, loc.lng, cluster.lat, cluster.lng);
      if (dist <= radiusMeters) {
        cluster.matchIds.add(loc.matchId);
        cluster.lat = (cluster.lat + loc.lat) / 2;
        cluster.lng = (cluster.lng + loc.lng) / 2;
        added = true;
        break;
      }
    }

    if (!added) {
      clusters.push({ lat: loc.lat, lng: loc.lng, matchIds: new Set([loc.matchId]) });
    }
  }

  const suspiciousLocations = clusters
    .filter(c => c.matchIds.size >= 3)
    .map(c => ({ lat: c.lat, lng: c.lng, matchCount: c.matchIds.size }));

  return {
    sameLocationDifferentDates: suspiciousLocations.length > 0,
    suspiciousLocations,
  };
}


export function postDateSpeed(
  locations: Array<{ lat: number; lng: number; timestamp: number }>
): {
  rapidLocationChange: boolean;
  maxSpeedKmh: number;
  impossibleMovement: boolean;
} {
  if (locations.length < 2) {
    return { rapidLocationChange: false, maxSpeedKmh: 0, impossibleMovement: false };
  }

  const sorted = locations.sort((a, b) => a.timestamp - b.timestamp);
  let maxSpeedKmh = 0;

  for (let i = 1; i < sorted.length; i++) {
    const distKm = haversineKm(
      sorted[i - 1].lat, sorted[i - 1].lng,
      sorted[i].lat, sorted[i].lng
    );
    const timeHours = (sorted[i].timestamp - sorted[i - 1].timestamp) / 3600000;

    if (timeHours > 0) {
      const speedKmh = distKm / timeHours;
      maxSpeedKmh = Math.max(maxSpeedKmh, speedKmh);
    }
  }

  return {
    rapidLocationChange: maxSpeedKmh > 200, // faster than driving
    maxSpeedKmh,
    impossibleMovement: maxSpeedKmh > 900, // faster than commercial flight
  };
}


export async function borderCrossing(
  prevIp: string,
  currentIp: string
): Promise<{
  countryBoundary: boolean;
  fromCountry: string | null;
  toCountry: string | null;
}> {
  try {
    const [prevCountry, currentCountry] = await Promise.all([
      getCountryFromIp(prevIp).catch((e: unknown) => { if (__DEV__) console.error(e); throw e; }),
      getCountryFromIp(currentIp),
    ]);

    return {
      countryBoundary: prevCountry !== currentCountry && !!prevCountry && !!currentCountry,
      fromCountry: prevCountry,
      toCountry: currentCountry,
    };
  } catch {
    return { countryBoundary: false, fromCountry: null, toCountry: null };
  }
}

async function getCountryFromIp(ip: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${process.env.GEOIP_API_URL}/country/${ip}`
    );
    if (response.ok) {
      const data = await response.json();
      return data.country_code ?? null;
    }
  } catch { /* fall through */ }
  return null;
}


export function lateNightMeeting(
  proposedMeetingTime: Date,
  isFirstMeeting: boolean
): {
  firstDateNight: boolean;
  meetingHourCheck: boolean;
  hour: number;
  safetyWarning: string | null;
} {
  const hour = proposedMeetingTime.getHours();
  const isLateNight = hour >= 22 || hour < 6;
  const isEvening = hour >= 20;

  const firstDateNight = isFirstMeeting && isLateNight;
  const meetingHourCheck = isFirstMeeting && isEvening;

  let safetyWarning: string | null = null;
  if (firstDateNight) {
    safetyWarning = 'This first date is scheduled late at night. For your safety, ' +
      'consider meeting during daytime hours in a public location.';
  } else if (meetingHourCheck) {
    safetyWarning = 'Evening first dates are fine — just make sure to meet in a public place ' +
      'and share your plans with someone you trust.';
  }

  return { firstDateNight, meetingHourCheck, hour, safetyWarning };
}


export function speedDatingFraud(
  eventSignups: Array<{
    userId: string;
    eventId: string;
    paidAmount: number;
    checkedIn: boolean;
    matchesRequested: boolean;
  }>
): {
  eventFraud: boolean;
  suspiciousUsers: string[];
  patterns: string[];
} {
  const patterns: string[] = [];
  const suspiciousUsers: string[] = [];

  const paidNoShow = eventSignups.filter(s => s.paidAmount > 0 && !s.checkedIn);
  if (paidNoShow.length >= 3) {
    patterns.push('Multiple paid no-shows — potential chargeback fraud');
    paidNoShow.forEach(u => suspiciousUsers.push(u.userId));
  }

  const byUser: Record<string, number> = {};
  for (const signup of eventSignups) {
    byUser[signup.userId] = (byUser[signup.userId] ?? 0) + 1;
  }
  for (const [userId, count] of Object.entries(byUser)) {
    if (count >= 5) {
      patterns.push(`User ${userId} signed up for ${count} events`);
      suspiciousUsers.push(userId);
    }
  }

  return {
    eventFraud: patterns.length > 0,
    suspiciousUsers: [...new Set(suspiciousUsers)],
    patterns,
  };
}


export function recurringSameLocation(
  meetingHistory: Array<{
    lat: number;
    lng: number;
    matchId: string;
    outcome?: 'positive' | 'negative' | 'no_report';
  }>
): {
  alwaysSamePlace: boolean;
  dominantLocation: { lat: number; lng: number } | null;
  dominancePercent: number;
} {
  if (meetingHistory.length < 3) {
    return { alwaysSamePlace: false, dominantLocation: null, dominancePercent: 0 };
  }

  const CLUSTER_RADIUS = 300; // meters
  const clusters: Array<{ lat: number; lng: number; count: number }> = [];

  for (const meeting of meetingHistory) {
    let placed = false;
    for (const cluster of clusters) {
      const dist = haversineMeters(meeting.lat, meeting.lng, cluster.lat, cluster.lng);
      if (dist <= CLUSTER_RADIUS) {
        cluster.count++;
        cluster.lat = (cluster.lat + meeting.lat) / 2;
        cluster.lng = (cluster.lng + meeting.lng) / 2;
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ lat: meeting.lat, lng: meeting.lng, count: 1 });
  }

  const dominant = clusters.sort((a, b) => b.count - a.count)[0];
  const dominancePercent = (dominant.count / meetingHistory.length) * 100;

  return {
    alwaysSamePlace: dominancePercent >= 70,
    dominantLocation: dominancePercent >= 50 ? { lat: dominant.lat, lng: dominant.lng } : null,
    dominancePercent,
  };
}


const TRANSPORTATION_CONTROL_PATTERNS = [
  /i('ll| will) (pick you up|drive you|give you a ride)/i,
  /don't worry about (getting|transport|a ride|an uber|a taxi)/i,
  /i (have|got) a car/i,
  /just get in (my|the) car/i,
  /i('ll| will) (take|drop) you/i,
  /you don't need (to|a)/i,
  /leave your car/i,
];

const TRANSPORTATION_COERCION_PATTERNS = [
  /too far (to|for) (walk|uber|taxi)/i,
  /no other (way|option|choice)/i,
  /(only|just) (option|way) is (with|for) me/i,
  /can't afford (uber|taxi|bus)/i,
  /i('ll| will) (pay|cover|handle) (it|your ride|the cost)/i,
];

export function transportationBarrier(
  messages: Array<{ text: string; senderId: string }>,
  suspectId: string
): {
  noTransportation: boolean;
  controlMechanism: boolean;
  offerCount: number;
  coercionDetected: boolean;
} {
  const suspectMsgs = messages.filter(m => m.senderId === suspectId);

  const offerCount = suspectMsgs.filter(m =>
    TRANSPORTATION_CONTROL_PATTERNS.some(p => p.test(m.text))
  ).length;

  const coercionDetected = suspectMsgs.some(m =>
    TRANSPORTATION_COERCION_PATTERNS.some(p => p.test(m.text))
  );

  return {
    noTransportation: offerCount >= 2,
    controlMechanism: offerCount >= 3 || coercionDetected,
    offerCount,
    coercionDetected,
  };
}


function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}