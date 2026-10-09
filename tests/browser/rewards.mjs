import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const dir = path.join(
  process.env.TEST_SCREENSHOT_DIR ?? "test-results",
  "rewards",
);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const id = "11111111-1111-4111-8111-111111111111",
  versionId = "21111111-1111-4111-8111-111111111111",
  quotaId = "31111111-1111-4111-8111-111111111111",
  at = "2026-10-03T10:00:00.000Z";
const balance = {
  lifetimeXp: 300,
  availablePoints: 120,
  reservedPoints: 0,
  version: 1,
  updatedAt: at,
};
const reward = {
  id: versionId,
  rewardId: id,
  version: 1,
  title: "Знак исследователя",
  conditions:
    "Косметический знак профиля. Синтетические условия без служебных привилегий.",
  price: 30,
  reservationSeconds: 3600,
  quota: {
    id: quotaId,
    startsAt: at,
    endsAt: "2026-10-31T21:00:00.000Z",
    available: 1,
  },
  hasPendingRequest: false,
};
const redemption = {
  id,
  rewardId: id,
  rewardVersionId: versionId,
  quotaPeriodId: quotaId,
  scope: { id, name: "Тестовая область" },
  title: reward.title,
  conditions: reward.conditions,
  price: 30,
  rewardVersion: 1,
  periodStart: at,
  periodEnd: reward.quota.endsAt,
  expiresAt: "2026-10-03T11:00:00.000Z",
  status: "pending",
  cancellationReason: null,
  version: 1,
  createdAt: at,
  updatedAt: at,
};
let scenarios = 0;
async function fixture(mode = "populated", width = 390) {
  const context = await browser.newContext({
      viewport: { width, height: 950 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (r, body, status = 200, headers = {}) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
      headers,
    });
  let changed = false,
    cursorRejected = false,
    fail = false,
    failStatus = 503,
    attempt = 0;
  const posts = [];
  const catalogReads = [];
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{ready(){},expand(){}}}",
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
    (url) => url.pathname === "/api/v1/rewards",
    async (r) => {
      const params = new URL(r.request().url()).searchParams;
      const page2 = params.has("cursor");
      catalogReads.push(params.get("cursor"));
      if (
        page2 &&
        ["catalog-invalid", "catalog-changed", "catalog-denied"].includes(mode)
      ) {
        cursorRejected = true;
        return json(
          r,
          { code: "TEST" },
          mode === "catalog-invalid"
            ? 400
            : mode === "catalog-changed"
              ? 409
              : 404,
        );
      }
      if (mode === "loading")
        await new Promise((resolve) => setTimeout(resolve, 1200));
      if (
        mode === "disabled" ||
        mode === "error" ||
        mode === "revoked" ||
        mode === "session" ||
        fail
      )
        return json(
          r,
          { code: "TEST" },
          mode === "disabled"
            ? 404
            : mode === "revoked"
              ? 403
              : mode === "session"
                ? 401
                : failStatus,
        );
      const item = {
        ...reward,
        ...(page2
          ? {
              id: "41111111-1111-4111-8111-111111111111",
              rewardId: "51111111-1111-4111-8111-111111111111",
              title: "Вторая позиция каталога",
            }
          : {}),
        ...(mode === "full"
          ? { quota: { ...reward.quota, available: 0 } }
          : {}),
        ...(mode === "poor" ? { price: 150 } : {}),
        ...(mode === "pending" || mode === "cursor-invalid" || changed
          ? { hasPendingRequest: true }
          : {}),
        ...(mode === "long"
          ? {
              title:
                "Косметический_знак_для_проверки_длинного_названия_без_пробелов_на_мобильном_экране",
              conditions: reward.conditions.repeat(4),
            }
          : {}),
      };
      return json(r, {
        mode: "synthetic",
        scope: mode === "no-scope" ? null : { id, name: "Тестовая область" },
        scopes: mode === "no-scope" ? [] : [{ id, name: "Тестовая область" }],
        balance:
          changed ||
          mode === "pending" ||
          mode === "old-pending" ||
          mode === "cursor-invalid"
            ? { ...balance, availablePoints: 90, reservedPoints: 30 }
            : balance,
        items: ["empty", "no-scope"].includes(mode) ? [] : [item],
        nextCursor:
          mode.startsWith("catalog-") && !page2 && !cursorRejected
            ? `${id}|${id}|catalog|${id}|${versionId}|${quotaId}`
            : null,
        updatedAt: at,
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/redemptions",
    (r) => {
      const page2 = new URL(r.request().url()).searchParams.has("cursor");
      if (mode === "cursor-invalid" && page2) {
        cursorRejected = true;
        return json(r, { code: "INVALID_CURSOR" }, 400);
      }
      return json(
        r,
        {
          mode: "synthetic",
          items:
            changed ||
            mode === "pending" ||
            mode === "old-pending" ||
            mode === "expired" ||
            mode === "cursor-invalid"
              ? [
                  {
                    ...redemption,
                    ...(mode === "expired"
                      ? {
                          status: "expired",
                          version: 2,
                          decision: {
                            actorId: versionId,
                            displayName: "Тестовый уполномоченный",
                            reason: "Истечение срока",
                            decidedAt: "2026-10-03T11:00:00.000Z",
                          },
                        }
                      : {}),
                    ...(mode === "old-pending"
                      ? {
                          periodStart: "2026-08-31T21:00:00.000Z",
                          periodEnd: "2026-09-30T21:00:00.000Z",
                        }
                      : {}),
                  },
                ]
              : [],
          nextCursor:
            mode === "cursor-invalid" && !cursorRejected
              ? `${id}|all|mine|${id}`
              : null,
          updatedAt: at,
        },
        mode === "disabled" ? 404 : 200,
      );
    },
  );
  await page.route(
    (url) =>
      url.pathname === "/api/v1/redemptions" ||
      url.pathname.endsWith("/cancel"),
    async (r) => {
      posts.push({
        key: r.request().headers()["idempotency-key"],
        body: r.request().postData(),
        csrf: r.request().headers()["x-csrf-token"],
      });
      attempt++;
      if (mode === "lost" && attempt === 1) return r.abort();
      if (mode === "rate" && attempt === 1)
        return json(r, { code: "RATE_LIMITED" }, 429, { "retry-after": "7" });
      if (mode === "conflict")
        return json(
          r,
          {
            code: "REWARD_CONFLICT",
            message: "Условия изменились. Обновите данные",
          },
          409,
        );
      changed = true;
      const cancelled = r.request().url().endsWith("/cancel");
      return json(
        r,
        {
          mode: "synthetic",
          redemption: {
            ...redemption,
            ...(cancelled
              ? {
                  status: "cancelled",
                  version: 2,
                  cancellationReason: JSON.parse(r.request().postData()).reason,
                }
              : {}),
          },
          balance: cancelled
            ? balance
            : { ...balance, availablePoints: 90, reservedPoints: 30 },
        },
        cancelled ? 200 : 201,
      );
    },
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Поощрения", exact: true }).click();
  return {
    page,
    context,
    errors,
    posts,
    catalogReads,
    setFail: (status = 503) => {
      fail = true;
      failStatus = status;
    },
    recover: () => {
      fail = false;
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
async function select(f) {
  await f.page
    .getByRole("button", { name: "Оформить заявку", exact: true })
    .click();
  await f.page
    .getByRole("heading", { name: "Подтвердите резерв", exact: true })
    .waitFor();
}
async function capture(f, name) {
  await f.page.mouse.move(0, 0);
  await f.page.screenshot({
    path: path.join(dir, name),
    fullPage: true,
    animations: "disabled",
  });
}
async function keyboardRefresh(f) {
  // Reopening can still fetch when cached error text appears; focus() does not wait.
  const refresh = f.page
    .locator("button:enabled")
    .filter({ hasText: /^Обновить поощрения$/ });
  await refresh.waitFor();
  await refresh.focus();
  await f.page.keyboard.press("Enter");
}
try {
  for (const width of [320, 360, 390]) {
    const f = await fixture("expired", width);
    await f.page
      .getByText(/Срок резерва истёк, баллы и место возвращены/)
      .waitFor();
    await f.page.getByText(/Срок резерва:.*14:00 МСК/).waitFor();
    await f.page.getByText(/Истечение срока/).waitFor();
    assert.equal(
      await f.page
        .getByRole("button", { name: "Отменить заявку", exact: true })
        .count(),
      0,
    );
    await capture(f, `expired-history-${width}.png`);
    await close(f);
  }
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("populated", width);
    await f.page
      .getByRole("heading", { name: reward.title, exact: true })
      .waitFor();
    await capture(f, `catalog-${width}.png`);
    assert.equal(
      await f.page
        .locator(".workspace-nav-personal .workspace-tab")
        .evaluateAll((buttons) =>
          buttons.every((b) => {
            const range = document.createRange();
            range.selectNodeContents(b.querySelector("span"));
            return (
              range.getClientRects().length === 1 &&
              b.scrollWidth <= b.clientWidth
            );
          }),
        ),
      true,
    );
    await select(f);
    await f.page.getByText(/Срок резерва: 3.?600 секунд с подачи/).waitFor();
    await f.page
      .getByText("После резерва останется доступно: 90 баллов.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await f.page.evaluate(() => document.activeElement?.id),
      "reward-confirm-title",
    );
    const submit = f.page.getByRole("button", {
      name: "Создать заявку и резерв",
      exact: true,
    });
    assert.equal(await submit.isEnabled(), false);
    await f.page.getByRole("checkbox").check();
    assert.equal(await submit.isEnabled(), true);
    if (width === 320) await capture(f, "reserve-320.png");
    assert.ok((await submit.boundingBox()).height >= 44);
    await submit.focus();
    await f.page.keyboard.press("Enter");
    await f.page.getByText(/Заявка сохранена/).waitFor();
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].csrf, "synthetic");
    assert.deepEqual(JSON.parse(f.posts[0].body), {
      rewardVersionId: versionId,
      quotaPeriodId: quotaId,
      expectedVersion: 1,
    });
    await close(f);
  }
  for (const mode of [
    "empty",
    "no-scope",
    "disabled",
    "error",
    "loading",
    "full",
    "poor",
    "pending",
    "long",
  ]) {
    const f = await fixture(mode, 320);
    if (mode === "loading") {
      await f.page.getByText("Загружаем каталог…").waitFor();
      await f.page
        .getByRole("heading", { name: reward.title, exact: true })
        .waitFor();
    } else if (mode === "disabled")
      await f.page
        .getByText(/Синтетический каталог выключен/)
        .first()
        .waitFor();
    else if (mode === "error")
      await f.page.getByText(/Не удалось загрузить поощрения/).waitFor();
    else if (mode === "empty")
      await f.page.getByText(/В этой области пока нет/).waitFor();
    else if (mode === "no-scope")
      await f.page.getByText(/Для каталога требуется членство/).waitFor();
    else if (["full", "poor", "pending"].includes(mode)) {
      const name = {
        full: "Нет свободных мест",
        poor: "Недостаточно баллов",
        pending: "Заявка уже есть",
      }[mode];
      await f.page.getByRole("button", { name, exact: true }).waitFor();
      assert.equal(
        await f.page.getByRole("button", { name, exact: true }).isEnabled(),
        false,
      );
    } else
      await f.page
        .getByRole("button", { name: "Оформить заявку", exact: true })
        .waitFor();
    if (["empty", "disabled", "long"].includes(mode))
      await capture(f, `${mode}-320.png`);
    await close(f);
  }
  for (const mode of ["lost", "rate"]) {
    const f = await fixture(mode);
    await select(f);
    await f.page.getByRole("checkbox").check();
    await f.page
      .getByRole("button", { name: "Создать заявку и резерв", exact: true })
      .click();
    const retry = f.page.getByRole("button", {
      name: "Повторить тот же запрос",
      exact: true,
    });
    await retry.waitFor();
    if (mode === "rate") await f.page.getByText(/через 7 с/).waitFor();
    else await f.page.getByText(/Результат не подтверждён/).waitFor();
    await retry.click();
    await f.page.getByText(/Заявка сохранена/).waitFor();
    assert.equal(f.posts.length, 2);
    assert.deepEqual(f.posts[0], f.posts[1]);
    await close(f);
  }
  {
    const f = await fixture("conflict");
    await select(f);
    await f.page.getByRole("checkbox").check();
    await f.page
      .getByRole("button", { name: "Создать заявку и резерв", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Обновить условия", exact: true })
      .click();
    await select(f);
    assert.equal(await f.page.getByRole("checkbox").isChecked(), false);
    await close(f);
  }
  {
    const f = await fixture("old-pending", 320);
    await f.page
      .getByRole("button", { name: "Отменить заявку", exact: true })
      .click();
    const submit = f.page.getByRole("button", {
      name: "Отменить и вернуть баллы",
      exact: true,
    });
    await f.page
      .getByText("После отмены останется доступно: 120 баллов.", {
        exact: true,
      })
      .waitFor();
    await f.page.getByRole("checkbox").check();
    assert.equal(await submit.isEnabled(), false);
    await f.page
      .getByLabel("Причина отмены", { exact: true })
      .fill("Передумал получать тестовый знак");
    await capture(f, "cancel-320.png");
    await submit.click();
    await f.page.getByText(/Заявка отменена/).waitFor();
    assert.deepEqual(JSON.parse(f.posts[0].body), {
      expectedVersion: 1,
      reason: "Передумал получать тестовый знак",
    });
    await close(f);
  }
  {
    const f = await fixture();
    await select(f);
    f.page.once("dialog", (d) => d.dismiss());
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await f.page
      .getByRole("heading", { name: "Подтвердите резерв", exact: true })
      .waitFor();
    await close(f);
  }
  {
    const f = await fixture();
    await f.page
      .getByRole("heading", { name: reward.title, exact: true })
      .waitFor();
    f.setFail();
    await f.page
      .getByRole("button", { name: "Обновить поощрения", exact: true })
      .click();
    await f.page.getByText(/последние подтверждённые данные/).waitFor();
    assert.equal(
      await f.page
        .getByRole("button", { name: "Оформить заявку", exact: true })
        .isEnabled(),
      false,
    );
    await close(f);
  }
  {
    const f = await fixture("cursor-invalid", 320);
    await f.page
      .getByRole("button", { name: "Ещё заявки", exact: true })
      .click();
    await f.page.getByText(/Каталог или список заявок изменился/).waitFor();
    assert.equal(
      await f.page
        .getByRole("button", { name: "Отменить заявку", exact: true })
        .isEnabled(),
      false,
    );
    assert.equal(
      await f.page
        .getByRole("button", { name: "Ещё заявки", exact: true })
        .isEnabled(),
      false,
    );
    await capture(f, "cursor-invalid-320.png");
    await keyboardRefresh(f);
    await f.page
      .locator("button:enabled")
      .filter({ hasText: /^Отменить заявку$/ })
      .waitFor();
    assert.equal(
      await f.page
        .getByRole("button", { name: "Отменить заявку", exact: true })
        .isEnabled(),
      true,
    );
    assert.equal(
      await f.page
        .getByRole("button", { name: "Ещё заявки", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await f.page.locator(".reward-catalog").getByRole("alert").count(),
      0,
    );
    await close(f);
  }
  for (const [mode, width] of [
    ["catalog-invalid", 320],
    ["catalog-changed", 360],
    ["catalog-denied", 390],
  ]) {
    const f = await fixture(mode, width);
    await f.page
      .getByRole("button", { name: "Ещё позиции", exact: true })
      .click();
    const alert = f.page.locator(".reward-catalog").getByRole("alert");
    await alert.waitFor();
    if (mode === "catalog-denied") {
      assert.equal(await f.page.locator(".reward-list").count(), 0);
      await f.page.getByText(/Ваши прежние заявки|Заявок пока нет/).waitFor();
    } else {
      assert.match(await alert.innerText(), /страница устарела/);
      assert.equal(
        await f.page
          .getByRole("button", { name: "Оформить заявку", exact: true })
          .isEnabled(),
        false,
      );
      assert.equal(
        await f.page
          .getByRole("button", { name: "Ещё позиции", exact: true })
          .isEnabled(),
        false,
      );
    }
    await capture(f, `${mode}-${width}.png`);
    f.setFail();
    await f.page
      .getByRole("button", { name: "Обновить поощрения", exact: true })
      .click();
    await f.page.getByText(/Не удалось загрузить поощрения/).waitFor();
    if (mode !== "catalog-denied")
      await f.page.getByText(/последние подтверждённые данные/).waitFor();
    else {
      assert.equal(await f.page.locator(".reward-list").count(), 0);
      await f.page
        .getByRole("button", { name: "Мои задачи", exact: true })
        .click();
      await f.page
        .getByRole("button", { name: "Поощрения", exact: true })
        .click();
      await f.page.getByText(/Не удалось загрузить поощрения/).waitFor();
      assert.equal(await f.page.locator(".reward-list").count(), 0);
    }
    f.recover();
    await keyboardRefresh(f);
    await f.page
      .locator("button:enabled")
      .filter({ hasText: /^Оформить заявку$/ })
      .waitFor();
    assert.equal(f.catalogReads.at(-1), null);
    assert.equal(
      await f.page
        .getByRole("button", { name: "Ещё позиции", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await f.page.locator(".reward-catalog").getByRole("alert").count(),
      0,
    );
    await close(f);
  }
  {
    const f = await fixture("catalog-multiple", 320);
    await f.page
      .getByRole("button", { name: "Ещё позиции", exact: true })
      .click();
    await f.page
      .getByRole("heading", { name: "Вторая позиция каталога", exact: true })
      .waitFor();
    assert.equal(await f.page.locator(".reward-list li").count(), 2);
    f.setFail();
    await f.page
      .getByRole("button", { name: "Обновить поощрения", exact: true })
      .click();
    await f.page.getByText(/последние подтверждённые данные/).waitFor();
    assert.equal(await f.page.locator(".reward-list li").count(), 1);
    assert.equal(f.catalogReads.at(-1), null);
    await capture(f, "catalog-stale-refresh-320.png");
    f.recover();
    await f.page
      .getByRole("button", { name: "Обновить поощрения", exact: true })
      .click();
    await f.page
      .locator("button:enabled")
      .filter({ hasText: /^Оформить заявку$/ })
      .waitFor();
    f.setFail(404);
    await f.page
      .getByRole("button", { name: "Обновить поощрения", exact: true })
      .click();
    await f.page.getByText(/Синтетический каталог выключен/).waitFor();
    assert.equal(await f.page.locator(".reward-list").count(), 0);
    await close(f);
  }
  for (const mode of ["revoked", "session"]) {
    const f = await fixture(mode);
    await f.page
      .getByRole("heading", {
        name:
          mode === "revoked"
            ? "Доступ отозван"
            : "Не удалось подтвердить сессию",
        exact: true,
      })
      .waitFor();
    assert.equal(await f.page.locator(".reward-list").count(), 0);
    await close(f);
  }
  console.log(
    `Reward browser scenarios passed: ${scenarios}; screenshots: ${dir}`,
  );
} finally {
  await browser.close();
}
