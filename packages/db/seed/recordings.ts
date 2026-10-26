import type { LocationPrecision, SoundCategory } from '@timecapsule/shared';

// Five DEMO rows. None of these is a real recording, historical or otherwise.
// They are all labelled community_reconstruction with an explicit synthetic
// disclosure, and their capture date is the date the placeholder audio was
// generated, so nothing here claims to be authentic audio from its era.

export interface DemoRecording {
  seed: number;
  category: SoundCategory;
  eraYear: number;
  titleEn: string;
  titleLocal: string | null;
  titleLocalLang: string | null;
  placeEn: string;
  placeLocal: string | null;
  cityEn: string;
  cityLocal: string | null;
  countryCode: string;
  lat: number;
  lon: number;
  precision: LocationPrecision;
  sceneEn: string;
  sceneLocal: string | null;
}

export const DEMO_GENERATED_ON = '2026-10-26';
export const DEMO_RECORDER = 'TimeCapsule.fm demo generator';
export const DEMO_TITLE_PREFIX = '[DEMO — synthetic placeholder]';

export function disclosureFor(r: DemoRecording): string {
  return (
    `Procedurally generated noise and tones, created on ${DEMO_GENERATED_ON} as a development placeholder. ` +
    `This is not a recording of ${r.placeEn} and does not represent how it sounded in the ${Math.floor(r.eraYear / 10) * 10}s.`
  );
}

export const DEMO_RECORDINGS: DemoRecording[] = [
  {
    seed: 1982,
    category: 'street',
    eraYear: 1982,
    titleEn: 'Shibuya Crossing',
    titleLocal: '渋谷スクランブル交差点',
    titleLocalLang: 'ja',
    placeEn: 'Shibuya Crossing',
    placeLocal: '渋谷スクランブル交差点',
    cityEn: 'Tokyo',
    cityLocal: '東京',
    countryCode: 'JP',
    lat: 35.6595,
    lon: 139.7005,
    precision: 'neighborhood_1km',
    sceneEn:
      'Placeholder evoking a large pedestrian crossing: a bed of low traffic noise that swells and fades, with a short electronic signal tone every few seconds.',
    sceneLocal: '大きな交差点を想起させるプレースホルダー音：低い交通騒音と、数秒ごとの短い電子信号音。',
  },
  {
    seed: 1995,
    category: 'transit',
    eraYear: 1995,
    titleEn: 'Times Square subway platform',
    titleLocal: null,
    titleLocalLang: null,
    placeEn: 'Times Sq–42 St station',
    placeLocal: null,
    cityEn: 'New York',
    cityLocal: null,
    countryCode: 'US',
    lat: 40.7553,
    lon: -73.987,
    precision: 'site_100m',
    sceneEn:
      'Placeholder evoking an underground platform: a low rumble builds as a train approaches and recedes, followed by a two-note door chime.',
    sceneLocal: null,
  },
  {
    seed: 1970,
    category: 'cafe',
    eraYear: 1970,
    titleEn: 'Latin Quarter café',
    titleLocal: 'Café du Quartier latin',
    titleLocalLang: 'fr',
    placeEn: 'Latin Quarter',
    placeLocal: 'Quartier latin',
    cityEn: 'Paris',
    cityLocal: 'Paris',
    countryCode: 'FR',
    lat: 48.8462,
    lon: 2.3448,
    precision: 'neighborhood_1km',
    sceneEn:
      'Placeholder evoking a café interior: soft, diffuse room noise with occasional sharp clicks standing in for cups and saucers. No voices.',
    sceneLocal:
      "Son de substitution évoquant l'intérieur d'un café : bruit de salle doux, avec quelques clics secs à la place des tasses. Aucune voix.",
  },
  {
    seed: 1965,
    category: 'nature',
    eraYear: 1965,
    titleEn: 'Nile riverbank at dusk',
    titleLocal: 'ضفاف النيل عند الغروب',
    titleLocalLang: 'ar',
    placeEn: 'Nile Corniche',
    placeLocal: 'كورنيش النيل',
    cityEn: 'Cairo',
    cityLocal: 'القاهرة',
    countryCode: 'EG',
    lat: 30.0444,
    lon: 31.2357,
    precision: 'city_10km',
    sceneEn:
      'Placeholder evoking a riverbank: gently moving water noise with a short rising bird-like chirp every few seconds.',
    sceneLocal: 'صوت بديل يوحي بضفة نهر: ضجيج ماء هادئ مع زقزقة قصيرة صاعدة كل بضع ثوانٍ.',
  },
  {
    seed: 1978,
    category: 'industrial',
    eraYear: 1978,
    titleEn: 'Don Valley steelworks',
    titleLocal: null,
    titleLocalLang: null,
    placeEn: 'Lower Don Valley',
    placeLocal: null,
    cityEn: 'Sheffield',
    cityLocal: null,
    countryCode: 'GB',
    lat: 53.3961,
    lon: -1.4316,
    precision: 'neighborhood_1km',
    sceneEn:
      'Placeholder evoking heavy industry: a steady electrical hum with a regular, percussive thump below it.',
    sceneLocal: null,
  },
];
