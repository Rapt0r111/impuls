import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { acceptanceSeason } from "../ledger/economy";

const timeZone = "Europe/Moscow" as const;
type Scope = { id: string; name: string };
type RankedRow = { id: string; display_name: string; xp: string; rank: string };
type Cursor = { scope: string; season: string; revision: string; id: string };
type Options = {
  scope?: string | undefined;
  season?: string | undefined;
  cursor?: Cursor | undefined;
  limit?: number;
  allowSyntheticRanking: boolean;
};

// This is a synthetic roster preview, not the real-name policy awaiting P-05.
export async function readLeaderboard(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: Options,
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
    const session = await client.query(
      "SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
      [actorId, sessionHash],
    );
    if (!session.rowCount) {
      await client.query("ROLLBACK");
      return { kind: "unauthorized" } as const;
    }
    if (!options.allowSyntheticRanking) {
      await client.query("ROLLBACK");
      return { kind: "disabled" } as const;
    }
    const now = (
      await client.query<{ at: Date }>("SELECT transaction_timestamp() AS at")
    ).rows[0]!.at;
    const season = options.season ?? acceptanceSeason(now, timeZone);
    const scopes = (
      await client.query<Scope>(
        `SELECT s.id,s.name FROM impuls.task_scope_members m
      JOIN impuls.access_scopes s ON s.id=m.scope_id
      WHERE m.user_id=$1 AND m.revoked_at IS NULL
      AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now()) ORDER BY s.name,s.id`,
        [actorId],
      )
    ).rows;
    const scope = options.scope
      ? scopes.find((s) => s.id === options.scope)
      : scopes[0];
    if (
      (options.scope && !scope) ||
      (options.cursor &&
        (!scope ||
          options.cursor.scope !== scope.id ||
          options.cursor.season !== season))
    ) {
      await client.query("ROLLBACK");
      return { kind: "not_found" } as const;
    }
    if (!scope) {
      await client.query("COMMIT");
      return {
        kind: "ok",
        response: {
          timeZone,
          season,
          scopes,
          scope: null,
          self: null,
          items: [],
          nextCursor: null,
          revision: null,
          updatedAt: now.toISOString(),
        },
      } as const;
    }
    // Rank only visible positive totals. UUID breaks display ties, not rank ties.
    // Full scope aggregation is also the revision source for cursor consistency.
    const rows = (
      await client.query<RankedRow>(
        `WITH totals AS (
      SELECT u.id,u.display_name,coalesce(sum(l.amount),0) AS xp
      FROM impuls.task_scope_members m JOIN impuls.users u ON u.id=m.user_id AND u.active=true
      LEFT JOIN (impuls.ledger_entries l JOIN impuls.tasks t ON t.id=l.task_id AND t.scope_id=$1)
        ON l.user_id=u.id AND l.currency='xp' AND l.season_key=$2 AND l.time_zone=$3
      WHERE m.scope_id=$1 AND m.revoked_at IS NULL AND m.valid_from<=now()
        AND (m.valid_until IS NULL OR m.valid_until>now())
      GROUP BY u.id,u.display_name
    ) SELECT id,display_name,xp,rank() OVER(ORDER BY xp DESC) AS rank FROM totals WHERE xp>0 ORDER BY xp DESC,id`,
        [scope.id, season, timeZone],
      )
    ).rows;
    const items = rows.map((r) => {
      const xp = Number(r.xp),
        rank = Number(r.rank);
      if (!Number.isSafeInteger(xp) || !Number.isSafeInteger(rank))
        throw new Error("Ranking numeric range");
      return {
        id: r.id,
        displayName: r.display_name,
        xp,
        rank,
        isSelf: r.id === actorId,
      };
    });
    const revision = createHash("sha256")
      .update(JSON.stringify({ scope, season, items }))
      .digest("hex");
    if (options.cursor && options.cursor.revision !== revision) {
      await client.query("ROLLBACK");
      return { kind: "changed" } as const;
    }
    const position = options.cursor
      ? items.findIndex((r) => r.id === options.cursor!.id)
      : -1;
    if (options.cursor && position === -1) {
      await client.query("ROLLBACK");
      return { kind: "changed" } as const;
    }
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const page = items.slice(position + 1, position + 1 + limit);
    const own = items.find((r) => r.isSelf);
    await client.query("COMMIT");
    return {
      kind: "ok",
      response: {
        timeZone,
        season,
        scopes,
        scope,
        self: { xp: own?.xp ?? 0, rank: own?.rank ?? null },
        items: page,
        revision,
        nextCursor:
          position + 1 + limit < items.length
            ? `${scope.id}|${season}|${revision}|${page.at(-1)!.id}`
            : null,
        updatedAt: now.toISOString(),
      },
    } as const;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
