import type { CatalogCancellationEvidence } from "./cancel-schedule";
import type { Pool } from "pg";
import type { CatalogCreationEvidence } from "./create-catalog";
import type { CatalogPublicationEvidence } from "./publish";
import type { QuotaPublicationEvidence } from "./publish-quota";

type Action =
  | "task.create"
  | "task.assign"
  | "task.edit"
  | "task.cancel"
  | "task.return"
  | "task.accept"
  | "ledger.correct"
  | "reward.reserve"
  | "reward.cancel"
  | "reward.approve"
  | "reward.reject"
  | "reward.fulfill"
  | "reward.expire"
  | "catalog.create"
  | "catalog.cancel"
  | "catalog.publish"
  | "quota.publish"
  | "access.grant"
  | "access.revoke";
// Publication has its own immutable object; it never borrows a task/recipient.
const stringFields = [
  "from",
  "to",
  "status",
  "title",
  "criteria",
  "categoryCode",
  "priority",
  "dueAt",
  "assigneeId",
  "ruleSetId",
  "seasonKey",
  "quotaPeriodId",
  "entitlementId",
] as const;
const numberFields = [
  "version",
  "fundXp",
  "fundPoints",
  "ruleVersion",
  "xp",
  "points",
  "xpDelta",
  "pointsDelta",
  "balanceVersion",
  "price",
  "rewardVersion",
  "availableDelta",
  "reservedDelta",
] as const;
type Field = (typeof stringFields)[number] | (typeof numberFields)[number];
type Scope = { id: string; name: string };
type AccessEvidence = {
  bindingId: string;
  subject: { id: string; displayName: string };
  permission: string;
  validUntil: string | null;
};
type RewardEvidence = {
  redemptionId: string;
  rewardId: string;
  rewardVersionId: string;
  quotaPeriodId: string;
  title: string;
  conditions: string;
  price: number;
  rewardVersion: number;
  periodStart: string;
  periodEnd: string;
  expiresAt: string | null;
  recipient: { id: string; displayName: string };
};
const rewardFields: Partial<Record<Action, readonly Field[]>> = {
  "reward.reserve": [
    "status",
    "price",
    "rewardVersion",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
  "reward.cancel": [
    "status",
    "price",
    "rewardVersion",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
  "reward.approve": [
    "from",
    "to",
    "price",
    "version",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
  "reward.reject": [
    "from",
    "to",
    "price",
    "version",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
  "reward.fulfill": ["from", "to", "version", "entitlementId"],
  "reward.expire": [
    "from",
    "to",
    "price",
    "version",
    "quotaPeriodId",
    "availableDelta",
    "reservedDelta",
  ],
};
const rewardOnlyFields: readonly Field[] = [
  "quotaPeriodId",
  "entitlementId",
  "price",
  "rewardVersion",
  "availableDelta",
  "reservedDelta",
];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type AuditPage = {
  mode: "synthetic";
  scopes: Scope[];
  scope: Scope;
  updatedAt: string;
  nextCursor: string | null;
  items: {
    id: string;
    requestId: string;
    action: Action;
    actor: { id: string | null; displayName: string };
    occurredAt: string;
    reason: string;
    task: { id: string; currentTitle: string } | null;
    reward: RewardEvidence | null;
    catalog: CatalogPublicationEvidence | null;
    quota: QuotaPublicationEvidence | null;
    creation: CatalogCreationEvidence | null;
    cancellation: CatalogCancellationEvidence | null;
    access: AccessEvidence | null;
    reviewId: string | null;
    correctionId: string | null;
    values: { field: Field; value: string | number }[];
  }[];
};
type Row = {
  active: boolean | null;
  session_valid: boolean;
  session_revoked: boolean;
  enabled: boolean;
  scopes: Scope[];
  scope: Scope | null;
  cursor_valid: boolean;
  as_of: Date;
  id: string | null;
  request_id: string;
  action: Action;
  actor_id: string | null;
  actor_name: string;
  created_at: Date;
  reason: string;
  resolved_task_id: string | null;
  current_title: string | null;
  reward: RewardEvidence | null;
  catalog: CatalogPublicationEvidence | null;
  quota: QuotaPublicationEvidence | null;
  creation: CatalogCreationEvidence | null;
  cancellation: CatalogCancellationEvidence | null;
  access: AccessEvidence | null;
  review_id: string | null;
  correction_id: string | null;
  diff: unknown;
};

// Only known scalar evidence crosses the domain/HTTP boundary. Unknown fields
// (including accidentally stored credentials) and malformed values stay private.
function savedValues(
  diff: unknown,
  action: Action,
): AuditPage["items"][number]["values"] {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return [];
  const source = diff as Record<string, unknown>;
  const values: AuditPage["items"][number]["values"] = [];
  if (
    action === "catalog.cancel" ||
    action === "catalog.create" ||
    action === "catalog.publish" ||
    action === "quota.publish"
  )
    return values;
  const allowed = (field: Field) =>
    rewardFields[action]?.includes(field) ?? !rewardOnlyFields.includes(field);
  for (const field of stringFields) {
    if (!allowed(field)) continue;
    const value = source[field];
    const identifier = field === "quotaPeriodId" || field === "entitlementId";
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 2000 &&
      (!identifier || uuid.test(value))
    )
      values.push({ field, value });
  }
  for (const field of numberFields) {
    if (!allowed(field)) continue;
    const value = source[field];
    const delta = field === "xpDelta" || field === "pointsDelta";
    const version =
      field === "version" ||
      field === "ruleVersion" ||
      field === "balanceVersion" ||
      field === "rewardVersion" ||
      field === "price";
    const signed = field === "availableDelta" || field === "reservedDelta";
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      Math.abs(value) <= 2147483647 &&
      (delta ? value <= 0 : signed || value >= (version ? 1 : 0))
    )
      values.push({ field, value });
  }
  return values;
}

export async function readAudit(
  pool: Pool,
  actorId: string,
  sessionHash: Buffer,
  options: {
    allowSyntheticAudit?: boolean;
    scope?: string | undefined;
    action?: Action | undefined;
    limit?: number;
    cursor?:
      | { actor: string; scope: string; action: Action | "all"; id: string }
      | undefined;
  } = {},
): Promise<
  | { kind: "ok"; response: AuditPage }
  | { kind: "unauthorized" }
  | { kind: "revoked" }
  | { kind: "disabled" }
  | { kind: "not_found" }
  | { kind: "invalid_cursor" }
> {
  const cursor = options.cursor;
  const selectedScope = options.scope ?? cursor?.scope ?? null;
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const cursorMatches =
    !cursor ||
    (cursor.actor === actorId &&
      cursor.scope === selectedScope &&
      cursor.action === (options.action ?? "all"));
  const result = await pool.query<Row>(
    `WITH access AS MATERIALIZED (
      SELECT (SELECT active FROM impuls.users WHERE id=$1) AS active,
        EXISTS (SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2
          AND revoked_at IS NULL AND expires_at>clock_timestamp()) AS session_valid,
        EXISTS (SELECT 1 FROM impuls.sessions WHERE user_id=$1 AND session_hash=$2 AND revoked_at IS NOT NULL) AS session_revoked,
        $3::boolean AS enabled, clock_timestamp() AS as_of
    ), permitted AS MATERIALIZED (
      SELECT DISTINCT s.id,s.name FROM access, impuls.role_bindings b JOIN impuls.access_scopes s ON s.id=b.scope_id
      WHERE access.active AND access.session_valid AND access.enabled AND b.user_id=$1 AND b.action='admin.audit'
        AND b.revoked_at IS NULL AND b.valid_from<=access.as_of AND (b.valid_until IS NULL OR b.valid_until>access.as_of)
    ), selected AS MATERIALIZED (
      SELECT * FROM permitted WHERE $4::uuid IS NULL OR id=$4 ORDER BY name,id LIMIT 1
    ), events AS NOT MATERIALIZED (
      SELECT e.id,e.request_id,e.action,e.actor_id,e.created_at,e.reason,e.review_id,e.correction_id,e.diff,
        t.id AS resolved_task_id,t.title AS current_title,actor.display_name AS actor_name,NULL::jsonb AS reward,NULL::jsonb AS catalog,NULL::jsonb AS quota,NULL::jsonb AS creation,NULL::jsonb AS cancellation,NULL::jsonb AS access
      FROM impuls.audit_events e
      LEFT JOIN impuls.ledger_corrections c ON c.id=e.correction_id
      LEFT JOIN impuls.reviews r ON r.id=coalesce(e.review_id,c.review_id)
      LEFT JOIN impuls.submissions sub ON sub.id=r.submission_id
      JOIN impuls.tasks t ON t.id=coalesce(e.task_id,sub.task_id)
      JOIN impuls.rule_sets rules ON rules.id=t.rule_set_id AND rules.definition->>'mode'='synthetic'
      JOIN selected ON selected.id=t.scope_id
      JOIN impuls.users actor ON actor.id=e.actor_id
      WHERE $5::text IS NULL OR e.action=$5
      UNION ALL
      SELECT e.id,e.request_id,e.action,e.actor_id,e.created_at,e.reason,e.review_id,e.correction_id,e.diff,
        NULL::uuid AS resolved_task_id,NULL::text AS current_title,
        CASE WHEN e.automatic_expiry THEN 'Автоматическое истечение резерва' ELSE actor.display_name END AS actor_name,
        jsonb_build_object('redemptionId',d.id,'rewardId',d.reward_id,'rewardVersionId',d.reward_version_id,
          'quotaPeriodId',d.quota_period_id,'title',d.title,'conditions',d.conditions,'price',d.price,
          'rewardVersion',d.reward_version,'periodStart',to_char(d.period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'periodEnd',to_char(d.period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'expiresAt',to_char(d.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'recipient',jsonb_build_object('id',recipient.id,'displayName',recipient.display_name)) AS reward,NULL::jsonb AS catalog,NULL::jsonb AS quota,NULL::jsonb AS creation,NULL::jsonb AS cancellation,NULL::jsonb AS access
      FROM impuls.audit_events e
      JOIN impuls.redemptions d ON d.id=e.redemption_id AND d.mode='synthetic'
      JOIN impuls.reward_versions rv ON rv.id=d.reward_version_id AND rv.mode='synthetic' AND rv.kind='cosmetic'
      JOIN selected ON selected.id=d.scope_id
      LEFT JOIN impuls.users actor ON actor.id=e.actor_id
      JOIN impuls.users recipient ON recipient.id=d.user_id
      WHERE e.action IN ('reward.reserve','reward.cancel','reward.approve','reward.reject','reward.fulfill','reward.expire')
        AND ($5::text IS NULL OR e.action=$5)
      UNION ALL
      SELECT p.id,p.request_id,'catalog.publish',p.actor_id,p.created_at,p.reason,NULL::uuid,NULL::uuid,'{}'::jsonb,
        NULL::uuid,NULL::text,actor.display_name,NULL::jsonb,
        jsonb_build_object('rewardId',r.reward_id,'previousVersion',previous.version,'published',
          jsonb_build_object('id',r.id,'version',r.version,'title',r.title,'conditions',r.conditions,'price',r.price,
            'enabled',r.enabled,'effectiveFrom',to_char(r.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'reservationSeconds',r.reservation_seconds)),NULL::jsonb,NULL::jsonb,NULL::jsonb,NULL::jsonb
      FROM impuls.catalog_publications p
      JOIN impuls.reward_versions r ON r.id=p.published_version_id AND r.mode='synthetic' AND r.kind='cosmetic'
      JOIN impuls.reward_versions previous ON previous.id=p.previous_version_id
      JOIN selected ON selected.id=r.scope_id JOIN impuls.users actor ON actor.id=p.actor_id
      WHERE $5::text IS NULL OR $5='catalog.publish'
      UNION ALL
      SELECT p.id,p.request_id,'quota.publish',p.actor_id,p.created_at,p.reason,NULL::uuid,NULL::uuid,'{}'::jsonb,
        NULL::uuid,NULL::text,actor.display_name,NULL::jsonb,NULL::jsonb,
        jsonb_build_object('rewardId',p.reward_id,'periodId',p.quota_period_id,
          'startsAt',to_char(p.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'endsAt',to_char(p.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'capacity',p.capacity),NULL::jsonb,NULL::jsonb,NULL::jsonb
      FROM impuls.quota_publications p JOIN selected ON selected.id=p.scope_id
      JOIN impuls.users actor ON actor.id=p.actor_id
      WHERE $5::text IS NULL OR $5='quota.publish'
      UNION ALL
      SELECT p.id,p.request_id,'catalog.create',p.actor_id,p.created_at,p.reason,NULL::uuid,NULL::uuid,'{}'::jsonb,
        NULL::uuid,NULL::text,actor.display_name,NULL::jsonb,NULL::jsonb,NULL::jsonb,
        jsonb_build_object('rewardId',r.reward_id,'initial',
          jsonb_build_object('id',r.id,'version',r.version,'title',r.title,'conditions',r.conditions,'price',r.price,
            'enabled',r.enabled,'effectiveFrom',to_char(r.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'reservationSeconds',r.reservation_seconds)),NULL::jsonb,NULL::jsonb
      FROM impuls.catalog_creations p
      JOIN impuls.reward_versions r ON r.id=p.initial_version_id AND r.mode='synthetic' AND r.kind='cosmetic'
      JOIN selected ON selected.id=r.scope_id JOIN impuls.users actor ON actor.id=p.actor_id
      WHERE $5::text IS NULL OR $5='catalog.create'
      UNION ALL
      SELECT c.id,c.request_id,'catalog.cancel',c.actor_id,c.created_at,c.reason,NULL::uuid,NULL::uuid,'{}'::jsonb,
        NULL::uuid,NULL::text,actor.display_name,NULL::jsonb,NULL::jsonb,NULL::jsonb,NULL::jsonb,
        jsonb_build_object('rewardId',r.reward_id,'cancelled',jsonb_build_object('id',r.id,'version',r.version,'title',r.title,
          'conditions',r.conditions,'price',r.price,'enabled',r.enabled,
          'effectiveFrom',to_char(r.effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'reservationSeconds',r.reservation_seconds)),NULL::jsonb
      FROM impuls.catalog_cancellations c JOIN impuls.reward_versions r ON r.id=c.version_id AND r.mode='synthetic' AND r.kind='cosmetic'
      JOIN selected ON selected.id=r.scope_id JOIN impuls.users actor ON actor.id=c.actor_id
      WHERE $5::text IS NULL OR $5='catalog.cancel'
      UNION ALL
      SELECT a.id,a.request_id,'access.'||a.kind,a.actor_id,a.created_at,a.reason,NULL::uuid,NULL::uuid,'{}'::jsonb,
        NULL::uuid,NULL::text,actor.display_name,NULL::jsonb,NULL::jsonb,NULL::jsonb,NULL::jsonb,NULL::jsonb,
        jsonb_build_object('bindingId',a.binding_id,'subject',jsonb_build_object('id',subject.id,'displayName',subject.display_name),
          'permission',a.action,'validUntil',CASE WHEN a.valid_until IS NULL THEN NULL
            ELSE to_char(a.valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END)
      FROM impuls.access_changes a JOIN selected ON selected.id=a.scope_id
      JOIN impuls.users actor ON actor.id=a.actor_id JOIN impuls.users subject ON subject.id=a.subject_id
      WHERE $5::text IS NULL OR $5='access.'||a.kind
    ), anchor AS MATERIALIZED (
      SELECT created_at,id FROM events WHERE id=$6::uuid
    )
    SELECT access.*,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM permitted),'[]'::jsonb) AS scopes,
      (SELECT jsonb_build_object('id',id,'name',name) FROM selected) AS scope,
      ($6::uuid IS NULL OR ($7::boolean AND EXISTS(SELECT 1 FROM anchor))) AS cursor_valid,
      page.*
    FROM access LEFT JOIN LATERAL (
      SELECT * FROM events WHERE $6::uuid IS NULL OR ($7::boolean AND (created_at,id)<(SELECT created_at,id FROM anchor))
      ORDER BY created_at DESC,id DESC LIMIT $8
    ) page ON true ORDER BY page.created_at DESC,page.id DESC`,
    [
      actorId,
      sessionHash,
      options.allowSyntheticAudit === true,
      selectedScope,
      options.action ?? null,
      cursor?.id ?? null,
      cursorMatches,
      limit + 1,
    ],
  );
  const gate = result.rows[0]!;
  if (!gate.active || gate.session_revoked) return { kind: "revoked" };
  if (!gate.session_valid) return { kind: "unauthorized" };
  if (!gate.enabled) return { kind: "disabled" };
  if (!gate.scope) return { kind: "not_found" };
  if (!gate.cursor_valid) return { kind: "invalid_cursor" };
  const records = result.rows.filter((row) => row.id !== null);
  const rows = records.slice(0, limit);
  return {
    kind: "ok",
    response: {
      mode: "synthetic",
      scope: gate.scope,
      scopes: gate.scopes,
      updatedAt: gate.as_of.toISOString(),
      nextCursor:
        records.length > limit
          ? `${actorId}|${gate.scope.id}|${options.action ?? "all"}|${rows.at(-1)!.id}`
          : null,
      items: rows.map((row) => ({
        id: row.id!,
        requestId: row.request_id,
        action: row.action,
        actor: { id: row.actor_id, displayName: row.actor_name },
        occurredAt: row.created_at.toISOString(),
        reason: row.reason,
        task: row.resolved_task_id
          ? { id: row.resolved_task_id, currentTitle: row.current_title! }
          : null,
        reward: row.reward,
        catalog: row.catalog,
        quota: row.quota,
        creation: row.creation,
        cancellation: row.cancellation,
        access: row.access,
        reviewId: row.review_id,
        correctionId: row.correction_id,
        values: savedValues(row.diff, row.action),
      })),
    },
  };
}
