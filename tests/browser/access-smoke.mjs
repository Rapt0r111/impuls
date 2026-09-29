import { chromium } from "playwright";

const appOrigin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    // Chromium blocks cross-origin loopback frames unless this local-only check is disabled.
    args: ["--disable-features=LocalNetworkAccessChecks"],
  });
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
    await bridgePage.goto(appOrigin, {
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
    console.log(
      "Late bridge and unsupported cosmetic methods: login attempted",
    );

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
    await apiPage.goto(appOrigin, {
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
          body: 'const launch=new URLSearchParams(location.hash.slice(1)).get("tgWebAppData")||"";window.Telegram={WebApp:{initData:launch,ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
    );
    await loginPage.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"UNAUTHORIZED"}',
      }),
    );
    let sentInitData;
    await loginPage.route("**/api/v1/me/permissions", (route) =>
      route.fulfill(
        route
          .request()
          .headers()
          .cookie?.includes("impuls_session=synthetic-session")
          ? {
              status: 200,
              contentType: "application/json",
              body: '{"permissions":[]}',
            }
          : {
              status: 401,
              contentType: "application/json",
              body: '{"code":"UNAUTHORIZED"}',
            },
      ),
    );
    await loginPage.route("**/api/v1/auth/telegram", (route) => {
      sentInitData = route.request().postDataJSON().initData;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Set-Cookie":
            "impuls_session=synthetic-session; Path=/; HttpOnly; Secure; SameSite=None; Partitioned",
        },
        body: JSON.stringify({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            displayName: "Тестовый участник",
          },
          csrfToken: "synthetic-token",
        }),
      });
    });
    await loginPage.goto(`${appOrigin}/#tgWebAppData=synthetic`, {
      waitUntil: "domcontentloaded",
    });
    await loginPage
      .getByRole("heading", { name: "Доступ подтверждён" })
      .waitFor({ timeout: 5_000 });
    await loginPage.getByText("Назначенных полномочий нет.").waitFor();
    if (sentInitData !== "synthetic") {
      throw new Error("Telegram initData was not sent to the login API");
    }
    await loginPage.close();
    console.log("Launch fragment and synthetic login: authorized state");

    const embeddedPage = await browser.newPage();
    await embeddedPage.route("http://127.0.0.1:3001/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<iframe title="Telegram Mini App" src="${appOrigin}"></iframe>`,
      }),
    );
    await embeddedPage.route(
      "https://telegram.org/js/telegram-web-app.js",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"synthetic",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
    );
    await embeddedPage.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"UNAUTHORIZED"}',
      }),
    );
    let embeddedLoginAttempts = 0;
    await embeddedPage.route("**/api/v1/auth/telegram", (route) => {
      embeddedLoginAttempts += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Set-Cookie":
            embeddedLoginAttempts === 1
              ? "impuls_session=embedded-session; Path=/; HttpOnly; Secure; SameSite=Lax"
              : "impuls_session=embedded-session; Path=/; HttpOnly; Secure; SameSite=None; Partitioned",
        },
        body: JSON.stringify({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            displayName: "Тестовый участник",
          },
          csrfToken: "synthetic-token",
        }),
      });
    });
    let embeddedCookieSeen = false;
    await embeddedPage.route("**/api/v1/me/permissions", (route) => {
      embeddedCookieSeen = Boolean(
        route
          .request()
          .headers()
          .cookie?.includes("impuls_session=embedded-session"),
      );
      return route.fulfill({
        status: embeddedCookieSeen ? 200 : 401,
        contentType: "application/json",
        body: embeddedCookieSeen
          ? '{"permissions":[]}'
          : '{"code":"UNAUTHORIZED"}',
      });
    });
    await embeddedPage.goto("http://127.0.0.1:3001", {
      waitUntil: "domcontentloaded",
    });
    await embeddedPage
      .frameLocator("iframe")
      .getByRole("heading", { name: "Не удалось подтвердить сессию" })
      .waitFor({ timeout: 5_000 });
    if (embeddedCookieSeen)
      throw new Error("Lax cookie unexpectedly crossed the iframe boundary");
    await embeddedPage
      .frameLocator("iframe")
      .getByRole("button", { name: "Повторить вход" })
      .click();
    await embeddedPage
      .frameLocator("iframe")
      .getByRole("heading", { name: "Доступ подтверждён" })
      .waitFor({ timeout: 5_000 });
    if (!embeddedCookieSeen)
      throw new Error(
        "Partitioned session cookie was not sent from the iframe",
      );
    await embeddedPage.close();
    console.log(
      "Cross-site iframe: Lax cookie blocked, partitioned cookie sent",
    );

    const missingSessionPage = await browser.newPage();
    await missingSessionPage.route(
      "https://telegram.org/js/telegram-web-app.js",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"synthetic",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
    );
    await missingSessionPage.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"UNAUTHORIZED"}',
      }),
    );
    await missingSessionPage.route("**/api/v1/auth/telegram", (route) =>
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
    await missingSessionPage.route("**/api/v1/me/permissions", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"UNAUTHORIZED"}',
      }),
    );
    await missingSessionPage.goto(appOrigin, {
      waitUntil: "domcontentloaded",
    });
    await missingSessionPage
      .getByRole("heading", { name: "Не удалось подтвердить сессию" })
      .waitFor({ timeout: 5_000 });
    if (
      await missingSessionPage
        .getByRole("heading", { name: "Нет данных запуска Telegram" })
        .count()
    ) {
      throw new Error(
        "A missing session was reported as missing Telegram data",
      );
    }
    await missingSessionPage
      .getByRole("button", { name: "Повторить вход" })
      .waitFor();
    await missingSessionPage.close();
    console.log("Missing session cookie after login: distinct retry state");

    const permissionsPage = await browser.newPage({
      viewport: { width: 320, height: 640 },
    });
    await permissionsPage.route(
      "https://telegram.org/js/telegram-web-app.js",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
    );
    await permissionsPage.route("**/api/v1/me", (route) =>
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
    await permissionsPage.route("**/api/v1/me/permissions", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          permissions: [
            {
              action: "task.review",
              scope: {
                id: "22222222-2222-4222-8222-222222222222",
                kind: "group",
                name: "Синтетическая группа с длинным названием",
              },
              validUntil: null,
            },
          ],
        }),
      }),
    );
    await permissionsPage.goto(appOrigin, {
      waitUntil: "domcontentloaded",
    });
    await permissionsPage.getByText("Проверка результатов").waitFor();
    await permissionsPage
      .getByText("Группа · Синтетическая группа с длинным названием")
      .waitFor();
    const hasOverflow = await permissionsPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (hasOverflow) throw new Error("Permissions panel overflows at 320 px");
    await permissionsPage.close();
    console.log(
      "Synthetic scoped permission: visible at 320 px without overflow",
    );

    const pendingMigrationPage = await browser.newPage();
    await pendingMigrationPage.route(
      "https://telegram.org/js/telegram-web-app.js",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
    );
    await pendingMigrationPage.route("**/api/v1/me", (route) =>
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
    await pendingMigrationPage.route("**/api/v1/me/permissions", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"code":"UNAVAILABLE"}',
      }),
    );
    await pendingMigrationPage.goto(appOrigin, {
      waitUntil: "domcontentloaded",
    });
    await pendingMigrationPage
      .getByRole("heading", { name: "Доступ подтверждён" })
      .waitFor();
    await pendingMigrationPage
      .getByText("Не удалось загрузить полномочия. Обновите проверку позже.")
      .waitFor();
    await pendingMigrationPage.close();
    console.log("Permissions API unavailable: access remains confirmed");

    const invalidPage = await browser.newPage();
    await invalidPage.route(
      "https://telegram.org/js/telegram-web-app.js",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: 'window.Telegram={WebApp:{initData:"synthetic",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        }),
    );
    await invalidPage.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"UNAUTHORIZED"}',
      }),
    );
    await invalidPage.route("**/api/v1/auth/telegram", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"AUTH_INVALID"}',
      }),
    );
    await invalidPage.goto(appOrigin, {
      waitUntil: "domcontentloaded",
    });
    await invalidPage
      .getByRole("heading", { name: "Не удалось подтвердить запуск" })
      .waitFor({ timeout: 5_000 });
    await invalidPage.close();
    console.log("Invalid signed launch: distinct error state");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
