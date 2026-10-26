import type { Pool } from "pg";

type RecommendTaskResponse = {
  recommendation: {
    submissionId: string;
    xp: number;
    points: number;
    updatedAt: string;
  };
};
export type RecommendTaskInput = {
  actorId: string;
  sessionHash: Buffer;
  submissionId: string;
  expectedVersion: number;
  recommendedXp: number;
  recommendedPoints: number;
};
export type RecommendTaskResult =
  | { kind: "ok"; response: RecommendTaskResponse }
  | { kind: "revoked" }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "self_review" }
  | { kind: "conflict"; currentVersion: number };

// Только назначенный проверяющий задачи (task.verify и строка task_verifiers) может рекомендовать.
// Статус и версия задачи не меняются: принимает и начисляет по-прежнему командир.
export async function recommendTaskSubmission(
  pool: Pool,
  input: RecommendTaskInput,
): Promise<RecommendTaskResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reject = async (result: RecommendTaskResult) => {
      await client.query("ROLLBACK");
      return result;
    };
    const actor = await client.query<{ active: boolean }>(
      "SELECT active FROM impuls.users WHERE id = $1 FOR SHARE",
      [input.actorId],
    );
    if (actor.rows[0]?.active !== true)
      return await reject({ kind: "revoked" });
    const current = (
      await client.query<{
        status: string;
        version: number;
        author_id: string;
        assignee_id: string;
        latest_id: string;
      }>(
        `SELECT t.status, t.version, sub.author_id, a.user_id AS assignee_id,
          (SELECT id FROM impuls.submissions WHERE task_id = t.id ORDER BY attempt_number DESC LIMIT 1) AS latest_id
        FROM impuls.submissions sub JOIN impuls.tasks t ON t.id = sub.task_id
        JOIN impuls.task_assignments a ON a.task_id = t.id
        WHERE sub.id = $1
          AND EXISTS (SELECT 1 FROM impuls.task_verifiers tv WHERE tv.task_id = t.id AND tv.user_id = $2)
          AND EXISTS (SELECT 1 FROM impuls.role_bindings b WHERE b.user_id = $2 AND b.action = 'task.verify'
            AND b.scope_id = t.scope_id AND b.revoked_at IS NULL AND b.valid_from <= clock_timestamp()
            AND (b.valid_until IS NULL OR b.valid_until > clock_timestamp()))
        FOR UPDATE OF t`,
        [input.submissionId, input.actorId],
      )
    ).rows[0];
    if (!current) return await reject({ kind: "not_found" });
    if (
      current.author_id === input.actorId ||
      current.assignee_id === input.actorId
    )
      return await reject({ kind: "self_review" });
    const session = await client.query(
      `SELECT id FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2
      AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR SHARE`,
      [input.actorId, input.sessionHash],
    );
    if (session.rowCount !== 1) return await reject({ kind: "unauthorized" });
    if (
      current.status !== "in_review" ||
      current.version !== input.expectedVersion ||
      current.latest_id !== input.submissionId
    )
      return await reject({
        kind: "conflict",
        currentVersion: current.version,
      });
    const row = (
      await client.query<{ updated_at: Date }>(
        `INSERT INTO impuls.verifier_recommendations
          (submission_id, verifier_id, recommended_xp, recommended_points, created_at, updated_at)
        VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp())
        ON CONFLICT (submission_id) DO UPDATE SET verifier_id = EXCLUDED.verifier_id,
          recommended_xp = EXCLUDED.recommended_xp, recommended_points = EXCLUDED.recommended_points,
          updated_at = EXCLUDED.updated_at
        RETURNING updated_at`,
        [
          input.submissionId,
          input.actorId,
          input.recommendedXp,
          input.recommendedPoints,
        ],
      )
    ).rows[0]!;
    // The session may have been revoked while the write waited on locks.
    const stillSignedIn = await client.query(
      `SELECT 1 FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2
      AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
      [input.actorId, input.sessionHash],
    );
    if (!stillSignedIn.rowCount) return await reject({ kind: "unauthorized" });
    await client.query("COMMIT");
    return {
      kind: "ok",
      response: {
        recommendation: {
          submissionId: input.submissionId,
          xp: input.recommendedXp,
          points: input.recommendedPoints,
          updatedAt: row.updated_at.toISOString(),
        },
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
