import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readdir } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expireOneSyntheticReservation as expire } from "../../packages/domain/src/rewards/automatic-expiry";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import { decideRedemption } from "../../packages/domain/src/rewards/decisions";
import { readMyRedemptions } from "../../packages/domain/src/rewards/read";
import { readAudit } from "../../packages/domain/src/admin/audit";
import { redemptionListResponseSchema } from "../../packages/contracts/src/rewards";
import { auditResponseSchema } from "../../packages/contracts/src/audit";

const url = process.env.TEST_DATABASE_URL;
const require = createRequire(import.meta.url),
  run = promisify(execFile);
(url ? describe : describe.skip)(
  "F06 automatic expiry with separate PostgreSQL service authority",
  () => {
    const name = `impuls_expiry_${randomUUID().replaceAll("-", "")}`;
    const parsed = new URL(url || "postgres://localhost/test");
    parsed.pathname = `/${name}`;
    const admin = new Pool({ connectionString: url });
    const db = new Pool({ connectionString: parsed.toString() });
    const app = new Pool({
      connectionString: parsed.toString(),
      options: "-c role=impuls_app",
    });
    const worker = new Pool({
      connectionString: parsed.toString(),
      options: "-c role=impuls_expiry_worker",
      max: 8,
    });
    const notifications = new Pool({
      connectionString: parsed.toString(),
      options: "-c role=impuls_worker",
    });
    const scope = randomUUID();
    let created = false;
    type User = { id: string; hash: Buffer; token: string };
    let reviewer: User;
    const common = (u: User) => ({
      actorId: u.id,
      sessionHash: u.hash,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowSyntheticRewards: true,
    });
    async function user(): Promise<User> {
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        hash = createHash("sha256").update(token).digest();
      await db.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic expiry participant',true)",
        [id, randomInt(5e12, 6e12)],
      );
      await db.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
        [id, hash],
      );
      return { id, hash, token };
    }
    async function fixture(seconds: number | null = 1, price = 30) {
      const owner = await user(),
        reward = randomUUID(),
        version = randomUUID(),
        quota = randomUUID();
      await db.query(
        "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
        [owner.id],
      );
      await db.query(
        "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
        [owner.id, scope],
      );
      await db.query(
        `INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from,reservation_seconds)
      VALUES($1,$2,$3,1,'Synthetic expiry cosmetic','Saved expiry terms',$4,'cosmetic','synthetic',true,clock_timestamp()-interval '1 minute',$5)`,
        [version, reward, scope, price, seconds],
      );
      await db.query(
        "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',3)",
        [quota, reward, scope],
      );
      const saved = await mutateRedemption(app, {
        ...common(owner),
        action: "reserve",
        rewardVersionId: version,
        quotaPeriodId: quota,
        expectedVersion: 1,
      });
      if (saved.kind !== "ok") throw new Error(saved.kind);
      return {
        owner,
        reward,
        version,
        quota,
        id: saved.response.redemption.id,
        price,
      };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const due = (f: Fixture) =>
      db.query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.02) FROM impuls.redemptions WHERE id=$1",
        [f.id],
      );
    const decision = (f: Fixture, choice: "approve" | "reject" | "expire") =>
      decideRedemption(app, {
        ...common(reviewer),
        redemptionId: f.id,
        expectedVersion: 1,
        decision: choice,
        reason: "Synthetic manual decision",
      });
    async function state(f: Fixture) {
      return (
        await db.query(
          `SELECT b.lifetime_xp::int xp,b.available_points::int available,b.reserved_points::int held,q.reserved,q.used,d.status,d.version,d.automatic_expiry,
      (SELECT count(*)::int FROM impuls.ledger_entries WHERE redemption_id=d.id) entries,
      (SELECT count(*)::int FROM impuls.audit_events WHERE redemption_id=d.id) audit,
      (SELECT count(*)::int FROM impuls.notification_outbox WHERE redemption_id=d.id) outbox
      FROM impuls.redemptions d JOIN impuls.account_balances b ON b.user_id=d.user_id JOIN impuls.quota_periods q ON q.id=d.quota_period_id WHERE d.id=$1`,
          [f.id],
        )
      ).rows[0];
    }
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
    beforeAll(async () => {
      if (!/^impuls_expiry_[0-9a-f]{32}$/.test(name))
        throw new Error("Invalid disposable DB name");
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await db.query(
        "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
      );
      const files = (await readdir("db/migrations"))
        .filter((f) => f.endsWith(".js"))
        .sort();
      for (const file of files.filter((f) => f < "000027")) await migrate(file);
      // Current reserve code reads the 000030 table; the legacy fixture is built
      // on a pre-000027 schema, so give it an empty stand-in until real migration.
      await db.query(
        "CREATE TABLE impuls.catalog_cancellations(version_id uuid); GRANT SELECT ON impuls.catalog_cancellations TO impuls_app",
      );
      await db.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic expiry scope')",
        [scope],
      );
      reviewer = await user();
      for (const action of ["reward.decide", "admin.audit"])
        await db.query(
          "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic expiry fixture')",
          [reviewer.id, scope, action],
        );
      await db.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [reviewer.id],
      );
      const legacy = await fixture(null);
      const before = (
        await db.query(
          "SELECT to_jsonb(d) value FROM impuls.redemptions d WHERE id=$1",
          [legacy.id],
        )
      ).rows[0].value;
      await db.query("DROP TABLE impuls.catalog_cancellations");
      await migrate("000027_automatic_reservation_expiry.js");
      for (const file of files.filter(
        (f) => f > "000027_automatic_reservation_expiry.js",
      ))
        await migrate(file);
      expect(
        (
          await db.query(
            "SELECT to_jsonb(d) value FROM impuls.redemptions d WHERE id=$1",
            [legacy.id],
          )
        ).rows[0].value,
      ).toEqual({ ...before, automatic_expiry: false });
      expect(await expire(worker, true)).toBe(false);
    }, 30000);
    afterAll(async () => {
      await Promise.all([
        app.end(),
        worker.end(),
        notifications.end(),
        db.end(),
      ]);
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    });
    it("keeps NULL/future deadlines pending and a disabled service opens no connection", async () => {
      const future = await fixture(3600);
      expect(await expire(worker, true)).toBe(false);
      expect((await state(future)).status).toBe("pending");
      const fake = { query: vi.fn() } as unknown as Pool;
      expect(await expire(fake, false)).toBe(false);
      expect(fake.query).not.toHaveBeenCalled();
    });
    it("restores original price and quota once, with service provenance and consistent scoped reads", async () => {
      const f = await fixture(1, 23);
      await due(f);
      expect(await state(f)).toMatchObject({
        xp: 300,
        available: 97,
        held: 23,
        reserved: 1,
        used: 0,
        status: "pending",
      });
      expect(await expire(worker, true)).toBe(true);
      expect(await expire(worker, true)).toBe(false);
      expect(await state(f)).toEqual({
        xp: 300,
        available: 120,
        held: 0,
        reserved: 0,
        used: 0,
        status: "expired",
        version: 2,
        automatic_expiry: true,
        entries: 2,
        audit: 2,
        outbox: 2,
      });
      const journal = (
        await db.query(
          "SELECT kind,amount,reserved_delta,season_key,time_zone FROM impuls.ledger_entries WHERE redemption_id=$1 ORDER BY created_at",
          [f.id],
        )
      ).rows;
      expect(journal.map((r) => [r.kind, r.amount, r.reserved_delta])).toEqual([
        ["reward_reservation", -23, 23],
        ["reward_expiration", 23, -23],
      ]);
      expect(journal[1].season_key).toBe(journal[0].season_key);
      expect(journal[1].time_zone).toBe(journal[0].time_zone);
      const mine = await readMyRedemptions(app, f.owner.id, f.owner.hash, {
        allowSyntheticRewards: true,
      });
      expect(mine.kind).toBe("ok");
      if (mine.kind === "ok")
        expect(
          redemptionListResponseSchema.parse(mine.response).items[0]?.decision,
        ).toMatchObject({
          actorId: null,
          displayName: "Автоматическое истечение резерва",
        });
      const audit = await readAudit(app, reviewer.id, reviewer.hash, {
        allowSyntheticAudit: true,
        scope,
        action: "reward.expire",
      });
      expect(audit.kind).toBe("ok");
      if (audit.kind === "ok")
        expect(
          auditResponseSchema
            .parse(audit.response)
            .items.find((i) => i.reward?.redemptionId === f.id)?.actor,
        ).toEqual({
          id: null,
          displayName: "Автоматическое истечение резерва",
        });
      expect(await decision(f, "expire")).toMatchObject({
        kind: "conflict",
        currentVersion: 2,
      });
    });
    it("returns held resources even after recipient access/membership is revoked", async () => {
      const f = await fixture();
      await due(f);
      await db.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        f.owner.id,
      ]);
      await db.query(
        "UPDATE impuls.task_scope_members SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [f.owner.id],
      );
      expect(await expire(worker, true)).toBe(true);
      expect(await state(f)).toMatchObject({
        available: 120,
        held: 0,
        reserved: 0,
        status: "expired",
      });
      expect(
        await readMyRedemptions(app, f.owner.id, f.owner.hash, {
          allowSyntheticRewards: true,
        }),
      ).toEqual({ kind: "revoked" });
    });
    it("gives app and notification worker no expiry or impersonation authority", async () => {
      for (const pool of [app, notifications])
        await expect(expire(pool, true)).rejects.toMatchObject({
          code: "42501",
        });
      for (const sql of [
        "SELECT * FROM impuls.redemptions",
        "UPDATE impuls.account_balances SET available_points=0",
      ])
        await expect(worker.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      expect(
        (
          await db.query(
            "SELECT pg_has_role('impuls_expiry_worker','impuls_expiry_executor','SET') allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
      const f = await fixture();
      await due(f);
      await expect(
        app.query(
          "UPDATE impuls.redemptions SET status='expired',automatic_expiry=true,decision_reason='Автоматическое истечение синтетического резерва',decided_at=clock_timestamp(),version=version+1 WHERE id=$1",
          [f.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query(
          "INSERT INTO impuls.audit_events(actor_id,redemption_id,action,request_id,reason,diff,automatic_expiry,created_at,updated_at) VALUES(NULL,$1,'reward.expire',$2,'Автоматическое истечение синтетического резерва','{}',true,clock_timestamp(),clock_timestamp())",
          [f.id, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await expire(worker, true)).toBe(true);
      const acl = (
        await db.query(`SELECT p.prosecdef,p.proconfig,r.rolname owner,
      has_function_privilege('impuls_app',p.oid,'EXECUTE') app,
      has_function_privilege('impuls_worker',p.oid,'EXECUTE') notifications,
      has_function_privilege('impuls_expiry_worker',p.oid,'EXECUTE') expiry,
      has_schema_privilege('impuls_expiry_executor','impuls','CREATE') schema_create
      FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='impuls.expire_one_synthetic_reservation()'::regprocedure`)
      ).rows[0];
      expect(acl).toEqual({
        prosecdef: true,
        proconfig: ["search_path=pg_catalog"],
        owner: "impuls_expiry_executor",
        app: false,
        notifications: false,
        expiry: true,
        schema_create: false,
      });
    });
    it("serializes two expiry workers without double return", async () => {
      const f = await fixture();
      await due(f);
      const results = await Promise.all([
        expire(worker, true),
        expire(worker, true),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await state(f)).toMatchObject({
        available: 120,
        held: 0,
        reserved: 0,
        entries: 2,
        audit: 2,
        outbox: 2,
      });
    });
    it.each(["cancel", "reject", "expire"] as const)(
      "races automatic expiry with manual %s and returns exactly once",
      async (choice) => {
        const f = await fixture();
        await due(f);
        const manual =
          choice === "cancel"
            ? mutateRedemption(app, {
                ...common(f.owner),
                action: "cancel",
                redemptionId: f.id,
                expectedVersion: 1,
                reason: "Synthetic owner cancel",
              })
            : decision(f, choice);
        const results = await Promise.all([expire(worker, true), manual]);
        expect(results[0] || results[1].kind === "ok").toBe(true);
        expect(await state(f)).toMatchObject({
          available: 120,
          held: 0,
          reserved: 0,
          used: 0,
          entries: 2,
          audit: 2,
          outbox: 2,
          version: 2,
        });
      },
    );
    it("rejects late approval and keeps an earlier approved request terminal", async () => {
      const approved = await fixture();
      expect((await decision(approved, "approve")).kind).toBe("ok");
      await due(approved);
      const late = await fixture();
      await due(late);
      const results = await Promise.all([
        expire(worker, true),
        decision(late, "approve"),
      ]);
      expect(results[1].kind).not.toBe("ok");
      expect(await state(late)).toMatchObject({
        status: "expired",
        available: 120,
        used: 0,
      });
      expect(await state(approved)).toMatchObject({
        status: "approved",
        available: 90,
        held: 0,
        reserved: 0,
        used: 1,
        automatic_expiry: false,
      });
    });
    it("skips a locked quota and uses unchanged saved terms on the next pass", async () => {
      const f = await fixture();
      await due(f);
      const lock = await db.connect();
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
          [f.quota],
        );
        expect(await expire(worker, true)).toBe(false);
        expect((await state(f)).status).toBe("pending");
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }
      await db.query(
        "INSERT INTO impuls.reward_versions(reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from,reservation_seconds) VALUES($1,$2,2,'Changed terms','Not used',99,'cosmetic','synthetic',false,clock_timestamp(),3600)",
        [f.reward, scope],
      );
      expect(await expire(worker, true)).toBe(true);
      expect(await state(f)).toMatchObject({
        available: 120,
        held: 0,
        reserved: 0,
        status: "expired",
      });
    });
    it("rolls back all projections/evidence on outbox failure and retries successfully", async () => {
      const f = await fixture();
      await due(f);
      const before = await state(f);
      const constraint = `expiry_failure_${randomUUID().replaceAll("-", "")}`;
      await db.query(
        `ALTER TABLE impuls.notification_outbox ADD CONSTRAINT ${constraint} CHECK(kind<>'reward.expired' OR redemption_id<>'${f.id}'::uuid) NOT VALID`,
      );
      try {
        await expect(expire(worker, true)).rejects.toMatchObject({
          code: "23514",
        });
        expect(await state(f)).toEqual(before);
      } finally {
        await db.query(
          `ALTER TABLE impuls.notification_outbox DROP CONSTRAINT ${constraint}`,
        );
      }
      expect(await expire(worker, true)).toBe(true);
    });
    function workerUrl(role = "impuls_expiry_worker") {
      const u = new URL(parsed);
      u.searchParams.set("options", `-c role=${role}`);
      return u.toString();
    }
    it("watch mode discovers later deadlines with bounded neutral output", async () => {
      const child = spawn(
        process.execPath,
        [path.resolve("apps/worker/dist/index.mjs"), "--expire-watch"],
        {
          env: {
            ...process.env,
            RESERVATION_EXPIRY_ENABLED: "true",
            SYNTHETIC_NOTIFICATIONS_ENABLED: "false",
            WORKER_DATABASE_URL: workerUrl(),
            WORKER_POLL_INTERVAL_MS: "1000",
          },
          windowsHide: true,
        },
      );
      const closed = new Promise((resolve) => child.once("close", resolve));
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => {
        stdout += String(data);
      });
      child.stderr.on("data", (data) => {
        stderr += String(data);
      });
      try {
        await vi.waitFor(() => expect(stdout).toContain('"status":"watching"'));
        const f = await fixture();
        await due(f);
        await vi.waitFor(
          async () => expect((await state(f)).status).toBe("expired"),
          { timeout: 5000 },
        );
        expect(stdout).toContain('"expired":1');
        expect(stdout).not.toContain(f.id);
        expect(stdout).not.toContain(f.owner.id);
        expect(stderr).toBe("");
      } finally {
        child.kill("SIGKILL");
        await closed;
      }
    });
    it("runs the built Node CLI with independent flags and a strict service role", async () => {
      const cli = (env: Record<string, string>) =>
        run(
          process.execPath,
          [path.resolve("apps/worker/dist/index.mjs"), "--expire-once"],
          {
            env: {
              ...process.env,
              SYNTHETIC_NOTIFICATIONS_ENABLED: "false",
              RESERVATION_EXPIRY_ENABLED: "true",
              WORKER_DATABASE_URL: workerUrl(),
              ...env,
            },
            windowsHide: true,
          },
        );
      expect(
        JSON.parse(
          (
            await cli({
              RESERVATION_EXPIRY_ENABLED: "false",
              WORKER_DATABASE_URL: "invalid",
            })
          ).stdout,
        ),
      ).toEqual({ mode: "reservation_expiry", status: "disabled" });
      const f = await fixture();
      await due(f);
      expect(JSON.parse((await cli({})).stdout)).toEqual({
        mode: "reservation_expiry",
        results: { expired: 1 },
      });
      await expect(
        cli({ WORKER_DATABASE_URL: workerUrl("impuls_app") }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("WORKER_UNAVAILABLE"),
      });
    });
    it("a killed process waiting on balance rolls back; restart completes the original return", async () => {
      const f = await fixture();
      await due(f);
      const lock = await db.connect();
      let child: ReturnType<typeof spawn> | undefined;
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT user_id FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
          [f.owner.id],
        );
        child = spawn(
          process.execPath,
          [path.resolve("apps/worker/dist/index.mjs"), "--expire-once"],
          {
            env: {
              ...process.env,
              RESERVATION_EXPIRY_ENABLED: "true",
              WORKER_DATABASE_URL: workerUrl(),
            },
            stdio: "ignore",
            windowsHide: true,
          },
        );
        const closed = new Promise((resolve) => child!.once("close", resolve));
        await vi.waitFor(async () =>
          expect(
            (
              await db.query(
                "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND query LIKE '%expire_one_synthetic_reservation%' AND wait_event_type='Lock'",
                [name],
              )
            ).rows[0].n,
          ).toBe(1),
        );
        child.kill("SIGKILL");
        await closed;
      } finally {
        child?.kill("SIGKILL");
        await lock.query("ROLLBACK");
        lock.release();
      }
      await vi.waitFor(async () =>
        expect(
          (
            await db.query(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND query LIKE '%expire_one_synthetic_reservation%' AND wait_event_type='Lock'",
              [name],
            )
          ).rows[0].n,
        ).toBe(0),
      );
      // If the server had already committed before observing disconnect, replay must still be harmless.
      await vi.waitFor(
        async () => {
          await expire(worker, true);
          expect(await state(f)).toMatchObject({
            available: 120,
            held: 0,
            reserved: 0,
            entries: 2,
            audit: 2,
            outbox: 2,
            status: "expired",
          });
        },
        { timeout: 10000 },
      );
    });
    it("serves automatic provenance through real HTTP and the participant UI at mobile widths", async () => {
      const f = await fixture();
      await due(f);
      expect(await expire(worker, true)).toBe(true);
      const listener = createServer();
      await new Promise<void>((resolve) =>
        listener.listen(0, "127.0.0.1", resolve),
      );
      const address = listener.address();
      if (!address || typeof address === "string")
        throw new Error("Missing loopback port");
      const port = address.port;
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      const origin = `http://127.0.0.1:${port}`;
      const appUrl = new URL(parsed);
      appUrl.searchParams.set("options", "-c role=impuls_app");
      const server = spawn(
        process.execPath,
        [
          path.resolve("node_modules/next/dist/bin/next"),
          "start",
          "-H",
          "127.0.0.1",
          "-p",
          String(port),
        ],
        {
          cwd: path.resolve("apps/app"),
          env: {
            ...process.env,
            DATABASE_URL: appUrl.toString(),
            APP_ORIGIN: origin,
            REWARDS_ENABLED: "true",
            AUDIT_ENABLED: "true",
            SPEED_INSIGHTS_ENABLED: "false",
            CSRF_SECRET: "synthetic-expiry-http-only",
            TELEGRAM_BOT_TOKEN: "synthetic-expiry-http-only",
          },
          stdio: "ignore",
          windowsHide: true,
        },
      );
      const closed = new Promise((resolve) => server.once("close", resolve));
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        await vi.waitFor(
          async () =>
            expect((await fetch(`${origin}/api/v1/me`)).status).toBe(401),
          { timeout: 15000 },
        );
        const response = await fetch(`${origin}/api/v1/me/redemptions`, {
          headers: { cookie: `impuls_session=${f.owner.token}` },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(
          redemptionListResponseSchema.parse(await response.json()).items[0]
            ?.decision?.actorId,
        ).toBeNull();
        const auditResponse = await fetch(
          `${origin}/api/v1/admin/audit?scope=${scope}&action=reward.expire`,
          { headers: { cookie: `impuls_session=${reviewer.token}` } },
        );
        expect(auditResponse.status).toBe(200);
        expect(auditResponse.headers.get("cache-control")).toContain(
          "no-store",
        );
        expect(
          auditResponseSchema
            .parse(await auditResponse.json())
            .items.find((i) => i.reward?.redemptionId === f.id)?.actor.id,
        ).toBeNull();
        browser = await chromium.launch();
        for (const width of [320, 360, 390, 1280]) {
          const context = await browser.newContext({
            viewport: { width, height: 950 },
            reducedMotion: "reduce",
          });
          await context.addCookies([
            { name: "impuls_session", value: f.owner.token, url: origin },
          ]);
          const page = await context.newPage(),
            errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
            r.fulfill({
              contentType: "application/javascript",
              body: "window.Telegram={WebApp:{ready(){},expand(){}}}",
            }),
          );
          await page.goto(origin);
          await page
            .getByRole("button", { name: "Поощрения", exact: true })
            .click();
          await page
            .getByText(/Срок резерва истёк, баллы и место возвращены/)
            .waitFor();
          await page
            .getByText(/Обработчик: Автоматическое истечение резерва/)
            .waitFor();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
          ).toBe(false);
          expect(errors).toEqual([]);
          const captures = path.join(
            process.env.TEST_SCREENSHOT_DIR ?? "test-results",
            "automatic-expiry",
          );
          await mkdir(captures, { recursive: true });
          await page.screenshot({
            path: path.join(captures, `expired-${width}.png`),
            fullPage: true,
          });
          await page
            .locator(".reward-requests")
            .screenshot({ path: path.join(captures, `request-${width}.png`) });
          const refresh = page.getByRole("button", {
            name: "Обновить поощрения",
            exact: true,
          });
          await refresh.focus();
          await page.keyboard.press("Enter");
          await page
            .getByText(/Обработчик: Автоматическое истечение резерва/)
            .waitFor();
          if (width === 320) {
            await page.addStyleTag({
              content:
                ".reward-catalog p, .reward-catalog button {font-size:20px!important}",
            });
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
              ),
            ).toBe(false);
            await page.locator(".reward-requests").screenshot({
              path: path.join(captures, "request-large-320.png"),
            });
          }
          await context.close();
        }
      } finally {
        await browser?.close();
        server.kill();
        await closed;
      }
    }, 45000);
  },
);
