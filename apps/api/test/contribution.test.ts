import { insertAgreement, insertRecording, insertUser } from '@timecapsule/db/testing';
import { snapToPrecision } from '@timecapsule/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { CSRF_COOKIE } from '../src/plugins/csrf.js';
import { APP_ORIGIN, createHarness, sessionCookie, type Harness } from './helpers.js';

// End-to-end through the HTTP layer, a real migrated database and RLS:
// draft -> upload -> (worker stand-in) -> submit -> moderate -> takedown.

let h: Harness;
let app: App;
let alice: string;
let bob: string;
let mod: string;
let agreement: string;

const TOKENS = { alice: 'alice-session-0000001', bob: 'bob-session-000000001', mod: 'mod-session-000000001' };
type Who = keyof typeof TOKENS | null;

beforeAll(async () => {
  h = await createHarness();
  alice = await insertUser(h.t.admin, { displayName: 'Alice' });
  bob = await insertUser(h.t.admin, { displayName: 'Bob' });
  mod = await insertUser(h.t.admin, { role: 'moderator', displayName: 'Mod' });
  agreement = await insertAgreement(h.t.admin);
  h.sessions.set(TOKENS.alice, { id: alice, role: 'contributor' });
  h.sessions.set(TOKENS.bob, { id: bob, role: 'contributor' });
  h.sessions.set(TOKENS.mod, { id: mod, role: 'moderator' });
  app = await h.build();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await h?.t.close();
});

/** Sends a request the way the web app does: session cookie, same origin, CSRF token. */
async function call(who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, ip = '10.0.0.1') {
  const csrf = await app.inject({ url: '/v1/csrf' });
  const token = csrf.json().token as string;
  const cookies = [`${CSRF_COOKIE}=${token}`];
  if (who) cookies.push(sessionCookie(TOKENS[who]));
  return app.inject({
    method,
    url,
    remoteAddress: ip,
    headers: { origin: APP_ORIGIN, 'x-csrf-token': token, cookie: cookies.join('; ') },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
}

const fullFields = {
  titleEn: 'Night bus depot',
  placeNameEn: 'Depot yard',
  cityEn: 'Leeds',
  countryCode: 'GB',
  sceneDescriptionEn: 'Idling diesel engines and a distant tannoy at closing time.',
  category: 'transit',
  eraYear: 1994,
  capturedFrom: '1994-03-01',
  capturedTo: '1994-03-01',
  dateConfidence: 'exact',
  sourceType: 'original_field_recording',
  recorderName: null,
  location: { lat: 53.79123, lon: -1.54321 },
  locationPrecision: 'neighborhood_1km',
  license: 'cc_by_4',
  rightsStatus: 'contributor_owns',
  rightsHolder: 'Alice',
  attribution: 'Alice, CC BY 4.0',
  speechConsent: 'no_identifiable_speech',
};

const confirmations = { rights: true, accuracy: true, consent: true };

describe('contribution flow', () => {
  let id: string;

  it('requires sign-in', async () => {
    expect((await call(null, 'POST', '/v1/submissions', {})).statusCode).toBe(401);
  });

  it('creates a partial draft and reports what is missing', async () => {
    const res = await call('alice', 'POST', '/v1/submissions', { titleEn: 'Night bus depot' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    id = body.id;
    expect(body.status).toBe('draft');
    expect(body.missing).toEqual(expect.arrayContaining(['license', 'location', 'audio']));
  });

  it("hides one contributor's drafts from another", async () => {
    expect((await call('bob', 'GET', `/v1/submissions/${id}`)).statusCode).toBe(404);
    expect((await call('bob', 'PATCH', `/v1/submissions/${id}`, { titleEn: 'Mine now' })).statusCode).toBe(404);
    expect((await call('bob', 'DELETE', `/v1/submissions/${id}`)).statusCode).toBe(409);
    expect((await call(null, 'GET', `/v1/recordings/${id}`)).statusCode).toBe(404);
  });

  it('validates fields and stores only the snapped location', async () => {
    expect((await call('alice', 'PATCH', `/v1/submissions/${id}`, { rightsStatus: 'disputed' })).statusCode).toBe(400);
    const res = await call('alice', 'PATCH', `/v1/submissions/${id}`, fullFields);
    expect(res.statusCode).toBe(200);
    // Stored coarsened (the longitude grid widens with latitude), never the raw point.
    expect(res.json().fields.location).toEqual(snapToPrecision(53.79123, -1.54321, 'neighborhood_1km'));
    expect(res.json().missing).toEqual(['audio']);
  });

  it('enforces upload limits before signing anything', async () => {
    const over = await call('alice', 'POST', `/v1/submissions/${id}/upload-intent`, {
      bytes: 200 * 1024 * 1024 + 1,
      format: 'wav',
    });
    expect(over.statusCode).toBe(400);
    const exe = await call('alice', 'POST', `/v1/submissions/${id}/upload-intent`, { bytes: 1000, format: 'exe' });
    expect(exe.statusCode).toBe(400);
    expect(h.storage.uploads).toHaveLength(0);
  });

  it('signs a quarantine PUT bound to the declared size and type', async () => {
    const res = await call('alice', 'POST', `/v1/submissions/${id}/upload-intent`, { bytes: 4096, format: 'flac' });
    expect(res.statusCode).toBe(200);
    expect(res.json().headers).toEqual({ 'content-type': 'audio/flac' });
    const signed = h.storage.uploads.at(-1)!;
    expect(signed).toMatchObject({ contentLength: 4096, contentType: 'audio/flac' });
    expect(signed.key).toMatch(/^quarantine\/[0-9a-f]{32}$/);
    expect(Object.keys(res.json()).sort()).toEqual(['expiresAt', 'headers', 'method', 'uploadId', 'url']);
  });

  it('rejects completion when the object is missing or the wrong size, and audits it', async () => {
    const intent = (
      await call('alice', 'POST', `/v1/submissions/${id}/upload-intent`, { bytes: 5000, format: 'wav' })
    ).json();
    const missing = await call('alice', 'POST', `/v1/submissions/${id}/upload-complete`, { uploadId: intent.uploadId });
    expect(missing.json().error.code).toBe('missing_object');

    h.storage.quarantine.set(h.storage.uploads.at(-1)!.key, 9999);
    const wrong = await call('alice', 'POST', `/v1/submissions/${id}/upload-complete`, { uploadId: intent.uploadId });
    expect(wrong.json().error.code).toBe('size_mismatch');
    expect(h.audit.some((e) => e.action === 'upload.rejected' && e.details?.reason === 'size_mismatch')).toBe(true);
  });

  it('queues a verified upload for the worker', async () => {
    const intent = (
      await call('alice', 'POST', `/v1/submissions/${id}/upload-intent`, { bytes: 5000, format: 'wav' })
    ).json();
    h.storage.quarantine.set(h.storage.uploads.at(-1)!.key, 5000);
    const res = await call('alice', 'POST', `/v1/submissions/${id}/upload-complete`, { uploadId: intent.uploadId });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('processing');
    expect(res.json().upload.status).toBe('received');
  });

  it('cannot be submitted until the audio is processed', async () => {
    const res = await call('alice', 'POST', `/v1/submissions/${id}/submit`, { agreementVersion: agreement, confirmations });
    expect(res.statusCode).toBe(422);
  });

  it('submits with the current agreement once processing has finished', async () => {
    // Stand-in for the worker (the worker has its own pipeline tests).
    await h.t.admin.query(`UPDATE recordings SET status = 'ready', duration_ms = 61000 WHERE id = $1`, [id]);
    const hex = id.replace(/-/g, '');
    await h.t.admin.query(
      `INSERT INTO audio_assets (recording_id, kind, storage_key, mime_type, byte_size, sha256)
       VALUES ($1, 'preview', $2, 'audio/mpeg', 10, repeat('c', 64)),
              ($1, 'peaks', $3, 'application/json', 10, repeat('d', 64))`,
      [id, `media/${hex}.mp3`, `media/${hex}.json`],
    );

    const stale = await call('alice', 'POST', `/v1/submissions/${id}/submit`, {
      agreementVersion: '2020-01-01',
      confirmations,
    });
    expect(stale.json().error.code).toBe('agreement_outdated');
    const unticked = await call('alice', 'POST', `/v1/submissions/${id}/submit`, {
      agreementVersion: agreement,
      confirmations: { ...confirmations, consent: false },
    });
    expect(unticked.statusCode).toBe(400);

    const res = await call('alice', 'POST', `/v1/submissions/${id}/submit`, { agreementVersion: agreement, confirmations });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'pending_review', agreementVersion: agreement });
    expect(res.json().submittedAt).toBeTruthy();
  });

  it('locks the submission while it is under review', async () => {
    const res = await call('alice', 'PATCH', `/v1/submissions/${id}`, { titleEn: 'Changed' });
    expect(res.statusCode).toBe(409);
  });

  it('lets the owner and moderators preview the audio, nobody else', async () => {
    expect((await call('alice', 'GET', `/v1/submissions/${id}/playback`)).statusCode).toBe(200);
    expect((await call('mod', 'GET', `/v1/submissions/${id}/playback`)).statusCode).toBe(200);
    expect((await call('bob', 'GET', `/v1/submissions/${id}/playback`)).statusCode).toBe(404);
    expect((await call(null, 'GET', `/v1/recordings/${id}/playback`)).statusCode).toBe(404);
  });

  describe('moderation', () => {
    const allChecks = { audioQuality: true, rights: true, location: true, noPrivateSpeech: true };

    it('is moderator-only', async () => {
      expect((await call('alice', 'GET', '/v1/moderation/queue')).statusCode).toBe(403);
      const res = await call('alice', 'POST', `/v1/moderation/submissions/${id}/decision`, {
        decision: 'approve',
        checklist: allChecks,
      });
      expect(res.statusCode).toBe(403);
    });

    it('lists pending submissions', async () => {
      const res = await call('mod', 'GET', '/v1/moderation/queue');
      expect(res.json().map((q: { id: string }) => q.id)).toContain(id);
    });

    it('requires the full checklist to approve and a reason to reject', async () => {
      const partial = await call('mod', 'POST', `/v1/moderation/submissions/${id}/decision`, {
        decision: 'approve',
        checklist: { ...allChecks, rights: false },
      });
      expect(partial.statusCode).toBe(400);
      const noReason = await call('mod', 'POST', `/v1/moderation/submissions/${id}/decision`, {
        decision: 'reject',
        checklist: allChecks,
      });
      expect(noReason.statusCode).toBe(400);
    });

    it('publishes on approval, notifies the contributor, and audits the action', async () => {
      const res = await call('mod', 'POST', `/v1/moderation/submissions/${id}/decision`, {
        decision: 'approve',
        checklist: allChecks,
      });
      expect(res.statusCode).toBe(204);
      expect((await call(null, 'GET', `/v1/recordings/${id}`)).statusCode).toBe(200);
      const notes = (await call('alice', 'GET', '/v1/me/notifications')).json();
      expect(notes[0]).toMatchObject({ kind: 'submission_published', recordingId: id });
      expect(h.audit.some((e) => e.action === 'moderation.approve' && e.targetId === id)).toBe(true);
      expect(await app.metrics.registry.getSingleMetricAsString('tc_moderation_decisions_total')).toMatch(
        /decision="approve"} 1/,
      );
    });

    it('sends the rejection reason to the contributor', async () => {
      const other = await insertRecording(h.t.admin, { contributorId: alice, status: 'pending_review' });
      const res = await call('mod', 'POST', `/v1/moderation/submissions/${other}/decision`, {
        decision: 'reject',
        checklist: { ...allChecks, noPrivateSpeech: false },
        reason: 'A private conversation is clearly audible at 0:42.',
      });
      expect(res.statusCode).toBe(204);
      const detail = (await call('alice', 'GET', `/v1/submissions/${other}`)).json();
      expect(detail.status).toBe('rejected');
      expect(detail.review).toMatchObject({
        decision: 'reject',
        reason: 'A private conversation is clearly audible at 0:42.',
      });
      // Rejected work can be edited and resubmitted.
      expect((await call('alice', 'PATCH', `/v1/submissions/${other}`, { titleEn: 'Fixed' })).statusCode).toBe(200);
    });

    it('stops moderators reviewing their own work', async () => {
      const own = await insertRecording(h.t.admin, { contributorId: mod, status: 'pending_review' });
      const res = await call('mod', 'POST', `/v1/moderation/submissions/${own}/decision`, {
        decision: 'approve',
        checklist: allChecks,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('takedowns', () => {
    const request = {
      claimantName: 'Rights Holder Ltd',
      claimantEmail: 'legal@rights.example',
      basis: 'copyright',
      statement: 'This recording is our 1994 field tape, published without permission.',
      goodFaith: true,
    };
    let takedownId: string;

    it('accepts public requests and links them to the recording', async () => {
      const res = await call(
        null,
        'POST',
        '/v1/takedowns',
        { ...request, recordingUrl: `https://timecapsule.fm/recordings/${id}` },
        '10.9.9.9',
      );
      expect(res.statusCode).toBe(202);
      takedownId = res.json().id;
      // The claimant's personal data stays out of the audit log.
      const entry = h.audit.find((e) => e.action === 'takedown.received')!;
      expect(JSON.stringify(entry)).not.toContain('legal@rights.example');
    });

    it('is rate limited per IP', async () => {
      const codes = [];
      for (let i = 0; i < 6; i++) {
        codes.push((await call(null, 'POST', '/v1/takedowns', request, '10.8.8.8')).statusCode);
      }
      expect(codes.at(-1)).toBe(429);
    });

    it('is visible to moderators only', async () => {
      expect((await call('alice', 'GET', '/v1/moderation/takedowns')).statusCode).toBe(403);
      const list = (await call('mod', 'GET', '/v1/moderation/takedowns')).json();
      expect(list.find((t: { id: string }) => t.id === takedownId)).toMatchObject({ recordingId: id, status: 'received' });
    });

    it('unpublishes the recording and records the action', async () => {
      const res = await call('mod', 'POST', `/v1/moderation/takedowns/${takedownId}/resolve`, {
        action: 'unpublish',
        note: 'Claim verified against the original tape.',
      });
      expect(res.statusCode).toBe(204);
      expect((await call(null, 'GET', `/v1/recordings/${id}`)).statusCode).toBe(404);
      expect(h.audit.some((e) => e.action === 'takedown.actioned' && e.targetId === id)).toBe(true);
      const notes = (await call('alice', 'GET', '/v1/me/notifications')).json();
      expect(notes[0].kind).toBe('recording_unpublished');
      const again = await call('mod', 'POST', `/v1/moderation/takedowns/${takedownId}/resolve`, {
        action: 'decline',
        note: 'n/a',
      });
      expect(again.statusCode).toBe(409);
    });
  });
});

describe('account', () => {
  it('updates only safe profile fields', async () => {
    const res = await call('bob', 'PATCH', '/v1/me', { displayName: 'Bob R.', ageAttested: true, role: 'admin' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ displayName: 'Bob R.', ageAttested: true, role: 'contributor' });
  });

  it('serves the current contributor agreement publicly', async () => {
    const res = await call(null, 'GET', '/v1/agreements/current');
    expect(res.json()).toMatchObject({ version: agreement, isDraft: true });
  });
});
