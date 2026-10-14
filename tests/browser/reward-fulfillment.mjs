import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "reward-fulfillment",
  );
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
let scenarios = 0;
const id = "11111111-1111-4111-8111-111111111111",
  owner = "21111111-1111-4111-8111-111111111111",
  at = "2026-10-03T10:00:00.000Z",
  scope = { id, name: "Тестовая область выдачи" };
const item = {
  id,
  rewardId: id,
  rewardVersionId: id,
  quotaPeriodId: id,
  scope,
  title: "Косметический знак исследователя",
  conditions:
    "Синтетическая косметика без служебных привилегий. Сохранённые условия заявки.",
  price: 30,
  rewardVersion: 1,
  periodStart: at,
  periodEnd: "2026-11-01T00:00:00.000Z",
  status: "approved",
  cancellationReason: null,
  decision: {
    actorId: owner,
    displayName: "Тестовый согласующий",
    reason: "Условия проверены",
    decidedAt: at,
  },
  fulfillment: null,
  version: 2,
  createdAt: at,
  updatedAt: at,
};
const issued = {
  ...item,
  status: "fulfilled",
  version: 3,
  fulfillment: {
    actorId: id,
    displayName: "Тестовый выдающий",
    reason: "Предмет выдан",
    fulfilledAt: at,
    entitlementId: id,
  },
};
async function fixture(mode = "populated", width = 390) {
  const context = await browser.newContext({
      viewport: { width, height: 1100 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let done = false,
    fail = false;
  const json = (r, body, status = 200, headers = {}) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
      headers,
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{ready(){},expand(){}}}",
    }),
  );
  await page.route("**/api/v1/**", async (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/v1/me")
      return json(r, {
        user: { id, displayName: "Тестовый выдающий" },
        csrfToken: "synthetic",
      });
    if (p === "/api/v1/me/permissions")
      return json(r, {
        permissions:
          mode === "dual"
            ? ["reward.decide", "reward.fulfill"].map((action) => ({
                action,
                scope: { ...scope, kind: "project" },
                validUntil: null,
              }))
            : mode === "no-permission"
              ? [
                  {
                    action: "reward.decide",
                    scope: { ...scope, kind: "project" },
                    validUntil: null,
                  },
                ]
              : [
                  {
                    action: "reward.fulfill",
                    scope: { ...scope, kind: "project" },
                    validUntil: null,
                  },
                ],
      });
    if (p === "/api/v1/tasks") return json(r, { items: [], nextCursor: null });
    if (p === "/api/v1/rewards")
      return json(r, {
        mode: "synthetic",
        scopes: [scope],
        scope,
        balance: {
          lifetimeXp: 300,
          availablePoints: 90,
          reservedPoints: 0,
          version: 3,
          updatedAt: at,
        },
        items:
          mode === "owned"
            ? [
                {
                  id,
                  rewardId: id,
                  version: 1,
                  title: item.title,
                  conditions: item.conditions,
                  price: 30,
                  quota: {
                    id,
                    startsAt: at,
                    endsAt: item.periodEnd,
                    available: 2,
                  },
                  hasPendingRequest: false,
                  owned: true,
                },
              ]
            : [],
        nextCursor: null,
        updatedAt: at,
      });
    if (p === "/api/v1/me/redemptions")
      return json(r, {
        mode: "synthetic",
        items: mode === "owned" ? [issued] : [],
        nextCursor: null,
        updatedAt: at,
      });
    if (p === "/api/v1/redemptions/fulfillment") {
      if (mode === "loading")
        await new Promise((resolve) => setTimeout(resolve, 600));
      if (fail || ["disabled", "error", "revoked", "session"].includes(mode))
        return json(
          r,
          { code: "TEST" },
          mode === "revoked"
            ? 403
            : mode === "session"
              ? 401
              : mode === "disabled"
                ? 404
                : 503,
        );
      const page2 = new URL(r.request().url()).searchParams.has("cursor");
      if (
        page2 &&
        ["cursor-invalid", "page-changed", "scope-lost"].includes(mode)
      ) {
        done = true;
        return json(
          r,
          { code: mode === "page-changed" ? "PAGE_CHANGED" : "INVALID_CURSOR" },
          mode === "scope-lost" ? 404 : mode === "page-changed" ? 409 : 400,
        );
      }
      return json(r, {
        mode: "synthetic",
        scopes: mode === "no-scope" ? [] : [scope],
        scope: mode === "no-scope" ? null : scope,
        items:
          done || ["empty", "no-scope"].includes(mode)
            ? []
            : [
                {
                  redemption: page2 ? { ...item, id: owner } : item,
                  recipient: { id: owner, displayName: "Тестовый получатель" },
                },
              ],
        nextCursor:
          ["paged", "cursor-invalid", "page-changed", "scope-lost"].includes(
            mode,
          ) &&
          !page2 &&
          !done
            ? `${id}|${scope.id}|fulfill|${id}`
            : null,
        updatedAt: at,
      });
    }
    if (p.endsWith("/fulfill")) {
      posts.push({
        body: r.request().postData(),
        key: r.request().headers()["idempotency-key"],
      });
      if (["unknown", "rate", "lost"].includes(mode) && posts.length === 1) {
        if (mode === "lost") return r.abort("failed");
        return json(
          r,
          { code: "TEST" },
          mode === "rate" ? 429 : 503,
          mode === "rate" ? { "retry-after": "7" } : {},
        );
      }
      if (mode === "conflict") return json(r, { code: "REWARD_CONFLICT" }, 409);
      if (mode === "mutation-revoked")
        return json(r, { code: "ACCESS_REVOKED" }, 403);
      done = true;
      return json(r, { mode: "synthetic", redemption: issued });
    }
    return json(r, { code: "NOT_FOUND" }, 404);
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Поощрения", exact: true }).click();
  if (!["no-permission", "owned", "dual"].includes(mode))
    await page
      .getByRole("button", { name: "Выдача поощрений", exact: true })
      .click();
  return {
    page,
    context,
    errors,
    posts,
    setFail() {
      fail = true;
    },
  };
}
async function select(f) {
  await f.page
    .getByRole("button", { name: "Подготовить выдачу", exact: true })
    .first()
    .click();
  await f.page.getByRole("heading", { name: "Подтвердите выдачу" }).waitFor();
}
async function confirm(f) {
  await f.page
    .getByLabel("Основание выдачи", { exact: true })
    .fill("Предмет выдан");
  await f.page.getByRole("checkbox").check();
}
async function capture(f, name) {
  await f.page.evaluate(() => window.scrollTo(0, 0));
  await f.page.screenshot({ path: path.join(dir, name), fullPage: true });
  assert.equal(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(f.errors, []);
}
try {
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("populated", width);
    await f.page.getByText("Тестовый получатель", { exact: false }).waitFor();
    await capture(f, `queue-${width}.png`);
    await select(f);
    assert.equal(
      await f.page
        .getByRole("button", { name: "Выдать поощрение", exact: true })
        .isDisabled(),
      true,
    );
    await f.page.getByText(/Согласовал \(текущее имя\)/).waitFor();
    await f.page.getByText(/повторно они не спишутся/).waitFor();
    assert.equal(
      await f.page.locator("textarea").getAttribute("maxlength"),
      "2000",
    );
    await confirm(f);
    await capture(f, `form-${width}.png`);
    await f.page
      .getByRole("button", { name: "Выдать поощрение", exact: true })
      .click();
    await f.page.getByText(/Поощрение выдано\./).waitFor();
    assert.deepEqual(JSON.parse(f.posts[0].body), {
      expectedVersion: 2,
      reason: "Предмет выдан",
    });
    assert.match(f.posts[0].key, /^[0-9a-f-]{36}$/);
    assert.deepEqual(f.errors, []);
    await f.context.close();
    scenarios++;
  }
  for (const mode of ["empty", "no-scope", "disabled", "error", "loading"]) {
    const f = await fixture(mode, 320);
    await f.page
      .getByRole("heading", { name: "Выдача поощрений", exact: true })
      .waitFor();
    if (mode === "loading")
      await f.page.getByText("Загружаем заявки…").waitFor();
    else if (mode === "empty")
      await f.page.getByText(/Согласованных чужих заявок/).waitFor();
    else if (mode === "no-scope")
      await f.page.getByText(/отдельное право/).waitFor();
    else await f.page.locator(".reward-catalog").getByRole("alert").waitFor();
    await capture(f, `${mode}-320.png`);
    await f.context.close();
    scenarios++;
  }
  for (const mode of ["unknown", "rate", "lost"]) {
    const f = await fixture(mode, 320);
    await select(f);
    await confirm(f);
    await f.page
      .getByRole("button", { name: "Выдать поощрение", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Повторить ту же выдачу", exact: true })
      .waitFor();
    await f.page.locator(".reward-catalog").getByRole("alert").waitFor();
    await capture(f, `${mode}-320.png`);
    assert.equal(
      await f.page.getByLabel("Основание выдачи", { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await f.page
        .getByRole("button", { name: "Вернуться к очереди", exact: true })
        .isDisabled(),
      true,
    );
    await f.page
      .getByRole("button", { name: "Повторить ту же выдачу", exact: true })
      .click();
    await f.page.getByText(/Поощрение выдано\./).waitFor();
    assert.deepEqual(f.posts[1], f.posts[0]);
    await f.context.close();
    scenarios++;
  }
  const conflict = await fixture("conflict", 320);
  await select(conflict);
  await confirm(conflict);
  await conflict.page
    .getByRole("button", { name: "Выдать поощрение", exact: true })
    .click();
  await conflict.page.locator(".reward-catalog").getByRole("alert").waitFor();
  assert.equal(
    await conflict.page.getByLabel("Основание выдачи").inputValue(),
    "Предмет выдан",
  );
  assert.equal(
    await conflict.page
      .getByRole("button", { name: "Выдать поощрение", exact: true })
      .isDisabled(),
    true,
  );
  await capture(conflict, "conflict-320.png");
  await conflict.context.close();
  scenarios++;
  const stale = await fixture();
  await stale.page
    .getByRole("button", { name: "Подготовить выдачу" })
    .waitFor();
  stale.setFail();
  await stale.page.getByRole("button", { name: "Обновить очередь" }).click();
  await stale.page.locator(".reward-catalog").getByRole("alert").waitFor();
  assert.equal(
    await stale.page
      .getByRole("button", { name: "Подготовить выдачу" })
      .isDisabled(),
    true,
  );
  await capture(stale, "stale-390.png");
  await stale.context.close();
  scenarios++;
  const paged = await fixture("paged");
  await paged.page
    .getByRole("button", { name: "Ещё заявки на выдачу" })
    .click();
  await paged.page.locator(".reward-row").nth(1).waitFor();
  assert.equal(await paged.page.locator(".reward-row").count(), 2);
  await paged.context.close();
  scenarios++;
  for (const [mode, width] of [
    ["cursor-invalid", 390],
    ["page-changed", 320],
    ["scope-lost", 360],
  ]) {
    const f = await fixture(mode, width);
    await f.page.getByRole("button", { name: "Ещё заявки на выдачу" }).click();
    if (mode === "scope-lost") {
      await f.page
        .getByText("Очередь выключена или полномочие недоступно.")
        .waitFor();
      assert.equal(await f.page.locator(".reward-row").count(), 0);
    } else {
      await f.page
        .getByText(/Очередь изменилась или страница устарела/)
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Подготовить выдачу", exact: true })
          .isEnabled(),
        false,
      );
      await capture(f, `${mode}-${width}.png`);
      await f.page
        .getByRole("button", { name: "Обновить очередь", exact: true })
        .focus();
      await f.page.keyboard.press("Enter");
      await f.page
        .getByText(/Согласованных чужих заявок на выдачу нет/)
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Ещё заявки на выдачу" })
          .count(),
        0,
      );
      assert.equal(
        await f.page.locator(".reward-catalog").getByRole("alert").count(),
        0,
      );
    }
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
  for (const mode of ["revoked", "session", "mutation-revoked"]) {
    const f = await fixture(mode);
    if (mode === "mutation-revoked") {
      await select(f);
      await confirm(f);
      await f.page
        .getByRole("button", { name: "Выдать поощрение", exact: true })
        .click();
    }
    await f.page
      .getByRole("heading", {
        name:
          mode === "session"
            ? "Не удалось подтвердить сессию"
            : "Доступ отозван",
      })
      .waitFor();
    await f.context.close();
    scenarios++;
  }
  const hidden = await fixture("no-permission");
  assert.equal(
    await hidden.page
      .getByRole("button", { name: "Выдача поощрений", exact: true })
      .count(),
    0,
  );
  await hidden.context.close();
  scenarios++;
  const owned = await fixture("owned", 320);
  await owned.page
    .locator(".reward-card-state", { hasText: "Уже получено" })
    .waitFor();
  assert.equal(
    await owned.page
      .getByRole("button", { name: "Получить", exact: true })
      .count(),
    0,
  );
  await owned.page.getByText(/^Получено$/).waitFor();
  await capture(owned, "owned-320.png");
  await owned.context.close();
  scenarios++;
  const keyboard = await fixture();
  await select(keyboard);
  await keyboard.page.getByLabel("Основание выдачи").focus();
  await keyboard.page.keyboard.type("Клавиатура");
  await keyboard.page.keyboard.press("Tab");
  await keyboard.page.keyboard.press("Space");
  assert.equal(await keyboard.page.getByRole("checkbox").isChecked(), true);
  await keyboard.page.keyboard.press("Tab");
  assert.equal(
    await keyboard.page
      .getByRole("button", { name: "Выдать поощрение", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await keyboard.context.close();
  scenarios++;
  for (const width of [320, 1280]) {
    const dual = await fixture("dual", width);
    const a = dual.page.getByRole("button", {
        name: "Решения по заявкам",
        exact: true,
      }),
      b = dual.page.getByRole("button", {
        name: "Выдача поощрений",
        exact: true,
      });
    await a.waitFor();
    await b.waitFor();
    const first = await a.boundingBox(),
      second = await b.boundingBox();
    assert.ok(
      width === 320
        ? second.y - (first.y + first.height) >= 12
        : second.x - (first.x + first.width) >= 12,
    );
    await capture(dual, `management-${width}.png`);
    await dual.context.close();
    scenarios++;
  }
  console.log(`Reward fulfillment browser checks: ${scenarios} passed`);
} finally {
  await browser.close();
}
