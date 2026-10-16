import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
import { selectOption, selectTrigger } from "./select-option.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const dir = path.join(
  process.env.TEST_SCREENSHOT_DIR ?? "test-results",
  "ranking",
);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const scope = "a1111111-1111-4111-8111-111111111111";
const other = "b1111111-1111-4111-8111-111111111111";
const at = "2026-10-02T09:00:00.000Z",
  revision = "a".repeat(64);
const items = Array.from({ length: 24 }, (_, i) => ({
  id: `c1111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
  displayName:
    i === 1
      ? "Синтетический_псевдоним_с_очень_длинным_неразрывным_написанием"
      : `Учебный участник ${i + 1}`,
  xp: i < 3 ? 100 : 100 - i,
  rank: i < 3 ? 1 : i + 1,
  isSelf: i === 1,
}));
let scenarios = 0;
async function fixture(mode = "populated", width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 850 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let fail = false,
    calls = 0;
  const json = (route, body, status = 200) =>
    route.fulfill({
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
        user: { id: scope, displayName: "Синтетический участник" },
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
    (url) => url.pathname === "/api/v1/leaderboard",
    async (r) => {
      calls++;
      const params = new URL(r.request().url()).searchParams;
      const hasCursor = params.has("cursor");
      let code = fail
        ? mode === "revoked"
          ? 403
          : mode === "session"
            ? 401
            : 503
        : mode === "disabled"
          ? 404
          : mode === "unavailable"
            ? 503
            : mode === "changed" && hasCursor
              ? 409
              : 0;
      if (code)
        return json(
          r,
          {
            code:
              mode === "disabled"
                ? "RANKING_DISABLED"
                : code === 409
                  ? "RANKING_CHANGED"
                  : "UNAVAILABLE",
            message: "Synthetic",
            requestId: scope,
          },
          code,
        );
      if (mode === "loading")
        await new Promise((resolve) => setTimeout(resolve, 600));
      const empty = mode === "empty" || params.get("season") === "2026-08";
      const noScope = mode === "no-scope";
      return json(r, {
        mode: "synthetic",
        timeZone: "Europe/Moscow",
        season: params.get("season") ?? "2026-10",
        scopes: noScope
          ? []
          : [
              { id: scope, name: "Учебная область" },
              { id: other, name: "Вторая учебная область" },
            ],
        scope: noScope
          ? null
          : { id: params.get("scope") ?? scope, name: "Учебная область" },
        self: noScope ? null : { xp: empty ? 0 : 100, rank: empty ? null : 1 },
        items:
          empty || noScope
            ? []
            : hasCursor
              ? items.slice(20)
              : items.slice(0, 20),
        nextCursor:
          !empty && !noScope && !hasCursor
            ? `${scope}|2026-10|${revision}|${items[19].id}`
            : null,
        revision: noScope ? null : revision,
        updatedAt: at,
      });
    },
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Рейтинг", exact: true }).click();
  return {
    page,
    context,
    errors,
    setFail: () => {
      fail = true;
    },
    getCalls: () => calls,
  };
}
async function close(f) {
  assert.deepEqual(f.errors, []);
  await f.context.close();
  scenarios++;
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("populated", width);
    await f.page
      .getByRole("rowheader", { name: "Учебный участник 1", exact: true })
      .waitFor();
    assert.equal(await f.page.locator(".ranking-table tbody tr").count(), 20);
    assert.equal(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await f.page.keyboard.press("Tab");
    await f.page.locator('.ranking-section[aria-busy="false"]').waitFor();
    await f.page
      .getByRole("button", { name: "Обновить рейтинг", exact: true })
      .focus();
    assert.equal(
      await f.page
        .getByRole("button", { name: "Обновить рейтинг", exact: true })
        .evaluate((el) => getComputedStyle(el).outlineStyle),
      "solid",
    );
    await f.page
      .getByRole("button", { name: "Обновить рейтинг", exact: true })
      .press("Enter");
    await f.page
      .getByRole("button", { name: "Обновить рейтинг", exact: true })
      .waitFor();
    await f.page.screenshot({
      path: path.join(dir, `ranking-${width}.png`),
      fullPage: true,
    });
    await f.page
      .getByRole("button", { name: "Показать ещё участников", exact: true })
      .click();
    await f.page
      .getByRole("rowheader", { name: "Учебный участник 24", exact: true })
      .waitFor();
    assert.equal(await f.page.locator(".ranking-table tbody tr").count(), 24);
    await f.page
      .getByRole("textbox", { name: "Месяц", exact: true })
      .fill("2026-08");
    await f.page
      .getByText("В этом месяце ещё нет положительного XP.", { exact: false })
      .waitFor();
    await f.page
      .getByRole("textbox", { name: "Месяц", exact: true })
      .fill("2026-10");
    await f.page
      .getByRole("rowheader", { name: "Учебный участник 1", exact: true })
      .waitFor();
    await selectOption(f.page, "Область", other);
    await selectTrigger(f.page, "Область").waitFor();
    await close(f);
  }
  for (const mode of [
    "empty",
    "no-scope",
    "disabled",
    "unavailable",
    "loading",
  ]) {
    const f = await fixture(mode, 320);
    const text = {
      empty: "В этом месяце ещё нет положительного XP.",
      "no-scope": "Рейтинг виден участникам.",
      disabled: "Рейтинг сейчас выключен.",
      unavailable: "Рейтинг недоступен.",
      loading: "Загружаем рейтинг…",
    }[mode];
    await f.page.getByText(text, { exact: false }).waitFor();
    if (["empty", "no-scope", "disabled"].includes(mode))
      await f.page.screenshot({
        path: path.join(dir, `ranking-${mode}-320.png`),
        fullPage: true,
      });
    await close(f);
  }
  const changed = await fixture("changed", 320);
  await changed.page
    .getByRole("button", { name: "Показать ещё участников", exact: true })
    .click();
  await changed.page
    .getByRole("alert")
    .filter({ hasText: "Рейтинг изменился" })
    .waitFor();
  assert.equal(
    await changed.page.locator(".ranking-table tbody tr").count(),
    20,
  );
  await changed.page.screenshot({
    path: path.join(dir, "ranking-changed-320.png"),
    fullPage: true,
  });
  await changed.page
    .getByRole("button", { name: "Обновить рейтинг", exact: true })
    .click();
  await changed.page
    .getByRole("button", { name: "Показать ещё участников", exact: true })
    .waitFor();
  await close(changed);
  for (const mode of ["stale", "offline", "revoked", "session"]) {
    const f = await fixture(mode);
    await f.page
      .getByRole("rowheader", { name: "Учебный участник 1", exact: true })
      .waitFor();
    f.setFail();
    if (mode === "offline") await f.context.setOffline(true);
    await f.page
      .getByRole("button", { name: "Обновить рейтинг", exact: true })
      .click();
    if (mode === "stale" || mode === "offline") {
      await f.page
        .getByRole("alert")
        .filter({ hasText: "последний подтверждённый" })
        .waitFor();
      assert.equal(await f.page.locator(".ranking-table tbody tr").count(), 20);
    } else {
      await f.page
        .getByRole("heading", {
          name:
            mode === "revoked"
              ? "Доступ отозван"
              : "Не удалось подтвердить сессию",
        })
        .waitFor();
      assert.equal(await f.page.locator(".ranking-table").count(), 0);
    }
    await close(f);
  }
  console.log(
    JSON.stringify({ scenarios, screenshots: dir, result: "passed" }),
  );
} finally {
  await browser.close();
}
