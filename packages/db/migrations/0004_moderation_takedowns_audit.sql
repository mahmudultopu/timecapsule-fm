-- Moderation reviews, takedown requests, notifications and the audit log.

CREATE TABLE moderation_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id          uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  moderator_id          uuid NOT NULL REFERENCES users (id),
  decision              moderation_decision NOT NULL,
  chk_audio_quality     boolean NOT NULL,
  chk_rights            boolean NOT NULL,
  chk_location          boolean NOT NULL,
  chk_no_private_speech boolean NOT NULL,
  reason                text CHECK (char_length(reason) <= 2000),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approve_requires_full_checklist CHECK (
    decision <> 'approve' OR (chk_audio_quality AND chk_rights AND chk_location AND chk_no_private_speech)
  ),
  CONSTRAINT reject_requires_reason CHECK (
    decision <> 'reject' OR char_length(btrim(coalesce(reason, ''))) >= 10
  )
);
CREATE INDEX moderation_reviews_recording_idx ON moderation_reviews (recording_id, created_at DESC);

CREATE FUNCTION app.moderation_reviews_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    rec recordings%ROWTYPE;
  BEGIN
    SELECT * INTO rec FROM recordings WHERE id = NEW.recording_id;
    IF rec.status IS DISTINCT FROM 'pending_review' THEN
      RAISE EXCEPTION 'recording is not awaiting review' USING ERRCODE = 'check_violation';
    END IF;
    IF rec.contributor_id = NEW.moderator_id THEN
      RAISE EXCEPTION 'moderators may not review their own submissions' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER moderation_reviews_guard
  BEFORE INSERT ON moderation_reviews
  FOR EACH ROW EXECUTE FUNCTION app.moderation_reviews_guard();

CREATE TABLE takedown_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id        uuid REFERENCES recordings (id) ON DELETE SET NULL,
  target_url          text CHECK (char_length(target_url) <= 500),
  claimant_name       text NOT NULL CHECK (char_length(claimant_name) BETWEEN 1 AND 200),
  claimant_email      text NOT NULL CHECK (char_length(claimant_email) <= 254 AND claimant_email ~ '^[^@\s]+@[^@\s]+$'),
  basis               takedown_basis NOT NULL,
  statement           text NOT NULL CHECK (char_length(statement) BETWEEN 20 AND 10000),
  good_faith_attested boolean NOT NULL CHECK (good_faith_attested),
  status              takedown_status NOT NULL DEFAULT 'received',
  received_at         timestamptz NOT NULL DEFAULT now(),
  resolved_by         uuid REFERENCES users (id),
  resolved_at         timestamptz,
  resolution_note     text CHECK (char_length(resolution_note) <= 2000),
  CONSTRAINT resolution_consistent CHECK (
    (status = 'received') = (resolved_at IS NULL) AND (resolved_at IS NULL) = (resolved_by IS NULL)
  )
);
CREATE INDEX takedown_requests_open_idx ON takedown_requests (received_at) WHERE status = 'received';

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recording_id uuid REFERENCES recordings (id) ON DELETE CASCADE,
  kind         notification_kind NOT NULL,
  message      text NOT NULL CHECK (char_length(message) <= 2000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Security/audit events. Append-only: no role but the owner can UPDATE or
-- DELETE. Must never contain audio, personal data or full signed URLs; IPs
-- are stored only as a keyed HMAC (key rotated, rows purged after 90 days).
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action ~ '^[a-z_]+(\.[a-z_]+)*$'),
  target_type text CHECK (target_type ~ '^[a-z_]+$'),
  target_id   uuid,
  details     jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(details) <= 4096),
  ip_hmac     text CHECK (ip_hmac ~ '^[0-9a-f]{64}$')
);
CREATE INDEX audit_log_at_idx ON audit_log (at);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id);
