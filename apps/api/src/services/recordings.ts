import type { Tx } from '@timecapsule/db';
import {
  completeProvenance,
  type BBox,
  type ListQuery,
  type PinCollection,
  type RecordingDetail,
  type RecordingSummary,
} from '@timecapsule/shared';
import { sql, type SelectQueryBuilder } from 'kysely';
import type { Database } from '@timecapsule/db';

export const PIN_LIMIT = 2000;

interface Filters {
  decade?: number | undefined;
  category?: string | undefined;
  license?: string | undefined;
}

// Public endpoints only ever return published rows, even for the owner or a
// moderator. That keeps responses identical for everyone (cacheable) and
// leaves unpublished access to the dedicated, authenticated endpoints.
function published<O>(qb: SelectQueryBuilder<Database, 'recordings', O>, f: Filters) {
  let q = qb.where('recordings.status', '=', 'published');
  if (f.decade !== undefined) q = q.where('recordings.decade', '=', f.decade);
  if (f.category) q = q.where('recordings.category', '=', f.category as never);
  if (f.license) q = q.where('recordings.license', '=', f.license as never);
  return q;
}

export async function findPins(tx: Tx, bbox: BBox, f: Filters): Promise<PinCollection> {
  // A box crossing the antimeridian is split into two envelopes.
  const envelopes =
    bbox.west <= bbox.east
      ? [[bbox.west, bbox.east]]
      : [
          [bbox.west, 180],
          [-180, bbox.east],
        ];
  const rows = await published(tx.selectFrom('recordings'), f)
    .where((eb) =>
      eb.or(
        envelopes.map(
          ([w, e]) =>
            sql<boolean>`recordings.location::geometry && ST_MakeEnvelope(${w}, ${bbox.south}, ${e}, ${bbox.north}, 4326)`,
        ),
      ),
    )
    .select([
      'id',
      'title_en',
      'era_year',
      'category',
      'source_type',
      sql<number>`ST_X(location::geometry)`.as('lon'),
      sql<number>`ST_Y(location::geometry)`.as('lat'),
    ])
    .orderBy('published_at', 'desc')
    .orderBy('id', 'desc')
    .limit(PIN_LIMIT + 1)
    .execute();

  return {
    type: 'FeatureCollection',
    truncated: rows.length > PIN_LIMIT,
    features: rows.slice(0, PIN_LIMIT).map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: {
        id: r.id,
        title: r.title_en!,
        eraYear: r.era_year!,
        category: r.category!,
        sourceType: r.source_type!,
      },
    })),
  };
}

const summaryColumns = [
  'recordings.id',
  'title_en',
  'title_local',
  'title_local_lang',
  'place_name_en',
  'place_name_local',
  'city_en',
  'city_local',
  'country_code',
  'category',
  'era_year',
  'decade',
  'duration_ms',
  'location_precision',
  'source_type',
  'date_confidence',
  'captured_from',
  'captured_to',
  'recorder_name',
  'rights_status',
  'license',
  'rights_holder',
  'attribution_text',
  'speech_consent',
  'synthetic_disclosure',
  'is_demo',
  'published_at',
  'users.display_name',
] as const;

function baseQuery(tx: Tx) {
  return tx
    .selectFrom('recordings')
    .innerJoin('users', 'users.id', 'recordings.contributor_id')
    .select(summaryColumns)
    .select([
      sql<number>`ST_X(recordings.location::geometry)`.as('lon'),
      sql<number>`ST_Y(recordings.location::geometry)`.as('lat'),
    ]);
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof baseQuery>['executeTakeFirstOrThrow']>>;

/** Returns null (row is dropped) if provenance is somehow incomplete. */
function toSummary(r: SummaryRow): RecordingSummary | null {
  const provenance = completeProvenance({
    sourceType: r.source_type,
    dateConfidence: r.date_confidence,
    capturedFrom: r.captured_from,
    capturedTo: r.captured_to,
    recorderName: r.recorder_name,
    locationPrecision: r.location_precision,
    rightsStatus: r.rights_status,
    license: r.license,
    rightsHolder: r.rights_holder,
    attribution: r.attribution_text,
    speechConsent: r.speech_consent,
    syntheticDisclosure: r.synthetic_disclosure,
  });
  if (!provenance || !r.published_at) return null;
  return {
    id: r.id,
    title: { en: r.title_en!, local: r.title_local, localLang: r.title_local_lang },
    place: {
      nameEn: r.place_name_en!,
      nameLocal: r.place_name_local,
      cityEn: r.city_en!,
      cityLocal: r.city_local,
      countryCode: r.country_code!,
    },
    category: r.category!,
    eraYear: r.era_year!,
    decade: r.decade!,
    durationMs: r.duration_ms!,
    location: { lat: r.lat, lon: r.lon, precision: provenance.locationPrecision },
    provenance,
    contributor: { displayName: r.display_name ?? 'Anonymous contributor' },
    isDemo: r.is_demo,
    publishedAt: new Date(r.published_at).toISOString(),
  };
}

export async function listRecordings(
  tx: Tx,
  q: ListQuery,
): Promise<{ items: RecordingSummary[]; nextCursor: string | null; dropped: number }> {
  let query = published(baseQuery(tx), q);
  if (q.q) {
    query = query.where('search_text', 'like', `%${escapeLike(q.q.toLowerCase())}%`);
  }
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (cursor) {
    query = query.where(sql<boolean>`(recordings.published_at, recordings.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`);
  }
  const rows = await query
    .orderBy('recordings.published_at', 'desc')
    .orderBy('recordings.id', 'desc')
    .limit(q.limit + 1)
    .execute();

  const page = rows.slice(0, q.limit);
  const items = page.map(toSummary).filter((x): x is RecordingSummary => x !== null);
  const last = page.at(-1);
  return {
    items,
    nextCursor: rows.length > q.limit && last?.published_at ? encodeCursor(new Date(last.published_at), last.id) : null,
    dropped: page.length - items.length,
  };
}

export async function getRecording(tx: Tx, id: string): Promise<RecordingDetail | null> {
  const row = await published(baseQuery(tx), {})
    .select(['scene_description_en', 'scene_description_local'])
    .where('recordings.id', '=', id)
    .executeTakeFirst();
  if (!row) return null;
  const summary = toSummary(row);
  if (!summary) return null;
  return {
    ...summary,
    sceneDescription: { en: row.scene_description_en!, local: row.scene_description_local },
  };
}

export interface PlaybackAssets {
  category: string;
  audio: { key: string; mimeType: string };
  peaks: { key: string; mimeType: string };
}

export async function getPlaybackAssets(tx: Tx, id: string): Promise<PlaybackAssets | null> {
  const rows = await tx
    .selectFrom('audio_assets')
    .innerJoin('recordings', 'recordings.id', 'audio_assets.recording_id')
    .where('recordings.id', '=', id)
    .where('recordings.status', '=', 'published')
    .where('audio_assets.kind', 'in', ['preview', 'peaks'])
    .select(['audio_assets.kind', 'audio_assets.storage_key', 'audio_assets.mime_type', 'recordings.category'])
    .execute();
  const audio = rows.find((r) => r.kind === 'preview');
  const peaks = rows.find((r) => r.kind === 'peaks');
  if (!audio || !peaks) return null;
  return {
    category: audio.category ?? 'unknown',
    audio: { key: audio.storage_key, mimeType: audio.mime_type },
    peaks: { key: peaks.storage_key, mimeType: peaks.mime_type },
  };
}

// ---------- helpers ----------

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function decodeCursor(c: string): { at: string; id: string } | null {
  const [at, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  if (!at || !id || !UUID.test(id) || Number.isNaN(Date.parse(at))) return null;
  return { at, id };
}
