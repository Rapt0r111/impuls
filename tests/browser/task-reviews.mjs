import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3000";
const actorId = "11111111-1111-4111-8111-111111111111";
const scopeId = "22222222-2222-4222-8222-222222222222";
const taskId = "33333333-3333-4333-8333-333333333333";
const subId = "44444444-4444-4444-8444-444444444444";
const reason = "Добавьте независимую проверку результата по второму критерию.";
const item = {
  submissionId: subId,
  text: "Синтетический отчёт: проверен первый критерий. Второй пока требует подтверждения.",
  submittedAt: "2026-09-30T08:00:00.000Z",
  attemptNumber: 1,
  author: {
    id: "55555555-5555-4555-8555-555555555555",
    displayName: "Синтетический участник",
  },
  task: {
    id: taskId,
    title: "Синтетическая задача с длинным названием для проверки очереди",
    status: "in_review",
    criteria: "Описать результат и независимо проверить оба критерия.",
    priority: "normal",
    dueAt: "2026-10-10T12:00:00.000Z",
    fundXp: 100,
    fundPoints: 30,
    ruleVersion: 1,
    version: 3,
    updatedAt: "2026-09-30T08:00:00.000Z",
    scope: { id: scopeId, kind: "project", name: "Синтетическая область" },
  },
};
const browser = await chromium.launch({ headless: true });
await mkdir(".impeccable/review/reviews", { recursive: true });
let scenarios = 0;
async function fixture(width, mode = "success") {
  const page = await browser.newPage({
    viewport: { width, height: 740 },
    reducedMotion: "reduce",
  });
  const errors = [];
  const calls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const apiError = (route, status, code) =>
    json(
      route,
      { code, message: "Synthetic test", requestId: actorId },
      status,
    );
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
        user: { id: actorId, displayName: "Синтетический проверяющий" },
        csrfToken: "synthetic-csrf",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (route) =>
      json(route, {
        permissions: [
          { action: "task.review", scope: item.task.scope, validUntil: null },
        ],
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks",
    (route) => json(route, { items: [], nextCursor: null }),
  );
  let returned = false;
  await page.route(
    (url) => url.pathname === "/api/v1/reviews",
    (route) =>
      mode === "queue-denied"
        ? apiError(route, 403, "PERMISSION_DENIED")
        : mode === "queue-failed"
          ? apiError(route, 503, "UNAVAILABLE")
          : json(route, {
              items:
                mode === "empty" || returned
                  ? []
                  : mode === "long"
                    ? Array.from({ length: 20 }, (_, index) => ({
                        ...item,
                        submissionId:
                          index === 0
                            ? subId
                            : `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
                        task: {
                          ...item.task,
                          title:
                            index === 0
                              ? item.task.title
                              : `Синтетическая задача ${index + 1}`,
                        },
                      }))
                    : [item],
              nextCursor: null,
            }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/submissions/${subId}/review`,
    async (route) => {
      const headers = route.request().headers();
      assert.equal(headers["x-csrf-token"], "synthetic-csrf");
      const call = {
        key: headers["idempotency-key"],
        body: route.request().postDataJSON(),
      };
      calls.push(call);
      assert.deepEqual(call.body, {
        action: "return",
        expectedVersion: 3,
        reason,
      });
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
      if (mode === "conflict") return apiError(route, 409, "TASK_CONFLICT");
      if (mode === "self-denied")
        return apiError(route, 403, "SELF_REVIEW_DENIED");
      if (mode === "revoked") return apiError(route, 403, "ACCESS_REVOKED");
      if (mode === "expired") return apiError(route, 401, "UNAUTHORIZED");
      if (["offline", "lost-rate-limited"].includes(mode) && calls.length === 1)
        return route.abort("internetdisconnected");
      if (mode === "unavailable" && calls.length === 1)
        return apiError(route, 503, "UNAVAILABLE");
      returned = true;
      return json(route, {
        review: {
          id: actorId,
          submissionId: subId,
          decision: "return",
          reason,
          createdAt: "2026-09-30T09:00:00.000Z",
        },
        task: { id: taskId, status: "needs_work", version: 4 },
      });
    },
  );
  await page.goto(origin);
  await page
    .getByRole("heading", { name: "Очередь проверки", exact: true })
    .waitFor();
  if (!["empty", "queue-denied", "queue-failed", "long"].includes(mode)) {
    await page.getByRole("button", { name: /Синтетическая задача/ }).click();
    await page.getByLabel("Причина возврата", { exact: true }).waitFor();
  }
  return { page, errors, calls };
}
try {
  for (const width of [320, 390]) {
    for (const selection of ["pointer", "keyboard"]) {
      const { page, errors } = await fixture(width, "long");
      const row = page.getByRole("button", {
        name: /Синтетическая задача с длинным/,
      });
      await row.waitFor();
      assert.equal(await page.locator(".tasks-list li").count(), 20);
      if (selection === "pointer") await row.click();
      else {
        await row.focus();
        await row.press("Enter");
      }
      await page.getByLabel("Причина возврата", { exact: true }).waitFor();
      const opened = page.locator("#review-detail-title");
      assert.equal(
        await opened.evaluate((el) => el === document.activeElement),
        true,
      );
      const bounds = await opened.boundingBox();
      assert.ok(bounds.y >= 12 && bounds.y + bounds.height < 740);
      await page.screenshot({
        path: `.impeccable/review/reviews/long-${width}-${selection}.png`,
      });
      assert.deepEqual(errors, []);
      await page.close();
      scenarios++;
    }
  }
  for (const width of [320, 360, 390, 1280]) {
    const { page, errors } = await fixture(width);
    await page.getByLabel("Причина возврата", { exact: true }).fill(reason);
    await page.getByLabel("Причина возврата", { exact: true }).press("Tab");
    assert.equal(
      await page
        .getByRole("button", { name: "Вернуть на доработку", exact: true })
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
      path: `.impeccable/review/reviews/return-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Вернуть на доработку", exact: true })
      .click();
    await page
      .getByText(`Возврат сохранён. Исполнитель увидит причину: ${reason}`, {
        exact: true,
      })
      .waitFor();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page
      .getByText("Нет отчётов, ожидающих проверки.", { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  for (const mode of [
    "offline",
    "unavailable",
    "rate-limited",
    "lost-rate-limited",
  ]) {
    const { page, errors, calls } = await fixture(360, mode);
    await page.getByLabel("Причина возврата", { exact: true }).fill(reason);
    await page
      .getByRole("button", { name: "Вернуть на доработку", exact: true })
      .click();
    if (mode === "lost-rate-limited")
      await page
        .getByRole("button", { name: "Повторить тот же запрос", exact: true })
        .click();
    if (mode.includes("rate-limited")) {
      await page
        .getByText(
          "Слишком много действий. Подождите 12 с, затем повторите тот же запрос. Данные сохранены.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await page.getByLabel("Причина возврата", { exact: true }).inputValue(),
        reason,
      );
    }
    await page
      .getByRole("button", { name: "Повторить тот же запрос", exact: true })
      .click();
    await page.getByText("Возврат сохранён.", { exact: false }).waitFor();
    assert.equal(calls.length, mode === "lost-rate-limited" ? 3 : 2);
    for (const call of calls) assert.deepEqual(calls[0], call);
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  for (const mode of ["conflict", "self-denied"]) {
    const { page, errors } = await fixture(320, mode);
    await page.getByLabel("Причина возврата", { exact: true }).fill(reason);
    await page
      .getByRole("button", { name: "Вернуть на доработку", exact: true })
      .click();
    await page
      .locator(".tasks-detail .task-report-error[role='alert']")
      .waitFor();
    assert.equal(
      await page.getByLabel("Причина возврата", { exact: true }).inputValue(),
      reason,
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
    assert.equal(
      await page.getByLabel("Причина возврата", { exact: true }).inputValue(),
      reason,
    );
    assert.deepEqual(errors, []);
    await page.close({ runBeforeUnload: false });
    scenarios++;
  }
  for (const mode of ["revoked", "expired"]) {
    const { page, errors } = await fixture(390, mode);
    await page.getByLabel("Причина возврата", { exact: true }).fill(reason);
    await page
      .getByRole("button", { name: "Вернуть на доработку", exact: true })
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
    assert.equal(
      await page.getByLabel("Причина возврата", { exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  for (const mode of ["empty", "queue-denied", "queue-failed"]) {
    const { page, errors } = await fixture(360, mode);
    await page
      .getByText(
        mode === "empty"
          ? "Нет отчётов, ожидающих проверки."
          : mode === "queue-denied"
            ? "Право проверки изменилось. Проверьте вход снова."
            : "Очередь недоступна. Повторите загрузку.",
        { exact: true },
      )
      .waitFor();
    await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
    await page
      .getByRole("heading", { name: "Назначенные задачи", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  console.log(
    `F03 return browser: ${scenarios} scenarios passed (synthetic responses)`,
  );
} finally {
  await browser.close();
}
