import { createHmac } from "node:crypto";
import type { Pool } from "pg";

type RateLimitScope = "login-ip" | "login-telegram" | "mutation-user";
type RateLimitRow = { attempts: number; retry_after: number };

export type RateLimitResult =
  { allowed: true } | { allowed: false; retryAfter: number };

async function consumeAttempt(
  pool: Pool,
  scope: RateLimitScope,
  identity: string,
  secret: string,
  limit: number,
): Promise<RateLimitResult> {
  const keyHash = createHmac("sha256", secret)
    .update(`${scope}:${identity}`)
    .digest();
  const result = await pool.query<RateLimitRow>(
    `INSERT INTO impuls.auth_rate_limits AS limits (key_hash, attempts, expires_at)
     VALUES ($1, 1, now() + interval '60 seconds')
     ON CONFLICT (key_hash) DO UPDATE SET
       attempts = CASE
         WHEN limits.expires_at <= now() THEN 1
         ELSE LEAST(limits.attempts + 1, $2::integer + 1)
       END,
       expires_at = CASE
         WHEN limits.expires_at <= now() THEN now() + interval '60 seconds'
         ELSE limits.expires_at
       END
     RETURNING attempts,
       GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - now()))::integer) AS retry_after`,
    [keyHash, limit],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Rate limit write returned no row");

  // Function instances can be frozen, so cleanup runs within sampled requests.
  if (Math.random() < 0.01) {
    await pool
      .query(
        "DELETE FROM impuls.auth_rate_limits WHERE expires_at < now() - interval '1 day'",
      )
      .catch(() => undefined);
  }

  return row.attempts <= limit
    ? { allowed: true }
    : { allowed: false, retryAfter: row.retry_after };
}

export function consumeLoginAttempt(
  pool: Pool,
  scope: "login-ip" | "login-telegram",
  identity: string,
  secret: string,
  limit: number,
) {
  return consumeAttempt(pool, scope, identity, secret, limit);
}

export function consumeMutationAttempt(
  pool: Pool,
  userId: string,
  secret: string,
) {
  return consumeAttempt(pool, "mutation-user", userId, secret, 60);
}
