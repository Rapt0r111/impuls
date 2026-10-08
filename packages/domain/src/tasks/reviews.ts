import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { appendTaskEvent } from "./events";
import type { AssignedTaskSummary, AssignedTaskDetail } from "./read";
import { syntheticEconomyZone } from "../ledger/economy";
import { creditAcceptedTask, type AcceptanceAward } from "../ledger/credit";

export type ReviewQueueItem = {
  submissionId: string;
  text: string;
  submittedAt: string;
  attemptNumber: number;
  acceptance: { enabled: boolean; mode: "synthetic" | null };
  author: { id: string; displayName: string };
  task: AssignedTaskSummary & Pick<AssignedTaskDetail, "criteria" | "scope">;
};
export type TaskReturnResponse = {
  review: {
    id: string;
    submissionId: string;
    decision: "return";
    reason: string;
    createdAt: string;
  };
  task: { id: string; status: "needs_work"; version: number };
};

const permissionPredicate = `b.user_id = $1 AND b.action = 'task.review'
  AND b.scope_id = t.scope_id AND b.revoked_at IS NULL
  AND b.valid_from <= clock_timestamp()
  AND (b.valid_until IS NULL OR b.valid_until > clock_timestamp())`;

type QueueRow = {
  submission_id: string;
  text: string;
  submitted_at: Date;
  attempt_number: number;
  author_id: string;
  display_name: string;
  task_id: string;
  title: string;
  criteria: string;
  priority: ReviewQueueItem["task"]["priority"];
  due_at: Date;
  fund_xp: number;
  fund_points: number;
  rule_version: number;
  version: number;
  updated_at: Date;
  scope_id: string;
  scope_kind: ReviewQueueItem["task"]["scope"]["kind"];
  scope_name: string;
  rule_definition: unknown;
};

export async function listReviewQueue(
  pool: Pool,
  actorId: string,
  options: {
    cursor?: string | undefined;
    limit?: number;
    allowSyntheticAccrual?: boolean;
  } = {},
) {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const result = await pool.query<QueueRow>(
    `
    SELECT sub.id AS submission_id, sub.text, sub.created_at AS submitted_at, sub.attempt_number,
      u.id AS author_id, u.display_name, t.id AS task_id, t.title, t.criteria, t.priority,
      t.due_at, t.fund_xp, t.fund_points, r.version_number AS rule_version, r.definition AS rule_definition, t.version, t.updated_at,
      s.id AS scope_id, s.kind AS scope_kind, s.name AS scope_name
    FROM impuls.tasks t
    JOIN impuls.task_assignments a ON a.task_id = t.id
    JOIN impuls.users u ON u.id = a.user_id AND u.active = true
    JOIN impuls.access_scopes s ON s.id = t.scope_id
    JOIN impuls.rule_sets r ON r.id = t.rule_set_id
    JOIN LATERAL (SELECT * FROM impuls.submissions WHERE task_id = t.id ORDER BY attempt_number DESC LIMIT 1) sub ON true
    WHERE t.status = 'in_review' AND a.user_id <> $1 AND sub.author_id <> $1
      AND EXISTS (SELECT 1 FROM impuls.users actor WHERE actor.id = $1 AND actor.active = true)
      AND EXISTS (SELECT 1 FROM impuls.role_bindings b WHERE ${permissionPredicate})
      AND NOT EXISTS (SELECT 1 FROM impuls.reviews rev WHERE rev.submission_id = sub.id)
      AND ($2::uuid IS NULL OR sub.id > $2)
    ORDER BY sub.id LIMIT $3`,
    [actorId, options.cursor ?? null, limit + 1],
  );
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map((row): ReviewQueueItem => ({
      submissionId: row.submission_id,
      text: row.text,
      submittedAt: row.submitted_at.toISOString(),
      attemptNumber: row.attempt_number,
      acceptance: {
        enabled:
          options.allowSyntheticAccrual === true &&
          syntheticEconomyZone(row.rule_definition) !== null,
        mode:
          options.allowSyntheticAccrual === true &&
          syntheticEconomyZone(row.rule_definition) !== null
            ? "synthetic"
            : null,
      },
      author: { id: row.author_id, displayName: row.display_name },
      task: {
        id: row.task_id,
        title: row.title,
        criteria: row.criteria,
        status: "in_review",
        priority: row.priority,
        dueAt: row.due_at.toISOString(),
        fundXp: row.fund_xp,
        fundPoints: row.fund_points,
        ruleVersion: row.rule_version,
        version: row.version,
        updatedAt: row.updated_at.toISOString(),
        scope: { id: row.scope_id, kind: row.scope_kind, name: row.scope_name },
      },
    })),
    nextCursor: result.rows.length > limit ? rows.at(-1)!.submission_id : null,
  };
}

export type TaskReturnInput = {
  actorId: string;
  sessionHash: Buffer;
  submissionId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  requestId?: string;
};
export type TaskReviewInput = TaskReturnInput & {
  action: "return" | "accept";
  allowSyntheticAccrual?: boolean;
};
export type TaskReviewResponse = {
  review: Omit<TaskReturnResponse["review"], "decision"> & {
    decision: "return" | "accept";
  };
  task: { id: string; status: "needs_work" | "accepted"; version: number };
  award?: AcceptanceAward;
};
export type TaskReviewResult =
  | { kind: "ok"; response: TaskReviewResponse }
  | Exclude<TaskReturnResult, { kind: "ok" }>
  | { kind: "recipient_revoked" }
  | { kind: "economy_disabled" }
  | { kind: "economy_rules_invalid" };
export type TaskReturnResult =
  | { kind: "ok"; response: TaskReturnResponse }
  | { kind: "revoked" }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "self_review" }
  | { kind: "idempotency_conflict" }
  | { kind: "recipient_revoked" }
  | { kind: "conflict"; currentVersion: number };

export async function reviewTaskSubmission(
  pool: Pool,
  input: TaskReviewInput,
): Promise<TaskReviewResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reject = async (result: TaskReviewResult) => {
      await client.query("ROLLBACK");
      return result;
    };
    const actor = await client.query<{ active: boolean }>(
      "SELECT active FROM impuls.users WHERE id = $1 FOR SHARE",
      [input.actorId],
    );
    if (actor.rows[0]?.active !== true)
      return await reject({ kind: "revoked" });
    type CurrentTask = {
      id: string;
      status: string;
      version: number;
      scope_id: string;
      author_id: string;
      user_id: string;
      title: string;
      fund_xp: number;
      fund_points: number;
      rule_set_id: string;
      rule_version: number;
      rule_definition: unknown;
    };
    const task = await client.query<CurrentTask>(
      `
      SELECT t.id, t.status, t.version, t.scope_id, sub.author_id, a.user_id
      FROM impuls.submissions sub JOIN impuls.tasks t ON t.id = sub.task_id
      JOIN impuls.task_assignments a ON a.task_id = t.id WHERE sub.id = $1`,
      [input.submissionId],
    );
    let current = task.rows[0];
    if (!current) return await reject({ kind: "not_found" });
    // Check scope before disclosing even the recipient's revoked state.
    if (
      !(
        await client.query(
          `SELECT 1 FROM impuls.role_bindings b JOIN impuls.tasks t ON t.id = $2 WHERE ${permissionPredicate} LIMIT 1`,
          [input.actorId, current.id],
        )
      ).rowCount
    )
      return await reject({ kind: "not_found" });
    // Recipient access is locked before sessions/tasks to stay in the same
    // order as allowlist revocation and participant task mutations.
    const recipient = await client.query<{ active: boolean }>(
      "SELECT active FROM impuls.users WHERE id = $1 FOR SHARE",
      [current.user_id],
    );
    if (recipient.rows[0]?.active !== true)
      return await reject({ kind: "recipient_revoked" });
    // Lock the permission before the session: permission revocation's trigger
    // locks sessions after its binding, so the same order avoids a deadlock.
    const permission = await client.query(
      `SELECT b.id FROM impuls.role_bindings b
      JOIN impuls.tasks t ON t.id = $2 WHERE ${permissionPredicate} ORDER BY b.id FOR SHARE OF b`,
      [input.actorId, current.id],
    );
    if (!permission.rowCount) return await reject({ kind: "not_found" });
    const session = await client.query(
      `SELECT id FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2
      AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR SHARE`,
      [input.actorId, input.sessionHash],
    );
    if (session.rowCount !== 1) return await reject({ kind: "unauthorized" });
    const locked = (
      await client.query<CurrentTask>(
        `SELECT t.id, t.status, t.version, t.scope_id, sub.author_id, a.user_id, t.title, t.fund_xp, t.fund_points,
          t.rule_set_id, r.version_number AS rule_version, r.definition AS rule_definition
      FROM impuls.submissions sub JOIN impuls.tasks t ON t.id = sub.task_id
      JOIN impuls.task_assignments a ON a.task_id = t.id JOIN impuls.rule_sets r ON r.id = t.rule_set_id
      WHERE sub.id = $1 FOR UPDATE OF t`,
        [input.submissionId],
      )
    ).rows[0];
    if (
      !locked ||
      locked.scope_id !== current.scope_id ||
      locked.user_id !== current.user_id
    )
      return await reject({ kind: "not_found" });
    current = locked;
    if (
      current.author_id === input.actorId ||
      current.user_id === input.actorId
    )
      return await reject({ kind: "self_review" });
    const timeZone = syntheticEconomyZone(current.rule_definition);
    if (input.action === "accept" && input.allowSyntheticAccrual !== true)
      return await reject({ kind: "economy_disabled" });
    if (input.action === "accept" && !timeZone)
      return await reject({ kind: "economy_rules_invalid" });
    const operation = `submission.${input.action}`;
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          submissionId: input.submissionId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        }),
      )
      .digest();
    const inserted = await client.query(
      `INSERT INTO impuls.idempotency_records (actor_id, operation, key, request_hash)
      VALUES ($1, $2, $3, $4) ON CONFLICT (actor_id, operation, key) DO NOTHING RETURNING id`,
      [input.actorId, operation, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: TaskReviewResponse | null;
      }>(
        `
      SELECT request_hash, response_body FROM impuls.idempotency_records
      WHERE actor_id = $1 AND operation = $2 AND key = $3 FOR UPDATE`,
        [input.actorId, operation, input.idempotencyKey],
      )
    ).rows[0]!;
    // Locks do not stop wall-clock expiry. Recheck after acquiring all locks,
    // including an idempotency key another request may have held.
    const stillPermitted = await client.query(
      `SELECT 1 FROM impuls.role_bindings b JOIN impuls.tasks t ON t.id = $2 WHERE ${permissionPredicate} LIMIT 1`,
      [input.actorId, current.id],
    );
    if (!stillPermitted.rowCount) return await reject({ kind: "not_found" });
    const stillSignedIn = await client.query(
      `SELECT 1 FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2 AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
      [input.actorId, input.sessionHash],
    );
    if (!stillSignedIn.rowCount) return await reject({ kind: "unauthorized" });
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    if (!inserted.rowCount) {
      if (!saved.response_body) throw new Error("Incomplete return intent");
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    const latest = (
      await client.query<{ id: string }>(
        "SELECT id FROM impuls.submissions WHERE task_id = $1 ORDER BY attempt_number DESC LIMIT 1",
        [current.id],
      )
    ).rows[0];
    if (
      current.status !== "in_review" ||
      current.version !== input.expectedVersion ||
      latest?.id !== input.submissionId ||
      current.author_id !== current.user_id
    )
      return await reject({
        kind: "conflict",
        currentVersion: current.version,
      });
    const at = (
      await client.query<{ at: Date }>(
        "SELECT date_trunc('milliseconds', clock_timestamp()) AS at",
      )
    ).rows[0]!.at;
    const row = (
      await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO impuls.reviews (submission_id, reviewer_id, decision, reason, fund_xp, fund_points, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id, created_at`,
        [
          input.submissionId,
          input.actorId,
          input.action,
          input.reason,
          input.action === "accept" ? current.fund_xp : null,
          input.action === "accept" ? current.fund_points : null,
          at,
        ],
      )
    ).rows[0]!;
    await client.query(
      "UPDATE impuls.tasks SET status = $2, version = version + 1, updated_at = $3 WHERE id = $1",
      [current.id, input.action === "accept" ? "accepted" : "needs_work", at],
    );
    const award =
      input.action === "accept"
        ? await creditAcceptedTask(client, {
            reviewId: row.id,
            userId: current.user_id,
            taskId: current.id,
            title: current.title,
            ruleSetId: current.rule_set_id,
            ruleVersion: current.rule_version,
            xp: current.fund_xp,
            points: current.fund_points,
            at,
            timeZone: timeZone!,
          })
        : undefined;
    await appendTaskEvent(client, {
      taskId: current.id,
      actorId: input.actorId,
      kind: input.action === "accept" ? "accepted" : "returned",
      submissionId: input.submissionId,
      reviewId: row.id,
    });
    await client.query(
      `INSERT INTO impuls.audit_events (actor_id, review_id, action, request_id, reason, diff, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
      [
        input.actorId,
        row.id,
        `task.${input.action}`,
        input.requestId ?? randomUUID(),
        input.reason,
        JSON.stringify({
          taskId: current.id,
          from: "in_review",
          to: input.action === "accept" ? "accepted" : "needs_work",
          version: current.version + 1,
          ...(award
            ? {
                xp: award.xp,
                points: award.points,
                ruleVersion: award.ruleVersion,
                mode: award.mode,
              }
            : {}),
        }),
        at,
      ],
    );
    await client.query(
      `INSERT INTO impuls.notification_outbox (recipient_id, review_id, kind, mode, created_at, updated_at)
      VALUES ($1, $2, $3, 'synthetic', $4, $4)`,
      [
        current.user_id,
        row.id,
        input.action === "accept" ? "task.accepted" : "task.returned",
        at,
      ],
    );
    const response: TaskReviewResponse = {
      review: {
        id: row.id,
        submissionId: input.submissionId,
        decision: input.action,
        reason: input.reason,
        createdAt: row.created_at.toISOString(),
      },
      task: {
        id: current.id,
        status: input.action === "accept" ? "accepted" : "needs_work",
        version: current.version + 1,
      },
      ...(award ? { award } : {}),
    };
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status = 200, response_body = $4::jsonb
      WHERE actor_id = $1 AND operation = $2 AND key = $3`,
      [
        input.actorId,
        operation,
        input.idempotencyKey,
        JSON.stringify(response),
      ],
    );
    // The balance upsert can wait on a different accepted task. Expiry is
    // wall-clock state, so none of the staged writes may commit after it.
    if (
      !(
        await client.query(
          `SELECT 1 FROM impuls.role_bindings b JOIN impuls.tasks t ON t.id = $2 WHERE ${permissionPredicate} LIMIT 1`,
          [input.actorId, current.id],
        )
      ).rowCount
    )
      return await reject({ kind: "not_found" });
    if (
      !(
        await client.query(
          "SELECT 1 FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2 AND revoked_at IS NULL AND expires_at > clock_timestamp()",
          [input.actorId, input.sessionHash],
        )
      ).rowCount
    )
      return await reject({ kind: "unauthorized" });
    await client.query("COMMIT");
    return { kind: "ok", response };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function returnTaskSubmission(
  pool: Pool,
  input: TaskReturnInput,
): Promise<TaskReturnResult> {
  const result = await reviewTaskSubmission(pool, {
    ...input,
    action: "return",
  });
  if (
    result.kind === "economy_disabled" ||
    result.kind === "economy_rules_invalid"
  )
    throw new Error("Unexpected return economy gate");
  if (result.kind !== "ok") return result;
  return {
    kind: "ok",
    response: {
      review: { ...result.response.review, decision: "return" },
      task: { ...result.response.task, status: "needs_work" },
    },
  };
}
