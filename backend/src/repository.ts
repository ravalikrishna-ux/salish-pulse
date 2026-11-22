import type {
  AlertDeliveryRecord,
  AlertSubscription,
  ConfidenceTier,
  Ecotype,
  PugetSoundCorridor,
  SightingCluster,
  SightingReport,
  SightingSource,
  TravelDirection,
  WebPushSubscriptionPayload,
} from './types.ts';

export interface SalishPulseRepository {
  saveCluster(cluster: SightingCluster): Promise<void>;
  listActiveClusters(hours?: number, nowMs?: number): Promise<SightingCluster[]>;
  saveSubscription(subscription: AlertSubscription): Promise<AlertSubscription>;
  deleteSubscription(id: string): Promise<boolean>;
  listSubscriptions(activeOnly?: boolean): Promise<AlertSubscription[]>;
  recordAlertDelivery(record: AlertDeliveryRecord): Promise<void>;
  getRecentDeliveries(
    subscriptionId: string,
    sinceIso: string,
  ): Promise<AlertDeliveryRecord[]>;
}

/**
 * Default zero-config in-memory repository used for local development and automated tests.
 */
export class InMemoryRepository implements SalishPulseRepository {
  private readonly clusters = new Map<string, SightingCluster>();
  private readonly subscriptions = new Map<string, AlertSubscription>();
  private readonly deliveries: AlertDeliveryRecord[] = [];

  async saveCluster(cluster: SightingCluster): Promise<void> {
    this.clusters.set(cluster.id, {
      ...cluster,
      behaviors: [...cluster.behaviors],
      sources: [...cluster.sources],
      reports: cluster.reports.map((r) => ({ ...r })),
    });
  }

  async listActiveClusters(
    hours = 12,
    nowMs = Date.now(),
  ): Promise<SightingCluster[]> {
    const cutoffMs = nowMs - hours * 3600_000;
    return Array.from(this.clusters.values())
      .filter((c) => Date.parse(c.lastSeenAt) >= cutoffMs)
      .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
      .map((c) => ({
        ...c,
        behaviors: [...c.behaviors],
        sources: [...c.sources],
        reports: c.reports.map((r) => ({ ...r })),
      }));
  }

  async saveSubscription(
    subscription: AlertSubscription,
  ): Promise<AlertSubscription> {
    const copy: AlertSubscription = {
      ...subscription,
      favoriteSpotIds: [...subscription.favoriteSpotIds],
      ecotypes: [...subscription.ecotypes],
      webPushSubscription: subscription.webPushSubscription
        ? {
            endpoint: subscription.webPushSubscription.endpoint,
            keys: { ...subscription.webPushSubscription.keys },
          }
        : undefined,
    };
    this.subscriptions.set(copy.id, copy);
    return { ...copy };
  }

  async deleteSubscription(id: string): Promise<boolean> {
    return this.subscriptions.delete(id);
  }

  async listSubscriptions(activeOnly = true): Promise<AlertSubscription[]> {
    const all = Array.from(this.subscriptions.values());
    const filtered = activeOnly ? all.filter((s) => s.active) : all;
    return filtered.map((s) => ({
      ...s,
      favoriteSpotIds: [...s.favoriteSpotIds],
      ecotypes: [...s.ecotypes],
    }));
  }

  async recordAlertDelivery(record: AlertDeliveryRecord): Promise<void> {
    this.deliveries.push({ ...record });
  }

  async getRecentDeliveries(
    subscriptionId: string,
    sinceIso: string,
  ): Promise<AlertDeliveryRecord[]> {
    const sinceMs = Date.parse(sinceIso);
    return this.deliveries
      .filter(
        (d) =>
          d.subscriptionId === subscriptionId && Date.parse(d.sentAt) >= sinceMs,
      )
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
      .map((d) => ({ ...d }));
  }
}

export interface SupabaseRestRepositoryConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface SupabaseClusterRow {
  id: string;
  lat: number;
  lng: number;
  display_lat: number;
  display_lng: number;
  is_coarsened: boolean;
  coarsening_radius_meters: number;
  location_name: string;
  corridor: PugetSoundCorridor;
  direction: TravelDirection;
  speed_knots: number;
  ecotype: Ecotype;
  pod: string | null;
  count: number | null;
  behaviors: string[] | null;
  confidence_score: number;
  confidence_tier: ConfidenceTier;
  corroboration_count: number;
  sources: SightingSource[] | null;
  first_seen_at: string;
  last_seen_at: string;
  summary: string;
  sighting_reports?: SupabaseReportRow[];
}

interface SupabaseReportRow {
  id: string;
  cluster_id: string;
  source: SightingSource;
  external_id: string | null;
  author: string | null;
  source_url: string | null;
  raw_text: string;
  lat: number;
  lng: number;
  direction: TravelDirection;
  ecotype: Ecotype;
  pod: string | null;
  count: number | null;
  observed_at: string;
  received_at: string;
  trust_weight: number;
}

interface SupabaseSubscriptionRow {
  id: string;
  channel: 'expo' | 'web_push';
  push_token: string | null;
  web_push_json: WebPushSubscriptionPayload | null;
  favorite_spot_ids: string[] | null;
  home_lat: number | null;
  home_lng: number | null;
  radius_km: number;
  max_eta_minutes: number;
  min_confidence: ConfidenceTier;
  ecotypes: Ecotype[] | null;
  quiet_hours_enabled: boolean;
  quiet_start_hour: number;
  quiet_end_hour: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface SupabaseDeliveryRow {
  id: string;
  subscription_id: string;
  cluster_id: string;
  channel: 'expo' | 'web_push';
  title: string;
  body: string;
  sent_at: string;
  status: 'sent' | 'dry_run' | 'failed';
  error: string | null;
}

function mapReportRow(row: SupabaseReportRow): SightingReport {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id ?? undefined,
    author: row.author ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    observedAt: row.observed_at,
    receivedAt: row.received_at,
    lat: row.lat,
    lng: row.lng,
    rawText: row.raw_text,
    direction: row.direction,
    ecotype: row.ecotype,
    pod: row.pod,
    count: row.count,
    trustWeight: row.trust_weight,
  };
}

function mapClusterRow(row: SupabaseClusterRow): SightingCluster {
  return {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    displayLat: row.display_lat,
    displayLng: row.display_lng,
    isCoarsened: row.is_coarsened,
    coarseningRadiusMeters: row.coarsening_radius_meters,
    locationName: row.location_name,
    corridor: row.corridor,
    direction: row.direction,
    speedKnots: row.speed_knots,
    ecotype: row.ecotype,
    pod: row.pod,
    count: row.count,
    behaviors: row.behaviors ?? [],
    confidenceScore: row.confidence_score,
    confidenceTier: row.confidence_tier,
    corroborationCount: row.corroboration_count,
    sources: row.sources ?? [],
    reports: (row.sighting_reports ?? []).map(mapReportRow),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    summary: row.summary,
  };
}

function mapSubscriptionRow(row: SupabaseSubscriptionRow): AlertSubscription {
  return {
    id: row.id,
    channel: row.channel,
    pushToken: row.push_token ?? undefined,
    webPushSubscription: row.web_push_json ?? undefined,
    favoriteSpotIds: row.favorite_spot_ids ?? [],
    homeLat: row.home_lat ?? undefined,
    homeLng: row.home_lng ?? undefined,
    radiusKm: row.radius_km,
    maxEtaMinutes: row.max_eta_minutes,
    minConfidence: row.min_confidence,
    ecotypes: row.ecotypes ?? ['SRKW', 'Biggs', 'Offshore', 'Unknown'],
    quietHoursEnabled: row.quiet_hours_enabled,
    quietStartHour: row.quiet_start_hour,
    quietEndHour: row.quiet_end_hour,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeliveryRow(row: SupabaseDeliveryRow): AlertDeliveryRecord {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    clusterId: row.cluster_id,
    channel: row.channel,
    title: row.title,
    body: row.body,
    sentAt: row.sent_at,
    status: row.status,
    error: row.error ?? undefined,
  };
}

/**
 * Zero-dependency Supabase PostgREST + PostGIS RPC repository over native `fetch`.
 * Runs identically on Node 22 and Cloudflare Workers.
 */
export class SupabaseRestRepository implements SalishPulseRepository {
  private readonly restBaseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: SupabaseRestRepositoryConfig) {
    this.restBaseUrl = `${config.supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
    this.serviceRoleKey = config.serviceRoleKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.restBaseUrl}${path}`, {
        ...init,
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Supabase PostgREST HTTP ${response.status}: ${text || response.statusText}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const raw = await response.text();
      if (!raw) return undefined as T;
      return JSON.parse(raw) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async saveCluster(cluster: SightingCluster): Promise<void> {
    const clusterPayload = {
      id: cluster.id,
      lat: cluster.lat,
      lng: cluster.lng,
      display_lat: cluster.displayLat,
      display_lng: cluster.displayLng,
      is_coarsened: cluster.isCoarsened,
      coarsening_radius_meters: cluster.coarseningRadiusMeters,
      location_name: cluster.locationName,
      corridor: cluster.corridor,
      direction: cluster.direction,
      speed_knots: cluster.speedKnots,
      ecotype: cluster.ecotype,
      pod: cluster.pod,
      count: cluster.count,
      behaviors: cluster.behaviors,
      confidence_score: cluster.confidenceScore,
      confidence_tier: cluster.confidenceTier,
      corroboration_count: cluster.corroborationCount,
      sources: cluster.sources,
      first_seen_at: cluster.firstSeenAt,
      last_seen_at: cluster.lastSeenAt,
      summary: cluster.summary,
      updated_at: new Date().toISOString(),
    };

    await this.request('/sighting_clusters?on_conflict=id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(clusterPayload),
    });

    if (cluster.reports.length > 0) {
      const reportsPayload = cluster.reports.map((report) => ({
        id: report.id,
        cluster_id: cluster.id,
        source: report.source,
        external_id: report.externalId ?? null,
        author: report.author ?? null,
        source_url: report.sourceUrl ?? null,
        raw_text: report.rawText,
        lat: report.lat,
        lng: report.lng,
        direction: report.direction,
        ecotype: report.ecotype,
        pod: report.pod,
        count: report.count,
        observed_at: report.observedAt,
        received_at: report.receivedAt,
        trust_weight: report.trustWeight,
      }));

      await this.request('/sighting_reports?on_conflict=id', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(reportsPayload),
      });
    }
  }

  async listActiveClusters(
    hours = 12,
    nowMs = Date.now(),
  ): Promise<SightingCluster[]> {
    const cutoffIso = new Date(nowMs - hours * 3600_000).toISOString();
    const query =
      `/sighting_clusters?select=*,sighting_reports(*)` +
      `&last_seen_at=gte.${encodeURIComponent(cutoffIso)}` +
      `&order=last_seen_at.desc&limit=200`;

    const rows = await this.request<SupabaseClusterRow[]>(query, {
      method: 'GET',
    });
    return (rows ?? []).map(mapClusterRow);
  }

  async saveSubscription(
    subscription: AlertSubscription,
  ): Promise<AlertSubscription> {
    const payload = {
      id: subscription.id,
      channel: subscription.channel,
      push_token: subscription.pushToken ?? null,
      web_push_json: subscription.webPushSubscription ?? null,
      favorite_spot_ids: subscription.favoriteSpotIds,
      home_lat: subscription.homeLat ?? null,
      home_lng: subscription.homeLng ?? null,
      radius_km: subscription.radiusKm,
      max_eta_minutes: subscription.maxEtaMinutes,
      min_confidence: subscription.minConfidence,
      ecotypes: subscription.ecotypes,
      quiet_hours_enabled: subscription.quietHoursEnabled,
      quiet_start_hour: subscription.quietStartHour,
      quiet_end_hour: subscription.quietEndHour,
      active: subscription.active,
      created_at: subscription.createdAt,
      updated_at: subscription.updatedAt,
    };

    const rows = await this.request<SupabaseSubscriptionRow[]>(
      '/alert_subscriptions?on_conflict=id',
      {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(payload),
      },
    );

    return rows && rows[0] ? mapSubscriptionRow(rows[0]) : subscription;
  }

  async deleteSubscription(id: string): Promise<boolean> {
    const rows = await this.request<Array<{ id: string }>>(
      `/alert_subscriptions?id=eq.${encodeURIComponent(id)}&select=id`,
      {
        method: 'DELETE',
        headers: {
          Prefer: 'return=representation',
        },
      },
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  async listSubscriptions(activeOnly = true): Promise<AlertSubscription[]> {
    const filter = activeOnly ? '&active=eq.true' : '';
    const rows = await this.request<SupabaseSubscriptionRow[]>(
      `/alert_subscriptions?select=*${filter}&order=created_at.desc`,
      { method: 'GET' },
    );
    return (rows ?? []).map(mapSubscriptionRow);
  }

  async recordAlertDelivery(record: AlertDeliveryRecord): Promise<void> {
    await this.request('/alert_deliveries', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: record.id,
        subscription_id: record.subscriptionId,
        cluster_id: record.clusterId,
        channel: record.channel,
        title: record.title,
        body: record.body,
        sent_at: record.sentAt,
        status: record.status,
        error: record.error ?? null,
      }),
    });
  }

  async getRecentDeliveries(
    subscriptionId: string,
    sinceIso: string,
  ): Promise<AlertDeliveryRecord[]> {
    const query =
      `/alert_deliveries?select=*` +
      `&subscription_id=eq.${encodeURIComponent(subscriptionId)}` +
      `&sent_at=gte.${encodeURIComponent(sinceIso)}` +
      `&order=sent_at.desc`;
    const rows = await this.request<SupabaseDeliveryRow[]>(query, {
      method: 'GET',
    });
    return (rows ?? []).map(mapDeliveryRow);
  }

  /**
   * Invokes the PostGIS `find_eligible_alert_subscribers` RPC directly for
   * high-scale subscriber fanout without pulling all subscriptions into memory.
   */
  async findEligibleSubscribersRpc(params: {
    lat: number;
    lng: number;
    ecotype: Ecotype;
    confidenceTier: ConfidenceTier;
    clusterId: string;
    cooldownMinutes?: number;
    dailyCap?: number;
  }): Promise<AlertSubscription[]> {
    const rows = await this.request<SupabaseSubscriptionRow[]>(
      '/rpc/find_eligible_alert_subscribers',
      {
        method: 'POST',
        body: JSON.stringify({
          p_lat: params.lat,
          p_lng: params.lng,
          p_ecotype: params.ecotype,
          p_confidence_tier: params.confidenceTier,
          p_cluster_id: params.clusterId,
          p_cooldown_minutes: params.cooldownMinutes ?? 45,
          p_daily_cap: params.dailyCap ?? 4,
        }),
      },
    );
    return (rows ?? []).map((row) =>
      mapSubscriptionRow({
        ...row,
        active: true,
        created_at: row.created_at ?? new Date().toISOString(),
        updated_at: row.updated_at ?? new Date().toISOString(),
      }),
    );
  }
}
