import type { FastifyServerOptions } from 'fastify';

/**
 * Structured JSON logs. What is deliberately NOT logged:
 *  - cookies, auth headers, CSRF tokens
 *  - query strings (search terms, signed-URL parameters)
 *  - client IPs (the audit log stores a keyed HMAC instead)
 *  - request/response bodies (may contain signed URLs or personal data)
 */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.audioUrl',
  '*.peaksUrl',
  '*.url',
  '*.signedUrl',
  '*.email',
  '*.claimant_email',
];

export function loggerOptions(level: string, pretty: boolean): FastifyServerOptions['logger'] {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(req: { id: string; method: string; url: string; routeOptions?: { url?: string } }) {
        return {
          id: req.id,
          method: req.method,
          path: stripQuery(req.url),
          route: req.routeOptions?.url,
        };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
    },
    ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

export function stripQuery(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}
