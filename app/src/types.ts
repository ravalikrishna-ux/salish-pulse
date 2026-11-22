export type Ecotype = 'SRKW' | 'BIGGS' | 'HUMPBACK' | 'GRAY' | 'UNKNOWN';

export type TravelDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'MILLING' | 'UNKNOWN';

export type ConfidenceTier = 'verified' | 'corroborated' | 'acoustic' | 'community';

export type SourceType =
  | 'acartia_orca_network'
  | 'orcasound_hydrophone'
  | 'bluesky'
  | 'reddit'
  | 'west_seattle_blog'
  | 'wsf_ferry'
  | 'citizen_app';

export interface Sighting {
  id: string;
  title: string;
  locationName: string;
  waterway: string;
  lat: number;
  lng: number;
  displayLat?: number;
  displayLng?: number;
  isCoarsened?: boolean;
  coarseningRadiusMeters?: number;
  ecotype: Ecotype;
  podId?: string;
  estimatedCount: number;
  direction: TravelDirection;
  speedKnots: number;
  confidence: ConfidenceTier;
  corroborationCount: number;
  sources: SourceType[];
  timestamp: string; // ISO string
  summary: string;
  rawExcerpt?: string;
  reporterHandle?: string;
  hydrophoneNodeId?: string;
}

export interface ViewingSpot {
  id: string;
  name: string;
  area: string;
  waterway: string;
  lat: number;
  lng: number;
  shorelineSide: 'east' | 'west' | 'island';
  parkingTip: string;
  sightlineNote: string;
  elevationFt: number;
  amenities: string[];
  favorite?: boolean;
}

export interface SpotWithEta extends ViewingSpot {
  etaMinutes: number | null;
  distanceKm: number | null;
  approachingSightingId: string | null;
  approachingPodLabel: string | null;
  likelihood: 'high' | 'medium' | 'low' | 'none';
}

export interface HydrophoneNode {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  status: 'online' | 'detecting' | 'maintenance';
  lastDetectionIso?: string;
  lastDetectionSummary?: string;
  streamUrl: string;
}

export interface AlertPreferences {
  enabled: boolean;
  favoriteSpotIds: string[];
  maxEtaMinutes: number;
  minConfidence: ConfidenceTier;
  includeSrkw: boolean;
  includeBiggs: boolean;
  includeAcoustic: boolean;
  quietHoursEnabled: boolean;
}

export interface ConservationFreezeStatus {
  active: boolean;
  reason: string | null;
  corridors: string[];
  expiresAt: string | null;
  updatedBy?: string | null;
}

export interface PushRegistrationState {
  permission: 'granted' | 'denied' | 'undetermined' | 'unsupported';
  channel: 'expo' | 'web_push';
  token: string | null;
  subscriptionId: string | null;
  syncedAt: string | null;
}

export interface RegulationRule {
  id: string;
  appliesTo: string;
  distanceRule: string;
  speedRule: string;
  detail: string;
}
