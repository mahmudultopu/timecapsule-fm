-- Extensions, application roles, request-context helpers and enums.
-- Migrations are forward-only. To undo something, write a new migration.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Group roles (NOLOGIN). Real login users are created by ops and granted
-- membership, e.g. `CREATE ROLE tc_api_login LOGIN PASSWORD ... IN ROLE tc_api`.
-- None of these roles own tables or have BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tc_api') THEN
    CREATE ROLE tc_api NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tc_worker') THEN
    CREATE ROLE tc_worker NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tc_auth') THEN
    CREATE ROLE tc_auth NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;

-- Keep in sync with packages/shared/src/enums.ts (checked by test/enums.test.ts).
CREATE TYPE recording_status AS ENUM (
  'draft', 'processing', 'processing_failed', 'ready',
  'pending_review', 'published', 'rejected', 'unpublished'
);
CREATE TYPE source_type AS ENUM (
  'original_field_recording', 'archival_donation', 'licensed_archive', 'community_reconstruction'
);
CREATE TYPE date_confidence AS ENUM ('exact', 'approximate', 'estimated');
CREATE TYPE location_precision AS ENUM ('site_100m', 'neighborhood_1km', 'city_10km');
CREATE TYPE sound_category AS ENUM ('street', 'transit', 'cafe', 'nature', 'industrial');
CREATE TYPE license AS ENUM (
  'cc0', 'cc_by_4', 'cc_by_sa_4', 'cc_by_nc_4', 'cc_by_nc_sa_4', 'archive_permission'
);
CREATE TYPE rights_status AS ENUM (
  'contributor_owns', 'holder_permission', 'licensed_from_archive', 'public_domain', 'disputed'
);
CREATE TYPE speech_consent AS ENUM ('no_identifiable_speech', 'all_speakers_consented');
CREATE TYPE user_role AS ENUM ('contributor', 'moderator', 'admin');
CREATE TYPE audio_asset_kind AS ENUM ('master', 'preview', 'peaks');
CREATE TYPE upload_status AS ENUM ('pending', 'received', 'processing', 'processed', 'rejected', 'expired');
CREATE TYPE moderation_decision AS ENUM ('approve', 'reject');
CREATE TYPE takedown_basis AS ENUM ('copyright', 'privacy', 'other');
CREATE TYPE takedown_status AS ENUM ('received', 'actioned', 'declined');
CREATE TYPE notification_kind AS ENUM (
  'submission_published', 'submission_rejected', 'recording_unpublished', 'processing_failed'
);

-- The API sets app.user_id with set_config(..., is_local => true) at the start
-- of every request transaction. Empty / unset means anonymous.
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- pg_has_role() is always true for superusers, so exclude them explicitly:
-- a maintenance session must not be mistaken for an application role.
CREATE FUNCTION app.acts_as(role_name name) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT pg_has_role(current_user, role_name, 'MEMBER')
       AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  $$;

CREATE FUNCTION app.is_worker() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app.acts_as('tc_worker') $$;

CREATE FUNCTION app.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
