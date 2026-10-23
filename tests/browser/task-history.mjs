import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const actorId = "11111111-1111-4111-8111-111111111111";
const taskId = "33333333-3333-4333-8333-333333333333";
const draft = "Несданный текст: проверяю вторую гипотезу.";
const initial = {
  id: taskId,
  title: "Синтетическая задача для сравнения отчётов",
  status: "in_progress",
  priority: "normal",
  dueAt: "2026-10-10T12:00:00.000Z",
  fundXp: 19,
  fundPoints: 7,
  ruleVersion: 1,
  version: 26,
  updatedAt: "2026-09-30T08:00:00.000Z",
  criteria: "Описать проверяемый результат.",
  latestSubmission: null,
  scope: {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "project",
    name: "Синтетическая область",
  },
};
const timestamp = "2026-09-30T09:00:00.000Z";
const uuid = (number) =>
  `44444444-4444-4444-8444-${String(number).padStart(12, "0")}`;
const browser = await chromium.launch({ headless: true });
const captureDir =
  process.env.TEST_SCREENSHOT_DIR ?? ".local/screenshots";
await mkdir(captureDir, { recursive: true });
let scenarios = 0;

async function fixture(width, mode = "ready") {
  const page = await browser.newPage({
    viewport: { width, height: 740 },
    reducedMotion: "reduce",
  });
  const errors = [],
    calls = [];
  const state = {
    failure: null,
    count: 12,
    released: mode !== "loading",
    unblock: null,
  };
  page.on("pageerror", (error) => errors.push(error.message));
  let task = {
    ...initial,
    status: mode === "accepted" ? "accepted" : "in_progress",
  };
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
    (url) => url.pathname === "/api/v1/me",
    (route) =>
      json(route, {
        user: { id: actorId, displayName: "Синтетический участник" },
        csrfToken: "synthetic-csrf",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (route) => json(route, { permissions: [] }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks",
    (route) => json(route, { items: [task], nextCursor: null }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/tasks/${taskId}`,
    (route) => json(route, { task }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/tasks/${taskId}/submissions`,
    (route) => {
      const body = route.request().postDataJSON();
      assert.equal(body.text, draft);
      state.count++;
      const submission = {
        id: uuid(state.count),
        taskId,
        text: draft,
        version: 1,
        createdAt: timestamp,
      };
      task = {
        ...task,
        status: "in_review",
        version: 27,
        latestSubmission: submission,
      };
      return json(route, { task, submission }, 201);
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/tasks/${taskId}/history`,
    async (route) => {
      const url = new URL(route.request().url());
      const cursor = Number(url.searchParams.get("cursor") ?? state.count + 1);
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
            message: "Synthetic test",
            requestId: actorId,
          },
          state.failure,
        );
      const numbers =
        mode === "empty"
          ? []
          : Array.from(
              { length: state.count },
              (_, index) => state.count - index,
            ).filter((n) => n < cursor);
      const pageNumbers = numbers.slice(0, 10);
      const items = pageNumbers.map((n) => ({
        id: uuid(n),
        attemptNumber: n,
        text:
          n === 13
            ? draft
            : `Синтетический отчёт ${n}: независимо проверено выполнение критерия.`,
        submittedAt: timestamp,
        review:
          n === 13
            ? null
            : {
                id: uuid(n + 100),
                decision: mode === "accepted" && n === 12 ? "accept" : "return",
                reason: `Основание ${n}: добавьте независимую проверку второго критерия.`,
                createdAt: timestamp,
                reviewer: {
                  id: actorId,
                  displayName: "Синтетический проверяющий",
                },
                fundXp: mode === "accepted" && n === 12 ? 19 : null,
                fundPoints: mode === "accepted" && n === 12 ? 7 : null,
              },
      }));
      if (mode === "long" && items[0]) {
        items[0].text = "Неразрывныйсинтетическийотчёт".repeat(70);
        items[0].review.reason = "Длиннаяпричинавозврата".repeat(60);
        items[0].review.reviewer.displayName =
          "Проверяющийсдлиннымпсевдонимом".repeat(4);
      }
      return json(route, {
        taskId,
        items,
        nextCursor: numbers.length > 10 ? pageNumbers.at(-1) : null,
        asOf: timestamp,
      });
    },
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await page
    .getByRole("button", { name: /Синтетическая задача для сравнения/ })
    .click();
  const toggle = page.locator(".task-history .task-history-toggle");
  await toggle.waitFor();
  assert.equal(calls.length, 0, "Collapsed history must not fetch");
  return { page, errors, calls, state, toggle };
}
async function close(f) {
  assert.deepEqual(f.errors, []);
  assert.equal(await f.page.evaluate(() => localStorage.length), 0);
  await f.page.close({ runBeforeUnload: false });
  scenarios++;
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture(width, "accepted");
    await f.toggle.focus();
    await f.toggle.press("Enter");
    await f.page
      .getByRole("heading", { name: "Попытка 12 · Принята", exact: true })
      .waitFor();
    assert.equal(await f.page.locator(".task-history-list li").count(), 10);
    assert.ok(
      (await f.page.locator(".task-history").innerText()).includes(
        "Начислено 19 XP и 7 баллов",
      ),
    );
    assert.equal(await f.toggle.getAttribute("aria-expanded"), "true");
    assert.equal(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await f.toggle.evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    await f.page.screenshot({
      path: `${captureDir}/f03-history-${width}.png`,
    });
    const more = f.page.getByRole("button", {
      name: "Показать более ранние отчёты",
      exact: true,
    });
    await more.focus();
    await more.press("Space");
    await f.page
      .getByRole("heading", {
        name: "Попытка 1 · Возвращена на доработку",
        exact: true,
      })
      .waitFor();
    assert.equal(await f.page.locator(".task-history-list li").count(), 12);
    assert.ok(f.calls.some((call) => call.includes("cursor=3")));
    await f.page
      .getByRole("button", { name: "Скрыть историю отчётов", exact: true })
      .click();
    assert.equal(await f.page.locator(".task-history-list").isVisible(), false);
    await close(f);
  }
  const loading = await fixture(360, "loading");
  await loading.toggle.click();
  await loading.page.getByText("Загружаем историю…", { exact: true }).waitFor();
  loading.state.released = true;
  loading.state.unblock();
  await loading.page.getByRole("heading", { name: /Попытка 12/ }).waitFor();
  await close(loading);

  const empty = await fixture(320, "empty");
  await empty.toggle.click();
  await empty.page.getByText("Отчётов пока нет.", { exact: false }).waitFor();
  assert.equal(await empty.page.locator(".task-history-list li").count(), 0);
  await close(empty);

  const unavailable = await fixture(360);
  unavailable.state.failure = 503;
  await unavailable.toggle.click();
  await unavailable.page
    .getByRole("alert")
    .filter({ hasText: "Не удалось загрузить историю" })
    .waitFor();
  unavailable.state.failure = null;
  await unavailable.page
    .getByRole("button", { name: "Повторить загрузку истории", exact: true })
    .click();
  await unavailable.page.getByRole("heading", { name: /Попытка 12/ }).waitFor();
  await close(unavailable);

  for (const failure of [503, "network"]) {
    const f = await fixture(390);
    await f.page.getByLabel("Отчёт о выполнении", { exact: true }).fill(draft);
    await f.toggle.click();
    await f.page.getByRole("heading", { name: /Попытка 12/ }).waitFor();
    f.state.failure = failure;
    if (failure === "network") await f.page.context().setOffline(true);
    await f.page
      .getByRole("button", { name: "Обновить историю", exact: true })
      .click();
    await f.page
      .getByRole("alert")
      .filter({
        hasText:
          failure === "network"
            ? "Нет соединения"
            : "Не удалось загрузить историю",
      })
      .waitFor();
    assert.ok(
      (await f.page.locator(".task-history").innerText()).includes(
        "последняя подтверждённая история",
      ),
    );
    assert.equal(await f.page.locator(".task-history-list li").count(), 10);
    assert.equal(
      await f.page
        .getByLabel("Отчёт о выполнении", { exact: true })
        .inputValue(),
      draft,
    );
    await f.page.context().setOffline(false);
    f.state.failure = null;
    // После возврата сети данные могут обновиться сами раньше нажатия.
    await f.page
      .getByRole("button", { name: "Повторить загрузку истории", exact: true })
      .click({ timeout: 3000 })
      .catch(() => {});
    await f.page
      .getByRole("button", { name: "Обновить историю", exact: true })
      .waitFor();
    await close(f);
  }
  const next = await fixture(320);
  await next.toggle.click();
  await next.page.getByRole("heading", { name: /Попытка 12/ }).waitFor();
  next.state.failure = 503;
  await next.page
    .getByRole("button", { name: "Показать более ранние отчёты", exact: true })
    .click();
  await next.page
    .getByRole("alert")
    .filter({ hasText: "Не удалось загрузить историю" })
    .waitFor();
  assert.equal(await next.page.locator(".task-history-list li").count(), 10);
  next.state.failure = null;
  await next.page
    .getByRole("button", { name: "Показать более ранние отчёты", exact: true })
    .click();
  await next.page.getByRole("heading", { name: /Попытка 1 ·/ }).waitFor();
  assert.equal(await next.page.locator(".task-history-list li").count(), 12);
  await close(next);

  for (const code of [401, 403, 404]) {
    const f = await fixture(360);
    await f.toggle.click();
    await f.page.getByRole("heading", { name: /Попытка 12/ }).waitFor();
    f.state.failure = code;
    await f.page
      .getByRole("button", { name: "Обновить историю", exact: true })
      .click();
    if (code === 404) {
      await f.page
        .getByRole("alert")
        .filter({ hasText: "Задача больше недоступна" })
        .waitFor();
      assert.equal(await f.page.locator(".task-history-list li").count(), 0);
    } else {
      await f.page
        .getByRole("heading", {
          name:
            code === 401 ? "Не удалось подтвердить сессию" : "Доступ отозван",
          exact: true,
        })
        .waitFor();
      assert.equal(await f.page.locator(".task-history").count(), 0);
    }
    await close(f);
  }
  const submit = await fixture(390);
  await submit.toggle.click();
  await submit.page.getByRole("heading", { name: /Попытка 12/ }).waitFor();
  await submit.page
    .getByLabel("Отчёт о выполнении", { exact: true })
    .fill(draft);
  await submit.page
    .getByRole("button", { name: "Обновить историю", exact: true })
    .click();
  await submit.page
    .getByRole("button", { name: "Обновить историю", exact: true })
    .waitFor();
  assert.equal(
    await submit.page
      .getByLabel("Отчёт о выполнении", { exact: true })
      .inputValue(),
    draft,
  );
  await submit.page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await submit.page
    .getByRole("heading", { name: "Попытка 13 · На проверке", exact: true })
    .waitFor();
  assert.ok(
    (
      await submit.page.locator(".task-history-list li").first().innerText()
    ).includes(draft),
  );
  await close(submit);

  const long = await fixture(320, "long");
  await long.toggle.click();
  await long.page.getByRole("heading", { name: /Попытка 12/ }).waitFor();
  await long.page.addStyleTag({
    content:
      ".task-history, .task-history p, .task-history h4, .task-history button { font-size:20px; }",
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
    path: `${captureDir}/f03-history-long-320.png`,
  });
  await close(long);
  console.log(
    `F03 report history: ${scenarios} browser scenarios passed (synthetic API responses)`,
  );
} finally {
  await browser.close();
}
