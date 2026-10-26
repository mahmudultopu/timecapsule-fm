// Copies MapLibre's self-contained worker into public/ so it is served from
// our own origin (CSP worker-src 'self'). Bundling breaks MapLibre's default
// import.meta.url-relative worker lookup, so the app sets the URL explicitly.
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('maplibre-gl/package.json'));
const { version } = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
const outDir = new URL('../public/vendor/', import.meta.url);
await mkdir(outDir, { recursive: true });
await copyFile(join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), new URL(`maplibre-gl-worker-${version}.mjs`, outDir));
console.log(`copied maplibre-gl worker ${version}`);
