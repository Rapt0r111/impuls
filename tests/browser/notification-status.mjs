import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
import { openSection } from "./nav.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const dir = path.join(
  process.env.TEST_SCREENSHOT_DIR ?? "test-results",
  "notification-status",
);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const actor = "a1111111-1111-4111-8111-111111111111",
  scope = "b1111111-1111-4111-8111-111111111111",
  other = "c1111111-1111-4111-8111-111111111111";
const scopes = [
  {
    id: scope,
    name: "Учебная_область_с_длинным_названием_для_проверки_экрана",
  },
  { id: other, name: "Вторая учебная область" },
];
const counts = {
  unclaimed: 3,
  ready: 1,
  processing: 2,
  retry: 4,
  simulated: 12345,
  delivered: 7,
  failed: 6,
  suppressed: 2,
};
const errors = {
  transport_unavailable: 3,
  timeout: 2,
  attempts_exhausted: 1,
  recipient_inactive: 1,
  unsupported_kind: 1,
  rate_limited: 2,
  recipient_unreachable: 1,
};
let scenarios = 0;
async function fixture(mode = "ready", width = 320) {
  const eventCalls = [],
    attemptCalls = [];
  let attemptFail = 0,
    attemptDelay = 0,
    attemptMalformed = false;
  let eventFail = 0,
    eventDelay = 0;
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    pageErrors = [],
    calls = [];
  page.setDefaultTimeout(8000);
  let fail = 0,
    networkFailure = false,
    malformed = false,
    malformedError = false,
    delay = 0,
    value = counts.simulated;
  page.on("pageerror", (error) => pageErrors.push(error.message));
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
      body: "window.__back=null;window.Telegram={WebApp:{version:'8.0',isVersionAtLeast(){return true},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(cb){window.__back=cb},offClick(){window.__back=null}}}};",
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me",
    (r) =>
      json(r, {
        user: { id: actor, displayName: "Учебный администратор" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (r) =>
      json(r, {
        permissions: (mode === "no-permission"
          ? ["admin.audit"]
          : mode === "all-permissions"
            ? [
                "admin.notifications",
                "admin.audit",
                "task.review",
                "task.create",
              ]
            : ["admin.notifications"]
        ).map((action) => ({
          action,
          scope: { ...scopes[0], kind: "group" },
          validUntil: null,
        })),
      }),
  );
  for (const endpoint of ["tasks", "reviews"])
    await page.route(
      (url) => url.pathname === `/api/v1/${endpoint}`,
      (r) => json(r, { items: [], nextCursor: null }),
    );
  await page.route(
    (url) => url.pathname === "/api/v1/admin/notifications",
    async (r) => {
      if (networkFailure) return r.abort("internetdisconnected");
      const params = new URL(r.request().url()).searchParams,
        selected = params.get("scope") ?? scope;
      calls.push(Object.fromEntries(params));
      const currentFail =
        fail ||
        (mode === "disabled" || mode === "denied"
          ? 404
          : mode === "unavailable"
            ? 503
            : 0);
      if (delay && selected === scope)
        await new Promise((resolve) => setTimeout(resolve, delay));
      if (currentFail && malformedError)
        return r.fulfill({
          status: currentFail,
          contentType: "text/html",
          body: "<p>Proxy error</p>",
        });
      if (currentFail)
        return json(
          r,
          {
            code:
              mode === "disabled"
                ? "NOTIFICATION_STATUS_DISABLED"
                : currentFail === 403
                  ? "ACCESS_REVOKED"
                  : "UNAVAILABLE",
            message: "Synthetic",
            requestId: actor,
          },
          currentFail,
        );
      const empty = mode === "empty" || selected === other;
      return json(
        r,
        malformed
          ? { wrong: "private" }
          : {
              mode: "simulation",
              scope: scopes.find((s) => s.id === selected),
              scopes,
              updatedAt: "2026-10-04T09:10:00.000Z",
              recentEvents: empty
                ? []
                : [
                    {
                      kind: "reward.approved",
                      createdAt: "2026-10-04T09:09:00.000Z",
                      status: "retry",
                      errorCode: "timeout",
                    },
                    {
                      kind: "unsupported",
                      createdAt: "2026-10-04T09:08:00.000Z",
                      status: "suppressed",
                      errorCode: "unsupported_kind",
                    },
                  ],
              counts: empty
                ? Object.fromEntries(Object.keys(counts).map((key) => [key, 0]))
                : { ...counts, simulated: value },
              errors: empty
                ? Object.fromEntries(Object.keys(errors).map((key) => [key, 0]))
                : errors,
            },
      );
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/admin/notifications/events",
    async (r) => {
      if (networkFailure) return r.abort("internetdisconnected");
      const params = new URL(r.request().url()).searchParams;
      eventCalls.push(Object.fromEntries(params));
      const selected = params.get("scope"),
        next = params.has("cursor"),
        failure = eventFail;
      if (eventDelay && selected === scope)
        await new Promise((resolve) => setTimeout(resolve, eventDelay));
      if (failure)
        return json(
          r,
          { code: "UNAVAILABLE", message: "Synthetic", requestId: actor },
          failure,
        );
      return json(r, {
        mode: "simulation",
        scope: scopes.find((s) => s.id === selected),
        updatedAt: "2026-10-05T09:10:00.000Z",
        items:
          mode === "empty" || selected === other
            ? []
            : [
                {
                  kind: next ? "task.assigned" : "reward.approved",
                  createdAt: next
                    ? "2026-10-03T09:09:00.000Z"
                    : "2026-10-04T09:09:00.000Z",
                  status: next ? "simulated" : "retry",
                  errorCode: next ? null : "timeout",
                },
              ],
        nextCursor:
          !next && selected === scope && mode !== "empty"
            ? `${actor}|${scope}|notification-events|d1111111-1111-4111-8111-111111111111`
            : null,
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/admin/notifications/attempts",
    async (r) => {
      if (networkFailure) return r.abort("internetdisconnected");
      const params = new URL(r.request().url()).searchParams;
      attemptCalls.push(Object.fromEntries(params));
      const selected = params.get("scope"),
        next = params.has("cursor"),
        failure = attemptFail;
      if (attemptDelay && selected === scope)
        await new Promise((resolve) => setTimeout(resolve, attemptDelay));
      if (failure)
        return json(
          r,
          { code: "UNAVAILABLE", message: "Synthetic", requestId: actor },
          failure,
        );
      if (attemptMalformed) return json(r, { private: "not a journal" });
      const phases = next
        ? [["started", null]]
        : [
            ["simulated", null],
            ["lease_expired", null],
            ["retry", "timeout"],
          ];
      return json(r, {
        mode: "simulation",
        scope: scopes.find((s) => s.id === selected),
        updatedAt: "2026-10-05T10:20:00.000Z",
        items:
          mode === "empty" || selected === other
            ? []
            : phases.map(([phase, errorCode], index) => ({
                id: `d1111111-1111-4111-8111-11111111111${index}`,
                eventId: "e1111111-1111-4111-8111-111111111111",
                kind: next ? "task.assigned" : "reward.approved",
                attempt: next ? 1 : 3 - index,
                phase,
                errorCode,
                recordedAt: next
                  ? "2026-10-04T09:09:00.000Z"
                  : "2026-10-05T10:19:00.000Z",
              })),
        nextCursor:
          !next && selected === scope && mode !== "empty"
            ? `${actor}|${scope}|notification-attempts|d1111111-1111-4111-8111-111111111112`
            : null,
      });
    },
  );
  await page.goto(origin);
  await page.getByRole("heading", { name: "Доступ подтверждён" }).waitFor();
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  if (mode !== "no-permission")
    await (await openSection(page, "Состояние уведомлений")).click();
  return {
    page,
    context,
    pageErrors,
    calls,
    eventCalls,
    attemptCalls,
    setAttemptFail: (v) => {
      attemptFail = v;
    },
    setAttemptDelay: (v) => {
      attemptDelay = v;
    },
    setAttemptMalformed: () => {
      attemptMalformed = true;
    },
    setEventFail: (v) => {
      eventFail = v;
    },
    setEventDelay: (v) => {
      eventDelay = v;
    },
    setFail: (v) => {
      fail = v;
    },
    setNetworkFailure: () => {
      networkFailure = true;
    },
    setMalformed: () => {
      malformed = true;
    },
    setMalformedError: () => {
      malformedError = true;
    },
    setDelay: (v) => {
      delay = v;
    },
    setValue: (v) => {
      value = v;
    },
  };
}
const refresh = (f) =>
  f.page.getByRole("button", { name: "Обновить состояние уведомлений" });
async function ready(f) {
  await f.page
    .locator(".notification-section > .notification-counts")
    .first()
    .waitFor();
}
async function settle(f) {
  await refresh(f)
    .isEnabled()
    .then(async () => {
      await f.page.waitForFunction(
        () =>
          !document.querySelector(
            '[aria-label="Обновить состояние уведомлений"]',
          ).disabled,
      );
    });
}
async function capture(f, name) {
  assert.equal(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (process.env.TEST_SKIP_SCREENSHOTS === "true") return;
  await f.page.evaluate(() => window.scrollTo(0, 0));
  await f.page.mouse.move(0, 0);
  await f.page.screenshot({
    path: path.join(dir, name),
    fullPage: true,
    animations: "disabled",
  });
}
async function close(f) {
  assert.deepEqual(f.pageErrors, []);
  await f.context.close();
  scenarios++;
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("ready", width);
    await ready(f);
    assert.equal(f.eventCalls.length, 0);
    const disclosure = f.page.locator(".notification-history summary");
    await disclosure.focus();
    await f.page.keyboard.press("Enter");
    const list = f.page.locator(".notification-history .notification-events");
    await list.waitFor();
    assert.equal(f.eventCalls.length, 1);
    assert.equal(f.eventCalls[0].scope, scope);
    assert.ok(
      await disclosure.evaluate(
        (el) => el.getBoundingClientRect().height >= 44,
      ),
    );
    await capture(f, `events-${width}.png`);
    if (width === 320) {
      await f.page.addStyleTag({
        content:
          ".notification-section { font-size: 24px; } .notification-note,.notification-asof,.notification-history .notification-note { font-size: 20px; }",
      });
      assert.ok(
        await f.page
          .locator(".notification-history .notification-note")
          .first()
          .evaluate(
            (el) => Number.parseFloat(getComputedStyle(el).fontSize) >= 20,
          ),
      );
      await capture(f, "events-large-text-320.png");
    }
    await f.page
      .getByRole("button", { name: "Следующие события", exact: true })
      .click();
    await list.getByText("Назначение задачи", { exact: true }).waitFor();
    assert.ok(f.eventCalls[1].cursor);
    assert.match(await list.innerText(), /Симуляция успешна/);
    await f.page
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    await list.getByText("Согласование заявки", { exact: true }).waitFor();
    assert.equal(f.eventCalls.at(-1).cursor, undefined);
    await f.page.evaluate(() => window.__back?.());
    assert.equal(
      await f.page.locator(".notification-history").evaluate((el) => el.open),
      false,
    );
    await f.page
      .getByRole("heading", { name: "Симуляция уведомлений" })
      .waitFor();
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    f.setEventDelay(700);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page.getByText("Загружаем события…", { exact: true }).waitFor();
    const list = f.page.locator(".notification-history .notification-events");
    await list.waitFor();
    f.setEventDelay(0);
    const old = await list.innerText();
    f.setEventFail(503);
    await f.page
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    await f.page.locator(".notification-history [role=alert]").waitFor();
    assert.equal(await list.innerText(), old);
    await capture(f, "events-retained-503-320.png");
    f.setEventFail(400);
    await f.page
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    await f.page.getByText(/Страница событий изменилась/).waitFor();
    assert.equal(await list.count(), 0);
    f.setEventFail(0);
    await f.page
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    await list.waitFor();
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Все события", { exact: true }).click();
    const list = f.page.locator(".notification-history .notification-events");
    await list.waitFor();
    const text = await list.innerText();
    await f.context.setOffline(true);
    f.setNetworkFailure();
    await f.page
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    await f.page.locator(".notification-history [role=alert]").waitFor();
    assert.equal(await list.innerText(), text);
    await f.context.setOffline(false);
    await close(f);
  }
  for (const source of ["parent", "history"]) {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page
      .locator(".notification-history .notification-events")
      .waitFor();
    if (source === "parent") {
      f.setEventDelay(700);
      await f.page
        .getByRole("button", { name: "Обновить события", exact: true })
        .click();
      f.setFail(404);
      await refresh(f).click();
    } else {
      f.setDelay(700);
      f.setValue(999);
      await refresh(f).click();
      f.setEventFail(404);
      await f.page
        .getByRole("button", { name: "Обновить события", exact: true })
        .click();
    }
    await f.page
      .getByText("Состояние уведомлений в этой области недоступно.")
      .waitFor();
    await f.page.waitForTimeout(850);
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .count(),
      0,
    );
    f.setFail(503);
    f.setEventFail(503);
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await (await openSection(f.page, "Состояние уведомлений")).click();
    await f.page.locator(".notification-section [role=alert]").waitFor();
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    await close(f);
  }
  for (const denial of [401, 403, 404]) {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page
      .locator(".notification-history .notification-events")
      .waitFor();
    f.setEventFail(denial);
    await f.page
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    if (denial === 404)
      await f.page
        .getByText("Состояние уведомлений в этой области недоступно.")
        .waitFor();
    else
      await f.page
        .getByRole("heading", {
          name:
            denial === 401 ? "Не удалось подтвердить сессию" : "Доступ отозван",
        })
        .waitFor();
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .count(),
      0,
    );
    if (denial === 404) {
      f.setFail(503);
      f.setEventFail(503);
      await f.page
        .getByRole("button", { name: "Мои задачи", exact: true })
        .click();
      await (await openSection(f.page, "Состояние уведомлений")).click();
      await f.page.locator(".notification-section [role=alert]").waitFor();
      assert.equal(await f.page.locator(".notification-events").count(), 0);
    }
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page
      .locator(".notification-history .notification-events")
      .waitFor();
    f.setEventDelay(700);
    await f.page
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    await f.page.getByLabel("Область", { exact: true }).selectOption(other);
    await f.page.getByText(/В этой области нет сохранённых событий/).waitFor();
    await f.page.waitForTimeout(850);
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page
      .getByText("На этой странице нет сохранённых событий для симуляции.")
      .waitFor();
    await capture(f, "events-empty-320.png");
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page
      .locator(".notification-history .notification-events")
      .waitFor();
    f.setFail(404);
    await refresh(f).click();
    await f.page
      .getByText("Состояние уведомлений в этой области недоступно.")
      .waitFor();
    f.setFail(0);
    f.setEventFail(503);
    await refresh(f).click();
    await ready(f);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page.locator(".notification-history [role=alert]").waitFor();
    assert.equal(
      await f.page
        .locator(".notification-history .notification-events")
        .count(),
      0,
    );
    await close(f);
  }
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("ready", width);
    await ready(f);
    assert.match(
      await f.page.locator(".notification-section").innerText(),
      /Сообщения в Telegram не отправляются/,
    );
    assert.equal(
      await refresh(f).evaluate(
        (el) => el.getBoundingClientRect().height >= 44,
      ),
      true,
    );
    await settle(f);
    await refresh(f).focus();
    await f.page.keyboard.press("Enter");
    await settle(f);
    assert.equal(f.calls.length, 2);
    const disclosure = f.page.getByText(
      "Причины последних неуспешных попыток",
      { exact: true },
    );
    await disclosure.focus();
    await f.page.keyboard.press("Enter");
    await f.page
      .getByText("Тестовый транспорт недоступен", { exact: true })
      .waitFor();
    assert.equal(
      await disclosure.evaluate(
        (el) => el.getBoundingClientRect().height >= 44,
      ),
      true,
    );
    const eventsDisclosure = f.page.getByText("Последние события (2)", {
      exact: true,
    });
    await eventsDisclosure.focus();
    await f.page.keyboard.press("Enter");
    await f.page.locator(".notification-events").waitFor();
    assert.equal(await f.page.locator(".notification-events li").count(), 2);
    assert.match(
      await f.page.locator(".notification-events li").first().innerText(),
      /Согласование заявки[\s\S]*Ожидают повтора[\s\S]*Истекло время тестовой попытки/,
    );
    assert.match(
      await f.page.locator(".notification-events li").last().innerText(),
      /Неподдерживаемый тип события[\s\S]*Обработка запрещена/,
    );
    await capture(f, `status-${width}.png`);
    if (width === 320) {
      await f.page.addStyleTag({
        content:
          ".notification-section { font-size: 24px; } .notification-intro,.notification-asof,.notification-note { font-size: 20px; }",
      });
      await capture(f, "status-large-text-320.png");
    }
    await close(f);
  }
  for (const mode of ["empty", "disabled", "denied", "unavailable"]) {
    const f = await fixture(mode);
    await f.page
      .getByText(
        mode === "empty"
          ? /В этой области нет сохранённых событий/
          : mode === "disabled"
            ? "Просмотр симуляции выключен."
            : mode === "denied"
              ? "Состояние уведомлений в этой области недоступно."
              : /Не удалось загрузить состояние/,
      )
      .waitFor();
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .count(),
      0,
    );
    await capture(f, `status-${mode}-320.png`);
    await close(f);
  }
  {
    const f = await fixture("all-permissions");
    await ready(f);
    await f.page
      .locator(".workspace-nav-personal")
      .getByRole("button", { name: "Ещё", exact: true })
      .click();
    const buttons = f.page.locator(".more-row");
    assert.equal(await buttons.count(), 5);
    const sizes = await buttons.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, top: r.top };
      }),
    );
    // Пять разделов — строки списка «Ещё» одной ширины.
    assert.equal(new Set(sizes.map((s) => Math.round(s.width))).size, 1);
    for (const s of sizes) assert.ok(s.height >= 44);
    await capture(f, "status-all-permissions-320.png");
    await close(f);
  }
  {
    const f = await fixture("no-permission");
    assert.equal(
      await (await openSection(f.page, "Состояние уведомлений")).count(),
      0,
    );
    assert.equal(f.calls.length, 0);
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    const oldText = await f.page
      .locator(".notification-section > .notification-counts")
      .innerText();
    f.setFail(503);
    await refresh(f).click();
    await f.page.locator(".notification-section").getByRole("alert").waitFor();
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .innerText(),
      oldText,
    );
    await capture(f, "status-retained-503-320.png");
    f.setFail(0);
    f.setMalformed();
    await refresh(f).click();
    await settle(f);
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .innerText(),
      oldText,
    );
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await f.context.setOffline(true);
    f.setNetworkFailure();
    await refresh(f).click();
    await f.page.locator(".notification-section").getByRole("alert").waitFor();
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .count(),
      1,
    );
    await f.context.setOffline(false);
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    f.setFail(404);
    await refresh(f).click();
    await f.page
      .getByText("Состояние уведомлений в этой области недоступно.")
      .waitFor();
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .count(),
      0,
    );
    f.setFail(503);
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await (await openSection(f.page, "Состояние уведомлений")).click();
    await f.page.locator(".notification-section").getByRole("alert").waitFor();
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .count(),
      0,
    );
    f.setFail(0);
    await refresh(f).click();
    await ready(f);
    await close(f);
  }
  for (const [status, badBody] of [
    [401, false],
    [403, false],
    [401, true],
    [403, true],
    [404, true],
  ]) {
    const f = await fixture();
    await ready(f);
    f.setFail(status);
    if (badBody) f.setMalformedError();
    await refresh(f).click();
    if (status === 404)
      await f.page
        .getByText("Состояние уведомлений в этой области недоступно.")
        .waitFor();
    else
      await f.page
        .getByRole("heading", {
          name:
            status === 401 ? "Не удалось подтвердить сессию" : "Доступ отозван",
        })
        .waitFor();
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .count(),
      0,
    );
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    f.setDelay(700);
    f.setValue(999);
    await refresh(f).click();
    await f.page.getByLabel("Область", { exact: true }).selectOption(other);
    await f.page.getByText(/В этой области нет сохранённых событий/).waitFor();
    await f.page.waitForTimeout(850);
    assert.equal(
      await f.page
        .locator(".notification-section > .notification-counts")
        .count(),
      0,
    );
    assert.equal(
      await f.page.getByLabel("Область", { exact: true }).inputValue(),
      other,
    );
    await f.page.evaluate(() => window.__back?.());
    await f.page.getByRole("heading", { name: "Ещё" }).waitFor();
    await f.page.evaluate(() => window.__back?.());
    await f.page.getByRole("heading", { name: "Главная" }).waitFor();
    await close(f);
  }
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("ready", width);
    await ready(f);
    assert.equal(f.attemptCalls.length, 0);
    const summary = f.page.locator(".notification-attempt-history > summary");
    await summary.focus();
    await f.page.keyboard.press("Enter");
    const list = f.page.locator(
      ".notification-attempt-history .notification-events",
    );
    await list.waitFor();
    assert.equal(f.attemptCalls.length, 1);
    assert.equal(f.attemptCalls[0].scope, scope);
    assert.ok(
      await summary.evaluate((el) => el.getBoundingClientRect().height >= 44),
    );
    assert.match(await list.innerText(), /Попытка 3 · Симуляция успешна/);
    await capture(f, `attempts-${width}.png`);
    if (width === 320) {
      await f.page.addStyleTag({
        content:
          ".notification-section {font-size:24px} .notification-attempt-history .notification-note,.notification-asof {font-size:20px}",
      });
      assert.ok(
        await f.page
          .locator(".notification-attempt-history .notification-note")
          .first()
          .evaluate(
            (el) => Number.parseFloat(getComputedStyle(el).fontSize) >= 20,
          ),
      );
      await capture(f, "attempts-large-text-320.png");
    }
    await list.locator(".notification-identity > summary").first().click();
    await list.locator("code").first().waitFor();
    assert.match(await list.locator("code").first().innerText(), /^e111/);
    await f.page
      .getByRole("button", { name: "Следующие записи", exact: true })
      .click();
    await list.getByText("Назначение задачи", { exact: true }).waitFor();
    assert.ok(f.attemptCalls.at(-1).cursor);
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .click();
    await list
      .getByText("Согласование заявки", { exact: true })
      .first()
      .waitFor();
    assert.equal(f.attemptCalls.at(-1).cursor, undefined);
    await f.page.evaluate(() => window.__back?.());
    assert.equal(
      await f.page
        .locator(".notification-attempt-history")
        .evaluate((el) => el.open),
      false,
    );
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    f.setAttemptDelay(600);
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    await f.page.getByText("Загружаем журнал попыток…").waitFor();
    await f.page.locator(".notification-attempt-history li").first().waitFor();
    await close(f);
  }
  {
    const f = await fixture("empty");
    await f.page.getByText(/В этой области нет сохранённых событий/).waitFor();
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    await f.page.getByText(/Новых записей попыток пока нет/).waitFor();
    await capture(f, "attempts-empty-320.png");
    await close(f);
  }
  for (const status of [503, 400]) {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    const list = f.page.locator(
      ".notification-attempt-history .notification-events",
    );
    await list.waitFor();
    const previous = await list.innerText();
    f.setAttemptFail(status);
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .click();
    await f.page
      .locator(".notification-attempt-history")
      .getByRole("alert")
      .waitFor();
    if (status === 503) {
      assert.equal(await list.innerText(), previous);
      await capture(f, "attempts-retained-503-320.png");
    } else assert.equal(await list.count(), 0);
    f.setAttemptFail(0);
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .click();
    await list.waitFor();
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    const list = f.page.locator(
      ".notification-attempt-history .notification-events",
    );
    await list.waitFor();
    const previous = await list.innerText();
    await f.context.setOffline(true);
    f.setNetworkFailure();
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .click();
    await f.page
      .locator(".notification-attempt-history")
      .getByRole("alert")
      .waitFor();
    assert.equal(await list.innerText(), previous);
    await f.context.setOffline(false);
    await close(f);
  }
  for (const status of [401, 403, 404]) {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page.locator(".notification-history li").first().waitFor();
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    await f.page.locator(".notification-attempt-history li").first().waitFor();
    f.setAttemptFail(status);
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .click();
    if (status === 404) {
      await f.page
        .getByText("Состояние уведомлений в этой области недоступно.")
        .waitFor();
      f.setFail(503);
      await f.page
        .getByRole("button", { name: "Мои задачи", exact: true })
        .click();
      await (await openSection(f.page, "Состояние уведомлений")).click();
      await f.page
        .locator(".notification-section")
        .getByRole("alert")
        .waitFor();
    } else
      await f.page
        .getByRole("heading", {
          name:
            status === 401 ? "Не удалось подтвердить сессию" : "Доступ отозван",
        })
        .waitFor();
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Все события", { exact: true }).click();
    await f.page.locator(".notification-history li").first().waitFor();
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    await f.page.locator(".notification-attempt-history li").first().waitFor();
    f.setEventDelay(700);
    await f.page
      .getByRole("button", { name: "Обновить события", exact: true })
      .click();
    f.setAttemptFail(404);
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .click();
    await f.page
      .getByText("Состояние уведомлений в этой области недоступно.")
      .waitFor();
    await f.page.waitForTimeout(850);
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    f.setFail(503);
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await (await openSection(f.page, "Состояние уведомлений")).click();
    await f.page.locator(".notification-section").getByRole("alert").waitFor();
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    await close(f);
  }
  for (const denialSource of ["summary", "events"]) {
    const f = await fixture();
    await ready(f);
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    await f.page.locator(".notification-attempt-history li").first().waitFor();
    f.setAttemptDelay(700);
    await f.page
      .getByRole("button", { name: "Обновить журнал", exact: true })
      .click();
    if (denialSource === "summary") {
      f.setFail(404);
      await refresh(f).click();
    } else {
      f.setEventFail(404);
      await f.page.getByText("Все события", { exact: true }).click();
    }
    await f.page
      .getByText("Состояние уведомлений в этой области недоступно.")
      .waitFor();
    await f.page.waitForTimeout(850);
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    f.setFail(503);
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await (await openSection(f.page, "Состояние уведомлений")).click();
    await f.page.locator(".notification-section").getByRole("alert").waitFor();
    assert.equal(await f.page.locator(".notification-events").count(), 0);
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    f.setAttemptDelay(700);
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    await f.page.getByText("Загружаем журнал попыток…").waitFor();
    await f.page.getByLabel("Область", { exact: true }).selectOption(other);
    await f.page.getByText(/В этой области нет сохранённых событий/).waitFor();
    await f.page.waitForTimeout(850);
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    await f.page.getByText(/Новых записей попыток пока нет/).waitFor();
    assert.equal(
      await f.page.locator(".notification-attempt-history li").count(),
      0,
    );
    await close(f);
  }
  {
    const f = await fixture();
    await ready(f);
    f.setAttemptMalformed();
    await f.page.getByText("Журнал попыток", { exact: true }).click();
    await f.page
      .locator(".notification-attempt-history")
      .getByRole("alert")
      .waitFor();
    assert.equal(
      await f.page.locator(".notification-attempt-history li").count(),
      0,
    );
    await close(f);
  }
  console.log(
    JSON.stringify({
      mode: "synthetic-browser",
      notificationStatusScenarios: scenarios,
      screenshots: dir,
    }),
  );
} finally {
  await browser.close();
}
