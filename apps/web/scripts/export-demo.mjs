// Regenerates the demo-mode catalog and audio (see src/lib/demo/handlers.ts).
// Deterministic, so the committed catalog.json never changes unless the
// demo recordings themselves do.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const catalog = fileURLToPath(new URL('../src/lib/demo/catalog.json', import.meta.url));
const result = spawnSync('pnpm', ['--filter', '@timecapsule/db', 'demo:export', publicDir, catalog], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
