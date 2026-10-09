import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimNotificationSimulation as claim,
  NotificationTransportError,
  NotificationTransportFatal,
  processNotificationSimulation as processClaim,
  type SimulationTransport,
} from "../../packages/domain/src/notifications/simulation";
import { readNotificationStatus } from "../../packages/domain/src/notifications/status";
import { readNotificationAttempts } from "../../packages/domain/src/notifications/attempts";
import { notificationStatusResponseSchema } from "../../packages/contracts/src/notification-status";
import { notificationAttemptsResponseSchema } from "../../packages/contracts/src/notification-attempts";

const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url),
  run = promisify(execFile);
const CHAT = "88888888881";
const TOKEN = `123456789:${"A".repeat(35)}`;

(url ? describe : describe.skip)("F08 Telegram delivery", () => {
  const name = `impuls_delivery_${randomUUID().replaceAll("-", "")}`;
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
  const user = randomUUID(),
    scope = randomUUID(),
    rule = randomUUID();
  let created = false;
  const delivered: SimulationTransport = async () => "delivered";

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
  const take = async () => (await claim(worker, true))!;
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
  const deliver = async (transport: SimulationTransport) =>
    processClaim(worker, await take(), transport, true, "telegram");

  beforeAll(async () => {
    if (!/^impuls_delivery_[0-9a-f]{32}$/.test(name))
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
      "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'PRIVATE NAME',true)",
      [user, CHAT],
    );
    await db.query(
      "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic delivery scope')",
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
  }, 30000);
  beforeEach(async () => {
    await db.query(
      "TRUNCATE impuls.notification_simulation_events,impuls.notification_simulations,impuls.notification_outbox",
    );
    await db.query("UPDATE impuls.users SET active=true WHERE id=$1", [user]);
  });
  afterAll(async () => {
    await Promise.all([worker.end(), app.end(), db.end()]);
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("delivers fixed neutral text to the recipient's chat and changes nothing else", async () => {
    const id = await event();
    const seen: Parameters<SimulationTransport>[0][] = [];
    const balances = (await db.query("SELECT * FROM impuls.account_balances"))
      .rows;
    expect(
      await deliver(async (message) => {
        seen.push(message);
        return "delivered";
      }),
    ).toBe("delivered");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      eventId: id,
      recipientId: user,
      chatId: CHAT,
      text: "В приложении назначена задача.",
    });
    expect(JSON.stringify(seen[0]!.text)).not.toMatch(/PRIVATE|DO NOT SEND/);
    expect(await saved(id)).toMatchObject({
      status: "delivered",
      attempts: 1,
      error_code: null,
      lease_token: null,
    });
    expect((await saved(id)).completed_at).not.toBeNull();
    expect(await journal(id)).toEqual([
      { attempt: 1, phase: "started", error_code: null },
      { attempt: 1, phase: "delivered", error_code: null },
    ]);
    expect(
      (await db.query("SELECT status FROM impuls.notification_outbox")).rows,
    ).toEqual([{ status: "pending" }]);
    expect(
      (await db.query("SELECT * FROM impuls.account_balances")).rows,
    ).toEqual(balances);
    expect(
      (await db.query("SELECT count(*)::int n FROM impuls.ledger_entries"))
        .rows[0].n,
    ).toBe(0);
    // Terminal rows are never reopened.
    await expect(
      db.query(
        "UPDATE impuls.notification_simulations SET status='retry',completed_at=NULL WHERE outbox_id=$1",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps the Telegram ID out of simulation mode and away from other roles", async () => {
    await event();
    const seen: (string | null)[] = [];
    expect(
      await processClaim(
        worker,
        await take(),
        async ({ chatId }) => {
          seen.push(chatId);
          return "simulated";
        },
        true,
      ),
    ).toBe("simulated");
    expect(seen).toEqual([null]);
    await expect(
      worker.query("SELECT telegram_id FROM impuls.users"),
    ).rejects.toMatchObject({ code: "42501" });
    for (const pool of [app, worker]) {
      // Only the worker role may call the definer function; the app role may not.
      const call = pool.query(
        "SELECT impuls.lock_notification_recipient_chat($1)",
        [user],
      );
      if (pool === app)
        await expect(call).rejects.toMatchObject({ code: "42501" });
      else await expect(call).resolves.toBeDefined();
    }
  });

  it("rejects a receipt that does not match the delivery mode", async () => {
    const first = await event();
    expect(
      await processClaim(
        worker,
        await take(),
        async () => "simulated",
        true,
        "telegram",
      ),
    ).toBe("retry");
    expect(await saved(first)).toMatchObject({
      status: "retry",
      error_code: "transport_unavailable",
    });
    await db.query(
      "TRUNCATE impuls.notification_simulation_events,impuls.notification_simulations,impuls.notification_outbox",
    );
    const second = await event();
    expect(await processClaim(worker, await take(), delivered, true)).toBe(
      "retry",
    );
    expect((await saved(second)).status).toBe("retry");
  });

  it("does not call Telegram for an inactive recipient and stops after revocation", async () => {
    await event();
    await db.query("UPDATE impuls.users SET active=false WHERE id=$1", [user]);
    let calls = 0;
    expect(
      await deliver(async () => {
        calls++;
        return "delivered";
      }),
    ).toBe("suppressed");
    expect(calls).toBe(0);
  });

  it("waits for an in-flight delivery before a revocation takes effect", async () => {
    const first = await event();
    const second = await event();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const inFlight = processClaim(
      worker,
      await take(),
      async () => {
        entered();
        await gate;
        return "delivered";
      },
      true,
      "telegram",
    );
    await started;
    let revoked = false;
    const revoke = db
      .query("UPDATE impuls.users SET active=false WHERE id=$1", [user])
      .then(() => {
        revoked = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(revoked).toBe(false);
    release();
    expect(await inFlight).toBe("delivered");
    await revoke;
    expect((await saved(first)).status).toBe("delivered");
    let calls = 0;
    expect(
      await deliver(async () => {
        calls++;
        return "delivered";
      }),
    ).toBe("suppressed");
    expect(calls).toBe(0);
    expect(await saved(second)).toMatchObject({
      status: "suppressed",
      error_code: "recipient_inactive",
    });
  });

  it("treats a blocked or unreachable chat as permanent for that recipient", async () => {
    const id = await event();
    expect(
      await deliver(async () => {
        throw new NotificationTransportError("recipient_unreachable");
      }),
    ).toBe("suppressed");
    expect(await saved(id)).toMatchObject({
      status: "suppressed",
      attempts: 1,
      error_code: "recipient_unreachable",
    });
    expect(await journal(id)).toEqual([
      { attempt: 1, phase: "started", error_code: null },
      { attempt: 1, phase: "suppressed", error_code: "recipient_unreachable" },
    ]);
    expect(await claim(worker, true)).toBeNull();
  });

  it("honours Telegram's retry_after, bounded, and never below the own backoff", async () => {
    const id = await event();
    const limited = (seconds?: number) => async () => {
      throw new NotificationTransportError("rate_limited", seconds);
    };
    expect(await deliver(limited(120))).toBe("retry");
    expect(await saved(id)).toMatchObject({
      status: "retry",
      error_code: "rate_limited",
      delay: 120,
    });
    await db.query(
      "UPDATE impuls.notification_simulations SET next_attempt_at=clock_timestamp() WHERE outbox_id=$1",
      [id],
    );
    // Attempt 2: own backoff is 60 s, a smaller hint must not shorten it.
    expect(await deliver(limited(5))).toBe("retry");
    expect((await saved(id)).delay).toBe(60);
    await db.query(
      "UPDATE impuls.notification_simulations SET next_attempt_at=clock_timestamp() WHERE outbox_id=$1",
      [id],
    );
    expect(await deliver(limited(999999))).toBe("retry");
    expect((await saved(id)).delay).toBe(3600);
  });

  it("ends after five failed attempts without touching business records", async () => {
    const id = await event();
    const outcomes: string[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      await db.query(
        "UPDATE impuls.notification_simulations SET next_attempt_at=clock_timestamp() WHERE outbox_id=$1",
        [id],
      );
      outcomes.push(
        await deliver(async () => {
          throw new NotificationTransportError("rate_limited", 1);
        }),
      );
    }
    expect(outcomes).toEqual(["retry", "retry", "retry", "retry", "failed"]);
    expect(await saved(id)).toMatchObject({
      status: "failed",
      attempts: 5,
      error_code: "rate_limited",
    });
    expect(await claim(worker, true)).toBeNull();
    expect(
      (await db.query("SELECT status FROM impuls.notification_outbox")).rows,
    ).toEqual([{ status: "pending" }]);
  });

  it("classifies unknown transport failures as retryable without leaking their message", async () => {
    const id = await event();
    expect(
      await deliver(async () => {
        throw new Error(`secret ${TOKEN} ${CHAT}`);
      }),
    ).toBe("retry");
    const row = await saved(id);
    expect(row.error_code).toBe("transport_unavailable");
    expect(JSON.stringify(row)).not.toContain(TOKEN);
  });

  it("aborts the pass on a rejected bot credential and leaves the lease to expire", async () => {
    const id = await event();
    await expect(
      deliver(async () => {
        throw new NotificationTransportFatal(
          "Bot API rejected the credentials",
        );
      }),
    ).rejects.toBeInstanceOf(NotificationTransportFatal);
    expect(await saved(id)).toMatchObject({
      status: "processing",
      attempts: 1,
    });
    expect(await journal(id)).toEqual([
      { attempt: 1, phase: "started", error_code: null },
    ]);
  });

  it("shows delivery outcomes in the scoped status and attempt readers with fixed labels only", async () => {
    const token = randomBytes(32).toString("base64url"),
      hash = createHash("sha256").update(token).digest();
    await db.query(
      "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'admin.notifications',$2,$1,'Synthetic test')",
      [user, scope],
    );
    await db.query(
      "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [user, hash],
    );
    try {
      await event();
      await event();
      await event();
      await deliver(delivered);
      await deliver(async () => {
        throw new NotificationTransportError("recipient_unreachable");
      });
      await deliver(async () => {
        throw new NotificationTransportError("rate_limited", 90);
      });
      const status = await readNotificationStatus(app, user, hash, {
        enabled: true,
        scope,
      });
      if (status.kind !== "ok") throw new Error(status.kind);
      const data = notificationStatusResponseSchema.parse(status.response);
      expect(data.counts).toMatchObject({
        delivered: 1,
        retry: 1,
        suppressed: 1,
        simulated: 0,
        failed: 0,
      });
      expect(data.errors).toMatchObject({
        rate_limited: 1,
        recipient_unreachable: 1,
      });
      const attempts = await readNotificationAttempts(app, user, hash, {
        enabled: true,
        scope,
        limit: 50,
      });
      if (attempts.kind !== "ok") throw new Error(attempts.kind);
      const page = notificationAttemptsResponseSchema.parse(attempts.response);
      expect(
        page.items.map((row) => `${row.phase}:${row.errorCode}`).sort(),
      ).toEqual(
        [
          "started:null",
          "started:null",
          "started:null",
          "delivered:null",
          "suppressed:recipient_unreachable",
          "retry:rate_limited",
        ].sort(),
      );
      expect(JSON.stringify([data, page])).not.toMatch(
        /PRIVATE|88888888881|telegram/i,
      );
    } finally {
      await db.query("DELETE FROM impuls.sessions WHERE user_id=$1", [user]);
      await db.query("DELETE FROM impuls.role_bindings WHERE user_id=$1", [
        user,
      ]);
    }
  });

  it("rejects delivery codes outside the allowlist at the database", async () => {
    const id = await event();
    await db.query(
      "INSERT INTO impuls.notification_simulations(outbox_id) VALUES($1)",
      [id],
    );
    for (const sql of [
      "INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase,error_code) VALUES($1,1,'delivered','timeout')",
      "INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase,error_code) VALUES($1,1,'suppressed','rate_limited')",
      "INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase,error_code) VALUES($1,1,'retry','recipient_unreachable')",
      "INSERT INTO impuls.notification_simulation_events(outbox_id,attempt,phase,error_code) VALUES($1,1,'failed','bot_blocked')",
    ])
      await expect(db.query(sql, [id])).rejects.toMatchObject({
        code: "23514",
      });
  });

  describe("built worker against a local Bot API double", () => {
    let server: Server;
    let port = 0;
    let respond: { status: number; body: unknown } = {
      status: 200,
      body: { ok: true, result: {} },
    };
    const requests: { url: string; body: string }[] = [];
    beforeAll(async () => {
      server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          requests.push({ url: request.url ?? "", body });
          response.writeHead(respond.status, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify(respond.body));
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      port = (server.address() as { port: number }).port;
    });
    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });
    beforeEach(() => {
      requests.length = 0;
      respond = { status: 200, body: { ok: true, result: {} } };
    });
    async function runWorker(env: Record<string, string>) {
      const workerUrl = new URL(parsed);
      workerUrl.searchParams.set("options", "-c role=impuls_worker");
      try {
        const { stdout, stderr } = await run(
          process.execPath,
          [path.resolve("apps/worker/dist/index.mjs"), "--once"],
          {
            env: {
              ...process.env,
              TELEGRAM_DELIVERY_ENABLED: "",
              TELEGRAM_BOT_TOKEN: "",
              TELEGRAM_API_BASE_URL: "",
              SYNTHETIC_NOTIFICATIONS_ENABLED: "true",
              WORKER_DATABASE_URL: workerUrl.toString(),
              ...env,
            },
            timeout: 20000,
            windowsHide: true,
          },
        );
        return { code: 0, stdout, stderr };
      } catch (error) {
        const failed = error as {
          code: number;
          stdout: string;
          stderr: string;
        };
        return {
          code: failed.code,
          stdout: failed.stdout,
          stderr: failed.stderr,
        };
      }
    }
    const telegramEnv = () => ({
      TELEGRAM_DELIVERY_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_API_BASE_URL: `http://127.0.0.1:${port}`,
    });

    it("sends sendMessage with only chat_id and fixed text, then records delivered", async () => {
      const id = await event();
      const result = await runWorker(telegramEnv());
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        mode: "telegram",
        results: { delivered: 1 },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe(`/bot${TOKEN}/sendMessage`);
      expect(JSON.parse(requests[0]!.body)).toEqual({
        chat_id: Number(CHAT),
        text: "В приложении назначена задача.",
      });
      expect((await saved(id)).status).toBe("delivered");
      expect(result.stdout + result.stderr).not.toContain(TOKEN);
    });

    it("maps Bot API 403 and 429 without exposing description or token", async () => {
      const blocked = await event();
      respond = {
        status: 403,
        body: {
          ok: false,
          error_code: 403,
          description: "Forbidden: bot was blocked by the user",
        },
      };
      let result = await runWorker(telegramEnv());
      expect(JSON.parse(result.stdout.trim()).results).toEqual({
        suppressed: 1,
      });
      expect(await saved(blocked)).toMatchObject({
        status: "suppressed",
        error_code: "recipient_unreachable",
      });
      const limited = await event();
      respond = {
        status: 429,
        body: {
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 90",
          parameters: { retry_after: 90 },
        },
      };
      result = await runWorker(telegramEnv());
      expect(JSON.parse(result.stdout.trim()).results).toEqual({ retry: 1 });
      expect(await saved(limited)).toMatchObject({
        status: "retry",
        error_code: "rate_limited",
        delay: 90,
      });
      expect(result.stdout + result.stderr).not.toMatch(
        /blocked|Too Many|AAAA/,
      );
    });

    it("exits with the generic failure on rejected credentials, keeps the event undelivered", async () => {
      const id = await event();
      respond = {
        status: 401,
        body: { ok: false, error_code: 401, description: "Unauthorized" },
      };
      const result = await runWorker(telegramEnv());
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr.trim())).toEqual({
        mode: "telegram",
        error: "WORKER_UNAVAILABLE",
      });
      expect(result.stdout + result.stderr).not.toContain(TOKEN);
      expect((await saved(id)).status).toBe("processing");
    });

    it("refuses to start without a valid token or with a non-loopback API base", async () => {
      await event();
      for (const env of [
        { ...telegramEnv(), TELEGRAM_BOT_TOKEN: "" },
        { ...telegramEnv(), TELEGRAM_BOT_TOKEN: "not-a-token" },
        { ...telegramEnv(), TELEGRAM_API_BASE_URL: "http://example.com" },
        { ...telegramEnv(), TELEGRAM_API_BASE_URL: "https://127.0.0.1" },
      ]) {
        const result = await runWorker(env);
        expect(result.code).toBe(1);
        expect(JSON.parse(result.stderr.trim()).error).toBe(
          "WORKER_UNAVAILABLE",
        );
        expect(result.stdout + result.stderr).not.toContain(TOKEN);
      }
      expect(requests).toHaveLength(0);
    });

    it("keeps simulating, with no network and no token, unless delivery is enabled", async () => {
      const id = await event();
      const result = await runWorker({ TELEGRAM_BOT_TOKEN: TOKEN });
      expect(JSON.parse(result.stdout.trim())).toEqual({
        mode: "simulation",
        results: { simulated: 1 },
      });
      expect(requests).toHaveLength(0);
      expect((await saved(id)).status).toBe("simulated");
    });
  });
});
