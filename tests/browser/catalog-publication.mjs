import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "catalog-publication",
  );
await mkdir(dir, { recursive: true });
const browser = await chromium.launch(),
  actor = "a1111111-1111-4111-8111-111111111111",
  scope = "b1111111-1111-4111-8111-111111111111",
  other = "c1111111-1111-4111-8111-111111111111",
  reward = "d1111111-1111-4111-8111-111111111111";
const original = {
  id: reward,
  version: 1,
  title: "Учебный статус исследователя",
  conditions:
    "Синтетическая косметика. Условия новых заявок сохраняются в версии.\nДлинная_строка_проверяет_перенос_без_горизонтальной_прокрутки.",
  price: 30,
  enabled: true,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  reservationSeconds: 3600,
};
let scenarios = 0;
async function fixture(width = 320, mode = "ready") {
  const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  let status = 201,
    delay = 0,
    current = { ...original };
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
        user: { id: actor, displayName: "Учебный администратор" },
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
        canPublish: mode !== "read-only",
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
                  current,
                  scheduled:
                    mode === "future"
                      ? {
                          ...current,
                          id: other,
                          version: 2,
                          effectiveFrom: "2040-01-01T00:00:00.000Z",
                        }
                      : null,
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
    (u) => u.pathname === `/api/v1/admin/rewards/${reward}/versions`,
    async (r) => {
      assert.equal(r.request().method(), "POST");
      const body = r.request().postDataJSON(),
        key = r.request().headers()["idempotency-key"];
      requests.push({ body, key });
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
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
      current = {
        id: other,
        version: body.expectedVersion + 1,
        title: body.title,
        conditions: body.conditions,
        price: body.price,
        enabled: body.enabled,
        reservationSeconds: body.reservationSeconds,
        effectiveFrom: "2026-10-05T12:00:00.123456Z",
      };
      return json(
        r,
        {
          mode: "synthetic",
          scope: body.scope,
          publicationId: actor,
          catalog: {
            rewardId: reward,
            previousVersion: body.expectedVersion,
            published: current,
          },
          updatedAt: current.effectiveFrom,
        },
        201,
      );
    },
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
    errors,
    requests,
    setStatus: (v) => (status = v),
    setDelay: (v) => (delay = v),
  };
}
async function open(f) {
  await f.page
    .getByRole("button", { name: "Опубликовать новые условия", exact: true })
    .click();
  await f.page
    .getByRole("heading", { name: "Новая версия условий", exact: true })
    .waitFor();
}
async function fill(f) {
  await f.page
    .getByLabel("Название", { exact: true })
    .fill("Новая синтетическая версия");
  await f.page.getByLabel("Цена в баллах", { exact: true }).fill("19");
  await f.page.getByLabel("Срок резерва, секунды", { exact: true }).fill("");
  await f.page
    .getByLabel("Включить для новых заявок", { exact: true })
    .uncheck();
  await f.page
    .getByLabel("Основание публикации", { exact: true })
    .fill("Учебная проверка новой версии без реальных поощрений");
}
async function preview(f) {
  await f.page
    .getByRole("button", { name: "Проверить изменения", exact: true })
    .click();
  await f.page
    .getByRole("button", { name: "Подтвердить публикацию", exact: true })
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
      assert.match(
        await f.page
          .locator(
            ".catalog-publication .admin-catalog-terms .notification-note",
          )
          .innerText(),
        /Начало действия: время подтверждения сервером\./,
      );
      f.setDelay(150);
      const button = f.page.getByRole("button", {
        name: "Подтвердить публикацию",
        exact: true,
      });
      await button.click();
      await f.page
        .getByText("Новая версия подтверждена сервером. Перечитываем каталог.")
        .waitFor();
      await f.page
        .locator(".catalog-publication")
        .waitFor({ state: "detached" });
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].body.price, 19);
      assert.equal(f.requests[0].body.reservationSeconds, null);
      assert.equal(f.requests[0].body.enabled, false);
      assert.match(f.requests[0].key, /^[0-9a-f-]{36}$/);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const mode of ["read-only", "future"]) {
    const f = await fixture(320, mode);
    try {
      assert.equal(
        await f.page
          .getByRole("button", {
            name: "Опубликовать новые условия",
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
  {
    const f = await fixture();
    try {
      await open(f);
      await fill(f);
      let accept = false;
      let dialogs = 0;
      f.page.on("dialog", (d) => (accept ? d.accept() : d.dismiss()));
      f.page.on("dialog", () => dialogs++);
      await f.page.getByLabel("Область", { exact: true }).selectOption(other);
      assert.equal(await f.page.locator(".catalog-publication").count(), 1);
      assert.equal(dialogs, 1);
      await f.page.evaluate(() => window.__back?.());
      assert.equal(await f.page.locator(".catalog-publication").count(), 1);
      accept = true;
      await f.page.evaluate(() => window.__back?.());
      await f.page
        .locator(".catalog-publication")
        .waitFor({ state: "detached" });
      assert.equal(f.requests.length, 0);
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
        .getByRole("button", { name: "Подтвердить публикацию", exact: true })
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
        .getByText("Новая версия подтверждена сервером. Перечитываем каталог.")
        .waitFor();
      assert.equal(f.requests.length, 2);
      assert.deepEqual(f.requests[1], f.requests[0]);
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
        .getByRole("button", { name: "Подтвердить публикацию", exact: true })
        .click();
      f.page.once("dialog", (d) => d.accept());
      await f.page.getByLabel("Область", { exact: true }).selectOption(other);
      await f.page
        .getByText("В этой области нет сохранённых позиций косметики.")
        .waitFor();
      await f.page.waitForTimeout(500);
      assert.equal(await f.page.locator(".catalog-publication").count(), 0);
      assert.equal(
        await f.page
          .getByText(
            "Новая версия подтверждена сервером. Перечитываем каталог.",
          )
          .count(),
        0,
      );
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
      await f.page.addStyleTag({
        content:
          "body {font-size:30px !important} .catalog-publication input,.catalog-publication textarea {font-size:32px !important}",
      });
      await capture(f, "text-scale-320");
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
      f.setStatus(409);
      await f.page
        .getByRole("button", { name: "Подтвердить публикацию", exact: true })
        .click();
      await f.page
        .getByRole("alert")
        .filter({ hasText: /Условия или ключ/ })
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Повторить тот же запрос", exact: true })
          .isDisabled(),
        true,
      );
      await capture(f, "conflict-320");
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
        .getByRole("button", { name: "Подтвердить публикацию", exact: true })
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
    const f = await fixture();
    try {
      await open(f);
      await f.page.getByLabel("Цена в баллах", { exact: true }).fill("1.5");
      await f.page
        .getByLabel("Основание публикации", { exact: true })
        .fill("Reason");
      await f.page
        .getByRole("button", { name: "Проверить изменения", exact: true })
        .click();
      await f.page.getByText(/Проверьте поля:/).waitFor();
      assert.equal(f.requests.length, 0);
      await f.page.getByLabel("Название", { exact: true }).focus();
      await f.page.keyboard.press("Tab");
      assert.equal(
        await f.page
          .getByLabel("Условия", { exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
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
