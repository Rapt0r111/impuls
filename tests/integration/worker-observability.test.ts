import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { localRestoreConnection } from "../../scripts/database-restore-safety.mjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mutateRedemption } from "../../packages/domain/src/rewards/write";
import { decideRedemption } from "../../packages/domain/src/rewards/decisions";
import {
  expireOneSyntheticReservation,
  readSyntheticExpiryStatus,
} from "../../packages/domain/src/rewards/automatic-expiry";

const url = process.env.TEST_DATABASE_URL;
if (url) localRestoreConnection(url);
const require = createRequire(import.meta.url),
  run = promisify(execFile);
(url ? describe : describe.skip)(
  "synthetic worker observability with PostgreSQL authority",
  () => {
    const name = `impuls_ops_${randomUUID().replaceAll("-", "")}`;
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
      statement_timeout: 2000,
    });
    const notifications = new Pool({
      connectionString: parsed.toString(),
      options: "-c role=impuls_worker",
    });
    const scope = randomUUID();
    let created = false;
    type User = { id: string; hash: Buffer };
    let reviewer: User;
    let blocked: Awaited<ReturnType<typeof fixture>>;
    const common = (u: User) => ({
      actorId: u.id,
      sessionHash: u.hash,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      allowSyntheticRewards: true,
    });
    async function user(): Promise<User> {
      const id = randomUUID(),
        hash = createHash("sha256").update(randomBytes(32)).digest();
      await db.query(
        "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,'Synthetic ops participant',true)",
        [id, randomInt(5e12, 6e12)],
      );
      await db.query(
        "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
        [id, hash],
      );
      return { id, hash };
    }
    async function fixture(seconds: number | null) {
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
      VALUES($1,$2,$3,1,'Synthetic ops cosmetic','Saved synthetic terms',23,'cosmetic','synthetic',true,clock_timestamp()-interval '1 minute',$4)`,
        [version, reward, scope, seconds],
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
      return { owner, quota, id: saved.response.redemption.id };
    }
    const due = (f: Awaited<ReturnType<typeof fixture>>) =>
      db.query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.02) FROM impuls.redemptions WHERE id=$1",
        [f.id],
      );
    const decision = (
      f: Awaited<ReturnType<typeof fixture>>,
      choice: "approve" | "expire",
    ) =>
      decideRedemption(app, {
        ...common(reviewer),
        redemptionId: f.id,
        expectedVersion: 1,
        decision: choice,
        reason: "Synthetic observation fixture",
      });
    async function evidence() {
      const result = [];
      for (const table of [
        "redemptions",
        "quota_periods",
        "account_balances",
        "ledger_entries",
        "audit_events",
        "notification_outbox",
      ])
        result.push(
          (
            await db.query(
              `SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) digest FROM impuls.${table} t`,
            )
          ).rows[0],
        );
      return result;
    }
    beforeAll(async () => {
      if (!/^impuls_ops_[0-9a-f]{32}$/.test(name))
        throw new Error("Invalid disposable DB name");
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await db.query(
        "CREATE SCHEMA impuls_meta; CREATE TABLE impuls_meta.pgmigrations(id integer)",
      );
      for (const file of (await readdir("db/migrations"))
        .filter((f) => f.endsWith(".js"))
        .sort()) {
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
      await db.query(
        "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Synthetic ops scope')",
        [scope],
      );
      reviewer = await user();
      await db.query(
        "INSERT INTO impuls.role_bindings(user_id,scope_id,action,granted_by,reason) VALUES($1,$2,'reward.decide',$1,'Synthetic ops fixture')",
        [reviewer.id, scope],
      );
      await db.query(
        "UPDATE impuls.sessions SET revoked_at=NULL WHERE user_id=$1",
        [reviewer.id],
      );
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
    it("reads an empty aggregate and the disabled service never opens a connection", async () => {
      const fake = { query: vi.fn() } as unknown as Pool;
      expect(await readSyntheticExpiryStatus(fake, false)).toBeNull();
      expect(fake.query).not.toHaveBeenCalled();
      expect(await readSyntheticExpiryStatus(worker, true)).toEqual({
        snapshotAt: expect.any(String),
        counts: {
          due: 0,
          scheduled: 0,
          untimedPending: 0,
          automaticExpired: 0,
        },
        oldestDueAt: null,
        oldestDueAgeSeconds: null,
        lastAutomaticExpiryAt: null,
      });
    });
    it("distinguishes due/future/NULL, automatic/manual expiration and approved terminal state", async () => {
      const auto = await fixture(1);
      await due(auto);
      expect(await expireOneSyntheticReservation(worker, true)).toBe(true);
      const manual = await fixture(1);
      await due(manual);
      expect((await decision(manual, "expire")).kind).toBe("ok");
      const approved = await fixture(null);
      expect((await decision(approved, "approve")).kind).toBe("ok");
      await fixture(null);
      await fixture(3600);
      blocked = await fixture(1);
      const later = await fixture(1);
      await due(later);
      const before = await evidence();
      const status = (await readSyntheticExpiryStatus(worker, true))!;
      expect(status.counts).toEqual({
        due: 2,
        scheduled: 1,
        untimedPending: 1,
        automaticExpired: 1,
      });
      const dates = (
        await db.query(
          "SELECT (SELECT expires_at FROM impuls.redemptions WHERE id=$1) oldest,(SELECT decided_at FROM impuls.redemptions WHERE id=$2) completed,clock_timestamp() now",
          [blocked.id, auto.id],
        )
      ).rows[0];
      expect(status.oldestDueAt).toBe(dates.oldest.toISOString());
      expect(status.lastAutomaticExpiryAt).toBe(dates.completed.toISOString());
      expect(Date.parse(status.snapshotAt)).toBeLessThanOrEqual(
        dates.now.getTime(),
      );
      const expectedAge = Math.floor(
        (Date.parse(status.snapshotAt) - dates.oldest.getTime()) / 1000,
      );
      expect(
        Math.abs(status.oldestDueAgeSeconds! - expectedAge),
      ).toBeLessThanOrEqual(1);
      await readSyntheticExpiryStatus(worker, true);
      expect(await evidence()).toEqual(before);
      const encoded = JSON.stringify(status);
      for (const id of [scope, blocked.id, blocked.owner.id])
        expect(encoded).not.toContain(id);
      expect(Object.keys(status).sort()).toEqual(
        [
          "snapshotAt",
          "counts",
          "oldestDueAt",
          "oldestDueAgeSeconds",
          "lastAutomaticExpiryAt",
        ].sort(),
      );
    });
    it("keeps locks and committed projections untouched while reporting blocked due work", async () => {
      const before = await evidence(),
        lock = await db.connect();
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT id FROM impuls.quota_periods WHERE id=$1 FOR UPDATE",
          [blocked.quota],
        );
        await lock.query(
          "SELECT user_id FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
          [blocked.owner.id],
        );
        expect(
          (await readSyntheticExpiryStatus(worker, true))!.counts.due,
        ).toBe(2);
        expect(await evidence()).toEqual(before);
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }
    });
    it("denies app/notification/PUBLIC execution and all direct expiry-caller SELECT", async () => {
      for (const pool of [app, notifications])
        await expect(
          pool.query("SELECT * FROM impuls.read_synthetic_expiry_status()"),
        ).rejects.toMatchObject({ code: "42501" });
      await expect(
        worker.query("SELECT id FROM impuls.redemptions"),
      ).rejects.toMatchObject({ code: "42501" });
      const rows = (
        await db.query(`SELECT pg_get_userbyid(proowner) owner,prosecdef,provolatile,proconfig,
      EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute
      FROM pg_proc WHERE oid='impuls.read_synthetic_expiry_status()'::regprocedure`)
      ).rows;
      expect(rows).toEqual([
        {
          owner: "impuls_expiry_executor",
          prosecdef: true,
          provolatile: "s",
          proconfig: ["search_path=pg_catalog"],
          public_execute: false,
        },
      ]);
      expect(
        (
          await db.query(
            "SELECT pg_has_role('impuls_app','impuls_expiry_executor','MEMBER') app,pg_has_role('impuls_worker','impuls_expiry_executor','MEMBER') notifications",
          )
        ).rows,
      ).toEqual([{ app: false, notifications: false }]);
    });
    function workerUrl(role = "impuls_expiry_worker") {
      const u = new URL(parsed);
      u.searchParams.set("options", `-c role=${role}`);
      u.searchParams.set("application_name", "synthetic-ops-worker");
      return u.toString();
    }
    const cliEnv = (extra: NodeJS.ProcessEnv = {}) => ({
      ...process.env,
      RESERVATION_EXPIRY_ENABLED: "true",
      SYNTHETIC_NOTIFICATIONS_ENABLED: "false",
      WORKER_DATABASE_URL: workerUrl(),
      WORKER_POLL_INTERVAL_MS: "1000",
      ...extra,
    });
    it("built status CLI respects flags/role, has neutral failures, and does not consume the queue", async () => {
      const cli = (extra: NodeJS.ProcessEnv = {}) =>
        run(
          process.execPath,
          [path.resolve("apps/worker/dist/index.mjs"), "--expire-status"],
          { env: cliEnv(extra), windowsHide: true },
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
      const before = await evidence();
      expect(JSON.parse((await cli()).stdout)).toMatchObject({
        mode: "reservation_expiry",
        status: "observed",
        counts: {
          due: 2,
          scheduled: 1,
          untimedPending: 1,
          automaticExpired: 1,
        },
      });
      expect(await evidence()).toEqual(before);
      await expect(
        cli({ WORKER_DATABASE_URL: workerUrl("impuls_app") }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: '{"mode":"reservation_expiry","error":"WORKER_UNAVAILABLE"}\n',
      });
    });
    function watch(extra: NodeJS.ProcessEnv = {}) {
      const child = spawn(
        process.execPath,
        [path.resolve("apps/worker/dist/index.mjs"), "--expire-watch"],
        { env: cliEnv(extra), windowsHide: true },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      const closed = new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout, stderr }));
      });
      return { child, closed, output: () => stdout };
    }
    it("watch reports liveness and processing counts without business identifiers", async () => {
      const running = watch();
      try {
        await vi.waitFor(
          () => expect(running.output()).toContain('"status":"alive"'),
          { timeout: 5000 },
        );
        await vi.waitFor(
          () => expect(running.output()).toContain('"expired":2'),
          { timeout: 5000 },
        );
        expect((await readSyntheticExpiryStatus(worker, true))!.counts).toEqual(
          { due: 0, scheduled: 1, untimedPending: 1, automaticExpired: 3 },
        );
        for (const id of [scope, blocked.id, blocked.owner.id])
          expect(running.output()).not.toContain(id);
      } finally {
        running.child.kill("SIGKILL");
        await running.closed;
      }
    });
    it.skipIf(process.platform === "win32")(
      "POSIX SIGTERM wakes an idle 60s wait with clean exit",
      async () => {
        const running = watch({ WORKER_POLL_INTERVAL_MS: "60000" });
        try {
          await vi.waitFor(
            () => expect(running.output()).toContain('"status":"alive"'),
            { timeout: 5000 },
          );
          const at = performance.now();
          running.child.kill("SIGTERM");
          const result = await running.closed;
          expect(result).toMatchObject({ code: 0, stderr: "" });
          expect(result.stdout).toContain('"status":"stopped"');
          expect(performance.now() - at).toBeLessThan(5000);
        } finally {
          running.child.kill("SIGKILL");
          await running.closed;
        }
      },
      10000,
    );
    it.skipIf(process.platform === "win32")(
      "POSIX SIGTERM drains an in-flight return exactly once",
      async () => {
        const f = await fixture(1);
        await due(f);
        const lock = await db.connect();
        let running: ReturnType<typeof watch> | undefined;
        try {
          await lock.query("BEGIN");
          await lock.query(
            "SELECT user_id FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
            [f.owner.id],
          );
          running = watch();
          await vi.waitFor(
            async () =>
              expect(
                (
                  await db.query(
                    "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND application_name='synthetic-ops-worker' AND wait_event_type='Lock'",
                    [name],
                  )
                ).rows[0].n,
              ).toBe(1),
            { timeout: 5000 },
          );
          running.child.kill("SIGTERM");
          await lock.query("ROLLBACK");
          const result = await running.closed;
          expect(result).toMatchObject({ code: 0, stderr: "" });
          expect(result.stdout).toContain('"expired":1');
          expect(result.stdout).toContain('"status":"stopped"');
          expect(await expireOneSyntheticReservation(worker, true)).toBe(false);
          expect(
            (
              await db.query(
                "SELECT available_points::int available,reserved_points::int held FROM impuls.account_balances WHERE user_id=$1",
                [f.owner.id],
              )
            ).rows,
          ).toEqual([{ available: 120, held: 0 }]);
          expect(
            (
              await db.query(
                "SELECT count(*)::int n FROM impuls.ledger_entries WHERE redemption_id=$1 AND kind='reward_expiration'",
                [f.id],
              )
            ).rows,
          ).toEqual([{ n: 1 }]);
        } finally {
          await lock.query("ROLLBACK");
          lock.release();
          if (running) {
            running.child.kill("SIGKILL");
            await running.closed;
          }
        }
      },
      15000,
    );
    it.skipIf(process.platform === "win32")(
      "real Node stop deadline terminates stalled cleanup with a neutral exit 1",
      async () => {
        const source = pathToFileURL(
          path.resolve("apps/worker/src/shutdown.ts"),
        ).href;
        const child = spawn(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `
      import { installWorkerShutdown } from ${JSON.stringify(source)};
      installWorkerShutdown({ mode: 'reservation_expiry', reportTimeout: event => console.error(JSON.stringify(event)) });
      setInterval(() => {}, 1000); // Represents unresolved pool cleanup; keeps the process alive.
      console.log('ready');
    `,
          ],
          { windowsHide: true },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (d) => {
          stdout += String(d);
        });
        child.stderr.on("data", (d) => {
          stderr += String(d);
        });
        const closed = new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
        try {
          await vi.waitFor(() => expect(stdout).toContain("ready"));
          const at = performance.now();
          child.kill("SIGTERM");
          expect(await closed).toBe(1);
          expect(performance.now() - at).toBeGreaterThanOrEqual(19500);
          expect(performance.now() - at).toBeLessThan(25000);
          expect(stderr).toBe(
            '{"mode":"reservation_expiry","error":"WORKER_STOP_TIMEOUT"}\n',
          );
        } finally {
          child.kill("SIGKILL");
          await closed;
        }
      },
      30000,
    );
  },
);
