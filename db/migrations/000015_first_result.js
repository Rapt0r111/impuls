const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.user_achievements (
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      code text NOT NULL CHECK (code='first_result'),
      condition_version integer NOT NULL CHECK (condition_version=1),
      source_entry_id uuid NOT NULL UNIQUE REFERENCES impuls.ledger_entries(id) ON DELETE CASCADE,
      granted_at timestamptz(3) NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      provenance text NOT NULL CHECK (provenance IN ('acceptance','migration')),
      PRIMARY KEY(user_id,code)
    );
    CREATE FUNCTION impuls.guard_first_result_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM impuls.ledger_entries l JOIN impuls.reviews r ON r.id=l.review_id
        WHERE l.id=NEW.source_entry_id AND l.user_id=NEW.user_id AND l.currency='xp'
          AND l.kind='task_acceptance' AND l.mode='synthetic' AND r.decision='accept'
          AND l.created_at=NEW.granted_at
      ) THEN RAISE EXCEPTION 'Invalid first result source' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION impuls.guard_first_result_source() FROM PUBLIC;
    CREATE TRIGGER first_result_source_valid BEFORE INSERT ON impuls.user_achievements
      FOR EACH ROW EXECUTE FUNCTION impuls.guard_first_result_source();
    INSERT INTO impuls.user_achievements(user_id,code,condition_version,source_entry_id,granted_at,provenance)
      SELECT DISTINCT ON (l.user_id) l.user_id,'first_result',1,l.id,l.created_at,'migration'
      FROM impuls.ledger_entries l JOIN impuls.reviews r ON r.id=l.review_id
      WHERE l.currency='xp' AND l.kind='task_acceptance' AND l.mode='synthetic' AND r.decision='accept'
      ORDER BY l.user_id,l.created_at,l.id;
    REVOKE ALL ON impuls.user_achievements FROM PUBLIC;
    DO $$ DECLARE role_name text; BEGIN
      FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON impuls.user_achievements FROM %I',role_name);
      END LOOP;
    END $$;
    GRANT SELECT,INSERT ON impuls.user_achievements TO impuls_app;
    ALTER TABLE impuls.user_achievements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY user_achievements_server_read ON impuls.user_achievements FOR SELECT TO impuls_app USING (true);
    CREATE POLICY user_achievements_server_insert ON impuls.user_achievements FOR INSERT TO impuls_app WITH CHECK (provenance='acceptance');
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.user_achievements WHERE provenance='acceptance') THEN
        RAISE EXCEPTION 'First result issuance exists; keep schema and roll back the application';
      END IF;
    END $$;
    DROP TABLE impuls.user_achievements;
    DROP FUNCTION impuls.guard_first_result_source();
  `);
};
module.exports = { up, down };
