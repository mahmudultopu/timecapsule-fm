// Writes the OpenAPI document generated from the route schemas.
//   pnpm openapi:export   ->  docs/openapi.json
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { createMetrics } from './plugins/metrics.js';
import { MemoryRateLimitStore } from './plugins/rate-limit.js';

const unused = new Proxy({}, { get: () => () => Promise.reject(new Error('not available during export')) });

const app = await buildApp({
  db: unused as never,
  sessions: { findUser: async () => null },
  storage: unused as never,
  rateLimitStore: new MemoryRateLimitStore(),
  metrics: createMetrics(),
  audit: { record: async () => {} },
  appOrigin: 'https://timecapsule.fm',
  sessionCookieName: '__Secure-authjs.session-token',
  secureCookies: true,
  playbackTtlSeconds: 600,
  exposeApiDocs: false,
  trustProxyHops: 1,
});
await app.ready();
const out = resolve(process.argv[2] ?? 'openapi.json');
await writeFile(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`wrote ${out}`);
