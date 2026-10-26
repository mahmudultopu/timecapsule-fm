-- Auth.js tables, compatible with @auth/pg-adapter (quoted camelCase columns
-- are the adapter's contract). IDs are UUIDs instead of the adapter default
-- serials so user IDs are not enumerable. No password column exists: sign-in
-- is OAuth or email magic link only.

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text,
  email           text UNIQUE,
  "emailVerified" timestamptz,
  image           text,
  role            user_role NOT NULL DEFAULT 'contributor',
  display_name    text CHECK (char_length(display_name) BETWEEN 1 AND 80),
  age_attested_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz
);

CREATE TABLE accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type                text NOT NULL,
  provider            text NOT NULL,
  "providerAccountId" text NOT NULL,
  refresh_token       text,
  access_token        text,
  expires_at          bigint,
  id_token            text,
  scope               text,
  session_state       text,
  token_type          text,
  UNIQUE (provider, "providerAccountId")
);
CREATE INDEX accounts_user_idx ON accounts ("userId");

CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires        timestamptz NOT NULL,
  "sessionToken" text NOT NULL UNIQUE
);
CREATE INDEX sessions_user_idx ON sessions ("userId");

CREATE TABLE verification_token (
  identifier text NOT NULL,
  expires    timestamptz NOT NULL,
  token      text NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- Role lookup used by RLS policies. SECURITY DEFINER so policies work for
-- roles that can't read the users table directly; it only ever reveals a
-- boolean about the *current* user.
CREATE FUNCTION app.is_moderator() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM users
      WHERE id = app.current_user_id()
        AND role IN ('moderator', 'admin')
        AND disabled_at IS NULL
    )
  $$;
REVOKE ALL ON FUNCTION app.is_moderator() FROM PUBLIC;
