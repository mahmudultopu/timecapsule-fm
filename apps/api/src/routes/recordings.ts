import { withContext } from '@timecapsule/db';
import {
  ErrorBody,
  IdParams,
  ListQuery,
  PinCollection,
  PinsQuery,
  Playback,
  RecordingDetail,
  RecordingPage,
} from '@timecapsule/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError, notFound } from '../errors.js';
import type { RateLimitPolicy } from '../plugins/rate-limit.js';
import {
  decodeCursor,
  findPins,
  getPlaybackAssets,
  getRecording,
  listRecordings,
} from '../services/recordings.js';
import type { AppDeps } from '../app.js';

const SEARCH_LIMIT: RateLimitPolicy = { bucket: 'search', ip: [120, 60], account: [240, 60] };
const PLAYBACK_LIMIT: RateLimitPolicy = { bucket: 'playback', ip: [60, 60], account: [120, 60] };
// Published listings are identical for every caller, so short shared caching is safe.
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

const errors = { 400: ErrorBody, 404: ErrorBody, 429: ErrorBody };

export const recordingRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const ctx = (userId: string | null | undefined) => ({ userId: userId ?? null });

  app.get(
    '/v1/recordings/pins',
    {
      config: { access: 'public', rateLimit: SEARCH_LIMIT },
      schema: {
        tags: ['recordings'],
        summary: 'Published recording pins inside a bounding box',
        querystring: PinsQuery,
        response: { 200: PinCollection, ...errors },
      },
    },
    async (request, reply) => {
      const { bbox, ...filters } = request.query;
      const pins = await withContext(deps.db, ctx(request.user?.id), (tx) => findPins(tx, bbox, filters));
      reply.header('cache-control', PUBLIC_CACHE);
      return pins;
    },
  );

  app.get(
    '/v1/recordings',
    {
      config: { access: 'public', rateLimit: SEARCH_LIMIT },
      schema: {
        tags: ['recordings'],
        summary: 'Search and filter published recordings (list view)',
        querystring: ListQuery,
        response: { 200: RecordingPage, ...errors },
      },
    },
    async (request, reply) => {
      if (request.query.cursor && !decodeCursor(request.query.cursor)) {
        throw new HttpError(400, 'invalid_request', 'Invalid cursor');
      }
      const page = await withContext(deps.db, ctx(request.user?.id), (tx) => listRecordings(tx, request.query));
      if (page.dropped > 0) {
        request.log.error({ event: 'provenance_incomplete', count: page.dropped }, 'published rows dropped');
      }
      reply.header('cache-control', PUBLIC_CACHE);
      return { items: page.items, nextCursor: page.nextCursor };
    },
  );

  app.get(
    '/v1/recordings/:id',
    {
      config: { access: 'public', rateLimit: SEARCH_LIMIT },
      schema: {
        tags: ['recordings'],
        summary: 'A published recording with full provenance',
        params: IdParams,
        response: { 200: RecordingDetail, ...errors },
      },
    },
    async (request, reply) => {
      const rec = await withContext(deps.db, ctx(request.user?.id), (tx) => getRecording(tx, request.params.id));
      if (!rec) throw notFound();
      reply.header('cache-control', PUBLIC_CACHE);
      return rec;
    },
  );

  app.get(
    '/v1/recordings/:id/playback',
    {
      config: { access: 'public', rateLimit: PLAYBACK_LIMIT },
      schema: {
        tags: ['recordings'],
        summary: 'Short-lived signed URLs for streaming audio and waveform peaks',
        description:
          'URLs expire after 5–15 minutes (configured). Clients re-request on expiry and resume from the current position.',
        params: IdParams,
        response: { 200: Playback, ...errors },
      },
    },
    async (request) => {
      const assets = await withContext(deps.db, ctx(request.user?.id), (tx) =>
        getPlaybackAssets(tx, request.params.id),
      );
      if (!assets) throw notFound();
      const ttlSeconds = deps.playbackTtlSeconds;
      const [audio, peaks] = await Promise.all([
        deps.storage.signGet(assets.audio.key, { ttlSeconds, contentType: assets.audio.mimeType }),
        deps.storage.signGet(assets.peaks.key, { ttlSeconds, contentType: assets.peaks.mimeType }),
      ]);
      deps.metrics.playbackStarts.labels(assets.category).inc();
      // Never log the URLs themselves.
      request.log.info({ event: 'playback_url_issued', recordingId: request.params.id }, 'playback');
      return {
        audioUrl: audio.url,
        audioMimeType: assets.audio.mimeType,
        peaksUrl: peaks.url,
        expiresAt: audio.expiresAt.toISOString(),
      };
    },
  );
};
