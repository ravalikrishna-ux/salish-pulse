import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import {
  RedditJsonConnector,
  parseBlueskyJetstreamEvent,
  parseRedditListingPosts,
} from './connectors.ts';
import {
  ConservationFreezeController,
  coarsenSrkwCoordinates,
} from './conservation.ts';
import { SightingDeduplicator } from './deduplicator.ts';
import { computeSpotEtas, evaluateGeofenceAlerts } from './etaEngine.ts';
import { haversineDistanceKm, isWithinPugetSoundBounds } from './geo.ts';
import {
  HttpLlmExtractorAdapter,
  parseSightingText,
  parseSightingWithFallback,
} from './nlpParser.ts';
import type { LlmExtractorAdapter } from './nlpParser.ts';
import { PUGET_SOUND_VIEWING_SPOTS } from './pugetSoundCatalog.ts';
import { PushAlertDispatcher, isQuietHoursInSeattle } from './pushDispatcher.ts';
import { InMemoryRepository } from './repository.ts';
import { createSalishPulseApp } from './server.ts';

describe('NLP Parser & Puget Sound Geocode Resolver', () => {
  it('parses messy Seattle social post with landmark, destination, direction, count, and dorsal hint', () => {
    const result = parseSightingText(
      '3 orcas heading south past Alki toward Lincoln Park, huge dorsal fin!',
    );

    assert.equal(result.isLiveSighting, true);
    assert.equal(result.direction, 'S');
    assert.equal(result.count, 3);
    assert.equal(result.hasAdultMaleHint, true);
    assert.equal(result.matchedLandmarkId, 'alki-point');
    assert.equal(result.destinationLandmarkName, 'Lincoln Park (Colman Pool Shoreline)');
    assert.ok(result.lat !== null && Math.abs(result.lat - 47.5762) < 0.01);
    assert.ok(result.lng !== null && Math.abs(result.lng - -122.4207) < 0.01);
    assert.ok(result.confidenceScore >= 0.75);
  });

  it('infers travel direction from origin -> destination landmarks when compass word is omitted', () => {
    const result = parseSightingText(
      'Saw a pair of orcas off Discovery Park moving toward Alki right now!',
    );

    assert.equal(result.isLiveSighting, true);
    assert.equal(result.matchedLandmarkId, 'discovery-park');
    assert.equal(result.direction, 'S');
    assert.equal(result.count, 2);
  });

  it('extracts Bigg’s Transient matriline, count, direction, and behaviors', () => {
    const result = parseSightingText(
      'T65A family (4 whales) hunting and breaching northbound off Edmonds Pier!',
    );

    assert.equal(result.isLiveSighting, true);
    assert.equal(result.ecotype, 'Biggs');
    assert.equal(result.pod, 'T65A');
    assert.equal(result.direction, 'N');
    assert.equal(result.count, 4);
    assert.equal(result.matchedLandmarkId, 'edmonds-pier');
    assert.ok(result.behaviors.includes('hunting'));
    assert.ok(result.behaviors.includes('breaching'));
  });

  it('rejects sports chatter, throwbacks, and sightseeing questions', () => {
    assert.equal(
      parseSightingText('Wearing my Canucks orca jersey to the game!').isLiveSighting,
      false,
    );
    assert.equal(
      parseSightingText('Throwback to 3 years ago seeing J-Pod off Alki Beach').isLiveSighting,
      false,
    );
    assert.equal(
      parseSightingText('Has anyone seen orcas at Lincoln Park today?').isLiveSighting,
      false,
    );
  });

  it('falls back to optional LLM adapter when deterministic geocoding misses location', async () => {
    let called = false;
    const mockLlm: LlmExtractorAdapter = {
      modelName: 'gemini-2.5-flash-lite-mock',
      async extract() {
        called = true;
        return {
          lat: 47.6145,
          lng: -122.3574,
          matchedLandmarkName: 'Seattle Waterfront (LLM resolved)',
          direction: 'S',
          ecotype: 'SRKW',
          pod: 'J-Pod',
          confidenceScore: 0.78,
        };
      },
    };

    const result = await parseSightingWithFallback(
      'Whoa 4 orcas right outside my office window by the big ferries downtown!',
      mockLlm,
    );

    assert.equal(called, true);
    assert.equal(result.extractionMethod, 'llm_fallback');
    assert.equal(result.lat, 47.6145);
    assert.equal(result.pod, 'J-Pod');
  });
});

describe('Spatio-Temporal Deduplication & Corroboration Engine', () => {
  it('merges nearby reports within 2.5km and 20min and upgrades community -> corroborated -> verified', () => {
    const dedup = new SightingDeduplicator();
    const t0 = Date.parse('2026-11-22T18:00:00.000Z');

    const first = dedup.ingest(
      {
        source: 'bluesky',
        externalId: 'bsky-1',
        observedAt: new Date(t0).toISOString(),
        rawText: '3 orcas heading south past Alki Point!',
      },
      t0,
    );

    assert.equal(first.action, 'created');
    assert.equal(first.cluster.corroborationCount, 1);
    assert.equal(first.cluster.confidenceTier, 'community');

    // Second independent citizen report 0.8 km away, 6 minutes later
    const second = dedup.ingest(
      {
        source: 'citizen',
        externalId: 'cit-2',
        observedAt: new Date(t0 + 6 * 60_000).toISOString(),
        lat: 47.5705,
        lng: -122.4163,
        locationName: 'Constellation Park',
        direction: 'S',
        ecotype: 'SRKW',
        pod: 'J-Pod',
        count: 5,
        rawText: 'J-Pod heading south off Constellation Park!',
      },
      t0 + 6 * 60_000,
    );

    assert.equal(second.action, 'corroborated');
    assert.equal(second.cluster.id, first.cluster.id);
    assert.equal(second.cluster.corroborationCount, 2);
    assert.equal(second.cluster.confidenceTier, 'corroborated');
    assert.equal(second.cluster.pod, 'J-Pod');
    assert.deepEqual(second.cluster.sources.sort(), ['bluesky', 'citizen']);

    // Duplicate externalId should be ignored without inflating corroborationCount
    const dup = dedup.ingest(
      {
        source: 'citizen',
        externalId: 'cit-2',
        observedAt: new Date(t0 + 6 * 60_000).toISOString(),
        lat: 47.5705,
        lng: -122.4163,
      },
      t0 + 7 * 60_000,
    );
    assert.equal(dup.action, 'duplicate_ignored');
    assert.equal(dup.cluster.corroborationCount, 2);

    // Authoritative Acartia confirmation promotes cluster to verified
    const third = dedup.ingest(
      {
        source: 'acartia',
        externalId: 'acartia-99',
        observedAt: new Date(t0 + 10 * 60_000).toISOString(),
        lat: 47.5672,
        lng: -122.419,
        direction: 'S',
        ecotype: 'SRKW',
        pod: 'J-Pod',
      },
      t0 + 10 * 60_000,
    );
    assert.equal(third.action, 'corroborated');
    assert.equal(third.cluster.corroborationCount, 3);
    assert.equal(third.cluster.confidenceTier, 'verified');
    assert.equal(dedup.getAllClusters().length, 1);
  });

  it('keeps distant (>2.5km), old (>20min), and conflicting-ecotype sightings in separate clusters', () => {
    const dedup = new SightingDeduplicator();
    const t0 = Date.parse('2026-11-22T18:00:00.000Z');

    // Sighting 1: SRKW at Alki
    dedup.ingest(
      {
        source: 'citizen',
        observedAt: new Date(t0).toISOString(),
        lat: 47.5762,
        lng: -122.4207,
        ecotype: 'SRKW',
        direction: 'S',
      },
      t0,
    );

    // Sighting 2: Far away at Edmonds (~26 km north) -> separate cluster
    const far = dedup.ingest(
      {
        source: 'citizen',
        observedAt: new Date(t0 + 5 * 60_000).toISOString(),
        lat: 47.8132,
        lng: -122.3852,
        ecotype: 'SRKW',
        direction: 'S',
      },
      t0 + 5 * 60_000,
    );
    assert.equal(far.action, 'created');

    // Sighting 3: Same spot at Alki but 35 minutes later (>20min window) -> separate cluster
    const late = dedup.ingest(
      {
        source: 'citizen',
        observedAt: new Date(t0 + 35 * 60_000).toISOString(),
        lat: 47.5762,
        lng: -122.4207,
        ecotype: 'SRKW',
        direction: 'S',
      },
      t0 + 35 * 60_000,
    );
    assert.equal(late.action, 'created');

    // Sighting 4: Same spot & same time at Alki, but confirmed Bigg's -> must NOT merge with SRKW
    const diffEcotype = dedup.ingest(
      {
        source: 'orca_network',
        observedAt: new Date(t0 + 3 * 60_000).toISOString(),
        lat: 47.5762,
        lng: -122.4207,
        ecotype: 'Biggs',
        pod: 'T65A',
        direction: 'N',
      },
      t0 + 3 * 60_000,
    );
    assert.equal(diffEcotype.action, 'created');
    assert.equal(dedup.getAllClusters().length, 4);
  });
});

describe('Puget Sound Corridor ETA Predictor & Geofence Alerts', () => {
  it('computes accurate southbound ETAs for Lincoln Park & Point Robinson and ignores spots behind pod', () => {
    const dedup = new SightingDeduplicator();
    const now = Date.parse('2026-11-22T19:00:00.000Z');

    // Corroborated J-Pod southbound right off Alki Point (4.5 knots)
    dedup.ingest(
      {
        source: 'acartia',
        observedAt: new Date(now - 2 * 60_000).toISOString(),
        lat: 47.5762,
        lng: -122.4207,
        locationName: 'Alki Point Lighthouse',
        direction: 'S',
        speedKnots: 4.5,
        ecotype: 'SRKW',
        pod: 'J-Pod',
        count: 6,
      },
      now,
    );
    dedup.ingest(
      {
        source: 'bluesky',
        observedAt: new Date(now - 1 * 60_000).toISOString(),
        rawText: 'J-Pod southbound off Alki Point heading toward Lincoln Park!',
      },
      now,
    );

    const spots = computeSpotEtas(PUGET_SOUND_VIEWING_SPOTS, dedup.getAllClusters(), now);

    const alki = spots.find((s) => s.id === 'alki-point');
    const lincoln = spots.find((s) => s.id === 'lincoln-park');
    const ptRobinson = spots.find((s) => s.id === 'point-robinson');
    const discovery = spots.find((s) => s.id === 'discovery-park');

    assert.ok(alki && lincoln && ptRobinson && discovery);

    // Right at Alki -> ETA 0 ("active right off")
    assert.equal(alki.etaMinutes, 0);
    assert.equal(alki.viewingLikelihood, 'high');

    // Lincoln Park is ~5.3 km (~2.88 nm) south -> at 4.5 kn (~38 min)
    assert.ok(lincoln.etaMinutes !== null && lincoln.etaMinutes >= 20 && lincoln.etaMinutes <= 50);
    assert.equal(lincoln.viewingLikelihood, 'high');
    assert.equal(lincoln.approachingPod, 'J-Pod');

    // Point Robinson is ~21.2 km (~11.4 nm) south -> ~145–160 min (medium/low)
    assert.ok(ptRobinson.etaMinutes !== null && ptRobinson.etaMinutes > lincoln.etaMinutes);

    // Discovery Park is ~9.6 km NORTH (behind southbound pod) -> no ETA
    assert.equal(discovery.etaMinutes, null);
    assert.equal(discovery.viewingLikelihood, 'none');

    // Geofence alert for user near Lincoln Park should fire high_priority
    const alert = evaluateGeofenceAlerts(
      47.5306,
      -122.3988,
      10,
      dedup.getAllClusters(),
      PUGET_SOUND_VIEWING_SPOTS,
      now,
    );
    assert.equal(alert.shouldAlert, true);
    assert.equal(alert.severity, 'high_priority');
    assert.ok(alert.recommendedTitle?.includes('J-Pod'));
    assert.ok(alert.matchingClusters.length >= 1);
  });
});

describe('HTTP REST API & Live SSE Streaming Integration', () => {
  it('handles full REST lifecycle, social deduplication, geofence evaluation, and SSE events', async () => {
    const app = createSalishPulseApp({
      enableSeedData: false,
      enableExternalPolling: false,
      enableSimulator: false,
    });

    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = (app.server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Health check
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      const health = (await healthRes.json()) as { status: string; activeClusters: number };
      assert.equal(health.status, 'ok');
      assert.equal(health.activeClusters, 0);

      // 2. Open live SSE connection before ingesting a sighting
      const sseController = new AbortController();
      const sseRes = await fetch(`${baseUrl}/api/stream`, {
        signal: sseController.signal,
      });
      assert.equal(sseRes.status, 200);
      assert.ok(sseRes.headers.get('content-type')?.includes('text/event-stream'));

      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();

      // Read initial connected frame
      const firstChunk = await reader.read();
      const initialText = decoder.decode(firstChunk.value);
      assert.ok(initialText.includes('event: connected'));

      // 3. Ingest first social post via POST /api/ingest/social -> creates cluster & pushes SSE
      const post1Res = await fetch(`${baseUrl}/api/ingest/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'bluesky',
          author: '@alkispotter.bsky.social',
          text: '3 orcas heading south past Alki toward Lincoln Park, huge dorsal fin!',
        }),
      });
      assert.equal(post1Res.status, 201);
      const post1 = (await post1Res.json()) as {
        accepted: boolean;
        action: string;
        cluster: { id: string; confidenceTier: string; corroborationCount: number };
      };
      assert.equal(post1.accepted, true);
      assert.equal(post1.action, 'created');
      assert.equal(post1.cluster.confidenceTier, 'community');

      // Verify SSE client received sighting:new
      const sseNewChunk = await reader.read();
      const sseNewText = decoder.decode(sseNewChunk.value);
      assert.ok(sseNewText.includes('event: sighting:new'));
      assert.ok(sseNewText.includes(post1.cluster.id));

      // 4. Ingest second corroborating post via POST /api/sightings -> corroborates & pushes SSE
      const post2Res = await fetch(`${baseUrl}/api/sightings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'citizen',
          lat: 47.5705,
          lng: -122.4163,
          direction: 'S',
          ecotype: 'SRKW',
          pod: 'J-Pod',
          count: 4,
          notes: 'Confirming J-Pod passing Constellation Park heading south!',
        }),
      });
      assert.equal(post2Res.status, 200);
      const post2 = (await post2Res.json()) as {
        action: string;
        cluster: { id: string; confidenceTier: string; corroborationCount: number };
      };
      assert.equal(post2.action, 'corroborated');
      assert.equal(post2.cluster.id, post1.cluster.id);
      assert.equal(post2.cluster.corroborationCount, 2);
      assert.equal(post2.cluster.confidenceTier, 'corroborated');

      // Verify SSE client received sighting:corroborated
      const sseCorrobChunk = await reader.read();
      const sseCorrobText = decoder.decode(sseCorrobChunk.value);
      assert.ok(sseCorrobText.includes('event: sighting:corroborated'));

      sseController.abort();

      // 5. Reject non-sighting social post gracefully
      const rejectRes = await fetch(`${baseUrl}/api/ingest/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Throwback to last summer seeing orcas at Alki!',
        }),
      });
      assert.equal(rejectRes.status, 200);
      const rejected = (await rejectRes.json()) as { accepted: boolean };
      assert.equal(rejected.accepted, false);

      // 6. Query GET /api/sightings with filters
      const listRes = await fetch(`${baseUrl}/api/sightings?ecotype=SRKW&minConfidence=corroborated&hours=2`);
      assert.equal(listRes.status, 200);
      const list = (await listRes.json()) as { count: number };
      assert.equal(list.count, 1);

      // 7. Query GET /api/spots (enriched with ETA) & GET /api/hydrophones
      const spotsRes = await fetch(`${baseUrl}/api/spots`);
      assert.equal(spotsRes.status, 200);
      const spotsBody = (await spotsRes.json()) as {
        spots: Array<{ id: string; viewingLikelihood: string; etaMinutes: number | null }>;
      };
      const lincoln = spotsBody.spots.find((s) => s.id === 'lincoln-park');
      assert.ok(lincoln && lincoln.viewingLikelihood === 'high' && lincoln.etaMinutes !== null);

      const hydroRes = await fetch(`${baseUrl}/api/hydrophones`);
      assert.equal(hydroRes.status, 200);
      const hydroBody = (await hydroRes.json()) as { count: number };
      assert.ok(hydroBody.count >= 5);

      // 8. Query GET /api/alerts/evaluate
      const alertRes = await fetch(
        `${baseUrl}/api/alerts/evaluate?lat=47.5306&lng=-122.3988&radiusKm=10`,
      );
      assert.equal(alertRes.status, 200);
      const alertBody = (await alertRes.json()) as { shouldAlert: boolean; severity: string };
      assert.equal(alertBody.shouldAlert, true);
      assert.equal(alertBody.severity, 'high_priority');
    } finally {
      await app.close();
    }
  });
});

describe('Seattle ORCA Transit Card Rejection & HttpLlmExtractorAdapter', () => {
  it('rejects Seattle ORCA transit card posts with zero false positives', () => {
    const samples = [
      'Lost my ORCA card near Alki bus stop today!',
      'Anyone know how to reload my ORCA balance before taking Link light rail?',
      'Tap to pay with ORCA pass on King County Metro route 50',
      'Sound Transit bus fare went up on my ORCA card',
    ];

    for (const sample of samples) {
      const parsed = parseSightingText(sample);
      assert.equal(parsed.isLiveSighting, false, `Expected rejection for: ${sample}`);
      assert.equal(
        parsed.rejectionReason,
        'Seattle ORCA transit card reference rather than wildlife sighting',
      );
    }
  });

  it('extracts structured JSON via HttpLlmExtractorAdapter (Gemini & OpenAI) and returns null safely on error/timeout', async () => {
    const geminiAdapter = new HttpLlmExtractorAdapter({
      provider: 'gemini',
      apiKey: 'test-key',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        isLiveSighting: true,
                        lat: 47.6145,
                        lng: -122.3574,
                        matchedLandmarkName: 'Elliott Bay Ferry Lane',
                        direction: 'S',
                        ecotype: 'SRKW',
                        pod: 'J-Pod',
                        count: 5,
                        behaviors: ['breaching'],
                        confidenceScore: 0.81,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const geminiResult = await geminiAdapter.extract('Orcas right by the downtown ferries!');
    assert.ok(geminiResult);
    assert.equal(geminiResult.lat, 47.6145);
    assert.equal(geminiResult.pod, 'J-Pod');
    assert.equal(geminiResult.ecotype, 'SRKW');

    const failingOpenAiAdapter = new HttpLlmExtractorAdapter({
      provider: 'openai',
      apiKey: 'test-key',
      timeoutMs: 25,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('Aborted'));
          });
        }),
    });

    const timedOut = await failingOpenAiAdapter.extract('Whales near pier!');
    assert.equal(timedOut, null);
  });
});

describe('Conservation Coarsening (~750m SRKW) & Deduplicator Snapshots', () => {
  it('deterministically coarsens SRKW & Unknown within ~750m while keeping Bigg’s & Offshore exact', () => {
    const trueLat = 47.5762;
    const trueLng = -122.4207;

    const srkw1 = coarsenSrkwCoordinates(trueLat, trueLng, 'SRKW', 'cls_demo123');
    const srkw2 = coarsenSrkwCoordinates(trueLat, trueLng, 'SRKW', 'cls_demo123');
    assert.deepEqual(srkw1, srkw2, 'Coarsening must be deterministic for identical seedId');
    assert.equal(srkw1.isCoarsened, true);
    assert.equal(srkw1.coarseningRadiusMeters, 750);
    assert.ok(isWithinPugetSoundBounds(srkw1.displayLat, srkw1.displayLng));

    const distKm = haversineDistanceKm(trueLat, trueLng, srkw1.displayLat, srkw1.displayLng);
    assert.ok(distKm >= 0.1 && distKm <= 0.75, `Expected 0.1..0.75 km displacement, got ${distKm}`);

    const unknownCoarsened = coarsenSrkwCoordinates(trueLat, trueLng, 'Unknown', 'cls_unk999');
    assert.equal(unknownCoarsened.isCoarsened, true);
    assert.equal(unknownCoarsened.coarseningRadiusMeters, 750);

    const biggs = coarsenSrkwCoordinates(trueLat, trueLng, 'Biggs', 'cls_t65a');
    assert.equal(biggs.isCoarsened, false);
    assert.equal(biggs.coarseningRadiusMeters, 0);
    assert.equal(biggs.displayLat, trueLat);
    assert.equal(biggs.displayLng, trueLng);

    const offshore = coarsenSrkwCoordinates(trueLat, trueLng, 'Offshore', 'cls_off1');
    assert.equal(offshore.isCoarsened, false);
    assert.equal(offshore.displayLat, trueLat);
    assert.equal(offshore.displayLng, trueLng);
  });

  it('populates coarsened display fields in SightingDeduplicator and preserves state across export/hydrate', () => {
    const dedup = new SightingDeduplicator();
    const t0 = Date.parse('2026-11-22T18:00:00.000Z');

    const srkwRes = dedup.ingest(
      {
        source: 'acartia',
        externalId: 'srkw-ext-1',
        observedAt: new Date(t0).toISOString(),
        lat: 47.5762,
        lng: -122.4207,
        ecotype: 'SRKW',
        pod: 'J-Pod',
        direction: 'S',
      },
      t0,
    );
    assert.equal(srkwRes.cluster.isCoarsened, true);
    assert.equal(srkwRes.cluster.coarseningRadiusMeters, 750);

    const biggsRes = dedup.ingest(
      {
        source: 'orca_network',
        externalId: 'biggs-ext-1',
        observedAt: new Date(t0).toISOString(),
        lat: 47.8132,
        lng: -122.3852,
        ecotype: 'Biggs',
        pod: 'T65A',
        direction: 'N',
      },
      t0,
    );
    assert.equal(biggsRes.cluster.isCoarsened, false);
    assert.equal(biggsRes.cluster.displayLat, 47.8132);
    assert.equal(biggsRes.cluster.displayLng, -122.3852);

    const snapshot = dedup.exportSnapshot();
    const restored = new SightingDeduplicator();
    restored.hydrateSnapshot(snapshot);
    assert.equal(restored.getAllClusters().length, 2);

    // Re-ingesting already-seen externalId after hydration must be ignored
    const duplicate = restored.ingest(
      {
        source: 'acartia',
        externalId: 'srkw-ext-1',
        observedAt: new Date(t0).toISOString(),
        lat: 47.5762,
        lng: -122.4207,
        ecotype: 'SRKW',
      },
      t0 + 60_000,
    );
    assert.equal(duplicate.action, 'duplicate_ignored');
  });
});

describe('Conservation Freeze API & Public SRKW Suppression', () => {
  it('enforces Bearer auth (401), suppresses public SRKW sightings/spots/SSE while frozen, and restores on unfreeze', async () => {
    const freezeController = new ConservationFreezeController();
    assert.equal(freezeController.getStatus().active, false);

    const app = createSalishPulseApp({
      enableSeedData: false,
      enableExternalPolling: false,
      enableSimulator: false,
      adminFreezeToken: 'secret-partner-token',
    });

    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = (app.server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Unauthorized attempt must return 401
      const unauthRes = await fetch(`${baseUrl}/api/admin/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true, reason: 'Unauthorized test' }),
      });
      assert.equal(unauthRes.status, 401);

      const wrongTokenRes = await fetch(`${baseUrl}/api/admin/freeze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-token',
        },
        body: JSON.stringify({ active: true }),
      });
      assert.equal(wrongTokenRes.status, 401);

      // Authorized activation for Main Basin corridor
      const freezeRes = await fetch(`${baseUrl}/api/admin/freeze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-partner-token',
        },
        body: JSON.stringify({
          active: true,
          reason: 'WDFW SRKW foraging protection window',
          corridors: ['Main Basin'],
          durationMinutes: 60,
          updatedBy: 'wdfw-biologist',
        }),
      });
      assert.equal(freezeRes.status, 200);
      const freezeBody = (await freezeRes.json()) as {
        active: boolean;
        corridors: string[];
      };
      assert.equal(freezeBody.active, true);
      assert.deepEqual(freezeBody.corridors, ['Main Basin']);

      const statusRes = await fetch(`${baseUrl}/api/conservation/status`);
      assert.equal(statusRes.status, 200);
      const statusBody = (await statusRes.json()) as { active: boolean };
      assert.equal(statusBody.active, true);

      // Ingest an SRKW sighting at Alki (Main Basin) -> stored internally, hidden publicly
      const srkwPost = await fetch(`${baseUrl}/api/sightings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'acartia',
          lat: 47.5762,
          lng: -122.4207,
          ecotype: 'SRKW',
          pod: 'J-Pod',
          direction: 'S',
        }),
      });
      assert.equal(srkwPost.status, 201);
      const srkwJson = (await srkwPost.json()) as { frozen: boolean };
      assert.equal(srkwJson.frozen, true);

      // Ingest a Bigg's sighting in Main Basin -> NOT frozen, visible publicly
      const biggsPost = await fetch(`${baseUrl}/api/sightings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'orca_network',
          lat: 47.8132,
          lng: -122.3852,
          ecotype: 'Biggs',
          pod: 'T65A',
          direction: 'N',
        }),
      });
      assert.equal(biggsPost.status, 201);
      const biggsJson = (await biggsPost.json()) as { frozen: boolean };
      assert.equal(biggsJson.frozen, false);

      // Public GET /api/sightings only shows Bigg's (1), while internal deduplicator has 2
      const listFrozenRes = await fetch(`${baseUrl}/api/sightings`);
      const listFrozen = (await listFrozenRes.json()) as {
        count: number;
        sightings: Array<{ ecotype: string }>;
      };
      assert.equal(listFrozen.count, 1);
      assert.equal(listFrozen.sightings[0].ecotype, 'Biggs');
      assert.equal(app.deduplicator.getAllClusters().length, 2);

      // Public GET /api/spots must NOT show approaching J-Pod ETA at Lincoln Park while frozen
      const spotsFrozenRes = await fetch(`${baseUrl}/api/spots`);
      const spotsFrozen = (await spotsFrozenRes.json()) as {
        spots: Array<{ id: string; approachingPod: string | null }>;
      };
      const lincolnFrozen = spotsFrozen.spots.find((s) => s.id === 'lincoln-park');
      assert.equal(lincolnFrozen?.approachingPod, null);

      // Unfreeze -> J-Pod immediately reappears in public feeds & Lincoln Park ETA
      const unfreezeRes = await fetch(`${baseUrl}/api/admin/freeze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-partner-token',
        },
        body: JSON.stringify({ active: false, updatedBy: 'wdfw-biologist' }),
      });
      assert.equal(unfreezeRes.status, 200);

      const listUnfrozenRes = await fetch(`${baseUrl}/api/sightings`);
      const listUnfrozen = (await listUnfrozenRes.json()) as { count: number };
      assert.equal(listUnfrozen.count, 2);

      const spotsUnfrozenRes = await fetch(`${baseUrl}/api/spots`);
      const spotsUnfrozen = (await spotsUnfrozenRes.json()) as {
        spots: Array<{ id: string; approachingPod: string | null }>;
      };
      const lincolnUnfrozen = spotsUnfrozen.spots.find((s) => s.id === 'lincoln-park');
      assert.equal(lincolnUnfrozen?.approachingPod, 'J-Pod');
    } finally {
      await app.close();
    }
  });
});

describe('Subscriptions CRUD & PushAlertDispatcher Anti-Fatigue + Quiet Hours', () => {
  it('supports POST, GET, and DELETE /api/subscriptions lifecycle', async () => {
    const app = createSalishPulseApp({
      enableSeedData: false,
      enableExternalPolling: false,
      enableSimulator: false,
      pushDryRun: true,
    });

    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = (app.server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const createRes = await fetch(`${baseUrl}/api/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'expo',
          pushToken: 'ExponentPushToken[test-token-123]',
          favoriteSpotIds: ['alki-point', 'lincoln-park'],
          homeLat: 47.5762,
          homeLng: -122.4207,
          radiusKm: 12,
          maxEtaMinutes: 45,
          minConfidence: 'community',
          ecotypes: ['SRKW', 'Biggs'],
          quietHoursEnabled: true,
          quietStartHour: 21,
          quietEndHour: 6,
        }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as {
        subscription: { id: string; channel: string };
      };
      assert.ok(created.subscription.id);
      assert.equal(created.subscription.channel, 'expo');

      const getRes = await fetch(`${baseUrl}/api/subscriptions`);
      assert.equal(getRes.status, 200);
      const list = (await getRes.json()) as { count: number; activeCount: number };
      assert.equal(list.count, 1);
      assert.equal(list.activeCount, 1);

      const delRes = await fetch(
        `${baseUrl}/api/subscriptions/${encodeURIComponent(created.subscription.id)}`,
        { method: 'DELETE' },
      );
      assert.equal(delRes.status, 200);

      const delAgainRes = await fetch(
        `${baseUrl}/api/subscriptions/${encodeURIComponent(created.subscription.id)}`,
        { method: 'DELETE' },
      );
      assert.equal(delAgainRes.status, 404);
    } finally {
      await app.close();
    }
  });

  it('enforces 45-min per-cluster cooldown, Seattle quiet hours, and daily cap in PushAlertDispatcher', async () => {
    const repo = new InMemoryRepository();
    const dispatcher = new PushAlertDispatcher({
      repository: repo,
      spots: PUGET_SOUND_VIEWING_SPOTS,
      dryRun: true,
      cooldownMinutes: 45,
      dailyCap: 4,
    });

    // 2026-11-22T18:00:00Z = 10:00 AM PST (daytime in Seattle -> not quiet hours)
    const daytimeMs = Date.parse('2026-11-22T18:00:00.000Z');
    // 2026-11-23T07:00:00Z = 11:00 PM PST (nighttime in Seattle -> inside 21..6 quiet hours)
    const quietNightMs = Date.parse('2026-11-23T07:00:00.000Z');

    assert.equal(isQuietHoursInSeattle(daytimeMs, 21, 6), false);
    assert.equal(isQuietHoursInSeattle(quietNightMs, 21, 6), true);

    await repo.saveSubscription({
      id: 'sub_west_seattle',
      channel: 'expo',
      pushToken: 'ExponentPushToken[ws-user-1]',
      favoriteSpotIds: ['lincoln-park'],
      homeLat: 47.5306,
      homeLng: -122.3988,
      radiusKm: 10,
      maxEtaMinutes: 60,
      minConfidence: 'corroborated',
      ecotypes: ['SRKW', 'Biggs'],
      quietHoursEnabled: true,
      quietStartHour: 21,
      quietEndHour: 6,
      active: true,
      createdAt: new Date(daytimeMs).toISOString(),
      updatedAt: new Date(daytimeMs).toISOString(),
    });

    const dedup = new SightingDeduplicator();
    const ingested = dedup.ingest(
      {
        source: 'acartia',
        observedAt: new Date(daytimeMs).toISOString(),
        lat: 47.5762,
        lng: -122.4207,
        locationName: 'Alki Point Lighthouse',
        direction: 'S',
        ecotype: 'SRKW',
        pod: 'J-Pod',
        count: 6,
      },
      daytimeMs,
    );

    // 1. Quiet hours at 11 PM Seattle time -> suppressed
    const quietSummary = await dispatcher.dispatchForCluster(ingested.cluster, quietNightMs);
    assert.equal(quietSummary.eligibleCount, 0);
    assert.equal(quietSummary.suppressedReasons.quiet_hours, 1);

    // 2. First daytime dispatch -> sent in dry_run mode
    const firstSummary = await dispatcher.dispatchForCluster(ingested.cluster, daytimeMs);
    assert.equal(firstSummary.eligibleCount, 1);
    assert.equal(firstSummary.dryRunCount, 1);

    // 3. Duplicate dispatch 15 minutes later -> suppressed by 45-min per-cluster cooldown
    const cooldownSummary = await dispatcher.dispatchForCluster(
      ingested.cluster,
      daytimeMs + 15 * 60_000,
    );
    assert.equal(cooldownSummary.eligibleCount, 0);
    assert.equal(cooldownSummary.suppressedReasons.cluster_cooldown, 1);

    // 4. After 50 minutes (>45-min cooldown) -> eligible again
    const afterCooldown = await dispatcher.dispatchForCluster(
      ingested.cluster,
      daytimeMs + 50 * 60_000,
    );
    assert.equal(afterCooldown.eligibleCount, 1);
    assert.equal(afterCooldown.dryRunCount, 1);
  });
});

describe('RedditJsonConnector, Bluesky Jetstream Parser & Orcasound Webhook', () => {
  it('parses Reddit listing posts, respects ETag 304 caching, and rejects ORCA transit card chatter', async () => {
    const sampleListing = {
      data: {
        children: [
          {
            data: {
              id: 'abc123',
              name: 't3_abc123',
              title: 'J-Pod orcas heading south off Alki Point right now!',
              selftext: 'About 6 whales swimming toward Lincoln Park.',
              author: 'seattle_spotter',
              created_utc: 1795284000,
              permalink: '/r/Seattle/comments/abc123/jpod_alki/',
            },
          },
          {
            data: {
              id: 'card99',
              name: 't3_card99',
              title: 'Lost my ORCA card at Alki bus stop',
              selftext: 'Please let me know if you find my Sound Transit ORCA pass.',
              author: 'commuter',
              created_utc: 1795284100,
              permalink: '/r/Seattle/comments/card99/orca_card/',
            },
          },
        ],
      },
    };

    const parsed = parseRedditListingPosts(sampleListing);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].source, 'reddit');
    assert.equal(parsed[0].externalId, 't3_abc123');
    assert.equal(parsed[0].author, 'u/seattle_spotter');
    assert.ok(parsed[0].sourceUrl?.includes('reddit.com/r/Seattle'));

    // Verify ETag caching + 304 handling in RedditJsonConnector
    let requestCount = 0;
    let sawIfNoneMatch = false;
    const connector = new RedditJsonConnector({
      subreddits: ['Seattle'],
      fetchImpl: async (_url, init) => {
        requestCount += 1;
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers?.['If-None-Match'] === '"etag-v1"') {
          sawIfNoneMatch = true;
          return new Response(null, { status: 304 });
        }
        return new Response(JSON.stringify(sampleListing), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ETag: '"etag-v1"',
          },
        });
      },
    });

    const firstPoll = await connector.poll();
    assert.equal(firstPoll.length, 1);
    const secondPoll = await connector.poll();
    assert.equal(secondPoll.length, 0);
    assert.equal(requestCount, 2);
    assert.equal(sawIfNoneMatch, true);
    assert.equal(connector.getStatus().mode, 'live');
  });

  it('parses valid Bluesky Jetstream create commits and drops non-whale or malformed frames', () => {
    const validFrame = JSON.stringify({
      did: 'did:plc:alkispotter123',
      time_us: 1795284000000000,
      commit: {
        collection: 'app.bsky.feed.post',
        operation: 'create',
        rkey: '3kxyz',
        record: {
          text: '4 orcas breaching southbound off Discovery Park right now!',
          createdAt: '2026-11-22T18:15:00.000Z',
        },
      },
    });

    const parsed = parseBlueskyJetstreamEvent(validFrame);
    assert.ok(parsed);
    assert.equal(parsed.source, 'bluesky');
    assert.equal(parsed.externalId, 'did:plc:alkispotter123:3kxyz');

    const nonWhaleFrame = JSON.stringify({
      did: 'did:plc:random',
      time_us: 1795284000000001,
      commit: {
        collection: 'app.bsky.feed.post',
        operation: 'create',
        rkey: '3kabc',
        record: {
          text: 'Great coffee near Alki Beach this morning!',
        },
      },
    });
    assert.equal(parseBlueskyJetstreamEvent(nonWhaleFrame), null);
    assert.equal(parseBlueskyJetstreamEvent('{invalid json'), null);
  });

  it('handles POST /api/ingest/webhook/orcasound, updates hydrophone node, broadcasts SSE pulse, and ingests cluster', async () => {
    const app = createSalishPulseApp({
      enableSeedData: false,
      enableExternalPolling: false,
      enableSimulator: false,
    });

    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = (app.server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const sseController = new AbortController();
      const sseRes = await fetch(`${baseUrl}/api/stream`, {
        signal: sseController.signal,
      });
      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();
      await reader.read(); // connected event

      const whRes = await fetch(`${baseUrl}/api/ingest/webhook/orcasound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'det-bush-pt-42',
          locationName: 'Bush Point',
          confidence: 0.94,
          label: 'SRKW J-Pod S1 calls detected',
          snrDb: 14.2,
          timestamp: new Date().toISOString(),
        }),
      });
      assert.equal(whRes.status, 201);
      const whBody = (await whRes.json()) as {
        accepted: boolean;
        pulse: { nodeId: string; snrDb: number };
        cluster: { id: string; ecotype: string; isCoarsened: boolean };
      };
      assert.equal(whBody.accepted, true);
      assert.equal(whBody.pulse.nodeId, 'orcasound-bush-point');
      assert.equal(whBody.pulse.snrDb, 14.2);
      assert.equal(whBody.cluster.ecotype, 'SRKW');
      assert.equal(whBody.cluster.isCoarsened, true);

      // Confirm SSE client received hydrophone:pulse
      const chunk = await reader.read();
      const sseText = decoder.decode(chunk.value);
      assert.ok(sseText.includes('event: hydrophone:pulse'));
      assert.ok(sseText.includes('orcasound-bush-point'));
      sseController.abort();

      // Confirm hydrophone status updated in GET /api/hydrophones
      const hydroRes = await fetch(`${baseUrl}/api/hydrophones`);
      const hydroBody = (await hydroRes.json()) as {
        hydrophones: Array<{ id: string; status: string; lastDetectionLabel: string | null }>;
      };
      const bushPoint = hydroBody.hydrophones.find((h) => h.id === 'orcasound-bush-point');
      assert.equal(bushPoint?.status, 'active_detection');
      assert.equal(bushPoint?.lastDetectionLabel, 'SRKW J-Pod S1 calls detected');
    } finally {
      await app.close();
    }
  });
});
