import type { PoolClient } from "pg";
import { acceptanceSeason } from "./economy";

export type AccountBalance = {
  lifetimeXp: number;
  availablePoints: number;
  reservedPoints: number;
  version: number;
  updatedAt: string | null;
};
export type BalanceRow = {
  lifetime_xp: string;
  available_points: string;
  reserved_points: string;
  version: number;
  updated_at: Date;
};
export function accountBalance(row?: BalanceRow): AccountBalance {
  return row
    ? {
        lifetimeXp: Number(row.lifetime_xp),
        availablePoints: Number(row.available_points),
        reservedPoints: Number(row.reserved_points),
        version: row.version,
        updatedAt: row.updated_at.toISOString(),
      }
    : {
        lifetimeXp: 0,
        availablePoints: 0,
        reservedPoints: 0,
        version: 0,
        updatedAt: null,
      };
}
export type AcceptanceAward = {
  mode: "synthetic";
  xp: number;
  points: number;
  breakdown: {
    baseXp: number;
    basePoints: number;
    bonus: { code: string; title: string; xp: number; points: number } | null;
  } | null;
  ruleVersion: number;
  seasonKey: string;
  timeZone: string;
  acceptedAt: string;
  balance: AccountBalance;
};

export async function creditAcceptedTask(
  client: PoolClient,
  input: {
    reviewId: string;
    userId: string;
    taskId: string;
    title: string;
    ruleSetId: string;
    ruleVersion: number;
    xp: number;
    points: number;
    baseXp: number;
    basePoints: number;
    bonus: { code: string; title: string; xp: number; points: number } | null;
    at: Date;
    timeZone: string;
  },
): Promise<AcceptanceAward> {
  const seasonKey = acceptanceSeason(input.at, input.timeZone);
  await client.query(
    `INSERT INTO impuls.ledger_entries
    (user_id, review_id, task_id, task_title, rule_set_id, rule_version, currency, kind, amount, mode, season_key, time_zone, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'xp', 'task_acceptance', $7, 'synthetic', $9, $10, $11, $11),
           ($1, $2, $3, $4, $5, $6, 'points', 'task_acceptance', $8, 'synthetic', $9, $10, $11, $11)`,
    [
      input.userId,
      input.reviewId,
      input.taskId,
      input.title,
      input.ruleSetId,
      input.ruleVersion,
      input.xp,
      input.points,
      seasonKey,
      input.timeZone,
      input.at,
    ],
  );
  // One PostgreSQL upsert locks the recipient's projection and serializes
  // credits from different accepted tasks without a read/modify/write race.
  const row = (
    await client.query<BalanceRow>(
      `INSERT INTO impuls.account_balances (user_id, lifetime_xp, available_points, updated_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id) DO UPDATE SET lifetime_xp = impuls.account_balances.lifetime_xp + EXCLUDED.lifetime_xp,
      available_points = impuls.account_balances.available_points + EXCLUDED.available_points,
      version = impuls.account_balances.version + 1, updated_at = greatest(impuls.account_balances.updated_at, EXCLUDED.updated_at)
    RETURNING lifetime_xp, available_points, reserved_points, version, updated_at`,
      [input.userId, input.xp, input.points, input.at],
    )
  ).rows[0]!;
  // The balance row serializes different acceptances for the same recipient.
  // Issuance is cosmetic and belongs to this same business transaction.
  await client.query(
    `INSERT INTO impuls.user_achievements(user_id,code,condition_version,source_entry_id,granted_at,provenance)
     SELECT user_id,'first_result',1,id,created_at,'acceptance' FROM impuls.ledger_entries
     WHERE review_id=$1 AND user_id=$2 AND currency='xp' AND kind='task_acceptance'
     ON CONFLICT(user_id,code) DO NOTHING`,
    [input.reviewId, input.userId],
  );
  return {
    mode: "synthetic",
    xp: input.xp,
    points: input.points,
    breakdown: {
      baseXp: input.baseXp,
      basePoints: input.basePoints,
      bonus: input.bonus,
    },
    ruleVersion: input.ruleVersion,
    seasonKey,
    timeZone: input.timeZone,
    acceptedAt: input.at.toISOString(),
    balance: accountBalance(row),
  };
}
