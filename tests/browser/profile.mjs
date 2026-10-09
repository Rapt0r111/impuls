import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const dir = path.join(
  process.env.TEST_SCREENSHOT_DIR ?? "test-results",
  "profile",
);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch(),
  id = "a1111111-1111-4111-8111-111111111111",
  at = "2026-10-02T10:00:00.000Z";
let scenarios = 0;
async function fixture(mode = "populated", width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let fail = false;
  const json = (r, body, status = 200) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}",
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me",
    (r) =>
      json(r, {
        user: { id, displayName: "Синтетический участник" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (r) => json(r, { permissions: [] }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/tasks",
    (r) => json(r, { items: [], nextCursor: null }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/profile",
    async (r) => {
      if (mode === "loading")
        await new Promise((resolve) => setTimeout(resolve, 1500));
      if (mode === "disabled" || mode === "unavailable" || fail)
        return json(
          r,
          { code: "TEST" },
          mode === "disabled"
            ? 404
            : mode === "revoked"
              ? 403
              : mode === "session"
                ? 401
                : 503,
        );
      const xp = mode === "empty" ? 0 : mode === "maximum" ? 250 : 125;
      return json(r, {
        mode: "synthetic",
        user: { id, displayName: "Синтетический участник" },
        balance: {
          lifetimeXp: xp,
          availablePoints: 400,
          reservedPoints: 0,
          version: 1,
          updatedAt: at,
        },
        progression:
          mode === "unconfigured"
            ? { state: "unconfigured", ruleVersion: null, level: null }
            : mode === "invalid"
              ? { state: "invalid", ruleVersion: 2, level: null }
              : {
                  state: "configured",
                  ruleVersion: 1,
                  level:
                    xp === 250
                      ? {
                          level: 3,
                          minimumXp: 250,
                          nextLevelXp: null,
                          remainingXp: 0,
                          progressXp: 0,
                          spanXp: null,
                        }
                      : xp === 0
                        ? {
                            level: 1,
                            minimumXp: 0,
                            nextLevelXp: 100,
                            remainingXp: 100,
                            progressXp: 0,
                            spanXp: 100,
                          }
                        : {
                            level: 2,
                            minimumXp: 100,
                            nextLevelXp: 250,
                            remainingXp: 125,
                            progressXp: 25,
                            spanXp: 150,
                          },
                },
        firstResult:
          mode === "empty"
            ? null
            : {
                code: "first_result",
                conditionVersion: 1,
                sourceEntryId: id,
                reviewId: id,
                task: {
                  id,
                  title:
                    "Синтетический_первый_результат_с_очень_длинным_неразрывным_названием",
                },
                grantedAt: at,
                provenance: mode === "migration" ? "migration" : "acceptance",
                sourceCorrected: mode === "corrected",
              },
        asOf: at,
      });
    },
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  return {
    page,
    context,
    errors,
    setFail: () => {
      fail = true;
    },
  };
}
async function close(f) {
  assert.deepEqual(f.errors, []);
  assert.equal(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await f.context.close();
  scenarios++;
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("populated", width);
    await f.page.getByText("Уровень 2", { exact: true }).waitFor();
    assert.equal(
      await f.page.getByRole("progressbar").getAttribute("value"),
      "25",
    );
    const refresh = f.page.getByRole("button", {
      name: "Обновить профиль",
      exact: true,
    });
    await refresh.focus();
    await f.page.keyboard.press("Enter");
    await f.page.getByText("Уровень 2", { exact: true }).waitFor();
    assert.ok(
      (await refresh.evaluate((e) => e.getBoundingClientRect().height)) >= 44,
    );
    await f.page.screenshot({
      path: path.join(dir, `profile-${width}.png`),
      fullPage: true,
    });
    await close(f);
  }
  for (const [mode, text] of Object.entries({
    empty: "Пока не получено.",
    unconfigured: "Уровни ещё не настроены",
    invalid: "Пороги уровней в текущей версии правил некорректны",
    maximum: "Достигнут последний настроенный уровень",
    corrected: "Исходное начисление возвращено",
    migration: "Восстановлено по первой сохранённой приёмке",
    disabled: "Синтетический профиль выключен",
    unavailable: "Профиль недоступен",
    loading: "Загружаем профиль…",
  })) {
    const f = await fixture(mode, 320);
    await f.page.getByText(text, { exact: false }).waitFor();
    if (["empty", "unconfigured", "corrected", "disabled"].includes(mode))
      await f.page.screenshot({
        path: path.join(dir, `profile-${mode}-320.png`),
        fullPage: true,
      });
    await close(f);
  }
  for (const mode of ["stale", "offline", "revoked", "session"]) {
    const f = await fixture(mode, 320);
    await f.page.getByText("Уровень 2", { exact: true }).waitFor();
    f.setFail();
    if (mode === "offline") await f.context.setOffline(true);
    await f.page
      .getByRole("button", { name: "Обновить профиль", exact: true })
      .click();
    if (mode === "stale" || mode === "offline") {
      await f.page
        .getByRole("alert")
        .filter({ hasText: "последние подтверждённые значения" })
        .waitFor();
      assert.equal(
        await f.page.getByText("Уровень 2", { exact: true }).count(),
        1,
      );
    } else {
      await f.page
        .getByRole("heading", {
          name:
            mode === "revoked"
              ? "Доступ отозван"
              : "Не удалось подтвердить сессию",
        })
        .waitFor();
      assert.equal(await f.page.locator(".participant-profile").count(), 0);
    }
    await close(f);
  }
  const large = await fixture("populated", 320);
  await large.page.getByText("Уровень 2", { exact: true }).waitFor();
  await large.page.addStyleTag({
    content:
      "html { font-size: 150%; } .participant-profile { font-size: 24px; }",
  });
  await close(large);
  console.log(
    JSON.stringify({ scenarios, screenshots: dir, result: "passed" }),
  );
} finally {
  await browser.close();
}
