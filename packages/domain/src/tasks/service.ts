import { createHash } from "node:crypto";
import type {
  AssignTaskRequest,
  CreateTaskRequest,
  ReturnSubmissionRequest,
  StartTaskRequest,
  SubmitTaskRequest,
  Task,
  TaskDetail,
  TaskList,
} from "@impuls/contracts";
import type { Pool, PoolClient } from "pg";

export class TaskError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409 | 422,
    public readonly code: string,
    public readonly currentVersion?: number,
  ) {
    super(code);
  }
}

type TaskRow = {
  id: string;
  scope_id: string;
  assigned_to: string | null;
  current_submission_id: string | null;
  title: string;
  criteria: string;
  category: string;
  priority: Task["priority"];
  due_at: Date | null;
  base_xp: number;
  base_points: number;
  rule_set_version: number;
  status: Task["status"];
  version: number;
  updated_at: Date;
};

const taskColumns = `t.id, t.scope_id, t.assigned_to, t.current_submission_id, t.title, t.criteria,
  t.category, t.priority, t.due_at, t.base_xp, t.base_points,
  r.version AS rule_set_version, t.status, t.version, t.updated_at`;

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    scopeId: row.scope_id,
    assignedTo: row.assigned_to,
    currentSubmissionId: row.current_submission_id,
    title: row.title,
    criteria: row.criteria,
    category: row.category,
    priority: row.priority,
    dueAt: row.due_at?.toISOString() ?? null,
    baseXp: row.base_xp,
    basePoints: row.base_points,
    ruleSetVersion: row.rule_set_version,
    status: row.status,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function permission(
  client: PoolClient,
  actorId: string,
  action: string,
  scopeId: string,
) {
  const result = await client.query(
    `SELECT 1 FROM impuls.role_bindings b JOIN impuls.users u
       ON u.id = b.user_id AND u.active = true
      WHERE b.user_id = $1 AND b.action = $2 AND b.scope_id = $3
        AND b.revoked_at IS NULL AND b.valid_from <= now()
        AND (b.valid_until IS NULL OR b.valid_until > now())
      LIMIT 1 FOR SHARE OF b, u`,
    [actorId, action, scopeId],
  );
  if (!result.rowCount) throw new TaskError(403, "FORBIDDEN");
}

async function visibleTask(
  client: PoolClient,
  actorId: string,
  taskId: string,
  lock = false,
) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new TaskError(404, "NOT_FOUND");
  const result = await client.query<TaskRow>(
    `SELECT ${taskColumns} FROM impuls.tasks t
       JOIN impuls.rule_sets r ON r.id = t.rule_set_id
      WHERE t.id = $1 AND (
        t.assigned_to = $2 OR t.created_by = $2 OR EXISTS (
          SELECT 1 FROM impuls.role_bindings b
          WHERE b.user_id = $2 AND b.scope_id = t.scope_id
            AND b.action IN ('task.create', 'task.assign', 'task.review')
            AND b.revoked_at IS NULL AND b.valid_from <= now()
            AND (b.valid_until IS NULL OR b.valid_until > now())))
      ${lock ? "FOR UPDATE OF t" : ""}`,
    [taskId, actorId],
  );
  if (!result.rows[0]) throw new TaskError(404, "NOT_FOUND");
  return result.rows[0];
}

function checkVersion(row: TaskRow, expected: number) {
  if (row.version !== expected)
    throw new TaskError(409, "VERSION_CONFLICT", row.version);
}

async function updatedTask(client: PoolClient, taskId: string): Promise<Task> {
  const result = await client.query<TaskRow>(
    `SELECT ${taskColumns} FROM impuls.tasks t
       JOIN impuls.rule_sets r ON r.id = t.rule_set_id WHERE t.id = $1`,
    [taskId],
  );
  return toTask(result.rows[0]!);
}

function digest(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}

async function mutate<T>(
  pool: Pool,
  actorId: string,
  operation: string,
  key: string,
  body: unknown,
  authorize: (client: PoolClient) => Promise<void>,
  apply: (client: PoolClient) => Promise<{ status: number; data: T }>,
): Promise<{ status: number; data: T }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await authorize(client);
    // A transaction-scoped lock serializes retries before the receipt exists.
    const lock = digest([actorId, operation, key]);
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      lock.readInt32BE(0),
      lock.readInt32BE(4),
    ]);
    const hash = digest(body);
    const prior = await client.query<{
      request_hash: Buffer;
      status: number;
      response: T;
    }>(
      `SELECT request_hash, status, response FROM impuls.mutation_receipts
        WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3`,
      [actorId, operation, key],
    );
    if (prior.rows[0]) {
      if (!prior.rows[0].request_hash.equals(hash))
        throw new TaskError(409, "IDEMPOTENCY_CONFLICT");
      await client.query("COMMIT");
      return { status: prior.rows[0].status, data: prior.rows[0].response };
    }
    const result = await apply(client);
    await client.query(
      `INSERT INTO impuls.mutation_receipts
        (actor_id, operation, idempotency_key, request_hash, status, response)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        actorId,
        operation,
        key,
        hash,
        result.status,
        JSON.stringify(result.data),
      ],
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createTask(
  pool: Pool,
  actorId: string,
  key: string,
  body: CreateTaskRequest,
) {
  return mutate(
    pool,
    actorId,
    "task.create",
    key,
    body,
    (client) => permission(client, actorId, "task.create", body.scopeId),
    async (client) => {
      const rules = await client.query<{
        max_task_xp: number;
        max_task_points: number;
      }>(
        `SELECT max_task_xp, max_task_points FROM impuls.rule_sets
          WHERE id = $1 AND active_from <= now()`,
        [body.ruleSetId],
      );
      const rule = rules.rows[0];
      if (!rule) throw new TaskError(422, "RULES_UNAVAILABLE");
      if (
        body.baseXp > rule.max_task_xp ||
        body.basePoints > rule.max_task_points
      )
        throw new TaskError(422, "FUND_OUT_OF_RANGE");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO impuls.tasks
         (scope_id, created_by, rule_set_id, title, criteria, category,
          priority, due_at, base_xp, base_points)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          body.scopeId,
          actorId,
          body.ruleSetId,
          body.title,
          body.criteria,
          body.category,
          body.priority,
          body.dueAt,
          body.baseXp,
          body.basePoints,
        ],
      );
      return {
        status: 201,
        data: { task: await updatedTask(client, inserted.rows[0]!.id) },
      };
    },
  );
}

export async function assignTask(
  pool: Pool,
  actorId: string,
  taskId: string,
  key: string,
  body: AssignTaskRequest,
) {
  return mutate(
    pool,
    actorId,
    `task.assign:${taskId}`,
    key,
    body,
    async (client) => {
      const task = await visibleTask(client, actorId, taskId);
      await permission(client, actorId, "task.assign", task.scope_id);
    },
    async (client) => {
      const task = await visibleTask(client, actorId, taskId, true);
      checkVersion(task, body.expectedVersion);
      if (task.status !== "draft")
        throw new TaskError(409, "STATE_CONFLICT", task.version);
      const user = await client.query(
        "SELECT 1 FROM impuls.users WHERE id = $1 AND active = true FOR SHARE",
        [body.assigneeId],
      );
      if (!user.rowCount) throw new TaskError(422, "ASSIGNEE_UNAVAILABLE");
      await client.query(
        `UPDATE impuls.tasks SET assigned_to = $2, status = 'assigned',
          version = version + 1, updated_at = now() WHERE id = $1`,
        [taskId, body.assigneeId],
      );
      await client.query(
        `INSERT INTO impuls.task_assignments (task_id, user_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [taskId, body.assigneeId, actorId],
      );
      return { status: 200, data: { task: await updatedTask(client, taskId) } };
    },
  );
}

export async function startTask(
  pool: Pool,
  actorId: string,
  taskId: string,
  key: string,
  body: StartTaskRequest,
) {
  return mutate(
    pool,
    actorId,
    `task.start:${taskId}`,
    key,
    body,
    async (client) => {
      const task = await visibleTask(client, actorId, taskId);
      if (task.assigned_to !== actorId) throw new TaskError(404, "NOT_FOUND");
    },
    async (client) => {
      const task = await visibleTask(client, actorId, taskId, true);
      checkVersion(task, body.expectedVersion);
      if (task.status !== "assigned" && task.status !== "needs_work")
        throw new TaskError(409, "STATE_CONFLICT", task.version);
      await client.query(
        `UPDATE impuls.tasks SET status = 'in_progress', version = version + 1,
          updated_at = now() WHERE id = $1`,
        [taskId],
      );
      return { status: 200, data: { task: await updatedTask(client, taskId) } };
    },
  );
}

export async function submitTask(
  pool: Pool,
  actorId: string,
  taskId: string,
  key: string,
  body: SubmitTaskRequest,
) {
  return mutate(
    pool,
    actorId,
    `task.submit:${taskId}`,
    key,
    body,
    async (client) => {
      const task = await visibleTask(client, actorId, taskId);
      if (task.assigned_to !== actorId) throw new TaskError(404, "NOT_FOUND");
    },
    async (client) => {
      const task = await visibleTask(client, actorId, taskId, true);
      checkVersion(task, body.expectedVersion);
      if (task.status !== "in_progress")
        throw new TaskError(409, "STATE_CONFLICT", task.version);
      const submission = await client.query<{ id: string }>(
        `INSERT INTO impuls.submissions (task_id, author_id, report)
         VALUES ($1, $2, $3) RETURNING id`,
        [taskId, actorId, body.report],
      );
      await client.query(
        `UPDATE impuls.tasks SET status = 'in_review', current_submission_id = $2,
          version = version + 1, updated_at = now() WHERE id = $1`,
        [taskId, submission.rows[0]!.id],
      );
      return {
        status: 201,
        data: {
          task: await updatedTask(client, taskId),
          submissionId: submission.rows[0]!.id,
        },
      };
    },
  );
}

export async function returnSubmission(
  pool: Pool,
  actorId: string,
  submissionId: string,
  key: string,
  body: ReturnSubmissionRequest,
) {
  if (!/^[0-9a-f-]{36}$/i.test(submissionId))
    throw new TaskError(404, "NOT_FOUND");
  return mutate(
    pool,
    actorId,
    `submission.return:${submissionId}`,
    key,
    body,
    async (client) => {
      const result = await client.query<{ scope_id: string }>(
        `SELECT t.scope_id FROM impuls.submissions s
          JOIN impuls.tasks t ON t.id = s.task_id WHERE s.id = $1`,
        [submissionId],
      );
      if (!result.rows[0]) throw new TaskError(404, "NOT_FOUND");
      const visibility = await client.query(
        `SELECT 1 FROM impuls.role_bindings b WHERE b.user_id = $1
          AND b.scope_id = $2 AND b.action = 'task.review'
          AND b.revoked_at IS NULL AND b.valid_from <= now()
          AND (b.valid_until IS NULL OR b.valid_until > now()) LIMIT 1`,
        [actorId, result.rows[0].scope_id],
      );
      if (!visibility.rowCount) throw new TaskError(404, "NOT_FOUND");
      await permission(client, actorId, "task.review", result.rows[0].scope_id);
    },
    async (client) => {
      const result = await client.query<{
        task_id: string;
        scope_id: string;
        current_submission_id: string | null;
      }>(
        `SELECT t.id AS task_id, t.scope_id, t.current_submission_id
           FROM impuls.submissions s JOIN impuls.tasks t ON t.id = s.task_id
          WHERE s.id = $1 FOR UPDATE OF t`,
        [submissionId],
      );
      const row = result.rows[0];
      if (!row || row.current_submission_id !== submissionId)
        throw new TaskError(409, "STATE_CONFLICT");
      const task = await visibleTask(client, actorId, row.task_id);
      if (task.assigned_to === actorId) throw new TaskError(403, "FORBIDDEN");
      checkVersion(task, body.expectedVersion);
      if (task.status !== "in_review")
        throw new TaskError(409, "STATE_CONFLICT", task.version);
      await client.query(
        `UPDATE impuls.tasks SET status = 'needs_work', version = version + 1,
          updated_at = now() WHERE id = $1`,
        [row.task_id],
      );
      // Review history is a separate immutable record. Acceptance will be added
      // with the ledger transaction, never as a status-only update.
      await client.query(
        `INSERT INTO impuls.reviews (submission_id, reviewer_id, decision, reason)
         VALUES ($1, $2, 'returned', $3)`,
        [submissionId, actorId, body.reason],
      );
      return {
        status: 200,
        data: { task: await updatedTask(client, row.task_id) },
      };
    },
  );
}

export async function getTask(
  pool: Pool,
  actorId: string,
  taskId: string,
): Promise<Task> {
  const client = await pool.connect();
  try {
    return toTask(await visibleTask(client, actorId, taskId));
  } finally {
    client.release();
  }
}

export async function getTaskDetail(
  pool: Pool,
  actorId: string,
  taskId: string,
): Promise<TaskDetail> {
  const client = await pool.connect();
  try {
    const task = await visibleTask(client, actorId, taskId);
    if (!task.current_submission_id)
      return { task: toTask(task), submission: null, returnReason: null };
    const result = await client.query<{
      id: string;
      report: string;
      created_at: Date;
      reason: string | null;
    }>(
      `SELECT s.id, s.report, s.created_at, sr.reason
         FROM impuls.submissions s LEFT JOIN impuls.reviews sr
           ON sr.submission_id = s.id WHERE s.id = $1`,
      [task.current_submission_id],
    );
    const submission = result.rows[0];
    return {
      task: toTask(task),
      submission: submission
        ? {
            id: submission.id,
            report: submission.report,
            createdAt: submission.created_at.toISOString(),
          }
        : null,
      returnReason: submission?.reason ?? null,
    };
  } finally {
    client.release();
  }
}

export async function listTasks(
  pool: Pool,
  actorId: string,
  cursor?: string,
): Promise<TaskList> {
  let before: { updatedAt: string; id: string } | null = null;
  if (cursor) {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      );
      if (
        typeof parsed !== "object" ||
        !parsed ||
        !("updatedAt" in parsed) ||
        !("id" in parsed) ||
        typeof parsed.updatedAt !== "string" ||
        typeof parsed.id !== "string" ||
        !Number.isFinite(Date.parse(parsed.updatedAt)) ||
        !/^[0-9a-f-]{36}$/i.test(parsed.id)
      )
        throw new Error("invalid cursor");
      before = { updatedAt: parsed.updatedAt, id: parsed.id };
    } catch {
      throw new TaskError(422, "INVALID_CURSOR");
    }
  }
  const result = await pool.query<TaskRow>(
    `SELECT ${taskColumns} FROM impuls.tasks t
       JOIN impuls.rule_sets r ON r.id = t.rule_set_id
      WHERE (t.assigned_to = $1 OR t.created_by = $1 OR EXISTS (
        SELECT 1 FROM impuls.role_bindings b WHERE b.user_id = $1
          AND b.scope_id = t.scope_id
          AND b.action IN ('task.create', 'task.assign', 'task.review')
          AND b.revoked_at IS NULL AND b.valid_from <= now()
          AND (b.valid_until IS NULL OR b.valid_until > now())))
        AND ($2::timestamptz IS NULL OR (t.updated_at, t.id) < ($2::timestamptz, $3::uuid))
      ORDER BY t.updated_at DESC, t.id DESC LIMIT 21`,
    [actorId, before?.updatedAt ?? null, before?.id ?? null],
  );
  const page = result.rows.slice(0, 20);
  const last = page.at(-1);
  return {
    tasks: page.map(toTask),
    nextCursor:
      result.rows.length > 20 && last
        ? Buffer.from(
            JSON.stringify({
              updatedAt: last.updated_at.toISOString(),
              id: last.id,
            }),
          ).toString("base64url")
        : null,
    updatedAt: new Date().toISOString(),
  };
}
