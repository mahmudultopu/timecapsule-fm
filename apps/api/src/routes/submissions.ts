import { withContext } from '@timecapsule/db';
import {
  ErrorBody,
  IdParams,
  Playback,
  SubmissionDetail,
  SubmissionFields,
  SubmissionSummary,
  SubmitInput,
  UploadCompleteInput,
  UploadIntent,
  UploadIntentInput,
} from '@timecapsule/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { HttpError, notFound } from '../errors.js';
import type { RateLimitPolicy } from '../plugins/rate-limit.js';
import { guard } from '../services/db-errors.js';
import * as submissions from '../services/submissions.js';

const WRITE_LIMIT: RateLimitPolicy = { bucket: 'submissions', ip: [120, 60], account: [60, 60] };
// Uploads are the expensive path (storage + transcoding), so they get a much tighter budget.
const UPLOAD_LIMIT: RateLimitPolicy = { bucket: 'uploads', ip: [30, 3600], account: [20, 3600] };

const errors = { 400: ErrorBody, 401: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 422: ErrorBody, 429: ErrorBody };
const tags = ['submissions'];

export const submissionRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  // Every handler here runs as the signed-in user, so RLS limits it to their own rows
  // (or, for moderators, to what moderators may see).
  const run = <T>(userId: string, fn: Parameters<typeof withContext<T>>[2]) =>
    guard(() => withContext(deps.db, { userId }, fn));

  app.get(
    '/v1/me/submissions',
    {
      config: { access: 'user' },
      schema: { tags, summary: 'My submissions, newest first', response: { 200: z.array(SubmissionSummary), ...errors } },
    },
    async (request) => run(request.user!.id, (tx) => submissions.listMine(tx, request.user!.id)),
  );

  app.post(
    '/v1/submissions',
    {
      config: { access: 'user', rateLimit: WRITE_LIMIT },
      schema: {
        tags,
        summary: 'Start a new draft submission',
        body: SubmissionFields.optional(),
        response: { 201: SubmissionDetail, ...errors },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const detail = await run(user.id, async (tx) => {
        const id = await submissions.createDraft(tx, user.id);
        if (request.body) await submissions.updateFields(tx, id, request.body);
        return submissions.getSubmission(tx, id);
      });
      return reply.code(201).send(detail!);
    },
  );

  app.get(
    '/v1/submissions/:id',
    {
      config: { access: 'user' },
      schema: { tags, summary: 'A submission (owner or moderator)', params: IdParams, response: { 200: SubmissionDetail, ...errors } },
    },
    async (request) => {
      const detail = await run(request.user!.id, (tx) => submissions.getSubmission(tx, request.params.id));
      if (!detail) throw notFound();
      return detail;
    },
  );

  app.patch(
    '/v1/submissions/:id',
    {
      config: { access: 'user', rateLimit: WRITE_LIMIT },
      schema: {
        tags,
        summary: 'Update draft metadata',
        description: 'Only allowed while the submission is a draft, ready, failed processing, or rejected.',
        params: IdParams,
        body: SubmissionFields,
        response: { 200: SubmissionDetail, ...errors },
      },
    },
    async (request) => {
      const detail = await run(request.user!.id, async (tx) => {
        await submissions.updateFields(tx, request.params.id, request.body);
        return submissions.getSubmission(tx, request.params.id);
      });
      if (!detail) throw notFound();
      return detail;
    },
  );

  app.delete(
    '/v1/submissions/:id',
    {
      config: { access: 'user', rateLimit: WRITE_LIMIT },
      schema: { tags, summary: 'Delete an unpublished submission', params: IdParams, response: { 204: z.null(), ...errors } },
    },
    async (request, reply) => {
      await run(request.user!.id, (tx) => submissions.deleteDraft(tx, request.params.id));
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/v1/submissions/:id/upload-intent',
    {
      config: { access: 'user', rateLimit: UPLOAD_LIMIT },
      schema: {
        tags,
        summary: 'Get a signed URL to upload audio',
        description:
          'Returns a 15-minute signed PUT into the private quarantine bucket. The declared size and type are part of the signature. WAV, FLAC, MP3 or OGG; at most 200 MB and 30 minutes.',
        params: IdParams,
        body: UploadIntentInput,
        response: { 200: UploadIntent, ...errors },
      },
    },
    async (request) => {
      const user = request.user!;
      const intent = await run(user.id, (tx) =>
        submissions.createUploadIntent(tx, deps.storage, {
          recordingId: request.params.id,
          userId: user.id,
          bytes: request.body.bytes,
          format: request.body.format,
        }),
      );
      deps.metrics.uploads.labels('intent').inc();
      return intent;
    },
  );

  app.post(
    '/v1/submissions/:id/upload-complete',
    {
      config: { access: 'user', rateLimit: UPLOAD_LIMIT },
      schema: {
        tags,
        summary: 'Confirm the upload finished and queue it for processing',
        params: IdParams,
        body: UploadCompleteInput,
        response: { 202: SubmissionDetail, ...errors },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const result = await run(user.id, (tx) =>
        submissions.completeUpload(tx, deps.storage, {
          recordingId: request.params.id,
          userId: user.id,
          uploadId: request.body.uploadId,
        }),
      );
      if (!result.ok) {
        deps.metrics.uploads.labels('rejected').inc();
        await deps.audit.record({
          action: 'upload.rejected',
          actorId: user.id,
          targetType: 'recording',
          targetId: request.params.id,
          details: { reason: result.code },
          ip: request.ip,
        });
        throw new HttpError(400, result.code, 'The upload could not be verified. Please try again.');
      }
      deps.metrics.uploads.labels('completed').inc();
      const detail = await run(user.id, (tx) => submissions.getSubmission(tx, request.params.id));
      return reply.code(202).send(detail!);
    },
  );

  app.post(
    '/v1/submissions/:id/submit',
    {
      config: { access: 'user', rateLimit: WRITE_LIMIT },
      schema: {
        tags,
        summary: 'Accept the contributor agreement and submit for moderation',
        description: 'The agreement version and acceptance time are stored with the submission.',
        params: IdParams,
        body: SubmitInput,
        response: { 200: SubmissionDetail, ...errors },
      },
    },
    async (request) => {
      const user = request.user!;
      const detail = await run(user.id, async (tx) => {
        await submissions.submit(tx, request.params.id, request.body.agreementVersion);
        return submissions.getSubmission(tx, request.params.id);
      });
      request.log.info({ event: 'submission_submitted', recordingId: request.params.id }, 'submitted');
      return detail!;
    },
  );

  app.post(
    '/v1/submissions/:id/withdraw',
    {
      config: { access: 'user', rateLimit: WRITE_LIMIT },
      schema: { tags, summary: 'Withdraw a pending submission to edit it', params: IdParams, response: { 200: SubmissionDetail, ...errors } },
    },
    async (request) => {
      const detail = await run(request.user!.id, async (tx) => {
        await submissions.withdraw(tx, request.params.id);
        return submissions.getSubmission(tx, request.params.id);
      });
      return detail!;
    },
  );

  app.get(
    '/v1/submissions/:id/playback',
    {
      config: { access: 'user', rateLimit: { bucket: 'playback', ip: [60, 60], account: [120, 60] } },
      schema: {
        tags,
        summary: 'Preview the processed audio (owner or moderator)',
        params: IdParams,
        response: { 200: Playback, ...errors },
      },
    },
    async (request) => {
      const assets = await run(request.user!.id, (tx) => submissions.getPreviewAssets(tx, request.params.id));
      if (!assets) throw notFound();
      const ttlSeconds = deps.playbackTtlSeconds;
      const [audio, peaks] = await Promise.all([
        deps.storage.signGet(assets.audio.storage_key, { ttlSeconds, contentType: assets.audio.mime_type }),
        deps.storage.signGet(assets.peaks.storage_key, { ttlSeconds, contentType: assets.peaks.mime_type }),
      ]);
      return {
        audioUrl: audio.url,
        audioMimeType: assets.audio.mime_type,
        peaksUrl: peaks.url,
        expiresAt: audio.expiresAt.toISOString(),
      };
    },
  );
};
