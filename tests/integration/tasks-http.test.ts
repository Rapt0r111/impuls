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
  taskStartResponseSchema,
  taskSubmissionResponseSchema,
} from "../../packages/contracts/src/tasks";

const origin = process.env.TEST_APP_ORIGIN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const secret = process.env.CSRF_SECRET;
const integration = origin && databaseUrl && secret ? describe : describe.skip;

integration("F03 real HTTP adapter and PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const token = randomBytes(32).toString("base64url");
  const taskIds: string[] = [];
  let actorId: string;
  let otherId: string;
  let scopeId: string;
  let rulesId: string;
  const csrf = createHmac("sha256", secret ?? "synthetic-unused")
    .update(`csrf:${token}`)
    .digest("base64url");

  beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(new URL(origin!).hostname))
      throw new Error("HTTP fixture requires a local test server");
    for (const name of ["Synthetic HTTP author", "Synthetic HTTP other"]) {
      const result = await pool.query<{ id: string }>(
        "INSERT INTO impuls.users (telegram_id, display_name, active) VALUES ($1, $2, true) RETURNING id",
        [randomInt(7_000_000_000_000, 8_000_000_000_000), name],
      );
      if (!actorId) actorId = result.rows[0]!.id;
      else otherId = result.rows[0]!.id;
    }
    await pool.query(
      "INSERT INTO impuls.sessions (user_id, session_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [actorId, createHash("sha256").update(token).digest()],
    );
    scopeId = (
      await pool.query<{ id: string }>(
        "INSERT INTO impuls.access_scopes (kind, name) VALUES ('project', 'Synthetic HTTP scope') RETURNING id",
      )
    ).rows[0]!.id;
    rulesId = (
      await pool.query<{ id: string }>(
        "INSERT INTO impuls.rule_sets (version_number, definition, effective_from, created_by) VALUES ($1, '{}', now(), $2) RETURNING id",
        [randomInt(1_000_000, 2_000_000_000), actorId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    try {
      await pool.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id = $1",
        [actorId],
      );
      await pool.query(
        "DELETE FROM impuls.submissions WHERE task_id = ANY($1::uuid[])",
        [taskIds],
      );
      await pool.query(
        "DELETE FROM impuls.task_assignments WHERE task_id = ANY($1::uuid[])",
        [taskIds],
      );
      await pool.query("DELETE FROM impuls.tasks WHERE id = ANY($1::uuid[])", [
        taskIds,
      ]);
      if (rulesId)
        await pool.query("DELETE FROM impuls.rule_sets WHERE id = $1", [
          rulesId,
        ]);
      if (scopeId)
        await pool.query("DELETE FROM impuls.access_scopes WHERE id = $1", [
          scopeId,
        ]);
      await pool.query("DELETE FROM impuls.sessions WHERE user_id = $1", [
        actorId,
      ]);
      await pool.query("DELETE FROM impuls.users WHERE id = ANY($1::uuid[])", [
        [actorId, otherId],
      ]);
    } finally {
      await pool.end();
    }
  });

  async function task(ownerId = actorId) {
    const id = randomUUID();
    taskIds.push(id);
    await pool.query(
      `INSERT INTO impuls.tasks (id, scope_id, rule_set_id, created_by, title, criteria, category_code, priority, status, due_at, fund_xp, fund_points)
      VALUES ($1, $2, $3, $4, $5, 'Criteria', 'test', 'normal', 'assigned', now(), 0, 0)`,
      [id, scopeId, rulesId, otherId, `Synthetic HTTP task ${id}`],
    );
    await pool.query(
      "INSERT INTO impuls.task_assignments (task_id, user_id) VALUES ($1, $2)",
      [id, ownerId],
    );
    return id;
  }
  function request(
    id: string,
    body: unknown,
    overrides: Record<string, string> = {},
    submit = false,
  ) {
    return fetch(
      `${origin}/api/v1/tasks/${id}${submit ? "/submissions" : ""}`,
      {
        method: submit ? "POST" : "PATCH",
        headers: {
          Cookie: `impuls_session=${token}`,
          Origin: origin!,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
          "Content-Type": "application/json",
          ...overrides,
        },
        body: JSON.stringify(body),
      },
    );
  }
  async function assertError(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const error = await response.json();
    expect(error.code).toBe(code);
    expect(error.requestId).toBe(response.headers.get("x-request-id"));
  }

  it("enforces Origin, cookie, CSRF, UUID, strict body and no-store before a write", async () => {
    const id = await task();
    const body = { action: "start", expectedVersion: 1 };
    await assertError(
      await request(id, body, { Origin: "https://example.invalid" }),
      403,
      "ORIGIN_DENIED",
    );
    await assertError(
      await request(id, body, { Cookie: "" }),
      401,
      "UNAUTHORIZED",
    );
    await assertError(
      await request(id, body, { "X-CSRF-Token": "invalid" }),
      403,
      "CSRF_DENIED",
    );
    await assertError(
      await request(id, body, { "Idempotency-Key": "invalid" }),
      400,
      "BAD_REQUEST",
    );
    await assertError(await request("invalid-id", body), 404, "NOT_FOUND");
    await assertError(
      await request(id, { ...body, extra: true }),
      400,
      "BAD_REQUEST",
    );
    await assertError(
      await request(
        id,
        { expectedVersion: 1, text: "x".repeat(33000) },
        {},
        true,
      ),
      400,
      "BAD_REQUEST",
    );
    expect(
      (
        await pool.query(
          "SELECT version, status FROM impuls.tasks WHERE id = $1",
          [id],
        )
      ).rows[0],
    ).toEqual({ version: 1, status: "assigned" });
    expect(
      (
        await pool.query(
          "SELECT id FROM impuls.idempotency_records WHERE actor_id = $1",
          [actorId],
        )
      ).rowCount,
    ).toBe(0);
  }, 30_000);

  it("runs the browser against real task routes and confirms its report in PostgreSQL", async () => {
    const id = await task();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 740 },
      });
      await context.addCookies([
        {
          name: "impuls_session",
          value: token,
          url: origin!,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // Only SDK presentation is stubbed; /me, permissions and every task request are real.
      await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
      );
      await page.goto(origin!, { waitUntil: "domcontentloaded" });
      // Участник открывается на «Главной»; задачи — в отдельной вкладке.
      await page
        .getByRole("button", { name: "Мои задачи", exact: true })
        .click();
      await page
        .getByText(`Synthetic HTTP task ${id}`, { exact: true })
        .click();
      await page
        .getByRole("button", { name: "Начать работу", exact: true })
        .click();
      await page
        .getByLabel("Отчёт о выполнении", { exact: true })
        .fill("Synthetic live browser result");
      await context.setOffline(true);
      await page
        .getByRole("button", { name: "Отправить на проверку", exact: true })
        .click();
      await page
        .getByText(
          "Нет соединения. Текст сохранён; восстановите сеть и повторите тот же запрос.",
          { exact: true },
        )
        .waitFor();
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM impuls.submissions WHERE task_id = $1",
            [id],
          )
        ).rows[0]?.count,
      ).toBe(0);
      await context.setOffline(false);
      await page
        .getByRole("button", { name: "Повторить тот же запрос", exact: true })
        .click();
      await page
        .getByText(
          "Отчёт отправлен на проверку. XP и баллы ещё не начислены.",
          { exact: true },
        )
        .waitFor();
      expect(
        (
          await pool.query(
            "SELECT status, version FROM impuls.tasks WHERE id = $1",
            [id],
          )
        ).rows[0],
      ).toEqual({ status: "in_review", version: 3 });
      expect(
        (
          await pool.query(
            "SELECT text, attempt_number FROM impuls.submissions WHERE task_id = $1",
            [id],
          )
        ).rows,
      ).toEqual([{ text: "Synthetic live browser result", attempt_number: 1 }]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("starts, submits 4000 non-ASCII characters, replays, conflicts and hides a foreign task", async () => {
    const id = await task();
    const start = await request(id, { action: "start", expectedVersion: 1 });
    expect(start.status).toBe(200);
    expect(
      taskStartResponseSchema.parse(await start.json()).task,
    ).toMatchObject({ status: "in_progress", version: 2 });
    const key = randomUUID();
    const body = { text: "漢".repeat(4000), expectedVersion: 2 };
    const first = await request(id, body, { "Idempotency-Key": key }, true);
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const response = taskSubmissionResponseSchema.parse(await first.json());
    expect(response.task.status).toBe("in_review");
    const replay = await request(id, body, { "Idempotency-Key": key }, true);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(response);
    await assertError(
      await request(
        id,
        { ...body, text: "Changed" },
        { "Idempotency-Key": key },
        true,
      ),
      409,
      "IDEMPOTENCY_CONFLICT",
    );
    await assertError(await request(id, body, {}, true), 409, "TASK_CONFLICT");
    await assertError(
      await request(await task(otherId), {
        action: "start",
        expectedVersion: 1,
      }),
      404,
      "NOT_FOUND",
    );
    await pool.query("UPDATE impuls.users SET active = false WHERE id = $1", [
      actorId,
    ]);
    await assertError(
      await request(id, body, { "Idempotency-Key": key }, true),
      403,
      "ACCESS_REVOKED",
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM impuls.submissions WHERE task_id = $1",
          [id],
        )
      ).rows[0]?.count,
    ).toBe(1);
  }, 30_000);
});
