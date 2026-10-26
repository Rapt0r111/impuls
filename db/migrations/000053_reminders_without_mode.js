// ADR-0029, этап 2 (продолжение 000052). Напоминания о сроке задач больше не пишут 'synthetic' в очередь:
// воркер уже без фильтра по метке (Edge-функции v5, 26.10.2026). Столбцы mode остаются как есть.
// Владелец функции postgres, поэтому обычный CREATE OR REPLACE (в отличие от функций истечения).
const up = (pgm) => {
  pgm.sql(`
CREATE OR REPLACE FUNCTION impuls.enqueue_task_due_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
        INSERT INTO impuls.notification_outbox(recipient_id,task_id,kind,created_at,updated_at)
        SELECT user_id,task_id,'task.due_soon',clock_timestamp(),clock_timestamp() FROM due
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO enqueued FROM inserted;
      RETURN enqueued;
    END $function$;
`);
};
const down = (pgm) => {
  pgm.sql(`
CREATE OR REPLACE FUNCTION impuls.enqueue_task_due_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    END $function$;
`);
};
module.exports = { up, down };
