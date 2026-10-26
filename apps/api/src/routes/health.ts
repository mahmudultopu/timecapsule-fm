import { sql } from 'kysely';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../app.js';

export const healthRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const Status = z.object({ status: z.enum(['ok', 'unavailable']) });

  app.get(
    '/healthz',
    { config: { access: 'public' }, schema: { tags: ['ops'], response: { 200: Status } } },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/readyz',
    { config: { access: 'public' }, schema: { tags: ['ops'], response: { 200: Status, 503: Status } } },
    async (request, reply) => {
      try {
        await sql`SELECT 1`.execute(deps.db);
        return { status: 'ok' as const };
      } catch (err) {
        request.log.error({ err }, 'readiness check failed');
        return reply.code(503).send({ status: 'unavailable' as const });
      }
    },
  );
};
