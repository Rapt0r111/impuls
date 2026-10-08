import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";

// F06/F07 decision and fulfilment through the real app and database (no API
// mocks): approve then fulfil, two deciders race for one request, and a
// decider cannot decide their own request. Redemptions are created through
// the real reservation endpoint; results are read from PostgreSQL.
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "reward-decisions-real",
  );
if (!url) throw new Error("TEST_DATABASE_URL is required");
await mkdir(dir, { recursive: true });
const keys = ["recipient", "deciderA", "deciderB", "fulfiller", "self"],
  db = new pg.Pool({ connectionString: url }),
  ids = Object.fromEntries(keys.map((k) => [k, randomUUID()])),
  tokens = Object.fromEntries(
    keys.map((k) => [k, randomBytes(32).toString("base64url")]),
  ),
  scope = randomUUID(),
  tag = randomUUID().slice(0, 8),
  rewards = Object.fromEntries(
    ["flow", "race", "own"].map((k) => [
      k,
      {
        rewardId: randomUUID(),
        versionId: randomUUID(),
        quotaId: randomUUID(),
        title: `Знак ${k} ${tag}`,
      },
    ]),
  ),
  reason = "Проверка решения на реальной БД.";

for (const key of keys) {
  await db.query(
    "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
    [ids[key], randomInt(7e12, 8e12), `Решение ${key}`],
  );
  await db.query(
    "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
    [ids[key]],
  );
}
await db.query(
  "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Область решений')",
  [scope],
);
for (const key of ["recipient", "self"])
  await db.query(
    "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
    [ids[key], scope],
  );
for (const [user, action] of [
  ["deciderA", "reward.decide"],
  ["deciderB", "reward.decide"],
  ["self", "reward.decide"],
  ["fulfiller", "reward.fulfill"],
])
  await db.query(
    "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic decision fixture')",
    [ids[user], action, scope],
  );
// Granting a role revokes the user's sessions, so sessions are created last.
for (const key of keys)
  await db.query(
    "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [ids[key], createHash("sha256").update(tokens[key]).digest()],
  );
for (const r of Object.values(rewards)) {
  await db.query(
    `INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,mode,enabled,effective_from)
     VALUES($1,$2,$3,1,$4,'Косметика; синтетические условия',30,'cosmetic','synthetic',true,clock_timestamp()-interval '1 second')`,
    [r.versionId, r.rewardId, scope, r.title],
  );
  await db.query(
    "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',1)",
    [r.quotaId, r.rewardId, scope],
  );
}

const state = async (reward, user) => ({
  redemption: (
    await db.query(
      `SELECT status, decision_actor_id, fulfillment_actor_id,
        (SELECT count(*)::int FROM impuls.entitlements e WHERE e.redemption_id=r.id) entitlements
       FROM impuls.redemptions r WHERE quota_period_id=$1`,
      [reward.quotaId],
    )
  ).rows,
  balance: (
    await db.query(
      "SELECT available_points::int a, reserved_points::int r FROM impuls.account_balances WHERE user_id=$1",
      [ids[user]],
    )
  ).rows.map((b) => [b.a, b.r])[0],
});

const browser = await chromium.launch();
async function open(key, tab) {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
      timezoneId: "Europe/Moscow",
    }),
    page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([
    { name: "impuls_session", value: tokens[key], url: origin },
  ]);
  await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{initData:'',version:'8.0',isVersionAtLeast(){return true},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}}",
    }),
  );
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Доступ подтверждён", exact: true })
    .waitFor();
  const s = { page, context, errors };
  if (tab) {
    await page.getByRole("button", { name: "Поощрения", exact: true }).click();
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page
      .getByRole("heading", {
        name: tab === "Выдача косметики" ? tab : "Решения по заявкам",
        exact: true,
      })
      .waitFor();
  }
  return s;
}
const finish = async (s, name) => {
  await s.page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  });
  assert.deepEqual(s.errors, []);
  assert.equal(
    await s.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "no horizontal scroll",
  );
  await s.context.close();
};
// Real reservation endpoint: creates the pending request, reserved points and quota use.
async function reserve(key, reward) {
  const s = await open(key),
    status = await s.page.evaluate(async (r) => {
      const me = await (await fetch("/api/v1/me")).json();
      const res = await fetch("/api/v1/redemptions", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          rewardVersionId: r.versionId,
          quotaPeriodId: r.quotaId,
          expectedVersion: 1,
        }),
      });
      return res.status;
    }, reward);
  assert.equal(status, 201);
  await s.context.close();
}
async function review(s, title, decision) {
  await s.page
    .locator("li", { hasText: title })
    .getByRole("button", { name: "Рассмотреть заявку", exact: true })
    .click();
  await s.page.getByRole("heading", { name: "Подтвердите решение" }).waitFor();
  if (decision)
    await s.page.getByLabel("Решение", { exact: true }).selectOption(decision);
  await s.page.getByLabel("Причина решения", { exact: true }).fill(reason);
  await s.page.getByRole("checkbox").check();
}

// 1. Approve, then a separate fulfiller issues the cosmetic.
{
  const r = rewards.flow;
  await reserve("recipient", r);
  assert.deepEqual((await state(r, "recipient")).balance, [90, 30]);
  const d = await open("deciderA", "Решения по заявкам");
  await review(d, r.title);
  await d.page
    .getByRole("button", { name: "Одобрить заявку", exact: true })
    .click();
  await d.page.getByText(/Заявка одобрена/).waitFor();
  let s = await state(r, "recipient");
  assert.equal(s.redemption[0].status, "approved");
  assert.equal(s.redemption[0].decision_actor_id, ids.deciderA);
  assert.deepEqual(s.balance, [90, 0]);
  await finish(d, "1-approved");

  const f = await open("fulfiller", "Выдача косметики");
  await f.page
    .locator("li", { hasText: r.title })
    .getByRole("button", { name: "Подготовить выдачу", exact: true })
    .click();
  await f.page
    .getByLabel("Основание выдачи", { exact: true })
    .fill("Синтетическая выдача.");
  await f.page.getByRole("checkbox").check();
  await f.page
    .getByRole("button", { name: "Выдать косметику", exact: true })
    .click();
  await f.page.getByText(/Косметика выдана/).waitFor();
  s = await state(r, "recipient");
  assert.equal(s.redemption[0].status, "fulfilled");
  assert.equal(s.redemption[0].fulfillment_actor_id, ids.fulfiller);
  assert.equal(s.redemption[0].entitlements, 1);
  assert.deepEqual(s.balance, [90, 0]);
  await finish(f, "1-fulfilled");
}

// 2. Two deciders race for one pending request: one decision, one spend.
{
  const r = rewards.race;
  await reserve("recipient", r);
  assert.deepEqual((await state(r, "recipient")).balance, [60, 30]);
  const sessions = [
      await open("deciderA", "Решения по заявкам"),
      await open("deciderB", "Решения по заявкам"),
    ],
    buttons = [];
  for (const s of sessions) {
    await review(s, r.title);
    buttons.push(
      s.page.getByRole("button", { name: "Одобрить заявку", exact: true }),
    );
  }
  await Promise.all(buttons.map((b) => b.click()));
  const outcomes = await Promise.all(
    sessions.map((s) =>
      Promise.race([
        s.page
          .getByText(/Заявка одобрена/)
          .waitFor()
          .then(() => "won"),
        s.page
          .getByText(
            /Решение не принято: заявку уже решил другой уполномоченный/,
          )
          .waitFor()
          .then(() => "lost"),
      ]),
    ),
  );
  assert.deepEqual([...outcomes].sort(), ["lost", "won"]);
  const s = await state(r, "recipient");
  assert.equal(s.redemption.length, 1);
  assert.equal(s.redemption[0].status, "approved");
  assert.ok(
    [ids.deciderA, ids.deciderB].includes(s.redemption[0].decision_actor_id),
  );
  assert.deepEqual(s.balance, [60, 0]);
  await finish(sessions[0], "2-race-a");
  await finish(sessions[1], "2-race-b");
}

// 3. A decider cannot decide their own request, in the queue or by direct call.
{
  const r = rewards.own;
  await reserve("self", r);
  const s = await open("self", "Решения по заявкам"),
    id = (
      await db.query(
        "SELECT id FROM impuls.redemptions WHERE quota_period_id=$1",
        [r.quotaId],
      )
    ).rows[0].id;
  await s.page.getByText(/Ожидающих чужих заявок нет/).waitFor();
  assert.equal(await s.page.getByText(r.title).count(), 0);
  const status = await s.page.evaluate(
    async ([redemption, why]) => {
      const me = await (await fetch("/api/v1/me")).json();
      const res = await fetch(`/api/v1/redemptions/${redemption}/decide`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          decision: "approve",
          expectedVersion: 1,
          reason: why,
        }),
      });
      return res.status;
    },
    [id, reason],
  );
  assert.ok([403, 404].includes(status), `self-decision refused: ${status}`);
  const st = await state(r, "self");
  assert.equal(st.redemption[0].status, "pending");
  assert.equal(st.redemption[0].decision_actor_id, null);
  assert.deepEqual(st.balance, [90, 30]);
  await finish(s, "3-own-request");
}

await browser.close();
await db.end();
console.log("reward-decisions-real: 3 scenarios passed");
