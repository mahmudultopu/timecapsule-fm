import { randomBytes } from 'node:crypto';
import type { Tx } from '@timecapsule/db';
import {
  UPLOAD_CONTENT_TYPES,
  missingForSubmit,
  type AudioFormat,
  type SubmissionDetail,
  type SubmissionFields,
  type SubmissionSummary,
} from '@timecapsule/shared';
import { sql } from 'kysely';
import { HttpError, notFound } from '../errors.js';
import type { Storage } from './storage.js';

/** Statuses in which the contributor may still change metadata or audio. */
export const EDITABLE = ['draft', 'ready', 'processing_failed', 'rejected'] as const;
const UPLOAD_TTL_SECONDS = 15 * 60;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

// camelCase API field -> snake_case column, for the simple 1:1 fields.
const COLUMNS = {
  titleEn: 'title_en',
  titleLocal: 'title_local',
  titleLocalLang: 'title_local_lang',
  placeNameEn: 'place_name_en',
  placeNameLocal: 'place_name_local',
  cityEn: 'city_en',
  cityLocal: 'city_local',
  countryCode: 'country_code',
  sceneDescriptionEn: 'scene_description_en',
  sceneDescriptionLocal: 'scene_description_local',
  category: 'category',
  eraYear: 'era_year',
  capturedFrom: 'captured_from',
  capturedTo: 'captured_to',
  dateConfidence: 'date_confidence',
  sourceType: 'source_type',
  syntheticDisclosure: 'synthetic_disclosure',
  recorderName: 'recorder_name',
  locationPrecision: 'location_precision',
  publicPlaceAttested: 'public_place_attested',
  license: 'license',
  rightsStatus: 'rights_status',
  rightsHolder: 'rights_holder',
  attribution: 'attribution_text',
  speechConsent: 'speech_consent',
} as const satisfies Partial<Record<keyof SubmissionFields, string>>;

export async function createDraft(tx: Tx, userId: string): Promise<string> {
  const row = await tx
    .insertInto('recordings')
    .values({ contributor_id: userId })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function listMine(tx: Tx, userId: string): Promise<SubmissionSummary[]> {
  const rows = await tx
    .selectFrom('recordings')
    .where('contributor_id', '=', userId)
    .select(['id', 'status', 'title_en', 'city_en', 'era_year', 'updated_at'])
    .orderBy('updated_at', 'desc')
    .limit(200)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    title: r.title_en,
    cityEn: r.city_en,
    eraYear: r.era_year,
    updatedAt: iso(r.updated_at)!,
  }));
}

/** Owner or moderator view of any submission (RLS decides who can see it). */
export async function getSubmission(tx: Tx, id: string): Promise<SubmissionDetail | null> {
  const r = await tx
    .selectFrom('recordings')
    .where('id', '=', id)
    .selectAll()
    .select([
      sql<number | null>`ST_Y(location::geometry)`.as('lat'),
      sql<number | null>`ST_X(location::geometry)`.as('lon'),
    ])
    .executeTakeFirst();
  if (!r) return null;

  const [upload, review] = await Promise.all([
    tx
      .selectFrom('uploads')
      .where('recording_id', '=', id)
      .select(['status', 'rejection_code'])
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst(),
    tx
      .selectFrom('moderation_reviews')
      .where('recording_id', '=', id)
      .select(['decision', 'reason', 'created_at'])
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst(),
  ]);

  const fields: Required<SubmissionFields> = {
    titleEn: r.title_en,
    titleLocal: r.title_local,
    titleLocalLang: r.title_local_lang,
    placeNameEn: r.place_name_en,
    placeNameLocal: r.place_name_local,
    cityEn: r.city_en,
    cityLocal: r.city_local,
    countryCode: r.country_code,
    sceneDescriptionEn: r.scene_description_en,
    sceneDescriptionLocal: r.scene_description_local,
    category: r.category,
    eraYear: r.era_year,
    capturedFrom: r.captured_from,
    capturedTo: r.captured_to,
    dateConfidence: r.date_confidence,
    sourceType: r.source_type,
    syntheticDisclosure: r.synthetic_disclosure,
    recorderName: r.recorder_name,
    location: r.lat !== null && r.lon !== null ? { lat: r.lat, lon: r.lon } : null,
    locationPrecision: r.location_precision,
    publicPlaceAttested: r.public_place_attested,
    license: r.license,
    rightsStatus: r.rights_status === 'disputed' ? null : r.rights_status,
    rightsHolder: r.rights_holder,
    attribution: r.attribution_text,
    speechConsent: r.speech_consent,
  };

  return {
    id: r.id,
    status: r.status,
    fields,
    durationMs: r.duration_ms,
    agreementVersion: r.agreement_version,
    submittedAt: iso(r.submitted_at),
    updatedAt: iso(r.updated_at)!,
    upload: upload ? { status: upload.status, rejectionCode: upload.rejection_code } : null,
    review: review ? { decision: review.decision, reason: review.reason, createdAt: iso(review.created_at)! } : null,
    missing: missingForSubmit(fields, r.duration_ms),
  };
}

export async function updateFields(tx: Tx, id: string, f: SubmissionFields): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMNS)) {
    const value = f[key as keyof SubmissionFields];
    if (value !== undefined) set[column] = value;
  }
  if (f.location !== undefined) {
    // The raw point only ever exists inside this statement: a BEFORE trigger
    // snaps it to the chosen precision before the row is written.
    set.location = f.location ? sql`ST_SetSRID(ST_MakePoint(${f.location.lon}, ${f.location.lat}), 4326)::geography` : null;
    if (f.location === null) set.location_precision = null;
    else if (f.locationPrecision === undefined) {
      set.location_precision = sql`coalesce(location_precision, 'neighborhood_1km'::location_precision)`;
    }
  }
  if (Object.keys(set).length === 0) return;
  const res = await tx.updateTable('recordings').set(set).where('id', '=', id).executeTakeFirst();
  if (res.numUpdatedRows === 0n) throw notFound();
}

export async function deleteDraft(tx: Tx, id: string): Promise<void> {
  const res = await tx.deleteFrom('recordings').where('id', '=', id).executeTakeFirst();
  if (res.numDeletedRows === 0n) throw new HttpError(409, 'not_deletable', 'Only unpublished submissions can be deleted');
}

async function ownedEditable(tx: Tx, id: string, userId: string) {
  const rec = await tx
    .selectFrom('recordings')
    .where('id', '=', id)
    .where('contributor_id', '=', userId)
    .select(['status'])
    .executeTakeFirst();
  if (!rec) throw notFound();
  if (!(EDITABLE as readonly string[]).includes(rec.status) && rec.status !== 'processing') {
    throw new HttpError(409, 'not_editable', 'Withdraw the submission before changing its audio');
  }
}

export async function createUploadIntent(
  tx: Tx,
  storage: Storage,
  input: { recordingId: string; userId: string; bytes: number; format: AudioFormat },
) {
  await ownedEditable(tx, input.recordingId, input.userId);
  // A new upload supersedes any unfinished earlier one.
  await tx
    .updateTable('uploads')
    .set({ status: 'expired' })
    .where('recording_id', '=', input.recordingId)
    .where('status', '=', 'pending')
    .execute();

  const key = `quarantine/${randomBytes(16).toString('hex')}`;
  const contentType = UPLOAD_CONTENT_TYPES[input.format];
  const upload = await tx
    .insertInto('uploads')
    .values({
      recording_id: input.recordingId,
      user_id: input.userId,
      quarantine_key: key,
      declared_bytes: input.bytes,
      declared_format: input.format,
      expires_at: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const signed = await storage.signUpload(key, {
    ttlSeconds: UPLOAD_TTL_SECONDS,
    contentType,
    contentLength: input.bytes,
  });
  return {
    uploadId: upload.id,
    url: signed.url,
    method: 'PUT' as const,
    headers: { 'content-type': contentType },
    expiresAt: signed.expiresAt.toISOString(),
  };
}

export type CompleteResult = { ok: true } | { ok: false; code: 'size_mismatch' | 'missing_object' | 'expired' };

/**
 * Called after the browser's PUT. Verifies the object really is there and
 * exactly the declared size (server-side size enforcement), then hands the
 * upload to the worker and wakes it with NOTIFY.
 */
export async function completeUpload(
  tx: Tx,
  storage: Storage,
  input: { recordingId: string; userId: string; uploadId: string },
): Promise<CompleteResult> {
  const upload = await tx
    .selectFrom('uploads')
    .where('id', '=', input.uploadId)
    .where('recording_id', '=', input.recordingId)
    .where('user_id', '=', input.userId)
    .select(['status', 'quarantine_key', 'declared_bytes', 'expires_at'])
    .executeTakeFirst();
  if (!upload) throw notFound();
  if (upload.status !== 'pending') throw new HttpError(409, 'upload_not_pending', 'Upload already completed');

  if (new Date(upload.expires_at) < new Date()) {
    await tx.updateTable('uploads').set({ status: 'expired' }).where('id', '=', input.uploadId).execute();
    return { ok: false, code: 'expired' };
  }
  const size = await storage.quarantineSize(upload.quarantine_key);
  if (size === null) return { ok: false, code: 'missing_object' };
  if (size !== Number(upload.declared_bytes)) {
    await tx.updateTable('uploads').set({ status: 'expired' }).where('id', '=', input.uploadId).execute();
    return { ok: false, code: 'size_mismatch' };
  }

  await tx.updateTable('uploads').set({ status: 'received' }).where('id', '=', input.uploadId).execute();
  await tx.updateTable('recordings').set({ status: 'processing' }).where('id', '=', input.recordingId).execute();
  await sql`NOTIFY tc_uploads`.execute(tx);
  return { ok: true };
}

export async function submit(tx: Tx, id: string, agreementVersion: string): Promise<void> {
  const detail = await getSubmission(tx, id);
  if (!detail) throw notFound();
  if (detail.missing.length > 0) {
    throw new HttpError(422, 'incomplete', `Still required: ${detail.missing.join(', ')}`);
  }
  const current = await tx
    .selectFrom('contributor_agreements')
    .where('superseded_at', 'is', null)
    .select('version')
    .executeTakeFirst();
  if (!current || current.version !== agreementVersion) {
    throw new HttpError(409, 'agreement_outdated', 'Please review the current contributor agreement');
  }
  await tx
    .updateTable('recordings')
    .set({ agreement_version: agreementVersion, agreement_accepted_at: new Date(), status: 'pending_review' })
    .where('id', '=', id)
    .execute();
}

export async function withdraw(tx: Tx, id: string): Promise<void> {
  const res = await tx
    .updateTable('recordings')
    .set({ status: 'ready' })
    .where('id', '=', id)
    .where('status', '=', 'pending_review')
    .executeTakeFirst();
  if (res.numUpdatedRows === 0n) throw new HttpError(409, 'not_pending', 'Only pending submissions can be withdrawn');
}

/** Preview assets for the owner or a moderator, whatever the status. */
export async function getPreviewAssets(tx: Tx, id: string) {
  const rows = await tx
    .selectFrom('audio_assets')
    .where('recording_id', '=', id)
    .where('kind', 'in', ['preview', 'peaks'])
    .select(['kind', 'storage_key', 'mime_type'])
    .execute();
  const audio = rows.find((r) => r.kind === 'preview');
  const peaks = rows.find((r) => r.kind === 'peaks');
  return audio && peaks ? { audio, peaks } : null;
}
