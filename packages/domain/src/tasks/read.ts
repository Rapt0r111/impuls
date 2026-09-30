import type { Pool, PoolClient } from "pg";

export type AssignedTaskStatus =
  | "assigned"
  | "in_progress"
  | "in_review"
  | "needs_work"
  | "accepted"
  | "cancelled";

export type AssignedTaskSummary = {
  id: string;
  title: string;
  status: AssignedTaskStatus;
  priority: "critical" | "high" | "normal";
  dueAt: string;
  fundXp: number;
  fundPoints: number;
  ruleVersion: number;
  version: number;
  updatedAt: string;
};

export type AssignedTaskDetail = AssignedTaskSummary & {
  criteria: string;
  scope: { id: string; kind: "rota" | "group" | "project"; name: string };
  latestSubmission: {
    id: string;
    text: string;
    version: number;
    createdAt: string;
  } | null;
};

type TaskRow = {
  id: string;
  title: string;
  criteria: string;
  status: AssignedTaskStatus;
  priority: AssignedTaskSummary["priority"];
  due_at: Date;
  fund_xp: number;
  fund_points: number;
  rule_version: number;
  version: number;
  updated_at: Date;
  scope_id: string;
  scope_kind: AssignedTaskDetail["scope"]["kind"];
  scope_name: string;
  submission_id: string | null;
  submission_text: string | null;
  submission_version: number | null;
  submission_created_at: Date | null;
};

const visibleStatuses = [
  "assigned",
  "in_progress",
  "in_review",
  "needs_work",
  "accepted",
  "cancelled",
] as const;

const selectAssignedTasks = `
  SELECT t.id, t.title, t.criteria, t.status, t.priority, t.due_at,
         t.fund_xp, t.fund_points, r.version_number AS rule_version,
         t.version, t.updated_at,
         s.id AS scope_id, s.kind AS scope_kind, s.name AS scope_name,
         latest.id AS submission_id, latest.text AS submission_text,
         latest.version AS submission_version,
         latest.created_at AS submission_created_at
    FROM impuls.task_assignments AS a
    JOIN impuls.tasks AS t ON t.id = a.task_id
    JOIN impuls.rule_sets AS r ON r.id = t.rule_set_id
    JOIN impuls.access_scopes AS s ON s.id = t.scope_id
    JOIN impuls.users AS u ON u.id = a.user_id AND u.active = true
    LEFT JOIN LATERAL (
      SELECT sub.id, sub.text, sub.version, sub.created_at
        FROM impuls.submissions AS sub
       WHERE sub.task_id = t.id
       ORDER BY sub.attempt_number DESC LIMIT 1
    ) AS latest ON true
   WHERE a.user_id = $1
     AND t.status = ANY($2::text[])
`;

function summary(row: TaskRow): AssignedTaskSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at.toISOString(),
    fundXp: row.fund_xp,
    fundPoints: row.fund_points,
    ruleVersion: row.rule_version,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listAssignedTasks(
  pool: Pool,
  userId: string,
  options: {
    limit?: number;
    cursor?: string | undefined;
    status?: AssignedTaskStatus | undefined;
  } = {},
): Promise<{ items: AssignedTaskSummary[]; nextCursor: string | null }> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const result = await pool.query<TaskRow>(
    `${selectAssignedTasks}
       AND ($3::uuid IS NULL OR t.id > $3::uuid)
       ORDER BY t.id ASC LIMIT $4`,
    [
      userId,
      options.status ? [options.status] : visibleStatuses,
      options.cursor ?? null,
      limit + 1,
    ],
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map(summary),
    nextCursor: hasMore ? rows.at(-1)!.id : null,
  };
}

export async function getAssignedTask(
  pool: Pool | PoolClient,
  userId: string,
  taskId: string,
): Promise<AssignedTaskDetail | null> {
  const result = await pool.query<TaskRow>(
    `${selectAssignedTasks} AND t.id = $3::uuid LIMIT 1`,
    [userId, visibleStatuses, taskId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...summary(row),
    criteria: row.criteria,
    scope: { id: row.scope_id, kind: row.scope_kind, name: row.scope_name },
    latestSubmission:
      row.submission_id &&
      row.submission_text &&
      row.submission_version &&
      row.submission_created_at
        ? {
            id: row.submission_id,
            text: row.submission_text,
            version: row.submission_version,
            createdAt: row.submission_created_at.toISOString(),
          }
        : null,
  };
}
