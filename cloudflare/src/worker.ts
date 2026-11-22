import {
  AcartiaConnector,
  OrcasoundConnector,
  RedditJsonConnector,
} from '../../backend/src/connectors.ts';
import type { OrcaHelloDetectionPayload } from '../../backend/src/connectors.ts';
import { ConservationFreezeController } from '../../backend/src/conservation.ts';
import { SightingDeduplicator } from '../../backend/src/deduplicator.ts';
import { computeSpotEtas, evaluateGeofenceAlerts } from '../../backend/src/etaEngine.ts';
import { isWithinPugetSoundBounds } from '../../backend/src/geo.ts';
import {
  HttpLlmExtractorAdapter,
  parseSightingWithFallback,
} from '../../backend/src/nlpParser.ts';
import type { LlmExtractorAdapter } from '../../backend/src/nlpParser.ts';
import {
  PUGET_SOUND_VIEWING_SPOTS,
  createInitialHydrophones,
} from '../../backend/src/pugetSoundCatalog.ts';
import { PushAlertDispatcher } from '../../backend/src/pushDispatcher.ts';
import {
  InMemoryRepository,
  SupabaseRestRepository,
} from '../../backend/src/repository.ts';
import type { SalishPulseRepository } from '../../backend/src/repository.ts';
import type {
  AlertSubscription,
  ConfidenceTier,
  ConservationFreezeStatus,
  Ecotype,
  HydrophoneNode,
  PugetSoundCorridor,
  RawSightingInput,
  SightingCluster,
  SightingSource,
  StreamEventType,
  TravelDirection,
  WebPushSubscriptionPayload,
} from '../../backend/src/types.ts';
import { SightingHubDO } from './SightingHubDO.ts';

export { SightingHubDO };

export interface IngestQueueMessage {
  kind: 'sighting' | 'social';
  input: RawSightingInput;
  enqueuedAt: string;
}

export interface Env {
  HOT_CACHE: KVNamespace;
  SIGHTING_HUB: DurableObjectNamespace;
  INGEST_QUEUE: Queue<IngestQueueMessage>;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ACARTIA_API_TOKEN?: string;
  LLM_API_KEY?: string;
  LLM_PROVIDER?: 'openai' | 'gemini';
  LLM_MODEL?: string;
  ADMIN_FREEZE_TOKEN?: string;
  EXPO_ACCESS_TOKEN?: string;
  EXPO_PUSH_LIVE?: string;
}

const KV_CLUSTERS_KEY = 'salishpulse:clusters:v1';
const KV_HYDROPHONES_KEY = 'salishpulse:hydrophones:v1';
const KV_FREEZE_KEY = 'salishpulse:conservation_freeze:v1';
const KV_SUBSCRIPTIONS_KEY = 'salishpulse:subscriptions:v1';

const SWR_CACHE_HEADER = 'public, max-age=5, stale-while-revalidate=30';

const VALID_ECOTYPES = new Set<Ecotype>(['SRKW', 'Biggs', 'Offshore', 'Unknown']);
const VALID_TIERS = new Set<ConfidenceTier>([
  'unverified',
  'community',
  'corroborated',
  'verified',
]);
const VALID_SOURCES = new Set<SightingSource>([
  'acartia',
  'orcasound',
  'bluesky',
  'reddit',
  'orca_network',
  'citizen',
  'simulator',
]);
const VALID_DIRECTIONS = new Set<TravelDirection>([
  'N',
  'NE',
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'Milling',
  'Unknown',
]);
const VALID_CORRIDORS = new Set<PugetSoundCorridor>([
  'Admiralty Inlet',
  'Main Basin',
  'Elliott Bay',
  'East Passage',
  'Colvos Passage',
  'South Sound',
  'San Juan Islands',
  'Possession Sound',
]);

function corsHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID',
    ...extra,
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    }),
  });
}

function createRepository(env: Env): SalishPulseRepository {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseRestRepository({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }
  return new InMemoryRepository();
}

function createLlmAdapter(env: Env): LlmExtractorAdapter | undefined {
  if (!env.LLM_API_KEY) return undefined;
  return new HttpLlmExtractorAdapter({
    provider: env.LLM_PROVIDER === 'openai' ? 'openai' : 'gemini',
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
  });
}

async function loadFreezeController(env: Env): Promise<ConservationFreezeController> {
  const stored = await env.HOT_CACHE.get<ConservationFreezeStatus>(KV_FREEZE_KEY, 'json');
  return new ConservationFreezeController(stored ?? undefined);
}

async function loadClusters(env: Env, repo: SalishPulseRepository): Promise<SightingCluster[]> {
  const cached = await env.HOT_CACHE.get<SightingCluster[]>(KV_CLUSTERS_KEY, 'json');
  if (Array.isArray(cached)) {
    return cached;
  }
  const fromRepo = await repo.listActiveClusters(12).catch(() => []);
  if (fromRepo.length > 0) {
    await env.HOT_CACHE.put(KV_CLUSTERS_KEY, JSON.stringify(fromRepo), {
      expirationTtl: 600,
    });
  }
  return fromRepo;
}

async function loadHydrophones(env: Env): Promise<HydrophoneNode[]> {
  const cached = await env.HOT_CACHE.get<HydrophoneNode[]>(KV_HYDROPHONES_KEY, 'json');
  if (Array.isArray(cached) && cached.length > 0) {
    return cached;
  }
  return createInitialHydrophones();
}

async function broadcastToHub(
  env: Env,
  type: StreamEventType,
  data: unknown,
): Promise<void> {
  const id = env.SIGHTING_HUB.idFromName('puget-sound-main');
  const stub = env.SIGHTING_HUB.get(id);
  await stub.fetch('https://sighting-hub.internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data }),
  });
}

function parseWebPushPayload(raw: unknown): WebPushSubscriptionPayload | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const keys = obj.keys as Record<string, unknown> | undefined;
  if (
    typeof obj.endpoint !== 'string' ||
    !obj.endpoint.trim() ||
    typeof keys?.p256dh !== 'string' ||
    typeof keys?.auth !== 'string'
  ) {
    return undefined;
  }
  return {
    endpoint: obj.endpoint.trim(),
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

const worker: ExportedHandler<Env, IngestQueueMessage> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const repo = createRepository(env);

    try {
      // 1. GET /api/stream -> Direct forward to regional SIGHTING_HUB Durable Object
      if (request.method === 'GET' && pathname === '/api/stream') {
        const hubId = env.SIGHTING_HUB.idFromName('puget-sound-main');
        const stub = env.SIGHTING_HUB.get(hubId);
        return stub.fetch(request);
      }

      // 2. GET /api/health
      if (request.method === 'GET' && pathname === '/api/health') {
        const [clusters, freeze] = await Promise.all([
          loadClusters(env, repo),
          loadFreezeController(env),
        ]);
        const freezeStatus = freeze.getStatus();
        const publicClusters = clusters.filter((c) => !freeze.isClusterFrozen(c));

        return jsonResponse({
          status: 'ok',
          service: 'salishpulse-edge',
          runtime: 'cloudflare-workers',
          activeClusters: clusters.length,
          publicClusters: publicClusters.length,
          conservationFreezeActive: freezeStatus.active,
          supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
          llmFallbackEnabled: Boolean(env.LLM_API_KEY),
          pushDryRun: env.EXPO_PUSH_LIVE !== 'true',
          timestamp: new Date().toISOString(),
        });
      }

      // 3. GET /api/sightings (5s SWR edge cache)
      if (request.method === 'GET' && pathname === '/api/sightings') {
        const [allClusters, freeze] = await Promise.all([
          loadClusters(env, repo),
          loadFreezeController(env),
        ]);
        const deduplicator = new SightingDeduplicator();
        deduplicator.hydrateSnapshot(allClusters);

        const ecotypeParam = url.searchParams.get('ecotype');
        const minConfParam = url.searchParams.get('minConfidence');
        const hoursParam = url.searchParams.get('hours');

        const ecotype =
          ecotypeParam && VALID_ECOTYPES.has(ecotypeParam as Ecotype)
            ? (ecotypeParam as Ecotype)
            : undefined;
        let minConfidence: number | ConfidenceTier | undefined;
        if (minConfParam) {
          if (VALID_TIERS.has(minConfParam as ConfidenceTier)) {
            minConfidence = minConfParam as ConfidenceTier;
          } else {
            const num = Number(minConfParam);
            if (Number.isFinite(num)) minConfidence = num;
          }
        }
        const hours = hoursParam ? Number(hoursParam) : undefined;

        const filtered = deduplicator
          .queryClusters({
            ecotype,
            minConfidence,
            hours: hours !== undefined && Number.isFinite(hours) ? hours : undefined,
          })
          .filter((c) => !freeze.isClusterFrozen(c));

        return jsonResponse(
          {
            count: filtered.length,
            sightings: filtered,
            conservationFreeze: freeze.getStatus(),
            generatedAt: new Date().toISOString(),
          },
          200,
          { 'Cache-Control': SWR_CACHE_HEADER },
        );
      }

      // 4. GET /api/spots (5s SWR edge cache)
      if (request.method === 'GET' && pathname === '/api/spots') {
        const [allClusters, freeze] = await Promise.all([
          loadClusters(env, repo),
          loadFreezeController(env),
        ]);
        const publicClusters = allClusters.filter((c) => !freeze.isClusterFrozen(c));
        const spots = computeSpotEtas(PUGET_SOUND_VIEWING_SPOTS, publicClusters);

        return jsonResponse(
          {
            count: spots.length,
            spots,
            generatedAt: new Date().toISOString(),
          },
          200,
          { 'Cache-Control': SWR_CACHE_HEADER },
        );
      }

      // 5. GET /api/hydrophones (5s SWR edge cache)
      if (request.method === 'GET' && pathname === '/api/hydrophones') {
        const hydrophones = await loadHydrophones(env);
        return jsonResponse(
          {
            count: hydrophones.length,
            hydrophones,
            generatedAt: new Date().toISOString(),
          },
          200,
          { 'Cache-Control': SWR_CACHE_HEADER },
        );
      }

      // 6. GET /api/alerts/evaluate
      if (request.method === 'GET' && pathname === '/api/alerts/evaluate') {
        const lat = Number(url.searchParams.get('lat'));
        const lng = Number(url.searchParams.get('lng'));
        const radiusRaw = url.searchParams.get('radiusKm');
        const radiusKm = radiusRaw ? Number(radiusRaw) : 10;

        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isWithinPugetSoundBounds(lat, lng)) {
          return jsonResponse(
            { error: 'Query params "lat" and "lng" must be valid Puget Sound coordinates.' },
            400,
          );
        }
        if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
          return jsonResponse(
            { error: 'Query param "radiusKm" must be between 0 and 100.' },
            400,
          );
        }

        const [allClusters, freeze] = await Promise.all([
          loadClusters(env, repo),
          loadFreezeController(env),
        ]);
        const publicClusters = allClusters.filter((c) => !freeze.isClusterFrozen(c));
        const evaluation = evaluateGeofenceAlerts(
          lat,
          lng,
          radiusKm,
          publicClusters,
          PUGET_SOUND_VIEWING_SPOTS,
        );
        return jsonResponse(evaluation, 200);
      }

      // 7. POST /api/sightings -> Enqueue onto orca-ingest-queue
      if (request.method === 'POST' && pathname === '/api/sightings') {
        const body = (await request.json()) as Record<string, unknown>;
        const lat = body.lat !== undefined ? Number(body.lat) : undefined;
        const lng = body.lng !== undefined ? Number(body.lng) : undefined;
        if (
          (lat !== undefined || lng !== undefined) &&
          (lat === undefined || lng === undefined || !isWithinPugetSoundBounds(lat, lng))
        ) {
          return jsonResponse(
            { error: 'Coordinates must fall within Puget Sound bounds.' },
            400,
          );
        }

        const rawText =
          typeof body.rawText === 'string'
            ? body.rawText
            : typeof body.notes === 'string'
              ? body.notes
              : typeof body.text === 'string'
                ? body.text
                : undefined;

        const input: RawSightingInput = {
          source:
            typeof body.source === 'string' && VALID_SOURCES.has(body.source as SightingSource)
              ? (body.source as SightingSource)
              : 'citizen',
          externalId:
            typeof body.externalId === 'string'
              ? body.externalId
              : `edge_${crypto.randomUUID().slice(0, 10)}`,
          observedAt:
            typeof body.observedAt === 'string'
              ? body.observedAt
              : new Date().toISOString(),
          rawText,
          lat,
          lng,
          locationName: typeof body.locationName === 'string' ? body.locationName : undefined,
          direction:
            typeof body.direction === 'string' &&
            VALID_DIRECTIONS.has(body.direction as TravelDirection)
              ? (body.direction as TravelDirection)
              : undefined,
          ecotype:
            typeof body.ecotype === 'string' && VALID_ECOTYPES.has(body.ecotype as Ecotype)
              ? (body.ecotype as Ecotype)
              : undefined,
          pod: typeof body.pod === 'string' ? body.pod : undefined,
          count: typeof body.count === 'number' ? body.count : undefined,
          author: typeof body.author === 'string' ? body.author : 'Citizen Spotter',
        };

        await env.INGEST_QUEUE.send({
          kind: 'sighting',
          input,
          enqueuedAt: new Date().toISOString(),
        });

        return jsonResponse({ queued: true, externalId: input.externalId }, 202);
      }

      // 8. POST /api/ingest/social -> Enqueue raw social post for NLP + queue pipeline
      if (request.method === 'POST' && pathname === '/api/ingest/social') {
        const body = (await request.json()) as Record<string, unknown>;
        const text =
          typeof body.text === 'string'
            ? body.text
            : typeof body.rawText === 'string'
              ? body.rawText
              : '';
        if (!text.trim()) {
          return jsonResponse({ error: 'Field "text" is required.' }, 400);
        }

        const input: RawSightingInput = {
          source:
            typeof body.source === 'string' && VALID_SOURCES.has(body.source as SightingSource)
              ? (body.source as SightingSource)
              : 'bluesky',
          externalId:
            typeof body.externalId === 'string'
              ? body.externalId
              : `soc_${crypto.randomUUID().slice(0, 10)}`,
          observedAt:
            typeof body.observedAt === 'string'
              ? body.observedAt
              : new Date().toISOString(),
          rawText: text,
          author: typeof body.author === 'string' ? body.author : 'Social Spotter',
          sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
        };

        await env.INGEST_QUEUE.send({
          kind: 'social',
          input,
          enqueuedAt: new Date().toISOString(),
        });

        return jsonResponse({ queued: true, externalId: input.externalId }, 202);
      }

      // 9. POST /api/ingest/webhook/orcasound -> Update hydrophone + enqueue sighting
      if (request.method === 'POST' && pathname === '/api/ingest/webhook/orcasound') {
        const body = (await request.json()) as Record<string, unknown>;
        const hydrophones = await loadHydrophones(env);
        const connector = new OrcasoundConnector(hydrophones);

        const detection: OrcaHelloDetectionPayload = {
          id:
            typeof body.id === 'string' && body.id
              ? body.id
              : `wh_${crypto.randomUUID().slice(0, 8)}`,
          locationName:
            typeof body.locationName === 'string'
              ? body.locationName
              : typeof body.location === 'string'
                ? body.location
                : 'Bush Point',
          nodeId: typeof body.nodeId === 'string' ? body.nodeId : undefined,
          timestamp:
            typeof body.timestamp === 'string'
              ? body.timestamp
              : new Date().toISOString(),
          confidence:
            typeof body.confidence === 'number'
              ? body.confidence > 1
                ? body.confidence / 100
                : body.confidence
              : 0.9,
          label: typeof body.label === 'string' ? body.label : 'Orca vocalizations detected',
          snrDb: typeof body.snrDb === 'number' ? body.snrDb : undefined,
          lat: typeof body.lat === 'number' ? body.lat : undefined,
          lng: typeof body.lng === 'number' ? body.lng : undefined,
        };

        const normalized = connector.normalizeDetection(detection);
        if (!normalized) {
          return jsonResponse({ error: 'Unable to resolve hydrophone node location.' }, 400);
        }

        const matchedNode = hydrophones.find((h) => h.id === normalized.pulse.nodeId);
        if (matchedNode) {
          matchedNode.status = 'active_detection';
          matchedNode.lastDetectionAt = normalized.pulse.detectedAt;
          matchedNode.lastDetectionLabel = normalized.pulse.label;
          matchedNode.snrDb = normalized.pulse.snrDb;
          await env.HOT_CACHE.put(KV_HYDROPHONES_KEY, JSON.stringify(hydrophones), {
            expirationTtl: 3600,
          });
        }

        await broadcastToHub(env, 'hydrophone:pulse', normalized.pulse);
        await env.INGEST_QUEUE.send({
          kind: 'sighting',
          input: normalized.sighting,
          enqueuedAt: new Date().toISOString(),
        });

        return jsonResponse({ accepted: true, queued: true, pulse: normalized.pulse }, 202);
      }

      // 10. Subscriptions CRUD
      if (request.method === 'GET' && pathname === '/api/subscriptions') {
        const list =
          env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
            ? await repo.listSubscriptions(false)
            : ((await env.HOT_CACHE.get<AlertSubscription[]>(KV_SUBSCRIPTIONS_KEY, 'json')) ?? []);
        return jsonResponse({
          count: list.length,
          activeCount: list.filter((s) => s.active).length,
          subscriptions: list,
        });
      }

      if (request.method === 'POST' && pathname === '/api/subscriptions') {
        const body = (await request.json()) as Record<string, unknown>;
        const channel =
          body.channel === 'web_push'
            ? 'web_push'
            : body.channel === 'expo'
              ? 'expo'
              : null;
        if (!channel) {
          return jsonResponse({ error: 'Field "channel" must be "expo" or "web_push".' }, 400);
        }

        const pushToken = typeof body.pushToken === 'string' ? body.pushToken.trim() : undefined;
        const webPushSubscription = parseWebPushPayload(body.webPushSubscription);
        if (channel === 'expo' && !pushToken) {
          return jsonResponse({ error: 'Expo subscriptions require "pushToken".' }, 400);
        }
        if (channel === 'web_push' && !webPushSubscription) {
          return jsonResponse({ error: 'Web Push subscriptions require "webPushSubscription".' }, 400);
        }

        const nowIso = new Date().toISOString();
        const subscription: AlertSubscription = {
          id:
            typeof body.id === 'string' && body.id.trim()
              ? body.id.trim()
              : `sub_${crypto.randomUUID().slice(0, 8)}`,
          channel,
          pushToken,
          webPushSubscription,
          favoriteSpotIds: Array.isArray(body.favoriteSpotIds)
            ? body.favoriteSpotIds.filter((s): s is string => typeof s === 'string')
            : [],
          homeLat: typeof body.homeLat === 'number' ? body.homeLat : undefined,
          homeLng: typeof body.homeLng === 'number' ? body.homeLng : undefined,
          radiusKm: typeof body.radiusKm === 'number' ? body.radiusKm : 10,
          maxEtaMinutes: typeof body.maxEtaMinutes === 'number' ? body.maxEtaMinutes : 45,
          minConfidence:
            typeof body.minConfidence === 'string' &&
            VALID_TIERS.has(body.minConfidence as ConfidenceTier)
              ? (body.minConfidence as ConfidenceTier)
              : 'corroborated',
          ecotypes: Array.isArray(body.ecotypes)
            ? body.ecotypes.filter(
                (e): e is Ecotype => typeof e === 'string' && VALID_ECOTYPES.has(e as Ecotype),
              )
            : ['SRKW', 'Biggs', 'Offshore', 'Unknown'],
          quietHoursEnabled:
            typeof body.quietHoursEnabled === 'boolean' ? body.quietHoursEnabled : true,
          quietStartHour: typeof body.quietStartHour === 'number' ? body.quietStartHour : 21,
          quietEndHour: typeof body.quietEndHour === 'number' ? body.quietEndHour : 6,
          active: typeof body.active === 'boolean' ? body.active : true,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
          const saved = await repo.saveSubscription(subscription);
          return jsonResponse({ subscription: saved }, 201);
        }

        const existing =
          (await env.HOT_CACHE.get<AlertSubscription[]>(KV_SUBSCRIPTIONS_KEY, 'json')) ?? [];
        const next = [
          ...existing.filter((s) => s.id !== subscription.id),
          subscription,
        ];
        await env.HOT_CACHE.put(KV_SUBSCRIPTIONS_KEY, JSON.stringify(next));
        return jsonResponse({ subscription }, 201);
      }

      if (request.method === 'DELETE' && pathname.startsWith('/api/subscriptions/')) {
        const id = decodeURIComponent(pathname.slice('/api/subscriptions/'.length)).trim();
        if (!id) {
          return jsonResponse({ error: 'Subscription ID is required.' }, 400);
        }

        if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
          const deleted = await repo.deleteSubscription(id);
          return deleted
            ? jsonResponse({ deleted: true, id }, 200)
            : jsonResponse({ error: `Subscription not found: ${id}` }, 404);
        }

        const existing =
          (await env.HOT_CACHE.get<AlertSubscription[]>(KV_SUBSCRIPTIONS_KEY, 'json')) ?? [];
        const next = existing.filter((s) => s.id !== id);
        if (next.length === existing.length) {
          return jsonResponse({ error: `Subscription not found: ${id}` }, 404);
        }
        await env.HOT_CACHE.put(KV_SUBSCRIPTIONS_KEY, JSON.stringify(next));
        return jsonResponse({ deleted: true, id }, 200);
      }

      // 11. Conservation Freeze endpoints
      if (request.method === 'GET' && pathname === '/api/conservation/status') {
        const freeze = await loadFreezeController(env);
        return jsonResponse(freeze.getStatus(), 200, {
          'Cache-Control': SWR_CACHE_HEADER,
        });
      }

      if (request.method === 'POST' && pathname === '/api/admin/freeze') {
        const auth = request.headers.get('Authorization') ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        if (!env.ADMIN_FREEZE_TOKEN || !token || token !== env.ADMIN_FREEZE_TOKEN) {
          return jsonResponse(
            { error: 'Unauthorized: valid Bearer ADMIN_FREEZE_TOKEN required.' },
            401,
          );
        }

        const body = (await request.json()) as Record<string, unknown>;
        const freeze = await loadFreezeController(env);
        const active = typeof body.active === 'boolean' ? body.active : true;
        const corridors = Array.isArray(body.corridors)
          ? body.corridors.filter(
              (c): c is PugetSoundCorridor =>
                typeof c === 'string' && VALID_CORRIDORS.has(c as PugetSoundCorridor),
            )
          : [];

        const updated = active
          ? freeze.setFreeze({
              active: true,
              reason: typeof body.reason === 'string' ? body.reason : null,
              corridors,
              expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
              durationMinutes:
                typeof body.durationMinutes === 'number' ? body.durationMinutes : undefined,
              updatedBy: typeof body.updatedBy === 'string' ? body.updatedBy : 'partner-admin',
            })
          : freeze.clearFreeze(
              typeof body.updatedBy === 'string' ? body.updatedBy : 'partner-admin',
            );

        await env.HOT_CACHE.put(KV_FREEZE_KEY, JSON.stringify(updated));
        await broadcastToHub(env, 'conservation:freeze', updated);
        return jsonResponse(updated, 200);
      }

      return jsonResponse({ error: `Route not found: ${request.method} ${pathname}` }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal edge error';
      return jsonResponse({ error: message }, 500);
    }
  },

  /**
   * 1-minute Cron Trigger polling sanctioned Puget Sound sources (Acartia, Orcasound, Reddit)
   * and fanning out raw events into `orca-ingest-queue`.
   */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const hydrophones = await loadHydrophones(env);
    const acartia = new AcartiaConnector({ apiToken: env.ACARTIA_API_TOKEN });
    const orcasound = new OrcasoundConnector(hydrophones);
    const reddit = new RedditJsonConnector();

    const batches = await Promise.all([
      acartia.poll(),
      orcasound.poll(),
      reddit.poll(),
    ]);

    const enqueuedAt = new Date().toISOString();
    const messages: MessageSendRequest<IngestQueueMessage>[] = [];
    for (const batch of batches) {
      for (const input of batch) {
        messages.push({
          body: {
            kind: input.source === 'reddit' ? 'social' : 'sighting',
            input,
            enqueuedAt,
          },
        });
      }
    }

    if (messages.length > 0) {
      await env.INGEST_QUEUE.sendBatch(messages);
    }
  },

  /**
   * Cloudflare Queue consumer executing hybrid NLP, spatio-temporal deduplication,
   * 750m SRKW coordinate coarsening, Supabase/KV persistence, Durable Object SSE fanout,
   * and geofenced push dispatch.
   */
  async queue(batch: MessageBatch<IngestQueueMessage>, env: Env): Promise<void> {
    const repo = createRepository(env);
    const llmAdapter = createLlmAdapter(env);
    const freeze = await loadFreezeController(env);
    const existingClusters = await loadClusters(env, repo);

    const deduplicator = new SightingDeduplicator();
    deduplicator.hydrateSnapshot(existingClusters);

    const pushDispatcher = new PushAlertDispatcher({
      repository: repo,
      spots: PUGET_SOUND_VIEWING_SPOTS,
      dryRun: env.EXPO_PUSH_LIVE !== 'true',
      expoAccessToken: env.EXPO_ACCESS_TOKEN,
    });

    for (const message of batch.messages) {
      try {
        const { kind, input } = message.body;
        let normalizedInput: RawSightingInput = input;

        if (kind === 'social' && input.rawText) {
          const parsed = await parseSightingWithFallback(input.rawText, llmAdapter);
          if (!parsed.isLiveSighting || parsed.lat === null || parsed.lng === null) {
            message.ack();
            continue;
          }
          normalizedInput = {
            ...input,
            lat: input.lat ?? parsed.lat,
            lng: input.lng ?? parsed.lng,
            locationName: input.locationName ?? parsed.matchedLandmarkName ?? undefined,
            direction: input.direction ?? parsed.direction,
            ecotype: input.ecotype ?? parsed.ecotype,
            pod: input.pod ?? parsed.pod ?? undefined,
            count: input.count ?? parsed.count ?? undefined,
            behaviors: input.behaviors ?? parsed.behaviors,
          };
        }

        const result = deduplicator.ingest(normalizedInput);
        await repo.saveCluster(result.cluster).catch(() => {});

        const frozen = freeze.isClusterFrozen(result.cluster);
        if (!frozen && (result.action === 'created' || result.action === 'corroborated')) {
          const eventType: StreamEventType =
            result.action === 'created' ? 'sighting:new' : 'sighting:corroborated';
          await broadcastToHub(env, eventType, result.cluster);
          await pushDispatcher.dispatchForCluster(result.cluster);
        }

        message.ack();
      } catch {
        message.retry();
      }
    }

    const updatedSnapshot = deduplicator.exportSnapshot();
    await env.HOT_CACHE.put(KV_CLUSTERS_KEY, JSON.stringify(updatedSnapshot), {
      expirationTtl: 600,
    });
  },
};

export default worker;
