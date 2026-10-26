import { z } from 'zod';
import { AUDIO_FORMATS, MAX_UPLOAD_BYTES } from './audio.js';
import { RECORDING_STATUSES } from './enums.js';
import {
  DateConfidenceSchema,
  LicenseSchema,
  LocationPrecisionSchema,
  RecordingId,
  SoundCategorySchema,
  SourceTypeSchema,
  SpeechConsentSchema,
  plainText,
} from './schemas.js';

const BCP47 = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

// Contributors can't claim their own rights are "disputed"; only moderators
// and takedowns put a recording in that state.
export const ContributorRightsStatus = z.enum(['contributor_owns', 'holder_permission', 'licensed_from_archive', 'public_domain']);

type TextFactory = (min: number, max: number) => z.ZodType<string | null>;

/**
 * The editable metadata fields, built twice from one definition: inputs clean
 * and length-check free text; outputs are plain strings (response
 * serialisation can't run input transforms in reverse).
 */
function fieldsShape(text: TextFactory) {
  return {
    titleEn: text(1, 160),
    titleLocal: text(1, 160),
    titleLocalLang: z.string().regex(BCP47).max(35).nullable(),
    placeNameEn: text(1, 160),
    placeNameLocal: text(1, 160),
    cityEn: text(1, 120),
    cityLocal: text(1, 120),
    countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
    sceneDescriptionEn: text(20, 2000),
    sceneDescriptionLocal: text(1, 2000),
    category: SoundCategorySchema.nullable(),
    eraYear: z.number().int().min(1890).max(2029).nullable(),
    capturedFrom: z.iso.date().nullable(),
    capturedTo: z.iso.date().nullable(),
    dateConfidence: DateConfidenceSchema.nullable(),
    sourceType: SourceTypeSchema.nullable(),
    syntheticDisclosure: text(1, 2000),
    /** null = recorder unknown. */
    recorderName: text(1, 160),
    /** Raw point; the database snaps it to `locationPrecision` before storing. */
    location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable(),
    locationPrecision: LocationPrecisionSchema.nullable(),
    publicPlaceAttested: z.boolean(),
    license: LicenseSchema.nullable(),
    rightsStatus: ContributorRightsStatus.nullable(),
    rightsHolder: text(1, 200),
    attribution: text(1, 300),
    speechConsent: SpeechConsentSchema.nullable(),
  };
}

const inputText: TextFactory = (min, max) => plainText(max).pipe(z.string().min(min).max(max)).nullable();
const outputText: TextFactory = () => z.string().nullable();

/**
 * Editable metadata. Every field is optional on PATCH and nullable so a
 * draft can be saved half-finished; completeness is checked on submit.
 */
export const SubmissionFields = z.object(fieldsShape(inputText)).partial().meta({ id: 'SubmissionFields' });
export type SubmissionFields = z.infer<typeof SubmissionFields>;

export const SubmissionFieldsOutput = z.object(fieldsShape(outputText)).meta({ id: 'SubmissionFieldsOutput' });

export const RecordingStatusSchema = z.enum(RECORDING_STATUSES);

export const SubmissionDetail = z
  .object({
    id: RecordingId,
    status: RecordingStatusSchema,
    fields: SubmissionFieldsOutput,
    durationMs: z.number().int().nullable(),
    agreementVersion: z.string().nullable(),
    submittedAt: z.iso.datetime({ offset: true }).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
    upload: z
      .object({ status: z.string(), rejectionCode: z.string().nullable() })
      .nullable()
      .meta({ description: 'Most recent upload for this submission' }),
    review: z
      .object({
        decision: z.enum(['approve', 'reject']),
        reason: z.string().nullable(),
        createdAt: z.iso.datetime({ offset: true }),
      })
      .nullable()
      .meta({ description: 'Most recent moderation decision, visible to the contributor' }),
    missing: z.array(z.string()).meta({ description: 'Fields still required before submitting' }),
  })
  .meta({ id: 'SubmissionDetail' });
export type SubmissionDetail = z.infer<typeof SubmissionDetail>;

export const SubmissionSummary = z
  .object({
    id: RecordingId,
    status: RecordingStatusSchema,
    title: z.string().nullable(),
    cityEn: z.string().nullable(),
    eraYear: z.number().int().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'SubmissionSummary' });
export type SubmissionSummary = z.infer<typeof SubmissionSummary>;

const REQUIRED_FOR_SUBMIT = [
  'titleEn',
  'placeNameEn',
  'cityEn',
  'countryCode',
  'sceneDescriptionEn',
  'category',
  'eraYear',
  'capturedFrom',
  'capturedTo',
  'dateConfidence',
  'sourceType',
  'location',
  'locationPrecision',
  'license',
  'rightsStatus',
  'rightsHolder',
  'attribution',
  'speechConsent',
] as const satisfies readonly (keyof SubmissionFields)[];

/**
 * What still blocks submission, as field keys (plus a few rule keys). The
 * API refuses to submit while this is non-empty and the form shows it as a
 * checklist; the database enforces the same rules as a last line.
 */
export function missingForSubmit(f: SubmissionFields, durationMs: number | null): string[] {
  const missing: string[] = REQUIRED_FOR_SUBMIT.filter((k) => f[k] === null || f[k] === undefined);
  if (f.titleLocal && !f.titleLocalLang) missing.push('titleLocalLang');
  if (f.sourceType === 'community_reconstruction' && !f.syntheticDisclosure?.trim()) {
    missing.push('syntheticDisclosure');
  }
  if (f.capturedFrom && f.capturedTo && f.capturedFrom > f.capturedTo) missing.push('capturedRange');
  if (
    f.sourceType &&
    f.sourceType !== 'community_reconstruction' &&
    f.eraYear &&
    f.capturedFrom &&
    f.capturedTo &&
    (f.eraYear < Number(f.capturedFrom.slice(0, 4)) || f.eraYear > Number(f.capturedTo.slice(0, 4)))
  ) {
    missing.push('eraMatchesCapture');
  }
  if (f.locationPrecision === 'site_100m' && !f.publicPlaceAttested) missing.push('publicPlaceAttested');
  if (!durationMs) missing.push('audio');
  return missing;
}

// ---------- upload ----------

export const UploadIntentInput = z
  .object({
    bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    format: z.enum(AUDIO_FORMATS),
  })
  .meta({ id: 'UploadIntentRequest' });

export const UploadIntent = z
  .object({
    uploadId: z.uuid(),
    url: z.url(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'UploadIntent', description: 'Signed PUT straight to the private quarantine bucket' });
export type UploadIntent = z.infer<typeof UploadIntent>;

export const UploadCompleteInput = z.object({ uploadId: z.uuid() });

export const SubmitInput = z
  .object({
    agreementVersion: z.string().max(40),
    /** The contributor ticks each of these on the form. */
    confirmations: z.object({
      rights: z.literal(true),
      accuracy: z.literal(true),
      consent: z.literal(true),
    }),
  })
  .meta({ id: 'SubmitRequest' });

export const Agreement = z
  .object({ version: z.string(), bodyMd: z.string(), isDraft: z.boolean() })
  .meta({ id: 'Agreement' });
export type Agreement = z.infer<typeof Agreement>;

// ---------- moderation ----------

export const ModerationChecklist = z.object({
  audioQuality: z.boolean(),
  rights: z.boolean(),
  location: z.boolean(),
  noPrivateSpeech: z.boolean(),
});

export const ModerationDecisionInput = z
  .discriminatedUnion('decision', [
    z.object({
      decision: z.literal('approve'),
      checklist: ModerationChecklist.extend({
        audioQuality: z.literal(true),
        rights: z.literal(true),
        location: z.literal(true),
        noPrivateSpeech: z.literal(true),
      }),
      reason: plainText(2000).optional(),
    }),
    z.object({
      decision: z.literal('reject'),
      checklist: ModerationChecklist,
      reason: plainText(2000).pipe(z.string().min(10)),
    }),
  ])
  .meta({ id: 'ModerationDecisionRequest' });
export type ModerationDecisionInput = z.infer<typeof ModerationDecisionInput>;

export const QueueItem = z
  .object({
    id: RecordingId,
    title: z.string(),
    cityEn: z.string(),
    eraYear: z.number().int(),
    sourceType: SourceTypeSchema,
    contributor: z.string(),
    submittedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'QueueItem' });
export type QueueItem = z.infer<typeof QueueItem>;

// ---------- takedowns ----------

export const TakedownInput = z
  .object({
    recordingUrl: plainText(500).optional(),
    claimantName: plainText(200).pipe(z.string().min(1)),
    claimantEmail: z.email().max(254),
    basis: z.enum(['copyright', 'privacy', 'other']),
    statement: plainText(10000).pipe(z.string().min(20)),
    goodFaith: z.literal(true),
  })
  .meta({ id: 'TakedownRequest' });
export type TakedownInput = z.infer<typeof TakedownInput>;

export const TakedownItem = z
  .object({
    id: z.uuid(),
    recordingId: RecordingId.nullable(),
    recordingTitle: z.string().nullable(),
    targetUrl: z.string().nullable(),
    claimantName: z.string(),
    claimantEmail: z.string(),
    basis: z.enum(['copyright', 'privacy', 'other']),
    statement: z.string(),
    status: z.enum(['received', 'actioned', 'declined']),
    receivedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'TakedownItem' });
export type TakedownItem = z.infer<typeof TakedownItem>;

export const TakedownResolveInput = z
  .object({
    action: z.enum(['unpublish', 'decline']),
    note: plainText(2000).pipe(z.string().min(3)),
  })
  .meta({ id: 'TakedownResolveRequest' });

export const UnpublishInput = z.object({ reason: plainText(2000).pipe(z.string().min(3)) });

// ---------- account ----------

export const Profile = z
  .object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    role: z.enum(['contributor', 'moderator', 'admin']),
    ageAttested: z.boolean(),
    emailNotifications: z.boolean(),
  })
  .meta({ id: 'Profile' });
export type Profile = z.infer<typeof Profile>;

export const ProfileUpdate = z
  .object({
    displayName: plainText(80).pipe(z.string().min(1)),
    ageAttested: z.literal(true),
    emailNotifications: z.boolean(),
  })
  .partial()
  .meta({ id: 'ProfileUpdateRequest' });

export const Notification = z
  .object({
    id: z.uuid(),
    kind: z.enum(['submission_published', 'submission_rejected', 'recording_unpublished', 'processing_failed']),
    message: z.string(),
    recordingId: RecordingId.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    readAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'Notification' });
export type Notification = z.infer<typeof Notification>;
