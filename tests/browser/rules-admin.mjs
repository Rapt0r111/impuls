import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const actor = "a1111111-1111-4111-8111-111111111111";
const scope = "b1111111-1111-4111-8111-111111111111";
const rules = {
  current: {
    versionNumber: 3,
    effectiveFrom: "2026-10-10T14:23:00.000Z",
    timeZone: "Europe/Moscow",
    acceptanceEnabled: true,
    minPercent: 50,
    bonuses: [
      { code: "plus_10", title: "Бонус +10 %", percent: 10 },
      { code: "plus_25", title: "Бонус +25 %", percent: 25 },
    ],
    levelThresholds: null,
    openTaskLimit: null,
    legacyOptions: false,
  },
  history: [
    {
      versionNumber: 3,
      effectiveFrom: "2026-10-10T14:23:00.000Z",
      publishedBy: "Владелец",
      reason: "Правила пилота",
    },
  ],
};
const browser = await chromium.launch();
let scenarios = 0;

async function open(width, mode = "ok") {
  const context = await browser.newContext({
    viewport: { width, height: 850 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  const posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (r, body, status = 200) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me",
    (r) =>
      json(r, {
        user: { id: actor, displayName: "Владелец" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (r) =>
      json(r, {
        permissions: [
          {
            action: "admin.rules",
            scope: { id: scope, kind: "group", name: "Учебная область" },
            validUntil: null,
          },
        ],
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/admin/rules",
    async (r) => {
      if (r.request().method() === "POST") {
        posts.push({
          key: r.request().headers()["idempotency-key"],
          csrf: r.request().headers()["x-csrf-token"],
          body: JSON.parse(r.request().postData()),
        });
        if (mode === "rejected")
          return json(r, { code: "RULES_UNAVAILABLE", message: "x" }, 404);
        return json(
          r,
          {
            versionNumber: 4,
            publicationId: "d1111111-1111-4111-8111-111111111111",
            publishedAt: "2026-10-11T12:00:00.000Z",
          },
          201,
        );
      }
      return mode === "disabled"
        ? json(r, { code: "RULES_UNAVAILABLE", message: "x" }, 404)
        : json(r, rules);
    },
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: /Настройки начислений/ }).click();
  return { page, context, errors, posts };
}

for (const width of [320, 360, 390]) {
  const { page, context, errors, posts } = await open(width);
  await page.getByRole("heading", { name: "Настройки начислений" }).waitFor();
  await page.getByRole("heading", { name: "Кто и когда менял" }).waitFor();
  // No version numbers anywhere on the screen.
  assert.equal(await page.getByText(/верси/i).count(), 0);
  // Fields are filled with the current settings.
  // The month time zone is fixed by the owner (P-04) and not shown.
  assert.equal(await page.getByLabel("Часовой пояс расчёта месяца").count(), 0);
  assert.equal(
    await page.getByLabel("Название бонуса 2").inputValue(),
    "Бонус +25 %",
  );
  assert.equal(await page.getByLabel(/Пороги уровней/).inputValue(), "");
  // No horizontal scroll at narrow widths.
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= width,
    `horizontal overflow at ${width}`,
  );
  // Invalid thresholds are refused before any request.
  await page.getByLabel(/Пороги уровней/).fill("5, 10");
  await page.getByLabel("Что меняете и почему").fill("Пороги уровней");
  await page.getByRole("button", { name: "Проверить изменения" }).click();
  assert.ok(await page.getByText(/Проверьте поля/).isVisible());
  assert.equal(posts.length, 0);
  // Nothing changed: no request and no preview.
  await page.getByLabel(/Пороги уровней/).fill("");
  await page.getByRole("button", { name: "Проверить изменения" }).click();
  await page.getByText("Вы ничего не изменили.").waitFor();
  assert.equal(posts.length, 0);
  // Valid change: the preview lists only what changes, then save once.
  await page.getByLabel(/Пороги уровней/).fill("0, 100, 250");
  // The free-task limit is off by default and appears with its checkbox.
  assert.equal(await page.getByLabel(/Не больше незавершённых/).count(), 0);
  await page.getByLabel(/Ограничить число взятых задач/).check();
  await page.getByLabel(/Не больше незавершённых/).fill("3");
  await page.getByRole("button", { name: "Проверить изменения" }).click();
  await page.getByRole("heading", { name: "Проверьте изменения" }).waitFor();
  assert.ok(
    await page
      .getByText("Предел взятых свободных задач: без предела → 3")
      .isVisible(),
  );
  assert.ok(
    await page
      .getByText("Пороги уровней, XP: не настроены → 0, 100, 250")
      .isVisible(),
  );
  assert.equal(await page.getByText(/Часовой пояс месяца:/).count(), 0);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByText("Настройки сохранены.").waitFor();
  assert.equal(posts.length, 1);
  assert.match(posts[0].key, /^[0-9a-f-]{36}$/);
  assert.equal(posts[0].csrf, "synthetic");
  assert.deepEqual(posts[0].body.levelThresholds, [0, 100, 250]);
  assert.equal(posts[0].body.minPercent, 50);
  assert.equal(posts[0].body.openTaskLimit, 3);
  assert.deepEqual(
    posts[0].body.bonuses.map((b) => [b.code, b.percent]),
    [
      ["plus_10", 10],
      ["plus_25", 25],
    ],
  );
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  const { page, context } = await open(390, "disabled");
  await page
    .getByText("Изменение настроек выключено или недоступно.")
    .waitFor();
  await context.close();
  scenarios++;
}
{
  const { page, context, posts } = await open(390, "rejected");
  await page.getByLabel(/Пороги уровней/).fill("0, 100");
  await page.getByLabel("Что меняете и почему").fill("Проверка отказа");
  await page.getByRole("button", { name: "Проверить изменения" }).click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page
    .getByRole("alert")
    .getByText(/Сохранение отклонено/)
    .waitFor();
  assert.equal(posts.length, 1);
  assert.ok(
    await page
      .getByRole("button", { name: "Повторить тот же запрос" })
      .isDisabled(),
  );
  await context.close();
  scenarios++;
}
await browser.close();
console.log(JSON.stringify({ scenarios, result: "passed" }));
