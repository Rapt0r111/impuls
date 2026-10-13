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
  // Current settings in plain words, on a 100 XP example.
  await page.getByRole("heading", { name: "Как сейчас" }).waitFor();
  assert.ok(
    await page
      .getByText(
        "За задачу на 100 XP исполнитель получит от 50 до 100 XP — на выбор проверяющего.",
      )
      .isVisible(),
  );
  assert.ok(
    await page
      .getByText(
        "За отличную работу проверяющий может добавить +10 XP или +25 XP.",
      )
      .isVisible(),
  );
  // Fields are filled with the current settings.
  assert.equal(
    await page.getByLabel("Минимум, который получит исполнитель").inputValue(),
    "50",
  );
  assert.equal(await page.getByLabel("Бонус 2, %").inputValue(), "25");
  assert.equal(await page.getByLabel(/уровень — с XP/).count(), 0);
  // The rare acceptance switch and the comment are folded away.
  assert.equal(
    await page.getByLabel("Начислять XP и баллы при приёмке").isVisible(),
    false,
  );
  // No horizontal scroll at narrow widths.
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= width,
    `horizontal overflow at ${width}`,
  );
  // Invalid level thresholds are refused before any request.
  await page.getByRole("button", { name: "Добавить уровень" }).click();
  await page.getByLabel("2-й уровень — с XP").fill("0");
  await page.getByRole("button", { name: "Проверить изменения" }).click();
  assert.ok(await page.getByText(/Проверьте поля/).isVisible());
  assert.equal(posts.length, 0);
  // Nothing changed: no request and no preview.
  await page.getByRole("button", { name: "Убрать 2-й уровень" }).click();
  await page.getByRole("button", { name: "Проверить изменения" }).click();
  await page.getByText("Вы ничего не изменили.").waitFor();
  assert.equal(posts.length, 0);
  // Valid change: the preview lists only what changes, then save once.
  await page.getByRole("button", { name: "Добавить уровень" }).click();
  assert.equal(await page.getByLabel("2-й уровень — с XP").inputValue(), "100");
  await page.getByRole("button", { name: "Добавить уровень" }).click();
  await page.getByLabel("3-й уровень — с XP").fill("250");
  await page.getByLabel("Сколько можно держать одновременно").fill("3");
  await page.getByRole("button", { name: "Проверить изменения" }).click();
  await page.getByRole("heading", { name: "Проверьте изменения" }).waitFor();
  assert.ok(
    await page
      .getByText("Свободных задач на человека: без предела → не больше 3")
      .isVisible(),
  );
  assert.ok(
    await page
      .getByText("Уровни: не заданы → 2-й с 100 XP, 3-й с 250 XP")
      .isVisible(),
  );
  assert.equal(await page.getByText(/Часовой пояс месяца:/).count(), 0);
  assert.equal(await page.getByText(/Минимальная награда:/).count(), 0);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByText("Настройки сохранены.").waitFor();
  assert.equal(posts.length, 1);
  assert.match(posts[0].key, /^[0-9a-f-]{36}$/);
  assert.equal(posts[0].csrf, "synthetic");
  assert.deepEqual(posts[0].body.levelThresholds, [0, 100, 250]);
  assert.equal(posts[0].body.minPercent, 50);
  assert.equal(posts[0].body.openTaskLimit, 3);
  assert.equal(posts[0].body.reason, "Изменение настроек начислений");
  // Existing bonus titles are kept while their share is unchanged.
  assert.deepEqual(
    posts[0].body.bonuses.map((b) => [b.code, b.title, b.percent]),
    [
      ["plus_10", "Бонус +10 %", 10],
      ["plus_25", "Бонус +25 %", 25],
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
  await page.getByRole("button", { name: "Добавить уровень" }).click();
  await page.getByText("Дополнительно").click();
  await page.getByLabel("Комментарий для журнала").fill("Проверка отказа");
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
