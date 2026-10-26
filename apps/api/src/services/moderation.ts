import { randomUUID } from 'node:crypto';
import type { Tx } from '@timecapsule/db';
import type { ModerationDecisionInput, QueueItem, TakedownItem, TakedownInput } from '@timecapsule/shared';
import { HttpError, notFound } from '../errors.js';

const iso = (d: Date | string) => new Date(d).toISOString();

export async function queue(tx: Tx): Promise<QueueItem[]> {
  const rows = await tx
    .selectFrom('recordings')
    .innerJoin('users', 'users.id', 'recordings.contributor_id')
    .where('recordings.status', '=', 'pending_review')
    .select([
      'recordings.id',
      'title_en',
      'city_en',
      'era_year',
      'source_type',
      'submitted_at',
      'users.display_name',
    ])
    .orderBy('submitted_at', 'asc')
    .limit(200)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    title: r.title_en ?? '',
    cityEn: r.city_en ?? '',
    eraYear: r.era_year ?? 0,
    sourceType: r.source_type!,
    contributor: r.display_name ?? 'Anonymous contributor',
    submittedAt: iso(r.submitted_at!),
  }));
}

export interface DecisionResult {
  contributorId: string;
  /** Seconds between submission and decision, for the moderation-time metric. */
  waitedSeconds: number;
}

/**
 * Records the review, moves the recording, and tells the contributor. The
 * database refuses the status change unless a matching review row from this
 * moderator exists, so the order here matters.
 */
export async function decide(
  tx: Tx,
  input: { recordingId: string; moderatorId: string; decision: ModerationDecisionInput },
): Promise<DecisionResult> {
  const rec = await tx
    .selectFrom('recordings')
    .where('id', '=', input.recordingId)
    .select(['status', 'contributor_id', 'submitted_at', 'title_en'])
    .executeTakeFirst();
  if (!rec) throw notFound();
  if (rec.status !== 'pending_review') throw new HttpError(409, 'not_pending', 'This submission is not awaiting review');
  if (rec.contributor_id === input.moderatorId) {
    throw new HttpError(403, 'own_submission', 'You cannot review your own submission');
  }

  const d = input.decision;
  await tx
    .insertInto('moderation_reviews')
    .values({
      recording_id: input.recordingId,
      moderator_id: input.moderatorId,
      decision: d.decision,
      chk_audio_quality: d.checklist.audioQuality,
      chk_rights: d.checklist.rights,
      chk_location: d.checklist.location,
      chk_no_private_speech: d.checklist.noPrivateSpeech,
      reason: d.reason ?? null,
    })
    .execute();

  await tx
    .updateTable('recordings')
    .set({ status: d.decision === 'approve' ? 'published' : 'rejected' })
    .where('id', '=', input.recordingId)
    .execute();

  const title = rec.title_en ?? 'your recording';
  await tx
    .insertInto('notifications')
    .values({
      user_id: rec.contributor_id,
      recording_id: input.recordingId,
      kind: d.decision === 'approve' ? 'submission_published' : 'submission_rejected',
      message:
        d.decision === 'approve'
          ? `“${title}” has been published. Thank you for contributing.`
          : `“${title}” was not published. Reason from the moderator: ${d.reason}`,
    })
    .execute();

  const submitted = rec.submitted_at ? new Date(rec.submitted_at).getTime() : Date.now();
  return { contributorId: rec.contributor_id, waitedSeconds: (Date.now() - submitted) / 1000 };
}

/** Takes a published recording offline (takedown or moderator action). */
export async function unpublish(tx: Tx, recordingId: string, reason: string): Promise<boolean> {
  const rec = await tx
    .updateTable('recordings')
    .set({ status: 'unpublished' })
    .where('id', '=', recordingId)
    .where('status', '=', 'published')
    .returning(['contributor_id', 'title_en'])
    .executeTakeFirst();
  if (!rec) return false;
  await tx
    .insertInto('notifications')
    .values({
      user_id: rec.contributor_id,
      recording_id: recordingId,
      kind: 'recording_unpublished',
      message: `“${rec.title_en ?? 'Your recording'}” has been unpublished. ${reason}`,
    })
    .execute();
  return true;
}

// ---------- takedowns ----------

const UUID_IN_URL = /([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

/** Public intake. Links the request to a recording when the URL contains its ID. */
export async function createTakedown(tx: Tx, input: TakedownInput): Promise<{ id: string; recordingId: string | null }> {
  const candidate = input.recordingUrl ? UUID_IN_URL.exec(input.recordingUrl)?.[1]?.toLowerCase() : undefined;
  const recording = candidate
    ? await tx.selectFrom('recordings').where('id', '=', candidate).select('id').executeTakeFirst()
    : undefined;
  // No RETURNING: the public may insert takedown requests but not read them back.
  const id = randomUUID();
  await tx
    .insertInto('takedown_requests')
    .values({
      id,
      recording_id: recording?.id ?? null,
      target_url: input.recordingUrl ?? null,
      claimant_name: input.claimantName,
      claimant_email: input.claimantEmail,
      basis: input.basis,
      statement: input.statement,
      good_faith_attested: input.goodFaith,
    })
    .execute();
  return { id, recordingId: recording?.id ?? null };
}

export async function listTakedowns(tx: Tx): Promise<TakedownItem[]> {
  const rows = await tx
    .selectFrom('takedown_requests')
    .leftJoin('recordings', 'recordings.id', 'takedown_requests.recording_id')
    .select([
      'takedown_requests.id',
      'takedown_requests.recording_id',
      'recordings.title_en',
      'target_url',
      'claimant_name',
      'claimant_email',
      'basis',
      'statement',
      'takedown_requests.status',
      'received_at',
    ])
    // Open requests first, oldest first.
    .orderBy((eb) => eb.case().when('takedown_requests.status', '=', 'received').then(0).else(1).end())
    .orderBy('received_at', 'asc')
    .limit(200)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    recordingId: r.recording_id,
    recordingTitle: r.title_en,
    targetUrl: r.target_url,
    claimantName: r.claimant_name,
    claimantEmail: r.claimant_email,
    basis: r.basis,
    statement: r.statement,
    status: r.status,
    receivedAt: iso(r.received_at),
  }));
}

export async function resolveTakedown(
  tx: Tx,
  input: { id: string; moderatorId: string; action: 'unpublish' | 'decline'; note: string },
): Promise<{ recordingId: string | null; unpublished: boolean }> {
  const req = await tx
    .selectFrom('takedown_requests')
    .where('id', '=', input.id)
    .select(['status', 'recording_id'])
    .executeTakeFirst();
  if (!req) throw notFound();
  if (req.status !== 'received') throw new HttpError(409, 'already_resolved', 'This request was already resolved');

  let unpublished = false;
  if (input.action === 'unpublish' && req.recording_id) {
    unpublished = await unpublish(tx, req.recording_id, 'It is unavailable while a takedown request is handled.');
  }
  await tx
    .updateTable('takedown_requests')
    .set({
      status: input.action === 'unpublish' ? 'actioned' : 'declined',
      resolved_by: input.moderatorId,
      resolved_at: new Date(),
      resolution_note: input.note,
    })
    .where('id', '=', input.id)
    .execute();
  return { recordingId: req.recording_id, unpublished };
}
