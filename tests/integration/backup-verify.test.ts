import { dropDatabase } from "./drop-database";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localRestoreConnection } from "../../scripts/database-restore-safety.mjs";
import {
  repositoryMigrations,
  verifyBackup,
} from "../../scripts/verify-backup.mjs";

const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url);
const run = promisify(execFile);

// Runs pg_dump/pg_restore of the same major version as the server (PG_BIN).
(url ? describe : describe.skip)("P-06 daily backup check", () => {
  const name = `impuls_backup_src_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url || "postgres://localhost/test");
  parsed.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url }),
    db = new Pool({ connectionString: parsed.toString() });
  let created = false,
    directory = "";

  async function migrate(file: string) {
    const statements: string[] = [];
    require(path.resolve("db/migrations", file)).up({
      sql: (s: string) => statements.push(s),
    });
    for (const s of statements)
      await db.query(
        file.startsWith("000003")
          ? s.replace(/CREATE ROLE impuls_app[\s\S]*?;/, "")
          : s,
      );
  }
  // The same flags as .github/workflows/backup.yml.
  async function dump(file: string) {
    const c = localRestoreConnection(url!);
    const tool = process.env.PG_BIN
      ? path.join(process.env.PG_BIN, "pg_dump")
      : "pg_dump";
    const archive = path.join(directory, file);
    await run(
      tool,
      [
        "--format=custom",
        "--schema=impuls",
        "--schema=impuls_meta",
        "--file",
        archive,
      ],
      {
        env: {
          PATH: process.env.PATH,
          PGHOST: c.host,
          PGPORT: String(c.port),
          PGUSER: c.user,
          PGPASSWORD: c.password,
          PGDATABASE: name,
        },
      },
    );
    return archive;
  }
  const check = (archive: string) => verifyBackup({ archive, targetUrl: url! });

  beforeAll(async () => {
    if (!/^impuls_backup_src_[0-9a-f]{32}$/.test(name))
      throw new Error("Invalid disposable DB name");
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await db.query(
      "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id serial PRIMARY KEY, name varchar(255) NOT NULL, run_on timestamp NOT NULL DEFAULT now())",
    );
    for (const f of (await readdir("db/migrations"))
      .filter((f) => f.endsWith(".js"))
      .sort()) {
      await migrate(f);
      await db.query("INSERT INTO impuls_meta.pgmigrations(name) VALUES($1)", [
        f.slice(0, -3),
      ]);
    }
    directory = await mkdtemp(path.join(tmpdir(), "impuls-backup-check-"));
  }, 60000);
  afterAll(async () => {
    await db.end();
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
      if (created) await dropDatabase(admin, name);
    } finally {
      await admin.end();
    }
  });

  it("accepts a consistent copy, keeps ACLs and drops the check database", async () => {
    const user = randomUUID();
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,99999990001,'Копия',true)",
      [user],
    );
    const result = await check(await dump("ok.dump"));
    expect(result.problems).toEqual([]);
    expect(result.summary.migrations).toBe(
      (await repositoryMigrations()).length,
    );
    expect(result.summary.pendingMigrations).toBe(0);
    expect(result.summary.rows["impuls.users"]).toBe(1);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'impuls_backup_check_%'",
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("allows Production to lag behind the repository but not to diverge from it", async () => {
    const last = (
      await db.query<{ id: number; name: string }>(
        "SELECT id,name FROM impuls_meta.pgmigrations ORDER BY id DESC LIMIT 1",
      )
    ).rows[0]!;
    await db.query("DELETE FROM impuls_meta.pgmigrations WHERE id=$1", [
      last.id,
    ]);
    const lagging = await check(await dump("lag.dump"));
    expect(lagging.problems).toEqual([]);
    expect(lagging.summary.pendingMigrations).toBe(1);

    await db.query(
      "INSERT INTO impuls_meta.pgmigrations(name) VALUES('999999_not_in_repository')",
    );
    const diverged = await check(await dump("diverged.dump"));
    expect(diverged.problems).toHaveLength(1);
    expect(diverged.problems[0]).toMatch(/999999_not_in_repository/);
    await db.query(
      "DELETE FROM impuls_meta.pgmigrations WHERE name='999999_not_in_repository'",
    );
    await db.query("INSERT INTO impuls_meta.pgmigrations(name) VALUES($1)", [
      last.name,
    ]);
  });

  it("rejects a copy whose balances disagree with the ledger", async () => {
    const user = randomUUID();
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,99999990002,'Расхождение',true)",
      [user],
    );
    await db.query(
      "INSERT INTO impuls.account_balances(user_id,available_points) VALUES($1,5)",
      [user],
    );
    const result = await check(await dump("drift.dump"));
    expect(result.problems).toEqual([
      "1 account balances disagree with the ledger journal",
    ]);
  });

  it("fails on an unreadable archive instead of reporting success", async () => {
    await expect(check(path.join(directory, "missing.dump"))).rejects.toThrow(
      /pg_restore failed/,
    );
  });
});
