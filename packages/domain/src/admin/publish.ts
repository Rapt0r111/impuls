import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Input = {
  actorId: string;
  sessionHash: Buffer;
  rewardId: string;
  scope: string;
  idempotencyKey: string;
  requestId: string;
  enabled: boolean;
  expectedVersion: number;
  title: string;
  conditions: string;
  price: number;
  reservationSeconds: number | null;
  reason: string;
  allowPublication: boolean;
  effectiveFrom?: string;
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
  publicationId: string;
  catalog: { rewardId: string; previousVersion: number; published: Terms };
  updatedAt: string;
};
export type CatalogPublicationEvidence = Response["catalog"];
type Result =
  | { kind: "ok"; response: Response }
  | {
      kind:
        | "revoked"
        | "unauthorized"
        | "disabled"
        | "not_found"
        | "idempotency_conflict"
        | "scheduled"
        | "invalid_effective_time"
        | "configuration_invalid";
    }
  | { kind: "conflict"; currentVersion: number };

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
    WHERE user_id=$1 AND scope_id=$2 AND action IN ('admin.catalog',$3)
      AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())
    ORDER BY id${lock ? " FOR SHARE" : ""}`,
      [
        input.actorId,
        input.scope,
        input.effectiveFrom === undefined
          ? "admin.catalog.publish"
          : "admin.catalog.schedule",
      ],
    )
  ).rows;
  if (
    !permissions.some((p) => p.action === "admin.catalog") ||
    !permissions.some(
      (p) =>
        p.action ===
        (input.effectiveFrom === undefined
          ? "admin.catalog.publish"
          : "admin.catalog.schedule"),
    )
  )
    return "not_found";
  const session = await client.query(
    `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp()${lock ? " FOR SHARE" : ""}`,
    [input.actorId, input.sessionHash],
  );
  return session.rowCount === 1 ? "ok" : "unauthorized";
}

// Publication shares the quota barrier with F06. It never locks or rewrites an account.
export async function publishCatalogTerms(
  pool: Pool,
  input: Input,
): Promise<Result> {
  const client = await pool.connect();
  const operation =
    input.effectiveFrom === undefined ? "catalog.publish" : "catalog.schedule";
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
      expectedVersion: input.expectedVersion,
      title: input.title,
      conditions: input.conditions,
      price: input.price,
      enabled: input.enabled,
      reservationSeconds: input.reservationSeconds,
      reason: input.reason,
      ...(input.effectiveFrom === undefined
        ? {}
        : { effectiveFrom: input.effectiveFrom }),
    };
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    await client.query(
      `INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash)
      VALUES($1,$4,$2,$3) ON CONFLICT(actor_id,operation,key) DO NOTHING`,
      [input.actorId, input.idempotencyKey, hash, operation],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: Response | null;
      }>(
        `SELECT request_hash,response_body FROM impuls.idempotency_records
      WHERE actor_id=$1 AND operation=$3 AND key=$2 FOR UPDATE`,
        [input.actorId, input.idempotencyKey, operation],
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
    if (input.effectiveFrom !== undefined) {
      const valid = await client.query<{ valid: boolean }>(
        "SELECT $1::timestamptz > clock_timestamp() valid",
        [input.effectiveFrom],
      );
      if (!valid.rows[0]?.valid)
        return await reject({ kind: "invalid_effective_time" });
    }
    const versions = (
      await client.query<{
        id: string;
        version: number;
        future: boolean;
        effective_rank: string;
        cancelled: boolean;
      }>(
        `WITH cutoff AS MATERIALIZED (SELECT clock_timestamp() at)
      SELECT id,version,effective_from>=cutoff.at future,
        EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id) cancelled,
        row_number() OVER (ORDER BY EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id),effective_from DESC,version DESC,id DESC) effective_rank
      FROM impuls.reward_versions r CROSS JOIN cutoff WHERE reward_id=$1 AND scope_id=$2 ORDER BY version DESC`,
        [input.rewardId, input.scope],
      )
    ).rows;
    const maximumVersion = versions[0]?.version ?? 0;
    const activeVersions = versions.filter((v) => !v.cancelled);
    const latest = activeVersions[0];
    if (!latest) return await reject({ kind: "not_found" });
    if (activeVersions.some((v) => v.future))
      return await reject({ kind: "scheduled" });
    if (latest.effective_rank !== "1" || maximumVersion >= 2147483647)
      return await reject({ kind: "configuration_invalid" });
    if (input.expectedVersion !== latest.version)
      return await reject({ kind: "conflict", currentVersion: latest.version });
    const newId = randomUUID();
    // PostgreSQL creates the timestamp, preserving precision beyond the JS Date.
    const inserted = (
      await client.query<Terms>(
        `INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from,reservation_seconds)
      SELECT $1,$2,$3,$4,$5,$6,$7,'cosmetic',$8,coalesce($10::timestamptz,clock_timestamp()),$9
      WHERE $10::timestamptz IS NULL OR $10::timestamptz>clock_timestamp()
      RETURNING id,version,title,conditions,price,enabled,
        to_char(effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "effectiveFrom",reservation_seconds AS "reservationSeconds"`,
        [
          newId,
          input.rewardId,
          input.scope,
          maximumVersion + 1,
          input.title,
          input.conditions,
          input.price,
          input.enabled,
          input.reservationSeconds,
          input.effectiveFrom ?? null,
        ],
      )
    ).rows[0]!;
    if (!inserted) return await reject({ kind: "invalid_effective_time" });
    const publication = (
      await client.query<{ id: string; at: string }>(
        `INSERT INTO impuls.catalog_publications(previous_version_id,published_version_id,actor_id,request_id,reason)
      VALUES($1,$2,$3,$4,$5) RETURNING id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
        [latest.id, newId, input.actorId, input.requestId, input.reason],
      )
    ).rows[0]!;
    const response: Response = {
      scope: input.scope,
      publicationId: publication.id,
      catalog: {
        rewardId: input.rewardId,
        previousVersion: latest.version,
        published: inserted,
      },
      updatedAt: publication.at,
    };
    const beforeCommit = await authority(client, input, false);
    if (beforeCommit !== "ok") return await reject({ kind: beforeCommit });
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status=201,response_body=$3::jsonb
      WHERE actor_id=$1 AND operation=$4 AND key=$2`,
      [
        input.actorId,
        input.idempotencyKey,
        JSON.stringify(response),
        operation,
      ],
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
