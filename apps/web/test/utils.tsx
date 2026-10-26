import { render } from '@testing-library/react';
import type { RecordingDetail } from '@timecapsule/shared';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import en from '../messages/en.json';

export function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

export const recording: RecordingDetail = {
  id: '6f0b7c4e-2d2a-4c51-9b7c-1a2b3c4d5e6f',
  title: { en: 'Shibuya Crossing', local: '渋谷スクランブル交差点', localLang: 'ja' },
  place: { nameEn: 'Shibuya Crossing', nameLocal: '渋谷', cityEn: 'Tokyo', cityLocal: '東京', countryCode: 'JP' },
  category: 'street',
  eraYear: 1982,
  decade: 1980,
  durationMs: 75_000,
  location: { lat: 35.66, lon: 139.7, precision: 'neighborhood_1km' },
  provenance: {
    sourceType: 'original_field_recording',
    dateConfidence: 'approximate',
    capturedFrom: '1982-01-01',
    capturedTo: '1982-12-31',
    recorderName: null,
    locationPrecision: 'neighborhood_1km',
    rightsStatus: 'contributor_owns',
    license: 'cc_by_4',
    rightsHolder: 'A. Recordist',
    attribution: 'A. Recordist, CC BY 4.0',
    speechConsent: 'no_identifiable_speech',
    syntheticDisclosure: null,
  },
  contributor: { displayName: 'A. Recordist' },
  isDemo: false,
  publishedAt: '2026-10-01T00:00:00.000Z',
  sceneDescription: { en: 'Traffic and footsteps at a busy crossing.', local: null },
};
