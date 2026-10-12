import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const scope = {
  id: "b1111111-1111-4111-8111-111111111111",
  kind: "group",
  name: "Группа",
};
const browser = await chromium.launch();
let scenarios = 0;

async function open(width, reviewer) {
  const context = await browser.newContext({
    viewport: { width, height: 850 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const json = (r, body) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me",
    (r) =>
      json(r, {
        user: {
          id: "a1111111-1111-4111-8111-111111111111",
          displayName: "Участник",
        },
        csrfToken: "x",
      }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/me/permissions",
    (r) =>
      json(r, {
        permissions: reviewer
          ? [
              {
                action: "task.review",
                scope,
                validFrom: "2026-01-01T00:00:00.000Z",
                validUntil: null,
              },
            ]
          : [],
      }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/tasks",
    (r) => json(r, { items: [], nextCursor: null }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/tasks/open",
    (r) => json(r, { items: [] }),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/reviews",
    (r) => {
      requests.push(r.request().url());
      return json(r, { items: [], nextCursor: null });
    },
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  return { page, context, errors, requests };
}

for (const width of [320, 360, 390]) {
  // A reviewer sees the queue on Home, with the count, and can open it.
  const { page, context, errors } = await open(width, true);
  await page.getByRole("heading", { name: "Очередь проверки" }).waitFor();
  await page.getByText("Сейчас отчётов на проверке нет.").waitFor();
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= width,
    `horizontal overflow at ${width}`,
  );
  await page.getByRole("button", { name: "Открыть очередь" }).click();
  await page.locator("#reviews-title").waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  // Without the review right there is no card and no request for the queue.
  const { page, context, requests } = await open(390, false);
  await page.getByRole("heading", { name: "Главная" }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.getByText("Очередь проверки").count(), 0);
  assert.equal(requests.length, 0);
  await context.close();
  scenarios++;
}

await browser.close();
console.log(JSON.stringify({ scenarios, result: "passed" }));
