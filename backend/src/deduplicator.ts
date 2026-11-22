import { coarsenSrkwCoordinates } from './conservation.ts';
import {
  directionToBearing,
  haversineDistanceKm,
  isWithinPugetSoundBounds,
  angularDiffDegrees,
  bearingDegrees,
} from './geo.ts';
import { parseSightingText } from './nlpParser.ts';
import { inferNearestCorridor } from './pugetSoundCatalog.ts';
import type {
  ConfidenceTier,
  Ecotype,
  RawSightingInput,
  SightingCluster,
  SightingReport,
  SightingSource,
  TravelDirection,
} from './types.ts';

export interface DeduplicatorConfig {
  /** Maximum great-circle distance to merge reports (km). Default: 2.5 */
  maxDistanceKm: number;
  /** Slight forward lookahead distance if the new report lies along the pod's heading (km). Default: 3.5 */
  corridorLookaheadKm: number;
  /** Maximum time delta from cluster's lastSeenAt (minutes). Default: 20 */
  maxTimeDeltaMinutes: number;
}

export interface IngestResult {
  action: 'created' | 'corroborated' | 'duplicate_ignored';
  cluster: SightingCluster;
  report: SightingReport;
}

export interface SightingFilter {
  ecotype?: Ecotype;
  minConfidence?: number | ConfidenceTier;
  hours?: number;
  nowMs?: number;
}

const DEFAULT_CONFIG: DeduplicatorConfig = {
  maxDistanceKm: 2.5,
  corridorLookaheadKm: 3.5,
  maxTimeDeltaMinutes: 20,
};

const SOURCE_TRUST_WEIGHTS: Record<SightingSource, number> = {
  orcasound: 0.94,
  acartia: 0.9,
  orca_network: 0.88,
  citizen: 0.62,
  bluesky: 0.56,
  reddit: 0.54,
  simulator: 0.78,
};

const TIER_RANK: Record<ConfidenceTier, number> = {
  unverified: 0,
  community: 1,
  corroborated: 2,
  verified: 3,
};

export function defaultSpeedForEcotype(
  ecotype: Ecotype,
  direction: TravelDirection,
): number {
  if (direction === 'Milling') return 2.0;
  switch (ecotype) {
    case 'SRKW':
      return 4.5;
    case 'Biggs':
      return 5.5;
    case 'Offshore':
      return 5.0;
    default:
      return 4.5;
  }
}

export function computeConfidenceTier(
  score: number,
  corroborationCount: number,
  sources: SightingSource[],
): ConfidenceTier {
  const hasAuthoritative =
    sources.includes('orcasound') ||
    sources.includes('acartia') ||
    sources.includes('orca_network');

  if (
    corroborationCount >= 4 ||
    (hasAuthoritative && corroborationCount >= 2) ||
    (hasAuthoritative && score >= 0.9)
  ) {
    return 'verified';
  }
  if (corroborationCount >= 2 || hasAuthoritative) {
    return 'corroborated';
  }
  if (score >= 0.45) {
    return 'community';
  }
  return 'unverified';
}

function ecotypesCompatible(a: Ecotype, b: Ecotype): boolean {
  if (a === 'Unknown' || b === 'Unknown') return true;
  return a === b;
}

export class SightingDeduplicator {
  private readonly config: DeduplicatorConfig;
  private readonly clusters: Map<string, SightingCluster> = new Map();
  private readonly seenExternalIds: Map<string, string> = new Map();

  constructor(config: Partial<DeduplicatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Normalizes and ingests a raw sighting event, either merging it into an
   * existing spatio-temporal cluster or creating a new canonical cluster.
   */
  ingest(input: RawSightingInput, nowMs = Date.now()): IngestResult {
    // Idempotency guard on (source, externalId)
    if (input.externalId) {
      const dedupeKey = `${input.source}:${input.externalId}`;
      const existingClusterId = this.seenExternalIds.get(dedupeKey);
      if (existingClusterId) {
        const existingCluster = this.clusters.get(existingClusterId);
        if (existingCluster) {
          const existingReport =
            existingCluster.reports.find((r) => r.externalId === input.externalId) ??
            existingCluster.reports[existingCluster.reports.length - 1];
          return {
            action: 'duplicate_ignored',
            cluster: existingCluster,
            report: existingReport,
          };
        }
      }
    }

    const parsed = input.rawText ? parseSightingText(input.rawText) : null;

    const lat = input.lat ?? parsed?.lat ?? null;
    const lng = input.lng ?? parsed?.lng ?? null;

    if (lat === null || lng === null || !isWithinPugetSoundBounds(lat, lng)) {
      throw new Error(
        'Sighting must include valid Puget Sound coordinates or a recognizable landmark.',
      );
    }

    const observedAtMs = input.observedAt ? Date.parse(input.observedAt) : nowMs;
    const safeObservedAtMs = Number.isFinite(observedAtMs) ? observedAtMs : nowMs;
    const observedAt = new Date(safeObservedAtMs).toISOString();
    const receivedAt = new Date(nowMs).toISOString();

    const direction: TravelDirection =
      input.direction && input.direction !== 'Unknown'
        ? input.direction
        : (parsed?.direction ?? 'Unknown');

    const ecotype: Ecotype =
      input.ecotype && input.ecotype !== 'Unknown'
        ? input.ecotype
        : (parsed?.ecotype ?? 'Unknown');

    const pod = input.pod ?? parsed?.pod ?? null;
    const count = input.count ?? parsed?.count ?? null;
    const behaviors = Array.from(
      new Set([...(input.behaviors ?? []), ...(parsed?.behaviors ?? [])]),
    );

    const trustWeight = Math.min(
      1,
      (SOURCE_TRUST_WEIGHTS[input.source] ?? 0.55) + (input.trustBoost ?? 0),
    );

    const report: SightingReport = {
      id: `rep_${crypto.randomUUID().slice(0, 8)}`,
      source: input.source,
      externalId: input.externalId,
      author: input.author,
      sourceUrl: input.sourceUrl,
      observedAt,
      receivedAt,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      rawText:
        input.rawText?.trim() ||
        `${count ?? 'Orcas'} reported near ${input.locationName ?? parsed?.matchedLandmarkName ?? 'Puget Sound'}`,
      direction,
      ecotype,
      pod,
      count,
      trustWeight,
    };

    const match = this.findMatchingCluster(report, safeObservedAtMs, ecotype);

    if (match) {
      const updated = this.mergeIntoCluster(match, report, behaviors, input.locationName ?? parsed?.matchedLandmarkName ?? null, input.speedKnots);
      if (input.externalId) {
        this.seenExternalIds.set(`${input.source}:${input.externalId}`, updated.id);
      }
      return {
        action: 'corroborated',
        cluster: updated,
        report,
      };
    }

    const inferred = inferNearestCorridor(report.lat, report.lng);
    const locationName =
      input.locationName ??
      parsed?.matchedLandmarkName ??
      `Near ${inferred.nearestLandmark.name}`;

    const baseScore = this.computeClusterScore([report], parsed?.confidenceScore ?? trustWeight);
    const tier = computeConfidenceTier(baseScore, 1, [report.source]);

    const clusterId = `cls_${crypto.randomUUID().slice(0, 8)}`;
    const coarsened = coarsenSrkwCoordinates(report.lat, report.lng, ecotype, clusterId);

    const cluster: SightingCluster = {
      id: clusterId,
      lat: report.lat,
      lng: report.lng,
      displayLat: coarsened.displayLat,
      displayLng: coarsened.displayLng,
      isCoarsened: coarsened.isCoarsened,
      coarseningRadiusMeters: coarsened.coarseningRadiusMeters,
      locationName,
      corridor: parsed?.corridor ?? inferred.corridor,
      direction,
      speedKnots: input.speedKnots ?? defaultSpeedForEcotype(ecotype, direction),
      ecotype,
      pod,
      count,
      behaviors,
      confidenceScore: baseScore,
      confidenceTier: tier,
      corroborationCount: 1,
      sources: [report.source],
      reports: [report],
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      summary: this.buildSummary(ecotype, pod, count, direction, locationName, 1),
    };

    this.clusters.set(cluster.id, cluster);
    if (input.externalId) {
      this.seenExternalIds.set(`${input.source}:${input.externalId}`, cluster.id);
    }

    return {
      action: 'created',
      cluster,
      report,
    };
  }

  private findMatchingCluster(
    report: SightingReport,
    observedAtMs: number,
    ecotype: Ecotype,
  ): SightingCluster | null {
    const maxTimeMs = this.config.maxTimeDeltaMinutes * 60_000;
    let bestCluster: SightingCluster | null = null;
    let bestScore = Infinity;

    for (const cluster of this.clusters.values()) {
      if (!ecotypesCompatible(cluster.ecotype, ecotype)) continue;

      const clusterTimeMs = Date.parse(cluster.lastSeenAt);
      const timeDeltaMs = Math.abs(observedAtMs - clusterTimeMs);
      if (timeDeltaMs > maxTimeMs) continue;

      const distanceKm = haversineDistanceKm(
        cluster.lat,
        cluster.lng,
        report.lat,
        report.lng,
      );

      let withinSpatialWindow = distanceKm <= this.config.maxDistanceKm;

      // Forward corridor lookahead when the pod is actively moving toward the new report
      if (
        !withinSpatialWindow &&
        distanceKm <= this.config.corridorLookaheadKm &&
        observedAtMs >= clusterTimeMs
      ) {
        const podBearing = directionToBearing(cluster.direction);
        if (podBearing !== null) {
          const bearingToNew = bearingDegrees(
            cluster.lat,
            cluster.lng,
            report.lat,
            report.lng,
          );
          if (angularDiffDegrees(podBearing, bearingToNew) <= 35) {
            withinSpatialWindow = true;
          }
        }
      }

      if (!withinSpatialWindow) continue;

      // Rank candidates by combined spatial + temporal proximity
      const proximityScore = distanceKm + timeDeltaMs / (10 * 60_000);
      if (proximityScore < bestScore) {
        bestScore = proximityScore;
        bestCluster = cluster;
      }
    }

    return bestCluster;
  }

  private mergeIntoCluster(
    cluster: SightingCluster,
    report: SightingReport,
    newBehaviors: string[],
    newLocationName: string | null,
    explicitSpeedKnots?: number,
  ): SightingCluster {
    const reports = [...cluster.reports, report].sort(
      (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
    );

    // Recency + source-trust weighted centroid so position tracks pod movement cleanly
    const newestMs = Date.parse(reports[reports.length - 1].observedAt);
    let weightedLat = 0;
    let weightedLng = 0;
    let totalWeight = 0;

    for (const r of reports) {
      const ageMin = Math.max(0, (newestMs - Date.parse(r.observedAt)) / 60_000);
      const recencyFactor = Math.exp(-ageMin / 12);
      const w = r.trustWeight * (0.4 + 0.6 * recencyFactor);
      weightedLat += r.lat * w;
      weightedLng += r.lng * w;
      totalWeight += w;
    }

    const lat = Number((weightedLat / totalWeight).toFixed(5));
    const lng = Number((weightedLng / totalWeight).toFixed(5));

    const ecotype: Ecotype =
      cluster.ecotype !== 'Unknown'
        ? cluster.ecotype
        : report.ecotype !== 'Unknown'
          ? report.ecotype
          : 'Unknown';

    const pod = cluster.pod ?? report.pod ?? null;
    const direction: TravelDirection =
      report.direction !== 'Unknown' ? report.direction : cluster.direction;

    // Prefer the highest non-null count or median of reported counts
    const counts = reports
      .map((r) => r.count)
      .filter((c): c is number => c !== null)
      .sort((a, b) => a - b);
    const count =
      counts.length > 0 ? counts[Math.floor(counts.length / 2)] : cluster.count;

    const sources = Array.from(new Set([...cluster.sources, report.source]));
    const behaviors = Array.from(new Set([...cluster.behaviors, ...newBehaviors]));
    const corroborationCount = reports.length;

    const confidenceScore = this.computeClusterScore(reports, cluster.confidenceScore);
    const confidenceTier = computeConfidenceTier(
      confidenceScore,
      corroborationCount,
      sources,
    );

    const inferred = inferNearestCorridor(lat, lng);
    const locationName =
      Date.parse(report.observedAt) >= Date.parse(cluster.lastSeenAt) && newLocationName
        ? newLocationName
        : cluster.locationName;

    const coarsened = coarsenSrkwCoordinates(lat, lng, ecotype, cluster.id);

    const updated: SightingCluster = {
      ...cluster,
      lat,
      lng,
      displayLat: coarsened.displayLat,
      displayLng: coarsened.displayLng,
      isCoarsened: coarsened.isCoarsened,
      coarseningRadiusMeters: coarsened.coarseningRadiusMeters,
      locationName,
      corridor: inferred.corridor,
      direction,
      speedKnots:
        explicitSpeedKnots ??
        (cluster.speedKnots || defaultSpeedForEcotype(ecotype, direction)),
      ecotype,
      pod,
      count,
      behaviors,
      confidenceScore,
      confidenceTier,
      corroborationCount,
      sources,
      reports,
      firstSeenAt: reports[0].observedAt,
      lastSeenAt: reports[reports.length - 1].observedAt,
      summary: this.buildSummary(
        ecotype,
        pod,
        count,
        direction,
        locationName,
        corroborationCount,
      ),
    };

    this.clusters.set(updated.id, updated);
    return updated;
  }

  private computeClusterScore(
    reports: SightingReport[],
    priorOrParsedScore: number,
  ): number {
    const maxTrust = Math.max(...reports.map((r) => r.trustWeight));
    const uniqueSources = new Set(reports.map((r) => r.source)).size;
    const countBoost = Math.min(0.28, (reports.length - 1) * 0.14);
    const sourceDiversityBoost = Math.min(0.12, (uniqueSources - 1) * 0.06);

    const raw =
      Math.max(maxTrust, priorOrParsedScore * 0.9) + countBoost + sourceDiversityBoost;
    return Number(Math.min(0.99, raw).toFixed(2));
  }

  private buildSummary(
    ecotype: Ecotype,
    pod: string | null,
    count: number | null,
    direction: TravelDirection,
    locationName: string,
    corroborationCount: number,
  ): string {
    const label = pod
      ? `${pod} (${ecotype})`
      : ecotype !== 'Unknown'
        ? `${ecotype} orcas`
        : 'Orcas';
    const countStr = count ? `~${count} ` : '';
    const dirStr =
      direction === 'Milling'
        ? 'milling near'
        : direction !== 'Unknown'
          ? `heading ${direction} past`
          : 'spotted near';
    const corrobStr =
      corroborationCount > 1 ? ` · ${corroborationCount} corroborated reports` : '';
    return `${countStr}${label} ${dirStr} ${locationName}${corrobStr}`.trim();
  }

  getAllClusters(): SightingCluster[] {
    return Array.from(this.clusters.values()).sort(
      (a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
    );
  }

  queryClusters(filter: SightingFilter = {}): SightingCluster[] {
    const nowMs = filter.nowMs ?? Date.now();
    const maxAgeMs =
      filter.hours !== undefined && Number.isFinite(filter.hours)
        ? filter.hours * 3600_000
        : null;

    return this.getAllClusters().filter((cluster) => {
      if (filter.ecotype && cluster.ecotype !== filter.ecotype) {
        return false;
      }

      if (maxAgeMs !== null) {
        const ageMs = nowMs - Date.parse(cluster.lastSeenAt);
        if (ageMs > maxAgeMs) return false;
      }

      if (filter.minConfidence !== undefined) {
        if (typeof filter.minConfidence === 'number') {
          if (cluster.confidenceScore < filter.minConfidence) return false;
        } else {
          if (TIER_RANK[cluster.confidenceTier] < TIER_RANK[filter.minConfidence]) {
            return false;
          }
        }
      }

      return true;
    });
  }

  exportSnapshot(): SightingCluster[] {
    return this.getAllClusters().map((cluster) => ({
      ...cluster,
      behaviors: [...cluster.behaviors],
      sources: [...cluster.sources],
      reports: cluster.reports.map((report) => ({ ...report })),
    }));
  }

  hydrateSnapshot(clusters: SightingCluster[]): void {
    this.clear();
    for (const raw of clusters) {
      const hasCoarsening =
        typeof raw.displayLat === 'number' &&
        typeof raw.displayLng === 'number' &&
        typeof raw.isCoarsened === 'boolean' &&
        typeof raw.coarseningRadiusMeters === 'number';
      const coarsened = hasCoarsening
        ? {
            displayLat: raw.displayLat,
            displayLng: raw.displayLng,
            isCoarsened: raw.isCoarsened,
            coarseningRadiusMeters: raw.coarseningRadiusMeters,
          }
        : coarsenSrkwCoordinates(raw.lat, raw.lng, raw.ecotype, raw.id);

      const cluster: SightingCluster = {
        ...raw,
        ...coarsened,
        behaviors: [...raw.behaviors],
        sources: [...raw.sources],
        reports: raw.reports.map((report) => ({ ...report })),
      };

      this.clusters.set(cluster.id, cluster);
      for (const report of cluster.reports) {
        if (report.externalId) {
          this.seenExternalIds.set(`${report.source}:${report.externalId}`, cluster.id);
        }
      }
    }
  }

  clear(): void {
    this.clusters.clear();
    this.seenExternalIds.clear();
  }
}
