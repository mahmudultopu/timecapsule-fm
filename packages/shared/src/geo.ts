import type { LocationPrecision } from './enums.js';

/**
 * Grid step in degrees of latitude for each precision tier.
 * 0.001° ≈ 111 m, 0.01° ≈ 1.1 km, 0.1° ≈ 11 km.
 */
export const PRECISION_LAT_STEP: Record<LocationPrecision, number> = {
  site_100m: 0.001,
  neighborhood_1km: 0.01,
  city_10km: 0.1,
};

/**
 * Snap a coordinate to the coarse grid for its precision tier.
 *
 * The longitude step is widened by 1/cos(latitude) so that a cell is never
 * narrower (east–west) than the tier promises; a fixed degree grid would leak
 * more precision at high latitudes.
 *
 * MUST stay in sync with app.snap_location() in
 * packages/db/migrations/0003_recordings.sql (the DB is authoritative; this
 * copy exists so the upload form can preview what will be published).
 */
export function snapToPrecision(
  lat: number,
  lon: number,
  precision: LocationPrecision,
): { lat: number; lon: number } {
  const latStep = PRECISION_LAT_STEP[precision];
  const snappedLat = clamp(Math.round(lat / latStep) * latStep, -90, 90);
  const cos = Math.max(Math.cos((snappedLat * Math.PI) / 180), 0.01);
  const lonStep = latStep / cos;
  const snappedLon = clamp(Math.round(lon / lonStep) * lonStep, -180, 180);
  return { lat: round(snappedLat, 6), lon: round(snappedLon, 6) };
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Parses "west,south,east,north". Returns null for anything malformed. */
export function parseBBox(raw: string): BBox | null {
  const parts = raw.split(',');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (p.trim() === '' ? Number.NaN : Number(p)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = nums as [number, number, number, number];
  if (west < -180 || west > 180 || east < -180 || east > 180) return null;
  if (south < -90 || south > 90 || north < -90 || north > 90) return null;
  if (south >= north) return null;
  // west > east is allowed: the box crosses the antimeridian.
  return { west, south, east, north };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
