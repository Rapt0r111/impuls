import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getAssignedTask, type AssignedTaskDetail } from "./read";
import { appendTaskEvent } from "./events";

export type TaskMutation =
  | {
      action: "start";
      taskId: string;
      actorId: string;
      sessionHash: Buffer;
      expectedVersion: number;
      idempotencyKey: string;
    }
  | {
      action: "submit";
      taskId: string;
      actorId: string;
      sessionHash: Buffer;
      expectedVersion: number;
      idempotencyKey: string;
      text: string;
    };

export type TaskSubmission = {
  id: string;
  taskId: string;
  text: string;
  version: number;
  createdAt: string;
};

export type TaskMutationResult =
  | {
      kind: "ok";
      status: 200 | 201;
      response: { task: AssignedTaskDetail; submission?: TaskSubmission };
    }
  | { kind: "revoked" }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "conflict"; currentVersion: number };

type IdempotencyRow = {
  request_hash: Buffer;
  response_status: 200 | 201 | null;
  response_body: {
    task: AssignedTaskDetail;
    submission?: TaskSubmission;
  } | null;
};

type TaskRow = { status: AssignedTaskDetail["status"]; version: number };
type SubmissionRow = {
  id: string;
  task_id: string;
  text: string;
  version: number;
  created_at: Date;
};

function requestHash(input: TaskMutation): Buffer {
  return createHash("sha256")
    .update(
      JSON.stringify({
        taskId: input.taskId,
        expectedVersion: input.expectedVersion,
        action: input.action,
        ...(input.action === "submit" ? { text: input.text } : {}),
      }),
    )
    .digest();
}

async function rollbackResult(
  client: PoolClient,
  result: TaskMutationResult,
): Promise<TaskMutationResult> {
  await client.query("ROLLBACK");
  return result;
}

export async function mutateAssignedTask(
  pool: Pool,
  input: TaskMutation,
): Promise<TaskMutationResult> {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;

    // A concurrent allowlist revocation waits for this transaction. A revoked
    // actor never receives a saved idempotent response.
    const actor = await client.query<{ active: boolean }>(
      "SELECT active FROM impuls.users WHERE id = $1 FOR SHARE",
      [input.actorId],
    );
    if (actor.rows[0]?.active !== true) {
      return await rollbackResult(client, { kind: "revoked" });
    }
    const session = await client.query(
      `SELECT id FROM impuls.sessions
        WHERE user_id = $1 AND session_hash = $2
          AND revoked_at IS NULL AND expires_at > clock_timestamp()
        FOR SHARE`,
      [input.actorId, input.sessionHash],
    );
    if (session.rowCount !== 1) {
      return await rollbackResult(client, { kind: "unauthorized" });
    }

    const operation = `task.${input.action}`;
    const hash = requestHash(input);
    const inserted = await client.query(
      `INSERT INTO impuls.idempotency_records
         (actor_id, operation, key, request_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (actor_id, operation, key) DO NOTHING
       RETURNING id`,
      [input.actorId, operation, input.idempotencyKey, hash],
    );
    const record = await client.query<IdempotencyRow>(
      `SELECT request_hash, response_status, response_body
         FROM impuls.idempotency_records
        WHERE actor_id = $1 AND operation = $2 AND key = $3
        FOR UPDATE`,
      [input.actorId, operation, input.idempotencyKey],
    );
    const saved = record.rows[0];
    if (!saved) throw new Error("Missing idempotency record");
    if (!saved.request_hash.equals(hash)) {
      return await rollbackResult(client, { kind: "idempotency_conflict" });
    }

    const task = await client.query<TaskRow>(
      `SELECT t.status, t.version
         FROM impuls.tasks AS t
         JOIN impuls.task_assignments AS a
           ON a.task_id = t.id AND a.user_id = $1
        WHERE t.id = $2
        FOR UPDATE OF t`,
      [input.actorId, input.taskId],
    );
    const current = task.rows[0];
    if (!current) {
      return await rollbackResult(client, { kind: "not_found" });
    }
    const signedInAfterLock = await client.query(
      `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
       AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
      [input.actorId, input.sessionHash],
    );
    if (!signedInAfterLock.rowCount)
      return await rollbackResult(client, { kind: "unauthorized" });
    if (inserted.rowCount === 0) {
      if (!saved.response_status || !saved.response_body) {
        throw new Error("Incomplete idempotency record");
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return {
        kind: "ok",
        status: saved.response_status,
        response: saved.response_body,
      };
    }

    if (current.version !== input.expectedVersion) {
      return await rollbackResult(client, {
        kind: "conflict",
        currentVersion: current.version,
      });
    }
    const allowed =
      input.action === "start"
        ? current.status === "assigned" || current.status === "needs_work"
        : current.status === "in_progress";
    if (!allowed) {
      return await rollbackResult(client, {
        kind: "conflict",
        currentVersion: current.version,
      });
    }

    let submission: TaskSubmission | undefined;
    if (input.action === "submit") {
      const attempt = await client.query<{ next_attempt: number }>(
        `SELECT coalesce(max(attempt_number), 0) + 1 AS next_attempt
           FROM impuls.submissions WHERE task_id = $1`,
        [input.taskId],
      );
      const created = await client.query<SubmissionRow>(
        `INSERT INTO impuls.submissions
           (task_id, author_id, attempt_number, text)
         VALUES ($1, $2, $3, $4)
         RETURNING id, task_id, text, version, created_at`,
        [
          input.taskId,
          input.actorId,
          attempt.rows[0]!.next_attempt,
          input.text,
        ],
      );
      const row = created.rows[0]!;
      submission = {
        id: row.id,
        taskId: row.task_id,
        text: row.text,
        version: row.version,
        createdAt: row.created_at.toISOString(),
      };
    }

    const updated = await client.query(
      `UPDATE impuls.tasks
          SET status = $2, version = version + 1, updated_at = now()
        WHERE id = $1`,
      [input.taskId, input.action === "start" ? "in_progress" : "in_review"],
    );
    if (updated.rowCount !== 1) throw new Error("Task update was not applied");
    await appendTaskEvent(client, {
      taskId: input.taskId,
      actorId: input.actorId,
      kind: input.action === "start" ? "started" : "submitted",
      ...(submission ? { submissionId: submission.id } : {}),
    });
    const detail = await getAssignedTask(client, input.actorId, input.taskId);
    if (!detail) throw new Error("Updated task is not readable");
    const response = submission
      ? { task: detail, submission }
      : { task: detail };
    const status = input.action === "start" ? 200 : 201;
    await client.query(
      `UPDATE impuls.idempotency_records
          SET response_status = $4, response_body = $5::jsonb
        WHERE actor_id = $1 AND operation = $2 AND key = $3`,
      [
        input.actorId,
        operation,
        input.idempotencyKey,
        status,
        JSON.stringify(response),
      ],
    );
    // Event insertion can wait past wall-clock session expiry.
    const stillSignedIn = await client.query(
      `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
       AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
      [input.actorId, input.sessionHash],
    );
    if (!stillSignedIn.rowCount)
      return await rollbackResult(client, { kind: "unauthorized" });
    await client.query("COMMIT");
    transactionOpen = false;
    return { kind: "ok", status, response };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
