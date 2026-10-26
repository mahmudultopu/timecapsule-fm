// Seeds 5 DEMO recordings with full provenance and synthetic placeholder audio.
//
//   DATABASE_MIGRATOR_URL=... S3_ENDPOINT=... pnpm db:seed
//
// Runs as the schema owner. Refuses to run with NODE_ENV=production.
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { computePeaks } from '@timecapsule/shared';
import { SAMPLE_RATE, encodeWav, synthesize } from './audio.js';
import {
  DEMO_GENERATED_ON,
  DEMO_RECORDER,
  DEMO_RECORDINGS,
  DEMO_TITLE_PREFIX,
  disclosureFor,
} from './recordings.js';

const DEMO_SECONDS = 20;

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const s3 = new S3Client({
  endpoint: env('S3_ENDPOINT'),
  region: process.env.S3_REGION ?? 'auto',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
});
const bucket = env('S3_BUCKET_MEDIA');

const client = new pg.Client({ connectionString: env('DATABASE_MIGRATOR_URL') });
await client.connect();

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const newKey = (ext: string) => `media/${randomBytes(16).toString('hex')}.${ext}`;

try {
  await client.query('BEGIN');

  const agreementBody = await readFile(new URL('./agreement-draft.md', import.meta.url), 'utf8');
  const agreementVersion = `${DEMO_GENERATED_ON}-draft`;
  await client.query(
    `INSERT INTO contributor_agreements (version, body_md, body_sha256, is_draft, effective_from)
     VALUES ($1, $2, $3, true, now())
     ON CONFLICT (version) DO NOTHING`,
    [agreementVersion, agreementBody, sha256(agreementBody)],
  );

  const { rows: users } = await client.query<{ id: string }>(
    `INSERT INTO users (email, display_name, role)
     VALUES ('demo@timecapsule.invalid', 'TimeCapsule.fm demo', 'contributor')
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
  );
  const demoUser = users[0]!.id;

  // Replace any previous demo rows (and their objects).
  const { rows: oldKeys } = await client.query<{ storage_key: string }>(
    `SELECT a.storage_key FROM audio_assets a JOIN recordings r ON r.id = a.recording_id WHERE r.is_demo`,
  );
  await client.query('DELETE FROM recordings WHERE is_demo');

  for (const r of DEMO_RECORDINGS) {
    const samples = synthesize(r.category, DEMO_SECONDS, r.seed);
    const wav = encodeWav(samples);
    const peaks = Buffer.from(JSON.stringify(computePeaks(samples, SAMPLE_RATE)));
    const audioKey = newKey('wav');
    const peaksKey = newKey('json');

    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: audioKey, Body: wav, ContentType: 'audio/wav' }));
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: peaksKey, Body: peaks, ContentType: 'application/json' }),
    );

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO recordings (
         contributor_id, status, is_demo,
         title_en, title_local, title_local_lang,
         place_name_en, place_name_local, city_en, city_local, country_code,
         scene_description_en, scene_description_local, category, era_year,
         captured_from, captured_to, date_confidence, source_type, synthetic_disclosure, recorder_name,
         location, location_precision, license, rights_status, rights_holder, attribution_text,
         speech_consent, duration_ms, agreement_version, agreement_accepted_at, submitted_at, published_at,
         public_place_attested
       ) VALUES (
         $1, 'published', true,
         $2, $3, $4,
         $5, $6, $7, $8, $9,
         $10, $11, $12, $13,
         $14, $14, 'exact', 'community_reconstruction', $15, $16,
         ST_SetSRID(ST_MakePoint($17, $18), 4326)::geography, $19, 'cc0', 'contributor_owns',
         'TimeCapsule.fm', 'Synthetic placeholder audio by TimeCapsule.fm (CC0)',
         'no_identifiable_speech', $20, $21, now(), now(), now(),
         $22
       ) RETURNING id`,
      [
        demoUser,
        `${DEMO_TITLE_PREFIX} ${r.titleEn}`,
        r.titleLocal ? `${DEMO_TITLE_PREFIX} ${r.titleLocal}` : null,
        r.titleLocalLang,
        r.placeEn,
        r.placeLocal,
        r.cityEn,
        r.cityLocal,
        r.countryCode,
        r.sceneEn,
        r.sceneLocal,
        r.category,
        r.eraYear,
        DEMO_GENERATED_ON,
        disclosureFor(r),
        DEMO_RECORDER,
        r.lon,
        r.lat,
        r.precision,
        DEMO_SECONDS * 1000,
        agreementVersion,
        // ~100 m precision is only allowed for public places; the demo station is one.
        r.precision === 'site_100m',
      ],
    );
    const id = rows[0]!.id;
    await client.query(
      `INSERT INTO audio_assets (recording_id, kind, storage_key, mime_type, byte_size, sha256, codec, sample_rate, channels)
       VALUES ($1, 'preview', $2, 'audio/wav', $3, $4, 'pcm_s16le', 22050, 1),
              ($1, 'peaks', $5, 'application/json', $6, $7, NULL, NULL, NULL)`,
      [id, audioKey, wav.length, sha256(wav), peaksKey, peaks.length, sha256(peaks)],
    );
    console.log(`seeded ${r.cityEn} ${r.eraYear} (${r.category})`);
  }

  await client.query('COMMIT');

  if (oldKeys.length > 0) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: oldKeys.map((k) => ({ Key: k.storage_key })) },
      }),
    );
  }
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
