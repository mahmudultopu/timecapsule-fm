// Transcoding worker entry point. Runs outside the request path in its own
// locked-down container (see infra/docker-compose.yml): non-root, read-only
// root filesystem, CPU/memory/pid limits, and no network beyond Postgres and
// object storage.
import { mkdir } from 'node:fs/promises';
import { createDb } from '@timecapsule/db';
import nodemailer from 'nodemailer';
import pg from 'pg';
import pino from 'pino';
import { loadConfig } from './config.js';
import { FfmpegMediaTool } from './media.js';
import { flushOutbox, type Mailer } from './outbox.js';
import { claimNext, processUpload, sweepAbandoned } from './pipeline.js';
import { S3WorkerStorage } from './storage.js';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL, base: { service: 'worker' } });
await mkdir(config.WORK_DIR, { recursive: true });

const db = createDb(config.DATABASE_URL, { max: 3 });
const storage = new S3WorkerStorage({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  accessKeyId: config.S3_ACCESS_KEY_ID,
  secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  mediaBucket: config.S3_BUCKET_MEDIA,
  quarantineBucket: config.S3_BUCKET_QUARANTINE,
});
const media = new FfmpegMediaTool({
  ffmpeg: config.FFMPEG_PATH,
  ffprobe: config.FFPROBE_PATH,
  timeoutMs: config.FFMPEG_TIMEOUT_MS,
});

let mailer: Mailer | null = null;
if (config.SMTP_URL) {
  const transport = nodemailer.createTransport(config.SMTP_URL);
  mailer = { send: async (m) => void (await transport.sendMail({ from: config.MAIL_FROM, ...m })) };
}

let stopping = false;
let draining = false;

/** Processes queued uploads one at a time until the queue is empty. */
async function drain() {
  if (draining || stopping) return;
  draining = true;
  try {
    for (;;) {
      const job = await claimNext(db);
      if (!job) break;
      await processUpload({ db, storage, media, workDir: config.WORK_DIR, log }, job);
      if (stopping) break;
    }
  } catch (err) {
    log.error({ err }, 'queue loop error');
  } finally {
    draining = false;
  }
}

// The API sends NOTIFY tc_uploads when an upload is ready; polling is the fallback.
const listener = new pg.Client({ connectionString: config.DATABASE_URL });
await listener.connect();
await listener.query('LISTEN tc_uploads');
listener.on('notification', () => void drain());

const timers = [
  setInterval(() => void drain(), config.POLL_INTERVAL_MS),
  setInterval(() => {
    sweepAbandoned(db, storage)
      .then((n) => n > 0 && log.info({ event: 'uploads_swept', count: n }, 'expired abandoned uploads'))
      .catch((err) => log.error({ err }, 'sweep failed'));
  }, 5 * 60 * 1000),
];
if (mailer) {
  const m = mailer;
  timers.push(
    setInterval(() => {
      flushOutbox(db, m, config.APP_ORIGIN, log).catch((err) => log.error({ err }, 'outbox failed'));
    }, 30_000),
  );
}

log.info({ email: !!mailer }, 'worker started');
void drain();

async function shutdown(signal: string) {
  stopping = true;
  log.info({ signal }, 'shutting down');
  timers.forEach(clearInterval);
  // Let an in-flight job finish (container stop grace period applies).
  while (draining) await new Promise((r) => setTimeout(r, 200));
  await listener.end();
  await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
