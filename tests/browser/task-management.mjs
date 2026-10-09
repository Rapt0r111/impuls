import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { Pool } from "pg";
import { mockHomeFallback } from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3000";
const managerId = "11111111-1111-4111-8111-111111111111";
const scopeId = "22222222-2222-4222-8222-222222222222";
const ruleId = "33333333-3333-4333-8333-333333333333";
const firstTaskId = "44444444-4444-4444-8444-444444444444";
const secondTaskId = "55555555-5555-4555-8555-555555555555";
const cursorId = "66666666-6666-4666-8666-666666666666";
const memberId = "77777777-7777-4777-8777-777777777777";
const at = "2026-09-30T08:00:00.000Z";
const dueAt = "2035-01-01T09:00:00.000Z";
const title = "Синтетическая задача для проверки области управления";
const criteria =
  "Сверить два синтетических источника и сохранить краткий вывод.";
const body = {
  scopeId,
  ruleSetId: ruleId,
  title,
  criteria,
  categoryCode: "synthetic-check",
  priority: "high",
  dueAt,
  fundXp: 17,
  fundPoints: 9,
};

function task(overrides = {}) {
  return {
    id: firstTaskId,
    title,
    criteria,
    categoryCode: "synthetic-check",
    priority: "high",
    status: "draft",
    dueAt,
    fundXp: 17,
    fundPoints: 9,
    ruleSetId: ruleId,
    ruleVersion: 7,
    version: 1,
    updatedAt: at,
    scope: { id: scopeId, kind: "group", name: "Синтетическая область" },
    assignee: null,
    ...overrides,
  };
}

const member = { id: memberId, displayName: "Синтетический исполнитель" };
const defaultOptions = {
  scopes: [
    {
      id: scopeId,
      kind: "group",
      name: "Синтетическая область",
      canCreate: true,
      canAssign: true,
      assignees: [member],
    },
  ],
  ruleSets: [{ id: ruleId, version: 7 }],
};

const browser = await chromium.launch({ headless: true });
const captureDir =
  process.env.TEST_SCREENSHOT_DIR ?? "docs/verification/assets";
await mkdir(captureDir, { recursive: true });
let scenarios = 0;

function json(route, data, status = 200, headers = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(data),
  });
}

function apiError(route, status, code) {
  return json(
    route,
    { code, message: "Synthetic browser scenario", requestId: managerId },
    status,
  );
}

async function pageFixture(width, mode = "success") {
  const page = await browser.newPage({
    viewport: { width, height: 820 },
    reducedMotion: "reduce",
    timezoneId: "Europe/Moscow",
  });
  const calls = [];
  const errors = [];
  const consoleErrors = [];
  const responses = [];
  const dialogs = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    consoleErrors.push(text);
    if (
      !/Failed to load resource: the server responded with a status of (401|403|409|422|429|503)/.test(
        text,
      ) &&
      !text.includes("net::ERR_INTERNET_DISCONNECTED")
    )
      errors.push(text);
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/tasks")) responses.push(response);
  });
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    if (mode === "dirty-nav-dismiss" && dialogs.length === 1)
      await dialog.dismiss();
    else await dialog.accept();
  });

  let managed = [task()];
  let currentOptions = structuredClone(defaultOptions);
  let created = false;
  let assigned = false;
  let delayedOptionsRelease;
  let delayedCreateRelease;
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.closingCalls=[];window.Telegram={WebApp:{initData:'',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},enableClosingConfirmation(){window.closingCalls.push(true)},disableClosingConfirmation(){window.closingCalls.push(false)}}}",
    }),
  );

  await page.route(
    (url) => url.pathname === "/api/v1/me",
    (route) =>
      json(route, {
        user: { id: managerId, displayName: "Синтетический руководитель" },
        csrfToken: "test-csrf",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (route) =>
      json(route, {
        permissions: [
          {
            action: "task.create",
            scope: {
              id: scopeId,
              kind: "group",
              name: "Синтетическая область",
            },
            validUntil: null,
          },
          {
            action: "task.assign",
            scope: {
              id: scopeId,
              kind: "group",
              name: "Синтетическая область",
            },
            validUntil: null,
          },
        ],
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks" && url.search === "",
    (route) =>
      route.request().method() === "GET"
        ? json(route, { items: [], nextCursor: null })
        : route.fallback(),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/task-management/options",
    async (route) => {
      if (mode === "options-loading")
        await new Promise((resolve) => {
          delayedOptionsRelease = resolve;
        });
      if (mode === "options-failed") return apiError(route, 503, "UNAVAILABLE");
      if (mode === "options-revoked")
        return apiError(route, 403, "ACCESS_REVOKED");
      if (mode === "disabled") {
        currentOptions = {
          scopes: [
            {
              ...defaultOptions.scopes[0],
              canCreate: false,
              canAssign: false,
              assignees: [],
            },
          ],
          ruleSets: [],
        };
      }
      return json(route, currentOptions, 200, {
        "Cache-Control": "private, no-store",
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/task-management",
    (route) => {
      if (mode === "list-failed") return apiError(route, 503, "UNAVAILABLE");
      if (mode === "list-revoked")
        return apiError(route, 403, "ACCESS_REVOKED");
      const params = new URL(route.request().url()).searchParams;
      if (mode === "pagination") {
        if (params.has("cursor"))
          return json(route, {
            items: [
              task({ id: secondTaskId, title: "Вторая синтетическая задача" }),
            ],
            nextCursor: null,
          });
        return json(route, { items: [task()], nextCursor: cursorId });
      }
      return json(route, {
        items: mode === "empty" ? [] : managed,
        nextCursor: null,
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks" && url.search !== "",
    (route) =>
      route.request().method() === "GET"
        ? json(route, { items: [], nextCursor: null })
        : route.fallback(),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks",
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      const requestBody = request.postDataJSON();
      const call = {
        action: "create",
        key: request.headers()["idempotency-key"],
        body: requestBody,
      };
      calls.push(call);
      assert.equal(request.headers()["x-csrf-token"], "test-csrf");
      assert.equal(request.headers().origin, origin);
      assert.match(call.key, /^[0-9a-f-]{36}$/i);
      if (
        (mode === "create-rate-limited" && calls.length === 1) ||
        (mode === "create-lost-rate-limited" && calls.length === 2)
      )
        return json(route, { code: "RATE_LIMITED" }, 429, {
          "Retry-After": "12",
        });
      if (mode === "create-lost-rate-limited" && calls.length === 1)
        return route.abort("internetdisconnected");
      if (mode === "create-conflict")
        return apiError(route, 409, "TASK_CONFLICT");
      if (mode === "create-rules")
        return apiError(route, 422, "TASK_RULES_INVALID");
      if (mode === "create-unauthorized")
        return apiError(route, 401, "UNAUTHORIZED");
      if (mode === "create-forbidden")
        return apiError(route, 403, "ACCESS_REVOKED");
      if (mode === "create-network" && calls.length === 1)
        return route.abort("internetdisconnected");
      if (mode === "create-unavailable" && calls.length === 1)
        return apiError(route, 503, "UNAVAILABLE");
      if (mode === "create-pending" && calls.length === 1)
        await new Promise((resolve) => {
          delayedCreateRelease = resolve;
        });
      assert.deepEqual(requestBody, body);
      created = true;
      managed = [task()];
      return json(route, { task: task() }, 201, {
        "Cache-Control": "private, no-store",
      });
    },
  );
  await page.route(
    (url) => /\/api\/v1\/tasks\/[0-9a-f-]+\/assign$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      const requestBody = request.postDataJSON();
      const call = {
        action: "assign",
        key: request.headers()["idempotency-key"],
        body: requestBody,
      };
      calls.push(call);
      assert.equal(request.headers()["x-csrf-token"], "test-csrf");
      assert.equal(request.headers().origin, origin);
      assert.match(call.key, /^[0-9a-f-]{36}$/i);
      assert.equal(requestBody.assigneeId, memberId);
      assert.equal(requestBody.expectedVersion, 1);
      if (
        (mode === "assign-rate-limited" && calls.length === 1) ||
        (mode === "assign-lost-rate-limited" && calls.length === 2)
      )
        return json(route, { code: "RATE_LIMITED" }, 429, {
          "Retry-After": "12",
        });
      if (mode === "assign-lost-rate-limited" && calls.length === 1)
        return route.abort("internetdisconnected");
      if (mode === "assign-stale") return apiError(route, 409, "TASK_CONFLICT");
      if (mode === "assign-inactive")
        return apiError(route, 422, "TASK_ASSIGNEE_INVALID");
      if (mode === "assign-unauthorized")
        return apiError(route, 401, "UNAUTHORIZED");
      if (mode === "assign-forbidden")
        return apiError(route, 403, "ACCESS_REVOKED");
      if (
        mode === "assign-unavailable" &&
        calls.filter((item) => item.action === "assign").length === 1
      )
        return apiError(route, 503, "UNAVAILABLE");
      assigned = true;
      const result = task({ status: "assigned", version: 2, assignee: member });
      managed = [result];
      return json(route, { task: result }, 200, {
        "Cache-Control": "private, no-store",
      });
    },
  );

  await page.goto(origin, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await page
    .getByRole("button", { name: "Постановка задач", exact: true })
    .click();
  if (
    mode !== "options-loading" &&
    mode !== "options-failed" &&
    mode !== "options-revoked" &&
    mode !== "list-failed" &&
    mode !== "list-revoked"
  ) {
    await page
      .getByRole("heading", { name: "Управление задачами", exact: true })
      .waitFor();
  }
  return {
    page,
    calls,
    errors,
    consoleErrors,
    responses,
    dialogs,
    state: () => ({ created, assigned, managed }),
    releaseOptions: () => delayedOptionsRelease?.(),
    releaseCreate: () => delayedCreateRelease?.(),
  };
}

async function fillCreateForm(page, setTitle = title) {
  await page.getByLabel("Область", { exact: true }).selectOption(scopeId);
  await page.getByLabel("Версия правил", { exact: true }).selectOption(ruleId);
  await page.getByLabel("Название", { exact: true }).fill(setTitle);
  await page.getByLabel("Критерии результата", { exact: true }).fill(criteria);
  await page
    .getByLabel("Код категории", { exact: true })
    .fill("synthetic-check");
  await page.getByLabel("Приоритет", { exact: true }).selectOption("high");
  await page.getByLabel("Срок", { exact: true }).fill("2035-01-01T12:00");
  await page.getByLabel("Фонд XP", { exact: true }).fill("17");
  await page.getByLabel("Фонд баллов", { exact: true }).fill("9");
}

async function createAndAssign(page, calls, dialogs, keyboard = false) {
  const createButton = page.getByRole("button", {
    name: "Создать черновик",
    exact: true,
  });
  if (keyboard) await createButton.press("Enter");
  else await createButton.click();
  await page.getByRole("status").filter({ hasText: "создан" }).waitFor();
  assert.deepEqual(calls[0].body, body);
  assert.equal(calls[0].action, "create");
  assert.match(calls[0].key, /^[0-9a-f-]{36}$/i);
  assert.equal(calls[0].key, calls[0].key.toLowerCase());
  await page.getByLabel(/Активный участник области/).selectOption(memberId);
  const assignButton = page.getByRole("button", {
    name: "Назначить",
    exact: true,
  });
  if (keyboard) await assignButton.press("Space");
  else await assignButton.click();
  await page
    .getByText("Задача назначена участнику Синтетический исполнитель.", {
      exact: true,
    })
    .waitFor();
  assert.equal(calls[1].action, "assign");
  assert.deepEqual(calls[1].body, { assigneeId: memberId, expectedVersion: 1 });
  assert.notEqual(calls[0].key, calls[1].key);
  assert.ok(dialogs.at(-1)?.includes(title));
  assert.ok(dialogs.at(-1)?.includes("Версия правил: 7"));
  assert.ok(dialogs.at(-1)?.includes("версия задачи: 1"));
  assert.ok(dialogs.at(-1)?.includes("17 XP · 9 баллов"));
}

async function assertNoOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}

async function dbFlow() {
  if (!process.env.TEST_DATABASE_URL || !process.env.TEST_APP_ORIGIN) return;
  const dbOrigin = process.env.TEST_APP_ORIGIN;
  assert.ok(
    ["127.0.0.1", "localhost"].includes(new URL(dbOrigin).hostname),
    "DB browser fixture requires a local test server",
  );
  const secret = process.env.CSRF_SECRET;
  assert.ok(secret, "CSRF_SECRET is needed for a genuine DB-backed session");
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const users = [randomUUID(), randomUUID()];
  const [manager, participant] = users;
  const dbTitle = `${title} ${randomUUID()}`;
  const scope = randomUUID();
  const rules = randomUUID();
  let dbRuleVersion;
  const sessionTokens = users.map(() => randomBytes(32).toString("base64url"));
  const hashes = sessionTokens.map((token) =>
    createHash("sha256").update(token).digest(),
  );
  let createdId;
  try {
    for (const [index, id] of users.entries()) {
      await admin.query(
        "INSERT INTO impuls.users (id,telegram_id,display_name,active) VALUES ($1,$2,$3,true)",
        [
          id,
          randomInt(8_000_000_000_000, 9_000_000_000_000),
          index === 0
            ? "Synthetic task manager browser"
            : "Synthetic task participant browser",
        ],
      );
    }
    await admin.query(
      "INSERT INTO impuls.access_scopes (id,kind,name) VALUES ($1,'group','Synthetic browser management scope')",
      [scope],
    );
    await admin.query(
      "INSERT INTO impuls.rule_sets (id,version_number,definition,effective_from,created_by) VALUES ($1,$2,'{\"mode\":\"synthetic\"}',clock_timestamp()-interval '1 minute',$3)",
      [rules, randomInt(100_000, 2_000_000_000), manager],
    );
    dbRuleVersion = (
      await admin.query(
        "SELECT version_number FROM impuls.rule_sets WHERE id=$1",
        [rules],
      )
    ).rows[0].version_number;
    await admin.query(
      "INSERT INTO impuls.role_bindings (user_id,action,scope_id,granted_by,reason) VALUES ($1,'task.create',$2,$1,'Synthetic browser fixture'),($1,'task.assign',$2,$1,'Synthetic browser fixture')",
      [manager, scope],
    );
    for (const [index, id] of users.entries())
      await admin.query(
        "INSERT INTO impuls.sessions (user_id,session_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
        [id, hashes[index]],
      );
    await admin.query(
      "INSERT INTO impuls.task_scope_members (scope_id,user_id,synthetic,valid_from) VALUES ($1,$2,true,clock_timestamp()-interval '1 minute')",
      [scope, participant],
    );

    async function authenticatedPage(index, width) {
      const context = await browser.newContext({
        viewport: { width, height: 820 },
        reducedMotion: "reduce",
        timezoneId: "Europe/Moscow",
      });
      await context.addCookies([
        {
          name: "impuls_session",
          value: sessionTokens[index],
          url: dbOrigin,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      const errors = [];
      const mutationRequests = [];
      const mutationResponses = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          /\/api\/v1\/tasks(?:\/[^/]+\/assign)?$/.test(
            new URL(request.url()).pathname,
          )
        ) {
          mutationRequests.push({
            origin: request.headers().origin,
            csrf: request.headers()["x-csrf-token"],
            key: request.headers()["idempotency-key"],
          });
        }
      });
      page.on("response", (response) => {
        if (
          response.request().method() === "POST" &&
          /\/api\/v1\/tasks(?:\/[^/]+\/assign)?$/.test(
            new URL(response.url()).pathname,
          )
        )
          mutationResponses.push(response);
      });
      await mockHomeFallback(page);
      await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: "window.Telegram={WebApp:{initData:'',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){}}}",
        }),
      );
      await page.goto(dbOrigin, { waitUntil: "domcontentloaded" });
      return { page, context, errors, mutationRequests, mutationResponses };
    }

    const managerPage = await authenticatedPage(0, 390);
    try {
      const page = managerPage.page;
      await page
        .getByRole("heading", { name: "Доступ подтверждён", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Постановка задач", exact: true })
        .click();
      await page.getByLabel("Область", { exact: true }).selectOption(scope);
      await page
        .getByLabel("Версия правил", { exact: true })
        .selectOption(rules);
      await page.getByLabel("Название", { exact: true }).fill(dbTitle);
      await page
        .getByLabel("Критерии результата", { exact: true })
        .fill(criteria);
      await page
        .getByLabel("Код категории", { exact: true })
        .fill("synthetic-check");
      await page.getByLabel("Приоритет", { exact: true }).selectOption("high");
      await page.getByLabel("Срок", { exact: true }).fill("2035-01-01T12:00");
      await page.getByLabel("Фонд XP", { exact: true }).fill("17");
      await page.getByLabel("Фонд баллов", { exact: true }).fill("9");
      await page
        .getByRole("button", { name: "Создать черновик", exact: true })
        .click();
      await page.getByRole("status").filter({ hasText: "создан" }).waitFor();
      const taskRow = page.getByRole("listitem").filter({ hasText: dbTitle });
      await taskRow.waitFor();
      const created = await admin.query(
        "SELECT id FROM impuls.tasks WHERE created_by=$1 AND title=$2",
        [manager, dbTitle],
      );
      assert.equal(created.rowCount, 1);
      createdId = created.rows[0].id;
      const auditAfterCreate = await admin.query(
        "SELECT action FROM impuls.audit_events WHERE task_id=$1 ORDER BY created_at",
        [createdId],
      );
      assert.deepEqual(
        auditAfterCreate.rows.map((row) => row.action),
        ["task.create"],
      );

      await page
        .getByLabel(/Активный участник области/)
        .selectOption(participant);
      let confirmText;
      page.once("dialog", async (dialog) => {
        confirmText = dialog.message();
        await dialog.accept();
      });
      await page
        .getByRole("button", { name: "Назначить", exact: true })
        .click();
      await page.getByText(new RegExp("Задача назначена участнику")).waitFor();
      assert.match(
        confirmText,
        /Synthetic task participant browser|Синтетический/,
      );
      assert.ok(confirmText.includes(dbTitle));
      assert.ok(confirmText.includes(criteria));
      assert.ok(
        confirmText.includes(
          `Версия правил: ${dbRuleVersion} · версия задачи: 1`,
        ),
      );
      assert.ok(confirmText.includes("17 XP · 9 баллов"));

      const state = await admin.query(
        `SELECT t.status,t.version,
          (SELECT count(*)::int FROM impuls.task_assignments a WHERE a.task_id=t.id) assignments,
          (SELECT count(*)::int FROM impuls.audit_events e WHERE e.task_id=t.id AND e.action IN ('task.create','task.assign')) audit_events,
          (SELECT count(*)::int FROM impuls.notification_outbox o WHERE o.task_id=t.id AND o.kind='task.assigned') outbox,
          (SELECT count(*)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) ledger_entries
         FROM impuls.tasks t WHERE t.id=$1`,
        [createdId],
      );
      assert.deepEqual(state.rows[0], {
        status: "assigned",
        version: 2,
        assignments: 1,
        audit_events: 2,
        outbox: 1,
        ledger_entries: 0,
      });
      const assignment = await admin.query(
        "SELECT user_id FROM impuls.task_assignments WHERE task_id=$1",
        [createdId],
      );
      assert.equal(assignment.rows[0].user_id, participant);
      const outbox = await admin.query(
        "SELECT recipient_id FROM impuls.notification_outbox WHERE task_id=$1 AND kind='task.assigned'",
        [createdId],
      );
      assert.equal(outbox.rows[0].recipient_id, participant);
      const audit = await admin.query(
        "SELECT action FROM impuls.audit_events WHERE task_id=$1 ORDER BY created_at",
        [createdId],
      );
      assert.deepEqual(
        audit.rows.map((row) => row.action),
        ["task.create", "task.assign"],
      );
      assert.deepEqual(managerPage.errors, []);
      assert.equal(managerPage.mutationRequests.length, 2);
      assert.deepEqual(
        managerPage.mutationResponses.map((response) => response.status()),
        [201, 200],
      );
      assert.ok(
        managerPage.mutationResponses.every((response) =>
          response.headers()["cache-control"]?.includes("no-store"),
        ),
      );
      for (const request of managerPage.mutationRequests) {
        assert.equal(request.origin, dbOrigin);
        assert.equal(
          request.csrf,
          createHmac("sha256", secret)
            .update(`csrf:${sessionTokens[0]}`)
            .digest("base64url"),
        );
        assert.match(request.key, /^[0-9a-f-]{36}$/i);
      }
    } finally {
      await managerPage.context.close();
    }

    const participantPage = await authenticatedPage(1, 390);
    try {
      const page = participantPage.page;
      await page
        .getByRole("heading", { name: "Доступ подтверждён", exact: true })
        .waitFor();
      const assignedTask = page.getByRole("button", {
        name: new RegExp(dbTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      });
      await assignedTask.waitFor();
      assert.match(await assignedTask.innerText(), /Назначена/);
      await assignedTask.click();
      await page.getByText("Критерии задачи", { exact: true }).waitFor();
      assert.deepEqual(participantPage.errors, []);
    } finally {
      await participantPage.context.close();
    }
  } finally {
    try {
      if (!createdId) {
        const partial = await admin.query(
          "SELECT id FROM impuls.tasks WHERE created_by=$1 AND title=$2",
          [manager, dbTitle],
        );
        createdId = partial.rows[0]?.id;
      }
      if (createdId) {
        await admin.query(
          "DELETE FROM impuls.notification_outbox WHERE task_id=$1",
          [createdId],
        );
        await admin.query("DELETE FROM impuls.audit_events WHERE task_id=$1", [
          createdId,
        ]);
        await admin.query(
          "DELETE FROM impuls.task_assignments WHERE task_id=$1",
          [createdId],
        );
        await admin.query("DELETE FROM impuls.tasks WHERE id=$1", [createdId]);
      }
      await admin.query(
        "DELETE FROM impuls.idempotency_records WHERE actor_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.task_scope_members WHERE scope_id=$1",
        [scope],
      );
      await admin.query(
        "DELETE FROM impuls.role_bindings WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query(
        "DELETE FROM impuls.sessions WHERE user_id=ANY($1::uuid[])",
        [users],
      );
      await admin.query("DELETE FROM impuls.rule_sets WHERE id=$1", [rules]);
      await admin.query("DELETE FROM impuls.access_scopes WHERE id=$1", [
        scope,
      ]);
      await admin.query("DELETE FROM impuls.users WHERE id=ANY($1::uuid[])", [
        users,
      ]);
    } finally {
      await admin.end();
    }
  }
}

try {
  for (const width of [320, 360, 390, 1280]) {
    const { page, calls, errors, dialogs, responses } = await pageFixture(
      width,
      width === 320 ? "dirty-nav-dismiss" : "success",
    );
    await page
      .getByText("только синтетические значения", { exact: false })
      .waitFor();
    await fillCreateForm(page);
    assert.equal(await page.evaluate(() => window.closingCalls.at(-1)), true);
    await page.screenshot({
      path: `${captureDir}/f03-management-${width}.png`,
      fullPage: true,
    });
    await assertNoOverflow(page);
    const firstField = page.getByLabel("Область", { exact: true });
    await firstField.focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .getByLabel("Версия правил", { exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    if (width === 320) {
      await page
        .getByRole("button", { name: "Мои задачи", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Постановка задач", exact: true })
        .waitFor();
      assert.ok(
        dialogs.some((message) => message.includes("Текст ещё не отправлен")),
      );
      await page
        .getByRole("heading", { name: "Управление задачами", exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.closingCalls.at(-1)), true);
    }
    await createAndAssign(page, calls, dialogs, width === 390);
    await page.waitForFunction(() => window.closingCalls.at(-1) === false);
    assert.equal(await page.evaluate(() => window.closingCalls.at(-1)), false);
    assert.equal(calls.length, 2);
    assert.equal(
      responses.some(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/tasks" &&
          response.status() === 201 &&
          response.headers()["cache-control"]?.includes("no-store"),
      ),
      true,
    );
    assert.equal(
      responses.some(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname.endsWith("/assign") &&
          response.status() === 200 &&
          response.headers()["cache-control"]?.includes("no-store"),
      ),
      true,
    );
    await assertNoOverflow(page);
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }

  for (const mode of [
    "create-network",
    "create-unavailable",
    "assign-unavailable",
    "create-rate-limited",
    "create-lost-rate-limited",
    "assign-rate-limited",
    "assign-lost-rate-limited",
  ]) {
    const { page, calls, errors } = await pageFixture(360, mode);
    if (mode.startsWith("assign")) {
      await page.getByLabel(/Активный участник области/).selectOption(memberId);
      await page
        .getByRole("button", { name: "Назначить", exact: true })
        .click();
    } else {
      await fillCreateForm(page);
      await page
        .getByRole("button", { name: "Создать черновик", exact: true })
        .click();
    }
    const retry = page.getByRole("button", {
      name: "Повторить тот же запрос",
      exact: true,
    });
    await retry.waitFor();
    if (mode.includes("lost-rate-limited")) await retry.click();
    if (mode.includes("rate-limited")) {
      await page
        .getByText(
          "Слишком много действий. Подождите 12 с, затем повторите тот же запрос. Данные сохранены.",
          { exact: true },
        )
        .waitFor();
      await assertNoOverflow(page);
    }
    const frozen = calls.at(-1);
    if (mode.startsWith("assign"))
      assert.equal(
        await page.getByLabel(/Активный участник области/).isDisabled(),
        true,
      );
    else
      assert.equal(
        await page.getByLabel("Название", { exact: true }).isDisabled(),
        true,
      );
    await retry.click();
    if (mode.startsWith("assign"))
      await page
        .getByText("Задача назначена участнику Синтетический исполнитель.", {
          exact: true,
        })
        .waitFor();
    else await page.getByRole("status").filter({ hasText: "создан" }).waitFor();
    assert.equal(calls.length, mode.includes("lost-rate-limited") ? 3 : 2);
    for (const call of calls) assert.deepEqual(calls[0], call);
    assert.deepEqual(calls[0], frozen);
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }

  {
    const { page, releaseCreate } = await pageFixture(390, "create-pending");
    await fillCreateForm(page);
    await page
      .getByRole("button", { name: "Создать черновик", exact: true })
      .click();
    await page.getByRole("button", { name: "Создаём…", exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("Название", { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByLabel("Срок", { exact: true }).isDisabled(),
      true,
    );
    releaseCreate();
    await page.getByRole("status").filter({ hasText: "создан" }).waitFor();
    await page.close();
    scenarios++;
  }

  for (const mode of [
    "create-conflict",
    "create-rules",
    "assign-stale",
    "assign-inactive",
  ]) {
    const { page, calls } = await pageFixture(320, mode);
    if (mode.startsWith("create")) {
      await fillCreateForm(page);
      await page
        .getByRole("button", { name: "Создать черновик", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({
          hasText:
            mode === "create-conflict"
              ? "Данные задачи изменились"
              : "Версия правил недоступна",
        })
        .waitFor();
      assert.equal(
        await page.getByLabel("Название", { exact: true }).inputValue(),
        title,
      );
      assert.equal(
        await page
          .getByLabel("Критерии результата", { exact: true })
          .inputValue(),
        criteria,
      );
    } else {
      await page.getByLabel(/Активный участник области/).selectOption(memberId);
      await page
        .getByRole("button", { name: "Назначить", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({
          hasText:
            mode === "assign-stale"
              ? "Данные задачи изменились"
              : "Исполнитель больше не активен",
        })
        .waitFor();
      assert.equal(await page.getByText(title, { exact: true }).count(), 1);
      if (mode === "assign-inactive")
        assert.equal(
          await page.getByLabel(/Активный участник области/).inputValue(),
          memberId,
        );
    }
    assert.equal(calls.length, 1);
    await page.close();
    scenarios++;
  }

  for (const mode of [
    "create-unauthorized",
    "create-forbidden",
    "assign-unauthorized",
    "assign-forbidden",
    "options-revoked",
    "list-revoked",
  ]) {
    const { page } = await pageFixture(390, mode);
    if (mode.startsWith("create")) {
      await fillCreateForm(page);
      await page
        .getByRole("button", { name: "Создать черновик", exact: true })
        .click();
    } else if (mode.startsWith("assign")) {
      await page.getByLabel(/Активный участник области/).selectOption(memberId);
      await page
        .getByRole("button", { name: "Назначить", exact: true })
        .click();
    }
    await page
      .getByRole("heading", {
        name: /Доступ отозван|Не удалось подтвердить сессию/,
      })
      .waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Управление задачами" }).count(),
      0,
    );
    await page.close();
    scenarios++;
  }

  for (const mode of [
    "options-loading",
    "options-failed",
    "list-failed",
    "empty",
    "pagination",
    "disabled",
  ]) {
    const { page, errors, releaseOptions } = await pageFixture(320, mode);
    if (mode === "options-loading") {
      await page
        .getByRole("status")
        .filter({ hasText: "Загружаем области" })
        .waitFor();
      releaseOptions();
      await page
        .getByRole("heading", { name: "Управление задачами" })
        .waitFor();
    } else if (mode === "options-failed") {
      await page
        .getByRole("alert")
        .filter({ hasText: "Не удалось загрузить данные" })
        .waitFor();
    } else if (mode === "list-failed") {
      await page
        .getByRole("alert")
        .filter({ hasText: "Не удалось загрузить данные" })
        .waitFor();
    } else if (mode === "empty") {
      await page
        .getByText("Доступных задач пока нет.", { exact: true })
        .waitFor();
    } else if (mode === "pagination") {
      await page
        .getByRole("button", { name: "Показать ещё", exact: true })
        .click();
      await page
        .getByText("Вторая синтетическая задача", { exact: true })
        .waitFor();
    } else {
      assert.equal(
        await page.getByRole("heading", { name: "Новая задача" }).count(),
        0,
      );
      assert.equal(
        await page.getByLabel(/Активный участник области/).count(),
        0,
      );
    }
    await assertNoOverflow(page);
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }

  {
    const { page, errors } = await pageFixture(320);
    await fillCreateForm(page);
    await page.addStyleTag({
      content:
        ".task-mgmt, .task-mgmt * { font-size: 20px !important; line-height: 1.6 !important; }",
    });
    await page
      .locator(".task-mgmt__hint")
      .first()
      .evaluate((element) => {
        element.textContent = "Область".repeat(10);
      });
    await page.locator(".task-mgmt__item-title h4").evaluate((element) => {
      element.textContent = "ДлинноеНазвание".repeat(8);
    });
    await page.locator(".task-mgmt__assign label span").evaluate((element) => {
      element.textContent = "Область".repeat(10);
    });
    await assertNoOverflow(page);
    await page
      .getByRole("button", { name: "Создать черновик", exact: true })
      .focus();
    await page.screenshot({
      path: `${captureDir}/f03-management-large-text-320.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  await dbFlow();
  if (process.env.TEST_DATABASE_URL && process.env.TEST_APP_ORIGIN) scenarios++;
  console.log(`Task management browser scenarios passed: ${scenarios}`);
} finally {
  await browser.close();
}
