import 'server-only';
import { version as maplibreVersion } from 'maplibre-gl/package.json';
import { DEV_MAP_STYLE } from './csp';

// Read at request time (not baked in at build), so one image runs anywhere.

export function mapStyleUrl(): string {
  const url = process.env.MAP_STYLE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MAP_STYLE_URL must be set in production (self-hosted PMTiles style)');
  }
  return DEV_MAP_STYLE;
}

/** Same-origin URL of the MapLibre worker copied by scripts/copy-vendor.mjs. */
export const MAP_WORKER_URL = `/vendor/maplibre-gl-worker-${maplibreVersion}.mjs`;
