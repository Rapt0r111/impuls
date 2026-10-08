const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog','admin.audit',
      'admin.notifications','ledger.correct'
    ));
    -- Private runtime read boundary. Never expose lease tokens or permit app writes.
    GRANT SELECT(outbox_id,status,error_code) ON impuls.notification_simulations TO impuls_app;
    CREATE POLICY notification_simulations_app_read ON impuls.notification_simulations
      FOR SELECT TO impuls_app USING (true);
  `);
};
const down = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM impuls.role_bindings WHERE action='admin.notifications') THEN
        RAISE EXCEPTION 'Cannot remove notification status permission while bindings exist';
      END IF;
    END $$;
    DROP POLICY notification_simulations_app_read ON impuls.notification_simulations;
    REVOKE SELECT(outbox_id,status,error_code) ON impuls.notification_simulations FROM impuls_app;
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog','admin.audit','ledger.correct'
    ));
  `);
};
module.exports = { up, down };
