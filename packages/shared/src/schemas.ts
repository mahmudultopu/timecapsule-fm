import { z } from 'zod';
import {
  DATE_CONFIDENCES,
  LICENSES,
  LOCATION_PRECISIONS,
  MAX_DECADE,
  MIN_DECADE,
  RIGHTS_STATUSES,
  SOUND_CATEGORIES,
  SOURCE_TYPES,
  SPEECH_CONSENTS,
} from './enums.js';
import { parseBBox } from './geo.js';
import { cleanPlainText } from './text.js';

// ---------- primitives ----------

export const RecordingId = z.uuid({ version: 'v4' }).meta({
  description: 'Random v4 UUID. Never sequential.',
});

export const Decade = z.coerce
  .number()
  .int()
  .min(MIN_DECADE)
  .max(MAX_DECADE)
  .refine((n) => n % 10 === 0, 'decade must be a multiple of 10')
  .meta({ description: 'First year of a decade, e.g. 1980', example: 1980 });

/** Free text from users: trimmed, NFC-normalised, control/bidi chars stripped. */
export const plainText = (max: number) =>
  z
    .string()
    .max(max * 2) // cheap pre-check before normalisation
    .transform(cleanPlainText)
    .pipe(z.string().max(max));

export const SourceTypeSchema = z.enum(SOURCE_TYPES);
export const DateConfidenceSchema = z.enum(DATE_CONFIDENCES);
export const LocationPrecisionSchema = z.enum(LOCATION_PRECISIONS);
export const SoundCategorySchema = z.enum(SOUND_CATEGORIES);
export const LicenseSchema = z.enum(LICENSES);
export const RightsStatusSchema = z.enum(RIGHTS_STATUSES);
export const SpeechConsentSchema = z.enum(SPEECH_CONSENTS);

// ---------- query strings ----------

const filters = {
  decade: Decade.optional(),
  category: SoundCategorySchema.optional(),
  license: LicenseSchema.optional(),
};

export const PinsQuery = z.object({
  bbox: z
    .string()
    .max(100)
    .transform((raw, ctx) => {
      const box = parseBBox(raw);
      if (!box) {
        ctx.addIssue({ code: 'custom', message: 'bbox must be "west,south,east,north"' });
        return z.NEVER;
      }
      return box;
    })
    .meta({ description: 'west,south,east,north in WGS84 degrees', example: '-10,35,30,60' }),
  ...filters,
});
export type PinsQuery = z.infer<typeof PinsQuery>;

export const ListQuery = z.object({
  q: plainText(100).optional().meta({ description: 'Matches city or place name (en or local)' }),
  ...filters,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListQuery = z.infer<typeof ListQuery>;

export const IdParams = z.object({ id: RecordingId });

// ---------- responses ----------

export const Provenance = z
  .object({
    sourceType: SourceTypeSchema,
    dateConfidence: DateConfidenceSchema,
    capturedFrom: z.iso.date(),
    capturedTo: z.iso.date(),
    recorderName: z.string().nullable().meta({ description: 'null means the recorder is unknown' }),
    locationPrecision: LocationPrecisionSchema,
    rightsStatus: RightsStatusSchema,
    license: LicenseSchema,
    rightsHolder: z.string(),
    attribution: z.string(),
    speechConsent: SpeechConsentSchema,
    syntheticDisclosure: z
      .string()
      .nullable()
      .meta({ description: 'Required (non-null) when sourceType is community_reconstruction' }),
  })
  .meta({ id: 'Provenance' });
export type Provenance = z.infer<typeof Provenance>;

export const RecordingSummary = z
  .object({
    id: RecordingId,
    title: z.object({ en: z.string(), local: z.string().nullable(), localLang: z.string().nullable() }),
    place: z.object({
      nameEn: z.string(),
      nameLocal: z.string().nullable(),
      cityEn: z.string(),
      cityLocal: z.string().nullable(),
      countryCode: z.string().length(2),
    }),
    category: SoundCategorySchema,
    eraYear: z.number().int(),
    decade: z.number().int(),
    durationMs: z.number().int().positive(),
    location: z.object({ lat: z.number(), lon: z.number(), precision: LocationPrecisionSchema }),
    provenance: Provenance,
    contributor: z.object({ displayName: z.string() }),
    isDemo: z.boolean(),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'RecordingSummary' });
export type RecordingSummary = z.infer<typeof RecordingSummary>;

export const RecordingDetail = RecordingSummary.extend({
  sceneDescription: z.object({ en: z.string(), local: z.string().nullable() }),
}).meta({ id: 'RecordingDetail' });
export type RecordingDetail = z.infer<typeof RecordingDetail>;

export const RecordingPage = z
  .object({ items: z.array(RecordingSummary), nextCursor: z.string().nullable() })
  .meta({ id: 'RecordingPage' });
export type RecordingPage = z.infer<typeof RecordingPage>;

export const PinFeature = z.object({
  type: z.literal('Feature'),
  id: RecordingId,
  geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    id: RecordingId,
    title: z.string(),
    eraYear: z.number().int(),
    category: SoundCategorySchema,
    sourceType: SourceTypeSchema,
  }),
});
export type PinFeature = z.infer<typeof PinFeature>;

export const PinCollection = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(PinFeature),
    truncated: z.boolean().meta({ description: 'True when more pins matched than were returned; zoom in.' }),
  })
  .meta({ id: 'PinCollection' });
export type PinCollection = z.infer<typeof PinCollection>;

export const Playback = z
  .object({
    audioUrl: z.url(),
    audioMimeType: z.string(),
    peaksUrl: z.url(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Playback', description: 'Short-lived signed URLs. Re-request when expired.' });
export type Playback = z.infer<typeof Playback>;

export const Peaks = z.object({
  version: z.literal(1),
  sampleRate: z.number().int().positive(),
  samplesPerPeak: z.number().int().positive(),
  /** Normalised 0..1 absolute peak per bucket. */
  data: z.array(z.number().min(0).max(1)).max(20_000),
});
export type Peaks = z.infer<typeof Peaks>;

export const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .meta({ id: 'Error' });
export type ErrorBody = z.infer<typeof ErrorBody>;
