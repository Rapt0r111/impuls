import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const at = "2026-10-06T10:00:00.000Z";
const task = {
  id: "c1111111-1111-4111-8111-111111111111",
  title: "Новая задача из реального времени",
  status: "assigned",
  priority: "normal",
  dueAt: "2099-10-07T10:00:00.000Z",
  fundXp: 10,
  fundPoints: 5,
  ruleVersion: 1,
  version: 1,
  updatedAt: at,
};
const browser = await chromium.launch();
let scenarios = 0;

async function open({ platform, withTask }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.clock.install();
  const calls = { fullscreen: 0, swipes: 0 };
  await page.exposeFunction("__count", (name) => {
    calls[name] += 1;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (r, body) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const state = { tasks: [] };
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: `window.Telegram={WebApp:{platform:${JSON.stringify(platform)},isVersionAtLeast(){return true},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},requestFullscreen(){window.__count('fullscreen')},disableVerticalSwipes(){window.__count('swipes')}}}`,
    }),
  );
  await page.route(
    (u) => u.pathname.startsWith("/api/v1/"),
    (r) => {
      const p = new URL(r.request().url()).pathname;
      if (p === "/api/v1/me")
        return json(r, {
          user: {
            id: "a1111111-1111-4111-8111-111111111111",
            displayName: "Участник",
          },
          csrfToken: "x",
        });
      if (p === "/api/v1/me/permissions") return json(r, { permissions: [] });
      if (p === "/api/v1/me/profile")
        return json(r, {
          mode: "synthetic",
          user: {
            id: "a1111111-1111-4111-8111-111111111111",
            displayName: "Участник",
          },
          balance: {
            lifetimeXp: 0,
            availablePoints: 0,
            reservedPoints: 0,
            version: 1,
            updatedAt: at,
          },
          progression: {
            state: "unconfigured",
            ruleVersion: null,
            level: null,
          },
          firstResult: null,
          asOf: at,
        });
      if (p === "/api/v1/tasks")
        return json(r, { items: state.tasks, nextCursor: null });
      if (p === "/api/v1/tasks/open") return json(r, { items: [] });
      if (p === "/api/v1/leaderboard")
        return json(r, {
          mode: "synthetic",
          timeZone: "Europe/Moscow",
          season: "2026-10",
          scopes: [],
          scope: null,
          self: null,
          items: [],
          nextCursor: null,
          revision: null,
          updatedAt: at,
        });
      return r.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"code":"TEST"}',
      });
    },
  );
  state.tasks = withTask ? [task] : [];
  await page.goto(origin);
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  return { page, context, state, calls, errors };
}

{
  // A task assigned while the screen is open shows up without reloading.
  const { page, context, state, errors } = await open({ platform: "ios" });
  // Без задач на «Главной» нет карточки срока и кнопок.
  await page.getByLabel("Доступно баллов").waitFor();
  assert.equal(await page.getByText("Ближайший срок").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Открыть задачу" }).count(),
    0,
  );
  state.tasks = [task];
  await page.clock.fastForward(16_000);
  await page.getByText(task.title).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Открыть задачу" }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  // The same on the task list screen.
  const { page, context, state } = await open({ platform: "android" });
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await page.getByText("Задач в работе нет.", { exact: false }).waitFor();
  state.tasks = [task];
  await page.clock.fastForward(16_000);
  await page.getByText(task.title).waitFor();
  await context.close();
  scenarios++;
}

for (const [platform, expected] of [
  ["ios", 1],
  ["android", 1],
  ["tdesktop", 0],
  ["weba", 0],
]) {
  const { page, context, calls } = await open({ platform });
  await page.waitForTimeout(100);
  assert.equal(calls.fullscreen, expected, `fullscreen on ${platform}`);
  assert.equal(calls.swipes, 1, `vertical swipes disabled on ${platform}`);
  await context.close();
  scenarios++;
}

await browser.close();
console.log(JSON.stringify({ scenarios, result: "passed" }));
