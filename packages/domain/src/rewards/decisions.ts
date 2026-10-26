import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  redemption,
  redemptionCursor,
  rewardAccess,
  type RedemptionRow,
  type RedemptionCursor,
} from "./shared";

async function authority(
  client: PoolClient,
  actorId: string,
  scopeId: string,
  lock = false,
  action: "reward.decide" | "reward.fulfill" = "reward.decide",
) {
  const found = await client.query(
    `SELECT id FROM impuls.role_bindings WHERE user_id=$1 AND scope_id=$2 AND action=$3
      AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())${lock ? " FOR SHARE" : ""}`,
    [actorId, scopeId, action],
  );
  return Boolean(found.rowCount);
}

export async function readRedemptionReview(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: {
    allowSyntheticRewards: boolean;
    scope?: string | undefined;
    cursor?: RedemptionCursor | undefined;
    limit?: number;
    purpose?: "decide" | "fulfill";
  },
) {
  const client = await pool.connect();
  try {
    const action =
      options.purpose === "fulfill" ? "reward.fulfill" : "reward.decide";
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const access = await rewardAccess(client, actorId, sessionHash);
    if (access !== "ok" || !options.allowSyntheticRewards) {
      await client.query("ROLLBACK");
      return { kind: access !== "ok" ? access : "disabled" } as const;
    }
    const cursor = options.cursor;
    const purpose = options.purpose ?? "decide";
    if (
      cursor &&
      (cursor.actor !== actorId ||
        cursor.purpose !== purpose ||
        cursor.scope === "all")
    ) {
      await client.query("ROLLBACK");
      return { kind: "invalid_cursor" } as const;
    }
    const scopes = (
      await client.query<{ id: string; name: string }>(
        `SELECT DISTINCT s.id,s.name FROM impuls.role_bindings b JOIN impuls.access_scopes s ON s.id=b.scope_id
      WHERE b.user_id=$1 AND b.action=$2 AND b.revoked_at IS NULL AND b.valid_from<=clock_timestamp()
      AND (b.valid_until IS NULL OR b.valid_until>clock_timestamp()) ORDER BY s.name,s.id`,
        [actorId, action],
      )
    ).rows;
    const selectedScope = options.scope ?? cursor?.scope;
    const scope = selectedScope
      ? scopes.find((s) => s.id === selectedScope)
      : scopes[0];
    if (selectedScope && !scope) {
      await client.query("ROLLBACK");
      return { kind: "not_found" } as const;
    }
    if (cursor) {
      const anchor =
        cursor.actor === actorId &&
        cursor.scope === scope?.id &&
        cursor.purpose === purpose
          ? (
              await client.query<{ status: string }>(
                "SELECT status FROM impuls.redemptions WHERE id=$1 AND scope_id=$2 AND user_id<>$3",
                [cursor.id, scope!.id, actorId],
              )
            ).rows[0]
          : undefined;
      if (!anchor) {
        await client.query("ROLLBACK");
        return { kind: "invalid_cursor" } as const;
      }
      if (anchor.status !== (purpose === "fulfill" ? "approved" : "pending")) {
        await client.query("ROLLBACK");
        return { kind: "page_changed" } as const;
      }
    }
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const rows = scope
      ? (
          await client.query<RedemptionRow & { recipient_name: string }>(
            `SELECT d.*,s.name AS scope_name,u.display_name AS recipient_name,
              (SELECT display_name FROM impuls.users WHERE id=d.decision_actor_id) AS decision_actor_name FROM impuls.redemptions d
      JOIN impuls.access_scopes s ON s.id=d.scope_id JOIN impuls.users u ON u.id=d.user_id
      WHERE d.scope_id=$1 AND d.user_id<>$2 AND d.status=$5
        AND ($3::uuid IS NULL OR (d.created_at,d.id)<(
          SELECT a.created_at,a.id FROM impuls.redemptions a WHERE a.id=$3 AND a.scope_id=$1 AND a.user_id<>$2 AND a.status=$5))
      ORDER BY d.created_at DESC,d.id DESC LIMIT $4`,
            [
              scope.id,
              actorId,
              cursor?.id ?? null,
              limit + 1,
              purpose === "fulfill" ? "approved" : "pending",
            ],
          )
        ).rows
      : [];
    const after = await rewardAccess(client, actorId, sessionHash);
    if (
      after !== "ok" ||
      (scope && !(await authority(client, actorId, scope.id, false, action)))
    ) {
      await client.query("ROLLBACK");
      return { kind: after !== "ok" ? after : "not_found" } as const;
    }
    const at = (
      await client.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    await client.query("COMMIT");
    const items = rows.slice(0, limit);
    return {
      kind: "ok",
      response: {
        mode: "synthetic",
        scopes,
        scope: scope ?? null,
        items: items.map((r) => ({
          redemption: redemption(r),
          recipient: { id: r.user_id, displayName: r.recipient_name },
        })),
        nextCursor:
          rows.length > limit
            ? redemptionCursor({
                actor: actorId,
                scope: scope!.id,
                purpose,
                id: items.at(-1)!.id,
              })
            : null,
        updatedAt: at.toISOString(),
      },
    } as const;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type Input = {
  actorId: string;
  sessionHash: Buffer;
  allowSyntheticRewards: boolean;
  redemptionId: string;
  expectedVersion: number;
  decision: "approve" | "reject" | "expire";
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
  | { kind: "reservation_expired" | "reservation_not_due" }
  | { kind: "conflict"; currentVersion: number };

export async function decideRedemption(
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
    // One operation namespace for both outcomes: a key cannot approve and reject.
    const operation = "reward.decide";
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          redemptionId: input.redemptionId,
          expectedVersion: input.expectedVersion,
          decision: input.decision,
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
    // Matches reservation/cancellation: quota -> recipient balance -> redemption.
    const quota = (
      await client.query<{ reserved: number }>(
        "SELECT reserved FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
        [initial.quota_period_id],
      )
    ).rows[0]!;
    const balance = (
      await client.query<{ reserved_points: string }>(
        "SELECT reserved_points FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
        [initial.user_id],
      )
    ).rows[0];
    const current = (
      await client.query<RedemptionRow>(
        "SELECT * FROM impuls.redemptions WHERE id=$1 FOR UPDATE",
        [initial.id],
      )
    ).rows[0]!;
    current.scope_name = initial.scope_name;
    const after = await rewardAccess(client, input.actorId, input.sessionHash);
    if (after !== "ok") return await reject({ kind: after });
    if (!(await authority(client, input.actorId, current.scope_id)))
      return await reject({ kind: "not_found" });
    if (saved.response_body) {
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    if (
      current.status !== "pending" ||
      current.version !== input.expectedVersion
    )
      return await reject({
        kind: "conflict",
        currentVersion: current.version,
      });
    const at = (
      await client.query<{ at: Date }>(
        "SELECT date_trunc('milliseconds',clock_timestamp()) AS at",
      )
    ).rows[0]!.at;
    const due = current.expires_at !== null && at >= current.expires_at;
    if (input.decision === "expire" && !due)
      return await reject({ kind: "reservation_not_due" });
    if (input.decision === "approve" && due)
      return await reject({ kind: "reservation_expired" });
    if (input.decision === "approve") {
      const recipient = (
        await client.query<{ active: boolean }>(
          "SELECT active FROM impuls.users WHERE id=$1 FOR SHARE",
          [current.user_id],
        )
      ).rows[0];
      if (!recipient?.active)
        return await reject({ kind: "recipient_inactive" });
    }
    if (
      !balance ||
      Number(balance.reserved_points) < current.price ||
      quota.reserved < 1
    )
      throw new Error("Reservation projection inconsistent");
    const original = (
      await client.query<{ id: string; season_key: string; time_zone: string }>(
        "SELECT id,season_key,time_zone FROM impuls.ledger_entries WHERE redemption_id=$1 AND kind='reward_reservation'",
        [current.id],
      )
    ).rows[0];
    if (!original) throw new Error("Missing reservation source");
    const approve = input.decision === "approve",
      expire = input.decision === "expire",
      delta = approve ? 0 : current.price;
    const updated = (
      await client.query<RedemptionRow>(
        "UPDATE impuls.redemptions SET status=$2,decision_actor_id=$3,decision_reason=$4,decided_at=$5,version=version+1,updated_at=$5 WHERE id=$1 RETURNING *",
        [
          current.id,
          approve ? "approved" : expire ? "expired" : "rejected",
          input.actorId,
          input.reason,
          at,
        ],
      )
    ).rows[0]!;
    updated.scope_name = initial.scope_name;
    updated.decision_actor_name = (
      await client.query<{ display_name: string }>(
        "SELECT display_name FROM impuls.users WHERE id=$1",
        [input.actorId],
      )
    ).rows[0]!.display_name;
    await client.query(
      "UPDATE impuls.account_balances SET available_points=available_points+$2,reserved_points=reserved_points-$3,version=version+1,updated_at=$4 WHERE user_id=$1",
      [current.user_id, delta, current.price, at],
    );
    await client.query(
      "UPDATE impuls.quota_periods SET reserved=reserved-1,used=used+$2,version=version+1,updated_at=$3 WHERE id=$1",
      [current.quota_period_id, approve ? 1 : 0, at],
    );
    await client.query(
      `INSERT INTO impuls.ledger_entries(user_id,redemption_id,currency,kind,amount,reserved_delta,original_entry_id,season_key,time_zone,created_at,updated_at)
      VALUES($1,$2,'points',$3,$4,$5,$6,$7,$8,$9,$9)`,
      [
        current.user_id,
        current.id,
        approve
          ? "reward_approval"
          : expire
            ? "reward_expiration"
            : "reward_rejection",
        delta,
        -current.price,
        original.id,
        original.season_key,
        original.time_zone,
        at,
      ],
    );
    await client.query(
      "INSERT INTO impuls.audit_events(actor_id,redemption_id,action,request_id,reason,diff,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$7)",
      [
        input.actorId,
        current.id,
        approve ? "reward.approve" : expire ? "reward.expire" : "reward.reject",
        input.requestId,
        input.reason,
        JSON.stringify({
          from: "pending",
          to: updated.status,
          price: current.price,
          version: updated.version,
          availableDelta: delta,
          reservedDelta: -current.price,
          quotaPeriodId: current.quota_period_id,
        }),
        at,
      ],
    );
    await client.query(
      "INSERT INTO impuls.notification_outbox(recipient_id,redemption_id,kind,created_at,updated_at) VALUES($1,$2,$3,$4,$4)",
      [
        current.user_id,
        current.id,
        approve
          ? "reward.approved"
          : expire
            ? "reward.expired"
            : "reward.rejected",
        at,
      ],
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
    // Recheck at the DB write boundary, including recipient lock waits.
    if (error instanceof Error && "code" in error && error.code === "23514") {
      if (error.message === "Reservation has expired")
        return { kind: "reservation_expired" };
      if (error.message === "Reservation is not due")
        return { kind: "reservation_not_due" };
    }
    throw error;
  } finally {
    client.release();
  }
}
