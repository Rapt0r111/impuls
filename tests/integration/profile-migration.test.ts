import { dropDatabase } from "./drop-database";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
const url = process.env.TEST_DATABASE_URL,
  require = createRequire(import.meta.url);
(url ? describe : describe.skip)("first-result migration", () => {
  const name = `impuls_profile_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url || "postgres://localhost/test");
  parsed.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url }),
    db = new Pool({ connectionString: parsed.toString() });
  const actor = randomUUID(),
    owner = randomUUID(),
    scope = randomUUID(),
    rule = randomUUID();
  const sources = [
    "a1111111-1111-4111-8111-111111111111",
    "b1111111-1111-4111-8111-111111111111",
  ];
  let created = false;
  async function migrate(
    direction: "up" | "down" = "up",
    file = "000015_first_result.js",
  ) {
    const statements: string[] = [];
    require(path.resolve("db/migrations", file))[direction]({
      sql: (sql: string) => statements.push(sql),
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
    if (!/^impuls_profile_[0-9a-f]{32}$/.test(name))
      throw new Error("Invalid disposable DB");
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await db.query(
      "CREATE SCHEMA impuls_meta;CREATE TABLE impuls_meta.pgmigrations(id integer)",
    );
    for (const file of (await readdir("db/migrations"))
      .filter((f) => f.endsWith(".js") && f < "000015")
      .sort())
      await migrate("up", file);
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,1,'Synthetic actor',true),($2,2,'Synthetic prior recipient',true)",
      [actor, owner],
    );
    await db.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic profile migration')",
      [scope],
    );
    await db.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,1,'{}',now(),$2)",
      [rule, actor],
    );
    // Insert later UUID first: the independent expected winner is the smaller
    // UUID at equal timestamps, not insertion order or the largest award.
    for (const [i, source] of [...sources].reverse().entries()) {
      const task = randomUUID(),
        sub = randomUUID(),
        review = randomUUID();
      await db.query(
        "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES($1,$2,$3,$4,'Historical synthetic result','Independent criterion','test','normal','accepted',now(),$5,50)",
        [task, scope, rule, actor, i ? 0 : 999],
      );
      await db.query(
        "INSERT INTO impuls.submissions(id,task_id,author_id,attempt_number,text) VALUES($1,$2,$3,1,'Historical synthetic report')",
        [sub, task, owner],
      );
      await db.query(
        "INSERT INTO impuls.reviews(id,submission_id,reviewer_id,decision,reason,fund_xp,fund_points) VALUES($1,$2,$3,'accept','Historical acceptance',$4,50)",
        [review, sub, actor, i ? 0 : 999],
      );
      await db.query(
        "INSERT INTO impuls.ledger_entries(id,user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,kind,amount,mode,season_key,time_zone,created_at,updated_at) VALUES($1,$2,$3,$4,'Historical synthetic result',$5,1,'xp','task_acceptance',$6,'synthetic','2026-09','Europe/Moscow','2026-09-01T10:00:00Z','2026-09-01T10:00:00Z')",
        [source, owner, review, task, rule, i ? 0 : 999],
      );
    }
    await migrate();
  }, 20000);
  it("backfills once with explicit provenance, deterministic ties and no currency writes", async () => {
    const read = () =>
      db.query(
        "SELECT user_id,code,condition_version,source_entry_id,provenance FROM impuls.user_achievements",
      );
    const expected = [
      {
        user_id: owner,
        code: "first_result",
        condition_version: 1,
        source_entry_id: sources[0],
        provenance: "migration",
      },
    ];
    expect((await read()).rows).toEqual(expected);
    await migrate("down");
    await migrate();
    expect((await read()).rows).toEqual(expected);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n,sum(amount)::int total FROM impuls.ledger_entries",
        )
      ).rows[0],
    ).toEqual({ n: 2, total: 999 });
    expect(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='impuls.user_achievements'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true });
    expect(
      (
        await db.query(
          "SELECT has_table_privilege('impuls_app','impuls.user_achievements','UPDATE') AS update,has_table_privilege('impuls_app','impuls.user_achievements','DELETE') AS delete",
        )
      ).rows[0],
    ).toEqual({ update: false, delete: false });
  });
  it("refuses destructive down after a live issuance", async () => {
    await db.query(
      "UPDATE impuls.user_achievements SET provenance='acceptance' WHERE user_id=$1",
      [owner],
    );
    await expect(migrate("down")).rejects.toThrow(
      "First result issuance exists",
    );
    expect(
      (await db.query("SELECT 1 FROM impuls.user_achievements")).rowCount,
    ).toBe(1);
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
