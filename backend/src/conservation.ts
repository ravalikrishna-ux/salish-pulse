import {
  PUGET_SOUND_BOUNDS,
  destinationPoint,
  haversineDistanceKm,
} from './geo.ts';
import type {
  ConservationFreezeStatus,
  Ecotype,
  PugetSoundCorridor,
  SightingCluster,
} from './types.ts';

export interface CoarsenedCoordinates {
  displayLat: number;
  displayLng: number;
  isCoarsened: boolean;
  coarseningRadiusMeters: number;
}

const SRKW_COARSENING_RADIUS_METERS = 750;
const SRKW_COARSENING_RADIUS_KM = SRKW_COARSENING_RADIUS_METERS / 1000;
/** ~750m grid cell dimensions at 47.6°N in Puget Sound. */
const GRID_CELL_LAT_DEG = 0.0068;
const GRID_CELL_LNG_DEG = 0.01;
const MIN_DISPLACEMENT_KM = 0.12;
const MAX_DISPLACEMENT_KM = SRKW_COARSENING_RADIUS_KM - 0.015; // 735m hard safety margin <= 750m

/**
 * Deterministic 32-bit FNV-1a hash returning an unsigned integer.
 */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashToSignedUnit(seed: string): number {
  const h = fnv1aHash(seed);
  return (h / 0xffffffff) * 2 - 1; // [-1, 1]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Conservation-first coordinate coarsening for Southern Resident Killer Whales (SRKW)
 * and precautionary Unknown ecotype reports.
 *
 * - For `SRKW` and `Unknown`: deterministically snaps/jitters coordinates onto a ~750m cell
 *   (~0.0068° lat, ~0.010° lng at 47.6°N) keyed by `seedId`, ensuring the public pin never
 *   exposes vessel-approachable pinpoint coordinates while staying within Puget Sound bounds
 *   and within 750m of the true centroid.
 * - For `Biggs` and `Offshore`: returns exact coordinates without coarsening.
 */
export function coarsenSrkwCoordinates(
  lat: number,
  lng: number,
  ecotype: Ecotype,
  seedId: string,
): CoarsenedCoordinates {
  const exactLat = Number(lat.toFixed(5));
  const exactLng = Number(lng.toFixed(5));

  if (ecotype === 'Biggs' || ecotype === 'Offshore') {
    return {
      displayLat: exactLat,
      displayLng: exactLng,
      isCoarsened: false,
      coarseningRadiusMeters: 0,
    };
  }

  // Snap to ~750m cell center + deterministic sub-cell jitter keyed by seedId
  const cellCenterLat =
    (Math.floor(lat / GRID_CELL_LAT_DEG) + 0.5) * GRID_CELL_LAT_DEG;
  const cellCenterLng =
    (Math.floor(lng / GRID_CELL_LNG_DEG) + 0.5) * GRID_CELL_LNG_DEG;

  const jitterLat = hashToSignedUnit(`${seedId}:lat`) * (GRID_CELL_LAT_DEG * 0.28);
  const jitterLng = hashToSignedUnit(`${seedId}:lng`) * (GRID_CELL_LNG_DEG * 0.28);

  let displayLat = cellCenterLat + jitterLat;
  let displayLng = cellCenterLng + jitterLng;

  let distKm = haversineDistanceKm(lat, lng, displayLat, displayLng);

  // If the deterministic snapped point happens to land too close to the true pinpoint,
  // apply a deterministic offset along a hashed bearing so pinpoint precision is never leaked.
  if (distKm < MIN_DISPLACEMENT_KM) {
    const bearing = fnv1aHash(`${seedId}:bearing`) % 360;
    const projected = destinationPoint(lat, lng, bearing, 0.28);
    displayLat = projected.lat;
    displayLng = projected.lng;
    distKm = haversineDistanceKm(lat, lng, displayLat, displayLng);
  }

  // Pull back radially if cell-snap + jitter exceeds 750m radius from true centroid.
  if (distKm > MAX_DISPLACEMENT_KM && distKm > 0) {
    const scale = MAX_DISPLACEMENT_KM / distKm;
    displayLat = lat + (displayLat - lat) * scale;
    displayLng = lng + (displayLng - lng) * scale;
  }

  // Guarantee coordinates remain inside Puget Sound bounds.
  displayLat = clamp(displayLat, PUGET_SOUND_BOUNDS.minLat, PUGET_SOUND_BOUNDS.maxLat);
  displayLng = clamp(displayLng, PUGET_SOUND_BOUNDS.minLng, PUGET_SOUND_BOUNDS.maxLng);

  return {
    displayLat: Number(displayLat.toFixed(5)),
    displayLng: Number(displayLng.toFixed(5)),
    isCoarsened: true,
    coarseningRadiusMeters: SRKW_COARSENING_RADIUS_METERS,
  };
}

export interface SetFreezeOptions {
  active?: boolean;
  reason?: string | null;
  corridors?: PugetSoundCorridor[];
  expiresAt?: string | null;
  durationMinutes?: number;
  updatedBy?: string | null;
}

/**
 * Manages active conservation-partner emergency freeze state (e.g., WDFW/NOAA/Orca Network
 * request to pause public broadcast of SRKW sightings in sensitive foraging corridors while
 * continuing internal ingestion and partner logging).
 */
export class ConservationFreezeController {
  private status: ConservationFreezeStatus;

  constructor(initialStatus?: Partial<ConservationFreezeStatus>) {
    this.status = {
      active: initialStatus?.active ?? false,
      reason: initialStatus?.reason ?? null,
      corridors: initialStatus?.corridors ? [...initialStatus.corridors] : [],
      expiresAt: initialStatus?.expiresAt ?? null,
      updatedBy: initialStatus?.updatedBy ?? null,
      updatedAt: initialStatus?.updatedAt ?? null,
    };
  }

  getStatus(nowMs = Date.now()): ConservationFreezeStatus {
    if (this.status.active && this.status.expiresAt) {
      const expiresMs = Date.parse(this.status.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
        this.status = {
          active: false,
          reason: null,
          corridors: [],
          expiresAt: null,
          updatedBy: this.status.updatedBy,
          updatedAt: new Date(nowMs).toISOString(),
        };
      }
    }

    return {
      ...this.status,
      corridors: [...this.status.corridors],
    };
  }

  setFreeze(
    options: SetFreezeOptions,
    nowMs = Date.now(),
  ): ConservationFreezeStatus {
    const active = options.active ?? true;
    if (!active) {
      return this.clearFreeze(options.updatedBy ?? null, nowMs);
    }

    let expiresAt: string | null = options.expiresAt ?? null;
    if (!expiresAt && options.durationMinutes !== undefined && options.durationMinutes > 0) {
      expiresAt = new Date(nowMs + options.durationMinutes * 60_000).toISOString();
    }

    this.status = {
      active: true,
      reason:
        options.reason?.trim() ||
        'Conservation partner temporary broadcast pause active for SRKW protection.',
      corridors: options.corridors ? Array.from(new Set(options.corridors)) : [],
      expiresAt,
      updatedBy: options.updatedBy ?? 'conservation-partner',
      updatedAt: new Date(nowMs).toISOString(),
    };

    return this.getStatus(nowMs);
  }

  clearFreeze(
    updatedBy: string | null = null,
    nowMs = Date.now(),
  ): ConservationFreezeStatus {
    this.status = {
      active: false,
      reason: null,
      corridors: [],
      expiresAt: null,
      updatedBy,
      updatedAt: new Date(nowMs).toISOString(),
    };
    return this.getStatus(nowMs);
  }

  /**
   * Returns true if public broadcast/display of this sighting cluster must be suppressed.
   * Only SRKW clusters are suppressed; if `corridors` is empty, all corridors are frozen.
   */
  isClusterFrozen(
    cluster: Pick<SightingCluster, 'ecotype' | 'corridor'>,
    nowMs = Date.now(),
  ): boolean {
    const current = this.getStatus(nowMs);
    if (!current.active) return false;
    if (cluster.ecotype !== 'SRKW') return false;
    if (current.corridors.length === 0) return true;
    return current.corridors.includes(cluster.corridor);
  }
}
