import { dropDatabase } from "./drop-database";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url);
(url ? describe : describe.skip)("F03 edit/cancel migration", () => {
  const name = `impuls_changes_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url || "postgres://localhost/test");
  parsed.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url }),
    db = new Pool({ connectionString: parsed.toString() });
  let created = false;
  const user = randomUUID(),
    scope = randomUUID(),
    rule = randomUUID(),
    task = randomUUID();
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
    if (!/^impuls_changes_[0-9a-f]{32}$/.test(name))
      throw new Error("Invalid disposable DB name");
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await db.query(
      "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
    );
    for (const f of (await readdir("db/migrations"))
      .filter((f) => f.endsWith(".js") && f < "000013")
      .sort())
      await migrate(f);
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES ($1,1,'Synthetic legacy',true)",
      [user],
    );
    await db.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES ($1,'group','Synthetic scope')",
      [scope],
    );
    await db.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES ($1,1,'{}',now(),$2)",
      [rule, user],
    );
    await db.query(
      "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES ($1,$2,$3,$4,'Legacy','Criterion','test','normal','draft',now(),17,9)",
      [task, scope, rule, user],
    );
    await db.query(
      "INSERT INTO impuls.task_events(task_id,task_version,kind,status,rule_set_id,fund_xp,fund_points) VALUES ($1,1,'snapshot','draft',$2,17,9)",
      [task, rule],
    );
    await migrate("000013_task_edit_cancel.js");
  }, 20000);
  it("preserves unknown historical conditions and allows safe pre-use down/up", async () => {
    expect(
      (
        await db.query(
          "SELECT reason,task_snapshot FROM impuls.task_events WHERE task_id=$1",
          [task],
        )
      ).rows,
    ).toEqual([{ reason: null, task_snapshot: null }]);
    await migrate("000013_task_edit_cancel.js", "down");
    await migrate("000013_task_edit_cancel.js");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM impuls.task_events WHERE task_id=$1",
          [task],
        )
      ).rows[0],
    ).toEqual({ n: 1 });
  });
  it("requires a reason/snapshot for cancellation and protects history from rollback", async () => {
    const insert = `INSERT INTO impuls.task_events(task_id,task_version,kind,status,actor_id,rule_set_id,fund_xp,fund_points,reason,task_snapshot) VALUES ($1,2,'cancelled','cancelled',$2,$3,17,9,$4,$5)`;
    await expect(
      db.query(insert, [task, user, rule, null, null]),
    ).rejects.toMatchObject({ code: "23514" });
    await db.query(insert, [
      task,
      user,
      rule,
      "Synthetic cancellation",
      JSON.stringify({
        title: "Legacy",
        criteria: "Criterion",
        categoryCode: "test",
        priority: "normal",
        dueAt: "2035-01-01T12:00:00Z",
      }),
    ]);
    await expect(migrate("000013_task_edit_cancel.js", "down")).rejects.toThrow(
      "Management history exists",
    );
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM impuls.task_events WHERE task_id=$1",
          [task],
        )
      ).rows[0],
    ).toEqual({ n: 2 });
  });
  afterAll(async () => {
    await db.end();
    try {
      if (created) await dropDatabase(admin, name);
    } finally {
      await admin.end();
    }
  });
});
