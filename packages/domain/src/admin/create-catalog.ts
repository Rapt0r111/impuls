import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Input = {
  actorId: string;
  sessionHash: Buffer;
  scope: string;
  idempotencyKey: string;
  requestId: string;
  title: string;
  conditions: string;
  price: number;
  reservationSeconds: number | null;
  reason: string;
  allowCreation: boolean;
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
  creationId: string;
  creation: { rewardId: string; initial: Terms };
  updatedAt: string;
};
export type CatalogCreationEvidence = Response["creation"];
type Result =
  | { kind: "ok"; response: Response }
  | {
      kind:
        | "revoked"
        | "unauthorized"
        | "disabled"
        | "not_found"
        | "idempotency_conflict";
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
    WHERE user_id=$1 AND scope_id=$2 AND action IN ('admin.catalog','admin.catalog.create')
      AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())
    ORDER BY id${lock ? " FOR SHARE" : ""}`,
      [input.actorId, input.scope],
    )
  ).rows;
  if (
    !permissions.some((p) => p.action === "admin.catalog") ||
    !permissions.some((p) => p.action === "admin.catalog.create")
  )
    return "not_found";
  const session = await client.query(
    `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp()${lock ? " FOR SHARE" : ""}`,
    [input.actorId, input.sessionHash],
  );
  return session.rowCount === 1 ? "ok" : "unauthorized";
}

// New identity has no quota or account operation; all evidence commits with one intent.
export async function createCatalogIdentity(
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
    if (!input.allowCreation) return await reject({ kind: "disabled" });
    const body = {
      scope: input.scope,
      title: input.title,
      conditions: input.conditions,
      price: input.price,
      reservationSeconds: input.reservationSeconds,
      reason: input.reason,
    };
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    await client.query(
      `INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash)
      VALUES($1,'catalog.create',$2,$3) ON CONFLICT(actor_id,operation,key) DO NOTHING`,
      [input.actorId, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: Response | null;
      }>(
        `SELECT request_hash,response_body FROM impuls.idempotency_records
      WHERE actor_id=$1 AND operation='catalog.create' AND key=$2 FOR UPDATE`,
        [input.actorId, input.idempotencyKey],
      )
    ).rows[0]!;
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    const afterWait = await authority(client, input, false);
    if (afterWait !== "ok") return await reject({ kind: afterWait });
    if (saved.response_body) {
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    const rewardId = randomUUID();
    const newId = randomUUID();
    // PostgreSQL creates the timestamp, preserving precision beyond the JS Date.
    const inserted = (
      await client.query<Terms>(
        `INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from,reservation_seconds)
      VALUES($1,$2,$3,1,$4,$5,$6,'cosmetic',false,clock_timestamp(),$7)
      RETURNING id,version,title,conditions,price,enabled,
        to_char(effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "effectiveFrom",reservation_seconds AS "reservationSeconds"`,
        [
          newId,
          rewardId,
          input.scope,
          input.title,
          input.conditions,
          input.price,
          input.reservationSeconds,
        ],
      )
    ).rows[0]!;
    const creation = (
      await client.query<{ id: string; at: string }>(
        `INSERT INTO impuls.catalog_creations(initial_version_id,actor_id,request_id,reason)
      VALUES($1,$2,$3,$4) RETURNING id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
        [newId, input.actorId, input.requestId, input.reason],
      )
    ).rows[0]!;
    const response: Response = {
      scope: input.scope,
      creationId: creation.id,
      creation: { rewardId, initial: inserted },
      updatedAt: creation.at,
    };
    const beforeCommit = await authority(client, input, false);
    if (beforeCommit !== "ok") return await reject({ kind: beforeCommit });
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status=201,response_body=$3::jsonb
      WHERE actor_id=$1 AND operation='catalog.create' AND key=$2`,
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
