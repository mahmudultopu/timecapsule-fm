import { createTestDatabase, type TestDatabase } from '@timecapsule/db/testing';
import { buildApp, type AppDeps } from '../src/app.js';
import type { AuthUser } from '../src/plugins/auth.js';
import { createMetrics } from '../src/plugins/metrics.js';
import { MemoryRateLimitStore } from '../src/plugins/rate-limit.js';
import type { AuditEvent } from '../src/services/audit.js';
import type { Storage } from '../src/services/storage.js';

export const APP_ORIGIN = 'https://timecapsule.test';
export const SESSION_COOKIE = 'tc-test-session';

/** In-memory stand-in for object storage. `quarantine` simulates finished browser PUTs. */
export class FakeStorage implements Storage {
  signed: string[] = [];
  uploads: { key: string; contentLength: number; contentType: string }[] = [];
  quarantine = new Map<string, number>();

  async signGet(key: string, { ttlSeconds }: { ttlSeconds: number; contentType: string }) {
    this.signed.push(key);
    return {
      url: `https://storage.test/${key}?X-Amz-Signature=secret-signature`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async signUpload(key: string, o: { ttlSeconds: number; contentType: string; contentLength: number }) {
    this.uploads.push({ key, contentLength: o.contentLength, contentType: o.contentType });
    return {
      url: `https://storage.test/${key}?X-Amz-Signature=put`,
      expiresAt: new Date(Date.now() + o.ttlSeconds * 1000),
    };
  }

  async quarantineSize(key: string) {
    return this.quarantine.get(key) ?? null;
  }
}

export interface Harness {
  t: TestDatabase;
  sessions: Map<string, AuthUser>;
  storage: FakeStorage;
  audit: AuditEvent[];
  logs: string[];
  build(overrides?: Partial<AppDeps>): ReturnType<typeof buildApp>;
}

export async function createHarness(): Promise<Harness> {
  const t = await createTestDatabase();
  const sessions = new Map<string, AuthUser>();
  const storage = new FakeStorage();
  const audit: AuditEvent[] = [];
  const logs: string[] = [];
  return {
    t,
    sessions,
    storage,
    audit,
    logs,
    build: (overrides = {}) =>
      buildApp({
        db: t.kysely('tc_api'),
        sessions: { findUser: async (token) => sessions.get(token) ?? null },
        storage,
        rateLimitStore: new MemoryRateLimitStore(),
        metrics: createMetrics(),
        audit: { record: async (e) => void audit.push(e) },
        appOrigin: APP_ORIGIN,
        sessionCookieName: SESSION_COOKIE,
        secureCookies: true,
        playbackTtlSeconds: 600,
        exposeApiDocs: false,
        trustProxyHops: 1,
        // Surface 500s in test output instead of only a generic error body.
        onUnexpectedError: (err) => console.error(err),
        ...overrides,
      }),
  };
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}`;
}
