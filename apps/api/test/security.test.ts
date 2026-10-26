import { Writable } from 'node:stream';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { loggerOptions } from '../src/logger.js';
import authPlugin from '../src/plugins/auth.js';
import { CSRF_COOKIE } from '../src/plugins/csrf.js';
import { MemoryRateLimitStore } from '../src/plugins/rate-limit.js';
import { API_SECURITY_HEADERS } from '../src/plugins/security-headers.js';
import { APP_ORIGIN, createHarness, sessionCookie, type Harness } from './helpers.js';

let h: Harness;
let app: App;

beforeAll(async () => {
  h = await createHarness();
  h.sessions.set('contributor-token-0001', { id: '11111111-1111-4111-8111-111111111111', role: 'contributor' });
  h.sessions.set('moderator-token-00001', { id: '22222222-2222-4222-8222-222222222222', role: 'moderator' });
  app = await h.build();
  app.post('/v1/test/user', { config: { access: 'user' } }, async () => ({ ok: true }));
  app.post('/v1/test/moderator', { config: { access: 'moderator' } }, async () => ({ ok: true }));
  app.post(
    '/v1/test/limited',
    { config: { access: 'user', rateLimit: { bucket: 'test', ip: [100, 60], account: [2, 60] } } },
    async () => ({ ok: true }),
  );
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await h?.t.close();
});

async function csrf(): Promise<{ token: string; cookie: string }> {
  const res = await app.inject({ url: '/v1/csrf' });
  const set = res.cookies.find((c) => c.name === CSRF_COOKIE)!;
  expect(set.httpOnly).toBe(true);
  expect(set.secure).toBe(true);
  expect(set.sameSite).toBe('Strict');
  return { token: res.json().token, cookie: `${CSRF_COOKIE}=${set.value}` };
}

async function post(url: string, session?: string) {
  const c = await csrf();
  return app.inject({
    method: 'POST',
    url,
    headers: {
      origin: APP_ORIGIN,
      'x-csrf-token': c.token,
      cookie: [c.cookie, session ? sessionCookie(session) : ''].filter(Boolean).join('; '),
    },
  });
}

describe('security headers', () => {
  it('are set on every response, including errors', async () => {
    for (const url of ['/healthz', '/v1/recordings/1', '/nope']) {
      const res = await app.inject({ url });
      for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) expect(res.headers[k]).toBe(v);
    }
  });

  it('include frame-ancestors none, nosniff and HSTS', () => {
    expect(API_SECURITY_HEADERS['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(API_SECURITY_HEADERS['x-content-type-options']).toBe('nosniff');
    expect(API_SECURITY_HEADERS['strict-transport-security']).toMatch(/max-age=\d{8}/);
  });

  it('default to no-store caching', async () => {
    expect((await app.inject({ url: '/healthz' })).headers['cache-control']).toBe('no-store');
  });

  it('do not leak internals on 500s', async () => {
    const broken = await h.build({ db: undefined as never });
    const res = await broken.inject({ url: '/v1/recordings/00000000-0000-4000-8000-000000000000' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal', message: 'Something went wrong' } });
    await broken.close();
  });
});

describe('authorization', () => {
  it('rejects routes that do not declare access', async () => {
    const bare = Fastify();
    await bare.register(cookie);
    await bare.register(authPlugin, { sessions: { findUser: async () => null }, cookieName: 's' });
    expect(() => bare.get('/x', async () => 'ok')).toThrow(/no config.access/);
  });

  it('requires a session for user routes', async () => {
    expect((await post('/v1/test/user')).statusCode).toBe(401);
    expect((await post('/v1/test/user', 'contributor-token-0001')).statusCode).toBe(200);
  });

  it('ignores unknown or malformed session tokens', async () => {
    expect((await post('/v1/test/user', 'unknown-token-000000')).statusCode).toBe(401);
    expect((await post('/v1/test/user', "x'; --")).statusCode).toBe(401);
  });

  it('requires the moderator role for moderator routes', async () => {
    expect((await post('/v1/test/moderator', 'contributor-token-0001')).statusCode).toBe(403);
    expect((await post('/v1/test/moderator', 'moderator-token-00001')).statusCode).toBe(200);
  });
});

describe('CSRF', () => {
  const base = { method: 'POST' as const, url: '/v1/test/user' };

  it('rejects cross-origin requests', async () => {
    const c = await csrf();
    const res = await app.inject({
      ...base,
      headers: { origin: 'https://evil.test', 'x-csrf-token': c.token, cookie: c.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf_origin');
  });

  it('rejects requests with neither Origin nor same-origin fetch metadata', async () => {
    const c = await csrf();
    const res = await app.inject({ ...base, headers: { 'x-csrf-token': c.token, cookie: c.cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a missing or mismatched token', async () => {
    const c = await csrf();
    const missing = await app.inject({ ...base, headers: { origin: APP_ORIGIN, cookie: c.cookie } });
    expect(missing.json().error.code).toBe('csrf_token');
    const wrong = await app.inject({
      ...base,
      headers: { origin: APP_ORIGIN, 'x-csrf-token': 'A'.repeat(43), cookie: c.cookie },
    });
    expect(wrong.json().error.code).toBe('csrf_token');
  });
});

describe('rate limiting', () => {
  it('limits per IP with Retry-After', async () => {
    const limited = await h.build({ rateLimitStore: new MemoryRateLimitStore() });
    let last;
    for (let i = 0; i < 121; i++) {
      last = await limited.inject({ url: '/v1/recordings?limit=1', remoteAddress: '203.0.113.9' });
    }
    expect(last!.statusCode).toBe(429);
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    // A different client is unaffected.
    const other = await limited.inject({ url: '/v1/recordings?limit=1', remoteAddress: '203.0.113.10' });
    expect(other.statusCode).toBe(200);
    await limited.close();
  });

  it('limits per account even across IPs', async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      const c = await csrf();
      results.push(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/test/limited',
            remoteAddress: `198.51.100.${i}`,
            headers: {
              origin: APP_ORIGIN,
              'x-csrf-token': c.token,
              cookie: `${c.cookie}; ${sessionCookie('contributor-token-0001')}`,
            },
          })
        ).statusCode,
      );
    }
    expect(results).toEqual([200, 200, 429]);
  });
});

describe('logging', () => {
  it('omits query strings, cookies, IPs and signed URLs', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const opts = loggerOptions('info', false) as object;
    const logged = await h.build({ logger: { ...opts, stream } as never });
    await logged.inject({
      url: '/v1/recordings?q=secret-search-term',
      headers: { cookie: sessionCookie('contributor-token-0001') },
      remoteAddress: '192.0.2.77',
    });
    await logged.close();
    const out = lines.join('\n');
    expect(out).toContain('/v1/recordings');
    for (const leak of ['secret-search-term', 'contributor-token-0001', '192.0.2.77', 'X-Amz-Signature']) {
      expect(out).not.toContain(leak);
    }
  });
});

describe('configuration', () => {
  it('reports invalid variable names without echoing values', () => {
    expect(() =>
      loadConfig({ APP_ORIGIN: 'not a url', AUDIT_IP_HMAC_KEY: 'super-secret-but-too-short' }),
    ).toThrow(/APP_ORIGIN/);
    try {
      loadConfig({ AUDIT_IP_HMAC_KEY: 'super-secret-but-too-short' });
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret');
    }
  });

  it('rejects playback URL lifetimes outside 5–15 minutes', () => {
    const env = {
      APP_ORIGIN: 'https://x.test',
      DATABASE_URL: 'postgres://x',
      S3_ENDPOINT: 'https://s3.test',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
      S3_BUCKET_MEDIA: 'm',
      S3_BUCKET_QUARANTINE: 'q',
      AUDIT_IP_HMAC_KEY: 'k'.repeat(32),
    };
    expect(loadConfig(env).PLAYBACK_URL_TTL_SECONDS).toBe(600);
    expect(() => loadConfig({ ...env, PLAYBACK_URL_TTL_SECONDS: '3600' })).toThrow(/PLAYBACK_URL_TTL_SECONDS/);
    expect(() => loadConfig({ ...env, PLAYBACK_URL_TTL_SECONDS: '60' })).toThrow();
  });
});

describe('CSRF cookie in plain-HTTP development', () => {
  it('drops the __Host- prefix when cookies cannot be Secure', async () => {
    const dev = await h.build({ secureCookies: false });
    const res = await dev.inject({ url: '/v1/csrf' });
    const set = res.cookies[0]!;
    expect(set.name).toBe('tc.csrf');
    expect(set.secure).toBeFalsy();
    const ok = await dev.inject({
      method: 'POST',
      url: '/v1/takedowns',
      headers: { origin: APP_ORIGIN, 'x-csrf-token': res.json().token, cookie: `tc.csrf=${set.value}` },
      payload: {},
    });
    // Passes CSRF and reaches validation.
    expect(ok.statusCode).toBe(400);
    await dev.close();
  });
});
