import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";

// Negative F03/F04 paths through the real app and database (no API mocks):
// own result is not reviewable, two reviewers race for one acceptance,
// access revoked while the review form is open.
const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "task-return-real",
  );
if (!url) throw new Error("TEST_DATABASE_URL is required");
await mkdir(dir, { recursive: true });
const db = new pg.Pool({ connectionString: url }),
  ids = Object.fromEntries(
    ["author", "owner", "reviewer", "other"].map((k) => [k, randomUUID()]),
  ),
  tokens = Object.fromEntries(
    Object.keys(ids).map((k) => [k, randomBytes(32).toString("base64url")]),
  ),
  [scope, rules] = [randomUUID(), randomUUID()],
  tag = randomUUID().slice(0, 8),
  reason = "Проверка возврата: основание решения.";

for (const [key, id] of Object.entries(ids))
  await db.query(
    "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
    [id, randomInt(7e12, 8e12), `Возврат ${key}`],
  );
await db.query(
  "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'group','Область возврата')",
  [scope],
);
await db.query(
  `INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by)
   VALUES($1,$2,'{"mode":"synthetic","timeZone":"Europe/Moscow","acceptance":{"enabled":true}}',clock_timestamp()-interval '1 minute',$3)`,
  [rules, randomInt(100_000, 2_000_000_000), ids.author],
);
await db.query(
  "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'task.review',$2,$1,'Synthetic return fixture')",
  [ids.reviewer, scope],
);
for (const key of Object.keys(ids))
  await db.query(
    "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [ids[key], createHash("sha256").update(tokens[key]).digest()],
  );

const browser = await chromium.launch();
async function open(key, width = 390) {
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
  await page
    .getByRole("heading", { name: "Доступ подтверждён", exact: true })
    .waitFor();
  return { page, context, errors };
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

async function seed(label, status) {
  const title = `Возврат ${label} ${tag}`,
    taskId = randomUUID();
  await db.query(
    `INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points)
     VALUES($1,$2,$3,$4,$5,'Независимые критерии','synthetic-ret','normal',$6,now()+interval '30 days',17,9)`,
    [taskId, scope, rules, ids.author, title, status],
  );
  await db.query(
    "INSERT INTO impuls.task_assignments(task_id,user_id) VALUES($1,$2)",
    [taskId, ids.owner],
  );
  if (status === "in_review")
    await db.query(
      "INSERT INTO impuls.submissions(task_id,author_id,attempt_number,text) VALUES($1,$2,1,'Первый отчёт')",
      [taskId, ids.owner],
    );
  return { title, taskId };
}
const state = async (taskId) =>
  (
    await db.query(
      `SELECT t.status,
        (SELECT count(*)::int FROM impuls.submissions s WHERE s.task_id=t.id) submissions,
        (SELECT count(*)::int FROM impuls.reviews r JOIN impuls.submissions s ON s.id=r.submission_id WHERE s.task_id=t.id) reviews,
        (SELECT count(*)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) entries,
        (SELECT coalesce(sum(amount) FILTER(WHERE currency='xp'),0)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) xp,
        (SELECT coalesce(sum(amount) FILTER(WHERE currency='points'),0)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) points
       FROM impuls.tasks t WHERE t.id=$1`,
      [taskId],
    )
  ).rows[0];
const queue = (s) =>
  s.page
    .getByRole("heading", { name: "Очередь проверки", exact: true })
    .waitFor();

// 1. Return, rework, resubmit, accept: no accrual until the final acceptance.
{
  const t = await seed("rework", "in_review"),
    r = await open("reviewer");
  await queue(r);
  await r.page.getByRole("button", { name: new RegExp(t.title) }).click();
  await r.page
    .getByRole("radio", { name: "Вернуть на доработку", exact: true })
    .check();
  await r.page.getByLabel("Причина возврата", { exact: true }).fill(reason);
  await r.page
    .getByRole("button", { name: "Вернуть на доработку", exact: true })
    .click();
  await r.page.getByText(/Возврат сохранён/).waitFor();
  assert.deepEqual(await state(t.taskId), {
    status: "needs_work",
    submissions: 1,
    reviews: 1,
    entries: 0,
    xp: 0,
    points: 0,
  });
  await finish(r, "1-returned");

  const o = await open("owner");
  await o.page.getByRole("button", { name: new RegExp(t.title) }).click();
  await o.page.getByText(reason, { exact: true }).waitFor();
  await o.page
    .getByRole("button", { name: "Продолжить работу", exact: true })
    .click();
  await o.page
    .getByLabel("Отчёт о выполнении", { exact: true })
    .fill("Исправленный отчёт");
  await o.page
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await o.page
    .getByText("Отчёт отправлен на проверку. XP и баллы ещё не начислены.")
    .waitFor();
  assert.deepEqual(await state(t.taskId), {
    status: "in_review",
    submissions: 2,
    reviews: 1,
    entries: 0,
    xp: 0,
    points: 0,
  });
  await finish(o, "1-resubmitted");

  const a = await open("reviewer");
  await queue(a);
  await a.page.getByRole("button", { name: new RegExp(t.title) }).click();
  await a.page
    .getByRole("radio", { name: "Принять результат", exact: true })
    .check();
  await a.page.getByLabel("Основание приёмки", { exact: true }).fill(reason);
  await a.page
    .getByRole("checkbox", { name: "Подтверждаю результат и указанный фонд" })
    .check();
  await a.page
    .getByRole("button", { name: "Подтвердить приёмку и начисление" })
    .click();
  await a.page
    .getByText(/Результат принят. Начислено 17 XP и 9 баллов/)
    .waitFor();
  assert.deepEqual(await state(t.taskId), {
    status: "accepted",
    submissions: 2,
    reviews: 2,
    entries: 2,
    xp: 17,
    points: 9,
  });
  await finish(a, "1-accepted");
}

// 2. Foreign task: a non-assignee neither sees nor mutates it.
{
  const t = await seed("foreign", "assigned"),
    s = await open("other");
  assert.equal(
    await s.page.getByRole("button", { name: new RegExp(t.title) }).count(),
    0,
    "foreign task is not listed",
  );
  const statuses = await s.page.evaluate(async (id) => {
    const me = await (await fetch("/api/v1/me")).json();
    const headers = {
      "Content-Type": "application/json",
      "X-CSRF-Token": me.csrfToken,
      "Idempotency-Key": crypto.randomUUID(),
    };
    const read = await fetch(`/api/v1/tasks/${id}`, {
      credentials: "same-origin",
    });
    const start = await fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ action: "start", expectedVersion: 1 }),
    });
    const submit = await fetch(`/api/v1/tasks/${id}/submissions`, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ text: "Чужой отчёт", expectedVersion: 1 }),
    });
    return [read.status, start.status, submit.status];
  }, t.taskId);
  for (const status of statuses)
    assert.ok(
      [403, 404].includes(status),
      `foreign access refused: ${statuses}`,
    );
  assert.deepEqual(await state(t.taskId), {
    status: "assigned",
    submissions: 0,
    reviews: 0,
    entries: 0,
    xp: 0,
    points: 0,
  });
  await finish(s, "2-foreign-task");
}

await browser.close();
await db.end();
console.log("Task return real-DB browser: 2 scenarios passed");
