import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/** Headers for JSON API responses. The web app sets its own (nonce-based) CSP. */
export const API_SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy':
    'accelerometer=(), autoplay=(self), camera=(), display-capture=(), geolocation=(), gyroscope=(), ' +
    'magnetometer=(), microphone=(), midi=(), payment=(), usb=(), interest-cohort=()',
};

export default fp(
  async function securityHeaders(app: FastifyInstance, opts: { exemptPrefixes?: string[] }) {
    const exempt = opts.exemptPrefixes ?? [];
    app.addHook('onSend', async (request, reply, payload) => {
      for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) {
        // Swagger UI (dev only) needs its own CSP; everything else gets the strict one.
        if (k === 'content-security-policy' && exempt.some((p) => request.url.startsWith(p))) continue;
        reply.header(k, v);
      }
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
      return payload;
    });
  },
  { name: 'security-headers' },
);
