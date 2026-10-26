-- Contribution flow: profiles, upload hand-off to the worker, the email
-- notification outbox, and the remaining grants for sign-in auditing.

-- ---------- profiles ----------
ALTER TABLE users ADD COLUMN email_notifications boolean NOT NULL DEFAULT true;

-- Users can change their own public profile and nothing else. The Auth.js
-- role keeps full access to manage accounts and sessions.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_auth_all ON users FOR ALL TO tc_auth USING (true) WITH CHECK (true);
CREATE POLICY users_api_select ON users FOR SELECT TO tc_api USING (true);
CREATE POLICY users_api_update_self ON users FOR UPDATE TO tc_api
  USING (id = (SELECT app.current_user_id()))
  WITH CHECK (id = (SELECT app.current_user_id()));
GRANT SELECT (age_attested_at, email_notifications) ON users TO tc_api;
GRANT UPDATE (display_name, age_attested_at, email_notifications) ON users TO tc_api;

-- Sign-in failures and successes are audited from the web app.
GRANT INSERT ON audit_log TO tc_auth;

-- ---------- precise locations need an attestation ----------
-- ~100 m precision is only allowed for public places (stations, squares,
-- parks), never homes. The contributor attests to that on the form.
ALTER TABLE recordings ADD COLUMN public_place_attested boolean NOT NULL DEFAULT false;
ALTER TABLE recordings ADD CONSTRAINT site_precision_attested CHECK (
  status IN ('draft', 'processing', 'processing_failed', 'ready')
  OR location_precision IS DISTINCT FROM 'site_100m'
  OR public_place_attested
);

-- ---------- uploads ----------
-- The API may only move an upload from pending to received (the browser
-- finished its PUT) or expired. Everything after that belongs to the worker.
CREATE FUNCTION app.uploads_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF app.acts_as('tc_api') AND NOT (
      (OLD.status = 'pending' AND NEW.status IN ('received', 'expired'))
      OR (OLD.status = 'received' AND NEW.status = 'expired')
    ) THEN
      RAISE EXCEPTION 'upload may not move % -> %', OLD.status, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER uploads_guard
  BEFORE UPDATE ON uploads
  FOR EACH ROW EXECUTE FUNCTION app.uploads_guard();

CREATE INDEX uploads_queue_idx ON uploads (created_at) WHERE status = 'received';

-- ---------- notification email outbox ----------
ALTER TABLE notifications
  ADD COLUMN emailed_at timestamptz,
  ADD COLUMN email_attempts smallint NOT NULL DEFAULT 0;
CREATE INDEX notifications_outbox_idx ON notifications (created_at)
  WHERE emailed_at IS NULL AND email_attempts < 5;

GRANT SELECT, UPDATE (emailed_at, email_attempts) ON notifications TO tc_worker;
CREATE POLICY notifications_worker_select ON notifications FOR SELECT TO tc_worker USING (true);
CREATE POLICY notifications_worker_update ON notifications FOR UPDATE TO tc_worker USING (true);

-- The worker sends emails but can't read the users table. This returns the
-- address for one notification, and only if the user still wants email.
CREATE FUNCTION app.notification_recipient(notification uuid)
  RETURNS TABLE (email text, display_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT u.email, u.display_name
    FROM notifications n
    JOIN users u ON u.id = n.user_id
    WHERE n.id = notification
      AND u.disabled_at IS NULL
      AND u.email_notifications
      AND u.email IS NOT NULL
  $$;
REVOKE ALL ON FUNCTION app.notification_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notification_recipient(uuid) TO tc_worker;
