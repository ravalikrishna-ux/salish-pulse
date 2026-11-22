export type Ecotype = 'SRKW' | 'Biggs' | 'Offshore' | 'Unknown';

export type TravelDirection =
  | 'N'
  | 'NE'
  | 'E'
  | 'SE'
  | 'S'
  | 'SW'
  | 'W'
  | 'NW'
  | 'Milling'
  | 'Unknown';

export type ConfidenceTier = 'unverified' | 'community' | 'corroborated' | 'verified';

export type SightingSource =
  | 'acartia'
  | 'orcasound'
  | 'bluesky'
  | 'reddit'
  | 'orca_network'
  | 'citizen'
  | 'simulator';

export type PugetSoundCorridor =
  | 'Admiralty Inlet'
  | 'Main Basin'
  | 'Elliott Bay'
  | 'East Passage'
  | 'Colvos Passage'
  | 'South Sound'
  | 'San Juan Islands'
  | 'Possession Sound';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PugetSoundLandmark extends LatLng {
  id: string;
  name: string;
  aliases: string[];
  corridor: PugetSoundCorridor;
  region: string;
}

export interface ViewingSpot extends LatLng {
  id: string;
  name: string;
  region: string;
  corridor: PugetSoundCorridor;
  viewingTips: string;
  parkingNotes: string;
  elevation: 'water-level' | 'bluff' | 'pier';
  bestDirection: string;
}

export interface HydrophoneNode extends LatLng {
  id: string;
  name: string;
  region: string;
  corridor: PugetSoundCorridor;
  status: 'online' | 'active_detection' | 'offline';
  streamUrl: string;
  lastDetectionAt: string | null;
  lastDetectionLabel: string | null;
  snrDb: number | null;
}

export interface RawSightingInput {
  source: SightingSource;
  externalId?: string;
  observedAt?: string;
  rawText?: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  direction?: TravelDirection;
  speedKnots?: number;
  ecotype?: Ecotype;
  pod?: string;
  count?: number;
  behaviors?: string[];
  author?: string;
  sourceUrl?: string;
  trustBoost?: number;
}

export interface ParsedSighting {
  isLiveSighting: boolean;
  rejectionReason?: string;
  lat: number | null;
  lng: number | null;
  matchedLandmarkId: string | null;
  matchedLandmarkName: string | null;
  destinationLandmarkName: string | null;
  corridor: PugetSoundCorridor | null;
  direction: TravelDirection;
  count: number | null;
  ecotype: Ecotype;
  pod: string | null;
  behaviors: string[];
  hasAdultMaleHint: boolean;
  confidenceScore: number;
  extractionMethod: 'deterministic' | 'llm_fallback';
  rawText: string;
}

export interface SightingReport {
  id: string;
  source: SightingSource;
  externalId?: string;
  author?: string;
  sourceUrl?: string;
  observedAt: string;
  receivedAt: string;
  lat: number;
  lng: number;
  rawText: string;
  direction: TravelDirection;
  ecotype: Ecotype;
  pod: string | null;
  count: number | null;
  trustWeight: number;
}

export interface SightingCluster {
  id: string;
  lat: number;
  lng: number;
  displayLat: number;
  displayLng: number;
  isCoarsened: boolean;
  coarseningRadiusMeters: number;
  locationName: string;
  corridor: PugetSoundCorridor;
  direction: TravelDirection;
  speedKnots: number;
  ecotype: Ecotype;
  pod: string | null;
  count: number | null;
  behaviors: string[];
  confidenceScore: number;
  confidenceTier: ConfidenceTier;
  corroborationCount: number;
  sources: SightingSource[];
  reports: SightingReport[];
  firstSeenAt: string;
  lastSeenAt: string;
  summary: string;
}

export interface ViewingSpotWithEta extends ViewingSpot {
  etaMinutes: number | null;
  etaRangeMinutes: [number, number] | null;
  viewingLikelihood: 'high' | 'medium' | 'low' | 'none';
  approachingClusterId: string | null;
  approachingPod: string | null;
  approachingEcotype: Ecotype | null;
  approachingDirection: TravelDirection | null;
  distanceNm: number | null;
  alignmentScore: number | null;
  statusMessage: string;
  beWhaleWiseNote: string;
}

export interface AlertEvaluationResult {
  query: {
    lat: number;
    lng: number;
    radiusKm: number;
    evaluatedAt: string;
  };
  shouldAlert: boolean;
  severity: 'none' | 'advisory' | 'high_priority';
  recommendedTitle: string | null;
  recommendedBody: string | null;
  matchingClusters: Array<{
    clusterId: string;
    locationName: string;
    distanceKm: number;
    etaMinutes: number | null;
    confidenceTier: ConfidenceTier;
    ecotype: Ecotype;
    pod: string | null;
    direction: TravelDirection;
    corroborationCount: number;
    reason: string;
  }>;
  nearestHotSpots: Array<{
    spotId: string;
    name: string;
    distanceFromUserKm: number;
    etaMinutes: number | null;
    viewingLikelihood: ViewingSpotWithEta['viewingLikelihood'];
  }>;
}

export interface WebPushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface AlertSubscription {
  id: string;
  channel: 'expo' | 'web_push';
  pushToken?: string;
  webPushSubscription?: WebPushSubscriptionPayload;
  favoriteSpotIds: string[];
  homeLat?: number;
  homeLng?: number;
  radiusKm: number;
  maxEtaMinutes: number;
  minConfidence: ConfidenceTier;
  ecotypes: Ecotype[];
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDeliveryRecord {
  id: string;
  subscriptionId: string;
  clusterId: string;
  channel: 'expo' | 'web_push';
  title: string;
  body: string;
  sentAt: string;
  status: 'sent' | 'dry_run' | 'failed';
  error?: string;
}

export interface ConservationFreezeStatus {
  active: boolean;
  reason: string | null;
  corridors: PugetSoundCorridor[];
  expiresAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface PushDispatchSummary {
  clusterId: string;
  evaluatedSubscriptions: number;
  eligibleCount: number;
  sentCount: number;
  dryRunCount: number;
  failedCount: number;
  suppressedReasons: Record<string, number>;
  deliveries: AlertDeliveryRecord[];
}

export interface HydrophonePulseEvent {
  nodeId: string;
  nodeName: string;
  corridor: PugetSoundCorridor;
  detectedAt: string;
  label: string;
  confidence: number;
  snrDb: number;
  lat: number;
  lng: number;
}

export type StreamEventType =
  | 'connected'
  | 'sighting:new'
  | 'sighting:corroborated'
  | 'hydrophone:pulse'
  | 'conservation:freeze';

export interface StreamEventPayload {
  type: StreamEventType;
  timestamp: string;
  data: unknown;
}
