import type { TravelDirection } from './types.ts';

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_NAUTICAL_MILE = 1.852;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export const PUGET_SOUND_BOUNDS = {
  minLat: 47.0,
  maxLat: 49.05,
  minLng: -123.5,
  maxLng: -122.1,
} as const;

export function isWithinPugetSoundBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= PUGET_SOUND_BOUNDS.minLat &&
    lat <= PUGET_SOUND_BOUNDS.maxLat &&
    lng >= PUGET_SOUND_BOUNDS.minLng &&
    lng <= PUGET_SOUND_BOUNDS.maxLng
  );
}

/**
 * Great-circle Haversine distance in kilometers between two WGS84 coordinates.
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const rLat1 = lat1 * DEG_TO_RAD;
  const rLat2 = lat2 * DEG_TO_RAD;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const a = sinDLat * sinDLat + Math.cos(rLat1) * Math.cos(rLat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  return EARTH_RADIUS_KM * c;
}

export function kmToNauticalMiles(km: number): number {
  return km / KM_PER_NAUTICAL_MILE;
}

/**
 * Initial forward azimuth (bearing) in degrees [0, 360) from point 1 to point 2.
 */
export function bearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const rLat1 = lat1 * DEG_TO_RAD;
  const rLat2 = lat2 * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;

  const y = Math.sin(dLng) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);

  const rawDeg = Math.atan2(y, x) * RAD_TO_DEG;
  return (rawDeg + 360) % 360;
}

const DIRECTION_BEARINGS: Partial<Record<TravelDirection, number>> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

export function directionToBearing(direction: TravelDirection): number | null {
  return DIRECTION_BEARINGS[direction] ?? null;
}

export function bearingToDirection(bearingDeg: number): TravelDirection {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  const dirs: TravelDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx];
}

/**
 * Smallest absolute angular difference in degrees [0, 180].
 */
export function angularDiffDegrees(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

/**
 * Projects a coordinate along a bearing (degrees) by distanceKm.
 */
export function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceKm: number,
): { lat: number; lng: number } {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const brng = bearingDeg * DEG_TO_RAD;
  const lat1 = lat * DEG_TO_RAD;
  const lng1 = lng * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: Number((lat2 * RAD_TO_DEG).toFixed(5)),
    lng: Number((lng2 * RAD_TO_DEG).toFixed(5)),
  };
}
