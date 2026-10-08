const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog','admin.audit','ledger.correct'
    ));
    CREATE INDEX audit_events_time_id_idx ON impuls.audit_events (created_at DESC, id DESC);
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM impuls.role_bindings WHERE action='admin.audit') THEN
        RAISE EXCEPTION 'Cannot remove audit permission while bindings exist';
      END IF;
    END $$;
    DROP INDEX impuls.audit_events_time_id_idx;
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog','ledger.correct'
    ));
  `);
};
module.exports = { up, down };
