// Usage: DATABASE_MIGRATOR_URL=postgres://... pnpm db:migrate
// Connects as the schema owner (never the API's role).
import pg from 'pg';
import { migrate } from '../migrate.js';

const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) {
  console.error('DATABASE_MIGRATOR_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const result = await migrate({
    exec: async (sql) => {
      await client.query(sql);
    },
    query: async <T>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as T[],
  });
  console.log(`applied: ${result.applied.join(', ') || '(none)'}; up to date: ${result.skipped.length}`);
} finally {
  await client.end();
}
