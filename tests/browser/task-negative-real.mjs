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
    "task-negative-real",
  );
if (!url) throw new Error("TEST_DATABASE_URL is required");
// Optional §12 checks: TEST_VIEWPORT_WIDTH (320/360/390) and TEST_TEXT_SCALE
// (e.g. 1.5, approximated by the root font size, not OS text scaling).
const viewportWidth = Number(process.env.TEST_VIEWPORT_WIDTH ?? 390),
  textScale = Number(process.env.TEST_TEXT_SCALE ?? 1);
await mkdir(dir, { recursive: true });
const db = new pg.Pool({ connectionString: url }),
  ids = Object.fromEntries(
    ["author", "owner", "reviewerA", "reviewerB", "reviewerC"].map((k) => [
      k,
      randomUUID(),
    ]),
  ),
  tokens = Object.fromEntries(
    Object.keys(ids).map((k) => [k, randomBytes(32).toString("base64url")]),
  ),
  [scope, rules] = [randomUUID(), randomUUID()],
  tag = randomUUID().slice(0, 8),
  reason = "Отрицательная проверка: основание решения.";

for (const [key, id] of Object.entries(ids))
  await db.query(
    "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
    [id, randomInt(7e12, 8e12), `Негативный ${key}`],
  );
await db.query(
  "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'group','Негативная область')",
  [scope],
);
await db.query(
  `INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by)
   VALUES($1,$2,'{"mode":"synthetic","timeZone":"Europe/Moscow","acceptance":{"enabled":true}}',clock_timestamp()-interval '1 minute',$3)`,
  [rules, randomInt(100_000, 2_000_000_000), ids.author],
);
// owner is also a reviewer in the scope: the own-result exclusion must still hold.
for (const user of ["owner", "reviewerA", "reviewerB", "reviewerC"])
  await db.query(
    "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,'task.review',$2,$1,'Synthetic negative fixture')",
    [ids[user], scope],
  );
for (const key of Object.keys(ids))
  await db.query(
    "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [ids[key], createHash("sha256").update(tokens[key]).digest()],
  );

async function inReview(owner, label) {
  const title = `Негатив ${label} ${tag}`,
    taskId = randomUUID();
  await db.query(
    `INSERT INTO impuls.tasks(id,scope_id,rule_set_id,created_by,title,criteria,category_code,priority,status,due_at,fund_xp,fund_points)
     VALUES($1,$2,$3,$4,$5,'Независимые критерии','synthetic-neg','normal','in_review',now()+interval '30 days',17,9)`,
    [taskId, scope, rules, ids.author, title],
  );
  await db.query(
    "INSERT INTO impuls.task_assignments(task_id,user_id) VALUES($1,$2)",
    [taskId, ids[owner]],
  );
  await db.query(
    "INSERT INTO impuls.submissions(task_id,author_id,attempt_number,text) VALUES($1,$2,1,'Синтетический отчёт')",
    [taskId, ids[owner]],
  );
  return { title, taskId };
}
const state = async (taskId) =>
  (
    await db.query(
      `SELECT t.status,
        (SELECT count(*)::int FROM impuls.reviews r JOIN impuls.submissions s ON s.id=r.submission_id WHERE s.task_id=t.id) reviews,
        (SELECT count(*)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) entries,
        (SELECT coalesce(sum(amount) FILTER(WHERE currency='xp'),0)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) xp,
        (SELECT coalesce(sum(amount) FILTER(WHERE currency='points'),0)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) points
       FROM impuls.tasks t WHERE t.id=$1`,
      [taskId],
    )
  ).rows[0];

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
async function openForm(s, title) {
  await s.page
    .getByRole("heading", { name: "Очередь проверки", exact: true })
    .waitFor();
  await s.page.getByRole("button", { name: new RegExp(title) }).click();
  await s.page
    .getByRole("radio", { name: "Принять результат", exact: true })
    .check();
  await s.page.getByLabel("Основание приёмки", { exact: true }).fill(reason);
  await s.page
    .getByRole("checkbox", { name: "Подтверждаю результат и указанный фонд" })
    .check();
}
const submit = (s) =>
  s.page
    .getByRole("button", { name: /Принять|Подтвердить/ })
    .last()
    .click();

// 1. Own result: a reviewer never sees or accepts their own submission.
{
  const own = await inReview("owner", "own"),
    s = await open("owner");
  await s.page
    .getByRole("heading", { name: "Очередь проверки", exact: true })
    .waitFor();
  assert.equal(
    await s.page.getByRole("button", { name: new RegExp(own.title) }).count(),
    0,
    "own submission is not listed",
  );
  const submissionId = (
    await db.query("SELECT id FROM impuls.submissions WHERE task_id=$1", [
      own.taskId,
    ])
  ).rows[0].id;
  const status = await s.page.evaluate(
    async ([id]) => {
      const me = await (await fetch("/api/v1/me")).json();
      const r = await fetch(`/api/v1/submissions/${id}/review`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: "accept",
          expectedVersion: 1,
          reason: "self",
        }),
      });
      return r.status;
    },
    [submissionId],
  );
  assert.ok(
    [403, 404].includes(status),
    `direct self-accept refused: ${status}`,
  );
  assert.deepEqual(await state(own.taskId), {
    status: "in_review",
    reviews: 0,
    entries: 0,
    xp: 0,
    points: 0,
  });
  await finish(s, "1-own-result");
}
// 2. Two reviewers accept the same submission concurrently: one award only.
{
  const race = await inReview("author", "race"),
    a = await open("reviewerA"),
    b = await open("reviewerB");
  await openForm(a, race.title);
  await openForm(b, race.title);
  await Promise.all([submit(a), submit(b)]);
  const outcome = async (s) =>
    s.page
      .getByText(/Результат принят|Решение уже изменилось/)
      .first()
      .innerText();
  const texts = await Promise.all([outcome(a), outcome(b)]);
  assert.equal(
    texts.filter((t) => t.startsWith("Результат принят")).length,
    1,
    `exactly one acceptance: ${texts.join(" | ")}`,
  );
  assert.equal(
    texts.filter((t) => t.startsWith("Решение уже изменилось")).length,
    1,
  );
  assert.deepEqual(await state(race.taskId), {
    status: "accepted",
    reviews: 1,
    entries: 2,
    xp: 17,
    points: 9,
  });
  await finish(a, "2-race-a");
  await finish(b, "2-race-b");
}
// 3. Access revoked while the form is open: nothing is saved.
{
  const revoked = await inReview("author", "revoked"),
    s = await open("reviewerC");
  await openForm(s, revoked.title);
  await db.query("UPDATE impuls.users SET active=false WHERE id=$1", [
    ids.reviewerC,
  ]);
  await submit(s);
  await s.page
    .getByRole("heading", { name: "Доступ подтверждён", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await s.page.getByText("Результат принят", { exact: false }).count(),
    0,
  );
  assert.deepEqual(await state(revoked.taskId), {
    status: "in_review",
    reviews: 0,
    entries: 0,
    xp: 0,
    points: 0,
  });
  await finish(s, "3-revoked");
}
await browser.close();
await db.end();
console.log("Task negative real-DB browser: 3 scenarios passed");
