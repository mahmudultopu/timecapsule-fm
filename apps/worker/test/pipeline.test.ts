import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '@timecapsule/db';
import { createTestDatabase, insertRecording, insertUser, type TestDatabase } from '@timecapsule/db/testing';
import { Peaks } from '@timecapsule/shared';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flushOutbox } from '../src/outbox.js';
import { claimNext, processUpload, sweepAbandoned, type ClaimedUpload } from '../src/pipeline.js';
import { FakeMedia, FakeStorage, wav } from './fakes.js';

let t: TestDatabase;
let worker: Db;
let owner: string;
let workDir: string;
const log = pino({ level: 'silent' });
let storage: FakeStorage;
let media: FakeMedia;

beforeAll(async () => {
  t = await createTestDatabase();
  // Everything below runs as the worker's database role, so its RLS applies.
  worker = t.kysely('tc_worker');
  owner = await insertUser(t.admin);
  workDir = await mkdtemp(join(tmpdir(), 'tc-worker-test-'));
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  storage = new FakeStorage();
  media = new FakeMedia();
});

let keyCounter = 0;

/** A recording in `processing` with one received upload holding `body`. */
async function queued(body: Buffer, format = 'wav', declared = body.length): Promise<ClaimedUpload> {
  const recordingId = await insertRecording(t.admin, { contributorId: owner, status: 'processing' });
  const key = `quarantine/${String(++keyCounter).padStart(32, '0')}`;
  await t.admin.query(
    `INSERT INTO uploads (recording_id, user_id, quarantine_key, declared_bytes, declared_format, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'received', now() + interval '15 minutes')`,
    [recordingId, owner, key, declared, format],
  );
  storage.quarantine.set(key, body);
  const job = await claimNext(worker);
  expect(job?.recording_id).toBe(recordingId);
  return job!;
}

const deps = () => ({ db: worker, storage, media, workDir, log });

async function state(job: ClaimedUpload) {
  const [rec] = await t.admin.query<{ status: string; duration_ms: number | null }>(
    'SELECT status, duration_ms FROM recordings WHERE id = $1',
    [job.recording_id],
  );
  const [up] = await t.admin.query<{ status: string; rejection_code: string | null; original_sha256: string | null }>(
    'SELECT status, rejection_code, original_sha256 FROM uploads WHERE id = $1',
    [job.id],
  );
  const notes = await t.admin.query<{ kind: string; message: string }>(
    'SELECT kind, message FROM notifications WHERE recording_id = $1',
    [job.recording_id],
  );
  return { rec: rec!, up: up!, notes };
}

describe('upload pipeline', () => {
  it('processes a valid file into master, preview and peaks', async () => {
    const job = await queued(wav(3));
    expect(await processUpload(deps(), job)).toBe('processed');

    const s = await state(job);
    expect(s.rec).toEqual({ status: 'ready', duration_ms: 3000 });
    expect(s.up.status).toBe('processed');
    expect(s.up.original_sha256).toMatch(/^[0-9a-f]{64}$/);

    const assets = await t.admin.query<{ kind: string; storage_key: string }>(
      'SELECT kind, storage_key FROM audio_assets WHERE recording_id = $1 ORDER BY kind::text',
      [job.recording_id],
    );
    expect(assets.map((a) => a.kind)).toEqual(['master', 'peaks', 'preview']);
    for (const a of assets) expect(storage.media.has(a.storage_key)).toBe(true);
    const peaks = Peaks.parse(JSON.parse(storage.media.get(assets[1]!.storage_key)!.toString()));
    expect(peaks.data.length).toBeGreaterThan(10);

    // The original is deleted; only its hash remains.
    expect(storage.quarantine.has(job.quarantine_key)).toBe(false);
  });

  it('rejects a disguised file by its magic bytes', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
    const job = await queued(png);
    expect(await processUpload(deps(), job)).toBe('rejected');
    const s = await state(job);
    expect(s.rec.status).toBe('processing_failed');
    expect(s.up).toMatchObject({ status: 'rejected', rejection_code: 'unsupported_format' });
    expect(s.notes).toEqual([{ kind: 'processing_failed', message: 'The file is not WAV, FLAC, MP3 or OGG audio.' }]);
    expect(storage.quarantine.has(job.quarantine_key)).toBe(false);
    const audit = await t.admin.query('SELECT 1 FROM audit_log WHERE action = $1 AND target_id = $2', [
      'upload.rejected',
      job.recording_id,
    ]);
    expect(audit).toHaveLength(1);
  });

  it('rejects a file whose bytes contradict the declared format', async () => {
    const job = await queued(wav(2), 'flac');
    await processUpload(deps(), job);
    expect((await state(job)).up.rejection_code).toBe('format_mismatch');
  });

  it('enforces the 30-minute limit from the actual audio, not the client', async () => {
    const job = await queued(wav(1, { claimSeconds: 30 * 60 + 1 }));
    await processUpload(deps(), job);
    expect((await state(job)).up.rejection_code).toBe('too_long');
  });

  it('refuses objects larger than declared', async () => {
    const body = wav(2);
    const job = await queued(body, 'wav', body.length - 100);
    await processUpload(deps(), job);
    expect((await state(job)).up.rejection_code).toBe('too_large');
  });

  it('never publishes outputs that still carry metadata', async () => {
    media.outputTags = ['encoder', 'location'];
    const job = await queued(wav(2));
    expect(await processUpload(deps(), job)).toBe('rejected');
    expect((await state(job)).up.rejection_code).toBe('processing_error');
    // Anything already uploaded for this job is cleaned up.
    expect(storage.media.size).toBe(0);
  });

  it('skips an upload that a newer one superseded', async () => {
    const job = await queued(wav(2));
    await t.admin.query(
      `INSERT INTO uploads (recording_id, user_id, quarantine_key, declared_bytes, declared_format, status, expires_at, created_at)
       VALUES ($1, $2, 'quarantine/ffffffffffffffffffffffffffffffff', 10, 'wav', 'received', now() + interval '1 hour', now() + interval '1 second')`,
      [job.recording_id, owner],
    );
    expect(await processUpload(deps(), job)).toBe('superseded');
    expect((await state(job)).up.status).toBe('expired');
  });

  it('claims each job once', async () => {
    expect(await claimNext(worker)).toMatchObject({ quarantine_key: 'quarantine/ffffffffffffffffffffffffffffffff' });
    expect(await claimNext(worker)).toBeNull();
  });

  it('sweeps abandoned uploads and their bytes', async () => {
    const rec = await insertRecording(t.admin, { contributorId: owner, status: 'draft' });
    await t.admin.query(
      `INSERT INTO uploads (recording_id, user_id, quarantine_key, declared_bytes, declared_format, expires_at)
       VALUES ($1, $2, 'quarantine/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 10, 'wav', now() - interval '2 hours')`,
      [rec, owner],
    );
    storage.quarantine.set('quarantine/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', Buffer.alloc(10));
    expect(await sweepAbandoned(worker, storage)).toBe(1);
    expect(storage.quarantine.size).toBe(0);
  });
});

describe('notification outbox', () => {
  it('emails opted-in users once, and retries failures', async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    let fail = true;
    const mailer = {
      send: async (m: { to: string; subject: string; text: string }) => {
        if (fail) throw new Error('smtp down');
        sent.push(m);
      },
    };
    await t.admin.query(`UPDATE notifications SET emailed_at = now()`);
    await t.admin.query(
      `INSERT INTO notifications (user_id, kind, message) VALUES ($1, 'submission_published', 'Your recording is live.')`,
      [owner],
    );
    expect(await flushOutbox(worker, mailer, 'https://timecapsule.test', log)).toBe(0);
    const [n] = await t.admin.query<{ email_attempts: number }>('SELECT email_attempts FROM notifications WHERE emailed_at IS NULL');
    expect(n!.email_attempts).toBe(1);

    fail = false;
    expect(await flushOutbox(worker, mailer, 'https://timecapsule.test', log)).toBe(1);
    expect(sent[0]).toMatchObject({ subject: 'Your recording is live on TimeCapsule.fm' });
    expect(sent[0]!.text).toContain('Your recording is live.');
    expect(sent[0]!.to).toMatch(/@test\.invalid$/);
    expect(await flushOutbox(worker, mailer, 'https://timecapsule.test', log)).toBe(0);
  });

  it('respects users who turned email off', async () => {
    await t.admin.query('UPDATE users SET email_notifications = false WHERE id = $1', [owner]);
    await t.admin.query(
      `INSERT INTO notifications (user_id, kind, message) VALUES ($1, 'submission_rejected', 'Needs changes.')`,
      [owner],
    );
    const sent: unknown[] = [];
    await flushOutbox(worker, { send: async (m) => void sent.push(m) }, 'https://x.test', log);
    expect(sent).toEqual([]);
    const pending = await t.admin.query('SELECT 1 FROM notifications WHERE emailed_at IS NULL');
    expect(pending).toEqual([]);
  });
});
