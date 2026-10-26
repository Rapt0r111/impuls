import type { Pool } from "pg";

type Cursor = {
  actor: string;
  scope: string;
  purpose: "admin-catalog-history";
  rewardId: string;
  versionId: string;
};
type Scope = { id: string; name: string };
type Version = {
  id: string;
  version: number;
  title: string;
  conditions: string;
  price: number;
  enabled: boolean;
  effectiveFrom: string;
  reservationSeconds: number | null;
  state: "current" | "scheduled" | "superseded" | "cancelled";
};

// One snapshot for authority, anchor and terms. Cursor comparisons use the
// database timestamp, never the rounded JavaScript Date representation.
export async function readAdminCatalogHistory(
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
        items: Version[];
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
    items: Version[];
  }>(
    `
    WITH access AS MATERIALIZED (
      SELECT (SELECT active FROM impuls.users WHERE id=$1) active,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()) session_valid,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NOT NULL) session_revoked,
        clock_timestamp() as_of
    ), selected AS MATERIALIZED (
      SELECT s.id,s.name FROM access,impuls.access_scopes s
      WHERE access.active AND access.session_valid AND $3::boolean AND s.id=$4
        AND EXISTS(SELECT 1 FROM impuls.role_bindings b WHERE b.user_id=$1 AND b.scope_id=s.id AND b.action='admin.catalog'
          AND b.revoked_at IS NULL AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of))
    ), versions AS MATERIALIZED (
      SELECT r.* FROM impuls.reward_versions r JOIN selected s ON s.id=r.scope_id
      WHERE r.reward_id=$5 AND r.kind='cosmetic'
    ), anchor AS MATERIALIZED (
      SELECT * FROM versions WHERE id=$6
    ), current AS MATERIALIZED (
      SELECT r.id FROM versions r CROSS JOIN access WHERE r.effective_from<=access.as_of AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id)
      ORDER BY r.effective_from DESC,r.version DESC,r.id DESC LIMIT 1
    ), page AS MATERIALIZED (
      SELECT r.* FROM versions r WHERE $6::uuid IS NULL OR
        (r.effective_from,r.version,r.id)<(SELECT effective_from,version,id FROM anchor)
      ORDER BY r.effective_from DESC,r.version DESC,r.id DESC LIMIT $7
    ) SELECT access.*,
      (SELECT jsonb_build_object('id',id,'name',name) FROM selected) scope,
      EXISTS(SELECT 1 FROM versions) reward_exists,
      ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM anchor)) anchor_valid,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',r.id,'version',r.version,'title',r.title,'conditions',r.conditions,'price',r.price,'enabled',r.enabled,
        'effectiveFrom',to_char(r.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'reservationSeconds',r.reservation_seconds,
        'state',CASE WHEN EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id) THEN 'cancelled' WHEN r.effective_from>access.as_of THEN 'scheduled' WHEN r.id=(SELECT id FROM current) THEN 'current' ELSE 'superseded' END
      ) ORDER BY r.effective_from DESC,r.version DESC,r.id DESC) FROM page r),'[]'::jsonb) items
    FROM access`,
    [
      actorId,
      sessionHash,
      options.enabled === true,
      options.scope,
      rewardId,
      cursor?.versionId ?? null,
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
      cursor.purpose !== "admin-catalog-history" ||
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
          ? `${actorId}|${row.scope.id}|admin-catalog-history|${rewardId}|${items.at(-1)!.id}`
          : null,
      updatedAt: row.as_of.toISOString(),
    },
  };
}
