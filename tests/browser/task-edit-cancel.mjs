import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const dir = process.env.TEST_SCREENSHOT_DIR ?? "test-results/task-edit-cancel";
await mkdir(dir, { recursive: true });
const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  scope: "22222222-2222-4222-8222-222222222222",
  task: "33333333-3333-4333-8333-333333333333",
  rule: "44444444-4444-4444-8444-444444444444",
};
const browser = await chromium.launch({ headless: true });
let scenarios = 0;
async function fixture(width, mode = "success") {
  const page = await browser.newPage({
    viewport: { width, height: 820 },
    reducedMotion: "reduce",
    timezoneId: "Europe/Moscow",
  });
  const errors = [],
    calls = [];
  page.setDefaultTimeout(8000);
  // Редкие действия строки задачи свёрнуты в «Подробнее»; сценарию нужны кнопки.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      for (const d of document.querySelectorAll(
        "details.task-mgmt__details:not([open])",
      ))
        d.open = true;
    }).observe(document, { childList: true, subtree: true });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) =>
    mode === "dismiss-navigation" &&
    d.message().includes("Текст ещё не отправлен")
      ? d.dismiss()
      : d.accept(),
  );
  const scope = { id: ids.scope, kind: "group", name: "Синтетическая область" };
  let task = {
    id: ids.task,
    title: "Синтетический черновик для проверки изменений",
    criteria: "Сверить независимые синтетические источники и записать вывод.",
    categoryCode: "test",
    priority: "normal",
    status: "draft",
    dueAt: "2035-01-01T12:00:00.000Z",
    fundXp: 17,
    fundPoints: 9,
    ruleSetId: ids.rule,
    ruleVersion: 1,
    version: 1,
    updatedAt: "2026-10-02T06:00:00.000Z",
    scope,
    assignee: null,
  };
  if (mode === "cancel" || mode === "cancel-uncertain")
    task.status = "in_review";
  if (mode === "closed") task.status = "accepted";
  const json = (route, body, status = 200, headers = {}) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers,
      body: JSON.stringify(body),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){}}}",
    }),
  );
  await page.route("**/api/v1/**", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (url.pathname === "/api/v1/me")
      return json(route, {
        user: { id: ids.user, displayName: "Синтетический редактор" },
        csrfToken: "test-csrf",
      });
    if (url.pathname === "/api/v1/me/permissions")
      return json(route, {
        permissions: [
          {
            action: mode === "view-only" ? "task.view" : "task.edit",
            scope,
            validUntil: null,
          },
          ...(mode === "view-only"
            ? []
            : [{ action: "task.cancel", scope, validUntil: null }]),
          ...(mode === "history"
            ? [{ action: "task.view", scope, validUntil: null }]
            : []),
        ],
      });
    if (url.pathname === "/api/v1/tasks")
      return json(route, { items: [], nextCursor: null });
    if (url.pathname === "/api/v1/task-management/options")
      return json(route, {
        scopes: [
          {
            ...scope,
            canCreate: false,
            canAssign: false,
            canEdit: mode !== "view-only",
            canCancel: mode !== "view-only",
            assignees: [],
          },
        ],
        ruleSets: [],
      });
    if (url.pathname === "/api/v1/task-management")
      return json(route, { items: [task], nextCursor: null });
    if (url.pathname.endsWith("/timeline"))
      return json(route, {
        taskId: ids.task,
        asOf: task.updatedAt,
        nextCursor: null,
        items:
          mode === "history"
            ? [
                {
                  id: ids.user,
                  taskVersion: 3,
                  kind: "cancelled",
                  status: "cancelled",
                  occurredAt: task.updatedAt,
                  actor: {
                    id: ids.user,
                    displayName: "Синтетический редактор",
                  },
                  assignee: null,
                  ruleVersion: 1,
                  fundXp: 17,
                  fundPoints: 9,
                  submissionId: null,
                  reviewId: null,
                  reason: "Синтетическая причина отмены",
                  taskSnapshot: null,
                },
                {
                  id: ids.rule,
                  taskVersion: 2,
                  kind: "edited",
                  status: "draft",
                  occurredAt: task.updatedAt,
                  actor: {
                    id: ids.user,
                    displayName: "Синтетический редактор",
                  },
                  assignee: null,
                  ruleVersion: 1,
                  fundXp: 17,
                  fundPoints: 9,
                  submissionId: null,
                  reviewId: null,
                  reason: "Синтетическая причина изменения",
                  taskSnapshot: {
                    title: "Сохранённые условия черновика",
                    criteria: "Зафиксированные критерии результата",
                    categoryCode: "test",
                    priority: "normal",
                    dueAt: task.dueAt,
                  },
                },
              ]
            : [],
      });
    if (url.pathname.endsWith("/history"))
      return json(route, {
        taskId: ids.task,
        asOf: task.updatedAt,
        nextCursor: null,
        items: [],
      });
    if (r.method() === "POST" && /\/(edit|cancel)$/.test(url.pathname)) {
      const body = r.postDataJSON();
      calls.push({
        body,
        key: r.headers()["idempotency-key"],
        action: url.pathname.split("/").at(-1),
      });
      assert.equal(r.headers()["x-csrf-token"], "test-csrf");
      const err = (status, code, headers = {}) =>
        json(
          route,
          { code, message: "Synthetic scenario", requestId: ids.user },
          status,
          headers,
        );
      if (mode === "revoked") return err(403, "ACCESS_REVOKED");
      if (mode === "conflict" && calls.length === 1) {
        task = {
          ...task,
          version: 2,
          title: "Черновик изменён другим редактором",
        };
        return err(409, "TASK_CONFLICT");
      }
      if (
        ["uncertain", "cancel-uncertain", "rate-limit"].includes(mode) &&
        calls.length === 1
      )
        return err(
          mode === "rate-limit" ? 429 : 503,
          mode === "rate-limit" ? "TASK_RATE_LIMITED" : "UNAVAILABLE",
          mode === "rate-limit" ? { "Retry-After": "7" } : {},
        );
      const { expectedVersion, reason, ...fields } = body;
      assert.equal(expectedVersion, task.version);
      assert.ok(reason.trim());
      task = {
        ...task,
        ...fields,
        version: task.version + 1,
        status: url.pathname.endsWith("/cancel") ? "cancelled" : task.status,
      };
      return json(route, { task });
    }
    return route.fallback();
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", {
      name: mode === "view-only" ? "Задачи и история" : "Постановка задач",
      exact: true,
    })
    .click();
  await page.getByRole("heading", { name: task.title, exact: true }).waitFor();
  return { page, calls, errors };
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const { page, errors } = await fixture(width);
    await page
      .getByRole("button", { name: "Редактировать черновик", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    const form = page.getByRole("form", {
      name: "Редактирование черновика",
      exact: true,
    });
    await form
      .getByLabel("Название", { exact: true })
      .fill("Изменённый синтетический черновик");
    await form
      .getByLabel("Причина изменения", { exact: true })
      .fill("Уточнение тестовых критериев");
    assert.equal(
      await form.getByLabel("Срок (UTC)").inputValue(),
      "2035-01-01T12:00",
    );
    await page.screenshot({
      path: `${dir}/f03-edit-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await form.getByRole("button", { name: "Сохранить изменения" }).click();
    await page
      .getByText("Изменения черновика сохранены.", { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  for (const mode of [
    "cancel",
    "uncertain",
    "cancel-uncertain",
    "rate-limit",
    "conflict",
  ]) {
    const { page, calls, errors } = await fixture(320, mode);
    const cancel = mode.startsWith("cancel");
    await page
      .getByRole("button", {
        name: cancel ? "Отменить задачу" : "Редактировать черновик",
        exact: true,
      })
      .click();
    const form = page.getByRole("form", {
      name: cancel ? "Отмена задачи" : "Редактирование черновика",
      exact: true,
    });
    const reason = form.getByLabel(
      cancel ? "Причина отмены" : "Причина изменения",
      { exact: true },
    );
    await reason.fill("Синтетическое основание");
    await form
      .getByRole("button", {
        name: cancel ? "Подтвердить отмену" : "Сохранить изменения",
        exact: true,
      })
      .click();
    if (mode.includes("uncertain") || mode === "rate-limit") {
      await page
        .getByRole("button", { name: "Повторить тот же запрос", exact: true })
        .waitFor();
      assert.equal(await reason.isDisabled(), true);
      assert.equal(await reason.inputValue(), "Синтетическое основание");
      if (mode === "rate-limit") await page.getByText(/7 с/).first().waitFor();
      await page
        .getByRole("button", { name: "Повторить тот же запрос", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({
          hasText: cancel ? "Задача отменена" : "Изменения черновика сохранены",
        })
        .waitFor();
      assert.deepEqual(calls[0], calls[1]);
    } else if (mode === "conflict") {
      await page
        .getByRole("button", { name: "Использовать версию 2", exact: true })
        .waitFor();
      assert.equal(await reason.inputValue(), "Синтетическое основание");
      assert.equal(
        await form
          .getByRole("button", { name: "Сохранить изменения" })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "Использовать версию 2", exact: true })
        .click();
      await form.getByRole("button", { name: "Сохранить изменения" }).click();
      await page
        .getByText("Изменения черновика сохранены.", { exact: true })
        .waitFor();
      assert.notEqual(calls[0].key, calls[1].key);
      assert.equal(calls[1].body.expectedVersion, 2);
    } else await page.getByText(/Задача отменена\. Отчёты/).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  for (const mode of ["view-only", "closed"]) {
    const { page } = await fixture(390, mode);
    assert.equal(
      await page
        .getByRole("button", { name: "Редактировать черновик", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Отменить задачу", exact: true })
        .count(),
      0,
    );
    await page.close();
    scenarios++;
  }
  {
    const { page, calls } = await fixture(320, "dismiss-navigation");
    await page
      .getByRole("button", { name: "Редактировать черновик", exact: true })
      .click();
    const form = page.getByRole("form", {
      name: "Редактирование черновика",
      exact: true,
    });
    await form
      .getByLabel("Критерии результата", { exact: true })
      .fill("ДлинныеКритерии".repeat(100));
    await form
      .getByLabel("Причина изменения", { exact: true })
      .fill("Сохранить этот черновик");
    await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
    assert.equal(
      await form.getByLabel("Причина изменения", { exact: true }).inputValue(),
      "Сохранить этот черновик",
    );
    assert.equal(
      await form
        .getByRole("textbox", { name: "Критерии результата", exact: true })
        .inputValue(),
      "ДлинныеКритерии".repeat(100),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(calls.length, 0);
    await page.close();
    scenarios++;
  }
  {
    const { page, errors } = await fixture(390, "history");
    await page
      .getByRole("button", { name: "История задачи", exact: true })
      .click();
    await page.getByRole("heading", { name: /Задача отменена/ }).waitFor();
    await page
      .getByText("Основание: Синтетическая причина отмены", { exact: true })
      .waitFor();
    await page.getByText(/Сохранённые условия черновика/).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    scenarios++;
  }
  const { page } = await fixture(390, "revoked");
  await page
    .getByRole("button", { name: "Отменить задачу", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Отмена задачи", exact: true });
  await form.getByLabel("Причина отмены").fill("Synthetic revoke");
  await form
    .getByRole("button", { name: "Подтвердить отмену", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Доступ отозван", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("form", { name: "Отмена задачи", exact: true })
      .count(),
    0,
  );
  await page.close();
  scenarios++;
  console.log(
    JSON.stringify({ scenarios, screenshots: dir, result: "passed" }),
  );
} finally {
  await browser.close();
}
