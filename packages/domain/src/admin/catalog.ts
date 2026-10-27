import type { Pool } from "pg";

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
};
type Item = {
  rewardId: string;
  current: Version | null;
  scheduled: Version | null;
  quota: {
    id: string;
    startsAt: string;
    endsAt: string;
    capacity: number | null;
    reserved: number;
    used: number;
    available: number | null;
  } | null;
};
type Cursor = {
  actor: string;
  scope: string;
  purpose: "admin-catalog";
  rewardId: string;
};
const timestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const terms = (alias: string) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE jsonb_build_object('id',${alias}.id,'version',${alias}.version,'title',${alias}.title,'conditions',${alias}.conditions,'price',${alias}.price,'enabled',${alias}.enabled,'effectiveFrom',${timestamp(`${alias}.effective_from`)},'reservationSeconds',${alias}.reservation_seconds) END`;

// Read-only inspection. Authority and configuration share one statement snapshot.
export async function readAdminCatalog(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: {
    enabled?: boolean;
    allowCreation?: boolean;
    allowPublication?: boolean;
    allowScheduling?: boolean;
    allowCancellation?: boolean;
    allowQuotaPublication?: boolean;
    scope?: string | undefined;
    cursor?: Cursor | undefined;
    limit?: number;
  } = {},
): Promise<
  | {
      kind: "ok";
      response: {
        scope: Scope;
        scopes: Scope[];
        items: Item[];
        nextCursor: string | null;
        updatedAt: string;
        canCreate: boolean;
        canPublish: boolean;
        canSchedule: boolean;
        canCancelSchedule: boolean;
        canPublishQuota: boolean;
      };
    }
  | { kind: "revoked" }
  | { kind: "unauthorized" }
  | { kind: "disabled" }
  | { kind: "not_found" }
  | { kind: "invalid_cursor" }
> {
  const cursor = options.cursor;
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const result = await pool.query<{
    active: boolean | null;
    session_valid: boolean;
    session_revoked: boolean;
    as_of: Date;
    scopes: Scope[];
    scope: Scope | null;
    anchor_valid: boolean;
    items: Item[];
    can_create: boolean;
    can_publish: boolean;
    can_schedule: boolean;
    can_cancel_schedule: boolean;
    can_publish_quota: boolean;
  }>(
    `
    WITH access AS MATERIALIZED (
      SELECT (SELECT active FROM impuls.users WHERE id=$1) active,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()) session_valid,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NOT NULL) session_revoked,
        clock_timestamp() as_of
    ), permitted AS MATERIALIZED (
      SELECT DISTINCT s.id,s.name FROM access,impuls.role_bindings b JOIN impuls.access_scopes s ON s.id=b.scope_id
      WHERE access.active AND access.session_valid AND $3::boolean AND b.user_id=$1 AND b.action='admin.catalog'
        AND b.revoked_at IS NULL AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of)
    ), selected AS MATERIALIZED (
      SELECT * FROM permitted WHERE $4::uuid IS NULL OR id=$4 ORDER BY name,id LIMIT 1
    ), identities AS MATERIALIZED (
      SELECT DISTINCT reward_id FROM impuls.reward_versions r JOIN selected s ON s.id=r.scope_id
      WHERE r.kind='cosmetic'
    ), page AS MATERIALIZED (
      SELECT reward_id FROM identities WHERE $5::uuid IS NULL OR reward_id>$5 ORDER BY reward_id LIMIT $6
    ), rows AS (
      SELECT p.reward_id,jsonb_build_object('rewardId',p.reward_id,'current',${terms("current")},'scheduled',${terms("scheduled")},
        'quota',CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id',q.id,'startsAt',${timestamp("q.starts_at")},'endsAt',${timestamp("q.ends_at")},'capacity',q.capacity,'reserved',q.reserved,'used',q.used,'available',q.capacity-q.reserved-q.used) END) item
      FROM page p CROSS JOIN selected s CROSS JOIN access
      LEFT JOIN LATERAL (SELECT r.* FROM impuls.reward_versions r WHERE r.reward_id=p.reward_id AND r.scope_id=s.id AND r.effective_from<=access.as_of AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id) ORDER BY effective_from DESC,version DESC,id DESC LIMIT 1) current ON true
      LEFT JOIN LATERAL (SELECT r.* FROM impuls.reward_versions r WHERE r.reward_id=p.reward_id AND r.scope_id=s.id AND r.effective_from>access.as_of AND NOT EXISTS(SELECT 1 FROM impuls.catalog_cancellations c WHERE c.version_id=r.id) ORDER BY effective_from,version DESC,id DESC LIMIT 1) scheduled ON true
      LEFT JOIN impuls.quota_periods q ON q.reward_id=p.reward_id AND q.scope_id=s.id AND q.starts_at<=access.as_of AND q.ends_at>access.as_of
    ) SELECT access.*,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM permitted),'[]'::jsonb) scopes,
      (SELECT jsonb_build_object('id',id,'name',name) FROM selected) scope,
      ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM identities WHERE reward_id=$5)) anchor_valid,
      ($7::boolean AND EXISTS(SELECT 1 FROM impuls.role_bindings b JOIN selected s ON s.id=b.scope_id
        WHERE b.user_id=$1 AND b.action='admin.catalog.publish' AND b.revoked_at IS NULL
          AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of))) can_publish,
      ($8::boolean AND EXISTS(SELECT 1 FROM impuls.role_bindings b JOIN selected s ON s.id=b.scope_id
        WHERE b.user_id=$1 AND b.action='admin.catalog.quota.publish' AND b.revoked_at IS NULL
          AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of))) can_publish_quota,
      ($9::boolean AND EXISTS(SELECT 1 FROM impuls.role_bindings b JOIN selected s ON s.id=b.scope_id
        WHERE b.user_id=$1 AND b.action='admin.catalog.create' AND b.revoked_at IS NULL
          AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of))) can_create,
      ($10::boolean AND EXISTS(SELECT 1 FROM impuls.role_bindings b JOIN selected s ON s.id=b.scope_id
        WHERE b.user_id=$1 AND b.action='admin.catalog.schedule' AND b.revoked_at IS NULL
          AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of))) can_schedule,
      ($11::boolean AND EXISTS(SELECT 1 FROM impuls.role_bindings b JOIN selected s ON s.id=b.scope_id
        WHERE b.user_id=$1 AND b.action='admin.catalog.schedule.cancel' AND b.revoked_at IS NULL
          AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of))) can_cancel_schedule,
      coalesce((SELECT jsonb_agg(item ORDER BY reward_id) FROM rows),'[]'::jsonb) items FROM access`,
    [
      actorId,
      sessionHash,
      options.enabled === true,
      options.scope ?? cursor?.scope ?? null,
      cursor?.rewardId ?? null,
      limit + 1,
      options.allowPublication === true,
      options.allowQuotaPublication === true,
      options.allowCreation === true,
      options.allowScheduling === true,
      options.allowCancellation === true,
    ],
  );
  const row = result.rows[0]!;
  if (!row.active || row.session_revoked) return { kind: "revoked" };
  if (!row.session_valid) return { kind: "unauthorized" };
  if (options.enabled !== true) return { kind: "disabled" };
  if (!row.scope) return { kind: "not_found" };
  if (
    cursor &&
    (cursor.actor !== actorId ||
      cursor.scope !== row.scope.id ||
      cursor.purpose !== "admin-catalog" ||
      !row.anchor_valid)
  )
    return { kind: "invalid_cursor" };
  const items = row.items.slice(0, limit);
  return {
    kind: "ok",
    response: {
      scope: row.scope,
      scopes: row.scopes,
      items,
      nextCursor:
        row.items.length > limit
          ? `${actorId}|${row.scope.id}|admin-catalog|${items.at(-1)!.rewardId}`
          : null,
      updatedAt: row.as_of.toISOString(),
      canCreate: row.can_create,
      canPublish: row.can_publish,
      canSchedule: row.can_schedule,
      canCancelSchedule: row.can_cancel_schedule,
      canPublishQuota: row.can_publish_quota,
    },
  };
}
