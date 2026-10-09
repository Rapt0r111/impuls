const kinds = `'task.accepted','task.returned','task.assigned','ledger.corrected',
  'reward.reserved','reward.cancelled','reward.approved','reward.rejected','reward.fulfilled','reward.expired'`;
const rewardKinds = `'reward.reserved','reward.cancelled','reward.approved','reward.rejected','reward.fulfilled','reward.expired'`;

const up = (pgm) => {
  pgm.sql(`
    -- A reminder is one more task-bound event kind; delivery reuses the leased queue unchanged.
    ALTER TABLE impuls.notification_outbox
      DROP CONSTRAINT notification_outbox_kind_check,
      DROP CONSTRAINT notification_outbox_object_check;
    ALTER TABLE impuls.notification_outbox
      ADD CONSTRAINT notification_outbox_kind_check CHECK (kind IN (${kinds},'task.due_soon')),
      ADD CONSTRAINT notification_outbox_object_check CHECK (
        (kind IN ('task.accepted','task.returned') AND review_id IS NOT NULL AND task_id IS NULL
          AND correction_id IS NULL AND redemption_id IS NULL)
        OR (kind IN ('task.assigned','task.due_soon') AND review_id IS NULL AND task_id IS NOT NULL
          AND correction_id IS NULL AND redemption_id IS NULL)
        OR (kind = 'ledger.corrected' AND review_id IS NULL AND task_id IS NULL
          AND correction_id IS NOT NULL AND redemption_id IS NULL)
        OR (kind IN (${rewardKinds}) AND review_id IS NULL AND task_id IS NULL
          AND correction_id IS NULL AND redemption_id IS NOT NULL));
    -- At most one reminder per task: tasks have exactly one assignee (task_assignments.task_id is unique).
    CREATE UNIQUE INDEX notification_outbox_due_reminder_unique
      ON impuls.notification_outbox (task_id) WHERE kind = 'task.due_soon';

    -- Enqueues reminders for assigned work whose deadline is within the next 24 hours.
    -- The window is a fixed technical default, not an agreed rule (P-04). Open work only; the
    -- assignee must still be active. Safe to repeat: the unique index makes it idempotent.
    CREATE FUNCTION impuls.enqueue_task_due_reminders() RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE enqueued integer;
    BEGIN
      WITH due AS (
        SELECT t.id AS task_id, a.user_id
        FROM impuls.tasks t
        JOIN impuls.task_assignments a ON a.task_id=t.id
        JOIN impuls.users u ON u.id=a.user_id AND u.active
        WHERE t.status IN ('assigned','in_progress','needs_work')
          AND t.due_at > clock_timestamp() AND t.due_at <= clock_timestamp() + interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM impuls.notification_outbox o
            WHERE o.task_id=t.id AND o.kind='task.due_soon')
        ORDER BY t.due_at, t.id
        LIMIT 50
      ), inserted AS (
        INSERT INTO impuls.notification_outbox(recipient_id,task_id,kind,mode,created_at,updated_at)
        SELECT user_id,task_id,'task.due_soon','synthetic',clock_timestamp(),clock_timestamp() FROM due
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO enqueued FROM inserted;
      RETURN enqueued;
    END $$;
    REVOKE ALL ON FUNCTION impuls.enqueue_task_due_reminders() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION impuls.enqueue_task_due_reminders() TO impuls_worker;
  `);
};
const down = () => {
  throw new Error("Keep notification history; use a forward migration");
};
module.exports = { up, down };
