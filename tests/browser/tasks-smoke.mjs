import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { mockHomeFallback } from "./home-fallback.mjs";

const taskId = "33333333-3333-4333-8333-333333333333";
const task = {
  id: taskId,
  title: "Синтетическая задача с длинным названием для проверки переноса",
  status: "assigned",
  priority: "normal",
  dueAt: "2026-10-10T12:00:00.000Z",
  fundXp: 0,
  fundPoints: 0,
  ruleVersion: 1,
  version: 1,
  updatedAt: "2026-09-29T12:00:00.000Z",
};

async function mockSession(page) {
  await mockHomeFallback(page);
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: 'window.Telegram={WebApp:{initData:"",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            displayName: "Синтетический участник с длинным именем",
          },
          csrfToken: "synthetic-token",
        }),
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/me/permissions",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"permissions":[]}',
      }),
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  await mkdir("apps/app/.impeccable/review", { recursive: true });
  try {
    for (const width of [320, 360, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 740 } });
      await mockSession(page);
      await page.route(
        (url) => url.pathname === "/api/v1/tasks",
        (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ items: [task], nextCursor: null }),
          }),
      );
      await page.route(
        (url) => url.pathname === `/api/v1/tasks/${taskId}`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              task: {
                ...task,
                criteria:
                  "Подтвердить результат по синтетическим критериям. Текст должен переноситься на узком экране.",
                latestSubmission: null,
                scope: {
                  id: "22222222-2222-4222-8222-222222222222",
                  kind: "project",
                  name: "Синтетический проект с длинным названием",
                },
              },
            }),
          }),
      );
      await page.goto(process.env.TEST_APP_ORIGIN ?? "http://localhost:3000", {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("button", { name: "Мои задачи", exact: true })
        .click();
      await page.getByRole("heading", { name: "Назначенные задачи" }).waitFor();
      await page.getByText(task.title).click();
      await page.getByText("Подтвердить результат", { exact: false }).waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      if (overflow) throw new Error(`Horizontal overflow at ${width}px`);
      await page.screenshot({
        path: `apps/app/.impeccable/review/task-list-${width}.png`,
        fullPage: true,
      });
      await page.close();
    }

    const empty = await browser.newPage({
      viewport: { width: 320, height: 740 },
    });
    await mockSession(empty);
    await empty.route(
      (url) => url.pathname === "/api/v1/tasks",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: '{"items":[],"nextCursor":null}',
        }),
    );
    await empty.goto(process.env.TEST_APP_ORIGIN ?? "http://localhost:3000", {
      waitUntil: "domcontentloaded",
    });
    await empty
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await empty.getByText("По выбранному статусу задач нет.").waitFor();
    await empty.close();

    const unavailable = await browser.newPage({
      viewport: { width: 320, height: 740 },
    });
    await mockSession(unavailable);
    await unavailable.route(
      (url) => url.pathname === "/api/v1/tasks",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"code":"UNAVAILABLE"}',
        }),
    );
    await unavailable.goto(
      process.env.TEST_APP_ORIGIN ?? "http://localhost:3000",
      {
        waitUntil: "domcontentloaded",
      },
    );
    await unavailable
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await unavailable
      .getByText("Не удалось загрузить задачи. Повторите попытку.")
      .waitFor();
    await unavailable
      .getByRole("button", { name: "Повторить загрузку" })
      .waitFor();
    await unavailable.close();

    const revoked = await browser.newPage({
      viewport: { width: 320, height: 740 },
    });
    await mockSession(revoked);
    await revoked.route(
      (url) => url.pathname === "/api/v1/tasks",
      (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.has("cursor")) {
          return route.fulfill({
            status: 403,
            contentType: "application/json",
            body: '{"code":"ACCESS_REVOKED"}',
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [task], nextCursor: taskId }),
        });
      },
    );
    await revoked.goto(process.env.TEST_APP_ORIGIN ?? "http://localhost:3000", {
      waitUntil: "domcontentloaded",
    });
    await revoked
      .getByRole("button", { name: "Мои задачи", exact: true })
      .click();
    await revoked.getByText(task.title).waitFor();
    await revoked.getByRole("button", { name: "Показать ещё" }).click();
    await revoked.getByRole("heading", { name: "Доступ отозван" }).waitFor();
    await revoked.getByText(task.title).waitFor({ state: "detached" });
    await revoked.close();
    console.log(
      "Tasks: 320/360/390px list and detail, empty, 503, and revoked-access states passed",
    );
  } finally {
    await browser.close();
  }
}

await main();
