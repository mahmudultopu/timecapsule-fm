import { withContext } from '@timecapsule/db';
import {
  ErrorBody,
  IdParams,
  ModerationDecisionInput,
  QueueItem,
  SubmissionDetail,
  TakedownInput,
  TakedownItem,
  TakedownResolveInput,
  UnpublishInput,
} from '@timecapsule/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { HttpError, notFound } from '../errors.js';
import { guard } from '../services/db-errors.js';
import * as moderation from '../services/moderation.js';
import { getSubmission } from '../services/submissions.js';

const errors = { 400: ErrorBody, 401: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 422: ErrorBody, 429: ErrorBody };

export const moderationRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const tags = ['moderation'];
  const asModerator = <T>(userId: string, fn: Parameters<typeof withContext<T>>[2]) =>
    guard(() => withContext(deps.db, { userId }, fn));

  app.get(
    '/v1/moderation/queue',
    {
      config: { access: 'moderator' },
      schema: { tags, summary: 'Submissions awaiting review, oldest first', response: { 200: z.array(QueueItem), ...errors } },
    },
    async (request) => asModerator(request.user!.id, (tx) => moderation.queue(tx)),
  );

  app.get(
    '/v1/moderation/submissions/:id',
    {
      config: { access: 'moderator' },
      schema: { tags, summary: 'Full submission for review', params: IdParams, response: { 200: SubmissionDetail, ...errors } },
    },
    async (request) => {
      const detail = await asModerator(request.user!.id, (tx) => getSubmission(tx, request.params.id));
      if (!detail) throw notFound();
      return detail;
    },
  );

  app.post(
    '/v1/moderation/submissions/:id/decision',
    {
      config: { access: 'moderator', rateLimit: { bucket: 'moderation', ip: [120, 60], account: [120, 60] } },
      schema: {
        tags,
        summary: 'Approve (publish) or reject a submission',
        description:
          'Approval requires every checklist item: audio quality, rights confirmed, location accuracy, and no identifiable private individuals speaking without consent. Rejection requires a reason, which is sent to the contributor.',
        params: IdParams,
        body: ModerationDecisionInput,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const moderatorId = request.user!.id;
      const decision = request.body;
      const result = await asModerator(moderatorId, (tx) =>
        moderation.decide(tx, { recordingId: request.params.id, moderatorId, decision }),
      );
      deps.metrics.moderationDecisions.labels(decision.decision).inc();
      deps.metrics.moderationWait.labels(decision.decision).observe(result.waitedSeconds);
      await deps.audit.record({
        action: `moderation.${decision.decision}`,
        actorId: moderatorId,
        targetType: 'recording',
        targetId: request.params.id,
        details: { checklistComplete: Object.values(decision.checklist).every(Boolean) },
        ip: request.ip,
      });
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/v1/moderation/recordings/:id/unpublish',
    {
      config: { access: 'moderator', rateLimit: { bucket: 'moderation', ip: [120, 60], account: [120, 60] } },
      schema: {
        tags,
        summary: 'Take a published recording offline',
        params: IdParams,
        body: UnpublishInput,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const ok = await asModerator(request.user!.id, (tx) =>
        moderation.unpublish(tx, request.params.id, request.body.reason),
      );
      if (!ok) throw new HttpError(409, 'not_published', 'Only published recordings can be unpublished');
      await deps.audit.record({
        action: 'recording.unpublished',
        actorId: request.user!.id,
        targetType: 'recording',
        targetId: request.params.id,
        ip: request.ip,
      });
      return reply.code(204).send(null);
    },
  );

  // ---------- takedowns ----------

  app.post(
    '/v1/takedowns',
    {
      // Anyone may file a request, signed in or not, so it is tightly limited per IP.
      config: { access: 'public', rateLimit: { bucket: 'takedowns', ip: [5, 3600], account: [10, 3600] } },
      schema: {
        tags: ['takedowns'],
        summary: 'Request removal of a recording (copyright, privacy or other)',
        body: TakedownInput,
        response: { 202: z.object({ id: z.uuid() }), ...errors },
      },
    },
    async (request, reply) => {
      const created = await guard(() =>
        withContext(deps.db, { userId: request.user?.id ?? null }, (tx) => moderation.createTakedown(tx, request.body)),
      );
      deps.metrics.takedowns.labels('received').inc();
      // The claimant's name and email stay in the takedown row, never in logs.
      await deps.audit.record({
        action: 'takedown.received',
        actorId: request.user?.id ?? null,
        targetType: created.recordingId ? 'recording' : undefined,
        targetId: created.recordingId ?? undefined,
        details: { basis: request.body.basis, linked: created.recordingId !== null },
        ip: request.ip,
      });
      return reply.code(202).send({ id: created.id });
    },
  );

  app.get(
    '/v1/moderation/takedowns',
    {
      config: { access: 'moderator' },
      schema: { tags, summary: 'Takedown requests, open first', response: { 200: z.array(TakedownItem), ...errors } },
    },
    async (request) => asModerator(request.user!.id, (tx) => moderation.listTakedowns(tx)),
  );

  app.post(
    '/v1/moderation/takedowns/:id/resolve',
    {
      config: { access: 'moderator', rateLimit: { bucket: 'moderation', ip: [120, 60], account: [120, 60] } },
      schema: {
        tags,
        summary: 'Unpublish the recording, or decline the request',
        description: 'The action, moderator, time and note are recorded on the request and in the audit log.',
        params: z.object({ id: z.uuid() }),
        body: TakedownResolveInput,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const moderatorId = request.user!.id;
      const result = await asModerator(moderatorId, (tx) =>
        moderation.resolveTakedown(tx, { id: request.params.id, moderatorId, ...request.body }),
      );
      deps.metrics.takedowns.labels(request.body.action === 'unpublish' ? 'actioned' : 'declined').inc();
      await deps.audit.record({
        action: `takedown.${request.body.action === 'unpublish' ? 'actioned' : 'declined'}`,
        actorId: moderatorId,
        targetType: 'recording',
        targetId: result.recordingId ?? undefined,
        details: { unpublished: result.unpublished },
        ip: request.ip,
      });
      return reply.code(204).send(null);
    },
  );
};
