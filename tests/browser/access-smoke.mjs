import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const bridgePage = await browser.newPage();
    await bridgePage.clock.install();
    let releaseScript;
    const scriptHeld = new Promise((resolve) => {
      releaseScript = resolve;
    });
    await bridgePage.route(
      "https://telegram.org/js/telegram-web-app.js",
      async (route) => {
        await scriptHeld;
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"synthetic",ready(){throw Error("unsupported")},expand(){throw Error("unsupported")},close(){},setHeaderColor(){throw Error("unsupported")},setBackgroundColor(){throw Error("unsupported")}}};',
        });
      },
    );
    await bridgePage.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"UNAUTHORIZED"}',
      }),
    );
    await bridgePage.route("**/api/v1/auth/telegram", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: '{"code":"ACCESS_DENIED"}',
      }),
    );
    await bridgePage.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    });
    await bridgePage.waitForFunction(() =>
      Boolean(document.querySelector('script[src*="telegram-web-app.js"]')),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await bridgePage.clock.fastForward(8_100);
    await bridgePage
      .getByRole("heading", { name: "Нет данных запуска Telegram" })
      .waitFor({ timeout: 5_000 });
    releaseScript();
    await bridgePage
      .getByRole("heading", { name: "Доступ не открыт" })
      .waitFor({ timeout: 5_000 });
    await bridgePage.close();
    console.log("Late bridge and unsupported cosmetic methods: login attempted");

    const apiPage = await browser.newPage();
    await apiPage.clock.install();
    await apiPage.route(
      "https://telegram.org/js/telegram-web-app.js",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
    );
    let releaseApi;
    const apiHeld = new Promise((resolve) => {
      releaseApi = resolve;
    });
    let requestStarted;
    const started = new Promise((resolve) => {
      requestStarted = resolve;
    });
    await apiPage.route("**/api/v1/me", async (route) => {
      requestStarted();
      await apiHeld;
      await route.abort();
    });
    await apiPage.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    });
    await started;
    await apiPage.clock.fastForward(10_100);
    await apiPage
      .getByRole("heading", { name: "Сервис недоступен" })
      .waitFor({ timeout: 5_000 });
    releaseApi();
    await apiPage.close();
    console.log("API timeout: unavailable state after 10 seconds");

    const loginPage = await browser.newPage();
    await loginPage.route(
      "https://telegram.org/js/telegram-web-app.js",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"synthetic",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
    );
    await loginPage.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"UNAUTHORIZED"}',
      }),
    );
    await loginPage.route("**/api/v1/auth/telegram", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            displayName: "Тестовый участник",
          },
          csrfToken: "synthetic-token",
        }),
      }),
    );
    await loginPage.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    });
    await loginPage
      .getByRole("heading", { name: "Доступ подтверждён" })
      .waitFor({ timeout: 5_000 });
    await loginPage.close();
    console.log("Bridge and synthetic login: authorized state");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
