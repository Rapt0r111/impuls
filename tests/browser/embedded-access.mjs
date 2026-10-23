import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import { createServer } from "node:https";
import { once } from "node:events";
import path from "node:path";
import { chromium } from "playwright";
import { NextResponse } from "next/server.js";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "../../apps/app/src/shared/server/session-cookie.ts";

const localOrigin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(localOrigin).hostname));
const fixtureRoot = path.resolve(".local/auth-browser");
mkdirSync(fixtureRoot, { recursive: true });
const tlsDirectory = mkdtempSync(path.join(fixtureRoot, "tls-"));
const keyPath = path.join(tlsDirectory, "key.pem");
const certPath = path.join(tlsDirectory, "cert.pem");
execFileSync(
  process.env.TEST_OPENSSL ??
    (process.platform === "win32"
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl"),
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=mini-app.test",
    "-keyout",
    keyPath,
    "-out",
    certPath,
  ],
  { stdio: "ignore", windowsHide: true },
);
const identity = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Тестовый участник",
  },
  csrfToken: "synthetic-csrf",
};
const token = "synthetic-session";
let options = SESSION_COOKIE_OPTIONS;
let logins = 0;
let logoutSeen = false;
let appOrigin;

function cookieHeader(value, maxAge) {
  const response = NextResponse.json({});
  response.cookies.set(SESSION_COOKIE, value, { ...options, maxAge });
  return response.headers.get("set-cookie");
}

const server = createServer(
  { key: readFileSync(keyPath), cert: readFileSync(certPath) },
  async (request, response) => {
    try {
      const hostname = request.headers.host.split(":")[0];
      const pathname = new URL(request.url, appOrigin).pathname;
      const authorized = request.headers.cookie?.includes(
        `${SESSION_COOKIE}=${token}`,
      );
      function json(status, body, headers = {}) {
        response.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...headers,
        });
        response.end(JSON.stringify(body));
      }
      if (hostname !== "mini-app.test") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<iframe title="Mini App" src="${appOrigin}"></iframe>`);
      } else if (pathname === "/fixture-bridge.js") {
        response.writeHead(200, { "Content-Type": "application/javascript" });
        response.end(
          'window.Telegram={WebApp:{initData:"synthetic",ready(){},expand(){},close(){},setHeaderColor(){},setBackgroundColor(){}}};',
        );
      } else if (pathname === "/api/v1/auth/telegram") {
        let body = "";
        for await (const chunk of request) body += chunk;
        assert.equal(JSON.parse(body).initData, "synthetic");
        logins++;
        json(200, identity, { "Set-Cookie": cookieHeader(token, 43_200) });
      } else if (pathname === "/api/v1/auth/logout") {
        assert.ok(authorized, "Logout must receive the session cookie");
        assert.equal(request.headers["x-csrf-token"], identity.csrfToken);
        logoutSeen = true;
        response.writeHead(204, { "Set-Cookie": cookieHeader("", 0) });
        response.end();
      } else if (
        pathname === "/api/v1/me" ||
        pathname === "/api/v1/me/permissions"
      ) {
        json(
          authorized ? 200 : 401,
          authorized
            ? pathname.endsWith("permissions")
              ? { permissions: [] }
              : identity
            : { code: "UNAUTHORIZED" },
        );
      } else if (pathname.startsWith("/api/")) {
        json(503, { code: "UNAVAILABLE" });
      } else {
        const upstream = await fetch(`${localOrigin}${request.url}`);
        const headers = {
          "Content-Type":
            upstream.headers.get("content-type") ?? "application/octet-stream",
        };
        response.writeHead(upstream.status, headers);
        if (headers["Content-Type"].includes("text/html")) {
          response.end(
            (await upstream.text()).replaceAll(
              "https://telegram.org/js/telegram-web-app.js",
              `${appOrigin}/fixture-bridge.js`,
            ),
          );
        } else response.end(Buffer.from(await upstream.arrayBuffer()));
      }
    } catch (error) {
      console.error(error.message);
      response.writeHead(500);
      response.end();
    }
  },
);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
appOrigin = `https://mini-app.test:${port}`;
const parentOrigin = `https://telegram-web.test:${port}`;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--host-resolver-rules=MAP *.test 127.0.0.1",
    "--no-proxy-server",
    `--log-file=${path.join(fixtureRoot, "chromium.log")}`,
  ],
});
try {
  for (const [name, policy, expected] of [
    [
      "previous Lax policy",
      { ...SESSION_COOKIE_OPTIONS, sameSite: "lax", partitioned: false },
      "Не удалось подтвердить сессию",
    ],
    ["current session policy", SESSION_COOKIE_OPTIONS, "Доступ подтверждён"],
  ]) {
    options = policy;
    logins = 0;
    logoutSeen = false;
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      // Context-level proxy settings take precedence over a system proxy even
      // when Chromium ignores --no-proxy-server. Only fixture hosts go direct;
      // other destinations fail closed against an unused local port.
      proxy: { server: "http://127.0.0.1:9", bypass: ".test" },
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await page.goto(parentOrigin);
    const frame = page.frameLocator("iframe");
    await frame.locator("main.access-screen").waitFor();
    // Chromium 141 requires both heuristics flags; false keeps the default behaviour.
    await cdp.send("Network.setCookieControls", {
      enableThirdPartyCookieRestriction: true,
      disableThirdPartyCookieMetadata: false,
      disableThirdPartyCookieHeuristics: false,
    });
    await context.clearCookies();
    logins = 0;
    await page.reload();
    await frame
      .getByRole("heading", { name: expected })
      .waitFor({ timeout: 15_000 });
    assert.equal(logins, 1);
    if (expected === "Доступ подтверждён") {
      const child = page
        .frames()
        .find((item) => item.url().startsWith(appOrigin));
      assert.equal(
        await child.evaluate(() => document.cookie),
        "",
        "Session must stay HttpOnly",
      );
      await page.reload();
      await frame.getByRole("heading", { name: expected }).waitFor();
      assert.equal(logins, 1, "Reload must reuse the cookie");
      const otherPage = await context.newPage();
      await otherPage.goto(`https://other-parent.test:${port}`);
      await otherPage
        .frameLocator("iframe")
        .getByRole("heading", { name: expected })
        .waitFor();
      assert.equal(
        logins,
        2,
        "A different top-level site must require its own login",
      );
      await otherPage.close();
      // В интерфейсе кнопки выхода нет; маршрут и очистка cookie проверяются запросом.
      assert.equal(
        await frame.getByRole("button", { name: "Выйти" }).count(),
        0,
      );
      const current = page
        .frames()
        .find((item) => item.url().startsWith(appOrigin));
      await current.evaluate(
        (csrfToken) =>
          fetch("/api/v1/auth/logout", {
            method: "POST",
            headers: { "X-CSRF-Token": csrfToken },
            credentials: "same-origin",
          }),
        identity.csrfToken,
      );
      assert.ok(logoutSeen);
      assert.ok(
        (await context.cookies()).every(
          (cookie) =>
            cookie.name !== SESSION_COOKIE ||
            !cookie.partitionKey?.includes("telegram-web.test"),
        ),
        "Logout must remove this partition's cookie",
      );
      const topPage = await context.newPage();
      await topPage.goto(appOrigin);
      await topPage.getByRole("heading", { name: expected }).waitFor();
      assert.equal(
        logins,
        3,
        "A top-level launch must authenticate in its own partition",
      );
      await topPage.close();
    }
    console.log(`Embedded access: ${name} → ${expected}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
  rmSync(keyPath);
  rmSync(certPath);
  rmdirSync(tlsDirectory);
}
