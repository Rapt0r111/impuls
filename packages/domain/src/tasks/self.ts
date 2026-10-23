import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { appendTaskEvent } from "./events";
import { memberOf } from "./claim";

// A self-submitted task is a finished result the member reports and asks points for. The one
// responsible verifier scores it (0–100) and sends it on (awaiting_commander); the commander
// approves that score with XP and forwards it into the normal review queue (in_review, assigned
// to the member), or declines it. Acceptance then runs as usual. ADR-0041.
export type SelfTaskStatus =
  | "awaiting_verification"
  | "awaiting_commander"
  | "in_review"
  | "needs_work"
  | "accepted"
  | "cancelled";

export type SelfTask = {
  id: string;
  title: string;
  text: string;
  status: SelfTaskStatus;
  version: number;
  requestedPoints: number;
  requestedXp: number | null;
  fundPoints: number;
  fundXp: number;
  verifiedPoints: number | null;
  updatedAt: string;
  scope: { id: string; name: string };
  author: { id: string; displayName: string };
  verifiers: { id: string; displayName: string }[];
};

export type SelfTaskOptions = {
  scopes: { id: string; name: string }[];
  scopeId: string | null;
  verifiers: { id: string; displayName: string }[];
};

export type SelfTaskResult =
  | { kind: "ok"; status: 200 | 201; response: { task: SelfTask } }
  | { kind: "revoked" }
  | { kind: "unauthorized" }
  | { kind: "disabled" }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "conflict"; currentVersion: number }
  | { kind: "verifiers_invalid" }
  | { kind: "points_missing" }
  | { kind: "rules_invalid" }
  | { kind: "self_review" }
  | { kind: "recipient_revoked" };

type Base = {
  actorId: string;
  sessionHash: Buffer;
  idempotencyKey: string;
  enabled: boolean;
};
export type ProposeSelfTaskInput = Base & {
  scopeId: string;
  title: string;
  text: string;
  requestedPoints: number;
  requestedXp: number | null;
  verifierIds: string[];
};
export type VerifySelfTaskInput = Base & {
  taskId: string;
  expectedVersion: number;
} & (
    | { decision: "approve"; fundPoints: number }
    | { decision: "decline"; reason: string }
  );
export type DecideSelfTaskInput = Base & {
  taskId: string;
  expectedVersion: number;
} & (
    | { decision: "forward"; fundXp: number }
    | { decision: "decline"; reason: string }
  );

// Scope-level right check; the caller supplies the scope and user expressions.
const hasRight = (
  action: string,
  scopeExpr: string,
  userExpr: string,
) => `EXISTS (
  SELECT 1 FROM impuls.role_bindings b
   WHERE b.user_id = ${userExpr} AND b.action = '${action}' AND b.scope_id = ${scopeExpr}
     AND b.revoked_at IS NULL AND b.valid_from <= clock_timestamp()
     AND (b.valid_until IS NULL OR b.valid_until > clock_timestamp()))`;

const selectSelfTask = `SELECT t.id, t.title, t.criteria, t.status, t.version, t.requested_points, t.requested_xp,
    t.fund_points, t.fund_xp, t.verified_points, t.updated_at, s.id AS scope_id, s.name AS scope_name,
    u.id AS author_id, u.display_name AS author_name,
    COALESCE((SELECT json_agg(json_build_object('id', v.id, 'displayName', v.display_name)
                ORDER BY v.display_name, v.id)
                FROM impuls.task_verifiers tv JOIN impuls.users v ON v.id = tv.user_id
               WHERE tv.task_id = t.id), '[]'::json) AS verifiers
  FROM impuls.tasks t
  JOIN impuls.access_scopes s ON s.id = t.scope_id
  JOIN impuls.users u ON u.id = t.created_by`;

type SelfTaskRow = {
  id: string;
  title: string;
  criteria: string;
  status: SelfTaskStatus;
  version: number;
  requested_points: number;
  requested_xp: number | null;
  fund_points: number;
  fund_xp: number;
  verified_points: number | null;
  updated_at: Date;
  scope_id: string;
  scope_name: string;
  author_id: string;
  author_name: string;
  verifiers: SelfTask["verifiers"];
};

function toSelfTask(row: SelfTaskRow): SelfTask {
  return {
    id: row.id,
    title: row.title,
    text: row.criteria,
    status: row.status,
    version: row.version,
    requestedPoints: row.requested_points,
    requestedXp: row.requested_xp,
    fundPoints: row.fund_points,
    fundXp: row.fund_xp,
    verifiedPoints: row.verified_points,
    updatedAt: row.updated_at.toISOString(),
    scope: { id: row.scope_id, name: row.scope_name },
    author: { id: row.author_id, displayName: row.author_name },
    verifiers: row.verifiers,
  };
}

async function readSelfTask(client: PoolClient, taskId: string) {
  const { rows } = await client.query<SelfTaskRow>(
    `${selectSelfTask} WHERE t.id = $1 AND t.self_submitted`,
    [taskId],
  );
  return rows[0] ? toSelfTask(rows[0]) : null;
}

const LIST_LIMIT = 50;

// mine: the member's own reports. verify: waiting for this member as a verifier.
// commander: approved by a verifier, waiting for a decision in the task's scope.
export async function listSelfTasks(
  pool: Pool,
  userId: string,
  view: "mine" | "verify" | "commander",
  options: { enabled: boolean },
): Promise<SelfTask[]> {
  if (!options.enabled) return [];
  const filter =
    view === "mine"
      ? `t.created_by = $1`
      : view === "verify"
        ? `t.status = 'awaiting_verification' AND EXISTS (
            SELECT 1 FROM impuls.task_verifiers tv WHERE tv.task_id = t.id AND tv.user_id = $1)
           AND ${hasRight("task.verify", "t.scope_id", "$1")}`
        : `t.status = 'awaiting_commander' AND t.created_by <> $1
           AND ${hasRight("task.review", "t.scope_id", "$1")}`;
  const { rows } = await pool.query<SelfTaskRow>(
    `${selectSelfTask}
      JOIN impuls.users me ON me.id = $1 AND me.active
     WHERE t.self_submitted AND ${filter}
     ORDER BY t.updated_at DESC, t.id
     LIMIT ${LIST_LIMIT}`,
    [userId],
  );
  return rows.map(toSelfTask);
}

// Scopes the member belongs to, and who can verify in the chosen one (never the member).
export async function readSelfTaskOptions(
  pool: Pool,
  userId: string,
  scopeId: string | null,
  options: { enabled: boolean },
): Promise<SelfTaskOptions> {
  if (!options.enabled) return { scopes: [], scopeId: null, verifiers: [] };
  const { rows: scopes } = await pool.query<{ id: string; name: string }>(
    `SELECT s.id, s.name FROM impuls.access_scopes s
      WHERE ${memberOf("s.id", "$1")}
      ORDER BY s.name, s.id`,
    [userId],
  );
  const chosen = scopes.find((s) => s.id === scopeId) ?? scopes[0] ?? null;
  if (!chosen) return { scopes, scopeId: null, verifiers: [] };
  const { rows: verifiers } = await pool.query<{
    id: string;
    display_name: string;
  }>(
    `SELECT DISTINCT u.id, u.display_name FROM impuls.users u
      WHERE u.active AND u.id <> $1 AND ${hasRight("task.verify", "$2::uuid", "u.id")}
        AND ${memberOf("$2::uuid", "u.id")}
      ORDER BY u.display_name, u.id`,
    [userId, chosen.id],
  );
  return {
    scopes,
    scopeId: chosen.id,
    verifiers: verifiers.map((v) => ({
      id: v.id,
      displayName: v.display_name,
    })),
  };
}

const OPERATIONS = {
  propose: "selftask.propose",
  verify: "selftask.verify",
  decide: "selftask.decide",
} as const;

type IdempotencyRow = {
  request_hash: Buffer;
  response_status: 200 | 201 | null;
  response_body: { task: SelfTask } | null;
};

// Runs one mutation in a single transaction: active actor, live session, idempotency record,
// then the operation. Only successful results are stored, so a conflict can be retried.
async function runSelfTaskMutation(
  pool: Pool,
  input: Base,
  operation: (typeof OPERATIONS)[keyof typeof OPERATIONS],
  hashPayload: unknown,
  work: (client: PoolClient) => Promise<SelfTaskResult>,
): Promise<SelfTaskResult> {
  if (!input.enabled) return { kind: "disabled" };
  const client = await pool.connect();
  let transactionOpen = false;
  const rollback = async (result: SelfTaskResult) => {
    await client.query("ROLLBACK");
    transactionOpen = false;
    return result;
  };
  const signedIn = () =>
    client.query(
      `SELECT 1 FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2
        AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
      [input.actorId, input.sessionHash],
    );
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    // A concurrent revocation waits for this transaction; a revoked actor never gets a saved response.
    const actor = await client.query<{ active: boolean }>(
      "SELECT active FROM impuls.users WHERE id = $1 FOR SHARE",
      [input.actorId],
    );
    if (actor.rows[0]?.active !== true)
      return await rollback({ kind: "revoked" });
    if (!(await signedIn()).rowCount)
      return await rollback({ kind: "unauthorized" });

    const hash = createHash("sha256")
      .update(JSON.stringify({ operation, ...(hashPayload as object) }))
      .digest();
    const inserted = await client.query(
      `INSERT INTO impuls.idempotency_records (actor_id, operation, key, request_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (actor_id, operation, key) DO NOTHING RETURNING id`,
      [input.actorId, operation, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<IdempotencyRow>(
        `SELECT request_hash, response_status, response_body FROM impuls.idempotency_records
          WHERE actor_id = $1 AND operation = $2 AND key = $3 FOR UPDATE`,
        [input.actorId, operation, input.idempotencyKey],
      )
    ).rows[0];
    if (!saved) throw new Error("Missing idempotency record");
    if (!saved.request_hash.equals(hash))
      return await rollback({ kind: "idempotency_conflict" });
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

    const result = await work(client);
    if (result.kind !== "ok") return await rollback(result);
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status = $4, response_body = $5::jsonb
        WHERE actor_id = $1 AND operation = $2 AND key = $3`,
      [
        input.actorId,
        operation,
        input.idempotencyKey,
        result.status,
        JSON.stringify(result.response),
      ],
    );
    // Lock waits can outlive the session; check again before commit.
    if (!(await signedIn()).rowCount)
      return await rollback({ kind: "unauthorized" });
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function proposeSelfTask(pool: Pool, input: ProposeSelfTaskInput) {
  const verifierIds = [...new Set(input.verifierIds)].sort();
  return runSelfTaskMutation(
    pool,
    input,
    OPERATIONS.propose,
    {
      scopeId: input.scopeId,
      title: input.title,
      text: input.text,
      requestedPoints: input.requestedPoints,
      requestedXp: input.requestedXp,
      verifierIds,
    },
    async (client) => {
      const member = await client.query(
        `SELECT 1 WHERE ${memberOf("$1::uuid", "$2::uuid")}`,
        [input.scopeId, input.actorId],
      );
      if (!member.rowCount) return { kind: "not_found" };
      if (verifierIds.length !== 1 || verifierIds.includes(input.actorId))
        return { kind: "verifiers_invalid" };
      // Every chosen verifier must hold the verify right in this scope and be an active member.
      const allowed = await client.query<{ user_id: string }>(
        `SELECT DISTINCT u.id AS user_id FROM impuls.users u
          WHERE u.id = ANY($1::uuid[]) AND u.active AND ${hasRight("task.verify", "$2::uuid", "u.id")}
            AND ${memberOf("$2::uuid", "u.id")}`,
        [verifierIds, input.scopeId],
      );
      if (allowed.rowCount !== verifierIds.length)
        return { kind: "verifiers_invalid" };
      // The current synthetic rule set, as the free-task claim uses it.
      const rule = await client.query<{ id: string }>(
        `SELECT id FROM impuls.rule_sets
          WHERE definition->>'mode' = 'synthetic' AND effective_from <= clock_timestamp()
          ORDER BY version_number DESC LIMIT 1`,
      );
      if (!rule.rows[0]) return { kind: "rules_invalid" };

      const created = await client.query<{ id: string }>(
        `INSERT INTO impuls.tasks
          (scope_id, rule_set_id, created_by, title, criteria, category_code, priority, status, due_at,
           fund_xp, fund_points, open_for_claim, self_submitted, requested_points, requested_xp)
         VALUES ($1, $2, $3, $4, $5, 'self', 'normal', 'awaiting_verification', clock_timestamp(),
           0, 0, false, true, $6, $7)
         RETURNING id`,
        [
          input.scopeId,
          rule.rows[0].id,
          input.actorId,
          input.title,
          input.text,
          input.requestedPoints,
          input.requestedXp,
        ],
      );
      const taskId = created.rows[0]!.id;
      // The report is the first submission, so the normal review queue and acceptance use it as is.
      await client.query(
        `INSERT INTO impuls.submissions (task_id, author_id, attempt_number, text) VALUES ($1, $2, 1, $3)`,
        [taskId, input.actorId, input.text],
      );
      await client.query(
        `INSERT INTO impuls.task_verifiers (task_id, user_id) SELECT $1, unnest($2::uuid[])`,
        [taskId, verifierIds],
      );
      await appendTaskEvent(client, {
        taskId,
        actorId: input.actorId,
        kind: "proposed",
      });
      const task = await readSelfTask(client, taskId);
      if (!task) throw new Error("Proposed task is not readable");
      return { kind: "ok", status: 201, response: { task } };
    },
  );
}

// The locked task, or null when the actor is not an allowed participant for this decision.
// Permission is checked before the lock so a non-participant learns nothing about the task.
async function lockForDecision(
  client: PoolClient,
  taskId: string,
  actorId: string,
  right: "task.verify" | "task.review",
  checkVerifier: boolean,
) {
  const allowed = await client.query(
    checkVerifier
      ? `SELECT 1 FROM impuls.task_verifiers v JOIN impuls.tasks t ON t.id = v.task_id
          WHERE v.task_id = $1 AND v.user_id = $2 AND t.self_submitted
            AND ${hasRight(right, "t.scope_id", "$2::uuid")}`
      : `SELECT 1 FROM impuls.tasks t WHERE t.id = $1 AND t.self_submitted
          AND ${hasRight(right, "t.scope_id", "$2::uuid")}`,
    [taskId, actorId],
  );
  if (!allowed.rowCount) return null;
  const locked = await client.query<{
    status: SelfTaskStatus;
    version: number;
    created_by: string;
    verified_points: number | null;
  }>(
    `SELECT status, version, created_by, verified_points FROM impuls.tasks WHERE id = $1 FOR UPDATE`,
    [taskId],
  );
  return locked.rows[0] ?? null;
}

export function verifySelfTask(pool: Pool, input: VerifySelfTaskInput) {
  return runSelfTaskMutation(
    pool,
    input,
    OPERATIONS.verify,
    {
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      decision: input.decision,
      ...("reason" in input ? { reason: input.reason } : {}),
      ...("fundPoints" in input ? { fundPoints: input.fundPoints } : {}),
    },
    async (client) => {
      const current = await lockForDecision(
        client,
        input.taskId,
        input.actorId,
        "task.verify",
        true,
      );
      if (!current) return { kind: "not_found" };
      if (current.created_by === input.actorId) return { kind: "self_review" };
      if (
        current.version !== input.expectedVersion ||
        current.status !== "awaiting_verification"
      )
        return { kind: "conflict", currentVersion: current.version };

      if (input.decision === "approve") {
        // The verifier scores the report; the commander approves that score, not a new one.
        await client.query(
          `UPDATE impuls.tasks SET status = 'awaiting_commander', verified_points = $2, version = version + 1,
                  updated_at = clock_timestamp() WHERE id = $1`,
          [input.taskId, input.fundPoints],
        );
        await appendTaskEvent(client, {
          taskId: input.taskId,
          actorId: input.actorId,
          kind: "verified",
        });
      } else {
        await client.query(
          `UPDATE impuls.tasks SET status = 'cancelled', version = version + 1,
                  updated_at = clock_timestamp() WHERE id = $1`,
          [input.taskId],
        );
        await appendTaskEvent(client, {
          taskId: input.taskId,
          actorId: input.actorId,
          kind: "declined",
          reason: input.reason,
        });
      }
      const task = await readSelfTask(client, input.taskId);
      if (!task) throw new Error("Verified task is not readable");
      return { kind: "ok", status: 200, response: { task } };
    },
  );
}

export function decideSelfTask(pool: Pool, input: DecideSelfTaskInput) {
  return runSelfTaskMutation(
    pool,
    input,
    OPERATIONS.decide,
    {
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      decision: input.decision,
      ...("reason" in input ? { reason: input.reason } : {}),
      ...("fundXp" in input ? { fundXp: input.fundXp } : {}),
    },
    async (client) => {
      const current = await lockForDecision(
        client,
        input.taskId,
        input.actorId,
        "task.review",
        false,
      );
      if (!current) return { kind: "not_found" };
      if (current.created_by === input.actorId) return { kind: "self_review" };
      if (
        current.version !== input.expectedVersion ||
        current.status !== "awaiting_commander"
      )
        return { kind: "conflict", currentVersion: current.version };

      if (input.decision === "forward") {
        if (current.verified_points === null) return { kind: "points_missing" };
        // The member is the assignee, so their account must still be active to receive the accrual.
        const recipient = await client.query<{ active: boolean }>(
          "SELECT active FROM impuls.users WHERE id = $1 FOR SHARE",
          [current.created_by],
        );
        if (recipient.rows[0]?.active !== true)
          return { kind: "recipient_revoked" };
        // Fund is frozen from here on: the assignment is created in the same transaction.
        await client.query(
          "INSERT INTO impuls.task_assignments (task_id, user_id) VALUES ($1, $2)",
          [input.taskId, current.created_by],
        );
        await client.query(
          `UPDATE impuls.tasks SET status = 'in_review', fund_points = verified_points, fund_xp = $2,
                  version = version + 1, updated_at = clock_timestamp() WHERE id = $1`,
          [input.taskId, input.fundXp],
        );
        await appendTaskEvent(client, {
          taskId: input.taskId,
          actorId: input.actorId,
          kind: "approved",
        });
      } else {
        await client.query(
          `UPDATE impuls.tasks SET status = 'cancelled', version = version + 1,
                  updated_at = clock_timestamp() WHERE id = $1`,
          [input.taskId],
        );
        await appendTaskEvent(client, {
          taskId: input.taskId,
          actorId: input.actorId,
          kind: "declined",
          reason: input.reason,
        });
      }
      const task = await readSelfTask(client, input.taskId);
      if (!task) throw new Error("Decided task is not readable");
      return { kind: "ok", status: 200, response: { task } };
    },
  );
}
