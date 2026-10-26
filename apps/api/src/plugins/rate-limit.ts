import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { HttpError } from '../errors.js';

/** [max requests, window in seconds] */
export type Limit = readonly [number, number];

export interface RateLimitPolicy {
  /** Bucket name; routes sharing a name share counters. */
  bucket: string;
  ip: Limit;
  /** Applied in addition to the IP limit when the caller is signed in. */
  account?: Limit;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    rateLimit?: RateLimitPolicy;
  }
}

export interface RateLimitStore {
  /** Increments the counter and returns the new count and ms until reset. */
  hit(key: string, windowSec: number): Promise<{ count: number; resetMs: number }>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowSec: number) {
    const now = Date.now();
    let c = this.counters.get(key);
    if (!c || c.resetAt <= now) {
      c = { count: 0, resetAt: now + windowSec * 1000 };
      this.counters.set(key, c);
      if (this.counters.size > 50_000) this.sweep(now);
    }
    c.count += 1;
    return { count: c.count, resetMs: c.resetAt - now };
  }

  private sweep(now: number) {
    for (const [k, v] of this.counters) if (v.resetAt <= now) this.counters.delete(k);
  }
}

/** Fixed-window counters in Redis, shared across API replicas. */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, windowSec: number) {
    const res = await this.redis.multi().incr(key).pexpire(key, windowSec * 1000, 'NX').pttl(key).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttl = Number(res?.[2]?.[1] ?? windowSec * 1000);
    return { count, resetMs: ttl > 0 ? ttl : windowSec * 1000 };
  }
}

export const DEFAULT_POLICY: RateLimitPolicy = { bucket: 'default', ip: [300, 60], account: [600, 60] };

export default fp(
  async function rateLimit(app: FastifyInstance, opts: { store: RateLimitStore }) {
    app.addHook('preHandler', async (request, reply) => {
      const policy = request.routeOptions.config.rateLimit ?? DEFAULT_POLICY;
      const checks: [string, Limit][] = [[`rl:${policy.bucket}:ip:${request.ip}`, policy.ip]];
      if (request.user && policy.account) {
        checks.push([`rl:${policy.bucket}:acct:${request.user.id}`, policy.account]);
      }
      for (const [key, [max, windowSec]] of checks) {
        const { count, resetMs } = await opts.store.hit(key, windowSec);
        const remaining = Math.max(0, max - count);
        reply.header('ratelimit-limit', String(max));
        reply.header('ratelimit-remaining', String(remaining));
        reply.header('ratelimit-reset', String(Math.ceil(resetMs / 1000)));
        if (count > max) {
          request.log.warn({ event: 'rate_limited', bucket: policy.bucket }, 'rate limit exceeded');
          throw new HttpError(429, 'rate_limited', 'Too many requests', {
            'retry-after': String(Math.ceil(resetMs / 1000)),
          });
        }
      }
    });
  },
  { name: 'rate-limit', dependencies: ['auth'] },
);
