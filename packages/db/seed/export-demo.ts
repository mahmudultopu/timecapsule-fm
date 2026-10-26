// Exports the demo recordings for the web app's static demo mode (used for
// deployments without the API, database and storage, e.g. Vercel previews).
//
//   pnpm --filter @timecapsule/db demo:export <web-public-dir> <catalog.json>
//
// Writes one WAV + peaks file per recording into <web-public-dir>/demo/ and
// the public recording details (same shape the API returns) to <catalog.json>.
// Deterministic: running it twice produces identical files.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RecordingDetail, computePeaks, snapToPrecision } from '@timecapsule/shared';
import { SAMPLE_RATE, encodeWav, synthesize } from './audio.js';
import {
  DEMO_GENERATED_ON,
  DEMO_RECORDER,
  DEMO_RECORDINGS,
  DEMO_TITLE_PREFIX,
  disclosureFor,
} from './recordings.js';

const DEMO_SECONDS = 20;
const [publicDir, catalogPath] = process.argv.slice(2);
if (!publicDir || !catalogPath) {
  console.error('usage: demo:export <web-public-dir> <catalog.json>');
  process.exit(1);
}

/** A stable, valid UUIDv4 derived from a name, so URLs don't change between builds. */
function stableUuid(name: string): string {
  const h = createHash('sha256').update(`timecapsule-demo:${name}`).digest('hex').split('');
  h[12] = '4';
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const outDir = join(publicDir, 'demo');
await mkdir(outDir, { recursive: true });

const catalog = [];
for (const r of DEMO_RECORDINGS) {
  const slug = `${r.cityEn}-${r.eraYear}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const samples = synthesize(r.category, DEMO_SECONDS, r.seed);
  await writeFile(join(outDir, `${slug}.wav`), encodeWav(samples));
  await writeFile(join(outDir, `${slug}.peaks.json`), JSON.stringify(computePeaks(samples, SAMPLE_RATE)));

  const location = snapToPrecision(r.lat, r.lon, r.precision);
  // Validated against the same schema the API uses, so the demo can't drift.
  const detail = RecordingDetail.parse({
    id: stableUuid(slug),
    title: {
      en: `${DEMO_TITLE_PREFIX} ${r.titleEn}`,
      local: r.titleLocal ? `${DEMO_TITLE_PREFIX} ${r.titleLocal}` : null,
      localLang: r.titleLocalLang,
    },
    place: { nameEn: r.placeEn, nameLocal: r.placeLocal, cityEn: r.cityEn, cityLocal: r.cityLocal, countryCode: r.countryCode },
    category: r.category,
    eraYear: r.eraYear,
    decade: Math.floor(r.eraYear / 10) * 10,
    durationMs: DEMO_SECONDS * 1000,
    location: { ...location, precision: r.precision },
    provenance: {
      sourceType: 'community_reconstruction',
      dateConfidence: 'exact',
      capturedFrom: DEMO_GENERATED_ON,
      capturedTo: DEMO_GENERATED_ON,
      recorderName: DEMO_RECORDER,
      locationPrecision: r.precision,
      rightsStatus: 'contributor_owns',
      license: 'cc0',
      rightsHolder: 'TimeCapsule.fm',
      attribution: 'Synthetic placeholder audio by TimeCapsule.fm (CC0)',
      speechConsent: 'no_identifiable_speech',
      syntheticDisclosure: disclosureFor(r),
    },
    contributor: { displayName: 'TimeCapsule.fm demo' },
    isDemo: true,
    publishedAt: `${DEMO_GENERATED_ON}T00:00:00.000Z`,
    sceneDescription: { en: r.sceneEn, local: r.sceneLocal },
  });
  catalog.push({ ...detail, audioFile: `/demo/${slug}.wav`, peaksFile: `/demo/${slug}.peaks.json` });
}

await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`exported ${catalog.length} demo recordings`);
