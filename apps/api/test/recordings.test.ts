import { insertRecording, insertUser } from '@timecapsule/db/testing';
import { RecordingDetail } from '@timecapsule/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { createHarness, sessionCookie, type Harness } from './helpers.js';

let h: Harness;
let app: App;
let owner: string;
let tokyo: string;
let paris: string;
let draft: string;
let fiji: string;

beforeAll(async () => {
  h = await createHarness();
  owner = await insertUser(h.t.admin, { displayName: 'Field Recordist' });
  tokyo = await insertRecording(h.t.admin, { contributorId: owner, cityEn: 'Tokyo', eraYear: 1982 });
  paris = await insertRecording(h.t.admin, {
    contributorId: owner,
    cityEn: 'Paris',
    lat: 48.85,
    lon: 2.35,
    eraYear: 1970,
    category: 'cafe',
    license: 'cc0',
  });
  fiji = await insertRecording(h.t.admin, { contributorId: owner, cityEn: 'Suva', lat: -18.1, lon: 178.4 });
  draft = await insertRecording(h.t.admin, { contributorId: owner, status: 'ready' });
  await h.t.admin.query(`UPDATE recordings SET city_local = '東京' WHERE id = $1`, [tokyo]);
  for (const id of [tokyo, paris, draft]) {
    const hex = id.replace(/-/g, '');
    await h.t.admin.query(
      `INSERT INTO audio_assets (recording_id, kind, storage_key, mime_type, byte_size, sha256)
       VALUES ($1, 'preview', $2, 'audio/mpeg', 100, repeat('a', 64)),
              ($1, 'peaks', $3, 'application/json', 10, repeat('b', 64))`,
      [id, `media/${hex}.mp3`, `media/${hex}.json`],
    );
  }
  app = await h.build();
  h.sessions.set('owner-session-token-123456', { id: owner, role: 'contributor' });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await h?.t.close();
});

const ids = (features: { id: string }[]) => features.map((f) => f.id).sort();

describe('GET /v1/recordings/pins', () => {
  it('returns published pins inside the box only', async () => {
    const res = await app.inject({ url: '/v1/recordings/pins?bbox=-10,30,150,60' });
    expect(res.statusCode).toBe(200);
    expect(ids(res.json().features)).toEqual([tokyo, paris].sort());
    expect(res.headers['cache-control']).toMatch(/public/);
  });

  it('never includes unpublished recordings, even for their owner', async () => {
    const res = await app.inject({
      url: '/v1/recordings/pins?bbox=-180,-90,180,90',
      headers: { cookie: sessionCookie('owner-session-token-123456') },
    });
    expect(ids(res.json().features)).not.toContain(draft);
  });

  it('handles boxes that cross the antimeridian', async () => {
    const res = await app.inject({ url: '/v1/recordings/pins?bbox=170,-30,-170,0' });
    expect(ids(res.json().features)).toEqual([fiji]);
  });

  it('filters by decade, category and license', async () => {
    const all = '/v1/recordings/pins?bbox=-180,-90,180,90';
    expect(ids((await app.inject({ url: `${all}&decade=1970` })).json().features)).toEqual([paris]);
    expect(ids((await app.inject({ url: `${all}&category=cafe` })).json().features)).toEqual([paris]);
    expect(ids((await app.inject({ url: `${all}&license=cc0` })).json().features)).toEqual([paris]);
  });

  it.each(['', 'bbox=1,2,3', 'bbox=0,0,1,1&decade=1985', 'bbox=0,0,1,1&category=x'])(
    'rejects invalid query %j',
    async (qs) => {
      const res = await app.inject({ url: `/v1/recordings/pins?${qs}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_request');
    },
  );
});

describe('GET /v1/recordings', () => {
  it('searches local and English place names', async () => {
    const res = await app.inject({ url: `/v1/recordings?q=${encodeURIComponent('東京')}` });
    expect(res.json().items.map((r: { id: string }) => r.id)).toEqual([tokyo]);
    const en = await app.inject({ url: '/v1/recordings?q=PARIS' });
    expect(en.json().items.map((r: { id: string }) => r.id)).toEqual([paris]);
  });

  it('treats LIKE wildcards literally', async () => {
    const res = await app.inject({ url: '/v1/recordings?q=%25' });
    expect(res.json().items).toEqual([]);
  });

  it('paginates with an opaque cursor', async () => {
    const first = (await app.inject({ url: '/v1/recordings?limit=2' })).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (await app.inject({ url: `/v1/recordings?limit=2&cursor=${first.nextCursor}` })).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((r: { id: string }) => r.id).sort();
    expect(seen).toEqual([tokyo, paris, fiji].sort());
  });

  it('rejects a forged cursor', async () => {
    const res = await app.inject({ url: `/v1/recordings?cursor=${Buffer.from("x|'; drop").toString('base64url')}` });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/recordings/:id', () => {
  it('returns full provenance and nothing internal', async () => {
    const res = await app.inject({ url: `/v1/recordings/${tokyo}` });
    expect(res.statusCode).toBe(200);
    const body = RecordingDetail.parse(res.json());
    expect(body.provenance.license).toBe('cc_by_4');
    expect(body.contributor.displayName).toBe('Field Recordist');
    for (const leak of ['storage_key', 'media/', 'contributor_id', owner, '@test.invalid']) {
      expect(res.body).not.toContain(leak);
    }
  });

  it('returns 404 (not 403) for unpublished recordings', async () => {
    const res = await app.inject({ url: `/v1/recordings/${draft}` });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for unknown IDs and 400 for malformed ones', async () => {
    expect((await app.inject({ url: '/v1/recordings/00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/v1/recordings/1' })).statusCode).toBe(400);
    expect((await app.inject({ url: "/v1/recordings/1' OR '1'='1" })).statusCode).toBe(400);
  });
});

describe('GET /v1/recordings/:id/playback', () => {
  it('issues short-lived signed URLs', async () => {
    const res = await app.inject({ url: `/v1/recordings/${tokyo}/playback` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.audioUrl).toMatch(/^https:\/\/storage\.test\/media\//);
    const ttl = (Date.parse(body.expiresAt) - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(900);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses to sign unpublished audio', async () => {
    const before = h.storage.signed.length;
    const res = await app.inject({ url: `/v1/recordings/${draft}/playback` });
    expect(res.statusCode).toBe(404);
    expect(h.storage.signed.length).toBe(before);
  });

  it('counts playback starts', async () => {
    await app.inject({ url: `/v1/recordings/${paris}/playback` });
    const metrics = await app.metrics.registry.getSingleMetricAsString('tc_playback_starts_total');
    expect(metrics).toMatch(/category="cafe"} 1/);
  });
});
