/** @type {import('node-pg-migrate').MigrationBuilder['sql']} */
const up = (pgm) => {
  pgm.sql(`
    CREATE SCHEMA impuls;
    REVOKE ALL ON SCHEMA impuls FROM PUBLIC;

    CREATE TABLE impuls.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      telegram_id bigint NOT NULL UNIQUE CHECK (telegram_id > 0),
      display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
      active boolean NOT NULL DEFAULT false,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE impuls.sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      session_hash bytea NOT NULL UNIQUE CHECK (octet_length(session_hash) = 32),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX sessions_user_open_idx ON impuls.sessions (user_id) WHERE revoked_at IS NULL;

    CREATE TABLE impuls.auth_rate_limits (
      key_hash bytea PRIMARY KEY CHECK (octet_length(key_hash) = 32),
      attempts integer NOT NULL CHECK (attempts > 0),
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX auth_rate_limits_expires_idx ON impuls.auth_rate_limits (expires_at);

    CREATE FUNCTION impuls.revoke_sessions_on_access_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.active AND NOT NEW.active THEN
        UPDATE impuls.sessions SET revoked_at = now(), updated_at = now(), version = version + 1
          WHERE user_id = NEW.id AND revoked_at IS NULL;
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER users_revoke_sessions AFTER UPDATE OF active ON impuls.users
      FOR EACH ROW EXECUTE FUNCTION impuls.revoke_sessions_on_access_change();

    REVOKE ALL ON SCHEMA impuls FROM PUBLIC;
    REVOKE ALL ON ALL TABLES IN SCHEMA impuls FROM PUBLIC;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA impuls FROM PUBLIC;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA impuls FROM PUBLIC;

    DO $$
    DECLARE role_name text;
    BEGIN
      FOR role_name IN
        SELECT rolname FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'service_role')
      LOOP
        EXECUTE format('REVOKE ALL ON SCHEMA impuls FROM %I', role_name);
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA impuls FROM %I', role_name);
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA impuls FROM %I', role_name);
        EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA impuls FROM %I', role_name);
      END LOOP;
    END;
    $$;
  `);
};

const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER users_revoke_sessions ON impuls.users;
    DROP FUNCTION impuls.revoke_sessions_on_access_change();
    DROP TABLE impuls.auth_rate_limits;
    DROP TABLE impuls.sessions;
    DROP TABLE impuls.users;
    DROP SCHEMA impuls;
  `);
};

module.exports = { up, down };
