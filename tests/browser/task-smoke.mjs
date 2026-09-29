import { chromium } from "playwright";

const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3000";
const userId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const scopeId = "33333333-3333-4333-8333-333333333333";
const submissionId = "44444444-4444-4444-8444-444444444444";

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 750 },
    });
    let task = {
      id: taskId,
      scopeId,
      assignedTo: userId,
      currentSubmissionId: null,
      title: "Синтетическая исследовательская задача с длинным названием",
      criteria:
        "Опишите проверенный результат и приложите основание в тексте отчёта.",
      category: "Синтетическая",
      priority: "normal",
      dueAt: null,
      baseXp: 40,
      basePoints: 12,
      ruleSetVersion: 1,
      status: "assigned",
      version: 2,
      updatedAt: new Date().toISOString(),
    };
    let submission = null;
    const attemptedKeys = [];
    let submissionAttempts = 0;
    const fulfill = (route, body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: 'window.Telegram={WebApp:{initData:"",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
      }),
    );
    await page.route("**/api/v1/me", (route) =>
      fulfill(route, {
        user: { id: userId, displayName: "Тестовый участник" },
        csrfToken: "synthetic-token",
      }),
    );
    await page.route("**/api/v1/me/permissions", (route) =>
      fulfill(route, { permissions: [] }),
    );
    await page.route("**/api/v1/tasks", (route) =>
      fulfill(route, {
        tasks: [task],
        nextCursor: null,
        updatedAt: new Date().toISOString(),
      }),
    );
    await page.route("**/api/v1/tasks/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/start")) {
        task = {
          ...task,
          status: "in_progress",
          version: 3,
          updatedAt: new Date().toISOString(),
        };
        return fulfill(route, { task });
      }
      if (pathname.endsWith("/submissions")) {
        attemptedKeys.push(route.request().headers()["idempotency-key"]);
        submissionAttempts += 1;
        if (submissionAttempts === 1)
          return fulfill(
            route,
            {
              code: "UNAVAILABLE",
              message: "Temporary",
              requestId: crypto.randomUUID(),
            },
            503,
          );
        submission = {
          id: submissionId,
          report: "Синтетический отчёт",
          createdAt: new Date().toISOString(),
        };
        task = {
          ...task,
          status: "in_review",
          version: 4,
          currentSubmissionId: submissionId,
          updatedAt: new Date().toISOString(),
        };
        return fulfill(route, { task, submissionId }, 201);
      }
      return fulfill(route, { task, submission, returnReason: null });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Задачи" }).waitFor();
    await page
      .getByRole("button", { name: /Синтетическая исследовательская задача/ })
      .click();
    await page.getByRole("heading", { name: task.title }).waitFor();
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 750 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      if (overflow) throw new Error(`Horizontal overflow at ${width}px`);
    }
    await page.getByRole("button", { name: "Начать работу" }).click();
    await page.getByLabel("Отчёт о результате").fill("Синтетический отчёт");
    await page.getByRole("button", { name: "Отправить на проверку" }).click();
    await page
      .getByText(
        "Сервис временно недоступен. Текст сохранён; повторите действие.",
      )
      .waitFor();
    if (
      (await page.getByLabel("Отчёт о результате").inputValue()) !==
      "Синтетический отчёт"
    )
      throw new Error("Report text was lost after 503");
    await page.getByRole("button", { name: "Отправить на проверку" }).click();
    await page
      .getByText("Отчёт ожидает решения проверяющего.", { exact: false })
      .waitFor();
    if (attemptedKeys.length !== 2 || attemptedKeys[0] !== attemptedKeys[1])
      throw new Error("Retry used a different Idempotency-Key");
    await page.close();
    console.log(
      "Task UI: 320/360/390 px, start, report, 503 retry with stable key passed",
    );
  } finally {
    await browser.close();
  }
}

await main();
