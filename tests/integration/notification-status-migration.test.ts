import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const url = process.env.TEST_DATABASE_URL,
  require = createRequire(import.meta.url);
(url ? describe : describe.skip)("F08 status reader migration ACL", () => {
  const name = `impuls_status_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url || "postgres://localhost/test");
  parsed.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url }),
    db = new Pool({ connectionString: parsed.toString() });
  const app = new Pool({
    connectionString: parsed.toString(),
    options: "-c role=impuls_app",
  });
  let created = false;
  const user = randomUUID(),
    scope = randomUUID();
  async function migrate(file: string, direction: "up" | "down" = "up") {
    const statements: string[] = [];
    require(path.resolve("db/migrations", file))[direction]({
      sql: (value: string) => statements.push(value),
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
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const file = "000022_notification_status_reader.js";
  const bind = () =>
    db.query(
      "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'admin.notifications',$2,$1,'Synthetic fixture')",
      [user, scope],
    );
  beforeAll(async () => {
    if (!/^impuls_status_[0-9a-f]{32}$/.test(name))
      throw new Error("Invalid disposable DB name");
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await db.query(
      "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
    );
    for (const f of (await readdir("db/migrations"))
      .filter((f) => f.endsWith(".js") && f < "000022")
      .sort())
      await migrate(f);
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,1,'Synthetic operator',true)",
      [user],
    );
    await db.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic status scope')",
      [scope],
    );
  }, 20000);
  it("adds no bindings, keeps worker grants and supports unused down/up", async () => {
    await expect(bind()).rejects.toMatchObject({ code: "23514" });
    await expect(
      app.query("SELECT status FROM impuls.notification_simulations"),
    ).rejects.toMatchObject({ code: "42501" });
    const before = (
      await db.query("SELECT count(*)::int n FROM impuls.role_bindings")
    ).rows;
    await migrate(file);
    expect(
      (await db.query("SELECT count(*)::int n FROM impuls.role_bindings")).rows,
    ).toEqual(before);
    expect(
      (
        await app.query(
          "SELECT outbox_id,status,error_code FROM impuls.notification_simulations",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "SELECT has_table_privilege('impuls_worker','impuls.notification_simulations','INSERT') i,has_column_privilege('impuls_worker','impuls.notification_simulations','lease_token','UPDATE') u,relrowsecurity r FROM pg_class WHERE oid='impuls.notification_simulations'::regclass",
        )
      ).rows[0],
    ).toEqual({ i: true, u: true, r: true });
    await migrate(file, "down");
    await expect(
      app.query("SELECT status FROM impuls.notification_simulations"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(bind()).rejects.toMatchObject({ code: "23514" });
    await migrate(file);
  });
  it("forbids token/recipient-lock reads and every app mutation", async () => {
    for (const sql of [
      "SELECT * FROM impuls.notification_simulations",
      "SELECT lease_token FROM impuls.notification_simulations",
      "SELECT lease_until FROM impuls.notification_simulations",
      "UPDATE impuls.notification_simulations SET status='failed'",
      "DELETE FROM impuls.notification_simulations",
      "INSERT INTO impuls.notification_simulations(outbox_id) VALUES(gen_random_uuid())",
      "SELECT impuls.lock_notification_recipient(gen_random_uuid())",
    ])
      await expect(app.query(sql)).rejects.toMatchObject({ code: "42501" });
    for (const role of ["anon", "authenticated", "authenticator"])
      if (
        (await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
          .rowCount
      )
        expect(
          (
            await db.query(
              "SELECT has_schema_privilege($1,'impuls','USAGE') s,has_any_column_privilege($1,'impuls.notification_simulations','SELECT') r",
              [role],
            )
          ).rows[0],
        ).toEqual({ s: false, r: false });
  });
  it("rejects removal of assigned authority without changing ACL or binding", async () => {
    await bind();
    await expect(migrate(file, "down")).rejects.toThrow("while bindings exist");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM impuls.role_bindings WHERE action='admin.notifications'",
        )
      ).rows[0],
    ).toEqual({ n: 1 });
    await expect(
      app.query("SELECT status FROM impuls.notification_simulations"),
    ).resolves.toBeDefined();
  });
  afterAll(async () => {
    await Promise.all([app.end(), db.end()]);
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });
});
