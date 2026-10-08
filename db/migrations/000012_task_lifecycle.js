const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view', 'task.create', 'task.assign', 'task.review', 'reward.decide', 'reward.fulfill',
      'admin.access', 'admin.rules', 'admin.catalog', 'ledger.correct'
    ));
    CREATE TABLE impuls.task_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid NOT NULL REFERENCES impuls.tasks(id) ON DELETE CASCADE,
      task_version integer NOT NULL CHECK (task_version > 0),
      kind text NOT NULL CHECK (kind IN ('snapshot','created','assigned','started','submitted','returned','accepted')),
      actor_id uuid REFERENCES impuls.users(id),
      assignee_id uuid REFERENCES impuls.users(id),
      status text NOT NULL CHECK (status IN ('draft','assigned','in_progress','in_review','needs_work','accepted','cancelled')),
      rule_set_id uuid NOT NULL REFERENCES impuls.rule_sets(id),
      fund_xp integer NOT NULL CHECK (fund_xp >= 0),
      fund_points integer NOT NULL CHECK (fund_points >= 0),
      submission_id uuid,
      review_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (task_id, task_version),
      CHECK ((kind = 'snapshot' AND actor_id IS NULL) OR (kind <> 'snapshot' AND actor_id IS NOT NULL)),
      CHECK ((kind IN ('submitted','returned','accepted')) = (submission_id IS NOT NULL)),
      CHECK ((kind IN ('returned','accepted')) = (review_id IS NOT NULL)),
      CHECK (kind = 'snapshot' OR
        (kind = 'created' AND status = 'draft') OR (kind = 'assigned' AND status = 'assigned') OR
        (kind = 'started' AND status = 'in_progress') OR (kind = 'submitted' AND status = 'in_review') OR
        (kind = 'returned' AND status = 'needs_work') OR (kind = 'accepted' AND status = 'accepted'))
    );
    -- No guesses about previously unrecorded starts. Existing reports/reviews
    -- remain in their original tables and are read through /history.
    INSERT INTO impuls.task_events (task_id,task_version,kind,assignee_id,status,rule_set_id,fund_xp,fund_points)
      SELECT t.id,t.version,'snapshot',a.user_id,t.status,t.rule_set_id,t.fund_xp,t.fund_points
      FROM impuls.tasks t LEFT JOIN impuls.task_assignments a ON a.task_id=t.id;
    REVOKE ALL ON impuls.task_events FROM PUBLIC;
    DO $$ DECLARE role_name text; BEGIN
      FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON impuls.task_events FROM %I', role_name);
      END LOOP;
    END $$;
    GRANT SELECT, INSERT ON impuls.task_events TO impuls_app;
    ALTER TABLE impuls.task_events ENABLE ROW LEVEL SECURITY;
    CREATE POLICY task_events_server_read ON impuls.task_events FOR SELECT TO impuls_app USING (true);
    CREATE POLICY task_events_server_insert ON impuls.task_events FOR INSERT TO impuls_app WITH CHECK (kind <> 'snapshot');
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.task_events WHERE kind <> 'snapshot') OR
         EXISTS (SELECT 1 FROM impuls.role_bindings WHERE action='task.view') THEN
        RAISE EXCEPTION 'Lifecycle history or view bindings exist; keep schema and roll back the application';
      END IF;
    END $$;
    DROP TABLE impuls.task_events;
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.create', 'task.assign', 'task.review', 'reward.decide', 'reward.fulfill',
      'admin.access', 'admin.rules', 'admin.catalog', 'ledger.correct'
    ));
  `);
};
module.exports = { up, down };
