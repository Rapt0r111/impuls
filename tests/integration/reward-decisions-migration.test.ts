import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const url = process.env.TEST_DATABASE_URL,
  require = createRequire(import.meta.url);
(url ? describe : describe.skip)(
  "F06 decision upgrade from reservation schema",
  () => {
    const name = `impuls_decisions_${randomUUID().replaceAll("-", "")}`,
      parsed = new URL(url || "postgres://localhost/test");
    parsed.pathname = `/${name}`;
    const admin = new Pool({ connectionString: url }),
      db = new Pool({ connectionString: parsed.toString() });
    let created = false;
    const user = randomUUID(),
      scope = randomUUID(),
      reward = randomUUID(),
      version = randomUUID(),
      quota = randomUUID(),
      request = randomUUID();
    async function migrate(file: string) {
      const sql: string[] = [];
      require(path.resolve("db/migrations", file)).up({
        sql: (v: string) => sql.push(v),
      });
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        for (const statement of sql)
          await client.query(
            file.startsWith("000003")
              ? statement.replace(/CREATE ROLE impuls_app[\s\S]*?;/, "")
              : statement,
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
      if (!/^impuls_decisions_[0-9a-f]{32}$/.test(name))
        throw new Error("Invalid test database name");
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await db.query(
        "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
      );
      for (const f of (await readdir("db/migrations"))
        .filter((f) => f.endsWith(".js") && f < "000018")
        .sort())
        await migrate(f);
      await db.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,77777777777,'Synthetic upgrade owner',true)",
        [user],
      );
      await db.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic upgrade scope')",
        [scope],
      );
      await db.query(
        "INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from) VALUES($1,$2,$3,1,'Saved title','Saved terms',30,'cosmetic','synthetic',true,now())",
        [version, reward, scope],
      );
      await db.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity,reserved) VALUES($1,$2,$3,'2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',2,1)",
        [quota, reward, scope],
      );
      await db.query(
        "INSERT INTO impuls.redemptions(id,user_id,reward_version_id,reward_id,scope_id,quota_period_id,reward_version,title,conditions,price,period_start,period_end,mode,created_at,updated_at) SELECT $1,$2,r.id,r.reward_id,r.scope_id,q.id,r.version,r.title,r.conditions,r.price,q.starts_at,q.ends_at,'synthetic',now(),now() FROM impuls.reward_versions r JOIN impuls.quota_periods q ON q.reward_id=r.reward_id WHERE r.id=$3",
        [request, user, version],
      );
      await db.query(
        "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points,reserved_points) VALUES($1,300,90,30)",
        [user],
      );
      await db.query(
        "INSERT INTO impuls.ledger_entries(user_id,redemption_id,currency,kind,amount,reserved_delta,mode,season_key,time_zone,created_at,updated_at) VALUES($1,$2,'points','reward_reservation',-30,30,'synthetic','2026-10','Europe/Moscow',now(),now())",
        [user, request],
      );
    }, 20000);
    it("preserves pending data and balances, creates no authority, keeps private ACL and forward history", async () => {
      await migrate("000018_reward_decisions.js");
      expect(
        (
          await db.query(
            "SELECT status,version,title,conditions,price,decision_actor_id,decision_reason,decided_at FROM impuls.redemptions WHERE id=$1",
            [request],
          )
        ).rows[0],
      ).toEqual({
        status: "pending",
        version: 1,
        title: "Saved title",
        conditions: "Saved terms",
        price: 30,
        decision_actor_id: null,
        decision_reason: null,
        decided_at: null,
      });
      expect(
        (
          await db.query(
            "SELECT lifetime_xp,available_points,reserved_points FROM impuls.account_balances WHERE user_id=$1",
            [user],
          )
        ).rows[0],
      ).toEqual({
        lifetime_xp: "300",
        available_points: "90",
        reserved_points: "30",
      });
      expect(
        (await db.query("SELECT count(*)::int n FROM impuls.role_bindings"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (await db.query("SELECT count(*)::int n FROM impuls.ledger_entries"))
          .rows[0].n,
      ).toBe(1);
      expect(
        (
          await db.query(
            "SELECT has_column_privilege('impuls_app','impuls.redemptions','decision_reason','UPDATE') u,has_table_privilege('impuls_app','impuls.redemptions','DELETE') d,has_table_privilege('impuls_app','impuls.reward_versions','INSERT') i",
          )
        ).rows[0],
      ).toEqual({ u: true, d: false, i: false });
      expect(
        (
          await db.query(
            "SELECT relrowsecurity FROM pg_class WHERE oid='impuls.redemptions'::regclass",
          )
        ).rows[0].relrowsecurity,
      ).toBe(true);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM information_schema.role_column_grants WHERE grantee='PUBLIC' AND table_schema='impuls' AND table_name='redemptions'",
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='impuls' AND p.proname IN ('guard_redemption','guard_reservation_entry') AND (p.prosecdef OR has_function_privilege('public',p.oid,'EXECUTE'))",
          )
        ).rows[0].n,
      ).toBe(0);
      const sql: string[] = [];
      require(path.resolve("db/migrations/000018_reward_decisions.js")).down({
        sql: (v: string) => sql.push(v),
      });
      await expect(db.query(sql[0]!)).rejects.toThrow("Keep decision history");
    });
    afterAll(async () => {
      await db.end();
      if (created) {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
          [name],
        );
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end();
    });
  },
);
