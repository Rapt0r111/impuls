const rewardKinds = `'reward.reserved','reward.cancelled','reward.approved','reward.rejected','reward.fulfilled','reward.expired'`;
const kinds = `'task.accepted','task.returned','task.assigned','ledger.corrected',${rewardKinds}`;

const up = (pgm) => {
  pgm.sql(`
    -- ADR-0037: the creator of a free task is told when a participant takes it.
    -- One more task-bound kind; delivery reuses the leased queue unchanged.
    ALTER TABLE impuls.notification_outbox
      DROP CONSTRAINT notification_outbox_kind_check,
      DROP CONSTRAINT notification_outbox_object_check;
    ALTER TABLE impuls.notification_outbox
      ADD CONSTRAINT notification_outbox_kind_check CHECK (kind IN (${kinds},'task.due_soon','task.claimed')),
      ADD CONSTRAINT notification_outbox_object_check CHECK (
        (kind IN ('task.accepted','task.returned') AND review_id IS NOT NULL AND task_id IS NULL
          AND correction_id IS NULL AND redemption_id IS NULL)
        OR (kind IN ('task.assigned','task.due_soon','task.claimed') AND review_id IS NULL AND task_id IS NOT NULL
          AND correction_id IS NULL AND redemption_id IS NULL)
        OR (kind = 'ledger.corrected' AND review_id IS NULL AND task_id IS NULL
          AND correction_id IS NOT NULL AND redemption_id IS NULL)
        OR (kind IN (${rewardKinds}) AND review_id IS NULL AND task_id IS NULL
          AND correction_id IS NULL AND redemption_id IS NOT NULL));
    -- A task is taken at most once, so at most one such notification per task.
    CREATE UNIQUE INDEX notification_outbox_task_claimed_unique
      ON impuls.notification_outbox (task_id) WHERE kind = 'task.claimed';
  `);
};
const down = () => {
  throw new Error("Keep notification history; use a forward migration");
};
module.exports = { up, down };
