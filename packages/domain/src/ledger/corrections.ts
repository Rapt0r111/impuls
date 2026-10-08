import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { accountBalance, type AccountBalance, type BalanceRow } from "./credit";
import { syntheticEconomyZone } from "./economy";

type Correction = {
  id: string;
  reviewId: string;
  reason: string;
  xpDelta: number;
  pointsDelta: number;
  createdAt: string;
};
type CorrectionResponse = { correction: Correction; balance: AccountBalance };
export type LedgerCorrectionInput = {
  actorId: string;
  sessionHash: Buffer;
  reviewId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  requestId?: string;
  allowSyntheticCorrections?: boolean;
};
type CorrectionFailure =
  | "unauthorized"
  | "revoked"
  | "not_found"
  | "self_correction"
  | "recipient_revoked"
  | "disabled"
  | "rules_invalid"
  | "idempotency_conflict"
  | "already_corrected"
  | "insufficient_balance";
export type LedgerCorrectionResult =
  | { kind: "ok"; response: CorrectionResponse }
  | { [K in CorrectionFailure]: { kind: K } }[CorrectionFailure]
  | { kind: "conflict"; currentVersion: number };
type AwardRow = {
  review_id: string;
  user_id: string;
  task_id: string;
  task_title: string;
  scope_id: string;
  scope_name: string;
  display_name: string;
  active: boolean;
  xp: number;
  points: number;
  season_key: string;
  rule_version: number;
  definition: unknown;
  accepted_at: Date;
  correction_id: string | null;
  correction_reason: string | null;
  xp_delta: number | null;
  points_delta: number | null;
  corrected_at: Date | null;
};
const awardFrom = `FROM impuls.ledger_entries xp
  JOIN impuls.ledger_entries p ON p.review_id=xp.review_id AND p.user_id=xp.user_id AND p.currency='points' AND p.kind='task_acceptance'
  JOIN impuls.reviews r ON r.id=xp.review_id AND r.decision='accept'
  JOIN impuls.tasks t ON t.id=xp.task_id
  JOIN impuls.users u ON u.id=xp.user_id
  JOIN impuls.access_scopes s ON s.id=t.scope_id
  JOIN impuls.rule_sets rules ON rules.id=xp.rule_set_id
  LEFT JOIN impuls.ledger_corrections c ON c.review_id=xp.review_id`;
const awardSelect = `SELECT xp.review_id,xp.user_id,xp.task_id,xp.task_title,t.scope_id,s.name AS scope_name,u.display_name,u.active,
  xp.amount AS xp,p.amount AS points,xp.season_key,xp.rule_version,rules.definition,xp.created_at AS accepted_at,
  c.id AS correction_id,c.reason AS correction_reason,c.xp_delta,c.points_delta,c.created_at AS corrected_at`;
const permission = `b.user_id=$1 AND b.action='ledger.correct' AND b.scope_id=t.scope_id
  AND b.revoked_at IS NULL AND b.valid_from<=clock_timestamp() AND (b.valid_until IS NULL OR b.valid_until>clock_timestamp())`;
function correction(row: AwardRow): Correction | null {
  return row.correction_id
    ? {
        id: row.correction_id,
        reviewId: row.review_id,
        reason: row.correction_reason!,
        xpDelta: row.xp_delta!,
        pointsDelta: row.points_delta!,
        createdAt: row.corrected_at!.toISOString(),
      }
    : null;
}

export async function reverseAcceptance(
  pool: Pool,
  input: LedgerCorrectionInput,
): Promise<LedgerCorrectionResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reject = async (result: LedgerCorrectionResult) => {
      await client.query("ROLLBACK");
      return result;
    };
    const actor = (
      await client.query<{ active: boolean }>(
        "SELECT active FROM impuls.users WHERE id=$1 FOR SHARE",
        [input.actorId],
      )
    ).rows[0];
    if (actor?.active !== true) return await reject({ kind: "revoked" });
    const row = (
      await client.query<AwardRow>(
        `${awardSelect} ${awardFrom}
      WHERE xp.review_id=$2 AND xp.currency='xp' AND xp.kind='task_acceptance'
        AND EXISTS(SELECT 1 FROM impuls.role_bindings b WHERE ${permission})`,
        [input.actorId, input.reviewId],
      )
    ).rows[0];
    if (!row) return await reject({ kind: "not_found" });
    if (row.user_id === input.actorId)
      return await reject({ kind: "self_correction" });
    const recipient = (
      await client.query<{ active: boolean }>(
        "SELECT active FROM impuls.users WHERE id=$1 FOR SHARE",
        [row.user_id],
      )
    ).rows[0];
    if (recipient?.active !== true)
      return await reject({ kind: "recipient_revoked" });
    // Match review/revocation's lock order: users, binding, session, task, projection.
    const binding = await client.query(
      `SELECT b.id FROM impuls.role_bindings b JOIN impuls.tasks t ON t.id=$2 WHERE ${permission} ORDER BY b.id FOR SHARE OF b`,
      [input.actorId, row.task_id],
    );
    if (!binding.rowCount) return await reject({ kind: "not_found" });
    const signedIn = await client.query(
      `SELECT id FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
      [input.actorId, input.sessionHash],
    );
    if (!signedIn.rowCount) return await reject({ kind: "unauthorized" });
    const taskScope = (
      await client.query<{ scope_id: string }>(
        "SELECT scope_id FROM impuls.tasks WHERE id=$1 FOR SHARE",
        [row.task_id],
      )
    ).rows[0];
    if (taskScope?.scope_id !== row.scope_id)
      return await reject({ kind: "not_found" });
    if (input.allowSyntheticCorrections !== true)
      return await reject({ kind: "disabled" });
    if (!syntheticEconomyZone(row.definition))
      return await reject({ kind: "rules_invalid" });
    const balance = (
      await client.query<BalanceRow>(
        `SELECT lifetime_xp,available_points,reserved_points,version,updated_at FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE`,
        [row.user_id],
      )
    ).rows[0];
    if (!balance) throw new Error("Missing accepted balance");
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          reviewId: input.reviewId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        }),
      )
      .digest();
    const inserted = await client.query(
      `INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash) VALUES($1,'ledger.reverse',$2,$3) ON CONFLICT(actor_id,operation,key) DO NOTHING RETURNING id`,
      [input.actorId, input.idempotencyKey, hash],
    );
    const saved = (
      await client.query<{
        request_hash: Buffer;
        response_body: CorrectionResponse | null;
      }>(
        `SELECT request_hash,response_body FROM impuls.idempotency_records WHERE actor_id=$1 AND operation='ledger.reverse' AND key=$2 FOR UPDATE`,
        [input.actorId, input.idempotencyKey],
      )
    ).rows[0]!;
    // Wall-clock expiry can occur while waiting for another credit/correction.
    if (
      !(
        await client.query(
          `SELECT 1 FROM impuls.role_bindings b JOIN impuls.tasks t ON t.id=$2 WHERE ${permission}`,
          [input.actorId, row.task_id],
        )
      ).rowCount
    )
      return await reject({ kind: "not_found" });
    if (
      !(
        await client.query(
          `SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()`,
          [input.actorId, input.sessionHash],
        )
      ).rowCount
    )
      return await reject({ kind: "unauthorized" });
    if (!saved.request_hash.equals(hash))
      return await reject({ kind: "idempotency_conflict" });
    if (!inserted.rowCount) {
      if (!saved.response_body) throw new Error("Incomplete correction intent");
      await client.query("COMMIT");
      return { kind: "ok", response: saved.response_body };
    }
    if (
      (
        await client.query(
          "SELECT 1 FROM impuls.ledger_corrections WHERE review_id=$1",
          [input.reviewId],
        )
      ).rowCount
    )
      return await reject({ kind: "already_corrected" });
    if (balance.version !== input.expectedVersion)
      return await reject({
        kind: "conflict",
        currentVersion: balance.version,
      });
    if (
      Number(balance.lifetime_xp) < row.xp ||
      Number(balance.available_points) < row.points
    )
      return await reject({ kind: "insufficient_balance" });
    const at = (
      await client.query<{ at: Date }>(
        "SELECT date_trunc('milliseconds',clock_timestamp()) AS at",
      )
    ).rows[0]!.at;
    const id = (
      await client.query<{ id: string }>(
        `INSERT INTO impuls.ledger_corrections(review_id,user_id,actor_id,reason,xp_delta,points_delta,mode,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'synthetic',$7,$7) RETURNING id`,
        [
          input.reviewId,
          row.user_id,
          input.actorId,
          input.reason,
          -row.xp,
          -row.points,
          at,
        ],
      )
    ).rows[0]!.id;
    const entries = await client.query(
      `INSERT INTO impuls.ledger_entries(user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,kind,amount,mode,season_key,time_zone,correction_id,original_entry_id,created_at,updated_at)
      SELECT user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,'acceptance_reversal',-amount,mode,season_key,time_zone,$2,id,$3,$3
      FROM impuls.ledger_entries WHERE review_id=$1 AND user_id=$4 AND kind='task_acceptance'`,
      [input.reviewId, id, at, row.user_id],
    );
    if (entries.rowCount !== 2) throw new Error("Incomplete original award");
    const next = (
      await client.query<BalanceRow>(
        `UPDATE impuls.account_balances SET lifetime_xp=lifetime_xp-$2,available_points=available_points-$3,version=version+1,updated_at=greatest(updated_at,$4)
      WHERE user_id=$1 RETURNING lifetime_xp,available_points,reserved_points,version,updated_at`,
        [row.user_id, row.xp, row.points, at],
      )
    ).rows[0]!;
    await client.query(
      `INSERT INTO impuls.audit_events(actor_id,correction_id,action,request_id,reason,diff,created_at,updated_at) VALUES($1,$2,'ledger.correct',$3,$4,$5::jsonb,$6,$6)`,
      [
        input.actorId,
        id,
        input.requestId ?? randomUUID(),
        input.reason,
        JSON.stringify({
          reviewId: input.reviewId,
          userId: row.user_id,
          taskId: row.task_id,
          xpDelta: -row.xp,
          pointsDelta: -row.points,
          seasonKey: row.season_key,
          ruleVersion: row.rule_version,
          balanceVersion: next.version,
          mode: "synthetic",
        }),
        at,
      ],
    );
    await client.query(
      `INSERT INTO impuls.notification_outbox(recipient_id,correction_id,kind,mode,created_at,updated_at) VALUES($1,$2,'ledger.corrected','synthetic',$3,$3)`,
      [row.user_id, id, at],
    );
    const response: CorrectionResponse = {
      correction: {
        id,
        reviewId: input.reviewId,
        reason: input.reason,
        xpDelta: -row.xp,
        pointsDelta: -row.points,
        createdAt: at.toISOString(),
      },
      balance: accountBalance(next),
    };
    await client.query(
      `UPDATE impuls.idempotency_records SET response_status=200,response_body=$3::jsonb WHERE actor_id=$1 AND operation='ledger.reverse' AND key=$2`,
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

export async function listCorrectableAwards(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: {
    limit?: number;
    cursor?: { at: string; id: string } | undefined;
    reviewId?: string | undefined;
    allowSyntheticCorrections?: boolean;
  } = {},
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const user = (
      await client.query<{ active: boolean }>(
        "SELECT active FROM impuls.users WHERE id=$1",
        [actorId],
      )
    ).rows[0];
    if (!user?.active) {
      await client.query("ROLLBACK");
      return { kind: "revoked" } as const;
    }
    if (
      !(
        await client.query(
          "SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
          [actorId, sessionHash],
        )
      ).rowCount
    ) {
      await client.query("ROLLBACK");
      return { kind: "unauthorized" } as const;
    }
    if (
      !(
        await client.query(
          `SELECT 1 FROM impuls.role_bindings b WHERE b.user_id=$1 AND b.action='ledger.correct' AND b.revoked_at IS NULL AND b.valid_from<=clock_timestamp() AND (b.valid_until IS NULL OR b.valid_until>clock_timestamp())`,
          [actorId],
        )
      ).rowCount
    ) {
      await client.query("ROLLBACK");
      return { kind: "forbidden" } as const;
    }
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const result = await client.query<AwardRow & BalanceRow>(
      `${awardSelect},a.lifetime_xp,a.available_points,a.reserved_points,a.version,a.updated_at ${awardFrom}
      JOIN impuls.account_balances a ON a.user_id=xp.user_id
      WHERE xp.currency='xp' AND xp.kind='task_acceptance' AND EXISTS(SELECT 1 FROM impuls.role_bindings b WHERE ${permission})
        AND ($2::uuid IS NULL OR xp.review_id=$2) AND ($3::timestamptz IS NULL OR (xp.created_at,xp.review_id)<($3::timestamptz,$4::uuid))
      ORDER BY xp.created_at DESC,xp.review_id DESC LIMIT $5`,
      [
        actorId,
        options.reviewId ?? null,
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
        items: rows.map((r) => ({
          reviewId: r.review_id,
          task: { id: r.task_id, title: r.task_title },
          recipient: { id: r.user_id, displayName: r.display_name },
          scope: { id: r.scope_id, name: r.scope_name },
          xp: r.xp,
          points: r.points,
          seasonKey: r.season_key,
          ruleVersion: r.rule_version,
          acceptedAt: r.accepted_at.toISOString(),
          balance: accountBalance(r),
          enabled:
            options.allowSyntheticCorrections === true &&
            !!syntheticEconomyZone(r.definition) &&
            r.active &&
            r.user_id !== actorId &&
            !r.correction_id,
          correction: correction(r),
        })),
        nextCursor:
          result.rows.length > limit
            ? `${rows.at(-1)!.accepted_at.toISOString()}|${rows.at(-1)!.review_id}`
            : null,
        asOf: at.toISOString(),
      },
    } as const;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
