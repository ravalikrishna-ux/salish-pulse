import {
  AlertPreferences,
  ConfidenceTier,
  ConservationFreezeStatus,
  Ecotype,
  HydrophoneNode,
  Sighting,
  SourceType,
  TravelDirection,
} from '../types';

const RAW_API_BASE =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_URL : undefined;
const DEFAULT_API_BASE =
  RAW_API_BASE === 'same-origin' ? '' : RAW_API_BASE || 'http://localhost:4000';

const BACKEND_SOURCE_MAP: Record<string, SourceType> = {
  acartia: 'acartia_orca_network',
  orca_network: 'acartia_orca_network',
  orcasound: 'orcasound_hydrophone',
  bluesky: 'bluesky',
  reddit: 'reddit',
  west_seattle_blog: 'west_seattle_blog',
  wsf_ferry: 'wsf_ferry',
  citizen: 'citizen_app',
  simulator: 'citizen_app',
};

const TO_BACKEND_SOURCE: Record<SourceType, string> = {
  acartia_orca_network: 'acartia',
  orcasound_hydrophone: 'orcasound',
  bluesky: 'bluesky',
  reddit: 'reddit',
  west_seattle_blog: 'bluesky',
  wsf_ferry: 'citizen',
  citizen_app: 'citizen',
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSightingsFromBackend(): Promise<Sighting[] | null> {
  try {
    const res = await fetchWithTimeout(`${DEFAULT_API_BASE}/api/sightings`, {}, 1800);
    if (!res.ok) return null;
    const json = await res.json();
    const items = Array.isArray(json) ? json : json.sightings ?? json.clusters;
    if (!Array.isArray(items)) return null;
    return items.map(normalizeBackendSighting);
  } catch {
    return null;
  }
}

export async function fetchHydrophonesFromBackend(): Promise<HydrophoneNode[] | null> {
  try {
    const res = await fetchWithTimeout(`${DEFAULT_API_BASE}/api/hydrophones`, {}, 1800);
    if (!res.ok) return null;
    const json = await res.json();
    const items = Array.isArray(json) ? json : json.hydrophones;
    if (!Array.isArray(items)) return null;
    return items.map((h: Record<string, any>): HydrophoneNode => ({
      id: String(h.id),
      name: String(h.name),
      region: String(h.region ?? h.corridor ?? 'Puget Sound'),
      lat: Number(h.lat),
      lng: Number(h.lng),
      status:
        h.status === 'active_detection' || h.status === 'detecting'
          ? 'detecting'
          : h.status === 'offline'
            ? 'maintenance'
            : 'online',
      lastDetectionIso: h.lastDetectionAt ?? h.lastDetectionIso ?? undefined,
      lastDetectionSummary: h.lastDetectionLabel ?? h.lastDetectionSummary ?? undefined,
      streamUrl: String(h.streamUrl ?? 'https://live.orcasound.net/listen'),
    }));
  } catch {
    return null;
  }
}

export async function fetchConservationStatusFromBackend(): Promise<ConservationFreezeStatus | null> {
  try {
    const res = await fetchWithTimeout(`${DEFAULT_API_BASE}/api/conservation/status`, {}, 1800);
    if (!res.ok) return null;
    const json = await res.json();
    const status = json.freeze ?? json;
    return {
      active: Boolean(status.active),
      reason: status.reason ?? null,
      corridors: Array.isArray(status.corridors) ? status.corridors : [],
      expiresAt: status.expiresAt ?? null,
      updatedBy: status.updatedBy ?? null,
    };
  } catch {
    return null;
  }
}

export async function syncSubscriptionToBackend(
  prefs: AlertPreferences,
  registration: { id?: string; channel: 'expo' | 'web_push'; token: string }
): Promise<string | null> {
  try {
    const ecotypes: string[] = [];
    if (prefs.includeSrkw) ecotypes.push('SRKW');
    if (prefs.includeBiggs) ecotypes.push('Biggs');

    const res = await fetchWithTimeout(
      `${DEFAULT_API_BASE}/api/subscriptions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: registration.id,
          channel: registration.channel,
          pushToken: registration.token,
          favoriteSpotIds: prefs.favoriteSpotIds,
          maxEtaMinutes: prefs.maxEtaMinutes,
          minConfidence: prefs.minConfidence,
          ecotypes,
          quietHoursEnabled: prefs.quietHoursEnabled,
          active: prefs.enabled,
        }),
      },
      2200
    );
    if (!res.ok) return null;
    const json = await res.json();
    return String(json.subscription?.id ?? json.id ?? '');
  } catch {
    return null;
  }
}

export async function postSocialOrSightingToBackend(payload: {
  text: string;
  source: SourceType;
  handle: string;
}): Promise<{ ok: true; sighting: Sighting } | { ok: false; rejectedReason?: string } | null> {
  try {
    const res = await fetchWithTimeout(
      `${DEFAULT_API_BASE}/api/ingest/social`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: payload.text,
          source: TO_BACKEND_SOURCE[payload.source] ?? 'citizen',
          author: payload.handle,
        }),
      },
      2200
    );
    const json = await res.json().catch(() => ({}));
    if (res.status === 422 || json.accepted === false) {
      return {
        ok: false,
        rejectedReason: json.reason ?? json.error ?? 'Filtered as non-sighting post',
      };
    }
    if (!res.ok) return null;
    const item = json.cluster ?? json.sighting ?? json.data ?? json;
    return item && item.lat && item.lng
      ? { ok: true, sighting: normalizeBackendSighting(item) }
      : null;
  } catch {
    return null;
  }
}

export function subscribeToLiveStream(
  onSighting: (sighting: Sighting) => void,
  onStatusChange?: (connected: boolean) => void
): () => void {
  if (typeof EventSource === 'undefined') {
    onStatusChange?.(false);
    return () => {};
  }

  let closed = false;
  let es: EventSource | null = null;

  try {
    es = new EventSource(`${DEFAULT_API_BASE}/api/stream`);
    es.onopen = () => {
      if (!closed) onStatusChange?.(true);
    };
    es.onerror = () => {
      if (!closed) onStatusChange?.(false);
      es?.close();
    };
    const handleEvent = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data);
        const cluster = parsed.data ?? parsed.cluster ?? parsed.sighting ?? parsed;
        if (cluster && cluster.lat && cluster.lng) {
          onSighting(normalizeBackendSighting(cluster));
        }
      } catch {
        // Ignore heartbeat frames
      }
    };
    es.addEventListener('sighting:new', handleEvent as EventListener);
    es.addEventListener('sighting:corroborated', handleEvent as EventListener);
  } catch {
    onStatusChange?.(false);
  }

  return () => {
    closed = true;
    es?.close();
  };
}

function mapEcotype(raw: unknown): Ecotype {
  const s = String(raw ?? 'Unknown').toUpperCase();
  if (s === 'SRKW') return 'SRKW';
  if (s === 'BIGGS') return 'BIGGS';
  if (s === 'HUMPBACK') return 'HUMPBACK';
  if (s === 'GRAY') return 'GRAY';
  return 'UNKNOWN';
}

function mapDirection(raw: unknown): TravelDirection {
  const s = String(raw ?? 'UNKNOWN').toUpperCase();
  const valid: TravelDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'MILLING', 'UNKNOWN'];
  return valid.includes(s as TravelDirection) ? (s as TravelDirection) : 'UNKNOWN';
}

function mapConfidence(rawTier: unknown, sources: SourceType[]): ConfidenceTier {
  if (sources.length === 1 && sources[0] === 'orcasound_hydrophone') return 'acoustic';
  const s = String(rawTier ?? 'community').toLowerCase();
  if (s === 'verified') return 'verified';
  if (s === 'corroborated') return 'corroborated';
  if (s === 'acoustic') return 'acoustic';
  return 'community';
}

function normalizeBackendSighting(raw: Record<string, any>): Sighting {
  const rawSources: string[] = Array.isArray(raw.sources)
    ? raw.sources
    : [String(raw.source ?? 'citizen')];
  const sources: SourceType[] = Array.from(
    new Set(rawSources.map((src) => BACKEND_SOURCE_MAP[src] ?? 'citizen_app'))
  );

  const ecotype = mapEcotype(raw.ecotype);
  const direction = mapDirection(raw.direction);
  const podId = raw.pod ?? raw.podId ?? undefined;
  const locationName = String(raw.locationName ?? 'Puget Sound');
  const latestReport = Array.isArray(raw.reports) ? raw.reports[raw.reports.length - 1] : undefined;

  return {
    id: String(raw.id ?? `s-${Date.now()}`),
    title:
      raw.title ??
      `${podId || (ecotype === 'SRKW' ? 'Southern Residents' : ecotype === 'BIGGS' ? "Bigg's Orcas" : 'Orcas')} near ${locationName}`,
    locationName,
    waterway: String(raw.corridor ?? raw.waterway ?? 'Main Basin'),
    lat: Number(raw.lat ?? 47.5764),
    lng: Number(raw.lng ?? -122.4207),
    displayLat: typeof raw.displayLat === 'number' ? raw.displayLat : undefined,
    displayLng: typeof raw.displayLng === 'number' ? raw.displayLng : undefined,
    isCoarsened: Boolean(raw.isCoarsened),
    coarseningRadiusMeters:
      typeof raw.coarseningRadiusMeters === 'number' ? raw.coarseningRadiusMeters : undefined,
    ecotype,
    podId,
    estimatedCount: Number(raw.count ?? raw.estimatedCount ?? 4),
    direction,
    speedKnots: Number(raw.speedKnots ?? 4.5),
    confidence: mapConfidence(raw.confidenceTier ?? raw.confidence, sources),
    corroborationCount: Number(raw.corroborationCount ?? 1),
    sources,
    timestamp: String(raw.lastSeenAt ?? raw.timestamp ?? new Date().toISOString()),
    summary: String(raw.summary ?? latestReport?.rawText ?? 'Live Puget Sound sighting'),
    rawExcerpt: raw.rawExcerpt ?? latestReport?.rawText,
    reporterHandle: raw.reporterHandle ?? latestReport?.author,
    hydrophoneNodeId: raw.hydrophoneNodeId,
  };
}
