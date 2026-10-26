import {
  DATE_CONFIDENCES,
  LICENSES,
  LOCATION_PRECISIONS,
  RECORDING_STATUSES,
  RIGHTS_STATUSES,
  SOUND_CATEGORIES,
  SOURCE_TYPES,
  SPEECH_CONSENTS,
  USER_ROLES,
  snapToPrecision,
  type LocationPrecision,
} from '@timecapsule/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.js';
import {
  createTestDatabase,
  insertRecording,
  insertUser,
  type TestDatabase,
} from '../src/testing.js';

let t: TestDatabase;
let owner: string;
let stranger: string;
let moderator: string;

beforeAll(async () => {
  t = await createTestDatabase();
  owner = await insertUser(t.admin);
  stranger = await insertUser(t.admin);
  moderator = await insertUser(t.admin, { role: 'moderator' });
}, 60_000);

afterAll(async () => {
  await t?.close();
});

/** Runs SQL as an application role with an RLS user context. */
async function as<T = Record<string, unknown>>(
  role: 'tc_api' | 'tc_worker',
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await t.pglite.exec(`SET ROLE ${role}`);
  try {
    await t.pglite.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    return (await t.pglite.query<T>(sql, params)).rows;
  } finally {
    await t.pglite.exec(`RESET ROLE; RESET app.user_id`);
  }
}

async function statusOf(id: string): Promise<string> {
  const [r] = await t.admin.query<{ status: string }>('SELECT status FROM recordings WHERE id = $1', [id]);
  return r!.status;
}

describe('migrations', () => {
  it('are idempotent', async () => {
    const again = await migrate(t.admin);
    expect(again.applied).toEqual([]);
    expect(again.skipped.length).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ['recording_status', RECORDING_STATUSES],
    ['source_type', SOURCE_TYPES],
    ['date_confidence', DATE_CONFIDENCES],
    ['location_precision', LOCATION_PRECISIONS],
    ['sound_category', SOUND_CATEGORIES],
    ['license', LICENSES],
    ['rights_status', RIGHTS_STATUSES],
    ['speech_consent', SPEECH_CONSENTS],
    ['user_role', USER_ROLES],
  ] as const)('enum %s matches @timecapsule/shared', async (name, values) => {
    const rows = await t.admin.query<{ v: string }>(
      `SELECT unnest(enum_range(NULL::${name}))::text AS v`,
    );
    expect(rows.map((r) => r.v)).toEqual([...values]);
  });

  it('application roles cannot bypass RLS and own nothing', async () => {
    const rows = await t.admin.query<{ rolname: string; rolbypassrls: boolean; owns: number }>(
      `SELECT r.rolname, r.rolbypassrls,
              (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns
       FROM pg_roles r WHERE r.rolname IN ('tc_api', 'tc_worker', 'tc_auth')`,
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.rolbypassrls).toBe(false);
      expect(r.owns).toBe(0);
    }
  });
});

describe('location privacy', () => {
  it('never stores the raw coordinate', async () => {
    const id = await insertRecording(t.admin, {
      contributorId: owner,
      lat: 35.659512,
      lon: 139.700473,
      precision: 'neighborhood_1km',
    });
    const [r] = await t.admin.query<{ lat: number; lon: number }>(
      'SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM recordings WHERE id = $1',
      [id],
    );
    expect(r).toEqual(snapToPrecision(35.659512, 139.700473, 'neighborhood_1km'));
  });

  it('re-snaps when precision is coarsened', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, precision: 'site_100m' });
    await t.admin.query(`UPDATE recordings SET location_precision = 'city_10km' WHERE id = $1`, [id]);
    const [r] = await t.admin.query<{ lat: number }>(
      'SELECT ST_Y(location::geometry) AS lat FROM recordings WHERE id = $1',
      [id],
    );
    expect(r!.lat).toBe(35.7);
  });

  it('matches the TypeScript snapper across the globe', async () => {
    const samples: [number, number, LocationPrecision][] = [];
    for (let i = 0; i < 60; i++) {
      const lat = -85 + ((i * 37.13) % 170);
      const lon = -179 + ((i * 91.7) % 358);
      samples.push([lat, lon, LOCATION_PRECISIONS[i % 3]!]);
    }
    for (const [lat, lon, p] of samples) {
      const [r] = await t.admin.query<{ lat: number; lon: number }>(
        `SELECT ST_Y(g::geometry) AS lat, ST_X(g::geometry) AS lon
         FROM (SELECT app.snap_location(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3) AS g) s`,
        [lon, lat, p],
      );
      const ts = snapToPrecision(lat, lon, p);
      expect(r!.lat).toBeCloseTo(ts.lat, 6);
      expect(r!.lon).toBeCloseTo(ts.lon, 6);
    }
  });
});

describe('provenance constraints', () => {
  it('requires a disclosure for reconstructions', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, sourceType: 'community_reconstruction' });
    await expect(
      t.admin.query(`UPDATE recordings SET synthetic_disclosure = '  ' WHERE id = $1`, [id]),
    ).rejects.toThrow(/reconstruction_disclosed/);
  });

  it('rejects an authentic recording whose era is not its capture year', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, eraYear: 1982 });
    await expect(
      t.admin.query(`UPDATE recordings SET era_year = 1975 WHERE id = $1`, [id]),
    ).rejects.toThrow(/authentic_era_matches_capture/);
  });

  it('blocks incomplete provenance from being published', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner });
    await expect(
      t.admin.query(`UPDATE recordings SET license = NULL WHERE id = $1`, [id]),
    ).rejects.toThrow(/complete_when_submitted/);
  });

  it('never publishes disputed rights', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner });
    await expect(
      t.admin.query(`UPDATE recordings SET rights_status = 'disputed' WHERE id = $1`, [id]),
    ).rejects.toThrow(/published_not_disputed/);
  });
});

describe('row-level security: visibility', () => {
  let published: string;
  let draft: string;

  beforeAll(async () => {
    published = await insertRecording(t.admin, { contributorId: owner, status: 'published' });
    draft = await insertRecording(t.admin, { contributorId: owner, status: 'ready' });
  });

  const visible = async (userId: string | null) =>
    (await as<{ id: string }>('tc_api', userId, 'SELECT id FROM recordings WHERE id = ANY($1)', [[published, draft]]))
      .map((r) => r.id)
      .sort();

  it('anonymous users see only published recordings', async () => {
    expect(await visible(null)).toEqual([published]);
  });
  it('other users cannot see unpublished submissions', async () => {
    expect(await visible(stranger)).toEqual([published]);
  });
  it('owners see their own unpublished submissions', async () => {
    expect(await visible(owner)).toEqual([published, draft].sort());
  });
  it('moderators see everything', async () => {
    expect(await visible(moderator)).toEqual([published, draft].sort());
  });
  it('audio assets follow recording visibility', async () => {
    await t.admin.query(
      `INSERT INTO audio_assets (recording_id, kind, storage_key, mime_type, byte_size, sha256)
       VALUES ($1, 'preview', $2, 'audio/mpeg', 10, repeat('a', 64))`,
      [draft, `media/${draft.replace(/-/g, '')}.mp3`],
    );
    expect(await as('tc_api', stranger, 'SELECT 1 FROM audio_assets WHERE recording_id = $1', [draft])).toEqual([]);
    expect(await as('tc_api', owner, 'SELECT 1 FROM audio_assets WHERE recording_id = $1', [draft])).toHaveLength(1);
  });
});

describe('row-level security: writes', () => {
  it('users can only create drafts for themselves', async () => {
    await expect(
      as('tc_api', owner, `INSERT INTO recordings (contributor_id) VALUES ($1)`, [stranger]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as('tc_api', owner, `INSERT INTO recordings (contributor_id, status) VALUES ($1, 'published')`, [owner]),
    ).rejects.toThrow(/row-level security/);
    const rows = await as<{ id: string }>(
      'tc_api',
      owner,
      `INSERT INTO recordings (contributor_id, title_en) VALUES ($1, 'Mine') RETURNING id`,
      [owner],
    );
    expect(rows).toHaveLength(1);
  });

  it('anonymous users cannot create recordings', async () => {
    await expect(
      as('tc_api', null, `INSERT INTO recordings (contributor_id) VALUES ($1)`, [owner]),
    ).rejects.toThrow(/row-level security/);
  });

  it("users cannot modify someone else's submission", async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'ready' });
    const rows = await as('tc_api', stranger, `UPDATE recordings SET title_en = 'pwned' WHERE id = $1 RETURNING id`, [id]);
    expect(rows).toEqual([]);
  });

  it('owners can edit while unpublished but not once submitted', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'ready' });
    await as('tc_api', owner, `UPDATE recordings SET title_en = 'Edited' WHERE id = $1`, [id]);
    await as('tc_api', owner, `UPDATE recordings SET status = 'pending_review' WHERE id = $1`, [id]);
    expect(await statusOf(id)).toBe('pending_review');
    await expect(
      as('tc_api', owner, `UPDATE recordings SET title_en = 'Sneaky' WHERE id = $1`, [id]),
    ).rejects.toThrow(/not editable/);
  });

  it('owners cannot edit published recordings', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'published' });
    await expect(
      as('tc_api', owner, `UPDATE recordings SET title_en = 'Changed' WHERE id = $1`, [id]),
    ).rejects.toThrow(/not editable/);
  });

  it('owners cannot publish their own submission', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'pending_review' });
    await expect(
      as('tc_api', owner, `UPDATE recordings SET status = 'published' WHERE id = $1`, [id]),
    ).rejects.toThrow(/may not move/);
  });

  it('owners cannot set system-managed fields', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'ready' });
    await expect(
      as('tc_api', owner, `UPDATE recordings SET duration_ms = 1 WHERE id = $1`, [id]),
    ).rejects.toThrow(/system-managed/);
  });

  it('owners can only delete unpublished submissions', async () => {
    const pub = await insertRecording(t.admin, { contributorId: owner, status: 'published' });
    expect(await as('tc_api', owner, `DELETE FROM recordings WHERE id = $1 RETURNING id`, [pub])).toEqual([]);
    const draft = await insertRecording(t.admin, { contributorId: owner, status: 'ready' });
    expect(await as('tc_api', owner, `DELETE FROM recordings WHERE id = $1 RETURNING id`, [draft])).toHaveLength(1);
  });
});

describe('moderation rules', () => {
  const review = (recordingId: string, moderatorId: string, decision: 'approve' | 'reject', allChecks = true) =>
    as(
      'tc_api',
      moderatorId,
      `INSERT INTO moderation_reviews
         (recording_id, moderator_id, decision, chk_audio_quality, chk_rights, chk_location, chk_no_private_speech, reason)
       VALUES ($1, $2, $3, $4, true, true, true, $5)`,
      [recordingId, moderatorId, decision, allChecks, decision === 'reject' ? 'Audio is clipped throughout.' : null],
    );

  it('only moderators can review', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'pending_review' });
    await expect(review(id, stranger, 'approve')).rejects.toThrow(/row-level security/);
  });

  it('approval requires the full checklist', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'pending_review' });
    await expect(review(id, moderator, 'approve', false)).rejects.toThrow(/approve_requires_full_checklist/);
  });

  it('publishing requires a recorded approval', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'pending_review' });
    await expect(
      as('tc_api', moderator, `UPDATE recordings SET status = 'published' WHERE id = $1`, [id]),
    ).rejects.toThrow(/review must be recorded/);
    await review(id, moderator, 'approve');
    await as('tc_api', moderator, `UPDATE recordings SET status = 'published' WHERE id = $1`, [id]);
    expect(await statusOf(id)).toBe('published');
  });

  it('moderators cannot review their own submissions', async () => {
    const id = await insertRecording(t.admin, { contributorId: moderator, status: 'pending_review' });
    await expect(review(id, moderator, 'approve')).rejects.toThrow(/own submissions/);
  });

  it('moderators cannot rewrite content', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'published' });
    await expect(
      as('tc_api', moderator, `UPDATE recordings SET title_en = 'Moderated' WHERE id = $1`, [id]),
    ).rejects.toThrow(/may not edit recording content/);
  });

  it('moderators can unpublish (takedown)', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'published' });
    await as('tc_api', moderator, `UPDATE recordings SET status = 'unpublished' WHERE id = $1`, [id]);
    expect(await statusOf(id)).toBe('unpublished');
    expect(await as('tc_api', null, 'SELECT 1 FROM recordings WHERE id = $1', [id])).toEqual([]);
  });
});

describe('worker role', () => {
  it('cannot see or touch anything outside processing', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'published' });
    expect(await as('tc_worker', null, 'SELECT 1 FROM recordings WHERE id = $1', [id])).toEqual([]);
  });

  it('can finish processing but not publish', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'processing' });
    await expect(
      as('tc_worker', null, `UPDATE recordings SET status = 'published' WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await as('tc_worker', null, `UPDATE recordings SET status = 'ready', duration_ms = 1234 WHERE id = $1`, [id]);
    expect(await statusOf(id)).toBe('ready');
  });
});

describe('sensitive data', () => {
  it('the API role cannot read emails or OAuth tokens', async () => {
    await expect(as('tc_api', owner, 'SELECT email FROM users')).rejects.toThrow(/permission denied/);
    await expect(as('tc_api', owner, 'SELECT access_token FROM accounts')).rejects.toThrow(/permission denied/);
    expect(await as('tc_api', owner, 'SELECT display_name FROM users WHERE id = $1', [owner])).toHaveLength(1);
  });

  it('the audit log is append-only for application roles', async () => {
    await as('tc_api', owner, `INSERT INTO audit_log (actor_id, action) VALUES ($1, 'test.event')`, [owner]);
    await expect(as('tc_api', owner, 'SELECT * FROM audit_log')).rejects.toThrow(/permission denied/);
    await expect(as('tc_api', owner, 'DELETE FROM audit_log')).rejects.toThrow(/permission denied/);
    await expect(as('tc_api', owner, `UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/permission denied/);
  });

  it('takedown requests are write-only for the public', async () => {
    await as(
      'tc_api',
      null,
      `INSERT INTO takedown_requests (claimant_name, claimant_email, basis, statement, good_faith_attested)
       VALUES ('A Claimant', 'a@example.com', 'copyright', 'This is my recording, used without permission.', true)`,
    );
    expect(await as('tc_api', null, 'SELECT * FROM takedown_requests')).toEqual([]);
    expect(await as('tc_api', moderator, 'SELECT * FROM takedown_requests')).toHaveLength(1);
  });
});

describe('contribution flow (0006)', () => {
  it('users can edit only their own profile', async () => {
    await as('tc_api', owner, `UPDATE users SET display_name = 'New Name' WHERE id = $1`, [owner]);
    const touched = await as('tc_api', owner, `UPDATE users SET display_name = 'Hijack' WHERE id = $1 RETURNING id`, [stranger]);
    expect(touched).toEqual([]);
    await expect(as('tc_api', owner, `UPDATE users SET role = 'admin' WHERE id = $1`, [owner])).rejects.toThrow(
      /permission denied/,
    );
  });

  it('~100 m precision requires a public-place attestation once submitted', async () => {
    const id = await insertRecording(t.admin, { contributorId: owner, status: 'ready', precision: 'site_100m' });
    await t.admin.query('UPDATE recordings SET public_place_attested = false WHERE id = $1', [id]);
    await expect(
      as('tc_api', owner, `UPDATE recordings SET status = 'pending_review' WHERE id = $1`, [id]),
    ).rejects.toThrow(/site_precision_attested/);
  });

  it('the API can only mark an upload received, never processed', async () => {
    const rec = await insertRecording(t.admin, { contributorId: owner, status: 'draft' });
    const [up] = await t.admin.query<{ id: string }>(
      `INSERT INTO uploads (recording_id, user_id, quarantine_key, declared_bytes, declared_format, expires_at)
       VALUES ($1, $2, 'quarantine/' || md5(random()::text), 1000, 'wav', now() + interval '15 minutes') RETURNING id`,
      [rec, owner],
    );
    await expect(
      as('tc_api', owner, `UPDATE uploads SET status = 'processed' WHERE id = $1`, [up!.id]),
    ).rejects.toThrow(/may not move/);
    await as('tc_api', owner, `UPDATE uploads SET status = 'received' WHERE id = $1`, [up!.id]);
    expect(await as('tc_api', stranger, 'SELECT 1 FROM uploads WHERE id = $1', [up!.id])).toEqual([]);
  });

  it('the worker resolves an email recipient only for opted-in users', async () => {
    const [n] = await t.admin.query<{ id: string }>(
      `INSERT INTO notifications (user_id, kind, message) VALUES ($1, 'submission_rejected', 'x') RETURNING id`,
      [owner],
    );
    const rows = await as<{ email: string }>('tc_worker', null, 'SELECT * FROM app.notification_recipient($1)', [n!.id]);
    expect(rows).toHaveLength(1);
    await t.admin.query('UPDATE users SET email_notifications = false WHERE id = $1', [owner]);
    expect(await as('tc_worker', null, 'SELECT * FROM app.notification_recipient($1)', [n!.id])).toEqual([]);
    await t.admin.query('UPDATE users SET email_notifications = true WHERE id = $1', [owner]);
    await expect(as('tc_api', owner, 'SELECT * FROM app.notification_recipient($1)', [n!.id])).rejects.toThrow(
      /permission denied/,
    );
  });
});
