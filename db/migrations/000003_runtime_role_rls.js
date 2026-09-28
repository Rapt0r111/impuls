const up = (pgm) => {
  pgm.sql(`
    CREATE ROLE impuls_app
      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

    GRANT USAGE ON SCHEMA impuls TO impuls_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA impuls TO impuls_app;

    ALTER TABLE impuls.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.auth_rate_limits ENABLE ROW LEVEL SECURITY;

    CREATE POLICY users_server_access ON impuls.users
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY sessions_server_access ON impuls.sessions
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY auth_rate_limits_server_access ON impuls.auth_rate_limits
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);

    ALTER TABLE impuls_meta.pgmigrations ENABLE ROW LEVEL SECURITY;
  `);
};

const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls_meta.pgmigrations DISABLE ROW LEVEL SECURITY;

    DROP POLICY auth_rate_limits_server_access ON impuls.auth_rate_limits;
    DROP POLICY sessions_server_access ON impuls.sessions;
    DROP POLICY users_server_access ON impuls.users;

    ALTER TABLE impuls.auth_rate_limits DISABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.sessions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.users DISABLE ROW LEVEL SECURITY;

    REVOKE ALL ON ALL TABLES IN SCHEMA impuls FROM impuls_app;
    REVOKE USAGE ON SCHEMA impuls FROM impuls_app;
    DROP ROLE impuls_app;
  `);
};

module.exports = { up, down };
