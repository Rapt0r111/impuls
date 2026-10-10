import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import pg from "pg";
import { localRestoreConnection } from "./database-restore-safety.mjs";

// P-06: a daily copy only counts once it has been restored and checked
// (docs/operations/database-backup.md). This restores an archive into a fresh
// database on a local server and checks what a restore must keep: the
// migration history and the ledger/balance agreement that the pilot stops on.
// It never connects to the source of the archive.

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Migration names as node-pg-migrate records them, in order. */
export async function repositoryMigrations(
  directory = path.join(root, "db", "migrations"),
) {
  return (await readdir(directory))
    .filter((file) => /^\d+_.*\.js$/.test(file))
    .sort()
    .map((file) => file.slice(0, -3));
}

/**
 * Roles named in the archive's privileges and row policies. A restore keeps ACLs, so they must
 * exist in the target cluster (as NOLOGIN placeholders) before pg_restore runs.
 * @param {string} script schema-only SQL from `pg_restore --schema-only -f -`
 */
export function referencedRoles(script) {
  const roles = new Set();
  for (const line of script.split("\n")) {
    if (!/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES|CREATE POLICY)\b/.test(line))
      continue;
    for (const match of line.matchAll(
      /\b(?:TO|FROM|FOR ROLE)\s+((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\s*,\s*(?:"[^"]+"|[a-z_][a-z0-9_$]*))*)/gi,
    ))
      for (const name of match[1].split(/\s*,\s*/))
        roles.add(name.replace(/^"|"$/g, ""));
  }
  for (const builtIn of ["PUBLIC", "public", "CURRENT_USER", "SESSION_USER"])
    roles.delete(builtIn);
  return [...roles].sort();
}

/**
 * Checks on a restored database. Returns the problems found (empty when the
 * copy is usable) and a summary without any personal data.
 * @param {import("pg").ClientBase | import("pg").Pool} db
 * @param {string[]} migrations names from repositoryMigrations()
 */
export async function checkRestoredDatabase(db, migrations) {
  const problems = [];
  const restored = (
    await db.query("SELECT name FROM impuls_meta.pgmigrations ORDER BY id")
  ).rows.map((row) => row.name);
  // Production may lag the repository; it must never diverge from it.
  const diverged = restored.findIndex((name, i) => migrations[i] !== name);
  if (restored.length === 0) problems.push("no migrations recorded");
  else if (diverged !== -1)
    problems.push(
      `migration ${diverged + 1} is ${restored[diverged]}, repository has ${migrations[diverged] ?? "nothing"}`,
    );

  const mismatched = Number(
    (
      await db.query(`
        WITH ledger AS (
          SELECT user_id,
            sum(amount) FILTER (WHERE currency = 'xp') AS xp,
            sum(amount) FILTER (WHERE currency = 'points') AS points,
            sum(reserved_delta) AS reserved
          FROM impuls.ledger_entries GROUP BY user_id)
        SELECT count(*) AS n
        FROM impuls.account_balances b FULL JOIN ledger l USING (user_id)
        WHERE (coalesce(b.lifetime_xp, 0), coalesce(b.available_points, 0), coalesce(b.reserved_points, 0))
          IS DISTINCT FROM (coalesce(l.xp, 0), coalesce(l.points, 0), coalesce(l.reserved, 0))`)
    ).rows[0].n,
  );
  if (mismatched)
    problems.push(
      `${mismatched} account balances disagree with the ledger journal`,
    );

  const tables = (
    await db.query(`
      SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('impuls', 'impuls_meta') AND c.relkind = 'r'
      ORDER BY 1`)
  ).rows.map((row) => row.name);
  const rows = {};
  for (const table of tables) {
    const [schema, name] = table.split(".");
    rows[table] = Number(
      (
        await db.query(
          `SELECT count(*) AS n FROM ${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(name)}`,
        )
      ).rows[0].n,
    );
  }
  return {
    problems,
    summary: {
      migrations: restored.length,
      lastMigration: restored.at(-1) ?? null,
      pendingMigrations: Math.max(0, migrations.length - restored.length),
      tables: tables.length,
      rows,
    },
  };
}

function toolEnvironment(connection, database) {
  if (!/^impuls_backup_check_[0-9a-f]{16}$/.test(database))
    throw new Error("Invalid disposable backup check database");
  // Do not inherit PGOPTIONS, a service file or application secrets into libpq.
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return {
    ...env,
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: database,
    PGSSLMODE: "disable",
    PGCONNECT_TIMEOUT: "5",
    PGAPPNAME: "impuls_backup_check",
  };
}

/**
 * Restores `archive` into a new database on the local server named by
 * `targetUrl`, checks it and drops it again.
 * @param {{ archive: string, targetUrl: string, migrations?: string[], keep?: boolean }} options
 */
export async function verifyBackup(options) {
  const connection = localRestoreConnection(options.targetUrl);
  const migrations = options.migrations ?? (await repositoryMigrations());
  const database = `impuls_backup_check_${randomBytes(8).toString("hex")}`;
  const env = toolEnvironment(connection, database);
  const tool = (name) =>
    process.env.PG_BIN
      ? path.join(
          process.env.PG_BIN,
          `${name}${process.platform === "win32" ? ".exe" : ""}`,
        )
      : name;
  const execute = async (name, args) => {
    try {
      return (await run(tool(name), args, { env, maxBuffer: 64 << 20 })).stdout;
    } catch {
      // execFile errors carry arguments and stderr; keep the message neutral.
      throw new Error(`${name} failed on the archive`);
    }
  };

  const admin = new pg.Client({ ...connection, ssl: false });
  await admin.connect();
  let created = false;
  try {
    const roles = referencedRoles(
      await execute("pg_restore", [
        "--schema-only",
        "--file=-",
        options.archive,
      ]),
    );
    const missing = (
      await admin.query(
        "SELECT r FROM unnest($1::text[]) r WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)",
        [roles],
      )
    ).rows.map((row) => row.r);
    for (const role of missing)
      await admin.query(`CREATE ROLE ${pg.escapeIdentifier(role)} NOLOGIN`);
    await admin.query(
      `CREATE DATABASE ${pg.escapeIdentifier(database)} TEMPLATE template0`,
    );
    created = true;
    await execute("pg_restore", [
      "--single-transaction",
      "--exit-on-error",
      "--no-owner",
      "--no-password",
      "--dbname",
      database,
      options.archive,
    ]);
    const restored = new pg.Client({ ...connection, database, ssl: false });
    await restored.connect();
    try {
      return {
        ...(await checkRestoredDatabase(restored, migrations)),
        rolesCreated: missing,
      };
    } finally {
      await restored.end();
    }
  } finally {
    try {
      if (created && !options.keep)
        await admin.query(
          `DROP DATABASE ${pg.escapeIdentifier(database)} WITH (FORCE)`,
        );
    } finally {
      await admin.end();
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: { archive: { type: "string" } },
  });
  if (!values.archive) throw new Error("--archive <file> is required");
  const targetUrl = process.env.TEST_DATABASE_URL;
  if (!targetUrl) throw new Error("TEST_DATABASE_URL is required");
  const result = await verifyBackup({ archive: values.archive, targetUrl });
  console.log(JSON.stringify(result, null, 2));
  if (result.problems.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
