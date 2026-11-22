import {
  angularDiffDegrees,
  bearingDegrees,
  directionToBearing,
  haversineDistanceKm,
  kmToNauticalMiles,
} from './geo.ts';
import type {
  AlertEvaluationResult,
  SightingCluster,
  ViewingSpot,
  ViewingSpotWithEta,
} from './types.ts';

const BE_WHALE_WISE_NOTE =
  'Land-based viewing only. WA law requires vessels to stay at least 1,000 yards from Southern Resident orcas.';

const MAX_ACTIVE_AGE_MINUTES = 240; // 4 hours
const MAX_CORRIDOR_DISTANCE_NM = 18;
const VISIBLE_NOW_KM = 2.6;

interface EtaCandidate {
  cluster: SightingCluster;
  etaMinutes: number;
  etaRangeMinutes: [number, number];
  viewingLikelihood: ViewingSpotWithEta['viewingLikelihood'];
  distanceNm: number;
  alignmentScore: number;
  statusMessage: string;
  rankScore: number;
}

function evaluateClusterForSpot(
  spot: ViewingSpot,
  cluster: SightingCluster,
  nowMs: number,
): EtaCandidate | null {
  const ageMinutes = Math.max(0, (nowMs - Date.parse(cluster.lastSeenAt)) / 60_000);
  if (ageMinutes > MAX_ACTIVE_AGE_MINUTES) return null;

  const distanceKm = haversineDistanceKm(cluster.lat, cluster.lng, spot.lat, spot.lng);
  const distanceNm = Number(kmToNauticalMiles(distanceKm).toFixed(2));
  if (distanceNm > MAX_CORRIDOR_DISTANCE_NM) return null;

  const freshnessFactor = Math.max(0.2, 1 - ageMinutes / MAX_ACTIVE_AGE_MINUTES);
  const podLabel = cluster.pod
    ? `${cluster.pod} (${cluster.ecotype})`
    : cluster.ecotype !== 'Unknown'
      ? `${cluster.ecotype} orcas`
      : 'Orcas';

  // Case 1: Pod is right off this viewing spot right now (or milling nearby)
  if (distanceKm <= VISIBLE_NOW_KM && ageMinutes <= 45) {
    const likelihood: ViewingSpotWithEta['viewingLikelihood'] =
      cluster.confidenceScore >= 0.7 && ageMinutes <= 25 ? 'high' : 'medium';

    return {
      cluster,
      etaMinutes: 0,
      etaRangeMinutes: [0, 10],
      viewingLikelihood: likelihood,
      distanceNm,
      alignmentScore: 1,
      statusMessage: `${podLabel} active right off ${spot.name} (${distanceNm} nm away, ${Math.round(ageMinutes)}m ago)`,
      rankScore: 100 + cluster.confidenceScore * 20 - ageMinutes,
    };
  }

  // Case 2: Directional corridor approach
  const podBearing = directionToBearing(cluster.direction);
  if (podBearing === null) {
    // Unknown or milling direction farther away -> only surface low likelihood if nearby (< 6 km)
    if (distanceKm <= 6 && ageMinutes <= 60) {
      const approxEta = Math.max(10, Math.round((distanceNm / Math.max(2, cluster.speedKnots)) * 60));
      return {
        cluster,
        etaMinutes: approxEta,
        etaRangeMinutes: [Math.max(5, Math.round(approxEta * 0.7)), Math.round(approxEta * 1.4)],
        viewingLikelihood: 'low',
        distanceNm,
        alignmentScore: 0.45,
        statusMessage: `${podLabel} milling ${distanceNm} nm away · possible pass in ~${approxEta} min`,
        rankScore: 25 + cluster.confidenceScore * 10 - distanceNm,
      };
    }
    return null;
  }

  const bearingToSpot = bearingDegrees(cluster.lat, cluster.lng, spot.lat, spot.lng);
  const deltaDeg = angularDiffDegrees(podBearing, bearingToSpot);
  const alignment = Math.cos((deltaDeg * Math.PI) / 180);

  // Pod is moving away or perpendicular outside corridor cone (~70 degrees)
  if (alignment < 0.34) return null;

  // Account for travel elapsed since lastSeenAt along heading
  const speedKnots = Math.max(2.0, cluster.speedKnots || 4.5);
  const estimatedTraveledNm = (ageMinutes / 60) * speedKnots * alignment;
  const remainingNm = distanceNm - estimatedTraveledNm;

  // If pod likely already passed more than 2.5 nm ago, skip
  if (remainingNm < -2.5) return null;

  const etaMinutes = Math.max(0, Math.round((Math.max(0, remainingNm) / speedKnots) * 60));
  if (etaMinutes > 180) return null;

  const minEta = Math.max(0, Math.round(etaMinutes * 0.78));
  const maxEta = Math.max(minEta + 5, Math.round(etaMinutes * 1.28));

  const compositeLikelihood =
    alignment * 0.45 +
    cluster.confidenceScore * 0.3 +
    freshnessFactor * 0.25 -
    (etaMinutes > 75 ? 0.2 : 0);

  let viewingLikelihood: ViewingSpotWithEta['viewingLikelihood'] = 'low';
  if (compositeLikelihood >= 0.7 && etaMinutes <= 65) {
    viewingLikelihood = 'high';
  } else if (compositeLikelihood >= 0.5 && etaMinutes <= 110) {
    viewingLikelihood = 'medium';
  }

  const etaPhrase =
    etaMinutes === 0
      ? 'passing now'
      : `~${etaMinutes} min ETA (${minEta}–${maxEta}m)`;

  return {
    cluster,
    etaMinutes,
    etaRangeMinutes: [minEta, maxEta],
    viewingLikelihood,
    distanceNm,
    alignmentScore: Number(alignment.toFixed(2)),
    statusMessage: `${podLabel} heading ${cluster.direction} · ${etaPhrase} (${distanceNm} nm away)`,
    rankScore: compositeLikelihood * 100 - etaMinutes * 0.4,
  };
}

const LIKELIHOOD_ORDER: Record<ViewingSpotWithEta['viewingLikelihood'], number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/**
 * Enriches Puget Sound shore viewing spots with live pod ETAs and viewing likelihood.
 */
export function computeSpotEtas(
  spots: ViewingSpot[],
  clusters: SightingCluster[],
  nowMs = Date.now(),
): ViewingSpotWithEta[] {
  const enriched = spots.map((spot): ViewingSpotWithEta => {
    let best: EtaCandidate | null = null;

    for (const cluster of clusters) {
      const candidate = evaluateClusterForSpot(spot, cluster, nowMs);
      if (candidate && (!best || candidate.rankScore > best.rankScore)) {
        best = candidate;
      }
    }

    if (!best) {
      return {
        ...spot,
        etaMinutes: null,
        etaRangeMinutes: null,
        viewingLikelihood: 'none',
        approachingClusterId: null,
        approachingPod: null,
        approachingEcotype: null,
        approachingDirection: null,
        distanceNm: null,
        alignmentScore: null,
        statusMessage: 'No active pods currently projected toward this viewpoint.',
        beWhaleWiseNote: BE_WHALE_WISE_NOTE,
      };
    }

    return {
      ...spot,
      etaMinutes: best.etaMinutes,
      etaRangeMinutes: best.etaRangeMinutes,
      viewingLikelihood: best.viewingLikelihood,
      approachingClusterId: best.cluster.id,
      approachingPod: best.cluster.pod,
      approachingEcotype: best.cluster.ecotype,
      approachingDirection: best.cluster.direction,
      distanceNm: best.distanceNm,
      alignmentScore: best.alignmentScore,
      statusMessage: best.statusMessage,
      beWhaleWiseNote: BE_WHALE_WISE_NOTE,
    };
  });

  return enriched.sort((a, b) => {
    const likelihoodDiff =
      LIKELIHOOD_ORDER[b.viewingLikelihood] - LIKELIHOOD_ORDER[a.viewingLikelihood];
    if (likelihoodDiff !== 0) return likelihoodDiff;

    const etaA = a.etaMinutes ?? Number.POSITIVE_INFINITY;
    const etaB = b.etaMinutes ?? Number.POSITIVE_INFINITY;
    if (etaA !== etaB) return etaA - etaB;

    return a.name.localeCompare(b.name);
  });
}

/**
 * Evaluates whether a user at (lat, lng) with a preferred alert radiusKm should
 * receive a geofenced push notification right now.
 */
export function evaluateGeofenceAlerts(
  lat: number,
  lng: number,
  radiusKm: number,
  clusters: SightingCluster[],
  spots: ViewingSpot[],
  nowMs = Date.now(),
): AlertEvaluationResult {
  const matchingClusters: AlertEvaluationResult['matchingClusters'] = [];

  for (const cluster of clusters) {
    const ageMin = (nowMs - Date.parse(cluster.lastSeenAt)) / 60_000;
    if (ageMin > 120) continue;

    const distanceKm = Number(
      haversineDistanceKm(lat, lng, cluster.lat, cluster.lng).toFixed(2),
    );

    const syntheticSpot: ViewingSpot = {
      id: 'user-geofence',
      name: 'your location',
      region: 'User Geofence',
      corridor: cluster.corridor,
      lat,
      lng,
      viewingTips: '',
      parkingNotes: '',
      elevation: 'water-level',
      bestDirection: '',
    };

    const etaCandidate = evaluateClusterForSpot(syntheticSpot, cluster, nowMs);
    const inRadius = distanceKm <= radiusKm;
    const approachingSoon =
      etaCandidate !== null &&
      etaCandidate.etaMinutes <= 45 &&
      distanceKm <= radiusKm * 1.8;

    if (inRadius || approachingSoon) {
      matchingClusters.push({
        clusterId: cluster.id,
        locationName: cluster.locationName,
        distanceKm,
        etaMinutes: etaCandidate?.etaMinutes ?? null,
        confidenceTier: cluster.confidenceTier,
        ecotype: cluster.ecotype,
        pod: cluster.pod,
        direction: cluster.direction,
        corroborationCount: cluster.corroborationCount,
        reason: inRadius
          ? `Active sighting within ${distanceKm} km of your ${radiusKm} km alert zone`
          : `Approaching your zone (~${etaCandidate?.etaMinutes} min ETA, heading ${cluster.direction})`,
      });
    }
  }

  matchingClusters.sort((a, b) => a.distanceKm - b.distanceKm);

  const spotsWithEta = computeSpotEtas(spots, clusters, nowMs);
  const nearestHotSpots = spotsWithEta
    .map((spot) => ({
      spotId: spot.id,
      name: spot.name,
      distanceFromUserKm: Number(
        haversineDistanceKm(lat, lng, spot.lat, spot.lng).toFixed(2),
      ),
      etaMinutes: spot.etaMinutes,
      viewingLikelihood: spot.viewingLikelihood,
    }))
    .filter((s) => s.viewingLikelihood !== 'none' || s.distanceFromUserKm <= radiusKm)
    .sort((a, b) => {
      const lDiff =
        LIKELIHOOD_ORDER[b.viewingLikelihood] - LIKELIHOOD_ORDER[a.viewingLikelihood];
      if (lDiff !== 0) return lDiff;
      return a.distanceFromUserKm - b.distanceFromUserKm;
    })
    .slice(0, 3);

  const topMatch = matchingClusters[0] ?? null;
  const highPriority =
    topMatch !== null &&
    (topMatch.confidenceTier === 'corroborated' ||
      topMatch.confidenceTier === 'verified') &&
    (topMatch.distanceKm <= radiusKm || (topMatch.etaMinutes ?? 999) <= 30);

  const severity: AlertEvaluationResult['severity'] = !topMatch
    ? 'none'
    : highPriority
      ? 'high_priority'
      : 'advisory';

  let recommendedTitle: string | null = null;
  let recommendedBody: string | null = null;

  if (topMatch) {
    const podTitle = topMatch.pod
      ? `${topMatch.pod} (${topMatch.ecotype})`
      : topMatch.ecotype !== 'Unknown'
        ? `${topMatch.ecotype} Orcas`
        : 'Orcas';
    const bestSpot = nearestHotSpots[0];

    recommendedTitle =
      severity === 'high_priority'
        ? `Orca Alert: ${podTitle} near ${topMatch.locationName}`
        : `Nearby Report: ${podTitle} (${topMatch.distanceKm} km away)`;

    recommendedBody = bestSpot && bestSpot.etaMinutes !== null
      ? `${topMatch.reason}. Best nearby shore spot: ${bestSpot.name} (${bestSpot.etaMinutes === 0 ? 'visible now' : `~${bestSpot.etaMinutes} min ETA`}).`
      : `${topMatch.reason}. Confidence: ${topMatch.confidenceTier} (${topMatch.corroborationCount} report${topMatch.corroborationCount === 1 ? '' : 's'}).`;
  }

  return {
    query: {
      lat,
      lng,
      radiusKm,
      evaluatedAt: new Date(nowMs).toISOString(),
    },
    shouldAlert: topMatch !== null,
    severity,
    recommendedTitle,
    recommendedBody,
    matchingClusters,
    nearestHotSpots,
  };
}
