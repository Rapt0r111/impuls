// ADR-0045. Право task.return: вернуть отчёт на доработку без права принять его.
// Приёмка фиксирует баллы и XP, поэтому остаётся за task.review; возврат доступен и тому, и другому праву.
const actions = (extra) => `
      'task.view','task.create','task.assign','task.edit','task.cancel','task.review',${extra}'task.verify',
      'reward.decide','reward.fulfill','admin.access','admin.access.manage','admin.members.manage','admin.rules','admin.catalog',
      'admin.catalog.create','admin.catalog.publish','admin.catalog.schedule','admin.catalog.schedule.cancel','admin.catalog.quota.publish',
      'admin.audit','admin.notifications','ledger.correct'`;

const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (${actions("'task.return',")}
    ));
  `);
};
const down = (pgm) => {
  pgm.sql(`
    -- Откатанный код не знает task.return, поэтому его выдачи уходят вместе с ним.
    DELETE FROM impuls.role_bindings WHERE action='task.return';
    ALTER TABLE impuls.role_bindings DROP CONSTRAINT role_bindings_action_check;
    ALTER TABLE impuls.role_bindings ADD CONSTRAINT role_bindings_action_check CHECK (action IN (${actions("")}
    ));
  `);
};
module.exports = { up, down };
