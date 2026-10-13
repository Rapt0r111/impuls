import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "quota-publication",
  );
await mkdir(dir, { recursive: true });
const browser = await chromium.launch(),
  actor = "a1111111-1111-4111-8111-111111111111",
  scope = "b1111111-1111-4111-8111-111111111111",
  other = "c1111111-1111-4111-8111-111111111111",
  reward = "d1111111-1111-4111-8111-111111111111";
let scenarios = 0;
async function fixture(width = 320, readOnly = false) {
  const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    requests = [],
    errors = [];
  let status = 201,
    delay = 0;
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (r, b, code = 200) =>
    r.fulfill({
      status: code,
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
        user: { id: actor, displayName: "Учебный оператор квот" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me/permissions",
    (r) =>
      json(r, {
        permissions: [
          {
            action: "admin.catalog",
            scope: { id: scope, name: "Учебная область", kind: "project" },
            validUntil: null,
          },
          {
            action: "admin.audit",
            scope: { id: scope, name: "Учебная область", kind: "project" },
            validUntil: null,
          },
        ],
      }),
  );
  for (const name of ["tasks", "reviews"])
    await page.route(
      (u) => u.pathname === `/api/v1/${name}`,
      (r) => json(r, { items: [], nextCursor: null }),
    );
  await page.route(
    (u) => u.pathname === "/api/v1/admin/rewards",
    (r) => {
      const s = new URL(r.request().url()).searchParams.get("scope") ?? scope;
      return json(r, {
        mode: "synthetic",
        canPublish: false,
        canPublishQuota: !readOnly,
        scope: {
          id: s,
          name: s === scope ? "Учебная область" : "Другая область",
        },
        scopes: [
          { id: scope, name: "Учебная область" },
          { id: other, name: "Другая область" },
        ],
        updatedAt: "2026-10-05T10:00:00.000Z",
        items:
          s === other
            ? []
            : [
                {
                  rewardId: reward,
                  current: {
                    id: reward,
                    version: 1,
                    title: "Учебный статус исследователя",
                    conditions:
                      "Синтетическая косметика без реальных поощрений.",
                    price: 30,
                    enabled: true,
                    effectiveFrom: "2026-01-01T00:00:00.000Z",
                    reservationSeconds: 3600,
                  },
                  scheduled: null,
                  quota: {
                    id: reward,
                    startsAt: "2026-01-01T00:00:00.000Z",
                    endsAt: "2027-01-01T00:00:00.000Z",
                    capacity: 9,
                    reserved: 2,
                    used: 3,
                    available: 4,
                  },
                },
              ],
        nextCursor: null,
      });
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/admin/rewards/${reward}/quotas`,
    async (r) => {
      if (r.request().method() === "GET")
        return json(r, {
          mode: "synthetic",
          scope: { id: scope, name: "Учебная область" },
          rewardId: reward,
          updatedAt: "2026-10-05T10:00:00.000Z",
          items: [],
          nextCursor: null,
        });
      assert.equal(r.request().method(), "POST");
      const body = r.request().postDataJSON(),
        key = r.request().headers()["idempotency-key"];
      requests.push({ body, key });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (status === 0) return r.abort();
      if (status !== 201)
        return json(
          r,
          {
            code: "SYNTHETIC_FAILURE",
            message: "Synthetic failure",
            requestId: actor,
          },
          status,
        );
      return json(
        r,
        {
          mode: "synthetic",
          scope: body.scope,
          publicationId: actor,
          quota: {
            rewardId: reward,
            periodId: other,
            startsAt: body.startsAt,
            endsAt: body.endsAt,
            capacity: body.capacity,
          },
          updatedAt: "2026-10-05T12:00:00.123456Z",
        },
        201,
      );
    },
  );
  await page.route(
    (u) => u.pathname === "/api/v1/admin/audit",
    (r) =>
      json(r, {
        mode: "synthetic",
        scope: { id: scope, name: "Учебная область" },
        scopes: [{ id: scope, name: "Учебная область" }],
        updatedAt: "2026-10-05T12:00:00.123456Z",
        nextCursor: null,
        items: [
          {
            id: reward,
            requestId: actor,
            action: "quota.publish",
            actor: { id: actor, displayName: "Учебный оператор квот" },
            occurredAt: "2026-10-05T12:00:00.123456Z",
            reason: "Учебное основание публикации будущего периода",
            task: null,
            reward: null,
            catalog: null,
            quota: {
              rewardId: reward,
              periodId: other,
              startsAt: "2040-01-01T00:00:00.000Z",
              endsAt: "2040-02-01T00:00:00.000Z",
              capacity: 3,
            },
            reviewId: null,
            correctionId: null,
            values: [],
          },
        ],
      }),
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", { name: "Управление каталогом", exact: true })
    .click();
  await page.locator(".admin-catalog-items > li").waitFor();
  return {
    page,
    context,
    requests,
    errors,
    setStatus: (v) => (status = v),
    setDelay: (v) => (delay = v),
  };
}
async function open(f) {
  await f.page
    .getByRole("button", { name: "Опубликовать период квоты", exact: true })
    .click();
  await f.page
    .getByRole("heading", { name: "Новый период квоты", exact: true })
    .waitFor();
}
async function fill(f) {
  await f.page
    .getByLabel("Дата начала, UTC", { exact: true })
    .fill("2040-01-01");
  await f.page.getByLabel("Время начала, UTC", { exact: true }).fill("00:00");
  await f.page
    .getByLabel("Дата конца, UTC", { exact: true })
    .fill("2040-02-01");
  await f.page.getByLabel("Время конца, UTC", { exact: true }).fill("00:00");
  await f.page.getByLabel("Всего мест", { exact: true }).fill("3");
  await f.page
    .getByLabel("Основание публикации периода", { exact: true })
    .fill("Учебная проверка следующего периода без реальных поощрений");
}
async function preview(f) {
  await f.page
    .getByRole("button", { name: "Проверить период", exact: true })
    .click();
  await f.page
    .getByRole("button", { name: "Подтвердить период", exact: true })
    .waitFor();
}
async function capture(f, name) {
  assert.equal(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(f.errors, []);
  await f.page.evaluate(() => scrollTo(0, 0));
  await f.page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  });
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture(width);
    try {
      await open(f);
      await fill(f);
      await capture(f, `form-${width}`);
      await preview(f);
      await capture(f, `preview-${width}`);
      await f.page
        .getByText("Начало: 2040-01-01 00:00:00 UTC", { exact: false })
        .waitFor();
      await f.page
        .getByRole("button", { name: "Подтвердить период", exact: true })
        .click();
      await f.page
        .getByText("Период подтверждён сервером. Перечитываем квоты.")
        .waitFor();
      assert.equal(f.requests.length, 1);
      assert.deepEqual(f.requests[0].body, {
        scope,
        startsAt: "2040-01-01T00:00:00.000Z",
        endsAt: "2040-02-01T00:00:00.000Z",
        capacity: 3,
        reason: "Учебная проверка следующего периода без реальных поощрений",
      });
      assert.match(f.requests[0].key, /^[0-9a-f-]{36}$/);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const status of [0, 503, 429]) {
    const f = await fixture();
    try {
      await open(f);
      await fill(f);
      await preview(f);
      f.setStatus(status);
      await f.page
        .getByRole("button", { name: "Подтвердить период", exact: true })
        .click();
      await f.page
        .getByText(
          status === 429
            ? /Слишком много действий/
            : /Результат не подтверждён/,
        )
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Вернуться к полям", exact: true })
          .count(),
        0,
      );
      await capture(f, `retry-${status}`);
      f.setStatus(201);
      await f.page
        .getByRole("button", { name: "Повторить тот же запрос", exact: true })
        .click();
      await f.page
        .getByText("Период подтверждён сервером. Перечитываем квоты.")
        .waitFor();
      assert.deepEqual(f.requests[1], f.requests[0]);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const status of [409, 422]) {
    const f = await fixture();
    try {
      await open(f);
      await fill(f);
      await preview(f);
      f.setStatus(status);
      await f.page
        .getByRole("button", { name: "Подтвердить период", exact: true })
        .click();
      await f.page
        .getByRole("alert")
        .filter({
          hasText:
            status === 409 ? /Периоды пересекаются/ : /Публикация отклонена/,
        })
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Повторить тот же запрос", exact: true })
          .isDisabled(),
        true,
      );
      await capture(f, `conflict-${status}`);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const status of [401, 403, 404]) {
    const f = await fixture();
    try {
      await open(f);
      await fill(f);
      await preview(f);
      f.setStatus(status);
      await f.page
        .getByRole("button", { name: "Подтвердить период", exact: true })
        .click();
      await f.page
        .locator(".catalog-publication")
        .waitFor({ state: "detached" });
      assert.equal(
        await f.page.locator(".admin-catalog-items > li").count(),
        0,
      );
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  {
    const f = await fixture(320, true);
    try {
      assert.equal(
        await f.page
          .getByRole("button", {
            name: "Опубликовать период квоты",
            exact: true,
          })
          .count(),
        0,
      );
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const accept of [false, true]) {
    const f = await fixture();
    try {
      await open(f);
      await fill(f);
      f.page.once("dialog", (d) => (accept ? d.accept() : d.dismiss()));
      await f.page.evaluate(() => window.__back?.());
      if (accept)
        await f.page
          .locator(".catalog-publication")
          .waitFor({ state: "detached" });
      else
        assert.equal(await f.page.locator(".catalog-publication").count(), 1);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  {
    const f = await fixture();
    try {
      await open(f);
      await fill(f);
      await preview(f);
      f.setDelay(400);
      await f.page
        .getByRole("button", { name: "Подтвердить период", exact: true })
        .click();
      f.page.once("dialog", (d) => d.accept());
      await f.page.getByLabel("Область", { exact: true }).selectOption(other);
      await f.page.getByText("Поощрений пока нет.").waitFor();
      await f.page.waitForTimeout(500);
      assert.equal(
        await f.page
          .getByText("Период подтверждён сервером. Перечитываем квоты.")
          .count(),
        0,
      );
      assert.equal(await f.page.locator(".catalog-publication").count(), 0);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  {
    const f = await fixture();
    try {
      await open(f);
      await fill(f);
      await f.page.getByLabel("Всего мест", { exact: true }).fill("1.5");
      await f.page
        .getByRole("button", { name: "Проверить период", exact: true })
        .click();
      await f.page.getByText(/Укажите начало и более поздний/).waitFor();
      assert.equal(f.requests.length, 0);
      await f.page.getByLabel("Всего мест", { exact: true }).focus();
      await f.page.keyboard.press("Tab");
      assert.equal(
        await f.page
          .getByLabel("Основание публикации периода", { exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await f.page.getByLabel("Всего мест", { exact: true }).fill("0");
      await f.page
        .getByLabel("Время начала, UTC", { exact: true })
        .fill("12:34");
      await f.page
        .getByLabel("Время конца, UTC", { exact: true })
        .fill("18:56");
      await f.page.addStyleTag({
        content:
          "body {font-size:30px!important} .catalog-publication input,.catalog-publication textarea {font-size:32px!important}",
      });
      await capture(f, "text-scale-320");
      assert.equal(
        await f.page
          .getByLabel("Время начала, UTC", { exact: true })
          .inputValue(),
        "12:34",
      );
      assert.equal(
        await f.page
          .getByLabel("Время конца, UTC", { exact: true })
          .inputValue(),
        "18:56",
      );
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const width of [320, 1280]) {
    const f = await fixture(width);
    try {
      await f.page.getByRole("button", { name: "Ещё", exact: true }).click();
      await f.page
        .getByRole("button", { name: "Журнал действий", exact: true })
        .click();
      await f.page.locator(".audit-list > li").waitFor();
      assert.match(
        await f.page.locator(".audit-list").innerText(),
        /Всего мест при публикации: 3/,
      );
      await capture(f, `audit-${width}`);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  console.log(
    JSON.stringify({
      scenarios,
      screenshotDirectory: dir,
      physicalTelegram: "not tested",
    }),
  );
} finally {
  await browser.close();
}
