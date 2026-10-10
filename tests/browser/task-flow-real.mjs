import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";
import { auditLayout } from "./layout-audit.mjs";
import { leaveHome } from "./home-fallback.mjs";
import { openSection } from "./nav.mjs";

const url = process.env.TEST_DATABASE_URL,
  origin = process.env.TEST_APP_ORIGIN ?? "http://localhost:3100",
  dir = path.join(
    process.env.TEST_SCREENSHOT_DIR ?? "test-results",
    "task-flow-real",
  );
if (!url) throw new Error("TEST_DATABASE_URL is required");
// Optional §12 checks: TEST_VIEWPORT_WIDTH (320/360/390) and TEST_TEXT_SCALE
// (e.g. 1.5, approximated by the root font size, not OS text scaling).
const viewportWidth = Number(process.env.TEST_VIEWPORT_WIDTH ?? 390),
  textScale = Number(process.env.TEST_TEXT_SCALE ?? 1);
await mkdir(dir, { recursive: true });
const db = new pg.Pool({ connectionString: url }),
  [manager, participant, reviewer] = [randomUUID(), randomUUID(), randomUUID()],
  [scope, rules] = [randomUUID(), randomUUID()],
  tokens = [manager, participant, reviewer].map(() =>
    randomBytes(32).toString("base64url"),
  ),
  title = `Сквозная проверка ${randomUUID()}`,
  report = "Сквозной отчёт: результат подтверждён источниками.",
  reason = "Сквозная приёмка: критерии выполнены.";

for (const [id, name] of [
  [manager, "Сквозной постановщик"],
  [participant, "Сквозной исполнитель"],
  [reviewer, "Сквозной проверяющий"],
])
  await db.query(
    "INSERT INTO impuls.users(id,telegram_id,display_name,active) VALUES($1,$2,$3,true)",
    [id, randomInt(7e12, 8e12), name],
  );
await db.query(
  "INSERT INTO impuls.access_scopes(id,kind,name) VALUES($1,'group','Сквозная область')",
  [scope],
);
await db.query(
  `INSERT INTO impuls.rule_sets(id,version_number,definition,effective_from,created_by)
   VALUES($1,$2,'{"mode":"synthetic","timeZone":"Europe/Moscow","acceptance":{"enabled":true}}',clock_timestamp()-interval '1 minute',$3)`,
  [rules, randomInt(100_000, 2_000_000_000), manager],
);
for (const [user, action] of [
  [manager, "task.create"],
  [manager, "task.assign"],
  [reviewer, "task.review"],
])
  await db.query(
    "INSERT INTO impuls.role_bindings(user_id,action,scope_id,granted_by,reason) VALUES($1,$2,$3,$1,'Synthetic e2e fixture')",
    [user, action, scope],
  );
await db.query(
  "INSERT INTO impuls.task_scope_members(scope_id,user_id,synthetic,valid_from) VALUES($1,$2,true,clock_timestamp()-interval '1 minute')",
  [scope, participant],
);
for (const [i, id] of [manager, participant, reviewer].entries())
  await db.query(
    "INSERT INTO impuls.sessions(user_id,session_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [id, createHash("sha256").update(tokens[i]).digest()],
  );

const browser = await chromium.launch();
async function open(index, width = viewportWidth) {
  const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
      timezoneId: "Europe/Moscow",
    }),
    page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await context.addCookies([
    { name: "impuls_session", value: tokens[index], url: origin },
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
  await leaveHome(page);
  return { page, context, errors };
}
const done = async (s, name) => {
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
const taskState = async () =>
  (
    await db.query(
      `SELECT t.status,
        (SELECT count(*)::int FROM impuls.submissions s WHERE s.task_id=t.id) submissions,
        (SELECT count(*)::int FROM impuls.reviews r JOIN impuls.submissions s ON s.id=r.submission_id WHERE s.task_id=t.id) reviews,
        (SELECT coalesce(sum(amount) FILTER(WHERE currency='xp'),0)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) xp,
        (SELECT coalesce(sum(amount) FILTER(WHERE currency='points'),0)::int FROM impuls.ledger_entries l WHERE l.task_id=t.id) points
       FROM impuls.tasks t WHERE t.created_by=$1 AND t.title=$2`,
      [manager, title],
    )
  ).rows[0];

// 1. manager creates and assigns
{
  const s = await open(0),
    p = s.page;
  await (await openSection(p, "Постановка задач")).click();
  await p.getByLabel("Область", { exact: true }).selectOption(scope);
  await p.getByLabel("Версия правил", { exact: true }).selectOption(rules);
  await p.getByLabel("Название", { exact: true }).fill(title);
  await p
    .getByLabel("Критерии результата", { exact: true })
    .fill("Источники приложены и проверены.");
  await p.getByLabel("Код категории", { exact: true }).fill("synthetic-e2e");
  await p.getByLabel("Приоритет", { exact: true }).selectOption("high");
  await p.getByLabel("Срок", { exact: true }).fill("2035-01-01T12:00");
  await p.getByLabel("Фонд XP", { exact: true }).fill("17");
  await p.getByLabel("Фонд баллов", { exact: true }).fill("9");
  await p
    .getByRole("button", { name: "Создать черновик", exact: true })
    .click();
  await p.getByRole("status").filter({ hasText: "создан" }).waitFor();
  await p.getByLabel(/Активный участник области/).selectOption(participant);
  await p.getByRole("button", { name: "Назначить", exact: true }).click();
  await p.getByText("Задача назначена участнику").waitFor();
  assert.equal((await taskState()).status, "assigned");
  await done(s, "1-manager");
}
// 2. participant works and submits
{
  const s = await open(1),
    p = s.page;
  await p.getByRole("button", { name: new RegExp(title) }).click();
  await p.getByRole("button", { name: "Начать работу", exact: true }).click();
  await p.getByLabel("Отчёт о выполнении", { exact: true }).fill(report);
  await p
    .getByRole("button", { name: "Отправить на проверку", exact: true })
    .click();
  await p
    .getByText("Отчёт отправлен на проверку. XP и баллы ещё не начислены.")
    .waitFor();
  const st = await taskState();
  assert.deepEqual(
    [st.status, st.submissions, st.xp, st.points],
    ["in_review", 1, 0, 0],
    "no accrual before acceptance",
  );
  await done(s, "2-participant");
}
// 3. reviewer accepts
{
  const s = await open(2),
    p = s.page;
  await p
    .getByRole("heading", { name: "Очередь проверки", exact: true })
    .waitFor();
  await p.getByRole("button", { name: new RegExp(title) }).click();
  await p
    .getByRole("radio", { name: "Принять результат", exact: true })
    .check();
  await p.getByLabel("Основание приёмки", { exact: true }).fill(reason);
  await p
    .getByRole("checkbox", { name: "Подтверждаю результат и указанный фонд" })
    .check();
  await p
    .getByRole("button", { name: /Принять|Подтвердить/ })
    .last()
    .click();
  await p
    .getByText("Результат принят. Начислено 17 XP и 9 баллов", {
      exact: false,
    })
    .waitFor();
  const st = await taskState();
  assert.deepEqual(
    [st.status, st.reviews, st.xp, st.points],
    ["accepted", 1, 17, 9],
  );
  await done(s, "3-reviewer");
}
// 4. participant sees the balance; DB balance equals ledger
{
  const s = await open(1),
    p = s.page;
  await (await openSection(p, "Баланс и журнал")).click();
  await p.getByText("+17 XP", { exact: true }).waitFor();
  await p.getByText("+9 баллов", { exact: true }).waitFor();
  const b = (
    await db.query(
      "SELECT lifetime_xp::int xp,available_points::int points,reserved_points::int reserved FROM impuls.account_balances WHERE user_id=$1",
      [participant],
    )
  ).rows[0];
  assert.deepEqual(
    b,
    { xp: 17, points: 9, reserved: 0 },
    "balance equals ledger",
  );
  await done(s, "4-balance");
}
await browser.close();
await db.end();
console.log("Task flow real-DB browser: 4 stages passed");
