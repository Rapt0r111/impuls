import type { Pool } from "pg";
import type { RateLimitResult } from "../auth/rate-limit";

// Initial technical limit; verify against pilot traffic before admitting users.
export const TASK_MUTATION_LIMIT = 30;
const WINDOW_SECONDS = 60;

export async function consumeTaskMutationAttempt(
  pool: Pool,
  actorId: string,
): Promise<RateLimitResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query(
      `INSERT INTO impuls.task_mutation_limits (actor_id, attempts, expires_at)
       VALUES ($1, 0, clock_timestamp()) ON CONFLICT (actor_id) DO NOTHING`,
      [actorId],
    );
    await client.query(
      "SELECT actor_id FROM impuls.task_mutation_limits WHERE actor_id=$1 FOR UPDATE",
      [actorId],
    );
    // Sample wall-clock time only after the row lock: requests may wait across
    // the expiry boundary. now()/statement_timestamp() would retain stale time.
    const result = await client.query<{
      attempts: number;
      retry_after: number;
    }>(
      `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at),
       updated AS (
         UPDATE impuls.task_mutation_limits AS limits SET
           attempts = CASE WHEN limits.expires_at <= instant.at THEN 1
             ELSE LEAST(limits.attempts + 1, $2::integer + 1) END,
           expires_at = CASE WHEN limits.expires_at <= instant.at
             THEN instant.at + make_interval(secs => $3) ELSE limits.expires_at END
         FROM instant WHERE limits.actor_id=$1
         RETURNING limits.attempts, limits.expires_at
       )
       SELECT attempts,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - instant.at))::integer) AS retry_after
       FROM updated CROSS JOIN instant`,
      [actorId, TASK_MUTATION_LIMIT, WINDOW_SECONDS],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Mutation limit write returned no row");
    await client.query("COMMIT");
    return row.attempts <= TASK_MUTATION_LIMIT
      ? { allowed: true }
      : { allowed: false, retryAfter: row.retry_after };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
