import { dropDatabase } from "./drop-database";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  claimNotificationSimulation as claim,
  processNotificationSimulation as processClaim,
  readNotificationSimulationCounts,
  type NotificationClaim,
  type SimulationTransport,
} from "../../packages/domain/src/notifications/simulation";
import { runSimulationLoop } from "../../apps/worker/src/loop";

const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url),
  run = promisify(execFile);
(url ? describe : describe.skip)("F08 PostgreSQL simulation worker", () => {
  const name = `impuls_notifications_${randomUUID().replaceAll("-", "")}`;
  const parsed = new URL(url || "postgres://localhost/test");
  parsed.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url }),
    db = new Pool({ connectionString: parsed.toString() });
  const worker = new Pool({
    connectionString: parsed.toString(),
    options: "-c role=impuls_worker",
    max: 8,
  });
  const app = new Pool({
    connectionString: parsed.toString(),
    options: "-c role=impuls_app",
  });
  const user = randomUUID(),
    scope = randomUUID(),
    rule = randomUUID();
  let created = false,
    upgradePreserved = false;
  const transport: SimulationTransport = async () => "simulated";
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
  async function event() {
    const task = randomUUID(),
      id = randomUUID();
    await db.query(
      `INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points)
      VALUES($1,$2,$3,$4,'PRIVATE TITLE DO NOT SEND','PRIVATE CRITERIA','test','normal','draft','2035-01-01',7,3)`,
      [task, scope, rule, user],
    );
    await db.query(
      `INSERT INTO impuls.notification_outbox(id,recipient_id,task_id,kind,mode,created_at,updated_at)
      VALUES($1,$2,$3,'task.assigned','synthetic',clock_timestamp(),clock_timestamp())`,
      [id, user, task],
    );
    return id;
  }
  async function saved(id: string) {
    return (
      await db.query(
        "SELECT *,extract(epoch FROM next_attempt_at-updated_at)::int delay FROM impuls.notification_simulations WHERE outbox_id=$1",
        [id],
      )
    ).rows[0];
  }
  async function journal(id: string) {
    return (
      await db.query(
        "SELECT attempt,phase,error_code FROM impuls.notification_simulation_events WHERE outbox_id=$1 ORDER BY recorded_at,id",
        [id],
      )
    ).rows;
  }
  async function take(): Promise<NotificationClaim> {
    const value = await claim(worker, true);
    expect(value).not.toBeNull();
    return value!;
  }
  async function cli(args: string[], env: Record<string, string> = {}) {
    const workerUrl = new URL(parsed);
    workerUrl.searchParams.set("options", "-c role=impuls_worker");
    return run(
      process.execPath,
      [path.resolve("apps/worker/dist/index.mjs"), ...args],
      {
        env: {
          ...process.env,
          SYNTHETIC_NOTIFICATIONS_ENABLED: "true",
          WORKER_DATABASE_URL: workerUrl.toString(),
          ...env,
        },
        windowsHide: true,
      },
    );
  }
  function watch(env: Record<string, string> = {}) {
    const workerUrl = new URL(parsed);
    workerUrl.searchParams.set("options", "-c role=impuls_worker");
    const child = spawn(
      process.execPath,
      [path.resolve("apps/worker/dist/index.mjs"), "--watch"],
      {
        env: {
          ...process.env,
          SYNTHETIC_NOTIFICATIONS_ENABLED: "true",
          WORKER_DATABASE_URL: workerUrl.toString(),
          WORKER_POLL_INTERVAL_MS: "1000",
          ...env,
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = new Promise<{
      code: number | null;
      signal: string | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve({ code, signal, stdout, stderr }),
      );
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 15000);
    deadline.unref();
    void closed.then(
      () => clearTimeout(deadline),
      () => clearTimeout(deadline),
    );
    return { child, closed, output: () => stdout };
  }
  beforeAll(async () => {
    if (!/^impuls_notifications_[0-9a-f]{32}$/.test(name))
      throw new Error("Invalid disposable DB name");
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await db.query(
      "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
    );
    for (const f of (await readdir("db/migrations"))
      .filter((f) => f.endsWith(".js") && f < "000021")
      .sort())
      await migrate(f);
    await db.query(
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,88888888881,'PRIVATE NAME',true)",
      [user],
    );
    await db.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic notification scope')",
      [scope],
    );
    await db.query(
      "INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by) VALUES($1,1,'{}',now(),$2)",
      [rule, user],
    );
    await db.query(
      "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points,reserved_points) VALUES($1,100,50,0)",
      [user],
    );
    const id = await event();
    const before = (
      await db.query(
        "SELECT row_to_json(o) value FROM impuls.notification_outbox o WHERE id=$1",
        [id],
      )
    ).rows[0].value;
    await migrate("000021_notification_simulations.js");
    const after = (
      await db.query(
        "SELECT row_to_json(o) value FROM impuls.notification_outbox o WHERE id=$1",
        [id],
      )
    ).rows[0].value;
    await db.query(
      "INSERT INTO impuls.notification_simulations(outbox_id,status,attempts,completed_at) VALUES($1,'simulated',1,clock_timestamp())",
      [id],
    );
    const activeId = await event(),
      legacyClaim = await take(),
      readyId = await event();
    await db.query(
      "INSERT INTO impuls.notification_simulations(outbox_id) VALUES($1)",
      [readyId],
    );
    const legacy = (
      await db.query(
        "SELECT * FROM impuls.notification_simulations ORDER BY outbox_id",
      )
    ).rows;
    await migrate("000023_notification_attempt_journal.js");
    expect(
      (
        await db.query(
          "SELECT * FROM impuls.notification_simulations ORDER BY outbox_id",
        )
      ).rows,
    ).toEqual(legacy);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM impuls.notification_simulation_events",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await processClaim(worker, legacyClaim, transport, true)).toBe(
      "simulated",
    );
    expect(await journal(activeId)).toEqual([
      { attempt: 1, phase: "simulated", error_code: null },
    ]);
    upgradePreserved = JSON.stringify(before) === JSON.stringify(after);
  }, 20000);
  beforeEach(async () => {
    // Only the verified disposable database is modified; configured DB records are never consumed.
    await db.query(
      "TRUNCATE impuls.notification_simulation_events,impuls.notification_simulations,impuls.notification_outbox",
    );
    await db.query("UPDATE impuls.users SET active=true WHERE id=$1", [user]);
  });
  afterAll(async () => {
    await Promise.all([worker.end(), app.end(), db.end()]);
    try {
      if (created) await dropDatabase(admin, name);
    } finally {
      await admin.end();
    }
  });
  it("upgrades without changing outbox or finances; keeps private ACLs and history", async () => {
    expect(upgradePreserved).toBe(true);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM impuls.notification_simulations",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT lifetime_xp,available_points,reserved_points FROM impuls.account_balances WHERE user_id=$1",
          [user],
        )
      ).rows[0],
    ).toEqual({
      lifetime_xp: "100",
      available_points: "50",
      reserved_points: "0",
    });
    expect(
      (await db.query("SELECT count(*)::int n FROM impuls.role_bindings"))
        .rows[0].n,
    ).toBe(0);
    expect(() =>
      require(
        path.resolve("db/migrations/000021_notification_simulations.js"),
      ).down(),
    ).toThrow("Keep notification simulation history");
    for (const role of ["public", "impuls_app"]) {
      expect(
        (
          await db.query(
            "SELECT has_function_privilege($1,'impuls.lock_notification_recipient(uuid)','EXECUTE') allowed",
            [role],
          )
        ).rows[0].allowed,
      ).toBe(false);
    }
    expect(
      (
        await db.query(
          "SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='impuls_worker'",
        )
      ).rows[0],
    ).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
  });
  it("worker cannot read identity/source content or write business records; app cannot process queue", async () => {
    for (const sql of [
      "SELECT telegram_id FROM impuls.users",
      "SELECT title FROM impuls.tasks",
      "SELECT * FROM impuls.sessions",
      "SELECT * FROM impuls.account_balances",
      "UPDATE impuls.notification_outbox SET status='sent'",
      "UPDATE impuls.users SET active=false",
      "DELETE FROM impuls.notification_simulations",
      "INSERT INTO impuls.notification_outbox(recipient_id) VALUES(gen_random_uuid())",
    ])
      await expect(worker.query(sql)).rejects.toMatchObject({ code: "42501" });
    await expect(
      app.query("SELECT * FROM impuls.notification_simulations"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      app.query("SELECT impuls.lock_notification_recipient($1)", [user]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("keeps the journal append-only and private, with only app SELECT and no callable definer", async () => {
    const id = await event();
    const lease = await take();
    expect(await processClaim(worker, lease, transport, true)).toBe(
      "simulated",
    );
    for (const pool of [worker, app])
      for (const sql of [
        "INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase) VALUES($1,1,'started')",
        "UPDATE impuls.notification_simulation_events SET phase='started' WHERE outbox_id=$1",
        "DELETE FROM impuls.notification_simulation_events WHERE outbox_id=$1",
      ])
        await expect(pool.query(sql, [id])).rejects.toMatchObject({
          code: "42501",
        });
    for (const pool of [worker, app])
      await expect(
        pool.query("TRUNCATE impuls.notification_simulation_events"),
      ).rejects.toMatchObject({ code: "42501" });
    await expect(
      worker.query("SELECT * FROM impuls.notification_simulation_events"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (await app.query("SELECT * FROM impuls.notification_simulation_events"))
        .rowCount,
    ).toBe(2);
    for (const sql of [
      "UPDATE impuls.notification_simulation_events SET phase='started'",
      "DELETE FROM impuls.notification_simulation_events",
    ])
      await expect(db.query(sql)).rejects.toMatchObject({ code: "23514" });
    for (const role of ["public", "impuls_app", "impuls_worker"])
      expect(
        (
          await db.query(
            "SELECT has_function_privilege($1,'impuls.record_notification_simulation_transition()','EXECUTE') allowed",
            [role],
          )
        ).rows[0].allowed,
      ).toBe(false);
    expect(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='impuls.notification_simulation_events'::regclass",
        )
      ).rows[0].relrowsecurity,
    ).toBe(true);
    expect(() =>
      require(
        path.resolve("db/migrations/000023_notification_attempt_journal.js"),
      ).down(),
    ).toThrow("Keep notification attempt history");
  });
  it("journals only committed transitions, including rollback after the history trigger ran", async () => {
    const id = await event(),
      lease = await take();
    await db.query(`CREATE FUNCTION impuls.test_journal_after_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='simulated' THEN RAISE EXCEPTION 'synthetic after failure'; END IF; RETURN NULL; END $$;
      CREATE TRIGGER zz_test_journal_after_failure AFTER UPDATE ON impuls.notification_simulations FOR EACH ROW EXECUTE FUNCTION impuls.test_journal_after_failure()`);
    try {
      await expect(
        processClaim(worker, lease, transport, true),
      ).rejects.toThrow("synthetic after failure");
      expect((await journal(id)).map((row) => row.phase)).toEqual(["started"]);
      expect((await saved(id)).status).toBe("processing");
    } finally {
      await db.query(
        "DROP TRIGGER zz_test_journal_after_failure ON impuls.notification_simulations; DROP FUNCTION impuls.test_journal_after_failure()",
      );
    }
    expect(await processClaim(worker, lease, transport, true)).toBe(
      "simulated",
    );
    expect((await journal(id)).map((row) => row.phase)).toEqual([
      "started",
      "simulated",
    ]);
  });
  it("records lease recovery and fifth exhaustion once without inventing a transport outcome", async () => {
    const id = await event();
    let old: NotificationClaim | undefined;
    for (let n = 1; n <= 5; n++) {
      const lease = await take();
      if (old)
        expect(await processClaim(worker, old, transport, true)).toBe("lost");
      old = lease;
      await db.query(
        "UPDATE impuls.notification_simulations SET lease_until=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",
        [id],
      );
    }
    expect(await claim(worker, true)).toBeNull();
    expect(await journal(id)).toEqual([
      ...Array.from({ length: 5 }, (_, n) => [
        { attempt: n + 1, phase: "started", error_code: null },
        { attempt: n + 1, phase: "lease_expired", error_code: null },
      ]).flat(),
      { attempt: 5, phase: "failed", error_code: "attempts_exhausted" },
    ]);
    const before = await journal(id);
    expect(await claim(worker, true)).toBeNull();
    expect(await processClaim(worker, old!, transport, true)).toBe("lost");
    expect(await journal(id)).toEqual(before);
  });
  it("disabled mode opens no connection and invokes no transport", async () => {
    const unavailable = new Pool({
      connectionString: "postgres://localhost:1/nope",
      connectionTimeoutMillis: 100,
    });
    try {
      expect(await claim(unavailable, false)).toBeNull();
      const sink = vi.fn(transport);
      expect(
        await processClaim(
          unavailable,
          { outboxId: randomUUID(), token: randomUUID() },
          sink,
          false,
        ),
      ).toBe("lost");
      expect(sink).not.toHaveBeenCalled();
    } finally {
      await unavailable.end();
    }
  });
  it("simulates once, uses neutral text, leaves original pending and balances unchanged", async () => {
    const id = await event(),
      lease = await take(),
      sink = vi.fn(transport);
    expect(lease.outboxId).toBe(id);
    expect(await processClaim(worker, lease, sink, true)).toBe("simulated");
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]![0]).toMatchObject({
      eventId: id,
      recipientId: user,
      text: "В приложении назначена задача.",
    });
    expect(await processClaim(worker, lease, sink, true)).toBe("lost");
    expect(await claim(worker, true)).toBeNull();
    expect((await saved(id)).attempts).toBe(1);
    expect(await journal(id)).toEqual([
      { attempt: 1, phase: "started", error_code: null },
      { attempt: 1, phase: "simulated", error_code: null },
    ]);
    await expect(
      worker.query(
        "UPDATE impuls.notification_simulations SET status='ready',completed_at=NULL WHERE outbox_id=$1",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await db.query(
          "SELECT status,attempts,version FROM impuls.notification_outbox WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ status: "pending", attempts: 0, version: 1 });
    expect(
      (await db.query("SELECT count(*)::int n FROM impuls.ledger_entries"))
        .rows[0].n,
    ).toBe(0);
  });
  it("parallel claimers obtain distinct events and processing cannot steal an unexpired lease", async () => {
    const ids = await Promise.all([event(), event()]);
    const leases = await Promise.all([take(), take()]);
    expect(new Set(leases.map((x) => x.outboxId))).toEqual(new Set(ids));
    expect(await claim(worker, true)).toBeNull();
    expect(
      await Promise.all(
        leases.map((x) => processClaim(worker, x, transport, true)),
      ),
    ).toEqual(["simulated", "simulated"]);
  });
  it("competing processors call transport once for the same token", async () => {
    const id = await event();
    const lease = await take(),
      sink = vi.fn(transport);
    const results = await Promise.all([
      processClaim(worker, lease, sink, true),
      processClaim(worker, lease, sink, true),
    ]);
    expect(results.sort()).toEqual(["lost", "simulated"]);
    expect(sink).toHaveBeenCalledOnce();
    expect((await journal(id)).map((row) => row.phase)).toEqual([
      "started",
      "simulated",
    ]);
  });
  it("skips a locked due row while another event remains claimable", async () => {
    const first = await event(),
      second = await event();
    await db.query(
      "INSERT INTO impuls.notification_simulations(outbox_id) VALUES($1),($2)",
      [first, second],
    );
    const blocker = await db.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT outbox_id FROM impuls.notification_simulations WHERE outbox_id=$1 FOR UPDATE",
        [first],
      );
      expect((await take()).outboxId).toBe(second);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it("does not enroll nonpending outbox records", async () => {
    for (const status of ["sent", "failed", "suppressed"]) {
      const id = await event();
      await db.query(
        "UPDATE impuls.notification_outbox SET status=$2 WHERE id=$1",
        [id, status],
      );
    }
    expect(await claim(worker, true)).toBeNull();
    expect(await readNotificationSimulationCounts(worker)).toEqual([]);
  });
  it("rolls back a receipt persistence failure and preserves the lease for crash recovery", async () => {
    const id = await event(),
      lease = await take();
    await db.query(`CREATE FUNCTION impuls.test_simulation_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='simulated' THEN RAISE EXCEPTION 'synthetic persistence failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_simulation_write_failure BEFORE UPDATE ON impuls.notification_simulations
      FOR EACH ROW EXECUTE FUNCTION impuls.test_simulation_write_failure()`);
    try {
      await expect(
        processClaim(worker, lease, transport, true),
      ).rejects.toThrow("synthetic persistence failure");
      const row = await saved(id);
      expect(row.status).toBe("processing");
      expect(row.lease_token).toBe(lease.token);
      expect(row.completed_at).toBeNull();
      expect((await journal(id)).map((row) => row.phase)).toEqual(["started"]);
      expect(
        (
          await db.query(
            "SELECT status,version FROM impuls.notification_outbox WHERE id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ status: "pending", version: 1 });
    } finally {
      await db.query(
        "DROP TRIGGER test_simulation_write_failure ON impuls.notification_simulations; DROP FUNCTION impuls.test_simulation_write_failure()",
      );
    }
    expect(await processClaim(worker, lease, transport, true)).toBe(
      "simulated",
    );
  });
  it("backs off 30/60/120/240 seconds, caps at five attempts, and retains only safe error code", async () => {
    const id = await event();
    const sink: SimulationTransport = async () => {
      throw new Error("BOT_SECRET PRIVATE TITLE telegram_id=42");
    };
    for (let i = 1; i <= 5; i++) {
      const lease = await take();
      expect(await processClaim(worker, lease, sink, true)).toBe(
        i === 5 ? "failed" : "retry",
      );
      const row = await saved(id);
      expect(row.attempts).toBe(i);
      expect(row.error_code).toBe("transport_unavailable");
      expect(await journal(id)).toEqual(
        Array.from({ length: i }, (_, n) => [
          { attempt: n + 1, phase: "started", error_code: null },
          {
            attempt: n + 1,
            phase: n === 4 ? "failed" : "retry",
            error_code: "transport_unavailable",
          },
        ]).flat(),
      );
      expect(row.delay).toBe(30 * 2 ** (i - 1));
      expect(JSON.stringify(row)).not.toContain("BOT_SECRET");
      if (i < 5) {
        expect(await claim(worker, true)).toBeNull();
        await db.query(
          "UPDATE impuls.notification_simulations SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",
          [id],
        );
      }
    }
    expect(await claim(worker, true)).toBeNull();
  });
  it("recovers a crashed lease and rejects the old token", async () => {
    const id = await event(),
      old = await take();
    await db.query(
      "UPDATE impuls.notification_simulations SET lease_until=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",
      [id],
    );
    const current = await take(),
      sink = vi.fn(transport);
    expect(current.token).not.toBe(old.token);
    expect(await processClaim(worker, old, sink, true)).toBe("lost");
    expect(sink).not.toHaveBeenCalled();
    expect(await processClaim(worker, current, sink, true)).toBe("simulated");
    expect((await saved(id)).attempts).toBe(2);
  });
  it("exhausted crashed events do not starve healthy events", async () => {
    const id = await event();
    await take();
    await db.query(
      "UPDATE impuls.notification_simulations SET attempts=5,lease_until=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",
      [id],
    );
    const healthy = await event(),
      lease = await take();
    expect(lease.outboxId).toBe(healthy);
    expect((await saved(id)).status).toBe("failed");
    expect((await saved(id)).error_code).toBe("attempts_exhausted");
  });
  it("revocation after claim suppresses transport; reactivation never resurrects suppressed event", async () => {
    const id = await event(),
      lease = await take(),
      sink = vi.fn(transport);
    await db.query("UPDATE impuls.users SET active=false WHERE id=$1", [user]);
    expect(await processClaim(worker, lease, sink, true)).toBe("suppressed");
    expect(sink).not.toHaveBeenCalled();
    expect((await saved(id)).error_code).toBe("recipient_inactive");
    expect(await journal(id)).toEqual([
      { attempt: 1, phase: "started", error_code: null },
      { attempt: 1, phase: "suppressed", error_code: "recipient_inactive" },
    ]);
    await db.query("UPDATE impuls.users SET active=true WHERE id=$1", [user]);
    expect(await claim(worker, true)).toBeNull();
  });
  it("rechecks access after waiting for a concurrent revocation lock", async () => {
    await event();
    const lease = await take(),
      sink = vi.fn(transport),
      blocker = await db.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        user,
      ]);
      const pending = processClaim(worker, lease, sink, true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await blocker.query("COMMIT");
      expect(await pending).toBe("suppressed");
      expect(sink).not.toHaveBeenCalled();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it("locks active access through simulation completion, ordering subsequent revocation", async () => {
    await event();
    const lease = await take();
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = processClaim(
      worker,
      lease,
      async () => {
        started();
        await waiting;
        return "simulated";
      },
      true,
    );
    await entered;
    const blocker = await db.connect();
    try {
      await blocker.query("BEGIN; SET LOCAL lock_timeout='100ms'");
      await expect(
        blocker.query("UPDATE impuls.users SET active=false WHERE id=$1", [
          user,
        ]),
      ).rejects.toMatchObject({ code: "55P03" });
      await blocker.query("ROLLBACK");
    } finally {
      release();
      blocker.release();
    }
    expect(await pending).toBe("simulated");
  });
  it("bounds hung transport, records retry, and releases recipient lock", async () => {
    const id = await event(),
      lease = await take();
    expect(
      await processClaim(
        worker,
        lease,
        async () => new Promise(() => {}),
        true,
      ),
    ).toBe("retry");
    expect((await saved(id)).error_code).toBe("timeout");
    expect(await journal(id)).toEqual([
      { attempt: 1, phase: "started", error_code: null },
      { attempt: 1, phase: "retry", error_code: "timeout" },
    ]);
    await db.query("UPDATE impuls.users SET active=false WHERE id=$1", [user]);
  }, 10000);
  it("a stale lease cannot persist receipt even if time crosses during the recipient lock wait", async () => {
    const id = await event(),
      lease = await take();
    await db.query(
      "UPDATE impuls.notification_simulations SET lease_until=clock_timestamp()+interval '100 milliseconds' WHERE outbox_id=$1",
      [id],
    );
    const blocker = await db.connect(),
      sink = vi.fn(transport);
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM impuls.users WHERE id=$1 FOR UPDATE",
        [user],
      );
      const pending = processClaim(worker, lease, sink, true);
      await new Promise((resolve) => setTimeout(resolve, 160));
      await blocker.query("COMMIT");
      expect(await pending).toBe("lost");
      expect(sink).not.toHaveBeenCalled();
      expect((await saved(id)).status).toBe("processing");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it("Node entry point defaults off, requires dedicated role, hides invalid config, bounds a batch at 20", async () => {
    expect(
      JSON.parse(
        (
          await cli(["--once"], {
            SYNTHETIC_NOTIFICATIONS_ENABLED: "false",
            WORKER_DATABASE_URL: "INVALID SECRET",
          })
        ).stdout,
      ),
    ).toEqual({ mode: "simulation", status: "disabled" });
    await expect(
      cli(["--once"], { WORKER_DATABASE_URL: parsed.toString() }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("WORKER_UNAVAILABLE"),
    });
    await expect(
      cli(["--once"], { WORKER_DATABASE_URL: "INVALID SECRET" }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.not.stringContaining("INVALID SECRET"),
    });
    for (let i = 0; i < 22; i++) await event();
    expect(JSON.parse((await cli(["--once"])).stdout)).toEqual({
      mode: "simulation",
      results: { simulated: 20 },
    });
    expect(await readNotificationSimulationCounts(worker)).toEqual([
      { status: "ready", count: 2 },
      { status: "simulated", count: 20 },
    ]);
    const status = JSON.parse((await cli(["--status"])).stdout);
    expect(status).toEqual({
      mode: "simulation",
      counts: [
        { status: "ready", count: 2 },
        { status: "simulated", count: 20 },
      ],
    });
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM impuls.notification_outbox WHERE status='pending' AND attempts=0",
        )
      ).rows[0].n,
    ).toBe(22);
  });
  it("watch is disabled without any connection and rejects unsafe intervals without leaking config", async () => {
    expect(
      JSON.parse(
        (
          await cli(["--watch"], {
            SYNTHETIC_NOTIFICATIONS_ENABLED: "false",
            WORKER_DATABASE_URL: "PRIVATE URL",
            WORKER_POLL_INTERVAL_MS: "invalid",
          })
        ).stdout,
      ),
    ).toEqual({ mode: "simulation", status: "disabled" });
    await expect(
      cli(["--watch"], {
        WORKER_POLL_INTERVAL_MS: "999",
        WORKER_DATABASE_URL: "PRIVATE URL",
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("WORKER_UNAVAILABLE"),
    });
  });
  it("watch discovers new events after idle without restarting the Node process", async () => {
    const running = watch();
    try {
      await vi.waitFor(
        () => expect(running.output()).toContain('"status":"watching"'),
        { timeout: 5000 },
      );
      const id = await event();
      await vi.waitFor(
        async () => expect((await saved(id))?.status).toBe("simulated"),
        { timeout: 5000 },
      );
      const later = await event();
      await vi.waitFor(
        async () => expect((await saved(later))?.status).toBe("simulated"),
        { timeout: 5000 },
      );
      expect((await saved(id)).attempts).toBe(1);
      expect((await saved(later)).attempts).toBe(1);
      expect(running.output()).not.toMatch(/PRIVATE|88888888881/);
      expect(running.output()).not.toContain(id);
    } finally {
      running.child.kill("SIGKILL");
      await running.closed;
    }
  }, 15000);
  it("graceful stop drains the current PostgreSQL operation and does not claim the next event", async () => {
    const first = await event(),
      next = await event(),
      stop = new AbortController();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const running = runSimulationLoop({
      mode: "watch",
      signal: stop.signal,
      pollIntervalMs: 5000,
      claim: () => claim(worker, true),
      processClaim: (lease) =>
        processClaim(
          worker,
          lease,
          async () => {
            entered();
            await waiting;
            return "simulated";
          },
          true,
        ),
      report: () => {},
    });
    try {
      await started;
      stop.abort();
      expect((await saved(first)).status).toBe("processing");
      release();
      await running;
      expect((await saved(first)).status).toBe("simulated");
      expect((await saved(next)).status).toBe("ready");
      expect((await saved(next)).attempts).toBe(0);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM impuls.notification_outbox WHERE status='pending' AND attempts=0",
          )
        ).rows[0].n,
      ).toBe(2);
    } finally {
      stop.abort();
      release();
      await running;
    }
  });
  it("killed Node process leaves a recoverable lease; restart waits for expiry and preserves source state", async () => {
    const id = await event(),
      blocker = await db.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM impuls.users WHERE id=$1 FOR UPDATE", [
      user,
    ]);
    const running = watch();
    try {
      await vi.waitFor(
        async () => expect((await saved(id))?.status).toBe("processing"),
        { timeout: 5000 },
      );
      running.child.kill("SIGKILL");
      await running.closed;
      await blocker.query("ROLLBACK");
      expect(JSON.parse((await cli(["--once"])).stdout).results).toEqual({});
      expect((await saved(id)).attempts).toBe(1);
      await db.query(
        "UPDATE impuls.notification_simulations SET lease_until=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",
        [id],
      );
      expect(JSON.parse((await cli(["--once"])).stdout).results).toEqual({
        simulated: 1,
      });
      expect((await saved(id)).attempts).toBe(2);
      expect(
        (
          await db.query(
            "SELECT status,attempts,version FROM impuls.notification_outbox WHERE id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ status: "pending", attempts: 0, version: 1 });
    } finally {
      running.child.kill("SIGKILL");
      await running.closed;
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  }, 15000);
  it("watch neutralizes a checked-out client socket error during the recipient lock", async () => {
    const id = await event(),
      blocker = await db.connect();
    const workerUrl = new URL(parsed),
      applicationName = `busy_${randomUUID()}`;
    workerUrl.searchParams.set("options", "-c role=impuls_worker");
    workerUrl.searchParams.set("application_name", applicationName);
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM impuls.users WHERE id=$1 FOR UPDATE", [
      user,
    ]);
    const running = watch({ WORKER_DATABASE_URL: workerUrl.toString() });
    try {
      await vi.waitFor(
        async () =>
          expect(
            (
              await db.query(
                "SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                [applicationName],
              )
            ).rows[0].n,
          ).toBe(1),
        { timeout: 5000 },
      );
      await db.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1 AND datname=$2",
        [applicationName, name],
      );
      const result = await running.closed;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("WORKER_UNAVAILABLE");
      expect(result.stderr).not.toMatch(
        /Unhandled|ECONNRESET|PRIVATE|node:events|postgres:\/\//,
      );
      expect((await saved(id)).status).toBe("processing");
      expect((await journal(id)).map((row) => row.phase)).toEqual(["started"]);
    } finally {
      running.child.kill("SIGKILL");
      await running.closed;
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  }, 15000);
  it("watch exits on connection loss with a neutral error for an external supervisor", async () => {
    const workerUrl = new URL(parsed),
      applicationName = `watch_${randomUUID()}`;
    workerUrl.searchParams.set("options", "-c role=impuls_worker");
    workerUrl.searchParams.set("application_name", applicationName);
    const running = watch({ WORKER_DATABASE_URL: workerUrl.toString() });
    try {
      await vi.waitFor(
        () => expect(running.output()).toContain('"status":"watching"'),
        { timeout: 5000 },
      );
      await db.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1 AND datname=$2",
        [applicationName, name],
      );
      const result = await running.closed;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("WORKER_UNAVAILABLE");
      expect(result.stderr).not.toContain(applicationName);
      expect(result.stderr).not.toContain(workerUrl.toString());
    } finally {
      running.child.kill("SIGKILL");
      await running.closed;
    }
  }, 20000);
  it.skipIf(process.platform === "win32")(
    "Node watch handles POSIX SIGTERM during idle with exit 0",
    async () => {
      const running = watch({ WORKER_POLL_INTERVAL_MS: "60000" });
      try {
        await vi.waitFor(
          () => expect(running.output()).toContain('"status":"watching"'),
          { timeout: 5000 },
        );
        running.child.kill("SIGTERM");
        const result = await running.closed;
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('"status":"stopped"');
        expect(result.stderr).toBe("");
      } finally {
        running.child.kill("SIGKILL");
        await running.closed;
      }
    },
  );
});
