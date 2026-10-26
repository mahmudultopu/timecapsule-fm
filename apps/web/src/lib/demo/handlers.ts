import {
  IdParams,
  ListQuery,
  PinsQuery,
  type BBox,
  type PinCollection,
  type Playback,
  type RecordingDetail,
  type RecordingPage,
  type RecordingSummary,
} from '@timecapsule/shared';
import catalogJson from './catalog.json';

// Demo mode: for deployments that only run the web app (e.g. Vercel), the
// read-only API endpoints are answered from the bundled synthetic demo
// recordings. Everything that writes (sign-in, contributions, moderation,
// takedowns) is disabled and says so. Regenerate the catalog with
// `pnpm --filter @timecapsule/db demo:export`.

type Entry = RecordingDetail & { audioFile: string; peaksFile: string };
const catalog = catalogJson as Entry[];

export const isDemoMode = () => process.env.DEMO_MODE === 'true';

export interface DemoResponse {
  status: number;
  body: unknown;
}

const error = (status: number, code: string, message: string): DemoResponse => ({
  status,
  body: { error: { code, message } },
});

function detail(e: Entry): RecordingDetail {
  const { audioFile: _a, peaksFile: _p, ...rest } = e;
  return rest;
}

function summary(e: Entry): RecordingSummary {
  const { sceneDescription: _s, ...rest } = detail(e);
  return rest;
}

function inBox(e: Entry, b: BBox): boolean {
  const { lat, lon } = e.location;
  if (lat < b.south || lat > b.north) return false;
  // A box with west > east crosses the antimeridian.
  return b.west <= b.east ? lon >= b.west && lon <= b.east : lon >= b.west || lon <= b.east;
}

function matches(e: Entry, f: { decade?: number; category?: string; license?: string; q?: string }): boolean {
  if (f.decade !== undefined && e.decade !== f.decade) return false;
  if (f.category && e.category !== f.category) return false;
  if (f.license && e.provenance.license !== f.license) return false;
  if (f.q) {
    const hay = [e.place.cityEn, e.place.cityLocal, e.place.nameEn, e.place.nameLocal].join(' ').toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

/** Answers `/v1/...` like the API would, for the demo catalog. */
export function handleDemoRequest(method: string, pathname: string, params: URLSearchParams, origin: string): DemoResponse {
  if (method !== 'GET') {
    return error(503, 'demo_mode', 'This is a read-only demo deployment. Contributions need the full backend.');
  }
  const query = Object.fromEntries(params);
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');

  if (pathname === '/v1/csrf') return { status: 200, body: { token: 'demo-mode' } };

  if (pathname === '/v1/recordings/pins') {
    const q = PinsQuery.safeParse(query);
    if (!q.success) return error(400, 'invalid_request', 'Invalid query');
    const { bbox, ...filters } = q.data;
    const body: PinCollection = {
      type: 'FeatureCollection',
      truncated: false,
      features: catalog
        .filter((e) => inBox(e, bbox) && matches(e, filters))
        .map((e) => ({
          type: 'Feature',
          id: e.id,
          geometry: { type: 'Point', coordinates: [e.location.lon, e.location.lat] },
          properties: { id: e.id, title: e.title.en, eraYear: e.eraYear, category: e.category, sourceType: e.provenance.sourceType },
        })),
    };
    return { status: 200, body };
  }

  if (pathname === '/v1/recordings') {
    const q = ListQuery.safeParse(query);
    if (!q.success) return error(400, 'invalid_request', 'Invalid query');
    const body: RecordingPage = { items: catalog.filter((e) => matches(e, q.data)).map(summary), nextCursor: null };
    return { status: 200, body };
  }

  if (parts[0] === 'v1' && parts[1] === 'recordings' && parts.length >= 3) {
    const id = IdParams.safeParse({ id: parts[2] });
    if (!id.success) return error(400, 'invalid_request', 'Invalid id');
    const entry = catalog.find((e) => e.id === id.data.id);
    if (!entry) return error(404, 'not_found', 'Not found');
    if (parts.length === 3) return { status: 200, body: detail(entry) };
    if (parts.length === 4 && parts[3] === 'playback') {
      // Static files rather than signed URLs: the demo audio is public, synthetic and CC0.
      const body: Playback = {
        audioUrl: `${origin}${entry.audioFile}`,
        audioMimeType: 'audio/wav',
        peaksUrl: `${origin}${entry.peaksFile}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };
      return { status: 200, body };
    }
  }

  return error(404, 'not_found', 'Not found');
}
