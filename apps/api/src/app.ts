import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Db } from '@timecapsule/db';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { HttpError } from './errors.js';
import authPlugin, { type SessionStore } from './plugins/auth.js';
import csrfPlugin from './plugins/csrf.js';
import metricsPlugin, { type Metrics } from './plugins/metrics.js';
import rateLimitPlugin, { type RateLimitStore } from './plugins/rate-limit.js';
import securityHeaders from './plugins/security-headers.js';
import { accountRoutes } from './routes/account.js';
import { healthRoutes } from './routes/health.js';
import { moderationRoutes } from './routes/moderation.js';
import { recordingRoutes } from './routes/recordings.js';
import { submissionRoutes } from './routes/submissions.js';
import type { AuditLog } from './services/audit.js';
import type { Storage } from './services/storage.js';

export interface AppDeps {
  db: Db;
  sessions: SessionStore;
  storage: Storage;
  rateLimitStore: RateLimitStore;
  metrics: Metrics;
  audit: AuditLog;
  appOrigin: string;
  sessionCookieName: string;
  secureCookies: boolean;
  playbackTtlSeconds: number;
  exposeApiDocs: boolean;
  metricsToken?: string | undefined;
  trustProxyHops: number;
  logger?: FastifyServerOptions['logger'];
  onUnexpectedError?: (err: unknown) => void;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.logger ?? false,
    // Trust exactly N proxy hops for request.ip (used for rate limiting).
    trustProxy: (_address: string, hop: number) => hop < deps.trustProxyHops,
    // JSON bodies only; audio goes straight to object storage via signed URLs.
    bodyLimit: 64 * 1024,
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
    routerOptions: { maxParamLength: 100 },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const fields = err.validation.map((v) => v.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'request');
      return reply.code(400).send({
        error: { code: 'invalid_request', message: `Invalid ${[...new Set(fields)].join(', ')}` },
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).headers(err.headers).send({ error: { code: err.code, message: err.message } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: 'bad_request', message: 'Bad request' } });
    }
    request.log.error({ err }, 'unhandled error');
    deps.onUnexpectedError?.(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }),
  );

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'TimeCapsule.fm API',
        version: '0.1.0',
        description:
          'Every endpoint declares its access level. State-changing requests require a same-origin ' +
          '`Origin` and an `X-CSRF-Token` header matching the token from `GET /v1/csrf`.',
      },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: deps.sessionCookieName },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  if (deps.exposeApiDocs) {
    await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
  }

  await app.register(securityHeaders, { exemptPrefixes: deps.exposeApiDocs ? ['/docs'] : [] });
  await app.register(cookie);
  await app.register(authPlugin, { sessions: deps.sessions, cookieName: deps.sessionCookieName });
  await app.register(rateLimitPlugin, { store: deps.rateLimitStore });
  await app.register(csrfPlugin, { appOrigin: deps.appOrigin, secureCookies: deps.secureCookies });
  await app.register(metricsPlugin, { metrics: deps.metrics, token: deps.metricsToken });

  await app.register(healthRoutes, deps);
  await app.register(recordingRoutes, deps);
  await app.register(submissionRoutes, deps);
  await app.register(accountRoutes, deps);
  await app.register(moderationRoutes, deps);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
