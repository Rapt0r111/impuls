import type { Pool } from "pg";

type Cursor = {
  actor: string;
  scope: string;
  purpose: "admin-catalog-quotas";
  rewardId: string;
  periodId: string;
};
type Scope = { id: string; name: string };
type Period = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reserved: number;
  used: number;
  available: number;
  version: number;
  state: "past" | "current" | "scheduled";
};

// Counter history is live: immutable period identity anchors paging, while
// authority and all displayed counters are read in the same statement snapshot.
export async function readAdminCatalogQuotas(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  rewardId: string,
  options: {
    enabled?: boolean;
    scope: string;
    cursor?: Cursor | undefined;
    limit?: number;
  },
): Promise<
  | {
      kind: "ok";
      response: {
        scope: Scope;
        rewardId: string;
        items: Period[];
        nextCursor: string | null;
        updatedAt: string;
      };
    }
  | { kind: "revoked" }
  | { kind: "unauthorized" }
  | { kind: "disabled" }
  | { kind: "not_found" }
  | { kind: "invalid_cursor" }
> {
  const cursor = options.cursor;
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const result = await pool.query<{
    active: boolean | null;
    session_valid: boolean;
    session_revoked: boolean;
    as_of: Date;
    scope: Scope | null;
    reward_exists: boolean;
    anchor_valid: boolean;
    items: Period[];
  }>(
    `WITH access AS MATERIALIZED (
      SELECT (SELECT active FROM impuls.users WHERE id=$1) active,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()) session_valid,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NOT NULL) session_revoked,
        clock_timestamp() as_of
    ), selected AS MATERIALIZED (
      SELECT s.id,s.name FROM access,impuls.access_scopes s
      WHERE access.active AND access.session_valid AND $3::boolean AND s.id=$4
        AND EXISTS(SELECT 1 FROM impuls.role_bindings b WHERE b.user_id=$1 AND b.scope_id=s.id AND b.action='admin.catalog'
          AND b.revoked_at IS NULL AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of))
    ), identity AS MATERIALIZED (
      SELECT DISTINCT r.reward_id,r.scope_id FROM impuls.reward_versions r JOIN selected s ON s.id=r.scope_id
      WHERE r.reward_id=$5 AND r.kind='cosmetic'
    ), periods AS MATERIALIZED (
      SELECT q.* FROM impuls.quota_periods q JOIN identity r ON r.reward_id=q.reward_id AND r.scope_id=q.scope_id
    ), anchor AS MATERIALIZED (
      SELECT * FROM periods WHERE id=$6
    ), page AS MATERIALIZED (
      SELECT q.* FROM periods q WHERE $6::uuid IS NULL OR
        (q.starts_at,q.id)<(SELECT starts_at,id FROM anchor)
      ORDER BY q.starts_at DESC,q.id DESC LIMIT $7
    ) SELECT access.*,
      (SELECT jsonb_build_object('id',id,'name',name) FROM selected) scope,
      EXISTS(SELECT 1 FROM identity) reward_exists,
      ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM anchor)) anchor_valid,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',q.id,
        'startsAt',to_char(q.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endsAt',to_char(q.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'capacity',q.capacity,'reserved',q.reserved,'used',q.used,'available',q.capacity-q.reserved-q.used,'version',q.version,
        'state',CASE WHEN q.starts_at>access.as_of THEN 'scheduled' WHEN q.ends_at<=access.as_of THEN 'past' ELSE 'current' END
      ) ORDER BY q.starts_at DESC,q.id DESC) FROM page q),'[]'::jsonb) items FROM access`,
    [
      actorId,
      sessionHash,
      options.enabled === true,
      options.scope,
      rewardId,
      cursor?.periodId ?? null,
      limit + 1,
    ],
  );
  const row = result.rows[0]!;
  if (!row.active || row.session_revoked) return { kind: "revoked" };
  if (!row.session_valid) return { kind: "unauthorized" };
  if (options.enabled !== true) return { kind: "disabled" };
  if (!row.scope || !row.reward_exists) return { kind: "not_found" };
  if (
    cursor &&
    (cursor.actor !== actorId ||
      cursor.scope !== row.scope.id ||
      cursor.rewardId !== rewardId ||
      cursor.purpose !== "admin-catalog-quotas" ||
      !row.anchor_valid)
  )
    return { kind: "invalid_cursor" };
  const items = row.items.slice(0, limit);
  return {
    kind: "ok",
    response: {
      scope: row.scope,
      rewardId,
      items,
      nextCursor:
        row.items.length > limit
          ? `${actorId}|${row.scope.id}|admin-catalog-quotas|${rewardId}|${items.at(-1)!.id}`
          : null,
      updatedAt: row.as_of.toISOString(),
    },
  };
}
