import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@timecapsule/db';
import {
  MAX_DURATION_SECONDS,
  MAX_UPLOAD_BYTES,
  computePeaks,
  sniffAudioFormat,
  type AudioFormat,
} from '@timecapsule/shared';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { Rejection, type MediaTool, type ProbeResult } from './media.js';
import type { WorkerStorage } from './storage.js';

export interface PipelineDeps {
  db: Db;
  storage: WorkerStorage;
  media: MediaTool;
  workDir: string;
  log: Logger;
}

export interface ClaimedUpload {
  id: string;
  recording_id: string;
  user_id: string;
  quarantine_key: string;
  declared_format: AudioFormat;
  declared_bytes: number;
}

const PEAKS_SAMPLE_RATE = 8000;
// Containers ffprobe reports for each accepted format.
const FORMAT_NAMES: Record<AudioFormat, RegExp> = {
  wav: /\bwav\b/,
  flac: /\bflac\b/,
  mp3: /\bmp3\b/,
  ogg: /\bogg\b/,
};
// Tags we tolerate in *outputs*: a generic muxer name, nothing identifying.
const ALLOWED_OUTPUT_TAGS = new Set(['encoder']);

/** Human-readable reasons shown to the contributor when processing fails. */
export const REJECTION_MESSAGES: Record<string, string> = {
  unsupported_format: 'The file is not WAV, FLAC, MP3 or OGG audio.',
  format_mismatch: 'The file type does not match what was uploaded.',
  unreadable_audio: 'The file could not be read as audio.',
  no_audio_stream: 'The file contains no audio.',
  too_long: 'The recording is longer than 30 minutes.',
  too_short: 'The recording is shorter than one second.',
  too_large: 'The file is larger than 200 MB.',
  missing_object: 'The upload could not be found. Please upload again.',
  processing_timeout: 'Processing took too long. Please try a shorter or simpler file.',
  processing_error: 'Something went wrong while processing. Please try uploading again.',
};

/**
 * Claims the oldest upload waiting for processing. SKIP LOCKED lets several
 * workers run side by side without picking the same job.
 */
export async function claimNext(db: Db): Promise<ClaimedUpload | null> {
  const res = await sql<ClaimedUpload>`
    UPDATE uploads SET status = 'processing'
    WHERE id = (
      SELECT id FROM uploads WHERE status = 'received'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, recording_id, user_id, quarantine_key, declared_format, declared_bytes`.execute(db);
  const row = res.rows[0];
  return row ? { ...row, declared_bytes: Number(row.declared_bytes) } : null;
}

export type Outcome = 'processed' | 'rejected' | 'superseded';

/**
 * Validates, transcodes and publishes one upload. Never throws for bad
 * files: those become a rejection the contributor can see and retry.
 */
export async function processUpload(deps: PipelineDeps, job: ClaimedUpload): Promise<Outcome> {
  const log = deps.log.child({ uploadId: job.id, recordingId: job.recording_id });

  if (!(await isCurrent(deps.db, job))) {
    await deps.db.updateTable('uploads').set({ status: 'expired' }).where('id', '=', job.id).execute();
    await deps.storage.deleteQuarantine([job.quarantine_key]).catch(() => undefined);
    log.info({ event: 'upload_superseded' }, 'a newer upload replaced this one');
    return 'superseded';
  }

  const dir = await mkdtemp(join(deps.workDir, 'job-'));
  const uploaded: string[] = [];
  try {
    const input = join(dir, 'input');

    // 1. Size cap (streamed) and checksum of the original.
    const limit = Math.min(job.declared_bytes, MAX_UPLOAD_BYTES);
    const original = await deps.storage.downloadQuarantine(job.quarantine_key, input, limit);

    // 2. Magic bytes decide the format, never the name or the declared type.
    const sniffed = sniffAudioFormat(original.head);
    if (!sniffed) throw new Rejection('unsupported_format');
    if (sniffed !== job.declared_format) throw new Rejection('format_mismatch');

    // 3. ffprobe, forced to the sniffed demuxer.
    const probe = await deps.media.probe(input, sniffed);
    validateProbe(probe, sniffed);

    // 4. Transcode (metadata stripped) and compute waveform peaks.
    const out = await deps.media.transcode(input, sniffed, dir);
    const pcm = await deps.media.decodePcm(input, sniffed, PEAKS_SAMPLE_RATE);
    const peaks = JSON.stringify(computePeaks(pcm, PEAKS_SAMPLE_RATE));

    // 5. Prove the stripping worked before anything is published.
    const [masterProbe, previewProbe] = await Promise.all([
      deps.media.probe(out.masterPath, 'output'),
      deps.media.probe(out.previewPath, 'output'),
    ]);
    for (const p of [masterProbe, previewProbe]) {
      const leaked = p.tagKeys.filter((k) => !ALLOWED_OUTPUT_TAGS.has(k));
      if (leaked.length > 0) throw new Error(`metadata survived transcoding: ${leaked.join(',')}`);
    }

    // 6. Store outputs under fresh random keys.
    const id = () => randomBytes(16).toString('hex');
    const keys = { master: `master/${id()}.flac`, preview: `media/${id()}.mp3`, peaks: `media/${id()}.json` };
    await deps.storage.putMediaFile(keys.master, out.masterPath, 'audio/flac');
    uploaded.push(keys.master);
    await deps.storage.putMediaFile(keys.preview, out.previewPath, 'audio/mpeg');
    uploaded.push(keys.preview);
    await deps.storage.putMedia(keys.peaks, peaks, 'application/json');
    uploaded.push(keys.peaks);

    const [masterBytes, previewBytes] = await Promise.all([stat(out.masterPath), stat(out.previewPath)]);
    const [masterSha, previewSha] = await Promise.all([sha256File(out.masterPath), sha256File(out.previewPath)]);
    const peaksSha = sha256(Buffer.from(peaks));

    // 7. Swap the recording's assets in one transaction.
    const oldKeys = await deps.db.transaction().execute(async (tx) => {
      const old = await tx
        .deleteFrom('audio_assets')
        .where('recording_id', '=', job.recording_id)
        .returning('storage_key')
        .execute();
      await tx
        .insertInto('audio_assets')
        .values([
          {
            recording_id: job.recording_id,
            kind: 'master',
            storage_key: keys.master,
            mime_type: 'audio/flac',
            byte_size: masterBytes.size,
            sha256: masterSha,
            codec: 'flac',
            sample_rate: masterProbe.sampleRate,
            channels: masterProbe.channels,
          },
          {
            recording_id: job.recording_id,
            kind: 'preview',
            storage_key: keys.preview,
            mime_type: 'audio/mpeg',
            byte_size: previewBytes.size,
            sha256: previewSha,
            codec: 'mp3',
            sample_rate: previewProbe.sampleRate,
            channels: previewProbe.channels,
          },
          {
            recording_id: job.recording_id,
            kind: 'peaks',
            storage_key: keys.peaks,
            mime_type: 'application/json',
            byte_size: Buffer.byteLength(peaks),
            sha256: peaksSha,
          },
        ])
        .execute();
      const updated = await tx
        .updateTable('recordings')
        .set({ status: 'ready', duration_ms: Math.round(probe.durationSeconds * 1000) })
        .where('id', '=', job.recording_id)
        .where('status', '=', 'processing')
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) throw new Error('recording left processing while the job ran');
      await tx
        .updateTable('uploads')
        .set({ status: 'processed', original_sha256: original.sha256, processed_at: new Date() })
        .where('id', '=', job.id)
        .execute();
      return old.map((o) => o.storage_key);
    });
    uploaded.length = 0;

    // 8. The original is never kept, only its hash. Old outputs go too.
    await deps.storage.deleteQuarantine([job.quarantine_key]).catch((e) => log.warn({ err: e }, 'quarantine delete failed'));
    await deps.storage.deleteMedia(oldKeys).catch((e) => log.warn({ err: e }, 'old media delete failed'));
    log.info({ event: 'upload_processed', durationSeconds: probe.durationSeconds }, 'processed');
    return 'processed';
  } catch (err) {
    const code = err instanceof Rejection ? err.code : 'processing_error';
    if (!(err instanceof Rejection)) log.error({ err }, 'processing failed unexpectedly');
    await reject(deps, job, code);
    await deps.storage.deleteMedia(uploaded).catch(() => undefined);
    await deps.storage.deleteQuarantine([job.quarantine_key]).catch(() => undefined);
    log.warn({ event: 'upload_rejected', code }, 'upload rejected');
    return 'rejected';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function validateProbe(p: ProbeResult, format: AudioFormat): void {
  if (!FORMAT_NAMES[format].test(p.formatName)) throw new Rejection('format_mismatch');
  if (p.audioStreams < 1) throw new Rejection('no_audio_stream');
  if (!Number.isFinite(p.durationSeconds) || p.durationSeconds < 1) throw new Rejection('too_short');
  if (p.durationSeconds > MAX_DURATION_SECONDS) throw new Rejection('too_long');
}

/** Only the newest upload for a still-processing recording is worth doing. */
async function isCurrent(db: Db, job: ClaimedUpload): Promise<boolean> {
  const newer = await db
    .selectFrom('uploads')
    .where('recording_id', '=', job.recording_id)
    .where('id', '!=', job.id)
    .where('status', 'in', ['received', 'processing', 'processed'])
    .where('created_at', '>', (eb) => eb.selectFrom('uploads').where('id', '=', job.id).select('created_at'))
    .select('id')
    .executeTakeFirst();
  if (newer) return false;
  const rec = await db
    .selectFrom('recordings')
    .where('id', '=', job.recording_id)
    .where('status', '=', 'processing')
    .select('id')
    .executeTakeFirst();
  return !!rec;
}

async function reject(deps: PipelineDeps, job: ClaimedUpload, code: string): Promise<void> {
  await deps.db.transaction().execute(async (tx) => {
    await tx
      .updateTable('uploads')
      .set({ status: 'rejected', rejection_code: code, processed_at: new Date() })
      .where('id', '=', job.id)
      .execute();
    const failed = await tx
      .updateTable('recordings')
      .set({ status: 'processing_failed' })
      .where('id', '=', job.recording_id)
      .where('status', '=', 'processing')
      .executeTakeFirst();
    if (failed.numUpdatedRows > 0n) {
      await tx
        .insertInto('notifications')
        .values({
          user_id: job.user_id,
          recording_id: job.recording_id,
          kind: 'processing_failed',
          message: REJECTION_MESSAGES[code] ?? REJECTION_MESSAGES.processing_error!,
        })
        .execute();
    }
    await tx
      .insertInto('audit_log')
      .values({
        action: 'upload.rejected',
        target_type: 'recording',
        target_id: job.recording_id,
        details: JSON.stringify({ code }),
      })
      .execute();
  });
}

/** Marks long-abandoned uploads expired and deletes their quarantined bytes. */
export async function sweepAbandoned(db: Db, storage: WorkerStorage): Promise<number> {
  const stale = await db
    .updateTable('uploads')
    .set({ status: 'expired' })
    .where('status', '=', 'pending')
    .where('expires_at', '<', new Date(Date.now() - 60 * 60 * 1000))
    .returning('quarantine_key')
    .execute();
  await storage.deleteQuarantine(stale.map((s) => s.quarantine_key)).catch(() => undefined);
  return stale.length;
}

/** Streams the file through SHA-256 (masters can be large). */
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function sha256(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}
