import { withContext } from '@timecapsule/db';
import { Agreement, ErrorBody, Notification, Profile, ProfileUpdate } from '@timecapsule/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { notFound } from '../errors.js';
import { guard } from '../services/db-errors.js';

const tags = ['account'];
const errors = { 400: ErrorBody, 401: ErrorBody, 404: ErrorBody, 429: ErrorBody };
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export const accountRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const loadProfile = async (userId: string) => {
    const row = await withContext(deps.db, { userId }, (tx) =>
      tx
        .selectFrom('users')
        .where('id', '=', userId)
        .select(['id', 'display_name', 'role', 'age_attested_at', 'email_notifications'])
        .executeTakeFirst(),
    );
    if (!row) throw notFound();
    return {
      id: row.id,
      displayName: row.display_name,
      role: row.role,
      ageAttested: row.age_attested_at !== null,
      emailNotifications: row.email_notifications,
    };
  };

  app.get(
    '/v1/me',
    { config: { access: 'user' }, schema: { tags, summary: 'My profile', response: { 200: Profile, ...errors } } },
    async (request) => loadProfile(request.user!.id),
  );

  app.patch(
    '/v1/me',
    {
      config: { access: 'user', rateLimit: { bucket: 'profile', ip: [30, 60], account: [20, 60] } },
      schema: {
        tags,
        summary: 'Update my public name, age confirmation and email preferences',
        body: ProfileUpdate,
        response: { 200: Profile, ...errors },
      },
    },
    async (request) => {
      const userId = request.user!.id;
      const b = request.body;
      const set: { display_name?: string; age_attested_at?: Date; email_notifications?: boolean } = {};
      if (b.displayName !== undefined) set.display_name = b.displayName;
      if (b.ageAttested) set.age_attested_at = new Date();
      if (b.emailNotifications !== undefined) set.email_notifications = b.emailNotifications;
      if (Object.keys(set).length > 0) {
        await guard(() =>
          withContext(deps.db, { userId }, (tx) => tx.updateTable('users').set(set).where('id', '=', userId).execute()),
        );
      }
      return loadProfile(userId);
    },
  );

  app.get(
    '/v1/me/notifications',
    {
      config: { access: 'user' },
      schema: { tags, summary: 'My notifications, newest first', response: { 200: z.array(Notification), ...errors } },
    },
    async (request) => {
      const rows = await withContext(deps.db, { userId: request.user!.id }, (tx) =>
        tx
          .selectFrom('notifications')
          .select(['id', 'kind', 'message', 'recording_id', 'created_at', 'read_at'])
          .orderBy('created_at', 'desc')
          .limit(50)
          .execute(),
      );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        message: r.message,
        recordingId: r.recording_id,
        createdAt: iso(r.created_at)!,
        readAt: iso(r.read_at),
      }));
    },
  );

  app.post(
    '/v1/me/notifications/read',
    {
      config: { access: 'user' },
      schema: { tags, summary: 'Mark all my notifications as read', response: { 204: z.null(), ...errors } },
    },
    async (request, reply) => {
      await withContext(deps.db, { userId: request.user!.id }, (tx) =>
        tx.updateTable('notifications').set({ read_at: new Date() }).where('read_at', 'is', null).execute(),
      );
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/v1/agreements/current',
    {
      config: { access: 'public' },
      schema: {
        tags,
        summary: 'The contributor agreement in force',
        response: { 200: Agreement, ...errors },
      },
    },
    async (_request, reply) => {
      const row = await withContext(deps.db, { userId: null }, (tx) =>
        tx
          .selectFrom('contributor_agreements')
          .where('superseded_at', 'is', null)
          .select(['version', 'body_md', 'is_draft'])
          .executeTakeFirst(),
      );
      if (!row) throw notFound();
      reply.header('cache-control', 'public, max-age=300');
      return { version: row.version, bodyMd: row.body_md, isDraft: row.is_draft };
    },
  );
};
