import type { Pool } from "pg";

type Scope = { id: string; name: string };
type Status =
  | "unclaimed"
  | "ready"
  | "processing"
  | "retry"
  | "simulated"
  | "delivered"
  | "failed"
  | "suppressed";
type ErrorCode =
  | "transport_unavailable"
  | "timeout"
  | "attempts_exhausted"
  | "recipient_inactive"
  | "unsupported_kind"
  | "rate_limited"
  | "recipient_unreachable";
type Summary = {
  mode: "simulation";
  scope: Scope;
  scopes: Scope[];
  updatedAt: string;
  counts: Record<Status, number>;
  errors: Record<ErrorCode, number>;
  recentEvents: {
    kind: string;
    createdAt: string;
    status: Status;
    errorCode: ErrorCode | null;
  }[];
};
type Row = {
  active: boolean | null;
  session_valid: boolean;
  session_revoked: boolean;
  scopes: Scope[];
  scope: Scope | null;
  as_of: Date;
  counts: Partial<Record<Status, string>>;
  errors: Partial<Record<ErrorCode, string>>;
  recent_events: Summary["recentEvents"];
};

// One statement snapshot includes authority and aggregates. Scope follows the saved
// source object, never current membership of a recipient or a client-provided ID.
export async function readNotificationStatus(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: { enabled?: boolean; scope?: string | undefined } = {},
): Promise<
  | { kind: "ok"; response: Summary }
  | { kind: "unauthorized" }
  | { kind: "revoked" }
  | { kind: "disabled" }
  | { kind: "not_found" }
> {
  const result = await pool.query<Row>(
    `WITH access AS MATERIALIZED (
      SELECT (SELECT active FROM impuls.users WHERE id=$1) AS active,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
          AND revoked_at IS NULL AND expires_at>clock_timestamp()) AS session_valid,
        EXISTS(SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NOT NULL) AS session_revoked,
        clock_timestamp() AS as_of
    ), permitted AS MATERIALIZED (
      SELECT DISTINCT s.id,s.name FROM access,impuls.role_bindings b JOIN impuls.access_scopes s ON s.id=b.scope_id
      WHERE access.active AND access.session_valid AND $3::boolean AND b.user_id=$1 AND b.action='admin.notifications'
        AND b.revoked_at IS NULL AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of)
    ), selected AS MATERIALIZED (
      SELECT * FROM permitted WHERE $4::uuid IS NULL OR id=$4 ORDER BY name,id LIMIT 1
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
    )
    SELECT access.*,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM permitted),'[]'::jsonb) AS scopes,
      (SELECT jsonb_build_object('id',id,'name',name) FROM selected) AS scope,
      coalesce((SELECT jsonb_agg(jsonb_build_object('kind',kind,
        'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'status',status,'errorCode',error_code) ORDER BY created_at DESC,id DESC)
        FROM (SELECT * FROM events ORDER BY created_at DESC,id DESC LIMIT 20) recent),'[]'::jsonb) AS recent_events,
      coalesce((SELECT jsonb_object_agg(status,n::text) FROM (SELECT status,count(*) n FROM events GROUP BY status) counts),'{}'::jsonb) AS counts,
      coalesce((SELECT jsonb_object_agg(error_code,n::text) FROM (SELECT error_code,count(*) n FROM events WHERE error_code IS NOT NULL GROUP BY error_code) errors),'{}'::jsonb) AS errors
    FROM access`,
    [actorId, sessionHash, options.enabled === true, options.scope ?? null],
  );
  const gate = result.rows[0]!;
  if (!gate.active || gate.session_revoked) return { kind: "revoked" };
  if (!gate.session_valid) return { kind: "unauthorized" };
  if (options.enabled !== true) return { kind: "disabled" };
  if (!gate.scope) return { kind: "not_found" };
  return {
    kind: "ok",
    response: {
      mode: "simulation",
      scope: gate.scope,
      scopes: gate.scopes,
      updatedAt: gate.as_of.toISOString(),
      recentEvents: gate.recent_events,
      counts: {
        unclaimed: Number(gate.counts.unclaimed ?? 0),
        ready: Number(gate.counts.ready ?? 0),
        processing: Number(gate.counts.processing ?? 0),
        retry: Number(gate.counts.retry ?? 0),
        simulated: Number(gate.counts.simulated ?? 0),
        delivered: Number(gate.counts.delivered ?? 0),
        failed: Number(gate.counts.failed ?? 0),
        suppressed: Number(gate.counts.suppressed ?? 0),
      },
      errors: {
        transport_unavailable: Number(gate.errors.transport_unavailable ?? 0),
        timeout: Number(gate.errors.timeout ?? 0),
        attempts_exhausted: Number(gate.errors.attempts_exhausted ?? 0),
        recipient_inactive: Number(gate.errors.recipient_inactive ?? 0),
        unsupported_kind: Number(gate.errors.unsupported_kind ?? 0),
        rate_limited: Number(gate.errors.rate_limited ?? 0),
        recipient_unreachable: Number(gate.errors.recipient_unreachable ?? 0),
      },
    },
  };
}
