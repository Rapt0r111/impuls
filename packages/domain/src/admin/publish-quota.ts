import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
type Input = {
  actorId: string;
  sessionHash: Buffer;
  rewardId: string;
  scope: string;
  idempotencyKey: string;
  requestId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reason: string;
  allowPublication: boolean;
};
export type QuotaPublicationEvidence = {
  rewardId: string;
  periodId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
};
type Response = {
  mode: "synthetic";
  scope: string;
  publicationId: string;
  quota: QuotaPublicationEvidence;
  updatedAt: string;
};
type Result =
  | { kind: "ok"; response: Response }
  | {
      kind:
        | "revoked"
        | "unauthorized"
        | "not_found"
        | "disabled"
        | "idempotency_conflict"
        | "overlap"
        | "invalid_period";
    };
async function authority(
  client: PoolClient,
  input: Input,
  lock: boolean,
): Promise<"ok" | "revoked" | "unauthorized" | "not_found"> {
  const user = (
    await client.query<{ active: boolean }>(
      `SELECT active FROM impuls.users WHERE id=$1${lock ? " FOR SHARE" : ""}`,
      [input.actorId],
    )
  ).rows[0];
  if (!user?.active) return "revoked";
  const permissions = (
    await client.query<{ action: string }>(
      `SELECT action FROM impuls.role_bindings
    WHERE user_id=$1 AND scope_id=$2 AND action IN ('admin.catalog','admin.catalog.quota.publish')
      AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())
    ORDER BY id${lock ? " FOR SHARE" : ""}`,
      [input.actorId, input.scope],
    )
  ).rows;
  if (
    !permissions.some((p) => p.action === "admin.catalog") ||
    !permissions.some((p) => p.action === "admin.catalog.quota.publish")
  )
    return "not_found";
  const session = await client.query(
    `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp()${lock ? " FOR SHARE" : ""}`,
    [input.actorId, input.sessionHash],
  );
  return session.rowCount === 1 ? "ok" : "unauthorized";
}
// New immutable terms only. Account balances and previous quota counters are never rewritten.
export async function publishQuotaPeriod(
  pool: Pool,
  input: Input,
): Promise<Result> {
  const client = await pool.connect();
  const reject = async (result: Result) => {
    await client.query("ROLLBACK");
    return result;
  };
  try {
    await client.query("BEGIN");
    const access = await authority(client, input, true);
    if (access !== "ok") return await reject({ kind: access });
    if (!input.allowPublication) return await reject({ kind: "disabled" });
    const identity = await client.query(
      "SELECT 1 FROM impuls.reward_versions WHERE reward_id=$1 AND scope_id=$2 AND kind='cosmetic' LIMIT 1",
      [input.rewardId, input.scope],
    );
    if (!identity.rowCount) return await reject({ kind: "not_found" });
    const body = {
      rewardId: input.rewardId,
      scope: input.scope,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      reason: input.reason,
    };
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    await client.query(
      `INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash)
      VALUES($1,'quota.publish',$2,$3) ON CONFLICT(actor_id,operation,key) DO NOTHING`,
      [input.actorId, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: Response | null;
      }>(
        `SELECT request_hash,response_body FROM impuls.idempotency_records
      WHERE actor_id=$1 AND operation='quota.publish' AND key=$2 FOR UPDATE`,
        [input.actorId, input.idempotencyKey],
      )
    ).rows[0]!;
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text||$2::uuid::text,0))",
      [input.rewardId, input.scope],
    );
    await client.query(
      "SELECT id FROM impuls.quota_periods WHERE reward_id=$1 AND scope_id=$2 ORDER BY id FOR UPDATE",
      [input.rewardId, input.scope],
    );
    const afterWait = await authority(client, input, false);
    if (afterWait !== "ok") return await reject({ kind: afterWait });
    if (saved.response_body) {
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    const valid = (
      await client.query<{ valid: boolean; overlap: boolean }>(
        `SELECT
      ($3::timestamptz>clock_timestamp() AND $4::timestamptz>$3::timestamptz AND $5::integer BETWEEN 0 AND 1000000) valid,
      EXISTS(SELECT 1 FROM impuls.quota_periods WHERE reward_id=$1 AND scope_id=$2 AND starts_at<$4::timestamptz AND ends_at>$3::timestamptz) overlap`,
        [
          input.rewardId,
          input.scope,
          input.startsAt,
          input.endsAt,
          input.capacity,
        ],
      )
    ).rows[0]!;
    if (!valid.valid) return await reject({ kind: "invalid_period" });
    if (valid.overlap) return await reject({ kind: "overlap" });
    const periodId = randomUUID();
    await client.query(
      `INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [
        periodId,
        input.rewardId,
        input.scope,
        input.startsAt,
        input.endsAt,
        input.capacity,
      ],
    );
    const publication = (
      await client.query<{ id: string; at: string }>(
        `INSERT INTO impuls.quota_publications(quota_period_id,reward_id,scope_id,starts_at,ends_at,capacity,actor_id,request_id,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
        [
          periodId,
          input.rewardId,
          input.scope,
          input.startsAt,
          input.endsAt,
          input.capacity,
          input.actorId,
          input.requestId,
          input.reason,
        ],
      )
    ).rows[0]!;
    const response: Response = {
      mode: "synthetic",
      scope: input.scope,
      publicationId: publication.id,
      quota: {
        rewardId: input.rewardId,
        periodId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        capacity: input.capacity,
      },
      updatedAt: publication.at,
    };
    const beforeCommit = await authority(client, input, false);
    if (beforeCommit !== "ok") return await reject({ kind: beforeCommit });
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status=201,response_body=$3::jsonb
      WHERE actor_id=$1 AND operation='quota.publish' AND key=$2`,
      [input.actorId, input.idempotencyKey, JSON.stringify(response)],
    );
    await client.query("COMMIT");
    return { kind: "ok", response };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
