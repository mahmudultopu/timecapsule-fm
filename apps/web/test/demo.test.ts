import { PinCollection, Playback, RecordingDetail, RecordingPage } from '@timecapsule/shared';
import { describe, expect, it } from 'vitest';
import { handleDemoRequest } from '@/lib/demo/handlers';
import catalog from '@/lib/demo/catalog.json';

const get = (path: string) => {
  const url = new URL(path, 'https://demo.test');
  return handleDemoRequest('GET', url.pathname, url.searchParams, 'https://demo.test');
};

describe('demo mode', () => {
  it('serves every demo recording as a labelled, complete reconstruction', () => {
    for (const entry of catalog) {
      const r = RecordingDetail.parse(get(`/v1/recordings/${entry.id}`).body);
      expect(r.isDemo).toBe(true);
      expect(r.provenance.sourceType).toBe('community_reconstruction');
      expect(r.provenance.syntheticDisclosure).toMatch(/not a recording of/);
    }
  });

  it('filters the list and the map like the API', () => {
    const all = RecordingPage.parse(get('/v1/recordings').body);
    expect(all.items).toHaveLength(5);
    expect(RecordingPage.parse(get('/v1/recordings?decade=1990').body).items.map((r) => r.place.cityEn)).toEqual(['New York']);
    expect(RecordingPage.parse(get(`/v1/recordings?q=${encodeURIComponent('東京')}`).body).items).toHaveLength(1);
    const europe = PinCollection.parse(get('/v1/recordings/pins?bbox=-10,35,30,60').body);
    expect(europe.features.map((f) => f.properties.eraYear).sort()).toEqual([1970, 1978]);
  });

  it('points playback at same-origin static files', () => {
    const p = Playback.parse(get(`/v1/recordings/${catalog[0]!.id}/playback`).body);
    expect(p.audioUrl).toMatch(/^https:\/\/demo\.test\/demo\/.+\.wav$/);
  });

  it('refuses anything that writes, and unknown routes', () => {
    expect(handleDemoRequest('POST', '/v1/submissions', new URLSearchParams(), 'x').status).toBe(503);
    expect(get('/v1/moderation/queue').status).toBe(404);
    expect(get('/v1/recordings/not-a-uuid').status).toBe(400);
  });
});
