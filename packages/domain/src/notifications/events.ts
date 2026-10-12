import type { Pool } from "pg";

type Event = {
  kind: string;
  createdAt: string;
  status: string;
  errorCode: string | null;
};
type Scope = { id: string; name: string };
type Cursor = {
  actor: string;
  scope: string;
  purpose: "notification-events";
  eventId: string;
};
type Row = {
  active: boolean | null;
  session_valid: boolean;
  session_revoked: boolean;
  scope: Scope | null;
  anchor_valid: boolean;
  as_of: Date;
  items: (Event & { anchorId: string })[];
};

// Authority, source scope, anchor and page share one statement snapshot. Native
// PostgreSQL timestamps, not rounded wire dates, define the page boundary.
export async function readNotificationEvents(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: {
    enabled?: boolean;
    scope: string;
    limit?: number;
    cursor?: Cursor | undefined;
  },
) {
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    return { kind: "invalid" as const };
  const cursorMatches =
    !options.cursor ||
    (options.cursor.actor === actorId &&
      options.cursor.scope === options.scope &&
      options.cursor.purpose === "notification-events");
  const result = await pool.query<Row>(
    `WITH access AS MATERIALIZED (
      SELECT (SELECT active FROM impuls.users WHERE id=$1) AS active,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
          AND revoked_at IS NULL AND expires_at>clock_timestamp()) AS session_valid,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NOT NULL) AS session_revoked,
        clock_timestamp() AS as_of
    ), selected AS MATERIALIZED (
      SELECT DISTINCT s.id,s.name FROM access,impuls.role_bindings b JOIN impuls.access_scopes s ON s.id=b.scope_id
      WHERE access.active AND access.session_valid AND $3::boolean AND b.user_id=$1 AND b.action='admin.notifications'
        AND b.revoked_at IS NULL AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of)
        AND s.id=$4::uuid
    ), events AS MATERIALIZED (
      SELECT o.id,o.created_at,
        CASE WHEN o.kind IN ('task.assigned','task.due_soon','task.claimed','task.returned','task.accepted','ledger.corrected',
          'reward.reserved','reward.cancelled','reward.approved','reward.rejected','reward.fulfilled','reward.expired')
          THEN o.kind ELSE 'unsupported' END AS kind,
        coalesce(d.status,'unclaimed') AS status,d.error_code
      FROM impuls.notification_outbox o
      LEFT JOIN impuls.ledger_corrections c ON c.id=o.correction_id
      LEFT JOIN impuls.reviews r ON r.id=coalesce(o.review_id,c.review_id)
      LEFT JOIN impuls.submissions sub ON sub.id=r.submission_id
      LEFT JOIN impuls.tasks t ON t.id=coalesce(o.task_id,sub.task_id)
      LEFT JOIN impuls.redemptions redemption ON redemption.id=o.redemption_id AND redemption.mode='synthetic'
      JOIN selected ON selected.id=coalesce(t.scope_id,redemption.scope_id)
      LEFT JOIN impuls.notification_simulations d ON d.outbox_id=o.id
      WHERE o.mode='synthetic' AND o.status='pending'
    ), anchor AS MATERIALIZED (
      SELECT id,created_at FROM events WHERE id=$5::uuid AND $6::boolean
    ), page AS MATERIALIZED (
      SELECT * FROM events WHERE $6::boolean AND ($5::uuid IS NULL OR
        (created_at,id)<(SELECT created_at,id FROM anchor))
      ORDER BY created_at DESC,id DESC LIMIT $7
    )
    SELECT access.*,
      (SELECT jsonb_build_object('id',id,'name',name) FROM selected) AS scope,
      ($6::boolean AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM anchor))) AS anchor_valid,
      coalesce((SELECT jsonb_agg(jsonb_build_object('anchorId',id,'kind',kind,
        'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'status',status,'errorCode',error_code) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS items
    FROM access`,
    [
      actorId,
      sessionHash,
      options.enabled === true,
      options.scope,
      options.cursor?.eventId ?? null,
      cursorMatches,
      limit + 1,
    ],
  );
  const gate = result.rows[0]!;
  if (!gate.active || gate.session_revoked) return { kind: "revoked" as const };
  if (!gate.session_valid) return { kind: "unauthorized" as const };
  if (options.enabled !== true) return { kind: "disabled" as const };
  if (!gate.scope) return { kind: "not_found" as const };
  if (!gate.anchor_valid) return { kind: "invalid" as const };
  const page = gate.items.slice(0, limit);
  return {
    kind: "ok" as const,
    response: {
      mode: "simulation" as const,
      scope: gate.scope,
      updatedAt: gate.as_of.toISOString(),
      items: page.map((event) => ({
        kind: event.kind,
        createdAt: event.createdAt,
        status: event.status,
        errorCode: event.errorCode,
      })),
      nextCursor:
        gate.items.length > limit
          ? `${actorId}|${gate.scope.id}|notification-events|${page.at(-1)!.anchorId}`
          : null,
    },
  };
}
