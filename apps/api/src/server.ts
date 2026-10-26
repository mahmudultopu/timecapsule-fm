import * as Sentry from '@sentry/node';
import { createDb } from '@timecapsule/db';
import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { loggerOptions } from './logger.js';
import { createMetrics } from './plugins/metrics.js';
import { MemoryRateLimitStore, RedisRateLimitStore } from './plugins/rate-limit.js';
import { DbAuditLog } from './services/audit.js';
import { DbSessionStore } from './services/sessions.js';
import { S3Storage } from './services/storage.js';

const config = loadConfig();
const production = config.NODE_ENV === 'production';

if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    // Collect no user info, cookies, headers, bodies, query strings or SQL params.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    beforeSend(event) {
      // Strip anything that could carry personal data or signed URLs.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
        delete event.request.data;
        if (event.request.url) event.request.url = event.request.url.split('?')[0];
      }
      delete event.user;
      return event;
    },
  });
}

if (production && !config.REDIS_URL) {
  throw new Error('REDIS_URL is required in production (rate limits must be shared across replicas)');
}

const db = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;

const app = await buildApp({
  db,
  sessions: new DbSessionStore(db),
  storage: new S3Storage({
    endpoint: config.S3_ENDPOINT,
    publicEndpoint: config.S3_PUBLIC_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    mediaBucket: config.S3_BUCKET_MEDIA,
    quarantineBucket: config.S3_BUCKET_QUARANTINE,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  }),
  rateLimitStore: redis ? new RedisRateLimitStore(redis) : new MemoryRateLimitStore(),
  metrics: createMetrics(),
  audit: new DbAuditLog(db, config.AUDIT_IP_HMAC_KEY),
  appOrigin: config.APP_ORIGIN,
  sessionCookieName: config.SESSION_COOKIE_NAME,
  secureCookies: production || config.APP_ORIGIN.startsWith('https:'),
  playbackTtlSeconds: config.PLAYBACK_URL_TTL_SECONDS,
  exposeApiDocs: config.exposeApiDocs,
  metricsToken: config.METRICS_TOKEN,
  trustProxyHops: config.TRUST_PROXY_HOPS,
  logger: loggerOptions(config.LOG_LEVEL, !production && process.stdout.isTTY),
  onUnexpectedError: (err) => Sentry.captureException(err),
});
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.destroy();
  redis?.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
