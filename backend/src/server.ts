import http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  AcartiaConnector,
  BlueskySocialConnector,
  LiveSimulatorConnector,
  OrcasoundConnector,
  RedditJsonConnector,
} from './connectors.ts';
import type { ConnectorStatus, OrcaHelloDetectionPayload } from './connectors.ts';
import { ConservationFreezeController } from './conservation.ts';
import { SightingDeduplicator } from './deduplicator.ts';
import type { IngestResult } from './deduplicator.ts';
import { computeSpotEtas, evaluateGeofenceAlerts } from './etaEngine.ts';
import { isWithinPugetSoundBounds } from './geo.ts';
import {
  HttpLlmExtractorAdapter,
  parseSightingText,
  parseSightingWithFallback,
} from './nlpParser.ts';
import type { LlmExtractorAdapter } from './nlpParser.ts';
import {
  PUGET_SOUND_VIEWING_SPOTS,
  createInitialHydrophones,
  createSeedSightings,
} from './pugetSoundCatalog.ts';
import { PushAlertDispatcher } from './pushDispatcher.ts';
import {
  InMemoryRepository,
  SupabaseRestRepository,
} from './repository.ts';
import type { SalishPulseRepository } from './repository.ts';
import type {
  AlertSubscription,
  ConfidenceTier,
  Ecotype,
  HydrophoneNode,
  HydrophonePulseEvent,
  PugetSoundCorridor,
  PushDispatchSummary,
  RawSightingInput,
  SightingCluster,
  SightingSource,
  StreamEventPayload,
  StreamEventType,
  TravelDirection,
  WebPushSubscriptionPayload,
} from './types.ts';

export interface AppOptions {
  enableSeedData?: boolean;
  enableExternalPolling?: boolean;
  enableSimulator?: boolean;
  simulatorIntervalMs?: number;
  pollIntervalMs?: number;
  repository?: SalishPulseRepository;
  llmAdapter?: LlmExtractorAdapter;
  adminFreezeToken?: string;
  pushDryRun?: boolean;
}

export interface SalishPulseApp {
  server: Server;
  deduplicator: SightingDeduplicator;
  repository: SalishPulseRepository;
  pushDispatcher: PushAlertDispatcher;
  conservationFreeze: ConservationFreezeController;
  hydrophones: HydrophoneNode[];
  broadcast: (type: StreamEventType, data: unknown) => void;
  close: () => Promise<void>;
}

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

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Last-Event-ID',
  );
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBytes = 256 * 1024; // 256 KB guard

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw new Error('Request payload too large');
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object');
  }
  return parsed as Record<string, unknown>;
}

function resolveDefaultRepository(): SalishPulseRepository {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    return new SupabaseRestRepository({
      supabaseUrl: url,
      serviceRoleKey: key,
    });
  }
  return new InMemoryRepository();
}

function resolveDefaultLlmAdapter(): LlmExtractorAdapter | undefined {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return undefined;
  const provider =
    process.env.LLM_PROVIDER === 'gemini' ? 'gemini' : 'openai';
  return new HttpLlmExtractorAdapter({
    provider,
    apiKey,
    model: process.env.LLM_MODEL,
    endpointUrl: process.env.LLM_ENDPOINT_URL,
  });
}

function resolveAdminFreezeToken(explicitToken?: string): string | null {
  if (explicitToken) return explicitToken;
  if (process.env.ADMIN_FREEZE_TOKEN) return process.env.ADMIN_FREEZE_TOKEN;
  if (process.env.NODE_ENV !== 'production') {
    return 'dev-freeze-token';
  }
  return null;
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
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  };
}

export function createSalishPulseApp(options: AppOptions = {}): SalishPulseApp {
  const startedAt = Date.now();
  const deduplicator = new SightingDeduplicator();
  const repository = options.repository ?? resolveDefaultRepository();
  const conservationFreeze = new ConservationFreezeController();
  const pushDispatcher = new PushAlertDispatcher({
    repository,
    spots: PUGET_SOUND_VIEWING_SPOTS,
    dryRun: options.pushDryRun,
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN,
  });
  const llmAdapter = options.llmAdapter ?? resolveDefaultLlmAdapter();
  const adminFreezeToken = resolveAdminFreezeToken(options.adminFreezeToken);

  const hydrophones = createInitialHydrophones();
  const sseClients = new Set<ServerResponse>();
  let eventCounter = 1;

  const acartiaConnector = new AcartiaConnector({
    apiToken: process.env.ACARTIA_API_TOKEN,
  });
  const orcasoundConnector = new OrcasoundConnector(hydrophones);
  const blueskyConnector = new BlueskySocialConnector();
  const redditConnector = new RedditJsonConnector();
  const simulatorConnector = new LiveSimulatorConnector();

  if (options.enableSeedData ?? true) {
    for (const seed of createSeedSightings()) {
      const res = deduplicator.ingest(seed);
      void repository.saveCluster(res.cluster).catch(() => {});
    }
  }

  function getPublicClusters(
    clusters: SightingCluster[] = deduplicator.getAllClusters(),
  ): SightingCluster[] {
    return clusters.filter((cluster) => !conservationFreeze.isClusterFrozen(cluster));
  }

  function broadcast(type: StreamEventType, data: unknown): void {
    const id = eventCounter++;
    const payload: StreamEventPayload = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    const serialized = `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of sseClients) {
      if (client.writableEnded || client.destroyed) {
        sseClients.delete(client);
        continue;
      }
      client.write(serialized);
    }
  }

  async function ingestAndBroadcast(input: RawSightingInput): Promise<
    IngestResult & {
      frozen: boolean;
      pushDispatch: PushDispatchSummary | null;
    }
  > {
    const result = deduplicator.ingest(input);
    await repository.saveCluster(result.cluster).catch(() => {});

    const frozen = conservationFreeze.isClusterFrozen(result.cluster);
    let pushDispatch: PushDispatchSummary | null = null;

    if (!frozen) {
      if (result.action === 'created') {
        broadcast('sighting:new', result.cluster);
      } else if (result.action === 'corroborated') {
        broadcast('sighting:corroborated', result.cluster);
      }

      if (result.action === 'created' || result.action === 'corroborated') {
        pushDispatch = await pushDispatcher.dispatchForCluster(result.cluster);
      }
    }

    return {
      ...result,
      frozen,
      pushDispatch,
    };
  }

  function applyHydrophonePulse(pulse: HydrophonePulseEvent): void {
    const node = hydrophones.find((h) => h.id === pulse.nodeId);
    if (node) {
      node.status = 'active_detection';
      node.lastDetectionAt = pulse.detectedAt;
      node.lastDetectionLabel = pulse.label;
      node.snrDb = pulse.snrDb;
    }
    broadcast('hydrophone:pulse', pulse);
  }

  const timers: NodeJS.Timeout[] = [];

  // Heartbeat keep-alive for SSE clients
  const heartbeatTimer = setInterval(() => {
    for (const client of sseClients) {
      if (client.writableEnded || client.destroyed) {
        sseClients.delete(client);
      } else {
        client.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      }
    }
  }, 25_000);
  heartbeatTimer.unref();
  timers.push(heartbeatTimer);

  // Optional live external connectors polling
  if (options.enableExternalPolling) {
    const pollAll = async () => {
      const batches = await Promise.all([
        acartiaConnector.poll(),
        orcasoundConnector.poll(),
        blueskyConnector.poll(),
        redditConnector.poll(),
      ]);
      for (const batch of batches) {
        for (const item of batch) {
          try {
            await ingestAndBroadcast(item);
          } catch {
            // Skip invalid/out-of-bounds external records safely
          }
        }
      }
    };

    void pollAll();
    const pollTimer = setInterval(() => {
      void pollAll();
    }, options.pollIntervalMs ?? 45_000);
    pollTimer.unref();
    timers.push(pollTimer);
  }

  // Optional live movement simulator for interactive demos
  if (options.enableSimulator) {
    let simTicks = 0;
    const simTimer = setInterval(async () => {
      simTicks += 1;
      const items = await simulatorConnector.poll();
      for (const item of items) {
        await ingestAndBroadcast(item);
      }
      if (simTicks % 2 === 0) {
        const pulse = simulatorConnector.nextHydrophonePulse(hydrophones);
        applyHydrophonePulse(pulse);
      }
    }, options.simulatorIntervalMs ?? 25_000);
    simTimer.unref();
    timers.push(simTimer);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: 'Malformed request' });
        return;
      }

      if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;

      // 1. GET /api/health
      if (req.method === 'GET' && pathname === '/api/health') {
        const connectors: ConnectorStatus[] = [
          acartiaConnector.getStatus(),
          orcasoundConnector.getStatus(),
          blueskyConnector.getStatus(),
          redditConnector.getStatus(),
          simulatorConnector.getStatus(),
        ];

        const freezeStatus = conservationFreeze.getStatus();

        sendJson(res, 200, {
          status: 'ok',
          service: 'salishpulse-backend',
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          activeClusters: deduplicator.getAllClusters().length,
          publicClusters: getPublicClusters().length,
          activeSseClients: sseClients.size,
          simulatorEnabled: Boolean(options.enableSimulator),
          llmFallbackEnabled: Boolean(llmAdapter),
          pushDryRun: pushDispatcher.isDryRun(),
          conservationFreezeActive: freezeStatus.active,
          connectors,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 2. GET /api/sightings (respects Conservation Freeze)
      if (req.method === 'GET' && pathname === '/api/sightings') {
        const ecotypeParam = url.searchParams.get('ecotype');
        const minConfParam = url.searchParams.get('minConfidence');
        const hoursParam = url.searchParams.get('hours');

        let ecotype: Ecotype | undefined;
        if (ecotypeParam && VALID_ECOTYPES.has(ecotypeParam as Ecotype)) {
          ecotype = ecotypeParam as Ecotype;
        }

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
        const clusters = getPublicClusters(
          deduplicator.queryClusters({
            ecotype,
            minConfidence,
            hours: hours !== undefined && Number.isFinite(hours) ? hours : undefined,
          }),
        );

        sendJson(res, 200, {
          count: clusters.length,
          sightings: clusters,
          conservationFreeze: conservationFreeze.getStatus(),
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      // 3. POST /api/sightings (citizen spotter or structured ingestion)
      if (req.method === 'POST' && pathname === '/api/sightings') {
        const body = await readJsonBody(req);
        const rawText =
          typeof body.rawText === 'string'
            ? body.rawText
            : typeof body.notes === 'string'
              ? body.notes
              : typeof body.text === 'string'
                ? body.text
                : '';

        const lat = body.lat !== undefined ? Number(body.lat) : undefined;
        const lng = body.lng !== undefined ? Number(body.lng) : undefined;

        if (
          (lat !== undefined || lng !== undefined) &&
          (lat === undefined || lng === undefined || !isWithinPugetSoundBounds(lat, lng))
        ) {
          sendJson(res, 400, {
            error:
              'Coordinates must fall within Puget Sound / Salish Sea bounds (lat 47.0–49.05, lng -123.5–-122.1).',
          });
          return;
        }

        const source: SightingSource =
          typeof body.source === 'string' && VALID_SOURCES.has(body.source as SightingSource)
            ? (body.source as SightingSource)
            : 'citizen';

        const direction: TravelDirection | undefined =
          typeof body.direction === 'string' &&
          VALID_DIRECTIONS.has(body.direction as TravelDirection)
            ? (body.direction as TravelDirection)
            : undefined;

        const ecotype: Ecotype | undefined =
          typeof body.ecotype === 'string' && VALID_ECOTYPES.has(body.ecotype as Ecotype)
            ? (body.ecotype as Ecotype)
            : undefined;

        const parsed = rawText ? parseSightingText(rawText) : null;
        if (lat === undefined && (!parsed || parsed.lat === null)) {
          sendJson(res, 400, {
            error:
              'Provide either valid Puget Sound lat/lng coordinates or a recognizable landmark in text/notes.',
          });
          return;
        }

        const result = await ingestAndBroadcast({
          source,
          externalId: typeof body.externalId === 'string' ? body.externalId : undefined,
          observedAt: typeof body.observedAt === 'string' ? body.observedAt : undefined,
          rawText: rawText || undefined,
          lat,
          lng,
          locationName: typeof body.locationName === 'string' ? body.locationName : undefined,
          direction,
          speedKnots: typeof body.speedKnots === 'number' ? body.speedKnots : undefined,
          ecotype,
          pod: typeof body.pod === 'string' ? body.pod : undefined,
          count: typeof body.count === 'number' ? body.count : undefined,
          behaviors: Array.isArray(body.behaviors)
            ? body.behaviors.filter((b): b is string => typeof b === 'string')
            : undefined,
          author: typeof body.author === 'string' ? body.author : 'Citizen Spotter',
        });

        const updatedSpots = computeSpotEtas(
          PUGET_SOUND_VIEWING_SPOTS,
          getPublicClusters(),
        ).filter((s) => s.viewingLikelihood !== 'none');

        sendJson(res, result.action === 'created' ? 201 : 200, {
          action: result.action,
          frozen: result.frozen,
          cluster: result.cluster,
          parsed: parsed ?? undefined,
          affectedSpots: updatedSpots.slice(0, 5),
          pushDispatch: result.pushDispatch ?? undefined,
        });
        return;
      }

      // 4. POST /api/ingest/social (raw social post text -> hybrid NLP -> deduplicator -> SSE)
      if (req.method === 'POST' && pathname === '/api/ingest/social') {
        const body = await readJsonBody(req);
        const text =
          typeof body.text === 'string'
            ? body.text
            : typeof body.rawText === 'string'
              ? body.rawText
              : '';

        if (!text.trim()) {
          sendJson(res, 400, { error: 'Field "text" is required.' });
          return;
        }

        const parsed = await parseSightingWithFallback(text, llmAdapter);
        if (!parsed.isLiveSighting) {
          sendJson(res, 200, {
            accepted: false,
            reason: parsed.rejectionReason ?? 'Not classified as a live orca sighting',
            parsed,
          });
          return;
        }

        if (parsed.lat === null || parsed.lng === null) {
          sendJson(res, 200, {
            accepted: false,
            reason:
              'Could not geocode a Puget Sound landmark from post text (would queue for LLM fallback in production).',
            parsed,
          });
          return;
        }

        const source: SightingSource =
          typeof body.source === 'string' && VALID_SOURCES.has(body.source as SightingSource)
            ? (body.source as SightingSource)
            : 'bluesky';

        const result = await ingestAndBroadcast({
          source,
          externalId: typeof body.externalId === 'string' ? body.externalId : undefined,
          observedAt: typeof body.observedAt === 'string' ? body.observedAt : undefined,
          rawText: text,
          lat: parsed.lat,
          lng: parsed.lng,
          locationName: parsed.matchedLandmarkName ?? undefined,
          direction: parsed.direction,
          ecotype: parsed.ecotype,
          pod: parsed.pod ?? undefined,
          count: parsed.count ?? undefined,
          behaviors: parsed.behaviors,
          author: typeof body.author === 'string' ? body.author : 'Social Spotter',
          sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
        });

        sendJson(res, result.action === 'created' ? 201 : 200, {
          accepted: true,
          action: result.action,
          frozen: result.frozen,
          parsed,
          cluster: result.cluster,
          pushDispatch: result.pushDispatch ?? undefined,
        });
        return;
      }

      // 5. POST /api/ingest/webhook/orcasound (OrcaHello real-time acoustic detection webhook)
      if (req.method === 'POST' && pathname === '/api/ingest/webhook/orcasound') {
        const body = await readJsonBody(req);
        const locationName =
          typeof body.locationName === 'string'
            ? body.locationName
            : typeof body.location === 'string'
              ? body.location
              : '';
        const nodeId = typeof body.nodeId === 'string' ? body.nodeId : undefined;

        if (!locationName && !nodeId) {
          sendJson(res, 400, {
            error: 'Webhook payload must include "locationName" or "nodeId".',
          });
          return;
        }

        const rawConf = typeof body.confidence === 'number' ? body.confidence : 0.9;
        const confidence = rawConf > 1 ? Math.min(1, rawConf / 100) : Math.max(0, rawConf);

        const detection: OrcaHelloDetectionPayload = {
          id:
            typeof body.id === 'string' && body.id
              ? body.id
              : `wh_${crypto.randomUUID().slice(0, 8)}`,
          locationName: locationName || nodeId || 'Bush Point',
          nodeId,
          timestamp:
            typeof body.timestamp === 'string'
              ? body.timestamp
              : new Date().toISOString(),
          confidence,
          label:
            typeof body.label === 'string'
              ? body.label
              : typeof body.comments === 'string'
                ? body.comments
                : 'Orca vocalizations detected',
          snrDb: typeof body.snrDb === 'number' ? body.snrDb : undefined,
          lat: typeof body.lat === 'number' ? body.lat : undefined,
          lng: typeof body.lng === 'number' ? body.lng : undefined,
        };

        const normalized = orcasoundConnector.normalizeDetection(detection);
        if (!normalized) {
          sendJson(res, 400, {
            error: 'Unable to resolve valid Puget Sound hydrophone location for OrcaHello detection.',
          });
          return;
        }

        applyHydrophonePulse(normalized.pulse);
        const result = await ingestAndBroadcast(normalized.sighting);

        sendJson(res, result.action === 'created' ? 201 : 200, {
          accepted: true,
          action: result.action,
          frozen: result.frozen,
          pulse: normalized.pulse,
          cluster: result.cluster,
          pushDispatch: result.pushDispatch ?? undefined,
        });
        return;
      }

      // 6. GET /api/spots (enriched with live ETA & viewing likelihood, respecting freeze)
      if (req.method === 'GET' && pathname === '/api/spots') {
        const spots = computeSpotEtas(
          PUGET_SOUND_VIEWING_SPOTS,
          getPublicClusters(),
        );
        sendJson(res, 200, {
          count: spots.length,
          spots,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      // 7. GET /api/hydrophones
      if (req.method === 'GET' && pathname === '/api/hydrophones') {
        sendJson(res, 200, {
          count: hydrophones.length,
          hydrophones,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      // 8. GET /api/alerts/evaluate?lat=...&lng=...&radiusKm=...
      if (req.method === 'GET' && pathname === '/api/alerts/evaluate') {
        const lat = Number(url.searchParams.get('lat'));
        const lng = Number(url.searchParams.get('lng'));
        const radiusRaw = url.searchParams.get('radiusKm');
        const radiusKm = radiusRaw ? Number(radiusRaw) : 10;

        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isWithinPugetSoundBounds(lat, lng)) {
          sendJson(res, 400, {
            error: 'Query params "lat" and "lng" must be valid Puget Sound coordinates.',
          });
          return;
        }
        if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
          sendJson(res, 400, {
            error: 'Query param "radiusKm" must be between 0 and 100.',
          });
          return;
        }

        const evaluation = evaluateGeofenceAlerts(
          lat,
          lng,
          radiusKm,
          getPublicClusters(),
          PUGET_SOUND_VIEWING_SPOTS,
        );
        sendJson(res, 200, evaluation);
        return;
      }

      // 9. GET /api/subscriptions (status & count)
      if (req.method === 'GET' && pathname === '/api/subscriptions') {
        const all = await repository.listSubscriptions(false);
        const activeCount = all.filter((s) => s.active).length;
        sendJson(res, 200, {
          count: all.length,
          activeCount,
          pushDryRun: pushDispatcher.isDryRun(),
          subscriptions: all.map((sub) => ({
            id: sub.id,
            channel: sub.channel,
            favoriteSpotIds: sub.favoriteSpotIds,
            radiusKm: sub.radiusKm,
            maxEtaMinutes: sub.maxEtaMinutes,
            minConfidence: sub.minConfidence,
            ecotypes: sub.ecotypes,
            quietHoursEnabled: sub.quietHoursEnabled,
            quietStartHour: sub.quietStartHour,
            quietEndHour: sub.quietEndHour,
            active: sub.active,
            updatedAt: sub.updatedAt,
          })),
        });
        return;
      }

      // 10. POST /api/subscriptions (create/update geofenced push subscription)
      if (req.method === 'POST' && pathname === '/api/subscriptions') {
        const body = await readJsonBody(req);
        const channel =
          body.channel === 'web_push'
            ? 'web_push'
            : body.channel === 'expo'
              ? 'expo'
              : null;

        if (!channel) {
          sendJson(res, 400, {
            error: 'Field "channel" must be either "expo" or "web_push".',
          });
          return;
        }

        const pushToken =
          typeof body.pushToken === 'string' && body.pushToken.trim()
            ? body.pushToken.trim()
            : undefined;
        const webPushSubscription = parseWebPushPayload(body.webPushSubscription);

        if (channel === 'expo' && !pushToken) {
          sendJson(res, 400, {
            error: 'Expo channel subscriptions require a non-empty "pushToken".',
          });
          return;
        }

        if (channel === 'web_push' && !webPushSubscription) {
          sendJson(res, 400, {
            error:
              'Web Push subscriptions require "webPushSubscription" with endpoint and p256dh/auth keys.',
          });
          return;
        }

        const homeLat = body.homeLat !== undefined ? Number(body.homeLat) : undefined;
        const homeLng = body.homeLng !== undefined ? Number(body.homeLng) : undefined;
        if (
          (homeLat !== undefined || homeLng !== undefined) &&
          (homeLat === undefined ||
            homeLng === undefined ||
            !isWithinPugetSoundBounds(homeLat, homeLng))
        ) {
          sendJson(res, 400, {
            error: 'Optional "homeLat"/"homeLng" must fall within Puget Sound bounds.',
          });
          return;
        }

        const favoriteSpotIds = Array.isArray(body.favoriteSpotIds)
          ? body.favoriteSpotIds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          : [];

        const radiusKm =
          typeof body.radiusKm === 'number' && Number.isFinite(body.radiusKm)
            ? Math.min(100, Math.max(1, body.radiusKm))
            : 10;
        const maxEtaMinutes =
          typeof body.maxEtaMinutes === 'number' && Number.isFinite(body.maxEtaMinutes)
            ? Math.min(240, Math.max(5, Math.round(body.maxEtaMinutes)))
            : 45;
        const minConfidence: ConfidenceTier =
          typeof body.minConfidence === 'string' &&
          VALID_TIERS.has(body.minConfidence as ConfidenceTier)
            ? (body.minConfidence as ConfidenceTier)
            : 'corroborated';
        const ecotypes: Ecotype[] = Array.isArray(body.ecotypes)
          ? body.ecotypes.filter(
              (e): e is Ecotype => typeof e === 'string' && VALID_ECOTYPES.has(e as Ecotype),
            )
          : ['SRKW', 'Biggs', 'Offshore', 'Unknown'];

        const quietHoursEnabled =
          typeof body.quietHoursEnabled === 'boolean' ? body.quietHoursEnabled : true;
        const quietStartHour =
          typeof body.quietStartHour === 'number' &&
          Number.isInteger(body.quietStartHour) &&
          body.quietStartHour >= 0 &&
          body.quietStartHour <= 23
            ? body.quietStartHour
            : 21;
        const quietEndHour =
          typeof body.quietEndHour === 'number' &&
          Number.isInteger(body.quietEndHour) &&
          body.quietEndHour >= 0 &&
          body.quietEndHour <= 23
            ? body.quietEndHour
            : 6;

        const nowIso = new Date().toISOString();
        const subscription: AlertSubscription = {
          id:
            typeof body.id === 'string' && body.id.trim()
              ? body.id.trim()
              : `sub_${globalThis.crypto.randomUUID().slice(0, 8)}`,
          channel,
          pushToken,
          webPushSubscription,
          favoriteSpotIds,
          homeLat,
          homeLng,
          radiusKm,
          maxEtaMinutes,
          minConfidence,
          ecotypes: ecotypes.length > 0 ? ecotypes : ['SRKW', 'Biggs', 'Offshore', 'Unknown'],
          quietHoursEnabled,
          quietStartHour,
          quietEndHour,
          active: typeof body.active === 'boolean' ? body.active : true,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        const saved = await repository.saveSubscription(subscription);
        sendJson(res, 201, {
          subscription: saved,
        });
        return;
      }

      // 11. DELETE /api/subscriptions/:id
      if (req.method === 'DELETE' && pathname.startsWith('/api/subscriptions/')) {
        const id = decodeURIComponent(pathname.slice('/api/subscriptions/'.length)).trim();
        if (!id) {
          sendJson(res, 400, { error: 'Subscription ID is required.' });
          return;
        }
        const deleted = await repository.deleteSubscription(id);
        if (!deleted) {
          sendJson(res, 404, { error: `Subscription not found: ${id}` });
          return;
        }
        sendJson(res, 200, { deleted: true, id });
        return;
      }

      // 12. GET /api/conservation/status
      if (req.method === 'GET' && pathname === '/api/conservation/status') {
        sendJson(res, 200, conservationFreeze.getStatus());
        return;
      }

      // 13. POST /api/admin/freeze (Bearer-protected conservation partner emergency switch)
      if (req.method === 'POST' && pathname === '/api/admin/freeze') {
        const authHeader = req.headers.authorization ?? '';
        const bearerPrefix = 'Bearer ';
        const providedToken = authHeader.startsWith(bearerPrefix)
          ? authHeader.slice(bearerPrefix.length).trim()
          : '';

        if (!adminFreezeToken || !providedToken || providedToken !== adminFreezeToken) {
          sendJson(res, 401, {
            error: 'Unauthorized: valid Bearer ADMIN_FREEZE_TOKEN required.',
          });
          return;
        }

        const body = await readJsonBody(req);
        const active = typeof body.active === 'boolean' ? body.active : true;
        const corridors = Array.isArray(body.corridors)
          ? body.corridors.filter(
              (c): c is PugetSoundCorridor =>
                typeof c === 'string' && VALID_CORRIDORS.has(c as PugetSoundCorridor),
            )
          : [];

        const updatedStatus = active
          ? conservationFreeze.setFreeze({
              active: true,
              reason: typeof body.reason === 'string' ? body.reason : null,
              corridors,
              expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
              durationMinutes:
                typeof body.durationMinutes === 'number' ? body.durationMinutes : undefined,
              updatedBy: typeof body.updatedBy === 'string' ? body.updatedBy : 'partner-admin',
            })
          : conservationFreeze.clearFreeze(
              typeof body.updatedBy === 'string' ? body.updatedBy : 'partner-admin',
            );

        broadcast('conservation:freeze', updatedStatus);
        sendJson(res, 200, updatedStatus);
        return;
      }

      // 14. GET /api/stream (Server-Sent Events)
      if (req.method === 'GET' && pathname === '/api/stream') {
        setCorsHeaders(res);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        sseClients.add(res);

        const initialEvent: StreamEventPayload = {
          type: 'connected',
          timestamp: new Date().toISOString(),
          data: {
            activeClusters: getPublicClusters().length,
            hydrophonesOnline: hydrophones.filter((h) => h.status !== 'offline').length,
            conservationFreeze: conservationFreeze.getStatus(),
          },
        };
        res.write(
          `id: ${eventCounter++}\nevent: connected\ndata: ${JSON.stringify(initialEvent)}\n\n`,
        );

        req.on('close', () => {
          sseClients.delete(res);
        });
        return;
      }

      sendJson(res, 404, { error: `Route not found: ${req.method} ${pathname}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      const status =
        message.includes('JSON') || message.includes('too large') ? 400 : 500;
      sendJson(res, status, { error: message });
    }
  });

  async function close(): Promise<void> {
    for (const timer of timers) {
      clearInterval(timer);
    }
    for (const client of sseClients) {
      client.end();
    }
    sseClients.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return {
    server,
    deduplicator,
    repository,
    pushDispatcher,
    conservationFreeze,
    hydrophones,
    broadcast,
    close,
  };
}

// Start server when executed directly (`node src/server.ts`)
const isDirectEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntry) {
  const port = Number(process.env.PORT ?? 4000);
  const enableSimulator = process.env.ENABLE_SIMULATOR !== 'false';
  const enableExternalPolling = process.env.ENABLE_EXTERNAL_POLLING === 'true';

  const app = createSalishPulseApp({
    enableSeedData: true,
    enableSimulator,
    enableExternalPolling,
    simulatorIntervalMs: Number(process.env.SIMULATOR_INTERVAL_MS ?? 25_000),
  });

  app.server.listen(port, '0.0.0.0', () => {
    console.log(
      `[SalishPulse] Real-time orca aggregation API listening on http://localhost:${port}`,
    );
    console.log(
      `[SalishPulse] Simulator: ${enableSimulator ? 'ON' : 'OFF'} | External Polling: ${enableExternalPolling ? 'ON' : 'OFF'}`,
    );
  });

  const shutdown = () => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
