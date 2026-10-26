import { describe, expect, it } from 'vitest';
import {
  ModerationDecisionInput,
  SubmissionFields,
  TakedownInput,
  computePeaks,
  missingForSubmit,
  sniffAudioFormat,
  type SubmissionFields as Fields,
} from '../src/index.js';

const bytes = (...xs: (number | string)[]) =>
  Uint8Array.from(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe('sniffAudioFormat', () => {
  it.each([
    ['wav', bytes('RIFF', 0, 0, 0, 0, 'WAVE')],
    ['flac', bytes('fLaC')],
    ['ogg', bytes('OggS')],
    ['mp3', bytes('ID3', 4, 0)],
    ['mp3', bytes(0xff, 0xfb, 0x90, 0x00)],
  ])('recognises %s', (format, head) => expect(sniffAudioFormat(head)).toBe(format));

  it.each([
    ['PNG', bytes(0x89, 'PNG')],
    ['ZIP', bytes('PK', 3, 4)],
    ['AVI in RIFF', bytes('RIFF', 0, 0, 0, 0, 'AVI ')],
    ['MPEG layer II frame', bytes(0xff, 0xfd)],
    ['empty', bytes()],
  ])('rejects %s', (_name, head) => expect(sniffAudioFormat(head)).toBeNull());
});

describe('computePeaks', () => {
  it('normalises 16-bit PCM to 0..1', () => {
    const p = computePeaks(Int16Array.from([0, 16384, -32768, 100]), 8000, 2);
    expect(p.data).toEqual([0.5, 1]);
    expect(p.samplesPerPeak).toBe(2);
  });
});

const complete: Fields = {
  titleEn: 'Station',
  placeNameEn: 'Platform 2',
  cityEn: 'Leeds',
  countryCode: 'GB',
  sceneDescriptionEn: 'Trains arriving and departing on a wet evening.',
  category: 'transit',
  eraYear: 1994,
  capturedFrom: '1994-03-01',
  capturedTo: '1994-03-01',
  dateConfidence: 'exact',
  sourceType: 'original_field_recording',
  location: { lat: 53.79, lon: -1.54 },
  locationPrecision: 'neighborhood_1km',
  license: 'cc_by_4',
  rightsStatus: 'contributor_owns',
  rightsHolder: 'Me',
  attribution: 'Me, CC BY 4.0',
  speechConsent: 'no_identifiable_speech',
};

describe('missingForSubmit', () => {
  it('is empty for a complete submission with audio', () => {
    expect(missingForSubmit(complete, 1000)).toEqual([]);
  });
  it('lists missing fields and audio', () => {
    expect(missingForSubmit({ ...complete, license: null }, null)).toEqual(['license', 'audio']);
  });
  it('requires a disclosure for reconstructions', () => {
    expect(missingForSubmit({ ...complete, sourceType: 'community_reconstruction' }, 1)).toContain(
      'syntheticDisclosure',
    );
  });
  it('flags authentic recordings whose era is outside the capture dates', () => {
    expect(missingForSubmit({ ...complete, eraYear: 1982 }, 1)).toContain('eraMatchesCapture');
  });
  it('requires the public-place attestation for ~100 m precision', () => {
    expect(missingForSubmit({ ...complete, locationPrecision: 'site_100m' }, 1)).toContain('publicPlaceAttested');
  });
});

describe('input schemas', () => {
  it('lets contributors save partial drafts but not claim disputed rights', () => {
    expect(SubmissionFields.safeParse({ titleEn: 'Draft' }).success).toBe(true);
    expect(SubmissionFields.safeParse({ rightsStatus: 'disputed' }).success).toBe(false);
  });
  it('rejects too-short scene descriptions', () => {
    expect(SubmissionFields.safeParse({ sceneDescriptionEn: 'Noise.' }).success).toBe(false);
  });
  it('requires a complete checklist to approve and a reason to reject', () => {
    const checklist = { audioQuality: true, rights: true, location: true, noPrivateSpeech: false };
    expect(ModerationDecisionInput.safeParse({ decision: 'approve', checklist }).success).toBe(false);
    expect(ModerationDecisionInput.safeParse({ decision: 'reject', checklist, reason: 'no' }).success).toBe(false);
    expect(
      ModerationDecisionInput.safeParse({ decision: 'reject', checklist, reason: 'A child is identifiable.' }).success,
    ).toBe(true);
  });
  it('requires a good-faith statement on takedowns', () => {
    const base = { claimantName: 'A', claimantEmail: 'a@b.co', basis: 'copyright', statement: 'x'.repeat(30) };
    expect(TakedownInput.safeParse({ ...base, goodFaith: false }).success).toBe(false);
    expect(TakedownInput.safeParse({ ...base, goodFaith: true }).success).toBe(true);
  });
});
