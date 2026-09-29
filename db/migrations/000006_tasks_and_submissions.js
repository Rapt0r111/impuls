const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.rule_sets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version integer NOT NULL UNIQUE CHECK (version > 0),
      label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
      active_from timestamptz NOT NULL,
      max_task_xp integer NOT NULL CHECK (max_task_xp >= 0),
      max_task_points integer NOT NULL CHECK (max_task_points >= 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE impuls.tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      created_by uuid NOT NULL REFERENCES impuls.users(id),
      assigned_to uuid REFERENCES impuls.users(id),
      rule_set_id uuid NOT NULL REFERENCES impuls.rule_sets(id),
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
      criteria text NOT NULL CHECK (char_length(criteria) BETWEEN 1 AND 2000),
      category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 80),
      priority text NOT NULL CHECK (priority IN ('critical', 'high', 'normal')),
      due_at timestamptz,
      base_xp integer NOT NULL CHECK (base_xp >= 0),
      base_points integer NOT NULL CHECK (base_points >= 0),
      status text NOT NULL DEFAULT 'draft' CHECK
        (status IN ('draft', 'assigned', 'in_progress', 'in_review', 'needs_work', 'accepted', 'cancelled')),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((status = 'draft' AND assigned_to IS NULL) OR
             (status NOT IN ('draft', 'cancelled') AND assigned_to IS NOT NULL) OR
             status = 'cancelled')
    );
    CREATE INDEX tasks_assignee_list_idx ON impuls.tasks
      (assigned_to, updated_at DESC, id DESC) WHERE assigned_to IS NOT NULL;
    CREATE INDEX tasks_scope_list_idx ON impuls.tasks
      (scope_id, updated_at DESC, id DESC);

    CREATE TABLE impuls.task_assignments (
      task_id uuid PRIMARY KEY REFERENCES impuls.tasks(id),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      assigned_by uuid NOT NULL REFERENCES impuls.users(id),
      assigned_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE impuls.submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid NOT NULL REFERENCES impuls.tasks(id),
      author_id uuid NOT NULL REFERENCES impuls.users(id),
      report text NOT NULL CHECK (char_length(report) BETWEEN 1 AND 4000),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX submissions_task_history_idx ON impuls.submissions (task_id, created_at DESC, id DESC);
    ALTER TABLE impuls.tasks ADD COLUMN current_submission_id uuid REFERENCES impuls.submissions(id);

    CREATE TABLE impuls.reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id uuid NOT NULL UNIQUE REFERENCES impuls.submissions(id),
      reviewer_id uuid NOT NULL REFERENCES impuls.users(id),
      decision text NOT NULL CHECK (decision = 'returned'),
      reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE impuls.mutation_receipts (
      actor_id uuid NOT NULL REFERENCES impuls.users(id),
      operation text NOT NULL,
      idempotency_key uuid NOT NULL,
      request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
      status integer NOT NULL CHECK (status BETWEEN 200 AND 299),
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (actor_id, operation, idempotency_key)
    );

    REVOKE ALL ON impuls.rule_sets, impuls.tasks, impuls.task_assignments,
      impuls.submissions, impuls.reviews,
      impuls.mutation_receipts FROM PUBLIC;
    GRANT SELECT ON impuls.rule_sets TO impuls_app;
    GRANT SELECT, INSERT, UPDATE ON impuls.tasks TO impuls_app;
    GRANT SELECT, INSERT ON impuls.submissions, impuls.mutation_receipts TO impuls_app;
    GRANT SELECT, INSERT ON impuls.task_assignments, impuls.reviews TO impuls_app;
    ALTER TABLE impuls.rule_sets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.submissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.task_assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.reviews ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.mutation_receipts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rule_sets_server_read ON impuls.rule_sets FOR SELECT TO impuls_app USING (true);
    CREATE POLICY tasks_server_access ON impuls.tasks FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY submissions_server_access ON impuls.submissions FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY task_assignments_server_access ON impuls.task_assignments FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY reviews_server_access ON impuls.reviews FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    CREATE POLICY mutation_receipts_server_access ON impuls.mutation_receipts FOR ALL TO impuls_app USING (true) WITH CHECK (true);
  `);
};

const down = (pgm) => {
  pgm.sql(`
    DROP TABLE impuls.mutation_receipts;
    DROP TABLE impuls.reviews;
    ALTER TABLE impuls.tasks DROP COLUMN current_submission_id;
    DROP TABLE impuls.submissions;
    DROP TABLE impuls.task_assignments;
    DROP TABLE impuls.tasks;
    DROP TABLE impuls.rule_sets;
  `);
};

module.exports = { up, down };
