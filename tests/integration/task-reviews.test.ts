import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import { Pool } from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  reviewListResponseSchema,
  taskReturnResponseSchema,
} from "../../packages/contracts/src/reviews";
import {
  listReviewQueue,
  returnTaskSubmission,
  type TaskReturnInput,
} from "../../packages/domain/src/tasks/reviews";
import { getAssignedTask } from "../../packages/domain/src/tasks/read";
import { mutateAssignedTask } from "../../packages/domain/src/tasks/write";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("F02/F03 scoped return transactions", () => {
  const admin = new Pool({ connectionString: url });
  const runtime = new Pool({
    connectionString: url,
    options: "-c role=impuls_app",
    max: 6,
  });
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest();
  const participantToken = randomBytes(32).toString("base64url");
  const participantHash = createHash("sha256")
    .update(participantToken)
    .digest();
  const secondHash = randomBytes(32);
  const users: string[] = [];
  const scopes: string[] = [];
  const tasks: string[] = [];
  let rules: string;
  let reviewer: string;
  let participant: string;
  let second: string;
  beforeAll(async () => {
    for (const name of ["Reviewer", "Participant", "Second reviewer"])
      users.push(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
            [
              randomInt(8_000_000_000_000, 9_000_000_000_000),
              `Synthetic ${name}`,
            ],
          )
        ).rows[0]!.id,
      );
    [reviewer, participant, second] = users as [string, string, string];
    for (const name of ["Own scope", "Neighbour scope"])
      scopes.push(
        (
          await admin.query<{ id: string }>(
            "INSERT INTO impuls.access_scopes (kind, name) VALUES ('project', $1) RETURNING id",
            [`Synthetic ${name}`],
          )
        ).rows[0]!.id,
      );
    rules = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by) VALUES ($1, '{}', now(), $2) RETURNING id",
        [randomInt(1_000_000, 2_000_000_000), reviewer],
      )
    ).rows[0]!.id;
    for (const actor of [reviewer, second]) await grant(actor, scopes[0]!);
    await sessions();
  });
  async function grant(actor: string, scope: string, options = "now(), NULL") {
    await admin.query(
      `INSERT INTO impuls.role_bindings (user_id, action, scope_id, granted_by, reason, valid_from, valid_until) VALUES ($1, 'task.review', $2, $3, 'Synthetic review permission', ${options})`,
      [actor, scope, reviewer],
    );
  }
  async function sessions() {
    await admin.query(
      "DELETE FROM impuls.sessions WHERE user_id = ANY($1::uuid[])",
      [users],
    );
    for (const user of users)
      await admin.query(
        "INSERT INTO impuls.sessions (user_id, session_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [
          user,
          user === reviewer
            ? hash
            : user === participant
              ? participantHash
              : secondHash,
        ],
      );
  }
  async function fixture(scope = scopes[0]!, owner = participant) {
    const taskId = randomUUID();
    tasks.push(taskId);
    await admin.query(
      `INSERT INTO impuls.tasks (id, scope_id, rule_set_id, created_by, title, criteria, category_code, priority, status, due_at, fund_xp, fund_points) VALUES ($1, $2, $3, $4, $5, 'Independent evidence', 'test', 'normal', 'in_review', now(), 100, 30)`,
      [taskId, scope, rules, reviewer, `Synthetic review task ${taskId}`],
    );
    await admin.query(
      "INSERT INTO impuls.task_assignments (task_id, user_id) VALUES ($1, $2)",
      [taskId, owner],
    );
    const sub = (
      await admin.query<{ id: string }>(
        "INSERT INTO impuls.submissions (task_id, author_id, attempt_number, text) VALUES ($1, $2, 1, 'Synthetic report') RETURNING id",
        [taskId, owner],
      )
    ).rows[0]!.id;
    return {
      taskId,
      input: {
        actorId: reviewer,
        sessionHash: hash,
        submissionId: sub,
        expectedVersion: 1,
        reason: "Add independently checked evidence",
        idempotencyKey: randomUUID(),
      } satisfies TaskReturnInput,
    };
  }
  async function state(taskId: string) {
    return (
      await admin.query(
        `SELECT status, version, fund_xp, fund_points, (SELECT count(*)::int FROM impuls.reviews r JOIN impuls.submissions s ON s.id = r.submission_id WHERE s.task_id = t.id) AS decisions FROM impuls.tasks t WHERE id = $1`,
        [taskId],
      )
    ).rows[0];
  }
  afterAll(async () => {
    try {
      for (const table of ["notification_outbox", "audit_events"])
        await admin.query(
          `DELETE FROM impuls.${table} WHERE review_id IN (SELECT r.id FROM impuls.reviews r JOIN impuls.submissions s ON s.id = r.submission_id WHERE s.task_id = ANY($1::uuid[]))`,
          [tasks],
        );
      await admin.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id = ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.reviews WHERE submission_id IN (SELECT id FROM impuls.submissions WHERE task_id = ANY($1::uuid[]))",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.submissions WHERE task_id = ANY($1::uuid[])",
        [tasks],
      );
      await admin.query(
        "DELETE FROM impuls.task_assignments WHERE task_id = ANY($1::uuid[])",
        [tasks],
      );
      await admin.query("DELETE FROM impuls.tasks WHERE id = ANY($1::uuid[])", [
        tasks,
      ]);
      await admin.query("DELETE FROM impuls.rule_sets WHERE id = $1", [rules]);
      await admin.query(
        "DELETE FROM impuls.role_bindings WHERE user_id = ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.access_scopes WHERE id = ANY($1::uuid[])",
        [scopes],
      );
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id = ANY($1::uuid[])",
        [users],
      );
      await admin.query("DELETE FROM impuls.users WHERE id = ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await Promise.all([admin.end(), runtime.end()]);
    }
  });
  it("lists only exact scope and excludes own reports, with bounded cursor pagination", async () => {
    const own = await fixture();
    const neighbour = await fixture(scopes[1]!);
    const self = await fixture(scopes[0]!, reviewer);
    const queue = reviewListResponseSchema.parse(
      await listReviewQueue(runtime, reviewer, { limit: 1 }),
    );
    expect(queue.items.map((i) => i.submissionId)).toEqual([
      own.input.submissionId,
    ]);
    expect(queue.nextCursor).toBeNull();
    const another = await fixture();
    const first = await listReviewQueue(runtime, reviewer, { limit: 1 });
    expect(first.nextCursor).not.toBeNull();
    const last = await listReviewQueue(runtime, reviewer, {
      cursor: first.nextCursor!,
      limit: 1,
    });
    expect(
      [...first.items, ...last.items].map((i) => i.submissionId).sort(),
    ).toEqual([own.input.submissionId, another.input.submissionId].sort());
    expect(await returnTaskSubmission(runtime, neighbour.input)).toEqual({
      kind: "not_found",
    });
    expect(await returnTaskSubmission(runtime, self.input)).toEqual({
      kind: "self_review",
    });
    expect((await listReviewQueue(runtime, participant)).items).toEqual([]);
    // Remove queued fixtures from later tests without discarding their history.
    await admin.query(
      "UPDATE impuls.tasks SET status = 'cancelled' WHERE id = ANY($1::uuid[])",
      [[own.taskId, another.taskId, neighbour.taskId, self.taskId]],
    );
  });
  it("records reason once, preserves funds and lets the participant resume and submit a new attempt", async () => {
    const { taskId, input } = await fixture();
    const result = await returnTaskSubmission(runtime, input);
    if (result.kind !== "ok") throw new Error("Return rejected");
    expect(taskReturnResponseSchema.parse(result.response).task).toEqual({
      id: taskId,
      status: "needs_work",
      version: 2,
    });
    expect(await returnTaskSubmission(runtime, input)).toEqual(result);
    expect(
      await returnTaskSubmission(runtime, { ...input, reason: "Changed" }),
    ).toEqual({ kind: "idempotency_conflict" });
    expect(await state(taskId)).toEqual({
      status: "needs_work",
      version: 2,
      fund_xp: 100,
      fund_points: 30,
      decisions: 1,
    });
    expect(
      (await getAssignedTask(runtime, participant, taskId))?.latestReview,
    ).toMatchObject({ reason: input.reason, submissionId: input.submissionId });
    expect(
      (
        await mutateAssignedTask(runtime, {
          action: "start",
          taskId,
          actorId: participant,
          sessionHash: participantHash,
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
        })
      ).kind,
    ).toBe("ok");
    expect(
      (
        await mutateAssignedTask(runtime, {
          action: "submit",
          taskId,
          actorId: participant,
          sessionHash: participantHash,
          expectedVersion: 3,
          idempotencyKey: randomUUID(),
          text: "Independent new evidence",
        })
      ).kind,
    ).toBe("ok");
    expect(
      await returnTaskSubmission(runtime, {
        ...input,
        expectedVersion: 4,
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ kind: "conflict", currentVersion: 4 });
    expect(
      (await listReviewQueue(runtime, reviewer)).items.find(
        (i) => i.task.id === taskId,
      )?.attemptNumber,
    ).toBe(2);
  });
  it("serializes duplicate requests and two reviewers into one immutable decision", async () => {
    const a = await fixture();
    const repeats = await Promise.all([
      returnTaskSubmission(runtime, a.input),
      returnTaskSubmission(runtime, a.input),
    ]);
    expect(repeats[0]!.kind).toBe("ok");
    expect(repeats[1]).toEqual(repeats[0]);
    const b = await fixture();
    const race = await Promise.all([
      returnTaskSubmission(runtime, b.input),
      returnTaskSubmission(runtime, {
        ...b.input,
        actorId: second,
        sessionHash: secondHash,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(race.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
    expect((await state(b.taskId)).decisions).toBe(1);
  });
  it("rolls back invalid reason and stale version without leaving an idempotency record", async () => {
    const { taskId, input } = await fixture();
    expect(
      await returnTaskSubmission(runtime, { ...input, expectedVersion: 9 }),
    ).toEqual({ kind: "conflict", currentVersion: 1 });
    await expect(
      returnTaskSubmission(runtime, { ...input, reason: " " }),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await state(taskId)).toEqual({
      status: "in_review",
      version: 1,
      fund_xp: 100,
      fund_points: 30,
      decisions: 0,
    });
    expect(
      (
        await admin.query(
          "SELECT id FROM impuls.idempotency_records WHERE key = $1",
          [input.idempotencyKey],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("checks permissions and session before replay; expired, future and revoked permissions grant nothing", async () => {
    const { input } = await fixture();
    expect((await returnTaskSubmission(runtime, input)).kind).toBe("ok");
    expect(
      await returnTaskSubmission(runtime, {
        ...input,
        sessionHash: randomBytes(32),
      }),
    ).toEqual({ kind: "unauthorized" });
    await admin.query(
      "UPDATE impuls.role_bindings SET revoked_at = now() WHERE user_id = $1",
      [reviewer],
    );
    expect(await returnTaskSubmission(runtime, input)).toEqual({
      kind: "not_found",
    });
    await grant(
      reviewer,
      scopes[0]!,
      "now() - interval '2 days', now() - interval '1 day'",
    );
    await grant(reviewer, scopes[0]!, "now() + interval '1 day', NULL");
    await sessions();
    expect((await listReviewQueue(runtime, reviewer)).items).toEqual([]);
    expect(await returnTaskSubmission(runtime, input)).toEqual({
      kind: "not_found",
    });
    await grant(reviewer, scopes[0]!);
    await sessions();
    await admin.query(
      "UPDATE impuls.sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1",
      [reviewer],
    );
    expect(await returnTaskSubmission(runtime, input)).toEqual({
      kind: "unauthorized",
    });
    await sessions();
    await admin.query("UPDATE impuls.users SET active = false WHERE id = $1", [
      reviewer,
    ]);
    expect(await returnTaskSubmission(runtime, input)).toEqual({
      kind: "revoked",
    });
    await admin.query("UPDATE impuls.users SET active = true WHERE id = $1", [
      reviewer,
    ]);
    await sessions();
  });
  it("keeps review rows immutable and private under runtime ACL/RLS", async () => {
    const acl = (
      await admin.query(
        `SELECT has_table_privilege('impuls_app', 'impuls.reviews', 'SELECT') AS read, has_table_privilege('impuls_app', 'impuls.reviews', 'INSERT') AS insert, has_table_privilege('impuls_app', 'impuls.reviews', 'UPDATE') AS update, has_table_privilege('impuls_app', 'impuls.reviews', 'DELETE') AS delete, (SELECT relrowsecurity FROM pg_class WHERE oid = 'impuls.reviews'::regclass) AS rls, EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE c.oid = 'impuls.reviews'::regclass AND a.grantee = 0) AS public_access`,
      )
    ).rows[0];
    expect(acl).toEqual({
      read: true,
      insert: true,
      update: false,
      delete: false,
      rls: true,
      public_access: false,
    });
  });
  it("refuses a permission revoked while return is waiting for its binding lock", async () => {
    const { input, taskId } = await fixture();
    const blocker = await admin.connect();
    let result: ReturnType<typeof returnTaskSubmission> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM impuls.role_bindings WHERE user_id = $1 FOR UPDATE",
        [reviewer],
      );
      result = returnTaskSubmission(runtime, input);
      // Wait on observed PostgreSQL lock state rather than guessing race timing.
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const locks = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT b.id FROM impuls.role_bindings b%'",
        );
        if (locks.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await blocker.query(
        "UPDATE impuls.role_bindings SET revoked_at = now() WHERE user_id = $1",
        [reviewer],
      );
      await blocker.query("COMMIT");
      expect(await result).toEqual({ kind: "not_found" });
      expect((await state(taskId)).decisions).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (result) await result;
      await grant(reviewer, scopes[0]!);
      await sessions();
    }
  });
  it("refuses a session that expires while waiting for the task lock", async () => {
    const { input, taskId } = await fixture();
    const blocker = await admin.connect();
    let result: ReturnType<typeof returnTaskSubmission> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM impuls.tasks WHERE id = $1 FOR UPDATE",
        [taskId],
      );
      await admin.query(
        "UPDATE impuls.sessions SET expires_at = clock_timestamp() + interval '1 second' WHERE user_id = $1",
        [reviewer],
      );
      result = returnTaskSubmission(runtime, input);
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const locks = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%WHERE sub.id = $1 FOR UPDATE OF t%'",
        );
        if (locks.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await admin.query("SELECT pg_sleep(1.05)");
      await blocker.query("COMMIT");
      expect(await result).toEqual({ kind: "unauthorized" });
      expect((await state(taskId)).decisions).toBe(0);
      expect(
        (
          await admin.query(
            "SELECT id FROM impuls.idempotency_records WHERE key = $1",
            [input.idempotencyKey],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (result) await result;
      await sessions();
    }
  });
  it.skipIf(!process.env.TEST_APP_ORIGIN || !process.env.CSRF_SECRET)(
    "runs a browser return against real API and PostgreSQL",
    async () => {
      const origin = process.env.TEST_APP_ORIGIN!;
      if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
        throw new Error("Local test server required");
      const { taskId, input } = await fixture();
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 390, height: 740 },
        });
        await context.addCookies([
          {
            name: "impuls_session",
            value: token,
            url: origin,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
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
          .getByRole("heading", { name: "Очередь проверки", exact: true })
          .waitFor();
        await page
          .getByRole("button", {
            name: new RegExp(`Synthetic review task ${taskId}`),
          })
          .click();
        await page
          .getByLabel("Причина возврата", { exact: true })
          .fill(input.reason);
        await context.setOffline(true);
        await page
          .getByRole("button", { name: "Вернуть на доработку", exact: true })
          .click();
        await page
          .getByText(
            "Нет соединения. Причина сохранена; восстановите сеть и повторите тот же запрос.",
            { exact: true },
          )
          .waitFor();
        expect((await state(taskId)).decisions).toBe(0);
        await context.setOffline(false);
        await page
          .getByRole("button", { name: "Повторить тот же запрос", exact: true })
          .click();
        await page.getByText("Возврат сохранён.", { exact: false }).waitFor();
        expect(await state(taskId)).toEqual({
          status: "needs_work",
          version: 2,
          fund_xp: 100,
          fund_points: 30,
          decisions: 1,
        });
        expect(
          (await getAssignedTask(runtime, participant, taskId))?.latestReview
            ?.reason,
        ).toBe(input.reason);
        expect(errors).toEqual([]);
        const participantContext = await browser.newContext({
          viewport: { width: 320, height: 740 },
        });
        await participantContext.addCookies([
          {
            name: "impuls_session",
            value: participantToken,
            url: origin,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const participantPage = await participantContext.newPage();
        participantPage.on("pageerror", (error) => errors.push(error.message));
        await participantPage.route(
          "https://telegram.org/js/telegram-web-app.js",
          (route) =>
            route.fulfill({
              contentType: "application/javascript",
              body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}",
            }),
        );
        await participantPage.goto(origin);
        // Участник открывается на «Главной»; задачи — в отдельной вкладке.
        await participantPage
          .getByRole("button", { name: "Мои задачи", exact: true })
          .click();
        await participantPage
          .getByRole("button", {
            name: new RegExp(`Synthetic review task ${taskId}`),
          })
          .click();
        await participantPage
          .getByText(input.reason, { exact: true })
          .waitFor();
        await participantPage
          .getByRole("button", { name: "Продолжить работу", exact: true })
          .click();
        await participantPage
          .getByLabel("Отчёт о выполнении", { exact: true })
          .fill("Synthetic independently checked revised result");
        await participantPage
          .getByRole("button", { name: "Отправить на проверку", exact: true })
          .click();
        await participantPage
          .getByText(
            "Отчёт отправлен на проверку. XP и баллы ещё не начислены.",
            { exact: true },
          )
          .waitFor();
        expect(await state(taskId)).toEqual({
          status: "in_review",
          version: 4,
          fund_xp: 100,
          fund_points: 30,
          decisions: 1,
        });
        expect(
          (await listReviewQueue(runtime, reviewer)).items.find(
            (i) => i.task.id === taskId,
          ),
        ).toMatchObject({
          attemptNumber: 2,
          text: "Synthetic independently checked revised result",
        });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    30_000,
  );
  it.skipIf(!process.env.TEST_APP_ORIGIN || !process.env.CSRF_SECRET)(
    "validates real HTTP queue, return, CSRF, Origin and replay against PostgreSQL",
    async () => {
      const origin = process.env.TEST_APP_ORIGIN;
      const secret = process.env.CSRF_SECRET;
      if (!origin || !secret) return;
      if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
        throw new Error("Local test server required");
      const { input } = await fixture();
      const csrf = createHmac("sha256", secret)
        .update(`csrf:${token}`)
        .digest("base64url");
      const headers = {
        Cookie: `impuls_session=${token}`,
        Origin: origin,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": input.idempotencyKey,
        "Content-Type": "application/json",
      };
      const body = JSON.stringify({
        action: "return",
        expectedVersion: 1,
        reason: input.reason,
      });
      const request = (extra = {}, data = body) =>
        fetch(`${origin}/api/v1/submissions/${input.submissionId}/review`, {
          method: "POST",
          headers: { ...headers, ...extra },
          body: data,
        });
      const queue = await fetch(`${origin}/api/v1/reviews`, { headers });
      expect(queue.status).toBe(200);
      reviewListResponseSchema.parse(await queue.json());
      expect(
        (await request({ Origin: "https://invalid.example" })).status,
      ).toBe(403);
      expect((await request({ "X-CSRF-Token": "bad" })).status).toBe(403);
      expect(
        (
          await request(
            {},
            JSON.stringify({
              action: "accept",
              expectedVersion: 1,
              reason: "Test",
            }),
          )
        ).status,
      ).toBe(422); // A return-only rule version does not enable synthetic accrual.
      const first = await request();
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toContain("no-store");
      const response = taskReturnResponseSchema.parse(await first.json());
      expect(await (await request()).json()).toEqual(response);
      expect(
        (
          await request(
            {},
            JSON.stringify({
              action: "return",
              expectedVersion: 1,
              reason: "Changed",
            }),
          )
        ).status,
      ).toBe(409);
      expect(
        (await fetch(`${origin}/api/v1/reviews?limit=51`, { headers })).status,
      ).toBe(400);
      expect((await fetch(`${origin}/api/v1/reviews`)).status).toBe(401);
    },
  );
});
