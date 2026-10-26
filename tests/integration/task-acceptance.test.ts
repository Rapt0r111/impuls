import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  reviewTaskSubmission,
  type TaskReviewInput,
} from "../../packages/domain/src/tasks/reviews";
import { readAccountLedger } from "../../packages/domain/src/ledger/read";
import { getAssignedTask } from "../../packages/domain/src/tasks/read";
import {
  accountLedgerResponseSchema,
  ledgerListQuerySchema,
} from "../../packages/contracts/src/ledger";
import { taskAcceptanceResponseSchema } from "../../packages/contracts/src/reviews";
import { createCsrfToken } from "../../packages/domain/src/auth/session";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "F03/F04 synthetic acceptance transactions",
  () => {
    const admin = new Pool({ connectionString: url });
    const runtime = new Pool({
      connectionString: url,
      options: "-c role=impuls_app",
      max: 6,
    });
    const users = [randomUUID(), randomUUID(), randomUUID()];
    const [reviewer, participant, second] = users as [string, string, string];
    const tokens = users.map(() => randomBytes(32).toString("base64url"));
    const hashes = tokens.map((token) =>
      createHash("sha256").update(token).digest(),
    );
    const scope = randomUUID();
    const neighbour = randomUUID();
    const rules = randomUUID();
    const invalidRules = randomUUID();
    const tasks: string[] = [];
    let creditedXp = 0;
    let creditedPoints = 0;
    beforeAll(async () => {
      for (const [index, user] of users.entries())
        await admin.query(
          "INSERT INTO impuls.users (id, telegram_id, display_name, active) VALUES ($1,$2,$3,true)",
          [
            user,
            randomInt(8_000_000_000_000, 9_000_000_000_000),
            `Synthetic acceptance ${index}`,
          ],
        );
      for (const id of [scope, neighbour])
        await admin.query(
          "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'project','Synthetic acceptance scope')",
          [id],
        );
      for (const id of [rules, invalidRules])
        await admin.query(
          "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,$3::jsonb,now(),$4)",
          [
            id,
            randomInt(1_000_000, 2_000_000_000),
            JSON.stringify(
              id === rules
                ? {
                    mode: "synthetic",
                    economy: { approved: true },
                    timeZone: "Europe/Moscow",
                    acceptance: { enabled: true },
                  }
                : {},
            ),
            reviewer,
          ],
        );
      for (const user of users)
        await admin.query(
          "INSERT INTO impuls.role_bindings (user_id,action,scope_id,granted_by,reason) VALUES ($1,'task.review',$2,$3,'Synthetic test')",
          [user, scope, reviewer],
        );
      await sessions();
    });
    async function sessions() {
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      for (const [index, user] of users.entries())
        await admin.query(
          "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
          [user, hashes[index]],
        );
    }
    async function fixture(
      options: {
        scope?: string;
        owner?: string;
        rules?: string;
        xp?: number;
        points?: number;
      } = {},
    ) {
      const id = randomUUID();
      tasks.push(id);
      const xp = options.xp ?? 17,
        points = options.points ?? 9;
      await admin.query(
        "INSERT INTO impuls.tasks (id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points) VALUES ($1,$2,$3,$4,$5,'Independent criteria','test','normal','in_review',now(),$6,$7)",
        [
          id,
          options.scope ?? scope,
          options.rules ?? rules,
          reviewer,
          `Synthetic acceptance task ${id}`,
          xp,
          points,
        ],
      );
      const owner = options.owner ?? participant;
      await admin.query(
        "INSERT INTO impuls.task_assignments (task_id,user_id) VALUES ($1,$2)",
        [id, owner],
      );
      const sub = (
        await admin.query<{ id: string }>(
          "INSERT INTO impuls.submissions (task_id,author_id,attempt_number,text) VALUES ($1,$2,1,'Synthetic independently checked evidence') RETURNING id",
          [id, owner],
        )
      ).rows[0]!.id;
      const input: TaskReviewInput = {
        actorId: reviewer,
        sessionHash: hashes[0]!,
        submissionId: sub,
        expectedVersion: 1,
        reason: "Independently verified both criteria",
        idempotencyKey: randomUUID(),
        action: "accept",
        allowSyntheticAccrual: true,
      };
      return { id, sub, input, xp, points };
    }
    async function state(id: string) {
      return (
        await admin.query(
          "SELECT status,version,(SELECT count(*)::int FROM impuls.reviews r JOIN impuls.submissions s ON s.id=r.submission_id WHERE s.task_id=t.id) reviews,(SELECT count(*)::int FROM impuls.ledger_entries WHERE task_id=t.id) entries FROM impuls.tasks t WHERE id=$1",
          [id],
        )
      ).rows[0];
    }
    async function totals() {
      const actual = (
        await admin.query(
          "SELECT lifetime_xp::int AS xp,available_points::int AS points,reserved_points::int AS reserved FROM impuls.account_balances WHERE user_id=$1",
          [participant],
        )
      ).rows[0];
      expect(actual).toEqual({
        xp: creditedXp,
        points: creditedPoints,
        reserved: 0,
      });
      const sum = (
        await admin.query(
          "SELECT coalesce(sum(amount) FILTER(WHERE currency='xp'),0)::int AS xp,coalesce(sum(amount) FILTER(WHERE currency='points'),0)::int AS points FROM impuls.ledger_entries WHERE user_id=$1",
          [participant],
        )
      ).rows[0];
      expect(sum).toEqual({ xp: creditedXp, points: creditedPoints });
    }
    afterAll(async () => {
      try {
        for (const table of ["notification_outbox", "audit_events"])
          await admin.query(
            `DELETE FROM impuls.${table} WHERE review_id IN (SELECT r.id FROM impuls.reviews r JOIN impuls.submissions s ON s.id=r.submission_id WHERE s.task_id=ANY($1::uuid[]))`,
            [tasks],
          );
        await admin.query(
          "DELETE FROM impuls.ledger_entries WHERE task_id=ANY($1::uuid[])",
          [tasks],
        );
        await admin.query(
          "DELETE FROM impuls.account_balances WHERE user_id=ANY($1::uuid[])",
          [users],
        );
        await admin.query(
          "DELETE FROM impuls.idempotency_records WHERE actor_id=ANY($1::uuid[])",
          [users],
        );
        await admin.query(
          "DELETE FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id=ANY($1::uuid[]))",
          [tasks],
        );
        for (const table of ["submissions", "task_assignments"])
          await admin.query(
            `DELETE FROM impuls.${table} WHERE task_id=ANY($1::uuid[])`,
            [tasks],
          );
        await admin.query("DELETE FROM impuls.tasks WHERE id=ANY($1::uuid[])", [
          tasks,
        ]);
        await admin.query(
          "DELETE FROM impuls.rule_sets WHERE id=ANY($1::uuid[])",
          [[rules, invalidRules]],
        );
        await admin.query(
          "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
          [users],
        );
        await admin.query(
          "DELETE FROM impuls.access_scopes WHERE id=ANY($1::uuid[])",
          [[scope, neighbour]],
        );
        await admin.query(
          "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
          [users],
        );
        await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
          users,
        ]);
      } finally {
        await Promise.all([runtime.end(), admin.end()]);
      }
    });
    it("credits the saved fund once, with immutable receipt, audit and neutral outbox", async () => {
      const f = await fixture();
      const first = await reviewTaskSubmission(runtime, f.input);
      expect(first.kind).toBe("ok");
      if (first.kind !== "ok") throw new Error("Acceptance failed");
      const response = taskAcceptanceResponseSchema.parse(first.response);
      expect(response.task).toEqual({
        id: f.id,
        status: "accepted",
        version: 2,
      });
      expect(response.award).toMatchObject({
        xp: 17,
        points: 9,
        timeZone: "Europe/Moscow",
      });
      creditedXp += 17;
      creditedPoints += 9;
      expect(await reviewTaskSubmission(runtime, f.input)).toEqual(first);
      expect(
        await reviewTaskSubmission(runtime, {
          ...f.input,
          reason: "Changed payload",
        }),
      ).toEqual({ kind: "idempotency_conflict" });
      expect(await state(f.id)).toEqual({
        status: "accepted",
        version: 2,
        reviews: 1,
        entries: 2,
      });
      expect(
        (await getAssignedTask(runtime, participant, f.id))?.latestReview,
      ).toMatchObject({
        decision: "accept",
        fundXp: 17,
        fundPoints: 9,
        reason: f.input.reason,
      });
      const events = (
        await admin.query(
          "SELECT a.action,a.reason,a.diff,o.kind,o.mode,o.status FROM impuls.audit_events a JOIN impuls.notification_outbox o ON o.review_id=a.review_id WHERE a.review_id=$1",
          [response.review.id],
        )
      ).rows[0];
      expect(events).toMatchObject({
        action: "task.accept",
        reason: f.input.reason,
        kind: "task.accepted",
        mode: null,
        status: "pending",
        diff: { xp: 17, points: 9, to: "accepted" },
      });
      expect(JSON.stringify(events)).not.toContain(
        "Synthetic independently checked evidence",
      );
      await totals();
    });
    it("rejects disabled economics, absent synthetic rules, neighbour scope, own report and stale version", async () => {
      const f = await fixture();
      expect(
        await reviewTaskSubmission(runtime, {
          ...f.input,
          allowSyntheticAccrual: false,
        }),
      ).toEqual({ kind: "economy_disabled" });
      const invalid = await fixture({ rules: invalidRules });
      expect(await reviewTaskSubmission(runtime, invalid.input)).toEqual({
        kind: "economy_rules_invalid",
      });
      const other = await fixture({ scope: neighbour });
      expect(await reviewTaskSubmission(runtime, other.input)).toEqual({
        kind: "not_found",
      });
      const own = await fixture({ owner: reviewer });
      expect(await reviewTaskSubmission(runtime, own.input)).toEqual({
        kind: "self_review",
      });
      expect(
        await reviewTaskSubmission(runtime, { ...f.input, expectedVersion: 2 }),
      ).toEqual({ kind: "conflict", currentVersion: 1 });
      for (const test of [f, invalid, other, own])
        expect(await state(test.id)).toMatchObject({
          status: "in_review",
          reviews: 0,
          entries: 0,
        });
      await totals();
    });
    it("checks recipient access and reviewer session before both acceptance and replay", async () => {
      const f = await fixture();
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        participant,
      ]);
      try {
        expect(await reviewTaskSubmission(runtime, f.input)).toEqual({
          kind: "recipient_revoked",
        });
      } finally {
        await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
          participant,
        ]);
        await sessions();
      }
      expect(
        await reviewTaskSubmission(runtime, {
          ...f.input,
          sessionHash: randomBytes(32),
        }),
      ).toEqual({ kind: "unauthorized" });
      const first = await reviewTaskSubmission(runtime, f.input);
      expect(first.kind).toBe("ok");
      creditedXp += 17;
      creditedPoints += 9;
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        reviewer,
      ]);
      try {
        expect(await reviewTaskSubmission(runtime, f.input)).toEqual({
          kind: "revoked",
        });
      } finally {
        await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
          reviewer,
        ]);
        await sessions();
      }
      await totals();
    });
    it("serializes two reviewers and acceptance against return", async () => {
      for (const decision of ["accept", "return"] as const) {
        const f = await fixture();
        const results = await Promise.all([
          reviewTaskSubmission(runtime, f.input),
          reviewTaskSubmission(runtime, {
            ...f.input,
            actorId: second,
            sessionHash: hashes[2]!,
            action: decision,
            idempotencyKey: randomUUID(),
          }),
        ]);
        expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
        expect(results.filter((r) => r.kind === "conflict")).toHaveLength(1);
        const s = await state(f.id);
        expect(s.reviews).toBe(1);
        if (s.status === "accepted") {
          creditedXp += 17;
          creditedPoints += 9;
          expect(s.entries).toBe(2);
        } else {
          expect(s.status).toBe("needs_work");
          expect(s.entries).toBe(0);
        }
        await totals();
      }
    });
    it("sums simultaneous different tasks for one recipient without lost updates", async () => {
      const a = await fixture({ xp: 31, points: 7 }),
        b = await fixture({ xp: 47, points: 13 });
      const results = await Promise.all([
        reviewTaskSubmission(runtime, a.input),
        reviewTaskSubmission(runtime, {
          ...b.input,
          actorId: second,
          sessionHash: hashes[2]!,
        }),
      ]);
      expect(results.map((r) => r.kind)).toEqual(["ok", "ok"]);
      creditedXp += 78;
      creditedPoints += 20;
      await totals();
    });
    it("rolls back decision, entries, projection, audit, outbox and idempotency on late failure", async () => {
      const f = await fixture();
      await expect(
        reviewTaskSubmission(runtime, {
          ...f.input,
          requestId: "invalid-uuid",
        }),
      ).rejects.toMatchObject({ code: "22P02" });
      expect(await state(f.id)).toEqual({
        status: "in_review",
        version: 1,
        reviews: 0,
        entries: 0,
      });
      expect(
        (
          await admin.query(
            "SELECT id FROM impuls.idempotency_records WHERE key=$1",
            [f.input.idempotencyKey],
          )
        ).rowCount,
      ).toBe(0);
      await totals();
    });
    it("returns an owned consistent journal with stable same-time currency pagination and empty zero balances", async () => {
      const first = await readAccountLedger(runtime, participant, hashes[1]!, {
        limit: 1,
      });
      if (first.kind !== "ok") throw new Error("Missing ledger");
      accountLedgerResponseSchema.parse(first.response);
      expect(first.response.balance).toMatchObject({
        lifetimeXp: creditedXp,
        availablePoints: creditedPoints,
        reservedPoints: 0,
      });
      const ids = new Set<string>();
      let page = first;
      while (true) {
        for (const entry of page.response.entries) {
          expect(ids.has(entry.id)).toBe(false);
          ids.add(entry.id);
        }
        if (!page.response.nextCursor) break;
        const query = ledgerListQuerySchema.parse({
          limit: 1,
          cursor: page.response.nextCursor,
        });
        const next = await readAccountLedger(
          runtime,
          participant,
          hashes[1]!,
          query,
        );
        if (next.kind !== "ok") throw new Error("Next page denied");
        page = next;
      }
      expect(ids.size).toBe(
        (
          await admin.query(
            "SELECT id FROM impuls.ledger_entries WHERE user_id=$1",
            [participant],
          )
        ).rowCount,
      );
      const empty = await readAccountLedger(runtime, reviewer, hashes[0]!);
      expect(empty).toMatchObject({
        kind: "ok",
        response: {
          entries: [],
          balance: {
            lifetimeXp: 0,
            availablePoints: 0,
            reservedPoints: 0,
            version: 0,
            updatedAt: null,
          },
        },
      });
      expect(await readAccountLedger(runtime, participant, hashes[0]!)).toEqual(
        { kind: "unauthorized" },
      );
      await admin.query("UPDATE impuls.users SET active=false WHERE id=$1", [
        participant,
      ]);
      try {
        expect(
          await readAccountLedger(runtime, participant, hashes[1]!),
        ).toEqual({ kind: "revoked" });
      } finally {
        await admin.query("UPDATE impuls.users SET active=true WHERE id=$1", [
          participant,
        ]);
        await sessions();
      }
    });
    it("keeps balance and entries in one snapshot when acceptance commits between their reads", async () => {
      const f = await fixture({ xp: 29, points: 3 });
      const before = { xp: creditedXp, points: creditedPoints };
      let committed = false;
      // Only scheduling is instrumented. Both reads and the interleaved
      // acceptance run against PostgreSQL with the real runtime role.
      const observed = new Proxy(runtime, {
        get(pool, key) {
          if (key === "connect")
            return async () => {
              const client = await pool.connect();
              return new Proxy(client, {
                get(connection, member) {
                  if (member === "query")
                    return async (sql: string, values?: unknown[]) => {
                      const result = await connection.query(sql, values);
                      if (
                        sql.includes("FROM impuls.account_balances") &&
                        !committed
                      ) {
                        expect(
                          (await reviewTaskSubmission(runtime, f.input)).kind,
                        ).toBe("ok");
                        committed = true;
                      }
                      return result;
                    };
                  const value = Reflect.get(connection, member);
                  return typeof value === "function"
                    ? value.bind(connection)
                    : value;
                },
              });
            };
          const value = Reflect.get(pool, key);
          return typeof value === "function" ? value.bind(pool) : value;
        },
      });
      const result = await readAccountLedger(
        observed,
        participant,
        hashes[1]!,
        { limit: 50 },
      );
      expect(committed).toBe(true);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("Snapshot denied");
      expect(result.response.balance).toMatchObject({
        lifetimeXp: before.xp,
        availablePoints: before.points,
      });
      expect(
        result.response.entries.some((entry) => entry.task.id === f.id),
      ).toBe(false);
      creditedXp += 29;
      creditedPoints += 3;
      await totals();
      const next = await readAccountLedger(runtime, participant, hashes[1]!, {
        limit: 50,
      });
      expect(next).toMatchObject({
        kind: "ok",
        response: {
          balance: { lifetimeXp: creditedXp, availablePoints: creditedPoints },
        },
      });
      if (next.kind === "ok")
        expect(
          next.response.entries.filter((entry) => entry.task.id === f.id),
        ).toHaveLength(2);
    });
    it("records a zero fund explicitly without changing either balance", async () => {
      const f = await fixture({ xp: 0, points: 0 });
      const result = await reviewTaskSubmission(runtime, f.input);
      expect(result).toMatchObject({
        kind: "ok",
        response: { award: { xp: 0, points: 0 } },
      });
      expect(await state(f.id)).toMatchObject({
        status: "accepted",
        entries: 2,
      });
      await totals();
    });
    it("rolls back all staged credits if session expiry occurs while waiting for the balance lock", async () => {
      const f = await fixture();
      const blocker = await admin.connect();
      let pending: ReturnType<typeof reviewTaskSubmission> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT user_id FROM impuls.account_balances WHERE user_id=$1 FOR UPDATE",
          [participant],
        );
        await admin.query(
          "UPDATE impuls.sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE user_id=$1",
          [reviewer],
        );
        pending = reviewTaskSubmission(runtime, f.input);
        let waiting = false;
        for (let n = 0; n < 100; n++) {
          const found = await admin.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'INSERT INTO impuls.account_balances%'",
          );
          if (found.rowCount) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await admin.query("SELECT pg_sleep(1.05)");
        await blocker.query("COMMIT");
        expect(await pending).toEqual({ kind: "unauthorized" });
        expect(await state(f.id)).toEqual({
          status: "in_review",
          version: 1,
          reviews: 0,
          entries: 0,
        });
        await totals();
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        if (pending) await pending;
        await sessions();
      }
    });
    it("prevents runtime edits/deletes to entries, audit and outbox, and duplicate currency credit", async () => {
      for (const table of [
        "ledger_entries",
        "audit_events",
        "notification_outbox",
      ]) {
        const acl = (
          await admin.query(
            "SELECT has_table_privilege('impuls_app',$1,'UPDATE') AS update,has_table_privilege('impuls_app',$1,'DELETE') AS delete,(SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass) AS rls",
            [`impuls.${table}`],
          )
        ).rows[0];
        expect(acl).toEqual({ update: false, delete: false, rls: true });
        await expect(
          runtime.query(`DELETE FROM impuls.${table} WHERE false`),
        ).rejects.toMatchObject({ code: "42501" });
      }
      await expect(
        runtime.query(
          "INSERT INTO impuls.ledger_entries SELECT gen_random_uuid(),user_id,review_id,task_id,task_title,rule_set_id,rule_version,currency,kind,amount,mode,season_key,time_zone,version,created_at,updated_at FROM impuls.ledger_entries WHERE user_id=$1 LIMIT 1",
          [participant],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
    it.skipIf(!process.env.TEST_APP_ORIGIN || !process.env.CSRF_SECRET)(
      "runs acceptance and owned ledger through actual HTTP and browser",
      async () => {
        const origin = process.env.TEST_APP_ORIGIN!;
        if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
          throw new Error("Local only");
        const f = await fixture({ xp: 23, points: 11 });
        const endpoint = `${origin}/api/v1/submissions/${f.sub}/review`;
        const headers = {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: `impuls_session=${tokens[0]}`,
          "X-CSRF-Token": createCsrfToken(tokens[0]!, process.env.CSRF_SECRET!),
          "Idempotency-Key": f.input.idempotencyKey,
        };
        const body = JSON.stringify({
          action: "accept",
          expectedVersion: 1,
          reason: f.input.reason,
        });
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, Origin: "https://invalid.example" },
              body,
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers: { ...headers, "X-CSRF-Token": "invalid" },
              body,
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...JSON.parse(body), fundXp: 9999 }),
            })
          ).status,
        ).toBe(400);
        const browser = await chromium.launch({ headless: true });
        try {
          const ctx = await browser.newContext({
            viewport: { width: 390, height: 740 },
          });
          await ctx.addCookies([
            {
              name: "impuls_session",
              value: tokens[0]!,
              url: origin,
              httpOnly: true,
              sameSite: "Lax",
            },
          ]);
          const page = await ctx.newPage();
          await page.route(
            "https://telegram.org/js/telegram-web-app.js",
            (route) =>
              route.fulfill({
                contentType: "application/javascript",
                body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){}}}",
              }),
          );
          await page.goto(origin);
          await page
            .getByRole("button", { name: "Открыть очередь", exact: true })
            .click();
          await page
            .getByRole("button", {
              name: new RegExp(`Synthetic acceptance task ${f.id}`),
            })
            .click();
          await page
            .getByRole("radio", { name: "Принять результат", exact: true })
            .check();
          await page
            .getByLabel("Основание приёмки", { exact: true })
            .fill(f.input.reason);
          await page
            .getByRole("checkbox", {
              name: "Подтверждаю результат и указанный фонд",
            })
            .check();
          await page
            .getByRole("button", {
              name: "Подтвердить приёмку и начисление",
              exact: true,
            })
            .click();
          await page
            .getByText("Результат принят. Начислено 23 XP и 11 баллов", {
              exact: false,
            })
            .waitFor();
          creditedXp += 23;
          creditedPoints += 11;
          await totals();
          const ctx2 = await browser.newContext({
            viewport: { width: 320, height: 740 },
          });
          await ctx2.addCookies([
            {
              name: "impuls_session",
              value: tokens[1]!,
              url: origin,
              httpOnly: true,
              sameSite: "Lax",
            },
          ]);
          const p = await ctx2.newPage();
          await p.route(
            "https://telegram.org/js/telegram-web-app.js",
            (route) =>
              route.fulfill({
                contentType: "application/javascript",
                body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}",
              }),
          );
          await p.goto(origin);
          await p.getByRole("button", { name: "Ещё", exact: true }).click();
          await p
            .getByRole("button", { name: "Баланс и журнал", exact: true })
            .click();
          await p.getByText(`${creditedXp} XP`, { exact: true }).waitFor();
          await p
            .getByText(`Synthetic acceptance task ${f.id}`, { exact: true })
            .first()
            .waitFor();
          const response = await fetch(`${origin}/api/v1/me/ledger`, {
            headers: { Cookie: `impuls_session=${tokens[1]}` },
          });
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toContain("no-store");
          accountLedgerResponseSchema.parse(await response.json());
          expect(
            (
              await fetch(`${origin}/api/v1/me/ledger?userId=${reviewer}`, {
                headers: { Cookie: `impuls_session=${tokens[1]}` },
              })
            ).status,
          ).toBe(400);
        } finally {
          await browser.close();
        }
      },
      30_000,
    );
  },
);
