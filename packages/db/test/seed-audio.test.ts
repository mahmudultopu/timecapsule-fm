import { Peaks, SOUND_CATEGORIES, computePeaks } from '@timecapsule/shared';
import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, encodeWav, synthesize } from '../seed/audio.js';
import { DEMO_RECORDINGS, DEMO_TITLE_PREFIX, disclosureFor } from '../seed/recordings.js';

describe('placeholder audio', () => {
  it.each(SOUND_CATEGORIES)('synthesises %s within [-1, 1] and deterministically', (category) => {
    const a = synthesize(category, 2, 42);
    const b = synthesize(category, 2, 42);
    expect(a).toEqual(b);
    expect(a.length).toBe(2 * SAMPLE_RATE);
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('encodes a metadata-free PCM WAV', () => {
    const wav = encodeWav(synthesize('cafe', 1, 1));
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(SAMPLE_RATE * 2);
    expect(wav.toString('latin1')).not.toMatch(/LIST|INFO|bext|iXML|id3 /);
  });

  it('produces peaks matching the public schema', () => {
    const peaks = computePeaks(synthesize('street', 5, 7), SAMPLE_RATE);
    expect(Peaks.parse(peaks).data.length).toBeLessThanOrEqual(800);
  });
});

describe('demo seed rows', () => {
  it('are exactly five and cover every category', () => {
    expect(DEMO_RECORDINGS).toHaveLength(5);
    expect(new Set(DEMO_RECORDINGS.map((r) => r.category))).toEqual(new Set(SOUND_CATEGORIES));
  });

  it('disclose that they are synthetic', () => {
    for (const r of DEMO_RECORDINGS) {
      expect(disclosureFor(r)).toMatch(/not a recording of/);
      expect(DEMO_TITLE_PREFIX).toMatch(/synthetic/);
    }
  });
});
