import 'server-only';
import { Redis } from 'ioredis';

// Fixed-window limiter for the sign-in endpoints that live in the web app.
// Uses the same Valkey/Redis as the API when REDIS_URL is set, so limits
// hold across replicas; falls back to process memory in development.

const memory = new Map<string, { count: number; resetAt: number }>();
let redis: Redis | null | undefined;

function client(): Redis | null {
  if (redis === undefined) {
    redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
  }
  return redis;
}

/** Returns true when the caller is still within `max` hits per `windowSec`. */
export async function allow(key: string, max: number, windowSec: number): Promise<boolean> {
  const r = client();
  if (r) {
    const res = await r.multi().incr(key).expire(key, windowSec, 'NX').exec();
    return Number(res?.[0]?.[1] ?? 0) <= max;
  }
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

/** Client IP as reported by the trusted reverse proxy (first hop). */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}
