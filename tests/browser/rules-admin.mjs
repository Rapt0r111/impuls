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
  await page.getByRole("button", { name: /Правила начислений/ }).click();
  return { page, context, errors, posts };
}

for (const width of [320, 360, 390]) {
  const { page, context, errors, posts } = await open(width);
  await page.getByRole("heading", { name: "Правила начислений" }).waitFor();
  await page.getByText(/Действует версия 3/).waitFor();
  // Fields are filled with the current version.
  assert.equal(
    await page.getByLabel("Часовой пояс расчёта месяца").inputValue(),
    "Europe/Moscow",
  );
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
  await page.getByLabel("Основание новой версии").fill("Пороги уровней");
  await page.getByRole("button", { name: "Проверить версию" }).click();
  assert.ok(await page.getByText(/Проверьте поля/).isVisible());
  assert.equal(posts.length, 0);
  // Valid change: preview, then publish once.
  await page.getByLabel(/Пороги уровней/).fill("0, 100, 250");
  await page.getByRole("button", { name: "Проверить версию" }).click();
  await page
    .getByRole("heading", { name: "Проверьте перед публикацией" })
    .waitFor();
  assert.ok(await page.getByText(/0, 100, 250/).isVisible());
  await page.getByRole("button", { name: "Опубликовать версию" }).click();
  await page.getByText("Опубликована версия 4.").waitFor();
  assert.equal(posts.length, 1);
  assert.match(posts[0].key, /^[0-9a-f-]{36}$/);
  assert.equal(posts[0].csrf, "synthetic");
  assert.deepEqual(posts[0].body.levelThresholds, [0, 100, 250]);
  assert.equal(posts[0].body.minPercent, 50);
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
    .getByText("Управление правилами выключено или недоступно.")
    .waitFor();
  await context.close();
  scenarios++;
}
{
  const { page, context, posts } = await open(390, "rejected");
  await page.getByLabel("Основание новой версии").fill("Проверка отказа");
  await page.getByRole("button", { name: "Проверить версию" }).click();
  await page.getByRole("button", { name: "Опубликовать версию" }).click();
  await page
    .getByRole("alert")
    .getByText(/Публикация отклонена/)
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
