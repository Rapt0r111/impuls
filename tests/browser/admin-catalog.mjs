import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
import { openSection } from "./nav.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "admin-catalog",
  );
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const actor = "a1111111-1111-4111-8111-111111111111",
  scope = "b1111111-1111-4111-8111-111111111111",
  other = "c1111111-1111-4111-8111-111111111111",
  reward = "d1111111-1111-4111-8111-111111111111";
const scopes = [
    { id: scope, name: "Учебная_область_с_длинным_названием" },
    { id: other, name: "Пустая область" },
  ],
  cursor = `${actor}|${scope}|admin-catalog|${reward}`;
const terms = {
  id: reward,
  version: 2,
  title: "Учебный статус исследователя",
  conditions:
    "Синтетическая косметика. Условия сохраняются в версии и не означают реальное служебное поощрение.",
  price: 12345,
  enabled: false,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  reservationSeconds: null,
};
const quota = {
  id: reward,
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: "2027-01-01T00:00:00.000Z",
  capacity: 9,
  reserved: 2,
  used: 3,
  available: 4,
};
let scenarios = 0;
async function fixture(mode = "ready", width = 320) {
  const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    calls = [],
    historyCalls = [],
    quotaCalls = [];
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  let fail = 0,
    delay = 0,
    historyFail = 0,
    historyDelay = 0,
    historyMode = "ready",
    quotaFail = 0,
    quotaDelay = 0,
    quotaMode = "ready";
  const json = (r, b, status = 200) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(b),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.__back=null;window.Telegram={WebApp:{version:'8.0',isVersionAtLeast(){return true},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(cb){window.__back=cb},offClick(){window.__back=null}}}}",
    }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me",
    (r) =>
      json(r, {
        user: { id: actor, displayName: "Учебный администратор" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me/permissions",
    (r) =>
      json(r, {
        permissions: (mode === "no-permission"
          ? ["reward.decide"]
          : mode === "all-permissions"
            ? [
                "admin.catalog",
                "admin.audit",
                "admin.notifications",
                "task.review",
                "task.create",
              ]
            : ["admin.catalog"]
        ).map((action) => ({
          action,
          scope: { ...scopes[0], kind: "group" },
          validUntil: null,
        })),
      }),
  );
  for (const name of ["tasks", "reviews"])
    await page.route(
      (u) => u.pathname === `/api/v1/${name}`,
      (r) => json(r, { items: [], nextCursor: null }),
    );
  await page.route(
    (u) => u.pathname === "/api/v1/admin/rewards",
    async (r) => {
      const params = new URL(r.request().url()).searchParams,
        selected = params.get("scope") ?? scope,
        second = params.has("cursor");
      calls.push(Object.fromEntries(params));
      const status =
        fail ||
        (mode === "disabled" || mode === "denied"
          ? 404
          : mode === "unavailable"
            ? 503
            : 0);
      if (delay && selected === scope)
        await new Promise((resolve) => setTimeout(resolve, delay));
      if (status)
        return json(
          r,
          {
            code:
              mode === "disabled" ? "ADMIN_CATALOG_DISABLED" : "UNAVAILABLE",
            message: "Synthetic failure",
            requestId: actor,
          },
          status,
        );
      const empty = mode === "empty" || selected === other;
      return json(r, {
        mode: "synthetic",
        scope: scopes.find((s) => s.id === selected),
        scopes,
        updatedAt: "2026-10-04T10:00:00.000Z",
        items: empty
          ? []
          : [
              {
                rewardId: reward,
                current: {
                  ...terms,
                  title: second ? "Следующая позиция" : terms.title,
                },
                scheduled: second
                  ? null
                  : {
                      ...terms,
                      version: 3,
                      enabled: true,
                      reservationSeconds: 3600,
                      effectiveFrom: "2040-01-01T00:00:00.000Z",
                      title: "Будущий исследовательский статус",
                    },
                quota: second ? null : quota,
              },
            ],
        nextCursor: empty || second ? null : cursor,
      });
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/admin/rewards/${reward}/versions`,
    async (r) => {
      const params = new URL(r.request().url()).searchParams;
      historyCalls.push(Object.fromEntries(params));
      const status = historyFail || fail;
      if (historyDelay)
        await new Promise((resolve) => setTimeout(resolve, historyDelay));
      if (status)
        return json(
          r,
          {
            code: status === 400 ? "INVALID_CURSOR" : "UNAVAILABLE",
            message: "Synthetic failure",
            requestId: actor,
          },
          status,
        );
      const second = params.has("cursor");
      return json(r, {
        mode: "synthetic",
        scope: scopes.find((s) => s.id === params.get("scope")),
        rewardId: reward,
        items:
          historyMode === "empty"
            ? []
            : second
              ? [
                  {
                    ...terms,
                    version: 1,
                    title: "Первоначальные условия",
                    price: 7,
                    enabled: true,
                    state: "superseded",
                    effectiveFrom: "2020-01-01T00:00:00.000001Z",
                  },
                ]
              : [
                  {
                    ...terms,
                    version: 4,
                    title: "Поздняя будущая версия",
                    state: "scheduled",
                    effectiveFrom: "2041-01-01T00:00:00.000002Z",
                  },
                  {
                    ...terms,
                    version: 3,
                    title: "Ближайшая будущая версия",
                    state: "scheduled",
                    effectiveFrom: "2040-01-01T00:00:00.000001Z",
                  },
                  { ...terms, state: "current" },
                ],
        nextCursor:
          second || historyMode === "empty"
            ? null
            : `${actor}|${scope}|admin-catalog-history|${reward}|${reward}`,
        updatedAt: "2026-10-04T10:00:00.000Z",
      });
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/admin/rewards/${reward}/quotas`,
    async (r) => {
      const params = new URL(r.request().url()).searchParams;
      quotaCalls.push(Object.fromEntries(params));
      const status = quotaFail || fail;
      if (quotaDelay)
        await new Promise((resolve) => setTimeout(resolve, quotaDelay));
      if (status)
        return json(
          r,
          {
            code: status === 400 ? "INVALID_CURSOR" : "UNAVAILABLE",
            message: "Synthetic failure",
            requestId: actor,
          },
          status,
        );
      const second = params.has("cursor");
      return json(r, {
        mode: "synthetic",
        scope: scopes.find((s) => s.id === params.get("scope")),
        rewardId: reward,
        items:
          quotaMode === "empty"
            ? []
            : second
              ? [
                  {
                    ...quota,
                    version: 3,
                    state: "past",
                    startsAt: "2020-01-01T00:00:00.000Z",
                    endsAt: "2021-01-01T00:00:00.000Z",
                  },
                ]
              : [
                  {
                    ...quota,
                    version: 1,
                    state: "scheduled",
                    capacity: 0,
                    reserved: 0,
                    used: 0,
                    available: 0,
                    startsAt: "2040-01-01T00:00:00.000Z",
                    endsAt: "2041-01-01T00:00:00.000Z",
                  },
                  { ...quota, id: other, version: 2, state: "current" },
                ],
        nextCursor:
          second || quotaMode === "empty"
            ? null
            : `${actor}|${scope}|admin-catalog-quotas|${reward}|${reward}`,
        updatedAt: "2026-10-05T10:00:00.000Z",
      });
    },
  );
  await page.goto(origin);
  await page.getByRole("heading", { name: "Доступ подтверждён" }).waitFor();
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  if (mode !== "no-permission") {
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page
      .getByRole("button", { name: "Управление каталогом", exact: true })
      .click();
  }
  return {
    page,
    context,
    errors,
    calls,
    historyCalls,
    quotaCalls,
    setQuotaFail: (v) => {
      quotaFail = v;
    },
    setQuotaDelay: (v) => {
      quotaDelay = v;
    },
    setQuotaMode: (v) => {
      quotaMode = v;
    },
    setHistoryFail: (v) => {
      historyFail = v;
    },
    setHistoryDelay: (v) => {
      historyDelay = v;
    },
    setHistoryMode: (v) => {
      historyMode = v;
    },
    setFail: (v) => {
      fail = v;
    },
    setDelay: (v) => {
      delay = v;
    },
  };
}
const refresh = (f) =>
  f.page.getByRole("button", { name: "Обновить каталог управления" });
async function ready(f) {
  await f.page.locator(".admin-catalog-items > li").first().waitFor();
}
async function settle(f) {
  await f.page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Обновить каталог управления"]')
        .disabled,
  );
}
async function capture(f, name) {
  assert.equal(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (process.env.TEST_SKIP_SCREENSHOTS !== "true")
    await f.page.screenshot({
      path: path.join(dir, name),
      fullPage: true,
      animations: "disabled",
    });
}
async function close(f) {
  assert.deepEqual(f.errors, []);
  await f.context.close();
  scenarios++;
}
const historyPanel = (f) => f.page.locator(".admin-catalog-history");
const historyRefresh = (f) =>
  historyPanel(f).getByRole("button", {
    name: "Обновить историю",
    exact: true,
  });
async function openHistory(f) {
  await ready(f);
  await historyPanel(f).locator("summary").focus();
  await f.page.keyboard.press("Enter");
}
async function historyReady(f) {
  await historyPanel(f)
    .locator(".admin-catalog-versions > li")
    .first()
    .waitFor();
  await f.page.waitForFunction(
    () =>
      !document
        .querySelector(".admin-catalog-history [aria-busy]")
        ?.getAttribute("aria-busy")
        .includes("true"),
  );
}
const quotaPanel = (f) => f.page.locator(".admin-catalog-quotas");
const quotaRefresh = (f) =>
  quotaPanel(f).getByRole("button", { name: "Обновить периоды", exact: true });
async function openQuotas(f) {
  await ready(f);
  await quotaPanel(f).locator("summary").focus();
  await f.page.keyboard.press("Enter");
}
async function quotasReady(f) {
  await quotaPanel(f).locator(".admin-catalog-periods > li").first().waitFor();
  await f.page.waitForFunction(
    () =>
      document
        .querySelector(".admin-catalog-quotas [aria-busy]")
        ?.getAttribute("aria-busy") === "false",
  );
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("ready", width);
    await ready(f);
    assert.equal(f.quotaCalls.length, 0);
    await openQuotas(f);
    await quotasReady(f);
    assert.equal(
      await quotaPanel(f).locator(".admin-catalog-periods > li").count(),
      2,
    );
    assert.match(await quotaPanel(f).innerText(), /Будущий период/);
    assert.match(await quotaPanel(f).innerText(), /Текущий период/);
    assert.match(
      await quotaPanel(f).innerText(),
      /Конец периода сам по себе не возвращает резерв/,
    );
    assert.equal(
      await quotaPanel(f)
        .locator("summary")
        .evaluate((e) => e.getBoundingClientRect().height >= 44),
      true,
    );
    await capture(f, `quotas-${width}.png`);
    if (width === 320) {
      await f.page.addStyleTag({
        content:
          ".admin-catalog-section{font-size:24px}.notification-note,.notification-asof{font-size:20px}.admin-catalog-quota h4{font-size:24px}",
      });
      await capture(f, "quotas-large-text-320.png");
    }
    await quotaPanel(f)
      .getByRole("button", { name: "Следующие периоды" })
      .click();
    await quotaPanel(f)
      .getByRole("heading", { name: "Завершившийся период" })
      .waitFor();
    assert.equal(
      f.quotaCalls.at(-1).cursor,
      `${actor}|${scope}|admin-catalog-quotas|${reward}|${reward}`,
    );
    if (width === 320) await capture(f, "quotas-past-320.png");
    await quotaRefresh(f).focus();
    await f.page.keyboard.press("Enter");
    await quotasReady(f);
    assert.equal(f.quotaCalls.at(-1).cursor, undefined);
    await f.page.evaluate(() => window.__back?.());
    assert.equal(await quotaPanel(f).evaluate((e) => e.open), false);
    await close(f);
  }
  for (const status of [400, 503]) {
    const f = await fixture();
    f.setQuotaFail(status);
    await openQuotas(f);
    await quotaPanel(f).getByRole("alert").waitFor();
    assert.equal(
      await quotaPanel(f).locator(".admin-catalog-periods > li").count(),
      0,
    );
    f.setQuotaFail(0);
    await quotaRefresh(f).click();
    await quotasReady(f);
    f.setQuotaFail(status);
    await quotaRefresh(f).click();
    await quotaPanel(f).getByRole("alert").waitFor();
    assert.equal(
      await quotaPanel(f).locator(".admin-catalog-periods > li").count(),
      status === 503 ? 2 : 0,
    );
    if (status === 503) await capture(f, "quotas-retained-503-320.png");
    await close(f);
  }
  {
    const f = await fixture();
    f.setQuotaMode("empty");
    await openQuotas(f);
    await quotaPanel(f)
      .getByText("На этой странице нет сохранённых периодов квоты.")
      .waitFor();
    await capture(f, "quotas-empty-320.png");
    await close(f);
  }
  {
    const f = await fixture();
    f.setQuotaDelay(700);
    await openQuotas(f);
    await quotaPanel(f).getByRole("status").waitFor();
    await f.page.getByLabel("Область", { exact: true }).selectOption(other);
    await f.page
      .getByText("В этой области нет сохранённых позиций косметики.")
      .waitFor();
    await f.page.waitForTimeout(850);
    assert.equal(await quotaPanel(f).count(), 0);
    await close(f);
  }
  for (const source of ["quotas", "parent", "history"]) {
    const f = await fixture();
    await openQuotas(f);
    await quotasReady(f);
    if (source === "quotas") {
      f.setQuotaFail(404);
      await quotaRefresh(f).click();
      await quotaPanel(f).getByRole("alert").waitFor();
    } else if (source === "parent") {
      f.setFail(404);
      await refresh(f).click();
      await f.page
        .getByText("Каталог управления в этой области недоступен.")
        .waitFor();
      f.setFail(0);
      await refresh(f).click();
      await ready(f);
    } else {
      await openHistory(f);
      await historyReady(f);
      f.setHistoryFail(404);
      await historyRefresh(f).click();
      await historyPanel(f).getByRole("alert").waitFor();
    }
    f.setQuotaFail(503);
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Ещё", exact: true }).click();
    await f.page
      .getByRole("button", { name: "Управление каталогом", exact: true })
      .click();
    await openQuotas(f);
    await quotaPanel(f).getByRole("alert").waitFor();
    assert.equal(
      await quotaPanel(f).locator(".admin-catalog-periods > li").count(),
      0,
    );
    await close(f);
  }
  for (const status of [401, 403]) {
    const f = await fixture();
    await openQuotas(f);
    await quotasReady(f);
    f.setQuotaFail(status);
    await quotaRefresh(f).click();
    await f.page
      .getByRole("heading", {
        name:
          status === 401 ? "Не удалось подтвердить сессию" : "Доступ отозван",
      })
      .waitFor();
    assert.equal(await quotaPanel(f).count(), 0);
    await close(f);
  }
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("ready", width);
    await ready(f);
    await settle(f);
    assert.match(
      await f.page.locator(".admin-catalog-items").innerText(),
      /Выключена/,
    );
    const disclosure = f.page.getByText("Будущая версия 3", { exact: true });
    await disclosure.focus();
    await f.page.keyboard.press("Enter");
    await f.page
      .getByRole("heading", { name: "Будущий исследовательский статус" })
      .waitFor();
    assert.equal(
      await disclosure.evaluate((e) => e.getBoundingClientRect().height >= 44),
      true,
    );
    await capture(f, `catalog-${width}.png`);
    if (width === 320) {
      await f.page.addStyleTag({
        content:
          ".admin-catalog-section{font-size:24px}.notification-note,.notification-intro,.notification-asof{font-size:20px}",
      });
      await capture(f, "catalog-large-text-320.png");
    }
    await close(f);
  }
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("ready", width);
    await ready(f);
    assert.equal(f.historyCalls.length, 0);
    await openHistory(f);
    await historyReady(f);
    assert.equal(
      await historyPanel(f).locator(".admin-catalog-versions > li").count(),
      3,
    );
    assert.match(await historyPanel(f).innerText(), /Будущие условия/);
    assert.match(await historyPanel(f).innerText(), /Действующие условия/);
    assert.equal(
      await historyPanel(f)
        .locator("summary")
        .evaluate((e) => e.getBoundingClientRect().height >= 44),
      true,
    );
    await f.page.evaluate(() => scrollTo(0, 0));
    await capture(f, `history-${width}.png`);
    if (width === 320) {
      await f.page.addStyleTag({
        content:
          ".admin-catalog-section{font-size:24px}.notification-note,.notification-asof{font-size:20px}.admin-catalog-terms h4{font-size:24px}",
      });
      await capture(f, "history-large-text-320.png");
    }
    await historyPanel(f)
      .getByRole("button", { name: "Следующие версии" })
      .click();
    await historyPanel(f)
      .getByRole("heading", { name: "Первоначальные условия" })
      .waitFor();
    assert.match(await historyPanel(f).innerText(), /Заменённые условия/);
    assert.equal(
      f.historyCalls.at(-1).cursor,
      `${actor}|${scope}|admin-catalog-history|${reward}|${reward}`,
    );
    await historyRefresh(f).focus();
    await f.page.keyboard.press("Enter");
    await historyReady(f);
    assert.equal(f.historyCalls.at(-1).cursor, undefined);
    if (width === 320) {
      await f.page.evaluate(() => window.__back?.());
      assert.equal(await historyPanel(f).evaluate((e) => e.open), false);
      await f.page
        .getByRole("heading", { name: "Управление каталогом", exact: true })
        .waitFor();
    }
    await close(f);
  }
  {
    const f = await fixture();
    await openHistory(f);
    await historyReady(f);
    f.setHistoryFail(503);
    await historyRefresh(f).click();
    await historyPanel(f).getByRole("alert").waitFor();
    assert.equal(
      await historyPanel(f).locator(".admin-catalog-versions > li").count(),
      3,
    );
    assert.match(
      await historyPanel(f).innerText(),
      /Показаны ранее подтверждённые версии/,
    );
    await capture(f, "history-retained-503-320.png");
    f.setHistoryFail(404);
    await historyRefresh(f).click();
    await historyPanel(f)
      .getByText("История позиции в этой области недоступна.")
      .waitFor();
    assert.equal(
      await historyPanel(f).locator(".admin-catalog-versions > li").count(),
      0,
    );
    f.setHistoryFail(503);
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Ещё", exact: true }).click();
    await f.page
      .getByRole("button", { name: "Управление каталогом", exact: true })
      .click();
    await openHistory(f);
    await historyPanel(f).getByRole("alert").waitFor();
    assert.equal(
      await historyPanel(f).locator(".admin-catalog-versions > li").count(),
      0,
    );
    await close(f);
  }
  {
    const f = await fixture();
    await openHistory(f);
    await historyReady(f);
    f.setFail(404);
    await refresh(f).click();
    await f.page
      .getByText("Каталог управления в этой области недоступен.")
      .waitFor();
    f.setFail(0);
    f.setHistoryFail(503);
    await refresh(f).click();
    await openHistory(f);
    await historyPanel(f).getByRole("alert").waitFor();
    assert.equal(
      await historyPanel(f).locator(".admin-catalog-versions > li").count(),
      0,
    );
    await close(f);
  }
  for (const status of [400, 503]) {
    const f = await fixture();
    f.setHistoryFail(status);
    await openHistory(f);
    await historyPanel(f).getByRole("alert").waitFor();
    assert.equal(
      await historyPanel(f).locator(".admin-catalog-versions > li").count(),
      0,
    );
    f.setHistoryFail(0);
    await historyRefresh(f).click();
    await historyReady(f);
    await close(f);
  }
  {
    const f = await fixture();
    f.setHistoryDelay(700);
    await openHistory(f);
    await historyPanel(f).getByRole("status").waitFor();
    await f.page.getByLabel("Область", { exact: true }).selectOption(other);
    await f.page
      .getByText("В этой области нет сохранённых позиций косметики.")
      .waitFor();
    await f.page.waitForTimeout(850);
    assert.equal(await f.page.locator(".admin-catalog-history").count(), 0);
    await close(f);
  }
  {
    const f = await fixture();
    f.setHistoryMode("empty");
    await openHistory(f);
    await historyPanel(f)
      .getByText("На этой странице больше нет сохранённых версий.")
      .waitFor();
    await capture(f, "history-empty-320.png");
    await close(f);
  }
  for (const status of [401, 403]) {
    const f = await fixture();
    await openHistory(f);
    await historyReady(f);
    f.setHistoryFail(status);
    await historyRefresh(f).click();
    await f.page
      .getByRole("heading", {
        name:
          status === 401 ? "Не удалось подтвердить сессию" : "Доступ отозван",
      })
      .waitFor();
    assert.equal(await f.page.locator(".admin-catalog-history").count(), 0);
    await close(f);
  }
  for (const mode of ["empty", "disabled", "denied", "unavailable"]) {
    const f = await fixture(mode);
    await f.page
      .getByText(
        mode === "empty"
          ? "В этой области нет сохранённых позиций косметики."
          : mode === "disabled"
            ? "Просмотр управления каталогом выключен."
            : mode === "denied"
              ? "Каталог управления в этой области недоступен."
              : "Не удалось загрузить конфигурацию. Нажмите «Обновить».",
      )
      .waitFor();
    await capture(f, `catalog-${mode}-320.png`);
    await close(f);
  }
  {
    const f = await fixture("no-permission");
    await f.page.getByRole("button", { name: "Ещё", exact: true }).click();
    assert.equal(
      await (await openSection(f.page, "Управление каталогом")).count(),
      0,
    );
    await close(f);
  }
  {
    const f = await fixture("all-permissions");
    await ready(f);
    await capture(f, "catalog-all-permissions-320.png");
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await settle(f);
    await f.page.getByRole("button", { name: "Следующая страница" }).click();
    await f.page.getByRole("heading", { name: "Следующая позиция" }).waitFor();
    assert.equal(f.calls.at(-1).cursor, cursor);
    await refresh(f).focus();
    await f.page.keyboard.press("Enter");
    await f.page.getByRole("heading", { name: terms.title }).waitFor();
    assert.equal(f.calls.at(-1).cursor, undefined);
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await settle(f);
    f.setFail(503);
    await refresh(f).click();
    await f.page.locator(".admin-catalog-section").getByRole("alert").waitFor();
    assert.equal(await f.page.locator(".admin-catalog-items > li").count(), 1);
    await capture(f, "catalog-retained-503-320.png");
    f.setFail(404);
    await refresh(f).click();
    await f.page
      .getByText("Каталог управления в этой области недоступен.")
      .waitFor();
    assert.equal(await f.page.locator(".admin-catalog-items > li").count(), 0);
    f.setFail(503);
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Ещё", exact: true }).click();
    await f.page
      .getByRole("button", { name: "Управление каталогом", exact: true })
      .click();
    await f.page.locator(".admin-catalog-section").getByRole("alert").waitFor();
    assert.equal(await f.page.locator(".admin-catalog-items > li").count(), 0);
    await close(f);
  }
  for (const status of [401, 403]) {
    const f = await fixture();
    await ready(f);
    await settle(f);
    f.setFail(status);
    await refresh(f).click();
    await f.page
      .getByRole("heading", {
        name:
          status === 401 ? "Не удалось подтвердить сессию" : "Доступ отозван",
      })
      .waitFor();
    assert.equal(await f.page.locator(".admin-catalog-items > li").count(), 0);
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await settle(f);
    f.setDelay(700);
    await refresh(f).click();
    await f.page.getByLabel("Область", { exact: true }).selectOption(other);
    await f.page
      .getByText("В этой области нет сохранённых позиций косметики.")
      .waitFor();
    await f.page.waitForTimeout(850);
    assert.equal(await f.page.locator(".admin-catalog-items > li").count(), 0);
    await f.page.evaluate(() => window.__back?.());
    await f.page.getByRole("heading", { name: "Ещё", exact: true }).waitFor();
    await f.page.evaluate(() => window.__back?.());
    await f.page.getByRole("heading", { name: "Главная" }).waitFor();
    await close(f);
  }
  console.log(
    JSON.stringify({
      mode: "synthetic-browser",
      adminCatalogScenarios: scenarios,
      screenshots: dir,
    }),
  );
} finally {
  await browser.close();
}
