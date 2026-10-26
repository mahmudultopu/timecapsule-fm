// Single source of truth for every enum. The SQL enums in
// packages/db/migrations must list the same values in the same order;
// packages/db/test/enums.test.ts fails if they drift.

export const RECORDING_STATUSES = [
  'draft',
  'processing',
  'processing_failed',
  'ready',
  'pending_review',
  'published',
  'rejected',
  'unpublished',
] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

export const SOURCE_TYPES = [
  'original_field_recording',
  'archival_donation',
  'licensed_archive',
  'community_reconstruction',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const DATE_CONFIDENCES = ['exact', 'approximate', 'estimated'] as const;
export type DateConfidence = (typeof DATE_CONFIDENCES)[number];

export const LOCATION_PRECISIONS = ['site_100m', 'neighborhood_1km', 'city_10km'] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export const SOUND_CATEGORIES = ['street', 'transit', 'cafe', 'nature', 'industrial'] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

export const LICENSES = [
  'cc0',
  'cc_by_4',
  'cc_by_sa_4',
  'cc_by_nc_4',
  'cc_by_nc_sa_4',
  'archive_permission',
] as const;
export type License = (typeof LICENSES)[number];

export const RIGHTS_STATUSES = [
  'contributor_owns',
  'holder_permission',
  'licensed_from_archive',
  'public_domain',
  'disputed',
] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export const SPEECH_CONSENTS = ['no_identifiable_speech', 'all_speakers_consented'] as const;
export type SpeechConsent = (typeof SPEECH_CONSENTS)[number];

export const USER_ROLES = ['contributor', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Decades the explorer offers. Earliest practical field recordings are ~1890s. */
export const MIN_DECADE = 1890;
export const MAX_DECADE = 2020;
export const DECADES: readonly number[] = Array.from(
  { length: (MAX_DECADE - MIN_DECADE) / 10 + 1 },
  (_, i) => MIN_DECADE + i * 10,
);
