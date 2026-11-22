import { computeSpotEtas } from './etaEngine.ts';
import { haversineDistanceKm } from './geo.ts';
import { PUGET_SOUND_VIEWING_SPOTS } from './pugetSoundCatalog.ts';
import type { SalishPulseRepository } from './repository.ts';
import type {
  AlertDeliveryRecord,
  AlertSubscription,
  ConfidenceTier,
  PushDispatchSummary,
  SightingCluster,
  ViewingSpot,
  ViewingSpotWithEta,
} from './types.ts';

export interface PushDispatcherOptions {
  repository: SalishPulseRepository;
  spots?: ViewingSpot[];
  dryRun?: boolean;
  expoAccessToken?: string;
  expoPushEndpoint?: string;
  cooldownMinutes?: number;
  dailyCap?: number;
  fetchImpl?: typeof fetch;
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: 'orca-alerts';
  data: {
    clusterId: string;
    ecotype: SightingCluster['ecotype'];
    pod: string | null;
    corridor: SightingCluster['corridor'];
    displayLat: number;
    displayLng: number;
    isCoarsened: boolean;
    spotId: string | null;
    etaMinutes: number | null;
  };
}

export interface WebPushFormattedPayload {
  endpoint: string;
  notification: {
    title: string;
    body: string;
    tag: string;
    data: ExpoPushMessage['data'];
  };
}

const CONFIDENCE_RANK: Record<ConfidenceTier, number> = {
  unverified: 0,
  community: 1,
  corroborated: 2,
  verified: 3,
};

const EXPO_BATCH_SIZE = 100;
const DEFAULT_EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

function resolveDefaultDryRun(): boolean {
  const maybeProcess = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  if (maybeProcess?.env) {
    return maybeProcess.env.EXPO_PUSH_LIVE !== 'true';
  }
  return true;
}

/**
 * Extracts the current hour [0..23] in Seattle local time (`America/Los_Angeles`).
 */
export function getSeattleHour(nowMs: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  const formatted = formatter.format(new Date(nowMs));
  const parsed = Number.parseInt(formatted, 10);
  if (!Number.isFinite(parsed)) return 12;
  return parsed % 24;
}

/**
 * Evaluates whether `nowMs` falls inside a subscriber's quiet hours in Seattle local time.
 * Supports overnight windows (e.g., 21 -> 6) and daytime windows (e.g., 13 -> 15).
 */
export function isQuietHoursInSeattle(
  nowMs: number,
  quietStartHour: number,
  quietEndHour: number,
): boolean {
  if (quietStartHour === quietEndHour) return false;
  const hour = getSeattleHour(nowMs);
  if (quietStartHour > quietEndHour) {
    return hour >= quietStartHour || hour < quietEndHour;
  }
  return hour >= quietStartHour && hour < quietEndHour;
}

/**
 * Formats a standardized Web Push notification payload using only coarsened display coordinates.
 */
export function formatWebPushPayload(
  subscription: AlertSubscription,
  cluster: SightingCluster,
  title: string,
  body: string,
  matchedSpot: ViewingSpotWithEta | null,
): WebPushFormattedPayload | null {
  if (!subscription.webPushSubscription?.endpoint) return null;
  return {
    endpoint: subscription.webPushSubscription.endpoint,
    notification: {
      title,
      body,
      tag: `salishpulse-${cluster.id}`,
      data: {
        clusterId: cluster.id,
        ecotype: cluster.ecotype,
        pod: cluster.pod,
        corridor: cluster.corridor,
        displayLat: cluster.displayLat,
        displayLng: cluster.displayLng,
        isCoarsened: cluster.isCoarsened,
        spotId: matchedSpot?.id ?? null,
        etaMinutes: matchedSpot?.etaMinutes ?? null,
      },
    },
  };
}

function buildAlertCopy(
  cluster: SightingCluster,
  matchedSpot: ViewingSpotWithEta | null,
  distanceKm: number | null,
): { title: string; body: string } {
  const podLabel = cluster.pod
    ? `${cluster.pod} (${cluster.ecotype})`
    : cluster.ecotype !== 'Unknown'
      ? `${cluster.ecotype} Orcas`
      : 'Orcas';

  const title = matchedSpot
    ? `Orca Alert: ${podLabel} → ${matchedSpot.name}`
    : `Orca Alert: ${podLabel} near ${cluster.locationName}`;

  const etaPart =
    matchedSpot && matchedSpot.etaMinutes !== null
      ? matchedSpot.etaMinutes === 0
        ? `Active right off ${matchedSpot.name}`
        : `~${matchedSpot.etaMinutes} min ETA to ${matchedSpot.name}`
      : distanceKm !== null
        ? `${distanceKm.toFixed(1)} km from your alert zone`
        : `Spotted in ${cluster.corridor}`;

  const conservationNote =
    cluster.ecotype === 'SRKW'
      ? ' Shore viewing only (WA 1,000-yd SRKW rule).'
      : ' Shore viewing only.';

  return {
    title,
    body: `${etaPart} · heading ${cluster.direction} (${cluster.confidenceTier}).${conservationNote}`,
  };
}

/**
 * Anti-fatigue geofenced push notification dispatcher supporting Expo Push API
 * batching (up to 100 messages per request) and Web Push payload formatting.
 */
export class PushAlertDispatcher {
  private readonly repository: SalishPulseRepository;
  private readonly spots: ViewingSpot[];
  private readonly dryRun: boolean;
  private readonly expoAccessToken?: string;
  private readonly expoPushEndpoint: string;
  private readonly cooldownMinutes: number;
  private readonly dailyCap: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PushDispatcherOptions) {
    this.repository = options.repository;
    this.spots = options.spots ?? PUGET_SOUND_VIEWING_SPOTS;
    this.dryRun = options.dryRun ?? resolveDefaultDryRun();
    this.expoAccessToken = options.expoAccessToken;
    this.expoPushEndpoint = options.expoPushEndpoint ?? DEFAULT_EXPO_ENDPOINT;
    this.cooldownMinutes = options.cooldownMinutes ?? 45;
    this.dailyCap = options.dailyCap ?? 4;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isDryRun(): boolean {
    return this.dryRun;
  }

  async dispatchForCluster(
    cluster: SightingCluster,
    nowMs = Date.now(),
  ): Promise<PushDispatchSummary> {
    const subscriptions = await this.repository.listSubscriptions(true);
    const suppressedReasons: Record<string, number> = {};
    const bumpSuppressed = (reason: string) => {
      suppressedReasons[reason] = (suppressedReasons[reason] ?? 0) + 1;
    };

    const spotsWithEta = computeSpotEtas(this.spots, [cluster], nowMs);
    const spotById = new Map<string, ViewingSpotWithEta>(
      spotsWithEta.map((s) => [s.id, s]),
    );

    const eligibleTargets: Array<{
      subscription: AlertSubscription;
      matchedSpot: ViewingSpotWithEta | null;
      distanceKm: number | null;
      title: string;
      body: string;
    }> = [];

    const dayAgoIso = new Date(nowMs - 24 * 3600_000).toISOString();
    const cooldownCutoffMs = nowMs - this.cooldownMinutes * 60_000;

    for (const sub of subscriptions) {
      // 1. Confidence tier gate
      if (CONFIDENCE_RANK[cluster.confidenceTier] < CONFIDENCE_RANK[sub.minConfidence]) {
        bumpSuppressed('confidence_below_threshold');
        continue;
      }

      // 2. Ecotype filter
      if (sub.ecotypes.length > 0 && !sub.ecotypes.includes(cluster.ecotype)) {
        bumpSuppressed('ecotype_filtered');
        continue;
      }

      // 3. Quiet hours check in Seattle (America/Los_Angeles)
      if (
        sub.quietHoursEnabled &&
        isQuietHoursInSeattle(nowMs, sub.quietStartHour, sub.quietEndHour)
      ) {
        bumpSuppressed('quiet_hours');
        continue;
      }

      // 4. Spatial / Favorite-beach ETA matching
      let matchedSpot: ViewingSpotWithEta | null = null;
      for (const spotId of sub.favoriteSpotIds) {
        const candidate = spotById.get(spotId);
        if (
          candidate &&
          candidate.approachingClusterId === cluster.id &&
          candidate.etaMinutes !== null &&
          candidate.etaMinutes <= sub.maxEtaMinutes
        ) {
          if (
            !matchedSpot ||
            (matchedSpot.etaMinutes ?? Infinity) > candidate.etaMinutes
          ) {
            matchedSpot = candidate;
          }
        }
      }

      let distanceKm: number | null = null;
      let withinGeofence = false;
      if (
        typeof sub.homeLat === 'number' &&
        typeof sub.homeLng === 'number' &&
        Number.isFinite(sub.homeLat) &&
        Number.isFinite(sub.homeLng)
      ) {
        distanceKm = haversineDistanceKm(
          sub.homeLat,
          sub.homeLng,
          cluster.lat,
          cluster.lng,
        );
        withinGeofence = distanceKm <= sub.radiusKm;
      }

      if (!matchedSpot && !withinGeofence) {
        bumpSuppressed('out_of_range');
        continue;
      }

      // 5. Anti-fatigue: 45-min per-cluster cooldown & max-4/day cap
      const recent = await this.repository.getRecentDeliveries(sub.id, dayAgoIso);
      const effectiveDeliveries = recent.filter(
        (d) => d.status === 'sent' || d.status === 'dry_run',
      );

      const inCooldown = effectiveDeliveries.some(
        (d) =>
          d.clusterId === cluster.id && Date.parse(d.sentAt) >= cooldownCutoffMs,
      );
      if (inCooldown) {
        bumpSuppressed('cluster_cooldown');
        continue;
      }

      if (effectiveDeliveries.length >= this.dailyCap) {
        bumpSuppressed('daily_cap');
        continue;
      }

      const copy = buildAlertCopy(cluster, matchedSpot, distanceKm);
      eligibleTargets.push({
        subscription: sub,
        matchedSpot,
        distanceKm,
        title: copy.title,
        body: copy.body,
      });
    }

    const deliveries: AlertDeliveryRecord[] = [];
    let sentCount = 0;
    let dryRunCount = 0;
    let failedCount = 0;

    const expoTargets = eligibleTargets.filter(
      (t) => t.subscription.channel === 'expo' && Boolean(t.subscription.pushToken),
    );
    const webTargets = eligibleTargets.filter(
      (t) => t.subscription.channel === 'web_push',
    );

    // Send Expo Push messages in chunks of up to 100
    for (let i = 0; i < expoTargets.length; i += EXPO_BATCH_SIZE) {
      const chunk = expoTargets.slice(i, i + EXPO_BATCH_SIZE);
      const messages: ExpoPushMessage[] = chunk.map((target) => ({
        to: target.subscription.pushToken!,
        title: target.title,
        body: target.body,
        sound: 'default',
        priority: 'high',
        channelId: 'orca-alerts',
        data: {
          clusterId: cluster.id,
          ecotype: cluster.ecotype,
          pod: cluster.pod,
          corridor: cluster.corridor,
          displayLat: cluster.displayLat,
          displayLng: cluster.displayLng,
          isCoarsened: cluster.isCoarsened,
          spotId: target.matchedSpot?.id ?? null,
          etaMinutes: target.matchedSpot?.etaMinutes ?? null,
        },
      }));

      let chunkError: string | undefined;
      let status: AlertDeliveryRecord['status'] = this.dryRun ? 'dry_run' : 'sent';

      if (!this.dryRun) {
        try {
          const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          };
          if (this.expoAccessToken) {
            headers.Authorization = `Bearer ${this.expoAccessToken}`;
          }

          const response = await this.fetchImpl(this.expoPushEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(messages),
          });
          if (!response.ok) {
            status = 'failed';
            chunkError = `Expo Push HTTP ${response.status}`;
          }
        } catch (err) {
          status = 'failed';
          chunkError = err instanceof Error ? err.message : String(err);
        }
      }

      for (const target of chunk) {
        const record: AlertDeliveryRecord = {
          id: `dlv_${crypto.randomUUID().slice(0, 8)}`,
          subscriptionId: target.subscription.id,
          clusterId: cluster.id,
          channel: 'expo',
          title: target.title,
          body: target.body,
          sentAt: new Date(nowMs).toISOString(),
          status,
          error: chunkError,
        };
        await this.repository.recordAlertDelivery(record);
        deliveries.push(record);
        if (status === 'sent') sentCount += 1;
        else if (status === 'dry_run') dryRunCount += 1;
        else failedCount += 1;
      }
    }

    // Format and dispatch Web Push payloads
    for (const target of webTargets) {
      const formatted = formatWebPushPayload(
        target.subscription,
        cluster,
        target.title,
        target.body,
        target.matchedSpot,
      );

      let status: AlertDeliveryRecord['status'] = this.dryRun ? 'dry_run' : 'sent';
      let error: string | undefined;

      if (!formatted) {
        status = 'failed';
        error = 'Missing Web Push subscription endpoint';
      } else if (!this.dryRun) {
        // Production Web Push requires VAPID-signed encrypted payload; when VAPID keys
        // are configured at the edge, relay via signed push endpoint or mark dry_run.
        try {
          const response = await this.fetchImpl(formatted.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              TTL: '900',
            },
            body: JSON.stringify(formatted.notification),
          });
          if (!response.ok) {
            status = 'failed';
            error = `Web Push HTTP ${response.status}`;
          }
        } catch (err) {
          status = 'failed';
          error = err instanceof Error ? err.message : String(err);
        }
      }

      const record: AlertDeliveryRecord = {
        id: `dlv_${crypto.randomUUID().slice(0, 8)}`,
        subscriptionId: target.subscription.id,
        clusterId: cluster.id,
        channel: 'web_push',
        title: target.title,
        body: target.body,
        sentAt: new Date(nowMs).toISOString(),
        status,
        error,
      };
      await this.repository.recordAlertDelivery(record);
      deliveries.push(record);
      if (status === 'sent') sentCount += 1;
      else if (status === 'dry_run') dryRunCount += 1;
      else failedCount += 1;
    }

    return {
      clusterId: cluster.id,
      evaluatedSubscriptions: subscriptions.length,
      eligibleCount: eligibleTargets.length,
      sentCount,
      dryRunCount,
      failedCount,
      suppressedReasons,
      deliveries,
    };
  }
}
