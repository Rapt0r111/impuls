import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "reward-decisions",
  );
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
let scenarios = 0;
const id = "11111111-1111-4111-8111-111111111111",
  owner = "21111111-1111-4111-8111-111111111111",
  at = "2026-10-03T10:00:00.000Z",
  scope = { id, name: "Тестовая область решения" };
const redemption = {
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
  status: "pending",
  cancellationReason: null,
  decision: null,
  version: 1,
  createdAt: at,
  updatedAt: at,
};
const balance = {
  lifetimeXp: 300,
  availablePoints: 90,
  reservedPoints: 30,
  version: 1,
  updatedAt: at,
};
async function fixture(mode = "populated", width = 390) {
  const context = await browser.newContext({
      viewport: { width, height: 950 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let fail = false,
    cursorRejected = false,
    done = false,
    attempt = 0;
  const json = (r, body, status = 200, headers = {}) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
      headers,
    });
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
        user: { id, displayName: "Тестовый уполномоченный" },
        csrfToken: "synthetic",
      });
    if (p === "/api/v1/me/permissions")
      return json(r, {
        permissions:
          mode === "no-permission"
            ? []
            : [
                {
                  action: "reward.decide",
                  scope: { ...scope, kind: "project" },
                  validUntil: null,
                },
              ],
      });
    if (p === "/api/v1/tasks") return json(r, { items: [], nextCursor: null });
    if (p === "/api/v1/rewards")
      return json(r, {
        mode: "synthetic",
        scopes: [],
        scope: null,
        balance,
        items: [],
        nextCursor: null,
        updatedAt: at,
      });
    if (p === "/api/v1/me/redemptions")
      return json(r, {
        mode: "synthetic",
        items: [],
        nextCursor: null,
        updatedAt: at,
      });
    if (p === "/api/v1/redemptions/review") {
      if (mode === "loading")
        await new Promise((resolve) => setTimeout(resolve, 800));
      if (fail || ["disabled", "error", "revoked", "session"].includes(mode))
        return json(
          r,
          { code: "TEST" },
          fail || mode === "error"
            ? 503
            : mode === "disabled"
              ? 404
              : mode === "revoked"
                ? 403
                : 401,
        );
      const item = {
        redemption: {
          ...redemption,
          ...(mode.startsWith("expiry")
            ? { expiresAt: "2026-10-03T11:00:00.000Z" }
            : {}),
          ...(mode === "long"
            ? {
                title:
                  "Косметический_знак_исследователя_с_очень_длинным_названием_без_пробелов",
                conditions: redemption.conditions.repeat(4),
              }
            : {}),
        },
        recipient: {
          id: owner,
          displayName:
            mode === "long"
              ? "Синтетический_получатель_с_длинным_именем_без_пробелов"
              : "Синтетический получатель",
        },
      };
      const page2 = new URL(r.request().url()).searchParams.has("cursor");
      if (
        page2 &&
        ["cursor-invalid", "page-changed", "scope-lost"].includes(mode)
      ) {
        cursorRejected = true;
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
            : page2
              ? [{ ...item, redemption: { ...item.redemption, id: owner } }]
              : [item],
        nextCursor:
          ["paged", "cursor-invalid", "page-changed", "scope-lost"].includes(
            mode,
          ) &&
          !page2 &&
          !cursorRejected
            ? `${id}|${scope.id}|decide|${id}`
            : null,
        updatedAt: at,
      });
    }
    if (p.endsWith("/decide")) {
      posts.push({
        body: r.request().postData(),
        key: r.request().headers()["idempotency-key"],
      });
      attempt++;
      if ((mode === "unknown" || mode === "expiry-unknown") && attempt === 1)
        return json(r, { code: "UNAVAILABLE" }, 503);
      if (mode === "rate" && attempt === 1)
        return json(r, { code: "LIMIT" }, 429, { "retry-after": "7" });
      if (mode === "lost" && attempt === 1) return r.abort("failed");
      if (mode === "conflict" || mode === "expiry-premature")
        return json(
          r,
          {
            code:
              mode === "expiry-premature"
                ? "RESERVATION_NOT_DUE"
                : "REWARD_CONFLICT",
            message: "Test conflict",
            requestId: id,
            currentVersion: 2,
          },
          409,
        );
      if (mode === "mutation-revoked")
        return json(r, { code: "ACCESS_REVOKED" }, 403);
      done = true;
      const b = JSON.parse(r.request().postData());
      return json(r, {
        mode: "synthetic",
        redemption: {
          ...redemption,
          status:
            b.decision === "approve"
              ? "approved"
              : b.decision === "expire"
                ? "expired"
                : "rejected",
          ...(mode.startsWith("expiry")
            ? { expiresAt: "2026-10-03T11:00:00.000Z" }
            : {}),
          version: 2,
          decision: {
            actorId: id,
            displayName: "Тестовый уполномоченный",
            reason: b.reason,
            decidedAt: at,
          },
        },
      });
    }
    return json(r, { code: "NOT_FOUND" }, 404);
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Поощрения", exact: true }).click();
  if (mode !== "no-permission")
    await page
      .getByRole("button", { name: "Решения по заявкам", exact: true })
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
    .getByRole("button", { name: "Рассмотреть заявку", exact: true })
    .first()
    .click();
  await f.page.getByRole("heading", { name: "Подтвердите решение" }).waitFor();
}
async function confirm(f) {
  await f.page
    .getByLabel("Причина решения", { exact: true })
    .fill("Проверены тестовые условия");
  await f.page.getByRole("checkbox").check();
}
async function capture(f, name) {
  await f.page.evaluate(() => window.scrollTo(0, 0));
  await f.page.screenshot({ path: path.join(dir, name), fullPage: true });
  await f.page
    .locator(".reward-catalog")
    .screenshot({ path: path.join(dir, `target-${name}`) });
  assert.equal(
    await f.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
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
  for (const width of [320, 360, 390]) {
    const f = await fixture("expiry", width);
    await select(f);
    await f.page.getByLabel("Решение", { exact: true }).selectOption("expire");
    await confirm(f);
    await f.page.getByText(/Достижение срока проверяет сервер/).waitFor();
    await capture(f, `expiry-${width}.png`);
    const button = f.page.getByRole("button", {
      name: "Завершить резерв",
      exact: true,
    });
    await button.focus();
    await f.page.keyboard.press("Enter");
    await f.page.getByText(/Резерв завершён по истечению срока/).waitFor();
    assert.equal(JSON.parse(f.posts[0].body).decision, "expire");
    await close(f);
  }
  for (const mode of ["expiry-premature", "expiry-unknown"]) {
    const f = await fixture(mode, 320);
    await select(f);
    await f.page.getByLabel("Решение", { exact: true }).selectOption("expire");
    await confirm(f);
    await f.page
      .getByRole("button", { name: "Завершить резерв", exact: true })
      .click();
    if (mode === "expiry-premature") {
      await f.page
        .getByText(/Срок резерва не задан или ещё не достигнут/)
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Завершить резерв", exact: true })
          .isDisabled(),
        true,
      );
    } else {
      await f.page
        .getByRole("button", { name: "Повторить то же решение", exact: true })
        .click();
      await f.page.getByText(/Резерв завершён по истечению срока/).waitFor();
      assert.deepEqual(f.posts[0], f.posts[1]);
    }
    await close(f);
  }
  for (const width of [320, 360, 390, 1280]) {
    const f = await fixture("populated", width);
    await f.page.getByRole("button", { name: "Рассмотреть заявку" }).waitFor();
    await capture(f, `list-${width}.png`);
    await select(f);
    await confirm(f);
    await capture(f, `form-${width}.png`);
    const button = f.page.getByRole("button", {
      name: "Одобрить заявку",
      exact: true,
    });
    const box = await button.boundingBox();
    assert.ok(box.height >= 44);
    const returnBox = await f.page
      .getByRole("button", { name: "Вернуться к очереди", exact: true })
      .boundingBox();
    const actionGap = returnBox.y - (box.y + box.height);
    assert.ok(actionGap >= 10 && actionGap <= 13);
    await button.focus();
    await f.page.keyboard.press("Tab");
    await f.page.keyboard.press("Shift+Tab");
    assert.equal(
      await button.evaluate((e) => getComputedStyle(e).outlineStyle),
      "solid",
    );
    await f.page.keyboard.press("Enter");
    await f.page.getByText(/Заявка одобрена/).waitFor();
    assert.equal(JSON.parse(f.posts[0].body).decision, "approve");
    await close(f);
  }
  for (const mode of ["empty", "no-scope", "disabled", "error"]) {
    const f = await fixture(mode, 320);
    await f.page
      .getByText(
        mode === "empty"
          ? /Ожидающих чужих заявок нет/
          : mode === "no-scope"
            ? /Для решений требуется отдельное/
            : mode === "disabled"
              ? /Очередь выключена/
              : /Не удалось обновить очередь/,
      )
      .waitFor();
    await capture(f, `${mode}-320.png`);
    await close(f);
  }
  {
    const f = await fixture("loading", 320);
    await f.page.getByText("Загружаем заявки…").waitFor();
    await f.page.getByRole("button", { name: "Рассмотреть заявку" }).waitFor();
    await close(f);
  }
  {
    const f = await fixture();
    await select(f);
    const submit = f.page.getByRole("button", {
      name: "Одобрить заявку",
      exact: true,
    });
    assert.equal(await submit.isEnabled(), false);
    assert.equal(
      await submit.evaluate((e) => getComputedStyle(e).opacity),
      "0.5",
    );
    const disabledBackground = await submit.evaluate(
      (e) => getComputedStyle(e).backgroundColor,
    );
    await submit.hover({ force: true });
    assert.equal(
      await submit.evaluate((e) => getComputedStyle(e).backgroundColor),
      disabledBackground,
    );
    await f.page.getByRole("checkbox").check();
    assert.equal(await submit.isEnabled(), false);
    await f.page.getByLabel("Причина решения").fill("Проверено");
    assert.equal(await f.page.getByRole("checkbox").isChecked(), false);
    await f.page.getByLabel("Решение", { exact: true }).selectOption("reject");
    await f.page.getByRole("checkbox").check();
    await f.page
      .getByRole("button", { name: "Отказать в заявке", exact: true })
      .click();
    await f.page.getByText(/Баллы и место в квоте возвращены/).waitFor();
    assert.equal(JSON.parse(f.posts[0].body).decision, "reject");
    await close(f);
  }
  for (const mode of ["unknown", "rate", "lost"]) {
    const f = await fixture(mode, 320);
    await select(f);
    await confirm(f);
    await f.page
      .getByRole("button", { name: "Одобрить заявку", exact: true })
      .click();
    const retry = f.page.getByRole("button", {
      name: "Повторить то же решение",
      exact: true,
    });
    await retry.waitFor();
    assert.equal(await f.page.getByLabel("Причина решения").isEnabled(), false);
    assert.equal(
      await f.page
        .getByRole("button", { name: "Вернуться к очереди", exact: true })
        .isEnabled(),
      false,
    );
    if (mode === "rate") await f.page.getByText(/через 7 секунд/).waitFor();
    await capture(f, `${mode}-320.png`);
    await retry.click();
    await f.page.getByText(/Заявка одобрена/).waitFor();
    assert.deepEqual(f.posts[0], f.posts[1]);
    await close(f);
  }
  {
    const f = await fixture("conflict", 320);
    await select(f);
    await confirm(f);
    await f.page
      .getByRole("button", { name: "Одобрить заявку", exact: true })
      .click();
    await f.page.getByText(/Решение не принято/).waitFor();
    assert.equal(await f.page.getByRole("checkbox").isChecked(), false);
    assert.equal(
      await f.page.getByLabel("Причина решения").inputValue(),
      "Проверены тестовые условия",
    );
    await capture(f, "conflict-320.png");
    f.page.once("dialog", (d) => d.accept());
    await f.page
      .getByRole("button", { name: "Вернуться к очереди", exact: true })
      .click();
    await select(f);
    assert.equal(await f.page.getByRole("checkbox").isChecked(), false);
    await close(f);
  }
  {
    const f = await fixture();
    await select(f);
    await f.page.getByLabel("Причина решения").fill("Не терять черновик");
    f.page.once("dialog", (d) => d.dismiss());
    await f.page
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    assert.equal(
      await f.page.getByLabel("Причина решения").inputValue(),
      "Не терять черновик",
    );
    await close(f);
  }
  {
    const f = await fixture();
    await f.page.getByRole("button", { name: "Рассмотреть заявку" }).waitFor();
    f.setFail();
    await f.page
      .getByRole("button", { name: "Обновить очередь", exact: true })
      .click();
    await f.page.getByText(/Показаны прежние данные/).waitFor();
    assert.equal(
      await f.page
        .getByRole("button", { name: "Рассмотреть заявку" })
        .isEnabled(),
      false,
    );
    await close(f);
  }
  {
    const f = await fixture("paged");
    await f.page.getByRole("button", { name: "Ещё заявки на решение" }).click();
    await f.page
      .getByRole("button", { name: "Рассмотреть заявку" })
      .nth(1)
      .waitFor();
    assert.equal(
      await f.page.getByRole("button", { name: "Рассмотреть заявку" }).count(),
      2,
    );
    await close(f);
  }
  for (const [mode, width] of [
    ["cursor-invalid", 320],
    ["page-changed", 360],
    ["scope-lost", 390],
  ]) {
    const f = await fixture(mode, width);
    await f.page.getByRole("button", { name: "Ещё заявки на решение" }).click();
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
          .getByRole("button", { name: "Рассмотреть заявку", exact: true })
          .isEnabled(),
        false,
      );
      await capture(f, `${mode}-${width}.png`);
      await f.page
        .getByRole("button", { name: "Обновить очередь", exact: true })
        .focus();
      await f.page.keyboard.press("Enter");
      await f.page
        .locator("button:enabled")
        .filter({ hasText: /^Рассмотреть заявку$/ })
        .waitFor();
      assert.equal(
        await f.page
          .getByRole("button", { name: "Рассмотреть заявку", exact: true })
          .isEnabled(),
        true,
      );
      assert.equal(
        await f.page
          .getByRole("button", { name: "Ещё заявки на решение" })
          .count(),
        0,
      );
      assert.equal(
        await f.page.locator(".reward-catalog").getByRole("alert").count(),
        0,
      );
    }
    await close(f);
  }
  {
    const f = await fixture("long", 320);
    await select(f);
    await f.page.addStyleTag({
      content:
        ".reward-catalog,.reward-catalog select,.reward-catalog textarea,.reward-catalog button {font-size:22px !important}",
    });
    await confirm(f);
    await capture(f, "large-text-320.png");
    await close(f);
  }
  {
    const f = await fixture("no-permission");
    assert.equal(
      await f.page
        .getByRole("button", { name: "Решения по заявкам", exact: true })
        .count(),
      0,
    );
    await close(f);
  }
  for (const mode of ["revoked", "session", "mutation-revoked"]) {
    const f = await fixture(mode);
    if (mode === "mutation-revoked") {
      await select(f);
      await confirm(f);
      await f.page
        .getByRole("button", { name: "Одобрить заявку", exact: true })
        .click();
    }
    await f.page
      .getByRole("heading", {
        name:
          mode === "session"
            ? "Не удалось подтвердить сессию"
            : "Доступ отозван",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await f.page
        .getByRole("heading", { name: "Подтвердите решение" })
        .count(),
      0,
    );
    await close(f);
  }
  console.log(
    JSON.stringify({
      suite: "reward-decisions",
      scenarios,
      screenshots: dir,
      result: "passed",
    }),
  );
} finally {
  await browser.close();
}
