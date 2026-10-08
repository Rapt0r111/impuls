import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const url = process.env.TEST_DATABASE_URL,
  require = createRequire(import.meta.url);
(url ? describe : describe.skip)(
  "F06 forward migration and private ACL",
  () => {
    const name = `impuls_rewards_${randomUUID().replaceAll("-", "")}`;
    const parsed = new URL(url || "postgres://localhost/test");
    parsed.pathname = `/${name}`;
    const admin = new Pool({ connectionString: url }),
      db = new Pool({ connectionString: parsed.toString() });
    let created = false;
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
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    beforeAll(async () => {
      if (!/^impuls_rewards_[0-9a-f]{32}$/.test(name))
        throw new Error("Invalid isolated database name");
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await db.query(
        "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
      );
      for (const f of (await readdir("db/migrations"))
        .filter((f) => f.endsWith(".js") && f < "000017")
        .sort())
        await migrate(f);
    }, 20000);
    it("installs on the previous schema without seeding prices, participants or grants", async () => {
      await migrate("000017_reward_reservations.js");
      for (const table of ["reward_versions", "quota_periods", "redemptions"]) {
        expect(
          (await db.query(`SELECT count(*)::int n FROM impuls.${table}`))
            .rows[0].n,
        ).toBe(0);
        expect(
          (
            await db.query(
              "SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",
              [`impuls.${table}`],
            )
          ).rows[0],
        ).toEqual({ relrowsecurity: true });
      }
      expect(
        (await db.query("SELECT count(*)::int n FROM impuls.role_bindings"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.query(
            "SELECT has_table_privilege('impuls_app','impuls.reward_versions','SELECT') r,has_table_privilege('impuls_app','impuls.reward_versions','INSERT') i,has_table_privilege('impuls_app','impuls.ledger_entries','UPDATE') u,has_table_privilege('impuls_app','impuls.redemptions','DELETE') d",
          )
        ).rows[0],
      ).toEqual({ r: true, i: false, u: false, d: false });
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM information_schema.role_table_grants WHERE grantee='PUBLIC' AND table_schema='impuls' AND table_name IN ('reward_versions','quota_periods','redemptions')",
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='impuls' AND p.proname IN ('guard_reward_version','guard_quota_period','guard_redemption','guard_reservation_entry') AND (p.prosecdef OR has_function_privilege('public',p.oid,'EXECUTE'))",
          )
        ).rows[0].n,
      ).toBe(0);
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
