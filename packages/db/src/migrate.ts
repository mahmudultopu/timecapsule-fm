import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minimal surface shared by node-postgres clients and PGlite. */
export interface SqlRunner {
  /** Runs one or more statements with no parameters. */
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 7_270_001;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies pending forward-only migrations in filename order, each in its own
 * transaction. Refuses to run if an already-applied file has been edited.
 */
export async function migrate(db: SqlRunner, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => FILE_PATTERN.test(f)).sort();
  const result: MigrationResult = { applied: [], skipped: [] };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    const rows = await db.query<{ name: string; sha256: string }>(
      'SELECT name, sha256 FROM public.schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.name, r.sha256]));

    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      const sha = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);
      if (previous) {
        if (previous !== sha) {
          throw new Error(`Migration ${file} was modified after being applied. Write a new migration instead.`);
        }
        result.skipped.push(file);
        continue;
      }
      await db.exec('BEGIN');
      try {
        await db.exec(sql);
        await db.query('INSERT INTO public.schema_migrations (name, sha256) VALUES ($1, $2)', [file, sha]);
        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      result.applied.push(file);
    }
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
  return result;
}
