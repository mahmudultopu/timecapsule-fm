// Publishes a new contributor agreement and supersedes the current one.
//   DATABASE_MIGRATOR_URL=... pnpm --filter @timecapsule/db agreement:publish 2026-11-01 ./agreement.md
//
// Submissions store the version they accepted, so old versions are kept.
// Contributors with unsubmitted drafts are asked to accept the new version.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const [version, path] = process.argv.slice(2);
if (!version || !/^\d{4}-\d{2}-\d{2}$/.test(version) || !path) {
  console.error('usage: agreement:publish <YYYY-MM-DD> <file.md>');
  process.exit(1);
}
const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) {
  console.error('DATABASE_MIGRATOR_URL is required');
  process.exit(1);
}

const body = await readFile(path, 'utf8');
if (/DRAFT/i.test(body.slice(0, 400))) {
  console.error('Refusing to publish: the text still says DRAFT. Use the legally reviewed version.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE contributor_agreements SET superseded_at = now() WHERE superseded_at IS NULL');
  await client.query(
    `INSERT INTO contributor_agreements (version, body_md, body_sha256, is_draft, effective_from)
     VALUES ($1, $2, $3, false, now())`,
    [version, body, createHash('sha256').update(body).digest('hex')],
  );
  await client.query('COMMIT');
  console.log(`agreement ${version} is now current`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
