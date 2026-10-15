import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AssignedTaskStatus } from "./read";
import { appendTaskEvent } from "./events";

type Scope = { id: string; kind: "rota" | "group" | "project"; name: string };
type Assignee = { id: string; displayName: string };
export type ManagedTask = {
  id: string;
  title: string;
  criteria: string;
  categoryCode: string;
  priority: "critical" | "high" | "normal";
  status: "draft" | AssignedTaskStatus;
  dueAt: string;
  fundXp: number;
  fundPoints: number;
  ruleSetId: string;
  ruleVersion: number;
  version: number;
  updatedAt: string;
  scope: Scope;
  assignee: Assignee | null;
  openForClaim: boolean;
};
export type CreateTaskData = {
  scopeId: string;
  ruleSetId: string;
  title: string;
  criteria: string;
  categoryCode: string;
  priority: ManagedTask["priority"];
  dueAt: string;
  fundXp: number;
  fundPoints: number;
  openForClaim: boolean;
};
type MutationBase = {
  actorId: string;
  sessionHash: Buffer;
  idempotencyKey: string;
  requestId: string;
  enabled: boolean;
};
export type CreateTaskInput = MutationBase & { data: CreateTaskData };
export type AssignTaskInput = MutationBase & {
  taskId: string;
  data: { assigneeId: string; expectedVersion: number };
};
export type EditTaskInput = MutationBase & {
  taskId: string;
  data: Omit<CreateTaskData, "scopeId" | "ruleSetId" | "openForClaim"> & {
    expectedVersion: number;
    reason: string;
  };
};
export type CancelTaskInput = MutationBase & {
  taskId: string;
  data: { expectedVersion: number; reason: string };
};
export type TaskManagementResult =
  | { kind: "ok"; status: 200 | 201; response: { task: ManagedTask } }
  | {
      kind:
        | "revoked"
        | "unauthorized"
        | "not_found"
        | "idempotency_conflict"
        | "disabled"
        | "rules_invalid"
        | "assignee_invalid";
    }
  | { kind: "conflict"; currentVersion: number };

const activeBinding = `b.user_id = $1 AND b.revoked_at IS NULL
  AND b.valid_from <= clock_timestamp()
  AND (b.valid_until IS NULL OR b.valid_until > clock_timestamp())`;
const manageBinding = `${activeBinding} AND b.action IN ('task.view', 'task.create', 'task.assign', 'task.edit', 'task.cancel')`;
const selectTask = `SELECT t.id, t.title, t.criteria, t.category_code, t.priority,
  t.status, t.due_at, t.fund_xp, t.fund_points, t.rule_set_id, r.version_number,
  t.version, t.updated_at, s.id AS scope_id, s.kind, s.name,
  u.id AS assignee_id, u.display_name, t.open_for_claim
  FROM impuls.tasks t JOIN impuls.rule_sets r ON r.id = t.rule_set_id
  JOIN impuls.access_scopes s ON s.id = t.scope_id
  LEFT JOIN impuls.task_assignments a ON a.task_id = t.id
  LEFT JOIN impuls.users u ON u.id = a.user_id`;
type TaskRow = {
  id: string;
  title: string;
  criteria: string;
  category_code: string;
  priority: ManagedTask["priority"];
  status: ManagedTask["status"];
  due_at: Date;
  fund_xp: number;
  fund_points: number;
  rule_set_id: string;
  version_number: number;
  version: number;
  updated_at: Date;
  scope_id: string;
  kind: Scope["kind"];
  name: string;
  assignee_id: string | null;
  display_name: string | null;
  open_for_claim: boolean;
};
function mapTask(row: TaskRow): ManagedTask {
  return {
    id: row.id,
    title: row.title,
    criteria: row.criteria,
    categoryCode: row.category_code,
    priority: row.priority,
    status: row.status,
    dueAt: row.due_at.toISOString(),
    fundXp: row.fund_xp,
    fundPoints: row.fund_points,
    ruleSetId: row.rule_set_id,
    ruleVersion: row.version_number,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
    scope: { id: row.scope_id, kind: row.kind, name: row.name },
    assignee:
      row.assignee_id && row.display_name
        ? { id: row.assignee_id, displayName: row.display_name }
        : null,
    openForClaim: row.open_for_claim,
  };
}
export async function listManagedTasks(
  pool: Pool,
  actorId: string,
  options: { cursor?: string | undefined; limit?: number } = {},
) {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const result = await pool.query<TaskRow>(
    `${selectTask}
    WHERE EXISTS (SELECT 1 FROM impuls.users actor WHERE actor.id = $1 AND actor.active)
    AND NOT t.self_submitted
    AND EXISTS (SELECT 1 FROM impuls.role_bindings b WHERE ${manageBinding} AND b.scope_id = t.scope_id)
    AND ($2::uuid IS NULL OR t.id > $2) ORDER BY t.id LIMIT $3`,
    [actorId, options.cursor ?? null, limit + 1],
  );
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map(mapTask),
    nextCursor: result.rows.length > limit ? rows.at(-1)!.id : null,
  };
}
export async function readTaskManagementOptions(
  pool: Pool,
  actorId: string,
  options: { enabled: boolean },
) {
  const scopes = await pool.query<{
    id: string;
    kind: Scope["kind"];
    name: string;
    can_create: boolean;
    can_assign: boolean;
    can_edit: boolean;
    can_cancel: boolean;
  }>(
    `SELECT s.id, s.kind, s.name, bool_or(b.action = 'task.create') AS can_create, bool_or(b.action = 'task.assign') AS can_assign,
       bool_or(b.action = 'task.edit') AS can_edit, bool_or(b.action = 'task.cancel') AS can_cancel
     FROM impuls.access_scopes s JOIN impuls.role_bindings b ON b.scope_id = s.id
     JOIN impuls.users actor ON actor.id = b.user_id AND actor.active
     WHERE ${manageBinding} GROUP BY s.id ORDER BY s.id`,
    [actorId],
  );
  const [members, rules] = await Promise.all([
    pool.query<{ scope_id: string; id: string; display_name: string }>(
      `SELECT m.scope_id, u.id, u.display_name FROM impuls.task_scope_members m
       JOIN impuls.users u ON u.id = m.user_id AND u.active
       WHERE m.scope_id = ANY($1::uuid[]) AND m.synthetic AND m.revoked_at IS NULL
       AND m.valid_from <= clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())
       AND EXISTS (SELECT 1 FROM impuls.users actor WHERE actor.id = $2 AND actor.active)
       AND EXISTS (SELECT 1 FROM impuls.role_bindings b WHERE b.user_id = $2 AND b.action = 'task.assign'
         AND b.scope_id = m.scope_id AND b.revoked_at IS NULL AND b.valid_from <= clock_timestamp()
         AND (b.valid_until IS NULL OR b.valid_until > clock_timestamp()))
       ORDER BY u.id`,
      [
        options.enabled
          ? scopes.rows.filter((s) => s.can_assign).map((s) => s.id)
          : [],
        actorId,
      ],
    ),
    pool.query<{ id: string; version_number: number }>(
      `SELECT id, version_number FROM impuls.rule_sets WHERE $1::boolean
       AND definition->>'mode' = 'synthetic' AND effective_from <= clock_timestamp()
       AND EXISTS (SELECT 1 FROM impuls.users actor WHERE actor.id = $2 AND actor.active)
       AND EXISTS (SELECT 1 FROM impuls.role_bindings b WHERE b.user_id = $2 AND b.action = 'task.create'
         AND b.revoked_at IS NULL AND b.valid_from <= clock_timestamp()
         AND (b.valid_until IS NULL OR b.valid_until > clock_timestamp()))
       ORDER BY version_number DESC`,
      [options.enabled, actorId],
    ),
  ]);
  return {
    scopes: scopes.rows.map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      canCreate: options.enabled && s.can_create,
      canAssign: options.enabled && s.can_assign,
      canEdit: options.enabled && s.can_edit,
      canCancel: options.enabled && s.can_cancel,
      assignees: members.rows
        .filter((m) => m.scope_id === s.id)
        .map((m) => ({ id: m.id, displayName: m.display_name })),
    })),
    ruleSets: rules.rows.map((r) => ({ id: r.id, version: r.version_number })),
  };
}

export function createTask(pool: Pool, input: CreateTaskInput) {
  return manageTask(pool, { ...input, action: "create" });
}
export function assignTask(pool: Pool, input: AssignTaskInput) {
  return manageTask(pool, { ...input, action: "assign" });
}
export function editTask(pool: Pool, input: EditTaskInput) {
  return manageTask(pool, { ...input, action: "edit" });
}
export function cancelTask(pool: Pool, input: CancelTaskInput) {
  return manageTask(pool, { ...input, action: "cancel" });
}
async function manageTask(
  pool: Pool,
  input:
    | (CreateTaskInput & { action: "create" })
    | (AssignTaskInput & { action: "assign" })
    | (EditTaskInput & { action: "edit" })
    | (CancelTaskInput & { action: "cancel" }),
): Promise<TaskManagementResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reject = async (result: TaskManagementResult) => {
      await client.query("ROLLBACK");
      return result;
    };
    const actor = await client.query<{ active: boolean }>(
      "SELECT active FROM impuls.users WHERE id = $1 FOR SHARE",
      [input.actorId],
    );
    if (actor.rows[0]?.active !== true)
      return await reject({ kind: "revoked" });
    let current:
      | {
          scope_id: string;
          rule_set_id: string;
          status: string;
          version: number;
        }
      | undefined;
    if (input.action !== "create") {
      // Restrict visibility before locking; no currentVersion leaks across scope.
      current = (
        await client.query<{
          scope_id: string;
          rule_set_id: string;
          status: string;
          version: number;
        }>(
          `SELECT t.scope_id, t.rule_set_id, t.status, t.version FROM impuls.tasks t
         WHERE t.id = $2 AND EXISTS (SELECT 1 FROM impuls.role_bindings b WHERE ${activeBinding} AND b.action = $3 AND b.scope_id = t.scope_id)
         FOR UPDATE OF t`,
          [input.actorId, input.taskId, `task.${input.action}`],
        )
      ).rows[0];
      if (!current) return await reject({ kind: "not_found" });
    }
    const scopeId =
      input.action === "create" ? input.data.scopeId : current!.scope_id;
    const action = `task.${input.action}`;
    // Locks serialize permission/session revocation with this operation.
    const bindings = await client.query(
      `SELECT b.id FROM impuls.role_bindings b WHERE ${activeBinding} AND b.action = $2 AND b.scope_id = $3 FOR SHARE`,
      [input.actorId, action, scopeId],
    );
    if (bindings.rowCount === 0) return await reject({ kind: "not_found" });
    const authorized = async () =>
      (
        await client.query(
          `SELECT s.id FROM impuls.sessions s WHERE s.user_id = $1 AND s.session_hash = $2
       AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp() FOR SHARE`,
          [input.actorId, input.sessionHash],
        )
      ).rowCount === 1;
    if (!(await authorized())) return await reject({ kind: "unauthorized" });
    if (!input.enabled) return await reject({ kind: "disabled" });
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          action: input.action,
          ...(input.action !== "create" ? { taskId: input.taskId } : {}),
          data: input.data,
        }),
      )
      .digest();
    const inserted = await client.query(
      `INSERT INTO impuls.idempotency_records (actor_id, operation, key, request_hash)
      VALUES ($1,$2,$3,$4) ON CONFLICT (actor_id, operation, key) DO NOTHING RETURNING id`,
      [input.actorId, action, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_status: 200 | 201;
        response_body: { task: ManagedTask };
      }>(
        `SELECT request_hash,response_status,response_body FROM impuls.idempotency_records WHERE actor_id=$1 AND operation=$2 AND key=$3 FOR UPDATE`,
        [input.actorId, action, input.idempotencyKey],
      )
    ).rows[0]!;
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    const validPermission = async () =>
      (
        await client.query(
          `SELECT b.id FROM impuls.role_bindings b WHERE ${activeBinding} AND b.action=$2 AND b.scope_id=$3`,
          [input.actorId, action, scopeId],
        )
      ).rowCount! > 0;
    if (!(await authorized())) return await reject({ kind: "unauthorized" });
    if (!(await validPermission())) return await reject({ kind: "not_found" });
    if (inserted.rowCount === 0) {
      if (!saved.response_body || !saved.response_status)
        throw new Error("Incomplete idempotency record");
      await client.query("COMMIT");
      return {
        kind: "ok",
        status: saved.response_status,
        response: saved.response_body,
      };
    }
    const ruleId =
      input.action === "create" ? input.data.ruleSetId : current!.rule_set_id;
    if (!(await validRules(client, ruleId)))
      return await reject({ kind: "rules_invalid" });
    let taskId: string;
    if (input.action === "create") {
      const d = input.data;
      taskId = (
        await client.query<{ id: string }>(
          `INSERT INTO impuls.tasks
        (scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points,open_for_claim)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11) RETURNING id`,
          [
            scopeId,
            ruleId,
            input.actorId,
            d.title,
            d.criteria,
            d.categoryCode,
            d.priority,
            d.dueAt,
            d.fundXp,
            d.fundPoints,
            d.openForClaim === true,
          ],
        )
      ).rows[0]!.id;
    } else if (input.action === "assign") {
      taskId = input.taskId;
      if (
        current!.version !== input.data.expectedVersion ||
        current!.status !== "draft"
      )
        return await reject({
          kind: "conflict",
          currentVersion: current!.version,
        });
      const target = await client.query<{ active: boolean }>(
        "SELECT active FROM impuls.users WHERE id=$1 FOR SHARE",
        [input.data.assigneeId],
      );
      if (target.rows[0]?.active !== true)
        return await reject({ kind: "assignee_invalid" });
      const membership = await client.query(
        `SELECT id FROM impuls.task_scope_members WHERE scope_id=$1 AND user_id=$2 AND synthetic
        AND revoked_at IS NULL AND valid_from <= clock_timestamp() AND (valid_until IS NULL OR valid_until > clock_timestamp()) FOR SHARE`,
        [scopeId, input.data.assigneeId],
      );
      if (membership.rowCount !== 1)
        return await reject({ kind: "assignee_invalid" });
      await client.query(
        "INSERT INTO impuls.task_assignments (task_id,user_id) VALUES ($1,$2)",
        [taskId, input.data.assigneeId],
      );
      await client.query(
        "UPDATE impuls.tasks SET status='assigned',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [taskId],
      );
      await client.query(
        `INSERT INTO impuls.notification_outbox (recipient_id,task_id,kind,mode,created_at,updated_at)
        VALUES ($1,$2,'task.assigned','synthetic',clock_timestamp(),clock_timestamp())`,
        [input.data.assigneeId, taskId],
      );
    } else {
      taskId = input.taskId;
      if (
        current!.version !== input.data.expectedVersion ||
        (input.action === "edit"
          ? current!.status !== "draft"
          : ![
              "draft",
              "assigned",
              "in_progress",
              "in_review",
              "needs_work",
            ].includes(current!.status))
      )
        return await reject({
          kind: "conflict",
          currentVersion: current!.version,
        });
      if (input.action === "edit") {
        const d = input.data;
        await client.query(
          `UPDATE impuls.tasks SET title=$2,criteria=$3,category_code=$4,priority=$5,due_at=$6,
          fund_xp=$7,fund_points=$8,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
          [
            taskId,
            d.title,
            d.criteria,
            d.categoryCode,
            d.priority,
            d.dueAt,
            d.fundXp,
            d.fundPoints,
          ],
        );
      } else {
        await client.query(
          "UPDATE impuls.tasks SET status='cancelled',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [taskId],
        );
      }
    }
    await appendTaskEvent(client, {
      taskId,
      actorId: input.actorId,
      kind:
        input.action === "create"
          ? "created"
          : input.action === "assign"
            ? "assigned"
            : input.action === "edit"
              ? "edited"
              : "cancelled",
      ...(input.action === "edit" || input.action === "cancel"
        ? { reason: input.data.reason }
        : {}),
    });
    const task = mapTask(
      (await client.query<TaskRow>(`${selectTask} WHERE t.id=$1`, [taskId]))
        .rows[0]!,
    );
    await client.query(
      `INSERT INTO impuls.audit_events (actor_id,task_id,action,request_id,reason,diff,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp(),clock_timestamp())`,
      [
        input.actorId,
        taskId,
        action,
        input.requestId,
        input.action === "create"
          ? "Создание задачи"
          : input.action === "assign"
            ? "Назначение задачи"
            : input.data.reason,
        JSON.stringify({
          ...(input.action === "edit"
            ? {
                title: task.title,
                criteria: task.criteria,
                categoryCode: task.categoryCode,
                priority: task.priority,
                dueAt: task.dueAt,
                fundXp: task.fundXp,
                fundPoints: task.fundPoints,
              }
            : {}),
          status: task.status,
          version: task.version,
          scopeId,
          ruleSetId: ruleId,
          ...(input.action === "assign"
            ? { assigneeId: input.data.assigneeId }
            : {}),
        }),
      ],
    );
    // Locks can have waited: wall-clock validity is checked again before commit.
    if (!(await authorized())) return await reject({ kind: "unauthorized" });
    if (!(await validPermission())) return await reject({ kind: "not_found" });
    if (!(await validRules(client, ruleId)))
      return await reject({ kind: "rules_invalid" });
    if (input.action === "assign") {
      const membership = await client.query(
        `SELECT id FROM impuls.task_scope_members WHERE scope_id=$1 AND user_id=$2 AND revoked_at IS NULL
        AND valid_from <= clock_timestamp() AND (valid_until IS NULL OR valid_until > clock_timestamp())`,
        [scopeId, input.data.assigneeId],
      );
      if (membership.rowCount !== 1)
        return await reject({ kind: "assignee_invalid" });
    }
    const response = { task };
    const status = input.action === "create" ? 201 : 200;
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status=$4,response_body=$5::jsonb WHERE actor_id=$1 AND operation=$2 AND key=$3`,
      [
        input.actorId,
        action,
        input.idempotencyKey,
        status,
        JSON.stringify(response),
      ],
    );
    await client.query("COMMIT");
    return { kind: "ok", status, response };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function validRules(client: PoolClient, id: string) {
  return (
    (
      await client.query(
        `SELECT id FROM impuls.rule_sets WHERE id=$1 AND definition->>'mode'='synthetic' AND effective_from <= clock_timestamp()`,
        [id],
      )
    ).rowCount === 1
  );
}
