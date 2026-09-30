const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.rule_sets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      version_number integer NOT NULL UNIQUE CHECK (version_number > 0),
      definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
      effective_from timestamptz NOT NULL,
      created_by uuid NOT NULL REFERENCES impuls.users(id),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE impuls.tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      rule_set_id uuid NOT NULL REFERENCES impuls.rule_sets(id),
      created_by uuid NOT NULL REFERENCES impuls.users(id),
      title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
      criteria text NOT NULL CHECK (char_length(criteria) BETWEEN 1 AND 2000),
      category_code text NOT NULL CHECK (char_length(category_code) BETWEEN 1 AND 40),
      priority text NOT NULL CHECK (priority IN ('critical', 'high', 'normal')),
      status text NOT NULL CHECK (status IN (
        'draft', 'assigned', 'in_progress', 'in_review',
        'needs_work', 'accepted', 'cancelled'
      )),
      due_at timestamptz NOT NULL,
      fund_xp integer NOT NULL CHECK (fund_xp >= 0),
      fund_points integer NOT NULL CHECK (fund_points >= 0),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX tasks_scope_status_updated_idx
      ON impuls.tasks (scope_id, status, updated_at DESC, id);

    CREATE TABLE impuls.task_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid NOT NULL UNIQUE REFERENCES impuls.tasks(id),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      assigned_at timestamptz NOT NULL DEFAULT now(),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX task_assignments_user_task_idx
      ON impuls.task_assignments (user_id, task_id);

    REVOKE ALL ON impuls.rule_sets, impuls.tasks, impuls.task_assignments FROM PUBLIC;
    GRANT SELECT ON impuls.rule_sets, impuls.tasks, impuls.task_assignments TO impuls_app;
    ALTER TABLE impuls.rule_sets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impuls.task_assignments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rule_sets_server_read ON impuls.rule_sets
      FOR SELECT TO impuls_app USING (true);
    CREATE POLICY tasks_server_read ON impuls.tasks
      FOR SELECT TO impuls_app USING (true);
    CREATE POLICY task_assignments_server_read ON impuls.task_assignments
      FOR SELECT TO impuls_app USING (true);
  `);
};

const down = (pgm) => {
  pgm.sql(`
    DROP TABLE impuls.task_assignments;
    DROP TABLE impuls.tasks;
    DROP TABLE impuls.rule_sets;
  `);
};

module.exports = { up, down };
