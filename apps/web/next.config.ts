import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Static security headers. The CSP is per-request (nonce) and set in src/proxy.ts.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), autoplay=(self), camera=(), display-capture=(), geolocation=(), gyroscope=(), ' +
      'magnetometer=(), microphone=(), midi=(), payment=(), usb=(), interest-cohort=()',
  },
];

const config: NextConfig = {
  output: 'standalone',
  // Trace workspace packages from the monorepo root into the standalone bundle.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  poweredByHeader: false,
  // Don't let `next dev` write agent instruction files into the repo.
  agentRules: false,
  reactStrictMode: true,
  transpilePackages: ['@timecapsule/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // In production a reverse proxy (infra/Caddyfile) serves /api/* from the
  // API on the same origin. This rewrite only exists for `next dev`.
  // `beforeFiles` so this proxy wins over the demo-mode route handler.
  async rewrites() {
    const target = process.env.API_DEV_PROXY_URL;
    return { beforeFiles: target ? [{ source: '/api/:path*', destination: `${target}/:path*` }] : [] };
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
