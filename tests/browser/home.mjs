import assert from "node:assert/strict";
import { chromium } from "playwright";
import { homeFallbackProfile, mockHomeFallback } from "./home-fallback.mjs";
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const id = homeFallbackProfile.user.id;
const season = {
  mode: "synthetic",
  timeZone: "Europe/Moscow",
  season: "2026-10",
  scopes: [],
  scope: null,
  self: { xp: 75, rank: 2 },
  items: [],
  nextCursor: null,
  revision: null,
  updatedAt: homeFallbackProfile.asOf,
};
const browser = await chromium.launch();
let scenarios = 0;

const network = { down: false };
async function open(leaderboardStatus, width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}",
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me",
    (route) =>
      json(route, {
        user: { id, displayName: "Участник" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (route) => json(route, { permissions: [] }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/profile",
    (route) =>
      network.down ? route.abort("internetdisconnected") : route.fallback(),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/leaderboard",
    (route) =>
      leaderboardStatus === 200
        ? json(route, season)
        : json(route, { code: "TEST" }, leaderboardStatus),
  );
  await page.goto(origin);
  if (leaderboardStatus !== 403)
    await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  return { context, page, errors };
}

for (const width of [320, 390]) {
  const { context, page, errors } = await open(200, width);
  await page.getByText("XP за 2026-10", { exact: true }).waitFor();
  assert.equal(await page.getByText("75", { exact: true }).count(), 1);
  assert.match(
    (await page.getByText(/^Данные на /).textContent()) ?? "",
    /\d{2}:\d{2}$/,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    `горизонтальная прокрутка на ${width} px`,
  );
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  const { context, page, errors } = await open(404);
  await page.getByText(/^Данные на /).waitFor();
  assert.equal(await page.getByText(/^XP за \d{4}-\d{2}$/).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  const { context, page } = await open(403);
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor({
    state: "detached",
  });
  assert.equal(await page.getByText(/^Данные на /).count(), 0);
  await context.close();
  scenarios++;
}

{
  network.down = false;
  const { context, page, errors } = await open(200);
  await page.getByText(/^Данные на /).waitFor();
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor({
    state: "detached",
  });
  network.down = true;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Нет соединения" });
  await alert.waitFor();
  assert.match(
    (await alert.textContent()) ?? "",
    /Показаны данные на .+\d{2}:\d{2}/,
  );
  await page.getByText("XP за 2026-10", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => Object.keys(localStorage).length),
    0,
    "рабочие данные не хранятся в localStorage",
  );
  network.down = false;
  await context.setOffline(false);
  await alert.getByRole("button", { name: "Повторить" }).click();
  await alert.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

await browser.close();
console.log(`Home browser checks passed: ${scenarios} scenarios`);
