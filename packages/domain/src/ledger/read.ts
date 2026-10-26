import type { Pool } from "pg";
import { accountBalance, type AccountBalance, type BalanceRow } from "./credit";

export type LedgerEntry = {
  id: string;
  currency: "xp" | "points";
  amount: number;
  kind:
    | "task_acceptance"
    | "acceptance_reversal"
    | "reward_reservation"
    | "reward_cancellation"
    | "reward_approval"
    | "reward_rejection"
    | "reward_expiration";
  correction: {
    id: string;
    originalEntryId: string;
    actor: { id: string; displayName: string };
  } | null;
  reason: string;
  task: { id: string; title: string } | null;
  reward: { redemptionId: string; title: string; version: number } | null;
  reservedDelta: number;
  ruleVersion: number | null;
  seasonKey: string;
  timeZone: string;
  createdAt: string;
};
export type AccountLedger = {
  balance: AccountBalance;
  entries: LedgerEntry[];
  nextCursor: string | null;
  asOf: string;
};
type EntryRow = {
  id: string;
  currency: LedgerEntry["currency"];
  amount: number;
  reason: string;
  task_id: string | null;
  kind: LedgerEntry["kind"];
  correction_id: string | null;
  original_entry_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  task_title: string | null;
  redemption_id: string | null;
  reward_title: string | null;
  reward_version: number | null;
  reserved_delta: number;
  rule_version: number | null;
  season_key: string;
  time_zone: string;
  created_at: Date;
};

export async function readAccountLedger(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: {
    limit?: number;
    cursor?: { at: string; id: string } | undefined;
  } = {},
): Promise<
  | { kind: "ok"; response: AccountLedger }
  | { kind: "unauthorized" }
  | { kind: "revoked" }
> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const user = (
      await client.query<{ active: boolean }>(
        "SELECT active FROM impuls.users WHERE id = $1",
        [actorId],
      )
    ).rows[0];
    if (!user?.active) {
      await client.query("ROLLBACK");
      return { kind: "revoked" };
    }
    const session = await client.query(
      "SELECT 1 FROM impuls.sessions WHERE user_id = $1 AND session_hash = $2 AND revoked_at IS NULL AND expires_at > clock_timestamp()",
      [actorId, sessionHash],
    );
    if (!session.rowCount) {
      await client.query("ROLLBACK");
      return { kind: "unauthorized" };
    }
    const balance = (
      await client.query<BalanceRow>(
        "SELECT lifetime_xp, available_points, reserved_points, version, updated_at FROM impuls.account_balances WHERE user_id = $1",
        [actorId],
      )
    ).rows[0];
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const result = await client.query<EntryRow>(
      `SELECT l.id, l.currency, l.amount, l.kind, coalesce(c.reason,r.reason,CASE WHEN l.kind='reward_reservation' THEN 'Резерв по заявке' WHEN l.kind IN ('reward_approval','reward_rejection','reward_expiration') THEN d.decision_reason ELSE d.cancellation_reason END) AS reason, l.task_id, l.task_title, l.rule_version, l.season_key, l.time_zone, l.created_at,
        l.redemption_id,d.title AS reward_title,d.reward_version,l.reserved_delta,
        c.id AS correction_id,l.original_entry_id,c.actor_id,u.display_name AS actor_name
      FROM impuls.ledger_entries l LEFT JOIN impuls.reviews r ON r.id = l.review_id
      LEFT JOIN impuls.redemptions d ON d.id=l.redemption_id
      LEFT JOIN impuls.ledger_corrections c ON c.id=l.correction_id LEFT JOIN impuls.users u ON u.id=c.actor_id
      WHERE l.user_id = $1 AND ($2::timestamptz IS NULL OR (l.created_at, l.id) < ($2::timestamptz, $3::uuid))
      ORDER BY l.created_at DESC, l.id DESC LIMIT $4`,
      [
        actorId,
        options.cursor?.at ?? null,
        options.cursor?.id ?? null,
        limit + 1,
      ],
    );
    const rows = result.rows.slice(0, limit);
    const at = (
      await client.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    await client.query("COMMIT");
    return {
      kind: "ok",
      response: {
        balance: accountBalance(balance),
        entries: rows.map((r) => ({
          id: r.id,
          currency: r.currency,
          amount: r.amount,
          kind: r.kind,
          correction: r.correction_id
            ? {
                id: r.correction_id,
                originalEntryId: r.original_entry_id!,
                actor: { id: r.actor_id!, displayName: r.actor_name! },
              }
            : null,
          reason: r.reason,
          task: r.task_id ? { id: r.task_id, title: r.task_title! } : null,
          reward: r.redemption_id
            ? {
                redemptionId: r.redemption_id,
                title: r.reward_title!,
                version: r.reward_version!,
              }
            : null,
          reservedDelta: r.reserved_delta,
          ruleVersion: r.rule_version,
          seasonKey: r.season_key,
          timeZone: r.time_zone,
          createdAt: r.created_at.toISOString(),
        })),
        nextCursor:
          result.rows.length > limit
            ? `${rows.at(-1)!.created_at.toISOString()}|${rows.at(-1)!.id}`
            : null,
        asOf: at.toISOString(),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
