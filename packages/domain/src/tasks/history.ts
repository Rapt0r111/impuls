import type { Pool } from "pg";

type HistoryReview = {
  id: string;
  reason: string;
  createdAt: string;
  reviewer: { id: string; displayName: string };
} & (
  | { decision: "return"; fundXp: null; fundPoints: null }
  | { decision: "accept"; fundXp: number; fundPoints: number }
);
export type TaskHistory = {
  taskId: string;
  items: {
    id: string;
    attemptNumber: number;
    text: string;
    submittedAt: string;
    review: HistoryReview | null;
  }[];
  nextCursor: number | null;
  asOf: string;
};
type HistoryRow = {
  active: boolean | null;
  session_valid: boolean;
  session_revoked: boolean;
  task_visible: boolean;
  as_of: Date;
  id: string | null;
  attempt_number: number;
  text: string;
  submitted_at: Date;
  review_id: string | null;
  decision: "accept" | "return";
  reason: string;
  reviewed_at: Date;
  reviewer_id: string;
  reviewer_name: string;
  fund_xp: number;
  fund_points: number;
};

export async function readAssignedTaskHistory(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  taskId: string,
  options: { limit?: number; cursor?: number | undefined } = {},
): Promise<
  | { kind: "ok"; response: TaskHistory }
  | { kind: "revoked" }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  // One statement keeps object authorization and content in the same snapshot.
  // The left join preserves the distinction between an empty and hidden task.
  const result = await pool.query<HistoryRow>(
    `
    WITH access AS MATERIALIZED (
      SELECT (SELECT active FROM impuls.users WHERE id = $1) AS active,
        EXISTS (SELECT 1 FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2
          AND revoked_at IS NULL AND expires_at > clock_timestamp()) AS session_valid,
        EXISTS (SELECT 1 FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2
          AND revoked_at IS NOT NULL) AS session_revoked,
        EXISTS (SELECT 1 FROM impuls.task_assignments a JOIN impuls.tasks t ON t.id = a.task_id
          WHERE a.user_id = $1 AND t.id = $3
            AND t.status IN ('assigned','in_progress','in_review','needs_work','accepted','cancelled')) AS task_visible,
        clock_timestamp() AS as_of
    )
    SELECT access.*, sub.id, sub.attempt_number, sub.text, sub.created_at AS submitted_at,
      r.id AS review_id, r.decision, r.reason, r.created_at AS reviewed_at,
      r.reviewer_id, u.display_name AS reviewer_name, r.fund_xp, r.fund_points
    FROM access
    LEFT JOIN LATERAL (
      SELECT id, attempt_number, text, created_at FROM impuls.submissions
      WHERE access.active AND access.session_valid AND access.task_visible AND task_id = $3
        AND ($4::integer IS NULL OR attempt_number < $4)
      ORDER BY attempt_number DESC LIMIT $5
    ) sub ON true
    LEFT JOIN impuls.reviews r ON r.submission_id = sub.id
    LEFT JOIN impuls.users u ON u.id = r.reviewer_id
    ORDER BY sub.attempt_number DESC`,
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
      nextCursor: records.length > limit ? rows.at(-1)!.attempt_number : null,
      items: rows.map((row) => ({
        id: row.id!,
        attemptNumber: row.attempt_number,
        text: row.text,
        submittedAt: row.submitted_at.toISOString(),
        review: row.review_id
          ? {
              id: row.review_id,
              reason: row.reason,
              createdAt: row.reviewed_at.toISOString(),
              reviewer: { id: row.reviewer_id, displayName: row.reviewer_name },
              ...(row.decision === "accept"
                ? {
                    decision: "accept" as const,
                    fundXp: row.fund_xp,
                    fundPoints: row.fund_points,
                  }
                : {
                    decision: "return" as const,
                    fundXp: null,
                    fundPoints: null,
                  }),
            }
          : null,
      })),
    },
  };
}
