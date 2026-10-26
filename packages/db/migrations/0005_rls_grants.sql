-- Row-level security and grants. Application roles get the minimum they need;
-- the API never connects as the table owner, so these policies always apply.
--
-- Policy predicates wrap the context helpers in scalar subqueries so they are
-- evaluated once per statement (an InitPlan), not once per row.

GRANT USAGE ON SCHEMA public, app TO tc_api, tc_worker, tc_auth;
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.is_worker(), app.acts_as(name) TO tc_api, tc_worker;
GRANT EXECUTE ON FUNCTION app.is_moderator() TO tc_api, tc_worker;
-- PostGIS functions live in public and are executable by PUBLIC by default.

-- ---------- auth tables: only the Auth.js role writes them ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON users, accounts, sessions, verification_token TO tc_auth;
-- The API may resolve a session cookie to a user and read public profile
-- columns, but cannot read emails, OAuth tokens or names.
GRANT SELECT ("userId", expires, "sessionToken") ON sessions TO tc_api;
GRANT SELECT (id, role, display_name, disabled_at) ON users TO tc_api;

-- ---------- agreements ----------
GRANT SELECT ON contributor_agreements TO tc_api;

-- ---------- recordings ----------
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON recordings TO tc_api;
GRANT SELECT, UPDATE ON recordings TO tc_worker;

CREATE POLICY recordings_api_select ON recordings FOR SELECT TO tc_api
  USING (
    status = 'published'
    OR contributor_id = (SELECT app.current_user_id())
    OR (SELECT app.is_moderator())
  );
CREATE POLICY recordings_api_insert ON recordings FOR INSERT TO tc_api
  WITH CHECK (contributor_id = (SELECT app.current_user_id()) AND status = 'draft' AND NOT is_demo);
CREATE POLICY recordings_api_update ON recordings FOR UPDATE TO tc_api
  USING (contributor_id = (SELECT app.current_user_id()) OR (SELECT app.is_moderator()))
  WITH CHECK (contributor_id = (SELECT app.current_user_id()) OR (SELECT app.is_moderator()));
CREATE POLICY recordings_api_delete ON recordings FOR DELETE TO tc_api
  USING (
    contributor_id = (SELECT app.current_user_id())
    AND status IN ('draft', 'ready', 'processing_failed', 'rejected')
  );
-- The worker must still "see" the row after finishing it (UPDATE re-checks
-- SELECT policies against the new row), hence the wider SELECT policy.
CREATE POLICY recordings_worker_select ON recordings FOR SELECT TO tc_worker
  USING (status IN ('processing', 'ready', 'processing_failed'));
CREATE POLICY recordings_worker_update ON recordings FOR UPDATE TO tc_worker
  USING (status = 'processing')
  WITH CHECK (status IN ('processing', 'ready', 'processing_failed'));

-- ---------- audio assets: visibility follows the parent recording ----------
ALTER TABLE audio_assets ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON audio_assets TO tc_api;
GRANT SELECT, INSERT, DELETE ON audio_assets TO tc_worker;

CREATE POLICY audio_assets_api_select ON audio_assets FOR SELECT TO tc_api
  USING (recording_id IN (SELECT id FROM recordings));
CREATE POLICY audio_assets_worker ON audio_assets FOR ALL TO tc_worker
  USING (recording_id IN (SELECT id FROM recordings));

-- ---------- uploads ----------
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON uploads TO tc_api;
GRANT UPDATE (status) ON uploads TO tc_api;
GRANT SELECT, UPDATE ON uploads TO tc_worker;

CREATE POLICY uploads_api_own ON uploads FOR ALL TO tc_api
  USING (user_id = (SELECT app.current_user_id()))
  WITH CHECK (user_id = (SELECT app.current_user_id()));
CREATE POLICY uploads_worker ON uploads FOR ALL TO tc_worker USING (true);

-- ---------- moderation reviews: append-only ----------
ALTER TABLE moderation_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON moderation_reviews TO tc_api;

CREATE POLICY moderation_reviews_select ON moderation_reviews FOR SELECT TO tc_api
  USING (
    (SELECT app.is_moderator())
    OR recording_id IN (SELECT id FROM recordings WHERE contributor_id = (SELECT app.current_user_id()))
  );
CREATE POLICY moderation_reviews_insert ON moderation_reviews FOR INSERT TO tc_api
  WITH CHECK ((SELECT app.is_moderator()) AND moderator_id = (SELECT app.current_user_id()));

-- ---------- takedown requests ----------
ALTER TABLE takedown_requests ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON takedown_requests TO tc_api;
GRANT SELECT, UPDATE (status, resolved_by, resolved_at, resolution_note) ON takedown_requests TO tc_api;

CREATE POLICY takedown_requests_public_insert ON takedown_requests FOR INSERT TO tc_api
  WITH CHECK (status = 'received' AND resolved_by IS NULL AND resolved_at IS NULL);
CREATE POLICY takedown_requests_moderator_select ON takedown_requests FOR SELECT TO tc_api
  USING ((SELECT app.is_moderator()));
CREATE POLICY takedown_requests_moderator_update ON takedown_requests FOR UPDATE TO tc_api
  USING ((SELECT app.is_moderator()))
  WITH CHECK ((SELECT app.is_moderator()) AND resolved_by = (SELECT app.current_user_id()));

-- ---------- notifications ----------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON notifications TO tc_api;
GRANT UPDATE (read_at) ON notifications TO tc_api;
GRANT INSERT ON notifications TO tc_worker;

CREATE POLICY notifications_own_select ON notifications FOR SELECT TO tc_api
  USING (user_id = (SELECT app.current_user_id()));
CREATE POLICY notifications_own_update ON notifications FOR UPDATE TO tc_api
  USING (user_id = (SELECT app.current_user_id()));
CREATE POLICY notifications_moderator_insert ON notifications FOR INSERT TO tc_api
  WITH CHECK ((SELECT app.is_moderator()));
CREATE POLICY notifications_worker_insert ON notifications FOR INSERT TO tc_worker
  WITH CHECK (true);

-- ---------- audit log: insert-only for application roles ----------
GRANT INSERT ON audit_log TO tc_api, tc_worker;
