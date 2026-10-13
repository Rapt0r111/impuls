import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { mockHomeFallback, openReviewQueue } from "./home-fallback.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3000";
const id = "11111111-1111-4111-8111-111111111111",
  sub = "22222222-2222-4222-8222-222222222222",
  task = "33333333-3333-4333-8333-333333333333";
const at = "2026-09-30T08:00:00.000Z";
const reason = "Оба критерия подтверждены независимой проверкой.";
const balance = {
  lifetimeXp: 100,
  availablePoints: 30,
  reservedPoints: 0,
  version: 1,
  updatedAt: at,
};
const item = {
  submissionId: sub,
  text: "Синтетический отчёт с доказательством выполнения обоих критериев.",
  submittedAt: at,
  attemptNumber: 1,
  acceptance: { enabled: true, mode: "synthetic" },
  author: { id, displayName: "Синтетический участник" },
  task: {
    id: task,
    title: "Проверить и подтвердить результат учебной задачи",
    status: "in_review",
    criteria: "Выполнить оба критерия и приложить независимое подтверждение.",
    priority: "normal",
    dueAt: at,
    fundXp: 100,
    fundPoints: 30,
    ruleVersion: 2,
    version: 3,
    updatedAt: at,
    scope: { id, kind: "project", name: "Синтетическая область" },
  },
};
const bonusOptions = {
  adjustment: { minXp: 50, minPoints: 15, maxXp: 200, maxPoints: 80 },
  bonuses: [
    { code: "quality", title: "Качество", xp: 20, points: 10 },
    { code: "innovation", title: "Инновация", xp: 40, points: 20 },
  ],
};
const bonusModes = ["bonus", "bonus-rejected"];
const award = {
  mode: "synthetic",
  xp: 100,
  points: 30,
  ruleVersion: 2,
  seasonKey: "2026-09",
  timeZone: "Europe/Moscow",
  acceptedAt: at,
  balance,
};
const entries = ["xp", "points"].map((currency, index) => ({
  id: index ? sub : id,
  currency,
  amount: index ? 30 : 100,
  reason,
  task: { id: task, title: item.task.title },
  ruleVersion: 2,
  seasonKey: "2026-09",
  timeZone: "Europe/Moscow",
  mode: "synthetic",
  createdAt: at,
}));
const browser = await chromium.launch({ headless: true });
await mkdir(".impeccable/review/acceptance", { recursive: true });
let count = 0;
async function fixture(width, mode = "success") {
  const page = await browser.newPage({
    viewport: { width, height: 740 },
    reducedMotion: "reduce",
  });
  const calls = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const fail = (route, status, code) =>
    json(route, { code, message: "Synthetic test", requestId: id }, status);
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
        user: { id, displayName: "Синтетический проверяющий" },
        csrfToken: "test-csrf",
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
  await page.route(
    (url) => url.pathname === "/api/v1/reviews",
    (route) =>
      json(route, {
        items: [
          {
            ...item,
            acceptance:
              mode === "hidden"
                ? { enabled: false, mode: null }
                : bonusModes.includes(mode)
                  ? { ...item.acceptance, options: bonusOptions }
                  : item.acceptance,
          },
        ],
        nextCursor: null,
      }),
  );
  let ledgerReads = 0;
  await page.route(
    (url) => url.pathname === "/api/v1/me/ledger",
    (route) => {
      ledgerReads++;
      if (mode === "ledger-refresh-failed" && ledgerReads > 1)
        return fail(route, 503, "UNAVAILABLE");
      if (mode === "ledger-more") {
        const next = new URL(route.request().url()).searchParams.has("cursor");
        return json(route, {
          balance,
          entries: [entries[next ? 1 : 0]],
          nextCursor: next ? null : `${at}|${id}`,
          asOf: at,
        });
      }
      return mode === "ledger-failed"
        ? fail(route, 503, "UNAVAILABLE")
        : mode === "ledger-revoked"
          ? fail(route, 403, "ACCESS_REVOKED")
          : mode === "ledger-empty"
            ? json(route, {
                balance: {
                  lifetimeXp: 0,
                  availablePoints: 0,
                  reservedPoints: 0,
                  version: 0,
                  updatedAt: null,
                },
                entries: [],
                nextCursor: null,
                asOf: at,
              })
            : json(route, { balance, entries, nextCursor: null, asOf: at });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/submissions/${sub}/review`,
    async (route) => {
      const req = route.request();
      assert.equal(req.headers()["x-csrf-token"], "test-csrf");
      calls.push({
        key: req.headers()["idempotency-key"],
        body: req.postDataJSON(),
      });
      assert.deepEqual(
        calls.at(-1).body,
        bonusModes.includes(mode)
          ? {
              action: "accept",
              expectedVersion: 3,
              reason,
              baseXp: 120,
              basePoints: 25,
              bonusCode: "quality",
            }
          : { action: "accept", expectedVersion: 3, reason },
      );
      if (mode === "bonus-rejected" && calls.length === 1)
        return fail(route, 422, "AWARD_INVALID");
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
      if (mode === "conflict") return fail(route, 409, "TASK_CONFLICT");
      if (mode === "disabled") return fail(route, 503, "ECONOMY_DISABLED");
      if (mode === "rules") return fail(route, 422, "ECONOMY_RULES_INVALID");
      if (mode === "recipient") return fail(route, 422, "RECIPIENT_REVOKED");
      if (mode === "revoked") return fail(route, 403, "ACCESS_REVOKED");
      if (mode === "expired") return fail(route, 401, "UNAUTHORIZED");
      if (["offline", "lost-rate-limited"].includes(mode) && calls.length === 1)
        return route.abort("internetdisconnected");
      if (mode === "unavailable" && calls.length === 1)
        return fail(route, 503, "UNAVAILABLE");
      return json(route, {
        review: {
          id,
          submissionId: sub,
          decision: "accept",
          reason,
          createdAt: at,
        },
        task: { id: task, status: "accepted", version: 4 },
        award: bonusModes.includes(mode)
          ? {
              ...award,
              xp: 140,
              points: 35,
              breakdown: {
                baseXp: 120,
                basePoints: 25,
                bonus: {
                  code: "quality",
                  title: "Качество",
                  xp: 20,
                  points: 10,
                },
              },
            }
          : award,
      });
    },
  );
  await page.goto(origin);
  await openReviewQueue(page);
  await page
    .getByRole("heading", { name: "Очередь проверки", exact: true })
    .waitFor();
  return { page, calls, errors };
}
async function open(page) {
  await page.getByRole("button", { name: new RegExp(item.task.title) }).click();
  await page
    .getByRole("radio", { name: "Принять результат", exact: true })
    .check();
  await page.getByLabel("Основание приёмки", { exact: true }).fill(reason);
}
async function confirm(page) {
  await page
    .getByRole("checkbox", { name: "Подтверждаю результат и указанный фонд" })
    .check();
}
const send = (page) =>
  page.getByRole("button", {
    name: "Подтвердить приёмку и начисление",
    exact: true,
  });
try {
  for (const width of [320, 360, 390, 1280]) {
    const { page, calls, errors } = await fixture(width);
    await open(page);
    assert.equal(await send(page).isDisabled(), true);
    assert.equal(calls.length, 0);
    await confirm(page);
    await page.screenshot({
      path: `.impeccable/review/acceptance/preview-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await send(page).click();
    await page
      .getByText("Результат принят. Начислено 100 XP и 30 баллов", {
        exact: false,
      })
      .waitFor();
    assert.equal(calls.length, 1);
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page
      .getByRole("button", { name: "Баланс и журнал", exact: true })
      .click();
    await page.getByText("100 XP", { exact: true }).waitFor();
    await page.getByText("+30 баллов", { exact: true }).waitFor();
    await page.screenshot({
      path: `.impeccable/review/acceptance/ledger-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.close();
    count++;
  }
  for (const mode of [
    "offline",
    "unavailable",
    "rate-limited",
    "lost-rate-limited",
  ]) {
    const { page, calls } = await fixture(390, mode);
    await open(page);
    await confirm(page);
    await send(page).click();
    await page
      .getByRole("button", { name: "Повторить тот же запрос", exact: true })
      .waitFor();
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
        await page
          .getByLabel("Основание приёмки", { exact: true })
          .inputValue(),
        reason,
      );
    }
    assert.equal(
      await page
        .getByRole("radio", { name: "Вернуть на доработку", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Повторить тот же запрос", exact: true })
      .click();
    await page.getByText("Результат принят.", { exact: false }).waitFor();
    assert.equal(calls.length, mode === "lost-rate-limited" ? 3 : 2);
    for (const call of calls) assert.deepEqual(calls[0], call);
    await page.close();
    count++;
  }
  for (const mode of ["conflict", "disabled", "rules", "recipient"]) {
    const { page, calls } = await fixture(320, mode);
    await open(page);
    await confirm(page);
    await send(page).click();
    await page.locator(".task-report").getByRole("alert").waitFor();
    assert.equal(
      await page.getByLabel("Основание приёмки", { exact: true }).inputValue(),
      reason,
    );
    assert.equal(await send(page).count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Повторить тот же запрос" })
        .count(),
      0,
    );
    assert.equal(calls.length, 1);
    await page.close();
    count++;
  }
  for (const mode of ["revoked", "expired"]) {
    const { page } = await fixture(390, mode);
    await open(page);
    await confirm(page);
    await send(page).click();
    await page
      .getByRole("heading", {
        name:
          mode === "revoked"
            ? "Доступ отозван"
            : "Не удалось подтвердить сессию",
        exact: true,
      })
      .waitFor();
    assert.equal(await page.getByLabel("Основание приёмки").count(), 0);
    await page.close();
    count++;
  }
  {
    const { page } = await fixture(390, "hidden");
    await page
      .getByRole("button", { name: new RegExp(item.task.title) })
      .click();
    assert.equal(
      await page.getByRole("radio", { name: "Принять результат" }).count(),
      0,
    );
    await page.close();
    count++;
  }
  for (const mode of ["ledger-empty", "ledger-failed", "ledger-revoked"]) {
    const { page } = await fixture(320, mode);
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page
      .getByRole("button", { name: "Баланс и журнал", exact: true })
      .click();
    if (mode === "ledger-empty")
      await page.getByText("Начислений пока нет.", { exact: false }).waitFor();
    else if (mode === "ledger-revoked")
      await page
        .getByRole("heading", { name: "Доступ отозван", exact: true })
        .waitFor();
    else {
      await page
        .getByRole("region", { name: "Баланс и журнал", exact: true })
        .getByRole("alert")
        .waitFor();
      assert.equal(await page.getByText("0 XP", { exact: true }).count(), 0);
    }
    await page.close();
    count++;
  }
  {
    const { page, calls } = await fixture(390);
    await page
      .getByRole("button", { name: new RegExp(item.task.title) })
      .focus();
    await page.keyboard.press("Enter");
    const radio = page.getByRole("radio", {
      name: "Принять результат",
      exact: true,
    });
    await radio.focus();
    await page.keyboard.press("Space");
    await page.getByLabel("Основание приёмки", { exact: true }).fill(reason);
    const checkbox = page.getByRole("checkbox", {
      name: "Подтверждаю результат и указанный фонд",
    });
    await checkbox.focus();
    await page.keyboard.press("Space");
    assert.equal(await checkbox.isChecked(), true);
    await send(page).focus();
    await page.keyboard.press("Enter");
    await page.getByText("Результат принят.", { exact: false }).waitFor();
    assert.equal(calls.length, 1);
    await page.close();
    count++;
  }
  for (const mode of bonusModes) {
    const { page, calls, errors } = await fixture(320, mode);
    await open(page);
    const preview = page.getByRole("region", {
      name: "Предварительное начисление",
    });
    assert.match(await preview.innerText(), /получит\s+100 XP\s+и\s+30 баллов/);
    await page.getByLabel(/Базовый XP/).fill("201");
    assert.equal(await send(page).isDisabled(), true);
    const limits =
      "XP от 50 до 200, баллы от 15 до 80 по настройкам начислений.";
    await page.getByText(limits, { exact: false }).waitFor();
    await page.getByLabel(/Базовый XP/).fill("49");
    assert.equal(await send(page).isDisabled(), true);
    await page.getByText(limits, { exact: false }).waitFor();
    await page.getByLabel(/Базовый XP/).fill("120");
    await page.getByLabel(/Базовые баллы/).fill("25");
    await page.getByLabel("Бонус (не более одного)").selectOption("quality");
    assert.match(await preview.innerText(), /получит\s+140 XP\s+и\s+35 баллов/);
    assert.match(
      await preview.innerText(),
      /бонус «Качество»: 20 XP и 10 баллов/,
    );
    assert.equal(await send(page).isDisabled(), true);
    await page
      .getByRole("checkbox", {
        name: "Подтверждаю результат и указанное начисление",
      })
      .check();
    await send(page).click();
    if (mode === "bonus-rejected") {
      await page
        .getByText(
          "Корректировка или бонус не разрешены настройками начислений",
          {
            exact: false,
          },
        )
        .waitFor();
      // The form stays editable: a rejected choice is not a terminal state.
      assert.equal(await page.getByLabel(/Базовый XP/).isDisabled(), false);
      await page
        .getByRole("checkbox", {
          name: "Подтверждаю результат и указанное начисление",
        })
        .check();
      await send(page).click();
    }
    await page
      .getByText(
        "Начислено 140 XP и 35 баллов (бонус «Качество»: 20 XP и 10 баллов)",
        { exact: false },
      )
      .waitFor();
    assert.equal(calls.length, mode === "bonus-rejected" ? 2 : 1);
    assert.notEqual(calls[0].key, calls[1]?.key ?? "");
    assert.deepEqual(errors, []);
    await page.close();
    count++;
  }
  for (const mode of ["ledger-more", "ledger-refresh-failed"]) {
    const { page } = await fixture(320, mode);
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page
      .getByRole("button", { name: "Баланс и журнал", exact: true })
      .click();
    await page.getByText("+100 XP", { exact: true }).waitFor();
    if (mode === "ledger-more") {
      await page
        .getByRole("button", { name: "Показать ещё записи", exact: true })
        .click();
      await page.getByText("+30 баллов", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Показать ещё записи", exact: true })
          .count(),
        0,
      );
    } else {
      await page
        .getByRole("button", { name: "Обновить журнал", exact: true })
        .click();
      await page
        .getByText("Показаны последние подтверждённые значения.", {
          exact: false,
        })
        .waitFor();
      assert.equal(await page.getByText("100 XP", { exact: true }).count(), 1);
    }
    await page.close();
    count++;
  }
  console.log(`Acceptance/journal browser scenarios passed: ${count}`);
} finally {
  await browser.close();
}
