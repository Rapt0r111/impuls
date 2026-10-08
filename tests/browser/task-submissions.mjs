import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3000";
const taskId = "33333333-3333-4333-8333-333333333333";
const submissionId = "44444444-4444-4444-8444-444444444444";
const report =
  "Проверены синтетические примеры. Результат соответствует критериям.";
const initial = {
  id: taskId,
  title: "Синтетическая задача с длинным названием для проверки формы отчёта",
  status: "assigned",
  priority: "normal",
  dueAt: "2026-10-10T12:00:00.000Z",
  fundXp: 100,
  fundPoints: 30,
  ruleVersion: 1,
  version: 1,
  updatedAt: "2026-09-30T08:00:00.000Z",
  criteria: "Подтвердить синтетическую гипотезу и описать проверку.",
  latestSubmission: null,
  scope: {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "project",
    name: "Синтетический проект",
  },
};

const browser = await chromium.launch({ headless: true });
const captureDir =
  process.env.TEST_SCREENSHOT_DIR ?? "docs/verification/assets";
await mkdir(captureDir, { recursive: true });
let scenarios = 0;

async function fixture(width, mode = "success") {
  const page = await browser.newPage({
    viewport: { width, height: 740 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let task = { ...initial };
  let detailFails = false;
  let calls = [];
  let saved;
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.closingCalls=[];window.Telegram={WebApp:{initData:"",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){},enableClosingConfirmation(){window.closingCalls.push(true)},disableClosingConfirmation(){window.closingCalls.push(false)}}};',
    }),
  );
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route(
    (url) => url.pathname === "/api/v1/me",
    (route) =>
      json(route, {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          displayName: "Синтетический участник",
        },
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
    (route) => {
      if (route.request().method() === "GET")
        return detailFails
          ? json(route, { code: "UNAVAILABLE" }, 503)
          : json(route, { task });
      assert.equal(route.request().headers()["x-csrf-token"], "synthetic-csrf");
      assert.deepEqual(route.request().postDataJSON(), {
        action: "start",
        expectedVersion: 1,
      });
      task = { ...task, status: "in_progress", version: 2 };
      return json(route, { task });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/tasks/${taskId}/submissions`,
    async (route) => {
      const headers = route.request().headers();
      calls.push({
        key: headers["idempotency-key"],
        body: route.request().postDataJSON(),
      });
      assert.equal(headers["x-csrf-token"], "synthetic-csrf");
      assert.equal(calls.at(-1).body.text, report);
      if (
        (mode === "rate-limited" && calls.length === 1) ||
        (mode === "lost-rate-limited" && calls.length === 2)
      )
        return route.fulfill({
          status: 429,
          contentType: "application/json",
          headers: { "Retry-After": "12" },
          body: JSON.stringify({ code: "RATE_LIMITED" }),
        });
      if (mode === "revoked" || mode === "expired")
        return json(
          route,
          { code: "ACCESS_REVOKED" },
          mode === "revoked" ? 403 : 401,
        );
      if (mode === "conflict" || mode === "conflict-offline") {
        task = {
          ...task,
          version: 3,
          criteria: "Обновлённые синтетические критерии",
        };
        detailFails = mode === "conflict-offline";
        return json(route, { code: "TASK_CONFLICT", currentVersion: 3 }, 409);
      }
      if (!saved) {
        const submission = {
          id: submissionId,
          taskId,
          text: report,
          version: 1,
          createdAt: "2026-09-30T08:10:00.000Z",
        };
        task = {
          ...task,
          status: "in_review",
          version: 3,
          latestSubmission: submission,
        };
        saved = { task, submission };
      }
      if (
        calls.length === 1 &&
        ["lost-response", "lost-rate-limited"].includes(mode)
      )
        return route.abort("failed");
      if (calls.length === 1 && mode === "unavailable")
        return json(route, { code: "UNAVAILABLE" }, 503);
      return json(route, saved, 201);
    },
  );
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByText(initial.title, { exact: true }).click();
  await page
    .getByRole("button", { name: "Начать работу", exact: true })
    .click();
  await page.getByLabel("Отчёт о выполнении", { exact: true }).waitFor();
  return { page, errors, calls };
}

try {
  for (const width of [320, 360, 390, 1280]) {
    const { page, errors } = await fixture(width);
    const textarea = page.getByLabel("Отчёт о выполнении", { exact: true });
    await textarea.fill(report);
    assert.equal(await page.evaluate(() => window.closingCalls.at(-1)), true);
    await textarea.focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .getByRole("button", { name: "Отправить на проверку", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `${captureDir}/f03-report-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .click();
    await page
      .getByText("Отчёт отправлен на проверку. XP и баллы ещё не начислены.", {
        exact: true,
      })
      .waitFor();
    await page.getByText(report, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.closingCalls.at(-1)), false);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  for (const mode of [
    "lost-response",
    "unavailable",
    "rate-limited",
    "lost-rate-limited",
  ]) {
    const { page, errors, calls } = await fixture(360, mode);
    await page.getByLabel("Отчёт о выполнении", { exact: true }).fill(report);
    await page
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .click();
    if (mode === "lost-rate-limited") {
      await page
        .getByRole("button", { name: "Повторить тот же запрос", exact: true })
        .click();
    }
    if (mode.includes("rate-limited")) {
      await page
        .getByText(
          "Слишком много действий. Подождите 12 с, затем повторите тот же запрос. Данные сохранены.",
          { exact: true },
        )
        .waitFor();
      await page
        .locator(".task-report")
        .getByText(report, { exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await page
      .getByRole("button", { name: "Повторить тот же запрос", exact: true })
      .click();
    await page
      .getByText("Отчёт отправлен на проверку. XP и баллы ещё не начислены.", {
        exact: true,
      })
      .waitFor();
    assert.equal(calls.length, mode === "lost-rate-limited" ? 3 : 2);
    for (const call of calls) assert.deepEqual(calls[0], call);
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  for (const mode of ["conflict", "conflict-offline"]) {
    const { page, errors } = await fixture(320, mode);
    await page.getByLabel("Отчёт о выполнении", { exact: true }).fill(report);
    await page
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .click();
    await page.getByText("Задача изменилась.", { exact: false }).waitFor();
    if (mode === "conflict")
      await page
        .getByText("Обновлённые синтетические критерии", { exact: true })
        .waitFor();
    else
      await page
        .getByText("Последнее подтверждённое состояние:", { exact: false })
        .waitFor();
    assert.equal(
      await page.getByLabel("Отчёт о выполнении", { exact: true }).inputValue(),
      report,
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    assert.equal(
      await page.getByLabel("Отчёт о выполнении", { exact: true }).inputValue(),
      report,
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    assert.equal(
      await page.getByLabel("Отчёт о выполнении", { exact: true }).inputValue(),
      report,
    );
    assert.deepEqual(errors, []);
    await page.close({ runBeforeUnload: false });
    scenarios++;
  }
  for (const mode of ["revoked", "expired"]) {
    const { page, errors } = await fixture(390, mode);
    await page.getByLabel("Отчёт о выполнении", { exact: true }).fill(report);
    await page
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name:
          mode === "revoked"
            ? "Доступ отозван"
            : "Не удалось подтвердить сессию",
        exact: true,
      })
      .waitFor();
    assert.equal(await page.getByText(report, { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  const { page, errors } = await fixture(320);
  await page.getByLabel("Отчёт о выполнении", { exact: true }).fill(report);
  await page.addStyleTag({
    content:
      "body { font-size: 200%; } .task-report textarea { font-size: 200%; }",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 320, height: 400 });
  await page.getByLabel("Отчёт о выполнении", { exact: true }).focus();
  await page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .scrollIntoViewIfNeeded();
  assert.deepEqual(errors, []);
  await page.close({ runBeforeUnload: false });
  scenarios++;
  console.log(
    `F03 browser: ${scenarios} scenarios passed (synthetic HTTP responses; live server checked separately)`,
  );
} finally {
  await browser.close();
}
