import assert from "node:assert/strict";
import { chromium } from "playwright";

// ADR-0038: сигнал по Realtime обновляет открытый экран сразу, без опроса раз в минуту.
const origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100";
const at = "2026-10-06T10:00:00.000Z";
const uid = "a1111111-1111-4111-8111-111111111111";
const topic = `impuls-${"ab".repeat(32)}`;
const freeTask = {
  id: "c2222222-1111-4111-8111-111111111111",
  title: "Свободная задача из сигнала",
  criteria: "Критерии",
  priority: "normal",
  dueAt: "2099-10-07T10:00:00.000Z",
  fundXp: 10,
  fundPoints: 5,
  version: 1,
  updatedAt: at,
  scope: {
    id: "b1111111-1111-4111-8111-111111111111",
    kind: "group",
    name: "Группа",
  },
};
const browser = await chromium.launch();
let scenarios = 0;

async function open(realtime) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = { free: [], openCalls: 0, sockets: [], urls: [], joins: [] };
  const json = (r, body, status = 200) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{ready(){},expand(){}}}",
    }),
  );
  // Узел Realtime: протокол Phoenix v2, кадры [join_ref, ref, topic, event, payload].
  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    state.sockets.push(ws);
    state.urls.push(ws.url());
    ws.onMessage((raw) => {
      const [joinRef, ref, t, event] = JSON.parse(String(raw));
      if (event === "phx_join") {
        state.joins.push(t);
        ws.send(
          JSON.stringify([
            joinRef,
            ref,
            t,
            "phx_reply",
            { status: "ok", response: {} },
          ]),
        );
      } else if (event === "heartbeat") {
        ws.send(
          JSON.stringify([
            null,
            ref,
            "phoenix",
            "phx_reply",
            { status: "ok", response: {} },
          ]),
        );
      }
    });
  });
  await page.route(
    (u) => u.pathname.startsWith("/api/v1/"),
    (r) => {
      const p = new URL(r.request().url()).pathname;
      if (p === "/api/v1/me")
        return json(r, {
          user: { id: uid, displayName: "Участник" },
          csrfToken: "x",
        });
      if (p === "/api/v1/me/permissions") return json(r, { permissions: [] });
      if (p === "/api/v1/me/realtime") return realtime(r, json);
      if (p === "/api/v1/me/profile")
        return json(r, {
          user: { id: uid, displayName: "Участник" },
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
        return json(r, { items: [], nextCursor: null });
      if (p === "/api/v1/tasks/open") {
        state.openCalls += 1;
        return json(r, { items: state.free });
      }
      if (p === "/api/v1/me/ledger")
        return json(r, {
          balance: {
            lifetimeXp: 0,
            availablePoints: 0,
            reservedPoints: 0,
            version: 1,
            updatedAt: at,
          },
          entries: [],
          nextCursor: null,
          asOf: at,
        });
      if (p === "/api/v1/me/redemptions")
        return json(r, {
          items: [],
          nextCursor: null,
          updatedAt: at,
        });
      if (p === "/api/v1/leaderboard")
        return json(r, {
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
      return json(r, { code: "TEST" }, 404);
    },
  );
  await page.goto(origin);
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  return { context, page, state, errors };
}
const push = (state, kind = "tasks") =>
  state.sockets[0].send(
    JSON.stringify([
      null,
      null,
      `realtime:${topic}`,
      "broadcast",
      { type: "broadcast", event: "change", payload: { kind } },
    ]),
  );

{
  // Сигнал: новая свободная задача появляется за секунды, а не через минуту опроса.
  const { context, page, state, errors } = await open((r, json) =>
    json(r, {
      enabled: true,
      url: "https://example.supabase.co",
      key: "sb_publishable_test",
      topic,
    }),
  );
  await page.waitForFunction(() => true);
  await new Promise((resolve) => {
    const check = () =>
      state.joins.length ? resolve() : setTimeout(check, 50);
    check();
  });
  assert.deepEqual(state.joins, [`realtime:${topic}`]);
  assert.match(
    state.urls[0],
    /^wss:\/\/example\.supabase\.co\/realtime\/v1\/websocket\?.*apikey=sb_publishable_test/,
  );
  assert.equal(
    await page.getByText("Свободные задачи", { exact: true }).count(),
    0,
  );
  state.free = [freeTask];
  push(state);
  await page
    .getByText("Свободные задачи", { exact: true })
    .waitFor({ timeout: 4000 });
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

{
  // Пачка сигналов подряд даёт одно обновление.
  const { context, page, state } = await open((r, json) =>
    json(r, {
      enabled: true,
      url: "https://example.supabase.co",
      key: "k",
      topic,
    }),
  );
  await new Promise((resolve) => {
    const check = () =>
      state.joins.length ? resolve() : setTimeout(check, 50);
    check();
  });
  await page.waitForTimeout(500);
  const before = state.openCalls;
  state.free = [freeTask];
  for (let i = 0; i < 5; i++) push(state, i % 2 ? "ledger" : "tasks");
  await page
    .getByText("Свободные задачи", { exact: true })
    .waitFor({ timeout: 4000 });
  await page.waitForTimeout(800);
  assert.equal(
    state.openCalls - before,
    1,
    "пачка сигналов — одно перечитывание",
  );
  await context.close();
  scenarios++;
}

for (const [name, handler] of [
  ["выключено", (r, json) => json(r, { enabled: false })],
  [
    "сервер ответил ошибкой",
    (r, json) => json(r, { code: "UNAVAILABLE" }, 503),
  ],
  [
    "ответ нарушает контракт",
    (r, json) =>
      json(r, { enabled: true, url: "http://x.co", key: "k", topic }),
  ],
]) {
  const { context, page, state, errors } = await open(handler);
  await page.waitForTimeout(1200);
  assert.equal(state.sockets.length, 0, `${name}: соединение не открывается`);
  assert.equal(
    await page.getByRole("button", { name: /^Баллы:/ }).count(),
    1,
    `${name}: экран работает`,
  );
  assert.deepEqual(errors, []);
  await context.close();
  scenarios++;
}

await browser.close();
console.log(`Realtime signal browser checks passed: ${scenarios} scenarios`);
