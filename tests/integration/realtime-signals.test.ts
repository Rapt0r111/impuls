import { randomInt, randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

// Расширения Realtime в обычном PostgreSQL нет: тест подставляет функцию realtime.send,
// которая записывает вызовы, и проверяет, какие темы и когда получают сигнал.
integration("мгновенные сигналы об изменениях (ADR-0038)", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const runtime = new Pool({
    connectionString: databaseUrl,
    options: "-c role=impuls_app",
  });
  const users = { a: "", b: "", inactive: "" };
  const topics = { a: "", b: "", inactive: "" };
  let scopeId = "";
  let rulesId = "";
  const taskIds: string[] = [];
  let stubbed = false;

  const sent = async () =>
    (
      await admin.query<{ topic: string; payload: { kind: string } }>(
        "SELECT topic, payload FROM realtime.signal_capture WHERE topic = ANY($1::text[]) ORDER BY id",
        [Object.values(topics)],
      )
    ).rows;
  const clear = () => admin.query("TRUNCATE realtime.signal_capture");
  const insertTask = async () => {
    const id = randomUUID();
    taskIds.push(id);
    await admin.query(
      `INSERT INTO impuls.tasks (id, scope_id, rule_set_id, created_by, title, criteria, category_code, priority, status, due_at, fund_xp, fund_points)
       VALUES ($1, $2, $3, $4, 'Synthetic signal task', 'Synthetic criteria', 'test', 'normal', 'draft', now() + interval '1 day', 10, 5)`,
      [id, scopeId, rulesId, users.a],
    );
    return id;
  };

  beforeAll(async () => {
    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      users[key] = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, $3) RETURNING id",
          [
            randomInt(7_000_000_000_000, 8_000_000_000_000),
            `Synthetic signal ${key}`,
            key !== "inactive",
          ],
        )
      ).rows[0]!.id;
      topics[key] = (
        await runtime.query<{ t: string }>(
          "SELECT impuls.realtime_topic($1) AS t",
          [users[key]],
        )
      ).rows[0]!.t;
    }
    scopeId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.access_scopes (kind, name) VALUES ('group', 'Synthetic signal scope') RETURNING id",
      )
    ).rows[0]!.id;
    rulesId = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by) VALUES ($1, '{}', now(), $2) RETURNING id",
        [randomInt(1_000_000, 2_000_000_000), users.a],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (stubbed) await admin.query("DROP SCHEMA realtime CASCADE");
      await admin.query(
        "DELETE FROM impuls.task_events WHERE task_id = ANY($1::uuid[])",
        [taskIds],
      );
      await admin.query("DELETE FROM impuls.tasks WHERE id = ANY($1::uuid[])", [
        taskIds,
      ]);
      await admin.query("DELETE FROM impuls.rule_sets WHERE id = $1", [
        rulesId,
      ]);
      await admin.query("DELETE FROM impuls.access_scopes WHERE id = $1", [
        scopeId,
      ]);
      const ids = Object.values(users);
      await admin.query(
        "DELETE FROM impuls.account_balances WHERE user_id = ANY($1::uuid[])",
        [ids],
      );
      await admin.query("DELETE FROM impuls.users WHERE id = ANY($1::uuid[])", [
        ids,
      ]);
    } finally {
      await Promise.all([runtime.end(), admin.end()]);
    }
  });

  it("тема стабильна, различна у участников и не выводится из их id", () => {
    expect(topics.a).toMatch(/^impuls-[0-9a-f]{64}$/);
    expect(topics.a).not.toBe(topics.b);
    const naive = `impuls-${createHash("sha256").update(users.a).digest("hex")}`;
    expect(topics.a).not.toBe(naive);
  });

  it("без расширения Realtime запись проходит, сигналов нет", async () => {
    const exists = await admin.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = 'realtime'",
    );
    if (exists.rowCount) return; // настоящий Supabase: сигналы проверяются на нём
    await expect(insertTask()).resolves.toBeTypeOf("string");
    await expect(
      admin.query("INSERT INTO impuls.account_balances (user_id) VALUES ($1)", [
        users.a,
      ]),
    ).resolves.toBeDefined();
    await admin.query(
      "DELETE FROM impuls.account_balances WHERE user_id = $1",
      [users.a],
    );
  });

  it("рабочая роль получает тему, но не секрет и не отправку сигналов", async () => {
    await expect(
      runtime.query("SELECT secret FROM impuls.realtime_secret"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime.query("SELECT impuls.realtime_signal(ARRAY[$1::uuid], 'x')", [
        users.a,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime.query("SELECT impuls.realtime_on_change()"),
    ).rejects.toThrow(/permission denied/);
  });

  describe("с расширением Realtime", () => {
    beforeAll(async () => {
      const exists = await admin.query(
        "SELECT 1 FROM pg_namespace WHERE nspname = 'realtime'",
      );
      if (exists.rowCount)
        throw new Error(
          "realtime уже существует: тест рассчитан на обычный PostgreSQL",
        );
      stubbed = true;
      await admin.query(`
        CREATE SCHEMA realtime;
        CREATE TABLE realtime.signal_capture (id bigserial PRIMARY KEY, payload jsonb, event text, topic text, is_private boolean);
        CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
          LANGUAGE sql AS $$ INSERT INTO realtime.signal_capture (payload, event, topic, is_private) VALUES (payload, event, topic, private) $$;
      `);
    });

    it("запись баланса сигналит только владельцу, на публичную тему без данных", async () => {
      await clear();
      await admin.query(
        "INSERT INTO impuls.account_balances (user_id) VALUES ($1)",
        [users.a],
      );
      expect(await sent()).toEqual([
        { topic: topics.a, payload: { kind: "ledger" } },
      ]);
      const row = (
        await admin.query(
          "SELECT event, is_private FROM realtime.signal_capture",
        )
      ).rows[0];
      expect(row).toEqual({ event: "change", is_private: false });
    });

    it("новая и изменённая задача сигналит всем активным, неактивным нет", async () => {
      await clear();
      const id = await insertTask();
      await admin.query(
        "UPDATE impuls.tasks SET status = 'assigned', version = version + 1 WHERE id = $1",
        [id],
      );
      const seen = await sent();
      expect(seen.filter((s) => s.topic === topics.a)).toHaveLength(2);
      expect(seen.filter((s) => s.topic === topics.b)).toHaveLength(2);
      expect(seen.some((s) => s.topic === topics.inactive)).toBe(false);
      expect(seen.every((s) => s.payload.kind === "tasks")).toBe(true);
    });

    it("откат транзакции не оставляет сигналов", async () => {
      await clear();
      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE impuls.account_balances SET lifetime_xp = 5, version = version + 1 WHERE user_id = $1",
          [users.a],
        );
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      expect(await sent()).toEqual([]);
    });

    it("сбой доставки не отменяет бизнес-запись", async () => {
      await admin.query(`
        CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'realtime unavailable'; END $$;
      `);
      await expect(
        admin.query(
          "UPDATE impuls.account_balances SET lifetime_xp = 7, version = version + 1 WHERE user_id = $1",
          [users.a],
        ),
      ).resolves.toBeDefined();
      const { rows } = await admin.query(
        "SELECT lifetime_xp FROM impuls.account_balances WHERE user_id = $1",
        [users.a],
      );
      expect(Number(rows[0].lifetime_xp)).toBe(7);
    });
  });
});
