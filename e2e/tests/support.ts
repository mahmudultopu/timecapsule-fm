import { randomBytes } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import pg from 'pg';

// Signed-in flows need a session. Rather than driving a real inbox, tests
// create a user and an Auth.js database session directly (the same rows a
// magic-link sign-in produces) and hand the browser the session cookie.

export const DATABASE_URL = process.env.E2E_DATABASE_URL;
const COOKIE = process.env.E2E_SESSION_COOKIE ?? 'authjs.session-token';

export async function signInAs(
  context: BrowserContext,
  baseURL: string,
  opts: { role?: 'contributor' | 'moderator'; name: string },
): Promise<string> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name, role, age_attested_at, "emailVerified")
       VALUES ($1, $2, $3, now(), now()) RETURNING id`,
      [`e2e-${randomBytes(6).toString('hex')}@test.invalid`, opts.name, opts.role ?? 'contributor'],
    );
    const token = randomBytes(32).toString('hex');
    await client.query(
      `INSERT INTO sessions ("userId", expires, "sessionToken") VALUES ($1, now() + interval '1 day', $2)`,
      [rows[0]!.id, token],
    );
    await context.addCookies([{ name: COOKIE, value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}

/** A short 8 kHz mono WAV: a quiet two-tone hum, obviously synthetic. */
export function testWav(seconds = 3): Buffer {
  const rate = 8000;
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = 0.2 * Math.sin((2 * Math.PI * 220 * i) / rate) + 0.1 * Math.sin((2 * Math.PI * 330 * i) / rate);
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
