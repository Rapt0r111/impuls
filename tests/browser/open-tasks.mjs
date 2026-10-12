import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const actor = "a1111111-1111-4111-8111-111111111111";
const scope = { id: "b1111111-1111-4111-8111-111111111111", kind: "group" };
const openTask = (n, over = {}) => ({
  id: `c111111${n}-1111-4111-8111-111111111111`,
  title: `Свободная задача ${n}`,
  criteria: "Подготовить материалы и приложить ссылку.",
  priority: n === 1 ? "high" : "normal",
  dueAt: "2035-01-01T12:00:00.000Z",
  fundXp: 40,
  fundPoints: 12,
  version: 1,
  updatedAt: "2026-10-12T08:00:00.000Z",
  scope: { ...scope, name: "Учебная область" },
  ...over,
});
const claimed = (task) => ({
  ...task,
  status: "assigned",
  version: 2,
  ruleVersion: 1,
  latestReview: null,
  latestSubmission: null,
});
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
  page.on("dialog", (d) => d.accept());
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
        user: { id: actor, displayName: "Участник" },
        csrfToken: "synthetic",
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (r) => json(r, { permissions: [] }),
  );
  const tasks = [openTask(1), openTask(2)];
  await page.route(
    (url) => url.pathname === "/api/v1/tasks/open",
    (r) => json(r, { items: mode === "empty" ? [] : tasks }),
  );
  await page.route(
    (url) => /^\/api\/v1\/tasks\/[^/]+\/claim$/.test(url.pathname),
    (r) => {
      posts.push({
        key: r.request().headers()["idempotency-key"],
        csrf: r.request().headers()["x-csrf-token"],
        body: JSON.parse(r.request().postData()),
        url: r.request().url(),
      });
      if (mode === "taken")
        return json(r, { code: "TASK_CONFLICT", message: "x" }, 409);
      return json(r, { task: claimed(tasks[0]) });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/tasks/${tasks[0].id}`,
    (r) => json(r, { task: claimed(tasks[0]) }),
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  return { page, context, errors, posts, tasks };
}

for (const width of [320, 360, 390]) {
  const { page, context, errors, posts, tasks } = await open(width);
  // With no assigned tasks the free ones are shown at once, with a way back.
  await page
    .getByRole("button", { name: "Свободные задачи: вернуться к моим задачам" })
    .waitFor();
  await page.getByText("Свободная задача 1").waitFor();
  assert.equal(await page.getByRole("button", { name: "Взять" }).count(), 2);
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= width,
    `horizontal overflow at ${width}`,
  );
  // The way back shows the usual sections and a banner that returns here.
  await page
    .getByRole("button", { name: "Свободные задачи: вернуться к моим задачам" })
    .click();
  await page.getByRole("button", { name: /Активные/ }).waitFor();
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= width,
    `horizontal overflow with banner at ${width}`,
  );
  await page.getByRole("button", { name: /Свободные задачи/ }).click();
  await page.getByText("Свободная задача 1").waitFor();
  await page.getByRole("button", { name: "Взять" }).first().click();
  await page.getByRole("heading", { name: "Свободная задача 1" }).waitFor();
  assert.equal(posts.length, 1);
  assert.match(posts[0].key, /^[0-9a-f-]{36}$/);
  assert.equal(posts[0].csrf, "synthetic");
  assert.deepEqual(posts[0].body, { action: "claim", expectedVersion: 1 });
  assert.ok(posts[0].url.endsWith(`/api/v1/tasks/${tasks[0].id}/claim`));
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  const { page, context, posts } = await open(390, "taken");
  await page.getByRole("button", { name: "Взять" }).first().click();
  await page
    .getByRole("alert")
    .getByText(/уже взяли или она изменилась/)
    .waitFor();
  assert.equal(posts.length, 1);
  // The list stays and offers the task again after the refresh.
  assert.equal(await page.getByRole("button", { name: "Взять" }).count(), 2);
  await context.close();
  scenarios++;
}

{
  const { page, context } = await open(390, "empty");
  await page.getByRole("button", { name: /Активные/ }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /Свободные/ }).count(),
    0,
  );
  await context.close();
  scenarios++;
}

await browser.close();
console.log(JSON.stringify({ scenarios, result: "passed" }));
