const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid NOT NULL REFERENCES impuls.tasks(id),
      author_id uuid NOT NULL REFERENCES impuls.users(id),
      attempt_number integer NOT NULL CHECK (attempt_number > 0),
      text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (task_id, attempt_number)
    );
    CREATE INDEX submissions_task_recent_idx
      ON impuls.submissions (task_id, attempt_number DESC);

    CREATE TABLE impuls.idempotency_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 80),
      key uuid NOT NULL,
      request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
      response_status integer CHECK (response_status BETWEEN 200 AND 299),
      response_body jsonb CHECK (jsonb_typeof(response_body) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((response_status IS NULL) = (response_body IS NULL)),
      UNIQUE (actor_id, operation, key)
    );

    REVOKE ALL ON impuls.submissions, impuls.idempotency_records FROM PUBLIC;
    GRANT SELECT, INSERT ON impuls.submissions, impuls.idempotency_records TO impuls_app;
    GRANT UPDATE (response_status, response_body) ON impuls.idempotency_records TO impuls_app;
    GRANT UPDATE (status, version, updated_at) ON impuls.tasks TO impuls_app;
    CREATE POLICY tasks_server_update ON impuls.tasks
      FOR UPDATE TO impuls_app USING (true) WITH CHECK (true);
    ALTER TABLE impuls.submissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.idempotency_records ENABLE ROW LEVEL SECURITY;
    CREATE POLICY submissions_server_access ON impuls.submissions
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY idempotency_server_access ON impuls.idempotency_records
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
  `);
};

const down = (pgm) => {
  pgm.sql(`
    DROP POLICY tasks_server_update ON impuls.tasks;
    REVOKE UPDATE (status, version, updated_at) ON impuls.tasks FROM impuls_app;
    DROP TABLE impuls.idempotency_records;
    DROP TABLE impuls.submissions;
  `);
};

module.exports = { up, down };
