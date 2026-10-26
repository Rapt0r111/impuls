import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { redemption, rewardAccess, type RedemptionRow } from "./shared";

async function authority(
  client: PoolClient,
  actorId: string,
  scopeId: string,
  lock = false,
) {
  const found = await client.query(
    `SELECT id FROM impuls.role_bindings WHERE user_id=$1 AND scope_id=$2 AND action='reward.fulfill'
      AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())${lock ? " FOR SHARE" : ""}`,
    [actorId, scopeId],
  );
  return Boolean(found.rowCount);
}
type Input = {
  actorId: string;
  sessionHash: Buffer;
  allowSyntheticRewards: boolean;
  redemptionId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  requestId: string;
};
type Response = {
  mode: "synthetic";
  redemption: ReturnType<typeof redemption>;
};
type Result =
  | { kind: "ok"; response: Response }
  | {
      kind:
        | "unauthorized"
        | "revoked"
        | "disabled"
        | "not_found"
        | "idempotency_conflict"
        | "recipient_inactive";
    }
  | { kind: "conflict"; currentVersion: number };

export async function fulfillRedemption(
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
    const access = await rewardAccess(
      client,
      input.actorId,
      input.sessionHash,
      true,
    );
    if (access !== "ok") return await reject({ kind: access });
    if (!input.allowSyntheticRewards) return await reject({ kind: "disabled" });
    const initial = (
      await client.query<RedemptionRow>(
        "SELECT d.*,s.name AS scope_name FROM impuls.redemptions d JOIN impuls.access_scopes s ON s.id=d.scope_id WHERE d.id=$1",
        [input.redemptionId],
      )
    ).rows[0];
    if (
      !initial ||
      initial.user_id === input.actorId ||
      !(await authority(client, input.actorId, initial.scope_id, true))
    )
      return await reject({ kind: "not_found" });
    const operation = "reward.fulfill";
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          redemptionId: input.redemptionId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        }),
      )
      .digest();
    await client.query(
      "INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(actor_id,operation,key) DO NOTHING",
      [input.actorId, operation, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: Response | null;
      }>(
        "SELECT request_hash,response_body FROM impuls.idempotency_records WHERE actor_id=$1 AND operation=$2 AND key=$3 FOR UPDATE",
        [input.actorId, operation, input.idempotencyKey],
      )
    ).rows[0]!;
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    // All reward mutations keep quota -> recipient balance -> request order.
    await client.query(
      "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
      [initial.quota_period_id],
    );
    await client.query(
      "SELECT user_id FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
      [initial.user_id],
    );
    const current = (
      await client.query<RedemptionRow>(
        "SELECT * FROM impuls.redemptions WHERE id=$1 FOR UPDATE",
        [initial.id],
      )
    ).rows[0]!;
    const after = await rewardAccess(client, input.actorId, input.sessionHash);
    if (after !== "ok") return await reject({ kind: after });
    if (!(await authority(client, input.actorId, current.scope_id)))
      return await reject({ kind: "not_found" });
    if (saved.response_body) {
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    if (
      current.status !== "approved" ||
      current.version !== input.expectedVersion
    )
      return await reject({
        kind: "conflict",
        currentVersion: current.version,
      });
    const recipient = (
      await client.query<{ active: boolean }>(
        "SELECT active FROM impuls.users WHERE id=$1 FOR SHARE",
        [current.user_id],
      )
    ).rows[0];
    if (!recipient?.active) return await reject({ kind: "recipient_inactive" });
    // The recipient lock may itself wait. Expiring authority must not commit.
    const finalAccess = await rewardAccess(
      client,
      input.actorId,
      input.sessionHash,
    );
    if (finalAccess !== "ok") return await reject({ kind: finalAccess });
    if (!(await authority(client, input.actorId, current.scope_id)))
      return await reject({ kind: "not_found" });
    const at = (
      await client.query<{ at: Date }>(
        "SELECT date_trunc('milliseconds',clock_timestamp()) AS at",
      )
    ).rows[0]!.at;
    const updated = (
      await client.query<RedemptionRow>(
        "UPDATE impuls.redemptions SET status='fulfilled',fulfillment_actor_id=$2,fulfillment_reason=$3,fulfilled_at=$4,version=version+1,updated_at=$4 WHERE id=$1 RETURNING *",
        [current.id, input.actorId, input.reason, at],
      )
    ).rows[0]!;
    const entitlement = (
      await client.query<{ id: string }>(
        "INSERT INTO impuls.entitlements(redemption_id,user_id,reward_id,scope_id,actor_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [
          current.id,
          current.user_id,
          current.reward_id,
          current.scope_id,
          input.actorId,
          input.reason,
          at,
        ],
      )
    ).rows[0]!;
    updated.scope_name = initial.scope_name;
    updated.entitlement_id = entitlement.id;
    const names = (
      await client.query<{ id: string; display_name: string }>(
        "SELECT id,display_name FROM impuls.users WHERE id=ANY($1::uuid[])",
        [[input.actorId, current.decision_actor_id]],
      )
    ).rows;
    updated.fulfillment_actor_name = names.find(
      (u) => u.id === input.actorId,
    )!.display_name;
    updated.decision_actor_name = names.find(
      (u) => u.id === current.decision_actor_id,
    )!.display_name;
    await client.query(
      "INSERT INTO impuls.audit_events(actor_id,redemption_id,action,request_id,reason,diff,created_at,updated_at) VALUES($1,$2,'reward.fulfill',$3,$4,$5::jsonb,$6,$6)",
      [
        input.actorId,
        current.id,
        input.requestId,
        input.reason,
        JSON.stringify({
          from: "approved",
          to: "fulfilled",
          version: updated.version,
          entitlementId: entitlement.id,
        }),
        at,
      ],
    );
    await client.query(
      "INSERT INTO impuls.notification_outbox(recipient_id,redemption_id,kind,created_at,updated_at) VALUES($1,$2,'reward.fulfilled',$3,$3)",
      [current.user_id, current.id, at],
    );
    const response: Response = {
      mode: "synthetic",
      redemption: redemption(updated),
    };
    await client.query(
      "UPDATE impuls.idempotency_records SET response_status=200,response_body=$4::jsonb WHERE actor_id=$1 AND operation=$2 AND key=$3",
      [
        input.actorId,
        operation,
        input.idempotencyKey,
        JSON.stringify(response),
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
