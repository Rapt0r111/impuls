import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimNotificationSimulation as claim,
  enqueueTaskDueReminders,
  processNotificationSimulation as processClaim,
  type SimulationTransport,
} from "../../packages/domain/src/notifications/simulation";

const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url),
  run = promisify(execFile);
const HOUR = "interval '1 hour'";

(url ? describe : describe.skip)("F08 task due-date reminders", () => {
  const name = `impuls_reminders_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url || "postgres://localhost/test");
  parsed.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url }),
    db = new Pool({ connectionString: parsed.toString() });
  const worker = new Pool({
    connectionString: parsed.toString(),
    options: "-c role=impuls_worker",
    max: 4,
  });
  const app = new Pool({
    connectionString: parsed.toString(),
    options: "-c role=impuls_app",
  });
  const author = randomUUID(),
    scope = randomUUID(),
    rule = randomUUID();
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
  // Creates an assignee and a task due in `hours` (may be negative) with the given status.
  async function task(status: string, hours: number, active = true) {
    const user = randomUUID(),
      id = randomUUID();
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'PRIVATE NAME',$3)",
      [user, String(++chat), active],
    );
    await db.query(
      `INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points)
      VALUES($1,$2,$3,$4,'PRIVATE TITLE DO NOT SEND','PRIVATE CRITERIA','test','normal',$5,
        clock_timestamp()+$6*${HOUR},7,3)`,
      [id, scope, rule, author, status, hours],
    );
    await db.query(
      "INSERT INTO impuls.task_assignments(task_id,user_id) VALUES($1,$2)",
      [id, user],
    );
    return { id, user };
  }
  const reminders = async () =>
    (
      await db.query(
        "SELECT task_id,recipient_id,kind,mode,status FROM impuls.notification_outbox WHERE kind='task.due_soon' ORDER BY created_at,id",
      )
    ).rows;

  beforeAll(async () => {
    if (!/^impuls_reminders_[0-9a-f]{32}$/.test(name))
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
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,'77777779999','Author',true)",
      [author],
    );
    await db.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic reminder scope')",
      [scope],
    );
    await db.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,1,'{}',now(),$2)",
      [rule, author],
    );
  }, 30000);
  beforeEach(async () => {
    await db.query(
      "TRUNCATE impuls.notification_simulation_events,impuls.notification_simulations,impuls.notification_outbox",
    );
    await db.query("DELETE FROM impuls.task_assignments");
    await db.query("DELETE FROM impuls.tasks");
  });
  afterAll(async () => {
    await Promise.all([worker.end(), app.end(), db.end()]);
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("queues one reminder per open assigned task due within 24 hours", async () => {
    const open = [
      await task("assigned", 2),
      await task("in_progress", 23),
      await task("needs_work", 1),
    ];
    await task("assigned", 25); // outside the window
    await task("assigned", -1); // already overdue
    for (const status of ["draft", "in_review", "accepted", "cancelled"])
      await task(status, 2); // not waiting on the assignee
    await task("assigned", 2, false); // revoked assignee

    expect(await enqueueTaskDueReminders(worker, true)).toBe(3);
    const rows = await reminders();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.task_id).sort()).toEqual(
      open.map((t) => t.id).sort(),
    );
    for (const row of rows) {
      expect(row).toMatchObject({ mode: "synthetic", status: "pending" });
      expect(row.recipient_id).toBe(
        open.find((t) => t.id === row.task_id)!.user,
      );
    }
  });

  it("is idempotent and does not repeat a reminder after delivery", async () => {
    const { id } = await task("assigned", 3);
    expect(await enqueueTaskDueReminders(worker, true)).toBe(1);
    expect(await enqueueTaskDueReminders(worker, true)).toBe(0);
    const delivered: SimulationTransport = async () => "delivered";
    expect(
      await processClaim(
        worker,
        (await claim(worker, true))!,
        delivered,
        true,
        "telegram",
      ),
    ).toBe("delivered");
    expect(await enqueueTaskDueReminders(worker, true)).toBe(0);
    expect(await reminders()).toHaveLength(1);
    expect((await reminders())[0]!.task_id).toBe(id);
  });

  it("does not starve later tasks behind already-reminded ones", async () => {
    for (let i = 0; i < 55; i++) await task("assigned", 1 + (i % 20));
    expect(await enqueueTaskDueReminders(worker, true)).toBe(50);
    expect(await enqueueTaskDueReminders(worker, true)).toBe(5);
    expect(await enqueueTaskDueReminders(worker, true)).toBe(0);
    expect(await reminders()).toHaveLength(55);
  });

  it("is a no-op while disabled", async () => {
    await task("assigned", 2);
    expect(await enqueueTaskDueReminders(worker, false)).toBe(0);
    expect(await reminders()).toHaveLength(0);
  });

  it("sends fixed neutral text and changes no balances or task state", async () => {
    const { user, id } = await task("in_progress", 4);
    await db.query(
      "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points,reserved_points) VALUES($1,100,50,0)",
      [user],
    );
    const before = (
      await db.query(
        "SELECT (SELECT jsonb_agg(b ORDER BY user_id) FROM impuls.account_balances b) balances,(SELECT status||version FROM impuls.tasks WHERE id=$1) task",
        [id],
      )
    ).rows[0];
    await enqueueTaskDueReminders(worker, true);
    const seen: Parameters<SimulationTransport>[0][] = [];
    await processClaim(
      worker,
      (await claim(worker, true))!,
      async (message) => {
        seen.push(message);
        return "delivered";
      },
      true,
      "telegram",
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      recipientId: user,
      text: "В приложении приближается срок задачи.",
    });
    expect(seen[0]!.text).not.toMatch(/PRIVATE|DO NOT SEND/);
    expect(
      (
        await db.query(
          "SELECT (SELECT jsonb_agg(b ORDER BY user_id) FROM impuls.account_balances b) balances,(SELECT status||version FROM impuls.tasks WHERE id=$1) task",
          [id],
        )
      ).rows[0],
    ).toEqual(before);
  });

  it("suppresses delivery if the assignee is revoked after queueing", async () => {
    const { user } = await task("assigned", 2);
    await enqueueTaskDueReminders(worker, true);
    await db.query("UPDATE impuls.users SET active=false WHERE id=$1", [user]);
    let sent = 0;
    expect(
      await processClaim(
        worker,
        (await claim(worker, true))!,
        async () => (sent++, "delivered"),
        true,
        "telegram",
      ),
    ).toBe("suppressed");
    expect(sent).toBe(0);
  });

  it("keeps the producer out of reach of the application role", async () => {
    await expect(
      app.query("SELECT impuls.enqueue_task_due_reminders()"),
    ).rejects.toMatchObject({ code: "42501" });
    await task("assigned", 2);
    await expect(
      worker.query(
        "INSERT INTO impuls.notification_outbox(recipient_id,task_id,kind,mode,created_at,updated_at) SELECT user_id,task_id,'task.due_soon','synthetic',now(),now() FROM impuls.task_assignments",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects a reminder bound to a review instead of a task", async () => {
    const { user } = await task("assigned", 2);
    await expect(
      db.query(
        "INSERT INTO impuls.notification_outbox(recipient_id,kind,mode,created_at,updated_at) VALUES($1,'task.due_soon','synthetic',now(),now())",
        [user],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  describe("built worker", () => {
    const runWorker = async (flag: string) => {
      const workerUrl = new URL(parsed);
      workerUrl.searchParams.set("options", "-c role=impuls_worker");
      const { stdout } = await run(
        process.execPath,
        [path.resolve("apps/worker/dist/index.mjs"), "--once"],
        {
          env: {
            ...process.env,
            TELEGRAM_DELIVERY_ENABLED: "",
            TELEGRAM_BOT_TOKEN: "",
            SYNTHETIC_NOTIFICATIONS_ENABLED: "true",
            TASK_REMINDERS_ENABLED: flag,
            WORKER_DATABASE_URL: workerUrl.toString(),
          },
          timeout: 20000,
          windowsHide: true,
        },
      );
      return stdout;
    };

    it("queues and simulates a reminder only with the reminder flag", async () => {
      await task("assigned", 2);
      expect(await runWorker("")).not.toMatch(/simulated/);
      expect(await reminders()).toHaveLength(0);
      expect(await runWorker("true")).toMatch(/"simulated":1/);
      const [row] = await reminders();
      expect(row).toMatchObject({ kind: "task.due_soon" });
      expect(
        (
          await db.query(
            "SELECT status FROM impuls.notification_simulations WHERE outbox_id=(SELECT id FROM impuls.notification_outbox WHERE kind='task.due_soon')",
          )
        ).rows,
      ).toEqual([{ status: "simulated" }]);
    });
  });
});
