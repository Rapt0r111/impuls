import type { Pool } from "pg";
import { taskHistoryVisibility } from "./history-access";

type Person = { id: string; displayName: string };
export type TaskTimeline = {
  taskId: string;
  asOf: string;
  nextCursor: number | null;
  items: {
    id: string;
    taskVersion: number;
    kind:
      | "snapshot"
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
    status:
      | "draft"
      | "assigned"
      | "in_progress"
      | "in_review"
      | "needs_work"
      | "accepted"
      | "cancelled"
      | "awaiting_verification"
      | "awaiting_commander";
    occurredAt: string;
    actor: Person | null;
    assignee: Person | null;
    ruleVersion: number;
    fundXp: number;
    fundPoints: number;
    submissionId: string | null;
    reviewId: string | null;
    reason: string | null;
    taskSnapshot: {
      title: string;
      criteria: string;
      categoryCode: string;
      priority: "critical" | "high" | "normal";
      dueAt: string;
    } | null;
  }[];
};
type Row = {
  active: boolean | null;
  session_valid: boolean;
  session_revoked: boolean;
  task_visible: boolean;
  as_of: Date;
  id: string | null;
  task_version: number;
  kind: TaskTimeline["items"][number]["kind"];
  status: TaskTimeline["items"][number]["status"];
  created_at: Date;
  actor_id: string | null;
  actor_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  rule_version: number;
  fund_xp: number;
  fund_points: number;
  submission_id: string | null;
  review_id: string | null;
  reason: string | null;
  task_snapshot: TaskTimeline["items"][number]["taskSnapshot"];
};

export async function readTaskTimeline(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  taskId: string,
  options: { limit?: number; cursor?: number | undefined } = {},
): Promise<
  | { kind: "ok"; response: TaskTimeline }
  | { kind: "unauthorized" }
  | { kind: "revoked" }
  | { kind: "not_found" }
> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const result = await pool.query<Row>(
    `WITH access AS MATERIALIZED (
      SELECT (SELECT active FROM impuls.users WHERE id=$1) AS active,
        EXISTS (SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
          AND revoked_at IS NULL AND expires_at > clock_timestamp()) AS session_valid,
        EXISTS (SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NOT NULL) AS session_revoked,
        ${taskHistoryVisibility} AS task_visible, clock_timestamp() AS as_of
    )
    SELECT access.*, e.*, actor.display_name AS actor_name, assignee.display_name AS assignee_name,
      r.version_number AS rule_version
    FROM access LEFT JOIN LATERAL (
      SELECT * FROM impuls.task_events WHERE access.active AND access.session_valid AND access.task_visible
        AND task_id=$3 AND ($4::integer IS NULL OR task_version < $4)
      ORDER BY task_version DESC LIMIT $5
    ) e ON true
    LEFT JOIN impuls.users actor ON actor.id=e.actor_id
    LEFT JOIN impuls.users assignee ON assignee.id=e.assignee_id
    LEFT JOIN impuls.rule_sets r ON r.id=e.rule_set_id
    ORDER BY e.task_version DESC`,
    [actorId, sessionHash, taskId, options.cursor ?? null, limit + 1],
  );
  const gate = result.rows[0]!;
  if (!gate.active || gate.session_revoked) return { kind: "revoked" };
  if (!gate.session_valid) return { kind: "unauthorized" };
  if (!gate.task_visible) return { kind: "not_found" };
  const records = result.rows.filter((row) => row.id !== null);
  const rows = records.slice(0, limit);
  return {
    kind: "ok",
    response: {
      taskId,
      asOf: gate.as_of.toISOString(),
      nextCursor: records.length > limit ? rows.at(-1)!.task_version : null,
      items: rows.map((row) => ({
        id: row.id!,
        taskVersion: row.task_version,
        kind: row.kind,
        status: row.status,
        occurredAt: row.created_at.toISOString(),
        actor: row.actor_id
          ? { id: row.actor_id, displayName: row.actor_name! }
          : null,
        assignee: row.assignee_id
          ? { id: row.assignee_id, displayName: row.assignee_name! }
          : null,
        ruleVersion: row.rule_version,
        fundXp: row.fund_xp,
        fundPoints: row.fund_points,
        submissionId: row.submission_id,
        reviewId: row.review_id,
        reason: row.reason,
        taskSnapshot: row.task_snapshot
          ? {
              ...row.task_snapshot,
              dueAt: new Date(row.task_snapshot.dueAt).toISOString(),
            }
          : null,
      })),
    },
  };
}
