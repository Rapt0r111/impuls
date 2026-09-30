import type { Pool } from "pg";
import { accountBalance, type AccountBalance, type BalanceRow } from "./credit";

export type LedgerEntry = {
  id: string;
  currency: "xp" | "points";
  amount: number;
  reason: string;
  task: { id: string; title: string };
  ruleVersion: number;
  seasonKey: string;
  timeZone: string;
  mode: "synthetic";
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
  task_id: string;
  task_title: string;
  rule_version: number;
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
      `SELECT l.id, l.currency, l.amount, r.reason, l.task_id, l.task_title, l.rule_version, l.season_key, l.time_zone, l.created_at
      FROM impuls.ledger_entries l JOIN impuls.reviews r ON r.id = l.review_id
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
          reason: r.reason,
          task: { id: r.task_id, title: r.task_title },
          ruleVersion: r.rule_version,
          seasonKey: r.season_key,
          timeZone: r.time_zone,
          mode: "synthetic",
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
