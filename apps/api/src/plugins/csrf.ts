import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { HttpError } from '../errors.js';

export const CSRF_COOKIE = '__Host-tc.csrf';
// Browsers only accept __Host- cookies when they are Secure, so plain-HTTP
// local development falls back to an unprefixed name.
export const CSRF_COOKIE_INSECURE = 'tc.csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for every state-changing request, layered on SameSite=Lax
 * session cookies:
 *  1. Origin must equal the app origin (Sec-Fetch-Site=same-origin is
 *     accepted when a browser omits Origin).
 *  2. Double-submit token: the X-CSRF-Token header must match the
 *     __Host- cookie issued by GET /v1/csrf.
 */
export default fp(
  async function csrf(app: FastifyInstance, opts: { appOrigin: string; secureCookies: boolean }) {
    const appOrigin = new URL(opts.appOrigin).origin;
    const cookieName = opts.secureCookies ? CSRF_COOKIE : CSRF_COOKIE_INSECURE;

    app.get(
      '/v1/csrf',
      {
        config: { access: 'public' },
        schema: {
          tags: ['security'],
          summary: 'Issue a CSRF token',
          description:
            'Sets an HttpOnly `__Host-tc.csrf` cookie and returns the same token. Send it as `X-CSRF-Token` on every POST/PATCH/DELETE.',
          response: { 200: z.object({ token: z.string() }) },
        },
      },
      async (_request, reply) => {
        const token = randomBytes(32).toString('base64url');
        reply.setCookie(cookieName, token, {
          path: '/',
          httpOnly: true,
          secure: opts.secureCookies,
          sameSite: 'strict',
        });
        return { token };
      },
    );

    app.addHook('onRequest', async (request) => {
      if (SAFE_METHODS.has(request.method)) return;

      const origin = request.headers.origin;
      const fetchSite = request.headers['sec-fetch-site'];
      const originOk = origin ? origin === appOrigin : fetchSite === 'same-origin';
      if (!originOk) throw new HttpError(403, 'csrf_origin', 'Cross-origin request rejected');

      const header = request.headers[CSRF_HEADER];
      const cookie = request.cookies[cookieName];
      if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie)) {
        throw new HttpError(403, 'csrf_token', 'Missing or invalid CSRF token');
      }
    });
  },
  { name: 'csrf', dependencies: ['@fastify/cookie'] },
);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
