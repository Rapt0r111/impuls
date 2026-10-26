import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Input = {
  actorId: string;
  sessionHash: Buffer;
  rewardId: string;
  scope: string;
  versionId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  requestId: string;
  allowCancellation: boolean;
};
type Terms = {
  id: string;
  version: number;
  title: string;
  conditions: string;
  price: number;
  enabled: boolean;
  effectiveFrom: string;
  reservationSeconds: number | null;
};
type Response = {
  scope: string;
  cancellationId: string;
  cancellation: { rewardId: string; cancelled: Terms };
  updatedAt: string;
};
export type CatalogCancellationEvidence = Response["cancellation"];
type Result =
  | { kind: "ok"; response: Response }
  | {
      kind:
        | "revoked"
        | "unauthorized"
        | "disabled"
        | "not_found"
        | "idempotency_conflict"
        | "conflict"
        | "started";
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
    WHERE user_id=$1 AND scope_id=$2 AND action IN ('admin.catalog','admin.catalog.schedule.cancel')
      AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())
    ORDER BY id${lock ? " FOR SHARE" : ""}`,
      [input.actorId, input.scope],
    )
  ).rows;
  if (
    !permissions.some((p) => p.action === "admin.catalog") ||
    !permissions.some((p) => p.action === "admin.catalog.schedule.cancel")
  )
    return "not_found";
  const session = await client.query(
    `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp()${lock ? " FOR SHARE" : ""}`,
    [input.actorId, input.sessionHash],
  );
  return session.rowCount === 1 ? "ok" : "unauthorized";
}

export async function cancelScheduledCatalogTerms(
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
    if (!input.allowCancellation) return await reject({ kind: "disabled" });
    const target = (
      await client.query<Terms & { future: boolean; cancelled: boolean }>(
        `SELECT r.id,r.version,r.title,r.conditions,r.price,r.enabled,
      to_char(r.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "effectiveFrom",
      r.reservation_seconds AS "reservationSeconds",r.effective_from>clock_timestamp() future,
      EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id) cancelled
      FROM impuls.reward_versions r JOIN impuls.catalog_publications p ON p.published_version_id=r.id
      WHERE r.id=$1 AND r.reward_id=$2 AND r.scope_id=$3 AND r.kind='cosmetic'`,
        [input.versionId, input.rewardId, input.scope],
      )
    ).rows[0];
    if (!target) return await reject({ kind: "not_found" });
    const body = {
      rewardId: input.rewardId,
      scope: input.scope,
      versionId: input.versionId,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
    };
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    await client.query(
      `INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash)
      VALUES($1,'catalog.cancel',$2,$3) ON CONFLICT(actor_id,operation,key) DO NOTHING`,
      [input.actorId, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: Response | null;
      }>(
        `SELECT request_hash,response_body FROM impuls.idempotency_records
      WHERE actor_id=$1 AND operation='catalog.cancel' AND key=$2 FOR UPDATE`,
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
    const state = (
      await client.query<{ future: boolean; cancelled: boolean }>(
        `SELECT effective_from>clock_timestamp() future,
      EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id) cancelled
      FROM impuls.reward_versions r WHERE id=$1`,
        [input.versionId],
      )
    ).rows[0]!;
    if (state.cancelled || target.version !== input.expectedVersion)
      return await reject({ kind: "conflict" });
    if (!state.future) return await reject({ kind: "started" });
    const cancellation = (
      await client.query<{ id: string; at: string }>(
        `INSERT INTO impuls.catalog_cancellations(version_id,actor_id,request_id,reason)
      SELECT $1,$2,$3,$4 FROM impuls.reward_versions WHERE id=$1 AND effective_from>clock_timestamp()
      RETURNING id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
        [input.versionId, input.actorId, input.requestId, input.reason],
      )
    ).rows[0];
    if (!cancellation) return await reject({ kind: "started" });
    const terms: Terms = {
      id: target.id,
      version: target.version,
      title: target.title,
      conditions: target.conditions,
      price: target.price,
      enabled: target.enabled,
      effectiveFrom: target.effectiveFrom,
      reservationSeconds: target.reservationSeconds,
    };
    const response: Response = {
      scope: input.scope,
      cancellationId: cancellation.id,
      cancellation: { rewardId: input.rewardId, cancelled: terms },
      updatedAt: cancellation.at,
    };
    const beforeCommit = await authority(client, input, false);
    if (beforeCommit !== "ok") return await reject({ kind: beforeCommit });
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status=201,response_body=$3::jsonb
      WHERE actor_id=$1 AND operation='catalog.cancel' AND key=$2`,
      [input.actorId, input.idempotencyKey, JSON.stringify(response)],
    );
    await client.query("COMMIT");
    return { kind: "ok", response };
  } catch (error) {
    await client.query("ROLLBACK");
    if (
      (error as { code?: string }).code === "23514" &&
      (error as Error).message ===
        "Only future synthetic terms can be cancelled"
    )
      return { kind: "started" };
    throw error;
  } finally {
    client.release();
  }
}
