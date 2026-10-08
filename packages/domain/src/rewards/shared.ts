import type { PoolClient } from "pg";

export type RewardCursor = {
  actor: string;
  scope: string;
  purpose: "catalog";
  rewardId: string;
  versionId: string;
  quotaId: string;
};
export function rewardCursor(cursor: RewardCursor) {
  return `${cursor.actor}|${cursor.scope}|catalog|${cursor.rewardId}|${cursor.versionId}|${cursor.quotaId}`;
}

export type RedemptionCursor = {
  actor: string;
  scope: string;
  purpose: "mine" | "decide" | "fulfill";
  id: string;
};
export function redemptionCursor(cursor: RedemptionCursor) {
  return `${cursor.actor}|${cursor.scope}|${cursor.purpose}|${cursor.id}`;
}

export type RedemptionRow = {
  id: string;
  user_id: string;
  reward_id: string;
  reward_version_id: string;
  quota_period_id: string;
  scope_id: string;
  scope_name: string;
  title: string;
  conditions: string;
  price: number;
  reward_version: number;
  period_start: Date;
  period_end: Date;
  expires_at: Date | null;
  status:
    "pending" | "cancelled" | "approved" | "rejected" | "fulfilled" | "expired";
  cancellation_reason: string | null;
  decision_actor_id: string | null;
  decision_actor_name?: string | undefined;
  decision_reason: string | null;
  decided_at: Date | null;
  fulfillment_actor_id: string | null;
  fulfillment_actor_name?: string | undefined;
  fulfillment_reason: string | null;
  fulfilled_at: Date | null;
  entitlement_id?: string | undefined;
  version: number;
  created_at: Date;
  updated_at: Date;
};
export function redemption(row: RedemptionRow) {
  return {
    id: row.id,
    rewardId: row.reward_id,
    rewardVersionId: row.reward_version_id,
    quotaPeriodId: row.quota_period_id,
    scope: { id: row.scope_id, name: row.scope_name },
    title: row.title,
    conditions: row.conditions,
    price: row.price,
    rewardVersion: row.reward_version,
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    status: row.status,
    cancellationReason: row.cancellation_reason,
    decision: row.decided_at
      ? {
          actorId: row.decision_actor_id,
          displayName: row.decision_actor_id
            ? (row.decision_actor_name ?? row.decision_actor_id)
            : "Автоматическое истечение резерва",
          reason: row.decision_reason!,
          decidedAt: row.decided_at!.toISOString(),
        }
      : null,
    fulfillment: row.fulfillment_actor_id
      ? {
          actorId: row.fulfillment_actor_id,
          displayName: row.fulfillment_actor_name ?? row.fulfillment_actor_id,
          reason: row.fulfillment_reason!,
          fulfilledAt: row.fulfilled_at!.toISOString(),
          entitlementId: row.entitlement_id!,
        }
      : null,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
export async function rewardAccess(
  client: PoolClient,
  actorId: string,
  sessionHash: Buffer,
  lock = false,
) {
  const user = (
    await client.query<{ active: boolean }>(
      `SELECT active FROM impuls.users WHERE id=$1${lock ? " FOR SHARE" : ""}`,
      [actorId],
    )
  ).rows[0];
  if (!user?.active) return "revoked" as const;
  const session = await client.query(
    `SELECT id FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()${lock ? " FOR SHARE" : ""}`,
    [actorId, sessionHash],
  );
  return session.rowCount ? ("ok" as const) : ("unauthorized" as const);
}
