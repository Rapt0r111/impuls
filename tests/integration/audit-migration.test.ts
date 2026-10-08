import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const url = process.env.TEST_DATABASE_URL,
  require = createRequire(import.meta.url);
(url ? describe : describe.skip)("F07 audit permission migration", () => {
  const name = `impuls_audit_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url || "postgres://localhost/test");
  parsed.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url }),
    db = new Pool({ connectionString: parsed.toString() });
  let created = false;
  const user = randomUUID(),
    scope = randomUUID();
  async function migrate(file: string, direction: "up" | "down" = "up") {
    const statements: string[] = [];
    require(path.resolve("db/migrations", file))[direction]({
      sql: (v: string) => statements.push(v),
    });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const sql of statements)
        await client.query(
          file.startsWith("000003")
            ? sql.replace(/CREATE ROLE impuls_app[\s\S]*?;/, "")
            : sql,
        );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  beforeAll(async () => {
    if (!/^impuls_audit_[0-9a-f]{32}$/.test(name))
      throw new Error("Invalid disposable DB name");
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await db.query(
      "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
    );
    for (const f of (await readdir("db/migrations"))
      .filter((f) => f.endsWith(".js") && f < "000016")
      .sort())
      await migrate(f);
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,1,'Synthetic auditor',true)",
      [user],
    );
    await db.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'group','Synthetic migration scope')",
      [scope],
    );
  }, 20000);
  const binding = () =>
    db.query(
      "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'admin.audit',$2,$1,'Synthetic audit reader')",
      [user, scope],
    );
  it("does not grant new authority, preserves existing ACL and supports unused down/up", async () => {
    await expect(binding()).rejects.toMatchObject({ code: "23514" });
    await migrate("000016_scoped_audit_reader.js");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM impuls.role_bindings WHERE action='admin.audit'",
        )
      ).rows[0],
    ).toEqual({ n: 0 });
    await migrate("000016_scoped_audit_reader.js", "down");
    await expect(binding()).rejects.toMatchObject({ code: "23514" });
    await migrate("000016_scoped_audit_reader.js");
    expect(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='impuls.audit_events'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true });
    expect(
      (
        await db.query(
          "SELECT has_table_privilege('impuls_app','impuls.audit_events','SELECT') r,has_table_privilege('impuls_app','impuls.audit_events','UPDATE') u,has_table_privilege('impuls_app','impuls.audit_events','DELETE') d",
        )
      ).rows[0],
    ).toEqual({ r: true, u: false, d: false });
  });
  it("blocks destructive down for assigned authority and retains the index and binding", async () => {
    await binding();
    await expect(
      migrate("000016_scoped_audit_reader.js", "down"),
    ).rejects.toThrow("while bindings exist");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM impuls.role_bindings WHERE action='admin.audit'",
        )
      ).rows[0],
    ).toEqual({ n: 1 });
    expect(
      (
        await db.query(
          "SELECT to_regclass('impuls.audit_events_time_id_idx') IS NOT NULL AS present",
        )
      ).rows[0],
    ).toEqual({ present: true });
  });
  afterAll(async () => {
    await db.end();
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });
});
