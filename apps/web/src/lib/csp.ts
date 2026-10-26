export interface CspOptions {
  nonce: string;
  dev: boolean;
  /** Origins serving signed audio/peaks (the media bucket's public endpoint). */
  mediaOrigins: string[];
  /** Origins serving the map style, tiles, glyphs and sprites. */
  mapOrigins: string[];
  /** Add upgrade-insecure-requests (only when the page itself is served over HTTPS). */
  upgradeInsecure: boolean;
}

/**
 * Strict, nonce-based CSP. No 'unsafe-inline' scripts; 'strict-dynamic'
 * lets Next's nonce'd bootstrap load its own chunks. `style-src-attr`
 * permits style="" attributes (used by Next internals and MapLibre markers),
 * which cannot execute script.
 */
export function buildCsp({ nonce, dev, mediaOrigins, mapOrigins, upgradeInsecure }: CspOptions): string {
  const list = (xs: string[]) => xs.filter(Boolean).join(' ');
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': `'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    'style-src': dev ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`,
    'style-src-attr': "'unsafe-inline'",
    'img-src': `'self' data: blob: ${list(mapOrigins)}`,
    'font-src': "'self'",
    'connect-src': `'self' ${list(mediaOrigins)} ${list(mapOrigins)}${dev ? ' ws:' : ''}`,
    'media-src': `'self' blob: ${list(mediaOrigins)}`,
    // MapLibre runs its tile parsing in blob: workers.
    'worker-src': "'self' blob:",
    'child-src': 'blob:',
    'frame-src': "'none'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
    'frame-ancestors': "'none'",
    'manifest-src': "'self'",
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.replace(/\s+/g, ' ').trim()}`);
  if (upgradeInsecure) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/**
 * Development-only basemap. Production uses a self-hosted PMTiles style so
 * visitors' IPs are not sent to a third-party tile server.
 */
export const DEV_MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

/** Map origins: explicit MAP_ORIGINS, else the origin of the style URL. */
export function mapOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  if (env.MAP_ORIGINS) return originsFromEnv(env.MAP_ORIGINS);
  return originsFromEnv(env.MAP_STYLE_URL ?? (env.NODE_ENV === 'production' ? '' : DEV_MAP_STYLE));
}

export function originsFromEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
}
