import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "catalog-cancellation",
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
    current = { ...original },
    scheduled = {
      ...original,
      id: other,
      version: 2,
      price: 19,
      effectiveFrom: "2040-01-01T00:00:00.000Z",
    };
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
        canPublish: false,
        canSchedule: false,
        canCancelSchedule: mode !== "read-only",
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
                      : scheduled,
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
    (u) =>
      u.pathname ===
      "/api/v1/admin/rewards/" + reward + "/scheduled-versions/cancel",
    async (r) => {
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
      const cancelled = {
        ...original,
        id: other,
        version: 2,
        price: 19,
        effectiveFrom: "2040-01-01T00:00:00.000Z",
      };
      scheduled = null;
      return json(
        r,
        {
          mode: "synthetic",
          scope: body.scope,
          cancellationId: actor,
          cancellation: { rewardId: reward, cancelled },
          updatedAt: "2026-10-06T12:00:00.000Z",
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
    .getByRole("button", { name: "Отменить будущие условия", exact: true })
    .click();
  await f.page
    .getByRole("heading", { name: "Отмена будущих условий", exact: true })
    .waitFor();
}
async function review(f) {
  await f.page
    .getByLabel("Основание отмены", { exact: true })
    .fill("Синтетическая отмена ошибочно запланированных условий");
  await f.page
    .getByRole("button", { name: "Проверить отмену", exact: true })
    .click();
}
async function send(f) {
  await f.page
    .getByRole("button", { name: "Подтвердить отмену", exact: true })
    .click();
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
    path: path.join(dir, name + ".png"),
    fullPage: true,
  });
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture(width);
    try {
      await open(f);
      await capture(f, "form-" + width);
      await review(f);
      await capture(f, "preview-" + width);
      await send(f);
      await f.page
        .getByText("Отмена подтверждена сервером. Перечитываем каталог.", {
          exact: true,
        })
        .waitFor();
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].body.expectedVersion, 2);
      assert.equal(f.requests[0].body.versionId, other);
      await f.page
        .getByRole("button", { name: "Отменить будущие условия", exact: true })
        .waitFor({ state: "hidden" });
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const status of [0, 429, 503]) {
    const f = await fixture();
    try {
      await open(f);
      await review(f);
      f.setStatus(status);
      await send(f);
      await f.page
        .getByRole("button", { name: "Повторить тот же запрос", exact: true })
        .waitFor();
      await f.page
        .locator(".catalog-publication")
        .getByRole("status")
        .waitFor();
      f.setStatus(201);
      await f.page
        .getByRole("button", { name: "Повторить тот же запрос", exact: true })
        .click();
      await f.page
        .getByText("Отмена подтверждена сервером. Перечитываем каталог.", {
          exact: true,
        })
        .waitFor();
      assert.deepEqual(f.requests[0], f.requests[1]);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const status of [400, 409, 413, 422]) {
    const f = await fixture();
    try {
      await open(f);
      await review(f);
      f.setStatus(status);
      await send(f);
      await f.page
        .locator(".admin-catalog-section")
        .getByRole("alert")
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Повторить тот же запрос", exact: true })
          .isDisabled(),
        true,
      );
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  for (const status of [401, 403, 404]) {
    const f = await fixture();
    try {
      await open(f);
      await review(f);
      f.setStatus(status);
      await send(f);
      await f.page
        .getByRole("heading", { name: "Отмена будущих условий", exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(
        await f.page.getByText(original.title, { exact: true }).count(),
        0,
      );
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  {
    const f = await fixture(320, "read-only");
    try {
      assert.equal(
        await f.page
          .getByRole("button", {
            name: "Отменить будущие условия",
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
      await f.page
        .getByLabel("Основание отмены", { exact: true })
        .fill("Unsaved");
      f.page.once("dialog", (d) => d.dismiss());
      await f.page.evaluate(() => window.__back());
      assert.equal(
        await f.page
          .getByLabel("Основание отмены", { exact: true })
          .inputValue(),
        "Unsaved",
      );
      f.page.once("dialog", (d) => d.accept());
      await f.page.evaluate(() => window.__back());
      await f.page
        .getByRole("heading", { name: "Отмена будущих условий", exact: true })
        .waitFor({ state: "hidden" });
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  {
    const f = await fixture();
    try {
      await open(f);
      await review(f);
      f.setDelay(1000);
      await send(f);
      await f.page
        .getByRole("button", { name: "Отменяем…", exact: true })
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Отменяем…", exact: true })
          .isDisabled(),
        true,
      );
      await f.page
        .getByText("Отмена подтверждена сервером. Перечитываем каталог.", {
          exact: true,
        })
        .waitFor();
      assert.equal(f.requests.length, 1);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  {
    const f = await fixture();
    try {
      await open(f);
      await review(f);
      await f.page.addStyleTag({
        content:
          ".catalog-publication,.catalog-publication *{font-size:24px!important;line-height:1.6!important}",
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
      await f.page
        .getByRole("button", { name: "Проверить отмену", exact: true })
        .click();
      assert.equal(f.requests.length, 0);
      assert.equal(
        await f.page
          .getByLabel("Основание отмены", { exact: true })
          .evaluate((e) => e.validity.valueMissing),
        true,
      );
      await f.page
        .getByLabel("Основание отмены", { exact: true })
        .fill("Keyboard confirmation");
      await f.page
        .getByRole("button", { name: "Проверить отмену", exact: true })
        .focus();
      await f.page.keyboard.press("Enter");
      await f.page
        .getByRole("button", { name: "Подтвердить отмену", exact: true })
        .waitFor();
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  {
    const f = await fixture();
    try {
      await open(f);
      await review(f);
      f.setDelay(1000);
      await send(f);
      await f.page
        .getByRole("button", { name: "Отменяем…", exact: true })
        .waitFor();
      f.page.once("dialog", (d) => d.accept());
      await f.page.getByLabel("Область", { exact: true }).selectOption(other);
      await f.page
        .getByText("Поощрений пока нет.", {
          exact: true,
        })
        .waitFor();
      await new Promise((r) => setTimeout(r, 1100));
      assert.equal(
        await f.page
          .getByText("Отмена подтверждена сервером. Перечитываем каталог.", {
            exact: true,
          })
          .count(),
        0,
      );
      assert.deepEqual(f.errors, []);
      scenarios++;
    } finally {
      await f.context.close();
    }
  }
  console.log(JSON.stringify({ scenarios, screenshots: dir }));
} finally {
  await browser.close();
}
