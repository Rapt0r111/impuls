import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
import { openSection } from "./nav.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const id = "11111111-1111-4111-8111-111111111111",
  review = "22222222-2222-4222-8222-222222222222",
  task = "33333333-3333-4333-8333-333333333333",
  correction = "44444444-4444-4444-8444-444444444444";
const at = "2026-10-02T08:00:00.000Z";
const balance = {
  lifetimeXp: 100,
  availablePoints: 30,
  reservedPoints: 0,
  version: 1,
  updatedAt: at,
};
const item = {
  reviewId: review,
  task: { id: task, title: "Проверить результат учебной задачи" },
  recipient: { id: task, displayName: "Синтетический получатель" },
  scope: { id, name: "Учебная область" },
  xp: 100,
  points: 30,
  seasonKey: "2026-09",
  ruleVersion: 2,
  acceptedAt: at,
  balance,
  enabled: true,
  correction: null,
};
const dir = path.join(
  process.env.TEST_SCREENSHOT_DIR ?? ".impeccable/review",
  "ledger-corrections",
);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
let scenarios = 0;
async function fixture(width = 390, mode = "success") {
  const page = await browser.newPage({
    viewport: { width, height: 850 },
    reducedMotion: "reduce",
  });
  const calls = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (route, body, status = 200, headers = {}) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
      headers,
    });
  const fail = (route, status, code) =>
    json(
      route,
      { code, message: "Синтетический отказ", requestId: id },
      status,
    );
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
        user: { id, displayName: "Синтетический администратор" },
        csrfToken: "synthetic-csrf",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (route) =>
      json(route, {
        permissions:
          mode === "no-right"
            ? []
            : [
                {
                  action: "ledger.correct",
                  scope: { id, kind: "project", name: "Учебная область" },
                  validUntil: null,
                },
              ],
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks",
    (route) => json(route, { items: [], nextCursor: null }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/ledger",
    (route) =>
      json(route, {
        balance: {
          lifetimeXp: 0,
          availablePoints: 0,
          reservedPoints: 0,
          version: 0,
          updatedAt: null,
        },
        entries:
          mode === "personal"
            ? [
                {
                  id: correction,
                  currency: "xp",
                  amount: -100,
                  kind: "acceptance_reversal",
                  correction: {
                    id: correction,
                    originalEntryId: review,
                    actor: { id, displayName: "Синтетический проверяющий" },
                  },
                  reason: "Исправлено ошибочное начисление",
                  task: item.task,
                  ruleVersion: 2,
                  seasonKey: "2026-09",
                  timeZone: "Europe/Moscow",
                  mode: "synthetic",
                  createdAt: at,
                },
              ]
            : [],
        nextCursor: null,
        asOf: at,
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/admin/ledger-corrections",
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        if (mode === "unavailable") return fail(route, 503, "UNAVAILABLE");
        const refreshed = new URL(req.url()).searchParams.has("reviewId");
        const next = {
          ...item,
          balance:
            mode === "low-balance" || (refreshed && mode === "conflict-low")
              ? {
                  ...balance,
                  lifetimeXp: 90,
                  availablePoints: 2,
                  version: refreshed ? 2 : 1,
                }
              : refreshed
                ? {
                    ...balance,
                    lifetimeXp: 130,
                    availablePoints: 40,
                    version: 2,
                  }
                : balance,
          enabled: mode !== "disabled",
          correction:
            mode === "corrected"
              ? {
                  id: correction,
                  reviewId: review,
                  reason: "Уже исправлено",
                  xpDelta: -100,
                  pointsDelta: -30,
                  createdAt: at,
                }
              : null,
        };
        return json(route, {
          items: mode === "empty" ? [] : [next],
          nextCursor: null,
          asOf: at,
        });
      }
      assert.equal(req.headers()["x-csrf-token"], "synthetic-csrf");
      calls.push({
        key: req.headers()["idempotency-key"],
        body: req.postDataJSON(),
      });
      if (mode === "revoked") return fail(route, 403, "ACCESS_REVOKED");
      if (mode === "insufficient")
        return fail(route, 422, "INSUFFICIENT_BALANCE");
      if (["conflict", "conflict-low"].includes(mode) && calls.length === 1)
        return fail(route, 409, "BALANCE_CONFLICT");
      if (mode === "unknown" && calls.length === 1)
        return fail(route, 503, "UNAVAILABLE");
      if (mode === "rate-limit" && calls.length === 1)
        return json(
          route,
          { code: "RATE_LIMITED", message: "Too many", requestId: id },
          429,
          { "Retry-After": "17" },
        );
      const version = calls.at(-1).body.expectedVersion;
      return json(route, {
        correction: {
          id: correction,
          reviewId: review,
          reason: calls.at(-1).body.reason,
          xpDelta: -100,
          pointsDelta: -30,
          createdAt: at,
        },
        balance: {
          ...balance,
          lifetimeXp: version === 2 ? 30 : 0,
          availablePoints: version === 2 ? 10 : 0,
          version: version + 1,
        },
      });
    },
  );
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goto(origin);
  await (await openSection(page, "Баланс и журнал")).click();
  const open = async () => {
    await page
      .getByRole("button", { name: "Исправление начислений", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Вернуть начисление", exact: true })
      .click();
  };
  return { page, calls, errors, open };
}
async function fill(page, reason = "Синтетическое ошибочное начисление") {
  await page.getByLabel("Основание возврата", { exact: true }).fill(reason);
  await page
    .getByLabel("Подтверждаю получателя, обе суммы и новый баланс")
    .check();
}
async function send(page) {
  await page
    .getByRole("button", { name: "Записать возврат начисления", exact: true })
    .click();
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture(width);
    await f.open();
    assert.equal(
      await f.page
        .getByRole("button", {
          name: "Записать возврат начисления",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await fill(f.page);
    await f.page
      .getByRole("button", { name: "Записать возврат начисления", exact: true })
      .focus();
    assert.equal(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await f.page.evaluate(() => window.scrollTo(0, 0));
    await f.page.screenshot({
      path: path.join(dir, `f04-correction-${width}.png`),
      fullPage: true,
    });
    await f.page
      .getByRole("button", { name: "Записать возврат начисления", exact: true })
      .press("Enter");
    await f.page.getByText(/Возврат записан: -100 XP/).waitFor();
    assert.deepEqual(f.calls[0].body, {
      reviewId: review,
      expectedVersion: 1,
      reason: "Синтетическое ошибочное начисление",
    });
    assert.deepEqual(f.errors, []);
    await f.page.close();
    scenarios++;
  }
  for (const mode of ["unknown", "rate-limit"]) {
    const f = await fixture(390, mode);
    await f.open();
    await fill(f.page);
    await send(f.page);
    await f.page
      .getByRole("button", { name: "Повторить тот же запрос", exact: true })
      .waitFor();
    assert.equal(
      await f.page
        .getByLabel("Основание возврата", { exact: true })
        .isDisabled(),
      true,
    );
    if (mode === "rate-limit")
      await f.page.getByText(/Подождите 17 с/).waitFor();
    await f.page
      .getByRole("button", { name: "Повторить тот же запрос", exact: true })
      .click();
    await f.page.getByText(/Возврат записан: -100 XP/).waitFor();
    assert.deepEqual(f.calls[0], f.calls[1]);
    assert.deepEqual(f.errors, []);
    await f.page.close();
    scenarios++;
  }
  {
    const f = await fixture(360, "conflict");
    await f.open();
    await fill(f.page, "Сохранить основание при конфликте");
    await send(f.page);
    await f.page
      .getByRole("button", { name: "Обновить баланс", exact: true })
      .click();
    await f.page
      .getByRole("button", {
        name: "Принять новую версию баланса",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await f.page
        .getByLabel("Основание возврата", { exact: true })
        .inputValue(),
      "Сохранить основание при конфликте",
    );
    assert.equal(f.calls.length, 1);
    await f.page
      .getByRole("button", {
        name: "Принять новую версию баланса",
        exact: true,
      })
      .click();
    assert.equal(
      await f.page
        .getByLabel("Подтверждаю получателя, обе суммы и новый баланс")
        .isChecked(),
      false,
    );
    await f.page
      .getByLabel("Подтверждаю получателя, обе суммы и новый баланс")
      .check();
    await send(f.page);
    await f.page.getByText(/Возврат записан: -100 XP/).waitFor();
    assert.equal(f.calls[1].body.expectedVersion, 2);
    assert.notEqual(f.calls[0].key, f.calls[1].key);
    assert.deepEqual(f.errors, []);
    await f.page.close();
    scenarios++;
  }
  {
    const f = await fixture(320);
    await f.open();
    const text = "ДлинноеОснование".repeat(100);
    await fill(f.page, text);
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    assert.equal(
      await f.page
        .getByLabel("Основание возврата", { exact: true })
        .inputValue(),
      text,
    );
    assert.equal(f.calls.length, 0);
    await f.page.addStyleTag({
      content:
        "html {font-size:125%} .tasks-detail p {font-size:20px} textarea {font-size:20px}",
    });
    assert.equal(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(f.errors, []);
    await f.page.close();
    scenarios++;
  }
  for (const mode of ["low-balance", "conflict-low"]) {
    const f = await fixture(320, mode);
    await f.open();
    await fill(f.page, "Сохранённое основание при нехватке баллов");
    if (mode === "conflict-low") {
      await send(f.page);
      await f.page
        .getByRole("button", { name: "Обновить баланс", exact: true })
        .click();
      await f.page
        .getByText(/Полный возврат невозможен: доступный баланс/)
        .waitFor();
      assert.equal(await f.page.getByText(/После возврата: -/).count(), 0);
      await f.page.evaluate(() => window.scrollTo(0, 0));
      await f.page.screenshot({
        path: path.join(dir, "f04-candidate-insufficient-320.png"),
        fullPage: true,
      });
      await f.page
        .getByRole("button", {
          name: "Принять новую версию баланса",
          exact: true,
        })
        .click();
      await f.page
        .getByLabel("Подтверждаю получателя, обе суммы и новый баланс")
        .check();
    } else {
      await f.page
        .getByText(/Полный возврат невозможен без отдельного решения/)
        .waitFor();
      await f.page.evaluate(() => window.scrollTo(0, 0));
      await f.page.screenshot({
        path: path.join(dir, "f04-insufficient-320.png"),
        fullPage: true,
      });
    }
    assert.equal(
      await f.page
        .getByRole("button", {
          name: "Записать возврат начисления",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    assert.equal(
      await f.page
        .getByLabel("Основание возврата", { exact: true })
        .inputValue(),
      "Сохранённое основание при нехватке баллов",
    );
    assert.equal(f.calls.length, mode === "conflict-low" ? 1 : 0);
    assert.deepEqual(f.errors, []);
    await f.page.close();
    scenarios++;
  }
  for (const mode of ["empty", "unavailable", "disabled", "corrected"]) {
    const f = await fixture(320, mode);
    await f.page
      .getByRole("button", { name: "Исправление начислений", exact: true })
      .click();
    await f.page
      .getByText(
        mode === "empty"
          ? "В доступных областях пока нет начислений."
          : mode === "unavailable"
            ? "Начисления недоступны. Повторите загрузку."
            : mode === "disabled"
              ? "Возврат недоступен."
              : "Возврат записан: Уже исправлено",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await f.page
        .getByRole("button", { name: "Вернуть начисление", exact: true })
        .count(),
      0,
    );
    assert.deepEqual(f.errors, []);
    await f.page.close();
    scenarios++;
  }
  for (const mode of ["revoked", "insufficient"]) {
    const f = await fixture(390, mode);
    await f.open();
    await fill(f.page);
    await send(f.page);
    if (mode === "revoked") {
      await f.page
        .getByRole("heading", { name: "Доступ отозван", exact: true })
        .waitFor();
      assert.equal(
        await f.page.getByLabel("Основание возврата", { exact: true }).count(),
        0,
      );
    } else {
      await f.page.getByText(/Недостаточно доступных XP/).waitFor();
      assert.equal(
        await f.page
          .getByLabel("Основание возврата", { exact: true })
          .inputValue(),
        "Синтетическое ошибочное начисление",
      );
    }
    assert.deepEqual(f.errors, []);
    await f.page.close();
    scenarios++;
  }
  {
    const f = await fixture(390, "no-right");
    assert.equal(
      await f.page
        .getByRole("button", { name: "Исправление начислений", exact: true })
        .count(),
      0,
    );
    await f.page.close();
    scenarios++;
  }
  {
    const f = await fixture(320, "personal");
    await f.page.getByText(/-100 XP/).waitFor();
    await f.page
      .getByText(/Возврат начисления · Синтетический проверяющий/)
      .waitFor();
    assert.equal(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(f.errors, []);
    await f.page.close();
    scenarios++;
  }
  console.log(
    JSON.stringify({ scenarios, screenshots: dir, result: "passed" }),
  );
} finally {
  await browser.close();
}
