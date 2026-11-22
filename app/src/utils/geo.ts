import { Sighting, SourceType, SpotWithEta, TravelDirection, ViewingSpot } from '../types';

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function directionToDegrees(dir: TravelDirection): number | null {
  const map: Record<TravelDirection, number | null> = {
    N: 0,
    NE: 45,
    E: 90,
    SE: 135,
    S: 180,
    SW: 225,
    W: 270,
    NW: 315,
    MILLING: null,
    UNKNOWN: null,
  };
  return map[dir];
}

export function angleDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function enrichSpotsWithEta(spots: ViewingSpot[], sightings: Sighting[]): SpotWithEta[] {
  const now = Date.now();
  // Consider sightings from the last 90 minutes for active ETAs
  const activeSightings = sightings.filter(
    (s) => now - new Date(s.timestamp).getTime() <= 90 * 60_000
  );

  return spots
    .map((spot) => {
      let bestEta: number | null = null;
      let bestDist: number | null = null;
      let bestSighting: Sighting | null = null;

      for (const s of activeSightings) {
        const distKm = haversineKm(s.lat, s.lng, spot.lat, spot.lng);
        if (distKm > 32) continue;

        const heading = directionToDegrees(s.direction);
        const bearingToSpot = bearingDegrees(s.lat, s.lng, spot.lat, spot.lng);
        const elapsedMin = Math.max(0, (now - new Date(s.timestamp).getTime()) / 60_000);
        const speedKmh = Math.max(3.5, (s.speedKnots || 4.5) * 1.852);

        // Either already right off the beach (< 3km) or moving generally toward the spot
        const isNearby = distKm < 3.2;
        const isApproaching = heading !== null && angleDiff(heading, bearingToSpot) <= 58;

        if (!isNearby && !isApproaching) continue;

        const rawMinutes = (distKm / speedKmh) * 60 - elapsedMin;
        const adjustedEta = Math.max(0, Math.round(rawMinutes));
        if (adjustedEta > 120) continue;

        if (bestEta === null || adjustedEta < bestEta) {
          bestEta = adjustedEta;
          bestDist = Number(distKm.toFixed(1));
          bestSighting = s;
        }
      }

      let likelihood: SpotWithEta['likelihood'] = 'none';
      if (bestEta !== null) {
        if (bestEta <= 25) likelihood = 'high';
        else if (bestEta <= 60) likelihood = 'medium';
        else likelihood = 'low';
      }

      return {
        ...spot,
        etaMinutes: bestEta,
        distanceKm: bestDist,
        approachingSightingId: bestSighting?.id ?? null,
        approachingPodLabel: bestSighting
          ? bestSighting.podId || (bestSighting.ecotype === 'SRKW' ? 'Southern Residents' : "Bigg's Orcas")
          : null,
        likelihood,
      };
    })
    .sort((a, b) => {
      if (a.etaMinutes !== null && b.etaMinutes !== null) return a.etaMinutes - b.etaMinutes;
      if (a.etaMinutes !== null) return -1;
      if (b.etaMinutes !== null) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function formatRelativeTime(iso: string): string {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const hrs = Math.floor(diffMin / 60);
  const rem = diffMin % 60;
  return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
}

export function formatDirectionLabel(dir: TravelDirection): string {
  const labels: Record<TravelDirection, string> = {
    N: 'Northbound',
    NE: 'Northeast',
    E: 'Eastbound',
    SE: 'Southeast',
    S: 'Southbound',
    SW: 'Southwest',
    W: 'Westbound',
    NW: 'Northwest',
    MILLING: 'Milling / Foraging',
    UNKNOWN: 'Direction unknown',
  };
  return labels[dir];
}

export function formatSourceLabel(source: SourceType): string {
  const labels: Record<SourceType, string> = {
    acartia_orca_network: 'Orca Network / Acartia',
    orcasound_hydrophone: 'Orcasound Hydrophone',
    bluesky: 'Bluesky',
    reddit: 'Reddit r/Seattle',
    west_seattle_blog: 'West Seattle Blog',
    wsf_ferry: 'WSF Ferry',
    citizen_app: 'SalishPulse Spotter',
  };
  return labels[source];
}

const LANDMARK_GEO: Array<{
  keywords: string[];
  name: string;
  waterway: string;
  lat: number;
  lng: number;
}> = [
  { keywords: ['constellation'], name: 'Off Constellation Park', waterway: 'Main Basin', lat: 47.569, lng: -122.423 },
  { keywords: ['alki'], name: 'Off Alki Point', waterway: 'Elliott Bay / Main Basin', lat: 47.575, lng: -122.435 },
  { keywords: ['lincoln park', 'fauntleroy'], name: 'Off Lincoln Park', waterway: 'East Passage', lat: 47.530, lng: -122.412 },
  { keywords: ['west point', 'discovery park', 'magnolia'], name: 'Off West Point Lighthouse', waterway: 'Puget Sound Main Basin', lat: 47.661, lng: -122.452 },
  { keywords: ['golden gardens', 'ballard', 'shilshole'], name: 'Off Golden Gardens', waterway: 'Shilshole Bay', lat: 47.693, lng: -122.421 },
  { keywords: ['edmonds', 'kingston', 'brackett'], name: 'Off Edmonds Ferry Lane', waterway: 'Main Basin North', lat: 47.816, lng: -122.404 },
  { keywords: ['mukilteo', 'possession', 'clinton'], name: 'Off Mukilteo Lighthouse', waterway: 'Possession Sound', lat: 47.951, lng: -122.323 },
  { keywords: ['bainbridge', 'fort ward', 'eagle harbor'], name: 'Off Bainbridge / Fort Ward', waterway: 'Main Basin West', lat: 47.577, lng: -122.502 },
  { keywords: ['point robinson', 'vashon'], name: 'Off Point Robinson (Vashon)', waterway: 'East Passage', lat: 47.388, lng: -122.362 },
  { keywords: ['redondo', 'des moines', 'mast'], name: 'Off MaST Center / Redondo', waterway: 'East Passage', lat: 47.349, lng: -122.342 },
  { keywords: ['owen beach', 'point defiance', 'tacoma', 'narrows'], name: 'Off Point Defiance / Owen Beach', waterway: 'Dalco Passage', lat: 47.319, lng: -122.531 },
  { keywords: ['bush point', 'whidbey', 'admiralty'], name: 'Off Bush Point (Whidbey)', waterway: 'Admiralty Inlet', lat: 48.031, lng: -122.621 },
];

const ORCA_CARD_NOISE_REGEX =
  /\b(orca\s+card|orca\s+pass|tap\s+to\s+pay|sound\s+transit|king\s+county\s+metro|link\s+light\s+rail|bus\s+fare|reload\s+my\s+orca|canucks|hockey)\b/i;

export function parseSocialPostSafe(
  rawText: string,
  source: SourceType,
  handle: string
): { ok: true; sighting: Sighting } | { ok: false; reason: string } {
  if (ORCA_CARD_NOISE_REGEX.test(rawText)) {
    return {
      ok: false,
      reason: 'Filtered out: Seattle ORCA transit card / non-wildlife chatter detected.',
    };
  }
  return { ok: true, sighting: parseSocialPostToSighting(rawText, source, handle) };
}

export function parseSocialPostToSighting(
  rawText: string,
  source: SourceType,
  handle: string
): Sighting {
  const lower = rawText.toLowerCase();
  const matched =
    LANDMARK_GEO.find((g) => g.keywords.some((kw) => lower.includes(kw))) ?? LANDMARK_GEO[1];

  let direction: TravelDirection = 'UNKNOWN';
  if (/\bsouth\b|southbound|heading s\b|toward tacoma|toward lincoln|toward vashon/.test(lower)) {
    direction = 'S';
  } else if (/\bnorth\b|northbound|heading n\b|toward edmonds|toward mukilteo/.test(lower)) {
    direction = 'N';
  } else if (/milling|foraging|circling|feeding/.test(lower)) {
    direction = 'MILLING';
  }

  let ecotype: Sighting['ecotype'] = 'UNKNOWN';
  let podId: string | undefined;
  if (/j-?pod|k-?pod|l-?pod|srkw|southern resident/.test(lower)) {
    ecotype = 'SRKW';
    const m = lower.match(/(j|k|l)-?pod/);
    podId = m ? `${m[1].toUpperCase()}-Pod` : 'Southern Residents';
  } else if (/bigg|transient|t\d{2,3}/.test(lower)) {
    ecotype = 'BIGGS';
    const m = lower.match(/\bt\d{2,3}[a-z]?\b/i);
    podId = m ? `${m[0].toUpperCase()} (Bigg's)` : "Bigg's Transient";
  } else if (/humpback/.test(lower)) {
    ecotype = 'HUMPBACK';
  } else if (/gray whale|grey whale/.test(lower)) {
    ecotype = 'GRAY';
  } else {
    ecotype = 'SRKW';
    podId = 'Orca Pod (Unconfirmed Ecotype)';
  }

  const countMatch = lower.match(/\b(\d{1,2})\s*(orcas?|whales?|killer whales?|fins?)/);
  const estimatedCount = countMatch ? Math.max(1, parseInt(countMatch[1], 10)) : 4;

  const isSrkw = ecotype === 'SRKW';
  const rawLat = Number((matched.lat + (Math.random() - 0.5) * 0.004).toFixed(4));
  const rawLng = Number((matched.lng + (Math.random() - 0.5) * 0.004).toFixed(4));
  // Deterministic ~750m over-water grid snap for SRKW conservation protection
  const displayLat = isSrkw ? Number((Math.round(rawLat / 0.0068) * 0.0068).toFixed(4)) : rawLat;
  const displayLng = isSrkw ? Number((Math.round(rawLng / 0.01) * 0.01).toFixed(4)) : rawLng;

  return {
    id: `sight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: `${podId ?? 'Orcas'} reported ${matched.name.toLowerCase()}`,
    locationName: matched.name,
    waterway: matched.waterway,
    lat: rawLat,
    lng: rawLng,
    displayLat,
    displayLng,
    isCoarsened: isSrkw,
    coarseningRadiusMeters: isSrkw ? 750 : 0,
    ecotype,
    podId,
    estimatedCount,
    direction,
    speedKnots: direction === 'MILLING' ? 2.2 : 4.8,
    confidence: source === 'acartia_orca_network' ? 'verified' : 'community',
    corroborationCount: 1,
    sources: [source],
    timestamp: new Date().toISOString(),
    summary: rawText.trim(),
    rawExcerpt: `${handle}: "${rawText.trim()}"`,
    reporterHandle: handle,
  };
}

export function mergeOrPrependSighting(
  existing: Sighting[],
  incoming: Sighting
): { list: Sighting[]; merged: boolean; targetId: string } {
  const now = new Date(incoming.timestamp).getTime();
  const matchIdx = existing.findIndex((s) => {
    const dtMin = Math.abs(now - new Date(s.timestamp).getTime()) / 60_000;
    const distKm = haversineKm(s.lat, s.lng, incoming.lat, incoming.lng);
    return dtMin <= 20 && distKm <= 2.8 && (s.ecotype === incoming.ecotype || incoming.ecotype === 'UNKNOWN');
  });

  if (matchIdx >= 0) {
    const prev = existing[matchIdx];
    const nextSources = Array.from(new Set([...prev.sources, ...incoming.sources]));
    const nextCorroboration = prev.corroborationCount + 1;
    const nextConfidence =
      prev.confidence === 'verified'
        ? 'verified'
        : nextCorroboration >= 2
          ? 'corroborated'
          : prev.confidence;

    const updated: Sighting = {
      ...prev,
      timestamp: incoming.timestamp,
      corroborationCount: nextCorroboration,
      confidence: nextConfidence,
      sources: nextSources,
      estimatedCount: Math.max(prev.estimatedCount, incoming.estimatedCount),
      direction: incoming.direction !== 'UNKNOWN' ? incoming.direction : prev.direction,
      rawExcerpt: incoming.rawExcerpt ?? prev.rawExcerpt,
    };
    const next = [...existing];
    next.splice(matchIdx, 1);
    return { list: [updated, ...next], merged: true, targetId: updated.id };
  }

  return { list: [incoming, ...existing], merged: false, targetId: incoming.id };
}
