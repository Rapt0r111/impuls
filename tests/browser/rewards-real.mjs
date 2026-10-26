import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";
import { auditLayout } from "./layout-audit.mjs";

// F06 through the real app and database (no API mocks): two participants race
// for the last quota place, the winner cancels, the loser then reserves, and
// an outsider sees no catalog. Points and quota are checked in PostgreSQL.
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "rewards-real",
  );
if (!url) throw new Error("TEST_DATABASE_URL is required");
// Optional §12 checks: TEST_VIEWPORT_WIDTH (320/360/390) and TEST_TEXT_SCALE
// (e.g. 1.5, approximated by the root font size, not OS text scaling).
const viewportWidth = Number(process.env.TEST_VIEWPORT_WIDTH ?? 390),
  textScale = Number(process.env.TEST_TEXT_SCALE ?? 1);
await mkdir(dir, { recursive: true });
const db = new pg.Pool({ connectionString: url }),
  keys = ["a", "b", "outsider"],
  ids = Object.fromEntries(keys.map((k) => [k, randomUUID()])),
  tokens = Object.fromEntries(
    keys.map((k) => [k, randomBytes(32).toString("base64url")]),
  ),
  [scope, rewardId, versionId, quotaId] = [1, 2, 3, 4].map(() => randomUUID()),
  title = `Знак гонки ${randomUUID().slice(0, 8)}`;

for (const key of keys) {
  await db.query(
    "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
    [ids[key], randomInt(7e12, 8e12), `Каталог ${key}`],
  );
  await db.query(
    "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [ids[key], createHash("sha256").update(tokens[key]).digest()],
  );
  await db.query(
    "INSERT INTO impuls.account_balances(user_id,lifetime_xp,available_points) VALUES($1,300,120)",
    [ids[key]],
  );
}
await db.query(
  "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'project','Область каталога')",
  [scope],
);
for (const key of ["a", "b"])
  await db.query(
    "INSERT INTO impuls.task_scope_members(user_id,scope_id) VALUES($1,$2)",
    [ids[key], scope],
  );
await db.query(
  `INSERT INTO impuls.reward_versions(id,reward_id,scope_id,version,title,conditions,price,kind,enabled,effective_from)
   VALUES($1,$2,$3,1,$4,'Косметика; синтетические условия',30,'cosmetic',true,clock_timestamp()-interval '1 second')`,
  [versionId, rewardId, scope, title],
);
await db.query(
  "INSERT INTO impuls.quota_periods(id,reward_id,scope_id,starts_at,ends_at,capacity) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',1)",
  [quotaId, rewardId, scope],
);

const state = async () => ({
  statuses: (
    await db.query(
      "SELECT status FROM impuls.redemptions WHERE quota_period_id=$1 ORDER BY status",
      [quotaId],
    )
  ).rows.map((r) => r.status),
  balances: Object.fromEntries(
    (
      await db.query(
        "SELECT user_id,available_points::int AS available_points,reserved_points::int AS reserved_points FROM impuls.account_balances WHERE user_id=ANY($1)",
        [Object.values(ids)],
      )
    ).rows.map((r) => [
      keys.find((k) => ids[k] === r.user_id),
      [r.available_points, r.reserved_points],
    ]),
  ),
});

const browser = await chromium.launch();
async function open(key, width = viewportWidth) {
  const context = await browser.newContext({
      viewport: { width, height: 844 },
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
  if (textScale !== 1)
    await page.addStyleTag({
      content: `html{font-size:${textScale * 100}%}`,
    });
  await page
    .getByRole("heading", { name: "Доступ подтверждён", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Поощрения", exact: true }).click();
  return { page, context, errors };
}
const finish = async (s, name) => {
  await auditLayout(s.page, `${path.basename(dir)}/${name}`);
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
async function prepare(s) {
  await s.page.getByRole("heading", { name: title, exact: true }).waitFor();
  await s.page.getByRole("button", { name: "Получить", exact: true }).click();
  await s.page
    .getByRole("heading", { name: "Получить поощрение?", exact: true })
    .waitFor();
  return s.page.getByRole("button", {
    name: "Получить за 30 баллов",
    exact: true,
  });
}

// 1. Race for the last place: exactly one reservation, one 30-point hold.
let winner, loser;
{
  const sessions = { a: await open("a"), b: await open("b") },
    submits = { a: await prepare(sessions.a), b: await prepare(sessions.b) };
  await Promise.all([submits.a.click(), submits.b.click()]);
  const outcome = async (s) =>
    Promise.race([
      s.page
        .getByText(/Заявка сохранена/)
        .waitFor()
        .then(() => "won"),
      s.page
        .locator(".reward-confirmation")
        .getByRole("button", { name: "Обновить поощрения", exact: true })
        .waitFor()
        .then(() => "lost"),
    ]);
  const results = {
    a: await outcome(sessions.a),
    b: await outcome(sessions.b),
  };
  assert.deepEqual(Object.values(results).sort(), ["lost", "won"]);
  winner = results.a === "won" ? "a" : "b";
  loser = winner === "a" ? "b" : "a";
  const s = await state();
  assert.deepEqual(s.statuses, ["pending"]);
  assert.deepEqual(s.balances[winner], [90, 30]);
  assert.deepEqual(s.balances[loser], [120, 0]);
  const stale = sessions[loser].page;
  await stale.getByText("Данные устарели, обновите поощрения.").waitFor();
  assert.equal(await stale.getByText(/Свободно: 1/).count(), 0);
  await finish(sessions[winner], "1-race-winner");
  await finish(sessions[loser], "1-race-loser");
}

// 2. Winner cancels: points back once, place freed; the loser then reserves.
{
  const w = await open(winner);
  await w.page
    .getByRole("button", { name: "Отменить заявку", exact: true })
    .first()
    .click();
  await w.page
    .getByLabel("Причина отмены", { exact: true })
    .fill("Синтетическая отмена в проверке.");
  await w.page
    .getByRole("button", { name: "Отменить и вернуть баллы", exact: true })
    .click();
  await w.page.getByText(/Заявка отменена. 30 баллов вернулись/).waitFor();
  let s = await state();
  assert.deepEqual(s.statuses, ["cancelled"]);
  assert.deepEqual(s.balances[winner], [120, 0]);
  await finish(w, "2-winner-cancelled");

  const l = await open(loser);
  await (await prepare(l)).click();
  await l.page.getByText(/Заявка сохранена/).waitFor();
  s = await state();
  assert.deepEqual(s.statuses, ["cancelled", "pending"]);
  assert.deepEqual(s.balances[loser], [90, 30]);
  assert.deepEqual(s.balances[winner], [120, 0]);
  await finish(l, "2-loser-reserves");
}

// 3. No scope membership: no catalog item and no balance change.
{
  const s = await open("outsider");
  await s.page.getByText(/Поощрения видны участникам/).waitFor();
  assert.equal(
    await s.page.getByRole("heading", { name: title, exact: true }).count(),
    0,
  );
  assert.deepEqual((await state()).balances.outsider, [120, 0]);
  await finish(s, "3-outsider");
}

await browser.close();
await db.end();
console.log("rewards-real: 3 scenarios passed");
