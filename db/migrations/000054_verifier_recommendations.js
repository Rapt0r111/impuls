// Рекомендация проверяющего обычной задачи: ХП и баллы за конкретный отчёт.
// Командир по-прежнему принимает работу и назначает начисление; рекомендация только подсказывает значения.
const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.verifier_recommendations (
      submission_id uuid PRIMARY KEY REFERENCES impuls.submissions(id),
      verifier_id uuid NOT NULL REFERENCES impuls.users(id),
      recommended_xp integer NOT NULL CHECK (recommended_xp BETWEEN 0 AND 100000),
      recommended_points integer NOT NULL CHECK (recommended_points BETWEEN 0 AND 100000),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    REVOKE ALL ON impuls.verifier_recommendations FROM PUBLIC;
    DO $$ DECLARE role_name text; BEGIN
      FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON impuls.verifier_recommendations FROM %I', role_name);
      END LOOP;
    END $$;
    GRANT SELECT, INSERT, UPDATE ON impuls.verifier_recommendations TO impuls_app;
    ALTER TABLE impuls.verifier_recommendations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY verifier_recommendations_server_access ON impuls.verifier_recommendations
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
  `);
};
const down = (pgm) => {
  pgm.sql(`DROP TABLE impuls.verifier_recommendations;`);
};
module.exports = { up, down };
