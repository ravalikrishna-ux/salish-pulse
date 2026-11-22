import { bearingDegrees, bearingToDirection, isWithinPugetSoundBounds } from './geo.ts';
import { PUGET_SOUND_LANDMARKS } from './pugetSoundCatalog.ts';
import type {
  Ecotype,
  ParsedSighting,
  PugetSoundLandmark,
  TravelDirection,
} from './types.ts';

/**
 * Optional structured-output LLM adapter for upgrading ambiguous posts to
 * Gemini 2.5 Flash-Lite, Claude Haiku, or GPT-4o-mini in production.
 */
export interface LlmExtractorAdapter {
  readonly modelName: string;
  extract(rawText: string): Promise<Partial<ParsedSighting> | null>;
}

interface LandmarkMatch {
  landmark: PugetSoundLandmark;
  alias: string;
  index: number;
  isDestination: boolean;
}

const NON_SIGHTING_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /\b(orca\s+card|orca\s+pass|tap\s+to\s+pay|sound\s+transit|king\s+county\s+metro|link\s+light\s+rail|bus\s+fare|reload\s+my\s+orca|orca\s+balance)\b/i,
    reason: 'Seattle ORCA transit card reference rather than wildlife sighting',
  },
  {
    regex: /\b(canucks|hockey|nhl|kraken|seahawks|mariners|goal|playoffs)\b/i,
    reason: 'Sports reference detected rather than wildlife sighting',
  },
  {
    regex: /\b(throwback|#tbt|years? ago|last summer|last year|memories from|archive photo)\b/i,
    reason: 'Historical or throwback post, not a live sighting',
  },
  {
    regex: /\b(hope to see|wish i saw|want to see|would love to see|maybe someday)\b/i,
    reason: 'Aspirational mention rather than active sighting',
  },
  {
    regex: /^\s*(anyone|has anyone|anybody|are there|where are|did anyone)\b.*\?\s*$/i,
    reason: 'Question asking for sightings rather than reporting one',
  },
];

const WHALE_SIGNAL_REGEX =
  /\b(orca|orcas|killer whale|killer whales|whale|whales|pod|j-?pod|k-?pod|l-?pod|srkw|bigg'?s|transient|t\d{2,3}[a-z]?|dorsal|spyhop|breach|blows?|spout)\b/i;

const DESTINATION_PREFIX_REGEX =
  /(?:toward|towards|heading\s+to|headed\s+to|moving\s+to|approaching|bound\s+for|for)\s+$/i;

const DIRECTION_PATTERNS: Array<{ regex: RegExp; direction: TravelDirection }> = [
  { regex: /\b(milling|foraging in place|circling|stationary|hanging out|resting)\b/i, direction: 'Milling' },
  { regex: /\b(northeastbound|north[\s-]?east|heading\s+ne|going\s+ne|\bne\b)\b/i, direction: 'NE' },
  { regex: /\b(northwestbound|north[\s-]?west|heading\s+nw|going\s+nw|\bnw\b)\b/i, direction: 'NW' },
  { regex: /\b(southeastbound|south[\s-]?east|heading\s+se|going\s+se|\bse\b)\b/i, direction: 'SE' },
  { regex: /\b(southwestbound|south[\s-]?west|heading\s+sw|going\s+sw|\bsw\b)\b/i, direction: 'SW' },
  { regex: /\b(northbound|heading\s+north|headed\s+north|going\s+north|swimming\s+north|traveling\s+north|moving\s+north|\bnb\b)\b/i, direction: 'N' },
  { regex: /\b(southbound|heading\s+south|headed\s+south|going\s+south|swimming\s+south|traveling\s+south|moving\s+south|\bsb\b)\b/i, direction: 'S' },
  { regex: /\b(eastbound|heading\s+east|headed\s+east|going\s+east|swimming\s+east|moving\s+east|\beb\b)\b/i, direction: 'E' },
  { regex: /\b(westbound|heading\s+west|headed\s+west|going\s+west|swimming\s+west|moving\s+west|\bwb\b)\b/i, direction: 'W' },
];

const BEHAVIOR_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\b(spyhop|spyhopping|spy[\s-]?hop)/i, label: 'spyhopping' },
  { regex: /\b(breach|breaching|full breach)/i, label: 'breaching' },
  { regex: /\b(tail[\s-]?slap|lobtail)/i, label: 'tail-slapping' },
  { regex: /\b(pec[\s-]?slap|pectoral slap)/i, label: 'pec-slapping' },
  { regex: /\b(forag|feeding|chasing salmon)/i, label: 'foraging' },
  { regex: /\b(hunt|hunting|seal kill|porpoise kill|predation)/i, label: 'hunting' },
  { regex: /\b(porpois|fast travel|charging)/i, label: 'porpoising' },
  { regex: /\b(mill|milling|circling)/i, label: 'milling' },
  { regex: /\b(vocal|calls?|clicks?|hydrophone|whistles?)/i, label: 'vocalizing' },
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  single: 1,
  solo: 1,
  lone: 1,
  two: 2,
  pair: 2,
  couple: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
};

// Pre-sort aliases longest-first so "alki point" matches before "alki".
const SORTED_LANDMARK_ALIASES: Array<{
  landmark: PugetSoundLandmark;
  alias: string;
  regex: RegExp;
}> = PUGET_SOUND_LANDMARKS.flatMap((landmark) =>
  landmark.aliases.map((alias) => ({
    landmark,
    alias,
    regex: new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i'),
  })),
).sort((a, b) => b.alias.length - a.alias.length);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLandmarks(text: string): {
  origin: PugetSoundLandmark | null;
  destination: PugetSoundLandmark | null;
} {
  const matches: LandmarkMatch[] = [];
  const occupiedRanges: Array<[number, number]> = [];

  for (const entry of SORTED_LANDMARK_ALIASES) {
    const match = entry.regex.exec(text);
    if (!match || match.index === undefined) continue;

    const start = match.index;
    const end = start + match[0].length;

    const overlaps = occupiedRanges.some(
      ([occStart, occEnd]) => start < occEnd && end > occStart,
    );
    if (overlaps) continue;

    // Avoid duplicate landmark ids
    if (matches.some((m) => m.landmark.id === entry.landmark.id)) continue;

    occupiedRanges.push([start, end]);
    const prefix = text.slice(Math.max(0, start - 24), start);
    const isDestination = DESTINATION_PREFIX_REGEX.test(prefix);

    matches.push({
      landmark: entry.landmark,
      alias: entry.alias,
      index: start,
      isDestination,
    });
  }

  matches.sort((a, b) => a.index - b.index);

  const originMatch = matches.find((m) => !m.isDestination) ?? matches[0] ?? null;
  const destinationMatch =
    matches.find((m) => m.isDestination && m.landmark.id !== originMatch?.landmark.id) ??
    null;

  return {
    origin: originMatch?.landmark ?? null,
    destination: destinationMatch?.landmark ?? null,
  };
}

function extractDirection(
  text: string,
  origin: PugetSoundLandmark | null,
  destination: PugetSoundLandmark | null,
): TravelDirection {
  for (const pattern of DIRECTION_PATTERNS) {
    if (pattern.regex.test(text)) {
      return pattern.direction;
    }
  }

  if (origin && destination) {
    const deg = bearingDegrees(
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng,
    );
    return bearingToDirection(deg);
  }

  return 'Unknown';
}

function extractCount(text: string): number | null {
  // Range like "5-6 orcas" or "8 to 10 whales" -> midpoint rounded
  const rangeMatch = text.match(
    /\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:orcas?|killer whales?|whales?|fins?|dorsals?|individuals?)\b/i,
  );
  if (rangeMatch) {
    const low = Number(rangeMatch[1]);
    const high = Number(rangeMatch[2]);
    if (low > 0 && high >= low && high <= 80) {
      return Math.round((low + high) / 2);
    }
  }

  // Explicit digit before whale noun ("3 orcas", "pod of 6")
  const explicitNum = text.match(
    /\b(?:pod\s+of\s+|group\s+of\s+|about\s+|approx\.?\s+|at\s+least\s+|~)?(\d{1,2})\+?\s*(?:orcas?|killer whales?|whales?|fins?|dorsals?|animals?|individuals?)\b/i,
  );
  if (explicitNum) {
    const n = Number(explicitNum[1]);
    if (n > 0 && n <= 80) return n;
  }

  const podOfNum = text.match(/\b(?:pod|group|family)\s+of\s+(\d{1,2})\b/i);
  if (podOfNum) {
    const n = Number(podOfNum[1]);
    if (n > 0 && n <= 80) return n;
  }

  if (/\bmom\s+(?:and|&|\+)\s+(?:a\s+)?calf\b/i.test(text)) {
    return 2;
  }

  // Word numbers ("pair of orcas", "solo bull", "three whales")
  const wordRegex = new RegExp(
    `\\b(${Object.keys(WORD_NUMBERS).join('|')})\\s+(?:of\\s+)?(?:adult\\s+|male\\s+|female\\s+)?(?:orcas?|killer whales?|whales?|bulls?|males?|fins?)\\b`,
    'i',
  );
  const wordMatch = text.match(wordRegex);
  if (wordMatch) {
    return WORD_NUMBERS[wordMatch[1].toLowerCase()] ?? null;
  }

  return null;
}

function extractEcotypeAndPod(
  text: string,
  count: number | null,
): { ecotype: Ecotype; pod: string | null } {
  // Specific Southern Resident pods
  const srkwPodMatch = text.match(/\b([JKL])[\s-]?pod\b/i);
  if (srkwPodMatch) {
    return {
      ecotype: 'SRKW',
      pod: `${srkwPodMatch[1].toUpperCase()}-Pod`,
    };
  }

  // Specific Bigg's Transient matrilines (e.g., T65A, T137, T46B1)
  const biggsPodMatch = text.match(/\b(T\d{2,3}[A-Z]?\d?)(?:s|'s)?\b/i);
  if (biggsPodMatch) {
    return {
      ecotype: 'Biggs',
      pod: biggsPodMatch[1].toUpperCase(),
    };
  }

  if (/\b(srkw|southern\s+resident|residents?)\b/i.test(text)) {
    return { ecotype: 'SRKW', pod: null };
  }

  if (/\b(bigg'?s|transient|mammal[\s-]?eating|seal\s+hunt|porpoise\s+hunt)\b/i.test(text)) {
    return { ecotype: 'Biggs', pod: null };
  }

  if (/\boffshore\s+(?:orca|killer\s+whale|ecotype)\b/i.test(text)) {
    return { ecotype: 'Offshore', pod: null };
  }

  // Soft heuristic: very large Puget Sound groups (12+) are typically SRKW superpods
  if (count !== null && count >= 12) {
    return { ecotype: 'SRKW', pod: null };
  }

  return { ecotype: 'Unknown', pod: null };
}

function extractBehaviors(text: string): string[] {
  const found: string[] = [];
  for (const item of BEHAVIOR_PATTERNS) {
    if (item.regex.test(text)) {
      found.push(item.label);
    }
  }
  return found;
}

/**
 * Deterministic fast-path NLP + geocode parser (<2ms, $0 cost).
 */
export function parseSightingText(rawText: string): ParsedSighting {
  const cleaned = rawText.trim();

  if (!cleaned) {
    return {
      isLiveSighting: false,
      rejectionReason: 'Empty sighting text',
      lat: null,
      lng: null,
      matchedLandmarkId: null,
      matchedLandmarkName: null,
      destinationLandmarkName: null,
      corridor: null,
      direction: 'Unknown',
      count: null,
      ecotype: 'Unknown',
      pod: null,
      behaviors: [],
      hasAdultMaleHint: false,
      confidenceScore: 0,
      extractionMethod: 'deterministic',
      rawText,
    };
  }

  for (const rule of NON_SIGHTING_PATTERNS) {
    if (rule.regex.test(cleaned)) {
      return {
        isLiveSighting: false,
        rejectionReason: rule.reason,
        lat: null,
        lng: null,
        matchedLandmarkId: null,
        matchedLandmarkName: null,
        destinationLandmarkName: null,
        corridor: null,
        direction: 'Unknown',
        count: null,
        ecotype: 'Unknown',
        pod: null,
        behaviors: [],
        hasAdultMaleHint: false,
        confidenceScore: 0.05,
        extractionMethod: 'deterministic',
        rawText,
      };
    }
  }

  const hasWhaleSignal = WHALE_SIGNAL_REGEX.test(cleaned);
  const { origin, destination } = extractLandmarks(cleaned);
  const direction = extractDirection(cleaned, origin, destination);
  const count = extractCount(cleaned);
  const { ecotype, pod } = extractEcotypeAndPod(cleaned, count);
  const behaviors = extractBehaviors(cleaned);
  const hasAdultMaleHint =
    /\b(huge\s+(?:tall\s+)?dorsal|massive\s+dorsal|tall\s+dorsal|giant\s+fin|adult\s+male|bull\s+orca|big\s+male)\b/i.test(
      cleaned,
    );

  if (!hasWhaleSignal) {
    return {
      isLiveSighting: false,
      rejectionReason: 'No whale or orca signal keywords detected',
      lat: origin?.lat ?? null,
      lng: origin?.lng ?? null,
      matchedLandmarkId: origin?.id ?? null,
      matchedLandmarkName: origin?.name ?? null,
      destinationLandmarkName: destination?.name ?? null,
      corridor: origin?.corridor ?? null,
      direction,
      count,
      ecotype,
      pod,
      behaviors,
      hasAdultMaleHint,
      confidenceScore: 0.1,
      extractionMethod: 'deterministic',
      rawText,
    };
  }

  // Compute deterministic confidence score based on completeness of signal
  let score = 0.35;
  if (origin) score += 0.25;
  if (direction !== 'Unknown') score += 0.12;
  if (count !== null) score += 0.08;
  if (ecotype !== 'Unknown') score += 0.08;
  if (pod) score += 0.05;
  if (behaviors.length > 0 || hasAdultMaleHint) score += 0.05;
  if (destination) score += 0.04;

  const confidenceScore = Number(Math.min(0.92, score).toFixed(2));

  return {
    isLiveSighting: true,
    lat: origin?.lat ?? null,
    lng: origin?.lng ?? null,
    matchedLandmarkId: origin?.id ?? null,
    matchedLandmarkName: origin?.name ?? null,
    destinationLandmarkName: destination?.name ?? null,
    corridor: origin?.corridor ?? null,
    direction,
    count,
    ecotype,
    pod,
    behaviors,
    hasAdultMaleHint,
    confidenceScore,
    extractionMethod: 'deterministic',
    rawText,
  };
}

/**
 * Hybrid Stage A (deterministic) -> Stage B (optional small LLM fallback) pipeline.
 * Only invokes the LLM adapter when deterministic parsing misses location or
 * has low confidence (< 0.55) on a whale-related post.
 */
export async function parseSightingWithFallback(
  rawText: string,
  llmAdapter?: LlmExtractorAdapter,
): Promise<ParsedSighting> {
  const fastResult = parseSightingText(rawText);

  const needsFallback =
    llmAdapter !== undefined &&
    fastResult.isLiveSighting &&
    (fastResult.lat === null || fastResult.confidenceScore < 0.55);

  if (!needsFallback) {
    return fastResult;
  }

  try {
    const llmPartial = await llmAdapter.extract(rawText);
    if (!llmPartial) return fastResult;

    return {
      ...fastResult,
      ...llmPartial,
      behaviors: llmPartial.behaviors ?? fastResult.behaviors,
      extractionMethod: 'llm_fallback',
      rawText,
    };
  } catch {
    // Graceful degradation: never fail ingestion if the LLM API times out
    return fastResult;
  }
}

export interface HttpLlmExtractorConfig {
  provider: 'openai' | 'gemini';
  apiKey: string;
  model?: string;
  endpointUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const VALID_LLM_DIRECTIONS = new Set<TravelDirection>([
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

const VALID_LLM_ECOTYPES = new Set<Ecotype>([
  'SRKW',
  'Biggs',
  'Offshore',
  'Unknown',
]);

const LLM_SYSTEM_PROMPT =
  'You extract live Puget Sound / Salish Sea orca sighting facts as strict JSON. ' +
  'Return ONLY a JSON object with keys: isLiveSighting (boolean), lat (number|null), ' +
  'lng (number|null), matchedLandmarkName (string|null), direction ("N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW"|"Milling"|"Unknown"), ' +
  'ecotype ("SRKW"|"Biggs"|"Offshore"|"Unknown"), pod (string|null), count (number|null), ' +
  'behaviors (string[]), confidenceScore (number 0..1). Reject Seattle ORCA transit card posts.';

function extractJsonObjectFromText(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sanitizeLlmPartial(obj: Record<string, unknown>): Partial<ParsedSighting> | null {
  const result: Partial<ParsedSighting> = {};

  if (typeof obj.isLiveSighting === 'boolean') {
    result.isLiveSighting = obj.isLiveSighting;
  }

  const lat = typeof obj.lat === 'number' ? obj.lat : null;
  const lng = typeof obj.lng === 'number' ? obj.lng : null;
  if (lat !== null && lng !== null && isWithinPugetSoundBounds(lat, lng)) {
    result.lat = Number(lat.toFixed(5));
    result.lng = Number(lng.toFixed(5));
  }

  if (typeof obj.matchedLandmarkName === 'string' && obj.matchedLandmarkName.trim()) {
    result.matchedLandmarkName = obj.matchedLandmarkName.trim().slice(0, 120);
  }

  if (
    typeof obj.direction === 'string' &&
    VALID_LLM_DIRECTIONS.has(obj.direction as TravelDirection)
  ) {
    result.direction = obj.direction as TravelDirection;
  }

  if (
    typeof obj.ecotype === 'string' &&
    VALID_LLM_ECOTYPES.has(obj.ecotype as Ecotype)
  ) {
    result.ecotype = obj.ecotype as Ecotype;
  }

  if (typeof obj.pod === 'string' && obj.pod.trim()) {
    result.pod = obj.pod.trim().slice(0, 32);
  }

  if (typeof obj.count === 'number' && Number.isFinite(obj.count) && obj.count > 0 && obj.count <= 80) {
    result.count = Math.round(obj.count);
  }

  if (Array.isArray(obj.behaviors)) {
    result.behaviors = obj.behaviors
      .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
      .map((b) => b.trim().toLowerCase())
      .slice(0, 8);
  }

  if (
    typeof obj.confidenceScore === 'number' &&
    Number.isFinite(obj.confidenceScore) &&
    obj.confidenceScore >= 0 &&
    obj.confidenceScore <= 1
  ) {
    result.confidenceScore = Number(obj.confidenceScore.toFixed(2));
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Production HTTP structured-JSON LLM adapter supporting OpenAI-compatible
 * (`/v1/chat/completions`) and Google Gemini REST (`generateContent`) endpoints
 * with a strict 2,000ms AbortController timeout and safe null fallback.
 */
export class HttpLlmExtractorAdapter implements LlmExtractorAdapter {
  readonly modelName: string;
  private readonly provider: 'openai' | 'gemini';
  private readonly apiKey: string;
  private readonly endpointUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpLlmExtractorConfig) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 2000;
    this.fetchImpl = config.fetchImpl ?? fetch;

    if (config.provider === 'gemini') {
      this.modelName = config.model ?? 'gemini-2.5-flash-lite';
      this.endpointUrl =
        config.endpointUrl ??
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelName)}:generateContent`;
    } else {
      this.modelName = config.model ?? 'gpt-4o-mini';
      this.endpointUrl =
        config.endpointUrl ?? 'https://api.openai.com/v1/chat/completions';
    }
  }

  async extract(rawText: string): Promise<Partial<ParsedSighting> | null> {
    if (!this.apiKey || !rawText.trim()) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;

      if (this.provider === 'gemini') {
        const separator = this.endpointUrl.includes('?') ? '&' : '?';
        const url = `${this.endpointUrl}${separator}key=${encodeURIComponent(this.apiKey)}`;
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: LLM_SYSTEM_PROMPT }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: rawText }],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
            },
          }),
        });
      } else {
        response = await this.fetchImpl(this.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.modelName,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: LLM_SYSTEM_PROMPT },
              { role: 'user', content: rawText },
            ],
          }),
        });
      }

      if (!response.ok) return null;

      const payload = (await response.json()) as Record<string, unknown>;
      let textContent: string | null = null;

      if (this.provider === 'gemini') {
        const candidates = payload.candidates as
          | Array<{ content?: { parts?: Array<{ text?: string }> } }>
          | undefined;
        textContent = candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      } else {
        const choices = payload.choices as
          | Array<{ message?: { content?: string } }>
          | undefined;
        textContent = choices?.[0]?.message?.content ?? null;
      }

      if (!textContent) return null;
      const jsonObj = extractJsonObjectFromText(textContent);
      if (!jsonObj) return null;

      return sanitizeLlmPartial(jsonObj);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
