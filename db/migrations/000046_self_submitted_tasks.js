const up = (pgm) => {
  pgm.sql(`
    -- A member reports a finished task and asks for points (and optionally XP). Verifiers chosen
    -- by the member approve it and forward it; only the commander sets the fund and accepts.
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review','task.verify',
      'reward.decide','reward.fulfill','admin.access','admin.access.manage','admin.members.manage','admin.rules','admin.catalog',
      'admin.catalog.create','admin.catalog.publish','admin.catalog.schedule','admin.catalog.schedule.cancel','admin.catalog.quota.publish',
      'admin.audit','admin.notifications','ledger.correct'
    ));

    ALTER TABLE impuls.tasks DROP CONSTRAINT tasks_status_check;
    ALTER TABLE impuls.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
      'draft','assigned','in_progress','in_review','needs_work','accepted','cancelled',
      'awaiting_verification','awaiting_commander'
    ));
    ALTER TABLE impuls.tasks
      ADD COLUMN self_submitted boolean NOT NULL DEFAULT false,
      ADD COLUMN requested_points integer CHECK (requested_points BETWEEN 0 AND 100000),
      ADD COLUMN requested_xp integer CHECK (requested_xp BETWEEN 0 AND 100000),
      ADD CONSTRAINT tasks_self_submitted_check CHECK (
        NOT self_submitted OR (requested_points IS NOT NULL AND NOT open_for_claim));

    CREATE TABLE impuls.task_verifiers (
      task_id uuid NOT NULL REFERENCES impuls.tasks(id),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (task_id, user_id)
    );
    REVOKE ALL ON impuls.task_verifiers FROM PUBLIC;
    DO $$ DECLARE role_name text; BEGIN
      FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
        EXECUTE format('REVOKE ALL ON impuls.task_verifiers FROM %I', role_name);
      END LOOP;
    END $$;
    GRANT SELECT, INSERT ON impuls.task_verifiers TO impuls_app;
    ALTER TABLE impuls.task_verifiers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY task_verifiers_server_access ON impuls.task_verifiers FOR ALL TO impuls_app USING (true) WITH CHECK (true);

    ALTER TABLE impuls.task_events DROP CONSTRAINT task_events_kind_check;
    ALTER TABLE impuls.task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN (
      'snapshot','created','assigned','started','submitted','returned','accepted','edited','cancelled',
      'proposed','verified','approved','declined'));
    ALTER TABLE impuls.task_events DROP CONSTRAINT task_events_status_check;
    ALTER TABLE impuls.task_events ADD CONSTRAINT task_events_status_check CHECK (status IN (
      'draft','assigned','in_progress','in_review','needs_work','accepted','cancelled',
      'awaiting_verification','awaiting_commander'));
    ALTER TABLE impuls.task_events DROP CONSTRAINT task_events_transition_check;
    ALTER TABLE impuls.task_events ADD CONSTRAINT task_events_transition_check CHECK (kind='snapshot' OR
      (kind IN ('created','edited') AND status='draft') OR (kind='assigned' AND status='assigned') OR
      (kind='started' AND status='in_progress') OR (kind='submitted' AND status='in_review') OR
      (kind='returned' AND status='needs_work') OR (kind='accepted' AND status='accepted') OR
      (kind='cancelled' AND status='cancelled') OR (kind='proposed' AND status='awaiting_verification') OR
      (kind='verified' AND status='awaiting_commander') OR (kind='approved' AND status='in_review') OR
      (kind='declined' AND status='cancelled'));
    ALTER TABLE impuls.task_events DROP CONSTRAINT task_events_management_reason_check;
    ALTER TABLE impuls.task_events ADD CONSTRAINT task_events_management_reason_check CHECK (
      kind NOT IN ('edited','cancelled','declined') OR (reason IS NOT NULL AND task_snapshot IS NOT NULL));

    -- The commander's forward step is the one place fund amounts may change after creation:
    -- the task has no assignment yet, and the same transaction creates it.
    CREATE OR REPLACE FUNCTION impuls.guard_task_conditions() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF ROW(OLD.title,OLD.criteria,OLD.category_code,OLD.priority,OLD.due_at,OLD.fund_xp,OLD.fund_points)
         IS DISTINCT FROM ROW(NEW.title,NEW.criteria,NEW.category_code,NEW.priority,NEW.due_at,NEW.fund_xp,NEW.fund_points)
         AND (OLD.status <> 'draft' OR NEW.status <> 'draft')
         AND NOT (OLD.status = 'awaiting_commander' AND NEW.status = 'in_review') THEN
        RAISE EXCEPTION 'Assigned task conditions are frozen' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.tasks WHERE self_submitted OR status IN ('awaiting_verification','awaiting_commander'))
         OR EXISTS (SELECT 1 FROM impuls.task_events WHERE kind IN ('proposed','verified','approved','declined')) THEN
        RAISE EXCEPTION 'Self-submitted tasks exist; keep the schema and roll back the application';
      END IF;
    END $$;
    CREATE OR REPLACE FUNCTION impuls.guard_task_conditions() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN
      IF ROW(OLD.title,OLD.criteria,OLD.category_code,OLD.priority,OLD.due_at,OLD.fund_xp,OLD.fund_points)
         IS DISTINCT FROM ROW(NEW.title,NEW.criteria,NEW.category_code,NEW.priority,NEW.due_at,NEW.fund_xp,NEW.fund_points)
         AND (OLD.status <> 'draft' OR NEW.status <> 'draft') THEN
        RAISE EXCEPTION 'Assigned task conditions are frozen' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    ALTER TABLE impuls.task_events DROP CONSTRAINT task_events_management_reason_check;
    ALTER TABLE impuls.task_events ADD CONSTRAINT task_events_management_reason_check CHECK (
      kind NOT IN ('edited','cancelled') OR (reason IS NOT NULL AND task_snapshot IS NOT NULL));
    ALTER TABLE impuls.task_events DROP CONSTRAINT task_events_transition_check;
    ALTER TABLE impuls.task_events ADD CONSTRAINT task_events_transition_check CHECK (kind='snapshot' OR
      (kind IN ('created','edited') AND status='draft') OR (kind='assigned' AND status='assigned') OR
      (kind='started' AND status='in_progress') OR (kind='submitted' AND status='in_review') OR
      (kind='returned' AND status='needs_work') OR (kind='accepted' AND status='accepted') OR
      (kind='cancelled' AND status='cancelled'));
    ALTER TABLE impuls.task_events DROP CONSTRAINT task_events_kind_check;
    ALTER TABLE impuls.task_events ADD CONSTRAINT task_events_kind_check CHECK (kind IN (
      'snapshot','created','assigned','started','submitted','returned','accepted','edited','cancelled'));
    ALTER TABLE impuls.task_events DROP CONSTRAINT task_events_status_check;
    ALTER TABLE impuls.task_events ADD CONSTRAINT task_events_status_check CHECK (status IN (
      'draft','assigned','in_progress','in_review','needs_work','accepted','cancelled'));
    DROP TABLE impuls.task_verifiers;
    ALTER TABLE impuls.tasks DROP CONSTRAINT tasks_self_submitted_check,
      DROP COLUMN self_submitted, DROP COLUMN requested_points, DROP COLUMN requested_xp;
    ALTER TABLE impuls.tasks DROP CONSTRAINT tasks_status_check;
    ALTER TABLE impuls.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
      'draft','assigned','in_progress','in_review','needs_work','accepted','cancelled'));
    -- The rolled-back code does not know task.verify, so its grants go with it.
    DELETE FROM impuls.role_bindings WHERE action='task.verify';
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.access.manage','admin.members.manage','admin.rules','admin.catalog',
      'admin.catalog.create','admin.catalog.publish','admin.catalog.schedule','admin.catalog.schedule.cancel','admin.catalog.quota.publish',
      'admin.audit','admin.notifications','ledger.correct'
    ));
  `);
};
module.exports = { up, down };
