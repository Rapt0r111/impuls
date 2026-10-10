import { dropDatabase } from "./drop-database";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eraseDepartedMembers } from "../../scripts/erase-departed-members.mjs";

const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url);
const placeholder = "Удалённый участник";

(url ? describe : describe.skip)(
  "P-02 erasure 90 days after a member leaves",
  () => {
    const name = `impuls_erasure_${randomUUID().replaceAll("-", "")}`;
    const parsed = new URL(url || "postgres://localhost/test");
    parsed.pathname = `/${name}`;
    const admin = new Pool({ connectionString: url }),
      db = new Pool({ connectionString: parsed.toString() });
    const app = new Pool({
      connectionString: parsed.toString(),
      options: "-c role=impuls_app",
    });
    let created = false,
      chat = 77777770000;

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
    // A member whose memberships ended `days` ago (null = still open) and whose
    // account is switched off unless `active`.
    async function member(
      memberships: { revokedDaysAgo?: number; endedByTermDaysAgo?: number }[],
      active = false,
    ) {
      const id = randomUUID(),
        telegram = String(++chat);
      await db.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,$4)",
        [id, telegram, `Участник ${chat}`, active],
      );
      for (const m of memberships) {
        const own = (
          await db.query<{ id: string }>(
            "INSERT INTO impuls.access_scopes(kind,name) VALUES('group',$1) RETURNING id",
            [`Область ${randomUUID()}`],
          )
        ).rows[0]!.id;
        await db.query(
          `INSERT INTO impuls.task_scope_members(scope_id,user_id,valid_from,valid_until,revoked_at)
           VALUES($1,$2,now()-interval '400 days',
             now()-make_interval(days=>$3::int),now()-make_interval(days=>$4::int))`,
          [own, id, m.endedByTermDaysAgo ?? null, m.revokedDaysAgo ?? null],
        );
      }
      await db.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at,revoked_at) VALUES($1,$2,now()-interval '90 days',now()-interval '100 days')",
        [id, createHash("sha256").update(id).digest()],
      );
      return { id, telegram };
    }
    async function reply(actor: string, body: object) {
      await db.query(
        `INSERT INTO impuls.idempotency_records(actor_id,operation,key,request_hash,response_status,response_body)
         VALUES($1,'admin.members.change',$2,$3,201,$4::jsonb)`,
        [
          actor,
          randomUUID(),
          createHash("sha256").update(randomUUID()).digest(),
          JSON.stringify(body),
        ],
      );
    }
    const user = async (id: string) =>
      (
        await db.query(
          "SELECT telegram_id,display_name,active,erased_at FROM impuls.users WHERE id=$1",
          [id],
        )
      ).rows[0];
    const count = async (sql: string, params: unknown[]) =>
      Number((await db.query(sql, params)).rows[0].n);
    const run = async (apply: boolean, limit?: number) => {
      const client = await db.connect();
      try {
        return await eraseDepartedMembers(client, { apply, limit });
      } finally {
        client.release();
      }
    };

    beforeAll(async () => {
      if (!/^impuls_erasure_[0-9a-f]{32}$/.test(name))
        throw new Error("Invalid disposable DB name");
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await db.query(
        "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
      );
      for (const f of (await readdir("db/migrations"))
        .filter((f) => f.endsWith(".js"))
        .sort())
        await migrate(f);
    }, 60000);
    afterAll(async () => {
      await Promise.all([app.end(), db.end()]);
      try {
        if (created) await dropDatabase(admin, name);
      } finally {
        await admin.end();
      }
    });

    it("leaves everyone alone in a dry run and reports who is due", async () => {
      const gone = await member([{ revokedDaysAgo: 91 }]);
      const result = await run(false);
      expect(result.applied).toBe(false);
      expect(result.due).toBeGreaterThanOrEqual(1);
      expect(result.erased.map((e) => e.userId)).toContain(gone.id);
      expect((await user(gone.id)).telegram_id).toBe(gone.telegram);
      expect(
        await count("SELECT count(*) n FROM impuls.member_erasures", []),
      ).toBe(0);
    });

    it("erases the Telegram ID, name, sessions, name history and stored replies of a member gone 91 days", async () => {
      const keeper = await member([], true);
      const gone = await member([{ revokedDaysAgo: 91 }]);
      await db.query(
        "INSERT INTO impuls.profile_name_changes(user_id,previous_name,new_name,request_id) VALUES($1,'Старое имя','Новое имя',$2)",
        [gone.id, randomUUID()],
      );
      await reply(gone.id, { displayName: "Новое имя" });
      await reply(keeper.id, {
        member: { userId: gone.id, displayName: "Новое имя" },
      });
      await reply(keeper.id, { member: { userId: keeper.id } });

      const result = await run(true);
      const mine = result.erased.find((e) => e.userId === gone.id);
      expect(mine).toBeDefined();

      expect(await user(gone.id)).toMatchObject({
        telegram_id: null,
        display_name: placeholder,
        active: false,
      });
      expect((await user(gone.id)).erased_at).not.toBeNull();
      expect(
        await count("SELECT count(*) n FROM impuls.sessions WHERE user_id=$1", [
          gone.id,
        ]),
      ).toBe(0);
      expect(
        await count(
          "SELECT count(*) n FROM impuls.profile_name_changes WHERE user_id=$1",
          [gone.id],
        ),
      ).toBe(0);
      expect(
        await count(
          "SELECT count(*) n FROM impuls.idempotency_records WHERE response_body::text LIKE '%'||$1::text||'%' OR actor_id=$1::uuid",
          [gone.id],
        ),
      ).toBe(0);
      // The administrator's other reply and the history rows stay.
      expect(
        await count(
          "SELECT count(*) n FROM impuls.idempotency_records WHERE actor_id=$1",
          [keeper.id],
        ),
      ).toBe(1);
      expect(
        await count(
          "SELECT count(*) n FROM impuls.task_scope_members WHERE user_id=$1",
          [gone.id],
        ),
      ).toBe(1);
      expect(
        (
          await db.query(
            "SELECT sessions_deleted,name_changes_deleted,idempotency_records_deleted FROM impuls.member_erasures WHERE user_id=$1",
            [gone.id],
          )
        ).rows,
      ).toEqual([
        {
          sessions_deleted: 1,
          name_changes_deleted: 1,
          idempotency_records_deleted: 2,
        },
      ]);
      // Nothing in the database still holds the old name.
      expect(
        await count(
          `SELECT count(*) n FROM impuls.users WHERE display_name='Новое имя'`,
          [],
        ),
      ).toBe(0);
    });

    it("keeps members who left 89 days ago, are still active, still hold a membership or never had one", async () => {
      const recent = await member([{ revokedDaysAgo: 89 }]);
      const active = await member([{ revokedDaysAgo: 120 }], true);
      const stillIn = await member([{ revokedDaysAgo: 120 }, {}]);
      const owner = await member([]);
      const result = await run(true);
      const erased = result.erased.map((e) => e.userId);
      for (const kept of [recent, active, stillIn, owner]) {
        expect(erased).not.toContain(kept.id);
        expect((await user(kept.id)).telegram_id).toBe(kept.telegram);
      }
      expect(result.waiting).toBeGreaterThanOrEqual(1);
      expect(result.nextDueAt).not.toBeNull();
    });

    it("counts departure from the last membership to end, by term or removal", async () => {
      const byTerm = await member([{ endedByTermDaysAgo: 95 }]);
      const lastEndedRecently = await member([
        { revokedDaysAgo: 200 },
        { endedByTermDaysAgo: 30 },
      ]);
      const result = await run(true);
      const erased = result.erased.map((e) => e.userId);
      expect(erased).toContain(byTerm.id);
      expect(erased).not.toContain(lastEndedRecently.id);
      const departed = (
        await db.query(
          "SELECT departed_at, erased_at - departed_at >= interval '95 days' - interval '1 minute' AS old FROM impuls.member_erasures WHERE user_id=$1",
          [byTerm.id],
        )
      ).rows[0];
      expect(departed.old).toBe(true);
    });

    it("is idempotent and an erased account cannot come back; the person returns as a new account", async () => {
      const gone = await member([{ revokedDaysAgo: 100 }]);
      await run(true);
      expect((await run(true)).erased.map((e) => e.userId)).not.toContain(
        gone.id,
      );
      expect(
        await count(
          "SELECT count(*) n FROM impuls.member_erasures WHERE user_id=$1",
          [gone.id],
        ),
      ).toBe(1);
      await expect(
        db.query("UPDATE impuls.users SET active=true WHERE id=$1", [gone.id]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.query(
          "UPDATE impuls.users SET display_name='Вернулся' WHERE id=$1",
          [gone.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await db.query(
        "INSERT INTO impuls.users(telegram_id,display_name,active) VALUES($1,'Вернулся',true)",
        [gone.telegram],
      );
    });

    it("keeps erasure evidence and the name history of other accounts immutable", async () => {
      const gone = await member([{ revokedDaysAgo: 100 }]);
      const stays = await member([], true);
      await db.query(
        "INSERT INTO impuls.profile_name_changes(user_id,previous_name,new_name,request_id) VALUES($1,'Было','Стало',$2)",
        [stays.id, randomUUID()],
      );
      await run(true);
      await expect(
        db.query("DELETE FROM impuls.member_erasures WHERE user_id=$1", [
          gone.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.query("UPDATE impuls.member_erasures SET sessions_deleted=0"),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.query("DELETE FROM impuls.profile_name_changes WHERE user_id=$1", [
          stays.id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("gives the application role no way to run or read the erasure", async () => {
      await expect(
        app.query("SELECT * FROM impuls.erase_departed_members(1)"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("SELECT * FROM impuls.member_departures()"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query("SELECT * FROM impuls.member_erasures"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("rejects a limit outside 1-1000", async () => {
      await expect(run(true, 0)).rejects.toThrow(/limit/);
      await expect(
        db.query("SELECT * FROM impuls.erase_departed_members(5000)"),
      ).rejects.toMatchObject({ code: "22023" });
    });
  },
);
