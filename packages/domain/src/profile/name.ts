import type { Pool } from "pg";

export type RenameResult =
  | { kind: "ok"; changed: boolean; displayName: string }
  | { kind: "unauthorized" | "revoked" | "disabled" | "taken" };

// The caller passes an already validated name (profileNameSchema). The session is re-checked
// in the same transaction that writes, so a revoked user can never rename.
export async function renameSelf(
  pool: Pool,
  input: {
    actorId: string;
    sessionHash: Buffer;
    displayName: string;
    requestId: string;
    allowSyntheticProfile: boolean;
  },
): Promise<RenameResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const active = (
      await client.query<{ active: boolean }>(
        "SELECT active FROM impuls.users WHERE id=$1",
        [input.actorId],
      )
    ).rows[0]?.active;
    if (!active) {
      await client.query("ROLLBACK");
      return { kind: "revoked" };
    }
    const live = await client.query(
      "SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at > clock_timestamp()",
      [input.actorId, input.sessionHash],
    );
    if (!live.rowCount) {
      await client.query("ROLLBACK");
      return { kind: "unauthorized" };
    }
    if (!input.allowSyntheticProfile) {
      await client.query("ROLLBACK");
      return { kind: "disabled" };
    }
    const outcome = (
      await client.query<{
        outcome: "ok" | "unchanged" | "taken" | "inactive";
      }>("SELECT impuls.rename_self($1,$2,$3) AS outcome", [
        input.actorId,
        input.displayName,
        input.requestId,
      ])
    ).rows[0]!.outcome;
    if (outcome === "taken" || outcome === "inactive") {
      await client.query("ROLLBACK");
      return { kind: outcome === "taken" ? "taken" : "revoked" };
    }
    await client.query("COMMIT");
    return {
      kind: "ok",
      changed: outcome === "ok",
      displayName: input.displayName,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
