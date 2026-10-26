import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface Metrics {
  registry: Registry;
  playbackStarts: Counter<'category'>;
  uploads: Counter<'stage'>;
  moderationDecisions: Counter<'decision'>;
  moderationWait: Histogram<'decision'>;
  takedowns: Counter<'stage'>;
  httpDuration: Histogram<'method' | 'route' | 'status'>;
}

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    playbackStarts: new Counter({
      name: 'tc_playback_starts_total',
      help: 'Signed playback URLs issued (one per play start / resume after expiry).',
      labelNames: ['category'],
      registers: [registry],
    }),
    uploads: new Counter({
      name: 'tc_uploads_total',
      help: 'Upload pipeline events seen by the API (intent, completed, rejected).',
      labelNames: ['stage'],
      registers: [registry],
    }),
    moderationDecisions: new Counter({
      name: 'tc_moderation_decisions_total',
      help: 'Moderation decisions by outcome.',
      labelNames: ['decision'],
      registers: [registry],
    }),
    moderationWait: new Histogram({
      name: 'tc_moderation_wait_seconds',
      help: 'Time from submission to moderation decision.',
      labelNames: ['decision'],
      buckets: [600, 3600, 6 * 3600, 24 * 3600, 3 * 24 * 3600, 7 * 24 * 3600],
      registers: [registry],
    }),
    takedowns: new Counter({
      name: 'tc_takedowns_total',
      help: 'Takedown requests received and resolved.',
      labelNames: ['stage'],
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'tc_http_request_duration_seconds',
      help: 'HTTP request duration by route template.',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics: Metrics;
  }
}

export default fp(
  async function metricsPlugin(app: FastifyInstance, opts: { metrics: Metrics; token?: string }) {
    app.decorate('metrics', opts.metrics);

    app.addHook('onResponse', async (request, reply) => {
      opts.metrics.httpDuration
        .labels(request.method, request.routeOptions.url ?? 'unmatched', String(reply.statusCode))
        .observe(reply.elapsedTime / 1000);
    });

    if (!opts.token) return;
    const expected = Buffer.from(`Bearer ${opts.token}`);
    app.get('/metrics', { config: { access: 'public' }, schema: { hide: true } }, async (request, reply) => {
      const given = Buffer.from(request.headers.authorization ?? '');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return reply.code(404).send();
      }
      reply.header('content-type', opts.metrics.registry.contentType);
      return opts.metrics.registry.metrics();
    });
  },
  { name: 'metrics' },
);
