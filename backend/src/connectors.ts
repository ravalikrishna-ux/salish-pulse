import { isWithinPugetSoundBounds } from './geo.ts';
import { parseSightingText } from './nlpParser.ts';
import type {
  Ecotype,
  HydrophoneNode,
  HydrophonePulseEvent,
  RawSightingInput,
  TravelDirection,
} from './types.ts';

export interface ConnectorStatus {
  name: string;
  mode: 'live' | 'fallback_offline' | 'simulator';
  lastPollAt: string | null;
  lastError: string | null;
  ingestedCount: number;
}

export interface IngestionConnector {
  readonly name: string;
  getStatus(): ConnectorStatus;
  poll(): Promise<RawSightingInput[]>;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs = 4000,
  headers: Record<string, string> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SalishPulse/1.0 (+https://salishpulse.app)',
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEcotypeHint(raw?: string): Ecotype {
  if (!raw) return 'Unknown';
  const lower = raw.toLowerCase();
  if (lower.includes('srkw') || lower.includes('southern resident') || lower.includes('resident')) {
    return 'SRKW';
  }
  if (lower.includes('bigg') || lower.includes('transient')) {
    return 'Biggs';
  }
  if (lower.includes('offshore')) {
    return 'Offshore';
  }
  return 'Unknown';
}

function normalizeDirectionHint(raw?: string): TravelDirection {
  if (!raw) return 'Unknown';
  const upper = raw.trim().toUpperCase();
  const valid: TravelDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  if ((valid as string[]).includes(upper)) return upper as TravelDirection;
  const lower = raw.toLowerCase();
  if (lower.includes('mill')) return 'Milling';
  if (lower.includes('north')) return 'N';
  if (lower.includes('south')) return 'S';
  if (lower.includes('east')) return 'E';
  if (lower.includes('west')) return 'W';
  return 'Unknown';
}

/**
 * Live Acartia REST connector (`https://acartia.io/api/v1/sightings`) with
 * graceful offline/network-restricted degradation.
 */
export class AcartiaConnector implements IngestionConnector {
  readonly name = 'acartia';
  private readonly endpointUrl: string;
  private readonly apiToken?: string;
  private status: ConnectorStatus = {
    name: 'acartia',
    mode: 'live',
    lastPollAt: null,
    lastError: null,
    ingestedCount: 0,
  };

  constructor(options: { endpointUrl?: string; apiToken?: string } = {}) {
    this.endpointUrl =
      options.endpointUrl ?? 'https://acartia.io/api/v1/sightings';
    this.apiToken = options.apiToken;
  }

  getStatus(): ConnectorStatus {
    return { ...this.status };
  }

  async poll(): Promise<RawSightingInput[]> {
    this.status.lastPollAt = new Date().toISOString();
    try {
      const headers: Record<string, string> = {};
      if (this.apiToken) {
        headers.Authorization = `Bearer ${this.apiToken}`;
      }

      const payload = await fetchJsonWithTimeout<unknown>(
        this.endpointUrl,
        4000,
        headers,
      );

      const records = Array.isArray(payload)
        ? payload
        : typeof payload === 'object' &&
            payload !== null &&
            'data' in payload &&
            Array.isArray((payload as { data: unknown[] }).data)
          ? (payload as { data: unknown[] }).data
          : [];

      const normalized: RawSightingInput[] = [];
      for (const item of records) {
        if (typeof item !== 'object' || item === null) continue;
        const rec = item as Record<string, unknown>;
        const species = String(rec.type ?? rec.species ?? '').toLowerCase();
        if (species && !species.includes('orca') && !species.includes('killer')) {
          continue;
        }

        const lat = Number(rec.latitude ?? rec.lat);
        const lng = Number(rec.longitude ?? rec.lng ?? rec.lon);
        if (!isWithinPugetSoundBounds(lat, lng)) continue;

        const comment = String(rec.data_source_comments ?? rec.comments ?? rec.notes ?? '');
        normalized.push({
          source: 'acartia',
          externalId: String(rec.ssemmi_id ?? rec.id ?? `${lat}_${lng}_${rec.created}`),
          observedAt:
            typeof rec.created === 'string'
              ? rec.created
              : typeof rec.observed_at === 'string'
                ? rec.observed_at
                : new Date().toISOString(),
          lat,
          lng,
          locationName: typeof rec.location === 'string' ? rec.location : undefined,
          ecotype: normalizeEcotypeHint(String(rec.ecotype ?? species)),
          pod: typeof rec.pod === 'string' ? rec.pod : undefined,
          count:
            typeof rec.no_sighted === 'number'
              ? rec.no_sighted
              : typeof rec.count === 'number'
                ? rec.count
                : undefined,
          direction: normalizeDirectionHint(
            typeof rec.direction === 'string' ? rec.direction : undefined,
          ),
          rawText: comment || `Acartia sighting (${species || 'orca'})`,
          author: String(rec.data_source_name ?? 'Acartia'),
        });
      }

      this.status.mode = 'live';
      this.status.lastError = null;
      this.status.ingestedCount += normalized.length;
      return normalized;
    } catch (err) {
      this.status.mode = 'fallback_offline';
      this.status.lastError = err instanceof Error ? err.message : String(err);
      return [];
    }
  }
}

export interface OrcaHelloDetectionPayload {
  id: string;
  locationName: string;
  nodeId?: string;
  timestamp: string;
  confidence: number;
  label?: string;
  snrDb?: number;
  lat?: number;
  lng?: number;
}

/**
 * Structured adapter for Orcasound / OrcaHello hydrophone detections.
 * Supports both live API polling (with graceful offline fallback) and
 * direct webhook normalization.
 */
export class OrcasoundConnector implements IngestionConnector {
  readonly name = 'orcasound';
  private readonly endpointUrl: string;
  private readonly hydrophones: HydrophoneNode[];
  private status: ConnectorStatus = {
    name: 'orcasound',
    mode: 'live',
    lastPollAt: null,
    lastError: null,
    ingestedCount: 0,
  };

  constructor(
    hydrophones: HydrophoneNode[],
    options: { endpointUrl?: string } = {},
  ) {
    this.hydrophones = hydrophones;
    this.endpointUrl =
      options.endpointUrl ??
      'https://aifororcasdetections.azurewebsites.net/api/detections?timeframe=1d&limit=15';
  }

  getStatus(): ConnectorStatus {
    return { ...this.status };
  }

  normalizeDetection(
    det: OrcaHelloDetectionPayload,
  ): { sighting: RawSightingInput; pulse: HydrophonePulseEvent } | null {
    const matchedNode = this.hydrophones.find(
      (h) =>
        h.id === det.nodeId ||
        h.name.toLowerCase().includes(det.locationName.toLowerCase()) ||
        det.locationName.toLowerCase().includes(h.name.toLowerCase().split(' ')[0]),
    );

    const lat = det.lat ?? matchedNode?.lat;
    const lng = det.lng ?? matchedNode?.lng;
    if (lat === undefined || lng === undefined || !isWithinPugetSoundBounds(lat, lng)) {
      return null;
    }

    const label = det.label ?? 'Orca vocalizations detected';
    const pulse: HydrophonePulseEvent = {
      nodeId: matchedNode?.id ?? `orcasound-${det.id}`,
      nodeName: matchedNode?.name ?? det.locationName,
      corridor: matchedNode?.corridor ?? 'Admiralty Inlet',
      detectedAt: det.timestamp,
      label,
      confidence: det.confidence,
      snrDb: det.snrDb ?? 12.0,
      lat,
      lng,
    };

    const sighting: RawSightingInput = {
      source: 'orcasound',
      externalId: `orcahello-${det.id}`,
      observedAt: det.timestamp,
      lat,
      lng,
      locationName: pulse.nodeName,
      ecotype: normalizeEcotypeHint(label),
      behaviors: ['vocalizing'],
      rawText: `OrcaHello hydrophone detection at ${pulse.nodeName}: ${label} (${Math.round(det.confidence * 100)}% model confidence).`,
      author: 'OrcaHello AI',
    };

    return { sighting, pulse };
  }

  async poll(): Promise<RawSightingInput[]> {
    this.status.lastPollAt = new Date().toISOString();
    try {
      const payload = await fetchJsonWithTimeout<unknown>(this.endpointUrl, 4000);
      const list = Array.isArray(payload) ? payload : [];
      const results: RawSightingInput[] = [];

      for (const item of list) {
        if (typeof item !== 'object' || item === null) continue;
        const rec = item as Record<string, unknown>;
        const normalized = this.normalizeDetection({
          id: String(rec.id ?? Date.now()),
          locationName: String(rec.locationName ?? rec.location ?? 'Bush Point'),
          timestamp:
            typeof rec.timestamp === 'string'
              ? rec.timestamp
              : new Date().toISOString(),
          confidence:
            typeof rec.confidence === 'number'
              ? rec.confidence > 1
                ? rec.confidence / 100
                : rec.confidence
              : 0.85,
          label: typeof rec.comments === 'string' ? rec.comments : 'SRKW calls',
        });
        if (normalized) {
          results.push(normalized.sighting);
        }
      }

      this.status.mode = 'live';
      this.status.lastError = null;
      this.status.ingestedCount += results.length;
      return results;
    } catch (err) {
      this.status.mode = 'fallback_offline';
      this.status.lastError = err instanceof Error ? err.message : String(err);
      return [];
    }
  }
}

export interface BlueskyJetstreamCommit {
  did: string;
  time_us: number;
  commit?: {
    collection?: string;
    operation?: string;
    rkey?: string;
    record?: {
      text?: string;
      createdAt?: string;
    };
  };
}

const BLUESKY_WHALE_PREFILTER_REGEX =
  /\b(orca|orcas|killer\s+whale|whale|whales|j-?pod|k-?pod|l-?pod|srkw|bigg'?s|t\d{2,3}[a-z]?|puget\s+sound|salish\s+sea)\b/i;

/**
 * Parses a raw Bluesky Jetstream WebSocket JSON frame into a `RawSightingInput`.
 * Applies a fast keyword pre-filter before running `parseSightingText` so high-volume
 * firehose streams discard non-whale posts in microseconds.
 */
export function parseBlueskyJetstreamEvent(rawJson: string): RawSightingInput | null {
  let frame: BlueskyJetstreamCommit;
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (typeof parsed !== 'object' || parsed === null) return null;
    frame = parsed as BlueskyJetstreamCommit;
  } catch {
    return null;
  }

  if (
    frame.commit?.collection !== 'app.bsky.feed.post' ||
    frame.commit?.operation !== 'create'
  ) {
    return null;
  }

  const text = frame.commit.record?.text ?? '';
  if (!text || !BLUESKY_WHALE_PREFILTER_REGEX.test(text)) {
    return null;
  }

  const sighting = parseSightingText(text);
  if (!sighting.isLiveSighting || sighting.lat === null || sighting.lng === null) {
    return null;
  }

  return {
    source: 'bluesky',
    externalId: `${frame.did}:${frame.commit.rkey ?? frame.time_us}`,
    observedAt: frame.commit.record?.createdAt ?? new Date().toISOString(),
    rawText: text,
    author: frame.did,
  };
}

/**
 * Bluesky public search + Jetstream WebSocket post adapter routed through nlpParser.
 */
export class BlueskySocialConnector implements IngestionConnector {
  readonly name = 'bluesky';
  private readonly queryUrl: string;
  private status: ConnectorStatus = {
    name: 'bluesky',
    mode: 'live',
    lastPollAt: null,
    lastError: null,
    ingestedCount: 0,
  };

  constructor(options: { query?: string } = {}) {
    const q = encodeURIComponent(options.query ?? 'orcas puget sound OR alki OR vashon');
    this.queryUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${q}&limit=20&sort=latest`;
  }

  getStatus(): ConnectorStatus {
    return { ...this.status };
  }

  /**
   * Parses a single Bluesky Jetstream WebSocket frame into a RawSightingInput
   * if it describes a valid live Puget Sound orca sighting.
   */
  parseJetstreamCommit(frame: BlueskyJetstreamCommit): RawSightingInput | null {
    if (
      frame.commit?.collection !== 'app.bsky.feed.post' ||
      frame.commit?.operation !== 'create'
    ) {
      return null;
    }

    const text = frame.commit.record?.text ?? '';
    if (!text || !BLUESKY_WHALE_PREFILTER_REGEX.test(text)) {
      return null;
    }

    const parsed = parseSightingText(text);
    if (!parsed.isLiveSighting || parsed.lat === null || parsed.lng === null) {
      return null;
    }

    return {
      source: 'bluesky',
      externalId: `${frame.did}:${frame.commit.rkey ?? frame.time_us}`,
      observedAt: frame.commit.record?.createdAt ?? new Date().toISOString(),
      rawText: text,
      author: frame.did,
    };
  }

  async poll(): Promise<RawSightingInput[]> {
    this.status.lastPollAt = new Date().toISOString();
    try {
      const payload = await fetchJsonWithTimeout<{
        posts?: Array<{
          uri?: string;
          author?: { handle?: string };
          record?: { text?: string; createdAt?: string };
        }>;
      }>(this.queryUrl, 4000);

      const posts = payload.posts ?? [];
      const results: RawSightingInput[] = [];

      for (const post of posts) {
        const text = post.record?.text ?? '';
        const parsed = parseSightingText(text);
        if (!parsed.isLiveSighting || parsed.lat === null || parsed.lng === null) {
          continue;
        }
        results.push({
          source: 'bluesky',
          externalId: post.uri ?? `${post.author?.handle ?? 'bsky'}:${post.record?.createdAt}`,
          observedAt: post.record?.createdAt ?? new Date().toISOString(),
          rawText: text,
          author: post.author?.handle ? `@${post.author.handle}` : 'Bluesky user',
        });
      }

      this.status.mode = 'live';
      this.status.lastError = null;
      this.status.ingestedCount += results.length;
      return results;
    } catch (err) {
      this.status.mode = 'fallback_offline';
      this.status.lastError = err instanceof Error ? err.message : String(err);
      return [];
    }
  }
}

export interface RedditListingPayload {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        name?: string;
        title?: string;
        selftext?: string;
        author?: string;
        created_utc?: number;
        permalink?: string;
        subreddit?: string;
      };
    }>;
  };
}

/**
 * Deterministically extracts valid live Puget Sound orca sightings from a Reddit
 * JSON listing payload (`r/Seattle`, `r/SeattleWA`, etc.).
 */
export function parseRedditListingPosts(payload: unknown): RawSightingInput[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const listing = payload as RedditListingPayload;
  const children = listing.data?.children;
  if (!Array.isArray(children)) return [];

  const results: RawSightingInput[] = [];
  for (const child of children) {
    const post = child?.data;
    if (!post) continue;

    const title = typeof post.title === 'string' ? post.title.trim() : '';
    const selftext = typeof post.selftext === 'string' ? post.selftext.trim() : '';
    const combined = [title, selftext].filter(Boolean).join('. ');
    if (!combined) continue;

    const parsed = parseSightingText(combined);
    if (!parsed.isLiveSighting || parsed.lat === null || parsed.lng === null) {
      continue;
    }

    const externalId =
      typeof post.name === 'string' && post.name
        ? post.name
        : typeof post.id === 'string' && post.id
          ? `t3_${post.id}`
          : `reddit_${post.created_utc ?? Date.now()}`;

    const observedAt =
      typeof post.created_utc === 'number' && Number.isFinite(post.created_utc)
        ? new Date(post.created_utc * 1000).toISOString()
        : new Date().toISOString();

    results.push({
      source: 'reddit',
      externalId,
      observedAt,
      rawText: combined,
      author:
        typeof post.author === 'string' && post.author
          ? `u/${post.author}`
          : 'Reddit user',
      sourceUrl:
        typeof post.permalink === 'string' && post.permalink.startsWith('/')
          ? `https://www.reddit.com${post.permalink}`
          : undefined,
    });
  }

  return results;
}

/**
 * Sanctioned Reddit JSON search connector polling `r/Seattle` and `r/SeattleWA`
 * with polite User-Agent, conditional `ETag` caching, and graceful offline fallback.
 */
export class RedditJsonConnector implements IngestionConnector {
  readonly name = 'reddit';
  private readonly urls: string[];
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly etags = new Map<string, string>();
  private status: ConnectorStatus = {
    name: 'reddit',
    mode: 'live',
    lastPollAt: null,
    lastError: null,
    ingestedCount: 0,
  };

  constructor(
    options: {
      subreddits?: string[];
      query?: string;
      userAgent?: string;
      fetchImpl?: typeof fetch;
    } = {},
  ) {
    const subreddits = options.subreddits ?? ['Seattle', 'SeattleWA'];
    const query = encodeURIComponent(options.query ?? 'orca OR orcas OR "killer whale"');
    this.urls = subreddits.map(
      (sub) =>
        `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${query}&restrict_sr=1&sort=new&t=day&limit=15`,
    );
    this.userAgent =
      options.userAgent ?? 'SalishPulse/1.0 (Puget Sound Orca Conservation; +https://salishpulse.app)';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getStatus(): ConnectorStatus {
    return { ...this.status };
  }

  async poll(): Promise<RawSightingInput[]> {
    this.status.lastPollAt = new Date().toISOString();
    const collected: RawSightingInput[] = [];
    let succeededCount = 0;
    let lastErr: string | null = null;

    for (const url of this.urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        };
        const cachedEtag = this.etags.get(url);
        if (cachedEtag) {
          headers['If-None-Match'] = cachedEtag;
        }

        const response = await this.fetchImpl(url, {
          headers,
          signal: controller.signal,
        });

        if (response.status === 304) {
          succeededCount += 1;
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const etag = response.headers.get('etag');
        if (etag) {
          this.etags.set(url, etag);
        }

        const payload = (await response.json()) as unknown;
        const parsed = parseRedditListingPosts(payload);
        collected.push(...parsed);
        succeededCount += 1;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }
    }

    if (succeededCount > 0) {
      this.status.mode = 'live';
      this.status.lastError = lastErr;
      this.status.ingestedCount += collected.length;
    } else {
      this.status.mode = 'fallback_offline';
      this.status.lastError = lastErr ?? 'All Reddit endpoints unreachable';
    }

    return collected;
  }
}

interface SimulatorWaypoint {
  lat: number;
  lng: number;
  locationName: string;
  direction: TravelDirection;
  rawText: string;
  source: RawSightingInput['source'];
  author: string;
  ecotype: Ecotype;
  pod: string;
  count: number;
}

const SIMULATOR_TRACK: SimulatorWaypoint[] = [
  {
    lat: 47.5718,
    lng: -122.4215,
    locationName: 'Constellation Park',
    direction: 'S',
    rawText: 'J-Pod still southbound off Constellation Park! At least 6 orcas with two huge dorsal fins.',
    source: 'citizen',
    author: 'WestSeattleSpotter',
    ecotype: 'SRKW',
    pod: 'J-Pod',
    count: 6,
  },
  {
    lat: 47.5515,
    lng: -122.4122,
    locationName: 'Lowman Beach / North Lincoln Park',
    direction: 'S',
    rawText: 'Spotted J-Pod heading south approaching Lincoln Park! Spyhopping right outside the ferry lane.',
    source: 'bluesky',
    author: '@alkiwhales.bsky.social',
    ecotype: 'SRKW',
    pod: 'J-Pod',
    count: 6,
  },
  {
    lat: 47.5322,
    lng: -122.4045,
    locationName: 'Lincoln Park (Colman Pool Shoreline)',
    direction: 'S',
    rawText: '6 Southern Residents (J-Pod) passing right in front of Lincoln Park seawall heading south toward Fauntleroy!',
    source: 'citizen',
    author: 'PugetSoundWatcher',
    ecotype: 'SRKW',
    pod: 'J-Pod',
    count: 6,
  },
  {
    lat: 47.5142,
    lng: -122.4021,
    locationName: 'Fauntleroy Cove / Ferry Dock',
    direction: 'S',
    rawText: 'Ferries slowing down — J-Pod southbound past Fauntleroy entering East Passage toward Point Robinson.',
    source: 'orca_network',
    author: 'Orca Network Relay',
    ecotype: 'SRKW',
    pod: 'J-Pod',
    count: 7,
  },
  {
    lat: 47.4521,
    lng: -122.3885,
    locationName: 'Three Tree Point (Burien)',
    direction: 'S',
    rawText: 'J-Pod steady southbound off Three Tree Point mid-channel, heading straight toward Point Robinson!',
    source: 'bluesky',
    author: '@vashonwatcher.bsky.social',
    ecotype: 'SRKW',
    pod: 'J-Pod',
    count: 7,
  },
  {
    lat: 47.3928,
    lng: -122.3712,
    locationName: 'Point Robinson Lighthouse (Vashon)',
    direction: 'S',
    rawText: 'Incredible close pass at Point Robinson Lighthouse — J-Pod foraging and breaching southbound!',
    source: 'acartia',
    author: 'Vashon Marine Naturalist',
    ecotype: 'SRKW',
    pod: 'J-Pod',
    count: 7,
  },
];

/**
 * Optional realistic Puget Sound movement & acoustic pulse simulator so the
 * frontend demonstrates live SSE streaming & shifting shore ETAs out of the box.
 */
export class LiveSimulatorConnector implements IngestionConnector {
  readonly name = 'simulator';
  private stepIndex = 0;
  private status: ConnectorStatus = {
    name: 'simulator',
    mode: 'simulator',
    lastPollAt: null,
    lastError: null,
    ingestedCount: 0,
  };

  getStatus(): ConnectorStatus {
    return { ...this.status };
  }

  async poll(): Promise<RawSightingInput[]> {
    const wp = SIMULATOR_TRACK[this.stepIndex % SIMULATOR_TRACK.length];
    const seq = this.stepIndex++;
    this.status.lastPollAt = new Date().toISOString();
    this.status.ingestedCount += 1;

    return [
      {
        source: wp.source,
        externalId: `sim-jpod-${seq}-${Date.now()}`,
        observedAt: new Date().toISOString(),
        lat: wp.lat,
        lng: wp.lng,
        locationName: wp.locationName,
        direction: wp.direction,
        speedKnots: 4.6,
        ecotype: wp.ecotype,
        pod: wp.pod,
        count: wp.count,
        rawText: wp.rawText,
        author: wp.author,
      },
    ];
  }

  nextHydrophonePulse(hydrophones: HydrophoneNode[]): HydrophonePulseEvent {
    const node = hydrophones[this.stepIndex % hydrophones.length];
    return {
      nodeId: node.id,
      nodeName: node.name,
      corridor: node.corridor,
      detectedAt: new Date().toISOString(),
      label:
        node.corridor === 'East Passage'
          ? 'SRKW J-Pod echolocation clicks & S1 calls'
          : 'OrcaHello acoustic pulse detected',
      confidence: 0.91,
      snrDb: Number((10.5 + (this.stepIndex % 5) * 1.1).toFixed(1)),
      lat: node.lat,
      lng: node.lng,
    };
  }
}
