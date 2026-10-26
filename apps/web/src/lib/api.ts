import {
  PinCollection,
  Playback,
  RecordingDetail,
  RecordingPage,
  type BBox,
} from '@timecapsule/shared';
import type { z } from 'zod';
import { toSearchParams, type Filters } from './filters';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed (${status})`);
  }
}

/** Browser: same-origin /api (reverse proxy). Server: API_INTERNAL_URL. */
function base(): string {
  if (typeof window !== 'undefined') return '/api';
  const internal = process.env.API_INTERNAL_URL;
  if (!internal) throw new Error('API_INTERNAL_URL is not set');
  return internal.replace(/\/$/, '');
}

/** Every response is validated against the shared schema before use. */
async function get<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: RequestInit,
): Promise<z.infer<S> | null> {
  // Demo mode (no API deployed): answer server-side calls in-process.
  if (typeof window === 'undefined' && process.env.DEMO_MODE === 'true') {
    const { handleDemoRequest } = await import('./demo/handlers');
    const url = new URL(path, 'http://demo.invalid');
    const res = handleDemoRequest('GET', url.pathname, url.searchParams, 'http://demo.invalid');
    if (res.status === 404) return null;
    if (res.status >= 400) throw new ApiError(res.status);
    return schema.parse(res.body);
  }
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status);
  return schema.parse(await res.json());
}

export function getPins(bbox: BBox, filters: Filters, signal?: AbortSignal) {
  const qs = toSearchParams(filters, { q: false });
  qs.set('bbox', [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(5)).join(','));
  return get(PinCollection, `/v1/recordings/pins?${qs}`, { signal });
}

export function listRecordings(filters: Filters, cursor?: string, init?: RequestInit) {
  const qs = toSearchParams(filters);
  if (cursor) qs.set('cursor', cursor);
  return get(RecordingPage, `/v1/recordings?${qs}`, init);
}

export function getRecording(id: string, init?: RequestInit) {
  return get(RecordingDetail, `/v1/recordings/${encodeURIComponent(id)}`, init);
}

export function getPlayback(id: string) {
  return get(Playback, `/v1/recordings/${encodeURIComponent(id)}/playback`, { cache: 'no-store' });
}

/** Owner/moderator preview of a submission's processed audio. */
export function getSubmissionPlayback(id: string) {
  return get(Playback, `/v1/submissions/${encodeURIComponent(id)}/playback`, { cache: 'no-store' });
}
