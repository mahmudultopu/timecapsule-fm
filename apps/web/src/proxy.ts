import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, mapOriginsFromEnv, originsFromEnv } from './lib/csp';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // Behind the TLS-terminating proxy, X-Forwarded-Proto tells us the real scheme.
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? request.nextUrl.protocol.replace(':', '');
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    upgradeInsecure: proto === 'https',
    mediaOrigins: originsFromEnv(process.env.MEDIA_ORIGINS),
    mapOrigins: mapOriginsFromEnv(process.env),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
