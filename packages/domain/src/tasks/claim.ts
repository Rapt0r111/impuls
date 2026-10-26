import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getAssignedTask, type AssignedTaskDetail } from "./read";
import { appendTaskEvent } from "./events";
import { openTaskLimitFrom } from "../admin/rules";

// A free task is a draft with open_for_claim. Any active member of its scope may take it;
// taking is a self-assignment through the same task_assignments row as a commander's assign.
export type OpenTask = {
  id: string;
  title: string;
  criteria: string;
  priority: "critical" | "high" | "normal";
  dueAt: string;
  fundXp: number;
  fundPoints: number;
  version: number;
  updatedAt: string;
  scope: { id: string; kind: "rota" | "group" | "project"; name: string };
};

type OpenRow = {
  id: string;
  title: string;
  criteria: string;
  priority: OpenTask["priority"];
  due_at: Date;
  fund_xp: number;
  fund_points: number;
  version: number;
  updated_at: Date;
  scope_id: string;
  kind: OpenTask["scope"]["kind"];
  name: string;
};

const OPEN_LIMIT = 50;
export const memberOf = (scopeColumn: string, userParam: string) => `EXISTS (
  SELECT 1 FROM impuls.task_scope_members m
   WHERE m.scope_id = ${scopeColumn} AND m.user_id = ${userParam}
     AND m.revoked_at IS NULL AND m.valid_from <= clock_timestamp()
     AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp()))`;

export async function listOpenTasks(
  pool: Pool,
  userId: string,
  options: { enabled: boolean },
): Promise<OpenTask[]> {
  if (!options.enabled) return [];
  const { rows } = await pool.query<OpenRow>(
    `SELECT t.id, t.title, t.criteria, t.priority, t.due_at, t.fund_xp, t.fund_points,
            t.version, t.updated_at, s.id AS scope_id, s.kind, s.name
       FROM impuls.tasks t
       JOIN impuls.access_scopes s ON s.id = t.scope_id
       JOIN impuls.users u ON u.id = $1 AND u.active
      WHERE t.status = 'draft' AND t.open_for_claim AND t.due_at > clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM impuls.task_assignments a WHERE a.task_id = t.id)
        AND ${memberOf("t.scope_id", "$1")}
      ORDER BY t.due_at, t.id
      LIMIT ${OPEN_LIMIT}`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    criteria: row.criteria,
    priority: row.priority,
    dueAt: row.due_at.toISOString(),
    fundXp: row.fund_xp,
    fundPoints: row.fund_points,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
    scope: { id: row.scope_id, kind: row.kind, name: row.name },
  }));
}

export type ClaimInput = {
  taskId: string;
  actorId: string;
  sessionHash: Buffer;
  expectedVersion: number;
  idempotencyKey: string;
  enabled: boolean;
};

export type ClaimResult =
  | {
      kind: "ok";
      status: 200;
      response: { task: AssignedTaskDetail };
    }
  | { kind: "revoked" }
  | { kind: "unauthorized" }
  | { kind: "disabled" }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "conflict"; currentVersion: number }
  | { kind: "limit_reached"; limit: number };

type IdempotencyRow = {
  request_hash: Buffer;
  response_status: 200 | null;
  response_body: { task: AssignedTaskDetail } | null;
};

const OPERATION = "task.claim";

async function rollbackResult(
  client: PoolClient,
  result: ClaimResult,
): Promise<ClaimResult> {
  await client.query("ROLLBACK");
  return result;
}

const signedIn = (client: PoolClient, input: ClaimInput) =>
  client.query(
    `SELECT 1 FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2
      AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
    [input.actorId, input.sessionHash],
  );

export async function claimTask(
  pool: Pool,
  input: ClaimInput,
): Promise<ClaimResult> {
  if (!input.enabled) return { kind: "disabled" };
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    // A concurrent revocation waits for this transaction; a revoked actor never
    // receives a saved idempotent response.
    const actor = await client.query<{ active: boolean }>(
      "SELECT active FROM impuls.users WHERE id = $1 FOR SHARE",
      [input.actorId],
    );
    if (actor.rows[0]?.active !== true)
      return await rollbackResult(client, { kind: "revoked" });
    if (
      (
        await client.query(
          `SELECT id FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2
          AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR SHARE`,
          [input.actorId, input.sessionHash],
        )
      ).rowCount !== 1
    )
      return await rollbackResult(client, { kind: "unauthorized" });

    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          taskId: input.taskId,
          expectedVersion: input.expectedVersion,
          action: "claim",
        }),
      )
      .digest();
    const inserted = await client.query(
      `INSERT INTO impuls.idempotency_records (actor_id, operation, key, request_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (actor_id, operation, key) DO NOTHING RETURNING id`,
      [input.actorId, OPERATION, input.idempotencyKey, hash],
    );
    const record = await client.query<IdempotencyRow>(
      `SELECT request_hash, response_status, response_body FROM impuls.idempotency_records
        WHERE actor_id = $1 AND operation = $2 AND key = $3 FOR UPDATE`,
      [input.actorId, OPERATION, input.idempotencyKey],
    );
    const saved = record.rows[0];
    if (!saved) throw new Error("Missing idempotency record");
    if (!saved.request_hash.equals(hash))
      return await rollbackResult(client, { kind: "idempotency_conflict" });

    // The row lock serialises two members taking the same task: the second one waits,
    // then sees an assignment and gets a conflict. task_assignments.task_id is also unique.
    const task = await client.query<{
      status: string;
      version: number;
      scope_id: string;
      open_for_claim: boolean;
      expired: boolean;
    }>(
      `SELECT status, version, scope_id, open_for_claim, due_at <= clock_timestamp() AS expired
         FROM impuls.tasks WHERE id = $1 FOR UPDATE`,
      [input.taskId],
    );
    const current = task.rows[0];
    // Not a member of the task's scope: indistinguishable from a missing task.
    const member = current
      ? await client.query(
          `SELECT 1 WHERE ${memberOf("$1::uuid", "$2::uuid")}`,
          [current.scope_id, input.actorId],
        )
      : null;
    if (!current || !member?.rowCount)
      return await rollbackResult(client, { kind: "not_found" });
    if (!(await signedIn(client, input)).rowCount)
      return await rollbackResult(client, { kind: "unauthorized" });
    if (inserted.rowCount === 0) {
      if (!saved.response_status || !saved.response_body)
        throw new Error("Incomplete idempotency record");
      await client.query("COMMIT");
      transactionOpen = false;
      return {
        kind: "ok",
        status: saved.response_status,
        response: saved.response_body,
      };
    }

    const taken = await client.query(
      "SELECT 1 FROM impuls.task_assignments WHERE task_id = $1",
      [input.taskId],
    );
    if (
      current.version !== input.expectedVersion ||
      current.status !== "draft" ||
      !current.open_for_claim ||
      current.expired ||
      taken.rowCount
    )
      return await rollbackResult(client, {
        kind: "conflict",
        currentVersion: current.version,
      });

    // The commander's limit on unfinished self-taken tasks (null — no limit). The advisory
    // lock serialises two taps by the same member so both cannot pass the count.
    const rule = await client.query<{ definition: unknown }>(
      `SELECT definition FROM impuls.rule_sets
        WHERE effective_from<=clock_timestamp()
        ORDER BY version_number DESC LIMIT 1`,
    );
    const definition = rule.rows[0]?.definition;
    const limit =
      typeof definition === "object" && definition !== null
        ? openTaskLimitFrom(definition as Record<string, unknown>)
        : null;
    if (limit !== null) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `task.claim:${input.actorId}`,
      ]);
      const open = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM impuls.tasks t
           JOIN impuls.task_assignments a ON a.task_id = t.id AND a.user_id = $1
          WHERE t.status IN ('assigned','in_progress','in_review','needs_work')
            AND EXISTS (SELECT 1 FROM impuls.task_events e
                         WHERE e.task_id = t.id AND e.kind = 'assigned'
                           AND e.actor_id = $1 AND e.assignee_id = $1)`,
        [input.actorId],
      );
      if (open.rows[0]!.n >= limit)
        return await rollbackResult(client, { kind: "limit_reached", limit });
    }

    await client.query(
      "INSERT INTO impuls.task_assignments (task_id, user_id) VALUES ($1, $2)",
      [input.taskId, input.actorId],
    );
    const updated = await client.query(
      `UPDATE impuls.tasks SET status = 'assigned', version = version + 1,
              updated_at = clock_timestamp() WHERE id = $1`,
      [input.taskId],
    );
    if (updated.rowCount !== 1) throw new Error("Task update was not applied");
    // The actor equals the assignee: history reads as "took the task themselves".
    await appendTaskEvent(client, {
      taskId: input.taskId,
      actorId: input.actorId,
      kind: "assigned",
    });
    // Tell the creator, unless they took their own task. The unique index allows one per task.
    await client.query(
      `INSERT INTO impuls.notification_outbox (recipient_id, task_id, kind, created_at, updated_at)
       SELECT t.created_by, t.id, 'task.claimed', clock_timestamp(), clock_timestamp()
         FROM impuls.tasks t WHERE t.id = $1 AND t.created_by <> $2
       ON CONFLICT DO NOTHING`,
      [input.taskId, input.actorId],
    );
    const detail = await getAssignedTask(client, input.actorId, input.taskId);
    if (!detail) throw new Error("Claimed task is not readable");
    const response = { task: detail };
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status = 200, response_body = $4::jsonb
        WHERE actor_id = $1 AND operation = $2 AND key = $3`,
      [
        input.actorId,
        OPERATION,
        input.idempotencyKey,
        JSON.stringify(response),
      ],
    );
    // Lock waits can outlive the session; check again before commit.
    if (!(await signedIn(client, input)).rowCount)
      return await rollbackResult(client, { kind: "unauthorized" });
    await client.query("COMMIT");
    transactionOpen = false;
    return { kind: "ok", status: 200, response };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
