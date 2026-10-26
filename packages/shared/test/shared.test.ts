import { describe, expect, it } from 'vitest';
import {
  ListQuery,
  PinsQuery,
  cleanPlainText,
  completeProvenance,
  parseBBox,
  snapToPrecision,
  type Provenance,
} from '../src/index.js';

const provenance: Provenance = {
  sourceType: 'original_field_recording',
  dateConfidence: 'exact',
  capturedFrom: '1982-05-01',
  capturedTo: '1982-05-01',
  recorderName: null,
  locationPrecision: 'neighborhood_1km',
  rightsStatus: 'contributor_owns',
  license: 'cc_by_4',
  rightsHolder: 'A. Recorder',
  attribution: 'A. Recorder, CC BY 4.0',
  speechConsent: 'no_identifiable_speech',
  syntheticDisclosure: null,
};

describe('snapToPrecision', () => {
  it('snaps to the 1 km grid', () => {
    expect(snapToPrecision(35.68123, 139.76712, 'neighborhood_1km').lat).toBe(35.68);
  });

  it('never yields an east–west cell narrower than the tier at high latitude', () => {
    // At 60°N a naive 0.01° longitude grid would be ~555 m wide, so 10.009
    // would snap to 10.01. The widened grid (0.02° here) keeps it at 10.
    const a = snapToPrecision(60, 10.0, 'neighborhood_1km');
    const b = snapToPrecision(60, 10.009, 'neighborhood_1km');
    expect(a.lon).toBe(b.lon);
    // Adjacent cells are ≥ ~1.1 km apart east–west: 0.02° × 111 km × cos 60°.
    const next = snapToPrecision(60, 10.011, 'neighborhood_1km');
    expect((next.lon - a.lon) * 111.32 * Math.cos(Math.PI / 3)).toBeGreaterThanOrEqual(1.1);
  });

  it('is idempotent', () => {
    const once = snapToPrecision(48.8566, 2.3522, 'city_10km');
    expect(snapToPrecision(once.lat, once.lon, 'city_10km')).toEqual(once);
  });

  it('clamps to valid ranges', () => {
    const s = snapToPrecision(89.99, 179.99, 'city_10km');
    expect(s.lat).toBeLessThanOrEqual(90);
    expect(s.lon).toBeLessThanOrEqual(180);
  });
});

describe('parseBBox', () => {
  it('parses a valid box', () => {
    expect(parseBBox('-10,35,30,60')).toEqual({ west: -10, south: 35, east: 30, north: 60 });
  });
  it('accepts antimeridian-crossing boxes', () => {
    expect(parseBBox('170,-10,-170,10')).not.toBeNull();
  });
  it.each(['', '1,2,3', '1,2,3,4,5', 'a,b,c,d', '-181,0,0,1', '0,10,1,5', '0,,1,5', 'Infinity,0,1,1'])(
    'rejects %j',
    (raw) => expect(parseBBox(raw)).toBeNull(),
  );
});

describe('query schemas', () => {
  it('rejects a decade that is not a multiple of 10', () => {
    expect(PinsQuery.safeParse({ bbox: '0,0,1,1', decade: '1985' }).success).toBe(false);
  });
  it('rejects unknown categories', () => {
    expect(ListQuery.safeParse({ category: 'shopping' }).success).toBe(false);
  });
  it('caps page size', () => {
    expect(ListQuery.safeParse({ limit: '500' }).success).toBe(false);
    expect(ListQuery.parse({}).limit).toBe(20);
  });
  it('cleans search text', () => {
    expect(ListQuery.parse({ q: '  Tok‮yo\u0000 ' }).q).toBe('Tokyo');
  });
});

describe('cleanPlainText', () => {
  it('keeps RTL text and LRM/RLM marks', () => {
    expect(cleanPlainText('القاهرة‏')).toBe('القاهرة‏');
  });
  it('keeps newlines but strips other controls', () => {
    expect(cleanPlainText('a\nb\u0007c')).toBe('a\nbc');
  });
});

describe('completeProvenance', () => {
  it('accepts complete provenance', () => {
    expect(completeProvenance(provenance)).not.toBeNull();
  });
  it('rejects missing fields', () => {
    const { license: _omit, ...rest } = provenance;
    expect(completeProvenance(rest)).toBeNull();
  });
  it('rejects a reconstruction without a synthetic disclosure', () => {
    expect(completeProvenance({ ...provenance, sourceType: 'community_reconstruction' })).toBeNull();
    expect(
      completeProvenance({ ...provenance, sourceType: 'community_reconstruction', syntheticDisclosure: '  ' }),
    ).toBeNull();
  });
  it('rejects an inverted capture range', () => {
    expect(completeProvenance({ ...provenance, capturedFrom: '1983-01-01' })).toBeNull();
  });
});
