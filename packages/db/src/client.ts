import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

// DATE -> 'YYYY-MM-DD' string. The pg default builds a Date in the server's
// local time zone, which silently shifts calendar dates.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

export function createDb(connectionString: string, opts: { max?: number } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
    application_name: 'timecapsule',
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export interface RequestContext {
  /** Authenticated user, or null for anonymous requests. */
  userId: string | null;
}

/**
 * Runs `fn` in a transaction whose RLS context is the given user. Every
 * request-scoped query must go through this; `set_config(..., true)` scopes
 * the setting to the transaction so it can't leak to the next pool user.
 */
export function withContext<T>(db: Db, ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`.execute(tx);
    return fn(tx);
  });
}
