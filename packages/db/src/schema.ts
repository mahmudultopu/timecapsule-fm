import type { ColumnType, Generated } from 'kysely';
import type {
  DateConfidence,
  License,
  LocationPrecision,
  RecordingStatus,
  RightsStatus,
  SoundCategory,
  SourceType,
  SpeechConsent,
  UserRole,
} from '@timecapsule/shared';

// Hand-maintained to match migrations/. DATE columns are returned as
// 'YYYY-MM-DD' strings (see the type parsers in client.ts / testing.ts).

type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** Timestamp with a database default (optional on insert). */
type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type ReadOnly<T> = ColumnType<T, never, never>;

export interface UsersTable {
  id: Generated<string>;
  role: Generated<UserRole>;
  display_name: string | null;
  age_attested_at: Timestamp | null;
  email_notifications: Generated<boolean>;
  disabled_at: Timestamp | null;
}

export interface SessionsTable {
  userId: string;
  expires: Timestamp;
  sessionToken: string;
}

export interface ContributorAgreementsTable {
  version: string;
  body_md: string;
  body_sha256: string;
  is_draft: Generated<boolean>;
  effective_from: Timestamp;
  superseded_at: Timestamp | null;
}

export interface RecordingsTable {
  id: Generated<string>;
  contributor_id: string;
  status: Generated<RecordingStatus>;
  is_demo: Generated<boolean>;
  title_en: string | null;
  title_local: string | null;
  title_local_lang: string | null;
  place_name_en: string | null;
  place_name_local: string | null;
  city_en: string | null;
  city_local: string | null;
  country_code: string | null;
  scene_description_en: string | null;
  scene_description_local: string | null;
  category: SoundCategory | null;
  era_year: number | null;
  decade: ReadOnly<number | null>;
  captured_from: string | null;
  captured_to: string | null;
  date_confidence: DateConfidence | null;
  source_type: SourceType | null;
  synthetic_disclosure: string | null;
  recorder_name: string | null;
  /** geography(Point). Write with sql`ST_MakePoint(...)`; read with ST_X/ST_Y. */
  location: unknown;
  location_precision: LocationPrecision | null;
  license: License | null;
  rights_status: RightsStatus | null;
  rights_holder: string | null;
  attribution_text: string | null;
  speech_consent: SpeechConsent | null;
  public_place_attested: Generated<boolean>;
  duration_ms: number | null;
  agreement_version: string | null;
  agreement_accepted_at: Timestamp | null;
  search_text: ReadOnly<string>;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
  submitted_at: Timestamp | null;
  published_at: Timestamp | null;
}

export interface AudioAssetsTable {
  id: Generated<string>;
  recording_id: string;
  kind: 'master' | 'preview' | 'peaks';
  storage_key: string;
  mime_type: string;
  byte_size: ColumnType<number, number | bigint, number | bigint>;
  sha256: string;
  codec: string | null;
  sample_rate: number | null;
  channels: number | null;
  created_at: DefaultTimestamp;
}

export type UploadStatus = 'pending' | 'received' | 'processing' | 'processed' | 'rejected' | 'expired';

export interface UploadsTable {
  id: Generated<string>;
  recording_id: string;
  user_id: string;
  quarantine_key: string;
  declared_bytes: ColumnType<number, number, number>;
  declared_format: 'wav' | 'flac' | 'mp3' | 'ogg';
  status: Generated<UploadStatus>;
  rejection_code: string | null;
  original_sha256: string | null;
  created_at: DefaultTimestamp;
  expires_at: Timestamp;
  processed_at: Timestamp | null;
}

export interface ModerationReviewsTable {
  id: Generated<string>;
  recording_id: string;
  moderator_id: string;
  decision: 'approve' | 'reject';
  chk_audio_quality: boolean;
  chk_rights: boolean;
  chk_location: boolean;
  chk_no_private_speech: boolean;
  reason: string | null;
  created_at: DefaultTimestamp;
}

export type TakedownStatus = 'received' | 'actioned' | 'declined';

export interface TakedownRequestsTable {
  id: Generated<string>;
  recording_id: string | null;
  target_url: string | null;
  claimant_name: string;
  claimant_email: string;
  basis: 'copyright' | 'privacy' | 'other';
  statement: string;
  good_faith_attested: boolean;
  status: Generated<TakedownStatus>;
  received_at: DefaultTimestamp;
  resolved_by: string | null;
  resolved_at: Timestamp | null;
  resolution_note: string | null;
}

export type NotificationKind =
  | 'submission_published'
  | 'submission_rejected'
  | 'recording_unpublished'
  | 'processing_failed';

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  recording_id: string | null;
  kind: NotificationKind;
  message: string;
  created_at: DefaultTimestamp;
  read_at: Timestamp | null;
  emailed_at: Timestamp | null;
  email_attempts: Generated<number>;
}

export interface AuditLogTable {
  id: Generated<number>;
  at: DefaultTimestamp;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: ColumnType<unknown, string, string>;
  ip_hmac: string | null;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  contributor_agreements: ContributorAgreementsTable;
  recordings: RecordingsTable;
  audio_assets: AudioAssetsTable;
  uploads: UploadsTable;
  moderation_reviews: ModerationReviewsTable;
  takedown_requests: TakedownRequestsTable;
  notifications: NotificationsTable;
  audit_log: AuditLogTable;
}
