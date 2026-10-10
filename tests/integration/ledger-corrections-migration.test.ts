import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase } from "./drop-database";
const url = process.env.TEST_DATABASE_URL,
  require = createRequire(import.meta.url);
(url ? describe : describe.skip)("F04 compensation migration", () => {
  const name = `impuls_corrections_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url || "postgres://localhost/test");
  parsed.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url }),
    db = new Pool({ connectionString: parsed.toString() });
  const actor = randomUUID(),
    recipient = randomUUID(),
    scope = randomUUID(),
    rule = randomUUID(),
    task = randomUUID(),
    sub = randomUUID(),
    review = randomUUID();
  let created = false;
  async function migrate(
    direction: "up" | "down" = "up",
    file = "000014_ledger_corrections.js",
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
    if (!/^impuls_corrections_[0-9a-f]{32}$/.test(name))
      throw new Error("Invalid disposable DB");
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await db.query(
      "CREATE SCHEMA impuls_meta;CREATE TABLE impuls_meta.pgmigrations(id integer)",
    );
    for (const f of (await readdir("db/migrations"))
      .filter((f) => f.endsWith(".js") && f < "000014")
      .sort())
      await migrate("up", f);
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,1,'Synthetic correcting actor',true),($2,2,'Synthetic legacy recipient',true)",
      [actor, recipient],
    );
    await db.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic legacy scope')",
      [scope],
    );
    await db.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,1,'{}',now(),$2)",
      [rule, actor],
    );
    await db.query(
      "INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES($1,$2,$3,$4,'Legacy accepted task','Synthetic criterion','test','normal','accepted',now(),17,9)",
      [task, scope, rule, actor],
    );
    await db.query(
      "INSERT INTO impuls.submissions(id,task_id,author_id,attempt_number,text) VALUES($1,$2,$3,1,'Synthetic legacy evidence')",
      [sub, task, recipient],
    );
    await db.query(
      "INSERT INTO impuls.reviews(id,submission_id,reviewer_id,decision,reason,fund_xp,fund_points) VALUES($1,$2,$3,'accept','Legacy acceptance',17,9)",
      [review, sub, actor],
    );
    await db.query(
      "INSERT INTO impuls.ledger_entries(user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,kind,amount,mode,season_key,time_zone,created_at,updated_at) VALUES($1,$2,$3,'Legacy accepted task',$4,1,'xp','task_acceptance',17,'synthetic','2026-09','Europe/Moscow',now(),now()),($1,$2,$3,'Legacy accepted task',$4,1,'points','task_acceptance',9,'synthetic','2026-09','Europe/Moscow',now(),now())",
      [recipient, review, task, rule],
    );
    await migrate();
  }, 20000);
  it("preserves prior awards through final up/down/up before any correction", async () => {
    await migrate("down");
    await migrate();
    expect(
      (
        await db.query(
          "SELECT currency,amount,correction_id,original_entry_id FROM impuls.ledger_entries WHERE review_id=$1 ORDER BY currency",
          [review],
        )
      ).rows,
    ).toEqual([
      {
        currency: "points",
        amount: 9,
        correction_id: null,
        original_entry_id: null,
      },
      {
        currency: "xp",
        amount: 17,
        correction_id: null,
        original_entry_id: null,
      },
    ]);
  });
  it("rejects wrong recipient/amount/self and prevents destructive rollback once history exists", async () => {
    const insert =
      "INSERT INTO impuls.ledger_corrections(review_id,user_id,actor_id,reason,xp_delta,points_delta,mode,created_at,updated_at) VALUES($1,$2,$3,'Synthetic migration correction',$4,-9,'synthetic',now(),now()) RETURNING id";
    await expect(
      db.query(insert, [review, recipient, actor, -16]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(insert, [review, actor, recipient, -17]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(insert, [review, recipient, recipient, -17]),
    ).rejects.toMatchObject({ code: "23514" });
    const c = (
      await db.query<{ id: string }>(insert, [review, recipient, actor, -17])
    ).rows[0]!.id;
    const source =
      "INSERT INTO impuls.ledger_entries(user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,kind,amount,mode,season_key,time_zone,correction_id,original_entry_id,created_at,updated_at) SELECT user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,'acceptance_reversal',-amount,mode,$3,time_zone,$2,id,now(),now() FROM impuls.ledger_entries WHERE review_id=$1 AND kind='task_acceptance'";
    await expect(
      db.query(source, [review, c, "2026-10"]),
    ).rejects.toMatchObject({ code: "23514" });
    await db.query(source, [review, c, "2026-09"]);
    await expect(
      db.query(source, [review, c, "2026-09"]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(migrate("down")).rejects.toThrow("Correction history exists");
    expect(
      (
        await db.query(
          "SELECT sum(amount)::int total FROM impuls.ledger_entries WHERE review_id=$1",
          [review],
        )
      ).rows[0],
    ).toEqual({ total: 0 });
    expect(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='impuls.ledger_corrections'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true });
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
