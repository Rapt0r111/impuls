import type { Pool } from "pg";

export const permissionActions = [
  "task.view",
  "task.create",
  "task.assign",
  "task.edit",
  "task.cancel",
  "task.review",
  "task.verify",
  "reward.decide",
  "reward.fulfill",
  "admin.access",
  "admin.access.manage",
  "admin.members.manage",
  "admin.rules",
  "admin.catalog",
  "admin.catalog.create",
  "admin.catalog.publish",
  "admin.catalog.schedule",
  "admin.catalog.schedule.cancel",
  "admin.catalog.quota.publish",
  "admin.audit",
  "admin.notifications",
  "ledger.correct",
] as const;

export type PermissionAction = (typeof permissionActions)[number];
export type PermissionScope = {
  id: string;
  kind: "rota" | "group" | "project";
  name: string;
};
export type ActivePermission = {
  action: PermissionAction;
  scope: PermissionScope;
  validUntil: string | null;
};

type PermissionRow = {
  action: PermissionAction;
  scope_id: string;
  scope_kind: PermissionScope["kind"];
  scope_name: string;
  valid_until: Date | null;
};

// Exact scope matching is intentional. A binding never grants access to a
// parent, child, or neighbouring scope by implication.
export async function hasPermission(
  pool: Pool,
  userId: string,
  action: PermissionAction,
  scopeId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM impuls.role_bindings AS b
       JOIN impuls.users AS u ON u.id = b.user_id AND u.active = true
      WHERE b.user_id = $1 AND b.action = $2 AND b.scope_id = $3
        AND b.revoked_at IS NULL AND b.valid_from <= now()
        AND (b.valid_until IS NULL OR b.valid_until > now())
      LIMIT 1`,
    [userId, action, scopeId],
  );
  return result.rowCount === 1;
}

export async function listActivePermissions(
  pool: Pool,
  userId: string,
): Promise<ActivePermission[]> {
  const result = await pool.query<PermissionRow>(
    `SELECT b.action, s.id AS scope_id, s.kind AS scope_kind,
            s.name AS scope_name, b.valid_until
       FROM impuls.role_bindings AS b
       JOIN impuls.users AS u ON u.id = b.user_id AND u.active = true
       JOIN impuls.access_scopes AS s ON s.id = b.scope_id
      WHERE b.user_id = $1 AND b.revoked_at IS NULL
        AND b.valid_from <= now()
        AND (b.valid_until IS NULL OR b.valid_until > now())
      ORDER BY s.kind, s.name, b.action, b.valid_until NULLS LAST`,
    [userId],
  );
  return result.rows.map((row) => ({
    action: row.action,
    scope: { id: row.scope_id, kind: row.scope_kind, name: row.scope_name },
    validUntil: row.valid_until?.toISOString() ?? null,
  }));
}
