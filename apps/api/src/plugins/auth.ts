import type { UserRole } from '@timecapsule/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { forbidden, unauthorized } from '../errors.js';

export interface AuthUser {
  id: string;
  role: UserRole;
}

/** Resolves an Auth.js database-session token to an active user. */
export interface SessionStore {
  findUser(sessionToken: string): Promise<AuthUser | null>;
}

/**
 * Every route MUST declare who may call it. A route without `config.access`
 * fails at startup, so an endpoint can't silently ship without an auth rule.
 */
export type Access = 'public' | 'user' | 'moderator';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyContextConfig {
    access?: Access;
  }
}

const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]{16,512}$/;

export default fp(
  async function auth(app: FastifyInstance, opts: { sessions: SessionStore; cookieName: string }) {
    app.decorateRequest('user', null);

    app.addHook('onRoute', (route) => {
      const access = route.config?.access;
      if (!access && !route.url.startsWith('/docs')) {
        throw new Error(`Route ${route.method} ${route.url} has no config.access`);
      }
    });

    app.addHook('onRequest', async (request) => {
      const token = request.cookies[opts.cookieName];
      if (token && TOKEN_SHAPE.test(token)) {
        request.user = await opts.sessions.findUser(token);
      }
    });

    app.addHook('preHandler', async (request) => {
      enforce(request, request.routeOptions.config.access ?? 'moderator');
    });
  },
  { name: 'auth', dependencies: ['@fastify/cookie'] },
);

export function enforce(request: FastifyRequest, access: Access): void {
  if (access === 'public') return;
  if (!request.user) throw unauthorized();
  if (access === 'moderator' && request.user.role !== 'moderator' && request.user.role !== 'admin') {
    throw forbidden();
  }
}
