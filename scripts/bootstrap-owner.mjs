import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";

// P-01: the owner is the only administrator at the start, but the application
// never delegates admin.access, admin.access.manage or admin.members.manage,
// so the first grant has to come from the database operator. This script is
// that step. It runs under the migration (owner) role, never the runtime role.
//
// The list mirrors permissionActions in packages/domain/src/permissions/service.ts;
// tests/integration/owner-bootstrap.test.ts fails if the two drift apart.
const actions = [
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
];
const reason = "Начальная выдача владельцу (scripts/bootstrap-owner.mjs)";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {import("pg").PoolClient} client
 * @param {{
 *   telegramId: number,
 *   displayName: string,
 *   scopeId?: string,
 *   scopeName?: string,
 *   scopeKind?: "rota" | "group" | "project",
 *   apply: boolean,
 * }} options
 */
export async function bootstrapOwner(client, options) {
  const { telegramId, scopeId, scopeName, apply } = options;
  const scopeKind = options.scopeKind ?? "project";
  const displayName = options.displayName?.trim();
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0)
    throw new Error("telegramId must be a positive integer");
  if (!displayName || displayName.length > 80)
    throw new Error("displayName must be 1-80 characters");
  if (scopeId !== undefined && !uuid.test(scopeId))
    throw new Error("scopeId must be a UUID");
  if (scopeId === undefined && !scopeName?.trim())
    throw new Error(
      "Pass scopeId of an existing scope or scopeName to create one",
    );
  if (!["rota", "group", "project"].includes(scopeKind))
    throw new Error("scopeKind must be rota, group or project");

  await client.query("BEGIN");
  try {
    let user = (
      await client.query(
        "SELECT id, active FROM impuls.users WHERE telegram_id = $1 FOR UPDATE",
        [telegramId],
      )
    ).rows[0];
    const userCreated = !user;
    if (user && !user.active)
      throw new Error(
        "User is inactive; reactivate or remove the account deliberately first",
      );
    user ??= (
      await client.query(
        "INSERT INTO impuls.users(telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
        [telegramId, displayName],
      )
    ).rows[0];

    let scope;
    if (scopeId !== undefined) {
      scope = (
        await client.query(
          "SELECT id FROM impuls.access_scopes WHERE id = $1",
          [scopeId],
        )
      ).rows[0];
      if (!scope) throw new Error("Unknown scope id");
    } else {
      const found = (
        await client.query(
          "SELECT id FROM impuls.access_scopes WHERE kind = $1 AND name = $2",
          [scopeKind, scopeName.trim()],
        )
      ).rows;
      if (found.length > 1)
        throw new Error("Several scopes share this name; pass scopeId");
      scope = found[0];
    }
    const scopeCreated = !scope;
    scope ??= (
      await client.query(
        "INSERT INTO impuls.access_scopes(kind, name) VALUES ($1, $2) RETURNING id",
        [scopeKind, scopeName.trim()],
      )
    ).rows[0];

    const held = new Set(
      (
        await client.query(
          `SELECT action FROM impuls.role_bindings
            WHERE user_id = $1 AND scope_id = $2 AND revoked_at IS NULL
              AND valid_from <= clock_timestamp()
              AND (valid_until IS NULL OR valid_until > clock_timestamp())`,
          [user.id, scope.id],
        )
      ).rows.map((row) => row.action),
    );
    const granted = actions.filter((action) => !held.has(action));
    if (granted.length)
      await client.query(
        `INSERT INTO impuls.role_bindings(user_id, scope_id, action, granted_by, reason)
         SELECT $1, $2, a, $1, $3 FROM unnest($4::text[]) AS a`,
        [user.id, scope.id, reason, granted],
      );

    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return {
      applied: apply,
      userId: user.id,
      scopeId: scope.id,
      userCreated,
      scopeCreated,
      granted,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "telegram-id": { type: "string" },
      name: { type: "string" },
      "scope-id": { type: "string" },
      "scope-name": { type: "string" },
      "scope-kind": { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const localEnv = path.join(root, "apps", "app", ".env.local");
  if (existsSync(localEnv)) process.loadEnvFile(localEnv);
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  if (new URL(url).hostname.endsWith(".pooler.supabase.com"))
    throw new Error("Use a direct PostgreSQL connection");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await bootstrapOwner(client, {
      telegramId: Number(values["telegram-id"]),
      displayName: values.name ?? "",
      scopeId: values["scope-id"],
      scopeName: values["scope-name"],
      scopeKind: values["scope-kind"],
      apply: values.apply,
    });
    console.log(
      JSON.stringify(
        {
          mode: result.applied
            ? "applied"
            : "dry-run (nothing written; pass --apply)",
          userId: result.userId,
          userCreated: result.userCreated,
          scopeId: result.scopeId,
          scopeCreated: result.scopeCreated,
          granted: result.granted,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
