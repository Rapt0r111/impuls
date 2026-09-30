import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const origin = "http://127.0.0.1:3215";
let output = "";
const server = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    "3215",
  ],
  {
    cwd: new URL("../../apps/app/", import.meta.url),
    env: {
      ...process.env,
      CSRF_SECRET: "",
      APP_ORIGIN: "",
      TELEGRAM_BOT_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
server.stdout.on("data", (data) => (output += data));
server.stderr.on("data", (data) => (output += data));

let browser;
try {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      await fetch(origin);
      break;
    } catch {
      if (i === 59) throw new Error("Server did not start");
      await pause(250);
    }
  }
  browser = await chromium.launch({ headless: true });
  for (const blocked of [false, true]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.Telegram={WebApp:{initData:'',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};",
      }),
    );
    await page.route("**/api/v1/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"code":"UNAUTHORIZED"}',
      }),
    );
    await page.route("**/_vercel/speed-insights/script.js", (route) =>
      blocked
        ? route.abort()
        : route.fulfill({
            contentType: "application/javascript",
            body: "window.syntheticSpeedScriptLoaded=true;",
          }),
    );
    await page.goto(
      `${origin}/?report=synthetic-secret#tgWebAppData=synthetic-launch`,
    );
    await page
      .getByRole("heading", { name: "Нет данных запуска Telegram" })
      .waitFor();
    await page.waitForFunction(() =>
      window.siq?.some(([action]) => action === "beforeSend"),
    );
    const event = await page.evaluate(() => {
      const callback = window.siq.find(
        ([action]) => action === "beforeSend",
      )[1];
      return callback({
        type: "vital",
        url: location.href,
        route: "/secret-id",
      });
    });
    assert.deepEqual(event, { type: "vital", url: `${origin}/`, route: "/" });
    if (!blocked) {
      await page.waitForFunction(
        () => window.syntheticSpeedScriptLoaded === true,
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `SDK ${blocked ? "blocked" : "loaded"}: UI works, URL redacted`,
    );
  }

  const response = await fetch(`${origin}/api/v1/me?report=synthetic-secret`);
  assert.equal(response.status, 503);
  const body = await response.json();
  for (let i = 0; i < 20 && !output.includes(body.requestId); i++)
    await pause(25);
  const log = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .find((entry) => entry.requestId === body.requestId);
  assert.deepEqual(log, {
    level: "error",
    event: "api_error",
    requestId: body.requestId,
    status: 503,
  });
  assert.ok(!output.includes("synthetic-secret"));
  console.log(
    "503: response and sanitized server log have matching request IDs",
  );
} finally {
  await browser?.close();
  server.kill();
}
