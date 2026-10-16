import type { PoolClient } from "pg";

// Call only inside the domain mutation transaction, after updating the task.
// The locked task's version makes retries and concurrent transitions unique.
export async function appendTaskEvent(
  client: PoolClient,
  input: {
    taskId: string;
    actorId: string;
    kind:
      | "created"
      | "assigned"
      | "started"
      | "submitted"
      | "returned"
      | "accepted"
      | "edited"
      | "cancelled"
      | "proposed"
      | "verified"
      | "approved"
      | "declined";
    reason?: string;
    submissionId?: string;
    reviewId?: string;
  },
) {
  const result = await client.query(
    `INSERT INTO impuls.task_events
      (task_id,task_version,kind,actor_id,assignee_id,status,rule_set_id,fund_xp,fund_points,submission_id,review_id,created_at,reason,task_snapshot)
     SELECT t.id,t.version,$2,$3,a.user_id,t.status,t.rule_set_id,t.fund_xp,t.fund_points,$4,$5,t.updated_at,$6,
       jsonb_build_object('title',t.title,'criteria',t.criteria,'categoryCode',t.category_code,'priority',t.priority,'dueAt',t.due_at)
     FROM impuls.tasks t LEFT JOIN impuls.task_assignments a ON a.task_id=t.id WHERE t.id=$1`,
    [
      input.taskId,
      input.kind,
      input.actorId,
      input.submissionId ?? null,
      input.reviewId ?? null,
      input.reason ?? null,
    ],
  );
  if (result.rowCount !== 1) throw new Error("Task event was not recorded");
}
