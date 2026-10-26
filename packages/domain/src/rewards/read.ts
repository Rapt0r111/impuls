import type { Pool } from "pg";
import { accountBalance, type BalanceRow } from "../ledger/credit";
import {
  redemption,
  redemptionCursor,
  rewardCursor,
  rewardAccess,
  type RewardCursor,
  type RedemptionRow,
  type RedemptionCursor,
} from "./shared";

export async function readRewardCatalog(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: {
    allowSyntheticRewards: boolean;
    scope?: string | undefined;
    cursor?: RewardCursor | undefined;
    limit?: number;
  },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const access = await rewardAccess(client, actorId, sessionHash);
    if (access !== "ok" || !options.allowSyntheticRewards) {
      await client.query("ROLLBACK");
      return { kind: access !== "ok" ? access : "disabled" } as const;
    }
    const scopes = (
      await client.query<{ id: string; name: string }>(
        `SELECT s.id,s.name FROM impuls.task_scope_members m JOIN impuls.access_scopes s ON s.id=m.scope_id
       WHERE m.user_id=$1 AND m.revoked_at IS NULL AND m.valid_from<=clock_timestamp()
       AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) ORDER BY s.name,s.id`,
        [actorId],
      )
    ).rows;
    const cursor = options.cursor;
    const requestedScope = options.scope ?? cursor?.scope;
    const scope = requestedScope
      ? scopes.find((s) => s.id === requestedScope)
      : scopes[0];
    if (requestedScope && !scope) {
      await client.query("ROLLBACK");
      return { kind: "not_found" } as const;
    }
    if (cursor) {
      if (
        cursor.actor !== actorId ||
        cursor.purpose !== "catalog" ||
        cursor.scope !== scope?.id
      ) {
        await client.query("ROLLBACK");
        return { kind: "invalid_cursor" } as const;
      }
      const anchor = (
        await client.query<{
          id: string;
          enabled: boolean;
          quota_id: string | null;
        }>(
          `SELECT r.id,r.enabled,q.id AS quota_id FROM impuls.reward_versions r
         LEFT JOIN impuls.quota_periods q ON q.reward_id=r.reward_id AND q.scope_id=r.scope_id
           AND q.starts_at<=transaction_timestamp() AND q.ends_at>transaction_timestamp()
         WHERE r.reward_id=$1 AND r.scope_id=$2 AND r.kind='cosmetic'
           AND r.effective_from<=transaction_timestamp() AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id)
         ORDER BY r.effective_from DESC,r.version DESC,r.id DESC LIMIT 1`,
          [cursor.rewardId, scope.id],
        )
      ).rows[0];
      if (!anchor) {
        await client.query("ROLLBACK");
        return { kind: "invalid_cursor" } as const;
      }
      if (
        !anchor.enabled ||
        anchor.id !== cursor.versionId ||
        anchor.quota_id !== cursor.quotaId
      ) {
        await client.query("ROLLBACK");
        return { kind: "page_changed" } as const;
      }
    }
    const balance = accountBalance(
      (
        await client.query<BalanceRow>(
          "SELECT lifetime_xp,available_points,reserved_points,version,updated_at FROM impuls.account_balances WHERE user_id=$1",
          [actorId],
        )
      ).rows[0],
    );
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const rows = scope
      ? (
          await client.query<{
            id: string;
            reward_id: string;
            version: number;
            title: string;
            conditions: string;
            price: number;
            reservation_seconds: number | null;
            quota_id: string;
            starts_at: Date;
            ends_at: Date;
            available: number;
            has_pending: boolean;
            owned: boolean;
          }>(
            `WITH latest AS (
        SELECT DISTINCT ON (reward_id) * FROM impuls.reward_versions r WHERE scope_id=$1 AND effective_from<=transaction_timestamp() AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id)
        ORDER BY reward_id,effective_from DESC,version DESC,id DESC
      ) SELECT r.id,r.reward_id,r.version,r.title,r.conditions,r.price,r.reservation_seconds,q.id AS quota_id,q.starts_at,q.ends_at,
          q.capacity-q.reserved-q.used AS available,
          EXISTS(SELECT 1 FROM impuls.redemptions d WHERE d.user_id=$2 AND d.reward_id=r.reward_id AND d.scope_id=r.scope_id AND d.status IN ('pending','approved')) AS has_pending,
          EXISTS(SELECT 1 FROM impuls.entitlements e WHERE e.user_id=$2 AND e.reward_id=r.reward_id AND e.scope_id=r.scope_id) AS owned
        FROM latest r JOIN impuls.quota_periods q ON q.reward_id=r.reward_id AND q.scope_id=r.scope_id
        WHERE r.enabled AND r.kind='cosmetic' AND q.starts_at<=transaction_timestamp() AND q.ends_at>transaction_timestamp()
          AND ($3::uuid IS NULL OR r.reward_id>$3::uuid) ORDER BY r.reward_id LIMIT $4`,
            [scope.id, actorId, cursor?.rewardId ?? null, limit + 1],
          )
        ).rows
      : [];
    if ((await rewardAccess(client, actorId, sessionHash)) !== "ok") {
      await client.query("ROLLBACK");
      return { kind: "unauthorized" } as const;
    }
    const at = (
      await client.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    await client.query("COMMIT");
    const items = rows.slice(0, limit);
    return {
      kind: "ok",
      response: {
        scopes,
        scope: scope ?? null,
        balance,
        items: items.map((r) => ({
          id: r.id,
          rewardId: r.reward_id,
          version: r.version,
          title: r.title,
          conditions: r.conditions,
          price: r.price,
          reservationSeconds: r.reservation_seconds,
          quota: {
            id: r.quota_id,
            startsAt: r.starts_at.toISOString(),
            endsAt: r.ends_at.toISOString(),
            available: r.available,
          },
          hasPendingRequest: r.has_pending,
          owned: r.owned,
        })),
        nextCursor:
          rows.length > limit
            ? rewardCursor({
                actor: actorId,
                scope: scope!.id,
                purpose: "catalog",
                rewardId: items.at(-1)!.reward_id,
                versionId: items.at(-1)!.id,
                quotaId: items.at(-1)!.quota_id,
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

export async function readMyRedemptions(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: {
    allowSyntheticRewards: boolean;
    cursor?: RedemptionCursor | undefined;
    limit?: number;
  },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const access = await rewardAccess(client, actorId, sessionHash);
    if (access !== "ok" || !options.allowSyntheticRewards) {
      await client.query("ROLLBACK");
      return { kind: access !== "ok" ? access : "disabled" } as const;
    }
    const cursor = options.cursor;
    if (
      cursor &&
      (cursor.actor !== actorId ||
        cursor.scope !== "all" ||
        cursor.purpose !== "mine" ||
        !(
          await client.query(
            "SELECT 1 FROM impuls.redemptions WHERE id=$1 AND user_id=$2",
            [cursor.id, actorId],
          )
        ).rowCount)
    ) {
      await client.query("ROLLBACK");
      return { kind: "invalid_cursor" } as const;
    }
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const rows = (
      await client.query<RedemptionRow>(
        `SELECT d.*,s.name AS scope_name,(SELECT display_name FROM impuls.users WHERE id=d.decision_actor_id) AS decision_actor_name,
          (SELECT display_name FROM impuls.users WHERE id=d.fulfillment_actor_id) AS fulfillment_actor_name,
          (SELECT id FROM impuls.entitlements WHERE redemption_id=d.id) AS entitlement_id
          FROM impuls.redemptions d JOIN impuls.access_scopes s ON s.id=d.scope_id
       WHERE d.user_id=$1 AND ($2::uuid IS NULL OR (d.created_at,d.id)<(
         SELECT a.created_at,a.id FROM impuls.redemptions a WHERE a.id=$2 AND a.user_id=$1))
       ORDER BY d.created_at DESC,d.id DESC LIMIT $3`,
        [actorId, cursor?.id ?? null, limit + 1],
      )
    ).rows;
    const accessAfter = await rewardAccess(client, actorId, sessionHash);
    if (accessAfter !== "ok") {
      await client.query("ROLLBACK");
      return { kind: accessAfter } as const;
    }
    const at = (
      await client.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    await client.query("COMMIT");
    const items = rows.slice(0, limit);
    return {
      kind: "ok",
      response: {
        items: items.map(redemption),
        nextCursor:
          rows.length > limit
            ? redemptionCursor({
                actor: actorId,
                scope: "all",
                purpose: "mine",
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
