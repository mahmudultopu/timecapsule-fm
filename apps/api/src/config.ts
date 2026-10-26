import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Number of trusted reverse-proxy hops in front of the API (for request.ip). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  /** Exact origin of the web app, e.g. https://timecapsule.fm. Used for CSRF origin checks. */
  APP_ORIGIN: z.url(),

  /** Connects as tc_api (never the schema owner). */
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().optional(),

  S3_ENDPOINT: z.url(),
  /** Endpoint browsers use to fetch signed URLs (differs from S3_ENDPOINT inside Docker). */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_MEDIA: z.string().min(1),
  /** Private bucket for raw uploads; only the worker reads from it. */
  S3_BUCKET_QUARANTINE: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(false),
  /** Signed playback URL lifetime. The spec allows 5–15 minutes. */
  PLAYBACK_URL_TTL_SECONDS: z.coerce.number().int().min(300).max(900).default(600),

  /** Auth.js session cookie. v5 default in production is __Secure-authjs.session-token. */
  SESSION_COOKIE_NAME: z.string().default('__Secure-authjs.session-token'),
  /** Key for HMAC-ing IP addresses in the audit log. Rotate periodically. */
  AUDIT_IP_HMAC_KEY: z.string().min(32),
  /** Bearer token for GET /metrics. If unset, /metrics is disabled. */
  METRICS_TOKEN: z.string().min(32).optional(),
  EXPOSE_API_DOCS: bool.optional(),
  SENTRY_DSN: z.url().optional(),
});

export type Config = z.infer<typeof Env> & { exposeApiDocs: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Print variable names only: values may be secrets.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${names}`);
  }
  const c = parsed.data;
  return { ...c, exposeApiDocs: c.EXPOSE_API_DOCS ?? c.NODE_ENV !== 'production' };
}
