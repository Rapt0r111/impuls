// Embedded only in the single-statement history queries. $1 actor, $3 task.
// Mutation rights never imply access to another participant's history.
export const taskHistoryVisibility = `EXISTS (
  SELECT 1 FROM impuls.tasks t WHERE t.id = $3 AND (
    (t.status IN ('assigned','in_progress','in_review','needs_work','accepted','cancelled')
      AND EXISTS (SELECT 1 FROM impuls.task_assignments a WHERE a.task_id=t.id AND a.user_id=$1))
    OR EXISTS (SELECT 1 FROM impuls.role_bindings b WHERE b.user_id=$1 AND b.action='task.view'
      AND b.scope_id=t.scope_id AND b.revoked_at IS NULL AND b.valid_from <= clock_timestamp()
      AND (b.valid_until IS NULL OR b.valid_until > clock_timestamp()))
  )
)`;
