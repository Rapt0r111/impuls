import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const localEnv = path.join(root, "apps", "app", ".env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required for schema migrations");
}
if (new URL(migrationUrl).hostname.endsWith(".pooler.supabase.com")) {
  throw new Error("Use a direct PostgreSQL connection for migrations");
}

const cli = path.join(
  root,
  "node_modules",
  "node-pg-migrate",
  "bin",
  "node-pg-migrate.js",
);
const result = spawnSync(
  process.execPath,
  [
    cli,
    "up",
    "--migrations-dir",
    path.join(root, "db", "migrations"),
    "--migrations-schema",
    "impuls_meta",
    "--create-migrations-schema",
  ],
  {
    cwd: root,
    env: { ...process.env, DATABASE_URL: migrationUrl },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
