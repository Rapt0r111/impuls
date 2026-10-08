import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url);
(url ? describe : describe.skip)(
  "F03 lifecycle migration on a pre-history database",
  () => {
    const admin = new Pool({ connectionString: url });
    // A disposable database, never the configured database or its existing data.
    const name = `impuls_lifecycle_${randomUUID().replaceAll("-", "")}`;
    const parsed = new URL(url || "postgres://localhost/test");
    parsed.pathname = `/${name}`;
    const isolated = new Pool({ connectionString: parsed.toString() });
    let created = false;
    const user = randomUUID(),
      scope = randomUUID(),
      rule = randomUUID(),
      task = randomUUID();
    const migrationDir = path.resolve("db/migrations");
    async function migrate(file: string, direction: "up" | "down" = "up") {
      const sqlMigration = require(path.join(migrationDir, file)) as Record<
        "up" | "down",
        (builder: { sql(value: string): void }) => void
      >;
      const sql: string[] = [];
      sqlMigration[direction]({
        sql(value) {
          sql.push(value);
        },
      });
      const client = await isolated.connect();
      try {
        await client.query("BEGIN");
        for (const statement of sql) {
          // Runtime role is cluster-wide and already created by the test harness.
          // All schema/table/policy SQL runs unchanged in the disposable database.
          const text = file.startsWith("000003")
            ? statement.replace(/CREATE ROLE impuls_app[\s\S]*?;/, "")
            : statement;
          await client.query(text);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    beforeAll(async () => {
      if (!/^impuls_lifecycle_[0-9a-f]{32}$/.test(name))
        throw new Error("Invalid disposable database name");
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await isolated.query(
        "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations (id integer)",
      );
      for (const file of (await readdir(migrationDir))
        .filter((file) => /^0000(0[1-9]|1[01])_/.test(file))
        .sort())
        await migrate(file);
      await isolated.query(
        "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,1,'Synthetic legacy user',true)",
        [user],
      );
      await isolated.query(
        "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'group','Synthetic legacy scope')",
        [scope],
      );
      await isolated.query(
        "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,1,'{}',now(),$2)",
        [rule, user],
      );
      await isolated.query(
        `INSERT INTO impuls.tasks (id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points,version,updated_at)
      VALUES ($1,$2,$3,$4,'Legacy synthetic task','Criteria','test','normal','in_progress','2035-01-01',23,11,9,'2026-09-01T00:00:00Z')`,
        [task, scope, rule, user],
      );
      await isolated.query(
        "INSERT INTO impuls.task_assignments (task_id,user_id) VALUES ($1,$2)",
        [task, user],
      );
      await migrate("000012_task_lifecycle.js");
    }, 20000);
    afterAll(async () => {
      await isolated.end();
      try {
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    });
    it("backfills one truthful current snapshot, without claiming the unsaved start time or actor", async () => {
      const result = await isolated.query(
        "SELECT kind,task_version,status,actor_id,assignee_id,fund_xp,fund_points,created_at > '2026-09-01'::timestamptz AS new_time FROM impuls.task_events WHERE task_id=$1",
        [task],
      );
      expect(result.rows).toEqual([
        {
          kind: "snapshot",
          task_version: 9,
          status: "in_progress",
          actor_id: null,
          assignee_id: user,
          fund_xp: 23,
          fund_points: 11,
          new_time: true,
        },
      ]);
    });
    it("permits rollback before events, but refuses destructive rollback after a lifecycle event", async () => {
      await migrate("000012_task_lifecycle.js", "down");
      expect(
        (
          await isolated.query(
            "SELECT to_regclass('impuls.task_events') IS NULL AS removed",
          )
        ).rows[0],
      ).toEqual({ removed: true });
      await migrate("000012_task_lifecycle.js");
      await isolated.query(
        `INSERT INTO impuls.task_events (task_id,task_version,kind,status,actor_id,rule_set_id,fund_xp,fund_points)
      VALUES ($1,10,'started','in_progress',$2,$3,23,11)`,
        [task, user, rule],
      );
      await expect(migrate("000012_task_lifecycle.js", "down")).rejects.toThrow(
        "Lifecycle history or view bindings exist",
      );
      expect(
        (
          await isolated.query(
            "SELECT count(*)::int n FROM impuls.task_events WHERE task_id=$1",
            [task],
          )
        ).rows[0],
      ).toEqual({ n: 2 });
    });
  },
);
