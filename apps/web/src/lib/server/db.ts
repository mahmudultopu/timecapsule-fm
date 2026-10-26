import 'server-only';
import pg from 'pg';

// Auth.js is the only thing in the web app that talks to Postgres directly.
// It connects as tc_auth_login: full access to the auth tables, insert-only
// on the audit log, and nothing else (recordings go through the API).
const globalForPool = globalThis as unknown as { authPool?: pg.Pool };

export function authPool(): pg.Pool {
  // pg.Pool connects lazily, so constructing it at import time (e.g. during
  // `next build`) is harmless; a missing URL surfaces on the first query.
  globalForPool.authPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_AUTH_URL,
    max: 5,
    application_name: 'timecapsule-web-auth',
  });
  return globalForPool.authPool;
}
