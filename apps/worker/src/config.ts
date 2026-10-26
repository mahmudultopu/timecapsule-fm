import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  /** Connects as tc_worker_login: sees only uploads and recordings being processed. */
  DATABASE_URL: z.string().min(1),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_MEDIA: z.string().min(1),
  S3_BUCKET_QUARANTINE: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  /** Hard wall-clock limit per ffmpeg/ffprobe invocation. */
  FFMPEG_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(10 * 60 * 1000),
  /** Scratch space for one job at a time; mount a size-limited tmpfs here. */
  WORK_DIR: z.string().default('/tmp/tc-work'),
  POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(10_000),

  /** smtp(s)://user:pass@host:port. Unset = in-app notifications only. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('TimeCapsule.fm <no-reply@timecapsule.fm>'),
  APP_ORIGIN: z.url().default('http://localhost:3000'),
});

export type WorkerConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  return parsed.data;
}
