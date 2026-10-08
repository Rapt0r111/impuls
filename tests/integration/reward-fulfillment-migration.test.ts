import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const url = process.env.TEST_DATABASE_URL,
  require = createRequire(import.meta.url);
(url ? describe : describe.skip)(
  "F06 fulfillment upgrade preserves approved history",
  () => {
    const name = `impuls_fulfillment_${randomUUID().replaceAll("-", "")}`,
      parsed = new URL(url || "postgres://localhost/test");
    parsed.pathname = `/${name}`;
    const admin = new Pool({ connectionString: url }),
      db = new Pool({ connectionString: parsed.toString() });
    let created = false;
    const owner = randomUUID(),
      actor = randomUUID(),
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
        for (const s of sql)
          await client.query(
            file.startsWith("000003")
              ? s.replace(/CREATE ROLE impuls_app[\s\S]*?;/, "")
              : s,
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
      if (!/^impuls_fulfillment_[0-9a-f]{32}$/.test(name))
        throw new Error("Invalid disposable DB name");
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await db.query(
        "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
      );
      for (const f of (await readdir("db/migrations"))
        .filter((f) => f.endsWith(".js") && f < "000019")
        .sort())
        await migrate(f);
      for (const [id, tg] of [
        [owner, 88888888881],
        [actor, 88888888882],
      ])
        await db.query(
          "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic upgrade',true)",
          [id, tg],
        );
      await db.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic upgrade')",
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
        [request, owner, version],
      );
      await db.query(
        "INSERT INTO impuls.ledger_entries(user_id,redemption_id,currency,kind,amount,reserved_delta,mode,season_key,time_zone,created_at,updated_at) VALUES($1,$2,'points','reward_reservation',-30,30,'synthetic','2026-10','Europe/Moscow',now(),now())",
        [owner, request],
      );
      await db.query(
        "UPDATE impuls.redemptions SET status='approved',decision_actor_id=$2,decision_reason='Saved approval',decided_at=clock_timestamp(),version=2 WHERE id=$1",
        [request, actor],
      );
      await db.query(
        "INSERT INTO impuls.ledger_entries(user_id,redemption_id,currency,kind,amount,reserved_delta,original_entry_id,mode,season_key,time_zone,created_at,updated_at) SELECT $1,$2,'points','reward_approval',0,-30,id,'synthetic',season_key,time_zone,now(),now() FROM impuls.ledger_entries WHERE redemption_id=$2 AND kind='reward_reservation'",
        [owner, request],
      );
      await db.query(
        "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points,reserved_points) VALUES($1,300,90,0)",
        [owner],
      );
      await db.query(
        "UPDATE impuls.quota_periods SET reserved=0,used=1,version=2 WHERE id=$1",
        [quota],
      );
    }, 20000);
    it("does not auto-issue, preserves approval/ledger/balances and grants only private append access", async () => {
      const before = (
        await db.query("SELECT * FROM impuls.redemptions WHERE id=$1", [
          request,
        ])
      ).rows[0];
      await migrate("000019_reward_fulfillment.js");
      expect(
        (
          await db.query("SELECT * FROM impuls.redemptions WHERE id=$1", [
            request,
          ])
        ).rows[0],
      ).toEqual({
        ...before,
        fulfillment_actor_id: null,
        fulfillment_reason: null,
        fulfilled_at: null,
      });
      expect(
        (await db.query("SELECT count(*)::int n FROM impuls.entitlements"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (await db.query("SELECT count(*)::int n FROM impuls.role_bindings"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (await db.query("SELECT count(*)::int n FROM impuls.ledger_entries"))
          .rows[0].n,
      ).toBe(2);
      expect(
        (
          await db.query(
            "SELECT lifetime_xp,available_points,reserved_points FROM impuls.account_balances",
          )
        ).rows[0],
      ).toEqual({
        lifetime_xp: "300",
        available_points: "90",
        reserved_points: "0",
      });
      expect(
        (
          await db.query(
            "SELECT has_table_privilege('impuls_app','impuls.entitlements','INSERT') i,has_table_privilege('impuls_app','impuls.entitlements','SELECT') s,has_table_privilege('impuls_app','impuls.entitlements','UPDATE') u,has_table_privilege('impuls_app','impuls.entitlements','DELETE') d",
          )
        ).rows[0],
      ).toEqual({ i: true, s: true, u: false, d: false });
      expect(
        (
          await db.query(
            "SELECT relrowsecurity FROM pg_class WHERE oid='impuls.entitlements'::regclass",
          )
        ).rows[0].relrowsecurity,
      ).toBe(true);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='impuls' AND table_name='entitlements' AND grantee IN ('PUBLIC','anon','authenticated')",
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='impuls' AND p.proname IN ('guard_entitlement','check_fulfillment') AND (p.prosecdef OR has_function_privilege('public',p.oid,'EXECUTE'))",
          )
        ).rows[0].n,
      ).toBe(0);
      const sql: string[] = [];
      require(path.resolve("db/migrations/000019_reward_fulfillment.js")).down({
        sql: (v: string) => sql.push(v),
      });
      await expect(db.query(sql[0]!)).rejects.toThrow(
        "Keep fulfillment history",
      );
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
