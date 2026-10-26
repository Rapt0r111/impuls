import type { Pool } from "pg";
import { accountBalance, type BalanceRow } from "../ledger/credit";
import {
  levelProgress,
  levelTitle,
  syntheticLevelNames,
  syntheticLevelThresholds,
} from "./progression";

export async function readParticipantProfile(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: { allowSyntheticProfile?: boolean } = {},
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const user = (
      await client.query<{ active: boolean; display_name: string }>(
        "SELECT active,display_name FROM impuls.users WHERE id=$1",
        [actorId],
      )
    ).rows[0];
    if (!user?.active) {
      await client.query("ROLLBACK");
      return { kind: "revoked" as const };
    }
    const authorized = async () =>
      Boolean(
        (
          await client.query(
            "SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at > clock_timestamp()",
            [actorId, sessionHash],
          )
        ).rowCount,
      );
    if (!(await authorized())) {
      await client.query("ROLLBACK");
      return { kind: "unauthorized" as const };
    }
    if (!options.allowSyntheticProfile) {
      await client.query("ROLLBACK");
      return { kind: "disabled" as const };
    }
    const balance = accountBalance(
      (
        await client.query<BalanceRow>(
          "SELECT lifetime_xp,available_points,reserved_points,version,updated_at FROM impuls.account_balances WHERE user_id=$1",
          [actorId],
        )
      ).rows[0],
    );
    // Select the latest effective *profile* configuration; invalid newer rules
    // must never silently reactivate an older set of thresholds.
    const rule = (
      await client.query<{
        id: string;
        version_number: number;
        definition: unknown;
      }>(
        "SELECT id,version_number,definition FROM impuls.rule_sets WHERE definition ? 'progression' AND effective_from <= statement_timestamp() ORDER BY effective_from DESC,version_number DESC,id DESC LIMIT 1",
      )
    ).rows[0];
    const thresholds = rule ? syntheticLevelThresholds(rule.definition) : null;
    const progression = (
      rule?.definition as { progression?: unknown } | undefined
    )?.progression;
    const explicitlyUnset =
      typeof progression === "object" &&
      progression !== null &&
      !Array.isArray(progression) &&
      Object.keys(progression).length === 0;
    const first = (
      await client.query<{
        source_entry_id: string;
        granted_at: Date;
        provenance: "acceptance" | "migration";
        task_id: string;
        task_title: string;
        review_id: string;
        corrected: boolean;
      }>(
        `SELECT a.source_entry_id,a.granted_at,a.provenance,l.task_id,l.task_title,l.review_id,
      EXISTS(SELECT 1 FROM impuls.ledger_corrections c WHERE c.review_id=l.review_id) AS corrected
      FROM impuls.user_achievements a JOIN impuls.ledger_entries l ON l.id=a.source_entry_id WHERE a.user_id=$1 AND a.code='first_result'`,
        [actorId],
      )
    ).rows[0];
    const at = (
      await client.query<{ at: Date }>("SELECT clock_timestamp() AS at")
    ).rows[0]!.at;
    if (!(await authorized())) {
      await client.query("ROLLBACK");
      return { kind: "unauthorized" as const };
    }
    await client.query("COMMIT");
    return {
      kind: "ok" as const,
      response: {
        user: { id: actorId, displayName: user.display_name },
        balance,
        progression: {
          // An explicitly empty progression (published from the rules screen, ADR-0035)
          // means "levels are not configured", not a broken configuration.
          state:
            !rule || explicitlyUnset
              ? ("unconfigured" as const)
              : thresholds
                ? ("configured" as const)
                : ("invalid" as const),
          ruleVersion: explicitlyUnset ? null : (rule?.version_number ?? null),
          level:
            thresholds && rule
              ? (() => {
                  const level = levelProgress(balance.lifetimeXp, thresholds);
                  return {
                    ...level,
                    title: levelTitle(
                      syntheticLevelNames(rule.definition),
                      level.level,
                    ),
                  };
                })()
              : null,
        },
        firstResult: first
          ? {
              code: "first_result" as const,
              conditionVersion: 1 as const,
              sourceEntryId: first.source_entry_id,
              reviewId: first.review_id,
              task: { id: first.task_id, title: first.task_title },
              grantedAt: first.granted_at.toISOString(),
              provenance: first.provenance,
              sourceCorrected: first.corrected,
            }
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
