const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.access_scopes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('rota', 'group', 'project')),
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE impuls.role_bindings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      action text NOT NULL CHECK (action IN (
        'task.create', 'task.assign', 'task.review',
        'reward.decide', 'reward.fulfill',
        'admin.access', 'admin.rules', 'admin.catalog', 'ledger.correct'
      )),
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      valid_from timestamptz NOT NULL DEFAULT now(),
      valid_until timestamptz,
      granted_by uuid NOT NULL REFERENCES impuls.users(id),
      reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
      revoked_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (valid_until IS NULL OR valid_until > valid_from)
    );
    CREATE INDEX role_bindings_active_idx
      ON impuls.role_bindings (user_id, action, scope_id, valid_from, valid_until)
      WHERE revoked_at IS NULL;

    CREATE FUNCTION impuls.revoke_sessions_on_permission_change()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE impuls.sessions
           SET revoked_at = now(), updated_at = now(), version = version + 1
         WHERE user_id = NEW.user_id AND revoked_at IS NULL;
      ELSE
        UPDATE impuls.sessions
           SET revoked_at = now(), updated_at = now(), version = version + 1
         WHERE user_id = OLD.user_id AND revoked_at IS NULL;
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.user_id <> NEW.user_id THEN
        UPDATE impuls.sessions
           SET revoked_at = now(), updated_at = now(), version = version + 1
         WHERE user_id = NEW.user_id AND revoked_at IS NULL;
      END IF;
      RETURN NULL;
    END;
    $$;
    CREATE TRIGGER role_bindings_revoke_sessions
      AFTER INSERT OR UPDATE OR DELETE ON impuls.role_bindings
      FOR EACH ROW EXECUTE FUNCTION impuls.revoke_sessions_on_permission_change();

    REVOKE ALL ON impuls.access_scopes, impuls.role_bindings FROM PUBLIC;
    GRANT SELECT, INSERT, UPDATE, DELETE ON impuls.access_scopes, impuls.role_bindings TO impuls_app;
    ALTER TABLE impuls.access_scopes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.role_bindings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY access_scopes_server_access ON impuls.access_scopes
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY role_bindings_server_access ON impuls.role_bindings
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
  `);
};

const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER role_bindings_revoke_sessions ON impuls.role_bindings;
    DROP FUNCTION impuls.revoke_sessions_on_permission_change();
    DROP TABLE impuls.role_bindings;
    DROP TABLE impuls.access_scopes;
  `);
};

module.exports = { up, down };
