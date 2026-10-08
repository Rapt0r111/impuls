const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.task_mutation_limits (
      actor_id uuid PRIMARY KEY REFERENCES impuls.users(id) ON DELETE CASCADE,
      attempts integer NOT NULL CHECK (attempts BETWEEN 0 AND 31),
      expires_at timestamptz NOT NULL CHECK (isfinite(expires_at))
    );
    REVOKE ALL ON impuls.task_mutation_limits FROM PUBLIC;
    DO $$ DECLARE role_name text; BEGIN
      FOR role_name IN SELECT rolname FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated', 'service_role')
      LOOP
        EXECUTE format('REVOKE ALL ON impuls.task_mutation_limits FROM %I', role_name);
      END LOOP;
    END $$;
    GRANT SELECT, INSERT ON impuls.task_mutation_limits TO impuls_app;
    GRANT UPDATE (attempts, expires_at) ON impuls.task_mutation_limits TO impuls_app;
    ALTER TABLE impuls.task_mutation_limits ENABLE ROW LEVEL SECURITY;
    CREATE POLICY task_mutation_limits_server_access ON impuls.task_mutation_limits
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
  `);
};

const down = (pgm) => {
  pgm.sql("DROP TABLE impuls.task_mutation_limits");
};

module.exports = { up, down };
