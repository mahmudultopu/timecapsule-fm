-- Recordings, their audio assets, uploads and the contributor agreement.

CREATE TABLE contributor_agreements (
  version        text PRIMARY KEY CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-draft)?$'),
  body_md        text NOT NULL,
  body_sha256    text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  is_draft       boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL,
  superseded_at  timestamptz
);
-- At most one current agreement.
CREATE UNIQUE INDEX contributor_agreements_current_uidx
  ON contributor_agreements ((true)) WHERE superseded_at IS NULL;

-- Snap a point onto the grid for its precision tier. The longitude step is
-- widened by 1/cos(lat) so cells are never narrower than the tier promises.
-- Mirrors snapToPrecision() in packages/shared/src/geo.ts. floor(x + 0.5)
-- matches JavaScript's Math.round.
CREATE FUNCTION app.snap_location(p geography, prec location_precision) RETURNS geography
  LANGUAGE plpgsql IMMUTABLE
  AS $$
  DECLARE
    lat_step double precision;
    lon_step double precision;
    lat double precision;
    lon double precision;
  BEGIN
    IF p IS NULL THEN
      RETURN NULL;
    END IF;
    lat_step := CASE prec
      WHEN 'site_100m' THEN 0.001
      WHEN 'neighborhood_1km' THEN 0.01
      ELSE 0.1
    END;
    lat := least(90, greatest(-90, floor(ST_Y(p::geometry) / lat_step + 0.5) * lat_step));
    lon_step := lat_step / greatest(cos(radians(lat)), 0.01);
    lon := least(180, greatest(-180, floor(ST_X(p::geometry) / lon_step + 0.5) * lon_step));
    RETURN ST_SetSRID(ST_MakePoint(round(lon::numeric, 6), round(lat::numeric, 6)), 4326)::geography;
  END
  $$;

CREATE TABLE recordings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_id          uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status                  recording_status NOT NULL DEFAULT 'draft',
  is_demo                 boolean NOT NULL DEFAULT false,

  title_en                text CHECK (char_length(title_en) BETWEEN 1 AND 160),
  title_local             text CHECK (char_length(title_local) BETWEEN 1 AND 160),
  title_local_lang        text CHECK (title_local_lang ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  place_name_en           text CHECK (char_length(place_name_en) BETWEEN 1 AND 160),
  place_name_local        text CHECK (char_length(place_name_local) BETWEEN 1 AND 160),
  city_en                 text CHECK (char_length(city_en) BETWEEN 1 AND 120),
  city_local              text CHECK (char_length(city_local) BETWEEN 1 AND 120),
  country_code            char(2) CHECK (country_code ~ '^[A-Z]{2}$'),
  scene_description_en    text CHECK (char_length(scene_description_en) BETWEEN 20 AND 2000),
  scene_description_local text CHECK (char_length(scene_description_local) <= 2000),
  category                sound_category,

  -- The year the sound represents (drives the decade filter) ...
  era_year                smallint CHECK (era_year BETWEEN 1890 AND 2029),
  decade                  smallint GENERATED ALWAYS AS ((era_year / 10) * 10) STORED,
  -- ... versus when the audio was actually captured.
  captured_from           date,
  captured_to             date,
  date_confidence         date_confidence,

  source_type             source_type,
  synthetic_disclosure    text CHECK (char_length(synthetic_disclosure) <= 2000),
  recorder_name           text CHECK (char_length(recorder_name) BETWEEN 1 AND 160), -- NULL = unknown
  location                geography (Point, 4326),
  location_precision      location_precision,
  license                 license,
  rights_status           rights_status,
  rights_holder           text CHECK (char_length(rights_holder) BETWEEN 1 AND 200),
  attribution_text        text CHECK (char_length(attribution_text) BETWEEN 1 AND 300),
  speech_consent          speech_consent,

  duration_ms             integer CHECK (duration_ms > 0 AND duration_ms <= 1800000),
  agreement_version       text REFERENCES contributor_agreements (version),
  agreement_accepted_at   timestamptz,

  search_text             text GENERATED ALWAYS AS (lower(
                            coalesce(city_en, '') || ' ' || coalesce(city_local, '') || ' ' ||
                            coalesce(place_name_en, '') || ' ' || coalesce(place_name_local, '')
                          )) STORED,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  submitted_at            timestamptz,
  published_at            timestamptz,

  CONSTRAINT captured_range CHECK (captured_from <= captured_to),
  CONSTRAINT precision_with_location CHECK ((location IS NULL) = (location_precision IS NULL)),
  CONSTRAINT local_title_has_lang CHECK (title_local IS NULL OR title_local_lang IS NOT NULL),

  -- Reconstructions must say how they were made.
  CONSTRAINT reconstruction_disclosed CHECK (
    source_type IS DISTINCT FROM 'community_reconstruction'
    OR nullif(btrim(synthetic_disclosure), '') IS NOT NULL
  ),
  -- Anything not labelled a reconstruction must have been captured in the
  -- year it claims to represent. This is what stops a 2026 recording being
  -- presented as "Tokyo 1982".
  CONSTRAINT authentic_era_matches_capture CHECK (
    source_type IS NULL OR source_type = 'community_reconstruction'
    OR era_year IS NULL OR captured_from IS NULL OR captured_to IS NULL
    OR era_year BETWEEN extract(year FROM captured_from) AND extract(year FROM captured_to)
  ),
  -- Nothing reaches review or the public without complete provenance.
  CONSTRAINT complete_when_submitted CHECK (
    status IN ('draft', 'processing', 'processing_failed', 'ready') OR (
      title_en IS NOT NULL AND place_name_en IS NOT NULL AND city_en IS NOT NULL
      AND country_code IS NOT NULL AND scene_description_en IS NOT NULL AND category IS NOT NULL
      AND era_year IS NOT NULL AND captured_from IS NOT NULL AND captured_to IS NOT NULL
      AND date_confidence IS NOT NULL AND source_type IS NOT NULL AND location IS NOT NULL
      AND license IS NOT NULL AND rights_status IS NOT NULL AND rights_holder IS NOT NULL
      AND attribution_text IS NOT NULL AND speech_consent IS NOT NULL AND duration_ms IS NOT NULL
      AND agreement_version IS NOT NULL AND agreement_accepted_at IS NOT NULL
      AND submitted_at IS NOT NULL
    )
  ),
  CONSTRAINT published_not_disputed CHECK (status <> 'published' OR rights_status <> 'disputed'),
  CONSTRAINT published_has_timestamp CHECK (status <> 'published' OR published_at IS NOT NULL)
);

-- Map viewports are planar lon/lat boxes, so pins are queried with
-- `location::geometry && ST_MakeEnvelope(...)`; index that expression.
CREATE INDEX recordings_published_location_gix ON recordings USING gist ((location::geometry))
  WHERE status = 'published';
CREATE INDEX recordings_published_filters_idx ON recordings (decade, category, license)
  WHERE status = 'published';
CREATE INDEX recordings_published_order_idx ON recordings (published_at DESC, id DESC)
  WHERE status = 'published';
CREATE INDEX recordings_search_trgm_idx ON recordings USING gin (search_text gin_trgm_ops)
  WHERE status = 'published';
CREATE INDEX recordings_contributor_idx ON recordings (contributor_id, updated_at DESC);
CREATE INDEX recordings_review_queue_idx ON recordings (submitted_at)
  WHERE status = 'pending_review';

CREATE FUNCTION app.recordings_snap() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    -- The raw coordinate never reaches disk: it is replaced before the row is written.
    NEW.location := app.snap_location(NEW.location, NEW.location_precision);
    RETURN NEW;
  END
  $$;
CREATE TRIGGER recordings_snap
  BEFORE INSERT OR UPDATE OF location, location_precision ON recordings
  FOR EACH ROW EXECUTE FUNCTION app.recordings_snap();

CREATE TRIGGER recordings_touch
  BEFORE UPDATE ON recordings
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- State machine and column-ownership rules, enforced per actor.
--   worker    : processing -> ready | processing_failed; may set duration_ms only
--   owner     : edits content only while draft/processing/ready/processing_failed/rejected;
--               may (re)upload, submit, or withdraw; can never publish
--   moderator : status-only changes, and only with a matching review row
-- Roles that bypass RLS (table owner / superuser: migrations, seeds,
-- maintenance) are not restricted here.
CREATE FUNCTION app.recordings_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    actor text;
    me uuid := app.current_user_id();
    transition text := OLD.status || '->' || NEW.status;
    -- Generated columns are excluded too: they are not yet computed in a
    -- BEFORE trigger, and are derived from content columns anyway.
    system_cols text[] := ARRAY[
      'status', 'updated_at', 'submitted_at', 'published_at', 'duration_ms',
      'agreement_version', 'agreement_accepted_at', 'decade', 'search_text'
    ];
    content_changed boolean;
  BEGIN
    IF NEW.id <> OLD.id OR NEW.contributor_id <> OLD.contributor_id
       OR NEW.is_demo <> OLD.is_demo OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'immutable recording column changed' USING ERRCODE = 'check_violation';
    END IF;

    IF app.is_worker() THEN
      actor := 'worker';
    ELSIF me IS NOT NULL AND OLD.contributor_id = me THEN
      actor := 'owner';
    ELSIF me IS NOT NULL AND app.is_moderator() THEN
      actor := 'moderator';
    ELSIF app.acts_as('tc_api') THEN
      RAISE EXCEPTION 'no actor for recording update' USING ERRCODE = 'insufficient_privilege';
    ELSE
      RETURN NEW; -- maintenance role
    END IF;

    content_changed :=
      (to_jsonb(NEW) - system_cols) IS DISTINCT FROM (to_jsonb(OLD) - system_cols);

    IF actor = 'worker' THEN
      IF content_changed OR NEW.agreement_version IS DISTINCT FROM OLD.agreement_version
         OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
         OR NEW.published_at IS DISTINCT FROM OLD.published_at
         OR transition NOT IN ('processing->ready', 'processing->processing_failed', 'processing->processing') THEN
        RAISE EXCEPTION 'worker may only finish processing (%)', transition USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.duration_ms IS DISTINCT FROM OLD.duration_ms
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'duration_ms/published_at are system-managed' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF actor = 'owner' THEN
      -- Metadata may be edited while audio is still processing: the worker
      -- only ever changes status and duration, so the two never collide.
      IF content_changed AND OLD.status NOT IN ('draft', 'processing', 'ready', 'processing_failed', 'rejected') THEN
        RAISE EXCEPTION 'recording is not editable in status %', OLD.status USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.status <> OLD.status AND transition NOT IN (
        'draft->processing', 'ready->processing', 'processing_failed->processing', 'rejected->processing',
        'ready->pending_review', 'rejected->pending_review',
        'pending_review->ready'
      ) THEN
        RAISE EXCEPTION 'owner may not move recording %', transition USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.status = 'pending_review' AND OLD.status <> 'pending_review' THEN
        NEW.submitted_at := now();
      ELSIF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
        RAISE EXCEPTION 'submitted_at is system-managed' USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;

    -- moderator
    IF content_changed OR NEW.agreement_version IS DISTINCT FROM OLD.agreement_version
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
      RAISE EXCEPTION 'moderators may not edit recording content' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF transition IN ('pending_review->published', 'pending_review->rejected') THEN
      IF NOT EXISTS (
        SELECT 1 FROM moderation_reviews r
        WHERE r.recording_id = NEW.id
          AND r.moderator_id = me
          AND r.decision = CASE NEW.status WHEN 'published' THEN 'approve'::moderation_decision
                                          ELSE 'reject'::moderation_decision END
          AND r.created_at >= OLD.submitted_at
      ) THEN
        RAISE EXCEPTION 'a moderation review must be recorded first' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF transition NOT IN ('published->unpublished', 'unpublished->published') THEN
      RAISE EXCEPTION 'moderator may not move recording %', transition USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'published' THEN
      NEW.published_at := coalesce(OLD.published_at, now());
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER recordings_guard
  BEFORE UPDATE ON recordings
  FOR EACH ROW EXECUTE FUNCTION app.recordings_guard();

CREATE TABLE audio_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  kind         audio_asset_kind NOT NULL,
  -- Opaque random key; never returned by the API.
  storage_key  text NOT NULL UNIQUE CHECK (storage_key ~ '^[a-z]+/[0-9a-f]{32}\.[a-z0-9]{2,5}$'),
  mime_type    text NOT NULL CHECK (mime_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  byte_size    bigint NOT NULL CHECK (byte_size > 0),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  codec        text,
  sample_rate  integer CHECK (sample_rate > 0),
  channels     smallint CHECK (channels BETWEEN 1 AND 8),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recording_id, kind)
);

CREATE TABLE uploads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id   uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  quarantine_key text NOT NULL UNIQUE CHECK (quarantine_key ~ '^quarantine/[0-9a-f]{32}$'),
  declared_bytes bigint NOT NULL CHECK (declared_bytes > 0 AND declared_bytes <= 209715200),
  declared_format text NOT NULL CHECK (declared_format IN ('wav', 'flac', 'mp3', 'ogg')),
  status         upload_status NOT NULL DEFAULT 'pending',
  rejection_code text CHECK (rejection_code ~ '^[a-z_]{1,40}$'),
  -- Hash of the original, kept after the original itself is deleted.
  original_sha256 text CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  processed_at   timestamptz,
  CONSTRAINT rejected_has_code CHECK ((status = 'rejected') = (rejection_code IS NOT NULL))
);
CREATE INDEX uploads_recording_idx ON uploads (recording_id, created_at DESC);
CREATE INDEX uploads_pending_expiry_idx ON uploads (expires_at) WHERE status = 'pending';
