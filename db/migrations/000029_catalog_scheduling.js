const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',
      'reward.decide','reward.fulfill','admin.access','admin.rules','admin.catalog',
      'admin.catalog.create','admin.catalog.publish','admin.catalog.schedule','admin.catalog.quota.publish',
      'admin.audit','admin.notifications','ledger.correct'
    ));
  `);
};
const down = () => {
  throw new Error(
    "Keep scheduled terms and history; disable SYNTHETIC_CATALOG_SCHEDULING_ENABLED to stop new scheduling",
  );
};
module.exports = { up, down };
