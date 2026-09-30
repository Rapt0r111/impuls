const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE impuls.task_scope_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scope_id uuid NOT NULL REFERENCES impuls.access_scopes(id),
      user_id uuid NOT NULL REFERENCES impuls.users(id),
      synthetic boolean NOT NULL DEFAULT true CHECK (synthetic = true),
      valid_from timestamptz NOT NULL DEFAULT now(),
      valid_until timestamptz,
      revoked_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (scope_id, user_id),
      CHECK (valid_until IS NULL OR valid_until > valid_from)
    );
    REVOKE ALL ON impuls.task_scope_members FROM PUBLIC;
    GRANT SELECT ON impuls.task_scope_members TO impuls_app;
    -- PostgreSQL row locks need an UPDATE privilege. Only the inert version
    -- column is granted; runtime cannot change membership or validity.
    GRANT UPDATE (version) ON impuls.task_scope_members TO impuls_app;
    ALTER TABLE impuls.task_scope_members ENABLE ROW LEVEL SECURITY;
    CREATE POLICY task_scope_members_server_access ON impuls.task_scope_members
      FOR ALL TO impuls_app USING (true) WITH CHECK (true);
    GRANT INSERT ON impuls.tasks, impuls.task_assignments TO impuls_app;
    CREATE POLICY tasks_server_insert ON impuls.tasks
      FOR INSERT TO impuls_app WITH CHECK (true);
    CREATE POLICY task_assignments_server_insert ON impuls.task_assignments
      FOR INSERT TO impuls_app WITH CHECK (true);

    ALTER TABLE impuls.audit_events ALTER COLUMN review_id DROP NOT NULL;
    ALTER TABLE impuls.audit_events ADD COLUMN task_id uuid REFERENCES impuls.tasks(id);
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_action_check;
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_action_check
      CHECK (action IN ('task.accept', 'task.return', 'task.create', 'task.assign'));
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_object_check CHECK (
      (action IN ('task.accept', 'task.return') AND review_id IS NOT NULL AND task_id IS NULL) OR
      (action IN ('task.create', 'task.assign') AND review_id IS NULL AND task_id IS NOT NULL)
    );
    ALTER TABLE impuls.notification_outbox ALTER COLUMN review_id DROP NOT NULL;
    ALTER TABLE impuls.notification_outbox ADD COLUMN task_id uuid REFERENCES impuls.tasks(id);
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_kind_check;
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_kind_check
      CHECK (kind IN ('task.accepted', 'task.returned', 'task.assigned'));
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_object_check CHECK (
      (kind IN ('task.accepted', 'task.returned') AND review_id IS NOT NULL AND task_id IS NULL) OR
      (kind = 'task.assigned' AND review_id IS NULL AND task_id IS NOT NULL)
    );
    CREATE UNIQUE INDEX notification_outbox_assignment_unique
      ON impuls.notification_outbox (task_id) WHERE kind = 'task.assigned';
  `);
};
const down = (pgm) => {
  // Preserve history: rollback is allowed only before any management event.
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.audit_events WHERE task_id IS NOT NULL) OR
         EXISTS (SELECT 1 FROM impuls.notification_outbox WHERE task_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Management history exists; keep schema and roll back the application';
      END IF;
    END $$;
    DROP INDEX impuls.notification_outbox_assignment_unique;
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_object_check;
    ALTER TABLE impuls.notification_outbox DROP CONSTRAINT notification_outbox_kind_check;
    ALTER TABLE impuls.notification_outbox ADD CONSTRAINT notification_outbox_kind_check CHECK (kind IN ('task.accepted', 'task.returned'));
    ALTER TABLE impuls.notification_outbox DROP COLUMN task_id;
    ALTER TABLE impuls.notification_outbox ALTER COLUMN review_id SET NOT NULL;
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_object_check;
    ALTER TABLE impuls.audit_events DROP CONSTRAINT audit_events_action_check;
    ALTER TABLE impuls.audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN ('task.accept', 'task.return'));
    ALTER TABLE impuls.audit_events DROP COLUMN task_id;
    ALTER TABLE impuls.audit_events ALTER COLUMN review_id SET NOT NULL;
    DROP POLICY task_assignments_server_insert ON impuls.task_assignments;
    DROP POLICY tasks_server_insert ON impuls.tasks;
    REVOKE INSERT ON impuls.tasks, impuls.task_assignments FROM impuls_app;
    DROP TABLE impuls.task_scope_members;
  `);
};
module.exports = { up, down };
