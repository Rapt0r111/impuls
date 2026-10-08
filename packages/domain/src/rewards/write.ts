import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  accountBalance,
  type BalanceRow,
  type AccountBalance,
} from "../ledger/credit";
import { acceptanceSeason } from "../ledger/economy";
import { redemption, rewardAccess, type RedemptionRow } from "./shared";

type Common = {
  actorId: string;
  sessionHash: Buffer;
  idempotencyKey: string;
  requestId: string;
  allowSyntheticRewards: boolean;
};
type Input = Common &
  (
    | {
        action: "reserve";
        rewardVersionId: string;
        quotaPeriodId: string;
        expectedVersion: number;
      }
    | {
        action: "cancel";
        redemptionId: string;
        expectedVersion: number;
        reason: string;
      }
  );
type Response = {
  mode: "synthetic";
  redemption: ReturnType<typeof redemption>;
  balance: AccountBalance;
};
type Result =
  | { kind: "ok"; status: 200 | 201; response: Response }
  | {
      kind:
        | "revoked"
        | "unauthorized"
        | "disabled"
        | "not_found"
        | "idempotency_conflict"
        | "insufficient_points"
        | "quota_full"
        | "already_pending";
    }
  | { kind: "conflict"; currentVersion: number };
type RewardRow = {
  id: string;
  reward_id: string;
  scope_id: string;
  version: number;
  title: string;
  conditions: string;
  price: number;
  enabled: boolean;
  reservation_seconds: number | null;
};
type QuotaRow = {
  id: string;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  reserved: number;
  used: number;
};

export async function mutateRedemption(
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
    const body =
      input.action === "reserve"
        ? {
            rewardVersionId: input.rewardVersionId,
            quotaPeriodId: input.quotaPeriodId,
            expectedVersion: input.expectedVersion,
          }
        : {
            redemptionId: input.redemptionId,
            expectedVersion: input.expectedVersion,
            reason: input.reason,
          };
    const operation = `reward.${input.action}`;
    const hash = createHash("sha256").update(JSON.stringify(body)).digest();
    await client.query(
      "INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(actor_id,operation,key) DO NOTHING",
      [input.actorId, operation, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_status: 200 | 201 | null;
        response_body: Response | null;
      }>(
        "SELECT request_hash,response_status,response_body FROM impuls.idempotency_records WHERE actor_id=$1 AND operation=$2 AND key=$3 FOR UPDATE",
        [input.actorId, operation, input.idempotencyKey],
      )
    ).rows[0]!;
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    let reward: RewardRow | undefined;
    let current: RedemptionRow | undefined;
    if (input.action === "reserve") {
      reward = (
        await client.query<RewardRow>(
          "SELECT * FROM impuls.reward_versions r WHERE id=$1 AND effective_from<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id)",
          [input.rewardVersionId],
        )
      ).rows[0];
      if (!reward) return await reject({ kind: "not_found" });
      const membership = await client.query(
        `SELECT id FROM impuls.task_scope_members WHERE user_id=$1 AND scope_id=$2 AND synthetic
          AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) FOR SHARE`,
        [input.actorId, reward.scope_id],
      );
      if (!membership.rowCount) return await reject({ kind: "not_found" });
    } else {
      current = (
        await client.query<RedemptionRow>(
          "SELECT d.*,s.name AS scope_name FROM impuls.redemptions d JOIN impuls.access_scopes s ON s.id=d.scope_id WHERE d.id=$1 AND d.user_id=$2",
          [input.redemptionId, input.actorId],
        )
      ).rows[0];
      if (!current) return await reject({ kind: "not_found" });
    }
    // Shared lock order for both operations: quota, account, existing request.
    // Scope authority was checked before a saved reservation is exposed.
    const quota = (
      await client.query<QuotaRow>(
        "SELECT * FROM impuls.quota_periods WHERE id=$1 AND reward_id=$2 AND scope_id=$3 FOR UPDATE",
        [
          input.action === "reserve"
            ? input.quotaPeriodId
            : current!.quota_period_id,
          reward?.reward_id ?? current!.reward_id,
          reward?.scope_id ?? current!.scope_id,
        ],
      )
    ).rows[0];
    if (!quota) return await reject({ kind: "not_found" });
    await client.query(
      "INSERT INTO impuls.account_balances(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",
      [input.actorId],
    );
    const balance = (
      await client.query<BalanceRow>(
        "SELECT lifetime_xp,available_points,reserved_points,version,updated_at FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
        [input.actorId],
      )
    ).rows[0]!;
    const accessAfter = await rewardAccess(
      client,
      input.actorId,
      input.sessionHash,
    );
    if (accessAfter !== "ok") return await reject({ kind: accessAfter });
    if (input.action === "reserve") {
      const membership = await client.query(
        "SELECT 1 FROM impuls.task_scope_members WHERE user_id=$1 AND scope_id=$2 AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())",
        [input.actorId, reward!.scope_id],
      );
      if (!membership.rowCount) return await reject({ kind: "not_found" });
    }
    if (saved.response_body && saved.response_status) {
      await client.query("COMMIT");
      return {
        kind: "ok",
        status: saved.response_status,
        response: saved.response_body,
      };
    }
    const at = (
      await client.query<{ at: Date }>(
        "SELECT date_trunc('milliseconds',clock_timestamp()) AS at",
      )
    ).rows[0]!.at;
    let price: number;
    let seasonKey = acceptanceSeason(at, "Europe/Moscow");
    let originalEntry: string | null = null;
    if (input.action === "reserve") {
      const latest = (
        await client.query<{ id: string; version: number }>(
          "SELECT id,version FROM impuls.reward_versions r WHERE reward_id=$1 AND scope_id=$2 AND effective_from<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id) ORDER BY effective_from DESC,version DESC,id DESC LIMIT 1",
          [reward!.reward_id, reward!.scope_id],
        )
      ).rows[0]!;
      if (
        latest.id !== reward!.id ||
        input.expectedVersion !== reward!.version ||
        !reward!.enabled
      )
        return await reject({
          kind: "conflict",
          currentVersion: latest.version,
        });
      if (at < quota.starts_at || at >= quota.ends_at)
        return await reject({
          kind: "conflict",
          currentVersion: reward!.version,
        });
      if (
        (
          await client.query(
            "SELECT 1 FROM impuls.redemptions WHERE user_id=$1 AND reward_id=$2 AND scope_id=$3 AND status IN ('pending','approved','fulfilled')",
            [input.actorId, reward!.reward_id, reward!.scope_id],
          )
        ).rowCount
      )
        return await reject({ kind: "already_pending" });
      if (quota.reserved + quota.used >= quota.capacity)
        return await reject({ kind: "quota_full" });
      price = reward!.price;
      if (Number(balance.available_points) < price)
        return await reject({ kind: "insufficient_points" });
      current = (
        await client.query<RedemptionRow>(
          `INSERT INTO impuls.redemptions(user_id,reward_version_id,reward_id,scope_id,quota_period_id,reward_version,title,conditions,price,period_start,period_end,mode,created_at,updated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'synthetic',$12,$12,CASE WHEN $13::integer IS NULL THEN NULL ELSE $12::timestamptz+$13*interval '1 second' END) RETURNING *`,
          [
            input.actorId,
            reward!.id,
            reward!.reward_id,
            reward!.scope_id,
            quota.id,
            reward!.version,
            reward!.title,
            reward!.conditions,
            price,
            quota.starts_at,
            quota.ends_at,
            at,
            reward!.reservation_seconds,
          ],
        )
      ).rows[0]!;
      current.scope_name = (
        await client.query<{ name: string }>(
          "SELECT name FROM impuls.access_scopes WHERE id=$1",
          [current.scope_id],
        )
      ).rows[0]!.name;
    } else {
      const locked = (
        await client.query<RedemptionRow>(
          "SELECT * FROM impuls.redemptions WHERE id=$1 FOR UPDATE",
          [current!.id],
        )
      ).rows[0]!;
      locked.scope_name = current!.scope_name;
      current = locked;
      const accessAfterRequestLock = await rewardAccess(
        client,
        input.actorId,
        input.sessionHash,
      );
      if (accessAfterRequestLock !== "ok")
        return await reject({ kind: accessAfterRequestLock });
      if (
        current.status !== "pending" ||
        current.version !== input.expectedVersion
      )
        return await reject({
          kind: "conflict",
          currentVersion: current.version,
        });
      price = current.price;
      if (Number(balance.reserved_points) < price || quota.reserved < 1)
        throw new Error("Reservation projection inconsistent");
      const original = (
        await client.query<{ id: string; season_key: string }>(
          "SELECT id,season_key FROM impuls.ledger_entries WHERE redemption_id=$1 AND kind='reward_reservation'",
          [current.id],
        )
      ).rows[0];
      if (!original) throw new Error("Missing reservation source");
      originalEntry = original.id;
      seasonKey = original.season_key;
      await client.query(
        "UPDATE impuls.redemptions SET status='cancelled',cancellation_reason=$2,version=version+1,updated_at=$3 WHERE id=$1",
        [current.id, input.reason, at],
      );
      current = {
        ...current,
        status: "cancelled",
        cancellation_reason: input.reason,
        version: current.version + 1,
        updated_at: at,
      };
    }
    const delta = input.action === "reserve" ? -price : price;
    const updated = (
      await client.query<BalanceRow>(
        `UPDATE impuls.account_balances SET available_points=available_points+$2,reserved_points=reserved_points-$2,version=version+1,updated_at=$3 WHERE user_id=$1 RETURNING *`,
        [input.actorId, delta, at],
      )
    ).rows[0]!;
    await client.query(
      "UPDATE impuls.quota_periods SET reserved=reserved+$2,version=version+1,updated_at=$3 WHERE id=$1",
      [quota.id, input.action === "reserve" ? 1 : -1, at],
    );
    await client.query(
      `INSERT INTO impuls.ledger_entries(user_id,redemption_id,currency,kind,amount,reserved_delta,original_entry_id,mode,season_key,time_zone,created_at,updated_at)
       VALUES($1,$2,'points',$3,$4,$5,$6,'synthetic',$7,'Europe/Moscow',$8,$8)`,
      [
        input.actorId,
        current!.id,
        input.action === "reserve"
          ? "reward_reservation"
          : "reward_cancellation",
        delta,
        -delta,
        originalEntry,
        seasonKey,
        at,
      ],
    );
    const reason =
      input.action === "reserve"
        ? "Резерв по синтетической заявке"
        : input.reason;
    await client.query(
      `INSERT INTO impuls.audit_events(actor_id,redemption_id,action,request_id,reason,diff,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$7)`,
      [
        input.actorId,
        current!.id,
        operation,
        input.requestId,
        reason,
        JSON.stringify({
          status: current!.status,
          price,
          rewardVersion: current!.reward_version,
          quotaPeriodId: quota.id,
          availableDelta: delta,
          reservedDelta: -delta,
        }),
        at,
      ],
    );
    await client.query(
      "INSERT INTO impuls.notification_outbox(recipient_id,redemption_id,kind,mode,created_at,updated_at) VALUES($1,$2,$3,'synthetic',$4,$4)",
      [
        input.actorId,
        current!.id,
        input.action === "reserve" ? "reward.reserved" : "reward.cancelled",
        at,
      ],
    );
    const response: Response = {
      mode: "synthetic",
      redemption: redemption(current!),
      balance: accountBalance(updated),
    };
    const status = input.action === "reserve" ? 201 : 200;
    await client.query(
      "UPDATE impuls.idempotency_records SET response_status=$4,response_body=$5::jsonb WHERE actor_id=$1 AND operation=$2 AND key=$3",
      [
        input.actorId,
        operation,
        input.idempotencyKey,
        status,
        JSON.stringify(response),
      ],
    );
    await client.query("COMMIT");
    return { kind: "ok", status, response };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
