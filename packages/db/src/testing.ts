// Test-only harness: a real Postgres (PGlite, compiled to WASM) with PostGIS
// and pg_trgm, migrated from scratch. Lets RLS, triggers and PostGIS queries
// be tested without Docker. CI additionally runs against a real PostGIS server.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { postgis } from '@electric-sql/pglite-postgis';
import { Kysely, PostgresDialect } from 'kysely';
import { migrate, type SqlRunner } from './migrate.js';
import type { Database } from './schema.js';

export type TestRole = 'tc_api' | 'tc_worker' | 'owner';

export interface TestDatabase {
  pglite: PGlite;
  /** Superuser runner (bypasses RLS) for fixtures. */
  admin: SqlRunner;
  /** Kysely bound to an application role, so RLS applies. */
  kysely(role?: TestRole): Kysely<Database>;
  close(): Promise<void>;
}

const DATE_OID = 1082;

export async function createTestDatabase(): Promise<TestDatabase> {
  const pglite = await PGlite.create({
    extensions: { postgis, pg_trgm },
    parsers: { [DATE_OID]: (v: string) => v },
  });
  const admin = pgliteRunner(pglite);
  await migrate(admin);

  // PGlite has a single connection; serialise checkouts so concurrent
  // Kysely transactions can't interleave on it.
  let queue: Promise<void> = Promise.resolve();
  const instances: Kysely<Database>[] = [];

  return {
    pglite,
    admin,
    kysely(role: TestRole = 'tc_api') {
      const pool = {
        async connect() {
          let release!: () => void;
          const prev = queue;
          queue = new Promise<void>((r) => (release = r));
          await prev;
          if (role !== 'owner') await pglite.exec(`SET ROLE ${role}`);
          return {
            async query(sql: string, parameters: readonly unknown[]) {
              const res = await pglite.query(sql, parameters as unknown[]);
              const command = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase();
              return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length, command };
            },
            release() {
              void pglite
                .exec('RESET ROLE; RESET app.user_id')
                .catch(() => undefined)
                .finally(release);
            },
          };
        },
        async end() {},
      };
      // The shape matches what PostgresDialect uses from pg.Pool.
      const k = new Kysely<Database>({ dialect: new PostgresDialect({ pool: pool as never }) });
      instances.push(k);
      return k;
    },
    async close() {
      await Promise.all(instances.map((k) => k.destroy()));
      await pglite.close();
    },
  };
}

export function pgliteRunner(pglite: PGlite): SqlRunner {
  return {
    async exec(sql) {
      await pglite.exec(sql);
    },
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pglite.query<T>(sql, params)).rows;
    },
  };
}

// ---------- fixtures ----------

export async function insertUser(
  db: SqlRunner,
  opts: { role?: 'contributor' | 'moderator' | 'admin'; displayName?: string } = {},
): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO users (email, role, display_name) VALUES (gen_random_uuid() || '@test.invalid', $1, $2) RETURNING id`,
    [opts.role ?? 'contributor', opts.displayName ?? 'Test User'],
  );
  return row!.id;
}

export async function insertAgreement(db: SqlRunner, version = '2026-10-26-draft'): Promise<string> {
  await db.query(
    `INSERT INTO contributor_agreements (version, body_md, body_sha256, effective_from)
     VALUES ($1, 'DRAFT', repeat('0', 64), now()) ON CONFLICT DO NOTHING`,
    [version],
  );
  return version;
}

export interface RecordingFixture {
  contributorId: string;
  status?: string;
  lat?: number;
  lon?: number;
  precision?: string;
  eraYear?: number;
  category?: string;
  license?: string;
  sourceType?: string;
  cityEn?: string;
  isDemo?: boolean;
}

/** Inserts a complete recording as superuser, bypassing the state machine. */
export async function insertRecording(db: SqlRunner, f: RecordingFixture): Promise<string> {
  const agreement = await insertAgreement(db);
  const status = f.status ?? 'published';
  const eraYear = f.eraYear ?? 1982;
  const reconstruction = (f.sourceType ?? 'original_field_recording') === 'community_reconstruction';
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO recordings (
       contributor_id, status, is_demo, title_en, place_name_en, city_en, country_code,
       scene_description_en, category, era_year, captured_from, captured_to, date_confidence,
       source_type, synthetic_disclosure, recorder_name, location, location_precision, license,
       rights_status, rights_holder, attribution_text, speech_consent, duration_ms,
       agreement_version, agreement_accepted_at, submitted_at, published_at, public_place_attested
     ) VALUES (
       $1, $2::recording_status, $3, 'Test recording', 'Test place', $4, 'JP',
       'A busy crossing with traffic and footsteps.', $5::sound_category, $6,
       make_date($7, 1, 1), make_date($7, 12, 31), 'approximate',
       $8::source_type, $9, NULL,
       ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography, $12::location_precision, $13::license,
       'contributor_owns', 'Test Holder', 'Test Holder, CC BY 4.0', 'no_identifiable_speech', 60000,
       $14, now(), now(), CASE WHEN $2 IN ('published', 'unpublished') THEN now() END,
       $12 = 'site_100m'
     ) RETURNING id`,
    [
      f.contributorId,
      status,
      f.isDemo ?? false,
      f.cityEn ?? 'Tokyo',
      f.category ?? 'street',
      eraYear,
      reconstruction ? 2026 : eraYear,
      f.sourceType ?? 'original_field_recording',
      reconstruction ? 'Generated for tests.' : null,
      f.lon ?? 139.7005,
      f.lat ?? 35.6595,
      f.precision ?? 'neighborhood_1km',
      f.license ?? 'cc_by_4',
      agreement,
    ],
  );
  return row!.id;
}
