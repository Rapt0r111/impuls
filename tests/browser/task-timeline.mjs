import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const actor = uuid(1),
  taskId = uuid(2),
  scope = uuid(3),
  at = "2026-10-01T10:00:00.000Z";
const draft = "Несданный отчёт для проверки сохранения.";
const task = {
  id: taskId,
  title: "Синтетическая задача с историей",
  status: "in_progress",
  priority: "normal",
  dueAt: "2035-01-01T00:00:00.000Z",
  fundXp: 23,
  fundPoints: 11,
  ruleVersion: 1,
  version: 12,
  updatedAt: at,
  criteria: "Проверяемый критерий",
  latestSubmission: null,
  scope: { id: scope, kind: "group", name: "Синтетическая область" },
};
const captureDir =
  process.env.TEST_SCREENSHOT_DIR ?? "test-results/task-timeline";
await mkdir(captureDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
let scenarios = 0;
async function fixture(width, mode = "ready", role = "owner") {
  const page = await browser.newPage({
    viewport: { width, height: 740 },
    reducedMotion: "reduce",
  });
  const state = {
      failure: null,
      count: 12,
      released: mode !== "loading",
      unblock: null,
    },
    calls = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){}}}",
    }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me",
    (route) =>
      json(route, {
        user: { id: actor, displayName: "Синтетический участник" },
        csrfToken: "synthetic-csrf",
      }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me/permissions",
    (route) =>
      json(route, {
        permissions:
          role === "reviewer"
            ? ["task.review", "task.view"].map((action) => ({
                action,
                scope: task.scope,
                validUntil: null,
              }))
            : [],
      }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/tasks",
    (route) => json(route, { items: [task], nextCursor: null }),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/tasks/${taskId}`,
    (route) => json(route, { task }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/reviews",
    (route) =>
      json(route, {
        items: [
          {
            submissionId: uuid(99),
            text: "Синтетический отчёт",
            submittedAt: at,
            attemptNumber: 1,
            acceptance: { enabled: false, mode: null },
            author: { id: uuid(4), displayName: "Синтетический исполнитель" },
            task: { ...task, status: "in_review" },
          },
        ],
        nextCursor: null,
      }),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/tasks/${taskId}/history`,
    (route) => json(route, { taskId, items: [], nextCursor: null, asOf: at }),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/tasks/${taskId}/timeline`,
    async (route) => {
      const url = new URL(route.request().url());
      calls.push(url.search);
      assert.equal(url.searchParams.get("limit"), "10");
      if (!state.released)
        await new Promise((resolve) => {
          state.unblock = resolve;
        });
      if (state.failure === "network")
        return route.abort("internetdisconnected");
      if (state.failure)
        return json(
          route,
          {
            code: "SYNTHETIC_ERROR",
            requestId: actor,
            message: "Synthetic test",
          },
          state.failure,
        );
      const cursor = Number(url.searchParams.get("cursor") ?? state.count + 1);
      const versions =
        mode === "empty"
          ? []
          : Array.from(
              { length: state.count },
              (_, i) => state.count - i,
            ).filter((v) => v < cursor);
      const items = versions.slice(0, 10).map((v) => ({
        id: uuid(v + 100),
        taskVersion: v,
        kind: v === 1 ? "snapshot" : v === state.count ? "started" : "assigned",
        status:
          v === 1
            ? "in_progress"
            : v === state.count
              ? "in_progress"
              : "assigned",
        occurredAt: at,
        actor:
          v === 1
            ? null
            : {
                id: actor,
                displayName:
                  mode === "long"
                    ? "Неразрывныйпсевдоним".repeat(10)
                    : "Синтетический участник",
              },
        assignee: {
          id: actor,
          displayName:
            mode === "long"
              ? "Исполнительсдлиннымименем".repeat(10)
              : "Синтетический участник",
        },
        ruleVersion: 1,
        fundXp: 23,
        fundPoints: 11,
        submissionId: null,
        reviewId: null,
      }));
      return json(route, {
        taskId,
        items,
        nextCursor: versions.length > 10 ? items.at(-1).taskVersion : null,
        asOf: at,
      });
    },
  );
  await page.goto(origin);
  // Проверяющий открывается на очереди проверки, остальные — на «Главной».
  if (role !== "reviewer")
    await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  if (role === "reviewer")
    await page
      .getByRole("button", { name: /Синтетическая задача с историей/ })
      .click();
  else
    await page
      .getByRole("button", { name: /Синтетическая задача с историей/ })
      .click();
  const region = page.getByRole("region", {
    name: "История задачи",
    exact: true,
  });
  const toggle = region.locator(".task-history-toggle");
  await toggle.waitFor();
  assert.equal(calls.length, 0, "Collapsed timeline must not load");
  return { page, state, calls, errors, region, toggle };
}
async function close(f) {
  assert.deepEqual(f.errors, []);
  await f.page.close({ runBeforeUnload: false });
  scenarios++;
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture(width);
    await f.toggle.focus();
    await f.toggle.press("Enter");
    await f.region
      .getByRole("heading", { name: "Начата работа · версия 12", exact: true })
      .waitFor();
    assert.equal(await f.region.locator("li").count(), 10);
    assert.equal(await f.toggle.getAttribute("aria-expanded"), "true");
    assert.equal(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.ok(
      await f.toggle.evaluate((e) => getComputedStyle(e).minHeight === "44px"),
    );
    await f.toggle.evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    await f.page.screenshot({
      path: `${captureDir}/f03-timeline-${width}.png`,
    });
    const more = f.region.getByRole("button", {
      name: "Показать более ранние события",
      exact: true,
    });
    await more.focus();
    await more.press("Space");
    await f.region
      .getByRole("heading", {
        name: "Снимок на момент включения истории · версия 1",
        exact: true,
      })
      .waitFor();
    assert.equal(await f.region.locator("li").count(), 12);
    assert.ok(f.calls.some((c) => c.includes("cursor=3")));
    await f.region
      .getByRole("button", { name: "Скрыть историю задачи", exact: true })
      .click();
    assert.equal(await f.region.locator("ol").isVisible(), false);
    await close(f);
  }
  const loading = await fixture(360, "loading");
  await loading.toggle.click();
  await loading.region
    .getByText("Загружаем события…", { exact: true })
    .waitFor();
  loading.state.released = true;
  loading.state.unblock();
  await loading.region
    .getByRole("heading", { name: /Начата работа/ })
    .waitFor();
  await close(loading);
  const empty = await fixture(320, "empty");
  await empty.toggle.click();
  await empty.region
    .getByText("Сохранённых переходов пока нет.", { exact: false })
    .waitFor();
  await close(empty);
  for (const code of [503, "network"]) {
    const f = await fixture(390);
    await f.page.getByLabel("Отчёт о выполнении", { exact: true }).fill(draft);
    await f.toggle.click();
    await f.region.getByRole("heading", { name: /Начата работа/ }).waitFor();
    f.state.failure = code;
    if (code === "network") await f.page.context().setOffline(true);
    await f.region
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    await f.region.getByRole("alert").waitFor();
    assert.equal(await f.region.locator("li").count(), 10);
    assert.ok(
      (await f.region.innerText()).includes("Показаны подтверждённые события"),
    );
    assert.equal(
      await f.page
        .getByLabel("Отчёт о выполнении", { exact: true })
        .inputValue(),
      draft,
    );
    await f.page.context().setOffline(false);
    f.state.failure = null;
    await f.region
      .getByRole("button", { name: "Повторить загрузку событий", exact: true })
      .click();
    await f.region
      .getByRole("button", { name: "Обновить события", exact: true })
      .waitFor();
    await close(f);
  }
  const initialError = await fixture(360);
  initialError.state.failure = 503;
  await initialError.toggle.click();
  await initialError.region.getByRole("alert").waitFor();
  assert.equal(await initialError.region.locator("li").count(), 0);
  initialError.state.failure = null;
  await initialError.region
    .getByRole("button", { name: "Повторить загрузку событий", exact: true })
    .click();
  await initialError.region
    .getByRole("heading", { name: /Начата работа/ })
    .waitFor();
  await close(initialError);
  const paging = await fixture(320);
  await paging.toggle.click();
  await paging.region.getByRole("heading", { name: /Начата работа/ }).waitFor();
  paging.state.failure = 503;
  await paging.region
    .getByRole("button", { name: "Показать более ранние события", exact: true })
    .click();
  await paging.region.getByRole("alert").waitFor();
  assert.equal(await paging.region.locator("li").count(), 10);
  paging.state.failure = null;
  await paging.region
    .getByRole("button", { name: "Показать более ранние события", exact: true })
    .click();
  await paging.region.getByRole("heading", { name: /Снимок/ }).waitFor();
  await close(paging);
  for (const code of [401, 403, 404]) {
    const f = await fixture(360);
    await f.toggle.click();
    await f.region.getByRole("heading", { name: /Начата работа/ }).waitFor();
    f.state.failure = code;
    await f.region
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    if (code === 404) {
      await f.region.getByRole("alert").waitFor();
      assert.equal(await f.region.locator("li").count(), 0);
    } else {
      await f.page
        .getByRole("heading", {
          name:
            code === 401 ? "Не удалось подтвердить сессию" : "Доступ отозван",
          exact: true,
        })
        .waitFor();
      assert.equal(await f.page.locator(".task-timeline").count(), 0);
    }
    await close(f);
  }
  const reviewer = await fixture(390, "ready", "reviewer");
  await reviewer.page
    .getByLabel("Причина возврата", { exact: true })
    .fill(draft);
  await reviewer.toggle.click();
  await reviewer.region
    .getByRole("heading", { name: /Начата работа/ })
    .waitFor();
  await reviewer.region
    .getByRole("button", { name: "Обновить события", exact: true })
    .click();
  await reviewer.region
    .getByRole("button", { name: "Обновить события", exact: true })
    .waitFor();
  assert.equal(
    await reviewer.page
      .getByLabel("Причина возврата", { exact: true })
      .inputValue(),
    draft,
  );
  await close(reviewer);
  const long = await fixture(320, "long");
  await long.toggle.click();
  await long.region.getByRole("heading", { name: /Начата работа/ }).waitFor();
  await long.page.addStyleTag({
    content:
      ".task-timeline,.task-timeline p,.task-timeline h4,.task-timeline button { font-size:20px; }",
  });
  assert.equal(
    await long.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await long.toggle.evaluate((element) =>
    element.scrollIntoView({ block: "start" }),
  );
  await long.page.screenshot({
    path: `${captureDir}/f03-timeline-long-320.png`,
  });
  await close(long);
  console.log(
    `F03 lifecycle: ${scenarios} browser scenarios passed (synthetic API responses)`,
  );
} finally {
  await browser.close();
}
